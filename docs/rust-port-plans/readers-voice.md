PORT PLAN — unit readers-voice (read-only analysis of /home/user/inhouse-read/.claude/worktrees/integ, branch integ-bar-5)

Nothing was built, run or measured; every speed line below is an expectation to be measured, and every byte figure is `wc -c` of the current file (comments included, as the language bar counts them).

## 0. Where the unit stands

- Unit size: 209,478 B of JS = src/js/readers/*.js (≈110.5 KB) + src/js/readers/neural-voice/*.js (≈92.8 KB) + src/js/cozy-sounds.js (6.2 KB).
- Almost no decision logic is left in JS. What remains falls into five kinds:
  - (a) one-line forwarder modules to Rust exports, kept alive mainly because JS "kits" hand them back into Rust (Rust → JS → Rust);
  - (b) class shells: constructors, field initialisers, arrow closures, async methods with await/try;
  - (c) raw-ABI marshalling for rust-core (pdf-*-wasm.js, pdf-text.js, client-plan.js, reading-preferences-wasm.js);
  - (d) code that runs before a wasm module exists;
  - (e) glue bound to browser or third-party APIs.
- Expected result of the plan: about 125–130 KB leaves JS (≈62 % of the unit); about 78 KB stays (section 3).

Three facts found while reading that constrain the design:
- `new ReaderController()` runs at app.js:51 and `createLazyReaderExperience()` at app.js:199, both at app.js evaluation, before rust-ui/shelf. Their constructors and plain getters cannot go through a dispatcher (rule 3).
- neural-voice/index.js is only reached by dynamic import from neural-runtime.js:24, so the facade is movable to rust-ui, provided rust-ui is always loaded by the time `loadNeural()` runs (the reader is built only after `requireRustUI`; confirm for the `unlockNeural` path).
- The raw voice core (src/js/rust-voice-core.js) has exactly one production importer: client-plan.js.

## 1. Shared mechanism for class shells (used by blocks 3, 5, 6)

Do not turn these classes into `#[wasm_bindgen]` structs:
- Tests reach their fields directly: `engine.run` ×22, `engine._installed` ×13, `engine.cache` ×12, and `new PdfReader(` appears 44 times in 12 test files.
- The Rust side is already written against the JS host object.
- A struct brings back the rule-2 lifetime bug.

Instead add one helper to /home/user/inhouse-read/.claude/worktrees/integ/src/js/readers/rust-ui-required.js (≈+450 B, shared):

```js
export function rustClass(name,dispatch,names,kit,Base=Object){
 const C={[name]:class extends Base{constructor(...args){super();const ui=readerUI();ui[dispatch](this,'constructor',args,kit,ui)}}}[name]
 rustMethods(C,dispatch,names,kit);return C
}
```

- **State:** stays on the JS instance. Rust `constructor` arms create the fields with `Reflect::set` in the original order. No wasm handle, so nothing for the GC to free.
- **Callbacks:** `Function.prototype.bind` on module exports (the readers-5 pattern), never a retained `Closure`.
- **Async methods:** add a rustMethods marker (e.g. `!name`) for a plain function that returns the Rust `crate::eager` promise directly and turns a missing module into `Promise.reject`. The existing `~` marker wraps in `async function`, which adds promise-resolution ticks when Rust returns a promise; do not use it for bodies that contain awaits.
- **Cost:** one crossing plus a string match (0.4–1.1 µs measured in readers-2). Cold paths only.
- **Never dispatched** (stay JS arrows or direct struct-method calls):
  - `canSwipe`, `getMotionSurface`, `theme`, `guardSnap`;
  - PDF `onScroll`/`onWheel`;
  - the ResizeObserver callbacks;
  - picker `render`/`row`/`patchProgress` and its frame paint;
  - `ReaderChrome.resize` (visualViewport scroll);
  - cozy `resolveBuffer`/`takesFor`;
  - the per-code-point Unicode callbacks.

## 2. Blocks, ordered by bytes moved per risk

### Block 1 — orphans and Rust→JS→Rust forwarders (≈11.5 KB, lowest risk; start here)

**1a. Delete four modules with no importer in src (tests only), 2,666 B:**

| File | Bytes | Test files importing it |
|---|---|---|
| speech-highlight.js | 899 | 6 |
| speech-follow.js | 294 | 2 |
| sentence-ends.js | 537 | 1 |
| pdf-page-theme.js | 936 | 5 |

- Move their argument defaults into the existing exports:
  - `String(theme)` into `speech_overlay`/`speech_css`/`speech_style`;
  - `breaks=[]` and the `undefined → TypeError('Unsupported sentence boundaries')` into `speech_sentence_ends`;
  - `coordinates=[]` into `pdf_paint_theme`.
- Repoint the 14 test files at `readerUI()`.

**1b. Remove forwarders that Rust receives through kits; Rust calls its own function instead:**

| File | Bytes | Note |
|---|---|---|
| speech-map.js | 830 | kits of pdf-reader.js:64-69, foliate-reader.js:42-48, foliate-speech-cursor.js:7 |
| pdf-reflow.js | 1,024 | |
| page-snapshot.js | 2,907 | lines 3-22: the four promise helpers become eager futures in page_snapshot.rs |
| speech-page-breaks.js | 534 | the step/yield loop becomes an eager loop; `yieldToMessages` stays a JS function |
| speech-hold.js | 518 | |
| reading-places.js | 368 | |
| reader-interface.js | 410 | |
| language-detect.js | 224 | |
| voice-order.js | 879 | |
| voice-menus.js | 1,126 | |

- Rust design: no new module. In pdf_reader.rs, pdf_speech.rs, foliate_open.rs, foliate_cursor.rs, flow_methods.rs and experience_methods.rs, replace `kit.<fn>` lookups with direct calls to `speech_map`, `snapshot_*`, `reflow_*`, `voice_order`, `voice_options` and so on.
- Keep the JS defaults in a Rust wrapper: `rects=[]`, `isActive=()=>true`, the `{filter='none',…}={}` destructuring with V8's error text, and the `!root&&mode<2` throw in speech-map.js:4.
- Callbacks that are genuinely the browser's stay in one small kit: `localeCompare` collators, `Intl.DisplayNames`, `normalizeLang`.
- Crossings: each use drops from three (JS→Rust→JS→Rust) to one.
- Speed: neutral to faster. All per page, sentence or click; none per frame.
- Proof: existing frozen differentials, unchanged apart from import paths:
  - reference-speech-map.js, reference-speech-highlight.js, reference-speech-follow.js, reference-sentence-ends.js;
  - reference-page-snapshot.js, reference-pdf-reflow.js, reference-pdf-page-theme.js;
  - reference-voice-order.js, reference-voice-menus.js, reference-reading-places.js, reference-speech-page-breaks.js;
  - foliate-reader-wasm (200 sessions), foliate-speech-cursor-wasm (300), pdf-reader-wasm.
- Risks:
  - Tests that `vi.mock` one of these modules and expect the reader to pick up the mock (not checked; page-snapshot.js has 8 test importers, speech-map.js 11). Those must inject through the remaining kit or wrap the export, as rust-dispatch-observer.js does.
  - Microtask count of `beforeDeadline`/`loadImage` if rewritten carelessly; if page-snapshot-font-wait or pdf-page-snapshot-font-wait shift, keep those four helpers in JS (≈0.9 KB).

### Block 2 — PDF text pipeline in one core call (18.3 KB → ≈4.5 KB; medium-low risk; the one block with a real speed upside)

Files:
- pdf-text.js 5,171 B (lines 14-77)
- pdf-row-layout-wasm.js 5,240 B (all)
- pdf-order-wasm.js 2,380 B (all)
- pdf-stream-wasm.js 4,994 B (lines 15-74; `flags`, lines 3-14, stays)
- core-required.js 513 B

Today one page does four marshalling round trips and four alloc/free pairs, with intermediate line objects created three times (`{...lines[i],column}`, `Object.assign`). `extractPDFText` also runs over the whole book in src/js/pdf-book-length.js, so this is a whole-book loop.

Rust design (rust-core, raw ABI, new `pdf_page_text.rs` chaining pdf_text_geometry → pdf_rows → pdf_order → pdf_stream internally):
- Keep the three host-math rounds, because the engine's own Math is the identity contract: `pdf_page_text_a`, `_b`, `_finish`.
- One arena per page, retained across pages as in pdf-row-layout-wasm.js:8-30.
- Input, packed by one JS loop:
  - view[6];
  - per item 13 f64: transform ×6, width, height, trimmed length, length, dir, `flags(text)`, `flags(text without a trailing U+00AD)`;
  - one UTF-16 arena of all `item.str` concatenated.
- The two line-level regexes move to Rust over that UTF-16 arena:
  - `counter` (pdf-order-wasm.js:4) and `listStart` (pdf-stream-wasm.js:4);
  - they are ASCII plus the fixed ECMAScript WhiteSpace/LineTerminator set, with non-unicode `/i`.
- The `\p{Ll}`/Script flags stay in JS: the comment at pdf-stream-wasm.js:5-6 requires the browser's own Unicode tables.
- Output:
  - order permutation;
  - per entry `[x0,x1,y,height,top,bottom,prefix,trim,from,to]`;
  - per line `[first,size,x0,x1,y,top,bottom,height,rtl,pathOffset,pathLength,start,end,soft,paragraph]`;
  - ASCII column paths, total size, rtl.
- Status 0 means "fall back to stream order", exactly where `itemGeometry` returns null or a validation fails today.
- Crossings per page: 1 alloc (0 when retained) + 3 calls + ≤2 `resolveHostMath`.

JS keeps one pack loop and one unpack loop that builds the same objects with the same property insertion order:
- entries `{item,rawIndex,x0,x1,y,height,top,bottom}`;
- lines `entries,x0,x1,y,top,bottom,height,text,rtl,column,start,end,sourceIndices[,softHyphen]`;
- items `{...entry.item,hasEOL}`, spans, paragraphs;
- `fallback()` and `mapPDFTextLayer`.

The per-stage wrappers (`rustPDFRowLines`, `rustPDFOrderLines`, `rustPDFTextStream`) move to tests/unit/helpers as raw-ABI harnesses, as raw-phonemizer-plan.js was; the raw exports stay in the core for them. scripts/benchmark-pdf-row-core.mjs:30 imports pdf-row-layout-wasm.js and must be repointed.

Not in this block:
- pdf-images-wasm.js (4,140 B): the rust-ui bridge was measured slower in readers-1 (1 image 1.6 → 37 µs).
- pdf-figures-wasm.js (3,227 B): it uses `Math.atan2/cos/sin` of the host and line objects. It may later join the same arena, but only with a benchmark.

Speed: expected faster; must be measured on a 300-item and a 5,000-item page and on a whole-book `measurePDFBookLength`. Publish only if not slower.

Proof:
- tests: pdf-text-layout, pdf-reading-order, pdf-row-layout-wasm, pdf-order-wasm, pdf-stream-wasm, pdf-text-geometry-wasm, pdf-layout-wasm;
- frozen references: reference-pdf-text.js, reference-pdf-pipeline.js, reference-before-pdf-rows.js, reference-pdf-order.js, reference-pdf-stream.js, reference-pdf-text-stream.js, reference-pdf-text-geometry.js (the 4000-page differential);
- add a deep-equal including `Object.keys` order.

Risks:
- property order and object identity (lines share the entry objects; pdf-figures reads `line.column`/`line.start`);
- the >32,768-item and partial-geometry fallbacks;
- the JS WhiteSpace set in Rust.

### Block 3 — voice stores, players and clients as rustClass (≈22 KB → ≈3 KB; low-medium)

Suggested order within the block (least coupled first):

| Order | File | Bytes | Class |
|---|---|---|---|
| 1 | package-store.js | 1,421 | NeuralPackageStore |
| 2 | supertonic-store.js (10-25) | 2,308 | SupertonicStore |
| 3 | store.js (23-61) | 4,729 | VoiceStore |
| 4 | player.js | 3,429 | GaplessPlayer |
| 5 | native-player.js | 1,871 | NativePcmPlayer |
| 6 | client.js | 3,485 | SynthClient |
| 7 | native-client.js | 4,261 | NativeSynthClient |
| 8 | native-ort.js (session/createNativeOrt) | part of 2,933 | — |

Rust design: new dispatchers `store_method`, `player_method`, `client_method` beside voice_store.rs, supertonic_store.rs, package_store.rs, neural_player.rs, synth_client.rs, native_synth_client.rs, native_ort.rs.
- Constructor arms reproduce the destructuring defaults: `caches=globalThis.caches`, `fetch.bind(globalThis)`, `stallMs`, and so on.
- `install()`'s AbortController chain, `prepare()`'s promise chain, `_spawn`'s three worker handlers, `_wake`, `_released` and the `inhouse-pcm` listener become bound exports.

What stays in JS from these files:
- the `export const X=rustClass(...)` lines and the constants `CACHE_NAME`, `SUPERTONIC_CACHE`;
- `_run` (native-client.js:44-53) for now; it moves with block 4;
- `NativeTensor`, `encodeTensor`, `decodeTensor`: `Uint8Array.toBase64`/`fromBase64` are native fast paths on tensors of hundreds of KB per ONNX run, so they need a benchmark before any move.

Other notes:
- Crossings: unchanged per method (one dispatcher call instead of one direct export call).
- Speed: neutral; per download, chunk or fragment.
- Confirm that `inhouse-pcm` is not a high-rate clock event before binding the listener through Rust.
- Proof: no frozen copies exist for these shells. First freeze `tests/unit/helpers/reference-voice-shells.js` (the seven classes as they are now) and add a constructor/descriptor differential: own keys in order, defaults, `instanceof`, promise identity of repeated `prepare()`/`install()`. Then the existing suites: neural-voice-store, supertonic-store, neural-voice-packages, neural-voice-player, neural-native-player, neural-voice-client, native-synth-client, native-synth-generation, native-ort, native-model-upload-slices, voice-client-cold-load.
- Risks: V8 destructuring messages; `this.player instanceof NativePcmPlayer` (engine.js:111) needs real classes, which rustClass gives; the tick counts of `promise.finally(...).catch(...)` in `prepare`.

### Block 4 — the synthesis worker's runtime in the voice module (≈19 KB → ≈3 KB; medium)

Files:
- worker.js 10,712 B (lines 30-192: `init`, `releaseVoice`, `load`, `runSegment`, `host`, `drain`, `onmessage`);
- forwarders that exist only for the worker and the native-client kit: synth-flow.js 2,875, hebrew.js 2,196, supertonic-plan.js 1,401, piper-alignment.js 1,262, supertonic-runtime.js 2,546, dictionary-cache.js 1,354;
- phonemizer.js 4,244 → ≈1.5 KB (the Emscripten factory call with its print hooks and the fetch thunk stay).

Rust design: `#[wasm_bindgen] struct VoiceWorkerRuntime` in voice_worker.rs.
- It owns: ort, phonemizer, hebrew, supertonic, session, config, voice, durationOutput, the jobs map, loadChain and drainDone.
- `message(m)` returns an eager promise.
- `runSegment` builds the `int64` tensors with `js_sys::BigInt64Array`; this runs once per sentence, in front of hundreds of ms of inference.
- Kernels are called Rust-to-Rust, not through the `host` object; this removes the getter crossings per job.
- Lifetime: retained in a module-level `let runtime` in worker.js and never dropped (rule 2).

worker.js keeps a ≈1.5 KB bootstrap (rule 3):
- the pre-init routing table of line 157: a stray cancel/free or an invalid synth must not download wasm;
- `bootstrapDiagnostics` and `stage(1,1)`;
- on `init`, start `import(ortBase+'ort.wasm.min.mjs')` (a Vite-ignored dynamic import must be JS) and `requireRustVoiceUI()` in parallel, so the ORT download is not queued behind the voice wasm; then hand both promises to `VoiceWorkerRuntime`.

Speed: neutral; per message or sentence.

Proof: there is no frozen copy of the worker. First freeze `tests/unit/helpers/reference-voice-worker.js` and write a scripted-message differential with a fake ORT and phonemizer, comparing every `postMessage`, stage receipt and release in order. Scripts to cover:
- init/load/synth/cancel/free interleavings;
- retransmitted ids;
- load during drain; free during init;
- init failure, then retry.

Then the existing suites: neural-voice-worker-runtime, neural-voice-worker-lifecycle, neural-worker-memory, voice-worker-plan, pcm-synthesis-integration, the Hebrew harness, supertonic-runtime-reference.

Risks:
- microtask order around `loadChain`/`drainDone`;
- `String(error?.stack||error)` text;
- tests/e2e/phonemizer-rebuild.spec.mjs serves raw modules (already noted as not serving rust-voice-ui.js);
- the Android client (native-client.js) imports the same forwarders, so convert its kit in the same commit.

### Block 5 — engine, facade and audio (≈25 KB → ≈2.5 KB; medium-high)

**engine.js, 11,665 B:**
- `LIMITS` (26-41) becomes a Rust table exported frozen.
- `FragmentCache` (44-51) and `NeuralEngine`'s constructor (76-104), getters and async `refresh`/`install`/`remove`/`warmUp` (117-160) go through eager.
- Closures `_arm`/`_handlers`/`_emit`/`_listen`/`_aborter`/`_prepare` (176-189) become bound exports in neural_engine.rs.
- JS keeps `defaultCreateClient`'s `new Worker(new URL('./worker.js',import.meta.url),{type:'module'})`, because Vite must see it, and the one rustClass line with `Base=EventTarget`.

**index.js, 11,503 B (about half is contract documentation, which becomes Rust doc comments):**
- `NeuralVoiceEngine`: `preload`'s adopt loop (79-107), the generation tokens, `speak`'s failure path (155-163), `stop`/`release`/`pause`/`cancelCurrent`.
- Goes to a new neural_facade.rs via rustClass(EventTarget).
- JS keeps the two dynamic imports as a kit thunk and `getNeuralEngine`/`setNeuralEngine`.

**audio.js, 2,040 B:**
- The context/native/sequence state becomes thread-locals in rust-ui, plus `audio_reset` for tests.
- `unlockAudio` stays synchronous inside the tap (a direct export call).

Speed: neutral; per fragment, chunk or tap.

Proof:
- Freeze `reference-neural-voice-index.js` and `reference-neural-engine-shell.js`.
- Facade differential: random op scripts (speak/stop/release/pause/warmUp/prime/extendUpcoming while the import is pending, failing, or failing then succeeding) with a recording fake core, comparing calls, events and the microtask step at which each happens.
- Existing: neural-voice-index, neural-voice-facade-plan, neural-voice-engine(+review), neural-voice-buffering, neural-voice-prefetch, neural-cached-order, neural-voice-lifetime, neural-reader-release, voice-switch, audio-diagnostic-state-wasm, reading-voice-native-media.

Risks:
- the facade must never be reachable before rust-ui (see section 0);
- `static isSupported` is called on the class;
- `window.InhouseReadAudioDiagnostics` reads `getDiagnosticState` without loading anything;
- the test hook in neural-runtime.js:10-15 splices `neuralVoices`.

### Block 6 — reader shells (≈40 KB → ≈10 KB; medium-high because of pointer and frame paths)

Order within the block:

1. **The five `constructor(){return new Rust…}` shims** — reader-controls.js 359, reader-lists.js 145, reader-navigation.js 144, reader-view.js 193, select-menu.js 216. They disappear once the ReaderExperience constructor builds the Rust structs directly.
2. **Flows** — reader-lifecycle.js 530, preference-flow.js 674, voice-flow.js 512, reader-actions.js 1,015, reader-chrome.js 1,268. Become `constructor` arms of flow_method. Keep `ReaderChrome.resize` as a direct call (visualViewport scroll).
3. **reading-voice.js, 3,259 B** — constructor (21-27) and the four small members into voice_methods.rs; the four window listeners become bound `voice_event`.
4. **foliate-speech-cursor.js, 2,167 B** — remaining members (`reset`, `browse`, `returnToSpeech`, `close`, `next`, `currentSource`) into foliate_method, via eager for the async ones.
5. **reader-experience.js, 5,856 B** — constructor (46-79), `jump`, `step`; the ResizeObservers get `view.syncMiniPlayerLayout.bind(view)` (one crossing instead of two).
6. **neural-picker.js, 6,816 B** — constructor (44-56), `install`/`remove` (66-74, eager), kit schedulers (26-30) as bound exports. `render`/`row`/`patchProgress` stay direct `RustNeuralView` method calls.
7. **foliate-reader.js, 7,009 B** — `open`, `next`/`prev`/`goTo*`, `getSpeechSource`, `applyPreferences`, getters via eager. This removes the reason readers-3 gave for keeping them. JS keeps the foliate-js imports, the `Overlayer.outline` patch, and `canSwipe`/`theme`/`guardSnap`.
8. **pdf-reader.js, 6,866 B** — `makeSource`/`stage`/`detach` (37-61) as bound exports in pdf_speech.rs; `open`'s gesture table (80-107) except `canSwipe`, `getMotionSurface`, `onScroll`, `onWheel`. JS keeps the pdfjs imports, `workerSrc` and the kit of PDF.js objects.

reader-controller.js (2,083 B) is not converted: it is constructed before wasm (app.js:51). Only its comments shrink.

Speed: neutral.

Proof: reference-foliate-reader.js (200 sessions), reference-foliate-speech-cursor.js (300), reference-pdf-reader.js, reference-reader-experience-policy.js, reference-reader-chrome/-lifecycle/-preference-flow/-voice-flow/-reader-actions.js, reference-picker-*.js, reference-voice-*.js, rust-methods-dispatch.test.js (extend its known-member list), foliate-reader-leaks, pdf-reader-leaks, and the ten e2e specs adapted in readers-4.

Risks:
- microtask counts in the foliate turn methods (the session differential logs order; add tick positions);
- listener leak checks (`ui_live_handles`);
- class-field timing: fields exist before the constructor body, so the Rust arm must set fields first.

### Block 7 — VoiceClientPlan (5,585 B, plus src/js/rust-voice-core.js 852 B outside the unit; needs an owner decision)

- Design: compile rust-core/src/voice_client.rs (7.1 KB, pure ledger) into rust-ui and the voice module with `#[path]`, as phonemizer_runtime.rs and supertonic_catalog.rs already are, and expose a `VoiceClientPlan` struct with the same methods. It is retained by the client, worker or facade that owns it and freed in `dispose`.
- Effect: the raw voice-core wasm is no longer fetched at first play (one fetch and one compile fewer). `message()`/`workerActive()` become in-module calls instead of JS→raw core, with no `writeKey` loop.
- Why a decision is needed: it changes which asset loads, and the meaning of `cold` (client-plan.js:35) and `bootstrapId`; `NativeSynthClient.synth`'s cold branch becomes unreachable.
- Proof: voice-client-plan, voice-worker-plan, neural-voice-facade-plan and helpers/raw-phonemizer-plan.js pin the ledger. voice-client-cold-load and neural-voice-core-required will need adapting.
- Do this after blocks 4 and 5.

### Block 8 — leftovers (≈4.5 KB; low)

- **reading-preferences.js:** delete the JS twins (lines 20-24, 41-44, 70-79; ≈1.9 KB). They are unreachable in production: the module imports catalog.js, whose supertonic-catalog.js top-level-awaits the app core, so the core exists whenever this file evaluates. Fail with `coreRequired` instead. Proof: reader-preferences-wasm.test.js, reference-reading-preferences(-runtime).js. Note: `reading-preferences-policy-wasm` ×8 already fails on main; decide the single owner (policy vs core) here.
- **cozy-sounds.js:38-48 (`loadAtlas`, ≈0.9 KB):** into cozy_atlas.rs (shelf module; fetch once after the first gesture).
- **neural-runtime.js (≈1.5 KB of 2,637):** into rust-ui with the dynamic import as a thunk. It has 40 test importers, most of them mocks: lowest priority.

## 3. What must stay JS, with bytes

| What | Bytes | Why |
|---|---|---|
| speech-text.js, speech-pipeline.js, speech-plan.js | 4,302 + 1,810 + 630 | UTF-16 unit packing (a `&str` crossing would lose lone surrogates and offsets); assembling thousands of fragment objects per chapter (rule 1); `properties`/`letters`/`cjk` use the browser's Unicode tables |
| pdf-stream `flags` + the new PDF pack/unpack | ≈4,500 | Browser Unicode properties; one object per text item |
| pdf-images-wasm.js | 4,140 | Measured slower through rust-ui |
| pdf-figures-wasm.js | 3,227 | Host Math, line objects; revisit only with a benchmark |
| core-call.js, core-required.js, core-bridge.js | 1,748 + 513 + 488 | Raw-ABI arena helpers, also used by content-freshness-plan.js |
| reading-preferences.js (rest), reading-preferences-wasm.js, reading-palette.js | ≈3,300 + 2,460 + 1,035 | Run before rust-ui/shelf, over the raw core |
| reader-experience-lazy.js | 4,512 | Built at app.js evaluation; the JS path before a policy module exists (rule 3) |
| reader-controller.js | ≈1,400 | Constructed before wasm |
| catalog.js, supertonic-catalog.js | 3,074 + 3,779 | Top-level await on the core, load-time URL overrides, 310 start-up records (rule 1) |
| voice-catalog.js | ≈3,800 | Language tags needed before rust-ui; `Intl.DisplayNames` |
| cozy-sounds.js (rest) | ≈5,000 | Preference read at import; Vite asset URLs; per-impact take choice and buffers measured 0.72 → 9.85 µs in Rust; settings bind before the shelf module |
| cover-encode.js, cover-encode-worker.js | 2,055 + 561 | A worker entry and `createImageBitmap`/`toBlob` plumbing |
| zip-memory-io.js | 1,790 | Subclasses zip.js's `BlobReader` and defines a `WritableStream` sink; injected by scripts/foliate-archive-patch.mjs |
| task-yield.js | 740 | MessageChannel yield |
| phonemizer-assets.js | 1,617 | Dynamic import and Emscripten instantiate hooks |
| worker.js bootstrap | ≈1,500 | Pre-wasm routing, dynamic imports |
| native-ort.js tensor codec | ≈1,200 | Native base64 fast path |
| reading-state.js, persistable-position.js | 511 + 370 | Imported by app.js, bookshelf.js, cloud-sync.js, drive-client.js before the reader |
| rust-ui-required.js with rustClass | ≈1,800 | The shared helper |
| Residual one-line class definitions, kits and third-party imports (foliate-js, pdfjs-dist, the Worker URL) | ≈17,000 | Vite/third-party bindings and the hot-path arrows of section 1 |

## 4. Notes for the implementer

- Rule 1: no block adds a per-entry Reflect loop. Block 2 removes object churn; every other block is per click, page, sentence or message.
- Rule 2: only two new wasm structs appear — `VoiceWorkerRuntime` (module-level `let` in worker.js) and, if block 7 is approved, `VoiceClientPlan` (field of its owner, freed in `dispose`). Add a forced-GC test like reading-display-lifetime for each.
- Rule 3: the bootstrap exceptions are listed in section 3; do not route them through `readerUI()`.
- Unverified in this pass:
  - which tests `vi.mock` kit modules;
  - how `pdf_paint_theme` is reached from pdf_reader.rs;
  - the event rate of `inhouse-pcm`;
  - whether `loadNeural()` can run before rust-ui outside the reader.
- The frozen Android installer under vendor/inhouse-services-updater/ is not touched by any block.

Sources read:
- /home/user/inhouse-read/.claude/worktrees/integ/docs/rust-migration.md
- /home/user/inhouse-read/.claude/worktrees/integ/docs/remaining-wip-verification.md
- the unit's files under /home/user/inhouse-read/.claude/worktrees/integ/src/js/readers/ and /home/user/inhouse-read/.claude/worktrees/integ/src/js/cozy-sounds.js
- /home/user/inhouse-read/.claude/worktrees/integ/rust-ui/src/controller_methods.rs, host.rs, eager.rs
- /home/user/inhouse-read/.claude/worktrees/integ/rust-core/src/voice_client.rs