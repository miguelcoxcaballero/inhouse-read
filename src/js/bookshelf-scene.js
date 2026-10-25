Warning: truncated output (original token count: 50369)
Total output lines: 3286

import { createGravityFrame } from './gravity-frame.js';
import { createFoliageFrame } from './foliage-frame.js';
import { createSceneMotionFrame } from './scene-motion-frame.js';
import { createSceneProjectionFrame } from './scene-projection-frame.js';
import { notifyCloudSettingsChanged } from './cloud-settings.js';
import {playShelfSound,shelfSoundsEnabled} from './cozy-sounds.js';
import * as THREE from 'three';
import {plantGeometrySpec,lampGeometrySpec} from './decor-geometry-spec.js';
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
  const foliageFrame = createFoliageFrame(rust);
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
  let bookGravity = new rust.RustBookGravity();
  const roomMotion = new rust.RustRoomMotion();
  const roomTransition = new rust.RustRoomTransition();
  let motionExpiry = null, motionGesture = null, motionSequence = 0, motionSentAt = -Infinity;
  let motionRest = new Map(), motionAffected = new Set(), motionBase = null;
  let roomCheckpoint = '', roomRevision = '', installedRoom = null;
  try { roomCheckpoint = localStorage.getItem('inhouse-read-shelf-physics-v1') || ''; } catch {}
  const roomRecords = () => bookEntries.filter(e => e.book).map(e => e.book);
  function acknowledgeRoom(saved) {
    roomCheckpoint = saved;
    roomRevision = rust.room_physics_revision(saved, roomRecords());
    roomMotion.acknowledge(roomRevision);
  }
  const motionKey = entry => entry.kind === 'plant' || entry.kind === 'lamp' ? entry.key
    : entry.book?.driveFileId ? `book:drive:${entry.book.driveFileId}` : null;
  const sceneMotionFrame = createSceneMotionFrame(rust, motionKey);
  function clearRoomMotion(source = '') {
    roomMotion.clear(source); clearTimeout(motionExpiry); motionExpiry = null;
    if (roomMotion.active(performance.now())) motionExpiry = setTimeout(() => invalidate(true, false, 'remote-motion-expired'), 5050);
    invalidate(true, false, 'remote-motion-ended');
  }
  function publishRoomMotion(now, quiet) {
    const arranging = Boolean(stage.closest('.ihr-bookshelf')?.classList.contains('is-arranging'));
    if (arranging && !motionGesture) {
      acknowledgeRoom(roomCheckpoint);
      roomMotion.clear(''); installedRoom = null; pendingCloudPhysics = null;
      motionBase = roomRevision; motionAffected.clear();
      motionGesture = crypto.randomUUID(); motionSequence = 0; motionSentAt = -Infinity;
    }
    if (!motionGesture) {
      if (quiet && !roomMotion.active(now)) motionRest = new Map(bookEntries.filter(e => e.localMotionPose).map(e => [motionKey(e), e.localMotionPose]));
      return;
    }
    const end = !arranging && quiet;
    if (!end && now - motionSentAt < 50) return;
    const poses = [];
    for (const entry of bookEntries) {
      const row = entry.localMotionPose, previous = motionRest.get(motionKey(entry));
      if (row && (!previous || entry.bits & 6 || row.some((v,i) => i && Math.abs(v - previous[i]) > .000001))) motionAffected.add(row[0]);
      // Each frame is a complete replacement for this gesture's affected set,
      // including a neighbour that moved and then returned to its starting pose.
      if (row && motionAffected.has(row[0])) poses.push(row);
    }
    globalThis.dispatchEvent(new CustomEvent('inhouse-room-motion-local', {detail:{gesture:motionGesture,
      sequence:++motionSequence, phase:end ? 'end' : 'frame', shelfType, poses,
      base:motionBase || undefined, commit:end && motionBase ? roomRevision : undefined}}));
    motionSentAt = now;
    if (end) { motionGesture = null; motionRest = new Map(bookEntries.filter(e => e.localMotionPose).map(e => [motionKey(e), e.localMotionPose])); }
  }
  const physicsStorageKey = 'inhouse-read-shelf-physics-v1';
  let physicsStarted = false, physicsInteracted = false, pendingCloudPhysics = null;
  if (settleBooks) { try { bookGravity.restore(localStorage.getItem(physicsStorageKey) || ''); } catch {} }
  const gravityFrame = createGravityFrame(rust);
  let gravityOutput = gravityFrame.output;
  let bookEntries = entries.map(freshEntry);
  acknowledgeRoom(roomCheckpoint);
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
  let inspectionSnapshot = null, inspectionSnapshotVisible = false, lastSceneMoving = false, lastLocalSceneMoving = false;
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
      clip:{left:0,top:0,right:output.width,bottom:output.heig…30369 tokens truncated…
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

  // Motion continues only while the shelf is presented. An opaque reader
  // owns the screen completely: retain poses/resources and resume on return,
  // without advancing physics or painting an invisible room.
  function hasOngoingMotion() {
    return Boolean(sceneView.turning || sceneView.reordering || sceneView.trashEasing || lastSceneMoving || lighting.settling ||
      bookEntries.some(entry => entry.insertion && !entry.insertion.complete || entry.trashDrop && !entry.trashDrop.complete));
  }

  function presentationChanged() {
    if (disposed) return;
    if (!canPresent()) {
      bookGravity.pause();
      if (raf || hasOngoingMotion()) drawPending = true;
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
    if (!canPresent()) return false;
    if (!force && canDeferModalPaint()) return false;
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
    physicalPlacement: settleBooks,
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
    applyRoomPose() {
      const saved = rust.room_physics_with_local(localStorage.getItem(physicsStorageKey), roomCheckpoint, roomRecords());
      if (!saved || !bookGravity.apply_snapshot(saved)) return false;
      acknowledgeRoom(saved); clearTimeout(motionExpiry); motionExpiry = null;
      invalidate(true, false, 'cloud-room');
      return true;
    },
    applyLiveRoomMotion(packet) {
      if (disposed || packet.shelfType !== shelfType || motionGesture ||
        stage.closest('.ihr-bookshelf')?.classList.contains('is-arranging')) return false;
      if (!roomMotion.receive(packet, performance.now())) return false;
      clearTimeout(motionExpiry);
      motionExpiry = setTimeout(() => { motionExpiry = null; invalidate(true, false, 'remote-motion-expired'); }, 5050);
      if (roomMotion.changed) invalidate(true, false, 'remote-motion'); return true;
    },
    clearLiveRoomMotion:clearRoomMotion,
    isMoving:()=>Boolean(roomMotion.gesturing(performance.now()) || roomTransition.moving(performance.now()) || lastLocalSceneMoving || sceneView.moving || sceneView.turning || sceneView.reordering),
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
      lastSceneMoving = lastLocalSceneMoving = false;
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
    recordBookPointer(node, x, at, phase) {
      const entry = byNode.get(node);
      if (entry && entry.kind !== 'plant' && entry.kind !== 'lamp') bookGravity?.record_pointer(entry.key, x, at, phase);
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
      const dock = shelfBookInsertion(shelfBookSlot(entry, width, settleBooks && physicsStarted ? entry.pose.matrix.elements : null), entry.width);
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
      const insertion = { slot:shelfBookSlot(entry, width, settleBooks && physicsStarted ? entry.pose.matrix.elements : null), started:performance.now(),
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
      const hitPoint = pointerHit?.node === node && pointerHit.clientX === clientX && pointerHit.clientY === clientY
        ? pointerHit.point : pointerRay(clientX, clientY).intersectObject(entry.model, true)[0]?.point;
      if (hitPoint) entry.gripHeight = entry.model.worldToLocal(hitPoint.clone()).y / entry.height;
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
    resolveDropPosition(position, node) {
      if (!position || !settleBooks) return position;
      const entry = byNode.get(node), row = rows[position.shelf];
      if (!entry) return null;
      // Keyboard placement can extend the cabinet with a new, empty row.
      // The planner already validated the index and clamps its horizontal slot.
      if (!row) return Number.isInteger(position.shelf) && position.shelf >= rows.length ? position : null;
      if (entry.kind === 'lamp' && entry.mount === 'undershelf') return position;
      const left = row.left || 0, right = row.right ?? width, padding = row.padding ?? 16;
      const available = right - left - padding * 2;
      const pixelsPerMetre = unitWidth / SHELF_SPECS[shelfType].width * 1000;
      const result = bookGravity.drop_position(entry.key, new Float64Array([
        position.shelf, left + padding + position.x * available, left, right,
        row.bottom, row.ceiling ?? row.top, pixelsPerMetre
      ]));
      return result.length && available > 0
        ? { ...position, x:(result[0] - left - padding) / available } : null;
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
      acknowledgeRoom(roomCheckpoint);
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
      const oldEntries = new Map(bookEntries.map(entry => [entry.key, entry]));
      // A viewport rebuild is a coordinate change, not a physical edit. The
      // old solver otherwise interprets rounded CSS anchors as forces and
      // settles the same shared room differently on every screen.
      const resized = next.width !== width || next.height !== height || (next.unitWidth || next.width) !== unitWidth;
      const samePlacements = resized && next.entries.length === bookEntries.length && next.entries.every((data,index) => {
        const old = oldEntries.get(entryKey(data,index));
        return old && old.shelf === data.shelf && (!data.book ||
          JSON.stringify(old.book?.shelfPosition) === JSON.stringify(data.book.shelfPosition));
      });
      if (!next.cloudRoom && resized && samePlacements && !motionGesture && !physicsInteracted &&
          !lastLocalSceneMoving && roomCheckpoint && normalizeShelfType(next.shelfType) === shelfType)
        pendingCloudPhysics = roomCheckpoint;
      if(next.cloudRoom){
        const ppm=unitWidth/SHELF_SPECS[shelfType].width*1000;
        const painted=bookEntries.filter(e=>motionKey(e)).map(e=>{
          const p=e.pose.position,q=e.pose.quaternion;
          return [motionKey(e),(p.x+width/2)/ppm,p.y/ppm,p.z/ppm,q.x,q.y,q.z,q.w,e.pose.scale.x];
        });
        if(reducedMotion.matches)roomTransition.clear();else roomTransition.begin(painted,performance.now());
        pendingCloudPhysics=rust.room_physics_with_local(localStorage.getItem(physicsStorageKey),roomCheckpoint,roomRecords())||'';
      }
      physicsReady = next.physicsReady !== false;
      noteInspectionDirty('layout');
      // A fresh semantic layout already contains the current book records.
      inspectionEntryUpdates.clear(); canvas.dataset.inspectionPendingEntries = '0';
      inspectionOverview = null;
      shelfSnapshotDirty = shadowDirty = true;
      cancelAnimationFrame(raf); raf = 0; mutations.disconnect();
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
      // Lamp fixtures are structural scene data. Rebuild their cached list and
      // light pool only when a layout is committed, not once per rendered frame.
      lampLighting.prepare(bookEntries);
      acknowledgeRoom(roomCheckpoint);
      if(pendingCloudPhysics&&physicsReady){
        const incoming=new rust.RustBookGravity();
        const keys=bookEntries.filter(e=>!(e.kind==='lamp'&&e.mount==='undershelf')).map(e=>e.key);
        if(incoming.restore(pendingCloudPhysics)&&incoming.matches_keys(keys)){
          bookGravity.free();bookGravity=incoming;physicsStarted=false;physicsInteracted=false;installedRoom=pendingCloudPhysics;pendingCloudPhysics=null;
          for(const entry of bookEntries)entry.collisionStamp=null;
        }else incoming.free();
      }
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
      if (!disposed) { projectionFrame.free(); sceneMotionFrame.free(); gravityFrame.free(); bookGravity.free(); roomMotion.free(); roomTransition.free(); clearTimeout(motionExpiry); }
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
      semanticFoliage.clear(); foliageFrame.free();
      for (const node of trashOriginalStates.keys()) restoreTrashNode(node);
      for (const node of catalogOriginalStates.keys()) restoreCatalogNode(node);
    }
  };
}

// Capability is available before the first scene/layout is constructed.
createBookshelfScene.physicalPlacement = true;
