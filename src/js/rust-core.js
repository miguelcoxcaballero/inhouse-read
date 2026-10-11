import coreUrl from '../wasm/inhouse_read_core.wasm?url'

let core = null
let loading = null
let retryAfter = 0
const FAILED_RETRY_DELAY_MS = 30_000

export const getRustCore = () => core

/** Load once per JS realm. A worker has its own memory; the hashed Vite URL
 * is cached with the offline shell. Never delay the first shelf or a gesture
 * on a network request. Existing kernels cover unavailable/older WebViews. */
export function loadRustCore({ bytes, fetcher = globalThis.fetch } = {}) {
  if (core) return Promise.resolve(core)
  if (loading) return loading
  // A transient offline request must not disable acceleration for the whole
  // session. Only a later caller retries, at most once every 30 seconds; no
  // timer, polling or user interaction waits for this recovery.
  if (Date.now() < retryAfter) return Promise.resolve(null)
  loading = (async () => {
    if (typeof WebAssembly !== 'object') return null
    let result
    if (bytes) result = await WebAssembly.instantiate(bytes)
    else {
      const response = await fetcher(coreUrl)
      if (!response.ok) throw new Error(`Rust core HTTP ${response.status}`)
      // Some local servers serve WASM with a generic MIME type. Streaming
      // works on Pages; the byte path keeps those servers functional too.
      if (typeof WebAssembly.instantiateStreaming === 'function'
          && response.headers.get('content-type')?.split(';')[0].trim() === 'application/wasm') {
        result = await WebAssembly.instantiateStreaming(response)
      } else result = await WebAssembly.instantiate(await response.arrayBuffer())
    }
    const exports = (result.instance || result).exports
    if (exports.core_abi_version?.() !== 1 || !(exports.memory instanceof WebAssembly.Memory)
        || typeof exports.alloc_f64 !== 'function' || typeof exports.free_f64 !== 'function') {
      throw new Error('Incompatible Rust core')
    }
    core = exports
    retryAfter = 0
    return core
  })().catch(() => {
    retryAfter = Date.now() + FAILED_RETRY_DELAY_MS
    return null
  }).finally(() => { loading = null })
  return loading
}
