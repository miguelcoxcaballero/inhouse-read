import * as THREE from 'three';

// A half-ellipse extruded along the binding. Shared vertices give the entire
// binding continuous normals, including the silhouette seen beside the cover.
export function bindingGeometry(width, height, thickness, segments = 96) {
  const positions = [], normals = [], uv = [], indices = [];
  const bulge = thickness * 0.38;
  for (let i = 0; i <= segments; i++) {
    const a = i / segments * Math.PI;
    const nx = -Math.sin(a) / bulge, nz = -Math.cos(a) / (thickness / 2);
    const length = Math.hypot(nx, nz);
    for (let j = 0; j < 2; j++) {
      positions.push(-width / 2 - bulge * Math.sin(a), (j - .5) * height, -thickness / 2 * Math.cos(a));
      normals.push(nx / length, 0, nz / length);
      uv.push(i / segments, j);
    }
    if (i < segments) { const k = i * 2; indices.push(k, k + 2, k + 1, k + 1, k + 2, k + 3); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(indices);
  return g;
}

// Rounded board edges, with front/back UVs in the same coordinates as a cover.
// The bevel stays inside the book dimensions so the shelf and flyout match.
export function boardGeometry(width, height, depth) {
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
    bevelSize: bevel, bevelSegments: 3, steps: 1, curveSegments: 5
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

function texture(book, style, spine) {
  const canvas = document.createElement('canvas');
  canvas.width = spine ? 256 : 676; canvas.height = 1024;
  const c = canvas.getContext('2d');
  c.fillStyle = style.color; c.fillRect(0, 0, canvas.width, canvas.height);
  // Fine woven cloth, rather than thick horizontal stripes.
  c.globalAlpha = .035; c.fillStyle = '#fff';
  for (let y = 0; y < 1024; y += 4) c.fillRect(0, y, canvas.width, 1);
  c.globalAlpha = .035; c.fillStyle = '#000';
  for (let x = 0; x < canvas.width; x += 4) c.fillRect(x, 0, 1, 1024);
  c.globalAlpha = 1; c.fillStyle = style.ink;
  c.textAlign = 'center'; c.textBaseline = 'middle';
  if (spine) {
    c.strokeStyle = style.ink; c.lineWidth = 2;
    c.globalAlpha = .45;
    for (const y of [55, 65, 959, 969]) { c.beginPath(); c.moveTo(36, y); c.lineTo(220, y); c.stroke(); }
    if (style.texture === 'panel') { c.globalAlpha = .1; c.fillRect(40, 88, 176, 848); }
    if (style.texture === 'bands' || style.texture === 'ribbed') {
      c.globalAlpha = .16;
      for (const y of [100, 924]) c.fillRect(0, y, 256, style.texture === 'bands' ? 20 : 6);
    }
    c.globalAlpha = 1;
    c.translate(128, 512); c.rotate(Math.PI / 2);
    c.font = '700 44px "Playfair Display", Georgia, serif';
    c.fillText(book.title || 'Sin título', 0, book.author ? -13 : 0, 780);
    c.globalAlpha = .8; c.font = '26px "DM Sans", sans-serif';
    c.fillText(book.author || '', 0, 41, 730);
  } else {
    // Design in physical cover proportions so lettering is never stretched.
    const center = canvas.width / 2;
    c.strokeStyle = style.ink; c.globalAlpha = .3; c.lineWidth = 1.5;
    c.strokeRect(42, 42, canvas.width - 84, 940); c.strokeRect(48, 48, canvas.width - 96, 928);
    c.globalAlpha = .8; c.lineWidth = 3; c.beginPath();
    c.moveTo(center - 21, 185); c.lineTo(center, 164); c.lineTo(center + 21, 185); c.stroke();
    c.font = '500 17px "DM Sans", sans-serif'; c.fillText('INHOUSE READ', center, 218);
    c.globalAlpha = 1; c.font = '700 54px "Playfair Display", Georgia, serif';
    const words = (book.title || 'Sin título').split(' '); let line = ''; const lines = [];
    for (const word of words) {
      if (c.measureText(line + word).width > 500 && line) { lines.push(line.trim()); line = ''; }
      line += word + ' ';
    }
    lines.push(line.trim());
    const visible = lines.slice(0, 6), spacing = 66;
    visible.forEach((text, i) => c.fillText(text + (i === 5 && lines.length > 6 ? '…' : ''), center, 460 + (i - (visible.length - 1) / 2) * spacing, 500));
    c.globalAlpha = .65; c.fillRect(center - 27, 735, 54, 1);
    c.globalAlpha = .9; c.font = '28px "DM Sans", sans-serif'; c.fillText(book.author || '', center, 790, 500);
    c.globalAlpha = .6; c.font = '500 18px "DM Sans", sans-serif'; c.fillText(book.format || '', center, 911);
  }
  const map = new THREE.CanvasTexture(canvas); map.colorSpace = THREE.SRGBColorSpace;
  return map;
}

export function createBookModel(book, style, width, height, thickness, coverUrl) {
  const group = new THREE.Group();
  const cloth = new THREE.MeshStandardMaterial({ color: style.color, roughness: .86 });
  const binding = new THREE.MeshStandardMaterial({ map: texture(book, style, true), roughness: .86, side: THREE.DoubleSide });
  const cover = new THREE.MeshStandardMaterial({ map: texture(book, style, false), roughness: .78 });
  const box = (w, h, d, material, x = 0, y = 0, z = 0) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    mesh.position.set(x, y, z); group.add(mesh); return mesh;
  };
  const board = height * .007;
  for (const front of [true, false]) {
    const mesh = new THREE.Mesh(boardGeometry(width, height, board), [front ? cover : cloth, cloth]);
    mesh.position.z = (front ? 1 : -1) * (thickness / 2 - board / 2); group.add(mesh);
  }
  const paper = vertical => {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 512;
    const c = canvas.getContext('2d'); c.fillStyle = '#e6dfd0'; c.fillRect(0, 0, 512, 512);
    for (let i = 2; i < 512; i += 4) {
      c.fillStyle = i % 12 === 2 ? 'rgba(92,77,57,.2)' : 'rgba(255,255,255,.32)';
      c.fillRect(vertical ? i : 0, vertical ? 0 : i, vertical ? 1 : 512, vertical ? 512 : 1);
    }
    const map = new THREE.CanvasTexture(canvas); map.colorSpace = THREE.SRGBColorSpace;
    return new THREE.MeshStandardMaterial({ map, roughness: 1 });
  };
  const foreEdge = paper(true), topEdge = paper(false);
  const inset = height * .009;
  box(width - inset * 2, height - inset * 2, thickness - board * 2.4,
    [foreEdge, foreEdge, topEdge, topEdge, topEdge, topEdge], inset * .3);
  // Recessed cloth hinges run beside the curved binding on both boards.
  const hinge = new THREE.MeshStandardMaterial({ color: style.shade || style.color, roughness: 1 });
  for (const z of [-1, 1]) {
    box(height * .0025, height * .966, height * .0007, hinge, -width / 2 + height * .017, 0, z * thickness / 2);
  }
  group.add(new THREE.Mesh(bindingGeometry(width, height, thickness), binding));
  const cap = new THREE.Shape(); cap.moveTo(-width / 2, -thickness / 2);
  for (let i = 0; i <= 96; i++) { const a = i / 96 * Math.PI; cap.lineTo(-width / 2 - thickness * .38 * Math.sin(a), -thickness / 2 * Math.cos(a)); }
  cap.closePath();
  for (const y of [-height / 2, height / 2]) {
    const mesh = new THREE.Mesh(new THREE.ShapeGeometry(cap), new THREE.MeshStandardMaterial({ color: style.color, roughness: .86, side: THREE.DoubleSide }));
    mesh.rotation.x = Math.PI / 2; mesh.position.y = y; group.add(mesh);
  }
  let disposed = false;
  if (coverUrl) new THREE.TextureLoader().load(coverUrl, map => {
    if (disposed) { map.dispose(); return; }
    map.colorSpace = THREE.SRGBColorSpace; cover.map.dispose(); cover.map = map; cover.needsUpdate = true;
    group.userData.invalidate?.();
  });
  group.userData.dispose = () => {
    disposed = true; const materials = new Set();
    group.traverse(obj => { obj.geometry?.dispose(); if (obj.material) for (const m of [].concat(obj.material)) materials.add(m); });
    for (const m of materials) { m.map?.dispose(); m.dispose(); }
  };
  return group;
}

let renderer;
const rendererSize = new THREE.Vector2();
function getRenderer() {
  if (!globalThis.WebGLRenderingContext && !globalThis.WebGL2RenderingContext) return null;
  if (!renderer) try {
    renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
  } catch { return null; }
  return renderer;
}

// One shared GPU context; individual canvases receive snapshots. No per-book
// contexts, and the flyout uses exactly the same mesh builder as the shelf.
export function bookView(host, book, style, { width, height, thickness, viewportWidth, viewportHeight, centerX, centerY, coverUrl, shelf = false }) {
  const gpu = getRenderer(); if (!gpu) return null;
  const canvas = document.createElement('canvas'); canvas.className = 'ihr-book-canvas'; canvas.setAttribute('aria-hidden', 'true');
  canvas.width = Math.ceil(viewportWidth * gpu.getPixelRatio()); canvas.height = Math.ceil(viewportHeight * gpu.getPixelRatio());
  host.append(canvas); const context = canvas.getContext('2d');
  const scene = new THREE.Scene(); scene.add(new THREE.HemisphereLight(0xffffff, 0x7b7469, 2));
  const light = new THREE.DirectionalLight(0xfff4e6, 2.2); light.position.set(-500, 700, 900); scene.add(light);
  const model = createBookModel(book, style, width, height, thickness, coverUrl); scene.add(model);
  const camera = new THREE.OrthographicCamera(-viewportWidth / 2, viewportWidth / 2, viewportHeight / 2, -viewportHeight / 2, .1, 10000); camera.position.z = 3000;
  let disposed = false, current, cancel = () => {};
  function draw(pose) {
    if (disposed) return; current = pose;
    model.position.set(centerX - viewportWidth / 2 + pose.x, viewportHeight / 2 - centerY - pose.y, 0);
    model.rotation.set((pose.pitch ?? 0) * Math.PI / 180, pose.angle * Math.PI / 180, 0); model.scale.setScalar(pose.scale);
    gpu.getSize(rendererSize);
    if (rendererSize.x !== viewportWidth || rendererSize.y !== viewportHeight) gpu.setSize(viewportWidth, viewportHeight, false);
    gpu.render(scene, camera);
    context.clearRect(0, 0, canvas.width, canvas.height); context.drawImage(gpu.domElement, 0, 0, canvas.width, canvas.height);
    canvas.dataset.angle = String(pose.angle); canvas.dataset.renderer = 'three-mesh';
  }
  model.userData.invalidate = () => current && draw(current);
  draw({ x: 0, y: 0, scale: 1, angle: shelf ? 90 : 0 });
  return { canvas, draw, animate(frames, { duration }) {
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
