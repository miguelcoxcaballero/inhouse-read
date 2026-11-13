# Port plan, unit "book" (read-only analysis of /home/user/inhouse-read/.claude/worktrees/integ, branch integ-bar-5)

Nothing was edited, built or run. Line ranges and byte counts are from `sed`/`wc` on the worktree.

## 0. Findings that shape the plan

1. **Why the bridges exist.** `binding-wasm.js`, `bookmark-wasm.js`, `page-mesh-wasm.js`, `book-view-wasm.js`, `cover-relief-wasm.js` and `shelf-placement-wasm.js` all marshal into **rust-core**, a raw `cdylib` with its own memory (`alloc_f64`/`free_f64`, pointer arguments). The shelf module (rust-ui, wasm-bindgen) is a second wasm with a second memory.
2. **Side effect of that split.** Rust in the shelf module that needs a core kernel calls back into JS: `modelHost()` (book-model.js 575-597) carries `surfacePixels, notchPixels, paperBuffers, pageBlock, leafStack, binding, bookmark, fit, random, paintCloth…` only for that reason. `rust-ui/src/core_bridge.rs` records that driving the core from rust-ui costs 20-100 µs against 1-8 µs.
3. **Precedent for removing the split.** rust-ui already compiles rust-core sources with `#[path]`: `shelf_lib.rs:33-36` (jsmath, cabinet) and `voice_lib.rs` (pcm.rs, supertonic_runtime.rs, which carry `#[no_mangle]` exports). The kernels in this unit depend only on `crate::host_math`, `crate::jsnum`, `crate::jsmath`, and for relief on `crate::{relief, relief_palette, color_mask, cover_seed}`.
4. **Precedent for a typed arena.** `RustSceneProjectionFrame` and friends: a retained wasm-bindgen struct with boxed arenas, `memory()` and `*_ptr()`, and JS views over `memory.buffer`.
5. **Host Math must stay batched.** The kernels need the engine's `Math.sin/cos/pow/hypot/atan2` for bit identity (`host_math.rs`). A binding at 96 segments asks about 291 values, a ribbon about 300 per frame. One `js_sys::Math` import call per value would be slower than today's batch (my estimate, not measured).
6. **Tests that pin the core.** Unit tests and e2e specs call or spy on raw core exports: `binding-wasm.test`, `page-mesh-wasm.test`, `bookmark-wasm.test`, `cover-relief-wasm.test`, `rust-binding-core.spec`, `rust-page-mesh-core.spec`, `rust-relief-*.spec`, `rust-shelf-placement-core.spec` ("publicCalls > 0"). So the kernels stay in rust-core as well (same source file, two modules), and specs that count core calls are re-aimed at the shelf export, not relaxed.

## 1. The one generic typed bridge: "core-in-shelf" plus one arena

**Rust (shelf feature), in `shelf_lib.rs`:** add `#[path="../../rust-core/src/…"]` modules at crate root, same names so `crate::` paths resolve: `host_math`, `jsnum`, `binding`, `bookmark`, `page_mesh`, `book_view`, `shelf_placement`, `relief`, `relief_palette`, `color_mask`, `cover_seed`. Mount the core's `cover_relief.rs` as `relief_jobs`, because rust-ui already has its own `cover_relief`. Their `extern "C"` functions become ordinary Rust calls.

**New `rust-ui/src/book_arena.rs`:**
```rust
#[wasm_bindgen] pub struct RustBookArena { scratch: Vec<f64>, out: Vec<u8>, ribbons: HashMap<usize, Ribbon>, view: Box<[f64; 128]>, math: HostMath }
#[wasm_bindgen] extern "C" { pub type HostMath;
  #[wasm_bindgen(method, structural)] fn resolve(this: &HostMath, requests: u32, results: u32, count: u32); }
impl RustBookArena { #[wasm_bindgen(constructor)] pub fn new(math: HostMath) -> Self; pub fn memory(&self) -> JsValue; pub fn view_ptr(&self) -> usize; /* block methods below */ }
```
- `resolve` receives byte offsets into the shelf memory. One crossing per host-math round, no handles, no allocation.

