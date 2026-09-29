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
 * 2. Madera y baldas. Textura fotográfica de nogal con iluminación y
 *    sombras de contacto en CSS. Recursos propios en src/assets/library.
 *
 * 3. Los lomos conservan geometría y acabado deterministas. El color y la
 *    familia tipográfica se ajustan a la portada rasterizada: se muestrea su
 *    tono dominante y se compara el título visible con varias familias
 *    tipográficas disponibles en la app. Sin portada legible,
 *    se conserva el aspecto de reserva. Con `pageCount`/`sizeBytes` el grosor
 *    es real, no inventado.
 *
 * 4. Plantas. Recortes fotográficos con transparencia, distribuidos por
 *    las reglas de empaquetado. Su luz se adapta al modo oscuro.
 *
 * 5. Modelo propio en book-model.js: malla elíptica continua, tapas y hojas.
 *    Three.js dibuja la misma geometría en la balda y durante el giro.
 *    La textura del título sigue los UV del lomo. La apertura añade 10° de
 *    inclinación para mostrar su sección superior y el volumen de la encuadernación.
 *
 * 6. Un único contexto WebGL compartido dibuja instantáneas para las baldas.
 *    Sólo el libro abierto se redibuja con requestAnimationFrame. Cada vista
 *    libera geometrías y texturas; sin WebGL se conserva una portada accesible.
 *
 * 7. Táctil. Activación por `click` (funciona con teclado y lector de
 *    pantalla), feedback de presión en `pointerdown` para ver qué lomo se va
 *    a abrir antes de soltar, y cancelación si el dedo se desplaza más de
 *    12px: en una estantería los lomos son estrechos y están pegados, y sin
 *    esto cada scroll abriría un libro. Ancho mínimo de lomo 28px (26px en
 *    pantallas < 360px) con zona de acierto extra a cada lado.
 *
 * 8. El giro inicial termina en una portada interactiva. Un toque en ella
 *    amplía el libro hasta cubrir la pantalla; el lector se prepara detrás
 *    de esa cubierta y se revela cuando ya tiene la primera página lista.
 *
 * 9. Marcapáginas. Cada libro empezado lleva una cinta de raso que asoma por
 *    arriba del lomo; lo que asoma es proporcional al progreso (5 px al 1%,
 *    20 px terminado: `bookmarkFor` en bookshelf-layout.js). Sustituye a la
 *    antigua barrita de progreso al pie del lomo. Vive dentro del propio
 *    `<button>` (que por eso ya no recorta con overflow:hidden), así que la
 *    caja medida para el giro no cambia. La balda reserva encima de los lomos
 *    `--ihr-bookmark-room` para que no lo corte el `content-visibility`.
 *
 * La geometría vive en `book-model.js`; la distribución, en `bookshelf-layout.js`. No sabe
 * nada de PDF.js, foliate, Drive ni IndexedDB: recibe libros y avisa cuando
 * hay que abrir uno.
 */

import { planBookshelf, bookmarkFor, withDefaults } from './bookshelf-layout.js';
import { analyzeCoverAppearance, coverAspectRatio, readCoverAspectRatio, withCoverAppearance } from './cover-appearance.js';
import { bookColorOptions, spineColorStyle } from './book-colors.js';
const PLANT_PHOTOS = {
  leafy: new URL('../assets/library/pothos.webp', import.meta.url).href,
  succulent: new URL('../assets/library/succulent.webp', import.meta.url).href,
  upright: new URL('../assets/library/sansevieria.webp', import.meta.url).href
};
import { bookView } from './book-model.js';

const ROOF_PATH = 'M4 24 L20 8 L36 24';
const EASE = 'cubic-bezier(0.4, 0, 0.2, 1)';
const TAP_SLOP = 12;
const ICONS = Object.freeze({
  drive: ['M9 3h6l7 12-3 5H5l-3-5L9 3Z', 'm9 3 7 12H2', 'm15 3-7 12 3 5'],
  read: ['M3 5.5c3-1 6-.5 9 1.5 3-2 6-2.5 9-1.5v14c-3-1-6-.5-9 1.5-3-2-6-2.5-9-1.5v-14Z', 'M12 7v14'],
  download: ['M12 3v12', 'm7 10 5 5 5-5', 'M4 16v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4'],
  check: ['m5 12 4 4L19 6'],
  close: ['m6 6 12 12', 'M18 6 6 18']
});
export const DEFAULT_TEXTS = Object.freeze({
  shelfLabel: 'Tu estantería',
  emptyTitle: 'Tu estantería está vacía',
  emptyBody: 'Añade tu primer libro y lo verás aquí de canto, con sus plantas.',
  addLocal: 'Añadir libro',
  addDrive: 'Drive',
  emptyAction: 'Añadir tu primer libro',
  openAction: 'Abrir',
  tapCover: (book) => `Toca para leer ${book.title ?? 'este libro'}`,
  closeAction: 'Cerrar',
  noCover: 'Sin portada',
  openAria: (book) =>
    book.author ? `Abrir ${book.title}, de ${book.author}` : `Abrir ${book.title}`,
  progressAria: (percent) => (percent >= 100 ? 'terminado' : `leído al ${percent} %`)
});

