// @vitest-environment node
import {expect,it} from 'vitest';
import {fixture,book} from './helpers/reader-layout-physics.js';
const release=(f,x)=>{Object.assign(f.rows[0],{flags:0,drag:0,x});return f.step(600)[0];};
it('leaves a stationary book upright and asleep when placed carefully',()=>{
 for(const metal of [false,true]){
  const f=fixture([book('hand',300,{flags:2,width:18})],metal);f.step(90);
  const final=release(f,300);expect(Math.abs(final.angle)).toBeLessThan(.015);expect(Math.abs(final.x-300)).toBeLessThan(.5);
  expect(final.active).toBe(0);expect(f.step(60)[0]).toEqual(final);f.free();
 }
});
it('stopping the finger cancels earlier sideways travel for every grip height',()=>{
 for(const direction of [-1,1])for(const grip of [-.4,0,.4]){
  const f=fixture([book('hand',300,{flags:2,width:18,grip})]);f.step(90);
  for(let frame=1;frame<=30;frame++){f.rows[0].drag=direction*frame;f.step();}
  const placed=f.step(30)[0],final=release(f,300+direction*30);
  expect(Math.abs(final.angle)).toBeLessThan(.015);expect(Math.abs(final.x-placed.x)).toBeLessThan(.5);expect(final.active).toBe(0);f.free();
 }
});
it('very slow placement and small finger tremor do not start a powered fall',()=>{
 for(const jitter of [false,true]){
  const f=fixture([book('hand',300,{flags:2,width:18})]);f.step(90);
  for(let frame=1;frame<=60;frame++){f.rows[0].drag=jitter?(frame%2?.3:-.3):frame*.04;f.step();}
  const x=300+f.rows[0].drag,final=release(f,x);
  expect(Math.abs(final.angle)).toBeLessThan(.015);expect(final.active).toBe(0);f.free();
 }
});
it('a slight three-millimetre release gesture tips to its own side on wood and metal',()=>{
 for(const metal of [false,true])for(const direction of [-1,1])for(const frameMs of [1000/30,1000/60,1000/120]){
  const f=fixture([book('hand',300,{flags:2,width:18})],metal);f.step(90);
  for(let frame=1;frame<=6;frame++){f.rows[0].drag=direction*frame*.5;f.step(1,false,frameMs);}
  const final=release(f,300+direction*3);expect(final.angle*direction).toBeLessThan(-.7);expect(final.active).toBe(0);f.free();
 }
});
it('a small deliberate reversal chooses the new side rather than the earlier travel',()=>{
 for(const direction of [-1,1]){
  const f=fixture([book('hand',300,{flags:2,width:18})]);f.step(90);
  for(let frame=1;frame<=20;frame++){f.rows[0].drag=-direction*frame;f.step();}
  for(let frame=1;frame<=6;frame++){f.rows[0].drag=-direction*20+direction*frame*.5;f.step();}
  const final=release(f,300-direction*17);expect(final.angle*direction).toBeLessThan(-.7);expect(final.active).toBe(0);f.free();
 }
});
it('a pause measured in wall time cancels release intent even without intervening frames',()=>{
 const f=fixture([book('hand',300,{flags:2,width:18})]);f.step(90);
 for(let frame=1;frame<=30;frame++){f.rows[0].drag=frame;f.step();}
 f.step(1,false,500);const final=release(f,330);expect(Math.abs(final.angle)).toBeLessThan(.015);expect(final.active).toBe(0);f.free();
});


it('uses pointer event timing rather than a delayed renderer to decide the release',()=>{
 for(const pause of [10,500]){
  const f=fixture([book('hand',300,{flags:2,width:18})]);f.step(90);
  f.pointer('hand',0,1000,0);f.pointer('hand',3,1100,1);f.pointer('hand',3,1100+pause,2);
  f.step(1,false,500);const final=release(f,300);
  if(pause===10)expect(final.angle).toBeLessThan(-.7);else expect(Math.abs(final.angle)).toBeLessThan(.015);
  expect(final.active).toBe(0);f.free();
 }
});
it('cancelling a pointer gesture does not inject a sideways fall',()=>{
 const f=fixture([book('hand',300,{flags:2,width:18})]);f.step(90);
 f.pointer('hand',0,1000,0);f.pointer('hand',4,1050,1);f.pointer('hand',4,1060,3);
 expect(Math.abs(release(f,300).angle)).toBeLessThan(.015);f.free();
});


it('keeps exact UTF-16 book identities in the pointer bridge',()=>{
 const id='hand:á:📖:\ud800',f=fixture([book(id,300,{flags:2,width:18})]);f.step(90);
 f.pointer(id,0,1000,0);f.pointer(id,3,1100,1);f.pointer(id,3,1110,2);
 expect(release(f,300).angle).toBeLessThan(-.7);f.free();
});
