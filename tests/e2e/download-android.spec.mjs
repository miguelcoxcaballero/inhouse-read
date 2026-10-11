import { test, expect } from '@playwright/test'

const API_URL = 'https://raw.githubusercontent.com/miguelcoxcaballero/inhouse-read/main/updates/A.json?**'
const APK_URL = 'https://github.com/miguelcoxcaballero/inhouse-read/releases/download/android-v9.9.9/inhouse-read-release-v9.9.9.apk'
const release = { version: '9.9.9', versionCode: 999, releasedAt: '2026-01-15T10:00:00Z', apkUrl: APK_URL, apkSha256: 'a'.repeat(64), apkSizeBytes: 3500000, changelog: 'Descarga mejorada.' }
const FAKE_RELEASE = { schemaVersion: 1, channel: 'A', latest: release, releases: [release] }

test.beforeEach(async ({ page }) => {
  await page.route(API_URL, route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(FAKE_RELEASE) })
  )
  // Sin barra inicial: con barra, Playwright resuelve contra el origen y
  // pierde el path base (/inhouse-read/) configurado en playwright.config.mjs.
  await page.goto('download-android.html')
})

test('muestra la versión y el tamaño del canal A consultado en vivo', async ({ page }) => {
  await expect(page.locator('.dl-version-tag')).toHaveText('android-v9.9.9 · A')
  const button = page.locator('.dl-button')
  await expect(button).toContainText('3.3 MB')
  await expect(button).toHaveAttribute('href', APK_URL)
})

test('si la API de GitHub falla, muestra un enlace de respaldo a Releases', async ({ page }) => {
  await page.route(API_URL, route =>
    route.fulfill({ status: 500, body: 'error' })
  )
  await page.reload()
  await expect(page.locator('.dl-status--error')).toBeVisible()
  await expect(page.getByRole('link', { name: /releases en GitHub/i })).toHaveAttribute(
    'href', 'https://github.com/miguelcoxcaballero/inhouse-read/releases'
  )
})

test('el enlace de cabecera vuelve a la app web', async ({ page }) => {
  await expect(page.getByRole('link', { name: 'Abrir la app web' })).toHaveAttribute('href', '/inhouse-read/')
})
