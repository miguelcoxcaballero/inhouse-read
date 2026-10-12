import {notifyCloudSettingsChanged} from '../cloud-settings.js'
import {normalizeReadingPreferences,READING_THEMES} from './reading-preferences.js'
const STORAGE_KEY='inhouse-read-reading-preferences'
export const legacyPreferenceFlow={
  setPreference(key, value, { restart = true } = {}) {
    const audio = ['rate','voice','voiceLang','footnotes','multilingual','skipHeaders'].includes(key)
    if (!audio) this.voice.stop()
    this.preferences = normalizeReadingPreferences({ ...this.preferences, [key]:value }); this.applyPreferences(!audio); notifyCloudSettingsChanged(STORAGE_KEY)
    this.voice.options = {footnotes:this.preferences.footnotes,multilingual:this.preferences.multilingual,skipHeaders:this.preferences.skipHeaders}
    if (key === 'rate' || key === 'voice' || key === 'voiceLang') { this.voice.retryNeural?.(); if (restart) this.voice.restart?.() } // a new speed or choice gives a neural voice another chance
    if (audio) this.neuralPicker?.warmUp()
  }
  ,async applyPreferences(updateBook = true) {
    const p = this.preferences
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(p)) } catch { /* reading still works without storage */ }
    const theme = READING_THEMES[p.theme]
    this.view.applyPreferences(p,theme,this.reader.format?.engine === 'pdf')
    this.voice.rate = p.rate; this.voice.voice = p.voice; this.voice.languageOverride = p.voiceLang
    this.neuralPicker?.render()
    this.voice.options = {footnotes:p.footnotes,multilingual:p.multilingual,skipHeaders:p.skipHeaders}
    this.updateMiniPlayer()
    try { if (updateBook) await this.reader.applyPreferences(p) } catch { this.error('No se pudo aplicar.') }
  }
}
