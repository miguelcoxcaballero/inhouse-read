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
 * 2. Madera y baldas. La balda es CSS puro (gradientes repetidos con veta y
 *    canto frontal), no una imagen: pesa cero, escala a cualquier ancho y
 *    responde al tema. Los lomos apoyan sobre el canto con una sombra de
 *    contacto corta, que es lo que vende el "están de pie ahí".
 *
 * 3. Lomos deterministas. Color, grosor, altura y acabado salen de un hash
 *    FNV-1a del id del libro (`bookshelf-layout.js`). Nada que persistir y
 *    nada que se mueva: el libro rojo gordo sigue siendo el libro rojo gordo
 *    en el móvil, en el portátil y tras reinstalar. Con `pageCount`/
 *    `sizeBytes` el grosor es real, no inventado.
 *
 * 4. Plantas. Dibujadas a mano en SVG en `plants.js` (monstera, sansevieria,
 *    potus colgante, cactus y suculenta), con los colores en custom
 *    properties para que se apaguen en modo oscuro. Sin assets externos ni
 *    emojis: licencia limpia y coherencia con la iconografía dibujada a mano
 *    de Inhouse. Se colocan por reglas de empaquetado, no al azar: cada N
 *    libros y de remate cuando sobra balda (ver `layoutShelves`).
 *
 * 5. La animación del giro. Es un libro en 3D de verdad, no un flip de
 *    tarjeta: un contenedor con `transform-style: preserve-3d` y dos caras,
 *    la portada en z=+grosor/2 y el lomo como cara lateral
 *    (`rotateY(-90deg) translateZ(ancho/2)`). El libro arranca en
 *    `rotateY(90deg)`, que proyecta exactamente el grosor del lomo: por eso
 *    empieza encajado sobre el lomo de la balda, píxel a píxel (técnica FLIP,
 *    medido con `getBoundingClientRect`). De ahí sale hacia arriba, se acerca
 *    y gira hasta 0° con un rebote corto de -6°. 620 ms con el easing del
 *    sistema; con `prefers-reduced-motion` se resuelve en un fundido.
 *
 * 6. Rendimiento. Todo lo animado son `transform`/`opacity` (nunca
 *    width/left/top), `will-change` se pone y se quita alrededor de la
 *    animación para no dejar capas colgando, las baldas fuera de pantalla
 *    usan `content-visibility: auto`, y el re-empaquetado al redimensionar va
 *    con rAF y umbral de 8px. La portada se precarga en `pointerdown`, así
 *    que cuando el giro enseña la cara ya está pintada.
 *
 * 7. Táctil. Activación por `click` (funciona con teclado y lector de
 *    pantalla), feedback de presión en `pointerdown` para ver qué lomo se va
 *    a abrir antes de soltar, y cancelación si el dedo se desplaza más de
 *    12px: en una estantería los lomos son estrechos y están pegados, y sin
 *    esto cada scroll abriría un libro. Ancho mínimo de lomo 28px (26px en
 *    pantallas < 360px) con zona de acierto extra a cada lado.
 *
 * 8. Tras el giro no se bloquea nada. Al disparar `onOpenBook` la portada se
 *    queda a la vista mientras el lector carga por detrás, pero la estantería
 *    ya acepta interacción: tocar fuera o pulsar Escape la repliega. Es lo
 *    que salva el caso "libro local que hay que volver a elegir": si el
 *    usuario cancela el file picker, no se queda encerrado.
 *
 * 9. Marcapáginas. Cada libro empezado lleva una cinta de raso que asoma por
 *    arriba del lomo; lo que asoma es proporcional al progreso (5 px al 1%,
 *    20 px terminado: `bookmarkFor` en bookshelf-layout.js). Sustituye a la
 *    antigua barrita de progreso al pie del lomo. Vive dentro del propio
 *    `<button>` (que por eso ya no recorta con overflow:hidden), así que la
 *    caja medida para el giro no cambia. La balda reserva encima de los lomos
 *    `--ihr-bookmark-room` para que no lo corte el `content-visibility`.
 *
 * Este fichero sólo depende de `bookshelf-layout.js` y `plants.js`. No sabe
 * nada de PDF.js, foliate, Drive ni IndexedDB: recibe libros y avisa cuando
 * hay que abrir uno.
 */

