# Retained native physics frames

The shelf now registers its ordered UTF-16 identities when a layout replaces the entry array. Rust retains both that identity list and the membership set, together with its 37-value presentation states, 9-value collider geometry and 4-value physics results for each object. Animation frames write host fields directly into the retained native storage and advance the existing solver without wasm-bindgen allocating and copying three numeric slice arguments.

This changes the bridge and storage lifetime, not the contact solver, dimensions, integration, drag/release policy or live room coordinates. The original `RustBookGravity.step` API remains available as a differential reference and for existing callers. Only host object-field marshaling remains in the JavaScript adapter: DOM/Three objects still belong to the host.

The adapter refreshes views after native memory growth, copies four result numbers per object into stable presentation storage, and reads each 37-number result into the scene's existing scratch array without creating a subarray object. This permits model building, lighting and other native calls between objects without exposing detached views. Same-length reorder and solver replacement use the current identity registration; scene disposal frees the arena and its retained JavaScript handles. The design retains no entry-object graph in Rust.

Validation includes the existing contact, pushing, shelf bounds, material-sound, room synchronization and model-quality regressions. New tests compare exact physics output bytes and all meaningful presentation state numbers against the original bridge through pushing, releasing, reader origin reservation, reordering and removal, including unpaired UTF-16 surrogates. Separate tests force memory growth between writes and after solving, exercise an empty layout and verify repeated registration/disposal leaves no native JS handles retained.

`node scripts/benchmark-gravity-frame.mjs` measures host packing, the complete solver call and per-entry result reads in settled synthetic scenes of 24, 96 and 240 objects. It alternates the old and retained bridge across 31 rounds after warmup, preserving the same resolution and physics. These CPU measurements do not measure rendering, phone temperature, battery use or whole-app frame rate.

Local validation completed: 98 unit cases across six suites (including four retained-frame cases), and three browser cases covering frontal book dragging on walnut/BAGGEBO and touch dragging a lamp without disturbing disconnected books. One initial BAGGEBO run was invalidated by a source-edit HMR reload mid-drag; its isolated frozen-source rerun passed. Browser tests used Chromium/SwiftShader, not a physical phone.

One Node 24.19 run measured median CPU frame times:

| Objects | Original bridge | Retained native frame | Speed ratio |
| --- | ---: | ---: | ---: |
| 24 | 0.114 ms | 0.092 ms | 1.25× |
| 96 | 0.217 ms | 0.150 ms | 1.44× |
| 240 | 0.619 ms | 0.457 ms | 1.35× |

All benchmark output comparisons were exact. The solver still does its normal work; these reductions come from repeated bridge work and allocations, not from less accurate simulation or lower visual quality.

A repeat while other work was running varied from 1.19× to 2.45× by fixture; the 2.45× sample should not be treated as representative. The timings are descriptive local observations, not a release threshold or a guaranteed speedup.
