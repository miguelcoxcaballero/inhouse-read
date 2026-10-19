import { expect,it,vi } from 'vitest';
import * as THREE from 'three';
import { ribbonSilk,mixPaperTone } from '../../src/js/book-model.js';
import { ribbonSilk as referenceSilk,mixPaperTone as referenceMix } from './helpers/reference-book-surface-policy.js';
import { rustShelf as native,shelfWasm } from './helpers/rust-shelf-ready.js';
function random(seed){return()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};}
it('preserves exact silk selection for 20000 seeded cloth colors and finished books',()=>{
 const next=random(8942);
 for(let i=0;i<20000;i++){const seed=(next()-.5)*2**38,cloth=Math.floor(next()*0xffffff);
  expect(ribbonSilk(seed,cloth)).toBe(referenceSilk(seed,cloth));}
 for(const seed of [0,-0,1,-1,65520,65521,65522,NaN,Infinity,-Infinity,undefined,null,'15'])
  for(const cloth of ['#555',null,undefined,'red','#7c1c26',new THREE.Color('#22305a')])
   for(const finished of [false,true])expect(ribbonSilk(seed,cloth,finished)).toBe(referenceSilk(seed,cloth,finished));
});
it('matches paper blends component for component, including aliases and out-of-range themes',()=>{
 const next=random(71024);
 for(let i=0;i<2000;i++)for(const alias of ['new','stock','theme']){
  const stock=new THREE.Color(next()*1.4-.2,next()*1.4-.2,next()*1.4-.2),theme=new THREE.Color(next(),next(),next());
  const a=stock.clone(),b=theme.clone(),c=stock.clone(),d=theme.clone(),mix=next()*1.4-.2;
  const actual=mixPaperTone(alias==='new'?new THREE.Color():alias==='stock'?a:b,a,b,mix);
  const expected=referenceMix(alias==='new'?new THREE.Color():alias==='stock'?c:d,c,d,mix);
  expect(actual.toArray()).toEqual(expected.toArray());
 }
 for(const mix of [null,undefined,'',NaN,Infinity,-Infinity,0,-0,1,'.5',{},[],[.3]])
  for(const stock of [null,new THREE.Color('#eee')])for(const theme of [null,new THREE.Color('#121212')]){
   const actual=mixPaperTone(new THREE.Color(),stock,theme,mix),expected=referenceMix(new THREE.Color(),stock,theme,mix);
   expect(actual?.toArray()??actual).toEqual(expected?.toArray()??expected);
  }
});
it('keeps tint, colored sheen and every ribbon material property exactly the same',()=>{
 for(const silk of ['#7c1c26','#1d4030','#c29a4c'])for(const shelf of [false,true])for(const finished of [false,true]){
  const a=new THREE.MeshPhysicalMaterial(),b=new THREE.MeshPhysicalMaterial();
  native.book_ribbon_tint(a,silk,shelf,new THREE.Color('#fff6ea'));
  b.color.set(silk).multiplyScalar(shelf?.88:1);b.sheenColor.set(silk).multiplyScalar(2.2).lerp(new THREE.Color('#fff6ea'),.1);
  expect(a.color.toArray()).toEqual(b.color.toArray());expect(a.sheenColor.toArray()).toEqual(b.sheenColor.toArray());
  expect(native.book_ribbon_material(finished,shelf)).toEqual({roughness:shelf?.42:.46,metalness:finished?.16:0,
   sheen:shelf?0:.7,sheenRoughness:.38,anisotropy:shelf?0:.55,specularIntensity:.5,alphaTest:.5});
 }
});
it('preserves closeup weave and laminate grain strengths at all quality thresholds',()=>{
 for(const height of [0,20,120,224,440,900,NaN,Infinity])for(const ratio of [undefined,null,'2',1,1.5,2,4,NaN]){
  const expected=THREE.MathUtils.clamp((height*Math.min(2,typeof ratio==='number'?ratio:1)/224-1.4)/2.2,.2,.45);
  const actual=native.book_weave_strength(height,ratio);expect(actual).toBe(expected);
  for(const kind of ['cloth','paper'])for(const finish of ['matte','satin','glossy'])
   expect(native.book_grain_strength(kind,actual,finish)).toBe((kind==='cloth'?.55*expected:.16)*{matte:1,satin:.5,glossy:.16}[finish]);
 }
});
it('shares one paper color by immutable identity, including a cached missing tone',()=>{
 const key={},source={},toneKey={},host={read:vi.fn(()=>[240,225,200]),color:(r,g,b)=>new THREE.Color().setRGB(r,g,b,THREE.SRGBColorSpace)};
 const first=native.book_paper_color(key,source,toneKey,host),second=native.book_paper_color(key,{},null,host);
 expect(first).toBe(second);expect(host.read).toHaveBeenCalledOnce();expect(host.read).toHaveBeenCalledWith(source,toneKey);
 expect(first.toArray()).toEqual(new THREE.Color().setRGB(240/255,225/255,200/255,THREE.SRGBColorSpace).toArray());
 const missing={};host.read.mockReturnValue(null);expect(native.book_paper_color(missing,source,toneKey,host)).toBeNull();
 host.read.mockReturnValue([0,0,0]);expect(native.book_paper_color(missing,source,toneKey,host)).toBeNull();expect(host.read).toHaveBeenCalledTimes(2);
});
it('retries a tone read/conversion failure without caching a partial color',()=>{
 const key={},host={read:vi.fn(()=>{throw new Error('read');}),color:vi.fn(()=>{throw new Error('color');})};
 expect(()=>native.book_paper_color(key,{},null,host)).toThrow('read');host.read.mockReturnValue([1,2,3]);
 expect(()=>native.book_paper_color(key,{},null,host)).toThrow('color');const color=new THREE.Color();host.color.mockReturnValue(color);
 expect(native.book_paper_color(key,{},null,host)).toBe(color);expect(host.read).toHaveBeenCalledTimes(3);
});
it('returns an unchanged target for missing paper and retains no native resources through repeated blends',()=>{
 const target=new THREE.Color('#abcdef'),original=target.toArray(),stock=new THREE.Color('#eee'),theme=new THREE.Color('#222');
 expect(mixPaperTone(target,null,null,.5)).toBeNull();expect(target.toArray()).toEqual(original);
 for(let i=0;i<30;i++)mixPaperTone(target,stock,theme,.5);
 const bytes=shelfWasm.memory.buffer.byteLength,handles=native.shelf_live_handles();
 for(let i=0;i<1000;i++)expect(mixPaperTone(target,stock,theme,i/1000)).toBe(target);
 expect(shelfWasm.memory.buffer.byteLength).toBe(bytes);expect(native.shelf_live_handles()).toBe(handles);
});
