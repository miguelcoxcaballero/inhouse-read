# Inhouse Read v1.0.6

- Made the bookshelf's curved book spines visibly arched at normal and narrow book widths.
- Added end-to-end regression checks proving local book bytes survive a reload and open without the file picker.
- Added an end-to-end check that the Android update prompt passes the published APK URL and SHA-256 to the native installer bridge.
- The Android APK remains a small WebView loader; the reader itself continues to load from the live site.
