// REAL-engine check of every selectable catalogue voice: each one is installed through the engine from a local model mirror,
// including its required dictionary or Hebrew pointing model, then reads with real onnxruntime-web and its phonemizer.
// Audio sanity (finite, audible, not clipped, a
// plausible length) and the speed (RTF) are recorded in numbers-languages.json.
//
//   NEURAL_VOICE_FIXTURES  folder with <piperId>.onnx and <piperId>.onnx.json (default: the sandbox folder models-extra);
//                          PLAYWRIGHT_SUITE=languages fails when any required fixture is missing.
//   NEURAL_VOICE_LANGS     comma separated case keys to run (default: the complete catalogue).
//   NEURAL_VOICE_EVIDENCE  where the numbers and the WAV files go (default: a temp folder).
import { test, expect } from '@playwright/test'
import { createServer } from 'node:http'
import { existsSync, statSync, mkdirSync, writeFileSync, readFileSync, createReadStream, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, extname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'vite'

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const FIXTURES = process.env.NEURAL_VOICE_FIXTURES || '/tmp/claude-0/-home-user-inhouse-read/6c70f5ca-de80-5128-bee1-f59b39f4610d/scratchpad/piper/web/models-extra'
const EVIDENCE = process.env.NEURAL_VOICE_EVIDENCE || join(tmpdir(), 'neural-voice-evidence')
const ONLY = (process.env.NEURAL_VOICE_LANGS || '').split(',').filter(Boolean)
const haveVoice = piperId => existsSync(join(FIXTURES, `${piperId}.onnx`)) && existsSync(join(FIXTURES, `${piperId}.onnx.json`))

// language -> the voice of the catalogue and two sentences of a novel
const CASES = {
  'es-MX': ['es_MX-claude-high', ['La lluvia caía sobre las ventanas de la biblioteca.', 'Nadie recordaba cuándo había llegado el visitante.']],
  'es-ES': ['es_ES-davefx-medium', ['La lluvia caía sobre las ventanas de la biblioteca.', 'Nadie recordaba cuándo había llegado el visitante.']],
  'es-ES-sharvard': ['es_ES-sharvard-medium', ['La lluvia caía sobre las ventanas de la biblioteca.', 'Nadie recordaba cuándo había llegado el visitante.']],
  'es-ES-sharvard-female': ['es_ES-sharvard-medium', ['La lluvia caía sobre las ventanas de la biblioteca.', 'Nadie recordaba cuándo había llegado el visitante.'], 1],
  'en-US': ['en_US-lessac-medium', ['The rain tapped softly against the library windows.', 'Nobody remembered when the visitor had arrived.']],
  'en-GB-alba': ['en_GB-alba-medium', ['The rain tapped softly against the library windows.', 'Nobody remembered when the visitor had arrived.']],
  fr: ['fr_FR-siwis-medium', ['La pluie tombait doucement sur les fenêtres de la bibliothèque.', 'Personne ne se souvenait de la visite du voyageur.']],
  de: ['de_DE-thorsten-medium', ['Der Regen klopfte leise an die Fenster der Bibliothek.', 'Niemand erinnerte sich an den fremden Besucher.']],
  it: ['it_IT-paola-medium', ['La pioggia cadeva sulle finestre della biblioteca.', 'Nessuno ricordava quando fosse arrivato il visitatore.']],
  'pt-BR': ['pt_BR-faber-medium', ['A chuva caía nas janelas da biblioteca.', 'Ninguém lembrava quando o visitante tinha chegado.']],
  ca: ['ca_ES-upc_ona-medium', ['La pluja queia a les finestres de la biblioteca.', 'Ningú recordava quan havia arribat el visitant.']],
  nl: ['nl_NL-pim-medium', ['De regen tikte zachtjes tegen de ramen van de oude bibliotheek.', 'Niemand in het dorp wist wanneer de vreemdeling was aangekomen.']],
  pl: ['pl_PL-gosia-medium', ['Deszcz cicho stukał w okna starej biblioteki.', 'Nikt we wsi nie pamiętał, kiedy przybył nieznajomy.']],
  ru: ['ru_RU-irina-medium', ['Дождь тихо стучал в окна старой библиотеки.', 'Никто в деревне не помнил, когда приехал незнакомец.']],
  uk: ['uk_UA-ukrainian_tts-medium', ['Дощ тихо стукав у вікна старої бібліотеки.', 'Ніхто в селі не пам’ятав, коли приїхав незнайомець.']],
  'uk-mykyta': ['uk_UA-ukrainian_tts-medium', ['Дощ тихо стукав у вікна старої бібліотеки.', 'Ніхто в селі не пам’ятав, коли приїхав незнайомець.'], 1],
  'uk-tetiana': ['uk_UA-ukrainian_tts-medium', ['Дощ тихо стукав у вікна старої бібліотеки.', 'Ніхто в селі не пам’ятав, коли приїхав незнайомець.'], 2],
  tr: ['tr_TR-dfki-medium', ['Yağmur eski kütüphanenin pencerelerine usulca vuruyordu.', 'Köyde kimse yabancının ne zaman geldiğini hatırlamıyordu.']],
  sv: ['sv_SE-nst-medium', ['Regnet knackade försiktigt på fönstren i det gamla biblioteket.', 'Ingen i byn mindes när främlingen hade kommit.']],
  da: ['da_DK-talesyntese-medium', ['Regnen bankede sagte på vinduerne i det gamle bibliotek.', 'Ingen i landsbyen kunne huske, hvornår den fremmede var kommet.']],
  nb: ['no_NO-talesyntese-medium', ['Regnet banket forsiktig på vinduene i det gamle biblioteket.', 'Ingen i landsbyen husket når den fremmede var kommet.']],
  fi: ['fi_FI-harri-medium', ['Sade ropisi hiljaa vanhan kirjaston ikkunoihin.', 'Kukaan kylässä ei muistanut, milloin muukalainen oli saapunut.']],
  cs: ['cs_CZ-jirka-medium', ['Déšť tiše klepal na okna staré knihovny.', 'Nikdo ve vsi si nepamatoval, kdy cizinec přijel.']],
  el: ['el_GR-rapunzelina-low', ['Η βροχή χτυπούσε απαλά τα παράθυρα της παλιάς βιβλιοθήκης.', 'Κανείς στο χωριό δεν θυμόταν πότε είχε έρθει ο ξένος.']],
  hu: ['hu_HU-anna-medium', ['Az eső halkan kopogott a régi könyvtár ablakán.', 'A faluban senki sem emlékezett rá, mikor érkezett az idegen.']],
  ro: ['ro_RO-mihai-medium', ['Ploaia bătea încet în ferestrele vechii biblioteci.', 'Nimeni din sat nu-și amintea când sosise străinul.']],
  ar: ['ar_JO-kareem-medium', ['كانت الأمطار تطرق نوافذ المكتبة القديمة بهدوء.', 'لم يتذكر أحد في القرية متى وصل الغريب.']],
  zh: ['zh_CN-huayan-medium', ['雨轻轻地敲打着旧图书馆的窗户。', '村里没有人记得陌生人是什么时候来的。']],
  vi: ['vi_VN-vais1000-medium', ['Mưa nhẹ nhàng gõ vào cửa sổ của thư viện cũ.', 'Không ai trong làng nhớ người lạ đã đến từ khi nào.']],
  'es-AR': ['es_AR-daniela-high', ['Ayer fui al centro con mi hermano y compramos unos libros viejos.', 'La lluvia golpeaba suavemente los cristales de la biblioteca.']],
  'en-GB': ['en_GB-cori-high', ['The rain tapped softly on the windows of the old library.', 'Nobody in the village remembered when the stranger had arrived.']],
  'pt-PT': ['pt_PT-tugão-medium', ['A chuva batia suavemente nas janelas da biblioteca antiga.', 'Ninguém na aldeia se lembrava de quando o desconhecido tinha chegado.']],
  bg: ['bg_BG-dimitar-medium', ['Дъждът тихо почукваше по прозорците на старата библиотека.', 'Никой в селото не помнеше кога беше пристигнал непознатият.']],
  sr: ['sr_RS-marko-medium', ['Киша је тихо куцала по прозорима старе библиотеке.', 'Нико у селу није памтио када је стигао непознати човек.']],
  hi: ['hi_IN-pratham-medium', ['बारिश पुरानी पुस्तकालय की खिड़कियों पर धीरे धीरे गिर रही थी।', 'गाँव में किसी को याद नहीं था कि अजनबी कब आया था।']],
  he: ['he_IL-saspeech-medium', ['הגשם ירד על החלונות של הספרייה הישנה.', 'איש בכפר לא זכר מתי הגיע האיש הזר.']]
}
const selected = Object.entries(CASES).filter(([language, [piperId]]) => (!ONLY.length || ONLY.includes(language)) && haveVoice(piperId))
if (process.env.PLAYWRIGHT_SUITE === 'languages') {
  const missing = Object.entries(CASES).filter(([language, [piperId]]) => (!ONLY.length || ONLY.includes(language)) && !haveVoice(piperId)).map(([, [piperId]]) => piperId)
  if (missing.length) throw new Error(`Real language suite is missing required weights: ${missing.join(', ')}`)
}

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.data': 'application/octet-stream', '.map': 'application/json' }
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'range, if-range', 'access-control-expose-headers': 'content-length, content-range, etag, accept-ranges' }

