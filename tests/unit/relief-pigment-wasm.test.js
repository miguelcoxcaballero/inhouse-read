// @vitest-environment node
import {readFileSync} from 'node:fs';
import {beforeAll,afterEach,expect,it,vi} from 'vitest';
const state=vi.hoisted(()=>({core:null}));
vi.mock('../../src/js/rust-core.js',()=>({getRustCore:()=>state.core,loadRustCore:async()=>state.core}));
import {buildMapsFromPixels} from '../../src/js/cover-relief.js';
import {wasmPigmentMaps} from '../../src/js/cover-relief-wasm.js';
import {referencePigment} from './helpers/reference-relief-pigment.js';
let core;
beforeAll(async()=>{core=(await WebAssembly.instantiate(readFileSync('src/wasm/inhouse_read_core.wasm'))).instance.exports;expect(typeof core.relief_pigment_pixels).toBe('function');state.core=core;});
afterEach(()=>{state.core=core;});
function drain(task){let yields=0;for(;;){const step=task.next();if(step.done)return {out:step.value,yields};yields++;}}
function exact(a,b){
 expect(a.yields).toBe(b.yields);
 for(const key of Object.keys(b.out)){
  const x=a.out[key],y=b.out[key];
  if(ArrayBuffer.isView(y)){expect(x.constructor).toBe(y.constructor);expect(x.length).toBe(y.length);for(let i=0;i<y.length;i++)if(!Object.is(x[i],y[i]))throw Error(key+'['+i+']: '+x[i]+' / '+y[i]);}
  else expect(x).toEqual(y);
 }
}
function membership(w,h,seed=17){return Float32Array.from({length:w*h},()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed%7===0?0:(seed>>>24)/255;});}
function previous(w,h){return {owners:new Uint8Array(w*h),baseMask:new Uint8Array(w*h),baseHeight:new Float32Array(w*h),owner:1,heightMM:.26};}
for(const [w,h] of [[1,1],[17,15],[31,16],[19,17],[64,64],[216,288],[512,512]])for(const layered of [false,true])it(`preserves pigment bevel ${w}x${h}, layered ${layered}`,()=>{
 const input=membership(w,h),prev=layered?previous(w,h):null,actual=drain(wasmPigmentMaps(core,input,w,h,prev)),expected=drain(referencePigment(core,input,w,h,prev));exact(actual,expected);
});
it('preserves independent heights and exclusive ownership through ten overlapping pigments',()=>{
 const w=71,h=113;let a=previous(w,h),b=previous(w,h);
 for(let i=1;i<=10;i++){
  const input=membership(w,h,i),owner=i,heightMM=.16+i*.014;
  const actual=drain(wasmPigmentMaps(core,input,w,h,{...a,owner,heightMM})),expected=drain(referencePigment(core,input,w,h,{...b,owner,heightMM}));exact(actual,expected);a=actual.out;b=expected.out;
 }
 // Equal membership keeps the first owner's exact height, regardless of new profile.
 const input=membership(w,h,10);exact(drain(wasmPigmentMaps(core,input,w,h,{...a,owner:2,heightMM:.01})),drain(referencePigment(core,input,w,h,{...b,owner:2,heightMM:.01})));
});
it('matches empty, solid and boundary-rounding memberships',()=>{
 for(const value of [0,1,-0,.5,Math.fround(.5/255),Math.fround(127.5/255)]){
  const input=new Float32Array(63*65).fill(value);
  for(const prev of [null,previous(63,65)])exact(drain(wasmPigmentMaps(core,input,63,65,prev)),drain(referencePigment(core,input,63,65,prev)));
 }
});
it('uses native membership and bevel passes in the whole single and multicolour builders',()=>{
 const width=71,height=113,data=new Uint8ClampedArray(width*height*4),colors=[[35,80,181],[212,169,60],[255,250,240]];
 for(let i=0;i<width*height;i++)data.set([...colors[Math.floor(i/width)%3],255],i*4);
 const image={width,height,data};
 for(const choice of [{id:'color-1',color:'#2350b5',tolerance:6,strength:.7},{layers:[{id:'color-1',color:'#2350b5',tolerance:6,strength:.7},{id:'color-2',color:'#d4a93c',tolerance:5,strength:.4},{id:'color-3',color:'#fffaf0',tolerance:4,strength:1}]}]){
  state.core={...core,relief_membership_pixels:undefined};const expected=drain(buildMapsFromPixels(image,image,choice));
  const call=vi.fn(core.relief_pigment_pixels);state.core={...core,relief_pigment_pixels:call};const actual=drain(buildMapsFromPixels(image,image,choice));exact(actual,expected);expect(call).toHaveBeenCalled();
 }
});
it('frees cancelled jobs at every stage and retains source/output ownership across memory growth',()=>{
 const w=63,h=65,input=membership(w,h),prev=previous(w,h),free=vi.fn(core.free_f64),engine={...core,free_f64:free};
 const expected=drain(referencePigment(core,input,w,h,prev));
 for(const steps of [1,2,5,9]){const task=wasmPigmentMaps(engine,input,w,h,prev);for(let i=0;i<steps;i++)if(task.next().done)break;task.return();}
 expect(free).toHaveBeenCalledTimes(4);free.mockClear();
 const task=wasmPigmentMaps(engine,input,w,h,prev);let yields=0,result;
 for(;;){const step=task.next();if(step.done){result={out:step.value,yields};break;}yields++;core.memory.grow(1);}
 exact(result,expected);expect(free).toHaveBeenCalledOnce();expect(prev.owners.some(Boolean)).toBe(false);expect(prev.baseMask.some(Boolean)).toBe(false);expect(prev.baseHeight.some(Boolean)).toBe(false);
 drain(wasmPigmentMaps(core,membership(512,512),512,512));exact(result,expected);
});
it('releases arenas when a late pass throws without modifying classification',()=>{
 const w=63,h=65,prev=previous(w,h),input=membership(w,h),free=vi.fn(core.free_f64),engine={...core,free_f64:free,relief_pigment_pixels:()=>{throw Error('late trap');}};
 expect(()=>drain(wasmPigmentMaps(engine,input,w,h,prev))).toThrow('late trap');expect(free).toHaveBeenCalledOnce();expect(prev.owners.some(Boolean)).toBe(false);expect(prev.baseMask.some(Boolean)).toBe(false);
});
it('rejects malformed input before allocation',()=>{
 const alloc=vi.fn(core.alloc_f64),engine={...core,alloc_f64:alloc};
 for(const args of [[new Float32Array(1),0,1],[new Float32Array(4),2,3],[[],2,2],[new Float32Array(4),2,2,{...previous(2,2),owner:11}]])expect(drain(wasmPigmentMaps(engine,...args)).out).toBeNull();expect(alloc).not.toHaveBeenCalled();
});

it('keeps full multi-colour output when a later layer fails after writing a partial scratch pass',()=>{
 const width=71,height=113,data=new Uint8ClampedArray(width*height*4),colors=[[35,80,181],[212,169,60],[255,250,240]];
 for(let i=0;i<width*height;i++)data.set([...colors[Math.floor(i/width)%3],255],i*4);
 const image={width,height,data},choice={layers:['#2350b5','#d4a93c','#fffaf0'].map((color,i)=>({id:'color-'+(i+1),color,tolerance:6,strength:.7}))};
 state.core={...core,relief_membership_pixels:undefined};const expected=drain(buildMapsFromPixels(image,image,choice));let failed=false;
 state.core={...core,relief_pigment_pixels:(...args)=>{if(args[11]===2&&args[7]===1024){failed=true;throw Error('partial second layer');}return core.relief_pigment_pixels(...args);}};
 const actual=drain(buildMapsFromPixels(image,image,choice));expect(failed).toBe(true);exact({...actual,yields:0},{...expected,yields:0});
});
