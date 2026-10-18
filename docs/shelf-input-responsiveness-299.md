# 1.7.299 — responsive shelf input

A normal desktop press-and-drag used to cancel as soon as movement exceeded the tap threshold, unless the mouse had first waited for the 440 ms touch hold. Mouse and pen movement now starts the existing Rust pickup/drag controller immediately. Touch retains hold-to-reorder and its scroll/pinch gestures. A pen on an object no longer starts a cabinet swipe.

Interrupted input could leave a held object or a stale contact in the swipe/zoom controllers. Losing capture now ends that pointer without committing a swipe or coasting the camera. Focus loss and hiding the document reset all three controllers together. Capture transfers to the scroller during a pinch retain the new owner. These paths release interaction ownership so the next tap can select a book and deferred room updates can proceed.

The scene reuses an exact 3D hit for repeated picking/grip work within the same synchronous input dispatch. The cache is invalidated on a paint and at the microtask boundary, so it cannot carry stale geometry into later events. This removes duplicate ray intersections without changing models, textures, lighting or output resolution.

Regression tests cover immediate mouse/pen movement, ordinary taps, touch holds, lost capture, focus loss and subsequent selection. Browser coverage includes local and synced desktop rooms, dragging and opening, plus existing mobile idle/visibility and reader-opening checks. Browser tests use Chromium with software rendering and a simulated Drive service; they do not constitute a physical phone or production-account performance benchmark.
