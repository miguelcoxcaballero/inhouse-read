import { describe, expect, it, vi } from 'vitest'
import * as production from '../../src/js/shelf-placement-preview.js'
import * as frozen from './helpers/reference-shelf-placement-preview.js'
import { rustShelf } from './helpers/rust-shelf-ready.js'
import { collect } from './helpers/collect.js'
import { prng, show } from './helpers/pointer-harness.js'

// The drag policy runs in Rust; the session and the one-shot move are scripted host functions.
// Every call the policy makes on them, and every answer, is compared with the frozen original.
const script = vi.hoisted(() => ({ log: [], random: null, hook: null, behaviour: null }))
vi.mock('../../src/js/shelf-placement-wasm.js', () => ({
  createShelfPlacementSession(objects, options) {
    const { behaviour, log } = script
    log.push(`session(${show(objects?.length)},${show(options?.tag)})`)
    if (behaviour.session === 'throws') throw new RangeError('session failed')
    if (behaviour.session === 'null') return null
    if (behaviour.session === 'undefined') return undefined
    if (behaviour.session === 'no-move') return { dispose() { log.push('session.dispose') } }
    return {
      move(...args) {
        log.push(`session.move(${args.map(value => value?.traceName ?? show(value)).join(',')})`)
        script.hook?.('session.move')
        if (behaviour.sessionMove === 'throws') throw new TypeError('move failed')
        return behaviour.sessionMove === 'undefined' ? undefined : behaviour.sessionMove === 'null' ? null : { from: 'session', shelf: args[2] }
      },
      dispose() { log.push('session.dispose'); if (behaviour.session === 'dispose-throws') throw new Error('dispose failed') }
    }
  }
}))
vi.mock('../../src/js/shelf-decoration-layout.js', () => ({
  moveShelfDecoration(objects, key, target, options) {
    script.log.push(`direct(${show(objects?.length)},${show(key)},${show(target)},${show(options?.tag)})`)
    script.hook?.('direct')
    if (script.behaviour.direct === 'throws') throw new RangeError('direct failed')
    return { from: 'direct', key }
  }
}))

function play(api, seed) {
  const random = prng(seed), log = script.log = []
  script.random = random
  script.behaviour = {
    session: random.pick(['object', 'object', 'object', 'null', 'undefined', 'throws', 'no-move', 'dispose-throws']),
    sessionMove: random.pick(['value', 'value', 'value', 'undefined', 'null', 'throws']), direct: random.pick(['ok', 'ok', 'ok', 'throws'])
  }
  const count = random.pick([0, 3, 15, 16, 17, 40])
  const objects = random.chance(.1) ? random.pick([null, undefined, 'text', { length: 99 }]) : Array.from({ length: count }, (_, index) => ({ key: `k${index}` }))
  const options = random.chance(.1) ? random.pick([null, undefined]) : { tag: `o${seed}` }
  const preview = api.createShelfPlacementPreview(objects, options)
  let reentrant = null
  script.hook = label => { if (reentrant === label) { reentrant = null; try { preview.dispose(); log.push('hook dispose') } catch (error) { log.push(`hook dispose threw ${error.message}`) } } }
  const core = { traceName: 'core' }
  const steps = random.int(2, 14)
  for (let step = 0; step < steps; step++) {
    const roll = random()
    if (roll < .08) {
      try { preview.dispose(); log.push('dispose') } catch (error) { log.push(`dispose threw ${error?.name}: ${error?.message}`) }
    } else {
      if (random.chance(.1)) reentrant = random.pick(['session.move', 'direct'])
      const given = random.chance(.12) ? random.pick([null, undefined, 0]) : core
      try { log.push(`move -> ${show(preview.move(given, random.pick(['k1', 'k2', undefined]), random.int(0, 3), random.pick([0, .25, .5, NaN, undefined])))}`) }
      catch (error) { log.push(`move threw ${error?.name}: ${error?.message}`) }
    }
  }
  try { preview.dispose() } catch (error) { log.push(`final dispose threw ${error?.message}`) }
  log.push(`after dispose -> ${show(preview.move(core, 'k1', 1, .5))}`)
  return log
}

describe('compiled placement preview policy against the frozen JavaScript', () => {
  it('routes, prepares, disposes and answers identically for 8000 random scripts', () => {
    let session = 0, direct = 0, sessionAnswers = 0, reentrant = 0, errors = 0
    for (let seed = 1; seed <= 8000; seed++) {
      const expected = play(frozen, seed * 7727), actual = play(production, seed * 7727)
      if (expected.join('\n') !== actual.join('\n')) {
        const at = expected.findIndex((line, index) => line !== actual[index])
        throw new Error(`seed ${seed} line ${at}\nexpected: ${expected.slice(Math.max(0, at - 3), at + 3).join('\n  ')}\nactual:   ${actual.slice(Math.max(0, at - 3), at + 3).join('\n  ')}`)
      }
      session += expected.filter(line => /^session\(/.test(line)).length
      direct += expected.filter(line => /^direct\(/.test(line)).length
      sessionAnswers += expected.filter(line => /^move -> .*from:"session"/.test(line)).length
      reentrant += expected.filter(line => /^hook dispose/.test(line)).length
      errors += expected.filter(line => /threw/.test(line)).length
    }
    // Prepared sessions, direct moves, session answers, re-entrant disposal and failures must all be reached.
    expect(session).toBeGreaterThan(1500)
    expect(direct).toBeGreaterThan(10000)
    expect(sessionAnswers).toBeGreaterThan(1000)
    expect(reentrant).toBeGreaterThan(200)
    expect(errors).toBeGreaterThan(300)
  })

  it('keeps the exported constants and frees its objects when the host collects a dropped preview', async () => {
    expect(production.SHELF_PREVIEW_MIN_OBJECTS).toBe(16)
    expect(production.SHELF_PREVIEW_DIRECT_MOVES).toBe(2)
    await collect(20)
    const before = rustShelf.shelf_live_handles()
    script.log = []; script.behaviour = { session: 'object', sessionMove: 'value', direct: 'ok' }; script.hook = null
    const run = () => {
      for (let index = 0; index < 300; index++) {
        const preview = production.createShelfPlacementPreview(Array.from({ length: 20 }, (_, item) => ({ key: `k${item}` })), { tag: 'x' })
        for (let move = 0; move < 4; move++) preview.move({}, 'k1', 1, .5)
        if (index % 2) preview.dispose()
      }
    }
    run()
    expect(rustShelf.shelf_live_handles()).toBeGreaterThan(before)
    await collect(20)
    expect(rustShelf.shelf_live_handles()).toBeLessThanOrEqual(before)
  }, 60_000)
})
