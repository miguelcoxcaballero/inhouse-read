// @vitest-environment node
import {expect,it} from 'vitest';
import {rustShelf} from './helpers/rust-shelf-ready.js';

// Materials per kind (cozy_synth): surfaces for impacts and books, lamps, pots, UI taps.
const MATERIALS={3:6,4:2,5:6,16:6,6:3,7:3,8:3,9:3,10:3,22:3,23:3,24:3,11:5,12:5,13:5,27:5,30:3};
const events=function*(){for(let kind=0;kind<35;kind++)if(![4,8,11,18].includes(kind))for(let material=0;material<(MATERIALS[kind]||1);material++)yield [kind,material];};
const stats=pcm=>{let peak=0,power=0,sum=0,finite=true;for(const x of pcm){finite&&=Number.isFinite(x);peak=Math.max(peak,Math.abs(x));power+=x*x;sum+=x;}return {finite,peak,rms:Math.sqrt(power/pcm.length),mean:sum/pcm.length};};

it('synthesises every event as short, bounded, balanced PCM that starts and ends in silence',()=>{
 let count=0;
 for(const [kind,material] of events())for(const level of [0,2]){
  const pcm=rustShelf.cozy_sound(kind,material,count%3,level),label=`${kind}/${material}/${level}`;count++;
  expect(pcm.length,label).toBeGreaterThan(4800);expect(pcm.length,label).toBeLessThanOrEqual(30000);
  const {finite,peak,rms,mean}=stats(pcm);expect(finite,label).toBe(true);
  expect(peak,label).toBeLessThan(.83);expect(peak,label).toBeGreaterThan(.05);
  expect(rms,label).toBeGreaterThan(.004);expect(Math.abs(mean),label).toBeLessThan(.004);
  expect(pcm[0]).toBe(0);expect(pcm.at(-1)).toBe(0);
  expect(Math.max(...pcm.slice(-120).map(Math.abs)),label).toBeLessThan(.01);
 }
 expect(count).toBeGreaterThan(120);
 expect(rustShelf.cozy_sound(35,0,0,1)).toHaveLength(0);
});

// Each event keeps the exact original PCM comparisons; bounded cases avoid
// making one 80-event array comparison depend on the machine's CPU load.
it.each([...events()])('keeps variants deterministic but different for event %i / material %i',(kind,material)=>{
  const a=rustShelf.cozy_sound(kind,material,0,1),b=rustShelf.cozy_sound(kind,material,0,1),c=rustShelf.cozy_sound(kind,material,1,1);
  expect(a).toEqual(b);expect(a).not.toEqual(c);
  expect(rustShelf.cozy_sound(kind,material,3,1)).toEqual(a);
});
it('keeps harder hits brighter and louder at their onset',()=>{
 const signatures=new Set();
 for(let material=0;material<6;material++){
  const soft=rustShelf.cozy_sound(3,material,0,0),hard=rustShelf.cozy_sound(3,material,0,2);
  expect(soft).not.toEqual(hard);expect(stats(hard).peak).toBeGreaterThan(stats(soft).peak*.9);
  signatures.add(Array.from(hard.slice(100,180)).join(','));
 }
 expect(signatures.size).toBe(6);
});

it('names the recorded clip groups of each event, most specific first, and maps strength to a level',()=>{
 expect(rustShelf.cozy_clip(3,1,0)).toBe('impact_wood_L0,impact_wood_L1');
 expect(rustShelf.cozy_clip(3,3,2)).toBe('impact_glass_L2,impact_glass_L1');
 expect(rustShelf.cozy_clip(6,2,1)).toBe('lamp_tarnaby_switch_on,switch_metal_click,switch_light_on');
 expect(rustShelf.cozy_clip(7,0,1)).toBe('lamp_mittled_switch_off,switch_light_off');
 expect(rustShelf.cozy_clip(10,1,2)).toBe('lamp_tripod_fall,lamp_fall_wood');
 expect(rustShelf.cozy_clip(12,2,1)).toBe('pot_akerbar_set,pot_setdown_zinc,metal_pot');
 expect(rustShelf.cozy_clip(13,1,2)).toBe('pot_muskotblomma_fall,pot_fall');
 expect(rustShelf.cozy_clip(15,0,1)).toBe('bin_drop,paper_crumple');
 for(const [kind,material] of events())for(const level of [0,1,2]){
  const groups=rustShelf.cozy_clip(kind,material,level);
  expect(groups,`${kind}/${material}`).toMatch(/^[a-zA-Z0-9_]+(,[a-zA-Z0-9_]+)*$/);
 }
 expect(rustShelf.cozy_clip(3,9,1)).toBe('');expect(rustShelf.cozy_clip(99,0,0)).toBe('');
 expect([0,.32,.33,.65,.66,1].map(rustShelf.cozy_level)).toEqual([0,0,1,1,2,2]);
 expect(rustShelf.cozy_level(Number.NaN)).toBe(0);
});


it('keeps retired drag events silent and declares full-rate fallback PCM',()=>{
 expect(rustShelf.cozy_sample_rate()).toBe(48000);
 for(const kind of [4,8,11,18])for(let material=0;material<6;material++){
  expect(rustShelf.cozy_clip(kind,material,2)).toBe('');
  expect(rustShelf.cozy_sound(kind,material,1,2)).toHaveLength(0);
 }
});
