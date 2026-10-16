import { writeShelfDifference } from './helpers/shelf-differential.js'
/**
 * Moving things around the shelf, against the frozen JavaScript original (helpers/reference-bookshelf.js): the hold
 * that lifts a book, plant or lamp, the drag with its preview and its scroll, the release (a new place, a new order,
 * the bin), the keyboard (Shift with the arrows, Delete), the touch rules (a tap, a scroll, a second finger and the
 * click that follows), the lamp switch, the plants and lamps added from the catalogue, and the removal of a book with
 * a storage that fails. Both play the same script on the same doubles; every call on the host, every callback, the
 * saved settings and the whole document after each step must be identical.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderBookshelf as production } from '../../src/js/bookshelf.js'
import { renderBookshelf as frozen } from './helpers/reference-bookshelf.js'
import { analyzeCoverRelief } from '../../src/js/cover-relief.js'
import { captureUnhandled, firstDifference, flush, keydown, q, qa, show, snapshot, stubRects } from './helpers/shelf-differential.js'
import { LAMP_CATALOG } from '../../src/js/lamp-catalog-data.js'
import { PLANT_CATALOG, POT_CATALOG } from '../../src/js/plant-catalog-data.js'

const state = vi.hoisted(() => ({ log: [], config: {}, catalog: null, hit: null }))

vi.mock('../../src/js/book-model.js', async () => {
  const helper = await import('./helpers/shelf-differential.js')
  return {
    getBookRenderer: () => state.config.scene ? {} : null,
    planReadingBookPose: () => ({ x: 0, y: 0, scale: 1, angle: 0, pitch: 0, coverOpen: 1 }),
    fitCoverImage: (w, h) => ({ x: 0, y: 0, width: w, height: h }),
    bookView(host, book, style, dimensions) { return helper.recordingView(state.log, host, book, style, dimensions) }
  }
})
vi.mock('../../src/js/bookshelf-scene.js', async () => {
  const helper = await import('./helpers/shelf-differential.js')
  const answers = {
    getObjectAtPoint: () => state.hit, getBookAtPoint: () => state.hit, getDropPosition: () => state.config.drop, hitTrash: () => Boolean(state.config.overTrash),
    animateObjectToTrash: () => state.config.trashMotion?.(), animateBookToTrash: () => state.config.trashMotion?.(), getInspectionZoom: () => 1
  }
  return { createBookshelfScene: () => helper.recordingScene(state.log, { answers, sourcePose: { scale: 1, height: 160, thickness: 28, centerX: 34, centerY: 180, angle: 90, pitch: 0, roll: 0 } }) }
})
vi.mock('../../src/js/plant-catalog-lazy.js', () => ({
  createLazyPlantCatalog: options => { state.catalog = options; return { prefetch() {}, prepare() {}, open() {}, setShelfType() {}, destroy() {}, close() {} } }
}))
vi.mock('../../src/js/cover-relief.js', async importOriginal => ({ ...await importOriginal(), analyzeCoverRelief: vi.fn(), buildReliefMaps: vi.fn() }))
vi.mock('../../src/js/cover-appearance.js', async importOriginal => ({
  ...await importOriginal(), readCoverAspectRatio: vi.fn(async () => 0.66), analyzeCoverAppearance: vi.fn(async () => null)
}))

const PLANT = PLANT_CATALOG[0], POT = POT_CATALOG[0], LAMP = LAMP_CATALOG[0]
const originalAnimate = Object.getOwnPropertyDescriptor(Element.prototype, 'animate')
let container, shelf, restoreRects, uuid
beforeEach(() => {
  state.log.length = 0; state.config = {}; state.catalog = null; state.hit = null; uuid = 0
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'requestAnimationFrame', 'cancelAnimationFrame', 'performance', 'Date'] })
  localStorage.clear()
  restoreRects = stubRects({ layout: true })
  vi.stubGlobal('WebGLRenderingContext', class {})
  vi.stubGlobal('matchMedia', query => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} }))
  vi.stubGlobal('crypto', { randomUUID: () => `uuid-${++uuid}` })
  // The Web Animations the bin flight uses: they finish on their own clock and can be cancelled.
  Object.defineProperty(Element.prototype, 'animate', { configurable: true, value(frames, timing) {
    state.log.push(`animate(${show(frames)},${show(timing)})`)
    let finish
    const finished = new Promise(resolve => { finish = resolve })
    const timer = setTimeout(() => finish(true), timing.duration)
    return { finished, cancel() { state.log.push('animation.cancel'); clearTimeout(timer); finish(false) } }
  } })
  vi.mocked(analyzeCoverRelief).mockReset()
  vi.mocked(analyzeCoverRelief).mockImplementation(async () => ({ proposals: [], analysis: {} }))
})
afterEach(() => {
  shelf?.destroy(); shelf = null
  container?.remove(); container = null
  document.body.innerHTML = ''
  restoreRects()
  if (originalAnimate) Object.defineProperty(Element.prototype, 'animate', originalAnimate); else delete Element.prototype.animate
  vi.restoreAllMocks()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

const logged = (name, fn) => (...args) => { state.log.push(`${name}(${args.map(arg => show(arg)).join(',')})`); return fn?.(...args) }
const book = (id, extra = {}) => ({ id, title: `Libro ${id}`, author: 'Autora', format: 'PDF', sourceType: 'local', addedAt: 1, lastOpenedAt: 1, progressFraction: 0.2, ...extra })
const books = () => [book('a'), book('b'), book('c')]
const pointer = (node, type, init = {}) => {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.assign(event, { button: 0, pointerId: 1, pointerType: 'mouse', isPrimary: true, clientX: 30, clientY: 120, detail: 0, ...init })
  node.dispatchEvent(event)
  return event
}
const click = (node, init = {}) => {
  const event = new Event('click', { bubbles: true, cancelable: true })
  Object.assign(event, { detail: 1, pointerType: 'touch', clientX: 30, clientY: 120, ...init })
  node.dispatchEvent(event)
}
const key = (node, name, init = {}) => keydown(node, name, init)
const spine = index => qa('.ihr-spine')[index], plant = index => qa('.ihr-plant')[index], lamp = index => qa('.ihr-lamp')[index]
const add = async (request = { catalogId: PLANT.id, potId: POT.id }) => { await state.catalog.onAdd(request, { whenClosed: run => run() }); await flush(700) }
const addLamp = async (request = { lampId: LAMP.id }) => { await state.catalog.onAddLamp(request, { whenClosed: run => run() }); await flush(700) }
/** Hold, move and release, as a finger or the mouse would. */
const drag = async (node, points, { pointerType = 'mouse', hold = 500, id = 1, release = true } = {}) => {
  const [first, ...rest] = points
  state.hit = node
  pointer(node, 'pointerdown', { pointerType, pointerId: id, clientX: first[0], clientY: first[1] })
  await flush(hold)
  for (const [x, y] of rest) { pointer(node, 'pointermove', { pointerType, pointerId: id, clientX: x, clientY: y }); await flush(40) }
  const last = rest.at(-1) ?? first
  state.log.push(`held ${node.className} ${node.style.cssText}`)
  if (release) pointer(node, 'pointerup', { pointerType, pointerId: id, clientX: last[0], clientY: last[1] })
}

