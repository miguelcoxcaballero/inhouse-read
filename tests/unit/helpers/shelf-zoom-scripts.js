import { vi } from 'vitest'
import { createWorld, prng, show } from './pointer-harness.js'

const clamp = (value, low, high) => Math.max(low, Math.min(high, value))

export function makeZoomScript(seed, length) {
  const random = prng(seed)
  const choice = {
    zoom: random.pick([1, 1, 1.5, 2, 3, 4]), width: random.pick([200, 390, 800]), height: random.pick([300, 800]),
    centerX: random.pick([100, 195, 400]), centerY: random.pick([150, 422]), clampOnRest: random.chance(.6),
    reduced: random.chance(.2), extra: random.chance(.5), objectAt: random.chance(.15), throwOnStart: random.chance(.03),
    enabled: random.chance(.9), sceneMissing: random.chance(.05)
  }
  const steps = []
  const target = () => random.pick(['plain', 'plain', 'plain', 'plain', 'switch', 'catalog'])
  const frames = (count, ms = 16) => { for (let index = 0; index < count; index++) steps.push({ kind: 'frame', ms }) }
  const macro = () => {
    const a = random.pick([1, 1, 7]), b = random.pick([2, 2, 9])
    const x = random.int(60, 330), y = random.int(150, 650)
    switch (random.int(0, 8)) {
      case 0: case 1: { // pinch
        const spread = random.pick([40, 90, 160]), grow = random.pick([-60, 40, 120, 300, 700])
        steps.push({ kind: 'down', id: a, x: x - spread / 2, y, at: target() }, { kind: 'down', id: b, x: x + spread / 2, y, at: 'plain' })
        for (let move = 1; move <= random.int(1, 5); move++) steps.push({ kind: 'time', ms: random.pick([4, 8, 16]) }, { kind: 'move', id: b, x: x + spread / 2 + grow * move / 3, y: y + random.pick([0, 5, -9]), at: 'plain' })
        frames(random.int(0, 2))
        steps.push({ kind: 'time', ms: random.pick([5, 30, 90]) }, { kind: random.pick(['up', 'up', 'cancel']), id: random.pick([a, b]), x, y, at: 'plain' })
        if (random.chance(.7)) steps.push({ kind: 'move', id: a, x: x + random.pick([0, 25, 90]), y: y + random.pick([0, 30, -40]), at: 'plain' }, { kind: 'frame', ms: 16 })
        steps.push({ kind: 'time', ms: random.pick([3, 20, 100]) }, { kind: random.pick(['up', 'cancel']), id: random.pick([a, b]), x, y, at: 'plain' })
        steps.push({ kind: 'click', at: target() })
        frames(random.int(0, 30)); break
      }
      case 2: case 3: case 4: { // pan then flick
        steps.push({ kind: 'down', id: a, x, y, at: target() })
        const dx = random.pick([0, 30, 90, 260, 600]), dy = random.pick([0, 20, 140, -200])
        for (let move = 1; move <= random.int(1, 6); move++) steps.push({ kind: 'time', ms: random.pick([4, 8, 16, 30]) }, { kind: 'move', id: a, x: x + dx * move / 3, y: y + dy * move / 3, at: 'plain' }, { kind: 'frame', ms: random.pick([0, 8, 16]) })
        steps.push({ kind: 'time', ms: random.pick([2, 10, 70, 200]) }, { kind: random.pick(['up', 'up', 'up', 'cancel']), id: a, x: x + dx, y: y + dy, at: 'plain' })
        frames(random.int(0, 60), random.pick([8, 16, 33])); break
      }
      case 5: steps.push({ kind: 'down', id: a, x, y, at: 'plain', pointerType: 'mouse' }, { kind: 'move', id: a, x: x + 40, y, at: 'plain', pointerType: 'mouse' }, { kind: 'up', id: a, x: x + 40, y, at: 'plain', pointerType: 'mouse' }); break
      case 6: steps.push({ kind: 'sync' }, { kind: 'flag', name: 'enabled', on: random.chance(.5) }, { kind: 'sync' }); break
      case 7: steps.push({ kind: 'flag', name: 'objectAt', on: random.chance(.4) }, { kind: 'flag', name: 'reduced', on: random.chance(.4) }, { kind: 'flag', name: 'zoom', value: random.pick([1, 1.0005, 1.002, 2, 3]) }); break
      default: steps.push({ kind: 'down', id: a, x, y, at: 'plain' }, { kind: 'up', id: a, x, y, at: 'plain' }, { kind: 'click', at: target() }, { kind: 'time', ms: random.pick([100, 300]) }, { kind: 'click', at: 'plain' })
    }
  }
  for (let index = 0; index < length; index++) {
    if (random.chance(.55)) { macro(); continue }
    const roll = random()
    const base = { id: random.pick([1, 1, 2, 7]), x: random.int(0, 400), y: random.int(0, 700), at: target(), pointerType: random.pick(['touch', 'touch', 'touch', 'pen']) }
    if (roll < .2) steps.push({ kind: 'down', ...base })
    else if (roll < .4) steps.push({ kind: 'move', ...base })
    else if (roll < .55) steps.push({ kind: 'up', ...base })
    else if (roll < .6) steps.push({ kind: 'cancel', ...base })
    else if (roll < .7) steps.push({ kind: 'time', ms: random.pick([1, 16, 80, 250, 251]) })
    else if (roll < .8) steps.push({ kind: 'frame', ms: random.pick([0, 8, 16, 33, 200]) })
    else if (roll < .85) steps.push({ kind: 'click', at: target() })
    else if (roll < .9) steps.push({ kind: 'sync' })
    else if (roll < .95) steps.push({ kind: 'flag', name: random.pick(['enabled', 'reduced', 'objectAt']), on: random.chance(.5) })
    else if (roll < .975) steps.push({ kind: 'flag', name: 'zoom', value: random.pick([1, 1.5, 2, 4]) })
    else steps.push({ kind: 'destroyEarly' })
  }
  steps.push({ kind: 'time', ms: 500 }, { kind: 'frame', ms: 16 }, { kind: 'frame', ms: 16 }, { kind: 'destroy' }, { kind: 'time', ms: 5000 }, { kind: 'frame', ms: 16 },
    { kind: 'down', id: 1, x: 100, y: 100, at: 'plain' })
  return { choice, steps }
}

