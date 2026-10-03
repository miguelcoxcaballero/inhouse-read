import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { ReaderExperience } from '../../src/js/readers/reader-experience.js'
import { normalizeReadingPreferences } from '../../src/js/readers/reading-preferences.js'
import { loadNeural } from '../../src/js/readers/neural-runtime.js'
import { neuralVoices, setNeuralEngine } from '../../src/js/readers/neural-voice/index.js'
import { createFakeNeuralEngine, FAKE_CATALOG } from '../helpers/fake-neural-engine.js'
import { SUPERTONIC_BYTES } from '../../src/js/readers/neural-voice/supertonic-catalog.js'

// The "Voces naturales" picker and the first-use offer, driven by a fake engine (no real ReadingVoice audio).
const LESSAC = 'piper:en_US-lessac-high', ALBA = 'piper:en_GB-alba-medium', DAVEFX = 'piper:es_ES-davefx-medium'
let catalogue
beforeAll(async () => { await loadNeural(); catalogue = [...neuralVoices]; neuralVoices.splice(0, neuralVoices.length, ...FAKE_CATALOG) })
afterAll(() => { neuralVoices.splice(0, neuralVoices.length, ...catalogue); setNeuralEngine(null) })
beforeEach(() => {
  localStorage.clear()
  // Finish the idle warm-up inside the test, before its DOM is removed.
  vi.stubGlobal('requestIdleCallback', callback => { callback(); return 0 })
  vi.stubGlobal('InhouseSpeech', { speak:vi.fn(), stop:vi.fn(), getVoices:() => '[]' })
  document.body.innerHTML = '<header class="app-header"></header><section id="reader-screen"><div id="reader-toolbar"></div></section>'
  for (const id of ['reader-location', 'reader-settings', 'reader-audio', 'reader-save-bookmark', 'reader-search-shortcut', 'reader-more-shortcut', 'reader-top-title', 'reader-top-byline']) {
    const button = document.createElement('button'); button.id = id
    if (id === 'reader-location') button.innerHTML = '<span class="reader-location-label"></span>'
    document.getElementById('reader-screen').append(button)
  }
})

describe('shared voice expansion',()=>{
  it('offers only the small additional download while preserving installed legacy profiles',async()=>{
    const shared=['F1','F3'].map(style=>({id:`supertonic3:${style}:es`,piperId:'supertonic3',modelKey:'supertonic3',runtime:'supertonic3',lang:'es',style,name:`Supertonic ${style}`,sizeMB:211,upgradeBytes:2039325,sharedPack:true}));
    neuralVoices.push(...shared);
    try {
      const {panel}=await setup({language:'es',installed:[shared[0].id]});
      expect(row(panel,shared[0].id).textContent).toContain('Instalada');
      const item=row(panel,shared[1].id);
      expect(item.textContent).toContain('2 MB adicionales');
      expect(item.querySelector('[data-neural-action="install"]').textContent).toBe('Ampliar voces');
      expect(item.querySelector('[data-neural-action="install"]').getAttribute('aria-label')).toContain('(2 MB)');
    } finally {for(const voice of shared)neuralVoices.splice(neuralVoices.indexOf(voice),1)}
  });
});
afterEach(async () => { await Promise.resolve(); vi.unstubAllGlobals(); document.body.innerHTML = '' })

