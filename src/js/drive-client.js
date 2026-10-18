import { spineCustomization } from './book-colors.js'
import { cleanQuotes } from './readers/reading-state.js'
import { normalizeDriveBookLength } from './book-length-drive.js'
import { cloudModule } from './cloud-native.js'

// Google Drive access lives in rust-ui/src/drive_client.rs (the web sign-in, the
// Android authorization-code/PKCE flow, the per-request account guard, folders,
// manifests, reading state and uploads). What stays here is the platform: the
// stored sign-in (read by the shelf before any module could load), fetch, crypto,
// Google Identity Services and the Android bridge, handed over as callbacks.
const TOKEN_KEY = 'ihr_drive_session_v2'
const LEGACY_TOKEN_KEY = 'ihn_drive_tokens'
const PROFILE_KEY = 'ihr_drive_profile_v2'
const REFRESH_TOKEN_KEY = 'ihr_drive_refresh_token_v1'
const PKCE_VERIFIER_KEY = 'ihr_drive_pkce_verifier_v1'
const PKCE_TRANSACTION_KEY = 'ihr_drive_pkce_transaction_v1'
// Android OAuth clients are bound to both package name and signing certificate.
// Read's registered client in Notes' Google Cloud project. Custom URI scheme
// must be enabled in Google Auth Platform > Clients > Advanced settings.
const ANDROID_OAUTH_CLIENT_ID = import.meta.env.VITE_ANDROID_OAUTH_CLIENT_ID || '435784295430-tjdos7pgbpr07q9gjpshc6gqd2cvcg43.apps.googleusercontent.com'

let currentToken = ''
let expiresAt = 0

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

function clearToken() {
  currentToken = ''
  expiresAt = 0
  localStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem(LEGACY_TOKEN_KEY)
}

const host = {
  session: {
    token: () => currentToken,
    restore: restoreToken,
    save(token, until) {
      currentToken = token
      expiresAt = until
      localStorage.setItem(TOKEN_KEY, JSON.stringify({ accessToken: token, expiresAt }))
      localStorage.removeItem(LEGACY_TOKEN_KEY)
    },
    clear: clearToken
  },
  storage: {
    getItem: key => localStorage.getItem(key),
    setItem: (key, value) => localStorage.setItem(key, value),
    removeItem: key => localStorage.removeItem(key)
  },
  androidClientId: ANDROID_OAUTH_CLIENT_ID,
  fetch: (url, options) => fetch(url, options),
  randomBytes: length => crypto.getRandomValues(new Uint8Array(length)),
  sha256: bytes => crypto.subtle.digest('SHA-256', bytes),
  randomUUID: () => crypto.randomUUID(),
  google: () => globalThis.google?.accounts?.oauth2,
  bridge: () => globalThis.InhouseNative,
  userAgent: () => navigator.userAgent,
  offline: () => navigator.onLine === false,
  assign: url => globalThis.location.assign(url),
  emit: (type, detail) => globalThis.dispatchEvent(new CustomEvent(type, { detail })),
  warn: message => console.warn(message),
  remembered: getRememberedDriveProfile,
  spineCustomization, cleanQuotes, normalizeDriveBookLength
}

let native = null
let loading = null
function ready() {
  if (native) return Promise.resolve(native)
  return loading ||= cloudModule().then(ui => native ||= new ui.RustDriveClient(host)).finally(() => { loading = null })
}
const later = name => (...args) => native ? native[name](...args) : ready().then(client => client[name](...args))

// MainActivity relays the custom-scheme callback; the persisted transaction survives a recreated WebView,
// so a callback that arrives before the module is in memory is handled as soon as it is.
globalThis.handleInhouseNativeOAuth = payload => {
  if (native) return native.handleNativeOAuth(payload)
  ready().then(client => client.handleNativeOAuth(payload))
  return true
}

export function requestDriveAccess(options) {
  if (native) return native.requestDriveAccess(options)
  const token = restoreToken()
  return token ? Promise.resolve(token) : ready().then(client => client.requestDriveAccess(options))
}

// Signing out and cancelling act at once. Before the module is in memory nothing of it is running, so
// only the stored state needs to go; a request still waiting for the module is cancelled behind it.
export function cancelDriveConnection(message) {
  if (native) return native.cancelDriveConnection(message)
  localStorage.removeItem(PKCE_TRANSACTION_KEY)
  localStorage.removeItem(PKCE_VERIFIER_KEY)
  loading?.then(client => client.cancelDriveConnection(message))
}

export function signOutDrive() {
  if (native) return native.signOutDrive()
  clearToken()
  for (const key of [REFRESH_TOKEN_KEY, PKCE_VERIFIER_KEY, PKCE_TRANSACTION_KEY, PROFILE_KEY]) localStorage.removeItem(key)
  loading?.then(client => client.signOutDrive())
}

export const getOrCreateReadFolder = later('getOrCreateReadFolder')
export const readDriveLibrarySnapshots = later('readDriveLibrarySnapshots')
export const readDriveLibraryRevision = later('readDriveLibraryRevision')
export const getDriveLiveContext = later('getDriveLiveContext')
export const readDriveLiveMailbox = later('readDriveLiveMailbox')
export const writeDriveLiveMailbox = later('writeDriveLiveMailbox')
export const writeDriveLibrarySnapshot = later('writeDriveLibrarySnapshot')
export const uploadDriveCover = later('uploadDriveCover')
export const listDriveBooks = later('listDriveBooks')
export const listAllDriveBooks = later('listAllDriveBooks')
export const getDriveProfile = later('getDriveProfile')
export const downloadDriveFile = later('downloadDriveFile')
export const uploadDriveFile = later('uploadDriveFile')
export const readDriveProgress = later('readDriveProgress')
export const writeDriveProgress = later('writeDriveProgress')
