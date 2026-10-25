# Conditional Drive polling in Rust

`app_drive_poll.rs` owns polling eligibility, five-second cadence and callback
generations. Browser timers remain host handles. There is at most one pending
timer; a callback from a cancelled generation cannot poll, replace or rearm a
later timer. Synchronous polling errors still schedule a retry.

Polling is armed only for a visible, online, undisposed page with an active or
remembered Drive account. Account/profile changes, online/offline events,
visibility and page disposal reconcile the timer. Local reading has no Drive
poll timer, and hidden/offline pages cancel it. Active backups defer the poll
while retaining its cadence. Existing direct live-room and cloud sync logic
is called through the same resume operation.

Rust/Vite production compilation passes. All 124 targeted tests pass across the
new timer policy, stale callbacks, remembered accounts, busy backups, synchronous
errors, existing cloud/account actions and reader import/open/close behavior.
Both UI and shelf WASM modules expose and exercise the scheduler.

Both Chromium reader-power scenarios (PDF and EPUB) passed complete navigation,
audio-control and shelf-return flows. Their eight-second idle intervals each
recorded zero animation callbacks, zero WebGL draw calls and zero worker
messages. Timer callbacks were eight instead of the previous nine, because a
local account no longer owns the five-second Drive interval. Main-thread task
time was 53.40 ms (PDF) and 48.77 ms (EPUB); these noisy local timings are not a
device power measurement or evidence of a CPU-time improvement.
