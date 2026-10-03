import * as THREE from 'three';
import { spineSurface, releaseSurface, seededRandom, textSeed, withStops, paintCloth, paintWeave, spineLayout, drawDevice, lattice } from './spine-surface.js';
import { METAL_COLORS, SURFACE_FINISHES, spineFinish, surfaceFinish } from './book-colors.js';
import { normalizeBookAuthor } from './book-title.js';
import { bookmarkFor } from './bookshelf-layout.js';
import { applyBookReflectionSurface } from './book-reflection-surface.js';
import { keepProgramsAlive } from './gpu-programs.js';
import { buildReliefMaps, composeMaterialMap, normalizeCoverRelief } from './cover-relief.js';
import { runInSlices } from './cover-appearance.js';

// Procedural micro-detail shared by every book: generated once, uploaded once.
// Models receive clones (same Source, own repeat); three.js keeps the GPU
// texture until the last clone is disposed, so every model owns its copy.
const sharedSources = new Map();
function sharedTexture(key, build) {
  if (!sharedSources.has(key)) sharedSources.set(key, build());
  // Texture.copy() flags the shared Source dirty; keep its version so a new
  // clone reuses the pixels already on the GPU instead of uploading again.
  const base = sharedSources.get(key), version = base.source.version, copy = base.clone();
  copy.source.version = version;
  return copy;
}
function tileNormals(size, heightAt, strength) {
  const field = new Float32Array(size * size), data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) field[y * size + x] = heightAt(x, y);
  const at = (x, y) => field[(y + size) % size * size + (x + size) % size];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const nx = (at(x - 1, y) - at(x + 1, y)) * strength, ny = (at(x, y - 1) - at(x, y + 1)) * strength;
    const length = Math.hypot(nx, ny, 1), i = (y * size + x) * 4;
    data[i] = (nx / length + 1) * 127.5; data[i + 1] = (ny / length + 1) * 127.5;
    data[i + 2] = (1 / length + 1) * 127.5; data[i + 3] = 255;
  }
  const texture = new THREE.DataTexture(data, size, size);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter; texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true; texture.needsUpdate = true;
  return texture;
}
// Plain-weave book cloth: 16 × 16 threads per tile, with uneven slubs.
const clothNormals = () => tileNormals(128, (x, y) => {
  const i = x >> 3, j = y >> 3, fx = (x % 8 + .5) / 8, fy = (y % 8 + .5) / 8;
  const warp = Math.sin(Math.PI * fx) * (.7 + .6 * lattice(i, y >> 5, 1));
  const weft = Math.sin(Math.PI * fy) * (.7 + .6 * lattice(j, x >> 5, 2));
  return (i + j) % 2 ? warp * .85 + weft * .2 : weft * .85 + warp * .2;
}, 1.1);
// Printed paper over board: the soft tooth that survives under a laminate.
const paperNormals = () => tileNormals(128, (x, y) => {
  const octave = (cell, salt) => {
    const n = 128 / cell, gx = x / cell, gy = y / cell, i = Math.floor(gx), j = Math.floor(gy);
    const sx = (gx - i) ** 2 * (3 - 2 * (gx - i)), sy = (gy - j) ** 2 * (3 - 2 * (gy - j));
    const v = (a, b) => lattice((i + a) % n, (j + b) % n, salt);
    return THREE.MathUtils.lerp(THREE.MathUtils.lerp(v(0, 0), v(1, 0), sx), THREE.MathUtils.lerp(v(0, 1), v(1, 1), sx), sy);
  };
  return octave(32, 5) * .9 + octave(8, 6) * .45 + lattice(x, y, 7) * .08;
}, 1.4);
// Swallowtail cut, measured in ribbon widths from the tip (v = 0 at the tip):
// a shallow V, a fifth of the width deep, as scissors leave it.
const ribbonNotch = () => {
  const w = 16, h = 64, data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const across = Math.abs((x + .5) / w * 2 - 1), i = (y * w + x) * 4;
    data.fill((y + .5) / h > .2 * (1 - across) ? 255 : 0, i, i + 4);
  }
  const texture = new THREE.DataTexture(data, w, h);
  texture.magFilter = texture.minFilter = THREE.LinearFilter; texture.needsUpdate = true;
  return texture;
};

// Page edges: individual leaves, darker signature folds, a slight cockle and
// a silk headband. u runs across the leaves (tiled by physical thickness);
// v .02–.46 is the fore-edge, .54–.98 head and tail (spine side at .98).
function pageEdgeAtlas(size) {
  const canvas = Object.assign(document.createElement('canvas'), { width:size, height:size });
  const c = canvas.getContext('2d'), random = seededRandom(size * 131 + 7), unit = size / 256;
  c.fillStyle = '#ffffff'; c.fillRect(0, 0, size, size);
  const leaf = (x, style, weight) => {
    const phase = random() * Math.PI * 2, amplitude = (.25 + random() * .55) * unit;
    c.strokeStyle = style; c.lineWidth = weight;
    for (const offset of [0, -size]) {
      c.beginPath();
      for (let y = 0; y <= size; y += 8 * unit) {
        const px = x + offset + Math.sin(y / size * Math.PI * 5 + phase) * amplitude;
        if (y) c.lineTo(px, y); else c.moveTo(px, y);
      }
      c.stroke();
    }
  };
  for (let x = 0; x < size; x += (1.1 + random() * 1.5) * unit) {
    const tone = random();
    leaf(x, tone > .74 ? `rgba(108,108,108,${.08 + random() * .12})`
      : tone > .32 ? `rgba(255,255,255,${.22 + random() * .34})` : `rgba(150,150,150,${.05 + random() * .08})`,
    (.45 + random() * .6) * unit);
  }
  for (let x = random() * 18 * unit; x < size; x += (20 + random() * 18) * unit) {
    leaf(x, `rgba(88,88,88,${.16 + random() * .14})`, 1.15 * unit);
  }
  // Head/tail: the gutter falls into shadow where the leaves bend into the spine.
  c.fillStyle = withStops(c.createLinearGradient(0, size * .02, 0, size * .2),
    [[0, 'rgba(64,64,64,.34)'], [.45, 'rgba(64,64,64,.1)'], [1, 'rgba(64,64,64,0)']]);
  c.fillRect(0, 0, size, size * .2);
  // Dust settles on both ends of the fore-edge first.
  for (const [from, to] of [[size * .54, size * .6], [size * .98, size * .92]]) {
    c.fillStyle = withStops(c.createLinearGradient(0, from, 0, to), [[0, 'rgba(100,100,100,.16)'], [1, 'rgba(100,100,100,0)']]);
    c.fillRect(0, Math.min(from, to), size, Math.abs(to - from));
  }
  c.fillStyle = '#ffffff'; c.fillRect(0, size * .47, size, size * .06);
  // Headband: two-tone silk wound over a cord, rounded by its own shading.
  const band = size * .016, stripe = 4 * unit;
  for (let x = 0, i = 0; x < size; x += stripe, i++) {
    c.fillStyle = i % 2 ? '#f6f6f6' : '#7b1f28';
    c.beginPath(); c.moveTo(x, 0); c.lineTo(x + stripe, 0); c.lineTo(x + stripe * 1.6, size * .02 + band);
    c.lineTo(x + stripe * .6, size * .02 + band); c.closePath(); c.fill();
  }
  c.fillStyle = withStops(c.createLinearGradient(0, size * .02, 0, size * .02 + band),
    [[0, 'rgba(0,0,0,.35)'], [.45, 'rgba(255,255,255,.12)'], [1, 'rgba(0,0,0,.45)']]);
  c.fillRect(0, size * .02, size, band);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace; texture.wrapS = THREE.RepeatWrapping;
  return texture;
}

