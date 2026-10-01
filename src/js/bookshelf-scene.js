import * as THREE from 'three';
import { createBookModel, getBookRenderer, lightBookScene } from './book-model.js';
import { bookmarkFor } from './bookshelf-layout.js';
import { shelfBookSlot, shelfBookInsertion, projectShelfBookPose } from './bookshelf-return.js';
import { createShelfFurniture, createShelfOcclusion } from './shelf-furniture.js';
import { createShelfPlant } from './shelf-plants.js';
import { createShelfLamp } from './shelf-lamps.js';
import { createShelfLighting, widePenumbra } from './shelf-lighting.js';
import { createShelfLampLighting } from './shelf-lamp-lighting.js';
import { createShelfTrash, sampleTrashDrop } from './shelf-trash.js';
import { createShelfCatalog } from './shelf-catalog.js';
import { createBaggebo } from './baggebo-model.js';
import { BAGGEBO_SPEC, normalizeShelfType } from './shelf-types.js';

const WALNUT = new URL('../assets/library/walnut-pbr.webp', import.meta.url).href;
// Packed from the same photograph: R = pore/figure height, G = roughness.
const WALNUT_SURFACE = new URL('../assets/library/walnut-surface.webp', import.meta.url).href;
const DURATION = 700;
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const ease = t => t * t * t * (t * (t * 6 - 15) + 10);
const TRASH_PADDING = 7, TRASH_GAP = 12;
const SVG_NS = 'http://www.w3.org/2000/svg';
let foliageSerial = 0;
const PLANT_DIAGNOSTICS = ['plantModelCatalogId', 'plantModelDepth', 'plantLeafTexture', 'plantLeafOpacity'];
function clearPlantDiagnostics(node) { if (node) for (const key of PLANT_DIAGNOSTICS) delete node.dataset[key]; }

/** The native touch surface follows solid leaves, including fenestrations.
 * Project their actual front-facing triangles rather than a rectangular hull.
 * The resulting path is cached by the caller until the model's pose changes.
 */
export function projectPlantFoliage(model) {
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const paths = [];
  let triangles = 0;
  const coordinate = point => `${point.x.toFixed(2)},${(-point.y).toFixed(2)}`;
  model.traverse(mesh => {
    if (!mesh.isMesh || !/^(leaf(?:-\d+|-batch)|cactus(?:-column-\d+|-batch))$/.test(mesh.name)) return;
    const positions = mesh.geometry.attributes.position, indices = mesh.geometry.index;
    const count = indices ? indices.count : positions.count;
    const projected = new Float64Array(positions.count * 2);
    for (let i = 0; i < positions.count; i++) {
      a.fromBufferAttribute(positions, i).applyMatrix4(mesh.matrixWorld);
      projected[i * 2] = a.x; projected[i * 2 + 1] = a.y;
    }
    for (let i = 0; i < count; i += 3) {
      const ia = (indices ? indices.getX(i) : i) * 2, ib = (indices ? indices.getX(i + 1) : i + 1) * 2,
        ic = (indices ? indices.getX(i + 2) : i + 2) * 2;
      a.set(projected[ia], projected[ia + 1], 0); b.set(projected[ib], projected[ib + 1], 0);
      c.set(projected[ic], projected[ic + 1], 0);
      // All models have a closed lamina/body. Back faces add no visible hit
      // surface and would double both the path size and native hit-test work.
      const facing = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
      if (facing <= .0001) continue;
      paths.push(`M${coordinate(a)}L${coordinate(b)}L${coordinate(c)}Z`); triangles++;
    }
  });
  return { path:paths.join(''), triangles };
}

// Disjoint strips give an even-odd clip a true union of excluded book areas.
// Overlapping holes otherwise cancel each other and re-enable foliage hits.
function disjointRectangles(rectangles, outer) {
  const clipped = rectangles.map(rect => ({ left:Math.max(rect.left, outer.left), right:Math.min(rect.right, outer.right),
    top:Math.max(rect.top, outer.top), bottom:Math.min(rect.bottom, outer.bottom) }))
    .filter(rect => rect.right > rect.left && rect.bottom > rect.top);
  const edges = [...new Set(clipped.flatMap(rect => [rect.left, rect.right]))].sort((a, b) => a - b), strips = [];
  for (let i = 0; i < edges.length - 1; i++) {
    const left = edges[i], right = edges[i + 1], intervals = clipped.filter(rect => rect.left < right && rect.right > left)
      .sort((a, b) => a.top - b.top);
    let merged = null;
    for (const interval of intervals) {
      if (merged && interval.top <= merged.bottom) merged.bottom = Math.max(merged.bottom, interval.bottom);
      else { merged = { left, right, top:interval.top, bottom:interval.bottom }; strips.push(merged); }
    }
  }
  return strips;
}

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
  if (!rows.length || !Number.isFinite(width) || width <= padding * 2) return null;
  const localRay = worldRay.clone().applyMatrix4(furnitureMatrix.clone().invert());
  const point = localRay.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 0, 1), mountingDepth), new THREE.Vector3());
  if (!point) return null;
  const y = -point.y;
  let shelf = 0, nearest = Infinity;
  for (let index = 0; index < rows.length; index++) {
    const { top, bottom, left = 0, right = width } = rows[index];
    const localX = point.x + width / 2;
    const dx = localX < left ? left - localX : localX > right ? localX - right : 0;
    const dy = undershelf ? Math.abs(y - (rows[index].ceiling ?? top)) : y < top ? top - y : y > bottom ? y - bottom : 0;
    const distance = Math.hypot(dx, dy);
    if (distance < nearest) { nearest = distance; shelf = index; }
  }
  const { left = 0, right = width, padding:inset = padding } = rows[shelf];
  return { shelf, x:clamp((point.x + width / 2 - left - inset) / (right - left - inset * 2), 0, 1),
    ...(undershelf ? { mount:'undershelf' } : {}) };
}

function releaseObject(object) {
  const materials = new Set();
  object.traverse(child => {
    child.geometry?.dispose();
    for (const material of [].concat(child.material || [])) materials.add(material);
  });
  for (const material of materials) material.dispose();
}