async function play(steps, settle = 200) {
  for (const [name, step] of steps) {
    state.log.push(`## ${name}`)
    try { await step() } catch (error) { // The wording of an engine's own TypeError is the engine's; its kind is what the shelf guarantees.
      state.log.push(`!! ${name} threw ${error?.name}: ${error instanceof TypeError ? '' : error?.message}`) }
    await flush(settle)
    state.log.push(snapshot())
    // The clock of a run starts where the machine's does: only the shape of a timestamp is compared.
    state.log.push(`storage ${JSON.stringify(Object.fromEntries(Object.keys(localStorage).sort().map(name => [name, localStorage.getItem(name)]))).replace(/\d{13}/g, 'T')}`)
  }
}

async function session(render, script, { list = books, extra = {}, config = {} } = {}) {
  document.body.innerHTML = ''; state.log.length = 0; state.hit = null; uuid = 0; state.config = { ...config }; localStorage.clear()
  container = document.createElement('div')
  document.body.append(container)
  const options = { shelfWidth: 390, sections: false, revealDuration: 0, holdMs: 0, autoOpen: true, coverSrcFor: () => 'blob:cover', ...extra }
  for (const name of ['onBookCustomizationChange', 'onBookDismiss', 'onPrepareBook', 'onBookOrderChange', 'onShelfPlacementChange', 'onOpenBook']) {
    options[name] ??= (...args) => { state.log.push(`${name}(${args.map(arg => show(arg)).join(',')})`); return Promise.resolve() }
  }
  shelf = render(container, list(), options)
  await flush(10)
  await play(script())
  shelf.destroy(); shelf = null
  return [...state.log]
}

