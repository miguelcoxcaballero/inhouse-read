import { mkdirSync } from 'node:fs'
import { test, expect } from '@playwright/test'

// Editor de la portada con el libro 3D real (WebGL por software). Los tests no
// dependen de qué propuestas encuentre el motor de relieve: sólo de que sean
// tres, seleccionables y persistentes.

const evidence = process.env.COVER_EDITOR_EVIDENCE || ''
if (evidence) mkdirSync(evidence, { recursive: true })

async function openShelfEditor(page, { reduced = false, theme = '' } = {}) {
  await page.emulateMedia({ reducedMotion: reduced ? 'reduce' : 'no-preference' })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('./')
  if (theme) await page.evaluate(value => { localStorage.setItem('inhouse-read-theme', value); document.documentElement.setAttribute('data-theme', value) }, theme)
  await page.locator('#file-picker').setInputFiles('tests/e2e/fixtures/reading-journey.pdf')
  await expect(page.locator('.pdf-page-canvas')).toBeVisible()
  await expect(page.locator('#reader-location')).toHaveAttribute('aria-label', /Página 1/)
  await page.getByRole('button', { name: 'Volver a la estantería' }).click()
  await page.locator('.ihr-spine').first().click()
  await page.getByRole('button', { name: 'Editar', exact: true }).click()
  return errors
}

const canvasAngle = page => page.locator('.ihr-flyout__book canvas').evaluate(canvas => Number(canvas.dataset.angle))
const sheet = page => page.locator('.ihr-spine-editor')
const cards = page => page.getByRole('radiogroup', { name: 'Propuestas de relieve' }).getByRole('radio')

async function enterCover(page) {
  await page.getByRole('tab', { name: 'Portada' }).click()
  await expect.poll(() => canvasAngle(page), { timeout: 15_000 }).toBe(0)
  // Tres propuestas más 'Sin relieve'.
  await expect(cards(page)).toHaveCount(4, { timeout: 60_000 })
}

test('pestañas Lomo y Portada: teclado, giro del libro y título', async ({ page }) => {
  test.setTimeout(240_000)
  await page.setViewportSize({ width: 390, height: 844 })
  const errors = await openShelfEditor(page)
  await expect(page.getByRole('heading', { name: 'Editar el lomo' })).toBeVisible()
  await expect(page.getByRole('tablist')).toBeVisible()
  const lomo = page.getByRole('tab', { name: 'Lomo' }), portada = page.getByRole('tab', { name: 'Portada' })
  await expect(lomo).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByLabel('Brillo de la portada')).toBeVisible()
  await expect.poll(() => canvasAngle(page)).toBe(90)

  await lomo.focus()
  await page.keyboard.press('ArrowRight')
  await expect(portada).toBeFocused()
  await expect(portada).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('heading', { name: 'Editar la portada' })).toBeVisible()
  await expect(page.getByLabel('Brillo de la portada')).toBeHidden()
  await expect.poll(() => canvasAngle(page), { timeout: 15_000 }).toBe(0)
  // La portada gira completa y queda sobre la hoja, sin tapar ni salirse.
  const bounds = await page.locator('.ihr-flyout__book canvas').evaluate(canvas => JSON.parse(canvas.dataset.boardBounds))
  const top = await sheet(page).evaluate(node => node.getBoundingClientRect().top)
  expect(bounds.top + bounds.height).toBeLessThanOrEqual(top + 2)
  expect(bounds.left).toBeGreaterThanOrEqual(0)
  expect(bounds.left + bounds.width).toBeLessThanOrEqual(390)

  await page.keyboard.press('Home')
  await expect(lomo).toBeFocused()
  await expect.poll(() => canvasAngle(page), { timeout: 15_000 }).toBe(90)
  await page.keyboard.press('End')
  await expect(portada).toHaveAttribute('aria-selected', 'true')
  // Escape sigue cerrando la hoja desde la pestaña Portada.
  await page.keyboard.press('Escape')
  await expect(sheet(page)).toBeHidden()
  await expect.poll(() => canvasAngle(page), { timeout: 15_000 }).toBe(0)
  expect(errors).toEqual([])
})

