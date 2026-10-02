import { test, expect } from '@playwright/test'

const PDF = 'tests/e2e/fixtures/tiny.pdf'

async function assertCapturedFrame(canvas) {
  await expect.poll(() => canvas.evaluate(node => {
    const pixels = node.getContext('2d').getImageData(0, 0, node.width, node.height).data
    let painted = 0
    for (let index = 3; index < pixels.length; index += 4) if (pixels[index] > 0) painted++
    return painted / (node.width * node.height)
  })).toBeGreaterThan(.05)
}

for (const variant of [
  { name:'móvil compacto', width:320, height:568, theme:'light' },
  { name:'móvil oscuro', width:390, height:844, theme:'dark' },
  { name:'móvil horizontal', width:844, height:390, theme:'light' },
  { name:'escritorio', width:1280, height:800, theme:'light' }
]) test(`portada y controles sin solaparse: ${variant.name}`, async ({ page }) => {
  // This flow renders the model during two selections and a full opening.
  // Software WebGL in CI needs more than the default 30 s for the full flow;
  // individual control, geometry and continuity checks keep their limits.
  test.setTimeout(90_000)
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
  // Shared WebGL snapshots must retain actual pixels after the GPU's drawing
  // buffer is released; CSS visibility alone cannot detect a blank book.
  await assertCapturedFrame(page.locator('.ihr-flyout__book canvas'))
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
  await assertCapturedFrame(page.locator('.ihr-bookshelf-scene'))
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
  // Bounded animation steps retain the hinge and ribbon on a slow software
  // GPU; they may outlast the usual selector timeout without skipping poses.
  await expect(page.locator('.ihr-flyout')).toHaveCount(0,{timeout:20_000})
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
  // Reduced motion still loads and snapshots the 3D model twice. Software
  // WebGL can exceed the default test budget even when all focus checks pass.
  test.setTimeout(90_000)
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
  await expect(page.getByRole('button', { name:'Abrir', exact:true })).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  await expect(close).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(page.locator('.ihr-flyout')).toHaveCount(0)
  await expect(spine).toBeFocused()
})

test('editar el lomo en móvil muestra su modelo de canto y mantiene el editor estable', async ({ page }) => {
  const pageErrors = []
  page.on('pageerror', error => pageErrors.push(error.message))
  await page.setViewportSize({ width:390, height:844 })
  await page.addInitScript(() => localStorage.setItem('inhouse-read-theme', 'dark'))
  await page.goto('/')
  await page.locator('#file-picker').setInputFiles(PDF)
  await expect(page.locator('.pdf-page-canvas')).toBeVisible()
  await page.getByRole('button', { name:'Volver a la estantería' }).click()
  await page.locator('.ihr-spine').first().click()
  const dialog = page.locator('.ihr-flyout')
  await expect(dialog).toHaveClass(/is-ready/)
  await dialog.getByRole('button', { name:'Editar' }).click()
  await expect(dialog).toHaveClass(/is-editing-spine/)
  await expect(dialog.locator('.ihr-spine-editor')).toBeVisible()
  await expect(dialog.getByRole('heading', { name:'Lomo' })).toBeVisible()
  await expect(dialog.locator('.ihr-flyout__cover-target')).toBeHidden()
  const canvas = dialog.locator('.ihr-flyout__book canvas')
  await expect.poll(() => canvas.getAttribute('data-angle')).toBe('90')
  const centered = await canvas.evaluate(element => {
    const ratio = element.width / innerWidth
    const pixels = element.getContext('2d').getImageData(0, 0, element.width, element.height).data
    let left=element.width, right=0, top=element.height, bottom=0
    for (let y=0; y<element.height; y++) for (let x=0; x<element.width; x++) {
      if (pixels[(y * element.width + x) * 4 + 3] < 24) continue
      left=Math.min(left,x); right=Math.max(right,x); top=Math.min(top,y); bottom=Math.max(bottom,y)
    }
    return { centerX:(left+right)/2/ratio, bottom:bottom/ratio, panelTop:document.querySelector('.ihr-spine-editor').getBoundingClientRect().top }
  })
  expect(Math.abs(centered.centerX - 195)).toBeLessThan(18)
  expect(centered.bottom).toBeLessThan(centered.panelTop + 8)
  const lightMatch = await canvas.evaluate(element => ({
    book:getComputedStyle(element.parentElement).filter,
    shelf:getComputedStyle(document.querySelector('.ihr-spine')).filter
  }))
  expect(lightMatch.book).toBe(lightMatch.shelf)

  const title = dialog.getByRole('textbox', { name:'Texto del lomo' })
  await title.fill('Edición en móvil')
  await expect.poll(() => canvas.getAttribute('data-angle')).toBe('90')
  await dialog.getByRole('slider', { name:'Tamaño del título del lomo' }).fill('32')
  await dialog.getByRole('button', { name:'Color complementario 1' }).click()
  await expect(title).toHaveValue('Edición en móvil')
  await expect.poll(() => canvas.getAttribute('data-angle')).toBe('90')
  await dialog.getByRole('button', { name:'Listo' }).click()
  await expect(dialog).not.toHaveClass(/is-editing-spine/)
  await expect(dialog.locator('.ihr-flyout__cover-target')).toBeVisible()
  await expect.poll(() => dialog.locator('.ihr-flyout__book canvas').getAttribute('data-angle')).toBe('0')
  await dialog.getByRole('button', { name:'Editar' }).click()
  await expect.poll(() => dialog.locator('.ihr-flyout__book canvas').getAttribute('data-angle')).toBe('90')
  await dialog.getByRole('button', { name:'Listo' }).click()
  await expect.poll(() => dialog.locator('.ihr-flyout__book canvas').getAttribute('data-angle')).toBe('0')
  expect(pageErrors).toEqual([])
})

