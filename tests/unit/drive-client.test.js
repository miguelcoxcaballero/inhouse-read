import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { webcrypto } from 'node:crypto'

let drive
const token = 'test-access-token'
const session = () => localStorage.setItem('ihr_drive_session_v2', JSON.stringify({ accessToken: token, expiresAt: Date.now() + 3600_000 }))
const json = value => new Response(JSON.stringify(value), { status: 200 })

beforeEach(async () => {
  vi.resetModules()
  vi.stubEnv('VITE_ANDROID_OAUTH_CLIENT_ID', 'read-android-client.apps.googleusercontent.com')
  vi.stubGlobal('crypto', webcrypto)
  localStorage.clear()
  delete globalThis.google
  delete globalThis.InhouseNative
  drive = await import('../../src/js/drive-client.js')
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  delete globalThis.google
  delete globalThis.InhouseNative
  delete globalThis.handleInhouseNativeOAuth
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
    await expect(drive.requestDriveAccess()).rejects.toThrow(/Google está cargando/)
  })

  it('usa el mismo Custom Tab y PKCE de Notes en Android', async () => {
    vi.stubGlobal('navigator', { userAgent: 'InhouseReadApp/1.0.13', onLine: true })
    globalThis.InhouseNative = { openAuthUrl: vi.fn() }
    globalThis.fetch = vi.fn(async () => json({ access_token: token, expires_in: 3600, refresh_token: 'refresh-test', scope: 'https://www.googleapis.com/auth/drive.file' }))
    const pending = drive.requestDriveAccess()
    await vi.waitFor(() => expect(globalThis.InhouseNative.openAuthUrl).toHaveBeenCalledOnce())
    const authUrl = new URL(globalThis.InhouseNative.openAuthUrl.mock.calls[0][0])
    expect(authUrl.origin).toBe('https://accounts.google.com')
    expect(authUrl.searchParams.get('client_id')).toBe('read-android-client.apps.googleusercontent.com')
    expect(authUrl.searchParams.get('redirect_uri')).toBe('com.inhousesoftware.read:/oauth2redirect')
    expect(authUrl.searchParams.get('code_challenge_method')).toBe('S256')
    expect(authUrl.searchParams.get('state')).toHaveLength(43)
    globalThis.handleInhouseNativeOAuth(`code=auth-test&state=${authUrl.searchParams.get('state')}`)
    await expect(pending).resolves.toBe(token)
    expect(new URLSearchParams(globalThis.fetch.mock.calls[0][1].body).get('code_verifier')).toBeTruthy()
    expect(localStorage.getItem('ihr_drive_refresh_token_v1')).toBe('refresh-test')
  })

  it('renueva la sesión Android sin abrir Google otra vez', async () => {
    vi.stubGlobal('navigator', { userAgent: 'InhouseReadApp/1.0.13', onLine: true })
    globalThis.InhouseNative = { openAuthUrl: vi.fn() }
    localStorage.setItem('ihr_drive_refresh_token_v1', 'refresh-test')
    globalThis.fetch = vi.fn(async () => json({ access_token: token, expires_in: 3600 }))
    await expect(drive.requestDriveAccess({ interactive: false })).resolves.toBe(token)
    expect(globalThis.InhouseNative.openAuthUrl).not.toHaveBeenCalled()
    expect(new URLSearchParams(globalThis.fetch.mock.calls[0][1].body).get('grant_type')).toBe('refresh_token')
  })

  it('recupera el callback aunque Android haya recreado la WebView', async () => {
    globalThis.InhouseNative = { openAuthUrl: vi.fn() }
    localStorage.setItem('ihr_drive_pkce_verifier_v1', 'saved-verifier')
    localStorage.setItem('ihr_drive_pkce_transaction_v1', JSON.stringify({ state: 'saved-state', createdAt: Date.now() }))
    globalThis.fetch = vi.fn(async () => json({ access_token: token, expires_in: 3600, refresh_token: 'renew' }))
    const restored = vi.fn()
    globalThis.addEventListener('inhouse-drive-auth', restored)
    expect(globalThis.handleInhouseNativeOAuth('state=saved-state&code=restored-code')).toBe(true)
    await vi.waitFor(() => expect(drive.hasDriveSession()).toBe(true))
    expect(restored.mock.calls[0][0].detail.connected).toBe(true)
    expect(localStorage.getItem('ihr_drive_pkce_transaction_v1')).toBeNull()
    expect(localStorage.getItem('ihr_drive_pkce_verifier_v1')).toBeNull()
    globalThis.removeEventListener('inhouse-drive-auth', restored)
  })

  it('ignora callbacks ajenos sin perder la conexión pendiente', async () => {
    globalThis.InhouseNative = { openAuthUrl: vi.fn() }
    globalThis.fetch = vi.fn(async () => json({ access_token: token }))
    const pending = drive.requestDriveAccess()
    await vi.waitFor(() => expect(globalThis.InhouseNative.openAuthUrl).toHaveBeenCalledOnce())
    const state = new URL(globalThis.InhouseNative.openAuthUrl.mock.calls[0][0]).searchParams.get('state')
    globalThis.handleInhouseNativeOAuth('state=wrong&code=foreign')
    expect(globalThis.fetch).not.toHaveBeenCalled()
    globalThis.handleInhouseNativeOAuth(`state=${state}&code=correct`)
    await expect(pending).resolves.toBe(token)
  })

  it('cerrar sesión durante la renovación no vuelve a guardar credenciales', async () => {
    globalThis.InhouseNative = { openAuthUrl: vi.fn() }
    localStorage.setItem('ihr_drive_refresh_token_v1', 'old-refresh')
    let complete
    globalThis.fetch = vi.fn(() => new Promise(resolve => { complete = resolve }))
    const pending = drive.requestDriveAccess({ interactive: false })
    drive.signOutDrive()
    complete(json({ access_token: token, refresh_token: 'late-refresh' }))
    await expect(pending).rejects.toThrow('Sesión cerrada')
    expect(drive.hasDriveSession()).toBe(false)
    expect(localStorage.getItem('ihr_drive_refresh_token_v1')).toBeNull()
  })

  it('permite cancelar y volver a abrir Google sin reiniciar la app', async () => {
    globalThis.InhouseNative = { openAuthUrl: vi.fn() }
    const first = drive.requestDriveAccess()
    await vi.waitFor(() => expect(globalThis.InhouseNative.openAuthUrl).toHaveBeenCalledOnce())
    const rejected = expect(first).rejects.toThrow('Conexión cancelada')
    drive.cancelDriveConnection()
    await rejected
    const second = drive.requestDriveAccess()
    await vi.waitFor(() => expect(globalThis.InhouseNative.openAuthUrl).toHaveBeenCalledTimes(2))
    const rejectedAgain = expect(second).rejects.toThrow('Conexión cancelada')
    drive.cancelDriveConnection()
    await rejectedAgain
  })

  it('indica que hay que actualizar el APK antiguo antes de conectar', async () => {
    vi.stubGlobal('navigator', { userAgent: 'InhouseReadApp/1.0.8', onLine: true })
    await expect(drive.requestDriveAccess()).rejects.toMatchObject({ code: 'ANDROID_SHELL_OUTDATED' })
  })
})

