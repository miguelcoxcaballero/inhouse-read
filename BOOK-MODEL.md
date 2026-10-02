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
- The first motion stops at a cover that waits for a tap. That tap scales the
  same model to fill the screen; the reader renders behind it. Once the first
  page is ready, the cover fades and the reader controls slide up from below.
- The saved page is always sepia while the book is opened or closed. Readers
  snapshot the page twice (the user's theme and `snapshot.sepia`, the same page
  under the sepia theme's palette or PDF filter); the model stacks the sepia
  plane under the themed one and `pageTheme` (0 sepia, 1 theme) cross-fades them,
  with the paper tones, on the zoom's own clock. Sepia readers carry no variant.
- The page text is not a screenshot: `snapshotDOMPage` re-paints the laid out
  text at the browser's measured character positions, so it follows the user's
  reading settings. A line the browser stretched (justified text, word spacing)
  is painted word by word, each word at its measured x, so justified pages are
  flush on the right while the book opens and closes; unstretched lines stay one
  string (kerning, ligatures). Soft-hyphen and `hyphens:auto` line-end hyphens,
  link underlines, small caps, `capitalize`, mixed-direction runs and enlarged
  `::first-letter` initials are painted too. Not painted: backgrounds, borders,
  list markers, text shadows, vertical writing, quote highlights.
- Devices without WebGL retain accessible shelf titles and a cover fallback.

Verification: geometry unit tests check the ellipse, outward normals and UVs;
browser tests inspect actual canvas pixels beyond the cover, reopen a stored
PDF, cancel/reopen on a mobile viewport, and exercise the no-WebGL fallback.

This is a web update delivered through Pages. The Android 1.0.8 loader continues
to load the production web app; native version metadata is unchanged.
