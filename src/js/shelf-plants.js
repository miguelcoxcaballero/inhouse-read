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

function dataTexture(bytes, width, height, colorSpace, repeat) {
  const texture = new THREE.DataTexture(bytes, width, height, THREE.RGBAFormat);
  texture.colorSpace = colorSpace; texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter; texture.magFilter = THREE.LinearFilter;
  if (repeat) texture.wrapS = THREE.RepeatWrapping;
  texture.needsUpdate = true; return texture;
}

// Rust owns the row budget, queue, shared surface lifecycle and saved-model
// policies. The host only supplies browser/Three calls and decor-core bindings.
let paintState = null;
const state = () => paintState ??= needRustShelf().plant_surface_state();
const deferPlantPaint = createPlantPaintGate();
const paintHost = {
  defer:deferPlantPaint,
  schedule:() => idleWork(pump, { timeout:200, fallbackMs:16 }),
  warn:error => console.warn('No se pudo completar el detalle de las texturas de la planta:', error),
  savedSurface, loadedShelfBakes, scheduleShelfBakeWrite,
  texture:(bytes,width,height,color,repeat) => dataTexture(bytes,width,height,color ? THREE.SRGBColorSpace : THREE.NoColorSpace,repeat),
  lattice:(spec,width,height,repeat,pigment,data) => rustPlantLattice(getRustDecorCore(),spec,width,height,repeat,pigment,data),
  painters:[
    (job,count) => rustPlantGlazeRows(getRustDecorCore(),job.width,job.height,job.row,count,job.spec.config,job.pigment,job.data),
    (job,count) => rustPlantPotteryRows(getRustDecorCore(),job.spec.kind,job.width,job.height,job.row,count,job.spec.config,job.pigment,job.data),
    (job,count) => rustPlantSoilRows(getRustDecorCore(),job.spec.kind,job.width,job.height,job.row,count,job.pigment,job.data),
    (job,count) => rustPlantFoliageRows(getRustDecorCore(),job.spec.kind,job.width,job.height,job.row,count,job.spec.config,job.pigment,job.data)
  ],
  watchDispose(base,texture) {
    const released = () => {
      needRustShelf().plant_surface_release(base,texture);
      texture.removeEventListener('dispose',released);
    };
    texture.addEventListener('dispose',released);
  }
};
function pump(deadline) { needRustShelf().plant_surface_pump(state(),paintHost,deadline); }
/** Resolves once every procedural plant surface has its final detail. */
export const plantSurfacesReady = () => paintState ? needRustShelf().plant_surface_ready(paintState) : Promise.resolve();
function surface(key,[width,height],repeat,spec,refresh) {
  return needRustShelf().plant_surface(state(),paintHost,key,width,height,repeat,spec,refresh);
}

// Native descriptions choose pigments, material coefficients and exact raster
// sizes. The host creates Three textures from those descriptions.
const plannedSurface = (plan,refresh) => surface(plan.key,[plan.width,plan.height],plan.repeat,plan.spec,refresh);

const cactusMaterial = () => new THREE.MeshStandardMaterial({ color:0xffffff, vertexColors:true, roughness:.8 });
const needleMaterial = () => new THREE.LineBasicMaterial({ color:'#d9cda9', transparent:true, opacity:.8 });

/** Scene units per millimetre of a plant shown without a shelf (the catalogue preview). */

// A bake is the finished plant content as plain data: every object in its
// creation order (ids decide the draw order of equal sort keys), its parent
// and place among siblings, transform, material role and geometry arrays.
// The Rust shelf module builds it (rust-ui/src/plant_model.rs); a saved one is read back the same way.

