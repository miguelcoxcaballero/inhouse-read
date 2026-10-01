import { describe, expect, it } from 'vitest';
import { layoutShelfDecorations, moveShelfDecoration } from '../../src/js/shelf-decoration-layout.js';

const cfg = { shelfWidth:320, padding:16, gap:4, minShelves:3 };
const book = { key:'book:keep', kind:'book', width:140, shelf:0, x:.5 };
const puck = { key:'lamp:puck', kind:'lamp', mount:'undershelf', width:44, shelf:0, x:.5 };
const position = object => ({ shelf:object.shelf, x:object.x });

describe('independent shelf mounting surfaces', () => {
  it('attaches a centred spotlight above a full row without moving books', () => {
    const books = [book, { ...book, key:'book:second', x:.85 }];
    const before = layoutShelfDecorations(books, cfg).flatMap(row => row.items);
    const after = layoutShelfDecorations([...books, puck], cfg).flatMap(row => row.items);
    expect(after.filter(item => item.kind === 'book').map(position)).toEqual(before.map(position));
    expect(after.find(item => item.key === puck.key)).toMatchObject({ shelf:0, x:.5 });
  });

  it('moves a roof light between shelves while retaining floor positions', () => {
    const initial = layoutShelfDecorations([book, puck], cfg).flatMap(row => row.items);
    const moved = moveShelfDecoration(initial, puck.key, { shelf:2, x:.8 }, cfg);
    expect(moved.placements[book.key]).toEqual(position(initial[0]));
    expect(moved.placements[puck.key]).toEqual({ shelf:2, x:.8 });
    expect(moved.shelves).toHaveLength(3);
  });

  it('resolves collisions between table lamps and books on the same surface', () => {
    const lamp = { key:'lamp:table', kind:'lamp', mount:'standing', width:98, shelf:0, x:.8 };
    const initial = layoutShelfDecorations([book, lamp, puck], cfg).flatMap(row => row.items);
    const moved = moveShelfDecoration(initial, lamp.key, { shelf:0, x:.5 }, cfg);
    const table = moved.objects.find(item => item.key === lamp.key);
    const remainingBook = moved.objects.find(item => item.key === book.key);
    if (remainingBook.shelf === table.shelf)
      expect(Math.abs(remainingBook.center - table.center)).toBeGreaterThanOrEqual((remainingBook.width + table.width) / 2 + cfg.gap);
    expect(moved.placements[puck.key]).toEqual({ shelf:0, x:.5 });
  });

  it('keeps every light on furniture when a stored roof position extends the row count', () => {
    const rows = layoutShelfDecorations([book, { ...puck, shelf:4 }], cfg);
    expect(rows).toHaveLength(5);
    expect(rows[4].items[0].key).toBe(puck.key);
    expect(rows[4].occupiedWidth).toBe(0);
  });
});
