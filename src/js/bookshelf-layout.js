import { core, tables, scratch, scratchPointer, inArena, f64View } from './catalogue-core.js';

/**
 * bookshelf-layout.js — la estantería del home de Inhouse Read.
 *
 * Sin DOM. Las decisiones (hash determinista, estilo del lomo, empaquetado en
 * baldas con macetas, secciones de la biblioteca y marcapáginas) las toma el
 * núcleo Rust (rust-core/src/shelf_layout.rs); aquí sólo se extraen números de
 * los `BookRecord` de `library-store.js` y se montan los objetos que consume
 * `bookshelf.js`.
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
  if (!book) return '';
  if (book.id != null && book.id !== '') return String(book.id);
  if (book.path) return String(book.path);
  return `${book.title ?? ''}|${book.author ?? ''}`;
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

const unitWords = total => Math.ceil(total / 4);
/** Writes `texts` as UTF-16 units into the arena and returns their offsets. */
function writeSeeds(pointer, at, texts) {
  const offsets = new Float64Array(texts.length + 1);
  let total = 0;
  for (let i = 0; i < texts.length; i++) { offsets[i] = total; total += texts[i].length; }
  offsets[texts.length] = total;
  const units = new Uint16Array(core.memory.buffer, pointer + at * 8, total);
  let cursor = 0;
  for (const text of texts) for (let i = 0; i < text.length; i++) units[cursor++] = text.charCodeAt(i);
  return offsets;
}

/**
 * Estilo del lomo de cada libro: determinista respecto a `seedFor(book)`. El
 * grosor usa el total de palabras normalizado a una convención física de
 * papel, sin depender de páginas, compresión, imágenes o ID.
 * @returns {Array<{seed:string, palette:object, color:string, shade:string, ink:string,
 *            width:number, heightRatio:number, texture:string}>}
 */
export function spineStylesFor(books, options = {}) {
  const cfg = withDefaults(DEFAULT_SPINE, options);
  const seeds = books.map(seedFor), count = seeds.length;
  const total = seeds.reduce((sum, seed) => sum + seed.length, 0);
  return inArena([7, count, count + 1, count * 5, unitWords(total)], (pointer, at) => {
    f64View(pointer, at[0], 7).set([cfg.minWidth, cfg.maxWidth, cfg.minHeightRatio, cfg.maxHeightRatio,
      typeof cfg.pageThickness === 'number' ? cfg.pageThickness : NaN, cfg.pageThickness ? 1 : 0, cfg.bindingThickness || 0]);
    const words = f64View(pointer, at[1], count);
    books.forEach((book, i) => { words[i] = typeof book?.wordCount === 'number' ? book.wordCount : NaN; });
    f64View(pointer, at[2], count + 1).set(writeSeeds(pointer, at[4], seeds));
    if (core.spine_styles(pointer + at[0] * 8, pointer + at[1] * 8, pointer + at[2] * 8, pointer + at[4] * 8, count, total,
      pointer + at[3] * 8) !== 1) throw new RangeError('Shelf layout: spine styles rejected');
    const out = f64View(pointer, at[3], count * 5);
    return seeds.map((seed, i) => {
      const palette = SPINE_PALETTE[out[i * 5]];
      return { seed, palette, color: palette.base, shade: palette.shade, ink: palette.ink, width: out[i * 5 + 2],
        heightRatio: out[i * 5 + 3], texture: SPINE_TEXTURES[out[i * 5 + 1]] };
    });
  });
}

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
  const cfg = withDefaults(DEFAULT_LAYOUT, options);
  if (!Array.isArray(books) || books.length === 0) return [];
  if (!(cfg.shelfWidth - cfg.padding * 2 > 0)) return [];

  const count = books.length;
  const styles = [], requested = [];
  books.forEach((book, i) => {
    const style = preparedStyles?.[i] ?? spineStyleFor(book, cfg.spine);
    styles.push(style);
    requested.push(typeof cfg.displayWidthFor === 'function' ? Number(cfg.displayWidthFor(book, style)) : NaN);
  });

  // Cada especie ocupa su tamaño real (`plantWidthFor`); sin él, un ancho fijo.
  const variants = cfg.plantVariants;
  const widthOf = variant => cfg.plantWidthFor?.(variant) ?? cfg.plantWidth;
  const keys = variants.map(variant => variants.indexOf(variant));
  const absent = variants.length === 0 || variants.length > 1 && new Set(keys).size === 1 ? widthOf(undefined) : cfg.plantWidth;
  const seeds = styles.map(style => String(style.seed));
  const total = seeds.reduce((sum, seed) => sum + seed.length, 0);

  const run = capacity => inArena([9, variants.length, variants.length, count, count, count + 1, unitWords(total), capacity],
    (pointer, at) => {
      f64View(pointer, at[0], 9).set([cfg.shelfWidth, cfg.padding, cfg.gap, cfg.plantEvery, cfg.plantWidth, cfg.maxTailPlants,
        cfg.tiltThreshold, cfg.maxTilt, absent]);
      f64View(pointer, at[1], variants.length).set(variants.map(widthOf));
      f64View(pointer, at[2], variants.length).set(keys);
      f64View(pointer, at[3], count).set(styles.map(style => style.width));
      f64View(pointer, at[4], count).set(requested);
      f64View(pointer, at[5], count + 1).set(writeSeeds(pointer, at[6], seeds));
      const length = core.layout_shelves(pointer + at[0] * 8, pointer + at[1] * 8, pointer + at[2] * 8, variants.length,
        pointer + at[3] * 8, pointer + at[4] * 8, pointer + at[5] * 8, pointer + at[6] * 8, count, total,
        pointer + at[7] * 8, capacity);
      if (length === 0) throw new RangeError('Shelf layout: request rejected');
      return length > capacity ? length : Array.from(f64View(pointer, at[7], length));
    });
  let plan = run(2 + count * 3 + (count * 2 + 16) * 6);
  if (typeof plan === 'number') plan = run(plan);

  const [shelfCount] = plan;
  const shelves = [];
  let item = 2 + shelfCount * 3;
  for (let index = 0; index < shelfCount; index++) {
    const [itemCount, usedWidth, freeWidth] = plan.slice(2 + index * 3, 5 + index * 3);
    const items = [];
    for (let n = 0; n < itemCount; n++, item += 6) {
      const [plant, refer, width, tilt, position, salt] = plan.slice(item, item + 6);
      items.push(plant
        ? { kind: 'plant', variant: refer < 0 ? undefined : variants[refer], width, seed: `shelf-${index}-${position}-${salt === 0 ? 'mid' : `tail-${salt - 1}`}` }
        : { kind: 'book', book: books[refer], style: styles[refer], width, displayWidth: width, tilt });
    }
    shelves.push({ index, items, usedWidth, freeWidth, width: cfg.shelfWidth });
  }
  return shelves;
}

