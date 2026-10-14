// Differential tests: the Rust shelf layout (rust-core/src/shelf_layout.rs behind
// bookshelf-layout.js) against the frozen JavaScript original kept in
// helpers/reference-bookshelf-layout.js. Every comparison is strict: same
// structure, same key order, and Object.is on every number (so -0 counts).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { core } from '../../src/js/catalogue-core.js';
import * as rust from '../../src/js/bookshelf-layout.js';
import * as original from './helpers/reference-bookshelf-layout.js';

const seeded = seed => () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
const rng = seeded(20261014);
const pick = list => list[Math.floor(rng() * list.length)];
const text = (max = 40) => String.fromCharCode(...Array.from({ length: Math.floor(rng() * max) }, () => Math.floor(rng() * 65536)));
const idLike = i => pick([`local:libro-${i}.epub:${1000 + i}`, `drive:${Math.floor(rng() * 1e9).toString(36)}`, `😀 ñandú ${i} \ud800`, `Título ${i}|Autor`, text(), '']);

function book(i) {
  const record = {};
  if (rng() < 0.85) record.id = idLike(i);
  if (rng() < 0.1) record.path = `/x/${i}.pdf`;
  if (rng() < 0.7) record.title = pick(['Ana', 'beto', 'Álvaro', 'zeta 10', 'zeta 9', 'ñu', '', 'Carlos', 'carlos']);
  if (rng() < 0.7) record.author = pick(['Zola', 'Alas', 'borges', 'Mann', 'Ñ', '', 'ALAS', 'Borges']);
  const words = pick([undefined, undefined, NaN, -5, 0, 1, 299, 12000, 90000, 270000, 600000, 1e7, Infinity, '1200', null, rng() * 400000]);
  if (words !== undefined) record.wordCount = words;
  if (rng() < 0.6) record.progressFraction = pick([0, 1, 0.3, 0.9999, 0.001, -2, 5, NaN, null, '0.5', 'x', Infinity, rng(), 0]);
  else if (rng() < 0.3) record.progress = pick([0.2, 1, 0, rng()]);
  if (rng() < 0.7) record.lastOpenedAt = pick([null, 0, NaN, 100 + i, 5000 - i, rng() * 1e12, '77', 3000, 3000]);
  if (rng() < 0.35) record.shelfOrder = pick([0, 1, 2, i, 7 - i % 5, NaN, Infinity, '3', -4, 2.5, null]);
  if (rng() < 0.1) record.locator = { kind: 'pdf-page', value: 1 };
  return record;
}
const library = size => Array.from({ length: size }, (_, i) => book(i));

