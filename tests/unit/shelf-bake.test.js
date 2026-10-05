import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { PLANT_CATALOG, POT_CATALOG, getPotColors } from '../../src/js/plant-catalog-data.js';

// Everything that reaches the GPU or the scene, in comparable form: objects,
// transforms, geometry bytes, material settings, texture bytes and the
// relative creation order of objects and materials (it breaks sort ties).
const hash = view => createHash('sha1').update(Buffer.from(view.buffer, view.byteOffset, view.byteLength)).digest('hex');
const plain = value => JSON.parse(JSON.stringify(value, (key, v) => typeof v === 'function' ? undefined : v));
const MATERIAL = ['type','roughness','metalness','clearcoat','clearcoatRoughness','sheen','sheenRoughness','specularIntensity','side','vertexColors',
  'transparent','opacity','alphaTest','alphaToCoverage','bumpScale','depthWrite','depthTest','visible','blending','ior','emissiveIntensity'];
const TEXTURE = ['wrapS','wrapT','colorSpace','minFilter','magFilter','generateMipmaps','flipY','anisotropy','format','type','premultiplyAlpha','unpackAlignment','rotation','channel'];
const texture = t => t && [t.image.width, t.image.height, hash(t.image.data), t.offset.toArray(), t.repeat.toArray(), t.center.toArray(), ...TEXTURE.map(k => t[k])];
function signature(group) {
  const objects = [], materials = [], all = [];
  group.traverse(o => {
    all.push(o);
    const record = { kind:o.type, name:o.name, position:o.position.toArray(), quaternion:o.quaternion.toArray(), rotation:o.rotation.toArray(), scale:o.scale.toArray(),
      castShadow:o.castShadow, receiveShadow:o.receiveShadow, visible:o.visible, userData:plain(o.userData), children:o.children.map(c => c.name) };
    if (o.geometry) {
      const g = o.geometry;
      record.geometry = { type:g.type, attributes:Object.entries(g.attributes).map(([name, a]) => [name, a.array.constructor.name, a.itemSize, a.normalized, hash(a.array)]),
        index:g.index && [g.index.array.constructor.name, hash(g.index.array)], groups:g.groups, drawRange:g.drawRange, userData:plain(g.userData),
        box:g.boundingBox && [...g.boundingBox.min.toArray(), ...g.boundingBox.max.toArray()] };
    }
    if (o.material) {
      const m = o.material;
      record.material = { ...Object.fromEntries(MATERIAL.map(k => [k, m[k]])), color:m.color?.getHex(), sheenColor:m.sheenColor?.getHex(),
        map:texture(m.map), bumpMap:texture(m.bumpMap), roughnessMap:texture(m.roughnessMap), shared:Boolean(m.bumpMap) && m.bumpMap === m.roughnessMap };
      if (!materials.includes(m)) materials.push(m);
    }
    objects.push(record);
  });
  return JSON.stringify({ objects, ids:all.slice().sort((a, b) => a.id - b.id).map(o => o.name),
    materials:materials.slice().sort((a, b) => a.id - b.id).map(m => materials.indexOf(m)) });
}

const ENTRIES = [];
for (const plant of PLANT_CATALOG) for (const pot of POT_CATALOG) {
  const colors = getPotColors(pot.id);
  ENTRIES.push({ key:`plant:${plant.id}-${pot.id}`, seed:`${plant.id}-${pot.id}`, catalogId:plant.id, variant:plant.id, potId:pot.id,
    potColorId:colors[ENTRIES.length % colors.length].id, width:42, height:96 + ENTRIES.length * 3.25 });
}
// Legacy records: a variant only, numeric or missing seeds, no height.
ENTRIES.push({ variant:'pothos', seed:'legacy', width:46, height:72 }, { variant:'upright', seed:7, height:90.5 }, { variant:'unknown', key:'plant:x' });

// Fresh module instances, as on a new launch. The previous store is switched
// off, so its pending shelf write cannot replace the record under test.
let current = null;
async function freshModules(version) {
  current?.startShelfBakes(null);
  vi.resetModules();
  const cache = current = await import('../../src/js/shelf-bake-cache.js');
  await cache.startShelfBakes(version);
  return { cache, plants:await import('../../src/js/shelf-plants.js'), lamps:await import('../../src/js/shelf-lamps.js') };
}

const painting = plants => Promise.race([plants.plantSurfacesReady().then(() => false), new Promise(resolve => setTimeout(() => resolve(true), 0))]);

