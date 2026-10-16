/**
 * The way back from the reader against the frozen JavaScript original (helpers/reference-bookshelf.js): the slot that
 * waits for the shelf to lay itself out, the closing book (page, ribbon, cover, flight and insertion) with a 3D view
 * and without one, with the shelf scene and without it, held motions that are cancelled, a failing alignment, a
 * resize and a destroyed shelf. Both implementations play the same script on the same doubles; every call on the
 * host, every callback, the numbers handed to the book model and the whole document after each step must be identical.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderBookshelf as production } from '../../src/js/bookshelf.js'
import { renderBookshelf as frozen } from './helpers/reference-bookshelf.js'
import { analyzeCoverRelief } from '../../src/js/cover-relief.js'
import { click, firstDifference, flush, heldMotion, keydown, play, q, recordingView, show, stubRects } from './helpers/shelf-differential.js'

const state = vi.hoisted(() => ({ log: [], config: {}, views: [] }))

vi.mock('../../src/js/book-model.js', async () => {
  const helper = await import('./helpers/shelf-differential.js')
  return {
    getBookRenderer: () => state.config.scene ? {} : null,
    planReadingBookPose: (...args) => { state.log.push(`planReadingBookPose(${helper.show(args)})`); return { x: 0.5, y: -1.25, scale: 1.0625, angle: 3, pitch: 0.5, coverOpen: 1 } },
    fitCoverImage: (w, h) => ({ x: 0, y: 0, width: w, height: h }),
    bookView(host, book, style, dimensions) {
      const name = helper.show(book.id)
      if (state.config.noView) { state.log.push(`bookView(${name}) -> null`); return null }
      const view = helper.recordingView(state.log, host, book, style, dimensions)
      for (const method of ['animate', 'animateBookmark', 'animateCoverClose']) {
        const instant = view[method]
        view[method] = (...args) => { const motion = instant(...args); return state.config.hold ? helper.heldMotion(state.log, `view.${method}`) : motion }
      }
      if (state.config.alignFails) view.alignToPage = () => false
      // A failure is injected only while the way back runs (`failNow`): a failing opening is a different story.
      for (const method of ['setPageSnapshot', 'animate', 'animateBookmark', 'animateCoverClose', 'dispose']) {
        const original = view[method]
        view[method] = (...args) => { const result = original(...args); if (state.config.failNow === method) throw new Error(`boom in ${method}`); return result }
      }
      if (state.config.handoff) {
        view.handoffToShelfInsertion = start => {
          state.log.push('view.handoffToShelfInsertion')
          const motion = start({ kind: 'native-presentation' })
          state.log.push(`view.handoffToShelfInsertion -> ${helper.show(motion)}`)
          return motion
        }
      }
      state.views.push(view)
      state.log.push(`bookView(${name},${helper.show(style)},${helper.show(dimensions)})`)
      return view
    }
  }
})
vi.mock('../../src/js/bookshelf-scene.js', async () => {
  const helper = await import('./helpers/shelf-differential.js')
  return { createBookshelfScene: layout => { state.log.push(`createBookshelfScene(${helper.show(layout)})`); return helper.recordingScene(state.log, state.config.scene) } }
})
vi.mock('../../src/js/cover-relief.js', async importOriginal => ({ ...await importOriginal(), analyzeCoverRelief: vi.fn(), buildReliefMaps: vi.fn() }))
vi.mock('../../src/js/cover-appearance.js', async importOriginal => ({
  ...await importOriginal(),
  readCoverAspectRatio: vi.fn(async () => 0.66),
  analyzeCoverAppearance: vi.fn(async () => null)
}))

// The shelf holds its first layout until the covers have been analysed: a return asked then waits for its slot.
const WAITING = { waitForCoverAppearance: true }
const ID = 'local:diff:1'
const SOURCE_POSE = { scale: 1.5, height: 160, thickness: 28, centerX: 34, centerY: 180, angle: 90, pitch: 0, roll: 0 }
const DOCKING_POSE = { scale: 0.75, height: 160, thickness: 28, centerX: 36.5, centerY: 182.25, angle: 88.5, pitch: 1.5, roll: -0.25 }

let container, shelf, restoreRects
beforeEach(() => {
  state.log.length = 0; state.views.length = 0; state.config = {}
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'requestAnimationFrame', 'cancelAnimationFrame', 'performance', 'Date'] })
  localStorage.clear()
  restoreRects = stubRects()
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ({ drawImage() {} }))
  vi.stubGlobal('WebGLRenderingContext', class {})
  vi.stubGlobal('matchMedia', query => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} }))
  vi.mocked(analyzeCoverRelief).mockReset()
  vi.mocked(analyzeCoverRelief).mockImplementation(async () => ({ proposals: [], analysis: {} }))
})
afterEach(() => {
  shelf?.destroy(); shelf = null
  container?.remove(); container = null
  document.body.innerHTML = ''
  restoreRects()
  vi.restoreAllMocks()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

const logged = (name, fn) => (...args) => { state.log.push(`${name}(${args.map(arg => show(arg)).join(',')})`); return fn?.(...args) }
const book = (extra = {}) => ({
  id: ID, title: 'La sombra del viento', author: 'Carlos Ruiz Zafón', format: 'PDF', sourceType: 'local',
  addedAt: 1, lastOpenedAt: 1, progressFraction: 0.3, cover: new Blob(['x'], { type: 'image/jpeg' }), ...extra
})
const pageSnapshot = (extra = {}) => ({
  source: document.createElement('canvas'), paper: { source: document.createElement('canvas') }, width: 374, height: 561, sourceType: 'pdf-canvas',
  location: { fraction: 0.4, locator: { kind: 'pdf-page', value: 3 } }, displayBounds: { left: 8, top: 48, width: 374, height: 561 }, text: 'Texto de la página', ...extra
})
const opening = logged('onOpenBook', async (_book, context) => context.finish({
  pageSnapshot: pageSnapshot(),
  animatePage: async ({ duration, animateBookToPage }) => { await animateBookToPage({ left: 8, top: 48, width: 374, height: 561, duration }) }
}))
const ready = async () => { await vi.waitFor(() => expect(q('.ihr-flyout__cover-target.is-ready')).not.toBeNull()) }
const lift = async () => { q('.ihr-spine').click(); await ready() }
const toReader = async () => { click(q('.ihr-flyout__cover-target')); await flush(20) }
const latest = () => book({ progressFraction: 0.8, lastOpenedAt: 9, locator: 9 })

/** What the application does when the reader is left: hold the slot, then bring the book back. */
const back = ({ snapshot = pageSnapshot, wait = true, options = {} } = {}) => async () => {
  shelf.setReturningBook(ID)
  const promise = shelf.returnToShelf(ID, { pageSnapshot: snapshot?.(), book: latest(), onPageReady: logged('onPageReady'), ...options })
  const note = promise.then(result => state.log.push(`returned ${show(result)}`), error => state.log.push(`return failed ${error?.name}: ${error?.message}`))
  // The clock is faked: let the shelf's own frames run while the return waits for its slot.
  if (wait) { await flush(100); await note }
}

