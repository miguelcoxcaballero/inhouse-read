# 1.7.291 — prepare natural speech before it is needed

Rust now primes up to six opening fragments instead of two, within the existing six-entry/30-second synthesis horizon and 24 MB replay-cache budget. Play adopts an in-flight fragment. The reader's lookahead and one detached next-page preparation use that same horizon; current-page and future-page fragments share the bound. Priming stops at the first language/voice change. It never highlights, navigates or plays the prepared page before its audible adoption.

A silent reserve at the time horizon no longer repeatedly arms a pump timer: its audio cannot drain before Play. The normal idle-release deadline remains. Supertonic inference still yields between its internal steps, but the worker now posts completion immediately after the final PCM instead of waiting for another message task before requesting the next fragment. Models, six inference steps, sample rates, timing marks, normalization, paragraph rests and tempo processing are unchanged. Piper's diagnostic await boundaries are unchanged.

The audio unit run passed 1417/1420 initially. Three assertions expected the previous two/four-fragment policy; they were updated to the explicit six-fragment contract, preserving full transcript comparisons. A 141-case affected rerun passed 140, exposing that the fake engine's recorded calls omitted `deferAfter`; the final deferred-page test observes the actual `speak` arguments and all 27 deferred-page cases pass. All 1420 original selected cases were thus covered on the same final runtime. New regressions check adoption without cancelling pending synthesis, the unchanged time/memory bound, no silent pump polling, completion without an extra worker message task, and no early page reveal.

Four real-model browser cases passed without retries in 51.0 seconds: immediate profile selection, prepared English and Dutch, and Lucy (Supertonic F5 English) through the actual reader, worker, ONNX WASM and Web Audio. Lucy prepared six fragments, played them with zero additional synthesis requests during playback, one worker, no model reloads and no underruns. Maximum additional gap on the audio clock was numerical roundoff (2.22e-15 seconds); prepared audio started in 105.9 ms and measured synthesis RTF was 0.941. The exact 17 pinned model assets total 210204134 bytes. These are Chromium measurements on this machine, not cold-download latency or a physical phone guarantee. A device that computes speech slower than playback can still exhaust a finite reserve.

Shelf regression passed in 35.3 seconds (36.4 seconds total): careful placement remains upright, a short final stroke falls to either side, reload retains posture, and the settled shelf stops rendering.
Shared updater integrity passed against unchanged lock 6621ca1dbb519d171d723f118052e42ef5d5c001. No APK or release-channel changes.

Native UI: 3143810 bytes, SHA256 a717f90a816c6cc4a4879620c37a9e6897985dc8f8270c972a985a55c5eaf415.
Native shelf: 3814681 bytes, SHA256 31eaa7b8d2fb35d97a81471cb8b0b1aabab269f676e91e4fdbf303c5f2a989cc.
Offline shell: 111 files, 35879537 bytes, revision 49f1d89f6ad3.
Inventory: 35560 nonblank Rust / 20517 JavaScript lines (63.41% tracked-source LOC; not functional completion).

The direct cross-device transport and the remaining Rust migration continue separately; the 1.7.290 Drive synchronization is retained.
