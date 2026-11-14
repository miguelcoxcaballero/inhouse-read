import * as THREE from 'three';
import { plantGeometrySpec } from './decor-geometry-spec.js';
import { idleWork } from './idle-startup.js';
import { getRustDecorCore } from './rust-decor-core.js';
import { needRustShelf } from './rust-shelf.js';
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

// A bake is the finished plant content as plain data: every object in its
// creation order (ids decide the draw order of equal sort keys), its parent
// and place among siblings, transform, material role and geometry arrays.
// The Rust shelf module draws it and reads its packet into this record
// (rust-ui/src/plant_model.rs, plant_build.rs); a saved one is read back the same way.

// The copy JSON makes of `userData`; an empty plain object (most are) needs no JSON.
function copied(data) {
  if (data != null) {
    for (const key in data) return JSON.parse(JSON.stringify(data));
    if (Object.getPrototypeOf(data) !== Object.prototype) return JSON.parse(JSON.stringify(data));
  }
  return {};
}

const strictlyEqual = (a, b) => a === b;

function restoreGeometry(baked) {
  const geometry = new THREE.BufferGeometry(), attributes = baked.attributes, groups = baked.groups;
  geometry.type = baked.type;
  for (const name in attributes) {
    const attribute = attributes[name];
    geometry.setAttribute(name, new THREE.BufferAttribute(attribute[0], attribute[1], attribute[2]));
  }
  if (baked.index) geometry.setIndex(new THREE.BufferAttribute(baked.index, 1));
  for (let index = 0; index < groups.length; index++) geometry.addGroup(groups[index][0], groups[index][1], groups[index][2]);
  geometry.userData = copied(baked.userData);
  if (baked.box) geometry.boundingBox = new THREE.Box3(new THREE.Vector3().fromArray(baked.box), new THREE.Vector3().fromArray(baked.box, 3));
  return geometry;
}

function restoreContent(bake, content, materialFor, track, drawn) {
  const objects = bake.objects.map(baked => {
    const object = baked.kind === 'group' ? new THREE.Group() : new (baked.kind === 'lines' ? THREE.LineSegments : THREE.Mesh)(restoreGeometry(baked.geometry), materialFor(baked.role));
    object.name = baked.name;
    object.position.fromArray(baked.position); object.scale.fromArray(baked.scale);
    // Euler and quaternion each follow whichever of them was set last. A quaternion alone gives the angles
    // 0, 0, 0 back as -0, 0, -0: a plant just drawn keeps its own zeros, a remembered one those, as before.
    object.quaternion.fromArray(baked.quaternion);
    const turn = baked.rotation, rotation = object.rotation, same = drawn ? Object.is : strictlyEqual;
    if (!same(rotation.x, turn[0]) || !same(rotation.y, turn[1]) || !same(rotation.z, turn[2]) || rotation.order !== turn[3]) rotation.set(turn[0], turn[1], turn[2], turn[3]);
    object.castShadow = baked.castShadow; object.receiveShadow = baked.receiveShadow;
    object.userData = copied(baked.userData);
    if (baked.kind !== 'group') track(object);
    return object;
  });
  const order = bake.objects.map((baked, index) => index).sort((a, b) => bake.objects[a].place - bake.objects[b].place);
  for (let index = 0; index < order.length; index++) {
    const parent = bake.objects[order[index]].parent;
    (parent === -1 ? content : objects[parent]).add(objects[order[index]]);
  }
  return [...bake.parts];
}

// Keep the latest twelve shelf bakes, validate late disk records and collect
// only completed surface images. Those decisions share the Rust queue state.
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
  const geometry = plantGeometrySpec(entry), {catalogPlant,potId,potModelId,height} = geometry;
  const shelf = needRustShelf(), potColor = getPotColor(potId,entry.potColorId);
  const group = new THREE.Group(), content = new THREE.Group();
  content.position.y = -height / 2; group.add(content);
  const textures = new Set(), materials = new Set(), geometries = new Set();
  // The plant's look, its three shared surfaces, its material options and its bake, in one call
  // (rust-ui/src/plant_recipe.rs); `refresh` is only kept there for a surface still being painted.
  let lifecycle;
  const refresh = () => shelf.plant_refresh(lifecycle);
  const recipe = shelf.plant_recipe(state(),paintHost,entry,geometry,potColor,persist,POT_SOIL_FRACTION,textures,materials,geometries,refresh);
  const {variant,seed,quality,detailed,clayColor,soilKind,bakeKey,extra} = recipe;
  lifecycle = recipe.lifecycle;
  const potKey = (level,color = lifecycle.potColor) => shelf.plant_pot_key(potId,color.hex,clayColor,level);
  const potSurface = (level,notify,color = lifecycle.potColor) => plannedSurface(shelf.plant_pot_surface(potId,potModelId ?? '',color.hex,clayColor,level),notify);
  const clay = new THREE.MeshPhysicalMaterial(recipe.clay);
  const mineral = new THREE.MeshStandardMaterial({ color:'#b7ae9c', roughness:1 });
  const stemMaterial = new THREE.MeshStandardMaterial({ color:0xffffff, vertexColors:true, roughness:.72 });
  const leafSurface = (level, notify) => plannedSurface(shelf.plant_leaf_surface(variant,level),notify);
  const leafMaterial = new THREE.MeshPhysicalMaterial(recipe.leaf);
  const green = extra & 1 ? cactusMaterial() : null, needles = extra & 2 ? needleMaterial() : null;
  const soilSurface = (level,notify) => plannedSurface(shelf.plant_soil_surface(soilKind,level),notify);
  const soil = new THREE.MeshStandardMaterial(recipe.soil);
  const roleMaterials = { clay, soil, leaf:leafMaterial, stem:stemMaterial, mineral, green, needles };
  const parts = restoreContent(recipe.bake, content, role => roleMaterials[role], object => { geometries.add(object.geometry); materials.add(object.material); }, !recipe.baked);
  // Each shelf plant keeps its bake and its level-1 surfaces for the next launch.
  const levelOneSurfaces = () => shelf.plant_surface_keys(potKey(1),detailed,variant,soilKind);
  const shelfEntry = shelf.plant_recipe_keep(state(),paintHost,lifecycle,recipe,geometry,[stemMaterial,leafMaterial,mineral]);
  group.userData.variant = variant; group.userData.seed = seed;
  group.userData.catalogId = catalogPlant?.id ?? null; group.userData.potId = potId; group.userData.potColorId = potColor.id;
  group.userData.parts = parts;
  group.userData.inspectionResolution = entry.inspectionResolution || 0;
  if (quality > 1) group.userData.ready = plantSurfacesReady().then(() => !lifecycle.disposed);
  const surfaceBindings = [{ material:clay, create:potSurface }, { material:soil, create:soilSurface }];
  if (detailed && materials.has(leafMaterial)) surfaceBindings.push({ material:leafMaterial, create:leafSurface });
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
  return group;
}

export default createShelfPlant;
