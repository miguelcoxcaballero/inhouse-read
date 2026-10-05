// This function is serialized into a standalone classic worker by the build.
// Keep dependencies inside it: offline startup must not import another script.
export function createOfflineShell(scope, manifest) {
  const prefix = 'inhouse-read-shell-v1-'
  const cacheName = prefix + manifest.version
  const base = new URL(manifest.base, scope.location.href)
  const marker = new URL('.offline-shell-complete', base).href
  const entries = new Map(manifest.entries.map(entry => [new URL(entry.path, base).href, entry]))
  const hex = bytes => Array.from(new Uint8Array(bytes), value => value.toString(16).padStart(2, '0')).join('')
  const canonical = url => { const parsed = new URL(url); parsed.search = ''; parsed.hash = ''; return parsed.href }
  const documents = ['', 'index.html', 'download-android.html']
  // A reload (no-cache) or a hard reload revalidates against the network, as
  // the HTTP cache would; every other launch of the app opens from the shell.
  const revalidates = request => ['no-cache', 'reload', 'no-store'].includes(request.cache)
  const verified = async (body, entry) => body.byteLength === entry.bytes && hex(await scope.crypto.subtle.digest('SHA-256', body)) === entry.sha256
  // One listing of the complete shells serves every file of a page load; each
  // navigation, install and activation lists them again.
  let shells = null
  const completeShells = () => shells ||= completeCaches().catch(error => { shells = null; throw error })
  async function completed(name) {
    const cache = await scope.caches.open(name)
    const response = await cache.match(marker)
    if (!response) return null
    try {
      const record = await response.json()
      return record.cacheName === name && Array.isArray(record.paths) && record.paths.includes(new URL('index.html', base).href)
        ? {cache, record} : null
    } catch { return null }
  }
  async function completeCaches() {
    const names = (await scope.caches.keys()).filter(name => name.startsWith(prefix))
    const caches = (await Promise.all(names.map(async name => ({name, value:await completed(name)})))).filter(entry => entry.value)
    return caches.sort((a, b) => b.value.record.at - a.value.record.at)
  }
  async function install() {
    const existing = await completed(cacheName)
    if (existing?.record.version === manifest.version) { await scope.skipWaiting(); return }
    const cache = await scope.caches.open(cacheName)
    const previous = (await completeCaches()).filter(({name}) => name !== cacheName)
    try {
      // Serial fetches bound peak memory (ORT is ~14 MB). The completion marker
      // is the only promotion: partially written shells are never fallbacks.
      for (const [url, entry] of entries) {
        // A file the deploy did not change (same path, size and hash) is copied
        // from a previous complete shell, so an update downloads only what changed.
        const kept = await reusable(previous, url, entry)
        if (kept) { await cache.put(url, kept); continue }
        const response = await scope.fetch(url, {cache:'no-store', credentials:'same-origin'})
        if (!response.ok || response.type === 'opaque') throw new Error(`Offline shell HTTP ${response.status}: ${entry.path}`)
        const body = await response.arrayBuffer()
        if (!await verified(body, entry)) throw new Error(`Offline shell checksum: ${entry.path}`)
        const headers = new Headers(response.headers)
        headers.delete('content-encoding'); headers.delete('transfer-encoding'); headers.set('content-length', String(body.byteLength))
        await cache.put(url, new Response(body, {status:response.status, statusText:response.statusText, headers}))
      }
      await cache.put(marker, new Response(JSON.stringify({cacheName, version:manifest.version, at:Date.now(), paths:[...entries.keys()]})))
    } catch (error) {
      await scope.caches.delete(cacheName).catch(() => {})
      throw error
    }
    // Promote only after the complete install. Do not reload any page. Exact
    // hashed chunks from the previous shell remain available to open readers.
    // New offline navigations must use the latest completed shell, even when
    // this worker is still briefly waiting behind an older active worker.
    shells = null
    await scope.skipWaiting()
  }
  async function reusable(previous, url, entry) {
    for (const {value} of previous) {
      const response = await value.cache.match(url)
      if (!response) continue
      const body = await response.arrayBuffer()
      if (await verified(body, entry)) return new Response(body, {status:response.status, statusText:response.statusText, headers:response.headers})
    }
    return null
  }
  async function activate() {
    if (!await completed(cacheName)) throw new Error('Offline shell is incomplete')
    const caches = await completeCaches()
    // Retain the current and immediately previous complete shell. Never touch
    // books, voice packages, dictionaries or another site's Cache Storage.
    const keep = new Set([cacheName, caches.find(entry => entry.name !== cacheName)?.name])
    for (const {name} of caches) if (!keep.has(name)) await scope.caches.delete(name)
    shells = null
    await scope.clients.claim()
  }
  async function cached(url) {
    for (const {value} of await completeShells()) {
      const response = await value.cache.match(url)
      if (response) return response
    }
    return null
  }
  function handles(request) {
    const url = new URL(request.url)
    if (request.method !== 'GET' || url.origin !== base.origin || !url.pathname.startsWith(base.pathname) || request.headers?.has('range')) return false
    const path = url.pathname.slice(base.pathname.length)
    if (request.mode === 'navigate') return documents.includes(path)
    if (request.cache === 'no-store') return false
    return !documents.includes(path) &&
      (entries.has(canonical(url.href)) || /^assets\/[\w.-]+-[\w-]+\.(?:js|mjs|css|webp|png|woff2?)$/.test(path))
  }
  async function handle(request) {
    if (!handles(request)) return null
    const url = new URL(request.url)
    const path = url.pathname.slice(base.pathname.length)
    // Only real app/document navigations get an HTML fallback. In particular,
    // content-freshness's no-store fetch is never answered with stale HTML.
    if (request.mode === 'navigate' && documents.includes(path)) {
      const shell = () => cached(new URL(path || 'index.html', base).href)
      shells = null
      // Launching the app never waits for the network: the newest complete
      // shell answers at once. content-freshness.js compares it with the
      // deployed index.html and reloads into a newer deploy, and that reload
      // revalidates here. The download page keeps asking the network first.
      if (path !== 'download-android.html' && !revalidates(request)) {
        const response = await shell()
        if (response) return response
      }
      try {
        const response = await scope.fetch(request, {cache:'no-store'})
        if (response.ok) return response
        return await shell() || response
      } catch (error) {
        const fallback = await shell()
        if (fallback) return fallback
        throw error
      }
    }
    const key = canonical(url.href)
    // The known shell and old hashed chunks are immutable. Metadata, callback
    // URLs, auth, dictionaries and model downloads deliberately pass through.
    if (!entries.has(key) && !/^assets\/[\w.-]+-[\w-]+\.(?:js|mjs|css|webp|png|woff2?)$/.test(path)) return null
    if (request.cache === 'no-store') return null
    return await cached(key) || scope.fetch(request)
  }
  async function status() {
    return {ready:Boolean(await completed(cacheName)), version:manifest.version,
      entries:manifest.entries.length, bytes:manifest.entries.reduce((sum, entry) => sum + entry.bytes, 0)}
  }
  scope.addEventListener('install', event => event.waitUntil(install()))
  scope.addEventListener('activate', event => event.waitUntil(activate()))
  scope.addEventListener('fetch', event => {
    // Do not even take ownership of metadata/auth/freshness requests. Their
    // normal network headers, browser semantics and interception remain intact.
    if (!handles(event.request)) return
    event.respondWith(handle(event.request))
  })
  scope.addEventListener('message', event => {
    if (event.data?.type === 'offline-shell-status' && event.ports?.[0]) event.waitUntil(status().then(value => event.ports[0].postMessage(value)))
  })
  return {install, activate, handle, status, cacheName}
}
