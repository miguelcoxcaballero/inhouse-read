import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderBookshelf } from '../../src/js/bookshelf.js'

const WIDTH = 390, PADDING = 16
const PLANTS_KEY = 'inhouse-read-shelf-plants'
const plants = () => [
  { key:'plant:placement-a', seed:'placement-a', variant:'cactus', width:42, shelf:0, x:.85 },
  { key:'plant:placement-b', seed:'placement-b', variant:'suculenta', width:48, shelf:1, x:.18 },
  { key:'plant:placement-c', seed:'placement-c', variant:'pothos', width:48, shelf:2, x:.2 }
]
const books = () => Array.from({ length:4 }, (_, index) => ({
  id:`placement:${index}`, title:`Libro ${index + 1}`, sourceType:'local', format:'PDF',
  pageCount:100, shelfPosition:{ shelf:0, x:[.18,.34,.5,.66][index] }
}))
let container, shelf

beforeEach(() => {
  localStorage.removeItem('inhouse-read-shelf-view')
  localStorage.setItem(PLANTS_KEY, JSON.stringify(plants()))
  container = document.createElement('div'); document.body.append(container)
})
afterEach(() => {
  shelf?.destroy(); shelf = null; container.remove()
  vi.useRealTimers()
  localStorage.removeItem(PLANTS_KEY)
})
const find = key => container.querySelector(`[data-object-id="${key}"]`)
const keyMove = (key, direction) => find(key).dispatchEvent(new KeyboardEvent('keydown', {
  key:direction, shiftKey:true, bubbles:true, cancelable:true
}))
function assertNoOverlap() {
  const objects = [...container.querySelectorAll('[data-object-id]')].map(node => {
    const width = parseFloat(node.style.getPropertyValue(node.classList.contains('ihr-plant') ? '--ihr-plant-w' : '--ihr-spine-w'))
    const centre = PADDING + Number(node.dataset.shelfX) * (WIDTH - PADDING * 2)
    return { key:node.dataset.objectId, shelf:Number(node.dataset.shelfIndex), left:centre - width / 2, right:centre + width / 2 }
  })
  for (const row of new Set(objects.map(object => object.shelf))) {
    const rowObjects = objects.filter(object => object.shelf === row).sort((a,b) => a.left - b.left)
    for (let index = 1; index < rowObjects.length; index++) expect(rowObjects[index].left).toBeGreaterThanOrEqual(rowObjects[index - 1].right + 2.99)
  }
}

