# Phonemizer for the on-device neural voices

Files here are shipped as they are (`public/` is copied to `dist/neural-voice/phon/`) and loaded by the synthesis worker
(`src/js/readers/neural-voice/phonemizer.js`). They turn text into the phoneme ids a Piper voice expects.

| File | What it is | Size |
| --- | --- | --- |
| `piper_phonemize.wasm` | the `piper-phonemize` C++ program compiled with Emscripten (statically links espeak-ng), **byte for byte** as published | 629 KB |
| `piper_phonemize.data` | the espeak-ng data package, **trimmed** to the dictionaries of the languages we offer: es, en, fr, de, it, pt, ca, nl, pl, tr, cs, sv, da, fi, ro, hu (plus every non-dictionary file: voices, phoneme tables) | 2.2 MB (18 MB untrimmed) |
| `piper_phonemize.mjs` | only the Emscripten JavaScript glue of the same package, exported as a factory (see below) | 107 KB |

## Provenance

* Source package: [`piper-tts-web` 1.1.2](https://www.npmjs.com/package/piper-tts-web) by Jonas Plamann (MIT), files
  `dist/piper/piper_phonemize.{wasm,data}` and `dist/worker/PhonemizeWebWorker.js`. Those are builds of
  [rhasspy/piper-phonemize](https://github.com/rhasspy/piper-phonemize) (MIT) and [espeak-ng](https://github.com/espeak-ng/espeak-ng).
* `piper_phonemize.mjs` is the Emscripten glue taken out of `PhonemizeWebWorker.js`: the package's own worker/message
  wrapper is cut away and the factory is exported instead; our own small wrapper replaces it. The file table inside
  it is rewritten to match the trimmed `.data`.
* Rebuild everything with `node scripts/trim-espeak-data.mjs <path of the piper-tts-web package> public/neural-voice/phon`
  (every pattern is checked, the script fails if the package changes shape). To offer another language, add it to the
  language list of the script, run it again and add the voice to `src/js/readers/neural-voice/catalog.js`.
* The trimmed data was verified to give the same phoneme ids as the untrimmed package for the sentences tried in the
  spikes (es, en, fr, de, it, pt, ca), and the first seven languages' voices were synthesised with it. The later nine (nl, pl, tr, cs, sv, da, fi, ro, hu) were added without network access to the voice files: their dictionaries are in the pack, their voices are untested end to end. Russian (an 8 MB dictionary) and Ukrainian are not included.

## Licences (the repository and the site are public: read before changing anything here)

* **espeak-ng is GPL-3.0-or-later.** `piper_phonemize.wasm` and `.data` contain it, and they are distributed with the site
  (this repository is public and GitHub Pages serves these very files), so the GPL applies to them:
  * the licence text is next to the files: [`COPYING`](COPYING) (GPL-3.0);
  * the corresponding source is public: [espeak-ng](https://github.com/espeak-ng/espeak-ng) (the data is its `espeak-ng-data`,
    trimmed by `scripts/trim-espeak-data.mjs`) and [rhasspy/piper-phonemize](https://github.com/rhasspy/piper-phonemize)
    (the program that statically links it; MIT). The build recipe is the one of [piper-tts-web](https://www.npmjs.com/package/piper-tts-web) 1.1.2 (MIT), named above;
  * the rest of the app only talks to that program through its command line (text in, phoneme ids out), as the Piper
    project itself does.
  Keep these notes and `COPYING` with the files if they are ever moved.
* **Each Piper voice has its own dataset licence**, stated in the model card of the voice on Hugging Face
  (`rhasspy/piper-voices`, the `MODEL_CARD` next to every voice). The voices are *not* part of this repository: they are
  downloaded by the user, on demand, from Hugging Face, so they are not redistributed from here. The catalogue
  (`src/js/readers/neural-voice/catalog.js`) lists the voices used (Piper models `es_MX-claude-high`, `es_ES-davefx-medium`,
  `es_ES-sharvard-medium`, `en_US-lessac-medium`, `en_GB-alba-medium`, `fr_FR-siwis-medium`, `de_DE-thorsten-medium`,
  `it_IT-paola-medium`, `pt_BR-faber-medium`, `ca_ES-upc_ona-medium`); credit for each belongs to the author of its dataset,
  named in its model card. Check the card of a voice before using it outside a personal setting (several datasets are
  CC-BY, CC-BY-SA or non-commercial).
* onnxruntime-web (MIT) is copied to `dist/neural-voice/ort/` at build time by `scripts/neural-voice-assets.mjs`.
