/**
 * bookshelf-layout.js — lógica pura de la estantería del home de Inhouse Read.
 *
 * Aquí no se toca el DOM: sólo matemáticas deterministas. El renderizador
 * (`bookshelf.js`) consume estas funciones, y los tests las ejercitan sin
 * navegador.
 *
 * Responsabilidades:
 *   1. Hash determinista de un libro -> aspecto de su lomo (color, grosor,
 *      altura, textura). Mismo libro = mismo lomo siempre, en cualquier
 *      dispositivo y entre sesiones, sin persistir nada extra en el store.
 *   2. Empaquetado de lomos en baldas de anchura fija, intercalando macetas.
 *   3. Agrupación de la biblioteca en secciones (seguir leyendo / biblioteca).
 *
 * Trabaja sobre el `BookRecord` de `library-store.js` (id, title, author,
 * format, cover, lastOpenedAt, progressFraction...) y tolera campos
 * opcionales que hoy no existen pero abaratan el realismo si algún día se
 * extraen del fichero: `pageCount` y `sizeBytes`.
 */

/* ------------------------------------------------------------------ *
 * Hash determinista
 * ------------------------------------------------------------------ */

/**
 * FNV-1a de 32 bits. Rápido, sin dependencias y con buena dispersión para
 * cadenas cortas como títulos de libros.
 * @param {string} value
 * @returns {number} entero sin signo de 32 bits
 */
