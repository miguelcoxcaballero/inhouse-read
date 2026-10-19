import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { createPlantCatalogPreview } from '../../src/js/plant-catalog-preview.js';
import { createShelfCatalogPreview } from '../../src/js/shelf-catalog-preview.js';
import { createLampCatalogPreview } from '../../src/js/lamp-catalog-preview.js';
import { createPlantCatalogPreview as frozenPlant } from './helpers/reference-plant-catalog-preview.js';
import { createShelfCatalogPreview as frozenShelf } from './helpers/reference-shelf-catalog-preview.js';
import { createLampCatalogPreview as frozenLamp } from './helpers/reference-lamp-catalog-preview.js';
import { rustShelf } from './helpers/rust-shelf-ready.js';

// The studios' loop (frames, builds, links, visibility, activity, recolouring, tint easing), their lights
// and the lamp's stand run in Rust (rust-ui/src/catalog_studio.rs). The frozen originals are the oracle:
// both are driven by the same pseudo-random scripts and every observable effect is compared step by step.

const log = vi.hoisted(() => ({ entries:[], renderers:[], models:[] }));
vi.mock('three', async importOriginal => {
  const three = await importOriginal();
  return { ...three,
    WebGLRenderer:class {
      constructor(options) {
        this.options = options; this.domElement = document.createElement('canvas');
        this.shadowMap = {}; this.capabilities = { getMaxAnisotropy:() => 4 };
        this.render = vi.fn((scene, camera) => log.entries.push(['render', camera.left, camera.right, camera.top, camera.bottom,
          ...camera.position.toArray(), ...camera.quaternion.toArray()]));
        this.setSize = vi.fn((...args) => log.entries.push(['setSize', ...args])); this.setPixelRatio = vi.fn();
        this.dispose = vi.fn(() => log.entries.push(['renderer.dispose'])); this.forceContextLoss = vi.fn(() => log.entries.push(['contextLoss']));
        log.renderers.push(this);
      }
    },
    PMREMGenerator:class {
      fromScene(room, sigma) {
        const cards = []; room.traverse(object => { if (object.isMesh) cards.push([...object.position.toArray(), ...object.quaternion.toArray(), object.material.color.getHex()]); });
        log.entries.push(['environment', sigma, JSON.stringify(cards)]);
        return { texture:new three.Texture(), dispose:() => log.entries.push(['environment.dispose']) };
      }
      dispose() {}
    }
  };
});
vi.mock('three/addons/environments/RoomEnvironment.js', async () => {
  const three = await import('three');
  return { RoomEnvironment:class extends three.Group { dispose() {} } };
});
function model(kind) {
  return async () => {
    const three = await import('three');
    return function create(options) {
      const group = new three.Group(), serial = log.models.length;
      group.name = `${kind}-${serial}`;
      group.add(new three.Mesh(new three.BoxGeometry(60 + serial, 100, 60), new three.MeshStandardMaterial()));
      log.entries.push(['create', kind, JSON.stringify(options ?? null)]);
      group.userData.setTint = tint => log.entries.push(['setTint', group.name, ...tint]);
      group.userData.dispose = () => log.entries.push(['model.dispose', group.name]);
      group.userData.updatePotColor = color => { log.entries.push(['recolour', group.name, color]); return color !== 'blue'; };
      // Lamps: a filament lamp, a cone and a bulb, in turn.
      if (kind === 'lamp') group.userData.lightEmitter = [{ position:[0, 10, 0], color:0xffd19a, intensity:40, distance:300, decay:2, filaments:[] },
        { position:[0, -2, 0], color:0xffc890, intensity:80, distance:400, decay:2, direction:[0, -1, 0], angle:.8, penumbra:.5 },
        { position:[0, 30, 0], color:0xffd2a0, intensity:20, distance:200, decay:2 }][serial % 3];
      log.models.push(group);
      return group;
    };
  };
}
vi.mock('../../src/js/shelf-plants.js', async () => ({ createShelfPlant:await model('plant')() }));
vi.mock('../../src/js/shelf-lamps.js', async () => ({ createShelfLamp:await model('lamp')() }));
vi.mock('../../src/js/shelf-furniture.js', async () => ({ createShelfFurniture:await model('walnut')() }));
vi.mock('../../src/js/baggebo-model.js', async () => ({ createBaggebo:await model('baggebo')() }));

