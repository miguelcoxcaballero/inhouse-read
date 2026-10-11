// @vitest-environment node
import { readFile } from 'node:fs/promises'
import { describe, expect, it, vi } from 'vitest'
import { isShellFile } from '../../scripts/generate-offline-shell.mjs'

const bytes = () => readFile(new URL('../../src/wasm/inhouse_read_core.wasm', import.meta.url))

describe('actual Rust core deployment and ownership', () => {
  it('compiles without host imports and preserves independent allocations through memory growth', async () => {
    const module = await WebAssembly.compile(await bytes())
    expect(WebAssembly.Module.imports(module)).toEqual([])
    const { exports:core } = await WebAssembly.instantiate(module)
    expect(core.core_abi_version()).toBe(1)
    expect(core.alloc_f64(0)).toBe(0)
    expect(core.alloc_f64(16_777_217)).toBe(0)
    const first = core.alloc_f64(8)
    new Float64Array(core.memory.buffer, first, 8).fill(123.25)
    const second = core.alloc_f64(200_000)
    expect([...new Float64Array(core.memory.buffer, first, 8)]).toEqual(Array(8).fill(123.25))
    expect(new Float64Array(core.memory.buffer, second, 200_000).every(value => value === 0)).toBe(true)
    core.free_f64(second, 200_000)
    core.free_f64(first, 8)
    // Repeated document operations release their arenas instead of growing
    // the memory for every book. WASM keeps the high-water pages reusable.
    const capacity = core.memory.buffer.byteLength
    for (let i = 0; i < 100; i++) {
      const pointer = core.alloc_f64(100_000)
      core.free_f64(pointer, 100_000)
    }
    expect(core.memory.buffer.byteLength).toBe(capacity)
  })

  it('loads actual bytes once, validates the ABI, and does not fetch again', async () => {
    vi.resetModules()
    const { loadRustCore, getRustCore } = await import('../../src/js/rust-core.js')
    const fetcher = vi.fn()
    const core = await loadRustCore({ bytes:await bytes(), fetcher })
    expect(core?.core_abi_version()).toBe(1)
    expect(getRustCore()).toBe(core)
    expect(await loadRustCore({ fetcher })).toBe(core)
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('keeps the app usable on invalid/cached-incompatible binaries', async () => {
    vi.resetModules()
    const { loadRustCore, getRustCore } = await import('../../src/js/rust-core.js')
    expect(await loadRustCore({ bytes:Uint8Array.of(0, 1, 2, 3) })).toBeNull()
    expect(getRustCore()).toBeNull()
  })

  it('retries a failed fetch only on a later caller after the backoff and shares in-flight recovery', async () => {
    vi.resetModules()
    const { loadRustCore, getRustCore } = await import('../../src/js/rust-core.js')
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1_000)
    let completeFetch
    const fetcher = vi.fn().mockRejectedValueOnce(new Error('offline')).mockImplementationOnce(() =>
      new Promise(resolve => { completeFetch = resolve }))
    try {
      const first = loadRustCore({ fetcher })
      expect(loadRustCore({ fetcher })).toBe(first)
      expect(await first).toBeNull()
      expect(getRustCore()).toBeNull()
      clock.mockReturnValue(30_999)
      expect(await loadRustCore({ fetcher })).toBeNull()
      expect(fetcher).toHaveBeenCalledTimes(1)
      clock.mockReturnValue(31_000)
      // Crossing the deadline alone schedules no automatic request.
      await Promise.resolve()
      expect(fetcher).toHaveBeenCalledTimes(1)
      const recovery = loadRustCore({ fetcher })
      expect(loadRustCore({ fetcher })).toBe(recovery)
      expect(getRustCore()).toBeNull()
      completeFetch(new Response(await bytes(), { headers:{ 'content-type':'application/wasm' } }))
      const core = await recovery
      expect(core?.core_abi_version()).toBe(1)
      expect(getRustCore()).toBe(core)
      expect(fetcher).toHaveBeenCalledTimes(2)
      clock.mockReturnValue(90_000)
      expect(await loadRustCore({ fetcher })).toBe(core)
      expect(fetcher).toHaveBeenCalledTimes(2)
    } finally { clock.mockRestore() }
  })

  it('keeps the same bounded retry after corrupt bytes and recovers with the actual module', async () => {
    vi.resetModules()
    const { loadRustCore, getRustCore } = await import('../../src/js/rust-core.js')
    const clock = vi.spyOn(Date, 'now').mockReturnValue(5_000)
    const fetcher = vi.fn()
    try {
      expect(await loadRustCore({ bytes:Uint8Array.of(0, 1, 2, 3), fetcher })).toBeNull()
      expect(getRustCore()).toBeNull()
      const good = await bytes()
      clock.mockReturnValue(34_999)
      expect(await loadRustCore({ bytes:good, fetcher })).toBeNull()
      clock.mockReturnValue(35_000)
      const core = await loadRustCore({ bytes:good, fetcher })
      expect(core?.core_abi_version()).toBe(1)
      expect(getRustCore()).toBe(core)
      expect(fetcher).not.toHaveBeenCalled()
    } finally { clock.mockRestore() }
  })

  it('includes the versioned module in the verified offline shell', () => {
    expect(isShellFile('assets/inhouse_read_core-aBc123.wasm')).toBe(true)
    expect(isShellFile('unrelated.wasm')).toBe(false)
  })
})