**New `src/js/shelf-arena.js` (about 1.2 KB), replacing every per-bridge `arena()/take()/align8/at()/withMesh/refreshViews`:**
```js
let arena, memory, buffer, F64, F32, U16, U32, U8;
const sync = () => { if (buffer !== memory.buffer) { buffer = memory.buffer; F64 = new Float64Array(buffer); F32 = new Float32Array(buffer); U16 = new Uint16Array(buffer); U32 = new Uint32Array(buffer); U8 = new Uint8Array(buffer); } };
export function bookArena() {            // module-level reference: never garbage collected (rule 2)
  if (!arena) { const rust = needRustShelf();
    arena = new rust.RustBookArena({ resolve(req, res, n) { sync(); /* host-math.js switch over F64[req>>3 …] */ } });
    memory = arena.memory(); }
  sync(); return arena; }
export const f64 = () => (sync(), F64), f32 = () => (sync(), F32);
export const copy = (Type, ptr, length) => new Type(memory.buffer.slice(ptr, ptr + length * Type.BYTES_PER_ELEMENT));
```
- Whole-memory views are rebuilt only when the buffer identity changes. Today each kernel call allocates two `Float64Array`s and an array literal.
- `sync()` also runs at the top of `resolve`, because memory can grow inside the call.
- The arena is created lazily on first use, after `requireRustShelf()`; nothing at import time (rule 3).
- This pattern also fits `book-surface-wasm.js`, `book-motion-wasm.js` and `shelf-model-layout-wasm.js`, which are outside this unit.

Bar accounting: `#[path]` reuse adds no Rust lines; the gain is JS removed.

## 2. Ordered blocks (bytes moved per risk)

### Block 1: relief pipeline as one Rust job (start here; about 22-24 KB of JS, cold path, no arena needed)

**JS that goes**
| What | Where | Bytes |
|---|---|---|
| Whole file: `arena`, the six `wasm*` generators, `wasmReliefRgbaPlanes`, `withLinearTable`, `jobShape`, `openJob`, `stepJob`, `wasmAnalyze`, `wasmMaps` | `src/js/cover-relief-wasm.js` 1-292 | 17,383 |
| Generator bodies become job wrappers: `analyzePixels`, `buildMapsFromPixels`, `buildColorLayerMaps`, `composeReliefLayerPixels`, `heightToNormals`, `composeMaterialMap`, `shadePreview`; bodies of `buildReliefMaps`, `updateReliefMapStrengths`, `reliefPlanesToRgba` | `src/js/cover-relief.js` 121-189 and 287-322 | about 5-6 KB of 18,020 |
| `reliefKey`, `reliefStrengthKey`, the per-pixel alpha loop in `setCoverRelief`, and the copy-out/copy-in around `composeMaterialMap` in `bakeReliefMaterial` | `src/js/book-model.js` 505-509, 553-560, 514-516 | about 1.2 KB |

