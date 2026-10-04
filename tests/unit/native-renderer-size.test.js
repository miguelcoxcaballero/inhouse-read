import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { createNativeFramebufferCache } from '../../src/js/native-room-cache.js';

// Emulate the installed Three 0.180 sizing methods, including setPixelRatio's
// intermediate setSize, floor physical dimensions, viewport and XR guard.
function driver(width = 390, height = 784, ratio = 1.5, atomic = true) {
  const writes = [], calls = [], canvas = { style: { width:'unchanged', height:'unchanged' } };
  let physicalWidth = Math.floor(width * ratio), physicalHeight = Math.floor(height * ratio);
  for (const axis of ['width','height']) Object.defineProperty(canvas, axis, {
    get: () => axis === 'width' ? physicalWidth : physicalHeight,
    set(value) {
      writes.push({ axis, old:[physicalWidth,physicalHeight], value });
      if (axis === 'width') physicalWidth = value; else physicalHeight = value;
    }
  });
  const renderer = {
    domElement:canvas, size:new THREE.Vector2(width,height), ratio,
    viewport:[0,0,Math.round(width*ratio),Math.round(height*ratio)], xr:{isPresenting:false},
    writes,calls,autoClear:true,shadowMap:{enabled:true},target:null,
    scissor:new THREE.Vector4(1,2,3,4),scissorTest:true,clearColor:new THREE.Color('#123456'),clearAlpha:.7,
    getContext:()=>({}), copyFramebufferToTexture:vi.fn(),
    getRenderTarget(){return this.target;},setRenderTarget(value){this.target=value;},
    getPixelRatio(){return this.ratio;},getSize(target){return target.copy(this.size);},
    setPixelRatio(value) { calls.push(['ratio',value]);this.ratio=value;this.setSize(this.size.x,this.size.y,false); },
    setSize(w,h,updateStyle=true) {
      calls.push(['size',w,h,updateStyle]);
      if(this.xr.isPresenting)return;
      this.size.set(w,h);canvas.width=Math.floor(w*this.ratio);canvas.height=Math.floor(h*this.ratio);
      if(updateStyle) {canvas.style.width=`${w}px`;canvas.style.height=`${h}px`;}
      this.setViewport(0,0,w,h);
    },
    setDrawingBufferSize(w,h,r) {
      calls.push(['atomic',w,h,r]);this.size.set(w,h);this.ratio=r;
      canvas.width=Math.floor(w*r);canvas.height=Math.floor(h*r);this.setViewport(0,0,w,h);
    },
    setViewport(x,y,w,h){this.viewport=[x,y,w,h].map(value=>Math.round(value*this.ratio));},
    getScissor(target){return target.copy(this.scissor);},setScissor(value){this.scissor.copy(value);},
    getScissorTest(){return this.scissorTest;},setScissorTest(value){this.scissorTest=value;},
    getClearColor(target){return target.copy(this.clearColor);},getClearAlpha(){return this.clearAlpha;},
    setClearColor(value,alpha){this.clearColor.set(value);this.clearAlpha=alpha;},
    clear:vi.fn(),render:vi.fn(),compile:vi.fn()
  };
  if(!atomic)delete renderer.setDrawingBufferSize;
  return renderer;
}

const state = r => ({ratio:r.ratio,size:r.size.toArray(),physical:[r.domElement.width,r.domElement.height],
  viewport:r.viewport,style:{...r.domElement.style}});
function originalConfigure(renderer, descriptor) {
  if(renderer.getPixelRatio()!==descriptor.ratio)renderer.setPixelRatio(descriptor.ratio);
  const size=new THREE.Vector2();renderer.getSize(size);
  if(size.x!==descriptor.width || size.y!==descriptor.height)renderer.setSize(descriptor.width,descriptor.height,false);
  renderer.setRenderTarget(null);renderer.setViewport(0,0,descriptor.width,descriptor.height);
}
function retained(renderer) {
  const cache=createNativeFramebufferCache(renderer);
  const frame=cache.capture({}, {width:renderer.size.x,height:renderer.size.y,ratio:renderer.ratio,x:0,y:0});
  return {cache,frame};
}

