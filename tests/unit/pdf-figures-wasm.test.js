// @vitest-environment node
// Where the pictures of a page go in its reading stream is rust-ui (pdf_pictures.rs: pdf_place_figures); the frozen
// JavaScript original is tests/unit/helpers/reference-pdf-figures.js.
import './helpers/rust-ui-ready.js';
import {expect,it} from 'vitest';
import {readerUI} from '../../src/js/readers/rust-ui-required.js';
import {placeFigures as reference} from './helpers/reference-pdf-figures.js';
import {extractPDFText} from '../../src/js/readers/pdf-text.js';
const pdfPlaceFigures=(rects,layout,source,viewport)=>readerUI().pdf_place_figures(rects,layout,source,viewport);
const REFUSED='No se pudo calcular la página del PDF.';
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
 const original=structuredClone({boxes,layout,src,view}),expected=reference(boxes,layout,src,view),actual=pdfPlaceFigures(boxes,layout,src,view);
 expect(Array.isArray(actual)).toBe(true);expect(actual).toEqual(expected);
 for(const figure of actual)expect(Object.keys(figure)).toEqual(['rect','offset']);
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
it('answers small pages and layouts without geometry as well',()=>{
 expect(pdfPlaceFigures(rects.slice(0,7),fixture(),source,viewport)).toEqual(reference(rects.slice(0,7),fixture(),source,viewport));
 for(const layout of [{...fixture(),geometric:false},{text:'Full text 🦊',lines:[],geometric:true}]){
  const expected=reference(rects,layout,source,viewport);
  expect(pdfPlaceFigures(rects,layout,source,viewport)).toEqual(expected);
  expect(pdfPlaceFigures(rects,layout,undefined,undefined)).toEqual(expected);
  expect(expected.every(({offset})=>offset===layout.text.length)).toBe(true);
 }
 expect(pdfPlaceFigures([],fixture(),source,viewport)).toEqual([]);
 // No picture: nothing is read from a layout beyond its size.
 expect(pdfPlaceFigures([],{text:'x',geometric:true,lines:[{entries:null}]},undefined,undefined)).toEqual([]);
});
it('tells columns apart as a Map does, whatever value names them',()=>{
 const shared={};
 for(const names of [[undefined,null],[NaN,0],[0,-0,'0'],[shared,{}],['a',1,true]]){
  const layout=fixture(90,1);layout.lines.forEach((line,i)=>{line.column=names[i%names.length];line.x0=i%names.length*200+10;line.x1=line.x0+150;});
  compare(rects,layout);
 }
});
it('reads the page direction from the first of the longest text items, whichever line holds it',()=>{
 const layout=fixture(40,2);
 layout.lines[7].entries=[{item:{str:'a',transform:[1,0,0,1,0,0]}},{item:{str:'Z'.repeat(300),transform:[0,1,-1,0,0,0]}}];
 layout.lines[31].entries.push({item:{str:'Q'.repeat(300),transform:[-1,0,0,-1,0,0]}});
 layout.lines[3].entries=[];
 compare(rects,layout);
});
it('reports a page it cannot answer as an error instead of a partial plan',()=>{
 const refused=(boxes,layout,src=source,view=viewport)=>expect(()=>pdfPlaceFigures(boxes,layout,src,view)).toThrow(REFUSED);
 for(const edit of [layout=>{layout.lines[0].height=0;},layout=>{layout.lines[0].start=-1;},layout=>{layout.lines[0].x0=layout.lines[0].x1+1;},
  layout=>{layout.lines[0].start=NaN;},layout=>{layout.lines[0].start='0';},layout=>{layout.lines[3].y=undefined;},layout=>{layout.lines[0].start=layout.text.length+1;},
  layout=>{layout.lines[2]=null;},layout=>{layout.lines[2].entries=undefined;},layout=>{layout.lines[2].entries={length:1,0:layout.lines[1].entries[0]};},
  layout=>{layout.lines[2].entries=[null];},layout=>{layout.lines[2].entries=[{item:{str:7}}];},layout=>{layout.lines[2].entries=[{item:{str:new String('x')}}];},
  layout=>{for(const line of layout.lines)line.entries=[];},layout=>{for(const line of layout.lines)line.entries[0].item.transform=undefined;},
  layout=>{layout.text=undefined;},layout=>{layout.text=7;}]){
  const layout=fixture();edit(layout);refused(rects,layout);
 }
 refused(rects,fixture(),{width:0,height:1});refused(rects,fixture(),null,null);refused(rects,fixture(),source,null);refused(rects,fixture(),null);refused(rects,fixture(),source,{width:600,height:-800});
 refused([{x0:1e308,y0:1e308,x1:1e308,y1:1e308}],fixture(),{width:1,height:1});
 refused([{x0:5,y0:0,x1:1,y1:1}],fixture());refused([{x0:'0',y0:0,x1:1,y1:1}],fixture());refused([null],fixture());
 refused(rects,null);refused(rects,undefined);refused(rects,{...fixture(),lines:{length:32769}});refused({length:32769},fixture());
 expect(()=>pdfPlaceFigures(null,fixture(),source,viewport)).toThrow(TypeError);
});
it('takes a viewport transform of its own and array-like rectangles',()=>{
 for(const transform of [[0,1,1,0,0,0],[-1,0,0,1,600,0],[.5,.5,-.5,.5,0,0],['1','0','0','-1',0,800]]){
  const view={width:600,height:800,transform},layout=fixture(80,3,.3),boxes={...rects,length:rects.length};
  const expected=reference(rects,layout,source,view),actual=pdfPlaceFigures(boxes,layout,source,view);
  expect(actual).toEqual(expected);for(let i=0;i<actual.length;i++)expect(actual[i].rect).toBe(expected[i].rect);
 }
});
// A layout made by extractPDFText keeps, out of sight, the line records the text kernel wrote: placing reads those
// instead of every line and item. The answer must be the one the lines themselves give (a copy of the layout has no record).
it('places the pictures of extracted pages from the record the extractor keeps, as from the lines themselves',()=>{
 let seed=9157,recorded=0;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
 for(let trial=0;trial<160;trial++){
  const columns=1+trial%3,rows=4+trial%37,size=9+trial%5,items=[],quarter=trial%8===7;
  for(let column=0;column<columns;column++)for(let row=0;row<rows;row++){
   let x=40+column*190;const y=60+row*(size+7),pieces=1+Math.floor(random()*4);
   for(let piece=0;piece<pieces;piece++){
    const str=(piece?'':'c'+column+'r'+row+' ')+'palabra'.slice(0,2+Math.floor(random()*6))+(random()<.2?' 漢字 🦊':'')+' ',width=str.length*size*.5;
    // One page in eight is turned a quarter: its items run down the sheet.
    items.push(quarter?{str,width,height:size,transform:[0,size,-size,0,800-y,x],dir:'ltr',hasEOL:piece===pieces-1}
     :{str,width,height:size,transform:[size,0,0,size,x,800-y],dir:'ltr',hasEOL:piece===pieces-1});
    x+=width+2;
   }
  }
  const layout=extractPDFText({items},viewport),boxes=Array.from({length:1+trial%9},()=>{const x0=Math.floor(random()*560),y0=Math.floor(random()*760);return{x0,y0,x1:x0+10+Math.floor(random()*120),y1:y0+10+Math.floor(random()*90)};});
  expect(Object.keys(layout)).toEqual(['geometric','text','items','spans','lines','paragraphs']);
  const bare={...layout};expect(bare.pictures).toBeUndefined();
  if(layout.geometric){
   recorded++;expect(layout.pictures.lines).toHaveLength(layout.lines.length*14);expect(Object.keys(layout.pictures)).toEqual(['lines','paths','dominant']);
   // The columns of the record are the columns of the lines, and its item is the first of the longest.
   const all=layout.lines.flatMap(line=>line.entries.map(entry=>entry.item));
   expect(layout.pictures.dominant).toBe(all.find(item=>item.str.length===Math.max(...all.map(item=>item.str.length))));
   layout.lines.forEach((line,i)=>{const record=layout.pictures.lines.subarray(i*14,i*14+14);
    expect([record[1],record[2],record[3],record[6],record[10],layout.pictures.paths.slice(record[8],record[8]+record[9])]).toEqual([line.x0,line.x1,line.y,line.height,line.start,line.column]);});
  }
  for(const src of [source,{width:1200,height:1600}]){
   const expected=reference(boxes,layout,src,viewport);
   for(const each of [layout,bare]){
    const actual=pdfPlaceFigures(boxes,each,src,viewport);expect(actual).toEqual(expected);
    for(let i=0;i<actual.length;i++)expect(actual[i].rect).toBe(expected[i].rect);
   }
  }
 }
 expect(recorded).toBeGreaterThan(100);
});
it('reads the lines themselves when the record is not about them',()=>{
 const items=Array.from({length:60},(_,i)=>({str:'Línea '+i+' de la página. ',width:150,height:12,transform:[12,0,0,12,40+i%2*260,760-Math.floor(i/2)*20],dir:'ltr',hasEOL:true}));
 const layout=extractPDFText({items},viewport);expect(layout.geometric).toBe(true);
 const boxes=rects.slice(0,6),whole=pdfPlaceFigures(boxes,layout,source,viewport);
 expect(whole).toEqual(reference(boxes,layout,source,viewport));
 layout.lines.splice(0,layout.lines.length>>1);
 const cut=pdfPlaceFigures(boxes,layout,source,viewport);
 expect(cut).toEqual(reference(boxes,layout,source,viewport));expect(cut).not.toEqual(whole);
});
