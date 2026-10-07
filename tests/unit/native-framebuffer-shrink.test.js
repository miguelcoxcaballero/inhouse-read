import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { withNativeCanvasResize } from '../../src/js/native-canvas-resize.js';
import { configureNativeRendererSize } from '../../src/js/native-renderer-size.js';
import { createNativeFramebufferCache } from '../../src/js/native-room-cache.js';

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


describe('bounded room framebuffer growth', () => {
  it.each([[589,1174,786,1688],[585,1176,780,1690],[512,640,900,1000]])('skips only the redundant empty reset from %s by %s to %s by %s', (w,h,nextW,nextH) => {
    const r=driver(w,h);
    configureNativeRendererSize(r,nextW/2,nextH/2,2,new THREE.Vector2(),true,true,'bounded');
    expect(r.writes.map(v=>[v.axis,v.value])).toEqual([['width',nextW],['height',nextH]]);
    expect(r.writes.every(v=>v.dimensions.every(n=>n>0))).toBe(true);
    expect(r.writes.every(v=>v.dimensions[0]*v.dimensions[1]<=nextW*nextH)).toBe(true);
    expect([r.domElement.width,r.domElement.height]).toEqual([nextW,nextH]);
    expect(r.viewport).toEqual([0,0,nextW,nextH]); restored(r.domElement);
  });
  it('keeps staging when one axis grows and the other shrinks', () => {
    const r=driver(780,1688);
    configureNativeRendererSize(r,450,300,2,new THREE.Vector2(),true,true,'bounded');
    expect(r.writes.map(v=>[v.axis,v.value])).toEqual([['height',0],['width',900],['height',600]]);
    expect(r.writes.every(v=>v.dimensions[0]*v.dimensions[1]<=780*1688)).toBe(true);
    restored(r.domElement);
  });
  it('preserves an interrupted growing operation and original accessors', () => {
    const r=driver(589,1174),error=new Error('interrupted room growth');
    expect(()=>withNativeCanvasResize(r,()=>{r.domElement.width=786;throw error;},
      {width:786,height:1688},{avoidIntermediateAllocation:'bounded'})).toThrow(error);
    expect(r.writes.map(v=>[v.axis,v.value])).toEqual([['width',786]]);
    expect([r.domElement.width,r.domElement.height]).toEqual([786,1174]); restored(r.domElement);
  });
});


describe('real framebuffer cache sizing transaction', () => {
 it.each([[393,844,783],[390,845,784]])('does not reset the unchanged room width at %s px', (width,oldHeight,height) => {
  const r=driver(Math.floor(width*1.5),Math.floor(oldHeight*1.5));
  r.size.set(width,oldHeight);r.ratio=1.5;
  r.domElement.addEventListener=vi.fn();r.domElement.removeEventListener=vi.fn();
  r.getContext=()=>({isContextLost:()=>false,drawingBufferWidth:r.domElement.width,drawingBufferHeight:r.domElement.height});
  r.copyFramebufferToTexture=vi.fn();r.setRenderTarget=vi.fn();r.setViewport=(...v)=>{r.viewport=v};
  r.shadowMap={enabled:true};r.getScissor=out=>out.set(0,0,width,oldHeight);r.setScissor=vi.fn();r.setScissorTest=vi.fn();
  r.getClearColor=out=>out.set(0);r.getClearAlpha=()=>0;r.setClearColor=vi.fn();r.clear=vi.fn();r.render=vi.fn();
  const cache=createNativeFramebufferCache(r);
  const frame=cache.capture({}, {x:0,y:0,width,height,ratio:1.5,physical:true,
    pixelWidth:Math.floor(width*1.5),pixelHeight:Math.floor(height*1.5)});
  expect(frame).not.toBeNull();expect(cache.repaint(frame)).toBe(true);
  expect(r.writes.map(v=>[v.axis,v.value])).toEqual([['height',Math.floor(height*1.5)]]);
  expect([r.domElement.width,r.domElement.height]).toEqual([Math.floor(width*1.5),Math.floor(height*1.5)]);
  expect(r.viewport).toEqual([0,0,Math.floor(width*1.5)/1.5,Math.floor(height*1.5)/1.5]);
  expect(r.render).toHaveBeenCalledOnce();restored(r.domElement);cache.dispose();
 });
});
