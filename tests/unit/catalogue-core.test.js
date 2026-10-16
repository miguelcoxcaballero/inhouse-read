// Differential tests: the catalogue tables, plant dimensions and lamp colour
// maths built by the Rust core (rust-core/src/catalogue.rs, lamp_kelvin.rs)
// against the frozen JavaScript originals in helpers/reference-*.js. Strict
// comparisons: same structure, key order, freezing and Object.is on numbers.
import { describe, expect, it } from 'vitest';
import * as app from '../../src/js/catalogue-core.js';
import * as decor from '../../src/js/decor-catalogue.js';
import * as shelfTypes from '../../src/js/shelf-types.js';
import * as dimensions from '../../src/js/plant-dimensions.js';
import * as plantCatalog from '../../src/js/plant-catalog-data.js';
import * as plantRecords from '../../src/js/plant-records.js';
import * as lampCatalog from '../../src/js/lamp-catalog-data.js';
import * as kelvin from '../../src/js/lamp-kelvin.js';
import * as referenceTypes from './helpers/reference-shelf-types.js';
import * as referenceDimensions from './helpers/reference-plant-dimensions.js';
import * as referenceCatalog from './helpers/reference-plant-catalog-data.js';
import * as referenceRecords from './helpers/reference-plant-records.js';
import * as referenceLamps from './helpers/reference-lamp-catalog-data.js';
import * as referenceKelvin from './helpers/reference-lamp-kelvin.js';

const seeded = seed => () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
const rng = seeded(7777);

/** Every (path, frozen) pair of a value, so the freezing depth is compared too. */
function shape(value, path = '', out = []) {
  if (value && typeof value === 'object') {
    out.push([path, Object.isFrozen(value), Array.isArray(value), Object.keys(value).join('|')]);
    for (const [key, child] of Object.entries(value)) shape(child, `${path}/${key}`, out);
  }
  return out;
}
function sameExports(actual, expected, names) {
  for (const name of names) {
    expect(actual[name], name).toStrictEqual(expected[name]);
    expect(shape(actual[name]), `${name} freezing and key order`).toStrictEqual(shape(expected[name]));
  }
}
const sameNumber = (a, b) => expect(Object.is(a, b), `${a} vs ${b}`).toBe(true);

