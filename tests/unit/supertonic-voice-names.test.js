import { describe, expect, it } from 'vitest';
import { SUPERTONIC_LANGUAGES, SUPERTONIC_STYLES, SUPERTONIC_VOICE_NAMES, supertonicVoicesFor } from '../../src/js/readers/neural-voice/supertonic-catalog.js';
import { languageName, normalizeNeuralVoice } from '../../src/js/readers/voice-catalog.js';

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
});
