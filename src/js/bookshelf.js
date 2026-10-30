import {attachShelfSounds,playShelfSound} from './cozy-sounds.js';
import { notifyCloudSettingsChanged } from './cloud-settings.js';
import { needsDriveDownload } from './book-storage-policy.js';
/**
 * bookshelf.js — home screen de Inhouse Read: una estantería con plantas. El componente vive en
 * rust-ui/src/bookshelf (qué es y sus decisiones de diseño, en mod.rs); aquí queda su API.
 *
 * API PÚBLICA
 * -----------------------------------------------------------------------------
 * Cumple el contrato de HANDOFF-BOOKSHELF.md tal cual (app.js no necesita
 * cambiar ni una línea):
 *
 *   const shelf = renderBookshelf(container, {
 *     books,            // BookRecord[] de library-store.js
 *     onOpenBook,       // (book) => void — tras el giro de portada
 *     onPickLocalFile,  // () => void — "elegir de mi dispositivo"
 *     onOpenDrive,      // () => void — "abrir de Drive"
 *     driveAvailable    // boolean
 *   })
 *   shelf.refresh(nextBooks)
 *   shelf.destroy()
 *
 * Y además acepta la forma con los libros como segundo argumento, por si se
 * reutiliza el componente fuera de esta app:
 *
 *   renderBookshelf(container, books, { onBookOpen(book, ctx) { ... } })
 *
 * El handle expone `refresh`/`update` (equivalentes), `close()` (repliega la
 * portada abierta) y `destroy()`. `onOpenBook(book, ctx)` recibe
 * `ctx.close()` para replegar la portada —útil si el fichero ya no está
 * accesible— y `ctx.coverUrl`.
 *
 * Campos de BookRecord que se usan: id, title, author, format, cover (Blob),
 * lastOpenedAt, progressFraction. Opcionales que hoy no existen pero, si
 * algún día se extraen del fichero, dan grosor real al lomo sin tocar este
 * componente: `pageCount` y `sizeBytes`.
 */

import { batchSpineStyles } from './spine-styles.js';
import { planBookshelf, bookmarkFor, withDefaults, DEFAULT_LAYOUT } from './bookshelf-layout.js';
import { canAdoptShelfMetadata } from './shelf-metadata-records.js';
import { analyzeCoverAppearance, coverAspectRatio, readCoverAspectRatio, withCoverAppearance } from './cover-appearance.js';
import { bookColorOptions, spineColorStyle, spineFinish, surfaceFinish, METAL_COLORS } from './book-colors.js';
import { displayBookTitle, normalizeBookAuthor } from './book-title.js';
import { bookView, fitCoverImage, getBookRenderer, planReadingBookPose } from './book-model.js';
import { analyzeCoverRelief, normalizeCoverRelief, coverReliefLayers, COLOR_RELIEF_IDS } from './cover-relief.js';
import { createShelfZoom } from './shelf-zoom.js';
import { createShelfViewGesture } from './shelf-view-gesture.js';
import { markTiming, resetTimeline } from './perf-marks.js';
import { createBookshelfScene } from './bookshelf-scene.js';
import {warmShelfCover,loadedShelfCover} from './book-cover-images.js';
import {prepareShelfFonts} from './shelf-startup-resources.js';
import { refreshCanvasFontsAfterPaint } from './canvas-font-readiness.js';
import { bookReturnSignature, bookReturnCompatibility, createBookReturnCache } from './bookshelf-return.js';
import { readerReturnCanvas } from './reader-return-canvas.js';
import { layoutShelfDecorations, moveShelfDecoration } from './shelf-decoration-layout.js';
import { getRustCore } from './rust-core.js';
import { SHELF_PREVIEW_MIN_OBJECTS, SHELF_PREVIEW_DIRECT_MOVES } from './shelf-placement-preview.js';
import { createShelfPlacementSession } from './shelf-placement-wasm.js';
import { createLazyPlantCatalog } from './plant-catalog-lazy.js';
import { normalizeShelfType, BAGGEBO_SPEC } from './shelf-types.js';
import { measuredShelfModelLayout as shelfModelLayout } from './shelf-model-layout.js';
import { placeRooftopPlants } from './plant-rooftop-layout.js';
import { getCatalogPlant, getCatalogPot, getPotColor } from './plant-catalog-data.js';
import { normalizeShelfPlant, resolveCatalogPlant } from './plant-records.js';
import { shelfScale, plantDimensions, bookSpineOptions, minimumBookCellWidth } from './plant-dimensions.js';
import { getCatalogLamp, normalizeShelfLamp } from './lamp-catalog-data.js';
import { lampCatalogIllustration } from './lamp-illustration.js';
import { readerBookTiming } from './reader-book-timing.js';
import { persistablePosition } from './readers/persistable-position.js';
import { needRustShelf } from './rust-shelf.js';



