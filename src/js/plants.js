/**
 * plants.js — macetas decorativas de la estantería, dibujadas a mano en SVG.
 *
 * Por qué SVG generado en código y no ficheros de un banco de iconos:
 *   - Licencia limpia: es dibujo propio, path a path, como el resto de la
 *     iconografía de Inhouse (nada de Lucide/FontAwesome/Material).
 *   - Tematizable: los colores salen de custom properties, así que la misma
 *     planta se apaga sola en modo oscuro sin duplicar assets.
 *   - Variable: cada maceta recibe una semilla y elige tonos y una ligera
 *     inclinación, de modo que dos plantas iguales no se ven clonadas.
 *
 * Todas las variantes comparten sistema de coordenadas: 100 unidades de ancho
 * y la base de la maceta apoyada en y = BASELINE (126). Lo que haya por debajo
 * de esa línea (las guías del potus) cuelga por delante de la balda; de ahí
 * `overhangRatio`, que el renderizador convierte en margen negativo.
 *
 * Los mismos SVG se exportan como ficheros sueltos a `assets/plants/` con
 * `node scripts/export-plants.mjs`, para quien los quiera usar fuera del
 * componente (splash, estado vacío, documentación).
 */

const BASELINE = 126;

/** Paletas vegetales. Se elige una por semilla para romper la monotonía. */
export const PLANT_TONES = Object.freeze([
  Object.freeze({
    name: 'bosque',
    '--ihr-leaf-a': '#2F5D3F',
    '--ihr-leaf-b': '#3F7A52',
    '--ihr-leaf-c': '#6FA97B',
    '--ihr-stem': '#4A7C59'
  }),
  Object.freeze({
    name: 'salvia',
    '--ihr-leaf-a': '#4A6B51',
    '--ihr-leaf-b': '#6B8F6B',
    '--ihr-leaf-c': '#9CBE97',
    '--ihr-stem': '#5F7F5F'
  }),
  Object.freeze({
    name: 'oliva',
    '--ihr-leaf-a': '#54632F',
    '--ihr-leaf-b': '#6F8244',
    '--ihr-leaf-c': '#A3B16A',
    '--ihr-stem': '#66783E'
  })
]);

/** Barros de las macetas, también por semilla. */
export const POT_TONES = Object.freeze([
  Object.freeze({ '--ihr-pot': '#C97B4E', '--ihr-pot-shade': '#A45E37' }),
  Object.freeze({ '--ihr-pot': '#B8865F', '--ihr-pot-shade': '#966744' }),
  Object.freeze({ '--ihr-pot': '#A9A093', '--ihr-pot-shade': '#8A8175' })
]);

export const PLANT_VARIANTS = Object.freeze([
  'monstera',
  'sansevieria',
  'pothos',
  'cactus',
  'suculenta'
]);

/* ------------------------------------------------------------------ *
 * Piezas comunes
 * ------------------------------------------------------------------ */

/** Maceta troncocónica genérica: `top` es el borde superior. */
function pot(top, { halfTop = 25, halfBottom = 20 } = {}) {
  const left = 50 - halfTop;
  const right = 50 + halfTop;
  const bl = 50 - halfBottom;
  const br = 50 + halfBottom;
  return `
    <path d="M${left} ${top + 6} L${bl} ${BASELINE} H${br} L${right} ${top + 6} Z"
          fill="var(--ihr-pot, #C97B4E)"/>
    <path d="M${50} ${top + 6} L${br} ${BASELINE} H${50} Z"
          fill="var(--ihr-pot-shade, #A45E37)" opacity=".35"/>
    <rect x="${left - 3}" y="${top - 2}" width="${halfTop * 2 + 6}" height="9" rx="3"
          fill="var(--ihr-pot, #C97B4E)"/>
    <rect x="${left - 3}" y="${top + 4}" width="${halfTop * 2 + 6}" height="3"
          fill="var(--ihr-pot-shade, #A45E37)" opacity=".45"/>
    <ellipse cx="50" cy="${top + 2}" rx="${halfTop - 1}" ry="3"
             fill="var(--ihr-soil, #4A3A2C)"/>`;
}

/* ------------------------------------------------------------------ *
 * Variantes
 * ------------------------------------------------------------------ */

/** Hoja de monstera con sus muescas, base en (0,0) y ápice hacia arriba. */
const MONSTERA_LEAF =
  'M0 0 C -5 -6 -13 -9 -17 -13 L -9 -18 C -14 -21 -21 -24 -23 -29 ' +
  'L -12 -33 C -16 -38 -21 -43 -20 -48 L -9 -47 C -10 -53 -6 -57 0 -59 ' +
  'C 6 -57 10 -53 9 -47 L 20 -48 C 21 -43 16 -38 12 -33 L 23 -29 ' +
  'C 21 -24 14 -21 9 -18 L 17 -13 C 13 -9 5 -6 0 0 Z';

function monsteraLeaf(x, y, angle, scale, fill) {
  return `
    <g transform="translate(${x} ${y}) rotate(${angle}) scale(${scale})">
      <path d="${MONSTERA_LEAF}" fill="${fill}"/>
      <path d="M0 -3 L0 -54" stroke="var(--ihr-leaf-a, #2F5D3F)" stroke-width="2"
            stroke-linecap="round" opacity=".35" fill="none"/>
    </g>`;
}

