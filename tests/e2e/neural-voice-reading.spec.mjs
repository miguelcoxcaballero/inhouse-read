// The natural voices END TO END, nothing faked on the app side: the production build, the real picker, the real download
// into Cache Storage, the real engine (Web Worker, onnxruntime-web + espeak-ng WebAssembly, Piper weights) and Web Audio,
// reading real EPUB and PDF books aloud. Only Hugging Face is replaced (tests/e2e/helpers/hf-mirror.mjs serves the voices
// from a fixture folder under the same layout and the page's INHOUSE_NEURAL_VOICE_BASE points at it); a second test uses
// the default huggingface.co URLs through route interception. The speaker is not audible in CI: what is checked is what the
// page does (audio scheduled with sane samples, 'start' events, highlight, page turns, controls).
//
//   NEURAL_VOICE_FIXTURES  folder with <piperId>.onnx and <piperId>.onnx.json (default: the sandbox spike folder). Local
//                          runs skip missing voices; CI prepares and validates the required fixtures before this suite.
//   NEURAL_VOICE_EVIDENCE  folder for the screenshots and numbers.json (default: test-results/neural-voice-reading).
//
// Heavy (a real neural voice thinks hard on one core): about six minutes. Run it alone.
import { test, expect } from '@playwright/test'
import { openAudioMenu, pickVoice, selectedOption } from './helpers/audio-menus.mjs'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { loadavg } from 'node:os'
import { execFileSync } from 'node:child_process'
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
// ---- sentence highlight, progress bars and frame cadence; available device APIs are observed to ensure reading never invokes them.
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

  // Both legacy APIs are present. They record forbidden handovers and never simulate speech events.
  window.__tts={ log:[] }
  window.SpeechSynthesisUtterance=class { constructor(text) { this.text=text } }
  Object.defineProperty(window,'speechSynthesis',{ configurable:true,value:{
    getVoices:()=>[{ name:'Sistema',lang:'es-ES',voiceURI:'sistema-es',localService:true }],
    addEventListener() {},removeEventListener() {},cancel() {},speak:utterance=>window.__tts.log.push({ text:utterance.text })
  } })
  window.InhouseSpeech={ getVoices:()=>JSON.stringify([{ name:'Sistema',lang:'es-ES',voiceURI:'sistema-es',quality:500,installed:true }]),
    stop() {},speak:(...args)=>window.__tts.log.push({ native:args }) }

}

// ---- Page helpers -------------------------------------------------------------------------------------------------------
async function open(page, file) {
  await page.goto('./')
  await page.locator('#file-picker').setInputFiles(file)
  await expect(page.locator(file.endsWith('pdf') ? '.pdf-text-layer span' : 'foliate-view').first()).toBeVisible(SLOW)
  if (!file.endsWith('pdf')) await expect.poll(() => page.evaluate(() => Boolean(document.querySelector('foliate-view')?.renderer?.getContents?.()[0]?.doc?.body)), SLOW).toBe(true)
  // Cache Storage intentionally survives between cases, but the previous case's reading position must not. Rewind through
  // the reader's own controls instead of deleting app data or depending on how far the previous audiobook got.
  await page.locator('#reader-location').click()
  await page.getByRole('slider', { name: 'Progreso del libro', exact: true }).fill('0')
  if (file.endsWith('pdf')) await expect(page.locator('#reader-location')).toHaveAttribute('aria-label', /Página 1 de 3/, SLOW)
  else await expect.poll(() => chapter(page), SLOW).toBe('La llegada')
  await expect(page.locator('.reading-panel')).not.toBeVisible(SLOW) // a successful jump closes its own panel
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
async function activePCM(page, voiceId) {
  await expect.poll(() => page.evaluate(id => {
    const core=window.__neuEngine.core, player=core.player, unit=player.playing()
    const entry=core.run?.entries.find(entry=>entry.n===unit), audio=player.units.get(unit)
    return core.run?.voice.id===id && entry?.id===core.currentId &&
      audio?.sources.some(source=>source.start<=player.now && source.end>player.now) && audio.end-player.now>3
  },voiceId),{ ...SLOW,intervals:[25,50,100,250] }).toBe(true)
  return page.evaluate(() => {
    const core=window.__neuEngine.core, player=core.player, unit=player.playing(), audio=player.units.get(unit)
    return { id:core.currentId,unit,remainingSeconds:audio.end-player.now,stops:window.__neu.stops }
  })
}

/** Chromium resident memory (MB), including the worker's ONNX Runtime heap. */
function residentMB() {
  if (process.platform === 'win32') {
    const bytes = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      '(Get-Process -Name headless_shell,chrome-headless-shell -ErrorAction SilentlyContinue | Measure-Object -Property WorkingSet64 -Sum).Sum'],
    { encoding:'utf8', windowsHide:true }).trim()
    return Number(bytes || 0) / 1048576
  }
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
  const timer = setInterval(() => { peak = Math.max(peak, residentMB()) }, process.platform === 'win32' ? 1000 : 400)
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

