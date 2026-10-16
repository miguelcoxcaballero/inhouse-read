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

const ROOF_PATH = 'M4 24 L20 8 L36 24';
const TAP_SLOP = 12;
// A click a pointer produced, as opposed to the keyboard or assistive tech.
// Chromium can deliver a touch's compatibility click with detail 0 (seen on
// a tap whose pointerup restyled the button), so the pointer type counts too.
const pointerClick = event => event.detail > 0 || ['touch', 'mouse', 'pen'].includes(event.pointerType);
const SHELF_VIEW_STORAGE_KEY = 'inhouse-read-shelf-view';
const SHELF_TYPE_STORAGE_KEY = 'inhouse-read-shelf-type';

function storedShelfType() { return needRustShelf().shelf_stored_type(shelfEnv); }
function savedShelfPlants() { return needRustShelf().shelf_saved_plants(shelfEnv); }
function savedShelfLamps() { return needRustShelf().shelf_saved_lamps(shelfEnv); }
const SHELF_VIEW_MODES = Object.freeze({ SPINE:'spine', ISOMETRIC:'isometric' });
const ICONS = Object.freeze({
  drive: ['M9 3h6l7 12-3 5H5l-3-5L9 3Z', 'm9 3 7 12H2', 'm15 3-7 12 3 5'],
  read: ['M3 5.5c3-1 6-.5 9 1.5 3-2 6-2.5 9-1.5v14c-3-1-6-.5-9 1.5-3-2-6-2.5-9-1.5v-14Z', 'M12 7v14'],
  download: ['M12 3v12', 'm7 10 5 5 5-5', 'M4 16v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4'],
  check: ['m5 12 4 4L19 6'],
  close: ['m6 6 12 12', 'M18 6 6 18'],
  pipette: ['m19 5-2-2a2.12 2.12 0 0 0-3 0l-1 1 5 5 1-1a2.12 2.12 0 0 0 0-3Z', 'm14 5 5 5', 'm3 21 3-1 11-11-3-3L3 17l-1 3Z'],
  // Pincel: el editor cambia el aspecto del lomo (color, letras, acabados).
  brush: ['m9.06 11.9 8.07-8.06a2.85 2.85 0 1 1 4.03 4.03l-8.06 8.08', 'M7.07 14.94c-1.66 0-3 1.35-3 3.02 0 1.33-2.5 1.52-2 2.02 1.08 1.1 2.49 2.02 4 2.02 2.2 0 4-1.8 4-4.04a3.01 3.01 0 0 0-3-3.02Z']
});
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
  gap: 3,
  plantEvery: 5,
  coverRatio: 0.66,      // ancho/alto de portada: proporción de libro comercial
  texts: DEFAULT_TEXTS
});

// The functions of other modules the shelf module's parts call, looked up when they are called (a module
// replaced after the shelf was built is still the one called).
const shelfEnv = {
  displayBookTitle: (...args) => displayBookTitle(...args),
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
  analyzeCoverAppearance: (...args) => analyzeCoverAppearance(...args),
  notifyCloudSettingsChanged: (...args) => notifyCloudSettingsChanged(...args),
  getCatalogLamp: (...args) => getCatalogLamp(...args),
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

/* ------------------------------------------------------------------ *
 * Utilidades DOM
 * ------------------------------------------------------------------ */

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value == null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'html') node.innerHTML = value;
    else if (key === 'style') node.setAttribute('style', value);
    else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else node.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of [].concat(children)) {
    if (child == null) continue;
    node.append(child);
  }
  return node;
}

function svgIcon(paths, { viewBox = '0 0 24 24', className = 'ihr-icon' } = {}) {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', viewBox);
  svg.setAttribute('class', className);
  svg.setAttribute('fill', 'none');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  for (const d of [].concat(paths)) {
    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d', d);
    path.setAttribute('stroke-width', '2');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    svg.append(path);
  }
  return svg;
}

function roofMark(className = 'ihr-roof') {
  return svgIcon(ROOF_PATH, { viewBox: '0 0 40 28', className });
}


