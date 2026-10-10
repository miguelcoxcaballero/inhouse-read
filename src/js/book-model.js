import { paddedBookFrameSize } from './book-frame-padding.js';
import { reuseCoverRaster, releaseCoverRaster } from './cover-raster-cache.js';
import { paperToneKey, readPaperTone } from './page-paper-tone.js';
import { bookReturnCompatibility } from './bookshelf-return.js';
import * as THREE from 'three';
import { createStudioRenderer, studioEnvironmentFor } from './studio-renderer.js';
import { configureNativeRendererSize } from './native-renderer-size.js';
import { spineSurface, releaseSurface, seededRandom, textSeed, withStops, paintCloth, paintWeave, spineLayout, drawDevice, lattice } from './spine-surface.js';
import { METAL_COLORS, SURFACE_FINISHES, spineFinish, surfaceFinish } from './book-colors.js';
import { displayBookTitle, normalizeBookAuthor } from './book-title.js';
import { pageRaster } from './page-raster.js';
import { bookmarkFor } from './bookshelf-layout.js';
import { applyBookReflectionSurface } from './book-reflection-surface.js';
import { compilePagePrograms, prepareProgramUniforms, retainPrograms } from './gpu-programs.js';
import { buildReliefMaps, composeMaterialMap, coverReliefLayers, normalizeCoverRelief, updateReliefMapStrengths } from './cover-relief.js';
import { runInSlices } from './cover-appearance.js';
import { registerCanvasSnapshot as registerLazySnapshot, createNativeRendererPresentation,
  withRendererPresentation } from './native-renderer-presentation.js';

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
  const uniforms = {
    bookReliefBaseFinish:{ value:new THREE.Vector3() },
    bookReliefStrength:{ value:0 }
  };
  const physical = THREE.ShaderChunk.lights_physical_fragment
    .replace('material.clearcoatRoughness *= texture2D( clearcoatRoughnessMap, vClearcoatRoughnessMapUv ).y;',
      'material.clearcoatRoughness *= texture2D( clearcoatRoughnessMap, vClearcoatRoughnessMapUv ).a;')
    .replace('PhysicalMaterial material;', `roughnessFactor = mix( bookReliefBaseFinish.y, roughnessFactor, bookReliefAmount );
PhysicalMaterial material;`)
    .replace('material.clearcoat = saturate( material.clearcoat );', `material.clearcoat = mix( bookReliefBaseFinish.x, material.clearcoat, bookReliefAmount );
  material.clearcoatRoughness = mix( bookReliefBaseFinish.z, material.clearcoatRoughness, bookReliefAmount );
  material.clearcoat = saturate( material.clearcoat );`);
  material.onBeforeCompile = function(shader, renderer) {
    previousHook.call(this, shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', `uniform vec3 bookReliefBaseFinish;
uniform float bookReliefStrength;
float bookReliefAmount = 0.0;
void main() {`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
	#ifdef USE_CLEARCOAT_NORMALMAP
		vec4 reliefSample = texture2D( clearcoatNormalMap, vClearcoatNormalMapUv );
		bookReliefAmount = step( 0.5 / 255.0, reliefSample.a ) * bookReliefStrength;
		vec3 reliefN = vec3( ( reliefSample.xy * 255.0 - 128.0 ) / 127.0, reliefSample.z * 2.0 - 1.0 );
		reliefN.xy *= clearcoatNormalScale;
		reliefN.z = mix( 1.0, reliefN.z, bookReliefStrength );
		normal = normalize( normal + tbn2 * reliefN - tbn2[ 2 ] );
	#endif`)
      .replace('#include <clearcoat_normal_fragment_maps>', THREE.ShaderChunk.clearcoat_normal_fragment_maps
        .replace('texture2D( clearcoatNormalMap, vClearcoatNormalMapUv ).xyz * 2.0 - 1.0',
          'vec3( ( reliefSample.xy * 255.0 - 128.0 ) / 127.0, reliefSample.z * 2.0 - 1.0 )'))
      .replace('#include <lights_physical_fragment>', physical);
  };
  material.customProgramCacheKey = () => `${previousKey}|cover-relief-color-v2`;
  return uniforms;
}

