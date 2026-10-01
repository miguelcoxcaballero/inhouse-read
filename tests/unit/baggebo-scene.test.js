import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { createBookshelfScene, projectShelfDropPosition } from '../../src/js/bookshelf-scene.js';
import { baggeboLayout } from '../../src/js/shelf-model-layout.js';
import { BAGGEBO_SPEC } from '../../src/js/shelf-types.js';

const gpu = vi.hoisted(() => ({ scene:null }));
vi.mock('../../src/js/book-model.js', async () => {
  const Three = await import('three');
  let ratio = 1;
  const size = new Three.Vector2();
  const renderer = { domElement:document.createElement('canvas'), shadowMap:{},
    capabilities:{ getMaxAnisotropy:() => 1 }, getPixelRatio:() => ratio,
    setPixelRatio:value => { ratio = value; }, getSize:target => target.copy(size),
    setSize:(width, height) => size.set(width, height),
    render:scene => { gpu.scene = scene; } };
  return { getBookRenderer:() => renderer, lightBookScene(scene) {
      scene.add(new Three.HemisphereLight(0xffffff, 0x666666, .5));
      scene.add(new Three.DirectionalLight(0xffffff, 1.9));
      scene.environmentIntensity = .55;
    },
    createBookModel(book, style, width, height, thickness, coverUrl, options = {}) {
      const model = new Three.Group(); model.name = `book:${book.id}`;
      model.add(new Three.Mesh(new Three.BoxGeometry(width, height, thickness), new Three.MeshStandardMaterial()));
      model.userData.overview = Boolean(options.overview);
      model.userData.inspectionResolution = options.inspectionResolution || 0;
      model.userData.dispose = () => model.traverse(child => { child.geometry?.dispose(); child.material?.dispose(); });
      return model;
    } };
});

let shelf, stage, scroller, frames, clock;
const rect = (left, top, width, height) => ({ left, top, width, height, right:left + width, bottom:top + height });
const floor = () => gpu.scene.getObjectByName('Library floor');
const cabinet = () => floor().parent.children.find(child => child.userData.furniture);
function flushFrames() {
  for (let index = 0; frames.size && index < 100; index++) {
    clock += 16;
    const callbacks = [...frames.values()]; frames.clear();
    for (const callback of callbacks) callback(clock);
  }
}
function layout(rowCount = 3, width = 390) {
  const rows = Array.from({ length:rowCount }, (_, index) => ({ top:20 + index * 220, bottom:220 + index * 220 }));
  const entries = rows.map((row, index) => {
    const node = document.createElement('button'); node.classList.add('ihr-spine'); node.dataset.bookId = String(index); stage.append(node);
    return { node, book:{ id:String(index), title:`Book ${index}`, author:'Author' },
      style:{ width:28, heightRatio:1, coverRatio:2.5 }, shelf:index, depthInset:0,
      x:80, y:row.bottom - 90, width:450, height:180, thickness:28 };
  });
  return { stage, scroller, width, sceneWidth:width, height:rows.at(-1).bottom + 35, rows, entries };
}
function mount(data) {
  shelf = createBookshelfScene(data);
  shelf.canvas.getBoundingClientRect = () => rect(20, 60, data.sceneWidth, 700);
  shelf.flush(); flushFrames();
}

beforeEach(() => {
  clock = 0; frames = new Map(); gpu.scene = null;
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
  stage.getBoundingClientRect = () => rect(20, 60, 390, parseFloat(stage.style.height) || 750);
});

afterEach(() => {
  shelf?.dispose(); shelf = null; document.body.innerHTML = '';
  vi.restoreAllMocks(); vi.unstubAllGlobals();
});

