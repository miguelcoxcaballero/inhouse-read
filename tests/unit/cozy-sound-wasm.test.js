// @vitest-environment node
import {expect,it} from 'vitest';
import {rustShelf} from './helpers/rust-shelf-ready.js';

it('generates bounded, faded PCM for each interaction, material and variation',()=>{
 for(let kind=0;kind<4;kind++)for(let material=0;material<6;material++)for(let variant=0;variant<3;variant++){
  const pcm=rustShelf.cozy_sound(kind,material,variant);
  expect(pcm.length).toBe([4320,12000,3840,10800][kind]);
  let peak=0,power=0,finite=true;for(const x of pcm){finite&&=Number.isFinite(x);peak=Math.max(peak,Math.abs(x));power+=x*x;}expect(finite).toBe(true);
  expect(peak).toBeLessThan(.65);expect(Math.sqrt(power/pcm.length)).toBeGreaterThan(.002);
  expect(pcm[0]).toBe(0);expect(pcm.at(-1)).toBe(0);
  expect(Math.max(...pcm.slice(-120).map(Math.abs))).toBeLessThan(.012);
 }
 expect(rustShelf.cozy_sound(4,0,0)).toHaveLength(0);
 expect(rustShelf.cozy_sound(0,6,0)).toHaveLength(0);
});

it('keeps cached variants deterministic while giving materials distinct resonances',()=>{
 const signatures=[];
 for(let material=0;material<6;material++){
  const a=rustShelf.cozy_sound(3,material,0),b=rustShelf.cozy_sound(3,material,0),c=rustShelf.cozy_sound(3,material,1);
  expect(a).toEqual(b);expect(a).not.toEqual(c);
  signatures.push(Array.from(a.slice(100,180)).join(','));
 }
 expect(new Set(signatures).size).toBe(6);
});
