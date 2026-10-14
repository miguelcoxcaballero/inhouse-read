import { describe, it, expect, afterEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { webcrypto } from 'node:crypto'
import { Blob as NodeBlob, File as NodeFile } from 'node:buffer'

// The Rust Drive client against the frozen JavaScript original. A simulated Drive server answers the
// real REST calls; seeded sequences of API calls, Google sign-ins (web and Android PKCE with every
// kind of callback), sign-outs, cancellations, expiries and server failures run once per
// implementation with the same fake clock and random bytes. The HTTP traffic (URL, method, headers
// and body of every request), every result and error, the storage, the events and the
// window calls must be identical, in the same order.
vi.mock('../../src/js/rust-ui.js', async () => {
  const ui = await import('../../src/wasm/ui/inhouse_read_ui.js')
  ui.initSync({ module: (process.__ihrDriveUiModule ??= new WebAssembly.Module(readFileSync('src/wasm/ui/inhouse_read_ui_bg.wasm'))) })
  return { getRustUI: () => ui, loadRustUI: async () => ui, requireRustUI: async () => ui, waitForRustUI: async () => ui }
})

const SCOPE = 'https://www.googleapis.com/auth/drive.file'
const realNow = Date.now.bind(Date)
function random(seed) {
  let state = seed >>> 0
  return () => { state = (state + 0x6D2B79F5) >>> 0; let t = state; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296 }
}
const pick = (rng, list) => list[Math.floor(rng() * list.length)]
const tick = () => new Promise(resolve => setTimeout(resolve, 0))

function jsonResponse(body, status = 200, headers = {}) {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers })
}