describe('spine styles', () => {
  const OPTIONS = [{}, { minWidth: 26, maxWidth: 44 }, { pageThickness: .046, bindingThickness: 2.6, minWidth: 6, maxWidth: 54 },
    { minWidth: 0, maxWidth: 180 }, { minWidth: 2, maxWidth: 20, pageThickness: .039, bindingThickness: 2.25 },
    { minWidth: 0, maxWidth: 50, pageThickness: -1 }, { minHeightRatio: 0, maxHeightRatio: 1.16 },
    { pageThickness: 0 }, { pageThickness: '0.1', bindingThickness: 3 }, { pageThickness: NaN }, { minWidth: 30, maxWidth: 10 },
    { minWidth: -5, maxWidth: 0.4, pageThickness: 0.0005 }, { bindingThickness: 5 }];

  it('gives the original style for 3000 random books under every option set', () => {
    for (const options of OPTIONS) for (const record of library(250)) {
      expect(rust.spineStyleFor(record, options)).toStrictEqual(original.spineStyleFor(record, options));
    }
  });

  it('keeps the palette identity of the catalogue, never a copy', () => {
    const styles = rust.spineStylesFor(library(400));
    for (const style of styles) expect(rust.SPINE_PALETTE).toContain(style.palette);
    expect(styles.map(style => style.palette.name).filter((name, i, all) => all.indexOf(name) === i).length).toBe(rust.SPINE_PALETTE.length);
  });

  it('equals the original for every seed shape, including lone surrogates and NUL', () => {
    const seeds = ['', 'a', 'local:libro.pdf:12345', 'drive:1AbC_dEf-GhI', 'Título|Autor', 'ñandú ✓', '😀 emoji 😀 \ud800 lone',
      '\u0000￿', 'x'.repeat(5000), '\\', 'A\0B', '\ud800', '\udc00'];
    for (let n = 0; n < 4000; n++) seeds.push(text());
    for (let n = 0; n < 1000; n++) seeds.push(`local:${Math.floor(rng() * 4e9).toString(36)}.epub:${Math.floor(rng() * 9999999)}`);
    const books = seeds.map(id => ({ id: id === '' ? 'blank' : id, wordCount: 90000 }));
    expect(rust.spineStylesFor(books)).toStrictEqual(books.map(record => original.spineStyleFor(record)));
    expect(rust.spineStylesFor([{ id: '' }, null, undefined, {}])).toStrictEqual([{ id: '' }, null, undefined, {}].map(record => original.spineStyleFor(record)));
  });

  it('batches 700 books in one call, equal to the original one by one', () => {
    const books = Array.from({ length: 700 }, (_, index) => ({ id: index % 11 === 0 ? `😀日本語عنوان ${index}` : `local:Immune Journey-${index}:48291`,
      wordCount: index % 5 === 0 ? undefined : index * 655 + (index % 11) / 3, title: `Book ${index}`, author: 'Author', shelfOrder: index }));
    for (const options of OPTIONS) expect(rust.spineStylesFor(books, options)).toStrictEqual(books.map(record => original.spineStyleFor(record, options)));
    expect(rust.spineStylesFor([])).toStrictEqual([]);
  });
});

describe('packing into shelves', () => {
  const VARIANTS = [undefined, ['monstera', 'sansevieria', 'pothos', 'cactus', 'suculenta'], ['a'], ['a', 'a'], ['a', 'b', 'a'], [], ['x', 'y']];
  function options() {
    const value = {
      shelfWidth: pick([20, 90, 320, 360, 390, 414, 600, 900, NaN, 120.5]), padding: pick([0, 8, 16, 40, 200]),
      gap: pick([0, 3, 5.5]), plantEvery: pick([1, 3, 5, 100, 0]), plantWidth: pick([20, 46, 58, 80]),
      maxTailPlants: pick([0, 1, 2, 3, 5]), tiltThreshold: pick([0, 16, 40]), maxTilt: pick([2, 8, 20]),
      plantVariants: pick(VARIANTS), spine: pick([undefined, { pageThickness: .046, bindingThickness: 2.6, minWidth: 6, maxWidth: 54 }, { minWidth: 26, maxWidth: 44 }])
    };
    if (rng() < .5) value.plantWidthFor = variant => ({ monstera: 64, pothos: 52, a: 70, x: 33.5 })[variant] ?? undefined;
    // A pure function of the book, so both implementations see the same answers.
    if (rng() < .5) value.displayWidthFor = (record, style) => [style.width, style.width + 32, Math.max(style.width, 16), NaN, undefined, 17.5, 'abc'][String(record?.id).length % 7];
    for (const key of Object.keys(value)) if (value[key] === undefined && key !== 'plantVariants' && key !== 'spine') delete value[key];
    if (value.plantVariants === undefined) delete value.plantVariants;
    return value;
  }

  it('reproduces the original plan for 1500 random libraries and option sets', () => {
    for (let round = 0; round < 1500; round++) {
      const books = library(Math.floor(rng() * (round % 10 === 0 ? 200 : 40)));
      const config = options();
      const actual = rust.layoutShelves(books, config), expected = original.layoutShelves(books, config);
      expect(actual).toStrictEqual(expected);
      for (const shelf of actual) for (const item of shelf.items) if (item.kind === 'book') expect(books).toContain(item.book);
    }
  });

  it('keeps references, order and prepared styles', () => {
    const books = library(60), styles = rust.spineStylesFor(books);
    const plan = rust.layoutShelves(books, { shelfWidth: 390 }, styles);
    const placed = plan.flatMap(shelf => shelf.items.filter(item => item.kind === 'book'));
    expect(placed.map(item => item.book)).toEqual(books);
    placed.forEach((item, index) => { expect(item.book).toBe(books[index]); expect(item.style).toBe(styles[index]); });
    expect(plan).toStrictEqual(original.layoutShelves(books, { shelfWidth: 390 }));
    const half = styles.slice(0, 20);
    expect(rust.layoutShelves(books, { shelfWidth: 390 }, half)).toStrictEqual(original.layoutShelves(books, { shelfWidth: 390 }));
  });

  it('computes styles lazily, after the previous book was measured', () => {
    const base = library(3).map((record, index) => ({ ...record, id: `lazy-${index}`, wordCount: 1000 })), make = () => base.map(record => ({ ...record }));
    const run = layout => { const list = make(); return layout(list, { plantEvery: 100, maxTailPlants: 0,
      displayWidthFor: (record, style) => { list[1].wordCount = 80000; return style.width; } }); };
    expect(run(rust.layoutShelves)).toStrictEqual(run(original.layoutShelves));
  });

  it('refuses nothing it can solve: empty, narrow and non-array inputs match', () => {
    for (const value of [null, undefined, [], 'abc', {}, library(4)]) {
      for (const config of [{}, { shelfWidth: 20, padding: 16 }, { shelfWidth: 32, padding: 16 }, { shelfWidth: 33, padding: 16 }]) {
        expect(rust.layoutShelves(value, config)).toStrictEqual(original.layoutShelves(value, config));
      }
    }
  });
});

