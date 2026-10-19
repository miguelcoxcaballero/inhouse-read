import {createBookProjectionPacket,projectVisibleBookBounds} from './book-projection.js';
import {createBookMotionSampler} from './book-motion.js';
import { paddedBookFrameSize } from './book-frame-padding.js';
import { boxScreenBounds, fitImage, frameAligned, planBookPose, planBookView, planCopyRectangle, planPageBounds,
  planPageZoom, planReadingPose, planReturnFrame } from './book-view-wasm.js';
import { getRustCore, loadedRustCore } from './rust-core.js';
import { needRustShelf } from './rust-shelf.js';

import { rustBookSurfacePixels, rustRibbonNotchPixels } from './book-surface-wasm.js';
import { rustBookmarkBuffers } from './bookmark-wasm.js';
import { rustBindingBuffers } from './binding-wasm.js';
import { rustPageBlockBuffers, rustLeafStackBuffers, rustBookPaperBuffers } from './page-mesh-wasm.js';
import { reuseCoverRaster } from './cover-raster-cache.js';
import {acquireCoverImage} from './book-cover-images.js';
import { paperToneKey, readPaperTone } from './page-paper-tone.js';
import { bookReturnCompatibility } from './bookshelf-return.js';
import * as THREE from 'three';
import { createStudioRenderer, studioEnvironmentFor } from './studio-renderer.js';
import { configureNativeRendererSize } from './native-renderer-size.js';
import { spineSurface, releaseSurface, seededRandom, textSeed, paintCloth, paintWeave, spineLayout, drawDevice, lattice } from './spine-surface.js';
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

// The shelf renders only after requireRustCore() (app.js): every model is built with the core in.
const rustCore = () => getRustCore() ?? loadedRustCore();

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
// The woven-cloth and printed-paper tooth, and the swallowtail cut, are produced by the numeric core.
function tileNormals(kind) {
  const data = rustBookSurfacePixels(rustCore(), kind);
  if (!data) throw new Error('El módulo numérico no pudo generar la textura del libro.');
  const texture = new THREE.DataTexture(data, 128, 128);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter; texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true; texture.needsUpdate = true;
  return texture;
}
// Plain-weave book cloth: 16 × 16 threads per tile, with uneven slubs.
const clothNormals = () => tileNormals('cloth');
// Printed paper over board: the soft tooth that survives under a laminate.
const paperNormals = () => tileNormals('paper');
// Swallowtail cut, measured in ribbon widths from the tip (v = 0 at the tip):
// a shallow V, a fifth of the width deep, as scissors leave it.
const ribbonNotch = () => {
  const w = 16, h = 64, data = rustRibbonNotchPixels(rustCore(), w, h);
  if (!data) throw new Error('El módulo numérico no pudo generar la muesca de la cinta.');
  const texture = new THREE.DataTexture(data, w, h);
  texture.magFilter = texture.minFilter = THREE.LinearFilter; texture.needsUpdate = true;
  return texture;
};

