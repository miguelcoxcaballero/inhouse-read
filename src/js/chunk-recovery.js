// A browser remembers a dynamic import that failed (typically a chunk of a previous deploy), so retrying it in the
// same page keeps failing. One reload per minute fetches the current build; after that the caller's own message shows.
const KEY = 'inhouse-read-chunk-reload'
const WINDOW_MS = 60000

export function reloadOnceAfterChunkFailure(now = Date.now()) {
  try {
    if (navigator.onLine === false) return false
    if (now - Number(sessionStorage.getItem(KEY) || 0) < WINDOW_MS) return false
    sessionStorage.setItem(KEY, String(now))
    location.reload()
    return true
  } catch { return false }
}
