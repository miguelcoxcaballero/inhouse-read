// The espeak-ng phonemizer on its own, through the production Vite build, in Chromium: the piper_phonemize WebAssembly module has
// a fixed 17 MB heap that every call erodes, and one that is never replaced fails for good after ~75-155 calls (fewer for
// long texts) and then takes the renderer down. A fragment is phonemised per fragment read, so an audiobook reaches that in
// 12-15 minutes. These tests read 200 DISTINCT 180-character fragments (the worst case) through the real module.
import { test, expect } from '@playwright/test'
import { createServer } from 'node:http'
import { existsSync, statSync, createReadStream } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'vite'

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.data': 'application/octet-stream' }

test.describe.configure({ mode: 'serial' })
test.describe('neural phonemizer (real espeak-ng WebAssembly)', () => {
  test.setTimeout(240_000)
  let outDir, server, port, page

  test.beforeAll(async ({ browser }) => {
    outDir = join(tmpdir(), `neural-phonemizer-harness-${process.pid}`)
    await build({ root: ROOT, configFile: join(ROOT, 'vite.config.js'), logLevel: 'warn', build: { outDir, emptyOutDir: true, sourcemap: false, rollupOptions: { input: join(ROOT, 'tests/e2e/fixtures/neural-phonemizer-harness.html') } } })
    server = createServer((request, response) => {
      const { pathname } = new URL(request.url, 'http://x')
      const file = join(outDir, decodeURIComponent(pathname.replace(/^\/inhouse-read\//, '')))
      if (!pathname.startsWith('/inhouse-read/') || !file.startsWith(outDir) || !existsSync(file) || statSync(file).isDirectory()) { response.writeHead(404); return response.end('nf') }
      response.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' })
      createReadStream(file).pipe(response)
    })
    await new Promise(resolvePort => server.listen(0, '127.0.0.1', resolvePort))
    port = server.address().port
    page = await browser.newPage()
    page.on('pageerror', error => console.log('[pageerror]', error.message))
    await page.goto(`http://127.0.0.1:${port}/inhouse-read/tests/e2e/fixtures/neural-phonemizer-harness.html`)
    await page.waitForFunction(() => window.phonemizeMany)
  })
  test.afterAll(async () => { await page?.close(); server?.close() })

  test('200 distinct 180-character fragments are phonemised without a failure, on modules replaced every 40 calls', async () => {
    const result = await page.evaluate(() => window.phonemizeMany(200))
    console.log(`[phonemizer] default: ${result.ok} calls ok, ${result.builds} modules built`)
    expect(result.failed).toBeNull()
    expect(result.ok).toBe(200)
    expect(Math.min(...result.ids)).toBeGreaterThan(50)  // real phoneme ids, never an empty answer
    expect(result.builds).toBeGreaterThanOrEqual(5)      // one module per 40 calls
  })

  test('a module that is never replaced still dies in this range, and the wrapper recovers on a fresh one instead of failing', async () => {
    const result = await page.evaluate(() => window.phonemizeMany(200, { rebuildEvery: 100000 }))
    console.log(`[phonemizer] never replaced: ${result.ok} calls ok, ${result.builds} modules built (>1: the first one died)`)
    expect(result.failed).toBeNull()
    expect(result.ok).toBe(200)
    expect(result.builds).toBeGreaterThanOrEqual(2)      // the first one died (about the 75th call) and was replaced
  })
})
