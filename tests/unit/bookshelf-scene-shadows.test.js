import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { createBookshelfScene } from '../../src/js/bookshelf-scene.js';

const gpu = vi.hoisted(() => ({ renderer:null, passes:null, key:null, samples:null }));
vi.mock('../../src/js/book-model.js', async () => {
  const Three = await import('three');
  let ratio = 1;
  const size = new Three.Vector2();
  gpu.renderer = { domElement:document.createElement('canvas'), shadowMap:{ needsUpdate:false },
    capabilities:{ getMaxAnisotropy:() => 1 }, getPixelRatio:() => ratio,
    setPixelRatio:value => { ratio = value; }, getSize:target => target.copy(size),
    setSize:(width, height) => { size.set(width, height); }, autoClear:true, clear() {},
    getScissor:target => target, setScissor() {}, getScissorTest:() => false, setScissorTest() {},
    // Record what each pass would draw: visible meshes and their materials.
    render(scene, camera) {
      // Blur taps and whether this frame redraws the shadow map.
      if (gpu.samples) { gpu.samples.push([gpu.key.shadow.blurSamples, gpu.renderer.shadowMap.needsUpdate]); gpu.renderer.shadowMap.needsUpdate = false; }
      if (!gpu.passes) return;
      const meshes = [];
      scene.traverseVisible(object => { if (object.isMesh) meshes.push({ object, material:object.material }); });
      gpu.passes.push({ camera, meshes });
    } };
  return { getBookRenderer:() => gpu.renderer,
    // The real rig's key: shelf-lighting gives it the fitted variance shadow.
    lightBookScene(scene) {
      const key = new Three.DirectionalLight(0xffffff, 1); key.position.set(-.46, .42, 1);
      scene.add(key); scene.userData.readerLight = key; gpu.key = key;
    },
    createBookModel(book, style, width, height, thickness) {
      const model = new Three.Group(); model.name = `book:${book.id}`;
      model.add(new Three.Mesh(new Three.BoxGeometry(width, height, thickness), new Three.MeshStandardMaterial()));
      model.userData.dispose = () => {};
      return model;
    } };
});

let clock, frames, shelf, stage, scroller, scroll, nodes, loads;
const rect = (left, top, width, height) => ({ left, top, width, height, right:left + width, bottom:top + height });
function flushFrames(duration = 400) {
  const end = clock + duration;
  while (frames.size && clock < end) {
    clock += 16;
    const callbacks = [...frames.values()]; frames.clear();
    for (const callback of callbacks) callback(clock);
  }
}
function scrollTo(value) {
  gpu.renderer.shadowMap.needsUpdate = false;
  scroll = value; scroller.dispatchEvent(new Event('scroll')); flushFrames();
  return gpu.renderer.shadowMap.needsUpdate;
}

beforeEach(() => {
  clock = 0; frames = new Map(); scroll = 0;
  let serial = 0;
  vi.stubGlobal('requestAnimationFrame', callback => { const id = ++serial; frames.set(id, callback); return id; });
  vi.stubGlobal('cancelAnimationFrame', id => frames.delete(id));
  vi.spyOn(performance, 'now').mockImplementation(() => clock);
  loads = [];
  vi.spyOn(THREE.TextureLoader.prototype, 'load').mockImplementation((url, onLoad, onProgress, onError) => {
    const texture = new THREE.Texture(); loads.push({ url, texture, onLoad, onError }); return texture;
  });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ({ drawImage() {}, clearRect() {}, fillRect() {} }));
  window.matchMedia = () => ({ matches:false });
  scroller = document.createElement('div'); stage = document.createElement('div');
  scroller.append(stage); document.body.append(scroller);
  Object.defineProperty(scroller, 'clientHeight', { value:700 });
  Object.defineProperty(scroller, 'scrollTop', { configurable:true, get:() => scroll, set:value => { scroll = Math.max(0, Number(value) || 0); } });
  scroller.getBoundingClientRect = () => rect(20, 60, 390, 700);
  stage.getBoundingClientRect = () => rect(20, 60 - scroll, 390, 3555);
  // Sixteen rows of five books: far taller than the 700 px window.
  const rows = Array.from({ length:16 }, (_, index) => ({ top:20 + index * 220, bottom:220 + index * 220 }));
  nodes = [];
  const entries = Array.from({ length:80 }, (_, index) => {
    const node = document.createElement('button'); node.classList.add('ihr-spine'); stage.append(node); nodes.push(node);
    return { node, book:{ id:String(index), title:`Book ${index}`, author:'Author' }, style:{ color:'#41694f', width:28 },
      x:44 + index % 5 * 72, y:rows[Math.floor(index / 5)].bottom - 90, width:100, height:180, thickness:28 };
  });
  shelf = createBookshelfScene({ stage, scroller, width:390, sceneWidth:390, height:rows.at(-1).bottom + 35, rows, entries });
  shelf.canvas.getBoundingClientRect = () => rect(20, 60, 390, 700);
  scroll = 1300; shelf.flush(); flushFrames();
});

afterEach(() => {
  shelf?.dispose(); shelf = null; document.body.innerHTML = ''; gpu.samples = null;
  delete document.documentElement.dataset.theme;
  vi.restoreAllMocks(); vi.unstubAllGlobals();
});