**Rust design.** New `rust-ui/src/relief_job.rs`:
```rust
#[wasm_bindgen] pub struct ReliefJob { /* owned planes + stage machine */ }
#[wasm_bindgen] impl ReliefJob {
  pub fn analysis(data: &[u8], width: u32, height: u32) -> Option<ReliefJob>;
  pub fn maps(data: &[u8], width: u32, height: u32, layers: &[f64] /* r,g,b,tolerance,heightMM × n */, single: bool) -> Option<ReliefJob>;
  pub fn render(width: u32, height: u32, flags: u32, unit: f64, strengths: &[f64]) -> Option<ReliefJob>;
  pub fn put(&mut self, which: u32, plane: &[u8]); pub fn put_f32(&mut self, which: u32, plane: &[f32]);
  pub fn then_render(&mut self, flags: u32, unit: f64);        // fused maps -> compose -> normals -> RGBA planes
  pub fn then_material(&mut self, options: &[f64]);            // fused composeMaterialMap
  pub fn step(&mut self) -> i32;                               // same codes and same yield points as relief_job_step / relief_render_step
  pub fn value(&self, which: u32) -> f64; pub fn colours(&self) -> Vec<f64>;
  pub fn take_u8(&mut self, which: u32) -> Vec<u8>; pub fn take_rgba(&mut self, which: u32) -> Clamped<Vec<u8>>; pub fn take_f32(&mut self, which: u32) -> Vec<f32>;
}
```
- The sRGB linear table is computed in-module (`relief_linear_table` is already rust-ui), so `withLinearTable` disappears.
- The policy calls (`relief_map_mode`, `relief_sorted_layers`, `relief_classification_layers`, `relief_selected_layers`, `relief_material_options`, `relief_normal_unit`) are already in `rust-ui/src/cover_relief.rs` and become internal calls.
- Crossings per job: one create (pixels copied once, as today), the same number of `step()` calls as today, one copy-out per returned plane.
- The fused `buildReliefMaps` no longer copies owners/mask/height out to JS and back in: about six fewer 262 KB plane copies per 512 px build.
- Rule 2: the job is held by the generator frame and freed with `job.free()` in its `finally`; no reliance on GC.
- JS keeps one stepper: `function* run(job) { try { for (;;) { const c = job.step(); if (c === 0) return; if (c < 0) throw …; if (c === 1) yield; } } finally { job.free(); } }`.

**Speed.** Cold and sliced; expected faster (fewer copies). It does run per book at start-up for books with a saved relief (`if (book.coverRelief) ud.setCoverRelief(...)`), so measure `buildReliefMaps` at 256 and 512 px before and after.

**Identity proof**
- Freeze the current `cover-relief-wasm.js` as `tests/unit/helpers/reference-cover-relief-wasm.js`, driven with the rust-core instance. `reference-relief-bridge.js` already freezes the older kernel passes.
- Differential, byte for byte, on every returned plane plus `stats.slices` (the yield count): `cover-relief-wasm`, `cover-relief-job-wasm`, `relief-pipeline-wasm`, `relief-planes-wasm`, `relief-preview-wasm`, `relief-palette-wasm`, `relief-pigment-wasm`, `relief-policy-native`, `multicolor-cover-relief(-persistence)`, `color-cover-relief`, `book-cover-relief`, `cover-normal-selection-wasm`.
- e2e: `rust-relief-editor`, `rust-relief-palette`, `rust-relief-planes`, `rust-relief-preview`, `rust-normal-selection`.

**Risks**
- A `#[no_mangle]` core name colliding with a wasm-bindgen export in the shelf module would be a link error. I compared the name lists and saw none (core has `relief_linear_set`, `relief_analysis_new`…; shelf has `relief_linear_table`, `relief_analysis_report`…).
- Returned shapes must stay exact: `Uint8ClampedArray` for normal/height/foil/gloss (hence `Clamped`), `Float32Array` baseHeight, the `pixels` object keys, and `foil: new Uint8Array(count)`.
- `null` versus throw on rejected input must match (`native()` turns null into `TypeError`).
- The 200,000-colour profile test in `cover-relief-job-wasm` already times out under load.

### Block 2: arena plus all book meshes in one call (about 20 KB; per book at start-up, and per frame for the ribbon)

**JS that goes**
| What | Where | Bytes |
|---|---|---|
| Whole file | `src/js/page-mesh-wasm.js` | 6,080 |
| Whole file, except `createBindingRelief`, which becomes a 300 B record `{pixels, width, height}` | `src/js/binding-wasm.js` | 4,952 |
| Whole file | `src/js/bookmark-wasm.js` | 4,828 |
| `paperMeshGeometry`, `pageBlockGeometry`, `leafStackGeometry`, `bookCase`, `boardFrom`, `capFrom`, `bookCaseGeometries`, `bindingGeometry`, `boardGeometry`, kernel half of `bookmarkGeometry` | `src/js/book-model.js` 43-171 | 8,629, replaced by a 1.5 KB installer plus the 1.2 KB GPU-buffer-reuse half of `bookmarkGeometry` |
| `modelHost` entries `paperBuffers, pageBlock, leafStack, binding, bookmark, surfacePixels, notchPixels` | `src/js/book-model.js` 575-597 | about 0.6 KB |

