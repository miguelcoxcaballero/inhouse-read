# Studio shell colors in Rust

`studio_environment.rs` computes the immutable studio sphere's color attribute
from the existing Float32 positions. It preserves Three's double-precision
smoothstep/lerp operation order and writes final Float32 colors directly. The
host creates a BufferAttribute without the previous temporary JavaScript number
array. The Rust source participates in the persistent atlas's build revision.

Rust compilation and Vite production compilation pass. Fifty tests pass across
studio color equivalence, environment revisions, cache behavior and randomized
plant/shelf/lamp catalogue scripts. The real 1,225-vertex sphere matches every
color byte; 10,000 additional vertex heights cover interpolation boundaries,
NaN/infinite values and random Float32 inputs.

A local Node/WASM comparison used nine alternating rounds, 100 warmups and
1,000 calls per round, including input/output copies and BufferAttribute
construction. Median time was 22.21 microseconds for the previous loop and
11.00 microseconds for the native adapter. This measures color generation on
a cold environment recipe; it does not measure GPU filtering or whole-app load.

The Chromium PDF reader power scenario also passed, including page navigation,
audio controls and return to the same shelf layout. Over eight idle seconds it
recorded zero requestAnimationFrame callbacks, zero WebGL draw calls and zero
worker messages; main-thread task time was 46.89 ms with nine timer callbacks.
This uses a mobile viewport and a fake voice engine for control-flow checks;
it is not a measurement of phone temperature or battery power.

The separate EPUB scenario also passed the same complete flow. Its eight idle
seconds recorded zero animation callbacks, WebGL draws and worker messages,
with nine timer callbacks and 24.73 ms of main-thread task time.
