import { spineCustomization } from './book-colors.js'
// The web app uses Google Identity Services. Android uses the same Custom Tab
// + authorization-code/PKCE flow as Inhouse Notes.
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file'
const DRIVE_FILES_URL = 'https://www.googleapis.com/drive/v3/files'
const UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v3/files'
const ABOUT_URL = 'https://www.googleapis.com/drive/v3/about'
const TOKEN_KEY = 'ihr_drive_session_v2'
const LEGACY_TOKEN_KEY = 'ihn_drive_tokens'
const PROFILE_KEY = 'ihr_drive_profile_v2'
const DEFAULT_CLIENT_ID = '435784295430-cmug30o42f1vu4ijgor9sjb0ro4oo37o.apps.googleusercontent.com'
// Android OAuth clients are bound to both package name and signing certificate.
// Read's registered client in Notes' Google Cloud project. Custom URI scheme
// must be enabled in Google Auth Platform > Clients > Advanced settings.
const ANDROID_OAUTH_CLIENT_ID = import.meta.env.VITE_ANDROID_OAUTH_CLIENT_ID || '435784295430-tjdos7pgbpr07q9gjpshc6gqd2cvcg43.apps.googleusercontent.com'
const ANDROID_PKCE_REDIRECT_URI = 'com.inhousesoftware.read:/oauth2redirect'
const REFRESH_TOKEN_KEY = 'ihr_drive_refresh_token_v1'
const PKCE_VERIFIER_KEY = 'ihr_drive_pkce_verifier_v1'
const PKCE_TRANSACTION_KEY = 'ihr_drive_pkce_transaction_v1'
const AUTH_TIMEOUT_MS = 10 * 60_000
const FOLDER_NAME = 'inhouse read'
const STATE_FOLDER_NAME = '.inhouse-read-state'

let currentToken = ''
let expiresAt = 0
let authPromise = null
let folderIdPromise = null
let stateFolderIdPromise = null
let authGeneration = 0
let nativeRequest = null
let callbackExchange = null
const pendingWebRequests = new Set()

function clientId() { return DEFAULT_CLIENT_ID }
function isNativeShell() { return /\bInhouseReadApp\/\d/i.test(navigator.userAgent || '') }
function hasNativeAuthBridge() { return typeof globalThis.InhouseNative?.openAuthUrl === 'function' }

export function isDriveConfigured() { return true }

function storedSession() {
  for (const key of [TOKEN_KEY, LEGACY_TOKEN_KEY]) {
    try {
      const saved = JSON.parse(localStorage.getItem(key) || 'null')
      if (saved?.accessToken && Number(saved.expiresAt) > Date.now() + 60_000) return saved
    } catch { /* damaged storage */ }
  }
  return null
}

function restoreToken() {
  if (currentToken && expiresAt > Date.now() + 60_000) return currentToken
  const stored = storedSession()
  currentToken = stored?.accessToken || ''
  expiresAt = Number(stored?.expiresAt) || 0
  return currentToken
}

export function hasDriveSession() { return Boolean(restoreToken()) }

export function getRememberedDriveProfile() {
  try { return JSON.parse(localStorage.getItem(PROFILE_KEY) || 'null') }
  catch { return null }
}

function saveToken(token, lifetimeSeconds) {
  if (!token) throw new Error('Google no devolvió un token de acceso.')
  currentToken = token
  expiresAt = Date.now() + Math.max(60, Number(lifetimeSeconds) || 3600) * 1000
  localStorage.setItem(TOKEN_KEY, JSON.stringify({ accessToken: token, expiresAt }))
  localStorage.removeItem(LEGACY_TOKEN_KEY)
  return token
}

function clearToken() {
  currentToken = ''
  expiresAt = 0
  localStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem(LEGACY_TOKEN_KEY)
}

