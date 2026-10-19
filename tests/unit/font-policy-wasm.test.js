// @vitest-environment node
import {readFileSync} from 'node:fs';
import {beforeAll,expect,it,vi} from 'vitest';
import {rustTitleLines,rustFontSearchPlan,rustFontFamilyMax,rustFontFamilySelect,createRustFontWrapCache} from '../../src/js/font-policy-wasm.js';
let core;
beforeAll(async()=>{core=(await WebAssembly.instantiate(readFileSync('src/wasm/inhouse_read_core.wasm'))).instance.exports;});
function reference(context,title,maxWidth){
 const words=String(title??'').trim().split(/\s+/).filter(Boolean),lines=[];let line='';
 for(const word of words){const candidate=line?`${line} ${word}`:word;if(line&&context.measureText(candidate).width>maxWidth){lines.push(line);line=word;}else line=candidate;}
 if(line)lines.push(line);return lines.slice(0,4);
}
const width=text=>Array.from(text).reduce((sum,c)=>sum+c.codePointAt(0)%19,0);
it('retains exact UTF-16 wrapping, every canvas measurement and whitespace semantics',()=>{
 const values=['',null,undefined,0,1829,'one','  Quiet   Garden \n\t five six seven eight nine ten ', '東京の本 日本語 テスト','İstanbul \ud800 \udfff 😀 café','\ufeff hello\u2000world\u2028again\u0085nonbreaking'];
 let state=1942;const random=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state;};
 const words=['αβ','日本語','I','İ','😀','\ud800','café','quiet','a'.repeat(80)],spaces=[' ','\t','\r\n','\u00a0','\u1680','\u2007','\u2029','\ufeff'];
 for(let i=0;i<250;i++)values.push(Array.from({length:random()%30},()=>words[random()%words.length]+spaces[random()%spaces.length]).join(''));
 for(const title of values)for(const limit of [0,1,37,80,192,NaN,Infinity]){
  const expectedCalls=[],actualCalls=[];
  const expected=reference({measureText(text){expectedCalls.push(text);return{width:width(text)};}},title,limit);
  const actual=rustTitleLines(core,{measureText(text){actualCalls.push(text);return{width:width(text)};}},title,limit);
  expect(actual).toEqual(expected);expect(actualCalls).toEqual(expectedCalls);
 }
});
it('keeps long line lengths and all measurements after the fourth returned line',()=>{
 const title='a'.repeat(70000)+' tail small six seven eight nine';const calls=[];
 expect(rustTitleLines(core,{measureText(text){calls.push(text);return{width:text.length};}},title,1)).toEqual(reference({measureText(text){return{width:text.length};}},title,1));
 expect(calls).toHaveLength(6);
});
it('releases its owned title on browser errors and across WASM growth',()=>{
 const error={canvas:'same thrown identity'},free=vi.fn(core.font_wrap_free),release=vi.fn(core.free_f64),engine={...core,font_wrap_free:free,free_f64:release};
 expect(()=>rustTitleLines(engine,{measureText(){throw error;}},'a b c',10)).toThrow();
 try{rustTitleLines(engine,{measureText(){throw error;}},'a b c',10);}catch(e){expect(e).toBe(error);}
 expect(free).toHaveBeenCalledTimes(2);expect(release).toHaveBeenCalledTimes(2);
 const expected=reference({measureText(text){return{width:width(text)};}},'one two three four five',40);
 expect(rustTitleLines(core,{measureText(text){core.memory.grow(1);return{width:width(text)};}},'one two three four five',40)).toEqual(expected);
 const failedFree=vi.fn(core.free_f64);expect(()=>rustTitleLines({...core,alloc_f64:()=>0,free_f64:failedFree},{},'a',10)).toThrow();expect(failedFree).not.toHaveBeenCalled();
});
it('raster requests preserve case/alignment/size iteration and arithmetic',()=>{
 for(const title of ['UPPER','lower','東京','İstanbul','😀'])for(const w of [1,192,198.5]){
  const expected=[];for(const upper of String(title).toLocaleUpperCase()===String(title)?[false]:[false,true])for(const align of ['center','left','right'])for(const size of [11,16,22,29])expected.push([+upper,['center','left','right'].indexOf(align),size,Math.ceil(size*5.5),align==='left'?1:align==='right'?w-1:w/2,size*1.08,w-2,+upper*4+[11,16,22,29].indexOf(size)]);
  expect(rustFontSearchPlan(core,title,w)).toEqual(expected);
 }
});
function choose(scores){const list=scores.map((score,index)=>({score,index})).sort((a,b)=>b.score-a.score),best=list[0],runner=list[1];const margin=runner?(best.score-runner.score)/Math.max(1,best.score):0;return !best||best.score<18||margin<.035?-1:best.index;}
it('native score maximum and family confidence retain ties and thresholds',()=>{
 const cases=[[],[18],[20,20],[20,19.3],[20,19.29999999],[17.999,0],[40,5,7,40],[0,0,0,0,0,0],[NaN,40,2],[20,NaN,40],[Infinity,19],[1,2,3,-Infinity]];
 let s=421;for(let i=0;i<4000;i++){s=(Math.imul(s,1664525)+1013904223)>>>0;const row=[];for(let j=0;j<6;j++){s=(Math.imul(s,1664525)+1013904223)>>>0;row.push(s%50000/100);}cases.push(row);}
 for(const values of cases){expect(rustFontFamilyMax(core,values)).toBe(Math.max(0,...values));expect(rustFontFamilySelect(core,values)).toBe(choose(values));}
});

it('reuses native alignment-independent wraps and releases every owned result',()=>{
 const cache=createRustFontWrapCache(core),calls=[];
 try{
  const context={measureText(text){calls.push(text);return{width:width(text)};}};
  for(let align=0;align<3;align++)for(let key=0;key<8;key++)expect(cache.lines(context,'The Quiet Garden and the long path',60,key)).toEqual(reference({measureText:text=>({width:width(text)})},'The Quiet Garden and the long path',60));
  const perTitle='The Quiet Garden and the long path'.split(' ').length-1;
  expect(calls).toHaveLength(perTitle*8);
 }finally{cache.dispose();cache.dispose();}
 expect(()=>cache.lines({},'x',1,0)).toThrow('disposed');
 const once=()=>{const item=createRustFontWrapCache(core);for(let i=0;i<8;i++)item.lines({measureText:text=>({width:text.length*4})},'The Quiet Garden and the long path',60,i);item.dispose();};
 for(let i=0;i<20;i++)once();const capacity=core.memory.buffer.byteLength;for(let i=0;i<1000;i++)once();expect(core.memory.buffer.byteLength).toBe(capacity);
});
