// @vitest-environment node
// The analysis of a cover and its pigment maps are jobs inside the numeric core (rust-core/src/cover_relief.rs).
// They are compared with the frozen JavaScript original (reference-relief-color.js) on large corpora, bit for bit,
// and put through cancellation, memory growth, rejection, trap and concurrency like every other native pass.
import { readFileSync } from 'node:fs';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ core: null }));
vi.mock('../../src/js/rust-core.js', async original => {
  const actual = await original();
  return { ...actual, getRustCore: () => state.core || actual.getRustCore() };
});
import { loadRustCore } from '../../src/js/rust-core.js';
import { needRustShelf } from '../../src/js/rust-shelf.js';
import * as production from '../../src/js/cover-relief.js';
import * as frozen from './helpers/reference-relief-color.js';
import { installLinearTable } from './helpers/core-oklab.js';
import { makeColorMaskImage, colorMaskCases, colorMaskSelection } from '../helpers/color-mask-cases.mjs';
import { reliefPaletteCases, makeReliefPaletteImage } from '../helpers/relief-palette-cases.mjs';

let core, stats;
const drain = task => { let step, yields = 0; for (;;) { step = task.next(); if (step.done) return { value: step.value, yields }; yields++; } };
const bytes = array => Buffer.from(array.buffer, array.byteOffset, array.byteLength);
function exact(actual, expected, label = 'value') {
  if (ArrayBuffer.isView(expected)) {
    expect(actual?.constructor, label).toBe(expected.constructor);
    expect(actual.length, label).toBe(expected.length);
    expect(Buffer.compare(bytes(actual), bytes(expected)), `${label} complete bytes`).toBe(0);
  } else if (Array.isArray(expected)) {
    expect(Array.isArray(actual), label).toBe(true);
    expect(actual.length, label).toBe(expected.length);
    expected.forEach((item, index) => exact(actual[index], item, `${label}[${index}]`));
  } else if (expected && typeof expected === 'object') {
    expect(Object.keys(actual).sort(), label).toEqual(Object.keys(expected).sort());
    for (const key of Object.keys(expected)) exact(actual[key], expected[key], `${label}.${key}`);
  } else expect(Object.is(actual, expected), `${label}: ${actual} vs ${expected}`).toBe(true);
}
function random(seed) {
  let value = seed >>> 0 || 1;
  return () => { value ^= value << 13; value >>>= 0; value ^= value >>> 17; value ^= value << 5; value >>>= 0; return value / 4294967296; };
}
function randomImage(next, maxSide = 96) {
  const width = 1 + Math.floor(next() * maxSide), height = 1 + Math.floor(next() * maxSide);
  const colourCount = 1 + Math.floor(next() * 12), palette = Array.from({ length: colourCount }, () => [next() * 256 | 0, next() * 256 | 0, next() * 256 | 0]);
  const noise = next() < .4 ? Math.floor(next() * 14) : 0, holes = next() < .3, data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const at = (y * width + x) * 4, base = palette[Math.floor((x * 7 + y * 3) / Math.max(1, (width + height) / colourCount)) % colourCount];
    for (let c = 0; c < 3; c++) data[at + c] = Math.max(0, Math.min(255, base[c] + (noise ? Math.floor((next() - .5) * noise) : 0)));
    data[at + 3] = holes && next() < .25 ? [0, 127, 128, 129, 200][Math.floor(next() * 5)] : 255;
  }
  return { width, height, data };
}
function tracked(overrides = {}) {
  return { ...core,
    alloc_f64(length) { const pointer = core.alloc_f64(length); if (pointer) { stats.allocations++; stats.arenas += length; } return pointer; },
    free_f64(pointer, length) { core.free_f64(pointer, length); stats.arenas -= length; },
    relief_analysis_new(...args) { const job = core.relief_analysis_new(...args); if (job) { stats.jobs++; stats.live++; } return job; },
    relief_maps_new(...args) { const job = core.relief_maps_new(...args); if (job) { stats.jobs++; stats.live++; } return job; },
    relief_job_free(job) { core.relief_job_free(job); if (job) stats.live--; },
    relief_job_step(job) { const code = core.relief_job_step(job); stats.steps++; stats.codes.add(code); return code; },
    ...overrides };
}
beforeAll(async () => {
  core = await loadRustCore({ bytes: readFileSync(new URL('../../src/wasm/inhouse_read_core.wasm', import.meta.url)) });
  expect(core).not.toBeNull();
  expect(typeof core.relief_analysis_new).toBe('function');
});
beforeEach(() => { stats = { live: 0, jobs: 0, arenas: 0, allocations: 0, steps: 0, codes: new Set() }; state.core = tracked(); });
afterEach(() => {
  expect(stats.live, 'every job is freed').toBe(0);
  expect(stats.arenas, 'every arena is released').toBe(0);
  state.core = null;
});