describe('sections and plans', () => {
  const MODES = [undefined, 'none', 'author', 'title', 'bogus'];
  const LIMITS = [undefined, 0, 1, 2, 2.7, -1, NaN, Infinity, null, 6, 100];

  it('splits like the original for 2500 random libraries', () => {
    for (let round = 0; round < 2500; round++) {
      let books = library(Math.floor(rng() * 30));
      if (round % 7 === 0 && books.length > 3) books = [...books, books[0], books[1], null, undefined, 0];
      const config = { sort: pick(MODES), recentLimit: pick(LIMITS) };
      expect(rust.buildSections(books, config)).toStrictEqual(original.buildSections(books, config));
    }
  });

  it('builds the same complete plans, with prepared styles or without', () => {
    for (let round = 0; round < 120; round++) {
      const books = library(Math.floor(rng() * 80));
      const config = { shelfWidth: pick([320, 390, 600]), sort: pick(MODES), recentLimit: pick([undefined, 0, 3]), spine: pick([undefined, { pageThickness: .046, bindingThickness: 2.6, minWidth: 6, maxWidth: 54 }]) };
      const expected = original.planBookshelf(books, config);
      expect(rust.planBookshelf(books, config)).toStrictEqual(expected);
      expect(rust.planBookshelf(books, config, (list, spine) => rust.spineStylesFor(list, spine))).toStrictEqual(expected);
    }
  });

  it('answers progress and in-progress like the original', () => {
    const values = [undefined, null, 0, 1, 0.5, -3, 4, NaN, Infinity, -Infinity, '0.3', 'x', '', true, [], {}, 1e-300];
    for (const a of values) for (const b of values) for (const lastOpenedAt of [undefined, null, 5]) {
      const record = { progressFraction: a, progress: b, lastOpenedAt };
      expect(Object.is(rust.progressOf(record), original.progressOf(record))).toBe(true);
      expect(rust.isInProgress(record)).toBe(original.isInProgress(record));
    }
    expect(rust.progressOf(null)).toBe(0);
  });

  it('draws the same bookmark ribbon', () => {
    const options = [{}, { minPeek: 2, maxPeek: 12 }, { minPeek: 0, maxPeek: 7.77 }, { minPeek: undefined }];
    for (let n = 0; n < 4000; n++) {
      const record = n % 3 === 0 ? book(n) : { progressFraction: pick([0, 1, 0.001, 0.996, 0.5, rng(), rng(), -1, 9, NaN]), locator: pick([undefined, { v: 1 }]) };
      for (const config of options) expect(rust.bookmarkFor(record, config)).toStrictEqual(original.bookmarkFor(record, config));
    }
    for (const empty of [null, undefined, {}, { progressFraction: 'basura' }, 0, 'x']) expect(rust.bookmarkFor(empty)).toStrictEqual(original.bookmarkFor(empty));
  });

  it('keeps the default objects of the original', () => {
    for (const name of ['SPINE_PALETTE', 'SPINE_TEXTURES', 'DEFAULT_SPINE', 'DEFAULT_LAYOUT', 'DEFAULT_SECTIONS', 'DEFAULT_BOOKMARK']) {
      expect(rust[name], name).toStrictEqual(original[name]);
      expect(Object.keys(rust[name]), name).toEqual(Object.keys(original[name]));
      expect(Object.isFrozen(rust[name]), name).toBe(Object.isFrozen(original[name]));
    }
    expect(original.withDefaults({ a: 1, b: 2 }, { a: undefined, c: 3 })).toStrictEqual(rust.withDefaults({ a: 1, b: 2 }, { a: undefined, c: 3 }));
    expect(rust.seedFor({ title: 'T', author: 'A' })).toBe(original.seedFor({ title: 'T', author: 'A' }));
    for (const value of [null, undefined, {}, { id: 0 }, { id: '' , path: 'p' }, { path: 'q' }, { id: 5 }, { title: 1 }]) {
      expect(rust.seedFor(value)).toBe(original.seedFor(value));
    }
  });
});

