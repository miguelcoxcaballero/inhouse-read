import { test, expect } from '@playwright/test'
import { fakeEngineScript } from '../helpers/fake-neural-engine.js'

// The on-device neural voices (Piper) as the reader sees them. The engine itself (workers, models, Hugging Face) is not
// here: a fake that implements the engine contract is injected on window.__inhouseNeuralTest before the app starts.
// What these tests prove is the integration: picker, download states, selection, the first-use offer, the neural
// transport (speak arguments, highlight at the engine's 'start') and the fallback to the system voice.
const PDF = 'tests/e2e/fixtures/reading-journey.pdf'
const EPUB = 'tests/e2e/fixtures/reading-journey.epub'
const EVIDENCE = process.env.NEURAL_EVIDENCE_DIR || 'test-results'
const LESSAC = 'piper:en_US-lessac-high'
const squash = text => String(text).replace(/\s+/g, '')
const unstopped = text => squash(text).replace(/\.$/, '')

// speechSynthesis stand-in for the system voice: every utterance starts at once and ends after a short timer.
async function prepare(page, engineOptions = {}, { theme = 'paper' } = {}) {
  test.setTimeout(200_000)
  await page.setViewportSize({ width:390, height:844 })
  await page.emulateMedia({ reducedMotion:'reduce' })
  await page.addInitScript(fakeEngineScript({ manual:true, startDelay:350, speakMs:60, ...engineOptions }))
  await page.addInitScript(selected => {
    if (selected.theme) localStorage.setItem('inhouse-read-reading-preferences', JSON.stringify({ theme:selected.theme }))
    const log = [], state = { ms:120, hold:Infinity }
    window.__tts = { log, state }
    window.SpeechSynthesisUtterance = class { constructor(text) { this.text = text } }
    window.__speechHighlight = () => {
      const read = win => { const highlight = win?.CSS?.highlights?.get('inhouse-speech'); return highlight ? [...highlight].map(range => range.toString()).join('') : '' }
      return read(window) || read(document.querySelector('foliate-view')?.renderer?.getContents?.()[0]?.doc?.defaultView)
    }
    Object.defineProperty(window, 'speechSynthesis', { configurable:true, value:{
      getVoices:() => [{ name:'Fake', lang:'en-US', voiceURI:'fake', localService:true }], addEventListener() {}, removeEventListener() {}, pause() {}, resume() {},
      cancel() { clearTimeout(state.pending) },
      speak(utterance) { log.push({ text:utterance.text }); Promise.resolve().then(() => { utterance.onstart?.({}); if (log.length < state.hold) state.pending = setTimeout(() => utterance.onend?.({}), state.ms) }) }
    } })
  }, { theme })
}
async function open(page, file) {
  await page.goto('./')
  await page.locator('#file-picker').setInputFiles(file)
  await expect(page.locator(file.endsWith('pdf') ? '.pdf-text-layer span' : 'foliate-view').first()).toBeVisible()
  if (file.endsWith('pdf')) await expect(page.locator('#reader-location')).toHaveAttribute('aria-label', /Página 1 de 4/)
  else await expect.poll(() => page.evaluate(() => Boolean(document.querySelector('foliate-view')?.renderer?.getContents?.()[0]?.doc?.body)), { timeout:30_000 }).toBe(true)
}
const engine = (page, fn, arg) => page.evaluate(`(${fn})(window.__inhouseNeuralTest.engine, ${JSON.stringify(arg ?? null)})`)
const calls = page => engine(page, e => e.calls.map(call => ({ ...call })))
const openAudio = page => page.getByRole('button', { name:'Escuchar el libro' }).click()
const neural = page => page.locator('[data-neural]')
const row = (page, id = LESSAC) => page.locator(`[data-neural-voice="${id}"]`)
const shot = async (page, name) => {
  await neural(page).scrollIntoViewIfNeeded()
  await page.screenshot({ path:`${EVIDENCE}/${name}.png` })
}
const noOverflow = page => page.locator('.reading-panel').evaluate(panel => panel.scrollWidth <= panel.clientWidth)

