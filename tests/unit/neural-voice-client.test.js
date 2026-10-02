// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import { SynthClient } from '../../src/js/readers/neural-voice/client.js'

/** A Worker the test answers by hand. */
function fakeWorker() {
  const worker = {
    sent: [], terminated: false, onmessage: null, onerror: null,
    postMessage(message, transfer) { worker.sent.push({ message, transfer }) },
    terminate() { worker.terminated = true },
    reply(data) { worker.onmessage({ data }) },
    last(type) { return [...worker.sent].reverse().find(s => s.message.type === type) }
  }
  return worker
}

function setup(overrides = {}) {
  const worker = fakeWorker()
  const model = new ArrayBuffer(8)
  const client = new SynthClient({
    createWorker: vi.fn(() => worker), ortBase: 'https://site/ort/', phonBase: 'https://site/phon/',
    readModel: vi.fn(async () => model), readConfig: vi.fn(async id => ({ id, audio: { sample_rate: 22050 } })),
    ...overrides
  })
  return { client, worker, model }
}
const settle = async () => { for (let i = 0; i < 8; i++) await Promise.resolve() }

describe('SynthClient', () => {
  it('transfers the cached auxiliary pointing model with Hebrew weights', async () => {
    const auxiliary = new ArrayBuffer(12)
    const { client, worker, model } = setup({ readPhonemizerModel:vi.fn(async () => auxiliary) })
    const ready = client.prepare('he_IL-saspeech-medium')
    await settle()
    worker.reply({ type:'ready', id:worker.last('init').message.id })
    await settle()
    const loading = worker.last('load')
    expect(loading.message.phonemizerModel).toBe(auxiliary)
    expect(loading.transfer).toEqual([model, auxiliary])
    worker.reply({ type:'loaded', id:loading.message.id })
    await ready
    expect(client.loaded).toBe('he_IL-saspeech-medium')
  })

  it('spawns the worker once, inits it with OUR asset folders and loads the voice with the model transferred', async () => {
    const { client, worker, model } = setup()
    const prepared = client.prepare('es_MX-claude-high')
    await settle()
    const init = worker.last('init')
    expect(init.message).toMatchObject({ ortBase: 'https://site/ort/', phonBase: 'https://site/phon/' })
    worker.reply({ type: 'ready', id: init.message.id })
    await settle()
    const load = worker.last('load')
    expect(load.message).toMatchObject({ voice: 'es_MX-claude-high', config: { audio: { sample_rate: 22050 } } })
    expect(load.transfer).toEqual([model])
    worker.reply({ type: 'loaded', id: load.message.id, createMs: 1234 })
    expect(await prepared).toMatchObject({ audio: { sample_rate: 22050 } })
    expect(client.createWorker).toHaveBeenCalledTimes(1)
    expect(client.alive).toBe(true)
    // same voice again: nothing is sent
    const sent = worker.sent.length
    await client.prepare('es_MX-claude-high')
    expect(worker.sent.length).toBe(sent)
  })

  it('replaces the session when another voice is asked for (one session alive)', async () => {
    const { client, worker } = setup()
    const answer = async () => {
      await settle()
      for (const { message } of worker.sent.slice(-2)) {
        if (message.type === 'init') worker.reply({ type: 'ready', id: message.id })
        if (message.type === 'load') worker.reply({ type: 'loaded', id: message.id })
      }
    }
    const first = client.prepare('es_MX-claude-high'); await answer(); await settle(); await answer(); await first
    const second = client.prepare('en_US-lessac-medium'); await answer(); await second
    expect(worker.sent.filter(s => s.message.type === 'init').length).toBe(1)
    expect(worker.sent.filter(s => s.message.type === 'load').map(s => s.message.voice)).toEqual(['es_MX-claude-high', 'en_US-lessac-medium'])
  })

  async function ready(client, worker) {
    const prepared = client.prepare('es_MX-claude-high')
    await settle(); worker.reply({ type: 'ready', id: worker.last('init').message.id })
    await settle(); worker.reply({ type: 'loaded', id: worker.last('load').message.id })
    await prepared
  }

  it('routes the plan, the chunks and the end of a job to its handlers, and ignores other ids', async () => {
    const { client, worker } = setup()
    await ready(client, worker)
    const handlers = { onPlan: vi.fn(), onChunk: vi.fn(), onEnd: vi.fn(), onError: vi.fn() }
    const job = client.synth({ text: 'Hola.', rate: 1.2, speaker: 1 }, handlers)
    expect(worker.last('synth').message).toMatchObject({ id: job.id, text: 'Hola.', rate: 1.2, speaker: 1 })
    worker.reply({ type: 'plan', id: job.id, counts: [10, 20] })
    worker.reply({ type: 'chunk', id: job.id, index: 0, last: false, pcm: new Float32Array(3), sampleRate: 22050, ms: 5 })
    worker.reply({ type: 'chunk', id: 999, index: 0, last: true, pcm: new Float32Array(3), sampleRate: 22050, ms: 5 })
    worker.reply({ type: 'end', id: job.id })
    expect(handlers.onPlan).toHaveBeenCalledWith([10, 20])
    expect(handlers.onChunk).toHaveBeenCalledTimes(1)
    expect(handlers.onEnd).toHaveBeenCalledTimes(1)
    expect(handlers.onError).not.toHaveBeenCalled()
  })

  it('cancel() tells the worker and silences the handlers', async () => {
    const { client, worker } = setup()
    await ready(client, worker)
    const handlers = { onPlan: vi.fn(), onChunk: vi.fn(), onEnd: vi.fn(), onError: vi.fn() }
    const job = client.synth({ text: 'Hola.', rate: 1, speaker: 0 }, handlers)
    job.cancel()
    job.cancel()
    expect(worker.sent.filter(s => s.message.type === 'cancel').length).toBe(1)
    worker.reply({ type: 'chunk', id: job.id, index: 0, last: true, pcm: new Float32Array(3), sampleRate: 22050, ms: 5 })
    expect(handlers.onChunk).not.toHaveBeenCalled()
  })

  it("reports a worker-side failure of a job as 'synth-failed'", async () => {
    const { client, worker } = setup()
    await ready(client, worker)
    const handlers = { onChunk: vi.fn(), onEnd: vi.fn(), onError: vi.fn() }
    const job = client.synth({ text: 'x', rate: 1, speaker: 0 }, handlers)
    worker.reply({ type: 'error', id: job.id, error: 'boom' })
    expect(handlers.onError).toHaveBeenCalledWith(expect.objectContaining({ code: 'synth-failed', message: 'boom' }))
  })

  it('a worker crash fails the running job, drops the worker and lets the next prepare() build a new one', async () => {
    const { client, worker } = setup()
    await ready(client, worker)
    const handlers = { onChunk: vi.fn(), onEnd: vi.fn(), onError: vi.fn() }
    client.synth({ text: 'x', rate: 1, speaker: 0 }, handlers)
    worker.onerror({ message: 'out of memory', preventDefault() {} })
    expect(handlers.onError).toHaveBeenCalledWith(expect.objectContaining({ code: 'init-failed' }))
    expect(client.alive).toBe(false)
    expect(worker.terminated).toBe(true)
    expect(() => client.synth({ text: 'x', rate: 1, speaker: 0 }, handlers)).toThrow(/not running/)
  })

  it.each(['onerror', 'onmessageerror'])('ignores a late %s from a released worker while its replacement is speaking', async eventName => {
    const oldWorker = fakeWorker(), replacement = fakeWorker()
    const { client } = setup({ createWorker: vi.fn().mockReturnValueOnce(oldWorker).mockReturnValueOnce(replacement) })
    try {
      await ready(client, oldWorker)
      const late = oldWorker[eventName]
      client.dispose()
      await ready(client, replacement)
      const handlers = { onChunk: vi.fn(), onEnd: vi.fn(), onError: vi.fn() }
      const job = client.synth({ text: 'Nueva voz.', rate: 1 }, handlers)
      late({ message: 'old worker failure', preventDefault() {} })
      expect(client.alive).toBe(true)
      expect(replacement.terminated).toBe(false)
      expect(handlers.onError).not.toHaveBeenCalled()
      replacement.reply({ type: 'chunk', id: job.id, index: 0, last: true, pcm: new Float32Array(3), sampleRate: 22050, ms: 5 })
      replacement.reply({ type: 'end', id: job.id })
      expect(handlers.onChunk).toHaveBeenCalledOnce()
      expect(handlers.onEnd).toHaveBeenCalledOnce()
    } finally { client.dispose() }
  })

  it("rejects prepare() with 'init-failed' (and frees the worker) when ONNX Runtime or the phonemizer cannot start", async () => {
    const { client, worker } = setup()
    const prepared = client.prepare('es_MX-claude-high')
    await settle()
    worker.reply({ type: 'error', id: worker.last('init').message.id, error: 'wasm failed' })
    await expect(prepared).rejects.toMatchObject({ code: 'init-failed' })
    expect(client.alive).toBe(false)
  })

  it('dispose() terminates the worker', async () => {
    const { client, worker } = setup()
    await ready(client, worker)
    client.dispose()
    expect(worker.terminated).toBe(true)
    expect(client.alive).toBe(false)
    client.dispose() // harmless twice
  })

  it('loads overlapping voice preparations in request order even when the first model read is slower', async () => {
    let finishFirst
    const firstBytes = new Promise(resolve => { finishFirst = resolve })
    const { client, worker } = setup({ readModel: id => id === 'es_MX-claude-high' ? firstBytes : Promise.resolve(new ArrayBuffer(8)) })
    const first = client.prepare('es_MX-claude-high'), second = client.prepare('nl_NL-pim-medium')
    first.catch(() => {}); second.catch(() => {})
    try {
      await settle(); worker.reply({ type:'ready', id:worker.last('init').message.id }); await settle()
      expect(worker.sent.filter(({ message }) => message.type === 'load')).toEqual([])
      finishFirst(new ArrayBuffer(8)); await settle()
      expect(worker.last('load').message.voice).toBe('es_MX-claude-high')
      worker.reply({ type:'loaded', id:worker.last('load').message.id }); await first; await settle()
      expect(worker.last('load').message.voice).toBe('nl_NL-pim-medium')
      worker.reply({ type:'loaded', id:worker.last('load').message.id }); await second
      expect(client.loaded).toBe('nl_NL-pim-medium')
    } finally { finishFirst(new ArrayBuffer(8)); client.dispose(); await settle() }
  })

  it('rejects pending and queued preparations on dispose without spawning an orphan worker', async () => {
    const { client, worker } = setup()
    const outcomes = []
    for (const id of ['es_MX-claude-high', 'nl_NL-pim-medium']) {
      client.prepare(id).then(() => outcomes.push('ready'), error => outcomes.push(error.code))
    }
    await settle()
    expect(worker.last('init')).toBeTruthy()
    client.dispose(); await settle()
    expect(outcomes).toEqual(['init-failed', 'init-failed'])
    expect(client.createWorker).toHaveBeenCalledOnce()
    expect(client.alive).toBe(false)
  })

  it('rejects preparation immediately when disposed during the model cache read', async () => {
    let finishRead, outcome = 'pending'
    const { client, worker } = setup({ readModel:() => new Promise(resolve => { finishRead = resolve }) })
    client.prepare('nl_NL-pim-medium').then(() => { outcome = 'ready' }, error => { outcome = error.code })
    try {
      await settle(); worker.reply({ type:'ready', id:worker.last('init').message.id }); await settle()
      client.dispose(); await settle()
      expect(outcome).toBe('init-failed')
    } finally { finishRead(new ArrayBuffer(8)); await settle(); client.dispose() }
  })
})
