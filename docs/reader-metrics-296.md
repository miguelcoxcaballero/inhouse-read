# 1.7.296 — reader pages and remaining audiobook time

The reader footer displays percentage plus current/total pages even with audio stopped. PDFs use physical pages; reflowable EPUB/MOBI books use stable reference pages at 300 words/page, the same convention used for shelf thickness. The tooltip identifies these reference pages. Unknown counts remain `—/—` until the engine's cached complete count is ready. Counting never blocks reader opening, and late results are rejected after switching documents or reader epochs.

Both the compact audiobook player and its controls panel display remaining time as `xh xxmin`. This is an explicitly labelled estimate based on complete word count, 180 words/minute at 1x, current audible position and playback speed. Voice pacing, punctuation, excluded notes and nonuniform text density can affect actual duration. It is not a claim to know the duration of audio that has not been synthesised.

Rust owns page/time calculations and DOM updates. The browser connects the existing cached length promise and playback callbacks. Estimates update on relocation, rate/state changes and audible sentence boundaries, with no polling timer and no full-book synthesis. The independent PDF/EPUB speech cursor is used while browsing another page. The final PDF page remains in the estimate even though the reader's historical percentage reaches 100% at that page's start.

The footer wraps its compact counter on narrow screens and reserves space for the return link, time and 44px transport targets. The additional panel estimate does not reduce the reader viewport.

Verification: 125/125 unit cases across seven suites and 6/6 Chromium browser cases passed on the final build. Tests cover speed changes, final/single-page PDFs, independent audible cursors, unknown/empty counts, late-count cancellation, live DOM refresh, and PDF/EPUB controls at 320/390px plus the existing desktop/keyboard cases. Mobile screenshots were inspected. Playback uses the deterministic fake neural engine in browser tests; duration remains an estimate, not a real-voice timing benchmark.

Rust build, Vite build, offline-shell generation, `git diff --check` and the locked shared-updater verifier passed. Local UI: 3340021 bytes, SHA256 `a5ac608c2a0fd8da79e993885d8d6b56981f5f65bf007afbe45d8be3fd477df1`. Shelf: 3899803 bytes, SHA256 `0d4dcdee5c8d5408ef18a7dbc66bae76326be6a376f44e281e46e83d709d74a4`. Offline shell: 111 files, 36194022 bytes, revision `e9627d37e7c7`. CI rebuild artifacts are checked separately. No APK or updater-channel catalog is published by this change.
