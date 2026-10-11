// @vitest-environment node
import { readFileSync } from 'node:fs';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
const state=vi.hoisted(()=>({core:null}));
vi.mock('../../src/js/rust-core.js',async original=>{
  const actual=await original();return {...actual,getRustCore:()=>state.core||actual.getRustCore()};
});
import { loadRustCore } from '../../src/js/rust-core.js';
import { prepareColorMaskJob } from '../../src/js/cover-color-mask-wasm.js';
import * as production from '../../src/js/cover-relief.js';
import * as frozen from './helpers/reference-relief-color.js';
import { colorMaskCases, colorMaskPalette, makeColorMaskImage, colorMaskSelection } from '../helpers/color-mask-cases.mjs';

let core, stats;
const drain=task=>{let step;do{step=task.next();}while(!step.done);return step.value;};
const bytes=array=>Buffer.from(array.buffer,array.byteOffset,array.byteLength);
const rgb=color=>[1,3,5].map(at=>parseInt(color.slice(at,at+2),16));
const lab=color=>frozen.internals.rgbToOklab(...rgb(color));
function exact(actual,expected,label='value') {
  if(ArrayBuffer.isView(expected)){
    expect(actual?.constructor,label).toBe(expected.constructor);expect(actual.length,label).toBe(expected.length);
    expect(Buffer.compare(bytes(actual),bytes(expected)),`${label} complete bytes`).toBe(0);
  }else if(expected&&typeof expected==='object'){
    expect(Object.keys(actual).sort(),label).toEqual(Object.keys(expected).sort());
    for(const key of Object.keys(expected))exact(actual[key],expected[key],`${label}.${key}`);
  }else expect(actual,label).toBe(expected);
}
function trackedCore(overrides={}) {
  return {...core,
    alloc_f64(length){const pointer=core.alloc_f64(length);if(pointer){stats.allocations.push([pointer,length]);stats.live+=length*8;stats.peak=Math.max(stats.peak,stats.live);}return pointer;},
    free_f64(pointer,length){core.free_f64(pointer,length);stats.releases.push([pointer,length]);stats.live-=length*8;},
    relief_color_mask_pixels(...args){stats.classify++;return core.relief_color_mask_pixels(...args);},
    relief_distance_rows(...args){stats.distance++;return core.relief_distance_rows(...args);},
    ...overrides};
}
beforeAll(async()=>{
  core=await loadRustCore({bytes:readFileSync(new URL('../../src/wasm/inhouse_read_core.wasm',import.meta.url))});
  expect(typeof core?.relief_color_mask_pixels).toBe('function');
});
beforeEach(()=>{stats={live:0,peak:0,classify:0,distance:0,allocations:[],releases:[]};state.core=trackedCore();});
afterEach(()=>{expect(stats.live,'all prepared/distance arenas released').toBe(0);state.core=null;});

