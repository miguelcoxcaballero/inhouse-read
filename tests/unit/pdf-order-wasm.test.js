// @vitest-environment node
import {readFileSync} from 'node:fs';
import {beforeAll,expect,it,vi} from 'vitest';
const observed=vi.hoisted(()=>({core:null}));
vi.mock('../../src/js/rust-core.js',()=>({getRustCore:()=>observed.core}));
import {rustPDFOrderLines} from '../../src/js/readers/pdf-order-wasm.js';
import {pdfOrderLines,legacyPDFOrderLines} from '../../src/js/readers/pdf-order-lines.js';
import {orderLines as reference} from './helpers/reference-pdf-order.js';
import {extractPDFText} from '../../src/js/readers/pdf-text.js';
let core;beforeAll(async()=>{core=(await WebAssembly.instantiate(readFileSync('src/wasm/inhouse_read_core.wasm'))).instance.exports;expect(typeof core.pdf_order_lines).toBe('function');observed.core=core;});
const line=(x,y,width=180,height=12,text='A complete ordinary line of prose')=>({x0:x,x1:x+width,y,height,top:y-height,bottom:y,text,items:[{str:text}],marker:{x,y}});
function compare(lines,rtl=false){const expected=reference(lines,rtl),actual=rustPDFOrderLines(lines,rtl);expect(actual).toEqual(expected);for(let i=0;i<actual.length;i++){expect(actual[i].items).toBe(expected[i].items);expect(actual[i].marker).toBe(expected[i].marker);}return actual;}
for(const rtl of [false,true])for(const kind of ['column','two','three','table','span','counters','bands','ties'])it(`${kind} ${rtl?'RTL':'LTR'} retains every line and column path`,()=>{
 let lines=[];
 if(kind==='ties')lines=Array.from({length:48},(_,i)=>line(i%3*60,Math.floor(i/6)*16,60,8+(i%3),String(i)));
 else for(let i=0;i<24;i++)for(let col=0;col<(kind==='three'?3:kind==='column'||kind==='bands'?1:2);col++)lines.push(line(col*260,40+i*17,kind==='table'?55:200,12,`ordinary text ${i}/${col}`));
 if(kind==='span'){lines.push(line(0,215,580,20,'Section spanning columns'));lines.push(line(0,20,580,24,'Chapter title'));}
 if(kind==='counters')lines.push(line(10,-50,10,12,'iv'),line(530,520,10,12,'25'));
 if(kind==='bands')lines.push(...Array.from({length:12},(_,i)=>line(30,800+i*17,200)));
 compare(lines.reverse(),rtl);
});
it('keeps empty and single lines, negative zero, headers and fractional coordinates',()=>{
 expect(rustPDFOrderLines([],false)).toEqual([]);compare([line(-0,-0,.000001,.00000001,'1')]);
 compare(Array.from({length:80},(_,i)=>line((i%2)*220.125,Math.floor(i/2)*14.125,200.125,12.25)));
});
it('matches a shuffled geometry corpus in both directions',()=>{
 let state=81721;const random=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296;};
 for(let sample=0;sample<100;sample++){
  const lines=Array.from({length:8+Math.floor(random()*90)},(_,i)=>line(Math.floor(random()*3)*230,Math.floor(random()*30)*17,80+random()*130,7+random()*11,i%13?'complete prose here':String(i)));
  compare(lines,!!(sample%2));
 }
});
it('recreates output views after memory growth and never retains references into the arena',()=>{
 const free=vi.fn(core.free_f64);observed.core={...core,free_f64:free,pdf_order_lines(...args){core.memory.grow(1);return core.pdf_order_lines(...args);}};
 try{const input=Array.from({length:80},(_,i)=>line(i%2*260,Math.floor(i/2)*17));const result=compare(input);expect(free).toHaveBeenCalledOnce();const saved=result.map(l=>l.column);core.memory.grow(1);expect(result.map(l=>l.column)).toEqual(saved);}finally{observed.core=core;}
});
it('keeps cold, rejected and throwing kernels on the original path without dropping text',()=>{
 const input=Array.from({length:80},(_,i)=>line(i%2*260,Math.floor(i/2)*17));
 for(const engine of [null,{...core,alloc_f64:()=>0},{...core,pdf_order_lines:()=>0},{...core,pdf_order_lines:()=>{throw Error('kernel');}}]){
  observed.core=engine;expect(pdfOrderLines(input,false)).toEqual(reference(input,false));
 }
 observed.core=core;
});
it('rejects invalid geometry and native permutations without publishing partial output',()=>{
 const input=Array.from({length:40},(_,i)=>line(i%2*260,Math.floor(i/2)*17));
 for(const patch of [{height:0},{x0:Infinity},{top:99,bottom:0}])expect(rustPDFOrderLines([{...input[0],...patch}],false)).toBeUndefined();
 const free=vi.fn(core.free_f64);observed.core={...core,free_f64:free,pdf_order_lines(_p,n,_rtl,records){new Uint32Array(core.memory.buffer,records,n*3).fill(0);return n;}};
 try{expect(rustPDFOrderLines(input,false)).toBeUndefined();expect(free).toHaveBeenCalledOnce();}finally{observed.core=core;}
});
it('preserves the complete PDF extraction, paragraphs and source spans',()=>{
 const items=Array.from({length:220},(_,i)=>({str:`Sentence ${i} with its original words.`,width:190,height:12,dir:'ltr',hasEOL:true,transform:[12,0,0,12,i%2*240,760-Math.floor(i/2)*6]}));
 const content={items};observed.core=null;const expected=extractPDFText(content),calls=vi.fn(core.pdf_order_lines);observed.core={...core,pdf_order_lines:calls};
 try{expect(expected.geometric).toBe(true);expect(extractPDFText(content)).toEqual(expected);expect(calls).toHaveBeenCalled();expect(legacyPDFOrderLines([],false)).toEqual([]);}finally{observed.core=core;}
});
