// TEMPORARY local capture, never committed.
import { test, expect } from '@playwright/test'
import { writeFileSync } from 'node:fs'
test('80 legacy books: dump solver inputs', async ({ page }) => {
  test.setTimeout(600_000)
  await page.setViewportSize({ width:390, height:844 })
  await page.emulateMedia({ reducedMotion:'reduce' })
  await page.addInitScript(() => {
    window.__dump = { calls:0, first:null, last:null, scene:null }
    const observe = result => {
      const instance = result.instance || result, actual = instance.exports
      if (typeof actual?.rustsceneentryframe_settled !== 'function') return result
      const wrap = name => function (...args) {
        const n = document.querySelectorAll('[data-object-id]').length || document.querySelectorAll('.ihr-spine,.ihr-plant,.ihr-lamp').length
        const read = () => { const s = actual.rustgravityframe_states_ptr(args[1]) >>> 0, g = actual.rustgravityframe_geometry_ptr(args[1]) >>> 0, o = actual.rustgravityframe_output_ptr(args[1]) >>> 0
          return s > 8 && n ? { n, states:[...new Float64Array(actual.memory.buffer, s, n * 37)], geometry:[...new Float64Array(actual.memory.buffer, g, n * 9)], output:[...new Float64Array(actual.memory.buffer, o, n * 4)], args:args.slice(7) } : null }
        const out = actual[name](...args)
        window.__dump.calls++
        const snap = read()
        if (snap && snap.n >= 80) { if (!window.__dump.first) window.__dump.first = snap; window.__dump.last = snap }
        return out
      }
      const exports = { ...actual, rustsceneentryframe_settled:wrap('rustsceneentryframe_settled'), rustsceneentryframe_settle:wrap('rustsceneentryframe_settle') }
      const proxy = new Proxy(instance, { get(target, key) { return key === 'exports' ? exports : Reflect.get(target, key, target) } })
      return result.instance ? { ...result, instance:proxy } : proxy
    }
    for (const name of ['instantiate', 'instantiateStreaming']) if (WebAssembly[name]) { const original = WebAssembly[name]; WebAssembly[name] = async function (...args) { return observe(await Reflect.apply(original, WebAssembly, args)) } }
  })
  await page.goto(process.env.IHR_TEST_URL || './')
  await expect(page.locator('.ihr-bookshelf')).toBeVisible()
  await page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => { const r = indexedDB.open('inhouse-read'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error) })
    const tx = db.transaction('books', 'readwrite')
    for (let index = 0; index < 80; index++) tx.objectStore('books').put({ id:`long-shelf:${index}`, title:`Libro ${index + 1}`, author:'Autor', format:'PDF', sourceType:'local', addedAt:Date.now(), shelfOrder:index,
      wordCount:120000, wordCountVersion:2, wordCountComplete:true, pageCount:400, progressFraction:0 })
    await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = () => reject(tx.error) }); db.close()
  })
  await page.reload()
  await expect(page.locator('.ihr-spine')).toHaveCount(80, { timeout:120_000 })
  await page.waitForTimeout(45000)
  const dump = await page.evaluate(() => ({ ...window.__dump, keys:[...document.querySelectorAll('[data-object-id]')].map(n => n.dataset.objectId), canvas:{ ...document.querySelector('.ihr-bookshelf-scene').dataset }, plants:localStorage.getItem('inhouse-read-shelf-plants') }))
  writeFileSync(process.env.DUMP_OUT, JSON.stringify(dump))
  console.log('DUMP', dump.calls, dump.first?.n, dump.keys.length, JSON.stringify(dump.canvas).slice(0, 600))
})
