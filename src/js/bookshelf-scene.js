import * as THREE from 'three';
import { createBookModel, getBookRenderer, lightBookScene } from './book-model.js';
import { bookmarkFor } from './bookshelf-layout.js';
import { shelfBookSlot, shelfBookInsertion, projectShelfBookPose } from './bookshelf-return.js';
import { createShelfFurniture } from './shelf-furniture.js';
import { createShelfPlant } from './shelf-plants.js';
import { createShelfLighting } from './shelf-lighting.js';
import { createShelfTrash, sampleTrashDrop } from './shelf-trash.js';
import { createShelfCatalog } from './shelf-catalog.js';

const WALNUT = new URL('../assets/library/walnut-pbr.webp', import.meta.url).href;
const BOTANICAL = new URL('../assets/library/botanical-leaves.webp', import.meta.url).href;
const DURATION = 700;
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const ease = t => t * t * t * (t * (t * 6 - 15) + 10);

/** Project a pointer ray onto the cabinet's front, independent of its view. */
export function projectShelfDropPosition(worldRay, furnitureMatrix, rows, width, padding = 16) {
  if (!rows.length || !Number.isFinite(width) || width <= padding * 2) return null;
  const localRay = worldRay.clone().applyMatrix4(furnitureMatrix.clone().invert());
  const point = localRay.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 0, 1), 0), new THREE.Vector3());
  if (!point) return null;
  const y = -point.y;
  let shelf = 0, nearest = Infinity;
  for (let index = 0; index < rows.length; index++) {
    const { top, bottom } = rows[index];
    const distance = y < top ? top - y : y > bottom ? y - bottom : 0;
    if (distance < nearest) { nearest = distance; shelf = index; }
  }
  return { shelf, x:clamp((point.x + width / 2 - padding) / (width - padding * 2), 0, 1) };
}

function releaseObject(object) {
  const materials = new Set();
  object.traverse(child => {
    child.geometry?.dispose();
    for (const material of [].concat(child.material || [])) materials.add(material);
  });
  for (const material of materials) material.dispose();
}

function woodMicrotexture() {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 256;
  const context = canvas.getContext('2d'), pixels = context.createImageData(256, 256);
  for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
    const grain = Math.sin(y * .8 + Math.sin(x / 256 * Math.PI * 2) * .9) * 12 +
      Math.sin(y * .24 + Math.sin(x / 256 * Math.PI * 4) * .3) * 9;
    const pore = ((x * 73856093 ^ y * 19349663) >>> 0) % 17;
    const value = Math.round(184 + grain + pore - 8), offset = (y * 256 + x) * 4;
    pixels.data[offset] = pixels.data[offset + 1] = pixels.data[offset + 2] = value;
    pixels.data[offset + 3] = 255;
  }
  context.putImageData(pixels, 0, 0);
  const map = new THREE.CanvasTexture(canvas); map.wrapS = map.wrapT = THREE.RepeatWrapping;
  return map;
}

/** One demand-rendered scene for the entire piece of furniture and its books.
 * Pixel coordinates describe the unrotated shelf. DOM buttons remain semantic
 * hit targets, projected from the meshes after every camera/group update.
 */
