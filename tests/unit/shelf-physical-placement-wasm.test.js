// @vitest-environment node
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadRustCore } from '../../src/js/rust-core.js';
import { createShelfPlacementSession, placeObjects, rustShelfPlacement } from '../../src/js/shelf-placement-wasm.js';
import { layoutShelvedObjects, moveShelfObject } from './helpers/reference-shelf-placement.js';

let core;
const options = { shelfWidth:360, padding:16, gap:3, minShelves:3, physicalPlacement:true };
const geometry = rows => Object.fromEntries(rows.flatMap(row => row.items).map(item =>
  [item.key, { shelf:item.shelf, x:item.x, left:item.left, center:item.center }]));
const plants = () => [
  { key:'plant:fern', kind:'plant', width:140, shelf:0, x:.35 },
  { key:'plant:monstera', kind:'plant', width:140, shelf:0, x:.55 },
];

beforeAll(async () => {
  core = await loadRustCore({ bytes:readFileSync(new URL('../../src/wasm/inhouse_read_core.wasm', import.meta.url)) });
  expect(typeof core?.shelf_place).toBe('function');
});

describe('physical shelf placement keeps actual contact positions', () => {
  it('allows overlapping plant silhouettes without separating their explicit centres', () => {
    const objects = plants(), before = structuredClone(objects);
    const rows = placeObjects(core, objects, options), placed = geometry(rows);
    expect(placed['plant:fern'].x).toBe(.35);
    expect(placed['plant:monstera'].x).toBe(.55);
    expect(placed['plant:monstera'].left).toBeLessThan(placed['plant:fern'].left + 140);
    expect(rows[0].items).toHaveLength(2);
    expect(objects).toEqual(before);
  });

  it('moving a book changes only its own explicit slot, even when nominal widths exceed the row', () => {
    const objects = [...plants(),
      { key:'lamp:tripod', kind:'lamp', width:90, shelf:0, x:.8 },
      { key:'book:moved', kind:'book', width:32, shelf:1, x:.25 }];
    const original = geometry(placeObjects(core, objects, options));
    const moved = placeObjects(core, objects, options,
      { move:true, movedKey:'book:moved', target:{ shelf:0, x:.45 } });
    const after = geometry(moved.shelves);
    for (const key of ['plant:fern', 'plant:monstera', 'lamp:tripod']) expect(after[key]).toEqual(original[key]);
    expect(moved.shelves[0].items).toHaveLength(4);
    expect(moved.placements['book:moved'].shelf).toBe(0);
    expect(moved.placements['book:moved'].x).toBeCloseTo(.45, 14);
    expect(moved.shelves.slice(1).flatMap(row => row.items)).toHaveLength(0);
  });

  it('saved overlapping placements survive repeated reloads without repacking or numeric drift', () => {
    const objects = [...plants(), { key:'lamp:retro', kind:'lamp', width:100, shelf:0, x:.75 }];
    const moved = placeObjects(core, objects, options,
      { move:true, movedKey:'lamp:retro', target:{ shelf:0, x:.7 } });
    const expected = geometry(moved.shelves);
    for (let reload = 0; reload < 12; reload++) {
      const rows = placeObjects(core, objects, { ...options, placements:moved.placements });
      expect(geometry(rows)).toEqual(expected);
    }
  });

  it('carries physical mode into repeated prepared drag jobs and preserves all bystanders', () => {
    const objects = [...plants(), { key:'book:moved', kind:'book', width:30, shelf:1, x:.3 }];
    const baseline = geometry(placeObjects(core, objects, options));
    const session = createShelfPlacementSession(objects, options);
    expect(session).not.toBeNull();
    try {
      for (const x of [.4, .45, .52, .6]) {
        const moved = session.move(core, 'book:moved', 0, x);
        const expected = rustShelfPlacement(core, objects, options,
          { separateMounts:true, move:true, movedKey:'book:moved', target:{ shelf:0, x } });
        expect(moved).toEqual(expected);
        const after = geometry(moved.shelves);
        for (const plant of plants()) expect(after[plant.key]).toEqual(baseline[plant.key]);
        expect(moved.placements['book:moved'].x).toBeCloseTo(x, 14);
      }
    } finally { session.dispose(); }
  });

  it('places a new automatic item in free space without moving nearby plants', () => {
    const objects = [...plants(), { key:'book:new', kind:'book', width:24, shelf:0 }];
    const before = geometry(placeObjects(core, plants(), options));
    const rows = placeObjects(core, objects, options), after = geometry(rows);
    for (const plant of plants()) expect(after[plant.key]).toEqual(before[plant.key]);
    expect(after['book:new']).toMatchObject({ shelf:0, left:16 });
    expect(after['book:new'].left + 24 + options.gap).toBeLessThanOrEqual(after['plant:fern'].left);
  });

  it('spills only an unpositioned item when it cannot fit the requested shelf', () => {
    const objects = [...plants(), { key:'book:new', kind:'book', width:200, shelf:0 }];
    const before = geometry(placeObjects(core, plants(), options));
    const after = geometry(placeObjects(core, objects, options));
    for (const plant of plants()) expect(after[plant.key]).toEqual(before[plant.key]);
    expect(after['book:new']).toMatchObject({ shelf:1, left:16 });
  });

  it('does not insert an automatic item inside a wide silhouette after a nested narrow item', () => {
    const objects = [
      { key:'plant:wide', kind:'plant', width:240, shelf:0, x:.5 },
      { key:'book:nested', kind:'book', width:40, shelf:0, x:.5 },
      { key:'lamp:new', kind:'lamp', width:60, shelf:0 },
    ];
    const rows = placeObjects(core, objects, options), placed = geometry(rows);
    expect(placed['plant:wide']).toMatchObject({ shelf:0, left:60, center:180 });
    expect(placed['book:nested']).toMatchObject({ shelf:0, left:160, center:180 });
    expect(placed['lamp:new']).toMatchObject({ shelf:1, left:16 });
    expect(rows.every(row => row.freeWidth >= 0)).toBe(true);
  });

  it('retains cabinet side clamps and independent floor/ceiling mounting surfaces', () => {
    const objects = [
      { key:'plant:left', kind:'plant', width:160, shelf:0, x:0 },
      { key:'plant:right', kind:'plant', width:120, shelf:0, x:1 },
      { key:'lamp:ceiling', kind:'lamp', mount:'undershelf', width:240, shelf:0, x:.5 },
    ];
    const rows = rustShelfPlacement(core, objects, options, { separateMounts:true });
    expect(rows[0].items).toHaveLength(3);
    const placed = geometry(rows);
    expect(placed['plant:left'].left).toBe(16);
    expect(placed['plant:right'].left + 120).toBe(344);
    expect(placed['lamp:ceiling']).toMatchObject({ shelf:0, x:.5, center:180 });
  });

  it('separates ceiling pucks at the same requested centre while preserving overlapping floor objects', () => {
    const floor = plants(), pucks = [
      { key:'lamp:puck1', kind:'lamp', mount:'undershelf', width:70, shelf:0, x:.5 },
      { key:'lamp:puck2', kind:'lamp', mount:'undershelf', width:70, shelf:0, x:.5 },
    ];
    const objects = [...floor, ...pucks];
    const before = geometry(placeObjects(core, floor, options));
    const verify = rows => {
      const placed = geometry(rows);
      for (const plant of floor) expect(placed[plant.key]).toEqual(before[plant.key]);
      const ceiling = rows.flatMap(row => row.items).filter(item => item.mount === 'undershelf').sort((a,b) => a.left-b.left);
      expect(ceiling).toHaveLength(2);
      expect(ceiling[0].left + ceiling[0].width + options.gap).toBeLessThanOrEqual(ceiling[1].left);
    };
    verify(rustShelfPlacement(core, objects, options, { separateMounts:true }));
    const session = createShelfPlacementSession(objects, options);
    try {
      const moved = session.move(core, 'lamp:puck1', 0, .6);
      verify(moved.shelves);
      const expected = moveShelfObject(pucks, 'lamp:puck1', { shelf:0, x:.6 }, options);
      for (const puck of pucks) expect(moved.placements[puck.key]).toEqual(expected.placements[puck.key]);
    } finally { session.dispose(); }
  });

  it('keeps the original interval packing unless physical placement is explicitly true', () => {
    const objects = [...plants(), { key:'lamp:tripod', kind:'lamp', width:90, shelf:0, x:.8 }];
    const { physicalPlacement, ...legacy } = options;
    const expectedRows = layoutShelvedObjects(objects, legacy);
    const expectedMove = moveShelfObject(objects, 'plant:fern', { shelf:0, x:.6 }, legacy);
    for (const value of [undefined, false, 1, 'true']) {
      const cfg = { ...legacy, physicalPlacement:value };
      expect(placeObjects(core, objects, cfg)).toEqual(expectedRows);
      expect(placeObjects(core, objects, cfg,
        { move:true, movedKey:'plant:fern', target:{ shelf:0, x:.6 } })).toEqual(expectedMove);
    }
    expect(expectedRows[1].items.length).toBeGreaterThan(0);
  });
});