describe('BAGGEBO in the retained shelf scene', () => {
  it('adds exact three-row units for overflow, keeps every book, and caps covers without deepening the frame', () => {
    const raw = layout(7), data = baggeboLayout(raw), scale = raw.width / BAGGEBO_SPEC.width;
    mount(data);
    expect(data.unitCount).toBe(3); expect(data.rows).toHaveLength(9);
    expect(shelf.canvas.dataset.shelfUnits).toBe('3');
    expect(cabinet().children).toHaveLength(3);
    for (const unit of cabinet().children) {
      expect(unit.userData.physicalDimensions).toEqual({ width:390, height:1160 * scale, depth:250 * scale });
      expect(unit.userData.shelfPositions).toHaveLength(3);
    }
    expect(data.entries.map(entry => entry.book.id)).toEqual(raw.entries.map(entry => entry.book.id));
    for (const entry of data.entries) {
      expect(entry.width).toBeLessThanOrEqual(BAGGEBO_SPEC.usableDepth * scale);
      expect(entry.y + entry.height / 2).toBeCloseTo(data.rows[entry.shelf].bottom);
      const pose = shelf.getBookPose(entry.node); expect(pose).not.toBeNull();
      expect(pose.width).toBe(entry.width);
      const row = data.rows[entry.shelf];
      const target = new THREE.Vector3(-data.width / 2 + row.left + 80, -(row.top + row.bottom) / 2, 0);
      const ray = new THREE.Ray(target.clone().add(new THREE.Vector3(0, 0, 100)), new THREE.Vector3(0, 0, -1));
      expect(projectShelfDropPosition(ray, new THREE.Matrix4(), data.rows, data.width).shelf).toBe(entry.shelf);
    }
    const depth = floor().geometry.parameters.depth, first = data.entries[0];
    shelf.updateEntry(first.node, first.book, { ...first.style, heightRatio:4, coverRatio:2.5 }); shelf.flush();
    expect(shelf.getBookPose(first.node).width).toBeLessThanOrEqual(BAGGEBO_SPEC.usableDepth * scale);
    expect(floor().geometry.parameters.depth).toBe(depth);
    expect(depth).toBeCloseTo(BAGGEBO_SPEC.depth * scale + 210);
  });

  it('rebuilds the local floor at the physical feet after an isometric resize, independent of world rotation', () => {
    const raw = layout(), trashNode = document.createElement('button'); stage.append(trashNode);
    mount(baggeboLayout({ ...raw, trashNode }));
    shelf.setMode('isometric', { animate:false }); shelf.flush();
    expect(floor().parent.rotation.y).not.toBe(0);
    const resized = baggeboLayout({ ...raw, width:320, sceneWidth:320, trashNode });
    shelf.updateLayout(resized); shelf.flush();
    const ground = floor().position.y + floor().geometry.boundingBox.max.y;
    expect(ground).toBeCloseTo(-BAGGEBO_SPEC.height * 320 / BAGGEBO_SPEC.width, 6);
    expect(Number(shelf.canvas.dataset.cabinetFloorY)).toBeCloseTo(ground, 6);
    expect(Number(shelf.canvas.dataset.trashFootY)).toBeCloseTo(ground, 6);
    expect(shelf.canvas.dataset.trashFootWorld).toBe(shelf.canvas.dataset.floorContactWorld);
    expect(shelf.canvas.dataset.fullCabinetInFrame).toBe('true');
  });

  it('removes the metal shelf depth inset when retained books switch back to walnut', () => {
    const raw = layout(), metal = baggeboLayout(raw);
    mount(metal);
    const node = raw.entries[0].node;
    const parked = () => floor().parent.children.find(child => child.name === 'book:0').userData.entry;
    expect(parked().depthInset).toBe(15 * raw.width / BAGGEBO_SPEC.width);
    shelf.updateLayout({ ...raw, shelfType:'walnut' }); shelf.flush();
    const entry = parked();
    expect(entry.node).toBe(node); expect(entry.depthInset).toBe(0);
    expect(entry.pose.position.z).toBe(-entry.width / 2);
    expect(shelf.canvas.dataset.shelfType).toBe('walnut');
  });

  it('releases physical mesh, paint and retained walnut resources once on final disposal', () => {
    const raw = layout(); mount(raw);
    const woodMaterials = new Set(cabinet().children.map(mesh => mesh.material));
    expect(woodMaterials.size).toBe(3);
    shelf.updateLayout(baggeboLayout(raw)); shelf.flush();
    const owned = new Set(woodMaterials);
    cabinet().traverse(mesh => {
      if (!mesh.isMesh) return;
      owned.add(mesh.geometry); owned.add(mesh.material);
      for (const resource of [mesh.material.alphaMap, mesh.material.bumpMap, mesh.customDepthMaterial, mesh.customDistanceMaterial])
        if (resource) owned.add(resource);
    });
    expect([...owned].filter(resource => resource.isDataTexture)).toHaveLength(1);
    expect([...owned].filter(resource => resource.isMeshDepthMaterial || resource.isMeshDistanceMaterial)).toHaveLength(0);
    const releases = new Map([...owned].map(resource => [resource, 0]));
    for (const resource of owned) resource.addEventListener('dispose', () => releases.set(resource, releases.get(resource) + 1));
    shelf.dispose(); shelf = null;
    for (const count of releases.values()) expect(count).toBe(1);
    expect(frames.size).toBe(0);
  });

  it('receives lamp light on a separate room wall while preserving the open frame and daylight after removal', () => {
    const raw = layout(), data = baggeboLayout(raw); mount(data);
    shelf.setMode('isometric', { animate:false }); shelf.flush();
    const roomWall = gpu.scene.getObjectByName('Library room wall');
    expect(roomWall.receiveShadow).toBe(true); expect(roomWall.castShadow).toBe(false);
    expect(roomWall.userData.furniture).toBeUndefined();
    expect(roomWall.position.z).toBeLessThan(-BAGGEBO_SPEC.depth * raw.width / BAGGEBO_SPEC.width);
    const hits = []; roomWall.raycast(null, hits); expect(hits).toEqual([]);
    const lights = gpu.scene.children.filter(child => child.isLight);
    const daylight = lights.map(light => light.intensity);
    const lampNode = document.createElement('button'); stage.append(lampNode);
    const lamp = { node:lampNode, key:'lamp:test', kind:'lamp', lampId:'mittled', mount:'undershelf',
      x:150, y:data.rows[0].ceiling, width:44.2, height:7.15, depth:44.2, shelf:0 };
    shelf.updateLayout({ ...data, entries:[...data.entries, lamp] }); shelf.flush();
    expect(shelf.canvas.dataset.activeLampLights).toBe('1');
    lights.forEach((light, index) => expect(light.intensity).toBeCloseTo(daylight[index] * .82));
    expect(gpu.scene.environmentIntensity).toBeCloseTo(.55 * .82);
    expect(shelf.canvas.dataset.fullCabinetInFrame).toBe('true');
    shelf.updateLayout(data); shelf.flush();
    lights.forEach((light, index) => expect(light.intensity).toBe(daylight[index]));
    expect(gpu.scene.environmentIntensity).toBe(.55);
    const releases = { material:0, geometry:0 };
    roomWall.material.addEventListener('dispose', () => releases.material++);
    roomWall.geometry.addEventListener('dispose', () => releases.geometry++);
    shelf.dispose(); shelf = null; expect(releases).toEqual({ material:1, geometry:1 });
  });
});
