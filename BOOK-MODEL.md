# Rounded book model (September 2026 web update)

The bookshelf now uses Three.js 0.180.0 and a purpose-built procedural model
in `src/js/book-model.js`. CSS strips are removed. No external model assets
or model service are required.

- The binding is an extruded half ellipse with 96 subdivisions, shared vertices,
  analytical smooth normals, continuous UVs, and matching end caps.
- Binding depth is 38% of book thickness. It protrudes beyond the front cover
  in the actual mesh, including when viewed head-on.
- Separate cover boards enclose a recessed paper block. The cover image and
  binding title are textures on those meshes.
- Shelf snapshots and the opening animation use the same model builder. One
  shared WebGL context prevents hitting mobile context limits. Shelf models are
  disposed after drawing; flyout resources are disposed on close or teardown.
- The opening rotation includes a 10-degree pitch so the rounded cross-section
  is visible. The entire model, including the binding, is fitted and centered
  within the viewport. Reduced motion skips the movement.
- Devices without WebGL retain accessible shelf titles and a cover fallback.

Verification: geometry unit tests check the ellipse, outward normals and UVs;
browser tests inspect actual canvas pixels beyond the cover, reopen a stored
PDF, cancel/reopen on a mobile viewport, and exercise the no-WebGL fallback.

This is a web update delivered through Pages. The Android 1.0.8 loader continues
to load the production web app; native version metadata is unchanged.