describe('biblioteca y progreso de Drive', () => {
  beforeEach(() => { session() })

  it('lists an empty account without creating a folder or uploading files', async () => {
    globalThis.fetch = vi.fn(async () => json({ files:[] }))
    await expect(drive.listAllDriveBooks()).resolves.toEqual([])
    expect(globalThis.fetch).toHaveBeenCalledOnce()
    expect(globalThis.fetch.mock.calls[0][1]).not.toHaveProperty('method')
  })
  it('reads missing progress without creating a state folder', async () => {
    globalThis.fetch = vi.fn(async url => String(url).includes('name+%3D+%27inhouse+read%27')
      ? json({ files:[{ id:'root' }] }) : json({ files:[] }))
    await expect(drive.readDriveProgress('book')).resolves.toBeNull()
    expect(globalThis.fetch).toHaveBeenCalledTimes(2)
    for (const [, options] of globalThis.fetch.mock.calls) expect(options).not.toHaveProperty('method')
  })

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
  it('does not restore the old profile after signing out during its request', async () => {
    let finish
    globalThis.fetch = vi.fn(() => new Promise(resolve => { finish = resolve }))
    const profile = drive.getDriveProfile()
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    drive.signOutDrive()
    finish(json({ user:{ permissionId:'old-account', displayName:'Old reader' } }))
    await expect(profile).rejects.toThrow(/conexión.*cambiado/)
    expect(drive.getRememberedDriveProfile()).toBeNull()
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
