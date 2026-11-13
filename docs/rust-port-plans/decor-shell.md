PORT PLAN — unit decor-shell (read-only analysis of /home/user/inhouse-read/.claude/worktrees/integ, branch integ-bar-5)

## 0. Verdict first

The unit is 192,505 B of JS in 20 files. After 1.7.326 almost all of it is one of four things that the hard rules already exclude:

- three.js object construction (measured slower through Rust: decor-1 BAGGEBO 3.39 -> 5.85 ms, bin 2.10 -> 3.28 ms);
- per-frame typed-array marshalling that is already one raw call;
- pre-wasm bootstrap that runs at module evaluation;
- late-binding import tables.

Realistically movable: about 20-24 KB (11-12 %) in 7 blocks. About 170 KB must stay, of which about 42 KB are full-line comments (they count in the bar; I do not propose deleting them as a "port").

Nothing was built or run. Every speed statement below is an expectation to be measured, except where a doc figure is quoted.

## 1. Ordered blocks (bytes moved per risk)

### Block 1 — lamp-occlusion and back-panel shader text (cold, lowest risk), about 5.5 KB

**JS to move**
- `src/js/shelf-light-occlusion.js` L24-93 (about 4.6 KB): the `PARS` GLSL template (L36-62, about 1.9 KB, including the three `${FAR.toFixed(1)}` which must render as `1000000.0`), `SHADERS`, and `installShelfLightOcclusion()` (L64-92: the three guards, four `.replace`, the `lights_pars_begin +=`, the uniform install on 5 ShaderLib entries).
- `src/js/shelf-lighting.js` L21-37 (about 0.9 KB): the body of `widePenumbra`'s `onBeforeCompile` (three replaces) and the cache key.

**Rust design**
- Module `rust-ui/src/shelf_light_rig.rs` (already holds `shelf_firm_bleed`, `shelf_panel_shadow`, `occluder_records`).
- `shelf_lamp_occlusion_patch(pars_begin: &str, fragment_begin: &str) -> Option<Box<[JsValue]>>` returns the two patched chunk strings; `None` reproduces the guards (missing point/spot/area means nothing changes; missing `geometryPosition` line means only `lights_pars_begin` grows, exactly as today, where pars is appended before the second guard).
- JS keeps 6 lines: read two chunks, 1 crossing, assign two chunks, and the 5-entry uniform loop (it shares the module-level `cabinet`/`boards` Float32Arrays, which must stay JS because `applyShelfOccluders` writes them per render).
- `shelf_panel_fragment(fragment: &str, lights_begin: &str, taps: u32) -> String`: 1 crossing per program compile (one program per session).
- Crossings: 1 per page and 1 per panel program. Strings only, no Reflect.

**Rule 3 handling**
- `installShelfLightOcclusion()` runs at import (L93).
- Replace with `const s = getRustShelf(); s ? install(s) : whenRustShelf(install)`, plus an explicit idempotent `installShelfLightOcclusion()` at the top of `createBookshelfScene` and of the studio open.
- Both already call `needRustShelf()`, so no lit program can compile before the patch.
- In vitest the shelf module is loaded synchronously, so the import-time path of `shelf-light-occlusion.test.js` L48 keeps working.

**Speed**: cold path (once per page).

**Identity proof**
- Extend `tests/unit/shelf-rig-wasm.test.js` (already compares shaders and cache keys on 7 screens against frozen originals).
- On a fresh THREE (`vi.resetModules`), compare `ShaderChunk.lights_pars_begin` and `lights_fragment_begin` byte for byte between production and `tests/unit/helpers/reference-shelf-light-occlusion.js`.
- Add the three degraded-three cases (renamed point line, renamed position line, missing ShaderLib entry).
- For the panel: compiled `fragmentShader` and `customProgramCacheKey` against `reference-shelf-lighting.js`.
- Existing `shelf-light-occlusion-wasm`, `shelf-lighting-wasm` and `bookshelf-lamps` stay green; the visual 24 states are unchanged.

