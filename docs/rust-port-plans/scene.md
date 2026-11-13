# Port plan: unit "scene" — `src/js/bookshelf-scene.js` (189,810 B, 3,056 lines)

Read-only analysis of `/home/user/inhouse-read/.claude/worktrees/integ`; nothing was built, run or measured. Byte counts per line range are exact (`sed | wc -c`); "bytes moved" per block and all speed effects are my estimates, not measurements.

## 1. What the file is today

| Lines | Bytes | Content | Path |
|---|---|---|---|
| 1-162 | 9.9K | imports, veneer preload at import, small helpers | import-time / cold |
| 163-720 | 34.3K | closure state, room motion, furniture rebuild, native room leases, hit helpers | cold / event |
| 720-1037 | 19.4K | makeModel, release, replaceWhenReady, updateMaterials, updateRecord (updateTrash excluded) | per book, cold |
| 788-897 | 7.4K | updateTrash | per frame |
| 1038-1238 | 13.1K | stateFor, viewport, measureFitHeight, updateTransform, updateCatalog, advanceLampPower, writeLean | per frame |
| 1239-1556 | 21.0K | updateEntries | per frame |
| 1557-1701 | 8.8K | updatePlantFoliage, drop marker, pointerRay, tapTargetNear, objectAtPoint | frame / pointer |
| 1702-1997 | 19.0K | insertion lease/present/overlay, inspection snapshot | per frame, GL-heavy |
| 2005-2357 | 23.0K | draw | per frame |
| 2358-2552 | 10.5K | invalidate, modal/presentation predicates, flush, trash drop start, observers | event |
| 2553-3056 | 30.3K | public API (updateLayout 9.0K, previewPlacements, returnBook, dispose…) | event |

Three findings shape the plan:

- **`updateEntries` is already numeric in Rust, but JS marshals objects to arenas three times per entry per frame.** `gravityFrame.write` copies 37+9 fields, `copyState` copies 40 back, the non-physics loop copies 29, then 22 go into `entryFrame.input`, plus ~70 output reads. The cause is that persistent animation state (`lift`, `landing`, `preview`, `offset`, `bits`, drag numbers, geometry) lives on JS entry objects.
- **Some per-frame allocation and Reflect work remains in the hot path:**
  - `entry.localMotionPose = [..10]` per moving entry per frame (line 1375);
  - `binBox.set([...9])` twice per frame (1123, 2114);
  - `rust.scene_trash_texts(...)` takes 4 fresh arrays and returns 9 strings each frame (886);
  - `sceneView.transform` returns 14 strings each frame;
  - about 70 `setData(canvas, …)` calls each read `dataset` from the DOM;
  - 5 full `bookEntries.some/for` scans in `draw` (2060, 2130, 2136, 2226, 2301/2317);
  - `rust.scene_quality_hold(bookEntries, …)` does 2-3 Reflect gets per entry on every frame (`scene_quality.rs:113`), which breaks hard rule 1 today.
- **Entry animation state is touched in only about 20 places outside the frame loop**: lines 2391-2400, 2605-2615, 2701-2735, 2802-2839, 2969-2970, 3011-3021. Outside the scene only `gravity-frame.js` reads it. Moving ownership to Rust is therefore tractable.

## 2. Target architecture

One retained struct `RustShelfFrame` in a new `rust-ui/src/scene_state.rs`, created in `createBookshelfScene`, held in a closure `const` and freed in `dispose` (rule 2). It owns the arenas and takes the existing structs (`RustScene`, `RustBookGravity`, `RustRoomMotion`, `RustRoomTransition`, motion/projection frames) as `&mut` arguments at first, then absorbs them.

**Invariant: frame calls take only numbers and other Rust structs, never a `JsValue` or callback.** This means zero Reflect, and no wasm-bindgen "recursive use" panic when JS (`makeModel`) calls Rust between phases.

All arenas are `Float64Array` views over linear memory, using the existing `refresh()` pattern from `scene-entry-frame.js` after any call that may grow memory. They must be f64, not f32: three multiplies `matrixWorld` in doubles, so f32 transport would break bit identity. GPU instanced buffers are not an option either, since each book is a multi-mesh group with its own materials and instancing would change draw order and pixels.

