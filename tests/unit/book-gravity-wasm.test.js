// @vitest-environment node
import {readFileSync} from 'node:fs'
import {plantGeometrySpec,lampGeometrySpec} from '../../src/js/decor-geometry-spec.js'
import {expect,it} from 'vitest'
import {rustShelf} from './helpers/rust-shelf-ready.js'
import {readGeometry} from './helpers/geo-packet.js'
import {openPacket,geometryOf} from '../../src/js/geo-packet.js'
function fixture(rows,metal=false,animated=false){
 const solver=new rustShelf.RustBookGravity(),scene=new rustShelf.RustScene(600,1200,600,250,metal,false,0);
 let clock=0;const previous=new Map();
 return {rows,decoration:(...args)=>solver.decoration(...args),pause:()=>solver.pause(),snapshot:()=>solver.snapshot(),restore:value=>solver.restore(value),step(frames=1,reduced=false,frameMs=1000/60){let output;
  for(let frame=0;frame<frames;frame++){
   scene.beginEntries(clock,reduced,1,new Float64Array([0,0,0,1]),1,600,0,18);
   const states=new Float64Array(rows.length*37),geometry=new Float64Array(rows.length*9);
   rows.forEach((b,i)=>{
    const height=b.height??200,y=(b.floor??300)-height/2;
    states.set([b.kind===3?2:b.kind??0,b.kind===3?1:0,b.flags??0,b.drag??0,b.dragY??0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,0,0,0,b.x,y,150,height,150,0],i*37);
    states[i*37+13]=b.previewX??0;states[i*37+14]=b.previewY??0;states[i*37+21]=b.offsetX??0;states[i*37+22]=b.offsetY??0;
    if(animated&&previous.has(b.id))states.set(previous.get(b.id).subarray(5,23),i*37+5);
    geometry.set([b.width??20,b.kind??0,b.shelf??0,1000,0,600,b.floor??300,b.ceiling??((b.floor??300)-290+((b.shelf??0)>0?15/.65-10:0)),b.grip??0],i*9);
   });
   output=new Float64Array(rows.length*4);solver.step(rows.map(b=>b.id),states,geometry,scene,clock,reduced,output);clock+=frameMs;
   if(animated)rows.forEach((b,i)=>previous.set(b.id,states.slice(i*37,i*37+37)));
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

it('fast sweeps stay quiet while deliberate slow placement can still push neighbours',()=>{
 const setup=()=>fixture([book('hand',80,{flags:2,width:16}),...['a','b','c'].map((id,i)=>book(id,135+i*50,{flags:2,width:16}))]);
 const slow=setup(),fast=setup();slow.step(120);fast.step(120);
 for(const f of [slow,fast]){for(const b of f.rows.slice(1))b.flags=0;f.step(60);}
 const beforeSlow=slow.step(),beforeFast=fast.step();
 for(let i=1;i<=90;i++){slow.rows[0].drag=80*i/90;slow.rows[0].dragY=-10*i/90;slow.step();}
 fast.rows[0].drag=80;fast.rows[0].dragY=-10;fast.step();
 const moved=slow.step(120),quiet=fast.step(210);
 expect(moved.slice(1).some((b,i)=>Math.abs(b.x-beforeSlow[i+1].x)>4||Math.abs(b.angle-beforeSlow[i+1].angle)>.08)).toBe(true);
 for(let i=1;i<quiet.length;i++){expect(Math.abs(quiet[i].x-beforeFast[i].x)).toBeLessThan(.7);expect(Math.abs(quiet[i].angle-beforeFast[i].angle)).toBeLessThan(.02);}
 slow.free();fast.free();
});
it('animates a fallen book upright on pickup rather than retaining its fallen angle',()=>{
 const f=fixture([book('fallen',130)]);const resting=f.step(600);expect(Math.abs(resting[0].angle)).toBeGreaterThan(.5);
 f.rows[0].flags=2;const first=f.step();expect(Math.abs(first[0].angle-resting[0].angle)).toBeLessThan(.12);
 const upright=f.step(45);expect(Math.abs(upright[0].angle)).toBeLessThan(.025);
 expect(upright[0].y+100).toBeLessThan(301);expect(f.step(600)[0].active).toBe(0);f.free();
});
it('keeps even sub-millimetre books outside the actual posts, boards and ceiling',()=>{
 const f=fixture([book('left',2,{width:.4,height:12}),book('right',598,{width:.6,height:18})]);
 for(let frame=0;frame<180;frame++){
  for(const [i,b]of f.step().entries()){
   const row=f.rows[i],ex=row.width/2*Math.abs(Math.cos(b.angle))+row.height/2*Math.abs(Math.sin(b.angle));
   const ey=row.height/2*Math.abs(Math.cos(b.angle))+row.width/2*Math.abs(Math.sin(b.angle));
   expect(b.x-ex).toBeGreaterThanOrEqual(12/.65-.05);
   expect(b.x+ex).toBeLessThanOrEqual(600-12/.65+.05);
   expect(b.y+ey).toBeLessThanOrEqual(300.05);expect(b.y-ey).toBeGreaterThanOrEqual(9.95);
  }
 }f.free();
});

it('touching a resting book without lifting does not wake or rotate the library',()=>{
 const f=fixture([book('a',100),book('b',140)]),rest=f.step(600);
 f.rows[0].flags=8;expect(f.step(30)).toEqual(rest);
 f.rows[0].flags=0;expect(f.step(30)).toEqual(rest);f.free();
});
it('fast placement settles quietly even when released over another book',()=>{
 const f=fixture([book('hand',80,{flags:2,width:16}),...['a','b','c'].map((id,i)=>book(id,135+i*50,{flags:2,width:16}))]);
 f.step(120);for(const b of f.rows.slice(1))b.flags=0;f.step(60);const before=f.step();
 f.rows[0].drag=55;f.rows[0].dragY=-10;f.step(120);
 Object.assign(f.rows[0],{flags:0,x:135,drag:0,dragY:0});const settled=f.step(600);
 expect(settled.every(b=>b.active===0)).toBe(true);
 for(let i=1;i<settled.length;i++){
  expect(Math.abs(settled[i].angle)).toBeLessThan(.02);
  expect(Math.abs(settled[i].x-before[i].x)).toBeLessThan(20);
 }
 expect(Math.abs(settled[0].x-settled[1].x)).toBeGreaterThan(15.2);f.free();
});
it('uses the white metal post dimensions for tiny books as well as the wooden walls',()=>{
 const f=fixture([book('left',2,{width:.4,height:12}),book('right',598,{width:.6,height:18})],true);
 for(let frame=0;frame<180;frame++)for(const [i,b]of f.step().entries()){
  const row=f.rows[i],ex=row.width/2*Math.abs(Math.cos(b.angle))+row.height/2*Math.abs(Math.sin(b.angle));
  const ey=row.height/2*Math.abs(Math.cos(b.angle))+row.width/2*Math.abs(Math.sin(b.angle));
  expect(b.x-ex).toBeGreaterThanOrEqual(17.95);expect(b.x+ex).toBeLessThanOrEqual(582.05);
  expect(b.y+ey).toBeLessThanOrEqual(300.05);expect(b.y-ey).toBeGreaterThanOrEqual(9.95);
 }f.free();
});

it('rests against a post and a large plant, then wakes and falls when the support disappears',()=>{
 const f=fixture([book('thin',28,{width:4,height:240}),book('pot',110,{kind:1,width:130,height:160}),book('other',250,{width:4,height:200})]);
 const supported=f.step(600);expect(supported.every(b=>b.active===0)).toBe(true);
 expect(f.step(120)).toEqual(supported);
 f.rows.splice(1,1);const after=f.step(600);
 expect(after[0].active).toBe(0);expect(Math.abs(after[0].angle-supported[0].angle)).toBeGreaterThan(.03);
 f.free();
});


it('tips in the recent finger direction on release, including a reversal and a brief pause',()=>{
 for(const direction of [-1,1])for(const pause of [0,6]){
  const f=fixture([book('hand',300,{flags:2,width:18})]);f.step(90);
  // Earlier travel in the opposite direction must not override the release.
  for(let i=1;i<=12;i++){f.rows[0].drag=-direction*i;f.step();}
  for(let i=1;i<=30;i++){f.rows[0].drag=-direction*12+direction*i;f.step();}
  if(pause)f.step(pause);const held=f.step()[0];
  Object.assign(f.rows[0],{flags:0,x:318,drag:0});const first=f.step()[0];
  expect(Math.abs(first.angle-held.angle)).toBeLessThan(.05);
  const final=f.step(600)[0];expect(final.angle*direction).toBeLessThan(-.7);
  expect(final.active).toBe(0);expect(f.step(60)[0]).toEqual(final);f.free();
 }
});
it('top and bottom grips swing oppositely while the pickup still straightens the book',()=>{
 const poses=[];
 for(const grip of [-.4,.4]){
  const f=fixture([book('hand',300,{flags:2,width:18,grip})]);f.step(90);
  let pose;for(let i=1;i<=30;i++){f.rows[0].drag=i*2;pose=f.step()[0];}
  poses.push(pose);expect(Math.abs(pose.angle)).toBeLessThan(.15);
  // A stationary finger recovers a calm, vertical hold.
  expect(Math.abs(f.step(90)[0].angle)).toBeLessThan(.01);f.free();
 }
 expect(poses[0].angle).toBeGreaterThan(.015);expect(poses[1].angle).toBeLessThan(-.015);
});
it('drops a fast drag without skating along the board before it tips',()=>{
 for(const direction of [-1,1]){
  const f=fixture([book('hand',300,{flags:2,width:18})]);f.step(90);
  f.rows[0].drag=direction*100;const held=f.step(3)[0];
  Object.assign(f.rows[0],{flags:0,x:300+direction*100,drag:0});
  const first=f.step()[0];expect(Math.abs(first.x-held.x)).toBeLessThan(.5);
  // Before gravity has tipped the centre, it must not coast across the shelf.
  const early=f.step(6)[0];expect(Math.abs(early.x-first.x)).toBeLessThan(3);
  const final=f.step(600)[0];expect(final.angle*direction).toBeLessThan(-.7);
  expect(final.active).toBe(0);f.free();
 }
});

it('eases an off-centre pickup without a sudden sideways or upward lurch',()=>{
 for(const grip of [-.4,.4]){
  const f=fixture([book('fallen',300,{width:18,grip})]);const rest=f.step(600)[0];
  expect(Math.abs(rest.angle)).toBeGreaterThan(.7);f.rows[0].flags=2;
  const first=f.step()[0];expect(Math.abs(first.x-rest.x)).toBeLessThan(2);expect(Math.abs(first.y-rest.y)).toBeLessThan(2);
  const upright=f.step(90)[0];expect(Math.abs(upright.angle)).toBeLessThan(.01);
  expect(upright.y+100).toBeLessThan(301);f.free();
 }
});

it('keeps the supporting bottom corner planted throughout a free fall on either shelf material',()=>{
 for(const metal of [false,true])for(const direction of [-1,1]){
  const f=fixture([book('hand',300,{flags:2,width:18})],metal);f.step(90);
  for(let frame=1;frame<=30;frame++){f.rows[0].drag=direction*frame;f.step();}
  const held=f.step(6)[0];Object.assign(f.rows[0],{flags:0,drag:0,x:300+direction*30});
  const points=[];let final;
  for(let frame=0;frame<600;frame++){
   final=f.step()[0];const a=final.angle;
   // The toe under a falling book must stay put; its centre necessarily
   // follows an arc, so measuring only the centre would miss skating.
   const toe=final.x+direction*9*Math.cos(a)+100*Math.sin(a);
   points.push(toe);
  }
  const drift=Math.max(...points)-Math.min(...points);
  console.log('TOE_DRIFT',JSON.stringify({metal,direction,drift,held,final}));
  expect(final.angle*direction).toBeLessThan(-.7);expect(final.active).toBe(0);
  expect(drift).toBeLessThan(1.5);f.free();
 }
});


it('a careful pickup retains a shallow resting contact instead of crossing the adjacent support',()=>{
 const f=fixture([book('hand',100,{flags:2}),book('support',119.5,{kind:1})]);
 const before=f.step(90);
 for(let frame=1;frame<=30;frame++){f.rows[0].drag=frame*3;f.step();}
 const after=f.step(300);
 // A fixed support isolates the contact being tested: it cannot topple
 // before the push and turn this into a test of an unrelated initial fall.
 expect(after[0].x).toBeLessThan(100.4);
 expect(Math.abs(after[0].x-before[0].x)).toBeLessThan(2);
 expect(after[1].x).toBe(before[1].x);f.free();
});

it('keeps unrelated shelves asleep through pickup, pushing, release and removal',()=>{
 const rows=Array.from({length:12},(_,shelf)=>[80,130,180].map((x,i)=>book(`row:${shelf}:${i}`,x,{shelf,floor:300+shelf*320})) ).flat();
 const f=fixture(rows);const before=f.step(600);expect(before.every(b=>b.active===0)).toBe(true);
 const unchanged=output=>{for(let i=3;i<rows.length;i++)expect(output[i]).toEqual(before[i]);};
 rows[0].flags=2;unchanged(f.step());
 for(let frame=1;frame<=30;frame++){rows[0].drag=frame*2;rows[0].dragY=-20;unchanged(f.step());}
 rows[0].flags=0;rows[0].x+=60;rows[0].drag=rows[0].dragY=0;unchanged(f.step());unchanged(f.step(600));
 rows[0].flags=1;unchanged(f.step());unchanged(f.step(600));f.free();
});

it('supports books on the rendered pot walls rather than the empty foliage envelope',()=>{
 for(const pot of ['muskot','gradvis','akerbar','muskotblomma']){
  const f=fixture([book('hand',100,{flags:2,width:18}),book('plant',210,{kind:1,width:200,height:260})]);
  f.decoration('plant',1,pot,pot,Float64Array.of(.045,.070,.260,0));f.step(90);
  for(let frame=1;frame<=30;frame++){f.rows[0].drag=frame;f.step();}Object.assign(f.rows[0],{flags:0,x:130,drag:0});const solved=f.step(600),rest=solved[0];
  const geometry=readGeometry(rustShelf.probe_plant_part('pot',pot,Float64Array.of(45,70,.84),new Float64Array()));
  const points=geometry.attributes.position.array;let gap=Infinity;
  for(let i=0;i<points.length;i+=3){
   const dx=solved[1].x+points[i]-rest.x,dy=solved[1].y+130-points[i+1]-rest.y,c=Math.cos(rest.angle),s=Math.sin(rest.angle);
   const x=Math.abs(dx*c-dy*s)-9,y=Math.abs(-dx*s-dy*c)-100;
   gap=Math.min(gap,Math.hypot(Math.max(0,x),Math.max(0,y))+Math.min(Math.max(x,y),0));
  }
  console.info('DECOR_CONTACT',JSON.stringify({pot,rest,gap}));
  expect(rest.active).toBe(0);expect(Math.abs(rest.angle)).toBeGreaterThan(.25);expect(gap).toBeGreaterThan(-1.5);expect(gap).toBeLessThan(2);
  f.rows[1].flags=8;expect(f.step(60)[0]).toEqual(rest);
  f.rows[1].flags=2;const without=f.step(600)[0];expect(Math.abs(without.angle-rest.angle)).toBeGreaterThan(.1);expect(without.active).toBe(0);f.free();
 }
});
it('keeps deliberate book contacts active inside the empty space below a tripod shade',()=>{
 const f=fixture([book('hand',270,{flags:2,width:18,height:60}),book('lamp',200,{kind:2,width:180,height:280}),book('support',292,{kind:1,width:12,height:80})]);
 f.decoration('lamp',2,'','',Float64Array.of(0,0,0,.001));f.step(120);
 for(let frame=1;frame<=60;frame++){f.rows[0].drag=frame;f.step();}
 const held=f.step(180);expect(held[0].x).toBeLessThan(281);expect(held[0].x).toBeGreaterThan(270);expect(held[2].x).toBeCloseTo(292,3);f.free();
});

it('a normal deliberate drag pushes neighbours without needing an extremely slow gesture',()=>{
 const f=fixture([book('hand',80,{flags:2,width:16}),...['a','b','c'].map((id,i)=>book(id,135+i*50,{flags:2,width:16}))]);
 f.step(120);for(const b of f.rows.slice(1))b.flags=0;const before=f.step(60);
 // 0.48 m/s is an ordinary ~200 px/s drag on a phone, not a rapid sweep.
 for(let i=1;i<=10;i++){f.rows[0].drag=8*i;f.rows[0].dragY=-i;f.step();}
 const after=f.step(180);
 expect(after.slice(1).some((b,i)=>Math.abs(b.x-before[i+1].x)>4||Math.abs(b.angle-before[i+1].angle)>.08)).toBe(true);f.free();
});
it('slow movement restores resting contacts after a quick vertical pickup adjustment',()=>{
 const f=fixture([book('hand',100,{flags:2}),book('support',119.5,{kind:1,width:20,height:200})]);
 f.step(90);f.rows[0].dragY=-20;f.step();f.step(20);
 for(let frame=1;frame<=30;frame++){f.rows[0].drag=frame*.5;f.step();}
 const after=f.step(180);expect(after[0].x).toBeLessThan(100.4);expect(after[1].x).toBeCloseTo(119.5,3);f.free();
});

it('keeps an animated isometric pickup in its real depth plane and preserves deliberate contacts',()=>{
 const solver=new rustShelf.RustBookGravity(),scene=new rustShelf.RustScene(600,1200,600,250,false,true,0);
 const q=[-.25,.32,.1,.91],norm=Math.hypot(...q),inverse=Float64Array.from(q,v=>v/norm);
 const states=new Float64Array(74),geometry=new Float64Array(18),out=new Float64Array(8);
 states.set([0,0,4,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,0,0,0,100,200,150,200,150,0]);
 states.set([1,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,0,0,0,119.5,200,150,200,150,0],37);
 geometry.set([20,0,0,1000,0,600,300,10,0]);geometry.set([20,1,0,1000,0,600,300,10,0],9);
 const step=frame=>{scene.beginEntries(frame*1000/60,false,1,inverse,1,600,0,18);solver.step(['hand','support'],states,geometry,scene,frame*1000/60,false,out);};
 for(let frame=0;frame<=120;frame++)step(frame);
 expect(states[5]).toBe(1);expect(Math.abs(out[1])).toBeLessThan(1);expect(states[31]).toBe(-75);expect(states[33]).toBe(Math.PI/2);
 states[2]=6;
 for(let frame=121;frame<=160;frame++){states[3]=(frame-120)*.5;step(frame);}
 expect(100+out[1]).toBeLessThan(100.4);expect(100+out[1]).toBeGreaterThan(98);solver.free();scene.free();
});

it('slides down side contacts to the board instead of sleeping while wedged in mid-air',()=>{
 const f=fixture([book('hand',150,{flags:2,width:20,height:160}),book('left',130.25,{kind:1,width:20,height:200}),book('right',169.75,{kind:1,width:20,height:200})]);
 f.step(90);f.rows[0].dragY=-40;f.step(120);f.rows[0].flags=0;f.rows[0].dragY=0;
 const rest=f.step(600)[0];console.info('SIDE_SUPPORT_REST',JSON.stringify(rest));
 expect(rest.y+80).toBeGreaterThan(299);expect(rest.y+80).toBeLessThan(301);expect(rest.active).toBe(0);f.free();
});

it('restores a complete resting scene without reseeding its position or orientation',()=>{
 const rows=()=>[book('a',100),book('b',140),book('pot',210,{kind:1,width:50,height:100})];
 const first=fixture(rows()),before=first.step(600),saved=first.snapshot();expect(typeof saved).toBe('string');expect(first.snapshot()).toBeUndefined();first.free();
 const reopened=fixture(rows());expect(reopened.restore(saved)).toBe(true);const after=reopened.step();
 for(let i=0;i<after.length;i++){expect(after[i].x).toBeCloseTo(before[i].x,5);expect(after[i].y).toBeCloseTo(before[i].y,5);expect(after[i].angle).toBeCloseTo(before[i].angle,6);expect(after[i].active).toBe(0);}
 expect(reopened.step(180)).toEqual(after);reopened.free();
});
it('restores UTF-16 identities distinctly, rejects malformed poses atomically and lets missing supports fall',()=>{
 const rows=()=>[book('\ud800',100),book('\udfff',140),book('�',210,{kind:1,width:50,height:100})];
 const original=fixture(rows()),before=original.step(600),saved=original.snapshot();original.free();
 const names=JSON.parse(saved)[2].map(row=>row[0]);expect(new Set(names).size).toBe(3);
 const same=fixture(rows());expect(same.restore(saved)).toBe(true);expect(same.restore('{bad')).toBe(false);expect(same.restore(JSON.stringify([1,[],[[1]]]))).toBe(false);expect(same.step().every(b=>b.active===0)).toBe(true);same.free();
 const removed=fixture(rows().slice(0,2));expect(removed.restore(saved)).toBe(true);const after=removed.step(600);
 expect(after.some((b,i)=>Math.abs(b.angle-before[i].angle)>.03)).toBe(true);expect(after.every(b=>b.active===0)).toBe(true);removed.free();
});
it('does not overwrite the complete saved scene while a book is held or in the reader',()=>{
 const f=fixture([book('a',100),book('b',140)]);f.step(600);expect(typeof f.snapshot()).toBe('string');
 f.rows[0].flags=2;f.step(180);expect(f.snapshot()).toBeUndefined();f.rows[0].flags=1;f.step(600);expect(f.snapshot()).toBeUndefined();f.free();
});
it('preserves real upward support on another object instead of forcing every book through it',()=>{
 const f=fixture([book('hand',300,{flags:2,width:20,height:100}),book('slab',300,{kind:1,width:180,height:20})]);
 f.step(90);f.rows[0].dragY=-25;f.step(120);f.rows[0].flags=0;f.rows[0].dragY=0;const rest=f.step(600)[0];
 expect(rest.y+50).toBeGreaterThan(279);expect(rest.y+50).toBeLessThan(281);expect(rest.active).toBe(0);f.free();
});

it('preserves solid-supported poses on reload and recalculates obsolete envelope supports',()=>{
 const rows=()=>[book('hand',360,{flags:2,width:18,height:100}),book('plant',300,{kind:1,width:180,height:70})];
 const legacy=fixture(rows());legacy.step(90);legacy.rows[0].dragY=-90;legacy.step(120);legacy.rows[0].flags=0;legacy.rows[0].dragY=0;
 const floating=legacy.step(600)[0],old=legacy.snapshot();expect(floating.active).toBe(0);expect(floating.y).toBeLessThan(230);legacy.free();
 const current=fixture(rows().map(b=>({...b,flags:0})));expect(current.restore(old)).toBe(true);current.decoration('plant',1,'muskot','muskot',Float64Array.of(.02,.07,.07,0));
 const rest=current.step(600)[0];expect(rest.active).toBe(0);expect(rest.y+50*Math.abs(Math.cos(rest.angle))+9*Math.abs(Math.sin(rest.angle))).toBeGreaterThan(298);
 const saved=current.snapshot();expect(JSON.parse(saved)[2].find(row=>row[0]==='plant')[8]).toContain('solid-v1:');current.free();
 const reopened=fixture(rows().map(b=>({...b,flags:0})));reopened.decoration('plant',1,'muskot','muskot',Float64Array.of(.02,.07,.07,0));expect(reopened.restore(saved)).toBe(true);
 const after=reopened.step()[0];expect(after.active).toBe(0);expect(after.x).toBeCloseTo(rest.x,5);expect(after.y).toBeCloseTo(rest.y,5);expect(after.angle).toBeCloseTo(rest.angle,6);reopened.free();
});

it('rests against the actual lantern glass and base and releases it when the lamp is lifted',()=>{
 const f=fixture([book('hand',100,{flags:2,width:18,height:200}),book('lamp',210,{kind:2,width:150,height:250})]);
 f.decoration('lamp',3,'','',Float64Array.of(0,0,0,.001));f.step(90);
 for(let frame=1;frame<=60;frame++){f.rows[0].drag=frame/3;f.step();}
 Object.assign(f.rows[0],{flags:0,x:120,drag:0});const solved=f.step(600),rest=solved[0];expect(rest.active).toBe(0);expect(Math.abs(rest.angle)).toBeGreaterThan(.1);
 const packet=openPacket(rustShelf.lamp_geometry(2,64,1));let gap=Infinity;
 for(const batch of packet.header.batches){
  if(!['lamp-base','clear-glass-chimney','brass-collar-and-machined-dimmer'].includes(batch.name))continue;
  const geometry=geometryOf(packet,batch),points=geometry.attributes.position.array;
  for(let i=0;i<points.length;i+=3){const dx=solved[1].x+points[i]-rest.x,dy=solved[1].y+125-points[i+1]-rest.y,c=Math.cos(rest.angle),s=Math.sin(rest.angle);
   const x=Math.abs(dx*c-dy*s)-9,y=Math.abs(-dx*s-dy*c)-100;
   gap=Math.min(gap,Math.hypot(Math.max(0,x),Math.max(0,y))+Math.min(Math.max(x,y),0));}
  geometry.dispose();
 }
 expect(gap).toBeGreaterThan(-1.5);expect(gap).toBeLessThan(2);
 f.rows[1].flags=2;const without=f.step(600)[0];console.info('LANTERN_CONTACT',{rest,without,gap});expect(Math.abs(without.angle-rest.angle)).toBeGreaterThan(.1);expect(without.active).toBe(0);f.free();
});

it('lands a pot on a fallen book and drops it back to the board when that book is removed',()=>{
 const f=fixture([book('hand',100,{flags:2,width:20,height:160}),book('plant',360,{kind:1,width:80,height:150})]);
 f.decoration('plant',1,'muskot','muskot',Float64Array.of(.03,.07,.15,0));f.step(90);
 for(let frame=1;frame<=30;frame++){f.rows[0].drag=frame;f.step();}Object.assign(f.rows[0],{flags:0,x:130,drag:0});const flat=f.step(600)[0];expect(Math.abs(flat.angle)).toBeGreaterThan(1.5);
 f.rows[1].flags=2;f.step(60);f.rows[1].x=flat.x;f.rows[1].dragY=-60;f.step(60);f.rows[1].flags=0;f.rows[1].dragY=0;
 const stack=f.step(600);console.info('POT_ON_COVER',{flat,stack});expect(stack.every(b=>b.active===0)).toBe(true);
 expect(stack[1].y+75).toBeGreaterThan(278);expect(stack[1].y+75).toBeLessThan(282);expect(Math.abs(stack[0].x-flat.x)).toBeLessThan(3);
 const saved=f.snapshot();expect(typeof saved).toBe('string');
 const reopened=fixture(f.rows.map(b=>({...b})));reopened.decoration('plant',1,'muskot','muskot',Float64Array.of(.03,.07,.15,0));expect(reopened.restore(saved)).toBe(true);
 const after=reopened.step();for(let i=0;i<after.length;i++){expect(after[i].active).toBe(0);expect(after[i].x).toBeCloseTo(stack[i].x,5);expect(after[i].y).toBeCloseTo(stack[i].y,5);expect(after[i].angle).toBeCloseTo(stack[i].angle,6);}expect(reopened.step(180)).toEqual(after);reopened.free();
 f.rows[0].flags=1;const removed=f.step(600);
 expect(removed[1].y+75).toBeGreaterThan(299);expect(removed[1].y+75).toBeLessThan(301);expect(removed[1].active).toBe(0);f.free();
});

it('animated brief plant presses do not move its support or rewrite the settled snapshot',()=>{
 const f=fixture([book('a',100),book('plant',210,{kind:1,width:120,height:260})],false,true);
 f.decoration('plant',1,'muskot','muskot',Float64Array.of(.045,.07,.26,0));const rest=f.step(600);expect(rest.every(b=>b.active===0)).toBe(true);expect(typeof f.snapshot()).toBe('string');
 f.rows[1].flags=8;expect(f.step(60)).toEqual(rest);f.rows[1].flags=0;expect(f.step(60)).toEqual(rest);expect(f.snapshot()).toBeUndefined();f.free();
});

it('keeps floor-supported pots and lamps asleep while an unrelated shelf is being dragged',()=>{
 const f=fixture([book('hand',100,{flags:2,shelf:2,floor:900}),book('lamp',210,{kind:2,shelf:1,floor:600,width:150,height:250}),book('plant',400,{kind:1,width:200,height:260})]);
 f.decoration('lamp',3,'','',Float64Array.of(0,0,0,.001));f.decoration('plant',1,'muskot','muskot',Float64Array.of(.045,.07,.26,0));f.step(600);
 const woke=[];for(let frame=1;frame<=180;frame++){f.rows[0].drag=10*Math.sin(frame/20);const values=f.step();if(values.slice(1).some(b=>b.active!==0))woke.push({frame,values});}
 console.info('DECOR_UNRELATED_WAKE',JSON.stringify({count:woke.length,last:woke.at(-1)}));expect(woke).toEqual([]);f.free();
});

it('puts the complete isometric library with a lantern and pot to sleep without ongoing repaints',()=>{
 const input=JSON.parse(readFileSync(new URL('./fixtures/decor-startup.json',import.meta.url),'utf8'));
 const solver=new rustShelf.RustBookGravity(),scene=new rustShelf.RustScene(input.width,input.height,input.sceneWidth,input.depth,true,true,0);
 const geometry=new Float64Array(input.entries.flatMap(e=>e.geometry)),keys=input.entries.map(e=>e.key),out=new Float64Array(keys.length*4);
 for(const e of input.entries){const p=e.geometry[3];
  if(e.state[0]===1){const v=plantGeometrySpec({catalogId:'sansevieria',potId:'muskot',height:e.state[26]});solver.decoration(e.key,1,v.potId,v.potModelId,Float64Array.of(v.real.potDiameter/2*v.unit/p,v.real.potHeight*v.unit/p,v.height/p,0));}
  if(e.state[0]===2){const v=lampGeometrySpec({lampId:'tarnaby',width:e.state[25],height:e.state[26]});solver.decoration(e.key,3,'','',Float64Array.of(0,0,0,v.scale/p));}
 }
 for(let frame=0;frame<1200;frame++){
  const states=new Float64Array(keys.length*37);input.entries.forEach((e,i)=>states.set(e.state.map(v=>v===null?NaN:v),i*37));
  scene.beginEntries(frame*1000/60,false,input.zoom,new Float64Array([0,0,0,1]),1,390,0,18);solver.step(keys,states,geometry,scene,frame*1000/60,false,out);
 }
 console.info('ISOMETRIC_DECOR_IDLE',JSON.stringify(keys.map((key,i)=>({key,pose:[...out.slice(i*4,i*4+4)]}))));
 expect(keys.filter((_,i)=>out[i*4+3]!==0)).toEqual([]);solver.free();scene.free();
});

it('does not raise a metal shelf floor with the ceiling collider of the bay underneath it',()=>{
 const f=fixture([book('a',300,{flags:2,width:20,height:160}),book('puck',300,{kind:3,shelf:1,floor:600,ceiling:303.75,width:40,height:10})],true);
 f.step(60);f.rows[0].drag=30;f.step(60);Object.assign(f.rows[0],{flags:0,x:330,drag:0});const rest=f.step(600)[0];
 const foot=rest.y+80*Math.abs(Math.cos(rest.angle))+10*Math.abs(Math.sin(rest.angle));console.info('METAL_ADJACENT_FLOOR',{rest,foot});
 expect(rest.active).toBe(0);expect(foot).toBeGreaterThan(298.5);expect(foot).toBeLessThan(300.5);f.free();
});

it('corrects a saved false metal-floor support once without reseeding the remembered orientation',()=>{
 const rows=()=>[book('a',330,{width:20,height:160}),book('puck',300,{kind:3,shelf:1,floor:600,ceiling:303.75,width:40,height:10})];
 const old=fixture(rows(),true),original=old.step(600)[0],saved=JSON.parse(old.snapshot());old.free();expect(saved[1].at(-1)).toBe(1);
 saved[1].pop();saved[2].find(row=>row[0]==='a')[6]+=.0117;
 const corrected=fixture(rows(),true);expect(corrected.restore(JSON.stringify(saved))).toBe(true);const pose=corrected.step(600)[0];
 const foot=pose.y+80*Math.abs(Math.cos(pose.angle))+10*Math.abs(Math.sin(pose.angle));expect(foot).toBeGreaterThan(298.5);expect(foot).toBeLessThan(300.5);expect(pose.angle).toBeCloseTo(original.angle,3);expect(pose.active).toBe(0);
 const current=corrected.snapshot();corrected.free();const reopened=fixture(rows(),true);expect(reopened.restore(current)).toBe(true);expect(reopened.step()[0]).toEqual(pose);expect(reopened.step(180)[0]).toEqual(pose);reopened.free();
});


it('keeps resting solid decorations fixed during another objects placement preview and return animation',()=>{
 const f=fixture([book('hand',80,{flags:2}),book('pot',300,{kind:1,width:90,height:160}),book('support',350,{width:14})]);
 f.decoration('pot',1,'muskot','muskot',Float64Array.of(.045,.07,.16,0));const before=f.step(600);
 for(let frame=0;frame<60;frame++){
  Object.assign(f.rows[1],{previewX:60*Math.sin(frame/20),previewY:-50*Math.sin(frame/20),offsetX:10*Math.sin(frame/9)});
  const now=f.step();expect(now[1].x).toBeCloseTo(before[1].x,4);expect(now[1].y).toBeCloseTo(before[1].y,4);
 }
 f.free();
});
it('does not scatter a dense resting row when a fast ghost grip is dropped inside it',()=>{
 const f=fixture([book('hand',80,{flags:2,width:16}),...Array.from({length:12},(_,i)=>book(`near:${i}`,180+i*18,{flags:2,width:16}))]);
 f.step(120);for(const b of f.rows.slice(1))b.flags=0;const before=f.step(120);
 f.rows[0].drag=190;f.rows[0].dragY=-8;f.step(120);Object.assign(f.rows[0],{flags:0,x:270,drag:0,dragY:0});
 const after=f.step(600);console.info('DENSE_DROP',JSON.stringify({before,after}));
 expect(after.every(b=>b.active===0)).toBe(true);
 for(let i=1;i<after.length;i++){expect(Math.abs(after[i].x-before[i].x)).toBeLessThan(3);expect(Math.abs(after[i].angle-before[i].angle)).toBeLessThan(.03);}
 f.free();
});

it('retains unrelated sleeping contact islands when a last item vacates a bay or occupies an empty bay',()=>{
 for(const metal of [false,true]){
  const f=fixture([book('hand',100),book('remote:a',100,{shelf:3,floor:1260}),book('remote:b',140,{shelf:3,floor:1260})],metal);
  f.step(600);f.rows[0].flags=2;f.step(90);const before=f.step();
  const same=values=>{expect(values[1]).toEqual(before[1]);expect(values[2]).toEqual(before[2]);};
  Object.assign(f.rows[0],{shelf:1,floor:620,dragY:320});same(f.step());same(f.step(120));
  Object.assign(f.rows[0],{flags:0,dragY:0});same(f.step());same(f.step(600));
  f.rows.shift();const removed=f.step();expect(removed[0]).toEqual(before[1]);expect(removed[1]).toEqual(before[2]);f.free();
 }
});

it('releases a solid inside the chosen bay when its held pot still crosses the upper board',()=>{
 const f=fixture([book('plant',100,{flags:2,kind:1,width:140,height:180})]);
 f.decoration('plant',1,'akerbar','akerbar',Float64Array.of(.07,.12,.18,0));f.step(90);f.rows[0].dragY=45;f.step(60);
 Object.assign(f.rows[0],{flags:0,dragY:0,x:400,shelf:1,floor:620});const rest=f.step(600)[0];
 expect(rest.x).toBeCloseTo(400,2);expect(rest.y+90).toBeGreaterThan(618);expect(rest.y+90).toBeLessThan(621);expect(rest.active).toBe(0);f.free();
});
it('returns an animated lifted pots collision depth before landing on a fallen cover',()=>{
 const f=fixture([book('hand',100,{flags:2,width:20,height:160}),book('plant',360,{kind:1,width:80,height:150})],false,true);
 f.decoration('plant',1,'muskot','muskot',Float64Array.of(.03,.07,.15,0));f.step(90);
 for(let frame=1;frame<=30;frame++){f.rows[0].drag=frame;f.step();}Object.assign(f.rows[0],{flags:0,x:130,drag:0});const flat=f.step(600)[0];expect(Math.abs(flat.angle)).toBeGreaterThan(1.5);
 f.rows[1].flags=2;f.step(60);f.rows[1].x=flat.x;f.rows[1].dragY=-60;f.step(60);f.rows[1].flags=0;f.rows[1].dragY=0;
 const rest=f.step(600);expect(rest.every(b=>b.active===0)).toBe(true);expect(rest[1].y+75).toBeGreaterThan(278);expect(rest[1].y+75).toBeLessThan(282);f.free();
});
it('lands either table lamp inside the chosen bay using its bottom origin',()=>{
 for(const lampId of ['tarnaby','tripod']){
  const native=lampGeometrySpec({lampId}).native,height=250,width=height*native.width/native.height;
  const f=fixture([book('lamp',100,{flags:2,kind:2,width,height})]);
  const spec=lampGeometrySpec({lampId,width,height});f.decoration('lamp',spec.kind===1?2:3,'','',Float64Array.of(0,0,0,spec.scale/1000));
  f.step(90);f.rows[0].dragY=45;f.step(60);Object.assign(f.rows[0],{flags:0,dragY:0,x:400,shelf:1,floor:620});const rest=f.step(600)[0];
  expect(rest.x).toBeCloseTo(400,2);expect(rest.y+height/2).toBeGreaterThan(618);expect(rest.y+height/2).toBeLessThan(621);expect(rest.active).toBe(0);f.free();
 }
});
it('repairs an obsolete tripod foot without resimulating the other saved bays',()=>{
 const native=lampGeometrySpec({lampId:'tripod'}).native,height=250,width=height*native.width/native.height;
 const rows=()=>[book('lamp',400,{kind:2,width,height}),book('remote:a',300,{height:100,shelf:2,floor:940}),book('remote:slab',300,{kind:1,width:180,height:20,shelf:2,floor:940})];
 const spec=lampGeometrySpec({lampId:'tripod',width,height}),register=f=>f.decoration('lamp',2,'','',Float64Array.of(0,0,0,spec.scale/1000));
 const oldRows=rows();oldRows[1].flags=2;const old=fixture(oldRows);register(old);old.step(90);old.rows[1].dragY=-25;old.step(120);old.rows[1].flags=0;old.rows[1].dragY=0;const before=old.step(600),saved=JSON.parse(old.snapshot());expect(before[1].y+50).toBeLessThan(925);old.free();const pose=saved[2].find(row=>row[0]==='lamp');pose[8]=pose[8].replace(/^solid-v\d+:/,'solid-v1:');pose[6]-=.0018;
 const f=fixture(rows());register(f);expect(f.restore(JSON.stringify(saved))).toBe(true);const first=f.step();
 expect(first[1]).toEqual(before[1]);expect(first[2]).toEqual(before[2]);const rest=f.step(600);expect(rest[1]).toEqual(before[1]);expect(rest[2]).toEqual(before[2]);expect(rest[0].active).toBe(0);expect(rest[0].y+height/2).toBeLessThan(301);expect(typeof f.snapshot()).toBe('string');f.rows[0].flags=2;const held=f.step(60);expect(held[1]).toEqual(before[1]);f.rows.pop();const fallen=f.step(600)[1];const foot=fallen.y+50*Math.abs(Math.cos(fallen.angle))+10*Math.abs(Math.sin(fallen.angle));expect(foot).toBeGreaterThan(938);expect(foot).toBeLessThan(941);expect(fallen.active).toBe(0);f.free();
});

it('keeps a saved decorated room asleep across equivalent viewport arithmetic and legacy signatures',()=>{
 for(const rounding of [1e-15,0.00004]){
 const rows=[book('one',100),book('plant',450,{kind:1,width:100,height:250})];
 const make=epsilon=>{const f=fixture(structuredClone(rows));f.decoration('plant',1,'muskot','muskot',new Float64Array([.075+epsilon,.15+epsilon,.25+epsilon,0]));return f};
 const a=make(0);a.step(600);const snapshot=JSON.parse(a.snapshot());a.free();
 const bits=v=>{const buffer=new ArrayBuffer(8);new Float64Array(buffer)[0]=v;return new BigUint64Array(buffer)[0].toString()};
 snapshot[2].find(r=>r[0]==='plant')[8]='solid-v1:1:muskot:muskot:['+[.075+rounding,.15+rounding,.25+rounding,0].map(bits).join(', ')+']';
 const b=make(2e-15);expect(b.restore(JSON.stringify(snapshot))).toBe(true);const first=b.step();expect(first.every(p=>p.active===0)).toBe(true);
 expect(b.step(120)).toEqual(first);const saved=JSON.parse(b.snapshot());
 for(const p of snapshot[2]){const q=saved[2].find(q=>q[0]===p[0]);for(const i of [5,6,7])expect(q[i]).toBeCloseTo(p[i],6)}b.free();
 }
})
