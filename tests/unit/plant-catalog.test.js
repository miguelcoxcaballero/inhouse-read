import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPlantCatalog, plantCatalogIllustration } from '../../src/js/plant-catalog.js';
import { PLANT_CATALOG, POT_CATALOG } from '../../src/js/plant-catalog-data.js';

const instances = [];
function create(options) {
  const catalog = createPlantCatalog(options);
  instances.push(catalog);
  return catalog;
}
const dialog = () => document.querySelector('.ihr-plant-catalog');
const pickPlant = id => dialog().querySelector(`[data-catalog-plant="${id}"]`).click();
const pickPot = id => dialog().querySelector(`[data-catalog-pot="${id}"]`).click();
const add = () => dialog().querySelector('[data-catalog-add]');
const settle = async () => { await Promise.resolve(); await Promise.resolve(); };
afterEach(() => {
  for (const instance of instances.splice(0)) instance.destroy();
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('IKEA plant instruction booklet',() => {
  it('provides the eight botanical references and four pot choices without external image assets',() => {
    create({ onAdd:vi.fn() }).open();
    expect(dialog().querySelectorAll('[data-catalog-plant]')).toHaveLength(8);
    expect(dialog().querySelectorAll('[data-catalog-pot]')).toHaveLength(4);
    expect(dialog().querySelector('img')).toBeNull();
    expect(dialog().querySelector('h2').textContent).toBe('PLANTAS');
    expect(dialog().getAttribute('aria-labelledby')).toBe(dialog().querySelector('h2').id);
    expect(dialog().getAttribute('aria-describedby')).toBe(dialog().querySelector('.ihr-plant-catalog__description').id);
  });
  it('draws distinct detailed species and identifiable pot structures as original vectors',() => {
    const drawings = PLANT_CATALOG.map(plant => plantCatalogIllustration(plant.id));
    expect(new Set(drawings).size).toBe(8);
    for (const drawing of drawings) {
      expect(drawing).toContain('viewBox="0 0 160 200"');
      expect(drawing).toContain('<path');
      expect(drawing).not.toContain('<image');
    }
    const pots = POT_CATALOG.map(pot => plantCatalogIllustration('monstera',pot.id,{ potOnly:true }));
    expect(new Set(pots).size).toBe(4);
    expect(pots.every(drawing => drawing.includes('viewBox="42 136 76 62"'))).toBe(true);
  });
  it('updates the preview and selected controls when changing plant and pot',() => {
    create({ onAdd:vi.fn() }).open();
    const first = dialog().querySelector('.ihr-plant-catalog__drawing').innerHTML;
    pickPlant('nephrolepis'); pickPot('akerbar');
    expect(dialog().querySelector('.ihr-plant-catalog__caption h3').textContent).toBe('NEPHROLEPIS');
    expect(dialog().querySelector('.ihr-plant-catalog__pot-name').textContent).toBe('ÅKERBÄR');
    expect(dialog().querySelector('.ihr-plant-catalog__drawing').innerHTML).not.toBe(first);
    expect(dialog().querySelectorAll('[data-catalog-plant][aria-pressed="true"]')).toHaveLength(1);
    expect(dialog().querySelectorAll('[data-catalog-pot][aria-pressed="true"]')).toHaveLength(1);
  });
  it('passes the selected IDs once, waits for storage, then closes and restores focus',async () => {
    let finish;
    const onAdd = vi.fn(() => new Promise(resolve => { finish = resolve; })), onClose = vi.fn();
    const trigger = document.createElement('button'); document.body.append(trigger); trigger.focus();
    const catalog = create({ onAdd,onClose }); catalog.open(trigger);
    pickPlant('monstera'); pickPot('gradvis'); add().click(); add().click();
    expect(onAdd).toHaveBeenCalledExactlyOnceWith({ catalogId:'monstera',potId:'gradvis' });
    expect(dialog().getAttribute('aria-busy')).toBe('true');
    expect(add().disabled).toBe(true);
    expect(dialog().hasAttribute('open')).toBe(true);
    finish(); await settle();
    expect(dialog().hasAttribute('open')).toBe(false);
    expect(document.activeElement).toBe(trigger);
    expect(onClose).toHaveBeenCalledOnce();
  });
  it('keeps a failed addition open with a retry and does not show implementation details',async () => {
    const onAdd = vi.fn().mockRejectedValueOnce(new Error('IndexedDB private stack')).mockResolvedValueOnce();
    create({ onAdd }).open(); add().click(); await settle();
    expect(dialog().hasAttribute('open')).toBe(true);
    expect(dialog().querySelector('[role="status"]').textContent).toContain('Vuelve a intentarlo');
    expect(dialog().textContent).not.toContain('IndexedDB');
    expect(add().disabled).toBe(false);
    add().click(); await settle();
    expect(onAdd).toHaveBeenCalledTimes(2);
    expect(dialog().hasAttribute('open')).toBe(false);
  });
  it('handles Escape and cancellation with one close callback',() => {
    const onClose = vi.fn(); const catalog = create({ onAdd:vi.fn(),onClose });
    catalog.open();
    dialog().dispatchEvent(new KeyboardEvent('keydown',{ key:'Escape',cancelable:true,bubbles:true }));
    expect(dialog().hasAttribute('open')).toBe(false);
    catalog.open(); dialog().dispatchEvent(new Event('cancel',{ cancelable:true }));
    expect(dialog().hasAttribute('open')).toBe(false);
    expect(onClose).toHaveBeenCalledTimes(2);
  });
  it('traps keyboard focus in the fallback and restores the opener on close',() => {
    create({ onAdd:vi.fn() }).open();
    const first = dialog().querySelector('button'), last = add();
    first.focus(); first.dispatchEvent(new KeyboardEvent('keydown',{ key:'Tab',shiftKey:true,bubbles:true,cancelable:true }));
    expect(document.activeElement).toBe(last);
    last.dispatchEvent(new KeyboardEvent('keydown',{ key:'Tab',bubbles:true,cancelable:true }));
    expect(document.activeElement).toBe(first);
  });
  it('does not submit without an application callback',() => {
    create().open();
    expect(add().disabled).toBe(true);
  });
  it('is reusable and removes the complete dialog safely during a pending addition',async () => {
    let finish; const onClose = vi.fn();
    const catalog = create({ onAdd:() => new Promise(resolve => { finish = resolve; }),onClose });
    catalog.open(); catalog.open(); pickPlant('hedera'); add().click(); catalog.destroy(); catalog.destroy();
    expect(dialog()).toBeNull(); finish(); await settle();
    expect(dialog()).toBeNull(); expect(onClose).toHaveBeenCalledOnce();
    catalog.open(); expect(dialog()).toBeNull();
  });
});