// The record as IndexedDB holds it (null when absent).
const storedShelf = () => new Promise(resolve => {
  const request = indexedDB.open('inhouse-read-shelf-bakes');
  request.onsuccess = () => {
    const db = request.result;
    if (!db.objectStoreNames.contains('bakes')) { db.close(); resolve(null); return; }
    const get = db.transaction('bakes').objectStore('bakes').get('shelf');
    get.onsuccess = () => { db.close(); resolve(get.result ?? null); };
  };
});
const clearShelf = () => new Promise(resolve => {
  const request = indexedDB.open('inhouse-read-shelf-bakes');
  request.onsuccess = () => {
    const db = request.result, transaction = db.transaction('bakes', 'readwrite');
    transaction.objectStore('bakes').delete('shelf');
    transaction.oncomplete = () => { db.close(); resolve(); };
  };
});

afterEach(() => { current?.startShelfBakes(null); current = null; vi.restoreAllMocks(); vi.resetModules(); });

describe('saved shelf plant bakes', () => {
  // Bakes are saved for at most 12 plants, as one shelf record.
  for (let start = 0; start < ENTRIES.length; start += 12) {
    const chunk = ENTRIES.slice(start, start + 12);
    it(`restores ${chunk.map(entry => entry.catalogId ? `${entry.catalogId}/${entry.potId}` : entry.variant).join(', ')} exactly, finished in the first frame`, async () => {
      const version = `bake-test-${start}`;
      let { cache, plants } = await freshModules(version);
      const generated = chunk.map(entry => plants.createShelfPlant({ ...entry }, { persist:true }));
      await plants.plantSurfacesReady();
      const record = plants.shelfPlantBakeRecord();
      expect(record.models.map(([key]) => JSON.parse(key)[3])).toEqual(chunk.map(entry => String(entry.seed ?? entry.key)));
      expect(await cache.saveShelfBakes(record)).toBe(true);
      const expected = generated.map(signature);

      ({ cache, plants } = await freshModules(version));
      expect(cache.loadedShelfBakes()?.models).toHaveLength(chunk.length);
      const restored = chunk.map(entry => plants.createShelfPlant({ ...entry }, { persist:true }));
      // Nothing is left to paint or to upload a second time.
      expect(await painting(plants)).toBe(false);
      expect(restored.map(signature)).toEqual(expected);
      for (const model of [...generated, ...restored]) model.userData.dispose();
    }, 120000);
  }

  it('keeps generating when a bake or a surface is damaged, stale or for another plant', async () => {
    const entry = { key:'plant:damaged', seed:'damaged', catalogId:'monstera', potId:'gradvis', height:120 };
    let { cache, plants } = await freshModules('bake-test-damaged');
    const reference = plants.createShelfPlant({ ...entry }, { persist:true });
    await plants.plantSurfacesReady();
    const record = plants.shelfPlantBakeRecord(), expected = signature(reference);
    const [key, bake, keys] = record.models[0];
    const position = bake.objects.find(object => object.geometry).geometry.attributes.position;
    const broken = { ...bake, objects:bake.objects.map(object => object.geometry ? { ...object, geometry:{ ...object.geometry,
      attributes:{ ...object.geometry.attributes, position:[position[0].subarray(1), 3, false] } } } : object) };
    const unknownRole = { ...bake, objects:bake.objects.map(object => object.role ? { ...object, role:'glass' } : object) };
    const shortSurface = record.surfaces.map(([surfaceKey, value]) => [surfaceKey, { ...value, pigment:value.pigment.subarray(4) }]);
    for (const models of [[[key, broken, keys]], [[key, unknownRole, keys]], [[key, { parts:[] }, keys]], [['other', bake, keys]]]) {
      expect(await cache.saveShelfBakes({ models, surfaces:shortSurface })).toBe(true);
      ({ cache, plants } = await freshModules('bake-test-damaged'));
      expect(cache.loadedShelfBakes()).not.toBeNull();
      const plant = plants.createShelfPlant({ ...entry }, { persist:true });
      // The damaged surface is painted again: a preview first, as without a bake.
      expect(await painting(plants)).toBe(true);
      await plants.plantSurfacesReady();
      expect(signature(plant)).toBe(expected);
      plant.userData.dispose();
    }
    // A record of another build or engine is never read.
    await cache.saveShelfBakes(record);
    ({ cache } = await freshModules('bake-test-damaged-next'));
    expect(cache.loadedShelfBakes()).toBeNull();
  }, 120000);

  it('saves the shelf once its surfaces are final, follows pot colours, and does not rewrite an unchanged shelf', async () => {
    let { plants } = await freshModules('bake-test-save');
    await clearShelf();
    const entry = { key:'plant:saved', seed:'saved', catalogId:'sansevieria', potId:'muskot', potColorId:'ivory', height:124 };
    const plant = plants.createShelfPlant({ ...entry }, { persist:true });
    // Catalogue previews are not part of the shelf.
    plants.createShelfPlant({ catalogId:'cactus', seed:'catalog:cactus' }).userData.dispose();
    let saved = null;
    await vi.waitFor(async () => { saved = await storedShelf(); expect(saved).not.toBeNull(); }, { timeout:15000, interval:100 });
    expect(saved.models.map(([key]) => JSON.parse(key)[3])).toEqual(['saved']);
    expect(saved.surfaces.map(([key]) => key).sort()).toEqual(['leaf:upright:1', 'pot:muskot:#efece4:1', 'soil:peat:1']);
    expect(saved.surfaces.every(([, value]) => value.pigment.length === value.width * value.height * 4)).toBe(true);
    expect(plant.userData.updatePotColor('charcoal')).toBe(true);
    await vi.waitFor(async () => { saved = await storedShelf(); expect(saved.models[0][2]).toContain('pot:muskot:#484a48:1'); }, { timeout:15000, interval:100 });
    expect(saved.surfaces.map(([key]) => key)).toContain('pot:muskot:#484a48:1');
    expect(saved.surfaces.map(([key]) => key)).not.toContain('pot:muskot:#efece4:1');
    plant.userData.dispose();

    // The next launch restores the same shelf and has nothing new to save.
    ({ plants } = await freshModules('bake-test-save'));
    const restored = plants.createShelfPlant({ ...entry, potColorId:'charcoal' }, { persist:true });
    expect(await painting(plants)).toBe(false);
    await clearShelf();
    await new Promise(resolve => setTimeout(resolve, 3000));
    expect(await storedShelf()).toBeNull();
    restored.userData.dispose();
  }, 60000);

  it('restores shelf lamp surfaces byte for byte without painting them again', async () => {
    let { lamps } = await freshModules('bake-test-lamps');
    await clearShelf();
    const make = module => ['tarnaby', 'tripod', 'mittled'].map(lampId => module.createShelfLamp({ lampId, width:75, quality:'high', persist:true }));
    const generated = make(lamps), expected = generated.map(signature);
    await vi.waitFor(async () => expect((await storedShelf())?.surfaces.map(([key]) => key).sort()).toEqual(['lamp:black:2', 'lamp:linen:2', 'lamp:wood:2']),
      { timeout:15000, interval:100 });
    ({ lamps } = await freshModules('bake-test-lamps'));
    const sin = vi.spyOn(Math, 'sin');
    const restored = make(lamps);
    // Painting one 512 x 512 surface alone takes a sine per texel.
    expect(sin.mock.calls.length).toBeLessThan(20000);
    expect(restored.map(signature)).toEqual(expected);
    for (const lamp of [...generated, ...restored]) lamp.userData.dispose();
  }, 60000);
});