**Risks**
- An E2E that loads the scene module in a page where the shelf wasm fails: today the chunk is patched anyway; after the move it is not, but no scene exists without the shelf module, so this is equivalent.
- Double install: keep the `installed` flag in JS.

### Block 2 — local-folder-store remainder (cold, low risk), about 2.6 KB

**JS to move** (`src/js/local-folder-store.js`, 5,146 B)
- `sanitizeFileName` L82-99 (about 1.0 KB, the UTF-16 arena loop into raw core).
- `openHandleDB`/`wrap`/`getSavedFolderHandle`/`persistFolderHandle`/`chooseFolder` L37-71 (about 1.4 KB).
- The top-level `await requireCore(...)` L26 and its two imports.

**Rust design**
- Module `rust-ui/src/folder_store.rs` (ui/cloud build; already has `save_file_into_folder(handle, file, sanitize: Function)`, `get_or_choose_folder(saved, choose)`).
- Drop the `sanitize`, `saved`, `choose` Function parameters; do them natively.
- Sanitize: port `rust-core/src/file_name.rs` logic as a shared `#[path]` include operating on UTF-16 units (`JsString::iter()` / `char_code_at`, so lone surrogates survive).
- IDB: reuse the request/transaction-promise helpers of `rust-ui/src/library_store.rs` (data-sync-3).
- Exports: `folder_saved_handle()`, `folder_choose()`, `sanitize_file_name(name) -> JsString`. One crossing each.
- JS keeps `isFolderApiSupported` (sync, pre-module, used by app.js hosts) and one-line `withCloudModule` forwards.
- `sanitizeFileName` has no other src caller (grep: only tests). If the test needs it sync, export it as `withCloudModule`-async and adapt only the frozen-reference comparison harness, or keep a sync export via `getRustShelf()` if `folder_store` is also in the shelf build.

**Speed**
- Cold (only when a folder book is opened or saved).
- Side benefit: one fewer top-level-await module in the start-up graph (`app.js` imports this file statically).

**Identity proof**
- `tests/unit/local-folder-store-differential.test.js` against `reference-local-folder-store.js`, plus `local-folder-store.test.js`.
- Add 4,000 random names including reserved runs, lone surrogates, empty string (gives "libro"), and names over 8,192 units.

**Risks**
- `getSavedFolderHandle` is called by `legacy-book-recovery.js` and the reader-opening host; it becomes "await module, then IDB", one extra microtask hop before the IDB open. Check the `app-reader-opening-native-differential` ordering assertions.

### Block 3 — lamp catalogue studio recipe (cold, per tap), about 3.8 KB

**JS to move** (`src/js/lamp-catalog-preview.js`, 6,134 B)
- `removeModel` L26-36.
- `make` L44-100: model traversal for glass shadow and anisotropy, fixture SpotLight/PointLight plus target, stage surfaces Box/Circle, camera, Box3 centring, `dataset.lightEmitter`.
- `release` L113-116.

**Rust design**
- Module `rust-ui/src/catalog_studio.rs`, next to `studio_open_three` and `studio_lamp_stage` (app-shell-6 already builds three objects through the `THREE` namespace there, same cold class).
- `studio_lamp_make(record, three, model, lamp, stage_state) -> JsValue` and `studio_lamp_remove(record, model)`, holding `fixture`/`target`/`surfaces`/`display`/`presentation` on the studio record object instead of JS closure variables.
- JS keeps: `await ensureAreaLights()` (top-level, rule 3); `createShelfLamp` (three builder); `createShelfLampLighting` for filaments; `applyTint`/`retint`/`beforeDraw` (these run per studio frame, so they stay JS).
- 1 crossing per selection; inside, about 150 Reflect ops for a 10-mesh lamp.

**Speed**
- Slower in absolute terms (estimated tens to hundreds of microseconds on a tap). Allowed by the rule (not per frame, per pointer move, or per book at start-up).
- Measure with the decor-1 method (15 alternating rounds of 10). Do not publish if a selection gets over 1 ms slower.

