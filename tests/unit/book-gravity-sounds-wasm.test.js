// @vitest-environment node
import {expect,it} from 'vitest';
import {rustShelf} from './helpers/rust-shelf-ready.js';

function shelf(metal=false,rows=[{id:'book',x:300,flags:2}],hand=0){
 const solver=new rustShelf.RustBookGravity(),scene=new rustShelf.RustScene(600,1200,600,250,metal,false,0);
 let time=0;const hits=[];
 return {solver,hits,rows,move(a,b){rows[hand].dx=a;rows[hand].dy=b;},release(){rows[hand].flags=0;rows[hand].x+=rows[hand].dx||0;rows[hand].dx=rows[hand].dy=0;},
  step(n=1){for(let i=0;i<n;i++){
   scene.beginEntries(time,false,1,new Float64Array([0,0,0,1]),1,600,0,18);
   const states=new Float64Array(rows.length*37),geometry=new Float64Array(rows.length*9),output=new Float64Array(rows.length*4);
   rows.forEach((b,i)=>{const h=b.height??200;
    states.set([b.kind??0,0,b.flags??0,b.dx??0,b.dy??0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,0,0,0,b.x,300-h/2,150,h,150,0],i*37);
    geometry.set([b.width??18,b.kind??0,0,1000,0,600,300,10,0],i*9);
   });
   solver.step(rows.map(b=>b.id),states,geometry,scene,time,false,output);time+=1000/60;
   const sounds=solver.take_sounds();if(sounds)for(let k=0;k<sounds.length;k+=3)hits.push([...sounds.slice(k,k+3),output[0],time]);
  }},free(){solver.free();scene.free();}};
}

it('reports real board impacts with the correct material and no idle repeats',()=>{
 for(const metal of [false,true]){
  const f=shelf(metal);f.solver.sound_enabled(true);f.step(90);expect(f.hits).toEqual([]);
  for(let i=1;i<=30;i++){f.move(i*1.2,-70);f.step();}f.release();f.step(600);
  expect(f.hits.length).toBeGreaterThan(0);expect(f.hits.length).toBeLessThan(12);
  for(const [material,strength,pan] of f.hits){expect(material).toBe(metal?2:1);expect(strength).toBeGreaterThan(0);expect(strength).toBeLessThanOrEqual(1);expect(Math.abs(pan)).toBeLessThanOrEqual(.7);}
  // The cover must make its own sound after the toe has already contacted
  // the same board; a CollisionStarted-only handler misses this impact.
  expect(f.hits.some(h=>Math.abs(h[3])>.8)).toBe(true);
  const count=f.hits.length;f.step(300);expect(f.hits).toHaveLength(count);f.free();
 }
});

it('reports paper contact when the moving book has either collider order',()=>{
 for(const reversed of [false,true]){
  const rows=[{id:'hand',x:80,flags:2},{id:'rest',x:135,flags:2}];if(reversed)rows.reverse();
  const f=shelf(false,rows,reversed?1:0);f.solver.sound_enabled(true);f.step(90);
  for(let i=1;i<=30;i++){f.move(70*i/30,0);f.step();}
  expect(f.hits.some(h=>h[0]===0),JSON.stringify({reversed,hits:f.hits})).toBe(true);f.free();
 }
});

it('distinguishes actual glass and ceramic subshapes from their surrounding boxes',()=>{
 for(const glass of [false,true]){
  const f=shelf(false,[{id:'book',x:130,flags:2,height:100},{id:'decor',x:240,kind:glass?2:1,width:100,height:150}]);
  f.solver.decoration('decor',glass?3:1,glass?'':'muskot',glass?'':'muskot',Float64Array.from(glass?[0,0,0,.0006]:[.04,.07,.15,0]));
  f.solver.sound_enabled(true);f.step(90);
  f.move(0,-180);f.step(90);
  for(let i=1;i<=90;i++){f.move(110*i/90,-180);f.step();}f.release();f.step(600);
  expect(f.hits.some(h=>h[0]===(glass?3:4)),JSON.stringify({glass,hits:f.hits})).toBe(true);f.free();
 }
});

it('does no contact audio while disabled and discards pending audio on pause',()=>{
 const f=shelf();f.step(90);for(let i=1;i<=30;i++){f.move(i,-50);f.step();}f.release();f.step(600);
 expect(f.hits).toEqual([]);f.solver.sound_enabled(true);f.step(120);expect(f.hits).toEqual([]);
 f.solver.pause();expect(f.solver.take_sounds()).toBeUndefined();f.solver.sound_enabled(false);f.free();
});
