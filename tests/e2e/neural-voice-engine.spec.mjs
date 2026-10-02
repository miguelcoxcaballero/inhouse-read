// REAL-engine verification of the neural voices: the production Vite build of the engine (worker bundle, ORT copy, base URL),
// real Piper weights and the real onnxruntime-web + espeak-ng WebAssembly, in Chromium. Hugging Face is mirrored by a local
// server from a fixture directory (the real URLs are not reachable from CI/the sandbox): models are downloaded THROUGH the
// engine (progress, Cache Storage), then read aloud.
//
//   NEURAL_VOICE_FIXTURES  directory holding <piperId>.onnx and <piperId>.onnx.json (default: the sandbox spike folder);
//                          the spec is skipped when the voices it needs are not there, so CI stays green.
//   NEURAL_VOICE_EVIDENCE  where the measurements (numbers.json) and the end-to-end WAV go (default: a temp folder).
//   NEURAL_VOICE_SPIKE_WAV optional folder with the spike's WAVs, to compare the output with.
import { test, expect } from '@playwright/test'
import { createServer } from 'node:http'
import { existsSync, statSync, mkdirSync, writeFileSync, readFileSync, createReadStream } from 'node:fs'
import { tmpdir, loadavg, cpus } from 'node:os'
import { join, resolve, extname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'vite'

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const SPIKE = '/tmp/claude-0/-home-user-inhouse-read/6c70f5ca-de80-5128-bee1-f59b39f4610d/scratchpad/piper'
const FIXTURES = process.env.NEURAL_VOICE_FIXTURES || `${SPIKE}/web/models`
const EVIDENCE = process.env.NEURAL_VOICE_EVIDENCE || join(tmpdir(), 'neural-voice-evidence')
const SPIKE_WAV = process.env.NEURAL_VOICE_SPIKE_WAV || `${SPIKE}/wav`
const ES = 'es_MX-claude-high', EN = 'en_US-lessac-medium'
const haveVoice = piperId => existsSync(join(FIXTURES, `${piperId}.onnx`)) && existsSync(join(FIXTURES, `${piperId}.onnx.json`))

const FRAGMENTS = [
  'Después de un largo día, Ana volvió a casa y abrió el libro que su abuelo le había regalado.',
  '—¿Qué hora es? —preguntó él—. Ya es tarde, y el año que viene tendremos más tiempo.',
  'La lluvia golpeaba suavemente los cristales de la vieja biblioteca.',
  'Cuando el reloj marcó la medianoche, el viejo bibliotecario cerró el último libro, apagó la lámpara y salió despacio.',
  'Nadie en el pueblo recordaba cuándo había llegado el forastero, pero todos coincidían en que traía consigo una maleta de cuero gastada.',
  'Después de un largo día, Ana volvió a casa.'
]
const ENGLISH = ['The rain tapped softly on the windows of the old library.', 'Nobody in the village remembered when the stranger had arrived.']

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.data': 'application/octet-stream', '.map': 'application/json' }
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'range, if-range', 'access-control-expose-headers': 'content-length, content-range, etag, accept-ranges' }

