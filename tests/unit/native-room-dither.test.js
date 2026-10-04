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

describe('raw retained pixels and original WebGL dither state',()=>{
  it('disables dither only for raw composition and restores the original enabled state',()=>{
    const renderer=driver();let enabled=true;const observed=[];
    const gl={DITHER:3024,isEnabled:vi.fn(()=>enabled),disable:vi.fn(()=>{enabled=false;}),enable:vi.fn(()=>{enabled=true;})};
    renderer.getContext=()=>gl;renderer.render=vi.fn(()=>observed.push(enabled));
    const cache=createNativeFramebufferCache(renderer),frame=cache.capture({},{width:390,height:844,ratio:2});
    expect(cache.repaint(frame)).toBe(true);expect(observed).toEqual([false]);expect(enabled).toBe(true);
    expect(gl.disable).toHaveBeenCalledWith(gl.DITHER);expect(gl.enable).toHaveBeenCalledWith(gl.DITHER);cache.dispose();
  });
  it('restores both initially enabled and disabled dither when the raw draw throws',()=>{
    for(const initial of [true,false]) {
      const renderer=driver();let enabled=initial;const observed=[];
      const gl={DITHER:3024,isEnabled:vi.fn(()=>enabled),disable:vi.fn(()=>{enabled=false;}),enable:vi.fn(()=>{enabled=true;})};
      renderer.getContext=()=>gl;renderer.render=vi.fn(()=>{observed.push(enabled);throw new Error('driver paint failed');});
      const cache=createNativeFramebufferCache(renderer),frame=cache.capture({},{width:390,height:844,ratio:2});
      expect(()=>cache.repaint(frame)).toThrow('driver paint failed');expect(observed).toEqual([false]);expect(enabled).toBe(initial);
      expect(renderer.autoClear).toBe(true);expect(renderer.shadowMap.enabled).toBe(true);
      if(initial)expect(gl.enable).toHaveBeenCalledWith(gl.DITHER);else expect(gl.enable).not.toHaveBeenCalled();cache.dispose();
    }
  });
});
