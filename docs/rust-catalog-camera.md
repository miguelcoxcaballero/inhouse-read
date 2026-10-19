# Catalogue camera and retained preview framing

`rust-ui/src/catalog_camera.rs`, compiled into the shelf module, owns the printed
booklet rectangle, the opening/closing flight geometry, orthographic framing and
the decision to resize a preview drawing buffer. The catalogue is created after
the shelf module has loaded. `catalog-camera.js` delegates without a second
JavaScript implementation.

Each plant, cabinet and lamp preview owns one native `CatalogPreviewFrame`. A
texture or colour-temperature draw with unchanged model bounds and viewport
keeps the exact existing camera projection and inverse. A real resize, different
model bounds or padding produces a new projection; resizing the GPU buffer still
requires an actual viewport-size change. The one seven-number result packet is
reused and applied immediately. Closing a studio releases its native state.

Three camera setters, DOM measurements, animation playback and WebGL resource
ownership remain browser bindings. Studio selection/build scheduling is still
in its existing host modules and is not counted as migrated by this block.
Geometry, textures, pixel ratios, illumination and rendering quality are unchanged.

The compiled-WASM tests compare 2,500 generated camera flights plus rounding
boundaries with the frozen original formula, including both exact CSS strings.
They compare 1,600 Three projection matrices and inverses, signed zero and
non-finite framing, reject invalid rectangles, cover dataset parsing, assert
reuse of the output packet, and verify that 200 studio lifetimes leave no native
handles. Existing catalogue selection, shader-link, visibility and disposal
tests also run. Preview lifecycle tests now check that stable redraws avoid
projection updates and real resizes update exactly once.

Local Node CPU microbenchmark, 100,000 framing operations, nine alternating
warmed rounds (median milliseconds, original → native): stationary 22.55 → 2.18;
one resize per 120 redraws 14.91 → 10.11; resizing on every operation 9.51 → 19.52.
The last case adds approximately 0.10 microseconds per actual resize, while
stable draws skip the matrix and inverse work. All resizes reuse the same
result packet. These timings measure only the framing binding, not rendering.

This is a small CPU-side framing optimization. It does not change GPU rendering
cost, and these checks do not establish whole-app frame rates or battery use.