export function playZoom(api, { choice, steps }) {
  const world = createWorld()
  const flags = { enabled: choice.enabled, reduced: choice.reduced, objectAt: choice.objectAt, zoom: choice.zoom }
  vi.stubGlobal('matchMedia', query => {
    world.note('matchMedia', query)
    return { get matches() { world.note('matches'); return flags.reduced } }
  })
  let view = { zoom: choice.zoom, panX: 0, panY: 0, width: choice.width, height: choice.height, centerX: choice.centerX, centerY: choice.centerY, ...(choice.extra ? { label: 'inspection', depth: 3 } : {}) }
  const scene = choice.sceneMissing ? null : {
    getInspectionZoom() { world.note('getInspectionZoom'); return flags.zoom },
    getInspectionView() { world.note('getInspectionView'); return { ...view, zoom: flags.zoom } },
    getObjectAtPoint(x, y) { world.note('getObjectAtPoint', x, y); return flags.objectAt ? { name: 'book' } : null },
    setInspectionView(next, options) {
      world.note('setInspectionView', next, options)
      view = { ...next }
      if (!options.moving && choice.clampOnRest) {
        const x = (view.zoom - 1) * view.width / 2, y = (view.zoom - 1) * view.height / 2
        view.panX = clamp(view.panX, -x, x); view.panY = clamp(view.panY, -y, y)
      }
      flags.zoom = view.zoom
      return { ...view }
    }
  }
  const captured = new Set()
  const classes = new Set()
  const root = world.listenable('root', {
    classList: {
      toggle(name, force) { world.note('classList.toggle', name, force); const on = force === undefined ? !classes.has(name) : Boolean(force); if (on) classes.add(name); else classes.delete(name); return on },
      remove(name) { world.note('classList.remove', name); classes.delete(name) }
    }
  })
  const scroller = world.listenable('scroller', {
    setPointerCapture(id) { world.note('setPointerCapture', id); if (id === 7) throw new Error('capture refused'); captured.add(id) },
    hasPointerCapture(id) { world.note('hasPointerCapture', id); return captured.has(id) },
    releasePointerCapture(id) { world.note('releasePointerCapture', id); captured.delete(id) }
  })
  const targets = { plain: world.target('plain'), switch: world.target('switch', [/ihr-view-switch/]), catalog: world.target('catalog', [/ihr-shelf-catalog/]) }
  let starts = 0
  const options = {
    root, scroller, getScene: () => { world.note('getScene'); return scene },
    isEnabled: () => { world.note('isEnabled'); return flags.enabled },
    onGestureStart: () => { world.note('onGestureStart'); if (choice.throwOnStart && ++starts === 2) throw new Error('start refused') }
  }
  let control
  try { control = api.createShelfZoom(options) } catch (error) { world.note('create threw', error?.message); return world.log }
  const snapshot = () => world.note('state', [...classes].join(','), world.pendingFrames, world.pendingTimers, world.listenerCount, JSON.parse(JSON.stringify(view)))
  let destroyed = false
  for (const step of steps) {
    const at = targets[step.at]
    switch (step.kind) {
      case 'down': case 'move': case 'up': case 'cancel': {
        const type = { down: 'pointerdown', move: 'pointermove', up: 'pointerup', cancel: 'pointercancel' }[step.kind]
        world.now += step.kind === 'move' ? 3 : 7
        world.fire('scroller', type, world.event(type, { pointerId: step.id, clientX: step.x, clientY: step.y, pointerType: step.pointerType || 'touch' }, at))
        break
      }
      case 'click': world.fire('scroller', 'click', world.event('click', {}, at)); break
      case 'time': world.advance(step.ms); break
      case 'frame': world.now += step.ms; world.frame(); break
      // A destroyed controller is never synchronised or destroyed again by its owner.
      case 'sync': if (!destroyed) { try { control.sync() } catch (error) { world.note('sync threw', error?.message) } } break
      case 'flag': if (step.name === 'zoom') flags.zoom = step.value; else flags[step.name] = step.on; break
      case 'destroyEarly': case 'destroy': if (!destroyed) { destroyed = true; try { control.destroy() } catch (error) { world.note('destroy threw', error?.message) } } break
    }
    snapshot()
  }
  world.advance(60000); world.frame(); snapshot()
  return world.log
}
