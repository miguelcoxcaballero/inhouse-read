import { describe, it, expect, vi } from 'vitest'
import { restoreLegacyBookBytes } from '../../src/js/legacy-book-recovery.js'

describe('restoreLegacyBookBytes', () => {
  it('recupera las importaciones antiguas de la carpeta permitida antes de subirlas', async () => {
    const library = {
      listAll: vi.fn().mockResolvedValue([
        { id: 'old', sourceType: 'local', name: 'old.epub', size: 5, folderFileName: 'old.epub' },
        { id: 'remote', sourceType: 'local', name: 'remote.pdf', size: 5, driveFileId: 'drive-1', folderFileName: 'remote.pdf' },
        { id: 'missing', sourceType: 'local', name: 'missing.pdf', size: 5, folderFileName: 'missing.pdf' }
      ]),
      patch: vi.fn().mockResolvedValue({})
    }
    const handle = { queryPermission: vi.fn().mockResolvedValue('granted') }
    const readFile = vi.fn(async (_handle, name) => name === 'old.epub'
      ? new File(['ebook'], name, { type: 'application/epub+zip' })
      : null)

    const restored = await restoreLegacyBookBytes(library, {
      supported: () => true, getHandle: async () => handle, readFile
    })

    expect(restored).toBe(1)
    expect(readFile).toHaveBeenCalledTimes(2)
    expect(library.patch).toHaveBeenCalledWith('old', expect.objectContaining({
      mimeType: 'application/epub+zip', content: expect.any(Blob)
    }))
  })

  it('no solicita permisos si la carpeta ya no está autorizada', async () => {
    const library = { listAll: vi.fn(), patch: vi.fn() }
    const handle = { queryPermission: vi.fn().mockResolvedValue('prompt') }
    await expect(restoreLegacyBookBytes(library, {
      supported: () => true, getHandle: async () => handle
    })).resolves.toBe(0)
    expect(library.listAll).not.toHaveBeenCalled()
  })
})
