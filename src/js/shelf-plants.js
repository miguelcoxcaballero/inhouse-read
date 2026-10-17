import * as THREE from 'three';
import { plantGeometrySpec } from './decor-geometry-spec.js';
import { idleWork } from './idle-startup.js';
import { getRustDecorCore } from './rust-decor-core.js';
import { needRustShelf } from './rust-shelf.js';
import { openPacket } from './geo-packet.js';
import { createPlantPaintGate } from './plant-paint-gate.js';
import { rustPlantLattice } from './plant-lattice-wasm.js';
import { rustPlantGlazeRows } from './plant-glaze-wasm.js';
import { rustPlantPotteryRows } from './plant-pottery-wasm.js';
import { rustPlantSoilRows } from './plant-soil-wasm.js';
import { rustPlantFoliageRows } from './plant-foliage-wasm.js';
import { getPotColor } from './plant-catalog-data.js';
import { POT_SOIL_FRACTION } from './plant-dimensions.js';
import { addShelfBakeSource, loadedShelfBakes, savedSurface, scheduleShelfBakeWrite } from './shelf-bake-cache.js';

const srgb = hex => { const n = parseInt(hex.slice(1), 16); return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; };

// The UTF-16 units of a plant's seed: its random numbers are the shelf module's (`plant_random`, `plant_model`).
function seedUnits(seed) {
  const text = String(seed), units = new Uint16Array(text.length);
  for (let index = 0; index < units.length; index++) units[index] = text.charCodeAt(index);
  return units;
}

function variantFor(value) {
  const variant = String(value || 'leafy').toLowerCase();
  if (variant.includes('cactus')) return 'cactus';
  if (variant.includes('monstera')) return 'monstera';
  if (variant === 'upright' || variant.includes('sansevieria')) return 'upright';
  if (variant.includes('succulent') || variant.includes('suculenta')) return 'succulent';
  if (variant.includes('chamaedorea') || variant === 'palm') return 'palm';
  if (variant.includes('nephrolepis') || variant === 'fern') return 'fern';
  if (variant.includes('hedera') || variant === 'ivy') return 'ivy';
  if (variant.includes('zamioculcas') || variant === 'zz') return 'zz';
  return 'leafy';
}

// The integer hash that seeds each leaf variety's vein phase (the painters live in the decor core).
function hash(x, y, seed) {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(seed | 0, 0x9e3779b1);
  h = Math.imul(h ^ h >>> 15, 0x85ebca6b); h = Math.imul(h ^ h >>> 13, 0xc2b2ae35);
  return ((h ^ h >>> 16) >>> 0) / 4294967296;
}

function dataTexture(bytes, width, height, colorSpace, repeat) {
  const texture = new THREE.DataTexture(bytes, width, height, THREE.RGBAFormat);
  texture.colorSpace = colorSpace; texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter; texture.magFilter = THREE.LinearFilter;
  if (repeat) texture.wrapS = THREE.RepeatWrapping;
  texture.needsUpdate = true; return texture;
}

// Full-resolution painting runs in idle slices, so the first plant of a kind
// never blocks the frame that shows it; a coarse preview stands in meanwhile.
const surfaces = new Map(), queue = [], settled = [], redraws = new Set();
const idle = callback => idleWork(callback, { timeout:200,fallbackMs:16 });
const SURFACE_ERROR = 'Las texturas de la planta no se pudieron calcular. Recarga la página.';
const deferPlantPaint = createPlantPaintGate();

// A surface is painted by the decor core from its description: `family` 0 glazed pottery, 1 terracotta
// or zinc, 2 soil, 3 leaves; `kind` the variety within it; `config` the painter's numbers.
function paintRows(job, end) {
  const core = getRustDecorCore(), { spec, width, height, row, pigment, data } = job, count = end - row;
  const painted = spec.family === 0 ? rustPlantGlazeRows(core, width, height, row, count, spec.config, pigment, data)
    : spec.family === 1 ? rustPlantPotteryRows(core, spec.kind, width, height, row, count, spec.config, pigment, data)
    : spec.family === 2 ? rustPlantSoilRows(core, spec.kind, width, height, row, count, pigment, data)
    : rustPlantFoliageRows(core, spec.kind, width, height, row, count, spec.config, pigment, data);
  if (!painted) throw new Error(SURFACE_ERROR);
}

