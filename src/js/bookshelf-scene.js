import { createGravityFrame } from './gravity-frame.js';
import { createSceneCountFrame } from './scene-count-frame.js';
import { createFoliageFrame } from './foliage-frame.js';
import { createSceneMotionFrame } from './scene-motion-frame.js';
import { createSceneProjectionFrame } from './scene-projection-frame.js';
import { createSceneEntryFrame, settledQualityWork, ENTRY_STATE, ENTRY_OUTPUT, HIT_INPUT, HIT_OUTPUT } from './scene-entry-frame.js';
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
// A plant button's model diagnostics, the foliage target and the scene's other cold DOM recipes: rust-ui/src/scene_dom.rs.
function clearPlantDiagnostics(node) { needRustShelf().scene_clear_plant_diagnostics(node); }
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

// The bin at the origin through the hinged lid's full sweep, rather than a permanently narrow
// cabinet or an estimate that clips the open bin on small phones (rust-ui/src/scene_host.rs).
function trashFootprint(bin) { return needRustShelf().scene_trash_footprint(bin, new THREE.Box3(), () => new THREE.Box3()); }

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


// A missing file leaves its maps a flat swatch of the mean, not black (rust-ui/src/scene_host.rs).
function veneerSwatch(map, mean) { needRustShelf().scene_veneer_swatch(map, mean); }

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
  // Its colour space, repeat and anisotropy (rust-ui/src/scene_room.rs).
  return needRustShelf().scene_walnut_map(THREE, map, Boolean(colour), renderer);
}

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
  const countFrame = createSceneCountFrame(rust);
  const [canvas, context] = rust.scene_canvas(0);
  // The canvas' diagnostics as this scene last wrote them. Nothing else writes them, so a value
  // that stands is known without asking the DOM: a steady frame reads none of its data attributes.
  const shownData = new Map();
  const showData = (key, value) => {
    if (shownData.get(key) === value) return;
    shownData.set(key, value); setData(canvas,key,value);
  };
  const hideData = key => { if (shownData.delete(key)) delete canvas.dataset[key]; };
  if (!context) return null;
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
  const lampLighting = createShelfLampLighting(scene, { preparedEntries:true, onAreaLightsReady:() => invalidate(true, false, 'lamp-lights') });
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
  // The walnut's materials, the baked occlusion, the floor and the room's wall (rust-ui/src/scene_room.rs).
  const [wood, backWood, darkWood, occlusionMaterial, depthOnly, occlusion, floor, roomWallMaterial, roomWall] =
    rust.scene_room_materials(THREE, texture, grain, widePenumbra, furniture, () => {});
  let floorY = -height, floorLit = false;
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
  // An entry's lift, landing, preview, reorder offset and pose live in the entry arena, at `row`
  // (scene-entry-frame.js); `lift` reads it for whoever inspects an entry from outside the frame.
  const entryFrame = createSceneEntryFrame(rust);
  const cell = (entry, column) => (entryFrame.refresh(), entryFrame.state[entry.row * ENTRY_STATE + column]);
  const easing = entry => { entryFrame.refresh(); const at = entry.row * ENTRY_STATE; return entryFrame.state[at + 9] !== 0 || entryFrame.state[at + 20] !== 0; };
  function settleLift(entry, started) {
    entryFrame.refresh();
    const state = entryFrame.state, at = entry.row * ENTRY_STATE;
    state[at + 5] = 0; state[at + 6] = 0; state[at + 7] = 0; state[at + 8] = started;
  }
  const freshEntry = (entry, index) => {
    const fresh = { ...entry, key:entryKey(entry, index), model:null, replacement:null, pose:new THREE.Object3D(), row:-1, stale:true,
    lift:null, state:'', rect:null, hitRect:null, insertion:null, posed:null,
    overview:false, inspectionResolution:0, qualityReplacement:false, replacementReady:false,
    // Per-frame caches of what the DOM said last time (see stateFor, hitSurface, project).
    classText:null, flags:NO_FLAGS, bits:0, dragX:'', dragY:'', dragNumberX:0, dragNumberY:0, stateText:'', box:null, fallback:null,
    written:null, seen:0, domDirty:true, walked:null, rested:0 };
    fresh.lift = { get value() { return cell(fresh, 5); }, get from() { return cell(fresh, 6); }, get target() { return cell(fresh, 7); }, get started() { return cell(fresh, 8); } };
    return fresh;
  };
  // The camera framing, the turn between the views, the inspection zoom and pan and the drop guide's place
  // live in Rust (rust-ui/src/scene_view.rs); the sizes are the same ones this closure keeps for its objects.
  const sceneView = new rust.RustScene(width, height, sceneWidth, depth, shelfType === 'baggebo', mode === 'isometric', scroller.scrollTop);
  let bookGravity = new rust.RustBookGravity();
  const roomMotion = new rust.RustRoomMotion();
  const roomTransition = new rust.RustRoomTransition();
  let motionExpiry = null, motionGesture = null, motionSequence = 0, motionSentAt = -Infinity;
  let motionBase = null;
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
      motionBase = roomRevision; entryFrame.motionBegin();
      motionGesture = crypto.randomUUID(); motionSequence = 0; motionSentAt = -Infinity;
    }
    if (!motionGesture) {
      // The entries' local poses (kept in the entry arena) become the poses at rest.
      if (quiet && !roomMotion.active(now)) entryFrame.motionRest(sceneMotionFrame);
      return;
    }
    const end = !arranging && quiet;
    if (!end && now - motionSentAt < 50) return;
    // Each frame is a complete replacement for this gesture's affected set,
    // including a neighbour that moved and then returned to its starting pose.
    const poses = entryFrame.motionPoses(sceneMotionFrame);
    globalThis.dispatchEvent(new CustomEvent('inhouse-room-motion-local', {detail:{gesture:motionGesture,
      sequence:++motionSequence, phase:end ? 'end' : 'frame', shelfType, poses,
      base:motionBase || undefined, commit:end && motionBase ? roomRevision : undefined}}));
    motionSentAt = now;
    if (end) { motionGesture = null; entryFrame.motionRest(sceneMotionFrame); }
  }
  const physicsStorageKey = 'inhouse-read-shelf-physics-v1';
  let physicsStarted = false, physicsInteracted = false, pendingCloudPhysics = null;
  if (settleBooks) { try { bookGravity.restore(localStorage.getItem(physicsStorageKey) || ''); } catch {} }
  const gravityFrame = createGravityFrame(rust);
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
    rust.scene_room_floor(THREE, floor, roomWall, roomPlan());
    positionTrash();
  }
  function rebuildOcclusion() {
    occlusion.geometry.dispose();
    floorLit = darkPage();
    // Each unit's baked occlusion, merged (rust-ui/src/scene_room.rs).
    const baggebo = shelfType === 'baggebo';
    rust.scene_room_occlusion(THREE, occlusion, baggebo, baggebo ? NO_NUMBERS : roomPlan(), unitCount, unitWidth, height, depth, floorY,
      rows, floorLit ? DARK_FLOOR_LIGHT : null, trash, createShelfOcclusion, mergeGeometries);
  }
  function positionTrash() {
    // The bin stands on the floor clear of the wall with its lid's whole sweep (rust-ui/src/scene_room.rs).
    if (trash) rust.scene_position_trash(sceneView, trash, trashBounds, roomWall, floorY, TRASH_GAP);
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
  // The hidden placement guide and the return's depth writers (rust-ui/src/scene_room.rs).
  const [dropMarker, dropGuide, depthWriters] = rust.scene_room_drop_marker(THREE, furniture, depthOnly);
  // Orthographic inspection is a similarity of a stationary room. Keep an
  // overscanned, already lit image for the compositor instead of running all
  // of its shaders, GPU readback and native hit projections for each finger
  // sample. A full fitted backdrop covers anything beyond the detailed tile;
  // paint full quality and restore native surfaces when the gesture settles.
  const [inspectionCanvas, inspectionContext] = rust.scene_canvas(1);
  stage.append(inspectionCanvas);
  const inspectionCamera = camera.clone();
  const [inspectionOverviewCanvas, inspectionOverviewContext] = rust.scene_canvas(2);
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
  const nativeRoomClip = nativeFrameCache ? rust.scene_native_room_clip(stage) : null;
  const nativeRoomLease = nativeFrameCache && createNativeRendererPresentation(renderer,{
    canvas,context,
    capture(rawContext) {
      if (!nativeFrameCache.validFrame(nativeBaseFrame)) return;
      try {
        nativeFrameCache.repaint(nativeBaseFrame);
        // The room's public export from the GL canvas (rust-ui/src/scene_room.rs).
        rust.scene_native_room_export(rawContext,canvas,renderer.domElement,nativeBaseFrame,nativeBaseMargin);
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
    if (rust.scene_shared_capture(captured,overview,frame,raw,sourceFrame,sourceContext,sourceRevision,sourceMaterialized)) {
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
  // The bin's data as last written to its node, how many entries are falling into it, and the
  // numbers its box on screen was last taken from (see updateTrash).
  const binShown = new Map(), binNow = new Float64Array(27), binHeld = new Float64Array(27);
  const binNowBits = new Uint32Array(binNow.buffer), binHeldBits = new Uint32Array(binHeld.buffer);
  let trashDrops = 0, binStale = true;
  const trashBox = new THREE.Box3(), footPoint = new THREE.Vector3(), floorPoint = new THREE.Vector3();
  const trashOriginalStates = new Map();
  function rememberTrashNode(node) {
    if (node && !trashOriginalStates.has(node)) trashOriginalStates.set(node, rust.scene_remember_node(node, true));
  }
  function restoreTrashNode(node) {
    binShown.clear();
    const original = trashOriginalStates.get(node);
    if (!original) return;
    if (trashWritten?.node === node) trashWritten = null;
    rust.scene_restore_node(node, original, true);
  }
  rememberTrashNode(trashNode);
  const catalogOriginalStates = new Map();
  function rememberCatalogNode(node) {
    if (node && !catalogOriginalStates.has(node)) catalogOriginalStates.set(node, rust.scene_remember_node(node, false));
  }
  function restoreCatalogNode(node) {
    const original = catalogOriginalStates.get(node);
    if (!original) return;
    if (catalogWritten?.node === node) catalogWritten = null;
    rust.scene_restore_node(node, original, false);
  }
  rememberCatalogNode(catalogNode);
  const vector = new THREE.Vector3(), inverseRotation = new THREE.Quaternion();
  const shadowBounds = new THREE.Box3(), shadowOut = new Float64Array(6), captureOut = new Float64Array(4), countOut = new Float64Array(8);
  let casterIds = new Float64Array(entries.length), casterListDirty = true, casterTrashVisible = null, casterSignature = 0;
  const rendererSize = new THREE.Vector2();
  const frameLayout = { canvas:null, stage:null, scroller:null, visualBottom:NaN, innerWidth:NaN, innerHeight:NaN, ratio:NaN, clientHeight:NaN, scrollTop:NaN };
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
    entry.box = boxScratch.slice(0, 6); entry.fallback = boxScratch.slice(6, 12); entry.stale = true;
  }
  for (const entry of bookEntries) placeBoxes(entry);
  entryFrame.bind(bookEntries, true);
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
  // `Object3D#updateWorldMatrix(true, false)` for an object inside the room whose ancestors from
  // the room upwards were already walked in this frame: the same calls on the same objects, in
  // the same order, without composing the room and the scene again for every entry.
  function refreshWorldBelowRoom(object) {
    const parent = object.parent;
    if (parent !== null && parent !== furniture) refreshWorldBelowRoom(parent);
    if (object.matrixAutoUpdate) object.updateMatrix();
    if (object.matrixWorldAutoUpdate === true) {
      if (parent === null) object.matrixWorld.copy(object.matrix);
      else object.matrixWorld.multiplyMatrices(parent.matrixWorld, object.matrix);
    }
  }
  // The room's epoch advances whenever its world matrix is not, bit for bit, the one of the
  // previous frame of the entries.
  const roomNow = new Float64Array(16), roomHeld = new Float64Array(16).fill(NaN);
  const roomNowBits = new Uint32Array(roomNow.buffer), roomHeldBits = new Uint32Array(roomHeld.buffer);
  let roomEpoch = 0, roomMoved = true;
  function roomEpochNow() {
    const room = furniture.matrixWorld.elements;
    for (let index = 0; index < 16; index++) roomNow[index] = room[index];
    let same = true;
    for (let index = 0; same && index < 32; index++) same = roomNowBits[index] === roomHeldBits[index];
    roomMoved = !same;
    if (!same) { roomHeld.set(roomNow); roomEpoch++; }
    return roomEpoch;
  }
  // Whether a hit surface's world matrix stands as the entry arena holds it: it was taken in this
  // epoch of the room, and the surface and its ancestors below the room stand (position,
  // quaternion, scale: what their matrices are composed from) where they stood then. When it does
  // not, where they stand now is remembered and the caller takes the matrix again.
  function surfaceStands(entry, surface, epoch) {
    const held = entry.walked;
    let places = held !== null && held.surface === surface ? held.places : null, same = places !== null && held.epoch === epoch, at = 0, object = surface;
    for (; same && object !== null && object !== furniture; object = object.parent, at += 10) {
      const position = object.position, quaternion = object.quaternion, scale = object.scale;
      same = at < places.length && object.matrixAutoUpdate === true && object.matrixWorldAutoUpdate === true &&
        Object.is(places[at], position.x) && Object.is(places[at + 1], position.y) && Object.is(places[at + 2], position.z) &&
        Object.is(places[at + 3], quaternion.x) && Object.is(places[at + 4], quaternion.y) && Object.is(places[at + 5], quaternion.z) && Object.is(places[at + 6], quaternion.w) &&
        Object.is(places[at + 7], scale.x) && Object.is(places[at + 8], scale.y) && Object.is(places[at + 9], scale.z);
    }
    if (same && object === furniture && at === places.length) return true;
    let depth = 0;
    for (object = surface; object !== null && object !== furniture; object = object.parent) depth++;
    // Outside the room (a model on its way to the bin): nothing is remembered.
    if (object === null) { entry.walked = null; return false; }
    if (places === null || places.length !== depth * 10) places = new Float64Array(depth * 10);
    at = 0;
    for (object = surface; object !== furniture; object = object.parent, at += 10) {
      const position = object.position, quaternion = object.quaternion, scale = object.scale;
      places[at] = position.x; places[at + 1] = position.y; places[at + 2] = position.z;
      places[at + 3] = quaternion.x; places[at + 4] = quaternion.y; places[at + 5] = quaternion.z; places[at + 6] = quaternion.w;
      places[at + 7] = scale.x; places[at + 8] = scale.y; places[at + 9] = scale.z;
    }
    if (held !== null) { held.surface = surface; held.places = places; held.epoch = epoch; } else entry.walked = { surface, places, epoch };
    return false;
  }
  // The stand-in hit box of a culled model only changes with its slot box.
  const fallbackBox = (entry, lamp) => lamp ? entry.box : entry.fallback;
  const insertedIds = [], exclusionRects = [];
  let exclusionsReady = false, staticStale = true;

  // What a book's materials are compared by, per book and record (JavaScript: through Rust it measured
  // about 14 times slower, 10 ms for 300 books). A plant's or a lamp's model key: rust-ui/src/scene_dom.rs.
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

  const plantKeys = entry => rust.scene_model_key(entry, 0);
  const plantShapeKeys = entry => rust.scene_model_key(entry, 1);
  const lampKeys = entry => rust.scene_model_key(entry, 2);

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
      // Its catalogue id, depth and leaf texture/opacity, on the model and the button (rust-ui/src/scene_host.rs).
      if (entry.node) rust.scene_plant_diagnostics(model, entry.node, new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3()).z);
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
    if (entry.model) { casterListDirty = true; entry.model.removeFromParent(); entry.model.userData.dispose?.(); entry.model = null; }
    entry.posed = null; entry.walked = null;
    entry.lampHull?.free(); entry.lampHull = null;
    const foliage = semanticFoliage.get(entry.node);
    if (foliage) { foliage.svg.remove(); foliage.state.free(); semanticFoliage.delete(entry.node); }
    clearPlantDiagnostics(entry.node);
  }

  // The drop's promise, the model's place at its pose and the drop's diagnostics (rust-ui/src/scene_host.rs).
  function cancelTrashDrop(entry, restore = true) {
    if (!entry.trashDrop) return;
    inspectionOverview = null;
    trashDrops--;
    if (rust.scene_cancel_trash_drop(entry, restore, furniture, trashNode, canvas)) casterListDirty = true;
    // It removed the drop's diagnostics from the canvas and from the bin's node.
    for (const key of ['trashDropProgress', 'trashingBookId', 'trashingObjectId', 'trashingObjectKind']) shownData.delete(key);
    binShown.delete('trashDropProgress'); binShown.delete('dropProgress');
  }

  // The bin's diagnostics are mirrored on its semantic node and on the canvas. Like the canvas'
  // (shownData), the node's are remembered as this scene last wrote them: nothing else writes them.
  const binData = (key, value) => { if (binShown.get(key) !== value) { binShown.set(key, value); setData(trashNode, key, value); } };
  const trashData = (key, value) => { binData(key, value); showData(key, value); };

  const dropStep = new Float64Array(5), overflow = new Float64Array(2), trashPacked = new Float64Array(6), trashOut = new Float64Array(6);
  const scrollerClip = new Float64Array(4), trashRect0 = {}, trashNumbers = new Float64Array(17);
  let trashTexts = null, viewTexts = null;
  // What the bin's box on screen was last taken from: its lid's opening, the room's world matrix
  // and its own place, turn and size (`binHeld`).
  function binStands(openness) {
    const now = binNow, room = furniture.matrixWorld.elements, { position, quaternion, scale } = trash;
    now[0] = openness;
    for (let index = 0; index < 16; index++) now[index + 1] = room[index];
    now[17] = position.x; now[18] = position.y; now[19] = position.z;
    now[20] = quaternion.x; now[21] = quaternion.y; now[22] = quaternion.z; now[23] = quaternion.w;
    now[24] = scale.x; now[25] = scale.y; now[26] = scale.z;
    // Bit for bit (a zero that changed its sign is a change).
    let same = !binStale;
    for (let index = 0; same && index < 54; index++) same = binNowBits[index] === binHeldBits[index];
    if (same) return true;
    binHeld.set(now); binStale = false;
    return false;
  }
  function updateTrash(scroll, now, finishedDrops) {
    if (!trash || !trashNode) {
      for (const key of ['trash3d', 'trashHover', 'trashVisible', 'trashViewHidden', 'trashLocalPosition', 'trashLocalScale',
        'trashLocalRotation', 'trashFootY', 'cabinetFloorY', 'trashCameraInFrame', 'trashFootWorld', 'floorContactWorld'])
        hideData(key);
      return false;
    }
    const scrollerBounds = frameLayout.scroller;
    // Read with the frame's other geometry (viewport()): reading the visual viewport after the
    // entries restyled their buttons would force a second layout of the page in every frame.
    const visualBottom = frameLayout.visualBottom;
    const viewHidden = sceneView.trashViewHidden();
    if (viewHidden) {
      sceneView.trashReset();
      if (trashNode.classList.contains('is-over')) trashNode.classList.remove('is-over');
    }
    let dropEntry = null;
    if (trashDrops) for (const entry of bookEntries) if (entry.trashDrop) { dropEntry = entry; break; }
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
      binData('trashDropProgress', value); binData('dropProgress', value);
      showData('trashDropProgress', value);
      showData('trashingBookId', String(dropEntry.book?.id ?? ''));
      showData('trashingObjectId', String(dropEntry.node?.dataset.objectId ?? dropEntry.key));
      showData('trashingObjectKind', dropEntry.kind === 'plant' || dropEntry.kind === 'lamp' ? dropEntry.kind : 'book');
      moving ||= t < 1;
      if (t === 1 && !drop.complete) {
        drop.complete = true;
        sceneView.trashFinishDrop();
        casterListDirty = true; dropEntry.model.visible = false;
        finishedDrops.push(() => { if (!drop.settled) { drop.settled = true; drop.resolve(true); } });
      }
      // The lid wobbles and the bin's box follows it: the next still frame takes both again.
      binStale = true;
    }
    // A bin whose lid, room and place stand as they were keeps its lid's pose, its world matrices
    // and its box on screen: they are functions of exactly those numbers.
    if (drop || !binStands(openness)) {
      if (!drop) { trash.userData.setState({ openness }); trash.updateMatrixWorld(true); }
      const trashRect = corners(trashBox.setFromObject(trash), IDENTITY, trashRect0);
      trashPacked[0] = trashRect.left; trashPacked[1] = trashRect.right; trashPacked[2] = trashRect.top; trashPacked[3] = trashRect.bottom;
      trashPacked[4] = trashRect.width; trashPacked[5] = trashRect.height;
    }
    const stageBounds = frameLayout.stage;
    scrollerClip[0] = scrollerBounds.left; scrollerClip[1] = scrollerBounds.top; scrollerClip[2] = scrollerBounds.right; scrollerClip[3] = scrollerBounds.bottom;
    sceneView.trashFrame(trashPacked, scroll, stageBounds.left, stageBounds.top, scrollerClip, frameLayout.innerWidth, frameLayout.innerHeight, visualBottom, trashOut);
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
    binData('trash3d', 'true');
    binData('trashVisible', String(visible)); binData('trashViewHidden', String(viewHidden));
    binData('trashHover', hover); binData('hover', hover);
    showData('trash3d', 'true'); showData('trashHover', hover);
    showData('trashVisible', String(visible)); showData('trashViewHidden', String(viewHidden));
    const footY = trash.position.y + trashBounds.min.y * trash.scale.y;
    const footWorld = furniture.localToWorld(footPoint.set(trash.position.x, footY, trash.position.z));
    const floorContact = furniture.localToWorld(floorPoint.set(trash.position.x, floorY, trash.position.z));
    const { position, rotation } = trash, n = trashNumbers;
    n[0] = position.x; n[1] = position.y; n[2] = position.z; n[3] = trash.scale.x; n[4] = rotation.x; n[5] = rotation.y; n[6] = rotation.z;
    n[7] = footY; n[8] = floorY; n[9] = footWorld.x; n[10] = footWorld.y; n[11] = footWorld.z;
    n[12] = floorContact.x; n[13] = floorContact.y; n[14] = floorContact.z; n[15] = trash.userData.radius; n[16] = trash.userData.height;
    // Formatted again only when one of the numbers moved; the texts held are written otherwise.
    const texts = trashTexts = sceneView.trashTexts(n) || trashTexts;
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

  // A pending replacement survives a newer record only when at most its ribbon changed, which it
  // updates in place; every other material, cover and physical/quality change prepares its own model.
  function replaceWhenReady(entry) {
    const target = rust.scene_replacement_target(entry, bookmarkFor);
    if (rust.scene_retain_replacement(entry, target)) return;
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
      casterListDirty = true; entry.model = replacement;
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

  // Each changed material key updates its part of the shown model in place.
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
    const identityChanged = entry.book?.driveFileId !== book?.driveFileId;
    entry.book = book; entry.style = style; entry.coverUrl = coverUrl;
    if (identityChanged) { sceneMotionFrame.invalidate(); acknowledgeRoom(roomCheckpoint); }
    placeBoxes(entry);
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

  function updateWoodTheme() {
    // The walnut's theme tints, the floor contact and the wall (rust-ui/src/scene_host.rs).
    rust.scene_wood_theme(darkPage(), wood, backWood, darkWood, occlusionMaterial, roomWallMaterial);
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
  // The bin's footprint and place, for the view's fit and the shadow's bounds (written element by
  // element: a temporary array and TypedArray#set cost several times more, twice per frame).
  function packBin() {
    const { min, max } = trashBounds, { position } = trash;
    binBox[0] = min.x; binBox[1] = min.y; binBox[2] = min.z; binBox[3] = max.x; binBox[4] = max.y; binBox[5] = max.z;
    binBox[6] = position.x; binBox[7] = position.y; binBox[8] = position.z;
  }
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
    if (trash && trashNode) frameLayout.visualBottom = window.visualViewport
      ? window.visualViewport.offsetTop + window.visualViewport.height : window.innerHeight;
    // The window's size and the scroller's metrics, read while the layout is still clean: the window
    // and the scroller do not depend on the clipped stage's buttons restyled below, and reading them
    // after those writes (the bin, the next frame's bookkeeping) forced the page's layout every frame.
    frameLayout.innerWidth = window.innerWidth; frameLayout.innerHeight = window.innerHeight;
    frameLayout.ratio = window.devicePixelRatio; frameLayout.clientHeight = scroller.clientHeight; frameLayout.scrollTop = scroller.scrollTop;
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
    if (trash) packBin();
    // The diagnostics are formatted again only when a number they show moved; the texts held are written otherwise.
    const texts = viewTexts = sceneView.transformFresh(trash ? binBox : NO_NUMBERS, rooftop, floor.visible, unitCount, viewFrame) || viewTexts;
    // The fitted room: turned, scaled and placed as the Rust view decided.
    furniture.rotation.set(viewFrame[1], viewFrame[0], 0); furniture.scale.setScalar(viewFrame[2]);
    furniture.position.set(viewFrame[3], viewFrame[4], 0);
    // Only the room's root is needed to project the entries below. Updating
    // every descendant here computes their previous pose, immediately before
    // each entry updates its new pose and the renderer walks the scene again.
    furniture.updateWorldMatrix(false, false);
    stage.style.height = `${viewFrame[6]}px`;
    showData('shelfView', texts[0]);
    showData('viewProgress', texts[1]);
    showData('yaw', texts[2]);
    showData('pitch', texts[3]);
    showData('zoom', texts[4]);
    showData('inspectionZoom', texts[5]);
    showData('inspectionMoving', texts[6]);
    showData('inspectionPan', texts[7]);
    showData('cabinetWidth', texts[8]); showData('trashReserve', texts[9]);
    showData('shelfType', shelfType);
    showData('shelfUnits', texts[10]);
    showData('shelfDimensions', SHELF_DIMENSIONS[shelfType]);
    showData('sceneFitHeight', texts[11]); showData('floorVisible', texts[12]);
    showData('fullCabinetInFrame', texts[13]);
    inverseRotation.copy(furniture.quaternion).invert();
    return viewFrame[2];
  }

  const catalogPlace = new Float64Array(4), catalogOut = new Float64Array(6), catalogBox = new Float64Array(6);
  const catalogCover = new Float64Array(3), catalogStage = new Float64Array(2), catalogInner = new Float64Array(2);
  function updateCatalog(scroll) {
    if (!catalog || !catalogNode) {
      hideData('catalog3d'); hideData('catalogVisible');
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
    catalogBox[0] = min.x; catalogBox[1] = min.y; catalogBox[2] = min.z; catalogBox[3] = max.x; catalogBox[4] = max.y; catalogBox[5] = max.z;
    // The printed cover inside the (clip and edge inclusive) hit box: the
    // catalogue page flies out of exactly this rectangle.
    const { width:coverWidth = 76, height:coverHeight = 108, thickness = 3.4 } = catalog.userData;
    catalogCover[0] = coverWidth; catalogCover[1] = coverHeight; catalogCover[2] = thickness;
    catalogStage[0] = stageBounds.left; catalogStage[1] = stageBounds.top;
    scrollerClip[0] = clip.left; scrollerClip[1] = clip.top; scrollerClip[2] = clip.right; scrollerClip[3] = clip.bottom;
    catalogInner[0] = frameLayout.innerWidth; catalogInner[1] = frameLayout.innerHeight;
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
    showData('catalog3d', 'true'); showData('catalogVisible', String(visible));
  }

  const projectionFrame = createSceneProjectionFrame(rust);
  const lampIo = new Float64Array(8);
  const insertionIo = new Float64Array(4), inverseTurn = new Float64Array(4);
  function advanceLampPower(entry, now) {
    const target = entry.isOn === false ? 0 : 1, reduced = reducedMotion.matches;
    const power = entry.lampPower ||= { value:target, from:target, target, started:now, duration:0 };
    // A fade that has ended keeps its five numbers (scene_lamp_power at t = 1 writes the same ones
    // back and reports nothing): a lamp at rest makes no native call.
    let fading = false;
    if (!(power.target === target && Object.is(power.value, power.from + (target - power.from)) &&
        (reduced || power.duration === 0 || power.duration !== power.duration || (now - power.started) / power.duration >= 1))) {
      lampIo[0] = target; lampIo[1] = power.value; lampIo[2] = power.from; lampIo[3] = power.target;
      lampIo[4] = power.started; lampIo[5] = power.duration; lampIo[6] = now; lampIo[7] = reduced ? 1 : 0;
      rust.scene_lamp_power(lampIo);
      power.value = lampIo[0]; power.from = lampIo[1]; power.target = lampIo[2]; power.started = lampIo[3]; power.duration = lampIo[4];
      fading = Boolean(lampIo[5]);
      // Changing radiance repaints the image but never invalidates caster depth.
      if (lampIo[6]) shelfSnapshotDirty = true;
    }
    // The model's emission, the button's data and the tint are written only when the power, the
    // tint, the model or the button is not the one they were last written for.
    const model = entry.model, node = entry.node;
    const shown = entry.lampShown ||= { model:null, power:NaN, node:null, text:NaN, tinted:null, r:NaN, g:NaN, b:NaN };
    if (shown.model !== model || !Object.is(shown.power, power.value)) {
      shown.model = model; shown.power = power.value; model?.userData.setPower?.(power.value);
    }
    if (node && (shown.node !== node || !Object.is(shown.text, power.value))) {
      shown.node = node; shown.text = power.value; setData(node, 'lampPower', power.value.toFixed(4));
    }
    // A change of colour temperature eases over the same frames.
    const tint = entry.lampTint ||= createTintTransition(entry.kelvin);
    if (reduced) tint.set(entry.kelvin, now, false);
    const tinting = tint.advance(now), value = tint.state.value;
    if (model && (shown.tinted !== model || shown.r !== value[0] || shown.g !== value[1] || shown.b !== value[2])) {
      shown.tinted = model; shown.r = value[0]; shown.g = value[1]; shown.b = value[2];
      const text = value.join();
      if (model.userData.shownTint !== text) {
        model.userData.shownTint = text;
        model.userData.setTint?.(value);
        shelfSnapshotDirty = true;
      }
    }
    return fading || tinting;
  }

  // A book's lean is formatted and compared with its button's data only when the number moved.
  const leanEuler = new THREE.Euler();
  function writeLean(entry, node, value) {
    if (entry.leanNode === node && Object.is(entry.leanValue, value)) return;
    entry.leanNode = node; entry.leanValue = value;
    setData(node, 'sceneLean', value.toFixed(6));
  }
  function updateEntries(scroll, zoom, now, finishedInsertions) {
    let activeBooks = 0, moving = false, shelfMoving = false, previewing = false, previewed = 0, overlaying = false;
    insertedIds.length = 0; exclusionRects.length = 0; exclusionsReady = false;
    // Changes the observer has not yet delivered (a synchronous draw right after
    // a class or drag-variable write) are examined here, as the frame's own read.
    for (const record of mutations.takeRecords()) { const entry = byNode.get(record.target); if (entry) entry.domDirty = true; }
    inverseTurn[0] = inverseRotation.x; inverseTurn[1] = inverseRotation.y; inverseTurn[2] = inverseRotation.z; inverseTurn[3] = inverseRotation.w;
    sceneView.beginEntries(now, reducedMotion.matches, zoom, inverseTurn, window.devicePixelRatio, frameLayout.innerWidth, scroll, MINIMUM_LAMP_TAP_SIZE);
    const usePhysics = settleBooks && (physicsReady || physicsStarted);
    projectionFrame.prepare(bookEntries);
    sceneMotionFrame.prepare(bookEntries, rows, width, unitWidth / SHELF_SPECS[shelfType].width * 1000);
    const arranging = Boolean(stage.closest('.ihr-bookshelf')?.classList.contains('is-arranging'));
    const pixelsPerMetre = unitWidth / SHELF_SPECS[shelfType].width * 1000;
    if (usePhysics) { physicsStarted = true; gravityFrame.prepare(bookEntries); }
    // What changed since the last frame enters the entry arena: a class or a drag variable, a size
    // or a place (`stale`), what the host holds of the entry and, for the rigid bodies, its bay.
    // Nothing else is copied: the lift, the landing, the preview and the pose stay in Rust.
    for (let index = 0; index < bookEntries.length; index++) {
      const entry = bookEntries[index], at = index * ENTRY_STATE;
      // The DOM is read only for a node whose class or style changed.
      if (entry.domDirty) { entry.domDirty = false; entry.state = stateFor(entry); }
      const plant = entry.kind === 'plant', lamp = entry.kind === 'lamp', undershelf = lamp && entry.mount === 'undershelf';
      const kind = plant ? 1 : lamp ? 2 : 0;
      if (usePhysics) {
        if ((plant || lamp) && !undershelf) {
          const stamp = entry.collisionStamp;
          if (!stamp || stamp.height !== entry.height || stamp.width !== entry.width || stamp.catalogId !== entry.catalogId ||
              stamp.variant !== entry.variant || stamp.potId !== entry.potId || stamp.lampId !== entry.lampId || stamp.pixelsPerMetre !== pixelsPerMetre) {
            entry.collisionStamp = { height:entry.height, width:entry.width, catalogId:entry.catalogId, variant:entry.variant,
              potId:entry.potId, lampId:entry.lampId, pixelsPerMetre };
            if (plant) {
              const spec = plantGeometrySpec(entry);
              bookGravity.decoration(entry.key,1,spec.potId || '',spec.potModelId || '',
                new Float64Array([spec.real.potDiameter / 2 * spec.unit / pixelsPerMetre,spec.real.potHeight * spec.unit / pixelsPerMetre,spec.height / pixelsPerMetre,0]));
            } else {
              const spec = lampGeometrySpec(entry);
              bookGravity.decoration(entry.key,spec.kind === 1 ? 2 : 3,'','',new Float64Array([0,0,0,spec.scale / pixelsPerMetre]));
            }
          }
        }
        if (entry.bits & 6) physicsInteracted = true;
      }
      // A completed insertion remains painted until its owner restores the
      // semantic shelf book. This avoids an empty frame at the final handoff.
      if (entry.insertion?.complete && !entry.flags.away) {
        if(entry.insertion.nativeLegacyBackground && entry.insertion.nativeLease)
          completedLegacyInsertionLeases.add(entry.insertion.nativeLease);
        entry.insertion = null;
      }
      // Native work above (the state's text, a decoration) may have grown the memory.
      entryFrame.refresh();
      const state = entryFrame.state, insertion = entry.insertion, trashDrop = entry.trashDrop;
      if (staticStale || entry.stale) {
        entry.stale = false;
        state[at] = kind; state[at + 1] = undershelf ? 1 : 0;
        state[at + 23] = entry.x; state[at + 24] = entry.y; state[at + 25] = entry.width; state[at + 26] = entry.height;
        state[at + 27] = entry.depth; state[at + 28] = entry.depthInset;
        state.set(entry.box, at + 50);
      }
      state[at + 2] = entry.bits; state[at + 3] = entry.dragNumberX; state[at + 4] = entry.dragNumberY;
      if (usePhysics) {
        const row = rows[entry.shelf || 0] || rows[0] || {};
        state[at + 40] = kind ? entry.width : entry.thickness; state[at + 41] = undershelf ? 3 : kind;
        state[at + 42] = entry.shelf || 0; state[at + 43] = pixelsPerMetre;
        state[at + 44] = row.left || 0; state[at + 45] = row.right ?? width;
        state[at + 46] = row.bottom ?? entry.y + entry.height / 2;
        state[at + 47] = row.ceiling ?? row.top ?? 0; state[at + 48] = entry.gripHeight || 0;
      }
      state[at + 49] = (trashDrop ? 1 : 0) | (insertion ? 2 : 0) | (entry.model ? 4 : 0) | (entry.overview ? 8 : 0) |
        (trashDrop?.complete ? 16 : 0) | (insertion?.overlayCanvas ? 32 : 0);
    }
    staticStale = false;
    // One native call eases every lift, landing and preview (or steps the rigid bodies), samples the
    // shared room's motion, composes each pose matrix, places it in the room and projects it
    // (scene-entry-frame.js). Its results are applied below, in order.
    let summary;
    if (!usePhysics) summary = entryFrame.poses(sceneMotionFrame.native, sceneView, roomMotion, roomTransition, now, arranging, furniture.matrixWorld);
    else {
      bookGravity.sound_enabled(shelfSoundsEnabled());
      const reduced = reducedMotion.matches;
      if (installedRoom) {
        // A room the solver restores in this step is acknowledged before the shared motion is sampled.
        entryFrame.settle(gravityFrame.native, bookGravity, sceneView, now, reduced);
        if (bookGravity.restored_room()) { acknowledgeRoom(installedRoom); installedRoom = null; }
        summary = entryFrame.place(true, sceneMotionFrame.native, sceneView, roomMotion, roomTransition, now, arranging, furniture.matrixWorld);
      } else summary = entryFrame.settled(gravityFrame.native, bookGravity, sceneMotionFrame.native, sceneView, roomMotion, roomTransition, now, reduced, arranging, furniture.matrixWorld);
      const sounds=bookGravity.take_sounds();
      // [material, strength, pan, kind]; a module without kinds reports book impacts in threes.
      if(sounds){const stride=bookGravity.sound_stride?.()||3;for(let at=0;at+2<sounds.length;at+=stride)playShelfSound(stride>3?sounds[at+3]:3,sounds[at],sounds[at+1],sounds[at+2]);}
    }
    moving = Boolean(summary & 1); shelfMoving = Boolean(summary & 2); previewing = Boolean(summary & 4); previewed = Math.floor(summary / 8);
    let roomWalked = false;
    const epoch = roomEpochNow();
    for (let entryIndex = 0; entryIndex < bookEntries.length; entryIndex++) {
      const entry = bookEntries[entryIndex];
      const node = entry.node, plant = entry.kind === 'plant', lamp = entry.kind === 'lamp';
      const decorative = plant || lamp, undershelf = lamp && entry.mount === 'undershelf';
      const away = entry.flags.away, insertion = entry.insertion, trashDrop = entry.trashDrop, pose = entry.pose;
      // Native work below (models, quality, hits) may grow the memory: the views follow it.
      entryFrame.refresh();
      const live = entryFrame.output, at = entryIndex * ENTRY_OUTPUT, liveFlags = live[at];
      // The pose reaches its three object only when it differs from the one the object holds.
      const state = entryFrame.state, row = entryIndex * ENTRY_STATE, changed = state[row + 70];
      if (changed & 1) {
        pose.position.set(state[row + 29], state[row + 30], state[row + 31]);
        pose.rotation.set(state[row + 32], state[row + 33], state[row + 34], state[row + 56] ? 'ZYX' : 'XYZ');
        pose.scale.setScalar(state[row + 35]);
      }
      if (usePhysics && !decorative && node) writeLean(entry, node, state[row + 69]);
      if (liveFlags & 2) {
        pose.position.set(live[at+10],live[at+11],live[at+12]);
        pose.quaternion.set(live[at+13],live[at+14],live[at+15],live[at+16]);pose.scale.setScalar(live[at+17]);
        if (!decorative && node) writeLean(entry, node, leanEuler.setFromQuaternion(pose.quaternion,'ZYX').z);
      }
      if (liveFlags & 4) {
        pose.position.set(live[at+18],live[at+19],live[at+20]);
        pose.quaternion.set(live[at+21],live[at+22],live[at+23],live[at+24]);pose.scale.setScalar(live[at+25]);
        if (!decorative && node) writeLean(entry, node, leanEuler.setFromQuaternion(pose.quaternion,'ZYX').z);
      }
      // Object3D#updateMatrix, already taken natively (the room's multiply stays in the arena for the hits).
      if (changed & 2) { pose.matrix.fromArray(live, at + 26); pose.matrixWorldNeedsUpdate = true; }
      // Which part of the room it is in, and the quality it is drawn at, are decided in Rust too.
      // Its projected rectangle is copied only when it moved (or the entry holds none yet).
      if (changed & 4 || !entry.rect) {
        const rect = entry.rect || (entry.rect = {});
        rect.left = live[at + 58]; rect.right = live[at + 59]; rect.top = live[at + 60]; rect.bottom = live[at + 61];
        rect.width = live[at + 62]; rect.height = live[at + 63]; rect.closest = live[at + 64];
      }
      const visible = live[at + 65] === 1, modelVisible = live[at + 69] === 1;
      if (live[at + 66] === 1) {
        // Every settled, visible book and plant passes here in every frame. Its overview flag and
        // resolution are stored as scene_update_quality stores them, and Rust is called only for
        // an entry with work to do: a model at another quality (scene_quality.rs `matches`), a
        // replacement or a plant texture under way. The call per entry cost more than the frame.
        const overview = live[at + 67] === 1, resolution = live[at + 68];
        if (settledQualityWork(entry, overview, resolution)) rust.scene_update_quality(entry,qualityHost,overview,resolution);
      }
      let created = null, still = false;
      if (visible && !entry.model) {
        created = entry.model = makeModel(entry); casterListDirty = true;
        furniture.add(entry.model);
        if (entry.kind === 'plant' || entry.kind === 'lamp') programsStale = true;
      } else if (!visible && entry.model && !away) {
        releaseEntry(entry);
      }
      if (entry.model) {
        if (entry.model.visible !== modelVisible) casterListDirty = true;
        entry.model.visible = modelVisible;
        if (trashDrop) {
          entry.posed = null;
          moving ||= !trashDrop.complete;
          shelfMoving ||= !trashDrop.complete;
        } else if (insertion) {
          entry.posed = null;
          // The first depth pass can take longer while a mobile GPU warms up.
          // Advance in bounded frame steps instead of skipping the whole
          // insertion after one delayed frame.
          insertionIo[0] = insertion.elapsed; insertionIo[1] = insertion.lastFrame; insertionIo[2] = insertion.duration; insertionIo[3] = now;
          rust.scene_insertion_step(insertionIo);
          insertion.elapsed = insertionIo[0]; insertion.lastFrame = insertionIo[1];
          const t = insertionIo[2];
          shelfBookInsertion(insertion.slot, entry.width, insertionIo[3])
            .decompose(entry.model.position, entry.model.quaternion, entry.model.scale);
          showData('returnProgress', t.toFixed(4));
          moving ||= t < 1;
          shelfMoving ||= t < 1 && !insertion.overlayCanvas;
          if (t === 1 && !insertion.complete) {
            insertion.complete = true;
            finishedInsertions.push(insertion.resolve);
          }
        } else if (entry.posed !== entry.model || changed & 1 || liveFlags & 6) {
          // A model already at its entry's pose keeps it: nothing else moves a shelf model.
          entry.posed = entry.model;
          entry.model.position.copy(pose.position);
          entry.model.rotation.copy(pose.rotation);
          entry.model.scale.copy(pose.scale);
        } else still = true;
        if (!decorative && (!away || insertion)) activeBooks++;
      }
      if (lamp) moving = advanceLampPower(entry, now) || moving;
      // The button's hit surface is read now, as the frame's models stand; its target is taken below.
      entryFrame.refresh();
      const hits = entryFrame.hitInput, h = entryIndex * HIT_INPUT;
      if (node) {
        // A whole-model bounding rectangle includes empty space around plants
        // and most of an isometric book's cover. Give each semantic button a
        // centre on its visible, solid surface instead: binding or ceramic pot.
        const surface = hitSurface(entry, plant ? 'ceramic-pot' : lamp
          ? undershelf ? 'warm-opal-diffuser' : entry.lampId === 'tripod' ? 'woven-linen-drum-shade' : 'lamp-base'
          : 'binding');
        let placed = 32;
        if (surface?.geometry) {
          if (!surface.geometry.boundingBox) surface.geometry.computeBoundingBox();
          // A model the frame has just moved, or that has stood for fewer than three frames, is not
          // asked whether its surface stands, and none is while the room itself moves: a book in
          // motion and a turning room pay nothing for the question.
          if (!still) entry.rested = 0; else if (entry.rested < 3) entry.rested++;
          if (!(entry.rested === 3 && !roomMoved && surfaceStands(entry, surface, epoch))) {
            // The room's own matrices are walked once per frame; every other surface starts below them.
            if (roomWalked) refreshWorldBelowRoom(surface);
            else { surface.updateWorldMatrix(true, false); for (let above = surface.parent; above; above = above.parent) if (above === furniture) { roomWalked = true; break; } }
            // Copied element by element: TypedArray#set from a plain array measured eight times slower.
            const world = surface.matrixWorld.elements;
            hits[h + 8] = world[0]; hits[h + 9] = world[1]; hits[h + 10] = world[2]; hits[h + 11] = world[3];
            hits[h + 12] = world[4]; hits[h + 13] = world[5]; hits[h + 14] = world[6]; hits[h + 15] = world[7];
            hits[h + 16] = world[8]; hits[h + 17] = world[9]; hits[h + 18] = world[10]; hits[h + 19] = world[11];
            hits[h + 20] = world[12]; hits[h + 21] = world[13]; hits[h + 22] = world[14]; hits[h + 23] = world[15];
          }
          const { min, max } = surface.geometry.boundingBox;
          hits[h + 2] = min.x; hits[h + 3] = min.y; hits[h + 4] = min.z; hits[h + 5] = max.x; hits[h + 6] = max.y; hits[h + 7] = max.z;
          placed = 0;
        } else { hits.set(fallbackBox(entry, lamp), h + 2); entry.rested = 0; }
        const resetHit = entry.written?.node !== node;
        if (resetHit) entry.written = { node };
        // Without a surface the stand-in box goes under the entry's own placed matrix (32).
        hits[h] = 1 | (undershelf ? 2 : 0) | (node.disabled || node.inert ? 4 : 0) | (resetHit ? 8 : 0) |
          (!plant && !semanticCovers.has(node) ? 16 : 0) | placed;
        hits[h + 1] = entry.bits;
      } else hits[h] = 0;
      if (entry.insertion) {
        insertedIds.push(String(entry.book?.id ?? ''));
        overlaying ||= Boolean(entry.insertion.overlayCanvas);
      }
      // Before the first frame the driver links each new model's programs
      // while the next models are still being built.
      if (created?.visible && programsReady !== true) prelinkPrograms(renderer, scene, camera, [created]);
    }
    // Every button's hit target and the style writes it needs, in one native call (scene-entry-frame.js).
    entryFrame.hits(projectionFrame.native, sceneView);
    for (let entryIndex = 0; entryIndex < bookEntries.length; entryIndex++) {
      const entry = bookEntries[entryIndex], node = entry.node;
      if (!node) continue;
      const plant = entry.kind === 'plant', lamp = entry.kind === 'lamp', undershelf = lamp && entry.mount === 'undershelf';
      entryFrame.refresh();
      const hit = entryFrame.hitOutput, h = entryIndex * HIT_OUTPUT, dirtyStyle = hit[h];
      // An entry whose hit target and styles stand as written has nothing to copy or restyle
      // (a button without its cover span is always dirty: scene_projection.rs).
      const hull = usePhysics && lamp && !undershelf && entry.model;
      if (dirtyStyle === 0 && !hull && entry.hitRect) continue;
      const rect = entry.rect, written = entry.written;
      const tapLeft = hit[h + 8], tapTop = hit[h + 9], tapWidth = hit[h + 10], tapHeight = hit[h + 11];
      const zIndex = hit[h + 12], coverLeft = hit[h + 13], coverTop = hit[h + 14], coverShown = hit[h + 15], coverEvents = hit[h + 16];
      if (dirtyStyle & 8192 || !entry.hitRect) {
        const hitRect = entry.hitRect || (entry.hitRect = {});
        hitRect.left = hit[h + 1]; hitRect.right = hit[h + 2]; hitRect.top = hit[h + 3]; hitRect.bottom = hit[h + 4];
        hitRect.width = hit[h + 5]; hitRect.height = hit[h + 6]; hitRect.closest = hit[h + 7];
      }
      // The button covers the hit surface, but a real-scale spine is only 5-13 px
      // thick: a book's button is padded to the minimum tap width around the
      // spine's centre (hitRect keeps the drawn surface). A lamp's switch is
      // padded to a finger-sized square around its light: a MITTLED puck is
      // a few pixels tall and often sits behind a board. Plants are not thin,
      // so their button is the hit surface itself.
      if (!plant && (dirtyStyle & 8192 || !entry.tapRect)) {
        const tapRect = entry.tapRect || (entry.tapRect = {});
        tapRect.left = tapLeft; tapRect.top = tapTop; tapRect.width = tapWidth; tapRect.height = tapHeight;
      }
      // A frame that moves nothing restyles nothing: only numbers that differ
      // from the last written ones reach the DOM, in the same order as a first write.
      // The style objects are fetched only when something is written to them.
      if (hull) {
        entry.model.updateMatrixWorld(true);
        // Rebuilt in Rust only when a mesh, its matrix or the tap corner moved; undefined is "as before".
        const clip = (entry.lampHull ||= new rust.RustLampHull()).outline(entry.model, tapLeft, tapTop, written.clip === undefined);
        if (clip !== undefined && clip !== written.clip) node.style.clipPath = written.clip = clip;
      }
      if (dirtyStyle & 63) {
        const style = node.style;
        if (dirtyStyle & 1) style.position = 'absolute';
        if (dirtyStyle & 2) style.left = `${tapLeft}px`;
        if (dirtyStyle & 4) style.top = `${tapTop}px`;
        if (dirtyStyle & 8) style.width = `${tapWidth}px`;
        if (dirtyStyle & 16) style.height = `${tapHeight}px`;
        if (dirtyStyle & 1) style.margin = '0';
        if (dirtyStyle & 32) style.zIndex = String(zIndex);
      }
      if (dirtyStyle & 1) {
        node.dataset.sceneProjected = 'true';
        node.dataset.sceneHitSurface = plant ? 'pot' : lamp ? undershelf ? 'ceiling-lamp' : 'lamp' : 'spine';
        if (lamp) {
          node.dataset.lampModelId = entry.lampId;
          node.dataset.lampMount = undershelf ? 'undershelf' : 'standing';
        }
      }
      if (!plant) {
        let coverHit = semanticCovers.get(node);
        if (!coverHit) {
          coverHit = document.createElement('span'); coverHit.setAttribute('aria-hidden', 'true');
          coverHit.dataset[lamp ? 'shelfLampHit' : 'shelfCoverHit'] = 'true'; semanticCovers.set(node, coverHit); node.append(coverHit);
        }
        // Keep tapping the exposed cover available without moving the
        // button's own focus/click centre away from its neighboring spine.
        // The existing handlers still raycast the true visible geometry.
        if (dirtyStyle & 8128) {
          const coverStyle = coverHit.style;
          if (dirtyStyle & 64) coverStyle.position = 'absolute';
          if (dirtyStyle & 128) coverStyle.left = `${coverLeft}px`;
          if (dirtyStyle & 256) coverStyle.top = `${coverTop}px`;
          if (dirtyStyle & 512) coverStyle.width = `${rect.width}px`;
          if (dirtyStyle & 1024) coverStyle.height = `${rect.height}px`;
          if (dirtyStyle & 2048) coverStyle.display = coverShown ? 'block' : 'none';
          if (dirtyStyle & 64) coverStyle.background = 'transparent';
          if (dirtyStyle & 4096) coverStyle.pointerEvents = coverEvents ? 'inherit' : 'none';
        }
      }
    }
    // Bind native hit surfaces only after all semantic book rectangles are
    // projected, so an overlapping leaf cannot steal a neighboring spine tap.
    for (const entry of bookEntries) if (entry.kind === 'plant' && entry.node) updatePlantFoliage(entry);
    // Everything queued since the records were taken above is this frame's own
    // restyling (the loop wrote only left/top/width/height/z-index of observed
    // nodes): it carries no class or drag-variable change to react to.
    mutations.takeRecords();
    showData('activeBooks', String(activeBooks));
    showData('previewAnimating', String(previewing));
    showData('previewObjects', String(previewed));
    showData('returningBooks', insertedIds.join(','));
    showData('returningBookId', insertedIds.length === 1 ? insertedIds[0] : '');
    showData('returnRenderer', overlaying ? 'shared-depth-overlay' : 'shelf');
    if (!insertedIds.length) hideData('returnProgress');
    return { moving:moving || roomMotion.moving(now) || roomTransition.moving(now), shelfMoving:shelfMoving || roomMotion.moving(now) || roomTransition.moving(now), localMoving:moving };
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
      const [svg, path, exclusions] = rust.scene_foliage_target(node, entry);
      native = { svg, path, exclusions, clip:'', state:foliageFrame.createState(),
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
    if (native.state.pose(model, furniture.quaternion, rect)) {
      // Leaf paths consume each mesh's world matrix. Refresh descendants only
      // when rebuilding the path, rather than on every room frame.
      model.updateMatrixWorld(true);
      const projected = projectPlantFoliage(model);
      native.path.setAttribute('d', projected.path); native.svg.dataset.triangles = String(projected.triangles);
      native.svg.setAttribute('viewBox', `${rect.left} ${rect.top} ${rect.width} ${rect.height}`);
    }
    // The clip is a pure function of the reference box, this rectangle and every
    // excluded book rectangle: rebuild it only when one of those numbers moved.
    if (!exclusionsReady) {
      for (const other of bookEntries) if (other.kind !== 'plant' && other.model?.visible && !other.flags.away && !other.flags.dragging) {
        const area = sceneView.progress > .04 ? other.rect : other.hitRect;
        if (area) exclusionRects.push(area);
      }
      foliageFrame.prepare(exclusionRects);
      exclusionsReady = true;
    }
    // Inside the books' rectangles the existing native book surface already has touch-action:none and
    // resolves true mesh occlusion in its drag handler; the clip (Rust) keeps book clicks native even if
    // foliage is behind a cover. It is rebuilt only when one of its inputs moved.
    const clipping = native.state.clip();
    if (!clipping) return;
    if (native.clip !== clipping) {
      native.exclusions.setAttribute('d', clipping); native.clip = clipping;
    }
  }

  // Placement previews: ten numbers per placed entry, advanced for every entry in one native call.
  let previewBatch = new Float64Array(0);

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
  const rayPointer = new THREE.Vector2(), raycaster = new THREE.Raycaster(), pickableScratch = [];
  function pointerRay(clientX, clientY) {
    // During a drag, pending style/mutation frames must remain coalesced:
    // casting a ray does not need to shade and read back the whole room.
    // A compositor inspection does need its native matrices restored first.
    if (inspectionSnapshotVisible) { cancelAnimationFrame(raf); raf = 0; draw(); }
    // Cached room frames can skip rendering; ray tests still need the latest
    // descendant matrices even when the renderer has not traversed them yet.
    for (const entry of bookEntries) if (entry.model && entry.node) entry.model.updateMatrixWorld(true);
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
  const tapNodes = new Array(entries.length).fill(null);
  let tapPacked = new Float64Array(entries.length * 4);
  function tapTargetNear(clientX, clientY) {
    const origin = stage.getBoundingClientRect(), count = bookEntries.length;
    if (tapPacked.length !== count * 4) tapPacked = new Float64Array(count * 4);
    tapNodes.length = count; tapNodes.fill(null);
    for (let index = 0; index < count; index++) {
      const entry = bookEntries[index], tap = entry.tapRect, at = index * 4;
      if (!tap || !entry.node || !entry.model?.visible || entry.flags?.away || entry.flags?.dragging || entry.trashDrop ||
          entry.kind === 'plant' || entry.node.classList.contains('is-away')) {
        // Keep stable indices without allocating a compact array for each hit.
        tapPacked[at] = Infinity; tapPacked[at + 1] = tapPacked[at + 2] = tapPacked[at + 3] = 0;
        continue;
      }
      tapNodes[index] = entry.node;
      tapPacked[at] = tap.left + origin.left; tapPacked[at + 1] = tap.top + origin.top;
      tapPacked[at + 2] = tap.width; tapPacked[at + 3] = tap.height;
    }
    return tapNodes[rust.scene_nearest_tap(tapPacked, clientX, clientY)] ?? null;
  }

  // A press is validated by the semantic button, drag controller and grip.
  // Reuse its exact ray hit within this event task, not across animation frames.
  let pointerHit = null;
  function rememberPointerHit(clientX, clientY, node, point = null) {
    const hit = pointerHit = { clientX, clientY, node, point };
    queueMicrotask(() => { if (pointerHit === hit) pointerHit = null; });
    return node;
  }
  function objectAtPoint(clientX, clientY) {
    if (pointerHit?.clientX === clientX && pointerHit.clientY === clientY) return pointerHit.node;
    const ray = pointerRay(clientX, clientY);
    pickableScratch.length = 0;
    for (const object of furniture.children) if (object.visible && !object.userData.dropMarker &&
        !object.userData.entry?.node?.classList.contains('is-away')) pickableScratch.push(object);
    for (const hit of ray.intersectObjects(pickableScratch, true)) {
      let object = hit.object;
      while (object && !object.userData.entry) object = object.parent;
      if (object?.userData.entry?.node && object.visible) return rememberPointerHit(clientX, clientY, object.userData.entry.node, hit.point.clone());
      // Solid wood in front blocks the object behind it, but a book's padded tap
      // rectangle or a lamp's square still wins over the wood around them.
      if (!object?.userData.entry) return rememberPointerHit(clientX, clientY, tapTargetNear(clientX, clientY));
    }
    return rememberPointerHit(clientX, clientY, tapTargetNear(clientX, clientY));
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
          rust.scene_insertion_export(rawContext,overlay,renderer.domElement,insertion.nativeFrame);
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
    showData('inspectionCacheActive', 'false');
  }

  function paintInspectionSnapshot() {
    const snapshot = inspectionSnapshot || inspectionOverview;
    const miss = rust.scene_cache_miss((!inspectionContext ? 1 : 0) | (!snapshot ? 2 : 0) | (shelfSnapshotDirty ? 4 : 0) | (shadowDirty ? 8 : 0) |
      (lastSceneMoving ? 16 : 0) | (lighting.settling && !sceneView.shadowRefit ? 32 : 0) |
      (sceneView.turning || sceneView.reordering || sceneView.trashEasing || sceneView.progress !== 1 ? 64 : 0) | (sceneView.hasDrop ? 128 : 0));
    if (miss) {
      showData('inspectionCacheMissReason', miss);
      showData('inspectionCacheMissSource', canvas.dataset.inspectionDirtySource || '');
      return false;
    }
    const placement = new Float64Array(4);
    const project = source => {
      sceneView.snapshotPlacement(source.zoom, source.panX, source.panY, source.margin, source.width, source.height, placement);
      return { scale:placement[0], left:placement[1], top:placement[2], covers:placement[3] === 1 };
    };
    const { scale, left, top, covers } = project(snapshot);
    const overview = inspectionOverview && project(inspectionOverview);
    if (!covers && !overview?.covers) { showData('inspectionCacheMissReason', 'coverage'); return false; }
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
    showData('inspectionCacheActive', 'true');
    showData('inspectionCacheMissReason', '');
    showData('inspectionCompositorFrames', String(++compositorFrames));
    showData('inspectionMoving', 'true'); showData('animating', 'true');
    showData('inspectionZoom', sceneView.zoom.toFixed(4));
    showData('inspectionPan', JSON.stringify([sceneView.panX, sceneView.panY]));
    showData('zoom', (snapshot.furnitureZoom * scale).toFixed(4));
    showData('renderCount', String(++renderCount));
    return true;
  }

  // Cheap readiness check between frames; the scene is only redrawn once ready.
  function pollPrograms() {
    programsPoll = 0;
    if (disposed || programsReady === true || pageSuspended || document.visibilityState === 'hidden') return;
    if (!canPresent()) return;
    if (programsReady()) invalidate(false); else programsPoll = setTimeout(pollPrograms, 10);
  }

  function draw(now = performance.now(), force = false) {
    pointerHit = null;
    raf = 0;
    if (disposed) return;
    if (!canPresent()) { drawPending = true; return; }
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
      entryFrame.refresh();
      for (const item of reorderItems) { const at = item.entry.row * ENTRY_STATE; entryFrame.state[at + 21] = item.x * amount; entryFrame.state[at + 22] = item.y * amount; }
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
    const { moving, shelfMoving, localMoving } = updateEntries(scroll, zoom, now, finishedInsertions);
    const finishedDrops = [];
    const trashMoving = updateTrash(scroll, now, finishedDrops);
    // The opaque reader page masks layout preparation. Retain the dirty
    // room until its hidden return slot and the same 3D page are both ready.
    if (paintHeld) {
      drawPending = true;
      unpainted.push(...finishedInsertions, ...finishedDrops);
      return;
    }
    const trashVisible = Boolean(trash?.visible);
    if (casterListDirty || trashVisible !== casterTrashVisible) {
      let casterCount = 0;
      for (const entry of bookEntries) if (entry.model?.visible) casterIds[casterCount++] = entry.model.id;
      casterSignature = rust.scene_casters(trashVisible, casterIds.subarray(0, casterCount));
      casterListDirty = false; casterTrashVisible = trashVisible;
    }
    const casters = casterSignature;
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
          showData('scenePrograms', String(renderer.info?.programs?.length || 0));
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
    if (trash) packBin();
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
        !bookEntries.some(entry => cell(entry, 5) || entry.flags.pressed);
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
        showData('inspectionSnapshotResolution', JSON.stringify([inspectionCanvas.width, inspectionCanvas.height]));
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
        showData('nativeRoomPresentation','true');
      } else showData('nativeRoomPresentation','false');
      completedLegacyInsertionLeases.clear();
      });
      releaseUnusedNativeRoomFrames();
      showData('snapshotRenderCount', String(++shelfSnapshotRenders));
      showData('sceneDrawCalls', String(renderer.info?.render.calls || 0));
      shelfSnapshotDirty = false;
      paintedModalView = { progress:sceneView.progress, inspectionZoom:sceneView.zoom, panX:sceneView.panX, panY:sceneView.panY };
      // Record only a completed room transaction, after GPU/native/legacy
      // output succeeded. A flush can return while programs or paint are held.
      paintedAwayEntries.clear();
      for (const entry of bookEntries) if (entry.flags.away && entry.model && !entry.model.visible &&
        !entry.insertion && !entry.trashDrop) paintedAwayEntries.add(entry);
    }
    for (const entry of bookEntries) if (entry.insertion?.overlayCanvas) paintInsertionOverlay(entry);
    showData('renderCount', String(++renderCount));
    // One pass over the entries serves every count below, taken in Rust.
    const resolutionText = countFrame.sample(bookEntries, countOut);
    const [plants, highPlants, lamps, overview, detailed, highBooks, pending] = countOut;
    showData('activePlants', String(plants));
    showData('highResolutionPlants', String(highPlants));
    showData('activeLamps', String(lamps));
    showData('lampLightCount', String(lampLighting.activeCount));
    showData('activeLampLights', String(lampLighting.activeCount));
    showData('lampShadowCount', String(lampLighting.shadowCount));
    showData('lampLightTemperature', '2700');
    showData('overviewBooks', String(overview));
    showData('highResolutionBooks', String(highBooks));
    showData('bookTextureResolutions', resolutionText);
    showData('sceneGeometries', String(renderer.info?.memory?.geometries || 0));
    showData('sceneTextures', String(renderer.info?.memory?.textures || 0));
    showData('scenePrograms', String(renderer.info?.programs?.length || 0));
    showData('inspectionOverviewReady', String(Boolean(inspectionOverview)));
    showData('pixelRatio', String(ratio));
    showData('detailedBooks', String(detailed));
    showData('bookQualityPending', String(pending));
    showData('shadowMapSize', '1024');
    let cabinet = null;
    for (const object of furniture.children) if (object.userData.furniture) { cabinet = object; break; }
    showData('furnitureMeshes', String(cabinet?.children.length || 0));
    showData('plantGeometry', 'catalog-3d');
    showData('animating', String(Boolean(sceneView.turning || sceneView.reordering || moving || trashMoving || sceneView.moving)));
    lastSceneMoving = Boolean(sceneView.turning || sceneView.reordering || moving || trashMoving);
    lastLocalSceneMoving = Boolean(sceneView.turning || sceneView.reordering || localMoving || trashMoving);
    if (settleBooks && physicsReady && !roomMotion.active(now) && !lastSceneMoving && !sceneView.moving &&
      !bookEntries.some(entry => entry.insertion || entry.trashDrop || easing(entry))) {
      const saved = bookGravity.snapshot();
      if (saved !== undefined && saved !== null) {
        try {
          const records = roomRecords();
          const canonical = rust.room_physics_canonical(saved, records);
          const existing = localStorage.getItem(physicsStorageKey);
          // Received resting geometry is authoritative. A passive render/resize
          // must neither rewrite it nor turn solver roundoff into a local edit.
          const preserve = !physicsInteracted && existing && rust.room_physics_passive_compatible(existing, canonical);
          if (!preserve) {
            localStorage.setItem(physicsStorageKey, canonical);
            acknowledgeRoom(canonical);
          }
          if (physicsInteracted) { physicsInteracted = false; notifyCloudSettingsChanged(physicsStorageKey); }
        } catch {}
      }
    }
    if (settleBooks) publishRoomMotion(now, !lastSceneMoving && !sceneView.moving &&
      !bookEntries.some(e => e.insertion || e.trashDrop || easing(e)));
    paintedViewport = { width:frameLayout.innerWidth, height:frameLayout.innerHeight,
      ratio:frameLayout.ratio || 1, clientHeight:frameLayout.clientHeight, scrollTop:frameLayout.scrollTop };
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
    showData('inspectionDirtySource', source);
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
    if (!disposed && !raf && !paintHeld && !pageSuspended && document.visibilityState !== 'hidden' && canPresent() && !canDeferModalPaint()) raf = requestAnimationFrame(draw);
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
      if (entry.insertion || entry.trashDrop || easing(entry)) return false;
      if (entry.lampTint?.moving()) return false;
      if (entry.lampPower && (entry.lampPower.value !== entry.lampPower.target ||
        entry.lampPower.from !== entry.lampPower.target && now < entry.lampPower.started + entry.lampPower.duration)) return false;
      // Its pressure lift is no longer visible in the already painted slot.
      // Every other entry retains its actual lift/drag frames and endpoint.
      if (entry !== selected) {
        const target = entry.node?.matches('.is-dragging, .is-lifted') ? 1
          : entry.node?.classList.contains('is-pressed') && !entry.node.classList.contains('is-press-pending') ? .22 : 0;
        if (cell(entry, 5) !== target) return false;
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
    const drop = rust.scene_trash_drop_record(THREE, resolve, now, reducedMotion.matches, duration, entry.model, trash);
    entry.trashDrop = drop; trashDrops++; entry.posed = null; if (!entry.model.visible) casterListDirty = true; entry.model.visible = true; inspectionOverview = null;
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
      const stationary = bookEntries.every(entry => !entry.insertion && !entry.trashDrop && !easing(entry) &&
        !entry.node?.matches('.is-pressed, .is-lifted, .is-dragging') &&
        [cell(entry, 5), cell(entry, 6), cell(entry, 7)].every(value => Math.abs(value) <= .220001) &&
        !entry.lampTint?.moving() &&
        !(entry.lampPower?.duration && entry.lampPower.from !== entry.lampPower.target &&
          now < entry.lampPower.started + entry.lampPower.duration));
      if (!stationary) return;
      const pressure = bookEntries.some(entry => cell(entry, 5) || cell(entry, 6) || cell(entry, 7));
      if (pressure) inspectionSnapshot = null;
      for (const entry of bookEntries) {
        settleLift(entry, now);
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
      // Its power eases from the shown one to the switch's (rust-ui/src/scene_host.rs).
      rust.scene_lamp_switch(entry, isOn, Boolean(animate && !reducedMotion.matches));
      inspectionOverview = null; shelfSnapshotDirty = true;
      invalidate(false);
    },
    setLampKelvin(node, kelvin, { animate = true } = {}) {
      const entry = byNode.get(node);
      if (disposed || entry?.kind !== 'lamp') return;
      noteInspectionDirty('lamp-kelvin');
      // Its tint eases to the new temperature (rust-ui/src/scene_room.rs).
      rust.scene_lamp_kelvin(entry, kelvin, animate && !reducedMotion.matches, createTintTransition);
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
        trash.userData.setState({ openness:0 }); binStale = true;
        rust.scene_hide_trash_node(trashNode);
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
      return rust.scene_book_pose(projectShelfBookPose(furniture.matrixWorld, entry.pose.matrix, entry, stageRect), entry.rect, stageRect);
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
      const insertion = rust.scene_insertion_record(shelfBookSlot(entry, width, settleBooks && physicsStarted ? entry.pose.matrix.elements : null),
        reducedMotion.matches, duration, resolve, overlayCanvas, nativePresentation);
      if (nativePresentation) {
        insertion.nativeLease = createNativeInsertionLease(insertion);
        if (!insertion.nativeLease) return null;
      }
      entry.insertion = insertion; entry.posed = null;
      settleLift(entry, insertion.started);
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
      rust.scene_object_grip(entry, node, clientY, hitPoint);
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
      const now = performance.now(), count = bookEntries.length;
      if (previewBatch.length < count * 10) previewBatch = new Float64Array(count * 10);
      const io = previewBatch;
      let used = 0;
      for (let index = 0; index < count; index++) {
        const entry = bookEntries[index];
        const objectKey = String(entry.node?.dataset.objectId ?? entry.key);
        const placement = objectKey !== String(draggedKey) ? placements.get(objectKey) : null;
        const row = placement && rows[placement.shelf];
        const center = Number(placement?.center);
        if (row && Number.isFinite(center)) {
          const undershelf = entry.kind === 'lamp' && entry.mount === 'undershelf';
          io[used] = index; io[used + 1] = row.left || 0; io[used + 2] = undershelf ? row.ceiling ?? row.top : 0; io[used + 3] = row.bottom;
          io[used + 4] = center; io[used + 5] = entry.x; io[used + 6] = entry.y; io[used + 7] = entry.height; io[used + 8] = undershelf ? 1 : 0;
          used += 10;
        }
      }
      // The target of each placed object and every offset's easing, over the entry arena's own previews (Rust).
      const changed = entryFrame.preview(io.subarray(0, used), now, reducedMotion.matches);
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
          bookEntries.some(entry => entry.replacement || entry.plantQuality || entry.insertion || entry.trashDrop || easing(entry)))
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
        // The outgoing stage and buttons are restored, the new one takes the canvases (rust-ui/src/scene_room.rs).
        [originalHeight, originalTop, alreadyScene] = rust.scene_move_stage(stage, next.stage, originalHeight, originalTop, alreadyScene,
          originalStyles, semanticCovers, [canvas, inspectionCanvas, inspectionOverviewCanvas, nativeRoomClip]);
        stage = next.stage; stagePixelOffset = 0;
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
          trash = createShelfTrash(); trashBounds = trashFootprint(trash); furniture.add(trash); positionTrash(); binStale = true;
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
                // The outgoing node's hit target ceases to exist: a clone of its projected triangles and
                // cache moves to the new button, without reprojecting leaves (rust-ui/src/scene_host.rs).
                semanticFoliage.set(data.node,rust.scene_rebind_foliage(native,data.node));
              }
            }
            if (entry.node !== data.node) clearPlantDiagnostics(entry.node);
            Object.assign(entry, data); placeBoxes(entry);
          } else { entry.node = data.node; updateRecord(entry, data.book, data.style, data.coverUrl, data); }
        } else { entry = freshEntry(data, index); placeBoxes(entry); }
        // The new layout has already committed the preview's destination.
        // Retaining that offset would apply it twice; captured projected rects
        // are handed to animateFromRects for the remaining release movement
        // (`bind` below clears every preview and landing).
        // The outgoing DOM was just restored and the new one may be a fresh tree:
        // write every inline value of the projected nodes again and reread its state.
        entry.written = null; entry.leanNode = null; entry.lampShown = null; entry.walked = null; entry.domDirty = true;
        entry.key = key;
        retained.push(entry);
        if (entry.node && !originalStyles.has(entry.node)) originalStyles.set(entry.node, entry.node.getAttribute('style'));
      }
      for (const entry of oldEntries.values()) releaseEntry(entry);
      bookEntries = retained; casterIds = new Float64Array(bookEntries.length); casterListDirty = true; byNode.clear();
      entryFrame.bind(bookEntries, true); staticStale = true;
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
      if (dragged && cell(dragged, 5) > 0) {
        const state = entryFrame.state, at = dragged.row * ENTRY_STATE;
        state[at + 9] = 1; state[at + 10] = state[at + 5]; state[at + 11] = started; state[at + 12] = 520;
      }
      // Paint the old positions before yielding. Otherwise a synchronous
      // layout replacement can flash its final positions for one frame.
      cancelAnimationFrame(raf); raf = 0; draw(started);
    },
    dispose() {
      stage.style.top = originalTop;
      if (!disposed) { countFrame.free(); projectionFrame.free(); entryFrame.free(); sceneMotionFrame.free(); gravityFrame.free(); bookGravity.free(); roomMotion.free(); roomTransition.free(); clearTimeout(motionExpiry); }
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
      rust.scene_dispose_room(furniture, catalog, trash, lampLighting, lighting, [texture, grain], [wood, backWood, darkWood, ...depthOnly]);
      rust.scene_release_stage(stage, originalHeight, alreadyScene, originalStyles, [canvas, inspectionCanvas, inspectionOverviewCanvas]);
      inspectionSnapshot = inspectionOverview = null;
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