**Rust design.** On `RustBookArena`:
- `book_meshes(width, height, thickness, flags /* shelf|overview|detail|bookmark */, segments, relief_rows, rim, leaf_depth, relief: Option<Vec<u8>>, relief_w, relief_h) -> Vec<u8>`.
  - Returns one packed blob: a fixed u32 header (per mesh: vertex count, index count, byte offsets, groups, index width), then aligned f32 and u16/u32 data for case front, case back, caps, pastedown, paper, page block, leaf stack and binding.
  - Internally it runs plan_a for all meshes into one request block, one `math.resolve`, plan_b, a second `resolve`, then the finishes.
  - Crossings per book: one call, two resolves, one blob copy. Today it is about 25 core calls and about 30 typed-array allocations.
  - JS installs `subarray` views of the blob, as `bookCase()` already does for `book_case_geometry`.
- `ribbon(width, height, thickness, progress, peek, open, withdraw, segments, seed, legacy) -> u32` returns a pointer to `[count, positions, uvs, normals, indices]`. Per-step state (topology, crowd constants) is cached in the struct; JS does `attribute.array.set(F32.subarray(...))`. Per frame: one call plus two resolves, against one `bookmark_steps`, three kernels and two JS loops today, with zero allocation.
- `book_model_build.rs` then calls the kernels directly for the ribbon, binding rebuild, leaf stack and notch/surface pixels instead of `call(host, "bookmark" | "binding" | "leafStack" | …)`.
- An arbitrary relief callback (test-only path in `rustBindingBuffers`) must be sampled in JS, in the original order, before entering Rust. Calling JS back inside a `&mut self` method that could re-enter would abort ("recursive use").

**Speed.** Expected faster at start-up and equal or faster per frame. Gate with `tools/bench/run-book-model-bench.mjs --page-compare --cpu-time` and the block-7 crossing counter:
- shelf, 40 books × 21 rounds: at or below 368.2 ms;
- shelf, 20 × 21: at or below 139.6 ms;
- overview, 20 × 15: at or below 79.1 ms;
- lifted, 8 × 15: at or below 89.5 ms;
- `--view-compare --motion` draw: at or below 0.0744 ms per frame;
- crossings per shelf book: below 5,891.

Revert the block if any median is slower.

**Identity proof**
- `binding-wasm`, `page-mesh-wasm`, `book-paper-planes`, `bookmark-wasm` re-pointed to compare the arena output with the unchanged core kernels through today's bridges, frozen as `tests/unit/helpers/reference-mesh-bridges.js`, byte for byte.
- Existing frozen references: `reference-binding-geometry.js`, `reference-page-mesh.js`, `reference-bookmark-geometry.js`, `reference-book-case.js`.
- `book-case-wasm`, `book-model-build-wasm` (6), `bookmark-buffer-reuse`, `bookmark-progress-reuse`, `bookmark-single-leaf`, `bookmark-motion-pose`, `book-absent-bookmark-motion`, `book-model`.
- e2e `rust-binding-core` and `rust-page-mesh-core`, re-aimed.

**Risks**
- Attribute classes and types must match exactly: `BufferAttribute` versus `Float32BufferAttribute`, `geometry.type`, the Uint16/Uint32 switch at 65535, `normalVersion`, groups.
- Tests that assert returned arrays are owned and not views of wasm memory: the blob is an owned JS buffer, but several arrays now share one `ArrayBuffer`.
- Geometry creation order is unchanged, so ids stay the same.