function pump(deadline) {
  if (deferPlantPaint()) { idle(pump); return; }
  // Use the idle period the browser offers (a forced, timed-out slice stays
  // short). Bounded by rows as well, so a frozen clock cannot stall the loop.
  const until = performance.now() + Math.min(16, Math.max(5, deadline.timeRemaining() - 1));
  for (let chunk = 0; queue.length && chunk < 48 && (chunk === 0 || performance.now() < until); chunk++) {
    const job = queue[0];
    const end = Math.min(job.height, job.row + 4);
    try { paintRows(job, end); job.row = end; }
    catch (error) {
      // The coarse first look stays on the plants that already use it and they are released, but the surface is
      // not final: it is forgotten below, so it is never saved as a finished painting and the next plant of
      // this kind paints it again.
      console.warn('No se pudo completar el detalle de las texturas de la planta:', error);
      job.row = job.height; job.failed = true;
    }
    if (job.row < job.height) continue;
    queue.shift();
    const { base } = job;
    if (job.failed && surfaces.get(job.key) === base) surfaces.delete(job.key);
    // One new Source version re-uploads the shared image once; every live
    // clone just needs its own version bumped to look at it again.
    base.map.source.needsUpdate = base.data.source.needsUpdate = true;
    for (const texture of base.clones) texture.version++;
    for (const refresh of base.waiting) redraws.add(refresh);
    base.clones = base.waiting = null;
  }
  if (queue.length) { idle(pump); return; }
  // One redraw per waiting plant once everything is in, not one per surface.
  for (const refresh of redraws) refresh();
  redraws.clear();
  for (const resolve of settled.splice(0)) resolve();
}

/** Resolves once every procedural plant surface has its final detail. */
export const plantSurfacesReady = () => queue.length ? new Promise(resolve => settled.push(resolve)) : Promise.resolve();

/** Paint an sRGB pigment map and one linear data map (R relief for bumpMap,
 * G roughness for roughnessMap) once per surface kind. Every model owns cheap
 * clones: they share the Source, so identical pots share one GPU upload that
 * is released when the last clone is disposed. */
function surface(key, [width, height], repeat, spec, refresh) {
  let base = surfaces.get(key);
  const saved = base ? null : savedSurface(key, width, height);
  if (saved) {
    // The final painting of an earlier launch: no preview, nothing to repaint.
    base = { map:dataTexture(saved.pigment, width, height, THREE.SRGBColorSpace, repeat),
      data:dataTexture(saved.data, width, height, THREE.NoColorSpace, repeat), clones:null, waiting:null };
    surfaces.set(key, base);
  } else if (!base) {
    const pigment = new Uint8Array(width * height * 4), data = new Uint8Array(pigment.length);
    // Coarse preview: the same painter on an 8px lattice, spread bilinearly
    // (and wrapped around a lathe), at about 1/64 of the full cost.
    if (!rustPlantLattice(getRustDecorCore(), spec, width, height, repeat, pigment, data)) throw new Error(SURFACE_ERROR);
    base = { map:dataTexture(pigment, width, height, THREE.SRGBColorSpace, repeat), data:dataTexture(data, width, height, THREE.NoColorSpace, repeat),
      clones:[], waiting:[] };
    surfaces.set(key, base);
    queue.push({ base, key, width, height, row:0, spec, pigment, data });
    if (queue.length === 1) idle(pump);
  }
  // Texture.copy() raises the shared Source's version, which would re-upload
  // the image for every clone; keep it, so identical surfaces share one upload.
  const clone = texture => {
    const version = texture.source.version, copy = texture.clone();
    copy.source.version = version; base.clones?.push(copy);
    // A cancelled inspection may release a clone before its shared painter
    // finishes. Do not retain it or mark a disposed GPU texture for upload.
    const released = () => {
      const index = base.clones?.indexOf(copy) ?? -1;
      if (index >= 0) base.clones.splice(index, 1);
      copy.removeEventListener('dispose', released);
    };
    if (base.clones) copy.addEventListener('dispose', released);
    return copy;
  };
  if (refresh) base.waiting?.push(refresh);
  return { map:clone(base.map), data:clone(base.data) };
}

