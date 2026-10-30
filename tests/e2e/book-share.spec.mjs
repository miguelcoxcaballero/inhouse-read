import {installEmptyUpdateChannels} from './helpers/empty-update-channels.mjs'
installEmptyUpdateChannels()
import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'

// "Compartir" end to end in the built app: the lifted book's file reaches the Android shell's share
// bridge byte for byte (as the APK's InhouseBookShare receives it), or the Web Share API in a browser.
const PDF_FIXTURE = 'tests/e2e/fixtures/tiny.pdf'

async function liftImportedBook(page) {
  await page.locator('#file-picker').setInputFiles(PDF_FIXTURE)
  await expect(page.locator('.pdf-page-canvas')).toBeVisible()
  await page.getByRole('button', { name:'Volver a la estantería' }).click()
  await expect(page.locator('body')).not.toHaveClass(/is-closing-reader/, { timeout:30_000 })
  const spine = page.locator('.ihr-spine').first()
  await expect(spine).toBeVisible(); await spine.focus(); await page.keyboard.press('Enter')
  return page.getByRole('button', { name:'Compartir el libro', exact:true })
}

test('the Android app receives the book file for its share sheet', async ({ page }) => {
  test.setTimeout(120_000)
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'userAgent', { value:`${navigator.userAgent} InhouseReadApp/1.1.25`, configurable:true })
    window.__shared = { calls:[], chunks:[] }
    window.InhouseBookShare = {
      begin:(name, type, title) => { window.__shared.calls.push(['begin', name, type, title]); return 'session-1' },
      append:(id, base64) => { if (id !== 'session-1') return false; window.__shared.chunks.push(base64); return true },
      finish:id => { window.__shared.calls.push(['finish', id]); return id === 'session-1' }
    }
  })
  await page.goto(process.env.IHR_TEST_URL || '/')
  const share = await liftImportedBook(page)
  await share.click()
  await expect.poll(() => page.evaluate(() => window.__shared.calls.at(-1)?.[0]), { timeout:30_000 }).toBe('finish')
  const shared = await page.evaluate(() => window.__shared)
  expect(shared.calls[0]).toEqual(['begin', 'tiny.pdf', 'application/pdf', expect.any(String)])
  expect(Buffer.from(shared.chunks.join(''), 'base64').equals(readFileSync(PDF_FIXTURE))).toBe(true)
  await expect(share).toBeEnabled()
})

test('a browser shares the book file with the Web Share API', async ({ page }) => {
  test.setTimeout(120_000)
  await page.addInitScript(() => {
    window.__webShared = []
    Object.defineProperty(navigator, 'canShare', { value:data => Boolean(data?.files?.length), configurable:true })
    Object.defineProperty(navigator, 'share', { configurable:true, value:async data => {
      const file = data.files[0]
      window.__webShared.push({ title:data.title, name:file.name, type:file.type, size:file.size })
    } })
  })
  await page.goto(process.env.IHR_TEST_URL || '/')
  const share = await liftImportedBook(page)
  await share.click()
  await expect.poll(() => page.evaluate(() => window.__webShared.length), { timeout:30_000 }).toBe(1)
  const [sent] = await page.evaluate(() => window.__webShared)
  expect(sent).toMatchObject({ name:'tiny.pdf', type:'application/pdf', size:readFileSync(PDF_FIXTURE).length })
})
