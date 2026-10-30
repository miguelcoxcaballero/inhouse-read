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
import { spineSurface, releaseSurface, seededRandom, paintCloth, paintWeave, drawDevice } from './spine-surface.js';
import { METAL_COLORS, SURFACE_FINISHES, spineFinish, surfaceFinish } from './book-colors.js';
import { displayBookTitle, normalizeBookAuthor } from './book-title.js';
import { pageRaster } from './page-raster.js';
import { bookmarkFor } from './bookshelf-layout.js';
import { applyBookReflectionSurface, rememberedPatch } from './book-reflection-surface.js';
import { compilePagePrograms, prepareProgramUniforms, retainPrograms } from './gpu-programs.js';
import { buildReliefMaps, composeMaterialMap, coverReliefLayers, normalizeCoverRelief, updateReliefMapStrengths } from './cover-relief.js';
import { runInSlices } from './cover-appearance.js';
import { registerCanvasSnapshot as registerLazySnapshot, createNativeRendererPresentation,
  withRendererPresentation } from './native-renderer-presentation.js';

// The shelf renders only after requireRustCore() (app.js): every model is built with the core in.
const rustCore = () => getRustCore() ?? loadedRustCore();

// Procedural micro-detail shared by every book: generated once, uploaded once (book_shared_texture).
// Models receive clones (same Source, own repeat); three.js keeps the GPU
// texture until the last clone is disposed, so every model owns its copy.
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

// Numeric Rust meshes own their arrays; the shelf module installs them without another copy.
const paperMeshGeometry = buffers => needRustShelf().book_paper_mesh(THREE, buffers);

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

// The case: both boards (rounded edges, cover UVs on the faces, the bevel inside the book's dimensions)
// and both half-ellipse ends of the binding, each array built once by the shelf module
// (rust-ui/src/book_case.rs) and installed by rust-ui/src/book_model_build.rs. The front board's faces
// come split into outside (0) and inside (2) groups.
/** The case of a model on its own (createBookModel installs the same four): the front board with its
 * outside/inside groups, the back board, and the tail and head ends of the binding. */
export function bookCaseGeometries(width, height, board, thickness, { shelf = false, overview = false, segments, rim = 0 }) {
  return needRustShelf().book_case_geometries(THREE, width, height, board, thickness, shelf, overview, segments, rim);
}

