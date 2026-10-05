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
//
// A launch is answered from the offline shell without waiting for the network
// (offline-shell-worker.js), so the same check also runs as the app starts.
// A newer deploy is opened right away when nobody has touched the page yet;
// otherwise it waits for the next resume, and the worker's own update has it
// in the shell by the next launch. The reload revalidates against the network
// (a reload navigation is 'no-cache'), so it always lands on the new deploy.

const CHECK_INTERVAL_MS = 10 * 60 * 1000
const RELOAD_KEY = 'inhouse-read-fresh-reload'
const RELOAD_RETRY_MS = 2 * 60 * 1000

/** Exportada aparte para poder testear el parseo sin red ni DOM real. A deploy
 * is told apart by the hashed module scripts and stylesheets its index.html
 * loads (a stylesheet-only deploy keeps the entry module's name). */
export function extractShellSignature(html, baseUrl) {
  const files = []
  // Se buscan las etiquetas una a una (en vez de un único regex con los
  // atributos en un orden fijo) para no depender del orden en que Vite (o
  // cualquier otra herramienta, en el futuro) escriba los atributos.
  for (const tag of html.match(/<(?:script|link)\b[^>]*>/gi) ?? []) {
    const ref = /^<script/i.test(tag)
      ? /type=["']module["']/i.test(tag) && tag.match(/\ssrc=["']([^"']+)["']/i)
      : /rel=["']stylesheet["']/i.test(tag) && tag.match(/\shref=["']([^"']+)["']/i)
    if (ref) files.push(new URL(ref[1], baseUrl).href)
  }
  return files.join(' ')
}

// Read while the app's modules evaluate, before a lazy chunk can add a
// stylesheet of its own to the document.
const startedFrom = typeof document === 'undefined' ? '' : [...document.querySelectorAll('script[type="module"][src], link[rel="stylesheet"][href]')]
  .map(node => node.src || node.href).join(' ')
// index.html asks for the deployed index.html as the page starts; `html` holds
// the answer once it is in.
const deployedAtLaunch = globalThis.__inhouseDeployed
delete globalThis.__inhouseDeployed

async function fetchDeployedHtml(location) {
  const res = await fetch(location.href, { cache: 'no-store' })
  if (!res.ok) throw new Error(`No se pudo comprobar la versión actual del sitio (${res.status})`)
  return res.text()
}

/** No se recarga a media lectura: solo cuando la pantalla del lector está oculta. */
function isSafeToReload() {
  const readerScreen = document.getElementById('reader-screen')
  return !readerScreen || readerScreen.hidden !== false
}

// A deploy that a reload did not bring (an edge cache still serving the old
// index.html) is not reloaded for again straight away.
function reloadInto(latest, location) {
  try {
    const last = JSON.parse(sessionStorage.getItem(RELOAD_KEY) || 'null')
    if (last?.to === latest && Date.now() - last.at < RELOAD_RETRY_MS) return false
    sessionStorage.setItem(RELOAD_KEY, JSON.stringify({ to:latest, at:Date.now() }))
  } catch { /* storage blocked: reload anyway */ }
  location.reload()
  return true
}

/** True when the deployed index.html is a newer app and a reload into it has started. */
function openIfNewer(html, location, canReload) {
  if (typeof html !== 'string' || !startedFrom) return false
  const latest = extractShellSignature(html, location.href)
  if (!latest || latest === startedFrom) return false
  // The offline shell starts fetching the deploy now rather than when the
  // browser next checks on its own, so the next launch opens it directly.
  globalThis.navigator?.serviceWorker?.getRegistration?.().then(registration => registration?.update()).catch(() => {})
  // Si está leyendo, no se fuerza nada: el próximo chequeo (al volver a la
  // estantería, o el siguiente resume/intervalo) ya lo recogerá.
  return canReload() && reloadInto(latest, location)
}

let checking = false

/** Resolves true when it has started a reload into a newer deploy. */
export async function checkContentFreshness({ canReload = isSafeToReload, location = window.location, deployed = null } = {}) {
  if (checking) return false
  checking = true
  try {
    return openIfNewer(await (deployed ?? fetchDeployedHtml(location)), location, canReload)
  } catch (err) {
    console.warn('No se pudo comprobar si hay una versión nueva del sitio:', err)
    return false
  } finally {
    checking = false
  }
}

/** Punto de entrada único, llamado desde app.js al arrancar. `isIdle` says the
 * app has nothing in progress that a reload would lose; `reloading()` tells
 * the app that the page is being replaced by a newer deploy, so it does not
 * build a shelf for it. */
export function initContentFreshnessChecks({ isIdle = () => true, location = window.location, deployed = deployedAtLaunch } = {}) {
  let touched = false, reloading = false
  const touch = () => { touched = true }
  for (const type of ['pointerdown', 'keydown', 'wheel']) window.addEventListener(type, touch, { capture:true, passive:true, once:true })
  const atLaunch = () => !touched && document.visibilityState === 'visible' && isSafeToReload() && isIdle()
  // An answer that came in while the app's code was loading is acted on now,
  // before the shelf is built; a later one as soon as it arrives.
  if (typeof deployed?.html === 'string') reloading = openIfNewer(deployed.html, location, atLaunch)
  else checkContentFreshness({ location, canReload:atLaunch, deployed:deployed?.done }).then(started => { reloading ||= started })
  const check = () => checkContentFreshness({ location })
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') check()
  })
  window.addEventListener('focus', check)
  setInterval(check, CHECK_INTERVAL_MS)
  return { reloading: () => reloading }
}
