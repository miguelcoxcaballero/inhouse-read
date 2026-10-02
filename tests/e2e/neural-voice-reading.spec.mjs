// The natural voices END TO END, nothing faked on the app side: the production build, the real picker, the real download
// into Cache Storage, the real engine (Web Worker, onnxruntime-web + espeak-ng WebAssembly, Piper weights) and Web Audio,
// reading real EPUB and PDF books aloud. Only Hugging Face is replaced (tests/e2e/helpers/hf-mirror.mjs serves the voices
// from a fixture folder under the same layout and the page's INHOUSE_NEURAL_VOICE_BASE points at it); a second test uses
// the default huggingface.co URLs through route interception. The speaker is not audible in CI: what is checked is what the
// page does (audio scheduled with sane samples, 'start' events, highlight, page turns, controls).
//
//   NEURAL_VOICE_FIXTURES  folder with <piperId>.onnx and <piperId>.onnx.json (default: the sandbox spike folder); the whole
//                          spec is skipped when its voices are not there, so CI without the 63 MB files stays green.
//   NEURAL_VOICE_EVIDENCE  folder for the screenshots and numbers.json (default: test-results/neural-voice-reading).
//
// Heavy (a real neural voice thinks hard on one core): about six minutes. Run it alone.
import { test, expect } from '@playwright/test'
import { openAudioMenu, pickVoice, selectedOption } from './helpers/audio-menus.mjs'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { loadavg } from 'node:os'
import { FIXTURES, haveVoice, hfPath, startHuggingFaceMirror } from './helpers/hf-mirror.mjs'

const EPUB = 'tests/e2e/fixtures/lectura-es.epub'
const PDF = 'tests/e2e/fixtures/lectura-es.pdf'
const EVIDENCE = process.env.NEURAL_VOICE_EVIDENCE || 'test-results/neural-voice-reading'
const CLAUDE = 'es_MX-claude-high', DAVEFX = 'es_ES-davefx-medium'
const CLAUDE_ID = `piper:${CLAUDE}`, DAVEFX_ID = `piper:${DAVEFX}`
const SLOW = { timeout: 90_000 }
const numbers = {}

const squash = text => String(text).replace(/\s+/g, '')

// ---- Instrumentation, installed before the app starts. It only OBSERVES: Web Audio sources, 'inhouse-tts' events, the
// ---- sentence highlight, progress bars and frame cadence; the speechSynthesis stand-in is the "system voice" of the test.
function instrument({ base }) {
  if (base) window.INHOUSE_NEURAL_VOICE_BASE = base
  const neu = window.__neu = { audio: [], stops: 0, events: [], progress: [], speak: [], tap: 0, frames: [], longTasks: [] }
  const read = win => { const highlight = win?.CSS?.highlights?.get('inhouse-speech'); return highlight ? [...highlight].map(range => range.toString()).join('') : '' }
  window.__speechHighlight = () => read(window) || read(document.querySelector('foliate-view')?.renderer?.getContents?.()[0]?.doc?.defaultView)

  const start = AudioBufferSourceNode.prototype.start, stop = AudioBufferSourceNode.prototype.stop
  AudioBufferSourceNode.prototype.start = function (when, ...rest) {
    const data = this.buffer.getChannelData(0)
    let peak = 0, sum = 0, finite = true
    for (let i = 0; i < data.length; i++) { const x = data[i]; if (!Number.isFinite(x)) finite = false; else { const a = Math.abs(x); if (a > peak) peak = a; sum += x * x } }
    neu.audio.push({ at: performance.now(), when: when || 0, now: this.context.currentTime, duration: this.buffer.duration, sampleRate: this.buffer.sampleRate, peak, rms: Math.sqrt(sum / Math.max(1, data.length)), finite, state: this.context.state })
    return start.call(this, when, ...rest)
  }
  AudioBufferSourceNode.prototype.stop = function (...args) { neu.stops++; return stop.apply(this, args) }

  window.addEventListener('inhouse-tts', event => {
    const entry = { ...event.detail, at: performance.now(), highlight: null }
    neu.events.push(entry)
    // The app's own listener ran for this same event (it paints at 'start'); read what is on screen after it.
    if (entry.type === 'start') setTimeout(() => { entry.highlight = window.__speechHighlight() }, 0)
  })
  document.addEventListener('click', event => { if (event.target.closest?.('[data-play], [data-mini-play]')) neu.tap = performance.now() }, true)
  // The picker repaints its rows, so progress is sampled rather than observed on one element.
  setInterval(() => { const bar = document.querySelector('[role="progressbar"]'); if (bar) neu.progress.push(Number(bar.getAttribute('aria-valuenow'))) }, 40)
  try { new PerformanceObserver(list => { for (const entry of list.getEntries()) neu.longTasks.push(entry.duration) }).observe({ type: 'longtask', buffered: true }) } catch { /* not supported */ }

  // The system voice: speechSynthesis with one Spanish voice; every utterance starts at once and ends after a short timer.
  const log = [], state = { ms: 250 }
  window.__tts = { log, state }
  window.SpeechSynthesisUtterance = class { constructor(text) { this.text = text } }
  Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: {
    getVoices: () => [{ name: 'Sistema', lang: 'es-ES', voiceURI: 'sistema-es', localService: true }], addEventListener() {}, removeEventListener() {}, pause() {}, resume() {},
    cancel() { clearTimeout(state.pending) },
    speak(utterance) { log.push({ text: utterance.text, highlight: '' }); Promise.resolve().then(() => { utterance.onstart?.({}); log.at(-1).highlight = window.__speechHighlight(); state.pending = setTimeout(() => utterance.onend?.({}), state.ms) }) }
  } })
}

