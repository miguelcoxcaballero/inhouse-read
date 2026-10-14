// The natural-voice engine, its players and its stores run in the Rust UI module, which the reader always has loaded
// before it builds one. Suites that drive them directly start from the same state: the real module, initialised once,
// and registered with the app's own loader unless the suite replaces that loader with its own `getRustUI`.
import {readFileSync} from 'node:fs'
import * as ui from '../../../src/wasm/ui/inhouse_read_ui.js'

ui.initSync({module:readFileSync('src/wasm/ui/inhouse_read_ui_bg.wasm')})
const loader=await import('../../../src/js/rust-ui.js')
try{await loader.loadRustUI()}catch{/* the suite mocks the loader and provides getRustUI itself */}
export const rustUI=ui
