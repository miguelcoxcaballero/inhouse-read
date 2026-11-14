// @vitest-environment node
// The title-font policy is the shelf module's own (rust-ui/src/font_policy.rs calls the numeric core's kernels
// natively). This is the guard that let src/js/font-policy-wasm.js go: a family's wrap cache is compared with
// the frozen bridge to the core (helpers/reference-font-policy-wasm.js) line for line (UTF-16 unit for unit),
// measurement for measurement (same text, same order, cached or not), error for error. The search plan and the
// choice among scores have no export of their own: the whole search is compared with its frozen JavaScript in
// cover-appearance-orchestration-differential.test.js, which logs every canvas call the plans produce.
import { readFileSync } from 'node:fs';
import { beforeAll, expect, it } from 'vitest';
import { needRustShelf } from '../../src/js/rust-shelf.js';
import { createRustFontWrapCache } from './helpers/reference-font-policy-wasm.js';

let core, shelf;
beforeAll(async () => {
  core = (await WebAssembly.instantiate(readFileSync('src/wasm/inhouse_read_core.wasm'))).instance.exports;
  shelf = needRustShelf();
});
const units = text => Array.from({ length: text.length }, (_, index) => text.charCodeAt(index));
const width = text => Array.from(text).reduce((sum, c) => sum + c.codePointAt(0) % 19, 0);
/** One call on both caches with canvases that log what they are asked to measure. */
function both(frozen, native, title, limit, key, measure = width) {
  const run = (cache, calls) => {
    try { return { lines: cache.lines({ measureText(text) { calls.push(units(text)); return { width: measure(text) }; } }, title, limit, key) }; }
    catch (error) { return { error: `${error?.constructor?.name}: ${error?.message}` }; }
  };
  const expectedCalls = [], actualCalls = [];
  const expected = run(frozen, expectedCalls), actual = run(native, actualCalls);
  expect(actual.error, `error for ${JSON.stringify(title)} at ${limit}`).toBe(expected.error);
  if (!expected.error) {
    expect(Array.isArray(actual.lines)).toBe(true);
    expect(actual.lines.map(units)).toEqual(expected.lines.map(units));
  }
  expect(actualCalls).toEqual(expectedCalls);
  return expectedCalls.length;
}
function titles() {
  const values = ['', null, undefined, 0, 1829, 'one', '  Quiet   Garden \n\t five six seven eight nine ten ', '東京の本 日本語 テスト', 'İstanbul \ud800 \udfff 😀 café',
    '﻿ hello world　again', 'a � b �� c', '\ud83d', 'x y z', ' ', '\t\n', 'Война и мир', 'A very long title that will not fit on one spine line at all'];
  let state = 1942; const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state; };
  const words = ['αβ', '日本語', 'I', 'İ', '😀', '\ud800', '\udc00', '�', 'café', 'quiet', 'a'.repeat(80)], spaces = [' ', '\t', '\r\n', ' ', ' ', ' ', ' ', '﻿'];
  for (let i = 0; i < 250; i++) values.push(Array.from({ length: random() % 30 }, () => words[random() % words.length] + spaces[random() % spaces.length]).join(''));
  return values;
}

it('wraps every title like the frozen bridge, asking the canvas for the same measurements', () => {
  for (const title of titles()) for (const limit of [0, 1, 37, 80, 192, NaN, Infinity]) {
    const frozen = createRustFontWrapCache(core), native = new shelf.FontWraps();
    try { both(frozen, native, title, limit, 0); } finally { frozen.dispose(); native.dispose(); native.free(); }
  }
});
it('keeps a family\'s eight wraps: a cached key measures nothing and answers the first title', () => {
  const list = titles().filter(title => typeof title === 'string' && title.trim().length > 2);
  for (let round = 0; round < 40; round++) {
    const frozen = createRustFontWrapCache(core), native = new shelf.FontWraps();
    try {
      for (let step = 0; step < 30; step++) {
        const key = [0, 1, 2, 3, 4, 5, 6, 7, 3, 0, 7, 8, 9, -1, 2.5, 1e9, NaN][(round * 7 + step * 5) % 17];
        both(frozen, native, list[(round * 13 + step * 3) % list.length], [37, 80, 192][step % 3], key);
      }
      // The same key again: the kept wrap, without a measurement, whatever the title now is.
      for (const key of [0, 3, 7]) expect(both(frozen, native, 'another title altogether', 50, key)).toBe(both(frozen, native, 'another title altogether', 50, key));
    } finally { frozen.dispose(); native.dispose(); native.free(); }
  }
});
it('long words, the 8192-unit runs and the line limit', () => {
  for (const title of ['a'.repeat(70000) + ' tail small six seven eight nine', '😀'.repeat(8191) + ' x ' + '\ud800'.repeat(8193), Array.from({ length: 40 }, (_, i) => `w${i}`).join(' ')]) {
    for (const limit of [1, 500, 1e9]) {
      const frozen = createRustFontWrapCache(core), native = new shelf.FontWraps();
      try { both(frozen, native, title, limit, 1, text => text.length); both(frozen, native, title, limit, 1, text => text.length); } finally { frozen.dispose(); native.dispose(); native.free(); }
    }
  }
});
it('fails like the bridge: a canvas that throws, widths that are not numbers, a disposed cache, a title too long', () => {
  const lost = new Error('context lost');
  for (const measure of [() => { throw lost; }, () => undefined, () => ({}), () => ({ width: '12' }), () => ({ width: null }), () => ({ width: { valueOf: () => 90 } })]) {
    const frozen = createRustFontWrapCache(core), native = new shelf.FontWraps();
    const run = cache => { try { return cache.lines({ measureText: measure }, 'one two three four', 40, 2); } catch (error) { return error === lost ? 'lost' : `${error?.constructor?.name}`; } };
    try {
      expect(run(native)).toEqual(run(frozen));
      // Nothing half-made was kept: the next title on that key is wrapped afresh on both.
      both(frozen, native, 'five six seven', 40, 2);
    } finally { frozen.dispose(); native.dispose(); native.free(); }
  }
  const frozen = createRustFontWrapCache(core), native = new shelf.FontWraps();
  both(frozen, native, 'x'.repeat(1048577), 10, 0);
  both(frozen, native, 'kept title', 10, 0);
  frozen.dispose(); native.dispose(); frozen.dispose(); native.dispose();
  both(frozen, native, 'kept title', 10, 0);
  native.free();
});