| Arena | Owner / writer | Stride | Content |
|---|---|---|---|
| `STATE` | Rust persistent; JS writes only on events | 50 | 0-28 exactly today's step-io fields (kind, undershelf, bits, dragX/Y, lift×4, landing flag+3, preview×8, offset×2, x, y, w, h, depth, depthInset); 29-39 today's step outputs; 40 thickness; 41 shelf; 42 gripHeight; 43 host flags (hasModel, modelVisible, overview, insertion, overlay, trashDrop, dropComplete, hasNode, quality bits); 44-49 slot box |
| `HIT_IN` | JS per frame, model-bearing entries only | 24 | as today (surface bbox + `surface.matrixWorld`) |
| `OUT` | Rust per frame | ~96 | today's `ENTRY_OUTPUT` (70) + `HIT_OUTPUT` (17) + lean value/dirty, lamp power/dirty, insertion TRS |
| `OPS` | Rust per frame | variable | compact list for dirty entries only: `[index, mask, values…]` for style writes, create/release, visibility flips |
| `LAYOUT_IN` | JS per frame | ~24 scalars | stage/canvas/scroller rects, inner sizes, dpr, clientHeight, scrollTop, visualViewport bottom, trash box |
| `SCALARS` | Rust per frame | ~64 | camera bounds/scroll/ratio, furniture TRS, stage height, catalog/trash targets, shadow bounds, capture plan, counts, daylight, quality hold, decision bitmask |
| `DIAG` | Rust | bitmask + changed strings | shadow table of the ~70 dataset values |

JS keeps a parallel `hosts[i] = { node, model, replacement, book, pose?, lampHull, … }` holding only browser and three objects. The JS frame, after the full migration:

```js
readLayout(LAYOUT_IN);                       // all DOM reads, layout still clean
frame.begin(now, reduced);                   // view, transform, catalog, trash numbers
applyRoom(SCALARS);                          // camera, furniture TRS, stage height
for (i of dirtyNodes) writeDomState(i);      // class/drag text -> 3 numbers (stateFor)
frame.poses(...);                            // gravity + kinematics + motion + matrix + projection
for (op of OPS.models) { create / release / visible; model TRS or matrix from OUT }
for (i of modelBearing) writeSurface(i);     // bbox + matrixWorld -> HIT_IN
frame.hits();
for (op of OPS.styles) writeStyle(op);       // dirty entries only
const plan = frame.plan(...);                // bitmask: paint? shadow? capture mode? hold ms?
renderer / leases / canvases per plan        // stays JS
frame.end(painted); applyDiag(DIAG);
```

That is 4 crossings per frame regardless of entry count, against roughly 12 + N-dependent ones today (`scene_update_quality` per changed entry, `scene_insertion_step`, `scene_lamp_power` per lamp, `scene_corners`, and so on).

## 3. Ordered blocks

Each block is shippable alone. Ordered by bytes moved per risk; block 1 is the keystone.

### Block 1 — Entry state arena, one pose call
- **Move:**
  - `updateEntries` 1247-1365 (~8.6K, leaving ~2.5K of apply code);
  - `gravity-frame.js` `write`/`copyState` (~2K of its 4.2K);
  - `stepBatch`/`stepBatchViews`/`stepIo` (1210-1212);
  - the decoration stamp check 1261-1275 becomes a dirty flag set on events.
- **Rust:** `scene_state.rs` with `STATE` stride 50. Reusing the existing 0-39 field order means `step_entry`, `RustGravityFrame::advance` and `RustSceneEntryFrame::step` bodies are called unchanged on slices of the one arena. New `poses(gravity, scene, motion_frame, room_motion, transition, now, reduced, arranging, use_physics)` chains them.
- **Event writers** go through three tiny JS helpers (`setLift(i,…)`, `setLanding`, `setPreview`) that write `STATE` directly with no crossing. The sites are 2391-2400, 2605-2615, 2726, 2802-2839, 2969-2970, 3020-3021, and reorder offsets at 2036.
- **Row permutation** on `updateLayout` is done in Rust by key, extending `RustGravityFrame::register`, which already takes the key list once per layout.
- **Crossings:** 3-4 become 1 per frame.
- **Speed:** faster. It removes about 110 property reads/writes per entry per frame and the per-entry `subarray` views. The same change in scene-frame-1/2 measured 1.3-6x on its stage.
- **Proof:**
  - Freeze the current marshal path as `tests/unit/helpers/reference-scene-entry-marshal.js` and extend `tests/unit/scene-entry-frame-wasm.test.js` to compare `OUT` bit for bit over both branches. This matters because `scene-differential.test.js` runs with `settleBooks:false`, so the physics branch has no frozen full-scene reference.
  - Also run `scene-differential` (26), `bookshelf-scene-frame-cost`, `scene-book-physics-quality`, `bookshelf-scene-pending-press`.
  - Benchmark by cloning `scripts/benchmark-scene-entry-frame.mjs` at 40/120/300 entries.
- **Risks:** any code or test that reads `entry.lift.value` and similar directly (grep the tests first); a stale view after memory growth; reorder/replace of `bookEntries` at the same length.