// Created on the first sort that needs it: building it at import loads the
// locale's collation data on the start-up path, and the app's shelf keeps its
// own order ('none').
let collator = null;
const compareText = (a, b) => (collator ??= new Intl.Collator('es', { sensitivity: 'base', numeric: true })).compare(a, b);

/**
 * Parte la biblioteca en secciones ("seguir leyendo" y biblioteca). Un libro
 * aparece en una sola sección. El orden y la partición los decide el núcleo;
 * el orden alfabético por autor/título necesita `Intl.Collator`, así que se
 * le entrega ya como posición de cada libro.
 * @returns {Array<{id:string, title:string, books:object[]}>}
 */
export function buildSections(books, options = {}) {
  const cfg = withDefaults(DEFAULT_SECTIONS, options);
  const list = Array.isArray(books) ? books.filter(Boolean) : [];
  if (list.length === 0) return [];
  const count = list.length, mode = cfg.sort === 'none' ? 0 : cfg.sort === 'author' ? 1 : 2;
  const rank = new Float64Array(count);
  if (mode) {
    const order = list.map((_, index) => index).sort((a, b) =>
      (mode === 1 ? compareText(list[a].author ?? '', list[b].author ?? '') : 0)
      || compareText(list[a].title ?? '', list[b].title ?? '') || a - b);
    order.forEach((index, position) => { rank[index] = position; });
  }
  const first = new Map();
  const [recent, rest] = inArena([2, count * 5, count, count + 2], (pointer, at) => {
    f64View(pointer, at[0], 2).set([Number(cfg.recentLimit), mode]);
    const data = f64View(pointer, at[1], count * 5), groups = f64View(pointer, at[2], count);
    list.forEach((book, i) => {
      if (!first.has(book)) first.set(book, i);
      groups[i] = first.get(book);
      data.set([progressRaw(book), book.lastOpenedAt != null ? 1 : 0, Number(book.lastOpenedAt) || 0,
        Number.isFinite(book.shelfOrder) ? book.shelfOrder : Infinity, rank[i]], i * 5);
    });
    const length = core.library_sections(pointer + at[0] * 8, pointer + at[1] * 8, pointer + at[2] * 8, count, pointer + at[3] * 8);
    if (length === 0) throw new RangeError('Shelf sections: request rejected');
    const out = f64View(pointer, at[3], length);
    return [Array.from(out.subarray(2, 2 + out[0]), i => list[i]), Array.from(out.subarray(2 + out[0], length), i => list[i])];
  });

  const sections = [];
  if (recent.length > 0) sections.push({ id: 'recent', title: cfg.recentTitle, books: recent });
  if (rest.length > 0) {
    // Si es la única balda no hace falta titularla: ya se ve que es todo.
    sections.push({ id: 'library', title: sections.length === 0 ? '' : cfg.libraryTitle, books: rest });
  }
  return sections;
}

/**
 * Atajo: biblioteca completa -> secciones ya empaquetadas en baldas.
 * @returns {Array<{id:string, title:string, count:number, shelves:object[]}>}
 */
export function planBookshelf(books, options = {}, prepareStyles) {
  return buildSections(books, options).map((section) => ({
    id: section.id,
    title: section.title,
    count: section.books.length,
    shelves: layoutShelves(section.books, options, typeof prepareStyles === 'function' ? prepareStyles(section.books, options?.spine) : undefined)
  }));
}