async function setup({ language = 'en', ...engineOptions } = {}) {
  const engine = createFakeNeuralEngine({ voices:FAKE_CATALOG, manual:true, hold:true, ...engineOptions })
  setNeuralEngine(engine)
  const reader = { language, location:{ fraction:0 }, format:{ engine:'foliate' }, toc:[], pageCount:null, applyPreferences:async () => {}, addQuoteAnnotation() {}, getSelection() {}, next:async () => {}, prev:async () => {}, getSpeechText:async () => 'Hello there. Second one.' }
  const experience = new ReaderExperience(reader, { persist:async () => {} })
  experience.panel.voiceMenu = experience.voiceMenu
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
const select = panel => panel.voiceMenu // the Voz dropdown of the audio panel (see setup)
const saved = () => JSON.parse(localStorage.getItem('inhouse-read-reading-preferences')).voice

describe('natural voices group', () => {
  it('labels the multilingual pack size and licence, and downloads only after a tap', async () => {
    const shared={id:'supertonic3:F1:es',piperId:'supertonic3',modelKey:'supertonic3',runtime:'supertonic3',lang:'es',style:'F1',name:'Supertonic F1',quality:'natural',sizeMB:Math.ceil(SUPERTONIC_BYTES/1e6),sharedPack:true,licenseUrl:'licenses/supertonic3-OpenRAIL-M.txt'}
    neuralVoices.push(shared)
    try {
      const {panel,engine}=await setup({language:'es'})
      const item=row(panel,shared.id)
      expect(item.textContent).toContain(`${Math.ceil(SUPERTONIC_BYTES/1e6)} MB`)
      expect(item.textContent).toContain('Paquete compartido · todos sus idiomas y voces')
      expect(item.querySelector('a').textContent).toBe('Licencia OpenRAIL-M')
      expect(item.querySelector('a').getAttribute('href')).toContain('/licenses/supertonic3-OpenRAIL-M.txt')
      expect(engine.installs).toEqual([])
      click(panel,shared.id,'install');expect(engine.installs).toEqual([shared.id])
      engine.abort(shared.id);await Promise.resolve()
    } finally {neuralVoices.splice(neuralVoices.indexOf(shared),1)}
  })
  it('removing one shared profile clears a selected sibling and tells reading about every removed profile', async () => {
    const shared=['F1','M1'].map(style=>({id:`supertonic3:${style}:es`,piperId:'supertonic3',modelKey:'supertonic3',runtime:'supertonic3',lang:'es',style,name:`Supertonic ${style}`,sizeMB:400,sharedPack:true}))
    neuralVoices.push(...shared)
    try {
      const {panel,experience}=await setup({language:'es',installed:shared.map(voice=>voice.id)})
      experience.setPreference('voice',shared[1].id,{restart:false})
      const removed=vi.spyOn(experience.voice,'voiceRemoved')
      expect(row(panel,shared[0].id).querySelector('[data-neural-action="remove"]').getAttribute('aria-label')).toContain('paquete compartido')
      await experience.neuralPicker.remove(shared[0].id)
      expect(experience.preferences.voice).toBe('')
      expect(removed.mock.calls.map(([id])=>id)).toEqual(shared.map(voice=>voice.id))
      expect(panel.querySelector('[data-neural-status]').textContent).toBe('Paquete compartido Supertonic quitado.')
    } finally {for(const voice of shared)neuralVoices.splice(neuralVoices.indexOf(voice),1)}
  })
  it('is hidden where the engine is unsupported, and nothing else changes', async () => {
    const { panel, experience } = await setup({ supported:false })
    expect(block(panel).hidden).toBe(true)
    expect(offer(panel).hidden).toBe(true)
    expect(select(panel).options.some(option => option.value.startsWith('piper:'))).toBe(false)
    experience.voice.state = 'playing'; experience.neuralPicker.render()
    expect(offer(panel).hidden).toBe(true)
  })
  it('lists the catalogue with the book language first, with name, language, size and a Descargar button', async () => {
    const { panel } = await setup({ language:'es-ES' })
    expect(block(panel).hidden).toBe(false)
    expect(panel.querySelector('#reading-neural-title').textContent).toBe('Voces naturales')
    expect(block(panel).getAttribute('aria-labelledby')).toBe('reading-neural-title')
    expect(panel.querySelector('[data-neural-note]')).toBeNull() // no explanatory note: each row says its size
    expect(rows(panel).map(item => item.dataset.neuralVoice)).toEqual([DAVEFX, 'piper:es_MX-claude-high']) // only the language chosen in Idioma (the book's: es-ES first)
    expect(row(panel, DAVEFX).textContent).toContain('Davefx')
    expect(row(panel, DAVEFX).textContent).toContain('Recomendada')
    expect(row(panel, DAVEFX).textContent).toContain('Español (España) · 63 MB')
    const button = row(panel, DAVEFX).querySelector('button')
    expect(button.textContent).toBe('Descargar')
    expect(button.getAttribute('aria-label')).toBe('Descargar la voz Davefx, Español (España) (63 MB)')
    expect(row(panel, DAVEFX).dataset.state).toBe('idle')
  })
  it('each row says its own size and the progress counts in the same decimal MB as the rows', async () => {
    const big = { id:'piper:es_ES-sharvard-medium', piperId:'es_ES-sharvard-medium', lang:'es-ES', name:'Sharvard', quality:'medium', sizeMB:77, speaker:0 }
    neuralVoices.push(big)
    try {
      const { panel, engine, experience } = await setup()
      expect(row(panel, LESSAC).textContent).toContain('63 MB')
      experience.chooseLanguage('es')
      expect(row(panel, big.id).textContent).toContain('77 MB')
      experience.chooseLanguage('')
      click(panel, LESSAC, 'install')
      engine.progress(LESSAC, .5)
      await vi.waitFor(() => expect(row(panel).querySelector('.reading-neural-percent').textContent).toBe('50 % · 32 de 63 MB'))
    } finally { neuralVoices.splice(neuralVoices.indexOf(big), 1) }
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
    expect(select(panel).options.map(option => option.value)).toContain(LESSAC)
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
    expect(row(panel).textContent).toContain('Sin espacio en el dispositivo.')
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
    expect(row(panel).textContent).toContain('Sin conexión.')
    expect(row(panel, ALBA).textContent).toContain('No se pudo descargar.')
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
    expect(select(panel).valueNode.textContent).toBe('Automática · Lessac')
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
  it('migrates a device selection to natural warm-up but never warms an uninstalled voice', async () => {
    vi.stubGlobal('InhouseSpeech', { speak:vi.fn(), stop:vi.fn(), getVoices:() => JSON.stringify([{ voiceURI:'en-sys', name:'en', lang:'en-US', quality:300, network:false, installed:true }]) })
    const { experience, engine } = await setup({ installed:[LESSAC] })
    experience.panel.showModal = vi.fn()
    await settle(); engine.warmed.length = 0 // setup() opened the book with 'Automática', which already warmed the installed neural voice
    experience.setPreference('voice', 'en-sys'); experience.show('audio'); await settle()
    expect(new Set(engine.warmed)).toEqual(new Set([LESSAC]))
    experience.voice.neuralOff = 'too-slow'; experience.setPreference('voice', LESSAC, { restart:false }); await settle()
    expect(new Set(engine.warmed)).toEqual(new Set([LESSAC])) // choosing it again is a new chance (retryNeural runs first)
    const second = await setup({ installed:[] })
    second.experience.panel.showModal = vi.fn()
    second.experience.show('audio'); await settle()
    expect(second.engine.warmed).toEqual([])
  })
})

describe('first-use offer', () => {
  it('offers the first download before playback and after missing-voice failure, without downloading automatically', async () => {
    const { panel, engine, experience } = await setup()
    expect(offer(panel).hidden).toBe(false)
    experience.voice.state = 'playing'; experience.neuralPicker.render()
    expect(offer(panel).hidden).toBe(false)
    expect(offer(panel).querySelector('.reading-neural-offer__title').textContent).toBe('Voz natural · 63 MB')
    expect([...offer(panel).querySelectorAll('button')].map(node => node.textContent)).toEqual(['Descargar', 'Ahora no'])
    expect(offer(panel).getAttribute('role')).toBe('group')
    expect(engine.installs).toEqual([])
    experience.voice.state = 'paused'; experience.neuralPicker.render(); expect(offer(panel).hidden).toBe(false)
    experience.voice.state = 'stopped'; experience.neuralPicker.render(); expect(offer(panel).hidden).toBe(false)
  })
  it('Ahora no hides it and is remembered for that language only', async () => {
    const { panel, experience } = await setup()
    experience.voice.state = 'playing'; experience.neuralPicker.render()
    offer(panel).querySelector('[data-neural-action="dismiss"]').click()
    expect(offer(panel).hidden).toBe(true)
    expect(JSON.parse(localStorage.getItem('inhouse-read-neural-offer-dismissed'))).toEqual({ en:expect.any(Number) })
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

describe('review fixes', () => {
  it('Reintentar after a synthesis failure starts the same selected natural voice without a device handover', async () => {
    const { panel,engine,experience }=await setup({ language:'es-ES',installed:[DAVEFX] })
    experience.setPreference('voice',DAVEFX)
    await experience.voice.play()
    for(let attempt=0;attempt<4;attempt++) engine.emit('error',engine.calls.at(-1).id,'synth-failed')
    expect(experience.voice.state).toBe('paused')
    expect(panel.querySelector('[data-neural-warning-text]').textContent).toContain('Pulsa Reintentar')
    const calls=engine.calls.length,text=engine.calls.at(-1).text
    panel.querySelector('[data-neural-retry]').click()
    await vi.waitFor(()=>expect(engine.calls).toHaveLength(calls+1))
    expect(engine.calls.at(-1)).toMatchObject({ voiceId:DAVEFX,text })
    expect(experience.voice.state).toBe('playing')
    expect(experience.preferences.voice).toBe(DAVEFX)
    expect(InhouseSpeech.speak).not.toHaveBeenCalled()
    experience.voice.stop()
  })
  it('a voice downloaded for another language than the book is installed but not pinned as the global choice', async () => {
    const { panel, engine, experience } = await setup({ language:'es-ES' })
    experience.reader.metadata = { language:'es-ES' } // a language the book declares itself
    experience.neuralPicker.install(LESSAC) // its row is not listed: the Idioma dropdown shows the book's language (Español)
    engine.finish(LESSAC)
    await vi.waitFor(() => expect(engine.installed.has(LESSAC)).toBe(true))
    expect(saved()).toBe('')
    expect(panel.querySelector('[data-neural-status]').textContent).toBe('Voz Lessac instalada.')
    // so an English book later still gets its own voice, and a Spanish one never the English voice
    expect(experience.voice.voiceFor('Hola.').voice?.id ?? '').not.toBe(LESSAC)
  })
  it('Quitar on the automatic natural voice pauses reading without choosing a device voice', async () => {
    const speak = vi.fn()
    vi.stubGlobal('InhouseSpeech', { speak, stop:vi.fn(), getVoices:() => JSON.stringify([{ voiceURI:'es-sys', name:'es', lang:'es-ES', quality:400, network:false, installed:true }]) })
    const { panel, engine, experience } = await setup({ language:'es-ES', installed:[DAVEFX] })
    await experience.voice.play()
    expect(engine.calls.at(-1)).toMatchObject({ voiceId:DAVEFX })
    expect(speak).not.toHaveBeenCalled()
    click(panel, DAVEFX, 'remove')
    await vi.waitFor(() => expect(engine.removed).toEqual([DAVEFX]))
    expect(speak).not.toHaveBeenCalled()
    expect(experience.voice.state).toBe('paused')
    expect(panel.querySelector('.reading-audio-status').textContent).toContain('Voz natural quitada')
    experience.voice.stop()
  })
  it('Quitar on the saved voice that is being read does the same, and goes back to Automática', async () => {
    const speak = vi.fn()
    vi.stubGlobal('InhouseSpeech', { speak, stop:vi.fn(), getVoices:() => JSON.stringify([{ voiceURI:'es-sys', name:'es', lang:'es-ES', quality:400, network:false, installed:true }]) })
    const { panel, engine, experience } = await setup({ language:'es-ES', installed:[DAVEFX] })
    experience.setPreference('voice', DAVEFX)
    await experience.voice.play()
    const calls = engine.calls.length
    click(panel, DAVEFX, 'remove')
    await vi.waitFor(() => expect(engine.removed).toEqual([DAVEFX]))
    expect(engine.calls).toHaveLength(calls) // not re-spoken with the voice that is going away
    expect(speak).not.toHaveBeenCalled()
    expect(experience.voice.state).toBe('paused')
    expect(saved()).toBe('')
    experience.voice.stop()
  })
  it('a progress tick updates the bar in place: the Cancelar being pressed is not replaced under the finger', async () => {
    const { panel, engine } = await setup()
    click(panel, LESSAC, 'install')
    const cancel = row(panel).querySelector('[data-neural-action="cancel"]'), list = panel.querySelector('[data-neural-list]')
    const item = row(panel)
    for (const fraction of [.2, .5, .8]) {
      engine.progress(LESSAC, fraction)
      await vi.waitFor(() => expect(row(panel).querySelector('[role="progressbar"]').getAttribute('aria-valuenow')).toBe(String(Math.round(fraction * 100))))
    }
    expect(row(panel)).toBe(item)
    expect(row(panel).querySelector('[data-neural-action="cancel"]')).toBe(cancel)
    expect(row(panel).querySelector('i').style.width).toBe('80%')
    engine.finish(LESSAC)
    await vi.waitFor(() => expect(row(panel).dataset.state).toBe('installed')) // a state change still rebuilds
    expect(list.contains(item)).toBe(false)
  })
  it('the offer card also updates its bar in place', async () => {
    const { panel, engine, experience } = await setup({ language:'es-MX' })
    experience.voice.state = 'playing'; experience.neuralPicker.render()
    offer(panel).querySelector('[data-neural-action="install"]').click()
    const cancel = offer(panel).querySelector('[data-neural-action="cancel"]')
    engine.progress('piper:es_MX-claude-high', .6)
    await vi.waitFor(() => expect(offer(panel).querySelector('[role="progressbar"]').getAttribute('aria-valuenow')).toBe('60'))
    expect(offer(panel).querySelector('[data-neural-action="cancel"]')).toBe(cancel)
  })
  it('the row of another speaker of a model downloading can cancel it (through the engine), and says why a download failed', async () => {
    const { panel, engine } = await setup()
    engine.cancel = vi.fn()
    engine.map.set(ALBA, { state:'downloading', fraction:.3, received:1, total:10 }) // a sibling speaker: the picker did not start it
    engine.emitChange()
    await vi.waitFor(() => expect(row(panel, ALBA).dataset.state).toBe('downloading'))
    click(panel, ALBA, 'cancel')
    expect(engine.cancel).toHaveBeenCalledWith(ALBA)
    engine.map.set(ALBA, { state:'error', fraction:0, received:0, total:0, error:'No hay conexión', code:'offline' })
    engine.emitChange()
    await vi.waitFor(() => expect(row(panel, ALBA).dataset.state).toBe('error'))
    expect(row(panel, ALBA).textContent).toContain('Sin conexión.')
  })
  it('opening a book warms the worker only for someone who has listened with a neural voice before; the audio tab always does', async () => {
    const { panel, engine, experience } = await setup({ installed:[LESSAC] })
    const picker = experience.neuralPicker
    const refresh = vi.spyOn(picker, 'refresh').mockImplementation(() => {})
    vi.stubGlobal('requestIdleCallback', undefined)
    vi.useFakeTimers()
    picker.warmed = false; picker.warm(); vi.advanceTimersByTime(3000)
    expect(refresh).toHaveBeenLastCalledWith({ warm:false })
    engine.status = 'speaking'; engine.dispatchEvent(new Event('status'))
    expect(localStorage.getItem('inhouse-read-neural-used')).toBe('1')
    picker.warmed = false; picker.warm(); vi.advanceTimersByTime(3000)
    expect(refresh).toHaveBeenLastCalledWith({ warm:true })
    vi.useRealTimers(); refresh.mockRestore()
    const warmUp = vi.spyOn(picker, 'warmUp').mockImplementation(() => {}) // (the engine's own warm-ups from the page opening are not what is measured)
    warmUp.mockClear()
    picker.attach(false); await new Promise(resolve => setTimeout(resolve, 20))
    expect(warmUp).not.toHaveBeenCalled()
    picker.attach(true)
    await vi.waitFor(() => expect(warmUp).toHaveBeenCalled())
  })
  it('Ahora no is not for ever: the offer comes back after a month', async () => {
    const { panel, experience } = await setup()
    experience.voice.state = 'playing'
    for (const [value, hidden] of [[Date.now() - 29 * 864e5, true], [Date.now() - 31 * 864e5, false], [true, true]]) {
      localStorage.setItem('inhouse-read-neural-offer-dismissed', JSON.stringify({ en:value }))
      experience.neuralPicker.render()
      expect(offer(panel).hidden).toBe(hidden)
    }
  })
  it('the offer is one plain row: name and size, Descargar and Ahora no, no marketing claims', async () => {
    const { panel, experience } = await setup()
    experience.voice.state = 'playing'; experience.neuralPicker.render()
    expect(offer(panel).textContent).toBe('Voz natural · 63 MBDescargarAhora no')
    expect(offer(panel).textContent).not.toContain('Suena más natural')
  })
})
