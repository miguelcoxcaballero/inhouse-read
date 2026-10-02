import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { ReaderExperience } from '../../src/js/readers/reader-experience.js'
import { normalizeReadingPreferences } from '../../src/js/readers/reading-preferences.js'
import { loadNeural } from '../../src/js/readers/neural-runtime.js'
import { neuralVoices, setNeuralEngine } from '../../src/js/readers/neural-voice/index.js'
import { createFakeNeuralEngine, FAKE_CATALOG } from '../helpers/fake-neural-engine.js'

// The "Voces naturales · sin conexión" picker and the first-use offer, driven by a fake engine (no real ReadingVoice audio).
const LESSAC = 'piper:en_US-lessac-high', ALBA = 'piper:en_GB-alba-medium', DAVEFX = 'piper:es_ES-davefx-medium'
let catalogue
beforeAll(async () => { await loadNeural(); catalogue = [...neuralVoices]; neuralVoices.splice(0, neuralVoices.length, ...FAKE_CATALOG) })
afterAll(() => { neuralVoices.splice(0, neuralVoices.length, ...catalogue); setNeuralEngine(null) })
beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal('InhouseSpeech', { speak:vi.fn(), stop:vi.fn(), getVoices:() => '[]' })
  document.body.innerHTML = '<header class="app-header"></header><section id="reader-screen"><div id="reader-toolbar"></div></section>'
  for (const id of ['reader-location', 'reader-settings', 'reader-audio', 'reader-save-bookmark', 'reader-search-shortcut', 'reader-more-shortcut', 'reader-top-title', 'reader-top-byline']) {
    const button = document.createElement('button'); button.id = id
    if (id === 'reader-location') button.innerHTML = '<span class="reader-location-label"></span>'
    document.getElementById('reader-screen').append(button)
  }
})
afterEach(() => { vi.unstubAllGlobals(); document.body.innerHTML = '' })

async function setup({ language = 'en', ...engineOptions } = {}) {
  const engine = createFakeNeuralEngine({ voices:FAKE_CATALOG, manual:true, hold:true, ...engineOptions })
  setNeuralEngine(engine)
  const reader = { language, location:{ fraction:0 }, format:{ engine:'foliate' }, toc:[], pageCount:null, applyPreferences:async () => {}, addQuoteAnnotation() {}, getSelection() {}, next:async () => {}, prev:async () => {}, getSpeechText:async () => 'Hello there. Second one.' }
  const experience = new ReaderExperience(reader, { persist:async () => {} })
  experience.panel.close = vi.fn()
  await experience.open({ id:'b', title:'Book' })
  experience.neuralPicker.refresh(); await loadNeural(); await new Promise(resolve => setTimeout(resolve, 0)) // the picker attaches once the module is there
  if (engine.supported) expect(experience.neuralPicker.engine).toBe(engine)
  return { engine, experience, reader, panel:experience.panel }
}
const block = panel => panel.querySelector('[data-neural]')
const rows = panel => [...panel.querySelectorAll('[data-neural-voice]')]
const row = (panel, id = LESSAC) => panel.querySelector(`[data-neural-voice="${id}"]`)
const click = (panel, id, action) => panel.querySelector(`[data-neural-voice="${id}"] [data-neural-action="${action}"]`).click()
const offer = panel => panel.querySelector('[data-neural-offer]')
const select = panel => panel.querySelector('[data-pref="voice"]')
const saved = () => JSON.parse(localStorage.getItem('inhouse-read-reading-preferences')).voice

