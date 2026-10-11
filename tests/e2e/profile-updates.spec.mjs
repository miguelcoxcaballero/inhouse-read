import './helpers/empty-update-channels.mjs'
import { test, expect } from '@playwright/test'
import { createHash } from 'node:crypto'

test.use({ viewport:{width:390,height:844}, isMobile:true, hasTouch:true })

test('updates expand inside the account menu and leave the mobile shelf usable', async ({ page }, testInfo) => {
  const scripts=[]
  page.on('response', response=>{
    if (/\/assets\/main-[^/]+\.js(?:\?|$)/.test(response.url())) scripts.push(response.body().then(body=>({url:response.url(),sha256:createHash('sha256').update(body).digest('hex')})))
  })
  await page.goto(process.env.IHR_TEST_URL || './?inhouse_app=1')
  const profile=page.locator('#drive-profile-btn'),menu=page.locator('#drive-profile-menu')
  const entry=page.getByRole('button',{name:'Actualizaciones',exact:true})
  await expect(page.locator('.header-actions > [data-inhouse-update-settings]')).toHaveCount(0)
  await expect(menu).toBeHidden()
  await profile.click()
  await expect(entry).toBeVisible()
  await entry.click()
  const panel=page.locator('#drive-update-settings')
  await expect(panel.locator('.isu-inline')).toBeVisible()
  await expect(page.locator('.isu-overlay,[aria-modal=true]')).toHaveCount(0)
  await expect(entry).toHaveAttribute('aria-expanded','true')
  await page.getByRole('button',{name:'Check for updates',exact:true}).click()
  await expect(panel).toContainText('No releases on version B.')
  const bounds=await menu.boundingBox()
  expect(bounds.x).toBeGreaterThanOrEqual(0)
  expect(bounds.x+bounds.width).toBeLessThanOrEqual(390)
  expect(bounds.y+bounds.height).toBeLessThanOrEqual(844)
  await page.screenshot({path:'test-results/profile-updates-mobile.png'})
  // Outside tap closes just the disclosure, with no leftover overlay.
  await page.locator('.app-header .logo').click()
  await expect(menu).toBeHidden()
  await expect(page.locator('#inhouse-services-update')).toHaveCount(0)
  await profile.click();await entry.click()
  await page.keyboard.press('Escape')
  await expect(panel).toBeHidden()
  await expect(menu).toBeVisible()
  await expect(entry).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(menu).toBeHidden()
  await expect(profile).toBeFocused()
  const delivered=await Promise.all(scripts)
  expect(delivered.length).toBeGreaterThan(0)
  if (process.env.IHR_EXPECTED_MAIN_SHA256) expect(delivered.every(s=>s.sha256===process.env.IHR_EXPECTED_MAIN_SHA256)).toBe(true)
  await testInfo.attach('main-responses.json',{contentType:'application/json',body:JSON.stringify(delivered)})
})
