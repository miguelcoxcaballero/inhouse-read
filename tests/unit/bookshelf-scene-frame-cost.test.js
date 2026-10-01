import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { createBookshelfScene } from '../../src/js/bookshelf-scene.js';

// A frame that changes nothing must leave the DOM alone, and a frame that
// changes something must still leave it exactly as a full rewrite would.
const gpu = vi.hoisted(() => ({ scene:null }));
vi.mock('../../src/js/book-model.js', async () => {
  const Three = await import('three');
  let ratio = 1;
  const size = new Three.Vector2();
  const renderer = { domElement:document.createElement('canvas'), shadowMap:{},
    capabilities:{ getMaxAnisotropy:() => 1 }, getPixelRatio:() => ratio,
    setPixelRatio:value => { ratio = value; }, getSize:target => target.copy(size),
    setSize:(width, height) => { size.set(width, height); }, render:scene => { gpu.scene = scene; } };
  return { getBookRenderer:() => renderer, lightBookScene() {},
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

let clock, frames, shelf, stage, scroller, trashNode, catalogNode, plantNode, nodes, scroll, reads;
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
  clock = 0; frames = new Map(); scroll = 0; reads = { scroller:0, stage:0, canvas:0 };
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
  Object.defineProperty(scroller, 'clientHeight', { value:700 });
  Object.defineProperty(scroller, 'scrollTop', { configurable:true, get:() => scroll, set:value => { scroll = Math.max(0, Number(value) || 0); } });
  scroller.getBoundingClientRect = () => { reads.scroller++; return rect(20, 60, 390, 700); };
  stage.getBoundingClientRect = () => { reads.stage++; return rect(20, 60 - scroll, 390, parseFloat(stage.style.height) || 750); };
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
  shelf = createBookshelfScene({ stage, scroller, width:390, sceneWidth:390, height:750, rows, trashNode, catalogNode, entries:[...books, plant] });
  shelf.canvas.getBoundingClientRect = () => { reads.canvas++; return rect(20, 60, 390, 700); };
  shelf.flush(); flushFrames();
});

afterEach(() => {
  shelf?.dispose(); shelf = null; document.body.innerHTML = '';
  vi.restoreAllMocks(); vi.unstubAllGlobals();
});

describe('per-frame cost of the retained shelf scene', () => {
  it('restyles no semantic node, canvas style or foliage when a redraw moves nothing', () => {
    settle();
    const svg = plantNode.querySelector('.ihr-plant-foliage');
    expect(svg).not.toBeNull();
    const observer = new MutationObserver(() => {});
    observer.observe(stage, { attributes:true, subtree:true });
    for (let index = 0; index < 3; index++) { shelf.invalidate(); flushFrames(); }
    const written = observer.takeRecords().map(record => `${record.target === shelf.canvas ? 'canvas' : record.target.tagName}:${record.attributeName}`);
    observer.disconnect();
    // Only the counters of the invalidations and renders tell frames were drawn.
    expect([...new Set(written)].sort()).toEqual(['canvas:data-inspection-dirty-count', 'canvas:data-render-count',
      'canvas:data-snapshot-render-count']);
  });

  it('writes the identical inline geometry again after a move and its undoing', () => {
    settle();
    const before = styles(), coversBefore = covers();
    expect(before.every(style => /left: .*top: .*width: .*height: /.test(style))).toBe(true);
    shelf.zoomTo(2.2); shelf.flush(); flushFrames();
    expect(styles()).not.toEqual(before);
    expect(covers()).not.toEqual(coversBefore);
    shelf.zoomTo(1); shelf.flush(); flushFrames();
    expect(styles()).toEqual(before);
    expect(covers()).toEqual(coversBefore);
  });

  it('keeps the constant inline values and diagnostics of every node written', () => {
    for (const node of nodes) {
      expect(node.style.position).toBe('absolute'); expect(node.style.margin).toBe('0px');
      expect(node.dataset.sceneProjected).toBe('true'); expect(node.dataset.sceneHitSurface).toBe('spine');
      const cover = node.querySelector('[data-shelf-cover-hit]');
      expect(cover.style.position).toBe('absolute'); expect(cover.style.background).toBe('transparent');
      expect(cover.style.pointerEvents).toBe('inherit'); expect(cover.style.display).toBe('none');
    }
    expect(plantNode.dataset.sceneHitSurface).toBe('pot');
    settle();
    expect(nodes[0].querySelector('[data-shelf-cover-hit]').style.display).toBe('block');
    expect(trashNode.style.position).toBe('absolute'); expect(trashNode.style.zIndex).toBe('50');
    expect(trashNode.dataset.trash3d).toBe('true'); expect(shelf.canvas.dataset.trash3d).toBe('true');
    expect(catalogNode.style.margin).toBe('0px'); expect(catalogNode.dataset.catalog3d).toBe('true');
  });

  it('rereads class and drag variables only for nodes that changed, including a change drawn before the observer ran', async () => {
    settle();
    const contains = vi.spyOn(DOMTokenList.prototype, 'contains');
    const dragReads = vi.spyOn(CSSStyleDeclaration.prototype, 'getPropertyValue');
    for (let index = 0; index < 3; index++) { shelf.invalidate(); flushFrames(); }
    expect(dragReads.mock.calls.filter(([name]) => String(name).startsWith('--ihr-drag'))).toHaveLength(0);
    expect(contains.mock.calls.filter(([name]) => String(name).startsWith('is-'))).toHaveLength(0);
    const model = () => gpu.scene.getObjectByName('book:5');
    expect(model().visible).toBe(true);
    // Synchronous draw straight after the write: the observer has not run yet.
    nodes[5].classList.add('is-away'); shelf.flush();
    expect(model().visible).toBe(false);
    await Promise.resolve(); flushFrames();
    expect(model().visible).toBe(false);
    nodes[5].classList.remove('is-away'); await Promise.resolve(); flushFrames();
    expect(model().visible).toBe(true);
    // A drag moves only the held book, through its drag variables.
    const others = nodes.filter((_, index) => index !== 6).map(node => node.getAttribute('style'));
    const held = nodes[6].style.left;
    nodes[6].classList.add('is-dragging');
    nodes[6].style.setProperty('--ihr-drag-x', '40px'); nodes[6].style.setProperty('--ihr-drag-y', '-30px');
    await Promise.resolve(); flushFrames();
    expect(nodes[6].style.left).not.toBe(held);
    expect(nodes.filter((_, index) => index !== 6).map(node => node.getAttribute('style'))).toEqual(others);
    expect(nodes[6].querySelector('[data-shelf-cover-hit]').style.pointerEvents).toBe('none');
    nodes[6].classList.remove('is-dragging');
    nodes[6].style.removeProperty('--ihr-drag-x'); nodes[6].style.removeProperty('--ihr-drag-y');
    await Promise.resolve(); flushFrames();
    expect(nodes[6].style.left).toBe(held);
    expect(nodes[6].querySelector('[data-shelf-cover-hit]').style.pointerEvents).toBe('inherit');
  });

  it('finds each hit surface by name once per model, not on every frame', () => {
    settle();
    const lookups = vi.spyOn(THREE.Object3D.prototype, 'getObjectByName');
    for (let index = 0; index < 3; index++) { shelf.invalidate(); flushFrames(); }
    expect(lookups).not.toHaveBeenCalled();
  });

  it('reads the stage, scroller and canvas rectangles once per draw, before the nodes are restyled', () => {
    settle();
    reads.scroller = reads.stage = reads.canvas = 0;
    shelf.flush();
    // Fit measurement and viewport each look at the stage and scroller; the
    // trash, catalogue and snapshot reuse that frame's layout.
    expect(reads).toEqual({ scroller:2, stage:2, canvas:1 });
  });

  it('rebuilds the foliage clip only when a rectangle it depends on moved, and restores it exactly', async () => {
    settle();
    const clip = () => plantNode.querySelector('clipPath path').getAttribute('d');
    const withBooks = clip();
    expect(withBooks.match(/M/g).length).toBeGreaterThan(1);
    shelf.invalidate(); flushFrames();
    expect(clip()).toBe(withBooks);
    // Every neighbour overlapping the plant stops excluding its area while held.
    const overlapping = nodes.filter(node => parseFloat(node.style.left) < parseFloat(plantNode.style.left) + parseFloat(plantNode.style.width) &&
      parseFloat(node.style.left) + parseFloat(node.style.width) > parseFloat(plantNode.style.left));
    expect(overlapping.length).toBeGreaterThan(0);
    for (const node of overlapping) node.classList.add('is-dragging');
    await Promise.resolve(); flushFrames();
    expect(clip()).not.toBe(withBooks);
    for (const node of overlapping) node.classList.remove('is-dragging');
    await Promise.resolve(); flushFrames();
    expect(clip()).toBe(withBooks);
  });

  it('reports the texture resolutions of the painted books again when one changes', () => {
    settle();
    const painted = shelf.canvas.dataset.activeBooks;
    const resolutions = () => JSON.parse(shelf.canvas.dataset.bookTextureResolutions);
    expect(resolutions()).toHaveLength(Number(painted));
    expect(resolutions().every(value => value === 0)).toBe(true);
    shelf.zoomTo(3); shelf.flush(); flushFrames();
    const zoomed = resolutions();
    expect(zoomed.length).toBeGreaterThan(0);
    shelf.zoomTo(1); shelf.flush(); flushFrames();
    expect(shelf.canvas.dataset.highResolutionBooks).toBe(String(resolutions().filter(Boolean).length));
    expect(Number(shelf.canvas.dataset.overviewBooks) + Number(shelf.canvas.dataset.detailedBooks)).toBe(Number(painted));
  });
});
