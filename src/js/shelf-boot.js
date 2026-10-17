// index.html starts reading the shelf's records before the app's code has
// loaded. app.js imports this module before anything else, so whatever is
// still missing (the store's own connection, or the whole read where the page
// could not start it) is requested before the rest of the app is evaluated.
import { LibraryStore, recentFirst } from './library-store.js'
import { withBookDataModule } from './book-data-native.js'
import { loadRustCore } from './rust-core.js'
import { loadRustDecorCore } from './rust-decor-core.js'
import { loadRustShelf } from './rust-shelf.js'

// Adopt the page's parallel compilation before the first library read settles.
// This is optional: never make displaying saved books await a network request.
void loadRustCore()
void loadRustDecorCore()
// The shelf's pointer controllers: their module is awaited by the first render.
void loadRustShelf()

export const library = new LibraryStore()
const early = globalThis.__inhouseShelfRead
delete globalThis.__inhouseShelfRead
let firstRecords = early?.done.then(records => records ? records : library.listRaw()) ?? library.listRaw()
// Awaited by the first shelf refresh, which reports a failure as before.
firstRecords.catch(() => {})

/** The start-up read, handed out once: the shelf's first build uses it and
 * every later refresh reads the store again. */
export function takeFirstRawRecords() {
  const records = firstRecords
  firstRecords = null
  return records
}

/** Default public handoff keeps its sorted-once contract; the app's own gate
 * takes raw records to preserve its original parallel bake/module timing. */
export function takeFirstRecords() {
  const records = takeFirstRawRecords()
  return records && records.then(records => withBookDataModule(() => recentFirst(records)))
}