describe('natural voices group', () => {
  it('is hidden where the engine is unsupported, and nothing else changes', async () => {
    const { panel, experience } = await setup({ supported:false })
    expect(block(panel).hidden).toBe(true)
    expect(offer(panel).hidden).toBe(true)
    expect([...select(panel).querySelectorAll('optgroup')].map(group => group.label)).not.toContain('Voces naturales · sin conexión')
    experience.voice.state = 'playing'; experience.neuralPicker.render()
    expect(offer(panel).hidden).toBe(true)
  })
  it('lists the catalogue with the book language first, with name, language, size and a Descargar button, plus the honest note', async () => {
    const { panel } = await setup({ language:'es-ES' })
    expect(block(panel).hidden).toBe(false)
    expect(panel.querySelector('#reading-neural-title').textContent).toBe('Voces naturales · sin conexión')
    expect(block(panel).getAttribute('aria-labelledby')).toBe('reading-neural-title')
    expect(panel.querySelector('[data-neural-note]').textContent).toBe('Se descarga una vez (63 MB) y funciona sin internet.')
    expect(rows(panel).slice(0, 3).map(item => item.dataset.neuralVoice)).toEqual([DAVEFX, 'piper:es_MX-claude-high', LESSAC]) // book language (es-ES first), then the device language (en-US)
    expect(row(panel, DAVEFX).textContent).toContain('Davefx')
    expect(row(panel, DAVEFX).textContent).toContain('Recomendada')
    expect(row(panel, DAVEFX).textContent).toContain('Español (España) · 63 MB')
    const button = row(panel, DAVEFX).querySelector('button')
    expect(button.textContent).toBe('Descargar')
    expect(button.getAttribute('aria-label')).toBe('Descargar la voz Davefx, Español (España) (63 MB)')
    expect(row(panel, DAVEFX).dataset.state).toBe('idle')
  })
  it('never downloads by itself: only a tap asks the engine', async () => {
    const { panel, engine, experience } = await setup()
    experience.voice.state = 'playing'; experience.neuralPicker.render()
    experience.panel.showModal = vi.fn()
    experience.populateVoices(); experience.show('audio') // opening the panel, rendering, refreshing
    expect(engine.installs).toEqual([])
    click(panel, LESSAC, 'install')
    expect(engine.installs).toEqual([LESSAC])
  })
  it('shows progress with a bar, a percentage and Cancelar, then Instalada and selects the voice (saved)', async () => {
    const { panel, engine } = await setup()
    click(panel, LESSAC, 'install')
    expect(engine.unlocks).toBe(1) // the tap is a user gesture: audio can be unlocked
    expect(row(panel).dataset.state).toBe('downloading')
    const bar = row(panel).querySelector('[role="progressbar"]')
    expect(bar.getAttribute('aria-valuenow')).toBe('0')
    expect(bar.getAttribute('aria-label')).toBe('Descargando Lessac')
    engine.progress(LESSAC, .4)
    await vi.waitFor(() => expect(row(panel).querySelector('[role="progressbar"]').getAttribute('aria-valuenow')).toBe('40'))
    expect(row(panel).textContent).toContain('40 %')
    expect(row(panel).querySelector('[data-neural-action="cancel"]').getAttribute('aria-label')).toBe('Cancelar la descarga de Lessac')
    engine.finish(LESSAC)
    await vi.waitFor(() => expect(row(panel).dataset.state).toBe('installed'))
    expect(row(panel).textContent).toContain('Instalada')
    const use = row(panel).querySelector('[data-neural-action="use"]')
    expect(use.getAttribute('aria-pressed')).toBe('true')
    expect(use.textContent).toBe('En uso')
    expect(saved()).toBe(LESSAC)
    expect(select(panel).value).toBe(LESSAC)
    expect([...select(panel).querySelectorAll('optgroup')][0].label).toBe('Voces naturales · sin conexión')
    expect(panel.querySelector('[data-neural-status]').textContent).toBe('Voz Lessac instalada y seleccionada.')
  })
  it('Cancelar aborts the download without leaving a selection', async () => {
    const { panel, engine } = await setup()
    click(panel, LESSAC, 'install')
    click(panel, LESSAC, 'cancel')
    await vi.waitFor(() => expect(row(panel).dataset.state).toBe('idle'))
    expect(engine.installed.has(LESSAC)).toBe(false)
    expect(saved()).toBe('')
    expect(panel.querySelector('[data-neural-status]').textContent).toBe('Descarga cancelada.')
  })
  it('a failed download shows a clear message and Reintentar, and a retry can succeed', async () => {
    const { panel, engine } = await setup({ failInstall:{ [LESSAC]:'storage' } })
    click(panel, LESSAC, 'install')
    await vi.waitFor(() => expect(row(panel).dataset.state).toBe('error'))
    expect(row(panel).textContent).toContain('No hay espacio suficiente en el dispositivo.')
    expect(row(panel).querySelector('[role="alert"]')).not.toBeNull()
    const retry = row(panel).querySelector('[data-neural-action="install"]')
    expect(retry.textContent).toBe('Reintentar')
    retry.click()
    engine.finish(LESSAC)
    await vi.waitFor(() => expect(row(panel).dataset.state).toBe('installed'))
    expect(engine.installs).toEqual([LESSAC, LESSAC])
  })
  it('offline and unknown failures get their own wording', async () => {
    const { panel } = await setup({ failInstall:{ [LESSAC]:'offline', [ALBA]:'http' } })
    click(panel, LESSAC, 'install'); click(panel, ALBA, 'install')
    await vi.waitFor(() => expect(row(panel, ALBA).dataset.state).toBe('error'))
    expect(row(panel).textContent).toContain('Sin conexión. Conéctate a internet para descargarla.')
    expect(row(panel, ALBA).textContent).toContain('No se pudo descargar la voz. Inténtalo de nuevo.')
  })
  it('Usar selects an installed voice, Quitar deletes it and goes back to Automática if it was selected', async () => {
    const { panel, engine } = await setup({ installed:[LESSAC, ALBA] })
    expect(row(panel).dataset.state).toBe('installed')
    click(panel, ALBA, 'use')
    expect(saved()).toBe(ALBA)
    expect(row(panel, ALBA).querySelector('[data-neural-action="use"]').getAttribute('aria-pressed')).toBe('true')
    expect(row(panel).querySelector('[data-neural-action="use"]').getAttribute('aria-pressed')).toBe('false')
    click(panel, ALBA, 'remove')
    await vi.waitFor(() => expect(row(panel, ALBA).dataset.state).toBe('idle'))
    expect(engine.removed).toEqual([ALBA])
    expect(saved()).toBe('')
    expect(select(panel).value).toBe('')
  })
  it('a saved neural choice that is no longer installed falls back to Automática in the select', async () => {
    localStorage.setItem('inhouse-read-reading-preferences', JSON.stringify({ voice:ALBA }))
    const { panel, experience } = await setup({ installed:[LESSAC] })
    expect(experience.preferences.voice).toBe(ALBA)
    expect(select(panel).value).toBe('')
    expect(panel.querySelector('[data-voice-auto]').textContent).toBe('Se usará: Inglés (EE. UU.) · Lessac · Natural · sin conexión.')
  })
})

