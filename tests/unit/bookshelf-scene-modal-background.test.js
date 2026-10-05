import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { createBookshelfScene } from '../../src/js/bookshelf-scene.js';

// A frame that changes nothing must leave the DOM alone, and a frame that
// changes something must still leave it exactly as a full rewrite would.
const gpu = vi.hoisted(() => ({ scene:null, renders:0, key:null }));
vi.mock('../../src/js/book-model.js', async () => {
  const Three = await import('three');
  let ratio = 1;
  const size = new Three.Vector2();
  const renderer = { domElement:document.createElement('canvas'), shadowMap:{},
    capabilities:{ getMaxAnisotropy:() => 1 }, getPixelRatio:() => ratio,
    setPixelRatio:value => { ratio = value; }, getSize:target => target.copy(size),
    setSize:(width, height) => { size.set(width, height); }, render:scene => { gpu.scene = scene; gpu.renders++; } };
  return { getBookRenderer:() => renderer, lightBookScene(scene) { const key = new Three.DirectionalLight('#fff', 1); key.position.set(-500,700,500); scene.add(key); scene.userData.readerLight = key; gpu.key = key; },
    createBookModel(book, style, width, height, thickness, coverUrl, options = {}) {
      const model = new Three.Group(); model.name = `book:${book.id}`;
      const binding = new Three.Mesh(new Three.BoxGeometry(thickness * .38, height, thickness), new Three.MeshStandardMaterial());
      binding.name = 'binding'; binding.position.x = -width / 2 - thickness * .19; model.add(binding);
      model.userData.overview = Boolean(options.overview);
      model.userData.inspectionResolution = options.inspectionResolution || 0;
      model.userData.dispose = () => {};
      return model;
    } };
});

const originalFonts = Object.getOwnPropertyDescriptor(document, 'fonts');
let completeFonts;
let clock, frames, shelf, stage, scroller, trashNode, catalogNode, plantNode, nodes, scroll, reads, layoutData;
const rect = (left, top, width, height) => ({ left, top, width, height, right:left + width, bottom:top + height });
function flushFrames(duration = 1200) {
  const end = clock + duration;
  while (frames.size && clock < end) {
    clock += 16;
    const callbacks = [...frames.values()]; frames.clear();
    for (const callback of callbacks) callback(clock);
  }
}
const settle = () => { shelf.setMode('isometric', { animate:false }); shelf.flush(); flushFrames(); };
const styles = () => [...nodes, plantNode, trashNode, catalogNode].map(node => node.getAttribute('style'));
const covers = () => nodes.map(node => node.querySelector('[data-shelf-cover-hit]')?.getAttribute('style'));

