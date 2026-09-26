import * as THREE from 'three';

// A half-ellipse extruded along the binding. Shared vertices give the entire
// binding continuous normals, including the silhouette seen beside the cover.
export function bindingGeometry(width, height, thickness, segments = 96) {
  const positions = [], normals = [], uv = [], indices = [];
  const bulge = thickness * 0.55;
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

function texture(book, style, spine) {
  const canvas = document.createElement('canvas');
  canvas.width = spine ? 256 : 512; canvas.height = 768;
  const c = canvas.getContext('2d');
  c.fillStyle = style.color; c.fillRect(0, 0, canvas.width, canvas.height);
  c.globalAlpha = .06; c.fillStyle = '#fff';
  for (let y = 0; y < 768; y += 3) c.fillRect(0, y, canvas.width, 1);
  c.globalAlpha = 1; c.fillStyle = style.ink;
  c.textAlign = 'center'; c.textBaseline = 'middle';
  if (spine) {
    c.translate(128, 384); c.rotate(Math.PI / 2);
    c.font = 'bold 38px Georgia'; c.fillText(book.title || 'Sin título', 0, 0, 620);
    c.font = '22px Georgia'; c.fillText(book.author || '', 0, 48, 560);
  } else {
    c.strokeStyle = style.ink; c.globalAlpha = .4; c.lineWidth = 3;
    c.strokeRect(35, 35, 442, 698); c.globalAlpha = 1;
    c.font = 'bold 40px Georgia';
    const words = (book.title || 'Sin título').split(' '); let line = '', y = 260;
    for (const word of words) {
      if (c.measureText(line + word).width > 410 && line) { c.fillText(line, 256, y); y += 55; line = ''; }
      line += word + ' ';
    }
    c.fillText(line, 256, y); c.font = '25px Georgia'; c.fillText(book.author || '', 256, 620, 410);
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
  const board = Math.max(1, thickness * .045);
  const paperCanvas = document.createElement('canvas'); paperCanvas.width = 64; paperCanvas.height = 512;
  const paperContext = paperCanvas.getContext('2d'); paperContext.fillStyle = '#eee5d4'; paperContext.fillRect(0, 0, 64, 512);
  paperContext.fillStyle = '#c8bda9'; for (let y = 0; y < 512; y += 5) paperContext.fillRect(0, y, 64, 1);
  const paperMap = new THREE.CanvasTexture(paperCanvas); paperMap.colorSpace = THREE.SRGBColorSpace;
  box(width, height, board, [cloth, cloth, cloth, cloth, cover, cloth], 0, 0, thickness / 2 - board / 2);
  box(width, height, board, cloth, 0, 0, -thickness / 2 + board / 2);
  box(width - 3, height - 5, thickness - board * 2, new THREE.MeshStandardMaterial({ map: paperMap, roughness: 1 }), 1);
  group.add(new THREE.Mesh(bindingGeometry(width, height, thickness), binding));
  const cap = new THREE.Shape(); cap.moveTo(-width / 2, -thickness / 2);
  for (let i = 0; i <= 96; i++) { const a = i / 96 * Math.PI; cap.lineTo(-width / 2 - thickness * .55 * Math.sin(a), -thickness / 2 * Math.cos(a)); }
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
  const scene = new THREE.Scene(); scene.add(new THREE.HemisphereLight(0xffffff, 0x75624c, 2.4));
  const light = new THREE.DirectionalLight(0xffffff, 3); light.position.set(-300, 500, 700); scene.add(light);
  const model = createBookModel(book, style, width, height, thickness, coverUrl); scene.add(model);
  const camera = new THREE.OrthographicCamera(-viewportWidth / 2, viewportWidth / 2, viewportHeight / 2, -viewportHeight / 2, .1, 10000); camera.position.z = 3000;
  let disposed = false, current, cancel = () => {};
  function draw(pose) {
    if (disposed) return; current = pose;
    model.position.set(centerX - viewportWidth / 2 + pose.x, viewportHeight / 2 - centerY - pose.y, 0);
    model.rotation.set((pose.pitch ?? 0) * Math.PI / 180, pose.angle * Math.PI / 180, 0); model.scale.setScalar(pose.scale);
    gpu.setSize(viewportWidth, viewportHeight, false); gpu.render(scene, camera);
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
      const t = Math.min(1, (now - start) / duration);
      let index = 0; while (index < frames.length - 2 && t > (frames[index + 1].offset ?? 1)) index++;
      const a = frames[index], b = frames[index + 1], low = a.offset ?? 0, high = b.offset ?? 1;
      const raw = Math.max(0, Math.min(1, (t - low) / (high - low))), k = raw * raw * (3 - 2 * raw);
      const pose = {}; for (const key of ['x', 'y', 'scale', 'angle', 'pitch']) pose[key] = (a.transform[key] ?? 0) + ((b.transform[key] ?? 0) - (a.transform[key] ?? 0)) * k;
      draw(pose); if (t < 1) raf = requestAnimationFrame(tick); else resolve();
    };
    raf = requestAnimationFrame(tick); return { finished, cancel };
  }, dispose(removeCanvas = true) { cancel(); disposed = true; model.userData.dispose(); if (removeCanvas) canvas.remove(); } };
}
