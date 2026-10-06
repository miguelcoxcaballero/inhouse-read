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
})(self,{"base":"/inhouse-read/","version":"908cab537b650d12a6de8d94de5784e7cf8965d33408da1ba530c3b746096da0","entries":[{"path":"assets/androidDownload-BC4lIftu.css","bytes":3439,"sha256":"12e991dce3960db0582e441ae330b1d0e9e8bc8dba801f717546f4eebc4984c2"},{"path":"assets/androidDownload-CFBS7vEL.js","bytes":2040,"sha256":"f702d2926888f42367ff8f037b34163d341388a3f2bf91e59b242f055135b088"},{"path":"assets/base-COHSqPRx.css","bytes":2108,"sha256":"4dfe993b63037925ed623fcc6aa88b0cb95930a48d5555d02de52ddda3c4f253"},{"path":"assets/base-COVc8yu5.js","bytes":753,"sha256":"16a98e2e64b8ea27d70cc8b3be64c5c3b69a954ba6b791c951b9d5f5b5ec8653"},{"path":"assets/comfortaa-cyrillic-6b45c42465cc-BOAN1FIp.woff2","bytes":13684,"sha256":"6b45c42465ccac4ca027469cbeca91a22250be29aca6b1ce451e1f9f83e33671"},{"path":"assets/comfortaa-cyrillic-ext-55eb01e9760f-ChC7iG9O.woff2","bytes":11420,"sha256":"55eb01e9760f8ccf2c06c451960e23e5bafdf53613e02a45b3ef5f7c0d1f9a37"},{"path":"assets/comfortaa-greek-8842a6d24eab-CI18yx3q.woff2","bytes":10104,"sha256":"8842a6d24eabfbe8b6f258b31e4e7c3f22845ba1a854eac0886875c5516f0d49"},{"path":"assets/comfortaa-latin-6c73b639fbea-0N4kuzE-.woff2","bytes":22984,"sha256":"6c73b639fbea04e658ae383a352904d2ef3b0e0810043c78a04455d0fc3759a5"},{"path":"assets/comfortaa-latin-ext-04a638f620eb-CWxWgpTt.woff2","bytes":18952,"sha256":"04a638f620eb84c57aecc01f896349f490bd9ac5fe0e3127674daa86c8628ccf"},{"path":"assets/comfortaa-vietnamese-c3a1539ae148-OrPZY2lq.woff2","bytes":7636,"sha256":"c3a1539ae148d2665dd4f3f02a3388628ccbbe2fbfaa4ac32e20914e46b09ba6"},{"path":"assets/comic-book-bOB0jkeu.js","bytes":1473,"sha256":"4d68ea9d661ba99a652528667ec37aa1d12511c49931f9c9656637acbb62e956"},{"path":"assets/cormorant-garamond-cyrillic-017fab69b4be-BWCqVJN0.woff2","bytes":21168,"sha256":"017fab69b4be8ffc08ca312823327989ade6dc3d948f0afa125e12ec2e5e7ca1"},{"path":"assets/cormorant-garamond-cyrillic-ext-a4d7cf345b80-Bg62sWL9.woff2","bytes":23416,"sha256":"a4d7cf345b8091e1d2c8c5c8fa3bd0f9bb9d00bc8988185471db398ddb5ae4c4"},{"path":"assets/cormorant-garamond-latin-d80df8ff5aec-CUoBjw-S.woff2","bytes":37640,"sha256":"d80df8ff5aecd299a61549f9e29ab1ed0b9b05f4ea71d50fe978e07d5240b235"},{"path":"assets/cormorant-garamond-latin-ext-cfa9a397d86f-ltf1AbuM.woff2","bytes":33736,"sha256":"cfa9a397d86f66c5c51775a2500a712d5f632a04f0c5eca6930dfaf612d4566d"},{"path":"assets/cormorant-garamond-vietnamese-6252e819a766-CDLFB6hb.woff2","bytes":11220,"sha256":"6252e819a7665ae512c2d046308a9016ada63c06d0d8f96984c4b29f6c9e1bd2"},{"path":"assets/cover-encode-worker-_Wq_Gmsn.js","bytes":460,"sha256":"c03dfe78fb6c33ad778f45561261edadf09dd50e3cd5228b68bac80e87d77ba4"},{"path":"assets/dm-sans-latin-9fea608a947e-Xz1IZZA0.woff2","bytes":36932,"sha256":"9fea608a947e67020c33cad9a6fe3d60c54119dfb8cff87768a8117a15ed7543"},{"path":"assets/dm-sans-latin-ext-a5d38fe99f93-BOFOeGcA.woff2","bytes":18228,"sha256":"a5d38fe99f930275684999b462c7123faa063d9e44e73b4b241723d884aa0f49"},{"path":"assets/engine-udzyioVE.js","bytes":65846,"sha256":"3c51f76be07772867a9f493998dea1b35a9c5743cf799fdee5687e7935a08d1a"},{"path":"assets/epub-Xbe12Mzn.js","bytes":21898,"sha256":"64bdc31294dabf1b491b7fcf3ed53dacf7219311e820f4127f46db563f6e9567"},{"path":"assets/fb2-BI95Dv4-.js","bytes":7036,"sha256":"1dad896e7fb4f60352bf4501935e5b7a27ef38a21a6bc2d0b899a0f7466bdae7"},{"path":"assets/fflate-CtUkkcu7.js","bytes":3813,"sha256":"e562ce45caf3af3e06b9179cc28f426fd2aa188bb803235cd49251538b9cba15"},{"path":"assets/fixed-layout-DEDfRcVO.js","bytes":11046,"sha256":"f0a9ecd5fdd32c410729aad3b2cd4b67505b3643e4dc5290b031f0431caa21e7"},{"path":"assets/foliate-reader-hWk6Z8eh.js","bytes":15508,"sha256":"21579850b2d790054fe084298b8d6448020b7a74f06a0ea4123f906372d0b7ca"},{"path":"assets/font-score-client-DVokH2mG.js","bytes":2119,"sha256":"4b3032fb063061f7a10967b6adba37fc84f78431f58b3d9e0b413e037f302ce6"},{"path":"assets/font-score-worker-B-eQN0MQ.js","bytes":2122,"sha256":"5ea916d04cc9395b81105b82e34ad50fb250060c405aa720f2dc3f67b60851a4"},{"path":"assets/index-B7DCdcD8.js","bytes":3488,"sha256":"0fb77831eb09bcc88ca5f3c8ea56613083260488089778c9404147e232366dde"},{"path":"assets/lora-cyrillic-c57d9ca3bd42-UWPuZLjM.woff2","bytes":21232,"sha256":"c57d9ca3bd42e6bc093badc7744dd2059a78f66a3a4dc6ca40574480c870f553"},{"path":"assets/lora-cyrillic-ext-0e523e4bc3c6-YcVxMP-u.woff2","bytes":23636,"sha256":"0e523e4bc3c6308f002a3208ea2990cb4f64282d4fbb67c12f5726d13b66eef6"},{"path":"assets/lora-latin-ddb8c6603510-BiLcIKcI.woff2","bytes":37788,"sha256":"ddb8c66035104e233fc024669183aad3738b6daa16deee2ebb1241bd0f98ace1"},{"path":"assets/lora-latin-ext-2a2d9c22c986-C2Wlntb9.woff2","bytes":20088,"sha256":"2a2d9c22c9863086a23f5013fede1428585321812b25f2662542c39d02967c5e"},{"path":"assets/lora-math-a8c4cb778ab6-sOy7rEfW.woff2","bytes":29240,"sha256":"a8c4cb778ab6202d22bdea2ccc8d7e7caf802cfe0a7ce37df7b212f82341468f"},{"path":"assets/lora-symbols-2df52199eac5-DQ5VrUkH.woff2","bytes":17248,"sha256":"2df52199eac56e2ec7a735e609bb151bdab79422c3e73948f4b6580c66bb5a50"},{"path":"assets/lora-vietnamese-98c22de85f6e-CfJ7gtf3.woff2","bytes":8992,"sha256":"98c22de85f6e83bcd6ae1a443e12e256fbc8de7142bec4f76b059f8ff9c2797e"},{"path":"assets/main-alvQMpSZ.js","bytes":591519,"sha256":"f749642095e5863cf825b6d1f6b9b8f1bda1be7c6d5d58888a0022b3b4c9f836"},{"path":"assets/main-CV1JCvaE.css","bytes":155470,"sha256":"486c5780ac6eabafe5f7d44a24048856c9611f027d72c2085685b2ce093d4f68"},{"path":"assets/mobi-Du_U6_-5.js","bytes":22231,"sha256":"982aaf72307ad5b0b22fe360c59d4f13429484dcd09aa66f7f672bb8f7f0303a"},{"path":"assets/montserrat-cyrillic-a187b077090f-EAA9jha_.woff2","bytes":23828,"sha256":"a187b077090fe8ae3fd2d7496aabbeae604819c718a282e0afc92df72b450766"},{"path":"assets/montserrat-cyrillic-ext-0f7f5f2fbb4e-CO5hGrJv.woff2","bytes":26368,"sha256":"0f7f5f2fbb4eae126790fe6f01659ab3ee0806e8038a941908e893020569f51a"},{"path":"assets/montserrat-latin-06b16db7a969-l_AIctKy.woff2","bytes":37956,"sha256":"06b16db7a969135d48d38c49183be7fb88d4452e2a3011957c7851941f4e4879"},{"path":"assets/montserrat-latin-ext-54d9a78b7ff6-BsZE-iaG.woff2","bytes":70688,"sha256":"54d9a78b7ff60b689ad9f3017ffac8547b5d871afec733f6c1c3ae36577ee504"},{"path":"assets/montserrat-vietnamese-26b2403f995e-k7S-YeeD.woff2","bytes":12928,"sha256":"26b2403f995ed65fb49037a6498c074d3ec3c36031a69fc368c4c2180e2c01fa"},{"path":"assets/oswald-cyrillic-95c3d8d1db01-BSPNd759.woff2","bytes":11748,"sha256":"95c3d8d1db01b5ecd85b0d90aa81d39d24231f74de28c7418cfd8c08261fe929"},{"path":"assets/oswald-cyrillic-ext-fd48ff70d399-Bh-246-H.woff2","bytes":13964,"sha256":"fd48ff70d399cc905ec878993b1a72b6c0a4863c46118ec413e01e1fdc3127c3"},{"path":"assets/oswald-latin-571f3457dab5-9AWb_KF-.woff2","bytes":21472,"sha256":"571f3457dab507b6f2ce5394d593ca015251b69fea81ab7a546bd2368e9fc3ed"},{"path":"assets/oswald-latin-ext-99016932b273-0aIcqSua.woff2","bytes":19104,"sha256":"99016932b273efa7d55b3a0ae9fe4babc6dbdcd7539f58a742697054f89b1142"},{"path":"assets/oswald-vietnamese-0e6ae07493c5-JxfGVIrJ.woff2","bytes":6204,"sha256":"0e6ae07493c5ebae5e815123be8fe99b34f7b13dac4a0907e072e244dd7edcdd"},{"path":"assets/page-paper-tone-worker-CKqMGUjX.js","bytes":767,"sha256":"7048ca76e7b12f39f46ee10c2ca46c658a767e58ddde6b6cd6a9ce065d7d2423"},{"path":"assets/paginator-6c-JrHVl.js","bytes":25828,"sha256":"fe5763c5c8878d4912c44f3c57bd8700ff30bb436c8d6a413dd22026f6518708"},{"path":"assets/pdf-CQy23OVR.js","bytes":495169,"sha256":"98e67325f4dc980bbec42d12cf2ad17dcf3a472e8661edc4b8ab4ce3aa275d32"},{"path":"assets/pdf-reader-CmhiPLGw.js","bytes":26432,"sha256":"55e62b4deaee8f987a73ebf27e57648977e7b218be351690515f06f9bc6c19f5"},{"path":"assets/pdf-reader-F60yyvDC.js","bytes":53,"sha256":"488480f1a55228246a1a4823db83d2f1b46bc936da34d31a3c091e853a6edd9e"},{"path":"assets/pdf.worker.min-BmVo14Nb.mjs","bytes":1317034,"sha256":"a33cfe728c584fdba4fcc1fd54bcdc2f9f2f13889ddbb5b2bd1d0f8cbe49b84e"},{"path":"assets/pdf.worker.min-VdxCUbHz.js","bytes":133,"sha256":"454894d5bb9f2c3920202934da609759c1d231b00a2566f291cd29416554e407"},{"path":"assets/plant-catalog-CEKvZGxM.js","bytes":35615,"sha256":"0431dd65d6195039a3b9beb5305923dc8a69dfc123ca4849057b3bd2fdc328f7"},{"path":"assets/playfair-display-cyrillic-c108681cba6a-5WvUvBgz.woff2","bytes":21152,"sha256":"c108681cba6a9820bff52f4a1a4a1d9edf356b347bd79b7c61e916028e8a8b54"},{"path":"assets/playfair-display-latin-e0c764a8e9e1-BOwq7MWX.woff2","bytes":38404,"sha256":"e0c764a8e9e1cce92163c55bac4b2ad6cd4cf8c696ce2289ab5c41565e65b7e2"},{"path":"assets/playfair-display-latin-ext-42898ad49a6b-CT1r92Rl.woff2","bytes":21140,"sha256":"42898ad49a6b23f32b109243e1df596edf831015ed685f429e4dafbb181d599d"},{"path":"assets/playfair-display-vietnamese-ef6446229b59-Cabi7G8-.woff2","bytes":9112,"sha256":"ef6446229b59773e671021650ef3882cf35806dae723ce047de87c0a6633039a"},{"path":"assets/reader-experience-dWPOlMA5.js","bytes":71066,"sha256":"ae84f2a72a6449f825cc6f790ad07c5d2808dad47f4d3001eec63cf97814f8ad"},{"path":"assets/RectAreaLightUniformsLib-BGkiIZNr.js","bytes":247333,"sha256":"0263521a8e019806dc1ba0b78c18d81f5628586fdc989297674e454d34424cad"},{"path":"assets/search-D7qEUpRP.js","bytes":2438,"sha256":"204560e2f2fc28311b33003e351def170928994aad62656935c528782ce10578"},{"path":"assets/speech-highlight-DvjaiDLq.js","bytes":15857,"sha256":"b6ea41078adaae6ae88ba7f217bc03bc8d7f39bfed24fb98bea653270a6437e6"},{"path":"assets/speech-text-DAHkChA9.js","bytes":5130,"sha256":"9e074cf30b5d961f7fe535247b981a8c6bec80f87db30412995506b342090abd"},{"path":"assets/task-yield-Br56LF4z.js","bytes":312,"sha256":"a69e7a9759cde0c9ad51509a9b597cba9ac8bb75899e1cd7431d88196efd7fc4"},{"path":"assets/three-rZX5Lw20.js","bytes":536243,"sha256":"6bf7e84c1112559bae6b5d374a911c677c17297329b31700002406546a96ccf0"},{"path":"assets/tts-b9tpcooj.js","bytes":5077,"sha256":"9d5cdcb2b1b255dedef1ec9a1025fd75c32a062532be22506bd79a46d7adca48"},{"path":"assets/view-DiDX9ox8.js","bytes":26151,"sha256":"b3bc41c02b6655fb4f37ecaa89f1d217b627669fc0c7cd106ff29ca04b337744"},{"path":"assets/walnut-Bvq0D-tr.webp","bytes":142822,"sha256":"516e6f79122cc87b88c3f65803fdffb824044c8246cc6ea6ceff75cf928676d0"},{"path":"assets/walnut-pbr-pbhFr_5Z.webp","bytes":209252,"sha256":"7a8435985aaf7415e5614b19b03588291f198dcfa564eec737abdf136b71f6a0"},{"path":"assets/walnut-surface-Doc91G_f.webp","bytes":151604,"sha256":"47cf86d782aebdfe790ff4fa2118a3a641a55af517cbf0259af286fb0f23a8b6"},{"path":"assets/worker-imU0G3Xn.js","bytes":28062,"sha256":"0d0457b42a36e585d573e9430ebc55ee72b2c866f33a8401ae6882219f8378ef"},{"path":"assets/zip-Y2spjjw9.js","bytes":55585,"sha256":"717b1fb167bec97aeaa78778ff451bde7298f5a1ee00aa1a3de74e9f0d04340c"},{"path":"download-android.html","bytes":3152,"sha256":"ef47ee5d420b6612db38aa6317701df88bd9cc72684d9e594beaa78945be9722"},{"path":"icons/inhouse-read-logo.png","bytes":9747,"sha256":"6cf196f78e1d9c2b8ffdfb29fdd143e71072bfe3ffadc9ec0cbd472ab879b43c"},{"path":"index.html","bytes":13656,"sha256":"7e0a0f817530a92fd354eeb67007534a5de87d267e81302475a6a13b9075752c"},{"path":"licenses/fonts/comfortaa-OFL.txt","bytes":4426,"sha256":"c1276722229ed1866c84a0ec9eb9db174f091c77ea3a605724ada55c476c0296"},{"path":"licenses/fonts/cormorantgaramond-OFL.txt","bytes":4387,"sha256":"60700d351cac4650c51f3f9db318d2a420f8b45052dba2715eb5fec41f0f6956"},{"path":"licenses/fonts/dmsans-OFL.txt","bytes":4389,"sha256":"2af94f4fb533be8fa23282eb33e08ca311ddf47c2f32777e2040b282deeec65c"},{"path":"licenses/fonts/lora-OFL.txt","bytes":4423,"sha256":"1d9a970809ac804b582a6ce7f0ebc4e7fefcbfd7ff6299cad35ee656a21be716"},{"path":"licenses/fonts/manifest.json","bytes":16762,"sha256":"e524e690ffe7f8e98331c0f1bdd2a317bd60ec759a46b656a0907957602549a9"},{"path":"licenses/fonts/montserrat-OFL.txt","bytes":4400,"sha256":"8b7141c03fa4f8d44e6345d5d4931709290f0f67875e452e95ac1fd3a027802e"},{"path":"licenses/fonts/oswald-OFL.txt","bytes":4390,"sha256":"0687c51a3126ae6963389181135a2eaea02f2e88f31230d27409952f28e84da5"},{"path":"licenses/fonts/playfairdisplay-OFL.txt","bytes":4449,"sha256":"566be814f8e96e93dfa16101331557eb6b5467e9e03f627c0910fe93ca12300e"},{"path":"licenses/fonts/README.txt","bytes":550,"sha256":"7880e14adddae57b267c7348f545c4cdb308ef59fee3b69f369503b2006a2a20"},{"path":"licenses/piper-extra-voices.txt","bytes":1086,"sha256":"e12142804cdd181bf62b3a4d613af27ab9e0fe15b664c5181bea1c75134694b0"},{"path":"licenses/supertonic-sdk-MIT.txt","bytes":1070,"sha256":"0dfe0d0ba84416fe3879d9a34f4909d8d0137c78d1e95834177b0414ac096fa2"},{"path":"licenses/supertonic3-OpenRAIL-M.txt","bytes":15007,"sha256":"0d944a9110fed9a9602d60e0423a272903e7bd21ab060490774efc77c2275e9f"},{"path":"licenses/supertonic3-quantization-NOTICE.txt","bytes":1155,"sha256":"7870e7bd5d88d7ecf2a9b24d88bee80c5e0b73cc7b89406d966b41ee255abd9b"},{"path":"neural-voice/ort/ort-wasm-simd-threaded.mjs","bytes":24381,"sha256":"e13f7f94fc51b4ca72b12faeb1ee95f4ace6dfbc8939bc718aabdc0a27c4299b"},{"path":"neural-voice/ort/ort-wasm-simd-threaded.wasm","bytes":14239897,"sha256":"3398c10d07d229bd91b364548e130e0e51a8e5704b88c7c083ebbeb78842dee2"},{"path":"neural-voice/ort/ort.wasm.min.mjs","bytes":50126,"sha256":"219e6a1fc8a9938268d18efca3c91d310bd2f4a59bbd13744df5b2b7fc6cee3b"},{"path":"neural-voice/phon/piper_phonemize.data","bytes":2232748,"sha256":"d8c6e4fadf82d62414464163fb229738300bf2840e086c230ed6cc0c03a18e71"},{"path":"neural-voice/phon/piper_phonemize.mjs","bytes":107553,"sha256":"5240a0cbc1be87e29c6ffb32ada79252ebd38af100cc45c4f31a1e466c87c543"},{"path":"neural-voice/phon/piper_phonemize.wasm","bytes":629166,"sha256":"2189e43490744c95445e251c38a47063f2ca266bcc30bbb18f692c47ff2bfd23"}]});
