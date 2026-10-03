import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('foliate-js/view.js', () => ({}))
vi.mock('foliate-js/overlayer.js', () => ({ Overlayer:{} }))
vi.mock('../../src/js/gestures.js', () => ({ attachSwipeNavigation:() => () => {} }))
import { FoliateReader } from '../../src/js/readers/foliate-reader.js'

let container, view, reader
beforeEach(async () => {
  vi.useFakeTimers()
  document.body.innerHTML = '<main></main>'
  container = document.querySelector('main')
  view = document.createElement('div')
  Object.assign(view, {
    open:vi.fn(async () => {}), init:vi.fn(async () => {}), close:vi.fn(),
    renderer:{ setStyles:vi.fn(), setAttribute:vi.fn(), removeAttribute:vi.fn() }
  })
  const create = document.createElement.bind(document)
  vi.spyOn(document, 'createElement').mockImplementation(name => name === 'foliate-view' ? view : create(name))
  reader = new FoliateReader()
  await reader.open(container, new File(['epub'], 'book.epub'))
})
afterEach(() => {
  reader.close()
  vi.restoreAllMocks()
  vi.useRealTimers()
  document.body.innerHTML = ''
})

describe('EPUB page turn ordering', () => {
  it('caches the complete book length without turning pages or reloading sections', async () => {
    const createDocument = vi.fn(async () => new DOMParser().parseFromString('<p>One two three.</p>', 'text/html'))
    view.book = { sections:[{createDocument}] }
    const first = reader.getLengthMetadata(), second = reader.getLengthMetadata()
    expect(first).toBe(second)
    await vi.runAllTimersAsync()
    expect(await first).toEqual({wordCount:3,estimatedPageCount:1,lengthSource:'text'})
    expect(createDocument).toHaveBeenCalledOnce()
    expect(reader.getLengthMetadata()).toBe(first)
  })

  it('cancels a length scan on close without measuring the next chapter', async () => {
    let finish
    const next = vi.fn(async () => new DOMParser().parseFromString('<p>Late</p>', 'text/html'))
    view.book = { sections:[{createDocument:() => new Promise(resolve => {finish=resolve})},{createDocument:next}] }
    const pending=reader.getLengthMetadata()
    reader.close()
    finish(new DOMParser().parseFromString('<p>Old book</p>', 'text/html'))
    expect(await pending).toBeNull()
    expect(next).not.toHaveBeenCalled()
  })

  it.each([100, 300])('preserves two advances and a return while the paginator holds its %i ms lock', async delay => {
    // Foliate updates its offset before releasing #locked. Further next/prev
    // calls return without moving, including a reduced-motion page already drawn.
    let locked = false, position = 0
    const accepted = []
    const turn = direction => async () => {
      if (locked) return
      locked = true
      position += direction * 390
      accepted.push(direction)
      await new Promise(resolve => setTimeout(resolve, delay))
      locked = false
    }
    view.next = vi.fn(turn(1)); view.prev = vi.fn(turn(-1))
    const first = reader.next()
    await vi.advanceTimersByTimeAsync(0)
    expect(position).toBe(390)
    const second = reader.next(), back = reader.prev()
    await vi.runAllTimersAsync()
    await Promise.all([first, second, back])
    expect(accepted).toEqual([1, 1, -1])
    expect(position).toBe(390)
  })

  it('does not replay queued turns after closing the book', async () => {
    view.next = vi.fn(() => new Promise(resolve => setTimeout(resolve, 100)))
    view.prev = vi.fn(async () => {})
    const first = reader.next()
    await vi.advanceTimersByTimeAsync(0)
    const queued = reader.prev()
    reader.close()
    await vi.runAllTimersAsync()
    await Promise.all([first, queued])
    expect(view.next).toHaveBeenCalledOnce()
    expect(view.prev).not.toHaveBeenCalled()
  })

  it('allows the next page turn after a failed one', async () => {
    view.next = vi.fn().mockRejectedValueOnce(new Error('Section unavailable')).mockResolvedValueOnce()
    await expect(reader.next()).rejects.toThrow('Section unavailable')
    await expect(reader.next()).resolves.toBeUndefined()
    expect(view.next).toHaveBeenCalledTimes(2)
  })
})