function walnutTexture(url, renderer, colour, mean, onLoad) {
  const map = new THREE.TextureLoader().load(url, onLoad, undefined, () => {
    // A missing file must not leave its maps sampling an empty (black) unit:
    // zero roughness would turn the cabinet into a mirror. Flat mean instead.
    const swatch = document.createElement('canvas'), context = swatch.getContext('2d');
    swatch.width = swatch.height = 1;
    if (context) { context.fillStyle = mean; context.fillRect(0, 0, 1, 1); }
    map.image = swatch; map.needsUpdate = true; onLoad();
  });
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
  trashNode = null, catalogNode = null, mode = 'spine', shelfType = 'walnut', unitWidth = width, unitCount = 1 }) {
  shelfType = normalizeShelfType(shelfType);
  const renderer = getBookRenderer();
  if (!renderer || !width || !height) return null;
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) return null;
  canvas.className = 'ihr-bookshelf-scene';
  canvas.setAttribute('aria-hidden', 'true');
  Object.assign(canvas.style, { position:'sticky', top:'0', left:'0', display:'block', pointerEvents:'none', zIndex:'0' });
  let originalHeight = stage.style.height;
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
  const lampLighting = createShelfLampLighting(scene);
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
  let floorY = -height, floorLit = false;
  let depth = shelfType === 'baggebo' ? BAGGEBO_SPEC.depth * unitWidth / BAGGEBO_SPEC.width
    : Math.max(155, ...entries.filter(e => e.kind !== 'plant' && e.kind !== 'lamp').map(e => e.width + 12),
      ...entries.filter(e => e.kind === 'lamp' && e.mount !== 'undershelf').map(e => (e.depth || e.width) + 12));
  const entryKey = (entry, index) => entry.kind === 'plant' || entry.kind === 'lamp'
    ? `${entry.kind}:${entry.node?.dataset.objectId ?? entry.key ?? index}`
    : `book:${String(entry.book?.id ?? entry.node?.dataset.bookId ?? entry.book?.path ?? entry.book?.title ?? index)}`;
  const freshPreview = () => ({ x:0, y:0, fromX:0, fromY:0, targetX:0, targetY:0, started:0, active:false });
  const freshEntry = (entry, index) => ({ ...entry, key:entryKey(entry, index), model:null, replacement:null, pose:new THREE.Object3D(),
    lift:{ value:0, from:0, target:0, started:0 }, landing:null, offset:{ x:0, y:0 }, preview:freshPreview(), state:'', rect:null, insertion:null,
    overview:false, inspectionResolution:0, qualityReplacement:false, replacementReady:false });
  let bookEntries = entries.map(freshEntry);
  const byNode = new Map(bookEntries.filter(entry => entry.node).map(entry => [entry.node, entry]));
  const boardHeight = 15;
  function rebuildFurniture() {
    for (const object of [...furniture.children]) if (object.userData.furniture) {
      furniture.remove(object); object.userData.disposeGeometry?.();
    }
    let cabinet;
    if (shelfType === 'baggebo') {
      cabinet = new THREE.Group(); cabinet.name = 'BAGGEBO units'; cabinet.userData.furniture = true;
      const units = [];
      for (let index = 0; index < unitCount; index++) {
        const unit = createBaggebo({ width:unitWidth });
        unit.position.x = -width / 2 + unitWidth / 2 + index * (unitWidth + 24 * unitWidth / BAGGEBO_SPEC.width);
        cabinet.add(unit); units.push(unit);
      }
      cabinet.userData.disposeGeometry = () => { for (const unit of units) unit.userData.dispose(); };
    } else cabinet = createShelfFurniture({ width, height, depth, rows, wood, backWood, darkWood });
    furniture.add(cabinet);
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
    floor.geometry = new THREE.BoxGeometry(width + 210, 2, depth + 210);
    floor.geometry.computeBoundingBox();
    floor.position.set(55, floorY - 1, -depth / 2 + 45);
    positionTrash();
  }
  function rebuildOcclusion() {
    occlusion.geometry.dispose();
    floorLit = darkPage();
    occlusion.visible = shelfType !== 'baggebo';
    if (shelfType === 'baggebo') { occlusion.geometry = new THREE.BufferGeometry(); return; }
    occlusion.geometry = createShelfOcclusion({ width, height, depth, rows, floorY, floorLight:floorLit ? DARK_FLOOR_LIGHT : null,
      footprints:trash ? [{ x:trash.position.x, z:trash.position.z, radius:trash.userData.radius }] : [] });
  }
  function positionTrash() {
    if (trash) {
      // Its local placement is a real object on the floor, independent of the
      // camera, viewport, scroll and the progress of a view transition.
      trash.position.set(width / 2 + TRASH_GAP + trash.userData.radius,
        floorY - trashBounds.min.y, -depth);
      trash.rotation.set(0, 0, 0); trash.scale.setScalar(1); trash.visible = true;
    }
    rebuildOcclusion();
  }
  rebuildFurniture();

  let disposed = false, raf = 0, renderCount = 0, modelCreations = 0, viewportHeight = 1, progress = mode === 'isometric' ? 1 : 0;
  let shelfSnapshotDirty = true, shelfSnapshotRenders = 0;
  // A scroll only moves the camera: world-space shadows stay valid unless
  // something in the scene changed (or the lighting's fitted window moved).
  let shadowDirty = true, shadowCasters = 0;
  let transition = null, reorderTransition = null;
  let frontalScroll = mode === 'isometric' ? 0 : scroller.scrollTop;
  let sceneFitHeight = 1;
  let edgeToEdge = false;
  let dropMarker = null, dropPosition = null;
  let desiredMode = mode === 'isometric' ? 'isometric' : 'spine';
  let inspectionZoom = 1, panX = 0, panY = 0, inspectionMoving = false;
  let trashHover = false, trashOpenness = 0, trashTransition = null;
  let trashRect = null;
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
    for (const [attribute, value] of [['style', original.style], ['tabindex', original.tabIndex], ['aria-hidden', original.ariaHidden]]) {
      if (value === null) node.removeAttribute(attribute); else node.setAttribute(attribute, value);
    }
    node.hidden = original.hidden;
    delete node.dataset.catalog3d; delete node.dataset.catalogVisible; delete node.dataset.catalogViewHidden;
  }
  rememberCatalogNode(catalogNode);
  const vector = new THREE.Vector3(), inverseRotation = new THREE.Quaternion();
  const shadowBounds = new THREE.Box3(), shadowTrash = new THREE.Box3();
  const projectedMatrix = new THREE.Matrix4();
  const rendererSize = new THREE.Vector2();
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const corners = (box, transform) => {
    let left = Infinity, right = -Infinity, top = Infinity, bottom = -Infinity, closest = -Infinity;
    for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
      vector.set(x, y, z).applyMatrix4(transform);
      left = Math.min(left, vector.x); right = Math.max(right, vector.x);
      top = Math.min(top, -vector.y); bottom = Math.max(bottom, -vector.y); closest = Math.max(closest, vector.z);
    }
    return { left, right, top, bottom, width:right - left, height:bottom - top, closest };
  };
  const fullBounds = shelfType === 'baggebo'
    ? new THREE.Box3(new THREE.Vector3(-width / 2, -height, -depth), new THREE.Vector3(width / 2, 0, 0))
    : new THREE.Box3(new THREE.Vector3(-width / 2, -height - boardHeight, -depth - 4), new THREE.Vector3(width / 2, 2, 12));
  const slotBox = entry => {
    if (entry.kind === 'lamp') return new THREE.Box3(
      new THREE.Vector3(-entry.width / 2, entry.mount === 'undershelf' ? -entry.height : 0, -(entry.depth || entry.width) / 2),
      new THREE.Vector3(entry.width / 2, entry.mount === 'undershelf' ? 0 : entry.height, (entry.depth || entry.width) / 2)
    );
    const plant = entry.kind === 'plant';
    return new THREE.Box3(
      new THREE.Vector3(-entry.width / 2 - (plant ? 0 : entry.thickness * .38), -entry.height / 2, -(plant ? entry.width * .35 : entry.thickness / 2)),
      new THREE.Vector3(entry.width / 2, entry.height / 2 + (plant ? 0 : 20), plant ? entry.width * .35 : entry.thickness / 2)
    );
  };
  const spineHitBox = entry => new THREE.Box3(
    new THREE.Vector3(-entry.width / 2 - entry.thickness * .38, -entry.height / 2, -entry.thickness / 2),
    new THREE.Vector3(-entry.width / 2, entry.height / 2, entry.thickness / 2)
  );
  for (const entry of bookEntries) entry.box = slotBox(entry);

  function materialKeys(entry) {
    const { book, style, coverUrl } = entry;
    return {
      spine:JSON.stringify([style, book.spineTitleOverride, book.title, book.author, book.spineFontSize,
        book.spineAuthorFontSize, book.spineFinish, book.spineTextFinish, book.spineTextColor, book.spineEngraved]),
      cover:JSON.stringify([coverUrl, style.coverRatio, style.color, !coverUrl && [book.title, book.author, book.format, style.fontFamily]]),
      coverFinish:book.coverFinish,
      edgeFinish:book.pageEdgeFinish,
      bookmark:JSON.stringify(bookmarkFor(book))
    };
  }

  const plantKeys = entry => JSON.stringify([entry.width, entry.height, entry.variant, entry.catalogId, entry.potId, entry.potColorId, entry.seed]);
  const lampKeys = entry => JSON.stringify([entry.lampId, entry.width, entry.height, entry.depth, entry.mount]);

  function makeModel(entry) {
    const model = entry.kind === 'plant' ? createShelfPlant(entry)
      : entry.kind === 'lamp' ? createShelfLamp({ lampId:entry.lampId, width:entry.width, height:entry.height, quality:'high' })
      : createBookModel(entry.book, entry.style, entry.width, entry.height, entry.thickness, entry.coverUrl, { shelf:true, overview:entry.overview, inspectionResolution:entry.inspectionResolution });
    model.userData.invalidate = invalidate;
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
    if (entry.kind === 'lamp') model.userData.shelfLampKeys = lampKeys(entry);
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

  function updateTrash(scroll, now, finishedDrops) {
    if (!trash || !trashNode) {
      for (const key of ['trash3d', 'trashHover', 'trashVisible', 'trashViewHidden', 'trashLocalPosition', 'trashLocalScale',
        'trashLocalRotation', 'trashFootY', 'cabinetFloorY', 'trashCameraInFrame', 'trashFootWorld', 'floorContactWorld'])
        delete canvas.dataset[key];
      return false;
    }
    const scrollerBounds = scroller.getBoundingClientRect();
    const visualBottom = window.visualViewport
      ? window.visualViewport.offsetTop + window.visualViewport.height : window.innerHeight;
    const visibleBottom = Math.min(scrollerBounds.bottom, window.innerHeight || Infinity,
      Number.isFinite(visualBottom) && visualBottom > 0 ? visualBottom : Infinity);
    const viewHidden = desiredMode !== 'isometric' || progress < .86;
    if (viewHidden) {
      trashHover = false; trashTransition = null; trashOpenness = 0;
      trashNode.classList.remove('is-over');
    }
    let moving = false;
    const dropEntry = bookEntries.find(entry => entry.trashDrop);
    const drop = dropEntry?.trashDrop;
    if (trashTransition) {
      const t = reducedMotion.matches ? 1 : clamp((now - trashTransition.started) / 170, 0, 1);
      trashOpenness = trashTransition.from + (trashTransition.to - trashTransition.from) * ease(t);
      moving ||= t < 1;
      if (t === 1) trashTransition = null;
    }
    let openness = trashOpenness, bounce = 0;
    if (drop) {
      if (!drop.complete) {
        drop.elapsed += Math.min(50, Math.max(0, now - drop.lastFrame));
        drop.lastFrame = now;
      }
      const t = drop.duration > 0 ? clamp(drop.elapsed / drop.duration, 0, 1) : 1;
      const close = smoothTrash(clamp((t - .78) / .22, 0, 1));
      openness = (drop.initialOpenness + (1 - drop.initialOpenness) * ease(clamp(t / .2, 0, 1))) * (1 - close);
      bounce = clamp((t - .84) / .16, 0, 1);
      trash.userData.setState({ openness, bounce });
      trash.updateMatrixWorld(true);
      if (dropEntry.model && !drop.complete) {
        const worldScale = trash.getWorldScale(new THREE.Vector3()).x;
        const tiltedWidth = dropEntry.width * Math.cos(.46) + dropEntry.height * Math.sin(.46);
        const endScale = Math.min(.19 * worldScale, trash.userData.radius * 1.45 * worldScale / Math.max(1, tiltedWidth));
        const motion = sampleTrashDrop(drop.start, trash.userData.getMouth(), t,
          { height:dropEntry.height, scale:drop.startScale, endScale });
        dropEntry.model.position.copy(motion.position);
        dropEntry.model.scale.setScalar(motion.scale);
        trash.getWorldQuaternion(drop.endQuaternion).multiply(drop.bookQuaternion);
        dropEntry.model.quaternion.copy(drop.startQuaternion).slerp(drop.endQuaternion, motion.turn);
        dropEntry.model.updateMatrixWorld(true);
        const flightBounds = corners(dropEntry.box, dropEntry.model.matrixWorld);
        const rightOverflow = Math.max(0, flightBounds.right - sceneWidth + 3);
        // The pointer may leave a broad book partly outside the canvas at
        // release. Bend its first few frames inward instead of snapping its
        // starting pose or clipping the newly exposed cover for the flight.
        if (rightOverflow) {
          dropEntry.model.position.x -= rightOverflow * ease(clamp(t / .14, 0, 1));
          dropEntry.model.updateMatrixWorld(true);
        }
      }
      const value = t.toFixed(4);
      trashNode.dataset.trashDropProgress = trashNode.dataset.dropProgress = value;
      canvas.dataset.trashDropProgress = value;
      canvas.dataset.trashingBookId = String(dropEntry.book?.id ?? '');
      canvas.dataset.trashingObjectId = String(dropEntry.node?.dataset.objectId ?? dropEntry.key);
      canvas.dataset.trashingObjectKind = dropEntry.kind === 'plant' || dropEntry.kind === 'lamp' ? dropEntry.kind : 'book';
      moving ||= t < 1;
      if (t === 1 && !drop.complete) {
        drop.complete = true;
        trashOpenness = 0; trashHover = false; trashTransition = null;
        dropEntry.model.visible = false;
        finishedDrops.push(() => { if (!drop.settled) { drop.settled = true; drop.resolve(true); } });
      }
    } else {
      trash.userData.setState({ openness });
      trash.updateMatrixWorld(true);
    }
    const bounds = new THREE.Box3().setFromObject(trash);
    trashRect = corners(bounds, new THREE.Matrix4());
    const stageBounds = stage.getBoundingClientRect();
    const screenTop = stageBounds.top + trashRect.top, screenBottom = stageBounds.top + trashRect.bottom;
    const screenLeft = stageBounds.left + trashRect.left, screenRight = stageBounds.left + trashRect.right;
    const inFrame = trashRect.right > 0 && trashRect.left < sceneWidth &&
      trashRect.bottom > scroll && trashRect.top < scroll + viewportHeight;
    const visible = !viewHidden && inFrame &&
      screenBottom > Math.max(0, scrollerBounds.top) && screenTop < visibleBottom &&
      screenRight > Math.max(0, scrollerBounds.left) && screenLeft < Math.min(window.innerWidth, scrollerBounds.right);
    trashNode.hidden = !visible; trashNode.inert = !visible; trashNode.tabIndex = visible ? 0 : -1;
    trashNode.setAttribute('aria-hidden', String(!visible));
    const hitWidth = Math.max(44, trashRect.width + TRASH_PADDING * 2), hitHeight = Math.max(44, trashRect.height + TRASH_PADDING * 2);
    const hitLeft = clamp((trashRect.left + trashRect.right - hitWidth) / 2, 0, Math.max(0, sceneWidth - hitWidth));
    const hitTop = clamp((trashRect.top + trashRect.bottom - hitHeight) / 2, scroll,
      Math.max(scroll, Math.min(scroll + viewportHeight, sceneFitHeight) - hitHeight));
    Object.assign(trashNode.style, { position:'absolute', left:`${hitLeft}px`, top:`${hitTop}px`, width:`${hitWidth}px`,
      height:`${hitHeight}px`, margin:'0', zIndex:'50', pointerEvents:visible ? 'auto' : 'none' });
    trashNode.dataset.trash3d = 'true';
    trashNode.dataset.trashVisible = String(visible); trashNode.dataset.trashViewHidden = String(viewHidden);
    trashNode.dataset.trashHover = trashNode.dataset.hover = String(trashHover);
    canvas.dataset.trash3d = 'true'; canvas.dataset.trashHover = String(trashHover);
    canvas.dataset.trashVisible = String(visible); canvas.dataset.trashViewHidden = String(viewHidden);
    const footY = trash.position.y + trashBounds.min.y * trash.scale.y;
    const footWorld = furniture.localToWorld(new THREE.Vector3(trash.position.x, footY, trash.position.z));
    const floorContact = furniture.localToWorld(new THREE.Vector3(trash.position.x, floorY, trash.position.z));
    const diagnostic = { trashLocalPosition:trash.position.toArray().map(value => value.toFixed(6)).join(','),
      trashLocalScale:trash.scale.x.toFixed(6), trashLocalRotation:trash.rotation.toArray().slice(0, 3).join(','),
      trashFootY:footY.toFixed(6), cabinetFloorY:floorY.toFixed(6), trashCameraInFrame:String(inFrame),
      trashFootWorld:footWorld.toArray().map(value => value.toFixed(6)).join(','),
      floorContactWorld:floorContact.toArray().map(value => value.toFixed(6)).join(','),
      trashRadius:String(trash.userData.radius), trashHeight:String(trash.userData.height) };
    Object.assign(trashNode.dataset, diagnostic); Object.assign(canvas.dataset, diagnostic);
    return moving;
  }

  const smoothTrash = t => t * t * (3 - 2 * t);

  function hitTrash(clientX, clientY) {
    if (!trash || !trashNode || disposed) return false;
    if (raf) { cancelAnimationFrame(raf); raf = 0; draw(); }
    if (desiredMode !== 'isometric' || trashNode.hidden || !trash.visible) return false;
    const rect = trashNode.getBoundingClientRect();
    return clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom;
  }

  function cancelInsertion(entry) {
    const insertion = entry.insertion;
    entry.insertion = null;
    insertion?.resolve();
  }

  function replaceWhenReady(entry) {
    cancelReplacement(entry);
    const previous = entry.model, replacement = makeModel(entry);
    entry.replacement = replacement;
    Promise.resolve(replacement.userData.ready).then(loaded => {
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
      furniture.add(replacement);
      if (previous) { furniture.remove(previous); previous.userData.dispose?.(); }
      invalidate();
    }, () => {
      if (entry.replacement === replacement) entry.replacement = null;
      releaseCandidate(replacement);
    });
  }

  const qualityMatches = (model,entry) => Boolean(model?.userData.overview) === entry.overview && (model?.userData.inspectionResolution || 0) === entry.inspectionResolution;

  function replaceBookQuality(entry) {
    if (entry.qualityReplacement && entry.replacement && !qualityMatches(entry.replacement,entry))
      cancelReplacement(entry);
    if (entry.replacement) return;
    const previous = entry.model, replacement = makeModel(entry);
    entry.replacement = replacement; entry.qualityReplacement = true;
    Promise.resolve(replacement.userData.ready).then(loaded => {
      if (disposed || entry.replacement !== replacement || entry.model !== previous) {
        releaseCandidate(replacement); return;
      }
      if (loaded === false && previous && entry.coverUrl) { cancelReplacement(entry); return; }
      entry.replacementReady = true; invalidate();
    }, () => { if (entry.replacement === replacement) cancelReplacement(entry); });
  }

  function applyBookQuality(entry) {
    // A late cover decode can finish after the user has reversed the view or
    // pressed/released this book. Never paint the obsolete quality first.
    if (entry.qualityReplacement && entry.replacement && !qualityMatches(entry.replacement,entry)) {
      cancelReplacement(entry); return;
    }
    if (!entry.qualityReplacement || !entry.replacementReady || entry.trashDrop || entry.insertion ||
      entry.node?.classList.contains('is-away') || entry.node?.classList.contains('is-dragging')) return;
    const previous = entry.model;
    entry.model = entry.replacement; entry.replacement = null;
    entry.qualityReplacement = false; entry.replacementReady = false;
    furniture.add(entry.model);
    previous?.removeFromParent(); previous?.userData.dispose?.();
  }

  function updateMaterials(entry) {
    const model = entry.model;
    if (!model || entry.kind === 'plant' || entry.kind === 'lamp') return;
    const previous = model.userData.shelfKeys || {}, next = materialKeys(entry);
    if (previous.spine !== next.spine) model.userData.updateSpineAppearance?.(entry.book, entry.style);
    if (previous.cover !== next.cover) model.userData.updateCoverSource?.(entry.coverUrl, entry.book, entry.style);
    if (previous.coverFinish !== next.coverFinish) model.userData.updateCoverAppearance?.(entry.book);
    if (previous.edgeFinish !== next.edgeFinish) model.userData.updateEdgeAppearance?.(entry.book);
    if (previous.bookmark !== next.bookmark) {
      if (model.userData.updateBookmark) model.userData.updateBookmark(entry.book);
      else { replaceWhenReady(entry); return; }
    }
    model.userData.shelfKeys = next;
  }

  function updateRecord(entry, book, style, coverUrl, dimensions = null) {
    const oldDimensions = [entry.width, entry.height, entry.thickness];
    const baseline = entry.y + entry.height / 2;
    const previousRatio = entry.width / entry.height;
    const baseHeight = entry.height / (Number(entry.style.heightRatio) || 1);
    entry.height = baseHeight * (Number(style.heightRatio) || Number(entry.style.heightRatio) || 1);
    const ratio = Number(style.coverRatio);
    entry.width = entry.height * (ratio > 0 && Number.isFinite(ratio) ? clamp(ratio, .25, 2.5) : previousRatio);
    entry.thickness = Number(style.width) || entry.thickness;
    entry.y = baseline - entry.height / 2;
    if (dimensions) for (const field of ['width', 'height', 'thickness', 'x', 'y', 'depthInset', 'shelf']) if (dimensions[field] !== undefined) entry[field] = dimensions[field];
    if (shelfType === 'baggebo' && !dimensions) {
      const row = rows[entry.shelf], scale = unitWidth / BAGGEBO_SPEC.width;
      const fit = Math.min(1, BAGGEBO_SPEC.usableDepth * scale / entry.width,
        row ? (row.bottom - row.top - 4 * scale) / entry.height : 1);
      entry.height *= fit; entry.width *= fit; entry.y = baseline - entry.height / 2;
    }
    entry.book = book; entry.style = style; entry.coverUrl = coverUrl;
    entry.box = slotBox(entry);
    fitDepth(entry.width + 12);
    if (entry.model) {
      const changedShape = oldDimensions.some((value, i) => Math.abs(value - [entry.width, entry.height, entry.thickness][i]) > .01);
      if (changedShape || entry.replacement) replaceWhenReady(entry);
      else updateMaterials(entry);
    }
  }

  function fitDepth(nextDepth) {
    if (shelfType === 'baggebo') return;
    if (nextDepth <= depth) return;
    depth = nextDepth;
    rebuildFurniture();
    fullBounds.min.z = -depth - 4;
  }

  function updateWoodTheme() {
    const tones = WOOD_TONES[darkPage() ? 'dark' : 'light'];
    wood.color.set(tones.wood); backWood.color.set(tones.back); darkWood.color.set(tones.trim);
    // Floor contact reads softer on a pale page than on a near-black one.
    occlusionMaterial.opacity = tones === WOOD_TONES.dark ? 1 : .8;
    if (floorLit !== darkPage()) rebuildOcclusion();
  }

  function stateFor(entry) {
    const node = entry.node;
    if (!node) return '';
    return [node.classList.contains('is-away'), node.classList.contains('is-dragging'), node.classList.contains('is-lifted'),
      node.classList.contains('is-pressed'), node.style.getPropertyValue('--ihr-drag-x'), node.style.getPropertyValue('--ihr-drag-y')].join('|');
  }

  function viewport() {
    const availableHeight = edgeToEdge && progress === 1 ? sceneFitHeight : scroller.clientHeight || window.innerHeight;
    viewportHeight = Math.max(1, Math.ceil(Math.min(availableHeight, window.innerHeight)));
    const ratio = Math.min(window.devicePixelRatio || 1, inspectionZoom > 1.001 && desiredMode === 'isometric' ? 2.5 : width < 600 ? 1.5 : 2);
    const pixelWidth = Math.ceil(sceneWidth * ratio), pixelHeight = Math.ceil(viewportHeight * ratio);
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth; canvas.height = pixelHeight; shelfSnapshotDirty = true;
    }
    canvas.style.width = `${sceneWidth}px`; canvas.style.height = `${viewportHeight}px`;
    canvas.style.marginBottom = `${-viewportHeight}px`;
    // Read the actual sticky position: near the last shelf its bottom is
    // constrained by the stage, so scroller.scrollTop alone would double-shift
    // the drawing and leave it out of alignment with the real DOM hit targets.
    const scroll = Math.max(0, canvas.getBoundingClientRect().top - stage.getBoundingClientRect().top);
    camera.left = 0; camera.right = sceneWidth; camera.top = 0; camera.bottom = -viewportHeight;
    camera.position.y = -scroll; camera.updateProjectionMatrix();
    return { scroll, ratio };
  }

  function measureFitHeight() {
    const clip = scroller.getBoundingClientRect(), stageBounds = stage.getBoundingClientRect();
    const style = getComputedStyle(scroller);
    edgeToEdge = style.getPropertyValue('--ihr-scene-edge-to-edge').trim() === '1';
    const bottomPadding = parseFloat(style.paddingBottom) || 0;
    // The stage's resting top includes the actual library heading, empty
    // copy and padding, even when the frontal shelf is scrolled far down.
    const restingTop = stageBounds.top + scroller.scrollTop;
    return Math.max(1, Math.floor(Math.min(window.innerHeight, clip.bottom) - Math.max(clip.top, restingTop) - bottomPadding) - (edgeToEdge ? 0 : 2));
  }

  function updateTransform() {
    updateDropMarker();
    const yaw = -Math.PI / 6 * progress, pitch = 14 * Math.PI / 180 * progress;
    // The complete object turns around one axis. A modest additional pullback
    // leaves room around the diagonal furniture instead of cropping its edges.
    furniture.position.set(0, 0, 0); furniture.rotation.set(pitch, yaw, 0); furniture.scale.setScalar(1);
    furniture.updateMatrix();
    const unscaled = corners(fullBounds, furniture.matrix);
    sceneFitHeight = measureFitHeight();
    const padding = (edgeToEdge ? 0 : 8) * progress;
    const framedBounds = fullBounds.clone();
    if (trash) framedBounds.union(trashBounds.clone().translate(trash.position));
    const framed = corners(framedBounds, furniture.matrix);
    // The same camera framing turns and pulls back from the whole room.
    // At the frontal endpoint the bin is naturally beyond the right crop;
    // the diagonal endpoint includes it without any object reveal animation.
    const frameLeft = unscaled.left + (framed.left - unscaled.left) * progress;
    const frameRight = unscaled.right + (framed.right - unscaled.right) * progress;
    const widthZoom = Math.min((1 - .22 * progress) * Math.min(1, width / unscaled.width),
      (sceneWidth - padding * 2 - TRASH_PADDING * 2 * progress) / (frameRight - frameLeft));
    // Pull back far enough to see every shelf, its feet and the open lid.
    // Interpolating the height constraint preserves the frontal close view.
    const heightZoom = Math.min(1, (sceneFitHeight - padding * 2) / Math.max(1, framed.height));
    const fitZoom = Math.max(.0001, Math.min(widthZoom, 1 + (heightZoom - 1) * progress));
    furniture.scale.setScalar(fitZoom); furniture.updateMatrix();
    const bounds = corners(framedBounds, furniture.matrix);
    const factor = 1 + (inspectionZoom-1)*progress, zoom = fitZoom*factor;
    panX = clamp(panX,-(inspectionZoom-1)*sceneWidth/2-(inspectionMoving ? 80 : 0),(inspectionZoom-1)*sceneWidth/2+(inspectionMoving ? 80 : 0));
    panY = clamp(panY,-(inspectionZoom-1)*sceneFitHeight/2-(inspectionMoving ? 80 : 0),(inspectionZoom-1)*sceneFitHeight/2+(inspectionMoving ? 80 : 0));
    const reserve = (frameRight - frameLeft - unscaled.width) * fitZoom;
    const baseX = sceneWidth/2 - (frameLeft+frameRight)*fitZoom/2, baseY = bounds.top-padding;
    furniture.scale.setScalar(zoom);
    furniture.position.set(baseX*factor + (1-factor)*sceneWidth/2 + panX*progress,
      baseY*factor - (1-factor)*sceneFitHeight/2 - panY*progress,0);
    furniture.updateMatrixWorld(true);
    // Matrix arithmetic can produce fitHeight + 1e-12; do not round that
    // into a new CSS pixel and recreate a scrollbar in the fitted overview.
    const objectHeight = Math.ceil(bounds.height + padding * 2 - 1e-7);
    // The mobile zoom surface fills the screen below the library controls.
    // A shorter fitted cabinet must not crop zoomed books inside its own box.
    const stageHeight = edgeToEdge ? objectHeight + Math.max(0, sceneFitHeight - objectHeight) * progress : objectHeight;
    stage.style.height = `${stageHeight}px`;
    canvas.dataset.shelfView = desiredMode;
    canvas.dataset.viewProgress = String(Number(progress.toFixed(4)));
    canvas.dataset.yaw = (-30 * progress).toFixed(3);
    canvas.dataset.pitch = (14 * progress).toFixed(3);
    canvas.dataset.zoom = zoom.toFixed(4);
    canvas.dataset.inspectionZoom = inspectionZoom.toFixed(4);
    canvas.dataset.inspectionMoving = String(inspectionMoving);
    canvas.dataset.inspectionPan = JSON.stringify([panX,panY]);
    canvas.dataset.cabinetWidth = String(width); canvas.dataset.trashReserve = reserve.toFixed(3);
    canvas.dataset.shelfType = shelfType;
    canvas.dataset.shelfUnits = String(unitCount);
    canvas.dataset.shelfDimensions = shelfType === 'baggebo' ? JSON.stringify(BAGGEBO_SPEC.dimensions) : '';
    canvas.dataset.sceneFitHeight = String(sceneFitHeight); canvas.dataset.floorVisible = String(floor.visible);
    const framedWorld = corners(framedBounds, furniture.matrixWorld);
    canvas.dataset.fullCabinetInFrame = String(framedWorld.left >= -.01 && framedWorld.right <= sceneWidth + .01 &&
      framedWorld.top >= -.01 && framedWorld.bottom <= sceneFitHeight + .01);
    inverseRotation.copy(furniture.quaternion).invert();
    return zoom;
  }

  function updateCatalog(scroll) {
    if (!catalog || !catalogNode) {
      delete canvas.dataset.catalog3d; delete canvas.dataset.catalogVisible;
      return;
    }
    const first = rows[0] || { top:20, bottom:220 };
    const center = first.top + Math.max(68, Math.min(120, (first.bottom - first.top) * .5));
    catalog.position.set(width / 2 + 3, -center, -depth * .52);
    catalog.rotation.set(0, Math.PI / 2, -.025);
    // It faces the right wall's exterior. During the turn it appears only
    // after that side becomes visible; the final frontal view has no booklet.
    catalog.visible = progress > .36;
    catalog.updateMatrixWorld(true);
    const bounds = corners(catalog.userData.bounds, catalog.matrixWorld);
    const viewHidden = desiredMode !== 'isometric' || progress < .86;
    const stageBounds = stage.getBoundingClientRect(), clip = scroller.getBoundingClientRect();
    const screenTop = stageBounds.top + bounds.top, screenBottom = stageBounds.top + bounds.bottom;
    const screenLeft = stageBounds.left + bounds.left, screenRight = stageBounds.left + bounds.right;
    // A stage below an empty-library message can be outside the actual screen
    // even while its local coordinates lie inside the virtual camera window.
    const visible = !viewHidden && bounds.bottom > scroll && bounds.top < scroll + viewportHeight &&
      screenBottom > Math.max(0, clip.top) && screenTop < Math.min(window.innerHeight, clip.bottom) &&
      screenRight > Math.max(0, clip.left) && screenLeft < Math.min(window.innerWidth, clip.right);
    const targetWidth = Math.max(44, bounds.width), targetHeight = Math.max(44, bounds.height);
    catalogNode.hidden = !visible;
    catalogNode.tabIndex = visible ? 0 : -1;
    catalogNode.setAttribute('aria-hidden', String(!visible));
    Object.assign(catalogNode.style, { position:'absolute', left:`${bounds.left - (targetWidth - bounds.width) / 2}px`,
      top:`${bounds.top - (targetHeight - bounds.height) / 2}px`, width:`${targetWidth}px`, height:`${targetHeight}px`, margin:'0',
      // Isometric object envelopes include empty space behind the side wall.
      // Keep the tangible booklet above those otherwise invisible hit boxes.
      zIndex:String(height + 1000), pointerEvents:visible ? 'auto' : 'none' });
    catalogNode.dataset.catalog3d = 'true'; catalogNode.dataset.catalogVisible = String(visible);
    catalogNode.dataset.catalogViewHidden = String(viewHidden);
    canvas.dataset.catalog3d = 'true'; canvas.dataset.catalogVisible = String(visible);
  }

  function updateEntries(scroll, zoom, now, finishedInsertions) {
    let activeBooks = 0, moving = false, shelfMoving = false;
    for (const entry of bookEntries) {
      const node = entry.node, plant = entry.kind === 'plant', lamp = entry.kind === 'lamp';
      const decorative = plant || lamp, undershelf = lamp && entry.mount === 'undershelf';
      const dragging = node?.classList.contains('is-dragging');
      const lifted = dragging || node?.classList.contains('is-lifted');
      const away = node?.classList.contains('is-away');
      const previewChanged = advancePreview(entry, now);
      moving ||= entry.preview.active;
      shelfMoving ||= !away && (previewChanged || entry.preview.active);
      // A completed insertion remains painted until its owner restores the
      // semantic shelf book. This avoids an empty frame at the final handoff.
      if (entry.insertion?.complete && !away) entry.insertion = null;
      const insertion = entry.insertion;
      const targetLift = lifted ? 1 : node?.classList.contains('is-pressed') ? .22 : 0;
      const previousLift = entry.lift.value;
      let changingLift;
      if (entry.landing && targetLift === 0) {
        const t = reducedMotion.matches ? 1 : clamp((now - entry.landing.started) / entry.landing.duration, 0, 1);
        entry.lift.value = entry.landing.from * (1 - ease(clamp((t - .7) / .3, 0, 1)));
        Object.assign(entry.lift, { from:entry.lift.value, target:0, started:now });
        changingLift = t < 1 && entry.landing.from > 0;
        if (t === 1) entry.landing = null;
      } else {
        entry.landing = null;
        if (entry.lift.target !== targetLift) {
          entry.lift.from = entry.lift.value; entry.lift.target = targetLift; entry.lift.started = now;
        }
        const liftTime = reducedMotion.matches ? 1 : clamp((now - entry.lift.started) / 160, 0, 1);
        entry.lift.value = entry.lift.from + (entry.lift.target - entry.lift.from) * ease(liftTime);
        changingLift = liftTime < 1 && entry.lift.from !== entry.lift.target;
      }
      moving ||= changingLift;
      shelfMoving ||= !away && (changingLift || previousLift !== entry.lift.value);
      const lift = entry.lift.value;
      const screenX = (dragging ? parseFloat(node.style.getPropertyValue('--ihr-drag-x')) || 0 : 0) + entry.offset.x;
      const screenY = (dragging ? parseFloat(node.style.getPropertyValue('--ihr-drag-y')) || 0 : 0) + entry.offset.y - 18 * lift;
      vector.set(screenX / zoom, -screenY / zoom, 30 * lift / zoom).applyQuaternion(inverseRotation);
      entry.pose.position.set(entry.x - width / 2 + vector.x + entry.preview.x,
        -entry.y - (lamp && !undershelf ? entry.height / 2 : 0) + vector.y + entry.preview.y,
        (undershelf ? -depth / 2 : lamp ? -(entry.depth || entry.width) / 2 : plant ? -entry.width * .35 : -entry.width / 2)
          - (undershelf ? 0 : entry.depthInset || 0) + vector.z);
      entry.pose.rotation.set(decorative ? 4 * Math.PI / 180 * lift : 0,
        decorative ? -7 * Math.PI / 180 * lift : Math.PI / 2 - 7 * Math.PI / 180 * lift,
        decorative ? -3 * Math.PI / 180 * lift : 0);
      entry.pose.scale.setScalar(1 + .04 * lift);
      entry.pose.updateMatrix();
      projectedMatrix.multiplyMatrices(furniture.matrixWorld, entry.pose.matrix);
      const rect = corners(entry.box, projectedMatrix);
      entry.rect = rect;
      const trashDrop = entry.trashDrop;
      const visible = Boolean(trashDrop) || ((!away || insertion) && rect.bottom > scroll - 220 && rect.top < scroll + viewportHeight + 220);
      if (plant && visible && !trashDrop && !insertion && !away && !inspectionMoving) {
        entry.inspectionResolution = inspectionZoom > 1.001 && progress === 1 ? 256 : 0;
        if (entry.model && !qualityMatches(entry.model,entry)) replaceBookQuality(entry);
        applyBookQuality(entry);
      }
      if (!decorative && visible && !trashDrop && !insertion && !away && !inspectionMoving) {
        // Choose overview quality only after the global view settles, rather
        // than rebuilding repeatedly while the book crosses a size threshold.
        const stableView = !transition && (progress === 0 || progress === 1);
        if (lifted || node?.classList.contains('is-pressed')) entry.overview = false;
        else if (!entry.model && desiredMode === 'isometric' && rect.height < 90) entry.overview = true;
        else if (stableView) entry.overview = progress === 1 && rect.height < 90;
        const physicalHeight = rect.height*Math.min(window.devicePixelRatio || 1,2.5);
        const inspecting = inspectionZoom > 1.001 && progress === 1 && physicalHeight > 192;
        if (inspecting) entry.overview = false;
        entry.inspectionResolution = inspecting ? (physicalHeight > 900 ? 2048 : 1024) : 0;
        if (entry.model && !qualityMatches(entry.model,entry)) replaceBookQuality(entry);
        applyBookQuality(entry);
      }
      if (visible && !entry.model) {
        entry.model = makeModel(entry);
        furniture.add(entry.model);
      } else if (!visible && entry.model && !away) {
        releaseEntry(entry);
      }
      if (entry.model) {
        entry.model.visible = trashDrop ? !trashDrop.complete : !away || Boolean(insertion && !insertion.overlayCanvas);
        if (trashDrop) {
          moving ||= !trashDrop.complete;
          shelfMoving ||= !trashDrop.complete;
        } else if (insertion) {
          // The first depth pass can take longer while a mobile GPU warms up.
          // Advance in bounded frame steps instead of skipping the whole
          // insertion after one delayed frame.
          insertion.elapsed += Math.min(50, Math.max(0, now - insertion.lastFrame));
          insertion.lastFrame = now;
          const t = insertion.duration > 0 ? clamp(insertion.elapsed / insertion.duration, 0, 1) : 1;
          shelfBookInsertion(insertion.slot, entry.width, ease(t))
            .decompose(entry.model.position, entry.model.quaternion, entry.model.scale);
          canvas.dataset.returnProgress = t.toFixed(4);
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
      if (node) {
        // A whole-model bounding rectangle includes empty space around plants
        // and most of an isometric book's cover. Give each semantic button a
        // centre on its visible, solid surface instead: binding or ceramic pot.
        const surface = entry.model?.getObjectByName(plant ? 'ceramic-pot' : lamp ? undershelf ? 'lamp-housing' : 'lamp-base' : 'binding');
        let hitRect;
        if (surface?.geometry) {
          if (!surface.geometry.boundingBox) surface.geometry.computeBoundingBox();
          entry.model.updateMatrixWorld(true);
          hitRect = corners(surface.geometry.boundingBox, surface.matrixWorld);
        } else {
          const fallback = lamp ? entry.box : plant ? new THREE.Box3(
            new THREE.Vector3(-entry.width * .285, -entry.height / 2, -entry.width * .285),
            new THREE.Vector3(entry.width * .285, -entry.height / 2 + entry.height * .32, entry.width * .285)
          ) : spineHitBox(entry);
          hitRect = corners(fallback, projectedMatrix);
        }
        entry.hitRect = hitRect;
        node.style.position = 'absolute'; node.style.left = `${hitRect.left}px`; node.style.top = `${hitRect.top}px`;
        node.style.width = `${hitRect.width}px`; node.style.height = `${hitRect.height}px`;
        node.style.margin = '0'; node.style.zIndex = String(100 + Math.round(rect.closest + height));
        node.dataset.sceneProjected = 'true';
        node.dataset.sceneHitSurface = plant ? 'pot' : lamp ? undershelf ? 'ceiling-lamp' : 'lamp' : 'spine';
        if (lamp) {
          node.dataset.lampModelId = entry.lampId;
          node.dataset.lampMount = undershelf ? 'undershelf' : 'standing';
        }
        if (!decorative) {
          let coverHit = semanticCovers.get(node);
          if (!coverHit) {
            coverHit = document.createElement('span'); coverHit.setAttribute('aria-hidden', 'true');
            coverHit.dataset.shelfCoverHit = 'true'; semanticCovers.set(node, coverHit); node.append(coverHit);
          }
          // Keep tapping the exposed cover available without moving the
          // button's own focus/click centre away from its neighboring spine.
          // The existing handlers still raycast the true visible geometry.
          Object.assign(coverHit.style, { position:'absolute', left:`${rect.left - hitRect.left}px`,
            top:`${rect.top - hitRect.top}px`, width:`${rect.width}px`, height:`${rect.height}px`,
            display:progress > .04 ? 'block' : 'none', background:'transparent',
            pointerEvents:dragging || away || node.disabled || node.inert ? 'none' : 'inherit' });
        }
      }
      entry.state = stateFor(entry);
    }
    // Bind native hit surfaces only after all semantic book rectangles are
    // projected, so an overlapping leaf cannot steal a neighboring spine tap.
    for (const entry of bookEntries) if (entry.kind === 'plant' && entry.node) updatePlantFoliage(entry);
    canvas.dataset.activeBooks = String(activeBooks);
    canvas.dataset.previewAnimating = String(bookEntries.some(entry => entry.preview.active));
    canvas.dataset.previewObjects = String(bookEntries.filter(entry => Math.abs(entry.preview.x) + Math.abs(entry.preview.y) > .01).length);
    const inserting = bookEntries.filter(entry => entry.insertion);
    canvas.dataset.returningBooks = inserting.map(entry => String(entry.book?.id ?? '')).join(',');
    canvas.dataset.returningBookId = inserting.length === 1 ? String(inserting[0].book?.id ?? '') : '';
    canvas.dataset.returnRenderer = inserting.some(entry => entry.insertion.overlayCanvas) ? 'shared-depth-overlay' : 'shelf';
    if (!inserting.length) delete canvas.dataset.returnProgress;
    return { moving, shelfMoving };
  }

  function updatePlantFoliage(entry) {
    const { node, model, rect, hitRect } = entry;
    if (model?.userData.shelfPlantDiagnostics && !node.dataset.plantModelDepth)
      Object.assign(node.dataset, model.userData.shelfPlantDiagnostics);
    let native = semanticFoliage.get(node);
    if (!model?.visible || !rect || !hitRect || node.classList.contains('is-away') || node.classList.contains('is-dragging') || entry.trashDrop) {
      if (native) native.svg.style.display = 'none';
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
      native = { svg, path, exclusions, pose:'', model:null, clip:'' }; semanticFoliage.set(node, native);
    }
    // The pot keeps its own accessible focus/drag centre. Its child extends
    // over the leaves, but only painted triangles participate in hit testing.
    Object.assign(native.svg.style, { display:'block', left:`${rect.left - hitRect.left}px`,
      top:`${rect.top - hitRect.top}px`, width:`${rect.width}px`, height:`${rect.height}px` });
    native.svg.setAttribute('viewBox', `${rect.left} ${rect.top} ${rect.width} ${rect.height}`);
    native.path.style.pointerEvents = node.disabled || node.inert || node.style.pointerEvents === 'none' ? 'none' : 'fill';
    const pose = model.matrixWorld.elements.join(',');
    if (native.model !== model || native.pose !== pose) {
      const projected = projectPlantFoliage(model);
      native.path.setAttribute('d', projected.path); native.svg.dataset.triangles = String(projected.triangles);
      native.model = model; native.pose = pose;
    }
    const rectanglePath = bounds => `M${bounds.left},${bounds.top}H${bounds.right}V${bounds.bottom}H${bounds.left}Z`;
    const excluded = bookEntries.filter(other => other.kind !== 'plant' && other.model?.visible &&
      !other.node?.classList.contains('is-away') && !other.node?.classList.contains('is-dragging'))
      .map(other => progress > .04 ? other.rect : other.hitRect).filter(Boolean);
    // Inside these rectangles the existing native book surface already has
    // touch-action:none and resolves true mesh occlusion in its drag handler.
    // Clipping keeps book clicks native even if foliage is behind its cover.
    const clipping = rectanglePath(rect) + disjointRectangles(excluded, rect).map(rectanglePath).join('');
    if (native.clip !== clipping) {
      native.exclusions.setAttribute('d', clipping); native.clip = clipping;
    }
  }

  function advancePreview(entry, now) {
    const preview = entry.preview;
    if (!preview.active) return false;
    const t = reducedMotion.matches ? 1 : clamp((now - preview.started) / 130, 0, 1);
    const x = preview.fromX + (preview.targetX - preview.fromX) * ease(t);
    const y = preview.fromY + (preview.targetY - preview.fromY) * ease(t);
    const changed = x !== preview.x || y !== preview.y;
    preview.x = x; preview.y = y;
    if (t === 1) preview.active = false;
    return changed;
  }

  function previewOffset(entry, x, y, now) {
    const changed = advancePreview(entry, now), preview = entry.preview;
    if (Math.abs(x - preview.targetX) + Math.abs(y - preview.targetY) < .01) return changed;
    Object.assign(preview, { fromX:preview.x, fromY:preview.y, targetX:x, targetY:y, started:now, active:true });
    return true;
  }

  function updateDropMarker() {
    if (!dropMarker) return;
    const row = dropPosition && rows[dropPosition.shelf];
    dropMarker.visible = Boolean(row);
    if (!row) return;
    const undershelf = dropPosition.mount === 'undershelf';
    const ceiling = row.ceiling ?? row.top;
    const markerHeight = undershelf ? clamp((row.bottom - ceiling) * .08, 12, 24) : clamp((row.bottom - row.top) * .82, 60, 180);
    const { left = 0, right = width, padding = 16 } = row;
    dropMarker.position.set(-width / 2 + left + padding + dropPosition.x * (right - left - padding * 2),
      -(undershelf ? ceiling : row.bottom), undershelf ? -depth / 2 : 13);
    dropMarker.children[0].position.y = (undershelf ? -1 : 1) * markerHeight / 2;
    dropMarker.children[0].scale.y = markerHeight;
    dropMarker.children[1].position.y = undershelf ? -1 : 1;
  }

  function pointerRay(clientX, clientY) {
    // Scroll/view/metadata changes may be waiting for the next demand frame.
    // Pick the actual meshes and camera being shown, including their depth.
    if (raf) { cancelAnimationFrame(raf); raf = 0; draw(); }
    camera.updateMatrixWorld();
    const bounds = canvas.getBoundingClientRect();
    const pointer = new THREE.Vector2((clientX - bounds.left) / sceneWidth * 2 - 1, 1 - (clientY - bounds.top) / viewportHeight * 2);
    const ray = new THREE.Raycaster(); ray.setFromCamera(pointer, camera);
    return ray;
  }

  function objectAtPoint(clientX, clientY) {
    const ray = pointerRay(clientX, clientY);
    const pickable = furniture.children.filter(object => object.visible && !object.userData.dropMarker &&
      !object.userData.entry?.node?.classList.contains('is-away'));
    for (const hit of ray.intersectObjects(pickable, true)) {
      let object = hit.object;
      while (object && !object.userData.entry) object = object.parent;
      if (object?.userData.entry?.node && object.visible) return object.userData.entry.node;
      // Solid wood in front blocks the object behind it.
      if (!object?.userData.entry) return null;
    }
    return null;
  }

  function paintInsertionOverlay(entry) {
    const insertion = entry.insertion, overlay = insertion?.overlayCanvas, model = entry.model;
    if (!overlay || !model) return;
    const overlayContext = overlay.getContext('2d');
    if (!overlayContext) return;
    const vw = window.innerWidth || overlay.clientWidth, vh = window.innerHeight || overlay.clientHeight;
    if (!vw || !vh) return;
    const origin = stage.getBoundingClientRect();
    // Use the same world axes as the cabinet, but show the entire viewport.
    // The moving book therefore stays visible beyond the scroller's edges.
    insertionCamera.left = -origin.left; insertionCamera.right = vw - origin.left;
    insertionCamera.top = origin.top; insertionCamera.bottom = origin.top - vh;
    insertionCamera.updateProjectionMatrix();
    const ratio = overlay.width / vw;
    if (renderer.getPixelRatio() !== ratio) renderer.setPixelRatio(ratio);
    renderer.getSize(rendererSize);
    if (rendererSize.x !== vw || rendererSize.y !== vh) renderer.setSize(vw, vh, false);
    const autoClear = renderer.autoClear, scissorTest = renderer.getScissorTest();
    const previousScissor = renderer.getScissor(new THREE.Vector4());
    const writes = new Map(), visibility = new Map(), solids = new Map();
    scene.traverse(object => {
      const materials = [].concat(object.material || []);
      for (const material of materials) if (!writes.has(material)) {
        writes.set(material, material.colorWrite);
      }
      // Opaque surfaces only contribute depth to the first pass: an unlit
      // stand-in skips their full wood/cloth shading on every return frame.
      // Cut-outs, blended and non-depth-writing surfaces keep their own.
      const side = materials[0]?.side;
      if (object.isMesh && materials.length && materials.every(material => material.visible && material.depthWrite &&
        material.depthTest && !material.transparent && !material.alphaTest && !material.alphaMap && material.side === side))
        solids.set(object, object.material);
    });
    for (const object of furniture.children) visibility.set(object, object.visible);
    if (trash) visibility.set(trash, trash.visible);
    const canvasRect = canvas.getBoundingClientRect(), clip = scroller.getBoundingClientRect();
    const left = Math.max(0, canvasRect.left, clip.left), right = Math.min(vw, canvasRect.right, clip.right);
    const top = Math.max(0, canvasRect.top, clip.top), bottom = Math.min(vh, canvasRect.bottom, clip.bottom);
    try {
      renderer.autoClear = false;
      renderer.setScissorTest(false); renderer.clear(true, true, true);
      // First draw only the cabinet's depth, clipped exactly like the painted
      // shelf. Invisible wood outside its viewport must not hide the book.
      for (const material of writes.keys()) material.colorWrite = false;
      for (const [mesh, material] of solids) mesh.material = depthOnly[[].concat(material)[0].side] || depthOnly[THREE.FrontSide];
      model.visible = false;
      if (right > left && bottom > top) {
        renderer.setScissor(left, vh - bottom, right - left, bottom - top);
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
      overlayContext.clearRect(0, 0, overlay.width, overlay.height);
      overlayContext.drawImage(renderer.domElement, 0, 0, overlay.width, overlay.height);
      overlay.dataset.insertionDepth = 'shared-shelf';
      overlay.dataset.returnProgress = canvas.dataset.returnProgress;
    } finally {
      for (const [mesh, material] of solids) mesh.material = material;
      for (const [material, value] of writes) material.colorWrite = value;
      for (const [object, value] of visibility) object.visible = value;
      renderer.autoClear = autoClear;
      renderer.setScissor(previousScissor); renderer.setScissorTest(scissorTest);
    }
  }

  function draw(now = performance.now()) {
    raf = 0;
    if (disposed) return;
    const furnitureMoving = Boolean(transition || reorderTransition);
    let scrollPan = null;
    if (transition) {
      const t = clamp((now - transition.started) / DURATION, 0, 1);
      progress = transition.from + (transition.to - transition.from) * ease(t);
      scrollPan = transition.scrollFrom + (transition.scrollTo - transition.scrollFrom) * ease(t);
      scroller.scrollTop = scrollPan;
      if (t === 1) transition = null;
    }
    if (reorderTransition) {
      const t = clamp((now - reorderTransition.started) / 520, 0, 1), amount = 1 - ease(t);
      for (const item of reorderTransition.entries) { item.entry.offset.x = item.x * amount; item.entry.offset.y = item.y * amount; }
      if (t === 1) reorderTransition = null;
    }
    const zoom = updateTransform();
    // Expanding/shrinking the stage can change the browser's maximum scroll
    // during a turn. Apply the same frame's pan after committing its height.
    if (scrollPan !== null) scroller.scrollTop = scrollPan;
    else if (progress === 1) scroller.scrollTop = 0;
    const { scroll, ratio } = viewport();
    updateCatalog(scroll);
    const finishedInsertions = [];
    const { moving, shelfMoving } = updateEntries(scroll, zoom, now, finishedInsertions);
    const finishedDrops = [];
    const trashMoving = updateTrash(scroll, now, finishedDrops);
    const lampRefresh = lampLighting.update(bookEntries, { scroll, viewportHeight,
      shadowDirty:shadowDirty || furnitureMoving || shelfMoving });
    if (lampRefresh && lampLighting.shadowCount) renderer.shadowMap.needsUpdate = true;
    // Fit the key's shadow to the cabinet (and bin) in world space; the
    // lighting clips it to the camera window, so each texel covers less.
    shadowBounds.copy(fullBounds);
    if (trash) shadowBounds.union(shadowTrash.copy(trashBounds).translate(trash.position));
    shadowBounds.applyMatrix4(furniture.matrixWorld);
    // Scrolling creates and releases culled models: those change the casters.
    let casters = trash?.visible ? 1 : 0;
    for (const entry of bookEntries) if (entry.model?.visible) casters = Math.imul(casters, 31) + entry.model.id | 0;
    const shadowMotion = furnitureMoving || shelfMoving || trashMoving || inspectionMoving;
    const shadowRefresh = lighting.update({ width:sceneWidth, viewportHeight, scroll, depth, bounds:shadowBounds,
      dirty:shadowDirty || casters !== shadowCasters || shadowMotion, moving:shadowMotion });
    shadowDirty = false; shadowCasters = casters;
    const overlayInsertion = bookEntries.some(entry => entry.insertion?.overlayCanvas);
    // Its hidden slot and neighbors are already painted. Reuse that snapshot
    // during a stationary insertion instead of reallocating the shared GPU
    // buffer between the smaller shelf and full-screen output every frame.
    if (!overlayInsertion || shelfSnapshotDirty || shadowRefresh || lampRefresh || furnitureMoving || shelfMoving || trashMoving) {
      if (renderer.getPixelRatio() !== ratio) renderer.setPixelRatio(ratio);
      renderer.getSize(rendererSize);
      if (rendererSize.x !== sceneWidth || rendererSize.y !== viewportHeight) renderer.setSize(sceneWidth, viewportHeight, false);
      renderer.render(scene, camera);
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.drawImage(renderer.domElement, 0, 0, canvas.width, canvas.height);
      canvas.dataset.snapshotRenderCount = String(++shelfSnapshotRenders);
      shelfSnapshotDirty = false;
    }
    for (const entry of bookEntries) if (entry.insertion?.overlayCanvas) paintInsertionOverlay(entry);
    canvas.dataset.renderCount = String(++renderCount);
    canvas.dataset.activePlants = String(bookEntries.filter(entry => entry.kind === 'plant' && entry.model?.visible).length);
    canvas.dataset.highResolutionPlants = String(bookEntries.filter(entry => entry.kind === 'plant' && entry.model?.visible && entry.model.userData.inspectionResolution).length);
    canvas.dataset.activeLamps = String(bookEntries.filter(entry => entry.kind === 'lamp' && entry.model?.visible).length);
    canvas.dataset.lampLightCount = String(lampLighting.activeCount);
    canvas.dataset.activeLampLights = String(lampLighting.activeCount);
    canvas.dataset.lampShadowCount = String(lampLighting.shadowCount);
    canvas.dataset.lampLightTemperature = '2700';
    const paintedBooks = bookEntries.filter(entry => entry.kind !== 'plant' && entry.kind !== 'lamp' && entry.model?.visible);
    canvas.dataset.overviewBooks = String(paintedBooks.filter(entry => entry.model.userData.overview).length);
    canvas.dataset.highResolutionBooks = String(paintedBooks.filter(entry => entry.model.userData.inspectionResolution).length);
    canvas.dataset.pixelRatio = String(ratio);
    canvas.dataset.detailedBooks = String(paintedBooks.filter(entry => !entry.model.userData.overview).length);
    canvas.dataset.bookQualityPending = String(bookEntries.filter(entry => entry.qualityReplacement).length);
    canvas.dataset.shadowMapSize = '1024';
    canvas.dataset.furnitureMeshes = String(furniture.children.find(object => object.userData.furniture)?.children.length || 0);
    canvas.dataset.plantGeometry = 'catalog-3d';
    canvas.dataset.animating = String(Boolean(transition || reorderTransition || moving || trashMoving || inspectionMoving));
    for (const resolve of finishedInsertions) resolve();
    for (const resolve of finishedDrops) resolve();
    // One more frame after any motion redraws its cheaper shadow at full quality.
    if (transition || reorderTransition || moving || trashMoving || (lighting.settling && !inspectionMoving)) invalidate(false);
  }

  function invalidate(dirty = true) {
    if (dirty) shelfSnapshotDirty = shadowDirty = true;
    if (!disposed && !raf) raf = requestAnimationFrame(draw);
  }
  // Repaint the camera's new window; the shadow map is reused.
  function scrolled() {
    shelfSnapshotDirty = true;
    invalidate(false);
  }

  function animateObjectToTrash(node, { duration = 850 } = {}) {
    const entry = byNode.get(node);
    if (!entry || !trash || disposed) return null;
    cancelAnimationFrame(raf); raf = 0; draw();
    if (desiredMode !== 'isometric' || trashNode.hidden || !trash.visible) return null;
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
    entry.trashDrop = drop; entry.model.visible = true;
    shelfSnapshotDirty = shadowDirty = true;
    cancelAnimationFrame(raf); raf = 0; draw(now);
    drop.lastFrame = performance.now();
    return { finished, get lastFrameTime() { return drop.lastFrame; }, cancel() {
      if (entry.trashDrop !== drop) return;
      cancelTrashDrop(entry); trashHover = false;
      trashTransition = { from:Number(trash.userData.openness) || 0, to:0, started:performance.now() };
      shelfSnapshotDirty = shadowDirty = true;
      if (!disposed) { cancelAnimationFrame(raf); raf = 0; draw(); }
    } };
  }
  const mutations = new MutationObserver(records => {
    for (const record of records) {
      const entry = byNode.get(record.target);
      if (entry && stateFor(entry) !== entry.state) { invalidate(); break; }
    }
  });
  const themeChanges = new MutationObserver(() => { updateWoodTheme(); invalidate(); });
  themeChanges.observe(document.documentElement, { attributes:true, attributeFilter:['data-theme'] });
  for (const node of byNode.keys()) mutations.observe(node, { attributes:true, attributeFilter:['class', 'style'] });
  scroller.addEventListener('scroll', scrolled, { passive:true });
  window.addEventListener('resize', invalidate, { passive:true });
  document.fonts?.ready.then(invalidate);
  updateWoodTheme();
  draw();

  function getInspectionView() {
    const rect=canvas.getBoundingClientRect();
    return {zoom:inspectionZoom,panX,panY,width:sceneWidth,height:sceneFitHeight,
      centerX:rect.left+sceneWidth/2,centerY:rect.top+sceneFitHeight/2};
  }

  return {
    canvas,
    getInspectionZoom:()=>inspectionZoom,
    getInspectionView,
    setInspectionView(view,{moving=false,renderNow=false}={}) {
      if (disposed || desiredMode !== 'isometric' || transition || progress !== 1) return getInspectionView();
      inspectionZoom=clamp(Number(view.zoom) || 1,1,4); inspectionMoving=Boolean(moving);
      const slack=inspectionMoving ? 80 : 0;
      panX=clamp(Number(view.panX) || 0,-(inspectionZoom-1)*sceneWidth/2-slack,(inspectionZoom-1)*sceneWidth/2+slack);
      panY=clamp(Number(view.panY) || 0,-(inspectionZoom-1)*sceneFitHeight/2-slack,(inspectionZoom-1)*sceneFitHeight/2+slack);
      if (renderNow) { shelfSnapshotDirty=shadowDirty=true; cancelAnimationFrame(raf); raf=0; draw(); }
      else invalidate();
      return getInspectionView();
    },
    zoomTo(value,clientX,clientY) {
      if (disposed || desiredMode !== 'isometric' || transition || progress !== 1) return inspectionZoom;
      const next = clamp(Number(value) || 1,1,4), relative = next/inspectionZoom;
      const rect = canvas.getBoundingClientRect();
      const x = Number.isFinite(clientX) ? clientX-rect.left : sceneWidth/2;
      const y = Number.isFinite(clientY) ? clientY-rect.top : sceneFitHeight/2;
      panX = x-sceneWidth/2-(x-sceneWidth/2-panX)*relative;
      panY = y-sceneFitHeight/2-(y-sceneFitHeight/2-panY)*relative;
      inspectionZoom = next;
      if (next === 1) panX = panY = 0;
      invalidate(); return inspectionZoom;
    },
    panBy(x,y) {
      if (disposed || desiredMode !== 'isometric' || inspectionZoom <= 1) return;
      panX += Number(x) || 0; panY += Number(y) || 0; invalidate();
    },
    invalidate,
    hitTrash,
    setTrashHover(active) {
      if (!trash || disposed) return;
      const next = Boolean(active) && desiredMode === 'isometric' && !trashNode.hidden && trash.visible;
      if (next === trashHover) return;
      trashHover = next;
      trashTransition = { from:trashOpenness, to:next ? 1 : 0, started:performance.now() };
      invalidate();
    },
    animateObjectToTrash,
    animateBookToTrash:animateObjectToTrash,
    flush() { shelfSnapshotDirty = shadowDirty = true; cancelAnimationFrame(raf); raf = 0; draw(); },
    setMode(next, { animate = true } = {}) {
      const wasIsometric = desiredMode === 'isometric';
      desiredMode = next === 'isometric' ? 'isometric' : 'spine';
      const target = desiredMode === 'isometric' ? 1 : 0;
      if (!target) { inspectionZoom = 1; panX = panY = 0; inspectionMoving=false; }
      if (target && !wasIsometric) frontalScroll = scroller.scrollTop;
      const scrollTo = target ? 0 : frontalScroll;
      if (!target && trash) {
        for (const entry of bookEntries) cancelTrashDrop(entry);
        trashHover = false; trashOpenness = 0; trashTransition = null;
        trash.userData.setState({ openness:0 });
        trashNode.hidden = true; trashNode.inert = true; trashNode.tabIndex = -1;
        trashNode.setAttribute('aria-hidden', 'true'); trashNode.style.pointerEvents = 'none';
      }
      if (!animate || reducedMotion.matches) {
        progress = target; transition = null;
        // Expanding the frontal stage must happen before restoring its scroll.
        updateTransform(); scroller.scrollTop = scrollTo;
      } else transition = { from:progress, to:target, started:performance.now(), scrollFrom:scroller.scrollTop, scrollTo };
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
      cancelAnimationFrame(raf); raf = 0; draw();
      const dock = shelfBookInsertion(shelfBookSlot(entry, width), entry.width);
      return projectShelfBookPose(furniture.matrixWorld, dock, entry, stage.getBoundingClientRect());
    },
    returnBook(node, { duration = 180, overlayCanvas = null } = {}) {
      const entry = byNode.get(node);
      if (!entry || entry.kind === 'plant' || entry.kind === 'lamp' || disposed) return null;
      cancelInsertion(entry);
      let resolve;
      const finished = new Promise(done => { resolve = done; });
      const insertion = { slot:shelfBookSlot(entry, width), started:performance.now(),
        duration:reducedMotion.matches ? 0 : Math.max(0, Number(duration) || 0), resolve, complete:false, overlayCanvas,
        elapsed:0, lastFrame:performance.now() };
      entry.insertion = insertion;
      Object.assign(entry.lift, { value:0, from:0, target:0, started:insertion.started });
      // Paint the same dock position before the caller hides its overlay.
      // Neighbors and wood now occlude the moving book in one depth buffer.
      shelfSnapshotDirty = shadowDirty = true;
      cancelAnimationFrame(raf); raf = 0; draw(insertion.started);
      insertion.lastFrame = performance.now();
      return { finished, cancel() {
        if (entry.insertion !== insertion) return;
        cancelInsertion(entry);
        overlayCanvas?.getContext('2d')?.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
        shelfSnapshotDirty = shadowDirty = true;
        if (!disposed) { cancelAnimationFrame(raf); raf = 0; draw(); }
      } };
    },
    getBookAtPoint(clientX, clientY) {
      const node = objectAtPoint(clientX, clientY);
      const entry = node && byNode.get(node);
      return entry && entry.kind !== 'plant' && entry.kind !== 'lamp' ? node : null;
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
      dropPosition = position && Number.isInteger(shelf) && rows[shelf] && Number.isFinite(x)
        ? { shelf, x:clamp(x, 0, 1), ...(position.mount === 'undershelf' ? { mount:'undershelf' } : {}) } : null;
      if (dropPosition && !dropMarker) {
        dropMarker = new THREE.Group(); dropMarker.userData.dropMarker = true;
        const material = new THREE.MeshBasicMaterial({ color:'#709980', transparent:true, opacity:.9, depthTest:false, depthWrite:false });
        const guide = new THREE.Mesh(new THREE.BoxGeometry(2, 1, 2), material);
        const foot = new THREE.Mesh(new THREE.BoxGeometry(12, 2, 4), material); foot.position.y = 1;
        dropMarker.add(guide, foot); furniture.add(dropMarker);
      }
      canvas.dataset.dropShelf = dropPosition ? String(dropPosition.shelf) : '';
      canvas.dataset.dropX = dropPosition ? dropPosition.x.toFixed(4) : '';
      canvas.dataset.dropMount = dropPosition?.mount || '';
      invalidate();
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
        const x = row && Number.isFinite(center) ? (row.left || 0) + center - entry.x : 0;
        const y = row && Number.isFinite(center) ? entry.y -
          (entry.kind === 'lamp' && entry.mount === 'undershelf' ? row.ceiling ?? row.top : row.bottom - entry.height / 2) : 0;
        changed = previewOffset(entry, x, y, now) || changed;
      }
      if (changed) invalidate();
    },
    updateEntry(node, book, style, coverUrl) {
      const entry = byNode.get(node);
      if (!entry || entry.kind === 'plant' || entry.kind === 'lamp') return;
      updateRecord(entry, book, style, coverUrl);
      invalidate();
    },
    updateLayout(next) {
      if (disposed) return false;
      shelfSnapshotDirty = shadowDirty = true;
      cancelAnimationFrame(raf); raf = 0; mutations.disconnect();
      const oldEntries = new Map(bookEntries.map(entry => [entry.key, entry]));
      const oldWidth = width, oldHeight = height, oldRows = JSON.stringify(rows), oldDepth = depth, oldShelfType = shelfType;
      // Restore only the outgoing DOM. The already painted canvas and GPU
      // resources remain alive while the replacement semantic tree is bound.
      if (next.stage !== stage) {
        stage.style.height = originalHeight;
        if (!alreadyScene) stage.classList.remove('has-scene');
        for (const [node, style] of originalStyles) {
          if (style === null) node.removeAttribute('style'); else node.setAttribute('style', style);
          delete node.dataset.sceneProjected;
          delete node.dataset.sceneHitSurface;
          semanticCovers.get(node)?.remove(); semanticCovers.delete(node);
          semanticFoliage.get(node)?.svg.remove(); semanticFoliage.delete(node);
          clearPlantDiagnostics(node);
        }
        originalStyles.clear();
        stage = next.stage;
        originalHeight = stage.style.height;
        alreadyScene = stage.classList.contains('has-scene');
        stage.classList.add('has-scene');
        stage.prepend(canvas);
      }
      width = next.width; height = next.height; rows = next.rows;
      shelfType = normalizeShelfType(next.shelfType);
      unitWidth = next.unitWidth || width; unitCount = next.unitCount || 1;
      depth = shelfType === 'baggebo' ? BAGGEBO_SPEC.depth * unitWidth / BAGGEBO_SPEC.width
        : Math.max(155, ...next.entries.filter(entry => entry.kind !== 'plant' && entry.kind !== 'lamp').map(entry => entry.width + 12),
          ...next.entries.filter(entry => entry.kind === 'lamp' && entry.mount !== 'undershelf').map(entry => (entry.depth || entry.width) + 12));
      sceneWidth = Math.max(1, Number(next.sceneWidth) || width);
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
          trashHover = false; trashOpenness = 0; trashTransition = null;
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
          if (entry.node !== data.node) {
            semanticFoliage.get(entry.node)?.svg.remove(); semanticFoliage.delete(entry.node);
            clearPlantDiagnostics(entry.node);
          }
          entry.node = data.node;
          if (data.kind === 'plant' || data.kind === 'lamp') {
            const changed = data.kind === 'lamp' ? lampKeys(entry) !== lampKeys(data) : plantKeys(entry) !== plantKeys(data);
            if (changed) releaseEntry(entry);
            Object.assign(entry, data); entry.box = slotBox(entry);
          } else updateRecord(entry, data.book, data.style, data.coverUrl, data);
        } else { entry = freshEntry(data, index); entry.box = slotBox(entry); }
        // The new layout has already committed the preview's destination.
        // Retaining that offset would apply it twice; captured projected rects
        // are handed to animateFromRects for the remaining release movement.
        entry.preview = freshPreview();
        entry.landing = null;
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
        mutations.observe(entry.node, { attributes:true, attributeFilter:['class', 'style'] });
      }
      if (reorderTransition) reorderTransition.entries = reorderTransition.entries.filter(item => retained.includes(item.entry));
      if (width !== oldWidth || height !== oldHeight || depth !== oldDepth || shelfType !== oldShelfType || JSON.stringify(rows) !== oldRows) rebuildFurniture();
      fullBounds.min.set(-width / 2, -height - (shelfType === 'baggebo' ? 0 : boardHeight), -depth - (shelfType === 'baggebo' ? 0 : 4));
      fullBounds.max.set(width / 2, shelfType === 'baggebo' ? 0 : 2, shelfType === 'baggebo' ? 0 : 12);
      canvas.dataset.layoutUpdates = String(Number(canvas.dataset.layoutUpdates || 0) + 1);
      draw();
      return true;
    },
    animateFromRects(oldRects, { draggedKey } = {}) {
      if (reducedMotion.matches) return;
      const stageRect = stage.getBoundingClientRect(), items = [];
      for (const entry of bookEntries) {
        const old = oldRects.get(entry.node?.dataset.objectId) || oldRects.get(entry.book?.id) ||
          oldRects.get(entry.node?.dataset.bookId) || oldRects.get(entry.key);
        const targetRect = entry.hitRect || entry.rect;
        if (!old || !targetRect) continue;
        const x = old.left - (targetRect.left + stageRect.left), y = old.top - (targetRect.top + stageRect.top);
        if (Math.abs(x) + Math.abs(y) > 1) items.push({ entry, x, y });
      }
      reorderTransition = { started:performance.now(), entries:items };
      const dragged = draggedKey == null ? null : items.find(item =>
        String(item.entry.node?.dataset.objectId ?? item.entry.key) === String(draggedKey))?.entry;
      if (dragged && dragged.lift.value > 0) {
        dragged.landing = { from:dragged.lift.value, started:reorderTransition.started, duration:520 };
      }
      // Paint the old positions before yielding. Otherwise a synchronous
      // layout replacement can flash its final positions for one frame.
      cancelAnimationFrame(raf); raf = 0; draw(reorderTransition.started);
    },
    dispose() {
      disposed = true; cancelAnimationFrame(raf); mutations.disconnect(); themeChanges.disconnect();
      scroller.removeEventListener('scroll', scrolled); window.removeEventListener('resize', invalidate);
      for (const entry of bookEntries) releaseEntry(entry);
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
      canvas.remove(); stage.style.height = originalHeight;
      if (!alreadyScene) stage.classList.remove('has-scene');
      for (const [node, style] of originalStyles) {
        if (style === null) node.removeAttribute('style'); else node.setAttribute('style', style);
        delete node.dataset.sceneProjected;
        delete node.dataset.sceneHitSurface;
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
