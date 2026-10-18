// @vitest-environment node
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {it,expect} from 'vitest';
import {trebleFraction} from './helpers/sound-spectrum.js';
import {rustShelf} from './helpers/rust-shelf-ready.js';
const bin=readFileSync('src/assets/sfx/atlas.bin'),index=JSON.parse(readFileSync('src/assets/sfx/atlas.json','utf8'));
it('ships the exact final CC0 atlas with 128 nonempty unclipped full-bandwidth 48 kHz recordings',()=>{
 expect(createHash('sha256').update(bin).digest('hex')).toBe('42a370f790af414ab48cd5e59b4066ae68797dde16a1b73419acccf5532f5437');
 expect(Object.keys(index)).toHaveLength(128);let end=0;
 for(const [name,c] of Object.entries(index)){
  expect(c.rate,name).toBe(48000);expect(c.offset,name).toBe(end);expect(c.length,name).toBeGreaterThan(1);
  expect((c.offset+c.length)*2,name).toBeLessThanOrEqual(bin.length);let peak=0;
  for(let i=c.offset;i<c.offset+c.length;i++)peak=Math.max(peak,Math.abs(bin.readInt16LE(i*2)));
  expect(peak,name).toBeGreaterThan(0);expect(peak,name).toBeLessThan(32767);end+=c.length;
 }
 expect(end*2).toBe(bin.length);expect(Object.keys(index).some(name=>/^(scrape|pot_move|lamp_move|book_slide)/.test(name))).toBe(false);expect(readFileSync('public/sfx/CREDITS.txt','utf8')).toContain('CC0');
});
it('routes real book, lamp, pot and material events into available recorded groups',()=>{
 const groups=new Set(Object.keys(index).map(name=>name.replace(/_t\d+$/,'')));
 for(const [kind,count] of [[0,1],[1,1],[3,6],[6,3],[7,3],[9,3],[10,3],[12,5],[13,5],[14,1],[16,1],[17,1],[19,1],[31,1],[32,1],[33,1],[34,1]])
  for(let material=0;material<count;material++)for(let level=0;level<3;level++)
   expect(rustShelf.cozy_clip(kind,material,level).split(',').some(name=>groups.has(name)),`${kind}/${material}/${level}`).toBe(true);
});


it('retains recorded treble above the old atlas cutoff rather than upsampling muffled PCM',()=>{
 for(const name of ['book_cover_open_t0','impact_metal_L1_t0','switch_light_on_t0'])
  expect(trebleFraction(bin,index[name]),name).toBeGreaterThan(.001);
});