/** Serves the built harness under /inhouse-read/ and a Hugging Face mirror (piper-voices layout) under /hf/. */
function startServer(distDir, hits) {
  const server = createServer((request, response) => {
    const { pathname } = new URL(request.url, 'http://x')
    if (request.method === 'OPTIONS') { response.writeHead(204, CORS); return response.end() }
    if (pathname.startsWith('/hf/')) {
      hits.push(pathname.slice(4))
      const rel = pathname.slice(4)
      if (rel === 'voices.json') {
        const body = {}
        for (const piperId of [ES, EN]) if (haveVoice(piperId)) {
          const key = hfPath(piperId)
          body[piperId] = { key: piperId, files: { [`${key}.onnx`]: { size_bytes: statSync(join(FIXTURES, `${piperId}.onnx`)).size, md5_digest: '' }, [`${key}.onnx.json`]: { size_bytes: statSync(join(FIXTURES, `${piperId}.onnx.json`)).size, md5_digest: '' } } }
        }
        response.writeHead(200, { ...CORS, 'content-type': 'application/json' })
        return response.end(JSON.stringify(body))
      }
      const file = join(FIXTURES, basename(rel))
      if (rel !== `${hfPath(basename(rel).replace(/\.onnx(\.json)?$/, ''))}${basename(rel).slice(basename(rel).indexOf('.onnx'))}` || !existsSync(file)) { response.writeHead(404, CORS); return response.end('not found') }
      return sendFile(request, response, file, 'application/octet-stream', { ...CORS, etag: '"fixture"', 'accept-ranges': 'bytes' }, true)
    }
    if (pathname.startsWith('/inhouse-read/')) {
      let file = join(distDir, decodeURIComponent(pathname.slice('/inhouse-read/'.length)))
      if (!file.startsWith(distDir) || !existsSync(file) || statSync(file).isDirectory()) { response.writeHead(404); return response.end('nf') }
      return sendFile(request, response, file, MIME[extname(file)] || 'application/octet-stream', { 'cache-control': 'no-store' })
    }
    response.writeHead(404); response.end('nf')
  })
  return new Promise(resolvePort => server.listen(0, '127.0.0.1', () => resolvePort({ server, port: server.address().port })))
}

/** 'es_MX-claude-high' -> 'es/es_MX/claude/high/es_MX-claude-high' (the piper-voices layout). */
function hfPath(piperId) {
  const [locale, ...rest] = piperId.split('-')
  const quality = rest.pop()
  return `${locale.split('_')[0]}/${locale}/${rest.join('-')}/${quality}/${piperId}`
}

// Big files go out in slices with a tiny pause, like a real connection: that is what makes progress observable.
function sendFile(request, response, file, type, headers, throttle = false) {
  const size = statSync(file).size
  const range = /bytes=(\d+)-(\d*)/.exec(request.headers.range || '')
  const start = range ? Number(range[1]) : 0, end = range && range[2] ? Number(range[2]) : size - 1
  response.writeHead(range ? 206 : 200, { ...headers, 'content-type': type, 'content-length': end - start + 1, ...(range ? { 'content-range': `bytes ${start}-${end}/${size}` } : {}) })
  const stream = createReadStream(file, { start, end, highWaterMark: 512 * 1024 })
  request.on('close', () => stream.destroy())
  if (!throttle) return stream.pipe(response)
  stream.on('data', chunk => { stream.pause(); if (!response.write(chunk)) response.once('drain', () => setTimeout(() => stream.resume(), 2)); else setTimeout(() => stream.resume(), 2) })
  stream.on('end', () => response.end())
}

function wavOf(pcm, sampleRate) {
  const buffer = Buffer.alloc(44 + pcm.length * 2)
  buffer.write('RIFF', 0); buffer.writeUInt32LE(36 + pcm.length * 2, 4); buffer.write('WAVEfmt ', 8)
  buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22)
  buffer.writeUInt32LE(sampleRate, 24); buffer.writeUInt32LE(sampleRate * 2, 28); buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34)
  buffer.write('data', 36); buffer.writeUInt32LE(pcm.length * 2, 40)
  pcm.forEach((x, i) => buffer.writeInt16LE(Math.round(Math.max(-1, Math.min(1, x)) * 32767), 44 + i * 2))
  return buffer
}
function readWav(file) {
  const b = readFileSync(file)
  const sampleRate = b.readUInt32LE(24), n = (b.length - 44) / 2
  const pcm = new Float32Array(n)
  for (let i = 0; i < n; i++) pcm[i] = b.readInt16LE(44 + i * 2) / 32768
  return { pcm, sampleRate }
}
const stats = pcm => {
  let peak = 0, sum = 0, finite = true
  for (const x of pcm) { if (!Number.isFinite(x)) finite = false; peak = Math.max(peak, Math.abs(x)); sum += x * x }
  return { peak, rms: Math.sqrt(sum / pcm.length), finite }
}
const percentile = (values, p) => { const s = [...values].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(s.length * p))] }

