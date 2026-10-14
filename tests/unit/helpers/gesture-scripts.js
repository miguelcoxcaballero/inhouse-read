import { vi } from 'vitest'
import { createWorld, prng } from './pointer-harness.js'

const KINDS = ['el', 'plain', 'plain', 'interactive', 'text']
const POINTERS = ['touch', 'touch', 'mouse', 'pen']

export function makeScript(seed, length) {
  const random = prng(seed)
  const choice = {
    zoom: random.chance(.5), native: random.chance(.3), nativeHandler: random.chance(.8), surface: random.chance(.65),
    surfaceMissing: random.chance(.15), tapZone: random.chance(.25), longPress: random.chance(.4), longHandler: random.chance(.85),
    manualPan: random.chance(.5), canSwipeFunction: random.chance(.6), chrome: random.chance(.9), next: random.chance(.95), prev: random.chance(.95),
    throwing: random.chance(.08), styleSeed: random.int(0, 2), noOptions: random.chance(.02)
  }
  const steps = []
  // Coherent gestures between the noise: taps, double taps, swipes, holds, pans and pinches.
  const base = () => ({ pointerType: random.pick(['touch', 'touch', 'touch', 'mouse', 'pen']), button: 0, at: random.pick(['el', 'el', 'el', 'plain', 'plain', 'text', 'interactive']), stamp: random.chance(.9) })
  const point = (kind, id, x, y, extra) => ({ kind, id, x, y, ...extra })
  const macro = () => {
    const extra = base(), x = random.pick([20, 70, 200, 200, 330, 380]), y = random.pick([180, 200, 260]), id = random.pick([1, 1, 2])
    const gap = random.pick([8, 16, 16, 40, 110, 250])
    switch (random.int(0, 9)) {
      case 0: case 1: steps.push(point('down', id, x, y, extra), { kind: 'time', ms: gap }, point('up', id, x, y, extra)); break
      case 2: steps.push(point('down', id, 200, y, extra), { kind: 'time', ms: 30 }, point('up', id, 200, y, extra), { kind: 'time', ms: random.pick([60, 150, 290, 350]) },
        point('down', id, 200 + random.pick([0, 4, 40]), y, extra), { kind: 'time', ms: 30 }, point('up', id, 200, y, extra), { kind: 'time', ms: random.pick([10, 310, 700]) }); break
      case 3: case 4: {
        const direction = random.pick([-1, 1]), steps_ = random.int(2, 6), travel = random.pick([12, 30, 60, 90, 140])
        steps.push(point('down', id, 200, y, extra))
        for (let move = 1; move <= steps_; move++) steps.push({ kind: 'frame', ms: random.pick([4, 8, 16]) }, point('move', id, 200 + direction * travel * move / steps_, y + random.pick([0, 2, -3]), extra))
        steps.push({ kind: 'frame', ms: 16 }, point('up', id, 200 + direction * travel, y, extra), { kind: 'frame', ms: 16 }, { kind: 'frame', ms: 120 }, { kind: 'frame', ms: 900 }); break
      }
      case 5: steps.push(point('down', id, x, y, extra), { kind: 'time', ms: random.pick([480, 510, 700]) }, point('up', id, x, y, extra), { kind: 'time', ms: 400 }); break
      case 6: steps.push(point('down', id, 200, 300, extra), point('move', id, 203, 300 - random.pick([12, 40, 90]), extra), point('move', id, 205, 200, extra), { kind: 'time', ms: random.pick([100, 600]) }, point('up', id, 205, 200, extra)); break
      case 7: steps.push(point('down', 1, 100, 200, extra), point('down', 2, 250, 200, extra), point('move', 1, 40, 200, extra), point('up', 1, 40, 200, extra), point('up', 2, 300, 200, extra),
        point('down', 1, 200, 200, extra), { kind: 'time', ms: 50 }, point('up', 1, 200, 200, extra), { kind: 'time', ms: 400 }); break
      case 8: steps.push({ kind: 'tstart', touches: 1, x: 300, y: 200, at: 'el' }, point('down', id, 300, 200, extra), { kind: 'tmove', touches: 1, x: 300 - random.pick([10, 30, 90]), y: 200, at: 'el' },
        { kind: 'tmove', touches: 1, x: 150, y: 200, at: 'el' }, point('up', id, 200, 200, extra), { kind: 'tend', touches: 0, x: 0, y: 0, at: 'el' }); break
      default: steps.push(point('down', id, x, y, extra), { kind: 'scroll', top: random.pick([0, 4, 50]), left: 0 }, { kind: 'time', ms: gap }, point('up', id, x, y, extra), { kind: 'scroll', top: 0, left: 0 })
    }
  }
  let id = 1
  for (let index = 0; index < length; index++) {
    if (random.chance(.45)) { macro(); continue }
    const roll = random()
    const common = () => ({ id: random.pick([1, 1, 1, 2, 3]), x: random.pick([30, 120, 200, 200, 260, 380, random.int(0, 400)]),
      y: random.pick([200, 200, 240, random.int(100, 400)]), pointerType: random.pick(POINTERS),
      button: random.pick([0, 0, 0, 0, 2, undefined, null]), at: random.pick(KINDS), stamp: random.chance(.9) })
    if (roll < .2) steps.push({ kind: 'down', ...common() })
    else if (roll < .42) steps.push({ kind: 'move', ...common() })
    else if (roll < .6) steps.push({ kind: 'up', ...common() })
    else if (roll < .64) steps.push({ kind: 'cancel', ...common() })
    else if (roll < .68) steps.push({ kind: 'lost', ...common() })
    else if (roll < .78) steps.push({ kind: 'time', ms: random.pick([1, 5, 16, 16, 32, 100, 250, 300, 301, 450, 520, 700, 2000]) })
    else if (roll < .84) steps.push({ kind: 'frame', ms: random.pick([0, 8, 16, 33, 120, 600]) })
    else if (roll < .87) steps.push({ kind: 'scroll', top: random.pick([0, 0, 1, 3, 40]), left: random.pick([0, 0, 2, 5]) })
    else if (roll < .89) steps.push({ kind: 'select', on: random.chance(.5) })
    else if (roll < .91) steps.push({ kind: 'flag', name: random.pick(['reduced', 'canSwipe', 'canLong', 'hidden']), on: random.chance(.5) })
    else if (roll < .95) steps.push({ kind: random.pick(['tstart', 'tmove', 'tmove', 'tend']), touches: random.int(0, 2), x: random.int(0, 400), y: random.int(0, 400), at: random.pick(KINDS) })
    else if (roll < .965) steps.push({ kind: 'blur' })
    else if (roll < .975) steps.push({ kind: 'visibility' })
    else if (roll < .99) steps.push({ kind: 'context', at: random.pick(KINDS) })
    else if (!steps.some(step => step.kind === 'detach')) steps.push({ kind: 'detach' })
    id++
  }
  steps.push({ kind: 'time', ms: 1000 }, { kind: 'frame', ms: 16 }, { kind: 'frame', ms: 16 })
  if (!steps.some(step => step.kind === 'detach')) steps.push({ kind: 'detach' })
  steps.push({ kind: 'time', ms: 1000 }, { kind: 'down', id: 1, x: 200, y: 200, pointerType: 'touch', button: 0, at: 'el', stamp: true })
  return { choice, steps }
}