async function session(render, script, { books = () => [book()], extra = {}, config = {}, early = false } = {}) {
  document.body.innerHTML = ''; state.views.length = 0; state.log.length = 0; state.config = { ...config }
  container = document.createElement('div')
  document.body.append(container)
  const options = { shelfWidth: 390, sections: false, revealDuration: 0, holdMs: 0, autoOpen: true, coverSrcFor: () => 'blob:cover', onOpenBook: opening, ...extra }
  for (const name of ['onBookCustomizationChange', 'onBookDismiss', 'onPrepareBook', 'onBookOrderChange', 'onShelfPlacementChange']) {
    options[name] ??= (...args) => { state.log.push(`${name}(${args.map(arg => show(arg)).join(',')})`); return Promise.resolve() }
  }
  shelf = render(container, books(), options)
  if (!early) await flush(10)
  const log = await play(state.log, script(), { settle: 200 })
  shelf.destroy(); shelf = null
  return [...log]
}

async function same(script, settings = {}) {
  const expected = await session(frozen, script, settings)
  container?.remove(); document.body.innerHTML = ''
  const actual = await session(production, script, settings)
  const difference = firstDifference(expected, actual)
  if (difference) (await import('node:fs')).writeFileSync('/tmp/claude-0/-home-user-inhouse-read/6c70f5ca-de80-5128-bee1-f59b39f4610d/scratchpad/shelf-ui/return-diff.txt', ['EXPECTED', ...expected, 'ACTUAL', ...actual].join('\n'))
  if (process.env.SHELF_DUMP) (await import('node:fs')).writeFileSync(`${process.env.SHELF_DUMP}/${expect.getState().currentTestName.replace(/\W+/g, '-')}.txt`, expected.join('\n'))
  expect(difference).toBeNull()
  return expected.join('\n')
}

