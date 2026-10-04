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
const cases = [
  ['plant',createPlantCatalogPreview,{ catalogId:'sansevieria',potId:'muskot',potColorId:'white' }],
  ['shelf',createShelfCatalogPreview,{ shelfType:'walnut' }],
  ['lamp',createLampCatalogPreview,{ lampId:'mittled' }]
];
beforeEach(() => {
  for (const list of Object.values(resources)) list.length = 0;
  frames = new Map(); observers = []; previews = []; let serial = 0;
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
  document.body.replaceChildren(); vi.unstubAllGlobals(); vi.restoreAllMocks();
});

describe.each(cases)('%s catalog studio suspension',(_name,create,selection) => {
  it('keeps stationary bounds and backing buffers through repeated draws, while a real resize still reframes',() => {
    const host = document.createElement('div'); document.body.append(host);
    let width = 200; host.getBoundingClientRect = () => ({ width,height:300 });
    const preview = create(host); previews.push(preview); preview.update(selection);
    const draw = () => { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(callback => callback(16)); };
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
    const renderer = resources.renderers[0], model = resources.models[0];
    expect(host.dataset.renderer).toBe('three-mesh');
    expect(frames.size).toBe(1);
    preview.setActive(false);
    expect(frames.size).toBe(0);
    width = 240;
    for (const notify of [...observers,...resources.textureLoads]) notify?.();
    preview.update(selection);
    expect(frames.size).toBe(0);
    expect(renderer.render).not.toHaveBeenCalled();
    preview.setActive(true); preview.setActive(true);
    expect(frames.size).toBe(1);
    const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(callback => callback(16));
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
    expect(renderer.shadowMap.needsUpdate).toBe(true);
    // The actual renderer consumes this flag after the original full pass.
    renderer.shadowMap.needsUpdate = false;
    const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(callback => callback(16));
    observers.forEach(notify => notify());
    const resize = [...frames.values()]; frames.clear(); resize.forEach(callback => callback(32));
    expect(renderer.shadowMap.needsUpdate).toBe(false);
    preview.update({ lampId:'tripod' });
    expect(renderer.shadowMap.needsUpdate).toBe(true);
  });
});