### Block 3: book-view planner in the shelf module (about 6.5 KB; per frame)

**JS that goes**
| What | Where | Bytes |
|---|---|---|
| `REGION` arena, `planReturnFrame`, `planCopyRectangle`, `planBookPose`, `frameAligned`, `boxScreenBounds`; `planBookView`, `fitImage`, `planPageZoom`, `planReadingPose`, `planPageBounds` become direct module calls | `src/js/book-view-wasm.js` | about 5.5 KB of 8,202 |
| `copyRectangle`, the planner part of `returnFrame`, `projectBookBoardBounds` marshalling, `planReadingBookPose`, `mixPaperTone` host objects | `src/js/book-model.js` 172-211, 662-694, 718-722, 801-826 | about 1.5 KB net |

**Rust design.** `book_view.rs` included natively; a fixed 128-f64 `view` region in the arena.
- `view_pose()`: JS writes the pose and current state at fixed offsets, makes one call, and reads the nine placed numbers from the same view. No allocation.
- `view_window(stage) -> u32`: one call returns the return frame, the aligned flag, the copy rectangle and the board bounds together. It keeps the lazy protocol (code 2 means "measure bounds, then call again"), because `Box3.setFromObject` and `projectVisibleBookBounds` must stay conditional.
- `paper_mix(mix)`: the six sRGB numbers are written once when the tones are set. Today every `draw` with the stock page visible does `book_paper_mix(target, stock, theme, mix, host)` with four object handles and two callbacks.
- In `book_model_build.rs`, `host.fit` (lines 465 and 550, once per cover paint, so per book at start-up) becomes a native `book_view::fit_image` call. That removes a JS callback, a core call and four Reflect reads per book.

**Speed.** `draw` goes from about 6-8 core crossings with about 15 small allocations to 2-3 crossings with none. Expected faster. Gate: bookView draw at or below 0.0744 ms per frame and creation at or below 23.7 ms per view (`--view-compare --cpu-time`).

**Identity proof.** `book-view-wasm` (13 tests: 100,000 views, 300,000 …) against `reference-book-view.js`; `book-view-host-differential` (7); `book-view-motion-native`; `book-direct-presentation`; `book-renderer-contexts` (3 already fail on main); the 24-state visual comparison.

**Risks**
- The `dataset.boardBounds` JSON string must be produced by JS `JSON.stringify` from the same doubles.
- `planReturnFrame` mutates `motionState.motionCapacity` and `nativeCapacity`; the write-back must be preserved.
- `bookshelf-return.js` and `bookshelf-scene.js` (other units) keep using the core copy of these kernels.

### Block 4: `createBookModel` numeric recipe and native random streams (about 6 KB; per book at start-up)

**JS that goes**
| What | Where | Bytes |
|---|---|---|
| The arithmetic in `createBookModel`: board, turn-in, joint, paste sizes, page front, positions, repeat factors, reflection strengths and uv scales, cap finish choice, leaf depth, relief arming | `src/js/book-model.js` 259-446 | about 4 KB of 14,051 |
| `seededRandom`, `randomStates`, `paintField` and `paintCloth` shells | `src/js/spine-surface.js` | about 1.8 KB of 7,660 |

**Rust design**
- `book_model_recipe(book, style, width, height, thickness, flags, inspection, pixel_ratio) -> Float64Array`: one call returning quality, every size and position, four finish records and five reflection records. It replaces `book_model_plan` (an object built by Reflect), `book_weave_strength`, four `book_apply_material_finish` calls, five `reflection_setup` calls and `textSeed`.
- JS stays a straight-line installer reading `r[i]` and creating three's objects **in the same order** (material ids decide the render sort).
- Random streams become a native `struct Stream(u32)` in `spine_surface.rs` and `book_model_build.rs`. Today Rust calls the JS `random()` closure once per value (`paint_relief` lines 277-278, `paint_cloth_callback`), which in turn fetches batches of 64 from Rust.
- The cloth plan is computed natively (`book_cloth.rs` by `#[path]`) and handed to JS once as `replayCloth(c, designWidth, fieldWidth, pixels, commands)`.

