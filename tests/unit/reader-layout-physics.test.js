// @vitest-environment node
import {expect,it} from 'vitest';
import {fixture,book} from './helpers/reader-layout-physics.js';
import {rustShelf} from './helpers/rust-shelf-ready.js';
const READING=64|1;
for(const metal of [false,true])it(`preserves the exact physical layout across repeated reading cycles (${metal?'metal':'wood'})`,()=>{
 const f=fixture([book('read\ud800',100),book('neighbour',145),book('support',205,{kind:1,width:50,height:100})],metal);
 try{
  const before=f.step(600);expect(before.every(b=>!b.active)).toBe(true);
  expect(Math.abs(before[0].angle)).toBeGreaterThan(.3);
  for(let cycle=0;cycle<5;cycle++){
   f.rows[0].flags=READING;
   const away=f.step(180);expect(away).toEqual(before);
   const saved=f.snapshot();expect(typeof saved).toBe('string');expect(JSON.parse(saved)[2]).toHaveLength(3);
   f.rows[0].flags=0;expect(f.step(180)).toEqual(before);
  }
 }finally{f.free();}
});
it('recognizes an explicit reading reservation without changing drag or ordinary removal flags',()=>{
 expect(rustShelf.scene_class_flags('ihr-spine is-away is-reader-origin')).toBe(READING);
 expect(rustShelf.scene_class_flags('ihr-spine is-away')).toBe(1);
 expect(rustShelf.scene_class_flags('ihr-spine is-dragging')).toBe(2);
});
it('retains the current neighbour poses instead of rolling them back to an earlier full-scene snapshot',()=>{
 const f=fixture([book('read',95),book('changed',220),book('other',370)]);
 try{
  f.step(600);f.snapshot();
  f.rows[1].flags=2;f.step(90);f.rows[1].drag=35;f.rows[1].dragY=-15;f.step(90);
  f.rows[1].flags=0;f.rows[1].drag=f.rows[1].dragY=0;
  const moved=f.step(600);f.rows[0].flags=READING;expect(f.step(180)).toEqual(moved);
  f.rows[0].flags=0;expect(f.step(180)).toEqual(moved);
 }finally{f.free();}
});
