import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { spineSurface, releaseSurface } from './spine-surface.js';
import { SURFACE_FINISHES, surfaceFinish } from './book-colors.js';
import { bookmarkFor } from './bookshelf-layout.js';

function applySurfaceFinish(material, value, fallback = 'satin') {
  const finish = SURFACE_FINISHES[surfaceFinish(value, fallback)];
  material.roughness = finish.roughness;
  material.clearcoat = finish.clearcoat;
  material.clearcoatRoughness = finish.clearcoatRoughness;
  material.envMapIntensity = finish.envMapIntensity;
  material.needsUpdate = true;
}

function applyCoverFinish(material, value) {
  applySurfaceFinish(material, value, 'satin');
  // Printed jackets reflect through a thin laminate. The stronger foil rig
  // must not veil the image in white or lift every colour into a highlight.
  material.specularIntensity = .45;
  material.envMapIntensity *= .7;
  material.clearcoat *= .65;
  material.clearcoatRoughness = Math.max(.1, material.clearcoatRoughness);
}

// A half-ellipse extruded along the binding. Shared vertices give the entire
// binding continuous normals, including the silhouette seen beside the cover.
export function bindingGeometry(width, height, thickness, segments = 96, relief = null, reliefRows = 384) {
  const positions = [], normals = [], uv = [], indices = [];
  const bulge = thickness * 0.38;
  const rows = relief ? reliefRows : 1;
  for (let i = 0; i <= segments; i++) {
    const a = i / segments * Math.PI;
    const nx = -Math.sin(a) / bulge, nz = -Math.cos(a) / (thickness / 2);
    const length = Math.hypot(nx, nz);
    for (let j = 0; j <= rows; j++) {
      const u = i / segments, v = j / rows;
      const depth = relief ? relief(u, v) * height * .0007 : 0;
      positions.push(-width / 2 - bulge * Math.sin(a) - nx / length * depth,
        (v - .5) * height, -thickness / 2 * Math.cos(a) - nz / length * depth);
      normals.push(nx / length, 0, nz / length); uv.push(u, v);
      if (i < segments && j < rows) {
        const k = i * (rows + 1) + j;
        indices.push(k, k + rows + 1, k + 1, k + 1, k + rows + 1, k + rows + 2);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(indices);
  if (relief) g.computeVertexNormals();
  return g;
}

// Rounded board edges, with front/back UVs in the same coordinates as a cover.
// The bevel stays inside the book dimensions so the shelf and flyout match.
export function boardGeometry(width, height, depth, { shelf = false } = {}) {
  const bevel = Math.min(depth * .22, height * .0018);
  const x = -width / 2 + bevel, y = -height / 2 + bevel;
  const w = width - bevel * 2, h = height - bevel * 2, r = height * .006;
  const shape = new THREE.Shape();
  shape.moveTo(x + r, y); shape.lineTo(x + w - r, y);
  shape.quadraticCurveTo(x + w, y, x + w, y + r);
  shape.lineTo(x + w, y + h - r); shape.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  shape.lineTo(x + r, y + h); shape.quadraticCurveTo(x, y + h, x, y + h - r);
  shape.lineTo(x, y + r); shape.quadraticCurveTo(x, y, x + r, y);
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: depth - bevel * 2, bevelEnabled: true, bevelThickness: bevel,
    bevelSize: bevel, bevelSegments: shelf ? 1 : 3, steps: 1, curveSegments: shelf ? 2 : 5
  });
  g.translate(0, 0, -depth / 2 + bevel);
  const positions = g.getAttribute('position'), uv = g.getAttribute('uv');
  for (const face of g.groups.filter(item => item.materialIndex === 0)) {
    for (let i = face.start; i < face.start + face.count; i++) {
      uv.setXY(i, positions.getX(i) / width + .5, positions.getY(i) / height + .5);
    }
  }
  return g;
}

/** A real ribbon mesh emerging from the top edge at the saved reading depth. */
export function bookmarkGeometry(width, height, thickness, progress, peek = 10) {
  const ribbonWidth = Math.max(3, Math.min(9, thickness * .22));
  const x = -width / 2 + Math.max(thickness * .75, ribbonWidth * 1.5);
  const depth = thickness / 2 - thickness * Math.max(0, Math.min(1, progress));
  const points = [
    [height / 2 - height * .15, depth],
    [height / 2 - 2, depth],
    [height / 2 + 2, depth + thickness * .12],
    [height / 2 + Math.max(4, peek * .55), thickness * .2],
    [height / 2 + peek, 0]
  ];
  const positions = [], uvs = [], indices = [];
  for (let i = 0; i < points.length; i++) {
    const [y, z] = points[i];
    positions.push(x - ribbonWidth / 2, y, z, x + ribbonWidth / 2, y, z);
    uvs.push(0, i / (points.length - 1), 1, i / (points.length - 1));
    if (i < points.length - 1) {
      const start = i * 2;
      indices.push(start, start + 1, start + 2, start + 1, start + 3, start + 2);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

export function fitCoverImage(imageWidth, imageHeight, width, height) {
  const scale = Math.min(width / imageWidth, height / imageHeight);
  const w = imageWidth * scale, h = imageHeight * scale;
  return { x:(width - w) / 2, y:(height - h) / 2, width:w, height:h };
}

function coverTexture(book, style, textureHeight = 2048) {
  const canvas = document.createElement('canvas');
  const designWidth = Math.round(1024 * (Number(style.coverRatio) || .66));
  canvas.width = Math.round(designWidth * textureHeight / 1024); canvas.height = textureHeight;
  const c = canvas.getContext('2d'); c.scale(textureHeight / 1024, textureHeight / 1024);
  c.fillStyle = style.color; c.fillRect(0, 0, designWidth, 1024);
  c.fillStyle = style.ink; c.textAlign = 'center'; c.textBaseline = 'middle';
  // Design in physical cover proportions so lettering is never stretched.
  const center = designWidth / 2;
  const coverScale = designWidth / 676;
  const titleSize = Math.max(36, Math.min(82, 54 * coverScale));
  const titleWidth = Math.min(500 * coverScale, designWidth - 72);
  c.strokeStyle = style.ink; c.globalAlpha = .3; c.lineWidth = 1.5;
  c.strokeRect(42, 42, designWidth - 84, 940); c.strokeRect(48, 48, designWidth - 96, 928);
  c.globalAlpha = .8; c.lineWidth = 3; c.beginPath();
  c.moveTo(center - 21, 185); c.lineTo(center, 164); c.lineTo(center + 21, 185); c.stroke();
  c.font = '500 17px "DM Sans", sans-serif'; c.fillText('INHOUSE READ', center, 218);
  c.globalAlpha = 1; c.font = `${style.fontWeight || 700} ${titleSize}px "${style.fontCanvasFamily || style.fontFamily || 'Playfair Display'}", ${style.fontFallback || 'Georgia, serif'}`;
  const words = (book.title || 'Sin título').split(' '); let line = ''; const lines = [];
  for (const word of words) {
    if (c.measureText(line + word).width > titleWidth && line) { lines.push(line.trim()); line = ''; }
    line += word + ' ';
  }
  lines.push(line.trim());
  const visible = lines.slice(0, 6), spacing = 66;
  visible.forEach((text, i) => c.fillText(text + (i === 5 && lines.length > 6 ? '…' : ''), center, 460 + (i - (visible.length - 1) / 2) * spacing, titleWidth));
  c.globalAlpha = .65; c.fillRect(center - 27, 735, 54, 1);
  c.globalAlpha = .9; c.font = '28px "DM Sans", sans-serif'; c.fillText(book.author || '', center, 790, 500);
  c.globalAlpha = .6; c.font = '500 18px "DM Sans", sans-serif'; c.fillText(book.format || '', center, 911);
  const map = new THREE.CanvasTexture(canvas); map.colorSpace = THREE.SRGBColorSpace;
  return map;
}

function shelfSpineSurface(book, style, height, thickness, shelf) {
  const surface = spineSurface(book, style, height, thickness);
  if (shelf) for (const texture of [surface.map, surface.channels]) {
    const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 1024;
    canvas.getContext('2d').drawImage(texture.image, 0, 0, canvas.width, canvas.height);
    texture.image = canvas; texture.needsUpdate = true;
  }
  return surface;
}

export function createBookModel(book, style, width, height, thickness, coverUrl, { shelf = false } = {}) {
  const group = new THREE.Group();
  const textureHeight = shelf ? 512 : 2048;
  const bindingSegments = shelf ? 32 : 96, reliefRows = shelf ? 96 : 384;
  const cloth = new THREE.MeshStandardMaterial({ color: style.color, roughness: .86 });
  let surface = shelfSpineSurface(book, style, height, thickness, shelf);
  const binding = new THREE.MeshPhysicalMaterial({ ...surface.material, side: THREE.DoubleSide });
  const cover = new THREE.MeshPhysicalMaterial({ map: coverTexture(book, style, textureHeight) });
  applyCoverFinish(cover, book.coverFinish);
  const box = (w, h, d, material, x = 0, y = 0, z = 0) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    mesh.position.set(x, y, z); group.add(mesh); return mesh;
  };
  const board = height * .007;
  const frontCover = new THREE.Group();
  frontCover.position.x = -width / 2;
  group.add(frontCover);
  const frontBoard = new THREE.Mesh(boardGeometry(width, height, board, { shelf }), [cover, cloth]);
  frontBoard.name = 'front-cover';
  frontBoard.position.set(width / 2, 0, thickness / 2 - board / 2);
  frontCover.add(frontBoard);
  const backBoard = new THREE.Mesh(boardGeometry(width, height, board, { shelf }), [cloth, cloth]);
  backBoard.position.z = -thickness / 2 + board / 2;
  group.add(backBoard);
  const paper = vertical => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = shelf ? 128 : 512;
    const c = canvas.getContext('2d'); c.fillStyle = '#e6dfd0'; c.fillRect(0, 0, 512, 512);
    for (let i = 2; i < 512; i += 4) {
      c.fillStyle = i % 12 === 2 ? 'rgba(92,77,57,.2)' : 'rgba(255,255,255,.32)';
      c.fillRect(vertical ? i : 0, vertical ? 0 : i, vertical ? 1 : 512, vertical ? 512 : 1);
    }
    const map = new THREE.CanvasTexture(canvas); map.colorSpace = THREE.SRGBColorSpace;
    return new THREE.MeshPhysicalMaterial({ map, roughness: 1 });
  };
  const foreEdge = paper(true), topEdge = paper(false);
  applySurfaceFinish(foreEdge, book.pageEdgeFinish, 'satin');
  applySurfaceFinish(topEdge, book.pageEdgeFinish, 'satin');
  const inset = height * .009;
  const pageBlock = box(width - inset * 2, height - inset * 2, thickness - board * 2.4,
    [foreEdge, foreEdge, topEdge, topEdge, topEdge, topEdge], inset * .3);
  pageBlock.name = 'page-block';
  const bookmark = bookmarkFor(book);
  let ribbonMaterial = null, ribbonMesh = null;
  if (bookmark) {
    ribbonMaterial = new THREE.MeshPhysicalMaterial({
      color: bookmark.finished ? '#c79a3e' : '#b3342d',
      roughness: .34, metalness: bookmark.finished ? .28 : .02,
      clearcoat: .72, clearcoatRoughness: .2,
      side: THREE.DoubleSide
    });
    ribbonMesh = new THREE.Mesh(
      bookmarkGeometry(width, height, thickness, bookmark.progress, bookmark.peek),
      ribbonMaterial
    );
    ribbonMesh.renderOrder = 4;
    group.add(ribbonMesh);
  }
  // Recessed cloth hinges run beside the curved binding on both boards.
  const hinge = new THREE.MeshStandardMaterial({ color: style.shade || style.color, roughness: 1 });
  for (const z of [-1, 1]) {
    box(height * .0025, height * .966, height * .0007, hinge, -width / 2 + height * .017, 0, z * thickness / 2);
  }
  const bindingMesh = new THREE.Mesh(bindingGeometry(width, height, thickness, bindingSegments, surface.relief, reliefRows), binding);
  bindingMesh.name = 'binding';
  group.add(bindingMesh);
  const cap = new THREE.Shape(); cap.moveTo(-width / 2, -thickness / 2);
  for (let i = 0; i <= bindingSegments; i++) { const a = i / bindingSegments * Math.PI; cap.lineTo(-width / 2 - thickness * .38 * Math.sin(a), -thickness / 2 * Math.cos(a)); }
  cap.closePath();
  const capMaterials = [];
  for (const y of [-height / 2, height / 2]) {
    const metallic = ['gold','silver'].includes(book.spineFinish);
    const mesh = new THREE.Mesh(new THREE.ShapeGeometry(cap), new THREE.MeshPhysicalMaterial({ color: style.color,
      roughness: metallic ? .3 : .86, metalness: metallic ? 1 : 0, envMapIntensity:metallic ? 1.8 : 1,
      clearcoat:metallic ? .42 : 0, clearcoatRoughness:metallic ? .16 : .4, side: THREE.DoubleSide }));
    capMaterials.push(mesh.material);
    mesh.rotation.x = Math.PI / 2; mesh.position.y = y; group.add(mesh);
  }
  let disposed = false;
  if (coverUrl) new THREE.TextureLoader().load(coverUrl, map => {
    if (disposed) { map.dispose(); return; }
    // The physical cover follows the decoded aspect ratio, so the image fills
    // the face without cropping or letterboxing for normal book covers.
    try {
      const canvas = document.createElement('canvas');
      canvas.height = textureHeight;
      canvas.width = Math.round(canvas.height * (Number(style.coverRatio) || 0.66));
      const c = canvas.getContext('2d'); c.fillStyle = style.color; c.fillRect(0, 0, canvas.width, canvas.height);
      const fit = fitCoverImage(map.image.width, map.image.height, canvas.width, canvas.height);
      c.drawImage(map.image, fit.x, fit.y, fit.width, fit.height);
      const fittedMap = new THREE.CanvasTexture(canvas); fittedMap.colorSpace = THREE.SRGBColorSpace;
      cover.map?.dispose(); cover.map = fittedMap; cover.needsUpdate = true;
    } catch { /* Keep the generated cover if the decoded image cannot be drawn. */ }
    finally { map.dispose(); }
    group.userData.invalidate?.();
  }, undefined, () => { /* Retain the generated cover if the image is unavailable. */ });
  group.userData.dispose = () => {
    if (disposed) return;
    disposed = true; const materials = new Set(), textures = new Set([surface.map, surface.channels]);
    group.traverse(obj => { obj.geometry?.dispose(); if (obj.material) for (const m of [].concat(obj.material)) materials.add(m); });
    for (const m of materials) {
      for (const key of ['map', 'roughnessMap', 'metalnessMap', 'bumpMap']) if (m[key]) textures.add(m[key]);
      m.dispose();
    }
    for (const texture of textures) texture.dispose();
  };
  group.userData.updateSpineAppearance = (nextBook, nextStyle) => {
    const previous = surface;
    surface = shelfSpineSurface(nextBook, nextStyle, height, thickness, shelf);
    Object.assign(binding, surface.material);
    binding.needsUpdate = true;
    releaseSurface(previous);
    bindingMesh.geometry.dispose();
    bindingMesh.geometry = bindingGeometry(width, height, thickness, bindingSegments, surface.relief, reliefRows);
    cloth.color.set(nextStyle.color);
    hinge.color.set(nextStyle.shade || nextStyle.color);
    for (const material of capMaterials) {
      material.color.set(nextStyle.color);
      material.metalness = ['gold','silver'].includes(nextBook.spineFinish) ? 1 : 0;
      material.roughness = material.metalness ? .3 : .86;
      material.envMapIntensity = material.metalness ? 1.8 : 1;
      material.clearcoat = material.metalness ? .42 : 0;
      material.clearcoatRoughness = material.metalness ? .16 : .4;
    }
  };
  group.userData.updateCoverAppearance = nextBook => {
    applyCoverFinish(cover, nextBook.coverFinish);
  };
  group.userData.setCoverOpen = amount => {
    frontCover.rotation.y = -Math.PI * .82 * Math.max(0, Math.min(1, amount));
  };
  group.userData.hasBookmark = Boolean(bookmark);
  group.userData.updateEdgeAppearance = nextBook => {
    applySurfaceFinish(foreEdge, nextBook.pageEdgeFinish, 'satin');
    applySurfaceFinish(topEdge, nextBook.pageEdgeFinish, 'satin');
  };
  return group;
}

let renderer, studioEnvironment;
const rendererSize = new THREE.Vector2();
export function getBookRenderer() {
  if (!globalThis.WebGLRenderingContext && !globalThis.WebGL2RenderingContext) return null;
  if (!renderer) try {
    renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(Math.max(devicePixelRatio || 1, 2), 3));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    // Preserve print colours and gently compress real specular highlights.
    // Unmapped studio radiance used to clip RGB channels on bright jackets.
    renderer.toneMapping = THREE.NeutralToneMapping;
    renderer.toneMappingExposure = .82;
    const studio = new RoomEnvironment();
    const pmrem = new THREE.PMREMGenerator(renderer);
    studioEnvironment = pmrem.fromScene(studio, .04).texture;
    studio.dispose(); pmrem.dispose();
  } catch { return null; }
  return renderer;
}

/** One neutral light rig for shelf, editor and opening/closing book meshes. */
export function lightBookScene(scene) {
  scene.environment = studioEnvironment;
  scene.environmentIntensity = .62;
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8b8b8b, .48));
  const readerLight = new THREE.DirectionalLight(0xffffff, 1.25);
  readerLight.position.set(0, .45, 4); scene.add(readerLight);
  const fillLight = new THREE.DirectionalLight(0xffffff, .32);
  fillLight.position.set(-3, 2, 4); scene.add(fillLight);
  // A modest off-axis strip still travels over metallic foil and clearcoat.
  const stripLight = new THREE.DirectionalLight(0xffffff, .38);
  stripLight.position.set(3, 1, 2); scene.add(stripLight);
  return scene;
}

