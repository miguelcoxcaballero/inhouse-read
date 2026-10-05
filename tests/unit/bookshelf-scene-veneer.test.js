import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';

// Programs are always linked here: only the walnut veneer can hold a frame.
const gpu = vi.hoisted(() => ({ renders:0, scene:null }));
vi.mock('../../src/js/book-model.js', async () => {
  const Three = await import('three');
  let ratio = 1, target = null;
  const size = new Three.Vector2();
  const renderer = { domElement:document.createElement('canvas'), shadowMap:{},
    capabilities:{ getMaxAnisotropy:() => 1 }, getPixelRatio:() => ratio,
    setPixelRatio:value => { ratio = value; }, getSize:output => output.copy(size),
    setSize:(width, height) => size.set(width, height), render(scene) { gpu.renders++; gpu.scene = scene; },
    getRenderTarget:() => target, setRenderTarget(next) { target = next; },
    properties:{ get:() => ({ programs:new Map() }) }, compile:() => new Set() };
  return { getBookRenderer:() => renderer, lightBookScene() {},
    createBookModel(book, style, width, height, thickness) {
      const model = new Three.Group();
      model.add(new Three.Mesh(new Three.BoxGeometry(width, height, thickness), new Three.MeshStandardMaterial()));
      return model;
    } };
});

let shelf, stage, scroller, frames, clock, downloads, decoded;
const rect = (left, top, width, height) => ({ left, top, width, height, right:left + width, bottom:top + height });
function flushFrames() {
  for (let index = 0; frames.size && index < 100; index++) {
    clock += 16; const callbacks = [...frames.values()]; frames.clear();
    for (const callback of callbacks) callback(clock);
  }
}
const settle = async () => { for (let index = 0; index < 6; index++) await Promise.resolve(); };
// Loads the module as the app does, after the saved shelf type is known.
async function scene(type) {
  localStorage.setItem('inhouse-read-shelf-type', type);
  vi.resetModules();
  return (await import('../../src/js/bookshelf-scene.js')).createBookshelfScene;
}
function layout(shelfType) {
  const rows = [{ top:20, ceiling:12, bottom:220 }];
  const node = document.createElement('button'); node.className = 'ihr-spine'; node.dataset.bookId = 'book-0';
  stage.append(node);
  return { stage, scroller, width:390, sceneWidth:390, height:715, rows, shelfType, entries:[{ node, book:{ id:'book-0', title:'Book' },
    style:{ color:'#335577', shade:'#223344', ink:'#fff' }, x:60, y:170, height:150, width:100, thickness:24, shelf:0, depthInset:0 }] };
}
const veneered = () => {
  const maps = new Set();
  gpu.scene?.traverse(object => {
    for (const key of ['map', 'bumpMap', 'roughnessMap']) if (object.material?.[key]?.image === decoded) maps.add(object.material[key]);
  });
  return [...maps];
};

beforeEach(() => {
  clock = 0; frames = new Map(); let serial = 0; downloads = [];
  Object.assign(gpu, { renders:0, scene:null });
  decoded = { width:1024, height:1024 };
  vi.useFakeTimers({ toFake:['setTimeout', 'clearTimeout'] });
  vi.stubGlobal('requestAnimationFrame', callback => { const id = ++serial; frames.set(id, callback); return id; });
  vi.stubGlobal('cancelAnimationFrame', id => frames.delete(id));
  vi.stubGlobal('fetch', vi.fn(url => new Promise(resolve => downloads.push({ url, finish:() => resolve({ ok:true, blob:async () => new Blob() }) }))));
  vi.stubGlobal('createImageBitmap', vi.fn(async () => decoded));
  vi.spyOn(performance, 'now').mockImplementation(() => clock);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ({
    createImageData:(width, height) => ({ data:new Uint8ClampedArray(width * height * 4) }),
    putImageData() {}, drawImage() {}, clearRect() {}, fillRect() {}
  }));
  window.matchMedia = () => ({ matches:false });
  scroller = document.createElement('div'); stage = document.createElement('div');
  scroller.append(stage); document.body.append(scroller);
  Object.defineProperty(scroller, 'clientHeight', { value:700 });
  scroller.getBoundingClientRect = () => rect(0, 60, 390, 700);
  stage.getBoundingClientRect = () => rect(0, 60, 390, parseFloat(stage.style.height) || 715);
});
afterEach(() => {
  shelf?.dispose(); shelf = null; document.body.innerHTML = ''; localStorage.clear();
  vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});

describe('walnut veneer of the first frame', () => {
  it('starts decoding a saved walnut shelf with the app and paints its first frame only with the wood', async () => {
    const create = await scene('walnut');
    expect(downloads.map(download => download.url.split('/').pop())).toEqual(['walnut-pbr.webp', 'walnut-surface.webp']);
    shelf = create(layout('walnut'));
    shelf.canvas.getBoundingClientRect = () => rect(0, 60, 390, 700);
    flushFrames();
    expect(gpu.renders).toBe(0);
    for (const download of downloads) download.finish();
    await settle(); flushFrames();
    expect(gpu.renders).toBe(1);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(createImageBitmap).toHaveBeenCalledTimes(2);
    for (const [, options] of createImageBitmap.mock.calls)
      expect(options).toEqual({ imageOrientation:'flipY', premultiplyAlpha:'none', colorSpaceConversion:'none' });
    // Flipped while decoding, so three must not flip it a second time.
    const maps = veneered();
    expect(maps).toHaveLength(2);
    for (const map of maps) { expect(map.flipY).toBe(false); expect(map.version).toBeGreaterThan(0); }
    expect(maps.map(map => map.colorSpace).sort()).toEqual([THREE.NoColorSpace, THREE.SRGBColorSpace].sort());
  });

  it('needs no wait when the veneer was decoded before the scene', async () => {
    const create = await scene('walnut');
    for (const download of downloads) download.finish();
    await settle();
    shelf = create(layout('walnut'));
    expect(gpu.renders).toBe(1);
    expect(veneered()).toHaveLength(2);
  });

  it('never decodes the veneer or holds a frame for a BAGGEBO shelf', async () => {
    const create = await scene('baggebo');
    shelf = create(layout('baggebo'));
    expect(gpu.renders).toBe(1);
    // The preloaded files are still taken, once, as the HTML asked for them.
    expect(fetch).toHaveBeenCalledTimes(2);
    for (const download of downloads) download.finish();
    await settle();
    expect(createImageBitmap).not.toHaveBeenCalled();
    expect(veneered()).toHaveLength(0);
  });

  it('paints without the veneer rather than wait for a stalled download', async () => {
    const create = await scene('walnut');
    shelf = create(layout('walnut'));
    shelf.canvas.getBoundingClientRect = () => rect(0, 60, 390, 700);
    flushFrames();
    expect(gpu.renders).toBe(0);
    clock += 3000; vi.advanceTimersByTime(3000); flushFrames();
    expect(gpu.renders).toBe(1);
  });
});
