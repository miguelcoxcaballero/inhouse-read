import * as THREE from 'three';
import {projectPlantFoliage} from './foliage-projection.js';
import { configureShelfRendererSize } from './shelf-renderer-size.js';
import { shelfPixelOffset } from './shelf-pixel-origin.js';
import { refreshCanvasFontsAfterPaint } from './canvas-font-readiness.js';
import { createBookModel, getBookRenderer, lightBookScene } from './book-model.js';
import { bookmarkFor } from './bookshelf-layout.js';
import { canAdoptShelfMetadata } from './shelf-metadata-records.js';
import { shelfBookSlot, shelfBookInsertion, projectShelfBookPose } from './bookshelf-return.js';
import { createShelfFurniture, createShelfOcclusion } from './shelf-furniture.js';
import { createShelfPlant } from './shelf-plants.js';
import { createShelfLamp } from './shelf-lamps.js';
import { createTintTransition, lampTint } from './lamp-kelvin.js';
import { createShelfLighting, widePenumbra } from './shelf-lighting.js';
import { createShelfLampLighting } from './shelf-lamp-lighting.js';
import { createShelfTrash, sampleTrashDrop } from './shelf-trash.js';
import { createShelfCatalog } from './shelf-catalog.js';
import { createBaggebo } from './baggebo-model.js';
import { compilePrograms, prelinkPrograms } from './gpu-programs.js';
import { prepareInsertionPrograms } from './insertion-program-preparation.js';
import { idleSlice } from './idle-startup.js';
import { BAGGEBO_SPEC, SHELF_SPECS, normalizeShelfType } from './shelf-types.js';
import { MINIMUM_LAMP_TAP_SIZE } from './plant-dimensions.js';
import { needRustShelf } from './rust-shelf.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createNativeRendererPresentation, currentNativeRendererPresentation, registerCanvasSnapshot, withRendererPresentation } from './native-renderer-presentation.js';
import { createNativeFramebufferCache } from './native-room-cache.js';
import { applyShelfOccluders, clearShelfOccluders, shelfOccluders } from './shelf-light-occlusion.js';

const WALNUT = new URL('../assets/library/walnut-pbr.webp', import.meta.url).href;
// Packed from the same photograph: R = pore/figure height, G = roughness.
const WALNUT_SURFACE = new URL('../assets/library/walnut-surface.webp', import.meta.url).href;
// Where images decode off the main thread, the veneer files are fetched as
// the app loads (index.html preloads them for exactly this request) and
// decoded once for every scene. A saved walnut shelf decodes them at once,
// so the cabinet's first frame already has its wood. The bitmap is flipped
// exactly as WebGL's UNPACK_FLIP_Y flips an image, unconverted.
const veneerFiles = new Map(), veneers = new Map();
const VENEER_BITMAP = { imageOrientation:'flipY', premultiplyAlpha:'none', colorSpaceConversion:'none' };
const offThreadVeneer = () => typeof createImageBitmap === 'function' && typeof fetch === 'function';
function veneerFile(url) {
  let file = veneerFiles.get(url);
  if (!file) veneerFiles.set(url, file = fetch(url).then(response => {
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.blob();
  }));
  return file;
}
function veneer(url) {
  let source = veneers.get(url);
  if (source) return source;
  source = { image:undefined, waiting:[] };
  veneers.set(url, source);
  const settle = image => { source.image = image; for (const callback of source.waiting.splice(0)) callback(); };
  veneerFile(url).then(blob => createImageBitmap(blob, VENEER_BITMAP)).then(settle, () => settle(null));
  return source;
}
if (offThreadVeneer()) {
  veneerFile(WALNUT).catch(() => {}); veneerFile(WALNUT_SURFACE).catch(() => {});
  try {
    if (normalizeShelfType(localStorage.getItem('inhouse-read-shelf-type')) === 'walnut') { veneer(WALNUT); veneer(WALNUT_SURFACE); }
  } catch { /* Without storage the scene decodes the veneer itself. */ }
}
const DURATION = 700;
const VENEER_WAIT = 3000;
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const ease = t => t * t * t * (t * (t * 6 - 15) + 10);
const TRASH_PADDING = 7, TRASH_GAP = 12;
const SVG_NS = 'http://www.w3.org/2000/svg';
let foliageSerial = 0;
const PLANT_DIAGNOSTICS = ['plantModelCatalogId', 'plantModelDepth', 'plantLeafTexture', 'plantLeafOpacity'];
function clearPlantDiagnostics(node) { if (node) for (const key of PLANT_DIAGNOSTICS) delete node.dataset[key]; }
// Diagnostics rarely change from one frame to the next, yet even an identical
// attribute write queues mutation records and style invalidation.
function setData(element, key, value) { if (element.dataset[key] !== value) element.dataset[key] = value; }
const SHELF_DIMENSIONS = Object.fromEntries(Object.entries(SHELF_SPECS).map(([type, spec]) => [type, JSON.stringify(spec.dimensions)]));
const NO_FLAGS = Object.freeze({ away:false, dragging:false, lifted:false, pressed:false });
const IDENTITY = new THREE.Matrix4();
const NO_NUMBERS = new Float64Array(0);
// The inline geometry last written to a projected node: unchanged numbers are not restyled.
const hitStyleCache = node => ({ node, left:NaN, top:NaN, width:NaN, height:NaN, z:NaN, fixed:false });
const entryStyleCache = node => ({ ...hitStyleCache(node), coverLeft:NaN, coverTop:NaN, coverWidth:NaN, coverHeight:NaN,
  display:'', events:'', coverFixed:false });

/** The native touch surface follows solid leaves, including fenestrations.
 * Project their actual front-facing triangles rather than a rectangular hull.
 * The resulting path is cached by the caller until the model's pose changes.
 */
export {projectPlantFoliage};

function trashFootprint(bin) {
  const position = bin.position.clone(), rotation = bin.rotation.clone(), scale = bin.scale.clone();
  const openness = Number(bin.userData.openness) || 0;
  const bounds = new THREE.Box3();
  bin.position.set(0, 0, 0); bin.rotation.set(0, 0, 0); bin.scale.setScalar(1);
  // Reserve the real hinged lid's full movement, rather than a permanently
  // narrow cabinet or an estimate that clips the open bin on small phones.
  for (const open of [0, .5, 1]) {
    bin.userData.setState({ openness:open }); bin.updateMatrixWorld(true);
    bounds.union(new THREE.Box3().setFromObject(bin));
  }
  bin.position.copy(position); bin.rotation.copy(rotation); bin.scale.copy(scale);
  bin.userData.setState({ openness }); bin.updateMatrixWorld(true);
  return bounds;
}

/** Bottom-standing objects project onto the front plane. Under-shelf fixtures
 * project at their actual mounting depth, then snap to the nearest ceiling.
 * In a pitched view, intersecting the front plane shifts a ceiling pointer
 * vertically and can mistakenly select the shelf immediately above it.
 */
export function projectShelfDropPosition(worldRay, furnitureMatrix, rows, width, options = {}) {
  const padding = typeof options === 'number' ? options : options.padding ?? 16;
  const undershelf = typeof options === 'object' && options.mount === 'undershelf';
  const mountingDepth = undershelf ? Math.max(0, Number(options.depth) || 0) / 2 : 0;
  // Validate the host inputs before packing rows or dereferencing the ray.
  if (!rows.length || !Number.isFinite(width) || width <= padding * 2) return null;
  const placed = needRustShelf().scene_drop_position([worldRay.origin.x, worldRay.origin.y, worldRay.origin.z,
    worldRay.direction.x, worldRay.direction.y, worldRay.direction.z], furnitureMatrix.elements, packRows(rows), width, padding,
    undershelf, mountingDepth);
  return placed.length ? { shelf:placed[0], x:placed[1], ...(undershelf ? { mount:'undershelf' } : {}) } : null;
}

/** Seven numbers per shelf for the Rust view: its edges, then which optional fields it has. */
function packRows(rows) {
  const packed = new Float64Array(rows.length * 7);
  for (let index = 0; index < rows.length; index++) {
    const { top, bottom, left, right, ceiling, padding } = rows[index], at = index * 7;
    packed[at] = Number(top); packed[at + 1] = Number(bottom); packed[at + 2] = Number(left); packed[at + 3] = Number(right);
    packed[at + 4] = Number(ceiling ?? top); packed[at + 5] = Number(padding);
    packed[at + 6] = (left !== undefined ? 1 : 0) | (right !== undefined ? 2 : 0) | (ceiling != null ? 4 : 0) | (padding !== undefined ? 8 : 0);
  }
  return packed;
}

function releaseObject(object) {
  const materials = new Set();
  object.traverse(child => {
    child.geometry?.dispose();
    for (const material of [].concat(child.material || [])) materials.add(material);
  });
  for (const material of materials) material.dispose();
}

// A missing file must not leave its maps sampling an empty (black) unit:
// zero roughness would turn the cabinet into a mirror. Flat mean instead.
function veneerSwatch(map, mean) {
  const swatch = document.createElement('canvas'), context = swatch.getContext('2d');
  swatch.width = swatch.height = 1;
  if (context) { context.fillStyle = mean; context.fillRect(0, 0, 1, 1); }
  map.image = swatch; map.needsUpdate = true;
}

/** Give an off-thread `map` its veneer: at once when already decoded
 * (returns true), else when it arrives, then calling `onLoad`. */
function loadVeneer(map, url, mean, onLoad) {
  const source = veneer(url);
  const apply = () => {
    if (!source.image) { veneerSwatch(map, mean); return; }
    map.image = source.image; map.flipY = false; map.needsUpdate = true;
  };
  if (source.image !== undefined) { apply(); return true; }
  source.waiting.push(() => { apply(); onLoad(); });
  return false;
}

function walnutTexture(url, renderer, colour, mean, onLoad) {
  const map = offThreadVeneer() ? new THREE.Texture()
    : new THREE.TextureLoader().load(url, onLoad, undefined, () => { veneerSwatch(map, mean); onLoad(); });
  if (colour) map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  // Geometry UVs repeat every 160 shelf pixels. The seamless photograph is a
  // ~32 cm flitch of veneer, so it spans two repeats and its figure reads true.
  map.repeat.set(.5, .5);
  map.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  return map;
}

// Theme tints: the canvas is transparent over the page, so the same walnut is
// graded slightly deeper on the dark page and a little brighter on the light
// one. Near-neutral: the warmth comes from the key light, not a colour cast.
const WOOD_TONES = {
  light:{ wood:'#ffffff', back:'#ebe8e4', trim:'#f5f2ee' },
  dark:{ wood:'#ebe8e5', back:'#d2cec9', trim:'#e0dcd7' }
};
// The near-black page gets a faint warm pool of lamp light on the floor
// (linear RGB, peak alpha), so the cabinet's contact shadow has something to
// darken. The pale page needs none: its shadows already read.
const DARK_FLOOR_LIGHT = [.5, .4, .29, .11];
const darkPage = () => document.documentElement.dataset.theme === 'dark';

/** One demand-rendered scene for the entire piece of furniture and its books.
 * Pixel coordinates describe the unrotated shelf. DOM buttons remain semantic
 * hit targets, projected from the meshes after every camera/group update.
 */
