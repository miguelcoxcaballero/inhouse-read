// The web app uses the Google Identity Services token client, like Inhouse
// Notes. The Android shell uses Google Play services AuthorizationClient.
// Both clients only request access to files created/opened by this app.
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file'
const DRIVE_FILES_URL = 'https://www.googleapis.com/drive/v3/files'
const UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v3/files'
const ABOUT_URL = 'https://www.googleapis.com/drive/v3/about'
const TOKEN_KEY = 'ihr_drive_session_v2'
const LEGACY_TOKEN_KEY = 'ihn_drive_tokens'
const PROFILE_KEY = 'ihr_drive_profile_v2'
const DEFAULT_CLIENT_ID = '435784295430-cmug30o42f1vu4ijgor9sjb0ro4oo37o.apps.googleusercontent.com'
const FOLDER_NAME = 'inhouse read'
const STATE_FOLDER_NAME = '.inhouse-read-state'

let currentToken = ''
let expiresAt = 0
let authPromise = null
let folderIdPromise = null
let stateFolderIdPromise = null
let authGeneration = 0
const nativeRequests = new Map()
const pendingWebRequests = new Set()

function clientId() { return DEFAULT_CLIENT_ID }
function isNativeShell() { return /\bInhouseReadApp\/\d/i.test(navigator.userAgent || '') }
function hasNativeAuthBridge() { return typeof globalThis.InhouseNative?.requestDriveAccess === 'function' }

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
    const cancel = () => finish(null, new Error('Sesión cerrada.'))
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
      error_callback: error => finish(null, new Error(error?.message || error?.type || 'No se pudo abrir el acceso a Google.'))
    })
    // This runs in the original button click, before an await can lose the
    // browser's user gesture and cause the Google popup to be blocked.
    client.requestAccessToken({ prompt: getRememberedDriveProfile() ? '' : 'consent' })
    } catch (error) { finish(null, error) }
  })
}

function requestNativeDriveAccess(interactive) {
  return new Promise((resolve, reject) => {
    const requestId = crypto.randomUUID()
    nativeRequests.set(requestId, { resolve, reject, generation: authGeneration })
    try { globalThis.InhouseNative.requestDriveAccess(requestId, Boolean(interactive)) }
    catch (error) {
      nativeRequests.delete(requestId)
      reject(error)
    }
  })
}

// MainActivity calls this after AuthorizationClient completes or needs a tap.
globalThis.handleInhouseNativeDriveAuth = payload => {
  let result
  try { result = typeof payload === 'string' ? JSON.parse(payload) : payload } catch { return }
  const pending = nativeRequests.get(result?.requestId)
  if (!pending) return
  nativeRequests.delete(result.requestId)
  if (pending.generation !== authGeneration) return
  if (result.error) return pending.reject(new Error(result.error))
  try { pending.resolve(saveToken(result.accessToken, result.expiresIn)) }
  catch (error) { pending.reject(error) }
}

export function requestDriveAccess({ interactive = true } = {}) {
  if (restoreToken()) return Promise.resolve(currentToken)
  if (authPromise) return authPromise
  if (isNativeShell() && !hasNativeAuthBridge()) {
    return Promise.reject(new Error('Actualiza Inhouse Read para conectar Google Drive.'))
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
  return authPromise.finally(() => { authPromise = null })
}

export function signOutDrive() {
  const email = getRememberedDriveProfile()?.email || ''
  authGeneration += 1
  for (const cancel of pendingWebRequests) cancel()
  for (const { reject } of nativeRequests.values()) reject(new Error('Sesión cerrada.'))
  nativeRequests.clear()
  clearToken()
  localStorage.removeItem(PROFILE_KEY)
  folderIdPromise = null
  stateFolderIdPromise = null
  try { globalThis.InhouseNative?.clearDriveAccess?.(email) } catch { /* older shell */ }
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
    updatedAt: Number(progress.updatedAt) || Date.now()
  })
  const file = new File([body], stateName(driveFileId), { type: 'application/json' })
  return uploadDriveFile(file, { driveFileId: stateFileId, parentId })
}
