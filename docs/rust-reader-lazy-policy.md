# Lazy reader ownership and native adoption

`reader_lazy_policy.rs` owns a lazy reader once a UI or Shelf module is already
available: reuse of its loading Promise, creation of exactly one experience,
failed-load reset, the first caller's reload policy, silent prefetch failure,
saved preferences and idle/loaded delegation. Both startup and native code use
the same plain state, so a pending import is adopted without being restarted.
The native policy keeps no permanent handles or registered Rust callbacks.

The browser adapter retains `import()`, `Promise.all` and the JavaScript
callbacks attached to those Promises. `ready()` and `open()` request the same
reader chunk/core as before; `prefetch()` keeps its existing explicit meaning.
Constructing the stand-in, reading preferences or using idle/close controls
does not call any loader or start a voice engine. The UI is still constructed
only after both existing imports resolve successfully.

Before any native module is available, small synchronous bootstrap guards use
that same state. Merely consulting `getRustUI()`/`getRustShelf()` adds no download
or await. Completion uses the returned UI module directly when possible;
otherwise the already loaded Shelf policy can adopt the flight. Failed loads
clear only the in-flight Promise and remain retryable.

`chunk-recovery.js` deliberately remains host recovery. It runs precisely when
a dynamic import or WASM module may have failed, so requiring either to decide
whether the browser should reload would break recovery. It retains its existing
offline guard, session-storage window and one reload per minute. The lazy policy
calls this existing function when the first requester allowed recovery; there
is no new dependency or second recovery mechanism.

Tests start with no module, Shelf only and UI ready. They cover repeated calls,
mid-flight adoption, close before readiness, missing cores, constructor/import
failures, retries, concurrent prefetch/ready ordering, stored preferences and
native handle stability. The original lazy reader, chunk recovery and reader
voice-resource suites remain part of validation. Reader power/cold-return checks
belong to the parent's combined release build.