// Sansevieria blades sample one of four narrow strips (32 x 256 texels each):
// the texel density then matches a sword leaf, so the mip chosen for a blade
// only a few pixels wide still resolves its cross bands along the length.
const SNAKE_STRIPS = 4;

function sansevieriaTextures(refresh, quality = 1) {
  return surface(`leaf:upright:${quality}`, [SNAKE_STRIPS * 32 * quality, 256 * quality], false, { family:3, kind:3, config:new Float64Array(5) }, refresh);
}

function botanicalTextures(variant, refresh, quality = 1) {
  if (variant === 'upright') return sansevieriaTextures(refresh, quality);
  // A single surface field drives pigment, relief and wax roughness together.
  const base = srgb({ zz:'#2f5324', fern:'#4a7a2c', succulent:'#6a8a80', ivy:'#2a4c23', palm:'#3d6c2a', monstera:'#2f6128' }[variant] ?? '#36672c');
  const phase = hash(variant.length, 3, 11) * Math.PI * 2, seed = variant.charCodeAt(0);
  const spec = { family:3, kind:variant === 'ivy' ? 1 : variant === 'succulent' ? 2 : 0, config:new Float64Array([...base, phase, seed]) };
  return surface(`leaf:${variant}:${quality}`, [128 * quality, 128 * quality], false, spec, refresh);
}

// Texture rows along a pot's profile: foot ring, outer wall, lip, visible
// inner wall, then everything hidden below the soil.
const FOOT = .07, RIM = .6;

const glazeSpec = ({ glaze, body, gloss, speckle, crackle, seed }) => ({ family:0, kind:0,
  config:new Float64Array([...srgb(glaze), ...srgb(body), gloss, speckle, crackle, seed]) });
const terracottaSpec = (hex, seed) => ({ family:1, kind:0, config:new Float64Array([...srgb(hex), seed]) });
const galvanizedSpec = (seed, hex = '#cfd3d5') => ({ family:1, kind:1, config:new Float64Array([...srgb(hex), seed]) });

const POT_FINISHES = {
  // Glossy white earthenware with faint crazing and iron specks.
  muskot:{ painter:color => glazeSpec({ glaze:color, body:'#cfbea3', gloss:.24, speckle:.0022, crackle:.55, seed:17 }),
    material:{ clearcoat:.42, clearcoatRoughness:.16, bumpScale:.55 } },
  // Satin pink stoneware, freckled by the clay body.
  gradvis:{ painter:color => glazeSpec({ glaze:color, body:'#c7a291', gloss:.42, speckle:.004, crackle:0, seed:29 }),
    material:{ clearcoat:.2, clearcoatRoughness:.42, bumpScale:.45 } },
  akerbar:{ painter:color => galvanizedSpec(41,color), material:{ metalness:.85, bumpScale:.3 } },
};

const soilSpec = kind => ({ family:2, kind:kind === 'grit' ? 1 : 0 });

const cactusMaterial = () => new THREE.MeshStandardMaterial({ color:0xffffff, vertexColors:true, roughness:.8 });
const needleMaterial = () => new THREE.LineBasicMaterial({ color:'#d9cda9', transparent:true, opacity:.8 });

/** Scene units per millimetre of a plant shown without a shelf (the catalogue preview). */

// A bake is the finished plant content as plain data: every object in its
// creation order (ids decide the draw order of equal sort keys), its parent
// and place among siblings, transform, material role and geometry arrays.
// The Rust shelf module builds it (rust-ui/src/plant_model.rs); a saved one is read back the same way.
const ROLES = ['clay', 'soil', 'leaf', 'stem', 'mineral', 'green', 'needles'];
const KINDS = ['mesh', 'lines', 'group'];

/** The bake of a freshly made plant, from the packet the module returns: arrays are copied out of it. */
function unpackBake(bytes) {
  const packet = openPacket(bytes), { parts, objects } = packet.header;
  return { parts, objects:objects.map(({ geometry, rotation, ...object }) => ({ ...object, rotation:[...rotation, 'XYZ'],
    geometry:geometry ? { type:geometry.type, attributes:Object.fromEntries(geometry.attributes.map(([name, size, kind, at, length]) => [name, [packet.copy(kind, at, length), size, false]])),
      index:geometry.index && packet.copy(geometry.index[0], geometry.index[1], geometry.index[2]), groups:geometry.groups, userData:geometry.userData, box:geometry.box } : null })) };
}