test('Argentina: Daniela starts cold and continues with real natural audio at rates 1 and 1.25', async ({ browser }) => {
  const model='es_AR-daniela-high', id=`piper:${model}`
  if (!haveVoice(model)) throw new Error(`Required Argentina fixture missing: ${model} in ${FIXTURES}`)
  test.setTimeout(300_000)
  const mirror=await startHuggingFaceMirror({ voices:[model], sliceMs:0 })
  const context=await browser.newContext({ viewport:{ width:390,height:844 }, reducedMotion:'reduce' })
  context.setDefaultTimeout(30_000)
  await context.addInitScript(instrument,{ base:mirror.base })
  await context.addInitScript(() => {
    window.__nativeSpoken=[]
    window.InhouseSpeech={
      getVoices:()=>JSON.stringify([{ voiceURI:'device-ar',name:'Dispositivo',lang:'es-AR',quality:500,installed:true }]),
      speak:(...args)=>window.__nativeSpoken.push(args), stop() {}
    }
    if (window.top===window) localStorage.setItem('inhouse-read-neural-slow',JSON.stringify({ rate:1,at:Date.now() }))
  })
  const page=await context.newPage(), errors=[]
  page.on('pageerror',error=>errors.push(error.message))
  try {
    await open(page,EPUB); await openAudio(page)
    await row(page,id).getByRole('button',{ name:/Descargar la voz Daniela/ }).click()
    await expect(row(page,id).getByRole('button',{ name:/Voz en uso Daniela/ })).toBeVisible(SLOW)
    for (const [rate,label] of [[1,'1×'],[1.25,'1,25×']]) {
      await open(page,EPUB); await openAudio(page); await pickVoice(page,id)
      await page.getByRole('radio',{ name:label,exact:true }).check()
      await spyOnEngine(page)
      await expect.poll(()=>page.evaluate(()=>window.__neuEngine.core.client?.loaded || ''),SLOW).toBe(model)
      await page.evaluate(()=>{
        const core=window.__neuEngine.core
        core.client.dispose(); core.client=null
        window.__neu.audio.length=0; window.__neu.events.length=0; window.__neu.speak.length=0
      })
      await play(page)
      await expect.poll(async()=>(await starts(page)).length,{ timeout:180_000 }).toBeGreaterThanOrEqual(3)
      const requests=await neu(page,n=>n.speak), events=await neu(page,n=>n.events)
      expect(requests.length).toBeGreaterThanOrEqual(3)
      expect(requests.every(request=>request.voiceId===id && request.rate===rate)).toBe(true)
      expect(events.filter(event=>event.type==='error')).toEqual([])
      expect(await systemSpoken(page)).toBe(0)
      expect(await page.evaluate(()=>window.__nativeSpoken)).toEqual([])
      expect(await page.evaluate(()=>localStorage.getItem('inhouse-read-neural-slow'))).toBeNull()
      const audio=await expectCleanAudio(page,`Daniela ${rate}`)
      expect((await starts(page)).every(event=>event.highlight)).toBe(true)
      const timing=await neu(page,n=>({ tapToAudioScheduledMs:Math.round(n.audio[0].at-n.tap),tapToStartEventMs:Math.round(n.events.find(event=>event.type==='start').at-n.tap) }))
      numbers[`argentina${rate}`]={ ...timing,chunks:audio.length,starts:(await starts(page)).length,engine:await engineStats(page),deviceCalls:0 }
      await shot(page,`argentina-${rate}-speaking`)
      await page.getByRole('button',{ name:'Detener',exact:true }).click()
    }
    expect(errors).toEqual([])
  } finally { await context.close(); await mirror.close() }
})

