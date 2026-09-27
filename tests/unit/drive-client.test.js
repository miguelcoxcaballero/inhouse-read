import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

let drive
const token = 'test-access-token'
const session = () => localStorage.setItem('ihr_drive_session_v2', JSON.stringify({ accessToken: token, expiresAt: Date.now() + 3600_000 }))
const json = value => new Response(JSON.stringify(value), { status: 200 })

beforeEach(async () => {
  vi.resetModules()
  localStorage.clear()
  delete globalThis.google
  delete globalThis.InhouseNative
  drive = await import('../../src/js/drive-client.js')
})
afterEach(() => {
  vi.unstubAllGlobals()
  delete globalThis.google
  delete globalThis.InhouseNative
  delete globalThis.handleInhouseNativeDriveAuth
})

describe('autorización de Google Drive', () => {
  it('usa el cliente web compartido, sin URI de redirección', async () => {
    expect(drive.isDriveConfigured()).toBe(true)
    let configuration
    globalThis.google = { accounts: { oauth2: { initTokenClient: vi.fn(options => {
      configuration = options
      return { requestAccessToken: vi.fn(() => options.callback({
        access_token: token, expires_in: 3600, scope: 'https://www.googleapis.com/auth/drive.file'
      })) }
    }) } } }
    await expect(drive.requestDriveAccess()).resolves.toBe(token)
    expect(configuration.client_id).toBe('435784295430-cmug30o42f1vu4ijgor9sjb0ro4oo37o.apps.googleusercontent.com')
    expect(configuration.scope).toBe('https://www.googleapis.com/auth/drive.file')
    expect(configuration).not.toHaveProperty('redirect_uri')
    expect(drive.hasDriveSession()).toBe(true)
    drive.signOutDrive()
    expect(drive.hasDriveSession()).toBe(false)
  })

  it('pide conexión explícita cuando falta la sesión', async () => {
    await expect(drive.listDriveBooks()).rejects.toThrow(/Pulsa Conectar/)
    await expect(drive.requestDriveAccess()).rejects.toThrow(/Google aún está cargando/)
  })

  it('usa el puente de Google Play Services en Android', async () => {
    vi.stubGlobal('navigator', { userAgent: 'InhouseReadApp/1.0.12', onLine: true })
    globalThis.InhouseNative = { requestDriveAccess: vi.fn() }
    const pending = drive.requestDriveAccess()
    const [requestId, interactive] = globalThis.InhouseNative.requestDriveAccess.mock.calls[0]
    expect(interactive).toBe(true)
    globalThis.handleInhouseNativeDriveAuth(JSON.stringify({ requestId, accessToken: token, expiresIn: 3000 }))
    await expect(pending).resolves.toBe(token)
  })

  it('no atribuye al usuario un cierre fallido de Google Play Services', async () => {
    vi.stubGlobal('navigator', { userAgent: 'InhouseReadApp/1.0.12', onLine: true })
    globalThis.InhouseNative = { requestDriveAccess: vi.fn() }
    const pending = drive.requestDriveAccess()
    const [requestId] = globalThis.InhouseNative.requestDriveAccess.mock.calls[0]
    globalThis.handleInhouseNativeDriveAuth(JSON.stringify({ requestId, error: 'Acceso a Google cancelado.' }))
    await expect(pending).rejects.toThrow('Google no completó la conexión. Vuelve a intentarlo.')
  })

  it('indica que hay que actualizar el APK antiguo antes de conectar', async () => {
    vi.stubGlobal('navigator', { userAgent: 'InhouseReadApp/1.0.8', onLine: true })
    await expect(drive.requestDriveAccess()).rejects.toMatchObject({ code: 'ANDROID_SHELL_OUTDATED' })
  })
})

describe('biblioteca y progreso de Drive', () => {
  beforeEach(() => { session() })

  it('encuentra la carpeta inhouse read y sube un libro', async () => {
    globalThis.fetch = vi.fn(async url => {
      if (String(url).includes('uploadType=multipart')) return json({ id: 'book-1', name: 'book.pdf' })
      if (String(url).includes('/files?')) return json({ files: [{ id: 'folder-1', name: 'inhouse read' }] })
      return json({})
    })
    expect(await drive.getOrCreateReadFolder()).toBe('folder-1')
    expect(await drive.uploadDriveFile(new File(['pdf'], 'book.pdf', { type: 'application/pdf' }))).toMatchObject({ id: 'book-1' })
    expect(globalThis.fetch.mock.calls.at(-1)[0]).toContain('uploadType=multipart')
  })

  it('pagina todos los libros de la carpeta', async () => {
    globalThis.fetch = vi.fn(async url => {
      const text = String(url)
      if (text.includes('name+%3D+%27inhouse+read%27')) return json({ files: [{ id: 'folder-1' }] })
      if (text.includes('pageToken=next')) return json({ files: [{ id: 'two', name: 'second.epub' }] })
      return json({ files: [{ id: 'one', name: 'first.pdf' }, { id: 'not-book', name: 'info.txt' }], nextPageToken: 'next' })
    })
    await expect(drive.listAllDriveBooks()).resolves.toEqual([
      { id: 'one', name: 'first.pdf' }, { id: 'two', name: 'second.epub' }
    ])
  })

  it('guarda nombre, correo y foto de la cuenta', async () => {
    globalThis.fetch = vi.fn(async () => json({ user: {
      permissionId: 'account-1', displayName: 'Miguel',
      emailAddress: 'miguel@example.com', photoLink: 'https://example.com/avatar.jpg'
    } }))
    await expect(drive.getDriveProfile()).resolves.toEqual({
      id: 'account-1', name: 'Miguel', email: 'miguel@example.com', photo: 'https://example.com/avatar.jpg'
    })
    expect(drive.getRememberedDriveProfile()?.photo).toBe('https://example.com/avatar.jpg')
  })

  it('lee el progreso remoto de la subcarpeta de estado', async () => {
    globalThis.fetch = vi.fn(async url => {
      const text = String(url)
      if (text.includes('name+%3D+%27inhouse+read%27')) return json({ files: [{ id: 'root' }] })
      if (text.includes('name+%3D+%27.inhouse-read-state%27')) return json({ files: [{ id: 'state-folder' }] })
      if (text.includes('name+%3D+%27progress-book-1.json%27')) return json({ files: [{ id: 'state-1', modifiedTime: '2026-09-27T00:00:00Z' }] })
      if (text.includes('state-1?alt=media')) return json({ schemaVersion: 1, driveFileId: 'book-1', fraction: .5, locator: { kind: 'pdf-page', value: 5 }, updatedAt: 123 })
      return json({ files: [] })
    })
    await expect(drive.readDriveProgress('book-1')).resolves.toMatchObject({
      fraction: .5, stateFileId: 'state-1', locator: { kind: 'pdf-page', value: 5 }
    })
  })
})
