import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { webcrypto } from 'node:crypto'
vi.mock('../../src/js/rust-ui.js', async () => (await import('./helpers/rust-ui-real.js')).rustUiMock())
import { Blob as NativeBlob, File as NativeFile } from 'node:buffer'

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
    // The Drive client is created by the first call into it (the Rust module loads then); the timing
    // below concerns a renewal already running, as in the app, so the first call comes before it.
    await drive.requestDriveAccess({ interactive: false }).catch(() => {})
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
  it('writes verified whole-book word metadata in the real state JSON request', async () => {
    vi.stubGlobal('Blob',NativeBlob);vi.stubGlobal('File',NativeFile);session()
    let body
    globalThis.fetch=vi.fn(async (_url,options)=>{body=await options.body.text();return json({id:'state-words'})})
    const bookLength={schemaVersion:1,driveFileId:'book-words',md5Checksum:'a'.repeat(32),byteLength:600,
      wordCount:120000,wordCountVersion:2,wordCountComplete:true}
    await drive.writeDriveProgress('book-words',{fraction:.4,locator:{kind:'pdf-page',value:6},bookLength,updatedAt:123},'state-words')
    const payload=JSON.parse(body.split('\r\n\r\n').at(-1).split('\r\n--')[0])
    expect(payload).toMatchObject({schemaVersion:1,driveFileId:'book-words',bookLength,fraction:.4,locator:{kind:'pdf-page',value:6},updatedAt:123})
    expect(globalThis.fetch.mock.calls[0][1].method).toBe('PATCH')
  })
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

it('checks room revisions with one metadata request after lookup and never downloads book bytes',async()=>{
 session();let changed=false
 globalThis.fetch=vi.fn(async target=>{
  const url=new URL(target),q=url.searchParams.get('q')||''
  if(q.includes("name = 'inhouse read'"))return json({files:[{id:'root'}]})
  if(q.includes("name = '.inhouse-read-state'"))return json({files:[{id:'state'}]})
  expect(q).toBe("'state' in parents and trashed = false")
  expect(url.searchParams.get('fields')).toBe('nextPageToken,files(id,name,modifiedTime,appProperties)')
  expect(url.searchParams.has('alt')).toBe(false)
  return json({files:[{id:'b',name:'library-v1-b.json',modifiedTime:changed?'later':'before'},{id:'a',name:'library-v1-a.json',modifiedTime:'first'},{id:'cover',name:'cover.png',modifiedTime:'ignore'}]})
 })
 const first=await drive.readDriveLibraryRevision();expect(JSON.parse(first)).toEqual([['a','first'],['b','before']]);expect(fetch).toHaveBeenCalledTimes(3)
 expect(await drive.readDriveLibraryRevision()).toBe(first);expect(fetch).toHaveBeenCalledTimes(4)
 changed=true;expect(await drive.readDriveLibraryRevision()).not.toBe(first);expect(fetch).toHaveBeenCalledTimes(5)
 drive.signOutDrive();await expect(drive.readDriveLibraryRevision()).rejects.toThrow(/Conectar|sesión/i)
})

it('confirms the shared live key after creation and returns no OAuth token',async()=>{
 session();let reads=0,patches=0;const winner='W'.repeat(43)
 globalThis.fetch=vi.fn(async(target,options={})=>{
  const url=new URL(target),q=url.searchParams.get('q')||''
  if(q.includes("name = 'inhouse read'"))return json({files:[{id:'root'}]})
  if(q.includes("name = '.inhouse-read-state'"))return json({files:[{id:'state'}]})
  expect(url.pathname).toBe('/drive/v3/files/state');expect(url.searchParams.get('fields')).toBe('id,properties')
  if(options.method==='PATCH'){patches++;const properties=JSON.parse(options.body).properties;expect(properties.ihr_live_key_v1).toMatch(/^[A-Za-z0-9_-]{43}$/);return json({id:'state'})}
  reads++;return json({id:'state',properties:reads===1?{}:{ihr_live_key_v1:winner}})
 })
 expect(await drive.getDriveLiveContext()).toEqual({folderId:'state',key:winner,confirm:true});expect(patches).toBe(1);expect(reads).toBe(2)
 expect(await drive.getDriveLiveContext()).toEqual({folderId:'state',key:winner,confirm:false});expect(patches).toBe(1)
 drive.signOutDrive();await expect(drive.getDriveLiveContext()).rejects.toThrow(/Conectar|sesión/i)
})

it('discovers Android/web mailboxes even when private OAuth appProperties are absent',async()=>{
 session();const peer={id:'live-file',name:'live-v1-foreign-client-123.json',modifiedTime:new Date().toISOString()},events=[]
 const listen=e=>events.push(e.detail);globalThis.addEventListener('inhouse-drive-live-peers',listen)
 globalThis.fetch=vi.fn(async target=>{
  const q=new URL(target).searchParams.get('q')||''
  if(q.includes("name = 'inhouse read'"))return json({files:[{id:'root'}]})
  if(q.includes("name = '.inhouse-read-state'"))return json({files:[{id:'state'}]})
  return json({files:[peer,{id:'other',name:'ordinary.json',appProperties:{ihrKind:'live-v1'}},{id:'bad',name:'live-v1-../invalid.json'}]})
 })
 try{expect(await drive.readDriveLibraryRevision()).toBe('[]');expect(events).toEqual([{folderId:'state',peers:[peer]}])}
 finally{globalThis.removeEventListener('inhouse-drive-live-peers',listen)}
})
it.each([404,503])('preserves HTTP %i so live recovery recreates only deleted files',async status=>{
 session();globalThis.fetch=vi.fn(async()=>new Response(JSON.stringify({error:{message:'failure'}}),{status,headers:{'Content-Type':'application/json'}}))
 await expect(drive.readDriveLiveMailbox('mailbox')).rejects.toMatchObject({message:'failure',status})
})