async function same(script, settings = {}) {
  const original = captureUnhandled()
  const expected = await session(frozen, script, settings)
  const leftByOriginal = await original.stop()
  container?.remove(); document.body.innerHTML = ''
  const port = captureUnhandled()
  const actual = await session(production, script, settings)
  // What the original leaves unhandled (a rejection nobody awaits) is left unhandled by the port, and nothing more.
  expect(await port.stop()).toEqual(leftByOriginal)
  const difference = firstDifference(expected, actual)
  if (difference) await writeShelfDifference('objects', expected, actual)
  if (process.env.SHELF_DUMP) (await import('node:fs')).writeFileSync(`${process.env.SHELF_DUMP}/objects-${expect.getState().currentTestName.replace(/\W+/g, '-').slice(-80)}-${Date.now() % 100000}.txt`, expected.join('\n'))
  expect(difference).toBeNull()
  return expected.join('\n')
}

describe('moving things on the shelf against the frozen original', () => {
  it('drags a book, a plant and a lamp to new places on the plain shelf', async () => {
    const script = () => [
      ['add a plant and a lamp', async () => { await add(); await addLamp() }],
      ['drag the first book to the second shelf', () => drag(spine(0), [[30, 120], [60, 200], [200, 330]])],
      ['let the shelf settle', async () => { await flush(1000) }],
      ['drag the plant', () => drag(plant(0), [[30, 120], [90, 150], [150, 100]])],
      ['let the shelf settle', async () => { await flush(1000) }],
      ['drag the lamp', () => drag(lamp(0), [[30, 120], [120, 260], [300, 90]])],
      ['let the shelf settle', async () => { await flush(1000) }],
      ['a hold that never moves', () => drag(spine(1), [[30, 120]])],
      ['a short move is a tap, not a drag', () => drag(spine(2), [[30, 120], [31, 121]], { hold: 100 })]
    ]
    const text = await same(script)
    expect(text).toContain('onShelfPlacementChange({books:[{id:'); expect(text).toContain('is-dragging')
  }, 90_000)

  it('drags with the scene: the hit, the drop position and the preview come from the scene', async () => {
    const script = () => [
      ['add a plant and a lamp', async () => { await add(); await addLamp() }],
      ['drag a book', async () => { state.config.drop = { shelf: 1, x: 0.4 }; await drag(spine(0), [[30, 120], [60, 200], [200, 330]]) }],
      ['settle', async () => { await flush(1000) }],
      ['drag the lamp onto the same spot', async () => { state.config.drop = { shelf: 0, x: 0.1 }; await drag(lamp(0), [[30, 120], [100, 260]]) }],
      ['settle', async () => { await flush(1000) }],
      ['a press on empty space', async () => { state.hit = null; pointer(spine(1), 'pointerdown', { pointerType: 'touch' }); await flush(600); pointer(spine(1), 'pointerup', { pointerType: 'touch' }) }],
      ['a press whose hit is another object', async () => { state.hit = lamp(0); pointer(spine(1), 'pointerdown', { pointerType: 'touch' }); await flush(100); pointer(spine(1), 'pointerup', { pointerType: 'touch' }) }]
    ]
    const text = await same(script, { config: { scene: true } })
    expect(text).toContain('scene.setDropPosition'); expect(text).toContain('scene.previewPlacements')
  }, 90_000)

  it('reorders spines inside a section by dragging and with the keyboard', async () => {
    const script = () => [
      ['drag the first over the third', async () => {
        document.elementFromPoint = () => spine(2)
        await drag(spine(0), [[30, 120], [60, 130], [100, 130]])
      }],
      ['settle', async () => { await flush(1000) }],
      ['drag with nothing under the finger', async () => { document.elementFromPoint = () => null; await drag(spine(1), [[30, 120], [40, 126]]) }],
      ['settle', async () => { await flush(1000) }],
      ['Shift+ArrowRight', () => key(spine(0), 'ArrowRight', { shiftKey: true })],
      ['Shift+ArrowLeft', () => key(spine(1), 'ArrowLeft', { shiftKey: true })],
      ['Shift+ArrowLeft at the start', () => key(spine(0), 'ArrowLeft', { shiftKey: true })]
    ]
    const text = await same(script, { extra: { sections: true } })
    expect(text).toContain('onBookOrderChange')
    delete document.elementFromPoint
  }, 90_000)

  it('moves objects by keyboard and removes them with Delete, with or without storage for books', async () => {
    const script = () => [
      ['add a plant and a lamp', async () => { await add(); await addLamp() }],
      ['a book one step right', () => key(spine(0), 'ArrowRight', { shiftKey: true })],
      ['a book one shelf down', () => key(spine(0), 'ArrowDown', { shiftKey: true })],
      ['a plant left and up', () => { key(plant(0), 'ArrowLeft', { shiftKey: true }); key(plant(0), 'ArrowUp', { shiftKey: true }) }],
      ['a lamp right', () => key(lamp(0), 'ArrowRight', { shiftKey: true })],
      ['an arrow without shift', () => key(spine(0), 'ArrowRight')],
      ['delete the plant', async () => { key(plant(0), 'Delete'); await flush(1200) }],
      ['delete the lamp', async () => { key(lamp(0), 'Delete'); await flush(1200) }],
      ['delete a book', async () => { key(spine(1), 'Delete'); await flush(1200) }],
      ['delete a repeated key', async () => { key(spine(0), 'Delete', { repeat: true }); await flush(1200) }]
    ]
    for (const onBookRemove of [undefined, logged('onBookRemove', () => Promise.resolve()), logged('onBookRemove', () => Promise.reject(new Error('disk full'))), logged('onBookRemove', () => { throw new Error('sync failure') })]) {
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      const text = await same(script, { extra: onBookRemove ? { onBookRemove } : {} })
      if (onBookRemove) expect(text).toContain('onBookRemove(')
    }
  }, 120_000)

  it('flies a dragged object to the bin: with the scene, without it, and when the removal is refused', async () => {
    const script = () => [
      ['add a plant and a lamp', async () => { await add(); await addLamp() }],
      ['drag the plant to the bin', async () => { state.config.overTrash = true; await drag(plant(0), [[30, 120], [200, 400], [330, 720]]); await flush(1500) }],
      ['drag the lamp to the bin', async () => { await drag(lamp(0), [[30, 120], [330, 720]]); await flush(1500) }],
      ['drag a book to the bin', async () => { await drag(spine(0), [[30, 120], [200, 400], [330, 720]]); await flush(1500) }],
      ['drag a book away from the bin', async () => { state.config.overTrash = false; await drag(spine(0), [[30, 120], [330, 720], [100, 200]]); await flush(1000) }]
    ]
    for (const scene of [false, true]) {
      const config = { scene, trashMotion: () => ({ finished: new Promise(resolve => setTimeout(() => resolve(true), 600)), cancel() { state.log.push('trashMotion.cancel') } }) }
      for (const onBookRemove of [logged('onBookRemove', () => Promise.resolve()), logged('onBookRemove', () => Promise.reject(new Error('disk full')))]) {
        vi.spyOn(console, 'warn').mockImplementation(() => {})
        const text = await same(script, { extra: { viewMode: 'isometric', onBookRemove }, config })
        expect(text).toContain('onBookRemove(')
      }
    }
  }, 180_000)

  it('cancels a removal in flight when the screen is resized and when the shelf is destroyed', async () => {
    const script = () => [
      ['add a plant', async () => { await add() }],
      ['delete the plant and resize', async () => { key(plant(0), 'Delete'); await flush(100); window.dispatchEvent(new Event('resize')); await flush(1200) }],
      ['delete a book', async () => { key(spine(0), 'Delete'); await flush(100) }],
      ['destroy while it flies', async () => { shelf.destroy(); await flush(1500) }]
    ]
    await same(script, { extra: { viewMode: 'isometric', onBookRemove: logged('onBookRemove', () => Promise.resolve()) } })
  }, 90_000)

  it('follows the touch rules: a tap, a scroll, a second finger, a long hold and the click that follows', async () => {
    const script = () => [
      ['a touch tap opens the book', async () => { state.hit = spine(0); pointer(spine(0), 'pointerdown', { pointerType: 'touch' }); await flush(50); pointer(spine(0), 'pointerup', { pointerType: 'touch' }) }],
      ['its compatibility click is swallowed', () => click(document.body)],
      ['close', async () => { key(document.body, 'Escape'); await flush(1000) }],
      ['a touch tap, then a key press ends the guard', async () => { pointer(spine(1), 'pointerdown', { pointerType: 'touch' }); await flush(50); pointer(spine(1), 'pointerup', { pointerType: 'touch' }); key(document.body, 'a') }],
      ['close', async () => { key(document.body, 'Escape'); await flush(1000) }],
      ['a vertical touch move scrolls', async () => {
        pointer(spine(0), 'pointerdown', { pointerType: 'touch' }); await flush(50)
        const event = pointer(spine(0), 'pointermove', { pointerType: 'touch', clientY: 200 }); state.log.push(`prevented ${event.defaultPrevented}`)
        pointer(spine(0), 'pointerup', { pointerType: 'touch', clientY: 200 }); await flush(10)
      }],
      ['a second finger cancels the hold', async () => {
        pointer(spine(1), 'pointerdown', { pointerType: 'touch' }); pointer(spine(1), 'pointerdown', { pointerType: 'touch', pointerId: 2, isPrimary: false })
        await flush(600); pointer(spine(1), 'pointerup', { pointerType: 'touch' }); pointer(spine(1), 'pointerup', { pointerType: 'touch', pointerId: 2 })
      }],
      ['a pointer cancel', async () => { pointer(spine(2), 'pointerdown', { pointerType: 'touch' }); await flush(600); pointer(spine(2), 'pointercancel', { pointerType: 'touch' }) }],
      ['a pen click', () => click(spine(2), { pointerType: 'pen' })],
      ['a keyboard click', () => click(spine(2), { detail: 0, pointerType: undefined })],
      ['a mouse button other than the first', () => pointer(spine(0), 'pointerdown', { button: 2 })]
    ]
    for (const scene of [false, true]) {
      const text = await same(script, { config: { scene } })
      expect(text).toContain('onPrepareBook')
    }
  }, 120_000)

  it('switches a lamp by click, by touch tap and from the keyboard, and reports a failed save', async () => {
    const script = () => [
      ['add a lamp', async () => { await addLamp() }],
      ['click the lamp', () => click(lamp(0), { detail: 0, pointerType: undefined })],
      ['a pointer click', () => click(lamp(0), { detail: 1, pointerType: 'mouse' })],
      ['a touch tap', async () => { state.hit = lamp(0); pointer(lamp(0), 'pointerdown', { pointerType: 'touch' }); await flush(40); pointer(lamp(0), 'pointerup', { pointerType: 'touch' }) }],
      ['Enter', () => key(lamp(0), 'Enter')],
      ['a failing save', () => {
        const stored = Storage.prototype.setItem
        Storage.prototype.setItem = () => { throw new Error('quota') }
        try { click(lamp(0), { detail: 0, pointerType: undefined }) } finally { Storage.prototype.setItem = stored }
      }],
      ['a drag on the lamp is not a switch', async () => { await drag(lamp(0), [[30, 120], [80, 200]]); await flush(900); click(lamp(0)) }],
      ['a busy shelf ignores the switch', () => { shelf.setReturningBook('a'); click(lamp(0), { detail: 0, pointerType: undefined }) }]
    ]
    for (const scene of [false, true]) {
      const text = await same(script, { config: { scene } })
      expect(text).toContain('data-lamp-on')
    }
  }, 120_000)

  it('adds plants and lamps from the catalogue: busy, unknown, saved late and not saved', async () => {
    const script = () => [
      ['a plant', async () => { await add() }],
      ['a plant whose closing is deferred', async () => {
        let run; await state.catalog.onAdd({ catalogId: PLANT.id, potId: POT.id }, { whenClosed: job => { run = job } }); state.log.push('deferred'); await flush(100); run()
      }],
      ['a plant with no options', async () => { await state.catalog.onAdd({ catalogId: PLANT.id, potId: POT.id }) }],
      ['an unknown plant', async () => { await state.catalog.onAdd({ catalogId: 'nope', potId: POT.id }) }],
      ['an unknown pot', async () => { await state.catalog.onAdd({ catalogId: PLANT.id, potId: 'nope' }) }],
      ['no request', async () => { await state.catalog.onAdd() }],
      ['a lamp', async () => { await addLamp() }],
      ['an unknown lamp', async () => { await state.catalog.onAddLamp({ lampId: 'nope' }) }],
      ['a lamp that cannot be saved', async () => {
        const stored = Storage.prototype.setItem
        Storage.prototype.setItem = () => { throw new Error('quota') }
        try { await state.catalog.onAddLamp({ lampId: LAMP.id }) } finally { Storage.prototype.setItem = stored }
      }],
      ['a plant that cannot be saved', async () => {
        const stored = Storage.prototype.setItem
        Storage.prototype.setItem = () => { throw new Error('quota') }
        try { await state.catalog.onAdd({ catalogId: PLANT.id, potId: POT.id }) } finally { Storage.prototype.setItem = stored }
      }],
      ['a plant while a book is open', async () => { document.querySelector('.ihr-spine').click(); await flush(100); await state.catalog.onAdd({ catalogId: PLANT.id, potId: POT.id }) }],
      ['close', async () => { key(document.body, 'Escape'); await flush(1000) }],
      ['a lamp after the shelf is gone', async () => { shelf.destroy(); await state.catalog.onAddLamp({ lampId: LAMP.id }) }]
    ]
    for (const scene of [false, true]) {
      const text = await same(script, { config: { scene } })
      expect(text).toContain('data-last-added-plant'); expect(text).toContain('threw')
    }
  }, 120_000)

  it('cancels a drag when the screen is resized, when a gesture starts and when the shelf is destroyed', async () => {
    const script = () => [
      ['add a lamp', async () => { await addLamp() }],
      ['start a drag and resize', async () => { await drag(spine(0), [[30, 120], [90, 200]], { release: false }); window.dispatchEvent(new Event('resize')); await flush(300) }],
      ['start a drag and destroy', async () => { await drag(lamp(0), [[30, 120], [90, 200]], { release: false }); shelf.destroy(); await flush(300) }]
    ]
    await same(script)
  }, 90_000)
})
