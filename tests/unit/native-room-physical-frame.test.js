import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { createNativeFramebufferCache } from '../../src/js/native-room-cache.js';

function driver() {
  const listeners=new Map();
  const renderer={domElement:{width:589,height:1174},ratio:1.5,size:new THREE.Vector2(393,783),autoClear:true,
    capabilities:{maxTextureSize:4096},shadowMap:{enabled:true},target:null,scissor:new THREE.Vector4(1,2,3,4),
    scissorTest:true,clearColor:new THREE.Color('#123456'),clearAlpha:.7,
    copyFramebufferToTexture:vi.fn(),getRenderTarget(){return this.target;},setRenderTarget(value){this.target=value;},
    getPixelRatio(){return this.ratio;},getSize(value){return value.copy(this.size);},
    setPixelRatio(value){this.ratio=value;this.setSize(this.size.x,this.size.y);},
    setSize(width,height){this.size.set(width,height);this.domElement.width=Math.floor(width*this.ratio);this.domElement.height=Math.floor(height*this.ratio);},
    setViewport:vi.fn(),getScissor(value){return value.copy(this.scissor);},setScissor(value){this.scissor.copy(value);},
    getScissorTest(){return this.scissorTest;},setScissorTest(value){this.scissorTest=value;},
    getClearColor(value){return value.copy(this.clearColor);},getClearAlpha(){return this.clearAlpha;},
    setClearColor(value,alpha){this.clearColor.set(value);this.clearAlpha=alpha;},clear:vi.fn(),render:vi.fn(),compile:vi.fn()};
  const gl={get drawingBufferWidth(){return renderer.domElement.width;},get drawingBufferHeight(){return renderer.domElement.height;},isContextLost:()=>false};
  renderer.getContext=()=>gl;
  renderer.domElement.addEventListener=(name,callback)=>listeners.set(name,callback);
  renderer.domElement.removeEventListener=(name,callback)=>{if(listeners.get(name)===callback)listeners.delete(name);};
  renderer.dispatch=name=>listeners.get(name)?.();renderer.listeners=listeners;
  return renderer;
}
const physical=()=>({width:393,height:783,ratio:1.5,x:.25,y:104.25,physical:true,pixelWidth:589,pixelHeight:1174});

