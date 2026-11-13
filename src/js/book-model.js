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
import { spineSurface, releaseSurface, seededRandom, textSeed, paintCloth, paintWeave, drawDevice } from './spine-surface.js';
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
const sharedTexture = (key, build) => needRustShelf().book_shared_texture(key, build);
const clothNormals = () => needRustShelf().book_model_tile_normals(modelHost(), 'cloth');
const endpaperTexture = () => needRustShelf().book_model_endpaper(modelHost());

// Numeric Rust meshes own their arrays; install them without another copy.
function paperMeshGeometry(buffers) {
  if (!buffers) return null;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(buffers.positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(buffers.normals, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(buffers.uvs, 2));
  geometry.setAttribute('color', new THREE.BufferAttribute(buffers.colors, 3));
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

// The case: both boards (rounded edges, cover UVs on the faces, the bevel inside the book's dimensions)
// and both half-ellipse ends of the binding. One call to the shelf module (rust-ui/src/book_case.rs) builds
// every array once; three only installs views of it. The front board's faces come split into outside (0)
// and inside (2) groups.
function bookCase(width, height, depth, shelf, overview, thickness = 0, segments = 0, rim = 0) {
  if (!(Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0 && Number.isFinite(depth) && depth > 0)
    || segments && !(Number.isFinite(thickness) && thickness > 0)) throw new RangeError('Medidas de tapas no válidas.');
  const data = needRustShelf().book_case_geometry(width, height, depth, Boolean(shelf), Boolean(overview), thickness, segments, rim);
  const [vertices, lidStart, lidCount, wallStart, wallCount, fronts, capVertices, capIndices] = data;
  let at = 8;
  const take = length => data.subarray(at, at += length);
  const front = take(fronts * 3), board = { position:take(vertices * 3), uv:take(vertices * 2), normal:take(vertices * 3) };
  const cap = capVertices ? { position:take(capVertices * 3), normal:take(capVertices * 3), uv:take(capVertices * 2),
    index:take(capIndices) } : null;
  return { groups:[lidStart, lidCount, 0, wallStart, wallCount, 1], front, board, cap };
}
// An ExtrudeGeometry's own attributes and groups (its order: position, uv, normal).
function boardFrom(parts, front = false) {
  const geometry = new THREE.BufferGeometry(), groups = front ? parts.front : parts.groups;
  geometry.type = 'ExtrudeGeometry';
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(parts.board.position, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(parts.board.uv, 2));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(parts.board.normal, 3));
  for (let i = 0; i < groups.length; i += 3) geometry.addGroup(groups[i], groups[i + 1], groups[i + 2]);
  return geometry;
}
// A ShapeGeometry's: the index as setIndex(array) makes it, then position, normal, uv.
function capFrom(cap) {
  if (!cap) throw new TypeError('Cannot destructure the cap of a case without one');
  const { position, normal, uv, index } = cap, geometry = new THREE.BufferGeometry();
  geometry.type = 'ShapeGeometry';
  geometry.setIndex(new (index.some(value => value >= 65535) ? THREE.Uint32BufferAttribute : THREE.Uint16BufferAttribute)(index, 1));
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normal, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return geometry;
}
/** The case of a model on its own (createBookModel installs the same four): the front board with its
 * outside/inside groups, the back board, and the tail and head ends of the binding. */
export function bookCaseGeometries(width, height, board, thickness, { shelf = false, overview = false, segments, rim = 0 }) {
  const parts = bookCase(width, height, board, shelf, overview, thickness, segments, rim);
  return { front:boardFrom(parts, true), back:boardFrom(parts), caps:[capFrom(parts.cap), capFrom(parts.cap)] };
}

// Seen almost edge-on, spine lettering would shrink into bright slivers along the rolled edge: the spine's
// grazing fade and the cover relief's clearcoat-normal hook are the shelf module's (rust-ui/src/book_model_build.rs),
// with their shader text (rust-ui/src/book_shaders.rs) patched once per program variant in the caches below.

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
  return boardFrom(bookCase(width, height, depth, shelf, overview));
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

// Seen almost edge-on (the lifted book's front view), spine lettering shrinks into bright slivers along the
// rolled edge: only while the spine as a whole faces away, the surface that turns from the viewer shows plain
// cloth. The hook and the updater are the shelf module's (rust-ui/src/book_model_build.rs), bound to the uniforms.
function spineGrazingFade(rust, host, material) {
  const uniforms = { spineCloth:{ value:new THREE.Color() }, spineClothMetal:{ value:0 }, spineClothRough:{ value:.88 } };
  material.onBeforeCompile = rust.book_model_spine_fade_compile.bind(null, host, uniforms);
  material.customProgramCacheKey = () => 'spine-grazing-fade';
  return rust.book_model_spine_fade_update.bind(null, host, uniforms);
}
// Relief reaches the shader through the clearcoat normal map (the hook is the shelf module's,
// book_model_relief_compile); neutral placeholder maps leave every pixel unchanged.
function installCoverRelief(rust, host, material) {
  const previousHook = material.onBeforeCompile, key = `${material.customProgramCacheKey()}|cover-relief-color-v2`;
  const uniforms = { bookReliefBaseFinish:{ value:new THREE.Vector3() }, bookReliefStrength:{ value:0 } };
  // The physical chunk as it is when the relief is installed, patched once per chunk text.
  const chunk = THREE.ShaderChunk.lights_physical_fragment;
  const physical = rememberedPatch(host.reliefPatches, ['physical', chunk], () => rust.book_relief_physical(chunk));
  material.onBeforeCompile = rust.book_model_relief_compile.bind(null, host, uniforms, material, previousHook, physical);
  material.customProgramCacheKey = () => key;
  return uniforms;
}
// A cover laminate; once relief is armed, the thinnest clearcoat that keeps its program from the start.
function laminate(rust, s, value) {
  rust.book_apply_material_finish(s.cover, SURFACE_FINISHES[surfaceFinish(value, 'satin')], 'cover', false);
  if (s.reliefArmed && !s.cover.clearcoat) s.cover.clearcoat = .001;
}
const pixelRatio = () => typeof devicePixelRatio === 'number' ? devicePixelRatio : 1;
// The page's white placeholder: both map and blending variants exist before the first flyout frame.
function blankPageMap() {
  const map = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  map.colorSpace = THREE.SRGBColorSpace; map.minFilter = THREE.LinearFilter;
  map.generateMipmaps = false; map.needsUpdate = true; return map;
}

// One book. Every quality, size, seed and finish is the shelf module's (rust-ui/src/book_model_policy.rs,
// book_case.rs, book_reflection.rs, the numeric core's meshes); the module also owns the model's page snapshot,
// appearance updates, cover source, relief slots, ribbon and disposal (rust-ui/src/book_model_build.rs), all
// over one plain state object `s`. Three's objects are made and wired here, in one pass: a shelf builds every
// book at startup, and assembling them through the WebAssembly boundary property by property was slower than
// this. What else stays here runs every frame of a flight (the pose setters below), the asynchronous relief
// bake, and the adapters the module calls back. Shelf and lifted copies of a book overlap during a
// transition: book-cover-images keeps the decoded image alive for exactly that overlap.
export function createBookModel(book, style, width, height, thickness, coverUrl,
  { shelf = false, overview = false, inspectionResolution = 0, eagerRelief = true } = {}) {
  const rust = needRustShelf(), host = modelHost(), group = new THREE.Group(), ud = group.userData;
  const quality = rust.book_model_plan(height, Boolean(shelf), Boolean(overview), inspectionResolution, pixelRatio());
  const inspection = quality.inspectionResolution, detail = Boolean(quality.detail);
  ud.inspectionResolution = inspection;
  ud.overview = ud.isOverview = Boolean(overview);
  ud.detailLevel = quality.detailLevel;
  const { textureHeight, maxTextureDimension, bindingSegments, reliefRows, ribbonSegments } = quality;
  const ribbonSeed = textSeed(`ribbon|${book?.shelfVisualId ?? book?.id ?? ''}|${book?.title ?? ''}`) || 1;
  const level = ud.detailLevel, ratio = width / height;
  const surfaceSeed = String(book?.shelfVisualId ?? book?.id ?? book?.path ?? book?.title ?? 'book');
  const s = { host, three:THREE, group, book, style, width, height, thickness, coverUrl, shelf, overview, inspectionResolution:inspection,
    detail, level, ratio, textureHeight, maxTextureDimension, bindingSegments, reliefRows, ribbonSegments, ribbonSeed, disposed:false,
    cloth:null, surface:null, binding:null, updateSpineFade:null, cover:null, reliefArmed:false, coverFinishValue:undefined,
    reliefUniforms:null, weaveStrength:0, coverGrain:null, coverSurfaceFinish:undefined, board:0, frontCover:null, insideCover:null,
    frontMaterials:null, frontBoard:null, pastedown:null, inset:0, edges:null, pageWidth:0, pageHeight:0, pagePaper:null, pagePrint:null,
    pageMaterial:null, pageImage:null, stockMaterial:null, stockImage:null, pageTheme:1, themeTone:null, stockTone:null, installedRaster:null,
    paperScratch:null, bookmark:null, ribbonMaterial:null, ribbonMesh:null, coverOpening:0, bookmarkWithdraw:0, clothColor:undefined,
    leafPaper:null, readLeaves:null, bindingMesh:null, capMaterials:null, coverRevision:0, currentCoverUrl:undefined, releaseImage:host.noop,
    resolveCoverReady:host.noop, coverImageBounds:null, coverMaskSource:null, wantedRelief:null, reliefRevision:0, reliefMaps:null,
    reliefOwned:null, reliefController:null, materialRevision:0, ribbonBatch:0, ribbonDirty:false };
  const cloth = s.cloth = new THREE.MeshStandardMaterial({ color:style.color, roughness:.86 });
  applyBookReflectionSurface(cloth, { seed:`${surfaceSeed}|back`, strength:.018 });
  const surface = s.surface = shelfSpineSurface(book, style, height, thickness, shelf, overview, inspection);
  const binding = s.binding = new THREE.MeshPhysicalMaterial({ ...surface.material, side:THREE.DoubleSide });
  const updateSpineFade = s.updateSpineFade = !shelf && !overview ? spineGrazingFade(rust, host, binding) : null;
  updateSpineFade?.(book, style);
  applyBookReflectionSurface(binding, { seed:`${surfaceSeed}|binding`, strength:.014 });
  // Painted once, by the cover source below (or as the placeholder while a download is pending).
  const cover = s.cover = new THREE.MeshPhysicalMaterial({ map:null });
  // The clearcoat + relief program is costly to shade: views that only fly a book skip it unless the cover
  // already has a relief; shelf books keep cheap materials until a relief is selected.
  const armed = s.reliefArmed = ((detail || Boolean(inspection)) && Boolean(eagerRelief)) || Boolean(book.coverRelief);
  s.coverFinishValue = book.coverFinish;
  laminate(rust, s, book.coverFinish);
  // Keep the broad studio reflection from washing out printed ink at an oblique angle.
  applyBookReflectionSurface(cover, { seed:`${surfaceSeed}|cover`, strength:.018, environmentReflection:.75 });
  const reliefUniforms = s.reliefUniforms = installCoverRelief(rust, host, cover);
  const finish = SURFACE_FINISHES[surfaceFinish(s.coverFinishValue)];
  reliefUniforms.bookReliefBaseFinish.value.set(finish.clearcoat, finish.roughness, finish.clearcoatRoughness);
  if (armed) { s.reliefArmed = false; rust.book_model_arm_relief(s); }
  // 224 threads per board height: below ~3 device pixels a thread the weave fades to a quiet tooth.
  const weaveStrength = s.weaveStrength = rust.book_weave_strength(height, pixelRatio());
  if (detail || inspection) {
    cloth.normalMap = sharedTexture('cloth', clothNormals);
    cloth.normalMap.repeat.set(14 * ratio, 14); cloth.normalScale.setScalar(.5 * weaveStrength);
  }
  s.coverSurfaceFinish = surfaceFinish(book.coverFinish);
  const board = s.board = height * .007;
  const frontCover = s.frontCover = new THREE.Group();
  frontCover.name = 'front-cover-hinge';
  // Rotate around the board's binding edge, not the page block's centre.
  frontCover.position.set(-width / 2, 0, thickness / 2 - board / 2);
  group.add(frontCover);
  // Both boards and both ends of the binding, each array built once.
  const parts = bookCase(width, height, board, shelf, overview, thickness, bindingSegments, overview ? 0 : board * 1.1);
  // Inside of the board: the cloth turns in over its edges, the endpaper is pasted down over the rest.
  const insideCover = s.insideCover = new THREE.MeshStandardMaterial({ color:style.color, roughness:.9 });
  insideCover.visible = false;
  const frontGeometry = boardFrom(parts, true), frontMaterials = s.frontMaterials = [cover, cloth, insideCover];
  const frontBoard = s.frontBoard = new THREE.Mesh(frontGeometry, overview ? cover : frontMaterials);
  frontBoard.name = 'front-cover'; frontBoard.position.set(width / 2, 0, 0);
  frontCover.add(frontBoard);
  // Pastedown: wove endpaper inside the cloth turn-ins, darker where it bends into the joint.
  const turnIn = height * .028, joint = height * .004;
  const pasteWidth = width - turnIn - joint, pasteHeight = height - turnIn * 2;
  const paperBuffers = rustBookPaperBuffers(rustCore(), pasteWidth, pasteHeight,
    width - height * .009 * 2, height - height * .009 * 2, height * .009, overview);
  if (!paperBuffers) throw new RangeError('Medidas de guardas no válidas.');
  const pasteGeometry = paperMeshGeometry(paperBuffers.pastedown);
  const endpaper = new THREE.MeshStandardMaterial({ color:'#ffffff', roughness:1, vertexColors:true,
    map:overview ? null : sharedTexture('endpaper', endpaperTexture) });
  endpaper.map?.repeat.set(3 * pasteWidth / pasteHeight, 3);
  const pastedown = s.pastedown = new THREE.Mesh(pasteGeometry, endpaper);
  pastedown.name = 'endpaper'; pastedown.rotation.y = Math.PI; pastedown.visible = false;
  pastedown.position.set(-width / 2 + joint + pasteWidth / 2, 0, -board * .54);
  frontBoard.add(pastedown);
  // One material for face and edges: a single draw call per back board.
  const backBoard = new THREE.Mesh(boardFrom(parts), cloth);
  backBoard.name = 'back-cover'; backBoard.position.z = -thickness / 2 + board / 2;
  group.add(backBoard);
  const inset = s.inset = height * .009;
  let edges, pageBlock;
  if (overview) {
    // A thumbnail keeps a plain block and one tiny owned raster.
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 32;
    rust.book_thumbnail_pages(canvas.getContext('2d'));
    const map = new THREE.CanvasTexture(canvas); map.colorSpace = THREE.SRGBColorSpace;
    edges = new THREE.MeshPhysicalMaterial({ map, roughness:1 });
    pageBlock = new THREE.Mesh(new THREE.BoxGeometry(width - inset * 2, height - inset * 2, thickness - board * 2.4), edges);
    pageBlock.position.set(inset * .3, 0, 0); group.add(pageBlock);
  } else {
    // One crescent-shaped block and one shared atlas: a single draw call.
    const size = detail ? 512 : 256, map = sharedTexture(`pages-${size}`, () => rust.book_model_page_edges(host, size));
    edges = new THREE.MeshPhysicalMaterial({ map, roughness:1, vertexColors:true });
    pageBlock = new THREE.Mesh(pageBlockGeometry(width, height, thickness, { board, inset, detail }), [edges]);
    group.add(pageBlock);
  }
  s.edges = edges;
  rust.book_apply_material_finish(edges, SURFACE_FINISHES[surfaceFinish(book.pageEdgeFinish, 'satin')], 'paper', false);
  pageBlock.name = 'page-block';
  const pageWidth = s.pageWidth = width - inset * 2, pageHeight = s.pageHeight = height - inset * 2;
  const pageFront = thickness / 2 - board * 1.2 + board * .03;
  // The paper runs on into the joint, where the leaf bends down into shade.
  const pagePaper = s.pagePaper = new THREE.Mesh(paperMeshGeometry(paperBuffers.paper),
    new THREE.MeshBasicMaterial({ color:'#ffffff', toneMapped:false, vertexColors:true }));
  pagePaper.position.set(inset * .3 - inset / 2, 0, pageFront);
  // Fill depth with the opaque paper before shading the case beneath it.
  pagePaper.renderOrder = -2; pagePaper.visible = false;
  pagePaper.name = 'reading-page-paper'; group.add(pagePaper);
  // The saved rasters stay resident for reopening, hidden behind the closed board by their common parent.
  const pagePrint = s.pagePrint = new THREE.Group();
  pagePrint.name = 'reading-page-print'; pagePrint.visible = false; group.add(pagePrint);
  const pageMaterial = s.pageMaterial = new THREE.MeshBasicMaterial({ color:0xffffff, toneMapped:false, map:blankPageMap(), transparent:true });
  const pageImage = s.pageImage = new THREE.Mesh(new THREE.PlaneGeometry(pageWidth, pageHeight), pageMaterial);
  pageImage.name = 'reading-page';
  pageImage.position.set(inset * .3, 0, pageFront + board * .02);
  pageImage.visible = false; pagePrint.add(pageImage);
  ud.pageSurface = pageImage;
  // The same page on white stock just behind the reader's own: the book opens and closes on white paper
  // and the reading theme fades over it (pageTheme 0 = white stock, 1 = the reader's theme).
  const stockMaterial = s.stockMaterial = new THREE.MeshBasicMaterial({ color:0xffffff, toneMapped:false, map:blankPageMap() });
  const stockImage = s.stockImage = new THREE.Mesh(new THREE.PlaneGeometry(pageWidth, pageHeight), stockMaterial);
  stockImage.name = 'reading-page-stock';
  stockImage.position.set(inset * .3, 0, pageFront + board * .01);
  stockImage.renderOrder = -1; stockImage.visible = false; pagePrint.add(stockImage);
  s.paperScratch = new THREE.Color();
  ud.setPageTheme = setPageTheme.bind(null, s);
  ud.getPageTheme = () => s.pageTheme;
  ud.getPageTextures = rust.book_model_page_textures.bind(null, s);
  ud.setPageSnapshot = rust.book_model_page_snapshot.bind(null, s);
  const bookmark = s.bookmark = bookmarkFor(book);
  s.clothColor = style.color;
  if (bookmark) rust.book_model_ribbon(s);
  // Lifted copies only: the leaves already read turn over with the board. Text paper is cooler and
  // smoother than the endpaper and, like the saved page beside it, skips tone mapping.
  const leafPaper = s.leafPaper = detail ? new THREE.MeshStandardMaterial({ color:new THREE.Color(0xffffff).multiply(LEAF_LIGHT),
    roughness:.93, vertexColors:true, map:sharedTexture('endpaper', endpaperTexture), toneMapped:false }) : null;
  // Finer than the endpaper: the fibres shrink into the grain of a book paper.
  leafPaper?.map.repeat.set(6 * width / height, 6);
  if (detail) {
    const depth = (thickness - board * 2.4) * Math.max(.025, Math.min(.5, bookmark?.progress ?? 0));
    const readLeaves = s.readLeaves = new THREE.Mesh(leafStackGeometry(width, height, depth, { board, inset }), [leafPaper, edges]);
    readLeaves.name = 'read-leaves'; readLeaves.visible = false; frontCover.add(readLeaves);
  }
  // The joint grooves are pressed into the board artwork: no raised strips on the covers.
  const bindingMesh = s.bindingMesh = new THREE.Mesh(bindingGeometry(width, height, thickness, bindingSegments, surface.relief, reliefRows), binding);
  bindingMesh.name = 'binding'; group.add(bindingMesh);
  const capMaterials = s.capMaterials = [], capFinish = SURFACE_FINISHES[surfaceFinish(book.spineSurfaceFinish, 'matte')];
  const metalCaps = book.spineFinish === 'gold' || book.spineFinish === 'silver';
  for (const y of [-height / 2, height / 2]) {
    const material = new THREE.MeshPhysicalMaterial({ color:style.color, side:THREE.DoubleSide });
    rust.book_apply_material_finish(material, capFinish, 'cap', metalCaps);
    applyBookReflectionSurface(material, { seed:`${surfaceSeed}|${y < 0 ? 'tail' : 'head'}`, strength:.01, uvScale:[1 / width, 1 / thickness] });
    const cap = new THREE.Mesh(capFrom(parts.cap), material);
    cap.name = y < 0 ? 'binding-tail-cap' : 'binding-head-cap';
    capMaterials.push(cap.material);
    cap.rotation.x = Math.PI / 2; cap.position.y = y; group.add(cap);
  }
  s.reliefOwned = new Set();
  // ---- cover relief: only the portable colour/tolerance/strength choice is saved; maps swap into slots
  // the cover material already compiled with, so selecting a relief links no program.
  ud.coverRelief = () => normalizeCoverRelief(s.wantedRelief);
  ud.supportsCoverRelief = true;
  ud.prepareCoverRelief = rust.book_model_prepare_relief.bind(null, s);
  ud.setCoverRelief = setCoverRelief.bind(null, s);
  ud.updateCoverSource = rust.book_model_cover_source.bind(null, s);
  rust.book_model_cover_source(s, coverUrl, undefined, undefined, undefined);
  if (book.coverRelief) ud.setCoverRelief(book.coverRelief);
  // Only a download still in flight (or one that already failed) needs the generated case meanwhile.
  if (!cover.map) rust.book_model_cover_placeholder(s);
  ud.dispose = rust.book_model_dispose.bind(null, s);
  ud.updateSpineAppearance = rust.book_model_spine_appearance.bind(null, s);
  ud.updateCoverAppearance = rust.book_model_cover_appearance.bind(null, s);
  ud.setCoverOpen = setCoverOpen.bind(null, s);
  ud.setBookmarkWithdraw = setBookmarkWithdraw.bind(null, s);
  ud.setMotionPose = setMotionPose.bind(null, s);
  ud.hasBookmark = Boolean(bookmark);
  ud.updateBookmark = rust.book_model_update_bookmark.bind(null, s);
  ud.updateEdgeAppearance = rust.book_model_edge_appearance.bind(null, s);
  if (shelf && !overview) {
    ud.preparePresentation = host.preparePresentation.bind(null, s);
    ud.prepareDetailPresentation = host.prepareDetailPresentation.bind(null, s);
  }
  return group;
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
    reflect:applyBookReflectionSurface, spine:shelfSpineSurface, releaseSurface, spineFinish, metal:METAL_COLORS,
    rememberedPatch, spineFadePatches:new Map(), reliefPatches:new Map(), constant:value => value,
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

/** Plan the handoff in the reader's flat plane without repainting the book (rust-ui/src/book_view_host.rs). */
export function planBookPageZoom(model, camera, options) {
  return needRustShelf().book_view_page_zoom(viewHost(), model, camera, options);
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
    bookmarkFor, normalizeRelief:normalizeCoverRelief, projectPage:projectBookPageBounds, planZoom:planPageZoom,
    spread:(a, b, c) => ({ ...a, ...b, ...c }),
    lease:(gpu, callbacks, canvas, context) => createNativeRendererPresentation(gpu, { ...callbacks, canvas, context }),
    lazyExports, draw, capture:captureSnapshot, position:positionPresentation, compactBounds, positionModel, measure:measureModel,
    suspend:suspendPresentation, repaint:repaintPresentation, nativeFrame:hasCurrentNativeFrame, bookmarkFrame:updateBookmarkFrame,
    bookmarkPoseKeys, state:viewState
  };
}
// A view's state with every field it will hold, so the shelf module only writes existing properties: an object
// grown one key at a time from WebAssembly becomes a slow dictionary for the per-frame reads of draw().
const viewState = () => ({ env:undefined, canvas:undefined, model:undefined, node:undefined, book:undefined, style:undefined,
  width:undefined, height:undefined, thickness:undefined, viewportWidth:undefined, viewportHeight:undefined, centerX:undefined,
  centerY:undefined, coverUrl:undefined, shelf:undefined, shelfView:undefined, compactReturnFrame:undefined, adaptiveNativeFrame:undefined,
  shared:undefined, gpu:undefined, directEnabled:undefined, pixelRatio:undefined, context:undefined, scene:undefined, camera:undefined,
  disposed:undefined, current:undefined, pendingModel:undefined, appearanceRevision:undefined, reliefPrepared:undefined,
  reliefPreparation:undefined, currentBook:undefined, currentSnapshot:undefined, pageTheme:undefined, coverPaintKey:undefined,
  waitingForFirstDraw:undefined, compactCamera:undefined, compactBox:undefined, compactPoint:undefined, projectionPacket:undefined,
  compactWidth:undefined, closedCompactWidth:undefined, compactHeight:undefined, copiedRectangle:undefined, displayedFrame:undefined,
  snapshotDirty:undefined, live:undefined, suspendedHost:undefined, displayedPose:undefined, visualRevision:undefined,
  displayedRevision:undefined, invalidatePresentation:undefined, externalPresentation:undefined, unregisterSnapshot:undefined,
  owner:undefined, compactBounds:undefined, bookmarkFrame:undefined, motionState:undefined });

export { sampleBookMotion } from './book-motion.js';