**Identity proof**
- Frozen `tests/unit/helpers/reference-lamp-catalog-preview.js` and `reference-catalog-studio.js` exist.
- Differential: for every catalogue lamp at 3 kelvins, traverse both studios' scenes and compare, in order: class, name, position/quaternion/scale bits, light colour/intensity/distance/angle/penumbra/decay, castShadow/receiveShadow, geometry parameters, material colour/roughness, map anisotropy, camera position, `display.position`, `size`.
- Then the existing 60 random scripts per studio (catalog studio differential) and the E2E catalogue states.

**Risks**
- Order of `display.add` calls (render order of equal sort keys).
- `emitter.intensity *= stage.filament` mutates the model's emitter in place; keep it as the same single mutation.
- Rule 2: no Rust struct is created (the state lives on a JS record), so nothing to retain.

### Block 4 — one recipe call per shelf plant (start-up speed block), about 1.5 KB

**JS to change** (`src/js/shelf-plants.js` L112-186, `createShelfPlant`)
- Today a plant costs about 14 shelf-module crossings: `plant_appearance`, `plant_lifecycle_state`, `plant_finish_material`, `plant_pot_surface`, `plant_leaf_surface`, `plant_leaf_material`, `plant_extra_materials`, `plant_soil_surface`, `plant_bake_get` or `plant_bake_build`, `plant_surface_keys`, `plant_pot_key`, `plant_bake_remember`, `plant_dispose_unused`, plus 3 `plant_surface`.

**Rust design**
- Module `rust-ui/src/plant_build.rs` / `plant_surface_policy.rs`.
- `plant_recipe(state, paintHost, entry, geometry, potColor, persist)` returns one pre-shaped literal built with a fixed key order (the book-model-7 lesson: never grow the object key by key from Rust; create it in one small JS factory imported by the glue, or fill a JS-made literal).
- Shape: `{appearance, finish, leafOptions, extra, potMaps, leafMaps, soilMaps, bake, baked, surfaceKeys}`.
- Surfaces are requested inside Rust in the same order: pot, leaf, soil. The paint queue order is observable in progressive paint.
- JS then makes the 6 materials and `restoreContent` in one pass, as now.
- Target: 2 crossings per plant (recipe; finish/lifecycle host install).
- `restoreGeometry`/`restoreContent`/`dataTexture` stay JS.

**Speed**
- Expected faster per plant at start-up (fewer crossings and fewer `JsValue` returns). Must be measured.
- Bench `createShelfPlant` for 12 plants, 15 alternating rounds, against the frozen copy. Publish only if at or below JS.

**Identity proof**
- `shelf-plants.test.js`, `shelf-plant-quality`, `plant-model-wasm`, `plant-surface-queue-rust`, `plant-catalog-models`, `plant-catalog-color-update`, with frozen `reference-shelf-plants.js`.
- Add a differential over every catalogue plant x pot x 2 qualities comparing material properties, texture identity sharing, `userData`, `parts`, and the queue order (spy on `paintHost.painters`).

**Risks**
- `refresh` closure identity is passed to surfaces (`notify`); the lifecycle must exist before the surfaces are requested.
- Re-entrant texture `dispose` events during `own`.
- Medium risk for a small byte gain; do it only for the speed.

### Block 5 — lamp light frame in 2 fixed crossings (per frame, publish only if measured at or below JS), about 2.5 KB

**JS to change** (`src/js/shelf-lamp-lighting.js`: `update` L296-356, `updateLight` L236-287, `reconcile` L143-166)
- Today per frame: `lamp_root` (2 slice copies), `LampPoolState.plan` (3 slice copies in, 1 copy back, each a wasm malloc/free in the glue), then one `LampLightFrame.sample` per lit slot (up to 8).
- That is 2 + N crossings and about 6 transient allocations.

