// @vitest-environment node
import {expect,it} from 'vitest'
import {rustShelf} from './helpers/rust-shelf-ready.js'
const row=(x,flags=0,kind=0,shelf=0,height=100)=>[shelf,x,10,height,kind,flags]
function run(gravity,rows,now=0,reduced=false){const output=new Float64Array(rows.length*4);gravity.step(rows.map((_,i)=>`book:${i}`),Float64Array.from(rows.flat()),now,reduced,output);return [...output]}
it('settles a released book onto the closest support and preserves its bottom corner',()=>{
 const g=new rustShelf.RustBookGravity();
 run(g,[row(10),row(40,2),row(95)]);
 const start=run(g,[row(10),row(40),row(95)],10);
 expect(start[4]).toBe(0);expect(start[7]).toBe(1);
 const midway=run(g,[row(10),row(40),row(95)],210);
 const settled=run(g,[row(10),row(40),row(95)],1210);
 const a=settled[4];expect(a).toBeCloseTo(Math.asin(20/100),8);
 expect(midway[4]).toBeGreaterThan(0);expect(midway[4]).toBeLessThan(a);
 // Local bottom-left corner stays exactly on its original board/pivot.
 expect(settled[5]-5*Math.cos(a)+50*Math.sin(a)).toBeCloseTo(-5,8);
 expect(settled[6]-5*Math.sin(a)-50*Math.cos(a)).toBeCloseTo(-50,8);
 expect(run(g,[row(10),row(40),row(95)],1250)[7]).toBe(0);g.free();
})
it('chooses the right support, skips another bay, and stops at first contact with a shorter book',()=>{
 const g=new rustShelf.RustBookGravity();const rows=[row(5,0,0,1),row(40,2),row(70,0,0,0,40)];
 run(g,rows);rows[1]=row(40);run(g,rows,1);
 const final=run(g,rows,1300);expect(final[4]).toBeCloseTo(-Math.atan(20/40),8);g.free();
})
it('does not lean through plants, into distant books, or while held',()=>{
 for(const rows of [[row(10,0,1),row(40,2)],[row(10),row(400,2)]]){
  const g=new rustShelf.RustBookGravity();run(g,rows);rows[1]=row(rows[1][1]);run(g,rows,10);
  expect(run(g,rows,1500)[4]).toBe(0);g.free();
 }
})
it('touching books have no artificial lean and reduced motion settles immediately',()=>{
 const g=new rustShelf.RustBookGravity();run(g,[row(10),row(20,2)]);expect(run(g,[row(10),row(20)],20,true)[4]).toBe(0);
 run(g,[row(10),row(40,2)],30);const final=run(g,[row(10),row(40)],40,true);
 expect(final[4]).toBeGreaterThan(0);expect(run(g,[row(10),row(40)],50,true)[7]).toBe(0);g.free();
})

it('keeps lone UTF-16 surrogate IDs distinct from one another and a replacement glyph',()=>{
 const g=new rustShelf.RustBookGravity(),keys=['book:\ud800','book:\udfff','book:�'];
 const step=(rows,now)=>{const out=new Float64Array(12);g.step(keys,Float64Array.from(rows.flat()),now,false,out);return [...out]};
 step([row(10),row(40,2),row(95)],0);step([row(10),row(40),row(95)],10);
 const final=step([row(10),row(40),row(95)],1310);
 expect(final[0]).toBe(0);expect(final[4]).toBeCloseTo(Math.asin(.2),8);expect(final[8]).toBe(0);g.free();
})
it('ignores a ceiling puck between a book and its support',()=>{
 const g=new rustShelf.RustBookGravity();run(g,[row(10),row(25,0,3),row(40,2)]);
 run(g,[row(10),row(25,0,3),row(40)],10);
 const final=run(g,[row(10),row(25,0,3),row(40)],1310);
 expect(final[8]).toBeCloseTo(Math.asin(.2),8);g.free();
})
