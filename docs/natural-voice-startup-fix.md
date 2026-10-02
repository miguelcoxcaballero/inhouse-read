# Natural voice startup — 1.7.5

The user's Android recording shows automatic Pim in Dutch at 1.1× falling back before its first fragment. The failure reproduced with the actual `nl_NL-pim-medium` ONNX model on main: `synth-failed` after ~2.1 seconds, no audio. The published dictionary bytes matched the repository.

The shipped 2.23 MB phonemizer pack already contains `nl_dict` and other dictionaries, while the wrapper tried to create them again. Emscripten throws EEXIST, reported as `[object Object]` by the worker. The wrapper now checks the module's real filesystem and reuses an existing dictionary. The exported lookup is part of the generator too. Revisioned URLs keep the glue/file table and data pack together across cached Android sessions.

The real-engine Dutch regression now passes: actual model download, audible finite PCM, both sentences completed, cold worker after reload at 1.1×, and dictionary URLs blocked during that second reading. No replacement of the engine with a fake. The failing test's outdated data-pack assertion now checks the embedded byte count and the current pack budget. Worker errors are preserved in failures for diagnosis.

This is a web correction loaded by the existing Android 1.1.2 shell. Native version, signing and APK are unchanged. Additional loading-race corrections and the remaining WIP are separate follow-up changes.

Production verification (2026-10-02): the actual published app downloaded Pim from Hugging Face, selected Dutch automatically and produced finite audible Web Audio at 1.1× without system speech. A second reading after reload reused the installed model and started again with the dictionary URL blocked. Both completed starts passed in a clean mobile-size browser context (40.6 seconds total). Evidence is in `.animation.local/pim-live-evidence/`; the system API is observed through a controlled implementation, while Piper, its weights, WebAssembly and Web Audio are real. This is not a physical Android-device test.

Published main asset: `/inhouse-read/assets/main-Cyyuwg_s.js`, SHA-256 `decf0daedc1ecfe16c912888b88fbb104fcc3778b678a7ef041b8e905c5b0dda`. The live phonemizer exports the filesystem lookup and serves the complete 2,232,748-byte pack with `?v=20261002-dictionaries`.

## Production verification — 1.7.8

On 3 October 2026 (Europe/Madrid), the same live test passed again on the deployment of commit `e310cb75fe2b7cd8e295c1049cf5fba085f96268`: **1/1, 33.57 seconds, no retries, skips or page errors**. It used the actual production app and its default Hugging Face download URLs. Dutch automatic selection chose `piper:nl_NL-pim-medium` at **1.25×** for both starts. The second start followed reloads in the same browser context, reused installed weights from Cache Storage and had no Download button. The separate `nl_dict` URL was blocked; neither start requested it, since Dutch is embedded in the phonemizer pack.

Web Audio produced finite PCM at 22,050 Hz with a 0.9 peak and RMS values of 0.154, 0.143 and 0.124. Every captured chunk used a running audio context. The observed system-speech implementation recorded zero calls, so the test did not pass through a system fallback. The engine request to first scheduled audio took approximately 3387 ms after installation and 2917 ms after reload. These are measured starts on this browser and machine, not a universal startup-time promise or a test of an entire book.

The system API remains a controlled observer; the production picker, Piper model, phonemizer, ONNX Runtime worker and Web Audio are real. The test does not establish physical Android playback or offline app bootstrap. The unchanged Android 1.1.2 / code 15 APK has a 2089-byte loader that redirects to the published app; it contains neither app bundles nor neural model assets.

Published asset: `/inhouse-read/assets/main-3lf-QqBP.js`, 1,365,072 bytes, SHA-256 `c8575e57797742ea855c847e08900df116deb9a9036756b38289df2037506bd6`, matching the deployed `gh-pages` bytes. Evidence: `.animation.local/final-live-evidence/artifact.json`, `.animation.local/final-live-evidence/pim-178/{results,numbers}.json`, `pim-live-0.png`, `pim-live-1.png` and `.animation.local/final-live-pim-178.log`.

The three neural jobs of Production checks **37073632148** also passed with **56/56** executed cases: engine 9, reading 10 and languages 37 (all 36 catalogue options plus the dictionary-pack check), with zero skips or retries. This confirms the voice jobs only; the complete CI and bookshelf/reader checks are tracked separately in [remaining-wip-verification.md](remaining-wip-verification.md).

## Candidata 1.7.9: Daniela y sólo voces naturales

Daniela high superó RTF 1,6 durante varios segmentos. El motor anterior
convertía esa lentitud en error `too-slow`; el lector guardaba un veto global
durante catorce días y pasaba al dispositivo. El nuevo motor espera fragmentos
completos cuando la generación va más lenta que el audio. Conserva la voz y la
cola; los errores reales se muestran para reintentar la misma natural. Se
eliminan el veto y los transportes de sistema del lector y sus menús.

La regresión con pesos reales de Argentina pasó a 1× y 1,25×, con worker frío
y tres inicios audibles por velocidad. RTF 1,802 y 1,821 activaron el buffer
completo y la lectura continuó; el primer inicio tardó 3285 y 3269 ms. Ambas
API de voces del dispositivo permanecieron sin llamadas. Evidencia local:
`.animation.local/argentina-real-179/`; pendiente repetir contra la publicación.
