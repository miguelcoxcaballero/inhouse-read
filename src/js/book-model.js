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

// Procedural micro-detail shared by every book: the woven-cloth and printed-paper tooth, the swallowtail cut,
// the page edges and the endpaper are built once by the shelf module (rust-ui/src/book_model_build.rs,
// book_shared_texture); the cloth/paper/notch pixels come from the numeric core through the model's host.

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
    surfacePixels:kind => rustBookSurfacePixels(rustCore(), kind), notchPixels:(width, height) => rustRibbonNotchPixels(rustCore(), width, height),
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
// The shelf module builds each view and owns its appearance replacement, page snapshot, insertion
// handoff, animations and disposal (rust-ui/src/book_view_host.rs) over one plain state object `v`
// holding what were this function's variables. What runs on every frame of a flight stays below:
// placing the model, the framebuffer window, the GPU draw and the copies to the export canvas.
const presentation = { owner:null };
export function bookView(host, book, style, options) {
  return needRustShelf().book_view_create(viewHost(), host, book, style, options);
}

// ---- per frame -------------------------------------------------------------------------------------
// The book's screen bounds from its world box: every board, page edge and ribbon.
function compactBounds(v) {
  v.model.updateMatrixWorld(true); v.camera.updateMatrixWorld(true);
  v.compactBox.setFromObject(v.model);
  return boxScreenBounds([{ min:v.compactBox.min, max:v.compactBox.max }], v.camera, v.viewportWidth, v.viewportHeight);
}
// Preserve the existing resampling when logical and physical pixels do not line
// up. Otherwise copy identical source pixels, without the large transparent area
// around a flying book. The core decides which, margins included.
function copyRectangle(v, frame, pose) {
  return planCopyRectangle({ viewportWidth:v.viewportWidth, viewportHeight:v.viewportHeight, ratio:v.pixelRatio,
    canvasWidth:v.canvas.width, canvasHeight:v.canvas.height, frame, scale:pose.scale }, v.compactBounds)
    ?? { x:0, y:0, width:v.canvas.width, height:v.canvas.height, full:true };
}
function copyFrame(v, frame, full = false) {
  const { canvas, context, gpu, pixelRatio } = v;
  const rectangle=full ? {x:0,y:0,width:canvas.width,height:canvas.height,full:true} : copyRectangle(v,frame,v.current);
  const copied = v.copiedRectangle;
  if (copied) context.clearRect(copied.x,copied.y,copied.width,copied.height);
  if (rectangle.full) {
    context.clearRect(0,0,canvas.width,canvas.height);
    if (frame.camera === v.camera) context.drawImage(gpu.domElement,0,0,canvas.width,canvas.height);
    else context.drawImage(gpu.domElement,frame.x*pixelRatio,(frame.y-(frame.paddingTop || 0))*pixelRatio);
  } else if (rectangle.width && rectangle.height) {
    context.drawImage(gpu.domElement,rectangle.x-frame.x*pixelRatio,rectangle.y-frame.y*pixelRatio+(frame.paddingTop || 0)*pixelRatio,
      rectangle.width,rectangle.height,rectangle.x,rectangle.y,rectangle.width,rectangle.height);
  }
  v.copiedRectangle=rectangle; v.snapshotDirty=false;
}
function configureFrame(v, frame) {
  const { gpu, pixelRatio } = v;
  gpu.getSize(rendererSize);
  // Keep only bounded transparent margins through the bookmark/cover phases.
  // The GL viewport retains its original size at the lower left. Positioning
  // and snapshot copies compensate the blank upper rows, without resampling.
  const paddedFrame = paddedBookFrameSize(frame, rendererSize, pixelRatio, gpu.domElement,
    v.directEnabled && v.compactReturnFrame && frame.camera !== v.camera &&
    typeof gpu.setViewport === 'function' && gpu.getPixelRatio() === pixelRatio);
  configureNativeRendererSize(gpu, paddedFrame.width, paddedFrame.height, pixelRatio, rendererSize, v.directEnabled, true, 'bounded');
  // A later full-width frame may need its viewport restored without a resize.
  gpu.setViewport?.(0, 0, frame.width, frame.height);
  frame.presentationWidth = paddedFrame.width;
  frame.presentationHeight = paddedFrame.height;
  frame.paddingTop = paddedFrame.height - frame.height;
}
function positionPresentation(v, frame) {
  const { canvas } = v, parent=canvas.parentElement?.parentElement;
  if (!parent) return;
  if (getComputedStyle(parent).position === 'static') parent.style.position='relative';
  const parentRect=parent.getBoundingClientRect(), rect=canvas.getBoundingClientRect();
  const scaleX=rect.width/v.viewportWidth, scaleY=rect.height/v.viewportHeight;
  const node=v.gpu.domElement;
  node.className='ihr-book-live-canvas'; node.setAttribute('aria-hidden','true');
  node.style.cssText=`position:absolute;pointer-events:none;left:${rect.left-parentRect.left+frame.x*scaleX}px;top:${rect.top-parentRect.top+(frame.y-(frame.paddingTop || 0))*scaleY}px;width:${(frame.presentationWidth ?? frame.width)*scaleX}px;height:${(frame.presentationHeight ?? frame.height)*scaleY}px`;
  if (node.parentNode !== parent) parent.append(node);
  canvas.style.opacity='0'; v.live=true;
}
function suspendPresentation(v) { captureSnapshot(v); v.canvas.style.opacity=''; v.live=false; }
function repaintPresentation(v) {
  const frame = v.displayedFrame;
  if (!v.disposed && frame && v.live) { configureFrame(v, frame); v.gpu.render(v.scene,frame.camera); positionPresentation(v, frame); }
}
function captureSnapshot(v) {
  if (v.externalPresentation?.lease) { v.externalPresentation.lease.capture(); return; }
  if (!v.snapshotDirty || !v.displayedFrame || v.disposed) return;
  const other=presentation.owner, { gpu, owner } = v;
  withRendererPresentation(gpu,null,() => {
    if (!v.live || other !== owner) { configureFrame(v, v.displayedFrame); gpu.render(v.scene,v.displayedFrame.camera); }
    copyFrame(v, v.displayedFrame, true);
  });
  if (other && other !== owner) other.repaint();
}
// Keep the full-resolution export/overlay canvas API. Its pixels are
// materialized only when a consumer requests them; animation frames go
// straight to the compositor, without synchronously reading back the GPU.
function lazyExports(v) {
  const { canvas } = v, capture = () => captureSnapshot(v), outputContext = canvas.getContext.bind(canvas);
  const outputURL = canvas.toDataURL.bind(canvas), outputBlob = canvas.toBlob.bind(canvas);
  canvas.getContext = (type,...args) => { if (type === '2d') capture(); return outputContext(type,...args); };
  canvas.toDataURL = (...args) => { capture(); return outputURL(...args); };
  canvas.toBlob = (...args) => { capture(); return outputBlob(...args); };
  return registerLazySnapshot(canvas,capture);
}
function placeModel(v, placed) {
  const { model } = v;
  if (model.userData.setMotionPose) model.userData.setMotionPose(placed.opening, placed.withdrawal);
  else { model.userData.setCoverOpen?.(placed.opening); model.userData.setBookmarkWithdraw?.(placed.withdrawal); }
  model.position.set(placed.x, placed.y, 0);
  model.rotation.set(placed.rotationX, placed.rotationY, placed.rotationZ);
  model.scale.setScalar(placed.scale);
}
const positionModel = (v, pose) => placeModel(v, planBookPose(pose, v.current, v.centerX, v.centerY, v.viewportWidth, v.viewportHeight, v.pageTheme));
function returnFrame(v, pose, measureOnly = false) {
  const { model, camera, viewportWidth, viewportHeight } = v;
  const full = { x:0, y:0, width:viewportWidth, height:viewportHeight, camera };
  // Legacy zoom keeps the full viewport. Native compact windows preserve
  // pixel resolution; optional adaptive mode selects padded 64px buckets
  // from every visible mesh. Geometry that cannot fit keeps the full frame.
  // The core decides, and keeps the capacities a flight reserves.
  const adaptive = v.adaptiveNativeFrame && v.directEnabled;
  const placement = planReturnFrame({ compact:v.compactReturnFrame, direct:v.directEnabled, adaptive:v.adaptiveNativeFrame, measureOnly,
    scale:pose.scale, ratio:v.pixelRatio, viewportWidth, viewportHeight, coverOpen:v.current?.coverOpen,
    closedWidth:v.closedCompactWidth, openWidth:v.compactWidth, height:v.compactHeight,
    motion:v.motionState.motionCapacity, native:v.motionState.nativeCapacity }, () => {
    if (!adaptive) return compactBounds(v);
    model.updateMatrixWorld(true); camera.updateMatrixWorld(true);
    // Project each visible mesh before forming the screen bounds. A world
    // axis-aligned box includes hidden pages and the withdrawn ribbon, and
    // can keep most of a native framebuffer empty throughout the flight.
    return projectVisibleBookBounds(model,camera,viewportWidth,viewportHeight,v.compactPoint,v.projectionPacket);
  });
  if (!placement) return full;
  if (measureOnly) return placement;
  v.compactCamera.copy(camera);
  v.compactCamera.setViewOffset(viewportWidth,viewportHeight,placement.x,placement.y,placement.width,placement.height);
  return { ...placement, camera:v.compactCamera };
}
const measureModel = (v, pose) => { positionModel(v, pose); return returnFrame(v, pose, true); };
function draw(v, pose, { redraw = true } = {}) {
  if (v.disposed) return;
  v.visualRevision++;
  if (v.externalPresentation) return;
  if (!redraw && v.snapshotDirty) captureSnapshot(v);
  const placed = planBookPose(pose, v.current, v.centerX, v.centerY, v.viewportWidth, v.viewportHeight, v.pageTheme);
  const pageTheme = v.pageTheme = placed.pageTheme;
  v.current = { ...pose, coverOpen:placed.opening, bookmarkWithdraw:placed.withdrawal, pageTheme };
  const { model, gpu, canvas, owner } = v;
  model.userData.setPageTheme?.(pageTheme, false);
  placeModel(v, placed);
  // Hidden setup changes geometry and page projection without copying frames.
  // The first explicit draw commits the complete, correctly aligned page.
  if (!redraw) return;
  v.waitingForFirstDraw = false;
  const frame = returnFrame(v, pose);
  const present=v.directEnabled && canvas.isConnected && canvas.parentElement !== v.suspendedHost &&
    frameAligned(v.viewportWidth,v.viewportHeight,v.pixelRatio,frame.x,frame.y,frame.width,frame.height);
  if (present && presentation.owner !== owner) { presentation.owner?.suspend(); presentation.owner=owner; }
  const previousOwner=present ? null : presentation.owner;
  if (!present && presentation.owner === owner) { owner.suspend(); gpu.domElement.remove(); presentation.owner=null; }
  configureFrame(v, frame);
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
    gpu.render(v.scene, frame.camera);
    v.displayedFrame=frame; v.snapshotDirty=true;
    v.displayedPose={ ...v.current }; v.displayedRevision=v.visualRevision;
    if (present) positionPresentation(v, frame);
    else { copyFrame(v, frame); canvas.style.opacity=''; v.live=false; }
  });
  if (!present && previousOwner && previousOwner !== owner) previousOwner.repaint();
  canvas.dataset.angle = String(pose.angle); canvas.dataset.renderer = 'three-mesh';
  canvas.dataset.coverOpen = String(v.current.coverOpen);
  canvas.dataset.pageTheme = String(v.pageTheme);
  canvas.dataset.bookmarkWithdraw = String(v.current.bookmarkWithdraw);
  canvas.dataset.boardBounds = JSON.stringify(projectBookBoardBounds(v.model,v.camera,v.viewportWidth,v.viewportHeight));
}
// A retained native frame is usable only while its model, exact painted
// pose and context still belong to this view. Unknown states redraw.
function hasCurrentNativeFrame(v, pose, keys) {
  const { current, displayedPose, gpu } = v;
  if (v.disposed || v.externalPresentation || v.waitingForFirstDraw || !v.displayedFrame || v.pendingModel ||
    v.displayedRevision !== v.visualRevision || v.pageTheme !== (pose.pageTheme ?? v.pageTheme) ||
    !v.directEnabled || !v.live || presentation.owner !== v.owner || !gpu.domElement.isConnected || !v.canvas.isConnected ||
    keys.some(key => (pose[key] ?? current?.[key] ?? 0) !== (current?.[key] ?? 0) ||
      (pose[key] ?? 0) !== (displayedPose?.[key] ?? 0))) return false;
  try { const context = gpu.getContext?.(); if (!context || context.isContextLost?.()) return false; }
  catch { return false; }
  return true;
}
// With no ribbon, only its logical withdrawal changes. Keep the motion's
// clock and state, but retain the identical already presented native frame.
const bookmarkPoseKeys = ['x','y','scale','angle','pitch','roll','coverOpen','pageTheme'];
function updateBookmarkFrame(v, pose) {
  const absent = target => target?.userData.hasBookmark === false &&
    typeof target.getObjectByName === 'function' && !target.getObjectByName('reading-bookmark');
  if (!absent(v.model) || !hasCurrentNativeFrame(v, pose, bookmarkPoseKeys)) return false;
  const amount = Math.max(0, Math.min(1, Number(pose.bookmarkWithdraw) || 0));
  v.current = { ...v.current, bookmarkWithdraw:amount };
  v.model.userData.setBookmarkWithdraw?.(amount);
  v.snapshotDirty = true;
  const value = String(amount);
  if (v.canvas.dataset.bookmarkWithdraw !== value) v.canvas.dataset.bookmarkWithdraw = value;
  if (v.directEnabled) positionPresentation(v, v.displayedFrame);
  return true;
}