### Block 2 — Hit outputs as an op list, rects in the arena
- **Move:** 1403-1425 and 1427-1540 (~8K, leaving ~3K: cover-span creation, lamp hull, style writes).
- **Rust:** `hits()` appends to `OPS` only the entries whose `dirtyStyle != 0`. `rect`/`hitRect`/`tapRect` stop being JS objects; accessors `rectOf(i)` read `OUT` for the cold users (2701, 3011, `tapTargetNear`, foliage).
- **Speed:** faster at rest. Today the loop visits all N entries with ~17 reads each even when nothing moved.
- **Proof:** `bookshelf-scene-frame-cost.test.js` (write counts and order), `scene-entry-frame-wasm` (900-frame hit differential), `scene-differential`.
- **Risk:** the order of style writes must stay entry order. Emit ops in index order.

### Block 3 — Frame decisions in `draw` (`plan`/`end`)
- **Move:** 2054-2076 (casters, contentDirty, daylight, quality hold), 2108-2138 (shadow bounds, cacheInspection/refreshOverview, capture plan), 2254-2325 (counts, diagnostics, moving flags, physics-save and motion-publish conditions). About 9K of the 23K.
- **Rust:** host flags in `STATE[43]` make every `bookEntries.some(...)` scan, the caster-id loop, `countFrame.sample` (1.6K wrapper deleted) and `scene_quality_hold` arena loops. The result is a bitmask plus ~12 numbers in `SCALARS`.
- **Speed:** faster. It removes 5 JS scans plus one Reflect scan per frame.
- **Proof:** `scene-differential`, `bookshelf-scene-shadows`, `-programs`, `-veneer`, `-scheduling`, `scene-quality-wasm`, `scene-count-frame`.
- **Risk:** flag staleness. Every site that sets `insertion`, `trashDrop`, `model`, `qualityReplacement`, `replacementReady` or `plantQuality` must mirror into the arena. There are about 25 sites; wrap them in setters.

### Block 4 — Diagnostics text table
- **Move:** the 70 `setData(canvas, …)` sites: 1133-1146, 838-841 and 870-895, 1547-1554, 2267-2296 (~6K).
- **Rust:** `DIAG` keeps the last written value per key index and formats only when the number changed. The call returns a dirty bitmask and the changed strings; JS does `canvas.dataset[KEYS[i]] = text`.
- **Speed:** faster. A steady frame goes from ~70 dataset reads and ~25 string allocations to none.
- **Proof:** `scene-differential` compares canvas diagnostics after every step; `bookshelf-scene-frame-cost`.
- **Risk:** `setData` compares against the live DOM, so the in-scene `delete canvas.dataset.*` sites (790-792, 1155, 1553) and direct writes (2023, 2360) must call `diag.forget(i)`. If external code or tests write the canvas dataset, the shadow diverges — grep before starting.

### Block 5 — Room numbers in one `begin` call
- **Move:**
  - `viewport` 1058-1101 (3.9K);
  - `updateTransform` 1113-1151 (2.3K);
  - `updateCatalog` 1153-1207 (3.9K);
  - the numeric half of `updateTrash` 788-897 (7.4K);
  - `advanceLampPower` 1213-1232 (1.7K);
  - the insertion step 1410-1424.
  
  About 10K moves; DOM reads/writes and three setters remain.
- **Rust:** `begin()` chains the existing `sizeViewport`, `framePixels`, `scrollOf`, `transform`, `catalogPlace`, `catalogFrame`, `trashStep`, `scene_trash_drop` and `trashFrame`, reading from `LAYOUT_IN`. Lamp power and insertion progress become `STATE` columns.
- **Stays JS:** `trashBox.setFromObject(trash)`, `trash.userData.setState`, `sampleTrashDrop`, `getWorldScale`.
- **Speed:** slightly faster (about 12 crossings become 1; no `[…]` literals or text arrays).
- **Proof:** `scene-view-wasm`, `shelf-trash-scene`, `lamp-scene`, `scene-differential`; a new differential of `SCALARS` against the frozen per-call sequence.
- **Risk:** the read-before-write layout order in `viewport` (pinned by the frame-cost test "reads the rectangles once per draw") and the double `scroller.scrollTop` assignment around `updateTransform` (2031, 2041).

### Block 6 — Room motion publishing
- **Move:** `publishRoomMotion` 268-298 and the `localMotionPose` allocation at 1375 (~3K).
- **Rust:** affected set, rest poses and the 50 ms throttle. JS builds the `poses` array only when an event is actually dispatched (at most 20 Hz).
- **Speed:** faster, with no per-frame array-of-10 per entry.
- **Proof:** the `live-room` / room-motion unit tests plus a new packet differential.
- **Risk:** the test `live-room-transport` is already intermittent.