// ---- Page helpers -------------------------------------------------------------------------------------------------------
async function open(page, file) {
  await page.goto('./')
  await page.locator('#file-picker').setInputFiles(file)
  await expect(page.locator(file.endsWith('pdf') ? '.pdf-text-layer span' : 'foliate-view').first()).toBeVisible(SLOW)
  if (file.endsWith('pdf')) await expect(page.locator('#reader-location')).toHaveAttribute('aria-label', /Página 1 de 3/, SLOW)
  else await expect.poll(() => page.evaluate(() => Boolean(document.querySelector('foliate-view')?.renderer?.getContents?.()[0]?.doc?.body)), SLOW).toBe(true)
}
const chapter = page => page.evaluate(() => document.querySelector('foliate-view')?.renderer?.getContents?.()[0]?.doc.querySelector('h1')?.textContent || '')
const openAudio = async page => { await page.getByRole('button', { name: 'Escuchar el libro' }).click(); await openAudioMenu(page, 'Voz') } // the natural voices live in the Voz list
const closePanel = page => page.getByRole('button', { name: 'Cerrar opciones de lectura' }).click()
const play = page => page.getByRole('button', { name: 'Reproducir', exact: true }).click()
const row = (page, id) => page.locator(`[data-neural-voice="${id}"]`)
const neu = (page, fn, arg) => page.evaluate(`(${fn})(window.__neu, ${JSON.stringify(arg ?? null)})`)
const starts = page => neu(page, n => n.events.filter(event => event.type === 'start').map(event => ({ id: event.id, at: event.at, highlight: event.highlight })))
const types = (page, since = 0) => neu(page, (n, from) => n.events.slice(from).map(event => event.type), since)
const eventCount = page => neu(page, n => n.events.length)
const systemSpoken = page => page.evaluate(() => window.__tts.log.length)
const noOverflow = page => page.locator('.reading-panel').evaluate(panel => panel.scrollWidth <= panel.clientWidth)
const shot = async (page, name, locator) => { mkdirSync(EVIDENCE, { recursive: true }); await (locator || page).screenshot({ path: join(EVIDENCE, `${name}.png`) }) }
// The real engine of the page (the lazy chunk the app itself loaded): used to read its stats and to record what the reader asks it.
async function spyOnEngine(page) {
  await expect.poll(() => page.evaluate(async () => {
    if (window.__neuEngine) return true
    for (const url of performance.getEntriesByType('resource').map(entry => entry.name).filter(name => /\/assets\/index-[\w-]+\.js$/.test(name))) {
      const module = await import(url)
      // The production chunk mangles its export names but keeps the facade as one namespace object (what the app's lazy import returns).
      const facade = module.getNeuralEngine ? module : Object.values(module).find(value => typeof value?.getNeuralEngine === 'function')
      if (!facade) continue
      const engine = facade.getNeuralEngine(), speak = engine.speak.bind(engine)
      engine.speak = request => { window.__neu.speak.push({ text: request.text, voiceId: request.voiceId, rate: request.rate, id: request.id, upcoming: request.upcoming?.length || 0, at: performance.now() }); return speak(request) }
      window.__neuEngine = engine
      return true
    }
    return false
  }), SLOW).toBe(true)
}
const engineStats = page => page.evaluate(() => ({ ...window.__neuEngine.stats, status: window.__neuEngine.status, installed: [...window.__neuEngine.installed] }))

/** Sum of the resident memory of every Chromium process of the sandbox (MB): the worker's ONNX Runtime heap included. */
function residentMB() {
  let total = 0
  for (const pid of readdirSync('/proc').filter(name => /^\d+$/.test(name))) {
    try {
      if (!readFileSync(`/proc/${pid}/cmdline`, 'utf8').includes('headless_shell')) continue
      total += Number(readFileSync(`/proc/${pid}/statm`, 'utf8').split(' ')[1]) * 4096 / 1048576
    } catch { /* the process ended */ }
  }
  return total
}
function watchMemory() {
  let peak = 0
  const timer = setInterval(() => { peak = Math.max(peak, residentMB()) }, 400)
  return () => { clearInterval(timer); return Math.round(Math.max(peak, residentMB())) }
}