// One shared GPU context; individual canvases receive snapshots. No per-book
// contexts, and the flyout uses exactly the same mesh builder as the shelf.
export function bookView(host, book, style, { width, height, thickness, viewportWidth, viewportHeight, centerX, centerY, coverUrl, shelf = false, shelfView = 'spine' }) {
  const gpu = getBookRenderer(); if (!gpu) return null;
  // Shelf books are static snapshots. Keep their framebuffer modest on phones
  // so a long library does not retain a pile of high-DPI canvases in memory.
  const requestedPixelRatio = typeof devicePixelRatio === 'number' ? devicePixelRatio : 1;
  const pixelRatio = shelf
    ? Math.min(requestedPixelRatio, window.innerWidth < 600 ? 1.5 : 2)
    : Math.min(requestedPixelRatio, 2);
  const canvas = document.createElement('canvas'); canvas.className = 'ihr-book-canvas'; canvas.setAttribute('aria-hidden', 'true');
  canvas.width = Math.ceil(viewportWidth * pixelRatio); canvas.height = Math.ceil(viewportHeight * pixelRatio);
  host.append(canvas); const context = canvas.getContext('2d');
  const scene = lightBookScene(new THREE.Scene());
  let model = createBookModel(book, style, width, height, thickness, coverUrl, { shelf }); scene.add(model);
  canvas.dataset.bookmark3d = String(Boolean(model.userData.hasBookmark));
  if (shelf) canvas.dataset.shelfView = shelfView;
  const camera = new THREE.OrthographicCamera(-viewportWidth / 2, viewportWidth / 2, viewportHeight / 2, -viewportHeight / 2, .1, 10000); camera.position.z = 3000;
  let disposed = false, current, cancel = () => {};
  function draw(pose) {
    if (disposed) return; current = pose;
    model.position.set(centerX - viewportWidth / 2 + pose.x, viewportHeight / 2 - centerY - pose.y, 0);
    model.rotation.set((pose.pitch ?? 0) * Math.PI / 180, pose.angle * Math.PI / 180, 0); model.scale.setScalar(pose.scale);
    if (gpu.getPixelRatio() !== pixelRatio) gpu.setPixelRatio(pixelRatio);
    gpu.getSize(rendererSize);
    if (rendererSize.x !== viewportWidth || rendererSize.y !== viewportHeight) gpu.setSize(viewportWidth, viewportHeight, false);
    model.traverse(object => {
      for (const material of [].concat(object.material || [])) {
        for (const key of ['map', 'roughnessMap', 'metalnessMap', 'bumpMap']) {
          const map = material[key];
          if (map) map.anisotropy = Math.min(16, gpu.capabilities.getMaxAnisotropy());
        }
      }
    });
    gpu.render(scene, camera);
    context.clearRect(0, 0, canvas.width, canvas.height); context.drawImage(gpu.domElement, 0, 0, canvas.width, canvas.height);
    canvas.dataset.angle = String(pose.angle); canvas.dataset.renderer = 'three-mesh';
  }
  model.userData.invalidate = () => current && draw(current);
  draw({
    x:0, y:0, scale:1,
    angle:shelf ? (shelfView === 'isometric' ? 76 : 90) : 0,
    pitch:shelf && shelfView === 'isometric' ? 9 : 0
  });
  function updateAppearance(nextStyle) {
    if (disposed) return false;
    const pose = current;
    scene.remove(model);
    model.userData.dispose();
    model = createBookModel(book, nextStyle, width, height, thickness, coverUrl, { shelf });
    canvas.dataset.bookmark3d = String(Boolean(model.userData.hasBookmark));
    model.userData.invalidate = () => current && draw(current);
    scene.add(model);
    if (pose) draw(pose);
    return true;
  }
  function updateSpineAppearance(nextBook, nextStyle) {
    if (disposed) return false;
    model.userData.updateSpineAppearance?.(nextBook, nextStyle);
    if (current) draw(current);
    return true;
  }
  function updateCoverAppearance(nextBook) {
    if (disposed) return false;
    model.userData.updateCoverAppearance?.(nextBook);
    if (current) draw(current);
    return true;
  }
  function updateEdgeAppearance(nextBook) {
    if (disposed) return false;
    model.userData.updateEdgeAppearance?.(nextBook);
    if (current) draw(current);
    return true;
  }
  function animateCoverOpen({ duration = 520, offsetX = 0 } = {}) {
    let raf, resolve;
    const finished = new Promise(done => { resolve = done; });
    const start = performance.now(), origin = current || { x:0, y:0, scale:1, angle:0, pitch:0 };
    let cancelled = false;
    const animation = { finished, cancel() { cancelled = true; cancelAnimationFrame(raf); resolve(); } };
    const tick = now => {
      if (cancelled || disposed) return resolve();
      const raw = duration > 0 ? Math.min(1, (now - start) / duration) : 1;
      const amount = raw * raw * (3 - 2 * raw);
      model.userData.setCoverOpen?.(amount);
      draw({ ...origin, x:origin.x + offsetX * amount });
      if (raw < 1) raf = requestAnimationFrame(tick);
      else resolve();
    };
    raf = requestAnimationFrame(tick);
    return animation;
  }
  return { canvas, draw, updateAppearance, updateSpineAppearance, updateCoverAppearance, updateEdgeAppearance, animateCoverOpen, animate(frames, { duration }) {
    cancel();
    if (current) frames = [{ ...frames[0], transform: current }, ...frames.slice(1)];
    let raf, resolve; const finished = new Promise(r => resolve = r);
    cancel = () => { cancelAnimationFrame(raf); resolve(); };
    const start = performance.now();
    const tick = now => {
      const t = duration > 0 ? Math.min(1, (now - start) / duration) : 1;
      draw(sampleBookMotion(frames, t)); if (t < 1) raf = requestAnimationFrame(tick); else resolve();
    };
    raf = requestAnimationFrame(tick); return { finished, cancel };
  }, dispose(removeCanvas = true) { cancel(); disposed = true; model.userData.dispose(); if (removeCanvas) canvas.remove(); } };
}

