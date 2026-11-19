// @vitest-environment node
// A book's motion is sampled inside the shelf module (rust-ui/src/book_sampler.rs over the core's kernel,
// rust-core/src/book_motion.rs). Production is compared, pose for pose and clock step for clock step, with the
// original JavaScript sampler and clock (helpers/reference-book-motion.js) and with the bridge that marshalled the
// keyframes into the numeric core until then (helpers/reference-book-motion-bridge.js).
import {expect,it} from 'vitest';
import {rustShelf} from './helpers/rust-shelf-ready.js';
import {createRustBookMotion,createBookMotionSampler,sampleBookMotion,MOTION_KEYS} from './helpers/book-motion.js';
import {sampleBookMotion as reference,originalClock} from './helpers/reference-book-motion.js';
import * as bridge from './helpers/reference-book-motion-bridge.js';

// Same keys in the same order, same numbers bit for bit (-0 and NaN included).
function same(actual,expected,label){
 expect(Object.keys(actual),label).toEqual(Object.keys(expected));
 for(const key of Object.keys(expected))expect(Object.is(actual[key],expected[key]),`${label} ${key}: ${actual[key]} / ${expected[key]}`).toBe(true);
}
// Production against the frozen bridge exactly, and against the original sampler as the bridge's own suite did.
function check(input,times,label=''){
 const motion=createRustBookMotion(input),frozen=bridge.createRustBookMotion(input);
 expect(motion).not.toBeNull();expect(frozen).not.toBeNull();
 try{for(const t of times){const pose=motion.sample(t);same(pose,frozen.sample(t),`${label} ${t}`);expect(pose,`${label} ${t}`).toEqual(reference(input,t));}}
 finally{motion.dispose();frozen.dispose();}
}
const frames=(kind,count=4)=>Array.from({length:count},(_,i)=>({offset:i/(count-1),transform:Object.fromEntries(MOTION_KEYS.map((key,k)=>[key,kind==='flat'?3:kind==='turn'?(i%2?-2:3)*(k+1):i*(k+1)]))}));
for(const kind of ['flat','turn','ascending','descending','partial','unthemed'])it(`preserves every ${kind} frame exactly`,()=>{
 const input=frames(kind);
 if(kind==='descending')input.forEach(frame=>{for(const key of MOTION_KEYS)frame.transform[key]*=-1;});
 if(kind==='partial'){delete input[1].transform.roll;delete input[2].transform.coverOpen;}
 if(kind==='unthemed')delete input[1].transform.pageTheme;
 input[1].offset=.18;input[2].offset=.77;
 check(input,Array.from({length:111},(_,i)=>(i-5)/100),kind);
});
it('preserves implicit offsets, absent components and signed zero',()=>{
 check([{transform:{angle:-0}},{transform:{angle:3}},{transform:{angle:0}}],[-0,0,.2,.5,.8,1]);
});
it('does not mutate caller keyframes during preparation or sampling',()=>{
 const input=frames('turn');for(const frame of input){Object.freeze(frame.transform);Object.freeze(frame);}Object.freeze(input);
 const copy=JSON.stringify(input),motion=createRustBookMotion(input);
 try{expect(motion.sample(.37)).toEqual(reference(input,.37));expect(JSON.stringify(input)).toBe(copy);}finally{motion.dispose();}
});
it('matches randomized nonuniform keyframes and exact keyframe boundaries',()=>{
 let seed=8742;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
 for(let j=0;j<400;j++){
  const count=2+Math.floor(random()*14),input=frames('ascending',count);let end=0;
  for(const frame of input){frame.offset=end;end+=.01+random();for(const key of MOTION_KEYS)frame.transform[key]=(random()-.5)*1000;}
  const last=input.at(-1).offset;for(const frame of input)frame.offset/=last;
  // Some motions leave the theme, a component or an offset out.
  if(j%3===1)delete input[Math.floor(random()*count)].transform.pageTheme;
  if(j%5===2)delete input[Math.floor(random()*count)].transform[MOTION_KEYS[Math.floor(random()*8)]];
  if(j%7===3)for(const frame of input)delete frame.offset;
  check(input,[...input.map(f=>f.offset??0),...Array.from({length:30},random)],`motion ${j}`);
 }
});
it('keeps motions independent, closes each exactly once and leaves none open',()=>{
 const before=rustShelf.book_samplers_open();
 const a=createRustBookMotion(frames('ascending')),b=createRustBookMotion(frames('turn'));
 expect(rustShelf.book_samplers_open()).toBe(before+2);
 a.dispose();a.dispose();expect(a.sample(.5)).toBeUndefined();expect(rustShelf.book_samplers_open()).toBe(before+1);
 // A motion opened in the slot the first one left does not answer through the closed one.
 const c=createRustBookMotion(frames('flat'));expect(a.sample(.5)).toBeUndefined();expect(a.step(5)).toBe(1);
 expect(b.sample(.5)).toEqual(reference(frames('turn'),.5));expect(c.sample(.5)).toEqual(reference(frames('flat'),.5));
 b.dispose();c.dispose();expect(rustShelf.book_samplers_open()).toBe(before);
});
it('samples the same poses after the module\'s memory has grown and while other motions come and go',()=>{
 const input=frames('turn'),motion=createRustBookMotion(input),others=[];
 try{
  const first=motion.sample(.3);
  for(let i=0;i<64;i++)others.push(createRustBookMotion(frames('ascending',1024)));
  expect(motion.sample(.6)).toEqual(reference(input,.6));expect(first).toEqual(reference(input,.3));
  others.splice(0).forEach(other=>other.dispose());expect(motion.sample(.9)).toEqual(reference(input,.9));
 }finally{motion.dispose();others.forEach(other=>other.dispose());}
});
it('refuses what the bridge refused, with the same error, and keeps nothing open',()=>{
 const before=rustShelf.book_samplers_open(),good=frames('ascending');
 const holed=frames('ascending');delete holed[2];
 const cases=[null,undefined,[],good.slice(0,1),frames('ascending',1025),'ab',{length:3},holed,
  [good[0],null,good[2]],[good[0],{offset:.5},good[2]],[good[0],{offset:.5,transform:null},good[2]],
  [good[0],{offset:Symbol('half'),transform:good[1].transform},good[2]],[good[0],{offset:.5,transform:{...good[1].transform,x:Symbol('x')}},good[2]]];
 for(const input of cases){
  expect(bridge.createRustBookMotion(input)).toBeNull();expect(createRustBookMotion(input)).toBeNull();
  let frozen,actual;
  try{bridge.createBookMotionSampler(input);}catch(error){frozen=error;}
  try{createBookMotionSampler(input);}catch(error){actual=error;}
  expect(actual).toBeInstanceOf(RangeError);expect(actual.message).toBe(frozen.message);
  expect(()=>sampleBookMotion(input,.5)).toThrow(RangeError);
 }
 expect(rustShelf.book_samplers_open()).toBe(before);
});
it('follows the original arithmetic for progress outside 0..1, NaN and infinities',()=>{
 for(const kind of ['flat','turn','ascending','partial']){
  const input=frames(kind);if(kind==='partial'){delete input[1].transform.roll;delete input[2].transform.coverOpen;}
  check(input,[NaN,Infinity,-Infinity,-0,0,1,2,-3,.5,Number.MIN_VALUE,1-Number.EPSILON],kind);
 }
});
it('keeps one frame, or more than a thousand, out of the kernel',()=>{
 const one=frames('ascending');one.splice(1);expect(createRustBookMotion(one)).toBeNull();
 expect(createRustBookMotion(frames('ascending',1025))).toBeNull();
 const most=createRustBookMotion(frames('turn',1024));expect(most).not.toBeNull();most.dispose();
});
// The original sampler never rejected keyframes: degenerate offsets and values simply flow
// through IEEE arithmetic, and the kernels do the same.
for(const kind of ['duplicate','reverse','nan','infinite','string','nullish','negative-zero','objects'])it(`gives the original numbers for ${kind} input`,()=>{
 const input=frames('ascending');
 if(kind==='duplicate')input[1].offset=input[0].offset;
 if(kind==='reverse')input[1].offset=-1;
 if(kind==='nan')input[1].offset=NaN;
 if(kind==='infinite')input[1].transform.x=Infinity;
 if(kind==='string'){input[1].transform.x='1';input[2].offset='0.75';}
 if(kind==='nullish'){input[1].transform.y=null;input[2].transform.scale=undefined;}
 if(kind==='negative-zero')for(const frame of input)frame.transform.angle=-0;
 if(kind==='objects'){input[1].transform.x={valueOf:()=>7};input[2].transform.y=true;input[1].offset=[.4];input[2].transform.roll='';input[1].transform.pitch='pitch';}
 check(input,[NaN,-1,0,.2,1/3,.5,.75,.9,1,2],kind);
});
it('steps the clock exactly as the original callback and the bridge did',()=>{
 let seed=3141;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
 for(const duration of [0,-5,NaN,undefined,null,1,47,48,96,200,360,520,580,620,720,2000,1e9,Infinity]){
  const motion=createRustBookMotion(frames('turn')),frozen=bridge.createRustBookMotion(frames('turn'));
  try{
   const begin=1000+random()*1e6,original=originalClock(duration,begin);motion.start(duration,begin);frozen.start(duration,begin);
   let now=begin;
   for(let call=0;call<60;call++){
    // Normal 8 ms frames, stalls past the longest step, and callbacks that run before the previous one.
    now+=[8.3,16.7,33.4,120,5000,-4,0,.0001][Math.floor(random()*8)]*(random()<.7?1:random());
    const step=motion.step(now);
    expect(step,`${duration} ${call}`).toBe(original(now));expect(Object.is(step,frozen.step(now)),`${duration} ${call}`).toBe(true);
   }
  }finally{motion.dispose();frozen.dispose();}
 }
});
it('a closed motion steps to its end and samples nothing',()=>{
 const motion=createRustBookMotion(frames('turn'));motion.start(500,10);motion.dispose();
 expect(motion.step(20)).toBe(1);motion.start(100,0);expect(motion.sample(.5)).toBeUndefined();
});