for (const [format, file] of [['EPUB', EPUB], ['PDF', PDF]]) {
  test(`${format}: download the natural voice, it is selected, reading goes through the neural engine and the highlight waits for its start`, async ({ page }) => {
    const errors = []; page.on('pageerror', error => errors.push(error.message))
    await prepare(page)
    await open(page, file)
    await openAudio(page)

    // The group, the honest note and the book language first (the book is English: Lessac is the recommended one).
    await expect(neural(page).getByRole('heading', { name:'Voces naturales · sin conexión' })).toBeVisible()
    await expect(neural(page)).toContainText('Se descarga una vez (63 MB) y funciona sin internet.')
    expect(await neural(page).locator('[data-neural-voice]').evaluateAll(items => items.slice(0, 2).map(item => item.dataset.neuralVoice))).toEqual([LESSAC, 'piper:en_GB-alba-medium'])
    expect(await engine(page, e => e.installs)).toEqual([]) // nothing downloads by itself
    await expect(row(page)).toContainText('Recomendada')
    await expect(row(page)).toContainText('Inglés (EE. UU.) · 63 MB')

    await row(page).getByRole('button', { name:/Descargar la voz Lessac/ }).click()
    const bar = row(page).getByRole('progressbar', { name:'Descargando Lessac' })
    await expect(bar).toHaveAttribute('aria-valuenow', '0')
    await engine(page, e => e.progress('piper:en_US-lessac-high', .4))
    await expect(bar).toHaveAttribute('aria-valuenow', '40')
    await expect(row(page)).toContainText('40 %')
    await expect(row(page).getByRole('button', { name:/Cancelar la descarga de Lessac/ })).toBeVisible()
    await shot(page, `picker-${format}-downloading`)

    await engine(page, e => e.finish('piper:en_US-lessac-high'))
    await expect(row(page).getByRole('button', { name:/Voz en uso Lessac/ })).toHaveAttribute('aria-pressed', 'true')
    await expect(row(page)).toContainText('Instalada')
    await expect(page.getByRole('combobox', { name:'Voz de lectura' })).toHaveValue(LESSAC)
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('inhouse-read-reading-preferences')).voice)).toBe(LESSAC)
    await expect(page.locator('[data-voice-auto]')).toHaveText('')
    await shot(page, `picker-${format}-installed`)
    expect(await noOverflow(page)).toBe(true)

    // Reading: the neural engine gets the fragment, the next ones and the speed; the system voice stays silent.
    await page.getByRole('slider', { name:'Velocidad de voz' }).fill('1.4')
    await page.getByRole('button', { name:'Reproducir', exact:true }).click()
    await expect.poll(async () => (await calls(page)).length).toBeGreaterThan(2)
    const spoken = await calls(page)
    expect(spoken[0]).toMatchObject({ voiceId:LESSAC, rate:1.4, atSpeak:'' })
    expect(spoken[0].upcoming.length).toBeGreaterThanOrEqual(2); expect(spoken[0].upcoming.length).toBeLessThanOrEqual(4)
    expect(spoken[1].text).toBe(spoken[0].upcoming[0])
    expect(await engine(page, e => e.unlocks)).toBeGreaterThanOrEqual(1)
    expect(await page.evaluate(() => window.__tts.log.length)).toBe(0)
    // The sentence is painted when the engine says it started (350 ms after speak), not before.
    for (const call of spoken.slice(0, 2)) expect(squash(call.atStart)).toContain(unstopped(call.text))
    await expect(page.getByRole('button', { name:'Pausar', exact:true })).toBeVisible()

    // Pause stops the engine and clears the highlight; resume speaks the same fragment again.
    const before = (await calls(page)).length
    await page.getByRole('button', { name:'Pausar', exact:true }).click()
    await expect.poll(() => page.evaluate(() => window.__speechHighlight())).toBe('')
    expect(await engine(page, e => e.stops)).toBeGreaterThan(0)
    const paused = (await calls(page)).at(-1).text
    await page.getByRole('button', { name:'Continuar', exact:true }).click()
    await expect.poll(async () => (await calls(page)).length).toBeGreaterThan(before)
    expect((await calls(page)).at(-1).text).toBe(paused)
    expect(errors).toEqual([])
  })
}