export const DEFAULT_TEXTS = Object.freeze({
  shelfLabel: 'Estantería',
  emptyTitle: 'Sin libros',
  emptyBody: '',
  addLocal: 'Añadir libro',
  addDrive: 'Drive',
  emptyAction: 'Añadir libro',
  openAction: 'Abrir',
  tapCover: (book) => `Toca para leer ${displayBookTitle(book) || 'este libro'}`,
  closeAction: 'Cerrar',
  noCover: 'Sin portada',
  openAria: (book) =>
      book.author ? `Abrir ${displayBookTitle(book)}, de ${normalizeBookAuthor(book.author)}` : `Abrir ${displayBookTitle(book)}`,
  progressAria: (percent) => (percent >= 100 ? 'terminado' : `leído al ${percent} %`)
});


// The functions of other modules the shelf module's parts call, looked up when they are called (a module
// replaced after the shelf was built is still the one called).
const shelfEnv = {
  physicalPlacement: createBookshelfScene.physicalPlacement === true,
  playShelfSound:(...args)=>playShelfSound(...args),
  // The set-up's own collaborators (rust-ui/src/bookshelf/mount.rs).
  withDefaults: (...args) => withDefaults(...args),
  createBookReturnCache: (...args) => createBookReturnCache(...args),
  attachShelfSounds: (...args) => attachShelfSounds(...args),
  createShelfViewGesture: (...args) => createShelfViewGesture(...args),
  createShelfZoom: (...args) => createShelfZoom(...args),
  createLazyPlantCatalog: (...args) => createLazyPlantCatalog(...args),
  refreshCanvasFontsAfterPaint: (...args) => refreshCanvasFontsAfterPaint(...args),
  displayBookTitle: (...args) => displayBookTitle(...args),
  getBookRenderer: (...args) => getBookRenderer(...args),
  canAdoptShelfMetadata: (...args) => canAdoptShelfMetadata(...args),
  planBookshelf: (...args) => planBookshelf(...args),
  batchSpineStyles: (...args) => batchSpineStyles(...args),
  bookSpineOptions: (...args) => bookSpineOptions(...args),
  minimumBookCellWidth: (...args) => minimumBookCellWidth(...args),
  createBookshelfScene: (...args) => createBookshelfScene(...args),
  get DEFAULT_LAYOUT() { return DEFAULT_LAYOUT; },
  normalizeBookAuthor: (...args) => normalizeBookAuthor(...args),
  bookColorOptions: (...args) => bookColorOptions(...args),
  spineColorStyle: (...args) => spineColorStyle(...args),
  spineFinish: (...args) => spineFinish(...args),
  surfaceFinish: (...args) => surfaceFinish(...args),
  withCoverAppearance: (...args) => withCoverAppearance(...args),
  fitCoverImage: (...args) => fitCoverImage(...args),
  bookView: (...args) => bookView(...args),
  bookmarkFor: (...args) => bookmarkFor(...args),
  readCoverAspectRatio: (...args) => readCoverAspectRatio(...args),
  planReadingBookPose: (...args) => planReadingBookPose(...args),
  markTiming: (...args) => markTiming(...args),
  resetTimeline: (...args) => resetTimeline(...args),
  readerBookTiming: (...args) => readerBookTiming(...args),
  persistablePosition: (...args) => persistablePosition(...args),
  bookReturnSignature: (...args) => bookReturnSignature(...args),
  bookReturnCompatibility: (...args) => bookReturnCompatibility(...args),
  readerReturnCanvas: (...args) => readerReturnCanvas(...args),
  coverAspectRatio: (...args) => coverAspectRatio(...args),
  analyzeCoverAppearance: (url,title,options) => {
    const image = loadedShelfCover(url);
    return image ? analyzeCoverAppearance(url,title,{...options,image})
      : options === undefined ? analyzeCoverAppearance(url,title) : analyzeCoverAppearance(url,title,options);
  },
  warmShelfCover,
  prepareShelfFonts,
  notifyCloudSettingsChanged: (...args) => notifyCloudSettingsChanged(...args),
  getCatalogLamp: (...args) => getCatalogLamp(...args),
  lampCatalogIllustration: (...args) => lampCatalogIllustration(...args),
  normalizeShelfLamp: (...args) => normalizeShelfLamp(...args),
  getCatalogPlant: (...args) => getCatalogPlant(...args),
  resolveCatalogPlant: (...args) => resolveCatalogPlant(...args),
  normalizeShelfType: (...args) => normalizeShelfType(...args),
  placeRooftopPlants: (...args) => placeRooftopPlants(...args),
  shelfModelLayout: (...args) => shelfModelLayout(...args),
  getCatalogPot: (...args) => getCatalogPot(...args),
  getPotColor: (...args) => getPotColor(...args),
  normalizeShelfPlant: (...args) => normalizeShelfPlant(...args),
  shelfScale: (...args) => shelfScale(...args),
  plantDimensions: (...args) => plantDimensions(...args),
  layoutShelfDecorations: (...args) => layoutShelfDecorations(...args),
  moveShelfDecoration: (...args) => moveShelfDecoration(...args),
  getRustCore: (...args) => getRustCore(...args),
  createShelfPlacementSession: (...args) => createShelfPlacementSession(...args),
  get SHELF_PREVIEW_MIN_OBJECTS() { return SHELF_PREVIEW_MIN_OBJECTS; },
  get SHELF_PREVIEW_DIRECT_MOVES() { return SHELF_PREVIEW_DIRECT_MOVES; },
  get BAGGEBO_SPEC() { return BAGGEBO_SPEC; },
  needsDriveDownload: (...args) => needsDriveDownload(...args),
  coverReliefLayers: (...args) => coverReliefLayers(...args),
  normalizeCoverRelief: (...args) => normalizeCoverRelief(...args),
  analyzeCoverRelief: (...args) => analyzeCoverRelief(...args),
  get METAL_COLORS() { return METAL_COLORS; },
  get COLOR_RELIEF_IDS() { return COLOR_RELIEF_IDS; }
};

