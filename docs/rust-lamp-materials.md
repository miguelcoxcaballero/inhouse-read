# Rust lamp appearance

`lamp_material.rs` owns the three fixtures' material presets, unchanged shader patches, surface resolutions, mesh flags, render order and fitted bump scales. These descriptors load once per session. The host creates the corresponding Three.js resources and applies the supplied patches; shader execution remains on the GPU.

Power and tint arithmetic now run in the decor core's `lamp_surface.rs`. The kernels use its existing 16-f64 scratch arena, with no allocation or callback. Current fixtures have at most three emitting materials; each uses four numbers for original intensity and RGB. Updates always derive from those original values, preserving fade reversibility, colour temperature, NaN/infinity behavior and stable GPU resources. The host reacquires its reusable typed view after other decor operations grow WASM memory.

Geometry generation, texture pixels, mipmaps, anisotropy, glass blending, light-emitter placement, shadow flags and disposal behavior remain unchanged. JavaScript retains Three.js object/texture ownership, scene-property application and persistence hooks.

Validation: 58 unit tests across five suites, including the existing geometry, lamp, Kelvin and surface differentials. New checks compare complete custom shader strings and optical material values for all three lamps at both qualities/fitted sizes; compare absolute power/tint updates including edge values; verify no GPU resource replacement; and exercise decor memory growth and rejected oversized emission requests.

This is a low-priority logic migration, not an FPS optimization claim. A warmed local benchmark of 25,000 paired power+tint updates measured an additional approximately 0.24–0.63 microseconds per fixture/update compared with the previous JavaScript arithmetic. There is no per-update allocation in the kernels or their scratch-view adapter, but the WASM call boundary costs more than a few JavaScript multiplications. The separate preceding lighting-state migration reduced its manager CPU time by about 21%; those gains must not be attributed to this material block.
