// The language tags of the reader. They are read before the reader (and rust-ui) loads, when the saved preferences are
// normalised, so they stay here. Everything else the reader knows about the on-device neural voices (Piper and
// Supertonic, see neural-voice/) is rust-ui: the record of a voice (voice_catalog.rs), which ids are ours, the language
// a book declares, the voice that speaks a text, the Spanish names of languages and regions, the order of the picker's
// list and the language of a text (catalog_doors.rs). Nothing calls a cloud TTS: "free and unlimited" means we only
// choose among on-device voices. The frozen JavaScript original, with the ranking of the device's own voices that the
// reader stopped using, is tests/unit/helpers/reference-voice-catalog.js.

const ISO3 = { spa:'es', eng:'en', fra:'fr', fre:'fr', deu:'de', ger:'de', ita:'it', por:'pt', cat:'ca', glg:'gl', nld:'nl', dut:'nl', rus:'ru', jpn:'ja', zho:'zh', chi:'zh', kor:'ko', pol:'pl', ukr:'uk', tur:'tr', swe:'sv', dan:'da', nob:'nb', nor:'nb', no:'nb', fin:'fi', ces:'cs', cze:'cs', ell:'el', gre:'el', hun:'hu', ron:'ro', rum:'ro', ara:'ar', vie:'vi', hin:'hi', heb:'he', tha:'th', iw:'he', bul:'bg', srp:'sr' }

/** 'es_ES', 'spa-ESP', 'ES-es' -> 'es-ES' (language lower-case, region upper-case). */
export function normalizeLang(tag) {
  const parts = String(tag || '').trim().replace(/_/g, '-').split('-').filter(Boolean)
  if (!parts.length) return ''
  let language = parts[0].toLowerCase()
  language = ISO3[language] || language
  const region = parts.slice(1).find(part => /^[a-z]{2}$/i.test(part) || /^\d{3}$/.test(part))
  return region ? `${language}-${region.toUpperCase()}` : language
}
export const langBase = tag => normalizeLang(tag).split('-')[0]