beforeEach(() => {
  Object.defineProperty(document, 'fonts', { configurable:true, value:{ ready:new Promise(resolve => { completeFonts = resolve; }) } });
  gpu.renders = 0; clock = 0; frames = new Map(); scroll = 0; reads = { scroller:0, stage:0, canvas:0 };
  let serial = 0;
  vi.stubGlobal('requestAnimationFrame', callback => { const id = ++serial; frames.set(id, callback); return id; });
  vi.stubGlobal('cancelAnimationFrame', id => frames.delete(id));
  vi.spyOn(performance, 'now').mockImplementation(() => clock);
  vi.spyOn(THREE.TextureLoader.prototype, 'load').mockImplementation(() => new THREE.Texture());
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ({
    createImageData:(width, height) => ({ data:new Uint8ClampedArray(width * height * 4) }),
    putImageData() {}, drawImage() {}, clearRect() {}
  }));
  window.matchMedia = () => ({ matches:false });
  scroller = document.createElement('div'); stage = document.createElement('div');
  scroller.append(stage); document.body.append(scroller);
  Object.defineProperty(scroller, 'clientHeight', { configurable:true, get:() => scroller.closest('[hidden]') ? 0 : 700 });
  Object.defineProperty(scroller, 'scrollTop', { configurable:true, get:() => scroll, set:value => { scroll = Math.max(0, Number(value) || 0); } });
  scroller.getBoundingClientRect = () => { reads.scroller++; return scroller.closest('[hidden]') ? rect(0,0,0,0) : rect(20, 60, 390, 700); };
  stage.getBoundingClientRect = () => { reads.stage++; return stage.closest('[hidden]') ? rect(0,0,0,0) : rect(20, 60 - scroll, 390, parseFloat(stage.style.height) || 750); };
  trashNode = document.createElement('button'); catalogNode = document.createElement('button');
  plantNode = document.createElement('button'); plantNode.classList.add('ihr-plant'); plantNode.dataset.objectId = 'plant:fixture';
  stage.append(trashNode, catalogNode, plantNode);
  const rows = [{ top:20, bottom:220 }, { top:260, bottom:460 }, { top:500, bottom:700 }];
  nodes = Array.from({ length:12 }, (_, index) => {
    const node = document.createElement('button'); node.classList.add('ihr-spine'); node.dataset.bookId = String(index); stage.append(node);
    return node;
  });
  const books = nodes.map((node, index) => ({ node, book:{ id:String(index), title:`Book ${index}`, author:'Author' },
    style:{ color:'#41694f', width:28 }, x:50 + index % 4 * 70, y:rows[Math.floor(index / 4)].bottom - 90, width:100, height:180, thickness:28 }));
  const plant = { kind:'plant', node:plantNode, key:'plant:fixture', seed:'fixture', variant:'monstera', catalogId:'monstera', potId:'muskot',
    x:90, y:165, width:86, height:110 };
  layoutData = { stage, scroller, width:390, sceneWidth:390, height:750, rows, trashNode, catalogNode, entries:[...books, plant] };
  shelf = createBookshelfScene(layoutData);
  shelf.canvas.getBoundingClientRect = () => { reads.canvas++; return shelf.canvas.closest('[hidden]') ? rect(0,0,0,0) : rect(20, 60, 390, 700); };
  shelf.flush(); flushFrames();
});

afterEach(() => {
  shelf?.dispose(); shelf = null; document.body.innerHTML = '';
  if (originalFonts) Object.defineProperty(document, 'fonts', originalFonts); else delete document.fonts;
  vi.restoreAllMocks(); vi.unstubAllGlobals();
});

// New unit contracts. The fixture comes from exact Git56 frame-cost tests;
// this file neither substitutes animation clocks in runtime nor measures GPU.
const roomRenders = () => Number(shelf.canvas.dataset.snapshotRenderCount);
const bookModel = index => gpu.scene.getObjectByName(`book:${index}`);
function holdModal(index = 0) {
  nodes[index].classList.add('is-away');
  shelf.flush();
  shelf.setModalBackgroundDeferred?.(nodes[index]);
  return bookModel(index);
}
const resumeModal = () => shelf.setModalBackgroundDeferred?.(null);

