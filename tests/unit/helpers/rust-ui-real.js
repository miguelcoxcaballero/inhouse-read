// A rust-ui.js replacement that hands the app the real compiled Rust UI module, already initialised.
// For tests that mount the whole application (reader, progress queue, prepared page have no JavaScript twin).
import {readFileSync} from 'node:fs'

export async function rustUiMock() {
  const ui = await import('../../../src/wasm/ui/inhouse_read_ui.js')
  ui.initSync({ module:readFileSync('src/wasm/ui/inhouse_read_ui_bg.wasm') })
  return {
    getRustUI:() => ui,
    loadRustUI:() => Promise.resolve(ui),
    requireRustUI:() => Promise.resolve(ui),
    waitForRustUI:() => Promise.resolve(ui)
  }
}
