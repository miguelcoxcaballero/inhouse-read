import { describe, expect, it } from 'vitest'
import { animationFrameFence as production } from '../../src/js/animation-frame-fence.js'
import { animationFrameFence as frozen } from './helpers/reference-animation-frame-fence.js'
import { rustShelf } from './helpers/rust-shelf-ready.js'
import { collect } from './helpers/collect.js'
import { prng, show } from './helpers/pointer-harness.js'

// The frame fence's rules run in Rust; the context is a host object. Every call the fence makes on
// a randomly misbehaving context, and every answer it gives, is compared with the frozen original.
function play(make, seed) {
  const random = prng(seed), log = []
  const syncs = []
  const SYNC = { SYNC_GPU_COMMANDS_COMPLETE: 1, TIMEOUT_EXPIRED: 2, ALREADY_SIGNALED: 3, CONDITION_SATISFIED: 4, WAIT_FAILED: 5 }
  const behaviour = {
    fence: random.pick(['object', 'object', 'object', 'null', 'undefined', 'zero', 'throws']),
    wait: random.pick([3, 4, 2, 2, 5, 99, 'throws', 2, 3]), flush: random.pick(['ok', 'ok', 'ok', 'throws']),
    deleteSync: random.pick(['ok', 'ok', 'ok', 'throws']), lost: random.pick(['no', 'no', 'no', 'yes', 'truthy', 'not-a-function', 'missing'])
  }
  const context = {}
  const define = (name, body) => { context[name] = (...args) => { const answer = body(...args); log.push(`${name}(${args.map(value => value?.traceName ?? show(value)).join(',')}) -> ${value(answer)}`); return answer } }
  const value = answer => answer?.traceName ?? show(answer)
  Object.assign(context, SYNC)
  define('fenceSync', () => {
    if (behaviour.fence === 'throws') throw new Error('fence failed')
    if (behaviour.fence === 'null') return null
    if (behaviour.fence === 'undefined') return undefined
    if (behaviour.fence === 'zero') return 0
    const sync = { traceName: `sync${syncs.length}` }; syncs.push(sync); return sync
  })
  define('clientWaitSync', () => { if (behaviour.wait === 'throws') throw new Error('driver lost'); return behaviour.wait })
  define('flush', () => { if (behaviour.flush === 'throws') throw new Error('flush failed') })
  define('deleteSync', () => { if (behaviour.deleteSync === 'throws') throw new Error('delete failed') })
  if (behaviour.lost === 'missing') { /* no isContextLost at all */ } else if (behaviour.lost === 'not-a-function') context.isContextLost = 7
  else define('isContextLost', () => behaviour.lost === 'yes' ? true : behaviour.lost === 'truthy' ? 'lost' : false)
  const dropped = random.pick(['fenceSync', 'clientWaitSync', 'deleteSync', 'flush', null, null, null, null, null])
  if (dropped) delete context[dropped]
  const target = random.chance(.04) ? random.pick([null, undefined, {}, 5]) : context
  let fence
  try { fence = make(target); log.push('created') } catch (error) { log.push(`create threw ${error?.name}: ${error?.message}`); return log }
  const steps = random.int(5, 40)
  for (let step = 0; step < steps; step++) {
    const roll = random()
    // The context can change its mind between calls.
    if (random.chance(.15)) behaviour.wait = random.pick([3, 4, 2, 2, 5, 'throws'])
    if (random.chance(.08)) behaviour.lost = random.pick(['no', 'yes', 'truthy'])
    if (roll < .35) { fence.submit(); log.push('submit') }
    else if (roll < .8) log.push(`ready -> ${fence.ready()}`)
    else { fence.dispose(); log.push('dispose') }
  }
  fence.dispose(); log.push(`final ready -> ${fence.ready()}`)
  return log
}

describe('compiled frame fence against the frozen JavaScript', () => {
  it('makes the same context calls and answers for 6000 random contexts and scripts', () => {
    let submitted = 0, busy = 0, released = 0, retired = 0
    for (let seed = 1; seed <= 6000; seed++) {
      const expected = play(frozen, seed * 104729), actual = play(production, seed * 104729)
      if (expected.join('\n') !== actual.join('\n')) {
        const at = expected.findIndex((line, index) => line !== actual[index])
        throw new Error(`seed ${seed} line ${at}\nexpected: ${expected.slice(Math.max(0, at - 3), at + 3).join('\n  ')}\nactual:   ${actual.slice(Math.max(0, at - 3), at + 3).join('\n  ')}`)
      }
      submitted += expected.filter(line => /^fenceSync/.test(line)).length
      busy += expected.filter(line => /^ready -> false/.test(line)).length
      released += expected.filter(line => /^deleteSync/.test(line)).length
      retired += expected.filter(line => /threw|-> throws/.test(line)).length
    }
    // Fences in flight, busy frames, releases and failing drivers must all be in the corpus.
    expect(submitted).toBeGreaterThan(2500)
    expect(busy).toBeGreaterThan(300)
    expect(released).toBeGreaterThan(1500)
    expect(retired).toBeGreaterThan(300)
  })

  it('keeps no handle once its context is gone', async () => {
    await collect()
    const before = rustShelf.shelf_live_handles()
    const run = count => {
      for (let index = 0; index < count; index++) {
        const gl = { fenceSync: () => ({}), clientWaitSync: () => 2, deleteSync() {}, flush() {}, TIMEOUT_EXPIRED: 2 }
        const fence = production(gl); fence.submit(); fence.ready()
        if (index % 2) fence.dispose()
      }
    }
    run(300)
    expect(rustShelf.shelf_live_handles()).toBeGreaterThan(before)
    await collect()
    expect(rustShelf.shelf_live_handles()).toBe(before)
  }, 60_000)
})