describe('catalogue tables', () => {
  it('equal the original shelf type tables, frozen the same way', () => {
    sameExports(shelfTypes, referenceTypes, ['BAGGEBO_SPEC', 'WALNUT_SPEC', 'SHELF_SPECS', 'SHELF_TYPES']);
    for (const id of [' BAGGEBO ', 'walnut', 'Baggebo', null, undefined, 2, {}, '', 'unknown', '﻿baggebo ', 'baggebo ', 'K']) {
      expect(shelfTypes.normalizeShelfType(id)).toBe(referenceTypes.normalizeShelfType(id));
      expect(shelfTypes.getShelfType(id)).toStrictEqual(referenceTypes.getShelfType(id));
    }
  });

  it('equal the original plant and pot tables', () => {
    sameExports(dimensions, referenceDimensions, ['IKEA_SIZES_CM', 'POT_DIAMETER_MM', 'POT_SIZES', 'PLANT_SIZES', 'PLANT_REFERENCE_POTS',
      'PLANT_DEFAULT_POTS', 'POT_SOIL_FRACTION', 'SHELF_CLEARANCE_MM', 'PLANT_MAX_HEIGHT_MM', 'BOOK_REFERENCE_MM', 'BOOK_THICKNESS_MM',
      'BOOK_DEPTH_MM', 'MINIMUM_LAMP_TAP_SIZE']);
    sameExports(plantCatalog, referenceCatalog, ['PLANT_CATALOG', 'POT_CATALOG', 'POT_COLORS']);
    sameExports(lampCatalog, referenceLamps, ['LAMP_CATALOG']);
    sameExports(kelvin, referenceKelvin, ['LAMP_KELVINS', 'DEFAULT_LAMP_KELVIN', 'LAMP_KELVIN_MS']);
  });

  it('answer every catalogue lookup like the original', () => {
    const ids = ['sansevieria', 'monstera', 'chamaedorea', 'nephrolepis', 'hedera', 'zamioculcas', 'succulent', 'cactus', 'pothos', 'upright',
      'fern', 'zz', 'palm', ' LEAFY ', 'cactus ', '', null, undefined, 4, 'missing'];
    const pots = ['muskot', 'muskot9', 'muskotblomma', 'akerbar', 'gradvis', 'missing', '', null, undefined, 3];
    for (const id of ids) {
      expect(plantCatalog.getCatalogPlant(id)).toStrictEqual(referenceCatalog.getCatalogPlant(id));
      expect(plantRecords.resolveCatalogPlant({ catalogId: id })).toStrictEqual(referenceRecords.resolveCatalogPlant({ catalogId: id }));
      expect(plantRecords.resolveCatalogPlant({ variant: id })).toStrictEqual(referenceRecords.resolveCatalogPlant({ variant: id }));
    }
    expect(plantRecords.resolveCatalogPlant()).toStrictEqual(referenceRecords.resolveCatalogPlant());
    for (const pot of pots) {
      expect(plantCatalog.getCatalogPot(pot)).toStrictEqual(referenceCatalog.getCatalogPot(pot));
      expect(plantCatalog.getPotColors(pot)).toStrictEqual(referenceCatalog.getPotColors(pot));
      for (const color of ['ivory', 'sage', 'terracotta', 'zinc', 'rose', 'nope', undefined])
        expect(plantCatalog.getPotColor(pot, color)).toStrictEqual(referenceCatalog.getPotColor(pot, color));
    }
    for (const id of ['mittled', 'tarnaby', 'tripod', 'nope', '', null, undefined, 1])
      expect(lampCatalog.getCatalogLamp(id)).toStrictEqual(referenceLamps.getCatalogLamp(id));
  });

  it('normalise saved plants and lamps like the original', () => {
    const records = [];
    for (const key of ['plant:a', '  ', '', null, undefined, 4, ' x ']) for (const catalogId of [undefined, 'hedera', 'zz', 'x'])
      for (const variant of [undefined, 'pothos', 'cactus', 'upright', 'monstera', ' Fern ']) for (const potId of [undefined, 'muskot9', 'akerbar', 'zzz'])
        for (const potColorId of [undefined, 'sage', 'copper', 'bad']) for (const seed of [undefined, '', 'seed'])
          records.push({ key, catalogId, variant, potId, potColorId, seed, shelf: 2, x: .4, width: 9, height: 9 });
    for (const record of [null, undefined, 0, 'x', ...records]) expect(plantRecords.normalizeShelfPlant(record)).toStrictEqual(referenceRecords.normalizeShelfPlant(record));
    const lamps = [];
    for (const lampId of ['mittled', 'tarnaby', 'tripod', 'no', undefined]) for (const key of ['k', ' k ', '', undefined, 7])
      for (const seed of ['s', ' ', undefined]) for (const isOn of [true, false, undefined, 0])
        for (const shelf of [undefined, -1, 1.7, 4000, NaN]) for (const x of [undefined, -1, .5, 3, NaN]) for (const k of [undefined, 1800, 2700, 3000, '2200'])
          lamps.push({ lampId, key, seed, isOn, shelf, x, kelvin: k });
    for (const lamp of [null, undefined, 'x', 3, ...lamps]) expect(lampCatalog.normalizeShelfLamp(lamp)).toStrictEqual(referenceLamps.normalizeShelfLamp(lamp));
  });
});

