// A fresh espeak heap is still created every forty calls. Its immutable code
// and dictionary pack are loaded once per worker, so a heap rebuild never
// depends on another background HTTP request or streaming compilation.
export async function loadPhonemizerFactory(url, {
  importModule = path => import(/* @vite-ignore */ path),
  fetchFile = path => fetch(path),
  compile = bytes => WebAssembly.compile(bytes),
  instantiate = (module, imports) => new WebAssembly.Instance(module, imports)
} = {}) {
  const asset = name => { const path = new URL(url); path.pathname = path.pathname.replace(/[^/]+$/, name); return path.href }
  const read = async name => {
    const response = await fetchFile(asset(name))
    if (!response?.ok) throw new Error(`phonemizer ${name}: HTTP ${response?.status ?? 'no response'}`)
    const bytes = await response.arrayBuffer()
    if (!(bytes instanceof ArrayBuffer) || !bytes.byteLength) throw new Error(`phonemizer ${name}: empty asset`)
    return bytes
  }
  const [{ default: factory }, wasm, data] = await Promise.all([
    importModule(url), read('piper_phonemize.wasm'), read('piper_phonemize.data')
  ])
  const compiled = await compile(wasm)
  return { default: hooks => factory({
    ...hooks,
    // Emscripten gives FS files ownership of slices of this buffer. Give each
    // fresh filesystem its own copy; keep the master pack untouched.
    getPreloadedPackage: () => data.slice(0),
    instantiateWasm: (imports, receive) => {
      const instance = instantiate(compiled, imports)
      receive(instance, compiled)
      return instance.exports
    }
  }) }
}
