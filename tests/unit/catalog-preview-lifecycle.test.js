import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { createPlantCatalogPreview } from '../../src/js/plant-catalog-preview.js';
import { createShelfCatalogPreview } from '../../src/js/shelf-catalog-preview.js';
import { createLampCatalogPreview } from '../../src/js/lamp-catalog-preview.js';

const resources = vi.hoisted(() => ({ renderers:[],environments:[],models:[],textureLoads:[] }));
vi.mock('three',async importOriginal => {
  const three = await importOriginal();
  return { ...three,
    WebGLRenderer:class {
      constructor() {
        this.domElement = document.createElement('canvas');
        this.shadowMap = {}; this.capabilities = { getMaxAnisotropy:() => 1 };
        this.render = vi.fn(); this.setSize = vi.fn(); this.setPixelRatio = vi.fn();
        this.dispose = vi.fn(); this.forceContextLoss = vi.fn();
        resources.renderers.push(this);
      }
    },
    PMREMGenerator:class {
      fromScene() {
        const environment = { texture:new three.Texture(),dispose:vi.fn() };
        resources.environments.push(environment); return environment;
      }
      dispose() {}
    }
  };
});
vi.mock('three/addons/environments/RoomEnvironment.js',async () => {
  const three = await import('three');
  return { RoomEnvironment:class extends three.Group { dispose() {} } };
});

async function fakeModel() {
  const three = await import('three');
  return function createModel() {
    const group = new three.Group();
    group.add(new three.Mesh(new three.BoxGeometry(60,100,60),new three.MeshStandardMaterial()));
    group.userData.dispose = vi.fn(() => group.traverse(object => {
      object.geometry?.dispose(); object.material?.dispose();
    }));
    resources.models.push(group); return group;
  };
}
vi.mock('../../src/js/shelf-plants.js',async () => ({ createShelfPlant:await fakeModel() }));
vi.mock('../../src/js/shelf-lamps.js',async () => ({ createShelfLamp:await fakeModel() }));
vi.mock('../../src/js/shelf-furniture.js',async () => ({ createShelfFurniture:await fakeModel() }));
vi.mock('../../src/js/baggebo-model.js',async () => ({ createBaggebo:await fakeModel() }));

