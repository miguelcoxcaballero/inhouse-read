// A stand-in for Hugging Face (rhasspy/piper-voices layout) for the neural-voice e2e specs: the real host is not reachable
// from CI or the sandbox, so the voices come from a fixture directory holding <piperId>.onnx and <piperId>.onnx.json.
//   NEURAL_VOICE_FIXTURES  that directory (default: the sandbox spike folder). Specs skip themselves when a voice is missing.
// The server speaks like the real one where it matters to the engine: CORS, Range/If-Range, ETag, Content-Length and a
// voices.json catalogue; big files go out in slices with a pause so a download takes a moment and its progress is visible.
import { createServer } from 'node:http'
import { existsSync, statSync, createReadStream } from 'node:fs'
import { join, basename } from 'node:path'

export const FIXTURES = process.env.NEURAL_VOICE_FIXTURES || '/tmp/claude-0/-home-user-inhouse-read/6c70f5ca-de80-5128-bee1-f59b39f4610d/scratchpad/piper/web/models'
export const haveVoice = (piperId, dir = FIXTURES) => existsSync(join(dir, `${piperId}.onnx`)) && existsSync(join(dir, `${piperId}.onnx.json`))

/** 'es_MX-claude-high' -> 'es/es_MX/claude/high/es_MX-claude-high' (the piper-voices layout). */
export function hfPath(piperId) {
  const [locale, ...rest] = piperId.split('-')
  const quality = rest.pop()
  return `${locale.split('_')[0]}/${locale}/${rest.join('-')}/${quality}/${piperId}`
}

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'range, if-range', 'access-control-expose-headers': 'content-length, content-range, etag, accept-ranges' }

/**
 * Starts the mirror on a free port. `hits` collects every path requested; `sliceMs` is the pause between 512 KB slices.
 * Resolves to { base, hits, close(), origin } where `base` is what window.INHOUSE_NEURAL_VOICE_BASE should be.
 */
export function startHuggingFaceMirror({ dir = FIXTURES, voices = [], sliceMs = 25 } = {}) {
  const hits = []
  const server = createServer((request, response) => {
    const { pathname } = new URL(request.url, 'http://x')
    if (request.method === 'OPTIONS') { response.writeHead(204, CORS); return response.end() }
    const rel = pathname.slice('/hf/'.length)
    hits.push(rel)
    if (!pathname.startsWith('/hf/')) { response.writeHead(404, CORS); return response.end('not found') }
    if (rel === 'voices.json') {
      const body = {}
      for (const piperId of voices) {
        const key = hfPath(piperId)
        body[piperId] = { key: piperId, files: {
          [`${key}.onnx`]: { size_bytes: statSync(join(dir, `${piperId}.onnx`)).size, md5_digest: '' },
          [`${key}.onnx.json`]: { size_bytes: statSync(join(dir, `${piperId}.onnx.json`)).size, md5_digest: '' }
        } }
      }
      response.writeHead(200, { ...CORS, 'content-type': 'application/json' })
      return response.end(JSON.stringify(body))
    }
    const name = basename(rel), stem = name.replace(/\.onnx(\.json)?$/, '')
    const file = join(dir, name)
    if (rel !== `${hfPath(stem)}${name.slice(stem.length)}` || !existsSync(file)) { response.writeHead(404, CORS); return response.end('not found') }
    const size = statSync(file).size
    const range = /bytes=(\d+)-(\d*)/.exec(request.headers.range || '')
    const start = range ? Number(range[1]) : 0, end = range && range[2] ? Number(range[2]) : size - 1
    response.writeHead(range ? 206 : 200, { ...CORS, etag: '"fixture"', 'accept-ranges': 'bytes', 'content-type': 'application/octet-stream', 'content-length': end - start + 1, ...(range ? { 'content-range': `bytes ${start}-${end}/${size}` } : {}) })
    const stream = createReadStream(file, { start, end, highWaterMark: 512 * 1024 })
    request.on('close', () => stream.destroy())
    if (!sliceMs || size < 1_000_000) return stream.pipe(response)
    stream.on('data', chunk => { stream.pause(); const resume = () => setTimeout(() => stream.resume(), sliceMs); if (!response.write(chunk)) response.once('drain', resume); else resume() })
    stream.on('end', () => response.end())
  })
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => {
    const { port } = server.address()
    resolve({ hits, origin: `http://127.0.0.1:${port}`, base: `http://127.0.0.1:${port}/hf/`, close: () => new Promise(done => { server.closeAllConnections?.(); server.close(done) }) })
  }))
}