export function createBookshelfScene({ stage, scroller, entries, rows, width, height, sceneWidth = width,
  trashNode = null, catalogNode = null, mode = 'spine' }) {
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
  stage.classList.add('has-scene');
  stage.prepend(canvas);
  const scene = new THREE.Scene();
  lightBookScene(scene);
  const lighting = createShelfLighting(scene, renderer);
  const furniture = new THREE.Group();
  scene.add(furniture);
  sceneWidth = Math.max(width, Number(sceneWidth) || width);
  let trash = trashNode ? createShelfTrash() : null;
  if (trash) scene.add(trash);
  let catalog = catalogNode ? createShelfCatalog() : null;
  if (catalog) furniture.add(catalog);
  const camera = new THREE.OrthographicCamera(0, width, 0, -1, .1, 20000);
  camera.position.z = 8000;
  const insertionCamera = new THREE.OrthographicCamera(0, 1, 0, -1, .1, 20000);
  insertionCamera.position.z = 8000;
  const texture = new THREE.TextureLoader().load(WALNUT, () => invalidate());
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(1, 1);
  texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const leafTexture = new THREE.TextureLoader().load(BOTANICAL, () => invalidate());
  leafTexture.colorSpace = THREE.SRGBColorSpace;
  leafTexture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const grain = woodMicrotexture();
  const wood = new THREE.MeshPhysicalMaterial({ map:texture, bumpMap:grain, bumpScale:.18,
    roughnessMap:grain, color:'#fff3e3', roughness:.62, clearcoat:.18, clearcoatRoughness:.48 });
  const backWood = new THREE.MeshStandardMaterial({ map:texture, bumpMap:grain, bumpScale:.12,
    color:'#d5c4af', roughness:.87 });
  const darkWood = new THREE.MeshPhysicalMaterial({ map:texture, bumpMap:grain, bumpScale:.15,
    color:'#ead5ba', roughness:.68, clearcoat:.12, clearcoatRoughness:.52 });
  let depth = Math.max(155, ...entries.filter(e => e.kind !== 'plant').map(e => e.width + 12));
  const entryKey = (entry, index) => entry.kind === 'plant'
    ? `plant:${entry.node?.dataset.objectId ?? entry.key ?? index}`
    : `book:${String(entry.book?.id ?? entry.node?.dataset.bookId ?? entry.book?.path ?? entry.book?.title ?? index)}`;
  const freshPreview = () => ({ x:0, y:0, fromX:0, fromY:0, targetX:0, targetY:0, started:0, active:false });
  const freshEntry = (entry, index) => ({ ...entry, key:entryKey(entry, index), model:null, replacement:null, pose:new THREE.Object3D(),
    lift:{ value:0, from:0, target:0, started:0 }, landing:null, offset:{ x:0, y:0 }, preview:freshPreview(), state:'', rect:null, insertion:null });
  let bookEntries = entries.map(freshEntry);
  const byNode = new Map(bookEntries.filter(entry => entry.node).map(entry => [entry.node, entry]));
  const boardHeight = 15;
  function rebuildFurniture() {
    for (const object of [...furniture.children]) if (object.userData.furniture) {
      furniture.remove(object); object.userData.disposeGeometry?.();
    }
    furniture.add(createShelfFurniture({ width, height, depth, rows, wood, backWood, darkWood }));
  }
  rebuildFurniture();

  let disposed = false, raf = 0, renderCount = 0, modelCreations = 0, viewportHeight = 1, progress = mode === 'isometric' ? 1 : 0;
  let shelfSnapshotDirty = true, shelfSnapshotRenders = 0;
  let transition = null, reorderTransition = null;
  let dropMarker = null, dropPosition = null;
  let desiredMode = mode === 'isometric' ? 'isometric' : 'spine';
  let trashHover = false, trashOpenness = 0, trashTransition = null;
  let trashRect = null;
  const trashOriginalStyles = new Map(trashNode ? [[trashNode, trashNode.getAttribute('style')]] : []);
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
  const fullBounds = new THREE.Box3(new THREE.Vector3(-width / 2, -height - boardHeight, -depth - 4), new THREE.Vector3(width / 2, 2, 12));
  const slotBox = entry => {
    const plant = entry.kind === 'plant';
    return new THREE.Box3(
      new THREE.Vector3(-entry.width / 2 - (plant ? 0 : entry.thickness * .38), -entry.height / 2, -(plant ? entry.width * .35 : entry.thickness / 2)),
      new THREE.Vector3(entry.width / 2, entry.height / 2 + (plant ? 0 : 20), plant ? entry.width * .35 : entry.thickness / 2)
    );
  };
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

  const plantKeys = entry => JSON.stringify([entry.width, entry.height, entry.variant, entry.catalogId, entry.potId, entry.seed]);

  function makeModel(entry) {
    const model = entry.kind === 'plant' ? createShelfPlant(entry, { leafTexture })
      : createBookModel(entry.book, entry.style, entry.width, entry.height, entry.thickness, entry.coverUrl, { shelf:true });
    model.userData.invalidate = invalidate;
    model.userData.entry = entry;
    model.traverse(object => {
      if (object.isMesh) { object.castShadow = true; object.receiveShadow = true; }
    });
    if (entry.kind !== 'plant') model.userData.shelfKeys = materialKeys(entry);
    else model.userData.shelfPlantKeys = plantKeys(entry);
    canvas.dataset.modelCreations = String(++modelCreations);
    return model;
  }

  function cancelReplacement(entry) {
    entry.replacement?.userData.dispose?.();
    entry.replacement = null;
  }

  function releaseEntry(entry) {
    cancelInsertion(entry);
    cancelTrashDrop(entry, false);
    cancelReplacement(entry);
    if (entry.model) { entry.model.removeFromParent(); entry.model.userData.dispose?.(); entry.model = null; }
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
    if (!trash || !trashNode) return false;
    const gutter = Math.max(1, sceneWidth - width);
    const scale = Math.min(1.08, gutter / 76);
    const canvasBounds = canvas.getBoundingClientRect();
    const scrollerBounds = scroller.getBoundingClientRect();
    const visualBottom = window.visualViewport
      ? window.visualViewport.offsetTop + window.visualViewport.height : window.innerHeight;
    const visibleBottom = Math.min(scrollerBounds.bottom, window.innerHeight || Infinity,
      Number.isFinite(visualBottom) && visualBottom > 0 ? visualBottom : Infinity);
    const visibleHeight = Math.max(1, Math.min(viewportHeight, visibleBottom - canvasBounds.top));
    // The wastebasket shares the shelf's world, camera and light. It remains
    // beside the visible cabinet while long shelves scroll underneath it.
    // The cabinet starts below the library heading. The scroller's total
    // height therefore exceeds the canvas area actually visible on a phone.
    trash.position.set(width + gutter / 2, -scroll - visibleHeight + 18, 36);
    trash.scale.setScalar(scale);
    trash.rotation.set(14 * Math.PI / 180 * progress, -Math.PI / 6 * progress, 0);
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
        const tiltedWidth = dropEntry.width * Math.cos(.46) + dropEntry.height * Math.sin(.46);
        const endScale = Math.min(.19 * scale, trash.userData.radius * 1.45 * scale / Math.max(1, tiltedWidth));
        const motion = sampleTrashDrop(drop.start, trash.userData.getMouth(), t,
          { height:dropEntry.height, scale:drop.startScale, endScale });
        dropEntry.model.position.copy(motion.position);
        dropEntry.model.scale.setScalar(motion.scale);
        drop.endQuaternion.copy(trash.quaternion).multiply(drop.bookQuaternion);
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
      canvas.dataset.trashingObjectKind = dropEntry.kind === 'plant' ? 'plant' : 'book';
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
    const targetPadding = 7;
    Object.assign(trashNode.style, { position:'absolute', left:`${trashRect.left - targetPadding}px`,
      top:`${trashRect.top - targetPadding}px`, width:`${trashRect.width + targetPadding * 2}px`,
      height:`${trashRect.height + targetPadding * 2}px`, margin:'0', zIndex:'50' });
    trashNode.dataset.trash3d = 'true';
    trashNode.dataset.trashHover = trashNode.dataset.hover = String(trashHover);
    canvas.dataset.trash3d = 'true'; canvas.dataset.trashHover = String(trashHover);
    return moving;
  }

  const smoothTrash = t => t * t * (3 - 2 * t);

  function hitTrash(clientX, clientY) {
    if (!trash || !trashNode || disposed) return false;
    if (raf) { cancelAnimationFrame(raf); raf = 0; draw(); }
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
        replacement.userData.dispose?.(); return;
      }
      entry.replacement = null;
      if (loaded === false && previous && entry.coverUrl) {
        // A transient image failure must not replace a visible real cover
        // with a generated placeholder on the user's existing book.
        replacement.userData.dispose?.(); updateMaterials(entry); invalidate(); return;
      }
      entry.model = replacement;
      furniture.add(replacement);
      if (previous) { furniture.remove(previous); previous.userData.dispose?.(); }
      invalidate();
    }, () => {
      if (entry.replacement === replacement) entry.replacement = null;
      replacement.userData.dispose?.();
    });
  }

  function updateMaterials(entry) {
    const model = entry.model;
    if (!model || entry.kind === 'plant') return;
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
    if (dimensions) for (const field of ['width', 'height', 'thickness', 'x', 'y']) if (dimensions[field] !== undefined) entry[field] = dimensions[field];
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
    if (nextDepth <= depth) return;
    depth = nextDepth;
    rebuildFurniture();
    fullBounds.min.z = -depth - 4;
  }

  function updateWoodTheme() {
    const dark = document.documentElement.dataset.theme === 'dark';
    wood.color.set(dark ? '#d9c9b3' : '#fff3e3');
    backWood.color.set(dark ? '#b6a792' : '#d5c4af');
    darkWood.color.set(dark ? '#c5b397' : '#ead5ba');
  }

  function stateFor(entry) {
    const node = entry.node;
    if (!node) return '';
    return [node.classList.contains('is-away'), node.classList.contains('is-dragging'), node.classList.contains('is-lifted'),
      node.classList.contains('is-pressed'), node.style.getPropertyValue('--ihr-drag-x'), node.style.getPropertyValue('--ihr-drag-y')].join('|');
  }

  function viewport() {
    viewportHeight = Math.max(1, Math.ceil(Math.min(scroller.clientHeight || window.innerHeight, window.innerHeight)));
    const ratio = Math.min(window.devicePixelRatio || 1, width < 600 ? 1.5 : 2);
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

  function updateTransform() {
    updateDropMarker();
    const yaw = -Math.PI / 6 * progress, pitch = 14 * Math.PI / 180 * progress;
    // The complete object turns around one axis. A modest additional pullback
    // leaves room around the diagonal furniture instead of cropping its edges.
    furniture.position.set(0, 0, 0); furniture.rotation.set(pitch, yaw, 0); furniture.scale.setScalar(1);
    furniture.updateMatrix();
    const unscaled = corners(fullBounds, furniture.matrix);
    const zoom = (1 - .22 * progress) * Math.min(1, width / unscaled.width);
    furniture.scale.setScalar(zoom); furniture.updateMatrix();
    const bounds = corners(fullBounds, furniture.matrix);
    const padding = 8 * progress;
    furniture.position.set(width / 2 - (bounds.left + bounds.right) / 2, bounds.top - padding, 0);
    furniture.updateMatrixWorld(true);
    stage.style.height = `${Math.ceil(bounds.height + padding * 2)}px`;
    canvas.dataset.shelfView = desiredMode;
    canvas.dataset.viewProgress = String(Number(progress.toFixed(4)));
    canvas.dataset.yaw = (-30 * progress).toFixed(3);
    canvas.dataset.pitch = (14 * progress).toFixed(3);
    canvas.dataset.zoom = zoom.toFixed(4);
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
      const node = entry.node, plant = entry.kind === 'plant';
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
      entry.pose.position.set(entry.x - width / 2 + vector.x + entry.preview.x, -entry.y + vector.y + entry.preview.y,
        (plant ? -entry.width * .35 : -entry.width / 2) + vector.z);
      entry.pose.rotation.set(plant ? 4 * Math.PI / 180 * lift : 0,
        plant ? -7 * Math.PI / 180 * lift : Math.PI / 2 - 7 * Math.PI / 180 * lift,
        plant ? -3 * Math.PI / 180 * lift : 0);
      entry.pose.scale.setScalar(1 + .04 * lift);
      entry.pose.updateMatrix();
      projectedMatrix.multiplyMatrices(furniture.matrixWorld, entry.pose.matrix);
      const rect = corners(entry.box, projectedMatrix);
      entry.rect = rect;
      const trashDrop = entry.trashDrop;
      const visible = Boolean(trashDrop) || ((!away || insertion) && rect.bottom > scroll - 220 && rect.top < scroll + viewportHeight + 220);
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
        if (!plant && (!away || insertion)) activeBooks++;
      }
      if (node) {
        node.style.position = 'absolute'; node.style.left = `${rect.left}px`; node.style.top = `${rect.top}px`;
        node.style.width = `${rect.width}px`; node.style.height = `${rect.height}px`;
        node.style.margin = '0'; node.style.zIndex = String(100 + Math.round(rect.closest + height));
        node.dataset.sceneProjected = 'true';
      }
      entry.state = stateFor(entry);
    }
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
    const markerHeight = clamp((row.bottom - row.top) * .82, 60, 180);
    dropMarker.position.set(-width / 2 + 16 + dropPosition.x * (width - 32), -row.bottom, 13);
    dropMarker.children[0].position.y = markerHeight / 2;
    dropMarker.children[0].scale.y = markerHeight;
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
    const writes = new Map(), visibility = new Map();
    scene.traverse(object => {
      for (const material of [].concat(object.material || [])) if (!writes.has(material)) {
        writes.set(material, material.colorWrite);
      }
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
      model.visible = false;
      if (right > left && bottom > top) {
        renderer.setScissor(left, vh - bottom, right - left, bottom - top);
        renderer.setScissorTest(true);
        renderer.render(scene, insertionCamera);
      }
      // Keep that depth buffer while drawing just the moving book in color.
      // Its neighbors now hide the portions actually behind their surfaces.
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
    if (transition) {
      const t = clamp((now - transition.started) / DURATION, 0, 1);
      progress = transition.from + (transition.to - transition.from) * ease(t);
      if (t === 1) transition = null;
    }
    if (reorderTransition) {
      const t = clamp((now - reorderTransition.started) / 520, 0, 1), amount = 1 - ease(t);
      for (const item of reorderTransition.entries) { item.entry.offset.x = item.x * amount; item.entry.offset.y = item.y * amount; }
      if (t === 1) reorderTransition = null;
    }
    const zoom = updateTransform();
    const { scroll, ratio } = viewport();
    updateCatalog(scroll);
    const finishedInsertions = [];
    const { moving, shelfMoving } = updateEntries(scroll, zoom, now, finishedInsertions);
    const finishedDrops = [];
    const trashMoving = updateTrash(scroll, now, finishedDrops);
    lighting.update({ width:sceneWidth, viewportHeight, scroll, depth,
      dirty:shelfSnapshotDirty || furnitureMoving || shelfMoving || trashMoving });
    const overlayInsertion = bookEntries.some(entry => entry.insertion?.overlayCanvas);
    // Its hidden slot and neighbors are already painted. Reuse that snapshot
    // during a stationary insertion instead of reallocating the shared GPU
    // buffer between the smaller shelf and full-screen output every frame.
    if (!overlayInsertion || shelfSnapshotDirty || furnitureMoving || shelfMoving || trashMoving) {
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
    canvas.dataset.shadowMapSize = '1024';
    canvas.dataset.furnitureMeshes = String(furniture.children.find(object => object.userData.furniture)?.children.length || 0);
    canvas.dataset.botanicalAtlasReady = String(Boolean(leafTexture.image));
    canvas.dataset.animating = String(Boolean(transition || reorderTransition || moving || trashMoving));
    for (const resolve of finishedInsertions) resolve();
    for (const resolve of finishedDrops) resolve();
    if (transition || reorderTransition || moving || trashMoving) invalidate(false);
  }

  function invalidate(dirty = true) {
    if (dirty) shelfSnapshotDirty = true;
    if (!disposed && !raf) raf = requestAnimationFrame(draw);
  }

  function animateObjectToTrash(node, { duration = 850 } = {}) {
    const entry = byNode.get(node);
    if (!entry || !trash || disposed) return null;
    cancelInsertion(entry); cancelTrashDrop(entry);
    cancelAnimationFrame(raf); raf = 0; draw();
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
    shelfSnapshotDirty = true;
    cancelAnimationFrame(raf); raf = 0; draw(now);
    drop.lastFrame = performance.now();
    return { finished, get lastFrameTime() { return drop.lastFrame; }, cancel() {
      if (entry.trashDrop !== drop) return;
      cancelTrashDrop(entry); trashHover = false;
      trashTransition = { from:Number(trash.userData.openness) || 0, to:0, started:performance.now() };
      shelfSnapshotDirty = true;
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
  scroller.addEventListener('scroll', invalidate, { passive:true });
  window.addEventListener('resize', invalidate, { passive:true });
  document.fonts?.ready.then(invalidate);
  updateWoodTheme();
  draw();

  return {
    canvas,
    invalidate,
    hitTrash,
    setTrashHover(active) {
      if (!trash || disposed) return;
      const next = Boolean(active);
      if (next === trashHover) return;
      trashHover = next;
      trashTransition = { from:trashOpenness, to:next ? 1 : 0, started:performance.now() };
      invalidate();
    },
    animateObjectToTrash,
    animateBookToTrash:animateObjectToTrash,
    flush() { shelfSnapshotDirty = true; cancelAnimationFrame(raf); raf = 0; draw(); },
    setMode(next, { animate = true } = {}) {
      desiredMode = next === 'isometric' ? 'isometric' : 'spine';
      const target = desiredMode === 'isometric' ? 1 : 0;
      if (!animate || reducedMotion.matches) { progress = target; transition = null; }
      else transition = { from:progress, to:target, started:performance.now() };
      invalidate();
    },
    getBookPose(node) {
      const entry = byNode.get(node);
      if (!entry) return null;
      const stageRect = stage.getBoundingClientRect();
      return { ...projectShelfBookPose(furniture.matrixWorld, entry.pose.matrix, entry, stageRect),
        rect:entry.rect && { ...entry.rect, left:stageRect.left + entry.rect.left, top:stageRect.top + entry.rect.top,
          right:stageRect.left + entry.rect.right, bottom:stageRect.top + entry.rect.bottom } };
    },
    getReturnPose(node) {
      const entry = byNode.get(node);
      if (!entry || entry.kind === 'plant' || disposed) return null;
      cancelAnimationFrame(raf); raf = 0; draw();
      const dock = shelfBookInsertion(shelfBookSlot(entry, width), entry.width);
      return projectShelfBookPose(furniture.matrixWorld, dock, entry, stage.getBoundingClientRect());
    },
    returnBook(node, { duration = 180, overlayCanvas = null } = {}) {
      const entry = byNode.get(node);
      if (!entry || entry.kind === 'plant' || disposed) return null;
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
      shelfSnapshotDirty = true;
      cancelAnimationFrame(raf); raf = 0; draw(insertion.started);
      insertion.lastFrame = performance.now();
      return { finished, cancel() {
        if (entry.insertion !== insertion) return;
        cancelInsertion(entry);
        overlayCanvas?.getContext('2d')?.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
        shelfSnapshotDirty = true;
        if (!disposed) { cancelAnimationFrame(raf); raf = 0; draw(); }
      } };
    },
    getBookAtPoint(clientX, clientY) {
      const node = objectAtPoint(clientX, clientY);
      return node && byNode.get(node)?.kind !== 'plant' ? node : null;
    },
    getObjectAtPoint(clientX, clientY) {
      return objectAtPoint(clientX, clientY);
    },
    getDropPosition(clientX, clientY) {
      return projectShelfDropPosition(pointerRay(clientX, clientY).ray, furniture.matrixWorld, rows, width);
    },
    setDropPosition(position) {
      if (disposed) return;
      const shelf = Number(position?.shelf), x = Number(position?.x);
      dropPosition = position && Number.isInteger(shelf) && rows[shelf] && Number.isFinite(x)
        ? { shelf, x:clamp(x, 0, 1) } : null;
      if (dropPosition && !dropMarker) {
        dropMarker = new THREE.Group(); dropMarker.userData.dropMarker = true;
        const material = new THREE.MeshBasicMaterial({ color:'#709980', transparent:true, opacity:.9, depthTest:false, depthWrite:false });
        const guide = new THREE.Mesh(new THREE.BoxGeometry(2, 1, 2), material);
        const foot = new THREE.Mesh(new THREE.BoxGeometry(12, 2, 4), material); foot.position.y = 1;
        dropMarker.add(guide, foot); furniture.add(dropMarker);
      }
      canvas.dataset.dropShelf = dropPosition ? String(dropPosition.shelf) : '';
      canvas.dataset.dropX = dropPosition ? dropPosition.x.toFixed(4) : '';
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
        const x = row && Number.isFinite(center) ? center - entry.x : 0;
        const y = row && Number.isFinite(center) ? entry.y - (row.bottom - entry.height / 2) : 0;
        changed = previewOffset(entry, x, y, now) || changed;
      }
      if (changed) invalidate();
    },
    updateEntry(node, book, style, coverUrl) {
      const entry = byNode.get(node);
      if (!entry) return;
      updateRecord(entry, book, style, coverUrl);
      invalidate();
    },
    updateLayout(next) {
      if (disposed) return false;
      shelfSnapshotDirty = true;
      cancelAnimationFrame(raf); raf = 0; mutations.disconnect();
      const oldEntries = new Map(bookEntries.map(entry => [entry.key, entry]));
      const oldWidth = width, oldHeight = height, oldRows = JSON.stringify(rows), oldDepth = depth;
      // Restore only the outgoing DOM. The already painted canvas and GPU
      // resources remain alive while the replacement semantic tree is bound.
      if (next.stage !== stage) {
        stage.style.height = originalHeight;
        if (!alreadyScene) stage.classList.remove('has-scene');
        for (const [node, style] of originalStyles) {
          if (style === null) node.removeAttribute('style'); else node.setAttribute('style', style);
          delete node.dataset.sceneProjected;
        }
        originalStyles.clear();
        stage = next.stage;
        originalHeight = stage.style.height;
        alreadyScene = stage.classList.contains('has-scene');
        stage.classList.add('has-scene');
        stage.prepend(canvas);
      }
      width = next.width; height = next.height; rows = next.rows;
      sceneWidth = Math.max(width, Number(next.sceneWidth) || width);
      const nextTrashNode = next.trashNode || null;
      if (nextTrashNode !== trashNode) {
        if (trashNode) {
          const original = trashOriginalStyles.get(trashNode);
          if (original === null) trashNode.removeAttribute('style'); else if (original !== undefined) trashNode.setAttribute('style', original);
          delete trashNode.dataset.trash3d;
        }
        trashNode = nextTrashNode;
        if (trashNode && !trashOriginalStyles.has(trashNode)) trashOriginalStyles.set(trashNode, trashNode.getAttribute('style'));
        if (trashNode && !trash) { trash = createShelfTrash(); scene.add(trash); }
        else if (!trashNode && trash) { trash.removeFromParent(); trash.userData.dispose(); trash = null; }
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
          entry.node = data.node;
          if (data.kind === 'plant') {
            if (plantKeys(entry) !== plantKeys(data)) releaseEntry(entry);
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
      fitDepth(Math.max(155, ...bookEntries.filter(entry => entry.kind !== 'plant').map(entry => entry.width + 12)));
      for (const entry of bookEntries) if (entry.node) {
        byNode.set(entry.node, entry);
        mutations.observe(entry.node, { attributes:true, attributeFilter:['class', 'style'] });
      }
      if (reorderTransition) reorderTransition.entries = reorderTransition.entries.filter(item => retained.includes(item.entry));
      if (width !== oldWidth || height !== oldHeight || depth !== oldDepth || JSON.stringify(rows) !== oldRows) rebuildFurniture();
      fullBounds.min.set(-width / 2, -height - boardHeight, -depth - 4);
      fullBounds.max.set(width / 2, 2, 12);
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
        if (!old || !entry.rect) continue;
        const x = old.left - (entry.rect.left + stageRect.left), y = old.top - (entry.rect.top + stageRect.top);
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
      scroller.removeEventListener('scroll', invalidate); window.removeEventListener('resize', invalidate);
      for (const entry of bookEntries) releaseEntry(entry);
      if (catalog) { catalog.removeFromParent(); catalog.userData.dispose(); }
      releaseObject(furniture); texture.dispose(); grain.dispose(); leafTexture.dispose(); lighting.dispose();
      trash?.userData.dispose();
      canvas.remove(); stage.style.height = originalHeight;
      if (!alreadyScene) stage.classList.remove('has-scene');
      for (const [node, style] of originalStyles) {
        if (style === null) node.removeAttribute('style'); else node.setAttribute('style', style);
        delete node.dataset.sceneProjected;
      }
      for (const [node, style] of trashOriginalStyles) {
        if (style === null) node.removeAttribute('style'); else node.setAttribute('style', style);
        delete node.dataset.trash3d;
        delete node.dataset.trashHover;
        delete node.dataset.trashDropProgress;
      }
      for (const node of catalogOriginalStates.keys()) restoreCatalogNode(node);
    }
  };
}
