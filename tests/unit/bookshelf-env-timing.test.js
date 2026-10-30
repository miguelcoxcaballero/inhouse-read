// Timing of one call through the shelf's lookup table, the way the shelf's parts make it from Rust
// (`call(read(env, name), name, args)`), with the frozen JavaScript's arrow wrappers against the getters
// bookshelf.js builds from rust-ui/src/bookshelf/mount.rs's table (shelf_env_table). Reports both.
import { describe, expect, it } from 'vitest'
import * as bookTitle from '../../src/js/book-title.js'

const { rustShelf } = await import('./helpers/rust-shelf-ready.js')
const { createShelfLookup } = await import('../../src/js/bookshelf.js')

function timing(env) {
  const rounds = 200000
  let last
  for (let index = 0; index < 20000; index++) last = Reflect.get(env, 'normalizeBookAuthor').call(undefined, '  Ana  ')
  const started = performance.now()
  for (let index = 0; index < rounds; index++) last = Reflect.get(env, 'normalizeBookAuthor').call(undefined, '  Ana  ')
  return { elapsed:(performance.now() - started) / rounds * 1e6, last }
}

describe('a call through the shelf lookup table', () => {
  it('times a wrapper against a getter', () => {
    const wrappers = { normalizeBookAuthor:(...args) => bookTitle.normalizeBookAuthor(...args) }
    const getters = createShelfLookup(rustShelf.shelf_env_table(), new Proxy({}, { get:() => bookTitle }), { physicalPlacement:false,
      analyzeCoverAppearance() {}, warmShelfCover() {}, prepareShelfFonts() {} })
    const js = [timing(wrappers), timing(wrappers)], rust = [timing(getters), timing(getters)]
    expect(rust[0].last).toBe(js[0].last)
    const best = runs => Math.min(...runs.map(run => run.elapsed))
    // Building the table, once per page at the first renderBookshelf (the frozen JavaScript built its
    // object literal of wrappers once, when the module was evaluated).
    const modules = new Proxy({}, { get:() => bookTitle }), own = { physicalPlacement:false, analyzeCoverAppearance() {}, warmShelfCover() {}, prepareShelfFonts() {} }
    for (let index = 0; index < 50; index++) createShelfLookup(rustShelf.shelf_env_table(), modules, own)
    let built = Infinity
    for (let round = 0; round < 5; round++) {
      const started = performance.now()
      for (let index = 0; index < 200; index++) createShelfLookup(rustShelf.shelf_env_table(), modules, own)
      built = Math.min(built, (performance.now() - started) / 200 * 1000)
    }
    // Building the public handle (shelf_handle), once per renderBookshelf, over a stand-in for the mounted context.
    const ctx = { mounted:() => ({ state:{}, parts:{}, root:null, lifecycle:{} }) }
    for (let index = 0; index < 50; index++) rustShelf.shelf_handle(ctx, rustShelf)
    let handle = Infinity
    for (let round = 0; round < 5; round++) {
      const started = performance.now()
      for (let index = 0; index < 200; index++) rustShelf.shelf_handle(ctx, rustShelf)
      handle = Math.min(handle, (performance.now() - started) / 200 * 1000)
    }
    console.log(`shelf lookup call: wrapper ${best(js).toFixed(1)} ns, getter ${best(rust).toFixed(1)} ns; building the table ${built.toFixed(1)} us; building the handle ${handle.toFixed(1)} us`)
  })
})
