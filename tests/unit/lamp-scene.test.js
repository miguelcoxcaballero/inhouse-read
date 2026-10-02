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
  return { createShelfLamp({ lampId, width, height, isOn = true }) {
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
    model.userData.setPower = vi.fn(power => {
      model.userData.lightEmitter.power = power;
      glow.material.emissiveIntensity = power;
    });
    model.userData.setPower(isOn === false ? 0 : 1);
    model.userData.dispose = vi.fn(() => model.traverse(object => { object.geometry?.dispose(); object.material?.dispose(); }));
    return model;
  } };
});

let shelf, stage, scroller, frames, clock;
const rect = (left, top, width, height) => ({ left, top, width, height, right:left + width, bottom:top + height });
const fixtureLights = scene => scene.children.filter(object => object.userData.shelfLamp);
// The pool of lights stays in the scene (the lights' count is part of every
// shader); a lamp that is unlit has a slot with zero intensity.
const litLights = scene => fixtureLights(scene).filter(light => light.intensity > 0);
function advanceFrame(milliseconds = 16) {
  clock += milliseconds; const callbacks = [...frames.values()]; frames.clear();
  for (const callback of callbacks) callback(clock);
}
function flushFrames() {
  for (let index = 0; frames.size && index < 100; index++) {
    advanceFrame();
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
    // The front edge remains flush with the cabinet, making the underside
    // diffuser reachable beneath an opaque board from the isometric view.
    expect(puck.position.z).toBe(8 - data.entries[1].depth / 2);
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
    const bulb = fixtureLights(gpu.scene).find(light => light.isPointLight), spot = fixtureLights(gpu.scene).find(light => light.isSpotLight);
    expect(fixtureLights(gpu.scene)).toHaveLength(2);
    expect(bulb.castShadow).toBe(false);
    expect(spot.castShadow).toBe(true);
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

  it('fades the emitting material and actual light together without recreating models or refreshing static shadows', () => {
    const data = layout(); mount(data);
    const [tableNode, puckNode] = data.entries.map(entry => entry.node);
    const table = gpu.scene.getObjectByName('lamp:tarnaby'), puck = gpu.scene.getObjectByName('lamp:mittled');
    const geometry = table.getObjectByName('lamp-base').geometry;
    const glow = table.getObjectByName('warm-led-bulb').material;
    const creations = shelf.canvas.dataset.modelCreations;
    const point = fixtureLights(gpu.scene).find(light => light.isPointLight), intensity = point.intensity;
    const spot = fixtureLights(gpu.scene).find(light => light.isSpotLight);
    spot.shadow.needsUpdate = false;

    shelf.setLampPower(tableNode, false);
    advanceFrame(110);
    const power = table.userData.lightEmitter.power;
    expect(power).toBeGreaterThan(0); expect(power).toBeLessThan(1);
    expect(Number(tableNode.dataset.lampPower)).toBeCloseTo(power, 4);
    expect(glow.emissiveIntensity).toBe(power);
    expect(point.intensity / intensity).toBeCloseTo(power, 8);
    expect(puckNode.dataset.lampPower).toBe('1.0000');
    expect(puck.userData.lightEmitter.power).toBe(1);
    expect(spot.shadow.needsUpdate).toBe(false);
    expect(frames.size).toBe(1);

    advanceFrame(110);
    expect(tableNode.dataset.lampPower).toBe('0.0000');
    expect(glow.emissiveIntensity).toBe(0);
    // Switching off only zeroes the light: the room's lights, and so its shaders, stay the same.
    expect(litLights(gpu.scene)).toEqual([spot]);
    expect(fixtureLights(gpu.scene)).toHaveLength(2); expect(point.parent).toBe(gpu.scene); expect(point.intensity).toBe(0);
    expect(shelf.canvas.dataset.activeLampLights).toBe('1');
    expect(frames.size).toBe(0); expect(spot.shadow.needsUpdate).toBe(false);

    shelf.setLampPower(tableNode, true);
    advanceFrame(110);
    const restoredPoint = fixtureLights(gpu.scene).find(light => light.isPointLight);
    expect(restoredPoint).toBe(point);
    expect(restoredPoint.intensity / intensity).toBeCloseTo(table.userData.lightEmitter.power, 8);
    expect(glow.emissiveIntensity).toBe(table.userData.lightEmitter.power);
    advanceFrame(110);
    expect(tableNode.dataset.lampPower).toBe('1.0000');
    expect(glow.emissiveIntensity).toBe(1); expect(restoredPoint.intensity).toBe(intensity);
    expect(gpu.scene.getObjectByName('lamp:tarnaby')).toBe(table);
    expect(table.getObjectByName('lamp-base').geometry).toBe(geometry);
    expect(gpu.scene.getObjectByName('lamp:mittled')).toBe(puck);
    expect(shelf.canvas.dataset.modelCreations).toBe(creations);
    expect(table.userData.dispose).not.toHaveBeenCalled();
    expect(frames.size).toBe(0); expect(spot.shadow.needsUpdate).toBe(false);
  });

  it('reverses a lamp transition from its current brightness without changing another lamp', () => {
    const data = layout(); data.entries[0].isOn = false; mount(data);
    const node = data.entries[0].node, table = gpu.scene.getObjectByName('lamp:tarnaby');
    const puck = gpu.scene.getObjectByName('lamp:mittled');
    const creations = shelf.canvas.dataset.modelCreations;
    expect(node.dataset.lampPower).toBe('0.0000');
    expect(litLights(gpu.scene)).toHaveLength(1); expect(fixtureLights(gpu.scene)).toHaveLength(2);

    shelf.setLampPower(node, true); advanceFrame(60);
    const warming = table.userData.lightEmitter.power;
    expect(warming).toBeGreaterThan(0); expect(warming).toBeLessThan(1);
    shelf.setLampPower(node, false); advanceFrame(0);
    expect(table.userData.lightEmitter.power).toBe(warming);
    advanceFrame(60);
    const cooling = table.userData.lightEmitter.power;
    expect(cooling).toBeGreaterThan(0); expect(cooling).toBeLessThan(warming);
    shelf.setLampPower(node, true); advanceFrame(0);
    expect(table.userData.lightEmitter.power).toBe(cooling);
    advanceFrame(20);
    expect(table.userData.lightEmitter.power).toBeGreaterThan(cooling);
    expect(puck.userData.lightEmitter.power).toBe(1);
    expect(data.entries[1].node.dataset.lampPower).toBe('1.0000');
    flushFrames();
    expect(node.dataset.lampPower).toBe('1.0000'); expect(frames.size).toBe(0);
    expect(gpu.scene.getObjectByName('lamp:tarnaby')).toBe(table);
    expect(shelf.canvas.dataset.modelCreations).toBe(creations);
  });

  it('retains a switched-off model when rebinding a persisted off lamp into a new layout', () => {
    const data = layout(); mount(data);
    const oldNode = data.entries[0].node, table = gpu.scene.getObjectByName('lamp:tarnaby');
    const geometry = table.getObjectByName('lamp-base').geometry, creations = shelf.canvas.dataset.modelCreations;
    shelf.setLampPower(oldNode, false); flushFrames();
    const replacement = document.createElement('button'); replacement.className = 'ihr-lamp';
    replacement.dataset.objectId = oldNode.dataset.objectId; oldNode.replaceWith(replacement);
    const retained = { ...data.entries[0], node:replacement, x:120, isOn:false };
    shelf.updateLayout({ ...data, entries:[retained, data.entries[1]] });
    flushFrames();
    expect(replacement.dataset.lampPower).toBe('0.0000');
    expect(table.userData.lightEmitter.power).toBe(0);
    expect(table.getObjectByName('warm-led-bulb').material.emissiveIntensity).toBe(0);
    expect(litLights(gpu.scene).every(light => light.isSpotLight)).toBe(true);
    expect(shelf.canvas.dataset.activeLamps).toBe('2');
    expect(shelf.canvas.dataset.activeLampLights).toBe('1');
    expect(gpu.scene.getObjectByName('lamp:tarnaby')).toBe(table);
    expect(table.getObjectByName('lamp-base').geometry).toBe(geometry);
    expect(shelf.canvas.dataset.modelCreations).toBe(creations);
    shelf.setLampPower(oldNode, true); expect(frames.size).toBe(0);
    shelf.setLampPower(replacement, true, { animate:false }); advanceFrame(0);
    expect(replacement.dataset.lampPower).toBe('1.0000'); expect(frames.size).toBe(0);
  });

  it.each([false, true])('applies immediate power changes without leaving RAF work (reduced motion: %s)', reducedMotion => {
    window.matchMedia = () => ({ matches:reducedMotion });
    const data = layout(); mount(data);
    const node = data.entries[0].node, table = gpu.scene.getObjectByName('lamp:tarnaby');
    shelf.setLampPower(node, false, { animate:reducedMotion });
    advanceFrame(0);
    expect(node.dataset.lampPower).toBe('0.0000');
    expect(table.userData.lightEmitter.power).toBe(0);
    expect(table.getObjectByName('warm-led-bulb').material.emissiveIntensity).toBe(0);
    expect(litLights(gpu.scene)).toHaveLength(1); expect(fixtureLights(gpu.scene)).toHaveLength(2); expect(frames.size).toBe(0);
    shelf.setLampPower(node, true, { animate:reducedMotion });
    advanceFrame(0);
    expect(node.dataset.lampPower).toBe('1.0000');
    expect(table.userData.lightEmitter.power).toBe(1);
    expect(litLights(gpu.scene)).toHaveLength(2); expect(fixtureLights(gpu.scene)).toHaveLength(2); expect(frames.size).toBe(0);
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
    return { kind:'lamp', key:`lamp:${index}`, lampId:spotlight ? 'mittled' : undefined, model, width:40, rect:{ top:index * 100, bottom:index * 100 + 40 }, node:document.createElement('button') };
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
  it('powers each lamp independently, preserving full brightness for older emitters without a power value', () => {
    const scene = new THREE.Scene(), manager = createShelfLampLighting(scene);
    const a = source(0, false), b = source(1), legacy = source(2, false);
    scene.add(a.model, b.model, legacy.model);
    a.model.userData.lightEmitter.power = .35;
    b.model.userData.lightEmitter.power = .65;
    expect(manager.update([a, b, legacy])).toBe(true);
    const lights = new Map(fixtureLights(scene).map(light => [light.userData.entryKey, light]));
    expect(lights.get(a.key).intensity).toBe(3500);
    expect(lights.get(b.key).intensity).toBe(6500);
    expect(lights.get(legacy.key).intensity).toBe(10000);
    expect(manager.activePower).toBe(1);
    a.model.userData.lightEmitter.power = .25;
    expect(manager.update([a, b, legacy])).toBe(true);
    expect(lights.get(a.key).intensity).toBe(2500);
    expect(lights.get(b.key).intensity).toBe(6500);
    expect(lights.get(legacy.key).intensity).toBe(10000);
    expect(manager.update([a, b, legacy])).toBe(false);
    legacy.model.userData.lightEmitter.power = 0;
    manager.update([a, b, legacy]);
    expect(manager.activePower).toBe(.65);
    manager.dispose();
    expect(manager.activePower).toBe(0);
  });
  it('keeps an unpowered cone and its shadow resources in the pool, zeroed, so switching it on again is free', () => {
    const scene = new THREE.Scene(), manager = createShelfLampLighting(scene), entry = source(0);
    scene.add(entry.model); manager.update([entry]);
    const initial = fixtureLights(scene)[0], map = { dispose:vi.fn() }, blur = { dispose:vi.fn() };
    initial.shadow.map = map; initial.shadow.mapPass = blur; initial.shadow.needsUpdate = false;
    entry.model.userData.lightEmitter.power = 0;
    expect(manager.update([entry])).toBe(true);
    expect(manager.activeCount).toBe(0); expect(manager.shadowCount).toBe(0);
    expect(manager.activePower).toBe(0);
    // The light stays, with the same shadow flag: three's light state (and every shader) is unchanged.
    expect(fixtureLights(scene)).toEqual([initial]); expect(litLights(scene)).toHaveLength(0);
    expect(initial.intensity).toBe(0); expect(initial.castShadow).toBe(true);
    expect(map.dispose).not.toHaveBeenCalled(); expect(blur.dispose).not.toHaveBeenCalled();
    expect(manager.update([entry])).toBe(false);
    entry.model.userData.lightEmitter.power = .05;
    expect(manager.update([entry])).toBe(true);
    expect(fixtureLights(scene)[0]).toBe(initial); expect(initial.intensity).toBe(500);
    expect(manager.activePower).toBe(.05); expect(manager.shadowCount).toBe(1);
    // Nothing moved while it was off: its cached shadow is still valid.
    expect(initial.shadow.needsUpdate).toBe(false); expect(manager.shadowRefresh).toBe(false);
    expect(manager.update([entry])).toBe(false); expect(initial.shadow.needsUpdate).toBe(false);
    manager.dispose();
    expect(map.dispose).toHaveBeenCalledTimes(1); expect(blur.dispose).toHaveBeenCalledTimes(1);
    expect(fixtureLights(scene)).toHaveLength(0);
  });
  it('redraws a cone shadow that went stale while its lamp was off only once the lamp is lit again', () => {
    const scene = new THREE.Scene(), manager = createShelfLampLighting(scene), entry = source(0);
    scene.add(entry.model); manager.update([entry]);
    const light = fixtureLights(scene)[0]; light.shadow.needsUpdate = false;
    entry.model.userData.lightEmitter.power = 0; manager.update([entry]);
    expect(manager.update([entry], { shadowDirty:true })).toBe(false);
    entry.model.position.x += 30; expect(manager.update([entry])).toBe(false);
    expect(light.shadow.needsUpdate).toBe(false); expect(manager.shadowRefresh).toBe(false);
    entry.model.userData.lightEmitter.power = .5;
    expect(manager.update([entry])).toBe(true);
    expect(light.shadow.needsUpdate).toBe(true); expect(manager.shadowRefresh).toBe(true);
    manager.dispose();
  });
  it('keeps the same lights and shadow flags while lamps are switched, faded, scrolled out and back', () => {
    const scene = new THREE.Scene(), manager = createShelfLampLighting(scene);
    const entries = Array.from({ length:6 }, (_, index) => source(index));
    for (const entry of entries) scene.add(entry.model);
    const signature = () => fixtureLights(scene).map(light => `${light.type}:${light.castShadow}`).sort().join();
    manager.update(entries, { viewportHeight:600 });
    const lights = [...fixtureLights(scene)], expected = signature();
    expect(lights).toHaveLength(MAX_SHELF_LAMP_LIGHTS);
    const step = () => {
      manager.update(entries, { viewportHeight:600 });
      expect(signature()).toBe(expected); expect(fixtureLights(scene)).toEqual(lights);
    };
    for (const entry of entries) {
      for (const power of [.4, 0, 0, 1]) { entry.model.userData.lightEmitter.power = power; step(); }
      // A culled model (scrolled far away) is released, then built again.
      const { model } = entry; entry.model = null; step(); entry.model = model; step();
      entry.model.visible = false; step(); entry.model.visible = true; step();
    }
    for (const entry of entries) entry.model.userData.lightEmitter.power = 0;
    step(); expect(manager.activeCount).toBe(0);
    // Only the library's own lamps change the pool.
    manager.update(entries.slice(3), { viewportHeight:600 });
    expect(fixtureLights(scene)).toHaveLength(3);
    manager.dispose();
  });
  it('reserves the source and shadow budget for powered lamps, including when an off lamp is dragged', () => {
    const scene = new THREE.Scene(), manager = createShelfLampLighting(scene, { maxLights:2 });
    const entries = Array.from({ length:7 }, (_, index) => source(index));
    for (const entry of entries) {
      scene.add(entry.model);
      entry.model.userData.lightEmitter.power = Number([2, 4, 6].includes(Number(entry.key.split(':')[1])));
    }
    entries[0].node.classList.add('is-dragging');
    manager.update(entries, { viewportHeight:400 });
    expect(litLights(scene).map(light => light.userData.entryKey)).toEqual(['lamp:2', 'lamp:4']);
    expect(manager.activeCount).toBe(2); expect(manager.shadowCount).toBe(2);
    entries[6].node.classList.add('is-dragging');
    manager.update(entries, { viewportHeight:400 });
    expect(litLights(scene).map(light => light.userData.entryKey).sort()).toEqual(['lamp:2', 'lamp:6']);
    expect(manager.activeCount).toBe(2); expect(manager.shadowCount).toBe(2);
    entries[2].model.userData.lightEmitter.power = .2;
    entries[6].model.userData.lightEmitter.power = .4;
    manager.update(entries, { viewportHeight:400 });
    // An unselected full-power fixture must not dim the surrounding daylight.
    expect(manager.activePower).toBe(.4);
    manager.dispose();
  });
  it.each([false, true])('fades light output without regenerating a stationary cone shadow (room transform: %s)', withTransform => {
    const scene = new THREE.Scene(), room = new THREE.Group(), manager = createShelfLampLighting(scene), entry = source(0);
    scene.add(room); room.add(entry.model); room.updateMatrixWorld(true);
    entry.model.userData.lightEmitter.power = .05;
    const options = withTransform ? { transform:room.matrixWorld } : {};
    manager.update([entry], options);
    const light = fixtureLights(scene)[0];
    light.shadow.needsUpdate = false;
    const updateProjection = vi.spyOn(light.shadow, 'updateMatrices');
    for (const power of [.1, .2, .4, .7, 1, .6, .3, .05]) {
      entry.model.userData.lightEmitter.power = power;
      expect(manager.update([entry], options)).toBe(true);
      expect(fixtureLights(scene)[0]).toBe(light);
      expect(light.intensity).toBeCloseTo(10000 * power);
      expect(manager.activePower).toBe(power);
      expect(light.shadow.needsUpdate).toBe(false);
    }
    // Changing colour or base output also leaves caster depths untouched.
    entry.model.userData.lightEmitter.color = 0xffb060;
    entry.model.userData.lightEmitter.intensity = 12000;
    entry.model.userData.lightEmitter.decay = 1.8;
    entry.model.userData.lightEmitter.penumbra = .8;
    expect(manager.update([entry], options)).toBe(true);
    expect(light.intensity).toBe(600); expect(light.color.getHex()).toBe(0xffb060);
    expect(light.shadow.needsUpdate).toBe(false); expect(updateProjection).not.toHaveBeenCalled();
    expect(manager.update([entry], options)).toBe(false);
    // Actual caster movement still refreshes the shadow while the light fades.
    manager.update([entry], { ...options, shadowDirty:true });
    expect(light.shadow.needsUpdate).toBe(true);
    manager.dispose();
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

  it('keeps cone shadow coordinates exact during room zoom, pan and rotation without redrawing its map', () => {
    const scene = new THREE.Scene(), room = new THREE.Group(), manager = createShelfLampLighting(scene), entry = source(0);
    scene.add(room); room.add(entry.model); room.updateMatrixWorld(true);
    manager.update([entry], { transform:room.matrixWorld });
    const light = fixtureLights(scene)[0];
    light.shadow.updateMatrices(light); light.shadow.needsUpdate = false;
    const receiver = new THREE.Vector3(20, -260, -70);
    const projected = receiver.clone().applyMatrix4(light.shadow.matrix);
    let redraws = 0;
    for (let index = 1; index <= 60; index++) {
      room.scale.setScalar(1 + index / 40); room.position.set(index * 2, index / 2, 0);
      room.rotation.set(index / 200, -index / 100, index / 300); room.updateMatrixWorld(true);
      manager.update([entry], { transform:room.matrixWorld });
      redraws += Number(light.shadow.needsUpdate);
      const current = receiver.clone().applyMatrix4(room.matrixWorld).applyMatrix4(light.shadow.matrix);
      expect(current.distanceTo(projected)).toBeLessThan(1e-7);
    }
    expect(redraws).toBe(0);
    expect(manager.update([entry], { transform:room.matrixWorld })).toBe(false);
    // Relative fixture movement, another caster moving and emitter changes
    // are actual changes to the map, even when the camera also moves.
    entry.model.position.x += 10;
    expect(manager.update([entry], { transform:room.matrixWorld })).toBe(true);
    expect(light.shadow.needsUpdate).toBe(true); light.shadow.needsUpdate = false;
    manager.update([entry], { transform:room.matrixWorld, shadowDirty:true });
    expect(light.shadow.needsUpdate).toBe(true); light.shadow.needsUpdate = false;
    entry.model.userData.lightEmitter.angle = .8;
    manager.update([entry], { transform:room.matrixWorld });
    expect(light.shadow.needsUpdate).toBe(true);
    manager.dispose();
  });
});