export function hashString(value) {
  const text = String(value ?? '');
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/**
 * Número en [0, 1) derivado de una semilla y una "sal". Usar sales distintas
 * ("palette", "width"...) da flujos independientes desde la misma semilla,
 * sin arrastrar estado entre llamadas.
 * @param {string|number} seed
 * @param {string} salt
 * @returns {number}
 */
export function unit(seed, salt) {
  return hashString(`${seed}::${salt}`) / 0x100000000;
}

/**
 * Elige un elemento de una lista de forma determinista.
 * @template T
 * @param {readonly T[]} list
 * @param {string|number} seed
 * @param {string} salt
 * @returns {T|undefined}
 */
export function pick(list, seed, salt) {
  if (!list || list.length === 0) return undefined;
  return list[Math.floor(unit(seed, salt) * list.length) % list.length];
}

/**
 * Semilla estable de un libro. Se prefiere el id del store (`local:name:size`
 * o `drive:fileId`), que sobrevive a renombrados de la entrada de biblioteca.
 * @param {object} book
 * @returns {string}
 */
export function seedFor(book) {
  if (!book) return '';
  if (book.id != null && book.id !== '') return String(book.id);
  if (book.path) return String(book.path);
  return `${book.title ?? ''}|${book.author ?? ''}`;
}

/** Progreso 0..1 del libro, aceptando los dos nombres que circulan. */
export function progressOf(book) {
  const value = Number(book?.progressFraction ?? book?.progress);
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/* ------------------------------------------------------------------ *
 * Paleta de lomos
 * ------------------------------------------------------------------ */

/**
 * Colores de tela de encuadernación. No son colores de marca: la marca es el
 * verde de acento y la madera de la balda. Estos son "los libros de otra
 * gente", por eso conviven tonos que no salen del sistema de Inhouse.
 * `ink` es el color de texto legible sobre `base` (contraste >= 4.5:1).
 */
export const SPINE_PALETTE = Object.freeze([
  { name: 'burdeos',       base: '#7A2E38', shade: '#5B1F28', ink: '#F2E6D8' },
  { name: 'verde-botella', base: '#2F5D4A', shade: '#204237', ink: '#EDE7D6' },
  { name: 'azul-noche',    base: '#2B3F63', shade: '#1E2C48', ink: '#E8E8EF' },
  { name: 'ocre',          base: '#B8862F', shade: '#8E6520', ink: '#2A1F0C' },
  { name: 'terracota',     base: '#A9542F', shade: '#833C20', ink: '#F6E7DC' },
  { name: 'ciruela',       base: '#5A3555', shade: '#402440', ink: '#EEE2EE' },
  { name: 'oliva',         base: '#6B7A45', shade: '#4E5B31', ink: '#F3F1E2' },
  { name: 'arena',         base: '#D6C3A0', shade: '#B9A279', ink: '#3B3022' },
  { name: 'pizarra',       base: '#46515A', shade: '#323A41', ink: '#E5EAEE' },
  { name: 'oxido',         base: '#8C4A2F', shade: '#6A3520', ink: '#F4E3D6' },
  { name: 'crema',         base: '#EDE4D3', shade: '#D3C6AE', ink: '#3A3328' },
  { name: 'tinta',         base: '#2A2A2E', shade: '#19191C', ink: '#E0DCD2' }
]);

/** Acabados del lomo. Cambian sólo la decoración, nunca la geometría. */
export const SPINE_TEXTURES = Object.freeze(['plain', 'bands', 'panel', 'ribbed']);

export const DEFAULT_SPINE = Object.freeze({
  minWidth: 28,     // px — mínimo cómodo para el dedo junto al padding de acierto
  maxWidth: 54,
  minHeightRatio: 0.80,
  maxHeightRatio: 1.0,
  jitter: 2.5       // px de ruido sobre el grosor derivado de páginas/peso
});

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

/**
 * Mezcla opciones sobre sus valores por defecto ignorando las que vienen como
 * `undefined`. Con el spread a pelo, `{...DEFAULTS, ...{limite: undefined}}`
 * deja `limite` en undefined y se lleva por delante el valor por defecto:
 * pasa en cuanto alguien reenvía opciones que no ha rellenado.
 * @template T
 * @param {T} defaults
 * @param {object} [options]
 * @returns {T}
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
 * Interpola en escala raíz: la diferencia entre 40 y 200 páginas se nota más
 * que entre 700 y 900, igual que al mirar una estantería real.
 * @returns {number|null} 0..1, o null si el dato no sirve
 */
function sqrtScale(value, from, to) {
  if (!Number.isFinite(value) || value <= 0) return null;
  const a = Math.sqrt(from);
  const b = Math.sqrt(to);
  return clamp((Math.sqrt(value) - a) / (b - a), 0, 1);
}

/**
 * Aspecto del lomo de un libro. Determinista respecto a `seedFor(book)`.
 *
 * El grosor usa datos reales cuando existen (`pageCount`, si no `sizeBytes`)
 * porque un tocho debe verse como un tocho; cuando no hay ninguno cae al
 * hash. En el caso con datos se añade un jitter determinista para que dos
 * libros de 300 páginas no salgan clavados.
 *
 * @param {object} book
 * @param {object} [options] sobrescribe DEFAULT_SPINE (p.ej. escalado móvil)
 * @returns {{seed:string, palette:object, color:string, shade:string, ink:string,
 *            width:number, heightRatio:number, texture:string}}
 */
export function spineStyleFor(book, options = {}) {
  const cfg = withDefaults(DEFAULT_SPINE, options);
  const seed = seedFor(book);
  const palette = pick(SPINE_PALETTE, seed, 'palette');
  const span = cfg.maxWidth - cfg.minWidth;

  let ratio = sqrtScale(book?.pageCount, 40, 900);
  if (ratio == null) ratio = sqrtScale(book?.sizeBytes, 200 * 1024, 12 * 1024 * 1024);

  let width;
  if (ratio == null) {
    width = cfg.minWidth + span * unit(seed, 'width');
  } else {
    const jitter = (unit(seed, 'jitter') - 0.5) * 2 * cfg.jitter;
    width = cfg.minWidth + span * ratio + jitter;
  }

  const heightRatio =
    cfg.minHeightRatio +
    (cfg.maxHeightRatio - cfg.minHeightRatio) * unit(seed, 'height');

  return {
    seed,
    palette,
    color: palette.base,
    shade: palette.shade,
    ink: palette.ink,
    width: Math.round(clamp(width, cfg.minWidth, cfg.maxWidth)),
    heightRatio: Math.round(heightRatio * 1000) / 1000,
    texture: pick(SPINE_TEXTURES, seed, 'texture')
  };
}

/* ------------------------------------------------------------------ *
 * Empaquetado en baldas
 * ------------------------------------------------------------------ */

export const DEFAULT_LAYOUT = Object.freeze({
  shelfWidth: 360,   // anchura total de la balda, en px
  padding: 16,       // margen interior a cada lado (los topes de la balda)
  gap: 3,            // separación entre lomos
  plantEvery: 5,     // tras N libros seguidos sin maceta, se cuela una. Con
                     // baldas de 6-7 lomos en móvil, 5 deja casi una planta
                     // por balda: menos y parece un vivero, más y las baldas
                     // llenas se vuelven un muro de lomos iguales
  plantWidth: 58,    // ancho reservado a una maceta (un tiesto es más ancho
                     // que un lomo: si se queda en 46 parece de juguete)
  maxTailPlants: 2,  // macetas de remate en una balda a medias
  plantVariants: ['monstera', 'sansevieria', 'pothos', 'cactus', 'suculenta'],
  tiltThreshold: 16, // px de hueco libre necesarios para que un libro se incline
  maxTilt: 8,        // grados
  spine: undefined   // opciones para spineStyleFor
});

function createShelf(index) {
  return { index, items: [], usedWidth: 0, freeWidth: 0, width: 0 };
}

/**
 * Empaqueta los libros en baldas de anchura fija, intercalando macetas.
 *
 * Reglas (todas deterministas, sin azar):
 *  - Los libros mantienen el orden recibido; nunca se pierde ni se duplica uno.
 *  - Cada `plantEvery` libros sin maceta se inserta una, siempre que quepan
 *    ella y el libro siguiente (una maceta no deja huérfano al libro que va
 *    detrás, que acabaría solo al principio de la balda siguiente).
 *  - Al cerrar una balda, si sobra sitio para una maceta, se pone de remate.
 *    Como el empaquetado es voraz, el sobrante suele ser menor que una maceta:
 *    el "de vez en cuando" sale solo, sin necesidad de aleatoriedad.
 *  - El último libro de una balda puede inclinarse si queda hueco y no hay
 *    maceta de remate, como un libro real sin sujetalibros.
 *
 * @param {object[]} books
 * @param {object} [options] ver DEFAULT_LAYOUT
 * @returns {Array<{index:number, items:object[], usedWidth:number, freeWidth:number, width:number}>}
 */
export function layoutShelves(books, options = {}) {
  const cfg = withDefaults(DEFAULT_LAYOUT, options);
  const available = cfg.shelfWidth - cfg.padding * 2;
  if (!Array.isArray(books) || books.length === 0) return [];
  if (!(available > 0)) return [];

  const shelves = [];
  let shelf = createShelf(0);
  let sinceLastPlant = 0;

  /** Coste de añadir un elemento de ancho `w` al estante actual (con su hueco). */
  const costOf = (w) => (shelf.items.length === 0 ? w : cfg.gap + w);

  const push = (item) => {
    shelf.usedWidth += costOf(item.width);
    shelf.items.push(item);
  };

  const plantItem = (salt) => {
    const seed = `shelf-${shelf.index}-${shelf.items.length}-${salt}`;
    // Dos macetas pegadas no pueden ser la misma planta: canta a copia-pega.
    const previous = shelf.items.at(-1);
    const catalogue =
      previous?.kind === 'plant' && cfg.plantVariants.length > 1
        ? cfg.plantVariants.filter((variant) => variant !== previous.variant)
        : cfg.plantVariants;
    return {
      kind: 'plant',
      variant: pick(catalogue, seed, 'variant'),
      width: cfg.plantWidth,
      seed
    };
  };

  const closeShelf = () => {
    if (shelf.items.length === 0) return;
    const roomLeft = available - shelf.usedWidth;
    const last = shelf.items[shelf.items.length - 1];

    if (roomLeft >= cfg.plantWidth + cfg.gap) {
      // Una balda a medias (la última, normalmente) se remata con una o dos
      // macetas: un hueco pelado de media balda parece un error de pintado.
      for (let i = 0; i < cfg.maxTailPlants; i += 1) {
        if (available - shelf.usedWidth < cfg.plantWidth + cfg.gap) break;
        push(plantItem(`tail-${i}`));
      }
      sinceLastPlant = 0;
    } else if (
      last.kind === 'book' &&
      roomLeft >= cfg.tiltThreshold &&
      unit(last.style.seed, 'tilt') > 0.5
    ) {
      // Sin nada que lo sujete a la derecha: se vence hacia el hueco.
      last.tilt =
        Math.round((2 + unit(last.style.seed, 'tilt-deg') * (cfg.maxTilt - 2)) * 10) / 10;
    }

    shelf.width = cfg.shelfWidth;
    shelf.freeWidth = Math.max(0, available - shelf.usedWidth);
    shelves.push(shelf);
  };

  for (const book of books) {
    const style = spineStyleFor(book, cfg.spine);
    const item = { kind: 'book', book, style, width: style.width, tilt: 0 };

    // ¿Toca maceta intercalada? Sólo si caben la maceta y el libro siguiente.
    if (
      sinceLastPlant >= cfg.plantEvery &&
      shelf.items.length > 0 &&
      shelf.usedWidth + cfg.gap + cfg.plantWidth + cfg.gap + item.width <= available
    ) {
      push(plantItem('mid'));
      sinceLastPlant = 0;
    }

    if (shelf.items.length > 0 && shelf.usedWidth + costOf(item.width) > available) {
      closeShelf();
      shelf = createShelf(shelves.length);
    }

    push(item);
    sinceLastPlant += 1;
  }

  closeShelf();
  return shelves;
}

/* ------------------------------------------------------------------ *
 * Secciones de la biblioteca
 * ------------------------------------------------------------------ */

export const DEFAULT_SECTIONS = Object.freeze({
  recentLimit: 6,
  recentTitle: 'Seguir leyendo',
  libraryTitle: 'Biblioteca',
  sort: 'author' // 'author' | 'title' | 'none'
});

const collator = new Intl.Collator('es', { sensitivity: 'base', numeric: true });

function sortBooks(books, mode) {
  if (mode === 'none') return books;
  const keyed = books.map((book, index) => ({ book, index }));
  keyed.sort((a, b) => {
    const byAuthor =
      mode === 'author' ? collator.compare(a.book.author ?? '', b.book.author ?? '') : 0;
    if (byAuthor !== 0) return byAuthor;
    const byTitle = collator.compare(a.book.title ?? '', b.book.title ?? '');
    if (byTitle !== 0) return byTitle;
    return a.index - b.index; // orden estable ante empates
  });
  return keyed.map((entry) => entry.book);
}

/** Un libro "en curso" es el que se ha empezado y no se ha terminado. */
export function isInProgress(book) {
  const raw = Number(book?.progressFraction ?? book?.progress);
  if (Number.isFinite(raw)) {
    if (raw > 0 && raw < 1) return true;
    if (raw === 0) return false; // añadido pero nunca abierto
    return false;                // terminado: vuelve a la balda general
  }
  return book?.lastOpenedAt != null;
}

/**
 * Parte la biblioteca en secciones. Un libro aparece en una sola sección: una
 * estantería real no tiene el mismo tomo en dos baldas, y duplicarlo haría
 * dudar de si son dos ficheros distintos.
 *
 * @param {object[]} books
 * @param {object} [options] ver DEFAULT_SECTIONS
 * @returns {Array<{id:string, title:string, books:object[]}>}
 */
export function buildSections(books, options = {}) {
  const cfg = withDefaults(DEFAULT_SECTIONS, options);
  const list = Array.isArray(books) ? books.filter(Boolean) : [];
  if (list.length === 0) return [];

  const recent = list
    .filter(isInProgress)
    .map((book, index) => ({ book, index }))
    .sort((a, b) => {
      const diff = (Number(b.book.lastOpenedAt) || 0) - (Number(a.book.lastOpenedAt) || 0);
      return diff !== 0 ? diff : a.index - b.index;
    })
    .slice(0, cfg.recentLimit)
    .map((entry) => entry.book);

  const recentSet = new Set(recent);
  const rest = sortBooks(list.filter((book) => !recentSet.has(book)), cfg.sort);

  const sections = [];
  if (recent.length > 0) {
    sections.push({ id: 'recent', title: cfg.recentTitle, books: recent });
  }
  if (rest.length > 0) {
    sections.push({
      id: 'library',
      // Si es la única balda no hace falta titularla: ya se ve que es todo.
      title: sections.length === 0 ? '' : cfg.libraryTitle,
      books: rest
    });
  }
  return sections;
}

/**
 * Atajo: biblioteca completa -> secciones ya empaquetadas en baldas.
 * @param {object[]} books
 * @param {object} [options] mezcla de DEFAULT_SECTIONS y DEFAULT_LAYOUT
 * @returns {Array<{id:string, title:string, count:number, shelves:object[]}>}
 */
export function planBookshelf(books, options = {}) {
  return buildSections(books, options).map((section) => ({
    id: section.id,
    title: section.title,
    count: section.books.length,
    shelves: layoutShelves(section.books, options)
  }));
}
