# Native app backup/capture coordination

The app backup debounce and room capture state machine now execute in Rust in both existing UI and Shelf domains. SDK/storage calls, timers and the currently shared app variables are host bindings. Calls made before either module is ready use the existing withBookDataModule readiness gate; no new download or worker is introduced.

Preserved behavior: 350 ms silent backup debounce, remembered-account eligibility, 32 ms initial room capture, no overlapping writes, account snapshot on dispatch, capture-before-drain ordering, coalesced follow-up requests, unchanged exponential retry delays (500/1000/2000/4000/8000 ms, then 8000 ms), error reporting and finally cleanup even if warning fails. Book-change acceptance remains conditional on the active account and markBookChanged result.

Validation: eight native-WASM tests cover debouncing, failures, absent and remembered sessions, pending/in-flight coalescing, account changes, retry sequences, drain errors, accepted/rejected book changes and error propagation. Both UI/Shelf compiled. This is a coordination migration; no global speed/battery gain is claimed.
