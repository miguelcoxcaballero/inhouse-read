import * as THREE from 'three';
import { configureNativeRendererSize } from './native-renderer-size.js';
import { prepareProgramUniforms } from './gpu-programs.js';

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
  const material = new THREE.RawShaderMaterial({
    uniforms, depthTest:false, depthWrite:false, blending:THREE.NoBlending,
    transparent:false, toneMapped:false, premultipliedAlpha:false,
    vertexShader:`precision highp float;
      attribute vec3 position;
      uniform vec2 outputSize;
      varying vec2 point;
      void main() {
        point = (position.xy * vec2(.5,-.5) + .5) * outputSize;
        gl_Position = vec4(position.xy,0.,1.);
      }`,
    fragmentShader:`precision highp float;
      uniform vec2 outputOrigin;
      ${Array.from({length:MAX_LAYERS},(_,i)=>`uniform sampler2D layer${i}; uniform vec4 rect${i}; uniform vec4 clip${i}; uniform float enabled${i};`).join('\n')}
      varying vec2 point;
      vec4 sampleLayer(sampler2D image, vec4 rect, vec4 clip, float enabled, vec2 p) {
        if (enabled < .5 || p.x < clip.x || p.y < clip.y || p.x >= clip.z || p.y >= clip.w) return vec4(0.);
        vec2 uv = (p - rect.xy) / rect.zw;
        if (uv.x < 0. || uv.y < 0. || uv.x >= 1. || uv.y >= 1.) return vec4(0.);
        // Framebuffer textures keep GL's bottom-left origin. The geometry and
        // clipping above use the same top-left logical axes as the CSS cache.
        return texture2D(image,vec2(uv.x,1.-uv.y));
      }
      void main() {
        vec2 p = point + outputOrigin;
        vec4 color = vec4(0.);
        ${Array.from({length:MAX_LAYERS},(_,i)=>`vec4 foreground${i} = sampleLayer(layer${i},rect${i},clip${i},enabled${i},p); color = foreground${i} + color * (1. - foreground${i}.a);`).join('\n')}
        // Every input is already premultiplied and encoded. A single raw
        // output avoids shader color-space conversion or a second GL blend.
        gl_FragColor = color;
      }`
  });
  const geometry = new THREE.PlaneGeometry(2,2), mesh = new THREE.Mesh(geometry,material);
  mesh.frustumCulled = false;
  const scene = new THREE.Scene(), camera = new THREE.Camera(); scene.add(mesh);
  let disposed = false,prepared=false,generation=0;
  function invalidateFrames() {
    generation++;prepared=false;
    for(const texture of slots.values())texture.dispose();slots.clear();liveTextures.clear();
  }
  const contextLost=()=>invalidateFrames();
  const contextRestored=()=>{invalidateFrames();onRestored?.();};
  renderer.domElement.addEventListener?.('webglcontextlost',contextLost);
  renderer.domElement.addEventListener?.('webglcontextrestored',contextRestored);

  function contextReady() {
    try { const context=renderer.getContext();return Boolean(context) && !context.isContextLost?.(); }
    catch { return false; }
  }

  function exactFrame(frame) {
    const logical = !disposed && contextReady() && frame && [frame.width,frame.height,frame.ratio].every(value=>Number.isFinite(value)&&value>0)
      && (frame.generation===undefined || frame.generation===generation)
      && [frame.x??0,frame.y??0].every(Number.isFinite);
    if (!logical) return false;
    if (frame.physical === true) {
      // A resolved room may have Three's original floor-sized framebuffer
      // while occupying fractional CSS pixels. Keep those two sizes explicit;
      // book crops and aligned callers retain the strict descriptor below.
      let gl;try { gl=renderer.getContext(); } catch { return false; }
      return [frame.pixelWidth,frame.pixelHeight,gl?.drawingBufferWidth,gl?.drawingBufferHeight]
        .every(value=>Number.isInteger(value)&&value>0)
        && frame.pixelWidth===Math.floor(frame.width*frame.ratio)
        && frame.pixelHeight===Math.floor(frame.height*frame.ratio)
        && (!Number.isFinite(renderer.capabilities?.maxTextureSize) ||
          Math.max(frame.pixelWidth,frame.pixelHeight)<=renderer.capabilities.maxTextureSize);
    }
    return frame.physical===undefined &&
      [frame.width*frame.ratio,frame.height*frame.ratio,(frame.x??0)*frame.ratio,(frame.y??0)*frame.ratio].every(Number.isInteger);
  }
  function validFrame(frame) { return liveTextures.has(frame?.texture) && frame.generation===generation && exactFrame(frame); }

  function capture(slot, descriptor) {
    if (!exactFrame(descriptor) || renderer.getRenderTarget?.()) return null;
    const {width,height,ratio,x=0,y=0,sourceX=0,sourceY=0} = descriptor;
    const physical=descriptor.physical===true;
    const pixelWidth=physical?descriptor.pixelWidth:width*ratio,pixelHeight=physical?descriptor.pixelHeight:height*ratio;
    if (![sourceX,sourceY].every(Number.isInteger) || sourceX<0 || sourceY<0
      || sourceX+pixelWidth>renderer.domElement.width || sourceY+pixelHeight>renderer.domElement.height) return null;
    if (physical) {
      let gl;try { gl=renderer.getContext(); } catch { return null; }
      if (gl?.drawingBufferWidth!==renderer.domElement.width || gl?.drawingBufferHeight!==renderer.domElement.height ||
        sourceX+pixelWidth>gl.drawingBufferWidth || sourceY+pixelHeight>gl.drawingBufferHeight) return null;
    }
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
    if (!exactFrame(outputFrame) || !Array.isArray(layers) || layers.length>MAX_LAYERS
      || layers.some(layer=>!validFrame(layer?.frame) || !Number.isFinite(layer.scale??1) || !((layer.scale??1)>0)
        || ![layer.x??layer.frame.x,layer.y??layer.frame.y].every(Number.isFinite)
        || layer.clip && ![layer.clip.left,layer.clip.top,layer.clip.right,layer.clip.bottom].every(Number.isFinite))) return false;
    configure(outputFrame);
    uniforms.outputSize.value.set(outputFrame.width,outputFrame.height);
    uniforms.outputOrigin.value.set(outputFrame.x||0,outputFrame.y||0);
    for (let i=0;i<MAX_LAYERS;i++) {
      const layer=layers[i], enabled=Boolean(layer),scale=layer?.scale??1;
      uniforms[`enabled${i}`].value=enabled?1:0;
      uniforms[`layer${i}`].value=enabled?layer.frame.texture:transparent;
      if (!enabled) continue;
      const x=layer.x??layer.frame.x,y=layer.y??layer.frame.y;
      const width=layer.frame.width*scale,height=layer.frame.height*scale;
      uniforms[`rect${i}`].value.set(x,y,width,height);
      const clip=layer.clip || {left:x,top:y,right:x+width,bottom:y+height};
      uniforms[`clip${i}`].value.set(clip.left,clip.top,clip.right,clip.bottom);
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