// Endpaper: a white wove stock with a faint speckle and a few long fibres.
// White-based so the material colour tints it; every stroke wraps the tile.
function endpaperTexture() {
  const size = 256, canvas = Object.assign(document.createElement('canvas'), { width:size, height:size });
  const c = canvas.getContext('2d'), random = seededRandom(90127);
  c.fillStyle = '#fff'; c.fillRect(0, 0, size, size);
  for (let i = 0; i < 2400; i++) {
    c.fillStyle = random() > .55 ? `rgba(86,86,86,${.035 + random() * .05})` : `rgba(255,255,255,${.3 + random() * .4})`;
    c.fillRect(Math.floor(random() * size), Math.floor(random() * size), 1, 1);
  }
  c.lineCap = 'round';
  for (let i = 0; i < 70; i++) {
    const x = random() * size, y = random() * size, a = random() * Math.PI, length = 6 + random() * 22;
    const bend = (random() - .5) * length * .5, dx = Math.cos(a) * length, dy = Math.sin(a) * length;
    c.strokeStyle = `rgba(112,112,112,${.05 + random() * .07})`; c.lineWidth = .5 + random() * .5;
    for (const ox of [-size, 0, size]) for (const oy of [-size, 0, size]) {
      c.beginPath(); c.moveTo(x + ox, y + oy);
      c.quadraticCurveTo(x + ox + dx / 2 - dy / length * bend, y + oy + dy / 2 + dx / length * bend, x + ox + dx, y + oy + dy);
      c.stroke();
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace; texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

/** Text block of a rounded-and-backed binding: its back follows the round
 * inside the case, the fore-edge is concave, both ends are one crescent. */
export function pageBlockGeometry(width, height, thickness, { board = height * .007, inset = height * .009, detail = false } = {}) {
  const half = (thickness - board * 2.4) / 2, top = height / 2 - inset;
  const rim = board * 1.1, back = Math.max(0, thickness * .38 - rim - board * .15), zBack = thickness / 2 - rim;
  const bend = Math.min(thickness * .09, width * .025), fore = width / 2 - inset * .7;
  const columns = detail ? 16 : 8, rows = detail ? 6 : 3, tile = height * .2;
  const spineX = z => -width / 2 - back * Math.sqrt(Math.max(0, 1 - (z / zBack) ** 2));
  const foreX = z => fore - bend * (1 - (z / half) ** 2);
  const positions = [], normals = [], uvs = [], colors = [], indices = [];
  const vertex = (x, y, z, n, u, v, shade) => {
    positions.push(x, y, z); normals.push(...n); uvs.push(u, v); colors.push(shade, shade, shade);
    return positions.length / 3 - 1;
  };
  const quad = (a, b, c, d) => indices.push(a, b, d, b, c, d);
  const across = i => -half + i / columns * half * 2, leafU = z => (z + half) / tile;
  // Leaves pressed against the boards sit in their shadow.
  const pressed = z => 1 - .18 * Math.abs(z / half) ** 6;
  for (const side of [1, -1]) {
    const start = positions.length / 3;
    for (let i = 0; i <= columns; i++) for (let k = 0; k <= rows; k++) {
      const z = across(i), t = (k / rows) ** 1.7;
      vertex(THREE.MathUtils.lerp(spineX(z), foreX(z), t), side * top, z, [0, side, 0], leafU(z), .98 - .44 * t,
        pressed(z) * (.82 + .18 * Math.min(1, t * 5)));
    }
    for (let i = 0; i < columns; i++) for (let k = 0; k < rows; k++) {
      const a = start + i * (rows + 1) + k, b = a + rows + 1;
      if (side > 0) quad(a, b, b + 1, a + 1); else quad(a, a + 1, b + 1, b);
    }
  }
  const start = positions.length / 3;
  for (let i = 0; i <= columns; i++) {
    const z = across(i), slope = 2 * bend * z / half ** 2, length = Math.hypot(1, slope);
    for (const y of [-top, top]) vertex(foreX(z), y, z, [1 / length, 0, -slope / length], leafU(z), .24 + .22 * y / top, pressed(z));
  }
  for (let i = 0; i < columns; i++) { const a = start + i * 2; quad(a, a + 1, a + 3, a + 2); }
  // Thin skins under the boards close the block when the cover opens.
  for (const side of [1, -1]) {
    const z = side * half, x0 = spineX(z), x1 = foreX(z), n = [0, 0, side];
    const p = [[x0, -top], [x1, -top], [x1, top], [x0, top]].map(([x, y]) => vertex(x, y, z, n, .5, .5, 1));
    if (side > 0) quad(...p); else quad(p[0], p[3], p[2], p[1]);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices); geometry.addGroup(0, indices.length, 0);
  return geometry;
}

/** Leaves already read turn over with the front board as one gathering: a
 * block on the board's inner face whose top leaf curls down into the gutter.
 * Hinge coordinates (joint at x = 0, board centred on z = 0); the open face
 * looks toward -z until the board turns over. Only lifted copies build it. */
export function leafStackGeometry(width, height, depth, { board = height * .007, inset = height * .009, columns = 14 } = {}) {
  // A hair inside the text block, so closed its ends never fight the head,
  // tail or fore-edge they came from.
  const top = height / 2 - inset - height * .0012, fore = width - inset * .7 - height * .0015;
  const base = -board / 2 - height * .0003, tile = height * .2;
  const gutter = Math.min(fore * .2, height * .075), dip = .16;
  // Share of the gathering's depth at x: the leaves bend down into the joint.
  const rise = x => { const t = Math.min(1, x / gutter); return dip + (1 - dip) * t * (2 - t); };
  const riseSlope = x => x < gutter ? (1 - dip) * (2 - 2 * x / gutter) / gutter : 0;
  const positions = [], normals = [], uvs = [], colors = [], indices = [];
  const vertex = (x, y, z, n, u, v, shade) => {
    positions.push(x, y, z); normals.push(...n); uvs.push(u, v); colors.push(shade, shade, shade);
    return positions.length / 3 - 1;
  };
  // Columns crowd toward the gutter, where the leaves curl.
  const xs = Array.from({ length:columns + 1 }, (_, i) => fore * (i / columns) ** 1.7);
  const faceZ = x => base - depth * rise(x);
  // Open face: the joint's shadow, then clean paper.
  const shade = x => 1 - .34 * Math.max(0, 1 - x / (gutter * 1.7)) ** 2;
  for (const x of xs) {
    const slope = -depth * riseSlope(x), length = Math.hypot(slope, 1);
    for (const y of [-top, top]) vertex(x, y, faceZ(x), [slope / length, 0, -1 / length], x / fore, y / top / 2 + .5, shade(x));
  }
  for (let i = 0; i < columns; i++) { const a = i * 2; indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  const edge = positions.length / 3;
  // Fore-edge: u runs across the leaves exactly as on the text block.
  for (const y of [-top, top]) for (const k of [0, 1]) {
    vertex(fore, y, k ? faceZ(fore) : base, [1, 0, 0], k * depth * rise(fore) / tile, .24 + .22 * y / top, .94);
  }
  indices.push(edge, edge + 1, edge + 3, edge, edge + 3, edge + 2);
  // Head and tail: every leaf converges into the gutter.
  for (const side of [1, -1]) {
    const start = positions.length / 3;
    for (const x of xs) for (const k of [0, 1]) {
      vertex(x, side * top, k ? faceZ(x) : base, [0, side, 0], k * depth * rise(x) / tile, .98 - .44 * x / fore, .9 * shade(x));
    }
    for (let i = 0; i < columns; i++) {
      const a = start + i * 2, b = a + 1, c = a + 3, d = a + 2;
      if (side > 0) indices.push(a, d, c, a, c, b); else indices.push(a, c, d, a, b, c);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  const faceCount = columns * 6;
  geometry.addGroup(0, faceCount, 0); geometry.addGroup(faceCount, indices.length - faceCount, 1);
  return geometry;
}

/** Half-ellipse end of the case. Close-up copies leave the hollow open so the
 * headband is visible inside a thin rim of cloth and board. */
function capGeometry(width, thickness, segments, rim = 0) {
  const shape = new THREE.Shape(), bulge = thickness * .38;
  shape.moveTo(-width / 2, -thickness / 2);
  for (let i = 1; i <= segments; i++) {
    const a = i / segments * Math.PI;
    shape.lineTo(-width / 2 - bulge * Math.sin(a), -thickness / 2 * Math.cos(a));
  }
  if (rim) for (let i = segments; i >= 0; i--) {
    const a = i / segments * Math.PI;
    shape.lineTo(-width / 2 - (bulge - rim) * Math.sin(a), -(thickness / 2 - rim) * Math.cos(a));
  }
  shape.closePath();
  return new THREE.ShapeGeometry(shape);
}

// Paper edges are fibrous: even "brillante" is a burnished edge, not lacquer.
function applyPaperFinish(material, value) {
  applySurfaceFinish(material, value, 'satin');
  material.roughness = .35 + material.roughness * .6;
  material.clearcoat *= .3;
  material.specularIntensity = .7;
}

function applySurfaceFinish(material, value, fallback = 'satin') {
  const finish = SURFACE_FINISHES[surfaceFinish(value, fallback)];
  material.roughness = finish.roughness;
  material.clearcoat = finish.clearcoat;
  material.clearcoatRoughness = finish.clearcoatRoughness;
  material.envMapIntensity = finish.envMapIntensity;
  material.needsUpdate = true;
}

// Seen almost edge-on (the lifted book's front view), spine lettering shrinks
// into bright slivers along the rolled edge. Only while the spine as a whole
// faces away, the surface that turns from the viewer shows plain cloth; the
// rules near the joint, which still face the viewer, keep their ink.
function spineGrazingFade(material) {
  const uniforms = { spineCloth:{ value:new THREE.Color() }, spineClothMetal:{ value:0 }, spineClothRough:{ value:.88 } };
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader.replace('void main() {', 'varying float vSpineFacing;\nvoid main() {')
      .replace('#include <project_vertex>',
        '#include <project_vertex>\n\tvSpineFacing = abs(normalize((modelViewMatrix * vec4(-1., 0., 0., 0.)).xyz).z);');
    shader.fragmentShader = shader.fragmentShader.replace('void main() {',
      'varying float vSpineFacing;\nuniform vec3 spineCloth;\nuniform float spineClothMetal, spineClothRough;\nvoid main() {')
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
	float spineEdge = .62 * (1. - smoothstep(.35, .6, vSpineFacing));
	float spineKeep = smoothstep(spineEdge - .16, spineEdge,
		abs(dot(nonPerturbedNormal, isOrthographic ? vec3(0., 0., 1.) : normalize(vViewPosition))));
	diffuseColor.rgb = mix(spineCloth, diffuseColor.rgb, spineKeep);
	metalnessFactor = mix(spineClothMetal, metalnessFactor, spineKeep);
	roughnessFactor = mix(spineClothRough, roughnessFactor, spineKeep);
	normal = normalize(mix(nonPerturbedNormal, normal, spineKeep));`);
  };
  material.customProgramCacheKey = () => 'spine-grazing-fade';
  return (book, style) => {
    const finish = spineFinish(book.spineFinish);
    uniforms.spineCloth.value.set(finish === 'matte' ? style.color : METAL_COLORS[finish]);
    uniforms.spineClothMetal.value = finish === 'matte' ? 0 : 1;
    uniforms.spineClothRough.value = SURFACE_FINISHES[surfaceFinish(book.spineSurfaceFinish, 'matte')].roughness;
  };
}

function applyCoverFinish(material, value) {
  applySurfaceFinish(material, value, 'satin');
  // Dielectric reflection belongs to the laminate, above the printed image.
  // Suppressing it uniformly erased both the glossy/satin distinction and
  // warm lamp highlights. The physical clearcoat keeps highlights local and
  // leaves the artwork's diffuse colour and texture untouched.
  material.specularIntensity = 1;
}

// A cover that can carry relief keeps a clearcoat program from the start: a
// laminate-free (matte) board is given a clearcoat too thin to see, so raising
// varnish later only changes uniforms and texture contents, never the shader.
const COVER_CLEARCOAT_FLOOR = .001;

/** Relief reaches the shader through the clearcoat normal map. The same
 * tangent-space normal also bends the base layer's normal, so the raised
 * zones read under a matte, satin or glossy laminate alike. Neutral
 * placeholder maps leave every pixel unchanged. */
function installCoverRelief(material) {
  const previousHook = material.onBeforeCompile, previousKey = material.customProgramCacheKey();
  material.onBeforeCompile = function(shader, renderer) {
    previousHook.call(this, shader, renderer);
    shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
	#ifdef USE_CLEARCOAT_NORMALMAP
		vec3 reliefN = texture2D( clearcoatNormalMap, vClearcoatNormalMapUv ).xyz * 2.0 - 1.0;
		reliefN.xy *= clearcoatNormalScale;
		normal = normalize( normal + tbn2 * reliefN - tbn2[ 2 ] );
	#endif`);
  };
  material.customProgramCacheKey = () => `${previousKey}|cover-relief-v1`;
}

function neutralTexture(r, g, b) {
  const texture = new THREE.DataTexture(new Uint8Array([r, g, b, 255]), 1, 1);
  texture.needsUpdate = true;
  return texture;
}

function applySpineCapFinish(material, book) {
  const metallic = ['gold', 'silver'].includes(book.spineFinish);
  material.metalness = metallic ? 1 : 0;
  if (metallic) {
    // Keep the foil's existing response; its base layer already reflects the
    // lamp, so a second full laminate would over-brighten the metal.
    material.roughness = .3; material.envMapIntensity = 1.8;
    material.clearcoat = .42; material.clearcoatRoughness = .16;
    material.needsUpdate = true;
  } else applySurfaceFinish(material, book.spineSurfaceFinish, 'matte');
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
  // A visibly rounded, slightly softened board edge, as covered board has.
  const bevel = Math.min(depth * .4, height * .0035);
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
  { open = 0, withdraw = 0, segments = 32, seed = 0 } = {}) {
  // Peek values belong to the 200 px shelf book, not the much larger lifted
  // copy. Keep the ribbon's physical proportions identical in both models.
  const ribbonWidth = Math.min(width * .09, Math.max(height * .035, Math.min(height * .055, thickness * .42)));
  // Each copy of a book falls the same way; different books do not.
  const vary = k => seed ? lattice(seed % 65521, k, 17) : .5;
  const visibleLength = height * Math.max(.09, Math.min(.17, (Number(peek) || 10) / 200 * 1.6))
    * (1 + (seed ? .12 * vary(1) : 0));
  const opening = Math.max(0, Math.min(1, open)), { lerp, smoothstep, clamp } = THREE.MathUtils;
  // Always between two leaves, never on a board: an unread book keeps its
  // ribbon under the first leaf instead of lying across the front cover.
  const leaves = Math.max(0, thickness / 2 - height * .0125);
  const insideDepth = clamp(thickness / 2 - thickness * Math.max(0, Math.min(1, progress)), -leaves, leaves);
  const pageDepth = thickness / 2 - height * .0083 + height * .002;
  // The leaves above the saved page lift with the board, so the ribbon is on
  // the exposed page early in the opening instead of surfacing through it.
  const depth = lerp(insideDepth, pageDepth, smoothstep(opening, 0, .3));
  // Lying down (position, roll) settles while the board still covers most of
  // the page; the end beyond the head folds over it a little later.
  const lay = smoothstep(opening, .05, .55), flop = smoothstep(opening, .15, .85);
  // Closed it rises clear of the spine; open it lies beside the gutter, in
  // the inner margin, instead of across the first words of every line.
  const x = lerp(-width / 2 + Math.max(thickness * .75, ribbonWidth * 1.5),
    -width / 2 + height * .012 + ribbonWidth * .5 + width * .006, lay);
  // Withdrawing slides the silk along its own path: up the page and over the
  // head, never straight up through the air above the book.
  const lift = height * 1.25 * Math.max(0, Math.min(1, withdraw));
  const positions = [], uvs = [], indices = [];
  const pageTop = height / 2 - height * .009, bend = height * .016;
  // The fold starts right at the edge of the leaf, so it never curls into it.
  const head = lerp(height / 2 - height * .012, pageTop - bend * .3, lay);
  const tail = lerp(height / 2 - height * .64, -height / 2 + height * .03, lay);
  const upper = visibleLength + height * .012;
  // Closed: the limp satin leans back over the head (toward the fore-edge)
  // and drifts a little aside, evenly along its length, never as a hook.
  const back = visibleLength * (.1 + .16 * vary(2)), drift = visibleLength * (vary(3) - .5) * .36;
  // Open: past the head it rolls over the edge of the text block (a quarter
  // turn of radius `bend`) and runs back along the head, out of sight.
  const arc = bend * Math.PI / 2, reachBack = pageDepth - bend - (-thickness / 2 + height * .0084);
  const steps = Math.max(4, Math.round((Number(segments) || 32) / 2) * 2), fabricDepth = height * .0018;
  // Closed, the ribbon turns toward someone looking at the binding, so from
  // the spine it shows its face; from the front it still shows a third of
  // it, never a bare thread. The turn is complete inside the text block,
  // just under its head: seen from above (the flyout looks slightly down on
  // the head) it leaves the leaves as one even strip, with no flared foot.
  const twistMax = Math.PI / 2 * (.74 + .08 * vary(4));
  const turn = s => smoothstep(s, -height * .006, height * .0025);
  // Turning about its middle would push the edge through a board at the very
  // first or last leaf: the ribbon moves inward by exactly what it gains.
  const reach = Math.sin(twistMax) * ribbonWidth / 2;
  const inward = (clamp(depth, -leaves + reach, leaves - reach) - depth) * (1 - lay);
  const bodyLength = head - tail, wander = ribbonWidth * (.12 + .1 * vary(6)), splay = ribbonWidth * .3 * vary(7);
  // `s` is the arc length past the head, negative inside the book or on the
  // page. Samples are laid on the path, not on the sliding silk: half on the
  // page, the rest from the head on, a fixed share of them crowded over the
  // turn and the fold, so no chord ever cuts under the paper while it slides.
  const start = lift - bodyLength, cut = upper + lift, split = Math.min(cut, Math.max(start, 0));
  const half = steps / 2, fold = Math.max(1, Math.round(steps * .19)), folded = Math.min(cut, split + arc * 1.1);
  const along = i => i <= half ? lerp(start, split, i / half)
    : i - half <= fold ? split + (folded - split) * ((i - half) / fold) ** 1.4
    : lerp(folded, cut, (i - half - fold) / (half - fold));
  const centre = [], twists = [], onPage = [], tucks = [];
  for (let i = 0; i <= steps; i++) {
    const s = along(i), point = new THREE.Vector3(x, head, depth), turned = twistMax * turn(s);
    // A sideways shift, kept out of the direction the cross-sections face.
    tucks.push(inward * Math.sin(turned) / (Math.sin(twistMax) || 1));
    let twist = turned * (1 - lay);
    if (s <= 0) {
      // On an open page it runs the full leaf and never lies ruler-straight.
      // The wander belongs to the page, so a sliding ribbon meets the head
      // edge exactly where it rests.
      const u = -s / bodyLength;
      point.x += lay * (wander * Math.sin(Math.PI * 1.3 * u) + splay * u * u);
      point.y += s;
      point.z += lay * height * .0012 * (1 - Math.cos(u * Math.PI * 4)) / 2;
      // Satin never lies dead flat: a slow roll turns the sheen on and off.
      twist += lay * .22 * Math.sin(u * Math.PI * 2.6 + vary(5) * 6) * (1 - (1 - u) ** 3);
    } else {
      const k = flop * Math.PI / 2 / arc, bent = Math.min(s, arc);
      // Past the gathering's depth the rest is tucked under, out of sight.
      const run = Math.min(s - bent, reachBack + (1 - flop) * height * 4);
      // A cantilever's sag: nothing at the root, most of it toward the end.
      const angle = k * bent, fall = smoothstep(Math.min(1, s / upper), 0, 1) * (1 - flop);
      point.x += back * fall;
      point.y += (k > 1e-6 ? Math.sin(angle) / k : bent) + run * Math.cos(angle);
      point.z += (k > 1e-6 ? (Math.cos(angle) - 1) / k : 0) - run * Math.sin(angle) + drift * fall;
    }
    centre.push(point); twists.push(twist); onPage.push(s <= 0);
  }
  // v measures ribbon widths back from the cut tip, where the swallowtail is.
  const fromTip = [0];
  for (let i = steps; i > 0; i--) fromTip.unshift(fromTip[0] + centre[i].distanceTo(centre[i - 1]));
  // One strip: every cross-section is square to the ribbon's own direction,
  // so the fold over the head keeps the full width and fabric thickness.
  const tangent = new THREE.Vector3(), across = new THREE.Vector3(), face = new THREE.Vector3();
  const side = new THREE.Vector3(), normal = new THREE.Vector3(), X = new THREE.Vector3(1, 0, 0);
  for (let i = 0; i <= steps; i++) {
    const point = centre[i], v = fromTip[i] / ribbonWidth, twist = twists[i];
    tangent.subVectors(centre[Math.min(steps, i + 1)], centre[Math.max(0, i - 1)]);
    if (tangent.lengthSq() < 1e-12) tangent.set(0, 0, -1); else tangent.normalize();
    across.copy(X).addScaledVector(tangent, -tangent.x).normalize();
    face.crossVectors(across, tangent);
    side.copy(across).multiplyScalar(Math.cos(twist)).addScaledVector(face, Math.sin(twist)).multiplyScalar(ribbonWidth / 2);
    normal.copy(across).multiplyScalar(-Math.sin(twist)).addScaledVector(face, Math.cos(twist)).multiplyScalar(fabricDepth / 2);
    // On the page it is raised by its own roll, so neither edge ever sinks
    // into the paper; between closed leaves it is only tucked clear of the boards.
    const z = point.z + tucks[i] + (onPage[i] ? lay * Math.abs(side.z) : 0);
    positions.push(point.x - side.x + normal.x, point.y - side.y + normal.y, z - side.z + normal.z,
      point.x + side.x + normal.x, point.y + side.y + normal.y, z + side.z + normal.z,
      point.x - side.x - normal.x, point.y - side.y - normal.y, z - side.z - normal.z,
      point.x + side.x - normal.x, point.y + side.y - normal.y, z + side.z - normal.z);
    uvs.push(0, v, 1, v, 0, v, 1, v);
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

// Woven satin: a soft sheen that slides along the ribbon, not a lacquered
// strip. The swallowtail tip is cut by an alpha mask, not by geometry.
// Binders stock a handful of classic silk dyes. Each book draws one that
// stands clear of its own cloth (claret most often), so a row of ribbons reads
// as a collection rather than a row of identical red markers. Finished books
// keep the old-gold silk; shelf copies are a shade quieter.
// All dark enough to read on the paper of an open page.
const RIBBON_SILKS = ['#7c1c26', '#7c1c26', '#7c1c26', '#1d4030', '#22305a', '#4c2244', '#823a1f', '#a8322b'];
export function ribbonSilk(seed, cloth, finished = false) {
  if (finished) return '#c29a4c';
  const hex = new THREE.Color(cloth ?? '#555').getHex(), rgb = [hex >> 16, hex >> 8 & 255, hex & 255];
  // Weighted sRGB distance: green differences read strongest, then blue.
  const apart = silk => {
    const s = parseInt(silk.slice(1), 16), d = [s >> 16, s >> 8 & 255, s & 255].map((v, i) => (v - rgb[i]) / 255);
    return Math.sqrt(2 * d[0] ** 2 + 4 * d[1] ** 2 + 3 * d[2] ** 2);
  };
  const clear = RIBBON_SILKS.filter(silk => apart(silk) > .55);
  // A cloth close to every dye still gets the one that differs most.
  if (!clear.length) return RIBBON_SILKS.reduce((best, silk) => apart(silk) > apart(best) ? silk : best);
  return clear[Math.floor(lattice(seed % 65521, 9, 23) * clear.length)];
}
// Satin's sheen is a brighter shade of its own dye, not a white veil: seen
// edge-on a dark silk must not fade into a grey or pastel strip.
function tintRibbon(material, silk, shelf) {
  material.color.set(silk).multiplyScalar(shelf ? .88 : 1);
  material.sheenColor.set(silk).multiplyScalar(2.2).lerp(new THREE.Color('#fff6ea'), .1);
}
function satinRibbon(finished, silk, shelf = false) {
  // On the shelf the ribbon is a few pixels wide: the sliding anisotropic
  // sheen cannot show there, so shelf copies skip both shading terms.
  const material = new THREE.MeshPhysicalMaterial({
    roughness:shelf ? .42 : .46, metalness:finished ? .16 : 0,
    sheen:shelf ? 0 : .7, sheenRoughness:.38,
    anisotropy:shelf ? 0 : .55, specularIntensity:.5,
    alphaMap:sharedTexture('ribbon-notch', ribbonNotch), alphaTest:.5,
    side:THREE.DoubleSide
  });
  tintRibbon(material, silk, shelf);
  return material;
}

// The paper the reader shows: the median of the snapshot's outer ring, so the
// leaves already read and the margin around the saved page are one stock.
const paperTones = new WeakMap();
function paperTone(source) {
  if (paperTones.has(source)) return paperTones.get(source);
  let tone = null;
  try {
    const n = 12, canvas = Object.assign(document.createElement('canvas'), { width:n, height:n });
    const c = canvas.getContext('2d', { willReadFrequently:true });
    c.drawImage(source, 0, 0, n, n);
    const data = c.getImageData(0, 0, n, n).data, ring = [];
    for (let i = 0; i < n - 1; i++) for (const [x, y] of [[i, 0], [n - 1, i], [n - 1 - i, n - 1], [0, n - 1 - i]]) {
      const k = (y * n + x) * 4;
      if (data[k + 3] > 200) ring.push(k);
    }
    const channels = [0, 1, 2].map(o => ring.map(k => data[k + o]).sort((a, b) => a - b));
    const quartile = (values, q) => values[Math.floor((values.length - 1) * q)];
    // Only a margin is paper: a full-bleed photo or comic page keeps the default.
    if (ring.length >= 16 && channels.every(values => quartile(values, .75) - quartile(values, .25) <= 20)) {
      const [r, g, b] = channels.map(values => quartile(values, .5) / 255);
      tone = new THREE.Color().setRGB(r, g, b, THREE.SRGBColorSpace);
    }
  } catch { /* a tainted or unreadable source keeps the default paper */ }
  paperTones.set(source, tone);
  return tone;
}
// The saved page is unlit; under lightBookScene the fully turned leaf shows
// about 1.03/.96/.895 of its albedo (the warm key). Compensate so both pages
// read as the same sheet, the left one a shade quieter.
const LEAF_LIGHT = new THREE.Color(.96 / 1.03, .96 / .96, .96 / .895);

/**
 * Cross-fade between the white stock and the reader's own paper, mixed in
 * sRGB exactly as the two page textures are blended on screen, so the paper
 * under and beside the page fades in step with it. A side that has no paper
 * (a full-bleed picture) yields to the other; with neither, null.
 */
const toneScratch = { a:{}, b:{} };
export function mixPaperTone(target, stock, theme, mix) {
  const k = Math.max(0, Math.min(1, Number(mix)));
  if (!stock && !theme) return null;
  if (!stock) return target.copy(theme);
  if (!theme) return target.copy(stock);
  if (!(k > 0)) return target.copy(stock);
  if (!(k < 1)) return target.copy(theme);
  const a = stock.getRGB(toneScratch.a, THREE.SRGBColorSpace), b = theme.getRGB(toneScratch.b, THREE.SRGBColorSpace);
  return target.setRGB(a.r + (b.r - a.r) * k, a.g + (b.g - a.g) * k, a.b + (b.b - a.b) * k, THREE.SRGBColorSpace);
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

// Joint groove distance from the spine edge, as a fraction of board height.
const HINGE_GROOVE = .026;
const coverSeed = (book, style, salt) => seededRandom(textSeed(`${book?.id ?? ''}|${book?.title ?? ''}|${style?.color}|${salt}`));

// Wear that belongs to the board rather than the artwork, drawn in design
// units (1024 = board height) over printed and cloth covers alike.
function finishBoard(c, designWidth, random, { wear = true } = {}) {
  const hinge = HINGE_GROOVE * 1024, edge = 14;
  c.globalAlpha = 1;
  // The strip beside the spine flexes at every opening and dulls first.
  c.fillStyle = 'rgba(0,0,0,.05)'; c.fillRect(0, 0, hinge - 9, 1024);
  // Pressed joint groove: shadowed spine-side wall, lit far wall.
  c.fillStyle = withStops(c.createLinearGradient(hinge - 11, 0, hinge + 11, 0), [[0, 'rgba(0,0,0,0)'],
    [.3, 'rgba(0,0,0,.26)'], [.5, 'rgba(0,0,0,.12)'], [.7, 'rgba(255,248,236,.11)'], [1, 'rgba(255,248,236,0)']]);
  c.fillRect(hinge - 11, 0, 22, 1024);
  // The covering turns over the board edges here.
  for (const [x0, y0, x1, y1] of [[0, 0, 0, edge], [0, 1024, 0, 1024 - edge], [designWidth, 0, designWidth - edge, 0]]) {
    c.fillStyle = withStops(c.createLinearGradient(x0, y0, x1, y1), [[0, 'rgba(0,0,0,.16)'], [1, 'rgba(0,0,0,0)']]);
    if (x0 === x1) c.fillRect(0, Math.min(y0, y1), designWidth, edge); else c.fillRect(designWidth - edge, 0, edge, 1024);
  }
  // A thumbnail cannot show single fibres or rubbed corners.
  if (!wear) return;
  // Rubbed fibres: short paler runs along the edges that meet the shelf.
  c.fillStyle = '#fff6e6';
  for (const [length, vertical, at] of [[designWidth, false, 0], [designWidth, false, 1021.6], [1024, true, designWidth - 2.4]]) {
    for (let p = 0; p < length;) {
      const run = 6 + random() * 42;
      c.globalAlpha = random() < .45 ? random() * .24 : 0;
      if (vertical) c.fillRect(at, p, 2.4, run); else c.fillRect(p, at, run, 2.4);
      p += run;
    }
  }
  c.globalAlpha = 1;
  // Corners at the fore-edge take the knocks.
  for (const y of [0, 1024]) {
    c.fillStyle = withStops(c.createRadialGradient(designWidth, y, 0, designWidth, y, 30),
      [[0, 'rgba(255,244,226,.3)'], [1, 'rgba(255,244,226,0)']]);
    c.fillRect(designWidth - 30, y ? 994 : 0, 30, 30);
  }
}

function coverTexture(book, style, textureHeight = 2048, maxDimension = Infinity, level = 'detail') {
  const canvas = document.createElement('canvas');
  const designWidth = Math.round(1024 * (Number(style.coverRatio) || .66));
  const dimensions = coverRasterDimensions(designWidth / 1024, textureHeight, maxDimension);
  canvas.width = dimensions.width; canvas.height = dimensions.height;
  const c = canvas.getContext('2d'); c.scale(canvas.width / designWidth, canvas.height / 1024);
  const random = coverSeed(book, style, 'case'), thumb = level === 'overview';
  c.fillStyle = style.color; c.fillRect(0, 0, designWidth, 1024);
  // A cloth case: dyed mottling, then the weave itself. A 256 px thumbnail
  // shows neither, so it keeps the flat dyed colour and saves the work.
  if (!thumb) { paintCloth(c, designWidth, random); paintWeave(c, designWidth); }
  // Design in physical cover proportions so lettering is never stretched,
  // centred on the board beyond the joint as a real case is.
  const hinge = HINGE_GROOVE * 1024, center = (hinge + designWidth) / 2;
  const coverScale = designWidth / 676;
  const titleSize = Math.max(36, Math.min(82, 54 * coverScale));
  const titleWidth = Math.min(480 * coverScale, designWidth - hinge - 110);
  // Blind-stamped panel: pressed into the cloth, no ink.
  c.lineWidth = 2.4;
  c.strokeStyle = 'rgba(0,0,0,.26)'; c.strokeRect(hinge + 34, 42, designWidth - hinge - 76, 940);
  c.strokeStyle = 'rgba(255,248,236,.1)'; c.strokeRect(hinge + 36, 44, designWidth - hinge - 76, 940);
  const family = `"${style.fontCanvasFamily || style.fontFamily || 'Playfair Display'}", ${style.fontFallback || 'Georgia, serif'}`;
  c.fillStyle = c.strokeStyle = style.ink; c.textAlign = 'center'; c.textBaseline = 'middle';
  c.font = `${style.fontWeight || 700} ${titleSize}px ${family}`;
  const words = (book.title || 'Sin título').split(' '); let line = ''; const lines = [];
  for (const word of words) {
    if (c.measureText(line + word).width > titleWidth && line) { lines.push(line.trim()); line = ''; }
    line += word + ' ';
  }
  lines.push(line.trim());
  const visible = lines.slice(0, 6), spacing = titleSize * 1.2, top = 400 - (visible.length - 1) * spacing / 2;
  visible.forEach((text, i) => c.fillText(text + (i === 5 && lines.length > 6 ? '…' : ''), center, top + i * spacing, titleWidth));
  // A small fleuron rule, then the author in the text face's italic.
  const ornament = top + (visible.length - 1) * spacing + titleSize * .6 + 56;
  c.globalAlpha = .75; c.fillRect(center - 66, ornament - .75, 50, 1.5); c.fillRect(center + 16, ornament - .75, 50, 1.5);
  c.save(); c.translate(center, ornament); c.rotate(Math.PI / 4); c.fillRect(-4.5, -4.5, 9, 9); c.restore();
  const author = normalizeBookAuthor(book.author);
  if (author) {
    c.globalAlpha = .92; c.font = `italic 400 ${Math.round(Math.max(24, Math.min(40, 30 * coverScale)))}px ${family}`;
    c.fillText(author, center, ornament + 56, titleWidth);
  }
  // Publisher's device at the foot, blind-stamped like the panel: pressed in,
  // no ink, so it never reads as a printed arrow. The spine's own mark when
  // the case has one, otherwise one of the same family, per book.
  if (!thumb) {
    const layout = spineLayout(book), kind = layout.device ?? textSeed(`device|${book?.id ?? ''}|${book?.title ?? ''}`) % 3;
    c.save(); c.globalAlpha = 1; c.translate(center, 904);
    c.fillStyle = 'rgba(0,0,0,.24)'; drawDevice(c, kind, 24);
    c.translate(1.8, 1.8); c.fillStyle = 'rgba(255,248,236,.1)'; drawDevice(c, kind, 24);
    c.restore();
  }
  finishBoard(c, designWidth, random, { wear:!thumb });
  const map = new THREE.CanvasTexture(canvas); map.colorSpace = THREE.SRGBColorSpace;
  return map;
}

function shelfSpineSurface(book, style, height, thickness, shelf, overview, inspectionResolution = 0) {
  if (overview) return spineSurface(book, style, height, thickness,
    { textureWidth:64, textureHeight:256, engraving:false, level:'overview' });
  // Shelf copies are rastered at their final size, never shrunk from 2048.
  const lifted = inspectionResolution || liftedTextureHeight(height);
  if (inspectionResolution) return spineSurface(book, style, height, thickness, {textureWidth:512,textureHeight:inspectionResolution,level:'detail'});
  return shelf ? spineSurface(book, style, height, thickness, { textureWidth:256, textureHeight:1024, level:'shelf' })
    : spineSurface(book, style, height, thickness, { textureWidth:lifted / 2, textureHeight:lifted, level:'detail' });
}

// A lifted book is at most ~440 CSS px tall at pixel ratio ≤ 2, so 1024
// texels already exceed the screen. 2048 (four times the memory, painting and
// upload) only when a caller really draws it larger.
function liftedTextureHeight(height) {
  const ratio = Math.min(2, typeof devicePixelRatio === 'number' ? devicePixelRatio : 1);
  return height * ratio > 1100 ? 2048 : 1024;
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
  { shelf = false, overview = false, inspectionResolution = 0, eagerRelief = true } = {}) {
  const group = new THREE.Group();
  inspectionResolution = shelf && !overview ? (inspectionResolution >= 2048 ? 2048 : inspectionResolution >= 1024 ? 1024 : 0) : 0;
  group.userData.inspectionResolution = inspectionResolution;
  group.userData.overview = group.userData.isOverview = Boolean(overview);
  group.userData.detailLevel = overview ? 'overview' : shelf ? 'shelf' : 'detail';
  const textureHeight = inspectionResolution || (overview ? 256 : shelf ? 512 : liftedTextureHeight(height));
  const maxTextureDimension = overview ? 256 : Infinity;
  const bindingSegments = overview ? 16 : shelf ? 32 : 96, reliefRows = shelf ? 96 : 384;
  const ribbonSegments = overview ? 8 : 32, ribbonSeed = textSeed(`ribbon|${book?.id ?? ''}|${book?.title ?? ''}`) || 1;
  const detail = !shelf && !overview, level = group.userData.detailLevel, ratio = width / height;
  const surfaceSeed = String(book?.id ?? book?.path ?? book?.title ?? 'book');
  const cloth = new THREE.MeshStandardMaterial({ color: style.color, roughness: .86 });
  applyBookReflectionSurface(cloth, { seed:`${surfaceSeed}|back`, strength:.018 });
  let surface = shelfSpineSurface(book, style, height, thickness, shelf, overview, inspectionResolution);
  const binding = new THREE.MeshPhysicalMaterial({ ...surface.material, side: THREE.DoubleSide });
  const updateSpineFade = !shelf && !overview ? spineGrazingFade(binding) : null;
  updateSpineFade?.(book, style);
  applyBookReflectionSurface(binding, { seed:`${surfaceSeed}|binding`, strength:.014 });
  // Painted once, by updateCoverSource below (or as the placeholder while a
  // download is pending), never twice per book.
  const cover = new THREE.MeshPhysicalMaterial({ map:null });
  const reliefCapable = detail || Boolean(inspectionResolution);
  // The clearcoat + relief program is costly to shade. Views that only fly a
  // book (opening, closing) skip it unless the cover already has a relief; a
  // view that gets one later arms it then, once (setCoverRelief).
  let reliefArmed = reliefCapable && (eagerRelief || Boolean(book.coverRelief));
  const laminate = value => {
    applyCoverFinish(cover, value);
    if (reliefArmed && !cover.clearcoat) cover.clearcoat = COVER_CLEARCOAT_FLOOR;
  };
  const armRelief = () => {
    if (reliefArmed || !reliefCapable) return;
    reliefArmed = true;
    laminate(coverFinishValue);
    // Neutral 1x1 maps: clearcoat x1, roughness x1, metalness 0, flat normal.
    cover.clearcoatNormalMap = neutralTexture(128, 128, 255);
    cover.clearcoatMap = cover.clearcoatRoughnessMap = cover.roughnessMap = cover.metalnessMap = neutralTexture(255, 255, 0);
    cover.needsUpdate = true;
  };
  let coverFinishValue = book.coverFinish;
  laminate(book.coverFinish);
  // Keep the broad studio reflection from washing out printed ink at an
  // oblique angle. Diffuse colour and direct lamp highlights are unchanged.
  applyBookReflectionSurface(cover, { seed:`${surfaceSeed}|cover`, strength:.018, environmentReflection:.75 });
  installCoverRelief(cover);
  if (reliefArmed) {
    reliefArmed = false; armRelief();
  }
  // Close-up copies carry woven or paper tooth in the normal channel. On the
  // shelf it would not survive the mipmaps, so those copies skip the cost.
  // 224 threads per board height: below ~3 device pixels a thread the weave
  // aliases into a screen-door grid, so it fades to a quiet tooth instead.
  // Even at full resolution real bookcloth is a fine grain, never burlap.
  const threadPixels = height * Math.min(2, typeof devicePixelRatio === 'number' ? devicePixelRatio : 1) / 224;
  const weaveStrength = THREE.MathUtils.clamp((threadPixels - 1.4) / 2.2, .2, .45);
  if (detail || inspectionResolution) {
    cloth.normalMap = sharedTexture('cloth', clothNormals);
    cloth.normalMap.repeat.set(14 * ratio, 14); cloth.normalScale.setScalar(.5 * weaveStrength);
  }
  let coverGrain = null, coverSurfaceFinish = surfaceFinish(book.coverFinish);
  const updateCoverGrainStrength = () => {
    if (!cover.normalMap) return;
    // A laminate fills the paper/cloth tooth rather than polishing its dye.
    // Keep the same shared normal raster while changing only its strength.
    const strength = coverGrain === 'cloth' ? .55 * weaveStrength : .16;
    const tooth = { matte:1, satin:.5, glossy:.16 }[coverSurfaceFinish];
    cover.normalScale.setScalar(strength * tooth);
  };
  const setCoverGrain = kind => {
    if ((!detail && !inspectionResolution) || kind === coverGrain) return;
    coverGrain = kind; cover.normalMap?.dispose();
    cover.normalMap = sharedTexture(kind, kind === 'cloth' ? clothNormals : paperNormals);
    const tiles = kind === 'cloth' ? 14 : 5;
    cover.normalMap.repeat.set(tiles * ratio, tiles);
    updateCoverGrainStrength(); cover.needsUpdate = true;
  };
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
  // Inside of the board: the cloth turns in over its edges (this material)
  // and the endpaper is pasted down over the rest (the 'endpaper' mesh).
  const insideCover = new THREE.MeshStandardMaterial({ color:style.color, roughness:.9 });
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
  // Pastedown: wove endpaper inside the cloth turn-ins, darker where it bends
  // into the joint. Built here, drawn only while the board is open.
  const turnIn = height * .028, joint = height * .004;
  const pasteWidth = width - turnIn - joint, pasteHeight = height - turnIn * 2;
  const pasteGeometry = new THREE.PlaneGeometry(pasteWidth, pasteHeight, overview ? 3 : 10, 1);
  const pastePositions = pasteGeometry.getAttribute('position'), pasteShade = [];
  for (let i = 0; i < pastePositions.count; i++) {
    // Turned to face the pages, the plane's +x edge lies in the joint.
    const fromJoint = (pasteWidth / 2 - pastePositions.getX(i)) / pasteWidth;
    const shade = 1 - .3 * Math.max(0, 1 - fromJoint / .14) ** 2 - .06 * Math.max(0, fromJoint - .88) / .12;
    pasteShade.push(shade, shade, shade);
  }
  pasteGeometry.setAttribute('color', new THREE.Float32BufferAttribute(pasteShade, 3));
  const endpaper = new THREE.MeshStandardMaterial({ color:'#ffffff', roughness:1, vertexColors:true,
    map:overview ? null : sharedTexture('endpaper', endpaperTexture) });
  endpaper.map?.repeat.set(3 * pasteWidth / pasteHeight, 3);
  const pastedown = new THREE.Mesh(pasteGeometry, endpaper);
  pastedown.name = 'endpaper'; pastedown.rotation.y = Math.PI; pastedown.visible = false;
  pastedown.position.set(-width / 2 + joint + pasteWidth / 2, 0, -board * .54);
  frontBoard.add(pastedown);
  // One material for face and edges: a single draw call per back board.
  const backBoard = new THREE.Mesh(boardGeometry(width, height, board, { shelf, overview }), cloth);
  backBoard.name = 'back-cover';
  backBoard.position.z = -thickness / 2 + board / 2;
  group.add(backBoard);
  const inset = height * .009;
  let edges, pageBlock;
  if (overview) {
    // A thumbnail keeps a plain block and one tiny owned raster.
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 32;
    const c = canvas.getContext('2d'); c.fillStyle = '#ffffff'; c.fillRect(0, 0, 32, 32);
    for (let i = 1; i < 32; i += 3) {
      c.fillStyle = i % 9 === 1 ? 'rgba(112,112,112,.18)' : 'rgba(255,255,255,.4)'; c.fillRect(0, i, 32, 1);
    }
    const map = new THREE.CanvasTexture(canvas); map.colorSpace = THREE.SRGBColorSpace;
    edges = new THREE.MeshPhysicalMaterial({ map, roughness:1 });
    pageBlock = box(width - inset * 2, height - inset * 2, thickness - board * 2.4, edges, inset * .3);
  } else {
    // One crescent-shaped block and one shared atlas: a single draw call.
    const size = detail ? 512 : 256, map = sharedTexture(`pages-${size}`, () => pageEdgeAtlas(size));
    edges = new THREE.MeshPhysicalMaterial({ map, roughness:1, vertexColors:true });
    pageBlock = new THREE.Mesh(pageBlockGeometry(width, height, thickness, { board, inset, detail }), [edges]);
    group.add(pageBlock);
  }
  applyPaperFinish(edges, book.pageEdgeFinish);
  pageBlock.name = 'page-block';
  const pageWidth = width - inset * 2, pageHeight = height - inset * 2;
  const pageFront = thickness / 2 - board * 1.2 + board * .03;
  // The paper runs on into the joint, where the leaf bends down into shade,
  // so no strip of bare text block shows between the two pages.
  const paperGeometry = new THREE.PlaneGeometry(pageWidth + inset, pageHeight, 2, 1);
  const paperCorners = paperGeometry.getAttribute('position'), paperShade = [];
  for (let i = 0; i < paperCorners.count; i++) {
    if (Math.abs(paperCorners.getX(i)) < 1e-6) paperCorners.setX(i, -pageWidth / 2 + inset / 2);
    const shade = paperCorners.getX(i) < -pageWidth / 2 ? .74 : 1;
    paperShade.push(shade, shade, shade);
  }
  paperGeometry.setAttribute('color', new THREE.Float32BufferAttribute(paperShade, 3));
  const pagePaper = new THREE.Mesh(paperGeometry,
    new THREE.MeshBasicMaterial({ color:'#ffffff', toneMapped:false, vertexColors:true }));
  pagePaper.position.set(inset * .3 - inset / 2, 0, pageFront);
  pagePaper.visible = false;
  pagePaper.name = 'reading-page-paper'; group.add(pagePaper);
  // Both map and blending variants exist before the first flyout frame.
  // Replacing their pixels cannot introduce a shader variant when opening.
  const blankPageMap = () => {
    const map = new THREE.DataTexture(new Uint8Array([255,255,255,255]), 1, 1);
    map.colorSpace = THREE.SRGBColorSpace; map.minFilter = THREE.LinearFilter;
    map.generateMipmaps = false; map.needsUpdate = true; return map;
  };
  const pageMaterial = new THREE.MeshBasicMaterial({ color:0xffffff, toneMapped:false, map:blankPageMap(), transparent:true });
  const pageImage = new THREE.Mesh(new THREE.PlaneGeometry(pageWidth, pageHeight), pageMaterial);
  pageImage.name = 'reading-page';
  pageImage.position.set(inset * .3, 0, pageFront + board * .02);
  pageImage.visible = false; group.add(pageImage);
  group.userData.pageSurface = pageImage;
  // The same page on white stock sits just behind the reader's own: the
  // book opens and closes on white paper and the reading theme fades over it
  // (pageTheme 0 = white stock, 1 = the reader's theme). Only exists when the
  // snapshot carries a variant, i.e. for each reader theme, including sepia.
  const stockMaterial = new THREE.MeshBasicMaterial({ color:0xffffff, toneMapped:false, map:blankPageMap() });
  const stockImage = new THREE.Mesh(new THREE.PlaneGeometry(pageWidth, pageHeight), stockMaterial);
  stockImage.name = 'reading-page-stock';
  stockImage.position.set(inset * .3, 0, pageFront + board * .01);
  stockImage.visible = false; group.add(stockImage);
  let pageTheme = 1, themeTone = null, stockTone = null;
  const paperScratch = new THREE.Color();
  const applyPageTheme = () => {
    const faded = stockImage.visible;
    // Transparent for the whole life of a variant (never toggled while it is
    // on screen: that would recompile the program mid-opening); at opacity 1
    // the blend is exactly the opaque result.
    pageMaterial.opacity = faded ? pageTheme : 1;
    const tone = faded ? mixPaperTone(paperScratch, stockTone, themeTone, pageTheme) : themeTone;
    if (tone) { pagePaper.material.color.copy(tone); leafPaper?.color.copy(tone).multiply(LEAF_LIGHT); }
  };
  group.userData.setPageTheme = (mix, redraw = true) => {
    if (disposed) return false;
    const next = Math.max(0, Math.min(1, Number.isFinite(Number(mix)) ? Number(mix) : 1));
    const changed = next !== pageTheme;
    pageTheme = next;
    if (!stockImage.visible) return false;
    applyPageTheme();
    if (changed && redraw) group.userData.invalidate?.();
    return true;
  };
  group.userData.getPageTheme = () => pageTheme;
  // `redraw:false` builds the page without rendering it (the caller draws later).
  group.userData.getPageTextures = () => stockImage.visible ? [pageMaterial.map, stockMaterial.map] : [pageMaterial.map];
  group.userData.setPageSnapshot = (snapshot, { pageTheme:initialTheme, redraw = true } = {}) => {
    if (disposed || !snapshot?.source) return false;
    const imageWidth = Number(snapshot.width || snapshot.source.width || snapshot.source.naturalWidth);
    const imageHeight = Number(snapshot.height || snapshot.source.height || snapshot.source.naturalHeight);
    if (!(imageWidth > 0 && imageHeight > 0)) return false;
    const fit = fitCoverImage(imageWidth, imageHeight, pageWidth, pageHeight);
    pageImage.geometry.dispose();
    pageImage.geometry = new THREE.PlaneGeometry(fit.width, fit.height);
    const pageTexture = source => {
      const map = new THREE.CanvasTexture(source);
      map.colorSpace = THREE.SRGBColorSpace;
      map.minFilter = THREE.LinearFilter; map.generateMipmaps = false;
      return map;
    };
    const map = pageTexture(snapshot.source);
    pageMaterial.map?.dispose(); pageMaterial.map = map; pageMaterial.needsUpdate = true;
    pageImage.visible = true;
    // The stock variant must be the same page: same canvas size.
    const variant = snapshot.paper?.source ? snapshot.paper : null;
    const sameSize = variant && Number(variant.width || variant.source.width) === imageWidth
      && Number(variant.height || variant.source.height) === imageHeight;
    stockMaterial.map?.dispose();
    if (sameSize) {
      stockImage.geometry.dispose(); stockImage.geometry = pageImage.geometry.clone();
      stockMaterial.map = pageTexture(variant.source); stockMaterial.needsUpdate = true;
      stockImage.visible = true;
    } else {
      stockMaterial.map = blankPageMap();
      stockImage.visible = false; pageMaterial.opacity = 1;
    }
    if (initialTheme != null) pageTheme = Math.max(0, Math.min(1, Number(initialTheme) || 0));
    // Match the reader's snapshot; ordinary unthemed book paper stays white.
    themeTone = paperTone(snapshot.source);
    stockTone = sameSize ? paperTone(variant.source) : null;
    if (stockImage.visible) applyPageTheme();
    else if (themeTone) { pagePaper.material.color.copy(themeTone); leafPaper?.color.copy(themeTone).multiply(LEAF_LIGHT); }
    group.userData.pageSnapshot = snapshot;
    if (redraw) group.userData.invalidate?.();
    return true;
  };
  let bookmark = bookmarkFor(book);
  let ribbonMaterial = null, ribbonMesh = null, coverOpening = 0, bookmarkWithdraw = 0;
  // The ribbon's silk follows the cloth it has to stand out from.
  let clothColor = style.color;
  const silk = () => ribbonSilk(ribbonSeed, clothColor, bookmark.finished);
  if (bookmark) {
    ribbonMaterial = satinRibbon(bookmark.finished, silk(), !detail);
    ribbonMesh = new THREE.Mesh(
      bookmarkGeometry(width, height, thickness, bookmark.progress, bookmark.peek, { segments:ribbonSegments, seed:ribbonSeed }),
      ribbonMaterial
    );
    ribbonMesh.renderOrder = 4;
    ribbonMesh.name = 'reading-bookmark';
    group.add(ribbonMesh);
  }
  // Lifted copies only: the leaves already read turn over with the board, so
  // an open book shows paper curling into the gutter, never a bare pastedown.
  const leafDepth = () => (thickness - board * 2.4) * THREE.MathUtils.clamp(bookmark?.progress ?? 0, .025, .5);
  // Text paper: cooler and smoother than the endpaper, the tone of the page.
  // Like the saved page beside it, it skips tone mapping: the two sheets must
  // not be graded differently. Matte paper has no highlight to compress.
  const leafPaper = detail ? new THREE.MeshStandardMaterial({ color:new THREE.Color(0xffffff).multiply(LEAF_LIGHT), roughness:.93, vertexColors:true,
    map:sharedTexture('endpaper', endpaperTexture), toneMapped:false }) : null;
  // Finer than the endpaper: the fibres shrink into the grain of a book paper.
  leafPaper?.map.repeat.set(6 * width / height, 6);
  const readLeaves = detail
    ? new THREE.Mesh(leafStackGeometry(width, height, leafDepth(), { board, inset }), [leafPaper, edges]) : null;
  if (readLeaves) { readLeaves.name = 'read-leaves'; readLeaves.visible = false; frontCover.add(readLeaves); }
  // The joint grooves are pressed into the board artwork (finishBoard), so
  // no raised strips sit on top of the covers any more.
  const bindingMesh = new THREE.Mesh(bindingGeometry(width, height, thickness, bindingSegments, surface.relief, reliefRows), binding);
  bindingMesh.name = 'binding';
  group.add(bindingMesh);
  const capMaterials = [];
  for (const y of [-height / 2, height / 2]) {
    const material = new THREE.MeshPhysicalMaterial({ color:style.color, side:THREE.DoubleSide });
    applySpineCapFinish(material, book);
    applyBookReflectionSurface(material, { seed:`${surfaceSeed}|${y < 0 ? 'tail' : 'head'}`, strength:.01,
      uvScale:[1 / width, 1 / thickness] });
    const mesh = new THREE.Mesh(capGeometry(width, thickness, bindingSegments, overview ? 0 : board * 1.1), material);
    mesh.name = y < 0 ? 'binding-tail-cap' : 'binding-head-cap';
    capMaterials.push(mesh.material);
    mesh.rotation.x = Math.PI / 2; mesh.position.y = y; group.add(mesh);
  }
  let disposed = false, coverRevision = 0, currentCoverUrl, releaseImage = () => {}, resolveCoverReady = () => {};
  let currentImage = null;
  // ---- cover relief: raised, foil and varnished zones from the cover picture.
  // The maps are rebuilt from the picture (deterministic per cover), so only
  // { id, strength } is ever saved. They swap into texture slots the cover
  // material already compiled with: selecting a relief links no program.
  let wantedRelief = null, reliefRevision = 0, reliefMaps = null, reliefOwned = new Set();
  let reliefController = null, materialRevision = 0;
  const canvasTexture = (rgba, width, height) => {
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    canvas.getContext('2d').putImageData(new ImageData(rgba, width, height), 0, 0);
    const texture = new THREE.CanvasTexture(canvas);
    texture.anisotropy = 4;
    return texture;
  };
  const adoptReliefTextures = (normal, material) => {
    const fresh = new Set([normal, material]);
    for (const old of reliefOwned) if (!fresh.has(old)) old.dispose();
    for (const old of [cover.clearcoatNormalMap, cover.clearcoatMap]) if (old && !fresh.has(old) && !reliefOwned.has(old)) old.dispose();
    reliefOwned = fresh;
    cover.clearcoatNormalMap = normal;
    cover.clearcoatMap = cover.clearcoatRoughnessMap = cover.roughnessMap = cover.metalnessMap = material;
  };
  const reliefGain = strength => .9 + 2.6 * strength;
  const applyReliefUniforms = () => {
    if (!wantedRelief || !reliefMaps) {
      cover.metalness = 0; cover.clearcoatNormalScale.set(1, 1);
      if (reliefArmed) laminate(coverFinishValue);
      return;
    }
    // Full clearcoat share: the map's red channel carries the laminate's own
    // share outside the varnished zones, so a matte board still gets gloss spots.
    cover.clearcoat = 1; cover.metalness = 1;
    cover.clearcoatNormalScale.setScalar(reliefGain(wantedRelief.strength));
  };
  async function bakeReliefMaterial(revision, maps = reliefMaps, signal) {
    if (!maps) return false;
    const ticket = ++materialRevision;
    const finish = SURFACE_FINISHES[coverSurfaceFinish];
    const rgba = await runInSlices(composeMaterialMap(maps.pixels, { clearcoat: finish.clearcoat, roughness: finish.roughness }));
    if (revision !== reliefRevision || ticket !== materialRevision || signal?.aborted || disposed) return false;
    const { width, height } = maps.size;
    adoptReliefTextures(maps.normalTexture, canvasTexture(rgba, width, height));
    reliefMaps = maps;
    applyReliefUniforms();
    return true;
  }
  function clearRelief() {
    reliefMaps = null;
    materialRevision++;
    adoptReliefTextures(neutralTexture(128, 128, 255), neutralTexture(255, 255, 0));
    applyReliefUniforms();
    group.userData.invalidate?.();
  }
  group.userData.coverRelief = () => (wantedRelief ? { ...wantedRelief } : null);
  group.userData.supportsCoverRelief = reliefCapable;
  // Only the cover editor needs these shader slots before its first choice.
  // Ordinary flyouts retain the cheaper material until editing is requested.
  group.userData.prepareCoverRelief = () => {
    if (disposed || !reliefCapable) return false;
    armRelief();
    return true;
  };
  /** Apply (or clear, with null) a relief choice. Resolves true once drawn. */
  group.userData.setCoverRelief = async relief => {
    if (disposed || !reliefCapable) return false;
    reliefController?.abort();
    const controller = reliefController = new AbortController();
    const next = normalizeCoverRelief(relief), revision = ++reliefRevision;
    wantedRelief = next;
    if (!next) { if (reliefArmed) clearRelief(); return true; }
    armRelief();
    // Only installed maps may be reused. A pending bake owns no cached state.
    if (reliefMaps && reliefMaps.id === next.id && reliefMaps.source === (currentImage ?? cover.map?.image)) {
      applyReliefUniforms(); group.userData.invalidate?.(); return true;
    }
    let built;
    try {
      await group.userData.ready;
      if (revision !== reliefRevision || disposed || controller.signal.aborted) return false;
      const source = currentImage ?? cover.map?.image;
      if (!source) return false;
      built = await buildReliefMaps(source, next, { maxSize: 512, signal: controller.signal });
      if (!built || revision !== reliefRevision || disposed || controller.signal.aborted) return false;
      const { width, height } = built.size;
      built.normalTexture = canvasTexture(built.normal, width, height);
      built.id = next.id; built.source = source;
      if (!await bakeReliefMaterial(revision, built, controller.signal)) {
        built.normalTexture.dispose(); return false;
      }
      group.userData.invalidate?.();
      return true;
    } catch {
      if (built?.normalTexture && !reliefOwned.has(built.normalTexture)) built.normalTexture.dispose();
      return false;
    }
  };
  function updateCoverSource(url, nextBook = book, nextStyle = style) {
    if (disposed) return Promise.resolve(false);
    if (url && url === currentCoverUrl) return group.userData.ready;
    reliefController?.abort(); reliefRevision++;
    if (reliefArmed && reliefMaps) clearRelief();
    currentImage = null;
    resolveCoverReady(false);
    const revision = ++coverRevision, releasePrevious = releaseImage;
    currentCoverUrl = url;
    group.userData.ready = new Promise(resolve => { resolveCoverReady = resolve; });
    const settle = loaded => {
      if (revision !== coverRevision || disposed) return;
      group.userData.coverLoaded = loaded;
      resolveCoverReady(loaded);
      if (loaded && wantedRelief) group.userData.setCoverRelief(wantedRelief);
      group.userData.invalidate?.();
    };
    const replaceMap = map => {
      map.anisotropy = Math.min(16, renderer?.capabilities.getMaxAnisotropy() || 1);
      cover.map?.dispose(); cover.map = map; cover.needsUpdate = true;
    };
    if (!url) {
      releaseImage = () => {};
      replaceMap(coverTexture(nextBook, nextStyle, textureHeight, maxTextureDimension, level));
      setCoverGrain('cloth'); settle(true);
    } else releaseImage = acquireCoverImage(url, image => {
      if (revision !== coverRevision || disposed) return;
      // The previous cover remains on the mesh until every new pixel is ready.
      currentImage = image;
      try {
        const canvas = document.createElement('canvas');
        const dimensions = coverRasterDimensions(nextStyle.coverRatio, textureHeight, maxTextureDimension);
        canvas.height = dimensions.height; canvas.width = dimensions.width;
        const c = canvas.getContext('2d'); c.fillStyle = nextStyle.color; c.fillRect(0, 0, canvas.width, canvas.height);
        const fit = fitCoverImage(image.width, image.height, canvas.width, canvas.height);
        c.imageSmoothingEnabled = true; c.imageSmoothingQuality = 'high';
        c.drawImage(image, fit.x, fit.y, fit.width, fit.height);
        // A printed jacket is still paper over board: joint, edges, corners.
        const unit = canvas.height / 1024;
        c.setTransform?.(unit, 0, 0, unit, 0, 0);
        finishBoard(c, canvas.width / unit, coverSeed(nextBook, nextStyle, 'print'), { wear:level !== 'overview' });
        const fittedMap = new THREE.CanvasTexture(canvas); fittedMap.colorSpace = THREE.SRGBColorSpace;
        replaceMap(fittedMap); setCoverGrain('paper'); settle(true);
      } catch { settle(false); }
    }, () => settle(false));
    releasePrevious();
    return group.userData.ready;
  }
  group.userData.updateCoverSource = updateCoverSource;
  updateCoverSource(coverUrl);
  if (reliefCapable && book.coverRelief) group.userData.setCoverRelief(book.coverRelief);
  // Only a download still in flight (or one that already failed) needs the
  // generated case meanwhile; a decoded image or a generated cover is on.
  if (!cover.map) {
    cover.map = coverTexture(book, style, textureHeight, maxTextureDimension, level); cover.needsUpdate = true;
  }
  group.userData.dispose = () => {
    if (disposed) return;
    releaseImage(); resolveCoverReady(false);
    reliefController?.abort();
    disposed = true; reliefRevision++; materialRevision++; reliefMaps = null;
    const materials = new Set([insideCover]), textures = new Set([surface.map, surface.channels]);
    group.traverse(obj => { obj.geometry?.dispose(); if (obj.material) for (const m of [].concat(obj.material)) materials.add(m); });
    for (const m of materials) {
      for (const key of ['map', 'roughnessMap', 'metalnessMap', 'bumpMap', 'normalMap', 'alphaMap', 'clearcoatMap', 'clearcoatRoughnessMap', 'clearcoatNormalMap']) if (m[key]) textures.add(m[key]);
      m.dispose();
    }
    // Shared procedural sources survive: only this model's clones release.
    for (const texture of textures) texture?.dispose();
  };
  group.userData.updateSpineAppearance = (nextBook, nextStyle) => {
    const previous = surface;
    surface = shelfSpineSurface(nextBook, nextStyle, height, thickness, shelf, overview, inspectionResolution);
    Object.assign(binding, surface.material); updateSpineFade?.(nextBook, nextStyle);
    binding.needsUpdate = true;
    releaseSurface(previous);
    bindingMesh.geometry.dispose();
    bindingMesh.geometry = bindingGeometry(width, height, thickness, bindingSegments, surface.relief, reliefRows);
    cloth.color.set(nextStyle.color); insideCover.color.set(nextStyle.color);
    clothColor = nextStyle.color;
    if (ribbonMaterial) tintRibbon(ribbonMaterial, silk(), !detail);
    for (const material of capMaterials) {
      material.color.set(nextStyle.color);
      applySpineCapFinish(material, nextBook);
    }
  };
  group.userData.updateCoverAppearance = nextBook => {
    const finishChanged = surfaceFinish(nextBook.coverFinish) !== coverSurfaceFinish;
    coverSurfaceFinish = surfaceFinish(nextBook.coverFinish);
    coverFinishValue = nextBook.coverFinish;
    laminate(nextBook.coverFinish);
    applyReliefUniforms();
    updateCoverGrainStrength();
    const wanted = 'coverRelief' in nextBook ? normalizeCoverRelief(nextBook.coverRelief) : wantedRelief;
    const selectionChanged = JSON.stringify(wanted) !== JSON.stringify(wantedRelief);
    if (reliefCapable && selectionChanged) {
      group.userData.setCoverRelief(wanted);
    } else if (finishChanged && reliefMaps) {
      const revision = reliefRevision;
      bakeReliefMaterial(revision).then(done => { if (done) group.userData.invalidate?.(); });
    }

  };
  group.userData.setCoverOpen = amount => {
    const next = Math.max(0, Math.min(1, amount));
    frontCover.rotation.y = -Math.PI * .94 * next;
    if (overview) frontBoard.material = next > 0 ? frontMaterials : cover;
    // Closed shelf books need neither the occluded paper plane nor the
    // cover's inner material submitted to the GPU on every shelf repaint.
    pagePaper.visible = next > 0;
    insideCover.visible = pastedown.visible = next > 0;
    if (readLeaves) readLeaves.visible = next > 0;
    if (Math.abs(next - coverOpening) > .00001) { coverOpening = next; updateRibbonGeometry(); }
  };
  function updateRibbonGeometry() {
    if (!ribbonMesh || !bookmark) return;
    ribbonMesh.geometry.dispose();
    ribbonMesh.geometry = bookmarkGeometry(width, height, thickness, bookmark.progress, bookmark.peek,
      { open:Math.max(0, Math.min(1, (coverOpening - .1) / .9)), withdraw:bookmarkWithdraw, segments:ribbonSegments, seed:ribbonSeed });
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
    if (ribbonMesh) {
      group.remove(ribbonMesh); ribbonMesh.geometry.dispose(); ribbonMaterial.alphaMap?.dispose(); ribbonMaterial.dispose();
    }
    ribbonMesh = null; ribbonMaterial = null;
    if (bookmark) {
      ribbonMaterial = satinRibbon(bookmark.finished, silk(), !detail);
      ribbonMesh = new THREE.Mesh(bookmarkGeometry(width, height, thickness, bookmark.progress, bookmark.peek,
        { segments:ribbonSegments, seed:ribbonSeed }), ribbonMaterial);
      ribbonMesh.renderOrder = 4; ribbonMesh.name = 'reading-bookmark'; group.add(ribbonMesh);
      updateRibbonGeometry();
    }
    if (readLeaves) {
      readLeaves.geometry.dispose();
      readLeaves.geometry = leafStackGeometry(width, height, leafDepth(), { board, inset });
    }
    group.userData.hasBookmark = Boolean(bookmark);
    group.userData.invalidate?.();
  };
  group.userData.updateEdgeAppearance = nextBook => applyPaperFinish(edges, nextBook.pageEdgeFinish);
  return group;
}

let renderer, studioEnvironment;
const rendererSize = new THREE.Vector2();
export function getBookRenderer() {
  if (!globalThis.WebGLRenderingContext && !globalThis.WebGL2RenderingContext) return null;
  if (!renderer) try {
    // Shelf, reader and insertion snapshots copy the frame synchronously
    // after render. The GPU need not retain a second framebuffer between
    // frames; their visible 2D canvases already own the captured pixels.
    // Every consumer (bookView, the shelf and its insertion overlay) sets its
    // own pixel ratio and size before drawing, so no oversized buffer is allocated up front.
    renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    // Preserve print colours and gently compress real specular highlights.
    // Unmapped studio radiance used to clip RGB channels on bright jackets.
    renderer.toneMapping = THREE.NeutralToneMapping;
    renderer.toneMappingExposure = 1;
    // Its toe pulls the weakest channel of every dark tone to zero, which
    // turns walnut and deep bookcloth orange and crushes navy. A smoothstep
    // toe keeps the black point, the join at 0.08 and the highlight curve.
    // Patched once before any program compiles; a later three skips it.
    const toe = 'float offset = x < 0.08 ? x - 6.25 * x * x : 0.04;';
    const tonemap = THREE.ShaderChunk.tonemapping_pars_fragment;
    if (tonemap?.includes(toe)) THREE.ShaderChunk.tonemapping_pars_fragment = tonemap.replace(toe,
      'float toe = min( x / 0.08, 1.0 ); float offset = 0.04 * toe * toe * ( 3.0 - 2.0 * toe );');
    renderer.shadowMap.enabled = true;
    // Variance shadows: one 1024 map with a wide, smooth interior penumbra.
    // Its blur runs only when the scene requests a shadow refresh.
    renderer.shadowMap.type = THREE.VSMShadowMap;
    renderer.shadowMap.autoUpdate = false;
    // A quiet reading room instead of a grey photo studio: plaster walls, a
    // walnut floor, a tall window high on the left (the key's direction) and a
    // warm lamp on the right. Satin wood and laminates reflect real shapes.
    const room = new THREE.Scene(), shell = new THREE.SphereGeometry(10, 48, 24), tint = [];
    // Near-neutral surfaces: the warmth belongs to the key and the lamp, so
    // shadows stay natural instead of turning every material orange.
    const floor = new THREE.Color(.068, .05, .037), wall = new THREE.Color(.34, .315, .288), ceiling = new THREE.Color(.5, .485, .46);
    for (let i = 0, p = shell.attributes.position, c = new THREE.Color(); i < p.count; i++) {
      const y = p.getY(i) / 10;
      c.copy(floor).lerp(wall, THREE.MathUtils.smoothstep(y, -.32, -.02)).lerp(ceiling, THREE.MathUtils.smoothstep(y, .3, .85));
      tint.push(c.r, c.g, c.b);
    }
    shell.setAttribute('color', new THREE.Float32BufferAttribute(tint, 3));
    room.add(new THREE.Mesh(shell, new THREE.MeshBasicMaterial({ vertexColors:true, side:THREE.BackSide })));
    const glow = (geometry, rgb, strength, position) => {
      const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color:new THREE.Color(...rgb).multiplyScalar(strength), side:THREE.DoubleSide }));
      mesh.position.set(...position); mesh.lookAt(0, 0, 0); room.add(mesh); return mesh;
    };
    const pane = glow(new THREE.PlaneGeometry(4.6, 5.8), [1, .98, .95], 6.5, [-3.6, 3.9, 7.8]);
    // Mullions break the reflection into panes, as a real window would.
    for (const [w, h, x, y] of [[.16, 5.8, 0, 0], [4.6, .14, 0, .5]]) {
      const bar = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color:0x2a2119, side:THREE.DoubleSide }));
      bar.position.set(x, y, .02); pane.add(bar);
    }
    glow(new THREE.SphereGeometry(.55, 16, 8), [1, .7, .4], 16, [7.4, 1.2, 3.6]);
    // Shelf covers face the room's rear-right side after the isometric turn.
    // Give their laminate a broad secondary window to reflect; the existing
    // front-left key still lights the print. This is baked into the shared
    // environment once, adding no live light or reflection render pass.
    glow(new THREE.PlaneGeometry(4, 6), [1, .98, .95], 2.2, [7, -1, -6.4]);
    glow(new THREE.PlaneGeometry(7, 2.2), [1, .96, .92], .9, [0, 9.4, -1]);
    const pmrem = new THREE.PMREMGenerator(renderer);
    studioEnvironment = pmrem.fromScene(room, .035).texture;
    room.traverse(object => { object.geometry?.dispose(); object.material?.dispose(); });
    pmrem.dispose();
    keepProgramsAlive(renderer);
  } catch { return null; }
  return renderer;
}

/** One warm reading-room rig for shelf, editor and opening/closing books.
 * The key matches the environment's window; shelf-lighting gives it shadows. */
export function lightBookScene(scene) {
  scene.environment = studioEnvironment;
  scene.environmentIntensity = .55;
  // Pale ceiling above, a muted bounce from the wooden floor below.
  scene.add(new THREE.HemisphereLight(0xf6f3ee, 0x5e5047, .5));
  const readerLight = new THREE.DirectionalLight(0xfff4e8, 1.9);
  readerLight.position.set(-.46, .42, 1); scene.add(readerLight);
  scene.userData.readerLight = readerLight;
  // Cooler, dim fill from the other side keeps shaded spines legible.
  const fillLight = new THREE.DirectionalLight(0xe6edff, .26);
  fillLight.position.set(3, .8, 2.6); scene.add(fillLight);
  // A modest off-axis strip still travels over metallic foil and clearcoat.
  const stripLight = new THREE.DirectionalLight(0xfff8f0, .34);
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

/** Fit the whole open spread, rather than cropping its left board on phones. */
export function planReadingBookPose({ width, height, thickness = 0,
  viewportWidth, viewportHeight, centerX, centerY }) {
  const scale = Math.min(1,viewportWidth*.86/(width*2+thickness*.8),viewportHeight*.66/height);
  return { x:viewportWidth/2-centerX+width*scale/2, y:viewportHeight*.44-centerY,
    scale, angle:0, pitch:0, roll:0, coverOpen:1, bookmarkWithdraw:0 };
}

export function projectBookBoardBounds(model,camera,viewportWidth,viewportHeight) {
  const points=[];
  model.updateWorldMatrix(true,true); camera.updateMatrixWorld();
  for (const name of ['front-cover','back-cover','binding']) {
    const mesh=model.getObjectByName(name);
    if (!mesh?.geometry) continue;
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
    const {min,max}=mesh.geometry.boundingBox;
    for (const x of [min.x,max.x]) for (const y of [min.y,max.y]) for (const z of [min.z,max.z]) {
      const point=new THREE.Vector3(x,y,z).applyMatrix4(mesh.matrixWorld).project(camera);
      points.push({x:(point.x+1)*viewportWidth/2,y:(1-point.y)*viewportHeight/2});
    }
  }
  const left=Math.min(...points.map(point=>point.x)),top=Math.min(...points.map(point=>point.y));
  return {left,top,width:Math.max(...points.map(point=>point.x))-left,height:Math.max(...points.map(point=>point.y))-top};
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
  let model = createBookModel(book, style, width, height, thickness, coverUrl, { shelf, eagerRelief:false }); scene.add(model);
  canvas.dataset.bookmark3d = String(Boolean(model.userData.hasBookmark));
  if (shelf) canvas.dataset.shelfView = shelfView;
  const camera = new THREE.OrthographicCamera(-viewportWidth / 2, viewportWidth / 2, viewportHeight / 2, -viewportHeight / 2, .1, 10000); camera.position.z = 3000;
  let disposed = false, current, cancel = () => {}, pendingModel = null, appearanceRevision = 0;
  let reliefPrepared = false, reliefPreparation = null;
  let currentBook = book, currentSnapshot = null, pageTheme = 1;
  function draw(pose) {
    if (disposed) return;
    if (pose.pageTheme != null) pageTheme = Math.max(0, Math.min(1, Number(pose.pageTheme) || 0));
    current = { ...pose, coverOpen:Math.max(0, Math.min(1, pose.coverOpen ?? current?.coverOpen ?? 0)),
      bookmarkWithdraw:Math.max(0, Math.min(1, pose.bookmarkWithdraw ?? current?.bookmarkWithdraw ?? 0)), pageTheme };
    model.userData.setCoverOpen?.(current.coverOpen);
    model.userData.setPageTheme?.(pageTheme, false);
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
    canvas.dataset.pageTheme = String(pageTheme);
    canvas.dataset.bookmarkWithdraw = String(current.bookmarkWithdraw);
    canvas.dataset.boardBounds = JSON.stringify(projectBookBoardBounds(model,camera,viewportWidth,viewportHeight));
  }
  model.userData.invalidate = () => current && draw(current);
  // Lifted books reveal hidden materials mid-motion (the inside of the board,
  // the page). Queue every program now, not in the middle of the opening.
  // three only issues compile/link here and waits for a program on its first
  // draw, so hidden ones build in the background (in parallel where
  // KHR_parallel_shader_compile exists). compileAsync adds nothing to that,
  // and its polling throws if the flyout is closed before a program is ready.
  if (!shelf) try { gpu.compile(scene, camera); } catch { /* compiled lazily on first use */ }
  draw(initialPose ?? {
    x:0, y:0, scale:1,
    angle:shelf ? (shelfView === 'isometric' ? 76 : 90) : 0,
    pitch:shelf && shelfView === 'isometric' ? 9 : 0
  });
  function updateAppearance(nextStyle) {
    if (disposed) return false;
    const revision = ++appearanceRevision;
    pendingModel?.userData.dispose();
    const replacement = createBookModel(currentBook, nextStyle, width, height, thickness, coverUrl, { shelf, eagerRelief:reliefPrepared });
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
  /** Compile and draw the neutral relief material before offering choices.
   * The first draw completes any deferred driver compilation and uploads its
   * maps; later selections replace pixels/uniforms without a shader variant. */
  function prepareCoverRelief() {
    if (disposed) return Promise.resolve(false);
    if (reliefPreparation) return reliefPreparation;
    reliefPreparation = Promise.resolve().then(() => {
      if (disposed || !model.userData.prepareCoverRelief?.()) return false;
      reliefPrepared = true;
      pendingModel?.userData.prepareCoverRelief?.();
      gpu.compile(scene, camera);
      if (current) draw(current);
      return true;
    }).catch(error => { reliefPreparation = null; throw error; });
    return reliefPreparation;
  }
  /** Apply (or clear, with null) a cover relief on the book, the one still
   * loading included. Resolves once the maps are on the cover and drawn. */
  async function setCoverRelief(relief) {
    if (disposed) return false;
    currentBook = { ...currentBook, coverRelief: normalizeCoverRelief(relief) };
    const results = await Promise.all([pendingModel?.userData.setCoverRelief?.(relief), model.userData.setCoverRelief?.(relief)]);
    if (!disposed && current) draw(current);
    return results.some(Boolean);
  }
  function updateEdgeAppearance(nextBook) {
    if (disposed) return false;
    currentBook = { ...currentBook, ...nextBook };
    pendingModel?.userData.updateEdgeAppearance?.(nextBook);
    model.userData.updateEdgeAppearance?.(nextBook);
    if (current) draw(current);
    return true;
  }
  function updateBookmark(nextBook) {
    if (disposed) return false;
    const changed = JSON.stringify(bookmarkFor(currentBook)) !== JSON.stringify(bookmarkFor(nextBook));
    currentBook = { ...currentBook, ...nextBook };
    if (changed) {
      pendingModel?.userData.updateBookmark?.(nextBook);
      model.userData.updateBookmark?.(nextBook);
      canvas.dataset.bookmark3d = String(Boolean(model.userData.hasBookmark));
    }
    return true;
  }
  function animateCoverOpen({ duration = 520, offsetX = 0, targetPose } = {}) {
    const origin = { ...current };
    return animateMotion([{ transform:origin }, { transform:{ ...origin, ...targetPose,
      x:targetPose?.x ?? origin.x + offsetX, coverOpen:1 } }], { duration });
  }
  function animateCoverClose({ duration = 580, offsetX = 0, targetPose } = {}) {
    const origin = { ...current };
    return animateMotion([{ transform:origin }, { transform:{ ...origin, ...targetPose,
      x:targetPose?.x ?? origin.x - offsetX, coverOpen:0, bookmarkWithdraw:0 } }], { duration });
  }
  function animateBookmark({ withdraw = 1, duration = 360 } = {}) {
    const origin = { ...current };
    return animateMotion([{ transform:origin }, { transform:{ ...origin, bookmarkWithdraw:withdraw } }], { duration });
  }
  // `pageTheme` (0 = white stock, 1 = the reader's own theme; default 1) is where the
  // page's colour starts: the book opens and closes on white paper.
  function setPageSnapshot(snapshot, { pageTheme:initialTheme, redraw = true } = {}) {
    if (initialTheme != null) {
      pageTheme = Math.max(0, Math.min(1, Number(initialTheme) || 0));
      if (current) current = { ...current, pageTheme };
    }
    if (disposed || !model.userData.setPageSnapshot(snapshot, { pageTheme, redraw })) return false;
    currentSnapshot = snapshot;
    pendingModel?.userData.setPageSnapshot(snapshot, { pageTheme, redraw });
    canvas.dataset.pageSource = snapshot.sourceType || snapshot.engine || 'reader-page';
    canvas.dataset.pageLocator = JSON.stringify(snapshot.location?.locator ?? snapshot.location ?? null);
    canvas.dataset.pageText = String(snapshot.text || '').slice(0, 500);
    canvas.dataset.pageWidth = String(snapshot.width || snapshot.source.width);
    canvas.dataset.pageHeight = String(snapshot.height || snapshot.source.height);
    if (current && redraw) draw(current);
    return true;
  }
  // Warm-up of a page that is not on screen yet: the textures go to the GPU
  // one by one (each upload is its own slice of main-thread time), then a
  // single draw links the page's programs. Opening later finds all of it done.
  const pageTextures = () => (disposed ? [] : model.userData.getPageTextures());
  // Starts linking the programs the now visible page needs; where the driver
  // links in parallel, the draw that follows finds them done.
  function compilePage() { if (!disposed) try { gpu.compile(scene, camera); } catch { /* linked on first draw */ } }
  function uploadPageTexture(texture) {
    if (disposed || !pageTextures().includes(texture)) return false;
    texture.anisotropy = Math.min(16, gpu.capabilities.getMaxAnisotropy()); // what draw() would set first
    gpu.initTexture(texture);
    return true;
  }
  function getPageBounds() {
    const rect = canvas.getBoundingClientRect();
    return projectBookPageBounds(model.userData.pageSurface, camera, viewportWidth, viewportHeight,
      { left:rect.left, top:rect.top });
  }
  function pagePose({ left, top, width:targetWidth, height:targetHeight }) {
    if (!current) return null;
    const origin = { ...current }, rect = canvas.getBoundingClientRect();
    return planBookPageZoom(model, camera, {
      viewportWidth, viewportHeight, centerX, centerY, origin, offset:{ left:rect.left, top:rect.top },
      target:{ left, top, width:targetWidth, height:targetHeight }
    });
  }
  function alignToPage(target) {
    const destination = pagePose(target);
    if (!destination) return false;
    draw(destination);
    return true;
  }
  function animateToPage(target) {
    const origin = { ...current }, destination = pagePose(target);
    if (!destination) return { finished:Promise.resolve(), cancel:() => {} };
    // The page's colour moves on the zoom's own clock and easing.
    if (target.pageTheme != null) destination.pageTheme = target.pageTheme;
    return animateMotion([{ transform:origin }, { transform:destination }], { duration:target.duration ?? 620 });
  }
  function setPageTheme(mix) {
    if (current) draw({ ...current, pageTheme:mix });
  }
  function animatePageTheme({ from, to = 1, duration = 720 } = {}) {
    const origin = { ...current, pageTheme:from ?? current?.pageTheme ?? pageTheme };
    return animateMotion([{ transform:origin }, { transform:{ ...origin, pageTheme:to } }], { duration });
  }
  function setBookmarkWithdraw(amount) {
    if (current) draw({ ...current, bookmarkWithdraw:amount });
  }
  function animateMotion(frames, { duration }) {
    cancel();
    if (current) frames = [{ ...frames[0], transform: current }, ...frames.slice(1)];
    let raf, resolve; const finished = new Promise(r => resolve = r);
    cancel = () => { cancelAnimationFrame(raf); resolve(); };
    let lastFrame = performance.now(), elapsed = 0;
    const animation = { finished, cancel, lastFrameTime:lastFrame };
    // Real time, so a slow device finishes each phase on schedule instead of
    // stretching it frame by frame. A stalled frame on a phone GPU may absorb
    // at most 100 ms (a fifth of a hinge opening), never half a phase, so the
    // board and ribbon never visibly jump. The first step only covers the
    // frame that scheduled the motion.
    const maxStep = Math.max(48, Math.min(100, duration / 2));
    let started = false;
    const tick = now => {
      if (disposed) return resolve();
      elapsed += Math.min(started ? maxStep : 48, Math.max(0, now - lastFrame)); lastFrame = now; started = true;
      const t = duration > 0 ? Math.min(1, elapsed / duration) : 1;
      draw(sampleBookMotion(frames, t)); animation.lastFrameTime = performance.now();
      if (t < 1) raf = requestAnimationFrame(tick); else resolve();
    };
    raf = requestAnimationFrame(tick); return animation;
  }
  return { canvas, get ready() { return (pendingModel || model).userData.ready; }, draw,
    updateAppearance, updateSpineAppearance, updateCoverAppearance, prepareCoverRelief, setCoverRelief, updateEdgeAppearance, updateBookmark,
    setPageSnapshot, pageTextures, uploadPageTexture, compilePage, hasPageSnapshot:snapshot => Boolean(snapshot) && currentSnapshot === snapshot,
    setPageTheme, animatePageTheme, getPageTheme:() => pageTheme,
    getPageBounds, getPose:() => ({ ...current }), setBookmarkWithdraw,
    animateCoverOpen, animateCoverClose, animateBookmark, alignToPage, animateToPage,
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
  for (const key of ['x', 'y', 'scale', 'angle', 'pitch', 'roll', 'coverOpen', 'bookmarkWithdraw', 'pageTheme']) {
    // The page's stock/theme mix only moves when every frame says where it goes.
    if (key === 'pageTheme' && frames.some(frame => frame.transform.pageTheme == null)) continue;
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
