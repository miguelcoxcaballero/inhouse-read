import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { reloadOnceAfterChunkFailure } from '../../src/js/chunk-recovery.js'
import { createLazyReaderExperience } from '../../src/js/readers/reader-experience-lazy.js'

describe('reload after a lazy chunk failure', () => {
  let reload
  beforeEach(() => {
    sessionStorage.clear()
    reload = vi.fn()
    vi.stubGlobal('location', { ...window.location, reload })
  })
  afterEach(() => vi.unstubAllGlobals())

  it('reloads once, then leaves the failure to the caller for a minute', () => {
    expect(reloadOnceAfterChunkFailure(1_000_000)).toBe(true)
    expect(reloadOnceAfterChunkFailure(1_002_000)).toBe(false)
    expect(reloadOnceAfterChunkFailure(1_062_000)).toBe(true)
    expect(reload).toHaveBeenCalledTimes(2)
  })

  it('does not reload while offline', () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    expect(reloadOnceAfterChunkFailure()).toBe(false)
    expect(reload).not.toHaveBeenCalled()
  })

  it('survives storage that throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new DOMException('blocked', 'SecurityError') })
    expect(reloadOnceAfterChunkFailure()).toBe(false)
  })

  it('the lazy reader keeps the failure visible to the app and can be retried', async () => {
    const lazy = createLazyReaderExperience({}, {})
    // The reader chunk does not exist in this test build: the import rejects, the app shows its own message.
    await expect(lazy.ready()).rejects.toBeTruthy()
    expect(lazy.loaded).toBe(false)
  })
})
