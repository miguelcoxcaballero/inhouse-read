// Google Drive API client using the same PKCE login, OAuth client and Drive
// scope as Inhouse Notes. Tokens are stored per web origin by the browser.
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file'
const DRIVE_FILES_URL = 'https://www.googleapis.com/drive/v3/files'
const UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v3/files'
const TOKEN_KEY = 'ihn_drive_tokens'
const CLIENT_ID_KEY = 'ihn_drive_client_id'
const DEFAULT_CLIENT_ID = '435784295430-cmug30o42f1vu4ijgor9sjb0ro4oo37o.apps.googleusercontent.com'
const FOLDER_NAME = 'inhouse read'
const APP_ORIGIN = 'https://miguelcoxcaballero.github.io'

let currentToken = null
let authPromise = null
let folderIdPromise = null

function clientId() { return localStorage.getItem(CLIENT_ID_KEY) || DEFAULT_CLIENT_ID }
export function isDriveConfigured() { return Boolean(clientId()) }

function b64url(bytes) {
  let binary = ''
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function createVerifier() {
  const bytes = crypto.getRandomValues(new Uint8Array(64))
  return Array.from(bytes, n => 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~'[n % 66]).join('')
}

function loadStoredToken() {
  try {
    const saved = JSON.parse(localStorage.getItem(TOKEN_KEY) || 'null')
    if (saved?.accessToken && saved?.expiresAt > Date.now() + 30000) currentToken = saved.accessToken
  } catch { /* expired or malformed token; sign in again */ }
}
loadStoredToken()

export function hasDriveSession() {
  try { return Boolean(currentToken || JSON.parse(localStorage.getItem(TOKEN_KEY) || 'null')?.refreshToken) }
  catch { return Boolean(currentToken) }
}

export async function requestDriveAccess() {
  if (authPromise) return authPromise
  loadStoredToken()
  if (currentToken) return currentToken
  authPromise = (async () => {
    const verifier = await createVerifier()
    const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)))
    const state = `${b64url(new TextEncoder().encode(JSON.stringify({ origin: APP_ORIGIN, nonce: crypto.randomUUID() })))}.${crypto.randomUUID()}`
    const redirectUri = 'https://inhousenotes.com/oauth-callback'
    const params = new URLSearchParams({
      client_id: clientId(), redirect_uri: redirectUri, response_type: 'code',
      scope: DRIVE_SCOPE, code_challenge_method: 'S256', code_challenge: challenge,
      access_type: 'offline', prompt: 'consent', state
    })
    const popup = window.open(`https://accounts.google.com/o/oauth2/v2/auth?${params}`, 'oauth', 'width=600,height=700,left=100,top=100')
    if (!popup) throw new Error('Google bloqueó la ventana de inicio de sesión.')
    try {
      const tokens = await new Promise((resolve, reject) => {
        let done = false
        const finish = (fn, value) => { if (done) return; done = true; clearInterval(timer); removeEventListener('message', onMessage); fn(value) }
        const onMessage = event => {
          if (event.origin !== 'https://inhousenotes.com' || event.source !== popup || event.data?.state !== state) return
          if (event.data.type === 'ihr-oauth-code' && event.data.code) {
            popup.postMessage({ type: 'ihr-oauth-exchange', code: event.data.code, verifier, redirectUri, state }, 'https://inhousenotes.com')
          } else if (event.data.type === 'ihr-oauth-token' && event.data.tokens) finish(resolve, event.data.tokens)
          else if (event.data.error) finish(reject, new Error(event.data.error))
        }
        addEventListener('message', onMessage)
        const timer = setInterval(() => { if (popup.closed) finish(reject, new Error('Inicio de sesión cancelado.')) }, 500)
      })
      if (!tokens.refreshToken) throw new Error('Google no devolvió un token renovable. Vuelve a iniciar sesión.')
      currentToken = tokens.accessToken
      localStorage.setItem(TOKEN_KEY, JSON.stringify(tokens))
      return currentToken
    } finally {
      if (!popup.closed) popup.close()
    }
  })()
  try { return await authPromise } finally { authPromise = null }
}

export function signOutDrive() {
  currentToken = null
  localStorage.removeItem(TOKEN_KEY)
  folderIdPromise = null
}

