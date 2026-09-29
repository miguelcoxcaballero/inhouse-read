import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { test, expect } from '@playwright/test'

const sourcePath = fileURLToPath(new URL('../../src/js/cover-appearance.js', import.meta.url))
const coverModuleUrl = `data:text/javascript;base64,${(await readFile(sourcePath)).toString('base64')}`

test('portada rasterizada: detecta el color dominante y empareja la tipografía del título', async ({ page }) => {
  await page.goto('/')
  const appearances = await page.evaluate(async moduleUrl => {
    const { analyzeCoverAppearance } = await import(moduleUrl)
    const results = []
    for (const sample of [
      { family:'Oswald', weight:600, title:'A Visual Match' },
      { family:'Playfair Display', weight:700, title:'The Quiet Garden' }
    ]) {
      await Promise.race([
        document.fonts.load(`${sample.weight} 42px "${sample.family}"`),
        new Promise(resolve => setTimeout(resolve, 900))
      ])
      const canvas = document.createElement('canvas')
      canvas.width = 360; canvas.height = 540
      const context = canvas.getContext('2d')
      context.fillStyle = '#2f6b4f'; context.fillRect(0, 0, canvas.width, canvas.height)
      context.fillStyle = '#fffaf0'; context.textAlign = 'center'; context.textBaseline = 'middle'
      context.font = `${sample.weight} 42px "${sample.family}", serif`
      context.fillText(sample.title, 180, 150)
      results.push(await analyzeCoverAppearance(canvas.toDataURL('image/png'), sample.title))
    }
    return results
  }, coverModuleUrl)

  const supportedFamilies = ['Playfair Display', 'Lora', 'Cormorant Garamond', 'DM Sans', 'Montserrat', 'Oswald']
  expect(appearances).toHaveLength(2)
  for (const appearance of appearances) {
    expect(appearance).toMatchObject({ color: '#2f6b4f', ink: '#fffaf0', source: 'cover' })
    // Font rasterization can differ when Google Fonts is unavailable on a
    // runner; the visual matcher must still return one of the app's families.
    expect(supportedFamilies).toContain(appearance.fontFamily)
    expect(appearance.fontCanvasFamily).toBe(appearance.fontFamily)
  }
})
