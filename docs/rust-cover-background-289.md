# 1.7.289 — background cover lifecycle in Rust

Background cover extraction now runs through the same Rust implementation in the reader and shelf modules. The browser retains SDK callbacks and Promise ownership. Rust handles content revisions, obsolete work, bitmap lifetime, cache identity, conditional library writes and backup scheduling. A pending SDK request does not retain native callbacks or handles.

Android file imports now finish after the import wrapper releases its busy controls. Missing pointer-recording APIs in partial/2D scene adapters use the existing sampled-motion fallback; the live scene continues to use hardware timestamps.

Verification: 49 new native differential/resource cases; complete unit suite 6883/6883, no skips or failures. The frozen shelf reference includes the published reader-origin reservation and raw pointer transport contracts. Replays use the same relative event clock, preserving complete transcript comparisons. Browser validation: 7/7 cases passed without retries (1.6 minutes): four Android import scenarios, compiled double-close/return and both compiled prepared-opening paths, including delayed WASM. Updater integrity check passed against the existing canonical lock.

Source inventory: 35372 nonblank Rust lines / 20496 JavaScript lines (63.31% by tracked-source LOC; not functional completion).

Native UI: 3119011 bytes, SHA256 fcf77dbcb08e0f49193bc0badf3a2e10de7edf59c1418af0a8e1bc5d7ca1cd0d.
Native shelf: 3793939 bytes, SHA256 7b7b9697a09ec74e25e73ffcdc887bf0ebc59ee5749f24d4f79662a222c37dbf.
Offline shell: 111 files, 35831128 bytes, revision 76e20afa0c58.
