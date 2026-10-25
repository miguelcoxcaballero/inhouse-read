# Native arena for fixture frames

`LampLightFrame` owns one 103-double input and one 38-double output buffer.
Each lighting rig creates this transport lazily, shares it sequentially among
its point/cone slots, and frees it when the rig is disposed. Every slot keeps
its independent `LampLightState` color, emitter, pose and shadow history.

The browser writes emitter values and Three matrices directly into the input
view. `sample` calls the existing `LampLightState::light` implementation with
borrowed slices and returns its existing flags. The browser reads the output
view without a bindgen copy. The slice API remains available with the same
behavior for other callers.

The previous bindgen bridge allocated two native slices and copied 103 input,
38 output-initialization and 38 output-return doubles on each fixture update:
1,432 transferred bytes per point/cone fixture. This transport removes those
allocations and copies. It retains the same arithmetic, shadow decisions,
Three property updates, light intensities and render cadence.

Views are refreshed before packing and after sampling when native memory grows.
The transport is per rig rather than global, so disposing one scene cannot free
another scene's arena. Filament area-light transport is unchanged.

Validation: Rust UI/shelf WASM and Vite production compilation. No whole-app
frame-rate, battery or thermal improvement is claimed without device profiling.
