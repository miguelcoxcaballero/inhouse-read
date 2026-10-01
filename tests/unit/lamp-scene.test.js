import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { createBookshelfScene, projectShelfDropPosition } from '../../src/js/bookshelf-scene.js';
import { createShelfLampLighting, MAX_SHELF_LAMP_LIGHTS } from '../../src/js/shelf-lamp-lighting.js';

const gpu = vi.hoisted(() => ({ scene:null }));
vi.mock('../../src/js/book-model.js', async () => {
  const Three = await import('three');
  let ratio = 1;
  const size = new Three.Vector2();
  const renderer = { domElement:document.createElement('canvas'), shadowMap:{},
    capabilities:{ getMaxAnisotropy:() => 1 }, getPixelRatio:() => ratio,
    setPixelRatio:value => { ratio = value; }, getSize:target => target.copy(size),
    setSize:(width, height) => size.set(width, height), render:scene => { gpu.scene = scene; } };
  return { getBookRenderer:() => renderer, lightBookScene() {},
    createBookModel(book, style, width, height, thickness) {
      const model = new Three.Group(); model.name = `book:${book.id}`;
      const binding = new Three.Mesh(new Three.BoxGeometry(width, height, thickness), new Three.MeshStandardMaterial());
      binding.name = 'binding'; model.add(binding);
      model.userData.dispose = () => { binding.geometry.dispose(); binding.material.dispose(); };
      return model;
    } };
});
vi.mock('../../src/js/shelf-lamps.js', async () => {
  const Three = await import('three');
  return { createShelfLamp({ lampId, width, height }) {
    const model = new Three.Group(); model.name = `lamp:${lampId}`;
    const puck = lampId === 'mittled';
    const solid = new Three.Mesh(new Three.BoxGeometry(width, height, width), new Three.MeshStandardMaterial());
    solid.name = puck ? 'lamp-housing' : 'lamp-base'; solid.position.y = (puck ? -1 : 1) * height / 2;
    solid.castShadow = true;
    model.add(solid);
    const glow = new Three.Mesh(new Three.SphereGeometry(1), new Three.MeshStandardMaterial({ emissive:0xffd19a }));
    glow.name = 'warm-led-bulb'; glow.castShadow = false; glow.position.y = puck ? -height / 2 : height * .6; model.add(glow);
    model.userData.lightEmitter = { position:[0, puck ? -height : height * .6, 0],
      color:0xffd19a, intensity:10000, distance:500,
      ...(puck ? { direction:[0, -1, 0] } : {}) };
    model.userData.dispose = vi.fn(() => model.traverse(object => { object.geometry?.dispose(); object.material?.dispose(); }));
    return model;
  } };
});

let shelf, stage, scroller, frames, clock;
const rect = (left, top, width, height) => ({ left, top, width, height, right:left + width, bottom:top + height });
const fixtureLights = scene => scene.children.filter(object => object.userData.shelfLamp);
function flushFrames() {
  for (let index = 0; frames.size && index < 100; index++) {
    clock += 16; const callbacks = [...frames.values()]; frames.clear();
    for (const callback of callbacks) callback(clock);
  }
}
function layout() {
  const rows = [{ top:20, ceiling:12, bottom:220 }, { top:250, ceiling:235, bottom:450 }, { top:480, ceiling:465, bottom:680 }];
  const entries = [
    { kind:'lamp', key:'lamp:table', lampId:'tarnaby', mount:'standing', x:85, y:170, width:60, height:100, depth:60, shelf:0 },
    { kind:'lamp', key:'lamp:puck', lampId:'mittled', mount:'undershelf', x:160, y:12, width:30, height:5, depth:30, shelf:0 }
  ].map(entry => {
    entry.node = document.createElement('button'); entry.node.className = 'ihr-lamp'; entry.node.dataset.objectId = entry.key;
    stage.append(entry.node); return entry;
  });
  return { stage, scroller, width:390, sceneWidth:390, height:715, rows, entries };
}
function mount(data) {
  shelf = createBookshelfScene(data); shelf.canvas.getBoundingClientRect = () => rect(0, 60, 390, 700);
  shelf.flush(); flushFrames();
}

