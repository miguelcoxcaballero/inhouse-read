// Fuerza una recarga real cuando el sitio se ha desplegado de nuevo mientras
// la app seguía abierta.
//
// DIAGNÓSTICO (por qué hacía falta esto, no es un cache-control mal puesto):
// esta app es un WebView-shell — al "reabrir" la app Android normalmente NO
// mata el proceso ni recrea la Activity: reanuda el mismo WebView que ya
// tenía en memoria, con el DOM y el JS ya cargados de la vez anterior. Eso
// significa CERO peticiones de red en el resume, así que ningún
// Cache-Control, ETag ni cache-busting en la URL puede ayudar — no hay
// ninguna petición HTTP de la que "invalidar caché". Confirmado revisando
// las cabeceras reales de index.html en producción (Cache-Control:
// max-age=600, razonable) y descartando que fuera eso: el problema es que
// no se llega ni a comprobar la caché porque no hay petición en absoluto.
//
// El arreglo: cuando la app vuelve a primer plano (o cada cierto tiempo
// mientras está abierta), se compara el nombre del bundle JS actualmente
// cargado contra el que referencia el index.html real ahora mismo en el
// servidor (pedido con cache:'no-store', para que ESE fetch puntual sí
// ignore cualquier caché). Como Vite pone un hash de contenido en el nombre
// del archivo, si hay una versión nueva desplegada el nombre cambia sí o sí.
// Si difiere y no se está leyendo un libro en ese momento, se recarga la
// página de verdad — eso sí dispara una petición de red real y trae el
// contenido nuevo.

const CHECK_INTERVAL_MS = 10 * 60 * 1000

function getCurrentBundleSrc() {
  const scripts = [...document.querySelectorAll('script[type="module"][src]')]
  return scripts.find(s => s.src.includes('/assets/main-'))?.src ?? scripts[0]?.src ?? null
}

/** Exportada aparte para poder testear el parseo sin red ni DOM real. */
export function extractModuleScriptSrc(html, baseUrl) {
  // Se buscan las etiquetas <script ...> una a una (en vez de un único regex
  // con type y src en un orden fijo) para no depender del orden en que Vite
  // (o cualquier otra herramienta, en el futuro) escriba los atributos.
  const tags = html.match(/<script\b[^>]*>/gi) ?? []
  for (const tag of tags) {
    if (!/type=["']module["']/i.test(tag)) continue
    const srcMatch = tag.match(/src=["']([^"']+)["']/i)
    if (srcMatch) return new URL(srcMatch[1], baseUrl).href
  }
  return null
}

async function fetchLatestBundleSrc() {
  const res = await fetch(window.location.href, { cache: 'no-store' })
  if (!res.ok) throw new Error(`No se pudo comprobar la versión actual del sitio (${res.status})`)
  return extractModuleScriptSrc(await res.text(), window.location.href)
}

/** No se recarga a media lectura: solo cuando la pantalla del lector está oculta. */
function isSafeToReload() {
  const readerScreen = document.getElementById('reader-screen')
  return !readerScreen || readerScreen.hidden !== false
}

let checking = false

export async function checkContentFreshness() {
  if (checking) return
  checking = true
  try {
    const current = getCurrentBundleSrc()
    if (!current) return
    const latest = await fetchLatestBundleSrc()
    if (!latest || latest === current) return
    if (isSafeToReload()) {
      window.location.reload()
    }
    // Si está leyendo, no se fuerza nada: el próximo chequeo (al volver a la
    // estantería, o el siguiente resume/intervalo) ya lo recogerá.
  } catch (err) {
    console.warn('No se pudo comprobar si hay una versión nueva del sitio:', err)
  } finally {
    checking = false
  }
}

/** Punto de entrada único, llamado desde app.js al arrancar. */
export function initContentFreshnessChecks() {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') checkContentFreshness()
  })
  window.addEventListener('focus', checkContentFreshness)
  setInterval(checkContentFreshness, CHECK_INTERVAL_MS)
}
