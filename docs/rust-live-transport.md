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

## RTC negotiation and channels

The next block moves offer/answer negotiation, incoming rendezvous dispatch,
late ICE candidate parsing and accepted-candidate tracking, channel selection,
binary and interactive message dispatch, liveness checks, outgoing backpressure,
pending-peer retries and peer teardown into Rust. Browser objects and event
registration stay in the host. Candidate state is committed after the browser
accepts a candidate, allowing rejected candidates to be retried. Peer ownership
is removed before closing channels, so synchronous close callbacks cannot tear
down a replacement peer. No Rust borrow is retained across browser callbacks.

The exact thresholds remain: 32 KiB motion backpressure, 128 KiB binary pumping,
12-second connection liveness, 2-second health pings, 350 ms pending negotiation,
200 ms late ICE publication and a 1.2-second gathering wait. Initial module
bootstrap, publication/BroadcastChannel orchestration and top-level session
lifecycle still contain own JavaScript policy and remain migration work.

Validation: all 100 tests in seven transport/protocol/lifetime files pass,
including 13 new RTC regressions. These cover media index/mid preservation and
candidate deduplication, rejected candidate retry, offer-to-answer and later ICE
updates, peer replacement during an asynchronous browser call, concurrent read
guards, precise buffer thresholds, ping/pong forwarding, stale peer callbacks
and close-event reentrancy. Browser/GPU end-to-end performance is not measured
by these unit tests; no speedup is claimed.

## Publication and loaded-session lifecycle

The following batch also moves publication, motion sequence/lease renewal,
BroadcastChannel dispatch, initialization after module import, cached mailbox
selection, heartbeat scheduling, loaded-session publish/resume/pause/stop and
timer cancellation checks into Rust. Base64 transport encoding is Rust as well.
The host exposes opaque browser handles, clocks, private field accessors and
external effects; it retains no second loaded-session policy implementation.

There is an explicit cold-start exception: while the UI WASM module is absent,
JavaScript must begin its import and be able to cancel or retry it. That small
fallback retains the desired account and generation before Rust can run. The
loaded path goes through Rust, and does not eagerly import reader or voice
modules. Browser event registration, WebCrypto import/encrypt/decrypt, TextEncoder
and TextDecoder, and waiting for ICE gathering are host capabilities. The ICE
wait receives its 1.2-second timeout from Rust rather than owning that policy.

The expanded differential tests exercise both the frozen previous code and
Rust for failed module import recovery, account replacement while import is
pending, suspension during account hashing, tab state request/retry behavior
and periodic motion leases ending at the final gesture frame. The base64 test
compares padding and former 16 KiB chunk boundaries to the platform encoding.
No functional migration percentage or end-to-end speedup is inferred from
source counts or these tests.

Final lifecycle validation: all 111 tests across seven files pass (25 public
asynchronous differential/lifetime tests and 14 focused RTC/encoding tests,
plus the existing room, motion, stream and cloud lifetime suites). Production
Rust UI and shelf builds pass, along with the web/offline-shell build. The
expanded fixture initially used a nonportable book key that both implementations
correctly rejected; it now uses `book:drive:one`. An existing test's fixed
WebCrypto turn polling also failed once under concurrent compilation; its
unchanged complete-suite retry passed. No existing timeout was increased.
