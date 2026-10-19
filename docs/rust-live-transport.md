# Live transport queue and recovery policies

`rust-ui/src/live_transport.rs` now owns the state/motion relay queue decisions,
pending-to-in-flight transitions, latest-value coalescing of mailbox writes,
retry delays, discovery cadence, 404-only file recreation and stale-session
checks around asynchronous completion. `live-room.js` exposes browser timers,
WebCrypto, encoding and Drive calls as host capabilities.

The wire format, AES-GCM account binding, direct RTC transport, shared Rust
register/negotiation rules and existing intervals remain unchanged. An older
failed upload cannot replace a newer pending state, and an account change or
suspension prevents a late upload from advertising state into the new session.
Host callbacks run without a retained Rust borrow, so a callback may publish,
suspend or change accounts while earlier work is still pending.

This batch does not claim the entire transport facade is Rust. Cold module
bootstrap, session/timer ownership, channel/ICE orchestration and receive-side
dispatch still contain JavaScript policy and remain listed as mixed work in the
functional boundary audit. The pending work must not be labeled a necessary
host exception just because it calls RTC APIs.

The following receiver batch also moves rendezvous-context confirmation and
key adoption, encrypted signal publication, snapshot application/rollback and
the incoming state-file guard to Rust. Failed local application forgets the
snapshot deduplication ID so a retry can apply it; all completions check their
session before touching a native room that an account change may have freed.
Crypto key import/decrypt and UTF-8 conversion remain host capabilities. RTC
offer/answer/ICE/channel lifecycle and initial module bootstrap remain mixed.

Validation:

- Production Rust UI/shelf and Vite/offline-shell builds pass.
- 80 tests across live transport, native room protocol, motion, packet stream
  and cloud lifetime files pass. The new public transport scenarios run against
  both Rust and the frozen previous implementation: newer state during a failed
  upload, stale response after account change, suspension during a slow write
  and 404-only state-file recreation with identical encrypted payload.
- An additional lifecycle test passes: 30 create/publish/destroy cycles return
  the Rust UI live-handle counter to its original value. The complete updated
  nine-test differential/lifetime file passes.
- The WebCrypto fixture yields real host time while app timers stay fake. A
  first test attempt exhausted event-loop turns in the frozen JavaScript
  reference before host crypto completed; replacing that empty-loop polling
  with bounded real-time yielding made both implementations pass. No production
  retry interval or existing application timing threshold was changed.

No browser/GPU E2E pass or end-to-end speedup is claimed for this batch. Its
purpose is one Rust implementation of transport policy with preserved protocol
behavior; root integration still verifies the complete app.

Receiver validation: the final six-file suite passes all 87 tests, with 15 in
the expanded differential/lifetime file. New cases exercise shared-key recovery
after a decryption error, application retry after storage failure and rejection
of an in-flight application after suspension, against both implementations.
Rust UI/shelf and the production web/offline-shell build pass. One initial run
alongside the web build exhausted the existing test's fixed host-event-loop
poll count; its unchanged isolated retry and the subsequent complete suite pass.
No existing test timeout, retry interval or production threshold was changed.
