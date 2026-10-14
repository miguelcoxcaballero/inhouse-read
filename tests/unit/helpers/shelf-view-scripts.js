import { vi } from 'vitest'
import { createWorld, prng } from './pointer-harness.js'

export function makeViewScript(seed, length) {
  const random = prng(seed)
  const choice = { mode: random.pick(['spine', 'isometric']), enabled: random.chance(.9), scrollerWidth: random.pick([0, 390, 390, 600, 1000]), rootWidth: random.pick([0, 0, 320, 500]), throwOnStart: random.chance(.03) }
  const steps = []
  const target = () => random.pick(['plain', 'plain', 'plain', 'excluded', 'root'])
  const macro = () => {
    const id = random.pick([1, 1, 4]), x = random.int(40, 340), y = random.int(150, 600), at = target() === 'root' ? 'plain' : target()
    switch (random.int(0, 6)) {
      case 0: case 1: case 2: {
        const dx = random.pick([-300, -120, -80, -50, -20, -10, 10, 30, 60, 110, 200, 400]), dy = random.pick([0, 0, 6, 14, 30, -40, 90])
        const pointerType = random.pick(['touch', 'touch', 'pen'])
        steps.push({ kind: 'down', id, x, y, at, pointerType })
        for (let move = 1; move <= random.int(1, 5); move++) steps.push({ kind: 'move', id, x: x + dx * move / 4, y: y + dy * move / 4, at: 'plain', pointerType })
        steps.push({ kind: random.pick(['up', 'up', 'up', 'cancel']), id, x: x + dx, y: y + dy, at: 'plain', pointerType }, { kind: 'click', at: 'plain', detail: random.pick([0, 1, 1, 2]) })
        steps.push({ kind: 'time', ms: random.pick([100, 399, 400, 401, 800]) }, { kind: 'click', at: 'plain', detail: 1 }); break
      }
      case 3: steps.push({ kind: 'down', id: 1, x, y, at, pointerType: 'touch' }, { kind: 'down', id: 2, x: x + 30, y, at, pointerType: 'touch', primary: random.chance(.5) }, { kind: 'move', id: 1, x: x - 100, y, at: 'plain' }, { kind: 'up', id: 2, x, y, at: 'plain' }, { kind: 'up', id: 1, x: x - 100, y, at: 'plain' }); break
      case 4: steps.push({ kind: 'key', key: random.pick(['ArrowLeft', 'ArrowRight', 'ArrowLeft', 'a']), at: random.pick(['root', 'root', 'plain']), mods: random.pick([[], [], [], ['ctrlKey'], ['shiftKey'], ['repeat'], ['altKey'], ['metaKey']]) }); break
      case 5: steps.push({ kind: 'down', id, x, y, at, pointerType: 'touch' }, { kind: 'flag', name: random.pick(['enabled', 'mode']), on: random.chance(.5) }, { kind: 'move', id, x: x - 100, y, at: 'plain' }, { kind: 'up', id, x: x - 140, y, at: 'plain' }); break
      default: steps.push({ kind: 'down', id, x, y, at, pointerType: 'mouse' }, { kind: 'move', id, x: x - 100, y, at: 'plain', pointerType: 'mouse' }, { kind: 'up', id, x: x - 100, y, at: 'plain', pointerType: 'mouse' })
    }
  }
  for (let index = 0; index < length; index++) {
    if (random.chance(.6)) { macro(); continue }
    const roll = random()
    const base = { id: random.pick([1, 1, 2, 4]), x: random.int(0, 400), y: random.int(0, 700), at: target(), pointerType: random.pick(['touch', 'touch', 'pen', 'mouse']), button: random.pick([undefined, undefined, 0, 2, null]) }
    if (roll < .25) steps.push({ kind: 'down', ...base })
    else if (roll < .5) steps.push({ kind: 'move', ...base })
    else if (roll < .65) steps.push({ kind: 'up', ...base })
    else if (roll < .72) steps.push({ kind: 'cancel', ...base })
    else if (roll < .8) steps.push({ kind: 'time', ms: random.pick([1, 399, 400, 500]) })
    else if (roll < .85) steps.push({ kind: 'click', at: target(), detail: random.pick([0, 1]) })
    else if (roll < .95) steps.push({ kind: 'flag', name: random.pick(['enabled', 'mode']), on: random.chance(.5) })
    else if (roll < .98) steps.push({ kind: 'key', key: random.pick(['ArrowLeft', 'ArrowRight']), at: 'root', mods: [] })
    else steps.push({ kind: 'destroyEarly' })
  }
  steps.push({ kind: 'time', ms: 1000 }, { kind: 'destroy' }, { kind: 'time', ms: 1000 }, { kind: 'down', id: 1, x: 100, y: 100, at: 'plain', pointerType: 'touch' })
  return { choice, steps }
}

export function playView(api, { choice, steps }) {
  const world = createWorld()
  const flags = { enabled: choice.enabled, mode: choice.mode }
  const captured = new Set()
  const root = world.listenable('root', { clientWidth: choice.rootWidth, closest(selector) { world.note('closest', 'root', selector); return null } })
  const scroller = world.listenable('scroller', {
    clientWidth: choice.scrollerWidth,
    setPointerCapture(id) { world.note('setPointerCapture', id); if (id === 4) throw new Error('capture refused'); captured.add(id) },
    releasePointerCapture(id) { world.note('releasePointerCapture', id); if (id === 4) throw new Error('release refused'); captured.delete(id) }
  })
  const targets = { plain: world.target('plain'), excluded: world.target('excluded', [/input/]), root }
  let starts = 0
  const options = {
    root, scroller,
    getMode: () => { world.note('getMode'); return flags.mode },
    setMode: mode => { world.note('setMode', mode); flags.mode = mode },
    isEnabled: () => { world.note('isEnabled'); return flags.enabled },
    onGestureStart: event => { world.note('onGestureStart', event); if (choice.throwOnStart && ++starts === 2) throw new Error('start refused') }
  }
  let control
  try { control = api.createShelfViewGesture(options) } catch (error) { world.note('create threw', error?.message); return world.log }
  let destroyed = false
  for (const step of steps) {
    const at = targets[step.at]
    switch (step.kind) {
      case 'down': case 'move': case 'up': case 'cancel': {
        const type = { down: 'pointerdown', move: 'pointermove', up: 'pointerup', cancel: 'pointercancel' }[step.kind]
        world.now += 5
        const extra = step.primary === undefined ? {} : { isPrimary: step.primary }
        world.fire('scroller', type, world.event(type, { pointerId: step.id, clientX: step.x, clientY: step.y, pointerType: step.pointerType || 'touch', button: step.button, ...extra }, at))
        break
      }
      case 'click': world.fire('scroller', 'click', world.event('click', { detail: step.detail }, at)); break
      case 'key': world.fire('root', 'keydown', world.event('keydown', { key: step.key, ...Object.fromEntries(step.mods.map(name => [name, true])) }, at)); break
      case 'time': world.advance(step.ms); break
      case 'flag': if (step.name === 'enabled') flags.enabled = step.on; else flags.mode = step.on ? 'spine' : 'isometric'; break
      case 'destroyEarly': case 'destroy': if (!destroyed) { destroyed = true; try { control.destroy() } catch (error) { world.note('destroy threw', error?.message) } } break
    }
    world.note('state', world.pendingTimers, world.listenerCount, flags.mode, flags.enabled)
  }
  world.advance(60000)
  return world.log
}