async function accessToken() {
  loadStoredToken()
  let stored
  try { stored = JSON.parse(localStorage.getItem(TOKEN_KEY) || 'null') } catch { stored = null }
  if (!stored?.refreshToken) return requestDriveAccess()
  if (stored.expiresAt > Date.now() + 5 * 60 * 1000 && currentToken) return currentToken
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId(), refresh_token: stored.refreshToken, grant_type: 'refresh_token' })
  })
  if (!response.ok) { signOutDrive(); throw new Error('La sesión de Google ha caducado. Vuelve a iniciar sesión.') }
  const data = await response.json()
  currentToken = data.access_token
  localStorage.setItem(TOKEN_KEY, JSON.stringify({ ...stored, accessToken: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 }))
  return currentToken
}

async function driveFetch(url, options = {}) {
  const token = await accessToken()
  const response = await fetch(url, { ...options, headers: { Authorization: `Bearer ${token}`, ...options.headers } })
  if (!response.ok) {
    let message = `Drive API ${response.status}`
    try { message = (await response.json()).error?.message || message } catch { /* no JSON response */ }
    throw new Error(message)
  }
  return response
}

export async function getOrCreateReadFolder() {
  if (folderIdPromise) return folderIdPromise
  folderIdPromise = (async () => {
    const query = new URLSearchParams({
      q: `name = '${FOLDER_NAME}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
      spaces: 'drive', fields: 'files(id,name)', pageSize: '10'
    })
    const found = await (await driveFetch(`${DRIVE_FILES_URL}?${query}`)).json()
    if (found.files?.length) return found.files[0].id
    const created = await (await driveFetch(DRIVE_FILES_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' }) })).json()
    return created.id
  })()
  try { return await folderIdPromise } catch (error) { folderIdPromise = null; throw error }
}

export async function listDriveBooks({ pageToken, pageSize = 100 } = {}) {
  const folderId = await getOrCreateReadFolder()
  const params = new URLSearchParams({ q: `'${folderId}' in parents and trashed = false`, fields: 'nextPageToken,files(id,name,mimeType,size,modifiedTime)', pageSize: String(pageSize), spaces: 'drive' })
  if (pageToken) params.set('pageToken', pageToken)
  return (await driveFetch(`${DRIVE_FILES_URL}?${params}`)).json()
}

/** Google account details used by the same avatar/account menu as Notes. */
export async function getDriveProfile() {
  const params = new URLSearchParams({ fields: 'user(displayName,emailAddress,photoLink)' })
  const data = await (await driveFetch(`https://www.googleapis.com/drive/v3/about?${params}`)).json()
  const user = data.user
  if (!user) throw new Error('Google no devolvió los datos de la cuenta.')
  return { name: user.displayName || 'Cuenta de Google', email: user.emailAddress || '', photo: user.photoLink || '' }
}

export async function downloadDriveFile(fileId, { name, mimeType } = {}) {
  const blob = await (await driveFetch(`${DRIVE_FILES_URL}/${encodeURIComponent(fileId)}?alt=media`)).blob()
  return new File([blob], name ?? fileId, { type: mimeType || blob.type || 'application/octet-stream' })
}

export async function uploadDriveFile(file, { driveFileId, name = file.name } = {}) {
  const folderId = await getOrCreateReadFolder()
  const token = await accessToken()
  const metadata = { name, ...(driveFileId ? {} : { parents: [folderId] }) }
  const boundary = `ihr_${crypto.randomUUID()}`
  const body = new Blob([`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: ${file.type || 'application/octet-stream'}\r\n\r\n`, file, `\r\n--${boundary}--`], { type: `multipart/related; boundary=${boundary}` })
  if (file.size <= 5 * 1024 * 1024) {
    const url = `${UPLOAD_URL}${driveFileId ? `/${encodeURIComponent(driveFileId)}` : ''}?uploadType=multipart&fields=id,name,mimeType,size`
    return (await driveFetch(url, { method: driveFileId ? 'PATCH' : 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body })).json()
  }
    const startUrl = `${UPLOAD_URL}${driveFileId ? `/${encodeURIComponent(driveFileId)}` : ''}?uploadType=resumable&fields=id,name,mimeType,size`
  const start = await driveFetch(startUrl, { method: driveFileId ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': file.type || 'application/octet-stream', 'X-Upload-Content-Length': String(file.size) }, body: JSON.stringify(metadata) })
  const location = start.headers.get('Location')
  if (!location) throw new Error('Drive no devolvió la dirección para subir el libro.')
  return (await driveFetch(location, { method: 'PUT', headers: { 'Content-Type': file.type || 'application/octet-stream' }, body: file })).json()
}