**Speed.** Expected faster: about 15 calls and about 150 Reflect writes per book become one call plus JS property writes, and the per-value random crossings disappear. Same bench gate as block 2.

**Identity proof.** `book-model-build-wasm` (compares every material, uniform, program key and userData with `reference-book-model.js`), `book-model-policy`, `book-reflection-surface`, `book-reflection-profile-wasm` (20,000 seeds), `spine-surface-wasm` (1,500 spines, operation by operation, against `reference-spine-surface.js`), `spine-random-rust`, `spine-weave-wasm`, `book-model-textures-wasm`, the visual comparison.

**Risks**
- The recipe is built from `book`/`style` reads; read each property once.
- Tests importing `seededRandom`/`paintCloth` from production must be re-pointed.

### Block 5: cover-appearance orchestration (about 9-10 KB; cold, sliced)

**JS that goes** (`src/js/cover-appearance.js`, 14,909 B): `fontMask` 87-106, `scoreFamily` 112-132, `remoteFontScore`/`runRemoteFamily` 162-180, `matchTitleFont` 182-219, `loadCandidateFonts` 221-232, the body of `analyzeCoverAppearance` 235-305, `withCoverAppearance` 307-322, `coverAspectRatio`, `coverColorFromPixels`, `glyphMask`, `nearEdgeMap`.

**Rust design.** New `rust-ui/src/cover_appearance.rs` in the shelf module.
- A synchronous step machine, `AppearanceJob::step() -> code`, where each step is one mask raster or one policy decision. The canvas is driven with the typed context bindings of `spine_surface.rs`.
- JS `runInSlices` keeps driving it, so the 2 ms slice budget, `yieldToMain` and `shelfWorkReady` ordering are untouched.
- Worker scoring goes through the existing `rust-ui/src/font_score_client.rs`.
- Glyph, colour and wrap kernels are called natively if `font_glyph.rs`, `cover_color.rs`, `font_prepare.rs` and `font.rs` are `#[path]`-included; otherwise through the existing font bridges as host functions.
- `withCoverAppearance` and `coverAspectRatio` become direct exports.

**Speed.** Cold. The per-plan work is a canvas text raster and a 200 KB `getImageData`; boundary cost is negligible. `withCoverAppearance` runs per book at refresh: measure 200 books and keep it in JS (0.9 KB) if slower. Precedent: titles 6.08 ms against 1.57 ms, comparator 5.24 against 0.34.

**Identity proof.** `cover-appearance.test`, `cover-font-readiness`, `cover-font-worker-integration`, `bookshelf-cover-appearance`, `font-score-*`, `font-glyph-wasm`, `font-policy-wasm`; e2e `cover-appearance.spec` (production against `reference-cover-appearance.js`) and `cover-glyph-production.spec`.

**Risks**
- `tests/e2e/helpers/cold-return-build-fixture.mjs` patches `src/js/cover-appearance.js` by path, so the file must keep existing.
- Promise ordering: `matcherTurn` serialisation and the decode timeouts of 1200/3000 ms.
- `toLocaleUpperCase` and `document.fonts.load` stay host calls.

### Block 6: shelf-placement numeric tail and drag session (about 3.5-4 KB; per pointer move)

**JS that goes** (`src/js/shelf-placement-wasm.js`, 16,659 B): the arena half of `executePlacement` 191-233 (row limits, config block, alloc/copy/validate/free), the numeric part of `preparePlacement` 180-189, and `rustShelfPlacement` 127-131, which has no production caller (only tests and one e2e spec).