let frames, observers, previews;
// A new selection is built in a task after the frame that requested it, then
// drawn on the next frame once its programs are linked. Run both until idle.
const settle = () => {
  for (let round = 0; round < 10 && (frames.size || vi.getTimerCount()); round++) {
    const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(callback => callback(16));
    vi.runOnlyPendingTimers();
  }
};
const cases = [
  ['plant',createPlantCatalogPreview,{ catalogId:'sansevieria',potId:'muskot',potColorId:'white' }],
  ['shelf',createShelfCatalogPreview,{ shelfType:'walnut' }],
  ['lamp',createLampCatalogPreview,{ lampId:'mittled' }]
];
beforeEach(() => {
  for (const list of Object.values(resources)) list.length = 0;
  frames = new Map(); observers = []; previews = []; let serial = 0;
  vi.useFakeTimers({ toFake:['setTimeout','clearTimeout'] });
  vi.stubGlobal('WebGLRenderingContext',function WebGLRenderingContext() {});
  vi.stubGlobal('requestAnimationFrame',callback => { const id = ++serial; frames.set(id,callback); return id; });
  vi.stubGlobal('cancelAnimationFrame',id => frames.delete(id));
  vi.stubGlobal('ResizeObserver',class {
    constructor(callback) { observers.push(callback); this.disconnect = vi.fn(); }
    observe() {}
  });
  vi.spyOn(THREE.TextureLoader.prototype,'load').mockImplementation((_url,callback) => {
    resources.textureLoads.push(callback); return new THREE.Texture();
  });
});
afterEach(() => {
  for (const preview of previews) preview.dispose();
  document.body.replaceChildren(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers();
});

describe.each(cases)('%s catalog studio suspension',(_name,create,selection) => {
  it('keeps stationary bounds and backing buffers through repeated draws, while a real resize still reframes',() => {
    const host = document.createElement('div'); document.body.append(host);
    let width = 200; host.getBoundingClientRect = () => ({ width,height:300 });
    const preview = create(host); previews.push(preview); preview.update(selection);
    const draw = settle;
    draw();
    const renderer = resources.renderers[0];
    const bounds = vi.spyOn(THREE.Box3.prototype,'setFromObject');
    for (let index = 0; index < 3; index++) { preview.setActive(false); preview.setActive(true); draw(); }
    expect(renderer.render).toHaveBeenCalledTimes(4);
    expect(renderer.setSize).toHaveBeenCalledTimes(1);
    expect(bounds).not.toHaveBeenCalled();
    preview.setActive(true);
    expect(frames.size).toBe(0);
    width = 240; observers.forEach(notify => notify()); draw();
    expect(renderer.setSize).toHaveBeenLastCalledWith(240,300,false);
    expect(renderer.setSize).toHaveBeenCalledTimes(2);
    expect(renderer.render).toHaveBeenCalledTimes(5);
    expect(resources.models).toHaveLength(1);
  });

  it('cancels hidden draws and resize/texture notifications, then redraws with the same GPU/model at the new size',() => {
    const host = document.createElement('div'); document.body.append(host);
    let width = 200;
    host.getBoundingClientRect = () => ({ width,height:300 });
    const preview = create(host); previews.push(preview);
    preview.update(selection);
    const renderer = resources.renderers[0];
    expect(host.dataset.renderer).toBe('three-mesh');
    expect(frames.size).toBe(1);
    // Nothing is built while hidden: the tap that chose it paints first.
    expect(resources.models).toHaveLength(0);
    preview.setActive(false);
    expect(frames.size).toBe(0);
    width = 240;
    for (const notify of [...observers,...resources.textureLoads]) notify?.();
    preview.update(selection);
    expect(frames.size).toBe(0);
    expect(renderer.render).not.toHaveBeenCalled();
    preview.setActive(true); preview.setActive(true);
    expect(frames.size).toBe(1);
    settle();
    const model = resources.models[0];
    expect(renderer.setSize).toHaveBeenLastCalledWith(240,300,false);
    expect(renderer.render).toHaveBeenCalledOnce();
    expect(resources.renderers).toHaveLength(1);
    expect(resources.models).toEqual([model]);
    expect(model.userData.dispose).not.toHaveBeenCalled();
    preview.dispose(); preview.dispose();
    expect(model.userData.dispose).toHaveBeenCalledOnce();
    expect(renderer.dispose).toHaveBeenCalledOnce();
    expect(renderer.forceContextLoss).toHaveBeenCalledOnce();
    expect(resources.environments[0].dispose).toHaveBeenCalledOnce();
    expect(host.childNodes).toHaveLength(0);
    preview.setActive(true); observers.forEach(notify => notify());
    expect(frames.size).toBe(0);
  });
});

describe('stationary lamp catalogue shadows',() => {
  it('draws its full shadow for a new selection and reuses it while resizing the view',() => {
    const host = document.createElement('div'); document.body.append(host);
    host.getBoundingClientRect = () => ({ width:200,height:300 });
    const preview = createLampCatalogPreview(host); previews.push(preview);
    preview.update({ lampId:'mittled' });
    const renderer = resources.renderers[0];
    expect(renderer.shadowMap.autoUpdate).toBe(false);
    settle();
    expect(renderer.shadowMap.needsUpdate).toBe(true);
    // The actual renderer consumes this flag after the original full pass.
    renderer.shadowMap.needsUpdate = false;
    observers.forEach(notify => notify()); settle();
    expect(renderer.shadowMap.needsUpdate).toBe(false);
    preview.update({ lampId:'tripod' }); settle();
    expect(renderer.shadowMap.needsUpdate).toBe(true);
  });
});

describe('catalogue selections never stall on a shader link',() => {
  it.each(cases)('%s: keeps the previous picture until the next selection is linked, then shows it',(_name,create,selection) => {
    const host = document.createElement('div'); document.body.append(host);
    host.getBoundingClientRect = () => ({ width:200,height:300 });
    const preview = create(host); previews.push(preview);
    const renderer = resources.renderers[0];
    // The parallel link reports busy twice, then ready.
    let busy = 0;
    const program = { usedTimes:1,isReady:() => busy-- <= 0 };
    Object.assign(renderer,{ info:{ programs:[] },properties:{ get:() => ({ programs:[program] }) },
      getRenderTarget:() => null,setRenderTarget() {},
      compile:vi.fn(listing => { const materials = new Set(); listing.traverse(object => object.material && materials.add(object.material)); return materials; }) });
    preview.update(selection); settle();
    expect(renderer.render).toHaveBeenCalledOnce();
    const next = 'catalogId' in selection ? { ...selection,catalogId:'cactus' } : 'shelfType' in selection ? { shelfType:'baggebo' } : { lampId:'tarnaby' };
    busy = 2; preview.update(next);
    // The tap's own frame does no 3D work at all.
    const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(callback => callback(16));
    expect(resources.models).toHaveLength(1);
    vi.advanceTimersByTime(0);
    expect(resources.models).toHaveLength(2);
    expect(renderer.compile).toHaveBeenCalled();
    expect(frames.size).toBe(0);
    vi.advanceTimersByTime(16);
    expect(frames.size).toBe(0);
    vi.advanceTimersByTime(16);
    expect(frames.size).toBe(1);
    settle();
    expect(renderer.render).toHaveBeenCalledTimes(2);
    expect(renderer.info.programs).toEqual([]);
  });

  it('builds and links the first plant ahead of time while the page is still closed',() => {
    const host = document.createElement('div'); document.body.append(host);
    host.getBoundingClientRect = () => ({ width:200,height:300 });
    const preview = createPlantCatalogPreview(host); previews.push(preview);
    preview.setActive(false); preview.update(cases[0][2]); preview.prepare();
    expect(resources.models).toHaveLength(1);
    expect(resources.renderers[0].render).not.toHaveBeenCalled();
    preview.setActive(true); settle();
    expect(resources.renderers[0].render).toHaveBeenCalledOnce();
    expect(resources.models).toHaveLength(1);
  });
});
