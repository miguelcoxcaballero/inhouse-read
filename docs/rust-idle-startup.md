# Optional startup and reader power ownership

`idle_startup_policy.rs` owns optional work eligibility, reader/hidden ownership,
waiter snapshots, first-frame memoization and its eight-second fallback, and the
post-frame task sequence. A task checks its original document after every idle
wait; failures are isolated, and an abandoned generator is closed.

`idle-startup.js` remains the browser adapter for Promises, idle/timer callbacks,
DOM event listeners and their identity. It does not load or await WASM. A small
bootstrap is necessary because this module schedules work before the shelf's
existing WASM request finishes; it is never selected after Rust is available.
The same state, first-frame promise and waiter set cross that boundary without
restarting timers, duplicating work or resetting reader ownership. The bootstrap
task loop is only reachable if the eight-second no-frame fallback expires before
WASM has loaded; ordinary first-frame work is sequenced by Rust.

Neither the migration nor readiness detection loads voices, models, textures or
optional chunks. Hidden and reading work still parks on existing ownership and
visibility signals, with no polling timers. The first-frame poll is unchanged.

Validation: run `idle-startup.test.js` in both bootstrap and real Rust modes,
`idle-startup-rust-handoff.test.js`, startup-resource/cold-return regressions and
the integrated `reader-power.spec.mjs` and cold-reader-return browser suites.
Policy migration alone makes no claim of increased rendering performance.
