import * as THREE from 'three';
import { createBookModel, getBookRenderer, lightBookScene } from './book-model.js';

const WALNUT = new URL('../assets/library/walnut.webp', import.meta.url).href;
const DURATION = 700;
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const ease = t => t * t * t * (t * (t * 6 - 15) + 10);

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
  const originalHeight = stage.style.height;
  const alreadyScene = stage.classList.contains('has-scene');
  const originalStyles = new Map(entries.filter(entry => entry.node).map(entry => [entry.node, entry.node.getAttribute('style')]));
  stage.classList.add('has-scene');
  stage.prepend(canvas);
  const scene = new THREE.Scene();
  lightBookScene(scene);
  const furniture = new THREE.Group();
  scene.add(furniture);
  const camera = new THREE.OrthographicCamera(0, width, 0, -1, .1, 20000);
  camera.position.z = 8000;
  const texture = new THREE.TextureLoader().load(WALNUT, () => invalidate());
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(1.8, 1);
  const wood = new THREE.MeshStandardMaterial({ map:texture, color:'#b39174', roughness:.84 });
  const backWood = new THREE.MeshStandardMaterial({ map:texture, color:'#78614d', roughness:1 });
  const darkWood = new THREE.MeshStandardMaterial({ map:texture, color:'#9c7758', roughness:.9 });
  let depth = Math.max(155, ...entries.filter(e => e.kind !== 'plant').map(e => e.width + 12));
  const bookEntries = entries.map(entry => ({ ...entry, model:null, pose:new THREE.Object3D(),
    lift:{ value:0, from:0, target:0, started:0 }, offset:{ x:0, y:0 }, state:'', rect:null }));
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
  // A cabinet has one continuous back: the spacing between shelf rows must
  // not reveal strips of the page background through the furniture.
  beam(width - 24, height - 12, 5, 0, -height / 2, -depth, backWood);
  for (const row of rows) {
    const bottom = row.bottom;
    beam(width - 12, boardHeight, depth + 10, 0, -bottom - boardHeight / 2, -depth / 2 + 3);
    // A slim lip and recessed rail catch different amounts of the same light.
    beam(width - 10, 4, 4, 0, -bottom - 2, 9, wood);
    beam(width - 24, 5, 8, 0, -bottom + 2.5, -depth + 4, darkWood);
  }
  beam(12, height, depth + 6, -width / 2 + 6, -height / 2, -depth / 2, darkWood);
  beam(12, height, depth + 6, width / 2 - 6, -height / 2, -depth / 2, wood);
  beam(width, 12, depth + 10, 0, -6, -depth / 2 + 3);

  let disposed = false, raf = 0, renderCount = 0, viewportHeight = 1, progress = mode === 'isometric' ? 1 : 0;
  let transition = null, reorderTransition = null;
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
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) { canvas.width = pixelWidth; canvas.height = pixelHeight; }
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

  function updateEntries(scroll, zoom, now) {
    let activeBooks = 0, moving = false;
    for (const entry of bookEntries) {
      const node = entry.node, plant = entry.kind === 'plant';
      const dragging = node?.classList.contains('is-dragging');
      const lifted = dragging || node?.classList.contains('is-lifted');
      const away = node?.classList.contains('is-away');
      const targetLift = plant ? 0 : lifted ? 1 : node?.classList.contains('is-pressed') ? .22 : 0;
      if (entry.lift.target !== targetLift) {
        entry.lift.from = entry.lift.value; entry.lift.target = targetLift; entry.lift.started = now;
      }
      const liftTime = reducedMotion.matches ? 1 : clamp((now - entry.lift.started) / 160, 0, 1);
      entry.lift.value = entry.lift.from + (entry.lift.target - entry.lift.from) * ease(liftTime);
      moving ||= liftTime < 1 && entry.lift.from !== entry.lift.target;
      const lift = entry.lift.value;
      const screenX = (dragging ? parseFloat(node.style.getPropertyValue('--ihr-drag-x')) || 0 : 0) + entry.offset.x;
      const screenY = (dragging ? parseFloat(node.style.getPropertyValue('--ihr-drag-y')) || 0 : 0) + entry.offset.y - 18 * lift;
      vector.set(screenX / zoom, -screenY / zoom, 30 * lift / zoom).applyQuaternion(inverseRotation);
      entry.pose.position.set(entry.x - width / 2 + vector.x, -entry.y + vector.y, (plant ? -entry.width * .35 : -entry.width / 2) + vector.z);
      entry.pose.rotation.y = plant ? 0 : Math.PI / 2 - 7 * Math.PI / 180 * lift;
      entry.pose.scale.setScalar(1 + .04 * lift);
      entry.pose.updateMatrix();
      projectedMatrix.multiplyMatrices(furniture.matrixWorld, entry.pose.matrix);
      const rect = corners(entry.box, projectedMatrix);
      entry.rect = rect;
      const visible = !away && rect.bottom > scroll - 220 && rect.top < scroll + viewportHeight + 220;
      if (visible && !entry.model) {
        entry.model = plant ? plantModel(entry) : createBookModel(entry.book, entry.style, entry.width, entry.height, entry.thickness, entry.coverUrl, { shelf:true });
        entry.model.userData.invalidate = invalidate;
        entry.model.userData.entry = entry;
        furniture.add(entry.model);
      } else if (!visible && entry.model && !away) {
        furniture.remove(entry.model); entry.model.userData.dispose?.(); entry.model = null;
      }
      if (entry.model) {
        entry.model.visible = !away;
        entry.model.position.copy(entry.pose.position);
        entry.model.rotation.copy(entry.pose.rotation);
        entry.model.scale.copy(entry.pose.scale);
        if (!plant && !away) activeBooks++;
      }
      if (node && !plant) {
        node.style.position = 'absolute'; node.style.left = `${rect.left}px`; node.style.top = `${rect.top}px`;
        node.style.width = `${rect.width}px`; node.style.height = `${rect.height}px`;
        node.style.margin = '0'; node.style.zIndex = String(100 + Math.round(rect.closest + height));
        node.dataset.sceneProjected = 'true';
      }
      entry.state = stateFor(entry);
    }
    canvas.dataset.activeBooks = String(activeBooks);
    return moving;
  }

  function draw(now = performance.now()) {
    raf = 0;
    if (disposed) return;
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
    const lifting = updateEntries(scroll, zoom, now);
    if (renderer.getPixelRatio() !== ratio) renderer.setPixelRatio(ratio);
    renderer.getSize(rendererSize);
    if (rendererSize.x !== width || rendererSize.y !== viewportHeight) renderer.setSize(width, viewportHeight, false);
    renderer.render(scene, camera);
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(renderer.domElement, 0, 0, canvas.width, canvas.height);
    canvas.dataset.renderCount = String(++renderCount);
    canvas.dataset.animating = String(Boolean(transition || reorderTransition || lifting));
    if (transition || reorderTransition || lifting) invalidate();
  }

  function invalidate() {
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
    flush() { cancelAnimationFrame(raf); raf = 0; draw(); },
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
      vector.copy(entry.pose.position).applyMatrix4(furniture.matrixWorld);
      const stageRect = stage.getBoundingClientRect();
      return { width:entry.width, height:entry.height, thickness:entry.thickness,
        angle:90 - 30 * progress - 7 * entry.lift.value, pitch:14 * progress, scale:furniture.scale.x * entry.pose.scale.x,
        centerX:stageRect.left + vector.x, centerY:stageRect.top - vector.y,
        rect:entry.rect && { ...entry.rect, left:stageRect.left + entry.rect.left, top:stageRect.top + entry.rect.top,
          right:stageRect.left + entry.rect.right, bottom:stageRect.top + entry.rect.bottom } };
    },
    getBookAtPoint(clientX, clientY) {
      // Metadata can replace a mesh between two frames; scrolling also updates
      // the camera on demand. Pick the scene that is actually ready to display.
      if (raf) { cancelAnimationFrame(raf); raf = 0; draw(); }
      const bounds = canvas.getBoundingClientRect();
      const pointer = new THREE.Vector2((clientX - bounds.left) / width * 2 - 1, 1 - (clientY - bounds.top) / viewportHeight * 2);
      const ray = new THREE.Raycaster(); ray.setFromCamera(pointer, camera);
      const pickable = furniture.children.filter(object => object.visible && !object.userData.entry?.node?.classList.contains('is-away'));
      for (const hit of ray.intersectObjects(pickable, true)) {
        let object = hit.object;
        while (object && !object.userData.entry) object = object.parent;
        if (object?.userData.entry?.kind !== 'plant' && object?.userData.entry?.node && object.visible) return object.userData.entry.node;
        // Solid wood or a plant in front blocks the book behind it.
        if (!object?.userData.entry || object.userData.entry.kind === 'plant') return null;
      }
      return null;
    },
    updateEntry(node, book, style, coverUrl) {
      const entry = byNode.get(node);
      if (!entry) return;
      if (entry.model) { furniture.remove(entry.model); entry.model.userData.dispose?.(); entry.model = null; }
      const baseline = entry.y + entry.height / 2;
      const previousRatio = entry.width / entry.height;
      const baseHeight = entry.height / (Number(entry.style.heightRatio) || 1);
      entry.height = baseHeight * (Number(style.heightRatio) || Number(entry.style.heightRatio) || 1);
      const ratio = Number(style.coverRatio);
      entry.width = entry.height * (ratio > 0 && Number.isFinite(ratio) ? clamp(ratio, .25, 2.5) : previousRatio);
      entry.thickness = Number(style.width) || entry.thickness;
      entry.y = baseline - entry.height / 2;
      entry.box = slotBox(entry);
      fitDepth(entry.width + 12);
      entry.book = book; entry.style = style; entry.coverUrl = coverUrl;
      invalidate();
    },
    animateFromRects(oldRects) {
      if (reducedMotion.matches) return;
      const stageRect = stage.getBoundingClientRect(), items = [];
      for (const entry of bookEntries) {
        const old = oldRects.get(entry.book?.id);
        if (!old || !entry.rect) continue;
        const x = old.left - (entry.rect.left + stageRect.left), y = old.top - (entry.rect.top + stageRect.top);
        if (Math.abs(x) + Math.abs(y) > 1) items.push({ entry, x, y });
      }
      reorderTransition = { started:performance.now(), entries:items }; invalidate();
    },
    dispose() {
      disposed = true; cancelAnimationFrame(raf); mutations.disconnect(); themeChanges.disconnect();
      scroller.removeEventListener('scroll', invalidate); window.removeEventListener('resize', invalidate);
      for (const entry of bookEntries) if (entry.model) { furniture.remove(entry.model); entry.model.userData.dispose?.(); }
      releaseObject(furniture); texture.dispose(); canvas.remove(); stage.style.height = originalHeight;
      if (!alreadyScene) stage.classList.remove('has-scene');
      for (const [node, style] of originalStyles) {
        if (style === null) node.removeAttribute('style'); else node.setAttribute('style', style);
        delete node.dataset.sceneProjected;
      }
    }
  };
}
