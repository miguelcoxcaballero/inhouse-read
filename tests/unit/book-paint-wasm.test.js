// Differential test: the paper and board textures painted by the shelf module
// (rust-ui/src/book_paint.rs) against the painters frozen in helpers/reference-book-paint.js.
// A recording 2D context logs every call and every assigned property, so "the same pixels"
// is checked as "the same calls with the same numbers in the same order" on large corpora.
import { describe, expect, it } from 'vitest';
import { rustShelf } from './helpers/rust-shelf-ready.js';
import { referenceCoverCase, referenceEndpaper, referenceFinishBoard, referencePageEdges, referenceSeededRandom,
  referenceThumbnailPages } from './helpers/reference-book-paint.js';

const PROPERTIES = new Set(['fillStyle', 'strokeStyle', 'lineWidth', 'lineCap', 'globalAlpha', 'font', 'textAlign', 'textBaseline']);
/** A 2D context that remembers what it was asked to do. `measure(text)` is its text width. */
function recorder(measure = text => text.length * 17.3) {
  const log = [], state = {};
  let gradients = 0;
  const context = new Proxy({}, {
    get: (_target, key) => {
      if (PROPERTIES.has(key)) return state[key];
      if (typeof key !== 'string') return undefined;
      return (...args) => {
        log.push([key, ...args.map(arg => typeof arg === 'object' && arg?.gradient ? `gradient#${arg.gradient}` : arg)]);
        if (key === 'createLinearGradient' || key === 'createRadialGradient') {
          const id = ++gradients;
          return { gradient: id, addColorStop: (...stop) => log.push([`stop#${id}`, ...stop]) };
        }
        if (key === 'measureText') return { width: measure(args[0]) };
        return undefined;
      };
    },
    set: (_target, key, value) => {
      state[key] = value;
      log.push(['set', key, typeof value === 'object' && value?.gradient ? `gradient#${value.gradient}` : value]);
      return true;
    }
  });
  return { context, log };
}
const same = (actual, expected) => {
  expect(actual.length).toBe(expected.length);
  for (let i = 0; i < expected.length; i++) {
    // The first difference, with its neighbours, instead of a two-thousand-line diff.
    if (!Object.is(actual[i].length, expected[i].length) || actual[i].some((value, k) => !Object.is(value, expected[i][k]))) {
      throw new Error(`call ${i} differs:\n  rust:      ${JSON.stringify(actual.slice(Math.max(0, i - 1), i + 2))}\n  reference: ${JSON.stringify(expected.slice(Math.max(0, i - 1), i + 2))}`);
    }
  }
};
const both = (reference, rust) => { const a = recorder(), b = recorder(); reference(a.context); rust(b.context); same(b.log, a.log); return a.log; };

describe('page edges', () => {
  for (const size of [256, 512, 128, 1024, 100, 300.5, 64, 1]) {
    it(`paint ${size} exactly like the original`, () => {
      const log = both(context => referencePageEdges(context, size), context => rustShelf.book_page_edges(context, size));
      expect(log.length).toBeGreaterThan(size > 1 ? 1000 : 10);
    });
  }
  it('paint a canvas without gradients or stops', () => {
    // A partial canvas implementation: the gradient stops are optional, as withStops was.
    const run = paint => { const log = []; const context = new Proxy({}, { get: (_t, key) => key === 'createLinearGradient' ? () => undefined : (...args) => log.push([key, ...args]), set: (_t, key, value) => { log.push(['set', key, value]); return true; } }); paint(context); return log; };
    same(run(context => rustShelf.book_page_edges(context, 256)), run(context => referencePageEdges(context, 256)));
  });
});

describe('endpaper and thumbnail pages', () => {
  it('paint the endpaper exactly like the original', () => {
    const log = both(referenceEndpaper, context => rustShelf.book_endpaper(context));
    expect(log.length).toBeGreaterThan(5000);
  });
  it('paint the thumbnail pages exactly like the original', () => {
    expect(both(referenceThumbnailPages, context => rustShelf.book_thumbnail_pages(context)).length).toBe(2 + 11 * 2);
  });
});