/** The bake of a freshly made plant, from the packet the module returns: arrays are copied out of it. */
function unpackBake(bytes) {
  const packet = openPacket(bytes), { parts, objects } = packet.header;
  return { parts, objects:objects.map(({ geometry, rotation, ...object }) => ({ ...object, rotation:[...rotation, 'XYZ'],
    geometry:geometry ? { type:geometry.type, attributes:Object.fromEntries(geometry.attributes.map(([name, size, kind, at, length]) => [name, [packet.copy(kind, at, length), size, false]])),
      index:geometry.index && packet.copy(geometry.index[0], geometry.index[1], geometry.index[2]), groups:geometry.groups, userData:geometry.userData, box:geometry.box } : null })) };
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

// Keep the latest twelve shelf bakes, validate late disk records and collect
// only completed surface images. Those decisions share the Rust queue state.
const shelfBake = key => needRustShelf().plant_bake_get(state(),paintHost,key);
const rememberBake = (key,entry) => needRustShelf().plant_bake_remember(state(),paintHost,key,entry);
export const shelfPlantBakeRecord = () => paintState
  ? needRustShelf().plant_bake_record(paintState) : { models:[], surfaces:[] };

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
  const geometry = plantGeometrySpec(entry), {catalogPlant,potId,potModelId,real,height,unit} = geometry;
  const shelf = needRustShelf(), potColor = getPotColor(potId,entry.potColorId);
  const appearance = shelf.plant_appearance(entry,geometry,potColor,persist);
  const {quality,variant,seed,width,radius,potHeight,detailed,units,clayColor,soilKind,bakeKey} = appearance;
  const group = new THREE.Group(), content = new THREE.Group();
  content.position.y = -height / 2; group.add(content);
  const textures = new Set(), materials = new Set(), geometries = new Set();
  const lifecycle = shelf.plant_lifecycle_state(potColor,textures,materials,geometries);
  const refresh = () => shelf.plant_refresh(lifecycle);
  const own = maps => shelf.plant_own_maps(lifecycle,maps);
  const soilFraction = POT_SOIL_FRACTION;
  const finish = shelf.plant_finish_material(potModelId ?? '');
  const potKey = (level,color = lifecycle.potColor) => shelf.plant_pot_key(potId,color.hex,clayColor,level);
  const potSurface = (level,notify,color = lifecycle.potColor) => plannedSurface(shelf.plant_pot_surface(potId,potModelId ?? '',color.hex,clayColor,level),notify);
  const potMaps = own(potSurface(quality, refresh));
  // Texels stay roughly square on the outer wall, whatever the pot proportions.
  potMaps.map.repeat.x = potMaps.data.repeat.x = appearance.repeat;
  potMaps.map.offset.x = potMaps.data.offset.x = appearance.offset;
  const { bumpScale, ...finishOptions } = finish;
  const clay = new THREE.MeshPhysicalMaterial({ map:potMaps.map, roughnessMap:potMaps.data, bumpMap:potMaps.data, bumpScale,
    vertexColors:true, roughness:1, metalness:0, clearcoat:0, clearcoatRoughness:.3, ...finishOptions });
  // A shelf plant made earlier (this session or the last) is rebuilt from its
  // bake: its meshes depend on none of the colours or surface levels.
  const baked = bakeKey ? shelfBake(bakeKey) : null;
  const mineral = new THREE.MeshStandardMaterial({ color:'#b7ae9c', roughness:1 });
  const stemMaterial = new THREE.MeshStandardMaterial({ color:0xffffff, vertexColors:true, roughness:.72 });
  const leafSurface = (level, notify) => plannedSurface(shelf.plant_leaf_surface(variant,level),notify);
  const leafMaps = detailed ? own(leafSurface(quality, refresh)) : null;
  const leafMaterial = new THREE.MeshPhysicalMaterial({ map:leafMaps?.map ?? null, bumpMap:leafMaps?.data ?? null, roughnessMap:leafMaps?.data ?? null,
    ...shelf.plant_leaf_material(variant,width), side:THREE.DoubleSide });
  const extra = shelf.plant_extra_materials(baked,variant);
  const green = extra & 1 ? cactusMaterial() : null, needles = extra & 2 ? needleMaterial() : null;
  const soilSurface = (level,notify) => plannedSurface(shelf.plant_soil_surface(soilKind,level),notify);
  const soilMaps = own(soilSurface(quality, refresh));
  const soil = new THREE.MeshStandardMaterial({ map:soilMaps.map, roughnessMap:soilMaps.data, bumpMap:soilMaps.data,
    bumpScale:soilKind === 'grit' ? 1.4 : 1.1, roughness:1, vertexColors:true });
  const roleMaterials = { clay, soil, leaf:leafMaterial, stem:stemMaterial, mineral, green, needles };
  const bake = baked ? baked.bake : unpackBake(shelf.plant_model(units, appearance.skip, variant, potId ?? '', potModelId ?? '', Boolean(catalogPlant), detailed,
    [width, radius, potHeight, soilFraction, real.foliageHeight * unit, real.referenceHeight * unit, height]));
  const parts = restoreContent(bake, content, role => roleMaterials[role], object => { geometries.add(object.geometry); materials.add(object.material); });
  // Each shelf plant keeps its bake and its level-1 surfaces for the next launch.
  const levelOneSurfaces = () => shelf.plant_surface_keys(potKey(1),detailed,variant,soilKind);
  let shelfEntry = baked;
  if (bakeKey && !shelfEntry) shelfEntry = { bake, surfaces:null };
  if (shelfEntry) { shelfEntry.surfaces = levelOneSurfaces(); rememberBake(bakeKey, shelfEntry); }
  group.userData.variant = variant; group.userData.seed = seed;
  group.userData.catalogId = catalogPlant?.id ?? null; group.userData.potId = potId; group.userData.potColorId = potColor.id;
  group.userData.parts = parts;
  group.userData.inspectionResolution = entry.inspectionResolution || 0;
  if (quality > 1) group.userData.ready = plantSurfacesReady().then(() => !lifecycle.disposed);
  const surfaceBindings = [{ material:clay, create:potSurface }, { material:soil, create:soilSurface }];
  if (leafMaps && materials.has(leafMaterial)) surfaceBindings.push({ material:leafMaterial, create:leafSurface });
  // GC-owned callback adapters: Rust owns cancellation, readiness, map swaps,
  // colour commits and disposal, including reentrant texture dispose events.
  lifecycle.host = {
    group, potId, clay, shelfEntry, surfaceBindings, refresh, getPotColor,
    potSurface, levelOneSurfaces, scheduleShelfBakeWrite, surfacesReady:plantSurfacesReady,
    bakeCurrent:() => shelf.plant_bake_current(state(),bakeKey,shelfEntry),
    makePlan:plan => ({ ready:null, apply:() => shelf.plant_quality_apply(lifecycle,plan), dispose:() => shelf.plant_quality_dispose(lifecycle,plan) }),
    readyPlan:plan => () => shelf.plant_quality_ready(lifecycle,plan)
  };
  group.userData.updatePotColor = colorId => shelf.plant_update_pot_color(lifecycle,colorId);
  group.userData.prepareSurfaceQuality = resolution => shelf.plant_prepare_quality(lifecycle,resolution);
  group.userData.dispose = () => shelf.plant_dispose(lifecycle);
  shelf.plant_dispose_unused(lifecycle,[stemMaterial,leafMaterial,mineral]);
  return group;
}

export default createShelfPlant;
