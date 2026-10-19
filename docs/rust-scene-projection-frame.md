# Native scene projection and hit-style frame

`RustSceneProjectionFrame` retains the two numeric buffers used to project scene entries and their semantic hit targets. It calls the existing `RustScene.project_entry` / `hit_entry` calculations directly in native memory. The JS adapter packs browser-owned Three matrices and reads stable output copies, avoiding wasm-bindgen's temporary input/output allocations on both calls for every entry.

The native arena also owns the previous numeric style values for each entry. It returns dirty bits for the button's position/size/depth order and its cover hit target's position/size/display/events. JavaScript applies DOM assignments in the same order as before; it still owns all nodes, strings and model objects. The comparison policy has moved to Rust without retaining browser references there.

A replacement node resets its history. A recreated cover target resets only its cover history. Layout refreshes already reset every entry's host style cache, so they also reset the native rows. NaN remains dirty on every call, while positive/negative zero compare equal, matching the previous JS `!==` conditions. Projection outputs remain stable if a subsequent model callback grows WASM memory; the adapter refreshes native input/output views after growth. Disposal releases all native numeric rows and is idempotent.

Geometry, hit padding, visibility, quality selection, texture resolution and rendering remain unchanged. The existing public Rust projection functions remain available for callers and differential verification.

## Validation

- 1,200 frames × 12 entries compare exact projection/hit outputs against the original public native entry points and exact style-write order against the frozen former JS policy. The sequence covers frontal/isometric modes, book/plant/lamp entries, drag/away/disabled flags, trash/insertion, viewport changes, node replacement, recreated covers and reordered entries; more than 5,000 stationary cases produce no style writes.
- Additional cases cover NaN, infinities, signed zero, WASM memory growth between projection and hit calculation, repeated arena resizing and disposal.
- Existing scene geometry, scheduling, metadata and independent full-scene transcript suites verify the surrounding behavior.

## CPU microbenchmark

Run `node scripts/benchmark-scene-projection-frame.mjs`. It first verifies output bytes and style-write checksums, then takes medians over 31 alternating rounds. Measurements include both projections, host packing/result reads and the old/new style decision paths. They exclude DOM layout, renderer/GPU work and battery use; these are not whole-app frame-rate claims.

A shared development-host run on 2026-10-19 measured milliseconds per synthetic frame:

| Entries | State | Previous bridge | Native bridge | Ratio |
| ---: | --- | ---: | ---: | ---: |
| 24 | Stationary | 0.01615 | 0.01117 | 1.45× |
| 24 | Moving | 0.02495 | 0.01515 | 1.65× |
| 96 | Stationary | 0.15329 | 0.11963 | 1.28× |
| 96 | Moving | 0.23613 | 0.15934 | 1.48× |
| 240 | Stationary | 0.78289 | 0.43567 | 1.80× |
| 240 | Moving | 1.13267 | 0.63804 | 1.78× |

Shared host load affects absolute timings. The script reports all measured scenarios, including the smaller gain.