describe('board finish', () => {
  it('equals the original for random widths and streams, with and without wear', () => {
    let seed = 99;
    const next = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    for (let n = 0; n < 400; n++) {
      const designWidth = n % 5 === 0 ? 676 : Math.round(1024 * (.4 + next() * .5)) + (n % 7 === 0 ? next() : 0);
      const wear = n % 4 !== 0, stream = Math.floor(next() * 4294967296);
      const first = referenceSeededRandom(stream), second = referenceSeededRandom(stream);
      // The cloth painter that came before has advanced the stream: both continue from there.
      for (let skip = n % 9; skip > 0; skip--) { first(); second(); }
      both(context => referenceFinishBoard(context, designWidth, first, { wear }), context => rustShelf.book_finish_board(context, designWidth, second, wear));
      // The same number of numbers was drawn from the host's stream.
      expect(second()).toBe(first());
    }
  });
});

describe('cloth case lettering', () => {
  const titles = ['Don Quijote de la Mancha', 'Sin título', 'A', '', ' ', 'Una  historia  con   espacios', 'Cien años de soledad y otras historias cortas que nadie leyó',
    'Palabra'.repeat(12), Array.from({ length: 40 }, (_, i) => `palabra${i}`).join(' '), 'Ñandú, óptico & ÁÉÍ', '\ud800 lone surrogate \udc00', 'emoji 📚 title 📖 here',
    'Título con espacio duro y em space', ' leading and trailing '];
  const authors = ['', 'Miguel de Cervantes Saavedra', 'X', 'Álvaro Núñez-Ortega de la Vega y Montalbán'];
  const styles = [{ ink: '#ffffff', fontFamily: 'Playfair Display' }, { ink: '#222', fontCanvasFamily: 'Lora', fontFallback: 'serif', fontWeight: 400 },
    { ink: 'rgb(10,20,30)', fontWeight: '600', fontFamily: 'Cardo' }, { ink: '#f0e6d2', fontWeight: 0 }, { ink: undefined }];
  it('equals the original for titles, authors, styles, widths, devices and text metrics', () => {
    let count = 0;
    for (const [t, title] of titles.entries()) for (const [a, author] of authors.entries()) for (const [s, style] of styles.entries()) {
      const designWidth = [676, 600, 512, 800, 337.5, 1024][(t + a + s) % 6], thumb = (t + a + s) % 5 === 0, kind = (t + s) % 3;
      const measure = text => text.length * [6, 11.3, 17.3, 29][(t * 3 + a + s) % 4];
      const seed = 1000 + t * 97 + a * 13 + s;
      const first = referenceSeededRandom(seed), second = referenceSeededRandom(seed);
      const x = recorder(measure), y = recorder(measure);
      const drawFrom = recording => (c, kindOf, size) => recording.log.push(['drawDevice', kindOf, size, c === recording.context, recording.context.fillStyle]);
      referenceCoverCase(x.context, designWidth, { title, author, style, thumb, kind, drawDevice: drawFrom(x), random: first });
      const family = `"${style.fontCanvasFamily || style.fontFamily || 'Playfair Display'}", ${style.fontFallback || 'Georgia, serif'}`;
      rustShelf.book_cover_case(y.context, designWidth, title, author, style.ink, style.fontWeight, family, thumb, thumb ? -1 : kind, drawFrom(y), second);
      same(y.log, x.log);
      expect(second()).toBe(first());
      count++;
    }
    expect(count).toBe(titles.length * authors.length * styles.length);
  });
  it('sets six lines, then an ellipsis, and the thumbnail has no device', () => {
    const run = (thumb, paint) => { const a = recorder(text => text.length * 40); paint(a.context, thumb); return a.log; };
    const title = Array.from({ length: 30 }, () => 'palabra').join(' ');
    const log = run(true, (context, thumb) => rustShelf.book_cover_case(context, 676, title, '', '#fff', undefined, 'serif', thumb, -1, () => {}, referenceSeededRandom(5)));
    const texts = log.filter(call => call[0] === 'fillText').map(call => call[1]);
    expect(texts).toHaveLength(6);
    expect(texts[5].endsWith('…')).toBe(true);
    expect(log.some(call => call[0] === 'save' && call.length === 1)).toBe(true);
  });
  it('lets a failing device painter out', () => {
    const { context } = recorder();
    expect(() => rustShelf.book_cover_case(context, 676, 'T', 'A', '#fff', undefined, 'serif', false, 1, () => { throw new Error('device'); }, referenceSeededRandom(5))).toThrow('device');
  });
});
