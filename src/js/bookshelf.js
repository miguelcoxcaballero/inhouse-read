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
import { createShelfPlacementPreview } from './shelf-placement-preview.js';
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
const EASE = 'cubic-bezier(0.4, 0, 0.2, 1)';
const TAP_SLOP = 12;
// A click a pointer produced, as opposed to the keyboard or assistive tech.
// Chromium can deliver a touch's compatibility click with detail 0 (seen on
// a tap whose pointerup restyled the button), so the pointer type counts too.
const pointerClick = event => event.detail > 0 || ['touch', 'mouse', 'pen'].includes(event.pointerType);
const REORDER_HOLD_MS = 440;
const SHELF_VIEW_STORAGE_KEY = 'inhouse-read-shelf-view';
const SHELF_PLANTS_STORAGE_KEY = 'inhouse-read-shelf-plants';
const SHELF_LAMPS_STORAGE_KEY = 'inhouse-read-shelf-lamps';
const SHELF_TYPE_STORAGE_KEY = 'inhouse-read-shelf-type';

function storedShelfType() {
  try { return normalizeShelfType(localStorage.getItem(SHELF_TYPE_STORAGE_KEY)); }
  catch { return 'walnut'; }
}

function savedShelfPlants() {
  try {
    const saved = JSON.parse(localStorage.getItem(SHELF_PLANTS_STORAGE_KEY) || 'null');
    if (!Array.isArray(saved)) return null;
    const plants = saved.map(normalizeShelfPlant).filter(Boolean);
    if (JSON.stringify(plants) !== JSON.stringify(saved)) {
      try { localStorage.setItem(SHELF_PLANTS_STORAGE_KEY, JSON.stringify(plants)); }
      catch { /* The migrated models still work if storage is temporarily unavailable. */ }
    }
    return plants;
  } catch { return null; }
}

function savedShelfLamps() {
  try {
    const saved = JSON.parse(localStorage.getItem(SHELF_LAMPS_STORAGE_KEY) || '[]');
    if (!Array.isArray(saved)) return [];
    const keys = new Set();
    return saved.map(normalizeShelfLamp).filter(record => {
      if (!record || keys.has(record.key)) return false;
      keys.add(record.key); return true;
    });
  } catch { return []; }
}
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

function storedShelfViewMode(fallback = SHELF_VIEW_MODES.SPINE) {
  try {
    const value = localStorage.getItem(SHELF_VIEW_STORAGE_KEY);
    return Object.values(SHELF_VIEW_MODES).includes(value) ? value : fallback;
  } catch { return fallback; }
}

/**
 * WAAPI con red de seguridad: en entornos sin `Element.animate` (jsdom en los
 * tests, navegadores antiguos) aplica el fotograma final y resuelve.
 */
