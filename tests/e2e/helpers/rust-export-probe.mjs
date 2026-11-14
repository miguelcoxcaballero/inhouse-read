// Counts real calls across the JavaScript → WebAssembly boundary of the compiled app, without adding diagnostics to it.
//
// The reader's objects reach Rust through a handful of dispatchers (`experience_method(host, name, args, …)`,
// `flow_method`, `controller_method`, `voice_method`): work that used to be one export per rule now runs inside the
// Rust method the dispatcher names. `methods` therefore counts a dispatcher call per method NAME, read from the UTF-8
// bytes wasm-bindgen hands to the export, so a test still proves which Rust rule ran rather than "some export ran".
//
//   await observeRustExports(page, { store:'placesProof', marker:'reader_bookmark', exports:['reader_bookmark'],
//     methods:{ experience_method:['updateBookmarkButton'] } })
//   → window.placesProof = { available, instances, calls:{ reader_bookmark:n, 'experience_method:updateBookmarkButton':n } }
export async function observeRustExports(page, { store, marker, exports = [], methods = {} }) {
  await page.addInitScript(({ store, marker, exports, methods }) => {
    const proof = window[store] = { available:false, instances:0, calls:{} }
    const count = name => { proof.calls[name] = (proof.calls[name] || 0) + 1 }
    const decoder = new TextDecoder()
    // wasm-bindgen passes a &str as (pointer, byte length): find that pair among the raw arguments.
    const named = (memory, args, names) => {
      for (const name of names) for (let i = 0; i + 1 < args.length; i++) {
        const pointer = args[i], length = args[i + 1]
        if (typeof pointer !== 'number' || length !== name.length || pointer <= 0 || pointer + length > memory.buffer.byteLength) continue
        if (decoder.decode(new Uint8Array(memory.buffer, pointer, length).slice()) === name) return name
      }
      return null
    }
    const observe = result => {
      const instance = result.instance || result, actual = instance.exports
      if (!actual[marker]) return result
      proof.available = true; proof.instances++
      const wrapped = { ...actual }
      for (const name of exports) if (actual[name]) wrapped[name] = (...args) => { count(name); return actual[name](...args) }
      for (const [dispatcher, names] of Object.entries(methods)) if (actual[dispatcher]) wrapped[dispatcher] = (...args) => {
        const name = named(actual.memory, args, names)
        if (name) count(`${dispatcher}:${name}`)
        return actual[dispatcher](...args)
      }
      const proxy = new Proxy(instance, { get(target, key) { return key === 'exports' ? wrapped : Reflect.get(target, key, target) } })
      return result.instance ? { ...result, instance:proxy } : proxy
    }
    for (const name of ['instantiate', 'instantiateStreaming']) if (WebAssembly[name]) {
      const original = WebAssembly[name]
      WebAssembly[name] = async function (...args) { return observe(await Reflect.apply(original, WebAssembly, args)) }
    }
  }, { store, marker, exports, methods })
}
