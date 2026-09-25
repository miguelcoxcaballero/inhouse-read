import { test, expect } from '@playwright/test'

const FAKE_RELEASE = {
  tag_name: 'android-v9.9.9',
  published_at: '2026-01-15T10:00:00Z',
  assets: [
    { name: 'inhouse-read-release-v9.9.9.apk', size: 3_500_000, browser_download_url: 'https://github.com/example/download.apk' }
  ]
}

test.beforeEach(async ({ page }) => {
  await page.route('https://api.github.com/repos/miguelcoxcaballero/inhouse-read/releases/latest', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(FAKE_RELEASE) })
  )
  // Sin barra inicial: con barra, Playwright resuelve contra el origen y
  // pierde el path base (/inhouse-read/) configurado en playwright.config.mjs.
  await page.goto('download-android.html')
})

test('muestra la versión y el tamaño del último release consultado en vivo', async ({ page }) => {
  await expect(page.locator('.dl-version-tag')).toHaveText('android-v9.9.9')
  const button = page.locator('.dl-button')
  await expect(button).toContainText('3.3 MB')
  await expect(button).toHaveAttribute('href', 'https://github.com/example/download.apk')
})

test('si la API de GitHub falla, muestra un enlace de respaldo a Releases', async ({ page }) => {
  await page.route('https://api.github.com/repos/miguelcoxcaballero/inhouse-read/releases/latest', route =>
    route.fulfill({ status: 500, body: 'error' })
  )
  await page.reload()
  await expect(page.locator('.dl-status--error')).toBeVisible()
  await expect(page.getByRole('link', { name: /releases directamente en GitHub/i })).toHaveAttribute(
    'href', 'https://github.com/miguelcoxcaballero/inhouse-read/releases'
  )
})

test('el enlace de cabecera vuelve a la app web', async ({ page }) => {
  await expect(page.getByRole('link', { name: 'Abrir la app web' })).toHaveAttribute('href', '/inhouse-read/')
})
