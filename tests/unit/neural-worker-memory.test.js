import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// The worker cannot run in jsdom, so the settings that keep its memory flat are checked in its source: without them a
// phone's WebView ran out of memory after a sentence or two ('La voz natural no arrancó') because every fragment has a
// different length and onnxruntime keeps the buffers of each new shape.
// The session is created by the worker's runtime in the voice module (rust-ui/src/voice_worker.rs); what it really hands to
// ONNX Runtime is compared with the frozen JavaScript worker in voice-worker-runtime-wasm.test.js.
describe('neural worker memory', () => {
  const source = readFileSync(resolve(process.cwd(), 'rust-ui/src/voice_worker.rs'), 'utf8')
  const create = source.match(/let options = record\(&\[\("executionProviders"[^;]*;/)?.[0] || ''
  it('creates the session without the memory arena and the memory-pattern planner', () => {
    expect(create).toContain('("enableCpuMemArena", &JsValue::FALSE)')
    expect(create).toContain('("enableMemPattern", &JsValue::FALSE)')
  })
  it('still runs on the single-threaded WASM provider', () => {
    expect(create).toContain('("executionProviders", &Array::of1(text("wasm")).into())')
  })
})
