import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderBookshelf } from '../../src/js/bookshelf.js'

const catalog = vi.hoisted(() => ({ options:null, open:vi.fn(), destroy:vi.fn(), setShelfType:vi.fn() }))
vi.mock('../../src/js/plant-catalog.js', () => ({ createPlantCatalog(options) {
  catalog.options = options
  return { open:catalog.open, close:vi.fn(), destroy:catalog.destroy, setShelfType:catalog.setShelfType }
} }))

const KEY = 'inhouse-read-shelf-plants'
const plants = () => [{ key:'plant:one', seed:'one', variant:'monstera', catalogId:'monstera',
  potId:'gradvis', width:92, height:126, shelf:0, x:.7 }]
const books = () => [{ id:'keep', title:'Conservar libro', format:'PDF', shelfPosition:{ shelf:0, x:.15 } }]
let container, shelf
const originalAnimate = Object.getOwnPropertyDescriptor(Element.prototype, 'animate')
beforeEach(() => {
  vi.useFakeTimers(); localStorage.clear(); vi.clearAllMocks()
  Object.defineProperty(Element.prototype, 'animate', { configurable:true, value(_frames, timing) {
    let finish
    const finished = new Promise(resolve => { finish=resolve })
    const timer = setTimeout(() => finish(true), timing.duration)
    return { finished, cancel() { clearTimeout(timer); finish(false) } }
  } })
  container = document.createElement('div'); document.body.append(container)
})
afterEach(() => {
  shelf?.destroy(); shelf=null; container.remove(); localStorage.clear()
  vi.restoreAllMocks(); vi.useRealTimers()
  if (originalAnimate) Object.defineProperty(Element.prototype, 'animate', originalAnimate)
  else delete Element.prototype.animate
})
const remove = node => node.dispatchEvent(new KeyboardEvent('keydown', { key:'Delete', bubbles:true, cancelable:true }))

