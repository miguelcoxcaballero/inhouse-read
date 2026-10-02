// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { neuralVoices, voiceUrls, piperPath, recommendedVoice, modelsOf, DEFAULT_VOICE_BASE } from '../../src/js/readers/neural-voice/catalog.js'
import { detectLanguage, normalizeNeuralVoice, resolveVoice, languageName, langBase, orderNeuralVoices, recommendedNeuralFor } from '../../src/js/readers/voice-catalog.js'

// The languages added after es/en/fr/de/it/pt/ca: the Piper voice picked for each, and a few sentences of ordinary prose.
const ADDED = {
  nl: { voice: 'nl_NL-pim-medium', region: 'NL', text: ['De kinderen zijn met hun moeder naar het bos gegaan en ze hebben daar gespeeld.', 'Ik weet niet wat je van mij wilt, maar het is al laat.', 'Niemand in het dorp wist wanneer de vreemdeling was aangekomen.'] },
  pl: { voice: 'pl_PL-gosia-medium', region: 'PL', text: ['Dzieci poszły z matką do lasu i tam się bawiły.', 'Nie wiem, czego ode mnie chcesz, ale jest już późno.', 'Nikt we wsi nie pamiętał, kiedy przybył nieznajomy.'] },
  ru: { voice: 'ru_RU-irina-medium', region: 'RU', text: ['Дети пошли с матерью в лес и играли там.', 'Дождь тихо стучал в окна старой библиотеки.'] },
  uk: { voice: 'uk_UA-ukrainian_tts-medium', region: 'UA', text: ['Діти пішли з матір’ю до лісу і гралися там.', 'Дощ тихо стукав у вікна старої бібліотеки, і ґанок був мокрий.'] },
  tr: { voice: 'tr_TR-dfki-medium', region: 'TR', text: ['Çocuklar annesiyle birlikte ormana gitti ve orada oynadı.', 'Ne istediğimi bilmiyorum ama artık çok geç oldu.', 'Köyde kimse yabancının ne zaman geldiğini hatırlamıyordu.'] },
  sv: { voice: 'sv_SE-nst-medium', region: 'SE', text: ['Barnen gick med sin mamma till skogen och lekte där.', 'Jag vet inte vad du vill av mig, men det är redan sent.', 'Ingen i byn mindes när främlingen hade kommit.'] },
  da: { voice: 'da_DK-talesyntese-medium', region: 'DK', text: ['Børnene gik med deres mor i skoven og legede der.', 'Jeg ved ikke, hvad du vil have af mig, men det er allerede sent.', 'Ingen i landsbyen kunne huske, hvornår den fremmede var kommet.'] },
  nb: { voice: 'no_NO-talesyntese-medium', region: 'NO', text: ['Barna gikk med moren sin til skogen og lekte der.', 'Jeg vet ikke hva du vil ha fra meg, men det er allerede sent.', 'Ingen i landsbyen husket når den fremmede var kommet.'] },
  fi: { voice: 'fi_FI-harri-medium', region: 'FI', text: ['Lapset menivät äitinsä kanssa metsään ja leikkivät siellä.', 'En tiedä mitä minusta haluat, mutta on jo myöhä.', 'Kukaan kylässä ei muistanut, milloin muukalainen oli saapunut.'] },
  cs: { voice: 'cs_CZ-jirka-medium', region: 'CZ', text: ['Děti šly s matkou do lesa a hrály si tam.', 'Nevím, co ode mě chceš, ale už je pozdě.', 'Nikdo ve vsi si nepamatoval, kdy cizinec přijel.'] },
  el: { voice: 'el_GR-rapunzelina-low', region: 'GR', text: ['Τα παιδιά πήγαν με τη μητέρα τους στο δάσος και έπαιξαν εκεί.', 'Η βροχή χτυπούσε απαλά τα παράθυρα της παλιάς βιβλιοθήκης.'] },
  hu: { voice: 'hu_HU-anna-medium', region: 'HU', text: ['A gyerekek az anyjukkal elmentek az erdőbe, és ott játszottak.', 'Nem tudom, mit akarsz tőlem, de már késő van.', 'A faluban senki sem emlékezett rá, mikor érkezett az idegen.'] },
  ro: { voice: 'ro_RO-mihai-medium', region: 'RO', text: ['Copiii au mers cu mama lor în pădure și s-au jucat acolo.', 'Nu știu ce vrei de la mine, dar este deja târziu.', 'Nimeni din sat nu-și amintea când sosise străinul.'] },
  ar: { voice: 'ar_JO-kareem-medium', region: 'SA', text: ['ذهب الأطفال مع أمهم إلى الغابة ولعبوا هناك.', 'كانت الأمطار تطرق نوافذ المكتبة القديمة بهدوء.'] },
  zh: { voice: 'zh_CN-huayan-medium', region: 'CN', text: ['孩子们和妈妈一起去了森林，在那里玩耍。', '村里没有人记得陌生人是什么时候来的。'] },
  vi: { voice: 'vi_VN-vais1000-medium', region: 'VN', text: ['Mưa nhẹ nhàng gõ vào cửa sổ của thư viện cũ.', 'Không ai trong làng nhớ người lạ đã đến từ khi nào.'] }
}
const SPANISH = 'Los niños salieron a jugar con una pelota en el parque.'

