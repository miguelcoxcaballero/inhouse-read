import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createShelfFurniture } from '../../src/js/shelf-furniture.js';
import { createBaggebo } from '../../src/js/baggebo-model.js';
import { BAGGEBO_SPEC, SHELF_SPECS, SHELF_TYPES, WALNUT_SPEC } from '../../src/js/shelf-types.js';
import { shelfModelLayout } from '../../src/js/shelf-model-layout.js';
import { layoutShelves, spineStyleFor } from '../../src/js/bookshelf-layout.js';
import { LAMP_CATALOG } from '../../src/js/lamp-catalog-data.js';
import {
  BOOK_DEPTH_MM, BOOK_REFERENCE_MM, BOOK_THICKNESS_MM, SHELF_CLEARANCE_MM, bookSpineOptions, minimumBookCellWidth, shelfScale
} from '../../src/js/plant-dimensions.js';

const library = count => Array.from({ length:count }, (_, index) => ({ id:`local:book-${index}:${index * 977}`, title:`Libro ${index}` }));
const COVER_RATIO = .66; // opts.coverRatio of bookshelf.js

/** The same inputs bookshelf.js gives layoutShelves and shelfModelLayout. */
function packed(count, width, viewportWidth = width) {
  const shelves = layoutShelves(library(count), { shelfWidth:width, padding:Math.max(16, (BAGGEBO_SPEC.postSize + 4) * width / 600),
    gap:3, plantEvery:Infinity, maxTailPlants:0, spine:bookSpineOptions(width),
    displayWidthFor:(_book, style) => Math.max(style.width, minimumBookCellWidth(viewportWidth)) });
  return shelves;
}

describe('both shelves are the real 600 x 250 x 1160 mm IKEA unit', () => {
  it('builds the wooden cabinet from the BAGGEBO measures, with the same compartments', () => {
    for (const key of ['width', 'depth', 'height', 'shelfBottoms', 'shelfHeightsFromFloor', 'postSize', 'shelfRimHeight', 'usableDepth'])
      expect(WALNUT_SPEC[key]).toEqual(BAGGEBO_SPEC[key]);
    expect(WALNUT_SPEC.dimensions).toEqual({ width:600, depth:250, height:1160 });
    expect(SHELF_SPECS).toEqual({ walnut:WALNUT_SPEC, baggebo:BAGGEBO_SPEC });
    expect(SHELF_TYPES.map(type => type.dimensions)).toEqual([WALNUT_SPEC.dimensions, BAGGEBO_SPEC.dimensions]);
    expect(WALNUT_SPEC.shelfHeightsFromFloor).toEqual([800, 477.5, 155]);
    expect(SHELF_CLEARANCE_MM.walnut).toBe(SHELF_CLEARANCE_MM.baggebo);
  });

  it('lays out the same rows, heights and unit gaps for wood and metal at any width', () => {
    for (const width of [300, 390, 600, 900]) {
      const input = { width, sceneWidth:width, rows:[{}, {}, {}, {}], entries:[] };
      const wood = shelfModelLayout(input, 'walnut'), metal = shelfModelLayout(input, 'baggebo');
      const scale = width / 600;
      expect(wood.height).toBeCloseTo(1160 * scale); expect(wood.depth).toBeCloseTo(250 * scale);
      expect(wood.unitCount).toBe(2); expect(metal.unitCount).toBe(2);
      expect(wood.width).toBeCloseTo(metal.width);
      expect(wood.rows.map(row => row.bottom)).toEqual(metal.rows.map(row => row.bottom));
      expect(wood.rows.map(row => row.top)).toEqual(metal.rows.map(row => row.top));
      // Three compartments between surfaces 322.5 mm apart (342 mm for the top one),
      // less the 16.5 mm rim of the board above.
      const heights = wood.rows.slice(0, 3).map(row => (row.bottom - row.top) / scale);
      expect(heights[0]).toBeCloseTo(360 - BAGGEBO_SPEC.postSize, 6);
      expect(heights[1]).toBeCloseTo(322.5 - BAGGEBO_SPEC.shelfRimHeight, 6);
      expect(heights[2]).toBeCloseTo(322.5 - BAGGEBO_SPEC.shelfRimHeight, 6);
      expect(wood.shelfType).toBe('walnut'); expect(metal.shelfType).toBe('baggebo');
    }
  });

  it('builds meshes whose measured outer bounds are the 600 x 250 x 1160 mm spec, wood and metal alike', () => {
    const measure = group => { const size = new THREE.Box3().setFromObject(group).getSize(new THREE.Vector3()); return size; };
    for (const width of [320, 390, 600, 900]) {
      const scale = width / 600, material = new THREE.MeshStandardMaterial();
      const wood = createShelfFurniture({ width, height:1160 * scale, depth:250 * scale, scale,
        rows:WALNUT_SPEC.shelfBottoms.map(bottom => ({ bottom:bottom * scale })), wood:material, backWood:material, darkWood:material });
      const size = measure(wood);
      expect(size.x / scale).toBeCloseTo(600, 3);
      expect(size.y / scale).toBeCloseTo(1160, 3);
      // Back backer to shelf lips: the carcase is not 272.6 mm deep, it is 250.
      expect(size.z / scale).toBeCloseTo(250, 3);
      wood.userData.disposeGeometry();
      const metal = createBaggebo({ width:width });
      const metalSize = measure(metal);
      expect(metalSize.x / scale).toBeCloseTo(600, 0);
      expect(metalSize.y / scale).toBeCloseTo(1160, 0);
      expect(metalSize.z / scale).toBeCloseTo(250, 0);
      metal.userData.dispose?.();
    }
  });

  it('keeps an unknown shelf type on the wooden default', () => {
    expect(shelfModelLayout({ width:600, rows:[{}], entries:[] }, 'nonsense').shelfType).toBe('walnut');
  });
});