/** Every sample of what the engine scheduled so far is sane: finite, audible, not clipped. */
async function expectCleanAudio(page, label) {
  const audio = await neu(page, n => n.audio)
  expect(audio.length, `${label}: audio was scheduled`).toBeGreaterThan(0)
  expect(audio.every(chunk => chunk.finite), `${label}: no NaN/Infinity`).toBe(true)
  expect(Math.min(...audio.map(chunk => chunk.peak)), `${label}: every chunk is audible`).toBeGreaterThan(0.05)
  expect(Math.max(...audio.map(chunk => chunk.peak)), `${label}: nothing clips`).toBeLessThanOrEqual(1)
  expect(Math.min(...audio.map(chunk => chunk.rms)), `${label}: not just a click`).toBeGreaterThan(0.004)
  expect(new Set(audio.map(chunk => chunk.sampleRate)).size).toBe(1)
  return audio
}

test.afterAll(() => {
  if (!Object.keys(numbers).length) return
  mkdirSync(EVIDENCE, { recursive: true })
  numbers.machine = { loadAverageAtEnd: loadavg().map(x => +x.toFixed(2)) }
  writeFileSync(join(EVIDENCE, 'numbers.json'), JSON.stringify(numbers, null, 2))
})

test.describe.configure({ mode: 'serial' })
test.describe('natural voices, end to end (real picker, download, engine and audio)', () => {
  test.skip(!haveVoice(CLAUDE), `fixtures not found in ${FIXTURES} (set NEURAL_VOICE_FIXTURES)`)
  test.setTimeout(280_000)

  let context, page, mirror
  const errors = []
  test.beforeAll(async ({ browser }) => {
    mirror = await startHuggingFaceMirror({ voices: [CLAUDE], sliceMs: 60 })
    // One browser context for the whole story: Cache Storage (the downloaded voice), the saved voice and the speed survive its reloads.
    context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' })
    await context.addInitScript(instrument, { base: mirror.base })
    page = await context.newPage()
    page.on('pageerror', error => errors.push(error.message))
  })
  test.afterAll(async () => {
    await context?.close()
    await mirror?.close()
  })

  test('picker: Spanish voices first, nothing downloads by itself, the download shows progress and the voice is selected', async () => {
    await open(page, EPUB)
    await openAudio(page)
    const block = page.locator('[data-neural]')
    await expect(block.getByRole('heading', { name: 'Voces naturales' })).toBeVisible(SLOW)
    // The book is Spanish: its voices come first, the recommended one on top.
    const order = await block.locator('[data-neural-voice]').evaluateAll(items => items.map(item => item.dataset.neuralVoice))
    expect(order.slice(0, 5)).toEqual([CLAUDE_ID, 'piper:es_AR-daniela-high', DAVEFX_ID, 'piper:es_ES-sharvard-medium', 'piper:es_ES-sharvard-medium#1']) // es_AR (high quality) sorts right after the recommended voice
    await expect(row(page, CLAUDE_ID)).toContainText('Recomendada')
    expect(mirror.hits).toEqual([]) // opening the picker never downloads

    await row(page, CLAUDE_ID).getByRole('button', { name: /Descargar la voz Claude/ }).click()
    const bar = row(page, CLAUDE_ID).getByRole('progressbar', { name: 'Descargando Claude' })
    await expect(bar).toBeVisible(SLOW)
    await expect.poll(() => bar.getAttribute('aria-valuenow').then(Number).catch(() => 100), SLOW).toBeGreaterThan(5) // mid-download, on screen
    await shot(page, 'download-in-progress').catch(() => {}) // best effort: the picture is evidence, not an assertion
    await expect(row(page, CLAUDE_ID).getByRole('button', { name: /Voz en uso Claude/ })).toHaveAttribute('aria-pressed', 'true', SLOW)
    await expect(row(page, CLAUDE_ID)).toContainText('Instalada')
    await expect(selectedOption(page)).toHaveAttribute('data-value', CLAUDE_ID)
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('inhouse-read-reading-preferences')).voice)).toBe(CLAUDE_ID)
    expect(await noOverflow(page)).toBe(true)

    const progress = await neu(page, n => n.progress)
    expect(progress.some(value => value > 0 && value < 100), `intermediate progress values seen: ${progress}`).toBe(true)
    expect(progress.every((value, i) => i === 0 || value >= progress[i - 1])).toBe(true) // it only moves forward
    // Only the model, its config and the catalogue were fetched, from the voice's own folder.
    expect(mirror.hits.filter(hit => hit !== 'voices.json').sort()).toEqual([`${hfPath(CLAUDE)}.onnx`, `${hfPath(CLAUDE)}.onnx.json`].sort())
    await shot(page, 'picker-installed')
    numbers.download = { progressValuesSeen: progress.length, modelMB: 63 }
  })

  for (const [format, file] of [['EPUB', EPUB], ['PDF', PDF]]) {
    test(`${format}: the real engine reads the book aloud: highlight at every start, pages turn, pause, speed, stop`, async () => {
      const stopMemory = watchMemory()
      await open(page, file)
      await openAudio(page)
      await expect(row(page, CLAUDE_ID).getByRole('button', { name: /Voz en uso Claude/ })).toBeVisible(SLOW) // the voice came back from Cache Storage after the reload
      await spyOnEngine(page)
      expect(await engineStats(page)).toMatchObject({ status: 'idle', installed: [CLAUDE_ID] })
      const rate = page.getByRole('slider', { name: 'Velocidad de voz' })
      await rate.fill('1.2')

      // --- Play: the engine speaks (audio scheduled), the system voice stays silent.
      await play(page)
      await expect.poll(() => neu(page, n => n.audio.length), SLOW).toBeGreaterThan(0)
      await expect.poll(async () => (await starts(page)).length, SLOW).toBeGreaterThan(0)
      const first = await neu(page, n => ({ tap: n.tap, audio: n.audio[0].at, start: n.events.find(event => event.type === 'start').at, state: n.audio[0].state }))
      expect(first.state).toBe('running')
      expect(await systemSpoken(page)).toBe(0)
      expect((await neu(page, n => n.speak))[0]).toMatchObject({ voiceId: CLAUDE_ID, rate: 1.2 })
      expect((await neu(page, n => n.speak))[0].upcoming).toBeGreaterThanOrEqual(1)
      await closePanel(page)

      // --- Reading moves on: the sentence highlight shows at every fragment's start, and the page turns on its own.
      if (format === 'EPUB') await expect.poll(() => chapter(page), SLOW).toBe('La pregunta')
      else await expect(page.locator('#reader-location')).toHaveAttribute('aria-label', /Página 2 de 3/, SLOW)
      await expect.poll(async () => (await starts(page)).length, SLOW).toBeGreaterThan(3)
      await expect(page.getByRole('button', { name: 'Pausar lectura' })).toBeVisible()
      const reading = await starts(page)
      expect(reading.every(entry => entry.highlight), `every start had a highlight: ${JSON.stringify(reading.map(entry => entry.highlight))}`).toBe(true)
      expect(new Set(reading.map(entry => squash(entry.highlight))).size).toBeGreaterThan(2) // it moves
      const spoken = squash((await neu(page, n => n.speak)).map(call => call.text).join(''))
      for (const entry of reading) expect(spoken).toContain(squash(entry.highlight).replace(/\.$/, '').slice(0, 40)) // what was painted is what was asked of the engine
      expect(await systemSpoken(page)).toBe(0)
      const audio = await expectCleanAudio(page, format)
      // The queue is gapless on the audio clock: every chunk starts where the previous one ended (or later only after an honest wait).
      const stats = await engineStats(page)
      numbers[`${format}Reading`] = { fragmentsStarted: reading.length, chunks: audio.length, audioSeconds: +audio.reduce((sum, c) => sum + c.duration, 0).toFixed(1), ...stats }
      expect(stats.tooSlow).toBe(0)
      // Silence between one fragment's 'done' and the next one's 'start': ~0 inside a page (gapless look-ahead), longer where the page turns
      // (the next page's text is only known after the turn, so its first fragment is computed from scratch).
      const gaps = await neu(page, n => n.events.flatMap((event, i) => event.type === 'done' && n.events[i + 1]?.type === 'start' ? [Math.round(n.events[i + 1].at - event.at)] : []))
      numbers[`${format}Reading`].silenceBetweenFragmentsMs = gaps
      // Silence on the audio clock between consecutive scheduled chunks (an underrun shows up here as a gap inside the speech).
      numbers[`${format}Reading`].audioClockGapsOver30ms = audio.flatMap((chunk, i) => i && chunk.when >= audio[i - 1].when ? [Math.round((chunk.when - audio[i - 1].when - audio[i - 1].duration) * 1000)] : []).filter(gap => gap > 30)
      expect(Math.max(...gaps)).toBeLessThan(6000)

      // --- Pause: the voice stops at once and the highlight goes; resume speaks the same sentence again.
      const speaksBefore = (await neu(page, n => n.speak)).length
      await page.getByRole('button', { name: 'Pausar lectura' }).click()
      await expect.poll(() => page.evaluate(() => window.__speechHighlight())).toBe('')
      const pausedAt = await eventCount(page), scheduledAtPause = await neu(page, n => n.audio.length)
      await page.waitForTimeout(1500)
      expect(await types(page, pausedAt)).toEqual([]) // no event for the cancelled fragment, nothing keeps playing
      expect(await neu(page, n => n.audio.length)).toBe(scheduledAtPause) // and nothing more is queued behind the silence
      expect((await engineStats(page)).status).toBe('idle')
      const lastSpoken = (await neu(page, n => n.speak)).at(-1).text
      await page.getByRole('button', { name: 'Continuar lectura' }).click()
      await expect.poll(async () => (await neu(page, n => n.speak)).length, SLOW).toBeGreaterThan(speaksBefore)
      expect((await neu(page, n => n.speak)).at(-1).text).toBe(lastSpoken)
      await expect.poll(async () => (await starts(page)).at(-1).at > Date.now() * 0 + pausedAt, SLOW).toBe(true)
      await expect.poll(() => page.evaluate(() => window.__speechHighlight()), SLOW).not.toBe('')

      // --- Speed: a new speed is heard now (the fragment is spoken again at that speed) and the look-ahead is rebuilt for it.
      await page.getByRole('button', { name: 'Escuchar el libro' }).click()
      await page.getByRole('slider', { name: 'Velocidad de voz' }).fill('1.6')
      await expect.poll(async () => (await neu(page, n => n.speak)).at(-1).rate, SLOW).toBe(1.6)
      const afterSpeed = await eventCount(page)
      await expect.poll(async () => (await types(page, afterSpeed)).includes('start'), SLOW).toBe(true)
      expect((await neu(page, n => n.speak)).at(-1)).toMatchObject({ voiceId: CLAUDE_ID, rate: 1.6 })
      expect(await systemSpoken(page)).toBe(0)
      await shot(page, `${format}-speaking`)
      await page.getByRole('button', { name: 'Cerrar opciones de lectura' }).click()

      // --- Stop: silence, highlight gone, ready again.
      await page.getByRole('button', { name: 'Detener lectura' }).click()
      await expect.poll(() => page.evaluate(() => window.__speechHighlight())).toBe('')
      const stoppedAt = await eventCount(page)
      await page.waitForTimeout(1500)
      expect((await types(page, stoppedAt)).filter(type => type !== 'done')).toEqual([])
      await page.getByRole('button', { name: 'Escuchar el libro' }).click()
      await expect(page.locator('.reading-audio-status')).toHaveText('Detenido')
      expect(errors).toEqual([])
      numbers[`${format}Reading`].peakResidentMB = stopMemory()
    })
  }

  test('first audio after the Play tap with the voice cached: cold worker, warmed-up voice, and a worker that is alive', async () => {
    const heard = async () => {
      await expect.poll(async () => (await starts(page)).length, SLOW).toBeGreaterThan(0)
      return neu(page, n => { const first = n.events.find(event => event.type === 'start'); return { tapToAudioScheduledMs: Math.round(n.audio[0].at - n.tap), tapToStartEventMs: Math.round(first.at - n.tap) } })
    }
    const stopAndForget = async () => {
      await page.getByRole('button', { name: 'Detener', exact: true }).click()
      await page.evaluate(() => { window.__neu.audio.length = 0; window.__neu.events.length = 0; window.__neu.speak.length = 0 })
    }
    // A: what the tap cost before the warm-up existed: the voice is cached but the worker is cold. The page warms the voice by itself
    // (the book opened with it selected), so wait for that and then throw the worker away, as the 90 s idle teardown would.
    await open(page, EPUB)
    await openAudio(page)
    await spyOnEngine(page)
    await expect.poll(() => page.evaluate(() => window.__neuEngine.core?.client?.loaded || ''), SLOW).toBe(CLAUDE)
    await page.evaluate(() => { const core = window.__neuEngine.core; core.client.dispose(); core.client = null })
    await play(page)
    numbers.firstAudio = { coldWorker: await heard() }
    await stopAndForget()

    // B: the person took a few seconds in the panel: the warm-up (worker + model) is done by the tap.
    await open(page, EPUB)
    await openAudio(page)
    await spyOnEngine(page)
    await expect.poll(() => page.evaluate(() => window.__neuEngine.core?.client?.loaded || ''), SLOW).toBe(CLAUDE)
    await play(page)
    numbers.firstAudio.tapAfterWarmUp = await heard()
    expect(numbers.firstAudio.tapAfterWarmUp.tapToStartEventMs, 'the warm-up takes the cold start off the tap').toBeLessThan(numbers.firstAudio.coldWorker.tapToStartEventMs * 0.7)
    await stopAndForget()

    // C: reading again within 90 s of the last speech (another speed, so nothing comes from the replay cache): the worker is alive.
    await page.getByRole('slider', { name: 'Velocidad de voz' }).fill('1.3')
    await play(page)
    numbers.firstAudio.tapWithWorkerAlive = await heard()
    expect(numbers.firstAudio.tapWithWorkerAlive.tapToStartEventMs).toBeLessThan(5000)
    await stopAndForget()
    expect(errors).toEqual([])
  })

  test('switching to a system voice in the middle of the reading, and back', async () => {
    await open(page, EPUB)
    await openAudio(page)
    await spyOnEngine(page)
    await page.getByRole('slider', { name: 'Velocidad de voz' }).fill('1.2')
    await play(page)
    await expect.poll(async () => (await starts(page)).length, SLOW).toBeGreaterThan(0)
    const neuralStarts = (await starts(page)).length
    const speaks = (await neu(page, n => n.speak)).length

    await pickVoice(page, 'sistema-es')
    await expect.poll(() => systemSpoken(page), SLOW).toBeGreaterThan(1) // the system voice carries on, fragment after fragment
    expect((await neu(page, n => n.speak)).length).toBe(speaks) // the neural engine is not asked again
    const quiet = await eventCount(page)
    await page.waitForTimeout(1200)
    expect((await types(page, quiet)).includes('start')).toBe(false) // and it is silent: no neural start after the switch
    expect((await engineStats(page)).status).toBe('idle')
    await expect.poll(() => page.evaluate(() => window.__speechHighlight()), SLOW).not.toBe('') // the highlight still follows
    expect(await starts(page)).toHaveLength(neuralStarts)

    // Back to the natural voice: it takes over again at once.
    await pickVoice(page, CLAUDE_ID)
    await expect.poll(async () => (await neu(page, n => n.speak)).length, SLOW).toBeGreaterThan(speaks)
    await expect.poll(async () => (await starts(page)).length, SLOW).toBeGreaterThan(neuralStarts)
    // Leaving the book while the natural voice speaks silences it for good (the reader's own stop, nothing keeps playing on the shelf).
    await closePanel(page)
    await page.locator('#reader-back').click()
    await expect(page.getByRole('heading', { name:'Biblioteca' })).toBeVisible(SLOW)
    await expect.poll(async () => (await engineStats(page)).status, SLOW).toBe('idle')
    const left = await eventCount(page), scheduled = await neu(page, n => n.audio.length)
    await page.waitForTimeout(2000)
    expect((await types(page, left)).filter(type => type !== 'done')).toEqual([])
    expect(await neu(page, n => n.audio.length)).toBe(scheduled)
    expect(errors).toEqual([])
  })

  test('idle: a worker nobody speaks to is torn down after ~90 s (the memory comes back) and the next Play rebuilds it from the cache', async () => {
    test.skip(!process.env.NEURAL_VOICE_IDLE, 'takes ~2 minutes: set NEURAL_VOICE_IDLE=1')
    await open(page, EPUB)
    await openAudio(page)
    await spyOnEngine(page)
    await expect.poll(() => page.evaluate(() => window.__neuEngine.core?.client?.loaded || ''), SLOW).toBe(CLAUDE) // warmed up, nothing spoken
    await page.waitForTimeout(2000)
    const warm = residentMB()
    await page.waitForTimeout(95_000)
    expect(await page.evaluate(() => window.__neuEngine.core.client)).toBeNull() // terminated by the engine's own idle timer
    const torn = residentMB()
    numbers.idleTeardown = { residentWarmMB: Math.round(warm), residentAfterMB: Math.round(torn), freedMB: Math.round(warm - torn) }
    expect(warm - torn).toBeGreaterThan(250)
    await play(page) // rebuilt lazily from Cache Storage
    await expect.poll(async () => (await starts(page)).length, SLOW).toBeGreaterThan(0)
    await expectCleanAudio(page, 'after teardown')
    await page.getByRole('button', { name: 'Detener', exact: true }).click()
  })

  test('the shelf loads none of the engine, and its frames stay fluid while the voice thinks next to it', async () => {
    const lazy = /\/(engine|worker)-[\w-]+\.js|\/neural-voice\//
    await page.goto('./')
    await expect(page.getByRole('heading', { name:'Biblioteca' })).toBeVisible(SLOW)
    await page.waitForTimeout(3000)
    expect(await page.evaluate(pattern => performance.getEntriesByType('resource').map(entry => entry.name).filter(name => new RegExp(pattern).test(name)), lazy.source)).toEqual([]) // nothing of the engine reaches the shelf's start-up

    // Open a book once (the engine's chunk loads with it), come back to the shelf and let the engine speak while the shelf renders.
    await page.locator('#file-picker').setInputFiles(EPUB)
    await expect.poll(() => page.evaluate(() => Boolean(document.querySelector('foliate-view')?.renderer?.getContents?.()[0]?.doc?.body)), SLOW).toBe(true)
    await openAudio(page)
    await spyOnEngine(page)
    await closePanel(page)
    await page.locator('#reader-back').click()
    await expect(page.getByRole('heading', { name:'Biblioteca' })).toBeVisible(SLOW)
    await page.evaluate(() => {
      const neu = window.__neu
      window.__sample = ms => new Promise(resolve => {
        neu.longTasks.length = 0
        const deltas = []; let last = performance.now(); const end = last + ms
        const tick = now => { deltas.push(now - last); last = now; if (now < end) requestAnimationFrame(tick); else resolve({ deltas, longTasks: [...neu.longTasks] }) }
        requestAnimationFrame(tick)
      })
      document.addEventListener('click', () => window.__neuEngine.unlock(), { once: true })
    })
    const summary = ({ deltas, longTasks }) => {
      const sorted = [...deltas].sort((a, b) => a - b), at = q => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))]
      return { frames: deltas.length, p50: +at(0.5).toFixed(1), p95: +at(0.95).toFixed(1), max: +sorted.at(-1).toFixed(1), longTasks: longTasks.length, longestTask: Math.round(Math.max(0, ...longTasks)) }
    }
    const stopMemory = watchMemory()
    const baseline = summary(await page.evaluate(() => window.__sample(5000)))

    await page.getByRole('heading', { name:'Biblioteca' }).click() // a real tap: the audio context is unlocked inside it
    const texts = ['Después de un largo día, Ana volvió a casa y abrió el libro que su abuelo le había regalado.', 'La lluvia golpeaba suavemente los cristales de la vieja biblioteca.', 'Nadie en el pueblo recordaba cuándo había llegado el forastero.', 'Todos coincidían en que traía consigo una maleta de cuero gastada.', 'Ella sonrió, cerró el libro y apagó la lámpara.']
    await page.evaluate(({ texts, voiceId }) => {
      let i = 0
      const speak = () => window.__neuEngine.speak({ text: texts[i], voiceId, rate: 1.2, id: `m${i}`, upcoming: texts.slice(i + 1, i + 4) })
      window.addEventListener('inhouse-tts', event => { if (event.detail.type === 'done' && String(event.detail.id).startsWith('m') && ++i < texts.length) speak() })
      speak()
    }, { texts, voiceId: CLAUDE_ID })
    const speaking = summary(await page.evaluate(() => window.__sample(14000)))
    const memory = stopMemory()
    const stats = await engineStats(page)
    expect(await expectCleanAudio(page, 'shelf')).toBeTruthy()
    numbers.shelfNextToTheVoice = { baseline, whileSynthesising: speaking, engine: stats, peakResidentMB: memory }
    // The voice thinks in a worker: the page's frames do not wait for it. (Software GL makes the shelf itself slow; what matters is the difference.)
    expect(speaking.p50).toBeLessThan(baseline.p50 * 2 + 10)
    expect(speaking.max).toBeLessThan(baseline.max * 2 + 150)
    expect(speaking.longestTask).toBeLessThan(Math.max(250, baseline.longestTask * 2))
    await page.evaluate(() => window.__neuEngine.stop())
    expect(errors).toEqual([])
  })

  test('offline: the downloaded voice still speaks after a reload with Hugging Face unreachable', async () => {
    await context.route(`${mirror.origin}/**`, route => route.abort('internetdisconnected'))
    const failed = []
    page.on('requestfailed', request => { if (request.url().startsWith(mirror.origin)) failed.push(request.url()) })
    const hitsBefore = mirror.hits.length
    await open(page, EPUB)
    await openAudio(page)
    // The list is read from Cache Storage, no network needed.
    await expect(row(page, CLAUDE_ID).getByRole('button', { name: /Voz en uso Claude/ })).toBeVisible(SLOW)
    await expect(row(page, CLAUDE_ID)).toContainText('Instalada')
    await spyOnEngine(page)
    await play(page)
    await expect.poll(async () => (await starts(page)).length, SLOW).toBeGreaterThan(1)
    expect((await expectCleanAudio(page, 'offline')).length).toBeGreaterThan(0)
    expect(await systemSpoken(page)).toBe(0)
    expect(mirror.hits.length).toBe(hitsBefore) // not a single request reached the voice host
    // Trying to download another voice says so in Spanish instead of failing silently.
    await row(page, DAVEFX_ID).getByRole('button', { name: /Descargar la voz Davefx/ }).click()
    await expect(row(page, DAVEFX_ID).getByRole('alert')).toHaveText('Sin conexión.', SLOW)
    await expect(row(page, DAVEFX_ID).getByRole('button', { name: /Reintentar la descarga de Davefx/ })).toBeVisible()
    await shot(page, 'offline-error')
    await page.getByRole('button', { name: 'Detener', exact: true }).click()
    await context.unroute(`${mirror.origin}/**`)
    numbers.offline = { requestsToVoiceHost: mirror.hits.length - hitsBefore, abortedFetches: failed.length }
  })

  test('removing the voice in use goes back to Automática and reading carries on with the system voice', async () => {
    await open(page, EPUB)
    await openAudio(page)
    await row(page, CLAUDE_ID).getByRole('button', { name: /Quitar la voz Claude/ }).click()
    await expect(row(page, CLAUDE_ID).getByRole('button', { name: /Descargar la voz Claude/ })).toBeVisible(SLOW)
    await expect(selectedOption(page)).toHaveAttribute('data-value', '')
    await play(page)
    await expect.poll(() => systemSpoken(page), SLOW).toBeGreaterThan(0)
    await page.getByRole('button', { name: 'Detener', exact: true }).click()
  })
})

