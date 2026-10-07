import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { configureShelfRendererSize } from '../../src/js/shelf-renderer-size.js';
import { configureNativeRendererSize } from '../../src/js/native-renderer-size.js';

afterEach(() => vi.restoreAllMocks());
function driver() {
  const canvas = document.createElement('canvas');
  canvas.width = 780; canvas.height = 384;
  const writes = [];
  for (const axis of ['width', 'height']) {
    const setter = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, axis).set;
    vi.spyOn(HTMLCanvasElement.prototype, axis, 'set').mockImplementation(function(value) {
      setter.call(this, value);
      if (this === canvas) writes.push({ axis, value, dimensions:[canvas.width, canvas.height] });
    });
  }
  return { domElement:canvas, writes, isWebGLRenderer:true, autoClear:true,
    autoClearColor:true, autoClearDepth:true, autoClearStencil:true,
    xr:{ isPresenting:false }, getRenderTarget:() => null, getScissorTest:() => false,
    size:new THREE.Vector2(390,192), ratio:2,
    getSize(target) { return target.copy(this.size); }, getPixelRatio() { return this.ratio; },
    setSize(width,height) {
      this.size.set(width,height);
      canvas.width = Math.floor(width*this.ratio); canvas.height = Math.floor(height*this.ratio);
      this.viewport = [0,0,Math.round(width*this.ratio),Math.round(height*this.ratio)];
    },
    setPixelRatio(ratio) { this.ratio = ratio; this.setSize(this.size.x,this.size.y); },
    setDrawingBufferSize(width,height,ratio) { this.ratio = ratio; this.setSize(width,height); }
  };
}
const state = r => ({physical:[r.domElement.width,r.domElement.height],size:r.size.toArray(),ratio:r.ratio,viewport:r.viewport,style:{...r.domElement.style}});
const finalAllocations = r => r.writes.filter(w=>w.dimensions.every(v=>v>0)).length;
describe('shared shelf framebuffer sizing', () => {
 it('matches the copied shelf path exactly while avoiding three full intermediate allocations', () => {
  const old=driver();configureNativeRendererSize(old,393,783,1.5,new THREE.Vector2(),false);
  const expected=state(old);expect(finalAllocations(old)).toBe(4);vi.restoreAllMocks();
  const current=driver();configureShelfRendererSize(current,393,783,1.5,new THREE.Vector2());
  expect(state(current)).toEqual(expected);expect(finalAllocations(current)).toBe(1);
  expect(Object.hasOwn(current.domElement,'width')).toBe(false);expect(Object.hasOwn(current.domElement,'height')).toBe(false);
 });
 it('keeps the original fractional physical floor and rounded viewport on insertion', () => {
  const r=driver();configureShelfRendererSize(r,393,844,1.5,new THREE.Vector2());
  expect([r.domElement.width,r.domElement.height]).toEqual([589,1266]);
  expect(r.viewport).toEqual([0,0,590,1266]);expect(finalAllocations(r)).toBe(1);
 });
 it('does not reset the framebuffer for an unchanged shelf frame', () => {
  const r=driver();configureShelfRendererSize(r,390,192,2,new THREE.Vector2());expect(r.writes).toHaveLength(0);
 });
 it('keeps XR size guards and the original DPR update', () => {
  const old=driver();old.xr.isPresenting=true;old.setSize=()=>{};
  configureNativeRendererSize(old,393,783,1.5,new THREE.Vector2(),false);const expected=state(old);vi.restoreAllMocks();
  const r=driver();r.xr.isPresenting=true;r.setSize=()=>{};configureShelfRendererSize(r,393,783,1.5,new THREE.Vector2());
  expect(state(r)).toEqual(expected);expect(r.writes).toHaveLength(0);
 });
 it('retains the full final allocation when scissor rejects zero-height staging', () => {
  const r=driver();r.getScissorTest=()=>true;configureShelfRendererSize(r,393,783,1.5,new THREE.Vector2());
  expect([r.domElement.width,r.domElement.height]).toEqual([589,1174]);expect(finalAllocations(r)).toBe(2);
 });
});


describe('room to insertion bounded allocation', () => {
 it.each([[393,783,1.5,393,844,2],[390,784,1.5,390,845,2]])('keeps physical floors and original projection at %s by %s', (w,h,ratio,nextW,nextH,nextRatio) => {
  const r=driver();r.setDrawingBufferSize(w,h,ratio);r.writes.length=0;
  configureShelfRendererSize(r,nextW,nextH,nextRatio,new THREE.Vector2());
  const final=[Math.floor(nextW*nextRatio),Math.floor(nextH*nextRatio)];
  expect(r.writes.map(v=>[v.axis,v.value])).toEqual([['width',final[0]],['height',final[1]]]);
  expect(r.writes.every(v=>v.dimensions.every(n=>n>0))).toBe(true);
  expect(r.writes.every(v=>v.dimensions[0]*v.dimensions[1]<=final[0]*final[1])).toBe(true);
  expect(state(r)).toMatchObject({physical:final,size:[nextW,nextH],ratio:nextRatio,viewport:[0,0,...final]});
  expect(Object.hasOwn(r.domElement,'width')).toBe(false);expect(Object.hasOwn(r.domElement,'height')).toBe(false);
 });
});