function neutralTexture(r, g, b, a = 255) {
  const texture = new THREE.DataTexture(new Uint8Array([r, g, b, a]), 1, 1);
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
  { open = 0, withdraw = 0, segments = 32, seed = 0, geometry: target } = {}) {
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
  // Opening and withdrawing only bend the ribbon; its topology stays fixed.
  // Keep the same GPU buffers during the flight instead of deleting and
  // uploading a new indexed mesh on every frame. The path and normals are
  // still calculated at the original resolution.
  const reuse = target?.getAttribute('position')?.count === positions.length / 3
    && target.getAttribute('uv')?.count === uvs.length / 2
    && target.index?.count === indices.length;
  const geometry = reuse ? target : new THREE.BufferGeometry();
  if (reuse) {
    geometry.getAttribute('position').array.set(positions);
    geometry.getAttribute('uv').array.set(uvs);
    geometry.getAttribute('position').needsUpdate = true;
    geometry.getAttribute('uv').needsUpdate = true;
    geometry.boundingBox = geometry.boundingSphere = null;
  } else {
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
  }
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
function paperTone(source, toneKey) {
  const key = paperToneKey(source, toneKey);
  if (paperTones.has(key)) return paperTones.get(key);
  const rgb = readPaperTone(source, toneKey);
  const tone = rgb ? new THREE.Color().setRGB(...rgb.map(value => value / 255), THREE.SRGBColorSpace) : null;
  paperTones.set(key, tone);
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
  const words = (displayBookTitle(book) || 'Sin título').split(' '); let line = ''; const lines = [];
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
  if (entry.image) onImage(entry.image, entry);
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
    for (const waiting of entry.listeners) waiting.onImage(entry.image, entry);
    entry.listeners.clear(); map.dispose();
    }, undefined, fail);
  }
  let released = false;
  return () => {
    if (released) return;
    released = true; entry.listeners.delete(listener); entry.users--;
    if (!entry.users) {
      releaseCoverRaster(entry);
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
  const reliefCapable = true;
  // The clearcoat + relief program is costly to shade. Views that only fly a
  // book (opening, closing) skip it unless the cover already has a relief; a
  // view that gets one later arms it then, once (setCoverRelief).
  // Shelf books need the same saved pigment mask as the lifted book. Keep
  // ordinary shelf materials cheap until a relief is actually selected.
  let reliefArmed = ((detail || Boolean(inspectionResolution)) && eagerRelief) || Boolean(book.coverRelief);
  const laminate = value => {
    applyCoverFinish(cover, value);
    if (reliefArmed && !cover.clearcoat) cover.clearcoat = COVER_CLEARCOAT_FLOOR;
  };
  const armRelief = () => {
    if (reliefArmed || !reliefCapable) return;
    reliefArmed = true;
    laminate(coverFinishValue);
    // Neutral 1x1 maps: clearcoat x1, roughness x1, metalness 0, flat normal.
    cover.clearcoatNormalMap = neutralTexture(128, 128, 255, 0);
    cover.clearcoatMap = cover.clearcoatRoughnessMap = cover.roughnessMap = cover.metalnessMap = neutralTexture(255, 255, 0);
    cover.needsUpdate = true;
  };
  let coverFinishValue = book.coverFinish;
  laminate(book.coverFinish);
  // Keep the broad studio reflection from washing out printed ink at an
  // oblique angle. Diffuse colour and direct lamp highlights are unchanged.
  applyBookReflectionSurface(cover, { seed:`${surfaceSeed}|cover`, strength:.018, environmentReflection:.75 });
  const reliefUniforms = installCoverRelief(cover);
  const setReliefBaseFinish = () => {
    const finish = SURFACE_FINISHES[surfaceFinish(coverFinishValue)];
    reliefUniforms.bookReliefBaseFinish.value.set(finish.clearcoat, finish.roughness, finish.clearcoatRoughness);
  };
  setReliefBaseFinish();
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
  // Fill depth with the opaque paper before shading the case beneath it.
  // Materials and geometry are unchanged; hidden physical fragments can now
  // fail the depth test, especially when the reading page fills the screen.
  pagePaper.renderOrder = -2;
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
  stockImage.renderOrder = -1;
  stockImage.visible = false; group.add(stockImage);
  let pageTheme = 1, themeTone = null, stockTone = null, installedRaster = null;
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
  group.userData.getPageTextures = () => stockImage.visible ? [...new Set([pageMaterial.map, stockMaterial.map])] : [pageMaterial.map];
  group.userData.setPageSnapshot = (snapshot, { pageTheme:initialTheme, redraw = true } = {}) => {
    if (disposed || !snapshot?.source) return false;
    const imageWidth = Number(snapshot.width || snapshot.source.width || snapshot.source.naturalWidth);
    const imageHeight = Number(snapshot.height || snapshot.source.height || snapshot.source.naturalHeight);
    if (!(imageWidth > 0 && imageHeight > 0)) return false;
    const variant = snapshot.paper?.source ? snapshot.paper : null;
    const sameSize = variant && Number(variant.width || variant.source.width) === imageWidth
      && Number(variant.height || variant.source.height) === imageHeight;
    const themeRaster = pageRaster(snapshot.source), stockRaster = sameSize && pageRaster(variant.source);
    // Fresh copies of one settled render contain identical pixels. Preserve
    // the already uploaded textures and geometry; bounds and locator metadata
    // still come from this new snapshot. DOM/unknown copies always rebuild.
    if (themeRaster && stockRaster && installedRaster?.theme === themeRaster
      && installedRaster.stock === stockRaster && installedRaster.width === imageWidth
      && installedRaster.height === imageHeight) {
      if (initialTheme != null) pageTheme = Math.max(0, Math.min(1, Number(initialTheme) || 0));
      applyPageTheme();
      group.userData.pageSnapshot = snapshot;
      if (redraw) group.userData.invalidate?.();
      return true;
    }
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
    stockMaterial.map?.dispose();
    if (sameSize) {
      stockImage.geometry.dispose(); stockImage.geometry = pageImage.geometry.clone();
      stockMaterial.map = themeRaster && themeRaster === stockRaster ? map : pageTexture(variant.source);
      stockMaterial.needsUpdate = true;
      stockImage.visible = true;
    } else {
      stockMaterial.map = blankPageMap();
      stockImage.visible = false; pageMaterial.opacity = 1;
    }
    if (initialTheme != null) pageTheme = Math.max(0, Math.min(1, Number(initialTheme) || 0));
    // Match the reader's snapshot; ordinary unthemed book paper stays white.
    themeTone = paperTone(snapshot.source, snapshot.toneKey);
    stockTone = sameSize ? paperTone(variant.source, variant.toneKey) : null;
    if (stockImage.visible) applyPageTheme();
    else if (themeTone) { pagePaper.material.color.copy(themeTone); leafPaper?.color.copy(themeTone).multiply(LEAF_LIGHT); }
    group.userData.pageSnapshot = snapshot;
    installedRaster = themeRaster && stockRaster ? {theme:themeRaster,stock:stockRaster,width:imageWidth,height:imageHeight} : null;
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
  let coverImageBounds = null, coverMaskSource = null;
  const reliefSource = () => {
    const printed = cover.map?.image;
    if (!printed || !coverImageBounds) return printed;
    if (coverMaskSource) return coverMaskSource;
    const { x, y, width, height } = coverImageBounds;
    if (x === 0 && y === 0 && width === printed.width && height === printed.height) return printed;
    const canvas = document.createElement('canvas'); canvas.width = printed.width; canvas.height = printed.height;
    const context = canvas.getContext('2d'); context.drawImage(printed, 0, 0);
    // The laminate still covers the whole board, but colour selection belongs
    // only to the printed image. Transparent margins cannot become a white/
    // cloth colour proposal or receive relief merely because their ink matches.
    context.clearRect(0, 0, canvas.width, y);
    context.clearRect(0, y + height, canvas.width, canvas.height - y - height);
    context.clearRect(0, y, x, height);
    context.clearRect(x + width, y, canvas.width - x - width, height);
    return coverMaskSource = canvas;
  };
  // ---- cover relief: raised and varnished zones selected by printed colour.
  // Only the portable colour/tolerance/strength choice is saved. Maps swap into slots the cover
  // material already compiled with: selecting a relief links no program.
  let wantedRelief = null, reliefRevision = 0, reliefMaps = null, reliefOwned = new Set();
  let reliefController = null, materialRevision = 0;
  const mapTexture = (rgba, width, height) => {
    // A canvas premultiplies transparent pixels and discards their RGB. The
    // normal's alpha stores mask=0 outside, where RGB must remain 128/128/255.
    // Raw pixels preserve those neutral normals with the same UV/filtering.
    const bytes = new Uint8Array(rgba.buffer, rgba.byteOffset, rgba.byteLength);
    const texture = new THREE.DataTexture(bytes, width, height);
    texture.flipY = true;
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.generateMipmaps = true;
    texture.anisotropy = 4;
    texture.needsUpdate = true;
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
  const reliefGain = strength => 3.5 * strength;
  const reliefKey = choice => choice.layers ? JSON.stringify(['layers',...coverReliefLayers(choice)
    .sort((a,b)=>a.color.localeCompare(b.color)).map(layer=>[layer.color,layer.tolerance])])
    : JSON.stringify([choice.id, choice.color ?? null, choice.tolerance ?? null]);
  const reliefStrengthKey=choice=>choice.layers?JSON.stringify(coverReliefLayers(choice)
    .sort((a,b)=>a.color.localeCompare(b.color)).map(layer=>layer.strength)):null;
  const applyReliefUniforms = () => {
    setReliefBaseFinish();
    reliefUniforms.bookReliefStrength.value = wantedRelief && reliefMaps ? (wantedRelief.layers?1:wantedRelief.strength) : 0;
    if (!wantedRelief || !reliefMaps) {
      cover.metalness = 0; cover.clearcoatNormalScale.set(1, 1);
      if (reliefArmed) laminate(coverFinishValue);
      return;
    }
    // Full clearcoat share: the map's red channel carries the laminate's own
    // share outside the varnished zones, so a matte board still gets gloss spots.
    // Varnish is a dielectric layer over unchanged printed ink, including
    // yellow ink. Colour selection never implies a metallic pigment.
    cover.clearcoat = 1; cover.metalness = 0;
    // Multicolour intensities are already encoded independently in the height
    // and finish pixels. A global scalar must not attenuate all other layers.
    cover.clearcoatNormalScale.setScalar(reliefGain(wantedRelief.layers?1:wantedRelief.strength));
  };
  async function bakeReliefMaterial(revision, maps = reliefMaps, signal) {
    if (!maps) return false;
    const ticket = ++materialRevision;
    const finishValue = coverSurfaceFinish, finish = SURFACE_FINISHES[finishValue];
    const rgba = await runInSlices(composeMaterialMap(maps.pixels, {
      clearcoat:finish.clearcoat, roughness:finish.roughness, clearcoatRoughness:finish.clearcoatRoughness
    }));
    if (revision !== reliefRevision || ticket !== materialRevision || signal?.aborted || disposed) return false;
    // A finish can change while the first colour map is still being built;
    // at that point there is no installed map for updateCoverAppearance to
    // rebake. Do not commit material pixels computed for the old laminate.
    if (finishValue !== coverSurfaceFinish) return bakeReliefMaterial(revision, maps, signal);
    const { width, height } = maps.size;
    adoptReliefTextures(maps.normalTexture, mapTexture(rgba, width, height));
    reliefMaps = maps;
    applyReliefUniforms();
    return true;
  }
  function clearRelief() {
    reliefMaps = null;
    materialRevision++;
    adoptReliefTextures(neutralTexture(128, 128, 255, 0), neutralTexture(255, 255, 0));
    applyReliefUniforms();
    group.userData.invalidate?.();
  }
  group.userData.coverRelief = () => normalizeCoverRelief(wantedRelief);
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
    const cached=reliefMaps && reliefMaps.key === reliefKey(next) && reliefMaps.source === reliefSource();
    if (cached && (!next.layers || reliefMaps.strengthKey===reliefStrengthKey(next))) {
      applyReliefUniforms(); group.userData.invalidate?.(); return true;
    }
    let built;
    try {
      await group.userData.ready;
      if (revision !== reliefRevision || disposed || controller.signal.aborted) return false;
      // The map uses the same fitted raster/UVs as the printed cover, including
      // any aspect-ratio margins. Analysing the unfitted source shifts masks.
      const source = reliefSource();
      if (!source) return false;
      built = cached ? await updateReliefMapStrengths(reliefMaps,next,{signal:controller.signal})
        : await buildReliefMaps(source, next, { maxSize: overview ? 128 : shelf && !inspectionResolution ? 256 : 512, signal: controller.signal });
      if (!built || revision !== reliefRevision || disposed || controller.signal.aborted) return false;
      const { width, height } = built.size;
      const normals = built.normal.slice();
      for (let i = 0; i < width * height; i++) {
        // Alpha is not used by a normal map. Keep the selection there so the
        // shader restores exact base-finish floats outside it (no byte-rounding
        // drift), without another texture, mesh, draw or shader variant.
        normals[i * 4 + 3] = built.pixels.mask?.[i]
          ?? Math.max(built.pixels.gloss[i], built.pixels.foil[i], built.pixels.heightMap?.[i] ?? 0);
      }
      built.normalTexture = mapTexture(normals, width, height);
      built.id = next.id; built.key = reliefKey(next); built.strengthKey=reliefStrengthKey(next); built.source = source;
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
  function updateCoverSource(url, nextBook = book, nextStyle = style, { force = false } = {}) {
    if (disposed) return Promise.resolve(false);
    if (!force && url && url === currentCoverUrl) return group.userData.ready;
    reliefController?.abort(); reliefRevision++;
    if (reliefArmed && reliefMaps) clearRelief();
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
    const replaceMap = (map, imageBounds = null) => {
      coverImageBounds = imageBounds; coverMaskSource = null;
      map.anisotropy = Math.min(16, renderer?.capabilities.getMaxAnisotropy() || 1);
      cover.map?.dispose(); cover.map = map; cover.needsUpdate = true;
    };
    if (!url) {
      releaseImage = () => {};
      replaceMap(coverTexture(nextBook, nextStyle, textureHeight, maxTextureDimension, level));
      setCoverGrain('cloth'); settle(true);
    } else releaseImage = acquireCoverImage(url, (image, entry) => {
      if (revision !== coverRevision || disposed) return;
      // The previous cover remains on the mesh until every new pixel is ready.
      try {
        const dimensions = coverRasterDimensions(nextStyle.coverRatio, textureHeight, maxTextureDimension);
        // The idle detailed model and its flyout print the same jacket. Keep
        // one bounded raster with the decoded image while shelf copies exist.
        // Each material owns a texture clone; pixels and Source stay exact.
        const key = JSON.stringify([dimensions.width, dimensions.height, nextBook.id,
          nextBook.title, nextStyle.color, level === 'overview']);
        const { map:fittedMap, bounds:fit } = reuseCoverRaster(level === 'detail' ? entry : null, key, () => {
          const canvas = document.createElement('canvas');
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
          return { map:fittedMap, bounds:fit };
        });
        replaceMap(fittedMap, fit); setCoverGrain('paper'); settle(true);
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
    disposed = true; reliefRevision++; materialRevision++; reliefMaps = null; coverMaskSource = null;
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
    const previous = ribbonMesh.geometry;
    ribbonMesh.geometry = bookmarkGeometry(width, height, thickness, bookmark.progress, bookmark.peek,
      { open:Math.max(0, Math.min(1, (coverOpening - .1) / .9)), withdraw:bookmarkWithdraw,
        segments:ribbonSegments, seed:ribbonSeed, geometry:previous });
    if (ribbonMesh.geometry !== previous) previous.dispose();
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
    if (!bookmark && ribbonMesh) {
      group.remove(ribbonMesh); ribbonMesh.geometry.dispose(); ribbonMaterial.alphaMap?.dispose(); ribbonMaterial.dispose();
      ribbonMesh = null; ribbonMaterial = null;
    }
    if (bookmark) {
      if (!ribbonMesh) {
        ribbonMaterial = satinRibbon(bookmark.finished, silk(), !detail);
        ribbonMesh = new THREE.Mesh(bookmarkGeometry(width, height, thickness, bookmark.progress, bookmark.peek,
          { segments:ribbonSegments, seed:ribbonSeed }), ribbonMaterial);
        ribbonMesh.renderOrder = 4; ribbonMesh.name = 'reading-bookmark'; group.add(ribbonMesh);
      } else {
        // Progress changes the same silk and bends its existing strip. Keep its
        // GPU material, alpha texture and buffers through the return animation.
        ribbonMaterial.metalness = bookmark.finished ? .16 : 0;
        tintRibbon(ribbonMaterial, silk(), !detail);
      }
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
  if (shelf && !overview) group.userData.preparePresentation = (idle, current = () => true) =>
    prepareBookPresentation(group, idle, () => !disposed && current());
  if (shelf && !overview) group.userData.prepareDetailPresentation = (idle, current = () => true) =>
    prepareBookDetailPresentation(() => createBookModel(book, style, width, height, thickness,
      coverUrl, { eagerRelief:false }), idle, () => !disposed && current());
  return group;
}

let renderer, studioEnvironment, presentationRenderer;
const presentationPreparations = new WeakMap();
const detailPresentationPreparations = new WeakMap();
const rendererSize = new THREE.Vector2();
export function getBookRenderer() {
  if (!globalThis.WebGLRenderingContext && !globalThis.WebGL2RenderingContext) return null;
  if (!renderer) {
    const studio = createStudioRenderer();
    if (!studio) return null;
    renderer = studio.renderer; studioEnvironment = studio.environment;
  }
  return renderer;
}

/** One persistent renderer presents the active flying book directly. Its
 * studio is generated in its own context: a PMREM texture has GPU-only image
 * data and cannot be uploaded into the shelf renderer's other context. */
export function getPresentationBookRenderer() {
  if (!globalThis.WebGLRenderingContext && !globalThis.WebGL2RenderingContext) return null;
  if (!presentationRenderer) {
    const studio = createStudioRenderer(true);
    if (!studio) return null;
    presentationRenderer = studio.renderer;
  }
  return presentationRenderer;
}

/** One warm reading-room rig for shelf, editor and opening/closing books.
 * The key matches the environment's window; shelf-lighting gives it shadows. */
export function lightBookScene(scene, activeRenderer = renderer) {
  scene.environment = studioEnvironmentFor(activeRenderer) || studioEnvironment;
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

/** Prepare the existing shelf book's exact shader variants in the flyout rig.
 * Borrow only its mesh/material references: no clone, texture upload, render,
 * parent change or presentation ownership is needed. Work begins after the
 * shelf has painted and stops between idle slices when its owner is busy. */
export async function prepareBookPresentation(model, idle, current = () => true) {
  if (typeof idle !== 'function' || typeof model?.traverse !== 'function') return false;
  await idle();
  if (!current()) return false;
  const gpu = getPresentationBookRenderer();
  if (!gpu || typeof gpu.compile !== 'function') return false;
  const existing = presentationPreparations.get(gpu);
  if (existing) return existing;
  const task = (async () => {
    const scene = lightBookScene(new THREE.Scene(), gpu);
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, .1, 10000);
    camera.position.z = 3000;
    const objects = { traverse:callback => model.traverse(callback), traverseVisible() {} };
    const materials = gpu.compile(objects, camera, scene);
    if (materials?.size) gpu.getContext?.()?.flush?.();
    // The borrowed materials can be culled or disposed before selection.
    // Pin the compiled programs using the renderer's existing bounded policy.
    if (Array.isArray(gpu.info?.programs)) retainPrograms(gpu);
    return prepareProgramUniforms(gpu, materials, { idle, current });
  })();
  presentationPreparations.set(gpu, task);
  try {
    const ready = await task;
    if (!ready && presentationPreparations.get(gpu) === task) presentationPreparations.delete(gpu);
    return ready;
  } catch (error) {
    if (presentationPreparations.get(gpu) === task) presentationPreparations.delete(gpu);
    throw error;
  }
}

/** The lifted model has its own grazing fade, paper normals and read leaves.
 * Prepare those real detail variants after the resting model, without drawing
 * or retaining an extra book. One temporary model per presentation context;
 * cancellation and driver failures release its owned rasters and geometry. */
export async function prepareBookDetailPresentation(build, idle, current = () => true) {
  if (typeof build !== 'function' || typeof idle !== 'function') return false;
  await idle();
  if (!current()) return false;
  const gpu = getPresentationBookRenderer();
  if (!gpu || typeof gpu.compile !== 'function') return false;
  const existing = detailPresentationPreparations.get(gpu);
  if (existing) return existing;
  const task = (async () => {
    const model = build();
    try {
      await model.userData.ready;
      if (!current()) return false;
      const scene = lightBookScene(new THREE.Scene(), gpu);
      const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, .1, 10000);
      camera.position.z = 3000;
      const objects = { traverse:callback => model.traverse(callback), traverseVisible() {} };
      const materials = gpu.compile(objects, camera, scene);
      if (materials?.size) gpu.getContext?.()?.flush?.();
      if (Array.isArray(gpu.info?.programs)) retainPrograms(gpu);
      return await prepareProgramUniforms(gpu, materials, { idle, current });
    } finally { model.userData.dispose(); }
  })();
  detailPresentationPreparations.set(gpu, task);
  try {
    const ready = await task;
    if (!ready && detailPresentationPreparations.get(gpu) === task) detailPresentationPreparations.delete(gpu);
    return ready;
  } catch (error) {
    if (detailPresentationPreparations.get(gpu) === task) detailPresentationPreparations.delete(gpu);
    throw error;
  }
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

// Shelf snapshots share one context. One additional persistent context presents
// the active flyout; both use the same meshes, textures and studio lighting.
let presentationOwner = null;
export function bookView(host, book, style, { width, height, thickness, viewportWidth, viewportHeight, centerX, centerY, coverUrl, shelf = false, shelfView = 'spine', initialPose, deferDraw = false, compactReturnFrame = false, directPresentation = true, adaptiveNativeFrame = false }) {
  const shared = getBookRenderer(); if (!shared) return null;
  const directCapable = directPresentation && !shelf && typeof shared.getContext === 'function';
  const gpu = directCapable ? getPresentationBookRenderer() || shared : shared;
  let directEnabled = directCapable && gpu !== shared;
  // Shelf books are static snapshots. Keep their framebuffer modest on phones
  // so a long library does not retain a pile of high-DPI canvases in memory.
  const requestedPixelRatio = typeof devicePixelRatio === 'number' ? devicePixelRatio : 1;
  const pixelRatio = shelf
    ? Math.min(requestedPixelRatio, window.innerWidth < 600 ? 1.5 : 2)
    : Math.min(requestedPixelRatio, 2);
  const canvas = document.createElement('canvas'); canvas.className = 'ihr-book-canvas'; canvas.setAttribute('aria-hidden', 'true');
  canvas.width = Math.ceil(viewportWidth * pixelRatio); canvas.height = Math.ceil(viewportHeight * pixelRatio);
  host.append(canvas); const context = canvas.getContext('2d');
  const scene = lightBookScene(new THREE.Scene(), gpu);
  let model = createBookModel(book, style, width, height, thickness, coverUrl, { shelf, eagerRelief:false }); scene.add(model);
  canvas.dataset.bookmark3d = String(Boolean(model.userData.hasBookmark));
  if (shelf) canvas.dataset.shelfView = shelfView;
  const camera = new THREE.OrthographicCamera(-viewportWidth / 2, viewportWidth / 2, viewportHeight / 2, -viewportHeight / 2, .1, 10000); camera.position.z = 3000;
  let disposed = false, current, cancel = () => {}, pendingModel = null, appearanceRevision = 0;
  let reliefPrepared = false, reliefPreparation = null;
  let currentBook = book, currentSnapshot = null, pageTheme = 1;
  const coverPaintKeyFor = (nextBook, nextStyle) => JSON.stringify([
    coverUrl,nextBook.id,nextBook.title,nextStyle.color,nextStyle.coverRatio,
    !coverUrl && [nextBook.author,nextStyle.ink,nextStyle.fontCanvasFamily,nextStyle.fontFamily,
      nextStyle.fontFallback,nextStyle.fontWeight]
  ]);
  let coverPaintKey = coverPaintKeyFor(book,style);
  let waitingForFirstDraw = deferDraw;
  const compactCamera = camera.clone(), compactBox = new THREE.Box3(), compactPoint = new THREE.Vector3();
  const compactWidth = Math.min(viewportWidth, Math.ceil(((width * 2 + thickness) * 1.25 + 64) / 64) * 64);
  const closedCompactWidth = Math.min(viewportWidth, Math.ceil(((width + thickness) * 1.25 + 64) / 64) * 64);
  const compactHeight = Math.min(viewportHeight, Math.ceil((height * 1.45 + 64) / 64) * 64);
  let copiedRectangle = null;
  let displayedFrame = null, snapshotDirty = false, live = false, suspendedHost = null;
  let displayedPose = null, visualRevision = 0, displayedRevision = -1;
  const invalidatePresentation = () => { displayedRevision = -1; };
  if (directEnabled) {
    gpu.domElement.addEventListener('webglcontextlost', invalidatePresentation);
    gpu.domElement.addEventListener('webglcontextrestored', invalidatePresentation);
  }
  let externalPresentation = null;
  const outputContext = canvas.getContext.bind(canvas);
  const outputURL = canvas.toDataURL.bind(canvas), outputBlob = canvas.toBlob.bind(canvas);
  let unregisterSnapshot;
  if (directEnabled) {
    // Keep the full-resolution export/overlay canvas API. Its pixels are
    // materialized only when a consumer requests them; animation frames go
    // straight to the compositor, without synchronously reading back the GPU.
    canvas.getContext = (type,...args) => { if (type === '2d') captureSnapshot(); return outputContext(type,...args); };
    canvas.toDataURL = (...args) => { captureSnapshot(); return outputURL(...args); };
    canvas.toBlob = (...args) => { captureSnapshot(); return outputBlob(...args); };
    unregisterSnapshot=registerLazySnapshot(canvas,captureSnapshot);
  }
  function copyRectangle(frame, pose) {
    const full = { x:0, y:0, width:canvas.width, height:canvas.height, full:true };
    // Preserve the existing resampling when logical and physical pixels do
    // not line up. Otherwise copy identical source pixels, without the large
    // transparent area around a flying book.
    if (![viewportWidth * pixelRatio, viewportHeight * pixelRatio,
      frame.x * pixelRatio, frame.y * pixelRatio, frame.width * pixelRatio,
      frame.height * pixelRatio].every(Number.isInteger)) return full;
    model.updateMatrixWorld(true); camera.updateMatrixWorld(true);
    compactBox.setFromObject(model);
    let left=Infinity, top=Infinity, right=-Infinity, bottom=-Infinity;
    for (const x of [compactBox.min.x,compactBox.max.x])
      for (const y of [compactBox.min.y,compactBox.max.y])
        for (const z of [compactBox.min.z,compactBox.max.z]) {
          compactPoint.set(x,y,z).project(camera);
          const px=(compactPoint.x+1)*viewportWidth/2, py=(1-compactPoint.y)*viewportHeight/2;
          left=Math.min(left,px); right=Math.max(right,px);
          top=Math.min(top,py); bottom=Math.max(bottom,py);
        }
    if (![left,top,right,bottom].every(Number.isFinite)) return full;
    // Includes displaced cover relief and antialiased edges, at the same
    // scale as the book. This does not crop the renderer or change its DPR.
    const margin=Math.max(8,48*Math.abs(pose.scale));
    const x=Math.max(0,frame.x*pixelRatio,Math.floor((left-margin)*pixelRatio));
    const y=Math.max(0,frame.y*pixelRatio,Math.floor((top-margin)*pixelRatio));
    const endX=Math.min(canvas.width,(frame.x+frame.width)*pixelRatio,Math.ceil((right+margin)*pixelRatio));
    const endY=Math.min(canvas.height,(frame.y+frame.height)*pixelRatio,Math.ceil((bottom+margin)*pixelRatio));
    return { x,y,width:Math.max(0,endX-x),height:Math.max(0,endY-y) };
  }
  function copyFrame(frame, full = false) {
    const rectangle=full ? {x:0,y:0,width:canvas.width,height:canvas.height,full:true} : copyRectangle(frame,current);
    if (copiedRectangle) context.clearRect(copiedRectangle.x,copiedRectangle.y,copiedRectangle.width,copiedRectangle.height);
    if (rectangle.full) {
      context.clearRect(0,0,canvas.width,canvas.height);
      if (frame.camera === camera) context.drawImage(gpu.domElement,0,0,canvas.width,canvas.height);
      else context.drawImage(gpu.domElement,frame.x*pixelRatio,(frame.y-(frame.paddingTop || 0))*pixelRatio);
    } else if (rectangle.width && rectangle.height) {
      context.drawImage(gpu.domElement,rectangle.x-frame.x*pixelRatio,rectangle.y-frame.y*pixelRatio+(frame.paddingTop || 0)*pixelRatio,
        rectangle.width,rectangle.height,rectangle.x,rectangle.y,rectangle.width,rectangle.height);
    }
    copiedRectangle=rectangle; snapshotDirty=false;
  }
  function configureFrame(frame) {
    gpu.getSize(rendererSize);
    // Keep only bounded transparent margins through the bookmark/cover phases.
    // The GL viewport retains its original size at the lower left. Positioning
    // and snapshot copies compensate the blank upper rows, without resampling.
    const paddedFrame = paddedBookFrameSize(frame, rendererSize, pixelRatio, gpu.domElement,
      directEnabled && compactReturnFrame && frame.camera !== camera &&
      typeof gpu.setViewport === 'function' && gpu.getPixelRatio() === pixelRatio);
    configureNativeRendererSize(gpu, paddedFrame.width, paddedFrame.height, pixelRatio, rendererSize, directEnabled, true, 'bounded');
    // A later full-width frame may need its viewport restored without a resize.
    gpu.setViewport?.(0, 0, frame.width, frame.height);
    frame.presentationWidth = paddedFrame.width;
    frame.presentationHeight = paddedFrame.height;
    frame.paddingTop = paddedFrame.height - frame.height;
  }
  function positionPresentation(frame) {
    const parent=canvas.parentElement?.parentElement;
    if (!parent) return;
    if (getComputedStyle(parent).position === 'static') parent.style.position='relative';
    const parentRect=parent.getBoundingClientRect(), rect=canvas.getBoundingClientRect();
    const scaleX=rect.width/viewportWidth, scaleY=rect.height/viewportHeight;
    const node=gpu.domElement;
    node.className='ihr-book-live-canvas'; node.setAttribute('aria-hidden','true');
    node.style.cssText=`position:absolute;pointer-events:none;left:${rect.left-parentRect.left+frame.x*scaleX}px;top:${rect.top-parentRect.top+(frame.y-(frame.paddingTop || 0))*scaleY}px;width:${(frame.presentationWidth ?? frame.width)*scaleX}px;height:${(frame.presentationHeight ?? frame.height)*scaleY}px`;
    if (node.parentNode !== parent) parent.append(node);
    canvas.style.opacity='0'; live=true;
  }
  const owner={
    suspend() { captureSnapshot(); canvas.style.opacity=''; live=false; },
    repaint() {
      if (!disposed && displayedFrame && live) { configureFrame(displayedFrame); gpu.render(scene,displayedFrame.camera); positionPresentation(displayedFrame); }
    }
  };
  function captureSnapshot() {
    if (externalPresentation?.lease) { externalPresentation.lease.capture(); return; }
    if (!snapshotDirty || !displayedFrame || disposed) return;
    const other=presentationOwner;
    withRendererPresentation(gpu,null,() => {
      if (!live || other !== owner) { configureFrame(displayedFrame); gpu.render(scene,displayedFrame.camera); }
      copyFrame(displayedFrame,true);
    });
    if (other && other !== owner) other.repaint();
  }
  // A shelf insertion owns its exact cached RGBA after its first successful
  // two-pass paint. Until then the existing closed flyout stays on screen.
  // The bridge never exposes a general-purpose bypass of book snapshots.
  function handoffToShelfInsertion(start) {
    if (disposed || externalPresentation || !directEnabled || !live ||
      presentationOwner !== owner || !displayedFrame || !canvas.isConnected || !context ||
      typeof start !== 'function') return null;
    const transaction = { lease:null, candidate:null, committed:false };
    externalPresentation = transaction;
    const bridge = {
      canvas, context,
      createLease(callbacks) {
        if (disposed || externalPresentation !== transaction || transaction.candidate) return null;
        transaction.candidate = createNativeRendererPresentation(shared, { ...callbacks, canvas, context });
        return transaction.candidate;
      },
      commit(lease) {
        if (disposed || externalPresentation !== transaction || transaction.candidate !== lease || !lease?.isOwner()) return false;
        transaction.lease = lease; transaction.committed = true;
        if (presentationOwner === owner) { gpu.domElement.remove(); presentationOwner = null; }
        canvas.style.opacity = '0'; live = false; directEnabled = false;
        return true;
      },
      cancel() {
        if (externalPresentation !== transaction) return;
        const stillOwnsFrame = transaction.candidate?.isOwner();
        transaction.candidate?.dispose({ snapshot:false });
        externalPresentation = null;
        // A failed first paint retains the existing native book. A later
        // cancellation explicitly restores that closed frame before fallback.
        if (transaction.committed && stillOwnsFrame && !disposed && (!presentationOwner || presentationOwner===owner)) {
          directEnabled = true;
          // A late appearance replacement may have been prepared, but never
          // drawn. Reapply the preserved closed pose before restoring it.
          draw(current);
        }
      },
      fallback() {
        bridge.cancel();
        if (!disposed) releaseToSnapshot();
        return context;
      }
    };
    try {
      const handle = start(bridge);
      if (!handle) { bridge.cancel(); return null; }
      return handle;
    } catch (error) { bridge.cancel(); throw error; }
  }
  function releaseToSnapshot({ resume = false } = {}) {
    captureSnapshot();
    if (presentationOwner === owner) { gpu.domElement.remove(); presentationOwner=null; }
    canvas.style.opacity=''; live=false;
    suspendedHost=resume ? canvas.parentElement : null;
    if (!resume) directEnabled=false;
  }
  let motionFrameCapacity = null;
  let nativeMotionHolds = 0, nativeMotionCapacity = null;
  // Keep the largest compact frame across hinge, ribbon and zoom phases.
  // It grows only when the real book needs more room, never to fill empty
  // screen space. Tokens do not draw or resize; normal frames apply it.
  function holdNativeMotionFrame() {
    if (disposed || !directEnabled || !compactReturnFrame || !adaptiveNativeFrame ||
        !Number.isInteger(pixelRatio) || !Number.isInteger(viewportWidth) || !Number.isInteger(viewportHeight)) return () => {};
    if (!nativeMotionHolds) nativeMotionCapacity = { width:displayedFrame?.width || 0, height:displayedFrame?.height || 0 };
    nativeMotionHolds++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      nativeMotionHolds = Math.max(0, nativeMotionHolds - 1);
      if (!nativeMotionHolds) nativeMotionCapacity = null;
    };
  }
  function positionModel(pose) {
    model.userData.setCoverOpen?.(Math.max(0, Math.min(1, pose.coverOpen ?? current?.coverOpen ?? 0)));
    model.userData.setBookmarkWithdraw?.(Math.max(0, Math.min(1, pose.bookmarkWithdraw ?? current?.bookmarkWithdraw ?? 0)));
    model.position.set(centerX - viewportWidth / 2 + pose.x, viewportHeight / 2 - centerY - pose.y, 0);
    model.rotation.set((pose.pitch ?? 0) * Math.PI / 180, pose.angle * Math.PI / 180, (pose.roll ?? 0) * Math.PI / 180);
    model.scale.setScalar(pose.scale);
  }
  function returnFrame(pose, measureOnly = false) {
    const full = { x:0, y:0, width:viewportWidth, height:viewportHeight, camera };
    // Legacy zoom keeps the full viewport. Native compact windows preserve
    // pixel resolution; optional adaptive mode selects padded 64px buckets
    // from every visible mesh. Geometry that cannot fit keeps the full frame.
    if (!compactReturnFrame || (pose.scale > 1.05 && !directEnabled) || !Number.isInteger(pixelRatio)
      || !Number.isInteger(viewportWidth) || !Number.isInteger(viewportHeight)) return full;
    model.updateMatrixWorld(true); camera.updateMatrixWorld(true);
    let left=Infinity, top=Infinity, right=-Infinity, bottom=-Infinity;
    const adaptive = adaptiveNativeFrame && directEnabled;
    if (adaptive) {
      // Project each visible mesh before forming the screen bounds. A world
      // axis-aligned box includes hidden pages and the withdrawn ribbon, and
      // can keep most of a native framebuffer empty throughout the flight.
      model.traverseVisible(mesh => {
        const material=mesh.material;
        if (!mesh.isMesh || !mesh.geometry || !material || (Array.isArray(material)
          ? !material.some(each=>each && each.visible !== false) : material.visible === false)) return;
        if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
        const bounds = mesh.geometry.boundingBox;
        if (!bounds) { left=top=NaN; return; }
        for (let xi=0;xi<2;xi++) for (let yi=0;yi<2;yi++) for (let zi=0;zi<2;zi++) {
          compactPoint.set(xi?bounds.max.x:bounds.min.x,yi?bounds.max.y:bounds.min.y,zi?bounds.max.z:bounds.min.z)
            .applyMatrix4(mesh.matrixWorld).project(camera);
          const px=(compactPoint.x+1)*viewportWidth/2, py=(1-compactPoint.y)*viewportHeight/2;
          left=Math.min(left,px); right=Math.max(right,px); top=Math.min(top,py); bottom=Math.max(bottom,py);
        }
      });
    } else {
      compactBox.setFromObject(model);
      for (const x of [compactBox.min.x, compactBox.max.x])
        for (const y of [compactBox.min.y, compactBox.max.y])
          for (const z of [compactBox.min.z, compactBox.max.z]) {
            compactPoint.set(x,y,z).project(camera);
            const px=(compactPoint.x+1)*viewportWidth/2, py=(1-compactPoint.y)*viewportHeight/2;
            left=Math.min(left,px); right=Math.max(right,px); top=Math.min(top,py); bottom=Math.max(bottom,py);
          }
    }
    // Include every board, page edge and ribbon, with room for displaced relief.
    // Unusual poses use the full buffer instead of clipping any part of the book.
    if (![left,top,right,bottom].every(Number.isFinite)) return full;
    // Geometry outside the viewport is already clipped by the full frame.
    left=Math.max(0,left); top=Math.max(0,top); right=Math.min(viewportWidth,right); bottom=Math.min(viewportHeight,bottom);
    let frameWidth = adaptive ? Math.min(viewportWidth,Math.ceil((right-left+48)/64)*64)
      : current.coverOpen === 0 ? closedCompactWidth : compactWidth;
    let frameHeight = adaptive ? Math.min(viewportHeight,Math.ceil((bottom-top+48)/64)*64) : compactHeight;
    // Reserve the flight's largest compact window once, rather than resetting
    // the native framebuffer at every 64px boundary. The camera still follows
    // the exact projected book at its original DPR. Unexpected bounds can grow
    // this reservation, never clip geometry or reduce resolution.
    if (adaptive && motionFrameCapacity && !measureOnly) {
      motionFrameCapacity.width = frameWidth = Math.max(frameWidth, motionFrameCapacity.width);
      motionFrameCapacity.height = frameHeight = Math.max(frameHeight, motionFrameCapacity.height);
    }
    if (adaptive && nativeMotionCapacity) {
      frameWidth = Math.max(frameWidth, nativeMotionCapacity.width);
      frameHeight = Math.max(frameHeight, nativeMotionCapacity.height);
      if (!measureOnly) {
        nativeMotionCapacity.width = frameWidth;
        nativeMotionCapacity.height = frameHeight;
      }
    }
    if (adaptive && frameWidth===viewportWidth && frameHeight===viewportHeight) return full;
    if (right<left || bottom<top
      || frameWidth<viewportWidth && right-left+48>frameWidth
      || frameHeight<viewportHeight && bottom-top+48>frameHeight) return full;
    const x=frameWidth===viewportWidth ? 0 : Math.round((left+right-frameWidth)/2);
    const y=frameHeight===viewportHeight ? 0 : Math.round((top+bottom-frameHeight)/2);
    if (measureOnly) return { x,y,width:frameWidth,height:frameHeight };
    compactCamera.copy(camera);
    compactCamera.setViewOffset(viewportWidth,viewportHeight,x,y,frameWidth,frameHeight);
    return { x,y,width:frameWidth,height:frameHeight,camera:compactCamera };
  }

  function draw(pose, { redraw = true } = {}) {
    if (disposed) return;
    visualRevision++;
    if (externalPresentation) return;
    if (!redraw && snapshotDirty) captureSnapshot();
    if (pose.pageTheme != null) pageTheme = Math.max(0, Math.min(1, Number(pose.pageTheme) || 0));
    current = { ...pose, coverOpen:Math.max(0, Math.min(1, pose.coverOpen ?? current?.coverOpen ?? 0)),
      bookmarkWithdraw:Math.max(0, Math.min(1, pose.bookmarkWithdraw ?? current?.bookmarkWithdraw ?? 0)), pageTheme };
    model.userData.setPageTheme?.(pageTheme, false);
    positionModel(current);
    // Hidden setup changes geometry and page projection without copying frames.
    // The first explicit draw commits the complete, correctly aligned page.
    if (!redraw) return;
    waitingForFirstDraw = false;
    const frame = returnFrame(pose);
    const present=directEnabled && canvas.isConnected && canvas.parentElement !== suspendedHost &&
      [viewportWidth*pixelRatio,viewportHeight*pixelRatio,frame.x*pixelRatio,frame.y*pixelRatio,
        frame.width*pixelRatio,frame.height*pixelRatio].every(Number.isInteger);
    if (present && presentationOwner !== owner) { presentationOwner?.suspend(); presentationOwner=owner; }
    const previousOwner=present ? null : presentationOwner;
    if (!present && presentationOwner === owner) { owner.suspend(); gpu.domElement.remove(); presentationOwner=null; }
    configureFrame(frame);
    model.traverse(object => {
      for (const material of [].concat(object.material || [])) {
        for (const key of ['map', 'roughnessMap', 'metalnessMap', 'bumpMap']) {
          const map = material[key];
          if (map) map.anisotropy = Math.min(16, gpu.capabilities.getMaxAnisotropy());
        }
      }
    });
    withRendererPresentation(gpu,null,() => {
      gpu.render(scene, frame.camera);
      displayedFrame=frame; snapshotDirty=true;
      displayedPose={ ...current }; displayedRevision=visualRevision;
      if (present) positionPresentation(frame);
      else { copyFrame(frame); canvas.style.opacity=''; live=false; }
    });
    if (!present && previousOwner && previousOwner !== owner) previousOwner.repaint();
    canvas.dataset.angle = String(pose.angle); canvas.dataset.renderer = 'three-mesh';
    canvas.dataset.coverOpen = String(current.coverOpen);
    canvas.dataset.pageTheme = String(pageTheme);
    canvas.dataset.bookmarkWithdraw = String(current.bookmarkWithdraw);
    canvas.dataset.boardBounds = JSON.stringify(projectBookBoardBounds(model,camera,viewportWidth,viewportHeight));
  }
  model.userData.invalidate = () => current && !waitingForFirstDraw && draw(current);
  // Lifted books reveal hidden materials mid-motion (the inside of the board,
  // the page). Queue every program now, not in the middle of the opening.
  // three only issues compile/link here and waits for a program on its first
  // draw, so hidden ones build in the background (in parallel where
  // KHR_parallel_shader_compile exists). compileAsync adds nothing to that,
  // and its polling throws if the flyout is closed before a program is ready.
  if (!shelf) try { compilePagePrograms(gpu, scene, camera); } catch { /* compiled lazily on first use */ }
  draw(initialPose ?? {
    x:0, y:0, scale:1,
    angle:shelf ? (shelfView === 'isometric' ? 76 : 90) : 0,
    pitch:shelf && shelfView === 'isometric' ? 9 : 0
  }, { redraw:!deferDraw });
  // Appearance completion can arrive while the opening book is still detached.
  // Apply its current pose, retaining the first explicit framebuffer commit.
  const drawUpdatedAppearance = () => current && draw(current, { redraw:!waitingForFirstDraw });
  function updateAppearance(nextStyle, { reuseModel = false } = {}) {
    if (disposed) return false;
    // Editor previews already changed the cover/edges. Flush their last spine
    // choice into the same model; retain page, ribbon and material ownership.
    // Cold/failed covers and outstanding full replacements keep their original
    // lifecycle. A decoded image (or generated case) can repaint synchronously.
    if (reuseModel && !pendingModel && model.userData.coverLoaded === true) {
      const nextCoverKey = coverPaintKeyFor(currentBook,nextStyle);
      const invalidate = model.userData.invalidate;
      model.userData.invalidate = null;
      try {
        model.userData.updateSpineAppearance(currentBook,nextStyle);
        if (nextCoverKey !== coverPaintKey) {
          model.userData.updateCoverSource(coverUrl,currentBook,nextStyle,{ force:true });
          if (model.userData.coverLoaded === true) coverPaintKey = nextCoverKey;
        }
      } finally { model.userData.invalidate = invalidate; }
      drawUpdatedAppearance();
      return true;
    }
    const replacementCoverKey = coverPaintKeyFor(currentBook,nextStyle);
    const revision = ++appearanceRevision;
    pendingModel?.userData.dispose();
    const replacement = createBookModel(currentBook, nextStyle, width, height, thickness, coverUrl, { shelf, eagerRelief:reliefPrepared });
    pendingModel = replacement;
    const replace = () => {
      if (disposed || revision !== appearanceRevision) { replacement.userData.dispose(); return; }
      const previous = model;
      scene.remove(previous); model = replacement; pendingModel = null;
      coverPaintKey = replacementCoverKey;
      canvas.dataset.bookmark3d = String(Boolean(model.userData.hasBookmark));
      scene.add(model);
      model.userData.invalidate = () => current && !waitingForFirstDraw && draw(current);
      if (currentSnapshot) model.userData.setPageSnapshot(currentSnapshot);
      drawUpdatedAppearance();
      previous.userData.dispose();
    };
    if (replacement.userData.coverLoaded) replace();
    else replacement.userData.ready.then(replace);
    return true;
  }
  /** Upgrade a parked reader model without replacing its page or GPU programs.
   * This explicit return-only operation never presents a partly decoded cover. */
  async function prepareReturnAppearance(nextBook,nextStyle,nextCoverUrl) {
    const geometry = { width,height,thickness,viewportWidth,viewportHeight,centerX,centerY };
    const compatible = bookReturnCompatibility(currentBook,style,geometry);
    if (disposed || pendingModel || externalPresentation || model.userData.coverLoaded !== true || !compatible ||
        compatible !== bookReturnCompatibility(nextBook,nextStyle,geometry)) return false;
    waitingForFirstDraw = true;
    updateBookmark(nextBook);
    const target = model, revision = ++appearanceRevision;
    const active = () => !disposed && model === target && !pendingModel && revision === appearanceRevision;
    try {
      const spineChanged = JSON.stringify(style) !== JSON.stringify(nextStyle);
      currentBook = { ...currentBook,...nextBook };
      if (spineChanged) target.userData.updateSpineAppearance(currentBook,nextStyle);
      coverUrl = nextCoverUrl;
      const nextCoverKey = coverPaintKeyFor(currentBook,nextStyle);
      if (nextCoverKey !== coverPaintKey) {
        if (await target.userData.updateCoverSource(coverUrl,currentBook,nextStyle,{ force:true }) !== true || !active()) return false;
        if (currentBook.coverRelief && await target.userData.setCoverRelief(currentBook.coverRelief) !== true) return false;
      }
      if (!active()) return false;
      coverPaintKey = nextCoverKey; style = nextStyle;
      return true;
    } catch { return false; }
  }
  function updateSpineAppearance(nextBook, nextStyle) {
    if (disposed) return false;
    currentBook = { ...currentBook, ...nextBook };
    pendingModel?.userData.updateSpineAppearance?.(nextBook, nextStyle);
    model.userData.updateSpineAppearance?.(nextBook, nextStyle);
    drawUpdatedAppearance();
    return true;
  }
  function updateMaterialAppearance(nextBook, method, options) {
    if (disposed) return false;
    currentBook = { ...currentBook, ...nextBook };
    // Only the editor's explicit batch defers a synchronous paint. Existing
    // callers, including null or ignored extra arguments, still draw by default.
    const redraw = options?.redraw !== false;
    const targets = [pendingModel, model].filter(Boolean);
    const invalidations = redraw ? [] : targets.map(target => [target, target.userData.invalidate, Object.hasOwn(target.userData, 'invalidate')]);
    for (const [target] of invalidations) target.userData.invalidate = null;
    try {
      for (const target of targets) target.userData[method]?.(nextBook);
    } finally {
      // Late cover/relief completion must retain its real callback. Restore
      // captured targets even if a synchronous mutation throws or disposes us.
      for (const [target, invalidate, own] of invalidations) {
        if (own) target.userData.invalidate = invalidate;
        else delete target.userData.invalidate;
      }
    }
    if (redraw) drawUpdatedAppearance();
    return true;
  }
  function updateCoverAppearance(nextBook, options) {
    return updateMaterialAppearance(nextBook, 'updateCoverAppearance', options);
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
      drawUpdatedAppearance();
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
    if (!disposed) drawUpdatedAppearance();
    return results.some(Boolean);
  }
  function updateEdgeAppearance(nextBook, options) {
    return updateMaterialAppearance(nextBook, 'updateEdgeAppearance', options);
  }
  function updateEditorAppearance(nextBook) {
    if (disposed) return false;
    // Apply the complete latest record to both materials before presenting it.
    // One conservative paint also covers changes made outside this editor input.
    updateCoverAppearance(nextBook, { redraw:false });
    updateEdgeAppearance(nextBook, { redraw:false });
    if (disposed) return false;
    drawUpdatedAppearance();
    return true;
  }
  function updateBookmark(nextBook, options) {
    if (disposed) return false;
    const changed = JSON.stringify(bookmarkFor(currentBook)) !== JSON.stringify(bookmarkFor(nextBook));
    currentBook = { ...currentBook, ...nextBook };
    if (changed) {
      visualRevision++;
      const targets = [pendingModel, model].filter(Boolean);
      const invalidations = options?.redraw === false ? targets.map(target =>
        [target, target.userData.invalidate, Object.hasOwn(target.userData, 'invalidate')]) : [];
      for (const [target] of invalidations) target.userData.invalidate = null;
      try { for (const target of targets) target.userData.updateBookmark?.(nextBook); }
      finally {
        for (const [target, invalidate, own] of invalidations) {
          if (own) target.userData.invalidate = invalidate;
          else delete target.userData.invalidate;
        }
      }
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
  // With no ribbon, only its logical withdrawal changes. Keep the motion's
  // clock and state, but retain the identical already presented native frame.
  const bookmarkPoseKeys = ['x','y','scale','angle','pitch','roll','coverOpen','pageTheme'];
  // A retained native frame is usable only while its model, exact painted
  // pose and context still belong to this view. Unknown states redraw.
  function hasCurrentNativeFrame(pose, keys) {
    if (disposed || externalPresentation || waitingForFirstDraw || !displayedFrame || pendingModel ||
      displayedRevision !== visualRevision || pageTheme !== (pose.pageTheme ?? pageTheme) ||
      !directEnabled || !live || presentationOwner !== owner || !gpu.domElement.isConnected || !canvas.isConnected ||
      keys.some(key => (pose[key] ?? current?.[key] ?? 0) !== (current?.[key] ?? 0) ||
        (pose[key] ?? 0) !== (displayedPose?.[key] ?? 0))) return false;
    try { const context = gpu.getContext?.(); if (!context || context.isContextLost?.()) return false; }
    catch { return false; }
    return true;
  }
  /** Commit an already painted page before opening. False keeps the caller's
   * original draw, including interrupted warm-up and mutable legacy output. */
  function commitPreparedPage(snapshot, { pageTheme:targetTheme = pageTheme } = {}) {
    if (!snapshot || currentSnapshot !== snapshot || !current) return false;
    const pose = { ...current, pageTheme:targetTheme };
    if (!hasCurrentNativeFrame(pose, [...bookmarkPoseKeys, 'bookmarkWithdraw'])) return false;
    // A consumer may have painted the export canvas since its last capture.
    // Retain native pixels now and materialize those pixels on the next export.
    snapshotDirty = true;
    positionPresentation(displayedFrame);
    return true;
  }
  function updateBookmarkFrame(pose) {
    const absent = target => target?.userData.hasBookmark === false &&
      typeof target.getObjectByName === 'function' && !target.getObjectByName('reading-bookmark');
    if (!absent(model) || !hasCurrentNativeFrame(pose, bookmarkPoseKeys)) return false;
    const amount = Math.max(0, Math.min(1, Number(pose.bookmarkWithdraw) || 0));
    current = { ...current, bookmarkWithdraw:amount };
    model.userData.setBookmarkWithdraw?.(amount);
    snapshotDirty = true;
    const value = String(amount);
    if (canvas.dataset.bookmarkWithdraw !== value) canvas.dataset.bookmarkWithdraw = value;
    if (directEnabled) positionPresentation(displayedFrame);
    return true;
  }
  function animateBookmark({ withdraw = 1, duration = 360 } = {}) {
    const origin = { ...current };
    return animateMotion([{ transform:origin }, { transform:{ ...origin, bookmarkWithdraw:withdraw } }],
      { duration, onFrame:updateBookmarkFrame });
  }
  // `pageTheme` (0 = white stock, 1 = the reader's own theme; default 1) is where the
  // page's colour starts: the book opens and closes on white paper.
  function setPageSnapshot(snapshot, { pageTheme:initialTheme, redraw = !waitingForFirstDraw } = {}) {
    if (initialTheme != null) {
      pageTheme = Math.max(0, Math.min(1, Number(initialTheme) || 0));
      if (current) current = { ...current, pageTheme };
    }
    // bookView owns its one framebuffer commit. The model's invalidation must
    // not render the same page again before the explicit draw below.
    if (disposed || !model.userData.setPageSnapshot(snapshot, { pageTheme, redraw:false })) return false;
    currentSnapshot = snapshot; visualRevision++;
    pendingModel?.userData.setPageSnapshot(snapshot, { pageTheme, redraw:false });
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
  function compilePage() { if (!disposed) try { return compilePagePrograms(gpu, scene, camera); } catch { /* linked on first draw */ } }
  async function preparePagePrograms(idle, current = () => true) {
    const materials = compilePage();
    try { return await prepareProgramUniforms(gpu, materials, { idle, current:() => !disposed && current() }); }
    catch { return false; /* Drivers without reflection retain the original first draw. */ }
  }
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
  function animateMotion(frames, { duration, onFrame }) {
    cancel();
    if (current) frames = [{ ...frames[0], transform: current }, ...frames.slice(1)];
    if (duration > 0 && !onFrame && directEnabled && compactReturnFrame && adaptiveNativeFrame &&
        Number.isInteger(pixelRatio) && Number.isInteger(viewportWidth) && Number.isInteger(viewportHeight)) {
      const capacity = { width:0,height:0 };
      try {
        // These are geometry-only probes: no draw, GPU allocation, snapshot or
        // animation-clock advancement. Actual frames retain the original sampler.
        for (let i=0;i<=16;i++) {
          const pose=sampleBookMotion(frames,i/16); positionModel(pose);
          const frame=returnFrame(pose,true);
          capacity.width=Math.max(capacity.width,frame.width);
          capacity.height=Math.max(capacity.height,frame.height);
        }
        motionFrameCapacity=capacity;
      } finally { if (current) positionModel(current); }
    }
    let raf, resolve; const finished = new Promise(r => resolve = r);
    cancel = () => { cancelAnimationFrame(raf); motionFrameCapacity=null; resolve(); };
    let lastFrame = performance.now(), elapsed = 0;
    const animation = { finished, cancel, lastFrameTime:lastFrame };
    // Real time, so a slow device finishes each phase on schedule instead of
    // stretching it frame by frame. A stalled frame on a phone GPU may absorb
    // at most 100 ms (a fifth of a hinge opening), never half a phase, so the
    // board and ribbon never visibly jump. The first step only covers the
    // frame that scheduled the motion.
    const maxStep = Math.max(48, Math.min(100, duration / 2));
    let started = false;
    const tick = () => {
      if (disposed) { motionFrameCapacity=null; return resolve(); }
      // RAF's shared frame timestamp can precede a gesture delivered after a
      // slow draw. Measure when this callback actually runs, on the same clock
      // that started the motion, so its first painted pose advances too.
      const now = performance.now();
      elapsed += Math.min(started ? maxStep : 48, Math.max(0, now - lastFrame)); lastFrame = now; started = true;
      const t = duration > 0 ? Math.min(1, elapsed / duration) : 1;
      const pose = sampleBookMotion(frames, t);
      if (!onFrame?.(pose)) draw(pose);
      animation.lastFrameTime = performance.now();
      if (t < 1) raf = requestAnimationFrame(tick); else { motionFrameCapacity=null; resolve(); }
    };
    raf = requestAnimationFrame(tick); return animation;
  }
  return { canvas, get ready() { return (pendingModel || model).userData.ready; }, draw,
    deferDrawing() { if (!disposed) waitingForFirstDraw = true; }, releaseToSnapshot, handoffToShelfInsertion,
    setCompactReturnFrame(enabled) { compactReturnFrame = Boolean(enabled); }, holdNativeMotionFrame,
    updateAppearance, prepareReturnAppearance, updateSpineAppearance, updateCoverAppearance, prepareCoverRelief, setCoverRelief, updateEdgeAppearance, updateEditorAppearance, updateBookmark,
    setPageSnapshot, commitPreparedPage, pageTextures, uploadPageTexture, compilePage, preparePagePrograms, hasPageSnapshot:snapshot => Boolean(snapshot) && currentSnapshot === snapshot,
    setPageTheme, animatePageTheme, getPageTheme:() => pageTheme,
    getPageBounds, getPose:() => ({ ...current }), setBookmarkWithdraw,
    animateCoverOpen, animateCoverClose, animateBookmark, alignToPage, animateToPage,
    animate:animateMotion,
    dispose(removeCanvas = true) { cancel(); nativeMotionHolds = 0; nativeMotionCapacity = null; if (!removeCanvas) captureSnapshot();
      unregisterSnapshot?.();
      gpu.domElement.removeEventListener('webglcontextlost', invalidatePresentation);
      gpu.domElement.removeEventListener('webglcontextrestored', invalidatePresentation);
      externalPresentation?.candidate?.dispose({ snapshot:false }); externalPresentation = null;
      if (presentationOwner === owner) { gpu.domElement.remove(); presentationOwner=null; }
      if (!removeCanvas) canvas.style.opacity=''; live=false; disposed = true;
      pendingModel?.userData.dispose(); model.userData.dispose(); if (removeCanvas) canvas.remove(); } };
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