// What the shelf module calls back for a view.
let viewHostObject;
function viewHost() {
  return viewHostObject ||= {
    three:THREE, rust:needRustShelf(), presentation, noop:() => {}, always:() => true,
    renderer:getBookRenderer, presentationRenderer:getPresentationBookRenderer, plan:planBookView,
    light:lightBookScene, model:createBookModel, packet:createBookProjectionPacket, sampler:createBookMotionSampler,
    compilePrograms:compilePagePrograms, prepareUniforms:prepareProgramUniforms, compatibility:bookReturnCompatibility,
    bookmarkFor, normalizeRelief:normalizeCoverRelief, projectPage:projectBookPageBounds, pageZoom:planBookPageZoom,
    spread:(a, b, c) => ({ ...a, ...b, ...c }),
    lease:(gpu, callbacks, canvas, context) => createNativeRendererPresentation(gpu, { ...callbacks, canvas, context }),
    lazyExports, draw, capture:captureSnapshot, position:positionPresentation, compactBounds, positionModel, measure:measureModel,
    suspend:suspendPresentation, repaint:repaintPresentation, nativeFrame:hasCurrentNativeFrame, bookmarkFrame:updateBookmarkFrame,
    bookmarkPoseKeys
  };
}

export { sampleBookMotion } from './book-motion.js';