beforeEach(() => {
  clock = 0; frames = new Map(); gpu.scene = null; let serial = 0;
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
  scroller.getBoundingClientRect = () => rect(0, 60, 390, 700);
  stage.getBoundingClientRect = () => rect(0, 60, 390, parseFloat(stage.style.height) || 715);
});
afterEach(() => {
  shelf?.dispose(); shelf = null; document.body.innerHTML = '';
  vi.restoreAllMocks(); vi.unstubAllGlobals();
});

describe('warm lamps in the retained shelf scene', () => {
  it('mounts a round light under the ceiling and stands the tabletop lamp on the board', () => {
    const data = layout(); mount(data);
    const table = gpu.scene.getObjectByName('lamp:tarnaby'), puck = gpu.scene.getObjectByName('lamp:mittled');
    expect(table.position.y).toBe(-data.rows[0].bottom);
    expect(puck.position.y).toBe(-data.rows[0].ceiling);
    expect(puck.position.z).toBe(-gpu.scene.getObjectByName('Library floor').geometry.parameters.depth / 2 + 105);
    const localBounds = new THREE.Box3().setFromObject(puck).applyMatrix4(puck.parent.matrixWorld.clone().invert());
    expect(localBounds.max.y).toBeCloseTo(-data.rows[0].ceiling);
    expect(localBounds.min.y).toBeCloseTo(-data.rows[0].ceiling - 5);
    expect(shelf.canvas.dataset.activeBooks).toBe('0'); expect(shelf.canvas.dataset.activeLamps).toBe('2');
    expect(shelf.getBookPose(data.entries[0].node)).toBeNull();
    expect(shelf.getReturnPose(data.entries[0].node)).toBeNull();
    expect(shelf.returnBook(data.entries[0].node)).toBeNull();
    expect(data.entries[0].node.dataset.sceneHitSurface).toBe('lamp');
    expect(data.entries[1].node.dataset.sceneHitSurface).toBe('ceiling-lamp');
    expect(table.getObjectByName('lamp-base').castShadow).toBe(true);
    expect(table.getObjectByName('warm-led-bulb').castShadow).toBe(false);
    const [bulb, spot] = fixtureLights(gpu.scene);
    expect(bulb.isPointLight).toBe(true); expect(bulb.castShadow).toBe(false);
    expect(spot.isSpotLight).toBe(true); expect(spot.castShadow).toBe(true);
    expect(spot.target.position.y).toBeLessThan(spot.position.y);
    expect(spot.shadow.mapSize.toArray()).toEqual([512,512]);
    expect(frames.size).toBe(0);
  });

  it('keeps physical light placement and irradiance consistent during isometric zoom and moves', () => {
    const data = layout(); mount(data);
    shelf.setMode('isometric', { animate:false }); shelf.flush();
    const table = gpu.scene.getObjectByName('lamp:tarnaby');
    const light = fixtureLights(gpu.scene).find(light => light.isPointLight);
    const initial = { intensity:light.intensity, distance:light.distance, scale:table.getWorldScale(new THREE.Vector3()).x };
    shelf.zoomTo(3); shelf.flush();
    const scale = table.getWorldScale(new THREE.Vector3()).x / initial.scale;
    expect(light.intensity / initial.intensity).toBeCloseTo(scale * scale);
    expect(light.distance / initial.distance).toBeCloseTo(scale);
    expect(light.position.distanceTo(table.localToWorld(new THREE.Vector3(0, 60, 0)))).toBeLessThan(1e-7);
    shelf.zoomTo(1); shelf.flush();
    const oldPuck = gpu.scene.getObjectByName('lamp:mittled');
    shelf.updateLayout({ ...data, entries:data.entries.map(entry => entry.lampId === 'mittled'
      ? { ...entry, y:data.rows[1].ceiling, x:220, shelf:1 } : entry) }); shelf.flush();
    expect(gpu.scene.getObjectByName('lamp:mittled')).toBe(oldPuck);
    expect(oldPuck.position.y).toBe(-data.rows[1].ceiling);
    const spot = fixtureLights(gpu.scene).find(light => light.isSpotLight);
    expect(spot.position.distanceTo(oldPuck.localToWorld(new THREE.Vector3(0, -5, 0)))).toBeLessThan(1e-7);
    expect(shelf.canvas.dataset.activeLamps).toBe('2');
  });

  it('releases the removed model and source without retaining native targets or GPU shadows', () => {
    const data = layout(); mount(data);
    const puck = gpu.scene.getObjectByName('lamp:mittled');
    const spot = fixtureLights(gpu.scene).find(light => light.isSpotLight), shadow = { dispose:vi.fn() };
    spot.shadow.map = shadow;
    shelf.updateLayout({ ...data, entries:[data.entries[0]] }); shelf.flush();
    expect(puck.userData.dispose).toHaveBeenCalledTimes(1);
    expect(shadow.dispose).toHaveBeenCalledTimes(1); expect(spot.parent).toBeNull(); expect(spot.target.parent).toBeNull();
    expect(fixtureLights(gpu.scene)).toHaveLength(1);
    const table = gpu.scene.getObjectByName('lamp:tarnaby');
    shelf.dispose(); shelf = null;
    expect(table.userData.dispose).toHaveBeenCalledTimes(1); expect(fixtureLights(gpu.scene)).toHaveLength(0);
    expect(frames.size).toBe(0);
  });

  it('shows an under-shelf placement guide below the mounting ceiling instead of on the floor', () => {
    const data = layout(); mount(data);
    shelf.setDropPosition({ shelf:1, x:.5, mount:'undershelf' }); shelf.flush();
    const marker = gpu.scene.getObjectByName('Library floor').parent.children.find(object => object.userData.dropMarker);
    expect(marker.position.y).toBe(-data.rows[1].ceiling);
    expect(marker.children[0].position.y).toBeLessThan(0);
    expect(marker.children[0].scale.y).toBeLessThan(data.rows[1].bottom - data.rows[1].ceiling);
    expect(shelf.canvas.dataset.dropMount).toBe('undershelf');
    shelf.setDropPosition({ shelf:1, x:.5 }); shelf.flush();
    expect(marker.position.y).toBe(-data.rows[1].bottom);
    expect(marker.children[0].position.y).toBeGreaterThan(0);
    expect(shelf.canvas.dataset.dropMount).toBe('');
  });
});

