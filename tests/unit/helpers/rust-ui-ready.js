import {readFileSync} from 'node:fs'
import * as ui from '../../../src/wasm/ui/inhouse_read_ui.js'
import {loadRustUI} from '../../../src/js/rust-ui.js'

// The reader is never built without the Rust UI core (reader-experience-lazy
// awaits it), so tests of reader parts start from the same state: the real
// module, loaded through the app's own loader, no mock and no second copy.
ui.initSync({module:readFileSync('src/wasm/ui/inhouse_read_ui_bg.wasm')})
export const rustUI=await loadRustUI()
if(!rustUI)throw new Error('Rust UI did not load in the test environment')
