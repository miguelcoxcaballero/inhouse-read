# 1.7.294 — bounded room-packet stream in Rust

The complete-state channel now uses `RustRoomPacketStream` for its pending/in-flight queue, framing, chunk offsets, receive assembly and validation. WebRTC handles, TextEncoder/TextDecoder and browser event registration remain at the SDK boundary. The wire protocol is unchanged: version-one JSON size header, ordered binary chunks of at most 16,000 bytes, complete packet limit of 2 MiB. The interactive gesture channel introduced in 1.7.293 is unchanged.

One immutable encoded packet buffer is shared among peer queues during fan-out. Rust holds browser-owned byte-array handles and returns subarray views; outgoing bytes do not make a round trip through WASM linear memory. Each peer retains at most an in-flight and a latest pending packet. A superseded pending state is dropped without truncating the in-flight one. Complete receive buffers are released before application callbacks; invalid/overlapping/overflowing input clears the partial assembly, and closing a peer frees its stream.

Byte views from another JavaScript realm are rebound to the exact underlying buffer window, without copying bytes. Signed one-byte views preserve their raw bits. Header sizes retain the previous strict number/integer checks. The browser wraps actual RTC ArrayBuffers as byte views before calling the native receiver.

Verification on the final local build:

- **69/69 unit cases passed**, including 26 stream cases: byte-exact payloads up to 2 MiB, 16,000-byte boundaries, multibyte UTF-8 split across chunks, actual ArrayBuffer wire messages at the SDK boundary, subarray offsets, shared underlying buffer identity across peers, coalescing, malformed headers/chunks and cleanup. Existing direct-room, gesture, library and cloud-lifetime cases also passed.
- **2/2 real browser cases passed** with version 1.7.294 on both installations: held movement before release, a motionless lease without extra remote paints, exact settled poses, simultaneous reading and old-reader close, forced RTC recovery, local tabs without RTC, and no further library writes while idle.
- **1/1 mixed-version browser case passed** with a 1.7.294 mobile installation and a separately hosted frozen 1.7.293 desktop installation. Different localhost ports prevent BroadcastChannel from masking RTC wire compatibility. It exercised both directions, reading, final poses and reconnection with Drive writes delayed five seconds. `IHR_TEST_PEER_URL` selects that independent peer build; the default CI path continues to test its current build on both devices.
- Browser cases used the existing loopback TCP TURN fixture because managed Chromium disables non-proxied UDP. It is test-only. Production STUN/Drive configuration and browser policy/proxy are unchanged; no WAN latency guarantee is inferred.
- Shared updater integrity passed at canonical revision `6621ca1dbb519d171d723f118052e42ef5d5c001`; no APK or updater channel catalog is included.

Native UI: 3317681 bytes, SHA256 `7696ede42d5ab1ecb2d8175c2a15ad0b65652553a056810d72acfe0213e83519` (local build). Shelf source and the verified local shelf artifact are unchanged from 1.7.293. CI rebuilds are verified as their own artifacts.

Inventory: 36107 nonblank Rust / 20876 JavaScript lines, **63.36% tracked-source LOC**, including comments/adapters/compatibility code. This is not functional migration completion. Remaining browser orchestration is still JavaScript.
