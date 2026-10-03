# Phonemizer for the on-device neural voices

Files here are shipped as they are (`public/` is copied to `dist/neural-voice/phon/`) and loaded by the synthesis worker
(`src/js/readers/neural-voice/phonemizer.js`). They turn text into the phoneme ids a Piper voice expects.

The current catalogue offers **36 selectable voices from 33 models in 27 base languages**. Models with multiple speakers
share their weights. These counts describe the implementation; the expanded real-audio and complete CI verification is
tracked in [remaining-wip-verification.md](../../../docs/remaining-wip-verification.md).

| File | What it is | Size |
| --- | --- | --- |
| `piper_phonemize.wasm` | the `piper-phonemize` C++ program compiled with Emscripten (statically links espeak-ng), **byte for byte** as published | 629,166 bytes |
| `piper_phonemize.data` | the espeak-ng data package, **trimmed** to ca, cs, da, de, en, es, fi, fr, hu, it, nl, pl, pt, ro, sv, tr (plus every non-dictionary file: voices, phoneme tables) | 2,232,748 bytes (18 MB untrimmed) |
| `dict/<lang>_dict` | 19 separate dictionary copies, byte for byte as in the package: nl, pl, ru, uk, tr, sv, da, no, fi, cs, el, hu, ro, ar, cmn, vi, bg, sr, hi | 11,734,558 bytes in all |
| `piper_phonemize.mjs` | only the Emscripten JavaScript glue of the same package, exported as a factory (see below) | 109,336 bytes |

## Dictionary installation and offline reuse

The wrapper checks the Emscripten filesystem before creating a dictionary. A dictionary already embedded in `.data`,
including Dutch, is reused; creating it twice would throw EEXIST. The 19 exported copies therefore do not mean 19 extra
downloads for every voice.

For a config requiring a dictionary outside the pack (ar, bg, cmn, el, hi, no, ru, sr, uk or vi), installing the voice also
fetches that dictionary. `dictionary-cache.js` checks its exact length and SHA-256 and stores it in the shared
`inhouse-neural-dictionaries-v1` Cache Storage cache. Installation and worker playback use the same URL/cache, so a new
worker can load the dictionary without a network request. Download progress includes the required dictionary bytes;
the voice installation finishes only after they have been saved. A corrupt or incomplete dictionary is rejected.

The worker writes the verified bytes into `/espeak-ng-data` only when absent and retains an in-memory copy across its
periodic Emscripten rebuilds. Norwegian `nb`/`nn` maps to `no`; Mandarin `zh` maps to `cmn`. Resource URLs use the
`20261002-dictionaries` revision to keep the glue, filesystem table and data pack consistent in cached sessions.

## Hebrew auxiliary model

`he_IL-saspeech-medium` uses Hebrew phonemization rather than an espeak dictionary. Installation also downloads
`nakdimon.onnx` (21,312,753 bytes), verifies SHA-256
`9ff491dcc7d66392019d427a98b97d5de10c0d721628ae740858174ae22b190e`, and saves it with the voice. Installed detection
requires model, config and auxiliary; removing the voice also removes the auxiliary. The worker restores niqqud with
Nakdimon, applies the Piper Hebrew-to-IPA rules, and maps the result through the voice config's phoneme ids.

The auxiliary source is pinned to OHF-Voice/piper1-gpl revision `efffbfb226bfb511ebbcf55d0cecd8b35a89743d`.
The source attribution and MIT/GPL notices are retained in [hebrew-NOTICE.txt](../hebrew-NOTICE.txt) and [COPYING](COPYING).

## Provenance

* Source package: [`piper-tts-web` 1.1.2](https://www.npmjs.com/package/piper-tts-web) by Jonas Plamann (MIT), files
  `dist/piper/piper_phonemize.{wasm,data}` and `dist/worker/PhonemizeWebWorker.js`. Those are builds of
  [rhasspy/piper-phonemize](https://github.com/rhasspy/piper-phonemize) (MIT) and [espeak-ng](https://github.com/espeak-ng/espeak-ng).
* `piper_phonemize.mjs` is the Emscripten glue taken out of `PhonemizeWebWorker.js`: the package's own worker/message
  wrapper is cut away and the factory is exported instead; our own small wrapper replaces it. `FS_analyzePath` is exported so a packaged dictionary is never created twice. The file table inside
  it is rewritten to match the trimmed `.data`.
* Rebuild this pack with `node scripts/trim-espeak-data.mjs <path of the piper-tts-web package> public/neural-voice/phon`.
  Its defaults preserve the 16 packaged dictionaries and export the 19 copies listed above. Every pattern is checked;
  the script fails if the package changes shape. To offer another espeak language, update the script's extra list,
  `EXTRA_DICTIONARIES` in `src/js/readers/neural-voice/phonemizer.js`, and the verified descriptor in
  `dictionary-cache.js`; regenerate the files and add the real model and synthesis case. A language already inside
  `.data` needs no extra dictionary download.
* The trimmed data was verified to give the same phoneme ids as the untrimmed package for the sentences tried in the
  spikes (es, en, fr, de, it, pt, ca). `tests/e2e/neural-voice-languages.spec.mjs` now has 36 real-weight cases covering
  every catalogue model and speaker. The expanded synthesis/offline verification is still in progress; the historical
  spike results do not establish that all current voices have passed.
* Test fixtures are prepared by `scripts/prepare-neural-fixtures.mjs`: by default all 33 catalogue models, plus Nakdimon,
  with file verification and pinned source revisions. Serbian Marko comes from the author's
  `phantom9623/piper-serbian-tts` revision `a71694f9ec3480f132dffaf7eb422d43aebd69e0`; the similarly named model in
  the general catalogue is Sorbian. Portuguese from Portugal, Bulgarian, Hindi and Hebrew are also present in the
  current catalogue; Turkish uses `tr_TR-dfki-medium`.

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
  `it_IT-paola-medium`, `pt_BR-faber-medium`, `ca_ES-upc_ona-medium`, and the voices of the later languages: see the table in the catalogue); credit for each belongs to the author of its dataset,
  named in its model card. Check the card of a voice before using it outside a personal setting (several datasets are
  CC-BY, CC-BY-SA or non-commercial).
* onnxruntime-web (MIT) is copied to `dist/neural-voice/ort/` at build time by `scripts/neural-voice-assets.mjs`.
