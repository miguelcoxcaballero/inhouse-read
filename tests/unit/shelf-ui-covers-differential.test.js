import { writeShelfDifference } from './helpers/shelf-differential.js'
/**
 * The covers of the shelf against the frozen JavaScript original (helpers/reference-bookshelf.js): which URL a book's
 * cover gets (and how many object URLs that costs), the analysis of its colour and cloth and what happens when the
 * answer arrives (while the shelf is idle, while a book is lifted, after the cover was replaced, after the book was
 * removed), the preload on pointer down and the quick look the lift takes. Both implementations play the same script
 * on the same doubles; every call on the host, every callback and the whole document after each step must be identical.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderBookshelf as production } from '../../src/js/bookshelf.js'
import { renderBookshelf as frozen } from './helpers/reference-bookshelf.js'
import { analyzeCoverRelief } from '../../src/js/cover-relief.js'
import { captureUnhandled, firstDifference, flush, keydown, play, q, show, stubRects } from './helpers/shelf-differential.js'

const state = vi.hoisted(() => ({ log: [], config: {}, analyses: [] }))

vi.mock('../../src/js/book-model.js', async () => {
  const helper = await import('./helpers/shelf-differential.js')
  return {
    getBookRenderer: () => state.config.scene ? {} : null,
    planReadingBookPose: () => ({ x: 0, y: 0, scale: 1, angle: 0, pitch: 0, coverOpen: 1 }),
    fitCoverImage: (w, h) => ({ x: 0, y: 0, width: w, height: h }),
    bookView(host, book, style, dimensions) {
      const view = helper.recordingView(state.log, host, book, style, dimensions)
      state.log.push(`bookView(${helper.show(book.id)},${helper.show(style)})`)
      return view
    }
  }
})
vi.mock('../../src/js/bookshelf-scene.js', async () => {
  const helper = await import('./helpers/shelf-differential.js')
  return { createBookshelfScene: () => helper.recordingScene(state.log, { sourcePose: { scale: 1, height: 160, thickness: 28, centerX: 34, centerY: 180 } }) }
})
vi.mock('../../src/js/cover-relief.js', async importOriginal => ({ ...await importOriginal(), analyzeCoverRelief: vi.fn(), buildReliefMaps: vi.fn() }))
vi.mock('../../src/js/cover-appearance.js', async importOriginal => ({
  ...await importOriginal(),
  readCoverAspectRatio: vi.fn(async () => 0.66),
  // Every analysis is logged and answered as the scenario says (`state.config.analysis(url, title, call)`).
  analyzeCoverAppearance: vi.fn(async (url, title, options) => {
    const call = state.analyses.length + 1
    state.analyses.push(url)
    state.log.push(`analyzeCoverAppearance(${show(url)},${show(title)},${show(options)}) #${call}`)
    return state.config.analysis ? state.config.analysis(url, title, call) : null
  })
}))

const APPEARANCE = { color: '#2a6f97', shade: '#1d4f6f', ink: '#f3f1e2', fontFamily: 'Lora', fontCanvasFamily: 'Lora', fontFallback: 'Georgia, serif', fontWeight: 600, aspectRatio: 0.7, source: 'cover' }
const OTHER = { color: '#8a3b2c', shade: '#5f281d', ink: '#fff3e0', fontFamily: 'Oswald', fontCanvasFamily: 'Oswald', fontFallback: 'Arial, sans-serif', fontWeight: 700, aspectRatio: 0.5, source: 'cover' }

let container, shelf, restoreRects, urlCount
beforeEach(() => {
  state.log.length = 0; state.config = {}; state.analyses.length = 0; urlCount = 0
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'requestAnimationFrame', 'cancelAnimationFrame', 'performance', 'Date'] })
  localStorage.clear()
  restoreRects = stubRects()
  vi.stubGlobal('WebGLRenderingContext', class {})
  vi.stubGlobal('matchMedia', query => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} }))
  // Object URLs are numbered per run, so two runs that ask for the same covers get the same names.
  globalThis.URL.createObjectURL = blob => { const url = `blob:test/${++urlCount}`; state.log.push(`createObjectURL(${show(blob)}) -> ${url}`); return url }
  globalThis.URL.revokeObjectURL = url => { state.log.push(`revokeObjectURL(${url})`) }
  vi.stubGlobal('Image', class { set decoding(value) { state.log.push(`Image.decoding=${value}`) } set src(value) { state.log.push(`Image.src=${value}`) } })
  vi.mocked(analyzeCoverRelief).mockReset()
  vi.mocked(analyzeCoverRelief).mockImplementation(async () => ({ proposals: [], analysis: {} }))
})
afterEach(() => {
  shelf?.destroy(); shelf = null
  container?.remove(); container = null
  document.body.innerHTML = ''
  restoreRects()
  delete globalThis.URL.createObjectURL; delete globalThis.URL.revokeObjectURL
  vi.restoreAllMocks()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

const logged = (name, fn) => (...args) => { state.log.push(`${name}(${args.map(arg => show(arg)).join(',')})`); return fn?.(...args) }
const blob = (size = 1, type = 'image/jpeg') => new Blob(['x'.repeat(size)], { type })
const book = (id, extra = {}) => ({
  id, title: `Libro ${id}`, author: 'Autora', format: 'EPUB', sourceType: 'local', addedAt: 1, lastOpenedAt: 1, progressFraction: 0.3, cover: blob(3), ...extra
})
const ready = async () => { await vi.waitFor(() => expect(q('.ihr-flyout__cover-target.is-ready')).not.toBeNull()) }
const lift = async () => { q('.ihr-spine').click(); await ready() }
const pointer = (node, type, init = {}) => {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.assign(event, { button: 0, pointerId: 1, pointerType: 'mouse', isPrimary: true, clientX: 30, clientY: 120, ...init })
  node.dispatchEvent(event)
}

async function session(render, script, { books = () => [book('a'), book('b')], extra = {}, config = {} } = {}) {
  document.body.innerHTML = ''; state.log.length = 0; state.analyses.length = 0; urlCount = 0; state.config = { ...config }
  state.config.reset?.()
  container = document.createElement('div')
  document.body.append(container)
  const options = { shelfWidth: 390, sections: false, revealDuration: 0, holdMs: 0, autoOpen: true, ...extra }
  for (const name of ['onBookCustomizationChange', 'onBookDismiss', 'onPrepareBook', 'onBookOrderChange', 'onShelfPlacementChange']) {
    options[name] ??= (...args) => { state.log.push(`${name}(${args.map(arg => show(arg)).join(',')})`); return Promise.resolve() }
  }
  shelf = render(container, books(), options)
  await flush(10)
  const log = await play(state.log, script(), { settle: 200 })
  shelf.destroy(); shelf = null
  return [...log]
}

async function same(script, settings = {}) {
  const savedStorage = Array.from({ length: localStorage.length }, (_, index) => {
    const key = localStorage.key(index); return [key, localStorage.getItem(key)]
  })
  const original = captureUnhandled()
  const expected = await session(frozen, script, settings)
  const leftByOriginal = await original.stop()
  container?.remove(); document.body.innerHTML = ''
  // Both implementations must start from the same preferences and placements, including after a script moves objects.
  localStorage.clear()
  for (const [key, value] of savedStorage) localStorage.setItem(key, value)
  const port = captureUnhandled()
  const actual = await session(production, script, settings)
  // What the original leaves unhandled (a rejection nobody awaits) is left unhandled by the port, and nothing more.
  expect(await port.stop()).toEqual(leftByOriginal)
  const difference = firstDifference(expected, actual)
  if (difference) await writeShelfDifference('covers', expected, actual)
  expect(difference).toBeNull()
  return expected.join('\n')
}

describe('the covers against the frozen original', () => {
  it('keeps the options receiver while resolving and persisting a cover', async () => {
    const text = await same(() => [['paint', () => {}]], {
      config: { analysis: () => APPEARANCE },
      extra: {
        receiverMarker: 'cover-options',
        coverSrcFor() { state.log.push(`source receiver ${this?.receiverMarker}`); return 'blob:receiver' },
        onCoverAppearance() { state.log.push(`appearance receiver ${this?.receiverMarker}`); return Promise.resolve() }
      }
    })
    expect(text).toContain('source receiver cover-options')
    expect(text).toContain('appearance receiver cover-options')
  }, 60_000)

  it.each(['\ud800', '\udfff', '\ud800\ud800'])('keeps UTF-16 identity %j distinct in the saved-cover cache', async identity => {
    const replacement = identity.replace(/[\ud800-\udfff]/g, '\ufffd')
    const books = () => [book(`local:${identity}`, { title: 'Mismo título' }), book(`local:${replacement}`, { title: 'Mismo título' })]
    const text = await same(() => [['paint', () => {}], ['same records', () => shelf.refresh(books())]], { books })
    expect(text).toContain('blob:test/2')
  }, 60_000)

  it('holds and removes the requested UTF-16 book without selecting its replacement character twin', async () => {
    const books = () => [book('local:\ud800', { title: 'Primero' }), book('local:\ufffd', { title: 'Segundo' })]
    const text = await same(() => [
      ['paint', () => {}],
      ['hold first', () => shelf.setReturningBook('local:\ud800')],
      ['hold second', () => shelf.setReturningBook('local:\ufffd')],
      ['release', () => shelf.setReturningBook(null)],
      ['move first', async () => { keydown(q('.ihr-spine'), 'ArrowRight', { shiftKey: true }); await flush(800) }],
      ['remove first', async () => {
        const node = [...document.querySelectorAll('.ihr-spine')].find(node => node.dataset.bookId === 'local:\ud800')
        keydown(node, 'Delete'); await flush(2000)
      }]
    ], { books, extra: { onBookRemove: logged('onBookRemove', async () => {}) } })
    expect(text).toContain('onBookRemove')
    expect(text).toContain('onShelfPlacementChange')
  }, 60_000)

  it('invalidates the saved-cover key for UTF-16 title changes', async () => {
    const books = () => [book('a', { title: 'Título \ud800' })]
    const text = await same(() => [
      ['paint', () => {}],
      ['different UTF-16 title', () => shelf.refresh([book('a', { title: 'Título \ufffd' })])]
    ], { books })
    expect(text).toContain('blob:test/2')
  }, 60_000)

  it('gives each saved cover one object URL, keeps it across refreshes and replaces it with the cover', async () => {
    const script = () => [
      ['first paint', () => {}],
      ['the same records again', () => shelf.refresh([book('a'), book('b')])],
      ['a replaced cover', () => shelf.refresh([book('a', { cover: blob(9) }), book('b')])],
      ['a cover updated in place', () => shelf.refresh([book('a', { cover: blob(9), coverUpdatedAt: 77 }), book('b')])],
      ['a book without a cover', () => shelf.refresh([book('a', { cover: undefined }), book('b')])]
    ]
    const text = await same(script, { config: { analysis: () => APPEARANCE } })
    expect(text).toContain('createObjectURL'); expect(text).toContain('analyzeCoverAppearance')
  }, 60_000)

  it('reads the cover from the record when the application has no source, from a string, a coverBlob or a coverUrl', async () => {
    const books = () => [book('s', { cover: 'https://example.test/cover.png' }), book('u', { cover: undefined, coverUrl: 'data:image/png;base64,AAAA' }),
      book('b', { cover: undefined, coverBlob: blob(4, 'image/png') }), book('n', { cover: undefined }), book('t', { cover: blob(5, 'image/webp'), title: undefined })]
    const text = await same(() => [['paint', () => {}], ['again', () => shelf.refresh(books())]], { books, config: { analysis: url => url === 'https://example.test/cover.png' ? OTHER : APPEARANCE } })
    expect(text).toContain('https://example.test/cover.png')
  }, 60_000)

  it('asks the application for the cover first and falls back when it answers nothing, fails or is slow', async () => {
    const variants = {
      string: () => 'blob:app/cover', promise: () => Promise.resolve('blob:app/promised'), promisedBlob: () => Promise.resolve(blob(7)),
      nothing: () => null, throws: () => { throw new Error('no cover') }, rejects: () => Promise.reject(new Error('no cover')), slow: () => new Promise(resolve => setTimeout(() => resolve('blob:app/slow'), 500))
    }
    for (const [name, coverSrcFor] of Object.entries(variants)) {
      const text = await same(() => [['paint', () => {}], ['lift', lift], ['later', async () => { await flush(800) }]],
        { extra: { coverSrcFor: logged(`coverSrcFor[${name}]`, coverSrcFor) }, config: { analysis: () => APPEARANCE } })
      expect(text).toContain(`coverSrcFor[${name}]`)
    }
  }, 120_000)

  it('answers the scene path of the covers: the immediate URL, a pending source and the entry update', async () => {
    const scene = { scene: true }
    const variants = [undefined, () => 'blob:app/now', () => new Promise(() => {}), () => { throw new Error('boom') }]
    for (const coverSrcFor of variants) {
      await same(() => [['paint', () => {}], ['again', () => shelf.refresh([book('a'), book('b')])], ['lift', lift]],
        { extra: coverSrcFor ? { coverSrcFor } : {}, config: { ...scene, analysis: () => APPEARANCE } })
    }
  }, 120_000)

  it('applies an analysis that arrives later: on the idle shelf, with the scene, with a lifted book and for a replaced cover', async () => {
    const pending = []
    const slow = () => new Promise(resolve => pending.push(resolve))
    const release = (index, value) => async () => { pending[index]?.(value); await flush(50) }
    for (const scene of [false, true]) {
      const script = () => [
        ['paint with the analyses pending', () => {}],
        ['the first book is analysed', release(0, APPEARANCE)],
        ['lift the first book', lift],
        ['the second book is analysed under it', release(1, OTHER)],
        ['close', () => keydown(document.body, 'Escape')],
        ['replace the cover under a pending analysis', async () => { shelf.refresh([book('a', { cover: blob(11) }), book('b')]); await flush(50) }],
        ['the stale answer arrives', release(2, OTHER)]
      ]
      await same(script, { config: { scene, analysis: slow, reset: () => { pending.length = 0 } } })
    }
  }, 120_000)

  it('refreshes a spine once a pressed book is released, and keeps the appearance of a removed book out', async () => {
    const pending = []
    const slow = () => new Promise(resolve => pending.push(resolve))
    const script = () => [
      ['paint', () => {}],
      ['press the first spine', () => pointer(q('.ihr-spine'), 'pointerdown')],
      ['the analysis arrives under the finger', async () => { pending[0]?.(APPEARANCE); await flush(50) }],
      ['release', () => { pointer(q('.ihr-spine'), 'pointerup'); pointer(q('.ihr-spine'), 'pointerleave') }],
      ['wait for the deferred refresh', async () => { await flush(100) }]
    ]
    await same(script, { config: { analysis: slow, reset: () => { pending.length = 0 } } })
    const removal = () => [
      ['paint', () => {}],
      ['the analyses arrive', async () => { for (const resolve of pending) resolve(APPEARANCE); await flush(50) }],
      ['delete the first book', async () => { keydown(q('.ihr-spine'), 'Delete'); await flush(1500) }],
      ['the shelf again', () => shelf.refresh([book('b')])]
    ]
    const text = await same(removal, { extra: { onBookRemove: logged('onBookRemove', () => Promise.resolve()) }, config: { analysis: () => APPEARANCE, reset: () => { pending.length = 0 } } })
    expect(text).toContain('revokeObjectURL')
  }, 120_000)

  it('survives a failing or slow analysis, a failing save and a destroyed shelf', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const analyses = {
      nothing: () => null, rejects: () => Promise.reject(new Error('cannot decode')), appearance: () => APPEARANCE
    }
    for (const [name, analysis] of Object.entries(analyses)) {
      for (const save of [undefined, logged('onCoverAppearance', () => { throw new Error('storage full') }), logged('onCoverAppearance', () => Promise.reject(new Error('no space')))]) {
        const text = await same(() => [['paint', () => {}], ['lift', lift]], { extra: save ? { onCoverAppearance: save } : {}, config: { analysis } })
        expect(text).toContain('analyzeCoverAppearance')
        if (name === 'appearance' && save) expect(text).toContain('onCoverAppearance')
      }
    }
    const destroyed = () => [['paint with the analysis pending', () => {}], ['destroy', () => shelf.destroy()], ['the answer arrives', async () => { await flush(500) }]]
    await same(destroyed, { config: { analysis: () => new Promise(resolve => setTimeout(() => resolve(APPEARANCE), 300)) } })
  }, 120_000)

  it('preloads a cover on pointer down and takes a quick look at its colour when the book is lifted', async () => {
    const script = () => [
      ['press', () => pointer(q('.ihr-spine'), 'pointerdown', { pointerType: 'touch' })],
      ['wait', async () => { await flush(50) }],
      ['release', () => pointer(q('.ihr-spine'), 'pointerup', { pointerType: 'touch' })],
      ['lift', lift],
      ['close', () => keydown(document.body, 'Escape')]
    ]
    const text = await same(script, { config: { analysis: (_url, _title, call) => new Promise(resolve => setTimeout(() => resolve(call % 2 ? APPEARANCE : OTHER), call % 2 ? 5 : 80)) } })
    expect(text).toContain('Image.src=')
  }, 60_000)

  it('keeps the covers of a record list that is replaced while a lifted book is open', async () => {
    const script = () => [
      ['lift', lift],
      ['records arrive while it is open', async () => { shelf.refresh([book('a', { cover: blob(12) }), book('b'), book('c')]); await flush(50) }],
      ['close', async () => { keydown(document.body, 'Escape'); await flush(1000) }]
    ]
    await same(script, { config: { analysis: () => OTHER } })
  }, 60_000)
})
