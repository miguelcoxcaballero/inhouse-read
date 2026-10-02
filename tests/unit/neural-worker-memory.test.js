import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// The worker cannot run in jsdom, so the settings that keep its memory flat are checked in its source: without them a
// phone's WebView ran out of memory after a sentence or two ('La voz natural no arrancó') because every fragment has a
// different length and onnxruntime keeps the buffers of each new shape.
describe('neural worker memory', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/js/readers/neural-voice/worker.js'), 'utf8')
  const create = source.match(/InferenceSession\.create\(new Uint8Array\(model\), \{[^}]*\}/)?.[0] || ''
  it('creates the session without the memory arena and the memory-pattern planner', () => {
    expect(create).toContain('enableCpuMemArena: false')
    expect(create).toContain('enableMemPattern: false')
  })
  it('still runs on the single-threaded WASM provider', () => {
    expect(create).toContain("executionProviders: ['wasm']")
  })
})
