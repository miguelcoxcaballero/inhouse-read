# Natural voice startup — 1.7.5

The user's Android recording shows automatic Pim in Dutch at 1.1× falling back before its first fragment. The failure reproduced with the actual `nl_NL-pim-medium` ONNX model on main: `synth-failed` after ~2.1 seconds, no audio. The published dictionary bytes matched the repository.

The shipped 2.23 MB phonemizer pack already contains `nl_dict` and other dictionaries, while the wrapper tried to create them again. Emscripten throws EEXIST, reported as `[object Object]` by the worker. The wrapper now checks the module's real filesystem and reuses an existing dictionary. The exported lookup is part of the generator too. Revisioned URLs keep the glue/file table and data pack together across cached Android sessions.

The real-engine Dutch regression now passes: actual model download, audible finite PCM, both sentences completed, cold worker after reload at 1.1×, and dictionary URLs blocked during that second reading. No replacement of the engine with a fake. The failing test's outdated data-pack assertion now checks the embedded byte count and the current pack budget. Worker errors are preserved in failures for diagnosis.

This is a web correction loaded by the existing Android 1.1.2 shell. Native version, signing and APK are unchanged. Additional loading-race corrections and the remaining WIP are separate follow-up changes.
