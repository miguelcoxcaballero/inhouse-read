import * as cozySounds from './cozy-sounds.js';
import * as cloudSettings from './cloud-settings.js';
import * as storagePolicy from './book-storage-policy.js';
/**
 * bookshelf.js — home screen de Inhouse Read: una estantería con plantas. El componente vive en
 * rust-ui/src/bookshelf (qué es y sus decisiones de diseño, en mod.rs), su handle incluido; aquí queda su API.
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

import * as spineStyles from './spine-styles.js';
import * as layout from './bookshelf-layout.js';
import * as metadataRecords from './shelf-metadata-records.js';
import * as coverAppearance from './cover-appearance.js';
import * as bookColors from './book-colors.js';
import * as bookTitle from './book-title.js';
import * as bookModel from './book-model.js';
import * as coverRelief from './cover-relief.js';
import * as shelfZoom from './shelf-zoom.js';
import * as viewGesture from './shelf-view-gesture.js';
import * as perfMarks from './perf-marks.js';
import * as scene from './bookshelf-scene.js';
import {warmShelfCover,loadedShelfCover} from './book-cover-images.js';
import {prepareShelfFonts} from './shelf-startup-resources.js';
import * as canvasFonts from './canvas-font-readiness.js';
import * as bookshelfReturn from './bookshelf-return.js';
import * as returnCanvas from './reader-return-canvas.js';
import * as decorationLayout from './shelf-decoration-layout.js';
import * as rustCore from './rust-core.js';
import * as placementPreview from './shelf-placement-preview.js';
import * as placementWasm from './shelf-placement-wasm.js';
import * as plantCatalogLazy from './plant-catalog-lazy.js';
import * as shelfTypes from './shelf-types.js';
import * as modelLayout from './shelf-model-layout.js';
import * as rooftop from './plant-rooftop-layout.js';
import * as plantCatalogData from './plant-catalog-data.js';
import * as plantRecords from './plant-records.js';
import * as plantDimensions from './plant-dimensions.js';
import * as lampCatalogData from './lamp-catalog-data.js';
import * as lampIllustration from './lamp-illustration.js';
import * as bookTiming from './reader-book-timing.js';
import * as persistable from './readers/persistable-position.js';
import { needRustShelf } from './rust-shelf.js';



export const DEFAULT_TEXTS = Object.freeze({
  shelfLabel: 'Estantería',
  emptyTitle: 'Sin libros',
  emptyBody: '',
  addLocal: 'Añadir libro',
  addDrive: 'Drive',
  emptyAction: 'Añadir libro',
  openAction: 'Abrir',
  tapCover: (book) => `Toca para leer ${bookTitle.displayBookTitle(book) || 'este libro'}`,
  closeAction: 'Cerrar',
  noCover: 'Sin portada',
  openAria: (book) =>
      book.author ? `Abrir ${bookTitle.displayBookTitle(book)}, de ${bookTitle.normalizeBookAuthor(book.author)}` : `Abrir ${bookTitle.displayBookTitle(book)}`,
  progressAria: (percent) => (percent >= 100 ? 'terminado' : `leído al ${percent} %`)
});


// The modules whose functions the shelf module's parts call, and the host's own entries: the lookup table is
// built from them by rust-ui/src/bookshelf/mount.rs (shelf_env), each entry read when it is used (a module
// replaced after the shelf was built is still the one called).
const shelfModules = { cozySounds, cloudSettings, storagePolicy, spineStyles, layout, metadataRecords, coverAppearance, bookColors,
  bookTitle, bookModel, coverRelief, shelfZoom, viewGesture, perfMarks, scene, canvasFonts, bookshelfReturn, returnCanvas,
  decorationLayout, rustCore, placementPreview, placementWasm, plantCatalogLazy, shelfTypes, modelLayout, rooftop, plantCatalogData,
  plantRecords, plantDimensions, lampCatalogData, lampIllustration, bookTiming, persistable };
const shelfOwn = {
  physicalPlacement: scene.createBookshelfScene.physicalPlacement === true,
  analyzeCoverAppearance: (url,title,options) => {
    const image = loadedShelfCover(url);
    return image ? coverAppearance.analyzeCoverAppearance(url,title,{...options,image})
      : options === undefined ? coverAppearance.analyzeCoverAppearance(url,title) : coverAppearance.analyzeCoverAppearance(url,title,options);
  },
  warmShelfCover,
  prepareShelfFonts
};
let shelfEnv = null;

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
  shelfEnv ||= shelfNative.shelf_env(shelfModules, shelfOwn);
  // The set-up (merged options, shared state, frame, view swipe and pinch zoom, plant catalogue, page
  // listeners, first render) and the public handle are rust-ui/src/bookshelf/mount.rs.
  return shelfNative.shelf_handle(shelfNative.shelf_mount(shelfEnv, container, booksOrOptions, maybeOptions, DEFAULT_TEXTS), shelfNative);
}

export default renderBookshelf;