// A tiny Drive: folders and files with ids, listing with a query, pagination, multipart and resumable uploads.
function makeServer(trace) {
  const server = { items: new Map(), next: 1, faults: [], sessions: new Map(), tokens: 0, tokenMode: 'ok' }
  const add = (entry) => { const id = `id-${server.next++}`; const item = { id, modifiedTime: new Date(1_700_000_000_000 + server.next * 60_000).toISOString(), ...entry }; server.items.set(id, item); return item }
  const summary = item => ({ id: item.id, name: item.name, mimeType: item.mimeType, size: item.size, modifiedTime: item.modifiedTime, md5Checksum: item.md5Checksum })
  const page = (items, params) => {
    const start = Number(params.get('pageToken') || 0)
    const chunk = items.slice(start, start + 2)
    return { files: chunk.map(summary), ...(start + 2 < items.length ? { nextPageToken: String(start + 2) } : {}) }
  }
  server.seed = (name, parent, extra = {}) => add({ name, parent, mimeType: 'application/octet-stream', ...extra })
  server.fetch = async (url, options = {}) => {
    const method = options.method || 'GET'
    let body = options.body
    if (body && typeof body.text === 'function') body = await body.text()
    else if (body && typeof body.toString === 'function') body = body.toString()
    trace.push(['fetch', String(url), method, Object.entries(options.headers || {}).sort(), body === undefined ? null : body.replace(/ihr_uuid-\d+/g, 'ihr_B')])
    const fault = server.faults.shift()
    if (fault === 'network') throw new TypeError('Failed to fetch')
    if (fault) return typeof fault === 'object' ? jsonResponse(fault.body, fault.status) : jsonResponse(fault === 'text' ? 'no json here' : { error: { message: `injected ${fault}` } }, Number(fault) || 500)
    const target = new URL(String(url), 'https://example.test')
    const params = target.searchParams
    if (target.hostname === 'oauth2.googleapis.com') {
      server.tokens++
      const form = new URLSearchParams(body)
      if (server.tokenMode === 'bad') return jsonResponse({ error: 'invalid_grant', error_description: form.get('grant_type') === 'refresh_token' ? 'Token revoked' : 'Bad code' }, 400)
      if (server.tokenMode === 'noscope') return jsonResponse({ access_token: `token-${server.tokens}`, expires_in: 3600, scope: 'email profile' })
      if (server.tokenMode === 'plain') return jsonResponse('not json at all', 200)
      return jsonResponse({ access_token: `token-${server.tokens}`, expires_in: server.tokenMode === 'short' ? 30 : 3600,
        ...(server.tokens % 2 ? { refresh_token: `refresh-${server.tokens}` } : {}), scope: `${SCOPE} email` })
    }
    if (target.pathname === '/drive/v3/about') return jsonResponse({ user: server.noUser ? undefined : { permissionId: 'perm-1', displayName: 'Reader', emailAddress: 'r@example.com', photoLink: 'https://example.test/p.png' } })
    if (target.pathname === '/drive/v3/files' && method === 'POST') {
      const created = add({ ...JSON.parse(body), size: undefined }); return jsonResponse({ id: created.id })
    }
    if (target.pathname === '/drive/v3/files') {
      const q = params.get('q')
      let match
      if ((match = q.match(/^name = '(.*)' and mimeType = 'application\/vnd\.google-apps\.folder' and trashed = false(?: and '(.*)' in parents)?$/))) {
        const name = match[1].replace(/\\'/g, "'").replace(/\\\\/g, '\\')
        return jsonResponse({ files: [...server.items.values()].filter(i => i.name === name && i.mimeType === 'application/vnd.google-apps.folder' && (!match[2] || i.parent === match[2])).map(summary) })
      }
      if ((match = q.match(/^'(.*)' in parents and name = '(.*)' and trashed = false$/))) {
        const name = match[2].replace(/\\'/g, "'").replace(/\\\\/g, '\\')
        return jsonResponse({ files: [...server.items.values()].filter(i => i.parent === match[1] && i.name === name).map(summary) })
      }
      if ((match = q.match(/^'(.*)' in parents and trashed = false$/))) return jsonResponse(page([...server.items.values()].filter(i => i.parent === match[1]), params))
      return jsonResponse({ error: { message: 'bad query' } }, 400)
    }
    const media = target.pathname.match(/^\/drive\/v3\/files\/([^/]+)$/)
    if (media && params.get('alt') === 'media') {
      const item = server.items.get(decodeURIComponent(media[1]))
      if (!item) return jsonResponse({ error: { message: 'File not found' } }, 404)
      return new Response(item.content ?? '', { status: 200, headers: { 'Content-Type': item.mimeType || 'text/plain' } })
    }
    const upload = target.pathname.match(/^\/upload\/drive\/v3\/files(?:\/([^/]+))?$/)
    if (upload) {
      const existing = upload[1] && server.items.get(decodeURIComponent(upload[1]))
      if (params.get('uploadType') === 'multipart') {
        const parts = body.split(/--ihr_B(?:--)?\r\n?/).filter(Boolean)
        const metadata = JSON.parse(parts[0].split('\r\n\r\n')[1])
        const kind = parts[1].match(/Content-Type: (.*)\r\n/)[1]
        const content = parts[1].split('\r\n\r\n').slice(1).join('\r\n\r\n').replace(/\r\n$/, '')
        const stored = existing ? Object.assign(existing, { content, mimeType: kind, size: String(content.length), name: metadata.name ?? existing.name }) : add({ ...metadata, parent: metadata.parents?.[0], content, mimeType: kind, size: String(content.length) })
        stored.md5Checksum = 'c'.repeat(32)
        return jsonResponse(summary(stored))
      }
      const session = `https://upload.example.test/session/${server.sessions.size + 1}`
      server.sessions.set(session, { metadata: JSON.parse(body), existing })
      return server.noLocation ? jsonResponse({}) : new Response('{}', { status: 200, headers: { Location: session } })
    }
    if (server.sessions.has(String(url))) {
      const { metadata, existing } = server.sessions.get(String(url))
      const content = typeof options.body?.text === 'function' ? await options.body.text() : String(options.body)
      const stored = existing ? Object.assign(existing, { content }) : add({ ...metadata, parent: metadata.parents?.[0], content, mimeType: options.headers['Content-Type'], size: String(content.length) })
      return jsonResponse(summary(stored))
    }
    return jsonResponse({ error: { message: `unhandled ${method} ${url}` } }, 404)
  }
  return server
}

function installPlatform(world, rng) {
  const events = world.trace
  let clock = 1_700_000_000_000, uuid = 0, bytes = 0
  vi.spyOn(Date, 'now').mockImplementation(() => /fake-indexeddb/.test(new Error().stack) ? realNow() : (clock += 1))
  world.jump = ms => { clock += ms }
  // Real work outside the microtask queue (the digest runs in a thread pool) is waited for.
  world.busy = 0
  const subtle = { digest: (...args) => { world.busy++; return webcrypto.subtle.digest(...args).finally(() => { world.busy-- }) } }
  const crypto = { subtle, randomUUID: () => `uuid-${++uuid}`,
    getRandomValues: array => { for (let i = 0; i < array.length; i++) array[i] = (++bytes * 37 + 11) & 255; return array } }
  vi.stubGlobal('crypto', crypto)
  vi.stubGlobal('Blob', NodeBlob); vi.stubGlobal('File', NodeFile)
  vi.stubGlobal('fetch', world.server.fetch)
  vi.stubGlobal('navigator', { userAgent: world.android ? 'Mozilla/5.0 InhouseReadApp/1.2.3' : 'Mozilla/5.0', onLine: true })
  vi.stubGlobal('location', { assign: url => events.push(['assign', url]) })
  const original = console.warn
  console.warn = (...args) => events.push(['warn', ...args])
  world.restoreConsole = () => { console.warn = original }
  world.listener = event => events.push(['event', event.type, event.detail])
  globalThis.addEventListener('inhouse-drive-auth', world.listener)
}

const randomProgress = rng => ({ fraction: pick(rng, [0, .25, 2, -1, NaN, '.5', undefined]), locator: pick(rng, [undefined, null, { kind: 'epub', value: 'c1' }]),
  appearance: pick(rng, [undefined, { spineColorOverride: '#112233' }]), bookLength: pick(rng, [undefined, null,
    { schemaVersion: 1, driveFileId: 'f', md5Checksum: 'a'.repeat(32), byteLength: 5, wordCount: 100, wordCountVersion: 1, wordCountComplete: true }]),
  readingHistory: pick(rng, [undefined, Array.from({ length: 25 }, (_, i) => ({ fraction: i / 30, locator: { i } })), []]),
  bookmarks: pick(rng, [undefined, [{ fraction: .1, locator: { kind: 'epub', value: 'x' } }]]), quotes: pick(rng, [undefined, []]),
  updatedAt: pick(rng, [undefined, 0, 12345]) })

function scenario(seed) {
  const rng = random(seed)
  const steps = []
  const count = 18 + Math.floor(rng() * 10)
  for (let i = 0; i < count; i++) {
    steps.push({ kind: pick(rng, ['listAll', 'listAll', 'list', 'folder', 'upload', 'upload', 'big', 'snapshots', 'writeSnapshot', 'cover', 'download', 'profile',
      'readProgress', 'writeProgress', 'writeProgress', 'webLogin', 'androidLogin', 'androidLogin', 'callback', 'callback', 'signOut', 'cancel',
      'jump', 'session', 'fault', 'fault', 'seed', 'tokenMode', 'access']), r: rng(), q: rng(), progress: randomProgress(rng), n: Math.floor(rng() * 5) })
  }
  return { android: rng() < .5, steps, session: rng() < .8, refresh: rng() < .4 }
}

async function run(importModule, seed) {
  const plan = scenario(seed)
  const trace = []
  const world = { trace, android: plan.android, server: makeServer(trace) }
  vi.resetModules()
  localStorage.clear()
  delete globalThis.google; delete globalThis.InhouseNative; delete globalThis.handleInhouseNativeOAuth
  installPlatform(world)
  if (plan.session) localStorage.setItem('ihr_drive_session_v2', JSON.stringify({ accessToken: 'seed-token', expiresAt: 1_700_000_000_000 + 7_200_000 }))
  if (plan.refresh) localStorage.setItem('ihr_drive_refresh_token_v1', 'seed-refresh')
  const drive = await importModule()
  const tasks = []
  const flush = async () => {
    for (let stable = 0, rounds = 0; stable < 4 && rounds < 400; rounds++) {
      const before = trace.length + settled.length + tasks.filter(task => task.state !== 'pending').length
      await tick()
      stable = world.busy === 0 && trace.length + settled.length + tasks.filter(task => task.state !== 'pending').length === before ? stable + 1 : 0
    }
  }
  // Independent requests that fail in the same turn may report in either order: the order inside one
  // step is not behaviour, so each step's settlements are recorded sorted.
  let settled = []
  const publish = () => { trace.push(...settled.sort((a, b) => String(a[1]).localeCompare(String(b[1]), 'en', { numeric: true }))); settled = [] }
  const track = (label, promise) => {
    const entry = { label, state: 'pending' }
    tasks.push(entry)
    Promise.resolve(promise).then(value => { entry.state = 'ok'; settled.push(['settled', label, summarize(value)]) },
      error => { entry.state = 'error'; settled.push(['settled', label, 'error', error?.message, error?.code, error?.status, error?.constructor?.name]) })
  }
  const authUrls = []
  const summarize = value => { try { return JSON.parse(JSON.stringify(value ?? null, (_, v) => (typeof File !== 'undefined' && v instanceof NodeFile) ? { file: v.name, type: v.type, size: v.size } : v)) } catch { return String(value) } }
  const snapshot = () => ({ storage: Object.fromEntries(Object.keys(localStorage).sort().map(key => [key, localStorage.getItem(key)])),
    session: drive.hasDriveSession(), profile: drive.getRememberedDriveProfile() })
  const bookId = `book-${plan.android ? 'a' : 'w'}`
  const parent = () => [...world.server.items.values()].find(i => i.name === 'inhouse read')?.id
  let index = 0
  try {
    for (const step of plan.steps) {
      const label = `${index++}:${step.kind}`
      switch (step.kind) {
        case 'listAll': track(label, drive.listAllDriveBooks()); break
        case 'list': track(label, drive.listDriveBooks(step.q < .5 ? undefined : { pageToken: String(step.n), pageSize: 3, fields: 'id,name' })); break
        case 'folder': track(label, drive.getOrCreateReadFolder()); break
        case 'upload': track(label, drive.uploadDriveFile(new NodeFile([`book-${step.n}`], step.r < .5 ? `Book ${step.n}.epub` : "O'Brien \\ x.pdf", { type: step.r < .2 ? '' : 'application/epub+zip' }),
          step.q < .3 ? { driveFileId: [...world.server.items.keys()][step.n] } : step.q < .5 ? { parentId: parent(), name: 'renamed.epub' } : undefined)); break
        case 'big': { const file = new NodeFile(['big book'], 'Big.pdf', { type: 'application/pdf' }); Object.defineProperty(file, 'size', { value: 6 * 1024 * 1024 + step.n }); track(label, drive.uploadDriveFile(file)); break }
        case 'snapshots': track(label, drive.readDriveLibrarySnapshots()); break
        case 'writeSnapshot': track(label, drive.writeDriveLibrarySnapshot({ schemaVersion: 1, deviceId: `dev-${step.n % 2}`, books: [], settings: {} }, step.q < .4 ? undefined : [...world.server.items.keys()][step.n])); break
        case 'cover': track(label, drive.uploadDriveCover(new NodeBlob(['pixels'], { type: step.q < .5 ? 'image/png' : '' }), `cover-${step.n}`)); break
        case 'download': track(label, drive.downloadDriveFile([...world.server.items.keys()][step.n] || 'missing', step.q < .5 ? { name: 'x.epub', mimeType: 'application/epub+zip' } : undefined)); break
        case 'profile': world.server.noUser = step.q < .15; track(label, drive.getDriveProfile()); break
        case 'readProgress': track(label, drive.readDriveProgress(step.q < .5 ? bookId : 'other')); break
        case 'writeProgress': track(label, drive.writeDriveProgress(bookId, step.progress, step.q < .5 ? undefined : [...world.server.items.keys()][step.n])); break
        case 'webLogin': {
          const flavour = step.q < .3 ? 'error' : step.q < .4 ? 'scope' : step.q < .5 ? 'popup_closed' : step.q < .55 ? 'popup_failed_to_open' : step.q < .6 ? 'other' : step.q < .65 ? 'late' : 'ok'
          globalThis.google = step.r < .1 ? undefined : { accounts: { oauth2: { initTokenClient: options => {
            trace.push(['gis', options.client_id, options.scope, options.include_granted_scopes, Object.keys(options).sort()])
            return { requestAccessToken: request => {
              trace.push(['gis-request', request])
              const respond = () => {
                if (flavour === 'popup_closed' || flavour === 'popup_failed_to_open' || flavour === 'other') options.error_callback(flavour === 'other' ? { type: 'x' } : { type: flavour })
                else if (flavour === 'error') options.callback({ error: 'access_denied', error_description: step.n % 2 ? 'Denied' : undefined })
                else if (flavour === 'scope') options.callback({ access_token: 'web-token', expires_in: 3600, scope: 'email profile' })
                else options.callback({ access_token: step.n === 4 ? '' : `web-${step.n}`, expires_in: step.n === 3 ? 'x' : step.n === 2 ? 5 : 3600, scope: `${SCOPE} email` })
              }
              if (flavour === 'late') { world.busy++; setTimeout(() => { world.busy--; respond() }, 5) } else respond()
            } }
          } } } }
          track(label, drive.requestDriveAccess(step.q < .2 ? { interactive: false } : undefined)); break
        }
        case 'androidLogin':
          globalThis.InhouseNative = step.r < .12 ? {} : { openAuthUrl: url => { authUrls.push(url); trace.push(['openAuthUrl', url]) } }
          track(label, drive.requestDriveAccess(step.q < .3 ? { interactive: false } : undefined)); break
        case 'callback': {
          const url = authUrls.at(-1) && new URL(authUrls.at(-1))
          const state = url?.searchParams.get('state') || 'none'
          const variants = [`code=code-1&state=${state}`, `#code=code-2&state=${state}`, `state=${state}&error=access_denied`, `state=${state}&error=server_error`,
            `state=wrong&code=c`, `state=${state}`, `?state=${state}&code=code-3`, '', undefined]
          track(label, Promise.resolve(globalThis.handleInhouseNativeOAuth?.(variants[step.n % variants.length]))); break
        }
        case 'signOut': drive.signOutDrive(); break
        case 'cancel': drive.cancelDriveConnection(step.q < .5 ? undefined : 'Parada'); break
        case 'jump': world.jump(pick(() => step.r, [1000, 60_000, 11 * 60_000, 3_700_000])); break
        case 'session': localStorage.setItem(step.q < .5 ? 'ihr_drive_session_v2' : 'ihn_drive_tokens', JSON.stringify({ accessToken: `stored-${step.n}`, expiresAt: Date.now() + (step.r < .3 ? 30_000 : 3_600_000) }))
          if (step.r > .7) localStorage.setItem('ihr_drive_refresh_token_v1', 'stored-refresh'); break
        case 'fault': world.server.faults.push(pick(() => step.r, ['network', '401', '403', '500', 'text', { status: 200, body: '{invalid' }, '401'])); break
        case 'seed': { const folder = parent(); world.server.seed(pick(() => step.r, ['one.pdf', 'two.EPUB', 'note.txt', 'three.cbz']), folder); world.server.seed('progress-book.json', undefined); break }
        case 'tokenMode': world.server.tokenMode = pick(() => step.r, ['ok', 'ok', 'bad', 'noscope', 'plain', 'short']); break
        case 'access': track(label, drive.requestDriveAccess({ interactive: step.q < .5 })); break
      }
      await flush(); publish()
      trace.push(['after', label, snapshot(), tasks.map(task => task.state).join(',')])
    }
    drive.cancelDriveConnection()
    await flush(); publish()
    trace.push(['end', snapshot(), tasks.map(task => task.state).join(',')])
  } finally {
    globalThis.removeEventListener('inhouse-drive-auth', world.listener)
    world.restoreConsole()
    vi.restoreAllMocks(); vi.unstubAllGlobals()
  }
  return trace
}

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

const SCENARIOS = Number(process.env.DRIVE_DIFFERENTIAL_SCENARIOS || 120)
describe('Drive client (Rust) against the original', () => {
  it(`makes the same requests, results, storage and events through ${SCENARIOS} seeded scenarios`, async () => {
    let requests = 0, errors = 0, tokens = 0
    for (let seed = 1; seed <= SCENARIOS; seed++) {
      const expected = await run(() => import('./helpers/reference-drive-client.js'), seed)
      const actual = await run(() => import('../../src/js/drive-client.js'), seed)
      expect(actual, `scenario ${seed}`).toEqual(expected)
      requests += expected.filter(entry => entry[0] === 'fetch').length
      errors += expected.filter(entry => entry[0] === 'settled' && entry[2] === 'error').length
      tokens += expected.filter(entry => entry[0] === 'fetch' && entry[1].includes('oauth2.googleapis.com')).length
    }
    expect(requests).toBeGreaterThan(SCENARIOS * 8)
    expect(errors).toBeGreaterThan(SCENARIOS)
    expect(tokens).toBeGreaterThan(SCENARIOS / 8)
  }, 280_000)
})
