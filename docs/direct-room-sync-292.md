# 1.7.292 — direct room delivery with durable Rust registers

Visible devices on the same Google account discover one another in the existing private Drive state folder and open an ordered WebRTC data channel. The room is transmitted directly after explicit placement/customization/settings commits, without waiting for a Drive manifest write. Settled physical snapshots retain the metre-based coordinates and shared appearance identities introduced in 1.7.290. Intermediate held/reader poses are not persisted as shared resting positions.

Rust owns peer election, SDP nonce/account/age checks, bounded discovery/retry state, packet validation/deduplication, canonical snapshot comparison, local dirty-field capture and monotonic checkpoint merging. Browser adapters retain WebRTC, WebCrypto, IndexedDB and event handles. Only encrypted SDP rendezvous goes into per-session mailboxes; the AES-GCM key is confirmed from the folder's private property before use, and refreshed after a decrypt mismatch. OAuth tokens never enter peer messages. Private Drive metadata discovery reuses the existing visible five-second revision poll. Connected peers exchange data immediately; hidden/signout/disposed sessions close their channels and timers. Failed negotiation backs off to two minutes instead of continuously polling a restrictive network.

A dedicated local application task runs independently of a slow Drive network task. Explicit dirty local edits are captured first; incoming and durable registers merge in one IndexedDB transaction. An older network response cannot restore superseded fields. The ordinary Drive copy remains available for offline/re-entry and networks without a usable direct route. This does not provision a production TURN service: restrictive NAT/UDP policies may require the Drive fallback. It is not a guarantee of subsecond delivery on every network, nor a stream of finger movements while a book is held.

Shared physical poses use bay coordinates rather than a device-specific CSS placement anchor. Canonical equivalence ignores only anchor rounding when deciding whether to stamp a new room register; real body positions, dimensions and contacts still matter. Local stale-layout anchor checks are retained.

Canonical verified text-volume metadata now travels with the library snapshot. A downloaded original retains an existing complete count only when its Drive checksum and byte length match. The count binds to the new device-local content revision; raw revision IDs are never copied across devices. This avoids a second count and an intermediate thickness change that would invalidate a portable physical pose. Unverified or changed originals still use the established recount path.

Models, texture/cover resolution, audio inference and the shared updater revision are unchanged. No APK or updater channel publication is included.

Verification on the final native build:

- Full unit suite: **6924/6924 passed**, no failed or pending cases (1166 suites). Includes concurrent local/peer edits, slow Drive reads/writes, monotonic checkpoint updates, account cancellation, viewport anchor rounding and a locally completed count racing a remote count.
- Four real browser cases passed without retries in 2.5 minutes: careful upright/sideways release; exact reader-return layout in both frontal and isometric views; two independent mobile-size/desktop-size installations sharing exact dimensions, inclination and bay-relative positions, reverse appearance edits, and no further writes once idle.
- The cross-device case used real WebRTC and WebCrypto with a **loopback TCP TURN fixture** because this environment's managed Chromium disables non-proxied UDP. The policy and system proxy were not changed. Production has no TURN fixture or hard-coded TURN credentials. Drive manifest writes were delayed five seconds: a reverse appearance edit arrived in **81 ms**; the settled pose was observed in 700 ms after the source wait completed. These are local software-rendered measurements, not mobile/WAN guarantees.
- A cold offline Piper test passed with the real downloaded Davefx model and a new synthesis worker, exact retained book bytes, audible finite PCM and no device TTS calls.
- PDF and EPUB picker/highlight tests passed with the six-fragment lookahead contract introduced in 1.7.291.
- Audiobook instrumentation now observes the narrator's actual AudioContext, keeping separate shelf sounds and their iOS unlock out of speech measurements. It still rejects silent/invalid/clipped narration chunks. No production audio processing changed here.
- Shared updater integrity passed at the unchanged canonical lock `6621ca1dbb519d171d723f118052e42ef5d5c001`.

Native UI: 3237139 bytes, SHA256 `25efbfa45f00ce45f1a371abb3eb217e9f4dcb40aa27dc8c87f2cb38035419c3`.
Native shelf: 3818189 bytes, SHA256 `54239027f263df42baf7aaf39469afa8c46c0e92ca6226d9620572e616a15eb9`.
Offline shell: 111 files, 35989301 bytes, revision `bb016c56c117`.

Inventory: 35890 nonblank Rust / 20724 JavaScript lines, **63.39% tracked-source LOC**. This includes comments and adapters; it is not functional migration completion or runtime coverage. The browser SDK adapter remains JavaScript and further Rust migration continues separately.

This release's local checks do not certify the entire GitHub browser matrix. The parent 1.7.291 run passed unit, real Supertonic voices, neural engine and language jobs, but retained additional PDF/control/readiness UI failures outside this patch's four shelf cases.