describe('under-shelf drop projection', () => {
  const rows = [{ top:20, ceiling:12, bottom:220 }, { top:250, ceiling:235, bottom:450 }, { top:480, ceiling:465, bottom:680 }];
  const transform = new THREE.Matrix4().compose(new THREE.Vector3(150, 400, 0),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(.58, -.48, 0)), new THREE.Vector3(.7, .7, .7));
  const rayThrough = point => {
    const world = point.clone().applyMatrix4(transform);
    return new THREE.Ray(world.clone().add(new THREE.Vector3(0, 0, 1000)), new THREE.Vector3(0, 0, -1));
  };
  it('keeps a horizontal isometric drag on its original ceiling and recovers the actual x coordinate', () => {
    const width = 390, depth = 155;
    for (const x of [-90, -30, 30]) {
      const ray = rayThrough(new THREE.Vector3(x, -rows[1].ceiling, -depth / 2));
      const floorTarget = projectShelfDropPosition(ray, transform, rows, width);
      // Projecting that same pointer onto the front selects the row above.
      expect(floorTarget.shelf).toBe(0);
      const roofTarget = projectShelfDropPosition(ray, transform, rows, width, { mount:'undershelf', depth });
      expect(roofTarget.shelf).toBe(1); expect(roofTarget.mount).toBe('undershelf');
      expect(roofTarget.x).toBeCloseTo((x + width / 2 - 16) / (width - 32));
    }
  });
  it('chooses the correct adjacent unit when equal-height ceilings share the same overview', () => {
    const width = 804, depth = 155;
    const joinedRows = [0, 414].flatMap(left => rows.map(row => ({ ...row, left, right:left + 390, padding:16 })));
    const ray = rayThrough(new THREE.Vector3(-width / 2 + 414 + 195, -rows[1].ceiling, -depth / 2));
    expect(projectShelfDropPosition(ray, transform, joinedRows, width, { mount:'undershelf', depth }))
      .toEqual({ shelf:4, x:expect.closeTo(.5, 8), mount:'undershelf' });
  });
});