describe('plant dimensions', () => {
  const plants = Object.keys(referenceDimensions.PLANT_SIZES), pots = [...Object.keys(referenceDimensions.POT_SIZES), 'unknown', '', undefined, null, 7];

  it('equal the original for every plant in every pot, and for unknown ones', () => {
    for (const plant of [...plants, 'missing', '', undefined, null, 3]) {
      expect(dimensions.standardPlantClass(plant)).toStrictEqual(referenceDimensions.standardPlantClass(plant));
      for (const pot of pots) {
        const actual = dimensions.plantDimensions(plant, pot), expected = referenceDimensions.plantDimensions(plant, pot);
        expect(actual).toStrictEqual(expected);
        if (actual) for (const key of Object.keys(expected)) sameNumber(actual[key], expected[key]);
        expect(dimensions.plantSizeLabel(plant, pot)).toBe(referenceDimensions.plantSizeLabel(plant, pot).replace(" · sobre el mueble"," · se ajusta a la leja"));
        for (const scale of [0.3, 0.65, 1, 1.5]) expect(dimensions.plantSceneSize(plant, pot, scale)).toStrictEqual(referenceDimensions.plantSceneSize(plant, pot, scale));
      }
    }
  });

  it('return fresh objects, so a caller may keep or change them', () => {
    const first = dimensions.plantDimensions('monstera', 'gradvis');
    first.width = 1;
    expect(dimensions.plantDimensions('monstera', 'gradvis').width).not.toBe(1);
    const standard = dimensions.standardPlantClass('monstera');
    standard.fits = 'changed';
    expect(dimensions.standardPlantClass('monstera').fits).toBe(false);
  });

  it('scale the shelf and the book options like the original, bit for bit', () => {
    const widths = [undefined, null, 0, -4, NaN, 390, 320, 360.5, 414, 600, 900, 1e6, '400', 'abc', Infinity, 1e-9, rng() * 2000, rng() * 800];
    for (let n = 0; n < 2000; n++) widths.push(rng() * 1500, Math.floor(rng() * 1200));
    for (const shelfWidth of widths) {
      sameNumber(dimensions.shelfScale({ shelfWidth }), referenceDimensions.shelfScale({ shelfWidth }));
      const actual = dimensions.bookSpineOptions(shelfWidth), expected = referenceDimensions.bookSpineOptions(shelfWidth);
      expect(actual).toStrictEqual(expected);
      for (const key of Object.keys(expected)) sameNumber(actual[key], expected[key]);
    }
    sameNumber(dimensions.shelfScale(), referenceDimensions.shelfScale());
    expect(() => dimensions.shelfScale(null)).toThrow(TypeError);
  });

  it('keep the tap helpers of the original', () => {
    for (const viewport of [undefined, 0, 599, 600, 1000, NaN]) {
      expect(dimensions.minimumBookCellWidth(viewport)).toBe(referenceDimensions.minimumBookCellWidth(viewport));
      expect(dimensions.minimumBookTapWidth(viewport)).toBe(referenceDimensions.minimumBookTapWidth(viewport));
    }
    const targets = Array.from({ length: 30 }, () => ({ left: rng() * 300, top: rng() * 200, width: 10 + rng() * 60, height: 20 + rng() * 120 }));
    for (let n = 0; n < 300; n++) {
      const x = rng() * 360, y = rng() * 300;
      expect(dimensions.nearestTapTarget(targets, x, y)).toBe(referenceDimensions.nearestTapTarget(targets, x, y));
      expect(dimensions.padTapRect(targets[n % 30], 30)).toStrictEqual(referenceDimensions.padTapRect(targets[n % 30], 30));
      expect(dimensions.padTapSquare(targets[n % 30], 44)).toStrictEqual(referenceDimensions.padTapSquare(targets[n % 30], 44));
    }
  });
});

describe('lamp colour temperature', () => {
  it('computes the black-body colour like the original for 60000 temperatures', () => {
    const values = [undefined, null, 0, -0, NaN, 1, 1667, 1800, 2200, 2222, 2223, 2700, 4000, 4001, 6500, 25000, 1e9, -5, Infinity, '3000', 'abc', true, [], 1666.9999];
    for (let n = 0; n < 30000; n++) values.push(1500 + rng() * 25000, Math.floor(1600 + rng() * 25100));
    for (const value of values) {
      const actual = kelvin.kelvinToLinearRgb(value), expected = referenceKelvin.kelvinToLinearRgb(value);
      for (let channel = 0; channel < 3; channel++) sameNumber(actual[channel], expected[channel]);
    }
    const out = [9, 9, 9];
    expect(kelvin.kelvinToLinearRgb(2200, out)).toBe(out);
  }, 60000);

  it('tints, swatches and easing equal the original', () => {
    for (const value of [undefined, 1800, 2200, 2700, 4000, '2200', 3000, NaN, null, 0, 6500]) {
      const actual = kelvin.lampTint(value), expected = referenceKelvin.lampTint(value);
      for (let channel = 0; channel < 3; channel++) sameNumber(actual[channel], expected[channel]);
      expect(kelvin.kelvinSwatch(value)).toBe(referenceKelvin.kelvinSwatch(value));
      expect(kelvin.normalizeLampKelvin(value)).toBe(referenceKelvin.normalizeLampKelvin(value));
    }
    const base = [.3, 1.2, 0.7], target = [1, .1, 2.4];
    for (let n = 0; n < 5000; n++) {
      const amount = n % 50 === 0 ? [0, 1, .5, -1, 2, NaN][n % 6] : rng() * 1.4 - .2;
      const actual = kelvin.mixTint(base, target, amount), expected = referenceKelvin.mixTint(base, target, amount);
      for (let channel = 0; channel < 3; channel++) sameNumber(actual[channel], expected[channel]);
    }
    const color = { r: .5, g: .25, b: 2 }, again = { ...color };
    expect(kelvin.tintColor(color, [1, 2, 3])).toStrictEqual(referenceKelvin.tintColor(again, [1, 2, 3]));
  });

  it('runs a temperature change in flight exactly like the original', () => {
    for (let round = 0; round < 400; round++) {
      const first = pick(), actual = kelvin.createTintTransition(first), expected = referenceKelvin.createTintTransition(first);
      let now = rng() * 1000;
      for (let step = 0; step < 40; step++) {
        if (rng() < .25) {
          const next = pick(), animate = rng() < .7;
          expect(actual.set(next, now, animate)).toBe(expected.set(next, now, animate));
        }
        now += rng() < .1 ? 0 : rng() * 140;
        expect(actual.advance(now)).toBe(expected.advance(now));
        expect(actual.moving()).toBe(expected.moving());
        for (const key of ['from', 'to', 'value']) for (let channel = 0; channel < 3; channel++) sameNumber(actual.state[key][channel], expected.state[key][channel]);
        expect(actual.state.kelvin).toBe(expected.state.kelvin);
      }
    }
    function pick() { return [1800, 2200, 2700, 4000, '4000', 3000, undefined][Math.floor(rng() * 7)]; }
  }, 60000);
});

