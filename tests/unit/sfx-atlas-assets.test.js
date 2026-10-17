// @vitest-environment node
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {it,expect} from 'vitest';
import {rustShelf} from './helpers/rust-shelf-ready.js';
const bin=readFileSync('public/sfx/atlas.bin'),index=JSON.parse(readFileSync('public/sfx/atlas.json','utf8'));
it('ships the exact final CC0 atlas with 146 nonempty unclipped 16 kHz recordings',()=>{
 expect(createHash('sha256').update(bin).digest('hex')).toBe('bc5d3f6f95dcff025da078078ea4860ed4d780977e8738761543e7a3a778697c');
 expect(Object.keys(index)).toHaveLength(146);let end=0;
 for(const [name,c] of Object.entries(index)){
  expect(c.rate,name).toBe(16000);expect(c.offset,name).toBe(end);expect(c.length,name).toBeGreaterThan(1);
  expect((c.offset+c.length)*2,name).toBeLessThanOrEqual(bin.length);let peak=0;
  for(let i=c.offset;i<c.offset+c.length;i++)peak=Math.max(peak,Math.abs(bin.readInt16LE(i*2)));
  expect(peak,name).toBeGreaterThan(0);expect(peak,name).toBeLessThan(32767);end+=c.length;
 }
 expect(end*2).toBe(bin.length);expect(readFileSync('public/sfx/CREDITS.txt','utf8')).toContain('CC0');
});
it('routes real book, lamp, pot and material events into available recorded groups',()=>{
 const groups=new Set(Object.keys(index).map(name=>name.replace(/_t\d+$/,'')));
 for(const [kind,count] of [[0,1],[1,1],[3,6],[6,3],[7,3],[8,3],[9,3],[10,3],[11,5],[12,5],[13,5],[14,1],[16,1],[17,1],[19,1],[31,1],[32,1],[33,1],[34,1]])
  for(let material=0;material<count;material++)for(let level=0;level<3;level++)
   expect(rustShelf.cozy_clip(kind,material,level).split(',').some(name=>groups.has(name)),`${kind}/${material}/${level}`).toBe(true);
});