**Rust design** (`rust-ui/src/lamp_light.rs`)
- A retained `LampRoomFrame` struct. Rule 2: held in the `createShelfLampLighting` closure and freed in `dispose`, replacing `pool`, `lightFrame` and the per-slot `LampLightState` handles, which become a `Vec` inside it.
- One arena viewed from JS, re-viewed when `memory.buffer` changes:
  - header: `transform[16]`, `middle`, `shadowDirty`, `count`, `total`;
  - `slots[3 x total]`: kind, keyId, lit;
  - `candidates[7 x count]`;
  - per-slot light input `[86]`: the present lightIn 0..15 and 82..102;
  - output: plan events, then per slot `[found, lit, power, flags, 20 light values]`.
- Call A, `plan()`: root, quota and plan. JS learns which candidate each slot has.
- JS then does `model.updateWorldMatrix(true, false)` only for those models (as today, so no extra matrix updates) and writes their matrices and emitters.
- Call B, `sample_all()`: every slot's light.
- JS applies outputs to three lights (stays JS: about 25 property writes per light).
- `rankKeys` stays a JS callback (`localeCompare`), invoked only on membership change, as now.
- Slot add/remove (`createSlot`/`removeLights`) call `frame.slot_added(kind)`/`slot_removed(index)` (cold).
- Filament area path (catalogue studio only, `filamentAreas: true`): keep on the existing `LampLightState.filaments` call.

**Speed**
- Honest expectation: neutral to slightly faster. The doc measures the whole JS `update` at 0.05 ms for 300 entries / 12 lamps; the previous Rust attempt (`lamp_entries.rs`, Reflect per entry) was 0.66 ms and was reverted.
- This design has zero Reflect. Reproduce that exact benchmark; publish only if at or below 0.05 ms.

**Identity proof**
- `tests/unit/lamp-lighting-wasm.test.js` against `reference-shelf-lamp-lighting.js`, `lamp-light-state`, `bookshelf-lamps`, `lamp-scene`, E2E `lamp-switches`.
- Warning: `lamp-lighting-wasm` is one of the 12 unit tests failing on main 1.7.325, and E2E `lamp-switches` 136 also fails on main. The guard for this block is currently red. Diagnose and fix it first, otherwise identity cannot be proven.

**Risks**
- Stamp semantics of `lightIn[102]` (raw non-number emitter values).
- Shadow invalidation flags.
- Order of `assign` events.
- Highest risk per byte in the unit; do it last or skip it.

### Block 6 — SPIKE: static JS imports from the shelf module instead of the `shelfEnv` table, about 4.7 KB (+ potential)

**JS to move** (`src/js/bookshelf.js` L74-155, `shelfEnv`)
- About 75 `(...args) => f(...args)` late-binding entries that Rust reads with Reflect.get by name.

**Rust design**
- `#[wasm_bindgen(module = "#ihr/…")] extern` blocks in `rust-ui/src/bookshelf/*` (shelf feature only, `cfg`-gated so the `ui` build does not import shelf modules).
- Use a bare specifier resolved by a package.json `"imports"` entry or a Vite + vitest alias. Do not use a `/path`: wasm-bindgen copies those into `snippets/` and would duplicate the module.
- ESM live bindings preserve "a module replaced after the shelf was built is still the one called" (`vi.mock`).
- Calls become direct imported-function calls: no property lookup, no interned string.

**Speed**
- Faster per call than Reflect.get + call. If it works, this is the general remedy for rule 1 on warm paths.

**Go/no-go spike (1 function, e.g. `markTiming`)**
- (a) The generated glue keeps the bare specifier and Vite and vitest both resolve it.
- (b) The import cycle glue <-> app modules does not hit TDZ. `decor-catalogue.js`, `content-freshness.js` and `local-folder-store.js` use top-level await; block 2 removes one.
- (c) `scripts/build-rust-ui.mjs` post-processing and the offline-shell manifest hash still work.
- (d) `bookshelf.test.js` mocks still intercept.

**Identity proof**: `bookshelf.test.js`, `reference-bookshelf.js`, the app-shell differentials, full E2E.

**Risks**: build-system risk is high, runtime risk low. Not started without the spike passing.

### Block 7 — app.js per-flight callback factories (cold; risk above gain), about 3 KB

