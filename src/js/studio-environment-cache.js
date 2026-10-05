import * as THREE from 'three';

// Both persistent renderers use the same immutable studio. Its CubeUV atlas
// contains every roughness level already, so a bit-exact half-float transfer
// avoids generating the room and filtering it again in the second context.
// Never wait for this optional transfer in selection, reading or animation.
const MAX_BYTES = 8 * 1024 * 1024;
const properties = ['mapping','minFilter','magFilter','generateMipmaps','colorSpace','flipY','wrapS','wrapT'];
let attempted = false, atlas = null;

export function prepareStudioEnvironmentCache(renderer, target) {
  if (attempted || typeof renderer?.readRenderTargetPixelsAsync !== 'function' ||
    !target?.isWebGLRenderTarget || target.texture?.type !== THREE.HalfFloatType ||
    target.texture.format !== THREE.RGBAFormat || target.texture.mapping !== THREE.CubeUVReflectionMapping) return;
  const {width,height} = target;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0 || width * height * 8 > MAX_BYTES) return;
  attempted = true;
  const data = new Uint16Array(width * height * 4);
  const settings = Object.fromEntries(properties.map(key => [key,target.texture[key]]));
  // Async PBO/fence read restores the driver's framebuffer before yielding.
  // Unsupported reads, context loss or empty output retain the original bake.
  try {
    Promise.resolve(renderer.readRenderTargetPixelsAsync(target,0,0,width,height,data))
      .then(result => {
        if (result !== data || !data.some(value => value !== 0) ||
          data.some(value => (value & 0x7c00) === 0x7c00)) return;
        atlas = {data,width,height,settings};
      }).catch(() => {});
  } catch { /* The studio remains available through its existing GPU texture. */ }
}

export function cachedStudioEnvironment() {
  if (!atlas) return null;
  const texture = new THREE.DataTexture(atlas.data,atlas.width,atlas.height,THREE.RGBAFormat,THREE.HalfFloatType);
  Object.assign(texture,atlas.settings);
  texture.needsUpdate = true;
  return texture;
}
