import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';

let cache;
beforeEach(async () => { vi.resetModules(); cache = await import('../../src/js/studio-environment-cache.js'); });
function target(width=4,height=4) {
  const result = new THREE.WebGLRenderTarget(width,height,{type:THREE.HalfFloatType,format:THREE.RGBAFormat,
    colorSpace:THREE.LinearSRGBColorSpace,minFilter:THREE.LinearFilter,magFilter:THREE.LinearFilter,generateMipmaps:false});
  result.texture.mapping=THREE.CubeUVReflectionMapping;
  return result;
}
const settle = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };
const validRead = vi.fn(async (_target,_x,_y,_w,_h,data) => { data.fill(0x3c00); return data; });

describe('immutable half-float studio cache', () => {
  it('does not wait for a pending transfer and preserves every half-float word and sampler property', async () => {
    const source=target();let finish,data;
    const renderer={readRenderTargetPixelsAsync:vi.fn((_target,x,y,w,h,body)=>{expect([x,y,w,h]).toEqual([0,0,4,4]);data=body;return new Promise(resolve=>{finish=resolve;});})};
    expect(cache.prepareStudioEnvironmentCache(renderer,source)).toBeUndefined();
    expect(cache.cachedStudioEnvironment()).toBeNull();
    data.fill(0x3c00);data[4]=0x3555;data[9]=0x0001;finish(data);await settle();
    const first=cache.cachedStudioEnvironment(),second=cache.cachedStudioEnvironment();
    expect(first).toBeInstanceOf(THREE.DataTexture);expect(first).not.toBe(second);
    expect(first.image).toEqual({data,width:4,height:4});expect(second.image.data).toBe(data);
    expect(first.type).toBe(THREE.HalfFloatType);expect(first.format).toBe(THREE.RGBAFormat);
    for(const key of ['mapping','minFilter','magFilter','generateMipmaps','colorSpace','flipY','wrapS','wrapT'])expect(first[key]).toBe(source.texture[key]);
    expect(first.version).toBe(1);first.dispose();expect(second.image.data[4]).toBe(0x3555);
  });
  it('starts at most one transfer across renderer contexts', async () => {
    const read=vi.fn(validRead);cache.prepareStudioEnvironmentCache({readRenderTargetPixelsAsync:read},target());
    cache.prepareStudioEnvironmentCache({readRenderTargetPixelsAsync:read},target());await settle();
    cache.prepareStudioEnvironmentCache({readRenderTargetPixelsAsync:read},target());expect(read).toHaveBeenCalledTimes(1);
  });
  it.each(['throw','reject'])('retains the original bake when the driver %s fails', async mode => {
    const read=vi.fn(()=>{if(mode==='throw')throw new Error('context lost');return Promise.reject(new Error('unsupported read'));});
    expect(()=>cache.prepareStudioEnvironmentCache({readRenderTargetPixelsAsync:read},target())).not.toThrow();await settle();
    expect(cache.cachedStudioEnvironment()).toBeNull();
  });
  it.each(['empty','infinity','nan','different-buffer'])('rejects an %s payload instead of changing lighting', async mode => {
    const read=vi.fn(async (_t,_x,_y,_w,_h,data)=>{data.fill(mode==='empty'?0:0x3c00);
      if(mode==='infinity')data[1]=0x7c00;if(mode==='nan')data[1]=0x7c01;return mode==='different-buffer'?data.slice():data;});
    cache.prepareStudioEnvironmentCache({readRenderTargetPixelsAsync:read},target());await settle();expect(cache.cachedStudioEnvironment()).toBeNull();
  });
  it('skips unsupported renderers without preventing a later supported transfer', async () => {
    cache.prepareStudioEnvironmentCache({},target());expect(cache.cachedStudioEnvironment()).toBeNull();
    cache.prepareStudioEnvironmentCache({readRenderTargetPixelsAsync:validRead},target());await settle();expect(cache.cachedStudioEnvironment()).not.toBeNull();
  });
  it.each(['type','format','mapping','not-target'])('preserves fallback for incompatible %s', async mode => {
    const source=target();if(mode==='type')source.texture.type=THREE.UnsignedByteType;if(mode==='format')source.texture.format=THREE.RedFormat;
    if(mode==='mapping')source.texture.mapping=THREE.UVMapping;if(mode==='not-target')source.isWebGLRenderTarget=false;
    const read=vi.fn();cache.prepareStudioEnvironmentCache({readRenderTargetPixelsAsync:read},source);await settle();expect(read).not.toHaveBeenCalled();expect(cache.cachedStudioEnvironment()).toBeNull();
  });
  it.each([0,-1,1.5,Infinity,NaN,2048])('rejects unsafe width %s before allocating a payload', async width => {
    const source=target();source.width=width;source.height=1024;
    const read=vi.fn();cache.prepareStudioEnvironmentCache({readRenderTargetPixelsAsync:read},source);await settle();expect(read).not.toHaveBeenCalled();expect(cache.cachedStudioEnvironment()).toBeNull();
  });
});
