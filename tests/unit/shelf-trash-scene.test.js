import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { createBookshelfScene } from '../../src/js/bookshelf-scene.js';

const gpu = vi.hoisted(() => ({ renders:0, scene:null, models:[], disposed:0 }));
vi.mock('../../src/js/book-model.js', async () => {
  const Three = await import('three');
  let ratio = 1, size = new Three.Vector2();
  const renderer = { domElement:document.createElement('canvas'), shadowMap:{},
    capabilities:{ getMaxAnisotropy:() => 1 }, getPixelRatio:() => ratio,
    setPixelRatio:value => { ratio = value; }, getSize:target => target.copy(size),
    setSize:(width, height) => { size.set(width, height); },
    render:scene => { gpu.renders++; gpu.scene = scene; } };
  return { getBookRenderer:() => renderer, lightBookScene() {},
    createBookModel(book, style, width, height, thickness) {
      const model = new Three.Group(); model.name = `book:${book.id}`;
      model.add(new Three.Mesh(new Three.BoxGeometry(width, height, thickness), new Three.MeshStandardMaterial()));
      const binding = new Three.Mesh(new Three.BoxGeometry(thickness * .38, height, thickness), new Three.MeshStandardMaterial());
      binding.name = 'binding'; binding.position.x = -width / 2 - thickness * .19; model.add(binding);
      model.userData.dispose = () => { gpu.disposed++; }; gpu.models.push(model);
      return model;
    } };
});

let clock, frames, shelf, stage, scroller, trashNode, bookNode, scroll;
function flushFrames(duration = 1100) {
  const end = clock + duration;
  while (frames.size && clock < end) {
    clock += 16;
    const callbacks = [...frames.values()]; frames.clear();
    for (const callback of callbacks) callback(clock);
  }
}
function rect(left, top, width, height) { return { left, top, width, height, right:left + width, bottom:top + height }; }
function showTrash() { shelf.setMode('isometric', { animate:false }); shelf.flush(); }
const binModel = () => gpu.scene.getObjectByName('Shelf wastebasket');
const floorModel = () => gpu.scene.getObjectByName('Library floor');
function assertGroundedBin() {
  const bin = binModel(), floor = floorModel();
  expect(bin.parent).toBe(floor.parent); expect(bin.scale.toArray()).toEqual([1, 1, 1]);
  expect(bin.rotation.toArray().slice(0, 3)).toEqual([0, 0, 0]);
  const foot = bin.getObjectByName('Rubber foot'); foot.geometry.computeBoundingBox(); foot.updateMatrix();
  const footY = foot.geometry.boundingBox.clone().applyMatrix4(foot.matrix).min.y + bin.position.y;
  const groundY = floor.geometry.boundingBox.max.y + floor.position.y;
  const cabinet = floor.parent.children.find(child => child.userData.furniture);
  expect(groundY).toBeCloseTo(Math.min(...cabinet.children.map(mesh => mesh.geometry.boundingBox.min.y)), 6);
  expect(footY).toBeCloseTo(groundY, 6);
  expect(Number(shelf.canvas.dataset.trashFootY)).toBeCloseTo(groundY, 6);
  expect(Number(shelf.canvas.dataset.cabinetFloorY)).toBeCloseTo(groundY, 6);
  expect(shelf.canvas.dataset.trashFootWorld).toBe(shelf.canvas.dataset.floorContactWorld);
}
function cabinetRight() {
  const parent = gpu.scene.children.find(child => child.children.some(object => object.userData.furniture));
  const cabinet = parent.children.find(child => child.userData.furniture);
  return stage.getBoundingClientRect().left + new THREE.Box3().setFromObject(cabinet).max.x;
}

beforeEach(() => {
  clock = 0; frames = new Map(); scroll = 0;
  gpu.renders = 0; gpu.scene = null; gpu.models = []; gpu.disposed = 0;
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
  scroller.getBoundingClientRect = () => rect(20, 60, 390, 700);
  stage.getBoundingClientRect = () => rect(20, 60 - scroll, 390, 750);
  trashNode = document.createElement('button'); bookNode = document.createElement('button');
  trashNode.getBoundingClientRect = () => rect(20 + parseFloat(trashNode.style.left),
    60 - scroll + parseFloat(trashNode.style.top), parseFloat(trashNode.style.width), parseFloat(trashNode.style.height));
  stage.append(bookNode, trashNode);
  shelf = createBookshelfScene({ stage, scroller, width:390, sceneWidth:390, height:750,
    rows:[{ top:20, bottom:220 }, { top:260, bottom:460 }, { top:500, bottom:700 }], trashNode,
    entries:[{ node:bookNode, book:{ id:'a', title:'Book', author:'Author' }, style:{ color:'#3c6548', width:28 },
      x:60, y:130, width:100, height:180, thickness:28 }] });
  shelf.canvas.getBoundingClientRect = () => rect(20, 60, 390, 700);
  shelf.flush(); flushFrames();
});

