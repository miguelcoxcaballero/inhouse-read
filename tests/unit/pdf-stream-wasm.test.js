// @vitest-environment node
import {readFileSync} from 'node:fs';
import {beforeAll,afterEach,expect,it,vi} from 'vitest';
const state=vi.hoisted(()=>({core:null}));
vi.mock('../../src/js/rust-core.js',()=>({getRustCore:()=>state.core}));
import {rustPDFTextStream} from '../../src/js/readers/pdf-stream-wasm.js';
import {assemble as reference} from './helpers/reference-pdf-stream.js';
import {extractPDFText} from '../../src/js/readers/pdf-text.js';
import {extractPDFText as referenceExtraction} from './helpers/reference-pdf-text-stream.js';
let core;
beforeAll(async()=>{core=(await WebAssembly.instantiate(readFileSync('src/wasm/inhouse_read_core.wasm'))).instance.exports;expect(typeof core.pdf_text_stream).toBe('function');state.core=core;});
afterEach(()=>{state.core=core;});
function linesFor(strings){let rawIndex=0;return strings.map((row,i)=>{
 const pieces=Array.isArray(row)?row:[row];let x=30;
 const entries=pieces.map(str=>{const x0=x;x+=str.length*5+5;return{item:{str,hasEOL:true,fontName:'test'},rawIndex:rawIndex++,x0,x1:x-5,y:i*20+20,height:12};});
 return {entries,x0:entries[0].x0,x1:entries.at(-1).x1,y:i*20+20,height:12,column:'body',rtl:false,text:pieces.join(' ')};
});}
const samples={
 wraps:['The beginning','of a single paragraph.','Another line.'],
 fragments:[['Partial','word','with ','spaces'],['following','line']],
 hardHyphen:['A well-','known word.','A dash‐','continues.'],
 softHyphen:['A discre\u00ad','tionary word.','A literal \u00ad','CAPITAL word.'],
 onlySoft:['\u00ad','lower','\u00ad','end'],
 unicode:['漢字テキスト','続きです','안녕하세요','세계','🦊 café é','éclair'],
 spaces:['one ',' following','third\t','\tline','\n','more'],
 lists:['First paragraph.','1. A list item.','2) Second item.','a) Third item.','• Final item.'],
 rtl:[['שלום','עולם'],['مرحبا','بالعالم']],
 fragmentsSoft:[['Something ','\u00ad'],['lower'],['hello\u00ad','world']]
};
function compare(lines){const copy=structuredClone(lines),expected=reference(copy),actual=rustPDFTextStream(lines);expect(actual).toEqual(expected);expect(actual.lines).toBe(lines);return actual;}
for(const [name,strings] of Object.entries(samples))it(`preserves the ${name} stream and every source span`,()=>{compare(linesFor(strings));});
it('preserves paragraph gaps, column boundaries, negative baselines and list starts',()=>{
 const lines=linesFor(Array.from({length:120},(_,i)=>'Line '+i+' with exact text.'));
 for(let i=0;i<lines.length;i++){lines[i].column='column'+Math.floor(i/30);lines[i].y=i%30*20+(i%30>=15?16:0);if(i%17===0)lines[i].text='• '+lines[i].text;}
 compare(lines);
});
it('retains lower-half median spacing when paragraph gaps are as frequent as wraps',()=>{
 const lines=linesFor(['one','two','three','four','five']);[0,20,56,76,112].forEach((y,i)=>lines[i].y=y);compare(lines);
});
it('keeps tight fragments, wide fragments and CJK punctuation in RTL order',()=>{
 const lines=linesFor(samples.rtl);for(const line of lines){line.rtl=true;line.entries.reverse();}compare(lines);
});
it('matches two hundred mixed Unicode, fragment and paragraph layouts',()=>{
 let seed=791824;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
 const words=Object.values(samples).flat(2);
 for(let trial=0;trial<200;trial++){
  const lines=linesFor(Array.from({length:2+trial%150},()=>Array.from({length:1+Math.floor(random()*4)},()=>words[Math.floor(random()*words.length)])));
  let y=0;for(let i=0;i<lines.length;i++){y+=15+Math.floor(random()*40);lines[i].y=y;lines[i].height=8+random()*14;lines[i].column='col'+Math.floor(i/25);lines[i].rtl=random()>.7;}
  compare(lines);
 }
});
it('keeps valid source offsets even for lone surrogates and empty trimmed pieces',()=>{compare(linesFor(['\uD800 x','\uDC00','\u00ad','lower','\uD83E\uDD8A \u00ad','next']));});
it('does not mutate input when the core is unavailable or rejects the plan',()=>{
 const lines=linesFor(samples.wraps),copy=structuredClone(lines);
 for(const value of [null,{}, {...core,alloc_f64:()=>0},{...core,pdf_text_stream:()=>-1},{...core,pdf_text_stream:()=>{throw Error('trap');}}]){
  state.core=value;expect(rustPDFTextStream(lines)).toBeUndefined();expect(lines).toEqual(copy);
 }
});
it('releases memory on malformed plans and returns independent metadata after growth',()=>{
 const free=vi.fn(core.free_f64);state.core={...core,free_f64:free,pdf_text_stream(...args){core.memory.grow(1);return core.pdf_text_stream(...args);}};
 const result=compare(linesFor(samples.unicode)),copy=structuredClone(result);core.memory.grow(1);expect(result).toEqual(copy);expect(free).toHaveBeenCalledOnce();
 const freeBad=vi.fn(core.free_f64);state.core={...core,free_f64:freeBad,pdf_text_stream:()=>999};
 expect(rustPDFTextStream(linesFor(samples.wraps))).toBeUndefined();expect(freeBad).toHaveBeenCalledOnce();
});
it('rejects malformed geometry without losing or changing any original text',()=>{
 for(const edit of [lines=>{lines[0].height=0;},lines=>{lines[0].entries[0].x0=Infinity;},lines=>{lines[0].entries[0].item.str='';}]){
  const lines=linesFor(samples.wraps);edit(lines);const copy=structuredClone(lines);expect(rustPDFTextStream(lines)).toBeUndefined();expect(lines).toEqual(copy);
 }
});