const DEFAULTS = Object.freeze({
  autoOpen: true,        // tras revelar la portada, avisar a la app
  holdMs: 320,           // pausa para que la portada se vea antes de abrir
  revealDuration: 680,
  returnDuration: 460,
  sections: true,        // false = una sola estantería continua
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
    frame: 0,
    coverAppearances: new Map(),
    appearanceTasks: new Map(),
    itemsById: new Map(),
    appearanceRefreshPending: false,
    pressedBookId: null,
    lastOpened: null,
    returnMotion: null,
    arranging: false,
    dragSession: null,
    queuedBooks: null,
    renderQueued: false,
    appearancesReady: true,
    appearanceGeneration: 0
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

  function coverKeyFor(book) {
    const id = String(book?.id ?? book?.path ?? book?.title ?? 'book');
    const cover = book?.cover ?? book?.coverBlob ?? book?.coverUrl;
    if (typeof Blob !== 'undefined' && cover instanceof Blob) {
      return `${id}|${book?.title ?? ''}|${cover.type}|${cover.size}|${cover.lastModified ?? ''}`;
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
    if (item.book.spineFontFamily) {
      const font = SPINE_FONTS.find(candidate => candidate.family === item.book.spineFontFamily);
      if (font) item.style = {
        ...item.style, fontFamily: font.family, fontCanvasFamily: font.family,
        fontFallback: font.fallback, fontWeight: font.weight
      };
    }
    if (Number.isFinite(Number(item.book.spineFontSize))) {
      item.style = { ...item.style, spineFontSize: Math.max(8, Math.min(18, Number(item.book.spineFontSize))) };
    }
    return Boolean(appearance);
  }

  function maybeRefreshAppearanceStyles() {
    if (!state.appearanceRefreshPending || state.busy || state.session || state.returnMotion || state.destroyed) return;
    state.appearanceRefreshPending = false;
    scheduleRender();
  }

  function resolveCoverAppearance(book, knownUrl) {
    const key = coverKeyFor(book);
    const id = String(book?.id ?? book?.path ?? book?.title ?? 'book');
    const cached = state.coverAppearances.get(id);
    if (cached?.key === key && cached.complete !== false) return Promise.resolve(cached.appearance);
    if (state.appearanceTasks.has(key)) return state.appearanceTasks.get(key);

    const task = (async () => {
      const url = knownUrl || await resolveCover(book);
      if (!url) {
      state.coverAppearances.set(id, { key, appearance: null, complete: true });
        return null;
      }
      const appearance = await analyzeCoverAppearance(url, book?.title ?? '');
      if (state.destroyed) return null;
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
        if (existing?.isConnected && !state.busy && !state.session && !state.returnMotion && state.pressedBookId !== id) {
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
      `--ihr-spine-font-size:${Math.max(8, Math.min(18, Number(style.spineFontSize) || 10))}px;`;
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
    node.style.setProperty('--ihr-spine-font-size', `${Math.max(8, Math.min(18, Number(style.spineFontSize) || 10))}px`);
  }

  // El retorno desde el lector necesita su primer fotograma antes de que el
  // navegador pinte la estantería. La resolución normal usa `await` incluso
  // cuando la portada ya está en IndexedDB como Blob y deja un fotograma vacío.
  function resolveCoverImmediately(book) {
    if (coverCache.has(book)) return coverCache.get(book);
    try {
      const source = typeof options.coverSrcFor === 'function'
        ? options.coverSrcFor(book)
        : book.cover ?? book.coverUrl ?? book.coverBlob;
      if (source && typeof source.then === 'function') return null;
      const url = toUrl(source) || toUrl(book.cover ?? book.coverUrl ?? book.coverBlob);
      coverCache.set(book, url);
      return url;
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
        title: options.driveAvailable === false ? 'Drive no está configurado' : null,
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
      el('span', { text: 'Preparando tu estantería…' })
    ]);
  }

  function shelfSpineNodes(section = null) {
    return [...(section || scroller).querySelectorAll('.ihr-spine')];
  }

  function persistShelfDomOrder(oldRects = null) {
    const orderedIds = shelfSpineNodes().map(node => node.dataset.bookId).filter(Boolean);
    const rank = new Map(orderedIds.map((id, index) => [String(id), index]));
    state.books = state.books.map(book => ({ ...book, shelfOrder: rank.get(String(book.id)) ?? Number.MAX_SAFE_INTEGER }));
    Promise.resolve(options.onBookOrderChange?.(state.books.map(book => ({ id: book.id, shelfOrder: book.shelfOrder }))))
      .catch(error => console.warn('No se pudo guardar el orden de la estantería:', error));
    render();
    if (!oldRects || prefersReducedMotion()) return;
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
    if (!state.arranging || event.button !== 0 || state.dragSession) return;
    event.preventDefault();
    state.dragSession = {
      node, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY,
      x: event.clientX, y: event.clientY, target: null, after: false, moved: false
    };
    node.setPointerCapture?.(event.pointerId);
  }

  function moveSpineDrag(event, node) {
    const drag = state.dragSession;
    if (!drag || drag.node !== node || drag.pointerId !== event.pointerId) return;
    drag.x = event.clientX; drag.y = event.clientY;
    const dx = drag.x - drag.startX, dy = drag.y - drag.startY;
    if (!drag.moved && Math.hypot(dx, dy) < 6) return;
    drag.moved = true;
    node.classList.add('is-dragging');
    node.style.setProperty('--ihr-drag-x', `${dx}px`);
    node.style.setProperty('--ihr-drag-y', `${dy}px`);
    node.style.pointerEvents = 'none';
    const hit = document.elementFromPoint(event.clientX, event.clientY)?.closest?.('.ihr-spine');
    node.style.pointerEvents = '';
    const target = hit && hit !== node && hit.closest('.ihr-section') === node.closest('.ihr-section') ? hit : null;
    drag.target?.classList.remove('is-drop-target');
    drag.target = target;
    drag.after = Boolean(target && event.clientX > target.getBoundingClientRect().left + target.getBoundingClientRect().width / 2);
    target?.classList.add('is-drop-target');
  }

  function finishSpineDrag(event, node, cancelled = false) {
    const drag = state.dragSession;
    if (!drag || drag.node !== node || drag.pointerId !== event.pointerId) return;
    state.dragSession = null;
    drag.target?.classList.remove('is-drop-target');
    node.classList.remove('is-dragging');
    node.style.removeProperty('--ihr-drag-x');
    node.style.removeProperty('--ihr-drag-y');
    node.style.pointerEvents = '';
    try { node.releasePointerCapture?.(event.pointerId); } catch { /* captura ya liberada */ }
    if (drag.moved && !cancelled && drag.target) reorderSpine(node, drag.target, drag.after);
  }

  function setArranging(value) {
    state.arranging = Boolean(value);
    root.classList.toggle('is-arranging', state.arranging);
    if (!state.arranging && state.dragSession) {
      const drag = state.dragSession;
      state.dragSession = null;
      drag.target?.classList.remove('is-drop-target');
      drag.node.classList.remove('is-dragging');
      drag.node.style.pointerEvents = '';
    }
    render();
    scroller.querySelector('.ihr-library-heading__arrange')?.focus({ preventScroll: true });
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
      'aria-keyshortcuts': state.arranging ? 'ArrowLeft ArrowRight' : null,
      'aria-description': state.arranging ? 'Usa las flechas izquierda y derecha para cambiar el orden' : null,
      style:
        `--ihr-spine-w:${style.width}px;` +
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
    const view = bookView(body, book, style, {
      width: height * coverRatio, height, thickness: style.width,
      viewportWidth: style.width, viewportHeight: height,
      centerX: style.width / 2, centerY: height / 2, shelf: true
    });
    if (view) view.dispose(false); // retain the rendered snapshot, free mesh/textures
    else body.append(el('span', { class: 'ihr-spine__label' }, [
      el('span', { class: 'ihr-spine__title', text: book.spineTitleOverride || book.title || 'Sin título' }),
      book.author ? el('span', { class: 'ihr-spine__author', text: book.author }) : null
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
    node.addEventListener('click', () => {
      if (state.arranging) return;
      openBook(node, item);
    });
    node.addEventListener('keydown', event => {
      if (!state.arranging || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
      event.preventDefault();
      const section = node.closest('.ihr-section');
      const siblings = [...section.querySelectorAll('.ihr-spine')];
      const current = siblings.indexOf(node);
      const target = siblings[current + (event.key === 'ArrowLeft' ? -1 : 1)];
      if (target) reorderSpine(node, target, event.key === 'ArrowRight');
    });
    node.addEventListener('pointerdown', event => startSpineDrag(event, node));
    node.addEventListener('pointermove', event => moveSpineDrag(event, node));
    node.addEventListener('pointerup', event => finishSpineDrag(event, node));
    node.addEventListener('pointercancel', event => finishSpineDrag(event, node, true));
    return node;
  }

  function buildPlant(item) {
    const upright = ['sansevieria', 'cactus'].includes(item.variant);
    const succulent = item.variant === 'suculenta';
    const height = Math.round(item.width * (upright ? 1.5 : succulent ? 1.057 : 1.094));
    return el('span', {
      class: `ihr-plant ihr-plant--photo ihr-plant--${item.variant}`,
      'aria-hidden': 'true',
      style:
        `--ihr-plant-w:${item.width}px;` +
        `--ihr-plant-h:${height}px;` +
        '--ihr-plant-overhang:0px'
    }, [el('img', { src:PLANT_PHOTOS[upright ? 'upright' : succulent ? 'succulent' : 'leafy'], alt:'', width:item.width, height, decoding:'async', draggable:'false' })]);
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
      ['suculenta', 'empty-c', 50]
    ]) {
      row.append(buildPlant({ variant, seed, width }));
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
    if (state.returnMotion) { state.renderQueued = true; return; }
    if (!state.appearancesReady && state.books.length > 0) {
      scroller.textContent = '';
      scroller.append(buildPreparingState());
      return;
    }
    const focusedBookId = document.activeElement?.closest?.('.ihr-spine')?.dataset.bookId;
    const width = measure();
    state.shelfWidth = width;
    // A refresh can complete while home is hidden behind the reader. Keep the
    // currently painted DOM in that case: the open book still needs its shelf
    // spine as the target of the return animation. ResizeObserver re-renders
    // the updated records when the shelf becomes visible again.
    if (width <= 0 && state.books.length > 0) return;
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

    state.itemsById.clear();
    const fragment = document.createDocumentFragment();
    fragment.append(el('div', { class: 'ihr-library-heading' }, [
      el('h1', { text: 'Tu biblioteca' }),
      el('div', { class: 'ihr-library-heading__tools' }, [
        el('p', { 'aria-live': 'polite', text: state.arranging
          ? 'Arrastra los libros o usa ← → para ordenarlos'
          : `${state.books.length} ${state.books.length === 1 ? 'libro' : 'libros'}` }),
        el('button', {
          type: 'button', class: 'ihr-library-heading__arrange',
          'aria-pressed': state.arranging,
          text: state.arranging ? 'Guardar orden' : 'Organizar',
          onClick: () => setArranging(!state.arranging)
        })
      ])
    ]));
    for (const section of plan) {
      for (const shelf of section.shelves) {
        for (const item of shelf.items) {
          if (item.kind !== 'book') continue;
          item.baseStyle = item.style;
          item.coverKey = coverKeyFor(item.book);
          const appearance = state.coverAppearances.get(String(item.book.id ?? item.book.path ?? item.book.title ?? 'book'));
          applyCoverAppearance(item, appearance?.key === item.coverKey ? appearance.appearance : null);
        }
      }
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
      fragment.append(wrapper);
    }
    scroller.append(fragment);
    if (focusedBookId) {
      [...scroller.querySelectorAll('.ihr-spine')]
        .find(node => node.dataset.bookId === focusedBookId)
        ?.focus({ preventScroll: true });
    }
    for (const book of state.books) resolveCoverAppearance(book);
  }

  function scheduleRender() {
    if (state.returnMotion) { state.renderQueued = true; return; }
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

    const { book } = item;
    let style = item.style;
    const initialStyle = item.style;
    options.onPrepareBook?.(book);
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

    const coverUrl = await resolveCover(book);
    const imageRatio = await readCoverAspectRatio(coverUrl);
    if (imageRatio) item.style = { ...item.style, coverRatio: imageRatio };
    const appearance = await quickCoverAppearance(book, coverUrl);
    if (appearance) applyCoverAppearance(item, appearance);
    if (item.style !== initialStyle && spineEl.isConnected) {
      const hadFocus = document.activeElement === spineEl;
      const replacement = buildSpine(item);
      spineEl.replaceWith(replacement);
      spineEl = replacement;
      if (hadFocus) replacement.focus({ preventScroll: true });
    }
    style = item.style;
    if (state.destroyed) return;

    const vw = window.innerWidth || 390;
    const vh = window.innerHeight || 780;
    const landscape = vh <= 560 && vw >= 560;
    const ratio = coverRatioFor(style);
    // Match the model's physical front board to the image ratio before sizing
    // its reveal. This keeps the same silhouette on the shelf and in flight.
    const shelfAspect = (rect.width || 32) / (rect.height || 150);
    const coverH = Math.min(vh * (landscape ? .72 : .54), landscape ? 350 : Math.max(110, vh - 330), 440,
      (vw * (landscape ? .35 : .78)) / ratio,
      (vw * 0.86) / (ratio + shelfAspect * 0.55));
    const coverW = coverH * ratio;
    const startScale = rect.height > 0 ? rect.height / coverH : 0.3;
    const thickness = Math.max(6, (rect.width || 32) / startScale);
    const centerX = vw * (landscape ? .26 : .5) + thickness * 0.38 / 2;
    const centerY = vh * (landscape ? .5 : .42);
    const dx = rect.left + rect.width / 2 - centerX;
    const dy = rect.top + rect.height / 2 - centerY;

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
      viewportWidth: vw, viewportHeight: vh, centerX, centerY, coverUrl
    });
    if (view) {
      view.draw({ x: dx, y: dy, scale: startScale, angle: 90, pitch: 0 });
      bookNode.classList.add('ihr-flyout__book--webgl');
      bookNode.style.position = 'absolute';
      bookNode.style.inset = '0';
      bookNode.style.width = '100%';
      bookNode.style.height = '100%';
    } else {
      bookNode.classList.add('ihr-flyout__book--fallback');
      bookNode.append(buildCoverFace(book, coverUrl, style));
    }
    const animateBook = (frames, timing) => view
      ? view.animate(frames, timing)
      : animate(bookNode, [{ opacity: 1 }], timing);
    const meta = el('div', { class: 'ihr-flyout__meta' }, [
      el('p', { class: 'ihr-flyout__details', text: [book.format, book.progressFraction > 0 ? `${Math.round(book.progressFraction * 100)} % leído` : 'Por empezar'].filter(Boolean).join(' · ') }),
      el('p', { class: 'ihr-flyout__title', text: book.title ?? '' }),
      book.author ? el('p', { class: 'ihr-flyout__author', text: book.author }) : null
    ]);
    const readiness = el('p', { class: 'ihr-flyout__readiness', text: options.getBookPreparation ? 'Preparando el libro…' : 'Toca la portada para leer', 'aria-live': 'polite' });
    meta.append(readiness);
    const coverTarget = el('button', {
      type: 'button', class: 'ihr-flyout__cover-target',
      'aria-label': opts.texts.tapCover(book), hidden: true,
      style: `left:${centerX - coverW / 2}px;top:${centerY - coverH / 2}px;width:${coverW}px;height:${coverH}px`
    });

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
    flyout.append(scrim, shadow, el('div', { class: 'ihr-flyout__stage' }, [bookNode]), meta, coverTarget, closeButton);

    let previousFocus = document.activeElement;
    const session = { book, item, cancelled: false, phase: 'revealing', view, bookNode };

    async function close({ silent = false, instant = false } = {}) {
      if (state.session !== session || session.cancelled) return;
      clearInterval(readyCheck);
      session.cancelled = true;
      document.removeEventListener('keydown', onKeydown, true);
      fadeMeta();
      flyout.classList.remove('is-ready');
      if (!instant) await playReturn();
      view?.dispose();
      flyout.remove();
      if (state.session === session) { state.session = null; state.busy = false; }
      spineEl.classList.remove('is-away');
      if (!silent && !instant && typeof previousFocus?.focus === 'function') {
        previousFocus.focus();
      }
      maybeRefreshAppearanceStyles();
    }
    session.close = close;

    function onKeydown(event) {
      if (event.key === 'Tab') {
        const buttons = [...flyout.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled])')]
          .filter(control => !control.closest('[hidden]'));
        const first = buttons[0], last = buttons.at(-1);
        if (event.shiftKey && (document.activeElement === first || document.activeElement === flyout)) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && (document.activeElement === last || document.activeElement === flyout)) { event.preventDefault(); first?.focus(); }
      }
      if (event.key === 'Escape') {
        event.stopPropagation();
        if (!editorPanel.hidden) closeEditor();
        else if (session.phase !== 'reading') close();
      }
    }

    scrim.addEventListener('click', () => {
      if (session.phase !== 'reading') close();
    });
    document.addEventListener('keydown', onKeydown, true);
    state.session = session;

    const isDownloaded = book.sourceType === 'drive' && Boolean(book.content);
    const alreadySaved = book.sourceType === 'drive' ? isDownloaded : Boolean(book.driveFileId);
    const actionLabel = book.sourceType === 'drive' ? (isDownloaded ? 'Disponible offline' : 'Descargar') : (book.driveFileId ? 'En Drive' : 'Guardar en Drive');
    const actionTitle = book.sourceType === 'drive' ? (isDownloaded ? 'Disponible sin conexión' : 'Descargar para usar sin conexión') : actionLabel;
    const actionButtons = [
      el('button', { type: 'button', class: 'ihr-btn ihr-btn--primary', disabled:true, onClick: () => expandCover() }, [svgIcon(ICONS.read, { className:'ihr-icon' }), el('span', { text: opts.texts.openAction })]),
      el('button', { type: 'button', class: 'ihr-btn', title:actionTitle, 'aria-label':actionTitle, disabled:!options.onBookAction || alreadySaved, onClick: event => options.onBookAction?.(book.sourceType === 'drive' ? 'offline' : 'drive', book, event.currentTarget) }, [svgIcon(alreadySaved ? ICONS.check : book.sourceType === 'drive' ? ICONS.download : ICONS.drive, { className:'ihr-icon' }), el('span', { text:actionLabel })]),
      el('button', { type: 'button', class: 'ihr-btn ihr-flyout__edit-button', disabled:true, 'aria-expanded': 'false', onClick: () => editorPanel.hidden ? openEditor() : closeEditor() }, [el('span', { text:'Editar' })])
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
      class: 'ihr-spine-editor', hidden: true, role: 'region', 'aria-label': 'Editar el lomo'
    });
    const editorPreviewTitle = el('span', {
      class: 'ihr-spine-editor__preview-title',
      text: book.spineTitleOverride || book.title || 'Sin título'
    });
    const editorPreviewAuthor = el('span', {
      class: 'ihr-spine-editor__preview-author', text: book.author || ''
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
      editorPreviewTitle.textContent = book.spineTitleOverride || book.title || 'Sin título';
      editorPreviewAuthor.textContent = book.author || '';
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
      appearanceDirty = true;
      applyCoverAppearance(item, getCachedAppearance());
      style = item.style;
      refreshEditorPreview();
      updateBookStyleVars(bookNode, item.style);
      const shelfNode = shelfSpineNodes().find(node => node.dataset.bookId === String(book.id));
      updateBookStyleVars(shelfNode, item.style);
      if (state.lastOpened?.book?.id === book.id) state.lastOpened.style = item.style;
      state.appearanceRefreshPending = true;
      updateColorSelection();
      if (spinePreviewFrame) cancelAnimationFrame(spinePreviewFrame);
      spinePreviewFrame = requestAnimationFrame(() => {
        spinePreviewFrame = 0;
        if (!editorPanel.hidden && session.phase === 'ready') {
          view?.updateSpineAppearance(book, item.style);
        }
      });
      queueCustomizationSave();
    }
    function openEditor() {
      if (session.phase !== 'ready') return;
      const viewport = visibleViewport();
      session.editorViewportWidth = viewport.width;
      session.editorViewportHeight = viewport.height;
      session.keyboardOpen = false;
      editorPanel.hidden = false;
      flyout.classList.add('is-editing-spine');
      meta.classList.add('is-editing');
      coverTarget.hidden = true;
      actionButtons[2].setAttribute('aria-expanded', 'true');
      refreshEditorPreview();
      if (view) view.animate([
        { transform: { x: 0, y: 0, scale: 1, angle: 0, pitch: 0 } },
        { transform: editorPose }
      ], { duration: prefersReducedMotion() ? 1 : 230 });
      fontSelect.focus({ preventScroll: true });
    }
    function closeEditor({ commit = true, restoreFocus = true } = {}) {
      if (editorPanel.hidden) return;
      editorPanel.hidden = true;
      flyout.classList.remove('is-editing-spine');
      meta.classList.remove('is-editing');
      coverTarget.hidden = !opts.autoOpen;
      actionButtons[2].setAttribute('aria-expanded', 'false');
      if (spinePreviewFrame) cancelAnimationFrame(spinePreviewFrame);
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
          { transform: editorPose },
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
    const pickerInput = el('input', {
      type: 'color', value: spineColorStyle(selectedColor).color,
      'aria-label': 'Elegir otro color para el lomo',
      onChange: event => selectSpineColor(event.currentTarget.value)
    });
    const colorControls = el('div', { class: 'ihr-flyout__colors', role: 'group', 'aria-label': 'Color del lomo' });
    const fontSelect = el('select', {
      class: 'ihr-spine-editor__select', 'aria-label': 'Fuente del lomo',
      onChange: event => {
        const font = SPINE_FONTS.find(candidate => candidate.family === event.currentTarget.value);
        if (!font) return;
        updateCustomization({ spineFontFamily: font.family });
      }
    });
    for (const font of SPINE_FONTS) fontSelect.append(el('option', { value: font.family, text: font.label }));
    fontSelect.value = book.spineFontFamily || style.fontFamily || SPINE_FONTS[0].family;
    const fontSizeInput = el('input', {
      type: 'range', min: '8', max: '18', step: '1',
      value: String(Math.max(8, Math.min(18, Number(book.spineFontSize) || Number(style.spineFontSize) || 10))),
      'aria-label': 'Tamaño de fuente del lomo',
      onInput: event => {
        const size = Number(event.currentTarget.value);
        sizeOutput.textContent = `${size} px`;
        updateCustomization({ spineFontSize: size });
      }
    });
    const sizeOutput = el('output', { class: 'ihr-spine-editor__size', text: `${fontSizeInput.value} px` });
    const titleInput = el('input', {
      type: 'text', maxlength: '120', value: book.spineTitleOverride ?? '',
      placeholder: book.title || 'Título del libro',
      'aria-label': 'Texto del lomo',
      onInput: event => updateCustomization({ spineTitleOverride: event.currentTarget.value })
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
      const margin = 14;
      if (fieldRect.bottom > panelRect.bottom - margin) {
        editorPanel.scrollTop += fieldRect.bottom - panelRect.bottom + margin;
      } else if (fieldRect.top < panelRect.top + margin) {
        editorPanel.scrollTop -= panelRect.top + margin - fieldRect.top;
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
      if (event.target === titleInput) requestAnimationFrame(keepTitleVisible);
    });
    function updateColorSelection() {
      colorButtons.forEach(button => {
        const selected = button.dataset.color === selectedColor;
        button.setAttribute('aria-pressed', String(selected));
        button.classList.toggle('is-selected', selected);
      });
      pickerInput.value = spineColorStyle(selectedColor).color;
      pickerInput.parentElement?.classList.toggle('is-selected', !suggestedColors.includes(selectedColor));
    }
    function selectSpineColor(color) {
      selectedColor = spineColorStyle(color).color;
      book.spineColorOverride = selectedColor;
      updateCustomization({ spineColorOverride: selectedColor });
    }
    suggestedColors.forEach((color, index) => {
      const names = ['Color de la portada', 'Tono cercano 1', 'Tono cercano 2'];
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
      el('span', { class: 'ihr-flyout__color-label', text: 'Color del lomo' }),
      el('div', { class: 'ihr-flyout__swatches' }, colorButtons),
      el('label', { class: 'ihr-flyout__custom-color', title: 'Elegir otro color' }, [
        pickerInput,
        el('span', { class: 'ihr-flyout__custom-mark', 'aria-hidden': 'true', text: '+' })
      ])
    );
    updateColorSelection();
    editorPanel.append(
      el('header', { class:'ihr-spine-editor__header' }, [
        el('h2', { class:'ihr-spine-editor__heading', text:'Editar el lomo' }),
        el('button', { type:'button', class:'ihr-btn ihr-spine-editor__done', text:'Listo', onClick:closeEditor })
      ]),
      editorPreview,
      el('div', { class: 'ihr-spine-editor__row' }, [
        el('label', { class: 'ihr-spine-editor__field' }, [
          el('span', { text: 'Fuente' }), fontSelect
        ]),
        el('label', { class: 'ihr-spine-editor__field ihr-spine-editor__field--size' }, [
          el('span', { text: 'Tamaño' }),
          el('span', { class: 'ihr-spine-editor__range' }, [fontSizeInput, sizeOutput])
        ])
      ]),
      el('label', { class: 'ihr-spine-editor__field ihr-spine-editor__field--title' }, [
        el('span', { text: 'Texto del lomo' }), titleInput
      ]),
      colorControls
    );
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

    document.body.append(flyout);
    spineEl.classList.add('is-away');
    flyout.focus?.();

    const reduce = prefersReducedMotion();
    const duration = reduce ? 1 : opts.revealDuration;
    const lift = Math.min(64, rect.height * 0.35);

    const zStart = 0;
    const scaleAt = (t) => startScale + (1 - startScale) * t;
    const tf = (x, y, z, scale, angle) => ({ x, y, scale, angle, pitch: Math.max(0, (90 - angle) / 90) * 7 });

    const frames = [
      {
        transform: tf(dx, dy, zStart, startScale, 90),
        easing: 'cubic-bezier(0.34, 0, 0.26, 1)'
      },
      {
        offset: 0.26,
        transform: tf(dx * 0.9, dy * 0.86 - lift, zStart * 0.55, scaleAt(0.15), 80),
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
      const back = animateBook(
        [
          { transform: tf(0, 0, 0, 1, 0) },
          {
            offset: 0.45,
            transform: tf(dx * 0.45, dy * 0.35 - lift * 0.6, zStart * 0.4, scaleAt(0.55), 62)
          },
          { transform: tf(dx, dy, zStart, startScale, 90) }
        ],
        {
          duration: returnDuration,
          easing: EASE,
          fill: 'both'
        }
      );
      animate(scrim, [{ opacity: 1 }, { opacity: 0 }], {
        duration: returnDuration,
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

    session.phase = 'ready';
    flyout.classList.add('is-ready');
    actionButtons[0].disabled = false;
    actionButtons[2].disabled = false;
    coverTarget.hidden = !opts.autoOpen;
    coverTarget.classList.add('is-ready');

    async function finishReaderTransition() {
      const fadeDuration = prefersReducedMotion() ? 1 : 180;
      const fade = animate(bookNode, [{ opacity: 1 }, { opacity: 0 }], {
        duration: fadeDuration, easing: 'linear', fill: 'both'
      });
      animate(scrim, [{ opacity: 1 }, { opacity: 0 }], {
        duration: fadeDuration, easing: 'linear', fill: 'both'
      });
      await fade.finished?.catch(() => {});
      if (state.session === session) {
        session.phase = 'complete';
        state.lastOpened = { book, style: item.style, spineEl };
        state.session = null;
        state.busy = false;
        session.cancelled = true;
        clearInterval(readyCheck);
        document.removeEventListener('keydown', onKeydown, true);
        view?.dispose();
        flyout.remove();
      }
    }

    async function expandCover() {
      if (session.cancelled || session.expanding || session.phase !== 'ready' || state.destroyed) return;
      session.expanding = true;
      coverTarget.disabled = true;
      flyout.classList.add('is-expanding');
      closeButton.hidden = true;
      fadeMeta();
      const zoom = Math.max(vw / coverW, vh / coverH) * 1.025;
      const zoomDuration = prefersReducedMotion() ? 1 : 520;
      const expansion = animateBook([
        { transform: tf(0, 0, 0, 1, 0), offset: 0 },
        { transform: { ...tf(vw / 2 - centerX, vh / 2 - centerY, 0, zoom, 0), pitch:0 }, offset: 1 }
      ], { duration: zoomDuration, easing: 'linear', fill: 'both' });
      await expansion.finished?.catch(() => {});
      if (session.cancelled || state.destroyed) return;
      session.phase = 'reading';
      coverTarget.hidden = true;
      readiness.textContent = 'Abriendo el libro…';
      try {
        await onOpen?.(book, {
          coverUrl,
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
    if (state.session?.handleViewportResize?.()) return;
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
    if (state.returnMotion) {
      if (Array.isArray(nextBooks)) state.queuedBooks = nextBooks.slice();
      return;
    }
    state.session?.close({ instant: true, silent: true });
    const top = scroller.scrollTop;
    state.books = Array.isArray(nextBooks) ? nextBooks.slice() : state.books;
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
    if (state.destroyed || state.returnMotion) return;
    if (state.queuedBooks) {
      const nextBooks = state.queuedBooks;
      state.queuedBooks = null;
      refresh(nextBooks);
    } else if (state.renderQueued) {
      state.renderQueued = false;
      scheduleRender();
    }
  }

  /** Cierra el tomo 3D desde el lector y lo devuelve a su hueco. */
  async function returnToShelf(bookId) {
    const previous = state.lastOpened;
    if (!previous || previous.book.id !== bookId || state.destroyed) return false;
    state.returnMotion?.cancel();
    const book = state.books.find(candidate => candidate.id === bookId) || previous.book;
    const spine = [...root.querySelectorAll('.ihr-spine')].find(node => node.dataset.bookId === String(bookId)) || previous.spineEl;
    if (!spine?.isConnected) { state.lastOpened = null; return false; }

    spine.scrollIntoView?.({ block:'nearest', behavior:'instant' });
    const rect = spine.getBoundingClientRect();
    if (!rect.width || !rect.height) { state.lastOpened = null; return false; }
    const vw = window.innerWidth || 390, vh = window.innerHeight || 780;
    const landscape = vh <= 560 && vw >= 560;
    const ratio = coverRatioFor(previous.style);
    const coverH = Math.min(vh * (landscape ? .72 : .54), landscape ? 350 : Math.max(110, vh - 330), 440,
      (vw * (landscape ? .35 : .78)) / ratio, (vw * .86) / (ratio + rect.width / rect.height * .55));
    const coverW = coverH * ratio;
    const startScale = rect.height / coverH;
    const thickness = Math.max(6, rect.width / startScale);
    const centerX = vw / 2 + thickness * .19;
    const centerY = vh * (landscape ? .5 : .42);
    const dx = rect.left + rect.width / 2 - centerX;
    const dy = rect.top + rect.height / 2 - centerY;
    const lift = Math.min(40, rect.height * .2);
    const end = { x:dx, y:dy, scale:startScale, angle:90, pitch:0 };
    const stage = el('div', { class:'ihr-flyout__stage' });
    const bookNode = el('div', { class:'ihr-flyout__book', style:
      `left:${(vw-coverW)/2}px;top:${centerY-coverH/2}px;width:${coverW}px;height:${coverH}px` });
    stage.append(bookNode);
    const flyout = el('div', { class:'ihr-flyout ihr-flyout--return', 'aria-hidden':'true' }, [stage]);
    const coverUrl = resolveCoverImmediately(book);
    if (state.destroyed || state.lastOpened !== previous || window.innerWidth !== vw || window.innerHeight !== vh) return false;
    const view = bookView(bookNode, book, previous.style, {
      width:coverW, height:coverH, thickness, viewportWidth:vw, viewportHeight:vh,
      centerX:vw/2, centerY:vh*.42, coverUrl
    });
    if (view) {
      bookNode.classList.add('ihr-flyout__book--webgl');
      bookNode.style.cssText = 'position:absolute;inset:0;width:100%;height:100%';
    } else {
      bookNode.classList.add('ihr-flyout__book--fallback');
      bookNode.style.cssText = `position:absolute;width:${coverW}px;height:${coverH}px;left:${(vw-coverW)/2}px;top:${centerY-coverH/2}px`;
      bookNode.append(buildCoverFace(book, coverUrl, previous.style));
    }
    const pose = (x, y, scale, angle, pitch=0) => ({ x,y,scale,angle,pitch });
    document.body.append(flyout);
    spine.classList.add('is-away');
    const duration = prefersReducedMotion() ? 1 : 560;
    const animation = view ? view.animate([
      { transform:pose(0,0,1,0,0), offset:0 },
      { transform:pose(-dx*.12,-lift*.5,.94,12,3), offset:.22 },
      { transform:pose(dx*.38,dy*.38-lift,startScale+(1-startScale)*.38,62,4), offset:.68 },
      { transform:end, offset:1 }
    ], { duration }) : animate(bookNode, [
      { opacity:1, transform:'translate(0,0) scale(1)' },
      { opacity:.85, transform:`translate(${dx}px, ${dy}px) scale(${startScale})` }
    ], { duration, easing:EASE, fill:'both' });
    const restoreShelfSpine = () => {
      const current = [...root.querySelectorAll('.ihr-spine')]
        .find(node => node.dataset.bookId === String(bookId)) || spine
      current.classList.remove('is-away')
      return current
    }
    const motion = { cancel() {
      animation.cancel?.(); view?.dispose(); flyout.remove(); restoreShelfSpine()
      state.returnMotion = null;
      applyDeferredShelfUpdates()
    } };
    state.returnMotion = motion;
    // Some WebViews pause requestAnimationFrame as the reader surface closes.
    // Bound the transition so a paused GPU frame cannot leave an invisible
    // overlay in the DOM or keep the original book hidden on its shelf.
    let watchdog;
    await Promise.race([
      animation.finished?.then(() => true, () => true) ?? Promise.resolve(true),
      new Promise(resolve => { watchdog = setTimeout(() => resolve(false), duration + 1500); })
    ]);
    clearTimeout(watchdog);
    if (state.returnMotion === motion) {
      state.returnMotion = null;
      animation.cancel?.();
      view?.dispose(); flyout.remove();
      const currentSpine = restoreShelfSpine()
      state.lastOpened = null;
      currentSpine.focus?.({ preventScroll:true });
      applyDeferredShelfUpdates()
      maybeRefreshAppearanceStyles();
      return true;
    }
    return false;
  }

  return {
    element: root,
    refresh,
    update: refresh,
    returnToShelf,

    /** Repliega la portada abierta, si la hay. */
    close() {
      return state.session?.close() ?? Promise.resolve();
    },

    destroy() {
      state.destroyed = true;
      state.returnMotion?.cancel();
      state.session?.close({ instant: true, silent: true });
      if (state.frame) cancelAnimationFrame(state.frame);
      observer?.disconnect();
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