afterEach(() => {
  shelf?.dispose(); shelf = null; document.body.innerHTML = '';
  vi.restoreAllMocks(); vi.unstubAllGlobals();
});

describe('wastebasket in the shared 3D shelf scene', () => {
  it('uses the entire physical cabinet width frontally and hides all trash interaction until the diagonal view', () => {
    const bin = binModel();
    expect(shelf.canvas.dataset.cabinetWidth).toBe('390');
    expect(shelf.canvas.dataset.trashReserve).toBe('0.000');
    expect(shelf.canvas.dataset.zoom).toBe('1.0000');
    expect(bin.visible).toBe(true); expect(shelf.canvas.dataset.trashCameraInFrame).toBe('false');
    assertGroundedBin();
    expect(trashNode.hidden).toBe(true); expect(trashNode.inert).toBe(true);
    expect(trashNode.getAttribute('aria-hidden')).toBe('true');
    expect(trashNode.style.pointerEvents).toBe('none'); expect(trashNode.tabIndex).toBe(-1);
    expect(shelf.canvas.dataset.trashVisible).toBe('false');
    const target = trashNode.getBoundingClientRect();
    expect(shelf.hitTrash(target.left + target.width / 2, target.top + target.height / 2)).toBe(false);
    const stationary = gpu.renders;
    shelf.setTrashHover(true); flushFrames();
    expect(bin.userData.openness).toBe(0); expect(gpu.renders).toBe(stationary);
    expect(shelf.animateBookToTrash(bookNode)).toBeNull();
    expect(shelf.canvas.dataset.trashingObjectId).toBeUndefined();
    showTrash();
    expect(bin.visible).toBe(true); expect(trashNode.hidden).toBe(false); expect(trashNode.inert).toBe(false);
    expect(trashNode.getAttribute('aria-hidden')).toBe('false'); expect(trashNode.style.pointerEvents).toBe('auto');
    expect(shelf.canvas.dataset.trashVisible).toBe('true');
    shelf.setMode('spine', { animate:false }); shelf.flush();
    expect(bin.visible).toBe(true); expect(trashNode.hidden).toBe(true);
    expect(shelf.canvas.dataset.trashCameraInFrame).toBe('false');
    expect(shelf.canvas.dataset.trashReserve).toBe('0.000');
    shelf.dispose(); shelf = null;
    expect(trashNode.hidden).toBe(false); expect(trashNode.inert).toBe(false);
    expect(trashNode.getAttribute('aria-hidden')).toBeNull(); expect(trashNode.getAttribute('tabindex')).toBeNull();
  });

  it('moves the camera framing around one grounded object without revealing, scaling or re-anchoring the bin', () => {
    const bin = binModel(), position = bin.position.clone(), scale = bin.scale.clone(), rotation = bin.quaternion.clone();
    const samples = [shelf.canvas.dataset.trashCameraInFrame];
    shelf.setMode('isometric');
    for (const duration of [80, 80, 80, 80, 80, 100, 240]) {
      flushFrames(duration);
      expect(bin.visible).toBe(true); expect(bin.position.equals(position)).toBe(true);
      expect(bin.scale.equals(scale)).toBe(true); expect(bin.quaternion.equals(rotation)).toBe(true);
      const parentScale = bin.parent.getWorldScale(new THREE.Vector3());
      expect(bin.getWorldScale(new THREE.Vector3()).toArray()).toEqual(parentScale.toArray());
      assertGroundedBin(); samples.push(shelf.canvas.dataset.trashCameraInFrame);
    }
    expect(samples).toContain('false'); expect(samples).toContain('true');
    expect(bin.visible).toBe(true); expect(trashNode.hidden).toBe(false);
    const target = trashNode.getBoundingClientRect();
    expect(target.left).toBeGreaterThan(stage.getBoundingClientRect().left);
    expect(target.right).toBeLessThanOrEqual(scroller.getBoundingClientRect().right);
    shelf.setMode('spine');
    expect(trashNode.hidden).toBe(true); expect(trashNode.style.pointerEvents).toBe('none');
    expect(shelf.hitTrash(target.left + target.width / 2, target.top + target.height / 2)).toBe(false);
    flushFrames();
    expect(bin.visible).toBe(true); expect(shelf.canvas.dataset.trashCameraInFrame).toBe('false');
    expect(shelf.canvas.dataset.trashReserve).toBe('0.000'); assertGroundedBin();
  });

  it('cancels an active drop when returning to the frontal view without leaving a dormant flight', async () => {
    showTrash();
    const model = gpu.models[0], parent = model.parent;
    const motion = shelf.animateBookToTrash(bookNode);
    flushFrames(160);
    shelf.setMode('spine', { animate:false }); shelf.flush();
    await expect(motion.finished).resolves.toBe(false);
    expect(model.parent).toBe(parent); expect(model.visible).toBe(true);
    expect(trashNode.hidden).toBe(true); expect(shelf.canvas.dataset.trashingObjectId).toBeUndefined();
    expect(shelf.canvas.dataset.trashDropProgress).toBeUndefined();
    expect(shelf.animateBookToTrash(bookNode)).toBeNull();
    const stationary = gpu.renders; flushFrames(); expect(gpu.renders).toBe(stationary);
  });

  it('places the bin at the physical bottom of a long cabinet and reaches it by scrolling rather than pinning it to the screen', () => {
    const rows = Array.from({ length:10 }, (_, index) => ({ top:20 + index * 240, bottom:220 + index * 240 }));
    shelf.updateLayout({ stage, width:390, sceneWidth:390, height:2450, trashNode, rows, entries:[] });
    showTrash();
    const bin = binModel(), localPosition = bin.position.clone(), worldPosition = bin.getWorldPosition(new THREE.Vector3());
    assertGroundedBin();
    expect(Number(shelf.canvas.dataset.cabinetFloorY)).toBe(-2450);
    expect(trashNode.hidden).toBe(true); expect(shelf.canvas.dataset.trashCameraInFrame).toBe('false');
    expect(shelf.hitTrash(350, 650)).toBe(false);
    scroll = Math.max(0, parseFloat(stage.style.height) - 700); shelf.flush();
    const bottom = trashNode.getBoundingClientRect();
    expect(scroll).toBeGreaterThan(500);
    expect(trashNode.hidden).toBe(false); expect(shelf.canvas.dataset.trashCameraInFrame).toBe('true');
    expect(bottom.top).toBeGreaterThanOrEqual(scroller.getBoundingClientRect().top);
    expect(bottom.bottom).toBeLessThanOrEqual(scroller.getBoundingClientRect().bottom);
    expect(shelf.hitTrash(bottom.left + bottom.width / 2, bottom.top + bottom.height / 2)).toBe(true);
    expect(bin.position.equals(localPosition)).toBe(true);
    expect(bin.getWorldPosition(new THREE.Vector3()).equals(worldPosition)).toBe(true);
    scroll -= 100; shelf.flush();
    expect(trashNode.getBoundingClientRect().top).toBeCloseTo(bottom.top + 100);
    assertGroundedBin();
    scroll = 0; shelf.flush();
    expect(trashNode.hidden).toBe(true); expect(shelf.canvas.dataset.trashCameraInFrame).toBe('false');
    expect(bin.position.equals(localPosition)).toBe(true);
  });

  it('uses the bin world scale and orientation for a falling book while its local pose stays fixed', async () => {
    showTrash();
    const bin = binModel(), position = bin.position.clone(), model = gpu.models[0];
    const worldScale = bin.getWorldScale(new THREE.Vector3()).x;
    const finalQuaternion = bin.getWorldQuaternion(new THREE.Quaternion()).multiply(
      new THREE.Quaternion().setFromEuler(new THREE.Euler(-.22, .18, -.46)));
    const motion = shelf.animateBookToTrash(bookNode, { duration:850 });
    flushFrames(1000); await expect(motion.finished).resolves.toBe(true);
    expect(model.scale.x).toBeCloseTo(.19 * worldScale, 8);
    expect(Math.abs(model.quaternion.dot(finalQuaternion))).toBeCloseTo(1, 8);
    expect(bin.position.equals(position)).toBe(true); assertGroundedBin();
    motion.cancel();
  });

  it('disposes the real floor and each bin geometry/material once when the shared room is removed', () => {
    const bin = binModel(), floor = floorModel(), resources = new Set([floor.geometry, floor.material]);
    bin.traverse(mesh => { if (mesh.geometry) resources.add(mesh.geometry); for (const material of [].concat(mesh.material || [])) resources.add(material); });
    const counts = new Map([...resources].map(resource => [resource, 0]));
    for (const resource of resources) resource.addEventListener('dispose', () => counts.set(resource, counts.get(resource) + 1));
    shelf.dispose(); shelf = null;
    expect([...counts.values()]).toEqual([...counts.values()].map(() => 1));
  });

  it.each([320, 390, 860])('fits the actual bin and open lid beside a full-width %i px cabinet after scrolling and toggling', viewportWidth => {
    const previousWidth = window.innerWidth;
    Object.defineProperty(window, 'innerWidth', { configurable:true, value:viewportWidth });
    scroller.getBoundingClientRect = () => rect(0, 60, viewportWidth, 700);
    stage.getBoundingClientRect = () => rect(0, 60 - scroll, viewportWidth, 750);
    shelf.canvas.getBoundingClientRect = () => rect(0, 60, viewportWidth, 700);
    trashNode.getBoundingClientRect = () => rect(parseFloat(trashNode.style.left),
      60 - scroll + parseFloat(trashNode.style.top), parseFloat(trashNode.style.width), parseFloat(trashNode.style.height));
    try {
      shelf.updateLayout({ stage, width:viewportWidth, sceneWidth:viewportWidth, height:750, trashNode,
        rows:[{ top:20,bottom:220 },{ top:260,bottom:460 },{ top:500,bottom:700 }], entries:[] });
      expect(shelf.canvas.dataset.zoom).toBe('1.0000');
      expect(shelf.canvas.dataset.cabinetWidth).toBe(String(viewportWidth));
      expect(shelf.canvas.style.width).toBe(`${viewportWidth}px`);
      expect(cabinetRight()).toBeCloseTo(viewportWidth);
      expect(trashNode.hidden).toBe(true);
      showTrash(); shelf.setTrashHover(true); flushFrames(300);
      const bin = binModel(); assertGroundedBin();
      expect(bin.userData.openness).toBe(1);
      const before = trashNode.getBoundingClientRect();
      expect(bin.position.x - bin.userData.radius).toBeGreaterThan(viewportWidth / 2);
      expect(before.right).toBeLessThanOrEqual(viewportWidth);
      expect(before.top).toBeGreaterThanOrEqual(scroller.getBoundingClientRect().top);
      expect(before.bottom).toBeLessThanOrEqual(scroller.getBoundingClientRect().bottom);
      expect(before.width).toBeGreaterThanOrEqual(44); expect(before.height).toBeGreaterThanOrEqual(44);
      expect(trashNode.hidden).toBe(false);
      scroll = 100; shelf.flush();
      const after = trashNode.getBoundingClientRect();
      expect(after.left).toBeCloseTo(before.left); expect(after.top).toBeCloseTo(before.top - 100);
      assertGroundedBin();
      expect(shelf.hitTrash(after.left + after.width / 2, after.top + after.height / 2)).toBe(true);
      shelf.setMode('spine', { animate:false }); shelf.flush();
      expect(bin.visible).toBe(true); expect(trashNode.hidden).toBe(true);
      expect(shelf.hitTrash(after.left + after.width / 2, after.top + after.height / 2)).toBe(false);
      expect(shelf.canvas.dataset.trashReserve).toBe('0.000');
    } finally {
      Object.defineProperty(window, 'innerWidth', { configurable:true, value:previousWidth });
    }
  });

  it('anchors an isometric book to its visible spine and a neighboring plant to its solid pot', async () => {
    const plantNode = document.createElement('button'); plantNode.dataset.objectId = 'plant:thin-neighbor'; stage.append(plantNode);
    shelf.updateLayout({ stage, width:310, sceneWidth:390, height:750, trashNode,
      rows:[{ top:20, bottom:220 }, { top:260, bottom:460 }, { top:500, bottom:700 }],
      entries:[{ node:bookNode, book:{ id:'a', title:'Thin book', author:'' }, style:{ color:'#3c6548', width:12 },
        x:30, y:130, width:100, height:180, thickness:12 },
        { kind:'plant', node:plantNode, key:'plant:thin-neighbor', variant:'sansevieria', catalogId:'sansevieria', potId:'muskot',
          seed:'neighbor', x:72, y:158, width:42, height:124 }] });
    await Promise.resolve(); // The replacement model swaps after its ready promise settles.
    shelf.setMode('isometric', { animate:false }); shelf.flush();
    const full = shelf.getBookPose(bookNode).rect;
    const bookHit = { left:20 + parseFloat(bookNode.style.left), top:60 + parseFloat(bookNode.style.top),
      width:parseFloat(bookNode.style.width), height:parseFloat(bookNode.style.height) };
    expect(bookHit.width).toBeLessThan(full.width * .4);
    expect(bookHit.left).toBeLessThan(full.left + full.width * .2);
    expect(bookNode.dataset.sceneHitSurface).toBe('spine');
    expect(shelf.getObjectAtPoint(bookHit.left + bookHit.width / 2, bookHit.top + bookHit.height / 2)).toBe(bookNode);
    const plantHit = { left:20 + parseFloat(plantNode.style.left), top:60 + parseFloat(plantNode.style.top),
      width:parseFloat(plantNode.style.width), height:parseFloat(plantNode.style.height) };
    expect(plantNode.dataset.sceneHitSurface).toBe('pot');
    expect(plantHit.height).toBeLessThan(124 * .5);
    expect(shelf.getObjectAtPoint(plantHit.left + plantHit.width / 2, plantHit.top + plantHit.height * .75)).toBe(plantNode);
    expect(bookNode.querySelector('[data-shelf-cover-hit]')).not.toBeNull();
    expect(bookNode.querySelector('[data-shelf-cover-hit]').style.width).toBe(`${full.width}px`);
    shelf.setMode('spine', { animate:false }); shelf.flush();
    expect(bookNode.querySelector('[data-shelf-cover-hit]').style.display).toBe('none');
    shelf.dispose(); shelf = null;
    expect(bookNode.querySelector('[data-shelf-cover-hit]')).toBeNull();
    expect(bookNode.dataset.sceneHitSurface).toBeUndefined();
  });

  it('keeps complete opening bounds and avoids false reorder motion when semantic targets have not moved', () => {
    shelf.setMode('isometric', { animate:false }); shelf.flush();
    const oldRects = new Map([['book:a', { left:20 + parseFloat(bookNode.style.left), top:60 + parseFloat(bookNode.style.top) }]]);
    const pose = shelf.getBookPose(bookNode);
    expect(pose.width).toBe(100); expect(pose.height).toBe(180);
    expect(pose.rect.width).toBeGreaterThan(parseFloat(bookNode.style.width) * 2);
    shelf.animateFromRects(oldRects);
    expect(shelf.canvas.dataset.animating).toBe('true');
    expect(shelf.getBookPose(bookNode).centerX).toBeCloseTo(pose.centerX);
    expect(shelf.getBookPose(bookNode).centerY).toBeCloseTo(pose.centerY);
    flushFrames();
    expect(shelf.getBookPose(bookNode).centerX).toBeCloseTo(pose.centerX);
    expect(shelf.getBookPose(bookNode).centerY).toBeCloseTo(pose.centerY);
  });

  it('keeps the supplemental cover hit area disabled with its parent during dragging and return', () => {
    shelf.setMode('isometric', { animate:false }); shelf.flush();
    const cover = bookNode.querySelector('[data-shelf-cover-hit]');
    expect(cover.style.pointerEvents).toBe('inherit');
    bookNode.classList.add('is-dragging'); shelf.flush();
    expect(cover.style.pointerEvents).toBe('none');
    bookNode.classList.remove('is-dragging'); bookNode.classList.add('is-away'); shelf.flush();
    expect(cover.style.pointerEvents).toBe('none');
    bookNode.classList.remove('is-away'); bookNode.disabled = true; shelf.flush();
    expect(cover.style.pointerEvents).toBe('none');
    bookNode.disabled = false; shelf.flush();
    // Inherit also respects parent CSS and inline pointer-events without a
    // computed-style read on every scene frame.
    expect(cover.style.pointerEvents).toBe('inherit');
    bookNode.style.pointerEvents = 'none'; shelf.flush();
    expect(cover.style.pointerEvents).toBe('inherit');
  });

  it('drops the existing 3D plant into the same bin and can cancel without losing its model', async () => {
    const plantNode = document.createElement('button'); plantNode.dataset.objectId = 'plant:fixture'; stage.append(plantNode);
    shelf.updateLayout({ stage, width:310, sceneWidth:390, height:750,
      rows:[{ top:20, bottom:220 }, { top:260, bottom:460 }, { top:500, bottom:700 }], trashNode,
      entries:[{ kind:'plant', node:plantNode, key:'plant:fixture', variant:'monstera', seed:'fixture',
        x:100, y:180, width:46, height:72 }] });
    showTrash();
    const furniture = gpu.scene.children.find(child => child.children.some(object => object.userData.furniture));
    const model = furniture.children.find(child => child.userData.entry?.kind === 'plant');
    const before = model.getWorldPosition(new THREE.Vector3());
    const motion = shelf.animateObjectToTrash(plantNode, { duration:850 });
    expect(model.parent).toBe(gpu.scene);
    expect(model.position.distanceTo(before)).toBeLessThan(1e-8);
    plantNode.classList.add('is-away'); flushFrames(450);
    expect(model.visible).toBe(true);
    expect(shelf.canvas.dataset.trashingObjectKind).toBe('plant');
    expect(shelf.canvas.dataset.trashingObjectId).toBe('plant:fixture');
    flushFrames(700); await expect(motion.finished).resolves.toBe(true);
    expect(model.visible).toBe(false);
    motion.cancel(); plantNode.classList.remove('is-away'); shelf.flush();
    expect(model.parent).toBe(furniture); expect(model.visible).toBe(true);
    expect(model.scale.x).toBe(1);
    expect(shelf.canvas.dataset.trashingObjectId).toBeUndefined();
  });

  it('shows the attached catalogue only in the diagonal view and projects a scrolling semantic target', () => {
    const catalogNode = document.createElement('button'); catalogNode.hidden = true;
    catalogNode.tabIndex = -1; stage.append(catalogNode);
    const layout = { stage, width:310, sceneWidth:390, height:750, trashNode, catalogNode,
      rows:[{ top:20, bottom:220 }, { top:260, bottom:460 }, { top:500, bottom:700 }], entries:[] };
    shelf.updateLayout(layout);
    expect(catalogNode.hidden).toBe(true); expect(catalogNode.tabIndex).toBe(-1);
    const furniture = gpu.scene.children.find(child => child.children.some(object => object.userData.furniture));
    const catalog = furniture.children.find(child => child.userData.catalog);
    expect(catalog.visible).toBe(false);
    expect(catalogNode.dataset.catalogViewHidden).toBe('true');
    shelf.setMode('isometric', { animate:false }); shelf.flush();
    expect(catalog.visible).toBe(true);
    expect(catalogNode.hidden).toBe(false); expect(catalogNode.tabIndex).toBe(0);
    expect(catalogNode.dataset.catalog3d).toBe('true');
    expect(Number(catalogNode.style.zIndex)).toBeGreaterThan(1500);
    expect(parseFloat(catalogNode.style.width)).toBeGreaterThanOrEqual(44);
    expect(parseFloat(catalogNode.style.height)).toBeGreaterThan(60);
    const top = parseFloat(catalogNode.style.top);
    const originalStageBounds = stage.getBoundingClientRect;
    stage.getBoundingClientRect = () => rect(20, 900, 390, 750);
    shelf.flush();
    expect(catalogNode.hidden).toBe(true); expect(catalogNode.tabIndex).toBe(-1);
    expect(catalogNode.dataset.catalogVisible).toBe('false');
    stage.getBoundingClientRect = originalStageBounds;
    shelf.flush();
    expect(catalogNode.hidden).toBe(false); expect(catalogNode.tabIndex).toBe(0);
    scroll = 30; shelf.flush();
    expect(parseFloat(catalogNode.style.top)).toBeCloseTo(top);
    scroll = 500; shelf.flush();
    expect(catalogNode.hidden).toBe(true); expect(catalogNode.tabIndex).toBe(-1);
    scroll = 0; shelf.setMode('spine', { animate:false }); shelf.flush();
    expect(catalog.visible).toBe(false); expect(catalogNode.hidden).toBe(true);
    shelf.dispose(); shelf = null;
    expect(catalogNode.hidden).toBe(true); expect(catalogNode.tabIndex).toBe(-1);
    expect(catalogNode.dataset.catalog3d).toBeUndefined();
  });

  it('reuses saved plants but rebuilds a model when its selected pot or species changes', () => {
    const plantNode = document.createElement('button'); plantNode.dataset.objectId = 'plant:fixture'; stage.append(plantNode);
    const data = { kind:'plant', node:plantNode, key:'plant:fixture', variant:'monstera', seed:'fixture', potId:'muskot',
      catalogId:'monstera', x:100, y:180, width:46, height:72 };
    const layout = { stage, width:310, sceneWidth:390, height:750, trashNode,
      rows:[{ top:20, bottom:220 }, { top:260, bottom:460 }, { top:500, bottom:700 }], entries:[data] };
    shelf.updateLayout(layout);
    const count = Number(shelf.canvas.dataset.modelCreations);
    shelf.updateLayout({ ...layout, entries:[{ ...data, x:120 }] });
    expect(Number(shelf.canvas.dataset.modelCreations)).toBe(count);
    shelf.updateLayout({ ...layout, entries:[{ ...data, potId:'akerbar' }] });
    expect(Number(shelf.canvas.dataset.modelCreations)).toBe(count + 1);
    shelf.updateLayout({ ...layout, entries:[{ ...data, catalogId:'sansevieria', variant:'upright' }] });
    expect(Number(shelf.canvas.dataset.modelCreations)).toBe(count + 2);
  });

  it('projects the grounded bin in the right-side room and scrolls its target together with the cabinet', () => {
    showTrash();
    const before = trashNode.getBoundingClientRect();
    expect(binModel().position.x - binModel().userData.radius).toBeGreaterThan(390 / 2);
    expect(before.right).toBeLessThanOrEqual(scroller.getBoundingClientRect().right);
    expect(before.bottom).toBeLessThan(780);
    expect(shelf.hitTrash(before.left + before.width / 2, before.top + before.height / 2)).toBe(true);
    expect(shelf.hitTrash(80, 120)).toBe(false);
    scroll = 240; shelf.flush();
    const after = trashNode.getBoundingClientRect();
    expect(after.top).toBeCloseTo(before.top - 240); expect(after.left).toBeCloseTo(before.left);
    assertGroundedBin();
    expect(trashNode.dataset.trash3d).toBe('true');
    expect(shelf.canvas.style.width).toBe('390px');
  });

  it('animates its real lid on hover and does no rendering while stationary', () => {
    showTrash();
    const stationary = gpu.renders; flushFrames(); expect(gpu.renders).toBe(stationary);
    shelf.setTrashHover(true); flushFrames(300);
    const bin = binModel();
    expect(bin.userData.lid.rotation.x).toBeLessThan(-1.4);
    expect(trashNode.dataset.trashHover).toBe('true');
    expect(shelf.canvas.dataset.animating).toBe('false');
    const hovered = gpu.renders; flushFrames(); expect(gpu.renders).toBe(hovered);
    shelf.setTrashHover(false); flushFrames(300);
    expect(bin.userData.lid.rotation.x).toBeCloseTo(0);
  });

  it('keeps the bin in the projected right-side free area throughout the diagonal shelf view', () => {
    showTrash();
    shelf.setTrashHover(true); flushFrames(350);
    const bin = binModel();
    const target = trashNode.getBoundingClientRect();
    expect(bin.rotation.y).toBe(0); expect(bin.parent.rotation.y).toBeCloseTo(-Math.PI / 6);
    expect(bin.position.x - bin.userData.radius).toBeGreaterThan(390 / 2);
    expect(target.right).toBeLessThanOrEqual(scroller.getBoundingClientRect().right);
    expect(target.bottom).toBeLessThan(780);
    expect(shelf.hitTrash(target.left + target.width / 2, target.top + target.height / 2)).toBe(true);
  });

  it('anchors the whole bin above the visible floor below a tall mobile heading', () => {
    const originalHeight = window.innerHeight;
    Object.defineProperty(window, 'innerHeight', { configurable:true, value:844 });
    scroller.getBoundingClientRect = () => rect(0, 100, 320, 744);
    stage.getBoundingClientRect = () => rect(0, 185 - scroll, 320, 750);
    shelf.canvas.getBoundingClientRect = () => rect(0, 185, 320, 744);
    trashNode.getBoundingClientRect = () => rect(parseFloat(trashNode.style.left),
      185 - scroll + parseFloat(trashNode.style.top), parseFloat(trashNode.style.width), parseFloat(trashNode.style.height));
    shelf.updateLayout({ stage, width:320, sceneWidth:320, height:750, trashNode,
      rows:[{ top:20,bottom:220 },{ top:260,bottom:460 },{ top:500,bottom:700 }], entries:[] });
    showTrash();
    const normal = trashNode.getBoundingClientRect();
    expect(normal.bottom).toBeLessThanOrEqual(scroller.getBoundingClientRect().bottom);
    expect(normal.left).toBeGreaterThanOrEqual(0); expect(normal.right).toBeLessThanOrEqual(320);
    expect(normal.top).toBeGreaterThan(stage.getBoundingClientRect().top); assertGroundedBin();
    shelf.setMode('isometric', { animate:false }); shelf.setTrashHover(true); flushFrames(350);
    const diagonal = trashNode.getBoundingClientRect();
    expect(diagonal.bottom).toBeLessThanOrEqual(scroller.getBoundingClientRect().bottom);
    expect(diagonal.left).toBeGreaterThanOrEqual(0); expect(diagonal.right).toBeLessThanOrEqual(320);
    expect(shelf.hitTrash(diagonal.left + diagonal.width / 2, diagonal.top + diagonal.height / 2)).toBe(true);
    Object.defineProperty(window, 'innerHeight', { configurable:true, value:originalHeight });
  });

  it('moves the same mesh into the bin, hides it only after landing, and can restore it', async () => {
    showTrash();
    const model = gpu.models[0], originalParent = model.parent;
    bookNode.classList.add('is-dragging'); bookNode.style.setProperty('--ihr-drag-x', '75px');
    shelf.flush();
    const originalWorld = model.getWorldPosition(new THREE.Vector3());
    const motion = shelf.animateBookToTrash(bookNode, { duration:850 });
    expect(model.parent).toBe(gpu.scene);
    expect(model.position.distanceTo(originalWorld)).toBeLessThan(1e-8);
    bookNode.classList.remove('is-dragging'); bookNode.classList.add('is-away');
    flushFrames(450);
    expect(model.visible).toBe(true);
    expect(Number(trashNode.dataset.trashDropProgress)).toBeGreaterThan(.4);
    expect(Number(trashNode.dataset.trashDropProgress)).toBeLessThan(.8);
    flushFrames(700);
    await expect(motion.finished).resolves.toBe(true);
    expect(model.visible).toBe(false);
    expect(shelf.canvas.dataset.trashDropProgress).toBe('1.0000');
    expect(shelf.canvas.dataset.animating).toBe('false');
    motion.cancel(); bookNode.classList.remove('is-away'); shelf.flush();
    expect(model.parent).toBe(originalParent); expect(model.visible).toBe(true);
    expect(model.scale.x).toBe(1);
    expect(shelf.canvas.dataset.trashingBookId).toBeUndefined();
  });

  it('cancels a pending animation on dispose and disposes the existing book once', async () => {
    showTrash();
    const motion = shelf.animateBookToTrash(bookNode);
    shelf.dispose(); shelf = null;
    await expect(motion.finished).resolves.toBe(false);
    expect(gpu.disposed).toBe(1);
    expect(frames.size).toBe(0);
    expect(trashNode.dataset.trash3d).toBeUndefined();
  });

  it('reports live frame activity when a slow GPU stretches the bounded-step drop', async () => {
    showTrash();
    const motion = shelf.animateBookToTrash(bookNode, { duration:850 });
    const started = clock;
    for (let index = 0; index < 13; index++) {
      clock += 200;
      const callbacks = [...frames.values()]; frames.clear();
      for (const callback of callbacks) callback(clock);
      expect(motion.lastFrameTime).toBe(clock);
    }
    expect(clock - started).toBeGreaterThan(850 + 1500);
    expect(shelf.canvas.dataset.animating).toBe('true');
    expect(Number(shelf.canvas.dataset.trashDropProgress)).toBeLessThan(1);
    flushFrames(350);
    await expect(motion.finished).resolves.toBe(true);
    expect(shelf.canvas.dataset.trashDropProgress).toBe('1.0000');
    expect(shelf.canvas.dataset.animating).toBe('false');
  });

  it('brings a wide cover inside the canvas as it turns into the right gutter', () => {
    showTrash();
    const model = gpu.models[0];
    bookNode.classList.add('is-dragging'); bookNode.style.setProperty('--ihr-drag-x', '300px');
    shelf.flush();
    const before = model.getWorldPosition(new THREE.Vector3());
    const motion = shelf.animateBookToTrash(bookNode, { duration:850 });
    expect(model.position.distanceTo(before)).toBeLessThan(1e-8);
    flushFrames(180);
    expect(new THREE.Box3().setFromObject(model).max.x).toBeLessThanOrEqual(390);
    motion.cancel();
  });
});
