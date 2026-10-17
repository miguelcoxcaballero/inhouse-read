// @vitest-environment node
import {expect,it} from 'vitest'
import {rustShelf} from './helpers/rust-shelf-ready.js'
function fixture(rows){
 const solver=new rustShelf.RustBookGravity(),scene=new rustShelf.RustScene(600,1200,600,250,false,false,0);
 let clock=0;
 return {rows,step(frames=1,reduced=false,frameMs=1000/60){let output;
  for(let frame=0;frame<frames;frame++){
   scene.beginEntries(clock,reduced,1,new Float64Array([0,0,0,1]),1,600,0,18);
   const states=new Float64Array(rows.length*37),geometry=new Float64Array(rows.length*9);
   rows.forEach((b,i)=>{
    const height=b.height??200,y=(b.floor??300)-height/2;
    states.set([b.kind===3?2:b.kind??0,b.kind===3?1:0,b.flags??0,b.drag??0,b.dragY??0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,0,0,0,b.x,y,150,height,150,0],i*37);
    geometry.set([b.width??20,b.kind??0,b.shelf??0,1000,0,600,b.floor??300,(b.floor??300)-290,0],i*9);
   });
   output=new Float64Array(rows.length*4);solver.step(rows.map(b=>b.id),states,geometry,scene,clock,reduced,output);clock+=frameMs;
  }
  return rows.map((b,i)=>({angle:output[i*4],x:b.x+output[i*4+1],y:(b.floor??300)-(b.height??200)/2-output[i*4+2],active:output[i*4+3]}));
 },free(){solver.free();scene.free()}};
}
const book=(id,x,extra={})=>({id,x,...extra});
it('settles an old library on opening without touching a book, then sleeps',()=>{
 const f=fixture([book('one',130),book('two',160),book('three',190)]);
 const start=f.step(),final=f.step(600);
 expect(final.some(b=>Math.abs(b.angle)>.3)).toBe(true);
 expect(final.every(b=>b.active===0)).toBe(true);
 expect(f.step(30)).toEqual(final);f.free();
});
it('a spring grip physically pushes unselected neighbours and propagates a domino chain',()=>{
 const f=fixture([book('hand',80,{flags:2,width:10}),...['a','b','c','d'].map((id,i)=>book(id,115+i*35,{flags:2,width:10}))]);
 f.step();for(const b of f.rows.slice(1))b.flags=0;
 const standing=f.step(120);expect(standing.slice(1).every(b=>Math.abs(b.angle)<.01)).toBe(true);
 for(let i=0;i<30;i++){f.rows[0].drag=i*100/29;f.rows[0].dragY=-150;f.step();}
 const chain=f.step(240);expect(chain.slice(1).filter(b=>Math.abs(b.angle)>.25).length).toBeGreaterThanOrEqual(3);
 f.rows[0].flags=0;f.rows[0].x+=100;f.rows[0].drag=0;
 const final=f.step(600);
 expect(final.slice(1).filter(b=>Math.abs(b.angle)>.25).length).toBeGreaterThanOrEqual(3);
 expect(final[4].x).toBeGreaterThan(220);
 expect(final.some(b=>b.y+100*Math.abs(Math.cos(b.angle))+5*Math.abs(Math.sin(b.angle))<298)).toBe(true);
 expect(final.every(b=>Number.isFinite(b.x)&&b.y<301)).toBe(true);f.free();
});
it('removing a support wakes resting books and allows a further fall',()=>{
 const f=fixture([book('a',100),book('b',140),book('support',200,{kind:1,width:50,height:100})]);
 const resting=f.step(600);f.rows.pop();const after=f.step(600);
 expect(after.some((b,i)=>Math.abs(b.angle-resting[i].angle)>.03||Math.abs(b.x-resting[i].x)>2)).toBe(true);
 expect(after.every(b=>b.active===0)).toBe(true);f.free();
});
it('keeps books above their board and physically separated after a chain settles',()=>{
 const f=fixture([book('a',100),book('b',130),book('c',160),book('d',190)]);const final=f.step(600);
 for(const b of final){const extent=100*Math.abs(Math.cos(b.angle))+10*Math.abs(Math.sin(b.angle));expect(b.y+extent).toBeLessThan(300.7);}
 // Separating-axis test in the fall plane; touching cuboids may overlap only
 // by the solver's sub-millimetre contact tolerance, never by a book thickness.
 for(let i=0;i<final.length;i++)for(let j=i+1;j<final.length;j++){
  const a=final[i],b=final[j];let separation=-Infinity;
  for(const theta of [a.angle,a.angle+Math.PI/2,b.angle,b.angle+Math.PI/2]){
   const ux=Math.cos(theta),uy=-Math.sin(theta);
   const radius=c=>10*Math.abs(Math.cos(c.angle)*ux-Math.sin(c.angle)*uy)+100*Math.abs(Math.sin(c.angle)*ux+Math.cos(c.angle)*uy);
   separation=Math.max(separation,Math.abs((b.x-a.x)*ux+(b.y-a.y)*uy)-radius(a)-radius(b));
  }
  expect(separation).toBeGreaterThan(-.8);
 }f.free();
});
it('does not collide through a ceiling puck or mix different bays',()=>{
 const a=fixture([book('a',100),book('b',140)]),b=fixture([book('a',100),book('puck',120,{kind:3}),book('b',140)]);
 const first=a.step(600),second=b.step(600);expect(second[0]).toEqual(first[0]);expect(second[2]).toEqual(first[1]);a.free();b.free();
 const c=fixture([book('a',100),book('other bay',100,{shelf:1,floor:600})]);const result=c.step(600);expect(result[1].y-result[0].y).toBeCloseTo(300,0);c.free();
});
it('keeps UTF-16 IDs distinct, and reduced motion resolves real contacts without endless work',()=>{
 const f=fixture([book('\ud800',100),book('\udfff',150),book('�',200)]);const result=f.step(5,true);
 expect(result.every(b=>Number.isFinite(b.angle)&&b.active===0)).toBe(true);
 expect(new Set(result.map(b=>b.x)).size).toBe(3);f.free();
});

