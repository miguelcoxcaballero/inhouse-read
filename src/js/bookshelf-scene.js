import * as THREE from 'three';
import { createBookModel, getBookRenderer, lightBookScene } from './book-model.js';
import { bookmarkFor } from './bookshelf-layout.js';
import { shelfBookSlot, shelfBookInsertion, projectShelfBookPose } from './bookshelf-return.js';

const WALNUT = new URL('../assets/library/walnut.webp', import.meta.url).href;
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

// Plants are small meshes in the same scene, so their pots, leaves and shadows
// turn with the furniture rather than remaining flat in front of it.
function plantModel(entry) {
  const group = new THREE.Group();
  const w = entry.width || 58, h = entry.height || 100;
  const radius = w * .22, potHeight = h * .26;
  const pot = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius * .72, potHeight, 20),
    new THREE.MeshStandardMaterial({ color: '#ad8269', roughness: .88 }));
  pot.position.y = -h / 2 + potHeight / 2; group.add(pot);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(radius * .96, w * .021, 5, 20), pot.material);
  rim.rotation.x = Math.PI / 2; rim.position.y = -h / 2 + potHeight; group.add(rim);
  const soil = new THREE.Mesh(new THREE.CircleGeometry(radius * .9, 20),
    new THREE.MeshStandardMaterial({ color: '#35271a', roughness: 1 }));
  soil.rotation.x = -Math.PI / 2; soil.position.y = rim.position.y - .4; group.add(soil);
  const greens = ['#31573b', '#416b44', '#527e47'];
  for (let i = 0; i < 9; i++) {
    const angle = i * 2.399963, tall = .52 + (i % 3) * .15;
    const length = (h - potHeight) * tall;
    const leaf = new THREE.Mesh(new THREE.SphereGeometry(1, 8, 10),
      new THREE.MeshStandardMaterial({ color: greens[i % greens.length], roughness: .7 }));
    leaf.scale.set(w * .065, length / 2, w * .027);
    const spread = (i % 3 + 1) * w * .065;
    leaf.position.set(Math.cos(angle) * spread, rim.position.y + length * .44, Math.sin(angle) * spread);
    leaf.rotation.set(Math.sin(angle) * .3, angle, -Math.cos(angle) * .3);
    group.add(leaf);
  }
  group.userData.dispose = () => releaseObject(group);
  return group;
}

/** One demand-rendered scene for the entire piece of furniture and its books.
 * Pixel coordinates describe the unrotated shelf. DOM buttons remain semantic
 * hit targets, projected from the meshes after every camera/group update.
 */
