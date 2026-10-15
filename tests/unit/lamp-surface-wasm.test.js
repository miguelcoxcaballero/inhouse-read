// @vitest-environment node
import {readFileSync} from 'node:fs';
import {beforeAll,afterEach,expect,it,vi} from 'vitest';
const state=vi.hoisted(()=>({core:null}));
vi.mock('../../src/js/rust-decor-core.js',()=>({getRustDecorCore:()=>state.core,loadRustDecorCore:async()=>state.core??(await globalThis.__inhouseDecorReady).exports}));
import {rustLampSurface} from '../../src/js/lamp-surface-wasm.js';
import {createShelfLamp} from '../../src/js/shelf-lamps.js';
import {createShelfLamp as originalLamp} from './helpers/reference-shelf-lamps.js';
import {lampSurface as reference} from './helpers/reference-lamp-surface.js';
let core;
beforeAll(async()=>{core=(await WebAssembly.instantiate(readFileSync('src/wasm/inhouse_read_decor.wasm'))).instance.exports;expect(typeof core.lamp_surface_rows).toBe('function');state.core=core;});
afterEach(()=>{state.core=core;});
function exact(a,b){expect(a).toBeDefined();expect(a.width).toBe(b.width);expect(a.height).toBe(b.height);for(const name of ['pigment','data']){expect(a[name].length).toBe(b[name].length);for(let i=0;i<b[name].length;i++)if(a[name][i]!==b[name][i])throw Error(`${name}[${i}]: ${a[name][i]} / ${b[name][i]}`);}}
for(const kind of ['wood','linen','black'])for(const detail of [1,2])it(`keeps every ${kind} texel at quality ${detail}`,()=>{
 const width=(kind==='wood'?128:256)*detail,height=kind==='wood'?512*detail:width;
 exact(rustLampSurface(kind,width,height),reference(kind,width,height));
});
it('handles partial final rows and narrow/non-square maps',()=>{
 for(const kind of ['wood','linen','black'])for(const [w,h] of [[1,1],[7,3],[15,17],[19,33],[33,65],[120,81]])exact(rustLampSurface(kind,w,h),reference(kind,w,h));
});
it('owns output bytes across row batches, memory growth and later calls',()=>{
 const free=vi.fn(core.free_f64);state.core={...core,free_f64:free,lamp_surface_rows(...args){core.memory.grow(1);return core.lamp_surface_rows(...args);}};
 const result=rustLampSurface('linen',40,35),copy=structuredClone(result);rustLampSurface('wood',41,39);core.memory.grow(1);exact(result,copy);exact(result,reference('linen',40,35));expect(free).toHaveBeenCalledTimes(2);
});
it('returns the refusal signal and frees arenas on errors',()=>{
 for(const engine of [null,{}, {...core,alloc_f64:()=>0},{...core,lamp_surface_rows:()=>0},{...core,lamp_surface_rows:()=>{throw Error('trap');}}]){
  const free=vi.fn(core.free_f64);state.core=engine?{...engine,free_f64:free}:null;expect(rustLampSurface('wood',8,17)).toBeUndefined();
  if(engine?.lamp_surface_rows&&engine.alloc_f64===core.alloc_f64)expect(free).toHaveBeenCalledOnce();
 }
});
it('reports a lamp whose surfaces the core cannot paint instead of painting them another way',()=>{
 for(const engine of [null,{}, {...core,alloc_f64:()=>0},{...core,lamp_surface_rows:()=>0},{...core,lamp_surface_rows:()=>{throw Error('trap');}}]){
  state.core=engine;expect(()=>createShelfLamp({lampId:'tripod',quality:'low'})).toThrow('Las texturas de la lámpara no se pudieron calcular. Recarga la página.');
 }
});
it('rejects invalid dimensions and kinds before native access',()=>{
 const alloc=vi.fn(core.alloc_f64);state.core={...core,alloc_f64:alloc};for(const values of [['unknown',16,16],['wood',0,10],['wood',2.5,10],['linen',8,Infinity],['black',2049,10]])expect(rustLampSurface(...values)).toBeUndefined();expect(alloc).not.toHaveBeenCalled();
});
it('rejects invalid raw row ranges',()=>{
 const p=core.alloc_f64(16);try{for(const args of [[0,1,0,1,0],[1,1,1,1,0],[1,20,0,17,0],[1,20,10,11,0],[1,1,0,1,3]])expect(core.lamp_surface_rows(...args,p)).toBe(0);}finally{core.free_f64(p,16);}
});

it('keeps all three production lamp models, texture settings and ownership',()=>{
 for(const quality of ['low','high'])for(const lampId of ['mittled','tarnaby','tripod']){
  const call=vi.fn(core.lamp_surface_rows);state.core={...core,lamp_surface_rows:call};const a=createShelfLamp({lampId,quality}),b=originalLamp({lampId,quality});
  try{
   if(lampId!=='mittled')expect(call.mock.calls.length).toBeGreaterThan(0);
   const actual=[],expected=[];a.traverse(o=>{if(o.isMesh)actual.push(o);});b.traverse(o=>{if(o.isMesh)expected.push(o);});expect(actual.length).toBe(expected.length);
   for(let i=0;i<actual.length;i++){
    const x=actual[i],y=expected[i];expect(x.name).toBe(y.name);const left=x.geometry.attributes.position.array,right=y.geometry.attributes.position.array;expect(left.length).toBe(right.length);
    const lb=new Uint32Array(left.buffer,left.byteOffset,left.length),rb=new Uint32Array(right.buffer,right.byteOffset,right.length);for(let j=0;j<lb.length;j++)if(lb[j]!==rb[j])throw Error(`position[${j}] differs`);
    for(const key of ['map','bumpMap','roughnessMap']){
     const m=x.material[key],n=y.material[key];if(!n){expect(m).toBeFalsy();continue;}
     exact({width:m.image.width,height:m.image.height,pigment:m.image.data,data:m.image.data},{width:n.image.width,height:n.image.height,pigment:n.image.data,data:n.image.data});
     expect(m.image.data === n.image.data).toBe(false);for(const field of ['colorSpace','wrapS','wrapT','generateMipmaps','minFilter','magFilter','anisotropy'])expect(m[field]).toBe(n[field]);
    }
   }
  }finally{a.dispose();b.dispose();}
 }
});