describe('shelf shadows while scrolling', () => {
  it('repaints a scrolled window from the same shadow map until the casters or the fitted window change', () => {
    const renders = () => Number(shelf.canvas.dataset.snapshotRenderCount), creations = () => shelf.canvas.dataset.modelCreations;
    const before = renders(), models = creations();
    // A short scroll inside the same rows: new pixels, identical world shadows.
    expect(scrollTo(1290)).toBe(false);
    expect(renders()).toBeGreaterThan(before);
    expect(creations()).toBe(models);
    // The next row enters the culling margin: its books must cast at once.
    expect(scrollTo(1310)).toBe(true);
    expect(Number(creations())).toBeGreaterThan(Number(models));
    expect(scrollTo(1315)).toBe(false);
    // A released row changes the casters too.
    expect(scrollTo(1330)).toBe(true);
    // Leaving the fitted slack (a quarter screen) refits, even with the same models.
    const settled = creations();
    expect(scrollTo(1470)).toBe(false);
    expect(scrollTo(1480)).toBe(true);
    expect(creations()).toBe(settled);
    // Any other scene change still redraws the map.
    gpu.renderer.shadowMap.needsUpdate = false;
    shelf.invalidate(); flushFrames();
    expect(gpu.renderer.shadowMap.needsUpdate).toBe(true);
  });

  it('draws the returning book depth pass with unlit stand-ins and restores every material', () => {
    const overlayCanvas = document.createElement('canvas'); overlayCanvas.width = 1024; overlayCanvas.height = 768;
    gpu.passes = [];
    const motion = shelf.returnBook(nodes[30], { duration:400, overlayCanvas });
    expect(motion).not.toBeNull();
    const depth = gpu.passes.at(-2), colour = gpu.passes.at(-1);
    expect(depth.camera).toBe(colour.camera);
    const cabinet = depth.meshes.filter(({ object }) => object.parent?.userData.furniture);
    expect(cabinet.length).toBe(3);
    for (const { material } of [...cabinet, ...depth.meshes.filter(({ object }) => /^book:/.test(object.parent?.name))]) {
      expect(material.isMeshBasicMaterial).toBe(true); expect(material.colorWrite).toBe(false);
    }
    // The blended occlusion keeps its own material, and the moving book is absent.
    expect(depth.meshes.find(({ object }) => object.name === 'Cabinet occlusion').material.transparent).toBe(true);
    expect(depth.meshes.some(({ object }) => object.parent?.name === 'book:30')).toBe(false);
    // The colour pass draws only that book, lit, with its own material.
    expect(colour.meshes.length).toBeGreaterThan(0);
    for (const { object, material } of colour.meshes) {
      expect(object.parent.name).toBe('book:30'); expect(material.isMeshStandardMaterial).toBe(true);
    }
    // Afterwards nothing is left swapped or colour-masked.
    for (const { object } of cabinet) {
      expect(object.material.isMeshPhysicalMaterial || object.material.isMeshStandardMaterial).toBe(true);
      expect(object.material.colorWrite).toBe(true);
    }
    motion.cancel(); gpu.passes = null;
  });

  it('blurs the map with half the taps while the cabinet turns, then redraws it once at full quality', () => {
    const full = gpu.key.shadow.blurSamples;
    gpu.samples = [];
    shelf.setMode('isometric'); flushFrames(1400);
    expect(frames.size).toBe(0);
    const [last, ...turning] = [...gpu.samples].reverse();
    expect(turning.length).toBeGreaterThan(10);
    expect(turning.every(([samples, redraw]) => samples === full / 2 && redraw)).toBe(true);
    // The frame after the turn settles: same view, full-quality redraw.
    expect(last).toEqual([full, true]);
    expect(shelf.canvas.dataset.animating).toBe('false');
  });

  it('lays the dark page floor pool only under the dark theme, rebuilt when the theme changes', async () => {
    gpu.passes = [];
    const occlusion = () => { gpu.passes = []; shelf.invalidate(); flushFrames(); return gpu.passes.at(-1).meshes.find(({ object }) => object.name === 'Cabinet occlusion').object; };
    const tinted = mesh => { const colors = mesh.geometry.getAttribute('color'); return [...Array(colors.count).keys()].some(index => colors.getX(index) > 0); };
    const mesh = occlusion(), light = mesh.geometry;
    expect(tinted(mesh)).toBe(false);
    let released = 0; light.addEventListener('dispose', () => { released++; });
    document.documentElement.dataset.theme = 'dark'; await Promise.resolve();
    expect(occlusion()).toBe(mesh); expect(tinted(mesh)).toBe(true); expect(released).toBe(1);
    document.documentElement.dataset.theme = 'light'; await Promise.resolve();
    expect(tinted(occlusion())).toBe(false);
    gpu.passes = null;
  });

  it('keeps the walnut matte with flat mean maps when a texture file is missing', () => {
    const walnut = loads.filter(({ url }) => /walnut-(pbr|surface)\.webp/.test(url));
    expect(walnut).toHaveLength(2);
    for (const { texture, onError } of walnut) {
      const version = texture.version;
      onError(new Event('error'));
      expect(texture.image.width).toBe(1); expect(texture.image.height).toBe(1);
      expect(texture.version).toBeGreaterThan(version);
    }
    expect(frames.size).toBeGreaterThan(0);
    gpu.passes = []; flushFrames();
    const cabinet = gpu.passes.at(-1).meshes.filter(({ object }) => object.parent?.userData.furniture);
    expect(cabinet).toHaveLength(3);
    for (const { material } of cabinet) {
      expect(material.roughnessMap).toBe(walnut.find(({ url }) => /surface/.test(url)).texture);
      expect(material.map).toBe(walnut.find(({ url }) => /pbr/.test(url)).texture);
    }
    gpu.passes = null;
  });
});