export function createBookshelfScene({ stage, scroller, entries, rows, width, height, mode = 'spine' }) {
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
  const furniture = new THREE.Group();
  scene.add(furniture);
  const camera = new THREE.OrthographicCamera(0, width, 0, -1, .1, 20000);
  camera.position.z = 8000;
  const insertionCamera = new THREE.OrthographicCamera(0, 1, 0, -1, .1, 20000);
  insertionCamera.position.z = 8000;
  const texture = new THREE.TextureLoader().load(WALNUT, () => invalidate());
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(1.8, 1);
  const wood = new THREE.MeshStandardMaterial({ map:texture, color:'#b39174', roughness:.84 });
  const backWood = new THREE.MeshStandardMaterial({ map:texture, color:'#78614d', roughness:1 });
  const darkWood = new THREE.MeshStandardMaterial({ map:texture, color:'#9c7758', roughness:.9 });
  let depth = Math.max(155, ...entries.filter(e => e.kind !== 'plant').map(e => e.width + 12));
  const entryKey = (entry, index) => entry.kind === 'plant'
    ? `plant:${entry.node?.dataset.objectId ?? entry.key ?? index}`
    : `book:${String(entry.book?.id ?? entry.node?.dataset.bookId ?? entry.book?.path ?? entry.book?.title ?? index)}`;
  const freshPreview = () => ({ x:0, y:0, fromX:0, fromY:0, targetX:0, targetY:0, started:0, active:false });
  const freshEntry = (entry, index) => ({ ...entry, key:entryKey(entry, index), model:null, replacement:null, pose:new THREE.Object3D(),
    lift:{ value:0, from:0, target:0, started:0 }, landing:null, offset:{ x:0, y:0 }, preview:freshPreview(), state:'', rect:null, insertion:null });
  let bookEntries = entries.map(freshEntry);
  const byNode = new Map(bookEntries.filter(entry => entry.node).map(entry => [entry.node, entry]));
  const beam = (w, h, d, x, y, z, material = wood) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    // Record how each component relates to cabinet depth. Cover metadata may
    // arrive later; widening the book must also extend its shelf and back.
    mesh.userData.furniture = { width:w, height:h,
      depthExtra:d > depth / 2 ? d - depth : null,
      centerOffset:d > depth / 2 ? z + depth / 2 : null,
      backOffset:d <= depth / 2 && z < -depth * .75 ? z + depth : null };
    mesh.position.set(x, y, z); furniture.add(mesh); return mesh;
  };
  const boardHeight = 15;
  function rebuildFurniture() {
    for (const object of [...furniture.children]) if (object.userData.furniture) {
      furniture.remove(object); object.geometry.dispose();
    }
    // One continuous back avoids strips of page background between the rows.
    beam(width - 24, height - 12, 5, 0, -height / 2, -depth, backWood);
    for (const row of rows) {
      const bottom = row.bottom;
      beam(width - 12, boardHeight, depth + 10, 0, -bottom - boardHeight / 2, -depth / 2 + 3);
      beam(width - 10, 4, 4, 0, -bottom - 2, 9, wood);
      beam(width - 24, 5, 8, 0, -bottom + 2.5, -depth + 4, darkWood);
    }
    beam(12, height, depth + 6, -width / 2 + 6, -height / 2, -depth / 2, darkWood);
    beam(12, height, depth + 6, width / 2 - 6, -height / 2, -depth / 2, wood);
    beam(width, 12, depth + 10, 0, -6, -depth / 2 + 3);
  }
  rebuildFurniture();

  let disposed = false, raf = 0, renderCount = 0, modelCreations = 0, viewportHeight = 1, progress = mode === 'isometric' ? 1 : 0;
  let shelfSnapshotDirty = true, shelfSnapshotRenders = 0;
  let transition = null, reorderTransition = null;
  let dropMarker = null, dropPosition = null;
  let desiredMode = mode === 'isometric' ? 'isometric' : 'spine';
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

  function makeModel(entry) {
    const model = entry.kind === 'plant' ? plantModel(entry)
      : createBookModel(entry.book, entry.style, entry.width, entry.height, entry.thickness, entry.coverUrl, { shelf:true });
    model.userData.invalidate = invalidate;
    model.userData.entry = entry;
    if (entry.kind !== 'plant') model.userData.shelfKeys = materialKeys(entry);
    canvas.dataset.modelCreations = String(++modelCreations);
    return model;
  }

  function cancelReplacement(entry) {
    entry.replacement?.userData.dispose?.();
    entry.replacement = null;
  }

  function releaseEntry(entry) {
    cancelInsertion(entry);
    cancelReplacement(entry);
    if (entry.model) { furniture.remove(entry.model); entry.model.userData.dispose?.(); entry.model = null; }
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
    for (const object of furniture.children) {
      const part = object.userData.furniture;
      if (!part) continue;
      if (part.depthExtra !== null) {
        object.geometry.dispose();
        object.geometry = new THREE.BoxGeometry(part.width, part.height, depth + part.depthExtra);
        object.position.z = -depth / 2 + part.centerOffset;
      } else if (part.backOffset !== null) object.position.z = -depth + part.backOffset;
    }
    fullBounds.min.z = -depth - 4;
  }

  function updateWoodTheme() {
    const dark = document.documentElement.dataset.theme === 'dark';
    wood.color.set(dark ? '#88745f' : '#b39174');
    backWood.color.set(dark ? '#423f37' : '#78614d');
    darkWood.color.set(dark ? '#725f4d' : '#9c7758');
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
    const pixelWidth = Math.ceil(width * ratio), pixelHeight = Math.ceil(viewportHeight * ratio);
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth; canvas.height = pixelHeight; shelfSnapshotDirty = true;
    }
    canvas.style.width = `${width}px`; canvas.style.height = `${viewportHeight}px`;
    canvas.style.marginBottom = `${-viewportHeight}px`;
    // Read the actual sticky position: near the last shelf its bottom is
    // constrained by the stage, so scroller.scrollTop alone would double-shift
    // the drawing and leave it out of alignment with the real DOM hit targets.
    const scroll = Math.max(0, canvas.getBoundingClientRect().top - stage.getBoundingClientRect().top);
    camera.left = 0; camera.right = width; camera.top = 0; camera.bottom = -viewportHeight;
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
      const visible = (!away || insertion) && rect.bottom > scroll - 220 && rect.top < scroll + viewportHeight + 220;
      if (visible && !entry.model) {
        entry.model = makeModel(entry);
        furniture.add(entry.model);
      } else if (!visible && entry.model && !away) {
        releaseEntry(entry);
      }
      if (entry.model) {
        entry.model.visible = !away || Boolean(insertion && !insertion.overlayCanvas);
        if (insertion) {
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
    const pointer = new THREE.Vector2((clientX - bounds.left) / width * 2 - 1, 1 - (clientY - bounds.top) / viewportHeight * 2);
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
    const finishedInsertions = [];
    const { moving, shelfMoving } = updateEntries(scroll, zoom, now, finishedInsertions);
    const overlayInsertion = bookEntries.some(entry => entry.insertion?.overlayCanvas);
    // Its hidden slot and neighbors are already painted. Reuse that snapshot
    // during a stationary insertion instead of reallocating the shared GPU
    // buffer between the smaller shelf and full-screen output every frame.
    if (!overlayInsertion || shelfSnapshotDirty || furnitureMoving || shelfMoving) {
      if (renderer.getPixelRatio() !== ratio) renderer.setPixelRatio(ratio);
      renderer.getSize(rendererSize);
      if (rendererSize.x !== width || rendererSize.y !== viewportHeight) renderer.setSize(width, viewportHeight, false);
      renderer.render(scene, camera);
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.drawImage(renderer.domElement, 0, 0, canvas.width, canvas.height);
      canvas.dataset.snapshotRenderCount = String(++shelfSnapshotRenders);
      shelfSnapshotDirty = false;
    }
    for (const entry of bookEntries) if (entry.insertion?.overlayCanvas) paintInsertionOverlay(entry);
    canvas.dataset.renderCount = String(++renderCount);
    canvas.dataset.animating = String(Boolean(transition || reorderTransition || moving));
    for (const resolve of finishedInsertions) resolve();
    if (transition || reorderTransition || moving) invalidate(false);
  }

  function invalidate(dirty = true) {
    if (dirty) shelfSnapshotDirty = true;
    if (!disposed && !raf) raf = requestAnimationFrame(draw);
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
      const retained = [];
      for (let index = 0; index < next.entries.length; index++) {
        const data = next.entries[index], key = entryKey(data, index);
        let entry = oldEntries.get(key);
        if (entry) {
          oldEntries.delete(key);
          if (entry.node !== data.node && entry.node?.classList.contains('is-away')) data.node?.classList.add('is-away');
          entry.node = data.node;
          if (data.kind === 'plant') {
            if (entry.width !== data.width || entry.height !== data.height) releaseEntry(entry);
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
      releaseObject(furniture); texture.dispose(); canvas.remove(); stage.style.height = originalHeight;
      if (!alreadyScene) stage.classList.remove('has-scene');
      for (const [node, style] of originalStyles) {
        if (style === null) node.removeAttribute('style'); else node.setAttribute('style', style);
        delete node.dataset.sceneProjected;
      }
    }
  };
}