const handed = () => [['lift', lift], ['hand the book to the reader', toReader], ['reader origin', () => state.log.push(`origin ${shelf.hasReaderOrigin(ID)}`)]]

describe('the way back from the reader against the frozen original', () => {
  it('plays the closing with a 3D view and a saved page, without the shelf scene', async () => {
    const text = await same(() => [...handed(), ['come back', back()]])
    for (const marker of ['returned true', 'view.setPageSnapshot', 'view.animateBookmark', 'view.animateCoverClose', 'onPageReady', 'planReadingBookPose']) expect(text).toContain(marker)
  }, 60_000)

  it('plays the closing with the shelf scene, its poses and the insertion', async () => {
    const scene = { sourcePose: SOURCE_POSE, dockingPose: DOCKING_POSE }
    const text = await same(() => [...handed(), ['come back', back()]], { config: { scene } })
    for (const marker of ['returned true', 'scene.returnBook', 'view.releaseToSnapshot', 'scene.getReturnPose', 'scene.getBookPose', 'scene.setPaintHeld']) expect(text).toContain(marker)
  }, 60_000)

  it('hands the insertion to a native presentation when the view offers one', async () => {
    const scene = { sourcePose: SOURCE_POSE, dockingPose: DOCKING_POSE }
    const text = await same(() => [...handed(), ['come back', back()]], { config: { scene, handoff: true } })
    expect(text).toContain('view.handoffToShelfInsertion'); expect(text).toContain('native-presentation')
    // A view that declines the hand-over lands through the scene directly.
    await same(() => [...handed(), ['come back', back()]], { config: { scene, handoff: false } })
  }, 60_000)

  it('flies without an insertion when the scene knows the spine but has no docking pose', async () => {
    const text = await same(() => [...handed(), ['come back', back()]], { config: { scene: { sourcePose: SOURCE_POSE } } })
    expect(text).toContain('returned true'); expect(text).not.toContain('scene.returnBook')
  }, 60_000)

  it('lands when the scene produced no insertion motion', async () => {
    const scene = { sourcePose: SOURCE_POSE, dockingPose: DOCKING_POSE, insertion: false }
    await same(() => [...handed(), ['come back', back()]], { config: { scene } })
  }, 60_000)

  it('plays the closing without a 3D view (the DOM book)', async () => {
    const text = await same(() => [...handed(), ['come back', back()]], { config: { noView: true } })
    expect(text).toContain('returned true'); expect(text).toContain('-> null')
  }, 60_000)

  it('plays the DOM book with the scene and without a page', async () => {
    const config = { noView: true, scene: { sourcePose: SOURCE_POSE, dockingPose: DOCKING_POSE } }
    await same(() => [...handed(), ['come back', back()]], { config })
    await same(() => [...handed(), ['come back without a page', back({ snapshot: null })]], { config })
  }, 60_000)

  it('returns without a saved page (the cover closes at once)', async () => {
    const text = await same(() => [...handed(), ['come back', back({ snapshot: null })]])
    expect(text).toContain('returned true')
  }, 60_000)

  it('honours reduced motion', async () => {
    vi.stubGlobal('matchMedia', query => ({ matches: /reduce/.test(query), media: query, addEventListener() {}, removeEventListener() {} }))
    const text = await same(() => [...handed(), ['come back', back()]], { config: { scene: { sourcePose: SOURCE_POSE, dockingPose: DOCKING_POSE } } })
    expect(text).toContain('duration:1')
  }, 60_000)

  it('passes the numbers of a landscape screen to the book model unchanged', async () => {
    const width = window.innerWidth, height = window.innerHeight
    window.innerWidth = 700; window.innerHeight = 400
    try {
      const text = await same(() => [...handed(), ['come back', back()]], { config: { scene: { sourcePose: SOURCE_POSE, dockingPose: DOCKING_POSE } } })
      expect(text).toContain('viewportWidth:700')
    } finally { window.innerWidth = width; window.innerHeight = height }
  }, 60_000)

  it('fails the same way when the page cannot be aligned', async () => {
    const text = await same(() => [...handed(), ['come back', back()]], { config: { alignFails: true } })
    expect(text).toContain('return failed Error: No se pudo alinear')
  }, 60_000)

  it('cancels the book and rethrows whatever fails on the host in the middle of the closing', async () => {
    for (const failAt of ['setPageSnapshot', 'animate', 'animateBookmark', 'animateCoverClose', 'dispose']) {
      const script = () => [...handed(), ['come back', async () => { state.config.failNow = failAt; try { await back()() } finally { state.config.failNow = null } }]]
      const text = await same(script)
      expect(text).toContain(`return failed Error: boom in ${failAt}`)
    }
    const scene = { sourcePose: SOURCE_POSE, dockingPose: DOCKING_POSE, fail: true }
    expect(await same(() => [...handed(), ['land the book', back()]], { config: { scene } })).toContain('return failed Error: the scene cannot land the book')
    const text = await same(() => [...handed(), ['page callback', back({ options: { onPageReady: logged('onPageReady', () => { throw new Error('boom in onPageReady') }) } })]])
    expect(text).toContain('return failed Error: boom in onPageReady')
    // The DOM book fails the same way.
    expect(await same(() => [...handed(), ['page callback', back({ options: { onPageReady: () => { throw new Error('boom in onPageReady') } } })]], { config: { noView: true } })).toContain('boom in onPageReady')
  }, 120_000)

  it('cancels the closing that is in flight when the book is asked back again', async () => {
    const script = () => [...handed(),
      ['first return, motions held', async () => { state.config.hold = true; await back({ wait: false })(); await flush(50) }],
      ['second return replaces it', async () => { await back({ wait: false })(); await flush(50) }],
      ['let the watchdogs release the motions', async () => { state.config.hold = false; await flush(20000) }]]
    const text = await same(script, { config: { scene: { sourcePose: SOURCE_POSE, dockingPose: DOCKING_POSE } } })
    expect(text).toContain('view.animate.cancel'); expect(text).toContain('returned false')
  }, 60_000)

  it('cancels the closing when the shelf is destroyed in flight', async () => {
    const script = () => [...handed(),
      ['return, motions held', async () => { state.config.hold = true; await back({ wait: false })(); await flush(50) }],
      ['destroy the shelf', async () => { shelf.destroy(); await flush(20000) }]]
    const text = await same(script, { config: { scene: { sourcePose: SOURCE_POSE, dockingPose: DOCKING_POSE } } })
    expect(text).toContain('returned')
  }, 60_000)

  it('releases the held insertion of the scene when the shelf is destroyed', async () => {
    const script = () => [...handed(),
      ['return', async () => { await back({ wait: false })(); await flush(1500) }],
      ['destroy the shelf', async () => { shelf.destroy(); await flush(20000) }]]
    await same(script, { config: { scene: { sourcePose: SOURCE_POSE, dockingPose: DOCKING_POSE, hold: true } } })
  }, 60_000)

  it('answers a book that is not on the shelf', async () => {
    const script = () => [
      ['lift', lift],
      ['return an unknown book', async () => { shelf.setReturningBook('missing'); state.log.push(`unknown ${show(await shelf.returnToShelf('missing', { pageSnapshot: pageSnapshot() }))}`) }],
      ['return with no reader origin', async () => { state.log.push(`no options ${show(await shelf.returnToShelf(ID))}`) }]]
    await same(script)
  }, 60_000)

  it('waits for the slot when the reader asks for the book before the shelf has laid itself out', async () => {
    const script = () => [['return at once', back()], ['return again', back()]]
    const text = await same(script, { early: true, extra: WAITING, config: { scene: { sourcePose: SOURCE_POSE, dockingPose: DOCKING_POSE } } })
    expect(text).toContain('returned true')
    await same(script, { early: true, extra: WAITING, config: { noView: true } })
  }, 60_000)

  it('gives up the slot when another book is held, when the shelf is closed, when it is asked twice, when the screen is resized and when it is destroyed', async () => {
    const asking = (label = 'slot') => {
      shelf.setReturningBook(ID)
      const promise = shelf.returnToShelf(ID, { pageSnapshot: pageSnapshot() })
      promise.then(result => state.log.push(`${label} ${show(result)}`), error => state.log.push(`${label} failed ${error?.message}`))
      return promise
    }
    const steps = [
      ['hold another book', async () => { const pending = asking(); shelf.setReturningBook('another'); await pending.catch(() => {}) }],
      ['close the shelf handle', async () => { const pending = asking(); shelf.close(); await pending.catch(() => {}) }],
      ['ask twice', async () => { const first = asking('first'); const second = asking('second'); await flush(300); await Promise.allSettled([first, second]) }],
      ['resize the screen', async () => { const pending = asking(); window.innerWidth += 40; window.dispatchEvent(new Event('resize')); await flush(300); await pending.catch(() => {}); window.innerWidth -= 40 }],
      ['let it settle', async () => { const pending = asking(); await flush(300); await pending.catch(() => {}) }]
    ]
    // Each of them is the first thing asked of a shelf that has not been laid out yet.
    for (const [name, step] of steps) {
      const text = await same(() => [[name, step]], { early: true, extra: WAITING, books: () => [book(), book({ id: 'another', title: 'Otro' })], config: { scene: { sourcePose: SOURCE_POSE, dockingPose: DOCKING_POSE } } })
      if (name !== 'let it settle' && name !== 'ask twice') expect(text).toContain('slot false')
    }
    const text = await same(() => [['destroy while waiting', async () => { const pending = asking(); shelf.destroy(); await flush(300); await pending.catch(() => {}) }]], { early: true, extra: WAITING })
    expect(text).toContain('slot false')
  }, 120_000)

  it('keeps the book away while a refresh arrives during the return', async () => {
    const script = () => [...handed(),
      ['return with a refresh in the middle', async () => {
        state.config.hold = true
        await back({ wait: false })()
        await flush(30)
        shelf.refresh([book({ title: 'Cambiado' })])
        await flush(30)
        state.config.hold = false
        await flush(20000)
      }]]
    const text = await same(script, { config: { scene: { sourcePose: SOURCE_POSE, dockingPose: DOCKING_POSE } } })
    expect(text).toContain('returned')
  }, 60_000)

  it('rejects a null set of options the way destructuring does', async () => {
    // The text of an engine's own TypeError is the engine's; its kind is what the screen guarantees.
    const script = () => [...handed(), ['null options', async () => { try { await shelf.returnToShelf(ID, null) } catch (error) { state.log.push(`threw ${error?.name}`) } }]]
    const text = await same(script)
    expect(text).toContain('threw TypeError')
  }, 60_000)

  // The one place where the port is deliberately not the original: when the pull-out itself fails, the original's
  // `close()` reaches `metaEntrance` before its declaration (a temporal dead zone) and throws, so the book stays
  // stranded on screen with its resting spine hidden. The port closes it. Both leave the failure of the pull-out
  // itself unhandled, as the browser would show it; the test takes those over from the runner and counts them.
  it('closes a book whose pull-out failed, where the original stranded it', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const runner = process.listeners('unhandledRejection')
    const seen = []
    process.removeAllListeners('unhandledRejection')
    process.on('unhandledRejection', reason => seen.push(String(reason?.message ?? reason)))
    const script = () => [
      ['lift, the pull-out fails', async () => { state.config.failNow = 'animate'; q('.ihr-spine').click(); await flush(100); state.config.failNow = null }],
      ['close', async () => { shelf.close(); await flush(100) }]]
    try {
      const original = await session(frozen, script)
      await new Promise(resolve => setImmediate(resolve))
      const fromOriginal = seen.splice(0)
      const ported = await session(production, script)
      await new Promise(resolve => setImmediate(resolve))
      const fromPort = seen.splice(0)
      const lastDocument = log => log.filter(line => line.startsWith('<div')).at(-1)
      expect(lastDocument(original)).toContain('class="ihr-flyout')
      expect(lastDocument(ported)).not.toContain('class="ihr-flyout')
      expect(fromOriginal).toContain('boom in animate')
      expect(fromOriginal.some(message => message.includes("'metaEntrance' before initialization"))).toBe(true)
      expect(fromPort).toEqual(['boom in animate'])
    } finally {
      process.removeAllListeners('unhandledRejection')
      for (const listener of runner) process.on('unhandledRejection', listener)
    }
  }, 60_000)
})
