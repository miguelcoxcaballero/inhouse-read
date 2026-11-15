// @vitest-environment node
// The title search's pixel planes are the shelf module's own (rust-ui/src/font_planes.rs calls the numeric
// core's kernels natively). This is the guard that let src/js/font-glyph-wasm.js go: the glyph crop, the mask
// of one search step, the grey and near-edge planes of a cover and the neighbour map are compared with the
// frozen bridge to the core (helpers/reference-font-glyph-wasm.js) value for value and, for the float planes,
// bit for bit (their borders are NaN), including what each answers to malformed input.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { beforeAll, expect, it } from 'vitest';
import { needRustShelf } from '../../src/js/rust-shelf.js';
import { rustGlyphMask, rustNearEdgeMap, rustPrepareCoverPixels } from './helpers/reference-font-glyph-wasm.js';

let core, shelf;
beforeAll(async () => {
  core = (await WebAssembly.instantiate(readFileSync('src/wasm/inhouse_read_core.wasm'))).instance.exports;
  shelf = needRustShelf();
});
const raster = (w, h, seed = 1, edge = 2) => {
  let s = seed; const a = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0; const at = (y * w + x) * 4;
    a[at] = s >>> 24; a[at + 1] = s >>> 16; a[at + 2] = s >>> 8;
    a[at + 3] = x >= edge && y >= edge && x < w - edge && y < h - edge ? [0, 99, 100, 101, 255][s % 5] : 0;
  }
  return a;
};
const bits = plane => plane === null ? null : Buffer.from(plane.buffer, plane.byteOffset, plane.byteLength).toString('hex');
// The frozen `glyphMask` of cover-appearance.js over the frozen bridge.
const frozenGlyph = (raw, width, rows, stride = width) => {
  const mask = rustGlyphMask(core, raw, width, rows, stride);
  if (mask === undefined) throw new Error('Invalid glyph raster');
  return mask;
};
// The frozen tail of fontMask: `mask && core.font_mask_fits(mask.width, mask.height, maxWidth, rows) ? mask : null`.
const frozenTitle = (raw, maxWidth, height, rows) => { const mask = frozenGlyph(raw, maxWidth, height); return mask && core.font_mask_fits(mask.width, mask.height, maxWidth, rows) ? mask : null; };
const outcome = run => { try { return { value:run() }; } catch (error) { return { error:String(error?.message) }; } };

it('crops every glyph like the bridge: sides, area, mask and the three ordered point lists', () => {
  let present = 0, empty = 0;
  for (const [w, h] of [[1, 1], [2, 19], [19, 2], [7, 7], [30, 22], [80, 66], [192, 176], [384, 352], [1024, 1024]]) {
    const raw = raster(w, h, 19), copy = raw.slice();
    for (const stride of [undefined, w, 3, 65535]) {
      const expected = frozenGlyph(raw, w, h, stride), actual = shelf.glyph_mask(raw, w, h, stride);
      assert.deepEqual(actual, expected); expected ? present++ : empty++;
      if (expected) {
        expect(Object.keys(actual)).toEqual(Object.keys(expected));
        for (const key of ['mask', 'perimeter', 'foreground', 'background']) expect(actual[key].constructor).toBe(expected[key].constructor);
      }
    }
    assert.deepEqual(raw, copy);
  }
  for (let n = 0; n < 60; n++) {
    const w = 20 + n, h = 30 + n % 13, raw = raster(w, h, n + 1, n % 4);
    assert.deepEqual(shelf.glyph_mask(raw, w, h, 120), frozenGlyph(raw, w, h, 120));
    // A Uint8Array and a longer array than the raster needs read the same.
    const longer = new Uint8Array(raw.length + 9); longer.set(raw);
    assert.deepEqual(shelf.glyph_mask(longer, w, h), frozenGlyph(longer, w, h));
  }
  for (const alpha of [0, 99, 100, 101, 255]) {
    const raw = new Uint8ClampedArray(50 * 40 * 4).fill(alpha);
    assert.deepEqual(shelf.glyph_mask(raw, 50, 40), frozenGlyph(raw, 50, 40));
  }
  expect(present).toBeGreaterThan(15); expect(empty).toBeGreaterThan(10);
});

it('answers malformed rasters with the error of the bridge', () => {
  const raw = raster(80, 66);
  for (const [data, w, h, stride] of [[raw, 0, 66, 80], [raw, 80, 0, 80], [raw, -1, 66, 80], [raw, Infinity, 66, 80], [raw, 80.2, 66, 80],
    [raw, 80, 66, 0], [raw, 80, 66, 65536], [raw, 80, 66, 1.5], [raw, 2048, 2048, 2048], [raw, 2049, 1, 1], [raw, 81, 66, 80], [raw, '80', 66, 80],
    [raw, 80, '66', 80], [raw, 80, 66, null], [raw, NaN, 66, 80], [Array.from(raw), 80, 66, 80], [null, 80, 66, 80], [undefined, 80, 66, 80],
    [new Float32Array(80 * 66 * 4), 80, 66, 80], [raw.buffer, 80, 66, 80]]) {
    const expected = outcome(() => frozenGlyph(data, w, h, stride));
    expect(expected.error).toBe('Invalid glyph raster');
    expect(outcome(() => shelf.glyph_mask(data, w, h, stride))).toEqual(expected);
    expect(outcome(() => shelf.title_glyph_mask(data, w, h, 60))).toEqual(outcome(() => frozenTitle(data, w, h, 60)));
  }
});

