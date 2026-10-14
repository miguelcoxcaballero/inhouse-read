import { readFileSync } from 'node:fs'
import * as module from '../../../src/wasm/shelf/inhouse_read_shelf.js'
import { loadRustShelf } from '../../../src/js/rust-shelf.js'

// The live shelf builds its pointer controllers from this module and its first render
// awaits it, so every test of the shelf starts from the same state: the real module,
// loaded through the app's own loader, no mock and no second copy.
module.initSync({ module: readFileSync('src/wasm/shelf/inhouse_read_shelf_bg.wasm') })
export const rustShelf = await loadRustShelf()
if (!rustShelf) throw new Error('Rust shelf module did not load in the test environment')
