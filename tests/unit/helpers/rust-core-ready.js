import { readFileSync } from 'node:fs'
import { loadRustCore } from '../../../src/js/rust-core.js'

// The live shelf is built with the numeric core already in (the first render awaits it),
// so tests of the shelf start from the same state: the real module, loaded through the
// app's own loader, no mock and no second copy.
export const rustCore = await loadRustCore({ bytes: readFileSync('src/wasm/inhouse_read_core.wasm') })
if (!rustCore) throw new Error('Rust core did not load in the test environment')
