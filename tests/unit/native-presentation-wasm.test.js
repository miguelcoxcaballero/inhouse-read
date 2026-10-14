import { afterEach, describe, expect, it, vi } from 'vitest'
import * as production from '../../src/js/native-renderer-presentation.js'
import * as frozen from './helpers/reference-native-renderer-presentation.js'
import { prng, show } from './helpers/pointer-harness.js'

afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks() })

function play(api, seed) {
  const random = prng(seed), log = []
  document.body.replaceChildren()
  const homes = [0, 1, 2].map(index => { const home = document.createElement('section'); home.id = `home-${index}`; document.body.append(home); return home })
  const renderers = [0, 1].map(index => ({ index, domElement: Object.assign(document.createElement('canvas'), { id: `gl-${index}` }) }))
  homes[0].append(renderers[0].domElement); homes[1].append(renderers[1].domElement)
  const leases = []
  const nameOf = value => {
    const at = leases.findIndex(entry => entry?.lease === value)
    return at >= 0 ? `lease#${at}` : value === null ? 'null' : value === undefined ? 'undefined' : value
  }
  const record = (label, run) => {
    try { log.push(`${label} -> ${show(nameOf(run()))}`) } catch (error) { log.push(`${label} threw ${error?.name} ${error?.message}`) }
  }
  const snapshot = () => log.push(`dom ${renderers.map(r => `${r.domElement.parentNode?.id || '-'}/${r.domElement.className}/${r.domElement.style.cssText}/${r.domElement.getAttribute('aria-hidden')}`).join(' | ')} canvases ${leases.map(entry => entry ? entry.canvas.style.opacity : '-').join(',')}`)
  const steps = random.int(30, 90)
  for (let step = 0; step < steps; step++) {
    const roll = random(), renderer = renderers[random.int(0, 1)]
    const lease = () => leases[random.int(0, Math.max(0, leases.length - 1))]
    const index = leases.length ? random.int(0, leases.length - 1) : 0
    if (roll < .12 || !leases.length) {
      const id = leases.length, mode = random.pick(['ok', 'ok', 'ok', 'noCapture', 'noCanvas', 'noContext', 'throwsPosition', 'refuses', 'throwsCapture', 'throwsRepaint', 'throwsCleanup', 'noCleanup'])
      const canvas = document.createElement('canvas'); canvas.id = `snap-${id}`
      const options = {
        canvas: mode === 'noCanvas' ? null : canvas, context: mode === 'noContext' ? null : { id },
        capture: mode === 'noCapture' ? undefined : (context) => { log.push(`capture ${id} ${context?.id}`); if (mode === 'throwsCapture') throw new RangeError('capture failed'); return 'captured' },
        repaint: () => { log.push(`repaint ${id}`); if (mode === 'throwsRepaint') throw new RangeError('repaint failed'); return `repainted-${id}` },
        position: node => {
          log.push(`position ${id} ${node.id}`)
          if (mode === 'throwsPosition') { node.className = 'half-placed'; homes[2].append(node); throw new Error('position failed') }
          if (mode === 'refuses') { node.className = 'refused'; node.style.cssText = 'opacity: .5'; homes[2].append(node); return false }
          node.className = `presented-${id}`; node.setAttribute('aria-hidden', 'true'); homes[id % 2].append(node)
        },
        cleanup: mode === 'noCleanup' ? undefined : () => { log.push(`cleanup ${id}`); if (mode === 'throwsCleanup') throw new Error('cleanup failed') }
      }
      let created = null
      try { created = api.createNativeRendererPresentation(renderer, options) } catch (error) { log.push(`create threw ${error?.message}`) }
      leases.push(created ? { lease: created, canvas } : null)
      log.push(`create ${id} ${renderer.index} ${mode} -> ${created ? `lease#${id} canvas=${created.canvas === canvas} keys=${Object.keys(created).sort().join(',')}` : 'null'}`)
    } else if (roll < .3) record(`present ${index}`, () => leases[index]?.lease.present())
    else if (roll < .38) record(`repaint ${index}`, () => leases[index]?.lease.repaint())
    else if (roll < .5) record(`capture ${index}`, () => leases[index]?.lease.capture())
    else if (roll < .56) record(`markDirty ${index}`, () => leases[index]?.lease.markDirty())
    else if (roll < .62) record(`isOwner ${index}`, () => leases[index]?.lease.isOwner())
    else if (roll < .72) { const other = random.int(0, leases.length - 1); record(`transfer ${index}->${other}`, () => leases[index]?.lease.transferTo(random.chance(.1) ? { lease: 1 } : leases[other]?.lease)) }
    else if (roll < .8) { const option = random.pick([undefined, {}, { snapshot: false }, { snapshot: true }]); record(`release ${index} ${show(option)}`, () => leases[index]?.lease.release(option)) }
    else if (roll < .86) { const option = random.pick([undefined, {}, { snapshot: false }, { snapshot: true }]); record(`dispose ${index} ${show(option)}`, () => leases[index]?.lease.dispose(option)) }
    else if (roll < .96) {
      const kind = random.pick(['ok', 'ok', 'promise', 'throws', 'present', 'empty']), consumer = random.chance(.5) ? lease()?.lease ?? null : null
      record(`with ${renderer.index} ${kind}`, () => api.withRendererPresentation(renderer, consumer, () => {
        log.push(`task ${kind}`)
        if (kind === 'promise') return { then() {} }
        if (kind === 'throws') throw new TypeError('task failed')
        if (kind === 'present') { const target = lease(); target?.lease.present(); return 'presented' }
        if (kind === 'empty') return undefined
        return 'done'
      }))
    } else record(`current ${renderer.index}`, () => api.currentNativeRendererPresentation(renderer))
    snapshot()
  }
  return log
}

describe('compiled native renderer presentation against the frozen JavaScript', () => {
  it('owns the canvas, moves its node and calls back identically for 1500 random lease sequences', () => {
    let presents = 0, transfers = 0, captures = 0, restores = 0
    for (let seed = 1; seed <= 1500; seed++) {
      const expected = play(frozen, seed * 7919), actual = play(production, seed * 7919)
      if (expected.join('\n') !== actual.join('\n')) {
        const at = expected.findIndex((line, index) => line !== actual[index])
        throw new Error(`seed ${seed} line ${at}\nexpected: ${expected.slice(Math.max(0, at - 3), at + 3).join('\n  ')}\nactual:   ${actual.slice(Math.max(0, at - 3), at + 3).join('\n  ')}`)
      }
      presents += expected.filter(line => /^present \d+ -> true/.test(line)).length
      transfers += expected.filter(line => /^transfer \d+->\d+ -> true/.test(line)).length
      captures += expected.filter(line => /^capture \d+ \d+$/.test(line)).length
      restores += expected.filter(line => /^repaint \d+$/.test(line)).length
    }
    // The corpus must reach ownership, transfers, snapshots and restores, not only refusals.
    expect(presents).toBeGreaterThan(2000)
    expect(transfers).toBeGreaterThan(200)
    expect(captures).toBeGreaterThan(1000)
    expect(restores).toBeGreaterThan(1500)
  }, 120_000)

  it('exposes plain, annotatable lease objects whose identity the holders compare', () => {
    const renderer = { domElement: document.createElement('canvas') }
    const lease = production.createNativeRendererPresentation(renderer, { canvas: document.createElement('canvas'), context: {}, capture() {}, repaint() {}, position() {} })
    lease.role = 'shelf-insertion'
    expect(lease.present()).toBe(true)
    expect(production.currentNativeRendererPresentation(renderer)).toBe(lease)
    expect(production.currentNativeRendererPresentation(renderer).role).toBe('shelf-insertion')
    lease.dispose()
    expect(production.currentNativeRendererPresentation(renderer)).toBeNull()
  })
})
