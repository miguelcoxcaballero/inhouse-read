// @vitest-environment node
// A cloth is planned by the shelf module on the book's native stream (rust-ui/src/spine_surface.rs, paint_cloth,
// over rust-core/src/book_cloth.rs compiled into the module) and replayed on its canvas by replayCloth. Compared
// with the frozen JavaScript painter (helpers/reference-book-cloth.js): every paint command, every byte of the
// dye field and every value the stream gives afterwards.
import assert from 'node:assert/strict';
import {afterEach,expect,it,vi} from 'vitest';
import {rustShelf} from './helpers/rust-shelf-ready.js';
import {replayCloth} from '../../src/js/spine-surface.js';
import {shelfCloth as paintCloth,shelfStream as seededRandom} from './helpers/shelf-stream.js';
import {paintCloth as reference,seededRandom as referenceRandom} from './helpers/reference-book-cloth.js';
afterEach(()=>{vi.unstubAllGlobals();});
function record(painter,random,width,options={},pixels=true){
 const calls=[];
 vi.stubGlobal('document',{createElement:()=>{const field={width:0,height:0,pixels:null};const f={putImageData:image=>{field.pixels=image.data.slice();}};if(pixels)f.createImageData=(w,h)=>({data:new Uint8ClampedArray(w*h*4)});field.getContext=()=>f;return field;}});
 const c=new Proxy({save:()=>calls.push(['save']),restore:()=>calls.push(['restore']),fillRect:(...args)=>calls.push(['rect',...args]),drawImage:(field,...args)=>calls.push(['image',field.width,field.height,field.pixels,...args])},{set(target,key,value){calls.push([key,value]);target[key]=value;return true;}});
 painter(c,width,random,options);return {calls,tail:Array.from({length:100},()=>random())};
}
for(const width of [0,-0,80,136,257.3592701820759,512,8192])for(const metal of [false,true])it(`keeps every paint command, field byte and next PRNG value at width ${Object.is(width,-0)?'-0':width}, metal ${metal}`,()=>{
 const replay=vi.fn(replayCloth);
 const a=record((c,w,random,options)=>paintCloth(c,w,random,options,replay),seededRandom(17),width,{metal}),b=record(reference,referenceRandom(17),width,{metal});
 assert.deepEqual(a,b);
 // One plan, replayed once: the field's bytes and six numbers per slub, as views of the module's memory.
 expect(replay).toHaveBeenCalledOnce();
 const [, , fieldWidth, bytes, commands]=replay.mock.calls[0];
 expect(fieldWidth).toBe(Math.max(4,Math.round(width/34)));
 expect(bytes).toBeInstanceOf(Uint8Array);expect(bytes.length).toBe(fieldWidth*30*4);
 expect(commands).toBeInstanceOf(Float64Array);expect(commands.length).toBe((metal?40:136)*6);
});
it('retains random state across mixed calls, zero state and repeated cloth passes',()=>{
 for(const seed of [0,1,-1,0x92d4860b,0xffffffff]){
  const a=seededRandom(seed),b=referenceRandom(seed);for(let i=0;i<1;i++)expect(a()).toBe(b());
  for(const metal of [false,true,false])assert.deepEqual(record(paintCloth,a,257.35,{metal}),record(reference,b,257.35,{metal}));
 }
});
it('paints many widths, seeds and finishes like the original',()=>{
 let seed=7;const next=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
 for(let n=0;n<300;n++){
  const width=n%9===0?Math.round(next()*8192):80+next()*900,metal=n%3===0,start=Math.floor(next()*4294967296);
  assert.deepEqual(record(paintCloth,seededRandom(start),width,{metal}),record(reference,referenceRandom(start),width,{metal}),`${n} ${width} ${metal} ${start}`);
 }
});
it('matches contexts without ImageData',()=>{
 assert.deepEqual(record(paintCloth,seededRandom(9),180,{},false),record(reference,referenceRandom(9),180,{},false));
 assert.deepEqual(record(paintCloth,seededRandom(9),180,{metal:true},false),record(reference,referenceRandom(9),180,{metal:true},false));
});
it('draws a width no plan takes straight from the stream, in the original order',()=>{
 for(const width of [-80,8192.5,9000,NaN])for(const metal of [false,true]){
  const replay=vi.fn(replayCloth);
  assert.deepEqual(record((c,w,random,options)=>paintCloth(c,w,random,options,replay),seededRandom(9),width,{metal}),record(reference,referenceRandom(9),width,{metal}),`${width} ${metal}`);
  expect(replay).not.toHaveBeenCalled();
 }
});
it('lets a failing canvas out and reports a replay that is not a function',()=>{
 const failure=Error('Canvas lost');
 vi.stubGlobal('document',{createElement:()=>({getContext:()=>({createImageData:(w,h)=>({data:new Uint8ClampedArray(w*h*4)}),putImageData(){}})})});
 const c={save(){},restore(){},drawImage(){throw failure},fillRect(){}};
 expect(()=>rustShelf.spine_cloth_seeded(replayCloth,c,180,17,false)).toThrow(failure);
 expect(()=>rustShelf.spine_cloth_seeded(undefined,c,180,17,false)).toThrow(TypeError);
 // The module is whole afterwards: the same cloth again.
 const fine={save(){},restore(){},drawImage(){},fillRect(){}};
 expect(rustShelf.spine_cloth_seeded(replayCloth,fine,180,17,false)).toBe(rustShelf.spine_cloth_seeded(replayCloth,fine,180,17,false));
});
it('hands the replay views that are read before it returns, across growth of the module memory',()=>{
 vi.stubGlobal('document',{createElement:()=>({getContext:()=>({createImageData:(w,h)=>({data:new Uint8ClampedArray(w*h*4)}),putImageData(){}})})});
 const fine={save(){},restore(){},drawImage(){},fillRect(){}};
 const seen=[];
 const keep=(c,width,fieldWidth,pixels,commands)=>{seen.push({fieldWidth,pixels:pixels.slice(),commands:commands.slice()});};
 const state=rustShelf.spine_cloth_seeded(keep,fine,180,17,false);
 rustShelf.book_mesh_memory().grow(1);
 expect(rustShelf.spine_cloth_seeded(keep,fine,180,17,false)).toBe(state);
 assert.deepEqual(seen[1],seen[0]);
});