test.describe.configure({ mode: 'serial' })
test.describe('neural voice engine (real Piper weights, real ORT + espeak-ng WASM)', () => {
  test.skip(!haveVoice(ES), `fixtures not found in ${FIXTURES} (set NEURAL_VOICE_FIXTURES)`)
  test.setTimeout(280_000)

  let outDir, server, port, page
  const hits = []
  const numbers = { machine: { nproc: cpus().length, loadAverageAtStart: loadavg().map(x => +x.toFixed(2)) } }

  test.beforeAll(async ({ browser }) => {
    mkdirSync(EVIDENCE, { recursive: true })
    outDir = join(tmpdir(), `neural-voice-harness-${process.pid}`)
    // The production pipeline, only with the harness page as the entry: proves the worker bundle, ORT copy and base URL work as shipped.
    await build({ root: ROOT, configFile: join(ROOT, 'vite.config.js'), logLevel: 'warn', build: { outDir, emptyOutDir: true, sourcemap: false, rollupOptions: { input: join(ROOT, 'tests/e2e/fixtures/neural-voice-harness.html') } } })
    ;({ server, port } = await startServer(outDir, hits))
    page = await browser.newPage()
    await page.addInitScript(base => { window.INHOUSE_NEURAL_VOICE_BASE = base }, `http://127.0.0.1:${port}/hf/`)
    page.on('pageerror', error => console.log('[pageerror]', error.message))
    await page.goto(`http://127.0.0.1:${port}/inhouse-read/tests/e2e/fixtures/neural-voice-harness.html`)
    await page.waitForFunction(() => window.neural)
  })
  test.afterAll(async () => {
    writeFileSync(join(EVIDENCE, 'numbers.json'), JSON.stringify(numbers, null, 2))
    await page?.close()
    server?.close()
  })

  test('the build ships the engine as lazy chunks and ORT/phonemizer files under the base URL', async () => {
    for (const file of ['neural-voice/ort/ort.wasm.min.mjs', 'neural-voice/ort/ort-wasm-simd-threaded.mjs', 'neural-voice/ort/ort-wasm-simd-threaded.wasm', 'neural-voice/phon/piper_phonemize.mjs', 'neural-voice/phon/piper_phonemize.wasm', 'neural-voice/phon/piper_phonemize.data']) {
      expect(existsSync(join(outDir, file)), file).toBe(true)
    }
    const status = await page.evaluate(async base => (await fetch(`${base}neural-voice/ort/ort-wasm-simd-threaded.wasm`)).status, `/inhouse-read/`)
    expect(status).toBe(200)
  })

  test('install streams the model with progress into Cache Storage and survives a reload', async () => {
    await page.evaluate(() => { window.__progress = []; window.neural.engine.addEventListener('change', () => { const d = window.neural.engine.downloads.get('piper:es_MX-claude-high'); if (d) window.__progress.push({ ...d }) }) })
    const t0 = Date.now()
    await page.evaluate(() => window.neural.engine.refresh())
    expect(await page.evaluate(() => [...window.neural.engine.installed])).toEqual([])
    await page.evaluate(() => window.neural.engine.install('piper:es_MX-claude-high'))
    numbers.installMs = Date.now() - t0
    const progress = await page.evaluate(() => window.__progress)
    const fractions = progress.filter(p => p.state === 'downloading').map(p => p.fraction)
    expect(fractions.length).toBeGreaterThan(5)
    expect(fractions).toEqual([...fractions].sort((a, b) => a - b))
    expect(fractions.at(-1)).toBeGreaterThan(0.9)
    expect(progress.at(-1).total || progress.at(-2).total).toBeGreaterThan(60e6)
    expect(await page.evaluate(() => [...window.neural.engine.installed])).toEqual(['piper:es_MX-claude-high'])
    expect(await page.evaluate(() => window.neural.engine.downloads.size)).toBe(0)
    // HF layout of the URLs, voices.json consulted for the size
    expect(hits).toEqual(expect.arrayContaining([`${hfPath(ES)}.onnx`, `${hfPath(ES)}.onnx.json`, 'voices.json']))
    const cached = await page.evaluate(async () => (await (await caches.open('inhouse-neural-voices-v1')).keys()).map(r => new URL(r.url).pathname))
    expect(cached.sort()).toEqual([`/hf/${hfPath(ES)}.onnx`, `/hf/${hfPath(ES)}.onnx.json`].sort())
    // a fresh page knows what is installed without downloading again
    const before = hits.length
    await page.reload()
    await page.waitForFunction(() => window.neural)
    await page.evaluate(() => window.neural.engine.refresh())
    expect(await page.evaluate(() => [...window.neural.engine.installed])).toEqual(['piper:es_MX-claude-high'])
    expect(hits.length).toBe(before)
  })

  test('reads 6 fragments with look-ahead: starts, dones, no audible gap, UI thread free', async () => {
    await page.click('#unlock')
    await page.waitForFunction(() => window.neural.engine.status !== undefined)
    // baseline frame cadence with the page idle
    await page.waitForTimeout(1200)
    const baseline = await page.evaluate(() => { const f = window.neural.frames.splice(0); return f })
    // cold: worker spawn + ORT + phonemizer + model from cache + session
    const log = await page.evaluate(([voice, texts]) => window.neural.readAll(voice, texts, 1), ['piper:es_MX-claude-high', FRAGMENTS])
    const starts = await page.evaluate(() => window.neural.starts.splice(0))
    const frames = await page.evaluate(() => window.neural.frames.splice(0))
    const engineStats = await page.evaluate(() => ({ ...window.neural.engine.stats }))
    const ofType = type => log.filter(e => e.type === type)
    expect(log.some(e => e.type === 'error'), JSON.stringify(log)).toBe(false)
    expect(ofType('start').map(e => e.id)).toEqual(FRAGMENTS.map((_, i) => `f${i}`))
    expect(ofType('done').map(e => e.id)).toEqual(FRAGMENTS.map((_, i) => `f${i}`))
    // order: each id starts before it is done, and the next one starts no later than (about) when the previous is done
    FRAGMENTS.forEach((_, i) => {
      const s = log.find(e => e.type === 'start' && e.id === `f${i}`), d = log.find(e => e.type === 'done' && e.id === `f${i}`)
      expect(s.at).toBeLessThan(d.at)
    })
    const firstStartMs = ofType('start')[0].at
    expect(firstStartMs).toBeLessThan(20_000)
    // gapless: chunk k+1 starts where chunk k ends on the audio clock
    const gaps = starts.slice(1).map((s, k) => s.when - (starts[k].when + starts[k].duration))
    const totalAudio = starts.reduce((sum, s) => sum + s.duration, 0)
    expect(starts.length).toBeGreaterThanOrEqual(FRAGMENTS.length)
    expect(starts.every(s => s.duration > 0.05 && Number.isFinite(s.when))).toBe(true)
    if (engineStats.rtf < 0.8) {
      expect(engineStats.underruns, 'underruns with RTF ' + engineStats.rtf).toBe(0)
      for (const gap of gaps) expect(gap).toBeLessThanOrEqual(0.15)
    }
    // highlight timing: each 'start' fires when the first sample of its fragment is audible, i.e. when the audio clock
    // reaches the chunk's start time (+ the output latency), within the slack of a timer; never before.
    const startTimes = ofType('start').map(e => {
      const candidates = starts.map(s => e.ctxTime - (s.when + e.latency)).filter(d => d >= -0.02)
      return Math.min(...candidates)
    })
    for (const lateness of startTimes) { expect(lateness).toBeGreaterThanOrEqual(-0.02); expect(lateness).toBeLessThan(0.1) }
    const rafMs = arr => ({ n: arr.length, median: +percentile(arr, 0.5).toFixed(1), p95: +percentile(arr, 0.95).toFixed(1), max: +Math.max(...arr).toFixed(1) })
    numbers.reading6 = {
      firstAudioMsCold: Math.round(firstStartMs), totalAudioSec: +totalAudio.toFixed(2), wallSec: +(log.at(-1).at / 1000).toFixed(2),
      startLatenessMs: startTimes.map(x => Math.round(x * 1000)), rtfEma: +engineStats.rtf.toFixed(2), underruns: engineStats.underruns, chunks: starts.length,
      maxGapSec: +Math.max(...gaps, 0).toFixed(4), gapsOver150ms: gaps.filter(g => g > 0.15).length,
      rafBaseline: rafMs(baseline), rafWhileSynthesising: rafMs(frames), loadAverageAfter: loadavg().map(x => +x.toFixed(2))
    }
    // The page's frame cadence: the UI thread only posts messages and copies chunks
    expect(percentile(frames, 0.5)).toBeLessThan(25)
    expect(percentile(frames, 0.95)).toBeLessThan(60)
    expect(Math.max(...frames)).toBeLessThan(400)
    // idle again afterwards
    await page.waitForFunction(() => window.neural.engine.status === 'idle')
  })

  test('warm first-audio latency, replay from the fragment cache, and a replaced speak()', async () => {
    const warm = await page.evaluate(([voice, text]) => new Promise(resolve => {
      const t0 = performance.now()
      const on = e => { if (e.detail.id === 'w1' && e.detail.type === 'start') { window.removeEventListener('inhouse-tts', on); resolve(performance.now() - t0) } }
      window.addEventListener('inhouse-tts', on)
      window.neural.engine.speak({ text, voiceId: voice, rate: 1, id: 'w1', upcoming: [] })
    }), ['piper:es_MX-claude-high', 'Esta es una frase completamente nueva que no se había leído antes en este libro.'])
    // replaying a fragment that was already spoken needs no synthesis
    await page.evaluate(() => window.neural.engine.stop())
    const replay = await page.evaluate(([voice, text]) => new Promise(resolve => {
      const t0 = performance.now()
      const on = e => { if (e.detail.id === 'w2' && e.detail.type === 'start') { window.removeEventListener('inhouse-tts', on); resolve(performance.now() - t0) } }
      window.addEventListener('inhouse-tts', on)
      window.neural.engine.speak({ text, voiceId: voice, rate: 1, id: 'w2', upcoming: [] })
    }), ['piper:es_MX-claude-high', FRAGMENTS[2]])
    numbers.firstAudioMsWarm = Math.round(warm)
    numbers.firstAudioMsFromCache = Math.round(replay)
    expect(warm).toBeLessThan(8000)
    expect(replay).toBeLessThan(600)
    await page.evaluate(() => window.neural.engine.stop())
  })

  test('speeds 1.5x and 2x: compute speed scales with the rate, and the voice either keeps up or honestly gives up', async () => {
    for (const rate of [1.5, 2]) {
      // new text per rate: the fragment cache must not hide the compute speed
      const fresh = FRAGMENTS.slice(0, 5).map(t => `${rate === 1.5 ? 'Primero' : 'Entonces'}, ${t[0].toLowerCase()}${t.slice(1)}`)
      const log = await page.evaluate(([voice, list, r]) => window.neural.readAll(voice, list, r, { prefix: 'r' }), ['piper:es_MX-claude-high', fresh, rate])
      const stats = await page.evaluate(() => ({ ...window.neural.engine.stats }))
      const error = log.find(e => e.type === 'error')
      numbers[`rate${rate}`] = { rtf: +stats.rtf.toFixed(2), underruns: stats.underruns, tooSlow: stats.tooSlow, done: log.filter(e => e.type === 'done').length, error: error?.reason || null, firstAudioMs: Math.round(log.find(e => e.type === 'start')?.at || -1) }
      if (error) expect(error.reason).toBe('too-slow')
      else expect(log.filter(e => e.type === 'done').length).toBe(fresh.length)
      await page.evaluate(() => window.neural.engine.stop())
    }
    // the rate really changes the speech: the same text at 2x is clearly shorter than at 1x (not exactly half: Piper's
    // duration predictor has a floor per phoneme, measured ~0.63 here)
    const text = 'Cuando llegó la primavera, los campos se llenaron de flores amarillas y el aire olía a tierra mojada.'
    const durationAt = async rate => {
      await page.evaluate(() => { window.neural.starts.length = 0 })
      await page.evaluate(([voice, t, r]) => window.neural.readAll(voice, [t], r, { prefix: 'd' }), ['piper:es_MX-claude-high', text, rate])
      return (await page.evaluate(() => window.neural.starts.splice(0))).reduce((sum, s) => sum + s.duration, 0)
    }
    const normal = await durationAt(1), double = await durationAt(2)
    numbers.rateDurations = { rate1: +normal.toFixed(2), rate2: +double.toFixed(2), ratio: +(double / normal).toFixed(2) }
    expect(double / normal).toBeGreaterThan(0.4)
    expect(double / normal).toBeLessThan(0.75)
    // the compute speed is rate dependent (the spike measured ~0.45 at 1x, ~0.7 at 1.5x, ~0.9 at 2x)
    expect(numbers.rate2.rtf).toBeGreaterThan(numbers.reading6.rtfEma * 0.9)
  })

  test('stop() cancels cleanly: no stray events, nothing keeps playing, and speaking again works', async () => {
    const result = await page.evaluate(async ([voice, texts]) => {
      const seen = []
      const on = e => seen.push({ ...e.detail, at: performance.now() })
      window.addEventListener('inhouse-tts', on)
      const started = new Promise(resolve => { const w = e => { if (e.detail.type === 'start') { window.removeEventListener('inhouse-tts', w); resolve() } }; window.addEventListener('inhouse-tts', w) })
      window.neural.engine.speak({ text: texts[4], voiceId: voice, rate: 1, id: 'stop1', upcoming: texts.slice(0, 3) })
      await started
      const stoppedAt = performance.now(), startsBefore = window.neural.starts.length
      window.neural.engine.stop()
      await new Promise(r => setTimeout(r, 3500))
      const after = seen.filter(e => e.at > stoppedAt)
      const status = window.neural.engine.status
      window.removeEventListener('inhouse-tts', on)
      // replace: speak A, then B straight away: only B is heard
      const replaced = []
      const on2 = e => replaced.push({ type: e.detail.type, id: e.detail.id })
      window.addEventListener('inhouse-tts', on2)
      window.neural.engine.speak({ text: texts[1], voiceId: voice, rate: 1, id: 'A', upcoming: [] })
      window.neural.engine.speak({ text: texts[2], voiceId: voice, rate: 1, id: 'B', upcoming: [] })
      await new Promise(resolve => { const w = e => { if (e.detail.id === 'B' && e.detail.type === 'done') { window.removeEventListener('inhouse-tts', w); resolve() } }; window.addEventListener('inhouse-tts', w) })
      window.removeEventListener('inhouse-tts', on2)
      return { after, status, replaced, newStarts: window.neural.starts.length - startsBefore }
    }, ['piper:es_MX-claude-high', FRAGMENTS])
    expect(result.after).toEqual([])
    expect(result.status).toBe('idle')
    expect(result.replaced.filter(e => e.id === 'A')).toEqual([])
    expect(result.replaced.filter(e => e.id === 'B').map(e => e.type)).toEqual(['start', 'done'])
  })

  test('a second voice (English) installs and reads; switching voices keeps one session', async () => {
    test.skip(!haveVoice(EN), 'English fixture missing')
    await page.evaluate(() => window.neural.engine.install('piper:en_US-lessac-medium'))
    expect(await page.evaluate(() => [...window.neural.engine.installed].sort())).toEqual(['piper:en_US-lessac-medium', 'piper:es_MX-claude-high'])
    const log = await page.evaluate(([voice, texts]) => window.neural.readAll(voice, texts, 1, { prefix: 'e' }), ['piper:en_US-lessac-medium', ENGLISH])
    expect(log.some(e => e.type === 'error'), JSON.stringify(log)).toBe(false)
    expect(log.filter(e => e.type === 'start').length).toBe(ENGLISH.length)
    expect(log.filter(e => e.type === 'done').length).toBe(ENGLISH.length)
    numbers.english = { firstAudioMs: Math.round(log.find(e => e.type === 'start').at) }
    // and back to Spanish: the worker swaps sessions
    const back = await page.evaluate(([voice, texts]) => window.neural.readAll(voice, texts, 1, { prefix: 'b' }), ['piper:es_MX-claude-high', ['El camino de vuelta fue largo, pero nadie se quejó de ello.']])
    expect(back.filter(e => e.type === 'done').length).toBe(1)
    numbers.voiceSwitchFirstAudioMs = Math.round(back.find(e => e.type === 'start').at)
  })

  test('end to end WAV of a Spanish sentence through the production path matches the spike audio', async () => {
    await page.evaluate(() => { window.__capture = true; window.neural.starts.length = 0 })
    const text = FRAGMENTS[0]
    const log = await page.evaluate(([voice, t]) => window.neural.readAll(voice, [t], 1, { prefix: 'wav' }), ['piper:es_MX-claude-high', text])
    expect(log.map(e => e.type)).toEqual(['start', 'done'])
    const chunks = await page.evaluate(() => { window.__capture = false; return window.neural.starts.splice(0).map(s => ({ data: s.data, sampleRate: s.sampleRate })) })
    const sampleRate = chunks[0].sampleRate
    const pcm = Float32Array.from(chunks.flatMap(c => c.data))
    writeFileSync(join(EVIDENCE, `engine-${ES}-es1.wav`), wavOf(pcm, sampleRate))
    const mine = { seconds: pcm.length / sampleRate, ...stats(pcm) }
    expect(mine.finite).toBe(true)
    expect(mine.seconds).toBeGreaterThan(3)
    expect(mine.peak).toBeGreaterThan(0.5)
    expect(mine.peak).toBeLessThanOrEqual(0.9001)
    numbers.wav = { mine, sampleRate }
    const spikeFile = join(SPIKE_WAV, `${ES}__es1.wav`)
    if (existsSync(spikeFile)) {
      const spike = readWav(spikeFile)
      const reference = { seconds: spike.pcm.length / spike.sampleRate, ...stats(spike.pcm) }
      numbers.wav.spike = reference
      // same model, same text: the speech lasts the same (we only trim quiet edges and add a sentence pause), and its shape (rms/peak) is alike
      expect(Math.abs(mine.seconds - reference.seconds)).toBeLessThan(0.9)
      expect(Math.abs(mine.rms / mine.peak - reference.rms / reference.peak) / (reference.rms / reference.peak)).toBeLessThan(0.3)
    }
  })

  test('with no network the download fails as "offline" and the real HF URL layout is used by default', async () => {
    const requested = []
    const record = request => requested.push(request.url())
    page.on('request', record)
    await page.route('https://huggingface.co/**', route => route.abort('internetdisconnected'))
    const result = await page.evaluate(async () => {
      const original = window.INHOUSE_NEURAL_VOICE_BASE
      window.INHOUSE_NEURAL_VOICE_BASE = '' // the default base: Hugging Face
      let code = null
      try { await window.neural.engine.install('piper:de_DE-thorsten-medium') } catch (error) { code = error.code }
      window.INHOUSE_NEURAL_VOICE_BASE = original
      return { code, downloads: [...window.neural.engine.downloads.values()].map(d => d.state) }
    })
    page.off('request', record)
    result.requested = requested.filter(url => url.startsWith('https://huggingface.co/'))
    expect(result.requested[0]).toBe('https://huggingface.co/rhasspy/piper-voices/resolve/main/de/de_DE/thorsten/medium/de_DE-thorsten-medium.onnx.json')
    expect(result.code).toBe('offline')
    expect(result.downloads).toEqual(['error'])
  })
})
