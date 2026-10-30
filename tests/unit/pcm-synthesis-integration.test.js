// @vitest-environment node
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { beforeAll, afterEach, expect, it, vi } from 'vitest';
const state=vi.hoisted(()=>({core:null,calls:0,raw:null}));
vi.mock('../../src/js/rust-voice-core.js',()=>({requireRustVoiceCore:async()=>state.core,loadedRustVoiceCore:()=>state.core,loadRustVoiceCore:async()=>state.core,getRustVoiceCore:()=>state.core}));
vi.mock('../../src/js/readers/neural-voice/phonemizer.js',()=>({createPhonemizer:async()=>({phonemize:async()=>[1,0,4,0,2],destroy(){}})}));
vi.mock('../../src/js/readers/neural-voice/supertonic-runtime.js',()=>({createSupertonicRuntime:async()=>({
  synthesize:async()=>({pcm:state.raw.slice(),sampleRate:24000}),dispose(){}})}));
// The client's preparation, job chain and synthesis loop are rust-ui: the module is loaded as the reader loads it.
import './helpers/rust-ui-ready.js'
import { NativeSynthClient } from '../../src/js/readers/neural-voice/native-client.js';
import { NativeTensor } from '../../src/js/readers/neural-voice/native-ort.js';
import { peakNormalize,trimSilence,fadeEdges,silence,concat,pauseAfter,restScale } from './helpers/reference-pcm.js';
import { makePCM } from '../helpers/pcm-cases.mjs';
import { speechTempoJS } from './helpers/reference-speech-tempo.js';
beforeAll(async()=>{
  const {instance}=await WebAssembly.instantiate(readFileSync(new URL('../../src/wasm/inhouse_read_voice.wasm',import.meta.url)));
  const core=instance.exports;expect(typeof core.voice_finish_piper).toBe('function');
  // One call finishes a chunk, whichever route and runtime asked for it.
  state.core={...core,voice_finish_piper(...args){state.calls++;return core.voice_finish_piper(...args);},
    voice_finish_supertonic(...args){state.calls++;return core.voice_finish_supertonic(...args);}};
});
afterEach(()=>vi.unstubAllGlobals());
for(const runtime of ['piper','supertonic3'])for(const route of ['worker','native'])
it(`executes compiled Rust in ${route}/${runtime}, retaining full chunk bytes, timings and protocol`,async()=>{
  state.calls=0;state.raw=makePCM({count:66150,amplitude:.033});
  const messages=[],config=runtime==='piper'?{audio:{sample_rate:22050},espeak:{voice:'no'},num_symbols:256}:
    {runtime:'supertonic3',config:{},indexer:[1],styles:{F1:{}}};
  const session={inputNames:['input'],outputNames:['output'],release:async()=>{},
    run:async()=>({output:{data:state.raw.slice(),dispose(){}}})};
  const text='One complete sentence.',rate=1.25,key='no_NO-nvcc-medium';
  let cleanup;
  if(route==='worker'){
    const scope={postMessage:message=>messages.push(message)};
    vi.stubGlobal('self',scope);vi.stubGlobal('__neuralOrt',{create:async()=>session});
    // One module instance, with the worker protocol's explicit init/load/free.
    await import('../../src/js/readers/neural-voice/worker.js');
    const send=data=>scope.onmessage({data});
    // Imports are cached on the second case; restore the original handler.
    if(!scope.onmessage)scope.onmessage=state.workerHandler;else state.workerHandler=scope.onmessage;
    await send({type:'init',id:1,ortBase:pathToFileURL(resolve('tests/unit/fixtures/neural-ort')+'/').href,phonBase:'https://test/',runtime});
    await send({type:'load',id:2,voice:key,config,model:new ArrayBuffer(8),buffers:{}});
    await send({type:'synth',id:3,text,rate,lang:'en',style:'F1'});
    cleanup=()=>send({type:'free',id:4});
  }else{
    const ort={Tensor:NativeTensor,dispose(){},InferenceSession:{create:async()=>session}};
    const client=new NativeSynthClient({store:{readConfig:async()=>config,readModel:async()=>new ArrayBuffer(8),readRuntimeAssets:async()=>({})},
      createOrt:()=>ort,createPhon:async()=>({phonemize:async()=>[1,0,4,0,2],destroy(){}})});
    await client.prepare(key);
    client.synth({text,rate,lang:'en',style:'F1'},{onChunk:chunk=>messages.push({type:'chunk',...chunk}),
      onEnd:()=>messages.push({type:'end'}),onError:error=>messages.push({type:'error',error})});
    cleanup=()=>client.dispose();
  }
  try{
    await vi.waitFor(()=>expect(messages.some(m=>m.type==='end')).toBe(true));
    expect(messages.filter(m=>m.type==='error')).toEqual([]);expect(state.calls).toBe(1);
    const chunks=messages.filter(m=>m.type==='chunk');expect(chunks).toHaveLength(1);
    const sr=runtime==='piper'?22050:24000,raw=state.raw.slice();peakNormalize(raw,{model:runtime==='piper'?key:''});
    const normal=fadeEdges(trimSilence(raw,sr),sr);
    // The Supertonic mock already represents its runtime's speed-processed
    // result. Piper now generates normal speech and applies tempo afterward.
    const speech=runtime==='piper'?speechTempoJS(normal,sr,rate).pcm:normal;
    const expected=concat([speech,silence(sr,pauseAfter(text)*restScale(rate))]);
    const actual=chunks[0].pcm;
    expect(Buffer.compare(Buffer.from(actual.buffer,actual.byteOffset,actual.byteLength),Buffer.from(expected.buffer))).toBe(0);
    expect(chunks[0]).toMatchObject({index:0,last:true,sampleRate:sr});expect(Number.isFinite(chunks[0].ms)).toBe(true);
    expect(actual.buffer).not.toBe(state.core.memory.buffer);
  }finally{await cleanup();}
});
