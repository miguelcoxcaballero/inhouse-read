import { describe, expect, it } from 'vitest'
import { MINI_PLAYER_RESERVE, PAGE_BOX_SLACK, stablePageHeight } from '../../src/js/readers/page-box.js'

const memory = () => { const data = new Map(); return { getItem:key => data.get(key) ?? null, setItem:(key, value) => data.set(key, String(value)) } }

describe('stable page box', () => {
  it('keeps the same height in a later opening with a little more room', () => {
    const storage = memory()
    const first = stablePageHeight({ width:390, space:748, free:748, storage })
    expect(first).toBe(748 - MINI_PLAYER_RESERVE)
    // Android hid its status bar: 30 px more, same pages.
    expect(stablePageHeight({ width:390, space:778, free:778, storage })).toBe(first)
  })

  it('shrinks once when the box no longer fits and then stays there', () => {
    const storage = memory()
    expect(stablePageHeight({ width:390, space:778, free:778, storage })).toBe(730)
    // 30 px less still fits the box: same pages.
    expect(stablePageHeight({ width:390, space:748, free:748, storage })).toBe(730)
    // 60 px less does not.
    expect(stablePageHeight({ width:390, space:718, free:718, storage })).toBe(670)
    expect(stablePageHeight({ width:390, space:778, free:778, storage })).toBe(670)
    expect(stablePageHeight({ width:390, space:748, free:748, storage })).toBe(670)
  })

  it('does not change for the mini player, and only shows less while both bars are up', () => {
    const storage = memory()
    expect(stablePageHeight({ width:390, space:748, free:748, storage })).toBe(700)
    expect(stablePageHeight({ width:390, space:748, free:700, storage })).toBe(700)
    expect(stablePageHeight({ width:390, space:748, free:656, storage })).toBe(656)
    expect(stablePageHeight({ width:390, space:748, free:748, storage })).toBe(700)
  })

  it('keeps a real resize apart from the usual box', () => {
    const storage = memory()
    expect(stablePageHeight({ width:390, space:748, free:748, storage })).toBe(700)
    // The keyboard: a different box, while the usual one is kept.
    expect(stablePageHeight({ width:390, space:748 - PAGE_BOX_SLACK - 200, free:452, storage })).toBe(404)
    expect(stablePageHeight({ width:390, space:748, free:748, storage })).toBe(700)
    // Rotation.
    expect(stablePageHeight({ width:844, space:342, free:342, storage })).toBe(294)
    expect(stablePageHeight({ width:390, space:748, free:748, storage })).toBe(700)
  })

  it('works without storage', () => {
    expect(stablePageHeight({ width:390, space:748, free:748, storage:null })).toBe(700)
    const broken = { getItem() { throw new Error('denied') }, setItem() { throw new Error('denied') } }
    expect(stablePageHeight({ width:390, space:748, free:748, storage:broken })).toBe(700)
  })
})