test.describe('natural voices, end to end (real picker, download, engine and audio)', () => {
  test.describe.configure({ mode: 'serial' })
  test.skip(!haveVoice(CLAUDE), `fixtures not found in ${FIXTURES} (set NEURAL_VOICE_FIXTURES)`)
  test.setTimeout(280_000)

  let context, page, mirror
  const errors = []
  test.beforeAll(async ({ browser }) => {
    mirror = await startHuggingFaceMirror({ voices: [CLAUDE,DAVEFX], sliceMs: 60 })
    // One browser context for the whole story: Cache Storage (the downloaded voice), the saved voice and the speed survive its reloads.
    context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' })
    context.setDefaultTimeout(30_000)
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
      await page.getByRole('radio', { name:'1,25×', exact:true }).check()

      // --- Play: the engine speaks (audio scheduled), the system voice stays silent.
      await play(page)
      await expect.poll(() => neu(page, n => n.audio.length), SLOW).toBeGreaterThan(0)
      await expect.poll(async () => (await starts(page)).length, SLOW).toBeGreaterThan(0)
      const first = await neu(page, n => ({ tap: n.tap, audio: n.audio[0].at, start: n.events.find(event => event.type === 'start').at, state: n.audio[0].state }))
      expect(first.state).toBe('running')
      expect(await systemSpoken(page)).toBe(0)
      expect((await neu(page, n => n.speak))[0]).toMatchObject({ voiceId: CLAUDE_ID, rate: 1.25 })
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
      const startsBeforeResume = (await starts(page)).length
      await page.getByRole('button', { name: 'Continuar lectura' }).click()
      await expect.poll(async () => (await neu(page, n => n.speak)).length, SLOW).toBeGreaterThan(speaksBefore)
      expect((await neu(page, n => n.speak)).at(-1).text).toBe(lastSpoken)
      await expect.poll(async () => (await starts(page)).length, SLOW).toBeGreaterThan(startsBeforeResume)
      await expect.poll(() => page.evaluate(() => window.__speechHighlight()), SLOW).not.toBe('')

      // --- Speed: a new speed is heard now (the fragment is spoken again at that speed) and the look-ahead is rebuilt for it.
      await page.getByRole('button', { name: 'Escuchar el libro' }).click()
      await page.getByRole('radio', { name:'1,5×', exact:true }).check()
      await expect.poll(async () => (await neu(page, n => n.speak)).at(-1).rate, SLOW).toBe(1.5)
      const afterSpeed = await eventCount(page)
      await expect.poll(async () => (await types(page, afterSpeed)).includes('start'), SLOW).toBe(true)
      expect((await neu(page, n => n.speak)).at(-1)).toMatchObject({ voiceId: CLAUDE_ID, rate: 1.5 })
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
    await page.getByRole('radio', { name:'1,25×', exact:true }).check()
    await play(page)
    numbers.firstAudio.tapWithWorkerAlive = await heard()
    expect(numbers.firstAudio.tapWithWorkerAlive.tapToStartEventMs).toBeLessThan(5000)
    await stopAndForget()
    expect(errors).toEqual([])
  })

  test('switching between two natural voices preserves the current fragment and cancels old audio', async () => {
    if (!haveVoice(DAVEFX)) throw new Error('Required Davefx fixture is missing')
    await open(page,EPUB); await openAudio(page)
    for (const [id,name] of [[CLAUDE_ID,'Claude'],[DAVEFX_ID,'Davefx']]) {
      const download=row(page,id).getByRole('button',{ name:new RegExp('Descargar la voz '+name) })
      if(await download.isVisible()) await download.click()
      await expect(row(page,id).getByRole('button',{ name:new RegExp('(Voz en uso|Usar la voz) '+name) })).toBeVisible(SLOW)
    }
    await pickVoice(page,CLAUDE_ID); await spyOnEngine(page)
    await page.getByRole('radio',{ name:'1,25×',exact:true }).check()
    await play(page)
    await expect.poll(async()=>(await starts(page)).length,SLOW).toBeGreaterThan(0)
    // The opening heading can finish before the picker click. Observe a real, longer active PCM unit so stop() is meaningful.
    await openAudioMenu(page,'Voz')
    const beforeSwitch=await activePCM(page,CLAUDE_ID)
    await pickVoice(page,DAVEFX_ID)
    const switching=await neu(page,n=>{
      const index=n.speak.findIndex(request=>request.voiceId==='piper:es_ES-davefx-medium')
      return { request:n.speak[index],previous:n.speak[index-1],oldIds:n.speak.slice(0,index).map(request=>request.id) }
    })
    expect(switching.previous.id).toBe(beforeSwitch.id)
    expect(switching.request).toMatchObject({ voiceId:DAVEFX_ID,rate:1.25,text:switching.previous.text })
    await expect.poll(()=>neu(page,(n,id)=>n.events.some(event=>event.type==='start'&&event.id===id),switching.request.id),SLOW).toBe(true)
    expect(await neu(page,(n,data)=>n.events.filter(event=>event.type==='start'&&data.oldIds.includes(event.id)&&event.at>data.request.at),switching)).toEqual([])
    expect(await neu(page,n=>n.stops)).toBeGreaterThan(beforeSwitch.stops)
    await expect.poll(()=>page.evaluate(()=>window.__speechHighlight()),SLOW).not.toBe('')
    await openAudioMenu(page,'Voz')
    const beforeBack=await activePCM(page,DAVEFX_ID)
    await pickVoice(page,CLAUDE_ID)
    const resumed=await neu(page,(n,after)=>{
      const index=n.speak.findIndex(request=>request.voiceId==='piper:es_MX-claude-high'&&request.at>after)
      return { request:n.speak[index],previous:n.speak[index-1] }
    },switching.request.at)
    expect(resumed.previous.id).toBe(beforeBack.id)
    expect(resumed.request).toMatchObject({ voiceId:CLAUDE_ID,rate:1.25,text:resumed.previous.text })
    await expect.poll(()=>neu(page,(n,id)=>n.events.some(event=>event.type==='start'&&event.id===id),resumed.request.id),SLOW).toBe(true)
    expect(await neu(page,n=>n.stops)).toBeGreaterThan(beforeBack.stops)
    await expectCleanAudio(page,'resumed natural voice')
    expect(await systemSpoken(page)).toBe(0)
    numbers.voiceSwitch={ first:switching.request,back:resumed.request,beforeSwitch,beforeBack,deviceCalls:0 }
    await shot(page,'voice-switch-resumed')
    await closePanel(page); await page.locator('#reader-back').click()
    await expect(page.getByRole('heading',{ name:'Biblioteca' })).toBeVisible(SLOW)
    await expect.poll(async()=>(await engineStats(page)).status,SLOW).toBe('idle')
    const left=await eventCount(page),scheduled=await neu(page,n=>n.audio.length)
    await page.waitForTimeout(2000)
    expect((await types(page,left)).filter(type=>type!=='done')).toEqual([])
    expect(await neu(page,n=>n.audio.length)).toBe(scheduled)

    // Also cancel real in-flight synthesis before any PCM exists. A fresh page clears the fragment replay cache; the
    // paragraph-only EPUB avoids relying on a short heading remaining in synthesis until a click reaches the picker.
    await page.goto('./')
    await page.locator('#file-picker').setInputFiles('tests/e2e/fixtures/speech-page-boundary.epub')
    await expect.poll(()=>page.evaluate(()=>Boolean(document.querySelector('foliate-view')?.renderer?.getContents?.()[0]?.doc?.body)),SLOW).toBe(true)
    await openAudio(page); await pickVoice(page,CLAUDE_ID); await spyOnEngine(page)
    await expect.poll(()=>page.evaluate(()=>window.__neuEngine.core.client?.loaded || ''),SLOW).toBe(CLAUDE)
    await page.evaluate(()=>{ const core=window.__neuEngine.core; core.client.dispose(); core.client=null })
    await openAudioMenu(page,'Voz')
    await play(page)
    await expect.poll(()=>page.evaluate(()=>{
      const core=window.__neuEngine.core
      return Boolean(core.run?.job && core.run.entries.find(entry=>entry.id===core.currentId)?.state==='synth' && !core.player.units.size)
    }),{ ...SLOW,intervals:[25,50,100] }).toBe(true)
    const pending=await page.evaluate(()=>{
      const n=window.__neu,core=window.__neuEngine.core
      return { request:n.speak.at(-1),oldIds:n.speak.map(request=>request.id),starts:n.events.filter(event=>event.type==='start'),stops:n.stops,
        nodes:core.player.units.size,state:core.run.entries.find(entry=>entry.id===core.currentId).state,loaded:core.client.loaded }
    })
    expect(pending.request.voiceId).toBe(CLAUDE_ID)
    expect(pending.loaded).toBe(CLAUDE)
    expect(pending.state).toBe('synth')
    expect(pending.nodes).toBe(0)
    expect(pending.starts).toEqual([])
    expect(pending.stops).toBe(0)
    await pickVoice(page,DAVEFX_ID)
    const afterPending=await neu(page,n=>n.speak.find(request=>request.voiceId==='piper:es_ES-davefx-medium'))
    expect(afterPending).toMatchObject({ voiceId:DAVEFX_ID,rate:1.25,text:pending.request.text })
    await expect.poll(()=>neu(page,(n,id)=>n.events.some(event=>event.type==='start'&&event.id===id),afterPending.id),SLOW).toBe(true)
    expect(await neu(page,(n,ids)=>n.events.filter(event=>event.type==='start'&&ids.includes(event.id)),pending.oldIds)).toEqual([])
    expect(await neu(page,n=>n.stops)).toBe(0) // no AudioBuffer existed in the cancelled run
    expect(await neu(page,n=>n.events.filter(event=>event.type==='error'))).toEqual([])
    await expectCleanAudio(page,'switch during synthesis')
    expect(await systemSpoken(page)).toBe(0)
    numbers.voiceSwitch.duringSynthesis={ before:pending,after:afterPending,oldStarts:0,stops:0,deviceCalls:0 }
    await page.getByRole('button',{name:'Detener',exact:true}).click()
    expect(errors).toEqual([])
  })

  test('idle: the real worker closes after ~90 s and the next Play creates a new worker from the cache', async () => {
    test.skip(!process.env.NEURAL_VOICE_IDLE, 'takes ~2 minutes: set NEURAL_VOICE_IDLE=1')
    const voiceWorkers = () => page.workers().filter(worker => /\/assets\/worker-[\w-]+\.js(?:[?#]|$)/.test(worker.url()))
    await page.goto('./')
    await expect.poll(() => voiceWorkers().length).toBe(0)
    const beforeLoad = residentMB()
    await open(page, EPUB)
    await openAudio(page)
    await spyOnEngine(page)
    await expect.poll(() => page.evaluate(() => window.__neuEngine.core?.client?.loaded || ''), SLOW).toBe(CLAUDE) // warmed up, nothing spoken
    await expect.poll(() => voiceWorkers().length).toBe(1)
    const warmWorker = voiceWorkers()[0]
    let workerClosed = false
    warmWorker.once('close', () => { workerClosed = true })
    await page.evaluate(() => { window.__idleObservedClient = window.__neuEngine.core.client })
    await page.waitForTimeout(2000)
    const warm = residentMB()
    await page.waitForTimeout(95_000)
    expect(await page.evaluate(() => window.__neuEngine.core.client)).toBeNull() // terminated by the engine's own idle timer
    await expect.poll(() => workerClosed).toBe(true) // browser-observed termination, not just a cleared facade reference
    expect(voiceWorkers()).toHaveLength(0)
    const released = await page.evaluate(() => {
      const client = window.__idleObservedClient
      return { worker:client.worker, loaded:client.loaded, ready:client.ready, config:client.config, alive:client.alive,
        pendingCalls:client.calls.size, pendingJobs:client.jobs.size, pendingPreparations:client.preparations.size }
    })
    expect(released).toEqual({ worker:null, loaded:null, ready:null, config:null, alive:false,
      pendingCalls:0, pendingJobs:0, pendingPreparations:0 })
    const torn = residentMB()
    // Aggregate browser/GPU/renderer RSS is diagnostic: CI released 233.52 MB
    // on the first attempt and ~250 MB on retry. It cannot isolate a worker's
    // allocator or establish a portable 250 MB threshold. Its actual close,
    // cleared resources and distinct cached replacement are the pass criteria.
    numbers.idleTeardown = { residentBeforeLoadMB: Math.round(beforeLoad), residentWarmMB: Math.round(warm),
      residentAfterMB: Math.round(torn), freedMB: +(warm - torn).toFixed(2), workerClosed, released }
    const uncachedRequests = []
    const blockUncached = route => { uncachedRequests.push(route.request().url()); return route.abort('internetdisconnected') }
    await page.route(`${mirror.base}**`, blockUncached)
    try {
      await play(page) // rebuilt lazily from Cache Storage, with model/config network access blocked
      await expect.poll(async () => (await starts(page)).length, SLOW).toBeGreaterThan(0)
      await expect.poll(() => page.evaluate(() => window.__neuEngine.core.client?.loaded || ''), SLOW).toBe(CLAUDE)
      expect(await page.evaluate(() => window.__neuEngine.core.client !== window.__idleObservedClient)).toBe(true)
      await expect.poll(() => voiceWorkers().length).toBe(1)
      expect(voiceWorkers()[0]).not.toBe(warmWorker)
      expect(uncachedRequests).toEqual([])
      numbers.idleTeardown.newWorkerCreated = true
      numbers.idleTeardown.uncachedModelRequests = uncachedRequests.length
      await expectCleanAudio(page, 'after teardown')
      await page.getByRole('button', { name: 'Detener', exact: true }).click()
    } finally {
      await page.unroute(`${mirror.base}**`, blockUncached)
      await page.evaluate(() => { delete window.__idleObservedClient })
    }
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
    await openAudioMenu(page, 'Voz')
    const missing='piper:es_AR-daniela-high'
    await row(page, missing).getByRole('button', { name: /Descargar la voz Daniela/ }).click()
    await expect(row(page, missing).getByRole('alert')).toHaveText('Sin conexión.', SLOW)
    await expect(row(page, missing).getByRole('button', { name: /Reintentar la descarga de Daniela/ })).toBeVisible()
    await shot(page, 'offline-error')
    await page.getByRole('button', { name: 'Detener', exact: true }).click()
    await context.unroute(`${mirror.origin}/**`)
    numbers.offline = { requestsToVoiceHost: mirror.hits.length - hitsBefore, abortedFetches: failed.length }
  })

  test('removing the natural voice in use pauses and the next Play chooses another installed natural voice', async () => {
    await open(page,EPUB); await openAudio(page)
    // The regression is also runnable on its own; it must not rely on an earlier test's downloads.
    for (const [id,name] of [[CLAUDE_ID,'Claude'],[DAVEFX_ID,'Davefx']]) {
      const download=row(page,id).getByRole('button',{ name:new RegExp('Descargar la voz '+name) })
      if(await download.isVisible()) await download.click()
      await expect(row(page,id).getByRole('button',{ name:new RegExp('(Voz en uso|Usar la voz) '+name) })).toBeVisible(SLOW)
    }
    await spyOnEngine(page)
    await pickVoice(page,CLAUDE_ID); await play(page)
    await expect.poll(async()=>(await starts(page)).length,SLOW).toBeGreaterThan(0)
    await openAudioMenu(page,'Voz')
    await row(page,CLAUDE_ID).getByRole('button',{ name:/Quitar la voz Claude/ }).click()
    await expect(row(page,CLAUDE_ID).getByRole('button',{ name:/Descargar la voz Claude/ })).toBeVisible(SLOW)
    await expect(selectedOption(page)).toHaveAttribute('data-value','')
    await expect(page.locator('.reading-audio-status')).toContainText('Voz natural quitada')
    await expect(page.getByRole('button',{ name:'Continuar',exact:true })).toBeVisible()
    const cancelled=await neu(page,n=>n.speak.at(-1))
    expect(cancelled.voiceId).toBe(CLAUDE_ID)
    const stoppedAudio=await neu(page,n=>n.audio.length)
    await page.waitForTimeout(1200)
    expect(await neu(page,n=>n.audio.length)).toBe(stoppedAudio)
    await page.getByRole('button',{ name:'Continuar',exact:true }).click()
    await expect.poll(async()=>(await neu(page,n=>n.speak)).at(-1)?.voiceId,SLOW).toBe(DAVEFX_ID)
    const resumed=await neu(page,(n,old)=>n.speak.find(request=>request.voiceId==='piper:es_ES-davefx-medium'&&request.at>old.at),cancelled)
    expect(resumed.text).toBe(cancelled.text)
    await expect.poll(()=>neu(page,n=>n.audio.length),SLOW).toBeGreaterThan(stoppedAudio)
    expect(await systemSpoken(page)).toBe(0)
    await page.getByRole('button',{ name:'Detener',exact:true }).click()
  })
})

// The default Hugging Face URLs (no INHOUSE_NEURAL_VOICE_BASE): the layout the app really requests, answered by route interception.
// First-use journey: download the recommended natural voice, then explicitly start its audio.
test('default Hugging Face URLs and first use: download then Play uses natural audio; a second natural voice speaks too', async ({ browser }) => {
  test.skip(!haveVoice(DAVEFX), `fixture ${DAVEFX} not found in ${FIXTURES}`)
  test.setTimeout(280_000)
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' })
  context.setDefaultTimeout(30_000)
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
  await openAudio(page)
  await page.getByRole('radio', { name:'1,25×', exact:true }).check()
  await play(page)
  await expect(page.locator('.reading-audio-status')).toContainText('Descarga una voz natural')
  expect(await systemSpoken(page)).toBe(0)
  expect(await starts(page)).toEqual([])
  const offer = page.locator('[data-neural-offer]')
  await expect(offer).toBeVisible(SLOW)
  await expect(offer).toContainText('Voz natural · 63 MB')
  await shot(page, 'first-use-offer', offer)
  await offer.getByRole('button', { name: /Descargar la voz natural Claude/ }).click()
  await expect(offer).toBeHidden(SLOW) // installed: no more offer
  await expect(selectedOption(page)).toHaveAttribute('data-value', CLAUDE_ID)
  expect(requested.filter(url => !url.endsWith('voices.json')).sort()).toEqual([`${ROOT}${hfPath(CLAUDE)}.onnx`, `${ROOT}${hfPath(CLAUDE)}.onnx.json`].sort())
  await spyOnEngine(page)
  await play(page) // installation is explicit; so is the first playback
  await expect.poll(async () => (await starts(page)).length, SLOW).toBeGreaterThan(1)
  expect((await neu(page, n => n.speak))[0]).toMatchObject({ voiceId: CLAUDE_ID, rate: 1.25 })
  expect(await systemSpoken(page)).toBe(0)
  await expect(page.getByRole('button', { name: 'Pausar', exact: true })).toBeVisible()
  expect((await starts(page)).every(entry => entry.highlight)).toBe(true)
  await expectCleanAudio(page, 'first use')
  await page.getByRole('button', { name: 'Detener', exact: true }).click()

  // A second voice (another model) from the catalogue downloads from its own URL and speaks.
  await openAudioMenu(page, 'Voz')
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