test('cambiar de pestaña a toda prisa no deja el libro a medias', async ({ page }) => {
  test.setTimeout(240_000)
  await page.setViewportSize({ width: 390, height: 844 })
  const errors = await openShelfEditor(page)
  const lomo = page.getByRole('tab', { name: 'Lomo' }), portada = page.getByRole('tab', { name: 'Portada' })
  for (let i = 0; i < 3; i++) { await portada.click(); await lomo.click() }
  await portada.click()
  await expect.poll(() => canvasAngle(page), { timeout: 15_000 }).toBe(0)
  await lomo.click()
  await expect.poll(() => canvasAngle(page), { timeout: 15_000 }).toBe(90)
  expect(errors).toEqual([])
})

test('relieve: tres propuestas, selección con balanceo, persistencia y Sin relieve', async ({ page }) => {
  test.setTimeout(260_000)
  await page.setViewportSize({ width: 390, height: 844 })
  const errors = await openShelfEditor(page)
  await enterCover(page)
  if (evidence) await page.screenshot({ path: `${evidence}/mobile-light-propuestas.png` })
  const group = page.getByRole('radiogroup', { name: 'Propuestas de relieve' })
  await expect(group.locator('.ihr-relief-card')).toHaveCount(3)
  await expect(group.locator('.ihr-relief-card img')).toHaveCount(3)
  const labels = await group.locator('.ihr-relief-card__label').allTextContents()
  expect(new Set(labels).size).toBe(3)
  await expect(cards(page).last()).toBeChecked()
  await expect(page.getByLabel('Intensidad del relieve')).toBeDisabled()

  // Elegir una tarjeta: el libro se balancea (guiñada +-12) y vuelve a la portada.
  await group.locator('.ihr-relief-card').nth(1).click()
  await expect(group.locator('.ihr-relief-card').nth(1)).toHaveClass(/is-selected/)
  await expect(page.getByLabel('Intensidad del relieve')).toBeEnabled()
  const samples = []
  const started = Date.now()
  while (Date.now() - started < 4200) {
    samples.push(await canvasAngle(page))
    if (evidence && samples.length === 6) await page.screenshot({ path: `${evidence}/mobile-light-balanceo.png` })
    await page.waitForTimeout(40)
  }
  expect(Math.max(...samples)).toBeGreaterThan(6)
  expect(Math.min(...samples)).toBeLessThan(-6)
  expect(Math.max(...samples.map(Math.abs))).toBeLessThanOrEqual(13)
  await expect.poll(() => canvasAngle(page), { timeout: 8000 }).toBe(0)

  // Se guarda con el libro: tras recargar sigue marcada.
  await page.getByRole('button', { name: 'Listo', exact: true }).click()
  await page.getByRole('button', { name: 'Cerrar', exact: true }).click()
  await page.reload()
  await page.locator('.ihr-spine').first().click()
  await page.getByRole('button', { name: 'Editar', exact: true }).click()
  await page.getByRole('tab', { name: 'Portada' }).click()
  await expect(cards(page)).toHaveCount(4, { timeout: 60_000 })
  await expect(cards(page).nth(1)).toBeChecked()
  await expect(page.getByLabel('Intensidad del relieve')).toBeEnabled()
  // Al restaurar no se balancea sola.
  await page.waitForTimeout(600)
  await expect.poll(() => canvasAngle(page)).toBe(0)

  // Intensidad y Sin relieve.
  await page.getByLabel('Intensidad del relieve').fill('30')
  await page.getByText('Sin relieve', { exact: true }).click()
  await expect(cards(page).last()).toBeChecked()
  await expect(page.getByLabel('Intensidad del relieve')).toBeDisabled()
  await page.getByRole('button', { name: 'Listo', exact: true }).click()
  await page.getByRole('button', { name: 'Cerrar', exact: true }).click()
  await page.reload()
  await page.locator('.ihr-spine').first().click()
  await page.getByRole('button', { name: 'Editar', exact: true }).click()
  await page.getByRole('tab', { name: 'Portada' }).click()
  await expect(cards(page)).toHaveCount(4, { timeout: 60_000 })
  await expect(cards(page).last()).toBeChecked()
  expect(errors).toEqual([])
})

