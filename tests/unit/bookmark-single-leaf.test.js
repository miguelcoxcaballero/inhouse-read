// @vitest-environment node
import {expect,it} from 'vitest';
import {rustCore} from './helpers/rust-core-ready.js';
import {rustBookmarkBuffers,releaseRustBookmarkBuffers} from '../../src/js/bookmark-wasm.js';
const distance=(p,a,b)=>Math.hypot(...[0,1,2].map(k=>p[a+k]-p[b+k]));
it('widens the silk by forty percent while preserving its fabric thickness',()=>{
 for(const thickness of [6,12,40,80])for(const progress of [0,.4,1]){
  const old=rustBookmarkBuffers(rustCore,132,200,thickness,progress,10,0,0,32,12345,true).positions.slice();
  const next=rustBookmarkBuffers(rustCore,132,200,thickness,progress,10,0,0,32,12345).positions;
  for(let i=0;i<next.length;i+=12){
   expect(distance(next,i,i+3)/distance(old,i,i+3)).toBeCloseTo(1.4,4);
   expect(distance(next,i,i+6)).toBeCloseTo(distance(old,i,i+6),4);
  }
 }
});
it('keeps inserted fabric at exactly one reading depth and only turns outside the head',()=>{
 for(const progress of [0,.2,.5,.8,1])for(const seed of [1,27,12345]){
  const p=rustBookmarkBuffers(rustCore,132,200,40,progress,16,0,0,32,seed).positions;
  const inserted=[];for(let i=0;i<p.length;i+=3)if(p[i+1]<99.5)inserted.push(p[i+2]);
  expect(inserted.length).toBeGreaterThan(24);
  expect(Math.max(...inserted)-Math.min(...inserted)).toBeLessThan(.365);
  expect([...p].every(Number.isFinite)).toBe(true);
 }
 releaseRustBookmarkBuffers(rustCore);
});
