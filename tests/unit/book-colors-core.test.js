// Differential tests: the book colours of the Rust core (rust-core/src/book_colors.rs
// behind book-colors.js) against the frozen JavaScript original.
import { describe, expect, it } from 'vitest';
import { core } from '../../src/js/catalogue-core.js';
import * as rust from '../../src/js/book-colors.js';
import * as original from './helpers/reference-book-colors.js';

const seeded = seed => () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
const rng = seeded(424242);
const hex = rgb => `#${rgb.map(v => v.toString(16).padStart(2, '0')).join('')}`;
const same = value => {
  expect(rust.bookColorOptions(value), String(value)).toStrictEqual(original.bookColorOptions(value));
  expect(rust.spineColorStyle(value), String(value)).toStrictEqual(original.spineColorStyle(value));
};

describe('colour text', () => {
  it('reads every kind of value like the original', () => {
    const values = ['', '#', '#abc', 'abc', 'ABC', '#AbCdEf', 'abcdef', '#abcd', '#abcdefg', '##abc', ' #abc ', '\t\n#abc\r\n', '#ab c', '#ggg', '#12345g',
      '＃abc', '#ａｂｃ', '#abc\u0000', '\ud800abc', 'abc\udc00', '﻿#abc', '#abc ', '᠎#abc', 'x'.repeat(100000), ' '.repeat(100000) + '#abc',
      undefined, null, 0, 123, 123456, -1, NaN, true, [], ['#abc'], {}, { toString: () => '#102030' }, 1e21, '#0f0', '#00f', '#FFF', '#000', '#808080'];
    for (const value of values) same(value);
    expect(rust.bookColorOptions()).toStrictEqual(original.bookColorOptions());
  });

  it('treats every UTF-16 unit around a colour as the original does (trim set and look-alikes)', () => {
    for (let unit = 0; unit < 65536; unit++) {
      const character = String.fromCharCode(unit);
      for (const value of [`${character}#abc`, `#abc${character}`, `${character}${character}abc${character}`, `#ab${character}`, `${character}`]) same(value);
    }
  }, 120000);

  it('answers the colour a record may keep exactly as the original', () => {
    for (const value of ['#ABC', 'abc', '#a1b2c3', '  #FFF ', 'bad', null, undefined, '#12', 4, {}]) {
      const record = { spineColorOverride: value, spineTextColor: value };
      expect(rust.spineCustomization(record), String(value)).toStrictEqual(original.spineCustomization(record));
    }
    for (const record of [null, undefined, {}, { spineColorOverride: null, spineTextColor: null }, { shelfPosition: null }, { shelfPosition: { shelf: 2, x: 4 } },
      { shelfPosition: { shelf: 1.5, x: 0.5 } }, { spineFinish: 'gold', spineTextFinish: 'x', coverFinish: 'glossy', pageEdgeFinish: 'nope', spineSurfaceFinish: 'x' },
      { coverRelief: null, author: ['A', { name: 'B' }], spineEngraved: true, spineTitleOverride: 'x'.repeat(200), spineFontFamily: 'Lora', spineFontSize: 99, spineAuthorFontSize: 1 }, { spineFontFamily: 'Comic', spineFontSize: NaN }]) {
      expect(rust.spineCustomization(record)).toStrictEqual(original.spineCustomization(record));
    }
  });
});

