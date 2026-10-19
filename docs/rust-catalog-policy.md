# Catalogue presentation and flight policy

`catalog_present.rs` owns option packets, accessible labels, material colour
rows, soft hyphens, dimension captions, initial selection, dialog numbering and
the choice of preview studio. The fixed shelf illustrations moved byte-for-byte
to native source assets. The canonical catalogue data and Three constructors
remain host inputs. The options cache retains a Rust string, not a JavaScript
handle or a second live view. The complete drawing/label packet reaches the
native DOM builder internally, avoiding an export/import string round trip.

`catalog_motion.rs` owns flight eligibility, reduced-motion and viewport checks,
keyframes and timing, landing, style restoration, interrupted flights, the
visible/hidden-tab watchdog, and scheduling work after the closing frame.
Web Animations, DOM methods, timers and callback factories remain browser
bindings. Flight records and their callback cycles are JavaScript-GC owned;
there is no retained native closure for a finished or destroyed flight.

The shipped JavaScript has no second implementation of these policies. The
native controller already owns page/selection state, save flow and studio
lifetimes. Initial Rust-module validation remains in the host bootstrap.

Validation uses the compiled UI WebAssembly module. The frozen catalogue
reference produces identical normalized DOM markup after every plant, pot,
colour, shelf, lamp and temperature selection. Flight comparisons include
every keyframe property and timing property, callback ordering, style
restoration, cancellation, destruction, deferred shelf work, callback failures,
offscreen boundaries, missing browser features and hidden-tab watchdogs. Each
scenario returns the native-handle counter to its original baseline.

The focused suite contains 148 cases in nine files. A local warmed Node/jsdom
measurement compared the previous shipped native-controller adapter with this
one, alternating five samples of ten lifetimes. Median milliseconds per cycle:
create/destroy 46.44 → 46.10; create/open/all plant and pot selections/destroy
38.98 → 36.84. The isolated caption/name/dimensions packet costs 0.68 → 11.61
microseconds per selection (seven samples of 10,000 calls). The latter is an
approximately 11 microsecond overhead per catalogue click. These measurements
ran on a shared host and are not evidence of a user-visible speed increase.

These policies run on catalogue creation, selection and opening/closing, not
in the shelf render loop. The change leaves preview geometry, pixels, shaders,
WebGL buffers and compositor animation curves unchanged. This is a migration
of policy ownership; no whole-app speed, GPU, frame-rate or battery improvement
is claimed.
