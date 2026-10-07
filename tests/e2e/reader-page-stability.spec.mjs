import { test, expect } from '@playwright/test'

// Closing and reopening an EPUB shows the same pages: the page box does not
// depend on what the free height happened to be while the book was opening
// (Android shows its status bar on the shelf and hides it while reading).

test.use({viewport:{width:390,height:844},hasTouch:true,isMobile:true,deviceScaleFactor:2})

const page_ = page => page.evaluate(() => {
  const view = document.querySelector('foliate-view')
  return { height:view.style.height, cfi:view.lastLocation?.cfi, text:view.lastLocation?.range?.toString() }
})

async function reopen(page) {
  await page.getByRole('button', { name:'Volver a la estantería' }).click()
  await expect(page.locator('body')).toHaveClass(/is-closing-reader/)
  await expect(page.locator('body')).not.toHaveClass(/is-closing-reader/,{timeout:30_000})
  await page.locator('.ihr-spine').first().click()
  await page.getByRole('button', { name:/Toca para leer/ }).click()
  await expect(page.locator('.ihr-flyout')).toHaveCount(0,{timeout:20_000})
  await expect.poll(() => page.evaluate(() => Boolean(document.querySelector('foliate-view')?.lastLocation?.range))).toBe(true)
  await page.waitForTimeout(800)
}

test('un EPUB cerrado y reabierto conserva sus páginas aunque cambie la barra de estado', async ({page}) => {
  test.setTimeout(150_000)
  await page.emulateMedia({reducedMotion:'reduce'})
  await page.goto('./')
  await page.locator('#file-picker').setInputFiles('tests/e2e/fixtures/reading-journey.epub')
  await expect(page.locator('foliate-view')).toBeVisible()
  await expect.poll(() => page.evaluate(() => Boolean(document.querySelector('foliate-view')?.lastLocation?.range))).toBe(true)
  for (let i = 0; i < 4; i++) { await page.evaluate(() => document.querySelector('foliate-view').next()); await page.waitForTimeout(300) }
  await page.waitForTimeout(800)
  const first = await page_(page)
  expect(first.text.length).toBeGreaterThan(40)

  // The status bar goes away while reading: 30 px more.
  await page.setViewportSize({width:390,height:874})
  await page.waitForTimeout(500)
  expect(await page_(page)).toEqual(first)
  await reopen(page)
  expect(await page_(page)).toEqual(first)

  // Back with the status bar shown, then hidden, across two more openings.
  await page.setViewportSize({width:390,height:844})
  await reopen(page)
  expect(await page_(page)).toEqual(first)
  await page.setViewportSize({width:390,height:874})
  await reopen(page)
  expect(await page_(page)).toEqual(first)
})
