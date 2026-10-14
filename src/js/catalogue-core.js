import { getRustCore, loadRustCore } from './rust-core.js'
import { reloadOnceAfterChunkFailure } from './chunk-recovery.js'

// The shelf's static tables (cabinets, IKEA pots and plants, lamps, spine
// palette) and the numbers derived from them are built by the Rust core. The
// page starts compiling that core before the app's modules arrive, so this
// wait is normally already over when the first module reaches it; there is no
// JavaScript copy of the tables to fall back to.
const MESSAGE = 'No se pudo cargar la estantería. Comprueba la conexión e inténtalo de nuevo.'

function unavailable(cause) {
  reloadOnceAfterChunkFailure()
  try {
    const note = Object.assign(document.createElement('p'), { textContent: MESSAGE })
    note.setAttribute('role', 'alert')
    document.getElementById('bookshelf-root')?.replaceChildren(note)
  } catch { /* no document: the error below is all there is */ }
  return new Error(MESSAGE, { cause })
}

export const core = getRustCore() ?? await loadRustCore().catch(() => null)
if (typeof core?.catalogue_json !== 'function') throw unavailable(new Error('Rust core unavailable'))

function readCatalogue() {
  const size = core.catalogue_json(0, 0)
  const words = Math.ceil(size / 8)
  const pointer = size > 0 ? core.alloc_f64(words) : 0
  if (!pointer) throw unavailable(new Error('Rust catalogue unavailable'))
  try {
    if (core.catalogue_json(pointer, words * 8) !== size) throw new Error('Rust catalogue changed while reading')
    return JSON.parse(new TextDecoder().decode(new Uint8Array(core.memory.buffer, pointer, size)))
  } catch (error) { throw error.cause ? error : unavailable(error) }
  finally { core.free_f64(pointer, words) }
}

export const tables = readCatalogue()

export function freezeDeep(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freezeDeep(child)
    Object.freeze(value)
  }
  return value
}

// One small arena for the scalar kernels below. It is allocated once and kept:
// the call sites are on the shelf's layout path and must not allocate per call.
const SCRATCH_WORDS = 16
const scratchAt = core.alloc_f64(SCRATCH_WORDS)
if (!scratchAt) throw unavailable(new Error('Rust scratch unavailable'))
/** A fresh view of the arena (memory growth detaches older ones). */
export const scratch = () => new Float64Array(core.memory.buffer, scratchAt, SCRATCH_WORDS)
export const scratchPointer = scratchAt
