# Shared in-flight Drive revisions

The Rust Drive client shares only an active library-revision request. Library
backup and live transport callers can await the same metadata lookup, including
folder discovery and pagination. The completed result is not cached: the next
call reads Drive again, preserving freshness.

The shared promise is installed before synchronous host callbacks begin. An
account generation and request sequence isolate cancellation and reconnection;
an old completion cannot clear the newer request. Both successful and failed
requests release their active slot. Signing out clears it immediately.

Rust and Vite production compilation pass. All 97 targeted Drive, backup and
live-transport tests pass, including 120 seeded request/result/storage/event
scenarios. New mocked-HTTP cases verify shared concurrent reads (three cold
lookup/list requests for two callers), fresh data on the next call, retry after
a shared HTTP 503, and an old account completing while the new request is active.

Both Chromium live-room recovery scenarios passed against the mocked Drive
server: lamp switches propagate through a broken/recreated RTC channel and a
visibility suspend/resume, and through the Drive fallback with RTC disabled.
