// A rust-core.js replacement that hands the app the real compiled numeric core. For suites that
// reset modules and then mount the application: the first render awaits the core, so a fresh copy
// of the loader (which has fetched nothing) would report it unavailable. The module is compiled
// once per worker and shared; every caller still gets its own arena allocations.
import { readFileSync } from 'node:fs'

export async function rustCoreMock() {
  globalThis.__testRustCore ??= (await WebAssembly.instantiate(readFileSync('src/wasm/inhouse_read_core.wasm'))).instance.exports
  const core = globalThis.__testRustCore
  return {
    getRustCore: () => core,
    loadRustCore: () => Promise.resolve(core),
    requireRustCore: () => Promise.resolve(core)
  }
}