describe('cloths and ink', () => {
  it('give the original answer for 400000 random colours', () => {
    for (let n = 0; n < 400000; n++) {
      const rgb = [Math.floor(rng() * 256), Math.floor(rng() * 256), Math.floor(rng() * 256)];
      const value = n % 3 === 0 ? hex(rgb).toUpperCase() : n % 3 === 1 ? hex(rgb) : hex(rgb).replace(/^#(.)\1(.)\2(.)\3$/, '#$1$2$3');
      same(value);
    }
  }, 120000);

  it('give the original answer on every grey and every near-grey (the saturation limit)', () => {
    for (let grey = 0; grey < 256; grey++) for (const d of [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1], [2, 0, 1], [5, 3, 0], [10, 0, 6], [14, 7, 0], [20, 0, 0]]) {
      same(hex([0, 1, 2].map(i => Math.max(0, Math.min(255, grey + d[i])))));
    }
  });

  it('decide the cloth separation like Math.hypot at the threshold of 80', () => {
    const cloths = ['#6e2a2a', '#9a4a2c', '#9a7432', '#5e6130', '#4f6a2e', '#245439', '#1f5359', '#3a5470', '#1f2f52', '#3b3368', '#5a2a50', '#7a2e3e'];
    const channels = hexText => [1, 3, 5].map(i => parseInt(hexText.slice(i, i + 2), 16));
    let cases = 0;
    for (let a = 0; a <= 80; a++) for (let b = a; b <= 80; b++) for (let c = b; c <= 80; c++) {
      const squares = a * a + b * b + c * c;
      if (squares < 6396 || squares > 6404) continue;
      for (const cloth of cloths) {
        const base = channels(cloth);
        for (const signs of [[1, 1, 1], [-1, 1, 1], [1, -1, 1], [1, 1, -1], [-1, -1, 1], [1, -1, -1], [-1, 1, -1], [-1, -1, -1]]) {
          for (const order of [[a, b, c], [c, a, b], [b, c, a]]) {
            const rgb = base.map((value, i) => Math.max(0, Math.min(255, value + signs[i] * order[i])));
            same(hex(rgb)); cases++;
          }
        }
      }
    }
    expect(cases).toBeGreaterThan(5000);
  }, 120000);

  it('keep the ink decision away from any rounding difference of pow', () => {
    // spineColorStyle uses ** 2.4, which rounds differently on every libm. The ink
    // follows a comparison, so it is safe only if no colour sits within pow's error
    // (about 1e-15, a few ulps) of the tie. Measure the smallest margin over all 16.7 million:
    // it is about 7e-8, eight orders of magnitude above any libm's pow error.
    const linear = Array.from({ length: 256 }, (_, i) => { const v = i / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
    let narrowest = Infinity;
    const close = [];
    for (let r = 0; r < 256; r++) for (let g = 0; g < 256; g++) for (let b = 0; b < 256; b++) {
      const luminance = 0.2126 * linear[r] + 0.7152 * linear[g] + 0.0722 * linear[b];
      const white = 1.05 / (luminance + 0.05), dark = (luminance + 0.05) / 0.057;
      const margin = Math.abs(white - dark) / Math.max(white, dark);
      if (margin < narrowest) narrowest = margin;
      if (margin < 2e-3) close.push([r, g, b]);
    }
    expect(narrowest).toBeGreaterThan(1e-9);
    expect(close.length).toBeGreaterThan(10);
    for (const rgb of close) same(hex(rgb));
  }, 120000);
});

describe('colour kernels', () => {
  it('reject unusable pointers and over-long requests without trapping', () => {
    const out = core.alloc_f64(4), units = core.alloc_f64(2);
    try {
      for (const kernel of [core.book_color_options, core.spine_color_style, core.color_hex]) {
        expect(kernel(units, 3, 0)).toBe(0);
        expect(kernel(units + 1, 3, out)).toBe(0);
        expect(kernel(0, 3, out)).toBe(0);
        expect(kernel(units, 1 << 21, out)).toBe(0);
        expect(kernel(0, 0, out)).toBe(kernel === core.color_hex ? 0 : 1);
      }
    } finally { core.free_f64(out, 4); core.free_f64(units, 2); }
  });

  it('leaves the memory as it found it', () => {
    for (let n = 0; n < 200; n++) { rust.bookColorOptions('#a1b2c3'); rust.spineColorStyle('#445566'); rust.spineCustomization({ spineColorOverride: '#fff' }); }
    const size = core.memory.buffer.byteLength;
    for (let n = 0; n < 40000; n++) { rust.bookColorOptions(hex([n % 256, (n >> 3) % 256, (n >> 5) % 256])); rust.spineColorStyle('#a1b2c3'.padEnd(2000, ' ')); }
    expect(core.memory.buffer.byteLength).toBe(size);
  });

  it('keeps the finish tables of the original', () => {
    expect(rust.SURFACE_FINISHES).toStrictEqual(original.SURFACE_FINISHES);
    expect(Object.isFrozen(rust.SURFACE_FINISHES.glossy)).toBe(true);
    expect(rust.METAL_COLORS).toStrictEqual(original.METAL_COLORS);
    for (const value of ['glossy', 'satin', 'matte', 'bogus', undefined, 5, '__proto__', 'toString']) {
      expect(rust.surfaceFinish(value)).toBe(original.surfaceFinish(value));
      expect(rust.surfaceFinish(value, 'matte')).toBe(original.surfaceFinish(value, 'matte'));
      expect(rust.spineFinish(value)).toBe(original.spineFinish(value));
    }
    for (const position of [null, undefined, { shelf: 1, x: .5 }, { shelf: -1, x: 0 }, { shelf: 1, x: NaN }, { shelf: 2, x: 9 }, { shelf: 1.5, x: 0 }]) {
      expect(rust.normalizeShelfPosition(position)).toStrictEqual(original.normalizeShelfPosition(position));
    }
  });
});
