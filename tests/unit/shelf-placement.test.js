import { describe, expect, it } from 'vitest';
import { layoutShelvedObjects, moveShelfObject } from '../../src/js/shelf-placement.js';

const config = { shelfWidth: 300, padding: 10, gap: 4, minShelves: 3 };
const book = (id, x, shelf = 0, width = 40) => ({ key: `book:${id}`, kind: 'book', width, shelf, x });
const plant = (id, x, shelf = 0, width = 60) => ({ key: `plant:${id}`, kind: 'plant', seed: id, width, shelf, x });
const allItems = shelves => shelves.flatMap(shelf => shelf.items);

function expectSafe(shelves, cfg = config) {
  const keys = [];
  for (const shelf of shelves) {
    expect(shelf.items).toBe(shelf.objects);
    for (const [index, item] of shelf.items.entries()) {
      keys.push(item.key);
      expect(item.shelf).toBe(shelf.index);
      expect(item.row).toBe(shelf.index);
      expect(item.left).toBeGreaterThanOrEqual(cfg.padding - 0.00001);
      expect(item.left + item.width).toBeLessThanOrEqual(cfg.shelfWidth - cfg.padding + 0.00001);
      expect(item.x).toBeGreaterThanOrEqual(0);
      expect(item.x).toBeLessThanOrEqual(1);
      if (index) {
        const previous = shelf.items[index - 1];
        expect(item.left - previous.left - previous.width).toBeGreaterThanOrEqual(cfg.gap - 0.00001);
      }
    }
  }
  expect(new Set(keys).size).toBe(keys.length);
}

describe('layoutShelvedObjects', () => {
  it('retains three empty shelves and can display an intentionally empty row', () => {
    expect(layoutShelvedObjects([], config)).toHaveLength(3);
    const shelves = layoutShelvedObjects([book('low', 0.7, 4)], config);
    expect(shelves).toHaveLength(5);
    expect(shelves.slice(0, 4).every(shelf => shelf.items.length === 0)).toBe(true);
    expect(shelves[4].items[0].x).toBeCloseTo(0.7);
    expectSafe(shelves);
  });

  it('preserves deliberately large gaps rather than packing everything together', () => {
    const objects = [book('left', 0.15), plant('middle', 0.5), book('right', 0.85)];
    const shelves = layoutShelvedObjects(objects, config);
    expect(shelves[0].items.map(item => item.x)).toEqual([0.15, 0.5, 0.85]);
    expect(shelves[0].items[1].left - shelves[0].items[0].left - 40).toBeGreaterThan(40);
    expect(shelves[0].items[2].left - shelves[0].items[1].left - 60).toBeGreaterThan(40);
    expectSafe(shelves);
  });

  it('honours saved positions before default positions and keeps object metadata', () => {
    const objects = [{ ...book('a', 0.15), title: 'Un libro' }, plant('p', 0.4)];
    const shelves = layoutShelvedObjects(objects, {
      ...config,
      placements: { 'book:a': { shelf: 2, x: 0.8 }, 'plant:p': { shelf: 0, x: 0.2 } }
    });
    expect(shelves[2].items[0]).toMatchObject({ key: 'book:a', title: 'Un libro', x: 0.8 });
    expect(shelves[0].items[0]).toMatchObject({ key: 'plant:p', seed: 'p', x: 0.2 });
    expectSafe(shelves);
  });

  it('places a new object in a real free gap without moving saved objects', () => {
    const objects = [book('left', 0.15), book('right', 0.85), { key: 'book:new', kind: 'book', width: 40 }];
    const shelves = layoutShelvedObjects(objects, config);
    const entries = Object.fromEntries(allItems(shelves).map(item => [item.key, item]));
    expect(entries['book:left'].x).toBeCloseTo(0.15);
    expect(entries['book:right'].x).toBeCloseTo(0.85);
    expect(entries['book:new'].shelf).toBe(0);
    expect(entries['book:new'].left).toBeGreaterThan(entries['book:left'].left);
    expect(entries['book:new'].left).toBeLessThan(entries['book:right'].left);
    expectSafe(shelves);
  });

  it('corrects collisions after a mobile resize without losing plants or books', () => {
    const objects = [book('a', 0.1, 0, 80), plant('p', 0.32, 0, 80), book('b', 0.57, 0, 80), book('c', 0.85, 0, 80)];
    const desktop = layoutShelvedObjects(objects, { ...config, shelfWidth: 600 });
    const placements = Object.fromEntries(allItems(desktop).map(item => [item.key, { shelf: item.shelf, x: item.x }]));
    const mobile = layoutShelvedObjects(objects, { ...config, placements });
    expect(allItems(mobile).map(item => item.key).sort()).toEqual(objects.map(item => item.key).sort());
    expect(mobile[1].items.length).toBeGreaterThan(0);
    expectSafe(mobile);
  });

  it('fits collisions in the current row when total object widths still fit', () => {
    const shelves = layoutShelvedObjects([book('a', 0.85, 0, 70), book('b', 0.88, 0, 70), book('c', 0.91, 0, 70)], config);
    expect(shelves[0].items).toHaveLength(3);
    expect(shelves[1].items).toHaveLength(0);
    expectSafe(shelves);
  });

  it('ignores duplicate keys, malformed placements, and removed objects', () => {
    const objects = [book('a', 0.25), book('a', 0.8), plant('p', 0.75), null, { key: '', width: 40 }];
    const shelves = layoutShelvedObjects(objects, {
      ...config,
      placements: { 'book:a': { shelf: -4, x: Infinity }, 'plant:p': { shelf: NaN, x: 0.3 }, missing: { shelf: 100, x: 0.8 } }
    });
    expect(allItems(shelves)).toHaveLength(2);
    expect(shelves).toHaveLength(3);
    expect(allItems(shelves).map(item => item.x)).toEqual([0.25, 0.75]);
    expectSafe(shelves);
  });

  it('clamps boundaries, oversized objects and invalid width without overlaps', () => {
    const shelves = layoutShelvedObjects([
      book('left', -1), book('right', 5), plant('huge', 0.5, 1, 900), { key: 'book:invalid', width: NaN, x: 0.5 }
    ], config);
    expect(allItems(shelves).find(item => item.key === 'plant:huge').width).toBe(280);
    expectSafe(shelves);
    expect(layoutShelvedObjects([book('a', 0.5)], { shelfWidth: 20, padding: 16 })).toEqual([]);
  });

  it('does not mutate object arrays, metadata, or the saved placement snapshot', () => {
    const objects = [book('a', 0.1), plant('p', 0.11)];
    const placements = { 'book:a': { shelf: 0, x: 0.6 } };
    const before = JSON.stringify({ objects, placements });
    layoutShelvedObjects(objects, { ...config, placements });
    expect(JSON.stringify({ objects, placements })).toBe(before);
  });
});

