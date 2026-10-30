import { describe, it, expect, vi, afterEach } from 'vitest'

// The start-up wiring that needs the shelf module (reader controls, reading display, «Sin avisos al
// leer», the streak) must still run when the first load of the module fails and a later one succeeds.
let attempts = 0
vi.mock('../../src/wasm/shelf/inhouse_read_shelf.js', () => ({
  default: async () => { attempts++; if (attempts === 1) throw new Error('offline') },
  shelf_abi_version: () => 1
}))

afterEach(() => vi.useRealTimers())

describe('whenRustShelf', () => {
  it('runs waiting start-up wiring on the first load that succeeds, once, in order', async () => {
    vi.useFakeTimers({ toFake:['Date'] })
    vi.setSystemTime(1_000_000)
    // The test set-up already loaded the real module: start from a fresh loader on the mocked one.
    vi.resetModules()
    const { whenRustShelf, loadRustShelf, getRustShelf } = await import('../../src/js/rust-shelf.js')
    const used = []
    whenRustShelf(shelf => used.push(['a', shelf]))
    whenRustShelf(() => { throw new Error('one bad callback') })
    whenRustShelf(shelf => used.push(['b', shelf]))
    expect(await loadRustShelf()).toBe(null)
    expect(attempts).toBe(1)
    expect(used).toEqual([])

    // Inside the retry delay nothing is fetched again.
    expect(await loadRustShelf()).toBe(null)
    expect(attempts).toBe(1)

    vi.setSystemTime(1_000_000 + 31_000)
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const shelf = await loadRustShelf()
    expect(shelf).toBe(getRustShelf())
    expect(used.map(([name, module]) => [name, module === shelf])).toEqual([['a', true], ['b', true]])
    expect(errors).toHaveBeenCalledTimes(1)
    errors.mockRestore()

    // Once the module is in, wiring runs at once and nothing runs twice.
    whenRustShelf(module => used.push(['c', module]))
    await loadRustShelf()
    expect(used.map(([name]) => name)).toEqual(['a', 'b', 'c'])
    expect(attempts).toBe(2)
  })
})
