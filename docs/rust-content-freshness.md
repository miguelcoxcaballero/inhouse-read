# Content freshness policy

The already-loaded app core now owns the deployed-shell comparison, concurrent-check guard, reload retry interval and eligibility, and independent launch touched/reloading state. Browser operations stay in the host: network response and URL resolution, service-worker update, session-storage JSON, DOM visibility, event listeners, timers and navigation. The host also invokes the caller's `isIdle`/`canReload` callbacks in their original short-circuit order.

The existing top-level `requireCore` dependency is reused. This adds neither another fetch nor another asynchronous wait, and does not load the reader UI or any voice module. Module/launch handles live with the page's existing listeners and interval; temporary UTF-16 buffers are freed in `finally`. Explicit adapter disposal is available for isolated lifetimes and tests. Navigation releases the containing WASM instance.

Verification: the existing 12 deployed-shell tests and 30 offline-shell tests pass. Two native-plan suites additionally exercise concurrent admission, retry timestamps including NaN/infinity, exact UTF-16 signatures, strict reader-hidden semantics, independent launch controllers and 500 disposal cycles with bounded memory. After the final host Date.now short-circuit adjustment, all 14 content-freshness tests pass again. No cold-load or CPU speedup is claimed for these infrequent checks.

Logs: `/workspace/scratch/content-freshness-{build,tests,final-tests}.log`.
