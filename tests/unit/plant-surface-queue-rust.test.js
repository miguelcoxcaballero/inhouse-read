// @vitest-environment node
import {afterEach,expect,it,vi} from 'vitest';
import * as THREE from 'three';
import {needRustShelf} from '../../src/js/rust-shelf.js';
const rust=()=>needRustShelf();
afterEach(()=>vi.restoreAllMocks());
function fixture(){
 const r=rust(),state=r.plant_surface_state(),steps=[],scheduled=[],released=[];
 const paint=(job,count)=>{steps.push([job.spec.family,job.row,count]);job.pigment.fill(job.row+1,job.row*job.width*4,(job.row+count)*job.width*4);return true;};
 const host={defer:()=>false,schedule:()=>scheduled.push(1),warn:vi.fn(),savedSurface:()=>null,loadedShelfBakes:()=>null,scheduleShelfBakeWrite:vi.fn(),
  texture:(bytes,width,height,color)=>{const t=new THREE.DataTexture(bytes,width,height);t.colorSpace=color?THREE.SRGBColorSpace:THREE.NoColorSpace;t.needsUpdate=true;return t;},
  lattice:()=>true,painters:[paint,paint,paint,paint],watchDispose:(base,texture)=>{const callback=()=>{r.plant_surface_release(base,texture);texture.removeEventListener('dispose',callback);released.push(texture);};texture.addEventListener('dispose',callback);}};
 const surface=(key='s',height=256,notify=undefined,family=0)=>r.plant_surface(state,host,key,1,height,false,{family,kind:0},notify);
 const pump=remaining=>r.plant_surface_pump(state,host,{timeRemaining:()=>remaining});
 return {r,state,steps,scheduled,released,host,surface,pump};
}
it('bounds slices to 48 four-row chunks with a frozen clock and preserves one shared upload',async()=>{
 vi.spyOn(performance,'now').mockReturnValue(0);
 const f=fixture(),redraw=vi.fn(),a=f.surface('s',256,redraw),b=f.surface('s',256,redraw);
 const version=a.map.source.version,cloned=a.map.version;
 expect(f.scheduled).toHaveLength(1);expect(a.map.source).toBe(b.map.source);expect(a.map.source.version).toBe(version);
 const ready=f.r.plant_surface_ready(f.state);let done=false;ready.then(()=>{done=true;});
 f.pump(100);expect(f.steps).toHaveLength(48);expect(f.state.queue[0].row).toBe(192);expect(f.scheduled).toHaveLength(2);await Promise.resolve();expect(done).toBe(false);
 f.pump(100);await ready;expect(f.steps).toHaveLength(64);expect(f.state.queue).toHaveLength(0);expect(a.map.source.version).toBe(version+1);expect(a.map.version).toBe(cloned+1);expect(redraw).toHaveBeenCalledTimes(1);expect(f.state.settled).toHaveLength(0);
});
it('defers without touching rows, and removes disposed clones before completion',()=>{
 const f=fixture(),a=f.surface('s',8),b=f.surface('s',8),version=b.map.version;
 f.host.defer=()=>true;f.pump(0);expect(f.steps).toEqual([]);expect(f.scheduled).toHaveLength(2);
 b.map.dispose();expect(f.released).toEqual([b.map]);f.host.defer=()=>false;f.pump(100);
 expect(a.map.version).toBe(version+1);expect(b.map.version).toBe(version);expect(f.state.surfaces.get('s').clones).toBeNull();
});
it('forgets failed paints, completes waiters and retries the same key without caching coarse pixels',async()=>{
 const f=fixture();f.surface('s',8);const error=Error('paint failed');f.host.painters[0]=()=>{throw error;};const ready=f.r.plant_surface_ready(f.state);f.pump(0);await ready;
 expect(f.host.warn).toHaveBeenCalledWith(error);expect(f.state.surfaces.has('s')).toBe(false);expect(f.state.queue).toEqual([]);
 f.host.painters[0]=()=>true;f.surface('s',8);expect(f.state.queue).toHaveLength(1);f.pump(100);expect(f.state.surfaces.has('s')).toBe(true);
});
it('allows refresh callbacks to create another surface without Rust mutable-borrow errors',()=>{
 const f=fixture();f.surface('a',4,()=>f.surface('b',8));f.pump(100);
 expect(f.state.queue).toHaveLength(1);expect(f.state.queue[0].key).toBe('b');f.pump(100);expect(f.state.queue).toEqual([]);
});
it('uses saved final bytes directly and evicts only the oldest of twelve model bakes',()=>{
 const f=fixture(),saved={pigment:new Uint8Array(16),data:new Uint8Array(16)};f.host.savedSurface=()=>saved;const a=f.surface('saved',4);
 expect(a.map.image.data).toBe(saved.pigment);expect(f.state.queue).toEqual([]);expect(f.scheduled).toEqual([]);
 const entry=key=>({bake:{parts:[key],objects:[]},surfaces:new Set(['saved'])});
 for(let n=0;n<13;n++)f.r.plant_bake_remember(f.state,f.host,`m${n}`,entry(n));
 expect([...f.state.shelfBakes.keys()]).toEqual(Array.from({length:12},(_,n)=>`m${n+1}`));
 const first=f.state.shelfBakes.get('m1');f.r.plant_bake_remember(f.state,f.host,'m1',first);f.r.plant_bake_remember(f.state,f.host,'m13',entry(13));expect(f.state.shelfBakes.has('m2')).toBe(false);expect(f.r.plant_bake_current(f.state,'m1',first)).toBe(true);
 const record=f.r.plant_bake_record(f.state);expect(record.models).toHaveLength(12);expect(record.surfaces).toHaveLength(1);expect(record.surfaces[0][1].pigment).toBe(saved.pigment);
});
it('accepts records that arrive late, consumes them once and rejects invalid geometry',()=>{
 const f=fixture(),valid={parts:[],objects:[]};expect(f.r.plant_bake_get(f.state,f.host,'late')).toBeNull();
 f.host.loadedShelfBakes=()=>({models:[['late',valid,[]],['bad',{parts:[],objects:[{}]},[]]]});
 expect(f.r.plant_bake_get(f.state,f.host,'late')).toEqual({bake:valid,surfaces:null});expect(f.r.plant_bake_get(f.state,f.host,'late')).toBeNull();expect(f.r.plant_bake_get(f.state,f.host,'bad')).toBeNull();
});
it('releases temporary Wasm handles after repeated completion, cancellation and failure',async()=>{
 const run=async()=>{const f=fixture(),a=f.surface('a',8),b=f.surface('a',8);a.map.dispose();const ready=f.r.plant_surface_ready(f.state);f.pump(100);await ready;b.map.dispose();f.r.plant_bake_record(f.state);};
 await run();const handles=rust().shelf_live_handles();for(let n=0;n<40;n++)await run();expect(rust().shelf_live_handles()).toBe(handles);
});
it('matches the former queue order, idle budgets, painted bytes and upload versions across families',async()=>{
 const {referencePlantSurfaceQueue}=await import('./helpers/reference-plant-surface-queue.js');
 const signatures=[];
 for(const native of [false,true]){
  let clock=0;vi.spyOn(performance,'now').mockImplementation(()=>clock++);
  const f=fixture(),reference=referencePlantSurfaceQueue(f.host),redraw=vi.fn();
  const add=native?f.surface:(key,height,notify,family)=>reference.surface(key,1,height,false,{family,kind:0},notify);
  const pump=native?f.pump:remaining=>reference.pump({timeRemaining:()=>remaining});
  const state=native?f.state:reference.state,ready=()=>native?f.r.plant_surface_ready(state):reference.ready();
  const textures=[];for(let family=0;family<4;family++)textures.push(add(`k${family}`,17+family,redraw,family));
  textures.push(add('k2',19,redraw,2));textures.at(-1).map.dispose();
  const done=ready();while(state.queue.length)pump(8);await done;
  signatures.push({steps:f.steps,scheduled:f.scheduled.length,redraws:redraw.mock.calls.length,
   textures:textures.map(({map,data})=>[...map.image.data,map.source.version,map.version,data.source.version,data.version])});
  vi.restoreAllMocks();
 }
 expect(signatures[1]).toEqual(signatures[0]);
});
it('keeps timed-out and invalid deadlines bounded to one chunk after the mandatory first row batch',()=>{
 for(const deadline of [0,NaN]){
  const f=fixture();f.surface('s',128);let clock=0;vi.spyOn(performance,'now').mockImplementation(()=>clock+=10);f.pump(deadline);expect(f.steps).toEqual([[0,0,4]]);vi.restoreAllMocks();
 }
});
it('parks real plant painting while the reader owns the screen and resumes on the ownership signal',async()=>{
 const jobs=[];vi.stubGlobal('requestIdleCallback',callback=>jobs.push(callback));
 const idle=await import('../../src/js/idle-startup.js'),plants=await import('../../src/js/shelf-plants.js');
 let plant;
 try{
  idle.setShelfWorkActive(false);plant=plants.createShelfPlant({catalogId:'sansevieria',potId:'muskot',seed:'reader-gate'});
  let settled=false;const ready=plants.plantSurfacesReady().then(()=>{settled=true;});await Promise.resolve();
  expect(jobs).toHaveLength(0);expect(settled).toBe(false);
  idle.setShelfWorkActive(true);expect(jobs).toHaveLength(1);
  while(jobs.length)jobs.shift()({timeRemaining:()=>100});await ready;expect(settled).toBe(true);
 }finally{idle.setShelfWorkActive(true);plant?.userData.dispose();vi.unstubAllGlobals();}
});
