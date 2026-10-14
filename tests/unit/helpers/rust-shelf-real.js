// A rust-shelf.js replacement that hands the app the real compiled shelf module, already
// initialised. For suites that reset modules and then mount the whole application.
import { readFileSync } from 'node:fs'

export async function rustShelfMock() {
  const shelf = await import('../../../src/wasm/shelf/inhouse_read_shelf.js')
  shelf.initSync({ module: readFileSync('src/wasm/shelf/inhouse_read_shelf_bg.wasm') })
  return {
    getRustShelf: () => shelf,
    loadRustShelf: () => Promise.resolve(shelf),
    requireRustShelf: () => Promise.resolve(shelf)
  }
}
