import * as THREE from 'three';
import { configureNativeRendererSize } from './native-renderer-size.js';
import { prepareProgramUniforms } from './gpu-programs.js';
import { createNativeFramePolicy } from './native-frame-policy.js';
import { needRustShelf } from './rust-shelf.js';

const MAX_LAYERS = 3;

// These textures retain the already resolved default framebuffer, including
// its original antialiasing, tone-mapped sRGB bytes and premultiplied alpha.
// No scene is rendered into a differently sampled render target. Capturing
// issues copyTexSubImage2D through Three; it never reads pixels into JavaScript.
export function createNativeFramebufferCache(renderer,{onRestored}={}) {
  if (typeof renderer?.getContext !== 'function' || typeof renderer.copyFramebufferToTexture !== 'function') return null;
  const slots = new Map(), liveTextures = new Set(), size = new THREE.Vector2(), copyOrigin = new THREE.Vector2();
  const scissor = new THREE.Vector4(), clearColor = new THREE.Color();
  const transparent = new THREE.DataTexture(new Uint8Array(4), 1, 1);
  transparent.colorSpace = THREE.NoColorSpace; transparent.needsUpdate = true;
  const uniforms = { outputSize:{value:new THREE.Vector2()}, outputOrigin:{value:new THREE.Vector2()} };
  for (let i=0; i<MAX_LAYERS; i++) {
    uniforms[`layer${i}`] = {value:transparent};
    uniforms[`rect${i}`] = {value:new THREE.Vector4()};
    uniforms[`clip${i}`] = {value:new THREE.Vector4()};
    uniforms[`enabled${i}`] = {value:0};
  }
  // The raw replay program's sources are rust-ui/src/native_room_shaders.rs (shelf module, which the
  // scene that owns this cache already uses).
  const [vertexShader, fragmentShader] = needRustShelf().native_room_shaders(MAX_LAYERS);
  const material = new THREE.RawShaderMaterial({
    uniforms, depthTest:false, depthWrite:false, blending:THREE.NoBlending,
    transparent:false, toneMapped:false, premultipliedAlpha:false,
    vertexShader, fragmentShader
  });
  const geometry = new THREE.PlaneGeometry(2,2), mesh = new THREE.Mesh(geometry,material);
  mesh.frustumCulled = false;
  const scene = new THREE.Scene(), camera = new THREE.Camera(); scene.add(mesh);
  const policy = createNativeFramePolicy();
  let disposed = false,prepared=false,generation=0;
  function invalidateFrames() {
    generation++;prepared=false;
    for(const texture of slots.values())texture.dispose();slots.clear();liveTextures.clear();
  }
  const contextLost=()=>invalidateFrames();
  const contextRestored=()=>{invalidateFrames();onRestored?.();};
  renderer.domElement.addEventListener?.('webglcontextlost',contextLost);
  renderer.domElement.addEventListener?.('webglcontextrestored',contextRestored);

  function readyContext() {
    try { const context=renderer.getContext(); return context && !context.isContextLost?.() ? context : null; }
    catch { return null; }
  }
  const contextReady = () => Boolean(readyContext());

  function ownedDescriptor(frame) {
    return !disposed && frame && (frame.generation === undefined || frame.generation === generation);
  }
  function exactFrame(frame) {
    const context = readyContext();
    return Boolean(ownedDescriptor(frame) && context && policy.exact(frame, context, renderer.capabilities?.maxTextureSize));
  }
  function validFrame(frame) { return liveTextures.has(frame?.texture) && frame.generation===generation && exactFrame(frame); }

  function capture(slot, descriptor) {
    const context = readyContext();
    if (!ownedDescriptor(descriptor) || !context || renderer.getRenderTarget?.()) return null;
    const dimensions = policy.capture(descriptor, context, renderer.capabilities?.maxTextureSize, renderer.domElement);
    if (!dimensions) return null;
    const {width,height,ratio,x=0,y=0,sourceX=0,sourceY=0} = descriptor;
    const physical=descriptor.physical===true, pixelWidth=dimensions[0], pixelHeight=dimensions[1];
    let texture=slots.get(slot);
    if (!texture || texture.image.width!==pixelWidth || texture.image.height!==pixelHeight) {
      if(texture) { texture.dispose();liveTextures.delete(texture); }
      texture=new THREE.FramebufferTexture(pixelWidth,pixelHeight);
      texture.colorSpace=THREE.NoColorSpace;
      texture.flipY=false; texture.premultiplyAlpha=false;
      texture.minFilter=texture.magFilter=THREE.LinearFilter;
      slots.set(slot,texture);liveTextures.add(texture);
    }
    copyOrigin.set(sourceX,sourceY);
    renderer.copyFramebufferToTexture(texture,copyOrigin);
    return {texture,width,height,ratio,x,y,pixelWidth,pixelHeight,generation,...(physical?{physical:true}:{})};
  }

  function configure(frame) {
    configureNativeRendererSize(renderer, frame.width, frame.height, frame.ratio, size, true, true, 'bounded');
    renderer.setRenderTarget?.(null);
    // setViewport rounds its DPR multiplication. A physical room replay must
    // cover the actual floor-sized buffer, without extending it by one pixel.
    renderer.setViewport(0,0,frame.physical?frame.pixelWidth/frame.ratio:frame.width,
      frame.physical?frame.pixelHeight/frame.ratio:frame.height);
  }

  function compose(outputFrame, layers) {
    const context = readyContext();
    if (!ownedDescriptor(outputFrame) || !context || !Array.isArray(layers)
      || layers.some(layer => !liveTextures.has(layer?.frame?.texture) || layer.frame.generation !== generation)) return false;
    const plan = policy.compose(outputFrame, layers, context, renderer.capabilities?.maxTextureSize);
    if (!plan) return false;
    configure(outputFrame);
    uniforms.outputSize.value.set(outputFrame.width,outputFrame.height);
    uniforms.outputOrigin.value.set(outputFrame.x||0,outputFrame.y||0);
    for (let i=0;i<MAX_LAYERS;i++) {
      const layer=layers[i], enabled=Boolean(layer);
      uniforms[`enabled${i}`].value=enabled?1:0;
      uniforms[`layer${i}`].value=enabled?layer.frame.texture:transparent;
      if (!enabled) continue;
      const at = i * 8;
      uniforms[`rect${i}`].value.set(plan[at],plan[at+1],plan[at+2],plan[at+3]);
      uniforms[`clip${i}`].value.set(plan[at+4],plan[at+5],plan[at+6],plan[at+7]);
    }
    const autoClear=renderer.autoClear,scissorTest=renderer.getScissorTest();
    renderer.getScissor(scissor); renderer.getClearColor(clearColor);
    const clearAlpha=renderer.getClearAlpha(),shadowEnabled=renderer.shadowMap.enabled;
    const gl=renderer.getContext(),ditherCapable=typeof gl?.isEnabled==='function' && typeof gl.disable==='function' && typeof gl.enable==='function';
    const ditherEnabled=ditherCapable ? gl.isEnabled(gl.DITHER) : false;
    try {
      if(ditherCapable)gl.disable(gl.DITHER);
      renderer.autoClear=false; renderer.shadowMap.enabled=false;
      renderer.setScissorTest(false); renderer.setClearColor(0x000000,0);
      renderer.clear(true,true,true); renderer.render(scene,camera);
    } finally {
      if(ditherCapable) { if(ditherEnabled)gl.enable(gl.DITHER);else gl.disable(gl.DITHER); }
      renderer.autoClear=autoClear;renderer.shadowMap.enabled=shadowEnabled;
      renderer.setClearColor(clearColor,clearAlpha);
      renderer.setScissor(scissor); renderer.setScissorTest(scissorTest);
    }
    return true;
  }

  function repaint(frame) {
    if(!validFrame(frame))return false;
    return compose(frame,[{frame,x:frame.x,y:frame.y,scale:1}]);
  }

  function releaseSlot(slot) {
    const texture=slots.get(slot);
    if (texture) { texture.dispose();slots.delete(slot);liveTextures.delete(texture); }
  }

  // Only the caller's managed slots are eligible. Insertion leases retain
  // their own slots until ownership has actually transferred or released.
  function releaseUnusedSlots(managedSlots, retainedFrames) {
    const retained = new Set(retainedFrames.filter(frame=>validFrame(frame)).map(frame=>frame.texture));
    let released = 0;
    for(const slot of managedSlots) {
      const texture=slots.get(slot);
      if(texture && !retained.has(texture)) { releaseSlot(slot);released++; }
    }
    return released;
  }

  function dispose() {
    if (disposed) return;disposed=true;
    policy.dispose();
    renderer.domElement.removeEventListener?.('webglcontextlost',contextLost);
    renderer.domElement.removeEventListener?.('webglcontextrestored',contextRestored);
    for(const texture of slots.values())texture.dispose();slots.clear();liveTextures.clear();
    transparent.dispose();geometry.dispose();material.dispose();scene.remove(mesh);
  }

  // Link the raw copy before an inspection gesture starts. This does not draw
  // or alter the default framebuffer which remains the original scene output.
  function prepare() { if (!prepared) { renderer.compile(scene,camera); prepared=true; } }
  // Uniform reflection is otherwise deferred until the first room replay,
  // inside the book's return. Prepare the identical raw program in idle slices;
  // no framebuffer allocation, capture or draw is needed.
  async function prepareUniforms({ idle, current = () => true } = {}) {
    if (typeof idle !== 'function') return false;
    const ownerGeneration = generation;
    const active = () => !disposed && generation === ownerGeneration && current() && contextReady();
    await idle();
    if (!active()) return false;
    prepare();
    renderer.getContext().flush?.();
    return prepareProgramUniforms(renderer, [material], { idle, current:active });
  }
  return {capture,repaint,compose,releaseSlot,releaseUnusedSlots,dispose,exactFrame,validFrame,prepare,prepareUniforms};
}
