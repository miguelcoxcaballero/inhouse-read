// @vitest-environment node
import {readFileSync} from 'node:fs';
import {beforeAll,afterEach,expect,it,vi} from 'vitest';
const state=vi.hoisted(()=>({core:null}));
vi.mock('../../src/js/rust-core.js',()=>({getRustCore:()=>state.core}));
import {rustPDFPlaceFigures,pdfPlaceFigures} from '../../src/js/readers/pdf-figures-wasm.js';
import {placeFigures as reference} from './helpers/reference-pdf-figures.js';
let core;
beforeAll(async()=>{core=(await WebAssembly.instantiate(readFileSync('src/wasm/inhouse_read_core.wasm'))).instance.exports;expect(typeof core.pdf_place_figures).toBe('function');state.core=core;});
afterEach(()=>{state.core=core;});
const source={width:600,height:800},viewport={width:600,height:800,transform:[1,0,0,-1,0,800]};
function fixture(count=60,columns=2,angle=0){
 let text='';const lines=Array.from({length:count},(_,i)=>{
  const str='Línea '+i+' 漢字 🦊. ',start=text.length;text+=str;
  return {x0:i%columns*250+20,x1:i%columns*250+200,y:Math.floor(i/columns)*22+20,height:12,start,column:'column-'+i%columns,
   entries:[{item:{str,transform:[Math.cos(angle),Math.sin(angle),-Math.sin(angle),Math.cos(angle),0,0]}}]};
 });
 return {text,lines,geometric:true};
}
const rects=Array.from({length:32},(_,i)=>({x0:i%2*250+30,x1:i%2*250+150,y0:Math.floor(i/2)*33,y1:Math.floor(i/2)*33+16}));
function compare(boxes,layout,src=source,view=viewport){
 const original=structuredClone({boxes,layout,src,view}),expected=reference(boxes,layout,src,view),actual=rustPDFPlaceFigures(boxes,layout,src,view);
 expect(actual).toEqual(expected);expect(pdfPlaceFigures(boxes,layout,src,view)).toEqual(expected);
 for(let i=0;i<actual.length;i++)expect(actual[i].rect).toBe(expected[i].rect);
 expect({boxes,layout,src,view}).toEqual(original);return actual;
}
for(const angle of [0,Math.PI/2,Math.PI,Math.PI*1.5,.371,-.731])it(`preserves illustration placement for page rotation ${angle}`,()=>{
 compare(rects,fixture(100,3,angle));
});
it('retains stable offsets and ties across RTL columns and undefined column identifiers',()=>{
 const layout=fixture();layout.lines.reverse();layout.lines[0].column=undefined;
 const repeated=[...rects,...rects.map(rect=>({...rect}))];compare(repeated,layout);
});
it('projects scaled original pixels with nonuniform viewport dimensions and the default transform',()=>{
 compare(rects,fixture(),{width:1200,height:1600},{width:500,height:900});
});
it('places disconnected pictures at the first following line or the UTF-16 text end',()=>{
 compare([{x0:550,x1:590,y0:-40,y1:-10},{x0:550,x1:590,y0:900,y1:940}],fixture());
});
it('retains the original first dominant entry when lengths tie',()=>{
 const layout=fixture();layout.lines[0].entries=[{item:{str:'X'.repeat(100),transform:[0,1,-1,0,0,0]}},{item:{str:'Y'.repeat(100),transform:[1,0,0,1,0,0]}}];compare(rects,layout);
});
it('matches two hundred randomized reading streams, viewports and source rectangles',()=>{
 let seed=47374;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
 for(let trial=0;trial<200;trial++){
  const layout=fixture(10+trial%121,1+trial%4,random()*Math.PI*2);
  const boxes=Array.from({length:8+trial%48},()=>{const x0=random()*650-25,y0=random()*850-25;return{x0,y0,x1:x0+random()*100,y1:y0+random()*90};});
  compare(boxes,layout,{width:300+random()*900,height:400+random()*1200},viewport);
 }
});
it('supports two thousand illustrations without truncating the original text offsets',()=>{compare(Array.from({length:2000},(_,i)=>({...rects[i%32]})),fixture(400,4));});
it('answers small pages and layouts without geometry in the kernel as well',()=>{
 const call=vi.fn(core.pdf_place_figures);state.core={...core,pdf_place_figures:call};
 expect(pdfPlaceFigures(rects.slice(0,7),fixture(),source,viewport)).toEqual(reference(rects.slice(0,7),fixture(),source,viewport));expect(call).toHaveBeenCalledTimes(1);
 for(const layout of [{...fixture(),geometric:false},{text:'Full text 🦊',lines:[],geometric:true}]){
  const expected=reference(rects,layout,source,viewport);
  expect(rustPDFPlaceFigures(rects,layout,source,viewport)).toEqual(expected);expect(pdfPlaceFigures(rects,layout,source,viewport)).toEqual(expected);
  expect(pdfPlaceFigures(rects,layout,undefined,undefined)).toEqual(expected);
  expect(expected.every(({offset})=>offset===layout.text.length)).toBe(true);
 }
 expect(rustPDFPlaceFigures([],fixture(),source,viewport)).toEqual([]);
});
it('reports absent, old, allocation-failing and trapping cores as errors',()=>{
 for(const value of [null,{}, {...core,alloc_f64:()=>0},{...core,pdf_place_figures:()=>0},{...core,pdf_place_figures:()=>{throw Error('trap');}}]){
  state.core=value;expect(()=>pdfPlaceFigures(rects,fixture(),source,viewport)).toThrow(value?'No se pudo calcular la página del PDF':'El módulo numérico no se pudo cargar');
 }
});
it('frees memory on invalid line values, native failures and malformed output permutations',()=>{
 for(const bad of [()=>0,(_p,_n,_c,_r,_i,_params,out)=>{new Float64Array(core.memory.buffer,out,4).set([0,0,0,0]);return 1;},()=>{throw Error('trap');}]){
  const free=vi.fn(core.free_f64);state.core={...core,free_f64:free,pdf_place_figures:bad};expect(rustPDFPlaceFigures(rects,fixture(),source,viewport)).toBeUndefined();expect(free).toHaveBeenCalledOnce();
 }
 const free=vi.fn(core.free_f64);state.core={...core,free_f64:free};const layout=fixture();layout.lines[0].start=NaN;
 expect(rustPDFPlaceFigures(rects,layout,source,viewport)).toBeUndefined();expect(free).toHaveBeenCalledOnce();
});
it('returns host-owned objects when memory grows during and after the native call',()=>{
 const free=vi.fn(core.free_f64);state.core={...core,free_f64:free,pdf_place_figures(...args){core.memory.grow(1);return core.pdf_place_figures(...args);}};
 const layout=fixture(),actual=rustPDFPlaceFigures(rects,layout,source,viewport);core.memory.grow(1);
 expect(actual).toEqual(reference(rects,layout,source,viewport));expect(actual[0].rect).toBe(rects[0]);expect(free).toHaveBeenCalledOnce();
});
it('rejects invalid geometry and overflowing projection rather than returning a partial plan',()=>{
 for(const edit of [layout=>{layout.lines[0].height=0;},layout=>{layout.lines[0].start=-1;},layout=>{layout.lines[0].x0=layout.lines[0].x1+1;}]){
  const layout=fixture();edit(layout);expect(rustPDFPlaceFigures(rects,layout,source,viewport)).toBeUndefined();
 }
 expect(rustPDFPlaceFigures(rects,fixture(),{width:0,height:1},viewport)).toBeUndefined();
 expect(rustPDFPlaceFigures([{x0:1e308,y0:1e308,x1:1e308,y1:1e308}],fixture(),{width:1,height:1},viewport)).toBeUndefined();
});