function monstera() {
  return `
    <g fill="none" stroke="var(--ihr-stem, #4A7C59)" stroke-width="2.4" stroke-linecap="round">
      <path d="M50 96 C 44 86 36 78 30 68"/>
      <path d="M50 96 C 56 86 64 74 68 62"/>
      <path d="M50 96 C 48 84 48 72 48 60"/>
    </g>
    ${monsteraLeaf(30, 67, -28, 0.62, 'var(--ihr-leaf-b, #3F7A52)')}
    ${monsteraLeaf(68, 61, 26, 0.58, 'var(--ihr-leaf-c, #6FA97B)')}
    ${monsteraLeaf(48, 59, -4, 0.72, 'var(--ihr-leaf-a, #2F5D3F)')}
    ${pot(92, { halfTop: 24, halfBottom: 19 })}`;
}

const BLADE =
  'M0 0 C -6 -22 -8 -50 -3 -76 C -1.5 -80 1.5 -80 3 -76 C 8 -50 6 -22 0 0 Z';

function blade(angle, scale, fill) {
  return `
    <g transform="translate(50 98) rotate(${angle}) scale(${scale})">
      <path d="${BLADE}" fill="${fill}"/>
      <path d="M0 -8 C -3 -28 -4 -52 -1 -70" stroke="var(--ihr-leaf-c, #6FA97B)"
            stroke-width="1.6" fill="none" opacity=".5" stroke-linecap="round"/>
    </g>`;
}

function sansevieria() {
  return `
    ${blade(-31, 0.72, 'var(--ihr-leaf-a, #2F5D3F)')}
    ${blade(-14, 0.9, 'var(--ihr-leaf-b, #3F7A52)')}
    ${blade(2, 1, 'var(--ihr-leaf-a, #2F5D3F)')}
    ${blade(17, 0.85, 'var(--ihr-leaf-c, #6FA97B)')}
    ${blade(32, 0.66, 'var(--ihr-leaf-b, #3F7A52)')}
    ${pot(94, { halfTop: 23, halfBottom: 19 })}`;
}

/** Hoja de corazón del potus: se engancha en (0,0) y cae hacia abajo. */
const HEART_LEAF =
  'M0 0 C 8 3 12 11 9 18 C 6 24 1 25 0 22 C -1 25 -6 24 -9 18 C -12 11 -8 3 0 0 Z';

function heartLeaf(x, y, angle, scale, fill) {
  return `<g transform="translate(${x} ${y}) rotate(${angle}) scale(${scale})">
      <path d="${HEART_LEAF}" fill="${fill}"/>
    </g>`;
}

function pothos() {
  return `
    <g fill="none" stroke="var(--ihr-stem, #4A7C59)" stroke-width="2.2" stroke-linecap="round">
      <path d="M40 106 C 34 122 36 142 30 160"/>
      <path d="M62 106 C 70 124 66 146 72 166"/>
      <path d="M44 102 C 34 94 28 86 31 76"/>
    </g>
    ${heartLeaf(36, 119, 18, 0.62, 'var(--ihr-leaf-b, #3F7A52)')}
    ${heartLeaf(34, 138, -14, 0.7, 'var(--ihr-leaf-a, #2F5D3F)')}
    ${heartLeaf(31, 155, 8, 0.55, 'var(--ihr-leaf-c, #6FA97B)')}
    ${heartLeaf(66, 120, -22, 0.58, 'var(--ihr-leaf-c, #6FA97B)')}
    ${heartLeaf(68, 143, 14, 0.72, 'var(--ihr-leaf-b, #3F7A52)')}
    ${heartLeaf(71, 163, -6, 0.5, 'var(--ihr-leaf-a, #2F5D3F)')}
    ${heartLeaf(31, 77, 168, 0.66, 'var(--ihr-leaf-b, #3F7A52)')}
    ${pot(100, { halfTop: 24, halfBottom: 20 })}`;
}

function cactus() {
  const spines = [
    [44, 58], [56, 64], [43, 74], [57, 80], [45, 90], [55, 96],
    [29, 76], [33, 84], [68, 68], [71, 76]
  ]
    .map(([x, y]) => `<circle cx="${x}" cy="${y}" r="1.6" fill="var(--ihr-leaf-c, #6FA97B)" opacity=".75"/>`)
    .join('');
  return `
    <g fill="var(--ihr-leaf-b, #3F7A52)">
      <rect x="23" y="62" width="15" height="34" rx="7.5"/>
      <rect x="62" y="54" width="14" height="32" rx="7"/>
      <rect x="38" y="44" width="24" height="58" rx="12" fill="var(--ihr-leaf-a, #2F5D3F)"/>
    </g>
    <path d="M50 52 L50 96" stroke="var(--ihr-leaf-c, #6FA97B)" stroke-width="1.5"
          opacity=".35" fill="none"/>
    ${spines}
    <g transform="translate(50 40)">
      <circle cx="0" cy="-5" r="4" fill="var(--ihr-bloom, #d97736)"/>
      <circle cx="5" cy="-1" r="4" fill="var(--ihr-bloom, #d97736)"/>
      <circle cx="-5" cy="-1" r="4" fill="var(--ihr-bloom, #d97736)"/>
      <circle cx="3" cy="4" r="4" fill="var(--ihr-bloom, #d97736)"/>
      <circle cx="-3" cy="4" r="4" fill="var(--ihr-bloom, #d97736)"/>
      <circle cx="0" cy="0" r="2.6" fill="var(--ihr-pot, #C97B4E)"/>
    </g>
    ${pot(98, { halfTop: 22, halfBottom: 18 })}`;
}