it('keeps the mask of a search step only when it fits the title band, like fontMask did', () => {
  const frozen = frozenTitle;
  let kept = 0, dropped = 0;
  for (let n = 0; n < 80; n++) {
    const w = 24 + (n * 7) % 170, h = 12 + (n * 11) % 150, raw = raster(w, h, n + 3, 1 + n % 5);
    for (const rows of [0, 1, h - 3, h, h + 1, Math.floor(h * .82), h * 2, 4096, NaN, undefined, -5, 12.5]) {
      const expected = frozen(raw, w, h, rows), actual = shelf.title_glyph_mask(raw, w, h, rows);
      assert.deepEqual(actual, expected); expected ? kept++ : dropped++;
    }
  }
  const blank = new Uint8ClampedArray(64 * 40 * 4);
  expect(shelf.title_glyph_mask(blank, 64, 40, 30)).toBeNull(); expect(frozen(blank, 64, 40, 30)).toBeNull();
  expect(kept).toBeGreaterThan(50); expect(dropped).toBeGreaterThan(50);
});

it('prepares the grey and near-edge planes byte for byte and classifies a cover the same', () => {
  let busy = 0, quiet = 0;
  for (const [w, h] of [[1, 1], [1, 7], [7, 1], [2, 2], [3, 3], [12, 12], [80, 66], [128, 192], [192, 288], [257, 129], [512, 512]]) for (const edges of [true, false]) for (const seed of [1, 9]) {
    const raw = raster(w, h, seed);
    if (seed === 9) for (let i = 0; i < w * h; i++) raw[i * 4] = raw[i * 4 + 1] = raw[i * 4 + 2] = 120 + (i % w) % 3;
    const copy = raw.slice(), expected = rustPrepareCoverPixels(core, raw, w, h, edges), actual = shelf.cover_pixel_planes(raw, w, h, edges);
    expect(Object.keys(actual)).toEqual(Object.keys(expected));
    expect(actual.busy).toBe(expected.busy); expected.busy ? busy++ : quiet++;
    expect(actual.gray.constructor).toBe(Uint8Array); expect(bits(actual.gray)).toBe(bits(expected.gray));
    if (edges) expect(actual.near.constructor).toBe(Float32Array);
    expect(bits(actual.near)).toBe(bits(expected.near));
    assert.deepEqual(raw, copy);
  }
  expect(busy).toBeGreaterThan(3); expect(quiet).toBeGreaterThan(3);
  const raw = raster(80, 66);
  for (const [data, w, h] of [[raw, 0, 66], [raw, -1, 66], [raw, 80, 0], [raw, 80.5, 66], [raw, Infinity, 66], [raw, 80, 67], [raw, 2048, 2048],
    [raw, 2049, 1], [raw, '80', 66], [[], 80, 66], [null, 80, 66], [new Float32Array(80 * 66 * 4), 80, 66]]) {
    expect(rustPrepareCoverPixels(core, data, w, h, true)).toBeNull();
    expect(shelf.cover_pixel_planes(data, w, h, true)).toBeNull();
  }
});

it('maps near edges bit for bit, NaN cells and flat-array borders included', () => {
  for (const [count, width] of [[0, 1], [1, 1], [5, 1], [30, 6], [30, 15], [30, 16], [30, 31], [48 * 79, 48], [192 * 236, 192], [7, 2 ** 32 + 3], [7, 2 ** 53 - 1]]) {
    let s = count + width;
    const edges = Float32Array.from({ length:count }, (_, i) => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return i % 17 === 5 ? NaN : i % 23 === 7 ? -Infinity : (s >>> 8) / 65536; });
    const copy = edges.slice(), expected = rustNearEdgeMap(core, edges, width), actual = shelf.near_edge_map(edges, width);
    expect(actual.constructor).toBe(Float32Array); expect(bits(actual)).toBe(bits(expected)); expect(bits(edges)).toBe(bits(copy));
  }
  for (const [edges, width] of [[new Float64Array(4), 2], [[1, 2, 3, 4], 2], [null, 2], [new Float32Array(4), 0], [new Float32Array(4), -1],
    [new Float32Array(4), 1.5], [new Float32Array(4), '2'], [new Float32Array(4), NaN], [new Float32Array(4), undefined]]) {
    const expected = outcome(() => rustNearEdgeMap(core, edges, width));
    expect(expected.error).toBe('Invalid edge plane');
    expect(outcome(() => shelf.near_edge_map(edges, width))).toEqual(expected);
  }
});
