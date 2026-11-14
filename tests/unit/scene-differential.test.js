import { beforeAll, describe, expect, it, vi } from 'vitest'
import { createBookshelfScene as liveScene } from '../../src/js/bookshelf-scene.js'
import { createBookshelfScene as frozen } from './helpers/reference-bookshelf-scene.js'
import { runScenario } from './helpers/scene-differential.js'
import { censusAudit } from './helpers/scene-census-audit.js'

// The live scene's censuses that do not walk the entries are checked against a walk (helpers/scene-census-audit.js).
vi.mock('../../src/js/scene-entry-frame.js', async actual => (await import('./helpers/scene-census-audit.js')).auditedEntryFrame(actual))

// The independent JS reference adopts the requested hidden-page and opaque-reader
// suspension policies (1.7.303, faef7e1b) only; arithmetic, geometry, the 24 seeded scripts and strict
// frame-by-frame comparisons remain intact.
// New settling is enabled in production by default and covered by contact/idle
// regressions. Keep the complete original scene corpus as an independent check
// of the optional non-settling, immediate-paint API, without changing its frozen
// reference. Default batching is checked with staggered decodes and real GPU gestures.
const live=options=>liveScene({...options,settleBooks:false,batchQuality:false})

vi.mock('../../src/js/book-model.js', async () => (await import('./helpers/scene-differential.js')).bookModelMock())

// The scene moved its maths and decisions to Rust. The same scripted session replayed against the frozen
// original and the live scene must leave the same observable state after every operation and every frame:
// canvas diagnostics, button styles, foliage hit paths, render cameras and matrices, model lifecycle, results.
function same(label, left, right) {
  const length = Math.max(left.length, right.length)
  for (let index = 0; index < length; index++) {
    if (left[index] !== right[index]) {
      const a = left[index] ?? '(missing)', b = right[index] ?? '(missing)'
      let at = 0
      while (a[at] === b[at]) at++
      throw new Error(`${label}: step ${index} differs at character ${at}\n  frozen: …${a.slice(Math.max(0, at - 160), at + 200)}\n  live:   …${b.slice(Math.max(0, at - 160), at + 200)}`)
    }
  }
  expect(right.length).toBe(left.length)
}

describe('bookshelf scene against its frozen original', () => {
  // The first scene of a process warms module-level caches (plant surfaces, area lights) that later ones find
  // ready; the sessions below compare scenes that all start from that warm state.
  beforeAll(async () => { await runScenario(frozen, 1) }, 120000)

  it('replays a session deterministically (the harness itself)', async () => {
    const first = await runScenario(frozen, 2), second = await runScenario(frozen, 2)
    same('frozen twice', first, second)
    expect(first.length).toBeGreaterThan(80)
  }, 120000)

  it('keeps the original furniture loop for a fractional unit count', async () => {
    const options={units:1.5,steps:8}
    await runScenario(frozen,3,options)
    same('fractional units',await runScenario(frozen,3,options),await runScenario(live,3,options))
  }, 120000)

  // The bin and the lamps at rest are left alone by the frame (their lid, matrices, box, emission and
  // data stand as written). These sessions dwell on them: hovers, drops, switches and temperatures between
  // frames, view changes and layouts, with the bin's world matrices and lid and each lamp's emission
  // recorded at every render.
  let binRenders = 0, lampRenders = 0, nudges = 0, ranSurface = false
  it.each([101, 102, 103, 104, 105, 106, 107, 108])('fixture session %i leaves identical state', async seed => {
    const options = { steps: 90, bin: true,
      weights: { hover: 12, trash: 4, trashCancel: 7, trashThrough: 3, mode: 6, lampPower: 9, lampKelvin: 7, frames: 14, advance: 4, zoomTo: 3, layout: 3, scroll: 2, class: 2, query: 1 } }
    await runScenario(frozen, seed, options)
    const original = await runScenario(frozen, seed, options), current = await runScenario(live, seed, options)
    same(`fixture seed ${seed}`, original, current)
    binRenders += current.join('').split('"bin"').length - 1
    lampRenders += current.join('').split('"lamp:').length - 1
  }, 180000)
  it('recorded the bin and the lamps in the fixture sessions\' renders', () => {
    if (binRenders + lampRenders === 0) return // The sessions were filtered out of this run.
    expect(binRenders).toBeGreaterThan(400); expect(lampRenders).toBeGreaterThan(400)
  })

  // A hit surface that stands in a room that stands keeps its world matrix (the frame does not compose it
  // again). These sessions rest often and have something else move the parts inside the models between
  // frames, with scrolls, lifts, zooms, turns, returns and layouts around them.
  it.each([201, 202, 203, 204, 205, 206, 207, 208])('surface session %i leaves identical state', async seed => {
    const options = { steps: 110, bin: true,
      weights: { nudgePart: 14, frames: 16, scroll: 6, class: 6, drag: 4, release: 4, mode: 3, zoomTo: 3, inspectView: 3, layout: 3, returnBook: 3, trashCancel: 2, advance: 3, query: 3 } }
    ranSurface = true
    await runScenario(frozen, seed, options)
    const original = await runScenario(frozen, seed, options), current = await runScenario(live, seed, options)
    same(`surface seed ${seed}`, original, current)
    nudges += current.filter(line => / nudgePart: \[/.test(line.slice(0, 40))).length
  }, 180000)
  it('moved parts inside the models in the surface sessions', () => {
    if (nudges === 0 && !ranSurface) return // The sessions were filtered out of this run.
    expect(nudges).toBeGreaterThan(60)
  })

  it.each(Array.from({ length: Number(process.env.SCENE_SEEDS) || 24 }, (_, index) => index + 1))('session %i leaves identical state', async seed => {
    // A session's second run finds what its first one painted already cached (plant surfaces, bakes), which
    // settles asynchronous work sooner. Both scenes are therefore compared from the same warm state.
    await runScenario(frozen, seed)
    const original = await runScenario(frozen, seed), current = await runScenario(live, seed)
    same(`seed ${seed}`, original, current)
  }, 180000)

  it('told the entry arena of every change in what the entries hold', () => {
    expect(censusAudit.misses).toEqual([])
    expect(censusAudit.kept).toBeGreaterThan(censusAudit.walked ? 100 : -1)
  })
})