const isTriple = value => Array.isArray(value) && value.length === 3 && value.every(Number.isFinite);
// Typed arrays read back from IndexedDB may come from another realm.
const typeOf = value => Object.prototype.toString.call(value).slice(8, -1);
function validBake(bake) {
  if (!bake || !Array.isArray(bake.parts) || !Array.isArray(bake.objects)) return false;
  return bake.objects.every((object, index, all) => {
    if (!KINDS.includes(object?.kind) || typeof object.name !== 'string' || !isTriple(object.position) || !isTriple(object.scale) ||
      !Array.isArray(object.quaternion) || object.quaternion.length !== 4 || !object.quaternion.every(Number.isFinite) ||
      !Array.isArray(object.rotation) || !isTriple(object.rotation.slice(0, 3)) || !Number.isInteger(object.place)) return false;
    if (object.parent !== -1 && all[object.parent]?.kind !== 'group') return false;
    if (object.kind === 'group') return true;
    const geometry = object.geometry;
    if (!ROLES.includes(object.role) || !geometry?.attributes?.position) return false;
    const count = geometry.attributes.position[0]?.length / geometry.attributes.position[1];
    return Number.isInteger(count) && Object.values(geometry.attributes).every(([array, itemSize]) =>
      /^(Float32|U?Int(8|16|32))Array$/.test(typeOf(array)) && Number.isInteger(itemSize) && itemSize > 0 && array.length === count * itemSize) &&
      (geometry.index === null || /^Uint(16|32)Array$/.test(typeOf(geometry.index))) &&
      Array.isArray(geometry.groups) && (geometry.box === null || Array.isArray(geometry.box) && geometry.box.length === 6);
  });
}

function restoreGeometry(baked) {
  const geometry = new THREE.BufferGeometry();
  geometry.type = baked.type;
  for (const [name, [array, itemSize, normalized]] of Object.entries(baked.attributes))
    geometry.setAttribute(name, new THREE.BufferAttribute(array, itemSize, normalized));
  if (baked.index) geometry.setIndex(new THREE.BufferAttribute(baked.index, 1));
  for (const [start, count, materialIndex] of baked.groups) geometry.addGroup(start, count, materialIndex);
  geometry.userData = JSON.parse(JSON.stringify(baked.userData ?? {}));
  if (baked.box) geometry.boundingBox = new THREE.Box3(new THREE.Vector3().fromArray(baked.box), new THREE.Vector3().fromArray(baked.box, 3));
  return geometry;
}

function restoreContent(bake, content, materialFor, track) {
  const objects = bake.objects.map(baked => {
    const object = baked.kind === 'group' ? new THREE.Group() : new (baked.kind === 'lines' ? THREE.LineSegments : THREE.Mesh)(restoreGeometry(baked.geometry), materialFor(baked.role));
    object.name = baked.name;
    object.position.fromArray(baked.position); object.scale.fromArray(baked.scale);
    // Euler and quaternion each follow whichever of them was set last.
    object.quaternion.fromArray(baked.quaternion);
    const [x, y, z, rotationOrder] = baked.rotation;
    if (object.rotation.x !== x || object.rotation.y !== y || object.rotation.z !== z || object.rotation.order !== rotationOrder) object.rotation.set(x, y, z, rotationOrder);
    object.castShadow = baked.castShadow; object.receiveShadow = baked.receiveShadow;
    object.userData = JSON.parse(JSON.stringify(baked.userData ?? {}));
    if (baked.kind !== 'group') track(object);
    return object;
  });
  const children = bake.objects.map((baked, index) => [baked.parent, baked.place, objects[index]]).sort((a, b) => a[1] - b[1]);
  for (const [parent, , object] of children) (parent === -1 ? content : objects[parent]).add(object);
  return [...bake.parts];
}

// Bakes of this session's shelf plants (most recent last) are kept for the
// next launch together with the final paint of their level-1 surfaces.
const shelfBakes = new Map(), MAX_SHELF_BAKES = 12;
let savedModels = null;

function shelfBake(key) {
  const entry = shelfBakes.get(key);
  if (entry) return entry;
  // A record that arrives late still serves the plants made after it.
  const record = savedModels ? null : loadedShelfBakes();
  if (record) savedModels = new Map(record.models.map(item => [item[0], item]));
  const saved = savedModels?.get(key);
  savedModels?.delete(key);
  return saved && validBake(saved[1]) ? { bake:saved[1], surfaces:null } : null;
}