describe('the OKLab conversion of the core is the original, bit for bit', () => {
  const linear = Float64Array.from({ length: 256 }, (_, byte) => { const s = byte / 255; return s <= .04045 ? s / 12.92 : ((s + .055) / 1.055) ** 2.4; });
  const original = (r, g, b) => {
    r = linear[r]; g = linear[g]; b = linear[b];
    const l = Math.cbrt(.4122214708 * r + .5363325363 * g + .0514459929 * b);
    const m = Math.cbrt(.2119034982 * r + .6806995451 * g + .1073969566 * b);
    const s = Math.cbrt(.0883024619 * r + .2817188376 * g + .6299787005 * b);
    return [100 * (.2104542553 * l + .7936177850 * m - .0040720468 * s),
      100 * (1.9779984951 * l - 2.4285922050 * m + .4505937099 * s),
      100 * (.0259040371 * l + .7827717662 * m - .8086757660 * s)];
  };
  it('takes the sRGB curve from the host: the shelf module computes exactly the original table', () => {
    const table = needRustShelf().relief_linear_table();
    expect(table).toHaveLength(256);
    for (let byte = 0; byte < 256; byte++) expect(Object.is(table[byte], linear[byte]), `entry ${byte}`).toBe(true);
  });
  it('matches the original for all 16 777 216 colours (V8 cube root ported from fdlibm)', () => {
    installLinearTable(core);
    const out = core.alloc_f64(3);
    try {
      let different = 0, rejected = 0;
      for (let r = 0; r < 256; r++) for (let g = 0; g < 256; g++) for (let b = 0; b < 256; b++) {
        if (core.relief_oklab(r, g, b, out) !== 1) rejected++;
        const lab = new Float64Array(core.memory.buffer, out, 3), expected = original(r, g, b);
        if (!Object.is(lab[0], expected[0]) || !Object.is(lab[1], expected[1]) || !Object.is(lab[2], expected[2])) different++;
      }
      expect(rejected).toBe(0);
      expect(different).toBe(0);
    } finally { core.free_f64(out, 3); }
  }, 120000);
  it('refuses jobs and conversions until the table is installed, and accepts the same table again but no other', async () => {
    const fresh = (await WebAssembly.instantiate(readFileSync('src/wasm/inhouse_read_core.wasm'))).instance.exports;
    const out = fresh.alloc_f64(3), table = fresh.alloc_f64(256), rgba = fresh.alloc_f64(4);
    try {
      expect(fresh.relief_oklab(1, 2, 3, out)).toBe(0);
      expect(fresh.relief_analysis_new(rgba, 1, 1)).toBe(0);
      const values = new Float64Array(fresh.memory.buffer, table, 256);
      for (const bad of [Infinity, NaN, -.1, 1.01]) { values.set(linear); values[7] = bad; expect(fresh.relief_linear_set(table)).toBe(0); }
      expect(fresh.relief_linear_set(0)).toBe(0);
      values.set(linear); expect(fresh.relief_linear_set(table)).toBe(1);
      expect(fresh.relief_linear_set(table)).toBe(1);
      values[100] = Math.fround(values[100]) + 1e-12; expect(fresh.relief_linear_set(table)).toBe(0);
      expect(fresh.relief_oklab(1, 2, 3, out)).toBe(1);
      expect(fresh.relief_oklab(256, 0, 0, out)).toBe(0);
      expect(fresh.relief_oklab(0, 0, 0, 0)).toBe(0);
      const job = fresh.relief_analysis_new(rgba, 1, 1);
      expect(job).not.toBe(0);
      fresh.relief_job_free(job);
    } finally { fresh.free_f64(out, 3); fresh.free_f64(table, 256); fresh.free_f64(rgba, 4); }
  });
});

