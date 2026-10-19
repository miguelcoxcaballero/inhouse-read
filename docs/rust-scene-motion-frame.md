# Native scene motion bridge

`RustSceneMotionFrame` owns the numeric bridge between scene pixels, shelf-relative metres in outgoing live previews, incoming remote poses and cabinet-relative checkpoint transitions. It reuses `RustRoomMotion` and `RustRoomTransition`; transport, room revision rules, actor priority and acknowledgement remain unchanged.

The host registers keys and shelf indices only when the scene entry list or a book's cloud identity changes. Each frame shares one row-geometry buffer. Each entry then takes one native call with its already-composed Three pose. This replaces two wasm-bindgen calls, repeated string encoding, temporary input arrays and output copying by those calls. DOM access, Three quaternion/Euler conversion and actual rendering remain browser responsibilities. Rust stores strings/numbers only, without retaining entry/DOM/Three graphs.

Order is deliberate: the outgoing local snapshot comes from the authoritative physical pose; then the remote preview is applied; then a checkpoint transition can apply. Both intermediate host `sceneLean` writes remain in that order. Outgoing arrays remain independent snapshots because the live gesture change detector retains earlier arrays by reference. Arranging suppresses remote previews but does not suppress checkpoint transitions. Invalid/missing bays, final-preview leases, exact expiry boundaries and NaN timestamps retain the previous controller behavior. Native views refresh after WASM memory growth; disposal is idempotent.

## Validation

- A frozen copy of the previous JS bridge is compared to the retained bridge over 650 frames with book/plant/lamp entries, missing bays, resize, reordered/removed entries, changed cloud IDs, gesture ownership, remote packets and checkpoint transitions. Local arrays, Three matrices, rotation order and intermediate lean strings are exact comparisons.
- Additional native tests cover remote actor priority, durable final previews, expiry/acknowledgement, memory growth and repeated registration/disposal.
- Scene metadata coverage verifies that a cloud ID learned after the scene was prepared is used in the next outgoing snapshot, through `updateEntry` and a subsequent metadata adoption, without modifying an earlier snapshot. The metadata-only fast path correctly rejects cloud identity changes; these use `updateEntry` or a layout refresh.
- Existing room-motion, room-physics-sync, scene scheduling and independent scene transcript suites cover the surrounding contracts.

## CPU microbenchmark

Run `node scripts/benchmark-scene-motion-frame.mjs`. The benchmark first compares outputs exactly, then runs 31 alternating timing rounds. It includes host pose packing, independent local snapshots, controller sampling, Three pose writes and matrix updates. These measurements exclude DOM, network, GPU rendering and mobile battery use; they do not establish whole-app FPS gains.

A shared development-host run on 2026-10-19 measured median milliseconds per synthetic frame:

| Entries | Mode | Previous bridge | Native bridge | Ratio |
| ---: | --- | ---: | ---: | ---: |
| 24 | No live preview | 0.02070 | 0.00535 | 3.87× |
| 96 | No live preview | 0.08294 | 0.02793 | 2.97× |
| 240 | No live preview | 0.20615 | 0.07290 | 2.83× |
| 24 | Remote preview | 0.03922 | 0.01493 | 2.63× |
| 96 | Remote preview | 0.16333 | 0.06855 | 2.38× |
| 240 | Remote preview | 0.41543 | 0.18483 | 2.25× |
| 24 | Remote + checkpoint | 0.05303 | 0.02267 | 2.34× |
| 96 | Remote + checkpoint | 0.22893 | 0.11058 | 2.07× |
| 240 | Remote + checkpoint | 0.59047 | 0.29104 | 2.03× |

Model geometry, texture resolution, lights, interpolation durations and physical contact parameters are unchanged.
