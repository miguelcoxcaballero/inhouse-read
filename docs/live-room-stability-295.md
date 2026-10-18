# 1.7.295 — stable live rooms across web and app

Drive discovery now finds `live-v1-*.json` mailboxes by their shared filenames. Private `appProperties` belong to an OAuth application and can be invisible to another app using the same account. Discovery scans recent mailboxes before older sessions, without letting 64 stale files hide an active device, and runs independently of durable library uploads.

WebRTC remains the primary interactive channel, with the existing encrypted Drive rendezvous. If a known device has no direct route, a bounded latest-only motion envelope uses that same private Drive mailbox, encrypted with AES-GCM and account-bound additional data. Rust validates the sender, account, timestamp, size and sequence; the RTC and fallback paths share deduplication. The fallback writes only during active gestures, coalesces pending frames and follows network responses. Its latency depends on Drive; this release does not promise instant delivery over every network and does not provision a production TURN server.

A received room now updates the existing scene instead of destroying its renderer and briefly displaying a different layout. Rust reloads decoration/view settings and owns a short visual transition to the committed transforms. The entire authoritative physics snapshot is restored only when the complete object membership is ready. Incoming cover analysis uses the first-paint barrier as well: a temporary default cover ratio must not replace the book collider and simulate its resting posture again. Existing scene pixels remain visible while covers are prepared.

Plant dimensions come from the catalogue rather than rounded screen rectangles. Saved solid signatures remain compatible across insignificant floating-point differences, including the sub-0.1 mm CSS rounding in older plant snapshots. A viewport scale change no longer wakes sleeping books or rebuilds identical cabinet colliders. Real physical edits and deliberate pushes retain their existing contact behavior. Remote animation does not republish a local gesture or move the authoritative solver.

Verification:

- **287/287 unit cases passed across 22 files** on the final native build. Coverage includes cross-OAuth mailbox discovery, stale sessions, authenticated relay validation/deduplication, visual interpolation, atomic full-room restoration, viewport scaling, legacy plant rounding, delayed imported covers, reader return, deliberate physical pushes, sound events, cloud lifetime and packet-stream bounds. The legacy-rounding regression was first observed failing against the preceding native artifact.
- **6/6 browser cases passed**: full six-book/decorated room across mobile and desktop; encrypted Drive movement with RTC blocked; direct movement with simultaneous reading/progress, forced reconnection and idle checks; local tabs without RTC; exact reader open/close layout in frontal view; and the same reader check in isometric view.
- After the final legacy-rounding compatibility adjustment, **both cross-installation stability cases passed again** on the final build. They assert movement before touch release, identical settled physical poses, lamp state, reload persistence, and retention of the original room root/canvas with zero detachments. The full lit-room test permits software shader compilation time; the separate single-book regression retains its shorter propagation checks.
- Frozen reference changes are restricted to the intentional retained cloud refresh and catalogue plant dimensions. Existing reader/cover/decoration differential scripts and assertions remain active.

Local final artifacts: UI 3333018 bytes, SHA256 `d88c221c178a465de9218d738c5ec21b9c50edd4f5bb1a2ebe9ec70f9b620bd7`; shelf 3899803 bytes, SHA256 `915af7f5af1975bf0a8fc77d370f126eecc26e5fc1c26e4ece2059bf00dd490a`. Offline shell: 111 files, 36185200 bytes, revision `ecc9ac8d92f3`. CI rebuilds are verified as separate artifacts.

Inventory: 36194 nonblank Rust / 20937 JavaScript lines, **63.35% tracked-source LOC**, including comments and compatibility adapters. This is not functional migration completion.

Browser verification uses independent Chromium installations, actual WebRTC data channels, real application storage/crypto/rendering, and a simulated Drive server. The test-only TCP TURN route accommodates the managed browser's blocked non-proxied UDP. An additional case blocks RTC entirely and checks encrypted fallback movement before releasing the touch. These tests are not physical-phone or public-WAN latency/thermal measurements.

No book content, cover resolution, model detail, audio pipeline, APK, or updater channel catalog is changed. Shared updater verification remains pinned to canonical revision `6621ca1dbb519d171d723f118052e42ef5d5c001`.