it('removing a real book, including the reader away state, releases books supported by it',()=>{
 for(const remove of [true,false]){
  const f=fixture([book('a',100),book('b',140),book('support',200,{flags:2,width:50,height:100})]);
  const before=f.step(600);expect(before.every(b=>b.active===0)).toBe(true);
  if(remove)f.rows.pop();else f.rows[2].flags=1;
  const after=f.step(600);
  expect(after.slice(0,2).some((b,i)=>Math.abs(b.angle-before[i].angle)>.03||Math.abs(b.x-before[i].x)>2)).toBe(true);
  expect(after.every(b=>b.active===0)).toBe(true);f.free();
 }
});
it('a held book and its neighbours can sleep while the finger remains still',()=>{
 const f=fixture([book('hand',80,{flags:2}),book('a',130)]);
 f.step();f.rows[0].drag=20;f.rows[0].dragY=-30;
 const held=f.step(600);expect(held.every(b=>b.active===0)).toBe(true);expect(f.step(30)).toEqual(held);f.free();
});

it('carries a lifted book across boards and releases it in the selected bay without snapping back',()=>{
 const f=fixture([book('hand',80,{flags:2}),book('lower',400,{shelf:1,floor:600})]);
 f.step();f.rows[0].dragY=300;const held=f.step(180);
 expect(held[0].y).toBeGreaterThan(480);expect(held[0].y).toBeLessThan(520);
 Object.assign(f.rows[0],{flags:0,dragY:0,shelf:1,floor:600});
 const released=f.step();expect(Math.abs(released[0].y-held[0].y)).toBeLessThan(2);
 const settled=f.step(600);expect(settled[0].y).toBeLessThan(501);expect(settled.every(b=>b.active===0)).toBe(true);f.free();
});

it('reaches the same resting contacts with slow GPU frames and normal display frames',()=>{
 const rows=()=>[book('a',100),book('b',140),book('support',200,{kind:1,width:50,height:100})];
 const fast=fixture(rows()),slow=fixture(rows());fast.step(600);slow.step(600);fast.rows.pop();slow.rows.pop();
 const a=fast.step(900),b=slow.step(30,false,500);
 expect(b.every(book=>book.active===0)).toBe(true);
 for(let i=0;i<a.length;i++){expect(b[i].x).toBeCloseTo(a[i].x,3);expect(b[i].y).toBeCloseTo(a[i].y,3);expect(b[i].angle).toBeCloseTo(a[i].angle,4);}
 fast.free();slow.free();
});
it('does not fast-forward a new fall by the time spent idle',()=>{
 const f=fixture([book('a',100),book('b',140),book('support',200,{kind:1,width:50,height:100})]);
 const before=f.step(600);f.step(1,false,60_000);f.rows.pop();const first=f.step();
 for(let i=0;i<first.length;i++){expect(Math.abs(first[i].x-before[i].x)).toBeLessThan(2);expect(Math.abs(first[i].angle-before[i].angle)).toBeLessThan(.02);}
 const after=f.step(600);expect(after.some((b,i)=>Math.abs(b.angle-before[i].angle)>.03)).toBe(true);f.free();
});
