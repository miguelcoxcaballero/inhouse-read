import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderBookshelf } from '../../src/js/bookshelf.js';

const catalog = vi.hoisted(() => ({ options:null }));
const scene = vi.hoisted(() => ({ getObjectAtPoint:vi.fn(), setLampPower:vi.fn() }));
vi.mock('../../src/js/book-model.js', () => ({ getBookRenderer:() => ({}), bookView:() => null, fitCoverImage:vi.fn(), planReadingBookPose:vi.fn() }));
vi.mock('../../src/js/bookshelf-scene.js', () => ({ createBookshelfScene:() => ({
  ...scene, dispose:vi.fn(), updateLayout:vi.fn(), flush:vi.fn(), animateFromRects:vi.fn(),
  getInspectionZoom:() => 1, getInspectionView:() => ({ zoom:1, panX:0, panY:0, width:390, height:844 }),
  setInspectionView:view => view, setDropPosition:vi.fn(), previewPlacements:vi.fn(), setTrashHover:vi.fn()
}) }));
vi.mock('../../src/js/plant-catalog.js', () => ({ createPlantCatalog(options) {
  catalog.options = options;
  return { open:vi.fn(), close:vi.fn(), destroy:vi.fn(), setShelfType:vi.fn() };
} }));
const KEY = 'inhouse-read-shelf-lamps';
const PLANTS = 'inhouse-read-shelf-plants';
let container, shelf;
beforeEach(() => {
  scene.getObjectAtPoint.mockReset(); scene.setLampPower.mockClear();
  localStorage.clear(); localStorage.setItem(PLANTS, '[]');
  container = document.createElement('div'); document.body.append(container);
});
afterEach(() => { shelf?.destroy(); shelf=null; container.remove(); localStorage.clear(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const books = [{ id:'keep', title:'Conservar', format:'PDF', shelfPosition:{ shelf:0, x:.5 } }];
const savedLamps = () => JSON.parse(localStorage.getItem(KEY));
function pointer(node, type, x=160, y=240, { id=1, primary=true, pointerType='touch' } = {}) {
  const event = new MouseEvent(type, { clientX:x, clientY:y, button:0, bubbles:true, cancelable:true });
  Object.defineProperties(event, { pointerId:{ value:id }, pointerType:{ value:pointerType }, isPrimary:{ value:primary } });
  node.dispatchEvent(event);
}
function compatibilityClick(node, id=1) {
  const event = new MouseEvent('click', { detail:1, clientX:160, clientY:240, bubbles:true, cancelable:true });
  Object.defineProperties(event, { pointerId:{ value:id }, pointerType:{ value:'touch' } });
  node.dispatchEvent(event);
}

describe('persistent shelf illumination', () => {
  it.each(['walnut','baggebo'])('keeps lamps at the same physical scale as books and pots on %s', async shelfType => {
    shelf = renderBookshelf(container, [], { shelfWidth:390, shelfType });
    await catalog.options.onAddLamp({lampId:'tarnaby'});
    const scale = 390 / 600; // both shelves are 600 mm units filling the shelf width
    const node=container.querySelector('.ihr-lamp');
    expect(parseFloat(node.style.getPropertyValue('--ihr-lamp-h'))).toBeCloseTo(250*scale);
    expect(parseFloat(node.style.getPropertyValue('--ihr-lamp-w'))).toBeCloseTo(150*scale);
  });
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
    pointer(lamp, 'pointerdown'); pointer(lamp, 'pointerup'); compatibilityClick(lamp);
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

  it('toggles on a validated touch release even when the browser emits no compatibility click', async () => {
    shelf = renderBookshelf(container, [], { shelfWidth:390 });
    await catalog.options.onAddLamp({ lampId:'tarnaby' });
    const lamp = container.querySelector('.ihr-lamp');
    const save = vi.spyOn(Storage.prototype, 'setItem');
    pointer(lamp, 'pointerdown'); pointer(lamp, 'pointerup');
    expect(lamp.getAttribute('aria-pressed')).toBe('false');
    expect(save.mock.calls.filter(([key]) => key === KEY)).toHaveLength(1);
    compatibilityClick(lamp);
    expect(lamp.getAttribute('aria-pressed')).toBe('false');
    expect(save.mock.calls.filter(([key]) => key === KEY)).toHaveLength(1);
  });

  it('keeps mouse release separate from mouse and assistive click activation', async () => {
    shelf = renderBookshelf(container, [], { shelfWidth:390 });
    await catalog.options.onAddLamp({ lampId:'tarnaby' });
    const lamp = container.querySelector('.ihr-lamp');
    pointer(lamp, 'pointerdown', 160, 240, { pointerType:'mouse' });
    pointer(lamp, 'pointerup', 160, 240, { pointerType:'mouse' });
    expect(lamp.getAttribute('aria-pressed')).toBe('true');
    lamp.dispatchEvent(new MouseEvent('click', { detail:1, clientX:160, clientY:240, bubbles:true }));
    expect(lamp.getAttribute('aria-pressed')).toBe('false');
    lamp.click();
    expect(lamp.getAttribute('aria-pressed')).toBe('true');
  });

  it.each(['hold', 'cancel', 'move', 'pinch'])('a fresh touch works immediately after %s without any compatibility clicks', async gesture => {
    vi.useFakeTimers();
    shelf = renderBookshelf(container, [], { shelfWidth:390 });
    await catalog.options.onAddLamp({ lampId:'tarnaby' });
    const lamp = container.querySelector('.ihr-lamp');
    pointer(lamp, 'pointerdown');
    if (gesture === 'hold') await vi.advanceTimersByTimeAsync(450);
    if (gesture === 'move') pointer(lamp, 'pointermove', 160, 275);
    if (gesture === 'pinch') {
      pointer(lamp, 'pointerdown', 100, 240, { id:2, primary:false });
      pointer(lamp, 'pointerup', 100, 240, { id:2, primary:false });
    }
    pointer(lamp, gesture === 'cancel' ? 'pointercancel' : 'pointerup');
    expect(lamp.getAttribute('aria-pressed')).toBe('true');
    pointer(lamp, 'pointerdown', 160, 240, { id:3 });
    pointer(lamp, 'pointerup', 160, 240, { id:3 });
    expect(lamp.getAttribute('aria-pressed')).toBe('false');
    compatibilityClick(lamp, 3);
    expect(lamp.getAttribute('aria-pressed')).toBe('false');
  });

  it('does not consume another pointer release as a lamp tap', async () => {
    shelf = renderBookshelf(container, [], { shelfWidth:390 });
    await catalog.options.onAddLamp({ lampId:'tarnaby' });
    const lamp = container.querySelector('.ihr-lamp');
    pointer(lamp, 'pointerdown');
    pointer(lamp, 'pointerup', 160, 240, { id:7, primary:false });
    expect(lamp.getAttribute('aria-pressed')).toBe('true');
    pointer(lamp, 'pointerup');
    expect(lamp.getAttribute('aria-pressed')).toBe('false');
  });

  it.each(['background', 'other lamp'])('does not toggle through a down-ray hit on %s', async target => {
    vi.stubGlobal('WebGLRenderingContext', function () {});
    shelf = renderBookshelf(container, [], { shelfWidth:390 });
    await catalog.options.onAddLamp({ lampId:'tarnaby' });
    await catalog.options.onAddLamp({ lampId:'tripod' });
    const lamp = container.querySelector('[data-lamp-id="tarnaby"]');
    scene.getObjectAtPoint.mockReturnValue(target === 'background' ? null : container.querySelector('[data-lamp-id="tripod"]'));
    pointer(lamp, 'pointerdown');
    scene.getObjectAtPoint.mockReturnValue(lamp);
    pointer(lamp, 'pointerup'); compatibilityClick(lamp);
    expect(savedLamps().map(record => record.isOn)).toEqual([true, true]);
    expect(scene.setLampPower).not.toHaveBeenCalled();
  });

  it('uses the validated down target if the 3D projection changes before touch release', async () => {
    vi.stubGlobal('WebGLRenderingContext', function () {});
    shelf = renderBookshelf(container, [], { shelfWidth:390 });
    await catalog.options.onAddLamp({ lampId:'tarnaby' });
    const lamp = container.querySelector('.ihr-lamp');
    scene.getObjectAtPoint.mockReturnValue(lamp);
    pointer(lamp, 'pointerdown');
    const checks = scene.getObjectAtPoint.mock.calls.length;
    scene.getObjectAtPoint.mockReturnValue(null);
    pointer(lamp, 'pointerup'); compatibilityClick(lamp);
    expect(lamp.getAttribute('aria-pressed')).toBe('false');
    expect(scene.getObjectAtPoint).toHaveBeenCalledTimes(checks);
    expect(scene.setLampPower).toHaveBeenCalledOnce();
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
    pointer(lamp, 'pointerdown'); pointer(lamp, 'pointerup'); compatibilityClick(lamp);
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
