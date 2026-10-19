# Rust book-view animation ownership

`book_view_motion.rs` owns RAF scheduling, cancellation, completion, the 17 geometry-only reservation probes and nested native framebuffer tokens. The existing Rust numeric motion sampler still supplies identical poses and its capped clock. Three placement, bounds projection and drawing remain host operations; no shaders or visual settings change.

The view shares one ordinary state object with the Rust controller. `draw()` and `returnFrame()` read the current capacities directly, without a WASM getter for each field. The controller performs one callback per scheduled frame. Callback state is garbage-collectable JavaScript state bound to Rust exports, with no Rust future or closure holding a disposed model.

Completion drops the job's owner, sampler, frame callback and timer callback, so an externally retained animation handle cannot retain the book or renderer. Cancellation is idempotent. An older cancelled handle cannot clear a newer animation's capacity. A frame consumer that disposes or replaces its view cannot schedule another stale frame. Projection/draw failures release the numeric sampler and settle completion before propagating the original error.

Run `node scripts/benchmark-book-view-motion.mjs` after building UI/shelf to compare scheduler overhead against the frozen previous implementation. The final shared-runner run measured 11.8–12.2 microseconds per Rust callback versus 0.09–0.72 for JS. Under simultaneous parallel compilation it measured 29–34 microseconds, around 0.03 milliseconds per animation frame. This is an explicit small cost of moving scheduling policy to Rust, not a claimed speedup; pose calculation, geometry and rendering are outside that benchmark. It runs only while the existing animation requests frames and adds no idle rendering.

Differential tests compare exact poses, geometry probes, reservations, frame times and completion against the original scheduler for multiple durations, slow frames and a no-draw bookmark callback. Additional cases cover stale cancellation, nested/late releases, eligibility boundaries, disposal inside a frame callback, errors and repeated cancellation without native-handle or WASM-memory growth.

Verification: isolated UI/shelf release compilation succeeded. All 131 tests passed in nine suites, including the real book-view paths for direct presentation, absent bookmarks, adaptive/native reservations and retained returns (30.41 seconds). No GPU/browser session was started in this worktree.