function rememberBake(key, entry) {
  shelfBakes.delete(key); shelfBakes.set(key, entry);
  for (const old of shelfBakes.keys()) if (shelfBakes.size > MAX_SHELF_BAKES) shelfBakes.delete(old);
  scheduleShelfBakeWrite();
}

/** What the shelf would save now: its plants and their finished surfaces. */
export function shelfPlantBakeRecord() {
  const models = [], painted = new Map();
  for (const [key, { bake, surfaces:keys }] of shelfBakes) {
    models.push([key, bake, [...keys]]);
    for (const surfaceKey of keys) {
      const base = surfaces.get(surfaceKey);
      if (base && !base.clones && !painted.has(surfaceKey)) painted.set(surfaceKey, { width:base.map.image.width, height:base.map.image.height,
        pigment:base.map.image.data, data:base.data.image.data });
    }
  }
  return { models, surfaces:[...painted] };
}

addShelfBakeSource({ collect:shelfPlantBakeRecord, settled:plantSurfacesReady });

/** Every saved plant uses a current catalog mesh, including legacy records.
 * Its own opaque leaf texture covers real geometry; no photo cutout is used.
 * Sizes are the real IKEA ones (plant-dimensions.js): only `entry.height`,
 * the scene's height for that plant, sets the scale, so a width or height
 * saved by an older version cannot distort the pot or the foliage.
 * The plant's geometry (pot, foliage, soil, merged by material and fitted to
 * its envelope) is drawn by the Rust shelf module as a bake; this function
 * makes the materials and the objects from it.
 */
