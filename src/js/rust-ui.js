import {notifyRustUIReady} from './rust-ui-readiness.js'
let ui = null, loading = null, initializing = null, retryAfter = 0
export const getRustUI = () => ui

// Loaded with the reader chunk, away from the shelf's first frame. A broken or
// unavailable module retains the existing controls and can be retried later.
export function loadRustUI() {
  if (ui) return Promise.resolve(ui)
  if (loading) return loading
  if (Date.now() < retryAfter) return Promise.resolve(null)
  let timer
  const initialize = initializing ||= import('../wasm/ui/inhouse_read_ui.js').then(async module => {
    await module.default()
    if (module.ui_abi_version() !== 1) throw new Error('Incompatible Rust UI')
    // The deadline only releases the reader. A valid late result remains useful
    // to subsequent operations; never start a second WASM instance while this
    // one is pending, which could invalidate live component handles.
    ui = module; retryAfter = 0; notifyRustUIReady(ui)
    return ui
  }).finally(() => { initializing = null })
  loading = Promise.race([initialize, new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('Rust UI download timed out')), 2000)
  })]).catch(() => { retryAfter = Date.now() + 30_000; return null })
    .finally(() => { clearTimeout(timer); loading = null })
  return loading
}

// The reader has no JavaScript twin of its controls and voice session, so it
// needs the module itself. Other callers keep the 2 s release above. When that
// deadline passed with the download still running, wait for the same
// initialization (never start a second instance) for a bounded extra time.
const LATE_DOWNLOAD_MS = 30_000
export async function requireRustUI() {
  const loaded = await loadRustUI()
  if (loaded) return loaded
  const pending = initializing
  if (!pending) return null
  let timer
  try {
    return await Promise.race([pending, new Promise(resolve => { timer = setTimeout(() => resolve(null), LATE_DOWNLOAD_MS) })])
  } catch { return null }
  finally { clearTimeout(timer) }
}