function animate(node, frames, timing) {
  if (typeof node.animate !== 'function') {
    const last = frames[frames.length - 1];
    if (last.transform) node.style.transform = last.transform;
    if (last.opacity != null) node.style.opacity = String(last.opacity);
    return { finished: Promise.resolve(), cancel() {}, isFallback: true };
  }
  return node.animate(frames, timing);
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// A WebView can suspend RAF while changing surfaces. Always release an
// interrupted movement instead of leaving its slot hidden indefinitely.
async function waitForMotion(motion, duration) {
  let watchdog;
  try {
    const completed = await Promise.race([
      motion.finished?.then(value => value !== false, () => true) ?? Promise.resolve(true),
      new Promise(resolve => {
        const check = () => {
          // A capped RAF step keeps the 3D path smooth on slower phones. It
          // can take longer than its nominal duration, so only time out when
          // frames have actually stopped instead of cancelling a live fall.
          if (Number.isFinite(motion.lastFrameTime) && performance.now() - motion.lastFrameTime < 1500) {
            watchdog = setTimeout(check, 1500);
          } else resolve(false);
        };
        watchdog = setTimeout(check, duration + 1500);
      })
    ]);
    if (!completed) motion.cancel?.();
    return completed;
  } finally { clearTimeout(watchdog); }
}

/** Admite `renderBookshelf(c, {books, ...})` y `renderBookshelf(c, books, {...})`. */
function normalizeArgs(second, third) {
  if (Array.isArray(second)) return { books: second, options: third || {} };
  const options = second || {};
  return { books: options.books || [], options };
}

/* ------------------------------------------------------------------ *
 * Componente
 * ------------------------------------------------------------------ */

// An earlier build kept a ~1 MB picture of the shelf in localStorage; the browser
// reads all of localStorage at startup, so it is dropped.
function forgetBootPoster() {
  try { for (const key of ['ihr-poster-img', 'ihr-poster-meta', 'ihr-lib-sig']) localStorage.removeItem(key); } catch { /* storage blocked */ }
}

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
  // The shelf screen's parts that live in the shelf module share this context: the state object, the
  // options and the functions of other modules they call.
  const shelfNative = needRustShelf();
  // `legacy` holds what the shelf module still asks of this closure; it shrinks as those parts move.
  const shelfCtx = new shelfNative.RustShelfCtx({ state, opts, options, env:shelfEnv, root, scroller, container, legacy:{
    returnViews,
    clearCompatibilityTapRefresh: () => clearCompatibilityTapRefresh(),
    applyDeferredShelfUpdates: () => applyDeferredShelfUpdates(),
    maybeRefreshAppearanceStyles: () => maybeRefreshAppearanceStyles(),
    resolveCover: book => resolveCover(book),
    quickCoverAppearance: (book, url) => quickCoverAppearance(book, url),
    buildSpine: item => buildSpine(item),
    coverRatioFor: (style, fallback) => coverRatioFor(style, fallback),
    bookGeometryState: book => bookGeometryState(book)
  } });
  let shelfCtxLive = true;
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
  container.append(root);
  // Opened straight in the diagonal view: leave the startup work first.
  prepareCatalogWhenIdle(6000);

  /* --------------------------- portadas --------------------------- */

  function toUrl(source) {
    if (!source) return null;
    if (typeof source === 'string') return source;
    if (typeof Blob !== 'undefined' && source instanceof Blob) {
      const url = URL.createObjectURL(source);
      state.objectUrls.add(url);
      return url;
    }
    return null;
  }

  const coverCache = new WeakMap();
  // IndexedDB returns fresh record/Blob objects after every progress write.
  // Keep one URL for the same saved cover so decoded pixels survive refreshes.
  const savedCoverUrls = new Map();

  function cachedCover(book) {
    const saved = savedCoverUrls.get(coverKeyFor(book));
    if (saved) coverCache.set(book, saved);
    return saved;
  }

  function rememberCover(book, url) {
    coverCache.set(book, url);
    if (url && (book.cover || book.coverBlob || book.coverUrl)) savedCoverUrls.set(coverKeyFor(book), url);
    return url;
  }

  async function resolveCover(book) {
    if (coverCache.has(book)) return coverCache.get(book);
    const saved = cachedCover(book);
    if (saved) return saved;
    let url = null;
    try {
      if (typeof options.coverSrcFor === 'function') {
        url = toUrl(await options.coverSrcFor(book));
      }
      if (!url) url = toUrl(book.cover ?? book.coverUrl ?? book.coverBlob);
    } catch {
      url = null; // una portada que falla no puede impedir abrir el libro
    }
    return rememberCover(book, url);
  }

  function coverKeyFor(book) {
    const id = String(book?.id ?? book?.path ?? book?.title ?? 'book');
    const cover = book?.cover ?? book?.coverBlob ?? book?.coverUrl;
    if (typeof Blob !== 'undefined' && cover instanceof Blob) {
      return `${id}|${book?.title ?? ''}|${cover.type}|${cover.size}|${cover.lastModified ?? ''}` +
        (book.coverUpdatedAt ? `|${book.coverUpdatedAt}` : '');
    }
    if (typeof cover === 'string') return `${id}|${book?.title ?? ''}|${cover}`;
    return `${id}|${book?.title ?? ''}|`;
  }

  // The style of a shelf item, the CSS variables of a style and their update on a node are the shelf module's.
  function applyCoverAppearance(item, appearance) { return shelfNative.shelf_apply_cover_appearance(shelfCtx, item, appearance); }
  function spineStyleVars(style) { return shelfNative.shelf_spine_style_vars(style); }
  function updateBookStyleVars(node, style) { shelfNative.shelf_update_book_style_vars(node, style); }

  function maybeRefreshAppearanceStyles() {
    if (!state.appearanceRefreshPending || state.busy || state.session || state.returnMotion || state.dragSession || state.compatibilityTapTimer || state.destroyed) return;
    state.appearanceRefreshPending = false;
    scheduleRender();
  }

  function resolveCoverAppearance(book, knownUrl) {
    const key = coverKeyFor(book);
    const id = String(book?.id ?? book?.path ?? book?.title ?? 'book');
    const cached = state.coverAppearances.get(id);
    if (cached?.key === key && cached.complete !== false) return Promise.resolve(cached.appearance);
    if (state.appearanceTasks.has(key)) return state.appearanceTasks.get(key);

    // A cover upgraded mid-analysis (PDF imports) must not let the older,
    // slower result overwrite the entry for the record now on the shelf.
    const isStale = () => {
      const current = state.books.find(candidate => String(candidate?.id ?? candidate?.path ?? candidate?.title ?? 'book') === id);
      return Boolean(current) && coverKeyFor(current) !== key;
    };
    const task = (async () => {
      const url = knownUrl || await resolveCover(book);
      if (!url) {
        if (!isStale()) state.coverAppearances.set(id, { key, appearance: null, complete: true });
        return null;
      }
      const appearance = await analyzeCoverAppearance(url, book?.title ?? '');
      if (state.destroyed) return null;
      if (isStale()) return appearance;
      state.coverAppearances.set(id, { key, appearance, complete: true });
      if (!appearance) return null;
      try {
        await options.onCoverAppearance?.(book, appearance, key);
      } catch (error) {
        console.warn('No se pudo guardar el aspecto de la portada:', error);
      }
      const item = state.itemsById.get(id);
      if (item && item.coverKey === key && applyCoverAppearance(item, appearance)) {
        if (String(state.session?.book?.id ?? '') === id) {
          state.session.view?.updateAppearance(item.style, { reuseModel:true });
          updateBookStyleVars(state.session.bookNode, item.style);
          updateBookStyleVars(state.session.bookNode?.querySelector('.ihr-flyout__face--cover'), item.style);
        }
        if (String(state.lastOpened?.book?.id ?? '') === id) state.lastOpened.style = item.style;
        const existing = [...root.querySelectorAll('.ihr-spine')]
          .find(node => node.dataset.bookId === id);
        if (existing?.isConnected && !state.busy && !state.session && !state.returnMotion && !state.dragSession && !state.compatibilityTapTimer && state.pressedBookId !== id) {
          if (state.shelfScene) {
            state.shelfScene.updateEntry(existing, item.book, item.style, resolveCoverImmediately(item.book));
            return appearance;
          }
          const hadFocus = document.activeElement === existing;
          const replacement = buildSpine(item);
          existing.replaceWith(replacement);
          if (String(state.lastOpened?.book?.id ?? '') === id) state.lastOpened.spineEl = replacement;
          if (hadFocus) replacement.focus({ preventScroll: true });
        } else {
          state.appearanceRefreshPending = true;
        }
      }
      return appearance;
    })().finally(() => state.appearanceTasks.delete(key));
    state.appearanceTasks.set(key, task);
    return task;
  }

  function quickCoverAppearance(book, url) {
    if (!url) return Promise.resolve(null);
    return new Promise(resolve => {
      const timer = setTimeout(() => resolve(null), 20);
      resolveCoverAppearance(book, url).then(appearance => {
        clearTimeout(timer);
        resolve(appearance);
      }, () => {
        clearTimeout(timer);
        resolve(null);
      });
    });
  }


  function coverRatioFor(style, fallback = opts.coverRatio) {
    return coverAspectRatio(style?.coverRatio, 1) || fallback;
  }


  // El retorno desde el lector necesita su primer fotograma antes de que el
  // navegador pinte la estantería. La resolución normal usa `await` incluso
  // cuando la portada ya está en IndexedDB como Blob y deja un fotograma vacío.
  function resolveCoverImmediately(book) {
    if (coverCache.has(book)) return coverCache.get(book);
    const saved = cachedCover(book);
    if (saved) return saved;
    try {
      const source = typeof options.coverSrcFor === 'function'
        ? options.coverSrcFor(book)
        : book.cover ?? book.coverUrl ?? book.coverBlob;
      if (source && typeof source.then === 'function') return null;
      const url = toUrl(source) || toUrl(book.cover ?? book.coverUrl ?? book.coverBlob);
      return rememberCover(book, url);
    } catch {
      return null;
    }
  }

  /** Precarga en pointerdown: cuando el giro enseña la cara, ya está pintada. */
  function warmCover(book) {
    resolveCover(book).then((url) => {
      if (!url) return;
      resolveCoverAppearance(book, url);
      if (typeof Image !== 'undefined') {
        const img = new Image();
        img.decoding = 'async';
        img.src = url;
      }
    });
  }

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

  function shelfSpineNodes(section = null) {
    return [...(section || scroller).querySelectorAll('.ihr-spine')];
  }

  const objectKey = node => node.dataset.objectId || `book:${node.dataset.bookId}`;
  const objectRects = () => new Map([...scroller.querySelectorAll('.ihr-spine, .ihr-plant, .ihr-lamp')]
    .map(node => [objectKey(node), node.getBoundingClientRect()]));

  function savePlants({ strict = false, initial = false } = {}) {
    try { localStorage.setItem(SHELF_PLANTS_STORAGE_KEY, JSON.stringify(state.plants)); if (!initial) notifyCloudSettingsChanged(SHELF_PLANTS_STORAGE_KEY); }
    catch (error) { if (strict) throw error; }
  }

  function saveLamps({ strict = false } = {}) {
    try { localStorage.setItem(SHELF_LAMPS_STORAGE_KEY, JSON.stringify(state.lamps)); notifyCloudSettingsChanged(SHELF_LAMPS_STORAGE_KEY); }
    catch (error) { if (strict) throw error; }
  }

  function lampShelfObject(record) {
    const lamp = getCatalogLamp(record.lampId);
    const scale = shelfScale({ shelfType:state.shelfType, shelfWidth:state.shelfWidth, viewportWidth:window.innerWidth });
    return { ...record, kind:'lamp', mount:lamp.mount,
      width:lamp.dimensions.width * scale, height:lamp.dimensions.height * scale,
      depth:lamp.dimensions.depth * scale };
  }

  /** Real IKEA sizes are millimetres; scene pixels follow the shelf's scale. */
  const plantScale = () => shelfScale({ shelfType:state.shelfType, shelfWidth:state.shelfWidth, viewportWidth:window.innerWidth });
  function plantShelfObject(record, scale = plantScale()) {
    const size = normalizeShelfPlant({ ...record, key:record.key || 'plant' });
    const real = plantDimensions(size.catalogId, size.potId);
    return { ...record, kind:'plant', width:size.width * scale, height:size.height * scale, depth:real.depth * scale };
  }

  function updateLampControl(node, record) {
    const lamp = getCatalogLamp(record.lampId), isOn = record.isOn !== false;
    node.dataset.lampOn = String(isOn);
    node.setAttribute('aria-pressed', String(isOn));
    node.setAttribute('aria-label', `${isOn ? 'Apagar' : 'Encender'} lámpara ${lamp.name}`);
    node.title = `${lamp.name} · ${isOn ? 'Apagar' : 'Encender'}`;
  }

  function toggleLamp(node) {
    if (state.destroyed || state.busy || state.session || state.dragSession || state.returnMotion || state.arranging) return;
    const key = objectKey(node), record = state.lamps.find(lamp => lamp.key === key);
    if (!record) return;
    const previous = state.lamps, next = { ...record, isOn:record.isOn === false };
    state.lamps = previous.map(lamp => lamp.key === key ? next : lamp);
    try { saveLamps({ strict:true }); }
    catch {
      state.lamps = previous;
      if (trashStatus) {
        trashStatus.textContent = 'No se pudo guardar la lámpara. Reintenta.';
        trashStatus.classList.add('is-error');
      }
      return;
    }
    state.placementObjects = state.placementObjects.map(item => item.key === key ? { ...item, isOn:next.isOn } : item);
    updateLampControl(node, next);
    state.shelfScene?.setLampPower(node, next.isOn, { animate:!prefersReducedMotion() });
  }

  async function addCatalogLamp({ lampId, kelvin }, { whenClosed = run => run() } = {}) {
    if (state.destroyed || state.busy || state.session || state.dragSession || state.returnMotion)
      throw new Error('Espera a que termine la animación.');
    const lamp = getCatalogLamp(lampId);
    if (!lamp) throw new Error('Elige una lámpara.');
    const key = `lamp:${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
    const record = normalizeShelfLamp({ key, seed:key, lampId:lamp.id, shelf:0, kelvin,
      ...(lamp.mount === 'undershelf' ? { x:.5 } : {}) });
    const previous = state.lamps, oldRects = objectRects();
    const arranged = layoutShelfDecorations([...state.placementObjects, lampShelfObject(record)], placementConfig());
    const positions = new Map(arranged.flatMap(shelf => shelf.items)
      .map(item => [item.key, { shelf:item.shelf, x:item.x }]));
    state.lamps = [...previous, record].map(item => ({ ...item, ...positions.get(item.key) }));
    try { saveLamps({ strict:true }); }
    catch (error) { state.lamps = previous; throw new Error('No se pudo guardar la lámpara. Reintenta.', { cause:error }); }
    // Saved now; drawn as soon as the catalogue has closed.
    whenClosed(() => {
      if (state.destroyed) return;
      render();
      state.shelfScene?.animateFromRects(oldRects);
      root.dataset.lastAddedLamp = key;
    });
  }

  async function addCatalogPlant({ catalogId, potId, potColorId }, { whenClosed = run => run() } = {}) {
    if (state.destroyed || state.busy || state.session || state.dragSession || state.returnMotion)
      throw new Error('Espera a que termine la animación.');
    const plant = getCatalogPlant(catalogId), pot = getCatalogPot(potId);
    if (!plant || !pot) throw new Error('Elige una planta y una maceta.');
    const key = `plant:${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
    const viewport = scroller.getBoundingClientRect();
    const destination = dropPositionAt(viewport.left + viewport.width * .4,
      viewport.top + Math.min(viewport.height * .4, 260));
    let record = { key, seed:key, catalogId:plant.id, variant:plant.variant, potId:pot.id, potColorId:getPotColor(pot.id,potColorId).id,
      shelf:destination?.shelf ?? 0 };
    const oldRects = objectRects(), previous = state.plants;
    record = normalizeShelfPlant(record);
    const objects = [...state.placementObjects, plantShelfObject(record)];
    const arranged = layoutShelfDecorations(objects, placementConfig()).flatMap(shelf => shelf.items);
    const positions = new Map(arranged.map(item => [item.key, { shelf:item.shelf, x:item.x }]));
    state.plants = [...previous, record].map(item => ({ ...item, ...positions.get(item.key) }));
    try { savePlants({ strict:true }); }
    catch (error) { state.plants = previous; throw new Error('No se pudo guardar la planta. Vuelve a intentarlo.', { cause:error }); }
    state.plantsInitialized = true;
    // Saved now; drawn as soon as the catalogue has closed.
    whenClosed(() => {
      if (state.destroyed) return;
      render();
      state.shelfScene?.animateFromRects(oldRects);
      root.dataset.lastAddedPlant = key;
      const added = [...scroller.querySelectorAll('.ihr-plant')].find(node => objectKey(node) === key);
      if (state.viewMode !== SHELF_VIEW_MODES.ISOMETRIC) {
        added?.scrollIntoView?.({ block:'nearest', behavior:prefersReducedMotion() ? 'instant' : 'smooth' });
      }
    });
  }

  function persistObjectPlacement(node, destination, oldRects = objectRects()) {
    if (!destination || !state.placementObjects.length) return;
    const result = moveShelfDecoration(state.placementObjects, objectKey(node), destination, placementConfig());
    const changed = [];
    state.books = state.books.map(book => {
      const shelfPosition = result.placements[`book:${book.id}`];
      if (!shelfPosition) return book;
      if (JSON.stringify(book.shelfPosition) !== JSON.stringify(shelfPosition)) changed.push({ id:book.id, shelfPosition });
      return { ...book, shelfPosition };
    });
    state.plants = state.plants.map(plant => ({ ...plant, ...result.placements[plant.key] }));
    state.lamps = state.lamps.map(lamp => ({ ...lamp, ...result.placements[lamp.key] }));
    savePlants();
    saveLamps();
    Promise.resolve(options.onShelfPlacementChange?.({ books:changed,
      plants:Object.fromEntries(state.plants.map(plant => [plant.key, { shelf:plant.shelf, x:plant.x }])) }))
      .catch(error => console.warn('No se pudo guardar la posición en la estantería:', error));
    clearTimeout(state.reorderTimer);
    state.reorderTimer = -1;
    render();
    state.shelfScene?.animateFromRects(oldRects, { draggedKey:objectKey(node) });
    state.reorderTimer = setTimeout(() => {
      state.reorderTimer = 0; applyDeferredShelfUpdates();
    }, prefersReducedMotion() ? 0 : 560);
  }

  function moveObjectWithKeyboard(event, node) {
    if (!event.shiftKey || !['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)) return;
    event.preventDefault();
    const item = state.placementObjects.find(item => item.key === objectKey(node));
    if (!item) return;
    const direction = event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1;
    const vertical = event.key === 'ArrowUp' || event.key === 'ArrowDown';
    persistObjectPlacement(node, { shelf:Math.max(0, item.shelf + (vertical ? direction : 0)),
      x:Math.max(0, Math.min(1, item.x + (vertical ? 0 : direction * .08))) });
    [...scroller.querySelectorAll('[data-object-id]')].find(candidate => objectKey(candidate) === item.key)?.focus({ preventScroll:true });
  }

  function dropPositionAt(x, y, node = null) {
    if (state.shelfScene) return state.shelfScene.getDropPosition(x, y, node);
    const rows = [...scroller.querySelectorAll('.ihr-shelf__row')];
    const nearest = rows.map((row, shelf) => {
      const bounds = row.getBoundingClientRect();
      return { shelf, bounds, distance:Math.max(bounds.top-y, 0, y-bounds.bottom) };
    }).sort((a,b) => a.distance-b.distance)[0];
    if (!nearest) return null;
    return { shelf:nearest.shelf, x:Math.max(0, Math.min(1,
      (x-nearest.bounds.left-shelfPadding())/(state.shelfWidth-shelfPadding()*2))) };
  }

  function updateDropPreview(drag, node) {
    drag.overTrash = hitTrash(drag.x, drag.y, node);
    trashNode?.classList.toggle('is-over', drag.overTrash);
    state.shelfScene?.setTrashHover(drag.overTrash);
    if (drag.overTrash) {
      drag.destination = null;
      cancelAnimationFrame(drag.previewFrame); drag.previewFrame = 0;
      state.shelfScene?.setDropPosition(null);
      state.shelfScene?.previewPlacements(null);
      return;
    }
    drag.destination = dropPositionAt(drag.x, drag.y, node);
    state.shelfScene?.setDropPosition(drag.destination);
    if (drag.destination && !drag.previewFrame) drag.previewFrame = requestAnimationFrame(() => {
      drag.previewFrame = 0;
      if (state.dragSession !== drag || !drag.destination) return;
      const preview = previewObjectPlacement(drag, objectKey(node), drag.destination);
      if (state.dragSession !== drag || state.destroyed) return;
      state.shelfScene?.previewPlacements(preview.objects, objectKey(node));
    });
  }

  function continueDragScroll(drag, node) {
    if (drag.scrollFrame || state.viewMode === SHELF_VIEW_MODES.ISOMETRIC) return;
    const tick = () => {
      drag.scrollFrame = 0;
      if (state.dragSession !== drag || !drag.active || state.viewMode === SHELF_VIEW_MODES.ISOMETRIC) return;
      if (drag.overTrash) return;
      const bounds = scroller.getBoundingClientRect();
      const delta = drag.y < bounds.top + 40 ? -12 : drag.y > bounds.bottom - 40 ? 12 : 0;
      if (!delta) return;
      const previous = scroller.scrollTop;
      scroller.scrollTop += delta;
      if (scroller.scrollTop === previous) return;
      node.style.setProperty('--ihr-drag-y', `${drag.y-drag.startY+scroller.scrollTop-drag.scrollTop}px`);
      updateDropPreview(drag, node);
      drag.scrollFrame = requestAnimationFrame(tick);
    };
    drag.scrollFrame = requestAnimationFrame(tick);
  }

  function persistShelfDomOrder(oldRects = null) {
    const orderedIds = shelfSpineNodes().map(node => node.dataset.bookId).filter(Boolean);
    const rank = new Map(orderedIds.map((id, index) => [String(id), index]));
    state.books = state.books.map(book => ({ ...book, shelfOrder: rank.get(String(book.id)) ?? Number.MAX_SAFE_INTEGER }));
    // Storage notifies once per updated book. Keep the animated scene alive
    // until its meshes have settled before applying those refreshed records.
    clearTimeout(state.reorderTimer);
    state.reorderTimer = -1;
    cancelAnimationFrame(state.frame);
    state.frame = 0;
    Promise.resolve(options.onBookOrderChange?.(state.books.map(book => ({ id: book.id, shelfOrder: book.shelfOrder }))))
      .catch(error => console.warn('No se pudo guardar el orden de la estantería:', error));
    render();
    // Start the quiet period after constructing the scene: on slower phones
    // its first frame can take a significant part of the animation duration.
    state.reorderTimer = setTimeout(() => {
      state.reorderTimer = 0;
      applyDeferredShelfUpdates();
    }, prefersReducedMotion() ? 0 : 560);
    if (!oldRects || prefersReducedMotion()) return;
    if (state.shelfScene) { state.shelfScene.animateFromRects(oldRects); return; }
    for (const node of shelfSpineNodes()) {
      const old = oldRects.get(node.dataset.bookId);
      if (!old) continue;
      const rect = node.getBoundingClientRect();
      const dx = old.left - rect.left, dy = old.top - rect.top;
      if (Math.abs(dx) + Math.abs(dy) < 1) continue;
      node.animate([
        { transform: `translate3d(${dx}px,${dy}px,64px) rotateY(${dx < 0 ? -13 : 13}deg) rotateX(-5deg)` },
        { transform: 'translate3d(0,0,0) rotateY(0) rotateX(0)' }
      ], { duration: 520, easing: 'cubic-bezier(.2,.75,.22,1)' });
    }
  }

  function reorderSpine(source, target, after = false) {
    if (!source || !target || source === target || source.closest('.ihr-section') !== target.closest('.ihr-section')) return;
    const oldRects = new Map(shelfSpineNodes().map(node => [node.dataset.bookId, node.getBoundingClientRect()]));
    const reference = after ? target.nextSibling : target;
    target.parentElement.insertBefore(source, reference);
    persistShelfDomOrder(oldRects);
  }

  function startSpineDrag(event, node) {
    if ((event.button !== undefined && event.button !== 0) || state.dragSession || state.busy || state.session || state.returnMotion) return;
    clearCompatibilityTapRefresh();
    state.suppressLampClickKey = null;
    let backgroundOnly = false;
    const pressed = node;
    if (state.shelfScene) {
      const hit = state.shelfScene.getObjectAtPoint(event.clientX, event.clientY);
      backgroundOnly = !hit;
      if (hit && hit !== node) { node.classList.remove('is-pressed', 'is-press-pending'); state.pressedBookId = null; }
      node = hit || node;
    }
    if (!backgroundOnly && event.pointerType === 'touch' && node.matches('.ihr-plant, .ihr-lamp')) {
      event.preventDefault();
      const stage = node.closest('.ihr-shelf-stage'), selection = window.getSelection?.();
      if (stage && selection && (stage.contains(selection.anchorNode) || stage.contains(selection.focusNode)))
        selection.removeAllRanges();
    }
    const drag = state.dragSession = {
      node, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY,
      x: event.clientX, y: event.clientY, scrollTop: scroller.scrollTop,
      pointerType: event.pointerType, target: null, after: false, moved: false,
      active: false, scrolling: false, cancelled: false, timer: 0,
      bookTapValid: !backgroundOnly && node.classList.contains('ihr-spine'),
      // The 3D hit belongs to another button than the one touched (a lamp's
      // square over a book, or the reverse): pointer capture hands the release
      // to the hit's own button, which then owns the tap.
      redirected: !backgroundOnly && node !== pressed
    };
    try { node.setPointerCapture?.(event.pointerId); } catch { /* el navegador pudo cancelar el puntero */ }
    // Rotated hit rectangles contain some empty space. It must still scroll
    // naturally on touch, without starting a hold on an occluded book.
    if (backgroundOnly) { node.classList.remove('is-pressed', 'is-press-pending'); return; }
    drag.timer = setTimeout(() => {
      if (state.dragSession !== drag || state.destroyed) return;
      drag.active = true;
      state.arranging = true;
      root.classList.add('is-arranging');
      node.classList.remove('is-pressed', 'is-press-pending');
      node.classList.add('is-lifted');
      state.shelfScene?.flush();
    }, REORDER_HOLD_MS);
  }

  function moveSpineDrag(event, node) {
    const drag = state.dragSession;
    if (!drag || drag.node !== node || drag.pointerId !== event.pointerId) return;
    if (!drag.active) {
      if (drag.cancelled) return;
      if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) > TAP_SLOP) {
        clearTimeout(drag.timer);
        if (state.viewMode !== SHELF_VIEW_MODES.ISOMETRIC && drag.pointerType === 'touch' && Math.abs(event.clientY - drag.startY) > Math.abs(event.clientX - drag.startX)) {
          drag.scrolling = true;
        } else {
          drag.cancelled = true;
        }
      }
      if (drag.scrolling) {
        event.preventDefault();
        scroller.scrollTop = drag.scrollTop + drag.startY - event.clientY;
      }
      return;
    }
    event.preventDefault();
    drag.x = event.clientX; drag.y = event.clientY;
    const dx = drag.x - drag.startX, dy = drag.y - drag.startY + scroller.scrollTop - drag.scrollTop;
    drag.moved = true;
    node.classList.remove('is-lifted');
    node.classList.add('is-dragging');
    node.style.setProperty('--ihr-drag-x', `${dx}px`);
    node.style.setProperty('--ihr-drag-y', `${dy}px`);
    if (!opts.sections) {
      updateDropPreview(drag, node);
      continueDragScroll(drag, node);
      return;
    }
    node.style.pointerEvents = 'none';
    const hit = document.elementFromPoint(event.clientX, event.clientY)?.closest?.('.ihr-spine');
    node.style.pointerEvents = '';
    const section = node.closest('.ihr-section');
    const candidates = [...(section?.querySelectorAll('.ihr-spine') || [])].filter(candidate => candidate !== node);
    const target = hit && hit !== node && hit.closest('.ihr-section') === section
      ? hit
      : candidates.map(candidate => {
        const rect = candidate.getBoundingClientRect();
        const dx = Math.max(rect.left - event.clientX, 0, event.clientX - rect.right);
        const dy = Math.max(rect.top - event.clientY, 0, event.clientY - rect.bottom);
        return { candidate, distance:Math.hypot(dx, dy) };
      }).sort((a,b) => a.distance - b.distance)[0]?.candidate;
    drag.target?.classList.remove('is-drop-target', 'is-drop-before', 'is-drop-after');
    drag.target = target;
    drag.after = Boolean(target && event.clientX > target.getBoundingClientRect().left + target.getBoundingClientRect().width / 2);
    target?.classList.add('is-drop-target', drag.after ? 'is-drop-after' : 'is-drop-before');
  }

  /** A touch released where it started, on `node`'s own unmoved hold. The
   * touch is this button's validated contact (`candidate`), or a contact
   * another button received whose 3D hit was this one (`drag.redirected`). */
  function isTouchTapRelease(event, drag, node, candidate) {
    if (event.pointerType !== 'touch' || drag?.pointerId !== event.pointerId || drag.node !== node ||
      drag.active || drag.moved || drag.cancelled || drag.scrolling || state.arranging) return false;
    if (candidate) return candidate.valid && !candidate.cancelled &&
      Math.hypot(event.clientX - candidate.x, event.clientY - candidate.y) <= TAP_SLOP;
    return drag.redirected && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) <= TAP_SLOP;
  }

  function finishSpineDrag(event, node, cancelled = false, activateTouch = false) {
    const drag = state.dragSession;
    if (!drag || drag.node !== node || drag.pointerId !== event.pointerId) return;
    clearTimeout(drag.timer);
    clearPlacementPreview(drag);
    cancelAnimationFrame(drag.previewFrame);
    cancelAnimationFrame(drag.scrollFrame);
    const discard = drag.active && drag.moved && !cancelled && !drag.cancelled &&
      hitTrash(event.clientX ?? drag.x, event.clientY ?? drag.y, node);
    const discardDuration = prefersReducedMotion() ? 1 : 820;
    let discardMotion = null, discardRect = null;
    if (discard) {
      // Capture the moving model before resetting its drag offset. The drop
      // starts at the pointer, with no jump back to its old slot.
      state.shelfScene?.flush();
      discardRect = node.getBoundingClientRect();
      discardMotion = state.shelfScene?.animateObjectToTrash(node, { duration:discardDuration });
    }
    const oldRects = drag.active && drag.moved ? objectRects() : null;
    state.dragSession = null;
    if (node.classList.contains('ihr-lamp') && (drag.active || drag.scrolling || drag.cancelled || cancelled))
      state.suppressLampClickKey = objectKey(node);
    state.shelfScene?.setDropPosition(null);
    state.shelfScene?.previewPlacements(null);
    if (!discard) { trashNode?.classList.remove('is-over'); state.shelfScene?.setTrashHover(false); }
    drag.target?.classList.remove('is-drop-target', 'is-drop-before', 'is-drop-after');
    node.classList.remove('is-dragging', 'is-lifted', 'is-press-pending');
    node.style.removeProperty('--ihr-drag-x');
    node.style.removeProperty('--ihr-drag-y');
    node.style.pointerEvents = '';
    try { node.releasePointerCapture?.(event.pointerId); } catch { /* captura ya liberada */ }
    if (drag.scrolling || drag.cancelled) {
      state.suppressOpenBookId = String(node.dataset.bookId || '');
      setTimeout(() => { state.suppressOpenBookId = null; }, 0);
      applyDeferredShelfUpdates();
      return;
    }
    if (!drag.active) {
      // Keep the validated semantic hit alive until its compatibility click
      // or synchronous touch activation. A WebGL refresh replaces it too.
      if (!cancelled && !drag.cancelled && !drag.moved && drag.bookTapValid &&
          (drag.pointerType === 'mouse' || activateTouch))
        deferCompatibilityTapRefresh();
      else applyDeferredShelfUpdates();
      return;
    }
    state.arranging = false;
    root.classList.remove('is-arranging');
    state.suppressOpenBookId = String(node.dataset.bookId || '');
    setTimeout(() => { state.suppressOpenBookId = null; }, 0);
    if (discard) { void removeBookInTrash(node, { motion:discardMotion, rect:discardRect, duration:discardDuration }); return; }
    if (drag.moved && !cancelled && !opts.sections && drag.destination) persistObjectPlacement(node, drag.destination, oldRects);
    else if (drag.moved && !cancelled && drag.target) reorderSpine(node, drag.target, drag.after);
    else { state.shelfScene?.flush(); applyDeferredShelfUpdates(); }
  }

  function hitTrash(x, y, node) {
    if (!trashNode || state.viewMode !== SHELF_VIEW_MODES.ISOMETRIC ||
      !(node?.matches('.ihr-plant, .ihr-lamp') || hasBookTrash && node?.classList.contains('ihr-spine'))) return false;
    // The scene flushes its pending scroll frame before testing the bin. Its
    // DOM target can still be hidden just as a held object reaches the floor.
    if (state.shelfScene) return state.shelfScene.hitTrash(x, y);
    if (trashNode.hidden) return false;
    const bounds = trashNode.getBoundingClientRect();
    return bounds.width > 0 && bounds.height > 0 && x >= bounds.left - 8 && x <= bounds.right + 8 &&
      y >= bounds.top - 12 && y <= bounds.bottom + 8;
  }

  function cancelTrashRemoval() {
    const operation = state.trashRemoval;
    if (!operation || operation.persisting) return;
    operation.cancelled = true;
    operation.motion?.cancel?.(); operation.clone?.remove();
    operation.node.classList.remove('is-away');
    trashNode?.classList.remove('is-over'); state.shelfScene?.setTrashHover(false);
    state.trashRemoval = null; state.busy = false;
    root.classList.remove('is-discarding');
    state.shelfScene?.flush();
    applyDeferredShelfUpdates();
  }

  async function removeBookInTrash(node, { motion, rect, duration = prefersReducedMotion() ? 1 : 820 } = {}) {
    const plant = node.classList.contains('ihr-plant') ? state.plants.find(item => item.key === objectKey(node)) : null;
    const lamp = node.classList.contains('ihr-lamp') ? state.lamps.find(item => item.key === objectKey(node)) : null;
    const item = plant || lamp ? null : state.itemsById.get(node.dataset.bookId);
    if (!hasTrash || !(plant || lamp || hasBookTrash && item) || state.busy || state.destroyed) { motion?.cancel?.(); return; }
    const operation = { node, motion, cancelled:false, persisting:false, clone:null };
    state.trashRemoval = operation; state.busy = true;
    root.classList.add('is-discarding');
    clearTimeout(state.trashStatusTimer); trashStatus.textContent = ''; trashStatus.classList.remove('is-error'); trashAnnounce.textContent = '';
    node.classList.add('is-away');
    trashNode.classList.add('is-over');
    try {
      if (!motion && !trashNode.hidden && state.viewMode === SHELF_VIEW_MODES.ISOMETRIC) {
        const start = rect || node.getBoundingClientRect(), target = trashNode.getBoundingClientRect();
        const clone = operation.clone = node.cloneNode(true);
        clone.classList.remove('is-away','is-dragging','is-lifted');
        clone.classList.add('ihr-trash-flight');
        clone.removeAttribute('data-book-id'); clone.setAttribute('aria-hidden','true'); clone.tabIndex = -1;
        Object.assign(clone.style, { position:'fixed', left:`${start.left}px`, top:`${start.top}px`,
          width:`${start.width}px`, height:`${start.height}px`, margin:'0', zIndex:'90', pointerEvents:'none' });
        document.body.append(clone);
        const dx = target.left + target.width/2 - start.left - start.width/2;
        const dy = target.top + target.height*.6 - start.top - start.height/2;
        operation.motion = animate(clone, [
          { transform:'translate3d(0,0,0) rotateY(0deg) scale(1)', opacity:1 },
          { transform:`translate3d(${dx*.65}px,${dy*.45-30}px,80px) rotateY(45deg) rotateZ(-18deg) scale(.65)`, opacity:1, offset:.55 },
          { transform:`translate3d(${dx}px,${dy}px,-10px) rotateY(82deg) rotateZ(-32deg) scale(.12)`, opacity:0 }
        ], { duration, easing:EASE, fill:'both' });
      }
      // Keyboard removal still works in the frontal view without flying to
      // a hidden bin. Dragging to the visible isometric bin retains its flight.
      const landed = operation.motion ? await waitForMotion(operation.motion, duration) : true;
      if (!landed) { operation.cancelled = true; node.classList.remove('is-away'); return; }
      if (operation.cancelled || state.trashRemoval !== operation || state.destroyed) return;
      // Delete the app's record only after the model has landed. External
      // originals are managed by the application callback and stay intact.
      operation.persisting = true;
      if (lamp) {
        const previous = state.lamps;
        state.lamps = state.lamps.filter(record => record.key !== lamp.key);
        try { saveLamps({ strict:true }); }
        catch (error) { state.lamps = previous; throw error; }
        trashAnnounce.textContent = `${getCatalogLamp(lamp.lampId).name} retirada de la estantería`;
        root.dataset.lastRemovedLamp = lamp.key;
        return;
      }
      if (plant) {
        const previous = state.plants;
        state.plants = state.plants.filter(item => item.key !== plant.key);
        try { savePlants({ strict:true }); }
        catch (error) { state.plants = previous; throw error; }
        state.plantsInitialized = true;
        trashAnnounce.textContent = `${getCatalogPlant(plant.catalogId)?.name || 'Planta'} retirada de la estantería`;
        root.dataset.lastRemovedPlant = plant.key;
        return;
      }
      // The book has landed in the bin: take it off the shelf now and let
      // the stored removal finish in the background. Waiting for IndexedDB
      // (and the Drive-removed memory) here held the whole page still on a
      // large library. A failed write puts the book back, visibly.
      const id = String(item.book.id);
      const index = state.books.findIndex(book => String(book.id) === id);
      let persisted;
      try { persisted = Promise.resolve(options.onBookRemove(item.book)); }
      catch (error) { persisted = Promise.reject(error); }
      state.pendingRemovals.add(id);
      state.books = state.books.filter(book => String(book.id) !== id);
      if (state.queuedBooks) state.queuedBooks = state.queuedBooks.filter(book => String(book.id) !== id);
      if (String(state.lastOpened?.book.id) === id) state.lastOpened = null;
      state.coverAppearances.delete(id); coverCache.delete(item.book);
      for (const [key,url] of savedCoverUrls) if (key.startsWith(`${id}|`)) {
        savedCoverUrls.delete(key);
        if (state.objectUrls.delete(url)) URL.revokeObjectURL?.(url);
      }
      trashAnnounce.textContent = `${displayBookTitle(item.book) || 'Libro'} retirado de la estantería`;
      root.dataset.lastRemovedBook = id;
      persisted.then(() => { state.pendingRemovals.delete(id); }, error => {
        state.pendingRemovals.delete(id);
        console.warn('No se pudo retirar el objeto de la estantería:', error);
        if (state.destroyed) return;
        trashAnnounce.textContent = '';
        trashStatus.textContent = 'No se pudo retirar el libro. Vuelve a intentarlo.';
        trashStatus.classList.add('is-error');
        clearTimeout(state.trashStatusTimer);
        state.trashStatusTimer = setTimeout(() => { trashStatus.textContent = ''; }, 6500);
        delete root.dataset.lastRemovedBook;
        const restore = list => {
          if (list.some(book => String(book.id) === id)) return list;
          const next = list.slice(); next.splice(index < 0 ? next.length : Math.min(index, next.length), 0, item.book);
          return next;
        };
        // While another removal keeps the shelf busy only the queue is updated: refresh() would replace it with a
        // list built from state.books, dropping any book a sync queued in the meantime.
        if (state.queuedBooks) state.queuedBooks = restore(state.queuedBooks);
        else refresh(restore(state.books));
      });
    } catch (error) {
      operation.motion?.cancel?.(); node.classList.remove('is-away');
      trashStatus.textContent = `No se pudo retirar ${plant ? 'la planta' : lamp ? 'la lámpara' : 'el libro'}. Reintenta.`;
      trashStatus.classList.add('is-error');
      state.trashStatusTimer = setTimeout(() => { trashStatus.textContent = ''; }, 6500);
      console.warn('No se pudo retirar el objeto de la estantería:', error);
    } finally {
      operation.clone?.remove();
      if (state.trashRemoval === operation) {
        state.trashRemoval = null; state.busy = false;
        root.classList.remove('is-discarding'); trashNode.classList.remove('is-over');
        state.shelfScene?.setTrashHover(false);
        if (!state.destroyed) {
          // A sync may have queued newer records during the flight. Paint
          // that final list once, instead of painting the old list and then
          // immediately rebuilding its layout when the queue is drained.
          if (state.queuedBooks) {
            const nextBooks = state.queuedBooks;
            state.queuedBooks = null;
            refresh(nextBooks);
          } else render();
          applyDeferredShelfUpdates();
        }
      }
    }
  }

  let clearOpeningClick = null;
  function discardTouchCompatibilityClick(release) {
    clearOpeningClick?.();
    // A touch handled on pointerup can still click a newly projected surface
    // or flyout. Consume that contact's click before any surface acts twice.
    // A new contact or keyboard action ends the guard without a time window.
    const clear = () => {
      document.removeEventListener('click', discard, true);
      document.removeEventListener('pointerdown', clear, true);
      document.removeEventListener('keydown', clear, true);
      if (clearOpeningClick === clear) clearOpeningClick = null;
    };
    const discard = event => {
      if (!pointerClick(event) || event.pointerType && event.pointerType !== 'touch') return;
      if (event.pointerId !== undefined && event.pointerId !== release.pointerId) return;
      if (Math.hypot(event.clientX - release.clientX, event.clientY - release.clientY) > TAP_SLOP) return;
      clear();
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    clearOpeningClick = clear;
    document.addEventListener('click', discard, true);
    document.addEventListener('pointerdown', clear, true);
    document.addEventListener('keydown', clear, true);
  }

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

  function placementConfig() {
    return { shelfWidth:state.shelfWidth, padding:shelfPadding(), gap:opts.gap,
      minShelves:Math.max(3, Number(opts.minimumShelves) || 3) };
  }

  function clearPlacementPreview(drag = state.dragSession) {
    drag?.placementSnapshot?.session?.dispose();
    if (drag) drag.placementSnapshot = null;
  }

  function previewObjectPlacement(drag, key, destination) {
    const cfg = placementConfig(), objects = state.placementObjects, core = getRustCore();
    if (!core) return moveShelfDecoration(objects, key, destination, cfg);
    const viewport = window.visualViewport;
    const width = viewport?.width ?? window.innerWidth, height = viewport?.height ?? window.innerHeight;
    const scale = viewport?.scale ?? 1, pixelRatio = window.devicePixelRatio || 1;
    let current = drag.placementSnapshot;
    if (!current || current.objects !== objects || current.shelfType !== state.shelfType || current.viewMode !== state.viewMode ||
        current.width !== width || current.height !== height || current.scale !== scale || current.pixelRatio !== pixelRatio ||
        current.cfg.shelfWidth !== cfg.shelfWidth || current.cfg.padding !== cfg.padding || current.cfg.gap !== cfg.gap ||
        current.cfg.minShelves !== cfg.minShelves) {
      clearPlacementPreview(drag);
      // The session copies its own immutable records. The application's
      // mutable objects are neither branded nor re-used as trusted inputs.
      current = drag.placementSnapshot = { objects, cfg, width, height, scale, pixelRatio,
        shelfType:state.shelfType, viewMode:state.viewMode, session:createShelfPlacementPreview(objects, cfg) };
    }
    return current.session?.move(core, key, destination.shelf, destination.x)
      ?? moveShelfDecoration(objects, key, destination, cfg);
  }

  function shelfPadding() {
    // Both shelves are 600 mm units: the same side clearance, in millimetres.
    return Math.max(16, (BAGGEBO_SPEC.postSize + 4) * state.shelfWidth / BAGGEBO_SPEC.width);
  }

  function freelyPlacedShelves(shelves) {
    const cfg = placementConfig(), innerWidth = cfg.shelfWidth - cfg.padding * 2;
    const objects = [], initialPlants = [];
    for (const shelf of shelves) {
      let cursor = cfg.padding;
      for (const item of shelf.items) {
        const key = item.kind === 'book' ? `book:${item.book.id}` : `plant:${item.seed}`;
        const x = (cursor + item.width / 2 - cfg.padding) / innerWidth;
        const newBookInPlacedLibrary = item.kind === 'book' && !item.book.shelfPosition &&
          state.books.some(book => book.shelfPosition);
        const object = { ...item, key, shelf:shelf.index, x:newBookInPlacedLibrary ? undefined : x, tilt:0 };
        if (item.kind === 'book') objects.push(object);
        else initialPlants.push(object);
        cursor += item.width + cfg.gap;
      }
    }
    if (!state.plantsInitialized) {
      state.plants = initialPlants.map(({ key, seed, variant, shelf, x }) =>
        normalizeShelfPlant({ key, seed, variant, shelf, x,potId:resolveCatalogPlant({ variant })?.defaultPotId }));
      state.plantsInitialized = true;
      savePlants({ initial:true });
    }
    const scale = plantScale();
    objects.push(...state.plants.map(plant => plantShelfObject(plant, scale)));
    objects.push(...state.lamps.map(lampShelfObject));
    const placements = Object.fromEntries(objects.filter(item => item.kind === 'book' && item.book.shelfPosition)
      .map(item => [item.key, item.book.shelfPosition]));
    const result = layoutShelfDecorations(objects, { ...cfg, placements });
    state.placementObjects = result.flatMap(shelf => shelf.items);
    return result;
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
  function measure() {
    if (Number.isFinite(options.shelfWidth) && options.shelfWidth > 0) {
      return Math.round(options.shelfWidth);
    }
    const width = scroller.clientWidth || container.clientWidth || 0;
    return Math.max(0, Math.round(width));
  }

  /** Los lomos tienen su grosor real (15-45 mm) a la escala de la balda. */
  function spineOptionsFor(width) { return bookSpineOptions(width); }

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

  function consumeRenderRequests() {
    if (state.frame) cancelAnimationFrame(state.frame);
    state.frame = 0;
    state.renderQueued = false;
    state.appearanceRefreshPending = false;
  }

  function render() {
    if (state.destroyed) return;
    root.dataset.viewMode = state.viewMode;
    root.dataset.shelfType = state.shelfType;
    if (state.returnMotion || state.busy || state.session || state.dragSession || state.compatibilityTapTimer) { state.renderQueued = true; return; }
    if (!state.appearancesReady && state.books.length > 0) {
      state.shelfScene?.dispose();
      state.shelfScene = null;
      scroller.textContent = '';
      scroller.append(buildPreparingState());
      return;
    }
    const focusedBookId = document.activeElement?.closest?.('.ihr-spine')?.dataset.bookId;
    const focusedObjectId = document.activeElement?.closest?.('[data-object-id]')?.dataset.objectId;
    const width = measure();
    state.shelfWidth = width;
    // A refresh can complete while home is hidden behind the reader. Keep the
    // currently painted DOM in that case: the open book still needs its shelf
    // spine as the target of the return animation. ResizeObserver re-renders
    // the updated records when the shelf becomes visible again. Cover analysis
    // needs no layout: start it now so a book imported straight into the
    // reader flies home in its final cloth instead of changing after landing.
    if (width <= 0 && state.books.length > 0) {
      for (const book of state.books) resolveCoverAppearance(book);
      settleReturnSlot();
      return;
    }
    if (state.books.length === 0 && opts.sections) {
      if (width > 0) consumeRenderRequests();
      state.shelfScene?.dispose();
      state.shelfScene = null;
      scroller.textContent = '';
      scroller.append(buildEmptyState());
      settleReturnSlot();
      return;
    }
    if (width <= 0) { settleReturnSlot(); return; } // el ResizeObserver volverá a llamar
    // This synchronous paint includes every appearance change already in
    // memory. Consume earlier deferred/RAF requests only after the guards:
    // a hidden or busy shelf still needs them when it can render again.
    consumeRenderRequests();
    const retainedScene = state.shelfScene;
    const previousChildren = retainedScene ? [...scroller.children] : [];
    if (!retainedScene) scroller.textContent = '';

    const plantSlotWidth = variant => plantShelfObject({ key:'plant', variant }).width;
    const plantVariants = DEFAULT_LAYOUT.plantVariants;
    const pendingGeometry = state.books.filter(book => bookGeometryState(book) !== 'ready');
    const geometryBooks = state.books.filter(book => bookGeometryState(book) === 'ready');
    const plan = planBookshelf(geometryBooks, {
      shelfWidth: width,
      padding: shelfPadding(),
      gap: opts.gap,
      plantEvery: opts.plantEvery,
      sort: opts.sort,
      spine: spineOptionsFor(width),
      // Only spaces the books out; the scene pads each thin spine's tap area to
      // the same minimum width (padTapRect) and picks the nearest centre.
      displayWidthFor: (_book, style) => Math.max(style.width, minimumBookCellWidth(window.innerWidth)),
      plantWidth: Math.min(...plantVariants.map(plantSlotWidth)),
      plantWidthFor: plantSlotWidth,
      // Sin secciones, 0 recientes: todo cae en una estantería continua.
      recentLimit: opts.sections ? opts.recentLimit : 0
    }, batchSpineStyles);
    if (!opts.sections && !plan.length) plan.push({ id:'library', title:'', count:0, shelves:[] });
    if (!opts.sections && plan.length === 1) {
      const minimum = Math.max(1, Math.floor(Number(opts.minimumShelves) || 1));
      const plants = ['sansevieria', 'pothos', 'suculenta', 'monstera'];
      while (plan[0].shelves.length < minimum) {
        const index = plan[0].shelves.length;
        plan[0].shelves.push({
          index,
          items: [{
            kind: 'plant', variant: plants[index % plants.length],
            seed: `empty-shelf-${index}`, width: plantSlotWidth(plants[index % plants.length])
          }]
        });
      }
    }

    for (const section of plan) for (const shelf of section.shelves) for (const item of shelf.items) {
      if (item.kind !== 'book') continue;
      item.baseStyle = item.style;
      item.coverKey = coverKeyFor(item.book);
      const appearance = state.coverAppearances.get(String(item.book.id ?? item.book.path ?? item.book.title ?? 'book'));
      applyCoverAppearance(item, appearance?.key === item.coverKey ? appearance.appearance : null);
    }
    if (!opts.sections && plan.length === 1) plan[0].shelves = freelyPlacedShelves(plan[0].shelves);

    state.itemsById.clear();
    const fragment = document.createDocumentFragment();
    const heading = el('div', { class: 'ihr-library-heading' }, [
      el('h1', { text: 'Biblioteca' }),
      el('div', { class:'ihr-library-heading__tools' }, [
        // An empty shelf already says so below; "0 libros" would only repeat it.
        el('p', { 'aria-live': 'polite', text: state.books.length ? `${state.books.length} ${state.books.length === 1 ? 'libro' : 'libros'}` : '' })
      ])
    ]);
    fragment.append(heading);
    if (pendingGeometry.length) fragment.append(buildGeometryStatus(pendingGeometry));
    if (!state.books.length) {
      const body = opts.texts.emptyText ?? opts.texts.emptyBody;
      fragment.append(el('div', { class:'ihr-empty ihr-empty--library' }, [
        el('h2', { class:'ihr-empty__title', text:opts.texts.emptyTitle }),
        body ? el('p', { class:'ihr-empty__body', text:body }) : null,
        onPickLocal ? el('button', { type:'button', class:'ihr-btn ihr-btn--primary ihr-empty__action',
          onClick:() => onPickLocal() }, [svgIcon(['M12 5v14', 'M5 12h14'], { className:'ihr-icon' }), el('span', { text:opts.texts.emptyAction })]) : null
      ]));
    }
    const stage = el('div', { class:'ihr-shelf-stage' });
    for (const type of ['selectstart', 'contextmenu', 'dragstart'])
      stage.addEventListener(type, event => event.preventDefault(), { capture:true });
    stage.style.setProperty('--ihr-cabinet-width', `${width}px`);
    if (trashNode) {
      if (!state.useScene) {
        trashNode.hidden = state.viewMode !== SHELF_VIEW_MODES.ISOMETRIC;
        trashNode.inert = trashNode.hidden;
      }
      stage.append(trashNode);
    }
    if (catalogNode) {
      if (!state.useScene) {
        catalogNode.hidden = state.viewMode !== SHELF_VIEW_MODES.ISOMETRIC;
        catalogNode.tabIndex = catalogNode.hidden ? -1 : 0;
      }
      stage.append(catalogNode);
    }
    for (const section of plan) {
      const wrapper = el('section', {
        class: `ihr-section ihr-section--${section.id}`,
        'aria-label': section.title || opts.texts.shelfLabel
      });
      if (section.title) {
        const count = section.shelves.reduce((sum, shelf) => sum + shelf.items.filter(item => item.kind === 'book').length, 0);
        wrapper.append(el('div', { class: 'ihr-section__header' }, [
          el('h2', { class: 'ihr-section__title', text: section.title }),
          el('span', { class: 'ihr-section__count', text: String(count), 'aria-label': `${count} libros` })
        ]));
      }
      for (const shelf of section.shelves) wrapper.append(buildShelf(shelf));
      stage.append(wrapper);
    }
    fragment.append(stage);
    if (retainedScene) {
      // Measure the new semantic layout without moving the painted cabinet.
      stage.style.cssText = `position:absolute;left:0;top:0;width:${width}px;visibility:hidden;--ihr-cabinet-width:${width}px`;
      heading.style.cssText = 'position:absolute;visibility:hidden';
    }
    scroller.append(fragment);
    if (state.useScene) {
      const layout = readShelfLayout(stage, width);
      stage.style.cssText = `--ihr-cabinet-width:${width}px`;
      heading.style.cssText = '';
      for (const previous of previousChildren) previous.remove();
      if (retainedScene) retainedScene.updateLayout(layout);
      else state.shelfScene = createBookshelfScene(layout);
      state.shelfScene?.setPresentationActive?.(state.presentationActive);
      shelfZoom.sync();
    }
    if (focusedObjectId) {
      [...scroller.querySelectorAll('[data-object-id]')]
        .find(node => node.dataset.objectId === focusedObjectId)?.focus({ preventScroll:true });
    } else if (focusedBookId) {
      [...scroller.querySelectorAll('.ihr-spine')]
        .find(node => node.dataset.bookId === focusedBookId)
        ?.focus({ preventScroll: true });
    }
    state.metadataContext = metadataContext();
    for (const book of state.books) resolveCoverAppearance(book);
    settleReturnSlot();
  }

  function readShelfLayout(stage, width) {
    const origin = stage.getBoundingClientRect();
    const entries = [];
    const rows = [];
    for (const shelf of stage.querySelectorAll('.ihr-shelf')) {
      // Measure before replacing the DOM drawing with the shared 3D scene.
      shelf.style.contentVisibility = 'visible';
      const row = shelf.querySelector('.ihr-shelf__row').getBoundingClientRect();
      const shelfIndex = rows.length;
      rows.push({ top:row.top - origin.top, bottom:row.bottom - origin.top,
        ceiling:shelfIndex ? rows[shelfIndex - 1].bottom + 15 : 12 });
      for (const node of shelf.querySelectorAll('.ihr-spine, .ihr-plant, .ihr-lamp')) {
        const rect = node.getBoundingClientRect();
        const x = rect.left + rect.width / 2 - origin.left;
        const y = rect.top + rect.height / 2 - origin.top;
        if (node.classList.contains('ihr-lamp')) {
          const record = state.lamps.find(item => item.key === node.dataset.objectId);
          if (!record) continue;
          const item = lampShelfObject(record);
          entries.push({ ...item, node, x, y:item.mount === 'undershelf' ? rows[shelfIndex].ceiling : y,
            shelf:shelfIndex, depthInset:0 });
          continue;
        }
        if (node.classList.contains('ihr-plant')) {
          const record = state.plants.find(item => item.key === node.dataset.objectId);
          entries.push({ kind:'plant', key:node.dataset.objectId, node, x, y, shelf:shelfIndex, depthInset:0, width:rect.width, height:rect.height,
            depth:record ? plantShelfObject(record).depth : rect.width * .7,
            catalogId:node.dataset.catalogId, potId:node.dataset.potId, potColorId:node.dataset.potColorId,
            seed:node.dataset.plantSeed, variant:node.dataset.plantVariant });
          continue;
        }
        const item = state.itemsById.get(node.dataset.bookId);
        if (!item) continue;
        const height = (window.innerWidth >= 600 ? 200 : 172) * item.style.heightRatio;
        entries.push({ node, book:item.book, style:item.style, x, y, height, shelf:shelfIndex, depthInset:0,
          width:height * coverRatioFor(item.style), thickness:item.style.width,
          coverUrl:resolveCoverImmediately(item.book) });
      }
    }
    const layout = { stage, scroller, entries, rows, width, sceneWidth:width, trashNode, catalogNode,
      shelfType:state.shelfType, height:stage.getBoundingClientRect().height, mode:state.viewMode };
    return placeRooftopPlants(shelfModelLayout(layout, state.shelfType));
  }

  function scheduleRender() {
    if (state.returnMotion || state.reorderTimer || state.busy || state.session || state.dragSession || state.compatibilityTapTimer) { state.renderQueued = true; return; }
    if (state.frame) return;
    state.frame = requestAnimationFrame(() => {
      state.frame = 0;
      if (state.queuedBooks) applyDeferredShelfUpdates();
      else render();
    });
  }

  function prepareInitialAppearances() {
    if (!options.waitForCoverAppearance || state.books.length === 0) return;
    const pending = [];
    for (const book of state.books) {
      const id = String(book?.id ?? book?.path ?? book?.title ?? 'book');
      const key = coverKeyFor(book);
      const saved = book.coverAppearance && book.coverAppearanceKey === key
        ? book.coverAppearance
        : null;
      if (saved) {
        state.coverAppearances.set(id, { key, appearance: saved, complete: true });
        continue;
      }
      if (book.cover ?? book.coverBlob ?? book.coverUrl) pending.push(book);
    }
    if (pending.length === 0) return;
    state.appearancesReady = false;
    const generation = ++state.appearanceGeneration;
    Promise.allSettled(pending.map(async book => {
      const id = String(book?.id ?? book?.path ?? book?.title ?? 'book');
      const key = coverKeyFor(book);
      const url = await resolveCover(book);
      if (!url) {
        state.coverAppearances.set(id, { key, appearance: null, complete: true });
        return;
      }
      const appearance = await analyzeCoverAppearance(url, book?.title ?? '', { matchFont: false });
      if (!state.destroyed) {
        // Color and physical proportions are enough for a stable first frame.
        // Full title-font matching continues after that frame is visible.
        state.coverAppearances.set(id, {
          key, appearance, complete: appearance == null
        });
      }
    }))
      .then(() => {
        if (state.destroyed || generation !== state.appearanceGeneration) return;
        state.appearancesReady = true;
        scheduleRender();
      });
  }

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

  function metadataContext() {
    return JSON.stringify([window.innerWidth, window.innerHeight, window.devicePixelRatio || 1,
      state.shelfType, state.viewMode, scroller.clientHeight]);
  }

  function adoptMetadataRecords(nextBooks) {
    if (options.adoptMetadata !== true || options.texts || opts.sections !== false || opts.sort !== 'none' || !state.useScene || !state.shelfScene ||
        !state.presentationActive || state.destroyed || state.busy || state.session || state.pendingSelection ||
        state.returnMotion || state.dragSession || state.compatibilityTapTimer || state.reorderTimer || state.trashRemoval || state.arranging ||
        state.returningBookId !== null || state.pressedBookId !== null || state.pendingRemovals.size ||
        state.queuedBooks || state.frame || state.renderQueued || state.appearanceRefreshPending ||
        !state.appearancesReady || state.appearanceTasks.size ||
        state.metadataContext !== metadataContext() || measure() !== state.shelfWidth ||
        !canAdoptShelfMetadata(state.books, nextBooks)) return false;
    if (state.itemsById.size !== state.books.length) return false;
    for (const book of state.books) {
      if (state.itemsById.get(String(book.id))?.book !== book || bookGeometryState(book) !== 'ready') return false;
    }
    for (const book of nextBooks) {
      if (bookGeometryState(book) !== 'ready' || !state.itemsById.has(String(book.id))) return false;
    }
    const byId = new Map(nextBooks.map(book => [String(book.id), book]));
    for (const item of state.placementObjects) {
      if (item.kind === 'book' && !byId.has(String(item.book.id))) return false;
    }
    if (!state.shelfScene.adoptMetadataRecords?.(state.books, nextBooks)) return false;
    clearPlacementPreview();
    state.books = nextBooks.slice();
    for (const book of nextBooks) state.itemsById.get(String(book.id)).book = book;
    for (const item of state.placementObjects) {
      if (item.kind === 'book') item.book = byId.get(String(item.book.id));
    }
    if (state.lastOpened) {
      const latest = nextBooks.find(book => book.id === state.lastOpened.book.id);
      if (latest) state.lastOpened.book = latest;
    }
    return true;
  }

  /** Sustituye la biblioteca y vuelve a pintar, conservando el scroll. */
  function refresh(nextBooks, { defer = false } = {}) {
    if (state.destroyed) return;
    if (defer || state.returnMotion || state.reorderTimer || state.busy || state.session || state.dragSession || state.compatibilityTapTimer) {
      if (Array.isArray(nextBooks)) state.queuedBooks = nextBooks.filter(book => !state.pendingRemovals.has(String(book.id)));
      if (defer) scheduleRender();
      return;
    }
    if (adoptMetadataRecords(nextBooks)) return;
    state.queuedBooks = null;
    const top = scroller.scrollTop;
    // A removal still being written must not let an older record list put its book back.
    state.books = Array.isArray(nextBooks) ? nextBooks.filter(book => !state.pendingRemovals.has(String(book.id))) : state.books;
    if (!state.appearancesReady && options.waitForCoverAppearance) {
      state.appearanceGeneration += 1;
      state.appearancesReady = true;
      prepareInitialAppearances();
    }
    state.shelfWidth = 0; // fuerza el re-empaquetado
    settleReturnSlot({ beforeRender:true });
    render();
    scroller.scrollTop = top;
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

  function setReturningBook(bookId) {
    const next = bookId == null ? null : String(bookId);
    if (state.returnSlotWaiter && state.returnSlotWaiter.bookId !== next) finishReturnSlot(false);
    state.shelfScene?.setModalBackgroundDeferred?.(null, { resumeHidden:true });
    const previous = state.returningBookId;
    state.returningBookId = next;
    state.shelfScene?.setPaintHeld?.(next !== null);
    for (const node of root.querySelectorAll('.ihr-spine')) {
      if (previous !== next && node.dataset.bookId === previous) node.classList.remove('is-away');
      if (node.dataset.bookId === next) node.classList.add('is-away');
    }
  }

  function finishReturnSlot(ready) {
    const pending = state.returnSlotWaiter;
    if (!pending) return;
    state.returnSlotWaiter = null;
    if (!ready && state.returningBookId === pending.bookId) setReturningBook(null);
    pending.resolve(ready);
  }

  function settleReturnSlot({ beforeRender = false } = {}) {
    const pending = state.returnSlotWaiter;
    if (!pending) return;
    const book = state.books.find(record => String(record.id) === pending.bookId);
    if (state.destroyed || !root.isConnected || !book || bookGeometryState(book) !== 'ready'
        || window.innerWidth !== pending.width || window.innerHeight !== pending.height) {
      finishReturnSlot(false); return;
    }
    // Initial analysis owns the next render; waiting for just its promise is
    // insufficient, because its RAF has not constructed the semantic slot yet.
    // Full font matching is independent and never keeps this gate waiting.
    if (!state.appearancesReady || beforeRender) return;
    const spine = [...root.querySelectorAll('.ihr-spine')]
      .find(node => node.dataset.bookId === pending.bookId);
    finishReturnSlot(Boolean(measure() > 0 && state.itemsById.has(pending.bookId) && spine?.isConnected));
  }

  function waitForReturnSlot(bookId) {
    const held = state.returningBookId === String(bookId);
    finishReturnSlot(false);
    if (held) setReturningBook(bookId);
    return new Promise(resolve => {
      state.returnSlotWaiter = { bookId:String(bookId), resolve,
        width:window.innerWidth, height:window.innerHeight };
      settleReturnSlot();
    });
  }

  /** Cierra el tomo 3D desde el lector y lo devuelve a su hueco. */
  async function returnToShelf(bookId, { pageSnapshot, book:latestBook, onPageReady } = {}) {
    const durations = readerBookTiming(prefersReducedMotion()).closing;
    const record = state.books.find(book => String(book.id) === String(bookId));
    if (!record || bookGeometryState(record) !== 'ready') {
      if (state.returningBookId === String(bookId)) setReturningBook(null);
      return false;
    }
    if ((!state.appearancesReady || !state.itemsById.has(String(bookId))) && !await waitForReturnSlot(bookId)) return false;
    state.shelfScene?.setModalBackgroundDeferred?.(null, { resumeHidden:true });
    const item = state.itemsById.get(String(bookId));
    const previous = state.lastOpened?.book.id === bookId ? state.lastOpened
      : item ? { book:item.book, style:item.style } : null;
    if (!previous || previous.book.id !== bookId || state.destroyed) return false;
    state.returnMotion?.cancel();
    state.lastOpened = previous;
    const book = latestBook || state.books.find(candidate => candidate.id === bookId) || previous.book;
    state.books = state.books.map(record => record.id === bookId ? book : record);
    if (item) item.book = book;
    // Normally analysed while the reader was open. If not, wait briefly so
    // the flight, the landing and the resting spine share one cloth/ribbon.
    const appearanceKey = coverKeyFor(book);
    const known = state.coverAppearances.get(String(bookId));
    if (item && !(known?.key === appearanceKey && known.complete !== false)) {
      const appearance = await Promise.race([
        resolveCoverAppearance(book).catch(() => null),
        new Promise(resolve => setTimeout(resolve, 320, null))
      ]);
      if (state.destroyed || state.lastOpened !== previous) return false;
      if (appearance && applyCoverAppearance(item, appearance)) previous.style = item.style;
    }
    const spine = [...root.querySelectorAll('.ihr-spine')].find(node => node.dataset.bookId === String(bookId)) || previous.spineEl;
    if (!spine?.isConnected) { state.lastOpened = null; return false; }

    if (state.viewMode !== SHELF_VIEW_MODES.ISOMETRIC) spine.scrollIntoView?.({ block:'nearest', behavior:'instant' });
    state.shelfScene?.flush();
    const rect = spine.getBoundingClientRect();
    const sourcePose = state.shelfScene?.getBookPose(spine);
    if (!rect.width || !rect.height) { state.lastOpened = null; return false; }
    const vw = window.innerWidth || 390, vh = window.innerHeight || 780;
    const landscape = vh <= 560 && vw >= 560;
    const ratio = coverRatioFor(previous.style);
    const coverH = Math.min(vh * (landscape ? .72 : .54), landscape ? 350 : Math.max(110, vh - 330), 440,
      (vw * (landscape ? .35 : .78)) / ratio, (vw * .86) / (ratio + (sourcePose ? sourcePose.thickness/sourcePose.height : rect.width/rect.height) * .55));
    const coverW = coverH * ratio;
    const startScale = sourcePose ? sourcePose.scale * sourcePose.height / coverH : rect.height / coverH;
    const thickness = sourcePose ? sourcePose.thickness * coverH / sourcePose.height : Math.max(6, rect.width / startScale);
    const centerX = vw * (landscape ? .26 : .5) + thickness * .19;
    const centerY = vh * (landscape ? .5 : .42);
    const readingPose = planReadingBookPose({ width:coverW, height:coverH, thickness,
      viewportWidth:vw, viewportHeight:vh, centerX, centerY });
    const dx = (sourcePose?.centerX ?? rect.left + rect.width / 2) - centerX;
    const dy = (sourcePose?.centerY ?? rect.top + rect.height / 2) - centerY;
    const lift = Math.min(40, rect.height * .2);
    const dockingPose = state.shelfScene?.getReturnPose(spine);
    const target = dockingPose || sourcePose;
    const end = { x:(target?.centerX ?? centerX+dx)-centerX, y:(target?.centerY ?? centerY+dy)-centerY,
      scale:target ? target.scale*target.height/coverH : startScale,
      angle:target?.angle ?? 90, pitch:target?.pitch ?? 0, roll:target?.roll ?? 0 };
    const stage = el('div', { class:'ihr-flyout__stage' });
    const bookNode = el('div', { class:'ihr-flyout__book', style:
      `left:${(vw-coverW)/2}px;top:${centerY-coverH/2}px;width:${coverW}px;height:${coverH}px` });
    stage.append(bookNode);
    const scrim = el('div', { class:'ihr-flyout__scrim', style:'opacity:0' });
    const flyout = el('div', { class:'ihr-flyout ihr-flyout--return', 'aria-hidden':'true', style:'visibility:hidden' }, [scrim, stage]);
    flyout.dataset.returnPhase = 'preparing';
    const coverUrl = resolveCoverImmediately(book);
    if (state.destroyed || state.lastOpened !== previous || window.innerWidth !== vw || window.innerHeight !== vh) return false;
    const returnGeometry = { width:coverW,height:coverH,thickness,viewportWidth:vw,viewportHeight:vh,centerX,centerY };
    const cachedView = pageSnapshot?.source ? await returnViews.takeCompatible({
      signature:bookReturnSignature(book,previous.style,returnGeometry,coverUrl),
      compatibility:bookReturnCompatibility(book,previous.style,returnGeometry),book,style:previous.style,coverUrl
    }) : returnViews.take(null);
    if (state.destroyed || state.lastOpened !== previous || window.innerWidth !== vw || window.innerHeight !== vh) {
      cachedView?.dispose(); return false;
    }
    if (cachedView) { cachedView.deferDrawing?.(); bookNode.append(cachedView.canvas); cachedView.updateBookmark(book); }
    const view = cachedView || bookView(bookNode, book, previous.style, {
      width:coverW, height:coverH, thickness, viewportWidth:vw, viewportHeight:vh,
      centerX, centerY, coverUrl,
      deferDraw:Boolean(pageSnapshot?.source),
      compactReturnFrame:Boolean(pageSnapshot?.source),
      adaptiveNativeFrame:true,
      initialPose:{ x:0, y:0, scale:1, angle:0, pitch:0, coverOpen:pageSnapshot ? 1 : 0, bookmarkWithdraw:pageSnapshot ? 1 : 0 }
    });
    if (view) {
      flyout.dataset.returnView = cachedView ? 'reused' : 'created';
      bookNode.classList.add('ihr-flyout__book--webgl');
      bookNode.style.cssText = 'position:absolute;inset:0;width:100%;height:100%';
    } else {
      bookNode.classList.add('ihr-flyout__book--fallback');
      bookNode.style.cssText = `position:absolute;width:${coverW}px;height:${coverH}px;left:${(vw-coverW)/2}px;top:${centerY-coverH/2}px`;
      const pages = el('div', { class:'ihr-flyout__fallback-pages' });
      const leaf = el('div', { class:'ihr-flyout__fallback-leaf' }, [buildCoverFace(book, coverUrl, previous.style),
        el('div', { class:'ihr-flyout__face ihr-flyout__face--inside' })]);
      bookNode.append(pages, leaf);
    }
    const pose = (x, y, scale, angle, pitch=0) => ({ x,y,scale,angle,pitch });
    document.body.append(flyout);
    spine.classList.add('is-away');
    state.shelfScene?.updateEntry?.(spine, book, previous.style, coverUrl);
    state.shelfScene?.flush();
    const duration = durations.flight;
    const approachDuration = view && dockingPose ? duration * .66 : duration;
    const startFlight = () => view ? view.animate([
      { transform:pose(0,0,1,0,0), offset:0 },
      { transform:pose(-dx*.12,-lift*.5,.94,12,3), offset:.22 },
      { transform:pose(end.x*.38,end.y*.38-lift,startScale+(1-startScale)*.38,end.angle*.7,4), offset:.68 },
      { transform:end, offset:1 }
    ], { duration:approachDuration }) : animate(bookNode, [
      { opacity:1, transform:'translate(0,0) scale(1)' },
      { opacity:.85, transform:`translate(${dx}px, ${dy}px) scale(${startScale})` }
    ], { duration, easing:EASE, fill:'both' });
    const restoreShelfSpine = ({ flush = true } = {}) => {
      const current = [...root.querySelectorAll('.ihr-spine')]
        .find(node => node.dataset.bookId === String(bookId)) || spine
      current.classList.remove('is-away')
      // A queued record refresh rebuilds the resting spine before the caller's
      // final cleanup. Release this return's marker with its actual landing so
      // that rebuilt DOM cannot briefly hide the already inserted book again.
      if (state.returningBookId === String(bookId)) {
        state.returningBookId = null
        state.shelfScene?.setPaintHeld?.(false)
      }
      if (flush) state.shelfScene?.flush();
      return current
    }
    let animation = null, insertion = null;
    const fallbackAnimations = [];
    const motion = { cancel() {
      animation?.cancel?.(); insertion?.cancel();
      for (const fallback of fallbackAnimations) fallback.cancel?.();
      restoreShelfSpine(); view?.dispose(); flyout.remove();
      if (state.returnMotion === motion) state.returnMotion = null;
      applyDeferredShelfUpdates()
    } };
    state.returnMotion = motion;
    const active = () => state.returnMotion === motion && !state.destroyed;
    let releaseFrame;
    try {
      if (view) await view.ready;
      releaseFrame = view?.holdNativeMotionFrame?.();
      if (!active()) return false;
      if (pageSnapshot?.source && view) { view.deferDrawing?.(); view.setCompactReturnFrame?.(true); }
      if (pageSnapshot?.source && view && view.setPageSnapshot(pageSnapshot)) {
        view.draw({ ...readingPose, bookmarkWithdraw:1 },{redraw:false});
        if (!view.alignToPage(pageSnapshot.displayBounds)) throw new Error('No se pudo alinear la página al cerrar el libro.');
        state.shelfScene?.setPaintHeld?.(false); state.shelfScene?.flush();
        flyout.style.visibility = '';
        onPageReady?.();
        flyout.dataset.returnPhase = 'zooming';
        animate(scrim, [{ opacity:0 }, { opacity:1 }], { duration:prefersReducedMotion() ? 1 : 320, fill:'both' });
        // Back to white paper on the zoom's own clock: the page leaves the reader in
        // its theme (as the still image shows it) and the book closes on white paper.
        animation = view.animate([{ transform:view.getPose() }, { transform:{ ...readingPose, bookmarkWithdraw:1, ...(pageSnapshot.paper ? { pageTheme:0 } : {}) } }],
          { duration:durations.zoom });
        await waitForMotion(animation, durations.zoom);
        if (!active()) return false;
        // The zoom's large framebuffer no longer needs to survive the ribbon,
        // hinge and flight. Their existing per-motion reservations retain the
        // exact projected book at the same DPR without keeping empty pixels.
        releaseFrame?.(); releaseFrame = null;
        // White paper from here on, even if a stalled frame let the zoom's watchdog release it early.
        if (pageSnapshot.paper && view.getPageTheme() > 0) view.setPageTheme(0);
        flyout.dataset.returnPhase = 'bookmark';
        animation = view.animateBookmark({ withdraw:0, duration:durations.bookmark });
        await waitForMotion(animation, durations.bookmark);
        if (!active()) return false;
        flyout.dataset.returnPhase = 'closing';
        animation = view.animateCoverClose({ duration:durations.cover,
          targetPose:{ x:0,y:0,scale:1,angle:0,pitch:0,roll:0 } });
        await waitForMotion(animation, durations.cover);
        if (!active()) return false;
      } else if (pageSnapshot?.source && !view) {
        const pages = bookNode.querySelector('.ihr-flyout__fallback-pages');
        const leaf = bookNode.querySelector('.ihr-flyout__fallback-leaf');
        // The still-page layer owns the snapshot's DOM canvas until handoff.
        // Only the non-WebGL fallback needs a second DOM copy for its leaf.
        const image = readerReturnCanvas(pageSnapshot.source);
        image.dataset.pageSource = pageSnapshot.sourceType || pageSnapshot.engine;
        image.dataset.pageLocator = JSON.stringify(pageSnapshot.location?.locator ?? null);
        const pageW = coverW*.92, pageH = coverH*.975;
        const fit = Math.min(pageW/pageSnapshot.width,pageH/pageSnapshot.height);
        image.className = 'ihr-flyout__saved-page';
        image.style.cssText = `position:absolute;width:${pageSnapshot.width*fit}px;height:${pageSnapshot.height*fit}px;left:${(pageW-pageSnapshot.width*fit)/2}px;top:${(pageH-pageSnapshot.height*fit)/2}px`;
        pages.replaceChildren(...fallbackPageLayers(image, pageSnapshot, 1)); leaf.style.transform = 'rotateY(-169deg)';
        const bounds = pageSnapshot.displayBounds;
        const local = image.getBoundingClientRect(), scale = bounds.width/local.width;
        const bookBounds = bookNode.getBoundingClientRect();
        const x = bounds.left + bounds.width/2 - local.left-local.width/2 + (1-scale)*(local.left+local.width/2-bookBounds.left-bookBounds.width/2);
        const y = bounds.top + bounds.height/2 - local.top-local.height/2 + (1-scale)*(local.top+local.height/2-bookBounds.top-bookBounds.height/2);
        bookNode.style.transform = `translate(${x}px,${y}px) scale(${scale})`;
        state.shelfScene?.setPaintHeld?.(false); state.shelfScene?.flush();
        flyout.style.visibility = ''; onPageReady?.();
        flyout.dataset.returnPhase = 'zooming';
        animation = animate(bookNode,[{ transform:bookNode.style.transform },{ transform:'translate(0,0) scale(1)' }],
          { duration:durations.zoom, easing:EASE, fill:'both' });
        fallbackAnimations.push(animation);
        if (pageSnapshot.paper?.source) fallbackAnimations.push(animate(image,[{ opacity:1 },{ opacity:0 }],
          { duration:durations.zoom, easing:EASE, fill:'both' }));
        await waitForMotion(animation, durations.zoom);
        if (!active()) return false;
        bookNode.style.transform = 'translate(0,0) scale(1)'; animation.cancel?.();
        flyout.dataset.returnPhase = 'bookmark';
        const ribbon = el('div', { class:'ihr-flyout__return-ribbon' }); pages.append(ribbon);
        animation = animate(ribbon,[{ transform:'translateY(-130%)' },{ transform:'translateY(0)' }],
          { duration:durations.bookmark, fill:'both', easing:EASE });
        fallbackAnimations.push(animation); await waitForMotion(animation, durations.bookmark);
        if (!active()) return false;
        flyout.dataset.returnPhase = 'closing';
        animation = animate(leaf,[{ transform:'rotateY(-169deg)' },{ transform:'rotateY(0deg)' }],
          { duration:durations.cover, fill:'both', easing:EASE });
        fallbackAnimations.push(animation); await waitForMotion(animation, durations.cover);
        if (!active()) return false;
      }
      state.shelfScene?.setPaintHeld?.(false); state.shelfScene?.flush();
      flyout.style.visibility = ''; onPageReady?.();
      flyout.dataset.returnPhase = 'returning';
      animate(scrim,[{ opacity:pageSnapshot ? 1 : 0 },{ opacity:0 }],{ duration:approachDuration, fill:'both' });
      animation = startFlight();
      await waitForMotion(animation, approachDuration);
      if (state.returnMotion === motion && view && dockingPose && !state.destroyed) {
        flyout.dataset.returnPhase = 'inserting';
        insertion = view.handoffToShelfInsertion?.(nativePresentation => state.shelfScene?.returnBook(spine,
          { duration:duration - approachDuration, overlayCanvas:view.canvas, nativePresentation }));
        if (!insertion) {
          view.releaseToSnapshot?.();
          insertion = state.shelfScene?.returnBook(spine, { duration:duration - approachDuration, overlayCanvas:view.canvas });
        }
        if (insertion) {
          await waitForMotion(insertion, duration - approachDuration);
        }
      }
      if (state.returnMotion === motion) {
        state.returnMotion = null;
        animation.cancel?.();
        for (const fallback of fallbackAnimations) fallback.cancel?.();
        // A queued layout paints the landed book itself. Keep the insertion
        // owner alive until that paint instead of drawing the old room first.
        restoreShelfSpine({ flush:false })
        applyDeferredShelfUpdates()
        // With no queued layout, this flush still paints the restored spine.
        state.shelfScene?.flush();
        view?.dispose(); flyout.remove();
        state.lastOpened = null;
        const currentSpine = [...root.querySelectorAll('.ihr-spine')]
          .find(node => node.dataset.bookId === String(bookId)) || spine
        currentSpine.focus?.({ preventScroll:true });
        maybeRefreshAppearanceStyles();
        return true;
      }
      return false;
    } catch (error) {
      motion.cancel();
      throw error;
    } finally { releaseFrame?.(); }
  }

  return {
    element: root,
    refresh,
    // Storage may notify for several records in one turn. Keep only the last
    // complete list and commit one semantic/GPU layout on the next frame.
    queueRefresh:nextBooks => refresh(nextBooks, { defer:true }),
    update: refresh,
    returnToShelf,
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
      clearOpeningClick?.();
      plantCatalog.destroy(); shelfViewGesture.destroy(); shelfZoom.destroy();
      cancelTrashRemoval();
      if (state.dragSession) finishSpineDrag({ pointerId:state.dragSession.pointerId }, state.dragSession.node, true);
      state.pendingSelection?.cancel();
      state.returnMotion?.cancel();
      state.session?.close({ instant: true, silent: true });
      if (state.frame) cancelAnimationFrame(state.frame);
      clearTimeout(state.reorderTimer);
      clearTimeout(state.trashStatusTimer);
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
