import { describe, expect, it } from 'vitest';
import { SUPERTONIC_LANGUAGES, SUPERTONIC_STYLES, SUPERTONIC_VOICE_NAMES, supertonicVoicesFor } from '../../src/js/readers/neural-voice/supertonic-catalog.js';
import { neuralVoices } from '../../src/js/readers/neural-voice/catalog.js';
import { languageName, normalizeNeuralVoice, orderNeuralVoices } from '../../src/js/readers/voice-catalog.js';

describe('Supertonic voice names', () => {
  it('names every profile of every language, with no "Supertonic" label and no repeats in a language', () => {
    for (const lang of SUPERTONIC_LANGUAGES) {
      const voices = supertonicVoicesFor([lang]);
      expect(voices).toHaveLength(SUPERTONIC_STYLES.length);
      const names = voices.map(voice => voice.name);
      expect(names.some(name => name.startsWith('Supertonic'))).toBe(false);
      expect(new Set(names).size).toBe(names.length);
      expect(SUPERTONIC_VOICE_NAMES[lang].dialect.split('-')[0]).toBe(lang);
    }
  });

  it('keeps the id and the model language, and shows the dialect like a Piper voice', () => {
    const [lucia] = supertonicVoicesFor(['es']);
    expect(lucia).toMatchObject({ id:'supertonic3:F1:es', lang:'es', style:'F1', name:'Lucía', dialect:'es-ES' });
    const voice = normalizeNeuralVoice(lucia);
    expect(voice.base).toBe('es');
    expect(languageName(voice.lang)).toBe('Español (España)');
    const [, javier] = supertonicVoicesFor(['es']);
    expect(javier).toMatchObject({ style:'M1', name:'Javier' });
  });
  it('lists named Spanish profiles in the exact current picker order without losing any voice', () => {
    const catalog = neuralVoices.map(voice => normalizeNeuralVoice(voice));
    const ordered = orderNeuralVoices(catalog, { bookLang:'es', deviceLang:'en-US' });
    expect(ordered.slice(0, 5).map(voice => voice.id)).toEqual([
      'piper:es_MX-claude-high', 'piper:es_AR-daniela-high',
      'supertonic3:M4:es', 'supertonic3:F2:es', 'piper:es_ES-davefx-medium'
    ]);
    expect(new Set(ordered.map(voice => voice.id))).toEqual(new Set(catalog.map(voice => voice.id)));
    expect(ordered.filter(voice => voice.base === 'es').length).toBe(catalog.filter(voice => voice.base === 'es').length);
  });

});