describe('moveShelfObject', () => {
  it('keeps untouched plant positions exact across repeated layout and moves', () => {
    const cfg = { shelfWidth:390, padding:16, gap:3, minShelves:3 };
    const objects = [plant('kept', .45, 0, 52), plant('moved', .65, 2, 50)];
    let snapshot = objects;
    for (let index = 0; index < 12; index++) {
      const result = moveShelfObject(snapshot, 'plant:moved', { shelf:2, x:index % 2 ? .35 : .65 }, cfg);
      expect(result.placements['plant:kept']).toEqual({ shelf:0, x:.45 });
      snapshot = result.objects;
      expectSafe(result.shelves, cfg);
    }
  });
  it('pins a book at an arbitrary point and pushes a plant and adjacent book aside', () => {
    const objects = [book('a', 0.15), plant('p', 0.5), book('b', 0.8)];
    const moved = moveShelfObject(objects, 'book:a', { shelf: 0, x: 0.5 }, config);
    expect(moved.placements['book:a']).toEqual({ shelf: 0, x: 0.5 });
    expect(moved.placements['plant:p'].x).toBeGreaterThan(0.5);
    expect(moved.placements['book:b'].x).toBeGreaterThan(0.8);
    expectSafe(moved.shelves);
  });

  it('moves plants with exactly the same placement and collision rules', () => {
    const objects = [plant('p', 0.8), book('a', 0.25), book('b', 0.5)];
    const moved = moveShelfObject(objects, 'plant:p', { shelf: 0, x: 0.25 }, config);
    expect(moved.placements['plant:p']).toEqual({ shelf: 0, x: 0.25 });
    expect(moved.placements['book:a'].x).toBeGreaterThan(0.25);
    expectSafe(moved.shelves);
  });

  it('moves across rows while retaining the gap left on the old row', () => {
    const objects = [book('a', 0.2), book('b', 0.65), plant('p', 0.5, 1)];
    const moved = moveShelfObject(objects, 'book:a', { shelf: 1, x: 0.8 }, config);
    expect(moved.shelves[0].items).toHaveLength(1);
    expect(moved.placements['book:b']).toEqual({ shelf: 0, x: 0.65 });
    expect(moved.placements['book:a']).toEqual({ shelf: 1, x: 0.8 });
    expect(moved.placements['plant:p']).toEqual({ shelf: 1, x: 0.5 });
    expectSafe(moved.shelves);
  });

  it('overflows neighbours to subsequent shelves and keeps the dragged item pinned', () => {
    const objects = [book('a', 0.15, 0, 60), plant('p', 0.4, 0, 60), book('b', 0.65, 0, 60), book('c', 0.9, 0, 60), book('dragged', 0.3, 1, 60)];
    const moved = moveShelfObject(objects, 'book:dragged', { shelf: 0, x: 0.5 }, config);
    expect(moved.placements['book:dragged']).toEqual({ shelf: 0, x: 0.5 });
    expect(moved.shelves[1].items.length).toBeGreaterThan(0);
    expect(moved.objects).toHaveLength(objects.length);
    expectSafe(moved.shelves);
  });

  it('uses a gap on the other side before overflowing a neighbour', () => {
    const objects = [book('dragged', 0.15), plant('p', 0.85)];
    const moved = moveShelfObject(objects, 'book:dragged', { shelf: 0, x: 0.9 }, config);
    expect(moved.shelves[0].items).toHaveLength(2);
    expect(moved.placements['plant:p'].shelf).toBe(0);
    expect(moved.placements['plant:p'].x).toBeLessThan(0.85);
    expectSafe(moved.shelves);
  });

  it('returns a cleaned complete snapshot and preserves it on reload', () => {
    const objects = [book('a', 0.15), plant('p', 0.5), book('b', 0.8)];
    const moved = moveShelfObject(objects, 'book:a', { shelf: 2, x: 0.3 }, {
      ...config, placements: { missing: { shelf: 100, x: 0.8 } }
    });
    expect(Object.keys(moved.placements).sort()).toEqual(objects.map(item => item.key).sort());
    const restored = layoutShelvedObjects(objects, { ...config, placements: moved.placements });
    expect(restored).toEqual(moved.shelves);
    expectSafe(restored);
  });

  it('handles a deleted dragged item or invalid target without disturbing the arrangement', () => {
    const objects = [book('a', 0.25), plant('p', 0.75)];
    const expected = layoutShelvedObjects(objects, config);
    expect(moveShelfObject(objects, 'missing', { shelf: 1, x: 0.5 }, config).shelves).toEqual(expected);
    expect(moveShelfObject(objects, 'book:a', { shelf: -1, x: NaN }, config).shelves).toEqual(expected);
    expectSafe(expected);
  });

  it('is deterministic and idempotent through repeated move-save-layout cycles', () => {
    const objects = Array.from({ length: 30 }, (_, index) => index % 4 === 0
      ? plant(`p${index}`, (index % 7 + 0.5) / 7, Math.floor(index / 7), 52)
      : book(`b${index}`, (index % 7 + 0.5) / 7, Math.floor(index / 7), 31));
    let current = allItems(layoutShelvedObjects(objects, config));
    for (let index = 0; index < 60; index += 1) {
      const key = objects[(index * 11) % objects.length].key;
      const target = { shelf: index % 5, x: ((index * 17) % 101) / 100 };
      const moved = moveShelfObject(current, key, target, config);
      expect(moveShelfObject(current, key, target, config)).toEqual(moved);
      expectSafe(moved.shelves);
      expect(moved.objects).toHaveLength(objects.length);
      const restored = layoutShelvedObjects(objects, { ...config, placements: moved.placements });
      expectSafe(restored);
      for (const object of allItems(restored)) {
        expect(object.shelf).toBe(moved.placements[object.key].shelf);
        expect(object.x).toBeCloseTo(moved.placements[object.key].x, 8);
      }
      current = moved.objects;
    }
  });
});
