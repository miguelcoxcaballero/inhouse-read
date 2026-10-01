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
afterEach(() => { shelf?.destroy(); shelf=null; container.remove(); localStorage.clear(); vi.useRealTimers(); vi.restoreAllMocks(); });
const books = [{ id:'keep', title:'Conservar', format:'PDF', shelfPosition:{ shelf:0, x:.5 } }];
const savedLamps = () => JSON.parse(localStorage.getItem(KEY));
function pointer(node, type, x=160, y=240) {
  const event = new MouseEvent(type, { clientX:x, clientY:y, button:0, bubbles:true, cancelable:true });
  Object.defineProperties(event, { pointerId:{ value:1 }, pointerType:{ value:'touch' } });
  node.dispatchEvent(event);
}

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

  it('restores old lamps switched on and preserves an explicit saved off state', () => {
    localStorage.setItem(KEY, JSON.stringify([
      { key:'lamp:legacy', lampId:'tarnaby', shelf:0, x:.25 },
      { key:'lamp:off', lampId:'tripod', shelf:1, x:.7, isOn:false }
    ]));
    shelf = renderBookshelf(container, books, { shelfWidth:390 });
    const legacy = container.querySelector('[data-object-id="lamp:legacy"]');
    const off = container.querySelector('[data-object-id="lamp:off"]');
    expect(legacy.getAttribute('aria-pressed')).toBe('true');
    expect(legacy.getAttribute('aria-label')).toBe('Apagar lámpara TÄRNABY');
    expect(legacy.dataset.lampOn).toBe('true');
    expect(off.getAttribute('aria-pressed')).toBe('false');
    expect(off.getAttribute('aria-label')).toMatch(/^Encender lámpara /);
    expect(off.dataset.lampOn).toBe('false');
    legacy.click();
    expect(savedLamps().map(record => record.isOn)).toEqual([false, false]);
    shelf.destroy(); shelf = renderBookshelf(container, books, { shelfWidth:320 });
    expect([...container.querySelectorAll('.ihr-lamp')].map(node => node.getAttribute('aria-pressed')))
      .toEqual(['false', 'false']);
  });

  it('a tap toggles exactly once and saves only that lamp without changing its placement', async () => {
    shelf = renderBookshelf(container, books, { shelfWidth:390 });
    for (const lampId of ['mittled', 'tarnaby', 'tripod']) await catalog.options.onAddLamp({ lampId });
    const before = savedLamps(), lamp = container.querySelector('[data-lamp-id="tarnaby"]');
    const save = vi.spyOn(Storage.prototype, 'setItem');
    pointer(lamp, 'pointerdown'); pointer(lamp, 'pointerup'); lamp.click();
    expect(save.mock.calls.filter(([key]) => key === KEY)).toHaveLength(1);
    expect(savedLamps()).toEqual(before.map(record => record.lampId === 'tarnaby' ? { ...record, isOn:false } : record));
    expect(lamp.dataset.lampOn).toBe('false');
    expect(lamp.getAttribute('aria-label')).toBe('Encender lámpara TÄRNABY');
    expect(lamp.getAttribute('aria-pressed')).toBe('false');
    lamp.click();
    expect(savedLamps()).toEqual(before);
    expect(lamp.getAttribute('aria-pressed')).toBe('true');
    expect(container.querySelector('[data-book-id="keep"]')).not.toBeNull();
    expect(localStorage.getItem(PLANTS)).toBe('[]');
  });

  it('keeps the previous light state when storage fails and allows a later retry', async () => {
    shelf = renderBookshelf(container, books, { shelfWidth:390 });
    await catalog.options.onAddLamp({ lampId:'tarnaby' });
    const lamp = container.querySelector('.ihr-lamp'), before = savedLamps();
    const save = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Quota'); });
    lamp.click();
    expect(savedLamps()).toEqual(before);
    expect(lamp.dataset.lampOn).toBe('true');
    expect(lamp.getAttribute('aria-pressed')).toBe('true');
    expect(lamp.getAttribute('aria-label')).toBe('Apagar lámpara TÄRNABY');
    save.mockRestore(); lamp.click();
    expect(savedLamps()[0].isOn).toBe(false);
    expect(lamp.getAttribute('aria-pressed')).toBe('false');
  });

  it('keyboard placement preserves an off lamp and its accessible power state', async () => {
    shelf = renderBookshelf(container, books, { shelfWidth:390 });
    await catalog.options.onAddLamp({ lampId:'mittled' });
    container.querySelector('.ihr-lamp').click();
    const node = container.querySelector('.ihr-lamp');
    node.dispatchEvent(new KeyboardEvent('keydown', { key:'ArrowDown', shiftKey:true, bubbles:true, cancelable:true }));
    expect(savedLamps()[0]).toMatchObject({ shelf:1, isOn:false });
    expect(container.querySelector('.ihr-lamp').getAttribute('aria-pressed')).toBe('false');
    expect(container.querySelector('.ihr-spine').dataset.shelfIndex).toBe('0');
  });

  it.each(['hold', 'move', 'cancel', 'drag-cancel'])('does not toggle after a %s gesture, and a subsequent tap works', async gesture => {
    vi.useFakeTimers();
    shelf = renderBookshelf(container, [], { shelfWidth:390 });
    await catalog.options.onAddLamp({ lampId:'tarnaby' });
    const lamp = container.querySelector('.ihr-lamp');
    pointer(lamp, 'pointerdown');
    if (gesture === 'hold' || gesture === 'drag-cancel') {
      await vi.advanceTimersByTimeAsync(450);
      expect(lamp.classList.contains('is-lifted')).toBe(true);
      if (gesture === 'drag-cancel') {
        pointer(lamp, 'pointermove', 180, 270);
        expect(lamp.classList.contains('is-dragging')).toBe(true);
      }
    } else if (gesture === 'move') pointer(lamp, 'pointermove', 160, 270);
    pointer(lamp, gesture.includes('cancel') ? 'pointercancel' : 'pointerup', 160, gesture === 'move' ? 270 : 240);
    // Browsers may still dispatch a compatibility click after pointerup.
    lamp.dispatchEvent(new MouseEvent('click', { detail:1, bubbles:true }));
    expect(savedLamps()[0].isOn).toBe(true);
    expect(lamp.getAttribute('aria-pressed')).toBe('true');
    pointer(lamp, 'pointerdown'); pointer(lamp, 'pointerup'); lamp.click();
    expect(savedLamps()[0].isOn).toBe(false);
  });

  it('allows an assistive detail-zero activation after a cancelled pointer gesture', async () => {
    shelf = renderBookshelf(container, [], { shelfWidth:390 });
    await catalog.options.onAddLamp({ lampId:'tarnaby' });
    const lamp = container.querySelector('.ihr-lamp');
    pointer(lamp, 'pointerdown'); pointer(lamp, 'pointercancel');
    lamp.dispatchEvent(new MouseEvent('click', { detail:1, bubbles:true }));
    expect(lamp.getAttribute('aria-pressed')).toBe('true');
    // Screen readers synthesize click without pointer events or keydown.
    pointer(lamp, 'pointerdown'); pointer(lamp, 'pointercancel');
    lamp.click();
    expect(savedLamps()[0].isOn).toBe(false);
    expect(lamp.getAttribute('aria-label')).toBe('Encender lámpara TÄRNABY');
    lamp.click();
    expect(savedLamps()[0].isOn).toBe(true);
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
