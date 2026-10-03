import { afterEach,beforeEach,expect,it,vi } from 'vitest';
import { createBookModel } from '../../src/js/book-model.js';
import { buildReliefMaps } from '../../src/js/cover-relief.js';
import { ShaderLib, Texture, TextureLoader } from 'three';

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
  pixels:{width:2,height:2,preserveInk:true,mask:new Uint8Array([0,255,255,0]),foil:new Uint8Array(4),gloss:new Uint8Array([0,255,255,0])}});
const choice=(id=1,extra={})=>({id:'color-'+id,color:['#d4a93c','#1f4a78','#6a923d'][id-1],tolerance:4,strength:.75,...extra});
let model,cover;
const book={id:'relief-race',title:'Cover',author:'',coverFinish:'satin'};
const style={color:'#143a2a',shade:'#0e2a1e',ink:'#fffaf0',coverRatio:.66};
beforeEach(()=>{
  gates.next=null;gates.taken=false;
  vi.stubGlobal('ImageData',class {constructor(data,width,height){Object.assign(this,{data,width,height})}});
  vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockImplementation(function(){const canvas=this;return new Proxy({
    measureText:text=>({width:String(text).length*8}),createLinearGradient:()=>({addColorStop(){}}),
    getImageData:(_x,_y,w,h)=>({data:new Uint8ClampedArray(w*h*4)}),
    drawImage:(...args)=>{(canvas._drawCalls??=[]).push(args)},clearRect:(...args)=>{(canvas._clearedRects??=[]).push(args)},
    putImageData:rgba=>{canvas._rgba=rgba.data}
  },{get:(obj,key)=>obj[key]??(()=>{})})});
  vi.mocked(buildReliefMaps).mockReset().mockImplementation(async()=>maps());
  model=createBookModel(book,style,132,200,30);
  cover=model.getObjectByName('front-cover').material[0];
});
afterEach(()=>{model.userData.dispose();vi.restoreAllMocks();vi.unstubAllGlobals()});

it('creates all local finish map slots in neutral from the start',()=>{
  expect(cover.clearcoatNormalMap.image.width).toBe(1);
  expect(cover.roughnessMap).toBe(cover.metalnessMap);
  expect(cover.clearcoatRoughnessMap).toBe(cover.roughnessMap);
});
it('keeps flyouts lazy but arms the editor material once before its first relief choice',async()=>{
  model.userData.dispose();
  model=createBookModel(book,style,132,200,30,null,{eagerRelief:false});
  cover=model.getObjectByName('front-cover').material[0];
  expect(cover.clearcoatNormalMap).toBeNull();
  expect(cover.roughnessMap).toBeNull();
  expect(model.userData.prepareCoverRelief()).toBe(true);
  const version=cover.version, normal=cover.clearcoatNormalMap, packed=cover.roughnessMap;
  expect(normal.image.width).toBe(1);
  expect(model.userData.prepareCoverRelief()).toBe(true);
  expect(cover.clearcoatNormalMap).toBe(normal);
  expect(cover.roughnessMap).toBe(packed);
  expect(cover.version).toBe(version);
  await model.userData.setCoverRelief(choice());
  expect(cover.version).toBe(version);
  model.userData.dispose();
  expect(model.userData.prepareCoverRelief()).toBe(false);
});
it('cancels pending map analysis when cleared and leaves neutral textures installed',async()=>{
  const gate=deferred();vi.mocked(buildReliefMaps).mockImplementation(()=>gate.promise);
  const pending=model.userData.setCoverRelief(choice());
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
  const first=model.userData.setCoverRelief(choice());
  await vi.waitFor(()=>expect(gates.taken).toBe(true));
  expect(await model.userData.setCoverRelief(choice(2))).toBe(true);
  const installed=cover.clearcoatMap;
  gate.resolve();expect(await first).toBe(false);
  expect(await model.userData.setCoverRelief(choice(2,{strength:.5}))).toBe(true);
  expect(cover.clearcoatMap).toBe(installed);
  expect(buildReliefMaps).toHaveBeenCalledTimes(2);
});
it('rebakes the local finish when the laminate changes with a relief still selected',async()=>{
  await model.userData.setCoverRelief(choice(2));
  expect(cover.clearcoatMap.image.data[0]).toBeGreaterThan(0);
  model.userData.updateCoverAppearance({...book,coverFinish:'matte',coverRelief:choice(2)});
  await vi.waitFor(()=>expect(cover.clearcoatMap.image.data[0]).toBe(0));
  expect(cover.clearcoatMap.image.data[8]).toBe(255);
});
it('regenerates a saved colour after replacing the printed cover source',async()=>{
  await model.userData.setCoverRelief(choice());
  const old=vi.mocked(buildReliefMaps).mock.calls[0][0];
  vi.mocked(buildReliefMaps).mockClear();
  model.userData.updateCoverSource(null,{...book,title:'A different printed cover',coverRelief:choice()},style);
  await vi.waitFor(()=>expect(buildReliefMaps).toHaveBeenCalled());
  expect(vi.mocked(buildReliefMaps).mock.calls[0][0]).not.toBe(old);
});
it('stops analysis on disposal and releases each installed map once',async()=>{
  await model.userData.setCoverRelief(choice());
  const normal=vi.spyOn(cover.clearcoatNormalMap,'dispose'),packed=vi.spyOn(cover.clearcoatMap,'dispose');
  const gate=deferred();vi.mocked(buildReliefMaps).mockImplementation(()=>gate.promise);
  const pending=model.userData.setCoverRelief(choice(3));
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
  model=createBookModel({...book,coverRelief:choice(1,{strength:.4})},style,132,200,30);
  cover=model.getObjectByName('front-cover').material[0];
  await vi.waitFor(()=>expect(cover.clearcoatNormalMap.image.width).toBe(2));
  expect(buildReliefMaps).toHaveBeenCalledOnce();
  expect(model.userData.coverRelief()).toEqual(choice(1,{strength:.4}));
  expect('coverRelief' in book).toBe(false);
});

