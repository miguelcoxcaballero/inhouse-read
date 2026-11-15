// @vitest-environment node
import {expect,it} from 'vitest';
import {rustShelf as rust} from './helpers/rust-shelf-ready.js';

// The scene asked its view up to five questions in a row (turning, reordering, trashEasing, moving,
// hasDrop); `busy` answers them in one read. Over random turns, reorders, lid eases, finger moves,
// drop guides and frames, it is always the five getters' answers, bit for bit.
it('answers the five getters in one read',()=>{
 let seed=99;
 const random=()=>(seed=Math.imul(seed,1664525)+1013904223>>>0)/4294967296,chance=p=>random()<p;
 const scene=new rust.RustScene(600,900,600,250,false,false,0);
 scene.sizeViewport(800,800,2,new Float64Array(4));
 let now=0;const seen=new Set();
 for(let round=0;round<20000;round++){
  now+=Math.floor(random()*120);
  const action=random();
  if(action<.12)scene.setMode(chance(.5),chance(.8),now,0);
  else if(action<.2)scene.beginReorder(now);
  else if(action<.3)scene.setDrop(chance(.6),Math.floor(random()*3),random()*500,chance(.2),3);
  else if(action<.42)scene.setInspection(1+random(),random()*10,random()*10,chance(.5));
  else if(action<.5)scene.trashSetHover(chance(.5),chance(.8),now);
  else if(action<.54)scene.trashCancelDrop(random(),now);
  else if(action<.57)scene.trashReset();
  else if(action<.8)scene.beginFrame(now);
  else scene.trashBegin(now,chance(.1));
  const five=(scene.turning?1:0)|(scene.reordering?2:0)|(scene.trashEasing?4:0)|(scene.moving?8:0)|(scene.hasDrop?16:0);
  expect(scene.busy,`round ${round}`).toBe(five);seen.add(five);
 }
 // Every one of the five was seen set and clear.
 for(const bit of [1,2,4,8,16]){expect([...seen].some(value=>value&bit)).toBe(true);expect([...seen].some(value=>!(value&bit))).toBe(true);}
 expect(seen.size).toBeGreaterThan(12);
 scene.free();
});
