// Rellena la tarjeta de descarga consultando en vivo cuál es el último
// release de GitHub — nada de una versión/URL fija en el HTML que se quede
// desactualizada en cuanto se publique un nuevo APK.

const REPO = 'miguelcoxcaballero/inhouse-read'
const API_URL = `https://api.github.com/repos/${REPO}/releases/latest`

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
    renderFallback('El último release no tiene ningún APK adjunto todavía.')
    return
  }

  card.innerHTML = `
    <div class="dl-version">
      <span class="dl-version-tag">${escapeHtml(release.tag_name)}</span>
      <span class="dl-version-date">${escapeHtml(formatDate(release.published_at))}</span>
    </div>
    <a class="dl-button" href="${escapeAttr(apkAsset.browser_download_url)}">
      <svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M12 3v12m0 0l-4-4m4 4l4-4M4 19h16"/>
      </svg>
      Descargar APK (${escapeHtml(humanSize(apkAsset.size))})
    </a>
    <p class="dl-filename">${escapeHtml(apkAsset.name)}</p>
    <a class="dl-secondary-link" href="https://github.com/${REPO}/releases/tag/${encodeURIComponent(release.tag_name)}">
      Ver todos los releases en GitHub →
    </a>
  `
}

function renderFallback(message) {
  card.innerHTML = `
    <p class="dl-status dl-status--error">${escapeHtml(message)}</p>
    <a class="dl-secondary-link" href="https://github.com/${REPO}/releases">
      Ver los releases directamente en GitHub →
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
    const res = await fetch(API_URL, { headers: { Accept: 'application/vnd.github+json' } })
    if (!res.ok) {
      throw new Error(res.status === 403
        ? 'Límite de peticiones a la API de GitHub alcanzado; reintenta en unos minutos.'
        : `GitHub respondió ${res.status}`)
    }
    const release = await res.json()
    renderRelease(release)
  } catch (err) {
    console.error('No se pudo consultar el último release:', err)
    renderFallback('No se pudo consultar automáticamente la última versión.')
  }
}

loadLatestRelease()
