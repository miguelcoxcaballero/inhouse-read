# Functional Rust migration boundary audit

Snapshot: `423ce4ba` (1.7.306) plus cache/frame policy commit `5636c584`.
This inventory covers every one of the 252 tracked `src/js/**/*.js` modules in
that snapshot exactly once. Parallel branches are intentionally not claimed as
completed here. Reconcile their final source before removing any listed work.
The live transport row and priority note were subsequently reconciled with the
completed queue, receive, RTC and lifecycle batches in this branch; the file
list and its denominator remain the original snapshot.

This is a functional inventory, not a new percentage or denominator. The user's
requested language percentage is GitHub's language statistic; neither line
counts nor this table measure functional completion. No `.gitattributes`, file
renaming, embedded-string relocation or generated glue exclusion was changed.

## Meaning of the classifications

- **R — Rust policy with host/ABI facade.** Core behavior has a concrete Rust
  entry point. The remaining facade is still reviewed when changing its owner;
  this label does not certify every incidental expression is Rust.
- **H — host/ABI responsibility.** Browser activation, object handles, callback
  plumbing, memory packing, decoding or third-party APIs need a host boundary.
  The boundary may stay JavaScript without requiring the whole app to be JS.
- **M — mixed; own JavaScript rules remain.** The note identifies decisions or
  state to extract. DOM/Three/ONNX imports alone are not a migration exception.
- **L — live legacy/bootstrap implementation.** An executable fallback is own
  app logic, even if its preferred path is Rust. Preserve offline, startup,
  accessibility and older-WebView behavior when replacing it.
- **D — declarative data.** Messages/palettes are not an optimization target.
- **X — shared updater.** Apply the canonical repository policy in `AGENTS.md`;
  do not independently rewrite a shared copy to change language totals.

No single category supplies a functional percentage. A necessary browser call
does not justify leaving its surrounding domain state machine in JavaScript.
Conversely, replacing a thin host call with an extra WASM crossing can slow it
down: migrate coherent batches and retain host-owned large images/tensors.

## Prioritized remaining blocks

1. **Frame-time scene/asset orchestration (active parallel work).**
   `bookshelf-scene.updateEntries`, render invalidation, physics packet packing;
   `book-model` material/presentation ownership; `shelf-lamp-lighting.reconcile`
   and `rankKeys`; `cover-relief`, `shelf-plants` paint/bake queues. Rust already
   owns major numerical kernels. Prefer retained arrays/state and one command
   packet per update over property-by-property JS/WASM calls. Measure frame
   duration, allocation, GPU submissions and reader idle activity separately.
2. **Voice preparation/job state (large unoccupied follow-up).**
   `readers/neural-voice/{client,native-client,worker,index}.js` duplicate
   prepare/load generation, serial jobs, cancellation and model release. A
   shared Rust planner can unify web/native behavior while Worker, ONNX and
   audio APIs remain host. `engine`, PCM processing and much of player policy
   already delegate Rust: do not re-migrate them. Keep lazy loading; do not make
   the worker import the full reader UI module to get a small controller.
3. **Live transport reliability/state.** The subsequent transport batches move
   runtime session lifecycle, retry/backoff, relay writes, health, ICE parsing,
   channel queues and BroadcastChannel publication into `live_transport.rs`.
   The remaining JS transport fallback runs only before UI WASM is available:
   it starts/cancels/retries that import without eagerly loading reader or voice.
   `app.js` capture retries and backup timer are reconciled with app-room; the
   subsequent app-cloud batch owns account/auth/sync and cover download/upload
   cleanup. Screen/import/disposal and refresh gating still need final review. Verify two contexts on direct and relay paths,
   reconnect, background/foreground, account changes and stale completions.
4. **Small coherent record/placement rules (next implementation batch).**
   `readers/reading-state.js`, `shelf-metadata-records.js`,
   `lamp-catalog-data.normalizeShelfLamp`, `decor-geometry-spec`,
   `shelf-decoration-layout` and `plant-rooftop-layout`. Preserve exact property
   presence, object/Blob identity and invalid-value behavior. `plant-records`
   belongs to another active agent; do not duplicate it. These are correctness
   migrations with modest performance expectation, not a claim of speedup.
5. **Startup and reader power state.** `reading-display`, `idle-startup`,
   `content-freshness`, `shelf-boot`/launch cache and offline shell. Own
   scheduling/eligibility rules remain. Keep early synchronous host bootstrap
   before WASM; an offline shell cannot require a fresh network WASM request to
   decide whether its cached WASM exists. Validate cold/offline first paint,
   visible reader wake lock, hidden-tab suspension and idle CPU.
6. **Catalogue, tap geometry and preview state.** `catalog-camera`,
   `plant-dimensions` tap padding/nearest selection, preview controllers,
   decoration defaults and trash profile/UV/color recipes. Batch geometry and
   commands; leave Three/Canvas allocations and GPU shaders at the host.
7. **Cache/job policies.** `gpu-programs`, font worker client, paper tone sample
   and measurement cache, environment/bake/image caches. Frame geometry and
   cover-raster LRU have just moved in `5636c584`; do not repeat that work.
   Isolate policy from disposal callbacks to preserve reentrant host behavior.