describe('catalogue of the added languages', () => {
  it('has one recommended voice per language, with the Piper model the language is tested with', () => {
    for (const [language, { voice }] of Object.entries(ADDED)) {
      const ofLanguage = neuralVoices.filter(v => v.lang.split('-')[0] === language)
      expect(ofLanguage.length, language).toBeGreaterThan(0)
      expect(ofLanguage.filter(v => v.recommended), language).toHaveLength(1)
      expect(recommendedVoice(language).piperId).toBe(voice)
    }
  })
  it('lists the Ukrainian model once per speaker (they share one download) and every model is a plain onnx of 60-80 MB (the two high-quality ones about 114 MB)', () => {
    const ukrainian = neuralVoices.filter(v => v.lang === 'uk-UA')
    expect(ukrainian.map(v => [v.id, v.speaker, v.name])).toEqual([['piper:uk_UA-ukrainian_tts-medium', 0, 'Lada'], ['piper:uk_UA-ukrainian_tts-medium#1', 1, 'Mykyta'], ['piper:uk_UA-ukrainian_tts-medium#2', 2, 'Tetiana']])
    for (const [piperId, voices] of modelsOf(neuralVoices)) { expect(voices[0].sizeMB, piperId).toBeGreaterThanOrEqual(60); expect(voices[0].sizeMB, piperId).toBeLessThanOrEqual(piperId === 'he_IL-saspeech-medium' ? 85 : voices[0].quality === 'high' ? 120 : 80) }
  })
  it('builds the Hugging Face paths of the new voices (Norwegian lives under no/, not nb/)', () => {
    expect(piperPath('no_NO-talesyntese-medium')).toBe('no/no_NO/talesyntese/medium/no_NO-talesyntese-medium')
    expect(voiceUrls('ru_RU-irina-medium', DEFAULT_VOICE_BASE).model).toBe('https://huggingface.co/rhasspy/piper-voices/resolve/main/ru/ru_RU/irina/medium/ru_RU-irina-medium.onnx')
    expect(voiceUrls('el_GR-rapunzelina-low', DEFAULT_VOICE_BASE).config).toBe('https://huggingface.co/rhasspy/piper-voices/resolve/main/el/el_GR/rapunzelina/low/el_GR-rapunzelina-low.onnx.json')
    expect(voiceUrls('es_AR-daniela-high', DEFAULT_VOICE_BASE).key).toBe('es/es_AR/daniela/high/es_AR-daniela-high.onnx')
  })
  it('offers Argentine Spanish for es-AR and keeps Claude as the default of plain Spanish and es-MX', () => {
    expect(recommendedVoice('es-AR').piperId).toBe('es_AR-daniela-high')
    expect(recommendedVoice('es-MX').piperId).toBe('es_MX-claude-high')
    expect(recommendedVoice('es').piperId).toBe('es_MX-claude-high')
    expect(recommendedVoice('en-GB').lang).toBe('en-GB')
  })
  it('names the languages in Spanish and lists them after the first seven in the picker', () => {
    expect(['nl', 'pl', 'ru', 'uk', 'tr', 'sv', 'da', 'nb', 'fi', 'cs', 'el', 'hu', 'ro', 'ar', 'zh', 'vi'].map(languageName)).toEqual(['Neerlandés', 'Polaco', 'Ruso', 'Ucraniano', 'Turco', 'Sueco', 'Danés', 'Noruego', 'Finés', 'Checo', 'Griego', 'Húngaro', 'Rumano', 'Árabe', 'Chino', 'Vietnamita'])
    expect(languageName('es-AR')).toBe('Español (Argentina)')
    const voices = neuralVoices.map(entry => normalizeNeuralVoice(entry))
    const order = [...new Set(orderNeuralVoices(voices, { bookLang: 'es-ES', deviceLang: 'es-ES' }).map(v => v.base))]
    expect(order.slice(0, 7)).toEqual(['es', 'en', 'fr', 'de', 'it', 'pt', 'ca'])
    expect(order).toHaveLength(27)
    expect(recommendedNeuralFor(voices, 'no').id).toBe('piper:no_NO-talesyntese-medium') // a book that says "no" (Norwegian) gets the Bokmål voice
  })
})

