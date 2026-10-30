import {attachShelfSounds,playShelfSound} from './cozy-sounds.js';
import { notifyCloudSettingsChanged } from './cloud-settings.js';
import { needsDriveDownload } from './book-storage-policy.js';
/**
 * bookshelf.js — home screen de Inhouse Read: una estantería con plantas.
 * =============================================================================
 *
 * QUÉ ES
 * -----------------------------------------------------------------------------
 * El home no es una cuadrícula de tarjetas: es una estantería ilustrada donde
 * la biblioteca se ve *de canto*, como libros de verdad. Al tocar un lomo, el
 * libro sale de la balda y gira sobre su eje vertical para enseñar la portada,
 * y sólo entonces se avisa a la app para que abra el lector.
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
 *
 * DECISIONES DE DISEÑO
 * -----------------------------------------------------------------------------
 * 1. Color de acento. NO se inventa uno: se usa el que ya fija
 *    `src/css/tokens.css` para este producto, `--accent-read: #2f6b4f` (verde
 *    bosque) con `--wood: #8b5e3c`. Encaja con la metáfora (madera + plantas),
 *    se distingue del naranja de Notes (#E07A3C) y del resto de hermanas, y
 *    sobre crema da contraste AA (~5.2:1). En modo oscuro ese verde pleno se
 *    queda corto sobre #151515, así que `bookshelf.css` define además
 *    `--ihr-accent-legible`, que en oscuro sube a un verde claro (#8FBF9E) y
 *    se usa SÓLO para texto e iconos, nunca para superficies.
 *
 * 2. Madera y baldas. Mueble completo en una escena 3D, con textura de nogal
 *    de src/assets/library. Una transformación común gira y aleja el conjunto.
 *
 * 3. Los lomos conservan geometría y acabado deterministas. El color y la
 *    familia tipográfica se ajustan a la portada rasterizada: se muestrea su
 *    tono dominante y se compara el título visible con varias familias
 *    tipográficas disponibles en la app. Sin portada legible,
 *    se conserva el aspecto de reserva. Con `pageCount`/`sizeBytes` el grosor
 *    es real, no inventado.
 *
 * 4. Plantas. Macetas y hojas con volumen dentro de la misma escena.
 *    Las plantas de instalaciones antiguas se migran al catálogo actual.
 *
 * 5. Modelo propio en book-model.js: malla elíptica continua, tapas y hojas.
 *    Three.js dibuja la misma geometría en la balda y durante el giro.
 *    La textura del título sigue los UV del lomo. La apertura añade 10° de
 *    inclinación para mostrar su sección superior y el volumen de la encuadernación.
 *
 * 6. Un contexto WebGL compartido dibuja la estantería y la inserción del libro.
 *    El libro extraído utiliza su renderizador dedicado durante el giro y la apertura.
 *    Sólo se redibuja al cambiar algo o durante una animación. Los libros
 *    alejados del área visible liberan sus modelos; los botones DOM mantienen
 *    foco y accesibilidad en las posiciones proyectadas de los libros.
 *
 * 7. Táctil. Activación por `click` (funciona con teclado y lector de
 *    pantalla), feedback de presión en `pointerdown` para ver qué lomo se va
 *    a abrir antes de soltar, y cancelación si el dedo se desplaza más de
 *    12px: en una estantería los lomos son estrechos y están pegados, y sin
 *    esto cada scroll abriría un libro. Ancho mínimo de lomo 28px (26px en
 *    pantallas < 360px) con zona de acierto extra a cada lado.
 *
 * 8. El giro inicial termina en una portada interactiva. Un toque en ella
 *    abre la portada y acerca la página guardada hasta el lector. Este se
 *    prepara detrás de la cubierta; los controles aparecen tras el traspaso.
 *
 * 9. Marcapáginas. Cada libro empezado lleva una cinta de raso que asoma por
 *    arriba del lomo. La cinta 3D ocupa entre el 9 y el 17 % de la altura del
 *    libro y comparte proporciones en la balda y al sacarlo. El respaldo DOM
 *    vive dentro del botón sin recortar su parte superior. La balda reserva
 *    `--ihr-bookmark-room` para dejar espacio al tejido y su curvatura.
 *
 * La geometría vive en `book-model.js`; la distribución, en `bookshelf-layout.js`. No sabe
 * nada de PDF.js, foliate, Drive ni IndexedDB: recibe libros y avisa cuando
 * hay que abrir uno.
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

const DEFAULTS = Object.freeze({
  autoOpen: true,        // tras revelar la portada, avisar a la app
  holdMs: 320,           // pausa para que la portada se vea antes de abrir
  revealDuration: 680,
  returnDuration: 460,
  sections: false,      // la biblioteca es una estantería continua
  sort: 'none',         // conserva el orden guardado y permite organizarlo a mano
  minimumShelves: 3,
  shelfPadding: 16,
  gap: 0,
  plantEvery: 5,
  coverRatio: 0.66,      // ancho/alto de portada: proporción de libro comercial
  texts: DEFAULT_TEXTS
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
  const shelfCtx = shelfNative.shelf_mount(shelfEnv, container, booksOrOptions, maybeOptions, DEFAULTS, DEFAULT_TEXTS);
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
