import { afterEach, expect, it, vi } from 'vitest'
import { settlePageLayout } from '../../src/js/readers/page-snapshot.js'

afterEach(() => vi.unstubAllGlobals())

it.each([undefined, null])('keeps the original document-font barrier and two frames for options %s', async options => {
  let finishFonts
  const callbacks = []
  const ready = new Promise(resolve => { finishFonts = resolve })
  vi.stubGlobal('requestAnimationFrame', callback => { callbacks.push(callback); return callbacks.length })
  const pending = settlePageLayout({ fonts:{ ready } }, options)
  await Promise.resolve(); expect(callbacks).toHaveLength(0)
  finishFonts(); await Promise.resolve(); expect(callbacks).toHaveLength(1)
  callbacks.shift()(0); expect(callbacks).toHaveLength(1)
  let settled = false; pending.then(() => { settled = true })
  await Promise.resolve(); expect(settled).toBe(false)
  callbacks.shift()(0); await pending; expect(settled).toBe(true)
})

it('skips only the explicit font dependency and still waits for both frames', async () => {
  const callbacks = []
  const fonts = vi.fn(() => { throw new Error('Unrelated fonts must not be read') })
  const doc = Object.defineProperty({}, 'fonts', { get:fonts })
  vi.stubGlobal('requestAnimationFrame', callback => { callbacks.push(callback); return callbacks.length })
  let settled = false
  const pending = settlePageLayout(doc, { waitForFonts:false }).then(() => { settled = true })
  expect(fonts).not.toHaveBeenCalled(); expect(callbacks).toHaveLength(1)
  callbacks.shift()(0); expect(callbacks).toHaveLength(1)
  await Promise.resolve(); expect(settled).toBe(false)
  callbacks.shift()(0); await pending; expect(settled).toBe(true)
  expect(fonts).not.toHaveBeenCalled()
})