function requestWebDriveAccess() {
  const oauth = globalThis.google?.accounts?.oauth2
  if (!oauth?.initTokenClient) {
    throw new Error(navigator.onLine === false
      ? 'Conéctate a Internet para acceder a Google Drive.'
      : 'Google aún está cargando. Vuelve a pulsar Conectar.')
  }
  return new Promise((resolve, reject) => {
    const generation = authGeneration
    const finish = (value, error) => {
      pendingWebRequests.delete(cancel)
      if (error) reject(error)
      else resolve(value)
    }
    const cancel = (message = 'Sesión cerrada.') => finish(null, new Error(message))
    pendingWebRequests.add(cancel)
    try {
    const client = oauth.initTokenClient({
      client_id: clientId(),
      scope: DRIVE_SCOPE,
      include_granted_scopes: true,
      callback: response => {
        if (generation !== authGeneration) return cancel()
        if (response.error) return finish(null, new Error(response.error_description || response.error))
        if (response.scope && !response.scope.split(/\s+/).includes(DRIVE_SCOPE)) {
          return finish(null, new Error('No se concedió acceso a los libros de Drive.'))
        }
        try { finish(saveToken(response.access_token, response.expires_in)) }
        catch (error) { finish(null, error) }
      },
      error_callback: error => {
        const messages = {
          popup_closed: 'Se cerró la ventana de Google. Puedes volver a conectar.',
          popup_failed_to_open: 'El navegador bloqueó la ventana de Google. Permite las ventanas emergentes y vuelve a conectar.'
        }
        finish(null, new Error(messages[error?.type] || 'No se pudo abrir el acceso a Google. Vuelve a intentarlo.'))
      }
    })
    // This runs in the original button click, before an await can lose the
    // browser's user gesture and cause the Google popup to be blocked.
    client.requestAccessToken({ prompt: getRememberedDriveProfile() ? '' : 'consent' })
    } catch (error) { finish(null, error) }
  })
}

// Ported from Notes app-v5.js: generatePkceVerifier, pkceChallengeFromVerifier,
// startAndroidPkceSignIn, exchangeAuthCodeForTokens and refresh-token grant.
function base64UrlEncodeBytes(bytes) {
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function generatePkceVerifier() {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return base64UrlEncodeBytes(bytes)
}

async function pkceChallengeFromVerifier(verifier) {
  const data = new TextEncoder().encode(verifier)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return base64UrlEncodeBytes(new Uint8Array(digest))
}

async function tokenRequest(body, generation = authGeneration) {
  // Same deadline and sign-out guard as Notes' refresh-token request.
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 20_000)
  let response, data
  try {
    response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(), signal: controller.signal
    })
    data = await response.json()
  } catch (error) {
    if (controller.signal.aborted) throw new Error('Google tardó demasiado en responder. Vuelve a intentarlo.')
    throw error
  } finally { clearTimeout(timeout) }
  if (generation !== authGeneration) throw new Error('Sesión cerrada.')
  if (!response.ok || !data?.access_token) {
    const error = new Error(data?.error_description || data?.error || 'Google no devolvió un token de acceso.')
    error.status = response.status
    throw error
  }
  if (data.scope && !data.scope.split(/\s+/).includes(DRIVE_SCOPE)) throw new Error('No se concedió acceso a los libros de Drive.')
  if (data.refresh_token) localStorage.setItem(REFRESH_TOKEN_KEY, data.refresh_token)
  return saveToken(data.access_token, data.expires_in)
}

async function refreshDriveAccessToken() {
  const refreshToken = localStorage.getItem(REFRESH_TOKEN_KEY)
  if (!refreshToken) throw new Error('La sesión de Google ha caducado. Pulsa Conectar para continuar.')
  const body = new URLSearchParams({ client_id: ANDROID_OAUTH_CLIENT_ID, grant_type: 'refresh_token', refresh_token: refreshToken })
  try { return await tokenRequest(body) }
  catch (error) {
    if (error.status === 400 || error.status === 401) localStorage.removeItem(REFRESH_TOKEN_KEY)
    throw error
  }
}

async function startAndroidPkceSignIn(generation) {
  const verifier = generatePkceVerifier()
  const challenge = await pkceChallengeFromVerifier(verifier)
  if (generation !== authGeneration) throw new Error('Conexión cancelada.')
  const state = generatePkceVerifier()
  localStorage.setItem(PKCE_VERIFIER_KEY, verifier)
  localStorage.setItem(PKCE_TRANSACTION_KEY, JSON.stringify({ state, createdAt: Date.now() }))
  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  authUrl.searchParams.set('client_id', ANDROID_OAUTH_CLIENT_ID)
  authUrl.searchParams.set('redirect_uri', ANDROID_PKCE_REDIRECT_URI)
  authUrl.searchParams.set('response_type', 'code')
  authUrl.searchParams.set('scope', DRIVE_SCOPE)
  authUrl.searchParams.set('access_type', 'offline')
  authUrl.searchParams.set('include_granted_scopes', 'true')
  authUrl.searchParams.set('code_challenge', challenge)
  authUrl.searchParams.set('code_challenge_method', 'S256')
  authUrl.searchParams.set('state', state)
  if (!localStorage.getItem(REFRESH_TOKEN_KEY)) authUrl.searchParams.set('prompt', 'consent')
  const url = authUrl.toString()
  // Como en Notes: si el puente nativo no responde de verdad a la llamada
  // (comprobado antes por hasNativeAuthBridge(), pero eso solo mira que la
  // función exista), no te quedas sin hacer nada — se cae a navegar la
  // propia pestaña a la URL de Google.
  if (typeof globalThis.InhouseNative?.openAuthUrl !== 'function') {
    console.warn('PKCE sign-in: puente Android no disponible, se usa el flujo web como respaldo.')
    globalThis.location.assign(url)
    return
  }
  globalThis.InhouseNative.openAuthUrl(url)
}

