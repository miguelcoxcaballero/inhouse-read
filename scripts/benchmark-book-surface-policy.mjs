// CPU-only exact-color policy comparison. No renderer, image downloads or GPU.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import * as native from '../src/wasm/shelf/inhouse_read_shelf.js';
import { ribbonSilk as referenceSilk,mixPaperTone as referenceMix } from '../tests/unit/helpers/reference-book-surface-policy.js';
native.initSync({module:readFileSync(new URL('../src/wasm/shelf/inhouse_read_shelf_bg.wasm',import.meta.url))});
const colorHost={hex:value=>new THREE.Color(value).getHex()},scratch={a:{},b:{}},out=new THREE.Color(),stock=new THREE.Color('#eee'),theme=new THREE.Color('#222');
scratch.rgb=new Float64Array(6);
const colorMixHost={
 read(stock,theme){const a=stock.getRGB(scratch.a,THREE.SRGBColorSpace),b=theme.getRGB(scratch.b,THREE.SRGBColorSpace),rgb=scratch.rgb;
  rgb[0]=a.r;rgb[1]=a.g;rgb[2]=a.b;rgb[3]=b.r;rgb[4]=b.g;rgb[5]=b.b;return rgb;},
 write:(target,r,g,b)=>target.setRGB(r,g,b,THREE.SRGBColorSpace)
};
const mix=(...args)=>native.book_paper_mix(...args,colorMixHost);
function measure(run){for(let i=0;i<1000;i++)run(i);const start=performance.now();for(let i=0;i<20000;i++)run(i);return(performance.now()-start)/20;}
for(let i=0;i<3;i++){
 console.log(JSON.stringify({unit:'microseconds/selection',original:measure(i=>referenceSilk(i*971,0x223344)),rust:measure(i=>native.book_ribbon_silk(i*971,0x223344,false,colorHost))}));
 console.log(JSON.stringify({unit:'microseconds/blend',original:measure(i=>referenceMix(out,stock,theme,(i%100)/100)),rust:measure(i=>mix(out,stock,theme,(i%100)/100))}));
}
if(typeof globalThis.gc==='function'){
 const refs=[];
 function install(){const key={},source={data:new Uint8Array(128*1024)};
  const host={read:()=>[255,230,200],color:(r,g,b)=>new THREE.Color().setRGB(r,g,b,THREE.SRGBColorSpace)};
  native.book_paper_color(key,source,null,host);refs.push(new WeakRef(key),new WeakRef(source),new WeakRef(host));}
 for(let i=0;i<100;i++)install();
 for(let i=0;i<12;i++){await new Promise(setImmediate);globalThis.gc();}
 const retained=refs.filter(ref=>ref.deref()).length;assert.equal(retained,0);console.log(JSON.stringify({weakPaperResources:refs.length,retained}));
}
