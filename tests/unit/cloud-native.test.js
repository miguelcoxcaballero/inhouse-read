import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Background cloud work needs the Rust UI module. It must not start that download before the
// shelf has drawn its first live frame, must not wait at all when the module is in memory, and
// reports a module that cannot load instead of failing silently.
const runtime = vi.hoisted(() => ({ ui: null, require: null }))
vi.mock('../../src/js/rust-ui.js', () => ({ getRustUI: () => runtime.ui, requireRustUI: () => runtime.require() }))

let cloudNative
beforeEach(async () => {
  vi.resetModules(); vi.useFakeTimers()
  vi.stubGlobal('requestIdleCallback', undefined)
  document.body.innerHTML = ''
  runtime.ui = null; runtime.require = vi.fn(async () => ({ name: 'ui' }))
  cloudNative = await import('../../src/js/cloud-native.js')
})
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); document.body.innerHTML = '' })
const frame = () => { document.body.innerHTML = '<canvas class="ihr-bookshelf-scene" data-render-count="1"></canvas>' }

describe('the Rust UI module for cloud work', () => {
  it('answers at once when the module is already in memory', async () => {
    runtime.ui = { name: 'loaded' }
    expect(await cloudNative.cloudModule()).toBe(runtime.ui)
    expect(runtime.require).not.toHaveBeenCalled()
    expect(cloudNative.loadedCloudModule()).toBe(runtime.ui)
  })
  it('does not ask for the module before the first shelf frame, then does', async () => {
    const pending = cloudNative.cloudModule()
    await vi.advanceTimersByTimeAsync(1500)
    expect(runtime.require).not.toHaveBeenCalled()
    frame(); await vi.advanceTimersByTimeAsync(150)
    expect(await pending).toEqual({ name: 'ui' })
    expect(runtime.require).toHaveBeenCalledOnce()
  })
  it('does not wait forever without WebGL: the eight-second fallback of the startup tasks applies', async () => {
    const pending = cloudNative.cloudModule()
    await vi.advanceTimersByTimeAsync(8200)
    expect(await pending).toEqual({ name: 'ui' })
  })
  it('reports a module that cannot load', async () => {
    runtime.require = vi.fn(async () => null)
    frame()
    await expect(cloudNative.cloudModule()).rejects.toThrow('No se pudo cargar la sincronización. Comprueba la conexión e inténtalo de nuevo.')
  })
  it('withCloudModule starts at once with the module and after it without', async () => {
    const use = vi.fn(ui => ui.name)
    runtime.ui = { name: 'now' }
    expect(cloudNative.withCloudModule(use)).toBe('now')
    runtime.ui = null; frame()
    expect(await cloudNative.withCloudModule(use)).toBe('ui')
    expect(use).toHaveBeenCalledTimes(2)
  })
})
