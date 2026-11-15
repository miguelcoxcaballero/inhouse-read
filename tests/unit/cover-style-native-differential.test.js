// @vitest-environment node
// A cover's colour is the shelf module's own (rust-ui/src/cover_style.rs samples the pixels and calls the numeric
// core's clustering natively). This is the guard that let src/js/cover-color-wasm.js go: coverColorFromPixels is
// compared with its frozen self over the frozen bridge to the core (helpers/reference-cover-color-wasm.js), key
// for key and string for string, on every sample stride, both byte array kinds, arrays longer than the image,
// images above the one-visit copy bound, and what each answers to malformed input.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { beforeAll, expect, it } from 'vitest';
import { needRustShelf } from '../../src/js/rust-shelf.js';
import { coverColorFromPixels } from '../../src/js/cover-appearance.js';
import { rustCoverColor } from './helpers/reference-cover-color-wasm.js';
import { coverColorCases, createCoverColorPixels } from '../helpers/cover-color-cases.mjs';

let core;
beforeAll(async () => {
  core = (await WebAssembly.instantiate(readFileSync('src/wasm/inhouse_read_core.wasm'))).instance.exports;
  needRustShelf();
});
// The frozen coverColorFromPixels of cover-appearance.js over the frozen bridge.
function frozen(data, width, height) {
  if (!data || !Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) return null;
  const style = rustCoverColor(core, data, width, height);
  if (!style) throw new Error('Invalid cover pixels');
  return style;
}
const outcome = run => { try { return { value:run() }; } catch (error) { return { error:String(error?.message) }; } };
const same = (data, width, height) => {
  const expected = outcome(() => frozen(data, width, height)), actual = outcome(() => coverColorFromPixels(data, width, height));
  assert.deepStrictEqual(actual, expected, `${width} x ${height}`);
  if (expected.value) assert.deepStrictEqual(Object.keys(actual.value), Object.keys(expected.value));
  return expected;
};
const noise = (width, height, seed, alpha = 255) => {
  let s = seed >>> 0; const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    // A few inks with noise, so that the three centres and their ties are exercised.
    const ink = [[47, 107, 79], [238, 228, 211], [20, 24, 60], [200, 40, 30], [240, 236, 200], [12, 12, 14], [90, 160, 220], [226, 180, 40]][((s >>> 8) % 3 ? seed % 8 : (s >>> 10) % 8)];
    data[i] = ink[0] + (s >>> 28); data[i + 1] = ink[1] + ((s >>> 24) & 15); data[i + 2] = ink[2] + ((s >>> 20) & 15);
    data[i + 3] = alpha === 'mixed' ? [0, 47, 48, 127, 255][(s >>> 12) % 5] : alpha;
  }
  return data;
};

it('answers the shared colour cases like the bridge', () => {
  for (const input of coverColorCases) {
    const data = createCoverColorPixels(input), found = same(data, input.width, input.height);
    expect(found.value.color).toMatch(/^#[0-9a-f]{6}$/);
    // The same pixels as a plain byte array.
    same(new Uint8Array(data), input.width, input.height);
  }
});

it('samples every stride like the bridge, in row-major order', () => {
  let styles = new Set();
  // Sides around each change of stride (pixels / 1800 crossing a square), odd remainders, strips and squares.
  const sizes = [[1, 1], [1, 2], [3, 1], [7, 7], [60, 30], [71, 101], [72, 100], [85, 85], [120, 135], [127, 128], [128, 127],
    [192, 288], [193, 287], [288, 192], [300, 301], [511, 37], [37, 511], [1, 7199], [7201, 1], [2, 16000], [640, 1], [1, 32768], [400, 600], [333, 777]];
  for (const [index, [width, height]] of sizes.entries()) for (const alpha of [255, 'mixed', 0, 47, 48]) {
    const found = same(noise(width, height, 0x9e3779b9 + index * 7919, alpha), width, height);
    if (found.value) styles.add(found.value.color + found.value.shade + found.value.ink);
  }
  // The comparison is not vacuous: many different answers, both inks.
  expect(styles.size).toBeGreaterThan(12);
  expect([...styles].some(style => style.endsWith('#171512')) && [...styles].some(style => style.endsWith('#fffaf0'))).toBe(true);
});

it('reads an image above the one-visit copy bound one sampled row at a time, like the bridge', () => {
  // 1,048,576 bytes is the bound: just below, exactly at and above it, and a strip whose rows are single pixels.
  for (const [width, height, seed] of [[512, 511, 3], [512, 512, 5], [513, 512, 7], [1200, 900, 11], [900, 1200, 13], [3, 90000, 17], [90000, 3, 19]]) {
    const found = same(noise(width, height, seed, 'mixed'), width, height);
    expect(found.value.color).toMatch(/^#[0-9a-f]{6}$/);
  }
});

it('reads only the image out of a longer array and from a view with an offset', () => {
  const width = 192, height = 288, data = noise(width, height + 9, 23);
  same(data, width, height);
  const padded = new Uint8ClampedArray(data.length + 64); padded.set(data, 40);
  same(new Uint8ClampedArray(padded.buffer, 40, width * height * 4), width, height);
  same(new Uint8Array(padded.buffer, 40, width * height * 4 + 5), width, height);
});

it('answers malformed input like the bridge: the same null or the same error', () => {
  const data = noise(8, 8, 29);
  const cases = [
    [null, 0, 0], [undefined, 8, 8], [0, 8, 8], ['', 8, 8], [data, 0, 8], [data, 8, 0], [data, -1, 8], [data, NaN, 8], [data, 8, Infinity],
    [data, '8', 8], [data, 8, '8'], [data, null, 8], [data, 8, undefined], [data, .5, 8], [data, 8, .99],
    // Sides that pass the first test and fail the sample's: fractions, too few bytes, too many samples.
    [data, 1.5, 4], [data, 4, 2.5], [data, 9, 8], [data, 8, 9], [data, 1e9, 1e9], [data, 2 ** 53, 1], [data, 2 ** 27, 2 ** 27],
    [new Uint8Array(700000 * 4), 1, 700000], [new Uint8Array(32769 * 4), 1, 32769], [new Uint8Array(32768 * 4), 1, 32768],
    // Pixels that are not bytes.
    [Array.from(data), 8, 8], [new Float32Array(256), 8, 8], [new Uint16Array(256), 8, 8], [new Int8Array(256), 8, 8], [data.buffer, 8, 8],
    [new DataView(data.buffer), 8, 8], [{ length:256 }, 8, 8], ['x'.repeat(256), 8, 8], [new Uint8Array(0), 1, 1], [new Uint8ClampedArray(3), 1, 1]
  ];
  let errors = 0, nulls = 0, styles = 0;
  for (const [pixels, width, height] of cases) {
    const found = same(pixels, width, height);
    if (found.error) { errors++; expect(found.error).toBe('Invalid cover pixels'); } else if (found.value === null) nulls++; else styles++;
  }
  expect(errors).toBeGreaterThan(10); expect(nulls).toBeGreaterThan(10); expect(styles).toBeGreaterThan(0);
});
