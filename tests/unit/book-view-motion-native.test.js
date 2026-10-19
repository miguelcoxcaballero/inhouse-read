import {afterEach,expect,it,vi} from 'vitest';
import {createBookMotionSampler} from '../../src/js/book-motion.js';
import {referenceBookViewMotion} from './helpers/reference-book-view-motion.js';
import {rustShelf,shelfWasm} from './helpers/rust-shelf-ready.js';
import {rustCore} from './helpers/rust-core-ready.js';
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});
const pose={x:2,y:4,scale:1,angle:9,pitch:0,roll:0,coverOpen:0,bookmarkWithdraw:0,pageTheme:1};
const frames=[{transform:{...pose,x:-999}},{offset:.4,transform:{...pose,x:70,angle:32,coverOpen:.6}},
  {transform:{...pose,x:20,angle:0,coverOpen:1}}];
const options={direct:true,compact:true,adaptive:true,ratio:2,width:360,height:780};
function fixture(native=true){
  let now=0,id=0;const queue=new Map(),trace=[],samplers=[];
  vi.spyOn(performance,'now').mockImplementation(()=>now);
  vi.stubGlobal('requestAnimationFrame',fn=>{queue.set(++id,fn);return id;});
  vi.stubGlobal('cancelAnimationFrame',key=>queue.delete(key));
  const host={
    createSampler(input){const sampler=createBookMotionSampler(input);sampler.dispose=vi.fn(sampler.dispose);samplers.push(sampler);return sampler;},
    draw(value){trace.push(['draw',{...value}]);now+=7;},
    measure(value){trace.push(['measure',{...value}]);return{width:100+Math.ceil(Math.abs(value.x)),height:220+Math.round(Math.abs(value.angle))};},
    position(value){trace.push(['position',{...value}]);},noop(){},
    tick:rustShelf.book_view_motion_tick,cancel:rustShelf.book_view_motion_cancel,release:rustShelf.book_view_motion_release,
  };
  const state=native?rustShelf.book_view_motion_state(host):null,legacy=native?null:referenceBookViewMotion(host);
  const run=(input=frames,{duration=520,onFrame}={})=>native
    ?rustShelf.book_view_motion_start(state,input,duration,onFrame,pose,options)
    :legacy.start(input,{duration,onFrame},pose,options);
  return{host,state,trace,samplers,run,queue,
    step(time){now=time;const callbacks=[...queue.values()];queue.clear();callbacks.forEach(fn=>fn(time-20));},
    capacity:()=>native?state.motionCapacity:legacy.motionCapacity,
    dispose:()=>native?rustShelf.book_view_motion_dispose(state):legacy.dispose(),
  };
}

it.each([0,80,520,1500])('matches original poses, geometry probes and post-draw clocks for duration %s',async duration=>{
  const results=[];
  for(const native of[false,true]){
    const f=fixture(native),animation=f.run(frames,{duration}),reserved=f.capacity();
    const clocks=[];for(const time of[16,40,80,1000,1016,1400,1800,2200,2600,3000,3400,3800,4200,4600,5000,5400,5800,6200,6600,7000]){
      if(!f.queue.size)break;f.step(time);clocks.push(animation.lastFrameTime);
    }
    await animation.finished;results.push({trace:f.trace,reserved,clocks,capacity:f.capacity(),pending:f.queue.size});
    f.dispose();vi.restoreAllMocks();vi.unstubAllGlobals();
  }
  expect(results[1]).toEqual(results[0]);expect(results[1].pending).toBe(0);expect(results[1].capacity).toBeNull();
});

it('retains the same no-draw bookmark clock while the native frame handles its pose',async()=>{
  const results=[];
  for(const native of[false,true]){
    const f=fixture(native),seen=[],animation=f.run(frames,{duration:200,onFrame:value=>{seen.push({...value});return true;}});
    f.step(16);f.step(500);f.step(800);await animation.finished;
    results.push({seen,trace:f.trace,time:animation.lastFrameTime});f.dispose();vi.restoreAllMocks();vi.unstubAllGlobals();
  }
  expect(results[1]).toEqual(results[0]);expect(results[1].trace).toEqual([]);
});