describe('atomic native framebuffer sizing preserves resolved-frame contracts',()=>{
  it.each([
    {name:'room to full native insertion',initial:[390,784,1.5],target:{width:390,height:845,ratio:2}},
    {name:'full native insertion to room',initial:[390,845,2],target:{width:390,height:784,ratio:1.5}}
  ])('$name omits the intermediate old-size framebuffer but keeps the exact final output',({initial,target})=>{
    const renderer=driver(...initial),reference=driver(...initial),{cache,frame}=retained(renderer);
    originalConfigure(reference,target);
    expect(cache.compose(target,[{frame}])).toBe(true);
    expect(state(renderer)).toEqual(state(reference));
    expect(reference.writes).toHaveLength(4);
    expect(renderer.writes).toHaveLength(2);
    expect(renderer.calls).toEqual([['atomic',target.width,target.height,target.ratio]]);
    expect(renderer.render).toHaveBeenCalledOnce();
    expect(cache.validFrame(frame)).toBe(true);cache.dispose();
  });
  it('a same-ratio size change keeps the original single setSize and unchanged CSS',()=>{
    const renderer=driver(),reference=driver(),{cache,frame}=retained(renderer);
    const target={width:646,height:956,ratio:1.5};originalConfigure(reference,target);
    expect(cache.compose(target,[{frame}])).toBe(true);
    expect(state(renderer)).toEqual(state(reference));expect(renderer.calls).toEqual(reference.calls);
    expect(renderer.writes).toHaveLength(2);cache.dispose();
  });
  it('a ratio-only change keeps the original single setPixelRatio resize',()=>{
    const renderer=driver(),reference=driver(),{cache,frame}=retained(renderer);
    const target={width:390,height:784,ratio:2};originalConfigure(reference,target);
    expect(cache.compose(target,[{frame}])).toBe(true);
    expect(state(renderer)).toEqual(state(reference));expect(renderer.calls).toEqual(reference.calls);
    expect(renderer.writes).toHaveLength(2);cache.dispose();
  });
  it('an unchanged frame issues no canvas dimension assignments',()=>{
    const renderer=driver(),{cache,frame}=retained(renderer);
    expect(cache.repaint(frame)).toBe(true);expect(renderer.writes).toHaveLength(0);
    expect(renderer.calls).toEqual([]);cache.dispose();
  });
  it('older renderers retain the exact original ratio-size fallback ordering',()=>{
    const renderer=driver(390,784,1.5,false),reference=driver(390,784,1.5,false),{cache,frame}=retained(renderer);
    const target={width:390,height:845,ratio:2};originalConfigure(reference,target);
    expect(cache.compose(target,[{frame}])).toBe(true);
    expect(state(renderer)).toEqual(state(reference));expect(renderer.calls).toEqual(reference.calls);
    expect(renderer.writes).toEqual(reference.writes);expect(renderer.writes).toHaveLength(4);cache.dispose();
  });
  it('an XR presentation preserves setSize rejection instead of bypassing it through the atomic API',()=>{
    const renderer=driver(),reference=driver(),{cache,frame}=retained(renderer);
    renderer.xr.isPresenting=reference.xr.isPresenting=true;
    const target={width:390,height:845,ratio:2};originalConfigure(reference,target);
    expect(cache.compose(target,[{frame}])).toBe(true);
    expect(state(renderer)).toEqual(state(reference));expect(renderer.calls).toEqual(reference.calls);
    expect(renderer.writes).toEqual([]);cache.dispose();
  });
  it('pixel-aligned fractional logical dimensions preserve floor physical output and viewport',()=>{
    const renderer=driver(),reference=driver(),{cache,frame}=retained(renderer);
    const target={width:390.5,height:844.5,ratio:2};originalConfigure(reference,target);
    expect(cache.compose(target,[{frame}])).toBe(true);
    expect(state(renderer)).toEqual(state(reference));expect(state(renderer).physical).toEqual([781,1689]);
    expect(renderer.writes).toHaveLength(2);cache.dispose();
  });
  it('unsupported fractional physical bounds are rejected before any sizing method runs',()=>{
    const renderer=driver(),{cache,frame}=retained(renderer),before=state(renderer);
    expect(cache.compose({width:393,height:783,ratio:1.5},[{frame}])).toBe(false);
    expect(state(renderer)).toEqual(before);expect(renderer.writes).toEqual([]);expect(renderer.calls).toEqual([]);
    expect(renderer.render).not.toHaveBeenCalled();cache.dispose();
  });
  it('repainting an earlier retained frame restores its exact dimensions with no intermediate size or texture replacement',()=>{
    const renderer=driver(),{cache,frame}=retained(renderer),original=state(renderer),texture=frame.texture;
    expect(cache.compose({width:390,height:845,ratio:2},[{frame}])).toBe(true);
    renderer.writes.length=renderer.calls.length=0;
    expect(cache.repaint(frame)).toBe(true);expect(state(renderer)).toEqual(original);
    expect(frame.texture).toBe(texture);expect(cache.validFrame(frame)).toBe(true);
    expect(renderer.calls).toEqual([['atomic',390,784,1.5]]);expect(renderer.writes).toHaveLength(2);
    cache.dispose();
  });
});
