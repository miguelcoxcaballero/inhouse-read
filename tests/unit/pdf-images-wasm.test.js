// @vitest-environment node
// The composite bounds of a page's pictures are rust-ui (pdf_pictures.rs: pdf_image_rects); the frozen JavaScript
// original is tests/unit/helpers/reference-pdf-images.js.
import './helpers/rust-ui-ready.js';
import {expect,it} from 'vitest';
import {readerUI} from '../../src/js/readers/rust-ui-required.js';
import {pdfImageRects as reference} from './helpers/reference-pdf-images.js';
const pdfImageRects=(coordinates,width,height)=>readerUI().pdf_image_rects(coordinates,width,height);
// Same numbers (a negative zero included), same keys in the same order, plain objects.
const same=(actual,expected)=>{
 expect(Array.isArray(actual)).toBe(true);expect(actual).toEqual(expected);
 for(let i=0;i<actual.length;i++){
  expect(Object.keys(actual[i])).toEqual(['x0','y0','x1','y1']);expect(Object.getPrototypeOf(actual[i])).toBe(Object.prototype);
  for(const key of ['x0','y0','x1','y1'])expect(Object.is(actual[i][key],expected[i][key])).toBe(true);
 }
};
const box=(x,y,w,h)=>[x,y,x+w,y,x,y+h];
const fixtures={
 isolated:Array.from({length:80},(_,i)=>box(i%8/8,Math.floor(i/8)/10,.05,.04)).reverse().flat(),
 overlapping:Array.from({length:80},(_,i)=>box(i/200,i/200,.1,.1)).flat(),
 bridge:[0,0,.1,0,0,.3,.2,.1,.3,.1,.2,.2,.05,.2,.25,.2,.05,.4],
 rotated:[.3,.2,.5,.4,.2,.3],
 outside:[...box(-.1,-.3,.4,.5),...box(.9,.9,.8,.5),...box(3,3,1,1)],
 touching:[...box(0,0,.5,.5),...box(.5,0,.5,.5),...box(0,.5,1,.5)],
 malformed:[NaN,0,0,0,0,0,Infinity,0,0,0,0,0,0,0,0,0,0,0,...box(.2,.2,.1,.1)],
 precision:[-0,-0,.1+1e-12,0,0,.1-1e-12],
 invalidType:['0',0,.2,0,0,.2,...box(.3,.3,.2,.2)],
 trailing:[...box(0,0,.5,.5),1,2,3]
};
for(const [name,input] of Object.entries(fixtures))it(`retains ${name} composite bounds exactly`,()=>{
 same(pdfImageRects(input,1024,2048),reference(input,1024,2048));
});
it('matches two hundred rotated, clipped and layered pages without mutating coordinates',()=>{
 let seed=75471;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
 for(let trial=0;trial<200;trial++){
  const input=Array.from({length:1+trial%120},()=>{const x=random()*1.4-.2,y=random()*1.4-.2;return[x,y,x+random()*.1,y+random()*.1,x-random()*.1,y+random()*.1];}).flat();
  const value=trial%3===1?new Float32Array(input):trial%3===2?new Float64Array(input):input,copy=Array.from(value);
  same(pdfImageRects(value,400,800),reference(value,400,800));expect(Array.from(value)).toEqual(copy);
 }
});
it('keeps two thousand disconnected photos in physical reading order',()=>{
 const input=Array.from({length:2000},(_,i)=>box(0,i/2000,.5,.5/2000)).reverse().flat();
 const rects=pdfImageRects(input,100,4000);same(rects,reference(input,100,4000));expect(rects).toHaveLength(2000);
});
it('handles empty pages and unsupported dimensions exactly like the original implementation',()=>{
 expect(pdfImageRects([],100,200)).toEqual([]);
 for(const dims of [[0,1],[-1,1],[1,NaN],[Infinity,1],['100',200],[100,undefined]]){
  expect(pdfImageRects(fixtures.touching,...dims)).toEqual([]);
 }
 for(const dims of [[0,1],[-1,1],[1,NaN],[Infinity,1]])expect(reference(fixtures.touching,...dims)).toEqual([]);
 // A length that is not a number of corners is an empty page, as `Math.floor(length/6)` made it.
 for(const value of [{},{length:'x'},{length:5},'',new Float32Array(5)])expect(pdfImageRects(value,100,200)).toEqual([]);
 expect(()=>pdfImageRects(null,100,200)).toThrow(TypeError);
});
it('answers typed arrays with a remainder, array-likes and strings in a list as the original did',()=>{
 const input=[...fixtures.touching,.25,.5];
 for(const value of [new Float32Array(input),new Float64Array(input),{...input,length:input.length}])
  same(pdfImageRects(value,640,480),reference(Array.from({length:input.length},(_,i)=>value[i]),640,480));
});
it('refuses more pictures than the kernel takes instead of guessing bounds',()=>{
 expect(()=>pdfImageRects({length:6_000_006},100,200)).toThrow('No se pudo calcular la página del PDF.');
 expect(()=>pdfImageRects({length:Infinity},100,200)).toThrow('No se pudo calcular la página del PDF.');
});
it('answers pages of tens of thousands of tiles in one call',()=>{
 const tiles=Array.from({length:40000},(_,i)=>box(i%200/200,Math.floor(i/200)/200,.005,.005)).flat();
 same(pdfImageRects(tiles,2000,2000),reference(tiles,2000,2000));
});
it('returns fresh objects on every call',()=>{
 const a=pdfImageRects(fixtures.overlapping,400,800),b=pdfImageRects(fixtures.overlapping,400,800);
 expect(a).not.toBe(b);expect(a[0]).not.toBe(b[0]);a[0].x0=-5;expect(pdfImageRects(fixtures.overlapping,400,800)).toEqual(b);
});
