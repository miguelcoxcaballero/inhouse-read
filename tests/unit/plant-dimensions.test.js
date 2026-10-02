import { describe, expect, it } from 'vitest';
import { PLANT_CATALOG, POT_CATALOG } from '../../src/js/plant-catalog-data.js';
import { BAGGEBO_SPEC } from '../../src/js/shelf-types.js';
import { normalizeShelfPlant } from '../../src/js/plant-records.js';
import { layoutShelvedObjects } from '../../src/js/shelf-placement.js';
import { baggeboLayout } from '../../src/js/shelf-model-layout.js';
import {
  PLANT_MAX_HEIGHT_MM, PLANT_SIZES, POT_DIAMETER_MM, POT_SIZES, SHELF_CLEARANCE_MM, plantDimensions,
  plantSceneSize, plantSizeLabel, shelfScale, standardPlantClass, BOOK_REFERENCE_MM
} from '../../src/js/plant-dimensions.js';

describe('standard IKEA plant and pot sizes', () => {
  it('gives every pot model the same 12 cm nursery class, with model-specific outer dimensions', () => {
    expect(POT_DIAMETER_MM).toBe(120);
    expect(Object.keys(POT_SIZES).sort()).toEqual(POT_CATALOG.map(pot => pot.id).sort());
    for (const pot of POT_CATALOG) {
      expect(POT_SIZES[pot.id].nursery).toBe(12);
      expect(pot.diameter).toBe({muskot:150,muskotblomma:160,akerbar:140,gradvis:130}[pot.id]);
      expect(pot.height).toBeGreaterThanOrEqual(90); expect(pot.height).toBeLessThanOrEqual(140);
      expect(pot.footprint).toBeGreaterThanOrEqual(pot.diameter);
    }
  });

  it('has exactly one real size per species, in IKEA nursery classes', () => {
    expect(Object.keys(PLANT_SIZES).sort()).toEqual(PLANT_CATALOG.map(plant => plant.id).sort());
    for (const plant of PLANT_CATALOG) {
      const standard = standardPlantClass(plant.id);
      expect([6, 9, 12]).toContain(standard.potClass);
      expect(plant.height).toBe(standard.height);
      expect(plant.canopy).toBe(standard.width);
      expect(plant.width).toBeGreaterThanOrEqual(plant.canopy);
      expect(plant.height).toBeGreaterThanOrEqual(100); expect(plant.height).toBeLessThanOrEqual(450);
    }
  });

  it('picks the largest IKEA class of each species that fits the tightest shelf, never shrinking one', () => {
    for (const id of Object.keys(PLANT_SIZES)) {
      const standard = standardPlantClass(id), classes = PLANT_SIZES[id].classes;
      expect(standard.fits).toBe(id !== 'monstera');
      expect(standard.height).toBeLessThanOrEqual(id === 'monstera' ? 350 : PLANT_MAX_HEIGHT_MM);
      expect(standard).toMatchObject(classes[standard.potClass]);
      // A larger class would not fit: the choice is not arbitrary.
      for (const bigger of Object.keys(classes).map(Number).filter(size => size > standard.potClass))
        expect(classes[bigger].height).toBeGreaterThan(PLANT_MAX_HEIGHT_MM);
    }
    expect(standardPlantClass('sansevieria').potClass).toBe(9);
    expect(standardPlantClass('monstera').potClass).toBe(12);
    expect(standardPlantClass('missing')).toBeNull();
  });

  it('fits the tightest compartment of every shelf type with its book margin', () => {
    const margin = 4, rows = BAGGEBO_SPEC.shelfBottoms.map((bottom, slot) =>
      bottom - (slot ? BAGGEBO_SPEC.shelfBottoms[slot - 1] + BAGGEBO_SPEC.shelfRimHeight : BAGGEBO_SPEC.postSize) - margin);
    expect(SHELF_CLEARANCE_MM.baggebo).toBeCloseTo(306, 2);
    expect(PLANT_MAX_HEIGHT_MM).toBeLessThanOrEqual(Math.min(...rows));
    expect(PLANT_MAX_HEIGHT_MM).toBeLessThan(SHELF_CLEARANCE_MM.baggebo);
    expect(PLANT_MAX_HEIGHT_MM).toBeLessThan(SHELF_CLEARANCE_MM.walnut);
    for (const plant of PLANT_CATALOG) for (const pot of POT_CATALOG) {
      const size = plantDimensions(plant.id, pot.id);
      expect(size.height).toBeLessThanOrEqual(plant.id === 'monstera' ? 350 : PLANT_MAX_HEIGHT_MM);
      // The round pot always has room on the 220 mm usable depth.
      expect(size.depth).toBeLessThanOrEqual(BAGGEBO_SPEC.usableDepth);
      expect(size.depth).toBeGreaterThanOrEqual(size.potFootprint);
    }
  });

  it('keeps real proportions against a 12 cm pot, a 24 cm book and the 60 cm shelf', () => {
    const baggebo = shelfScale({ shelfType:'baggebo', shelfWidth:390, viewportWidth:390 });
    expect(baggebo * BAGGEBO_SPEC.width).toBeCloseTo(390);
    expect(baggebo * BOOK_REFERENCE_MM).toBeCloseTo(156); // the tallest book baggeboLayout draws
    // The wooden shelf is the same 600 mm unit: one scale for both types.
    expect(shelfScale({ shelfType:'walnut', shelfWidth:390, viewportWidth:390 })).toBeCloseTo(baggebo);
    expect(shelfScale({ shelfType:'walnut', shelfWidth:900, viewportWidth:1280 }) * BAGGEBO_SPEC.width).toBeCloseTo(900);
    const pot = POT_DIAMETER_MM * baggebo, shelf = BAGGEBO_SPEC.width * baggebo;
    expect(pot / shelf).toBeCloseTo(.2); // a 12 cm pot is a fifth of the 60 cm shelf
    const size = plantSceneSize('monstera', 'muskot', baggebo);
    expect(size.height / (BOOK_REFERENCE_MM * baggebo)).toBeCloseTo(350 / 240); // a 35 cm monstera against a 24 cm book
    expect(plantSceneSize('missing', 'muskot', 1)).toBeNull();
  });

  it('writes the size the way the shelf catalogue writes published measures', () => {
    expect(plantSizeLabel('sansevieria', 'muskot')).toBe('Maceta Ø15 × 14 cm · planta 25 cm aprox. (sin verificar)');
    expect(plantSizeLabel('succulent', 'gradvis')).toBe('Maceta Ø13 × 12 cm · planta 16 cm aprox.');
    expect(plantSizeLabel('missing', 'muskot')).toBe('');
  });

  it('keeps every plant at its real size on a BAGGEBO shelf instead of shrinking it to fit', () => {
    const scale = 390 / BAGGEBO_SPEC.width, rows = [{}, {}, {}];
    for (const plant of PLANT_CATALOG) for (const pot of POT_CATALOG) {
      const size = plantSceneSize(plant.id, pot.id, scale), real = plantDimensions(plant.id, pot.id);
      const [entry] = baggeboLayout({ width:390, rows, entries:[{ kind:'plant', shelf:0, x:100, y:0,
        width:size.width, height:size.height, depth:size.depth }] }).entries;
      expect(entry.height).toBeCloseTo(real.height * scale, 6);
      expect(entry.width).toBeCloseTo(real.width * scale, 6);
      expect(entry.depth).toBeCloseTo(real.depth * scale, 6);
    }
  });

  it('re-flows saved plants at their new size without overlaps, losing none and moving only collisions', () => {
    const scale = shelfScale({ shelfType:'walnut', shelfWidth:390, viewportWidth:390 });
    const saved = [
      { key:'plant:a', catalogId:'monstera', width:92, height:126, shelf:0, x:.15 },
      { key:'plant:b', catalogId:'nephrolepis', width:94, height:104, shelf:0, x:.4 },
      { key:'plant:c', catalogId:'cactus', width:56, height:90, shelf:0, x:.95 },
      { key:'plant:d', catalogId:'succulent', width:66, height:72, shelf:1, x:.5 }
    ];
    const objects = saved.map(record => normalizeShelfPlant(record))
      .map(record => ({ ...record, kind:'plant', width:record.width * scale }));
    const options = { shelfWidth:390, padding:16, gap:3, minShelves:3 };
    const rows = layoutShelvedObjects(objects, options);
    const placed = rows.flatMap(row => row.items);
    expect(placed.map(item => item.key).sort()).toEqual(['plant:a', 'plant:b', 'plant:c', 'plant:d']);
    for (const row of rows) {
      const items = [...row.items].sort((a, b) => a.left - b.left);
      for (let i = 1; i < items.length; i++) expect(items[i].left).toBeGreaterThanOrEqual(items[i - 1].left + items[i - 1].width + 3 - 1e-6);
      for (const item of items) { expect(item.left).toBeGreaterThanOrEqual(16 - 1e-6); expect(item.left + item.width).toBeLessThanOrEqual(374 + 1e-6); }
    }
    // The lone plant on shelf 1 had no neighbour: it keeps its saved place.
    expect(placed.find(item => item.key === 'plant:d')).toMatchObject({ shelf:1, x:.5 });
    // Rows still re-flow when the screen is narrower than the new real sizes need.
    const narrow = layoutShelvedObjects(objects, { ...options, shelfWidth:280 });
    expect(narrow.flatMap(row => row.items)).toHaveLength(4);
  });
});
