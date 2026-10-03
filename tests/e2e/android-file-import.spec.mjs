import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'

const pdf = [...readFileSync('tests/e2e/fixtures/tiny.pdf')]
// A cold import constructs its first shelf on return. CI's software WebGL
// needs a separate observation budget; ordinary runs retain 30 seconds.
const returnTimeout = Number(process.env.ANDROID_IMPORT_RETURN_TIMEOUT_MS || 30_000)

async function installInbox(page, cold) {
  await page.addInitScript(({ bytes, cold }) => {
    const entries = []
    const entry = { id:'11111111-1111-1111-1111-111111111111', name:'Android_Open_With.pdf', mimeType:'application/pdf', size:bytes.length }
    window.testImportAcks = []
    window.testDeliverBook = (name = entry.name) => entries.push({ ...entry, name })
    window.InhouseBookImports = {
      pending:() => JSON.stringify(entries),
      readChunk:(id, offset) => btoa(String.fromCharCode(...bytes.slice(offset, offset + 64))),
      acknowledge:id => { window.testImportAcks.push(id); entries.splice(0,1) }
    }
    if (cold) window.testDeliverBook()
  }, { bytes:pdf, cold })
}

for (const cold of [true, false]) test(`Android Abrir con: importa los bytes exactos con la app ${cold ? 'cerrada' : 'abierta'}`, async ({ page }) => {
  test.setTimeout(Math.max(60_000, returnTimeout * 2))
  await installInbox(page, cold)
  await page.goto(process.env.IHR_TEST_URL || '/')
  if (!cold) {
    await expect(page.locator('#home-screen')).toBeVisible()
    await page.evaluate(() => window.testDeliverBook())
  }
  await expect(page.locator('#reader-screen')).toBeVisible()
  await expect(page.locator('#reader-format-badge')).toHaveText('PDF')
  await page.waitForFunction(() => window.testImportAcks.length === 1)
  const saved = await page.evaluate(async () => {
    const db = await new Promise(resolve => { const request = indexedDB.open('inhouse-read'); request.onsuccess = () => resolve(request.result) })
    const books = await new Promise(resolve => { const request = db.transaction('books').objectStore('books').getAll(); request.onsuccess = () => resolve(request.result) })
    const book = books.find(book => book.name === 'Android_Open_With.pdf')
    return book ? { name:book.name, bytes:[...new Uint8Array(await book.content.arrayBuffer())] } : null
  })
  expect(saved?.bytes).toEqual(pdf)
  await page.getByRole('button', { name:'Volver a la estantería' }).click()
  await expect(page.locator('body')).toHaveClass(/is-closing-reader/)
  await expect(page.locator('body')).not.toHaveClass(/is-closing-reader/, {timeout:returnTimeout})
  await expect(page.getByRole('button', { name:/Abrir Android Open With/i })).toBeVisible()
})

test('Android: un acceso a Google pendiente no bloquea el siguiente Abrir con', async ({ page }) => {
  await installInbox(page, true)
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'userAgent', {value:`${navigator.userAgent} InhouseReadApp/1.1.1`,configurable:true})
    window.testAuthOpened = false
    window.InhouseNative = { getAppVersion:() => '1.1.1', openAuthUrl:() => { window.testAuthOpened = true } }
  })
  await page.route('**/android-update.json?**', route => route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({version:'1.1.1',required:false})}))
  await page.route('https://api.github.com/repos/miguelcoxcaballero/inhouse-read/releases/latest', route => route.fulfill({status:404,body:'No update'}))
  await page.goto(process.env.IHR_TEST_URL || '/')
  await page.waitForFunction(() => window.testAuthOpened && window.testImportAcks.length === 1)
  await page.evaluate(() => window.testDeliverBook('Second_Android_Book.pdf'))
  await expect(page.locator('#reader-top-title')).toHaveText('Second Android Book')
  await page.waitForFunction(() => window.testImportAcks.length === 2)
})

test('Android: abre el PDF con un WebView sin las APIs recientes de Promise y Math', async ({ page }) => {
  await installInbox(page, true)
  await page.addInitScript(() => { Promise.try = undefined; Math.sumPrecise = undefined })
  await page.route('**/pdf.worker*.mjs', async route => {
    const response = await route.fetch()
    await route.fulfill({ response, body:'Promise.try = undefined; Math.sumPrecise = undefined;\n' + await response.text() })
  })
  await page.goto(process.env.IHR_TEST_URL || '/')
  await expect(page.locator('#reader-format-badge')).toHaveText('PDF')
  await expect(page.locator('#reader-top-title')).toHaveText('Android Open With')
  await expect(page.locator('.pdf-page-canvas')).toBeVisible()
  await page.waitForFunction(() => window.testImportAcks.length === 1)
})
