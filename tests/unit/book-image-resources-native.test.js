import {afterEach,expect,it,vi} from 'vitest';
import * as THREE from 'three';
import {acquireCoverImage,loadedShelfCover} from '../../src/js/book-cover-images.js';
import {samplePaperTone} from '../../src/js/page-paper-tone-sample.js';
import {prepareSnapshotPaperTones} from '../../src/js/page-paper-tone.js';
import {rustShelf,shelfWasm} from './helpers/rust-shelf-ready.js';
import {rustCore} from './helpers/rust-core-ready.js';
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();vi.useRealTimers();});

it('ignores a retired decode without evicting a newer lease of the same URL',()=>{
  const loads=[];
  vi.spyOn(THREE.TextureLoader.prototype,'load').mockImplementation((_url,ready,_progress,fail)=>loads.push({ready,fail}));
  const abandoned=vi.fn(),retire=acquireCoverImage('blob:replaced',abandoned,vi.fn()); retire();
  const current=vi.fn(),release=acquireCoverImage('blob:replaced',current,vi.fn());
  const old=new THREE.Texture({old:true}),dispose=vi.spyOn(old,'dispose'); loads[0].ready(old);
  expect(abandoned).not.toHaveBeenCalled();expect(dispose).toHaveBeenCalledOnce();
  const photo={current:true};loads[1].ready(new THREE.Texture(photo));loads[0].fail();
  expect(loadedShelfCover('blob:replaced')).toBe(photo);expect(current).toHaveBeenCalledWith(photo,expect.any(Object));release();
});

it('disposes a loaded texture and notifies the other owner even when one consumer throws',()=>{
  let complete;vi.spyOn(THREE.TextureLoader.prototype,'load').mockImplementation((_url,ready)=>{complete=ready;});
  const first=acquireCoverImage('blob:callback-error',()=>{throw Error('Consumer failed');},vi.fn());
  const notified=vi.fn(),second=acquireCoverImage('blob:callback-error',notified,vi.fn());
  const texture=new THREE.Texture({}),dispose=vi.spyOn(texture,'dispose');
  expect(()=>complete(texture)).toThrow('Consumer failed');expect(dispose).toHaveBeenCalledOnce();expect(notified).toHaveBeenCalledOnce();
  first();second();expect(loadedShelfCover('blob:callback-error')).toBeUndefined();
});

it('releases a synchronous loader failure and its timeout before allowing retry',()=>{
  vi.useFakeTimers();const loader=vi.spyOn(THREE.TextureLoader.prototype,'load').mockImplementationOnce(()=>{throw Error('Blocked');}).mockImplementation(()=>{});
  expect(()=>acquireCoverImage('https://example.test/error',vi.fn(),vi.fn())).toThrow('Blocked');
  expect(vi.getTimerCount()).toBe(0);expect(loadedShelfCover('https://example.test/error')).toBeUndefined();
  const release=acquireCoverImage('https://example.test/error',vi.fn(),vi.fn());release();
  expect(loader).toHaveBeenCalledTimes(2);expect(vi.getTimerCount()).toBe(0);
});

it('does not create a worker if cancellation arrives during bitmap creation and closes that bitmap',async()=>{
  const controller=new AbortController(),bitmap={close:vi.fn()};let complete;
  vi.stubGlobal('OffscreenCanvas',function(){});vi.stubGlobal('Worker',vi.fn());
  vi.stubGlobal('createImageBitmap',vi.fn(()=>new Promise(resolve=>{complete=resolve;})));
  const task=prepareSnapshotPaperTones({source:{},toneKey:{}},{signal:controller.signal});
  controller.abort();complete(bitmap);expect(await task).toBe(false);
  expect(bitmap.close).toHaveBeenCalledOnce();expect(Worker).not.toHaveBeenCalled();
});

// Frozen original algorithm: parity covers quartile rounding, sparse alpha and
// the discontinuity at a 20-level margin spread, rather than mirroring Rust.
function reference(data){
  const ring=[];
  for(let i=0;i<11;i++)for(const[x,y]of[[i,0],[11,i],[11-i,11],[0,11-i]]){const k=(y*12+x)*4;if(data[k+3]>200)ring.push(k);}
  const channels=[0,1,2].map(o=>ring.map(k=>data[k+o]).sort((a,b)=>a-b));
  const quartile=(v,q)=>v[Math.floor((v.length-1)*q)];
  return ring.length>=16&&channels.every(v=>quartile(v,.75)-quartile(v,.25)<=20)?channels.map(v=>quartile(v,.5)):null;
}
it('matches the original sampler over 700 deterministic noisy, transparent and full-bleed pages',()=>{
  let seed=0x87a12345;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed;};
  for(let trial=0;trial<700;trial++){
    const data=new Uint8ClampedArray(576),base=[random()%256,random()%256,random()%256],spread=trial%50;
    for(let i=0;i<data.length;i+=4){for(let c=0;c<3;c++)data[i+c]=base[c]+random()%(spread+1);data[i+3]=trial%3?255:random()%256;}
    expect(samplePaperTone(data)).toEqual(reference(data));
  }
});

it('keeps native handles and both WASM memories bounded across repeated image leases and sampling',()=>{
  vi.spyOn(THREE.TextureLoader.prototype,'load').mockImplementation((_url,ready)=>{ready(new THREE.Texture({}));});
  const data=new Uint8ClampedArray(576).fill(255),exercise=()=>{const release=acquireCoverImage('blob:stress',()=>{},()=>{});release();samplePaperTone(data);};
  for(let i=0;i<100;i++)exercise();
  const handles=rustShelf.shelf_live_handles(),callbacks=rustShelf.shelf_pending_callbacks(),shelfBytes=shelfWasm.memory.buffer.byteLength,coreBytes=rustCore.memory.buffer.byteLength;
  for(let i=0;i<1000;i++)exercise();
  expect(rustShelf.shelf_live_handles()).toBe(handles);expect(rustShelf.shelf_pending_callbacks()).toBe(callbacks);
  expect(shelfWasm.memory.buffer.byteLength).toBe(shelfBytes);expect(rustCore.memory.buffer.byteLength).toBe(coreBytes);
});