describe('free shelf placement controls', () => {
  it.each(['pointerup', 'pointercancel'])('defers refresh during a long press until %s releases the original node', async release => {
    vi.useFakeTimers()
    const records = books(), changed = vi.fn()
    shelf = renderBookshelf(container, records, { shelfWidth:WIDTH, sections:false, onShelfPlacementChange:changed })
    const original = find('book:placement:0')
    const pointer = type => {
      const event = new MouseEvent(type, { clientX:90, clientY:400, button:0, bubbles:true, cancelable:true })
      Object.defineProperties(event, { pointerId:{ value:1 }, pointerType:{ value:'touch' } })
      original.dispatchEvent(event)
    }
    pointer('pointerdown')
    shelf.update(records.map((record, index) => index ? record : { ...record, title:'Actualización durante pulsación' }))
    await vi.advanceTimersByTimeAsync(450)
    expect(find('book:placement:0')).toBe(original)
    expect(original.classList.contains('is-lifted')).toBe(true)
    expect(container.querySelector('.ihr-bookshelf').classList.contains('is-arranging')).toBe(true)
    shelf.update(records.map((record, index) => index ? record : { ...record, title:'Actualización final' }))
    await vi.advanceTimersByTimeAsync(30)
    expect(find('book:placement:0')).toBe(original)
    expect(original.getAttribute('aria-label')).toBe('Abrir Libro 1')
    pointer(release)
    await vi.advanceTimersByTimeAsync(60)
    expect(container.querySelector('.ihr-bookshelf').classList.contains('is-arranging')).toBe(false)
    expect(find('book:placement:0').getAttribute('aria-label')).toBe('Abrir Actualización final')
    expect(find('book:placement:0').classList.contains('is-lifted')).toBe(false)
    expect(changed).not.toHaveBeenCalled()
    expect(document.querySelector('.ihr-flyout')).toBeNull()
  })

  it('moves a book between shelves and shifts a colliding plant without opening the cover', () => {
    const changed = vi.fn(), opened = vi.fn()
    shelf = renderBookshelf(container, books(), { shelfWidth:WIDTH, sections:false, onShelfPlacementChange:changed, onBookOpen:opened })
    keyMove('book:placement:0', 'ArrowDown')
    expect(find('book:placement:0').dataset.shelfIndex).toBe('1')
    expect(Number(find('book:placement:0').dataset.shelfX)).toBeCloseTo(.18)
    expect(changed).toHaveBeenCalledTimes(1)
    expect(changed.mock.calls[0][0].books).toContainEqual({ id:'placement:0', shelfPosition:{ shelf:1, x:.18 } })
    expect(changed.mock.calls[0][0].plants['plant:placement-b'].x).not.toBeCloseTo(.18)
    expect(opened).not.toHaveBeenCalled()
    expect(document.querySelector('.ihr-flyout')).toBeNull()
    assertNoOverlap()
    keyMove('book:placement:0', 'ArrowRight')
    expect(Number(find('book:placement:0').dataset.shelfX)).toBeCloseTo(.26)
    assertNoOverlap()
  })

  it('moves plants, persists them and recreates the same empty gaps', () => {
    let records = books()
    const changed = vi.fn(({ books:updates }) => {
      records = records.map(record => ({ ...record, ...updates.find(update => update.id === record.id) }))
    })
    const options = { shelfWidth:WIDTH, sections:false, onShelfPlacementChange:changed }
    shelf = renderBookshelf(container, records, options)
    keyMove('plant:placement-a', 'ArrowLeft')
    keyMove('plant:placement-a', 'ArrowLeft')
    expect(Number(find('plant:placement-a').dataset.shelfX)).toBeCloseTo(.69)
    expect(changed.mock.calls.flatMap(([change]) => change.books).some(book => book.id === 'placement:3')).toBe(true)
    keyMove('plant:placement-a', 'ArrowDown')
    expect(find('plant:placement-a').dataset.shelfIndex).toBe('1')
    const saved = JSON.parse(localStorage.getItem(PLANTS_KEY)).find(plant => plant.key === 'plant:placement-a')
    expect(saved).toMatchObject({ shelf:1, x:.69 })
    assertNoOverlap()
    const before = [...container.querySelectorAll('[data-object-id]')].map(node => [node.dataset.objectId, node.dataset.shelfIndex, node.dataset.shelfX])
    shelf.destroy(); shelf = renderBookshelf(container, records, options)
    const after = [...container.querySelectorAll('[data-object-id]')].map(node => [node.dataset.objectId, node.dataset.shelfIndex, node.dataset.shelfX])
    expect(after).toEqual(before)
    expect(Number(find('plant:placement-a').dataset.shelfX) - Number(find('plant:placement-b').dataset.shelfX)).toBeGreaterThan(.3)
    assertNoOverlap()
  })

  it('keeps a vertical touch gesture as scrolling before the long press activates', () => {
    const changed = vi.fn()
    shelf = renderBookshelf(container, books(), { shelfWidth:WIDTH, sections:false, onShelfPlacementChange:changed })
    const scroller = container.querySelector('.ihr-bookshelf__scroll'), book = find('book:placement:0')
    scroller.scrollTop = 50
    const pointer = (type, y) => {
      const event = new MouseEvent(type, { clientX:90, clientY:y, button:0, bubbles:true, cancelable:true })
      Object.defineProperties(event, { pointerId:{ value:1 }, pointerType:{ value:'touch' } })
      book.dispatchEvent(event)
    }
    pointer('pointerdown', 400); pointer('pointermove', 320); pointer('pointerup', 320)
    expect(scroller.scrollTop).toBe(130)
    expect(changed).not.toHaveBeenCalled()
    expect(container.querySelector('.ihr-bookshelf').classList.contains('is-arranging')).toBe(false)
    expect(document.querySelector('.ihr-flyout')).toBeNull()
  })
})