/** 'es_MX-claude-high' -> 'es/es_MX/claude/high/es_MX-claude-high' (the piper-voices layout). */
function hfPath(piperId) {
  const [locale, ...rest] = piperId.split('-')
  const quality = rest.pop()
  return `${locale.split('_')[0]}/${locale}/${rest.join('-')}/${quality}/${piperId}`
}

function sendFile(request, response, file, type, headers) {
  const size = statSync(file).size
  const range = /bytes=(\d+)-(\d*)/.exec(request.headers.range || '')
  const start = range ? Number(range[1]) : 0, end = range && range[2] ? Number(range[2]) : size - 1
  response.writeHead(range ? 206 : 200, { ...headers, 'content-type': type, 'content-length': end - start + 1, ...(range ? { 'content-range': `bytes ${start}-${end}/${size}` } : {}) })
  const stream = createReadStream(file, { start, end })
  request.on('close', () => stream.destroy())
  stream.pipe(response)
}

function startServer(distDir, hits) {
  const server = createServer((request, response) => {
    const { pathname } = new URL(request.url, 'http://x')
    if (request.method === 'OPTIONS') { response.writeHead(204, CORS); return response.end() }
    if (pathname.startsWith('/hf/')) {
      const rel = decodeURIComponent(pathname.slice(4))
      hits.push(rel)
      if (rel === 'aux/nakdimon.onnx') return sendFile(request, response, join(FIXTURES, 'nakdimon.onnx'), 'application/octet-stream', CORS)
      if (rel === 'voices.json') {
        const body = {}
        for (const name of readdirSync(FIXTURES).filter(file => file.endsWith('.onnx') && existsSync(join(FIXTURES, `${file}.json`)))) {
          const piperId = name.slice(0, -5), key = hfPath(piperId)
          body[piperId] = { key: piperId, files: { [`${key}.onnx`]: { size_bytes: statSync(join(FIXTURES, name)).size, md5_digest: '' }, [`${key}.onnx.json`]: { size_bytes: statSync(join(FIXTURES, `${name}.json`)).size, md5_digest: '' } } }
        }
        response.writeHead(200, { ...CORS, 'content-type': 'application/json' })
        return response.end(JSON.stringify(body))
      }
      const file = join(FIXTURES, basename(rel))
      if (!/\.onnx(\.json)?$/.test(rel) || rel !== `${hfPath(basename(rel).replace(/\.onnx(\.json)?$/, ''))}${basename(rel).slice(basename(rel).indexOf('.onnx'))}` || !existsSync(file)) { response.writeHead(404, CORS); return response.end('not found') }
      return sendFile(request, response, file, 'application/octet-stream', { ...CORS, etag: '"fixture"', 'accept-ranges': 'bytes' })
    }
    if (pathname.startsWith('/inhouse-read/')) {
      const file = join(distDir, decodeURIComponent(pathname.slice('/inhouse-read/'.length)))
      if (!file.startsWith(distDir) || !existsSync(file) || statSync(file).isDirectory()) { response.writeHead(404); return response.end('nf') }
      return sendFile(request, response, file, MIME[extname(file)] || 'application/octet-stream', { 'cache-control': 'no-store' })
    }
    response.writeHead(404); response.end('nf')
  })
  return new Promise(resolvePort => server.listen(0, '127.0.0.1', () => resolvePort({ server, port: server.address().port })))
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
const stats = pcm => {
  let peak = 0, sum = 0, finite = true
  for (const x of pcm) { if (!Number.isFinite(x)) finite = false; peak = Math.max(peak, Math.abs(x)); sum += x * x }
  return { peak, rms: Math.sqrt(sum / pcm.length), finite }
}

test.describe.configure({ mode: 'serial' })
test.describe('neural voices of the added languages (real Piper weights, real ORT + espeak-ng WASM)', () => {
  test.skip(!selected.length, `no fixtures for the added languages in ${FIXTURES} (set NEURAL_VOICE_FIXTURES)`)
  test.setTimeout(280_000)

  let outDir, server, port, page
  const hits = [], dictionaryRequests = []
  const numbers = {}

  test.beforeAll(async ({ browser }) => {
    mkdirSync(EVIDENCE, { recursive: true })
    outDir = join(tmpdir(), `neural-voice-languages-${process.pid}`)
    await build({ root: ROOT, configFile: join(ROOT, 'vite.config.js'), logLevel: 'warn', build: { outDir, emptyOutDir: true, sourcemap: false, rollupOptions: { input: join(ROOT, 'tests/e2e/fixtures/neural-voice-harness.html') } } })
    ;({ server, port } = await startServer(outDir, hits))
    page = await browser.newPage()
    await page.addInitScript(() => {
      const NativeWorker = window.Worker
      window.__neuralWorkerErrors = []
      window.Worker = class extends NativeWorker {
        constructor(...args) {
          super(...args)
          this.addEventListener('message', ({ data }) => {
            if (data?.type === 'error') window.__neuralWorkerErrors.push(data.error)
          })
        }
      }
    })
    await page.addInitScript(base => { window.INHOUSE_NEURAL_VOICE_BASE = base }, `http://127.0.0.1:${port}/hf/`)
    page.on('pageerror', error => console.log('[pageerror]', error.message))
    page.on('worker', worker => worker.on('console', () => {}))
    page.on('request', request => { if (request.url().includes('/phon/')) dictionaryRequests.push(new URL(request.url()).pathname.split('/phon/')[1]) })
    await page.goto(`http://127.0.0.1:${port}/inhouse-read/tests/e2e/fixtures/neural-voice-harness.html`)
    await page.waitForFunction(() => window.neural)
    await page.click('#unlock')
  })
  test.afterAll(async () => {
    writeFileSync(join(EVIDENCE, 'numbers-languages.json'), JSON.stringify(numbers, null, 2))
    await page?.close()
    server?.close()
  })

  test('embedded dictionaries do not require a separate download', async () => {
    expect(dictionaryRequests.filter(path => path.startsWith('dict/'))).toEqual([])
    expect(existsSync(join(outDir, 'neural-voice/phon/dict/ru_dict'))).toBe(true)
    const glue = readFileSync(join(outDir, 'neural-voice/phon/piper_phonemize.mjs'), 'utf8')
    const packBytes = statSync(join(outDir, 'neural-voice/phon/piper_phonemize.data')).size
    expect(packBytes).toBe(Number(/remote_package_size:\s*(\d+)/.exec(glue)[1]))
    expect(packBytes).toBeLessThan(2_500_000)
  })

  for (const [language, [piperId, texts, speaker = 0]] of selected) {
    test(`${language}: ${piperId} installs with its phonemizer and speaks`, async () => {
      const id = `piper:${piperId}${speaker ? `#${speaker}` : ''}`
      const t0 = Date.now()
      await page.evaluate(voice => window.neural.engine.install(voice), id)
      const installMs = Date.now() - t0
      expect(await page.evaluate(voice => window.neural.engine.installed.has(voice), id)).toBe(true)
      expect(hits).toEqual(expect.arrayContaining([`${hfPath(piperId)}.onnx`, `${hfPath(piperId)}.onnx.json`]))
      if (['bg', 'he'].includes(language)) {
        // Both companions must already be cached by installation: first speech from a cold worker needs no dictionary,
        // voice weights or Hebrew pointing weights from the network.
        await page.reload()
        await page.waitForFunction(() => window.neural)
        await page.click('#unlock')
        await page.route('**/phon/dict/**', route => route.abort('internetdisconnected'))
        await page.route('**/hf/**', route => route.abort('internetdisconnected'))
        await page.evaluate(() => window.neural.engine.refresh())
      }
      await page.evaluate(() => { window.__capture = true; window.neural.starts.length = 0 })
      const log = await page.evaluate(([voice, list]) => window.neural.readAll(voice, list, 1, { prefix: 'l' }), [id, texts])
      const engineStats = await page.evaluate(() => ({ ...window.neural.engine.stats }))
      const chunks = await page.evaluate(() => { window.__capture = false; return window.neural.starts.splice(0).map(s => ({ data: s.data, sampleRate: s.sampleRate })) })
      const workerErrors = await page.evaluate(() => window.__neuralWorkerErrors)
      expect(log.some(event => event.type === 'error'), JSON.stringify({ log, workerErrors })).toBe(false)
      expect(log.filter(event => event.type === 'done')).toHaveLength(texts.length)
      const sampleRate = chunks[0].sampleRate
      const pcm = Float32Array.from(chunks.flatMap(chunk => chunk.data))
      writeFileSync(join(EVIDENCE, `lang-${piperId}${speaker ? `-speaker${speaker}` : ''}.wav`), wavOf(pcm, sampleRate))
      const audio = { seconds: +(pcm.length / sampleRate).toFixed(2), ...stats(pcm) }
      numbers[id] = { language, installMs, sampleRate, ...audio, peak: +audio.peak.toFixed(3), rms: +audio.rms.toFixed(3), firstAudioMs: Math.round(log.find(event => event.type === 'start').at), wallSec: +(log.at(-1).at / 1000).toFixed(2), rtf: +engineStats.rtf.toFixed(2) }
      expect(audio.finite).toBe(true)
      expect(audio.seconds).toBeGreaterThan(2)
      expect(audio.seconds).toBeLessThan(40)
      expect(audio.peak).toBeGreaterThan(0.3)
      expect(audio.peak).toBeLessThanOrEqual(0.9001)
      expect(audio.rms).toBeGreaterThan(0.01)
      if (['bg', 'he'].includes(language)) {
        await page.unroute('**/phon/dict/**')
        await page.unroute('**/hf/**')
      }
      // the dictionary of a language outside the data pack came from dict/ (once), the others are inside the pack
      const cfg = JSON.parse(readFileSync(join(FIXTURES, `${piperId}.onnx.json`), 'utf8'))
      const espeak = cfg.espeak?.voice?.split(/[-_]/)[0] || language
      const dictionary = { nb:'no', zh:'cmn' }[espeak] || espeak
      const fetched = dictionaryRequests.filter(path => path === `dict/${dictionary}_dict`)
      const packaged = readFileSync(join(outDir, 'neural-voice/phon/piper_phonemize.mjs'), 'utf8').includes(`filename: "/espeak-ng-data/${dictionary}_dict"`)
      expect(fetched).toHaveLength(packaged || cfg.phoneme_type === 'hebrew' ? 0 : 1)
      if (language === 'he') expect(hits).toContain('aux/nakdimon.onnx')
      if (language === 'nl') {
        // The user's first heading failed before playback: exercise that cold worker again after reload at the video's
        // speed, with dictionary requests blocked. A packaged Dutch dictionary must work without any extra network.
        await page.reload()
        await page.waitForFunction(() => window.neural)
        await page.click('#unlock')
        await page.route('**/phon/dict/**', route => route.abort('internetdisconnected'))
        await page.evaluate(() => window.neural.engine.refresh())
        const coldLog = await page.evaluate(voice => window.neural.readAll(voice, ['De Gekke Loempia.', 'Hoofdstuk één. Voorbereidingen.'], 1.1, { prefix:'reload' }), id)
        expect(coldLog.some(event => event.type === 'error'), JSON.stringify(coldLog)).toBe(false)
        expect(coldLog.filter(event => event.type === 'done')).toHaveLength(2)
        await page.unroute('**/phon/dict/**')
      }
      // one voice at a time: the next download must not run into the browser's storage quota
      await page.evaluate(voice => window.neural.engine.remove(voice), id)
    })
  }
})
