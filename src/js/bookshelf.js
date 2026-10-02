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
 * 6. Un contexto WebGL compartido dibuja la estantería y el libro abierto.
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

import { planBookshelf, bookmarkFor, withDefaults, DEFAULT_LAYOUT } from './bookshelf-layout.js';
import { analyzeCoverAppearance, coverAspectRatio, readCoverAspectRatio, withCoverAppearance } from './cover-appearance.js';
import { bookColorOptions, spineColorStyle, spineFinish, surfaceFinish, METAL_COLORS } from './book-colors.js';
import { normalizeBookAuthor } from './book-title.js';
import { bookView, fitCoverImage, getBookRenderer, planReadingBookPose } from './book-model.js';
import { analyzeCoverRelief, normalizeCoverRelief } from './cover-relief.js';
import { EDITOR_TABS, coverEditorPose, coverTiltFrames, editorTabId, nextEditorTab } from './cover-editor.js';
import { createShelfZoom } from './shelf-zoom.js';
import { markTiming, resetTimeline } from './perf-marks.js';
import { createBookshelfScene } from './bookshelf-scene.js';
import { layoutShelfDecorations, moveShelfDecoration } from './shelf-decoration-layout.js';
import { createPlantCatalog } from './plant-catalog.js';
import { normalizeShelfType, BAGGEBO_SPEC } from './shelf-types.js';
import { shelfModelLayout } from './shelf-model-layout.js';
import { placeRooftopPlants } from './plant-rooftop-layout.js';
import { getCatalogPlant, getCatalogPot, getPotColor } from './plant-catalog-data.js';
import { normalizeShelfPlant, resolveCatalogPlant } from './plant-records.js';
import { shelfScale, plantDimensions, bookSpineOptions, minimumBookCellWidth } from './plant-dimensions.js';
import { getCatalogLamp, normalizeShelfLamp } from './lamp-catalog-data.js';
import { lampCatalogIllustration } from './lamp-illustration.js';

const ROOF_PATH = 'M4 24 L20 8 L36 24';
const EASE = 'cubic-bezier(0.4, 0, 0.2, 1)';
const TAP_SLOP = 12;
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
  tapCover: (book) => `Toca para leer ${book.title ?? 'este libro'}`,
  closeAction: 'Cerrar',
  noCover: 'Sin portada',
  openAria: (book) =>
      book.author ? `Abrir ${book.title}, de ${normalizeBookAuthor(book.author)}` : `Abrir ${book.title}`,
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

const SPINE_FONTS = Object.freeze([
  { family: 'Playfair Display', label: 'Playfair Display', weight: 700, fallback: 'Georgia, serif' },
  { family: 'Lora', label: 'Lora', weight: 700, fallback: 'Georgia, serif' },
  { family: 'Cormorant Garamond', label: 'Cormorant Garamond', weight: 700, fallback: 'Georgia, serif' },
  { family: 'DM Sans', label: 'DM Sans', weight: 600, fallback: 'Arial, sans-serif' },
  { family: 'Montserrat', label: 'Montserrat', weight: 700, fallback: 'Arial, sans-serif' },
  { family: 'Oswald', label: 'Oswald', weight: 600, fallback: 'Arial Narrow, sans-serif' }
]);

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

