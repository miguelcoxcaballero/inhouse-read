# Reader experience coordination in Rust

`reader_experience_policy.rs` owns the reader's initialization, saved preference
recovery, selection ownership, late length-metadata session checks, navigation
generation guards, labels, metrics/player updates, list callbacks, appearance
reset, sharing decisions and orientation changes. Browser records keep their
identities; spreads preserve symbols and own `__proto__` fields. There are no
permanent native state allocations or Rust closures registered with the DOM.

`reader-experience.js` binds component construction, event/resize observers and
callback/Promise identities. It forwards state transitions to the UI module.
The existing `reader-experience-lazy.js` loader already awaits `requireRustUI()`
alongside the reader chunk before constructing this class. This change adds no
bootstrap await, download, audio-engine/model initialization, timer or animation
loop. Opening still returns the lifecycle's original Promise and never waits for
the optional cached word count; late counts cannot affect another reader epoch.

The browser exceptions remain specific to their APIs:

- `canvas-font-readiness.js` reads `FontFaceSet.status` after canvas text painting
  and registers the browser's existing `ready` Promise when necessary. Painting
  can itself start a face download, so the API is the source of this decision.
- `reader-return-canvas.js` checks actual `HTMLCanvasElement`/DOM ownership before
  reusing pixels. A detached canvas can be handed to the next DOM owner directly;
  another owner requires `drawImage`. The exact DOM identity cannot be replaced
  by a native cached flag.
- `shelf-startup-resources.js` starts interface-font loading alongside WASM and
  storage. Waiting for the reader module here would serialize existing startup
  work and fetch a module the shelf does not need. This startup adapter retains
  browser font requests and their grouping; it is not part of this reader block.

Validation compares the frozen previous behavior for metadata races, cancelled
navigation, list removal/write ordering, selection, sharing, rotation, Unicode
labels, coercion/errors and repeated handle release. Existing reader experience,
lifecycle, navigation, actions, preferences, metrics, lazy loading and voice
release suites also exercise the real compiled UI module. The parent release
checks reader power and cold return on the combined build; this coordination
change does not claim a separately measured GPU or phone-battery speedup.
