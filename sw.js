// Generated atomically versioned shell; no ebooks, model weights or auth.
(function createOfflineShell(scope, manifest) {
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
      (entries.has(canonical(url.href)) || /^assets\/[\w.-]+-[\w-]+\.(?:js|mjs|css|wasm|webp|png|woff2?)$/.test(path))
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
    if (!entries.has(key) && !/^assets\/[\w.-]+-[\w-]+\.(?:js|mjs|css|wasm|webp|png|woff2?)$/.test(path)) return null
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
})(self,{"base":"/inhouse-read/","version":"9f62840da166ef87e48b43fca74c0eb8f674540100b2253f662ec5ba8646c9f4","entries":[{"path":"assets/androidDownload-D7DwbcZ_.css","bytes":3434,"sha256":"70faedd41e1e4a2a225bd385810cce3b11edbe92294c7d8daf957d6319c15268"},{"path":"assets/androidDownload-DgOb1xR1.js","bytes":2370,"sha256":"c57aa543d793629c00479fcbfbe3dbb181bc57a5a8c05d8914141bda2819e8c0"},{"path":"assets/comfortaa-cyrillic-6b45c42465cc-BOAN1FIp.woff2","bytes":13684,"sha256":"6b45c42465ccac4ca027469cbeca91a22250be29aca6b1ce451e1f9f83e33671"},{"path":"assets/comfortaa-cyrillic-ext-55eb01e9760f-ChC7iG9O.woff2","bytes":11420,"sha256":"55eb01e9760f8ccf2c06c451960e23e5bafdf53613e02a45b3ef5f7c0d1f9a37"},{"path":"assets/comfortaa-greek-8842a6d24eab-CI18yx3q.woff2","bytes":10104,"sha256":"8842a6d24eabfbe8b6f258b31e4e7c3f22845ba1a854eac0886875c5516f0d49"},{"path":"assets/comfortaa-latin-6c73b639fbea-0N4kuzE-.woff2","bytes":22984,"sha256":"6c73b639fbea04e658ae383a352904d2ef3b0e0810043c78a04455d0fc3759a5"},{"path":"assets/comfortaa-latin-ext-04a638f620eb-CWxWgpTt.woff2","bytes":18952,"sha256":"04a638f620eb84c57aecc01f896349f490bd9ac5fe0e3127674daa86c8628ccf"},{"path":"assets/comfortaa-vietnamese-c3a1539ae148-OrPZY2lq.woff2","bytes":7636,"sha256":"c3a1539ae148d2665dd4f3f02a3388628ccbbe2fbfaa4ac32e20914e46b09ba6"},{"path":"assets/comic-book-bOB0jkeu.js","bytes":1473,"sha256":"4d68ea9d661ba99a652528667ec37aa1d12511c49931f9c9656637acbb62e956"},{"path":"assets/cormorant-garamond-cyrillic-017fab69b4be-BWCqVJN0.woff2","bytes":21168,"sha256":"017fab69b4be8ffc08ca312823327989ade6dc3d948f0afa125e12ec2e5e7ca1"},{"path":"assets/cormorant-garamond-cyrillic-ext-a4d7cf345b80-Bg62sWL9.woff2","bytes":23416,"sha256":"a4d7cf345b8091e1d2c8c5c8fa3bd0f9bb9d00bc8988185471db398ddb5ae4c4"},{"path":"assets/cormorant-garamond-latin-d80df8ff5aec-CUoBjw-S.woff2","bytes":37640,"sha256":"d80df8ff5aecd299a61549f9e29ab1ed0b9b05f4ea71d50fe978e07d5240b235"},{"path":"assets/cormorant-garamond-latin-ext-cfa9a397d86f-ltf1AbuM.woff2","bytes":33736,"sha256":"cfa9a397d86f66c5c51775a2500a712d5f632a04f0c5eca6930dfaf612d4566d"},{"path":"assets/cormorant-garamond-vietnamese-6252e819a766-CDLFB6hb.woff2","bytes":11220,"sha256":"6252e819a7665ae512c2d046308a9016ada63c06d0d8f96984c4b29f6c9e1bd2"},{"path":"assets/cover-color-wasm-C_BaSq53.js","bytes":1161,"sha256":"b2de4f57aa29899d39ad9d9a76de8c9bf7634c46eabbdf4e73dd99eb6674540e"},{"path":"assets/cover-encode-worker-_Wq_Gmsn.js","bytes":460,"sha256":"c03dfe78fb6c33ad778f45561261edadf09dd50e3cd5228b68bac80e87d77ba4"},{"path":"assets/dm-sans-latin-9fea608a947e-Xz1IZZA0.woff2","bytes":36932,"sha256":"9fea608a947e67020c33cad9a6fe3d60c54119dfb8cff87768a8117a15ed7543"},{"path":"assets/dm-sans-latin-ext-a5d38fe99f93-BOFOeGcA.woff2","bytes":18228,"sha256":"a5d38fe99f930275684999b462c7123faa063d9e44e73b4b241723d884aa0f49"},{"path":"assets/engine-B8ZaQK_v.js","bytes":74989,"sha256":"5aca861b2ccd9e37b0fd61798417e7013a4d00ea4010ae7baa6aa6e8eba62d13"},{"path":"assets/epub-CXgI-csK.js","bytes":21901,"sha256":"ebbaf149bcaaef662c6c18498dae483320529d115f0c268ce7f15033dc5d162e"},{"path":"assets/fb2-BI95Dv4-.js","bytes":7036,"sha256":"1dad896e7fb4f60352bf4501935e5b7a27ef38a21a6bc2d0b899a0f7466bdae7"},{"path":"assets/fflate-CtUkkcu7.js","bytes":3813,"sha256":"e562ce45caf3af3e06b9179cc28f426fd2aa188bb803235cd49251538b9cba15"},{"path":"assets/fixed-layout-DEDfRcVO.js","bytes":11046,"sha256":"f0a9ecd5fdd32c410729aad3b2cd4b67505b3643e4dc5290b031f0431caa21e7"},{"path":"assets/foliate-reader-DZCJCnog.js","bytes":18373,"sha256":"c6bf503af3b5acedb6b4a75f1b1432593e757dd8152a85f66a509a724ce802d9"},{"path":"assets/font-glyph-wasm-BxIXEfpP.js","bytes":1774,"sha256":"12b71450e8ea68503b0da36e1fe6928dc3db1d5c9f2186043cac539d8513073c"},{"path":"assets/font-score-client-DsVTxcNP.js","bytes":2119,"sha256":"2d9b509a63346625a623af98d0b7dd83aab00e26167c08e8d753072a40c61567"},{"path":"assets/font-score-worker-GU4h1B1I.js","bytes":5482,"sha256":"2a11797afff7470ef03a9423f7e945850fae4d07992ef50b4ed2800eedcdc3a6"},{"path":"assets/index-CIsDWaQX.js","bytes":3661,"sha256":"e241578d3d680b510aac386b6be7e246d8ad217fe4fe8a7227b08e093edc731b"},{"path":"assets/inhouse_read_core-CmGU4dSK.wasm","bytes":326337,"sha256":"33480e1224dd709007491dd2c48a046570e4e434c9bda9d8bea3a470839eb7c3"},{"path":"assets/inhouse_read_decor-BszMymI8.wasm","bytes":92543,"sha256":"3859b666df84bf9c8c7962ba4fbbbc3723ca35e5e3484b358a4cd18407d1b5f9"},{"path":"assets/lora-cyrillic-c57d9ca3bd42-UWPuZLjM.woff2","bytes":21232,"sha256":"c57d9ca3bd42e6bc093badc7744dd2059a78f66a3a4dc6ca40574480c870f553"},{"path":"assets/lora-cyrillic-ext-0e523e4bc3c6-YcVxMP-u.woff2","bytes":23636,"sha256":"0e523e4bc3c6308f002a3208ea2990cb4f64282d4fbb67c12f5726d13b66eef6"},{"path":"assets/lora-latin-ddb8c6603510-BiLcIKcI.woff2","bytes":37788,"sha256":"ddb8c66035104e233fc024669183aad3738b6daa16deee2ebb1241bd0f98ace1"},{"path":"assets/lora-latin-ext-2a2d9c22c986-C2Wlntb9.woff2","bytes":20088,"sha256":"2a2d9c22c9863086a23f5013fede1428585321812b25f2662542c39d02967c5e"},{"path":"assets/lora-math-a8c4cb778ab6-sOy7rEfW.woff2","bytes":29240,"sha256":"a8c4cb778ab6202d22bdea2ccc8d7e7caf802cfe0a7ce37df7b212f82341468f"},{"path":"assets/lora-symbols-2df52199eac5-DQ5VrUkH.woff2","bytes":17248,"sha256":"2df52199eac56e2ec7a735e609bb151bdab79422c3e73948f4b6580c66bb5a50"},{"path":"assets/lora-vietnamese-98c22de85f6e-CfJ7gtf3.woff2","bytes":8992,"sha256":"98c22de85f6e83bcd6ae1a443e12e256fbc8de7142bec4f76b059f8ff9c2797e"},{"path":"assets/main-CRDYGidI.js","bytes":686415,"sha256":"8b3bdbf1742ff5c7148d2cb51400b64e8a84af76b83249e94cee645a296bf118"},{"path":"assets/main-lUlnNbdc.css","bytes":177757,"sha256":"3047f74a50a99237f33060263e47d8e8f9736c5199f0357a4a8542e2e341244f"},{"path":"assets/mobi-Du_U6_-5.js","bytes":22231,"sha256":"982aaf72307ad5b0b22fe360c59d4f13429484dcd09aa66f7f672bb8f7f0303a"},{"path":"assets/montserrat-cyrillic-a187b077090f-EAA9jha_.woff2","bytes":23828,"sha256":"a187b077090fe8ae3fd2d7496aabbeae604819c718a282e0afc92df72b450766"},{"path":"assets/montserrat-cyrillic-ext-0f7f5f2fbb4e-CO5hGrJv.woff2","bytes":26368,"sha256":"0f7f5f2fbb4eae126790fe6f01659ab3ee0806e8038a941908e893020569f51a"},{"path":"assets/montserrat-latin-06b16db7a969-l_AIctKy.woff2","bytes":37956,"sha256":"06b16db7a969135d48d38c49183be7fb88d4452e2a3011957c7851941f4e4879"},{"path":"assets/montserrat-latin-ext-54d9a78b7ff6-BsZE-iaG.woff2","bytes":70688,"sha256":"54d9a78b7ff60b689ad9f3017ffac8547b5d871afec733f6c1c3ae36577ee504"},{"path":"assets/montserrat-vietnamese-26b2403f995e-k7S-YeeD.woff2","bytes":12928,"sha256":"26b2403f995ed65fb49037a6498c074d3ec3c36031a69fc368c4c2180e2c01fa"},{"path":"assets/oswald-cyrillic-95c3d8d1db01-BSPNd759.woff2","bytes":11748,"sha256":"95c3d8d1db01b5ecd85b0d90aa81d39d24231f74de28c7418cfd8c08261fe929"},{"path":"assets/oswald-cyrillic-ext-fd48ff70d399-Bh-246-H.woff2","bytes":13964,"sha256":"fd48ff70d399cc905ec878993b1a72b6c0a4863c46118ec413e01e1fdc3127c3"},{"path":"assets/oswald-latin-571f3457dab5-9AWb_KF-.woff2","bytes":21472,"sha256":"571f3457dab507b6f2ce5394d593ca015251b69fea81ab7a546bd2368e9fc3ed"},{"path":"assets/oswald-latin-ext-99016932b273-0aIcqSua.woff2","bytes":19104,"sha256":"99016932b273efa7d55b3a0ae9fe4babc6dbdcd7539f58a742697054f89b1142"},{"path":"assets/oswald-vietnamese-0e6ae07493c5-JxfGVIrJ.woff2","bytes":6204,"sha256":"0e6ae07493c5ebae5e815123be8fe99b34f7b13dac4a0907e072e244dd7edcdd"},{"path":"assets/page-paper-tone-worker-CKqMGUjX.js","bytes":767,"sha256":"7048ca76e7b12f39f46ee10c2ca46c658a767e58ddde6b6cd6a9ce065d7d2423"},{"path":"assets/paginator-DwBw-Gqh.js","bytes":25864,"sha256":"fccf95de567fffcd969796460020d337eaf15f08f3f73aa9d7c7dbb05fa5666b"},{"path":"assets/pdf-Bt2xwQ8N.js","bytes":495258,"sha256":"97568c694d71503fd5db522e9e12edf56fb8d913e9c6665f04e1a1bfd31713d5"},{"path":"assets/pdf-reader-CO52-8jo.js","bytes":31194,"sha256":"a2e76a7b4c75f7f83e2f39b0ab1782309b1fe4fc6567d1dd451dc75fe6267bf4"},{"path":"assets/pdf-reader-F60yyvDC.js","bytes":53,"sha256":"1d18f33696e18cd7e9ce36a8f882c1006a499d3c4707527468ee26fec9bd63ab"},{"path":"assets/pdf.worker.min-BmVo14Nb.mjs","bytes":1317034,"sha256":"a33cfe728c584fdba4fcc1fd54bcdc2f9f2f13889ddbb5b2bd1d0f8cbe49b84e"},{"path":"assets/pdf.worker.min-VdxCUbHz.js","bytes":133,"sha256":"454894d5bb9f2c3920202934da609759c1d231b00a2566f291cd29416554e407"},{"path":"assets/plant-catalog-BEpZHlU0.js","bytes":36830,"sha256":"65f5e7eb322abc570ecd6524280a30d3b52dde1b61192a14ddeba003ef5b2ffa"},{"path":"assets/playfair-display-cyrillic-c108681cba6a-5WvUvBgz.woff2","bytes":21152,"sha256":"c108681cba6a9820bff52f4a1a4a1d9edf356b347bd79b7c61e916028e8a8b54"},{"path":"assets/playfair-display-latin-e0c764a8e9e1-BOwq7MWX.woff2","bytes":38404,"sha256":"e0c764a8e9e1cce92163c55bac4b2ad6cd4cf8c696ce2289ab5c41565e65b7e2"},{"path":"assets/playfair-display-latin-ext-42898ad49a6b-CT1r92Rl.woff2","bytes":21140,"sha256":"42898ad49a6b23f32b109243e1df596edf831015ed685f429e4dafbb181d599d"},{"path":"assets/playfair-display-vietnamese-ef6446229b59-Cabi7G8-.woff2","bytes":9112,"sha256":"ef6446229b59773e671021650ef3882cf35806dae723ce047de87c0a6633039a"},{"path":"assets/reader-experience-CTlTG_zq.js","bytes":79613,"sha256":"b1465acbfa91f111a4db7248a03340de554c23a564c6367c83b361fcd9583389"},{"path":"assets/RectAreaLightUniformsLib-fmF4OO_w.js","bytes":247333,"sha256":"334fcbccd77bc5ca3191574e6e9b04035112acc93f3833390628bc65efac27f3"},{"path":"assets/search-D7qEUpRP.js","bytes":2438,"sha256":"204560e2f2fc28311b33003e351def170928994aad62656935c528782ce10578"},{"path":"assets/speech-highlight-KlP2ZRNU.js","bytes":16100,"sha256":"d4e1af19583617a9ebac0e7dacad95aa5839a2de17dba4fcbd12b7fb617fae8a"},{"path":"assets/speech-text-CNMuYAcN.js","bytes":7674,"sha256":"31ea688d80e238fb8768b686826efee1f314be5c32e55a9a289317706ae91552"},{"path":"assets/task-yield-Br56LF4z.js","bytes":312,"sha256":"a69e7a9759cde0c9ad51509a9b597cba9ac8bb75899e1cd7431d88196efd7fc4"},{"path":"assets/three-Bu7fYNf2.js","bytes":536261,"sha256":"977cace223b1bb7064d91588897d36ae96f336c6d8ee83025d49f122768d3dc5"},{"path":"assets/tts-b9tpcooj.js","bytes":5077,"sha256":"9d5cdcb2b1b255dedef1ec9a1025fd75c32a062532be22506bd79a46d7adca48"},{"path":"assets/updater-JwWmTiyy.css","bytes":2154,"sha256":"e69ec307073c56a41c447048afca829ba8290f88fd43549c61be1988eb82141a"},{"path":"assets/updater-nNprJxya.js","bytes":21189,"sha256":"9acb7ab04bc4323b213a80ae5df0d5d5e4e965ac3fa5bc8ba4c8699579e08c63"},{"path":"assets/view-Gpq9VsHW.js","bytes":26157,"sha256":"ec4008cf2424601299acb7238c7e7d3bf69f5432d2c25c7f7252bb89992a6c8b"},{"path":"assets/walnut-Bvq0D-tr.webp","bytes":142822,"sha256":"516e6f79122cc87b88c3f65803fdffb824044c8246cc6ea6ceff75cf928676d0"},{"path":"assets/walnut-pbr-pbhFr_5Z.webp","bytes":209252,"sha256":"7a8435985aaf7415e5614b19b03588291f198dcfa564eec737abdf136b71f6a0"},{"path":"assets/walnut-surface-Doc91G_f.webp","bytes":151604,"sha256":"47cf86d782aebdfe790ff4fa2118a3a641a55af517cbf0259af286fb0f23a8b6"},{"path":"assets/worker-BvHQTSBX.js","bytes":34831,"sha256":"96891f7387070379257cdeff07aa5c9ff0d8c89937b6a9466f7110fceeabcbf8"},{"path":"assets/zip-Y2spjjw9.js","bytes":55585,"sha256":"717b1fb167bec97aeaa78778ff451bde7298f5a1ee00aa1a3de74e9f0d04340c"},{"path":"download-android.html","bytes":3497,"sha256":"6bf3fe48f5bfcb9b20f9364acde9cce13a3f72a4cb1c1214d86dd225d8dfebf6"},{"path":"icons/inhouse-read-logo.png","bytes":9747,"sha256":"6cf196f78e1d9c2b8ffdfb29fdd143e71072bfe3ffadc9ec0cbd472ab879b43c"},{"path":"index.html","bytes":17047,"sha256":"faa12e72e956cbc0dc97b6073c2c50edd89b0561503ec61abd871e68e5a9bfaa"},{"path":"licenses/fonts/comfortaa-OFL.txt","bytes":4426,"sha256":"c1276722229ed1866c84a0ec9eb9db174f091c77ea3a605724ada55c476c0296"},{"path":"licenses/fonts/cormorantgaramond-OFL.txt","bytes":4387,"sha256":"60700d351cac4650c51f3f9db318d2a420f8b45052dba2715eb5fec41f0f6956"},{"path":"licenses/fonts/dmsans-OFL.txt","bytes":4389,"sha256":"2af94f4fb533be8fa23282eb33e08ca311ddf47c2f32777e2040b282deeec65c"},{"path":"licenses/fonts/lora-OFL.txt","bytes":4423,"sha256":"1d9a970809ac804b582a6ce7f0ebc4e7fefcbfd7ff6299cad35ee656a21be716"},{"path":"licenses/fonts/manifest.json","bytes":16762,"sha256":"e524e690ffe7f8e98331c0f1bdd2a317bd60ec759a46b656a0907957602549a9"},{"path":"licenses/fonts/montserrat-OFL.txt","bytes":4400,"sha256":"8b7141c03fa4f8d44e6345d5d4931709290f0f67875e452e95ac1fd3a027802e"},{"path":"licenses/fonts/oswald-OFL.txt","bytes":4390,"sha256":"0687c51a3126ae6963389181135a2eaea02f2e88f31230d27409952f28e84da5"},{"path":"licenses/fonts/playfairdisplay-OFL.txt","bytes":4449,"sha256":"566be814f8e96e93dfa16101331557eb6b5467e9e03f627c0910fe93ca12300e"},{"path":"licenses/fonts/README.txt","bytes":550,"sha256":"7880e14adddae57b267c7348f545c4cdb308ef59fee3b69f369503b2006a2a20"},{"path":"licenses/piper-extra-voices.txt","bytes":1086,"sha256":"e12142804cdd181bf62b3a4d613af27ab9e0fe15b664c5181bea1c75134694b0"},{"path":"licenses/rust-1.99.0-library.html","bytes":1499465,"sha256":"5647be074c8edf7339fd863055923a8fc80bc5610a8d4661ec3b767b9d392c27"},{"path":"licenses/supertonic-sdk-MIT.txt","bytes":1070,"sha256":"0dfe0d0ba84416fe3879d9a34f4909d8d0137c78d1e95834177b0414ac096fa2"},{"path":"licenses/supertonic3-OpenRAIL-M.txt","bytes":15007,"sha256":"0d944a9110fed9a9602d60e0423a272903e7bd21ab060490774efc77c2275e9f"},{"path":"licenses/supertonic3-quantization-NOTICE.txt","bytes":1155,"sha256":"7870e7bd5d88d7ecf2a9b24d88bee80c5e0b73cc7b89406d966b41ee255abd9b"},{"path":"neural-voice/ort/ort-wasm-simd-threaded.mjs","bytes":24381,"sha256":"e13f7f94fc51b4ca72b12faeb1ee95f4ace6dfbc8939bc718aabdc0a27c4299b"},{"path":"neural-voice/ort/ort-wasm-simd-threaded.wasm","bytes":14239897,"sha256":"3398c10d07d229bd91b364548e130e0e51a8e5704b88c7c083ebbeb78842dee2"},{"path":"neural-voice/ort/ort.wasm.min.mjs","bytes":50126,"sha256":"219e6a1fc8a9938268d18efca3c91d310bd2f4a59bbd13744df5b2b7fc6cee3b"},{"path":"neural-voice/phon/piper_phonemize.data","bytes":2232748,"sha256":"d8c6e4fadf82d62414464163fb229738300bf2840e086c230ed6cc0c03a18e71"},{"path":"neural-voice/phon/piper_phonemize.mjs","bytes":107553,"sha256":"5240a0cbc1be87e29c6ffb32ada79252ebd38af100cc45c4f31a1e466c87c543"},{"path":"neural-voice/phon/piper_phonemize.wasm","bytes":629166,"sha256":"2189e43490744c95445e251c38a47063f2ca266bcc30bbb18f692c47ff2bfd23"}]});
