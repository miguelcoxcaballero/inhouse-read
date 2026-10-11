// A is the default download channel. B requires explicit publication in the common updater.
import '../vendor/inhouse-services-updater/updater.js'

const REPO = 'miguelcoxcaballero/inhouse-read'
const API_URL = `https://raw.githubusercontent.com/${REPO}/main/updates/A.json`

const card = document.getElementById('release-card')

function humanSize(bytes) {
  if (!Number.isFinite(bytes)) return ''
  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`
}

function formatDate(iso) {
  try {
    return new Date(iso).toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' })
  } catch {
    return ''
  }
}

function renderRelease(release) {
  const apkAsset = release.assets?.find(asset => asset.name.endsWith('.apk'))
  if (!apkAsset) {
    renderFallback('La última versión no tiene APK.')
    return
  }

  card.innerHTML = `
    <div class="dl-version">
      <span class="dl-version-tag">${escapeHtml(release.tag_name)} · A</span>
      <span class="dl-version-date">${escapeHtml(formatDate(release.published_at))}</span>
    </div>
    <a class="dl-button" href="${escapeAttr(apkAsset.browser_download_url)}">
      <svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M12 3v12m0 0l-4-4m4 4l4-4M4 19h16"/>
      </svg>
      Descargar APK · ${escapeHtml(humanSize(apkAsset.size))}
    </a>
    <p class="dl-filename">${escapeHtml(apkAsset.name)}</p>
    <a class="dl-secondary-link" href="https://github.com/${REPO}/releases/tag/${encodeURIComponent(release.tag_name)}">
      Todas las versiones →
    </a>
  `
}

function renderFallback(message) {
  card.innerHTML = `
    <p class="dl-status dl-status--error">${escapeHtml(message)}</p>
    <a class="dl-secondary-link" href="https://github.com/${REPO}/releases">
      Ver releases en GitHub →
    </a>
  `
}

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch]))
}

function escapeAttr(str) {
  return escapeHtml(str)
}

async function loadLatestRelease() {
  try {
    const res = await fetch(API_URL + '?check=' + Date.now(), { cache: 'no-store' })
    if (!res.ok) {
      throw new Error(res.status === 403
        ? 'Límite de GitHub alcanzado. Reintenta en unos minutos.'
        : `GitHub respondió ${res.status}`)
    }
    const catalog = window.InhouseServicesUpdater.validateCatalog(await res.json(), 'A', { repository: REPO })
    const release = catalog.latest
    if (!release) { renderFallback('Aún no hay versiones A.'); return }
    const parts = new URL(release.apkUrl).pathname.split('/')
    renderRelease({ tag_name: decodeURIComponent(parts.at(-2)), published_at: release.releasedAt,
      assets: [{ name: decodeURIComponent(parts.at(-1)), size: release.apkSizeBytes, browser_download_url: release.apkUrl }] })
  } catch (err) {
    console.error('No se pudo consultar el último release:', err)
    renderFallback('No se pudo consultar la última versión.')
  }
}

loadLatestRelease()