let editorSerial = 0;

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
    pendingRemovals: new Set(),
    renderQueued: false,
    reorderTimer: 0,
    appearancesReady: true,
    appearanceGeneration: 0,
    shelfScene: null,
    useScene: Boolean((globalThis.WebGLRenderingContext || globalThis.WebGL2RenderingContext) && getBookRenderer()),
    viewMode: Object.values(SHELF_VIEW_MODES).includes(options.viewMode)
      ? options.viewMode
      : storedShelfViewMode()
  };

  const root = el('div', { class: 'ihr-bookshelf', 'data-ihr-bookshelf': '' });
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
  const shelfZoom = createShelfZoom({root,scroller,getScene:()=>state.shelfScene,
    isEnabled:()=>Boolean(state.shelfScene && state.viewMode === SHELF_VIEW_MODES.ISOMETRIC &&
      !state.busy && !state.session && !state.returnMotion && !state.trashRemoval),
    onGestureStart:()=>{
      if (state.dragSession) finishSpineDrag({pointerId:state.dragSession.pointerId},state.dragSession.node,true);
      state.pressedBookId = null;
      for (const node of scroller.querySelectorAll('.is-pressed')) node.classList.remove('is-pressed');
      state.shelfScene?.beginInspectionGesture?.();
    }});
  if (trashStatus) root.append(trashStatus, trashAnnounce);
  const plantCatalog = createPlantCatalog({ onAdd:addCatalogPlant, onAddLamp:addCatalogLamp, shelfType:state.shelfType,
    onShelfChange:({ shelfType }) => {
      state.shelfType = normalizeShelfType(shelfType);
      try { localStorage.setItem(SHELF_TYPE_STORAGE_KEY, state.shelfType); } catch { /* Local preference only. */ }
      render();
    } });
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

  function applyCoverAppearance(item, appearance) {
    item.style = appearance
      ? withCoverAppearance(item.baseStyle || item.style, appearance)
      : { ...(item.baseStyle || item.style) };
    if (item.book.spineColorOverride) {
      item.style = { ...item.style, ...spineColorStyle(item.book.spineColorOverride) };
    }
    const finish = spineFinish(item.book.spineFinish);
    if (finish !== 'matte') item.style = { ...item.style, ...spineColorStyle(METAL_COLORS[finish]) };
    else item.style.ink = spineColorStyle(item.style.color).ink;
    const textFinish = spineFinish(item.book.spineTextFinish);
    if (textFinish !== 'matte') item.style.ink = METAL_COLORS[textFinish];
    else if (/^#[0-9a-f]{6}$/i.test(item.book.spineTextColor || '')) item.style.ink = item.book.spineTextColor;
    if (item.book.spineFontFamily) {
      const font = SPINE_FONTS.find(candidate => candidate.family === item.book.spineFontFamily);
      if (font) item.style = {
        ...item.style, fontFamily: font.family, fontCanvasFamily: font.family,
        fontFallback: font.fallback, fontWeight: font.weight
      };
    }
    if (Number.isFinite(Number(item.book.spineFontSize))) {
      item.style = { ...item.style, spineFontSize: Math.max(8, Math.min(48, Number(item.book.spineFontSize))) };
    }
    if (Number.isFinite(Number(item.book.spineAuthorFontSize))) {
      item.style = { ...item.style, spineAuthorFontSize: Math.max(6, Math.min(36, Number(item.book.spineAuthorFontSize))) };
    }
    return Boolean(appearance);
  }

  function maybeRefreshAppearanceStyles() {
    if (!state.appearanceRefreshPending || state.busy || state.session || state.returnMotion || state.dragSession || state.destroyed) return;
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
          state.session.view?.updateAppearance(item.style);
          updateBookStyleVars(state.session.bookNode, item.style);
          updateBookStyleVars(state.session.bookNode?.querySelector('.ihr-flyout__face--cover'), item.style);
        }
        if (String(state.lastOpened?.book?.id ?? '') === id) state.lastOpened.style = item.style;
        const existing = [...root.querySelectorAll('.ihr-spine')]
          .find(node => node.dataset.bookId === id);
        if (existing?.isConnected && !state.busy && !state.session && !state.returnMotion && !state.dragSession && state.pressedBookId !== id) {
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

  function spineStyleVars(style) {
    const family = style.fontFamily || 'Playfair Display';
    const fallback = style.fontFallback || 'Georgia, serif';
    return `--ihr-spine-base:${style.color};` +
      `--ihr-spine-shade:${style.shade};` +
      `--ihr-spine-ink:${style.ink};` +
      `--ihr-spine-font:"${family}", ${fallback};` +
      `--ihr-spine-font-weight:${style.fontWeight || 700};` +
      `--ihr-spine-font-size:${Math.max(8, Math.min(48, Number(style.spineFontSize) || 10))}px;` +
      `--ihr-spine-author-font-size:${Math.max(6, Math.min(36, Number(style.spineAuthorFontSize) || 12))}px;`;
  }

  function coverRatioFor(style, fallback = opts.coverRatio) {
    return coverAspectRatio(style?.coverRatio, 1) || fallback;
  }

  function updateBookStyleVars(node, style) {
    if (!node || !style) return;
    node.style.setProperty('--ihr-spine-base', style.color);
    node.style.setProperty('--ihr-spine-shade', style.shade);
    node.style.setProperty('--ihr-spine-ink', style.ink);
    node.style.setProperty('--ihr-spine-font', `"${style.fontFamily || 'Playfair Display'}", ${style.fontFallback || 'Georgia, serif'}`);
    node.style.setProperty('--ihr-spine-font-weight', String(style.fontWeight || 700));
    node.style.setProperty('--ihr-spine-font-size', `${Math.max(8, Math.min(48, Number(style.spineFontSize) || 10))}px`);
    node.style.setProperty('--ihr-spine-author-font-size', `${Math.max(6, Math.min(36, Number(style.spineAuthorFontSize) || 12))}px`);
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

  function savePlants({ strict = false } = {}) {
    try { localStorage.setItem(SHELF_PLANTS_STORAGE_KEY, JSON.stringify(state.plants)); }
    catch (error) { if (strict) throw error; }
  }

  function saveLamps({ strict = false } = {}) {
    try { localStorage.setItem(SHELF_LAMPS_STORAGE_KEY, JSON.stringify(state.lamps)); }
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

  async function addCatalogLamp({ lampId }) {
    if (state.destroyed || state.busy || state.session || state.dragSession || state.returnMotion)
      throw new Error('Espera a que termine la animación.');
    const lamp = getCatalogLamp(lampId);
    if (!lamp) throw new Error('Elige una lámpara.');
    const key = `lamp:${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
    const record = normalizeShelfLamp({ key, seed:key, lampId:lamp.id, shelf:0,
      ...(lamp.mount === 'undershelf' ? { x:.5 } : {}) });
    const previous = state.lamps, oldRects = objectRects();
    const arranged = layoutShelfDecorations([...state.placementObjects, lampShelfObject(record)], placementConfig());
    const positions = new Map(arranged.flatMap(shelf => shelf.items)
      .map(item => [item.key, { shelf:item.shelf, x:item.x }]));
    state.lamps = [...previous, record].map(item => ({ ...item, ...positions.get(item.key) }));
    try { saveLamps({ strict:true }); }
    catch (error) { state.lamps = previous; throw new Error('No se pudo guardar la lámpara. Reintenta.', { cause:error }); }
    render();
    state.shelfScene?.animateFromRects(oldRects);
    root.dataset.lastAddedLamp = key;
  }

  async function addCatalogPlant({ catalogId, potId, potColorId }) {
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
    render();
    state.shelfScene?.animateFromRects(oldRects);
    root.dataset.lastAddedPlant = key;
    const added = [...scroller.querySelectorAll('.ihr-plant')].find(node => objectKey(node) === key);
    if (state.viewMode !== SHELF_VIEW_MODES.ISOMETRIC) {
      added?.scrollIntoView?.({ block:'nearest', behavior:prefersReducedMotion() ? 'instant' : 'smooth' });
    }
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
      const preview = moveShelfDecoration(state.placementObjects, objectKey(node), drag.destination, placementConfig());
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
    state.suppressLampClickKey = null;
    let backgroundOnly = false;
    if (state.shelfScene) {
      const hit = state.shelfScene.getObjectAtPoint(event.clientX, event.clientY);
      backgroundOnly = !hit;
      if (hit && hit !== node) { node.classList.remove('is-pressed'); state.pressedBookId = null; }
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
      active: false, scrolling: false, cancelled: false, timer: 0
    };
    try { node.setPointerCapture?.(event.pointerId); } catch { /* el navegador pudo cancelar el puntero */ }
    // Rotated hit rectangles contain some empty space. It must still scroll
    // naturally on touch, without starting a hold on an occluded book.
    if (backgroundOnly) { node.classList.remove('is-pressed'); return; }
    drag.timer = setTimeout(() => {
      if (state.dragSession !== drag || state.destroyed) return;
      drag.active = true;
      state.arranging = true;
      root.classList.add('is-arranging');
      node.classList.remove('is-pressed');
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

  function finishSpineDrag(event, node, cancelled = false) {
    const drag = state.dragSession;
    if (!drag || drag.node !== node || drag.pointerId !== event.pointerId) return;
    clearTimeout(drag.timer);
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
    node.classList.remove('is-dragging', 'is-lifted');
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
    if (!drag.active) { applyDeferredShelfUpdates(); return; }
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
      trashAnnounce.textContent = `${item.book.title || 'Libro'} retirado de la estantería`;
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
        if (!state.destroyed) { render(); applyDeferredShelfUpdates(); }
      }
    }
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
    if (item.tilt) node.classList.add('is-tilted');
    // En un lomo estrecho el autor no cabe sin pisar al título.
    if (style.width < 32) node.classList.add('ihr-spine--slim');

    const body = el('span', { class: 'ihr-spine__body', 'aria-hidden': 'true' });
    const height = (window.innerWidth >= 600 ? 200 : 172) * style.heightRatio;
    const coverRatio = coverRatioFor(style);
    const view = state.useScene ? null : bookView(body, book, style, {
      width: height * coverRatio, height, thickness: style.width,
      viewportWidth: item.displayWidth ?? style.width, viewportHeight: height,
      centerX: (item.displayWidth ?? style.width) / 2, centerY: height / 2,
      shelf: true,
      shelfView: state.viewMode
    });
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
    let start = null;
    node.addEventListener('pointerdown', (event) => {
      start = { x: event.clientX, y: event.clientY };
      state.pressedBookId = String(book.id ?? book.path ?? book.title ?? 'book');
      node.classList.add('is-pressed');
      warmCover(book);
    });
    const release = () => {
      start = null;
      node.classList.remove('is-pressed');
      const id = String(book.id ?? book.path ?? book.title ?? 'book');
      if (state.pressedBookId === id) {
        state.pressedBookId = null;
        setTimeout(maybeRefreshAppearanceStyles, 0);
      }
    };
    node.addEventListener('pointerup', release);
    node.addEventListener('pointercancel', release);
    node.addEventListener('pointerleave', release);
    node.addEventListener('pointermove', (event) => {
      if (!start) return;
      if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > TAP_SLOP) {
        release(); // el dedo se ha ido a hacer scroll: esto no era un tap
      }
    });
    node.addEventListener('click', event => {
      if (state.arranging || state.suppressOpenBookId) { state.suppressOpenBookId = null; return; }
      const hit = event.detail ? state.shelfScene?.getBookAtPoint(event.clientX, event.clientY) : null;
      if (event.detail && state.shelfScene && !hit) return;
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
    node.addEventListener('pointerup', event => finishSpineDrag(event, state.dragSession?.node || node));
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
    node.addEventListener('pointerdown', event => startSpineDrag(event, node));
    node.addEventListener('pointermove', event => moveSpineDrag(event, state.dragSession?.node || node));
    node.addEventListener('pointerup', event => finishSpineDrag(event, state.dragSession?.node || node));
    node.addEventListener('pointercancel', event => finishSpineDrag(event, state.dragSession?.node || node, true));
    node.addEventListener('click', event => {
      if (event.detail && state.suppressLampClickKey === objectKey(node)) { state.suppressLampClickKey = null; return; }
      if (!event.detail) state.suppressLampClickKey = null;
      if (event.detail && state.shelfScene && state.shelfScene.getObjectAtPoint(event.clientX, event.clientY) !== node) return;
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
        normalizeShelfPlant({ key, seed, variant, shelf, x }));
      state.plantsInitialized = true;
      savePlants();
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
    try { localStorage.setItem(SHELF_VIEW_STORAGE_KEY, mode); } catch { /* Preferencias no bloquean la biblioteca. */ }
    if (state.shelfScene) {
      root.dataset.viewMode = mode;
      for (const button of root.querySelectorAll('.ihr-view-switch__button')) {
        button.setAttribute('aria-pressed', String(button.dataset.viewMode === mode));
      }
      state.shelfScene.setMode(mode); shelfZoom.sync();
    } else render();
    root.querySelector(`[data-view-mode="${mode}"]`)?.focus({ preventScroll:true });
  }

  function buildViewControls() {
    const controls = el('div', { class:'ihr-view-switch', role:'group', 'aria-label':'Vista de la estantería' });
    const modes = [
      { id:SHELF_VIEW_MODES.SPINE, label:'Lomos', title:'Vista de canto', icon:['M5 5v14','M10 3v18','M15 6v15','M20 4v16'] },
      { id:SHELF_VIEW_MODES.ISOMETRIC, label:'Isométrica', title:'Vista isométrica, libros de lado', icon:['M12 3 21 8v8l-9 5-9-5V8l9-5Z','m3.5 8.5 8.5 5 8.5-5','M12 13.5V21','m7.5 5.5 9 5'] }
    ];
    for (const mode of modes) {
      controls.append(el('button', {
        type:'button',
        class:'ihr-view-switch__button',
        'data-view-mode':mode.id,
        'aria-label':mode.title,
        'aria-pressed':state.viewMode === mode.id ? 'true' : 'false',
        title:mode.title,
        onClick:() => setViewMode(mode.id)
      }, [svgIcon(mode.icon, { className:'ihr-view-switch__icon' }), el('span', { text:mode.label })]));
    }
    return controls;
  }

  function render() {
    if (state.destroyed) return;
    root.dataset.viewMode = state.viewMode;
    root.dataset.shelfType = state.shelfType;
    if (state.returnMotion || state.busy || state.session || state.dragSession) { state.renderQueued = true; return; }
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
      return;
    }
    if (state.books.length === 0 && opts.sections) {
      state.shelfScene?.dispose();
      state.shelfScene = null;
      scroller.textContent = '';
      scroller.append(buildEmptyState());
      return;
    }
    if (width <= 0) return; // aún sin layout: el ResizeObserver volverá a llamar
    const retainedScene = state.shelfScene;
    const previousChildren = retainedScene ? [...scroller.children] : [];
    if (!retainedScene) scroller.textContent = '';

    const plantSlotWidth = variant => plantShelfObject({ key:'plant', variant }).width;
    const plantVariants = DEFAULT_LAYOUT.plantVariants;
    const plan = planBookshelf(state.books, {
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
    });
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
        el('p', { 'aria-live': 'polite', text: state.books.length ? `${state.books.length} ${state.books.length === 1 ? 'libro' : 'libros'}` : '' }),
        buildViewControls()
      ])
    ]);
    fragment.append(heading);
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
    for (const book of state.books) resolveCoverAppearance(book);
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
    if (state.returnMotion || state.reorderTimer || state.busy || state.session || state.dragSession) { state.renderQueued = true; return; }
    if (state.frame) return;
    state.frame = requestAnimationFrame(() => {
      state.frame = 0;
      render();
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

  function buildCoverFace(book, coverUrl, style) {
    const face = el('div', {
      class: 'ihr-flyout__face ihr-flyout__face--cover',
      style:
        `--ihr-spine-base:${style.color};` +
        `--ihr-spine-shade:${style.shade};` +
        `--ihr-spine-ink:${style.ink}`
    });
    if (coverUrl) {
      face.append(
        el('img', { class: 'ihr-flyout__img', src: coverUrl, alt: '', decoding: 'async' })
      );
    } else {
      // Placeholder: una portada de tela con el tejado grabado, no un icono roto.
      face.append(
        el('div', { class: 'ihr-cover-placeholder' }, [
          roofMark('ihr-roof ihr-cover-placeholder__roof'),
          el('span', { class: 'ihr-cover-placeholder__title', text: book.title ?? '' }),
          normalizeBookAuthor(book.author)
            ? el('span', { class: 'ihr-cover-placeholder__author', text: normalizeBookAuthor(book.author) })
            : null,
          el('span', {
            class: 'ihr-cover-placeholder__format',
            text: book.format ?? opts.texts.noCover
          })
        ])
      );
    }
    face.append(el('span', { class: 'ihr-flyout__gloss', 'aria-hidden': 'true' }));
    return face;
  }

  async function openBook(spineEl, item) {
    if (state.busy || state.session || state.returnMotion || state.destroyed) return;
    state.busy = true;
    // True once the lifted book sits still (the pull-out has finished), false if
    // the selection ends without that. The page being prepared for this book waits for it.
    let settle;
    const settled = new Promise(resolve => { settle = resolve; });
    const finishPendingSelection = () => {
      document.removeEventListener('keydown', onPendingKeydown, true);
      if (state.pendingSelection === pendingSelection) state.pendingSelection = null;
    };
    const pendingSelection = { cancelled:false, cancel() {
      if (state.pendingSelection !== pendingSelection) return;
      pendingSelection.cancelled = true;
      settle(false);
      options.onBookDismiss?.(item.book);
      finishPendingSelection();
      state.busy = false;
      applyDeferredShelfUpdates();
    } };
    const onPendingKeydown = event => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      pendingSelection.cancel();
    };
    state.pendingSelection = pendingSelection;
    document.addEventListener('keydown', onPendingKeydown, true);

    const { book } = item;
    let style = item.style;
    const initialStyle = item.style;
    resetTimeline(); markTiming('select');
    options.onPrepareBook?.(book, { settled });
    /*
      Se mide sin transform: de un libro inclinado, getBoundingClientRect
      devuelve la caja del rectángulo girado (más ancha y más alta que el
      lomo), y con eso el traspaso saldría descuadrado. El precio es un
      reflow forzado, una vez por toque y con el dedo ya parado.
      Efecto secundario buscado: al salir de la balda el libro se endereza,
      que es lo que hace un libro de verdad cuando tiras de él.
    */
    const previousTransition = spineEl.style.transition;
    spineEl.style.transition = 'none'; // si no, la transición del lomo
    spineEl.style.transform = 'none';  // interpola y se mide el valor viejo
    const rect = spineEl.getBoundingClientRect();
    let sourcePose = state.shelfScene?.getBookPose(spineEl);
    spineEl.style.transform = '';
    void spineEl.offsetWidth;          // devuelve la inclinación sin animarla
    spineEl.style.transition = previousTransition;

    const coverUrl = await resolveCover(book);
    if (pendingSelection.cancelled || state.destroyed) { finishPendingSelection(); return; }
    const imageRatio = await readCoverAspectRatio(coverUrl);
    if (pendingSelection.cancelled || state.destroyed) { finishPendingSelection(); return; }
    if (imageRatio) item.style = { ...item.style, coverRatio: imageRatio };
    const appearance = await quickCoverAppearance(book, coverUrl);
    if (pendingSelection.cancelled || state.destroyed) { finishPendingSelection(); return; }
    if (appearance) applyCoverAppearance(item, appearance);
    if (item.style !== initialStyle && spineEl.isConnected) {
      if (state.shelfScene) state.shelfScene.updateEntry(spineEl, book, item.style, coverUrl);
      else {
      const hadFocus = document.activeElement === spineEl;
      const replacement = buildSpine(item);
      spineEl.replaceWith(replacement);
      spineEl = replacement;
      if (hadFocus) replacement.focus({ preventScroll: true });
      }
    }
    style = item.style;
    if (state.destroyed) return;
    if (state.shelfScene) {
      state.shelfScene.flush();
      sourcePose = state.shelfScene.getBookPose(spineEl);
    }

    const vw = window.innerWidth || 390;
    const vh = window.innerHeight || 780;
    const landscape = vh <= 560 && vw >= 560;
    const ratio = coverRatioFor(style);
    // Match the model's physical front board to the image ratio before sizing
    // its reveal. This keeps the same silhouette on the shelf and in flight.
    const shelfAspect = sourcePose ? sourcePose.thickness / sourcePose.height : (rect.width || 32) / (rect.height || 150);
    const coverH = Math.min(vh * (landscape ? .72 : .54), landscape ? 350 : Math.max(110, vh - 330), 440,
      (vw * (landscape ? .35 : .78)) / ratio,
      (vw * 0.86) / (ratio + shelfAspect * 0.55));
    const coverW = coverH * ratio;
    let startScale = sourcePose ? sourcePose.scale * sourcePose.height / coverH : rect.height > 0 ? rect.height / coverH : 0.3;
    const thickness = sourcePose ? sourcePose.thickness * coverH / sourcePose.height : Math.max(6, (rect.width || 32) / startScale);
    const centerX = vw * (landscape ? .26 : .5) + thickness * 0.38 / 2;
    const centerY = vh * (landscape ? .5 : .42);
    let dx = (sourcePose?.centerX ?? rect.left + rect.width / 2) - centerX;
    let dy = (sourcePose?.centerY ?? rect.top + rect.height / 2) - centerY;
    let sourceAngle = sourcePose?.angle ?? 90;
    let sourcePitch = sourcePose?.pitch ?? 0;
    let sourceRoll = sourcePose?.roll ?? 0;

    const scrim = el('div', { class: 'ihr-flyout__scrim' });
    const bookNode = el('div', {
      class: 'ihr-flyout__book',
      style:
        `width:${coverW}px;height:${coverH}px;` +
        `left:${centerX - coverW / 2}px;top:${centerY - coverH / 2}px;` +
        `--ihr-thickness:${thickness}px;` +
        spineStyleVars(style)
    });

    const view = bookView(bookNode, book, style, {
      width: coverW, height: coverH, thickness,
      viewportWidth: vw, viewportHeight: vh, centerX, centerY, coverUrl,
      initialPose:{ x:dx, y:dy, scale:startScale, angle:sourceAngle, pitch:sourcePitch, roll:sourceRoll }
    });
    if (view) {
      // Keep an inspectable cue on the lifted canvas too; the ribbon itself
      // is geometry inside the model, so no DOM ribbon needs to be re-created.
      view.canvas.dataset.bookmark3d = String(Boolean(bookmarkFor(book)));
      view.draw({ x: dx, y: dy, scale: startScale, angle: sourceAngle, pitch: sourcePitch, roll:sourceRoll });
      bookNode.classList.add('ihr-flyout__book--webgl');
      bookNode.style.position = 'absolute';
      bookNode.style.inset = '0';
      bookNode.style.width = '100%';
      bookNode.style.height = '100%';
    } else {
      bookNode.classList.add('ihr-flyout__book--fallback');
      const pages = el('div', { class:'ihr-flyout__fallback-pages', 'aria-hidden':'true' });
      const inside = el('div', { class:'ihr-flyout__face ihr-flyout__face--inside', 'aria-hidden':'true' });
      const leaf = el('div', { class:'ihr-flyout__fallback-leaf' }, [buildCoverFace(book, coverUrl, style), inside]);
      bookNode.append(pages, leaf);
    }
    const animateBook = (frames, timing) => view
      ? view.animate(frames, timing)
      : animate(bookNode, [{ opacity: 1 }], timing);
    const meta = el('div', { class: 'ihr-flyout__meta' }, [
      el('p', { class: 'ihr-flyout__details', text: [book.format, book.progressFraction > 0 ? `${Math.round(book.progressFraction * 100)} % leído` : 'Por empezar'].filter(Boolean).join(' · ') }),
      el('p', { class: 'ihr-flyout__title', text: book.title ?? '' }),
      normalizeBookAuthor(book.author) ? el('p', { class: 'ihr-flyout__author', text: normalizeBookAuthor(book.author) }) : null
    ]);
    const readiness = el('p', { class: 'ihr-flyout__readiness', text: options.getBookPreparation ? 'Preparando…' : 'Toca la portada para leer', 'aria-live': 'polite' });
    meta.append(readiness);
    const coverTarget = el('button', {
      type: 'button', class: 'ihr-flyout__cover-target',
      'aria-label': opts.texts.tapCover(book), hidden: true,
      style: `left:${centerX - coverW / 2}px;top:${centerY - coverH / 2}px;width:${coverW}px;height:${coverH}px`
    });
    const colorPickLayer = el('div', { class:'ihr-color-pick', hidden:true, 'aria-label':'Elegir un color de la portada' });
    const colorPickMessage = el('p', { class:'ihr-color-pick__message', text:'Arrastra sobre la portada' });
    const colorPickCancel = el('button', { type:'button', class:'ihr-color-pick__cancel', text:'Cancelar', onClick:() => finishColorPick(false) });
    const colorPickHandle = el('button', {
      type:'button', class:'ihr-color-pick__handle', 'aria-label':'Muestra de color: arrastra sobre la portada',
      style:`--ihr-picked-color:${style.color}`
    }, [el('span', { class:'ihr-color-pick__handle-color', 'aria-hidden':'true' }), el('span', { class:'ihr-color-pick__handle-cross', 'aria-hidden':'true', text:'+' })]);
    colorPickLayer.append(colorPickMessage, colorPickCancel, colorPickHandle);

    const flyout = el('div', {
      class: 'ihr-flyout',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-label': book.title ?? opts.texts.openAction,
      tabindex: '-1'
    });
    flyout.classList.add(view ? 'has-webgl' : 'no-webgl');
    const closeButton = el('button', { type:'button', class:'ihr-btn ihr-flyout__close', 'aria-label':opts.texts.closeAction, title:opts.texts.closeAction, onClick:() => close() }, [svgIcon(ICONS.close, { className:'ihr-icon' })]);
    const shadow = el('div', { class:'ihr-flyout__shadow', 'aria-hidden':'true', style:`--ihr-cover-bottom:${centerY + coverH / 2}px;left:${vw * (landscape ? .26 : .5)}px` });
    flyout.append(scrim, shadow, el('div', { class: 'ihr-flyout__stage' }, [bookNode]), meta, coverTarget, colorPickLayer, closeButton);

    let previousFocus = document.activeElement;
    const session = { book, item, cancelled: false, phase: 'revealing', view, bookNode };

    function finishClose({ silent = false, instant = false } = {}) {
      spineEl.classList.remove('is-away');
      state.shelfScene?.flush();
      view?.dispose();
      flyout.remove();
      if (state.session === session) { state.session = null; state.busy = false; }
      spineEl.classList.remove('is-away');
      if (!silent && !instant && typeof previousFocus?.focus === 'function') {
        previousFocus.focus({ preventScroll:true });
      }
      maybeRefreshAppearanceStyles();
      applyDeferredShelfUpdates();
    }
    async function close({ silent = false, instant = false } = {}) {
      if (state.session !== session) return;
      if (session.cancelled) {
        if (instant) {
          session.returnAnimation?.cancel();
          session.insertion?.cancel();
          finishClose({ silent, instant });
        }
        return;
      }
      clearInterval(readyCheck);
      session.cancelled = true;
      settle(false);
      options.onBookDismiss?.(book);
      session.onCancel?.();
      document.removeEventListener('keydown', onKeydown, true);
      // A slow image may still be loading before the flyout's first frame.
      // Cancel that selection without running an entrance/return not yet set up.
      if (!flyout.isConnected) instant = true;
      else fadeMeta();
      flyout.classList.remove('is-ready');
      // A cancelled or failed opening may stop mid-fade: the book flies back on white paper, not in a half-mixed page.
      if (view && session.phase === 'reading') view.setPageTheme(0);
      if (!instant) await playReturn();
      if (state.session === session) finishClose({ silent, instant });
    }
    session.close = close;

    function onKeydown(event) {
      if (event.key === 'Tab') {
        const buttons = [...flyout.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled])')]
          .filter(control => !control.closest('[hidden]'));
        const first = buttons[0], last = buttons.at(-1);
        const container = document.activeElement === flyout || document.activeElement === editorPanel;
        if (event.shiftKey && (document.activeElement === first || container)) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && (document.activeElement === last || document.activeElement === flyout)) { event.preventDefault(); first?.focus(); }
      }
      if (event.key === 'Escape') {
        event.stopPropagation();
        // Also dismisses the "no se pudo leer esta portada" notice.
        if (session.colorPicking || !colorPickLayer.hidden) finishColorPick(false);
        else if (!editorPanel.hidden) closeEditor();
        else if (session.phase !== 'reading') close();
      }
    }

    scrim.addEventListener('click', () => {
      if (session.phase !== 'reading') close();
    });
    document.addEventListener('keydown', onKeydown, true);
    state.session = session;
    finishPendingSelection();

    const isDownloaded = book.sourceType === 'drive' && Boolean(book.content);
    const alreadySaved = book.sourceType === 'drive' ? isDownloaded : Boolean(book.driveFileId);
    const actionLabel = book.sourceType === 'drive' ? (isDownloaded ? 'Descargado' : 'Descargar') : (book.driveFileId ? 'En Drive' : 'Guardar en Drive');
    const actionTitle = book.sourceType === 'drive' ? (isDownloaded ? 'Disponible sin conexión' : 'Descargar para usar sin conexión') : actionLabel;
    // En móvil estrecho la etiqueta larga partía el botón en dos líneas.
    const actionShort = book.sourceType === 'drive' ? (isDownloaded ? 'Offline' : 'Descargar') : (book.driveFileId ? 'En Drive' : 'Drive');
    const actionButtons = [
      el('button', { type: 'button', class: 'ihr-btn ihr-btn--primary', disabled:true, onClick: () => expandCover() }, [svgIcon(ICONS.read, { className:'ihr-icon' }), el('span', { text: opts.texts.openAction })]),
      el('button', { type: 'button', class: 'ihr-btn ihr-btn--quiet', title:actionTitle, 'aria-label':actionTitle, disabled:!options.onBookAction || alreadySaved, onClick: event => options.onBookAction?.(book.sourceType === 'drive' ? 'offline' : 'drive', book, event.currentTarget) }, [svgIcon(alreadySaved ? ICONS.check : book.sourceType === 'drive' ? ICONS.download : ICONS.drive, { className:'ihr-icon' }), el('span', { class:'ihr-btn__label', text:actionLabel }), el('span', { class:'ihr-btn__label ihr-btn__label--short', 'aria-hidden':'true', text:actionShort })]),
      el('button', { type: 'button', class: 'ihr-btn ihr-btn--quiet ihr-flyout__edit-button', disabled:true, 'aria-expanded': 'false', onClick: () => editorPanel.hidden ? openEditor() : closeEditor() }, [svgIcon(ICONS.brush, { className:'ihr-icon' }), el('span', { text:'Editar' })])
    ];

    const appearanceId = String(book.id ?? book.path ?? book.title ?? 'book');
    const getCachedAppearance = () => {
      const cached = state.coverAppearances.get(appearanceId);
      return cached?.key === item.coverKey ? cached.appearance : null;
    };
    const cachedAppearance = getCachedAppearance();
    const coverColor = cachedAppearance?.color
      ? cachedAppearance.color
      : item.baseStyle.color;
    const suggestedColors = bookColorOptions(coverColor);
    let selectedColor = book.spineColorOverride || style.color;
    const colorButtons = [];
    const customizationFields = {};
    let customizationSaveTimer = 0;
    let spinePreviewFrame = 0;
    let appearanceDirty = false;
    const editorPanel = el('section', {
      class: 'ihr-spine-editor', hidden: true, role: 'region', 'aria-label': 'Editar el lomo', tabindex: '-1',
      style: `--ihr-ed-cover:${coverColor}`
    });
    // The subtitle repeats the spine text in its chosen face: a legible
    // specimen of the font, since the 3D spine renders it quite small.
    const editorSubtitle = el('p', { class: 'ihr-spine-editor__subtitle', 'aria-hidden': 'true' });
    const editorPreviewTitle = el('span', {
      class: 'ihr-spine-editor__preview-title',
      text: book.spineTitleOverride || book.title || 'Sin título'
    });
    book.author = normalizeBookAuthor(book.author)
    const editorPreviewAuthor = el('span', {
      class: 'ihr-spine-editor__preview-author', text: book.author
    });
    const editorPreview = el('div', {
      class: 'ihr-spine-editor__preview',
      role: 'img', 'aria-label': 'Vista previa del lomo',
      style: spineStyleVars(style)
    }, [
      el('span', { class: 'ihr-spine-editor__preview-pages', 'aria-hidden': 'true' }),
      el('div', { class: 'ihr-spine-editor__preview-binding' }, [
        el('span', { class: 'ihr-spine-editor__preview-ornament', 'aria-hidden': 'true' }),
        editorPreviewTitle,
        editorPreviewAuthor
      ])
    ]);
    function refreshEditorPreview() {
      updateBookStyleVars(editorPreview, item.style);
      updateBookStyleVars(editorPanel, item.style);
      editorPreviewTitle.textContent = book.spineTitleOverride || book.title || 'Sin título';
      editorSubtitle.textContent = editorPreviewTitle.textContent;
      book.author = normalizeBookAuthor(book.author)
      editorPreviewAuthor.textContent = book.author;
      editorPreviewAuthor.hidden = !book.author;
    }
    const editorPose = {
      // centerX already includes the binding's depth compensation so a book
      // viewed from the cover sits correctly in flight. Cancel that offset
      // here, where the side-on spine itself is the visual center.
      x: -thickness * .19,
      // Positive pose.y moves the model down in camera space. Place the spine
      // in the clear area above the mobile edit sheet instead of behind it.
      y: landscape ? 0 : -vh * .15,
      scale: landscape ? .7 : .58,
      angle: 90,
      pitch: 0
    };
    // Wide screens float the tray under the spine: grow the preview into the
    // clear band above it so the cloth and foil read while editing.
    function fitEditorPose() {
      if (landscape || vw < 760) return;
      const top = 28, bottom = editorPanel.getBoundingClientRect().top - 22;
      // The bookmark ribbon rises about 8 % above the head of the spine.
      const scale = Math.min(.92, Math.max(.58, (bottom - top) / (coverH * 1.08)));
      if (!Number.isFinite(scale)) return;
      editorPose.scale = scale;
      editorPose.y = bottom - coverH * scale / 2 - centerY;
    }
    // ---- Editor de la portada: pestañas, giro del libro y relieve ----------
    // El editor tiene dos pestañas. 'Lomo' es el editor de siempre (libro de
    // canto). 'Portada' gira el libro hasta mostrar la portada de frente sobre
    // la hoja y aloja las funciones de la portada; por ahora, 'Relieve'.
    const editorUid = `ihr-ed-${++editorSerial}`;
    let editorTab = 'spine';
    const coverPose = { x: 0, y: 0, scale: 1, angle: 0, pitch: 0 };
    const poseForTab = tab => tab === 'cover' ? coverPose : editorPose;
    const relief = { status: 'idle', proposals: [], controller: null, tiltTimer: 0, tiltToken: 0, tiltCleanup: null, sliderFrame: 0 };
    function fitCoverPose() {
      // La hoja de la pestaña activa ya está maquetada: su borde superior
      // marca el límite de la franja libre. Sin medida usable, un respaldo.
      const sheetTop = editorPanel.hidden ? NaN : editorPanel.getBoundingClientRect().top;
      Object.assign(coverPose, coverEditorPose({
        viewportWidth: vw, viewportHeight: vh, landscape, coverW, coverH, centerY, thickness, sheetTop
      }));
    }
    // Al llegar las tarjetas la hoja puede cambiar de alto unos píxeles: la
    // portada se reacomoda con suavidad, salvo que ya se esté balanceando.
    function refitCoverPose() {
      if (!view || editorTab !== 'cover' || editorPanel.hidden || session.phase !== 'ready' || relief.tiltCleanup) return;
      const before = { ...coverPose };
      fitCoverPose();
      if (Math.abs(before.y - coverPose.y) < 6 && Math.abs(before.scale - coverPose.scale) < .02) { Object.assign(coverPose, before); return; }
      view.animate([{ transform: before }, { transform: coverPose }], { duration: prefersReducedMotion() ? 1 : 220 });
    }
    function reliefKey() {
      return `${item.coverKey ?? coverUrl ?? ''}|${book.title ?? ''}|${normalizeBookAuthor(book.author)}`;
    }
    // Deja de lado todo lo que dependa de la pestaña: balanceo, temporizadores
    // y análisis en curso (cierre del editor o cambio de pestaña).
    function cancelCoverTilt() {
      clearTimeout(relief.tiltTimer);
      relief.tiltTimer = 0;
      relief.tiltToken++;
      relief.tiltCleanup?.();
      relief.tiltCleanup = null;
    }
    function stopCoverEditorWork() {
      cancelCoverTilt();
      if (relief.sliderFrame) cancelAnimationFrame(relief.sliderFrame);
      relief.sliderFrame = 0;
      if (relief.status === 'loading') {
        relief.controller?.abort();
        relief.controller = null;
        relief.status = 'idle';
        renderReliefCards();
      }
    }
    function startCoverTilt() {
      relief.tiltTimer = 0;
      if (!view || editorTab !== 'cover' || editorPanel.hidden || session.phase !== 'ready') return;
      const token = ++relief.tiltToken;
      const { frames, duration } = coverTiltFrames(coverPose);
      const motion = view.animate(frames, { duration });
      // Cualquier gesto del usuario corta el balanceo y devuelve la portada
      // a su sitio; no se compite con la mano.
      const interrupt = () => {
        if (token !== relief.tiltToken) return;
        cancelCoverTilt();
        view.animate([
          { transform: view.getPose?.() ?? coverPose },
          { transform: coverPose }
        ], { duration: 240 });
      };
      const events = ['pointerdown', 'keydown', 'wheel', 'touchstart'];
      for (const type of events) document.addEventListener(type, interrupt, { capture: true, passive: true });
      relief.tiltCleanup = () => { for (const type of events) document.removeEventListener(type, interrupt, { capture: true }); };
      motion.finished.then(() => { if (token === relief.tiltToken) cancelCoverTilt(); });
    }
    // Tras elegir un relieve el libro se balancea unas veces para que la luz
    // recorra la superficie. Con movimiento reducido no se balancea: el relieve
    // se aprecia igual con el sombreado en reposo y un vaivén del libro es
    // justo el tipo de movimiento que ese ajuste pide evitar.
    function scheduleCoverTilt() {
      cancelCoverTilt();
      if (!view || prefersReducedMotion() || editorTab !== 'cover') return;
      const token = relief.tiltToken;
      Promise.resolve(relief.applied ?? true).then(done => {
        if (done === false || token !== relief.tiltToken || editorTab !== 'cover' || editorPanel.hidden || state.session !== session) return;
        relief.tiltTimer = setTimeout(startCoverTilt, 140);
      });
    }
    function syncEditorTab(tab) {
      editorTab = editorTabId(tab);
      const cover = editorTab === 'cover';
      for (const [id, button] of editorTabButtons) {
        button.setAttribute('aria-selected', String(id === editorTab));
        button.tabIndex = id === editorTab ? 0 : -1;
      }
      spinePanel.hidden = cover;
      coverPanel.hidden = !cover;
      const label = EDITOR_TABS.find(candidate => candidate.id === editorTab).heading;
      editorHeading.textContent = label;
      editorPanel.setAttribute('aria-label', label);
      editorPanel.dataset.tab = editorTab;
      flyout.classList.toggle('is-editing-cover', cover);
    }
    function selectEditorTab(next, { focusTab = false } = {}) {
      next = editorTabId(next);
      const previous = editorTab;
      if (focusTab) editorTabButtons.get(next)?.focus({ preventScroll: true });
      if (next === previous) return;
      cancelCoverTilt();
      syncEditorTab(next);
      editorPanel.scrollTop = 0;
      let turned = null;
      if (!editorPanel.hidden && session.phase === 'ready') {
        if (next === 'cover') fitCoverPose(); else fitEditorPose();
        if (view) turned = view.animate([
          { transform: poseForTab(previous) },
          { transform: poseForTab(next) }
        ], { duration: prefersReducedMotion() ? 1 : 300 });
      }
      // El análisis espera a que el giro termine: no compite con su animación.
      if (next === 'cover') (turned?.finished ?? Promise.resolve()).then(() => {
        if (editorTab === 'cover' && !editorPanel.hidden && state.session === session) loadReliefProposals();
      });
    }
    function saveCustomizationNow() {
      if (customizationSaveTimer) clearTimeout(customizationSaveTimer);
      customizationSaveTimer = 0;
      if (Object.keys(customizationFields).length) {
        const changedFields = { ...customizationFields };
        for (const key of Object.keys(customizationFields)) delete customizationFields[key];
        Promise.resolve(options.onBookCustomizationChange?.(book, changedFields)).catch(error => {
          console.warn('No se pudo guardar el aspecto del lomo:', error);
        });
      }
    }
    function queueCustomizationSave() {
      if (customizationSaveTimer) clearTimeout(customizationSaveTimer);
      customizationSaveTimer = setTimeout(saveCustomizationNow, 180);
    }
    function replaceShelfSpine() {
      const existingSpine = shelfSpineNodes().find(node => node.dataset.bookId === String(book.id));
      if (!existingSpine) return;
      if (state.shelfScene) {
        state.shelfScene.updateEntry(existingSpine, book, item.style, coverUrl);
        return;
      }
      const hadFocus = document.activeElement === existingSpine;
      const wasAway = existingSpine.classList.contains('is-away');
      const replacement = buildSpine(item);
      if (wasAway) replacement.classList.add('is-away');
      existingSpine.replaceWith(replacement);
      spineEl = replacement;
      if (previousFocus === existingSpine) previousFocus = replacement;
      if (hadFocus) replacement.focus({ preventScroll: true });
      if (state.lastOpened?.book?.id === book.id) state.lastOpened.spineEl = replacement;
    }
    function updateCustomization(fields) {
      Object.assign(book, fields);
      Object.assign(customizationFields, fields);
      // El relieve sólo toca la portada y ya lo aplica view.setCoverRelief:
      // ni rehace el modelo al cerrar ni repinta el lomo de la estantería.
      if (Object.keys(fields).every(key => key === 'coverRelief')) { queueCustomizationSave(); return; }
      appearanceDirty = true;
      applyCoverAppearance(item, getCachedAppearance());
      style = item.style;
      refreshEditorPreview();
      updateBookStyleVars(bookNode, item.style);
      const shelfNode = shelfSpineNodes().find(node => node.dataset.bookId === String(book.id));
      updateBookStyleVars(shelfNode, item.style);
      view?.updateCoverAppearance(book);
      view?.updateEdgeAppearance(book);
      if (state.lastOpened?.book?.id === book.id) state.lastOpened.style = item.style;
      state.appearanceRefreshPending = true;
      updateColorSelection();
      if (spinePreviewFrame) clearTimeout(spinePreviewFrame);
      spinePreviewFrame = setTimeout(() => {
        spinePreviewFrame = 0;
        if (!editorPanel.hidden && session.phase === 'ready') {
          view?.updateSpineAppearance(book, item.style);
        }
      }, 90);
      queueCustomizationSave();
    }
    function openEditor() {
      if (session.phase !== 'ready') return;
      const viewport = visibleViewport();
      session.editorViewportWidth = viewport.width;
      session.editorViewportHeight = viewport.height;
      session.keyboardOpen = false;
      // Siempre se abre en el lomo; la portada se elige con su pestaña.
      syncEditorTab('spine');
      editorPanel.hidden = false;
      flyout.classList.add('is-editing-spine');
      meta.classList.add('is-editing');
      coverTarget.hidden = true;
      actionButtons[2].setAttribute('aria-expanded', 'true');
      refreshEditorPreview();
      fitEditorPose();
      if (view) view.animate([
        { transform: { x: 0, y: 0, scale: 1, angle: 0, pitch: 0 } },
        { transform: editorPose }
      ], { duration: prefersReducedMotion() ? 1 : 230 });
      // Focus the sheet itself: keyboard users start at its top without a
      // focus ring landing on an arbitrary control.
      editorPanel.scrollTop = 0;
      editorPanel.focus({ preventScroll: true });
    }
    function closeEditor({ commit = true, restoreFocus = true } = {}) {
      if (editorPanel.hidden) return;
      const leavingPose = poseForTab(editorTab);
      stopCoverEditorWork();
      syncEditorTab('spine');
      editorPanel.hidden = true;
      flyout.classList.remove('is-editing-spine');
      meta.classList.remove('is-editing');
      coverTarget.hidden = !opts.autoOpen;
      actionButtons[2].setAttribute('aria-expanded', 'false');
      if (spinePreviewFrame) clearTimeout(spinePreviewFrame);
      spinePreviewFrame = 0;
      const changed = appearanceDirty;
      if (changed && session.phase === 'ready') {
        if (commit) view?.updateAppearance(item.style);
        updateBookStyleVars(bookNode, item.style);
        replaceShelfSpine();
        appearanceDirty = false;
      }
      if (commit && session.phase === 'ready' && view) {
        coverTarget.disabled = true;
        const returnToCover = view.animate([
          { transform: leavingPose },
          { transform: { x: 0, y: 0, scale: 1, angle: 0, pitch: 0 } }
        ], {
          duration: prefersReducedMotion() ? 1 : 220
        });
        returnToCover.finished.then(() => {
          if (state.session === session && session.phase === 'ready' && !editorPanel.hidden) return;
          if (state.session === session && session.phase === 'ready') coverTarget.disabled = false;
        });
      }
      saveCustomizationNow();
      if (restoreFocus && session.phase === 'ready') actionButtons[2].focus({ preventScroll: true });
    }
    let coverSampleCanvas = null;
    let sampledCoverColor = '';
    let colorHandleDragging = false;
    async function prepareCoverSampler() {
      if (coverSampleCanvas) return coverSampleCanvas;
      if (!coverUrl) throw new Error('Este libro no tiene portada para muestrear.');
      const image = new Image();
      image.decoding = 'async';
      image.src = coverUrl;
      if (image.decode) await image.decode();
      else await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject; });
      const scale = Math.min(1, 1200 / Math.max(image.naturalWidth, image.naturalHeight));
      const width = Math.max(1, Math.round(image.naturalWidth * scale));
      const height = Math.max(1, Math.round(image.naturalHeight * scale));
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      const context = canvas.getContext('2d', { willReadFrequently:true });
      context.fillStyle = style.color; context.fillRect(0, 0, width, height);
      const fit = fitCoverImage(image.naturalWidth, image.naturalHeight, width, height);
      context.drawImage(image, fit.x * scale, fit.y * scale, fit.width * scale, fit.height * scale);
      // Force a read now so tainted/cross-origin covers fail before the user starts dragging.
      context.getImageData(0, 0, 1, 1);
      coverSampleCanvas = canvas;
      return canvas;
    }
    function sampleCoverAt(clientX, clientY) {
      const rect = { left:centerX-coverW/2, top:centerY-coverH/2, right:centerX+coverW/2, bottom:centerY+coverH/2 };
      if (!coverSampleCanvas || clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) {
        sampledCoverColor = '';
        colorPickMessage.textContent = 'Arrastra sobre la portada';
        colorPickHandle.style.removeProperty('--ihr-picked-color');
        colorPickHandle.removeAttribute('data-color');
        return false;
      }
      const x = Math.min(coverSampleCanvas.width - 1, Math.floor((clientX - rect.left) / coverW * coverSampleCanvas.width));
      const y = Math.min(coverSampleCanvas.height - 1, Math.floor((clientY - rect.top) / coverH * coverSampleCanvas.height));
      const [r, g, b] = coverSampleCanvas.getContext('2d', { willReadFrequently:true }).getImageData(x, y, 1, 1).data;
      sampledCoverColor = `#${[r,g,b].map(value => value.toString(16).padStart(2,'0')).join('')}`;
      colorPickHandle.style.setProperty('--ihr-picked-color', sampledCoverColor);
      colorPickHandle.dataset.color = sampledCoverColor;
      colorPickMessage.textContent = `${sampledCoverColor.toUpperCase()} · Suelta`;
      return true;
    }
    async function beginColorPick() {
      if (session.phase !== 'ready' || session.colorPicking) return;
      const button = colorControls.querySelector('.ihr-spine-editor__pipette');
      button.disabled = true;
      try {
        await prepareCoverSampler();
      } catch (error) {
        console.warn('No se pudo leer la portada para elegir un color:', error);
        colorPickMessage.textContent = 'No se pudo leer esta portada';
        colorPickLayer.hidden = false;
        flyout.classList.add('is-picking-color');
        colorPickCancel.textContent = 'Cerrar';
        button.disabled = false;
        return;
      }
      button.disabled = false;
      session.colorPicking = true;
      session.pickingButton = button;
      editorPanel.hidden = true;
      flyout.classList.remove('is-editing-spine');
      meta.classList.remove('is-editing');
      actionButtons[2].setAttribute('aria-expanded', 'false');
      colorPickLayer.hidden = false;
      colorPickCancel.textContent = 'Cancelar';
      colorPickMessage.textContent = 'Arrastra sobre la portada';
      colorPickHandle.style.setProperty('--ihr-picked-color', selectedColor);
      colorPickHandle.style.left = `${centerX}px`;
      colorPickHandle.style.top = `${Math.min(vh - 76, centerY + coverH / 2 + 44)}px`;
      flyout.classList.add('is-picking-color');
      const motion = view
        ? view.animate([
          { transform:editorPose },
          { transform:{ x:0, y:0, scale:1, angle:0, pitch:0 } }
        ], { duration:prefersReducedMotion() ? 1 : 360 })
        : animate(bookNode, [{ transform:'scale(.92)' }, { transform:'scale(1)' }], { duration:prefersReducedMotion() ? 1 : 260, easing:EASE });
      await motion.finished;
      colorPickHandle.focus({ preventScroll:true });
    }
    async function finishColorPick(apply) {
      if (!session.colorPicking && colorPickLayer.hidden) return;
      const wasPicking = session.colorPicking;
      session.colorPicking = false;
      colorHandleDragging = false;
      colorPickLayer.hidden = true;
      colorPickHandle.classList.remove('is-dragging');
      flyout.classList.remove('is-picking-color');
      if (apply && sampledCoverColor) selectSpineColor(sampledCoverColor);
      sampledCoverColor = '';
      if (session.phase === 'ready' && !editorPanel.hidden) return;
      editorPanel.hidden = false;
      flyout.classList.add('is-editing-spine');
      meta.classList.add('is-editing');
      actionButtons[2].setAttribute('aria-expanded', 'true');
      refreshEditorPreview();
      fitEditorPose();
      if (wasPicking && session.phase === 'ready') {
        const motion = view
          ? view.animate([
            { transform:{ x:0, y:0, scale:1, angle:0, pitch:0 } },
            { transform:editorPose }
          ], { duration:prefersReducedMotion() ? 1 : 320 })
          : animate(bookNode, [{ transform:'scale(1)' }, { transform:'scale(.92)' }], { duration:prefersReducedMotion() ? 1 : 260, easing:EASE });
        await motion.finished;
      }
      if (session.pickingButton?.isConnected) session.pickingButton.focus({ preventScroll:true });
      session.pickingButton = null;
    }
    colorPickHandle.addEventListener('pointerdown', event => {
      if (!session.colorPicking) return;
      event.preventDefault();
      colorHandleDragging = true;
      colorPickHandle.classList.add('is-dragging');
      colorPickHandle.setPointerCapture?.(event.pointerId);
    });
    colorPickHandle.addEventListener('pointermove', event => {
      if (!colorHandleDragging || !session.colorPicking) return;
      const bounds = flyout.getBoundingClientRect();
      const x = event.clientX - bounds.left, y = event.clientY - bounds.top;
      colorPickHandle.style.left = `${x}px`; colorPickHandle.style.top = `${y}px`;
      sampleCoverAt(x, y);
    });
    colorPickHandle.addEventListener('pointerup', event => {
      if (!colorHandleDragging) return;
      colorHandleDragging = false;
      colorPickHandle.classList.remove('is-dragging');
      const bounds = flyout.getBoundingClientRect();
      const x = event.clientX - bounds.left, y = event.clientY - bounds.top;
      colorPickHandle.style.left = `${x}px`; colorPickHandle.style.top = `${y}px`;
      sampleCoverAt(x, y);
      if (sampledCoverColor) finishColorPick(true);
      else colorPickMessage.textContent = 'Suelta sobre la portada';
    });
    colorPickHandle.addEventListener('pointercancel', () => {
      colorHandleDragging = false;
      colorPickHandle.classList.remove('is-dragging');
    });
    const pickerInput = el('input', {
      type: 'color', value: spineColorStyle(selectedColor).color,
      'aria-label': 'Elegir otro color para el lomo',
      onChange: event => selectSpineColor(event.currentTarget.value)
    });
    const pipetteButton = el('button', {
      type:'button', class:'ihr-spine-editor__pipette', 'aria-label':'Elegir color de la portada',
      title:'Tomar un color de la portada', onClick:beginColorPick
    }, [svgIcon(ICONS.pipette, { className:'ihr-icon' })]);
    const colorControls = el('div', { class: 'ihr-flyout__colors', role: 'group', 'aria-label': 'Color del lomo' });
    const fontSelect = el('select', {
      class: 'ihr-spine-editor__select', 'aria-label': 'Fuente del lomo',
      onChange: event => {
        const font = SPINE_FONTS.find(candidate => candidate.family === event.currentTarget.value);
        if (!font) return;
        updateCustomization({ spineFontFamily: font.family });
      }
    });
    // Each face is listed in its own typeface (desktop pickers honour it).
    for (const font of SPINE_FONTS) fontSelect.append(el('option', {
      value: font.family, text: font.label,
      style: `font-family:"${font.family}", ${font.fallback};font-weight:${font.weight}`
    }));
    fontSelect.value = book.spineFontFamily || style.fontFamily || SPINE_FONTS[0].family;
    // The filled part of the track follows the value (CSS reads --ihr-range-fill).
    const syncRange = input => input.style.setProperty('--ihr-range-fill',
      `${(Number(input.value) - Number(input.min)) / (Number(input.max) - Number(input.min)) * 100}%`);
    const fontSizeInput = el('input', {
      type: 'range', min: '8', max: '48', step: '1', class: 'ihr-spine-editor__slider',
      value: String(Math.max(8, Math.min(48, Number(book.spineFontSize) || Number(style.spineFontSize) || 10))),
      'aria-label': 'Tamaño del título del lomo',
      onInput: event => {
        const size = Number(event.currentTarget.value);
        sizeOutput.textContent = `${size} px`;
        syncRange(event.currentTarget);
        updateCustomization({ spineFontSize: size });
      }
    });
    const sizeOutput = el('output', { class: 'ihr-spine-editor__size', text: `${fontSizeInput.value} px` });
    const authorSizeInput = el('input', {
      type: 'range', min: '6', max: '36', step: '1', class: 'ihr-spine-editor__slider',
      value: String(Math.max(6, Math.min(36, Number(book.spineAuthorFontSize) || Number(style.spineAuthorFontSize) || 12))),
      'aria-label': 'Tamaño del autor del lomo',
      onInput: event => {
        const size = Number(event.currentTarget.value);
        authorSizeOutput.textContent = `${size} px`;
        syncRange(event.currentTarget);
        updateCustomization({ spineAuthorFontSize: size });
      }
    });
    const authorSizeOutput = el('output', { class: 'ihr-spine-editor__size', text: `${authorSizeInput.value} px` });
    syncRange(fontSizeInput);
    syncRange(authorSizeInput);
    const titleInput = el('input', {
      type: 'text', maxlength: '120', value: book.spineTitleOverride ?? '',
      placeholder: book.title || 'Título del libro', class: 'ihr-spine-editor__input',
      'aria-label': 'Texto del lomo', enterkeyhint: 'done',
      onInput: event => updateCustomization({ spineTitleOverride: event.currentTarget.value })
    });
    const authorInput = el('input', {
      type: 'text', maxlength: '120', value: normalizeBookAuthor(book.author),
      placeholder: 'Sin autor', 'aria-label': 'Autor del libro', autocomplete: 'name', class: 'ihr-spine-editor__input',
      enterkeyhint: 'done',
      onInput: event => updateCustomization({ author: normalizeBookAuthor(event.currentTarget.value) })
    });
    function visibleViewport() {
      const vv = window.visualViewport;
      return {
        width: window.innerWidth || 0,
        height: Math.min(window.innerHeight || 0, vv?.height || window.innerHeight || 0),
        top: vv?.offsetTop || 0
      };
    }
    function syncFlyoutViewport() {
      if (!session.keyboardOpen) {
        flyout.classList.remove('uses-visual-viewport');
        flyout.style.removeProperty('--ihr-visible-top');
        flyout.style.removeProperty('--ihr-visible-height');
        return;
      }
      const viewport = visibleViewport();
      flyout.style.setProperty('--ihr-visible-top', `${viewport.top}px`);
      flyout.style.setProperty('--ihr-visible-height', `${viewport.height}px`);
      flyout.classList.add('uses-visual-viewport');
    }
    function keepTitleVisible() {
      if (editorPanel.hidden || document.activeElement !== titleInput) return;
      const panelRect = editorPanel.getBoundingClientRect();
      const fieldRect = titleInput.getBoundingClientRect();
      // The sticky header covers the top of the scrollport.
      const top = Math.max(panelRect.top, editorHeader.getBoundingClientRect().bottom);
      const margin = 14;
      if (fieldRect.bottom > panelRect.bottom - margin) {
        editorPanel.scrollTop += fieldRect.bottom - panelRect.bottom + margin;
      } else if (fieldRect.top < top + margin) {
        editorPanel.scrollTop -= top + margin - fieldRect.top;
      }
    }
    session.handleViewportResize = () => {
      if (editorPanel.hidden || !session.editorViewportHeight) return false;
      const viewport = visibleViewport();
      if (Math.abs(viewport.width - session.editorViewportWidth) >= 40) return false;
      const keyboardVisible = viewport.height < session.editorViewportHeight - 100;
      session.keyboardOpen = keyboardVisible;
      syncFlyoutViewport();
      if (keyboardVisible) requestAnimationFrame(() => requestAnimationFrame(keepTitleVisible));
      return true;
    };
    editorPanel.addEventListener('focusin', event => {
      if (event.target === titleInput || event.target === authorInput) requestAnimationFrame(keepTitleVisible);
    });
    function updateColorSelection() {
      const cloth = spineFinish(book.spineFinish) === 'matte';
      // With no saved override the spine follows the cover: that is the first sample.
      const followsCover = !book.spineColorOverride;
      colorButtons.forEach((button, index) => {
        const selected = cloth && (followsCover ? index === 0 : button.dataset.color === selectedColor);
        button.setAttribute('aria-pressed', String(selected));
        button.classList.toggle('is-selected', selected);
      });
      pickerInput.value = spineColorStyle(selectedColor).color;
      bindingFinish.value = spineFinish(book.spineFinish);
      inkFinish.value = spineFinish(book.spineTextFinish);
      coverSurfaceFinish.value = surfaceFinish(book.coverFinish);
      pageEdgeSurfaceFinish.value = surfaceFinish(book.pageEdgeFinish);
      spineSurfaceFinish.value = surfaceFinish(book.spineSurfaceFinish, 'matte');
      inkPicker.value = item.style.ink;
      engravedInput.checked = book.spineEngraved === true;
      const customSelected = cloth && !followsCover && !suggestedColors.includes(selectedColor);
      pickerInput.parentElement?.classList.toggle('is-selected', customSelected);
      // A chosen custom colour fills its chip, so the choice stays visible.
      if (customSelected) pickerInput.parentElement?.style.setProperty('--ihr-swatch-color', selectedColor);
      else pickerInput.parentElement?.style.removeProperty('--ihr-swatch-color');
      pipetteButton.style.setProperty('--ihr-pipette-color', selectedColor);
      const font = SPINE_FONTS.find(candidate => candidate.family === fontSelect.value) || SPINE_FONTS[0];
      fontSelect.style.fontFamily = `"${font.family}", ${font.fallback}`;
      fontSelect.style.fontWeight = String(font.weight);
      // Samples paint the real cloth and ink, even while a foil is chosen.
      editorPanel.style.setProperty('--ihr-ed-cloth', followsCover ? suggestedColors[0] : selectedColor);
      editorPanel.style.setProperty('--ihr-ed-ink', /^#[0-9a-f]{6}$/i.test(book.spineTextColor || '')
        ? book.spineTextColor : spineColorStyle(item.style.color).ink);
      for (const { select, picker, samples } of finishPickers) {
        picker.dataset.value = select.value;
        for (const sample of samples) sample.classList.toggle('is-active', sample.dataset.value === select.value);
      }
    }
    function selectSpineColor(color) {
      selectedColor = spineColorStyle(color).color;
      book.spineColorOverride = selectedColor;
      updateCustomization({ spineColorOverride: selectedColor, spineFinish:'matte' });
    }
    suggestedColors.forEach((color, index) => {
      const names = ['Color de la portada', 'Color complementario 1', 'Color complementario 2'];
      const button = el('button', {
        type: 'button', class: 'ihr-flyout__swatch',
        'aria-label': names[index], 'aria-pressed': false,
        title: names[index], 'data-color': color,
        style: `--ihr-swatch-color:${color}`,
        onClick: () => selectSpineColor(color)
      });
      colorButtons.push(button);
    });
    colorControls.append(
      el('div', { class: 'ihr-flyout__swatches' }, colorButtons),
      el('span', { class: 'ihr-flyout__colors-rule', 'aria-hidden': 'true' }),
      pipetteButton,
      el('label', { class: 'ihr-flyout__custom-color', title: 'Elegir otro color' }, [
        pickerInput,
        el('span', { class: 'ihr-flyout__custom-mark', 'aria-hidden': 'true', text: '+' })
      ])
    );
    // The font select stays a plain native select; its wrapper draws the chevron.
    const selectWrap = select => el('span', { class:'ihr-spine-editor__select-wrap' }, [select]);
    // Finishes are chosen from material samples, like a binder's swatch card.
    // The native <select> is still the real control (Tab, arrow keys, screen
    // readers, TalkBack) laid transparently over the samples; the samples
    // themselves only answer the pointer.
    const finishPickers = [];
    function materialPicker(select, part, choices) {
      const samples = choices.map(([value, text]) => el('span', {
        class:'ihr-spine-editor__material', 'data-value':value, title:text,
        onClick:() => {
          if (select.value === value) return;
          select.value = value;
          select.dispatchEvent(new Event('change', { bubbles:true }));
        }
      }, [el('span', { class:'ihr-spine-editor__specimen' }), el('span', { class:'ihr-spine-editor__material-name', text })]));
      const picker = el('span', { class:'ihr-spine-editor__materials', 'data-part':part }, [
        select, el('span', { class:'ihr-spine-editor__materials-track', 'aria-hidden':'true' }, samples)
      ]);
      finishPickers.push({ select, picker, samples });
      return picker;
    }
    const FOIL_CHOICES = [['gold','Oro'],['silver','Plata']];
    const SURFACE_CHOICES = [['matte','Mate'],['satin','Satinado'],['glossy','Brillante']];
    function finishSelect(label, field) {
      const select = el('select', { class:'ihr-spine-editor__select ihr-spine-editor__finish', 'aria-label':label,
        onChange:event => updateCustomization({ [field]:event.currentTarget.value }) });
      const choices = [['matte', field === 'spineTextFinish' ? 'Tinta' : 'Tela'], ...FOIL_CHOICES];
      for (const [value,text] of choices) select.append(el('option',{value,text}));
      select.value = spineFinish(book[field]);
      return { select, picker:materialPicker(select, field === 'spineTextFinish' ? 'ink' : 'binding', choices) };
    }
    const { select:bindingFinish, picker:bindingPicker } = finishSelect('Acabado del lomo', 'spineFinish');
    function surfaceFinishSelect(label, field, fallback, part) {
      const select = el('select', {
        class:'ihr-spine-editor__select ihr-spine-editor__finish',
        'aria-label':label,
        onChange:event => updateCustomization({ [field]:surfaceFinish(event.currentTarget.value, fallback) })
      });
      for (const [value,text] of SURFACE_CHOICES) select.append(el('option',{value,text}));
      select.value = surfaceFinish(book[field], fallback);
      return { select, picker:materialPicker(select, part, SURFACE_CHOICES) };
    }
    const { select:coverSurfaceFinish, picker:coverPicker } = surfaceFinishSelect('Brillo de la portada', 'coverFinish', 'satin', 'cover');
    const { select:pageEdgeSurfaceFinish, picker:pageEdgePicker } = surfaceFinishSelect('Brillo del canto', 'pageEdgeFinish', 'satin', 'edge');
    const { select:spineSurfaceFinish, picker:spineSurfacePicker } = surfaceFinishSelect('Brillo del lomo', 'spineSurfaceFinish', 'matte', 'spine');
    const editorLabel = text => el('span', { class:'ihr-spine-editor__label', text });
    const editorRow = (label, control, extra = '') => el('label', { class:`ihr-spine-editor__row ${extra}`.trim() }, [editorLabel(label), control]);
    // Rows holding a sample picker are not <label>s: a click on a sample must
    // not be forwarded to the transparent select.
    const pickerRow = (label, picker, extra = '') => el('div', { class:`ihr-spine-editor__row ${extra}`.trim() }, [editorLabel(label), picker]);
    // Gloss reads as a small specimen chart: one row per part, one column per sheen.
    const surfaceFinishControls = el('div', { class:'ihr-spine-editor__gloss', role:'group', 'aria-label':'Acabados de superficie' }, [
      el('div', { class:'ihr-spine-editor__row ihr-spine-editor__gloss-head', 'aria-hidden':'true' }, [
        el('span', { class:'ihr-spine-editor__label' }),
        el('span', { class:'ihr-spine-editor__gloss-columns' }, SURFACE_CHOICES.map(([, text]) => el('span', { text })))
      ]),
      pickerRow('Portada', coverPicker, 'ihr-spine-editor__gloss-row'),
      pickerRow('Canto', pageEdgePicker, 'ihr-spine-editor__gloss-row'),
      pickerRow('Lomo', spineSurfacePicker, 'ihr-spine-editor__gloss-row')
    ]);
    const { select:inkFinish, picker:inkFinishPicker } = finishSelect('Acabado del texto', 'spineTextFinish');
    const inkPicker = el('input', {type:'color', value:item.style.ink, 'aria-label':'Color del texto',
      onChange:event => updateCustomization({spineTextColor:event.currentTarget.value, spineTextFinish:'matte'})});
    const engravedInput = el('input', {type:'checkbox', role:'switch', 'aria-label':'Texto grabado',
      onChange:event => updateCustomization({spineEngraved:event.currentTarget.checked})});
    const inkControls = el('div', {class:'ihr-spine-editor__row ihr-spine-editor__ink'}, [
      editorLabel('Color'),
      el('span', { class:'ihr-spine-editor__ink-controls' }, [
        el('span', { class:'ihr-spine-editor__ink-chip' }, [inkPicker]),
        el('button', {type:'button', class:'ihr-spine-editor__auto', text:'Auto', title:'Contraste automático',
          onClick:() => updateCustomization({spineTextColor:null, spineTextFinish:'matte'})})
      ])
    ]);
    const section = (title, modifier, children) => el('div', {
      class:`ihr-spine-editor__section ihr-spine-editor__section--${modifier}`
    }, [el('h3', { class:'ihr-spine-editor__section-title', text:title }), ...children]);
    const sheetGrip = el('span', { class:'ihr-spine-editor__grip', 'aria-hidden':'true' });
    const editorHeading = el('h2', { class:'ihr-spine-editor__heading', text:'Editar el lomo' });
    // Pestañas 'Lomo' | 'Portada': lista de pestañas con tabulación móvil
    // (sólo la activa entra en el orden de Tab; flechas, Inicio y Fin mueven).
    const editorTabButtons = new Map(EDITOR_TABS.map(tab => [tab.id, el('button', {
      type:'button', role:'tab', class:'ihr-spine-editor__tab', id:`${editorUid}-tab-${tab.id}`,
      'aria-selected':String(tab.id === editorTab), 'aria-controls':`${editorUid}-panel-${tab.id}`,
      tabindex:tab.id === editorTab ? '0' : '-1', text:tab.label,
      onClick:() => selectEditorTab(tab.id)
    })]));
    const editorTabs = el('div', {
      class:'ihr-spine-editor__tabs', role:'tablist', 'aria-label':'Qué quieres editar',
      onKeydown:event => {
        const target = nextEditorTab(editorTab, event.key);
        if (!target) return;
        event.preventDefault(); event.stopPropagation();
        selectEditorTab(target, { focusTab:true });
      }
    }, [...editorTabButtons.values()]);
    const editorHeader = el('header', { class:'ihr-spine-editor__header' }, [
      sheetGrip,
      el('div', { class:'ihr-spine-editor__titles' }, [
        editorHeading,
        editorSubtitle
      ]),
      el('button', { type:'button', class:'ihr-btn ihr-spine-editor__done', text:'Listo', onClick:closeEditor }),
      editorTabs
    ]);
    const spinePanel = el('div', {
      class:'ihr-spine-editor__body', id:`${editorUid}-panel-spine`, role:'tabpanel',
      'aria-labelledby':`${editorUid}-tab-spine`
    }, [
        section('Rótulo', 'text', [
          el('label', { class:'ihr-spine-editor__field ihr-spine-editor__field--title' }, [editorLabel('Texto del lomo'), titleInput]),
          el('label', { class:'ihr-spine-editor__field ihr-spine-editor__field--author' }, [editorLabel('Autor'), authorInput])
        ]),
        section('Tipografía', 'type', [
          editorRow('Fuente', selectWrap(fontSelect), 'ihr-spine-editor__row--font'),
          editorRow('Título', el('span', { class:'ihr-spine-editor__range' }, [fontSizeInput, sizeOutput]), 'ihr-spine-editor__field--size'),
          editorRow('Autor', el('span', { class:'ihr-spine-editor__range' }, [authorSizeInput, authorSizeOutput]), 'ihr-spine-editor__field--size')
        ]),
        section('Letras', 'ink', [
          inkControls,
          pickerRow('Acabado', inkFinishPicker),
          el('label', { class:'ihr-spine-editor__row ihr-spine-editor__engraving' }, [
            el('span', { class:'ihr-spine-editor__label', text:'Texto grabado' }), engravedInput
          ])
        ]),
        section('Encuadernación', 'binding', [
          el('div', { class:'ihr-spine-editor__row ihr-spine-editor__row--swatches' }, [editorLabel('Color'), colorControls]),
          pickerRow('Acabado', bindingPicker)
        ]),
        section('Brillo', 'gloss', [surfaceFinishControls])
    ]);

    // ---- Pestaña 'Portada' · Relieve ----
    const reliefName = `${editorUid}-relief`;
    const reliefStatus = el('p', { class:'ihr-relief__status', role:'status', 'aria-live':'polite' });
    const reliefRetry = el('button', {
      type:'button', class:'ihr-spine-editor__auto ihr-relief__retry', text:'Reintentar', hidden:true,
      onClick:() => { relief.status = 'idle'; loadReliefProposals(); }
    });
    const reliefGrid = el('div', { class:'ihr-relief__cards' });
    const reliefNoneInput = el('input', {
      type:'radio', name:reliefName, value:'', class:'ihr-relief__input',
      onChange:() => chooseRelief(null)
    });
    const reliefNone = el('label', { class:'ihr-relief-none', hidden:true }, [
      reliefNoneInput, el('span', { class:'ihr-relief-none__mark', 'aria-hidden':'true' }), el('span', { text:'Sin relieve' })
    ]);
    const reliefGroup = el('div', { class:'ihr-relief__group', role:'radiogroup', 'aria-label':'Propuestas de relieve' }, [reliefGrid, reliefNone]);
    const reliefStrengthOutput = el('output', { class:'ihr-spine-editor__size' });
    const reliefStrength = el('input', {
      type:'range', min:'10', max:'100', step:'5', class:'ihr-spine-editor__slider', 'aria-label':'Intensidad del relieve',
      onInput:event => {
        const percent = Number(event.currentTarget.value);
        reliefStrengthOutput.textContent = `${percent} %`;
        syncRange(event.currentTarget);
        const current = normalizeCoverRelief(book.coverRelief);
        if (!current) return;
        updateCustomization({ coverRelief:{ id:current.id, strength:percent / 100 } });
        // Un empujón a la vista por fotograma como mucho al arrastrar.
        if (!relief.sliderFrame) relief.sliderFrame = requestAnimationFrame(() => {
          relief.sliderFrame = 0;
          pushReliefToView(normalizeCoverRelief(book.coverRelief));
        });
      }
    });
    const reliefStrengthRow = el('label', { class:'ihr-spine-editor__row ihr-relief__strength' }, [
      editorLabel('Intensidad'), el('span', { class:'ihr-spine-editor__range' }, [reliefStrength, reliefStrengthOutput])
    ]);
    const coverPanel = el('div', {
      class:'ihr-spine-editor__cover', id:`${editorUid}-panel-cover`, role:'tabpanel',
      'aria-labelledby':`${editorUid}-tab-cover`, hidden:true
    }, [
      section('Relieve', 'relief', [
                el('div', { class:'ihr-relief__state' }, [reliefStatus, reliefRetry]),
        reliefGroup,
        reliefStrengthRow
      ])
    ]);
    const cleanProposals = list => (Array.isArray(list) ? list : []).slice(0, 3)
      .filter(proposal => proposal && typeof proposal.id === 'string' && typeof proposal.label === 'string')
      .map(proposal => ({
        id:proposal.id, label:proposal.label,
        description:typeof proposal.description === 'string' ? proposal.description : '',
        strength:Number.isFinite(proposal.strength) ? Math.min(1, Math.max(.1, proposal.strength)) : .7,
        thumbnail:typeof proposal.thumbnail === 'string' && proposal.thumbnail.startsWith('data:image/') ? proposal.thumbnail : ''
      }));
    function pushReliefToView(next) {
      if (view?.setCoverRelief) {
        relief.applied = Promise.resolve(view.setCoverRelief(next)).catch(error => {
          console.warn('No se pudo aplicar el relieve:', error); return false;
        });
      } else { view?.updateCoverAppearance?.(book); relief.applied = Promise.resolve(true); }
      return relief.applied;
    }
    function applyRelief(next) {
      updateCustomization({ coverRelief:next });
      pushReliefToView(next);
    }
    function syncReliefSelection() {
      const current = normalizeCoverRelief(book.coverRelief);
      for (const input of reliefGrid.querySelectorAll('input')) {
        const on = input.value === current?.id;
        input.checked = on;
        input.closest('.ihr-relief-card').classList.toggle('is-selected', on);
      }
      reliefNoneInput.checked = !current;
      reliefNone.classList.toggle('is-selected', !current);
      reliefNone.hidden = !(relief.status === 'ready' || current);
      reliefStrength.disabled = !current;
      const percent = Math.round((current?.strength ?? .7) * 100);
      reliefStrength.value = String(Math.max(10, percent));
      reliefStrengthOutput.textContent = current ? `${percent} %` : '—';
      syncRange(reliefStrength);
      reliefStrengthRow.hidden = !(relief.status === 'ready' || current);
    }
    function chooseRelief(proposal) {
      const next = proposal ? normalizeCoverRelief({ id:proposal.id, strength:proposal.strength }) : null;
      if (proposal && !next) return;
      applyRelief(next);
      syncReliefSelection();
      if (next) scheduleCoverTilt(); else cancelCoverTilt();
    }
    function reliefCard(proposal) {
      const input = el('input', {
        type:'radio', name:reliefName, value:proposal.id, class:'ihr-relief__input',
        onChange:() => chooseRelief(proposal),
        // Volver a tocar la propuesta elegida repite el balanceo.
        onClick:() => { if (normalizeCoverRelief(book.coverRelief)?.id === proposal.id) scheduleCoverTilt(); }
      });
      return el('label', { class:'ihr-relief-card' }, [
        input,
        el('span', { class:'ihr-relief-card__preview', 'aria-hidden':'true' },
          proposal.thumbnail ? [el('img', { class:'ihr-relief-card__thumb', src:proposal.thumbnail, alt:'', draggable:'false' })] : []),
        el('span', { class:'ihr-relief-card__text' }, [
          el('span', { class:'ihr-relief-card__label', text:proposal.label }),
          proposal.description ? el('span', { class:'ihr-relief-card__description', text:proposal.description }) : null
        ])
      ]);
    }
    function renderReliefCards() {
      const { status, proposals } = relief;
      coverPanel.setAttribute('aria-busy', String(status === 'loading'));
      reliefGroup.classList.toggle('is-loading', status === 'loading');
      reliefRetry.hidden = status !== 'error';
      reliefStatus.textContent = status === 'loading' ? 'Analizando…'
        : status === 'error' ? 'No se pudo analizar la portada'
        : status === 'empty' ? (coverUrl ? 'Sin zonas detectadas'
          : 'Sin portada')
        : status === 'ready' ? '' : '';
      reliefStatus.classList.toggle('is-busy', status === 'loading');
      // Reserve the cards before the turn; starting analysis must not grow
      // the sheet over the cover that was just fitted above it.
      if (status === 'loading' || status === 'idle') {
        reliefGrid.replaceChildren(...[0, 1, 2].map(() => el('span', { class:'ihr-relief-card is-skeleton', 'aria-hidden':'true' }, [
          el('span', { class:'ihr-relief-card__preview' }),
          el('span', { class:'ihr-relief-card__text' }, [el('span', { class:'ihr-relief-card__label' }), el('span', { class:'ihr-relief-card__description' })])
        ])));
      } else reliefGrid.replaceChildren(...(status === 'ready' ? proposals.map(reliefCard) : []));
      syncReliefSelection();
    }
    async function loadReliefProposals() {
      if (relief.status === 'loading' || relief.status === 'ready') return;
      if (!coverUrl) { relief.status = 'empty'; renderReliefCards(); refitCoverPose(); return; }
      const key = reliefKey();
      const cached = state.reliefProposals.get(key);
      if (cached) { relief.proposals = cached; relief.status = 'ready'; renderReliefCards(); refitCoverPose(); return; }
      const controller = new AbortController();
      relief.controller = controller;
      relief.status = 'loading';
      renderReliefCards();
      try {
        const result = await analyzeCoverRelief(coverUrl, {
          title:book.title, author:normalizeBookAuthor(book.author), signal:controller.signal
        });
        if (relief.controller !== controller || state.session !== session) return;
        relief.proposals = cleanProposals(result?.proposals);
        relief.status = relief.proposals.length ? 'ready' : 'empty';
        if (relief.proposals.length) {
          state.reliefProposals.set(key, relief.proposals);
          if (state.reliefProposals.size > 12) state.reliefProposals.delete(state.reliefProposals.keys().next().value);
        }
      } catch (error) {
        if (relief.controller !== controller || controller.signal.aborted) return;
        console.warn('No se pudo analizar la portada para el relieve:', error);
        relief.status = 'error';
      }
      relief.controller = null;
      renderReliefCards();
      refitCoverPose();
    }
    editorPanel.append(editorHeader, editorPreview, spinePanel, coverPanel);
    renderReliefCards();
    updateColorSelection();
    // Mobile sheet: dragging the header down dismisses it, like its grabber suggests.
    let sheetDrag = null;
    editorHeader.addEventListener('pointerdown', event => {
      if (event.button !== 0 || !sheetGrip.offsetWidth || event.target.closest('button')) return;
      sheetDrag = { id:event.pointerId, y:event.clientY, time:performance.now(), dy:0 };
      editorHeader.setPointerCapture?.(event.pointerId);
      editorPanel.classList.add('is-dragging');
    });
    editorHeader.addEventListener('pointermove', event => {
      if (sheetDrag?.id !== event.pointerId) return;
      sheetDrag.dy = Math.max(0, event.clientY - sheetDrag.y);
      editorPanel.style.transform = sheetDrag.dy ? `translateY(${sheetDrag.dy}px)` : '';
    });
    const endSheetDrag = event => {
      if (sheetDrag?.id !== event.pointerId) return;
      const { dy, time } = sheetDrag;
      sheetDrag = null;
      editorPanel.classList.remove('is-dragging');
      editorPanel.style.transform = '';
      const flick = dy > 36 && dy / Math.max(1, performance.now() - time) > .55;
      if (event.type === 'pointerup' && (dy > 110 || flick)) closeEditor();
    };
    editorHeader.addEventListener('pointerup', endSheetDrag);
    editorHeader.addEventListener('pointercancel', endSheetDrag);
    meta.append(el('div', { class: 'ihr-flyout__actions' }, actionButtons));
    meta.append(editorPanel);
    const readyCheck = setInterval(() => {
      const task = options.getBookPreparation?.(book)
      clearInterval(readyCheck)
      if (!task) { readiness.textContent = 'Toca la portada para leer'; return }
      task.then(ok => {
        if (state.session === session) readiness.textContent = ok ? 'Listo para leer' : 'No se pudo preparar. Toca para reintentar.'
      }).catch(() => { if (state.session === session) readiness.textContent = 'No se pudo preparar. Toca para reintentar.' })
    }, 250)
    if (!options.getBookPreparation) clearInterval(readyCheck)

    // The real cover and its initial pose must be ready before replacing the
    // shelf mesh; a generated jacket must never flash during this handoff.
    if (view) await view.ready;
    if (session.cancelled || state.destroyed) { view?.dispose(); return; }
    state.shelfScene?.flush();
    const handoffPose = state.shelfScene?.getBookPose(spineEl);
    if (view && handoffPose) {
      dx = handoffPose.centerX - centerX;
      dy = handoffPose.centerY - centerY;
      startScale = handoffPose.scale * handoffPose.height / coverH;
      sourceAngle = handoffPose.angle;
      sourcePitch = handoffPose.pitch;
      sourceRoll = handoffPose.roll ?? 0;
      view.draw({ x:dx, y:dy, scale:startScale, angle:sourceAngle, pitch:sourcePitch, roll:sourceRoll });
    }
    document.body.append(flyout);
    spineEl.classList.add('is-away');
    state.shelfScene?.flush();
    flyout.focus?.();

    const reduce = prefersReducedMotion();
    const duration = reduce ? 1 : opts.revealDuration;
    const lift = Math.min(64, rect.height * 0.35);

    const zStart = 0;
    const scaleAt = (t) => startScale + (1 - startScale) * t;
    const tf = (x, y, z, scale, angle) => ({ x, y, scale, angle, pitch: Math.max(0, (90 - angle) / 90) * 7 });

    const frames = [
      {
        transform: { x:dx, y:dy, scale:startScale, angle:sourceAngle, pitch:sourcePitch, roll:sourceRoll },
        easing: 'cubic-bezier(0.34, 0, 0.26, 1)'
      },
      {
        offset: 0.26,
        transform: tf(dx * 0.9, dy * 0.86 - lift, zStart * 0.55, scaleAt(0.15), sourceAngle * .89),
        easing: EASE
      },
      {
        offset: 0.7,
        transform: tf(dx * 0.18, dy * 0.16, 0, scaleAt(0.85), 16),
        easing: 'cubic-bezier(0.3, 0, 0.2, 1)'
      },
      { transform: tf(0, 0, 0, 1, 0) }
    ];

    bookNode.style.willChange = 'transform';
    // Timing lineal a propósito: cada keyframe trae su propio easing y, si
    // además se pone uno global, se componen y la coreografía se come el
    // último tercio de la animación (queda quieta mientras corre el reloj).
    const reveal = animateBook(frames, { duration, easing: 'linear', fill: 'both' });
    animate(scrim, [{ opacity: 0 }, { opacity: 1 }], {
      duration: Math.min(280, duration),
      easing: EASE,
      fill: 'both'
    });
    const metaEntrance = animate(
      meta,
      [
        { opacity: 0, transform: 'translateY(12px)' },
        { opacity: 1, transform: 'translateY(0)' }
      ],
      { duration: Math.min(260, duration), delay: duration * 0.62, easing: EASE, fill: 'both' }
    );

    function fadeMeta() {
      if (!editorPanel.hidden) closeEditor({ commit: false, restoreFocus: false });
      const opacity = getComputedStyle(meta).opacity;
      metaEntrance.cancel?.();
      animate(meta, [{ opacity }, { opacity:0 }], { duration:prefersReducedMotion() ? 1 : 160, fill:'both' });
      meta.style.pointerEvents = 'none';
      actionButtons.forEach(button => { button.disabled = true; });
      editorPanel.querySelectorAll('button, input, select').forEach(control => { control.disabled = true; });
    }

    async function playReturn() {
      const returnDuration = prefersReducedMotion() ? 1 : opts.returnDuration;
      state.shelfScene?.flush();
      const dockingPose = view && state.shelfScene?.getReturnPose(spineEl);
      const target = dockingPose || state.shelfScene?.getBookPose(spineEl);
      const end = target
        ? { x:target.centerX-centerX, y:target.centerY-centerY, scale:target.scale*target.height/coverH, angle:target.angle, pitch:target.pitch, roll:target.roll ?? 0 }
        : tf(dx, dy, zStart, startScale, 90);
      const approachDuration = dockingPose ? returnDuration * .66 : returnDuration;
      const back = animateBook(
        [
          { transform: tf(0, 0, 0, 1, 0) },
          {
            offset: 0.45,
            transform: tf(end.x * 0.45, end.y * 0.35 - lift * 0.6, zStart * 0.4, scaleAt(0.55), end.angle * .7)
          },
          { transform: end }
        ],
        {
          duration: approachDuration,
          easing: EASE,
          fill: 'both'
        }
      );
      session.returnAnimation = back;
      animate(scrim, [{ opacity: 1 }, { opacity: 0 }], {
        duration: approachDuration,
        easing: EASE,
        fill: 'both'
      });
      await waitForMotion(back, approachDuration);
      if (dockingPose && !state.destroyed && state.session === session) {
        const insertion = state.shelfScene?.returnBook(spineEl, { duration:returnDuration - approachDuration, overlayCanvas:view.canvas });
        session.insertion = insertion;
        if (insertion) {
          // The shelf scene owns the mesh and depth buffer for insertion. Its
          // full-screen output keeps edge books clear of the scroller's clip.
          await waitForMotion(insertion, returnDuration - approachDuration);
        }
      }
    }

    try {
      await reveal.finished?.catch(() => {});
    } finally {
      bookNode.style.willChange = '';
    }

    if (session.cancelled || state.destroyed) return;

    session.phase = 'ready';
    markTiming('flyout-ready');
    settle(true);
    flyout.classList.add('is-ready');
    actionButtons[0].disabled = false;
    actionButtons[2].disabled = false;
    coverTarget.hidden = !opts.autoOpen;
    coverTarget.classList.add('is-ready');

    function installOpeningPage(snapshot, { redraw = true } = {}) {
      if (!snapshot?.source) return false;
      // The book opens on white paper whatever the reading theme: the snapshot's
      // white-paper variant starts at pageTheme 0 and fades to the theme on the zoom.
      // A page warmed up while the book waited is already on the model.
      if (view) return view.hasPageSnapshot(snapshot) || view.setPageSnapshot(snapshot, { ...(snapshot.paper ? { pageTheme:0 } : {}), redraw });
      const pages = bookNode.querySelector('.ihr-flyout__fallback-pages');
      if (!pages) return false;
      const canvas = snapshot.source;
      const pageW = coverW * .92, pageH = coverH * .975;
      const scale = Math.min(pageW / snapshot.width, pageH / snapshot.height);
      canvas.className = 'ihr-flyout__saved-page';
      canvas.style.cssText = `position:absolute;width:${snapshot.width*scale}px;height:${snapshot.height*scale}px;left:${(pageW-snapshot.width*scale)/2}px;top:${(pageH-snapshot.height*scale)/2}px`;
      canvas.dataset.pageSource = snapshot.sourceType || snapshot.engine;
      canvas.dataset.pageLocator = JSON.stringify(snapshot.location?.locator ?? null);
      canvas.dataset.pageText = (snapshot.text || '').slice(0, 3000);
      pages.replaceChildren(...fallbackPageLayers(canvas, snapshot, 0));
      return true;
    }

    // The page this book will open on arrives while the cover still waits for
    // a tap (the cover is closed, so it stays hidden behind it). Textures and
    // programs are built here, in separate idle slices, so the tap only has to
    // play the animation. Returns false when it could not (or need not) be done.
    session.warmOpeningPage = async (snapshot, idle) => {
      const stale = () => session.cancelled || state.destroyed || state.session !== session || session.phase !== 'ready';
      if (!view || stale() || !installOpeningPage(snapshot, { redraw:false })) return false;
      await idle();
      if (stale() || !view.hasPageSnapshot(snapshot)) return false;
      view.compilePage();
      for (const texture of view.pageTextures()) {
        await idle();
        if (stale() || !view.hasPageSnapshot(snapshot)) return false;
        view.uploadPageTexture(texture);
      }
      await idle();
      if (stale() || !view.hasPageSnapshot(snapshot)) return false;
      view.draw(view.getPose()); // links the page's programs and renders the covered page once
      markTiming('textures-uploaded');
      return true;
    };

    async function animateBookToPage(target) {
      if (session.cancelled || state.destroyed) return;
      if (view) {
        // The pages fade from white paper to the reader's theme with the zoom itself.
        session.pageZoom = view.animateToPage({ ...target, pageTheme:1 });
        await waitForMotion(session.pageZoom, target.duration);
        return;
      }
      const page = bookNode.querySelector('.ihr-flyout__saved-page');
      const bounds = page?.getBoundingClientRect();
      if (!bounds?.width || !bounds.height) return;
      if (bookNode.querySelector('.ihr-flyout__saved-page-stock')) {
        animate(page, [{ opacity:0 }, { opacity:1 }], { duration:target.duration, easing:'cubic-bezier(.2,.74,.2,1)', fill:'both' });
      }
      const scale = target.width / bounds.width;
      const bookBounds = bookNode.getBoundingClientRect();
      const imageX = bounds.left + bounds.width/2, imageY = bounds.top + bounds.height/2;
      const dx = target.left + target.width/2 - imageX + (1-scale)*(imageX-bookBounds.left-bookBounds.width/2);
      const dy = target.top + target.height/2 - imageY + (1-scale)*(imageY-bookBounds.top-bookBounds.height/2);
      session.pageZoom = animate(bookNode, [
        { transform:'translate(0,0) scale(1)' },
        { transform:`translate(${dx}px,${dy}px) scale(${scale})` }
      ], { duration:target.duration, easing:'cubic-bezier(.2,.74,.2,1)', fill:'both' });
      await waitForMotion(session.pageZoom, target.duration);
    }

    async function finishReaderTransition({ pageSnapshot, animatePage } = {}) {
      if (session.cancelled || state.destroyed) return false;
      if (pageSnapshot && !installOpeningPage(pageSnapshot)) throw new Error('No se pudo preparar la página del modelo 3D.');
      markTiming('page-installed');
      session.phase = 'reading';
      flyout.dataset.openingPhase = 'opening';
      flyout.classList.add('is-opening-book');
      closeButton.hidden = true;
      fadeMeta();
      session.readingPose = planReadingBookPose({ width:coverW, height:coverH, thickness,
        viewportWidth:vw, viewportHeight:vh, centerX, centerY });
      session.coverOpeningDuration = prefersReducedMotion() ? 1 : 640;
      // The restored page is uploaded BEFORE its cover moves. Starting the
      // hinge while the renderer loaded exposed a blank, generic page block.
      session.coverOpening = view
        ? view.animateCoverOpen({ duration:session.coverOpeningDuration, targetPose:session.readingPose })
        : animate(bookNode.querySelector('.ihr-flyout__fallback-leaf'), [
            { transform:'rotateY(0deg)' }, { transform:'rotateY(-169deg)' }
          ], { duration:session.coverOpeningDuration, easing:EASE, fill:'both' });
      await waitForMotion(session.coverOpening, session.coverOpeningDuration);
      if (session.cancelled || state.destroyed) return false;
      // Withdraw the fabric while the saved page is still readable, before
      // moving the camera. Closing performs these same steps in reverse.
      flyout.dataset.openingPhase = 'bookmark';
      if (view) {
        session.bookmarkMotion = view.animateBookmark({ withdraw:1, duration:prefersReducedMotion() ? 1 : 320 });
        await waitForMotion(session.bookmarkMotion, prefersReducedMotion() ? 1 : 320);
      }
      if (session.cancelled || state.destroyed) return false;
      if (typeof animatePage === 'function') {
        flyout.dataset.openingPhase = 'zooming';
        await animatePage({ duration:prefersReducedMotion() ? 1 : 720, pageSnapshot, animateBookToPage,
          isActive:() => !session.cancelled && !state.destroyed && state.session === session });
      }
      if (session.cancelled || state.destroyed) return false;
      // Whatever ended the zoom, the book hands over in the reader's own colours.
      if (view && view.getPageTheme() < 1) view.setPageTheme(1);
      flyout.dataset.openingPhase = 'handoff';
      const fadeDuration = prefersReducedMotion() ? 1 : 140;
      const fade = animate(bookNode, [{ opacity:1 }, { opacity:0 }], { duration:fadeDuration, easing:'linear', fill:'both' });
      animate(scrim, [{ opacity:1 }, { opacity:0 }], { duration:fadeDuration, easing:'linear', fill:'both' });
      await waitForMotion(fade, fadeDuration);
      if (state.session === session) {
        flyout.dataset.openingPhase = 'complete';
        session.phase = 'complete';
        state.lastOpened = { book, style: item.style, spineEl };
        state.session = null;
        state.busy = false;
        session.cancelled = true;
        clearInterval(readyCheck);
        document.removeEventListener('keydown', onKeydown, true);
        view?.dispose();
        flyout.remove();
        return true;
      }
      return false;
    }

    async function expandCover() {
      if (session.cancelled || session.expanding || session.phase !== 'ready' || state.destroyed) return;
      session.expanding = true;
      session.phase = 'preparing';
      flyout.dataset.openingPhase = 'preparing';
      coverTarget.disabled = true;
      flyout.classList.add('is-expanding');
      coverTarget.hidden = true;
      actionButtons.forEach(button => { button.disabled = true; });
      readiness.textContent = 'Preparando…';
      markTiming('open-tap');
      try {
        await onOpen?.(book, {
          coverUrl,
          isActive: () => !session.cancelled && !state.destroyed && state.session === session,
          onCancel: listener => { session.onCancel = listener; },
          close: ({ instant = false } = {}) => close({ silent: true, instant }),
          finish: finishReaderTransition
        });
      } catch (error) {
        console.error('No se pudo abrir el lector:', error);
        await close({ silent: true });
      }
    }
    coverTarget.addEventListener('click', expandCover);
  }

  /* --------------------------- ciclo de vida --------------------------- */

  let observer = null;
  const onViewportResize = () => {
    cancelTrashRemoval();
    if (state.session?.handleViewportResize?.()) return;
    if (state.dragSession) finishSpineDrag({ pointerId:state.dragSession.pointerId }, state.dragSession.node, true);
    state.pendingSelection?.cancel();
    state.session?.close({ instant:true, silent:true });
    state.returnMotion?.cancel();
    scheduleRender();
  };
  const onVisualViewportChange = () => { state.session?.handleViewportResize?.(); };
  window.addEventListener('resize', onViewportResize);
  window.visualViewport?.addEventListener('resize', onVisualViewportChange);
  window.visualViewport?.addEventListener('scroll', onVisualViewportChange);
  if (typeof ResizeObserver === 'function') {
    observer = new ResizeObserver(() => {
      const width = measure();
      // Umbral: evita re-empaquetar por el scrollbar o por 1px de reflow.
      if (Math.abs(width - state.shelfWidth) >= 8) scheduleRender();
    });
    observer.observe(scroller);
  }

  prepareInitialAppearances();
  render();
  // Canvas text does not repaint when a web font arrives, unlike DOM text.
  document.fonts?.ready.then(() => {
    if (!state.destroyed && !state.session) scheduleRender();
  });

  /** Sustituye la biblioteca y vuelve a pintar, conservando el scroll. */
  function refresh(nextBooks) {
    if (state.destroyed) return;
    if (state.returnMotion || state.reorderTimer || state.busy || state.session || state.dragSession) {
      if (Array.isArray(nextBooks)) state.queuedBooks = nextBooks.filter(book => !state.pendingRemovals.has(String(book.id)));
      return;
    }
    const top = scroller.scrollTop;
    // A removal still being written must not let an older record list put its book back.
    state.books = Array.isArray(nextBooks) ? nextBooks.filter(book => !state.pendingRemovals.has(String(book.id))) : state.books;
    if (!state.appearancesReady && options.waitForCoverAppearance) {
      state.appearanceGeneration += 1;
      state.appearancesReady = true;
      prepareInitialAppearances();
    }
    state.shelfWidth = 0; // fuerza el re-empaquetado
    render();
    scroller.scrollTop = top;
  }

  function applyDeferredShelfUpdates() {
    if (state.destroyed || state.returnMotion || state.reorderTimer || state.busy || state.session || state.dragSession) return;
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
  function fallbackPageLayers(canvas, snapshot, opacity) {
    const stock = snapshot.paper?.source;
    if (!stock) return [canvas];
    stock.className = 'ihr-flyout__saved-page-stock';
    stock.style.cssText = canvas.style.cssText;
    canvas.style.opacity = String(opacity);
    return [stock, canvas];
  }

  /** Cierra el tomo 3D desde el lector y lo devuelve a su hueco. */
  async function returnToShelf(bookId, { pageSnapshot, book:latestBook, onPageReady } = {}) {
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
    const view = bookView(bookNode, book, previous.style, {
      width:coverW, height:coverH, thickness, viewportWidth:vw, viewportHeight:vh,
      centerX, centerY, coverUrl,
      initialPose:{ x:0, y:0, scale:1, angle:0, pitch:0, coverOpen:pageSnapshot ? 1 : 0, bookmarkWithdraw:pageSnapshot ? 1 : 0 }
    });
    if (view) {
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
    const duration = prefersReducedMotion() ? 1 : 560;
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
    const restoreShelfSpine = () => {
      const current = [...root.querySelectorAll('.ihr-spine')]
        .find(node => node.dataset.bookId === String(bookId)) || spine
      current.classList.remove('is-away')
      state.shelfScene?.flush();
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
    try {
      if (view) await view.ready;
      if (!active()) return false;
      if (pageSnapshot?.source && view && view.setPageSnapshot(pageSnapshot)) {
        view.draw({ ...readingPose, bookmarkWithdraw:1 });
        if (!view.alignToPage(pageSnapshot.displayBounds)) throw new Error('No se pudo alinear la página al cerrar el libro.');
        flyout.style.visibility = '';
        onPageReady?.();
        flyout.dataset.returnPhase = 'zooming';
        animate(scrim, [{ opacity:0 }, { opacity:1 }], { duration:prefersReducedMotion() ? 1 : 320, fill:'both' });
        // Back to white paper on the zoom's own clock: the page leaves the reader in
        // its theme (as the still image shows it) and the book closes on white paper.
        animation = view.animate([{ transform:view.getPose() }, { transform:{ ...readingPose, bookmarkWithdraw:1, ...(pageSnapshot.paper ? { pageTheme:0 } : {}) } }],
          { duration:prefersReducedMotion() ? 1 : 620 });
        await waitForMotion(animation, prefersReducedMotion() ? 1 : 620);
        if (!active()) return false;
        // White paper from here on, even if a stalled frame let the zoom's watchdog release it early.
        if (pageSnapshot.paper && view.getPageTheme() > 0) view.setPageTheme(0);
        flyout.dataset.returnPhase = 'bookmark';
        animation = view.animateBookmark({ withdraw:0, duration:prefersReducedMotion() ? 1 : 360 });
        await waitForMotion(animation, prefersReducedMotion() ? 1 : 360);
        if (!active()) return false;
        flyout.dataset.returnPhase = 'closing';
        animation = view.animateCoverClose({ duration:prefersReducedMotion() ? 1 : 580,
          targetPose:{ x:0,y:0,scale:1,angle:0,pitch:0,roll:0 } });
        await waitForMotion(animation, prefersReducedMotion() ? 1 : 580);
        if (!active()) return false;
      } else if (pageSnapshot?.source && !view) {
        const pages = bookNode.querySelector('.ihr-flyout__fallback-pages');
        const leaf = bookNode.querySelector('.ihr-flyout__fallback-leaf');
        const image = pageSnapshot.source;
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
        flyout.style.visibility = ''; onPageReady?.();
        flyout.dataset.returnPhase = 'zooming';
        animation = animate(bookNode,[{ transform:bookNode.style.transform },{ transform:'translate(0,0) scale(1)' }],
          { duration:prefersReducedMotion() ? 1 : 620, easing:EASE, fill:'both' });
        fallbackAnimations.push(animation);
        if (pageSnapshot.paper?.source) fallbackAnimations.push(animate(image,[{ opacity:1 },{ opacity:0 }],
          { duration:prefersReducedMotion() ? 1 : 620, easing:EASE, fill:'both' }));
        await waitForMotion(animation, prefersReducedMotion() ? 1 : 620);
        if (!active()) return false;
        bookNode.style.transform = 'translate(0,0) scale(1)'; animation.cancel?.();
        flyout.dataset.returnPhase = 'bookmark';
        const ribbon = el('div', { class:'ihr-flyout__return-ribbon' }); pages.append(ribbon);
        animation = animate(ribbon,[{ transform:'translateY(-130%)' },{ transform:'translateY(0)' }],
          { duration:prefersReducedMotion() ? 1 : 360, fill:'both', easing:EASE });
        fallbackAnimations.push(animation); await waitForMotion(animation, prefersReducedMotion() ? 1 : 360);
        if (!active()) return false;
        flyout.dataset.returnPhase = 'closing';
        animation = animate(leaf,[{ transform:'rotateY(-169deg)' },{ transform:'rotateY(0deg)' }],
          { duration:prefersReducedMotion() ? 1 : 580, fill:'both', easing:EASE });
        fallbackAnimations.push(animation); await waitForMotion(animation, prefersReducedMotion() ? 1 : 580);
        if (!active()) return false;
      }
      flyout.style.visibility = ''; onPageReady?.();
      flyout.dataset.returnPhase = 'returning';
      animate(scrim,[{ opacity:pageSnapshot ? 1 : 0 },{ opacity:0 }],{ duration:approachDuration, fill:'both' });
      animation = startFlight();
      await waitForMotion(animation, approachDuration);
      if (state.returnMotion === motion && view && dockingPose && !state.destroyed) {
        flyout.dataset.returnPhase = 'inserting';
        insertion = state.shelfScene?.returnBook(spine, { duration:duration - approachDuration, overlayCanvas:view.canvas });
        if (insertion) {
          await waitForMotion(insertion, duration - approachDuration);
        }
      }
      if (state.returnMotion === motion) {
        state.returnMotion = null;
        animation.cancel?.();
        for (const fallback of fallbackAnimations) fallback.cancel?.();
        const currentSpine = restoreShelfSpine()
        view?.dispose(); flyout.remove();
        state.lastOpened = null;
        currentSpine.focus?.({ preventScroll:true });
        applyDeferredShelfUpdates()
        maybeRefreshAppearanceStyles();
        return true;
      }
      return false;
    } catch (error) {
      motion.cancel();
      throw error;
    }
  }

  return {
    element: root,
    refresh,
    update: refresh,
    returnToShelf,
    hasReaderOrigin:bookId => state.lastOpened?.book.id === bookId,

    /** Hands the page a lifted book will open on to its 3D model ahead of the tap. */
    prepareOpeningPage(bookId, snapshot, idle = () => new Promise(resolve => setTimeout(resolve, 0))) {
      const session = state.session;
      if (!session?.warmOpeningPage || session.cancelled || session.book.id !== bookId) return Promise.resolve(false);
      return session.warmOpeningPage(snapshot, idle);
    },

    /** Repliega la portada abierta, si la hay. */
    close() {
      state.pendingSelection?.cancel();
      return state.session?.close() ?? Promise.resolve();
    },

    destroy() {
      state.destroyed = true;
      plantCatalog.destroy(); shelfZoom.destroy();
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
    }
  };
}

export default renderBookshelf;