describe('bounded lamp lighting', () => {
  function source(index, spotlight = true) {
    const model = new THREE.Group();
    model.userData.lightEmitter = { position:[0, -2, 0], color:0xffd19a, intensity:10000, distance:400,
      ...(spotlight ? { direction:[0, -1, 0] } : {}) };
    model.position.set(index * 50, -100, -80);
    return { kind:'lamp', key:`lamp:${index}`, model, width:40, rect:{ top:index * 100, bottom:index * 100 + 40 }, node:document.createElement('button') };
  }
  it('caps active sources and cone shadows, and prioritizes a lamp being dragged', () => {
    const scene = new THREE.Scene(), manager = createShelfLampLighting(scene), entries = Array.from({ length:10 }, (_, index) => source(index));
    for (const entry of entries) scene.add(entry.model);
    expect(manager.update(entries, { viewportHeight:600 })).toBe(true);
    expect(manager.activeCount).toBe(MAX_SHELF_LAMP_LIGHTS); expect(manager.shadowCount).toBe(2);
    expect(fixtureLights(scene)).toHaveLength(4);
    entries[9].node.classList.add('is-dragging'); manager.update(entries, { viewportHeight:600 });
    expect(fixtureLights(scene).some(light => light.userData.entryKey === 'lamp:9')).toBe(true);
    manager.dispose(); expect(fixtureLights(scene)).toHaveLength(0);
  });
  it('reuses stable light resources at rest and excludes lamps away or falling into the bin', () => {
    const scene = new THREE.Scene(), manager = createShelfLampLighting(scene), a = source(0, false), b = source(1);
    scene.add(a.model, b.model);
    manager.update([a, b]); const initial = fixtureLights(scene);
    expect(manager.update([a, b])).toBe(false); expect(fixtureLights(scene)).toEqual(initial);
    a.node.classList.add('is-away'); b.trashDrop = {};
    expect(manager.update([a, b])).toBe(true); expect(manager.activeCount).toBe(0);
    manager.dispose(); expect(manager.update([a, b])).toBe(false);
  });
  it('changes a fixture range independently of its power and preserves irradiance through scene scaling', () => {
    const scene = new THREE.Scene(),manager = createShelfLampLighting(scene),entry = source(0,false);
    scene.add(entry.model); manager.update([entry]);
    const light = fixtureLights(scene)[0],intensity = light.intensity;
    entry.model.userData.lightEmitter.distance = 700;
    expect(manager.update([entry])).toBe(true);
    expect(light.distance).toBe(700); expect(light.intensity).toBe(intensity);
    // Screen fitting and finger zoom scale both geometry and light distance;
    // their inverse-square irradiance must stay unchanged at a book surface.
    const before = light.intensity / 200 ** light.decay;
    entry.model.scale.setScalar(.6); manager.update([entry]);
    expect(light.distance).toBe(420);
    expect(light.intensity / 120 ** light.decay).toBeCloseTo(before,8);
    expect(manager.update([entry])).toBe(false);
    manager.dispose();
  });
});
