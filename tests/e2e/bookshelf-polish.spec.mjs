import { test, expect } from '@playwright/test'

const PDF = 'tests/e2e/fixtures/tiny.pdf'

for (const variant of [
  { name:'móvil compacto', width:320, height:568, theme:'light' },
  { name:'móvil oscuro', width:390, height:844, theme:'dark' },
  { name:'móvil horizontal', width:844, height:390, theme:'light' },
  { name:'escritorio', width:1280, height:800, theme:'light' }
]) test(`portada y controles sin solaparse: ${variant.name}`, async ({ page }) => {
  await page.setViewportSize({ width:variant.width, height:variant.height })
  await page.addInitScript(theme => localStorage.setItem('inhouse-read-theme', theme), variant.theme)
  await page.goto('/')
  await page.locator('#file-picker').setInputFiles(PDF)
  await expect(page.locator('.pdf-page-canvas')).toBeVisible()
  await page.getByRole('button', { name:'Volver a la estantería' }).click()
  await expect(page.getByRole('heading', { name:'Tu biblioteca' })).toBeVisible()
  await page.locator('.ihr-spine').first().click()
  const cover = page.locator('.ihr-flyout__cover-target')
  await expect(cover).toBeVisible()
  await expect(page.locator('.ihr-flyout__book canvas')).toHaveAttribute('data-angle', '0')
  const bounds = await page.locator('.ihr-flyout').evaluate(root => {
    const box = selector => {
      const r = root.querySelector(selector).getBoundingClientRect()
      return { left:r.left, right:r.right, top:r.top, bottom:r.bottom }
    }
    return { cover:box('.ihr-flyout__cover-target'), meta:box('.ihr-flyout__details'),
      actions:box('.ihr-flyout__actions'), close:box('.ihr-flyout__close') }
  })
  for (const box of Object.values(bounds)) {
    expect(box.left).toBeGreaterThanOrEqual(0)
    expect(box.right).toBeLessThanOrEqual(variant.width)
    expect(box.top).toBeGreaterThanOrEqual(0)
    expect(box.bottom).toBeLessThanOrEqual(variant.height)
  }
  if (variant.width > variant.height && variant.height <= 560) {
    expect(bounds.cover.right).toBeLessThan(bounds.meta.left)
  } else expect(bounds.cover.bottom).toBeLessThan(bounds.meta.top)
  // Merely showing a cover must never reveal the prepared reader.
  await expect(page.locator('#reader-screen')).toHaveClass(/is-preparing/)
  await expect(page.locator('.reader-toolbar')).toBeHidden()
  await page.getByRole('button', { name:'Cerrar', exact:true }).click()
  await expect(page.locator('.ihr-flyout')).toHaveCount(0)
  await page.locator('.ihr-spine').first().click()
  await expect(cover).toBeVisible()
  await page.evaluate(() => {
    window.__readerGaps = []
    const sample = () => {
      const book = document.querySelector('.ihr-flyout__book')
      if (!book) return
      const reader = document.getElementById('reader-screen')
      if (Number(getComputedStyle(book).opacity) < .9 && (reader.hidden || reader.classList.contains('is-preparing'))) window.__readerGaps.push(true)
      requestAnimationFrame(sample)
    }
    requestAnimationFrame(sample)
  })
  await cover.click()
  await expect(page.locator('.ihr-flyout')).toHaveCount(0)
  await expect(page.locator('.pdf-page-canvas')).toBeVisible()
  await expect(page.locator('.reader-toolbar')).toBeVisible()
  expect(await page.evaluate(() => window.__readerGaps)).toEqual([])
})

