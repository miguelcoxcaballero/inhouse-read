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
export function boardGeometry(width, height, depth, { shelf = false, overview = false } = {}) {
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
    bevelSize: bevel, bevelSegments: shelf || overview ? 1 : 3, steps: 1, curveSegments: overview ? 1 : shelf ? 2 : 5
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
export function bookmarkGeometry(width, height, thickness, progress, peek = 10,
  { open = 0, withdraw = 0, segments = 32 } = {}) {
  // Peek values belong to the 200 px shelf book, not the much larger lifted
  // copy. Keep the ribbon's physical proportions identical in both models.
  const ribbonWidth = Math.min(width * .09, Math.max(height * .035, Math.min(height * .055, thickness * .42)));
  const visibleLength = height * Math.max(.09, Math.min(.17, (Number(peek) || 10) / 200 * 1.6));
  const x = -width / 2 + Math.max(thickness * .75, ribbonWidth * 1.5);
  const opening = Math.max(0, Math.min(1, open));
  const insideDepth = thickness / 2 - thickness * Math.max(0, Math.min(1, progress));
  const pageDepth = thickness / 2 - height * .0083 + height * .002;
  const depth = THREE.MathUtils.lerp(insideDepth, pageDepth, opening);
  const lift = height * 1.25 * Math.max(0, Math.min(1, withdraw));
  const positions = [], uvs = [], indices = [];
  const head = height / 2 - height * .012 + lift;
  const curve = new THREE.CubicBezierCurve3(new THREE.Vector3(x, head, depth),
    new THREE.Vector3(x, height / 2 + height * .016 + lift, depth + thickness * .12),
    new THREE.Vector3(x, height / 2 + visibleLength * .55 + lift,
      THREE.MathUtils.lerp(thickness * .2, pageDepth + height * .015, opening)),
    new THREE.Vector3(x, height / 2 + visibleLength + lift,
      THREE.MathUtils.lerp(0, pageDepth - height * .04, opening)));
  const steps = Math.max(4, Math.round((Number(segments) || 32) / 2) * 2), fabricDepth = height * .0018;
  for (let i = 0; i <= steps; i++) {
    const bend = Math.max(0, (i - steps / 2) / (steps / 2));
    const point = i <= steps / 2
      ? new THREE.Vector3(x, THREE.MathUtils.lerp(height / 2 - height * .64 + lift, head, i / (steps / 2)), depth)
      : curve.getPoint(bend);
    // A gentle twist turns the visible tip toward someone looking at the
    // binding; a flat page-aligned ribbon disappeared edge-on on the shelf.
    const twist = Math.PI / 2 * bend * bend * (3 - 2 * bend) * (1 - opening * .65);
    const dx = Math.cos(twist) * ribbonWidth / 2, dz = Math.sin(twist) * ribbonWidth / 2;
    const nx = -Math.sin(twist) * fabricDepth / 2, nz = Math.cos(twist) * fabricDepth / 2;
    positions.push(point.x - dx + nx, point.y, point.z - dz + nz,
      point.x + dx + nx, point.y, point.z + dz + nz,
      point.x - dx - nx, point.y, point.z - dz - nz,
      point.x + dx - nx, point.y, point.z + dz - nz);
    uvs.push(0, i / steps, 1, i / steps, 0, i / steps, 1, i / steps);
    if (i < steps) {
      const k = i * 4, n = k + 4;
      indices.push(k, k + 1, n, k + 1, n + 1, n,
        k + 2, n + 2, k + 3, k + 3, n + 2, n + 3,
        k, n, k + 2, k + 2, n, n + 2,
        k + 1, k + 3, n + 1, k + 3, n + 3, n + 1);
    }
  }
  indices.push(0, 2, 1, 1, 2, 3);
  const end = steps * 4;
  indices.push(end, end + 1, end + 2, end + 1, end + 3, end + 2);
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

function coverRasterDimensions(ratio, textureHeight, maxDimension = Infinity) {
  const height = textureHeight, width = Math.max(1, Math.round(height * (Number(ratio) || .66)));
  const scale = Math.min(1, maxDimension / Math.max(width, height));
  return { width:Math.max(1, Math.round(width * scale)), height:Math.max(1, Math.round(height * scale)) };
}

function coverTexture(book, style, textureHeight = 2048, maxDimension = Infinity) {
  const canvas = document.createElement('canvas');
  const designWidth = Math.round(1024 * (Number(style.coverRatio) || .66));
  const dimensions = coverRasterDimensions(designWidth / 1024, textureHeight, maxDimension);
  canvas.width = dimensions.width; canvas.height = dimensions.height;
  const c = canvas.getContext('2d'); c.scale(canvas.width / designWidth, canvas.height / 1024);
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

function shelfSpineSurface(book, style, height, thickness, shelf, overview) {
  if (overview) return spineSurface(book, style, height, thickness,
    { textureWidth:64, textureHeight:256, engraving:false });
  const surface = spineSurface(book, style, height, thickness);
  if (shelf) for (const texture of [surface.map, surface.channels]) {
    const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 1024;
    canvas.getContext('2d').drawImage(texture.image, 0, 0, canvas.width, canvas.height);
    texture.image = canvas; texture.needsUpdate = true;
  }
  return surface;
}

// Shelf and lifted copies of a book overlap during a transition. Keep the
// decoded image alive for exactly that overlap, so neither copy has to flash
// its generated cover while loading the same blob URL again.
const activeCoverImages = new Map();
function acquireCoverImage(url, onImage, onError) {
  let entry = activeCoverImages.get(url);
  const startLoad = !entry;
  if (!entry) {
    entry = { image:null, failed:false, users:0, listeners:new Set(), timer:0 };
    activeCoverImages.set(url, entry);
  }
  const listener = { onImage, onError };
  entry.users++;
  if (entry.image) onImage(entry.image);
  else if (entry.failed) onError();
  else entry.listeners.add(listener);
  const fail = () => {
    clearTimeout(entry.timer); entry.failed = true;
    if (activeCoverImages.get(url) === entry) activeCoverImages.delete(url);
    for (const waiting of entry.listeners) waiting.onError();
    entry.listeners.clear();
  };
  if (startLoad) {
    // A stalled external image must not hold the opening transition forever.
    // The failed entry is evicted so a later opening may retry the URL.
    if (!/^(blob:|data:)/i.test(url)) entry.timer = setTimeout(fail, 6000);
    new THREE.TextureLoader().load(url, map => {
    clearTimeout(entry.timer);
    if (entry.failed || !entry.users) { map.dispose(); return; }
    entry.image = map.image;
    for (const waiting of entry.listeners) waiting.onImage(entry.image);
    entry.listeners.clear(); map.dispose();
    }, undefined, fail);
  }
  let released = false;
  return () => {
    if (released) return;
    released = true; entry.listeners.delete(listener); entry.users--;
    if (!entry.users) {
      clearTimeout(entry.timer);
      if (activeCoverImages.get(url) === entry) activeCoverImages.delete(url);
    }
  };
}

export function createBookModel(book, style, width, height, thickness, coverUrl,
  { shelf = false, overview = false } = {}) {
  const group = new THREE.Group();
  group.userData.overview = group.userData.isOverview = Boolean(overview);
  group.userData.detailLevel = overview ? 'overview' : shelf ? 'shelf' : 'detail';
  const textureHeight = overview ? 256 : shelf ? 512 : 2048;
  const maxTextureDimension = overview ? 256 : Infinity;
  const bindingSegments = overview ? 16 : shelf ? 32 : 96, reliefRows = shelf ? 96 : 384;
  const ribbonSegments = overview ? 8 : 32;
  const cloth = new THREE.MeshStandardMaterial({ color: style.color, roughness: .86 });
  let surface = shelfSpineSurface(book, style, height, thickness, shelf, overview);
  const binding = new THREE.MeshPhysicalMaterial({ ...surface.material, side: THREE.DoubleSide });
  const cover = new THREE.MeshPhysicalMaterial({ map: coverTexture(book, style, textureHeight, maxTextureDimension) });
  applyCoverFinish(cover, book.coverFinish);
  const box = (w, h, d, material, x = 0, y = 0, z = 0) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    mesh.position.set(x, y, z); group.add(mesh); return mesh;
  };
  const board = height * .007;
  const frontCover = new THREE.Group();
  frontCover.name = 'front-cover-hinge';
  // Rotate around the board's binding edge. A hinge at the centre of the
  // page block made the board cut through the pages instead of opening out.
  frontCover.position.set(-width / 2, 0, thickness / 2 - board / 2);
  group.add(frontCover);
  const frontGeometry = boardGeometry(width, height, board, { shelf, overview });
  const insideCover = new THREE.MeshStandardMaterial({ color:'#e6dfd0', roughness:1 });
  insideCover.visible = false;
  const frontGroups = [...frontGeometry.groups];
  frontGeometry.clearGroups();
  for (const face of frontGroups) {
    if (face.materialIndex !== 0) { frontGeometry.addGroup(face.start, face.count, face.materialIndex); continue; }
    const normal = frontGeometry.getAttribute('normal');
    let start = face.start, material = normal.getZ(start) < 0 ? 2 : 0;
    for (let index = face.start + 3; index < face.start + face.count; index += 3) {
      const nextMaterial = normal.getZ(index) < 0 ? 2 : 0;
      if (nextMaterial !== material) {
        frontGeometry.addGroup(start, index - start, material); start = index; material = nextMaterial;
      }
    }
    frontGeometry.addGroup(start, face.start + face.count - start, material);
  }
  const frontMaterials = [cover, cloth, insideCover];
  const frontBoard = new THREE.Mesh(frontGeometry, overview ? cover : frontMaterials);
  frontBoard.name = 'front-cover';
  frontBoard.position.set(width / 2, 0, 0);
  frontCover.add(frontBoard);
  const backBoard = new THREE.Mesh(boardGeometry(width, height, board, { shelf, overview }), overview ? cloth : [cloth, cloth]);
  backBoard.name = 'back-cover';
  backBoard.position.z = -thickness / 2 + board / 2;
  group.add(backBoard);
  const paper = vertical => {
    const canvas = document.createElement('canvas');
    const size = overview ? 32 : shelf ? 128 : 512;
    canvas.width = canvas.height = size;
    const c = canvas.getContext('2d'); c.fillStyle = '#e6dfd0'; c.fillRect(0, 0, size, size);
    for (let i = 2; i < size; i += 4) {
      c.fillStyle = i % 12 === 2 ? 'rgba(92,77,57,.2)' : 'rgba(255,255,255,.32)';
      c.fillRect(vertical ? i : 0, vertical ? 0 : i, vertical ? 1 : size, vertical ? size : 1);
    }
    const map = new THREE.CanvasTexture(canvas); map.colorSpace = THREE.SRGBColorSpace;
    return new THREE.MeshPhysicalMaterial({ map, roughness: 1 });
  };
  const topEdge = paper(false), foreEdge = overview ? topEdge : paper(true);
  applySurfaceFinish(foreEdge, book.pageEdgeFinish, 'satin');
  applySurfaceFinish(topEdge, book.pageEdgeFinish, 'satin');
  const inset = height * .009;
  const pageBlock = box(width - inset * 2, height - inset * 2, thickness - board * 2.4,
    overview ? topEdge : [foreEdge, foreEdge, topEdge, topEdge, topEdge, topEdge], inset * .3);
  pageBlock.name = 'page-block';
  const pageWidth = width - inset * 2, pageHeight = height - inset * 2;
  const pageFront = thickness / 2 - board * 1.2 + board * .03;
  const pagePaper = new THREE.Mesh(new THREE.PlaneGeometry(pageWidth, pageHeight),
    new THREE.MeshBasicMaterial({ color:'#e6dfd0', toneMapped:false }));
  pagePaper.position.set(inset * .3, 0, pageFront);
  pagePaper.visible = false;
  pagePaper.name = 'reading-page-paper'; group.add(pagePaper);
  const pageMaterial = new THREE.MeshBasicMaterial({ color:0xffffff, toneMapped:false });
  const pageImage = new THREE.Mesh(new THREE.PlaneGeometry(pageWidth, pageHeight), pageMaterial);
  pageImage.name = 'reading-page';
  pageImage.position.set(inset * .3, 0, pageFront + board * .02);
  pageImage.visible = false; group.add(pageImage);
  group.userData.pageSurface = pageImage;
  group.userData.setPageSnapshot = snapshot => {
    if (disposed || !snapshot?.source) return false;
    const imageWidth = Number(snapshot.width || snapshot.source.width || snapshot.source.naturalWidth);
    const imageHeight = Number(snapshot.height || snapshot.source.height || snapshot.source.naturalHeight);
    if (!(imageWidth > 0 && imageHeight > 0)) return false;
    const fit = fitCoverImage(imageWidth, imageHeight, pageWidth, pageHeight);
    pageImage.geometry.dispose();
    pageImage.geometry = new THREE.PlaneGeometry(fit.width, fit.height);
    const map = new THREE.CanvasTexture(snapshot.source);
    map.colorSpace = THREE.SRGBColorSpace;
    map.minFilter = THREE.LinearFilter; map.generateMipmaps = false;
    pageMaterial.map?.dispose(); pageMaterial.map = map; pageMaterial.needsUpdate = true;
    pageImage.visible = true;
    group.userData.pageSnapshot = snapshot;
    group.userData.invalidate?.();
    return true;
  };
  let bookmark = bookmarkFor(book);
  let ribbonMaterial = null, ribbonMesh = null, coverOpening = 0, bookmarkWithdraw = 0;
  if (bookmark) {
    ribbonMaterial = new THREE.MeshPhysicalMaterial({
      color: bookmark.finished ? '#c79a3e' : '#b3342d',
      roughness: .34, metalness: bookmark.finished ? .28 : .02,
      clearcoat: .72, clearcoatRoughness: .2,
      side: THREE.DoubleSide
    });
    ribbonMesh = new THREE.Mesh(
      bookmarkGeometry(width, height, thickness, bookmark.progress, bookmark.peek, { segments:ribbonSegments }),
      ribbonMaterial
    );
    ribbonMesh.renderOrder = 4;
    ribbonMesh.name = 'reading-bookmark';
    group.add(ribbonMesh);
  }
  // Recessed cloth hinges run beside the curved binding on both boards.
  const hinge = new THREE.MeshStandardMaterial({ color: style.shade || style.color, roughness: 1 });
  if (!overview) {
    box(height * .0025, height * .966, height * .0007, hinge, -width / 2 + height * .017, 0, -thickness / 2);
    const frontHinge = new THREE.Mesh(new THREE.BoxGeometry(height * .0025, height * .966, height * .0007), hinge);
    frontHinge.position.set(height * .017, 0, board / 2);
    frontCover.add(frontHinge);
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
  let disposed = false, coverRevision = 0, currentCoverUrl, releaseImage = () => {}, resolveCoverReady = () => {};
  function updateCoverSource(url, nextBook = book, nextStyle = style) {
    if (disposed) return Promise.resolve(false);
    if (url && url === currentCoverUrl) return group.userData.ready;
    resolveCoverReady(false);
    const revision = ++coverRevision, releasePrevious = releaseImage;
    currentCoverUrl = url;
    group.userData.ready = new Promise(resolve => { resolveCoverReady = resolve; });
    const settle = loaded => {
      if (revision !== coverRevision || disposed) return;
      group.userData.coverLoaded = loaded;
      resolveCoverReady(loaded);
      group.userData.invalidate?.();
    };
    const replaceMap = map => { cover.map?.dispose(); cover.map = map; cover.needsUpdate = true; };
    if (!url) {
      releaseImage = () => {};
      replaceMap(coverTexture(nextBook, nextStyle, textureHeight, maxTextureDimension));
      settle(true);
    } else releaseImage = acquireCoverImage(url, image => {
      if (revision !== coverRevision || disposed) return;
      // The previous cover remains on the mesh until every new pixel is ready.
      try {
        const canvas = document.createElement('canvas');
        const dimensions = coverRasterDimensions(nextStyle.coverRatio, textureHeight, maxTextureDimension);
        canvas.height = dimensions.height; canvas.width = dimensions.width;
        const c = canvas.getContext('2d'); c.fillStyle = nextStyle.color; c.fillRect(0, 0, canvas.width, canvas.height);
        const fit = fitCoverImage(image.width, image.height, canvas.width, canvas.height);
        c.drawImage(image, fit.x, fit.y, fit.width, fit.height);
        const fittedMap = new THREE.CanvasTexture(canvas); fittedMap.colorSpace = THREE.SRGBColorSpace;
        replaceMap(fittedMap); settle(true);
      } catch { settle(false); }
    }, () => settle(false));
    releasePrevious();
    return group.userData.ready;
  }
  group.userData.updateCoverSource = updateCoverSource;
  updateCoverSource(coverUrl);
  group.userData.dispose = () => {
    if (disposed) return;
    releaseImage(); resolveCoverReady(false);
    disposed = true; const materials = new Set([insideCover, hinge]), textures = new Set([surface.map, surface.channels]);
    group.traverse(obj => { obj.geometry?.dispose(); if (obj.material) for (const m of [].concat(obj.material)) materials.add(m); });
    for (const m of materials) {
      for (const key of ['map', 'roughnessMap', 'metalnessMap', 'bumpMap']) if (m[key]) textures.add(m[key]);
      m.dispose();
    }
    for (const texture of textures) texture.dispose();
  };
  group.userData.updateSpineAppearance = (nextBook, nextStyle) => {
    const previous = surface;
    surface = shelfSpineSurface(nextBook, nextStyle, height, thickness, shelf, overview);
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
    const next = Math.max(0, Math.min(1, amount));
    frontCover.rotation.y = -Math.PI * .94 * next;
    if (overview) frontBoard.material = next > 0 ? frontMaterials : cover;
    // Closed shelf books need neither the occluded paper plane nor the
    // cover's inner material submitted to the GPU on every shelf repaint.
    pagePaper.visible = next > 0;
    insideCover.visible = next > 0;
    if (Math.abs(next - coverOpening) > .00001) { coverOpening = next; updateRibbonGeometry(); }
  };
  function updateRibbonGeometry() {
    if (!ribbonMesh || !bookmark) return;
    ribbonMesh.geometry.dispose();
    ribbonMesh.geometry = bookmarkGeometry(width, height, thickness, bookmark.progress, bookmark.peek,
      { open:Math.max(0, Math.min(1, (coverOpening - .1) / .9)), withdraw:bookmarkWithdraw, segments:ribbonSegments });
    ribbonMesh.visible = bookmarkWithdraw < .999;
  }
  group.userData.setBookmarkWithdraw = amount => {
    const next = Math.max(0, Math.min(1, Number(amount) || 0));
    if (Math.abs(next - bookmarkWithdraw) > .00001) { bookmarkWithdraw = next; updateRibbonGeometry(); }
  };
  group.userData.hasBookmark = Boolean(bookmark);
  group.userData.updateBookmark = nextBook => {
    if (disposed) return;
    bookmark = bookmarkFor(nextBook);
    if (ribbonMesh) { group.remove(ribbonMesh); ribbonMesh.geometry.dispose(); ribbonMaterial.dispose(); }
    ribbonMesh = null; ribbonMaterial = null;
    if (bookmark) {
      ribbonMaterial = new THREE.MeshPhysicalMaterial({
        color:bookmark.finished ? '#c79a3e' : '#b3342d', roughness:.34,
        metalness:bookmark.finished ? .28 : .02, clearcoat:.72,
        clearcoatRoughness:.2, side:THREE.DoubleSide
      });
      ribbonMesh = new THREE.Mesh(bookmarkGeometry(width, height, thickness, bookmark.progress, bookmark.peek,
        { segments:ribbonSegments }), ribbonMaterial);
      ribbonMesh.renderOrder = 4; ribbonMesh.name = 'reading-bookmark'; group.add(ribbonMesh);
      updateRibbonGeometry();
    }
    group.userData.hasBookmark = Boolean(bookmark);
    group.userData.invalidate?.();
  };
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
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    // The scene requests a shadow refresh only while something changes.
    renderer.shadowMap.autoUpdate = false;
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
  const readerLight = new THREE.DirectionalLight(0xfff9f2, 1.25);
  readerLight.position.set(-.28, .6, 1); scene.add(readerLight);
  scene.userData.readerLight = readerLight;
  const fillLight = new THREE.DirectionalLight(0xf0f5ff, .32);
  fillLight.position.set(-3, 2, 4); scene.add(fillLight);
  // A modest off-axis strip still travels over metallic foil and clearcoat.
  const stripLight = new THREE.DirectionalLight(0xffffff, .38);
  stripLight.position.set(3, 1, 2); scene.add(stripLight);
  return scene;
}

/** Project the actual fitted page image, rather than the book's outer board. */
export function projectBookPageBounds(page, camera, viewportWidth, viewportHeight, offset = { left:0, top:0 }) {
  if (!page?.visible || !page.geometry?.parameters) return null;
  page.updateWorldMatrix(true, false); camera.updateMatrixWorld();
  const { width, height } = page.geometry.parameters;
  const points = [[-width / 2, -height / 2], [width / 2, -height / 2],
    [-width / 2, height / 2], [width / 2, height / 2]].map(([x, y]) => {
    const projected = new THREE.Vector3(x, y, 0).applyMatrix4(page.matrixWorld).project(camera);
    return { x:(projected.x + 1) * viewportWidth / 2 + offset.left,
      y:(1 - projected.y) * viewportHeight / 2 + offset.top };
  });
  const left = Math.min(...points.map(point => point.x)), top = Math.min(...points.map(point => point.y));
  return { left, top, width:Math.max(...points.map(point => point.x)) - left,
    height:Math.max(...points.map(point => point.y)) - top };
}

/** Plan the handoff in the reader's flat plane without repainting the book. */
export function planBookPageZoom(model, camera, {
  viewportWidth, viewportHeight, centerX, centerY, origin,
  offset = { left:0, top:0 }, target
}) {
  const rotation = model.rotation.clone();
  let bounds;
  try {
    // Measuring the tilted preview leaves a small vertical compression in
    // the final frame. Measure its final orientation, then restore the pose
    // before the animation starts so the flattening itself stays continuous.
    model.rotation.set(0, 0, 0);
    bounds = projectBookPageBounds(model.userData.pageSurface, camera, viewportWidth, viewportHeight, offset);
  } finally {
    model.rotation.copy(rotation); model.updateMatrixWorld(true);
  }
  if (!bounds || !(bounds.width > 0 && bounds.height > 0 && target?.width > 0 && target?.height > 0)) return null;
  const factor = Math.min(target.width / bounds.width, target.height / bounds.height);
  const imageX = bounds.left + bounds.width / 2, imageY = bounds.top + bounds.height / 2;
  const modelX = offset.left + centerX + origin.x, modelY = offset.top + centerY + origin.y;
  return { ...origin,
    x:origin.x + target.left + target.width / 2 - imageX + (1 - factor) * (imageX - modelX),
    y:origin.y + target.top + target.height / 2 - imageY + (1 - factor) * (imageY - modelY),
    scale:origin.scale * factor, angle:0, pitch:0, roll:0, coverOpen:1, bookmarkWithdraw:1 };
}

// One shared GPU context; individual canvases receive snapshots. No per-book
// contexts, and the flyout uses exactly the same mesh builder as the shelf.
export function bookView(host, book, style, { width, height, thickness, viewportWidth, viewportHeight, centerX, centerY, coverUrl, shelf = false, shelfView = 'spine', initialPose }) {
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
  let disposed = false, current, cancel = () => {}, pendingModel = null, appearanceRevision = 0;
  let currentBook = book, currentSnapshot = null;
  function draw(pose) {
    if (disposed) return;
    current = { ...pose, coverOpen:Math.max(0, Math.min(1, pose.coverOpen ?? current?.coverOpen ?? 0)),
      bookmarkWithdraw:Math.max(0, Math.min(1, pose.bookmarkWithdraw ?? current?.bookmarkWithdraw ?? 0)) };
    model.userData.setCoverOpen?.(current.coverOpen);
    model.userData.setBookmarkWithdraw?.(current.bookmarkWithdraw);
    model.position.set(centerX - viewportWidth / 2 + pose.x, viewportHeight / 2 - centerY - pose.y, 0);
    model.rotation.set((pose.pitch ?? 0) * Math.PI / 180, pose.angle * Math.PI / 180, (pose.roll ?? 0) * Math.PI / 180); model.scale.setScalar(pose.scale);
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
    canvas.dataset.coverOpen = String(current.coverOpen);
    canvas.dataset.bookmarkWithdraw = String(current.bookmarkWithdraw);
  }
  model.userData.invalidate = () => current && draw(current);
  draw(initialPose ?? {
    x:0, y:0, scale:1,
    angle:shelf ? (shelfView === 'isometric' ? 76 : 90) : 0,
    pitch:shelf && shelfView === 'isometric' ? 9 : 0
  });
  function updateAppearance(nextStyle) {
    if (disposed) return false;
    const revision = ++appearanceRevision;
    pendingModel?.userData.dispose();
    const replacement = createBookModel(currentBook, nextStyle, width, height, thickness, coverUrl, { shelf });
    pendingModel = replacement;
    const replace = () => {
      if (disposed || revision !== appearanceRevision) { replacement.userData.dispose(); return; }
      const previous = model;
      scene.remove(previous); model = replacement; pendingModel = null;
      canvas.dataset.bookmark3d = String(Boolean(model.userData.hasBookmark));
      scene.add(model);
      model.userData.invalidate = () => current && draw(current);
      if (currentSnapshot) model.userData.setPageSnapshot(currentSnapshot);
      if (current) draw(current);
      previous.userData.dispose();
    };
    if (replacement.userData.coverLoaded) replace();
    else replacement.userData.ready.then(replace);
    return true;
  }
  function updateSpineAppearance(nextBook, nextStyle) {
    if (disposed) return false;
    currentBook = { ...currentBook, ...nextBook };
    pendingModel?.userData.updateSpineAppearance?.(nextBook, nextStyle);
    model.userData.updateSpineAppearance?.(nextBook, nextStyle);
    if (current) draw(current);
    return true;
  }
  function updateCoverAppearance(nextBook) {
    if (disposed) return false;
    currentBook = { ...currentBook, ...nextBook };
    pendingModel?.userData.updateCoverAppearance?.(nextBook);
    model.userData.updateCoverAppearance?.(nextBook);
    if (current) draw(current);
    return true;
  }
  function updateEdgeAppearance(nextBook) {
    if (disposed) return false;
    currentBook = { ...currentBook, ...nextBook };
    pendingModel?.userData.updateEdgeAppearance?.(nextBook);
    model.userData.updateEdgeAppearance?.(nextBook);
    if (current) draw(current);
    return true;
  }
  function animateCoverOpen({ duration = 520, offsetX = 0 } = {}) {
    cancel();
    let raf, resolve;
    const finished = new Promise(done => { resolve = done; });
    const start = performance.now(), origin = current || { x:0, y:0, scale:1, angle:0, pitch:0 };
    let cancelled = false;
    cancel = () => { cancelled = true; cancelAnimationFrame(raf); resolve(); };
    const animation = { finished, cancel };
    const tick = now => {
      if (cancelled || disposed) return resolve();
      const raw = duration > 0 ? Math.min(1, (now - start) / duration) : 1;
      const amount = raw * raw * (3 - 2 * raw);
      draw({ ...origin, x:origin.x + offsetX * amount,
        coverOpen:(origin.coverOpen || 0) + (1 - (origin.coverOpen || 0)) * amount });
      if (raw < 1) raf = requestAnimationFrame(tick);
      else resolve();
    };
    raf = requestAnimationFrame(tick);
    return animation;
  }
  function setPageSnapshot(snapshot) {
    if (disposed || !model.userData.setPageSnapshot(snapshot)) return false;
    currentSnapshot = snapshot;
    pendingModel?.userData.setPageSnapshot(snapshot);
    canvas.dataset.pageSource = snapshot.sourceType || snapshot.engine || 'reader-page';
    canvas.dataset.pageLocator = JSON.stringify(snapshot.location?.locator ?? snapshot.location ?? null);
    canvas.dataset.pageText = String(snapshot.text || '').slice(0, 500);
    canvas.dataset.pageWidth = String(snapshot.width || snapshot.source.width);
    canvas.dataset.pageHeight = String(snapshot.height || snapshot.source.height);
    if (current) draw(current);
    return true;
  }
  function getPageBounds() {
    const rect = canvas.getBoundingClientRect();
    return projectBookPageBounds(model.userData.pageSurface, camera, viewportWidth, viewportHeight,
      { left:rect.left, top:rect.top });
  }
  function animateToPage({ left, top, width:targetWidth, height:targetHeight, duration = 620 }) {
    if (!current) return { finished:Promise.resolve(), cancel:() => {} };
    const origin = { ...current }, rect = canvas.getBoundingClientRect();
    const destination = planBookPageZoom(model, camera, {
      viewportWidth, viewportHeight, centerX, centerY, origin, offset:{ left:rect.left, top:rect.top },
      target:{ left, top, width:targetWidth, height:targetHeight }
    });
    if (!destination) {
      return { finished:Promise.resolve(), cancel:() => {} };
    }
    return animateMotion([{ transform:origin }, { transform:destination }], { duration });
  }
  function setBookmarkWithdraw(amount) {
    if (current) draw({ ...current, bookmarkWithdraw:amount });
  }
  function animateMotion(frames, { duration }) {
    cancel();
    if (current) frames = [{ ...frames[0], transform: current }, ...frames.slice(1)];
    let raf, resolve; const finished = new Promise(r => resolve = r);
    cancel = () => { cancelAnimationFrame(raf); resolve(); };
    const start = performance.now();
    const tick = now => {
      if (disposed) return resolve();
      const t = duration > 0 ? Math.min(1, (now - start) / duration) : 1;
      draw(sampleBookMotion(frames, t)); if (t < 1) raf = requestAnimationFrame(tick); else resolve();
    };
    raf = requestAnimationFrame(tick); return { finished, cancel };
  }
  return { canvas, get ready() { return (pendingModel || model).userData.ready; }, draw,
    updateAppearance, updateSpineAppearance, updateCoverAppearance, updateEdgeAppearance,
    setPageSnapshot, getPageBounds, setBookmarkWithdraw, animateCoverOpen, animateToPage,
    animate:animateMotion,
    dispose(removeCanvas = true) { cancel(); disposed = true; pendingModel?.userData.dispose(); model.userData.dispose(); if (removeCanvas) canvas.remove(); } };
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
  for (const key of ['x', 'y', 'scale', 'angle', 'pitch', 'roll', 'coverOpen', 'bookmarkWithdraw']) {
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
