// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import { createPhonemizer, REBUILD_EVERY } from '../../src/js/readers/neural-voice/phonemizer.js'

// The real Emscripten module has a fixed 17 MB heap that each call erodes: after 74-155 calls (fewer for long texts) it
// throws for good and, called on, crashes the renderer. A module that, like it, dies after a number of calls:
const mortal = (life) => {
  const modules = []
  const factory = vi.fn(async hooks => {
    let calls = 0
    const module = { callMain: vi.fn(() => { if (++calls > life) throw new Error('null function or function signature mismatch'); hooks.print(JSON.stringify({ phoneme_ids: [1, 0, 2] })) }) }
    modules.push(module)
    return module
  })
  return { factory, modules, importModule: vi.fn(async () => ({ default: factory })) }
}

describe('createPhonemizer module lifetime', () => {
  it('replaces the module every N calls, long before one would die', async () => {
    const { factory, modules, importModule } = mortal(74)
    const phonemizer = await createPhonemizer({ base: 'https://site/phon/', importModule, rebuildEvery: 40 })
    for (let i = 0; i < 500; i++) expect(await phonemizer.phonemize(`fragmento ${i}`, 'es')).toEqual([1, 0, 2])
    expect(factory).toHaveBeenCalledTimes(Math.ceil(500 / 40))
    expect(Math.max(...modules.map(module => module.callMain.mock.calls.length))).toBe(40)
  })

  it('the default is far below the 74 calls a 180-character text allows', async () => {
    expect(REBUILD_EVERY).toBeLessThanOrEqual(40)
    const { modules, importModule } = mortal(74)
    const phonemizer = await createPhonemizer({ base: 'https://site/phon/', importModule })
    for (let i = 0; i < 300; i++) await phonemizer.phonemize(`fragmento ${i}`, 'es') // would throw on the 75th call of one module
    expect(modules.length).toBeGreaterThan(1)
  })

  it('retries a text once on a fresh module when a call throws, and does not trust the dead one again', async () => {
    const { factory, modules, importModule } = mortal(3)
    const phonemizer = await createPhonemizer({ base: 'https://site/phon/', importModule, rebuildEvery: 1000 })
    for (let i = 0; i < 10; i++) expect(await phonemizer.phonemize(`texto ${i}`, 'es')).toEqual([1, 0, 2])
    expect(factory.mock.calls.length).toBeGreaterThan(2)
    expect(modules.slice(0, -1).every(module => module.callMain.mock.calls.length === 4)).toBe(true) // each dead module failed once and was dropped
  })

  it('gives up with the reason when the fresh module fails too', async () => {
    const { importModule } = mortal(0)
    const phonemizer = await createPhonemizer({ base: 'https://site/phon/', importModule })
    await expect(phonemizer.phonemize('a', 'es')).rejects.toThrow(/phonemizer failed: null function/)
  })
})