// Monotone Hermite interpolation: continuous velocity, no unwanted overshoot
// when the book slows down, changes direction or returns to its shelf.
export function sampleBookMotion(frames, progress) {
  const times = frames.map((frame, i) => frame.offset ?? i / (frames.length - 1));
  const t = Math.max(0, Math.min(1, progress));
  let index = 0;
  while (index < frames.length - 2 && t > times[index + 1]) index++;
  const span = times[index + 1] - times[index], k = (t - times[index]) / span;
  const k2 = k * k, k3 = k2 * k, pose = {};
  for (const key of ['x', 'y', 'scale', 'angle', 'pitch']) {
    const value = i => frames[i].transform[key] ?? 0;
    const tangent = i => {
      if (i === 0 || i === frames.length - 1) return 0;
      const dt0 = times[i] - times[i - 1], dt1 = times[i + 1] - times[i];
      const a = (value(i) - value(i - 1)) / dt0, b = (value(i + 1) - value(i)) / dt1;
      if (a * b <= 0) return 0;
      const w0 = 2 * dt1 + dt0, w1 = dt1 + 2 * dt0;
      return (w0 + w1) / (w0 / a + w1 / b);
    };
    pose[key] = (2 * k3 - 3 * k2 + 1) * value(index) + (k3 - 2 * k2 + k) * span * tangent(index)
      + (-2 * k3 + 3 * k2) * value(index + 1) + (k3 - k2) * span * tangent(index + 1);
  }
  return pose;
}