test('el teclado móvil no cierra el editor y mantiene visible el campo del lomo', async ({ page }) => {
  await page.setViewportSize({ width:390, height:844 })
  await page.emulateMedia({ reducedMotion:'reduce' })
  await page.addInitScript(() => {
    const viewport = new EventTarget()
    Object.assign(viewport, { width:innerWidth, height:innerHeight, offsetTop:0 })
    Object.defineProperty(window, 'visualViewport', { configurable:true, value:viewport })
    window.__testVisualViewport = viewport
  })
  await page.goto('/')
  await page.locator('#file-picker').setInputFiles(PDF)
  await expect(page.locator('.pdf-page-canvas')).toBeVisible()
  await page.getByRole('button', { name:'Volver a la estantería' }).click()
  await page.locator('.ihr-spine').first().click()
  const dialog = page.locator('.ihr-flyout')
  await dialog.getByRole('button', { name:'Editar' }).click()
  const title = dialog.getByRole('textbox', { name:'Texto del lomo' })
  await title.focus()
  await page.evaluate(() => {
    window.__testVisualViewport.height = 340
    window.__testVisualViewport.dispatchEvent(new Event('resize'))
    window.dispatchEvent(new Event('resize'))
  })

  await expect(dialog).toHaveCount(1)
  await expect(dialog).toHaveClass(/is-editing-spine/)
  await expect(dialog).toHaveClass(/uses-visual-viewport/)
  await expect(title).toBeFocused()
  const editorBounds = await dialog.locator('.ihr-spine-editor').boundingBox()
  const titleBounds = await title.boundingBox()
  expect(editorBounds.y + editorBounds.height).toBeLessThanOrEqual(340)
  expect(titleBounds.y + titleBounds.height).toBeLessThanOrEqual(340)
  await title.fill('Escribiendo con teclado')
  await expect(title).toHaveValue('Escribiendo con teclado')
  await expect(dialog).toHaveCount(1)

  await page.evaluate(() => {
    window.__testVisualViewport.height = 844
    window.__testVisualViewport.dispatchEvent(new Event('resize'))
    window.dispatchEvent(new Event('resize'))
  })
  await expect(dialog).toHaveCount(1)
  await expect(dialog).not.toHaveClass(/uses-visual-viewport/)
  await expect(title).toHaveValue('Escribiendo con teclado')
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
