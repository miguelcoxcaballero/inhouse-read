import {describe,it,expect,vi} from 'vitest';
import {createSupertonicRuntime,normalizeSupertonicText,supertonicTextChunks} from '../../src/js/readers/neural-voice/supertonic-runtime.js';
import {SUPERTONIC_STYLES,SUPERTONIC_LEGACY_STYLES,supertonicVoicesFor,SUPERTONIC_ASSETS,SUPERTONIC_BYTES,SUPERTONIC_LEGACY_ASSETS,isSupertonicVoiceId} from '../../src/js/readers/neural-voice/supertonic-catalog.js';

function fixture(overrides={}) {
  const tensors=[],sessions=[];
  class Tensor {constructor(type,data,dims){Object.assign(this,{type,data,dims});this.dispose=vi.fn();tensors.push(this);}}
  const names=['duration_predictor','text_encoder','vector_estimator','vocoder'];
  const create=vi.fn(async(_bytes,options)=>{const name=names[sessions.length];const session={name,options,release:vi.fn(async()=>{}),run:vi.fn(async feeds=>{
    await overrides.beforeRun?.(name,feeds);
    if(name==='duration_predictor')return{duration:new Tensor('float32',Float32Array.of(overrides.duration??.1),[1])};
    if(name==='text_encoder')return{text_emb:new Tensor('float32',Float32Array.of(1,2),[1,2])};
    if(name==='vector_estimator')return{denoised_latent:new Tensor('float32',new Float32Array(feeds.noisy_latent.data),feeds.noisy_latent.dims)};
    return{wav_tts:new Tensor('float32',new Float32Array(10000).fill(.25),[1,10000])};
  })};sessions.push(session);return session;});
  const style={style_ttl:{dims:[1,1,2],data:[[[.1,.2]]]},style_dp:{dims:[1,1,2],data:[[[.3,.4]]]}};
  const args={ort:{Tensor,InferenceSession:{create}},buffers:Object.fromEntries(names.map(n=>[n,new ArrayBuffer(4)])),config:{ae:{sample_rate:8000,base_chunk_size:16},ttl:{chunk_compress_factor:2,latent_dim:2}},indexer:Array.from({length:65536},(_,i)=>i),styles:Object.fromEntries(SUPERTONIC_STYLES.map(n=>[n,style])),steps:2,random:()=>.5,yieldToMessages:async()=>{}};
  return{args,tensors,sessions,create};
}

