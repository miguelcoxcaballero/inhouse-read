# 1.7.290 — one library and physical room across web and app

Settled book and decoration poses now join the existing Drive library backup. The shared Rust code translates device-local book IDs to Drive IDs and stores positions in metres, relative to each bay. Schema 2 restores the same room at another viewport/pixel scale; schema 1 remains readable. Existing cabinet-contact revisions still invalidate obsolete false supports. Incoming compatible poses update the live solver atomically, retaining meshes, textures, colliders and sleeping contact islands.

A received room waits during a book press/drag, pinch, flyout, reader or close transition. Completion/re-entry retries the pending room. Settled local gestures publish after 350 ms; visible clients check every five seconds. This is the durable synchronization foundation; a direct live transport is a separate follow-up. The current Inhouse Notes production client uses WebRTC plus Drive rendezvous (`live-collaboration-v5.js`), whereas its older rebuild-v2 polling module uses five seconds. This is automatic near-real-time synchronization through Drive, not a server-pushed gesture stream. It requires the same connected Google account and network access. Unchanged polls request only manifest IDs/modification dates, not book bytes or covers. Hidden clients do not poll. Failures and account changes cannot poison the revision cache.

A shared appearance identity preserves the original book's color, height, binding, ribbon, cloth and reflection seeds when another device stores that book under a different local ID. Seed selection now runs in Rust. The older reading-progress file can still restore reading position, but its appearance no longer overwrites a library-managed placement or finish. An in-flight legacy patch is rejected if library ownership changes while it waits. Receiving room changes no longer reloads audiobook preferences unless those preferences actually changed.

Verification on the final native build:

- 184 targeted unit cases passed, including complete frozen Drive/cloud transcripts, shared appearance, UTF-16 IDs, viewport restoration, atomic live poses, interrupted uploads and reader/gesture deferral.
- Actual built application in independent mobile-size and desktop-size browser contexts: a real touch movement propagated its settled pose, dimensions and inclination, then a reverse appearance edit arrived without changing the posture. Passed in 40.9 seconds.
- Four additional browser cases passed: careful upright placement and both fall directions, PDF/EPUB restoration with exact original bytes/covers, and compiled double-close with saved page/layout retention. 1.5 minutes, no retries.
- General suite: 6904/6905 initially passed. The single failure compared three synthetic increasing-clock values in the old-format fixture; all data/schema/HTTP comparisons were unchanged. Those three explicit expected timestamps were updated for the added room lookups. Its fresh 2/2 rerun passed, completing verification of all 6905 cases without skips.
- Shared updater integrity passed at the unchanged canonical lock `6621ca1dbb519d171d723f118052e42ef5d5c001`. No APK or updater-channel changes.

Browser measurements use Chromium with touch/mobile emulation and software graphics. They do not certify a physical Android phone's latency, thermal behavior or speaker output. Models, texture resolution, book originals and audio processing quality are unchanged in this release.

Native UI: 3143530 bytes, SHA256 `0186fd3a767f3183252e0ba77f1f2ac5cef0b422d09e14e273e882f220d3cbe4`.
Native shelf: 3814681 bytes, SHA256 `7d1c0e001e824b2e5483e020a8ea69e97d6dc6e4902b463e8049304e53c3d232`.
Offline shell: 111 files, 35879279 bytes, revision `aae2ab0544dd`.

Inventory: 35556 nonblank Rust / 20517 JavaScript lines, 63.41% tracked-source LOC. This is not functional completion or test coverage. Audiobook lookahead and the remaining Rust migration continue separately.
