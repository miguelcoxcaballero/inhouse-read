// Auto-actualización dentro de la app Android — mismo mecanismo que inhouse
// notes (ver checkForRequiredAndroidUpdate en su app-v5.js, revisado antes de
// escribir esto, no reinventado): la app, solo cuando corre dentro del
// WebView nativo, consulta un manifiesto JSON estático (android-update.json,
// publicado junto al resto del sitio) y si hay una versión más nueva que la
// instalada, ofrece descargarla e instalarla sin salir de la app, delegando
// la descarga/instalación real en el puente nativo (`window.InhouseNative`,
// ver android/html_to_apk_builder.py::patch_webview_bridge).
//
// Esto SOLO hace algo dentro del WebView empaquetado: en el navegador normal
// o la PWA, `detectInhouseApp()` da false y el resto del módulo no hace nada.

const UPDATE_MANIFEST_PATH = 'android-update.json'
const INHOUSE_APP_STORAGE_KEY = 'inhouseReadAppMode'
const LEGACY_ANDROID_APP_VERSION = '1.0.0'
const CHECK_INTERVAL_MS = 15 * 60 * 1000
const ALLOWED_APK_HOSTS = ['github.com', 'raw.githubusercontent.com', 'miguelcoxcaballero.github.io']

// ---- Detección de "corriendo dentro de la app Android" ----
// Tres señales, en este orden: ?inhouse_app=1 en la URL (la pone
// .github/android/app-loader.html al redirigir), el user-agent que fija
// MainActivity ("InhouseReadApp/X.Y.Z"), o quedar recordado en localStorage
// de una detección anterior (para que sobreviva a navegaciones internas que
// no repitan el query param).
export function detectInhouseApp() {
  if (typeof window === 'undefined') return false
  const params = new URLSearchParams(window.location.search)
  const explicitFlag = params.get('inhouse_app') || params.get('app')
  const userAgent = navigator.userAgent || ''
  const fromAppUserAgent = /\bInhouseReadApp\/\d+(?:\.\d+)?\b/i.test(userAgent)

  if (explicitFlag === '0' || explicitFlag === 'false') {
    try { localStorage.removeItem(INHOUSE_APP_STORAGE_KEY) } catch { /* almacenamiento no disponible */ }
    return false
  }
  if (explicitFlag === '1' || explicitFlag === 'true' || fromAppUserAgent) {
    try { localStorage.setItem(INHOUSE_APP_STORAGE_KEY, '1') } catch { /* almacenamiento no disponible */ }
    return true
  }
  try {
    return localStorage.getItem(INHOUSE_APP_STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

/** Compara "1.2.3" contra "1.10.0" numéricamente (no como texto). */
export function compareSemanticVersions(left, right) {
  const parse = value => String(value || '').split('.').map(part => Number.parseInt(part, 10) || 0)
  const a = parse(left)
  const b = parse(right)
  const length = Math.max(a.length, b.length)
  for (let i = 0; i < length; i++) {
    const diff = (a[i] || 0) - (b[i] || 0)
    if (diff !== 0) return diff
  }
  return 0
}

export function getInstalledAndroidAppVersion() {
  if (globalThis.InhouseNative && typeof globalThis.InhouseNative.getAppVersion === 'function') {
    try {
      const nativeVersion = String(globalThis.InhouseNative.getAppVersion() || '').trim()
      if (/^\d+\.\d+\.\d+$/.test(nativeVersion)) return nativeVersion
    } catch { /* el bridge nativo puede no estar listo aún */ }
  }
  const match = String(navigator.userAgent || '').match(/\bInhouseReadApp\/(\d+(?:\.\d+){1,2})\b/i)
  if (match) return match[1]
  return LEGACY_ANDROID_APP_VERSION
}

/** Valida el manifiesto antes de confiar en él: formato de versión y host del APK. */
export function validateManifest(manifest) {
  if (!manifest || typeof manifest !== 'object') throw new Error('Manifiesto de actualización vacío')
  if (!/^\d+\.\d+\.\d+$/.test(String(manifest.version || ''))) {
    throw new Error('Versión de actualización inválida')
  }
  const apkUrl = new URL(String(manifest.apkUrl || ''), window.location.origin)
  if (apkUrl.protocol !== 'https:' || !ALLOWED_APK_HOSTS.includes(apkUrl.hostname)) {
    throw new Error(`Origen de descarga no permitido: ${apkUrl.hostname}`)
  }
  return { ...manifest, apkUrl: apkUrl.toString() }
}

/** ¿Hace falta actualizar? `required !== false` (por defecto sí, como en Notes) + versión más nueva. */
export function shouldOfferUpdate(manifest, installedVersion) {
  return manifest.required !== false && compareSemanticVersions(manifest.version, installedVersion) > 0
}

// ---- UI del aviso de actualización ----

function formatMegabytes(bytes) {
  const value = Math.max(0, Number(bytes) || 0) / (1024 * 1024)
  if (value === 0) return '0 MB'
  return `${value < 10 ? value.toFixed(2) : value.toFixed(1)} MB`
}

function buildGate() {
  const gate = document.createElement('div')
  gate.id = 'android-update-gate'
  gate.className = 'android-update-gate'
  gate.setAttribute('role', 'dialog')
  gate.setAttribute('aria-modal', 'true')
  gate.setAttribute('aria-label', 'Actualización disponible')
  gate.innerHTML = `
    <div class="android-update-card">
      <div class="android-update-head">
        <span class="android-update-icon">
          <svg viewBox="0 0 40 24" width="26" height="16" fill="none" aria-hidden="true">
            <path d="M4 22 L20 6 L36 22" stroke="currentColor" stroke-width="4.2" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </span>
        <div>
          <div class="android-update-eyebrow">inhouse read</div>
          <h2 class="android-update-title">Actualización disponible</h2>
        </div>
      </div>
      <p class="android-update-message" data-update-message></p>
      <div class="android-update-progress" data-update-progress hidden aria-live="polite">
        <div class="android-update-progress-row">
          <strong data-update-percent>0%</strong>
          <span data-update-bytes>0 MB</span>
        </div>
        <div class="android-update-progressbar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" data-update-progressbar>
          <div class="android-update-progressfill" data-update-progressfill></div>
        </div>
      </div>
      <button type="button" class="android-update-install" data-update-install>Instalar actualización</button>
      <p class="android-update-status" data-update-status aria-live="polite"></p>
    </div>`
  document.body.append(gate)
  return gate
}

function renderProgress(gate, payload = {}) {
  const progress = gate.querySelector('[data-update-progress]')
  const percentEl = gate.querySelector('[data-update-percent]')
  const bytesEl = gate.querySelector('[data-update-bytes]')
  const bar = gate.querySelector('[data-update-progressbar]')
  const fill = gate.querySelector('[data-update-progressfill]')
  const downloaded = Math.max(0, Number(payload.downloadedBytes) || 0)
  const total = Math.max(0, Number(payload.totalBytes) || Number(gate.dataset.updateTotalBytes) || 0)
  const calculated = total > 0 ? (downloaded / total) * 100 : 0
  const percent = Math.max(0, Math.min(100, Math.round(
    Number.isFinite(Number(payload.percent)) ? Number(payload.percent) : calculated
  )))
  if (total > 0) gate.dataset.updateTotalBytes = String(total)
  progress.hidden = false
  percentEl.textContent = `${percent}%`
  bytesEl.textContent = total > 0
    ? `${formatMegabytes(downloaded)} / ${formatMegabytes(total)}`
    : `${formatMegabytes(downloaded)} descargados`
  fill.style.width = `${percent}%`
  bar.setAttribute('aria-valuenow', String(percent))
}

function getGate() {
  return document.getElementById('android-update-gate')
}

/** Expuesto globalmente: el puente nativo llama a esto vía evaluateJavascript(). */
export function handleInhouseUpdateResult(payload) {
  let result = payload
  if (typeof result === 'string') {
    try { result = JSON.parse(result) } catch { result = null }
  }
  const gate = getGate()
  if (!gate || !result) return
  const install = gate.querySelector('[data-update-install]')
  const status = gate.querySelector('[data-update-status]')

  if (result.status === 'permission_required') {
    status.textContent = 'Activa "Permitir desde esta fuente", vuelve a Inhouse Read y pulsa Continuar.'
    install.textContent = 'Continuar instalación'
    install.disabled = false
  } else if (result.status === 'downloading') {
    renderProgress(gate, result)
    status.textContent = 'Descargando de forma segura dentro de Inhouse Read…'
    install.disabled = true
  } else if (result.status === 'ready') {
    renderProgress(gate, { ...result, percent: 100 })
    status.textContent = 'Descarga terminada. Confirma la instalación en Android.'
    install.disabled = true
  } else if (result.status === 'error') {
    status.textContent = result.message || 'No se pudo descargar la actualización. Inténtalo de nuevo.'
    install.textContent = 'Reintentar'
    install.disabled = false
  }
}

function showUpdateGate(manifest, installedVersion) {
  const gate = getGate() ?? buildGate()
  gate.dataset.updateTotalBytes = String(Math.max(0, Number(manifest.apkSizeBytes) || 0))
  gate.querySelector('[data-update-message]').textContent =
    `Tienes Inhouse Read ${installedVersion}. Instala la versión ${manifest.version} para continuar.`

  const install = gate.querySelector('[data-update-install]')
  const status = gate.querySelector('[data-update-status]')
  install.onclick = () => {
    status.textContent = 'Preparando la actualización…'
    install.disabled = true
    renderProgress(gate, { downloadedBytes: 0, totalBytes: Number(manifest.apkSizeBytes) || 0, percent: 0 })
    try {
      if (globalThis.InhouseNative && typeof globalThis.InhouseNative.installAppUpdate === 'function') {
        globalThis.InhouseNative.installAppUpdate(manifest.apkUrl, manifest.apkSha256 ?? '')
      } else {
        window.location.assign(manifest.apkUrl)
      }
    } catch {
      status.textContent = 'No se pudo iniciar la descarga. Inténtalo de nuevo.'
      install.disabled = false
    }
  }
}

let checkPromise = null

async function checkForUpdate() {
  if (checkPromise) return checkPromise
  checkPromise = (async () => {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 12000)
    try {
      const url = new URL(UPDATE_MANIFEST_PATH, window.location.href)
      url.searchParams.set('check', String(Date.now()))
      const res = await fetch(url, { cache: 'no-store', signal: controller.signal })
      if (!res.ok) throw new Error(`Update check failed (${res.status})`)
      const manifest = validateManifest(await res.json())
      const installedVersion = getInstalledAndroidAppVersion()
      if (shouldOfferUpdate(manifest, installedVersion)) {
        showUpdateGate(manifest, installedVersion)
      }
    } catch (err) {
      console.warn('Comprobación de actualización de Android fallida:', err)
    } finally {
      clearTimeout(timeoutId)
    }
  })().finally(() => { checkPromise = null })
  return checkPromise
}

/** Punto de entrada único, llamado desde app.js al arrancar. No-op fuera de la app nativa. */
export function initAndroidUpdateChecks() {
  if (!detectInhouseApp()) return
  document.documentElement.dataset.inhouseApp = 'true'
  globalThis.handleInhouseUpdateResult = handleInhouseUpdateResult
  checkForUpdate()
  window.addEventListener('focus', checkForUpdate)
  setInterval(checkForUpdate, CHECK_INTERVAL_MS)
}