describe('the analysis job equals the frozen original on large corpora', () => {
  const sameAnalysis = (image, label) => {
    const before = image.data.slice(), expected = drain(frozen.analyzePixels(image)).value, actual = drain(production.analyzePixels(image));
    exact(actual.value, expected, label);
    expect(Buffer.compare(bytes(image.data), bytes(before)), `${label} source pixels`).toBe(0);
    return actual;
  };
  for (const input of reliefPaletteCases) it(`palette case ${input.name}`, () => { sameAnalysis(makeReliefPaletteImage(input), input.name); });
  for (const input of colorMaskCases) it(`mask case ${input.name}`, () => { sameAnalysis(makeColorMaskImage(input), input.name); });
  it('matches 120 pseudo-random covers: colours, tolerances, coverage, seeds and every mask', () => {
    const next = random(0x51ed270b);
    for (let index = 0; index < 120; index++) sameAnalysis(randomImage(next), `random ${index}`);
  });
  it('matches the edge shapes: one pixel, thin strips, transparent, opaque boundary', () => {
    for (const [width, height] of [[1, 1], [1, 40], [40, 1], [2, 2], [3, 5]]) {
      const next = random(width * 131 + height), image = { width, height, data: new Uint8ClampedArray(width * height * 4) };
      for (let i = 0; i < image.data.length; i++) image.data[i] = i % 4 === 3 ? 255 : next() * 256;
      sameAnalysis(image, `${width}x${height}`);
    }
    const clear = { width: 8, height: 8, data: new Uint8ClampedArray(8 * 8 * 4) };
    const result = sameAnalysis(clear, 'transparent');
    expect(result.value.chosen).toEqual([]);
    const boundary = { width: 16, height: 4, data: new Uint8ClampedArray(16 * 4 * 4) };
    for (let i = 0; i < 64; i++) boundary.data.set([i * 4 & 255, 30, 200, [127, 128][i & 1]], i * 4);
    sameAnalysis(boundary, 'alpha boundary');
  });
  it('keeps the work between two pauses small: every step is 0, 1 or 2 and there are enough pauses', () => {
    const image = makeColorMaskImage(colorMaskCases[2]), result = drain(production.analyzePixels(image));
    expect([...stats.codes].every(code => code === 0 || code === 1 || code === 2)).toBe(true);
    expect(result.yields).toBeGreaterThan(Math.floor(image.width * image.height / 1024));
    expect(stats.steps).toBeGreaterThanOrEqual(result.yields);
  });
});

