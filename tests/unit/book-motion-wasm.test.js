// @vitest-environment node
import {readFileSync} from 'node:fs';
import {beforeAll,afterEach,expect,it,vi} from 'vitest';
const state=vi.hoisted(()=>({core:null}));
vi.mock('../../src/js/rust-core.js',()=>({getRustCore:()=>state.core}));
import {createRustBookMotion,MOTION_KEYS} from '../../src/js/book-motion-wasm.js';
import {sampleBookMotion as reference,originalClock} from './helpers/reference-book-motion.js';
let core;
beforeAll(async()=>{core=(await WebAssembly.instantiate(readFileSync('src/wasm/inhouse_read_core.wasm'))).instance.exports;expect(typeof core.book_motion_prepare).toBe('function');state.core=core;});
afterEach(()=>{state.core=core;});
const frames=(kind,count=4)=>Array.from({length:count},(_,i)=>({offset:i/(count-1),transform:Object.fromEntries(MOTION_KEYS.map((key,k)=>[key,kind==='flat'?3:kind==='turn'?(i%2?-2:3)*(k+1):i*(k+1)]))}));
for(const kind of ['flat','turn','ascending','descending','partial','unthemed'])it(`preserves every ${kind} frame exactly`,()=>{
 const input=frames(kind);
 if(kind==='descending')input.forEach(frame=>{for(const key of MOTION_KEYS)frame.transform[key]*=-1;});
 if(kind==='partial'){delete input[1].transform.roll;delete input[2].transform.coverOpen;}
 if(kind==='unthemed')delete input[1].transform.pageTheme;
 input[1].offset=.18;input[2].offset=.77;
 const motion=createRustBookMotion(input);expect(motion).not.toBeNull();
 try{for(let i=-5;i<=105;i++)expect(motion.sample(i/100)).toEqual(reference(input,i/100));}finally{motion.dispose();}
});
it('preserves implicit offsets, absent components and signed zero',()=>{
 const input=[{transform:{angle:-0}},{transform:{angle:3}},{transform:{angle:0}}];
 const motion=createRustBookMotion(input);
 try{for(const t of [-0,0,.2,.5,.8,1])expect(motion.sample(t)).toEqual(reference(input,t));}finally{motion.dispose();}
});
it('does not mutate caller keyframes during preparation or sampling',()=>{
 const input=frames('turn');for(const frame of input){Object.freeze(frame.transform);Object.freeze(frame);}Object.freeze(input);
 const copy=JSON.stringify(input),motion=createRustBookMotion(input);
 try{expect(motion.sample(.37)).toEqual(reference(input,.37));expect(JSON.stringify(input)).toBe(copy);}finally{motion.dispose();}
});
it('matches randomized nonuniform keyframes and exact keyframe boundaries',()=>{
 let seed=8742;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
 for(let j=0;j<120;j++){
  const count=2+Math.floor(random()*14),input=frames('ascending',count);let end=0;
  for(const frame of input){frame.offset=end;end+=.01+random();for(const key of MOTION_KEYS)frame.transform[key]=(random()-.5)*1000;}
  const last=input.at(-1).offset;for(const frame of input)frame.offset/=last;
  const motion=createRustBookMotion(input);expect(motion).not.toBeNull();
  try{for(const t of [...input.map(f=>f.offset),...Array.from({length:30},random)])expect(motion.sample(t)).toEqual(reference(input,t));}finally{motion.dispose();}
 }
});
it('keeps motion arenas independent and frees exactly once on cancellation',()=>{
 const free=vi.fn(core.free_f64);state.core={...core,free_f64:free};
 const a=createRustBookMotion(frames('ascending')),b=createRustBookMotion(frames('turn'));
 a.dispose();a.dispose();expect(a.sample(.5)).toBeUndefined();expect(free).toHaveBeenCalledTimes(1);
 expect(b.sample(.5)).toEqual(reference(frames('turn'),.5));b.dispose();expect(free).toHaveBeenCalledTimes(2);
});
it('refreshes views after preparation, sampling and unrelated memory growth',()=>{
 state.core={...core,book_motion_prepare(...args){core.memory.grow(1);return core.book_motion_prepare(...args);},book_motion_sample(...args){core.memory.grow(1);return core.book_motion_sample(...args);}};
 const input=frames('turn'),motion=createRustBookMotion(input);
 try{const first=motion.sample(.3);core.memory.grow(1);expect(motion.sample(.6)).toEqual(reference(input,.6));expect(first).toEqual(reference(input,.3));}finally{motion.dispose();}
});
it('rejects cold, old, unavailable and failing kernels without retaining an arena',()=>{
 const input=frames('ascending');
 for(const engine of [null,{}, {...core,alloc_f64:()=>0},{...core,alloc_f64:()=>{throw Error('OOM');}}]){state.core=engine;expect(createRustBookMotion(input)).toBeNull();}
 for(const run of [()=>0,()=>{throw Error('prepare');}]){const free=vi.fn(core.free_f64);state.core={...core,free_f64:free,book_motion_prepare:run};expect(createRustBookMotion(input)).toBeNull();expect(free).toHaveBeenCalledOnce();}
});
it('reports a failed sample instead of handing the pose to another sampler',()=>{
 for(const run of [()=>0,()=>{throw Error('sample');}]){
  state.core={...core,book_motion_sample:run};const motion=createRustBookMotion(frames('turn'));
  try{expect(()=>motion.sample(.4)).toThrow();}finally{motion.dispose();}
 }
});
it('follows the original arithmetic for progress outside 0..1, NaN and infinities',()=>{
 state.core=core;
 for(const kind of ['flat','turn','ascending','partial']){
  const input=frames(kind);if(kind==='partial'){delete input[1].transform.roll;delete input[2].transform.coverOpen;}
  const motion=createRustBookMotion(input);
  try{for(const t of [NaN,Infinity,-Infinity,-0,0,1,2,-3,.5,Number.MIN_VALUE,1-Number.EPSILON])expect(motion.sample(t),`${kind} ${t}`).toEqual(reference(input,t));}finally{motion.dispose();}
 }
});
it('keeps one frame, or more than a thousand, out of the kernel',()=>{
 const one=frames('ascending');one.splice(1);expect(createRustBookMotion(one)).toBeNull();
 expect(createRustBookMotion(frames('ascending',1025))).toBeNull();
 const most=createRustBookMotion(frames('turn',1024));expect(most).not.toBeNull();most.dispose();
});
// The original sampler never rejected keyframes: degenerate offsets and values simply flow
// through IEEE arithmetic, and the kernels do the same.
for(const kind of ['duplicate','reverse','nan','infinite','string','nullish','negative-zero'])it(`gives the original numbers for ${kind} input`,()=>{
 const input=frames('ascending');
 if(kind==='duplicate')input[1].offset=input[0].offset;
 if(kind==='reverse')input[1].offset=-1;
 if(kind==='nan')input[1].offset=NaN;
 if(kind==='infinite')input[1].transform.x=Infinity;
 if(kind==='string'){input[1].transform.x='1';input[2].offset='0.75';}
 if(kind==='nullish'){input[1].transform.y=null;input[2].transform.scale=undefined;}
 if(kind==='negative-zero')for(const frame of input)frame.transform.angle=-0;
 const motion=createRustBookMotion(input);expect(motion).not.toBeNull();
 try{for(const t of [NaN,-1,0,.2,1/3,.5,.75,.9,1,2])expect(motion.sample(t),`${kind} ${t}`).toEqual(reference(input,t));}finally{motion.dispose();}
});
it('steps the clock exactly as the original callback did',()=>{
 state.core=core;
 let seed=3141;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
 for(const duration of [0,-5,NaN,undefined,null,1,47,48,96,200,360,520,580,620,720,2000,1e9,Infinity]){
  const motion=createRustBookMotion(frames('turn'));
  try{
   const begin=1000+random()*1e6,original=originalClock(duration,begin);motion.start(duration,begin);
   let now=begin;
   for(let call=0;call<60;call++){
    // Normal 8 ms frames, stalls past the longest step, and callbacks that run before the previous one.
    now+=[8.3,16.7,33.4,120,5000,-4,0,.0001][Math.floor(random()*8)]*(random()<.7?1:random());
    expect(motion.step(now),`${duration} ${call}`).toBe(original(now));
   }
  }finally{motion.dispose();}
 }
});
it('does not touch freed memory when a disposed motion is stepped',()=>{
 state.core=core;const motion=createRustBookMotion(frames('turn'));motion.start(500,10);motion.dispose();
 const before=new Uint8Array(core.memory.buffer.slice(0,4096));
 expect(motion.step(20)).toBe(1);motion.start(100,0);expect(motion.sample(.5)).toBeUndefined();
 expect(Buffer.compare(Buffer.from(before),Buffer.from(new Uint8Array(core.memory.buffer,0,4096)))).toBe(0);
});
