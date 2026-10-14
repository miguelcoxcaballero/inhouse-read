import {getRustCore} from '../rust-core.js'

// The numeric core is loaded before any book can be opened (the shelf's first
// render waits for it), so a kernel that has nothing to say is an error to
// report, never a state to work around with a second implementation.
export function coreRequired(result) {
  if (result !== undefined) return result
  throw new Error(getRustCore() ? 'No se pudo calcular la página del PDF.' : 'El módulo numérico no se pudo cargar. Recarga la página.')
}
