// Generated atomically versioned shell; no ebooks, model weights or auth.
(function createOfflineShell(scope, manifest) {
  const prefix = 'inhouse-read-shell-v1-'
  const cacheName = prefix + manifest.version
  const base = new URL(manifest.base, scope.location.href)
  const marker = new URL('.offline-shell-complete', base).href
  const entries = new Map(manifest.entries.map(entry => [new URL(entry.path, base).href, entry]))
  const hex = bytes => Array.from(new Uint8Array(bytes), value => value.toString(16).padStart(2, '0')).join('')
  const canonical = url => { const parsed = new URL(url); parsed.search = ''; parsed.hash = ''; return parsed.href }
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
    try {
      // Serial fetches bound peak memory (ORT is ~14 MB). The completion marker
      // is the only promotion: partially written shells are never fallbacks.
      for (const [url, entry] of entries) {
        const response = await scope.fetch(url, {cache:'no-store', credentials:'same-origin'})
        if (!response.ok || response.type === 'opaque') throw new Error(`Offline shell HTTP ${response.status}: ${entry.path}`)
        const body = await response.arrayBuffer()
        if (body.byteLength !== entry.bytes || hex(await scope.crypto.subtle.digest('SHA-256', body)) !== entry.sha256)
          throw new Error(`Offline shell checksum: ${entry.path}`)
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
    await scope.skipWaiting()
  }
  async function activate() {
    if (!await completed(cacheName)) throw new Error('Offline shell is incomplete')
    const caches = await completeCaches()
    // Retain the current and immediately previous complete shell. Never touch
    // books, voice packages, dictionaries or another site's Cache Storage.
    const keep = new Set([cacheName, caches.find(entry => entry.name !== cacheName)?.name])
    for (const {name} of caches) if (!keep.has(name)) await scope.caches.delete(name)
    await scope.clients.claim()
  }
  async function cached(url) {
    for (const {value} of await completeCaches()) {
      const response = await value.cache.match(url)
      if (response) return response
    }
    return null
  }
  function handles(request) {
    const url = new URL(request.url)
    if (request.method !== 'GET' || url.origin !== base.origin || !url.pathname.startsWith(base.pathname) || request.headers?.has('range')) return false
    const path = url.pathname.slice(base.pathname.length)
    if (request.mode === 'navigate') return ['', 'index.html', 'download-android.html'].includes(path)
    if (request.cache === 'no-store') return false
    return !['', 'index.html', 'download-android.html'].includes(path) &&
      (entries.has(canonical(url.href)) || /^assets\/[\w.-]+-[\w-]+\.(?:js|mjs|css|webp|png|woff2?)$/.test(path))
  }
  async function handle(request) {
    if (!handles(request)) return null
    const url = new URL(request.url)
    const path = url.pathname.slice(base.pathname.length)
    // Only real app/document navigations get an HTML fallback. In particular,
    // content-freshness's no-store fetch is never answered with stale HTML.
    if (request.mode === 'navigate' && ['', 'index.html', 'download-android.html'].includes(path)) {
      try {
        const response = await scope.fetch(request, {cache:'no-store'})
        if (response.ok) return response
        const fallback = await cached(new URL(path || 'index.html', base).href)
        return fallback || response
      } catch (error) {
        const fallback = await cached(new URL(path || 'index.html', base).href)
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
})(self,{"base":"/inhouse-read/","version":"82e46fb86dd088effb67fa95f142499104b714d4a2914e07ea6c26faec966389","entries":[{"path":"assets/androidDownload-BC4lIftu.css","bytes":3439,"sha256":"12e991dce3960db0582e441ae330b1d0e9e8bc8dba801f717546f4eebc4984c2"},{"path":"assets/androidDownload-CFBS7vEL.js","bytes":2040,"sha256":"f702d2926888f42367ff8f037b34163d341388a3f2bf91e59b242f055135b088"},{"path":"assets/base-COHSqPRx.css","bytes":2108,"sha256":"4dfe993b63037925ed623fcc6aa88b0cb95930a48d5555d02de52ddda3c4f253"},{"path":"assets/base-COVc8yu5.js","bytes":753,"sha256":"16a98e2e64b8ea27d70cc8b3be64c5c3b69a954ba6b791c951b9d5f5b5ec8653"},{"path":"assets/comic-book-bOB0jkeu.js","bytes":1473,"sha256":"4d68ea9d661ba99a652528667ec37aa1d12511c49931f9c9656637acbb62e956"},{"path":"assets/engine-DEVrGbdn.js","bytes":42158,"sha256":"0a811ad96a822573b05bbd76128779012142089f77c0cfd6e4744f57b9b22625"},{"path":"assets/epub-BcLC41rh.js","bytes":21870,"sha256":"1ede2b7195c692885de6736d2f7e7b5aaa768e4315036627d8d16b3584844742"},{"path":"assets/fb2-BI95Dv4-.js","bytes":7036,"sha256":"1dad896e7fb4f60352bf4501935e5b7a27ef38a21a6bc2d0b899a0f7466bdae7"},{"path":"assets/fflate-CtUkkcu7.js","bytes":3813,"sha256":"e562ce45caf3af3e06b9179cc28f426fd2aa188bb803235cd49251538b9cba15"},{"path":"assets/fixed-layout-DEDfRcVO.js","bytes":11046,"sha256":"f0a9ecd5fdd32c410729aad3b2cd4b67505b3643e4dc5290b031f0431caa21e7"},{"path":"assets/foliate-reader-BWlWvDzF.js","bytes":11041,"sha256":"86c6ebff8f87cf061dc4d68967e048096b3a112536d9c0d4c1baa1d6293991b3"},{"path":"assets/index-Bpbwc-RX.js","bytes":3061,"sha256":"f1a099ddd200354a12b64b0ffccc7289da2f4b20463257c900ffa39afa47b1c6"},{"path":"assets/main-1LxwdAvk.js","bytes":1412772,"sha256":"b9fedc1262c6203c7761cfb06766b4fa8a098535630302c3b59eabc24c2f5ef4"},{"path":"assets/main-DEtyAWwl.css","bytes":121550,"sha256":"04dd7119b20be4d1c5067d580aeca2dc4ae8447763f7aa3a52e501f1848756d3"},{"path":"assets/mobi-Du_U6_-5.js","bytes":22231,"sha256":"982aaf72307ad5b0b22fe360c59d4f13429484dcd09aa66f7f672bb8f7f0303a"},{"path":"assets/paginator-B5ZL1eRy.js","bytes":22799,"sha256":"83a2cad3423c92e40e73c1a3115169ba642956072370b8c1a9db6d6d8c045570"},{"path":"assets/pdf-CQy23OVR.js","bytes":495169,"sha256":"98e67325f4dc980bbec42d12cf2ad17dcf3a472e8661edc4b8ab4ce3aa275d32"},{"path":"assets/pdf-reader-DtrjxpRi.js","bytes":19536,"sha256":"5c7af0641e6e0a5aefe767cb2beb6af7e6b7821558d3849bb686bd876b700472"},{"path":"assets/pdf-reader-F60yyvDC.js","bytes":53,"sha256":"19e44f8327fef169a64484a4b1261c061d47520069839b3a84672486e6577667"},{"path":"assets/pdf.worker.min-BmVo14Nb.mjs","bytes":1317034,"sha256":"a33cfe728c584fdba4fcc1fd54bcdc2f9f2f13889ddbb5b2bd1d0f8cbe49b84e"},{"path":"assets/pdf.worker.min-VdxCUbHz.js","bytes":133,"sha256":"454894d5bb9f2c3920202934da609759c1d231b00a2566f291cd29416554e407"},{"path":"assets/search-D7qEUpRP.js","bytes":2438,"sha256":"204560e2f2fc28311b33003e351def170928994aad62656935c528782ce10578"},{"path":"assets/speech-highlight-CFAiBd54.js","bytes":15546,"sha256":"bfb4ae4b78a6794f75aabd83f026bf393154d61cdd9243d1f07af2769d42ba21"},{"path":"assets/tts-b9tpcooj.js","bytes":5077,"sha256":"9d5cdcb2b1b255dedef1ec9a1025fd75c32a062532be22506bd79a46d7adca48"},{"path":"assets/view-DSbzmACH.js","bytes":25158,"sha256":"98fd43dcf7d8ce5426a33040960b9dde331810a3ca7a6ac28826face53057048"},{"path":"assets/walnut-Bvq0D-tr.webp","bytes":142822,"sha256":"516e6f79122cc87b88c3f65803fdffb824044c8246cc6ea6ceff75cf928676d0"},{"path":"assets/walnut-pbr-pbhFr_5Z.webp","bytes":209252,"sha256":"7a8435985aaf7415e5614b19b03588291f198dcfa564eec737abdf136b71f6a0"},{"path":"assets/walnut-surface-Doc91G_f.webp","bytes":151604,"sha256":"47cf86d782aebdfe790ff4fa2118a3a641a55af517cbf0259af286fb0f23a8b6"},{"path":"assets/worker-DCD_bwvl.js","bytes":26835,"sha256":"ba2833089f0a68c08ca93295ba62930ccf0eaeaad64d7fd5848610057389d2cb"},{"path":"assets/zip-Y2spjjw9.js","bytes":55585,"sha256":"717b1fb167bec97aeaa78778ff451bde7298f5a1ee00aa1a3de74e9f0d04340c"},{"path":"download-android.html","bytes":3152,"sha256":"ef47ee5d420b6612db38aa6317701df88bd9cc72684d9e594beaa78945be9722"},{"path":"icons/inhouse-read-logo.png","bytes":9747,"sha256":"6cf196f78e1d9c2b8ffdfb29fdd143e71072bfe3ffadc9ec0cbd472ab879b43c"},{"path":"index.html","bytes":10735,"sha256":"7499e15efa090ef1db6622578bffb1680686259806a0a3300e2f7be7222c87db"},{"path":"licenses/piper-extra-voices.txt","bytes":1086,"sha256":"e12142804cdd181bf62b3a4d613af27ab9e0fe15b664c5181bea1c75134694b0"},{"path":"licenses/supertonic-sdk-MIT.txt","bytes":1070,"sha256":"0dfe0d0ba84416fe3879d9a34f4909d8d0137c78d1e95834177b0414ac096fa2"},{"path":"licenses/supertonic3-OpenRAIL-M.txt","bytes":15007,"sha256":"0d944a9110fed9a9602d60e0423a272903e7bd21ab060490774efc77c2275e9f"},{"path":"licenses/supertonic3-quantization-NOTICE.txt","bytes":1155,"sha256":"7870e7bd5d88d7ecf2a9b24d88bee80c5e0b73cc7b89406d966b41ee255abd9b"},{"path":"neural-voice/ort/ort-wasm-simd-threaded.mjs","bytes":24381,"sha256":"e13f7f94fc51b4ca72b12faeb1ee95f4ace6dfbc8939bc718aabdc0a27c4299b"},{"path":"neural-voice/ort/ort-wasm-simd-threaded.wasm","bytes":14239897,"sha256":"3398c10d07d229bd91b364548e130e0e51a8e5704b88c7c083ebbeb78842dee2"},{"path":"neural-voice/ort/ort.wasm.min.mjs","bytes":50126,"sha256":"219e6a1fc8a9938268d18efca3c91d310bd2f4a59bbd13744df5b2b7fc6cee3b"},{"path":"neural-voice/phon/piper_phonemize.data","bytes":2232748,"sha256":"d8c6e4fadf82d62414464163fb229738300bf2840e086c230ed6cc0c03a18e71"},{"path":"neural-voice/phon/piper_phonemize.mjs","bytes":107553,"sha256":"5240a0cbc1be87e29c6ffb32ada79252ebd38af100cc45c4f31a1e466c87c543"},{"path":"neural-voice/phon/piper_phonemize.wasm","bytes":629166,"sha256":"2189e43490744c95445e251c38a47063f2ca266bcc30bbb18f692c47ff2bfd23"}]});
