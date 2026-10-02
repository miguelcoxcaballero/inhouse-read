import { describe, expect, it } from 'vitest'
import { createPreparedPageCache, createStageGate, pageKeyMismatch } from '../../src/js/prepared-page.js'

const key = (overrides = {}) => ({
  bookId:'book-1', epoch:3,
  locator:{ kind:'cfi', value:'epubcfi(/6/8!/4/2)' }, fraction:.42,
  location:{ fraction:.42, locator:{ kind:'cfi', value:'epubcfi(/6/8!/4/2/1:0)' } },
  viewport:{ left:0, top:48, width:390, height:732 }, pixelRatio:2,
  preferences:'{"theme":"paper","fontSize":19}', theme:'light', filter:'none',
  ...overrides
})
const snapshot = name => ({ source:{ name }, width:780, height:1464 })

describe('pageKeyMismatch', () => {
  it('accepts the same conditions, ignoring sub-pixel layout noise', () => {
    expect(pageKeyMismatch(key(), key())).toBeNull()
    expect(pageKeyMismatch(key(), key({ viewport:{ left:0.2, top:48.3, width:390.4, height:731.7 } }))).toBeNull()
    expect(pageKeyMismatch(key(), key({ fraction:.42 + 1e-12 }))).toBeNull()
  })

  it.each([
    ['book', { bookId:'book-2' }],
    ['engine', { epoch:4 }],
    ['saved-position', { fraction:.43 }],
    ['saved-position', { locator:{ kind:'cfi', value:'epubcfi(/6/10!/4/2)' } }],
    ['saved-position', { locator:null }],
    ['reader-position', { location:{ fraction:.5, locator:null } }],
    ['viewport', { viewport:{ left:0, top:48, width:844, height:390 } }],
    ['viewport', { viewport:{ left:0, top:49, width:390, height:732 } }],
    ['pixel-ratio', { pixelRatio:3 }],
    ['preferences', { preferences:'{"theme":"night","fontSize":19}' }],
    ['theme', { theme:'dark' }],
    ['filter', { filter:'brightness(0.8)' }]
  ])('names %s when it changed', (reason, change) => {
    expect(pageKeyMismatch(key(), key(change))).toBe(reason)
  })

  it('treats a missing key as a mismatch', () => {
    expect(pageKeyMismatch(null, key())).toBe('missing')
    expect(pageKeyMismatch(key(), undefined)).toBe('missing')
  })
})