describe('detection of the added languages', () => {
  const cases = Object.entries(ADDED).flatMap(([language, { text, region }]) => text.map(sentence => [language, region, sentence]))
  it.each(cases)('%s (%s): %s', (language, region, sentence) => {
    expect(detectLanguage(sentence, 'xx-XX')).toBe(`${language}-${region}`)
    expect(detectLanguage(sentence, 'es-ES'), 'against a Spanish book').toBe(`${language}-${region}`)
  })
  it.each(cases)('%s keeps the region of a book written in it: %s', (language, region, sentence) => {
    expect(detectLanguage(sentence, `${language}-ZZ`)).toBe(`${language}-ZZ`)
  })
  it('does not turn Spanish, English or Portuguese text into one of the new languages', () => {
    expect(detectLanguage(SPANISH, 'xx-XX')).toBe('es-ES')
    expect(detectLanguage('The old man was sitting by the window and she was not there.', 'xx-XX')).toBe('en-US')
    expect(detectLanguage('Os homens da aldeia foram à festa e não voltaram.', 'xx-XX')).toBe('pt-PT')
    expect(detectLanguage('Capítulo 3', 'es-ES')).toBe('es-ES')
  })
  it('tells Ukrainian from Russian by the letters only Ukrainian uses, and Japanese from Chinese by kana', () => {
    expect(detectLanguage('Я не знаю, чого ти від мене хочеш, але вже пізно.', 'ru-RU')).toBe('uk-UA')
    expect(detectLanguage('Я не знаю, чего ты от меня хочешь, но уже поздно.', 'uk-UA')).toBe('ru-RU')
    expect(detectLanguage('子供たちは母親と一緒に森へ行きました。', 'zh-CN')).toBe('ja-JP')
  })
  it('a foreign name or quote inside a sentence does not change the language, a mostly foreign text does', () => {
    expect(detectLanguage('Ella le dijo a su madre: «Привет», y se fue a la casa de la abuela.', 'es-ES')).toBe('es-ES')
    expect(detectLanguage('Привет, как дела? Все хорошо.', 'es-ES')).toBe('ru-RU')
  })
})

describe('multilingual reading picks the right neural voice per chunk', () => {
  const installed = neuralVoices.map(entry => normalizeNeuralVoice(entry, neuralVoices.filter(v => ['es', 'ru', 'nl', 'zh', 'nb'].includes(v.lang.split('-')[0]) || v.lang === 'en-US').map(v => v.id)))
  const pick = (text, voiceId = 'piper:es_MX-claude-high') => resolveVoice(installed, { voiceId, language: detectLanguage(text, 'es-ES'), multilingual: true, deviceLang: 'es-ES' }).voiceId
  it('uses the voice of the language of each chunk, and the chosen voice for its own language', () => {
    expect(pick(SPANISH)).toBe('piper:es_MX-claude-high')
    expect(pick('Дождь тихо стучал в окна старой библиотеки.')).toBe('piper:ru_RU-irina-medium')
    expect(pick('Niemand in het dorp wist wanneer de vreemdeling was aangekomen.')).toBe('piper:nl_NL-pim-medium')
    expect(pick('村里没有人记得陌生人是什么时候来的。')).toBe('piper:zh_CN-huayan-medium')
    expect(pick('Ingen i landsbyen husket når den fremmede var kommet.')).toBe('piper:no_NO-talesyntese-medium')
    expect(pick('The rain tapped softly on the windows of the old library and nobody was there.')).toBe('piper:en_US-lessac-medium')
  })
  it('a language whose voice is not installed leaves the choice to another voice instead of a wrong one', () => {
    expect(pick('Deszcz cicho stukał w okna starej biblioteki.')).toBe('')
    expect(langBase(detectLanguage('Deszcz cicho stukał w okna starej biblioteki.', 'es-ES'))).toBe('pl')
  })
})