describe('Supertonic immutable catalogue',()=>{
  it('offers real styles under generic language tags and shares one pack',()=>{
    const voices=supertonicVoicesFor(['es-MX','es-AR','en-GB','ca','he','sr','zh']);
    expect(voices).toHaveLength(20);expect(new Set(voices.map(v=>v.lang))).toEqual(new Set(['es','en']));
    expect(new Set(voices.map(v=>v.modelKey))).toEqual(new Set(['supertonic3']));expect(new Set(voices.map(v=>v.id)).size).toBe(20);
    expect(SUPERTONIC_ASSETS).toHaveLength(17);expect(SUPERTONIC_BYTES).toBe(210204134);
    expect(SUPERTONIC_LEGACY_ASSETS).toHaveLength(10);
    expect(SUPERTONIC_LEGACY_ASSETS.reduce((sum,a)=>sum+a.bytes,0)).toBe(208164809);
    expect(SUPERTONIC_STYLES).toHaveLength(10);
    for(const voice of voices)expect(isSupertonicVoiceId(voice.id)).toBe(true);
    expect(isSupertonicVoiceId('supertonic3:F6:es')).toBe(false);
    const vector=SUPERTONIC_ASSETS.find(a=>a.path==='onnx/vector_estimator.onnx');
    expect(vector.bytes).toBe(65447164);expect(vector.url).toContain('/askurios8/supertonic-3-int8/resolve/95618f5d61cef4923c3b802a332fd603723718f7/');
    expect(SUPERTONIC_ASSETS.find(a=>a.path==='onnx/vocoder.onnx').sha256).toBe('085de76dd8e8d5836d6ca66826601f615939218f90e519f70ee8a36ed2a4c4ba');
    for(const a of SUPERTONIC_ASSETS)expect(a.sha256).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe('Supertonic inference lifecycle',()=>{
  it('keeps the complete legacy three-profile pack usable offline and rejects an absent new style',async()=>{
    const f=fixture();f.args.styles=Object.fromEntries(SUPERTONIC_LEGACY_STYLES.map(name=>[name,f.args.styles[name]]));
    const runtime=await createSupertonicRuntime(f.args);
    expect((await runtime.synthesize('Hola',{lang:'es',style:'F2'})).pcm.length).toBeGreaterThan(0);
    await expect(runtime.synthesize('Hola',{lang:'es',style:'F3'})).rejects.toThrow('Opciones');
    await runtime.dispose();expect(f.sessions.every(session=>session.release.mock.calls.length===1)).toBe(true);
  });
  it('normalizes upstream punctuation, rejects absent languages and preserves supported script',()=>{
    expect(normalizeSupertonicText(' hola_mundo 😀 ','es')).toBe('<es>hola mundo.</es>');
    expect(normalizeSupertonicText('مرحبا بالعالم','ar')).toContain('مرحبا');
    expect(()=>normalizeSupertonicText('hello','he')).toThrow('Idioma');
    expect(normalizeSupertonicText('😀','en')).toBe('');
  });
  it('bounds chunks without losing text or cutting surrogate pairs',()=>{
    const text='Palabra larga. '.repeat(100);const chunks=supertonicTextChunks(text,'es');
    expect(chunks.every(c=>Array.from(c).length<=300)).toBe(true);expect(chunks.join(' ')).toBe(text.trim());
    expect(supertonicTextChunks('あ'.repeat(250),'ja').map(c=>c.length)).toEqual([120,120,10]);
  });
  it('creates four WASM sessions and returns finite PCM after the exact denoising steps',async()=>{
    const f=fixture(),runtime=await createSupertonicRuntime(f.args);
    const result=await runtime.synthesize('Hola',{lang:'es',style:'M1',rate:1});
    expect(result.sampleRate).toBe(8000);expect(result.pcm).toHaveLength(800);expect(result.pcm[0]).toBe(.25);
    expect(f.sessions[2].run).toHaveBeenCalledTimes(2);
    expect(f.sessions.every(s=>s.options.enableCpuMemArena===false&&s.options.enableMemPattern===false)).toBe(true);
    expect(f.tensors.filter(t=>!t.dispose.mock.calls.length)).toHaveLength(SUPERTONIC_STYLES.length*2);
    await runtime.dispose();await runtime.dispose();expect(f.tensors.every(t=>t.dispose.mock.calls.length===1)).toBe(true);expect(f.sessions.every(s=>s.release.mock.calls.length===1)).toBe(true);
  });
  it('uses speed in predicted duration and retains the selected style',async()=>{
    const f=fixture(),runtime=await createSupertonicRuntime(f.args);
    // 2x keeps a 15% margin so the end of the sentence is not swallowed: 0.1 s / 2 * 1.15, whole frames of 32 samples.
    expect((await runtime.synthesize('Hola',{lang:'es',style:'F2',rate:2})).pcm).toHaveLength(480);
    expect(f.sessions[0].run.mock.calls[0][0].style_dp).toBe(f.tensors[5]);await runtime.dispose();
  });
  it('uses the verified six-step quality profile when the worker leaves steps unspecified',async()=>{
    const f=fixture();delete f.args.steps;const runtime=await createSupertonicRuntime(f.args);
    await runtime.synthesize('Goedemorgen',{lang:'nl',style:'F2'});
    expect(f.sessions[2].run).toHaveBeenCalledTimes(6);await runtime.dispose();
  });
  it('cancels after an inference boundary, releases intermediate tensors and never invokes the vocoder',async()=>{
    let active=true;const f=fixture({beforeRun:name=>{if(name==='vector_estimator')active=false;}}),runtime=await createSupertonicRuntime(f.args);
    await expect(runtime.synthesize('Hola',{lang:'es',isActive:()=>active})).rejects.toMatchObject({code:'aborted'});
    expect(f.sessions[3].run).not.toHaveBeenCalled();expect(f.tensors.filter(t=>!t.dispose.mock.calls.length)).toHaveLength(SUPERTONIC_STYLES.length*2);await runtime.dispose();
  });
  it('rejects overlapping jobs and waits for active inference before releasing sessions',async()=>{
    let resolve,entered;const ready=new Promise(r=>entered=r),gate=new Promise(r=>resolve=r);
    const f=fixture({beforeRun:async name=>{if(name==='duration_predictor'){entered();await gate;}}}),runtime=await createSupertonicRuntime(f.args);
    const result=runtime.synthesize('Hola',{lang:'es'});await ready;
    await expect(runtime.synthesize('Otra',{lang:'es'})).rejects.toThrow('curso');const dispose=runtime.dispose();expect(f.sessions[0].release).not.toHaveBeenCalled();resolve();
    await expect(result).rejects.toMatchObject({code:'aborted'});await dispose;expect(f.sessions.every(s=>s.release.mock.calls.length===1)).toBe(true);
  });
  it('cleans up created sessions when initialization fails midway',async()=>{
    const f=fixture();f.create.mockImplementationOnce(async()=>{const session={release:vi.fn(async()=>{})};f.sessions.push(session);return session;}).mockRejectedValueOnce(Error('compile'));
    await expect(createSupertonicRuntime(f.args)).rejects.toThrow('compile');expect(f.sessions[0].release).toHaveBeenCalledOnce();
  });
  it('rejects unsupported style/rate and excessive predicted audio before allocating a huge latent',async()=>{
    const f=fixture({duration:1000}),runtime=await createSupertonicRuntime(f.args);
    await expect(runtime.synthesize('Hola',{lang:'es',style:'fake'})).rejects.toThrow('Opciones');
    await expect(runtime.synthesize('Hola',{lang:'es',rate:0})).rejects.toThrow('Opciones');
    await expect(runtime.synthesize('Hola',{lang:'es'})).rejects.toThrow('Duración');expect(f.sessions[2].run).not.toHaveBeenCalled();await runtime.dispose();
  });
});

describe('supertonicSeconds', () => {
  it('divides the predicted duration by the speed, keeping a margin above 1x', async () => {
    const { supertonicSeconds } = await import('../../src/js/readers/neural-voice/supertonic-runtime.js')
    expect(supertonicSeconds(2, 1)).toBe(2)
    expect(supertonicSeconds(2, 0.5)).toBe(4)
    expect(supertonicSeconds(2, 2)).toBeCloseTo(1.15, 5)
    expect(supertonicSeconds(2, 1.5)).toBeCloseTo(2 / 1.5 * 1.075, 5)
  })
})