let frames, observers, serial, visibility;
beforeEach(() => {
  log.entries.length = 0; log.renderers.length = 0; log.models.length = 0;
  frames = new Map(); observers = []; serial = 0; visibility = 'visible';
  vi.useFakeTimers({ toFake:['setTimeout', 'clearTimeout', 'performance'] });
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
  vi.stubGlobal('WebGLRenderingContext', function WebGLRenderingContext() {});
  vi.stubGlobal('requestAnimationFrame', callback => { const id = ++serial; frames.set(id, callback); return id; });
  vi.stubGlobal('cancelAnimationFrame', id => frames.delete(id));
  vi.stubGlobal('ResizeObserver', class { constructor(callback) { observers.push(callback); } observe() {} disconnect() { log.entries.push(['observer.disconnect']); } });
  vi.spyOn(THREE.TextureLoader.prototype, 'load').mockImplementation((url, onLoad) => { log.entries.push(['load', url]); setTimeout(() => onLoad?.(new THREE.Texture()), 40); return new THREE.Texture(); });
});
afterEach(() => { document.body.replaceChildren(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });

function random(seed) { let s = seed >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; }
const selections = {
  plant:[{ catalogId:'sansevieria', potId:'muskot', potColorId:'white' }, { catalogId:'sansevieria', potId:'muskot', potColorId:'terracotta' },
    { catalogId:'sansevieria', potId:'muskot', potColorId:'blue' }, { catalogId:'cactus', potId:'daidai', potColorId:'white' }],
  shelf:[{ shelfType:'walnut' }, { shelfType:'baggebo' }, { shelfType:' BAGGEBO ' }, { shelfType:'nonsense' }, {}],
  lamp:[{ lampId:'mittled' }, { lampId:'tripod', kelvin:3000 }, { lampId:'tarnaby', kelvin:2200 }, { lampId:'tarnaby' }, { lampId:'unknown' }, { lampId:'mittled', kelvin:4000 }]
};
const factories = { plant:[frozenPlant, createPlantCatalogPreview], shelf:[frozenShelf, createShelfCatalogPreview], lamp:[frozenLamp, createLampCatalogPreview] };

/** What a step left behind: frames and timers in flight, the host's attributes and text, and the scene. */
function snapshot(host, renderer) {
  const scene = renderer?.render.mock.calls.at(-1)?.[0];
  const graph = [];
  scene?.traverse(object => graph.push([object.type, object.name, object.visible, ...object.position.toArray(), ...object.rotation.toArray().slice(0, 3),
    object.intensity ?? null, object.color?.getHex?.() ?? null, object.castShadow, object.receiveShadow,
    object.isLight && object.shadow ? [object.shadow.bias, object.shadow.normalBias, object.shadow.mapSize.x, object.shadow.camera.left, object.shadow.camera.far] : null,
    object.material && !Array.isArray(object.material) ? [object.material.color?.getHex(), object.material.roughness] : null,
    object.geometry?.type ?? null, object.geometry?.parameters ? JSON.stringify(object.geometry.parameters) : null]));
  return { frames:frames.size, timers:vi.getTimerCount(), dataset:{ ...host.dataset }, text:host.textContent, children:host.childNodes.length,
    environment:scene?.environmentIntensity ?? null, shadow:renderer ? { ...renderer.shadowMap } : null,
    exposure:renderer ? [renderer.toneMapping, renderer.toneMappingExposure] : null, graph };
}

function run(kind, create, seed, steps) {
  log.entries.length = 0; log.renderers.length = 0; log.models.length = 0; frames.clear(); observers = []; serial = 0; visibility = 'visible';
  vi.clearAllTimers();
  const r = random(seed), host = document.createElement('div'); document.body.append(host);
  let width = 200; host.getBoundingClientRect = () => ({ width, height:300 });
  const preview = create(host), renderer = log.renderers[0], trace = [snapshot(host, renderer)];
  const choices = selections[kind];
  for (let step = 0; step < steps; step++) {
    const roll = r(), label = [];
    if (roll < .3) { const selection = choices[Math.floor(r() * choices.length)]; label.push('update', selection); preview.update(selection); }
    else if (roll < .45) { label.push('frames'); const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => callback(16)); }
    else if (roll < .6) { const ms = [0, 16, 40, 400][Math.floor(r() * 4)]; label.push('time', ms); vi.advanceTimersByTime(ms); }
    else if (roll < .68) { const value = r() < .5; label.push('active', value); preview.setActive(value); }
    else if (roll < .76) { visibility = visibility === 'hidden' ? 'visible' : 'hidden'; label.push('visibility', visibility); document.dispatchEvent(new Event('visibilitychange')); }
    else if (roll < .82) { width = 180 + Math.floor(r() * 3) * 30; label.push('resize', width); observers.forEach(notify => notify()); }
    else if (roll < .86 && kind === 'plant') { label.push('prepare'); preview.prepare(); }
    else if (roll < .88) { label.push('dispose'); preview.dispose(); }
    else { label.push('settle'); for (let round = 0; round < 10 && (frames.size || vi.getTimerCount()); round++) { const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => callback(16)); vi.runOnlyPendingTimers(); } }
    trace.push([JSON.stringify(label), snapshot(host, renderer), log.entries.splice(0)]);
  }
  preview.dispose(); preview.dispose();
  trace.push(['final', snapshot(host, renderer), log.entries.splice(0)]);
  host.remove();
  return trace;
}

describe.each(Object.keys(factories))('%s studio against the frozen JavaScript', kind => {
  it('does the same thing at every step of 40 random scripts', () => {
    const [frozen, production] = factories[kind];
    for (let seed = 1; seed <= 40; seed++) {
      const expected = run(kind, frozen, seed, 60), actual = run(kind, production, seed, 60);
      for (let step = 0; step < expected.length; step++) expect(actual[step], `${kind} seed ${seed} step ${step} ${expected[step][0]}`).toEqual(expected[step]);
    }
  });

  it('keeps no module handles and no callbacks once disposed', () => {
    const [, production] = factories[kind];
    const before = rustShelf.shelf_live_handles();
    for (let seed = 100; seed < 110; seed++) run(kind, production, seed, 30);
    vi.runAllTimers();
    expect(rustShelf.shelf_live_handles()).toBe(before);
    expect(rustShelf.shelf_pending_callbacks()).toBe(0);
  });
});

describe('studios without WebGL', () => {
  it.each(Object.keys(factories))('%s shows the same unavailable state and ignores every call', kind => {
    vi.stubGlobal('WebGLRenderingContext', undefined);
    const [frozen, production] = factories[kind], traces = [];
    for (const create of [frozen, production]) {
      const host = document.createElement('div'); document.body.append(host);
      const preview = create(host);
      for (const selection of selections[kind]) preview.update(selection);
      preview.setActive(false); preview.setActive(true); vi.runAllTimers();
      traces.push([{ ...host.dataset }, host.textContent, frames.size, log.entries.splice(0)]);
      preview.dispose(); host.remove();
    }
    expect(traces[1]).toEqual(traces[0]);
  });
});
