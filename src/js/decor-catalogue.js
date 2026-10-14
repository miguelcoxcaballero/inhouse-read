import { getRustDecorCore, loadRustDecorCore } from './rust-decor-core.js'
import { freezeDeep, readTables, requireCore, scratchArena } from './core-tables.js'

// The plant, pot and lamp tables and the numbers derived from them are built by
// the decor core (rust-core/src/plant_catalogue.rs), whose bytes also decide
// whether saved plant and lamp bakes are still valid.
export const core = await requireCore(getRustDecorCore, loadRustDecorCore, 'plant_catalogue_json')
export const tables = readTables(core, 'plant_catalogue_json')
export { freezeDeep }
const arena = scratchArena(core)
export const scratch = arena.view
export const scratchPointer = arena.pointer
