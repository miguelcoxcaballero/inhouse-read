import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { withNativeCanvasResize } from '../../src/js/native-canvas-resize.js';
import { configureNativeRendererSize } from '../../src/js/native-renderer-size.js';

afterEach(() => vi.restoreAllMocks());
function driver(width=780,height=384) {
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
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
    size:new THREE.Vector2(width/2,height/2), ratio:2,
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

describe('shrinking a native framebuffer avoids a zero-size reset', () => {
  it.each([[786,1688,589,1174],[780,1688,585,1174],[512,640,300,200]])('keeps exact physical dimensions from %s×%s to %s×%s', (w,h,nextW,nextH) => {
    const r=driver(w,h); resize(r,nextW/2,nextH/2);
    expect(r.writes.map(v=>[v.axis,v.value])).toEqual([['width',nextW],['height',nextH]]);
    expect(r.writes.every(v=>v.dimensions.every(n=>n>0))).toBe(true);
    expect(r.writes.every(v=>v.dimensions[0]*v.dimensions[1]<=w*h)).toBe(true);
    expect([r.domElement.width,r.domElement.height]).toEqual([nextW,nextH]);
    expect(r.viewport).toEqual([0,0,nextW,nextH]);restored(r.domElement);
  });
  it('preserves Three floor and rounded viewport while DPR shrinks', () => {
    const r=driver(786,1688);resize(r,393,783,1.5);
    expect(r.writes.map(v=>[v.axis,v.value])).toEqual([['width',589],['height',1174]]);
    expect(r.size.toArray()).toEqual([393,783]);expect(r.ratio).toBe(1.5);
    expect(r.viewport).toEqual([0,0,590,1175]);restored(r.domElement);
  });
  it('preserves the original partial dimensions and thrown error', () => {
    const r=driver(786,1688),error=new Error('interrupted shrink');
    expect(()=>withNativeCanvasResize(r,()=>{r.domElement.width=589;throw error;},
      {width:589,height:1174},{avoidIntermediateAllocation:true})).toThrow(error);
    expect(r.writes.map(v=>[v.axis,v.value])).toEqual([['width',589]]);
    expect([r.domElement.width,r.domElement.height]).toEqual([589,1688]);restored(r.domElement);
  });
  it('still stages growth and cross-axis changes', () => {
    for(const [w,h] of [[900,500],[600,500],[900,200]]) {
      const r=driver();resize(r,w/2,h/2);
      expect(r.writes.map(v=>[v.axis,v.value])).toEqual([['height',0],['width',w],['height',h]]);
      expect([r.domElement.width,r.domElement.height]).toEqual([w,h]);restored(r.domElement);
      vi.restoreAllMocks();
    }
  });
});
