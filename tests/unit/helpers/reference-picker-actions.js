import {neuralEngine,neuralVoiceList} from '../../../src/js/readers/neural-runtime.js'
import {declaredLanguage,langBase,isNeuralId} from '../../../src/js/readers/voice-catalog.js'
export const DOWNLOAD_ERRORS={offline:'Sin conexión.',storage:'Sin espacio en el dispositivo.',default:'No se pudo descargar.'}
export class LegacyActions {click(event) {
    const target = event.target.closest?.('[data-neural-action]')
    if (!target) return
    const { neuralAction:action, neuralId:id } = target.dataset
    if (action === 'install') this.install(id)
    else if (action === 'cancel') this.cancel(id)
    else if (action === 'use') this.use(id)
    else if (action === 'remove') this.remove(id)
    else if (action === 'dismiss') this.dismiss()
  }
cancel(id) {
    this.tasks.get(id)?.abort()
    try { neuralEngine()?.cancel?.(id) } catch { /* the controller above already did it */ }
  }
voiceName(id) { return neuralVoiceList().find(voice => voice.id === id)?.name || 'natural' }
async install(id) {
    const engine = neuralEngine()
    if (!engine || this.tasks.has(id) || !isNeuralId(id)) return
    try { engine.unlock?.({ playback:false }) } catch { /* the play tap unlocks audio again */ }
    const controller = new AbortController(), name = this.voiceName(id)
    this.tasks.set(id, controller); this.errors.delete(id)
    this.announce(`Descargando ${name}.`)
    let task
    try { task = engine.install(id, { signal:controller.signal }) } catch (error) { task = Promise.reject(error) }
    this.render()
    try {
      await task
      this.tasks.delete(id)
      // Selected only for the language of the book being read: the saved voice is global, so a Spanish voice picked while
      // reading a Spanish book must not become the voice of an English one ('Automática' already prefers an installed
      // neural voice of each book's language, so nothing is lost).
      const declared = declaredLanguage(this.host.reader) // a book that declares no language (a PDF) takes it: the device language says nothing about it
      // A language picked in the Idioma dropdown is an explicit choice: its voices are selected whatever the book declares.
      const base = langBase(neuralVoiceList().find(voice => voice.id === id)?.lang), picked = this.host.preferences.voiceLang
      const here = picked ? base === picked : !declared || base === langBase(declared)
      this.announce(here ? `Voz ${name} instalada y seleccionada.` : `Voz ${name} instalada.`)
      if (here) this.host.setPreference('voice', id, { restart:false }) // the next fragment is already spoken with it
      this.host.populateVoices()
    } catch (error) {
      this.tasks.delete(id)
      if (error?.code === 'aborted' || controller.signal.aborted) this.announce('Descarga cancelada.')
      else { const message = DOWNLOAD_ERRORS[error?.code] || DOWNLOAD_ERRORS.default; this.errors.set(id, message); this.announce(`No se pudo descargar ${name}. ${message}`) }
      this.render()
    }
  }
use(id) {
    try { neuralEngine()?.unlock?.({ playback:false }) } catch { /* see install() */ }
    this.host.setPreference('voice', id)
    this.announce(`Voz ${this.voiceName(id)} seleccionada.`)
    this.host.populateVoices()
  }
async remove(id) {
    const engine = neuralEngine(), name = this.voiceName(id)
    if (!engine) return
    const list = neuralVoiceList(), voice = list.find(voice => voice.id === id)
    const removed = voice?.sharedPack ? list.filter(other => other.modelKey === voice.modelKey).map(other => other.id) : [id]
    // The saved choice goes first, then the reading in progress is told the voice is gone (it moves on to another voice at once,
    // also when the voice was only the automatic pick), so nothing keeps using it while its files disappear.
    if (removed.includes(this.host.preferences.voice)) this.host.setPreference('voice', '', { restart:false })
    for (const removedId of removed) this.host.voice?.voiceRemoved?.(removedId)
    try { await engine.remove(id) } catch { /* nothing else to clean up */ }
    this.errors.delete(id)
    this.announce(voice?.sharedPack ? 'Paquete compartido Supertonic quitado.' : `Voz ${name} quitada.`)
    this.host.populateVoices()
  }}
