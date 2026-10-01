import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderBookshelf } from '../../src/js/bookshelf.js';

const catalog = vi.hoisted(() => ({ options:null }));
vi.mock('../../src/js/plant-catalog.js', () => ({ createPlantCatalog(options) {
  catalog.options = options;
  return { open:vi.fn(), close:vi.fn(), destroy:vi.fn(), setShelfType:vi.fn() };
} }));
const KEY = 'inhouse-read-shelf-lamps';
const PLANTS = 'inhouse-read-shelf-plants';
let container, shelf;
beforeEach(() => {
  localStorage.clear(); localStorage.setItem(PLANTS, '[]');
  container = document.createElement('div'); document.body.append(container);
});
afterEach(() => { shelf?.destroy(); shelf=null; container.remove(); localStorage.clear(); vi.restoreAllMocks(); });
const books = [{ id:'keep', title:'Conservar', format:'PDF', shelfPosition:{ shelf:0, x:.5 } }];

describe('persistent shelf illumination', () => {
  it('adds all three models with distinct identities and restores their saved placement', async () => {
    shelf = renderBookshelf(container, [], { shelfWidth:390 });
    for (const lampId of ['mittled','tarnaby','tripod']) await catalog.options.onAddLamp({ lampId });
    const records = JSON.parse(localStorage.getItem(KEY));
    expect(records.map(record => record.lampId)).toEqual(['mittled','tarnaby','tripod']);
    expect(new Set(records.map(record => record.key)).size).toBe(3);
    expect(records.every(record => Number.isFinite(record.x) && record.shelf >= 0)).toBe(true);
    expect(container.querySelectorAll('.ihr-lamp')).toHaveLength(3);
    expect(container.querySelectorAll('.ihr-lamp > svg')).toHaveLength(3);
    shelf.destroy(); shelf = renderBookshelf(container, [], { shelfWidth:320 });
    expect(container.querySelectorAll('.ihr-lamp')).toHaveLength(3);
    expect(JSON.parse(localStorage.getItem(KEY))).toEqual(records);
    expect(container.querySelector('[data-lamp-id="mittled"]').dataset.lampMount).toBe('undershelf');
  });

  it('rejects invalid lamp choices and restores the previous collection when storage fails', async () => {
    shelf = renderBookshelf(container, [], { shelfWidth:390 });
    await expect(catalog.options.onAddLamp({ lampId:'missing' })).rejects.toThrow('Elige una lámpara');
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Quota'); });
    await expect(catalog.options.onAddLamp({ lampId:'tripod' })).rejects.toThrow('No se pudo guardar');
    expect(container.querySelectorAll('.ihr-lamp')).toHaveLength(0);
  });

  it('moves a spotlight with the keyboard without displacing books or plants', async () => {
    shelf = renderBookshelf(container, books, { shelfWidth:390 });
    await catalog.options.onAddLamp({ lampId:'mittled' });
    const node = container.querySelector('.ihr-lamp');
    node.dispatchEvent(new KeyboardEvent('keydown', { key:'ArrowDown', shiftKey:true, bubbles:true, cancelable:true }));
    expect(JSON.parse(localStorage.getItem(KEY))[0].shelf).toBe(1);
    expect(container.querySelector('.ihr-spine').dataset.shelfIndex).toBe('0');
    expect(JSON.parse(localStorage.getItem(PLANTS))).toEqual([]);
  });

  it('removes just the selected lamp and keeps an empty lamp collection empty after remounting', async () => {
    const onBookRemove = vi.fn();
    shelf = renderBookshelf(container, books, { shelfWidth:390, onBookRemove });
    await catalog.options.onAddLamp({ lampId:'tarnaby' });
    container.querySelector('.ihr-lamp').dispatchEvent(new KeyboardEvent('keydown', { key:'Delete', bubbles:true, cancelable:true }));
    await Promise.resolve();
    expect(JSON.parse(localStorage.getItem(KEY))).toEqual([]);
    expect(container.querySelectorAll('.ihr-lamp')).toHaveLength(0);
    expect(container.querySelector('[data-book-id="keep"]')).not.toBeNull();
    expect(onBookRemove).not.toHaveBeenCalled();
    shelf.destroy(); shelf = renderBookshelf(container, books, { shelfWidth:390 });
    expect(container.querySelectorAll('.ihr-lamp')).toHaveLength(0);
  });

  it('ignores corrupt selections and duplicate identities during restoration', () => {
    localStorage.setItem(KEY, JSON.stringify([{ key:'lamp:a', lampId:'tarnaby' },
      { key:'lamp:a', lampId:'tripod' }, { key:'lamp:no', lampId:'unknown' }, null]));
    shelf = renderBookshelf(container, books, { shelfWidth:390 });
    expect(container.querySelectorAll('.ihr-lamp')).toHaveLength(1);
    expect(container.querySelector('.ihr-lamp').dataset.lampId).toBe('tarnaby');
  });
});