describe('the pigment-map job equals the frozen original on large corpora', () => {
  const randomChoice = (next, image, id = 1) => {
    const picked = next() < .7 ? Math.floor(next() * image.width * image.height) : -1, base = picked >= 0 ? picked * 4 : 0;
    const color = '#' + [0, 1, 2].map(c => (picked >= 0 ? image.data[base + c] : next() * 256 | 0).toString(16).padStart(2, '0')).join('');
    return { id: `color-${id}`, color, tolerance: Math.round((1 + next() * 11) * 100) / 100, strength: Math.round(next() * 100) / 100 };
  };
  it('builds 150 pseudo-random single-colour maps with the original bytes', () => {
    const next = random(0x2f6b4f11);
    for (let index = 0; index < 150; index++) {
      const image = randomImage(next, 80), choice = randomChoice(next, image);
      exact(drain(production.buildMapsFromPixels(image, image, choice)).value, drain(frozen.buildMapsFromPixels(image, image, choice)).value, `single ${index}`);
    }
  });
  it('builds 120 pseudo-random layered maps (1 to 10 colours, any overlap) with the original bytes', () => {
    const next = random(0x7a1c0de5);
    for (let index = 0; index < 120; index++) {
      const image = randomImage(next, 80), layers = [], count = 1 + Math.floor(next() * 10);
      for (let n = 0; n < count; n++) layers.push(randomChoice(next, image, n + 1));
      const selection = { layers };
      exact(drain(production.buildMapsFromPixels(image, image, selection)).value, drain(frozen.buildMapsFromPixels(image, image, selection)).value, `layers ${index}`);
    }
  });
  it('builds the working and map sizes of the editor: 288x192 analysis raster and 512x512 maps', () => {
    for (const input of [{ width: 288, height: 192, kind: 'panels' }, { width: 512, height: 512, kind: 'noise' }, { width: 511, height: 7, kind: 'ramp' }]) {
      const image = makeColorMaskImage(input), selection = colorMaskSelection(input.kind === 'noise' ? 10 : 4);
      exact(drain(production.buildMapsFromPixels(image, image, selection)).value, drain(frozen.buildMapsFromPixels(image, image, selection)).value, input.kind);
      exact(drain(production.buildMapsFromPixels(image, image, selection.layers[0])).value, drain(frozen.buildMapsFromPixels(image, image, selection.layers[0])).value, `${input.kind} single`);
    }
  }, 120000);
  it('renders a legacy record as the first actual colour, from the working raster, like the original', () => {
    const work = makeColorMaskImage(colorMaskCases[1]), hires = makeColorMaskImage(colorMaskCases[2]);
    for (const record of [{ id: 'frame', strength: .55 }, { id: 'grain' }, { id: 'lettering', strength: 0 }]) {
      exact(drain(production.buildMapsFromPixels(work, hires, record)).value, drain(frozen.buildMapsFromPixels(work, hires, record)).value, record.id);
    }
  });
  it('pauses at least once per chunk of pixels in every stage', () => {
    const image = makeColorMaskImage(colorMaskCases[3]), result = drain(production.buildMapsFromPixels(image, image, colorMaskSelection(3)));
    expect(result.yields).toBeGreaterThan(Math.floor(image.width * image.height / 1024) * 3);
    expect([...stats.codes].every(code => code === 0 || code === 1 || code === 2)).toBe(true);
  });
});

