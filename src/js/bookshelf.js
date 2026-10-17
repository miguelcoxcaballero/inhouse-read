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


const SHELF_VIEW_MODES = Object.freeze({ SPINE:'spine', ISOMETRIC:'isometric' });

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
  playShelfSound:(...args)=>playShelfSound(...args),
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


function prefersReducedMotion() {
  return (
    typeof matchMedia === 'function' &&
    matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

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
  const shelfNative = needRustShelf();
  const state = shelfNative.shelf_screen_state(shelfEnv, books, options);
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
  const soundBindings={destroy:attachShelfSounds(root)};
  const shelfViewGesture = createShelfViewGesture({ root, scroller,
    getMode:() => state.viewMode, setMode:setViewMode,
    isEnabled:() => shelfNative.shelf_can_change_view(state),
    onGestureStart:event => shelfLifecycle.beginViewGesture(event)
  });
  const shelfZoom = createShelfZoom({root,scroller,getScene:()=>state.shelfScene,
    isEnabled:()=>shelfNative.shelf_can_zoom(state),
    onGestureStart:()=>shelfLifecycle.beginZoomGesture()});
  if (trashStatus) root.append(trashStatus, trashAnnounce);
  const plantCatalog = createLazyPlantCatalog({ onAdd:addCatalogPlant, onAddLamp:addCatalogLamp, shelfType:state.shelfType,
    onShelfChange:({ shelfType }, { whenClosed = run => run() } = {}) => {
      shelfLifecycle.setCatalogShelfType(shelfType);
      whenClosed(() => { if (!state.destroyed) render(); });
    },
    // The camera flies from the booklet in the room into the catalogue page.
    // The room is a scaled picture meanwhile: hold its repaints, whose
    // measurements would include that scale, until it is back in place.
    motionTarget:() => root.closest('.screen') || root,
    onMotion:phase => shelfLifecycle.setCatalogMotion(phase) });
  // Fetch the catalogue when the shelf settles, but leave its GPU studio for
  // the first open, after the camera flight. Hidden PMREM/shader work competes
  // with shelf redraws even when scheduled in an idle callback.
  function prepareCatalogWhenIdle(delay = 0) { if (shelfCtxLive) shelfLifecycle.prepareCatalogWhenIdle(delay); }
  const catalogNode = !opts.sections ? el('button', {
    type:'button', class:'ihr-shelf-catalog', hidden:'', tabindex:'-1',
    'aria-label':'Abrir catálogo IKEA de plantas, estanterías e iluminación', title:'Catálogo · IKEA',
    onClick:() => shelfLifecycle.openCatalog()
  }, [el('span', { class:'ihr-shelf-catalog__brand', text:'IKEA', 'aria-hidden':'true' }),
    el('span', { class:'ihr-shelf-catalog__title', text:'PLANTAS', 'aria-hidden':'true' }),
    svgIcon(['M7 15h10l-1.5 7h-7L7 15Z', 'M12 15V4',
      'M12 10C5 10 5 3 5 3c6 0 7 7 7 7Z', 'M12 8s0-6 7-7c0 6-7 7-7 7Z'],
      { className:'ihr-shelf-catalog__drawing' })]) : null;
  // La app monta hoy "añadir libro" y "Drive" en su propio header, así que la
  // barra de acciones de la estantería está apagada por defecto para no
  // duplicar controles. Se enciende con `showActions: true` (o sola, si se
  // pasa `onOpenDrive`, que es la integración del handoff original).
  const showActions = (options.showActions ?? Boolean(onDrive)) && (onPickLocal || onDrive);
  // One URL per saved cover: IndexedDB returns fresh record/Blob objects after every progress write, and the
  // decoded pixels must survive refreshes. The shelf module owns both tables.
  const coverCache = new WeakMap();
  const savedCoverUrls = new Map();
  // The shelf screen's parts that live in the shelf module share this context: the state object, the
  // options and the functions of other modules they call.
  // `legacy` holds what the shelf module still asks of this closure; it shrinks as those parts move.
  const shelfParts = { state, opts, options, env:shelfEnv, root, scroller, container,
    onOpen, onPickLocal, onDrive, soundBindings, coverCache, savedCoverUrls, trashNode, trashStatus, trashAnnounce, hasTrash, hasBookTrash, catalogNode, plantCatalog, shelfViewGesture, shelfZoom,
    get observer() { return observer; },
    get onViewportResize() { return onViewportResize; },
    get onVisualViewportChange() { return onVisualViewportChange; }, legacy:{
    returnViews,
    syncShelfZoom: () => shelfZoom.sync(),
  } };
  const shelfCtx = new shelfNative.RustShelfCtx(shelfParts);
  let shelfCtxLive = true;
  const shelfLifecycle = shelfCtx.lifecycleCallbacks();
  if (showActions) {
    root.append(buildActionBar());
    root.classList.add('ihr-bookshelf--with-actions');
  }
  container.append(root);
  // Opened straight in the diagonal view: leave the startup work first.
  prepareCatalogWhenIdle(6000);

  /* --------------------------- portadas --------------------------- */

  // Covers (their URLs, the reading of their colour and cloth, the refresh of the spines that show them) are the
  // shelf module's.
  function maybeRefreshAppearanceStyles() { if (shelfCtxLive) shelfCtx.maybeRefreshAppearanceStyles(); }

  // The style of a shelf item, the CSS variables of a style and their update on a node are the shelf module's.

  // El retorno desde el lector necesita su primer fotograma antes de que el
  // navegador pinte la estantería. La resolución normal usa `await` incluso
  // cuando la portada ya está en IndexedDB como Blob y deja un fotograma vacío.
  /** Precarga en pointerdown: cuando el giro enseña la cara, ya está pintada. */
  /* --------------------------- construcción --------------------------- */

  function buildActionBar() { return shelfCtx.buildActionBar(); }

  // The objects on the shelf (lamps, plants), the drag that moves them and the bin are the shelf module's.
  // The catalogue may answer after the shelf is gone: the original refused then, as busy.
  function addCatalogLamp(request, catalogOptions) {
    return shelfCtxLive ? shelfCtx.addCatalogLamp(request, catalogOptions) : Promise.reject(new Error('Espera a que termine la animación.'));
  }
  function addCatalogPlant(request, catalogOptions) {
    return shelfCtxLive ? shelfCtx.addCatalogPlant(request, catalogOptions) : Promise.reject(new Error('Espera a que termine la animación.'));
  }
  function finishSpineDrag(event, node, cancelled = false, activateTouch = false) { if (shelfCtxLive) shelfCtx.finishSpineDrag(event, node, cancelled, activateTouch); }
  function cancelTrashRemoval() { if (shelfCtxLive) shelfCtx.cancelTrashRemoval(); }
  function clearPlacementPreview(drag) { if (shelfCtxLive) shelfCtx.clearPlacementPreview(drag); }
  function shelfPadding() { return shelfCtx.shelfPadding(); }



  /* --------------------------- render --------------------------- */

  /**
   * Ancho útil de balda. `options.shelfWidth` lo fija a mano, para montar la
   * estantería en un contenedor de ancho conocido (o en tests sin layout).
   */
  function measure() { return shelfCtx.measure(); }

  /** Los lomos tienen su grosor real (15-45 mm) a la escala de la balda. */

  function setViewMode(mode) { if (shelfCtxLive) shelfLifecycle.setViewMode(mode); }


  // Rust owns the render transaction, rows and input bindings.

  function render() { if (shelfCtxLive) shelfCtx.render(); }

  function scheduleRender() { if (shelfCtxLive) shelfCtx.scheduleRender(); }

  function prepareInitialAppearances() { if (shelfCtxLive) shelfCtx.prepareInitialAppearances(); }

  /* --------------------------- apertura --------------------------- */

  // The lifted book (its pull-out, cover, editor, page preparation and hand-over to the reader) is the shelf module's.


  /* --------------------------- ciclo de vida --------------------------- */

  let observer = null;
  const onViewportResize = () => { if (shelfCtxLive) shelfLifecycle.viewportResize(); };
  const onVisualViewportChange = () => { if (shelfCtxLive) shelfLifecycle.visualViewportChange(); };
  window.addEventListener('resize', onViewportResize);
  window.visualViewport?.addEventListener('resize', onVisualViewportChange);
  window.visualViewport?.addEventListener('scroll', onVisualViewportChange);
  if (typeof ResizeObserver === 'function') {
    observer = new ResizeObserver(() => { if (shelfCtxLive) shelfLifecycle.observedResize(); });
    observer.observe(scroller);
  }

  prepareInitialAppearances();
  render();
  // The shared scene refreshes its own text textures when fonts arrive. Keep
  // its semantic buttons: rebuilding them here can detach a visible spine
  // between pointerdown/measurement and the following event. The legacy
  // canvas snapshots need only new artwork; DOM lettering reflows itself.
  refreshCanvasFontsAfterPaint(() => { if (shelfCtxLive) shelfLifecycle.refreshFonts(); });


  /** Refresh decisions and metadata adoption live in Rust; the host keeps the public option shape. */
  function refresh(nextBooks, { defer = false } = {}) {
    if (shelfCtxLive) shelfCtx.refresh(nextBooks, defer);
  }

  function clearCompatibilityTapRefresh() { if (shelfCtxLive) shelfLifecycle.clearCompatibilityTapRefresh(); }

  function deferCompatibilityTapRefresh() { if (shelfCtxLive) shelfLifecycle.deferCompatibilityTapRefresh(); }

  function applyDeferredShelfUpdates() { if (shelfCtxLive) shelfLifecycle.applyDeferredShelfUpdates(); }

  // Non-WebGL pages: the white-paper variant sits under the reader's own canvas,
  // which fades over it (opacity 0 = white paper, 1 = the reading theme).


  // A destroyed shelf has handed its context back; whatever a late callback asks of it is then moot.
  function setReturningBook(bookId) { if (shelfCtxLive) shelfCtx.setReturningBook(bookId); }
  function finishReturnSlot(ready) { if (shelfCtxLive) shelfCtx.finishReturnSlot(Boolean(ready)); }

  return {
    element: root,
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
      shelfNative.shelf_destroy_dispatch(shelfParts, shelfCtxLive ? shelfLifecycle.destroy : null);
      if (shelfCtxLive) { shelfCtxLive = false; shelfCtx.free(); }
    }
  };
}

export default renderBookshelf;
