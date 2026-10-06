import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { withNativeCanvasResize } from '../../src/js/native-canvas-resize.js';
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
const restored = canvas => {
  expect(Object.hasOwn(canvas,'width')).toBe(false);
  expect(Object.hasOwn(canvas,'height')).toBe(false);
};
const resize = (r,w,h,ratio=2) => configureNativeRendererSize(r,w,h,ratio,new THREE.Vector2(),true,true,true);

describe('native book allocates only its final changed framebuffer', () => {
  it('keeps the exact final size, DPR and viewport with only one nonempty allocation', () => {
    const r=driver(); resize(r,256,320);
    expect(r.writes.map(w=>[w.axis,w.value])).toEqual([['height',0],['width',512],['height',640]]);
    expect(r.writes.filter(w=>w.dimensions.every(v=>v>0))).toHaveLength(1);
    expect([r.domElement.width,r.domElement.height]).toEqual([512,640]);
    expect(r.size.toArray()).toEqual([256,320]); expect(r.ratio).toBe(2);
    expect(r.viewport).toEqual([0,0,512,640]); restored(r.domElement);
  });
  it('preserves physical floor and rounded viewport when DPR changes', () => {
    const r=driver(); resize(r,393,321,1.5);
    expect(r.writes.filter(w=>w.dimensions.every(v=>v>0))).toHaveLength(1);
    expect([r.domElement.width,r.domElement.height]).toEqual([589,481]);
    expect(r.viewport).toEqual([0,0,590,482]); expect(r.ratio).toBe(1.5); restored(r.domElement);
  });
  it.each([[390,256,'height',512],[256,192,'width',512]])('does not stage a one-axis change %s×%s', (w,h,axis,value) => {
    const r=driver(); resize(r,w,h); expect(r.writes.map(w=>[w.axis,w.value])).toEqual([[axis,value]]);
    restored(r.domElement);
  });
  it('preserves the original partial resize when the operation throws before height', () => {
    const r=driver(), error=new Error('interrupted');
    expect(()=>withNativeCanvasResize(r,()=>{r.domElement.width=512;throw error;},
      {width:512,height:640},{avoidIntermediateAllocation:true})).toThrow(error);
    expect([r.domElement.width,r.domElement.height]).toEqual([512,384]); restored(r.domElement);
  });
  it('never leaves staging behind when an operation writes only width', () => {
    const r=driver();
    expect(withNativeCanvasResize(r,()=>{r.domElement.width=512;return 23;},
      {width:512,height:640},{avoidIntermediateAllocation:true})).toBe(23);
    expect([r.domElement.width,r.domElement.height]).toEqual([512,384]); restored(r.domElement);
  });
  it('keeps the original path for scissor rendering', () => {
    const r=driver();r.getScissorTest=()=>true;resize(r,256,320);
    expect(r.writes.map(w=>[w.axis,w.value])).toEqual([['width',512],['height',640]]);restored(r.domElement);
  });
  it('keeps the original write order when an operation sets height first', () => {
    const r=driver();withNativeCanvasResize(r,()=>{r.domElement.height=640;r.domElement.width=512;},
      {width:512,height:640},{avoidIntermediateAllocation:true});
    expect(r.writes.map(w=>[w.axis,w.value])).toEqual([['height',640],['width',512]]);restored(r.domElement);
  });
  it('falls back to the original allocation when staging is rejected', () => {
    const r=driver();
    const height=vi.spyOn(HTMLCanvasElement.prototype,'height','set');
    const write=height.getMockImplementation();
    height.mockImplementation(function(value) {
      if(this===r.domElement && value===0)throw new Error('Staging unavailable');
      return write.call(this,value);
    });
    resize(r,256,320);
    expect(r.writes.map(w=>[w.axis,w.value])).toEqual([['width',512],['height',640]]);
    expect([r.domElement.width,r.domElement.height]).toEqual([512,640]);restored(r.domElement);
  });
});