describe('cancellation, memory growth, rejection, traps and concurrency', () => {
  const small = () => makeColorMaskImage({ width: 40, height: 33, kind: 'panels' });
  it('frees the job and the arena when the analysis is cancelled at every pause', () => {
    const image = small(), total = drain(production.analyzePixels(image)).yields;
    expect(total).toBeGreaterThan(5);
    for (let stop = 0; stop <= total; stop++) {
      const task = production.analyzePixels(image);
      for (let i = 0; i < stop; i++) if (task.next().done) break;
      task.return();
      expect(stats.live, `analysis stopped after ${stop}`).toBe(0);
      expect(stats.arenas).toBe(0);
    }
  });
  it('frees the job and the arena when the maps are cancelled at every pause', () => {
    const image = small(), selection = colorMaskSelection(3), total = drain(production.buildMapsFromPixels(image, image, selection)).yields;
    expect(total).toBeGreaterThan(10);
    for (let stop = 0; stop <= total; stop++) {
      const task = production.buildMapsFromPixels(image, image, selection);
      for (let i = 0; i < stop; i++) if (task.next().done) break;
      task.return();
      expect(stats.live, `maps stopped after ${stop}`).toBe(0);
      expect(stats.arenas).toBe(0);
    }
  });
  it('stays exact when another task grows the memory at every pause', () => {
    const image = small(), selection = colorMaskSelection(5);
    const expectedAnalysis = drain(frozen.analyzePixels(image)).value, expectedMaps = drain(frozen.buildMapsFromPixels(image, image, selection)).value;
    for (const [task, expected] of [[production.analyzePixels(image), expectedAnalysis], [production.buildMapsFromPixels(image, image, selection), expectedMaps]]) {
      let step;
      do { step = task.next(); if (!step.done) core.memory.grow(1); } while (!step.done);
      exact(step.value, expected);
    }
  });
  it('owns its results: they stay valid when the memory grows or the job is long gone', () => {
    const image = small(), found = drain(production.analyzePixels(image)).value, snapshot = found.chosen.map(choice => Buffer.from(bytes(choice.mask)));
    core.memory.grow(2);
    found.chosen.forEach((choice, index) => { expect(Buffer.compare(bytes(choice.mask), snapshot[index])).toBe(0); expect(choice.mask.buffer).not.toBe(core.memory.buffer); });
    const maps = drain(production.buildMapsFromPixels(image, image, colorMaskSelection(2))).value, kept = [maps.owners, maps.baseMask, maps.baseHeight].map(plane => Buffer.from(bytes(plane)));
    core.memory.grow(2);
    [maps.owners, maps.baseMask, maps.baseHeight].forEach((plane, index) => expect(Buffer.compare(bytes(plane), kept[index])).toBe(0));
  });
  it('rejects unsupported rasters before allocating anything', () => {
    const view = core.alloc_f64(40), allocated = stats.allocations;
    try {
      for (const ArrayType of [Uint8Array, Uint8ClampedArray]) {
        const data = new ArrayType(core.memory.buffer, view + 8, 8 * 4 * 4); data.fill(128);
        expect(() => drain(production.analyzePixels({ width: 8, height: 4, data }))).toThrow(/núcleo de relieve/);
        expect(() => drain(production.buildMapsFromPixels({ width: 8, height: 4, data }, { width: 8, height: 4, data }, colorMaskSelection(1)))).toThrow(/núcleo de relieve/);
      }
    } finally { core.free_f64(view, 40); }
    const tooBig = { width: 513, height: 512, data: new Uint8ClampedArray(513 * 512 * 4) };
    expect(() => drain(production.analyzePixels(tooBig))).toThrow(/núcleo de relieve/);
    expect(() => drain(production.buildMapsFromPixels(tooBig, tooBig, colorMaskSelection(1)))).toThrow(/núcleo de relieve/);
    // Nothing but the one-time 256-entry table is ever allocated for a raster that is turned away.
    expect(stats.allocations - allocated).toBeLessThanOrEqual(1);
    for (const image of [{ width: 0, height: 1, data: new Uint8Array(0) }, { width: 1.5, height: 2, data: new Uint8Array(12) }, { width: 1, height: 1, data: new Uint8Array(3) }, null, {}]) {
      expect(() => drain(production.analyzePixels(image))).toThrow(/RGBA/);
    }
    expect(stats.jobs).toBe(0);
  });
  it('turns a rejected job into a clear error without a second path', () => {
    const image = small();
    for (const override of [{ relief_analysis_new: () => 0 }, { relief_analysis_new: undefined }, { relief_job_step: undefined }, { relief_linear_set: undefined }]) {
      state.core = tracked(override);
      expect(() => drain(production.analyzePixels(image))).toThrow(/núcleo de relieve/);
    }
    for (const override of [{ relief_maps_new: () => 0 }, { relief_maps_plane: undefined }]) {
      state.core = tracked(override);
      expect(() => drain(production.buildMapsFromPixels(image, image, colorMaskSelection(2)))).toThrow(/núcleo de relieve/);
    }
  });
  it('reports a failed or trapped step and frees everything', () => {
    const image = small(), selection = colorMaskSelection(3);
    for (const at of [1, 2, 7, 15]) for (const failure of ['reject', 'trap']) {
      let calls = 0;
      state.core = tracked({ relief_job_step(job) {
        if (++calls === at) { if (failure === 'trap') throw new WebAssembly.RuntimeError('step trap'); return -1; }
        return core.relief_job_step(job);
      } });
      const message = failure === 'trap' ? /step trap/ : /rechazó/;
      expect(() => drain(production.analyzePixels(image)), `analysis ${failure} at ${at}`).toThrow(message);
      expect(stats.live).toBe(0);
      calls = 0;
      expect(() => drain(production.buildMapsFromPixels(image, image, selection)), `maps ${failure} at ${at}`).toThrow(message);
      expect(stats.live).toBe(0);
    }
    state.core = tracked();
    exact(drain(production.buildMapsFromPixels(image, image, selection)).value, drain(frozen.buildMapsFromPixels(image, image, selection)).value);
  });
  it('frees the job when the allocation of the input arena fails, and the arena when the job is refused', () => {
    const image = small();
    state.core = tracked({ alloc_f64: () => 0 });
    expect(() => drain(production.analyzePixels(image))).toThrow(/memoria|núcleo/);
    state.core = tracked({ alloc_f64() { throw new RangeError('exhausted'); } });
    expect(() => drain(production.analyzePixels(image))).toThrow(/exhausted/);
    expect(stats.live).toBe(0);
    state.core = tracked({ relief_analysis_new() { throw new WebAssembly.RuntimeError('new trap'); } });
    expect(() => drain(production.analyzePixels(image))).toThrow(/new trap/);
    expect(stats.arenas).toBe(0);
  });
  it('runs independent jobs side by side, interleaved step by step, without influencing each other', () => {
    const images = [small(), makeColorMaskImage(colorMaskCases[0]), makeColorMaskImage({ width: 70, height: 20, kind: 'noise' })];
    const tasks = [production.analyzePixels(images[0]), production.buildMapsFromPixels(images[1], images[1], colorMaskSelection(4)), production.analyzePixels(images[2]),
      production.buildMapsFromPixels(images[0], images[0], colorMaskSelection(1).layers[0])];
    const expected = [drain(frozen.analyzePixels(images[0])).value, drain(frozen.buildMapsFromPixels(images[1], images[1], colorMaskSelection(4))).value,
      drain(frozen.analyzePixels(images[2])).value, drain(frozen.buildMapsFromPixels(images[0], images[0], colorMaskSelection(1).layers[0])).value];
    const done = [];
    for (let live = tasks.length; live > 0;) for (let i = 0; i < tasks.length; i++) {
      if (i in done) continue;
      const step = tasks[i].next();
      if (step.done) { done[i] = step.value; live--; }
    }
    done.forEach((value, index) => exact(value, expected[index], `job ${index}`));
    expect(stats.jobs).toBe(4);
  });
});

