import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { createBookshelfScene, projectPlantFoliage } from '../../src/js/bookshelf-scene.js';

const gpu = vi.hoisted(() => ({ renders:0, scene:null, models:[], disposed:0, readyFor:null }));
vi.mock('../../src/js/book-model.js', async () => {
  const Three = await import('three');
  let ratio = 1, size = new Three.Vector2();
  const renderer = { domElement:document.createElement('canvas'), shadowMap:{},
    capabilities:{ getMaxAnisotropy:() => 1 }, getPixelRatio:() => ratio,
    setPixelRatio:value => { ratio = value; }, getSize:target => target.copy(size),
    setSize:(width, height) => { size.set(width, height); },
    render:scene => { gpu.renders++; gpu.scene = scene; } };
  return { getBookRenderer:() => renderer, lightBookScene() {},
    createBookModel(book, style, width, height, thickness, coverUrl, { overview = false } = {}) {
      const model = new Three.Group(); model.name = `book:${book.id}`;
      model.add(new Three.Mesh(new Three.BoxGeometry(width, height, thickness), new Three.MeshStandardMaterial()));
      const binding = new Three.Mesh(new Three.BoxGeometry(thickness * .38, height, thickness), new Three.MeshStandardMaterial());
      binding.name = 'binding'; binding.position.x = -width / 2 - thickness * .19; model.add(binding);
      model.userData.overview = overview; model.userData.isOverview = overview;
      model.userData.ready = gpu.readyFor?.(book, overview);
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
// Measure the real vertices in the cabinet's local frame. World AABBs would
// mix the pitched isometric camera/furniture transform with the wall's depth.
function geometryBoundsInFrame(object, frame) {
  frame.updateWorldMatrix(true, true);
  const inverseFrame = frame.matrixWorld.clone().invert(), bounds = new THREE.Box3();
  const point = new THREE.Vector3();
  object.traverse(mesh => {
    const positions = mesh.geometry?.getAttribute('position');
    if (!positions) return;
    const matrix = inverseFrame.clone().multiply(mesh.matrixWorld);
    for (let index = 0; index < positions.count; index++) {
      bounds.expandByPoint(point.fromBufferAttribute(positions, index).applyMatrix4(matrix));
    }
  });
  return bounds;
}
function assertGroundedBin() {
  const bin = binModel(), floor = floorModel();
  expect(floor.visible).toBe(false); expect(shelf.canvas.dataset.floorVisible).toBe('false');
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
function containsTriangle(path, x, y) {
  return [...path.matchAll(/M(-?[\d.]+),(-?[\d.]+)L(-?[\d.]+),(-?[\d.]+)L(-?[\d.]+),(-?[\d.]+)Z/g)].some(match => {
    const [ax, ay, bx, by, cx, cy] = match.slice(1).map(Number);
    const cross = (px, py, qx, qy) => (x - qx) * (py - qy) - (px - qx) * (y - qy);
    const signs = [cross(ax, ay, bx, by), cross(bx, by, cx, cy), cross(cx, cy, ax, ay)];
    return !signs.some(value => value < -1e-5) || !signs.some(value => value > 1e-5);
  });
}
function insideRectangles(path, x, y) {
  return [...path.matchAll(/M(-?[\d.]+),(-?[\d.]+)H(-?[\d.]+)V(-?[\d.]+)H(-?[\d.]+)Z/g)]
    .filter(match => { const [left, top, right, bottom] = match.slice(1, 5).map(Number);
      return x > left && x < right && y > top && y < bottom; }).length;
}
function nativePlantLayout({ node = document.createElement('button'), entries, variant = 'monstera', catalogId = variant } = {}) {
  node.classList.add('ihr-plant'); node.dataset.objectId = 'plant:touch-foliage-trash'; node.style.touchAction = 'none'; stage.append(node);
  const data = { kind:'plant', node, key:node.dataset.objectId, seed:node.dataset.objectId, variant, catalogId,
    potId:'muskot', x:180, y:165, width:86, height:110 };
  const layout = { stage, width:390, sceneWidth:390, height:750, trashNode,
    rows:[{ top:20, bottom:220 }, { top:260, bottom:460 }, { top:500, bottom:700 }], entries:entries || [data] };
  shelf.updateLayout(layout); return { node, data, layout };
}
function manyBookLayout(count = 80) {
  const rows = Array.from({ length:Math.ceil(count / 5) }, (_, index) => ({ top:20 + index * 220, bottom:220 + index * 220 }));
  const entries = Array.from({ length:count }, (_, index) => {
    const node = document.createElement('button'); node.classList.add('ihr-spine'); node.dataset.bookId = String(index); stage.append(node);
    return { node, book:{ id:String(index),title:`Book ${index}`,author:'Author' }, style:{ color:'#41694f',width:28 },
      x:44 + index % 5 * 72, y:rows[Math.floor(index / 5)].bottom - 90, width:100,height:180,thickness:28 };
  });
  const layout = { stage, width:390, sceneWidth:390,height:rows.at(-1).bottom + 35,trashNode,rows,entries };
  shelf.updateLayout(layout); return { entries, layout };
}

beforeEach(() => {
  clock = 0; frames = new Map(); scroll = 0;
  gpu.renders = 0; gpu.scene = null; gpu.models = []; gpu.disposed = 0; gpu.readyFor = null;
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
  it.each(['walnut', 'baggebo'].flatMap(type => [320, 390, 720].map(width => [type, width])))
    ('keeps the whole %s wastebasket clear of the wall throughout its lid movement at %i px and after depth reflow', (shelfType, viewportWidth) => {
      scroller.getBoundingClientRect = () => rect(0, 60, viewportWidth, 700);
      stage.getBoundingClientRect = () => rect(0, 60 - scroll, viewportWidth, 750);
      shelf.canvas.getBoundingClientRect = () => rect(0, 60, viewportWidth, 700);
      for (const [width, bookWidth] of [[viewportWidth, 100], [viewportWidth * .84, 240]]) {
        const height = shelfType === 'baggebo' ? width * 1160 / 600 : 750;
        shelf.updateLayout({ stage, width, sceneWidth:viewportWidth, height, shelfType, trashNode,
          rows:[{ top:20, bottom:height * .29 }, { top:height * .35, bottom:height * .61 },
            { top:height * .67, bottom:height - 50 }],
          entries:[{ node:bookNode, book:{ id:'a', title:'Book', author:'Author' }, style:{ color:'#3c6548', width:28 },
            x:60, y:130, width:bookWidth, height:180, thickness:28 }] });
        showTrash();
        const bin = binModel(), frame = bin.parent;
        const wall = gpu.scene.getObjectByName('Library room wall');
        expect(wall.parent).toBe(frame);
        const wallBounds = geometryBoundsInFrame(wall, frame);
        const floorBounds = geometryBoundsInFrame(floorModel(), frame);
        const cabinet = frame.children.find(child => child.userData.furniture);
        expect(floorBounds.max.y).toBeCloseTo(geometryBoundsInFrame(cabinet, frame).min.y, 6);
        for (const openness of [0, .25, .5, .75, 1]) {
          for (const bounce of [0, .15, .45]) {
            bin.userData.setState({ openness, bounce });
            const bounds = geometryBoundsInFrame(bin, frame);
            // Positive z faces the room: every part, including the hinged lid
            // and rear axle, must stay at least 10 px in front of the wall.
            expect(bounds.min.z - wallBounds.max.z).toBeGreaterThanOrEqual(10 - 1e-6);
            expect(bounds.min.y).toBeCloseTo(floorBounds.max.y, 6);
            expect(bin.scale.toArray()).toEqual([1, 1, 1]);
            expect(bin.rotation.toArray().slice(0, 3)).toEqual([0, 0, 0]);
          }
        }
        bin.userData.setState({ openness:0 });
      }
    });

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

  it('bakes cabinet occlusion and floor contact into one unpickable draw that follows the bin and is released', () => {
    const occlusion = () => gpu.scene.getObjectByName('Cabinet occlusion');
    const mesh = occlusion(), material = mesh.material;
    expect(mesh.parent).toBe(binModel().parent); expect(mesh.userData.furniture).toBeUndefined();
    expect(material.transparent).toBe(true); expect(material.depthWrite).toBe(false);
    expect(mesh.castShadow).toBe(false); expect(mesh.receiveShadow).toBe(false);
    const hits = []; mesh.raycast(new THREE.Raycaster(), hits); expect(hits).toHaveLength(0);
    mesh.geometry.computeBoundingBox();
    expect(mesh.geometry.boundingBox.max.x).toBeGreaterThan(binModel().position.x);
    const entry = { node:bookNode, book:{ id:'a', title:'Book', author:'Author' }, style:{ color:'#3c6548', width:28 },
      x:60, y:130, width:100, height:180, thickness:28 };
    const previous = mesh.geometry; let released = 0;
    previous.addEventListener('dispose', () => { released++; });
    shelf.updateLayout({ stage, width:390, sceneWidth:390, height:750, trashNode:null,
      rows:[{ top:20, bottom:220 }, { top:260, bottom:460 }, { top:500, bottom:700 }], entries:[entry] });
    expect(released).toBe(1); expect(occlusion()).toBe(mesh);
    mesh.geometry.computeBoundingBox();
    expect(mesh.geometry.boundingBox.max.x).toBeLessThan(195 + 60);
    let disposed = 0;
    mesh.geometry.addEventListener('dispose', () => { disposed++; }); material.addEventListener('dispose', () => { disposed++; });
    shelf.dispose(); shelf = null;
    expect(disposed).toBe(2);
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

  it('fits a long cabinet and its larger grounded bin together without any isometric scrolling', () => {
    const rows = Array.from({ length:10 }, (_, index) => ({ top:20 + index * 240, bottom:220 + index * 240 }));
    shelf.updateLayout({ stage, width:390, sceneWidth:390, height:2450, trashNode, rows, entries:[] });
    scroll = 900; shelf.flush(); showTrash();
    const bin = binModel(), localPosition = bin.position.clone(), worldPosition = bin.getWorldPosition(new THREE.Vector3());
    assertGroundedBin();
    expect(Number(shelf.canvas.dataset.cabinetFloorY)).toBe(-2450);
    expect(trashNode.hidden).toBe(false); expect(shelf.canvas.dataset.trashCameraInFrame).toBe('true');
    expect(scroll).toBe(0); expect(shelf.canvas.dataset.fullCabinetInFrame).toBe('true');
    expect(parseFloat(stage.style.height)).toBeLessThanOrEqual(Number(shelf.canvas.dataset.sceneFitHeight));
    expect(bin.userData.radius).toBe(44); expect(bin.userData.height).toBe(140);
    expect(trashNode.dataset.trashRadius).toBe('44'); expect(trashNode.dataset.trashHeight).toBe('140');
    expect(shelf.hitTrash(350, 650)).toBe(false);
    scroll = 500; shelf.flush();
    const bottom = trashNode.getBoundingClientRect();
    expect(scroll).toBe(0);
    expect(trashNode.hidden).toBe(false); expect(shelf.canvas.dataset.trashCameraInFrame).toBe('true');
    expect(bottom.top).toBeGreaterThanOrEqual(scroller.getBoundingClientRect().top);
    expect(bottom.bottom).toBeLessThanOrEqual(scroller.getBoundingClientRect().bottom);
    expect(shelf.hitTrash(bottom.left + bottom.width / 2, bottom.top + bottom.height / 2)).toBe(true);
    expect(bin.position.equals(localPosition)).toBe(true);
    expect(bin.getWorldPosition(new THREE.Vector3()).equals(worldPosition)).toBe(true);
    scroll = 100; shelf.flush();
    expect(trashNode.getBoundingClientRect().top).toBeCloseTo(bottom.top);
    assertGroundedBin();
    shelf.setMode('spine', { animate:false }); shelf.flush();
    expect(scroll).toBe(900);
    expect(trashNode.hidden).toBe(true); expect(shelf.canvas.dataset.trashCameraInFrame).toBe('false');
    expect(bin.position.equals(localPosition)).toBe(true);
  });

  it('fits every shelf below the actual mobile heading and action padding while keeping the floor invisible and physical', () => {
    const previousHeight = window.innerHeight;
    Object.defineProperty(window, 'innerHeight', { configurable:true,value:844 });
    scroller.style.paddingBottom = '76px';
    scroller.getBoundingClientRect = () => rect(0,100,390,744);
    stage.getBoundingClientRect = () => rect(0,185 - scroll,390,750);
    shelf.canvas.getBoundingClientRect = () => rect(0,185,390,744);
    try {
      const { layout } = manyBookLayout(); showTrash();
      expect(Number(shelf.canvas.dataset.sceneFitHeight)).toBe(581);
      expect(shelf.canvas.dataset.fullCabinetInFrame).toBe('true');
      expect(parseFloat(stage.style.height)).toBeLessThanOrEqual(581);
      expect(floorModel().visible).toBe(false); assertGroundedBin();
      const bin = trashNode.getBoundingClientRect();
      expect(bin.width).toBeGreaterThanOrEqual(44); expect(bin.height).toBeGreaterThanOrEqual(44);
      // Read the native target's local bounds against the stage origin used
      // above, rather than the fixture's ordinary 20/60 client offset.
      expect(parseFloat(trashNode.style.top) + parseFloat(trashNode.style.height)).toBeLessThanOrEqual(581);
      expect(Number(shelf.canvas.dataset.cabinetFloorY)).toBe(-layout.height);
    } finally { Object.defineProperty(window, 'innerHeight', { configurable:true,value:previousHeight }); }
  });

  it('pans smoothly from a lower frontal shelf into the full overview and restores its exact scroll after the final expansion frame', () => {
    manyBookLayout(); scroll = 1300; shelf.flush();
    shelf.setMode('isometric');
    expect(scroll).toBe(1300);
    const samples = [scroll];
    for (let index = 0; index < 6; index++) { flushFrames(80); samples.push(scroll); }
    expect(samples[1]).toBeLessThan(samples[0]); expect(samples[1]).toBeGreaterThan(1200);
    expect(samples.every((value,index) => !index || value <= samples[index-1])).toBe(true);
    expect(scroll).toBeGreaterThan(0); flushFrames(300);
    expect(scroll).toBe(0); expect(shelf.canvas.dataset.fullCabinetInFrame).toBe('true');
    shelf.setMode('spine'); flushFrames(80); expect(scroll).toBeGreaterThan(0); expect(scroll).toBeLessThan(100);
    flushFrames(750); expect(scroll).toBe(1300); expect(shelf.canvas.dataset.zoom).toBe('1.0000');
  });

  it('keeps the full overview framed after resize and an interrupted turn while preserving the saved frontal scroll', () => {
    const { layout } = manyBookLayout(); scroll = 1000; shelf.flush(); shelf.setMode('isometric'); flushFrames(220);
    const halfway = scroll; shelf.setMode('spine');
    expect(scroll).toBe(halfway); flushFrames(800); expect(scroll).toBe(1000);
    shelf.setMode('isometric'); flushFrames(170);
    shelf.updateLayout({ ...layout,width:320,sceneWidth:320 }); flushFrames(800);
    expect(scroll).toBe(0); expect(shelf.canvas.dataset.fullCabinetInFrame).toBe('true');
    expect(parseFloat(stage.style.height)).toBeLessThanOrEqual(Number(shelf.canvas.dataset.sceneFitHeight));
    shelf.setMode('spine', { animate:false }); shelf.flush(); expect(scroll).toBe(1000);
  });

  it('keeps all eighty books as 3D overview models and promotes only a held book without changing captured flights', async () => {
    const { entries } = manyBookLayout(); showTrash(); await Promise.resolve(); shelf.flush();
    expect(shelf.canvas.dataset.activeBooks).toBe('80'); expect(shelf.canvas.dataset.overviewBooks).toBe('80');
    expect(shelf.canvas.dataset.detailedBooks).toBe('0'); expect(shelf.canvas.dataset.bookQualityPending).toBe('0');
    const furniture = binModel().parent, node = entries[0].node;
    const model = () => furniture.children.find(object => object.userData.entry?.node === node);
    expect(model().userData.overview).toBe(true); expect(model().getObjectByName('binding').isMesh).toBe(true);
    const before = model(); node.classList.add('is-lifted'); shelf.flush(); await Promise.resolve(); shelf.flush();
    expect(model()).not.toBe(before); expect(model().userData.overview).toBe(false);
    expect(shelf.canvas.dataset.detailedBooks).toBe('1'); expect(shelf.canvas.dataset.overviewBooks).toBe('79');
    node.classList.remove('is-lifted'); node.classList.add('is-dragging'); shelf.flush();
    const captured = model(), motion = shelf.animateObjectToTrash(node);
    node.classList.add('is-away'); node.classList.remove('is-dragging'); flushFrames(400); await Promise.resolve(); shelf.flush();
    expect(captured.parent).toBe(gpu.scene); expect(captured.visible).toBe(true);
    expect(shelf.canvas.dataset.trashingObjectId).toBe('book:0');
    expect(furniture.children.some(object => object.userData.entry?.node === node)).toBe(false);
    motion.cancel(); node.classList.remove('is-away'); shelf.flush(); await Promise.resolve(); shelf.flush();
    expect(model().userData.overview).toBe(true);
    expect(shelf.canvas.dataset.activeBooks).toBe('80'); expect(shelf.canvas.dataset.overviewBooks).toBe('80');
  });

  it('creates newly visible small books in overview quality during zoom-out without rebuilding existing models at every threshold crossing', async () => {
    const { entries } = manyBookLayout(); scroll = 1300; shelf.flush();
    const oldModels = new Set(gpu.models); shelf.setMode('isometric');
    for (let index = 0; index < 9; index++) {
      flushFrames(64);
      const progress = Number(shelf.canvas.dataset.viewProgress);
      if (progress < 1) expect(shelf.canvas.dataset.bookQualityPending).toBe('0');
      for (const model of gpu.models.filter(model => !oldModels.has(model) && model.userData.overview)) {
        const entry = entries.find(entry => `book:${entry.book.id}` === model.name);
        expect(entry).toBeTruthy(); expect(model.getObjectByName('binding')).toBeTruthy();
      }
    }
    expect(gpu.models.some(model => !oldModels.has(model) && model.userData.overview)).toBe(true);
    flushFrames(200); await Promise.resolve(); shelf.flush();
    expect(shelf.canvas.dataset.overviewBooks).toBe('80'); expect(shelf.canvas.dataset.bookQualityPending).toBe('0');
    const creations = Number(shelf.canvas.dataset.modelCreations); shelf.flush(); flushFrames(100);
    expect(Number(shelf.canvas.dataset.modelCreations)).toBe(creations);
  });

  it.each(['lift','reversed view'])('discards a late overview candidate when a quick %s keeps the existing detailed book', async change => {
    const rows = Array.from({ length:16 }, (_, index) => ({ top:20 + index * 220,bottom:220 + index * 220 }));
    shelf.updateLayout({ stage,width:390,sceneWidth:390,height:3555,trashNode,rows,
      entries:[{ node:bookNode,book:{ id:'a',title:'Book',author:'Author' },style:{ color:'#3c6548',width:28 },
        x:60,y:130,width:100,height:180,thickness:28 }] });
    const model = gpu.scene.getObjectByName('book:a');
    let resolveOverview;
    gpu.readyFor = (book,overview) => overview ? new Promise(resolve => { resolveOverview = resolve; }) : undefined;
    showTrash();
    const candidate = gpu.models.at(-1), released = vi.spyOn(candidate.userData,'dispose');
    expect(candidate.userData.overview).toBe(true); expect(shelf.canvas.dataset.bookQualityPending).toBe('1');
    const creations = Number(shelf.canvas.dataset.modelCreations);
    if (change === 'lift') bookNode.classList.add('is-lifted');
    else shelf.setMode('spine', { animate:false });
    shelf.flush();
    expect(shelf.canvas.dataset.bookQualityPending).toBe('0'); expect(released).toHaveBeenCalledTimes(1);
    expect(gpu.scene.getObjectByName('book:a')).toBe(model);
    expect(model.userData.overview).toBe(false);
    resolveOverview(true); await Promise.resolve(); shelf.flush();
    expect(gpu.scene.getObjectByName('book:a')).toBe(model); expect(released).toHaveBeenCalledTimes(1);
    expect(Number(shelf.canvas.dataset.modelCreations)).toBe(creations);
    shelf.setMode('spine', { animate:false }); bookNode.classList.remove('is-lifted'); shelf.flush();
    expect(gpu.scene.getObjectByName('book:a')).toBe(model);
    expect(shelf.canvas.dataset.bookQualityPending).toBe('0');
  });

  it('discards a late detailed promotion after a quick release without painting it or rebuilding the current overview', async () => {
    const rows = Array.from({ length:16 }, (_, index) => ({ top:20 + index * 220,bottom:220 + index * 220 }));
    shelf.updateLayout({ stage,width:390,sceneWidth:390,height:3555,trashNode,rows,
      entries:[{ node:bookNode,book:{ id:'a',title:'Book',author:'Author' },style:{ color:'#3c6548',width:28 },
        x:60,y:130,width:100,height:180,thickness:28 }] });
    showTrash(); await Promise.resolve(); shelf.flush();
    const model = gpu.scene.getObjectByName('book:a'); expect(model.userData.overview).toBe(true);
    let resolveDetailed;
    gpu.readyFor = (book,overview) => !overview ? new Promise(resolve => { resolveDetailed = resolve; }) : undefined;
    bookNode.classList.add('is-lifted'); shelf.flush();
    const candidate = gpu.models.at(-1), released = vi.spyOn(candidate.userData,'dispose');
    expect(candidate.userData.overview).toBe(false); expect(shelf.canvas.dataset.bookQualityPending).toBe('1');
    const creations = Number(shelf.canvas.dataset.modelCreations);
    bookNode.classList.remove('is-lifted'); shelf.flush();
    expect(shelf.canvas.dataset.bookQualityPending).toBe('0'); expect(released).toHaveBeenCalledTimes(1);
    resolveDetailed(true); await Promise.resolve(); shelf.flush();
    expect(gpu.scene.getObjectByName('book:a')).toBe(model); expect(model.userData.overview).toBe(true);
    expect(Number(shelf.canvas.dataset.modelCreations)).toBe(creations); expect(released).toHaveBeenCalledTimes(1);
    shelf.dispose(); shelf = null; expect(released).toHaveBeenCalledTimes(1);
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

  it.each([320, 390, 860])('fits the actual larger bin and open lid beside a full-width %i px cabinet without ISO scroll', viewportWidth => {
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
      expect(scroll).toBe(0); expect(shelf.canvas.dataset.fullCabinetInFrame).toBe('true');
      expect(after.left).toBeCloseTo(before.left); expect(after.top).toBeCloseTo(before.top);
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

  it('starts foliage gestures natively inside the same touch-action:none plant button without a synthetic replay', () => {
    const { node } = nativePlantLayout(); showTrash();
    const svg = node.querySelector('.ihr-plant-foliage'), path = svg.querySelector(':scope > path');
    expect(svg.parentNode).toBe(node); expect(svg.getAttribute('aria-hidden')).toBe('true');
    expect(svg.getAttribute('focusable')).toBe('false'); expect(svg.hasAttribute('data-object-id')).toBe(false);
    expect(svg.dataset.plantFoliageKey).toBe(node.dataset.objectId);
    expect(svg.style.touchAction).toBe('none'); expect(path.style.touchAction).toBe('none');
    // The leaf envelope exceeds the pot's width; the global SVG max-width
    // rule must not shrink it and move its native hit surface off the mesh.
    expect(svg.style.maxWidth).toBe('none'); expect(svg.style.maxHeight).toBe('none');
    expect(svg.style.pointerEvents).toBe('none'); expect(path.style.pointerEvents).toBe('fill');
    expect(node.dataset.sceneHitSurface).toBe('pot'); expect(Number(svg.dataset.triangles)).toBeGreaterThan(50);
    const event = new MouseEvent('pointerdown', { bubbles:true, clientX:130, clientY:200 });
    const received = []; node.addEventListener('pointerdown', event => received.push(event));
    path.dispatchEvent(event); expect(received).toEqual([event]);
    expect(path.closest('[data-object-id]')).toBe(node);
    const leafX = parseFloat(node.style.left) + parseFloat(node.style.width) * .5;
    const leafY = parseFloat(node.style.top) - parseFloat(node.style.height) * .75;
    expect(containsTriangle(path.getAttribute('d'), leafX, leafY)).toBe(true);
    expect(shelf.getObjectAtPoint(20 + leafX, 60 + leafY)).toBe(node);
  });

  it('preserves empty gaps in the foliage rather than catching its rectangular envelope', () => {
    const { node } = nativePlantLayout();
    const svg = node.querySelector('.ihr-plant-foliage'), path = svg.querySelector(':scope > path').getAttribute('d');
    const [left, top, width, height] = svg.getAttribute('viewBox').split(' ').map(Number);
    const cells = Array.from({ length:20 }, (_, row) => Array.from({ length:20 }, (_, col) =>
      containsTriangle(path, left + width * (col + .5) / 20, top + height * (row + .5) / 20))).flat();
    expect(cells.filter(Boolean).length).toBeGreaterThan(10);
    expect(cells.filter(value => !value).length).toBeGreaterThan(180);
    expect(containsTriangle(path, left + .05 * width, top + .05 * height)).toBe(false);
    const group = new THREE.Group(), shape = new THREE.Shape();
    shape.moveTo(-5, -5); shape.lineTo(5, -5); shape.lineTo(5, 5); shape.lineTo(-5, 5); shape.closePath();
    const hole = new THREE.Path(); hole.moveTo(-1,-1); hole.lineTo(-1,1); hole.lineTo(1,1); hole.lineTo(1,-1); hole.closePath();
    shape.holes.push(hole);
    const leaf = new THREE.Mesh(new THREE.ShapeGeometry(shape), new THREE.MeshBasicMaterial()); leaf.name = 'leaf-0'; group.add(leaf);
    group.updateMatrixWorld(true); const projected = projectPlantFoliage(group);
    expect(containsTriangle(projected.path, 0, 0)).toBe(false);
    expect(containsTriangle(projected.path, 3, 3)).toBe(true);
    leaf.geometry.dispose(); leaf.material.dispose();
  });

  it('caches idle and scrolling foliage, updates its native surface on camera rotation and disables it during captured dragging', () => {
    const { node } = nativePlantLayout();
    const svg = node.querySelector('.ihr-plant-foliage'), path = svg.querySelector(':scope > path');
    const setPath = vi.spyOn(path, 'setAttribute');
    const originalPath = path.getAttribute('d'), originalBox = svg.getAttribute('viewBox');
    shelf.flush(); scroll = 40; shelf.flush();
    expect(path.getAttribute('d')).toBe(originalPath); expect(svg.getAttribute('viewBox')).toBe(originalBox);
    expect(setPath).not.toHaveBeenCalled();
    showTrash(); expect(path.getAttribute('d')).not.toBe(originalPath);
    node.classList.add('is-dragging'); node.style.setProperty('--ihr-drag-x', '100px'); shelf.flush();
    const draggingPath = path.getAttribute('d'); setPath.mockClear();
    expect(svg.style.display).toBe('none');
    node.style.setProperty('--ihr-drag-x', '120px'); shelf.flush();
    expect(path.getAttribute('d')).toBe(draggingPath); expect(setPath).not.toHaveBeenCalled();
    node.classList.remove('is-dragging'); shelf.flush(); expect(svg.style.display).toBe('block');
    node.disabled = true; shelf.flush(); expect(path.style.pointerEvents).toBe('none');
    node.disabled = false; node.style.pointerEvents = 'none'; shelf.flush(); expect(path.style.pointerEvents).toBe('none');
    node.style.pointerEvents = ''; shelf.flush(); expect(path.style.pointerEvents).toBe('fill');
  });

  it('clips overlapping book hit areas as a union without reopening intersections over a visible neighboring spine', () => {
    const second = document.createElement('button'); stage.append(second);
    const { node, data, layout } = nativePlantLayout();
    shelf.updateLayout({ ...layout, entries:[data,
      { node:bookNode, book:{ id:'a', title:'First' }, style:{ color:'#35634a' }, x:151, y:165, width:100,height:110,thickness:24 },
      { node:second, book:{ id:'b', title:'Second' }, style:{ color:'#35634a' }, x:170, y:165,width:100,height:110,thickness:24 }] });
    showTrash();
    const svg = node.querySelector('.ihr-plant-foliage'), clip = svg.querySelector('clipPath path').getAttribute('d');
    const rectangles = [bookNode, second].map(book => ({ left:parseFloat(book.style.left), top:parseFloat(book.style.top),
      width:parseFloat(book.style.width), height:parseFloat(book.style.height) }));
    const [left, top, width, height] = svg.getAttribute('viewBox').split(' ').map(Number);
    let excluded = 0;
    for (let row = 0; row < 20; row++) for (let col = 0; col < 20; col++) {
      const x = left + (col + .5) * width / 20, y = top + (row + .5) * height / 20;
      if (rectangles.some(rect => x > rect.left && x < rect.left + rect.width && y > rect.top && y < rect.top + rect.height)) {
        expect(insideRectangles(clip, x, y) % 2).toBe(0); excluded++;
      }
    }
    expect(excluded).toBeGreaterThan(10);
  });

  it('reuses leaf triangles during finger zoom while their native surface still follows the visible leaf', () => {
    const { node } = nativePlantLayout(); showTrash();
    const svg = node.querySelector('.ihr-plant-foliage'), path = svg.querySelector(':scope > path');
    const originalPath = path.getAttribute('d'), originalBox = svg.getAttribute('viewBox');
    const writes = vi.spyOn(path, 'setAttribute');
    const initial = shelf.getInspectionView();
    for (const zoom of [1.2, 1.4, 1.6]) {
      shelf.setInspectionView({ ...initial, zoom, panX:12, panY:10 }, { moving:true, renderNow:true });
      expect(path.getAttribute('d')).toBe(originalPath);
      expect(svg.getAttribute('viewBox')).toBe(originalBox);
      const [left, top, width, height] = originalBox.split(' ').map(Number);
      let hit = false;
      for (let row = 1; row < 10 && !hit; row++) for (let col = 1; col < 10 && !hit; col++) {
        const x = left + width * col / 10, y = top + height * row / 10;
        if (!containsTriangle(originalPath, x, y)) continue;
        const screenX = parseFloat(node.style.left) + parseFloat(svg.style.left) + (x - left) * parseFloat(svg.style.width) / width;
        const screenY = parseFloat(node.style.top) + parseFloat(svg.style.top) + (y - top) * parseFloat(svg.style.height) / height;
        hit = shelf.getObjectAtPoint(20 + screenX, 60 + screenY) === node;
      }
      expect(hit).toBe(true);
    }
    expect(writes).not.toHaveBeenCalled();
  });

  it('cleans native foliage targets when models are culled, nodes are rebound and the shared scene is disposed', () => {
    const { node, data, layout } = nativePlantLayout();
    const original = node.querySelector('.ihr-plant-foliage');
    const next = document.createElement('button'); next.dataset.objectId = node.dataset.objectId; stage.append(next);
    shelf.updateLayout({ ...layout, entries:[{ ...data, node:next }] });
    expect(original.isConnected).toBe(false); expect(node.querySelector('.ihr-plant-foliage')).toBeNull();
    expect(node.dataset.plantModelCatalogId).toBeUndefined(); expect(next.dataset.plantLeafTexture).toBe('procedural');
    expect(next.querySelector('.ihr-plant-foliage')).not.toBeNull();
    scroll = 2000; shelf.flush(); expect(next.querySelector('.ihr-plant-foliage')).toBeNull();
    scroll = 0; shelf.flush(); const restored = next.querySelector('.ihr-plant-foliage'); expect(restored).not.toBeNull();
    shelf.dispose(); shelf = null; expect(restored.isConnected).toBe(false);
    expect(next.querySelector('.ihr-plant-foliage')).toBeNull();
    expect(next.dataset.plantModelCatalogId).toBeUndefined();
  });

  it('renders legacy plants as opaque catalog meshes without loading a photo atlas or duplicating models during view changes and rebinding', () => {
    const variants = ['sansevieria', 'pothos', 'suculenta'], catalogIds = ['sansevieria', 'hedera', 'succulent'];
    const nodes = variants.map((variant, i) => {
      const node = document.createElement('button'); node.classList.add('ihr-plant'); node.dataset.objectId = `plant:legacy-${i}`;
      stage.append(node); return node;
    });
    const entries = variants.map((variant, index) => ({ node:nodes[index], kind:'plant', key:nodes[index].dataset.objectId,
      variant, seed:`legacy-${index}`, width:48, height:110, x:90 + index * 100, y:165 }));
    const layout = { stage, width:390, sceneWidth:390, height:750, trashNode,
      rows:[{ top:20,bottom:220 },{ top:260,bottom:460 },{ top:500,bottom:700 }], entries };
    shelf.updateLayout(layout);
    const furniture = gpu.scene.children.find(child => child.children.some(object => object.userData.furniture));
    const models = furniture.children.filter(child => child.userData.entry?.kind === 'plant');
    expect(models).toHaveLength(3); expect(shelf.canvas.dataset.plantGeometry).toBe('catalog-3d');
    for (const [index, node] of nodes.entries()) {
      expect(node.dataset.plantModelCatalogId).toBe(catalogIds[index]);
      expect(node.dataset.plantLeafTexture).toBe('procedural'); expect(node.dataset.plantLeafOpacity).toBe('opaque');
      expect(Number(node.dataset.plantModelDepth)).toBeGreaterThan(1);
      expect(models[index].getObjectByName('leaf-0').material.map.isDataTexture).toBe(true);
    }
    expect(THREE.TextureLoader.prototype.load.mock.calls.some(([url]) => String(url).includes('botanical-leaves'))).toBe(false);
    showTrash(); shelf.setMode('spine', { animate:false }); shelf.flush();
    shelf.updateLayout({ ...layout, entries:entries.map(entry => ({ ...entry })) });
    expect(furniture.children.filter(child => child.userData.entry?.kind === 'plant')).toEqual(models);
    expect(nodes.every(node => node.querySelectorAll('.ihr-plant-foliage').length === 1)).toBe(true);
  });

  it('shows the attached catalogue only in the fitted diagonal view and ignores attempted ISO scroll', () => {
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
    expect(scroll).toBe(0); expect(catalogNode.hidden).toBe(false); expect(catalogNode.tabIndex).toBe(0);
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

  it('projects the grounded bin in the fitted right-side room and keeps its target fixed during attempted ISO scroll', () => {
    showTrash();
    const before = trashNode.getBoundingClientRect();
    expect(binModel().position.x - binModel().userData.radius).toBeGreaterThan(390 / 2);
    expect(before.right).toBeLessThanOrEqual(scroller.getBoundingClientRect().right);
    expect(before.bottom).toBeLessThan(780);
    expect(shelf.hitTrash(before.left + before.width / 2, before.top + before.height / 2)).toBe(true);
    expect(shelf.hitTrash(80, 120)).toBe(false);
    scroll = 240; shelf.flush();
    const after = trashNode.getBoundingClientRect();
    expect(scroll).toBe(0); expect(after.top).toBeCloseTo(before.top); expect(after.left).toBeCloseTo(before.left);
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