it('rebuilds the same colour slot when either its exact ink or tolerance changes',async()=>{
  await model.userData.setCoverRelief(choice());
  const first=cover.clearcoatMap;
  await model.userData.setCoverRelief(choice(1,{color:'#c75030'}));
  expect(cover.clearcoatMap).not.toBe(first);
  const second=cover.clearcoatMap;
  await model.userData.setCoverRelief(choice(1,{color:'#c75030',tolerance:2}));
  expect(cover.clearcoatMap).not.toBe(second);
  const third=cover.clearcoatMap,normal=cover.clearcoatNormalMap,version=cover.version;
  await model.userData.setCoverRelief(choice(1,{color:'#c75030',tolerance:2,strength:.2}));
  expect(cover.clearcoatMap).toBe(third);
  expect(cover.clearcoatNormalMap).toBe(normal);
  expect(cover.version).toBe(version);
  expect(buildReliefMaps).toHaveBeenCalledTimes(3);
});

it('uses the fitted printed raster and leaves its ink and every mesh untouched',async()=>{
  const printed=cover.map,colour=cover.color.clone(),geometries=[];
  model.traverse(node=>{if(node.geometry)geometries.push([node,node.geometry]);});
  await model.userData.setCoverRelief(choice());
  expect(vi.mocked(buildReliefMaps).mock.calls[0][0]).toBe(printed.image);
  expect(cover.map).toBe(printed);
  expect(cover.color).toEqual(colour);
  expect(cover.metalness).toBe(0); // yellow print is not metal
  for(let i=2;i<cover.metalnessMap.image.data.length;i+=4)expect(cover.metalnessMap.image.data[i]).toBe(0);
  for(const [node,geometry] of geometries)expect(node.geometry).toBe(geometry);
});

it('keeps the mask in the normal alpha without changing its normal pixels or source array',async()=>{
  const built=maps(),original=built.normal.slice();vi.mocked(buildReliefMaps).mockResolvedValue(built);
  await model.userData.setCoverRelief(choice());
  const uploaded=cover.clearcoatNormalMap.image.data;
  expect([uploaded[3],uploaded[7],uploaded[11],uploaded[15]]).toEqual([0,255,255,0]);
  expect(built.normal).toEqual(original);
  expect(cover.clearcoatNormalMap.isDataTexture).toBe(true);
  expect(cover.clearcoatNormalMap.flipY).toBe(true);
  expect(cover.clearcoatNormalMap.generateMipmaps).toBe(true);
  for(let i=0;i<uploaded.length;i++)if(i%4!==3)expect(uploaded[i]).toBe(original[i]);
});

it('uses exact neutral normal decoding and preserves the three physical base-finish values outside the mask',async()=>{
  const shader={uniforms:{},vertexShader:ShaderLib.physical.vertexShader,fragmentShader:ShaderLib.physical.fragmentShader};
  cover.onBeforeCompile(shader,{});
  expect(shader.fragmentShader).toContain('( reliefSample.xy * 255.0 - 128.0 ) / 127.0');
  expect(shader.fragmentShader).toContain('step( 0.5 / 255.0, reliefSample.a )');
  expect(shader.fragmentShader).toContain('mix( bookReliefBaseFinish.y, roughnessFactor, bookReliefAmount )');
  expect(shader.fragmentShader).toContain('mix( bookReliefBaseFinish.x, material.clearcoat, bookReliefAmount )');
  expect(shader.fragmentShader).toContain('mix( bookReliefBaseFinish.z, material.clearcoatRoughness, bookReliefAmount )');
  expect(shader.fragmentShader).toContain('vClearcoatRoughnessMapUv ).a');
  expect(shader.uniforms.bookReliefBaseFinish.value.toArray()).toEqual([.35,.48,.28]);
  await model.userData.setCoverRelief(choice(1,{strength:0}));
  expect(shader.uniforms.bookReliefStrength.value).toBe(0);
  expect(cover.clearcoatNormalScale.toArray()).toEqual([0,0]);
  model.userData.updateCoverAppearance({...book,coverFinish:'matte'});
  expect(shader.uniforms.bookReliefBaseFinish.value.toArray()).toEqual([0,.94,.6]);
});

