import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { isDriveConfigured, requestDriveAccess, listDriveBooks, getOrCreateReadFolder, uploadDriveFile } from '../../src/js/drive-client.js'

describe('drive-client — configuración', () => {
  afterEach(() => {
    delete globalThis.INHOUSE_READ_CONFIG
  })

  it('usa las credenciales compartidas de Inhouse Notes sin config.js', () => {
    expect(isDriveConfigured()).toBe(true)
  })

  it('permite Drive con el cliente compartido de Inhouse Notes', () => {
    expect(isDriveConfigured()).toBe(true)
  })

  it('la API de Drive informa del popup bloqueado al no poder iniciar OAuth', async () => {
    await expect(requestDriveAccess()).rejects.toThrow(/bloqueó la ventana/)
  })
})

describe('drive-client — llamadas sin sesión', () => {
  it('pide inicio de sesión cuando no hay una sesión persistida', async () => {
    await expect(listDriveBooks()).rejects.toThrow(/bloqueó la ventana/)
  })
})

describe('drive-client — carpeta y subida', () => {
  beforeEach(() => {
    localStorage.clear()
    localStorage.setItem('ihn_drive_tokens', JSON.stringify({ accessToken: 'access-token-valid-123456789012345', refreshToken: 'refresh-token-valid-123456789012345', expiresAt: Date.now() + 3600_000 }))
    globalThis.fetch = vi.fn(async url => {
      if (String(url).includes('uploadType=multipart')) return new Response(JSON.stringify({ id: 'book-1', name: 'book.pdf' }), { status: 200 })
      if (String(url).includes('/files?')) return new Response(JSON.stringify({ files: [{ id: 'folder-1', name: 'inhouse read' }] }), { status: 200 })
      return new Response(JSON.stringify({ id: 'book-1', name: 'book.pdf' }), { status: 200 })
    })
  })

  it('encuentra la carpeta inhouse read y la reutiliza', async () => {
    expect(await getOrCreateReadFolder()).toBe('folder-1')
    expect(globalThis.fetch.mock.calls[0][0]).toContain("name+%3D+%27inhouse+read%27")
  })

  it('sube el archivo como multipart a la API de Drive', async () => {
    const file = new File(['pdf'], 'book.pdf', { type: 'application/pdf' })
    expect(await uploadDriveFile(file)).toMatchObject({ id: 'book-1' })
    expect(globalThis.fetch.mock.calls.at(-1)[0]).toContain('uploadType=multipart')
    expect(globalThis.fetch.mock.calls.at(-1)[1].method).toBe('POST')
  })
})