describe('shelf bake store', () => {
  it('reads nothing without a build version and round-trips typed arrays with one', async () => {
    vi.resetModules();
    const cache = current = await import('../../src/js/shelf-bake-cache.js');
    expect(cache.shelfBakesEnabled()).toBe(false);
    expect(await cache.saveShelfBakes({ models:[], surfaces:[] })).toBe(false);
    await cache.startShelfBakes('store-test');
    expect(cache.loadedShelfBakes()).toBeNull();
    const pigment = new Uint8Array([1, 2, 3, 255]), index = new Uint16Array([0, 1, 2]);
    expect(await cache.saveShelfBakes({ models:[['k', { index }, []]], surfaces:[['s', { width:1, height:1, pigment, data:pigment }]] })).toBe(true);
    await cache.startShelfBakes('store-test');
    const record = cache.loadedShelfBakes();
    expect(Object.prototype.toString.call(record.models[0][1].index)).toBe('[object Uint16Array]');
    expect(cache.savedSurface('s', 2, 1)).toBeNull();
    await cache.startShelfBakes('store-test');
    expect([...cache.savedSurface('s', 1, 1).pigment]).toEqual([1, 2, 3, 255]);
    // A surface is handed out once: its bytes become a texture's own.
    expect(cache.savedSurface('s', 1, 1)).toBeNull();
  });

  it('never holds the shelf for more than the given time', async () => {
    vi.resetModules();
    const cache = current = await import('../../src/js/shelf-bake-cache.js');
    cache.startShelfBakes('store-stuck', { open:() => ({}) });
    const started = performance.now();
    await cache.shelfBakesSettled(40);
    expect(performance.now() - started).toBeLessThan(1000);
    expect(cache.loadedShelfBakes()).toBeNull();
  });
});

describe('shelf bake version', () => {
  it('hashes the generators and their imports for builds and disables bakes for the dev server', async () => {
    const { shelfBakeHash, shelfBakeVersion } = await import('../../scripts/shelf-bake-version.mjs');
    const root = process.cwd();
    expect(shelfBakeHash(root)).toMatch(/^[0-9a-f]{20}$/);
    expect(shelfBakeHash(root)).toBe(shelfBakeHash(root));
    const plugin = shelfBakeVersion(root);
    expect(plugin.config({}, { command:'serve' }).define.__SHELF_BAKE_VERSION__).toBe('null');
    expect(plugin.config({}, { command:'build' }).define.__SHELF_BAKE_VERSION__).toBe(JSON.stringify(shelfBakeHash(root)));
  });
});
