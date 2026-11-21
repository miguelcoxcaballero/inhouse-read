import { beforeEach, describe, expect, it, vi } from 'vitest';

// What the flyout's context does before any lifted book's first paint (src/js/book-model.js): its canvas starts at
// one pixel instead of the browser's 300 × 150, and the idle preparation enables anisotropic filtering (without
// uploading anything), so the tap's paint does neither.
const gpu = vi.hoisted(() => ({ renderers:[], saved:null }));
vi.mock('three', async importOriginal => {
  const THREE = await importOriginal();
  class Renderer {
    constructor(options) {
      this.options = options; this.domElement = document.createElement('canvas');
      this.shadowMap = {}; this.info = { programs:[] }; this.calls = [];
      this.capabilities = { getMaxAnisotropy:vi.fn(() => 16) };
      gpu.renderers.push(this);
    }
    setSize(width, height, style) { this.calls.push(['setSize', width, height, style]); this.domElement.width = width; this.domElement.height = height; }
    compile() { this.calls.push(['compile']); return new Set(); }
    initTexture(texture) { this.calls.push(['initTexture', texture]); }
    getContext() { return { flush() {} }; }
    render() {}
    dispose() {}
  }
  class PMREM {
    fromScene() { return { texture:new THREE.Texture() }; }
    dispose() {}
  }
  return { ...THREE, WebGLRenderer:Renderer, PMREMGenerator:PMREM };
});
vi.mock('../../src/js/rust-shelf.js', async () => (await import('./helpers/rust-shelf-real.js')).rustShelfMock());
vi.mock('../../src/js/studio-environment-cache.js', () => ({
  cachedStudioEnvironment:() => gpu.saved?.(), prepareStudioEnvironmentCache:() => {}
}));
vi.mock('../../src/js/gpu-programs.js', () => ({
  prepareProgramUniforms:async () => true, retainPrograms:() => {}, keepProgramsAlive:() => {}, compilePagePrograms:() => {}
}));

beforeEach(() => {
  vi.resetModules(); gpu.renderers.length = 0; gpu.saved = null;
  vi.stubGlobal('WebGLRenderingContext', function WebGLRenderingContext() {});
});

describe('the flyout context before the first lifted book', () => {
  it('starts its drawing buffer at one pixel; the shelf snapshot renderer is untouched', async () => {
    const { getBookRenderer, getPresentationBookRenderer } = await import('../../src/js/book-model.js');
    const shared = getBookRenderer(), presentation = getPresentationBookRenderer();
    expect(shared.calls).toEqual([]);
    expect(presentation.calls).toEqual([['setSize', 1, 1, false]]);
    expect([presentation.domElement.width, presentation.domElement.height]).toEqual([1, 1]);
    expect(getPresentationBookRenderer()).toBe(presentation); expect(presentation.calls).toHaveLength(1);
  });

  it('enables anisotropy in the idle preparation and uploads no texture, not even a saved studio', async () => {
    const THREE = await import('three');
    gpu.saved = () => new THREE.DataTexture(new Uint16Array(4), 1, 1, THREE.RGBAFormat, THREE.HalfFloatType);
    const { prepareBookPresentation, getPresentationBookRenderer } = await import('../../src/js/book-model.js');
    expect(await prepareBookPresentation(new THREE.Group(), async () => {})).toBe(true);
    const presentation = getPresentationBookRenderer();
    expect(presentation.calls.map(([name]) => name)).toEqual(['setSize', 'compile']);
    expect(presentation.capabilities.getMaxAnisotropy).toHaveBeenCalledOnce();
  });
});