it('a stale cancellation handle cannot clear a newer reservation or schedule another frame',async()=>{
  const f=fixture(),first=f.run();f.step(16);const second=f.run();const capacity=f.capacity();
  first.cancel();expect(f.capacity()).toBe(capacity);expect(f.queue.size).toBe(1);
  second.cancel();await Promise.all([first.finished,second.finished]);
  expect(f.capacity()).toBeNull();expect(f.queue.size).toBe(0);
  f.samplers.forEach(sampler=>expect(sampler.dispose).toHaveBeenCalledOnce());f.dispose();
});

it('releases nested framebuffer tokens once and ignores late release after disposal',()=>{
  const f=fixture(),frame={width:123,height:456};
  const first=rustShelf.book_view_motion_hold(f.state,frame,options),second=rustShelf.book_view_motion_hold(f.state,null,options);
  expect(f.state.nativeCapacity).toEqual(frame);first();first();expect(f.state.holds).toBe(1);
  f.dispose();expect(f.state.nativeCapacity).toBeNull();second();second();expect(f.state.holds).toBe(0);
});

it.each([{direct:false},{compact:false},{adaptive:false},{ratio:1.5},{width:360.5},{height:NaN},{ratio:Infinity},{ratio:'2'}])('keeps the original reservation eligibility for %j',patch=>{
  const f=fixture(),release=rustShelf.book_view_motion_hold(f.state,{width:123,height:456},{...options,...patch});
  expect(f.state.holds).toBe(0);expect(f.state.nativeCapacity).toBeNull();release();f.dispose();
});

it('does not resurrect animation when a frame consumer disposes the book',async()=>{
  const f=fixture();const animation=f.run(frames,{onFrame(){f.dispose();return true;}});
  f.step(16);await animation.finished;expect(f.queue.size).toBe(0);expect(f.samplers[0].dispose).toHaveBeenCalledOnce();
  const ignored=f.run();await ignored.finished;expect(f.samplers).toHaveLength(1);expect(f.queue.size).toBe(0);
});

it('releases the sampler if a geometry probe or drawing fails',async()=>{
  const f=fixture();f.host.measure=()=>{throw Error('Projection failed');};
  expect(()=>f.run()).toThrow('Projection failed');expect(f.samplers[0].dispose).toHaveBeenCalledOnce();
  expect(f.trace.at(-1)).toEqual(['position',pose]);
  f.host.measure=()=>({width:100,height:200});f.host.draw=()=>{throw Error('Context lost');};
  const animation=f.run();expect(()=>f.step(16)).toThrow('Context lost');await animation.finished;
  expect(f.samplers[1].dispose).toHaveBeenCalledOnce();expect(f.queue.size).toBe(0);expect(f.state.active).toBeNull();f.dispose();
});

it('does not retain native handles or increase WASM memory through 1000 completed reservations and cancellations',async()=>{
  const f=fixture(),exercise=async()=>{const release=rustShelf.book_view_motion_hold(f.state,{width:1,height:2},options);const animation=f.run(frames,{duration:0});animation.cancel();await animation.finished;release();};
  for(let i=0;i<100;i++)await exercise();
  const handles=rustShelf.shelf_live_handles(),callbacks=rustShelf.shelf_pending_callbacks(),shelfBytes=shelfWasm.memory.buffer.byteLength,coreBytes=rustCore.memory.buffer.byteLength;
  for(let i=0;i<1000;i++)await exercise();
  expect(rustShelf.shelf_live_handles()).toBe(handles);expect(rustShelf.shelf_pending_callbacks()).toBe(callbacks);
  expect(shelfWasm.memory.buffer.byteLength).toBe(shelfBytes);expect(rustCore.memory.buffer.byteLength).toBe(coreBytes);f.dispose();
});
