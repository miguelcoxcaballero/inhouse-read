import { describe, it, expect, vi } from 'vitest'
import { initAndroidFileImports } from '../../src/js/android-file-import.js'

function inbox(bytes = new Uint8Array([37,80,68,70,45]), overrides = {}) {
  const entry = { id:'book-1', name:'Book.pdf', mimeType:'application/pdf', size:bytes.length, ...overrides }
  let pending = true
  const bridge = { pending:vi.fn(() => JSON.stringify(pending ? [entry] : [])),
    readChunk:vi.fn((id, offset) => btoa(String.fromCharCode(...bytes.slice(offset, offset + 2)))),
    acknowledge:vi.fn(id => { if (id === entry.id) pending = false }) }
  return bridge
}

describe('Android file intent inbox', () => {
  it('does nothing on web or older APKs', () => {
    expect(() => initAndroidFileImports({ bridge:null })()).not.toThrow()
  })
  it('transfers exact bytes in chunks and acknowledges only after import completes', async () => {
    const bridge = inbox()
    let finish
    const onFile = vi.fn(file => new Promise(resolve => { finish = resolve }))
    const stop = initAndroidFileImports({ bridge, onFile })
    await vi.waitFor(() => expect(onFile).toHaveBeenCalledOnce())
    const file = onFile.mock.calls[0][0]
    expect(file.name).toBe('Book.pdf')
    expect(file.type).toBe('application/pdf')
    expect([...new Uint8Array(await file.arrayBuffer())]).toEqual([37,80,68,70,45])
    expect(bridge.readChunk.mock.calls.map(call => call[1])).toEqual([0,2,4])
    expect(bridge.acknowledge).not.toHaveBeenCalled()
    finish()
    await vi.waitFor(() => expect(bridge.acknowledge).toHaveBeenCalledWith('book-1'))
    stop()
  })
  it('does not consume during a reader transition and resumes on visibility change', async () => {
    const bridge = inbox()
    let available = false
    const onFile = vi.fn()
    const stop = initAndroidFileImports({ bridge, onFile, canImport:() => available })
    expect(bridge.pending).not.toHaveBeenCalled()
    available = true
    document.dispatchEvent(new Event('visibilitychange'))
    await vi.waitFor(() => expect(onFile).toHaveBeenCalledOnce())
    stop()
  })
  it('reports native permission/format failures and clears the failed entry', async () => {
    const bridge = inbox(undefined, { error:'No se pudo leer el archivo.' })
    const onError = vi.fn()
    const onFile = vi.fn()
    const stop = initAndroidFileImports({ bridge, onFile, onError })
    await vi.waitFor(() => expect(onError).toHaveBeenCalledOnce())
    expect(onFile).not.toHaveBeenCalled()
    expect(bridge.acknowledge).toHaveBeenCalledWith('book-1')
    stop()
  })
  it('rejects incomplete transfers instead of importing a corrupt book', async () => {
    const bridge = inbox()
    bridge.readChunk.mockReturnValue('')
    const onError = vi.fn()
    const onFile = vi.fn()
    const stop = initAndroidFileImports({ bridge, onFile, onError })
    await vi.waitFor(() => expect(onError).toHaveBeenCalledOnce())
    expect(onFile).not.toHaveBeenCalled()
    expect(bridge.acknowledge).toHaveBeenCalledWith('book-1')
    stop()
  })
  it('retains the native original after local storage fails, then retries after returning to the app', async () => {
    const bridge = inbox()
    const failure = Object.assign(new Error('Device full'), { code:'LOCAL_BOOK_STORAGE_FAILED' })
    const onFile = vi.fn().mockRejectedValueOnce(failure).mockResolvedValue(undefined)
    const onError = vi.fn()
    const stop = initAndroidFileImports({ bridge, onFile, onError, pollMs:10 })
    try {
      await vi.waitFor(() => expect(onError).toHaveBeenCalledWith(failure))
      expect(bridge.acknowledge).not.toHaveBeenCalled()
      await new Promise(resolve => setTimeout(resolve, 35))
      expect(onFile).toHaveBeenCalledTimes(1)
      document.dispatchEvent(new Event('visibilitychange'))
      await vi.waitFor(() => expect(bridge.acknowledge).toHaveBeenCalledWith('book-1'))
      expect(onFile).toHaveBeenCalledTimes(2)
      expect(JSON.parse(bridge.pending())).toEqual([])
      expect([...new Uint8Array(await onFile.mock.calls[1][0].arrayBuffer())]).toEqual([37,80,68,70,45])
    } finally { stop() }
  })
})