test('the download can be cancelled, fails with a clear message and can be retried; a voice can be removed', async ({ page }) => {
  await prepare(page, { failInstall:{ 'piper:en_US-lessac-high':'offline' } })
  await open(page, EPUB)
  await openAudio(page)
  const alba = 'piper:en_GB-alba-medium'
  // cancel
  await row(page, alba).getByRole('button', { name:/Descargar la voz Alba/ }).click()
  await row(page, alba).getByRole('button', { name:/Cancelar la descarga de Alba/ }).click()
  await expect(row(page, alba).getByRole('button', { name:/Descargar la voz Alba/ })).toBeVisible()
  await expect(row(page, alba).getByRole('progressbar')).toHaveCount(0)
  await expect(page.locator('[data-neural-status]')).toHaveText('Descarga cancelada.')
  // error, then retry
  await row(page).getByRole('button', { name:/Descargar la voz Lessac/ }).click()
  await expect(row(page)).toContainText('Sin conexión. Conéctate a internet para descargarla.')
  await expect(row(page).getByRole('alert')).toBeVisible()
  await shot(page, 'picker-error')
  await row(page).getByRole('button', { name:/Reintentar la descarga de Lessac/ }).click()
  await engine(page, e => e.finish('piper:en_US-lessac-high'))
  await expect(row(page).getByRole('button', { name:/Voz en uso Lessac/ })).toBeVisible()
  // pick another installed voice, then remove the one in use: the choice goes back to Automática
  await engine(page, e => { e.set.add('piper:en_GB-alba-medium'); e.emitChange() })
  await row(page, alba).getByRole('button', { name:/Usar la voz Alba/ }).click()
  await expect(page.getByRole('combobox', { name:'Voz de lectura' })).toHaveValue(alba)
  await row(page, alba).getByRole('button', { name:/Quitar la voz Alba/ }).click()
  await expect(row(page, alba).getByRole('button', { name:/Descargar la voz Alba/ })).toBeVisible()
  await expect(page.getByRole('combobox', { name:'Voz de lectura' })).toHaveValue('')
  expect(await engine(page, e => e.removed)).toEqual([alba])
  expect(await engine(page, e => e.installs)).toEqual([alba, 'piper:en_US-lessac-high', 'piper:en_US-lessac-high'])
})

test('the picker works with the keyboard and keeps focus while it repaints', async ({ page }) => {
  await prepare(page)
  await open(page, EPUB)
  await openAudio(page)
  const download = row(page).getByRole('button', { name:/Descargar la voz Lessac/ })
  await download.focus()
  await page.keyboard.press('Enter')
  const cancel = row(page).getByRole('button', { name:/Cancelar la descarga de Lessac/ })
  await expect(cancel).toBeFocused()
  await engine(page, e => e.progress('piper:en_US-lessac-high', .6))
  await expect(cancel).toBeFocused()
  await engine(page, e => e.finish('piper:en_US-lessac-high'))
  await expect(row(page).locator('[data-neural-action]').first()).toBeFocused()
  await expect(page.locator('[data-neural-status]')).toHaveText('Voz Lessac instalada y seleccionada.')
})

for (const theme of ['paper', 'night', 'sepia', 'sage', 'amoled']) {
  test(`the first-use offer and the picker on the ${theme} theme at 390 px`, async ({ page }) => {
    await prepare(page, { hold:true }, { theme })
    await open(page, EPUB)
    await openAudio(page)
    await expect(page.locator('[data-neural-offer]')).toBeHidden() // not before the audiobook starts
    await shot(page, `picker-${theme}-idle`)
    await page.getByRole('button', { name:'Reproducir', exact:true }).click()
    const offer = page.locator('[data-neural-offer]')
    await expect(offer).toBeVisible()
    await expect(offer).toContainText('Voz natural sin conexión (63 MB)')
    await expect(offer.getByRole('button', { name:/Descargar la voz natural Lessac/ })).toBeVisible()
    await expect(offer.getByRole('button', { name:'Ahora no' })).toBeVisible()
    await offer.scrollIntoViewIfNeeded()
    await page.screenshot({ path:`${EVIDENCE}/offer-${theme}.png` })
    // the card never stops the voice: the system voice is speaking
    await expect.poll(() => page.evaluate(() => window.__tts.log.length)).toBeGreaterThan(0)
    await offer.getByRole('button', { name:/Descargar la voz natural Lessac/ }).click()
    await engine(page, e => e.progress('piper:en_US-lessac-high', .35))
    await expect(offer.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '35')
    await offer.scrollIntoViewIfNeeded()
    await page.screenshot({ path:`${EVIDENCE}/offer-${theme}-downloading.png` })
    await neural(page).scrollIntoViewIfNeeded()
    await page.screenshot({ path:`${EVIDENCE}/picker-${theme}-downloading.png` })
    await engine(page, e => e.finish('piper:en_US-lessac-high'))
    await expect(offer).toBeHidden()
    await neural(page).scrollIntoViewIfNeeded()
    await page.screenshot({ path:`${EVIDENCE}/picker-${theme}-installed.png` })
    expect(await noOverflow(page)).toBe(true)
  })
}

