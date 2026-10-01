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
    createBookModel(book, style, width, height, thickness, coverUrl, options={}) {
      const model = new Three.Group(); model.name = `book:${book.id}`;
      model.add(new Three.Mesh(new Three.BoxGeometry(width, height, thickness), new Three.MeshStandardMaterial()));
      model.userData.overview = Boolean(options.overview);
      model.userData.inspectionResolution = options.inspectionResolution || 0;
      model.userData.updateSpineAppearance = vi.fn();
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
  it('updates only the existing binding when its saved surface finish changes', () => {
    gpu.passes = []; shelf.invalidate(); flushFrames();
    const model = gpu.passes.at(-1).meshes.find(({ object }) => object.parent?.name === 'book:30').object.parent;
    const creations = shelf.canvas.dataset.modelCreations;
    const update = model.userData.updateSpineAppearance;
    const book = { id:'30', title:'Book 30', author:'Author', spineSurfaceFinish:'glossy' };
    const style = { color:'#41694f', width:28 };
    shelf.updateEntry(nodes[30], book, style); flushFrames();
    expect(update).toHaveBeenCalledExactlyOnceWith(book, style);
    expect(shelf.canvas.dataset.modelCreations).toBe(creations);
    shelf.updateEntry(nodes[30], { ...book }, { ...style }); flushFrames();
    expect(update).toHaveBeenCalledTimes(1);
    const matte = { ...book, spineSurfaceFinish:'matte' };
    shelf.updateEntry(nodes[30], matte, style); flushFrames();
    expect(update).toHaveBeenLastCalledWith(matte, style);
    expect(update).toHaveBeenCalledTimes(2);
    expect(shelf.canvas.dataset.modelCreations).toBe(creations);
    expect(frames.size).toBe(0);
    gpu.passes = null;
  });

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
  it('zooms without extending the fitted stage and resets its pan in frontal view', () => {
    shelf.setMode('isometric',{animate:false}); flushFrames();
    const canvas = stage.querySelector('canvas'), height = stage.style.height;
    const scale = Number(canvas.dataset.zoom);
    expect(shelf.zoomTo(2)).toBe(2); flushFrames();
    expect(Number(canvas.dataset.zoom)).toBeCloseTo(scale*2,3);
    expect(stage.style.height).toBe(height);
    shelf.panBy(100000,-100000); flushFrames();
    const pan = JSON.parse(canvas.dataset.inspectionPan);
    expect(Math.abs(pan[0])).toBeLessThanOrEqual(195);
    expect(Math.abs(pan[1])).toBeLessThanOrEqual(Number(canvas.dataset.sceneFitHeight)/2);
    expect(shelf.zoomTo(10)).toBe(4); flushFrames();
    shelf.setMode('spine',{animate:false}); flushFrames();
    expect(shelf.getInspectionZoom()).toBe(1);
    expect(JSON.parse(canvas.dataset.inspectionPan)).toEqual([0,0]);
  });

  it('renders finger zoom and pan immediately while retaining full-quality shadow textures', async () => {
    shelf.setMode('isometric',{animate:false}); flushFrames();
    await Promise.resolve(); flushFrames();
    gpu.samples=[];
    const movingSamples = gpu.key.shadow.blurSamples;
    const view=shelf.getInspectionView();
    const zoomed=shelf.setInspectionView({...view,zoom:2,panX:240,panY:0},{moving:true,renderNow:true});
    const canvas=stage.querySelector('canvas');
    expect(canvas.dataset.inspectionMoving).toBe('true');
    expect(canvas.dataset.animating).toBe('true');
    expect(zoomed.panX).toBe(240); // elastic slack beyond the 195 px resting edge
    shelf.setInspectionView({...zoomed,zoom:2.2,panX:180},{moving:true,renderNow:true});
    expect(gpu.samples).toHaveLength(0);
    expect(gpu.key.shadow.blurSamples).toBe(movingSamples);
    shelf.setInspectionView(zoomed,{moving:false,renderNow:true});
    expect(shelf.getInspectionView().panX).toBe(195);
    expect(canvas.dataset.inspectionMoving).toBe('false');
    expect(gpu.samples.at(-1)[0]).toBe(movingSamples);
    gpu.samples=null;
  });

  it('composites sixty inspection frames without drawing or copying the unchanged 3D room', async () => {
    shelf.setMode('isometric',{animate:false}); flushFrames();
    await Promise.resolve(); flushFrames();
    gpu.samples=[]; gpu.renderer.shadowMap.needsUpdate=false;
    const view=shelf.getInspectionView(), models=shelf.canvas.dataset.modelCreations;
    const logicalBounds = shelf.canvas.getBoundingClientRect();
    for(let index=0;index<60;index++) {
      shelf.setInspectionView({...view,zoom:1+index/300,panX:index/20,panY:index/30},{moving:true,renderNow:true});
    }
    expect(shelf.canvas.dataset.modelCreations).toBe(models);
    expect(gpu.samples).toHaveLength(0);
    expect(shelf.canvas.dataset.inspectionCompositorFrames).toBe('60');
    expect(shelf.canvas.dataset.inspectionCacheActive).toBe('true');
    expect(shelf.canvas.style.visibility).toBe('hidden');
    expect(shelf.canvas.getBoundingClientRect()).toEqual(logicalBounds);
    expect(stage.querySelector('.ihr-bookshelf-inspection-snapshot').style.transform).toMatch(/^matrix\(/);
    expect(shelf.getInspectionView().centerX).toBe(view.centerX);
    expect(shelf.getInspectionView().centerY).toBe(view.centerY);
    shelf.invalidate(); flushFrames();
    expect(gpu.samples.some(([,redraw])=>redraw)).toBe(true);
    expect(shelf.canvas.style.visibility).toBe('');
    expect(shelf.canvas.dataset.inspectionCacheActive).toBe('false');
    gpu.samples=null;
  });

  it('keeps a complete backdrop beyond the detailed tile and restores sharp native bounds at rest', async () => {
    shelf.setMode('isometric',{animate:false}); flushFrames();
    await Promise.resolve(); flushFrames();
    const view = shelf.getInspectionView();
    shelf.setInspectionView({...view,zoom:2,panX:0,panY:0},{moving:false,renderNow:true});
    await Promise.resolve(); flushFrames();
    const detailed = stage.querySelector('.ihr-bookshelf-inspection-snapshot');
    const overview = stage.querySelector('.ihr-bookshelf-inspection-overview');
    const dimensions = [detailed.width, detailed.height, overview.width, overview.height];
    gpu.samples = [];
    // Cross the overscan in both directions, then magnify far past the tile's
    // own resolution. The fitted backdrop still includes every revealed row.
    for (let i = 0; i < 30; i++) {
      shelf.setInspectionView({...view,zoom:2+i/20,panX:i*8,panY:i*6},{moving:true,renderNow:true});
      expect(detailed.style.display).toBe('block');
      expect(overview.style.display).toBe('block');
    }
    expect(gpu.samples).toHaveLength(0);
    expect([detailed.width, detailed.height, overview.width, overview.height]).toEqual(dimensions);
    shelf.setInspectionView({...shelf.getInspectionView(),panX:100000},{moving:false,renderNow:true});
    expect(gpu.samples).toHaveLength(1);
    expect(detailed.style.display).toBe('none');
    expect(overview.style.display).toBe('none');
    expect(shelf.canvas.style.visibility).toBe('');
    expect(shelf.getInspectionView().panX).toBeCloseTo((shelf.getInspectionZoom()-1)*view.width/2);
    expect(shelf.canvas.width).toBe(Math.ceil(view.width*Number(shelf.canvas.dataset.pixelRatio)));
    gpu.samples = null;
  });

  it('keeps drag picking and unchanged drop guides inside the one demand frame', async () => {
    shelf.setMode('isometric',{animate:false}); flushFrames();
    await Promise.resolve(); flushFrames();
    gpu.samples = [];
    shelf.invalidate();
    const pending = frames.size;
    for (let i = 0; i < 20; i++) shelf.getDropPosition(120+i,280);
    expect(gpu.samples).toHaveLength(0);
    expect(frames.size).toBe(pending);
    flushFrames();
    shelf.setDropPosition({shelf:2,x:.5}); flushFrames();
    gpu.samples = [];
    shelf.setDropPosition({shelf:2,x:.5});
    expect(frames.size).toBe(0);
    shelf.setDropPosition({shelf:2,x:.6}); flushFrames();
    expect(gpu.samples).toHaveLength(1);
    expect(gpu.samples[0][1]).toBe(false);
    gpu.samples = null;
  });

  it('turns an already painted pressure frame into a pinch without repeated GPU lift frames', async () => {
    shelf.setMode('isometric',{animate:false}); flushFrames();
    await Promise.resolve(); flushFrames();
    // The first finger lands on a real native book, one display frame before
    // the second. Its visual pressure has started when navigation cancels it.
    nodes[30].classList.add('is-pressed'); await Promise.resolve(); flushFrames(16);
    expect(shelf.canvas.dataset.animating).toBe('true');
    nodes[30].classList.remove('is-pressed');
    shelf.beginInspectionGesture();
    gpu.samples = [];
    const view = shelf.getInspectionView();
    for (let i = 0; i < 10; i++) shelf.setInspectionView({...view,zoom:1.1+i/20,panX:i*2},{moving:true,renderNow:true});
    await Promise.resolve();
    expect(gpu.samples).toHaveLength(0);
    expect(frames.size).toBe(0);
    expect(shelf.canvas.dataset.inspectionCacheActive).toBe('true');
    expect(stage.querySelector('.ihr-bookshelf-inspection-overview').style.display).toBe('block');
    shelf.setInspectionView(shelf.getInspectionView(),{moving:false,renderNow:true});
    expect(gpu.samples).toHaveLength(1);
    expect(nodes[30].classList.contains('is-pressed')).toBe(false);
    expect(shelf.canvas.dataset.animating).toBe('false');
    gpu.samples = null;
  });

  it('defers same-artwork texture notifications until a gesture settles', async () => {
    gpu.passes = [];
    shelf.setMode('isometric',{animate:false}); flushFrames();
    await Promise.resolve(); flushFrames();
    const model = gpu.passes.at(-1).meshes.find(({ object }) => /^book:/.test(object.parent?.name)).object.parent;
    const view = shelf.getInspectionView();
    shelf.setInspectionView({...view,zoom:2},{moving:true,renderNow:true});
    gpu.samples = [];
    for (let i = 0; i < 20; i++) {
      model.userData.invalidate();
      shelf.setInspectionView({...view,zoom:2+i/30,panX:i*3},{moving:true,renderNow:true});
    }
    expect(gpu.samples).toHaveLength(0);
    expect(frames.size).toBe(0);
    shelf.setInspectionView(shelf.getInspectionView(),{moving:false,renderNow:true});
    expect(gpu.samples).toHaveLength(1);
    expect(shelf.canvas.dataset.inspectionCacheActive).toBe('false');
    gpu.samples = gpu.passes = null;
  });

  it('commits twenty background book analyses together after finger movement', async () => {
    gpu.passes = [];
    shelf.setMode('isometric',{animate:false}); flushFrames();
    await Promise.resolve(); flushFrames();
    const models = new Map(gpu.passes.at(-1).meshes.filter(({ object }) => /^book:/.test(object.parent?.name))
      .map(({ object }) => [object.parent.name, object.parent]));
    const view = shelf.getInspectionView();
    shelf.beginInspectionGesture();
    shelf.setInspectionView({...view,zoom:2},{moving:true,renderNow:true});
    gpu.samples = [];
    for (let i = 0; i < 20; i++) {
      const id = String(30+i), book = {id,title:`Book ${id}`,author:'Author',spineSurfaceFinish:'glossy'};
      const style = {color:'#abcdef',width:28};
      if (i === 19) Object.assign(style,{width:45,heightRatio:1.1});
      shelf.updateEntry(nodes[30+i],book,style);
      shelf.setInspectionView({...view,zoom:2,panX:i*3},{moving:true,renderNow:true});
    }
    expect(gpu.samples).toHaveLength(0);
    expect(shelf.canvas.dataset.inspectionPendingEntries).toBe('20');
    for (let i = 30; i < 49; i++) expect(models.get(`book:${i}`).userData.updateSpineAppearance).not.toHaveBeenCalled();
    shelf.setInspectionView(shelf.getInspectionView(),{moving:false,renderNow:true});
    expect(gpu.samples).toHaveLength(1);
    expect(shelf.canvas.dataset.inspectionPendingEntries).toBe('0');
    for (let i = 30; i < 49; i++) {
      expect(models.get(`book:${i}`).userData.updateSpineAppearance).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({id:String(i),spineSurfaceFinish:'glossy'}),expect.objectContaining({color:'#abcdef'}));
    }
    await Promise.resolve(); flushFrames();
    const resized = gpu.passes.at(-1).meshes.find(({ object }) => object.parent?.name === 'book:49').object;
    expect(resized.geometry.parameters.width).toBeCloseTo(110);
    expect(resized.geometry.parameters.height).toBeCloseTo(198);
    expect(resized.geometry.parameters.depth).toBe(45);
    gpu.samples = gpu.passes = null;
  });

});