it('does not install a stale finish when it changes during the first material bake',async()=>{
  const gate=deferred();gates.next=gate;
  const pending=model.userData.setCoverRelief(choice());
  await vi.waitFor(()=>expect(gates.taken).toBe(true));
  model.userData.updateCoverAppearance({...book,coverFinish:'matte'});
  gate.resolve();expect(await pending).toBe(true);
  expect(cover.clearcoatMap.image.data[0]).toBe(0);
  expect(cover.clearcoatMap.image.data[4]).toBe(255);
  expect(model.userData.coverRelief()).toEqual(choice());
});

it('cannot revive a cleared mask from an older finish rebake',async()=>{
  await model.userData.setCoverRelief(choice());
  const gate=deferred();gates.next=gate;
  model.userData.updateCoverAppearance({...book,coverFinish:'glossy'});
  await vi.waitFor(()=>expect(gates.taken).toBe(true));
  await model.userData.setCoverRelief(null);
  const neutral=cover.clearcoatMap;
  gate.resolve();await Promise.resolve();await Promise.resolve();
  expect(cover.clearcoatMap).toBe(neutral);
  expect(cover.clearcoatNormalMap.image.width).toBe(1);
  expect(cover.clearcoatNormalMap.image.data[3]).toBe(0);
  expect(model.userData.coverRelief()).toBeNull();
});

it.each([[false,256],[true,128]])('renders persisted relief on ordinary shelf models (overview=%s) with bounded maps',async(overview,size)=>{
  model.userData.dispose();
  model=createBookModel({...book,coverRelief:choice()},style,132,200,30,null,{shelf:true,overview});
  const material=model.getObjectByName('front-cover').material;
  cover=Array.isArray(material)?material[0]:material;
  await vi.waitFor(()=>expect(cover.clearcoatNormalMap?.image.width).toBe(2));
  expect(model.userData.coverRelief()).toEqual(choice());
  expect(buildReliefMaps).toHaveBeenCalledWith(expect.anything(),choice(),expect.objectContaining({maxSize:size}));
});

it('keeps an unedited shelf cheap and applies a newly saved relief without replacing its mesh',async()=>{
  model.userData.dispose();
  model=createBookModel(book,style,132,200,30,null,{shelf:true});
  cover=model.getObjectByName('front-cover').material[0];
  expect(cover.clearcoatNormalMap).toBeNull();
  const geometry=model.getObjectByName('front-cover').geometry;
  model.userData.updateCoverAppearance({...book,coverRelief:choice()});
  await vi.waitFor(()=>expect(cover.clearcoatNormalMap?.image.width).toBe(2));
  expect(model.getObjectByName('front-cover').geometry).toBe(geometry);
  expect(model.userData.coverRelief()).toEqual(choice());
});

it('excludes fitted white board margins when the printed image has a different aspect ratio',async()=>{
  vi.spyOn(TextureLoader.prototype,'load').mockImplementation((_url,onLoad)=>{
    const texture=new Texture({width:600,height:900});onLoad(texture);return texture;
  });
  model.userData.dispose();
  model=createBookModel(book,{...style,color:'#ffffff',coverRatio:1},200,200,30,'blob:white-padding');
  cover=model.getObjectByName('front-cover').material[0];
  await model.userData.ready;
  await model.userData.setCoverRelief(choice(1,{color:'#ffffff'}));
  const source=vi.mocked(buildReliefMaps).mock.calls.at(-1)[0],printed=cover.map.image;
  expect(source).not.toBe(printed);
  expect([source.width,source.height]).toEqual([printed.width,printed.height]);
  expect(source._drawCalls).toEqual([[printed,0,0]]);
  const margin=source.width/6;
  expect(source._clearedRects[2].slice(0,2)).toEqual([0,0]);
  expect(source._clearedRects[2][2]).toBeCloseTo(margin,10);
  expect(source._clearedRects[2][3]).toBe(source.height);
  expect(source._clearedRects[3][0]).toBeCloseTo(source.width-margin,6);
  expect(source._clearedRects[3][2]).toBeCloseTo(margin,6);
  expect(printed._clearedRects).toBeUndefined(); // actual diffuse board remains opaque and unmodified
  const previous=source;
  await model.userData.setCoverRelief(choice(1,{color:'#ffffff',tolerance:2}));
  expect(vi.mocked(buildReliefMaps).mock.calls.at(-1)[0]).toBe(previous);
});