test('first-use offer: Ahora no is remembered per language; Descargar starts the download and the voice takes over at the next fragment', async ({ page }) => {
  await prepare(page, { manual:false, steps:3, stepMs:60 })
  await open(page, EPUB)
  await openAudio(page)
  await page.getByRole('button', { name:'Reproducir', exact:true }).click()
  const offer = page.locator('[data-neural-offer]')
  await expect(offer).toBeVisible()
  await offer.getByRole('button', { name:'Ahora no' }).click()
  await expect(offer).toBeHidden()
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('inhouse-read-neural-offer-dismissed')))).toEqual({ en:true })
  expect(await engine(page, e => e.installs)).toEqual([])
  // a new session does not ask again
  await page.reload()
  await open(page, EPUB)
  await openAudio(page)
  await page.getByRole('button', { name:'Reproducir', exact:true }).click()
  await expect.poll(() => page.evaluate(() => window.__tts.log.length)).toBeGreaterThan(0)
  await expect(offer).toBeHidden()
  // but the list in the picker still offers the download
  await expect(row(page).getByRole('button', { name:/Descargar la voz Lessac/ })).toBeVisible()
  // forget the choice: Descargar this time
  await page.evaluate(() => localStorage.removeItem('inhouse-read-neural-offer-dismissed'))
  await page.getByRole('button', { name:'Detener', exact:true }).click()
  await page.getByRole('button', { name:'Reproducir', exact:true }).click()
  await expect(offer).toBeVisible()
  await offer.getByRole('button', { name:/Descargar la voz natural Lessac/ }).click()
  await expect(offer).toBeHidden({ timeout:15_000 }) // installed: no more offer
  await expect(page.getByRole('combobox', { name:'Voz de lectura' })).toHaveValue(LESSAC)
  await expect.poll(async () => (await calls(page)).length, { timeout:30_000 }).toBeGreaterThan(0)
  expect((await calls(page))[0].voiceId).toBe(LESSAC)
})

test('a neural voice that is too slow hands over to the system voice with a visible message', async ({ page }) => {
  await prepare(page, { installed:[LESSAC], manual:false, failNext:'too-slow' })
  await open(page, EPUB)
  await openAudio(page)
  await expect(row(page).getByRole('button', { name:/Usar la voz Lessac/ })).toBeVisible()
  await page.getByRole('button', { name:'Reproducir', exact:true }).click()
  await expect(page.locator('.reading-audio-status')).toHaveText('La voz natural no va lo bastante rápida en este dispositivo. Sigo con la mejor voz del sistema.')
  await expect.poll(() => page.evaluate(() => window.__tts.log.length)).toBeGreaterThan(0) // the system voice carries on
  expect((await calls(page)).length).toBe(1) // the neural engine is not asked again
  await expect(page.locator('[data-neural-warning]')).toBeVisible()
  await shot(page, 'picker-fallback')
  // Volver a probar gives the neural voice another chance
  await page.getByRole('button', { name:'Volver a probar' }).click()
  await expect(page.locator('[data-neural-warning]')).toBeHidden()
})

test('where the engine is unsupported the natural voices are not offered and reading is unchanged', async ({ page }) => {
  await prepare(page, { supported:false })
  await open(page, EPUB)
  await openAudio(page)
  await expect(neural(page)).toBeHidden()
  expect(await page.locator('[data-pref="voice"] optgroup').evaluateAll(groups => groups.map(group => group.label))).toEqual(['Recomendadas (naturales)', 'Todas las voces']) // only the system voices
  await page.getByRole('button', { name:'Reproducir', exact:true }).click()
  await expect(page.locator('[data-neural-offer]')).toBeHidden()
  await expect.poll(() => page.evaluate(() => window.__tts.log.length)).toBeGreaterThan(0)
  expect(await engine(page, e => e.calls.length)).toBe(0)
})
