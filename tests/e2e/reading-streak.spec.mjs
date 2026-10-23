import { test, expect } from '@playwright/test'

// Siembra una racha de 3 días que termina ayer y deja hoy a 8 s del objetivo.
const seed = () => {
  if (sessionStorage.getItem('streak-seeded')) return
  sessionStorage.setItem('streak-seeded', '1')
  const pad = v => String(v).padStart(2, '0')
  const key = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  const days = {}, now = new Date()
  for (let i = 1; i <= 3; i++) { const d = new Date(now); d.setDate(d.getDate() - i); days[key(d)] = 300 }
  days[key(now)] = 292
  localStorage.setItem('inhouse-read-streak-device', JSON.stringify({ v: 1, days, best: 3, celebrated: '' }))
  window.__widget = []
  window.InhouseStreak = { update: json => window.__widget.push(JSON.parse(json)), canPin: () => true, isPlaced: () => false, requestPin: () => { window.__pinRequested = true } }
  window.__vibrations = []
  navigator.vibrate = pattern => { window.__vibrations.push(pattern); return true }
}

test('la racha se amplía tras 5 minutos de lectura y muestra la celebración', async ({ page }) => {
  test.setTimeout(60_000)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.addInitScript(seed)
  const errors = []; page.on('pageerror', e => errors.push(e.message))
  await page.goto('./')
  const homeChip = page.locator('.header-actions [data-streak-chip]')
  await expect(homeChip).toHaveAttribute('data-state', 'idle')
  await expect(homeChip).toHaveAttribute('aria-label', 'Racha de 3 días. Te falta 1 minuto de lectura hoy.')

  await homeChip.click()
  const panel = page.getByRole('dialog', { name: /3 días de racha/ })
  await expect(panel).toBeVisible()
  await expect(panel.locator('.streak-day.is-done').first()).toBeVisible()
  await expect(panel.locator('.streak-day.is-today')).toHaveCount(1)
  // Android ofrece anclar el widget desde el panel.
  await panel.getByRole('button', { name: /Añade la racha a tu pantalla de inicio/ }).click()
  expect(await page.evaluate(() => window.__pinRequested)).toBe(true)
  await expect(panel).toContainText('Confírmalo en el aviso de Android')
  await page.keyboard.press('Escape')
  await expect(panel).toBeHidden()
  await expect(homeChip).toBeFocused()

  await page.locator('#file-picker').setInputFiles('tests/e2e/fixtures/lectura-es.epub')
  await expect(page.locator('#reader-top-title')).not.toBeEmpty()
  const celebration = page.getByRole('dialog', { name: /Racha ampliada.*4 días de racha/ })
  await expect(celebration).toBeVisible({ timeout: 20_000 })
  await expect(celebration.locator('.streak-roll-new')).toHaveText('4')
  await expect(celebration.locator('.streak-week-day.is-today')).toHaveCount(1)
  const next = celebration.getByRole('button', { name: 'Continuar' })
  await expect(next).toBeFocused()
  // Vibraciones al encenderse la llama, al contar y al marcar el día.
  await expect.poll(() => page.evaluate(() => window.__vibrations.length)).toBeGreaterThanOrEqual(3)
  await next.click()
  await expect(celebration).toBeHidden()

  const readerChip = page.locator('.reader-heading [data-streak-chip]')
  await expect(readerChip).toHaveAttribute('data-state', 'lit')
  await expect(readerChip).toHaveText('4')
  // Solo los días cumplidos se sincronizan; el progreso de hoy queda en el dispositivo.
  const stored = await page.evaluate(() => ({
    synced: JSON.parse(localStorage.getItem('inhouse-read-streak')),
    device: JSON.parse(localStorage.getItem('inhouse-read-streak-device'))
  }))
  expect(Object.values(stored.synced.days).every(seconds => seconds === 300)).toBe(true)
  expect(Object.keys(stored.synced.days)).toHaveLength(4)
  expect(stored.synced.celebrated).toBe(stored.device.celebrated)
  // El widget recibe los cuatro días cumplidos, hoy incluido.
  const widget = await page.evaluate(() => window.__widget.at(-1))
  expect(widget.days).toHaveLength(4)
  expect(widget.days).toContain(widget.day)
  expect(widget.seconds).toBe(300)

  // Al volver a abrir la app el mismo día no se repite la celebración.
  await page.reload()
  await expect(page.locator('.header-actions [data-streak-chip]')).toHaveAttribute('data-state', 'lit')
  await page.locator('#file-picker').setInputFiles('tests/e2e/fixtures/lectura-es.epub')
  await expect(page.locator('#reader-top-title')).not.toBeEmpty()
  await page.waitForTimeout(2500)
  await expect(page.locator('.streak-celebration')).toHaveCount(0)
  expect(errors).toEqual([])
})