describe('createPreparedPageCache', () => {
  it('hands the prepared page out once, when the key still holds', () => {
    const cache = createPreparedPageCache()
    const page = snapshot('a')
    expect(cache.store(cache.begin('book-1'), key(), page)).toBe(true)
    expect(cache.has('book-1')).toBe(true)
    expect(cache.take(key())).toBe(page)
    expect(cache.take(key())).toBeNull() // consumed: a second opening prepares its own
  })

  it('drops a page whose conditions changed and says why', () => {
    const cache = createPreparedPageCache()
    cache.store(cache.begin('book-1'), key(), snapshot('a'))
    expect(cache.take(key({ viewport:{ left:0, top:48, width:844, height:390 } }))).toBeNull()
    expect(cache.lastDiscard).toBe('viewport')
    expect(cache.has('book-1')).toBe(false)
    cache.store(cache.begin('book-1'), key(), snapshot('b'))
    expect(cache.take(key({ fraction:.9, locator:null }))).toBeNull()
    expect(cache.lastDiscard).toBe('saved-position')
  })

  it('refuses the result of work that was invalidated while it ran', () => {
    const cache = createPreparedPageCache()
    const ticket = cache.begin('book-1')
    expect(cache.isCurrent(ticket)).toBe(true)
    cache.invalidate('resize')
    expect(cache.isCurrent(ticket)).toBe(false)
    expect(cache.store(ticket, key(), snapshot('late'))).toBe(false)
    expect(cache.take(key())).toBeNull()
    // work begun afterwards is fine
    expect(cache.store(cache.begin('book-1'), key(), snapshot('fresh'))).toBe(true)
  })

  it('invalidate() drops the held page and records the reason', () => {
    const cache = createPreparedPageCache()
    cache.store(cache.begin('book-1'), key(), snapshot('a'))
    cache.invalidate('reader-closed')
    expect(cache.peek()).toBeNull()
    expect(cache.lastDiscard).toBe('reader-closed')
    expect(cache.take(key())).toBeNull()
  })

  it('invalidateBook() only affects the book that owns the page or the work in flight', () => {
    const cache = createPreparedPageCache()
    cache.store(cache.begin('book-1'), key(), snapshot('a'))
    cache.invalidateBook('book-2', 'removed')
    expect(cache.has('book-1')).toBe(true)
    const inFlight = cache.begin('book-2')
    cache.invalidateBook('book-2', 'removed')
    expect(cache.isCurrent(inFlight)).toBe(false)
    expect(cache.has('book-1')).toBe(false) // the earlier page went with the generation bump: one slot, one reader
    cache.store(cache.begin('book-1'), key(), snapshot('b'))
    cache.invalidateBook('book-1', 'removed')
    expect(cache.take(key())).toBeNull()
    expect(cache.lastDiscard).toBe('removed')
  })

  it('does not store a page under another book than the ticket was for', () => {
    const cache = createPreparedPageCache()
    expect(cache.store(cache.begin('book-1'), key({ bookId:'book-2' }), snapshot('a'))).toBe(false)
  })

  it('a newer ticket supersedes unfinished work, including the same book', () => {
    const cache = createPreparedPageCache()
    const first = cache.begin('book-1')
    const newer = cache.begin('book-1')
    expect(cache.store(first, key(), snapshot('old'))).toBe(false)
    expect(cache.store(newer, key(), snapshot('new'))).toBe(true)
    const other = cache.begin('book-2')
    expect(cache.peek()).toBeNull()
    expect(cache.store(newer, key(), snapshot('late'))).toBe(false)
    expect(cache.isCurrent(other)).toBe(true)
  })

  it('never stores an empty snapshot', () => {
    const cache = createPreparedPageCache()
    expect(cache.store(cache.begin('book-1'), key(), null)).toBe(false)
  })
})

describe('createStageGate', () => {
  const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }
  const flush = () => new Promise(resolve => setTimeout(resolve, 0))

  it('waits for the settled signal and then for an idle slice', async () => {
    const settled = deferred(), idle = deferred(), events = []
    const gate = createStageGate(settled.promise, { idle:() => { events.push('idle'); return idle.promise } })
    const waited = gate.wait().then(value => { events.push(`go:${value}`) })
    await flush()
    expect(events).toEqual([])
    settled.resolve(true)
    await flush()
    expect(events).toEqual(['idle'])
    idle.resolve()
    await waited
    expect(events).toEqual(['idle', 'go:true'])
  })

  it('skips the work when the selection ended without settling', async () => {
    const settled = deferred()
    const gate = createStageGate(settled.promise, { idle:() => Promise.resolve() })
    settled.resolve(false)
    expect(await gate.wait()).toBe(false)
  })

  it('lets go at once for an open request, even before the pull-out finished or while idle is pending', async () => {
    const never = new Promise(() => {})
    const early = createStageGate(never, { idle:() => never })
    early.release('open')
    expect(await early.wait()).toBe(true)

    const settled = deferred()
    const waiting = createStageGate(settled.promise, { idle:() => never })
    const result = waiting.wait()
    settled.resolve(true)
    await flush()
    waiting.release('open')
    expect(await result).toBe(true)
  })

  it('ends the wait without work when the selection is dismissed or replaced', async () => {
    const never = new Promise(() => {})
    for (const reason of ['dismissed', 'new-selection', 'reader-closed']) {
      const gate = createStageGate(never, { idle:() => never })
      gate.release(reason)
      expect(await gate.wait()).toBe(false)
    }
  })

  it('has nothing to wait for when the shelf gave no signal', async () => {
    expect(await createStageGate(undefined, { idle:() => Promise.resolve() }).wait()).toBe(true)
  })

  it('treats a failing settled signal as a cancelled selection', async () => {
    expect(await createStageGate(Promise.reject(new Error('x')), { idle:() => Promise.resolve() }).wait()).toBe(false)
  })
})
