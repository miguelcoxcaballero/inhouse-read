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
    putImageData() {}, drawImage:vi.fn(), clearRect() {}
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


const copyCalls = () => HTMLCanvasElement.prototype.getContext.mock.results.flatMap(result => result.value?.drawImage?.mock?.calls || []).length
describe('actual scene handling of pending native presses', () => {
  it('keeps semantic press and release without render, copy, lift or dirty changes', async () => {
    settle(); const renders = gpu.renders, snapshots = roomRenders(), copies = copyCalls()
    const dirty = shelf.canvas.dataset.inspectionDirtyCount
    nodes[1].classList.add('is-pressed', 'is-press-pending'); await Promise.resolve()
    expect(nodes[1].classList.contains('is-pressed')).toBe(true)
    expect(shelf.flush()).toBe(false); flushFrames()
    expect(gpu.renders).toBe(renders); expect(roomRenders()).toBe(snapshots); expect(copyCalls()).toBe(copies)
    expect(shelf.canvas.dataset.inspectionDirtyCount).toBe(dirty)
    expect(bookModel(1).userData.entry.flags.pressed).toBe(false)
    expect(bookModel(1).userData.entry.lift.target).toBe(0)
    nodes[1].classList.remove('is-pressed', 'is-press-pending'); await Promise.resolve()
    expect(shelf.flush()).toBe(false); flushFrames()
    expect(gpu.renders).toBe(renders); expect(copyCalls()).toBe(copies); expect(frames.size).toBe(0)
  })
  it('preserves the original full hold lift and settled shadow', async () => {
    settle(); const renders = gpu.renders, restSamples = gpu.key.shadow.blurSamples
    nodes[1].classList.add('is-pressed', 'is-press-pending'); await Promise.resolve()
    nodes[1].classList.remove('is-pressed', 'is-press-pending'); nodes[1].classList.add('is-lifted')
    expect(shelf.flush()).toBe(true); flushFrames()
    expect(gpu.renders).toBeGreaterThan(renders)
    expect(bookModel(1).userData.entry.lift.value).toBe(1)
    expect(gpu.key.shadow.blurSamples).toBe(restSamples)
  })
  it('preserves manual pressed behavior when only the pending marker is removed', async () => {
    settle(); nodes[1].classList.add('is-pressed', 'is-press-pending'); await Promise.resolve()
    const renders = gpu.renders
    nodes[1].classList.remove('is-press-pending'); expect(shelf.flush()).toBe(true); flushFrames()
    expect(gpu.renders).toBeGreaterThan(renders)
    expect(bookModel(1).userData.entry.flags.pressed).toBe(true)
    expect(bookModel(1).userData.entry.lift.value).toBe(.22)
  })
  it('still renders a genuine model appearance invalidation while pending', async () => {
    settle(); nodes[1].classList.add('is-pressed', 'is-press-pending'); await Promise.resolve()
    const renders = gpu.renders
    bookModel(1).userData.invalidate(); expect(shelf.flush()).toBe(true); flushFrames()
    expect(gpu.renders).toBeGreaterThan(renders); expect(bookModel(1).userData.entry.lift.value).toBe(0)
  })
  it('keeps modal deferral coherent for another book whose press is only pending', async () => {
    settle(); holdModal(); flushFrames(); const renders = gpu.renders
    nodes[1].classList.add('is-pressed', 'is-press-pending'); await Promise.resolve()
    bookModel(1).userData.invalidate(); await Promise.resolve(); flushFrames()
    expect(shelf.flush()).toBe(false); expect(gpu.renders).toBe(renders)
    expect(bookModel(1).userData.entry.lift.value).toBe(0)
    resumeModal(); expect(shelf.flush()).toBe(true); flushFrames()
    expect(gpu.renders).toBe(renders + 1)
  })
  it('keeps actual dragging authoritative even with a pending token', () => {
    settle(); const renders = gpu.renders
    nodes[1].classList.add('is-pressed', 'is-press-pending', 'is-dragging')
    expect(shelf.flush()).toBe(true); flushFrames()
    expect(gpu.renders).toBeGreaterThan(renders); expect(bookModel(1).userData.entry.lift.value).toBe(1)
  })
})