describe('books, lamps and plants at the scale of a 60 cm shelf', () => {
  it('draws books 19-24 cm tall and 13-16 cm deep, never above 26 cm', () => {
    for (const width of [320, 390, 900]) {
      const scale = width / 600, shelves = packed(60, width);
      const entries = shelves.flatMap(shelf => shelf.items).map((item, index) => ({ shelf:Math.min(2, Math.floor(index / 20)),
        x:40, height:172, width:172 * COVER_RATIO, thickness:item.style.width, style:item.style }));
      for (const type of ['walnut', 'baggebo']) {
        const result = shelfModelLayout({ width, sceneWidth:width, rows:[{}, {}, {}], entries }, type);
        for (const entry of result.entries) {
          const height = entry.height / scale, depth = entry.width / scale;
          expect(height).toBeGreaterThanOrEqual(BOOK_REFERENCE_MM * .8 - .01);
          expect(height).toBeLessThanOrEqual(BOOK_REFERENCE_MM + .01);
          expect(height).toBeLessThanOrEqual(260);
          expect(depth).toBeGreaterThanOrEqual(BOOK_DEPTH_MM.min - 6);
          expect(depth).toBeLessThanOrEqual(BOOK_DEPTH_MM.max + .01);
        }
      }
    }
    expect(BOOK_REFERENCE_MM * .8).toBeGreaterThanOrEqual(190);
  });

  it('keeps physical spine thicknesses within the paper-stock model bounds', () => {
    for (const width of [320, 390, 900]) {
      const scale = width / 600;
      for (const book of library(80)) {
        const { width:thickness } = spineStyleFor(book, bookSpineOptions(width));
        expect(thickness / scale).toBeGreaterThanOrEqual(BOOK_THICKNESS_MM.min - .005 / scale);
        expect(thickness / scale).toBeLessThanOrEqual(BOOK_THICKNESS_MM.max + .005 / scale);
      }
    }
  });

  it('fits about 12-19 books on a full 56 cm row instead of two', () => {
    for (const width of [360, 390, 428, 900]) {
      const shelves = packed(80, width);
      const full = shelves.slice(0, -1);
      expect(full.length).toBeGreaterThan(3);
      for (const shelf of full) {
        expect(shelf.items.length).toBeGreaterThanOrEqual(12);
        expect(shelf.items.length).toBeLessThanOrEqual(19);
      }
    }
  });

  it('keeps every spine tappable: the layout cell is never narrower than the hit minimum', () => {
    expect(minimumBookCellWidth(390)).toBe(16);
    expect(minimumBookCellWidth(1280)).toBe(18);
    for (const [width, viewport] of [[360, 390], [900, 1280]]) {
      const minimum = minimumBookCellWidth(viewport);
      for (const shelf of packed(60, width)) for (const item of shelf.items) {
        expect(item.width).toBeGreaterThanOrEqual(minimum);
        expect(item.width).toBeGreaterThanOrEqual(item.style.width); // the cell never clips the drawn book
        expect(item.displayWidth).toBe(item.width);
      }
    }
  });

  it('keeps lamps at their catalogue size, a fraction of a 60 cm shelf', () => {
    const scale = shelfScale({ shelfWidth:390 }), row = shelfModelLayout({ width:390, rows:[{}], entries:[] }, 'walnut').rows[1];
    for (const lamp of LAMP_CATALOG) {
      const { width, height, depth } = lamp.dimensions;
      const [entry] = shelfModelLayout({ width:390, sceneWidth:390, rows:[{}, {}, {}], entries:[{ kind:'lamp', mount:lamp.mount,
        shelf:1, x:100, width:width * scale, height:height * scale, depth:depth * scale }] }, 'walnut').entries;
      expect(entry.height / scale).toBeCloseTo(height, 4);
      expect(entry.width / scale).toBeCloseTo(width, 4);
      expect(entry.height).toBeLessThan(row.bottom - row.top);
      expect(width).toBeLessThanOrEqual(180); // at most 30 % of the shelf
    }
  });

  it('uses one pixels-per-millimetre scale for both shelf types', () => {
    expect(shelfScale({ shelfWidth:390 })).toBeCloseTo(.65);
    expect(shelfScale({ shelfWidth:1200 })).toBeCloseTo(2);
    expect(shelfScale({})).toBeCloseTo(.65);
  });
});