describe('warm-up', () => {
  const settle = () => new Promise(resolve => setTimeout(resolve, 0))
  it('loads the engine of the voice the next Play will use when the audio tab opens: the default voice, or the chosen one', async () => {
    const { experience, engine } = await setup({ installed:[LESSAC] }) // an installed neural voice wins 'Automática'
    experience.panel.showModal = vi.fn()
    experience.show('audio')
    await vi.waitFor(() => expect(engine.warmed).toContain(LESSAC))
    await settle(); engine.warmed.length = 0
    experience.setPreference('voice', '')
    await vi.waitFor(() => expect(engine.warmed).toContain(LESSAC))
    expect(new Set(engine.warmed)).toEqual(new Set([LESSAC]))
  })
  it('does not spin the worker up for a system voice, for a voice that is not downloaded, or after the neural voice was given up on', async () => {
    vi.stubGlobal('InhouseSpeech', { speak:vi.fn(), stop:vi.fn(), getVoices:() => JSON.stringify([{ voiceURI:'en-sys', name:'en', lang:'en-US', quality:300, network:false, installed:true }]) })
    const { experience, engine } = await setup({ installed:[LESSAC] })
    experience.panel.showModal = vi.fn()
    await settle(); engine.warmed.length = 0 // setup() opened the book with 'Automática', which already warmed the installed neural voice
    experience.setPreference('voice', 'en-sys'); experience.show('audio'); await settle()
    expect(engine.warmed).toEqual([])
    experience.voice.neuralOff = 'too-slow'; experience.setPreference('voice', LESSAC, { restart:false }); await settle()
    expect(new Set(engine.warmed)).toEqual(new Set([LESSAC])) // choosing it again is a new chance (retryNeural runs first)
    const second = await setup({ installed:[] })
    second.experience.panel.showModal = vi.fn()
    second.experience.show('audio'); await settle()
    expect(second.engine.warmed).toEqual([])
  })
})