**JS to move** (`src/js/app.js`)
- `openingCallbacks`, `openingCancellation`, `pickerCancellation`, `filePickerFocusListener` (L329-342).
- `fileReaderCallbacks` (L364-368).
- `reprepareRunner`/`preparationRunner` (L401-402).
- `coverPatchGuard`/`coverFlowCallbacks` (L488-495).
- `closeHandoff`/`closeStillRemoval`/`closeProgressFlush` (L521-523).

**Rust design**
- Closures made in the matching `rust-ui/src/app_*.rs` module, owned by a per-flight Rust record that is dropped on settle.
- This is exactly the lifetime class that produced the 1.7.326 bug "closure invoked recursively or after being dropped" (`RustReadingDisplay`), and the docs chose GC-owned JS adapters deliberately.
- Only do it with `Closure::once_into_js` for strictly once-called callbacks, and keep the JS adapter for everything that may be called 0 or N times.

**Speed**: neutral (cold).

**Identity proof**
- The existing `app-*-native-differential` tests (resource-cycle counts included).
- Add a forced-GC E2E like `reading-display-lifetime`.

**Recommendation**: last, or never.

## 2. Must stay JS (with bytes and reason)

Bytes are the remainder after the blocks above.

| File | Stays (approx.) | Why |
|---|---|---|
| `app.js` | 30 KB of 33.9 | See below the table. |
| `bookshelf.js` | 8 KB of 12.9 (12.9 if block 6 fails) | Public handle with `shelfCtxLive` guards, which retains the `shelf_mount` context (rule 2); `DEFAULT_TEXTS` holds JS functions; 2.8 KB of API documentation comments. |
| `shelf-lamp-lighting.js` | 18 KB of 20.3 | Owns three lights (create/dispose/apply about 25 properties per light per frame), per-frame candidate reads (`classList`, `rect`, `userData`), `localeCompare` ranking, the dynamic `import()` of the 250 KB area-light tables, the `localStorage` regex at start-up. Per-entry reads through Reflect were measured 13x slower (0.66 vs 0.05 ms). |
| `shelf-plants.js` | 11.5 KB of 13.0 | three materials, geometries and objects from the bake (decor-1 measured Rust slower); `paintHost` adapters; texture `dispose` listeners. |
| `bookshelf-layout.js` | 11.5 KB (all) | Tables frozen at import (rule 3). `layoutShelves`, `buildSections`, `planBookshelf` were ported in decor-2 and reverted in decor-4 as slower (per book at start-up: per-book property reads plus `displayWidthFor`/`plantWidthFor` callbacks plus `Intl.Collator`). Only `spineStylesFor` is Rust (0.995 -> 0.720 ms). |
| `shelf-light-occlusion.js` | 5 KB of 9.7 | The shared `cabinet`/`boards` Float32Array uniforms; `applyShelfOccluders` runs in `scene.onBeforeRender` (per render) and is already 1 raw core call over a retained arena; `shelfOccluders` builds three vectors from one call. |
| `shelf-lighting.js` | 6.3 KB of 7.2 | `createShelfLighting.update` is per frame, already 1 raw call over a 47/19 f64 arena; the rest applies results to the three light and shadow camera. |
| `shelf-lamps.js` | 9.0 KB (all) | three materials, textures and meshes from Rust descriptors and the geometry packet; `setPower`/`setTint` run per frame during fades and are already 1 raw call over the scratch. |
| `lamp-catalog-preview.js` | 2.3 KB of 6.1 | Top-level `await ensureAreaLights()`, per-frame tint and filaments, hook wiring. |
| `plant-dimensions.js` | 5.2 KB (all) | 2.7 KB comments; the rest are constants frozen from `tables` at import (rule 3, read by other modules at their own import) and one-line forwards. `padTapRect`/`nearestTapTarget` are called per pointer event and are already one crossing each; do not touch. |
| `baggebo-model.js` | 4.7 KB (all) | three objects from one packet; the Rust build was measured slower (3.39 -> 5.85 ms) and runs at start-up. |
| `native-room-cache.js` | 9.5 KB (all) | Drives `renderer.copyFramebufferToTexture`/`render`, GL state save/restore, context-lost listeners. `compose` runs per frame during gestures. Policy and shaders are already Rust. |
| `content-freshness.js` | 8.3 KB (all) | 3.8 KB comments. `startedFrom` and `__inhouseDeployed` must be read while modules evaluate; the launch decision is taken before the shelf module is in, on the raw core (no wasm-bindgen: no DOM or fetch there); the three "untouched" listeners must be registered at evaluation. Moving it to rust-ui would delay a new-deploy reload until the big module arrives, which is not behaviour-identical. |
| `live-room.js` | 6.5 KB (all) | The bootstrap that loads the module ("Rust cannot govern its own module loading"), per-peer RTC and data-channel handlers. `onmessage` carries peers' gesture motion, a per-pointer-move rate, so it must be a JS handler doing exactly one crossing, as it is. |
| `library-store.js` | 5.3 KB (all) | `indexedDB.open` in the constructor and `listRaw` start before any wasm so the first paint is not delayed (documented, measured by app-shell-5); the class is one-line forwards. |
| `drive-client.js` | 5.8 KB (all) | The stored sign-in (`hasDriveSession`, `getRememberedDriveProfile`) is read by the shelf before any module loads; `handleInhouseNativeOAuth` must exist at evaluation for MainActivity; `import.meta.env`; the `later` table. |
| `local-folder-store.js` | 2.5 KB of 5.1 | `isFolderApiSupported`, forwards, 2 KB limitation comment. |
| `studio-environment-cache.js` | 5.1 KB (all) | The IDB read starts at import on purpose (atlas ready while the app loads); `readRenderTargetPixelsAsync` and `DataTexture` are three; the half-float scan is already Rust. |
| `idle-startup.js` | 4.8 KB (all) | By its own header it runs before WASM; the shelf module adopts its state later. Timers and listeners scheduled pre-adoption must keep their identity. |
| `offline-shell-worker.js` | 8.6 KB (all) | Service-worker realm with no page wasm. Loading wasm there adds fetch + compile to every cold worker start before it can answer the launch navigation, and adds a failure mode to offline opening; the code is all awaits on Cache / fetch / `crypto.subtle`, no CPU work to win. |

