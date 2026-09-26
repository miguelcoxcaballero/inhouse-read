import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { isDriveConfigured, requestDriveAccess, listDriveBooks, getOrCreateReadFolder, uploadDriveFile, getDriveProfile } from '../../src/js/drive-client.js'

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

  it('lee nombre, correo y foto de la cuenta Google', async () => {
    globalThis.fetch = vi.fn(async url => {
      if (String(url).includes('/about?')) return new Response(JSON.stringify({ user: { displayName: 'Miguel', emailAddress: 'miguel@example.com', photoLink: 'https://example.com/avatar.jpg' } }), { status: 200 })
      return new Response(JSON.stringify({ files: [{ id: 'folder-1', name: 'inhouse read' }] }), { status: 200 })
    })
    await expect(getDriveProfile()).resolves.toEqual({ name: 'Miguel', email: 'miguel@example.com', photo: 'https://example.com/avatar.jpg' })
    expect(globalThis.fetch.mock.calls[0][0]).toContain('/drive/v3/about?fields=')
  })
})

describe('drive-client — retorno OAuth compartido', () => {
  it('envía el verificador PKCE al callback de Notes y valida origen, ventana y estado', () => {
    const source = readFileSync('src/js/drive-client.js', 'utf8')
    expect(source).toContain("const redirectUri = 'https://inhousenotes.com/oauth-callback'")
    expect(source).toContain("event.origin !== 'https://inhousenotes.com' || event.source !== popup")
    expect(source).toContain("type: 'ihr-oauth-exchange', code: event.data.code, verifier, redirectUri, state")
    expect(source).toContain("event.data.type === 'ihr-oauth-token'")
  })
})