describe('stationary room paints while a selected flyout owns its book', () => {

  it('retains the actual hidden Home room through direct layout refresh and resumes its latest records visibly', () => {
    const home = document.createElement('section'); home.className = 'screen';
    scroller.replaceWith(home); home.append(scroller);
    settle(); const selected = holdModal(), neighbor = bookModel(1);
    const renders = gpu.renders, snapshots = roomRenders();
    const backing = [shelf.canvas.width, shelf.canvas.height];
    home.hidden = true; shelf.setPresentationActive(false); resumeModal();
    expect(scroller.closest('[hidden]')).toBe(home); expect(scroller.clientHeight).toBe(0);
    expect(scroller.getBoundingClientRect()).toEqual(rect(0,0,0,0));
    expect(stage.getBoundingClientRect()).toEqual(rect(0,0,0,0));
    expect(shelf.canvas.getBoundingClientRect()).toEqual(rect(0,0,0,0));
    const entries = layoutData.entries.map(entry => entry.node === nodes[1]
      ? { ...entry, book:{ ...entry.book, title:'Latest hidden Home title' } } : entry);
    expect(shelf.updateLayout({ ...layoutData, entries })).toBe(true);
    shelf.invalidate(); expect(shelf.flush()).toBe(false); flushFrames();
    expect(gpu.renders).toBe(renders); expect(roomRenders()).toBe(snapshots);
    expect([shelf.canvas.width,shelf.canvas.height]).toEqual(backing);
    expect(bookModel(0)).toBe(selected); expect(bookModel(1)).toBe(neighbor);
    shelf.setModalBackgroundDeferred?.(null, { resumeHidden:true }); shelf.setPaintHeld(true);
    home.hidden = false; shelf.setPresentationActive(true); shelf.setPaintHeld(false);
    expect(shelf.flush()).toBe(true); flushFrames();
    expect(gpu.renders).toBe(renders + 1); expect(roomRenders()).toBe(snapshots + 1);
    expect(bookModel(1).userData.entry.book.title).toBe('Latest hidden Home title');
    expect([shelf.canvas.width,shelf.canvas.height]).toEqual(backing);
    expect(bookModel(0)).toBe(selected); expect(selected.visible).toBe(false);
  });

  it('retains the committed empty slot and coalesces visible-neighbor texture notifications on resume', async () => {
    settle();
    const selected = holdModal(), neighbor = bookModel(1);
    flushFrames();
    const renders = gpu.renders, snapshots = roomRenders(), ratio = shelf.canvas.dataset.pixelRatio;
    neighbor.userData.invalidate(); neighbor.userData.invalidate();
    await Promise.resolve(); flushFrames();
    expect(shelf.flush()).toBe(false);
    expect(gpu.renders).toBe(renders); expect(roomRenders()).toBe(snapshots);
    expect(selected.visible).toBe(false); expect(frames.size).toBe(0);
    resumeModal(); expect(shelf.flush()).toBe(true); flushFrames();
    expect(gpu.renders).toBe(renders + 1); expect(roomRenders()).toBe(snapshots + 1);
    expect(bookModel(0)).toBe(selected); expect(bookModel(1)).toBe(neighbor);
    expect(shelf.canvas.dataset.pixelRatio).toBe(ratio); expect(shelf.flush()).toBe(false);
  });

  it('does not let only the selected hidden pressure lift demand room renders', async () => {
    nodes[0].classList.add('is-pressed'); shelf.flush();
    clock += 16; shelf.flush();
    const selected = holdModal();
    expect(selected.userData.entry.lift.value).toBeLessThan(.22);
    const renders = gpu.renders;
    bookModel(1).userData.invalidate(); await Promise.resolve(); flushFrames();
    expect(gpu.renders).toBe(renders); expect(frames.size).toBe(0);
    clock += 200; resumeModal(); shelf.flush(); flushFrames();
    expect(selected.userData.entry.lift.value).toBe(.22);
    expect(selected.visible).toBe(false);
  });

  it('keeps actual prepared plant maps pending and applies them once at the same quality on resume', async () => {
    settle();
    let plant;
    gpu.scene.traverse(object => { if (object.userData.shelfPlantKeys) plant = object; });
    let finish;
    const plan = { ready:new Promise(resolve => { finish = resolve; }),
      apply:vi.fn(() => { plant.userData.inspectionResolution = 256; }), dispose:vi.fn() };
    vi.spyOn(plant.userData, 'prepareSurfaceQuality').mockReturnValue(plan);
    shelf.setInspectionView({ zoom:1.5, panX:0, panY:0 }); shelf.flush(); flushFrames();
    expect(plant.userData.entry.plantQuality?.resolution).toBe(256);
    const geometry = plant.getObjectByName('leaf-0').geometry;
    holdModal(); const renders = gpu.renders, snapshots = roomRenders();
    finish(true); await Promise.resolve(); flushFrames();
    expect(gpu.renders).toBe(renders); expect(roomRenders()).toBe(snapshots);
    expect(plan.apply).not.toHaveBeenCalled(); expect(plan.dispose).not.toHaveBeenCalled();
    resumeModal(); shelf.flush(); flushFrames();
    expect(plan.apply).toHaveBeenCalledOnce(); expect(plan.dispose).toHaveBeenCalledOnce();
    expect(plant.userData.inspectionResolution).toBe(256);
    expect(plant.getObjectByName('leaf-0').geometry).toBe(geometry);
    expect(gpu.renders).toBe(renders + 1);
  });

  it('retains the latest visible book records for the resumed paint', async () => {
    settle(); holdModal();
    const renders = gpu.renders, neighbor = bookModel(1), entry = layoutData.entries[1];
    shelf.updateEntry(nodes[1], { ...entry.book, title:'First pending title' }, entry.style, undefined);
    shelf.updateEntry(nodes[1], { ...entry.book, title:'Latest pending title' }, entry.style, undefined);
    await Promise.resolve(); flushFrames(); expect(gpu.renders).toBe(renders);
    resumeModal(); shelf.flush(); flushFrames();
    expect(neighbor.userData.entry.book.title).toBe('Latest pending title');
    expect(bookModel(1).userData.entry.book.title).toBe('Latest pending title');
    expect(gpu.renders).toBe(renders + 1);
  });

  it('retains actual font-readiness work without painting the stationary modal background', async () => {
    settle(); holdModal(); const renders = gpu.renders;
    completeFonts(); await Promise.resolve(); flushFrames();
    expect(shelf.canvas.dataset.inspectionDirtySource).toBe('fonts-ready');
    expect(gpu.renders).toBe(renders); expect(frames.size).toBe(0);
    resumeModal(); shelf.flush(); flushFrames(); expect(gpu.renders).toBe(renders + 1);
  });

  it('composes modal deferral with inactive home presentation without reactivating it', () => {
    settle(); nodes[0].classList.add('is-pressed'); shelf.flush();
    clock += 16; shelf.flush(); holdModal(); const renders = gpu.renders;
    shelf.setPresentationActive(false); shelf.invalidate();
    resumeModal(); expect(shelf.flush()).toBe(false); expect(frames.size).toBe(0);
    expect(gpu.renders).toBe(renders);
    clock += 200; shelf.setPresentationActive(true); expect(shelf.flush()).toBe(true); flushFrames();
    expect(gpu.renders).toBe(renders + 1);
  });

  it('explicit return preparation can acquire a room previously released into inactive home', () => {
    settle(); holdModal(); const renders = gpu.renders;
    shelf.setPresentationActive(false); shelf.invalidate(); resumeModal();
    expect(shelf.flush()).toBe(false);
    shelf.setModalBackgroundDeferred?.(null, { resumeHidden:true });
    shelf.setPaintHeld(true); expect(frames.size).toBe(0);
    shelf.setPresentationActive(true); shelf.setPaintHeld(false);
    expect(shelf.flush()).toBe(true); flushFrames(); expect(gpu.renders).toBe(renders + 1);
  });

  it('reprojects a changed viewport through the original room paint while the modal is open', () => {
    settle(); shelf.setMode('spine', { animate:false }); shelf.flush(); flushFrames();
    holdModal(); const renders = gpu.renders;
    const before = shelf.getBookPose(nodes[0]);
    scroller.scrollTop = 40; scroller.dispatchEvent(new Event('scroll'));
    shelf.flush(); flushFrames();
    expect(gpu.renders).toBeGreaterThan(renders);
    expect(shelf.getBookPose(nodes[0]).centerY).toBeCloseTo(before.centerY - 40, 5);
    expect(bookModel(0).visible).toBe(false);
    const current = gpu.renders; bookModel(1).userData.invalidate(); flushFrames();
    expect(gpu.renders).toBe(current);
  });

  it('allows an explicit force flush to commit the complete original room', () => {
    settle(); holdModal(); const renders = gpu.renders;
    shelf.invalidate(); expect(shelf.flush({ force:true })).toBe(true); flushFrames();
    expect(gpu.renders).toBe(renders + 1); expect(bookModel(0).visible).toBe(false);
  });

  it('admits settled inspection changes and an instantaneous camera-mode change before new rectangles exist', () => {
    settle(); holdModal(); const renders = gpu.renders;
    const before = shelf.getBookPose(nodes[0]);
    shelf.setInspectionView({ zoom:1.5, panX:0, panY:0 }); shelf.flush(); flushFrames();
    expect(gpu.renders).toBe(renders + 1);
    expect(shelf.getBookPose(nodes[0]).scale).toBeCloseTo(before.scale * 1.5, 5);
    shelf.setMode('spine', { animate:false }); shelf.flush(); flushFrames();
    expect(gpu.renders).toBe(renders + 2); expect(shelf.canvas.dataset.viewProgress).toBe('0');
    expect(bookModel(0).visible).toBe(false);
  });

  it('preserves actual camera frames and their endpoint while a selected slot is deferred', () => {
    settle(); holdModal(); shelf.setMode('spine');
    const poses = [];
    while (frames.size && poses.length < 100) {
      clock += 16; const callbacks = [...frames.values()]; frames.clear();
      for (const callback of callbacks) callback(clock);
      poses.push(Number(shelf.canvas.dataset.viewProgress));
    }
    expect(poses.filter(value => value > 0 && value < 1).length).toBeGreaterThan(3);
    expect(shelf.canvas.dataset.viewProgress).toBe('0');
    expect(shelf.canvas.dataset.animating).toBe('false'); expect(frames.size).toBe(0);
  });

  it('allows actual insertion ownership, depth frames and completion', async () => {
    settle(); holdModal(); const renders = gpu.renders;
    const insertion = shelf.returnBook(nodes[0], { duration:180 });
    expect(insertion).not.toBeNull(); flushFrames(); await insertion.finished;
    expect(gpu.renders).toBeGreaterThan(renders);
    expect(shelf.canvas.dataset.returnProgress).toBe('1.0000');
    resumeModal(); nodes[0].classList.remove('is-away'); shelf.flush(); flushFrames();
    expect(bookModel(0).visible).toBe(true);
  });

  it('allows a real neighbor trash drop and resolves its final paint', async () => {
    settle(); holdModal(); const renders = gpu.renders;
    const drop = shelf.animateBookToTrash(nodes[1], { duration:180 });
    expect(drop).not.toBeNull(); flushFrames(); await drop.finished;
    expect(gpu.renders).toBeGreaterThan(renders);
    expect(bookModel(1).visible).toBe(false);
  });

  it('finishes the original full-quality shadow after another visible lift settles', () => {
    settle(); const restSamples = gpu.key.shadow.blurSamples;
    nodes[1].classList.add('is-pressed'); shelf.flush();
    expect(gpu.key.shadow.blurSamples).toBeLessThan(restSamples);
    holdModal(); const renders = gpu.renders; flushFrames();
    expect(gpu.renders).toBeGreaterThan(renders);
    expect(gpu.key.shadow.blurSamples).toBe(restSamples); expect(frames.size).toBe(0);
    const settled = gpu.renders; bookModel(1).userData.invalidate(); flushFrames();
    expect(gpu.renders).toBe(settled);
  });

  it('cannot defer the initial empty slot merely because a held flush returned true', () => {
    settle(); const renders = gpu.renders, snapshots = roomRenders();
    shelf.setPaintHeld(true); nodes[0].classList.add('is-away');
    expect(shelf.flush()).toBe(true); expect(roomRenders()).toBe(snapshots);
    shelf.setModalBackgroundDeferred?.(nodes[0]);
    shelf.setPaintHeld(false); expect(shelf.flush()).toBe(true); flushFrames();
    expect(gpu.renders).toBe(renders + 1); expect(roomRenders()).toBe(snapshots + 1);
    const committed = gpu.renders; bookModel(1).userData.invalidate(); flushFrames();
    expect(gpu.renders).toBe(committed);
  });

  it('clears deferred work on dispose and ignores a late quality notification', async () => {
    settle(); holdModal(); const neighbor = bookModel(1), renders = gpu.renders;
    shelf.invalidate(); shelf.dispose(); shelf = null;
    neighbor.userData.invalidate(); await Promise.resolve();
    expect(frames.size).toBe(0); expect(gpu.renders).toBe(renders);
  });
});
