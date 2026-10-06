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


function warmingDriver() {
 const renderer=driver(), program={isReady:()=>true,getUniforms:vi.fn(()=>({}))};
 const props=new WeakMap(),flush=vi.fn();
 renderer.getContext=()=>({flush,isContextLost:()=>false});
 renderer.compile=vi.fn(scene=>scene.traverse(object=>{
  if(object.material)props.set(object.material,{programs:new Map([['raw',program]])});
 }));
 renderer.properties={get:material=>props.get(material)||{}};
 return {renderer,program,flush,cache:createNativeFramebufferCache(renderer)};
}
describe('idle native room uniform preparation',()=>{
 it('waits before linking and reflecting without allocating or drawing a framebuffer',async()=>{
  const f=warmingDriver();let release;
  const idle=vi.fn().mockImplementationOnce(()=>new Promise(resolve=>{release=resolve;})).mockResolvedValue();
  const task=f.cache.prepareUniforms({idle});
  expect(f.renderer.compile).not.toHaveBeenCalled();release();expect(await task).toBe(true);
  expect(f.renderer.compile).toHaveBeenCalledOnce();expect(f.flush).toHaveBeenCalledOnce();
  expect(f.program.getUniforms).toHaveBeenCalledOnce();expect(idle).toHaveBeenCalledTimes(2);
  expect(f.renderer.render).not.toHaveBeenCalled();expect(f.renderer.copyFramebufferToTexture).not.toHaveBeenCalled();
  expect(f.renderer.size.toArray()).toEqual([390,844]);expect(f.renderer.ratio).toBe(2);f.cache.dispose();
 });
 it('deduplicates reflection and preserves the compositor shader and uniforms',async()=>{
  const f=warmingDriver(),options={idle:async()=>{}};
  expect(await f.cache.prepareUniforms(options)).toBe(true);
  const material=f.renderer.compile.mock.calls[0][0].children[0].material;
  const shader=material.fragmentShader,uniforms=material.uniforms;
  expect(await f.cache.prepareUniforms(options)).toBe(true);
  expect(f.program.getUniforms).toHaveBeenCalledOnce();expect(f.renderer.compile).toHaveBeenCalledOnce();
  expect(material.fragmentShader).toBe(shader);expect(material.uniforms).toBe(uniforms);f.cache.dispose();
 });
 it('cancels before linking after disposal or owner cancellation',async()=>{
  for(const dispose of [true,false]){
   const f=warmingDriver();let release;
   const task=f.cache.prepareUniforms({idle:()=>new Promise(resolve=>{release=resolve;}),current:()=>dispose});
   if(dispose)f.cache.dispose();release();expect(await task).toBe(false);
   expect(f.renderer.compile).not.toHaveBeenCalled();expect(f.program.getUniforms).not.toHaveBeenCalled();f.cache.dispose();
  }
 });
 it('cancels reflection across a lost/restored generation and supports fresh preparation',async()=>{
  const f=warmingDriver();let slices=0;
  expect(await f.cache.prepareUniforms({idle:async()=>{
   if(++slices===2){f.renderer.dispatch('webglcontextlost');f.renderer.dispatch('webglcontextrestored');}
  }})).toBe(false);
  expect(f.program.getUniforms).not.toHaveBeenCalled();
  expect(await f.cache.prepareUniforms({idle:async()=>{}})).toBe(true);
  expect(f.program.getUniforms).toHaveBeenCalledOnce();expect(f.renderer.compile).toHaveBeenCalledTimes(2);f.cache.dispose();
 });
 it('does not query a lost context or prepare synchronously without an idle scheduler',async()=>{
  const f=warmingDriver();expect(await f.cache.prepareUniforms()).toBe(false);
  f.renderer.getContext=()=>({isContextLost:()=>true});
  expect(await f.cache.prepareUniforms({idle:async()=>{}})).toBe(false);
  expect(f.renderer.compile).not.toHaveBeenCalled();expect(f.program.getUniforms).not.toHaveBeenCalled();f.cache.dispose();
 });
 it('propagates driver errors so the caller can preserve the normal draw path',async()=>{
  const f=warmingDriver();f.program.getUniforms.mockImplementation(()=>{throw new Error('Reflection failed');});
  await expect(f.cache.prepareUniforms({idle:async()=>{}})).rejects.toThrow('Reflection failed');
  expect(f.renderer.render).not.toHaveBeenCalled();f.cache.dispose();
 });
});
