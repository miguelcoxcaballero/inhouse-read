import { beforeAll, describe, expect, it, vi } from 'vitest'
import { createBookshelfScene as live } from '../../src/js/bookshelf-scene.js'
import { createBookshelfScene as frozen } from './helpers/reference-bookshelf-scene.js'
import { runScenario } from './helpers/scene-differential.js'

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

  it.each(Array.from({ length: 24 }, (_, index) => index + 1))('session %i leaves identical state', async seed => {
    const original = await runScenario(frozen, seed), current = await runScenario(live, seed)
    same(`seed ${seed}`, original, current)
  }, 180000)
})
