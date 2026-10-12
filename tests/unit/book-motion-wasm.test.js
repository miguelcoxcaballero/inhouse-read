// @vitest-environment node
import {readFileSync} from 'node:fs';
import {beforeAll,afterEach,expect,it,vi} from 'vitest';
const state=vi.hoisted(()=>({core:null}));
vi.mock('../../src/js/rust-core.js',()=>({getRustCore:()=>state.core}));
import {createRustBookMotion,MOTION_KEYS} from '../../src/js/book-motion-wasm.js';
import {sampleBookMotion as reference} from './helpers/reference-book-motion.js';
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
it('returns no pose on a failed or nonfinite sample so the host uses its original sampler',()=>{
 for(const run of [()=>0,()=>{throw Error('sample');}]){
  state.core={...core,book_motion_sample:run};const motion=createRustBookMotion(frames('turn'));
  try{expect(motion.sample(.4)).toBeUndefined();}finally{motion.dispose();}
 }
 state.core=core;const motion=createRustBookMotion(frames('flat'));
 try{expect(motion.sample(NaN)).toBeUndefined();expect(motion.sample(Infinity)).toBeUndefined();}finally{motion.dispose();}
});
for(const kind of ['one','duplicate','reverse','nan','infinite','string'])it(`rejects ${kind} input to preserve the original edge-case behavior`,()=>{
 const input=frames('ascending');
 if(kind==='one')input.splice(1);
 if(kind==='duplicate')input[1].offset=input[0].offset;
 if(kind==='reverse')input[1].offset=-1;
 if(kind==='nan')input[1].offset=NaN;
 if(kind==='infinite')input[1].transform.x=Infinity;
 if(kind==='string')input[1].transform.x='1';
 expect(createRustBookMotion(input)).toBeNull();
});