export function createBookshelfScene({ stage, scroller, entries, rows, width, height, sceneWidth = width,
  trashNode = null, catalogNode = null, mode = 'spine', shelfType = 'walnut', unitWidth = width, unitCount = 1, settleBooks = true, batchQuality = true, physicsReady = true }) {
  shelfType = normalizeShelfType(shelfType);
  const renderer = getBookRenderer();
  if (!renderer || !width || !height) return null;
  const rust = needRustShelf();
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) return null;
  canvas.className = 'ihr-bookshelf-scene';
  canvas.setAttribute('aria-hidden', 'true');
  Object.assign(canvas.style, { position:'sticky', top:'0', left:'0', display:'block', pointerEvents:'none', zIndex:'0' });
  let originalHeight = stage.style.height;
  let originalTop = stage.style.top;
  let stagePixelOffset = 0;
  let alreadyScene = stage.classList.contains('has-scene');
  const originalStyles = new Map(entries.filter(entry => entry.node).map(entry => [entry.node, entry.node.getAttribute('style')]));
  const semanticCovers = new Map();
  const semanticFoliage = new Map();
  const releasedCandidates = new WeakSet();
  stage.classList.add('has-scene');
  stage.prepend(canvas);
  const scene = new THREE.Scene();
  lightBookScene(scene);
  const lighting = createShelfLighting(scene, renderer);
  const lampLighting = createShelfLampLighting(scene, { onAreaLightsReady:() => invalidate(true, false, 'lamp-lights') });
  // Keep the reader's shared renderer unchanged. Shelf fixtures compete with
  // softer room daylight, rather than the full book-reading studio rig.
  const daylight = scene.children.filter(child => child.isLight)
    .map(light => ({ light, intensity:light.intensity }));
  const daylightEnvironment = scene.environmentIntensity;
  let daylightFactor = 1;
  const roomKey = scene.userData.readerLight;
  const roomKeyColor = roomKey?.color.clone();
  const furniture = new THREE.Group();
  scene.add(furniture);
  sceneWidth = Math.max(1, Number(sceneWidth) || width);
  let trash = trashNode ? createShelfTrash() : null;
  let trashBounds = trash ? trashFootprint(trash) : null;
  if (trash) furniture.add(trash);
  let catalog = catalogNode ? createShelfCatalog() : null;
  if (catalog) furniture.add(catalog);
  const camera = new THREE.OrthographicCamera(0, width, 0, -1, .1, 20000);
  camera.position.z = 8000;
  const insertionCamera = new THREE.OrthographicCamera(0, 1, 0, -1, .1, 20000);
  insertionCamera.position.z = 8000;
  const texture = walnutTexture(WALNUT, renderer, true, '#71553f', () => invalidate());
  const grain = walnutTexture(WALNUT_SURFACE, renderer, false, '#759380', () => invalidate());
  // Only the walnut cabinet draws the veneer; BAGGEBO never loads it. Until it
  // arrives (or VENEER_WAIT passes) the room is not painted with black boards.
  let veneerWaits = 0, veneerDeadline = 0, veneerTimer = 0;
  function useVeneer() {
    if (!offThreadVeneer()) return;
    for (const [map, url, mean] of [[texture, WALNUT, '#71553f'], [grain, WALNUT_SURFACE, '#759380']]) {
      if (map.userData.veneer) continue;
      map.userData.veneer = true;
      if (loadVeneer(map, url, mean, () => { veneerWaits--; if (!disposed && shelfType !== 'baggebo') invalidate(); })) continue;
      veneerWaits++; veneerDeadline = performance.now() + VENEER_WAIT;
    }
  }
  // Oiled walnut under a thin satin lacquer: the pores stay open and matte in
  // the base layer while a smooth clearcoat carries the room's reflections.
  // Vertex colours carry each board's own tone, end grain and joint shadow.
  const wood = new THREE.MeshPhysicalMaterial({ map:texture, bumpMap:grain, bumpScale:.55, roughnessMap:grain,
    vertexColors:true, color:'#ffffff', roughness:.9, clearcoat:.32, clearcoatRoughness:.36 });
  const backWood = widePenumbra(new THREE.MeshStandardMaterial({ map:texture, bumpMap:grain, bumpScale:.4, roughnessMap:grain,
    vertexColors:true, color:'#e6dccf', roughness:1.2, envMapIntensity:.7 }));
  const darkWood = new THREE.MeshPhysicalMaterial({ map:texture, bumpMap:grain, bumpScale:.5, roughnessMap:grain,
    vertexColors:true, color:'#f2e6d6', roughness:.95, clearcoat:.26, clearcoatRoughness:.4 });
  const floorMaterial = new THREE.MeshStandardMaterial({ map:texture, color:'#b3a68d', roughness:.94 });
  // Baked corner occlusion and floor contact: one unlit, depth-tested draw.
  const occlusionMaterial = new THREE.MeshBasicMaterial({ vertexColors:true, transparent:true, depthWrite:false,
    side:THREE.DoubleSide, polygonOffset:true, polygonOffsetFactor:-1, polygonOffsetUnits:-2 });
  // Unlit depth writers (indexed by side) for the insertion's depth pass.
  const depthOnly = [THREE.FrontSide, THREE.BackSide, THREE.DoubleSide]
    .map(side => new THREE.MeshBasicMaterial({ side, colorWrite:false }));
  const occlusion = new THREE.Mesh(new THREE.BufferGeometry(), occlusionMaterial);
  occlusion.name = 'Cabinet occlusion'; occlusion.raycast = () => {};
  const floor = new THREE.Mesh(new THREE.BoxGeometry(1, 2, 1), floorMaterial);
  floor.name = 'Library floor'; floor.userData.floor = true; floor.receiveShadow = true;
  // Keep the physical support and contact diagnostics without painting a
  // wooden platform around the cabinet or reserving camera space for it.
  floor.visible = false;
  furniture.add(floor, occlusion);
  // A room wall, separated from the open steel cabinet, catches real warm
  // light through its mesh. Its edges stay outside the viewport at any zoom;
  // it contributes neither furniture bounds nor selectable/drop surfaces.
  const roomWallMaterial = new THREE.MeshStandardMaterial({ color:'#f0f1ed', roughness:1, envMapIntensity:.7 });
  const roomWall = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), roomWallMaterial);
  roomWall.name = 'Library room wall'; roomWall.userData.roomReceiver = true;
  roomWall.receiveShadow = true; roomWall.raycast = () => {};
  furniture.add(roomWall);
  let floorY = -height, floorLit = false;
  const standOut = new Float64Array(3);
  // The cabinet's units, the floor and the room's wall are laid out in Rust (rust-ui/src/scene_plan.rs).
  const roomPlan = () => {
    const plan = new Float64Array(10 + Math.max(1, Math.ceil(unitCount)));
    sceneView.roomPlan(unitWidth, SHELF_SPECS[shelfType].width, BAGGEBO_SPEC.width, unitCount, floorY, plan);
    return plan;
  };
  // Both shelf types are exact 600 x 250 x 1160 mm units (shelf-types.js).
  const specDepth = () => SHELF_SPECS[shelfType].depth * unitWidth / SHELF_SPECS[shelfType].width;
  let depth = specDepth();
  const entryKey = (entry, index) => entry.kind === 'plant' || entry.kind === 'lamp'
    ? `${entry.kind}:${entry.node?.dataset.objectId ?? entry.key ?? index}`
    : `book:${String(entry.book?.id ?? entry.node?.dataset.bookId ?? entry.book?.path ?? entry.book?.title ?? index)}`;
  const freshPreview = () => ({ x:0, y:0, fromX:0, fromY:0, targetX:0, targetY:0, started:0, active:false });
  const freshEntry = (entry, index) => ({ ...entry, key:entryKey(entry, index), model:null, replacement:null, pose:new THREE.Object3D(),
    lift:{ value:0, from:0, target:0, started:0 }, landing:null, offset:{ x:0, y:0 }, preview:freshPreview(), state:'', rect:null, hitRect:null, insertion:null,
    overview:false, inspectionResolution:0, qualityReplacement:false, replacementReady:false,
    // Per-frame caches of what the DOM said last time (see stateFor, hitSurface, project).
    classText:null, flags:NO_FLAGS, bits:0, dragX:'', dragY:'', dragNumberX:0, dragNumberY:0, stateText:'', box:null, fallback:null,
    written:null, seen:0, domDirty:true });
  // The camera framing, the turn between the views, the inspection zoom and pan and the drop guide's place
  // live in Rust (rust-ui/src/scene_view.rs); the sizes are the same ones this closure keeps for its objects.
  const sceneView = new rust.RustScene(width, height, sceneWidth, depth, shelfType === 'baggebo', mode === 'isometric', scroller.scrollTop);
  const bookGravity = new rust.RustBookGravity();
  const physicsStorageKey = 'inhouse-read-shelf-physics-v1';
  let physicsStarted = false;
  if (settleBooks) { try { bookGravity.restore(localStorage.getItem(physicsStorageKey) || ''); } catch {} }
  let gravityInput = new Float64Array(0), gravityOutput = new Float64Array(0), physicsStates = new Float64Array(0);
  let bookEntries = entries.map(freshEntry);
  const byNode = new Map(bookEntries.filter(entry => entry.node).map(entry => [entry.node, entry]));
  let occluderCabinet = null, occluderDescription = null;
  scene.onBeforeRender = (_renderer, _scene, view) => applyShelfOccluders(occluderCabinet, occluderDescription, view);
  scene.onAfterRender = clearShelfOccluders;
  function rebuildFurniture() {
    if (shelfType !== 'baggebo') useVeneer();
    if (roomKey) roomKey.color.copy(shelfType === 'baggebo' ? new THREE.Color('#ffffff') : roomKeyColor);
    for (const object of [...furniture.children]) if (object.userData.furniture) {
      furniture.remove(object); object.userData.disposeGeometry?.();
    }
    let cabinet;
    const plan = roomPlan();
    const unitScale = plan[0];
    cabinet = new THREE.Group(); cabinet.userData.furniture = true;
    const units = [];
    if (shelfType === 'baggebo') {
      cabinet.name = 'BAGGEBO units';
      for (let index = 0; index < unitCount; index++) {
        const unit = createBaggebo({ width:unitWidth });
        unit.position.x = plan[10 + index];
        cabinet.add(unit); units.push(unit);
      }
      cabinet.userData.disposeGeometry = () => { for (const unit of units) unit.userData.dispose(); };
    } else {
      cabinet.name = 'Walnut cabinet units';
      for (let index = 0; index < unitCount; index++) {
        const unit = createShelfFurniture({ width:unitWidth, height, depth, scale:unitScale, wood, backWood, darkWood,
          rows:rows.filter(row => (row.unit ?? 0) === index) });
        unit.position.x = plan[10 + index];
        cabinet.add(unit); units.push(unit);
      }
      cabinet.userData.disposeGeometry = () => { for (const unit of units) unit.userData.disposeGeometry?.(); };
      // A single unit is the cabinet itself: no wrapper group to traverse.
      if (unitCount === 1) { cabinet = units[0]; cabinet.position.x = 0; cabinet.userData.furniture = true; }
    }
    furniture.add(cabinet);
    // Its boards and panels stop the lamps' light (shelf-light-occlusion.js).
    occluderCabinet = cabinet; occluderDescription = shelfOccluders(cabinet);
    // Geometry determines the shared floor: long upright ends or the last
    // shelf board can be the cabinet's lowest physical surface.
    const localBounds = new THREE.Box3();
    const measureLocal = (object, parentMatrix) => {
      object.updateMatrix();
      const matrix = parentMatrix.clone().multiply(object.matrix);
      if (object.geometry) {
        object.geometry.computeBoundingBox();
        localBounds.union(object.geometry.boundingBox.clone().applyMatrix4(matrix));
      }
      for (const child of object.children) measureLocal(child, matrix);
    };
    measureLocal(cabinet, new THREE.Matrix4());
    floorY = localBounds.min.y;
    floor.geometry.dispose();
    const room = roomPlan();
    floor.geometry = new THREE.BoxGeometry(room[2], 2, room[3]);
    floor.geometry.computeBoundingBox();
    floor.position.set(room[4], room[5], room[6]);
    roomWall.scale.set(room[7], room[7], 1);
    roomWall.position.set(0, room[8], room[9]);
    positionTrash();
  }
  function rebuildOcclusion() {
    occlusion.geometry.dispose();
    floorLit = darkPage();
    occlusion.visible = shelfType !== 'baggebo';
    if (shelfType === 'baggebo') { occlusion.geometry = new THREE.BufferGeometry(); return; }
    const plan = roomPlan(), unitScale = plan[0], parts = [];
    for (let index = 0; index < unitCount; index++) {
      const x = plan[10 + index], last = index === unitCount - 1;
      // The bin and the lamp's floor pool belong to the right-hand end.
      const geometry = createShelfOcclusion({ width:unitWidth, height, depth, scale:unitScale, floorY,
        rows:rows.filter(row => (row.unit ?? 0) === index), floorLight:floorLit && last ? DARK_FLOOR_LIGHT : null,
        footprints:trash && last ? [{ x:trash.position.x - x, z:trash.position.z, radius:trash.userData.radius }] : [] });
      geometry.translate(x, 0, 0); parts.push(geometry);
    }
    occlusion.geometry = parts.length === 1 ? parts[0] : mergeGeometries(parts, false);
    if (parts.length > 1) for (const part of parts) part.dispose();
  }
  function positionTrash() {
    if (trash) {
      // Its local placement is a real object on the floor, independent of the
      // camera, viewport, scroll and the progress of a view transition.
      // Clear the actual room wall with the whole body and hinged-lid sweep,
      // rather than centring a cylinder on the cabinet's rear plane.
      sceneView.trashStand(trash.userData.radius, trashBounds.min.z, trashBounds.min.y, roomWall.position.z, floorY, TRASH_GAP, standOut);
      trash.position.set(standOut[0], standOut[1], standOut[2]);
      trash.rotation.set(0, 0, 0); trash.scale.setScalar(1); trash.visible = true;
    }
    rebuildOcclusion();
  }
  // Lights and environment are final once the lamps' light pool exists. The
  // driver links the room's programs while the cabinet, books and plants are
  // still being built, instead of all of them inside the first render.
  lampLighting.prepare(bookEntries);
  prelinkPrograms(renderer, scene, camera, [trash, roomWall].filter(Boolean));
  rebuildFurniture();
  prelinkPrograms(renderer, scene, camera, furniture.children.filter(child => child !== catalog));

  let disposed = false, raf = 0, renderCount = 0, modelCreations = 0;
  let reorderItems = [];
  let bookPresentationScheduled = false;
  let pageSuspended = false;
  let presentationActive = true, drawPending = true, paintedViewport = null, paintHeld = false;
  // This separate modal gate never changes home/reader presentation ownership.
  let modalDeferredEntry = null, inactiveModalEntry = null, paintedModalView = null;
  const paintedAwayEntries = new Set();
  let shelfSnapshotDirty = true, shelfSnapshotRenders = 0;
  // Every program is linked in parallel before the first frame (see gpu-programs.js).
  let programsReady = null, programsPoll = 0, unpainted = [], catalogPrelinked = false;
  // A plant or lamp added later brings new material variants (and a lamp new
  // lights, which every lit program depends on). Link those in parallel too,
  // keeping the painted room, instead of stalling the frame that adds them.
  let programsStale = false;
  // A scroll only moves the camera: world-space shadows stay valid unless
  // something in the scene changed (or the lighting's fitted window moved).
  let shadowDirty = true, shadowCasters = 0;
  // Prepare this tiny guide with the initial scene, while keeping it hidden.
  // First dragging a book must not synchronously link a new GPU program.
  const dropMarker = new THREE.Group();
  dropMarker.name = 'Shelf placement guide'; dropMarker.userData.dropMarker = true; dropMarker.visible = false;
  const dropMaterial = new THREE.MeshBasicMaterial({ color:'#709980', transparent:true, opacity:.9, depthTest:false, depthWrite:false });
  const dropGuide = new THREE.Mesh(new THREE.BoxGeometry(2, 1, 2), dropMaterial);
  const dropFoot = new THREE.Mesh(new THREE.BoxGeometry(12, 2, 4), dropMaterial); dropFoot.position.y = 1;
  dropMarker.add(dropGuide, dropFoot); furniture.add(dropMarker);
  // Link the return depth variants after the first frame, using the guide's
  // existing geometry; they never add a visible object or render pass.
  const depthWriters = depthOnly.map(material => new THREE.Mesh(dropGuide.geometry, material));
  // Orthographic inspection is a similarity of a stationary room. Keep an
  // overscanned, already lit image for the compositor instead of running all
  // of its shaders, GPU readback and native hit projections for each finger
  // sample. A full fitted backdrop covers anything beyond the detailed tile;
  // paint full quality and restore native surfaces when the gesture settles.
  const inspectionCanvas = document.createElement('canvas');
  const inspectionContext = inspectionCanvas.getContext('2d');
  inspectionCanvas.className = 'ihr-bookshelf-inspection-snapshot';
  inspectionCanvas.setAttribute('aria-hidden', 'true');
  Object.assign(inspectionCanvas.style, { position:'absolute', left:'0', top:'0', display:'none',
    pointerEvents:'none', zIndex:'0', transformOrigin:'0 0', willChange:'transform' });
  stage.append(inspectionCanvas);
  const inspectionCamera = camera.clone();
  const inspectionOverviewCanvas = document.createElement('canvas');
  const inspectionOverviewContext = inspectionOverviewCanvas.getContext('2d');
  inspectionOverviewCanvas.className = 'ihr-bookshelf-inspection-overview';
  inspectionOverviewCanvas.setAttribute('aria-hidden', 'true');
  Object.assign(inspectionOverviewCanvas.style, { position:'absolute', left:'0', top:'0', display:'none', pointerEvents:'none', zIndex:'0',
    transformOrigin:'0 0', willChange:'transform' });
  inspectionCanvas.style.zIndex = '1';
  stage.append(inspectionOverviewCanvas);
  let inspectionSnapshot = null, inspectionSnapshotVisible = false, lastSceneMoving = false;
  let inspectionOverview = null;
  const nativeFrameCache = createNativeFramebufferCache(renderer,{onRestored:()=>{
    invalidate(true,false,'context-restored');flushScene({force:true});
  }});
  const nativeRoomSlot = {}, nativeFineSlots = [{}, {}], nativeComposedRoomSlot = {};
  let nativeFineSlotIndex = 0, nativeFineFrame = null;
  let nativeRoomDisplay = null, nativeBaseFrame = null, nativeBaseMargin = 0;
  const completedLegacyInsertionLeases = new Set();
  let nativeInsertionMetadataOwner = null;
  let nativeInspectionExportFrame = null, nativeOverviewExportFrame = null;
  let nativeInspectionRevision = 0, nativeOverviewRevision = 0;
  let nativeInspectionMaterialized = 0, nativeOverviewMaterialized = 0;
  const nativeSnapshotBindings = [];
  const nativeRoomClip = nativeFrameCache ? document.createElement('div') : null;
  if (nativeRoomClip) {
    nativeRoomClip.className = 'ihr-bookshelf-native-room-clip'; nativeRoomClip.setAttribute('aria-hidden','true');
    Object.assign(nativeRoomClip.style,{position:'absolute',overflow:'hidden',pointerEvents:'none',zIndex:'0',display:'none'});
    stage.append(nativeRoomClip);
  }
  const nativeRoomLease = nativeFrameCache && createNativeRendererPresentation(renderer,{
    canvas,context,
    capture(rawContext) {
      if (!nativeFrameCache.validFrame(nativeBaseFrame)) return;
      try {
        nativeFrameCache.repaint(nativeBaseFrame);
        rawContext.clearRect(0,0,canvas.width,canvas.height);
        if (nativeBaseFrame.physical && !nativeBaseMargin) {
          // Preserve the public ceil-sized export, including the original
          // floor-to-ceil resample, without performing it on displayed frames.
          rawContext.drawImage(renderer.domElement,0,0,canvas.width,canvas.height);
        } else if (nativeBaseFrame.physical) {
          // The original overscan export first scaled the complete GL source
          // to its ceil-sized 2D tile, then cropped that tile into the base.
          const tile=document.createElement('canvas');
          tile.width=Math.ceil(nativeBaseFrame.width*nativeBaseFrame.ratio);tile.height=Math.ceil(nativeBaseFrame.height*nativeBaseFrame.ratio);
          try {
            const tileContext=tile.getContext('2d');
            if(!tileContext)throw new Error('Native room crop export requires a 2D context');
            tileContext.drawImage(renderer.domElement,0,0,tile.width,tile.height);
            rawContext.drawImage(tile,nativeBaseMargin*nativeBaseFrame.ratio,nativeBaseMargin*nativeBaseFrame.ratio,
              canvas.width,canvas.height,0,0,canvas.width,canvas.height);
          } finally { tile.width=tile.height=0; }
        } else {
          rawContext.drawImage(renderer.domElement,nativeBaseMargin*nativeBaseFrame.ratio,nativeBaseMargin*nativeBaseFrame.ratio,
            canvas.width,canvas.height,0,0,canvas.width,canvas.height);
        }
      } finally { if (nativeRoomLease.isOwner()) repaintNativeRoom(); }
    },
    repaint:repaintNativeRoom,
    position:positionNativeRoom
  });
  function bindNativeSnapshot(output,capture) {
    const getContext=output.getContext,toDataURL=output.toDataURL,toBlob=output.toBlob;
    const unbind=registerCanvasSnapshot(output,capture);
    output.getContext=function(kind,...args) { if(kind==='2d')capture();return getContext.call(this,kind,...args); };
    output.toDataURL=function(...args) { capture();return toDataURL.apply(this,args); };
    output.toBlob=function(...args) { capture();return toBlob.apply(this,args); };
    nativeSnapshotBindings.push(()=>{unbind();output.getContext=getContext;output.toDataURL=toDataURL;output.toBlob=toBlob;});
  }
  function captureNativeInspection(overview=false, captured=null) {
    const frame=overview?nativeOverviewExportFrame:nativeInspectionExportFrame,raw=overview?inspectionOverviewContext:inspectionContext;
    const revision=overview?nativeOverviewRevision:nativeInspectionRevision;
    if (!nativeFrameCache?.validFrame(frame) || !raw || revision===(overview?nativeOverviewMaterialized:nativeInspectionMaterialized)) return null;
    // Only the immediately preceding new capture in this synchronous CSS
    // batch is reusable. Public 2D exports may have been edited by consumers,
    // so their retained canvases never supply a later independent export.
    const sourceFrame=captured?.overview?nativeOverviewExportFrame:nativeInspectionExportFrame;
    const sourceContext=captured?.overview?inspectionOverviewContext:inspectionContext;
    const sourceRevision=captured?.overview?nativeOverviewRevision:nativeInspectionRevision;
    const sourceMaterialized=captured?.overview?nativeOverviewMaterialized:nativeInspectionMaterialized;
    const shared=captured && captured.overview!==overview && captured.frame===frame && sourceFrame===frame &&
      captured.context===sourceContext && sourceContext!==raw && captured.revision===sourceRevision &&
      sourceMaterialized===sourceRevision && captured.width===Math.ceil(frame.width*frame.ratio) && captured.height===Math.ceil(frame.height*frame.ratio) &&
      raw.canvas.width===captured.width && raw.canvas.height===captured.height &&
      sourceContext.canvas.width===captured.width && sourceContext.canvas.height===captured.height;
    if (shared) {
      raw.clearRect(0,0,raw.canvas.width,raw.canvas.height);
      raw.drawImage(sourceContext.canvas,0,0);
    } else {
      withRendererPresentation(renderer,nativeRoomLease,()=>{
        try {
          nativeFrameCache.repaint(frame);
          raw.clearRect(0,0,raw.canvas.width,raw.canvas.height);
          raw.drawImage(renderer.domElement,0,0,raw.canvas.width,raw.canvas.height);
        } finally { if(nativeRoomLease.isOwner())repaintNativeRoom(); }
      });
    }
    if(overview)nativeOverviewMaterialized=revision;else nativeInspectionMaterialized=revision;
    return {overview,frame,context:raw,revision,width:raw.canvas.width,height:raw.canvas.height};
  }
  if (nativeRoomLease) {
    bindNativeSnapshot(canvas,()=>nativeRoomLease.capture());
    bindNativeSnapshot(inspectionCanvas,()=>captureNativeInspection());
    bindNativeSnapshot(inspectionOverviewCanvas,()=>captureNativeInspection(true));
  }
  function releaseUnusedNativeRoomFrames() {
    if(!nativeFrameCache?.releaseUnusedSlots)return;
    // Identity, not descriptor equality: fine and overview may share one
    // texture while exports or the current presenter still need its pixels.
    nativeFrameCache.releaseUnusedSlots([nativeRoomSlot,...nativeFineSlots,nativeComposedRoomSlot],[
      nativeBaseFrame,nativeRoomDisplay?.frame,inspectionSnapshot?.nativeFrame,
      inspectionOverview?.nativeFrame,nativeInspectionExportFrame,nativeOverviewExportFrame
    ]);
    if(!nativeFrameCache.validFrame(nativeFineFrame))nativeFineFrame=null;
  }

  function repaintNativeRoom() {
    if(!nativeRoomDisplay)return false;
    const {frame,margin}=nativeRoomDisplay;
    // The whole frame, overscan included, is presented and clipped in CSS:
    // composing only the visible room resized the shared canvas twice per
    // paint (to the visible size, then back to the overscan size for the next
    // render), which reallocated its GPU buffer and cost 60-170 ms a paint.
    if(!margin || frame.physical || wholeFrameAligned(frame,margin))return nativeFrameCache.repaint(frame);
    // A margin that falls between device pixels keeps the exact composition.
    const output={x:0,y:0,width:frame.width-margin*2,height:frame.height-margin*2,ratio:frame.ratio};
    return nativeFrameCache.compose(output,[{frame,x:-margin,y:-margin,scale:1,
      clip:{left:0,top:0,right:output.width,bottom:output.height}}]);
  }
  const wholeFrameAligned=(frame,margin)=>Number.isInteger(Math.round(margin*frame.ratio*1e6)/1e6);
  function positionNativeRoom(node) {
    if(!nativeRoomDisplay || !frameLayout.canvas || !frameLayout.stage)return false;
    const logical=frameLayout.canvas,bounds=frameLayout.stage,margin=nativeRoomDisplay.margin;
    const frame=nativeRoomDisplay.frame;
    if(frame.physical && !nativeFrameCache.validFrame(frame))return false;
    if(![logical.left,logical.top].every(value=>Number.isFinite(value) && (frame.physical || Number.isInteger(value*frame.ratio))))return false;
    Object.assign(nativeRoomClip.style,{left:`${logical.left-bounds.left}px`,top:`${logical.top-bounds.top}px`,
      width:`${sceneWidth}px`,height:`${sceneView.viewportHeight}px`,display:'block'});
    // This same canvas has become the room, so book-only diagnostics no
    // longer describe its actual output or its semantic owner.
    if (nativeInsertionMetadataOwner) {
      delete node.dataset.insertionDepth; delete node.dataset.returnProgress;
      nativeInsertionMetadataOwner = null;
    }
    node.className='ihr-bookshelf-native-room-canvas';node.setAttribute('aria-hidden','true');
    // A fractional room retains the original complete framebuffer. Clip its
    // overscan in CSS instead of introducing a second texture resample.
    node.style.cssText=frame.physical || margin && wholeFrameAligned(frame,margin)?
      `position:absolute;pointer-events:none;left:${-margin}px;top:${-margin}px;width:${frame.width}px;height:${frame.height}px`:
      `position:absolute;pointer-events:none;left:0px;top:0px;width:${frame.width-margin*2}px;height:${frame.height-margin*2}px`;
    if(node.parentNode!==nativeRoomClip)nativeRoomClip.append(node);
    return true;
  }
  function physicalRoomFrame(width,height,ratio) {
    const frame={x:0,y:0,width,height,ratio,physical:true,pixelWidth:Math.floor(width*ratio),pixelHeight:Math.floor(height*ratio)};
    return nativeFrameCache?.exactFrame?.(frame)===true?frame:null;
  }
  function getNativeRoomBackground() {
    if(!nativeRoomDisplay || !nativeFrameCache.validFrame(nativeRoomDisplay.frame) || !nativeRoomLease || !frameLayout.canvas || !frameLayout.scroller)return null;
    const logical=frameLayout.canvas,scrollerClip=frameLayout.scroller,margin=nativeRoomDisplay.margin;
    const clip={left:Math.max(0,logical.left,scrollerClip.left),top:Math.max(0,logical.top,scrollerClip.top),
      right:Math.min(window.innerWidth,logical.right,scrollerClip.right),bottom:Math.min(window.innerHeight,logical.bottom,scrollerClip.bottom)};
    return {lease:nativeRoomLease,frame:nativeRoomDisplay.frame,x:logical.left-margin,y:logical.top-margin,scale:1,clip,
      nodeRect:nativeRoomLease.isOwner()?renderer.domElement.getBoundingClientRect():null};
  }
  function getInsertionRoomBackground() {
    const background=getNativeRoomBackground();
    if(background)return background;
    // Unsupported room pixel bounds keep the original, already painted 2D
    // room visible. Only the transparent moving book needs a native lease.
    if(nativeRoomDisplay || !nativeFrameCache || !shelfSnapshotRenders || !canvas.isConnected ||
      canvas.style.opacity==='0' || canvas.style.visibility==='hidden' || inspectionSnapshotVisible)return null;
    const descriptor={x:0,y:0,width:window.innerWidth,height:window.innerHeight,ratio:Math.min(window.devicePixelRatio||1,2)};
    return (nativeFrameCache.exactFrame?.(descriptor) ?? true)?{mode:'legacy'}:null;
  }
  function releaseCompletedLegacyInsertions() {
    for(const lease of completedLegacyInsertionLeases)lease.release({snapshot:false});
    completedLegacyInsertionLeases.clear();
  }
  function restoreNativeRoom() {
    if(!nativeRoomDisplay || !nativeRoomLease)return false;
    return withRendererPresentation(renderer,nativeRoomLease,()=>{
      if(!repaintNativeRoom())return false;
      const owner=currentNativeRendererPresentation(renderer);
      return owner===nativeRoomLease?nativeRoomLease.present():owner?owner.transferTo(nativeRoomLease):nativeRoomLease.present();
    });
  }
  let inspectionQualityDirty = false;
  const inspectionEntryUpdates = new Map();
  let inspectionDirtyCount = 0;
  let compositorFrames = 0;
  let trashWritten = null, catalogWritten = null;
  const trashBox = new THREE.Box3(), footPoint = new THREE.Vector3(), floorPoint = new THREE.Vector3();
  const trashOriginalStates = new Map();
  function rememberTrashNode(node) {
    if (node && !trashOriginalStates.has(node)) trashOriginalStates.set(node, {
      style:node.getAttribute('style'), hidden:node.hidden, tabIndex:node.getAttribute('tabindex'),
      ariaHidden:node.getAttribute('aria-hidden'), inert:Boolean(node.inert || node.hasAttribute('inert'))
    });
  }
  function restoreTrashNode(node) {
    const original = trashOriginalStates.get(node);
    if (!original) return;
    if (trashWritten?.node === node) trashWritten = null;
    for (const [attribute, value] of [['style', original.style], ['tabindex', original.tabIndex], ['aria-hidden', original.ariaHidden]]) {
      if (value === null) node.removeAttribute(attribute); else node.setAttribute(attribute, value);
    }
    node.hidden = original.hidden; node.inert = original.inert;
    for (const key of ['trash3d', 'trashHover', 'hover', 'trashDropProgress', 'dropProgress', 'trashVisible', 'trashViewHidden',
      'trashLocalPosition', 'trashLocalScale', 'trashLocalRotation', 'trashFootY', 'cabinetFloorY', 'trashCameraInFrame',
      'trashFootWorld', 'floorContactWorld', 'trashRadius', 'trashHeight'])
      delete node.dataset[key];
  }
  rememberTrashNode(trashNode);
  const catalogOriginalStates = new Map();
  function rememberCatalogNode(node) {
    if (node && !catalogOriginalStates.has(node)) catalogOriginalStates.set(node, {
      style:node.getAttribute('style'), hidden:node.hidden, tabIndex:node.getAttribute('tabindex'), ariaHidden:node.getAttribute('aria-hidden')
    });
  }
  function restoreCatalogNode(node) {
    const original = catalogOriginalStates.get(node);
    if (!original) return;
    if (catalogWritten?.node === node) catalogWritten = null;
    for (const [attribute, value] of [['style', original.style], ['tabindex', original.tabIndex], ['aria-hidden', original.ariaHidden]]) {
      if (value === null) node.removeAttribute(attribute); else node.setAttribute(attribute, value);
    }
    node.hidden = original.hidden;
    delete node.dataset.catalog3d; delete node.dataset.catalogVisible; delete node.dataset.catalogViewHidden;
  }
  rememberCatalogNode(catalogNode);
  const vector = new THREE.Vector3(), inverseRotation = new THREE.Quaternion();
  const shadowBounds = new THREE.Box3(), shadowOut = new Float64Array(6), casterIds = [], captureOut = new Float64Array(4), countOut = new Float64Array(8);
  const projectedMatrix = new THREE.Matrix4();
  const rendererSize = new THREE.Vector2();
  const frameLayout = { canvas:null, stage:null, scroller:null };
  const framedScratch = new THREE.Box3(), framedTrash = new THREE.Box3(), transformRects = { unscaled:{}, framed:{}, bounds:{}, world:{} };
  const canvasWritten = { width:NaN, height:NaN };
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  // The eight corners of a box under a matrix are projected in Rust. Pass `out` to refresh a retained
  // rectangle in place instead of allocating one.
  const cornerBox = new Float64Array(6), cornerRect = new Float64Array(7);
  const corners = (box, transform, out = {}) => {
    if (box.isBox3) {
      const { min, max } = box;
      cornerBox[0] = min.x; cornerBox[1] = min.y; cornerBox[2] = min.z; cornerBox[3] = max.x; cornerBox[4] = max.y; cornerBox[5] = max.z;
      box = cornerBox;
    }
    rust.scene_corners(box, transform.elements, cornerRect);
    out.left = cornerRect[0]; out.right = cornerRect[1]; out.top = cornerRect[2]; out.bottom = cornerRect[3];
    out.width = cornerRect[4]; out.height = cornerRect[5]; out.closest = cornerRect[6];
    return out;
  };
  // The slot's box and the stand-in hit box of a culled model come from Rust, once per change of size.
  const boxScratch = new Float64Array(12);
  function placeBoxes(entry) {
    rust.scene_entry_boxes(entry.kind === 'plant' ? 1 : entry.kind === 'lamp' ? 2 : 0, entry.mount === 'undershelf',
      entry.width, entry.height, entry.thickness, entry.depth, boxScratch);
    entry.box = boxScratch.slice(0, 6); entry.fallback = boxScratch.slice(6, 12);
  }
  for (const entry of bookEntries) placeBoxes(entry);
  // The semantic button's centre lies on one solid mesh of its model. Look that
  // mesh up by name once per model rather than walking the tree every frame.
  function hitSurface(entry, name) {
    const model = entry.model;
    if (!model) return undefined;
    // Cached on the model itself, so a released model is never kept alive by its entry.
    const cached = model.userData.hitSurface;
    if (cached?.parent && cached.name === name) return cached;
    return model.userData.hitSurface = model.getObjectByName(name);
  }
  // The stand-in hit box of a culled model only changes with its slot box.
  const fallbackBox = (entry, lamp) => lamp ? entry.box : entry.fallback;
  const insertedIds = [], exclusionRects = [], countIo = [];
  let exclusionsReady = false;

  function materialKeys(entry) {
    const { book, style, coverUrl } = entry;
    return {
      spine:JSON.stringify([style, book.spineTitleOverride, book.title, book.author, book.spineFontSize,
        book.spineAuthorFontSize, book.spineFinish, book.spineSurfaceFinish, book.spineTextFinish, book.spineTextColor, book.spineEngraved]),
      cover:JSON.stringify([coverUrl, style.coverRatio, style.color, !coverUrl && [book.spineTitleOverride, book.title, book.author, book.format, style.fontFamily]]),
      coverFinish:book.coverFinish,
      coverRelief:JSON.stringify(book.coverRelief ?? null),
      edgeFinish:book.pageEdgeFinish,
      bookmark:JSON.stringify(bookmarkFor(book))
    };
  }

  const plantKeys = entry => JSON.stringify([entry.width, entry.height, entry.variant, entry.catalogId, entry.potId, entry.potColorId, entry.seed]);
  const plantShapeKeys = entry => JSON.stringify([entry.width, entry.height, entry.variant, entry.catalogId, entry.potId, entry.seed]);
  const lampKeys = entry => JSON.stringify([entry.lampId, entry.width, entry.height, entry.depth, entry.mount]);

  // A selected book's slot is already painted empty. Its decoded lettering,
  // jacket and final ribbon can change while reading without changing that
  // image or its shadow casters. The live class matters: flags may still
  // describe the previous frame when a returning book is restored.
  const hiddenBookMaterial = entry => entry.kind !== 'plant' && entry.kind !== 'lamp' &&
    !entry.insertion && !entry.trashDrop && Boolean(entry.node?.classList.contains('is-away'));
  const invalidateBookMaterial = entry => {
    if (!hiddenBookMaterial(entry)) settledInvalidate(true, 'quality', entry);
  };

  // Start-up: the room paints as soon as it is built. The covers and web fonts
  // that arrive just after that first frame are committed together in one
  // more frame, instead of one full render per arrival (they came in three or
  // four batches). The final pixels are the same; only the renders between go.
  // A gesture, or the time limit, paints at once.
  const STARTUP_SETTLE_MS = 2500;
  let startupSettle = { until:0, timer:0, held:false };
  // Other books still decoding their first cover (the caller has just settled).
  const coversPending = caller => bookEntries.some(entry => entry !== caller && entry.kind !== 'plant' && entry.kind !== 'lamp' &&
    entry.model?.visible && entry.model.userData.coverLoaded === undefined);
  const fontsPending = () => document.fonts?.status === 'loading';
  function settledInvalidate(preserveInspectionOverview, source, caller = null) {
    const gate = startupSettle;
    if (!gate || !shelfSnapshotRenders || sceneView.moving || sceneView.turning || disposed) {
      invalidate(true, preserveInspectionOverview, source);
      return;
    }
    // Only the first batch after the first frame. The wait is counted from
    // its first arrival: a slow device can take seconds to decode a cover.
    gate.until ||= performance.now() + STARTUP_SETTLE_MS;
    if (performance.now() >= gate.until || !(coversPending(caller) || fontsPending())) {
      releaseStartupSettle();
      invalidate(true, preserveInspectionOverview, source);
      return;
    }
    // Same bookkeeping as invalidate(true), without asking for a frame yet.
    noteInspectionDirty(source);
    shelfSnapshotDirty = shadowDirty = true;
    if (!preserveInspectionOverview) inspectionOverview = null;
    drawPending = gate.held = true;
    gate.timer ||= setTimeout(() => { if (startupSettle) startupSettle.timer = 0; releaseStartupSettle(); }, gate.until - performance.now());
  }
  function releaseStartupSettle() {
    const gate = startupSettle;
    if (!gate) return;
    startupSettle = null; clearTimeout(gate.timer);
    if (gate.held && drawPending) invalidate(false);
  }

  function refreshBookFonts() {
    if (disposed) return;
    // Loading a font changes canvas pixels without changing material keys.
    // Repaint the retained models, including a quality replacement awaiting
    // its cover, without replacing the projected buttons or the room layout.
    for (const entry of bookEntries) {
      if (entry.kind === 'plant' || entry.kind === 'lamp') continue;
      for (const model of new Set([entry.model, entry.replacement])) {
        if (!model) continue;
        const redraw = model.userData.invalidate;
        model.userData.invalidate = null;
        try {
          model.userData.updateSpineAppearance?.(entry.book, entry.style);
          // Printed cover images have no generated lettering to refresh.
          if (!entry.coverUrl) model.userData.updateCoverSource?.(null, entry.book, entry.style);
        } finally { model.userData.invalidate = redraw; }
      }
    }
    settledInvalidate(false, 'fonts-ready');
  }

  function makeModel(entry) {
    const model = entry.kind === 'plant' ? createShelfPlant(entry, { persist:true })
      : entry.kind === 'lamp' ? createShelfLamp({ lampId:entry.lampId, width:entry.width, height:entry.height, quality:'high', isOn:entry.isOn !== false, persist:true, kelvin:entry.kelvin })
      : createBookModel(entry.book, entry.style, entry.width, entry.height, entry.thickness, entry.coverUrl, { shelf:true, overview:entry.overview, inspectionResolution:entry.inspectionResolution });
    // Texture/font decode notifications improve the same artwork. Explicit
    // record/material changes separately invalidate the retained room below.
    model.userData.invalidate = () => rust.scene_quality_invalidate(entry,model,qualityHost);
    model.traverse(object => {
      for (const material of Array.isArray(object.material) ? object.material : object.material ? [object.material] : [])
        for (const key of ['map','normalMap','bumpMap','roughnessMap'])
          if (material[key]) material[key].anisotropy = Math.min(16,renderer.capabilities.getMaxAnisotropy());
    });
    model.userData.entry = entry;
    model.traverse(object => {
      if (object.isMesh) {
        // Fixtures own their shadow flags: clear glass, opal diffusers and
        // glowing bulb envelopes transmit the source placed inside them.
        // Making the shaded LED opaque here would extinguish its entire cone.
        if (entry.kind !== 'lamp') object.castShadow = true;
        object.receiveShadow = true;
      }
    });
    if (entry.kind === 'lamp') { model.userData.shelfLampKeys = lampKeys(entry); model.userData.shownTint = lampTint(entry.kelvin).join(); }
    else if (entry.kind !== 'plant') model.userData.shelfKeys = materialKeys(entry);
    else {
      model.userData.shelfPlantKeys = plantKeys(entry);
      if (entry.node) {
        const leaf = model.getObjectByName('leaf-0'), size = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3());
        model.userData.shelfPlantDiagnostics = { plantModelCatalogId:model.userData.catalogId,
          plantModelDepth:size.z.toFixed(4),
          plantLeafTexture:leaf ? leaf.material.map?.isDataTexture ? 'procedural' : leaf.material.map ? 'photo' : 'none' : 'vertex-colors',
          plantLeafOpacity:!leaf || leaf.material.alphaTest === 0 && !leaf.material.alphaToCoverage ? 'opaque' : 'cutout' };
        Object.assign(entry.node.dataset, model.userData.shelfPlantDiagnostics);
      }
    }
    canvas.dataset.modelCreations = String(++modelCreations);
    return model;
  }

  function releaseCandidate(model) {
    if (!model || releasedCandidates.has(model)) return;
    releasedCandidates.add(model); model.userData.dispose?.();
  }

  function cancelReplacement(entry) {
    entry.plantQuality?.plan.dispose(); entry.plantQuality = null;
    releaseCandidate(entry.replacement);
    entry.replacement = null;
    entry.qualityReplacement = false; entry.replacementReady = false;
  }

  function releaseEntry(entry) {
    cancelInsertion(entry);
    cancelTrashDrop(entry, false);
    cancelReplacement(entry);
    if (entry.model) { entry.model.removeFromParent(); entry.model.userData.dispose?.(); entry.model = null; }
    semanticFoliage.get(entry.node)?.svg.remove(); semanticFoliage.delete(entry.node);
    clearPlantDiagnostics(entry.node);
  }

  function cancelTrashDrop(entry, restore = true) {
    const drop = entry.trashDrop;
    if (!drop) return;
    inspectionOverview = null;
    entry.trashDrop = null;
    if (!drop.settled) { drop.settled = true; drop.resolve(false); }
    if (entry.model && restore) {
      furniture.attach(entry.model);
      entry.model.visible = !entry.node?.classList.contains('is-away');
      entry.model.position.copy(entry.pose.position);
      entry.model.quaternion.copy(entry.pose.quaternion);
      entry.model.scale.copy(entry.pose.scale);
    }
    if (trashNode) {
      delete trashNode.dataset.trashDropProgress;
      delete trashNode.dataset.dropProgress;
    }
    delete canvas.dataset.trashDropProgress;
    delete canvas.dataset.trashingBookId;
    delete canvas.dataset.trashingObjectId;
    delete canvas.dataset.trashingObjectKind;
  }

  // The bin's diagnostics are mirrored on its semantic node and on the canvas.
  const trashData = (key, value) => { setData(trashNode, key, value); setData(canvas, key, value); };

  const dropStep = new Float64Array(5), overflow = new Float64Array(2), trashPacked = new Float64Array(6), trashOut = new Float64Array(6);
  const scrollerClip = new Float64Array(4), trashRect0 = {};
  function updateTrash(scroll, now, finishedDrops) {
    if (!trash || !trashNode) {
      for (const key of ['trash3d', 'trashHover', 'trashVisible', 'trashViewHidden', 'trashLocalPosition', 'trashLocalScale',
        'trashLocalRotation', 'trashFootY', 'cabinetFloorY', 'trashCameraInFrame', 'trashFootWorld', 'floorContactWorld'])
        delete canvas.dataset[key];
      return false;
    }
    const scrollerBounds = frameLayout.scroller;
    const visualBottom = window.visualViewport
      ? window.visualViewport.offsetTop + window.visualViewport.height : window.innerHeight;
    const viewHidden = sceneView.trashViewHidden();
    if (viewHidden) {
      sceneView.trashReset();
      if (trashNode.classList.contains('is-over')) trashNode.classList.remove('is-over');
    }
    let dropEntry = null;
    for (const entry of bookEntries) if (entry.trashDrop) { dropEntry = entry; break; }
    const drop = dropEntry?.trashDrop;
    let moving = sceneView.trashStep(now, reducedMotion.matches);
    let openness = sceneView.trashOpenness, bounce = 0;
    if (drop) {
      rust.scene_trash_drop(drop.elapsed, drop.lastFrame, drop.complete, drop.duration, drop.initialOpenness, now, dropStep);
      drop.elapsed = dropStep[0]; drop.lastFrame = dropStep[1];
      const t = dropStep[2];
      openness = dropStep[3]; bounce = dropStep[4];
      trash.userData.setState({ openness, bounce });
      trash.updateMatrixWorld(true);
      if (dropEntry.model && !drop.complete) {
        const worldScale = trash.getWorldScale(new THREE.Vector3()).x;
        const endScale = rust.scene_trash_end_scale(worldScale, trash.userData.radius, dropEntry.width, dropEntry.height);
        const motion = sampleTrashDrop(drop.start, trash.userData.getMouth(), t,
          { height:dropEntry.height, scale:drop.startScale, endScale });
        dropEntry.model.position.copy(motion.position);
        dropEntry.model.scale.setScalar(motion.scale);
        trash.getWorldQuaternion(drop.endQuaternion).multiply(drop.bookQuaternion);
        dropEntry.model.quaternion.copy(drop.startQuaternion).slerp(drop.endQuaternion, motion.turn);
        dropEntry.model.updateMatrixWorld(true);
        const flightBounds = corners(dropEntry.box, dropEntry.model.matrixWorld);
        rust.scene_trash_overflow(flightBounds.right, sceneWidth, t, overflow);
        // The pointer may leave a broad book partly outside the canvas at
        // release. Bend its first few frames inward instead of snapping its
        // starting pose or clipping the newly exposed cover for the flight.
        if (overflow[0]) {
          dropEntry.model.position.x -= overflow[1];
          dropEntry.model.updateMatrixWorld(true);
        }
      }
      const value = t.toFixed(4);
      setData(trashNode, 'trashDropProgress', value); setData(trashNode, 'dropProgress', value);
      setData(canvas, 'trashDropProgress', value);
      setData(canvas, 'trashingBookId', String(dropEntry.book?.id ?? ''));
      setData(canvas, 'trashingObjectId', String(dropEntry.node?.dataset.objectId ?? dropEntry.key));
      setData(canvas, 'trashingObjectKind', dropEntry.kind === 'plant' || dropEntry.kind === 'lamp' ? dropEntry.kind : 'book');
      moving ||= t < 1;
      if (t === 1 && !drop.complete) {
        drop.complete = true;
        sceneView.trashFinishDrop();
        dropEntry.model.visible = false;
        finishedDrops.push(() => { if (!drop.settled) { drop.settled = true; drop.resolve(true); } });
      }
    } else {
      trash.userData.setState({ openness });
      trash.updateMatrixWorld(true);
    }
    const trashRect = corners(trashBox.setFromObject(trash), IDENTITY, trashRect0);
    trashPacked[0] = trashRect.left; trashPacked[1] = trashRect.right; trashPacked[2] = trashRect.top; trashPacked[3] = trashRect.bottom;
    trashPacked[4] = trashRect.width; trashPacked[5] = trashRect.height;
    const stageBounds = frameLayout.stage;
    scrollerClip[0] = scrollerBounds.left; scrollerClip[1] = scrollerBounds.top; scrollerClip[2] = scrollerBounds.right; scrollerClip[3] = scrollerBounds.bottom;
    sceneView.trashFrame(trashPacked, scroll, stageBounds.left, stageBounds.top, scrollerClip, window.innerWidth, window.innerHeight, visualBottom, trashOut);
    const visible = trashOut[0] === 1, inFrame = trashOut[1] === 1;
    if (trashNode.hidden !== !visible) trashNode.hidden = !visible;
    if (trashNode.inert !== !visible) trashNode.inert = !visible;
    const tabIndex = String(visible ? 0 : -1), ariaHidden = String(!visible);
    if (trashNode.getAttribute('tabindex') !== tabIndex) trashNode.tabIndex = visible ? 0 : -1;
    if (trashNode.getAttribute('aria-hidden') !== ariaHidden) trashNode.setAttribute('aria-hidden', ariaHidden);
    const hitLeft = trashOut[2], hitTop = trashOut[3], hitWidth = trashOut[4], hitHeight = trashOut[5];
    const written = trashWritten?.node === trashNode ? trashWritten : (trashWritten = hitStyleCache(trashNode)), style = trashNode.style;
    if (!written.fixed) style.position = 'absolute';
    if (hitLeft !== written.left) style.left = `${written.left = hitLeft}px`;
    if (hitTop !== written.top) style.top = `${written.top = hitTop}px`;
    if (hitWidth !== written.width) style.width = `${written.width = hitWidth}px`;
    if (hitHeight !== written.height) style.height = `${written.height = hitHeight}px`;
    if (!written.fixed) { style.margin = '0'; style.zIndex = '50'; written.fixed = true; }
    // setMode also writes pointer-events on this node, so compare the live value.
    const events = visible ? 'auto' : 'none';
    if (style.pointerEvents !== events) style.pointerEvents = events;
    const hover = String(sceneView.trashHover);
    setData(trashNode, 'trash3d', 'true');
    setData(trashNode, 'trashVisible', String(visible)); setData(trashNode, 'trashViewHidden', String(viewHidden));
    setData(trashNode, 'trashHover', hover); setData(trashNode, 'hover', hover);
    setData(canvas, 'trash3d', 'true'); setData(canvas, 'trashHover', hover);
    setData(canvas, 'trashVisible', String(visible)); setData(canvas, 'trashViewHidden', String(viewHidden));
    const footY = trash.position.y + trashBounds.min.y * trash.scale.y;
    const footWorld = furniture.localToWorld(footPoint.set(trash.position.x, footY, trash.position.z));
    const floorContact = furniture.localToWorld(floorPoint.set(trash.position.x, floorY, trash.position.z));
    const { position, rotation } = trash;
    const texts = rust.scene_trash_texts([position.x, position.y, position.z], trash.scale.x, [rotation.x, rotation.y, rotation.z], footY, floorY,
      [footWorld.x, footWorld.y, footWorld.z], [floorContact.x, floorContact.y, floorContact.z], trash.userData.radius, trash.userData.height);
    trashData('trashLocalPosition', texts[0]);
    trashData('trashLocalScale', texts[1]); trashData('trashLocalRotation', texts[2]);
    trashData('trashFootY', texts[3]); trashData('cabinetFloorY', texts[4]);
    trashData('trashCameraInFrame', String(inFrame));
    trashData('trashFootWorld', texts[5]);
    trashData('floorContactWorld', texts[6]);
    trashData('trashRadius', texts[7]); trashData('trashHeight', texts[8]);
    return moving;
  }

  function hitTrash(clientX, clientY) {
    if (!trash || !trashNode || disposed) return false;
    if (inspectionSnapshotVisible) { cancelAnimationFrame(raf); raf = 0; draw(); }
    if (!sceneView.isometric || trashNode.hidden || !trash.visible) return false;
    const rect = trashNode.getBoundingClientRect();
    return clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom;
  }

  function cancelInsertion(entry) {
    const insertion = entry.insertion;
    if (insertion) inspectionOverview = null;
    entry.insertion = null;
    completedLegacyInsertionLeases.delete(insertion?.nativeLease);
    insertion?.nativePresentation?.cancel();
    insertion?.resolve();
  }

  function replacementTarget(entry) {
    return {
      geometry:JSON.stringify([entry.kind || 'book',entry.width,entry.height,entry.thickness,
        Boolean(entry.overview),entry.inspectionResolution || 0]),
      materials:materialKeys(entry)
    };
  }

  function retainPendingReplacement(entry, target) {
    const replacement = entry.replacement, previous = replacement?.userData.shelfReplacementTarget;
    if (entry.kind === 'plant' || entry.kind === 'lamp' || !replacement || entry.qualityReplacement ||
      !previous || previous.geometry !== target.geometry) return false;
    const changed = Object.keys(target.materials).filter(key => previous.materials[key] !== target.materials[key]);
    // The ribbon exposes an explicit in-place update. Every other material,
    // cover and physical/quality change must prepare its own exact model.
    if (changed.some(key => key !== 'bookmark') || changed.length && !replacement.userData.updateBookmark) return false;
    if (changed.length) replacement.userData.updateBookmark(entry.book);
    replacement.userData.shelfReplacementTarget = target;
    replacement.userData.shelfKeys = target.materials;
    return true;
  }

  function replaceWhenReady(entry) {
    const target = replacementTarget(entry);
    if (retainPendingReplacement(entry, target)) return;
    cancelReplacement(entry);
    const previous = entry.model, replacement = makeModel(entry);
    replacement.userData.shelfReplacementTarget = target;
    entry.replacement = replacement;
    const commit = loaded => {
      if (disposed || entry.replacement !== replacement || entry.model !== previous) {
        releaseCandidate(replacement); return;
      }
      entry.replacement = null;
      if (loaded === false && previous && entry.coverUrl) {
        // A transient image failure must not replace a visible real cover
        // with a generated placeholder on the user's existing book.
        releaseCandidate(replacement); updateMaterials(entry); invalidate(); return;
      }
      entry.model = replacement;
      // The pending model may have survived newer records. Reconcile the
      // latest material keys before its first paint, including the ribbon.
      updateMaterials(entry);
      furniture.add(replacement);
      if (previous) { furniture.remove(previous); previous.userData.dispose?.(); }
      invalidate();
    };
    // A fresh model with a decoded cover has already installed its fitted
    // texture and grain. Commit it before updateLayout paints: waiting for
    // an already resolved Promise would shade the obsolete shape once more.
    // Relief keeps its independent bake and later invalidation in either path.
    if (replacement.userData.coverLoaded === true) commit(true);
    else Promise.resolve(replacement.userData.ready).then(commit, () => {
      if (entry.replacement === replacement) {
        entry.replacement = null;
        releaseCandidate(replacement);
        updateMaterials(entry);
        invalidate();
      } else releaseCandidate(replacement);
    });
  }

  const qualityPaintState = { deadline:0, paintDeadline:0 };
  let qualityPaintTimer = 0, qualityHoldTimer = 0;
  function qualityReady() {
    if (disposed) return;
    if (!batchQuality) { invalidate(true,true); return; }
    clearTimeout(qualityPaintTimer); qualityPaintTimer = 0;
    const delay = rust.scene_quality_delay(bookEntries,qualityPaintState,sceneView.moving,performance.now());
    if (delay > 0) qualityPaintTimer = setTimeout(qualityReady,delay);
    else invalidate(true,true);
  }
  const qualityHost = { makeModel,cancelReplacement,releaseCandidate,furniture,notify:qualityReady,batchQuality,invalidateCurrent:invalidateBookMaterial,
    programsChanged() { if (batchQuality) programsStale = true; },
    get disposed() { return disposed; },
    watch(ready,entry,pending,previous,plant) {
      Promise.resolve(ready).then(
        loaded => rust.scene_quality_complete(entry,qualityHost,pending,previous,plant,loaded,false),
        () => rust.scene_quality_complete(entry,qualityHost,pending,previous,plant,undefined,true));
    }
  };

  function updateMaterials(entry) {
    const model = entry.model;
    if (!model || entry.kind === 'plant' || entry.kind === 'lamp') return;
    const previous = model.userData.shelfKeys || {}, next = materialKeys(entry);
    if (previous.spine !== next.spine) model.userData.updateSpineAppearance?.(entry.book, entry.style);
    if (previous.cover !== next.cover) model.userData.updateCoverSource?.(entry.coverUrl, entry.book, entry.style);
    if (previous.coverFinish !== next.coverFinish || previous.coverRelief !== next.coverRelief) model.userData.updateCoverAppearance?.(entry.book);
    if (previous.edgeFinish !== next.edgeFinish) model.userData.updateEdgeAppearance?.(entry.book);
    if (previous.bookmark !== next.bookmark) {
      if (model.userData.updateBookmark) model.userData.updateBookmark(entry.book);
      else { replaceWhenReady(entry); return; }
    }
    model.userData.shelfKeys = next;
  }

  const recordIo = new Float64Array(20);
  function updateRecord(entry, book, style, coverUrl, dimensions = null) {
    const previousKeys = entry.model?.userData.shelfKeys || materialKeys(entry);
    const oldDimensions = [entry.width, entry.height, entry.thickness];
    const oldPosition = [entry.x, entry.y, entry.depthInset, entry.shelf];
    // The record's size follows its style, fitted to its shelf unless the layout dictated it (Rust).
    const row = rows[entry.shelf];
    recordIo.set([entry.y, entry.height, entry.width, entry.thickness, entry.style.heightRatio, style.heightRatio, style.coverRatio, style.width,
      dimensions ? 1 : 0, row ? 1 : 0, row?.top, row?.bottom, SHELF_SPECS[shelfType].usableDepth, unitWidth / BAGGEBO_SPEC.width]);
    rust.scene_record_dimensions(recordIo);
    [entry.y, entry.height, entry.width, entry.thickness] = recordIo.subarray(14, 18);
    if (dimensions) for (const field of ['width', 'height', 'thickness', 'x', 'y', 'depthInset', 'shelf']) if (dimensions[field] !== undefined) entry[field] = dimensions[field];
    entry.book = book; entry.style = style; entry.coverUrl = coverUrl;
    placeBoxes(entry);
    fitDepth(entry.width + 12);
    if (entry.model) {
      const changedShape = oldDimensions.some((value, i) => Math.abs(value - [entry.width, entry.height, entry.thickness][i]) > .01);
      if (changedShape || entry.replacement) replaceWhenReady(entry);
      else updateMaterials(entry);
    }
    const nextKeys = materialKeys(entry);
    // Saving metadata or completing an equivalent analysis does not alter
    // the painted room. Retain the latest record without shading and copying
    // that same room again; real shape, position and material changes redraw.
    const geometryChanged = oldDimensions.some((value,index) =>
      value !== [entry.width, entry.height, entry.thickness][index]) || oldPosition.some((value,index) =>
      value !== [entry.x, entry.y, entry.depthInset, entry.shelf][index]);
    // Shape and slot changes still invalidate while hidden; they change the
    // docking projection. A pending replacement keeps its existing lifecycle.
    return geometryChanged || Boolean(entry.replacement) || (!hiddenBookMaterial(entry) &&
      Object.keys(nextKeys).some(key => previousKeys[key] !== nextKeys[key]));
  }

  // Both shelves keep their real, fixed depth: nothing grows the furniture.
  function fitDepth() {}

  function updateWoodTheme() {
    const tones = WOOD_TONES[darkPage() ? 'dark' : 'light'];
    wood.color.set(tones.wood); backWood.color.set(tones.back); darkWood.color.set(tones.trim);
    // Floor contact reads softer on a pale page than on a near-black one.
    occlusionMaterial.opacity = tones === WOOD_TONES.dark ? 1 : .8;
    roomWallMaterial.color.set(darkPage() ? '#353434' : '#f0f1ed');
    if (floorLit !== darkPage()) rebuildOcclusion();
  }

  // Cache the geometry flags and native hit-control state. Tokenise the
  // classes and rebuild the joined string only when one of these inputs
  // differs from the last read, instead of asking
  // classList and the style four to six times per entry and frame.
  function stateFor(entry) {
    const node = entry.node;
    if (!node) return '';
    const classes = node.className, dragX = node.style.getPropertyValue('--ihr-drag-x'), dragY = node.style.getPropertyValue('--ihr-drag-y');
    const disabled = Boolean(node.disabled), pointerEvents = node.style.pointerEvents;
    if (classes === entry.classText && dragX === entry.dragX && dragY === entry.dragY &&
      disabled === entry.controlDisabled && pointerEvents === entry.controlPointerEvents) return entry.stateText;
    if (classes !== entry.classText) {
      const bits = entry.bits = rust.scene_class_flags(classes);
      entry.flags = { away:Boolean(bits & 1), dragging:Boolean(bits & 2), lifted:Boolean(bits & 4), pressed:Boolean(bits & 8) };
      entry.classText = classes;
    }
    if (dragX !== entry.dragX) entry.dragNumberX = rust.scene_drag_offset(dragX);
    if (dragY !== entry.dragY) entry.dragNumberY = rust.scene_drag_offset(dragY);
    entry.dragX = dragX; entry.dragY = dragY;
    entry.controlDisabled = disabled; entry.controlPointerEvents = pointerEvents;
    return entry.stateText = rust.scene_state_text(entry.bits, dragX, dragY, disabled, pointerEvents);
  }

  const viewSizes = new Float64Array(4), viewPixels = new Float64Array(2), viewFrame = new Float64Array(8), binBox = new Float64Array(9);
  function viewport() {
    sceneView.sizeViewport(scroller.clientHeight, window.innerHeight, window.devicePixelRatio, viewSizes);
    const ratio = viewSizes[1];
    // Move the whole stage, including its projected hit targets, together.
    // Use the resting frontal size so switching cameras never changes this
    // alignment. Its framebuffer dimensions and DPR remain untouched.
    const stageBounds = stage.getBoundingClientRect();
    const restingTop = stageBounds.top + scroller.scrollTop - stagePixelOffset;
    const offset = nativeRoomLease ? shelfPixelOffset(restingTop, sceneWidth, viewSizes[3], viewSizes[2]) : 0;
    const settledStageBounds = offset === stagePixelOffset ? stageBounds : null;
    if (offset !== stagePixelOffset) {
      stagePixelOffset = offset;
      stage.style.top = offset ? `${(parseFloat(originalTop) || 0) + offset}px` : originalTop;
    }
    sceneView.framePixels(ratio, viewPixels);
    const pixelWidth = viewPixels[0], pixelHeight = viewPixels[1];
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth; canvas.height = pixelHeight; shelfSnapshotDirty = true;
    }
    if (canvasWritten.width !== sceneWidth) canvas.style.width = `${canvasWritten.width = sceneWidth}px`;
    if (canvasWritten.height !== sceneView.viewportHeight) {
      canvas.style.height = `${sceneView.viewportHeight}px`; canvas.style.marginBottom = `${-sceneView.viewportHeight}px`;
      canvasWritten.height = sceneView.viewportHeight;
    }
    // Read every rectangle the rest of the frame needs right here, before the
    // semantic nodes are restyled: rereading them afterwards would force a
    // layout of the whole stage. Their absolutely positioned children cannot move them.
    frameLayout.canvas = canvas.getBoundingClientRect(); frameLayout.stage = settledStageBounds || stage.getBoundingClientRect();
    frameLayout.scroller = scroller.getBoundingClientRect();
    // Read the actual sticky position: near the last shelf its bottom is
    // constrained by the stage, so scroller.scrollTop alone would double-shift
    // the drawing and leave it out of alignment with the real DOM hit targets.
    const scroll = sceneView.scrollOf(frameLayout.canvas.top, frameLayout.stage.top);
    camera.left = 0; camera.right = sceneWidth; camera.top = 0; camera.bottom = -sceneView.viewportHeight;
    camera.position.y = -scroll; camera.updateProjectionMatrix();
    return { scroll, ratio };
  }

  function measureFitHeight() {
    const clip = scroller.getBoundingClientRect(), stageBounds = stage.getBoundingClientRect();
    const style = getComputedStyle(scroller);
    const edgeToEdge = style.getPropertyValue('--ihr-scene-edge-to-edge').trim() === '1';
    const bottomPadding = parseFloat(style.paddingBottom) || 0;
    // The stage's resting top includes the actual library heading, empty
    // copy and padding, even when the frontal shelf is scrolled far down.
    return sceneView.measureFit(window.innerHeight, clip.top, clip.bottom, stageBounds.top + scroller.scrollTop, bottomPadding, edgeToEdge);
  }

  function updateTransform() {
    updateDropMarker();
    measureFitHeight();
    // The complete object turns around one axis. A modest additional pullback
    // leaves room around the diagonal furniture instead of cropping its edges.
    let rooftop = -Infinity;
    for (const entry of bookEntries) if (entry.rooftop) rooftop = Math.max(rooftop, -entry.y + entry.height / 2);
    if (trash) {
      const { min, max } = trashBounds, { position } = trash;
      binBox.set([min.x, min.y, min.z, max.x, max.y, max.z, position.x, position.y, position.z]);
    }
    const texts = sceneView.transform(trash ? binBox : NO_NUMBERS, rooftop, floor.visible, unitCount, viewFrame);
    // The fitted room: turned, scaled and placed as the Rust view decided.
    furniture.rotation.set(viewFrame[1], viewFrame[0], 0); furniture.scale.setScalar(viewFrame[2]);
    furniture.position.set(viewFrame[3], viewFrame[4], 0);
    // Only the room's root is needed to project the entries below. Updating
    // every descendant here computes their previous pose, immediately before
    // each entry updates its new pose and the renderer walks the scene again.
    furniture.updateWorldMatrix(false, false);
    stage.style.height = `${viewFrame[6]}px`;
    setData(canvas, 'shelfView', texts[0]);
    setData(canvas, 'viewProgress', texts[1]);
    setData(canvas, 'yaw', texts[2]);
    setData(canvas, 'pitch', texts[3]);
    setData(canvas, 'zoom', texts[4]);
    setData(canvas, 'inspectionZoom', texts[5]);
    setData(canvas, 'inspectionMoving', texts[6]);
    setData(canvas, 'inspectionPan', texts[7]);
    setData(canvas, 'cabinetWidth', texts[8]); setData(canvas, 'trashReserve', texts[9]);
    setData(canvas, 'shelfType', shelfType);
    setData(canvas, 'shelfUnits', texts[10]);
    setData(canvas, 'shelfDimensions', SHELF_DIMENSIONS[shelfType]);
    setData(canvas, 'sceneFitHeight', texts[11]); setData(canvas, 'floorVisible', texts[12]);
    setData(canvas, 'fullCabinetInFrame', texts[13]);
    inverseRotation.copy(furniture.quaternion).invert();
    return viewFrame[2];
  }

  const catalogPlace = new Float64Array(4), catalogOut = new Float64Array(6), catalogBox = new Float64Array(6);
  const catalogCover = new Float64Array(3), catalogStage = new Float64Array(2), catalogInner = new Float64Array(2);
  function updateCatalog(scroll) {
    if (!catalog || !catalogNode) {
      delete canvas.dataset.catalog3d; delete canvas.dataset.catalogVisible;
      return;
    }
    const first = rows[0] || { top:20, bottom:220 };
    sceneView.catalogPlace(first.top, first.bottom, catalogPlace);
    catalog.position.set(catalogPlace[0], catalogPlace[1], catalogPlace[2]);
    catalog.rotation.set(0, Math.PI / 2, -.025);
    // It faces the right wall's exterior. During the turn it appears only
    // after that side becomes visible; the final frontal view has no booklet.
    catalog.visible = catalogPlace[3] === 1;
    catalog.updateMatrixWorld(true);
    const stageBounds = frameLayout.stage, clip = frameLayout.scroller;
    const { min, max } = catalog.userData.bounds;
    catalogBox.set([min.x, min.y, min.z, max.x, max.y, max.z]);
    // The printed cover inside the (clip and edge inclusive) hit box: the
    // catalogue page flies out of exactly this rectangle.
    const { width:coverWidth = 76, height:coverHeight = 108, thickness = 3.4 } = catalog.userData;
    catalogCover[0] = coverWidth; catalogCover[1] = coverHeight; catalogCover[2] = thickness;
    catalogStage[0] = stageBounds.left; catalogStage[1] = stageBounds.top;
    scrollerClip[0] = clip.left; scrollerClip[1] = clip.top; scrollerClip[2] = clip.right; scrollerClip[3] = clip.bottom;
    catalogInner[0] = window.innerWidth; catalogInner[1] = window.innerHeight;
    const face = sceneView.catalogFrame(catalogBox, catalog.matrixWorld.elements, catalogCover, scroll, catalogStage, scrollerClip, catalogInner, catalogOut);
    const visible = catalogOut[0] === 1, viewHidden = catalogOut[1] === 1;
    const targetWidth = catalogOut[2], targetHeight = catalogOut[3], left = catalogOut[4], top = catalogOut[5];
    if (catalogNode.hidden !== !visible) catalogNode.hidden = !visible;
    const tabIndex = String(visible ? 0 : -1), ariaHidden = String(!visible);
    if (catalogNode.getAttribute('tabindex') !== tabIndex) catalogNode.tabIndex = visible ? 0 : -1;
    if (catalogNode.getAttribute('aria-hidden') !== ariaHidden) catalogNode.setAttribute('aria-hidden', ariaHidden);
    // Only the geometry that moved is restyled; the rest of the box is constant.
    const written = catalogWritten?.node === catalogNode ? catalogWritten : (catalogWritten = hitStyleCache(catalogNode));
    const style = catalogNode.style;
    if (!written.fixed) style.position = 'absolute';
    if (left !== written.left) style.left = `${written.left = left}px`;
    if (top !== written.top) style.top = `${written.top = top}px`;
    if (targetWidth !== written.width) style.width = `${written.width = targetWidth}px`;
    if (targetHeight !== written.height) style.height = `${written.height = targetHeight}px`;
    if (!written.fixed) style.margin = '0';
    setData(catalogNode, 'bookletFace', face);
    // Isometric object envelopes include empty space behind the side wall.
    // Keep the tangible booklet above those otherwise invisible hit boxes.
    if (height + 1000 !== written.z) style.zIndex = String(written.z = height + 1000);
    const events = visible ? 'auto' : 'none';
    if (style.pointerEvents !== events) style.pointerEvents = events;
    written.fixed = true;
    setData(catalogNode, 'catalog3d', 'true'); setData(catalogNode, 'catalogVisible', String(visible));
    setData(catalogNode, 'catalogViewHidden', String(viewHidden));
    setData(canvas, 'catalog3d', 'true'); setData(canvas, 'catalogVisible', String(visible));
  }

  const lampIo = new Float64Array(8), stepIo = new Float64Array(37), projectIo = new Float64Array(44), hitIo = new Float64Array(49);
  const insertionIo = new Float64Array(4), surfaceBox = new Float64Array(6), inverseTurn = new Float64Array(4);
  function advanceLampPower(entry, now) {
    const target = entry.isOn === false ? 0 : 1;
    const power = entry.lampPower ||= { value:target, from:target, target, started:now, duration:0 };
    lampIo.set([target, power.value, power.from, power.target, power.started, power.duration, now, reducedMotion.matches ? 1 : 0]);
    rust.scene_lamp_power(lampIo);
    const previousValue = power.value;
    [power.value, power.from, power.target, power.started, power.duration] = lampIo;
    entry.model?.userData.setPower?.(power.value);
    if (entry.node) setData(entry.node, 'lampPower', power.value.toFixed(4));
    // A change of colour temperature eases over the same frames.
    const tint = entry.lampTint ||= createTintTransition(entry.kelvin);
    if (reducedMotion.matches) tint.set(entry.kelvin, now, false);
    const tinting = tint.advance(now);
    if (entry.model && entry.model.userData.shownTint !== tint.state.value.join()) {
      entry.model.userData.shownTint = tint.state.value.join();
      entry.model.userData.setTint?.(tint.state.value);
      shelfSnapshotDirty = true;
    }
    // Changing radiance repaints the image but never invalidates caster depth.
    if (lampIo[6]) shelfSnapshotDirty = true;
    void previousValue;
    return Boolean(lampIo[5]) || tinting;
  }

  function updateEntries(scroll, zoom, now, finishedInsertions) {
    let activeBooks = 0, moving = false, shelfMoving = false, previewing = false, previewed = 0, overlaying = false;
    insertedIds.length = 0; exclusionRects.length = 0; exclusionsReady = false;
    // Changes the observer has not yet delivered (a synchronous draw right after
    // a class or drag-variable write) are examined here, as the frame's own read.
    for (const record of mutations.takeRecords()) { const entry = byNode.get(record.target); if (entry) entry.domDirty = true; }
    inverseTurn[0] = inverseRotation.x; inverseTurn[1] = inverseRotation.y; inverseTurn[2] = inverseRotation.z; inverseTurn[3] = inverseRotation.w;
    sceneView.beginEntries(now, reducedMotion.matches, zoom, inverseTurn, window.devicePixelRatio, window.innerWidth, scroll, MINIMUM_LAMP_TAP_SIZE);
    const usePhysics = settleBooks && (physicsReady || physicsStarted);
    if (usePhysics) {
      physicsStarted = true;
      if (gravityInput.length !== bookEntries.length * 9) {
        gravityInput = new Float64Array(bookEntries.length * 9); gravityOutput = new Float64Array(bookEntries.length * 4);
        physicsStates = new Float64Array(bookEntries.length * 37);
      }
      const pixelsPerMetre = unitWidth / SHELF_SPECS[shelfType].width * 1000;
      const gravityKeys = bookEntries.map((entry,index) => {
        if (entry.domDirty) { entry.domDirty = false; entry.state = stateFor(entry); }
        const plant = entry.kind === 'plant', lamp = entry.kind === 'lamp', undershelf = lamp && entry.mount === 'undershelf';
        const kind = plant ? 1 : lamp ? 2 : 0, lift = entry.lift, landing = entry.landing, preview = entry.preview;
        stepIo[0] = kind; stepIo[1] = undershelf ? 1 : 0; stepIo[2] = entry.bits; stepIo[3] = entry.dragNumberX; stepIo[4] = entry.dragNumberY;
        stepIo[5] = lift.value; stepIo[6] = lift.from; stepIo[7] = lift.target; stepIo[8] = lift.started;
        stepIo[9] = landing ? 1 : 0;
        if (landing) { stepIo[10] = landing.from; stepIo[11] = landing.started; stepIo[12] = landing.duration; }
        stepIo[13] = preview.x; stepIo[14] = preview.y; stepIo[15] = preview.fromX; stepIo[16] = preview.fromY;
        stepIo[17] = preview.targetX; stepIo[18] = preview.targetY; stepIo[19] = preview.started; stepIo[20] = preview.active ? 1 : 0;
        stepIo[21] = entry.offset.x; stepIo[22] = entry.offset.y;
        stepIo[23] = entry.x; stepIo[24] = entry.y; stepIo[25] = entry.width; stepIo[26] = entry.height; stepIo[27] = entry.depth; stepIo[28] = entry.depthInset;
        physicsStates.set(stepIo,index * 37);
        const row = rows[entry.shelf || 0] || rows[0] || {};
        gravityInput.set([plant || lamp ? entry.width : entry.thickness, undershelf ? 3 : kind, entry.shelf || 0, pixelsPerMetre,
          row.left || 0, row.right ?? width, row.bottom ?? entry.y + entry.height / 2, row.ceiling ?? row.top ?? 0, entry.gripHeight || 0],index * 9);
        return entry.key;
      });
      bookGravity.step(gravityKeys, physicsStates, gravityInput, sceneView, now, reducedMotion.matches, gravityOutput);
    }
    for (const [entryIndex,entry] of bookEntries.entries()) {
      const node = entry.node, plant = entry.kind === 'plant', lamp = entry.kind === 'lamp';
      const decorative = plant || lamp, undershelf = lamp && entry.mount === 'undershelf';
      // The DOM is read again only for a node whose class or style changed.
      if (entry.domDirty) { entry.domDirty = false; entry.state = stateFor(entry); }
      const away = entry.flags.away;
      // The lift, the preview and the landing ease, and the pose follows, in Rust.
      const kind = plant ? 1 : lamp ? 2 : 0, lift = entry.lift, landing = entry.landing, preview = entry.preview;
      if (usePhysics) stepIo.set(physicsStates.subarray(entryIndex * 37, (entryIndex + 1) * 37));
      else {
        stepIo[0] = kind; stepIo[1] = undershelf ? 1 : 0; stepIo[2] = entry.bits; stepIo[3] = entry.dragNumberX; stepIo[4] = entry.dragNumberY;
        stepIo[5] = lift.value; stepIo[6] = lift.from; stepIo[7] = lift.target; stepIo[8] = lift.started;
        stepIo[9] = landing ? 1 : 0;
        if (landing) { stepIo[10] = landing.from; stepIo[11] = landing.started; stepIo[12] = landing.duration; }
        stepIo[13] = preview.x; stepIo[14] = preview.y; stepIo[15] = preview.fromX; stepIo[16] = preview.fromY;
        stepIo[17] = preview.targetX; stepIo[18] = preview.targetY; stepIo[19] = preview.started; stepIo[20] = preview.active ? 1 : 0;
        stepIo[21] = entry.offset.x; stepIo[22] = entry.offset.y;
        stepIo[23] = entry.x; stepIo[24] = entry.y; stepIo[25] = entry.width; stepIo[26] = entry.height; stepIo[27] = entry.depth; stepIo[28] = entry.depthInset;
        sceneView.stepEntry(stepIo);
      }
      lift.value = stepIo[5]; lift.from = stepIo[6]; lift.target = stepIo[7]; lift.started = stepIo[8];
      if (!stepIo[9]) entry.landing = null;
      preview.x = stepIo[13]; preview.y = stepIo[14]; preview.active = stepIo[20] !== 0;
      const motion = stepIo[36];
      moving ||= preview.active;
      previewing ||= preview.active;
      if (motion & 4) previewed++;
      shelfMoving ||= !away && (Boolean(motion & 1) || preview.active);
      // A completed insertion remains painted until its owner restores the
      // semantic shelf book. This avoids an empty frame at the final handoff.
      if (entry.insertion?.complete && !away) {
        if(entry.insertion.nativeLegacyBackground && entry.insertion.nativeLease)
          completedLegacyInsertionLeases.add(entry.insertion.nativeLease);
        entry.insertion = null;
      }
      const insertion = entry.insertion;
      moving ||= Boolean(motion & 8);
      shelfMoving ||= !away && Boolean(motion & 24);
      entry.pose.position.set(stepIo[29], stepIo[30], stepIo[31]);
      const gravityAt = entryIndex * 4;
      if (usePhysics && !decorative && node) setData(node, 'sceneLean', gravityOutput[gravityAt].toFixed(6));
      if (!decorative && usePhysics) {
        entry.pose.position.x = entry.x - width / 2 + gravityOutput[gravityAt + 1]; entry.pose.position.y = -entry.y + gravityOutput[gravityAt + 2];
        moving ||= gravityOutput[gravityAt + 3] !== 0; shelfMoving ||= gravityOutput[gravityAt + 3] !== 0;
        entry.pose.rotation.set(stepIo[32], stepIo[33], stepIo[34] + gravityOutput[gravityAt], gravityOutput[gravityAt] === 0 ? 'XYZ' : 'ZYX');
      } else entry.pose.rotation.set(stepIo[32], stepIo[33], stepIo[34]);
      entry.pose.scale.setScalar(stepIo[35]);
      entry.pose.updateMatrix();
      projectedMatrix.multiplyMatrices(furniture.matrixWorld, entry.pose.matrix);
      // Which part of the room it is in, and the quality it is drawn at, are decided in Rust too.
      const trashDrop = entry.trashDrop;
      projectIo[0] = kind; projectIo[1] = entry.bits | (usePhysics && gravityOutput[entryIndex * 4 + 3] ? 16 : 0) | (usePhysics && Math.abs(gravityOutput[entryIndex * 4]) > .001 ? 32 : 0); projectIo[2] = trashDrop ? 1 : 0; projectIo[3] = insertion ? 1 : 0;
      projectIo[4] = entry.model ? 1 : 0; projectIo[5] = entry.overview ? 1 : 0; projectIo[6] = trashDrop?.complete ? 1 : 0;
      projectIo[7] = insertion?.overlayCanvas ? 1 : 0;
      projectIo.set(entry.box, 8); projectIo.set(projectedMatrix.elements, 14);
      sceneView.projectEntry(projectIo);
      const rect = entry.rect || (entry.rect = {});
      rect.left = projectIo[30]; rect.right = projectIo[31]; rect.top = projectIo[32]; rect.bottom = projectIo[33];
      rect.width = projectIo[34]; rect.height = projectIo[35]; rect.closest = projectIo[36];
      const visible = projectIo[37] === 1;
      if (projectIo[38] === 1) {
        rust.scene_update_quality(entry,qualityHost,projectIo[39] === 1,projectIo[40]);
      }
      let created = null;
      if (visible && !entry.model) {
        created = entry.model = makeModel(entry);
        furniture.add(entry.model);
        if (entry.kind === 'plant' || entry.kind === 'lamp') programsStale = true;
      } else if (!visible && entry.model && !away) {
        releaseEntry(entry);
      }
      if (entry.model) {
        entry.model.visible = projectIo[41] === 1;
        if (trashDrop) {
          moving ||= !trashDrop.complete;
          shelfMoving ||= !trashDrop.complete;
        } else if (insertion) {
          // The first depth pass can take longer while a mobile GPU warms up.
          // Advance in bounded frame steps instead of skipping the whole
          // insertion after one delayed frame.
          insertionIo[0] = insertion.elapsed; insertionIo[1] = insertion.lastFrame; insertionIo[2] = insertion.duration; insertionIo[3] = now;
          rust.scene_insertion_step(insertionIo);
          insertion.elapsed = insertionIo[0]; insertion.lastFrame = insertionIo[1];
          const t = insertionIo[2];
          shelfBookInsertion(insertion.slot, entry.width, insertionIo[3])
            .decompose(entry.model.position, entry.model.quaternion, entry.model.scale);
          setData(canvas, 'returnProgress', t.toFixed(4));
          moving ||= t < 1;
          shelfMoving ||= t < 1 && !insertion.overlayCanvas;
          if (t === 1 && !insertion.complete) {
            insertion.complete = true;
            finishedInsertions.push(insertion.resolve);
          }
        } else {
          entry.model.position.copy(entry.pose.position);
          entry.model.rotation.copy(entry.pose.rotation);
          entry.model.scale.copy(entry.pose.scale);
        }
        if (!decorative && (!away || insertion)) activeBooks++;
      }
      if (lamp) moving = advanceLampPower(entry, now) || moving;
      if (node) {
        // A whole-model bounding rectangle includes empty space around plants
        // and most of an isometric book's cover. Give each semantic button a
        // centre on its visible, solid surface instead: binding or ceramic pot.
        const surface = hitSurface(entry, plant ? 'ceramic-pot' : lamp
          ? undershelf ? 'warm-opal-diffuser' : entry.lampId === 'tripod' ? 'woven-linen-drum-shade' : 'lamp-base'
          : 'binding');
        const hitRect = entry.hitRect || (entry.hitRect = {});
        let hitBox, hitMatrix;
        if (surface?.geometry) {
          if (!surface.geometry.boundingBox) surface.geometry.computeBoundingBox();
          entry.model.updateMatrixWorld(true);
          const { min, max } = surface.geometry.boundingBox;
          surfaceBox[0] = min.x; surfaceBox[1] = min.y; surfaceBox[2] = min.z; surfaceBox[3] = max.x; surfaceBox[4] = max.y; surfaceBox[5] = max.z;
          hitBox = surfaceBox; hitMatrix = surface.matrixWorld;
        } else { hitBox = fallbackBox(entry, lamp); hitMatrix = projectedMatrix; }
        // The button covers the hit surface, but a real-scale spine is only 5-13 px
        // thick: a book's button is padded to the minimum tap width around the
        // spine's centre (hitRect keeps the drawn surface). A lamp's switch is
        // padded to a finger-sized square around its light: a MITTLED puck is
        // a few pixels tall and often sits behind a board. Plants are not thin,
        // so their button is the hit surface itself.
        hitIo[0] = kind; hitIo[1] = undershelf ? 1 : 0; hitIo[2] = entry.bits; hitIo[3] = node.disabled || node.inert ? 1 : 0;
        hitIo[4] = rect.left; hitIo[5] = rect.right; hitIo[6] = rect.top; hitIo[7] = rect.bottom; hitIo[8] = rect.width; hitIo[9] = rect.height; hitIo[10] = rect.closest;
        hitIo.set(hitBox, 11); hitIo.set(hitMatrix.elements, 17);
        sceneView.hitEntry(hitIo);
        hitRect.left = hitIo[33]; hitRect.right = hitIo[34]; hitRect.top = hitIo[35]; hitRect.bottom = hitIo[36];
        hitRect.width = hitIo[37]; hitRect.height = hitIo[38]; hitRect.closest = hitIo[39];
        const tapLeft = hitIo[40], tapTop = hitIo[41], tapWidth = hitIo[42], tapHeight = hitIo[43];
        if (!plant) {
          const tapRect = entry.tapRect || (entry.tapRect = {});
          tapRect.left = tapLeft; tapRect.top = tapTop; tapRect.width = tapWidth; tapRect.height = tapHeight;
        }
        // A frame that moves nothing restyles nothing: only numbers that differ
        // from the last written ones reach the DOM, in the same order as a first write.
        let written = entry.written;
        if (written?.node !== node) written = entry.written = entryStyleCache(node);
        const style = node.style;
        if (usePhysics && lamp && !undershelf && entry.model) {
          entry.model.updateMatrixWorld(true);
          const clip = rust.scene_lamp_hit_hull(entry.model,tapLeft,tapTop);
          if (clip !== written.clip) style.clipPath = written.clip = clip;
        }
        if (!written.fixed) style.position = 'absolute';
        if (tapLeft !== written.left) style.left = `${written.left = tapLeft}px`;
        if (tapTop !== written.top) style.top = `${written.top = tapTop}px`;
        if (tapWidth !== written.width) style.width = `${written.width = tapWidth}px`;
        if (tapHeight !== written.height) style.height = `${written.height = tapHeight}px`;
        if (!written.fixed) style.margin = '0';
        const zIndex = hitIo[44];
        if (zIndex !== written.z) style.zIndex = String(written.z = zIndex);
        if (!written.fixed) {
          node.dataset.sceneProjected = 'true';
          node.dataset.sceneHitSurface = plant ? 'pot' : lamp ? undershelf ? 'ceiling-lamp' : 'lamp' : 'spine';
          if (lamp) {
            node.dataset.lampModelId = entry.lampId;
            node.dataset.lampMount = undershelf ? 'undershelf' : 'standing';
          }
          written.fixed = true;
        }
        if (!decorative || lamp) {
          let coverHit = semanticCovers.get(node);
          if (!coverHit) {
            coverHit = document.createElement('span'); coverHit.setAttribute('aria-hidden', 'true');
            coverHit.dataset[lamp ? 'shelfLampHit' : 'shelfCoverHit'] = 'true'; semanticCovers.set(node, coverHit); node.append(coverHit);
            Object.assign(written, { coverFixed:false, coverLeft:NaN, coverTop:NaN, coverWidth:NaN, coverHeight:NaN, display:'', events:'' });
          }
          // Keep tapping the exposed cover available without moving the
          // button's own focus/click centre away from its neighboring spine.
          // The existing handlers still raycast the true visible geometry.
          const coverStyle = coverHit.style, coverLeft = hitIo[45], coverTop = hitIo[46];
          if (!written.coverFixed) coverStyle.position = 'absolute';
          if (coverLeft !== written.coverLeft) coverStyle.left = `${written.coverLeft = coverLeft}px`;
          if (coverTop !== written.coverTop) coverStyle.top = `${written.coverTop = coverTop}px`;
          if (rect.width !== written.coverWidth) coverStyle.width = `${written.coverWidth = rect.width}px`;
          if (rect.height !== written.coverHeight) coverStyle.height = `${written.coverHeight = rect.height}px`;
          const display = hitIo[47] ? 'block' : 'none';
          if (display !== written.display) coverStyle.display = written.display = display;
          if (!written.coverFixed) { coverStyle.background = 'transparent'; written.coverFixed = true; }
          const events = hitIo[48] ? 'inherit' : 'none';
          if (events !== written.events) coverStyle.pointerEvents = written.events = events;
        }
      }
      if (entry.insertion) {
        insertedIds.push(String(entry.book?.id ?? ''));
        overlaying ||= Boolean(entry.insertion.overlayCanvas);
      }
      // Before the first frame the driver links each new model's programs
      // while the next models are still being built.
      if (created?.visible && programsReady !== true) prelinkPrograms(renderer, scene, camera, [created]);
    }
    // Bind native hit surfaces only after all semantic book rectangles are
    // projected, so an overlapping leaf cannot steal a neighboring spine tap.
    for (const entry of bookEntries) if (entry.kind === 'plant' && entry.node) updatePlantFoliage(entry);
    // Everything queued since the records were taken above is this frame's own
    // restyling (the loop wrote only left/top/width/height/z-index of observed
    // nodes): it carries no class or drag-variable change to react to.
    mutations.takeRecords();
    setData(canvas, 'activeBooks', String(activeBooks));
    setData(canvas, 'previewAnimating', String(previewing));
    setData(canvas, 'previewObjects', String(previewed));
    setData(canvas, 'returningBooks', insertedIds.join(','));
    setData(canvas, 'returningBookId', insertedIds.length === 1 ? insertedIds[0] : '');
    setData(canvas, 'returnRenderer', overlaying ? 'shared-depth-overlay' : 'shelf');
    if (!insertedIds.length) delete canvas.dataset.returnProgress;
    return { moving, shelfMoving };
  }

  function updatePlantFoliage(entry) {
    const { node, model, rect, hitRect } = entry;
    if (model?.userData.shelfPlantDiagnostics && !node.dataset.plantModelDepth)
      Object.assign(node.dataset, model.userData.shelfPlantDiagnostics);
    let native = semanticFoliage.get(node);
    if (!model?.visible || !rect || !hitRect || entry.flags.away || entry.flags.dragging || entry.trashDrop) {
      if (native && native.display !== 'none') native.svg.style.display = native.display = 'none';
      return;
    }
    if (!native) {
      const svg = document.createElementNS(SVG_NS, 'svg');
      const definitions = document.createElementNS(SVG_NS, 'defs');
      const clip = document.createElementNS(SVG_NS, 'clipPath');
      const exclusions = document.createElementNS(SVG_NS, 'path');
      const path = document.createElementNS(SVG_NS, 'path');
      const id = `ihr-foliage-${++foliageSerial}`;
      svg.classList.add('ihr-plant-foliage'); svg.setAttribute('aria-hidden', 'true');
      svg.setAttribute('focusable', 'false'); svg.dataset.plantFoliageKey = node.dataset.objectId || entry.key;
      clip.id = id; clip.setAttribute('clipPathUnits', 'userSpaceOnUse');
      exclusions.setAttribute('clip-rule', 'evenodd'); clip.append(exclusions); definitions.append(clip);
      path.setAttribute('clip-path', `url(#${id})`); path.setAttribute('fill', 'transparent');
      Object.assign(svg.style, { position:'absolute', pointerEvents:'none', touchAction:'none', overflow:'visible',
        maxWidth:'none', maxHeight:'none' });
      path.style.touchAction = 'none'; svg.append(definitions, path); node.append(svg);
      native = { svg, path, exclusions, pose:[], model:null, clip:'', bounds:null, inputs:new Float64Array(0),
        display:'', left:NaN, top:NaN, width:NaN, height:NaN, events:'' };
      semanticFoliage.set(node, native);
    }
    // The pot keeps its own accessible focus/drag centre. Its child extends
    // over the leaves, but only painted triangles participate in hit testing.
    const svgStyle = native.svg.style, left = rect.left - hitRect.left, top = rect.top - hitRect.top;
    if (native.display !== 'block') svgStyle.display = native.display = 'block';
    if (left !== native.left) svgStyle.left = `${native.left = left}px`;
    if (top !== native.top) svgStyle.top = `${native.top = top}px`;
    if (rect.width !== native.width) svgStyle.width = `${native.width = rect.width}px`;
    if (rect.height !== native.height) svgStyle.height = `${native.height = rect.height}px`;
    const events = node.disabled || node.inert || node.style.pointerEvents === 'none' ? 'none' : 'fill';
    if (events !== native.events) native.path.style.pointerEvents = native.events = events;
    // Inspection is a uniform scale and translation of the whole room. SVG's
    // viewBox applies exactly that transform to the cached leaf triangles,
    // preserving holes without projecting every leaf again on every finger move.
    const { elements } = model.matrix, rotation = furniture.quaternion, pose = native.pose;
    let moved = native.model !== model || rotation.x !== pose[16] || rotation.y !== pose[17] || rotation.z !== pose[18] || rotation.w !== pose[19];
    for (let index = 0; index < 16 && !moved; index++) moved = elements[index] !== pose[index];
    if (moved) {
      const projected = projectPlantFoliage(model);
      native.path.setAttribute('d', projected.path); native.svg.dataset.triangles = String(projected.triangles);
      native.model = model; native.bounds = { ...rect };
      for (let index = 0; index < 16; index++) pose[index] = elements[index];
      pose[16] = rotation.x; pose[17] = rotation.y; pose[18] = rotation.z; pose[19] = rotation.w;
      native.svg.setAttribute('viewBox', `${rect.left} ${rect.top} ${rect.width} ${rect.height}`);
    }
    const reference = native.bounds;
    // The clip is a pure function of the reference box, this rectangle and every
    // excluded book rectangle: rebuild it only when one of those numbers moved.
    if (!exclusionsReady) {
      for (const other of bookEntries) if (other.kind !== 'plant' && other.model?.visible && !other.flags.away && !other.flags.dragging) {
        const area = sceneView.progress > .04 ? other.rect : other.hitRect;
        if (area) exclusionRects.push(area);
      }
      exclusionsReady = true;
    }
    const inputs = new Float64Array(10 + exclusionRects.length * 4);
    inputs.set([reference.left, reference.right, reference.top, reference.bottom, reference.width, reference.height,
      rect.left, rect.top, rect.width, rect.height]);
    let slot = 10;
    for (const area of exclusionRects) {
      inputs[slot++] = area.left; inputs[slot++] = area.right; inputs[slot++] = area.top; inputs[slot++] = area.bottom;
    }
    // Inside the books' rectangles the existing native book surface already has touch-action:none and
    // resolves true mesh occlusion in its drag handler; the clip (Rust) keeps book clicks native even if
    // foliage is behind a cover. It is rebuilt only when one of its inputs moved.
    const clipping = rust.scene_foliage_clip(native.inputs, inputs);
    if (!clipping) return;
    native.inputs = inputs;
    if (native.clip !== clipping) {
      native.exclusions.setAttribute('d', clipping); native.clip = clipping;
    }
  }

  const previewIo = new Float64Array(13), previewTarget = new Float64Array(2);
  function previewOffset(entry, x, y, now) {
    const preview = entry.preview;
    previewIo.set([preview.x, preview.y, preview.fromX, preview.fromY, preview.targetX, preview.targetY, preview.started, preview.active ? 1 : 0,
      x, y, now, reducedMotion.matches ? 1 : 0]);
    rust.scene_preview_offset(previewIo);
    [preview.x, preview.y, preview.fromX, preview.fromY, preview.targetX, preview.targetY, preview.started] = previewIo;
    preview.active = previewIo[7] !== 0;
    return previewIo[12] !== 0;
  }

  function updateDropMarker() {
    if (!dropMarker) return;
    const row = sceneView.hasDrop && rows[sceneView.dropShelf];
    dropMarker.visible = Boolean(row);
    if (!row) return;
    const pose = sceneView.dropMarker(packRows([row]));
    dropMarker.position.set(pose[0], pose[1], pose[2]);
    dropMarker.children[0].position.y = pose[3];
    dropMarker.children[0].scale.y = pose[4];
    dropMarker.children[1].position.y = pose[5];
  }

  // Callers use the ray at once and never keep it.
  const rayPointer = new THREE.Vector2(), raycaster = new THREE.Raycaster();
  function pointerRay(clientX, clientY) {
    // During a drag, pending style/mutation frames must remain coalesced:
    // casting a ray does not need to shade and read back the whole room.
    // A compositor inspection does need its native matrices restored first.
    if (inspectionSnapshotVisible) { cancelAnimationFrame(raf); raf = 0; draw(); }
    camera.updateMatrixWorld();
    const bounds = canvas.getBoundingClientRect();
    rayPointer.set((clientX - bounds.left) / sceneWidth * 2 - 1, 1 - (clientY - bounds.top) / sceneView.viewportHeight * 2);
    raycaster.setFromCamera(rayPointer, camera);
    return raycaster;
  }

  // A thin spine's ray often falls between two books (on the back panel) although
  // the finger is on the book's padded button: the book whose padded tap rectangle
  // holds the point, nearest centre first, so overlapping rectangles never steal
  // each other's taps. A lamp's finger-sized square takes part too, so wood that
  // covers a light (a MITTLED under its board) does not block its switch.
  // Rectangles are in the stage's frame, as the buttons are.
  const tapNodes = [], tapPacked = [];
  function tapTargetNear(clientX, clientY) {
    const origin = stage.getBoundingClientRect();
    tapNodes.length = 0; tapPacked.length = 0;
    for (const entry of bookEntries) {
      const tap = entry.tapRect;
      if (!tap || !entry.node || !entry.model?.visible || entry.flags?.away || entry.flags?.dragging || entry.trashDrop) continue;
      if (entry.kind === 'plant' || entry.node.classList.contains('is-away')) continue;
      tapNodes.push(entry.node);
      tapPacked.push(tap.left + origin.left, tap.top + origin.top, tap.width, tap.height);
    }
    return tapNodes[rust.scene_nearest_tap(Float64Array.from(tapPacked), clientX, clientY)] ?? null;
  }

  function objectAtPoint(clientX, clientY) {
    const ray = pointerRay(clientX, clientY);
    const pickable = furniture.children.filter(object => object.visible && !object.userData.dropMarker &&
      !object.userData.entry?.node?.classList.contains('is-away'));
    for (const hit of ray.intersectObjects(pickable, true)) {
      let object = hit.object;
      while (object && !object.userData.entry) object = object.parent;
      if (object?.userData.entry?.node && object.visible) return object.userData.entry.node;
      // Solid wood in front blocks the object behind it, but a book's padded tap
      // rectangle or a lamp's square still wins over the wood around them.
      if (!object?.userData.entry) return tapTargetNear(clientX, clientY);
    }
    return tapTargetNear(clientX, clientY);
  }

  const isSolid = (material, side) => material.visible && material.depthWrite && material.depthTest && !material.transparent &&
    !material.alphaTest && !material.alphaMap && material.side === side;
  // Scratch for the depth pass: the same maps serve every frame of a return.
  const insertionWrites = new Map(), insertionVisibility = new Map(), insertionSolids = new Map();
  const previousScissorScratch = new THREE.Vector4();
  function collectInsertionMaterials(object) {
    const material = object.material, single = material && !Array.isArray(material);
    if (single) { if (!insertionWrites.has(material)) insertionWrites.set(material, material.colorWrite); }
    else if (material) for (const each of material) if (!insertionWrites.has(each)) insertionWrites.set(each, each.colorWrite);
    // Opaque surfaces only contribute depth to the first pass: an unlit
    // stand-in skips their full wood/cloth shading on every return frame.
    // Cut-outs, blended and non-depth-writing surfaces keep their own.
    if (!object.isMesh || !material || (!single && !material.length)) return;
    const side = (single ? material : material[0]).side;
    let solid = true;
    if (single) solid = isSolid(material, side);
    else for (const each of material) if (!isSolid(each, side)) { solid = false; break; }
    if (solid) insertionSolids.set(object, material);
  }

  const insertionBox = new THREE.Box3(), insertionFrameOut = new Float64Array(5);
  const previousInsertionViewport = new THREE.Vector4();
  function hasNativeInsertionFrame(insertion) {
    if (!nativeFrameCache.validFrame(insertion.nativeFrame)) return false;
    const replay = insertion.nativeLegacyReplay;
    if (!replay) return nativeFrameCache.validFrame(insertion.nativeCombinedFrame);
    const { output, layer, pixelWidth, pixelHeight, revision } = replay;
    return insertion.nativeLegacyBackground === true && !insertion.nativeCombinedFrame &&
      revision === insertion.nativeFrameRevision && layer.frame === insertion.nativeFrame &&
      layer.x === insertion.nativeFrame.x && layer.y === insertion.nativeFrame.y && layer.scale === 1 &&
      output.x === 0 && output.y === 0 && output.ratio === insertion.nativeFrame.ratio &&
      output.width * output.ratio === pixelWidth && output.height * output.ratio === pixelHeight &&
      (nativeFrameCache.exactFrame?.(output) ?? true);
  }
  function repaintNativeInsertion(insertion) {
    if (!hasNativeInsertionFrame(insertion)) return false;
    const replay = insertion.nativeLegacyReplay;
    return replay ? nativeFrameCache.compose(replay.output, [replay.layer])
      : nativeFrameCache.repaint(insertion.nativeCombinedFrame);
  }
  function createNativeInsertionLease(insertion) {
    const bridge = insertion.nativePresentation, overlay = insertion.overlayCanvas;
    if (!bridge || !nativeFrameCache || !getInsertionRoomBackground()) return null;
    insertion.nativeSlot = {}; insertion.nativeCombinedSlot = {};
    const lease = bridge.createLease({
      capture(rawContext) {
        if (!hasNativeInsertionFrame(insertion)) return;
        try {
          nativeFrameCache.repaint(insertion.nativeFrame);
          rawContext.clearRect(0,0,overlay.width,overlay.height);
          rawContext.drawImage(renderer.domElement,insertion.nativeFrame.x*insertion.nativeFrame.ratio,
            insertion.nativeFrame.y*insertion.nativeFrame.ratio);
        } finally {
          // The export is book-only. Its currently displayed owner is the
          // full room plus book, and a settled frame may have no future RAF.
          if (insertion.nativeLease?.isOwner()) repaintNativeInsertion(insertion);
        }
      },
      repaint:() => repaintNativeInsertion(insertion),
      position(node) {
        // The native output belongs to the same book host as its lazy export.
        // Offset against that host to retain the exact full-screen origin.
        const parent = overlay.parentElement, rect = overlay.getBoundingClientRect();
        const vw = window.innerWidth, vh = window.innerHeight;
        if (!parent || rect.left!==0 || rect.top!==0 || rect.width!==vw || rect.height!==vh) return false;
        const parentRect = parent.getBoundingClientRect();
        node.className = 'ihr-shelf-insertion-live-canvas'; node.setAttribute('aria-hidden','true');
        node.style.cssText = `position:absolute;pointer-events:none;left:${-parentRect.left}px;top:${-parentRect.top}px;width:${vw}px;height:${vh}px`;
        if (node.parentNode !== parent) parent.append(node);
        return true;
      },
      cleanup() {
        if (nativeInsertionMetadataOwner === lease) {
          delete renderer.domElement.dataset.insertionDepth; delete renderer.domElement.dataset.returnProgress;
          nativeInsertionMetadataOwner = null;
        }
        completedLegacyInsertionLeases.delete(lease);
        nativeFrameCache.releaseSlot(insertion.nativeSlot);
        nativeFrameCache.releaseSlot(insertion.nativeCombinedSlot);
        insertion.nativeFrame = insertion.nativeCombinedFrame = insertion.nativeLegacyReplay = null;
      }
    });
    if (lease) Object.defineProperty(lease,'role',{value:'shelf-insertion'});
    return lease;
  }
  function presentNativeInsertion(insertion, frame, vw, vh, ratio) {
    // The original cropped raster starts at GL pixel zero. Keep that viewport
    // origin and retain its complete resolved pixels, then place the texture
    // at its logical window (including a window partly outside the screen).
    const descriptor = {...frame,ratio,sourceX:0,sourceY:0};
    const bookFrame = nativeFrameCache.capture(insertion.nativeSlot,descriptor), background = getInsertionRoomBackground();
    if (!bookFrame || !background) throw new Error('Native insertion pixels cannot be retained');
    const outputFrame={x:0,y:0,width:vw,height:vh,ratio};
    const bookLayer={frame:bookFrame,x:bookFrame.x,y:bookFrame.y,scale:1};
    const layers=background.mode==='legacy'?[bookLayer]:[background,bookLayer];
    if (!nativeFrameCache.compose(outputFrame,layers))
      throw new Error('Native insertion cannot preserve its room underlay');
    // The legacy room remains in its actual 2D canvas. This one retained book
    // layer is enough to replay its exact transparent native presentation.
    // Aligned room textures can change during a foreign paint, so that path
    // keeps its original complete retained composition.
    const legacyReplay = background.mode === 'legacy' && nativeFrameCache.validFrame(bookFrame) &&
      outputFrame.width * ratio === insertion.overlayCanvas.width &&
      outputFrame.height * ratio === insertion.overlayCanvas.height &&
      (nativeFrameCache.exactFrame?.(outputFrame) ?? true);
    const combined = legacyReplay ? null : nativeFrameCache.capture(insertion.nativeCombinedSlot,outputFrame);
    if (!legacyReplay && !combined) throw new Error('Native insertion output cannot be retained');
    const revision = (insertion.nativeFrameRevision || 0) + 1;
    insertion.nativeFrame=bookFrame; insertion.nativeCombinedFrame=combined;
    insertion.nativeFrameRevision=revision;
    insertion.nativeLegacyBackground=background.mode==='legacy';
    insertion.nativeLegacyReplay=legacyReplay ? Object.freeze({ output:Object.freeze(outputFrame),
      layer:Object.freeze(bookLayer),pixelWidth:insertion.overlayCanvas.width,
      pixelHeight:insertion.overlayCanvas.height,revision }) : null;
    insertion.nativeLease.markDirty();
    const owner = currentNativeRendererPresentation(renderer);
    const presented = owner===insertion.nativeLease ? insertion.nativeLease.present()
      : owner===background.lease ? owner.transferTo(insertion.nativeLease)
      : !owner && insertion.nativeLease.present();
    if (!presented || !insertion.nativePresentation.commit(insertion.nativeLease))
      throw new Error('Native insertion presentation is no longer owned');
  }
  function paintInsertionOverlay(entry) {
    const insertion = entry.insertion, overlay = insertion?.overlayCanvas, model = entry.model;
    if (!overlay || !model) return;
    const native = Boolean(insertion.nativePresentation && insertion.nativeLease);
    const overlayContext = native ? insertion.nativePresentation.context : overlay.getContext('2d');
    if (!overlayContext) return;
    const vw = window.innerWidth || overlay.clientWidth, vh = window.innerHeight || overlay.clientHeight;
    if (!vw || !vh) return;
    const origin = frameLayout.stage;
    // Use the same world axes as the cabinet, but show the entire viewport.
    // The moving book therefore stays visible beyond the scroller's edges.
    insertionCamera.left = -origin.left; insertionCamera.right = vw - origin.left;
    insertionCamera.top = origin.top; insertionCamera.bottom = origin.top - vh;
    insertionCamera.clearViewOffset(); insertionCamera.updateProjectionMatrix();
    const ratio = overlay.width / vw;
    let frame = { x:0,y:0,width:vw,height:vh };
    if (Number.isInteger(ratio) && Number.isInteger(vw) && Number.isInteger(vh)) {
      model.updateMatrixWorld(true); insertionCamera.updateMatrixWorld(true);
      insertionBox.setFromObject(model);
      const { min, max } = insertionBox;
      sceneView.insertionFrame([min.x, min.y, min.z, max.x, max.y, max.z], insertionCamera.matrixWorldInverse.elements,
        insertionCamera.projectionMatrix.elements, vw, vh, insertionFrameOut);
      frame = { x:insertionFrameOut[1], y:insertionFrameOut[2], width:insertionFrameOut[3], height:insertionFrameOut[4] };
      if (insertionFrameOut[0]) insertionCamera.setViewOffset(vw,vh,frame.x,frame.y,frame.width,frame.height);
    }
    if (native && ![ratio,vw,vh,frame.x*ratio,frame.y*ratio].every(Number.isInteger)) {
      insertion.nativePresentation.fallback(); insertion.nativePresentation = insertion.nativeLease = null;
      restoreNativeRoom(); return paintInsertionOverlay(entry);
    }
    const paint = () => {
    const outputWidth=native?vw:frame.width, outputHeight=native?vh:frame.height;
    configureShelfRendererSize(renderer, outputWidth, outputHeight, ratio, rendererSize);
    const previousViewport = native && renderer.getViewport(previousInsertionViewport);
    if (native) renderer.setViewport(0,0,frame.width,frame.height);
    const autoClear = renderer.autoClear, scissorTest = renderer.getScissorTest();
    const previousScissor = renderer.getScissor(previousScissorScratch);
    const writes = insertionWrites, visibility = insertionVisibility, solids = insertionSolids;
    writes.clear(); visibility.clear(); solids.clear();
    scene.traverse(collectInsertionMaterials);
    for (const object of furniture.children) visibility.set(object, object.visible);
    if (trash) visibility.set(trash, trash.visible);
    const canvasRect = frameLayout.canvas, clip = frameLayout.scroller;
    const left = Math.max(0, frame.x, canvasRect.left, clip.left), right = Math.min(vw, frame.x+frame.width, canvasRect.right, clip.right);
    const top = Math.max(0, frame.y, canvasRect.top, clip.top), bottom = Math.min(vh, frame.y+frame.height, canvasRect.bottom, clip.bottom);
    try {
      renderer.autoClear = false;
      renderer.setScissorTest(false); renderer.clear(true, true, true);
      // First draw only the cabinet's depth, clipped exactly like the painted
      // shelf. Invisible wood outside its viewport must not hide the book.
      for (const material of writes.keys()) material.colorWrite = false;
      for (const [mesh, material] of solids) mesh.material = depthOnly[(Array.isArray(material) ? material[0] : material).side] || depthOnly[THREE.FrontSide];
      model.visible = false;
      if (right > left && bottom > top) {
        renderer.setScissor(left-frame.x,frame.height-(bottom-frame.y),right-left,bottom-top);
        renderer.setScissorTest(true);
        renderer.render(scene, insertionCamera);
      }
      // Keep that depth buffer while drawing just the moving book in color.
      // Its neighbors now hide the portions actually behind their surfaces.
      for (const [mesh, material] of solids) mesh.material = material;
      for (const [material, value] of writes) material.colorWrite = value;
      for (const object of furniture.children) object.visible = object === model;
      if (trash) trash.visible = false;
      renderer.setScissorTest(false);
      renderer.render(scene, insertionCamera);
      if (native) presentNativeInsertion(insertion,frame,vw,vh,ratio);
      else {
        overlayContext.clearRect(0, 0, overlay.width, overlay.height);
        if (frame.width===vw && frame.height===vh) overlayContext.drawImage(renderer.domElement, 0, 0, overlay.width, overlay.height);
        else overlayContext.drawImage(renderer.domElement, frame.x*ratio, frame.y*ratio);
      }
      overlay.dataset.insertionDepth = 'shared-shelf';
      overlay.dataset.returnProgress = canvas.dataset.returnProgress;
      if (native && insertion.nativeLease.isOwner()) {
        // Stamp only a frame that really committed to this book's lease.
        nativeInsertionMetadataOwner = insertion.nativeLease;
        setData(renderer.domElement, 'insertionDepth', 'shared-shelf');
        setData(renderer.domElement, 'returnProgress', canvas.dataset.returnProgress);
      }
    } finally {
      for (const [mesh, material] of solids) mesh.material = material;
      for (const [material, value] of writes) material.colorWrite = value;
      for (const [object, value] of visibility) object.visible = value;
      renderer.autoClear = autoClear;
      renderer.setScissor(previousScissor); renderer.setScissorTest(scissorTest);
      if (native) renderer.setViewport(previousViewport);
      writes.clear(); visibility.clear(); solids.clear();
    }
    };
    try { return withRendererPresentation(renderer,insertion.nativeLease || null,paint); }
    catch (error) {
      if (!native) throw error;
      insertion.nativePresentation.fallback(); insertion.nativePresentation = insertion.nativeLease = null;
      restoreNativeRoom(); return paintInsertionOverlay(entry);
    }
  }

  function hideInspectionSnapshot() {
    if (!inspectionSnapshotVisible) return;
    inspectionSnapshotVisible = false;
    inspectionCanvas.style.display = 'none';
    inspectionOverviewCanvas.style.display = 'none';
    canvas.style.visibility = '';
    setData(canvas, 'inspectionCacheActive', 'false');
  }

  function paintInspectionSnapshot() {
    const snapshot = inspectionSnapshot || inspectionOverview;
    const miss = rust.scene_cache_miss((!inspectionContext ? 1 : 0) | (!snapshot ? 2 : 0) | (shelfSnapshotDirty ? 4 : 0) | (shadowDirty ? 8 : 0) |
      (lastSceneMoving ? 16 : 0) | (lighting.settling && !sceneView.shadowRefit ? 32 : 0) |
      (sceneView.turning || sceneView.reordering || sceneView.trashEasing || sceneView.progress !== 1 ? 64 : 0) | (sceneView.hasDrop ? 128 : 0));
    if (miss) {
      setData(canvas, 'inspectionCacheMissReason', miss);
      setData(canvas, 'inspectionCacheMissSource', canvas.dataset.inspectionDirtySource || '');
      return false;
    }
    const placement = new Float64Array(4);
    const project = source => {
      sceneView.snapshotPlacement(source.zoom, source.panX, source.panY, source.margin, source.width, source.height, placement);
      return { scale:placement[0], left:placement[1], top:placement[2], covers:placement[3] === 1 };
    };
    const { scale, left, top, covers } = project(snapshot);
    const overview = inspectionOverview && project(inspectionOverview);
    if (!covers && !overview?.covers) { setData(canvas, 'inspectionCacheMissReason', 'coverage'); return false; }
    let nativeCompositor=false;
    if(!sceneView.moving && nativeRoomLease && nativeFrameCache.validFrame(snapshot.nativeFrame) && (!overview?.covers || nativeFrameCache.validFrame(inspectionOverview.nativeFrame))) {
      const clip={left:0,top:0,right:sceneWidth,bottom:sceneView.viewportHeight},layers=[];
      if(overview?.covers)layers.push({frame:inspectionOverview.nativeFrame,x:overview.left,y:overview.top,scale:overview.scale,clip});
      if(inspectionSnapshot)layers.push({frame:inspectionSnapshot.nativeFrame,x:left,y:top,scale,clip});
      let output={x:0,y:0,width:sceneWidth,height:sceneView.viewportHeight,ratio:Math.max(snapshot.nativeFrame.ratio,window.devicePixelRatio||1)};
      if(snapshot.nativeFrame.physical || !(nativeFrameCache.exactFrame?.(output) ?? true))output=physicalRoomFrame(output.width,output.height,output.ratio);
      nativeCompositor=withRendererPresentation(renderer,nativeRoomLease,()=>{
        if(!output)return false;
        if(!nativeFrameCache.compose(output,layers))return false;
        const retained=nativeFrameCache.capture(nativeComposedRoomSlot,output);
        if(!retained)return false;
        nativeRoomDisplay={frame:retained,margin:0};
        const owner=currentNativeRendererPresentation(renderer);
        return owner===nativeRoomLease?nativeRoomLease.present():!owner && nativeRoomLease.present();
      });
    }
    if (!nativeCompositor) {
      const wasNativeOwner = Boolean(nativeRoomLease?.isOwner());
      // The original CSS tiles now own this presentation. Materializing them
      // must not resize and restore a native room that is about to be hidden.
      nativeRoomLease?.release({snapshot:false});
      try {
        const capturedOverview=overview?.covers ? captureNativeInspection(true) : null;
        if (inspectionSnapshot) captureNativeInspection(false,capturedOverview);
      } catch (error) {
        // No CSS display changed yet; recover the old complete native frame.
        if (wasNativeOwner) restoreNativeRoom();
        throw error;
      }
      if (nativeRoomClip) nativeRoomClip.style.display = 'none';
    }
    // A retained fitted overview supplies anything revealed beyond the high
    // resolution tile. Never block an ordinary pan/pinch on a GPU recapture;
    // its fine tile and full backdrop move together until the settled paint.
    if (!nativeCompositor && overview?.covers) {
      inspectionOverviewCanvas.style.transform = `matrix(${overview.scale},0,0,${overview.scale},${overview.left},${overview.top})`;
      inspectionOverviewCanvas.style.display = 'block';
    } else inspectionOverviewCanvas.style.display = 'none';
    if (!nativeCompositor && inspectionSnapshot) {
      inspectionCanvas.style.transform = `matrix(${scale},0,0,${scale},${left},${top})`;
      inspectionCanvas.style.display = 'block';
    } else inspectionCanvas.style.display = 'none';
    canvas.style.visibility = 'hidden';
    inspectionSnapshotVisible = true;
    setData(canvas, 'inspectionCacheActive', 'true');
    setData(canvas, 'inspectionCacheMissReason', '');
    setData(canvas, 'inspectionCompositorFrames', String(++compositorFrames));
    setData(canvas, 'inspectionMoving', 'true'); setData(canvas, 'animating', 'true');
    setData(canvas, 'inspectionZoom', sceneView.zoom.toFixed(4));
    setData(canvas, 'inspectionPan', JSON.stringify([sceneView.panX, sceneView.panY]));
    setData(canvas, 'zoom', (snapshot.furnitureZoom * scale).toFixed(4));
    setData(canvas, 'renderCount', String(++renderCount));
    return true;
  }

  // Cheap readiness check between frames; the scene is only redrawn once ready.
  function pollPrograms() {
    programsPoll = 0;
    if (disposed || programsReady === true || pageSuspended || document.visibilityState === 'hidden') return;
    if (!canPresent() && !hasOngoingMotion()) return;
    if (programsReady()) invalidate(false); else programsPoll = setTimeout(pollPrograms, 10);
  }

  function draw(now = performance.now(), force = false) {
    raf = 0;
    if (disposed) return;
    if (pageSuspended || document.visibilityState === 'hidden') { drawPending = true; return; }
    if (!force && canDeferModalPaint()) { drawPending = true; return; }
    drawPending = false;
    if (!batchQuality) hideInspectionSnapshot();
    if (!sceneView.moving && inspectionEntryUpdates.size) {
      // Cover analysis and metadata can finish independently for many books.
      // Commit their latest records together before fitting the settled room,
      // rather than interrupting finger frames for each completed analysis.
      const pending = [...inspectionEntryUpdates]; inspectionEntryUpdates.clear();
      for (const [entry, record] of pending) if (byNode.get(entry.node) === entry) {
        updateRecord(entry, record.book, record.style, record.coverUrl);
      }
      inspectionOverview = null;
      shelfSnapshotDirty = shadowDirty = true;
      canvas.dataset.inspectionPendingEntries = '0';
    }
    const furnitureMoving = sceneView.turning || sceneView.reordering;
    let scrollPan = null;
    if (sceneView.turning) {
      // Driver compilation or a slow frame must not consume the entire camera
      // move without painting its intermediate poses. Match the bounded clock
      // already used by the insertion and trash animations.
      scrollPan = sceneView.stepTurn(now);
      scroller.scrollTop = scrollPan;
    }
    if (sceneView.reordering) {
      const amount = sceneView.stepReorder(now);
      for (const item of reorderItems) { item.entry.offset.x = item.x * amount; item.entry.offset.y = item.y * amount; }
      if (!sceneView.reordering) reorderItems = [];
    }
    const zoom = updateTransform();
    // Expanding/shrinking the stage can change the browser's maximum scroll
    // during a turn. Apply the same frame's pan after committing its height.
    if (scrollPan !== null) scroller.scrollTop = scrollPan;
    else if (sceneView.progress === 1) scroller.scrollTop = 0;
    const { scroll, ratio } = viewport();
    updateCatalog(scroll);
    // The booklet's visibility depends on the view, known only now.
    if (catalog && programsReady !== true && !catalogPrelinked) {
      catalogPrelinked = true;
      prelinkPrograms(renderer, scene, camera, [catalog]);
    }
    const finishedInsertions = [];
    const { moving, shelfMoving } = updateEntries(scroll, zoom, now, finishedInsertions);
    const finishedDrops = [];
    const trashMoving = updateTrash(scroll, now, finishedDrops);
    // The opaque reader page masks layout preparation. Retain the dirty
    // room until its hidden return slot and the same 3D page are both ready.
    if (paintHeld) {
      drawPending = true;
      unpainted.push(...finishedInsertions, ...finishedDrops);
      return;
    }
    casterIds.length = 0;
    for (const entry of bookEntries) if (entry.model?.visible) casterIds.push(entry.model.id);
    const casters = rust.scene_casters(Boolean(trash?.visible), Float64Array.from(casterIds));
    const contentDirty = shadowDirty || shelfMoving || trashMoving || casters !== shadowCasters;
    const lampRefresh = lampLighting.update(bookEntries, { scroll, viewportHeight:sceneView.viewportHeight,
      shadowDirty:contentDirty, transform:furniture.matrixWorld });
    const lampPower = lampLighting.activePower ?? (lampLighting.activeCount ? 1 : 0);
    const nextDaylight = rust.scene_daylight(lampPower, shelfType === 'baggebo');
    if (nextDaylight !== daylightFactor) {
      daylightFactor = nextDaylight;
      for (const { light, intensity } of daylight) light.intensity = intensity * daylightFactor;
      scene.environmentIntensity = daylightEnvironment * daylightFactor;
      shelfSnapshotDirty = true;
    }
    if (lampLighting.shadowRefresh) renderer.shadowMap.needsUpdate = true;
    const qualityHold = rust.scene_quality_hold(bookEntries,qualityPaintState,sceneView,
      batchQuality && inspectionSnapshotVisible && !moving && !shelfMoving && !trashMoving,performance.now());
    if (qualityHold > 0) {
      drawPending = true; unpainted.push(...finishedInsertions,...finishedDrops);
      qualityHoldTimer ||= setTimeout(() => { qualityHoldTimer = 0; invalidate(false); },qualityHold);
      return;
    }
    clearTimeout(qualityHoldTimer); qualityHoldTimer = 0;
    // The models and lamp lights now exist: link their programs in parallel
    // instead of one blocking link per material inside the first render.
    if (programsStale) { programsStale = false; if (programsReady === true) programsReady = null; }
    if (programsReady !== true) {
      programsReady ||= compilePrograms(renderer, scene, camera);
      if (!programsReady()) {
        // Animations that finished on this unpainted frame resolve after the next painted one.
        unpainted.push(...finishedInsertions, ...finishedDrops);
        drawPending = true;
        programsPoll ||= setTimeout(pollPrograms, 10); return;
      }
      programsReady = true;
      // The first frame never draws the drop guide or the return's depth
      // pass: link and reflect them in idle slices after the first paint,
      // before the return needs their first real draw.
      nativeFrameCache?.prepareUniforms?.({ idle:idleSlice, current:() => !disposed })
        .catch(error => console.warn('No se pudo preparar la composición de la sala:', error));
      prepareInsertionPrograms(renderer, scene, camera, [dropGuide, ...depthWriters], {
        idle:idleSlice, current:() => !disposed, onLinked:() => {
          // Compilation changes the real program cache without painting. Report
          // it now so the next resize/gesture does not appear to create programs
          // that were already prepared in the background. No extra render.
          setData(canvas, 'scenePrograms', String(renderer.info?.programs?.length || 0));
        }
      }).catch(error => console.warn('No se pudo preparar la inserción 3D:', error));
    }
    const veneerWait = veneerWaits && shelfType !== 'baggebo' ? veneerDeadline - performance.now() : 0;
    if (veneerWait > 0) {
      unpainted.push(...finishedInsertions, ...finishedDrops);
      drawPending = true;
      veneerTimer ||= setTimeout(() => { veneerTimer = 0; invalidate(false); }, veneerWait);
      return;
    }
    // Keep the last finger frame visible while exact quality shaders link.
    // Reveal the native room only when this transaction can really paint.
    if (batchQuality) hideInspectionSnapshot();
    // Fit the key's shadow to the cabinet (and bin) in world space; the
    // lighting clips it to the camera window, so each texel covers less.
    if (trash) {
      const { min, max } = trashBounds, { position } = trash;
      binBox.set([min.x, min.y, min.z, max.x, max.y, max.z, position.x, position.y, position.z]);
    }
    sceneView.shadowBounds(trash ? binBox : NO_NUMBERS, furniture.matrixWorld.elements, shadowOut);
    shadowBounds.min.set(shadowOut[0], shadowOut[1], shadowOut[2]); shadowBounds.max.set(shadowOut[3], shadowOut[4], shadowOut[5]);
    // Scrolling creates and releases culled models: those change the casters.
    const shadowMotion = furnitureMoving || shelfMoving || trashMoving;
    const shadowRefresh = lighting.update({ width:sceneWidth, viewportHeight:sceneView.viewportHeight, scroll, depth, bounds:shadowBounds,
      dirty:contentDirty, moving:shadowMotion, transform:furniture.matrixWorld,
      forceRefit:sceneView.shadowRefit && !sceneView.moving });
    if (!sceneView.moving) sceneView.shadowRefit = false;
    shadowDirty = false; shadowCasters = casters;
    const overlayInsertion = bookEntries.some(entry => entry.insertion?.overlayCanvas);
    // Its hidden slot and neighbors are already painted. Reuse that snapshot
    // during a stationary insertion instead of reallocating the shared GPU
    // buffer between the smaller shelf and full-screen output every frame.
    if (!overlayInsertion || shelfSnapshotDirty || shadowRefresh || lampRefresh || furnitureMoving || shelfMoving || trashMoving) {
      const cacheInspection = inspectionContext && sceneView.progress === 1 && !furnitureMoving && !moving && !shelfMoving &&
        !trashMoving && !overlayInsertion && !sceneView.hasDrop;
      const refreshOverview = cacheInspection && sceneView.zoom === 1 && sceneView.panX === 0 && sceneView.panY === 0 && inspectionOverviewContext &&
        !bookEntries.some(entry => entry.lift.value || entry.flags.pressed);
      // About a finger's width beyond every edge lets an already zoomed view
      // pan for many frames before rebasing. The complete room is still drawn,
      // including the wall and every object that can enter that extra area.
      // A multiple of four lands the clipped overscan on whole device pixels
      // at every usual ratio (1, 1.25, 1.5, 2, 2.5), so it is shown uncomposed.
      sceneView.capturePlan(Boolean(cacheInspection), ratio, frameLayout.canvas ? frameLayout.canvas.left : NaN,
        frameLayout.canvas ? frameLayout.canvas.top : NaN, captureOut);
      const margin = captureOut[0], renderWidth = captureOut[1], renderHeight = captureOut[2], grid = captureOut[3];
      const descriptor={x:0,y:0,width:renderWidth,height:renderHeight,ratio};
      const nativeCaptureAligned=nativeRoomLease && (grid & 1) && (grid & 2) &&
        (nativeFrameCache.exactFrame?.(descriptor) ?? true);
      const nativeCapturePhysical=!nativeCaptureAligned && nativeRoomLease && (grid & 4) && physicalRoomFrame(renderWidth,renderHeight,ratio);
      // Keep the last insertion visible across held-paint/program guards.
      // Release it only when this transaction really paints the legacy room.
      if(!nativeCaptureAligned && !nativeCapturePhysical)releaseCompletedLegacyInsertions();
      withRendererPresentation(renderer,nativeRoomLease,()=>{
      configureShelfRendererSize(renderer, renderWidth, renderHeight, ratio, rendererSize);
      // Fractional legacy captures keep Three's original viewport rounding.
      // Reassert the retained framebuffer only when it has exact pixel bounds.
      if(nativeCaptureAligned)renderer.setViewport(0,0,renderWidth,renderHeight);
      if (cacheInspection) {
        inspectionCamera.copy(camera);
        inspectionCamera.left -= margin; inspectionCamera.right += margin;
        inspectionCamera.top += margin; inspectionCamera.bottom -= margin;
        inspectionCamera.updateProjectionMatrix();
      }
      renderer.render(scene, cacheInspection ? inspectionCamera : camera);
      // A fitted fine and overview retain exactly the same resolved pixels.
      // Preserve an older overview before changing a shared fine texture;
      // subsequent fine paints can reuse their separate slot. The retained
      // frame also tracks the slot after a legacy fallback clears the export.
      const preserveOverview=cacheInspection && !refreshOverview && nativeFrameCache?.validFrame(nativeOverviewExportFrame) &&
        nativeOverviewExportFrame.texture===nativeFineFrame?.texture;
      const fineSlotIndex=preserveOverview?1-nativeFineSlotIndex:nativeFineSlotIndex;
      // The render above keeps the original fractional viewport and camera.
      // Capture its observed resolved buffer; never round it up to the 2D size.
      const captureDescriptor=nativeCaptureAligned?descriptor:nativeCapturePhysical &&
        {...nativeCapturePhysical,pixelWidth:renderer.getContext().drawingBufferWidth,pixelHeight:renderer.getContext().drawingBufferHeight};
      const nativeFrame=captureDescriptor && nativeFrameCache.capture(cacheInspection?nativeFineSlots[fineSlotIndex]:nativeRoomSlot,captureDescriptor);
      if(nativeFrame && cacheInspection) { nativeFineSlotIndex=fineSlotIndex;nativeFineFrame=nativeFrame; }
      if(nativeFrame) {
        nativeFrameCache.prepare();
        nativeBaseFrame=nativeFrame;nativeBaseMargin=margin;
        nativeRoomDisplay={frame:nativeFrame,margin};nativeRoomLease.markDirty();
      } else {
        nativeBaseFrame=nativeRoomDisplay=null;
        releaseCompletedLegacyInsertions();
        nativeRoomLease?.release({snapshot:false});
        if(nativeRoomClip)nativeRoomClip.style.display='none';
        context.clearRect(0,0,canvas.width,canvas.height);
      }
      if (cacheInspection) {
        const snapshotWidth = Math.ceil(renderWidth * ratio), snapshotHeight = Math.ceil(renderHeight * ratio);
        if (inspectionCanvas.width !== snapshotWidth) inspectionCanvas.width = snapshotWidth;
        if (inspectionCanvas.height !== snapshotHeight) inspectionCanvas.height = snapshotHeight;
        if(nativeFrame) {
          nativeInspectionExportFrame=nativeFrame;nativeInspectionRevision++;
        } else {
          nativeInspectionExportFrame=null;
          inspectionContext.clearRect(0,0,inspectionCanvas.width,inspectionCanvas.height);
          inspectionContext.drawImage(renderer.domElement,0,0,inspectionCanvas.width,inspectionCanvas.height);
          context.drawImage(inspectionCanvas,margin*ratio,margin*ratio,canvas.width,canvas.height,0,0,canvas.width,canvas.height);
        }
        const logicalBounds = frameLayout.canvas, stageBounds = frameLayout.stage;
        Object.assign(inspectionCanvas.style, { left:`${logicalBounds.left - stageBounds.left}px`,
          top:`${logicalBounds.top - stageBounds.top}px`, width:`${renderWidth}px`, height:`${renderHeight}px` });
        inspectionSnapshot = { zoom:sceneView.zoom, panX:sceneView.panX, panY:sceneView.panY, furnitureZoom:zoom, margin, width:renderWidth, height:renderHeight,
          nativeFrame:nativeFrame || null };
        if (refreshOverview) {
          if (inspectionOverviewCanvas.width !== inspectionCanvas.width) inspectionOverviewCanvas.width = inspectionCanvas.width;
          if (inspectionOverviewCanvas.height !== inspectionCanvas.height) inspectionOverviewCanvas.height = inspectionCanvas.height;
          let overviewFrame=null;
          if(nativeFrame) {
            overviewFrame=nativeFrame;
            nativeOverviewExportFrame=overviewFrame;nativeOverviewRevision++;
          } else {
            nativeOverviewExportFrame=null;
            inspectionOverviewContext.clearRect(0,0,inspectionOverviewCanvas.width,inspectionOverviewCanvas.height);
            inspectionOverviewContext.drawImage(inspectionCanvas,0,0);
          }
          Object.assign(inspectionOverviewCanvas.style, { left:inspectionCanvas.style.left, top:inspectionCanvas.style.top,
            width:inspectionCanvas.style.width, height:inspectionCanvas.style.height });
          inspectionOverview = { ...inspectionSnapshot,nativeFrame:overviewFrame };
        }
        setData(canvas, 'inspectionSnapshotResolution', JSON.stringify([inspectionCanvas.width, inspectionCanvas.height]));
      } else {
        inspectionSnapshot = null;
        if(!nativeFrame)context.drawImage(renderer.domElement,0,0,canvas.width,canvas.height);
      }
      // A released or transferred lease keeps its previous opacity to avoid
      // exposing stale book snapshots. This canvas now contains fresh legacy
      // room pixels, so the fallback explicitly makes that output visible.
      if(!nativeFrame)canvas.style.opacity='';
      if(nativeFrame) {
        if(margin && !repaintNativeRoom())throw new Error('Native room cannot preserve its visible pixels');
        const owner=currentNativeRendererPresentation(renderer);
        const insertionActive=bookEntries.some(entry=>entry.insertion?.nativePresentation);
        // Hidden preparation can update the room while the native return still
        // owns the canvas. The broker restores that book after this capture.
        // Only the semantic final restore transfers a completed insertion.
        if(!insertionActive) {
          const presented=owner===nativeRoomLease?nativeRoomLease.present():!owner?nativeRoomLease.present():
            owner.role==='shelf-insertion' && owner.transferTo(nativeRoomLease);
          if(!presented && (!owner || owner===nativeRoomLease))throw new Error('Native room cannot preserve its viewport');
        }
        setData(canvas,'nativeRoomPresentation','true');
      } else setData(canvas,'nativeRoomPresentation','false');
      completedLegacyInsertionLeases.clear();
      });
      releaseUnusedNativeRoomFrames();
      setData(canvas, 'snapshotRenderCount', String(++shelfSnapshotRenders));
      setData(canvas, 'sceneDrawCalls', String(renderer.info?.render.calls || 0));
      shelfSnapshotDirty = false;
      paintedModalView = { progress:sceneView.progress, inspectionZoom:sceneView.zoom, panX:sceneView.panX, panY:sceneView.panY };
      // Record only a completed room transaction, after GPU/native/legacy
      // output succeeded. A flush can return while programs or paint are held.
      paintedAwayEntries.clear();
      for (const entry of bookEntries) if (entry.flags.away && entry.model && !entry.model.visible &&
        !entry.insertion && !entry.trashDrop) paintedAwayEntries.add(entry);
    }
    for (const entry of bookEntries) if (entry.insertion?.overlayCanvas) paintInsertionOverlay(entry);
    setData(canvas, 'renderCount', String(++renderCount));
    // One pass over the entries serves every count below, taken in Rust.
    countIo.length = 0;
    for (const entry of bookEntries) {
      const model = entry.model;
      countIo.push(entry.kind === 'plant' ? 1 : entry.kind === 'lamp' ? 2 : 0, model?.visible ? 1 : 0, entry.qualityReplacement || entry.plantQuality ? 1 : 0,
        model?.userData.overview ? 1 : 0, model?.userData.inspectionResolution);
    }
    const resolutionText = rust.scene_counts(Float64Array.from(countIo), countOut);
    const [plants, highPlants, lamps, overview, detailed, highBooks, pending] = countOut;
    setData(canvas, 'activePlants', String(plants));
    setData(canvas, 'highResolutionPlants', String(highPlants));
    setData(canvas, 'activeLamps', String(lamps));
    setData(canvas, 'lampLightCount', String(lampLighting.activeCount));
    setData(canvas, 'activeLampLights', String(lampLighting.activeCount));
    setData(canvas, 'lampShadowCount', String(lampLighting.shadowCount));
    setData(canvas, 'lampLightTemperature', '2700');
    setData(canvas, 'overviewBooks', String(overview));
    setData(canvas, 'highResolutionBooks', String(highBooks));
    setData(canvas, 'bookTextureResolutions', resolutionText);
    setData(canvas, 'sceneGeometries', String(renderer.info?.memory?.geometries || 0));
    setData(canvas, 'sceneTextures', String(renderer.info?.memory?.textures || 0));
    setData(canvas, 'scenePrograms', String(renderer.info?.programs?.length || 0));
    setData(canvas, 'inspectionOverviewReady', String(Boolean(inspectionOverview)));
    setData(canvas, 'pixelRatio', String(ratio));
    setData(canvas, 'detailedBooks', String(detailed));
    setData(canvas, 'bookQualityPending', String(pending));
    setData(canvas, 'shadowMapSize', '1024');
    let cabinet = null;
    for (const object of furniture.children) if (object.userData.furniture) { cabinet = object; break; }
    setData(canvas, 'furnitureMeshes', String(cabinet?.children.length || 0));
    setData(canvas, 'plantGeometry', 'catalog-3d');
    setData(canvas, 'animating', String(Boolean(sceneView.turning || sceneView.reordering || moving || trashMoving || sceneView.moving)));
    lastSceneMoving = Boolean(sceneView.turning || sceneView.reordering || moving || trashMoving);
    if (settleBooks && physicsReady && !lastSceneMoving && !sceneView.moving &&
      !bookEntries.some(entry => entry.insertion || entry.trashDrop || entry.landing || entry.preview.active)) {
      const saved = bookGravity.snapshot();
      if (saved !== undefined && saved !== null) { try { localStorage.setItem(physicsStorageKey, saved); } catch {} }
    }
    paintedViewport = { width:window.innerWidth, height:window.innerHeight,
      ratio:window.devicePixelRatio || 1, clientHeight:scroller.clientHeight, scrollTop:scroller.scrollTop };
    for (const resolve of unpainted.splice(0)) resolve();
    for (const resolve of finishedInsertions) resolve();
    for (const resolve of finishedDrops) resolve();
    // Prepare one already visible book only after a stable room frame. The
    // flyout keeps its own persistent renderer; shader work no longer has to
    // begin with the user's first selection. No scene pixels are repainted.
    if (!bookPresentationScheduled && canPreparePresentation()) {
      const entry = bookEntries.find(entry => entry.model?.visible &&
        typeof entry.model.userData.preparePresentation === 'function');
      if (entry) {
        bookPresentationScheduled = true;
        const model = entry.model;
        const current = () => !disposed &&
          entry.model === model && model.visible && canPreparePresentation();
        void (async () => {
          let prepared = false;
          try {
            if (!await model.userData.preparePresentation(idleSlice, current) || !current()) return;
            prepared = typeof model.userData.prepareDetailPresentation !== 'function' ||
              await model.userData.prepareDetailPresentation(idleSlice, current);
          } catch (error) {
            console.warn('No se pudo preparar el libro en reposo:', error);
          } finally {
            // A busy/hidden owner or failed driver can cancel either phase.
            // Permit another already-required stable paint to retry; settling
            // background preparation must never schedule a frame of its own.
            if (!prepared && !disposed) bookPresentationScheduled = false;
          }
        })();
      }
    }
    // One more frame after any motion redraws its cheaper shadow at full quality.
    if (sceneView.turning || sceneView.reordering || moving || trashMoving || (lighting.settling && !sceneView.moving)) invalidate(false);
  }

  function noteInspectionDirty(source) {
    setData(canvas, 'inspectionDirtySource', source);
    canvas.dataset.inspectionDirtyCount = String(++inspectionDirtyCount);
  }

  function invalidate(dirty = true, preserveInspectionOverview = false, source = '') {
    if (disposed) return;
    if (dirty && preserveInspectionOverview && sceneView.moving) {
      // A decoded quality replacement stays pending while the captured image
      // follows the fingers. Its ready flag is applied by the settled paint.
      inspectionQualityDirty = true;
      return;
    }
    if (dirty) {
      noteInspectionDirty(source || (dirty?.type ? `event:${dirty.type}` : preserveInspectionOverview ? 'quality' : 'invalidate'));
      shelfSnapshotDirty = shadowDirty = true;
      if (!preserveInspectionOverview) inspectionOverview = null;
    }
    drawPending = true;
    if (!disposed && !raf && !paintHeld && !pageSuspended && document.visibilityState !== 'hidden' && (canPresent() || hasOngoingMotion()) && !canDeferModalPaint()) raf = requestAnimationFrame(draw);
  }

  function canDeferModalPaint() {
    const selected = modalDeferredEntry || (!canPresent() ? inactiveModalEntry : null);
    if (!selected || !bookEntries.includes(selected) || !paintedAwayEntries.has(selected) ||
      !selected.node?.classList.contains('is-away') || !selected.model || selected.model.visible ||
      selected.insertion || selected.trashDrop || programsReady !== true || paintHeld || unpainted.length ||
      lighting.settling || sceneView.turning || sceneView.reordering || sceneView.trashEasing || sceneView.moving || sceneView.hasDrop ||
      !paintedModalView || paintedModalView.progress !== sceneView.progress ||
      paintedModalView.inspectionZoom !== sceneView.zoom || paintedModalView.panX !== sceneView.panX || paintedModalView.panY !== sceneView.panY ||
      modalViewportChanged()) return false;
    const now = performance.now();
    for (const entry of bookEntries) {
      if (entry.insertion || entry.trashDrop || entry.landing || entry.preview.active) return false;
      if (entry.lampTint?.moving()) return false;
      if (entry.lampPower && (entry.lampPower.value !== entry.lampPower.target ||
        entry.lampPower.from !== entry.lampPower.target && now < entry.lampPower.started + entry.lampPower.duration)) return false;
      // Its pressure lift is no longer visible in the already painted slot.
      // Every other entry retains its actual lift/drag frames and endpoint.
      if (entry !== selected) {
        const target = entry.node?.matches('.is-dragging, .is-lifted') ? 1
          : entry.node?.classList.contains('is-pressed') && !entry.node.classList.contains('is-press-pending') ? .22 : 0;
        if (entry.lift.value !== target) return false;
      }
    }
    return true;
  }

  function modalViewportChanged() {
    // Home is hidden before its presentation value changes. display:none
    // collapses its clientHeight, scrollTop and all descendant rectangles;
    // these are not a new camera window for an inactive stationary modal.
    // Keep actual window orientation/DPR changes and all visible geometry
    // authoritative through the original viewport check.
    if (canPresent() || !scroller.closest('[hidden]')) return viewportChanged();
    return !paintedViewport || paintedViewport.width !== window.innerWidth ||
      paintedViewport.height !== window.innerHeight ||
      paintedViewport.ratio !== (window.devicePixelRatio || 1);
  }

  function canPresent() {
    return presentationActive && !pageSuspended && document.visibilityState !== 'hidden';
  }

  function canPreparePresentation() {
    // Pointer classes change before the next scene frame updates its motion
    // flags. Idle work must yield immediately, including a held book that has
    // finished lifting and a compositor-only inspection gesture.
    return !disposed && canPresent() && !paintHeld && !sceneView.moving && !sceneView.hasDrop &&
      !hasOngoingMotion() && !canDeferModalPaint() &&
      !bookEntries.some(entry => entry.node?.matches('.is-pressed, .is-lifted, .is-dragging'));
  }

  // Do not interrupt an owner's actual flight, insertion or camera turn when
  // a screen changes. Only stationary background repaints are deferred; their
  // dirty image/shadow/projection state survives until the screen is visible.
  function hasOngoingMotion() {
    return Boolean(sceneView.turning || sceneView.reordering || sceneView.trashEasing || lastSceneMoving || lighting.settling ||
      bookEntries.some(entry => entry.insertion && !entry.insertion.complete || entry.trashDrop && !entry.trashDrop.complete));
  }

  function presentationChanged() {
    if (disposed) return;
    if (pageSuspended || document.visibilityState === 'hidden' || !canPresent() && !hasOngoingMotion()) {
      if (raf) drawPending = true;
      releaseUnusedNativeRoomFrames();
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      if (programsPoll) clearTimeout(programsPoll);
      programsPoll = 0;
    } else if (canPresent() && !drawPending && viewportChanged()) invalidate(true, false, 'presentation-viewport');
    else if (drawPending) invalidate(false);
  }

  function viewportChanged() {
    if (!paintedViewport || !frameLayout.stage || !frameLayout.scroller || !frameLayout.canvas) return true;
    if (paintedViewport.width !== window.innerWidth || paintedViewport.height !== window.innerHeight ||
      paintedViewport.ratio !== (window.devicePixelRatio || 1) || paintedViewport.clientHeight !== scroller.clientHeight ||
      paintedViewport.scrollTop !== scroller.scrollTop) return true;
    for (const [node, previous] of [[stage,frameLayout.stage],[scroller,frameLayout.scroller],[canvas,frameLayout.canvas]]) {
      const current = node.getBoundingClientRect();
      if (['left','top','width','height'].some(key => current[key] !== previous[key])) return true;
    }
    return false;
  }

  function flushScene({ force = false } = {}) {
    if (disposed) return false;
    // A caller can write is-away/drag variables and need the new projection
    // in the same task, before MutationObserver's asynchronous notification.
    observeEntryChanges(mutations.takeRecords());
    if (themeChanges.takeRecords().length) { updateWoodTheme(); invalidate(true, false, 'theme'); }
    if (pageSuspended || document.visibilityState === 'hidden') return false;
    if (!force && (!canPresent() && !hasOngoingMotion() || canDeferModalPaint())) return false;
    if (!force && !drawPending && viewportChanged()) invalidate(true, false, 'viewport-sync');
    if (!force && !drawPending && !hasOngoingMotion()) return false;
    if (force) { inspectionOverview = null; shelfSnapshotDirty = shadowDirty = true; }
    cancelAnimationFrame(raf); raf = 0;
    draw(performance.now(), force);
    return true;
  }
  // Repaint the camera's new window; the shadow map is reused.
  function scrolled() {
    noteInspectionDirty(`scroll:${scroller.scrollTop}`);
    shelfSnapshotDirty = true;
    invalidate(false);
  }

  function animateObjectToTrash(node, { duration = 850 } = {}) {
    const entry = byNode.get(node);
    if (!entry || !trash || disposed) return null;
    inspectionOverview = null;
    cancelAnimationFrame(raf); raf = 0; draw();
    if (!sceneView.isometric || trashNode.hidden || !trash.visible) return null;
    cancelInsertion(entry); cancelTrashDrop(entry);
    if (!entry.model) { entry.model = makeModel(entry); furniture.add(entry.model); }
    furniture.updateMatrixWorld(true); entry.model.updateMatrixWorld(true);
    scene.attach(entry.model);
    let resolve;
    const finished = new Promise(done => { resolve = done; });
    const now = performance.now();
    const drop = { resolve, settled:false, complete:false, started:now, lastFrame:now, elapsed:0,
      duration:reducedMotion.matches ? 0 : Math.max(0, Number(duration) || 0),
      start:entry.model.position.clone(), startScale:entry.model.scale.x,
      startQuaternion:entry.model.quaternion.clone(), endQuaternion:new THREE.Quaternion(),
      bookQuaternion:new THREE.Quaternion().setFromEuler(new THREE.Euler(-.22, .18, -.46)),
      initialOpenness:Number(trash.userData.openness) || 0 };
    entry.trashDrop = drop; entry.model.visible = true; inspectionOverview = null;
    shelfSnapshotDirty = shadowDirty = true;
    cancelAnimationFrame(raf); raf = 0; draw(now);
    drop.lastFrame = performance.now();
    return { finished, get lastFrameTime() { return drop.lastFrame; }, cancel() {
      if (entry.trashDrop !== drop) return;
      cancelTrashDrop(entry); sceneView.trashCancelDrop(trash.userData.openness, performance.now());
      shelfSnapshotDirty = shadowDirty = true;
      if (!disposed) { cancelAnimationFrame(raf); raf = 0; draw(); }
    } };
  }
  let mutationBatch = 0;
  function observeEntryChanges(records) {
    let changed = false, pressureOnly = true;
    mutationBatch++;
    for (const record of records) {
      const entry = byNode.get(record.target);
      if (!entry) continue;
      entry.domDirty = true;
      // Several records of one node describe the same final state: judge it once.
      if (entry.seen === mutationBatch) continue;
      entry.seen = mutationBatch;
      const next = stateFor(entry);
      if (next === entry.state) continue;
      changed = true;
      pressureOnly &&= rust.scene_pressure_only(entry.state, next);
    }
    if (changed) invalidate(true, pressureOnly, pressureOnly ? 'state:pressure' : 'state:geometry');
  }
  const mutations = new MutationObserver(observeEntryChanges);
  const themeChanges = new MutationObserver(() => { updateWoodTheme(); invalidate(true, false, 'theme'); });
  themeChanges.observe(document.documentElement, { attributes:true, attributeFilter:['data-theme'] });
  for (const node of byNode.keys()) mutations.observe(node, { attributes:true, attributeFilter:['class', 'style', 'disabled'] });
  scroller.addEventListener('scroll', scrolled, { passive:true });
  window.addEventListener('resize', invalidate, { passive:true });
  const pageHidden = () => { pageSuspended = true; presentationChanged(); };
  const pageShown = () => { pageSuspended = false; presentationChanged(); };
  window.addEventListener('pagehide', pageHidden);
  window.addEventListener('pageshow', pageShown);
  document.addEventListener('visibilitychange', presentationChanged);
  updateWoodTheme();
  draw();
  refreshCanvasFontsAfterPaint(refreshBookFonts);

  const inspectionOut = new Float64Array(7);
  function getInspectionView() {
    const rect=canvas.getBoundingClientRect();
    sceneView.inspectionView(rect.left,rect.top,inspectionOut);
    return {zoom:inspectionOut[0],panX:inspectionOut[1],panY:inspectionOut[2],width:inspectionOut[3],height:inspectionOut[4],
      centerX:inspectionOut[5],centerY:inspectionOut[6]};
  }

  return {
    canvas,
    getNativeRoomBackground,
    setModalBackgroundDeferred(node, { resumeHidden = false } = {}) {
      const previous = modalDeferredEntry;
      const entry = node ? byNode.get(node) : null;
      modalDeferredEntry = entry && entry.kind !== 'plant' && entry.kind !== 'lamp' ? entry : null;
      // Releasing a flyout after Home became inactive must not revive its
      // hidden pressure lift as a stationary room render. Back/cancel can
      // explicitly acquire the pending room before return preparation.
      if (modalDeferredEntry || resumeHidden) inactiveModalEntry = null;
      else if (previous) inactiveModalEntry = previous;
      if (canDeferModalPaint()) {
        cancelAnimationFrame(raf); raf = 0;
      } else if (drawPending || viewportChanged()) invalidate(false);
    },
    setPaintHeld(value) {
      paintHeld = Boolean(value);
      if (paintHeld) { cancelAnimationFrame(raf); raf = 0; }
      else if (drawPending) invalidate(false);
    },
    setPresentationActive(value) {
      presentationActive = Boolean(value);
      presentationChanged();
    },
    getInspectionZoom:()=>sceneView.zoom,
    beginInspectionGesture() {
      if (disposed || !sceneView.canInspect()) return;
      sceneView.beginGesture();
      if (!inspectionOverview || sceneView.reordering || sceneView.trashEasing || sceneView.hasDrop) return;
      const now = performance.now();
      // A second finger changes a tentative book tap into navigation. Cancel
      // only the tiny pressure feedback; held books, returns, previews and
      // lamp fades keep their actual physics and demand frames.
      const stationary = bookEntries.every(entry => !entry.insertion && !entry.trashDrop && !entry.landing &&
        !entry.preview.active && !entry.node?.matches('.is-pressed, .is-lifted, .is-dragging') &&
        [entry.lift.value, entry.lift.from, entry.lift.target].every(value => Math.abs(value) <= .220001) &&
        !entry.lampTint?.moving() &&
        !(entry.lampPower?.duration && entry.lampPower.from !== entry.lampPower.target &&
          now < entry.lampPower.started + entry.lampPower.duration));
      if (!stationary) return;
      const pressure = bookEntries.some(entry => entry.lift.value || entry.lift.from || entry.lift.target);
      if (pressure) inspectionSnapshot = null;
      for (const entry of bookEntries) {
        Object.assign(entry.lift, { value:0, from:0, target:0, started:now });
        entry.state = stateFor(entry);
      }
      lastSceneMoving = false;
      shelfSnapshotDirty = shadowDirty = false;
      sceneView.shadowRefit = true;
      cancelAnimationFrame(raf); raf = 0;
    },
    setLampPower(node, isOn, { animate = true } = {}) {
      const entry = byNode.get(node);
      if (disposed || entry?.kind !== 'lamp') return;
      noteInspectionDirty('lamp-power');
      const previous = entry.lampPower?.value ?? entry.model?.userData.lightEmitter?.power ?? (entry.isOn === false ? 0 : 1);
      entry.isOn = isOn !== false;
      inspectionOverview = null;
      const target = entry.isOn ? 1 : 0;
      entry.lampPower = { value:previous, from:previous, target, started:performance.now(),
        duration:animate && !reducedMotion.matches ? 220 : 0 };
      shelfSnapshotDirty = true;
      invalidate(false);
    },
    setLampKelvin(node, kelvin, { animate = true } = {}) {
      const entry = byNode.get(node);
      if (disposed || entry?.kind !== 'lamp') return;
      noteInspectionDirty('lamp-kelvin');
      entry.kelvin = kelvin;
      const tint = entry.lampTint ||= createTintTransition(entry.kelvin);
      tint.set(kelvin, performance.now(), animate && !reducedMotion.matches);
      inspectionOverview = null; shelfSnapshotDirty = true;
      invalidate(false);
    },
    getInspectionView,
    setInspectionView(view,{moving=false,renderNow=false}={}) {
      if (disposed || !sceneView.canInspect()) return getInspectionView();
      sceneView.setInspection(view.zoom, view.panX, view.panY, Boolean(moving));
      if (pageSuspended || document.visibilityState === 'hidden') { drawPending = true; return getInspectionView(); }
      if (!sceneView.moving && inspectionQualityDirty) {
        inspectionQualityDirty = false; shadowDirty = true;
      }
      if (sceneView.moving && paintInspectionSnapshot()) {
        cancelAnimationFrame(raf); raf = 0;
        return getInspectionView();
      }
      shelfSnapshotDirty = true;
      if (renderNow) { cancelAnimationFrame(raf); raf=0; draw(); }
      else invalidate(false);
      return getInspectionView();
    },
    zoomTo(value,clientX,clientY) {
      if (disposed || !sceneView.canInspect()) return sceneView.zoom;
      const rect = canvas.getBoundingClientRect();
      sceneView.zoomTo(value,clientX,clientY,rect.left,rect.top);
      shelfSnapshotDirty = true; invalidate(false); return sceneView.zoom;
    },
    panBy(x,y) {
      if (disposed || !sceneView.panBy(x,y)) return;
      shelfSnapshotDirty = true; invalidate(false);
    },
    invalidate,
    hitTrash,
    setTrashHover(active) {
      if (!trash || disposed) return;
      if (!sceneView.trashSetHover(Boolean(active), !trashNode.hidden && trash.visible, performance.now())) return;
      invalidate();
    },
    animateObjectToTrash,
    animateBookToTrash:animateObjectToTrash,
    flush:flushScene,
    setMode(next, { animate = true } = {}) {
      const isometric = next === 'isometric';
      const scrollTo = sceneView.setMode(isometric, animate && !reducedMotion.matches, performance.now(), scroller.scrollTop);
      if (!isometric && trash) {
        for (const entry of bookEntries) cancelTrashDrop(entry);
        sceneView.trashReset();
        trash.userData.setState({ openness:0 });
        trashNode.hidden = true; trashNode.inert = true; trashNode.tabIndex = -1;
        trashNode.setAttribute('aria-hidden', 'true'); trashNode.style.pointerEvents = 'none';
      }
      if (!sceneView.turning) {
        // Expanding the frontal stage must happen before restoring its scroll.
        updateTransform(); scroller.scrollTop = scrollTo;
      }
      invalidate();
    },
    getBookPose(node) {
      const entry = byNode.get(node);
      if (!entry || entry.kind === 'plant' || entry.kind === 'lamp') return null;
      const stageRect = stage.getBoundingClientRect();
      return { ...projectShelfBookPose(furniture.matrixWorld, entry.pose.matrix, entry, stageRect),
        rect:entry.rect && { ...entry.rect, left:stageRect.left + entry.rect.left, top:stageRect.top + entry.rect.top,
          right:stageRect.left + entry.rect.right, bottom:stageRect.top + entry.rect.bottom } };
    },
    getReturnPose(node) {
      const entry = byNode.get(node);
      if (!entry || entry.kind === 'plant' || entry.kind === 'lamp' || disposed) return null;
      flushScene();
      const dock = shelfBookInsertion(shelfBookSlot(entry, width), entry.width);
      return projectShelfBookPose(furniture.matrixWorld, dock, entry, stage.getBoundingClientRect());
    },
    returnBook(node, { duration = 180, overlayCanvas = null, nativePresentation = null } = {}) {
      const entry = byNode.get(node);
      if (!entry || entry.kind === 'plant' || entry.kind === 'lamp' || disposed) return null;
      if (nativePresentation && (!overlayCanvas || !nativeFrameCache || !getInsertionRoomBackground() ||
        ![window.innerWidth,window.innerHeight,overlayCanvas.width/window.innerWidth].every(Number.isInteger))) return null;
      inspectionOverview = null;
      cancelInsertion(entry);
      let resolve;
      const finished = new Promise(done => { resolve = done; });
      const insertion = { slot:shelfBookSlot(entry, width), started:performance.now(),
        duration:reducedMotion.matches ? 0 : Math.max(0, Number(duration) || 0), resolve, complete:false, overlayCanvas,
        elapsed:0, lastFrame:performance.now(), nativePresentation };
      if (nativePresentation) {
        insertion.nativeLease = createNativeInsertionLease(insertion);
        if (!insertion.nativeLease) return null;
      }
      entry.insertion = insertion;
      Object.assign(entry.lift, { value:0, from:0, target:0, started:insertion.started });
      // Paint the same dock position before the caller hides its overlay.
      // Neighbors and wood now occlude the moving book in one depth buffer.
      // An overlay book does not change the already painted hidden slot or
      // its shadows. Preserve any actual pending room changes.
      if (!overlayCanvas) shelfSnapshotDirty = shadowDirty = true;
      cancelAnimationFrame(raf); raf = 0; draw(insertion.started);
      insertion.lastFrame = performance.now();
      return { finished, get lastFrameTime() { return insertion.lastFrame; }, cancel() {
        if (entry.insertion !== insertion) return;
        const native = insertion.nativePresentation;
        cancelInsertion(entry);
        const outputContext = native ? native.context : overlayCanvas?.getContext('2d');
        outputContext?.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
        shelfSnapshotDirty = shadowDirty = true;
        if (!disposed) { cancelAnimationFrame(raf); raf = 0; draw(); }
      } };
    },
    getBookAtPoint(clientX, clientY) {
      const node = objectAtPoint(clientX, clientY);
      const entry = node && byNode.get(node);
      return entry && entry.kind !== 'plant' && entry.kind !== 'lamp' ? node : null;
    },
    setObjectGrip(node, clientX, clientY) {
      const entry = byNode.get(node);
      if (!entry?.model || entry.kind === 'plant' || entry.kind === 'lamp') return;
      // Three owns only the ray/matrix conversion. The native solver clamps
      // the local grip and computes its leverage, swing and release torque.
      const hit = pointerRay(clientX, clientY).intersectObject(entry.model, true)[0];
      if (hit) entry.gripHeight = entry.model.worldToLocal(hit.point.clone()).y / entry.height;
      else {
        const bounds = node.getBoundingClientRect();
        entry.gripHeight = bounds.height ? .5 - (clientY - bounds.top) / bounds.height : 0;
      }
    },
    getObjectAtPoint(clientX, clientY) {
      return objectAtPoint(clientX, clientY);
    },
    getDropPosition(clientX, clientY, node = null) {
      const entry = node && byNode.get(node);
      return projectShelfDropPosition(pointerRay(clientX, clientY).ray, furniture.matrixWorld, rows, width,
        entry?.kind === 'lamp' && entry.mount === 'undershelf' ? { mount:'undershelf', depth } : {});
    },
    setDropPosition(position) {
      if (disposed) return;
      const shelf = Number(position?.shelf), x = Number(position?.x);
      if (!sceneView.setDrop(Boolean(position), shelf, x, position?.mount === 'undershelf', rows.length)) return;
      const drop = sceneView.dropState();
      canvas.dataset.dropShelf = drop.length ? String(drop[0]) : '';
      canvas.dataset.dropX = drop.length ? drop[1].toFixed(4) : '';
      canvas.dataset.dropMount = drop[2] ? 'undershelf' : '';
      // This unlit, non-shadow-casting guide changes colour pixels only.
      shelfSnapshotDirty = true; invalidate(false);
    },
    previewPlacements(objects, draggedKey) {
      if (disposed) return;
      const placements = new Map((Array.isArray(objects) ? objects : []).map(object => [String(object.key), object]));
      const now = performance.now();
      let changed = false;
      for (const entry of bookEntries) {
        const objectKey = String(entry.node?.dataset.objectId ?? entry.key);
        const placement = objectKey !== String(draggedKey) ? placements.get(objectKey) : null;
        const row = placement && rows[placement.shelf];
        const center = Number(placement?.center);
        let x = 0, y = 0;
        if (row && Number.isFinite(center)) {
          const undershelf = entry.kind === 'lamp' && entry.mount === 'undershelf';
          rust.scene_preview_target(row.left || 0, undershelf ? row.ceiling ?? row.top : 0, row.bottom, center, entry.x, entry.y, entry.height,
            undershelf, previewTarget);
          x = previewTarget[0]; y = previewTarget[1];
        }
        changed = previewOffset(entry, x, y, now) || changed;
      }
      if (changed) invalidate();
    },
    adoptMetadataRecords(previous, records) {
      if (disposed || !canPresent() || paintHeld || sceneView.moving || hasOngoingMotion() ||
          drawPending || raf || programsPoll || inspectionQualityDirty || inspectionEntryUpdates.size || unpainted.length)
        return false;
      if (renderer.getContext?.()?.isContextLost?.()) return false;
      // Deliver existing observer work without consuming a real invalidation.
      // Projection's own style writes may be pending but do not change state.
      observeEntryChanges(mutations.takeRecords());
      if (themeChanges.takeRecords().length) { updateWoodTheme(); invalidate(true, false, 'theme'); return false; }
      if (drawPending || viewportChanged()) return false;
      const owner = currentNativeRendererPresentation(renderer);
      if (owner && owner !== nativeRoomLease) return false;
      const books = bookEntries.filter(entry => entry.kind !== 'plant' && entry.kind !== 'lamp');
      if (!Array.isArray(records) || records.length !== books.length ||
          bookEntries.some(entry => entry.replacement || entry.plantQuality || entry.insertion || entry.trashDrop || entry.preview.active || entry.landing))
        return false;
      const byId = new Map(books.map(entry => [String(entry.book?.id), entry]));
      if (byId.size !== books.length || !canAdoptShelfMetadata(previous, records)) return false;
      for (const book of previous) {
        const entry = byId.get(String(book.id));
        if (!entry || entry.book !== book || !entry.node?.isConnected || byNode.get(entry.node) !== entry || stateFor(entry) !== entry.state)
          return false;
      }
      // Validation of the entire batch precedes every reference assignment.
      for (const book of records) byId.get(String(book.id)).book = book;
      return true;
    },
    updateEntry(node, book, style, coverUrl) {
      const entry = byNode.get(node);
      if (!entry || entry.kind === 'plant' || entry.kind === 'lamp') return;
      if (sceneView.moving) {
        inspectionEntryUpdates.set(entry, { book, style, coverUrl });
        canvas.dataset.inspectionPendingEntries = String(inspectionEntryUpdates.size);
        return;
      }
      if (updateRecord(entry, book, style, coverUrl)) invalidate(true, false, 'entry');
    },
    updateLayout(next) {
      if (disposed) return false;
      physicsReady = next.physicsReady !== false;
      noteInspectionDirty('layout');
      // A fresh semantic layout already contains the current book records.
      inspectionEntryUpdates.clear(); canvas.dataset.inspectionPendingEntries = '0';
      inspectionOverview = null;
      shelfSnapshotDirty = shadowDirty = true;
      cancelAnimationFrame(raf); raf = 0; mutations.disconnect();
      const oldEntries = new Map(bookEntries.map(entry => [entry.key, entry]));
      const oldWidth = width, oldHeight = height, oldRows = JSON.stringify(rows), oldDepth = depth, oldShelfType = shelfType;
      // Restore only the outgoing DOM. The already painted canvas and GPU
      // resources remain alive while the replacement semantic tree is bound.
      if (next.stage !== stage) {
        stage.style.height = originalHeight;
        stage.style.top = originalTop;
        if (!alreadyScene) stage.classList.remove('has-scene');
        for (const [node, style] of originalStyles) {
          if (style === null) node.removeAttribute('style'); else node.setAttribute('style', style);
          delete node.dataset.sceneProjected;
          delete node.dataset.sceneHitSurface;
          delete node.dataset.sceneLean;
          semanticCovers.get(node)?.remove(); semanticCovers.delete(node);
          // Keep the expensive projected leaf triangles until entries are
          // rebound below. An unchanged plant can move its native hit surface
          // to the replacement semantic button without tessellating again.
          clearPlantDiagnostics(node);
        }
        originalStyles.clear();
        stage = next.stage;
        originalHeight = stage.style.height;
        // Pixel alignment belongs to the DOM stage that actually received it.
        // A replacement has not been shifted: subtracting the outgoing offset
        // would leave its first retained paint at the wrong screen origin.
        originalTop = stage.style.top;
        stagePixelOffset = 0;
        alreadyScene = stage.classList.contains('has-scene');
        stage.classList.add('has-scene');
        stage.prepend(canvas);
        stage.append(inspectionCanvas);
        stage.append(inspectionOverviewCanvas);
        if(nativeRoomClip)stage.append(nativeRoomClip);
      }
      width = next.width; height = next.height; rows = next.rows;
      shelfType = normalizeShelfType(next.shelfType);
      unitWidth = next.unitWidth || width; unitCount = next.unitCount || 1;
      depth = specDepth();
      sceneWidth = Math.max(1, Number(next.sceneWidth) || width);
      sceneView.configure(width, height, sceneWidth, depth, shelfType === 'baggebo');
      const nextTrashNode = next.trashNode || null;
      if (nextTrashNode !== trashNode) {
        restoreTrashNode(trashNode);
        trashNode = nextTrashNode;
        rememberTrashNode(trashNode);
        if (trashNode && !trash) {
          trash = createShelfTrash(); trashBounds = trashFootprint(trash); furniture.add(trash); positionTrash();
        }
        else if (!trashNode && trash) {
          for (const entry of bookEntries) cancelTrashDrop(entry);
          sceneView.trashReset();
          trash.removeFromParent(); trash.userData.dispose(); trash = null; trashBounds = null;
          rebuildOcclusion();
        }
      }
      const nextCatalogNode = next.catalogNode || null;
      if (nextCatalogNode !== catalogNode) {
        restoreCatalogNode(catalogNode);
        catalogNode = nextCatalogNode; rememberCatalogNode(catalogNode);
        if (catalogNode && !catalog) { catalog = createShelfCatalog(); furniture.add(catalog); }
        else if (!catalogNode && catalog) { catalog.removeFromParent(); catalog.userData.dispose(); catalog = null; }
      }
      const retained = [];
      for (let index = 0; index < next.entries.length; index++) {
        const data = next.entries[index], key = entryKey(data, index);
        let entry = oldEntries.get(key);
        if (entry) {
          oldEntries.delete(key);
          if (entry.node !== data.node && entry.node?.classList.contains('is-away')) data.node?.classList.add('is-away');
          if (data.kind === 'plant' || data.kind === 'lamp') {
            const changed = data.kind === 'lamp' ? lampKeys(entry) !== lampKeys(data) : plantKeys(entry) !== plantKeys(data);
            let retainModel = !changed;
            if (changed) {
              const recolored = data.kind === 'plant' && plantShapeKeys(entry) === plantShapeKeys(data) &&
                entry.model?.userData.updatePotColor?.(data.potColorId);
              if (!recolored) releaseEntry(entry);
              else {
                // The model cancelled maps painted with the former color.
                // Clear the scene's handle too, so detail still required by
                // the current inspection can be prepared again this draw.
                entry.plantQuality?.plan.dispose(); entry.plantQuality = null;
                entry.model.userData.shelfPlantKeys = plantKeys(data); retainModel = true;
              }
            }
            if (retainModel && entry.node !== data.node) {
              const native = semanticFoliage.get(entry.node);
              if (native && data.node) {
                semanticFoliage.delete(entry.node);
                // The outgoing node's hit target must cease to exist. Clone
                // its already projected triangles/cache into a fresh target;
                // this preserves native cleanup without reprojecting leaves.
                const svg = native.svg.cloneNode(true);
                native.svg.remove();
                const rebound = { ...native,svg,path:svg.querySelector(':scope > path'),
                  exclusions:svg.querySelector('clipPath path') };
                data.node.append(svg); semanticFoliage.set(data.node,rebound);
              }
            }
            if (entry.node !== data.node) clearPlantDiagnostics(entry.node);
            Object.assign(entry, data); placeBoxes(entry);
          } else { entry.node = data.node; updateRecord(entry, data.book, data.style, data.coverUrl, data); }
        } else { entry = freshEntry(data, index); placeBoxes(entry); }
        // The new layout has already committed the preview's destination.
        // Retaining that offset would apply it twice; captured projected rects
        // are handed to animateFromRects for the remaining release movement.
        entry.preview = freshPreview();
        entry.landing = null;
        // The outgoing DOM was just restored and the new one may be a fresh tree:
        // write every inline value of the projected nodes again and reread its state.
        entry.written = null; entry.domDirty = true;
        entry.key = key;
        retained.push(entry);
        if (entry.node && !originalStyles.has(entry.node)) originalStyles.set(entry.node, entry.node.getAttribute('style'));
      }
      for (const entry of oldEntries.values()) releaseEntry(entry);
      bookEntries = retained; byNode.clear();
      fitDepth(Math.max(155, ...bookEntries.filter(entry => entry.kind !== 'plant' && entry.kind !== 'lamp').map(entry => entry.width + 12),
        ...bookEntries.filter(entry => entry.kind === 'lamp' && entry.mount !== 'undershelf').map(entry => (entry.depth || entry.width) + 12)));
      for (const entry of bookEntries) if (entry.node) {
        byNode.set(entry.node, entry);
        mutations.observe(entry.node, { attributes:true, attributeFilter:['class', 'style', 'disabled'] });
      }
      if (sceneView.reordering) reorderItems = reorderItems.filter(item => retained.includes(item.entry));
      if (width !== oldWidth || height !== oldHeight || depth !== oldDepth || shelfType !== oldShelfType || JSON.stringify(rows) !== oldRows) rebuildFurniture();
      canvas.dataset.layoutUpdates = String(Number(canvas.dataset.layoutUpdates || 0) + 1);
      // Cached replacements can invalidate while records are rebound. This
      // immediate paint includes them; coalesce their queued duplicate frame.
      cancelAnimationFrame(raf); raf = 0;
      draw();
      return true;
    },
    animateFromRects(oldRects, { draggedKey } = {}) {
      if (reducedMotion.matches) return;
      const stageRect = stage.getBoundingClientRect(), items = [];
      for (const entry of bookEntries) {
        const old = oldRects.get(entry.node?.dataset.objectId) || oldRects.get(entry.book?.id) ||
          oldRects.get(entry.node?.dataset.bookId) || oldRects.get(entry.key);
        const targetRect = entry.tapRect || entry.hitRect || entry.rect;
        if (!old || !targetRect) continue;
        const x = old.left - (targetRect.left + stageRect.left), y = old.top - (targetRect.top + stageRect.top);
        if (Math.abs(x) + Math.abs(y) > 1) items.push({ entry, x, y });
      }
      const started = performance.now();
      reorderItems = items; sceneView.beginReorder(started);
      const dragged = draggedKey == null ? null : items.find(item =>
        String(item.entry.node?.dataset.objectId ?? item.entry.key) === String(draggedKey))?.entry;
      if (dragged && dragged.lift.value > 0) {
        dragged.landing = { from:dragged.lift.value, started, duration:520 };
      }
      // Paint the old positions before yielding. Otherwise a synchronous
      // layout replacement can flash its final positions for one frame.
      cancelAnimationFrame(raf); raf = 0; draw(started);
    },
    dispose() {
      stage.style.top = originalTop;
      if (!disposed) bookGravity.free();
      disposed = true; modalDeferredEntry = inactiveModalEntry = paintedModalView = null; paintedAwayEntries.clear();
      cancelAnimationFrame(raf); mutations.disconnect(); themeChanges.disconnect();
      inspectionEntryUpdates.clear();
      scroller.removeEventListener('scroll', scrolled); window.removeEventListener('resize', invalidate);
      document.removeEventListener('visibilitychange', presentationChanged);
      window.removeEventListener('pagehide', pageHidden);
      window.removeEventListener('pageshow', pageShown);
      if (programsPoll) clearTimeout(programsPoll);
      clearTimeout(veneerTimer); clearTimeout(qualityPaintTimer); clearTimeout(qualityHoldTimer);
      for (const entry of bookEntries) releaseEntry(entry);
      releaseCompletedLegacyInsertions();
      for(const unbind of nativeSnapshotBindings)unbind();
      nativeRoomLease?.dispose({snapshot:false});
      nativeFrameCache?.dispose();nativeRoomClip?.remove();
      nativeRoomDisplay=nativeBaseFrame=nativeInspectionExportFrame=nativeOverviewExportFrame=nativeFineFrame=null;
      if (catalog) { catalog.removeFromParent(); catalog.userData.dispose(); }
      trash?.removeFromParent();
      for (const object of [...furniture.children]) if (object.userData.furniture) {
        object.removeFromParent(); object.userData.disposeGeometry?.();
      }
      lampLighting.dispose();
      releaseObject(furniture); texture.dispose(); grain.dispose(); lighting.dispose();
      wood.dispose(); backWood.dispose(); darkWood.dispose();
      for (const material of depthOnly) material.dispose();
      trash?.userData.dispose();
      canvas.remove(); inspectionCanvas.remove(); inspectionCanvas.width = inspectionCanvas.height = 1;
      inspectionOverviewCanvas.remove(); inspectionOverviewCanvas.width = inspectionOverviewCanvas.height = 1;
      inspectionSnapshot = inspectionOverview = null; stage.style.height = originalHeight;
      if (!alreadyScene) stage.classList.remove('has-scene');
      for (const [node, style] of originalStyles) {
        if (style === null) node.removeAttribute('style'); else node.setAttribute('style', style);
        delete node.dataset.sceneProjected;
        delete node.dataset.sceneHitSurface;
        delete node.dataset.sceneLean;
        clearPlantDiagnostics(node);
      }
      for (const node of semanticCovers.values()) node.remove();
      semanticCovers.clear();
      for (const native of semanticFoliage.values()) native.svg.remove();
      semanticFoliage.clear();
      for (const node of trashOriginalStates.keys()) restoreTrashNode(node);
      for (const node of catalogOriginalStates.keys()) restoreCatalogNode(node);
    }
  };
}
