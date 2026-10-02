import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPlantCatalog, plantCatalogIllustration } from '../../src/js/plant-catalog.js';
import { PLANT_CATALOG, POT_CATALOG } from '../../src/js/plant-catalog-data.js';
import { createShelfCatalogPreview } from '../../src/js/shelf-catalog-preview.js';
import { createLampCatalogPreview } from '../../src/js/lamp-catalog-preview.js';

vi.mock('../../src/js/shelf-catalog-preview.js',() => ({
  createShelfCatalogPreview:vi.fn(host => ({
    update:vi.fn(selection => { host.dataset.shelfType = selection.shelfType; }),
    dispose:vi.fn(() => host.replaceChildren())
  }))
}));

vi.mock('../../src/js/lamp-catalog-preview.js',() => ({
  createLampCatalogPreview:vi.fn(host => ({
    update:vi.fn(selection => { host.dataset.lampId = selection.lampId; }),
    dispose:vi.fn(() => host.replaceChildren())
  }))
}));

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
  vi.mocked(createShelfCatalogPreview).mockClear();
  vi.mocked(createLampCatalogPreview).mockClear();
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
    const first = dialog().querySelector('.ihr-plant-catalog__drawing').dataset.catalogId;
    pickPlant('nephrolepis'); pickPot('akerbar');
    expect(dialog().querySelector('.ihr-plant-catalog__caption h3').textContent).toBe('NEPHROLEPIS');
    expect(dialog().querySelector('.ihr-plant-catalog__pot-name').textContent).toBe('ÅKERBÄR');
    expect(dialog().querySelector('.ihr-plant-catalog__drawing').dataset.catalogId).not.toBe(first);
    expect(dialog().querySelector('.ihr-plant-catalog__drawing svg')).toBeNull();
    expect(dialog().querySelectorAll('[data-catalog-plant][aria-pressed="true"]')).toHaveLength(1);
    expect(dialog().querySelectorAll('[data-catalog-pot][aria-pressed="true"]')).toHaveLength(1);
  });
  it('shows the real IKEA size of the selected plant in its pot, 12 cm nursery class with distinct outer dimensions',() => {
    create({ onAdd:vi.fn() }).open();
    const size = () => dialog().querySelector('.ihr-plant-catalog__plant-size').textContent;
    expect(size()).toBe('Maceta Ø15 × 14 cm · planta 25 cm aprox. (sin verificar)');
    pickPlant('succulent'); expect(size()).toBe('Maceta Ø15 × 14 cm · planta 16 cm aprox.');
    pickPlant('nephrolepis'); pickPot('gradvis'); expect(size()).toBe('Maceta Ø13 × 12 cm · planta 17 cm aprox.');
    // The shelf page still owns its own published-measures line.
    expect(dialog().querySelector('.ihr-plant-catalog__shelf-dimensions').textContent).not.toContain('planta');
  });
  it('passes the selected IDs once, waits for storage, then closes and restores focus',async () => {
    let finish;
    const onAdd = vi.fn(() => new Promise(resolve => { finish = resolve; })), onClose = vi.fn();
    const trigger = document.createElement('button'); document.body.append(trigger); trigger.focus();
    const catalog = create({ onAdd,onClose }); catalog.open(trigger);
    pickPlant('monstera'); pickPot('gradvis'); add().click(); add().click();
    expect(onAdd).toHaveBeenCalledExactlyOnceWith({ catalogId:'monstera',potId:'gradvis',potColorId:'rose' });
    expect(dialog().getAttribute('aria-busy')).toBe('true');
    expect(add().disabled).toBe(true);
    expect(dialog().hasAttribute('open')).toBe(true);
    finish(); await settle();
    expect(dialog().hasAttribute('open')).toBe(false);
    expect(document.activeElement).toBe(trigger);
    expect(onClose).toHaveBeenCalledOnce();
  });
  it('offers material palettes, remembers colours per pot and passes the selected finish',async () => {
    const onAdd = vi.fn().mockResolvedValue();
    create({ onAdd }).open();
    pickPot('muskot'); dialog().querySelector('[data-catalog-color="sage"]').click();
    expect(dialog().querySelector('.ihr-plant-catalog__drawing').dataset.potColorId).toBe('sage');
    pickPot('akerbar');
    expect(dialog().querySelector('[data-catalog-color="sage"]')).toBeNull();
    expect(dialog().querySelector('[data-catalog-color="zinc"]').getAttribute('aria-pressed')).toBe('true');
    dialog().querySelector('[data-catalog-color="copper"]').click();
    pickPot('muskot');
    expect(dialog().querySelector('[data-catalog-color="sage"]').getAttribute('aria-pressed')).toBe('true');
    add().click(); await settle();
    expect(onAdd).toHaveBeenCalledExactlyOnceWith({catalogId:'sansevieria',potId:'muskot',potColorId:'sage'});
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
  it('opens the second furniture page and preserves plant and pot choices when returning',() => {
    create({ onAdd:vi.fn(),onShelfChange:vi.fn() }).open();
    pickPlant('monstera'); pickPot('gradvis');
    dialog().querySelector('[data-catalog-page="shelves"]').click();
    expect(dialog().dataset.catalogPage).toBe('shelves');
    expect(dialog().querySelector('h2').textContent).toBe('ESTANTERÍAS');
    expect(dialog().querySelector('.ihr-plant-catalog__page-number').textContent).toBe('02 / 03');
    expect(dialog().querySelectorAll('[data-catalog-shelf]')).toHaveLength(2);
    expect(dialog().querySelector('.ihr-plant-catalog__body').hidden).toBe(true);
    expect(add().textContent).toBe('Usar esta estantería');
    const preview = vi.mocked(createShelfCatalogPreview).mock.results[0].value;
    expect(preview.update).toHaveBeenLastCalledWith({ shelfType:'walnut' });
    dialog().querySelector('[data-catalog-page="plants"]').click();
    expect(preview.dispose).toHaveBeenCalledOnce();
    expect(dialog().querySelector('.ihr-plant-catalog__body').hidden).toBe(false);
    expect(dialog().querySelector('[data-catalog-plant="monstera"]').getAttribute('aria-pressed')).toBe('true');
    expect(dialog().querySelector('[data-catalog-pot="gradvis"]').getAttribute('aria-pressed')).toBe('true');
    expect(dialog().querySelector('.ihr-plant-catalog__page-number').textContent).toBe('01 / 03');
  });
  it('offers three warm lamp designs on a third page and keeps one active preview',() => {
    create({ onAdd:vi.fn(),onAddLamp:vi.fn(),onShelfChange:vi.fn() }).open();
    dialog().querySelector('[data-catalog-page="shelves"]').click();
    const shelfPreview = vi.mocked(createShelfCatalogPreview).mock.results[0].value;
    dialog().querySelector('[data-catalog-page="lights"]').click();
    expect(dialog().dataset.catalogPage).toBe('lights');
    expect(dialog().querySelector('h2').textContent).toBe('ILUMINACIÓN');
    expect(dialog().querySelector('.ihr-plant-catalog__page-number').textContent).toBe('03 / 03');
    expect(dialog().querySelectorAll('[data-catalog-lamp]')).toHaveLength(3);
    expect(dialog().querySelector('.ihr-plant-catalog__body--shelves').hidden).toBe(true);
    expect(dialog().querySelector('.ihr-plant-catalog__body--lights').hidden).toBe(false);
    expect(dialog().querySelector('.ihr-plant-catalog__lamp-warmth').textContent).toContain('2700 K');
    expect(dialog().querySelector('.ihr-plant-catalog__lamp-mount').textContent).toContain('bajo la balda');
    expect(shelfPreview.dispose).toHaveBeenCalledOnce();
    const preview = vi.mocked(createLampCatalogPreview).mock.results[0].value;
    expect(preview.update).toHaveBeenLastCalledWith({ lampId:'mittled' });
    dialog().querySelector('[data-catalog-lamp="tarnaby"]').click();
    expect(preview.update).toHaveBeenLastCalledWith({ lampId:'tarnaby' });
    expect(dialog().querySelector('.ihr-plant-catalog__lamp-mount').textContent).toContain('sobre la balda');
    expect(dialog().querySelectorAll('[data-catalog-lamp][aria-pressed="true"]')).toHaveLength(1);
    dialog().querySelector('[data-catalog-page="plants"]').click();
    expect(preview.dispose).toHaveBeenCalledOnce();
    dialog().querySelector('[data-catalog-page="lights"]').click();
    expect(dialog().querySelector('[data-catalog-lamp="tarnaby"]').getAttribute('aria-pressed')).toBe('true');
  });
  it('waits for one lamp save, disables page switches and disposes the light preview on close',async () => {
    let finish;
    const onAddLamp = vi.fn(() => new Promise(resolve => { finish = resolve; })), onAdd = vi.fn();
    create({ onAdd,onAddLamp }).open();
    dialog().querySelector('[data-catalog-page="lights"]').click();
    dialog().querySelector('[data-catalog-lamp="tripod"]').click(); add().click(); add().click();
    expect(onAddLamp).toHaveBeenCalledExactlyOnceWith({ lampId:'tripod' });
    expect(onAdd).not.toHaveBeenCalled();
    expect(dialog().querySelector('[data-catalog-page="shelves"]').disabled).toBe(true);
    expect(dialog().querySelector('[data-catalog-lamp="mittled"]').disabled).toBe(true);
    expect(dialog().hasAttribute('open')).toBe(true);
    finish(); await settle();
    expect(dialog().hasAttribute('open')).toBe(false);
    expect(vi.mocked(createLampCatalogPreview).mock.results[0].value.dispose).toHaveBeenCalledOnce();
  });
  it('keeps a failed lamp selected for retry without changing plant storage',async () => {
    const onAddLamp = vi.fn().mockRejectedValueOnce(new Error('storage details')).mockResolvedValue();
    const onAdd = vi.fn();
    create({ onAdd,onAddLamp }).open();
    dialog().querySelector('[data-catalog-page="lights"]').click();
    dialog().querySelector('[data-catalog-lamp="tarnaby"]').click(); add().click(); await settle();
    expect(dialog().hasAttribute('open')).toBe(true);
    expect(dialog().querySelector('[role="status"]').textContent).toContain('No se pudo añadir la lámpara');
    expect(dialog().textContent).not.toContain('storage details');
    expect(add().disabled).toBe(false);
    expect(dialog().querySelector('[data-catalog-lamp="tarnaby"]').getAttribute('aria-pressed')).toBe('true');
    add().click(); await settle();
    expect(onAddLamp).toHaveBeenCalledTimes(2);
    expect(onAdd).not.toHaveBeenCalled();
    expect(dialog().hasAttribute('open')).toBe(false);
  });
  it('disables adding lights without a lamp callback even when plant adding is available',() => {
    create({ onAdd:vi.fn() }).open();
    dialog().querySelector('[data-catalog-page="lights"]').click();
    expect(add().disabled).toBe(true);
  });
  it('uses the exact BAGGEBO size, awaits one shelf change and restores the opener',async () => {
    let finish;
    const onShelfChange = vi.fn(() => new Promise(resolve => { finish = resolve; })), onAdd = vi.fn();
    const trigger = document.createElement('button'); document.body.append(trigger); trigger.focus();
    create({ onShelfChange,onAdd }).open(trigger);
    dialog().querySelector('[data-catalog-page="shelves"]').click();
    dialog().querySelector('[data-catalog-shelf="baggebo"]').click();
    expect(dialog().querySelector('.ihr-plant-catalog__shelf-dimensions').textContent).toBe('60 × 25 × 116 cm');
    expect(dialog().querySelector('[data-catalog-shelf="baggebo"]').getAttribute('aria-pressed')).toBe('true');
    add().click(); add().click();
    expect(onShelfChange).toHaveBeenCalledExactlyOnceWith({ shelfType:'baggebo' });
    expect(onAdd).not.toHaveBeenCalled();
    expect(dialog().querySelector('[data-catalog-page="plants"]').disabled).toBe(true);
    expect(dialog().hasAttribute('open')).toBe(true);
    finish(); await settle();
    expect(dialog().hasAttribute('open')).toBe(false);
    expect(document.activeElement).toBe(trigger);
    expect(vi.mocked(createShelfCatalogPreview).mock.results[0].value.dispose).toHaveBeenCalledOnce();
  });
  it('syncs a persisted shelf selection and resets to the plant page on reopening',() => {
    const catalog = create({ shelfType:'baggebo',onAdd:vi.fn(),onShelfChange:vi.fn() });
    catalog.open(); dialog().querySelector('[data-catalog-page="shelves"]').click();
    expect(dialog().querySelector('[data-catalog-shelf="baggebo"]').getAttribute('aria-pressed')).toBe('true');
    expect(dialog().querySelector('[data-catalog-shelf="baggebo"] .ihr-plant-catalog__shelf-current').textContent).toBe('Estantería actual');
    catalog.setShelfType('walnut');
    expect(dialog().querySelector('[data-catalog-shelf="walnut"]').getAttribute('aria-pressed')).toBe('true');
    catalog.close(); catalog.open();
    expect(dialog().dataset.catalogPage).toBe('plants');
    dialog().querySelector('[data-catalog-page="shelves"]').click();
    expect(dialog().querySelector('[data-catalog-shelf="walnut"]').getAttribute('aria-pressed')).toBe('true');
  });
  it('keeps a rejected shelf change selected for retry and disposes its preview after saving',async () => {
    const onShelfChange = vi.fn().mockRejectedValueOnce(new Error('storage details')).mockResolvedValue();
    create({ onShelfChange }).open();
    dialog().querySelector('[data-catalog-page="shelves"]').click();
    dialog().querySelector('[data-catalog-shelf="baggebo"]').click(); add().click(); await settle();
    expect(dialog().hasAttribute('open')).toBe(true);
    expect(dialog().querySelector('[role="status"]').textContent).toContain('No se pudo cambiar la estantería');
    expect(dialog().textContent).not.toContain('storage details');
    expect(add().disabled).toBe(false);
    expect(dialog().querySelector('[data-catalog-shelf="baggebo"]').getAttribute('aria-pressed')).toBe('true');
    add().click(); await settle();
    expect(onShelfChange).toHaveBeenCalledTimes(2);
    expect(dialog().hasAttribute('open')).toBe(false);
    expect(vi.mocked(createShelfCatalogPreview).mock.results[0].value.dispose).toHaveBeenCalledOnce();
  });
});