describe('compiled prepared OKLab masks preserve complete original map decisions',()=>{
  for(const input of colorMaskCases)it(`keeps complete membership f32 bytes for ${input.name}`,()=>{
    const image=makeColorMaskImage(input),job=drain(prepareColorMaskJob(state.core,image,frozen.internals.rgbToOklab));
    expect(job).not.toBeNull();
    try{
      for(const color of colorMaskPalette)for(const tolerance of [1,5.4,6,12]){
        exact(drain(job.mask(lab(color),tolerance)),drain(frozen.internals.colorMask(image,color,tolerance)),`${color}/${tolerance}`);
      }
    }finally{job.dispose();}
    expect(stats.classify).toBeGreaterThan(0);
  });
  for(const [input,layers] of [[colorMaskCases[1],3],[colorMaskCases[2],5],[colorMaskCases[3],10],
    [colorMaskCases[4],3],[colorMaskCases[6],10]])it(`preserves owners, physical heights, gloss, foil and rendered channels for ${input.name}/${layers}`,()=>{
    const image=makeColorMaskImage(input),selection=colorMaskSelection(layers),before=Buffer.from(bytes(image.data));
    const expected=drain(frozen.buildMapsFromPixels(image,image,selection));
    const actual=drain(production.buildMapsFromPixels(image,image,selection));
    exact(actual,expected,'full map');expect(stats.classify).toBeGreaterThan(0);
    exact(drain(production.heightToNormals(actual)),drain(frozen.heightToNormals(expected)),'normal RGBA');
    exact(drain(production.composeMaterialMap(actual)),drain(frozen.composeMaterialMap(expected)),'material RGBA');
    expect(bytes(image.data)).toEqual(before);
  });
  it('preserves the complete proposal analysis with actual masks and coverage',()=>{
    const image=makeColorMaskImage(colorMaskCases[1]);
    const expected=drain(frozen.analyzePixels(image)),actual=drain(production.analyzePixels(image));
    exact(actual,expected,'analysis');expect(actual.chosen.length).toBeGreaterThanOrEqual(3);
    expect(stats.classify).toBeGreaterThan(0);
  });
  it('keeps canonical color ordering and strict overlap ties, even for zero-strength owners',()=>{
    const image=makeColorMaskImage({width:128,height:128,kind:'overlap'}),selection=colorMaskSelection(3,{overlap:true});
    const expected=drain(frozen.buildMapsFromPixels(image,image,selection));
    const actual=drain(production.buildMapsFromPixels(image,image,selection));
    exact(actual,expected);expect(actual.owners[8192]).toBe(1);expect(actual.mask[8192]).toBe(0);
    exact(drain(production.buildMapsFromPixels(image,image,{layers:[...selection.layers].reverse()})),expected);
  });
  it('retains one/two-color and small preview paths without a prepared classifier',()=>{
    const image=makeColorMaskImage(colorMaskCases[1]);
    for(const selection of [colorMaskSelection(1).layers[0],colorMaskSelection(1),colorMaskSelection(2)]){
      exact(drain(production.buildMapsFromPixels(image,image,selection)),drain(frozen.buildMapsFromPixels(image,image,selection)));
    }
    const preview=makeColorMaskImage(colorMaskCases[0]),selection=colorMaskSelection(10);
    exact(drain(production.buildMapsFromPixels(preview,preview,selection)),drain(frozen.buildMapsFromPixels(preview,preview,selection)));
    expect(stats.classify).toBe(0);
  });
  it('recomposes changed strengths from saved classification without preparing Lab again',()=>{
    const image=makeColorMaskImage(colorMaskCases[1]),selection=colorMaskSelection(5);
    const maps=drain(production.buildMapsFromPixels(image,image,selection));
    const changed={layers:selection.layers.map((layer,index)=>({...layer,strength:index%2?.93:.12}))};
    const before=stats.classify;
    exact(drain(production.composeReliefLayerPixels(maps,changed)),drain(frozen.composeReliefLayerPixels(maps,changed)));
    expect(stats.classify).toBe(before);
  });
  it('releases prepared Lab before the separate material composition allocates its arena',()=>{
    const image=makeColorMaskImage(colorMaskCases[1]),selection=colorMaskSelection(3);
    const preparedLength=(128*128*25+4096)/8;let observed=false,released=true;
    state.core=trackedCore({relief_compose_pixels(...args){
      observed=true;
      const allocation=stats.allocations.find(([,length])=>length===preparedLength);
      released&&=!!allocation&&stats.releases.some(([pointer,length])=>pointer===allocation[0]&&length===allocation[1]);
      return core.relief_compose_pixels(...args);
    }});
    drain(production.buildMapsFromPixels(image,image,selection));expect(observed).toBe(true);expect(released).toBe(true);
  });
  it('falls back immediately for a concurrent prepared job and acquires again after release',()=>{
    const image=makeColorMaskImage(colorMaskCases[1]),selection=colorMaskSelection(3);
    const held=drain(prepareColorMaskJob(state.core,image,frozen.internals.rgbToOklab));
    try{
      expect(drain(prepareColorMaskJob(state.core,image,frozen.internals.rgbToOklab))).toBeNull();
      exact(drain(production.buildMapsFromPixels(image,image,selection)),drain(frozen.buildMapsFromPixels(image,image,selection)));
      expect(stats.classify).toBe(0);
    }finally{held.dispose();}
    drain(production.buildMapsFromPixels(image,image,selection));expect(stats.classify).toBeGreaterThan(0);
  });
  it('recreates preparation and classification views after unrelated WASM memory growth',()=>{
    const image=makeColorMaskImage(colorMaskCases[1]),task=prepareColorMaskJob(state.core,image,frozen.internals.rgbToOklab);
    expect(task.next().done).toBe(false);core.memory.grow(1);const job=drain(task);
    try{
      const mask=job.mask(lab('#2f6b4f'),6);expect(mask.next().done).toBe(false);core.memory.grow(1);
      const result=drain(mask);exact(result,drain(frozen.internals.colorMask(image,'#2f6b4f',6)));
      const snapshot=Buffer.from(bytes(result));core.memory.grow(1);expect(bytes(result)).toEqual(snapshot);
      expect(result.buffer).not.toBe(core.memory.buffer);
    }finally{job.dispose();}
  });
  it('rejects RGBA views into WASM memory before allocating or converting',()=>{
    const pointer=core.alloc_f64(20),convert=vi.fn(frozen.internals.rgbToOklab);
    expect(pointer).toBeGreaterThan(0);
    try{
      for(const ArrayType of [Uint8Array,Uint8ClampedArray]){
        const data=new ArrayType(core.memory.buffer,pointer+8,8*4*4);data.fill(128);
        expect(drain(prepareColorMaskJob(state.core,{width:8,height:4,data},convert))).toBeNull();
      }
      expect(stats.allocations).toHaveLength(0);expect(stats.classify).toBe(0);expect(convert).not.toHaveBeenCalled();
    }finally{core.free_f64(pointer,20);}
    const image=makeColorMaskImage(colorMaskCases[0]),job=drain(prepareColorMaskJob(state.core,image,frozen.internals.rgbToOklab));
    expect(job).not.toBeNull();job.dispose();
  });
  it('reacquires preparation views when conversion grows WASM memory inside a chunk',()=>{
    const image=makeColorMaskImage(colorMaskCases[1]),before=Buffer.from(bytes(image.data));let conversions=0,growths=0;
    const job=drain(prepareColorMaskJob(state.core,image,(...components)=>{
      if([1,1023,1024,1025].includes(++conversions)){core.memory.grow(1);growths++;}
      return frozen.internals.rgbToOklab(...components);
    }));
    expect(job).not.toBeNull();expect(growths).toBe(4);
    try{
      for(const color of colorMaskPalette)exact(drain(job.mask(lab(color),6)),drain(frozen.internals.colorMask(image,color,6)),color);
      expect(bytes(image.data)).toEqual(before);expect(stats.classify).toBeGreaterThan(0);
    }finally{job.dispose();}
  });
  it('releases immediately on preparation .return, preparation error and mask .return',()=>{
    const image=makeColorMaskImage(colorMaskCases[1]);
    const pending=prepareColorMaskJob(state.core,image,frozen.internals.rgbToOklab);pending.next();expect(stats.live).toBeGreaterThan(0);
    pending.return();expect(stats.live).toBe(0);
    expect(drain(prepareColorMaskJob(state.core,image,()=>{throw new Error('conversion failed');}))).toBeNull();expect(stats.live).toBe(0);
    const job=drain(prepareColorMaskJob(state.core,image,frozen.internals.rgbToOklab)),mask=job.mask(lab('#111111'),6);
    mask.next();expect(stats.live).toBeGreaterThan(0);mask.return();expect(stats.live).toBe(0);
    expect(drain(job.mask(lab('#111111'),6))).toBeNull();job.dispose();
  });
  it('does not resume a freed job after explicit dispose during a yielded mask',()=>{
    const image=makeColorMaskImage(colorMaskCases[1]),job=drain(prepareColorMaskJob(state.core,image,frozen.internals.rgbToOklab));
    const mask=job.mask(lab('#111111'),6);mask.next();job.dispose();const calls=stats.classify;
    expect(drain(mask)).toBeNull();expect(stats.classify).toBe(calls);
  });
  for(const phase of ['prepare','classify','distance'])it(`frees the entire full-map job when cancelled during ${phase}`,()=>{
    const image=makeColorMaskImage(colorMaskCases[1]),task=production.buildMapsFromPixels(image,image,colorMaskSelection(5));
    let step;
    do{step=task.next();}while(!step.done&&(phase==='prepare'?stats.live===0:phase==='classify'?stats.classify===0:stats.distance===0));
    expect(step.done).toBe(false);expect(stats.live).toBeGreaterThan(0);task.return();expect(stats.live).toBe(0);
    const after=drain(prepareColorMaskJob(state.core,image,frozen.internals.rgbToOklab));expect(after).not.toBeNull();after.dispose();
  });
  it('falls back to complete original maps after a rejected or exceptional mid-mask kernel',()=>{
    const image=makeColorMaskImage(colorMaskCases[1]),selection=colorMaskSelection(3),expected=drain(frozen.buildMapsFromPixels(image,image,selection));
    for(const failure of ['reject','throw']){
      let calls=0;
      state.core=trackedCore({relief_color_mask_pixels(...args){calls++;if(calls===2){if(failure==='throw')throw new WebAssembly.RuntimeError('trap');return 0;}return core.relief_color_mask_pixels(...args);}});
      exact(drain(production.buildMapsFromPixels(image,image,selection)),expected);expect(calls).toBe(2);expect(stats.live).toBe(0);
    }
  });
  it('bounds scratch storage and releases allocation failures without keeping the lease',()=>{
    const image=makeColorMaskImage(colorMaskCases[1]);
    for(const alloc_f64 of [()=>0,()=>{throw new RangeError('exhausted');}])expect(drain(prepareColorMaskJob({...core,alloc_f64},image,frozen.internals.rgbToOklab))).toBeNull();
    expect(drain(prepareColorMaskJob(null,image,frozen.internals.rgbToOklab))).toBeNull();
    expect(drain(prepareColorMaskJob(state.core,{width:513,height:512,data:new Uint8Array(513*512*4)},frozen.internals.rgbToOklab))).toBeNull();
    const job=drain(prepareColorMaskJob(state.core,image,frozen.internals.rgbToOklab));
    expect(stats.live).toBe(128*128*25+4096);job.dispose();expect(stats.live).toBe(0);
  });
});