describe('persistent catalog plants', () => {
  it('migrates old plants before rendering and never constructs photo decorations', () => {
    const legacy = [{ key:'plant:old', seed:'old-seed', variant:'pothos', width:44, shelf:1, x:.4 }];
    localStorage.setItem(KEY, JSON.stringify(legacy));
    shelf=renderBookshelf(container, books(), { shelfWidth:390 });
    const node = container.querySelector('.ihr-plant');
    expect(node.dataset).toMatchObject({ objectId:'plant:old', catalogId:'hedera', potId:'muskotblomma',
      plantSeed:'old-seed', plantVariant:'hedera' });
    // HEDERA is 240 mm tall in IKEA's 9 cm class; a 600 mm shelf is 390 px wide.
    expect(Number.parseFloat(node.style.getPropertyValue('--ihr-plant-h'))).toBeCloseTo(240 * 390 / 600, 3);
    expect(container.querySelectorAll('.ihr-plant img, .ihr-plant--photo')).toHaveLength(0);
    expect(JSON.parse(localStorage.getItem(KEY))).toEqual([
      { ...legacy[0], catalogId:'hedera', variant:'hedera', potId:'muskotblomma', width:180, height:240 }
    ]);
  });
  it('restores catalog-only records before filtering missing legacy fields', () => {
    localStorage.setItem(KEY, JSON.stringify([{ key:'plant:saved', catalogId:'nephrolepis', shelf:0, x:.6 }]));
    shelf=renderBookshelf(container, books(), { shelfWidth:390 });
    expect(container.querySelector('.ihr-plant').dataset.catalogId).toBe('nephrolepis');
    expect(JSON.parse(localStorage.getItem(KEY))[0]).toMatchObject({ width:200, height:170, potId:'akerbar' });
  });
  it('persists complete current models for newly initialized decorations', () => {
    shelf=renderBookshelf(container, [], { shelfWidth:390 });
    const saved=JSON.parse(localStorage.getItem(KEY));
    expect(saved).toHaveLength(3);
    for (const record of saved) {
      expect(record.catalogId).toBeTruthy(); expect(record.potId).toBeTruthy();
      expect(record.height).toBeGreaterThan(0);
    }
    expect(container.querySelectorAll('.ihr-plant img, .ihr-plant--photo')).toHaveLength(0);
  });
  it('keeps a deliberately empty plant collection empty on reopen', () => {
    localStorage.setItem(KEY, '[]')
    shelf=renderBookshelf(container, [], { shelfWidth:390 })
    expect(container.querySelectorAll('.ihr-plant')).toHaveLength(0)
    expect(container.querySelectorAll('.ihr-shelf')).toHaveLength(3)
    expect(container.querySelector('.ihr-empty--library')).not.toBeNull()
    shelf.destroy(); shelf=renderBookshelf(container, books(), { shelfWidth:390 })
    expect(container.querySelectorAll('.ihr-plant')).toHaveLength(0)
    expect(JSON.parse(localStorage.getItem(KEY))).toEqual([])
  })
  it('removes every plant after its landing without deleting any books or recreating decorations', async () => {
    const onBookRemove=vi.fn()
    localStorage.setItem(KEY, JSON.stringify(plants()))
    shelf=renderBookshelf(container, books(), { shelfWidth:390, viewMode:'isometric', onBookRemove })
    remove(container.querySelector('.ihr-plant'))
    await vi.advanceTimersByTimeAsync(500)
    expect(JSON.parse(localStorage.getItem(KEY))).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(500)
    expect(container.querySelectorAll('.ihr-plant')).toHaveLength(0)
    expect(JSON.parse(localStorage.getItem(KEY))).toEqual([])
    expect(onBookRemove).not.toHaveBeenCalled()
    expect(container.querySelector('.ihr-spine[data-book-id="keep"]')).not.toBeNull()
    shelf.destroy(); shelf=renderBookshelf(container, books(), { shelfWidth:390 })
    expect(container.querySelectorAll('.ihr-plant')).toHaveLength(0)
  })
  it('restores a plant if saving its removal fails', async () => {
    localStorage.setItem(KEY, JSON.stringify(plants()))
    shelf=renderBookshelf(container, books(), { shelfWidth:390 })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Quota') })
    vi.spyOn(console,'warn').mockImplementation(() => {})
    remove(container.querySelector('.ihr-plant'))
    await vi.advanceTimersByTimeAsync(1000)
    expect(container.querySelector('.ihr-plant').classList.contains('is-away')).toBe(false)
    expect(container.querySelector('.ihr-trash-status').textContent).toContain('No se pudo retirar la planta')
    expect(JSON.parse(localStorage.getItem(KEY))).toHaveLength(1)
  })
  it('adds independently identified plants and saves the chosen pots and dimensions', async () => {
    localStorage.setItem(KEY, '[]')
    shelf=renderBookshelf(container, books(), { shelfWidth:390 })
    await catalog.options.onAdd({ catalogId:'chamaedorea', potId:'akerbar' })
    await catalog.options.onAdd({ catalogId:'chamaedorea', potId:'gradvis' })
    const saved=JSON.parse(localStorage.getItem(KEY))
    expect(saved).toHaveLength(2)
    expect(saved[0]).toMatchObject({ catalogId:'chamaedorea', potId:'akerbar', width:200, height:200 })
    expect(saved[1].potId).toBe('gradvis')
    expect(saved[0].key).not.toBe(saved[1].key)
    for (const node of container.querySelectorAll('.ihr-plant')) {
      expect(Number.parseFloat(node.style.getPropertyValue('--ihr-plant-h'))).toBeCloseTo(200 * 390 / 600, 3)
      expect(node.dataset.catalogId).toBe('chamaedorea')
    }
    const before=saved.map(item => [item.key,item.shelf,item.x,item.potId])
    shelf.destroy(); shelf=renderBookshelf(container, books(), { shelfWidth:390 })
    expect(JSON.parse(localStorage.getItem(KEY)).map(item => [item.key,item.shelf,item.x,item.potId])).toEqual(before)
    expect(container.querySelectorAll('.ihr-plant')).toHaveLength(2)
  })
  it('rejects unknown selections and rolls back failed additions', async () => {
    localStorage.setItem(KEY, '[]')
    shelf=renderBookshelf(container, [], { shelfWidth:390 })
    await expect(catalog.options.onAdd({ catalogId:'missing', potId:'muskot' })).rejects.toThrow('Elige')
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Quota') })
    await expect(catalog.options.onAdd({ catalogId:'monstera', potId:'muskot' })).rejects.toThrow('No se pudo guardar')
    expect(container.querySelectorAll('.ihr-plant')).toHaveLength(0)
    expect(JSON.parse(localStorage.getItem(KEY))).toEqual([])
  })
  it('opens the side booklet only in isometric view and destroys the popup with its shelf', () => {
    shelf=renderBookshelf(container, [], { shelfWidth:390 })
    const button=container.querySelector('.ihr-shelf-catalog')
    expect(button.hidden).toBe(true); button.click(); expect(catalog.open).not.toHaveBeenCalled()
    container.querySelector('[data-view-mode="isometric"]').click()
    expect(button.hidden).toBe(false); button.click(); expect(catalog.open).toHaveBeenCalledWith(button)
    shelf.destroy(); shelf=null
    expect(catalog.destroy).toHaveBeenCalledOnce()
  })
  it('persists the chosen shelf type across remounts without losing books or plant positions', () => {
    localStorage.setItem(KEY, JSON.stringify(plants()))
    shelf=renderBookshelf(container, books(), { shelfWidth:390, viewMode:'isometric' })
    const originalPlants = localStorage.getItem(KEY)
    catalog.options.onShelfChange({ shelfType:'baggebo' })
    expect(localStorage.getItem('inhouse-read-shelf-type')).toBe('baggebo')
    expect(container.querySelector('.ihr-bookshelf').dataset.shelfType).toBe('baggebo')
    expect(container.querySelector('.ihr-spine').dataset.bookId).toBe('keep')
    expect(localStorage.getItem(KEY)).toBe(originalPlants)
    shelf.destroy(); shelf=renderBookshelf(container, books(), { shelfWidth:390, viewMode:'isometric' })
    container.querySelector('.ihr-shelf-catalog').click()
    expect(catalog.setShelfType).toHaveBeenLastCalledWith('baggebo')
    catalog.options.onShelfChange({ shelfType:'walnut' })
    expect(localStorage.getItem('inhouse-read-shelf-type')).toBe('walnut')
    expect(container.querySelector('.ihr-spine').dataset.bookId).toBe('keep')
    expect(localStorage.getItem(KEY)).toBe(originalPlants)
  })
})