describe('kernel limits and memory', () => {
  let arena;
  beforeAll(() => { arena = core.alloc_f64(256); });
  afterAll(() => { core.free_f64(arena, 256); });

  it('rejects null, misaligned and out-of-range requests without trapping', () => {
    const at = arena;
    expect(core.spine_styles(0, 0, 0, 0, 0, 0, 0)).toBe(0);
    expect(core.spine_styles(at + 1, at, at, at, 0, 0, at)).toBe(0);
    expect(core.spine_styles(at, at, at, at, 5_000_000, 0, at)).toBe(0);
    expect(core.spine_styles(at, at, at, at, 0, 1 << 30, at)).toBe(0);
    // Seed offsets that run backwards or past the end of the units.
    const view = new Float64Array(core.memory.buffer, at, 256);
    view.set([0, 100, 0, 1, 0, 0, 0], 0); view.set([NaN], 8); view.set([5, 2], 16);
    expect(core.spine_styles(at, at + 64, at + 128, at + 192, 1, 0, at + 8 * 40)).toBe(0);
    expect(core.layout_shelves(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0)).toBe(0);
    expect(core.layout_shelves(at, at, at, 5000, at, at, at, at, 0, 0, at, 0)).toBe(0);
    expect(core.library_sections(0, 0, 0, 0, 0)).toBe(0);
    expect(core.library_sections(at, at, at, 5_000_000, at)).toBe(0);
    expect(core.bookmark_for(0.5, 0, 5, 20, 0)).toBe(0);
    expect(core.bookmark_for(0.5, 0, 5, 20, at + 1)).toBe(0);
    expect(core.catalogue_json(0, 0)).toBeGreaterThan(1000);
  });

  it('survives hostile configuration without hanging and rejects runaway tails', () => {
    const books = library(5);
    expect(rust.layoutShelves(books, { maxTailPlants: 0 })).toStrictEqual(original.layoutShelves(books, { maxTailPlants: 0 }));
    // With no gap and zero-width pots the original loops until memory runs out.
    expect(() => rust.layoutShelves(books, { maxTailPlants: 1e9, gap: 0, plantWidth: 0, shelfWidth: 5000, plantWidthFor: () => 0 })).toThrow(RangeError);
  });

  it('leaves the memory as it found it over thousands of plans', () => {
    const books = library(120);
    const settle = () => { rust.planBookshelf(books, { shelfWidth: 390, sort: 'title' }); rust.spineStylesFor(books); rust.bookmarkFor(books[3]); };
    settle(); settle();
    const size = core.memory.buffer.byteLength;
    for (let n = 0; n < 2000; n++) settle();
    expect(core.memory.buffer.byteLength).toBe(size);
  });
});