const PETAL = 'M0 0 C -7 -6 -9 -16 0 -26 C 9 -16 7 -6 0 0 Z';

function petal(angle, scale, lift, fill) {
  return `<g transform="translate(50 ${106 - lift}) rotate(${angle}) scale(${scale})">
      <path d="${PETAL}" fill="${fill}"/>
    </g>`;
}

function suculenta() {
  const outer = [-78, -55, -32, -10, 12, 34, 57, 80]
    .map((angle) => petal(angle, 1, 0, 'var(--ihr-leaf-a, #2F5D3F)'))
    .join('');
  const middle = [-50, -25, 0, 25, 50]
    .map((angle) => petal(angle, 0.68, 4, 'var(--ihr-leaf-b, #3F7A52)'))
    .join('');
  const inner = [-22, 0, 22]
    .map((angle) => petal(angle, 0.4, 8, 'var(--ihr-leaf-c, #6FA97B)'))
    .join('');
  return `${outer}${middle}${inner}${pot(104, { halfTop: 23, halfBottom: 20 })}`;
}

const DRAWINGS = { monstera, sansevieria, pothos, cactus, suculenta };

/**
 * Alto del lienzo de cada variante (el ancho siempre es 100). Las de porte
 * recto acaban justo en la línea de la balda, así el tiesto apoya exacto; el
 * potus alarga el lienzo porque sus guías cuelgan por delante del canto.
 */
const CANVAS_HEIGHT = {
  monstera: BASELINE,
  sansevieria: BASELINE,
  pothos: 172,
  cactus: BASELINE,
  suculenta: BASELINE
};

/**
 * Metadatos geométricos de una variante.
 * @param {string} variant
 * @returns {{variant:string, viewBox:string, width:number, height:number,
 *            aspect:number, baseline:number, overhangRatio:number}}
 */
export function plantMeta(variant) {
  const name = DRAWINGS[variant] ? variant : PLANT_VARIANTS[0];
  const height = CANVAS_HEIGHT[name];
  return {
    variant: name,
    viewBox: `0 0 100 ${height}`,
    width: 100,
    height,
    aspect: 100 / height,
    baseline: BASELINE,
    // Fracción del dibujo que queda por debajo de la balda (potus colgante).
    overhangRatio: Math.max(0, (height - BASELINE) / height)
  };
}

/** Tonos (hoja + barro) deterministas para una semilla dada. */
export function tonesFor(seed) {
  const leaf = PLANT_TONES[hash(`${seed}::leaf`) % PLANT_TONES.length];
  const clay = POT_TONES[hash(`${seed}::pot`) % POT_TONES.length];
  return { ...leaf, ...clay };
}

function hash(value) {
  const text = String(value);
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

function styleAttr(tones) {
  const body = Object.entries(tones)
    .filter(([key]) => key.startsWith('--'))
    .map(([key, value]) => `${key}:${value}`)
    .join(';');
  return body ? ` style="${body}"` : '';
}

/**
 * Markup SVG de una maceta.
 *
 * @param {string} variant una de PLANT_VARIANTS (si no se reconoce, cae a la primera)
 * @param {object} [options]
 * @param {string|number} [options.seed] semilla para tonos e inclinación
 * @param {boolean} [options.standalone] añade xmlns (para escribir un .svg suelto)
 * @param {boolean} [options.tones] aplica tonos por semilla (por defecto true)
 * @param {string} [options.className]
 * @returns {string}
 */
export function plantSvg(variant, options = {}) {
  const meta = plantMeta(variant);
  const seed = options.seed ?? meta.variant;
  const useTones = options.tones !== false;
  const tones = useTones ? tonesFor(seed) : {};
  // Media vuelta de grado arriba o abajo: ninguna planta crece recta del todo.
  const lean = Math.round(((hash(`${seed}::lean`) % 100) / 100 - 0.5) * 8 * 10) / 10;
  const xmlns = options.standalone ? ' xmlns="http://www.w3.org/2000/svg"' : '';
  const cls = options.className ? ` class="${options.className}"` : '';
  return (
    `<svg${xmlns}${cls} viewBox="${meta.viewBox}" width="100%" height="100%"` +
    ` preserveAspectRatio="xMidYMax meet" aria-hidden="true" focusable="false"` +
    `${styleAttr(tones)}>` +
    `<g transform="rotate(${lean} 50 ${BASELINE})">${DRAWINGS[meta.variant]()}</g>` +
    `</svg>`
  );
}
