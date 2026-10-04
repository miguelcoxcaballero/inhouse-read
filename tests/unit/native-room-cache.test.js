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

describe('GPU retained resolved framebuffer cache',()=>{
  it('copies the exact physical intersection without a CPU pixel API',()=>{
    const renderer=driver(),cache=createNativeFramebufferCache(renderer),frame=cache.capture({},
      {x:10,y:20,width:120,height:200,ratio:2,sourceX:20,sourceY:1248});
    expect(frame).toMatchObject({x:10,y:20,width:120,height:200,pixelWidth:240,pixelHeight:400,ratio:2});
    expect(renderer.copyFramebufferToTexture).toHaveBeenCalledOnce();
    expect(renderer.copyFramebufferToTexture.mock.calls[0][1].toArray()).toEqual([20,1248]);
    expect(frame.texture.colorSpace).toBe(THREE.NoColorSpace);
    expect(frame.texture.premultiplyAlpha).toBe(false);expect(frame.texture.flipY).toBe(false);
    cache.dispose();
  });
  it('rejects fractional physical pixels, non-default targets and out of bounds before copying',()=>{
    const renderer=driver(),cache=createNativeFramebufferCache(renderer);
    for(const descriptor of [{width:10.1,height:20,ratio:2},{width:10,height:20,ratio:2,x:NaN},
      {width:10,height:20,ratio:2,sourceX:-1},{width:500,height:20,ratio:2}])expect(cache.capture({},descriptor)).toBeNull();
    renderer.target={};expect(cache.capture({},{width:10,height:20,ratio:2})).toBeNull();
    expect(renderer.copyFramebufferToTexture).not.toHaveBeenCalled();cache.dispose();
  });
  it('keeps transaction slots independent and releases only the requested retained frame',()=>{
    const renderer=driver(),cache=createNativeFramebufferCache(renderer),first={},second={};
    const a=cache.capture(first,{width:120,height:200,ratio:2}),b=cache.capture(second,{width:120,height:200,ratio:2});
    expect(a.texture).not.toBe(b.texture);
    expect(cache.capture(first,{width:120,height:200,ratio:2}).texture).toBe(a.texture);
    const releaseA=vi.spyOn(a.texture,'dispose'),releaseB=vi.spyOn(b.texture,'dispose');
    cache.releaseSlot(first);expect(releaseA).toHaveBeenCalledOnce();expect(releaseB).not.toHaveBeenCalled();
    cache.dispose();expect(releaseB).toHaveBeenCalledOnce();
  });
  it('uses one raw premultiplied composition pass and restores the existing renderer state',()=>{
    const renderer=driver(),cache=createNativeFramebufferCache(renderer),frame=cache.capture({},
      {x:0,y:0,width:390,height:844,ratio:2});
    const clear=renderer.clearColor.clone(),scissor=renderer.scissor.clone();
    expect(cache.compose(frame,[{frame,x:0,y:0,scale:1,clip:{left:0,top:0,right:390,bottom:844}}])).toBe(true);
    expect(renderer.render).toHaveBeenCalledOnce();const material=renderer.render.mock.calls[0][0].children[0].material;
    expect(material).toBeInstanceOf(THREE.RawShaderMaterial);expect(material.blending).toBe(THREE.NoBlending);
    expect(material.toneMapped).toBe(false);expect(material.premultipliedAlpha).toBe(false);
    expect(material.fragmentShader).toContain('color = foreground0 + color * (1. - foreground0.a)');
    expect(material.fragmentShader).not.toContain('colorspace_fragment');expect(material.fragmentShader).not.toContain('tonemapping_fragment');
    expect(renderer.autoClear).toBe(true);expect(renderer.shadowMap.enabled).toBe(true);
    expect(renderer.scissor.equals(scissor)).toBe(true);expect(renderer.scissorTest).toBe(true);
    expect(renderer.clearColor.equals(clear)).toBe(true);expect(renderer.clearAlpha).toBe(.7);
    cache.dispose();
  });
  it('rejects non-finite layer placement before resizing or drawing',()=>{
    const renderer=driver(),cache=createNativeFramebufferCache(renderer),frame=cache.capture({},
      {x:0,y:0,width:390,height:844,ratio:2});
    for(const layer of [{frame,x:Infinity,y:0},{frame,x:0,y:0,scale:Infinity},
      {frame,x:0,y:0,clip:{left:0,top:0,right:NaN,bottom:844}}])expect(cache.compose(frame,[layer])).toBe(false);
    expect(renderer.render).not.toHaveBeenCalled();expect(renderer.setViewport).not.toHaveBeenCalled();cache.dispose();
  });
  it('rejects a lost WebGL context before claiming a native capture or presentation',()=>{
    const renderer=driver(),cache=createNativeFramebufferCache(renderer);
    const frame=cache.capture({},{x:0,y:0,width:390,height:844,ratio:2});
    renderer.getContext=()=>({isContextLost:()=>true});renderer.copyFramebufferToTexture.mockClear();
    expect(cache.capture({},{width:10,height:20,ratio:2})).toBeNull();
    expect(cache.repaint(frame)).toBe(false);
    expect(renderer.copyFramebufferToTexture).not.toHaveBeenCalled();expect(renderer.render).not.toHaveBeenCalled();cache.dispose();
  });
  it('invalidates source-less textures across lost/restored generations and requests an original redraw',()=>{
    const renderer=driver(),onRestored=vi.fn(),cache=createNativeFramebufferCache(renderer,{onRestored});
    const first=cache.capture({},{x:0,y:0,width:390,height:844,ratio:2}),released=vi.spyOn(first.texture,'dispose');
    renderer.dispatch('webglcontextlost');expect(cache.validFrame(first)).toBe(false);expect(released).toHaveBeenCalledOnce();
    renderer.dispatch('webglcontextrestored');expect(onRestored).toHaveBeenCalledOnce();
    expect(cache.repaint(first)).toBe(false);expect(cache.compose({width:390,height:844,ratio:2},[{frame:first,x:0,y:0}])).toBe(false);
    const fresh=cache.capture({},{x:0,y:0,width:390,height:844,ratio:2});
    expect(fresh.generation).not.toBe(first.generation);expect(cache.validFrame(fresh)).toBe(true);
    cache.dispose();expect(renderer.listeners.size).toBe(0);
  });
});
