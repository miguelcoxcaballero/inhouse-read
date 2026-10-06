import { describe, expect, it, vi } from 'vitest'
import 'fake-indexeddb/auto'
import { Blob as NativeBlob } from 'node:buffer'
import { LibraryStore } from '../../src/js/library-store.js'
import { createReadingProgressQueue } from '../../src/js/reading-progress-queue.js'

const location = value => ({ kind:'pdf-page', value, textOffset:value * 10 })
const deferred = () => {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const tick = async () => { for (let i = 0; i < 8; i++) await Promise.resolve() }

describe('local reading progress queue', () => {
  it('commits the latest synchronous position without a debounce timer', async () => {
    const library = { updateProgress:vi.fn(async (id, fraction, locator) => ({ id, fraction, locator })) }
    const queue = createReadingProgressQueue(library), promises = []
    for (let page = 1; page <= 100; page++) promises.push(queue.updateProgress('book', page / 100, location(page)))
    expect(library.updateProgress).not.toHaveBeenCalled()
    expect(new Set(promises).size).toBe(1)
    expect(queue.get('book')).toBe(promises.at(-1))
    expect(await promises.at(-1)).toEqual({ id:'book', fraction:1, locator:location(100) })
    expect(library.updateProgress).toHaveBeenCalledExactlyOnceWith('book', 1, location(100))
    expect(queue.get('book')).toBeUndefined()
  })

  it('keeps the in-flight commit and writes only the latest of 100 pending positions', async () => {
    const first = deferred(), library = { updateProgress:vi.fn().mockImplementationOnce(() => first.promise)
      .mockImplementation(async (id, fraction, locator) => ({ id, fraction, locator })) }
    const saved = vi.fn(), queue = createReadingProgressQueue(library, { onSaved:saved })
    const initial = queue.updateProgress('book', .01, location(1))
    await tick()
    const pending = []
    for (let page = 2; page <= 101; page++) pending.push(queue.updateProgress('book', page / 101, location(page)))
    expect(library.updateProgress).toHaveBeenCalledTimes(1)
    expect(new Set(pending).size).toBe(1)
    let completed = false
    queue.get('book').then(() => { completed = true })
    await tick(); expect(completed).toBe(false)
    first.resolve({ id:'book', fraction:.01 })
    await initial; await pending.at(-1)
    expect(library.updateProgress.mock.calls).toEqual([['book', .01, location(1)], ['book', 1, location(101)]])
    expect(saved).toHaveBeenCalledTimes(2)
    expect(saved.mock.calls[1]).toEqual([{ id:'book', fraction:1, locator:location(101) }, 'book'])
    expect(queue.get('book')).toBeUndefined()
  })

  it('never merges across settings or previous-page history barriers', async () => {
    const first = deferred(), calls = []
    const library = {
      updateProgress:vi.fn(async (id, fraction, locator) => { calls.push(['position', locator.value]); if (locator.value === 1) await first.promise; return { id } }),
      patch:vi.fn(async (id, fields) => { calls.push(['settings', fields]); return { id } })
    }
    const queue = createReadingProgressQueue(library)
    queue.updateProgress('book', .1, location(1)); await tick()
    queue.updateProgress('book', .2, location(2))
    queue.updateProgress('book', .3, location(3))
    const fields = { returnLocation:location(3), readingTheme:'night' }
    queue.patch('book', fields); fields.readingTheme = 'sepia'
    queue.updateProgress('book', .4, location(4))
    const final = queue.updateProgress('book', .5, location(5))
    first.resolve(); await final
    expect(calls.map(call => call[0] === 'position' ? call : ['settings'])).toEqual([
      ['position', 1], ['position', 3], ['settings'], ['position', 5]
    ])
    expect(calls[2][1]).toEqual({ returnLocation:location(3), readingTheme:'night', progressUpdatedAt:expect.any(Number), progressDirty:true })
    expect(queue.get('book')).toBeUndefined()
  })

  it('allows different books to commit independently', async () => {
    const blocked = deferred(), library = { updateProgress:vi.fn(async id => id === 'a' ? blocked.promise : { id }) }
    const queue = createReadingProgressQueue(library)
    const a = queue.updateProgress('a', .3, location(3))
    expect(await queue.updateProgress('b', .4, location(4))).toEqual({ id:'b' })
    expect(queue.get('a')).toBe(a); expect(queue.get('b')).toBeUndefined()
    blocked.resolve({ id:'a' }); await a
  })

  it('reports a failed commit but continues to save the latest pending position', async () => {
    const first = deferred(), failure = new Error('Disk unavailable')
    const library = { updateProgress:vi.fn().mockImplementationOnce(() => first.promise).mockResolvedValue({ id:'book' }) }
    const saved = vi.fn(), queue = createReadingProgressQueue(library, { onSaved:saved })
    const failed = queue.updateProgress('book', .1, location(1))
    const rejection = expect(failed).rejects.toBe(failure)
    await tick()
    const final = queue.updateProgress('book', .9, location(9))
    first.reject(failure)
    await rejection; expect(await final).toEqual({ id:'book' })
    expect(saved).toHaveBeenCalledOnce(); expect(queue.get('book')).toBeUndefined()
    expect(await queue.patch('book', { readingTheme:'paper' }).catch(error => error)).toBeInstanceOf(TypeError)
  })

  it('waits for post-commit handling, and can queue a position from that handler', async () => {
    const notification = deferred(), library = { updateProgress:vi.fn(async id => ({ id })) }
    let queue, once = true
    queue = createReadingProgressQueue(library, { onSaved:async () => {
      if (once) { once = false; queue.updateProgress('book', .7, location(7)); await notification.promise }
    } })
    queue.updateProgress('book', .1, location(1)); await tick()
    let finished = false; const final = queue.get('book').then(() => { finished = true })
    await tick(); expect(finished).toBe(false); expect(library.updateProgress).toHaveBeenCalledTimes(1)
    notification.resolve(); await final
    expect(library.updateProgress).toHaveBeenLastCalledWith('book', .7, location(7))
    expect(queue.get('book')).toBeUndefined()
  })

  it('preserves original local bytes, cover, final locator and settings in IndexedDB', async () => {
    const library = new LibraryStore('reading-progress-queue-real-store')
    const bytes = new NativeBlob(['original book bytes'], { type:'application/pdf' })
    const cover = new NativeBlob(['original image'], { type:'image/jpeg' })
    const book = await library.addOrTouch({ sourceType:'local', name:'Book.pdf', size:bytes.size, content:bytes, cover, title:'Book', format:'PDF' })
    const progress = vi.spyOn(library, 'updateProgress'), queue = createReadingProgressQueue(library)
    for (let page = 1; page <= 100; page++) queue.updateProgress(book.id, page / 100, location(page))
    await queue.get(book.id)
    expect(progress).toHaveBeenCalledTimes(1)
    await queue.patch(book.id, { readingTheme:'amoled', returnLocation:location(8) })
    const stored = await library.get(book.id)
    expect(await stored.content.text()).toBe('original book bytes')
    expect(await stored.cover.text()).toBe('original image')
    expect(stored).toMatchObject({ progressFraction:1, locator:location(100), progressDirty:true, readingTheme:'amoled', returnLocation:location(8) })
  })
})
