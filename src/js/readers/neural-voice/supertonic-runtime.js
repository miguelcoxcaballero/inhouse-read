// Adapted from Supertone's MIT-licensed web/helper.js inference recipe.
// Copyright (c) 2025 Supertone Inc. See /licenses/supertonic-sdk-MIT.txt.
// The model weights have the separate OpenRAIL-M licence.
import { SUPERTONIC_LANGUAGES, SUPERTONIC_STYLES, SUPERTONIC_LEGACY_STYLES } from './supertonic-catalog.js';

const cancelled = () => Object.assign(new Error('Lectura cancelada'),{name:'AbortError',code:'aborted'});
import { yieldToMessages as yieldTask } from './task-yield.js';
// Six steps preserved the tested Dutch/Spanish/English intelligibility at
// <1 RTF in the recorded single-thread desktop WASM benchmark, unlike FP32/8.
export const SUPERTONIC_STEPS = 6;

export function normalizeSupertonicText(text,lang) {
  if(!SUPERTONIC_LANGUAGES.includes(lang))throw new Error(`Idioma Supertonic no disponible: ${lang}`);
  let value=String(text||'').normalize('NFKD')
    .replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F1E6}-\u{1F1FF}]+/gu,'')
    .replace(/[–‑—]/g,'-').replace(/[_\[\]|\/#→←]/g,' ').replace(/[“”]/g,'"').replace(/[‘’´`]/g,"'").replace(/[♥☆♡©\\]/g,'')
    .replaceAll('@',' at ').replaceAll('e.g.,','for example, ').replaceAll('i.e.,','that is, ')
    .replace(/\s+([,.!?;:'])/g,'$1').replace(/"{2,}/g,'"').replace(/'{2,}/g,"'").replace(/\s+/g,' ').trim();
  if(!value)return '';
  if(!/[.!?;:,'"')\]}…。」』】〉》›»]$/.test(value))value+='.';
  return `<${lang}>${value}</${lang}>`;
}

/** Small chunks bound latent/audio memory. Upstream recommends <=300 chars
 * (120 for Korean/Japanese); the reader usually already supplies one sentence. */
export function supertonicTextChunks(text,lang) {
  const chars=Array.from(String(text||'').trim()),limit=['ko','ja'].includes(lang)?120:300,chunks=[];
  for(let start=0;start<chars.length;) {
    let end=Math.min(chars.length,start+limit);
    if(end<chars.length)for(let i=end;i>start+limit/2;i--)if(/[\s.!?;。！？]/u.test(chars[i-1])){end=i;break;}
    const chunk=chars.slice(start,end).join('').trim();if(chunk)chunks.push(chunk);start=end;
  }
  return chunks;
}

/** ONNX Runtime is injected by the existing synthesis worker. Four sessions,
 * one active utterance; no engine/download/UI dependency enters this module. */
export async function createSupertonicRuntime({ort,buffers,config,indexer,styles,steps=SUPERTONIC_STEPS,random=Math.random,yieldToMessages=yieldTask}={}) {
  if(!ort?.InferenceSession||!ort.Tensor||!Array.isArray(indexer))throw new Error('Configuración Supertonic inválida');
  const sampleRate=Number(config?.ae?.sample_rate),chunkSize=Number(config?.ae?.base_chunk_size)*Number(config?.ttl?.chunk_compress_factor),latentDim=Number(config?.ttl?.latent_dim)*Number(config?.ttl?.chunk_compress_factor);
  if(!Number.isInteger(sampleRate)||sampleRate<8000||sampleRate>96000||!Number.isInteger(chunkSize)||chunkSize<1||!Number.isInteger(latentDim)||latentDim<1||latentDim>1024)throw new Error('Dimensiones Supertonic inválidas');
  if(!Number.isInteger(steps)||steps<2||steps>16)throw new Error('Pasos Supertonic inválidos');
  const sessions={},styleTensors={};let disposed=false,running=null;
  const releaseTensor=t=>{try{t?.dispose?.();}catch{}};
  const releaseAll=async()=>{for(const style of Object.values(styleTensors)){releaseTensor(style.ttl);releaseTensor(style.dp);}for(const session of Object.values(sessions))await session.release?.();};
  try {
    for(const name of ['duration_predictor','text_encoder','vector_estimator','vocoder']) {
      if(!buffers?.[name]?.byteLength)throw new Error(`Falta el modelo ${name}`);
      sessions[name]=await ort.InferenceSession.create(buffers[name],{executionProviders:['wasm'],graphOptimizationLevel:'all',enableCpuMemArena:false,enableMemPattern:false});
    }
    buffers=null;
    for(const name of SUPERTONIC_LEGACY_STYLES)if(!styles?.[name])throw new Error(`Falta el estilo ${name}`);
    for(const name of SUPERTONIC_STYLES.filter(name=>styles?.[name])) {
      const raw=styles[name];
      const tensors={};styleTensors[name]=tensors;
      for(const [key,field]of [['ttl','style_ttl'],['dp','style_dp']]) {
        const source=raw[field],dims=source?.dims,data=source?.data?.flat(Infinity);
        if(!Array.isArray(dims)||dims.length!==3||dims[0]!==1||dims.some(n=>!Number.isInteger(n)||n<1)||!data||data.length!==dims.reduce((a,b)=>a*b,1)||data.some(n=>!Number.isFinite(n)))throw new Error(`Estilo ${name} inválido`);
        tensors[key]=new ort.Tensor('float32',new Float32Array(data),dims);
      }
    }
  } catch(error){await releaseAll();throw error;}

  async function infer(text,{lang,style,rate,isActive}) {
    const live=new Set(),own=t=>{live.add(t);return t;},drop=t=>{if(live.delete(t))releaseTensor(t);};
    const check=()=>{if(disposed||!isActive())throw cancelled();};
    const checkpoint=async()=>{await yieldToMessages();check();};
    const run=async(name,feeds)=>{check();const output=await sessions[name].run(feeds);for(const t of Object.values(output))own(t);check();return output;};
    try {
      check();const normalized=normalizeSupertonicText(text,lang);if(!normalized)return new Float32Array();
      const characters=Array.from(normalized),ids=BigInt64Array.from(characters,char=>BigInt(indexer[char.codePointAt(0)]??-1));
      const textIds=own(new ort.Tensor('int64',ids,[1,ids.length])),textMask=own(new ort.Tensor('float32',new Float32Array(ids.length).fill(1),[1,1,ids.length]));
      const selected=styleTensors[style],dp=await run('duration_predictor',{text_ids:textIds,style_dp:selected.dp,text_mask:textMask});
      const seconds=Number(dp.duration?.data?.[0])/rate;drop(dp.duration);
      if(!Number.isFinite(seconds)||seconds<=0||seconds>40)throw new Error('Duración de audio fuera de rango');
      await checkpoint();
      const encoded=await run('text_encoder',{text_ids:textIds,style_ttl:selected.ttl,text_mask:textMask});
      const frames=Math.ceil(Math.floor(seconds*sampleRate)/chunkSize),shape=[1,latentDim,frames];
      const noise=new Float32Array(latentDim*frames);
      for(let i=0;i<noise.length;i++)noise[i]=Math.sqrt(-2*Math.log(Math.max(.0001,random())))*Math.cos(2*Math.PI*random());
      let latent=own(new ort.Tensor('float32',noise,shape));
      const latentMask=own(new ort.Tensor('float32',new Float32Array(frames).fill(1),[1,1,frames]));
      const totalStep=own(new ort.Tensor('float32',Float32Array.of(steps),[1]));
      for(let step=0;step<steps;step++) {
        await checkpoint();const currentStep=own(new ort.Tensor('float32',Float32Array.of(step),[1]));
        const output=await run('vector_estimator',{noisy_latent:latent,text_emb:encoded.text_emb,style_ttl:selected.ttl,latent_mask:latentMask,text_mask:textMask,current_step:currentStep,total_step:totalStep});
        if(!output.denoised_latent)throw new Error('El modelo no generó audio');
        drop(latent);drop(currentStep);latent=output.denoised_latent;
      }
      await checkpoint();const output=await run('vocoder',{latent});
      if(!output.wav_tts?.data?.length)throw new Error('El modelo devolvió audio vacío');
      const pcm=new Float32Array(output.wav_tts.data.slice(0,Math.floor(seconds*sampleRate)));
      if(pcm.some(value=>!Number.isFinite(value)))throw new Error('El modelo devolvió audio inválido');
      return pcm;
    } finally{for(const tensor of live)releaseTensor(tensor);}
  }
  return {
    sampleRate,
    synthesize(text,{lang,style='F1',rate=1,isActive=()=>true}={}) {
      if(disposed)return Promise.reject(cancelled());if(running)return Promise.reject(new Error('Síntesis ya en curso'));
      if(!SUPERTONIC_LANGUAGES.includes(lang)||!styleTensors[style]||!Number.isFinite(rate)||rate<.5||rate>2)return Promise.reject(new Error('Opciones de voz inválidas'));
      const job=(async()=>{const chunks=supertonicTextChunks(text,lang),parts=[];let length=0;
        if(chunks.length>32)throw new Error('Texto de voz demasiado largo');
        for(const chunk of chunks){const pcm=await infer(chunk,{lang,style,rate,isActive});if(!pcm.length)continue;if(parts.length){const gap=new Float32Array(Math.floor(sampleRate*.15));parts.push(gap);length+=gap.length;}parts.push(pcm);length+=pcm.length;}
        if(disposed||!isActive())throw cancelled();const pcm=new Float32Array(length);let offset=0;for(const part of parts){pcm.set(part,offset);offset+=part.length;}return{pcm,sampleRate};
      })();running=job;job.finally(()=>{if(running===job)running=null;}).catch(()=>{});return job;
    },
    async dispose(){if(disposed)return;disposed=true;await running?.catch(()=>{});await releaseAll();}
  };
}
