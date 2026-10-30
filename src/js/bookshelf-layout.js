import { core, tables, scratch, scratchPointer } from './catalogue-core.js';
import { bookDataModule } from './book-data-native.js';

/**
 * bookshelf-layout.js — la estantería del home de Inhouse Read.
 *
 * Sin DOM. Las decisiones (hash determinista, estilo del lomo, empaquetado en
 * baldas con macetas, secciones de la biblioteca y marcapáginas) las toma el
 * núcleo Rust (rust-core/src/shelf_layout.rs); las peticiones y los objetos
 * que consume `bookshelf.js` los arma el módulo Rust de la estantería.
 */

export const SPINE_PALETTE = Object.freeze(tables.spinePalette);
/** Acabados del lomo. Cambian sólo la decoración, nunca la geometría. */
export const SPINE_TEXTURES = Object.freeze(tables.spineTextures);
export const DEFAULT_SPINE = Object.freeze(tables.defaults.spine);
export const DEFAULT_LAYOUT = Object.freeze({
  ...tables.defaults.layout,
  spine: undefined,      // opciones para spineStyleFor
  plantWidthFor: null,   // ancho real de cada especie: (variante) => px
  displayWidthFor: null  // ancho de celda distinto del grosor físico, si hace falta
});
export const DEFAULT_SECTIONS = Object.freeze(tables.defaults.sections);
export const DEFAULT_BOOKMARK = Object.freeze(tables.defaults.bookmark);

/**
 * Mezcla opciones sobre sus valores por defecto ignorando las que vienen como
 * `undefined`: con el spread a pelo, `{...DEFAULTS, ...{limite: undefined}}`
 * borra el valor por defecto en cuanto alguien reenvía opciones sin rellenar.
 */
export function withDefaults(defaults, options) {
  const merged = { ...defaults };
  if (!options) return merged;
  for (const [key, value] of Object.entries(options)) {
    if (value !== undefined) merged[key] = value;
  }
  return merged;
}

/**
 * Semilla estable de un libro. Se prefiere el id del store (`local:name:size`
 * o `drive:fileId`), que sobrevive a renombrados de la entrada de biblioteca.
 */
export function seedFor(book) {
  return bookDataModule().book_seed_for(book);
}

const progressRaw = book => Number(book?.progressFraction ?? book?.progress);

/** Progreso 0..1 del libro, aceptando los dos nombres que circulan. */
export const progressOf = book => core.progress_of(progressRaw(book));

/** Un libro "en curso" es el que se ha empezado y no se ha terminado. */
export const isInProgress = book => core.book_in_progress(progressRaw(book), book?.lastOpenedAt != null ? 1 : 0) === 1;

/**
 * Marcapáginas de un libro, o `null` si no hay nada que marcar. Una posición
 * guardada en la primera página también necesita su cinta, aunque avance 0%.
 * @returns {{progress:number, percent:number, peek:number, finished:boolean}|null}
 */
export function bookmarkFor(book, options = {}) {
  const cfg = withDefaults(DEFAULT_BOOKMARK, options);
  if (core.bookmark_for(progressRaw(book), book?.locator ? 1 : 0, cfg.minPeek, cfg.maxPeek, scratchPointer) !== 1) return null;
  const [progress, percent, peek, finished] = scratch();
  return { progress, percent, peek, finished: finished === 1 };
}

// The spine styles, the packing into shelves, the sections and the plan are requested by the
// Rust UI/shelf module (rust-ui/src/shelf_layout_host.rs): it reads the books and options, calls
// the callbacks below with the same arguments, writes this core's arena, calls its kernels and
// builds these same objects. `Intl.Collator` still sorts the sections.
const layoutHost = { core, palette: SPINE_PALETTE, textures: SPINE_TEXTURES, spine: DEFAULT_SPINE,
  layout: DEFAULT_LAYOUT, sections: DEFAULT_SECTIONS };

/**
 * Estilo del lomo de cada libro: determinista respecto a `seedFor(book)`. El
 * grosor usa el total de palabras normalizado a una convención física de
 * papel, sin depender de páginas, compresión, imágenes o ID.
 * @returns {Array<{seed:string, palette:object, color:string, shade:string, ink:string,
 *            width:number, heightRatio:number, texture:string}>}
 */
export function spineStylesFor(books, options = {}) { return bookDataModule().shelf_spine_styles(layoutHost, books, options); }

/** Aspecto del lomo de un libro; `options` sobrescribe DEFAULT_SPINE (p.ej. escalado móvil). */
export const spineStyleFor = (book, options = {}) => spineStylesFor([book], options)[0];

/**
 * Empaqueta los libros en baldas de anchura fija, intercalando macetas: los
 * libros mantienen el orden recibido, una maceta cada `plantEvery` libros si
 * caben ella y el siguiente, una o dos de remate en la balda a medias, y el
 * último libro de una balda con hueco se inclina.
 *
 * @param {object[]} books
 * @param {object} [options] ver DEFAULT_LAYOUT
 * @param {object[]} [preparedStyles] estilos ya calculados, uno por libro
 * @returns {Array<{index:number, items:object[], usedWidth:number, freeWidth:number, width:number}>}
 */
export function layoutShelves(books, options = {}, preparedStyles) {
  return bookDataModule().shelf_layout_shelves(layoutHost, books, options, preparedStyles);
}

/**
 * Parte la biblioteca en secciones ("seguir leyendo" y biblioteca). Un libro
 * aparece en una sola sección. El orden y la partición los decide el núcleo;
 * el orden alfabético por autor/título lo da `Intl.Collator`.
 * @returns {Array<{id:string, title:string, books:object[]}>}
 */
export function buildSections(books, options = {}) { return bookDataModule().shelf_sections(layoutHost, books, options); }

/**
 * Atajo: biblioteca completa -> secciones ya empaquetadas en baldas.
 * @returns {Array<{id:string, title:string, count:number, shelves:object[]}>}
 */
export function planBookshelf(books, options = {}, prepareStyles) {
  return bookDataModule().shelf_plan_bookshelf(layoutHost, books, options, prepareStyles);
}