`app.js` in detail:
- Imports and wiring.
- The `els` table and listeners that must exist at evaluation: a click before the shelf wasm is in is queued by `withShell` and runs when it arrives. Registering listeners from Rust would drop such clicks, so it is not behaviour-identical.
- The shared `app` state object and the nine host objects (GC-owned adapters, by design).
- The front of `performShelfRefresh`, which must start the IDB read and the 120 ms bake deadline before the module is in (measured need, app-shell-5).
- 4.3 KB of comments.

## 3. GLSL strings and static tables in this unit

- GLSL: the only remaining literals are `PARS` (occlusion) and the `aomap_fragment` replacement in `widePenumbra`; both go in block 1. The native-room replay shaders, the Vogel disk, the bleed floor and the lamp material patches are already Rust.
- Static tables: none are left as literals in these files. `SPINE_PALETTE`, `IKEA_SIZES_CM` and the rest are views of core `tables`, frozen at import. The `els` id list (2.6 KB) and `shelfEnv` (4.7 KB) are wiring, not data.

## 4. Suggested order and totals

1. Block 1 (5.5 KB, cold, tests already in place) — start here; first step is adding `shelf_lamp_occlusion_patch` to `rust-ui/src/shelf_light_rig.rs` and the byte-for-byte chunk comparison in `shelf-rig-wasm.test.js`.
2. Block 2 (2.6 KB, cold; removes a top-level await).
3. Block 3 (3.8 KB, per tap; measure).
4. Block 6 spike (4.7 KB if it passes; unlocks a faster calling convention for other units).
5. Block 4 (1.5 KB; a speed win to be measured).
6. Block 5 (2.5 KB; per frame; needs the red `lamp-lighting-wasm` guard fixed first).
7. Block 7 (3 KB; lifetime risk) — optional.

Total if everything lands: about 23.6 KB. Without blocks 5-7: about 18.1 KB.