export function createShelfPlant(entry, { persist = false } = {}) {
  const quality = entry.inspectionResolution ? 2 : 1;
  const {catalogPlant,potId,potModelId,real,height,unit}=plantGeometrySpec(entry);
  const variant = variantFor(catalogPlant?.variant || entry.variant), seed = entry.seed ?? entry.key ?? entry.node?.dataset.objectId ?? variant;
  // The canopy and the pot share one mm scale, including the pot's outer rim.
  const width = real.canopy * unit;
  const detailed = Boolean(catalogPlant || potId || ['palm','fern','ivy','zz'].includes(variant));
  const group = new THREE.Group(), content = new THREE.Group();
  content.position.y = -height / 2; group.add(content);
  const textures = new Set(), materials = new Set(), geometries = new Set();
  let disposed = false;
  // Surfaces still being painted redraw the shelf once their detail is in.
  const refresh = () => { if (!disposed) group.userData.invalidate?.(); };
  const own = maps => { for (const texture of Object.values(maps)) textures.add(texture); return maps; };
  const radius = real.potDiameter / 2 * unit, potHeight = real.potHeight * unit;
  const soilFraction = POT_SOIL_FRACTION, soilY = potHeight * soilFraction;
  const clays = ['#a97958', '#b18b6c', '#bcad94', '#826d60'];
  let potColor = getPotColor(potId,entry.potColorId);
  // The plant's own random numbers: a plant without a pot picks its clay first, every pot is turned by the next one.
  const shelf = needRustShelf(), units = seedUnits(seed), drawn = shelf.plant_random(units, potId ? 1 : 2);
  const clayColor = potId ? potColor.hex : clays[Math.floor(drawn[0] * clays.length)];
  const finish = POT_FINISHES[potModelId] ?? { painter:() => terracottaSpec(clayColor, 53), material:{ bumpScale:.4 } };
  const potKey = (level, color = potColor) => `pot:${potId}:${potId ? color.hex : clayColor}:${level}`;
  const potSurface = (level, notify, color = potColor) => {
    const pigment = potId ? color.hex : clayColor;
    const painter = POT_FINISHES[potModelId]?.painter(color.hex) ?? terracottaSpec(pigment, 53);
    return surface(potKey(level, color), [128 * level, 256 * level], true, painter, notify);
  };
  const potMaps = own(potSurface(quality, refresh));
  // Texels stay roughly square on the outer wall, whatever the pot proportions.
  potMaps.map.repeat.x = potMaps.data.repeat.x = Math.max(1, Math.round(Math.PI * 4 * radius * (RIM - FOOT) / potHeight));
  potMaps.map.offset.x = potMaps.data.offset.x = drawn[potId ? 0 : 1];
  const { bumpScale, ...finishOptions } = finish.material;
  const clay = new THREE.MeshPhysicalMaterial({ map:potMaps.map, roughnessMap:potMaps.data, bumpMap:potMaps.data, bumpScale,
    vertexColors:true, roughness:1, metalness:0, clearcoat:0, clearcoatRoughness:.3, ...finishOptions });
  // A shelf plant made earlier (this session or the last) is rebuilt from its
  // bake: its meshes depend on none of the colours or surface levels.
  const bakeKey = persist ? JSON.stringify([catalogPlant.id, variant, potId, String(seed), height]) : null;
  const baked = bakeKey ? shelfBake(bakeKey) : null;
  const mineral = new THREE.MeshStandardMaterial({ color:'#b7ae9c', roughness:1 });
  const stemMaterial = new THREE.MeshStandardMaterial({ color:0xffffff, vertexColors:true, roughness:.72 });
  const leafSurface = (level, notify) => botanicalTextures(variant, notify, level);
  const leafMaps = detailed ? own(leafSurface(quality, refresh)) : null;
  const leafMaterial = new THREE.MeshPhysicalMaterial({ map:leafMaps?.map ?? null, bumpMap:leafMaps?.data ?? null, roughnessMap:leafMaps?.data ?? null,
    color:0xffffff, vertexColors:true, bumpScale:width * (variant === 'succulent' ? .00035 : .0012),
    // Ivy is glossy rather than downy: its gloss lives in the thin clearcoat,
    // while a broad base specular would wash whole blades out to grey.
    sheen:variant === 'succulent' ? .25 : variant === 'ivy' ? 0 : .08, sheenColor:'#acc394', sheenRoughness:.85,
    side:THREE.DoubleSide, alphaTest:0, alphaToCoverage:false, specularIntensity:variant === 'ivy' ? .1 : .6,
    roughness:variant === 'zz' ? .55 : variant === 'ivy' ? .66 : variant === 'succulent' ? .88 : .85, metalness:0,
    clearcoat:variant === 'zz' ? .32 : variant === 'ivy' ? .1 : variant === 'succulent' ? .035 : .12, clearcoatRoughness:variant === 'ivy' ? .3 : .48 });
  let green = null, needles = null;
  if (baked) {
    // The generator creates these materials here, in this order.
    const roles = new Set(baked.bake.objects.map(object => object.role));
    if (roles.has('green')) green = cactusMaterial();
    if (roles.has('needles')) needles = needleMaterial();
  } else if (variant === 'cactus') {
    green = cactusMaterial();
    needles = needleMaterial();
  }
  const soilKind = variant === 'cactus' || variant === 'succulent' ? 'grit' : 'peat';
  const soilSurface = (level, notify) => surface(`soil:${soilKind}:${level}`, [128 * level, 128 * level], false, soilSpec(soilKind), notify);
  const soilMaps = own(soilSurface(quality, refresh));
  const soil = new THREE.MeshStandardMaterial({ map:soilMaps.map, roughnessMap:soilMaps.data, bumpMap:soilMaps.data,
    bumpScale:soilKind === 'grit' ? 1.4 : 1.1, roughness:1, vertexColors:true });
  const roleMaterials = { clay, soil, leaf:leafMaterial, stem:stemMaterial, mineral, green, needles };
  const bake = baked ? baked.bake : unpackBake(shelf.plant_model(units, potId ? 1 : 2, variant, potId ?? '', potModelId ?? '', Boolean(catalogPlant), detailed,
    [width, radius, potHeight, soilFraction, real.foliageHeight * unit, real.referenceHeight * unit, height]));
  const parts = restoreContent(bake, content, role => roleMaterials[role], object => { geometries.add(object.geometry); materials.add(object.material); });
  // Each shelf plant keeps its bake and its level-1 surfaces for the next launch.
  const levelOneSurfaces = () => new Set([potKey(1), ...detailed ? [`leaf:${variant}:1`] : [], `soil:${soilKind}:1`]);
  let shelfEntry = baked;
  if (bakeKey && !shelfEntry) shelfEntry = { bake, surfaces:null };
  if (shelfEntry) { shelfEntry.surfaces = levelOneSurfaces(); rememberBake(bakeKey, shelfEntry); }
  group.userData.variant = variant; group.userData.seed = String(seed);
  group.userData.catalogId = catalogPlant?.id ?? null; group.userData.potId = potId; group.userData.potColorId = potColor.id;
  group.userData.parts = parts;
  group.userData.inspectionResolution = entry.inspectionResolution || 0;
  if (quality > 1) group.userData.ready = plantSurfacesReady().then(() => !disposed);
  const surfaceBindings = [{ material:clay, create:potSurface }, { material:soil, create:soilSurface }];
  if (leafMaps && materials.has(leafMaterial)) surfaceBindings.push({ material:leafMaterial, create:leafSurface });
  let pendingQuality = null;
  const replaceSurfaceMaps = (material, maps) => {
    const previous = { map:material.map, data:material.bumpMap };
    for (const key of ['map','data']) {
      const before = previous[key], after = maps[key];
      // UV placement, filtering and anisotropy belong to the existing
      // model/renderer, not the procedural surface's shared source.
      after.offset.copy(before.offset); after.repeat.copy(before.repeat); after.center.copy(before.center);
      after.rotation = before.rotation; after.matrixAutoUpdate = before.matrixAutoUpdate; after.matrix.copy(before.matrix);
      for (const property of ['wrapS','wrapT','magFilter','minFilter','anisotropy','channel','flipY','premultiplyAlpha','unpackAlignment'])
        after[property] = before[property];
      textures.add(after);
    }
    material.map = maps.map; material.bumpMap = material.roughnessMap = maps.data;
    for (const map of Object.values(previous)) { textures.delete(map); map.dispose(); }
  };
  // A palette change paints the same pot. Its meshes, soil and foliage do not
  // depend on the pigment; preserve the exact painter pair and current detail.
  group.userData.updatePotColor = colorId => {
    if (disposed || !potId) return false;
    const next = getPotColor(potId, colorId);
    if (next.id === potColor.id) return true;
    const maps = potSurface(group.userData.inspectionResolution ? 2 : 1, refresh, next);
    // A queued inspection prepared maps of the former color. It must not
    // install those maps after this palette change has been committed.
    pendingQuality?.dispose();
    replaceSurfaceMaps(clay, maps);
    potColor = next;
    group.userData.potColorId = next.id;
    if (shelfEntry && shelfBakes.get(bakeKey) === shelfEntry) { shelfEntry.surfaces = levelOneSurfaces(); scheduleShelfBakeWrite(); }
    refresh();
    return true;
  };
  // Inspection changes pigment/detail map resolution only. Keep the exact
  // meshes, baked leaf geometry and material programs; prepare maps offscreen
  // and let the scene commit them after the gesture has settled.
  group.userData.prepareSurfaceQuality = resolution => {
    pendingQuality?.dispose();
    if (disposed) return { ready:Promise.resolve(false), apply:() => false, dispose() {} };
    const level = resolution ? 2 : 1, prepared = [];
    try {
      for (const binding of surfaceBindings) prepared.push({ ...binding, maps:binding.create(level) });
    } catch (error) {
      for (const item of prepared) for (const map of Object.values(item.maps)) map.dispose();
      throw error;
    }
    let released = false, ready = false;
    const plan = {
      ready:null,
      apply() {
        if (disposed || released || !ready || pendingQuality !== plan) return false;
        for (const { material, maps } of prepared) replaceSurfaceMaps(material, maps);
        group.userData.inspectionResolution = resolution || 0;
        released = true; pendingQuality = null;
        return true;
      },
      dispose() {
        if (released) return;
        released = true;
        for (const item of prepared) for (const map of Object.values(item.maps)) map.dispose();
        if (pendingQuality === plan) pendingQuality = null;
      }
    };
    pendingQuality = plan;
    plan.ready = plantSurfacesReady().then(() => ready = !disposed && !released && pendingQuality === plan);
    return plan;
  };
  group.userData.dispose = () => {
    if (disposed) return; disposed = true;
    pendingQuality?.dispose();
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) material.dispose();
    for (const texture of textures) texture.dispose();
  };
  // Materials created for an unused variant do not enter the scene traversal.
  for (const material of [stemMaterial, leafMaterial, mineral]) if (!materials.has(material)) material.dispose();
  return group;
}

export default createShelfPlant;
