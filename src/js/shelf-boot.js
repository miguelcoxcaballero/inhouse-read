// index.html starts reading the shelf's records before the app's code has
// loaded. app.js imports this module before anything else, so whatever is
// still missing (the store's own connection, or the whole read where the page
// could not start it) is requested before the rest of the app is evaluated.
import { LibraryStore, recentFirst } from './library-store.js'

export const library = new LibraryStore()
const early = globalThis.__inhouseShelfRead
delete globalThis.__inhouseShelfRead
let firstRecords = early?.done.then(records => records ? recentFirst(records) : library.listAll()) ?? library.listAll()
// Awaited by the first shelf refresh, which reports a failure as before.
firstRecords.catch(() => {})

/** The start-up read, handed out once: the shelf's first build uses it and
 * every later refresh reads the store again. */
export function takeFirstRecords() {
  const records = firstRecords
  firstRecords = null
  return records
}
