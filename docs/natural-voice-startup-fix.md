# Natural voice startup — 1.7.5

The user's Android recording shows automatic Pim in Dutch at 1.1× falling back before its first fragment. The failure reproduced with the actual `nl_NL-pim-medium` ONNX model on main: `synth-failed` after ~2.1 seconds, no audio. The published dictionary bytes matched the repository.

The shipped 2.23 MB phonemizer pack already contains `nl_dict` and other dictionaries, while the wrapper tried to create them again. Emscripten throws EEXIST, reported as `[object Object]` by the worker. The wrapper now checks the module's real filesystem and reuses an existing dictionary. The exported lookup is part of the generator too. Revisioned URLs keep the glue/file table and data pack together across cached Android sessions.

The real-engine Dutch regression now passes: actual model download, audible finite PCM, both sentences completed, cold worker after reload at 1.1×, and dictionary URLs blocked during that second reading. No replacement of the engine with a fake. The failing test's outdated data-pack assertion now checks the embedded byte count and the current pack budget. Worker errors are preserved in failures for diagnosis.

This is a web correction loaded by the existing Android 1.1.2 shell. Native version, signing and APK are unchanged. Additional loading-race corrections and the remaining WIP are separate follow-up changes.

Production verification (2026-10-02): the actual published app downloaded Pim from Hugging Face, selected Dutch automatically and produced finite audible Web Audio at 1.1× without system speech. A second reading after reload reused the installed model and started again with the dictionary URL blocked. Both completed starts passed in a clean mobile-size browser context (40.6 seconds total). Evidence is in `.animation.local/pim-live-evidence/`; the system API is observed through a controlled implementation, while Piper, its weights, WebAssembly and Web Audio are real. This is not a physical Android-device test.

Published main asset: `/inhouse-read/assets/main-Cyyuwg_s.js`, SHA-256 `decf0daedc1ecfe16c912888b88fbb104fcc3778b678a7ef041b8e905c5b0dda`. The live phonemizer exports the filesystem lookup and serves the complete 2,232,748-byte pack with `?v=20261002-dictionaries`.