8. **Voice metadata/format rules and parsers.** Language tags/catalogue URL
   policies, dictionary cache, `piper-alignment` protobuf metadata and Hebrew
   phoneme-ID assembly. The existing 63 MB ONNX graph host parser deliberately
   avoids a second model copy: use bounded/streamed metadata if moving parsing.
9. **Reader facade and bootstrap fallbacks.** Remaining `ReaderExperience`
   choices, `reading-preferences` fallback and `*-legacy.js` modules. Migrate
   only after testing startup before full UI readiness; do not delete a working
   compatibility path solely because its source is JavaScript.

The largest files are not automatically the largest remaining CPU workload:
GLSL strings execute on the GPU, ONNX/PDF/Foliate are third-party engines and
many reader files already forward to Rust. Earlier migration benchmarks in
`docs/handoff-rust-migration.md` show some small-object Rust adapters slower
than JavaScript; measure end-to-end behavior instead of promising acceleration
from language choice alone.

## What completion would mean

All own numerical algorithms, domain decisions and state machines have a
single Rust implementation with exact behavior tests. Remaining JavaScript is
documented host bootstrap/activation, generated bindings, object/callback and
third-party adapters, plus declarative assets. Any M/L row needs a concrete
resolution or narrowly justified necessary host exception before claiming
that result. Browser APIs, GLSL, HTML/CSS, ONNX and platform wrappers do not
become Rust merely by moving their source strings into a `.rs` file.

## Module-by-module inventory

Paths are relative to `src/js/`. A mixed classification is conservative: it
prevents falsely treating a whole file as an unavoidable adapter. Follow the
function-level note and inspect the final integrated source for extraction.