### Block 7 — Foliage loop
- **Move:** `updatePlantFoliage` 1557-1615 (3.6K, ~2K moves).
- **Rust:** exclusion rectangles are taken from `OUT` instead of the JS scan at 1594-1599; per-plant style ops are emitted.
- **Stays JS:** `projectPlantFoliage` (reads three geometry) and SVG attribute writes.
- **Speed:** neutral to faster.
- **Proof:** the frame-cost tests at lines 86-111, `scene-differential` (foliage hit paths).

### Block 8 — Scheduling predicates
- **Move:** 2358-2480 (`invalidate`, `canDeferModalPaint`, `modalViewportChanged`, `canPresent`, `hasOngoingMotion`, `presentationChanged`, `viewportChanged`, `flushScene`); ~5K of 10.5K.
- **Rust:** a pure state machine; rAF, timers and observers stay JS.
- **Speed:** cold path.
- **Proof:** `bookshelf-scene-scheduling`, `-modal-background`.
- **Risk:** medium, since these tests count renders against a real clock.

### Block 9 — Layout reconciliation by key
- **Move:** `updateLayout` 2863-3004, `adoptMetadataRecords`, the rest of `previewPlacements`, `beginInspectionGesture`; ~5K of 16K.
- **Rust:** keys are sent once as a list; Rust returns an `Int32Array` permutation plus keep/create/release masks; JS reorders `hosts`.
- **Speed:** must be measured. The Reflect version of this measured 0.07 → 6.8 ms and was reverted; the arena version should be neutral.
- **Proof:** `scene-differential`, `bookshelf-scene-metadata-reference`. Ship only if the benchmark is no slower.

### Block 10 (optional, speed only) — Models take the pose matrix directly
- **Change:** `matrixAutoUpdate=false` and `model.matrix.fromArray(OUT, at)` instead of copying position/rotation/scale (1426-1428) and letting three recompose. Saves an Euler → quaternion → compose per model per frame.
- **Identity:** `pose.matrix` is already proven bit-equal to `Object3D#updateMatrix` in `scene-entry-frame-wasm`.
- **Risk:** `bookshelf-scene-matrices` counts `updateMatrix` calls (2 of its tests already fail on main), and insertion/trash flights still need TRS. Do last, and only with a browser profile.

**Totals:** about 55-60K of the 190K moves (file ends near 130K), with the per-frame entry stage, steady-frame DOM reads and per-frame garbage all reduced. Every block also needs the visual comparison (24 states, at most 1/255 against main) before publishing.

## 4. What must stay JS

| What | Lines | Bytes | Why |
|---|---|---|---|
| Imports and veneer preload | 1-75 | ~4.5K | Runs at module import, before the wasm exists (rule 3) |
| `makeModel`, `materialKeys`, `updateMaterials`, `updateRecord`, `refreshBookFonts`, `replaceWhenReady`, release | 633-787, 917-1037 | ~17K | Per-book traversals of three objects; measured 12-17x slower through Reflect in scene-frame-5 |
| Native room leases, framebuffer cache, snapshots | 437-564 | 8.7K | Browser/GL objects and closures the host calls |
| Insertion lease/present/overlay; inspection snapshot compositor | 1702-1997 | ~19K | GL state save/restore, `renderer.render`, canvas `drawImage`; only `insertionFrame`/`snapshotPlacement` maths is movable and already in Rust |
| The render transaction in `draw` | 2139-2245 | ~9K | `withRendererPresentation`, capture, 2D fallbacks |
| `pointerRay`, `objectAtPoint`, `tapTargetNear`, `hitSurface` | 1630-1701, 618-626 | ~5K | three Raycaster over JS meshes, per pointer move |
| DOM reads (`stateFor`, `getBoundingClientRect`) and the apply loops | — | ~8K after shrink | Must be JS, but run over dirty entries only |
| Furniture/occlusion rebuild, lighting calls, observers, timers, promises, public API shells | — | ~55K | three object construction and browser callbacks; cold recipes already in `scene_room.rs`/`scene_host.rs` |

Getting below about 125K would require replacing three.js objects themselves (a Rust-owned scene graph and renderer), which is a different project and cannot be pixel-identical by construction.

Relevant files: `/home/user/inhouse-read/.claude/worktrees/integ/src/js/bookshelf-scene.js`, `src/js/gravity-frame.js`, `src/js/scene-entry-frame.js`, `src/js/scene-count-frame.js`, `rust-ui/src/scene_entry_frame.rs`, `rust-ui/src/scene_entries.rs`, `rust-ui/src/scene_frame.rs`, `rust-ui/src/scene_quality.rs`, `tests/unit/scene-differential.test.js`, `tests/unit/scene-entry-frame-wasm.test.js`, `tests/unit/bookshelf-scene-frame-cost.test.js`, `docs/remaining-wip-verification.md` (lines 27-83).