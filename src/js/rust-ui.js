let ui = null, loading = null, retryAfter = 0
export const getRustUI = () => ui

// Loaded with the reader chunk, away from the shelf's first frame. A broken or
// unavailable module retains the existing controls and can be retried later.
export function loadRustUI() {
  if (ui) return Promise.resolve(ui)
  if (loading) return loading
  if (Date.now() < retryAfter) return Promise.resolve(null)
  let timer
  const initialize = import('../wasm/ui/inhouse_read_ui.js').then(async module => {
    await module.default()
    if (module.ui_abi_version() !== 1) throw new Error('Incompatible Rust UI')
    return module
  })
  loading = Promise.race([initialize, new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('Rust UI download timed out')), 2000)
  })]).then(module => {
    ui = module; retryAfter = 0
    return ui
  }).catch(() => { retryAfter = Date.now() + 30_000; return null })
    .finally(() => { clearTimeout(timer); loading = null })
  return loading
}