/**
 * Monta la estantería dentro de `container`.
 *
 * @param {HTMLElement} container
 * @param {object[]|object} booksOrOptions
 * @param {object} [maybeOptions]
 * @returns {{refresh:Function, update:Function, close:Function, destroy:Function, element:HTMLElement}}
 */
export function renderBookshelf(container, booksOrOptions, maybeOptions) {
  if (!container) throw new Error('renderBookshelf: falta el contenedor');
  const shelfNative = needRustShelf();
  // The set-up (merged options, shared state, frame, view swipe and pinch zoom, plant catalogue, page
  // listeners, first render) is rust-ui/src/bookshelf/mount.rs; this keeps the public handle.
  const shelfCtx = shelfNative.shelf_mount(shelfEnv, container, booksOrOptions, maybeOptions, DEFAULT_TEXTS);
  let shelfCtxLive = true;
  const { state, parts:shelfParts, root, lifecycle:shelfLifecycle } = shelfCtx.mounted();

  /** Refresh decisions and metadata adoption live in Rust; the host keeps the public option shape. */
  function refresh(nextBooks, { defer = false } = {}) {
    if (shelfCtxLive) shelfCtx.refresh(nextBooks, defer);
  }
  // A destroyed shelf has handed its context back; whatever a late callback asks of it is then moot.
  function setReturningBook(bookId) { if (shelfCtxLive) shelfCtx.setReturningBook(bookId); }
  function finishReturnSlot(ready) { if (shelfCtxLive) shelfCtx.finishReturnSlot(Boolean(ready)); }

  return {
    element: root,
    get isInteracting() { return shelfCtxLive && shelfNative.shelf_has_interaction(state); },
    applyRoomPose:() => shelfCtxLive && shelfNative.shelf_apply_room_pose(state),
    prepareCloudRoom:() => { if(shelfCtxLive)shelfCtx.prepareCloudRoom(); },
    applyLiveRoomMotion:packet => shelfCtxLive && shelfNative.shelf_apply_live_room_motion(state,packet),
    clearLiveRoomMotion:source => shelfCtxLive && shelfNative.shelf_clear_live_room_motion(state,source),
    refresh,
    // Storage may notify for several records in one turn. Keep only the last
    // complete list and commit one semantic/GPU layout on the next frame.
    queueRefresh:nextBooks => refresh(nextBooks, { defer:true }),
    update: refresh,
    returnToShelf: (bookId, returnOptions) => shelfCtxLive ? shelfCtx.returnToShelf(bookId, returnOptions) : Promise.resolve(false),
    updateCloudRecord:record => shelfNative.shelf_update_cloud_record(state, record),
    setPresentationActive:value => shelfNative.shelf_set_presentation_active(state, value),
    setReturningBook,
    hasReaderOrigin:bookId => shelfNative.shelf_has_reader_origin(state, bookId),

    /** Hands the page a lifted book will open on to its 3D model ahead of the tap. */
    prepareOpeningPage(bookId, snapshot, idle = () => new Promise(resolve => setTimeout(resolve, 0))) {
      return shelfNative.shelf_prepare_opening_page(state, bookId, snapshot, idle);
    },

    /** Repliega la portada abierta, si la hay. */
    close() {
      finishReturnSlot(false);
      return shelfNative.shelf_public_close(state);
    },

    destroy() {
      window.removeEventListener('blur', shelfParts.onInputInterrupted);
      document.removeEventListener('visibilitychange', shelfParts.onInputVisibility);
      shelfNative.shelf_destroy_dispatch(shelfParts, shelfCtxLive ? shelfLifecycle.destroy : null);
      if (shelfCtxLive) { shelfCtxLive = false; shelfCtx.free(); }
    }
  };
}

export default renderBookshelf;
