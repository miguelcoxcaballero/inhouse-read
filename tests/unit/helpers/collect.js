// A real garbage collection for leak tests: V8 is asked for `gc` at run time, and the finalizers it
// schedules (wasm-bindgen frees an exported Rust object when its JavaScript wrapper is collected)
// run as tasks, so the event loop gets several turns between collections.
import v8 from 'node:v8'
import vm from 'node:vm'

v8.setFlagsFromString('--expose-gc')
const gc = vm.runInNewContext('gc')

export async function collect(rounds = 10) {
  for (let round = 0; round < rounds; round++) {
    gc()
    await new Promise(resolve => setTimeout(resolve, 0))
  }
}
