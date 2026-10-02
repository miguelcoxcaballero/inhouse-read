// Ships onnxruntime-web's WebAssembly runtime as plain files of OUR site (neural-voice/ort/ under the base URL), never from a
// CDN: the neural voices must work offline and the sandbox/CDNs may be blocked. The synthesis worker imports
// ort.wasm.min.mjs at run time and ONNX Runtime fetches ort-wasm-simd-threaded.{mjs,wasm} next to it, so these are not part
// of any bundle: the build copies them to dist/neural-voice/ort/ and 'vite dev' serves them from node_modules at the same URL.
// (The phonemizer's files are committed under public/neural-voice/phon/ and need no plugin.)
import { readFileSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

export const ORT_FILES = ['ort.wasm.min.mjs', 'ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.wasm']
const TYPES = { '.mjs': 'text/javascript', '.wasm': 'application/wasm' }

function ortDist() {
  const require = createRequire(import.meta.url)
  // onnxruntime-web restricts "exports", so locate the package through its package.json's folder.
  let dir = dirname(require.resolve('onnxruntime-web'))
  while (!existsSync(join(dir, 'package.json')) || !/"name":\s*"onnxruntime-web"/.test(readFileSync(join(dir, 'package.json'), 'utf8'))) {
    const parent = dirname(dir)
    if (parent === dir) throw new Error('onnxruntime-web not found')
    dir = parent
  }
  return join(dir, 'dist')
}

export function neuralVoiceAssets() {
  let base = '/'
  const dist = ortDist()
  return {
    name: 'inhouse-neural-voice-assets',
    configResolved(config) { base = config.base.endsWith('/') ? config.base : config.base + '/' },
    configureServer(server) {
      const prefix = `${base}neural-voice/ort/`
      server.middlewares.use((req, res, next) => {
        const path = (req.url || '').split('?')[0]
        const name = path.startsWith(prefix) ? path.slice(prefix.length) : ''
        if (!ORT_FILES.includes(name)) return next()
        res.setHeader('content-type', TYPES[name.slice(name.lastIndexOf('.'))])
        res.setHeader('cache-control', 'no-cache')
        res.end(readFileSync(join(dist, name)))
      })
    },
    generateBundle() {
      for (const name of ORT_FILES) this.emitFile({ type: 'asset', fileName: `neural-voice/ort/${name}`, source: readFileSync(join(dist, name)) })
    }
  }
}