for(const columns of [1,2,3])it(`routes complete ${columns}-column extraction through the compiled stream without moving any source item`,()=>{
 const viewport={width:800,height:1600,transform:[1,0,0,-1,0,1600]},items=[];
 for(let column=0;column<columns;column++)for(let row=0;row<160;row++){
  const str=(row%11===0?'• ':'')+'A phrase '+row+' 🦊 漢字 '+(row%7===0?'soft\u00ad':'complete.');
  items.push({str,width:140,height:10,dir:'ltr',hasEOL:true,transform:[10,0,0,10,20+column*240,1550-row*9]});
 }
 const input={items:items.reverse()},before=structuredClone(input),expected=referenceExtraction(input,viewport);
 const native=vi.fn(core.pdf_text_stream);state.core={...core,pdf_text_stream:native};
 expect(extractPDFText(input,viewport)).toEqual(expected);expect(native).toHaveBeenCalledOnce();expect(input).toEqual(before);
});
it('keeps complete extraction usable when the stream core is missing',()=>{
 state.core=null;const items=Array.from({length:160},(_,i)=>({str:'A complete line '+i,width:120,height:10,transform:[10,0,0,10,20,2000-i*12]}));
 expect(extractPDFText({items})).toEqual(referenceExtraction({items}));
});

it('keeps Unicode classification exact across bounded cache eviction and astral lowercase',()=>{
 const lines=linesFor(Array.from({length:800},(_,i)=>String.fromCodePoint(0x400+i)+' 漢字 '+String.fromCodePoint(0x10428+i%39)));
 compare(lines);compare(linesFor(['An astral-','𐐨 continuation.','漢\u00ad','字','only\u00ad','𐐨']));
});