| Module | Class | Responsibility / remaining own logic |
| --- | --- | --- |
| `android-file-import.js` | M | Import queue and Android bridge lifetime still have own policy around native callbacks. |
| `android-update.js` | X | Shared updater host integration. AGENTS.md requires canonical updater changes and synchronized revision. |
| `animation-frame-fence.js` | R | Rust owns decisions; JavaScript exports, callbacks or argument/result marshalling remain. |
| `app.js` | M | Rust owns backup/capture retries, account/auth/Drive sync and cover offline/upload lifecycle, plus reader preparation/open/close/persistence. Remaining own blocks: loading generation, picker/native import selection, Drive modal selection/import, length-refresh timers, screen/disposal and viewport-cache invalidation. |
| `baggebo-model.js` | M | Geometry/material construction and resource assembly; numeric kernels are Rust, Three handles stay host. Active geometry branch must be reconciled. |
| `binding-wasm.js` | R | Rust owns decisions; JavaScript exports, callbacks or argument/result marshalling remain. |
| `book-colors.js` | R | Rust owns decisions; JavaScript exports, callbacks or argument/result marshalling remain. |
| `book-cover-images.js` | M | Image request/cache lifetime and invalidation decisions around host decoding. |
| `book-data-native.js` | R | Rust owns decisions; JavaScript exports, callbacks or argument/result marshalling remain. |
| `book-format-wasm.js` | R | Rust owns decisions; JavaScript exports, callbacks or argument/result marshalling remain. |
| `book-frame-padding.js` | R | Rust owns decisions; JavaScript exports, callbacks or argument/result marshalling remain. |
| `book-length-drive.js` | R | Rust owns decisions; JavaScript exports, callbacks or argument/result marshalling remain. |
| `book-length-queue.js` | R | Rust owns decisions; JavaScript exports, callbacks or argument/result marshalling remain. |
| `book-length.js` | R | Rust owns decisions; JavaScript exports, callbacks or argument/result marshalling remain. |
| `book-model.js` | M | createBookModel/bookView orchestration and material/resource choices; geometry kernels already Rust. Active parallel work. |
| `book-motion-wasm.js` | R | Rust owns decisions; JavaScript exports, callbacks or argument/result marshalling remain. |
| `book-motion.js` | R | Rust owns decisions; JavaScript exports, callbacks or argument/result marshalling remain. |
| `book-projection-legacy.js` | L | Executable JavaScript fallback, not an automatic host exception. Retire or migrate with cold/offline compatibility tests. |
| `book-projection.js` | L | Executable JavaScript fallback, not an automatic host exception. Retire or migrate with cold/offline compatibility tests. |
| `book-reflection-surface.js` | M | Shader installation/material lifetime plus reflection recipe; GPU GLSL is a necessary separate language, not CPU logic to relabel. |
| `book-storage-policy.js` | R | Rust owns decisions; JavaScript exports, callbacks or argument/result marshalling remain. |
| `book-surface-wasm.js` | R | Rust owns decisions; JavaScript exports, callbacks or argument/result marshalling remain. |
| `book-title.js` | R | Rust owns decisions; JavaScript exports, callbacks or argument/result marshalling remain. |
| `book-view-wasm.js` | R | Rust owns decisions; JavaScript exports, callbacks or argument/result marshalling remain. |
| `bookmark-wasm.js` | R | Rust owns decisions; JavaScript exports, callbacks or argument/result marshalling remain. |
| `bookshelf-layout.js` | M | withDefaults and data normalization/composition remain; spine/layout/section planner kernels already Rust. |
| `bookshelf-return.js` | R | Rust owns decisions; JavaScript exports, callbacks or argument/result marshalling remain. |
| `bookshelf-scene.js` | M | updateEntries, draw/invalidation scheduling, object packing and material/resource orchestration; physics/interpolation Rust. Active parallel work. |
| `bookshelf.js` | M | Rust controllers own most gestures and transitions; DOM exports, text callbacks, local coordination and host facade still need exact residual review. |
| `canvas-font-readiness.js` | M | FontFaceSet is host; refreshCanvasFontsAfterPaint still chooses whether the readiness callback is needed from loaded status. |
| `catalog-camera.js` | M | bookletRect and catalogCameraFrames own rectangle validation, fitting and CSS transform rounding. |
| `catalogue-core.js` | H | Host API/ABI: browser primitives or third-party handles; preserve synchronous ownership and errors. |
| `chunk-recovery.js` | M | reloadOnceAfterChunkFailure throttles retry and storage state in JavaScript before UI readiness. |
| `cloud-backup-state.js` | M | IndexedDB host transactions plus checkpoint merge/load orchestration; review fallback/native merge ownership. |
| `cloud-native.js` | M | Lazy Rust cloud module gate and availability/retry policy; must avoid startup dependency cycles. |
| `cloud-settings.js` | M | Declarative sync-key list plus change event dispatch; key whitelist belongs with canonical Rust settings policy. |
| `cloud-sync.js` | M | Rust CloudSync owns sync semantics; wrapper still owns epoch/profile readiness, deferred progress and pending dispatch state. |
| `content-freshness.js` | M | openIfNewer/reloadInto/check/init own update retry and idle-reader decisions; file-reference scanning already Rust. |
| `core-tables.js` | H | Host API/ABI: browser primitives or third-party handles; preserve synchronous ownership and errors. |
| `cover-appearance.js` | M | Font detection and cover recipe orchestration around Canvas/Rust image kernels. Active root work; inspect final integrated revision. |
| `cover-color-wasm.js` | R | Rust owns decisions; JavaScript exports, callbacks or argument/result marshalling remain. |
| `cover-editor.js` | M | Editor view/lifetime and interaction policy around browser controls; migration target is commands/state, not DOM handle copying. |
| `cover-raster-cache.js` | R | Rust owns decisions; JavaScript exports, callbacks or argument/result marshalling remain. |
| `cover-relief-wasm.js` | M | Rust relief kernels; buffer ownership, queued sampling and stage preparation in host adapter. Active parallel work. |
| `cover-relief.js` | M | Relief lifetime/material stage policy mixed with GPU shader/texture installation. Active parallel work. |
| `cozy-sounds.js` | M | Rust event/clip/synthesis policies plus WebAudio cache/voice lifetime and suspension orchestration still in JS. |
| `decor-catalogue.js` | H | Host API/ABI: browser primitives or third-party handles; preserve synchronous ownership and errors. |
| `decor-geometry-spec.js` | M | plantGeometrySpec/lampGeometrySpec choose fallback IDs and compute scene dimensions/scales. |
| `download-android.js` | X | Shared updater host integration. AGENTS.md requires canonical updater changes and synchronized revision. |
| `drive-client.js` | M | Rust DriveClient owns network/auth logic; storedSession, restoreToken, ready and native OAuth readiness remain local policy. |
| `drive-fetch.js` | H | Host API/ABI: browser primitives or third-party handles; preserve synchronous ownership and errors. |
| `file-book-length.js` | R | Rust owns decisions; JavaScript exports, callbacks or argument/result marshalling remain. |
| `foliage-projection-legacy.js` | L | Executable JavaScript fallback, not an automatic host exception. Retire or migrate with cold/offline compatibility tests. |
| `foliage-projection.js` | L | Executable JavaScript fallback, not an automatic host exception. Retire or migrate with cold/offline compatibility tests. |
| `font-glyph-wasm.js` | R | Rust owns decisions; JavaScript exports, callbacks or argument/result marshalling remain. |
| `font-score-client.js` | M | createClient/openFontScoreJob own active-job state, timeout, retirement and message validation; Worker itself remains host. |
| `font-score-core.js` | R | Rust owns decisions; JavaScript exports, callbacks or argument/result marshalling remain. |
| `font-score-wasm.js` | R | Rust owns decisions; JavaScript exports, callbacks or argument/result marshalling remain. |
| `font-score-worker.js` | M | Scoring Rust; handle/release and serial queue still own begin/end replacement and image validation. |
| `format-detect.js` | M | getExtension/detectFormat label/extension policy and fast prefix checks remain; MOBI/FB2 scans Rust. Do not add per-byte ABI crossings. |
| `geo-packet.js` | H | Host API/ABI: browser primitives or third-party handles; preserve synchronous ownership and errors. |
| `gestures.js` | R | Rust owns decisions; JavaScript exports, callbacks or argument/result marshalling remain. |
| `gpu-programs.js` | M | retainPrograms LRU, prepareProgramUniforms deadline and prelink readiness policies remain; Three compiler calls stay host. |
| `host-math.js` | H | Host API/ABI: browser primitives or third-party handles; preserve synchronous ownership and errors. |
| `idle-startup.js` | M | setShelfWorkActive/shelfWorkReady/shelfPresented/idleWork own startup and foreground work scheduling. |
| `insertion-program-preparation.js` | M | Own idle/current sequencing and material collection before GPU preparation; traversal and compiler are host APIs. |
| `lamp-catalog-data.js` | M | Rust data tables, but normalizeShelfLamp and ID/default/placement/kelvin validation are JS. |
| `lamp-catalog-preview.js` | M | Preview animation, quality/lifetime and light placement orchestration mixed with Three host calls. |
| `lamp-illustration.js` | M | ID selection and SVG presentation wrapper; artwork is declarative, ID fallback is own policy. |
| `lamp-kelvin.js` | M | Rust tint kernels/transition, but normalizeLampKelvin and host object/color adaptation still contain choice logic. |
| `lamp-surface-wasm.js` | R | Rust owns decisions; JavaScript exports, callbacks or argument/result marshalling remain. |
| `legacy-book-recovery.js` | M | Legacy recovery initialization/queue around Rust book data and browser files. |
| `library-backup.js` | M | Rust backup state owns merge/sync; wrapper native-ready state and polling gate remain local orchestration. |
| `library-store.js` | R | Rust owns decisions; JavaScript exports, callbacks or argument/result marshalling remain. |
| `live-room.js` | R | Runtime lifecycle, publication, crypto transport formatting, retry/relay, health, ICE and queues delegate to Rust. Host RTC/crypto/Drive/timer capabilities plus a cold WASM import/cancellation fallback remain; no early reader/voice import. |
| `local-folder-store.js` | M | Rust filename/folder policies; host IDB handles and synchronous file picker retained, small database fallback/selection orchestration remains. |
| `native-canvas-resize.js` | R | Rust owns decisions; JavaScript exports, callbacks or argument/result marshalling remain. |
| `native-frame-policy.js` | R | Rust owns decisions; JavaScript exports, callbacks or argument/result marshalling remain. |
| `native-import-shelf-gate-legacy.js` | L | Executable JavaScript fallback, not an automatic host exception. Retire or migrate with cold/offline compatibility tests. |
| `native-import-shelf-gate.js` | L | Executable JavaScript fallback, not an automatic host exception. Retire or migrate with cold/offline compatibility tests. |
| `native-renderer-presentation.js` | R | Rust owns decisions; JavaScript exports, callbacks or argument/result marshalling remain. |
| `native-renderer-size.js` | R | Rust owns decisions; JavaScript exports, callbacks or argument/result marshalling remain. |
| `native-room-cache.js` | M | Composition geometry now Rust (5636c584); render targets/material ownership, dirty generations, host draw state remain mixed. |
| `offline-shell-worker.js` | M | createOfflineShell owns canonical paths, shell completeness, retention and routing policies; ServiceWorker/CacheStorage/Crypto are host. Must not delay offline boot on network WASM. |
| `offline-shell.js` | M | Registration eligibility/lifetime around browser ServiceWorker; small bootstrap policy. |
| `page-mesh-wasm.js` | R | Rust owns decisions; JavaScript exports, callbacks or argument/result marshalling remain. |
| `page-paper-tone-sample.js` | M | Pure numeric opaque edge sampling, quartiles and median color thresholds. |
| `page-paper-tone-worker.js` | M | OffscreenCanvas pixel read is host; worker dispatch/measurement calls own tone sampler. |
| `page-paper-tone.js` | M | Identity/weak cache, worker jobs, validation and measurement deduplication policy. |
| `page-raster.js` | M | WeakMap source revision registration and invalidation semantics; tiny policy. |
| `pdf-book-length.js` | R | Rust owns decisions; JavaScript exports, callbacks or argument/result marshalling remain. |
| `perf-marks.js` | H | Host API/ABI: browser primitives or third-party handles; preserve synchronous ownership and errors. |
| `plant-catalog-art.js` | R | Rust owns decisions; JavaScript exports, callbacks or argument/result marshalling remain. |
| `plant-catalog-data.js` | M | Rust data tables; getCatalogPlant/getCatalogPot/getPotColor still choose ID/default/color on JS side. |
| `plant-catalog-lazy.js` | M | Lazy module, pending view and disposal coordination; preserve deferred load. |
| `plant-catalog-native.js` | M | Rust catalogue controller plus own section/preview/reflow and lifetime orchestration; DOM remains host. |
| `plant-catalog-preview.js` | M | Preview frame timing, normalization and Three scene/material disposal orchestration. |
| `plant-catalog.js` | R | Rust owns decisions; JavaScript exports, callbacks or argument/result marshalling remain. |
| `plant-dimensions.js` | M | Canonical sizes/math Rust; minimumBookCellWidth/padTapRect/padTapSquare/nearestTapTarget and scene-size assembly remain JS. |
| `plant-foliage-wasm.js` | R | Rust owns decisions; JavaScript exports, callbacks or argument/result marshalling remain. |
| `plant-glaze-wasm.js` | R | Rust owns decisions; JavaScript exports, callbacks or argument/result marshalling remain. |
| `plant-lattice-wasm.js` | R | Rust owns decisions; JavaScript exports, callbacks or argument/result marshalling remain. |
| `plant-paint-gate.js` | M | createPlantPaintGate owns first-paint waiting identity/deadline state. |
| `plant-pottery-wasm.js` | R | Rust owns decisions; JavaScript exports, callbacks or argument/result marshalling remain. |
| `plant-records.js` | M | resolveCatalogPlant/normalizeShelfPlant still normalize aliases, defaults and seeds. Active book_surface_verify ownership: do not duplicate. |
| `plant-rooftop-layout.js` | M | placeRooftopPlants partitions rooftop objects and composes shelves; packing Rust. |
| `plant-soil-wasm.js` | R | Rust owns decisions; JavaScript exports, callbacks or argument/result marshalling remain. |
| `prepared-page.js` | L | Executable JavaScript fallback, not an automatic host exception. Retire or migrate with cold/offline compatibility tests. |
| `profile-view-legacy.js` | L | Executable JavaScript fallback, not an automatic host exception. Retire or migrate with cold/offline compatibility tests. |
| `profile-view.js` | L | Executable JavaScript fallback, not an automatic host exception. Retire or migrate with cold/offline compatibility tests. |
| `reader-book-timing.js` | M | Declarative timings plus normal/reduced-motion selection; low CPU priority. |
| `reader-return-canvas.js` | M | Canvas drawing/DOM ownership are host; readerReturnCanvas still chooses detached-canvas reuse versus an exact copied surface. |
| `readers/core-required.js` | H | Host API/ABI: browser primitives or third-party handles; preserve synchronous ownership and errors. |
| `readers/cover-encode-worker.js` | H | Host API/ABI: browser primitives or third-party handles; preserve synchronous ownership and errors. |
| `readers/cover-encode.js` | M | Worker request, abort and fallback lifecycle around host JPEG encoding; no reason to copy image pixels through Rust merely for ownership. |
| `readers/foliate-reader.js` | M | Most reader decisions Rust; announceSpeechLayout, speech reset and Foliate host adapter still contain small scheduling/transition rules. |
| `readers/foliate-speech-cursor.js` | M | Cursor operations largely Rust; reset/browse/close epoch state still JS. |
| `readers/language-detect.js` | R | Rust owns decisions; JavaScript exports, callbacks or argument/result marshalling remain. |
| `readers/neural-picker.js` | R | Rust owns decisions; JavaScript exports, callbacks or argument/result marshalling remain. |
| `readers/neural-runtime.js` | M | Lazy engine load/cache, availability and gesture-unlock coordination; must preserve synchronous user activation. |
| `readers/neural-voice/audio.js` | M | Native/browser audio route and activation/session state; actual WebAudio/native gesture entry must remain synchronous host call. |
| `readers/neural-voice/catalog.js` | M | Voice data plus parsePiperId/trusted base/URLs/filter rules; migrate rules, do not bulk-move model tables to inflate counts. |
| `readers/neural-voice/client.js` | M | SynthClient prepare/load generation, pending calls/jobs, cancellation, serial preparation and worker lifetime. |
| `readers/neural-voice/core-call.js` | H | Host API/ABI: browser primitives or third-party handles; preserve synchronous ownership and errors. |
| `readers/neural-voice/dictionary-cache.js` | M | dictionaryNeeded/descriptorOf, abort handling, download validation/cache policy; fetch/CacheStorage/WebCrypto host. |
| `readers/neural-voice/engine.js` | R | Rust owns decisions; JavaScript exports, callbacks or argument/result marshalling remain. |
| `readers/neural-voice/hebrew.js` | M | IPA/Nakdimon kernels Rust; phonemeIdsFromIpa and ONNX phonemizer queue/session lifetime remain JS, Unicode normalization uses host. |
| `readers/neural-voice/index.js` | M | NeuralVoiceEngine lazy preparation, queue/resourceGeneration and release/stop policies outside Rust engine core. |
| `readers/neural-voice/native-client.js` | M | NativeSynthClient duplicates prepare/synth serial lifetime and cancellation decisions around native ONNX host. |
| `readers/neural-voice/native-ort.js` | M | Tensor validation, request tokens and model-upload chunk decisions remain around necessary Android IPC encoding. |
| `readers/neural-voice/native-player.js` | R | Rust owns decisions; JavaScript exports, callbacks or argument/result marshalling remain. |
| `readers/neural-voice/package-store.js` | M | Rust package listing; store-routing discriminator/readConfig selection still JS. |
| `readers/neural-voice/phonemizer-assets.js` | M | Compiled Emscripten module/factory cache and file ownership; instantiation and package byte access are host. |
| `readers/neural-voice/phonemizer.js` | M | Dictionary injection, call counters/reset every 40 calls and Emscripten instance lifecycle are own JS rules; third-party phonemizer remains dependency. |
| `readers/neural-voice/piper-alignment.js` | M | varint/fields/exposePiperDurations/phonemeMarks remain own parsing; migrate bounded metadata, never blindly copy 63 MB model into WASM. |
| `readers/neural-voice/player.js` | R | Rust owns decisions; JavaScript exports, callbacks or argument/result marshalling remain. |
| `readers/neural-voice/store.js` | R | Rust owns decisions; JavaScript exports, callbacks or argument/result marshalling remain. |
| `readers/neural-voice/supertonic-catalog.js` | M | Asset/voice data plus trusted override, URL and language/style choice rules. |
| `readers/neural-voice/supertonic-runtime.js` | M | Rust text/duration kernels; ONNX graph recipe, tensor lifecycle and sentence/timeline composition still JS. Preserve model/tensor zero-copy ownership. |
| `readers/neural-voice/supertonic-store.js` | R | Rust owns decisions; JavaScript exports, callbacks or argument/result marshalling remain. |
| `readers/neural-voice/synth-flow.js` | R | Rust owns decisions; JavaScript exports, callbacks or argument/result marshalling remain. |
| `readers/neural-voice/task-yield.js` | H | Host API/ABI: browser primitives or third-party handles; preserve synchronous ownership and errors. |
| `readers/neural-voice/worker.js` | M | init/load/releaseVoice/synth/drain own worker job and model lifetime state; numeric synthesis is Rust/third-party ONNX. |
| `readers/page-snapshot.js` | R | Rust owns decisions; JavaScript exports, callbacks or argument/result marshalling remain. |
| `readers/pdf-figures-wasm.js` | R | Rust owns decisions; JavaScript exports, callbacks or argument/result marshalling remain. |
| `readers/pdf-images-wasm.js` | R | Rust owns decisions; JavaScript exports, callbacks or argument/result marshalling remain. |
| `readers/pdf-order-wasm.js` | R | Rust owns decisions; JavaScript exports, callbacks or argument/result marshalling remain. |
| `readers/pdf-page-theme.js` | R | Rust owns decisions; JavaScript exports, callbacks or argument/result marshalling remain. |
| `readers/pdf-reader.js` | R | Rust owns decisions; JavaScript exports, callbacks or argument/result marshalling remain. |
| `readers/pdf-reflow.js` | R | Rust owns decisions; JavaScript exports, callbacks or argument/result marshalling remain. |
| `readers/pdf-row-layout-wasm.js` | R | Rust owns decisions; JavaScript exports, callbacks or argument/result marshalling remain. |
| `readers/pdf-stream-wasm.js` | R | Rust owns decisions; JavaScript exports, callbacks or argument/result marshalling remain. |
| `readers/pdf-text.js` | M | Row kernels Rust; extraction fallback/DOM layer mapping and local text assembly still have own logic. |
| `readers/persistable-position.js` | R | Rust owns decisions; JavaScript exports, callbacks or argument/result marshalling remain. |
| `readers/picker-actions.js` | R | Rust owns decisions; JavaScript exports, callbacks or argument/result marshalling remain. |
| `readers/picker-messages.js` | D | Declarative palette or messages; moving strings changes source statistics, not runtime behavior. |
| `readers/picker-policy.js` | R | Rust owns decisions; JavaScript exports, callbacks or argument/result marshalling remain. |
| `readers/picker-render.js` | R | Rust owns decisions; JavaScript exports, callbacks or argument/result marshalling remain. |
| `readers/picker-warm.js` | R | Rust owns decisions; JavaScript exports, callbacks or argument/result marshalling remain. |
| `readers/preference-flow.js` | R | Rust owns decisions; JavaScript exports, callbacks or argument/result marshalling remain. |
| `readers/reader-actions.js` | R | Rust owns decisions; JavaScript exports, callbacks or argument/result marshalling remain. |
| `readers/reader-chrome.js` | R | Rust owns decisions; JavaScript exports, callbacks or argument/result marshalling remain. |
| `readers/reader-controller.js` | R | Rust owns decisions; JavaScript exports, callbacks or argument/result marshalling remain. |
| `readers/reader-controls.js` | R | Rust owns decisions; JavaScript exports, callbacks or argument/result marshalling remain. |
| `readers/reader-experience-lazy.js` | M | Saved preference normalization and deferred experience/module handoff before Rust UI loads. |
| `readers/reader-experience.js` | M | open/relocate, labels, tab state, renderPlaces/delete history, share fallback and queueNavigation coordination remain own JS. |
| `readers/reader-interface.js` | R | Rust owns decisions; JavaScript exports, callbacks or argument/result marshalling remain. |
| `readers/reader-lifecycle.js` | R | Rust owns decisions; JavaScript exports, callbacks or argument/result marshalling remain. |
| `readers/reader-lists.js` | R | Rust owns decisions; JavaScript exports, callbacks or argument/result marshalling remain. |
| `readers/reader-navigation.js` | R | Rust owns decisions; JavaScript exports, callbacks or argument/result marshalling remain. |
| `readers/reader-view.js` | R | Rust owns decisions; JavaScript exports, callbacks or argument/result marshalling remain. |
| `readers/reading-palette.js` | D | Declarative palette or messages; moving strings changes source statistics, not runtime behavior. |
| `readers/reading-places.js` | R | Rust owns decisions; JavaScript exports, callbacks or argument/result marshalling remain. |
| `readers/reading-preferences-wasm.js` | R | Rust owns decisions; JavaScript exports, callbacks or argument/result marshalling remain. |
| `readers/reading-preferences.js` | L | Rust preferred numbers/CSS but JS numeric/CSS fallback and enum/voice validation remain live before UI readiness. |
| `readers/reading-state.js` | M | pdfLocator/clonePlace/cleanPlaces/cleanQuotes own pure position, CFI, fraction, limits and highlight normalization. |
| `readers/reading-voice.js` | M | Rust voice-flow modules own playback; facade still owns event lifecycle/transport assignment and small state wrappers. |
| `readers/rust-ui-required.js` | R | Rust owns decisions; JavaScript exports, callbacks or argument/result marshalling remain. |
| `readers/select-menu.js` | R | Rust owns decisions; JavaScript exports, callbacks or argument/result marshalling remain. |
| `readers/sentence-ends.js` | R | Rust owns decisions; JavaScript exports, callbacks or argument/result marshalling remain. |
| `readers/speech-follow.js` | R | Rust owns decisions; JavaScript exports, callbacks or argument/result marshalling remain. |
| `readers/speech-highlight.js` | R | Rust owns decisions; JavaScript exports, callbacks or argument/result marshalling remain. |
| `readers/speech-hold.js` | H | Host API/ABI: browser primitives or third-party handles; preserve synchronous ownership and errors. |
| `readers/speech-map.js` | R | Rust owns decisions; JavaScript exports, callbacks or argument/result marshalling remain. |
| `readers/speech-page-breaks.js` | R | Rust owns decisions; JavaScript exports, callbacks or argument/result marshalling remain. |
| `readers/speech-pipeline.js` | R | Rust owns decisions; JavaScript exports, callbacks or argument/result marshalling remain. |
| `readers/speech-plan.js` | M | clause chooses punctuation split points in JS; Unicode properties and UTF-16 packing are host/ABI helpers. |
| `readers/speech-text.js` | M | Rust normalization/plan pipeline; speechChunks whitespace adaptation and input guards remain small own rules. |
| `readers/voice-advance.js` | R | Rust owns decisions; JavaScript exports, callbacks or argument/result marshalling remain. |
| `readers/voice-ahead.js` | R | Rust owns decisions; JavaScript exports, callbacks or argument/result marshalling remain. |
| `readers/voice-catalog.js` | M | Rust voice ranking; normalizeLang, declaredLanguage, isNeuralId and tag aliases remain JS for early preferences; Intl names are host. |
| `readers/voice-dispatch.js` | R | Rust owns decisions; JavaScript exports, callbacks or argument/result marshalling remain. |
| `readers/voice-flow.js` | R | Rust owns decisions; JavaScript exports, callbacks or argument/result marshalling remain. |
| `readers/voice-join.js` | R | Rust owns decisions; JavaScript exports, callbacks or argument/result marshalling remain. |
| `readers/voice-menus.js` | R | Rust owns decisions; JavaScript exports, callbacks or argument/result marshalling remain. |
| `readers/voice-navigation.js` | R | Rust owns decisions; JavaScript exports, callbacks or argument/result marshalling remain. |
| `readers/voice-order.js` | R | Rust owns decisions; JavaScript exports, callbacks or argument/result marshalling remain. |
| `readers/voice-preparation.js` | R | Rust owns decisions; JavaScript exports, callbacks or argument/result marshalling remain. |
| `readers/voice-presentation.js` | R | Rust owns decisions; JavaScript exports, callbacks or argument/result marshalling remain. |
| `readers/voice-selection.js` | R | Rust owns decisions; JavaScript exports, callbacks or argument/result marshalling remain. |
| `readers/voice-session.js` | R | Rust owns decisions; JavaScript exports, callbacks or argument/result marshalling remain. |
| `readers/voice-start.js` | R | Rust owns decisions; JavaScript exports, callbacks or argument/result marshalling remain. |
| `readers/voice-stop.js` | R | Rust owns decisions; JavaScript exports, callbacks or argument/result marshalling remain. |
| `readers/zip-memory-io.js` | H | Host API/ABI: browser primitives or third-party handles; preserve synchronous ownership and errors. |
| `reading-display.js` | M | initReadingDisplay/pageOwnsDisplay and wake-lock acquisition epoch/recovery/status-bar decisions remain JS. |
| `reading-progress-queue-legacy.js` | L | Executable JavaScript fallback, not an automatic host exception. Retire or migrate with cold/offline compatibility tests. |
| `reading-progress-queue.js` | L | Executable JavaScript fallback, not an automatic host exception. Retire or migrate with cold/offline compatibility tests. |
| `rust-core.js` | H | Core URL/export access and createRustLoader wiring; loader own recovery policy is separately listed. |
| `rust-decor-core.js` | H | Decor core URL/export access and loader wiring. |
| `rust-loader.js` | M | createRustLoader owns retry deadline, early compilation adoption, one-instance readiness and failure recovery; WebAssembly instantiation necessarily host. |
| `rust-shelf.js` | M | Module load/readiness/retry owner; generated wasm-bindgen adapter is separate, do not count it as app policy. |
| `rust-ui-readiness.js` | M | UI-ready owner and deferred callbacks; bootstrap scheduling policy. |
| `rust-ui.js` | M | UI module load/retry owner and generated-module initialization boundary. |
| `rust-voice-core.js` | H | Voice core URL/export access and loader wiring. |
| `selected-book-names.js` | R | Rust owns decisions; JavaScript exports, callbacks or argument/result marshalling remain. |
| `shader-diagnostics.js` | H | Host API/ABI: browser primitives or third-party handles; preserve synchronous ownership and errors. |
| `shelf-bake-cache.js` | M | Persistent bake key, validity and restore/store lifetime policy around IndexedDB and image handles. |
| `shelf-boot.js` | M | One-time early-record handoff and boot dependency orchestration; preserve instant cached first paint. |
| `shelf-catalog-preview.js` | M | Catalogue scene/preview rebuild and render scheduling with camera/material choices. |
| `shelf-catalog.js` | M | drawCover procedural Canvas marks and model recipe; batch commands/kernel migration possible, Canvas/Three remain host. |
| `shelf-decoration-layout.js` | M | joinShelves/layoutShelfDecorations/moveShelfDecoration partition floor/undershelf and merge results; placement kernel Rust. |
| `shelf-furniture.js` | M | Cabinet/occlusion Rust geometry plus Three assembly, material assignment and footprint adaptation. |
| `shelf-lamp-lighting.js` | M | reconcile/rankKeys/pool generations and light packing; light math Rust. Active parallel work. |
| `shelf-lamps.js` | M | Rust geometry/surfaces but material recipe, lamp on/off glow and resource lifetime orchestration JS. |
| `shelf-launch-cache.js` | M | launchState field selection/Blob signatures, validLaunchFrame, capture generations and retention choices around IDB/canvas. |
| `shelf-launch-preview.js` | M | Very early cached frame selection/display before WASM; own policy, but migration must not introduce a network wait before first paint. |
| `shelf-light-occlusion.js` | M | Rust occlusion numbers plus uniform installation/traversal/dirty choices; GLSL stays GPU language. |
| `shelf-lighting.js` | M | Rust rig numeric planner plus panelShadow GLSL generation and JS sampling/constant choices; shader source is not Rust migration work. |
| `shelf-metadata-records.js` | M | identicalBlobs/committedBlobInputs/canAdoptShelfMetadata own metadata-vs-geometry identity rules; sameBookRecords already Rust. |
| `shelf-model-layout-wasm.js` | R | Rust owns decisions; JavaScript exports, callbacks or argument/result marshalling remain. |
| `shelf-model-layout.js` | R | Rust owns decisions; JavaScript exports, callbacks or argument/result marshalling remain. |
| `shelf-occlusion-wasm.js` | R | Rust owns decisions; JavaScript exports, callbacks or argument/result marshalling remain. |
| `shelf-pixel-origin.js` | R | Rust owns decisions; JavaScript exports, callbacks or argument/result marshalling remain. |
| `shelf-placement-preview.js` | R | Rust owns decisions; JavaScript exports, callbacks or argument/result marshalling remain. |
| `shelf-placement-wasm.js` | M | Rust placement kernel but configuration/placementFor/normalize/snapshot and legacy accessor semantics still own JS policy, not just memory ABI. |
| `shelf-placement.js` | R | Rust owns decisions; JavaScript exports, callbacks or argument/result marshalling remain. |
| `shelf-plants.js` | M | Rust painter/geometry kernels with texture bake/cache/paint queue and species recipe orchestration; active parallel work. |
| `shelf-refresh-queue-legacy.js` | L | Executable JavaScript fallback, not an automatic host exception. Retire or migrate with cold/offline compatibility tests. |
| `shelf-refresh-queue.js` | L | Executable JavaScript fallback, not an automatic host exception. Retire or migrate with cold/offline compatibility tests. |
| `shelf-renderer-size.js` | R | Rust owns decisions; JavaScript exports, callbacks or argument/result marshalling remain. |
| `shelf-startup-resources.js` | M | prepareShelfFonts still chooses the startup faces and merges lettering samples by font before host FontFaceSet.load calls. |
| `shelf-trash.js` | M | Rust drop/noise/normal kernels; arcLengthUV, profile/material color recipes and setState remain JS. |
| `shelf-types.js` | M | Rust specs/tables, local normalizeShelfType/getShelfType fallback choice. |
| `shelf-view-gesture.js` | R | Rust owns decisions; JavaScript exports, callbacks or argument/result marshalling remain. |
| `shelf-zoom.js` | R | Rust owns decisions; JavaScript exports, callbacks or argument/result marshalling remain. |
| `spine-styles.js` | R | Rust owns decisions; JavaScript exports, callbacks or argument/result marshalling remain. |
| `spine-surface.js` | L | Rust preferred surface kernels; retained procedural weave/lattice JS fallback and canvas ownership remain. |
| `studio-environment-cache.js` | M | Persistent environment bake validation/cache ownership around browser storage/Three textures. |
| `studio-renderer.js` | M | Renderer/environment quality and lifetime recipe; Three/WebGL handles necessary, policies not inherently host-only. |
| `studio-scan-state.js` | H | Host API/ABI: browser primitives or third-party handles; preserve synchronous ownership and errors. |
| `studio-scan-wasm.js` | L | Executable JavaScript fallback, not an automatic host exception. Retire or migrate with cold/offline compatibility tests. |
| `word-segments-host.js` | H | Host API/ABI: browser primitives or third-party handles; preserve synchronous ownership and errors. |