**Rust design.** `shelf_placement.rs` native.
- `#[wasm_bindgen] struct PlacementJob { input: Vec<f64>, cfg: [f64; 7], … }`, built once per layout or drag session from one `&[f64]` (count × 7).
- `run(pin, shelf, x, has_target) -> ptr`; the output is read from the arena view.
- The job is held by the session closure and freed in `dispose()` (rule 2).
- Per move: one call with four numbers. Today it is alloc, `input.set`, `shelf_place`, slice, free.

**Speed.** Expected faster on the numeric part. Gate with the earlier measurement: 0.07-0.13 ms at 40 objects and 0.2-0.7 ms at 300 objects per layout or move.

**Identity proof.** `shelf-placement-wasm`, `shelf-placement-session`, `shelf-physical-placement-wasm`, `shelf-placement-preview(-wasm)`, `shelf-placement`, `bookshelf-placement(-preview)-ui` against `reference-shelf-placement.js`; e2e `rust-shelf-placement-core/session`, `shelf-placement-rust-integration`, `rust-physical-layout`, re-aimed.

**Risk.** `normalize`, `dataOnlyInputs` and hydration must not be touched: the full Rust port measured 1.8-2.1 ms against 0.07-0.13 ms, and 11-13 ms against 0.2-0.7 ms, and was withdrawn.

### Block 7 (optional, performance): canvas display list for the spine and cover painters

Not a bytes block.
- `spine_surface.rs` and the cover painter account for most of the 5,708 crossings per shelf book, one import call per canvas operation.
- Emit a staged command buffer (opcodes and numbers in a `Float64Array` plus one joined string table): a measure batch, then layout, then a paint batch, replayed by a JS interpreter of about 1.5 KB. That is 3-4 crossings per spine.
- Identity: the op-by-op recorder of `spine-surface-wasm` (1,500 spines) and `book-paint-wasm` sees the same sequence.
- Risk: medium (measureText round trips, gradients and patterns as handles). Do it only if the bench shows a gain; it adds JS.

### Block 8 (last, low value per risk): relief decode/raster and `setCoverRelief` orchestration (about 4 KB)

`decode`, `raster`, `toCanvas`, `thumbnailOf` (cover-relief.js 193-261) and `setCoverRelief`/`bakeReliefMaterial` (book-model.js 510-574) are promise, timer and abort orchestration. In Rust this needs `JsFuture`, which adds microtask hops and can reorder against concurrent bakes. Only with a dedicated differential on revision and abort races (`multicolor-cover-relief-persistence`, `book-cover-relief`).

## 3. What stays JS, and why (about 75 KB of the unit's 160 KB)