describe('first-use offer', () => {
  it('appears only once the audiobook runs, for a book language with no installed neural voice, and never downloads by itself', async () => {
    const { panel, engine, experience } = await setup()
    expect(offer(panel).hidden).toBe(true)
    experience.voice.state = 'playing'; experience.neuralPicker.render()
    expect(offer(panel).hidden).toBe(false)
    expect(offer(panel).querySelector('.reading-neural-offer__title').textContent).toBe('Voz natural sin conexión (63 MB)')
    expect([...offer(panel).querySelectorAll('button')].map(node => node.textContent)).toEqual(['Descargar', 'Ahora no'])
    expect(offer(panel).getAttribute('role')).toBe('group')
    expect(engine.installs).toEqual([])
    experience.voice.state = 'paused'; experience.neuralPicker.render(); expect(offer(panel).hidden).toBe(false)
    experience.voice.state = 'stopped'; experience.neuralPicker.render(); expect(offer(panel).hidden).toBe(true)
  })
  it('Ahora no hides it and is remembered for that language only', async () => {
    const { panel, experience } = await setup()
    experience.voice.state = 'playing'; experience.neuralPicker.render()
    offer(panel).querySelector('[data-neural-action="dismiss"]').click()
    expect(offer(panel).hidden).toBe(true)
    expect(JSON.parse(localStorage.getItem('inhouse-read-neural-offer-dismissed'))).toEqual({ en:true })
    experience.neuralPicker.render(); expect(offer(panel).hidden).toBe(true)
    // another language still gets its offer
    experience.reader.language = 'es-ES'; experience.neuralPicker.render()
    expect(offer(panel).hidden).toBe(false)
  })
  it('Descargar downloads the recommended voice of the book language, shows its progress, then disappears and selects it', async () => {
    const { panel, engine, experience } = await setup({ language:'es-MX' })
    experience.voice.state = 'playing'; experience.neuralPicker.render()
    offer(panel).querySelector('[data-neural-action="install"]').click()
    expect(engine.installs).toEqual(['piper:es_MX-claude-high']) // the region of the book first
    engine.progress('piper:es_MX-claude-high', .5)
    await vi.waitFor(() => expect(offer(panel).querySelector('[role="progressbar"]').getAttribute('aria-valuenow')).toBe('50'))
    expect([...offer(panel).querySelectorAll('button')].map(node => node.textContent)).toEqual(['Cancelar'])
    engine.finish('piper:es_MX-claude-high')
    await vi.waitFor(() => expect(offer(panel).hidden).toBe(true))
    expect(saved()).toBe('piper:es_MX-claude-high')
  })
  it('a failed offer download says so and offers Reintentar', async () => {
    const { panel, experience } = await setup({ failInstall:{ [LESSAC]:'offline' } })
    experience.voice.state = 'playing'; experience.neuralPicker.render()
    offer(panel).querySelector('[data-neural-action="install"]').click()
    await vi.waitFor(() => expect(offer(panel).textContent).toContain('Sin conexión'))
    expect([...offer(panel).querySelectorAll('button')].map(node => node.textContent)).toEqual(['Reintentar', 'Ahora no'])
  })
  it('is not shown when a neural voice of the language is installed, or the catalogue has none for it', async () => {
    const { panel, experience } = await setup({ installed:[ALBA] })
    experience.voice.state = 'playing'; experience.neuralPicker.render()
    expect(offer(panel).hidden).toBe(true) // en-GB installed covers the English book
    experience.reader.language = 'ja-JP'; experience.neuralPicker.render()
    expect(offer(panel).hidden).toBe(true) // nothing to offer in Japanese
  })
})

describe('reading preferences accept neural voice ids', () => {
  it('keeps a piper: id as the saved voice', () => {
    expect(normalizeReadingPreferences({ voice:LESSAC }).voice).toBe(LESSAC)
    expect(normalizeReadingPreferences({ voice:null }).voice).toBe('')
  })
})