describe('the colour names, coating profiles and material coefficients of the shelf module', () => {
  const hex = n => '#' + (n >>> 0).toString(16).padStart(6, '0');
  it('names 200 000 pseudo-random colours and every 8-bit grey like the original', () => {
    const next = random(0x1234abcd), shelf = needRustShelf();
    for (let i = 0; i < 200000; i++) {
      const color = hex(next() * 0x1000000);
      expect(shelf.relief_color_name(color), color).toBe(frozen.internals.colorName(color));
    }
    for (let grey = 0; grey < 256; grey++) { const color = hex(grey * 0x010101); expect(shelf.relief_color_name(color)).toBe(frozen.internals.colorName(color)); }
  });
  it('gives the original profile for 200 000 colours and for malformed strings (parseInt, ToInt32)', () => {
    const next = random(0x0badc0de), shelf = needRustShelf();
    for (let i = 0; i < 200000; i++) { const choice = { color: hex(next() * 0x1000000) }; exact(shelf.color_relief_profile(choice), frozen.colorReliefProfile(choice), choice.color); }
    for (const color of ['#', '', '#zz', '#12', '#abc', ' #ff', '# ff', '#0x1f', '#-1', '#+ff', '#-0', '#ffffffffff', '#fffffffffffffffffffffffffffff', '#1e3', '#٣٣', '# ff', '#  1f', 'x', '#ABCDEF', '#abcdefg'])
      exact(shelf.color_relief_profile({ color }), frozen.colorReliefProfile({ color }), JSON.stringify(color));
    // (Arrays have a slice of their own, which the original would accept: a normalized choice never carries one.)
    for (const bad of [undefined, null, 12, {}]) {
      expect(() => shelf.color_relief_profile({ color: bad })).toThrow(TypeError);
      expect(() => frozen.colorReliefProfile({ color: bad })).toThrow(TypeError);
    }
    expect(() => shelf.color_relief_profile(null)).toThrow(TypeError);
  }, 30_000);
  it('gives the original material coefficients for any finish numbers, including unusual ones', () => {
    const shelf = needRustShelf(), values = [0, -0, .01, .05, .18, .3, .5, 1, 2, -1, NaN, Infinity, -Infinity, '0.4', null, true, '', ' 7 '];
    const layers = [{ color: '#a12638' }, { color: '#2f6b4f' }];
    const reference = (clearcoat, roughness, clearcoatRoughness, maps) => {
      const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
      const base = clamp(clearcoat, 0, 1), foilRoughness = clamp(.3 / Math.max(.05, roughness), .2, 1);
      const glossRoughness = clamp(.05 / Math.max(.01, roughness), 0, 1), glossCoatRoughness = clamp(.05 / Math.max(.01, clearcoatRoughness), 0, 1);
      const profiles = maps.layers?.map(layer => { const profile = frozen.colorReliefProfile(layer);
        return { roughness: clamp(profile.roughness / Math.max(.01, roughness), 0, 1), clearcoatRoughness: clamp(profile.clearcoatRoughness / Math.max(.01, clearcoatRoughness), 0, 1) }; });
      // (The original passes `profiles: undefined`; the key is simply absent here, which reads the same.)
      return { base, foilRoughness, glossRoughness, glossCoatRoughness, ...(profiles ? { profiles } : {}) };
    };
    for (const clearcoat of values) for (const roughness of values) for (const clearcoatRoughness of [.18, 0, 1, NaN, '2']) for (const maps of [{}, { layers }, { layers: [] }]) {
      exact(shelf.relief_material_options(maps.layers, clearcoat, roughness, clearcoatRoughness), reference(clearcoat, roughness, clearcoatRoughness, maps), `${String(clearcoat)}/${String(roughness)}/${String(clearcoatRoughness)}`);
    }
    expect(() => shelf.relief_material_options([{ color: 5 }], 0, .5, .18)).toThrow(TypeError);
  });
  it('describes a proposal with its name and rounded coverage like the original', () => {
    const shelf = needRustShelf(), next = random(0xface0ff), pct = value => `${Math.max(1, Math.round(value * 100))}%`;
    for (let i = 0; i < 5000; i++) {
      const color = hex(next() * 0x1000000), edges = [0, 1, .004, .005, .0049999, .995, .9949999, NaN, -1, 2];
      const candidate = { color, facts: { coverage: i % 7 === 0 ? edges[(i / 7 | 0) % edges.length] : next() } };
      expect(shelf.relief_describe(candidate)).toEqual({ label: frozen.internals.colorName(color),
        description: `Zonas de este color (${pct(candidate.facts.coverage)} de la portada), con relieve y brillo` });
    }
    expect(() => shelf.relief_describe({ color: '#fff' })).toThrow(TypeError);
  });
});