import { planBookshelf, bookmarkFor, withDefaults } from './bookshelf-layout.js';
import { plantSvg, plantMeta } from './plants.js';

const ROOF_PATH = 'M4 24 L20 8 L36 24';
const EASE = 'cubic-bezier(0.4, 0, 0.2, 1)';
const TAP_SLOP = 12;

export const DEFAULT_TEXTS = Object.freeze({
  shelfLabel: 'Tu estantería',
  emptyTitle: 'Tu estantería está vacía',
  emptyBody: 'Añade tu primer libro y lo verás aquí de canto, con sus plantas.',
  addLocal: 'Añadir libro',
  addDrive: 'Drive',
  emptyAction: 'Añadir tu primer libro',
  openAction: 'Abrir',
  closeAction: 'Cerrar',
  noCover: 'Sin portada',
  openAria: (book) =>
    book.author ? `Abrir ${book.title}, de ${book.author}` : `Abrir ${book.title}`,
  progressAria: (percent) => (percent >= 100 ? 'terminado' : `leído al ${percent} %`)
});

const DEFAULTS = Object.freeze({
  autoOpen: true,        // tras revelar la portada, avisar a la app
  holdMs: 320,           // pausa para que la portada se vea antes de abrir
  revealDuration: 620,   // dentro del rango pedido (400-700 ms)
  returnDuration: 420,
  sections: true,        // false = una sola estantería continua
  shelfPadding: 16,
  gap: 3,
  plantEvery: 5,
  coverRatio: 0.66,      // ancho/alto de portada: proporción de libro comercial
  texts: DEFAULT_TEXTS
});

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

  const state = {
    books: Array.isArray(books) ? books.slice() : [],
    shelfWidth: 0,
    busy: false,
    session: null,
    objectUrls: new Set(),
    destroyed: false,
    frame: 0
  };

  const root = el('div', { class: 'ihr-bookshelf', 'data-ihr-bookshelf': '' });
  const scroller = el('div', { class: 'ihr-bookshelf__scroll' });
  root.append(scroller);
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

  async function resolveCover(book) {
    if (coverCache.has(book)) return coverCache.get(book);
    let url = null;
    try {
      if (typeof options.coverSrcFor === 'function') {
        url = toUrl(await options.coverSrcFor(book));
      }
      if (!url) url = toUrl(book.cover ?? book.coverUrl ?? book.coverBlob);
    } catch {
      url = null; // una portada que falla no puede impedir abrir el libro
    }
    coverCache.set(book, url);
    return url;
  }

  /** Precarga en pointerdown: cuando el giro enseña la cara, ya está pintada. */
  function warmCover(book) {
    resolveCover(book).then((url) => {
      if (!url || typeof Image === 'undefined') return;
      const img = new Image();
      img.decoding = 'async';
      img.src = url;
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
        title: options.driveAvailable === false ? 'Drive no está configurado' : null,
        onClick: () => onDrive()
      });
      button.append(
        svgIcon(['M7 18a4 4 0 0 1-.4-8A6 6 0 0 1 18 9.5a3.75 3.75 0 0 1-.6 8.5Z'], {
          className: 'ihr-icon'
        }),
        el('span', { text: opts.texts.addDrive })
      );
      bar.append(button);
    }
    return bar;
  }

  function buildSpine(item) {
    const { book, style } = item;
    const bookmark = bookmarkFor(book);
    const node = el('button', {
      type: 'button',
      class: `ihr-spine ihr-spine--${style.texture}`,
      'data-book-id': book.id ?? '',
      'aria-label': bookmark
        ? `${opts.texts.openAria(book)}, ${opts.texts.progressAria(bookmark.percent)}`
        : opts.texts.openAria(book),
      style:
        `--ihr-spine-w:${style.width}px;` +
        `--ihr-spine-h:${Math.round(style.heightRatio * 100)}%;` +
        `--ihr-spine-base:${style.color};` +
        `--ihr-spine-shade:${style.shade};` +
        `--ihr-spine-ink:${style.ink};` +
        (item.tilt ? `--ihr-spine-tilt:${item.tilt}deg;` : '')
    });
    if (item.tilt) node.classList.add('is-tilted');
    // En un lomo estrecho el autor no cabe sin pisar al título.
    if (style.width < 32) node.classList.add('ihr-spine--slim');

    // La superficie visible (color, textura, canto arqueado) vive en un hijo
    // aparte de `node`: así el clip-path que dibuja el arco (bookshelf.css)
    // sólo recorta esto, y el marcapáginas de abajo —hermano suyo, no hijo—
    // puede seguir asomando por encima sin que ese recorte se lo lleve.
    const body = el('span', { class: 'ihr-spine__body', 'aria-hidden': 'true' });
    body.append(el('span', { class: 'ihr-spine__grain', 'aria-hidden': 'true' }));
    body.append(
      el('span', { class: 'ihr-spine__label' }, [
        el('span', { class: 'ihr-spine__title', text: book.title ?? 'Sin título' }),
        book.author ? el('span', { class: 'ihr-spine__author', text: book.author }) : null
      ])
    );
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
      node.append(
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
      node.classList.add('is-pressed');
      warmCover(book);
    });
    const release = () => {
      start = null;
      node.classList.remove('is-pressed');
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
    node.addEventListener('click', () => openBook(node, item));
    return node;
  }

  function buildPlant(item) {
    const meta = plantMeta(item.variant);
    const height = Math.round(item.width / meta.aspect);
    return el('span', {
      class: `ihr-plant ihr-plant--${meta.variant}`,
      'aria-hidden': 'true',
      style:
        `--ihr-plant-w:${item.width}px;` +
        `--ihr-plant-h:${height}px;` +
        `--ihr-plant-overhang:${Math.round(height * meta.overhangRatio)}px`,
      html: plantSvg(meta.variant, { seed: item.seed })
    });
  }

  function buildShelf(shelf) {
    const unit = el('div', { class: 'ihr-shelf' });
    const row = el('div', { class: 'ihr-shelf__row' });
    for (const item of shelf.items) {
      row.append(item.kind === 'plant' ? buildPlant(item) : buildSpine(item));
    }
    unit.append(el('div', { class: 'ihr-shelf__back', 'aria-hidden': 'true' }));
    unit.append(row);
    unit.append(el('div', { class: 'ihr-shelf__board', 'aria-hidden': 'true' }));
    return unit;
  }

  function buildEmptyState() {
    const row = el('div', { class: 'ihr-shelf__row ihr-empty__row' });
    for (const [variant, seed, width] of [
      ['sansevieria', 'empty-a', 52],
      ['monstera', 'empty-b', 64],
      ['pothos', 'empty-c', 50]
    ]) {
      const meta = plantMeta(variant);
      const height = Math.round(width / meta.aspect);
      row.append(
        el('span', {
          class: `ihr-plant ihr-plant--${variant}`,
          'aria-hidden': 'true',
          style:
            `--ihr-plant-w:${width}px;--ihr-plant-h:${height}px;` +
            `--ihr-plant-overhang:${Math.round(height * meta.overhangRatio)}px`,
          html: plantSvg(variant, { seed })
        })
      );
    }
    const shelf = el('div', { class: 'ihr-shelf ihr-shelf--empty' }, [
      el('div', { class: 'ihr-shelf__back', 'aria-hidden': 'true' }),
      row,
      el('div', { class: 'ihr-shelf__board', 'aria-hidden': 'true' })
    ]);

    return el('div', { class: 'ihr-empty' }, [
      el('div', { class: 'ihr-empty__art' }, [shelf]),
      el('div', { class: 'ihr-empty__copy' }, [
        roofMark('ihr-roof ihr-empty__roof'),
        el('h2', { class: 'ihr-empty__title', text: opts.texts.emptyTitle }),
        el('p', { class: 'ihr-empty__body', text: opts.texts.emptyBody }),
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

  /** En pantallas estrechas los lomos adelgazan para que quepan más por balda. */
  function spineOptionsFor(width) {
    if (width < 360) return { minWidth: 26, maxWidth: 44 };
    if (width < 520) return { minWidth: 28, maxWidth: 50 };
    return { minWidth: 30, maxWidth: 56 };
  }

  function render() {
    if (state.destroyed) return;
    const width = measure();
    state.shelfWidth = width;
    scroller.textContent = '';

    if (state.books.length === 0) {
      scroller.append(buildEmptyState());
      return;
    }
    if (width <= 0) return; // aún sin layout: el ResizeObserver volverá a llamar

    const plan = planBookshelf(state.books, {
      shelfWidth: width,
      padding: opts.shelfPadding,
      gap: opts.gap,
      plantEvery: opts.plantEvery,
      sort: opts.sort,
      spine: spineOptionsFor(width),
      // Sin secciones, 0 recientes: todo cae en una estantería continua.
      recentLimit: opts.sections ? opts.recentLimit : 0
    });

    const fragment = document.createDocumentFragment();
    for (const section of plan) {
      const wrapper = el('section', {
        class: `ihr-section ihr-section--${section.id}`,
        'aria-label': section.title || opts.texts.shelfLabel
      });
      if (section.title) {
        wrapper.append(el('h2', { class: 'ihr-section__title', text: section.title }));
      }
      for (const shelf of section.shelves) wrapper.append(buildShelf(shelf));
      fragment.append(wrapper);
    }
    scroller.append(fragment);
  }

  function scheduleRender() {
    if (state.frame) return;
    state.frame = requestAnimationFrame(() => {
      state.frame = 0;
      render();
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
          book.author
            ? el('span', { class: 'ihr-cover-placeholder__author', text: book.author })
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
    if (state.busy || state.session || state.destroyed) return;
    state.busy = true;

    const { book, style } = item;
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
    spineEl.style.transform = '';
    void spineEl.offsetWidth;          // devuelve la inclinación sin animarla
    spineEl.style.transition = previousTransition;

    const vw = window.innerWidth || 390;
    const vh = window.innerHeight || 780;

    // Geometría de destino: portada centrada, sin comerse la pantalla entera.
    const coverH = Math.min(vh * 0.54, 440, (vw * 0.78) / opts.coverRatio);
    const coverW = coverH * opts.coverRatio;
    const startScale = rect.height > 0 ? rect.height / coverH : 0.3;
    // Grosor tal que, girado 90°, el tomo proyecte exactamente el lomo de origen.
    const thickness = Math.max(6, (rect.width || 32) / startScale);

    const centerX = vw / 2;
    const centerY = vh * 0.44;
    const dx = rect.left + rect.width / 2 - centerX;
    const dy = rect.top + rect.height / 2 - centerY;

    const coverUrl = await resolveCover(book);
    if (state.destroyed) return;

    const scrim = el('div', { class: 'ihr-flyout__scrim' });
    const bookNode = el('div', {
      class: 'ihr-flyout__book',
      style:
        `width:${coverW}px;height:${coverH}px;` +
        `left:${centerX - coverW / 2}px;top:${centerY - coverH / 2}px;` +
        `--ihr-thickness:${thickness}px;` +
        `--ihr-spine-base:${style.color};` +
        `--ihr-spine-shade:${style.shade};` +
        `--ihr-spine-ink:${style.ink}`
    });

    /*
      La cara del lomo es un clon del lomo real de la balda, ampliado por el
      inverso de la escala inicial. Así coincide al píxel —tipografía, nervios,
      cinta de progreso, sombra— sin duplicar ni una regla de CSS, y cualquier
      acabado que se añada mañana al lomo viaja solo a la animación.
    */
    const spineFace = el('div', { class: 'ihr-flyout__face ihr-flyout__face--spine' });
    const clone = spineEl.cloneNode(true);
    clone.classList.remove('is-away', 'is-pressed', 'is-tilted');
    clone.classList.add('ihr-spine--ghost'); // para distinguirlo del lomo real
    // El marcapáginas asoma FUERA de la caja del lomo; en el tomo que gira no
    // tiene sitio (la cara recorta) y se entiende como metido entre las hojas.
    clone.querySelector('.ihr-spine__bookmark')?.remove();
    clone.removeAttribute('data-book-id');
    clone.removeAttribute('aria-label');
    clone.setAttribute('aria-hidden', 'true');
    clone.setAttribute('tabindex', '-1');
    clone.style.cssText +=
      `;position:absolute;left:0;top:0;pointer-events:none;` +
      `width:${rect.width}px;height:${rect.height}px;` +
      `transform-origin:0 0;transform:scale(${1 / startScale});`;
    spineFace.append(clone);

    bookNode.append(buildCoverFace(book, coverUrl, style));
    bookNode.append(spineFace);
    bookNode.append(el('div', { class: 'ihr-flyout__pages', 'aria-hidden': 'true' }));

    const meta = el('div', { class: 'ihr-flyout__meta' }, [
      el('p', { class: 'ihr-flyout__title', text: book.title ?? '' }),
      book.author ? el('p', { class: 'ihr-flyout__author', text: book.author }) : null
    ]);

    const flyout = el('div', {
      class: 'ihr-flyout',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-label': book.title ?? opts.texts.openAction,
      tabindex: '-1'
    });
    flyout.append(scrim, el('div', { class: 'ihr-flyout__stage' }, [bookNode]), meta);

    const previousFocus = document.activeElement;
    const session = { book, cancelled: false };

    async function close({ silent = false, instant = false } = {}) {
      if (state.session !== session) return;
      session.cancelled = true;
      state.session = null;
      state.busy = false;
      document.removeEventListener('keydown', onKeydown, true);
      if (!instant) await playReturn();
      flyout.remove();
      spineEl.classList.remove('is-away');
      if (!silent && !instant && typeof previousFocus?.focus === 'function') {
        previousFocus.focus();
      }
    }
    session.close = close;

    function onKeydown(event) {
      if (event.key === 'Escape') {
        event.stopPropagation();
        close();
      }
    }

    scrim.addEventListener('click', () => close());
    document.addEventListener('keydown', onKeydown, true);
    state.session = session;

    if (!opts.autoOpen) {
      meta.append(
        el('div', { class: 'ihr-flyout__actions' }, [
          el('button', {
            type: 'button',
            class: 'ihr-btn ihr-btn--primary',
            text: opts.texts.openAction,
            onClick: () => onOpen?.(book, { close: () => close({ silent: true }), coverUrl })
          }),
          el('button', {
            type: 'button',
            class: 'ihr-btn',
            text: opts.texts.closeAction,
            onClick: () => close()
          })
        ])
      );
    }

    root.append(flyout);
    spineEl.classList.add('is-away');
    flyout.focus?.();

    const reduce = prefersReducedMotion();
    const duration = reduce ? 1 : opts.revealDuration;
    const lift = Math.min(64, rect.height * 0.35);

    /*
      Dos detalles para que el arranque encaje con el lomo al píxel:

      - `scale3d` y no `scale`: el 2D no toca la profundidad, así que las caras
        se quedaban a su z original y la perspectiva las agrandaba un 11%.
      - `zStart`: girado 90°, la cara del lomo queda medio ancho de portada por
        delante del centro del tomo. Retrasando el libro esa misma distancia,
        la cara cae justo en el plano z=0, donde la perspectiva no aumenta ni
        desplaza nada. Luego vuelve a 0 mientras el libro gira y se acerca.
    */
    const zStart = -(coverW / 2) * startScale;
    const scaleAt = (t) => startScale + (1 - startScale) * t;
    const tf = (x, y, z, s, deg) =>
      `translate3d(${x}px, ${y}px, ${z}px) scale3d(${s}, ${s}, ${s}) rotateY(${deg}deg)`;

    const frames = [
      {
        transform: tf(dx, dy, zStart, startScale, 90),
        easing: 'cubic-bezier(0.34, 0, 0.26, 1)'
      },
      {
        offset: 0.34,
        transform: tf(dx * 0.92, dy * 0.86 - lift, zStart * 0.55, scaleAt(0.18), 87),
        easing: EASE
      },
      {
        offset: 0.72,
        transform: tf(dx * 0.22, dy * 0.2, 0, scaleAt(0.86), 22),
        easing: 'cubic-bezier(0.3, 0, 0.2, 1)'
      },
      {
        offset: 0.88,
        transform: tf(dx * 0.04, dy * 0.03, 0, 1.012, -6),
        easing: EASE
      },
      { transform: tf(0, 0, 0, 1, 0) }
    ];

    bookNode.style.willChange = 'transform';
    // Timing lineal a propósito: cada keyframe trae su propio easing y, si
    // además se pone uno global, se componen y la coreografía se come el
    // último tercio de la animación (queda quieta mientras corre el reloj).
    const reveal = animate(bookNode, frames, { duration, easing: 'linear', fill: 'both' });
    animate(scrim, [{ opacity: 0 }, { opacity: 1 }], {
      duration: Math.min(280, duration),
      easing: EASE,
      fill: 'both'
    });
    animate(
      meta,
      [
        { opacity: 0, transform: 'translateY(12px)' },
        { opacity: 1, transform: 'translateY(0)' }
      ],
      { duration: Math.min(260, duration), delay: duration * 0.62, easing: EASE, fill: 'both' }
    );

    async function playReturn() {
      const back = animate(
        bookNode,
        [
          { transform: tf(0, 0, 0, 1, 0) },
          {
            offset: 0.45,
            transform: tf(dx * 0.45, dy * 0.35 - lift * 0.6, zStart * 0.4, scaleAt(0.55), 62)
          },
          { transform: tf(dx, dy, zStart, startScale, 90) }
        ],
        {
          duration: prefersReducedMotion() ? 1 : opts.returnDuration,
          easing: EASE,
          fill: 'both'
        }
      );
      animate(scrim, [{ opacity: 1 }, { opacity: 0 }], {
        duration: prefersReducedMotion() ? 1 : opts.returnDuration,
        easing: EASE,
        fill: 'both'
      });
      await back.finished?.catch(() => {});
    }

    try {
      await reveal.finished?.catch(() => {});
    } finally {
      bookNode.style.willChange = '';
    }

    if (session.cancelled || state.destroyed) return;

    if (opts.autoOpen) {
      await wait(opts.holdMs);
      if (session.cancelled || state.destroyed) return;
      // La portada se queda a la vista mientras el lector carga por detrás,
      // pero se libera el bloqueo: tocar fuera o Escape siempre sacan de aquí.
      bookNode.classList.add('is-loading');
      state.busy = false;
      onOpen?.(book, { close: () => close({ silent: true }), coverUrl });
    }
  }

  /* --------------------------- ciclo de vida --------------------------- */

  let observer = null;
  if (typeof ResizeObserver === 'function') {
    observer = new ResizeObserver(() => {
      const width = measure();
      // Umbral: evita re-empaquetar por el scrollbar o por 1px de reflow.
      if (Math.abs(width - state.shelfWidth) >= 8) scheduleRender();
    });
    observer.observe(scroller);
  } else if (typeof window !== 'undefined') {
    window.addEventListener('resize', scheduleRender);
  }

  render();

  /** Sustituye la biblioteca y vuelve a pintar, conservando el scroll. */
  function refresh(nextBooks) {
    if (state.destroyed) return;
    state.session?.close({ instant: true, silent: true });
    const top = scroller.scrollTop;
    state.books = Array.isArray(nextBooks) ? nextBooks.slice() : state.books;
    state.shelfWidth = 0; // fuerza el re-empaquetado
    render();
    scroller.scrollTop = top;
  }

  return {
    element: root,
    refresh,
    update: refresh,

    /** Repliega la portada abierta, si la hay. */
    close() {
      return state.session?.close() ?? Promise.resolve();
    },

    destroy() {
      state.destroyed = true;
      state.session?.close({ instant: true, silent: true });
      if (state.frame) cancelAnimationFrame(state.frame);
      observer?.disconnect();
      if (!observer && typeof window !== 'undefined') {
        window.removeEventListener('resize', scheduleRender);
      }
      if (typeof URL?.revokeObjectURL === 'function') {
        for (const url of state.objectUrls) URL.revokeObjectURL(url);
      }
      state.objectUrls.clear();
      root.remove();
    }
  };
}

export default renderBookshelf;