| JS | Bytes | Reason |
|---|---|---|
| book-model.js: `createBookModel` three wiring, after block 4 | about 10 KB | Measured: blocks 3-6 assembled through the boundary and were 20-25% slower (15,073 against 8,698 crossings per book; a state object grown from wasm becomes a slow dictionary). The object-creation order also decides material ids and the render sort. |
| book-model.js 448-503: `setCoverOpen`, `updateRibbonGeometry`, `setBookmarkWithdraw`, `setMotionPose`, `setPageTheme`, `applyPageTheme` | 2.9 KB | Every frame of a flight; pure three.js property writes. |
| book-model.js 709-906: `compactBounds`, `copyFrame`, `configureFrame`, `positionPresentation`, `captureSnapshot`, `lazyExports`, `placeModel`, `returnFrame` shell, `draw`, `hasCurrentNativeFrame`, `updateBookmarkFrame` | about 12 KB | Per frame: `gpu.render`, `model.traverse`, canvas `drawImage`, DOM style and dataset writes. |
| book-model.js: `modelHost`, `viewHost`, `viewState` | about 4 KB after trimming | Pre-shaped literals so V8 keeps fast objects (block 7 finding); callback tables. |
| book-model.js 598-661: renderer getters, `lightBookScene`, presentation preparation host | 3.1 KB | Singletons holding three objects; already thin shells over Rust. |
| book-model.js: `spineGrazingFade`, `installCoverRelief`, `laminate`, `blankPageMap`, async relief skeleton (until block 8) | about 5 KB | `onBeforeCompile` binds and promise ordering; five per book, already minimal. |
| book-model.js: geometry installer and ribbon buffer reuse | about 2.7 KB | Creates three attributes; the reuse logic is pinned by the bookmark-reuse tests. |
| spine-surface.js: `scratchRaster`/`releaseScratch` (canvas pool, `queueMicrotask` lifetime), `paintClothPlan` (measured: about 9 crossings per slub × about 150 slubs from Rust), `host` table, thin exports, `WEAVE` | about 5 KB | DOM canvases; measured slower in Rust. |
| cover-relief.js: constants (`COLOR_RELIEF_IDS`, `RELIEF_IDS`, sizes), `decode`, `raster`, `toCanvas`, `thumbnailOf`, async API shells, `run`/`abortable`/`runSliced` | about 8 KB | Constants are read at import by `book-colors.js` (rule 3). The rest is Image/canvas/timers/AbortSignal. |
| cover-appearance.js: `runInSlices`, `yieldToMain`, `SLICE_MS`, `readCoverAspectRatio`, decode shell, `FONT_CANDIDATES`, re-export of `scoreFontMask` | about 4-5 KB | The scheduler shared by relief and font matching (MessageChannel ordering); the file is patched by path in an e2e fixture. |
| shelf-placement-wasm.js: `configuration`, `placementFor`, `normalize`, `snapshot`, `joinShelves`, `dataOnlyInputs`, `place`, hydration loop, session shell | about 12.5 KB | Measured 25-45× slower in Rust. It reads host objects (with observable accessor order) and builds `{...object}` results. It could only move if its callers read typed arrays instead of objects, which is outside this unit. |
| book-view-wasm.js remainder: writes camera/world matrices and boxes into the arena | about 2.5 KB | The inputs are three.js arrays. |
| New `shelf-arena.js` plus the `host-math.js` switch | about 2.2 KB | The engine's own `Math` is the identity contract. |

## 4. Gates for every block

1. Freeze the JS being replaced under `tests/unit/helpers/reference-*.js` before deleting it, and add a differential test.
2. Run the bench medians above with `--cpu-time` (the box is shared; wall clock is noise). Any per-frame, per-pointer-move or per-book-at-start-up number slower than the frozen JS means the block is reverted.
3. Every wasm-bindgen struct is held by a module-level variable or a session closure and freed explicitly (`ReliefJob` in `finally`, `PlacementJob` in `dispose`, `RustBookArena` never).
4. Nothing new at import time: the arena and jobs are created on first use after `requireRustShelf()`.
5. The frozen installer under `vendor/inhouse-services-updater/` is not touched by any block.
6. Known pre-existing failures, not to be attributed to these blocks: `book-renderer-contexts` (3), `bookshelf-scene-matrices` (2), `bookshelf-scene-veneer` under load, and the `cover-relief-job-wasm` 200,000-colour timeout.

Files read for this plan: `/home/user/inhouse-read/.claude/worktrees/integ/src/js/{book-model,cover-relief,cover-relief-wasm,cover-appearance,spine-surface,book-view-wasm,page-mesh-wasm,binding-wasm,bookmark-wasm,shelf-placement-wasm,host-math,core-tables,geo-packet,rust-core,rust-shelf,rust-loader}.js`, `/home/user/inhouse-read/.claude/worktrees/integ/rust-ui/src/{shelf_lib,core_bridge,packet_host,geo_packet,book_case,scene_projection,book_view_host,book_model_build,spine_surface,cover_relief}.rs`, `/home/user/inhouse-read/.claude/worktrees/integ/rust-core/src/{abi,host_math,binding,bookmark,page_mesh,book_view,shelf_placement,cover_relief,relief}.rs`, `/home/user/inhouse-read/.claude/worktrees/integ/docs/rust-migration.md`, `/home/user/inhouse-read/.claude/worktrees/integ/docs/remaining-wip-verification.md`.