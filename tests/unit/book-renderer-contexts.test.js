import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const gpu = vi.hoisted(() => ({ renderers:[], environments:[], failPMREM:false }));
vi.mock('three', async importOriginal => {
  const THREE = await importOriginal();
  class Renderer {
    constructor(options) {
      this.options = options; this.domElement = document.createElement('canvas');
      this.shadowMap = {}; this.info = { programs:[] }; this.disposed = false;
      gpu.renderers.push(this);
    }
    render() {}
    dispose() { this.disposed = true; }
  }
  class PMREM {
    constructor(renderer) { this.renderer = renderer; }
    fromScene(room, sigma) {
      if (gpu.failPMREM) throw new Error('Context cannot prepare its studio');
      const objects = [];
      room.traverse(object => objects.push({
        type:object.type, position:object.position.toArray(), rotation:object.rotation.toArray(),
        geometry:object.geometry?.type, parameters:object.geometry?.parameters,
        material:object.material ? { type:object.material.type, color:object.material.color.toArray(),
          side:object.material.side, vertexColors:object.material.vertexColors } : null
      }));
      const texture = new THREE.Texture();
      gpu.environments.push({ renderer:this.renderer, texture, sigma, objects });
      return { texture };
    }
    dispose() {}
  }
  return { ...THREE, WebGLRenderer:Renderer, PMREMGenerator:PMREM };
});

beforeEach(() => {
  vi.resetModules(); gpu.renderers.length = 0; gpu.environments.length = 0; gpu.failPMREM = false;
  vi.stubGlobal('WebGLRenderingContext', function WebGLRenderingContext() {});
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('book studios belonging to their GPU context', () => {
  it('keeps the original shared renderer and default studio warm', async () => {
    const { getBookRenderer, lightBookScene } = await import('../../src/js/book-model.js');
    const { Scene } = await import('three');
    const renderer = getBookRenderer();
    expect(getBookRenderer()).toBe(renderer);
    expect(gpu.renderers).toHaveLength(1); expect(gpu.environments).toHaveLength(1);
    const scene = lightBookScene(new Scene());
    expect(scene.environment).toBe(gpu.environments[0].texture);
    expect(scene.environmentIntensity).toBe(.55);
    expect(scene.children.map(light => light.intensity)).toEqual([.5, 1.9, .26, .34]);
  });

  it('creates one separate presentation context with the identical studio rig and renderer settings', async () => {
    const { getBookRenderer, getPresentationBookRenderer, lightBookScene } = await import('../../src/js/book-model.js');
    const { Scene } = await import('three');
    const shared = getBookRenderer();
    expect(gpu.renderers).toHaveLength(1);
    const presentation = getPresentationBookRenderer();
    expect(presentation).not.toBe(shared); expect(getPresentationBookRenderer()).toBe(presentation);
    expect(getBookRenderer()).toBe(shared);
    expect(gpu.renderers).toHaveLength(2); expect(gpu.environments).toHaveLength(2);
    expect(shared.options).toEqual({ alpha:true, antialias:true, preserveDrawingBuffer:false });
    expect(presentation.options).toEqual({ alpha:true, antialias:true, preserveDrawingBuffer:true });
    for (const key of ['outputColorSpace','toneMapping','toneMappingExposure','shadowMap'])
      expect(presentation[key]).toEqual(shared[key]);
    expect(gpu.environments[1].sigma).toBe(gpu.environments[0].sigma);
    expect(gpu.environments[1].objects).toEqual(gpu.environments[0].objects);
    const sharedScene = lightBookScene(new Scene(), shared);
    const presentationScene = lightBookScene(new Scene(), presentation);
    expect(sharedScene.environment).toBe(gpu.environments[0].texture);
    expect(presentationScene.environment).toBe(gpu.environments[1].texture);
    expect(presentationScene.environment).not.toBe(sharedScene.environment);
    expect(presentationScene.children.map(light => [light.type, light.color.toArray(), light.intensity, light.position.toArray()]))
      .toEqual(sharedScene.children.map(light => [light.type, light.color.toArray(), light.intensity, light.position.toArray()]));
    expect(lightBookScene(new Scene()).environment).toBe(sharedScene.environment);
  });

  it('releases a failed presentation initialization while the existing shared studio stays usable', async () => {
    const { getBookRenderer, getPresentationBookRenderer, lightBookScene } = await import('../../src/js/book-model.js');
    const { Scene } = await import('three');
    const shared = getBookRenderer(), environment = gpu.environments[0].texture;
    gpu.failPMREM = true;
    expect(getPresentationBookRenderer()).toBeNull();
    expect(gpu.renderers[1].disposed).toBe(true);
    expect(shared.disposed).toBe(false);
    expect(getBookRenderer()).toBe(shared);
    expect(lightBookScene(new Scene(), shared).environment).toBe(environment);
  });
});
