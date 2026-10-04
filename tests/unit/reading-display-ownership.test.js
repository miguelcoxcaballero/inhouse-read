import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { initReadingDisplay } from '../../src/js/reading-display.js'

let policy, ownership, legacy, request, visibility, locks
const settle = async () => { for (let i = 0; i < 8; i++) await Promise.resolve() }
const classes = async value => { document.body.className = value; await settle() }
const hide = async value => {
  visibility = value ? 'hidden' : 'visible'
  document.dispatchEvent(new Event('visibilitychange')); await settle()
}
beforeEach(() => {
  document.body.className = ''; visibility = 'visible'; locks = []
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility)
  ownership = vi.fn(); legacy = vi.fn()
  window.InhouseNative = { setReaderOwnership:ownership, setReadingMode:legacy }
  request = vi.fn(async () => {
    const lock = new EventTarget()
    lock.release = vi.fn(async () => lock.dispatchEvent(new Event('release')))
    locks.push(lock); return lock
  })
  policy = initReadingDisplay({ navigator:{ wakeLock:{ request } } })
})
afterEach(async () => {
  policy.dispose(); await settle()
  delete window.InhouseNative; document.body.className = ''; vi.restoreAllMocks()
})

describe('native reader lifecycle ownership', () => {
  it('keeps book ownership across lock and wake without a second native display transition', async () => {
    await classes('is-reading'); await hide(true)
    expect(locks[0].release).toHaveBeenCalledTimes(1)
    expect(ownership.mock.calls).toEqual([[false], [true]])
    await hide(false); window.dispatchEvent(new Event('focus')); await settle()
    expect(request).toHaveBeenCalledTimes(2)
    expect(ownership.mock.calls).toEqual([[false], [true]])
    expect(legacy).not.toHaveBeenCalled()
  })
  it('releases ownership when the reader closes while the screen is locked', async () => {
    await classes('is-reading'); await hide(true); await classes('')
    expect(ownership.mock.calls).toEqual([[false], [true], [false]])
    await hide(false)
    expect(ownership.mock.calls).toEqual([[false], [true], [false]])
    expect(request).toHaveBeenCalledTimes(1)
  })
  it('releases ownership on disposal even if the book remains open', async () => {
    await classes('is-reading'); policy.dispose(); policy.dispose()
    expect(ownership.mock.calls).toEqual([[false], [true], [false]])
    await hide(true); await hide(false)
    expect(request).toHaveBeenCalledTimes(1)
  })
  it('releases on pagehide and reasserts ownership after a cached pageshow', async () => {
    await classes('is-reading')
    window.dispatchEvent(new Event('pagehide')); await settle()
    expect(ownership).toHaveBeenLastCalledWith(false)
    window.dispatchEvent(new Event('pageshow')); await settle()
    expect(ownership).toHaveBeenLastCalledWith(true)
    expect(request).toHaveBeenCalledTimes(2)
  })
  it('retains the established ownership throughout opening and return animations', async () => {
    await classes('is-reading is-opening-reader')
    expect(ownership.mock.calls).toEqual([[false]])
    await classes('is-reading'); await classes('is-closing-reader')
    await hide(true); await hide(false)
    expect(ownership.mock.calls).toEqual([[false], [true]])
    await classes('')
    expect(ownership).toHaveBeenLastCalledWith(false)
  })
})

const source = readFileSync('android/html_to_apk_builder.py', 'utf8').replace(/\r\n?/g, '\n')
const kotlinStart = source.indexOf('f"""package {package_id}\n')
for (const [name, template] of [
  ['Java', source.slice(source.indexOf('f"""package {package_id};'), kotlinStart)],
  ['Kotlin', source.slice(kotlinStart)],
]) {
  it(`${name}: checks origin and updates ownership on the Activity UI thread`, () => {
    const setter = template.slice(template.indexOf('setReaderOwnership('), template.indexOf('setReadingMode('))
    expect(setter).toContain('runOnUiThread')
    expect(setter).toContain('if (!isTrustedReadPage())')
    expect(setter).toContain('readingMode = enabled')
    expect(setter).toContain('applyReadingDisplay()')
  })
}