// The default Hugging Face URLs (no INHOUSE_NEURAL_VOICE_BASE): the layout the app really requests, answered by route interception.
// This is also the owner's first-use journey: the audiobook starts with the system voice, the offer card appears, one tap
// downloads the recommended voice and the natural voice takes over at the next fragment without stopping the reading.
test('default Hugging Face URLs and the first-use offer: one tap downloads the voice and it takes over mid-reading; a second voice speaks too', async ({ browser }) => {
  test.skip(!haveVoice(DAVEFX), `fixture ${DAVEFX} not found in ${FIXTURES}`)
  test.setTimeout(280_000)
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' })
  await context.addInitScript(instrument, { base: null })
  const page = await context.newPage()
  const errors = []; page.on('pageerror', error => errors.push(error.message))
  const requested = []
  const ROOT = 'https://huggingface.co/rhasspy/piper-voices/resolve/main/'
  await context.route('https://huggingface.co/**', async route => {
    const url = route.request().url()
    requested.push(url)
    const rel = url.slice(ROOT.length), name = rel.split('/').pop(), stem = name.replace(/\.onnx(\.json)?$/, '')
    const headers = { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'content-length, etag', etag: '"fixture"' }
    if (haveVoice(stem) && rel === `${hfPath(stem)}${name.slice(stem.length)}`) return route.fulfill({ status: 200, headers, body: readFileSync(join(FIXTURES, name)) })
    return route.fulfill({ status: 404, headers, body: 'not found' })
  })
  await open(page, EPUB)
  await page.evaluate(() => { window.__tts.state.ms = 2500 }) // the system voice reads slowly: the download finishes while it is speaking
  await openAudio(page)
  await page.getByRole('slider', { name: 'Velocidad de voz' }).fill('1.2')
  await play(page)
  await expect.poll(() => systemSpoken(page), SLOW).toBeGreaterThan(0) // the system voice carries the first fragments
  const offer = page.locator('[data-neural-offer]')
  await expect(offer).toBeVisible(SLOW)
  await expect(offer).toContainText('Voz natural · 63 MB')
  await shot(page, 'first-use-offer', offer)
  await offer.getByRole('button', { name: /Descargar la voz natural Claude/ }).click()
  await expect(offer).toBeHidden(SLOW) // installed: no more offer
  await expect(selectedOption(page)).toHaveAttribute('data-value', CLAUDE_ID)
  expect(requested.filter(url => !url.endsWith('voices.json')).sort()).toEqual([`${ROOT}${hfPath(CLAUDE)}.onnx`, `${ROOT}${hfPath(CLAUDE)}.onnx.json`].sort())
  await spyOnEngine(page)
  // The natural voice takes over at the next fragment, while the audiobook keeps playing.
  await expect.poll(async () => (await starts(page)).length, SLOW).toBeGreaterThan(1)
  expect((await neu(page, n => n.speak))[0]).toMatchObject({ voiceId: CLAUDE_ID, rate: 1.2 })
  const spokenBySystem = await systemSpoken(page)
  await page.waitForTimeout(3000)
  expect(await systemSpoken(page)).toBe(spokenBySystem) // the system voice is not used again
  await expect(page.getByRole('button', { name: 'Pausar', exact: true })).toBeVisible()
  expect((await starts(page)).every(entry => entry.highlight)).toBe(true)
  await expectCleanAudio(page, 'first use')
  await page.getByRole('button', { name: 'Detener', exact: true }).click()

  // A second voice (another model) from the catalogue downloads from its own URL and speaks.
  await row(page, DAVEFX_ID).getByRole('button', { name: /Descargar la voz Davefx/ }).click()
  await expect(row(page, DAVEFX_ID).getByRole('button', { name: /Voz en uso Davefx/ })).toBeVisible(SLOW)
  expect(requested).toContain(`${ROOT}${hfPath(DAVEFX)}.onnx`)
  await page.evaluate(() => { window.__neu.audio.length = 0; window.__neu.speak.length = 0; window.__neu.events.length = 0 })
  await play(page)
  await expect.poll(async () => (await starts(page)).length, SLOW).toBeGreaterThan(1)
  expect((await neu(page, n => n.speak))[0]).toMatchObject({ voiceId: DAVEFX_ID })
  const audio = await expectCleanAudio(page, DAVEFX)
  numbers.davefx = { chunks: audio.length, peak: +Math.max(...audio.map(c => c.peak)).toFixed(2), sampleRate: audio[0].sampleRate }
  expect(errors).toEqual([])
  await context.close()
})