describe('catalogue kernels', () => {
  /** The JSON export of a core: size without writing, then the bytes. */
  function exported(core, name, tables) {
    const size = core[name](0, 0), words = Math.ceil(size / 8) + 1, at = core.alloc_f64(words);
    try {
      const bytes = new Uint8Array(core.memory.buffer, at, words * 8);
      bytes.fill(0x55);
      expect(core[name](at, size - 1)).toBe(size);
      expect(bytes.every(byte => byte === 0x55)).toBe(true);
      expect(core[name](at, size)).toBe(size);
      expect(JSON.parse(new TextDecoder().decode(bytes.subarray(0, size)))).toStrictEqual(tables);
    } finally { core.free_f64(at, words); }
  }

  it('reject unusable pointers and report the size without writing', () => {
    const { core, scratchPointer, scratch } = decor;
    expect(core.kelvin_linear_rgb(2700, .4, .06, .16, 0)).toBe(0);
    expect(core.kelvin_linear_rgb(2700, .4, .06, .16, scratchPointer + 1)).toBe(0);
    expect(core.lamp_tint_finish(0, scratchPointer)).toBe(0);
    expect(core.lamp_tint_finish(scratchPointer, 0)).toBe(0);
    expect(core.tint_mix(0, scratchPointer, .5, scratchPointer)).toBe(0);
    expect(core.tint_mix(scratchPointer + 1, scratchPointer, .5, scratchPointer)).toBe(0);
    expect(core.tint_mix(scratchPointer, scratchPointer + 4, .5, scratchPointer)).toBe(0);
    expect(core.tint_mix(scratchPointer, scratchPointer, .5, scratchPointer + 2)).toBe(0);
    expect(core.book_spine_options(1, 0)).toBe(0);
    exported(core, 'plant_catalogue_json', decor.tables);
    exported(app.core, 'catalogue_json', app.tables);
    expect(scratch().length).toBe(16);
    expect(app.scratch().length).toBe(16);
  });

  it('keep the two cores apart: the shelf tables are not in the decor core and the plant tables are not in the app core', () => {
    expect(decor.core.catalogue_json).toBeUndefined();
    expect(app.core.plant_catalogue_json).toBeUndefined();
    expect(decor.core.spine_styles).toBeUndefined();
    expect(app.core.kelvin_clamp).toBeUndefined();
    expect(decor.core.memory).not.toBe(app.core.memory);
  });

  it('keeps memory and the scratch arena stable over many calls', () => {
    for (let n = 0; n < 200; n++) { kelvin.lampTint(1800); kelvin.kelvinToLinearRgb(3000 + n); dimensions.bookSpineOptions(300 + n); }
    const size = decor.core.memory.buffer.byteLength;
    for (let n = 0; n < 50000; n++) { kelvin.kelvinToLinearRgb(2000 + n % 9000); dimensions.bookSpineOptions(300 + n % 400); kelvin.mixTint([0, 0, 0], [1, 1, 1], n / 50000); }
    expect(decor.core.memory.buffer.byteLength).toBe(size);
  });
});