// Page edges: individual leaves, darker signature folds, a slight cockle and a silk headband.
// u runs across the leaves (tiled by physical thickness); v .02–.46 is the fore-edge, .54–.98
// head and tail (spine side at .98). Painted by the shelf module (rust-ui/src/book_paint.rs).
function pageEdgeAtlas(size) {
  const canvas = Object.assign(document.createElement('canvas'), { width:size, height:size });
  needRustShelf().book_page_edges(canvas.getContext('2d'), size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace; texture.wrapS = THREE.RepeatWrapping;
  return texture;
}

// Endpaper: a white wove stock with a faint speckle and a few long fibres.
// White-based so the material colour tints it; every stroke wraps the tile.
function endpaperTexture() {
  const size = 256, canvas = Object.assign(document.createElement('canvas'), { width:size, height:size });
  needRustShelf().book_endpaper(canvas.getContext('2d'));
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace; texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

// Numeric Rust meshes own their arrays; install them without another copy.
function paperMeshGeometry(buffers) {
  if (!buffers) return null;
  const geometry = new THREE.BufferGeometry();
  for (const [name, array, size] of [['position', buffers.positions, 3], ['normal', buffers.normals, 3],
    ['uv', buffers.uvs, 2], ['color', buffers.colors, 3]]) {
    geometry.setAttribute(name, new THREE.BufferAttribute(array, size));
  }
  geometry.setIndex(new THREE.BufferAttribute(buffers.indices, 1));
  for (const group of buffers.groups) geometry.addGroup(group.start, group.count, group.materialIndex);
  return geometry;
}

/** Text block of a rounded-and-backed binding: its back follows the round
 * inside the case, the fore-edge is concave, both ends are one crescent. */
export function pageBlockGeometry(width, height, thickness, { board = height * .007, inset = height * .009, detail = false } = {}) {
  const geometry = paperMeshGeometry(rustPageBlockBuffers(rustCore(), width, height, thickness, { board, inset, detail }));
  if (!geometry) throw new RangeError('Medidas de bloque de páginas no válidas.');
  return geometry;
}

/** Leaves already read turn over with the front board as one gathering: a
 * block on the board's inner face whose top leaf curls down into the gutter.
 * Hinge coordinates (joint at x = 0, board centred on z = 0); the open face
 * looks toward -z until the board turns over. Only lifted copies build it. */
export function leafStackGeometry(width, height, depth, { board = height * .007, inset = height * .009, columns = 14 } = {}) {
  const geometry = paperMeshGeometry(rustLeafStackBuffers(rustCore(), width, height, depth, { board, inset, columns }));
  if (!geometry) throw new RangeError('Medidas de pila de hojas no válidas.');
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
  const buffers = rustBindingBuffers(rustCore(), width, height, thickness, segments, relief, reliefRows);
  if (!buffers) throw new RangeError('Medidas de lomo no válidas.');
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(buffers.positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(buffers.normals, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(buffers.uvs, 2));
  geometry.setIndex(new THREE.BufferAttribute(buffers.indices, 1));
  if (buffers.normalVersion) geometry.getAttribute('normal').needsUpdate = true;
  return geometry;
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
  { open = 0, withdraw = 0, segments = 32, seed = 0, geometry: target, legacy = false } = {}) {
  const pixels = rustBookmarkBuffers(rustCore(), width, height, thickness, progress, peek, open, withdraw, segments, seed, legacy);
  if (!pixels) throw new RangeError('Medidas de cinta no válidas.');
  // Opening and withdrawing only bend the ribbon; its topology stays fixed.
  // Keep the same GPU buffers during the flight instead of deleting and
  // uploading a new indexed mesh on every frame.
  const reuse = target?.getAttribute('position')?.count === pixels.positions.length / 3
    && target.getAttribute('uv')?.count === pixels.uvs.length / 2 && target.index?.count === pixels.indices.length;
  const geometry = reuse ? target : new THREE.BufferGeometry();
  if (reuse) {
    geometry.getAttribute('position').array.set(pixels.positions);
    geometry.getAttribute('uv').array.set(pixels.uvs);
    geometry.getAttribute('position').needsUpdate = true;
    geometry.getAttribute('uv').needsUpdate = true;
    geometry.boundingBox = geometry.boundingSphere = null;
  } else {
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(pixels.positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(pixels.uvs, 2));
    geometry.setIndex(new THREE.Uint16BufferAttribute(pixels.indices, 1));
  }
  const normal = geometry.getAttribute('normal');
  if (normal?.count === pixels.normals.length / 3) normal.array.set(pixels.normals);
  else geometry.setAttribute('normal', new THREE.Float32BufferAttribute(pixels.normals, 3));
  geometry.getAttribute('normal').needsUpdate = true;
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

export const fitCoverImage = fitImage;

function coverRasterDimensions(ratio, textureHeight, maxDimension = Infinity) {
  const height = textureHeight, width = Math.max(1, Math.round(height * (Number(ratio) || .66)));
  const scale = Math.min(1, maxDimension / Math.max(width, height));
  return { width:Math.max(1, Math.round(width * scale)), height:Math.max(1, Math.round(height * scale)) };
}

const coverSeed = (book, style, salt) => seededRandom(textSeed(`${book?.shelfVisualId ?? book?.id ?? ''}|${book?.title ?? ''}|${style?.color}|${salt}`));

// Wear that belongs to the board rather than the artwork, drawn in design
// units (1024 = board height) over printed and cloth covers alike.
const finishBoard = (c, designWidth, random, { wear = true } = {}) => needRustShelf().book_finish_board(c, designWidth, random, wear);

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
  // The panel, lettering, rule and device are the shelf module's (rust-ui/src/book_paint.rs).
  // The publisher's device is the spine's own mark when the case has one, otherwise one of the
  // same family, per book.
  const family = `"${style.fontCanvasFamily || style.fontFamily || 'Playfair Display'}", ${style.fontFallback || 'Georgia, serif'}`;
  const device = thumb ? -1 : spineLayout(book).device ?? textSeed(`device|${book?.shelfVisualId ?? book?.id ?? ''}|${book?.title ?? ''}`) % 3;
  needRustShelf().book_cover_case(c, designWidth, displayBookTitle(book) || 'Sin título', String(normalizeBookAuthor(book.author) || ''),
    style.ink, style.fontWeight, family, thumb, device, drawDevice, random);
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
  const ribbonSegments = overview ? 8 : 32, ribbonSeed = textSeed(`ribbon|${book?.shelfVisualId ?? book?.id ?? ''}|${book?.title ?? ''}`) || 1;
  const detail = !shelf && !overview, level = group.userData.detailLevel, ratio = width / height;
  const surfaceSeed = String(book?.shelfVisualId ?? book?.id ?? book?.path ?? book?.title ?? 'book');
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
  const paperBuffers = rustBookPaperBuffers(rustCore(), pasteWidth, pasteHeight,
    width - height * .009 * 2, height - height * .009 * 2, height * .009, overview);
  if (!paperBuffers) throw new RangeError('Medidas de guardas no válidas.');
  const pasteGeometry = paperMeshGeometry(paperBuffers.pastedown);
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
    needRustShelf().book_thumbnail_pages(canvas.getContext('2d'));
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
  const paperGeometry = paperMeshGeometry(paperBuffers.paper);
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
  // The saved rasters remain resident for reopening, but are completely
  // occluded by the opaque closed board. Hide only their common parent so
  // snapshot/theme flags and texture uploads keep their existing contracts.
  const pagePrint = new THREE.Group();
  pagePrint.name = 'reading-page-print'; pagePrint.visible = false; group.add(pagePrint);
  const pageMaterial = new THREE.MeshBasicMaterial({ color:0xffffff, toneMapped:false, map:blankPageMap(), transparent:true });
  const pageImage = new THREE.Mesh(new THREE.PlaneGeometry(pageWidth, pageHeight), pageMaterial);
  pageImage.name = 'reading-page';
  pageImage.position.set(inset * .3, 0, pageFront + board * .02);
  pageImage.visible = false; pagePrint.add(pageImage);
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
  stockImage.visible = false; pagePrint.add(stockImage);
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
        : await buildReliefMaps(source, next, { maxSize: overview ? 128 : shelf && !inspectionResolution ? 256 : 512, selectionAlpha: true, signal: controller.signal });
      if (!built || revision !== reliefRevision || disposed || controller.signal.aborted) return false;
      const { width, height } = built.size;
      const normals = built.normalSelectionAlpha ? built.normal : built.normal.slice();
      for (let i = 0; !built.normalSelectionAlpha && i < width * height; i++) {
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
    // Font arrival/editor changes replace pixels, not the renderer's sampling quality.
    surface.map.anisotropy = previous.map.anisotropy;
    surface.channels.anisotropy = previous.channels.anisotropy;
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
  let ribbonBatch = 0, ribbonDirty = false;
  group.userData.setCoverOpen = amount => {
    const next = Math.max(0, Math.min(1, amount));
    frontCover.rotation.y = -Math.PI * .94 * next;
    if (overview) frontBoard.material = next > 0 ? frontMaterials : cover;
    // Closed shelf books need neither the occluded paper plane nor the
    // cover's inner material submitted to the GPU on every shelf repaint.
    pagePaper.visible = pagePrint.visible = next > 0;
    insideCover.visible = pastedown.visible = next > 0;
    if (readLeaves) readLeaves.visible = next > 0;
    if (Math.abs(next - coverOpening) > .00001) { coverOpening = next; updateRibbonGeometry(); }
  };
  function updateRibbonGeometry() {
    if (ribbonBatch) { ribbonDirty = true; return; }
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
  // Both properties describe one displayed pose. Build its ribbon once,
  // after both values settle, rather than constructing an invisible midpoint.
  group.userData.setMotionPose = (opening, withdrawal) => {
    ribbonBatch++;
    try {
      group.userData.setCoverOpen(opening);
      group.userData.setBookmarkWithdraw(withdrawal);
    } finally {
      ribbonBatch--;
      if (!ribbonBatch && ribbonDirty) { ribbonDirty = false; updateRibbonGeometry(); }
    }
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
  return planPageBounds(width, height, viewportWidth, viewportHeight, offset, page.matrixWorld.elements, camera);
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
  const zoom = bounds && planPageZoom(bounds, target, offset, centerX, centerY, origin);
  if (!zoom) return null;
  return { ...origin, x:zoom.x, y:zoom.y, scale:zoom.scale, angle:0, pitch:0, roll:0, coverOpen:1, bookmarkWithdraw:1 };
}

/** Fit the whole open spread, rather than cropping its left board on phones. */
export function planReadingBookPose({ width, height, thickness = 0,
  viewportWidth, viewportHeight, centerX, centerY }) {
  const { x, y, scale } = planReadingPose(width, height, thickness, viewportWidth, viewportHeight, centerX, centerY);
  return { x, y, scale, angle:0, pitch:0, roll:0, coverOpen:1, bookmarkWithdraw:0 };
}

export function projectBookBoardBounds(model,camera,viewportWidth,viewportHeight) {
  const boxes=[];
  model.updateWorldMatrix(true,true); camera.updateMatrixWorld();
  for (const name of ['front-cover','back-cover','binding']) {
    const mesh=model.getObjectByName(name);
    if (!mesh?.geometry) continue;
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
    const {min,max}=mesh.geometry.boundingBox;
    boxes.push({min,max,matrix:mesh.matrixWorld.elements});
  }
  const [left,top,right,bottom]=boxScreenBounds(boxes,camera,viewportWidth,viewportHeight);
  return {left,top,width:right-left,height:bottom-top};
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
  const sizes = planBookView({ shelf, devicePixelRatio: globalThis.devicePixelRatio,
    innerWidth: window.innerWidth, viewportWidth, viewportHeight, width, height, thickness });
  const pixelRatio = sizes.pixelRatio;
  const canvas = document.createElement('canvas'); canvas.className = 'ihr-book-canvas'; canvas.setAttribute('aria-hidden', 'true');
  canvas.width = sizes.canvasWidth; canvas.height = sizes.canvasHeight;
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
  const projectionPacket = createBookProjectionPacket();
  const { compactWidth, closedCompactWidth, compactHeight } = sizes;
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
  // The book's screen bounds from its world box: every board, page edge and ribbon.
  function compactBounds() {
    model.updateMatrixWorld(true); camera.updateMatrixWorld(true);
    compactBox.setFromObject(model);
    return boxScreenBounds([{ min:compactBox.min, max:compactBox.max }], camera, viewportWidth, viewportHeight);
  }
  // Preserve the existing resampling when logical and physical pixels do not line
  // up. Otherwise copy identical source pixels, without the large transparent area
  // around a flying book. The core decides which, margins included.
  function copyRectangle(frame, pose) {
    return planCopyRectangle({ viewportWidth, viewportHeight, ratio:pixelRatio, canvasWidth:canvas.width,
      canvasHeight:canvas.height, frame, scale:pose.scale }, compactBounds)
      ?? { x:0, y:0, width:canvas.width, height:canvas.height, full:true };
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
  function placeModel(placed) {
    if (model.userData.setMotionPose) model.userData.setMotionPose(placed.opening, placed.withdrawal);
    else { model.userData.setCoverOpen?.(placed.opening); model.userData.setBookmarkWithdraw?.(placed.withdrawal); }
    model.position.set(placed.x, placed.y, 0);
    model.rotation.set(placed.rotationX, placed.rotationY, placed.rotationZ);
    model.scale.setScalar(placed.scale);
  }
  const positionModel = pose => placeModel(planBookPose(pose, current, centerX, centerY, viewportWidth, viewportHeight, pageTheme));
  function returnFrame(pose, measureOnly = false) {
    const full = { x:0, y:0, width:viewportWidth, height:viewportHeight, camera };
    // Legacy zoom keeps the full viewport. Native compact windows preserve
    // pixel resolution; optional adaptive mode selects padded 64px buckets
    // from every visible mesh. Geometry that cannot fit keeps the full frame.
    // The core decides, and keeps the capacities a flight reserves.
    const adaptive = adaptiveNativeFrame && directEnabled;
    const placement = planReturnFrame({ compact:compactReturnFrame, direct:directEnabled, adaptive:adaptiveNativeFrame, measureOnly,
      scale:pose.scale, ratio:pixelRatio, viewportWidth, viewportHeight, coverOpen:current?.coverOpen,
      closedWidth:closedCompactWidth, openWidth:compactWidth, height:compactHeight,
      motion:motionFrameCapacity, native:nativeMotionCapacity }, () => {
      if (!adaptive) return compactBounds();
      model.updateMatrixWorld(true); camera.updateMatrixWorld(true);
      // Project each visible mesh before forming the screen bounds. A world
      // axis-aligned box includes hidden pages and the withdrawn ribbon, and
      // can keep most of a native framebuffer empty throughout the flight.
      return projectVisibleBookBounds(model,camera,viewportWidth,viewportHeight,compactPoint,projectionPacket);
    });
    if (!placement) return full;
    if (measureOnly) return placement;
    compactCamera.copy(camera);
    compactCamera.setViewOffset(viewportWidth,viewportHeight,placement.x,placement.y,placement.width,placement.height);
    return { ...placement, camera:compactCamera };
  }

  function draw(pose, { redraw = true } = {}) {
    if (disposed) return;
    visualRevision++;
    if (externalPresentation) return;
    if (!redraw && snapshotDirty) captureSnapshot();
    const placed = planBookPose(pose, current, centerX, centerY, viewportWidth, viewportHeight, pageTheme);
    pageTheme = placed.pageTheme;
    current = { ...pose, coverOpen:placed.opening, bookmarkWithdraw:placed.withdrawal, pageTheme };
    model.userData.setPageTheme?.(pageTheme, false);
    placeModel(placed);
    // Hidden setup changes geometry and page projection without copying frames.
    // The first explicit draw commits the complete, correctly aligned page.
    if (!redraw) return;
    waitingForFirstDraw = false;
    const frame = returnFrame(pose);
    const present=directEnabled && canvas.isConnected && canvas.parentElement !== suspendedHost &&
      frameAligned(viewportWidth,viewportHeight,pixelRatio,frame.x,frame.y,frame.width,frame.height);
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
    const sampler=createBookMotionSampler(frames);
    if (duration > 0 && !onFrame && directEnabled && compactReturnFrame && adaptiveNativeFrame &&
        Number.isInteger(pixelRatio) && Number.isInteger(viewportWidth) && Number.isInteger(viewportHeight)) {
      const capacity = { width:0,height:0 };
      try {
        // These are geometry-only probes: no draw, GPU allocation, snapshot or
        // animation-clock advancement. Actual frames retain the original sampler.
        for (let i=0;i<=16;i++) {
          const pose=sampler.sample(i/16); positionModel(pose);
          const frame=returnFrame(pose,true);
          capacity.width=Math.max(capacity.width,frame.width);
          capacity.height=Math.max(capacity.height,frame.height);
        }
        motionFrameCapacity=capacity;
      } catch(error) { sampler.dispose(); throw error; }
      finally { if (current) positionModel(current); }
    }
    let raf, resolve; const finished = new Promise(r => resolve = r);
    cancel = () => { cancelAnimationFrame(raf); sampler.dispose(); motionFrameCapacity=null; resolve(); };
    const lastFrame = performance.now();
    const animation = { finished, cancel, lastFrameTime:lastFrame };
    // Real time, so a slow device finishes each phase on schedule instead of
    // stretching it frame by frame. A stalled frame on a phone GPU may absorb
    // at most 100 ms (a fifth of a hinge opening), never half a phase, so the
    // board and ribbon never visibly jump. The first step only covers the
    // frame that scheduled the motion. The clock itself is the core's.
    sampler.start(duration, lastFrame);
    const tick = () => {
      if (disposed) { sampler.dispose(); motionFrameCapacity=null; return resolve(); }
      // RAF's shared frame timestamp can precede a gesture delivered after a
      // slow draw. Measure when this callback actually runs, on the same clock
      // that started the motion, so its first painted pose advances too.
      const t = sampler.step(performance.now());
      const pose = sampler.sample(t);
      if (!onFrame?.(pose)) draw(pose);
      animation.lastFrameTime = performance.now();
      if (t < 1) raf = requestAnimationFrame(tick); else { sampler.dispose(); motionFrameCapacity=null; resolve(); }
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

export { sampleBookMotion } from './book-motion.js';
