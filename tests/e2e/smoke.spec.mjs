import { test, expect } from '@playwright/test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PDF_FIXTURE = path.join(__dirname, 'fixtures', 'tiny.pdf')

test.beforeEach(async ({ page }) => {
  await page.goto('/')
})

test('carga el home con la marca y las acciones de cabecera', async ({ page }) => {
  await expect(page.locator('.logo')).toContainText('inhouse read')
  await expect(page.getByRole('button', { name: 'Elegir archivo del dispositivo' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Abrir desde Google Drive' })).toBeVisible()
})

test('muestra el estado vacío cuando no hay libros recientes', async ({ page }) => {
  await expect(page.getByText('Tu estantería está vacía')).toBeVisible()
})

test('el botón de tema alterna data-theme en <html>', async ({ page }) => {
  const html = page.locator('html')
  const initial = await html.getAttribute('data-theme')
  await page.getByRole('button', { name: 'Cambiar tema' }).click()
  await expect(html).not.toHaveAttribute('data-theme', initial ?? '')
})

test('abre un PDF local y navega al visor de lectura', async ({ page }) => {
  await page.locator('#file-picker').setInputFiles(PDF_FIXTURE)

  const readerScreen = page.locator('#reader-screen')
  await expect(readerScreen).toBeVisible()
  await expect(page.locator('#reader-format-badge')).toHaveText('PDF')

  // PDF.js debe haber renderizado un <canvas> con contenido real.
  const canvas = page.locator('.pdf-page-canvas')
  await expect(canvas).toBeVisible()
  const canvasSize = await canvas.evaluate(el => ({ w: el.width, h: el.height }))
  expect(canvasSize.w).toBeGreaterThan(0)
  expect(canvasSize.h).toBeGreaterThan(0)
})

test('el libro abierto reaparece en la estantería al volver', async ({ page }) => {
  await page.locator('#file-picker').setInputFiles(PDF_FIXTURE)
  await expect(page.locator('#reader-screen')).toBeVisible()

  await page.getByRole('button', { name: 'Volver a la estantería' }).click()

  await expect(page.locator('#home-screen')).toBeVisible()
  await expect(page.getByRole('button', { name: /Abrir tiny/i })).toBeVisible()
})
