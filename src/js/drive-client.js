import '../../vendor/inhouse-services-updater/auth/google-oauth.js'
import { spineCustomization } from './book-colors.js'
import { cleanQuotes } from './readers/reading-state.js'
import { normalizeDriveBookLength } from './book-length-drive.js'
import { driveFetch } from './drive-fetch.js'
import { cloudModule } from './cloud-native.js'

// Drive operations and account-generation guards live in Rust. OAuth lives only in
// the canonical services module imported above; this host supplies app identity,
// storage migration and the UI's early session cache.
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
  oauth.invalidate();
  currentToken = ''
  expiresAt = 0
  localStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem(LEGACY_TOKEN_KEY)
}

// Only identity, storage and UI wiring live here. OAuth is shared with Notes and Paellas.
const oauth = globalThis.InhouseGoogleOAuth.create({
  clientId: '435784295430-cmug30o42f1vu4ijgor9sjb0ro4oo37o.apps.googleusercontent.com',
  scope: 'https://www.googleapis.com/auth/drive.file',
  get androidClientId() { return globalThis.InhouseNative?.openAuthUrl ? ANDROID_OAUTH_CLIENT_ID : undefined },
  redirectUri: 'com.inhousesoftware.read:/oauth2redirect',
  get openAuthUrl() { return globalThis.InhouseNative?.openAuthUrl ? url => globalThis.InhouseNative.openAuthUrl(url) : undefined },
  sessionKey: 'inhouse-read-oauth-v1', refreshKey: REFRESH_TOKEN_KEY,
  transactionKey: PKCE_TRANSACTION_KEY, verifierKey: PKCE_VERIFIER_KEY,
  hint: () => getRememberedDriveProfile()?.emailAddress,
  onToken(data) { host.session.save(data.access_token, data.expiresAt) }
});
const oauthHost = {
  ...oauth,
  requestDriveAccess: (options = {}) => {
    if (/InhouseReadApp\//.test(navigator.userAgent) && !globalThis.InhouseNative?.openAuthUrl) {
      const error = new Error('Update the Android app to connect Google'); error.code = 'ANDROID_SHELL_OUTDATED'; return Promise.reject(error);
    }
    const token = restoreToken();
    return token ? Promise.resolve(token) : oauth.request(options.interactive !== false).then(data => data.access_token);
  },
  handleCallback: payload => {
    const waiting = oauth.hasPendingRequest();
    return oauth.handleCallback(payload).then(data => {
    if (data && !waiting) globalThis.dispatchEvent(new CustomEvent('inhouse-drive-auth', { detail: { connected: true } }));
    return data;
  }).catch(() => globalThis.dispatchEvent(new CustomEvent('inhouse-drive-auth', { detail: { error: 'Google sign-in failed' } })))
  }
};

const host = {
  oauth: oauthHost,
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
  fetch: driveFetch,
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
globalThis.handleInhouseNativeOAuth = payload => { oauthHost.handleCallback(payload); return true }

export function requestDriveAccess(options) { return oauthHost.requestDriveAccess(options) }
export function cancelDriveConnection(message) {
  oauth.cancel();
  if (native) native.cancelDriveConnection(message);
  else loading?.then(client => client.cancelDriveConnection(message));
}
export function signOutDrive() {
  oauth.signOut(); clearToken(); localStorage.removeItem(PROFILE_KEY);
  localStorage.removeItem(PKCE_VERIFIER_KEY);
  if (native) native.signOutDrive();
  else loading?.then(client => client.signOutDrive());
}

export const getOrCreateReadFolder = later('getOrCreateReadFolder')
export const readDriveLibrarySnapshots = later('readDriveLibrarySnapshots')
export const readDriveLibraryRevision = later('readDriveLibraryRevision')
export const readDriveLiveState = later('readDriveLiveState')
export const writeDriveLiveState = later('writeDriveLiveState')
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