export function play(api, { choice, steps }) {
  const world = createWorld()
  const flags = { reduced: false, canSwipe: true, canLong: true, hidden: false, selection: '' }
  const styleSeeds = [{ userSelect: '', webkitUserSelect: '' }, { userSelect: 'auto', webkitUserSelect: 'text' }, { userSelect: undefined, webkitUserSelect: undefined }]
  const view = world.listenable('window', { matchMedia(query) { world.note('matchMedia', query); return { matches: flags.reduced } } })
  const pages = world.target('surface')
  pages.style = world.styleFor('surface', { transform: choice.styleSeed === 1 ? 'scale(1)' : '', willChange: choice.styleSeed === 1 ? 'opacity' : '' })
  const root = world.target('root')
  const doc = world.listenable('document', {
    getSelection() { world.note('getSelection'); return { toString() { world.note('selection.toString'); return flags.selection } } },
    documentElement: root, defaultView: view,
    get hidden() { world.note('hidden'); return flags.hidden }
  })
  const captured = new Set()
  const el = world.listenable('el', {
    ownerDocument: doc, scrollLeft: 0, scrollTop: 0,
    style: world.styleFor('el', styleSeeds[choice.styleSeed]),
    getBoundingClientRect() { world.note('rect'); return { left: 0, top: 0, width: 400, height: 700 } },
    setPointerCapture(id) { world.note('setPointerCapture', id); if (id === 3) throw new Error('capture refused'); captured.add(id) },
    hasPointerCapture(id) { world.note('hasPointerCapture', id); return captured.has(id) },
    releasePointerCapture(id) { world.note('releasePointerCapture', id); captured.delete(id) }
  })
  const kinds = {
    el, root,
    plain: world.target('plain'),
    interactive: world.target('interactive', [/button/]),
    text: world.target('text', [/pdf-text-layer/])
  }
  const throwing = name => choice.throwing && name === 'onNext'
  const callback = (name, result) => (...args) => {
    world.note(name, ...args)
    if (throwing(name)) throw new Error('boom')
    return typeof result === 'function' ? result() : result
  }
  const options = {}
  if (choice.next) options.onNext = callback('onNext')
  if (choice.prev) options.onPrev = callback('onPrev')
  if (choice.chrome) options.onToggleChrome = callback('onToggleChrome')
  if (choice.zoom) options.onToggleZoom = callback('onToggleZoom')
  if (choice.canSwipeFunction) options.canSwipe = () => { world.note('canSwipe'); return flags.canSwipe }
  if (choice.native) { options.nativeTouchSwipes = true; if (choice.nativeHandler) options.onNativeSwipe = callback('onNativeSwipe') }
  if (choice.surface) options.getMotionSurface = () => { world.note('getMotionSurface'); return choice.surfaceMissing ? null : pages }
  if (choice.tapZone) {
    let turn = 0
    options.tapZone = event => { world.note('tapZone', event); return ['prev', 'next', 'center', undefined, null, 'weird'][turn++ % 6] }
  }
  if (choice.longPress) {
    options.canLongPress = event => { world.note('canLongPress', event); return flags.canLong }
    if (choice.longHandler) options.onLongPress = callback('onLongPress')
  }
  if (choice.manualPan) options.onManualPan = callback('onManualPan')
  let detach
  try { detach = choice.noOptions ? api.attachSwipeNavigation(el) : api.attachSwipeNavigation(el, options) }
  catch (error) { world.note('attach threw', error?.message); return world.log }
  const snapshot = () => world.note('state', el.style.userSelect, el.style.webkitUserSelect, pages.style.transform, pages.style.willChange, world.pendingTimers, world.pendingFrames, world.listenerCount)
  let detached = false
  const stamp = step => step.stamp ? world.now : undefined
  for (const step of steps) {
    const at = kinds[step.at]
    switch (step.kind) {
      case 'down': case 'move': case 'up': case 'cancel': case 'lost': {
        const type = { down: 'pointerdown', move: 'pointermove', up: 'pointerup', cancel: 'pointercancel', lost: 'lostpointercapture' }[step.kind]
        world.now += step.kind === 'move' ? 4 : 11
        world.fire('el', type, world.event(type, { pointerId: step.id, clientX: step.x, clientY: step.y, pointerType: step.pointerType, button: step.button, timeStamp: stamp(step) }, step.kind === 'lost' && step.id === 1 ? el : at))
        break
      }
      case 'time': world.advance(step.ms); break
      case 'frame': world.now += step.ms; world.frame(); break
      case 'scroll': el.scrollTop = step.top; el.scrollLeft = step.left; break
      case 'select': flags.selection = step.on ? 'words' : ''; break
      case 'flag': if (step.name === 'reduced') flags.reduced = step.on; else if (step.name === 'canSwipe') flags.canSwipe = step.on; else if (step.name === 'canLong') flags.canLong = step.on; else flags.hidden = step.on; break
      case 'tstart': case 'tmove': case 'tend': {
        const type = { tstart: 'touchstart', tmove: 'touchmove', tend: 'touchend' }[step.kind]
        const touches = Array.from({ length: step.touches }, (_, index) => ({ clientX: step.x + index * 9, clientY: step.y }))
        world.fire('el', type, world.event(type, { touches }, at))
        break
      }
      case 'blur': world.fire('window', 'blur', world.event('blur')); break
      case 'visibility': world.fire('document', 'visibilitychange', world.event('visibilitychange')); break
      case 'context': world.fire('el', 'contextmenu', world.event('contextmenu', {}, at)); break
      case 'detach': if (!detached) { detached = true; try { detach() } catch (error) { world.note('detach threw', error?.message) } } break
    }
    snapshot()
  }
  // A timer the original forgot to cancel still fires after the controller is gone.
  world.advance(60000); world.frame(); snapshot()
  return world.log
}

