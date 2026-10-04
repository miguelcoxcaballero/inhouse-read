import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { createNativeFramebufferCache } from '../../src/js/native-room-cache.js';

function driver() {
  const listeners=new Map();
  const renderer={domElement:{width:780,height:1688},ratio:2,size:new THREE.Vector2(390,844),autoClear:true,
    shadowMap:{enabled:true},target:null,scissor:new THREE.Vector4(1,2,3,4),scissorTest:true,clearColor:new THREE.Color('#123456'),clearAlpha:.7,
    getContext:()=>({}),copyFramebufferToTexture:vi.fn(),getRenderTarget(){return this.target;},setRenderTarget(value){this.target=value;},
    getPixelRatio(){return this.ratio;},setPixelRatio(value){this.ratio=value;},getSize(value){return value.copy(this.size);},
    setSize(width,height){this.size.set(width,height);this.domElement.width=width*this.ratio;this.domElement.height=height*this.ratio;},
    setViewport:vi.fn(),getScissor(value){return value.copy(this.scissor);},setScissor(value){this.scissor.copy(value);},
    getScissorTest(){return this.scissorTest;},setScissorTest(value){this.scissorTest=value;},
    getClearColor(value){return value.copy(this.clearColor);},getClearAlpha(){return this.clearAlpha;},
    setClearColor(value,alpha){this.clearColor.set(value);this.clearAlpha=alpha;},clear:vi.fn(),render:vi.fn(),compile:vi.fn()};
  renderer.domElement.addEventListener=(name,callback)=>listeners.set(name,callback);
  renderer.domElement.removeEventListener=(name,callback)=>{if(listeners.get(name)===callback)listeners.delete(name);};
  renderer.dispatch=name=>listeners.get(name)?.();renderer.listeners=listeners;
  return renderer;
}

describe('retained framebuffer lifetime and reference-aware pruning',()=>{
  it('invalidates a released frame without drawing or copying another frame',()=>{
    const renderer=driver(),cache=createNativeFramebufferCache(renderer),slot={};
    const frame=cache.capture(slot,{width:120,height:200,ratio:2});
    cache.releaseSlot(slot);renderer.copyFramebufferToTexture.mockClear();
    expect(cache.validFrame(frame)).toBe(false);expect(cache.repaint(frame)).toBe(false);
    expect(renderer.copyFramebufferToTexture).not.toHaveBeenCalled();expect(renderer.render).not.toHaveBeenCalled();
    cache.dispose();
  });
  it('invalidates a resized slot while keeping its new exact frame valid',()=>{
    const renderer=driver(),cache=createNativeFramebufferCache(renderer),slot={};
    const old=cache.capture(slot,{width:120,height:200,ratio:2});
    const current=cache.capture(slot,{width:160,height:200,ratio:2});
    expect(cache.validFrame(old)).toBe(false);expect(cache.validFrame(current)).toBe(true);
    cache.dispose();
  });
  it('protects current owner and lazy export texture identities, not equal dimensions',()=>{
    const renderer=driver(),cache=createNativeFramebufferCache(renderer),displaySlot={},exportSlot={},unusedSlot={},insertionSlot={};
    const descriptor={width:120,height:200,ratio:2};
    const display=cache.capture(displaySlot,descriptor),exportFrame=cache.capture(exportSlot,descriptor),
      unused=cache.capture(unusedSlot,descriptor),insertion=cache.capture(insertionSlot,descriptor);
    const release=vi.spyOn(unused.texture,'dispose');renderer.copyFramebufferToTexture.mockClear();
    expect(cache.releaseUnusedSlots([displaySlot,exportSlot,unusedSlot],[display,{...exportFrame}])).toBe(1);
    expect(release).toHaveBeenCalledOnce();expect(cache.validFrame(unused)).toBe(false);
    for(const frame of [display,exportFrame,insertion])expect(cache.validFrame(frame)).toBe(true);
    expect(renderer.copyFramebufferToTexture).not.toHaveBeenCalled();expect(renderer.render).not.toHaveBeenCalled();
    cache.dispose();
  });
  it('allows an abandoned frame to be recreated at the original dimensions after pruning',()=>{
    const renderer=driver(),cache=createNativeFramebufferCache(renderer),slot={};
    const descriptor={width:120,height:200,ratio:2},old=cache.capture(slot,descriptor);
    expect(cache.releaseUnusedSlots([slot],[null])).toBe(1);
    const restored=cache.capture(slot,descriptor);
    expect(restored.texture).not.toBe(old.texture);expect(cache.validFrame(restored)).toBe(true);
    expect(restored).toMatchObject({pixelWidth:240,pixelHeight:400,ratio:2});
    cache.dispose();
  });
});