test('girar el móvil con una portada abierta devuelve el libro a su nueva balda', async ({ page }) => {
  await page.setViewportSize({ width:390, height:844 })
  await page.goto('/')
  await page.locator('#file-picker').setInputFiles(PDF)
  await expect(page.locator('.pdf-page-canvas')).toBeVisible()
  await page.getByRole('button', { name:'Volver a la estantería' }).click()
  await page.locator('.ihr-spine').first().click()
  await expect(page.locator('.ihr-flyout__cover-target')).toBeVisible()
  await page.setViewportSize({ width:844, height:390 })
  await expect(page.locator('.ihr-flyout')).toHaveCount(0)
  await page.locator('.ihr-spine').first().click()
  await expect(page.locator('.ihr-flyout__cover-target')).toBeVisible()
})

test('movimiento reducido conserva los dos pasos y el foco del diálogo', async ({ page }) => {
  await page.emulateMedia({ reducedMotion:'reduce' })
  await page.goto('/')
  await page.locator('#file-picker').setInputFiles(PDF)
  await expect(page.locator('.pdf-page-canvas')).toBeVisible()
  await page.getByRole('button', { name:'Volver a la estantería' }).click()
  const spine = page.locator('.ihr-spine').first()
  await spine.click()
  await expect(page.locator('.ihr-flyout')).toHaveClass(/is-ready/)
  const close = page.getByRole('button', { name:'Cerrar', exact:true })
  await close.focus()
  await page.keyboard.press('Tab')
  await expect(page.getByRole('button', { name:'Color de la portada', exact:true })).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  await expect(close).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(page.locator('.ihr-flyout')).toHaveCount(0)
  await expect(spine).toBeFocused()
})

test('las portadas PDF se guardan nítidas y se regeneran las miniaturas antiguas', async ({ page }) => {
  await page.goto('/')
  await page.locator('#file-picker').setInputFiles(PDF)
  await expect(page.locator('.pdf-page-canvas')).toBeVisible()
  await expect.poll(() => page.evaluate(async () => {
    const db = await new Promise(resolve => { const req=indexedDB.open('inhouse-read'); req.onsuccess=()=>resolve(req.result) })
    const record = await new Promise(resolve => { const req=db.transaction('books').objectStore('books').getAll(); req.onsuccess=()=>resolve(req.result[0]) })
    if (!record?.cover) return 0
    const image = await createImageBitmap(record.cover)
    const width = image.width; image.close(); db.close(); return width
  })).toBeGreaterThanOrEqual(800)

  // Simulate a v1.0.15 thumbnail saved at 300 px; opening the book upgrades it.
  await page.evaluate(async () => {
    const db=await new Promise(resolve=>{const req=indexedDB.open('inhouse-read');req.onsuccess=()=>resolve(req.result)})
    const record=await new Promise(resolve=>{const req=db.transaction('books').objectStore('books').getAll();req.onsuccess=()=>resolve(req.result[0])})
    const canvas=document.createElement('canvas');canvas.width=300;canvas.height=200
    const ctx=canvas.getContext('2d');ctx.fillStyle='#eeeeee';ctx.fillRect(0,0,300,200)
    const oldCover=await new Promise(resolve=>canvas.toBlob(resolve,'image/webp',.8))
    record.cover=oldCover
    await new Promise(resolve=>{const tx=db.transaction('books','readwrite');tx.objectStore('books').put(record);tx.oncomplete=resolve})
    db.close()
  })
  await page.reload()
  await page.locator('.ihr-spine').first().click()
  await expect(page.locator('.ihr-flyout__cover-target')).toBeVisible()
  await page.locator('.ihr-flyout__cover-target').click()
  await expect(page.locator('.pdf-page-canvas')).toBeVisible()
  await expect.poll(() => page.evaluate(async () => {
    const db=await new Promise(resolve=>{const req=indexedDB.open('inhouse-read');req.onsuccess=()=>resolve(req.result)})
    const record=await new Promise(resolve=>{const req=db.transaction('books').objectStore('books').getAll();req.onsuccess=()=>resolve(req.result[0])})
    const image=await createImageBitmap(record.cover);const width=image.width;image.close();db.close();return width
  })).toBeGreaterThanOrEqual(800)
})