test('un gesto del usuario corta el balanceo', async ({ page }) => {
  test.setTimeout(240_000)
  await page.setViewportSize({ width: 390, height: 844 })
  const errors = await openShelfEditor(page)
  await enterCover(page)
  await page.getByRole('radiogroup', { name: 'Propuestas de relieve' }).locator('.ihr-relief-card').first().click()
  // Esperar a que el balanceo esté en marcha (la guiñada se aparta de 0).
  await expect.poll(async () => Math.abs(await canvasAngle(page)), { timeout: 8000 }).toBeGreaterThan(3)
  await page.waitForTimeout(500)
  await page.locator('.ihr-spine-editor__heading').click()
  // Vuelve a la portada en menos de un segundo, sin esperar a los 2,4 s.
  await expect.poll(() => canvasAngle(page), { timeout: 900 }).toBe(0)
  await page.waitForTimeout(500)
  expect(await canvasAngle(page)).toBe(0)
  expect(errors).toEqual([])
})

test('con movimiento reducido el libro gira sin animar y no se balancea', async ({ page }) => {
  test.setTimeout(240_000)
  await page.setViewportSize({ width: 390, height: 844 })
  const errors = await openShelfEditor(page, { reduced: true })
  await enterCover(page)
  await page.getByRole('radiogroup', { name: 'Propuestas de relieve' }).locator('.ihr-relief-card').first().click()
  const samples = []
  for (let i = 0; i < 30; i++) { samples.push(await canvasAngle(page)); await page.waitForTimeout(60) }
  expect(new Set(samples)).toEqual(new Set([0]))
  expect(errors).toEqual([])
})

test('cerrar el editor mientras busca relieve no deja nada colgado', async ({ page }) => {
  test.setTimeout(240_000)
  await page.setViewportSize({ width: 390, height: 844 })
  const errors = await openShelfEditor(page)
  await page.getByRole('tab', { name: 'Portada' }).click()
  await page.getByRole('button', { name: 'Listo', exact: true }).click()
  await expect(sheet(page)).toBeHidden()
  await page.getByRole('button', { name: 'Editar', exact: true }).click()
  await expect(page.getByRole('tab', { name: 'Lomo' })).toHaveAttribute('aria-selected', 'true')
  await page.getByRole('tab', { name: 'Portada' }).click()
  await expect(cards(page)).toHaveCount(4, { timeout: 60_000 })
  expect(errors).toEqual([])
})

for (const [name, viewport] of [['movil', { width: 390, height: 844 }], ['escritorio', { width: 1280, height: 800 }]]) {
  for (const theme of ['light', 'dark']) {
    test(`diseño de la pestaña Portada: ${name}, tema ${theme}`, async ({ page }) => {
      test.setTimeout(240_000)
      await page.setViewportSize(viewport)
      const errors = await openShelfEditor(page, { theme })
      await enterCover(page)
      const group = page.getByRole('radiogroup', { name: 'Propuestas de relieve' })
      await group.locator('.ihr-relief-card').first().click()
      await page.waitForTimeout(250)
      if (evidence) await page.screenshot({ path: `${evidence}/${name}-${theme}-portada.png` })
      // Sin desbordes horizontales y todo dentro de la hoja.
      const overflow = await sheet(page).evaluate(node => node.scrollWidth - node.clientWidth)
      expect(overflow).toBeLessThanOrEqual(1)
      const sheetBox = await sheet(page).boundingBox()
      expect(sheetBox.x + sheetBox.width).toBeLessThanOrEqual(viewport.width + 1)
      for (const card of await group.locator('.ihr-relief-card').all()) {
        const box = await card.boundingBox()
        expect(box.x).toBeGreaterThanOrEqual(sheetBox.x - 1)
        expect(box.x + box.width).toBeLessThanOrEqual(sheetBox.x + sheetBox.width + 1)
      }
      await page.getByRole('tab', { name: 'Lomo' }).click()
      await expect.poll(() => canvasAngle(page), { timeout: 15_000 }).toBe(90)
      await page.waitForTimeout(250)
      if (evidence) await page.screenshot({ path: `${evidence}/${name}-${theme}-lomo.png` })
      expect(errors).toEqual([])
    })
  }
}
