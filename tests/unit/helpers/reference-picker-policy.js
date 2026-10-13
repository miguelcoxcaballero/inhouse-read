import {langBase,recommendedNeuralFor} from '../../../src/js/readers/voice-catalog.js'
const OFFER_KEY='inhouse-read-neural-offer-dismissed',OFFER_SNOOZE_DAYS=30
export const DOWNLOAD_ERRORS={offline:'Sin conexión.',storage:'Sin espacio en el dispositivo.',default:'No se pudo descargar.'}
export class LegacyPolicy {state(engine, voice) {
    const download = engine.downloads?.get(voice.id)
    if (engine.installed.has(voice.id)) return { name:'installed' }
    if (this.tasks.has(voice.id) || download?.state === 'downloading') return { name:'downloading', download }
    if (this.errors.has(voice.id) || download?.state === 'error') return { name:'error', message:this.errors.get(voice.id) || DOWNLOAD_ERRORS[download?.code] || DOWNLOAD_ERRORS.default }
    return { name:'idle' }
  }
dismissed() { try { return JSON.parse(localStorage.getItem(OFFER_KEY) || '{}') || {} } catch { return {} } }
snoozed(base) {
    const at = this.dismissed()[base]
    return at === true || (Number(at) > 0 && Date.now() - Number(at) < OFFER_SNOOZE_DAYS * 864e5)
  }
dismiss() {
    const base = langBase(this.bookLang)
    try { localStorage.setItem(OFFER_KEY, JSON.stringify({ ...this.dismissed(), [base]:Date.now() })) } catch { /* it just asks again next time */ }
    this.render()
  }
offerFor(engine, list) {
    const base = langBase(this.bookLang)
    if (!engine || !base || !this.host.voice || this.snoozed(base)) return null
    if (list.some(voice => voice.base === base && engine.installed.has(voice.id))) return null
    return recommendedNeuralFor(list, this.bookLang, navigator.language)
  }
renderOffer(engine, list) {
    const voice = this.offerFor(engine, list)
    this.view.renderOffer(voice,voice ? this.state(engine,voice) : null)
  }}
