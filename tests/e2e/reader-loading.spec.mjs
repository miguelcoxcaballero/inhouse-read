import { test, expect } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import { openAudioMenu } from './helpers/audio-menus.mjs'

// Network gating applies to the actual reader chunk, rather than the service
// worker's independent offline prefetch. Offline behavior has its own suite.
test.use({ serviceWorkers:'block' })

test('keeps audiobook and reader tools unavailable while the real ebook engine loads', async ({ page }) => {
  await page.setViewportSize({ width:390, height:844 })
  await page.emulateMedia({ reducedMotion:'reduce' })
  let releaseEngine, requested
  const requestSeen = new Promise(resolve => { requested = resolve })
  const engineGate = new Promise(resolve => { releaseEngine = resolve })
  await page.route('**/assets/foliate-reader-*.js', async route => {
    requested(); await engineGate; await route.continue()
  })
  await page.goto('./')
  try {
    await page.locator('#file-picker').setInputFiles(fileURLToPath(new URL('./fixtures/reading-journey.epub', import.meta.url)))
    await requestSeen
    // Loading is drawn, not written: bars where the page will be, a bar where the title will be. The sentences
    // stay for assistive technology (a status that still reads "Abriendo el libro…"), unpainted.
    const loading = page.locator('#reader-loading')
    await expect(loading).toBeVisible()
    await expect(loading).toHaveRole('status')
    await expect(loading).toHaveText('Abriendo el libro…')
    await expect(loading.locator('.visually-hidden')).toHaveText('Abriendo el libro…')
    await expect(loading.locator('.ihr-skeleton').first()).toBeVisible()
    expect(await loading.locator('.ihr-skeleton').evaluateAll(bars => bars.every(bar => bar.getAttribute('aria-hidden') === 'true' && bar.getBoundingClientRect().height >= 10 && getComputedStyle(bar).backgroundColor !== 'rgba(0, 0, 0, 0)'))).toBe(true)
    const title = page.locator('#reader-top-title')
    await expect(title).toHaveAttribute('aria-busy', 'true')
    await expect(title).toHaveText('Abriendo libro…')
    expect(await title.evaluate(node => { const style = getComputedStyle(node); return { ink: style.webkitTextFillColor, block: style.backgroundColor !== 'rgba(0, 0, 0, 0)', motion: style.animationName } }))
      .toEqual({ ink: 'rgba(0, 0, 0, 0)', block: true, motion: 'none' }) // reduced motion (emulated above): a still block
    await expect(page.locator('#reader-screen')).toHaveAttribute('aria-busy','true')
    await expect(page.locator('#reader-toolbar')).toBeHidden()
    expect(await page.locator('.reader-heading-actions').evaluate(element => element.inert)).toBe(true)
  } finally { releaseEngine() }
  await expect(page.locator('#reader-toolbar')).toBeVisible({ timeout:30_000 })
  await expect(page.locator('#reader-loading')).toBeHidden()
  await expect(page.locator('#reader-top-title')).not.toHaveAttribute('aria-busy', 'true')
  await expect(page.locator('#reader-top-title')).toHaveText('The Reading Room')
  expect(await page.locator('#reader-top-title').evaluate(node => getComputedStyle(node).webkitTextFillColor)).not.toBe('rgba(0, 0, 0, 0)')
  await expect(page.locator('#reader-screen')).toHaveAttribute('aria-busy','false')
  expect(await page.locator('.reader-heading-actions').evaluate(element => element.inert)).toBe(false)
  expect(await page.evaluate(() => document.querySelector('foliate-view')?.lastLocation?.range?.toString()?.trim().length || 0)).toBeGreaterThan(0)
  await page.getByRole('button',{ name:'Escuchar el libro' }).click()
  await expect(page.getByRole('button',{ name:'Reproducir', exact:true })).toBeVisible()
  await expect(page.locator('.reading-audio-status')).not.toContainText('sin texto legible')
})

test('the ten-profile voice catalog keeps its close trigger reachable on a phone', async ({ page }) => {
  await page.setViewportSize({ width:390, height:844 })
  await page.emulateMedia({ reducedMotion:'reduce' })
  await page.goto('./')
  await page.locator('#file-picker').setInputFiles(fileURLToPath(new URL('./fixtures/reading-journey.epub',import.meta.url)))
  await expect(page.locator('#reader-toolbar')).toBeVisible({ timeout:30_000 })
  await page.getByRole('button',{ name:'Escuchar el libro' }).click()
  await openAudioMenu(page,'Voz')
  const catalog=page.locator('.select-menu--catalog'), trigger=catalog.locator('.select-menu__trigger')
  const last=catalog.locator('[data-neural-voice="supertonic3:M5:en"]')
  await last.scrollIntoViewIfNeeded()
  await expect(last).toBeVisible()
  expect(await trigger.evaluate(element=>{
    const r=element.getBoundingClientRect(), dialog=element.closest('dialog').getBoundingClientRect()
    return r.width>0&&r.height>0&&r.top>=dialog.top&&r.bottom<=dialog.bottom&&element.contains(document.elementFromPoint(r.left+r.width/2,r.top+r.height/2))
  })).toBe(true)
  await page.screenshot({ path:process.env.IHR_CATALOG_VIEWPORT_SHOT || 'test-results/voice-catalog-close-visible.png' })
  await trigger.click()
  await expect(catalog.locator('.select-menu__panel')).toBeHidden()
  await expect(page.getByRole('button',{ name:'Reproducir', exact:true })).toBeVisible()
})
