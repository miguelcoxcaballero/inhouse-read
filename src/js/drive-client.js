// Integración con Google Drive: 100% client-side, usando Google Identity
// Services (GIS) para OAuth y la API REST de Drive v3 directamente por
// fetch — sin backend propio, tal y como pide el resto de la arquitectura.
//
// LIMITACIÓN REAL (léase antes de usar en producción): esto requiere un
// OAuth Client ID de un proyecto de Google Cloud. Ese Client ID no se puede
// generar por CLI ni por un agente automatizado: hay que crearlo a mano en
// https://console.cloud.google.com (crear proyecto → configurar pantalla de
// consentimiento OAuth → crear credencial "ID de cliente de OAuth" tipo
// "Aplicación web" → añadir el origen de GitHub Pages, p.ej.
// https://miguelcoxcaballero.github.io, como "Authorized JavaScript
// origin"). Es una limitación de plataforma (Google exige verificación de
// propietario del proyecto), no del código: todo el flujo de abajo es
// funcional en cuanto se rellena `window.INHOUSE_READ_CONFIG.googleClientId`
// en config.js (ver config.example.js).

const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.readonly'
const DRIVE_FILES_URL = 'https://www.googleapis.com/drive/v3/files'
const BOOK_MIME_QUERY = [
  "mimeType='application/pdf'",
  "mimeType='application/epub+zip'",
  "mimeType='application/x-mobipocket-ebook'",
  "mimeType='application/vnd.amazon.ebook'",
  "name contains '.mobi'",
  "name contains '.azw3'",
  "name contains '.fb2'",
  "name contains '.cbz'"
].join(' or ')

export class DriveNotConfiguredError extends Error {}

function getClientId() {
  return globalThis.INHOUSE_READ_CONFIG?.googleClientId ?? null
}

export function isDriveConfigured() {
  return Boolean(getClientId())
}

let tokenClient
let currentToken = null

/** Carga perezosa del script de Google Identity Services. */
function loadGisScript() {
  if (globalThis.google?.accounts?.oauth2) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = 'https://accounts.google.com/gsi/client'
    script.async = true
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('No se pudo cargar Google Identity Services'))
    document.head.append(script)
  })
}

/**
 * Pide un access token al usuario (abre el consentimiento de Google si
 * hace falta) y lo cachea en memoria para la sesión actual.
 */
export async function requestDriveAccess() {
  const clientId = getClientId()
  if (!clientId) {
    throw new DriveNotConfiguredError(
      'Falta googleClientId en config.js — ver el comentario de cabecera de drive-client.js'
    )
  }
  await loadGisScript()

  return new Promise((resolve, reject) => {
    tokenClient = globalThis.google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: DRIVE_SCOPE,
      callback: response => {
        if (response.error) return reject(new Error(response.error))
        currentToken = response.access_token
        resolve(currentToken)
      }
    })
    tokenClient.requestAccessToken()
  })
}

export function hasDriveSession() {
  return Boolean(currentToken)
}

export function signOutDrive() {
  if (currentToken) {
    globalThis.google?.accounts?.oauth2?.revoke?.(currentToken, () => {})
  }
  currentToken = null
}

async function driveFetch(url) {
  if (!currentToken) throw new Error('No hay sesión de Drive activa: llama a requestDriveAccess() primero')
  const res = await fetch(url, { headers: { Authorization: `Bearer ${currentToken}` } })
  if (!res.ok) throw new Error(`Drive API ${res.status}: ${await res.text()}`)
  return res
}

/**
 * Lista los archivos de Drive que parecen libros (por mimeType o extensión
 * conocida), con paginación vía pageToken.
 */
export async function listDriveBooks({ pageToken, pageSize = 50 } = {}) {
  const params = new URLSearchParams({
    q: `(${BOOK_MIME_QUERY}) and trashed=false`,
    fields: 'nextPageToken, files(id, name, mimeType, size, thumbnailLink, modifiedTime)',
    pageSize: String(pageSize),
    spaces: 'drive'
  })
  if (pageToken) params.set('pageToken', pageToken)

  const res = await driveFetch(`${DRIVE_FILES_URL}?${params.toString()}`)
  return res.json()
}

/** Descarga el contenido binario de un archivo de Drive como Blob. */
export async function downloadDriveFile(fileId, { name, mimeType } = {}) {
  const res = await driveFetch(`${DRIVE_FILES_URL}/${fileId}?alt=media`)
  const blob = await res.blob()
  return new File([blob], name ?? fileId, { type: mimeType })
}