function prefersReducedMotion() {
  return (
    typeof matchMedia === 'function' &&
    matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

function storedShelfViewMode(fallback = SHELF_VIEW_MODES.SPINE) { return needRustShelf().shelf_stored_view(fallback); }
function normalizeArgs(second, third) { return needRustShelf().shelf_normalize_args(second, third); }

/* ------------------------------------------------------------------ *
 * Componente
 * ------------------------------------------------------------------ */

// An earlier build kept a ~1 MB picture of the shelf in localStorage; the browser
// reads all of localStorage at startup, so it is dropped.
function forgetBootPoster() { needRustShelf().shelf_forget_boot_poster(); }

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
  const { books, options } = normalizeArgs(booksOrOptions, maybeOptions);

  const opts = withDefaults(DEFAULTS, options);
  opts.texts = withDefaults(DEFAULT_TEXTS, options.texts);
  // Nombres del handoff y nombres genéricos: valen los dos.
  const onOpen = options.onOpenBook || options.onBookOpen;
  const onPickLocal = options.onPickLocalFile || options.onAddBooks;
  const onDrive = options.onOpenDrive;
  const savedPlants = savedShelfPlants();

  const state = {
    books: Array.isArray(books) ? books.slice() : [],
    shelfWidth: 0,
    metadataContext: null,
    shelfType:options.shelfType ? normalizeShelfType(options.shelfType) : storedShelfType(),
    busy: false,
    session: null,
    pendingSelection: null,
    objectUrls: new Set(),
    destroyed: false,
    frame: 0,
    coverAppearances: new Map(),
    reliefProposals: new Map(),
    appearanceTasks: new Map(),
    itemsById: new Map(),
    placementObjects: [],
    plants: savedPlants || [],
    lamps: savedShelfLamps(),
    plantsInitialized: savedPlants !== null,
    appearanceRefreshPending: false,
    pressedBookId: null,
    lastOpened: null,
    returnMotion: null,
    arranging: false,
    dragSession: null,
    trashRemoval: null,
    trashStatusTimer: 0,
    suppressOpenBookId: null,
    suppressLampClickKey: null,
    queuedBooks: null,
    compatibilityTapTimer: 0,
    pendingRemovals: new Set(),
    renderQueued: false,
    reorderTimer: 0,
    appearancesReady: true,
    appearanceGeneration: 0,
    shelfScene: null,
    presentationActive: true,
    returningBookId: null,
    returnSlotWaiter: null,
    useScene: Boolean((globalThis.WebGLRenderingContext || globalThis.WebGL2RenderingContext) && getBookRenderer()),
    viewMode: Object.values(SHELF_VIEW_MODES).includes(options.viewMode)
      ? options.viewMode
      : storedShelfViewMode()
  };
  const returnViews = createBookReturnCache();
  forgetBootPoster();

  const root = el('div', { class: 'ihr-bookshelf', 'data-ihr-bookshelf': '', role:'region', tabindex:'0',
    'aria-label':'Estantería', 'aria-keyshortcuts':'ArrowLeft ArrowRight',
    'aria-description':'Desliza a la izquierda para ver la estantería de lado y a la derecha para volver a los lomos. También puedes usar las flechas al enfocar la estantería.' });
  const scroller = el('div', { class: 'ihr-bookshelf__scroll' });
  const hasBookTrash = typeof options.onBookRemove === 'function';
  const hasTrash = !opts.sections || hasBookTrash;
  const trashNode = hasTrash ? el('div', {
    class:'ihr-shelf-trash', role:'img',
    'aria-label':'Papelera: arrastra un libro, una planta o una lámpara para retirarlos de la estantería',
    title:'Retirar de la estantería'
  }, [
    el('span', { class:'ihr-shelf-trash__body', 'aria-hidden':'true' }),
    el('span', { class:'ihr-shelf-trash__lid', 'aria-hidden':'true' }),
    el('span', { class:'ihr-shelf-trash__label', text:'Retirar', 'aria-hidden':'true' })
  ]) : null;
  // Errors stay visible. A successful removal is only announced to assistive
  // technology: the object leaving the shelf is its own confirmation.
  const trashStatus = hasTrash ? el('div', { class:'ihr-trash-status', role:'status', 'aria-live':'polite' }) : null;
  const trashAnnounce = hasTrash ? el('div', { class:'ihr-trash-announce visually-hidden', role:'status', 'aria-live':'polite' }) : null;
  if (trashNode) {
    trashNode.hidden = state.viewMode !== SHELF_VIEW_MODES.ISOMETRIC;
    trashNode.inert = trashNode.hidden;
  }
  root.classList.toggle('has-trash', hasTrash);
  root.append(scroller);
  const shelfViewGesture = createShelfViewGesture({ root, scroller,
    getMode:() => state.viewMode, setMode:setViewMode,
    isEnabled:() => !state.destroyed && !state.busy && !state.session && !state.returnMotion &&
      !state.trashRemoval && !state.arranging && (state.shelfScene?.getInspectionZoom?.() || 1) <= 1.001,
    onGestureStart:event => {
      if (state.dragSession) {
        state.dragSession.cancelled = true;
        finishSpineDrag(event, state.dragSession.node, true);
      }
      state.pressedBookId = null;
      for (const node of scroller.querySelectorAll('.is-pressed')) node.classList.remove('is-pressed', 'is-press-pending');
    }
  });
  const shelfZoom = createShelfZoom({root,scroller,getScene:()=>state.shelfScene,
    isEnabled:()=>Boolean(state.shelfScene && state.viewMode === SHELF_VIEW_MODES.ISOMETRIC &&
      !state.busy && !state.session && !state.returnMotion && !state.trashRemoval),
    onGestureStart:()=>{
      if (state.dragSession) finishSpineDrag({pointerId:state.dragSession.pointerId},state.dragSession.node,true);
      state.pressedBookId = null;
      for (const node of scroller.querySelectorAll('.is-pressed')) node.classList.remove('is-pressed', 'is-press-pending');
      state.shelfScene?.beginInspectionGesture?.();
    }});
  if (trashStatus) root.append(trashStatus, trashAnnounce);
  const plantCatalog = createLazyPlantCatalog({ onAdd:addCatalogPlant, onAddLamp:addCatalogLamp, shelfType:state.shelfType,
    onShelfChange:({ shelfType }, { whenClosed = run => run() } = {}) => {
      state.shelfType = normalizeShelfType(shelfType);
      try { localStorage.setItem(SHELF_TYPE_STORAGE_KEY, state.shelfType); notifyCloudSettingsChanged(SHELF_TYPE_STORAGE_KEY); } catch { /* Local preference only. */ }
      whenClosed(() => { if (!state.destroyed) render(); });
    },
    // The camera flies from the booklet in the room into the catalogue page.
    // The room is a scaled picture meanwhile: hold its repaints, whose
    // measurements would include that scale, until it is back in place.
    motionTarget:() => root.closest('.screen') || root,
    onMotion:phase => { state.shelfScene?.setPaintHeld?.(phase === 'start'); } });
  let catalogPrepare = 0;
  // Fetch the catalogue when the shelf settles, but leave its GPU studio for
  // the first open, after the camera flight. Hidden PMREM/shader work competes
  // with shelf redraws even when scheduled in an idle callback.
  function prepareCatalogWhenIdle(delay = 0) {
    if (catalogPrepare || !catalogNodeEnabled() || state.viewMode !== SHELF_VIEW_MODES.ISOMETRIC) return;
    const run = () => { if (!state.destroyed) plantCatalog.prefetch(); };
    const idle = () => typeof requestIdleCallback === 'function' ? requestIdleCallback(run, { timeout:4000 }) : setTimeout(run, 1500);
    catalogPrepare = delay ? setTimeout(idle, delay) : idle();
  }
  function catalogNodeEnabled() { return !opts.sections; }
  const catalogNode = !opts.sections ? el('button', {
    type:'button', class:'ihr-shelf-catalog', hidden:'', tabindex:'-1',
    'aria-label':'Abrir catálogo IKEA de plantas, estanterías e iluminación', title:'Catálogo · IKEA',
    onClick:() => {
      if (!state.busy && !state.session && !state.dragSession && !state.returnMotion && state.viewMode === SHELF_VIEW_MODES.ISOMETRIC) {
        plantCatalog.setShelfType(state.shelfType);
        plantCatalog.open(catalogNode);
      }
    }
  }, [el('span', { class:'ihr-shelf-catalog__brand', text:'IKEA', 'aria-hidden':'true' }),
    el('span', { class:'ihr-shelf-catalog__title', text:'PLANTAS', 'aria-hidden':'true' }),
    svgIcon(['M7 15h10l-1.5 7h-7L7 15Z', 'M12 15V4',
      'M12 10C5 10 5 3 5 3c6 0 7 7 7 7Z', 'M12 8s0-6 7-7c0 6-7 7-7 7Z'],
      { className:'ihr-shelf-catalog__drawing' })]) : null;
  // La app monta hoy "añadir libro" y "Drive" en su propio header, así que la
  // barra de acciones de la estantería está apagada por defecto para no
  // duplicar controles. Se enciende con `showActions: true` (o sola, si se
  // pasa `onOpenDrive`, que es la integración del handoff original).
  if ((options.showActions ?? Boolean(onDrive)) && (onPickLocal || onDrive)) {
    root.append(buildActionBar());
    root.classList.add('ihr-bookshelf--with-actions');
  }
  // One URL per saved cover: IndexedDB returns fresh record/Blob objects after every progress write, and the
  // decoded pixels must survive refreshes. The shelf module owns both tables.
  const coverCache = new WeakMap();
  const savedCoverUrls = new Map();
  // The shelf screen's parts that live in the shelf module share this context: the state object, the
  // options and the functions of other modules they call.
  const shelfNative = needRustShelf();
  // `legacy` holds what the shelf module still asks of this closure; it shrinks as those parts move.
  const shelfCtx = new shelfNative.RustShelfCtx({ state, opts, options, env:shelfEnv, root, scroller, container,
    onOpen, coverCache, savedCoverUrls, trashNode, trashStatus, trashAnnounce, hasTrash, hasBookTrash, catalogNode, legacy:{
    returnViews,
    prepareInitialAppearances: () => prepareInitialAppearances(),
    buildPreparingState: () => buildPreparingState(),
    buildEmptyState: () => buildEmptyState(),
    buildGeometryStatus: books => buildGeometryStatus(books),
    buildLibraryHeading: text => buildLibraryHeading(text),
    buildLibraryEmpty: () => buildLibraryEmpty(),
    buildStage: width => buildStage(width),
    buildSection: (section, count) => buildSection(section, count),
    buildShelf: shelf => buildShelf(shelf),
    syncShelfZoom: () => shelfZoom.sync(),
    clearCompatibilityTapRefresh: () => clearCompatibilityTapRefresh(),
    deferCompatibilityTapRefresh: () => deferCompatibilityTapRefresh(),
    applyDeferredShelfUpdates: () => applyDeferredShelfUpdates(),
    scheduleRender: () => scheduleRender(),
    render: () => render(),
    refresh: books => refresh(books),
    buildSpine: item => buildSpine(item),
    bookGeometryState: book => bookGeometryState(book),
    measure: () => measure()
  } });
  let shelfCtxLive = true;
  container.append(root);
  // Opened straight in the diagonal view: leave the startup work first.
  prepareCatalogWhenIdle(6000);

  /* --------------------------- portadas --------------------------- */

  // Covers (their URLs, the reading of their colour and cloth, the refresh of the spines that show them) are the
  // shelf module's.
  function resolveCover(book) { return shelfCtx.resolveCover(book); }
  function coverKeyFor(book) { return shelfCtx.coverKeyFor(book); }
  function maybeRefreshAppearanceStyles() { if (shelfCtxLive) shelfCtx.maybeRefreshAppearanceStyles(); }
  function resolveCoverAppearance(book, knownUrl) { return shelfCtx.resolveCoverAppearance(book, knownUrl); }
  function coverRatioFor(style, fallback) { return shelfCtx.coverRatioFor(style, fallback); }
  function resolveCoverImmediately(book) { return shelfCtx.resolveCoverImmediately(book); }
  function warmCover(book) { if (shelfCtxLive) shelfCtx.warmCover(book); }

  // The style of a shelf item, the CSS variables of a style and their update on a node are the shelf module's.
  function applyCoverAppearance(item, appearance) { return shelfNative.shelf_apply_cover_appearance(shelfCtx, item, appearance); }
  function spineStyleVars(style) { return shelfNative.shelf_spine_style_vars(style); }
  function updateBookStyleVars(node, style) { shelfNative.shelf_update_book_style_vars(node, style); }



  // El retorno desde el lector necesita su primer fotograma antes de que el
  // navegador pinte la estantería. La resolución normal usa `await` incluso
  // cuando la portada ya está en IndexedDB como Blob y deja un fotograma vacío.
  /** Precarga en pointerdown: cuando el giro enseña la cara, ya está pintada. */
  /* --------------------------- construcción --------------------------- */

  function buildActionBar() {
    const bar = el('div', { class: 'ihr-actions', role: 'group', 'aria-label': 'Añadir libros' });
    if (onPickLocal) {
      const button = el('button', {
        type: 'button',
        class: 'ihr-btn ihr-btn--primary',
        onClick: () => onPickLocal()
      });
      button.append(
        svgIcon(['M12 5v14', 'M5 12h14'], { className: 'ihr-icon' }),
        el('span', { text: opts.texts.addLocal })
      );
      bar.append(button);
    }
    if (onDrive) {
      const button = el('button', {
        type: 'button',
        class: 'ihr-btn',
        disabled: options.driveAvailable === false,
        title: options.driveAvailable === false ? 'Drive no disponible' : null,
        onClick: () => onDrive()
      });
      button.append(
        svgIcon(ICONS.drive, {
          className: 'ihr-icon'
        }),
        el('span', { text: opts.texts.addDrive })
      );
      bar.append(button);
    }
    return bar;
  }

  function buildPreparingState() {
    return el('div', {
      class: 'ihr-library-loading',
      role: 'status',
      'aria-live': 'polite',
      'aria-label': 'Preparando tu estantería'
    }, [
      el('span', { class: 'ihr-library-loading__spinner', 'aria-hidden': 'true' }),
      el('span', { text: 'Cargando…' })
    ]);
  }

  // The objects on the shelf (lamps, plants), the drag that moves them and the bin are the shelf module's.
  const objectKey = node => shelfCtx.objectKey(node);
  function savePlants({ strict = false, initial = false } = {}) { if (shelfCtxLive) shelfCtx.savePlants(strict, initial); }
  function lampShelfObject(record) { return shelfCtx.lampShelfObject(record); }
  function plantScale() { return shelfCtx.plantScale(); }
  function plantShelfObject(record, scale) { return shelfCtx.plantShelfObject(record, scale); }
  function updateLampControl(node, record) { if (shelfCtxLive) shelfCtx.updateLampControl(node, record); }
  function toggleLamp(node) { if (shelfCtxLive) shelfCtx.toggleLamp(node); }
  // The catalogue may answer after the shelf is gone: the original refused then, as busy.
  function addCatalogLamp(request, catalogOptions) {
    return shelfCtxLive ? shelfCtx.addCatalogLamp(request, catalogOptions) : Promise.reject(new Error('Espera a que termine la animación.'));
  }
  function addCatalogPlant(request, catalogOptions) {
    return shelfCtxLive ? shelfCtx.addCatalogPlant(request, catalogOptions) : Promise.reject(new Error('Espera a que termine la animación.'));
  }
  function moveObjectWithKeyboard(event, node) { if (shelfCtxLive) shelfCtx.moveObjectWithKeyboard(event, node); }
  function reorderSpine(source, target, after = false) { if (shelfCtxLive) shelfCtx.reorderSpine(source, target, after); }
  function startSpineDrag(event, node) { if (shelfCtxLive) shelfCtx.startSpineDrag(event, node); }
  function moveSpineDrag(event, node) { if (shelfCtxLive) shelfCtx.moveSpineDrag(event, node); }
  function isTouchTapRelease(event, drag, node, candidate) { return shelfCtx.isTouchTapRelease(event, drag, node, candidate); }
  function finishSpineDrag(event, node, cancelled = false, activateTouch = false) { if (shelfCtxLive) shelfCtx.finishSpineDrag(event, node, cancelled, activateTouch); }
  function cancelTrashRemoval() { if (shelfCtxLive) shelfCtx.cancelTrashRemoval(); }
  function removeBookInTrash(node, trashOptions) { return shelfCtx.removeBookInTrash(node, trashOptions); }
  function discardTouchCompatibilityClick(release) { if (shelfCtxLive) shelfCtx.discardTouchCompatibilityClick(release); }
  function placementConfig() { return shelfCtx.placementConfig(); }
  function clearPlacementPreview(drag) { if (shelfCtxLive) shelfCtx.clearPlacementPreview(drag); }
  function shelfPadding() { return shelfCtx.shelfPadding(); }

  /** Real IKEA sizes are millimetres; scene pixels follow the shelf's scale. */
  /** A touch released where it started, on `node`'s own unmoved hold. The
   * touch is this button's validated contact (`candidate`), or a contact
   * another button received whose 3D hit was this one (`drag.redirected`). */
  function bookGeometryState(book) { return options.getBookGeometryState?.(book) || 'ready'; }

  function buildGeometryStatus(books) {
    const status = el('div', { class:'ihr-library-loading ihr-library-loading--books', role:'status', 'aria-live':'polite' });
    for (const book of books) {
      const state = bookGeometryState(book);
      const row = el('div', { class:'ihr-library-loading__book' });
      if (state === 'pending') row.append(el('span', { class:'ihr-library-loading__spinner', 'aria-hidden':'true' }));
      const title = displayBookTitle(book) || book.name || 'Libro';
      row.append(el('span', { text:state === 'pending' ? `Preparando ${title}…`
        : state === 'needs-source' ? `${title} · vuelve a seleccionar el archivo`
          : `${title} · no se pudo contar su texto` }));
      row.append(el('button', { type:'button', class:'ihr-btn ihr-btn--ghost',
        onClick:() => state === 'failed' ? options.onBookGeometryRetry?.(book) : onOpen?.(book)
      }, [el('span', { text:state === 'failed' ? 'Reintentar' : 'Abrir' })]));
      status.append(row);
    }
    return status;
  }

  function spineBodyView(body, item) {
    const { book, style } = item;
    const height = (window.innerWidth >= 600 ? 200 : 172) * style.heightRatio;
    return bookView(body, book, style, {
      width: height * coverRatioFor(style), height, thickness: style.width,
      viewportWidth: item.displayWidth ?? style.width, viewportHeight: height,
      centerX: (item.displayWidth ?? style.width) / 2, centerY: height / 2,
      shelf: true,
      shelfView: state.viewMode
    });
  }

  function buildSpine(item) {
    const { book, style } = item;
    state.itemsById.set(String(book.id ?? book.path ?? book.title ?? 'book'), item);
    const bookmark = bookmarkFor(book);
    const node = el('button', {
      type: 'button',
      class: `ihr-spine ihr-spine--${style.texture}`,
      'data-book-id': book.id ?? '',
      'aria-label': bookmark
        ? `${opts.texts.openAria(book)}, ${opts.texts.progressAria(bookmark.percent)}`
        : opts.texts.openAria(book),
      title: 'Mantén pulsado para mover',
      'aria-keyshortcuts': 'Shift+ArrowLeft Shift+ArrowRight Shift+ArrowUp Shift+ArrowDown',
      'aria-description': 'Mantén pulsado para sacar el libro y moverlo. Usa Mayús y las flechas para cambiar su posición o balda.',
      style:
        `--ihr-spine-w:${item.displayWidth ?? style.width}px;` +
        `--ihr-spine-h:${Math.round(style.heightRatio * 100)}%;` +
        spineStyleVars(style) +
        (item.tilt ? `--ihr-spine-tilt:${item.tilt}deg;` : '')
    });
    if (state.returningBookId === String(book.id)) node.classList.add('is-away');
    if (item.tilt) node.classList.add('is-tilted');
    // En un lomo estrecho el autor no cabe sin pisar al título.
    if (style.width < 32) node.classList.add('ihr-spine--slim');

    const body = el('span', { class: 'ihr-spine__body', 'aria-hidden': 'true' });
    const view = state.useScene ? null : spineBodyView(body, item);
    if (view) view.dispose(false); // retain the rendered snapshot, free mesh/textures
    else if (!state.useScene) body.append(el('span', { class: 'ihr-spine__label' }, [
      el('span', { class: 'ihr-spine__title', text: book.spineTitleOverride || book.title || 'Sin título' }),
      normalizeBookAuthor(book.author) ? el('span', { class: 'ihr-spine__author', text: normalizeBookAuthor(book.author) }) : null
    ]));
    node.append(body);
    /*
      Marcapáginas que asoma por arriba: su longitud visible es el progreso.
      Va DENTRO del botón a propósito (no en un envoltorio): así hereda la
      inclinación, el levantamiento al pulsar y el `is-away`, y el nodo que
      mide la animación de apertura sigue siendo exactamente el mismo botón
      con la misma caja — getBoundingClientRect() no cuenta lo que desborda.
      Para poder asomar, `.ihr-spine` ya no lleva overflow:hidden (ver
      bookshelf.css). En la cara del lomo del libro que gira no se ve: esa
      cara recorta su contenido, y el marcapáginas se esconde al salir el
      libro de la balda, como si se hubiera metido entre las hojas.
    */
    if (bookmark) {
      node.classList.add('has-bookmark');
      if (bookmark.finished) node.classList.add('is-finished');
      if (!view && !state.useScene) node.append(
        el('span', {
          class: 'ihr-spine__bookmark',
          'aria-hidden': 'true',
          style: `--ihr-bookmark-peek:${bookmark.peek}px`
        })
      );
    }

    // Presión: se ve qué lomo se va a abrir antes de levantar el dedo.
    let start = null, touch = null, ignoreTouchClick = false;
    node.addEventListener('pointerdown', (event) => {
      if (event.button !== undefined && event.button !== 0) return;
      if (event.isPrimary === false || state.dragSession && state.dragSession.pointerId !== event.pointerId) {
        ignoreTouchClick = true;
        if (touch) touch.cancelled = true;
        if (state.dragSession) { state.dragSession.cancelled = true; clearTimeout(state.dragSession.timer); }
        return;
      }
      ignoreTouchClick = false;
      // A new contact is a new gesture, even before the previous hold's
      // zero-delay compatibility-click cleanup has had a turn to run.
      state.suppressOpenBookId = null;
      start = { x: event.clientX, y: event.clientY };
      // Validate before pressure feedback moves the curved surface. Do not
      // redirect this button's touch to a different or occluded book.
      touch = event.pointerType === 'touch' ? {
        pointerId:event.pointerId, ...start, cancelled:false,
        valid:!state.shelfScene || state.shelfScene.getBookAtPoint(event.clientX, event.clientY) === node
      } : null;
      state.pressedBookId = String(item.book.id ?? item.book.path ?? item.book.title ?? 'book');
      if (state.shelfScene) node.classList.add('is-pressed', 'is-press-pending');
      else node.classList.add('is-pressed');
      warmCover(item.book);
    });
    const release = () => {
      start = null;
      node.classList.remove('is-pressed', 'is-press-pending');
      const id = String(item.book.id ?? item.book.path ?? item.book.title ?? 'book');
      if (state.pressedBookId === id) {
        state.pressedBookId = null;
        setTimeout(maybeRefreshAppearanceStyles, 0);
      }
    };
    node.addEventListener('pointerup', event => { if (!touch || touch.pointerId === event.pointerId) release(); });
    node.addEventListener('pointercancel', event => {
      if (touch?.pointerId === event.pointerId) { touch = null; ignoreTouchClick = true; }
      release();
    });
    node.addEventListener('pointerleave', () => { if (touch) touch.cancelled = true; release(); });
    node.addEventListener('pointermove', (event) => {
      if (!start) return;
      if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > TAP_SLOP) {
        if (touch) touch.cancelled = true;
        release(); // el dedo se ha ido a hacer scroll: esto no era un tap
      }
    });
    node.addEventListener('click', event => {
      // Some Android/Chromium taps after a pan have no compatibility click;
      // others still deliver one. The validated pointerup handles both once.
      // A detail-zero activation belongs to the keyboard or assistive tech.
      if (pointerClick(event) && (ignoreTouchClick || touch)) { ignoreTouchClick = false; touch = null; return; }
      if (state.arranging || state.suppressOpenBookId) { state.suppressOpenBookId = null; return; }
      const hit = pointerClick(event) ? state.shelfScene?.getBookAtPoint(event.clientX, event.clientY) : null;
      if (pointerClick(event) && state.shelfScene && !hit) return;
      openBook(hit || node, hit ? state.itemsById.get(hit.dataset.bookId) || item : item);
    });
    node.addEventListener('keydown', event => {
      if (hasBookTrash && event.key === 'Delete' && !event.repeat) {
        event.preventDefault();
        if (state.busy || state.session || state.dragSession || state.returnMotion) return;
        state.shelfScene?.flush();
        const duration = prefersReducedMotion() ? 1 : 820;
        const motion = state.shelfScene?.animateBookToTrash(node, { duration });
        void removeBookInTrash(node, { motion, duration });
        return;
      }
      if (!opts.sections) { moveObjectWithKeyboard(event, node); return; }
      if (!event.shiftKey || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
      event.preventDefault();
      const section = node.closest('.ihr-section');
      const siblings = [...section.querySelectorAll('.ihr-spine')];
      const current = siblings.indexOf(node);
      const target = siblings[current + (event.key === 'ArrowLeft' ? -1 : 1)];
      if (target) reorderSpine(node, target, event.key === 'ArrowRight');
    });
    node.addEventListener('pointerdown', event => startSpineDrag(event, node));
    node.addEventListener('pointermove', event => moveSpineDrag(event, state.dragSession?.node || node));
    node.addEventListener('pointerup', event => {
      const candidate = touch?.pointerId === event.pointerId ? touch : null;
      const drag = state.dragSession;
      const activate = isTouchTapRelease(event, drag, node, candidate) && (Boolean(candidate) || drag.bookTapValid);
      finishSpineDrag(event, drag?.node || node, false, activate);
      if (candidate) { touch = null; ignoreTouchClick = true; }
      if (activate && node.isConnected && !state.suppressOpenBookId) {
        discardTouchCompatibilityClick(event);
        openBook(node, item);
      }
    });
    node.addEventListener('pointercancel', event => finishSpineDrag(event, state.dragSession?.node || node, true));
    return node;
  }

  function buildPlant(item) {
    item = normalizeShelfPlant({ ...item, key:item.key || `plant:${item.seed}` });
    const plant = resolveCatalogPlant(item);
    const scale = plantScale(), width = item.width * scale, height = item.height * scale;
    const node = el('button', {
      type:'button',
      class: `ihr-plant ihr-plant--${item.variant}`,
      'data-object-id':item.key,
      'data-catalog-id':plant.id, 'data-pot-id':item.potId, 'data-pot-color-id':getPotColor(item.potId,item.potColorId).id,
      'data-plant-seed':item.seed, 'data-plant-variant':item.variant,
      'aria-label':`Mover planta ${plant.name}`,
      'aria-keyshortcuts':'Shift+ArrowLeft Shift+ArrowRight Shift+ArrowUp Shift+ArrowDown Delete',
      'aria-description':'Mantén pulsado para mover la planta o llevarla a la papelera. Usa Mayús y las flechas para cambiar su posición o balda, y Suprimir para retirarla.',
      title:'Mantén pulsado para mover',
      style:
        `--ihr-plant-w:${width}px;` +
        `--ihr-plant-h:${height}px;` +
        '--ihr-plant-overhang:0px'
    });
    node.addEventListener('pointerdown', event => startSpineDrag(event, node));
    node.addEventListener('pointermove', event => moveSpineDrag(event, state.dragSession?.node || node));
    node.addEventListener('pointerup', event => finishSpineDrag(event, state.dragSession?.node || node));
    node.addEventListener('pointercancel', event => finishSpineDrag(event, state.dragSession?.node || node, true));
    node.addEventListener('keydown', event => {
      if (hasTrash && event.key === 'Delete' && !event.repeat) {
        event.preventDefault();
        if (state.busy || state.session || state.dragSession || state.returnMotion) return;
        state.shelfScene?.flush();
        const duration = prefersReducedMotion() ? 1 : 820;
        const motion = state.shelfScene?.animateObjectToTrash(node, { duration });
        void removeBookInTrash(node, { motion, duration });
      } else moveObjectWithKeyboard(event, node);
    });
    return node;
  }

  function buildLamp(item) {
    const lamp = getCatalogLamp(item.lampId);
    const node = el('button', {
      type:'button', class:`ihr-lamp ihr-lamp--${lamp.id}`,
      'data-object-id':item.key, 'data-lamp-id':lamp.id, 'data-lamp-mount':lamp.mount,
      'aria-keyshortcuts':'Enter Space Shift+ArrowLeft Shift+ArrowRight Shift+ArrowUp Shift+ArrowDown Delete',
      'aria-description':'Toca para encender o apagar. Mantén pulsado para cambiar su posición o balda. Usa Mayús y las flechas para moverla, y Suprimir para retirarla.',
      style:`--ihr-lamp-w:${item.width}px;--ihr-lamp-h:${item.height}px`
    });
    updateLampControl(node, item);
    if (!state.useScene) {
      node.innerHTML = lampCatalogIllustration(lamp.id);
      node.querySelector('svg').setAttribute('preserveAspectRatio','none');
    }
    let touch = null, ignoreTouchClick = false;
    node.addEventListener('pointerdown', event => {
      if (event.button !== undefined && event.button !== 0) return;
      if (event.isPrimary === false || state.dragSession && state.dragSession.pointerId !== event.pointerId) {
        if (touch) touch.cancelled = true;
        ignoreTouchClick = true;
        if (state.dragSession) { state.dragSession.cancelled = true; clearTimeout(state.dragSession.timer); }
        return;
      }
      ignoreTouchClick = false;
      // Validate the actual 3D lamp before the contact changes its projection.
      // A later compatibility click may be absent or hit a different surface.
      touch = event.pointerType === 'touch' ? {
        pointerId:event.pointerId, x:event.clientX, y:event.clientY, cancelled:false,
        valid:!state.shelfScene || state.shelfScene.getObjectAtPoint(event.clientX, event.clientY) === node
      } : null;
      startSpineDrag(event, node);
    });
    node.addEventListener('pointermove', event => {
      if (touch?.pointerId === event.pointerId && Math.hypot(event.clientX-touch.x, event.clientY-touch.y) > TAP_SLOP)
        touch.cancelled = true;
      moveSpineDrag(event, state.dragSession?.node || node);
    });
    node.addEventListener('pointerleave', () => { if (touch) touch.cancelled = true; });
    node.addEventListener('pointerup', event => {
      const candidate = touch?.pointerId === event.pointerId ? touch : null;
      const drag = state.dragSession;
      const activate = isTouchTapRelease(event, drag, node, candidate);
      finishSpineDrag(event, drag?.node || node);
      if (candidate) { touch = null; ignoreTouchClick = true; }
      if (activate && node.isConnected && state.suppressLampClickKey !== objectKey(node)) {
        discardTouchCompatibilityClick(event);
        toggleLamp(node);
      }
    });
    node.addEventListener('pointercancel', event => {
      if (touch?.pointerId === event.pointerId) { touch = null; ignoreTouchClick = true; }
      finishSpineDrag(event, state.dragSession?.node || node, true);
    });
    node.addEventListener('click', event => {
      if (pointerClick(event) && (ignoreTouchClick || touch)) { ignoreTouchClick = false; touch = null; return; }
      if (pointerClick(event) && state.suppressLampClickKey === objectKey(node)) { state.suppressLampClickKey = null; return; }
      if (!pointerClick(event)) state.suppressLampClickKey = null;
      if (pointerClick(event) && state.shelfScene && state.shelfScene.getObjectAtPoint(event.clientX, event.clientY) !== node) return;
      toggleLamp(node);
    });
    node.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') state.suppressLampClickKey = null;
      if (hasTrash && event.key === 'Delete' && !event.repeat) {
        event.preventDefault();
        if (state.busy || state.session || state.dragSession || state.returnMotion) return;
        state.shelfScene?.flush();
        const duration = prefersReducedMotion() ? 1 : 820;
        const motion = state.shelfScene?.animateObjectToTrash(node, { duration });
        void removeBookInTrash(node, { motion, duration });
      } else moveObjectWithKeyboard(event, node);
    });
    return node;
  }

  function buildShelf(shelf) {
    const unit = el('div', { class: 'ihr-shelf', 'data-shelf-index':shelf.index });
    const row = el('div', { class: 'ihr-shelf__row' });
    for (const item of shelf.items) {
      const node = item.kind === 'plant' ? buildPlant(item) : item.kind === 'lamp' ? buildLamp(item) : buildSpine(item);
      if (Number.isFinite(item.left)) {
        row.classList.add('has-placements');
        node.style.position = 'absolute';
        node.style.left = `${item.left}px`;
        if (item.kind === 'lamp' && item.mount === 'undershelf') node.style.top = '0';
        else node.style.bottom = '0';
        node.dataset.objectId = item.key;
        node.dataset.shelfIndex = String(shelf.index);
        node.dataset.shelfX = String(item.x);
      }
      row.append(node);
    }
    unit.append(el('div', { class: 'ihr-shelf__back', 'aria-hidden': 'true' }));
    unit.append(row);
    unit.append(el('div', { class: 'ihr-shelf__board', 'aria-hidden': 'true' }));
    return unit;
  }


  function buildEmptyState() {
    return el('div', { class: 'ihr-empty' }, [
      el('div', { class: 'ihr-empty__copy' }, [
        roofMark('ihr-roof ihr-empty__roof'),
        el('h2', { class: 'ihr-empty__title', text: opts.texts.emptyTitle }),
        opts.texts.emptyBody ? el('p', { class: 'ihr-empty__body', text: opts.texts.emptyBody }) : null,
        onPickLocal
          ? el('button', {
              type: 'button',
              class: 'ihr-btn ihr-btn--primary ihr-empty__action',
              text: opts.texts.emptyAction,
              onClick: () => onPickLocal()
            })
          : null
      ])
    ]);
  }

  /* --------------------------- render --------------------------- */

  /**
   * Ancho útil de balda. `options.shelfWidth` lo fija a mano, para montar la
   * estantería en un contenedor de ancho conocido (o en tests sin layout).
   */
  function measure() { return shelfCtx.measure(); }

  /** Los lomos tienen su grosor real (15-45 mm) a la escala de la balda. */

  function setViewMode(mode) {
    if (state.trashRemoval) return;
    if (!Object.values(SHELF_VIEW_MODES).includes(mode) || state.viewMode === mode) return;
    state.viewMode = mode;
    try { localStorage.setItem(SHELF_VIEW_STORAGE_KEY, mode); notifyCloudSettingsChanged(SHELF_VIEW_STORAGE_KEY); } catch { /* Preferencias no bloquean la biblioteca. */ }
    prepareCatalogWhenIdle();
    if (state.shelfScene) {
      root.dataset.viewMode = mode;
      state.shelfScene.setMode(mode); shelfZoom.sync();
    } else render();
  }


  // The render transaction is Rust's; these builders only create its DOM subtrees and listeners.
  function buildLibraryHeading(countText) {
    return el('div', { class:'ihr-library-heading' }, [
      el('h1', { text:'Biblioteca' }),
      el('div', { class:'ihr-library-heading__tools' }, [el('p', { 'aria-live':'polite', text:countText })])
    ]);
  }
  function buildLibraryEmpty() {
    const body = opts.texts.emptyText ?? opts.texts.emptyBody;
    return el('div', { class:'ihr-empty ihr-empty--library' }, [
      el('h2', { class:'ihr-empty__title', text:opts.texts.emptyTitle }),
      body ? el('p', { class:'ihr-empty__body', text:body }) : null,
      onPickLocal ? el('button', { type:'button', class:'ihr-btn ihr-btn--primary ihr-empty__action',
        onClick:() => onPickLocal() }, [svgIcon(['M12 5v14', 'M5 12h14'], { className:'ihr-icon' }), el('span', { text:opts.texts.emptyAction })]) : null
    ]);
  }
  function buildStage(width) {
    const stage = el('div', { class:'ihr-shelf-stage' });
    for (const type of ['selectstart', 'contextmenu', 'dragstart'])
      stage.addEventListener(type, event => event.preventDefault(), { capture:true });
    stage.style.setProperty('--ihr-cabinet-width', `${width}px`);
    return stage;
  }
  function buildSection(section, count) {
    const wrapper = el('section', { class:`ihr-section ihr-section--${section.id}`, 'aria-label':section.title || opts.texts.shelfLabel });
    if (section.title) wrapper.append(el('div', { class:'ihr-section__header' }, [
      el('h2', { class:'ihr-section__title', text:section.title }),
      el('span', { class:'ihr-section__count', text:String(count), 'aria-label':`${count} libros` })
    ]));
    return wrapper;
  }
  function render() { if (shelfCtxLive) shelfCtx.render(); }

  function scheduleRender() { if (shelfCtxLive) shelfCtx.scheduleRender(); }

  function prepareInitialAppearances() { if (shelfCtxLive) shelfCtx.prepareInitialAppearances(); }

  /* --------------------------- apertura --------------------------- */

  // The lifted book (its pull-out, cover, editor, page preparation and hand-over to the reader) is the shelf module's.
  function buildCoverFace(book, coverUrl, style) { return shelfNative.shelf_build_cover_face(shelfCtx, book, coverUrl, style); }
  function openBook(spineEl, item) { return shelfCtx.openBook(spineEl, item); }

  /* --------------------------- ciclo de vida --------------------------- */

  let observer = null;
  const onViewportResize = () => {
    finishReturnSlot(false);
    returnViews.clear();
    cancelTrashRemoval();
    if (state.session?.handleViewportResize?.()) return;
    if (state.dragSession) finishSpineDrag({ pointerId:state.dragSession.pointerId }, state.dragSession.node, true);
    state.pendingSelection?.cancel();
    state.session?.close({ instant:true, silent:true });
    state.returnMotion?.cancel();
    scheduleRender();
  };
  const onVisualViewportChange = () => { clearPlacementPreview(); state.session?.handleViewportResize?.(); };
  window.addEventListener('resize', onViewportResize);
  window.visualViewport?.addEventListener('resize', onVisualViewportChange);
  window.visualViewport?.addEventListener('scroll', onVisualViewportChange);
  if (typeof ResizeObserver === 'function') {
    observer = new ResizeObserver(() => {
      const width = measure();
      // Umbral: evita re-empaquetar por el scrollbar o por 1px de reflow.
      if (Math.abs(width - state.shelfWidth) >= 8) { clearPlacementPreview(); scheduleRender(); }
    });
    observer.observe(scroller);
  }

  prepareInitialAppearances();
  render();
  // The shared scene refreshes its own text textures when fonts arrive. Keep
  // its semantic buttons: rebuilding them here can detach a visible spine
  // between pointerdown/measurement and the following event. The legacy
  // canvas snapshots need only new artwork; DOM lettering reflows itself.
  refreshCanvasFontsAfterPaint(() => {
    if (state.destroyed || state.session || state.useScene) return;
    for (const node of scroller.querySelectorAll('.ihr-spine')) {
      const body = node.querySelector('.ihr-spine__body');
      const item = state.itemsById.get(node.dataset.bookId);
      if (!item || !body?.querySelector('canvas')) continue;
      const replacement = el('span', { class:'ihr-spine__body', 'aria-hidden':'true' });
      const view = spineBodyView(replacement, item);
      if (!view) continue;
      view.dispose(false);
      body.replaceWith(replacement);
    }
  });


  /** Refresh decisions and metadata adoption live in Rust; the host keeps the public option shape. */
  function refresh(nextBooks, { defer = false } = {}) {
    if (shelfCtxLive) shelfCtx.refresh(nextBooks, defer);
  }

  function clearCompatibilityTapRefresh() {
    clearTimeout(state.compatibilityTapTimer);
    state.compatibilityTapTimer = 0;
  }

  function deferCompatibilityTapRefresh() {
    clearCompatibilityTapRefresh();
    state.compatibilityTapTimer = setTimeout(() => {
      state.compatibilityTapTimer = 0;
      applyDeferredShelfUpdates();
    }, 0);
  }

  function applyDeferredShelfUpdates() {
    if (state.destroyed || state.returnMotion || state.reorderTimer || state.busy || state.session || state.dragSession || state.compatibilityTapTimer) return;
    maybeRefreshAppearanceStyles();
    if (state.queuedBooks) {
      const nextBooks = state.queuedBooks;
      state.queuedBooks = null;
      refresh(nextBooks);
    } else if (state.renderQueued) {
      state.renderQueued = false;
      scheduleRender();
    }
  }

  // Non-WebGL pages: the white-paper variant sits under the reader's own canvas,
  // which fades over it (opacity 0 = white paper, 1 = the reading theme).
  function fallbackPageLayers(canvas, snapshot, opacity) { return shelfNative.shelf_fallback_page_layers(canvas, snapshot, opacity); }

  // A destroyed shelf has handed its context back; whatever a late callback asks of it is then moot.
  function setReturningBook(bookId) { if (shelfCtxLive) shelfCtx.setReturningBook(bookId); }
  function finishReturnSlot(ready) { if (shelfCtxLive) shelfCtx.finishReturnSlot(Boolean(ready)); }
  function settleReturnSlot({ beforeRender = false } = {}) { if (shelfCtxLive) shelfCtx.settleReturnSlot(Boolean(beforeRender)); }

  return {
    element: root,
    refresh,
    // Storage may notify for several records in one turn. Keep only the last
    // complete list and commit one semantic/GPU layout on the next frame.
    queueRefresh:nextBooks => refresh(nextBooks, { defer:true }),
    update: refresh,
    returnToShelf: (bookId, returnOptions) => shelfCtxLive ? shelfCtx.returnToShelf(bookId, returnOptions) : Promise.resolve(false),
    updateCloudRecord(record) { if (state.session?.book.id === record.id) state.session.updateCloudRecord?.(record); },
    setPresentationActive(value) {
      state.presentationActive = Boolean(value);
      state.shelfScene?.setPresentationActive?.(state.presentationActive);
    },
    setReturningBook,
    hasReaderOrigin:bookId => state.lastOpened?.book.id === bookId,

    /** Hands the page a lifted book will open on to its 3D model ahead of the tap. */
    prepareOpeningPage(bookId, snapshot, idle = () => new Promise(resolve => setTimeout(resolve, 0))) {
      const session = state.session;
      if (!session?.warmOpeningPage || session.cancelled || session.book.id !== bookId) return Promise.resolve(false);
      return session.warmOpeningPage(snapshot, idle);
    },

    /** Repliega la portada abierta, si la hay. */
    close() {
      finishReturnSlot(false);
      state.pendingSelection?.cancel();
      return state.session?.close() ?? Promise.resolve();
    },

    destroy() {
      state.shelfScene?.setModalBackgroundDeferred?.(null, { resumeHidden:true });
      state.destroyed = true;
      finishReturnSlot(false);
      clearCompatibilityTapRefresh();
      returnViews.clear();
      if (shelfCtxLive) shelfCtx.clearOpeningClick();
      plantCatalog.destroy(); shelfViewGesture.destroy(); shelfZoom.destroy();
      cancelTrashRemoval();
      if (state.dragSession) finishSpineDrag({ pointerId:state.dragSession.pointerId }, state.dragSession.node, true);
      state.pendingSelection?.cancel();
      state.returnMotion?.cancel();
      state.session?.close({ instant: true, silent: true });
      if (state.frame) cancelAnimationFrame(state.frame);
      if (shelfCtxLive) { shelfCtx.clearTimer(state.reorderTimer); shelfCtx.clearTimer(state.trashStatusTimer); }
      observer?.disconnect();
      state.shelfScene?.dispose();
      window.removeEventListener('resize', onViewportResize);
      window.visualViewport?.removeEventListener('resize', onVisualViewportChange);
      window.visualViewport?.removeEventListener('scroll', onVisualViewportChange);
      if (typeof URL?.revokeObjectURL === 'function') {
        for (const url of state.objectUrls) URL.revokeObjectURL(url);
      }
      state.objectUrls.clear();
      root.remove();
      if (shelfCtxLive) { shelfCtxLive = false; shelfCtx.free(); }
    }
  };
}

export default renderBookshelf;