describe('physical room framebuffer and logical CSS descriptors',()=>{
  it('copies the original floor buffer without rounding its CSS dimensions or origin',()=>{
    const renderer=driver(),cache=createNativeFramebufferCache(renderer),frame=cache.capture({},physical());
    expect(frame).toMatchObject(physical());expect(frame.texture.image).toMatchObject({width:589,height:1174});
    expect(renderer.copyFramebufferToTexture).toHaveBeenCalledOnce();
    expect(renderer.copyFramebufferToTexture.mock.calls[0][1].toArray()).toEqual([0,0]);
    expect(frame.texture.colorSpace).toBe(THREE.NoColorSpace);expect(frame.texture.flipY).toBe(false);
    expect(frame.texture.premultiplyAlpha).toBe(false);expect(frame.texture.minFilter).toBe(THREE.LinearFilter);
    cache.dispose();
  });
  it('rejects malformed physical fields, limits, source bounds and non-default targets before copying',()=>{
    const renderer=driver(),cache=createNativeFramebufferCache(renderer);
    for(const delta of [{pixelWidth:590},{pixelHeight:1175},{pixelWidth:589.5},{pixelWidth:0},{pixelHeight:NaN},
      {width:Infinity},{x:NaN},{physical:'true'},{sourceX:-1},{sourceX:.5},{sourceY:1}]) {
      expect(cache.capture({},{...physical(),...delta})).toBeNull();
    }
    renderer.capabilities.maxTextureSize=1024;expect(cache.capture({},physical())).toBeNull();
    renderer.capabilities.maxTextureSize=4096;renderer.target={};expect(cache.capture({},physical())).toBeNull();
    expect(renderer.copyFramebufferToTexture).not.toHaveBeenCalled();cache.dispose();
  });
  it('keeps the original aligned contract strict and leaves aligned frame objects unchanged',()=>{
    const renderer=driver(),cache=createNativeFramebufferCache(renderer);
    expect(cache.capture({},{width:393,height:783,ratio:1.5})).toBeNull();
    renderer.setPixelRatio(2);renderer.setSize(390,784);
    const frame=cache.capture({},{width:390,height:784,ratio:2,x:0,y:104});
    expect(frame.physical).toBeUndefined();expect(frame.pixelWidth).toBe(780);expect(frame.pixelHeight).toBe(1568);
    expect(cache.repaint(frame)).toBe(true);expect(renderer.setViewport).toHaveBeenLastCalledWith(0,0,390,784);cache.dispose();
  });
  it('replays one texture into its original physical viewport while shader coordinates remain logical',()=>{
    const renderer=driver(),cache=createNativeFramebufferCache(renderer),frame=cache.capture({},physical());
    expect(cache.repaint(frame)).toBe(true);
    expect(renderer.domElement).toMatchObject({width:589,height:1174});expect(renderer.ratio).toBe(1.5);
    expect(renderer.setViewport).toHaveBeenLastCalledWith(0,0,589/1.5,1174/1.5);
    const material=renderer.render.mock.calls[0][0].children[0].material;
    expect(material.uniforms.outputSize.value.toArray()).toEqual([393,783]);
    expect(material.uniforms.outputOrigin.value.toArray()).toEqual([.25,104.25]);
    expect(material.blending).toBe(THREE.NoBlending);expect(material.toneMapped).toBe(false);
    expect(material.fragmentShader).toContain('color = foreground0 + color * (1. - foreground0.a)');cache.dispose();
  });
  it('composes a retained physical room with an aligned insertion without changing alpha, clips or CSS bounds',()=>{
    const renderer=driver(),cache=createNativeFramebufferCache(renderer),room=cache.capture({},physical());
    renderer.setPixelRatio(2);renderer.setSize(393,844);
    const output={width:393,height:844,ratio:2,x:0,y:0},book=cache.capture({},output);
    expect(cache.compose(output,[{frame:room,x:.25,y:104.25,clip:{left:.25,top:104.25,right:393,bottom:844}},
      {frame:book,x:0,y:0}])).toBe(true);
    const uniforms=renderer.render.mock.calls[0][0].children[0].material.uniforms;
    expect(uniforms.rect0.value.toArray()).toEqual([.25,104.25,393,783]);
    expect(uniforms.rect1.value.toArray()).toEqual([0,0,393,844]);
    expect(uniforms.clip0.value.toArray()).toEqual([.25,104.25,393,844]);cache.dispose();
  });
  it('restores the original physical buffer after a foreign renderer changes size and ratio',()=>{
    const renderer=driver(),cache=createNativeFramebufferCache(renderer),frame=cache.capture({},physical());
    renderer.setPixelRatio(2);renderer.setSize(393,844);
    expect(cache.validFrame(frame)).toBe(true);expect(cache.repaint(frame)).toBe(true);
    expect(renderer.size.toArray()).toEqual([393,783]);expect(renderer.ratio).toBe(1.5);
    expect(renderer.domElement).toMatchObject({width:589,height:1174});cache.dispose();
  });
  it('invalidates physical textures on loss and restoration without reviving an obsolete frame',()=>{
    const renderer=driver(),onRestored=vi.fn(),cache=createNativeFramebufferCache(renderer,{onRestored});
    const frame=cache.capture({},physical()),released=vi.spyOn(frame.texture,'dispose');
    renderer.dispatch('webglcontextlost');expect(cache.validFrame(frame)).toBe(false);expect(released).toHaveBeenCalledOnce();
    renderer.dispatch('webglcontextrestored');expect(onRestored).toHaveBeenCalledOnce();expect(cache.repaint(frame)).toBe(false);
    const next=cache.capture({},physical());expect(next.generation).not.toBe(frame.generation);
    expect(cache.validFrame(next)).toBe(true);cache.dispose();expect(renderer.listeners.size).toBe(0);
  });
  it('rejects unsupported, lost or mismatched actual drawing buffers without claiming physical pixels',()=>{
    const renderer=driver(),cache=createNativeFramebufferCache(renderer);
    for(const gl of [{},{drawingBufferWidth:0,drawingBufferHeight:1174},
      {drawingBufferWidth:590,drawingBufferHeight:1174},{drawingBufferWidth:589,drawingBufferHeight:1174,isContextLost:()=>true}]) {
      renderer.getContext=()=>gl;expect(cache.capture({},physical())).toBeNull();
    }
    renderer.getContext=()=>{throw new Error('unavailable');};expect(cache.capture({},physical())).toBeNull();
    expect(renderer.copyFramebufferToTexture).not.toHaveBeenCalled();cache.dispose();
  });
});