async function requestNativeDriveAccess(interactive) {
  const generation = authGeneration
  if (!ANDROID_OAUTH_CLIENT_ID) throw new Error('Falta configurar el cliente OAuth Android de Inhouse Read.')
  if (localStorage.getItem(REFRESH_TOKEN_KEY)) {
    try { return await refreshDriveAccessToken() }
    catch (error) { if (!interactive || generation !== authGeneration) throw error }
  }
  if (!interactive) throw new Error('La sesión de Google ha caducado. Pulsa Conectar para continuar.')
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (nativeRequest?.generation !== generation) return
      cancelDriveConnection('La conexión con Google ha caducado. Vuelve a intentarlo.')
    }, AUTH_TIMEOUT_MS)
    const finish = fn => value => { clearTimeout(timer); fn(value) }
    const pending = { resolve: finish(resolve), reject: finish(reject), generation }
    nativeRequest = pending
    startAndroidPkceSignIn(generation).catch(error => {
      if (nativeRequest === pending) nativeRequest = null
      clearTimeout(timer)
      reject(error)
    })
  })
}

// MainActivity relays the custom-scheme callback exactly as Notes does.
globalThis.handleInhouseNativeOAuth = payload => {
  if (callbackExchange) return true // Native delivery can be retried after a reload.
  const pending = nativeRequest
  const generation = authGeneration
  let transaction
  try { transaction = JSON.parse(localStorage.getItem(PKCE_TRANSACTION_KEY) || 'null') } catch { /* damaged storage */ }
  const params = new URLSearchParams(String(payload || '').replace(/^[#?]/, ''))
  // Persisted transaction, as with Notes' verifier, survives Android destroying
  // the WebView while the account chooser is in front. No in-memory promise required.
  if (!transaction || transaction.state !== params.get('state')) return true
  const finishError = error => {
    pending?.reject(error)
    if (!pending && generation === authGeneration) globalThis.dispatchEvent(new CustomEvent('inhouse-drive-auth', { detail: { error: error.message } }))
  }
  nativeRequest = null
  localStorage.removeItem(PKCE_TRANSACTION_KEY)
  const verifier = localStorage.getItem(PKCE_VERIFIER_KEY)
  localStorage.removeItem(PKCE_VERIFIER_KEY)
  if (Date.now() - transaction.createdAt > AUTH_TIMEOUT_MS) {
    finishError(new Error('La conexión con Google ha caducado. Vuelve a intentarlo.'))
    return true
  }
  if (params.get('error')) {
    finishError(new Error(params.get('error') === 'access_denied'
      ? 'No se ha autorizado la conexión con Google.' : 'Google no pudo completar la conexión. Vuelve a intentarlo.'))
    return true
  }
  const code = params.get('code')
  if (!code || !verifier) {
    finishError(new Error('Google no devolvió un código de autorización válido.'))
    return true
  }
  const body = new URLSearchParams({
    client_id: ANDROID_OAUTH_CLIENT_ID, code, code_verifier: verifier,
    grant_type: 'authorization_code', redirect_uri: ANDROID_PKCE_REDIRECT_URI
  })
  const exchange = tokenRequest(body, generation).then(token => {
    pending?.resolve(token)
    if (!pending) globalThis.dispatchEvent(new CustomEvent('inhouse-drive-auth', { detail: { connected: true } }))
    return token
  }).catch(error => {
    finishError(error)
  }).finally(() => { if (callbackExchange === exchange) callbackExchange = null })
  callbackExchange = exchange
  return true
}

export function cancelDriveConnection(message = 'Conexión cancelada.') {
  authGeneration += 1
  for (const cancel of pendingWebRequests) cancel(message)
  if (nativeRequest) nativeRequest.reject(new Error(message))
  nativeRequest = null
  localStorage.removeItem(PKCE_TRANSACTION_KEY)
  localStorage.removeItem(PKCE_VERIFIER_KEY)
  authPromise = null
  callbackExchange = null
}

export function requestDriveAccess({ interactive = true } = {}) {
  if (restoreToken()) return Promise.resolve(currentToken)
  if (authPromise) return authPromise
  if (isNativeShell() && !hasNativeAuthBridge()) {
    const error = new Error('Esta versión de Android no incluye el acceso nativo a Google Drive.')
    error.code = 'ANDROID_SHELL_OUTDATED'
    return Promise.reject(error)
  }
  if (!interactive && !hasNativeAuthBridge()) {
    return Promise.reject(new Error('La sesión de Google ha caducado. Pulsa Conectar para continuar.'))
  }
  try {
    authPromise = Promise.resolve(hasNativeAuthBridge()
      ? requestNativeDriveAccess(interactive)
      : requestWebDriveAccess())
  } catch (error) {
    return Promise.reject(error)
  }
  const request = authPromise
  return request.finally(() => { if (authPromise === request) authPromise = null })
}

export function signOutDrive() {
  cancelDriveConnection('Sesión cerrada.')
  clearToken()
  localStorage.removeItem(REFRESH_TOKEN_KEY)
  localStorage.removeItem(PKCE_VERIFIER_KEY)
  localStorage.removeItem(PROFILE_KEY)
  folderIdPromise = null
  stateFolderIdPromise = null
}

async function accessToken() {
  if (restoreToken()) return currentToken
  return requestDriveAccess({ interactive: false })
}

async function driveFetch(url, options = {}) {
  const token = await accessToken()
  const response = await fetch(url, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, ...options.headers }
  })
  if (!response.ok) {
    if (response.status === 401) clearToken()
    let message = `Google Drive: error ${response.status}`
    try { message = (await response.json()).error?.message || message } catch { /* non-JSON error */ }
    throw new Error(message)
  }
  return response
}

function escapeDriveQuery(value) { return String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'") }

async function findOrCreateFolder(name, parentId) {
  const where = [`name = '${escapeDriveQuery(name)}'`, "mimeType = 'application/vnd.google-apps.folder'", 'trashed = false']
  if (parentId) where.push(`'${parentId}' in parents`)
  const params = new URLSearchParams({
    q: where.join(' and '), spaces: 'drive', fields: 'files(id,name)', pageSize: '100'
  })
  const found = await (await driveFetch(`${DRIVE_FILES_URL}?${params}`)).json()
  if (found.files?.length) return found.files[0].id
  const created = await (await driveFetch(DRIVE_FILES_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder', ...(parentId ? { parents: [parentId] } : {}) })
  })).json()
  return created.id
}

export async function getOrCreateReadFolder() {
  if (!folderIdPromise) folderIdPromise = findOrCreateFolder(FOLDER_NAME).catch(error => { folderIdPromise = null; throw error })
  return folderIdPromise
}

async function getOrCreateStateFolder() {
  if (!stateFolderIdPromise) {
    stateFolderIdPromise = getOrCreateReadFolder()
      .then(parentId => findOrCreateFolder(STATE_FOLDER_NAME, parentId))
      .catch(error => { stateFolderIdPromise = null; throw error })
  }
  return stateFolderIdPromise
}

async function listFolder(folderId, { pageToken, pageSize = 100, fields = 'id,name,mimeType,size,modifiedTime' } = {}) {
  const params = new URLSearchParams({
    q: `'${folderId}' in parents and trashed = false`,
    fields: `nextPageToken,files(${fields})`, pageSize: String(pageSize), spaces: 'drive'
  })
  if (pageToken) params.set('pageToken', pageToken)
  return (await driveFetch(`${DRIVE_FILES_URL}?${params}`)).json()
}

export async function listDriveBooks(options = {}) {
  return listFolder(await getOrCreateReadFolder(), options)
}

export async function listAllDriveBooks() {
  const files = []
  let pageToken
  do {
    const page = await listDriveBooks({ pageToken })
    files.push(...(page.files || []).filter(file => /\.(pdf|epub|mobi|azw|azw3|fb2|cbz)$/i.test(file.name || '')))
    pageToken = page.nextPageToken
  } while (pageToken)
  return files
}

export async function getDriveProfile() {
  const params = new URLSearchParams({ fields: 'user(displayName,emailAddress,photoLink,permissionId)' })
  const user = (await (await driveFetch(`${ABOUT_URL}?${params}`)).json()).user
  if (!user) throw new Error('Google no devolvió los datos de la cuenta.')
  const profile = {
    id: user.permissionId || user.emailAddress || '',
    name: user.displayName || 'Cuenta de Google',
    email: user.emailAddress || '',
    photo: user.photoLink || ''
  }
  localStorage.setItem(PROFILE_KEY, JSON.stringify(profile))
  return profile
}

export async function downloadDriveFile(fileId, { name, mimeType } = {}) {
  const blob = await (await driveFetch(`${DRIVE_FILES_URL}/${encodeURIComponent(fileId)}?alt=media`)).blob()
  return new File([blob], name ?? fileId, { type: mimeType || blob.type || 'application/octet-stream' })
}

export async function uploadDriveFile(file, { driveFileId, name = file.name, parentId } = {}) {
  const folderId = driveFileId ? null : (parentId || await getOrCreateReadFolder())
  const metadata = { name, ...(folderId ? { parents: [folderId] } : {}) }
  const mime = file.type || 'application/octet-stream'
  const endpoint = `${UPLOAD_URL}${driveFileId ? `/${encodeURIComponent(driveFileId)}` : ''}`
  const method = driveFileId ? 'PATCH' : 'POST'
  if (file.size <= 5 * 1024 * 1024) {
    const boundary = `ihr_${crypto.randomUUID()}`
    const body = new Blob([
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`,
      `--${boundary}\r\nContent-Type: ${mime}\r\n\r\n`,
      file, `\r\n--${boundary}--`
    ], { type: `multipart/related; boundary=${boundary}` })
    return (await driveFetch(`${endpoint}?uploadType=multipart&fields=id,name,mimeType,size`, {
      method, headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body
    })).json()
  }
  const start = await driveFetch(`${endpoint}?uploadType=resumable&fields=id,name,mimeType,size`, {
    method,
    headers: {
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Type': mime,
      'X-Upload-Content-Length': String(file.size)
    },
    body: JSON.stringify(metadata)
  })
  const location = start.headers.get('Location')
  if (!location) throw new Error('Drive no devolvió la dirección para subir el libro.')
  return (await driveFetch(location, {
    method: 'PUT', headers: { 'Content-Type': mime }, body: file
  })).json()
}

function stateName(driveFileId) { return `progress-${driveFileId}.json` }

export async function readDriveProgress(driveFileId) {
  const folderId = await getOrCreateStateFolder()
  const params = new URLSearchParams({
    q: `'${folderId}' in parents and name = '${escapeDriveQuery(stateName(driveFileId))}' and trashed = false`,
    fields: 'files(id,name,modifiedTime)', spaces: 'drive', pageSize: '100'
  })
  const files = (await (await driveFetch(`${DRIVE_FILES_URL}?${params}`)).json()).files || []
  if (!files.length) return null
  const latest = files.sort((a, b) => Date.parse(b.modifiedTime) - Date.parse(a.modifiedTime))[0]
  const data = await (await driveFetch(`${DRIVE_FILES_URL}/${encodeURIComponent(latest.id)}?alt=media`)).json()
  if (data?.schemaVersion !== 1 || data.driveFileId !== driveFileId) return null
  return { ...data, stateFileId: latest.id, cloudModifiedAt: Date.parse(latest.modifiedTime) || 0 }
}

export async function writeDriveProgress(driveFileId, progress, stateFileId) {
  const parentId = stateFileId ? undefined : await getOrCreateStateFolder()
  const body = JSON.stringify({
    schemaVersion: 1, driveFileId,
    fraction: Math.min(1, Math.max(0, Number(progress.fraction) || 0)),
    locator: progress.locator ?? null,
    appearance: spineCustomization(progress.appearance),
    readingHistory: Array.isArray(progress.readingHistory) ? progress.readingHistory.slice(0,20) : [],
    bookmarks: Array.isArray(progress.bookmarks) ? progress.bookmarks.slice(0,100) : [],
    updatedAt: Number(progress.updatedAt) || Date.now()
  })
  const file = new File([body], stateName(driveFileId), { type: 'application/json' })
  return uploadDriveFile(file, { driveFileId: stateFileId, parentId })
}
