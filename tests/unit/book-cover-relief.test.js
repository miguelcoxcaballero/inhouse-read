import { afterEach,beforeEach,expect,it,vi } from 'vitest';
import { createBookModel } from '../../src/js/book-model.js';
import { buildReliefMaps } from '../../src/js/cover-relief.js';

const gates=vi.hoisted(()=>({next:null,taken:false}));
vi.mock('../../src/js/cover-relief.js',async original=>({...await original(),buildReliefMaps:vi.fn()}));
vi.mock('../../src/js/cover-appearance.js',async original=>({ ...await original(),runInSlices:vi.fn(task=>{
  let step;do{step=task.next()}while(!step.done);
  const gate=gates.next;gates.next=null;
  if(gate){gates.taken=true;return gate.promise.then(()=>step.value)}
  return Promise.resolve(step.value);
})}));
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve}};
const maps=()=>({size:{width:2,height:2},normal:new Uint8ClampedArray([128,128,255,255,128,128,255,255,128,128,255,255,128,128,255,255]),
  pixels:{width:2,height:2,foil:new Uint8Array([0,255,0,0]),gloss:new Uint8Array([0,0,255,0])}});
let model,cover;
const book={id:'relief-race',title:'Cover',author:'',coverFinish:'satin'};
const style={color:'#143a2a',shade:'#0e2a1e',ink:'#fffaf0',coverRatio:.66};
beforeEach(()=>{
  gates.next=null;gates.taken=false;
  vi.stubGlobal('ImageData',class {constructor(data,width,height){Object.assign(this,{data,width,height})}});
  vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockImplementation(function(){const canvas=this;return new Proxy({
    measureText:text=>({width:String(text).length*8}),createLinearGradient:()=>({addColorStop(){}}),
    getImageData:(_x,_y,w,h)=>({data:new Uint8ClampedArray(w*h*4)}),
    putImageData:rgba=>{canvas._rgba=rgba.data}
  },{get:(obj,key)=>obj[key]??(()=>{})})});
  vi.mocked(buildReliefMaps).mockReset().mockImplementation(async()=>maps());
  model=createBookModel(book,style,{width:132,height:200,thickness:30});
  cover=model.getObjectByName('front-cover').material[0];
});
afterEach(()=>{model.userData.dispose();vi.restoreAllMocks();vi.unstubAllGlobals()});

it('creates all local finish map slots in neutral from the start',()=>{
  expect(cover.clearcoatNormalMap.image.width).toBe(1);
  expect(cover.roughnessMap).toBe(cover.metalnessMap);
  expect(cover.clearcoatRoughnessMap).toBe(cover.roughnessMap);
});
it('cancels pending map analysis when cleared and leaves neutral textures installed',async()=>{
  const gate=deferred();vi.mocked(buildReliefMaps).mockImplementation(()=>gate.promise);
  const pending=model.userData.setCoverRelief({id:'foil',strength:.75});
  await vi.waitFor(()=>expect(buildReliefMaps).toHaveBeenCalledOnce());
  const signal=vi.mocked(buildReliefMaps).mock.calls[0][2].signal;
  await model.userData.setCoverRelief(null);
  expect(signal?.aborted).toBe(true);
  gate.resolve(maps());expect(await pending).toBe(false);
  expect(cover.clearcoatNormalMap.image.width).toBe(1);
  expect(model.userData.coverRelief()).toBeNull();
});
it('an older material bake cannot overwrite a newer installed choice',async()=>{
  const gate=deferred();gates.next=gate;
  const first=model.userData.setCoverRelief({id:'foil',strength:.75});
  await vi.waitFor(()=>expect(gates.taken).toBe(true));
  expect(await model.userData.setCoverRelief({id:'varnish',strength:.75})).toBe(true);
  const installed=cover.clearcoatMap;
  gate.resolve();expect(await first).toBe(false);
  expect(await model.userData.setCoverRelief({id:'varnish',strength:.5})).toBe(true);
  expect(cover.clearcoatMap).toBe(installed);
  expect(buildReliefMaps).toHaveBeenCalledTimes(2);
});
it('rebakes the local finish when the laminate changes with a relief still selected',async()=>{
  await model.userData.setCoverRelief({id:'varnish',strength:.75});
  expect(cover.clearcoatMap.image._rgba[0]).toBeGreaterThan(0);
  model.userData.updateCoverAppearance({...book,coverFinish:'matte',coverRelief:{id:'varnish',strength:.75}});
  await vi.waitFor(()=>expect(cover.clearcoatMap.image._rgba[0]).toBe(0));
  expect(cover.clearcoatMap.image._rgba[8]).toBe(255);
});
it('regenerates a saved family after replacing the printed cover source',async()=>{
  await model.userData.setCoverRelief({id:'foil',strength:.75});
  const old=vi.mocked(buildReliefMaps).mock.calls[0][0];
  vi.mocked(buildReliefMaps).mockClear();
  model.userData.updateCoverSource(null,{...book,title:'A different printed cover',coverRelief:{id:'foil',strength:.75}},style);
  await vi.waitFor(()=>expect(buildReliefMaps).toHaveBeenCalled());
  expect(vi.mocked(buildReliefMaps).mock.calls[0][0]).not.toBe(old);
});
it('stops analysis on disposal and releases each installed map once',async()=>{
  await model.userData.setCoverRelief({id:'foil',strength:.75});
  const normal=vi.spyOn(cover.clearcoatNormalMap,'dispose'),packed=vi.spyOn(cover.clearcoatMap,'dispose');
  const gate=deferred();vi.mocked(buildReliefMaps).mockImplementation(()=>gate.promise);
  const pending=model.userData.setCoverRelief({id:'frame',strength:.75});
  await vi.waitFor(()=>expect(buildReliefMaps).toHaveBeenCalledTimes(2));
  const signal=vi.mocked(buildReliefMaps).mock.calls[1][2].signal;
  model.userData.dispose();expect(signal?.aborted).toBe(true);
  gate.resolve(maps());expect(await pending).toBe(false);
  expect(normal).toHaveBeenCalledOnce();expect(packed).toHaveBeenCalledOnce();
});

it('regenerates persisted relief when creating a fresh model and leaves old records alone',async()=>{
  expect(buildReliefMaps).not.toHaveBeenCalled();
  expect('coverRelief' in book).toBe(false);
  model.userData.dispose();
  model=createBookModel({...book,coverRelief:{id:'foil',strength:.4}},style,{width:132,height:200,thickness:30});
  cover=model.getObjectByName('front-cover').material[0];
  await vi.waitFor(()=>expect(cover.clearcoatNormalMap.image.width).toBe(2));
  expect(buildReliefMaps).toHaveBeenCalledOnce();
  expect(model.userData.coverRelief()).toEqual({id:'foil',strength:.4});
  expect('coverRelief' in book).toBe(false);
});
