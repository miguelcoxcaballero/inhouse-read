import { getRustCore, loadRustCore } from './rust-core.js'
import { freezeDeep, readTables, requireCore, scratchArena } from './core-tables.js'

// The cabinets, the spine palette and the layout defaults of the shelf: tables
// of the app core (rust-core/src/catalogue.rs), awaited like the core itself.
export const core = await requireCore(getRustCore, loadRustCore, 'catalogue_json')
export const tables = readTables(core, 'catalogue_json')
export { freezeDeep }
const arena = scratchArena(core)
export const scratch = arena.view
export const scratchPointer = arena.pointer