// Seen almost edge-on (the lifted book's front view), spine lettering shrinks
// into bright slivers along the rolled edge. Only while the spine as a whole
// faces away, the surface that turns from the viewer shows plain cloth; the
// rules near the joint, which still face the viewer, keep their ink.
// The shader text of this fade, the cover relief below and the reflection layer is the shelf module's
// (rust-ui/src/book_shaders.rs), patched once per program variant.
const spineFadePatches = new Map(), reliefPatches = new Map();
function spineGrazingFade(material) {
  const uniforms = { spineCloth:{ value:new THREE.Color() }, spineClothMetal:{ value:0 }, spineClothRough:{ value:.88 } };
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, uniforms);
    const { vertexShader, fragmentShader } = shader;
    const [vertex, fragment] = rememberedPatch(spineFadePatches, [vertexShader, fragmentShader],
      () => needRustShelf().book_spine_fade_shaders(vertexShader, fragmentShader));
    shader.vertexShader = vertex; shader.fragmentShader = fragment;
  };
  material.customProgramCacheKey = () => 'spine-grazing-fade';
  return (book, style) => {
    const finish = spineFinish(book.spineFinish);
    uniforms.spineCloth.value.set(finish === 'matte' ? style.color : METAL_COLORS[finish]);
    uniforms.spineClothMetal.value = finish === 'matte' ? 0 : 1;
    uniforms.spineClothRough.value = SURFACE_FINISHES[surfaceFinish(book.spineSurfaceFinish, 'matte')].roughness;
  };
}

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
  // The physical chunk as it is when the relief is installed, patched once per chunk text.
  const chunk = THREE.ShaderChunk.lights_physical_fragment;
  const physical = rememberedPatch(reliefPatches, ['physical', chunk], () => needRustShelf().book_relief_physical(chunk));
  material.onBeforeCompile = function(shader, renderer) {
    previousHook.call(this, shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    const { fragmentShader } = shader, maps = THREE.ShaderChunk.clearcoat_normal_fragment_maps;
    shader.fragmentShader = rememberedPatch(reliefPatches, ['fragment', fragmentShader, physical, maps],
      () => needRustShelf().book_cover_relief_fragment(fragmentShader, physical, maps));
  };
  material.customProgramCacheKey = () => `${previousKey}|cover-relief-color-v2`;
  return uniforms;
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
  return needRustShelf().book_board_geometry(THREE, width, height, depth, shelf, overview);
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

// Woven satin ribbons: binders stock a handful of classic silk dyes. Each book draws one that stands
// clear of its own cloth (claret most often); finished books keep the old-gold silk. The dye, the
// material and its sheen are the shelf module's (rust-ui/src/book_surface_policy.rs).
const ribbonColorHost = { hex:value => new THREE.Color(value).getHex() };
export function ribbonSilk(seed, cloth, finished = false) {
  return needRustShelf().book_ribbon_silk(seed,cloth,Boolean(finished),ribbonColorHost);
}

// The paper the reader shows: the median of the snapshot's outer ring, so the
// leaves already read and the margin around the saved page are one stock.
const paperColorHost = { read:readPaperTone,
  color:(r,g,b) => new THREE.Color().setRGB(r,g,b,THREE.SRGBColorSpace) };
function paperTone(source, toneKey) {
  return needRustShelf().book_paper_color(paperToneKey(source,toneKey),source,toneKey,paperColorHost);
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
const toneScratch = { a:{}, b:{}, rgb:new Float64Array(6) };
const paperMixHost = {
  read(stock,theme) {
    const a = stock.getRGB(toneScratch.a,THREE.SRGBColorSpace), b = theme.getRGB(toneScratch.b,THREE.SRGBColorSpace);
    const rgb = toneScratch.rgb;
    rgb[0] = a.r; rgb[1] = a.g; rgb[2] = a.b; rgb[3] = b.r; rgb[4] = b.g; rgb[5] = b.b;
    return rgb;
  },
  write:(target,r,g,b) => target.setRGB(r,g,b,THREE.SRGBColorSpace)
};
export function mixPaperTone(target, stock, theme, mix) {
  return needRustShelf().book_paper_mix(target,stock,theme,mix,paperMixHost);
}

export const fitCoverImage = fitImage;

function shelfSpineSurface(book, style, height, thickness, shelf, overview, inspectionResolution = 0) {
  return spineSurface(book, style, height, thickness, needRustShelf().book_spine_options(height,
    Boolean(shelf), Boolean(overview), inspectionResolution, typeof devicePixelRatio === 'number' ? devicePixelRatio : 1));
}

// One book: the shelf module assembles its meshes, materials and textures and owns its page snapshot,
// appearance updates, cover source, relief slots and disposal (rust-ui/src/book_model_build.rs), all over
// one plain state object `s`. What stays here runs every frame of a flight (the pose setters below), the
// asynchronous relief bake, and the adapters the module calls back. Shelf and lifted copies of a book
// overlap during a transition: book-cover-images keeps the decoded image alive for exactly that overlap.
export function createBookModel(book, style, width, height, thickness, coverUrl,
  { shelf = false, overview = false, inspectionResolution = 0, eagerRelief = true } = {}) {
  return needRustShelf().book_model_create(modelHost(), book, style, width, height, thickness, coverUrl,
    shelf, overview, inspectionResolution, eagerRelief);
}

// ---- per frame: the board's opening, the ribbon and the page's paper ---------------------------------
function setCoverOpen(s, amount) {
  const next = Math.max(0, Math.min(1, amount));
  s.frontCover.rotation.y = -Math.PI * .94 * next;
  if (s.overview) s.frontBoard.material = next > 0 ? s.frontMaterials : s.cover;
  // Closed shelf books need neither the occluded paper plane nor the
  // cover's inner material submitted to the GPU on every shelf repaint.
  s.pagePaper.visible = s.pagePrint.visible = next > 0;
  s.insideCover.visible = s.pastedown.visible = next > 0;
  if (s.readLeaves) s.readLeaves.visible = next > 0;
  if (Math.abs(next - s.coverOpening) > .00001) { s.coverOpening = next; updateRibbonGeometry(s); }
}
function updateRibbonGeometry(s) {
  if (s.ribbonBatch) { s.ribbonDirty = true; return; }
  if (!s.ribbonMesh || !s.bookmark) return;
  const previous = s.ribbonMesh.geometry;
  s.ribbonMesh.geometry = bookmarkGeometry(s.width, s.height, s.thickness, s.bookmark.progress, s.bookmark.peek,
    { open:Math.max(0, Math.min(1, (s.coverOpening - .1) / .9)), withdraw:s.bookmarkWithdraw,
      segments:s.ribbonSegments, seed:s.ribbonSeed, geometry:previous });
  if (s.ribbonMesh.geometry !== previous) previous.dispose();
  s.ribbonMesh.visible = s.bookmarkWithdraw < .999;
}
function setBookmarkWithdraw(s, amount) {
  const next = Math.max(0, Math.min(1, Number(amount) || 0));
  if (Math.abs(next - s.bookmarkWithdraw) > .00001) { s.bookmarkWithdraw = next; updateRibbonGeometry(s); }
}
// Both properties describe one displayed pose. Build its ribbon once,
// after both values settle, rather than constructing an invisible midpoint.
function setMotionPose(s, opening, withdrawal) {
  s.ribbonBatch++;
  try {
    s.group.userData.setCoverOpen(opening);
    s.group.userData.setBookmarkWithdraw(withdrawal);
  } finally {
    s.ribbonBatch--;
    if (!s.ribbonBatch && s.ribbonDirty) { s.ribbonDirty = false; updateRibbonGeometry(s); }
  }
}
function setPageTheme(s, mix, redraw = true) {
  if (s.disposed) return false;
  const next = Math.max(0, Math.min(1, Number.isFinite(Number(mix)) ? Number(mix) : 1));
  const changed = next !== s.pageTheme;
  s.pageTheme = next;
  if (!s.stockImage.visible) return false;
  applyPageTheme(s);
  if (changed && redraw) s.group.userData.invalidate?.();
  return true;
}
// Transparent for the whole life of a variant (never toggled while it is on screen: that would recompile
// the program mid-opening); at opacity 1 the blend is exactly the opaque result.
function applyPageTheme(s) {
  const faded = s.stockImage.visible;
  s.pageMaterial.opacity = faded ? s.pageTheme : 1;
  const tone = faded ? mixPaperTone(s.paperScratch, s.stockTone, s.themeTone, s.pageTheme) : s.themeTone;
  if (tone) { s.pagePaper.material.color.copy(tone); s.leafPaper?.color.copy(tone).multiply(LEAF_LIGHT); }
}

// ---- cover relief: the asynchronous bake of the maps the shelf module installs -----------------------
const reliefKey = choice => choice.layers ? JSON.stringify(['layers',...coverReliefLayers(choice)
  .sort((a,b)=>a.color.localeCompare(b.color)).map(layer=>[layer.color,layer.tolerance])])
  : JSON.stringify([choice.id, choice.color ?? null, choice.tolerance ?? null]);
const reliefStrengthKey=choice=>choice.layers?JSON.stringify(coverReliefLayers(choice)
  .sort((a,b)=>a.color.localeCompare(b.color)).map(layer=>layer.strength)):null;
async function bakeReliefMaterial(s, revision, maps = s.reliefMaps, signal) {
  if (!maps) return false;
  const ticket = ++s.materialRevision;
  const finishValue = s.coverSurfaceFinish, finish = SURFACE_FINISHES[finishValue];
  const rgba = await runInSlices(composeMaterialMap(maps.pixels, {
    clearcoat:finish.clearcoat, roughness:finish.roughness, clearcoatRoughness:finish.clearcoatRoughness
  }));
  if (revision !== s.reliefRevision || ticket !== s.materialRevision || signal?.aborted || s.disposed) return false;
  // A finish can change while the first colour map is still being built;
  // at that point there is no installed map for updateCoverAppearance to
  // rebake. Do not commit material pixels computed for the old laminate.
  if (finishValue !== s.coverSurfaceFinish) return bakeReliefMaterial(s, revision, maps, signal);
  const { width, height } = maps.size, rust = needRustShelf();
  rust.book_model_adopt_relief(s, maps.normalTexture, rust.book_model_map_texture(THREE, rgba, width, height));
  s.reliefMaps = maps;
  rust.book_model_relief_uniforms(s);
  return true;
}
/** Apply (or clear, with null) a relief choice. Resolves true once drawn. */
async function setCoverRelief(s, relief) {
  if (s.disposed) return false;
  s.reliefController?.abort();
  const controller = s.reliefController = new AbortController();
  const next = normalizeCoverRelief(relief), revision = ++s.reliefRevision, rust = needRustShelf();
  s.wantedRelief = next;
  if (!next) { if (s.reliefArmed) rust.book_model_clear_relief(s); return true; }
  rust.book_model_arm_relief(s);
  // Only installed maps may be reused. A pending bake owns no cached state.
  const cached=s.reliefMaps && s.reliefMaps.key === reliefKey(next) && s.reliefMaps.source === rust.book_model_relief_source(s);
  if (cached && (!next.layers || s.reliefMaps.strengthKey===reliefStrengthKey(next))) {
    rust.book_model_relief_uniforms(s); s.group.userData.invalidate?.(); return true;
  }
  let built;
  try {
    await s.group.userData.ready;
    if (revision !== s.reliefRevision || s.disposed || controller.signal.aborted) return false;
    // The map uses the same fitted raster/UVs as the printed cover, including
    // any aspect-ratio margins. Analysing the unfitted source shifts masks.
    const source = rust.book_model_relief_source(s);
    if (!source) return false;
    built = cached ? await updateReliefMapStrengths(s.reliefMaps,next,{signal:controller.signal})
      : await buildReliefMaps(source, next, { maxSize: s.overview ? 128 : s.shelf && !s.inspectionResolution ? 256 : 512, selectionAlpha: true, signal: controller.signal });
    if (!built || revision !== s.reliefRevision || s.disposed || controller.signal.aborted) return false;
    const { width, height } = built.size;
    const normals = built.normalSelectionAlpha ? built.normal : built.normal.slice();
    for (let i = 0; !built.normalSelectionAlpha && i < width * height; i++) {
      // Alpha is not used by a normal map. Keep the selection there so the
      // shader restores exact base-finish floats outside it (no byte-rounding
      // drift), without another texture, mesh, draw or shader variant.
      normals[i * 4 + 3] = built.pixels.mask?.[i]
        ?? Math.max(built.pixels.gloss[i], built.pixels.foil[i], built.pixels.heightMap?.[i] ?? 0);
    }
    built.normalTexture = rust.book_model_map_texture(THREE, normals, width, height);
    built.id = next.id; built.key = reliefKey(next); built.strengthKey=reliefStrengthKey(next); built.source = source;
    if (!await bakeReliefMaterial(s, revision, built, controller.signal)) {
      built.normalTexture.dispose(); return false;
    }
    s.group.userData.invalidate?.();
    return true;
  } catch {
    if (built?.normalTexture && !s.reliefOwned.has(built.normalTexture)) built.normalTexture.dispose();
    return false;
  }
}

// What the shelf module calls back: three, the painters, the rust-core meshes and the asynchronous parts.
let modelHostObject;
function modelHost() {
  return modelHostObject ||= {
    three:THREE, rust:needRustShelf(), noop:() => {},
    finish:(value, fallback) => SURFACE_FINISHES[surfaceFinish(value, fallback)], surfaceFinish, normalizeRelief:normalizeCoverRelief,
    reflect:applyBookReflectionSurface, spine:shelfSpineSurface, releaseSurface, spineFade:spineGrazingFade, installRelief:installCoverRelief,
    clothNormals, paperNormals, endpaperTexture, pageEdgeAtlas, ribbonNotch,
    paperBuffers:(...args) => rustBookPaperBuffers(rustCore(), ...args),
    pageBlock:pageBlockGeometry, leafStack:leafStackGeometry, binding:bindingGeometry, bookmark:bookmarkGeometry, bookmarkFor,
    silkHost:ribbonColorHost, leafLight:LEAF_LIGHT, pageRaster, fit:fitCoverImage, paperTone, applyPageTheme,
    acquire:acquireCoverImage, reuse:reuseCoverRaster, random:seededRandom, paintCloth, paintWeave, drawDevice,
    title:displayBookTitle, author:normalizeBookAuthor, anisotropy:() => renderer?.capabilities.getMaxAnisotropy() || 1,
    pageTheme:setPageTheme, getPageTheme:s => s.pageTheme, coverRelief:s => normalizeCoverRelief(s.wantedRelief),
    setCoverRelief, rebake:(s, revision) => { bakeReliefMaterial(s, revision).then(done => { if (done) s.group.userData.invalidate?.(); }); },
    coverOpen:setCoverOpen, bookmarkWithdraw:setBookmarkWithdraw, motionPose:setMotionPose, ribbonGeometry:updateRibbonGeometry,
    preparePresentation:(s, idle, current = () => true) => prepareBookPresentation(s.group, idle, () => !s.disposed && current()),
    prepareDetailPresentation:(s, idle, current = () => true) => prepareBookDetailPresentation(() => createBookModel(s.book, s.style,
      s.width, s.height, s.thickness, s.coverUrl, { eagerRelief:false }), idle, () => !s.disposed && current())
  };
}

let renderer, studioEnvironment, presentationRenderer;
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
// A pale ceiling, a muted floor bounce, the warm key matching the environment's window, a cool fill and
// a strip that travels over foil and clearcoat (rust-ui/src/book_model_build.rs).
export function lightBookScene(scene, activeRenderer = renderer) {
  return needRustShelf().book_light_scene(THREE, scene, studioEnvironmentFor(activeRenderer) || studioEnvironment);
}

// Three owns scene construction and compilation; Rust owns idle sequencing,
// per-renderer deduplication, cancellation/retry and the temporary model lifetime.
let presentationPreparationHost;
function preparationHost() {
  const rust = needRustShelf();
  return presentationPreparationHost ||= {
    getRenderer:getPresentationBookRenderer, retainPrograms, prepareProgramUniforms,
    compileModel(model, gpu) {
      const scene = lightBookScene(new THREE.Scene(), gpu);
      const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, .1, 10000);
      camera.position.z = 3000;
      const objects = { traverse:callback => model.traverse(callback), traverseVisible() {} };
      return gpu.compile(objects, camera, scene);
    },
    entered:rust.book_presentation_enter, compile:rust.book_presentation_compile,
    dispose:rust.book_presentation_dispose, finished:rust.book_presentation_finished,
    failed:rust.book_presentation_failed
  };
}

/** Prepare borrowed shelf materials without drawing, cloning or changing their parent. */
export async function prepareBookPresentation(model, idle, current = () => true) {
  return needRustShelf().book_presentation_prepare(preparationHost(), model, idle, current, false);
}

/** One temporary lifted model per renderer, released on success, cancellation or failure. */
export async function prepareBookDetailPresentation(build, idle, current = () => true) {
  return needRustShelf().book_presentation_prepare(preparationHost(), build, idle, current, true);
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

const SAMPLED_MAPS = ['map', 'roughnessMap', 'metalnessMap', 'bumpMap'];

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
  let disposed = false, current, pendingModel = null, appearanceRevision = 0;
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
  // One shared state object: reading frame capacities never crosses WASM.
  // Rust owns RAF jobs, cancellation and native frame reservation tokens.
  const motionNative = needRustShelf();
  const motionState = motionNative.book_view_motion_state({
    createSampler:createBookMotionSampler, draw,
    position:pose => positionModel(pose),
    measure:pose => { positionModel(pose); return returnFrame(pose,true); },
    noop:() => {}, tick:motionNative.book_view_motion_tick,
    cancel:motionNative.book_view_motion_cancel, release:motionNative.book_view_motion_release,
  });
  const motionOptions = () => ({ direct:directEnabled, compact:compactReturnFrame, adaptive:adaptiveNativeFrame,
    ratio:pixelRatio, width:viewportWidth, height:viewportHeight });
  function holdNativeMotionFrame() {
    if (disposed) return () => {};
    return motionNative.book_view_motion_hold(motionState,displayedFrame,motionOptions());
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
      motion:motionState.motionCapacity, native:motionState.nativeCapacity }, () => {
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
    // Every frame re-applies the renderer's sampling quality to whatever maps the materials hold now,
    // without allocating a list per object (the limit is read once, when a first map needs it).
    let anisotropy;
    const sample = material => {
      for (const key of SAMPLED_MAPS) {
        const map = material[key];
        if (map) map.anisotropy = anisotropy ??= Math.min(16, gpu.capabilities.getMaxAnisotropy());
      }
    };
    model.traverse(object => {
      const material = object.material;
      if (Array.isArray(material)) for (const item of material) sample(item);
      else if (material) sample(material);
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
    return motionNative.book_view_motion_start(motionState,frames,duration,onFrame,current,motionOptions());
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
    dispose(removeCanvas = true) { motionNative.book_view_motion_dispose(motionState); if (!removeCanvas) captureSnapshot();
      unregisterSnapshot?.();
      gpu.domElement.removeEventListener('webglcontextlost', invalidatePresentation);
      gpu.domElement.removeEventListener('webglcontextrestored', invalidatePresentation);
      externalPresentation?.candidate?.dispose({ snapshot:false }); externalPresentation = null;
      if (presentationOwner === owner) { gpu.domElement.remove(); presentationOwner=null; }
      if (!removeCanvas) canvas.style.opacity=''; live=false; disposed = true;
      pendingModel?.userData.dispose(); model.userData.dispose(); if (removeCanvas) canvas.remove(); } };
}

export { sampleBookMotion } from './book-motion.js';
