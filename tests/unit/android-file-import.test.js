import { describe, it, expect, vi } from 'vitest'
import { initAndroidFileImports } from '../../src/js/android-file-import.js'

function inbox(bytes = new Uint8Array([37,80,68,70,45]), overrides = {}) {
  const entry = { id:'book-1', name:'Book.pdf', mimeType:'application/pdf', size:bytes.length, ...overrides }
  const bridge = { pending:vi.fn(() => JSON.stringify([entry])),
    readChunk:vi.fn((id, offset) => btoa(String.fromCharCode(...bytes.slice(offset, offset + 2)))),
    acknowledge:vi.fn() }
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
})
