// TEMPORARY local measurement, never committed.
import { test, expect } from '@playwright/test'
import { switchShelfView } from './helpers/shelf-view-gesture.mjs'
test('80 legacy books: time to rest', async ({ page }) => {
  test.setTimeout(600_000)
  await page.setViewportSize({ width:390, height:844 })
  await page.emulateMedia({ reducedMotion:process.env.MOTION || 'reduce' })
  await page.goto(process.env.IHR_TEST_URL || './')
  await expect(page.locator('.ihr-bookshelf')).toBeVisible()
  await page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => { const r = indexedDB.open('inhouse-read'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error) })
    const tx = db.transaction('books', 'readwrite')
    for (let index = 0; index < 80; index++) tx.objectStore('books').put({ id:`long-shelf:${index}`, title:`Libro ${index + 1}`, author:'Autor', format:'PDF', sourceType:'local', addedAt:Date.now(), shelfOrder:index,
      wordCount:120000, wordCountVersion:2, wordCountComplete:true, pageCount:400, progressFraction:0 })
    await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = () => reject(tx.error) }); db.close()
  })
  const t0 = Date.now(), log = []
  const sample = async tag => { const a = await page.locator('.ihr-bookshelf-scene').evaluate(c => ({ an:c.dataset.animating, rc:c.dataset.renderCount, ov:c.dataset.overviewBooks, det:c.dataset.detailedBooks, vp:c.dataset.viewProgress })).catch(() => null); log.push([tag, Date.now() - t0, a]); return a }
  await page.reload()
  await expect(page.locator('.ihr-spine')).toHaveCount(80, { timeout:120_000 }); await sample('spines')
  const waitRest = async tag => { for (;;) { const a = await sample(tag); if (a?.an === 'false') break; if (Date.now() - t0 > 400_000) break; await page.waitForTimeout(2000) } }
  if (process.env.REST_FIRST) await waitRest('rest-spine')
  await switchShelfView(page, 'isometric'); await sample('switched')
  await expect(page.locator('.ihr-bookshelf-scene')).toHaveAttribute('data-view-progress', '1', { timeout:120_000 }); await sample('progress1')
  const limit = Number(process.env.WAIT_MS || 90000)
  for (;;) { const a = await sample('rest-iso'); if (a?.an === 'false' || Date.now() - t0 > limit) break; await page.waitForTimeout(2000) }
  const poses = () => page.locator('.ihr-spine').evaluateAll(nodes => nodes.map(n => ({ id:n.dataset.bookId.split(':')[1], lean:Number(n.dataset.sceneLean), shelf:n.dataset.shelfIndex, x:Number(n.dataset.shelfX), l:n.getBoundingClientRect().left, t:n.getBoundingClientRect().top, cls:n.className.replace('ihr-spine','').trim() })))
  const first = await poses(), series = []
  for (let i = 0; i < 6; i++) { await page.waitForTimeout(4000); series.push(await poses()) }
  const movers = first.map((b, i) => ({ id:b.id, shelf:b.shelf, x:+b.x.toFixed(3), cls:b.cls, leans:[b.lean, ...series.map(s => s[i].lean)].map(v => +v.toFixed(4)), dl:Math.max(...series.map(s => Math.abs(s[i].l - b.l))).toFixed(2), dt:Math.max(...series.map(s => Math.abs(s[i].t - b.t))).toFixed(2) })).filter(m => new Set(m.leans).size > 1 || m.dl > 0.05 || m.dt > 0.05)
  console.log('REST80 movers', JSON.stringify(movers))
  console.log('REST80 leaning', JSON.stringify(first.filter(b => Math.abs(b.lean) > .01).length), 'flat', first.filter(b => Math.abs(Math.abs(b.lean) - Math.PI / 2) < .05).length)
  const still = await sample('after'); await page.waitForTimeout(3000); const later = await sample('later')
  console.log('REST80', JSON.stringify(log.filter((e, i, l) => i < 4 || i > l.length - 4 || e[0] !== l[i - 1][0])))
  console.log('REST80 idle', still.rc, later.rc)
})
