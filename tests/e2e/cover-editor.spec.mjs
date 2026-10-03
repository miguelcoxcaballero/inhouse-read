import { mkdirSync } from 'node:fs'
import { test, expect } from '@playwright/test'

// Editor de la portada con el libro 3D real (WebGL por software). Los tests no
// usan una portada de tres colores reales: opciones seleccionables y
// persistentes, sin completar con motivos que no están en la imagen.

const evidence = process.env.COVER_EDITOR_EVIDENCE || ''
if (evidence) mkdirSync(evidence, { recursive: true })

async function openShelfEditor(page, { reduced = false, theme = '', colors = ['#2350b5','#d4a93c','#fffaf0'] } = {}) {
  await page.emulateMedia({ reducedMotion: reduced ? 'reduce' : 'no-preference' })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('./')
  if (theme) await page.evaluate(value => { localStorage.setItem('inhouse-read-theme', value); document.documentElement.setAttribute('data-theme', value) }, theme)
  await page.locator('#file-picker').setInputFiles('tests/e2e/fixtures/reading-journey.pdf')
  await expect(page.locator('.pdf-page-canvas')).toBeVisible()
  await expect(page.locator('#reader-location')).toHaveAttribute('aria-label', /Página 1/)
  await page.getByRole('button', { name: 'Volver a la estantería' }).click()
  // Return creates its flyout asynchronously. Wait for the whole lifecycle
  // before checking removal; count0 alone can pass before the flight exists.
  await expect(page.locator('body')).not.toHaveClass(/is-closing-reader|is-reading/, { timeout:30_000 })
  await expect(page.locator('.ihr-flyout')).toHaveCount(0)
  await expect(page.locator('#home-screen')).toBeVisible()
  await expect(page.locator('.ihr-spine').first()).not.toHaveClass(/is-away/)
  // The source PDF still exercises the real import/open/close. Only the
  // jacket is controlled: every proposed region has a known source colour.
  await page.evaluate(async colors => {
    const image=document.createElement('canvas'); image.width=600; image.height=900
    const context=image.getContext('2d')
    for(let index=0;index<colors.length;index++) {
      context.fillStyle=colors[index]
      context.fillRect(0,900*index/colors.length,600,900/colors.length)
    }
    const cover=await new Promise(resolve=>image.toBlob(resolve,'image/png'))
    const db=await new Promise((resolve,reject)=>{const request=indexedDB.open('inhouse-read');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)})
    const records=await new Promise((resolve,reject)=>{const request=db.transaction('books').objectStore('books').getAll();request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)})
    const transaction=db.transaction('books','readwrite')
    for(const record of records) transaction.objectStore('books').put({...record,cover,coverUpdatedAt:Date.now()})
    await new Promise((resolve,reject)=>{transaction.oncomplete=resolve;transaction.onerror=()=>reject(transaction.error)})
    db.close()
  },colors)
  await page.reload()
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
  await expect(page.getByRole('heading', { name: 'Lomo' })).toBeVisible()
  await expect(page.getByRole('tablist')).toBeVisible()
  const lomo = page.getByRole('tab', { name: 'Lomo' }), portada = page.getByRole('tab', { name: 'Portada' })
  await expect(lomo).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByLabel('Brillo de la portada')).toBeVisible()
  await expect.poll(() => canvasAngle(page)).toBe(90)

  await lomo.focus()
  await page.keyboard.press('ArrowRight')
  await expect(portada).toBeFocused()
  await expect(portada).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('heading', { name: 'Portada' })).toBeVisible()
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
  const sourceColors=await group.locator('.ihr-relief-card').evaluateAll(nodes=>nodes.map(node=>node.dataset.reliefColor))
  expect(new Set(sourceColors).size).toBe(3)
  expect([...sourceColors].sort()).toEqual(['#2350b5','#d4a93c','#fffaf0'].sort())
  const selectedColor=sourceColors[1]
  await expect(cards(page).last()).toBeChecked()
  await expect(page.getByLabel('Intensidad del relieve')).toBeDisabled()

  // Record every displayed pose inside the browser. Polling through RPC or
  // taking a software-GL screenshot can miss a whole half-cycle.
  await page.locator('.ihr-flyout__book canvas').evaluate(canvas => {
    window.coverAngleSamples = []
    window.coverAngleObserver = new MutationObserver(() => window.coverAngleSamples.push(Number(canvas.dataset.angle)))
    window.coverAngleObserver.observe(canvas, { attributes:true, attributeFilter:['data-angle'] })
  })
  await group.locator('.ihr-relief-card').nth(1).click()
  await expect(group.locator('.ihr-relief-card').nth(1)).toHaveClass(/is-selected/)
  await expect(page.getByLabel('Intensidad del relieve')).toBeEnabled()
  // Maps must be ready before the nominal 2400 ms motion begins. Software GL
  // caps animation steps, so observe completion rather than assume wall time.
  await expect.poll(() => page.evaluate(() => Math.max(0, ...window.coverAngleSamples.map(Math.abs))), { timeout:30_000 }).toBeGreaterThan(1)
  if (evidence) await page.screenshot({ path: `${evidence}/mobile-light-balanceo.png` })
  await expect.poll(() => canvasAngle(page), { timeout:30_000 }).toBe(0)
  const samples = await page.evaluate(() => {
    window.coverAngleObserver.disconnect()
    return window.coverAngleSamples
  })
  expect(Math.max(...samples)).toBeGreaterThan(6)
  expect(Math.min(...samples)).toBeLessThan(-6)
  expect(Math.max(...samples.map(Math.abs))).toBeLessThanOrEqual(13)

  // Se guarda con el libro: tras recargar sigue marcada.
  await page.getByRole('button', { name: 'Listo', exact: true }).click()
  await page.getByRole('button', { name: 'Cerrar', exact: true }).click()
  await page.reload()
  await page.locator('.ihr-spine').first().click()
  await page.getByRole('button', { name: 'Editar', exact: true }).click()
  await page.getByRole('tab', { name: 'Portada' }).click()
  await expect(cards(page)).toHaveCount(4, { timeout: 60_000 })
  await expect(cards(page).nth(1)).toBeChecked()
  await expect(group.locator('.ihr-relief-card').nth(1)).toHaveAttribute('data-relief-color',selectedColor)
  await expect(page.getByLabel('Intensidad del relieve')).toBeEnabled()
  // Al restaurar no se balancea sola.
  await page.waitForTimeout(600)
  await expect.poll(() => canvasAngle(page)).toBe(0)

  // Intensidad y Sin relieve.
  await page.getByLabel('Intensidad del relieve').fill('30')
  await expect.poll(()=>page.evaluate(async()=>{
    const db=await new Promise(resolve=>{const request=indexedDB.open('inhouse-read');request.onsuccess=()=>resolve(request.result)})
    const records=await new Promise(resolve=>{const request=db.transaction('books').objectStore('books').getAll();request.onsuccess=()=>resolve(request.result)})
    db.close();return records[0].coverRelief
  })).toMatchObject({color:selectedColor,strength:.3})
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

for(const colors of [['#2350b5'],['#2350b5','#fffaf0']]) test(`relieve: muestra sólo los ${colors.length} colores de una portada limitada`,async({page})=>{
  test.setTimeout(240_000)
  await page.setViewportSize({width:390,height:844})
  const errors=await openShelfEditor(page,{colors,reduced:true})
  await page.getByRole('tab',{name:'Portada'}).click()
  const group=page.getByRole('radiogroup',{name:'Propuestas de relieve'})
  await expect(group.locator('.ihr-relief-card')).toHaveCount(colors.length,{timeout:60_000})
  await expect(cards(page)).toHaveCount(colors.length+1)
  const found=await group.locator('.ihr-relief-card').evaluateAll(nodes=>nodes.map(node=>node.dataset.reliefColor))
  expect(found.sort()).toEqual([...colors].sort())
  expect(errors).toEqual([])
})

test('un gesto del usuario corta el balanceo', async ({ page }, testInfo) => {
  test.setTimeout(240_000)
  await page.setViewportSize({ width: 390, height: 844 })
  const errors = await openShelfEditor(page)
  await enterCover(page)
  const heading = await page.locator('.ihr-spine-editor__heading').boundingBox()
  expect(heading).not.toBeNull()
  // Capture the delivered input and every painted pose in the browser. A
  // locator evaluation can spend a full half-cycle resolving its handle on
  // software GL, so it cannot prove when a transient angle was interrupted.
  await page.evaluate(() => {
    const canvas = document.querySelector('.ihr-flyout__book canvas')
    const record = window.coverInterruption = { samples: [], gesture: null, returnedAt: null }
    const observer = new MutationObserver(() => {
      const sample = { angle: Number(canvas.dataset.angle), time: performance.now() }
      record.samples.push(sample)
      if (record.gesture && sample.angle === 0 && record.returnedAt === null) record.returnedAt = sample.time
    })
    observer.observe(canvas, { attributes: true, attributeFilter: ['data-angle'] })
    const capture = event => {
      if (!event.target.closest('.ihr-spine-editor__heading')) return
      record.gesture = { angle: Number(canvas.dataset.angle), time: performance.now(), isTrusted: event.isTrusted, sampleIndex: record.samples.length }
      document.removeEventListener('pointerdown', capture, true)
    }
    document.addEventListener('pointerdown', capture, true)
    window.finishCoverInterruption = () => {
      observer.disconnect()
      document.removeEventListener('pointerdown', capture, true)
      return record
    }
  })
  await page.getByRole('radiogroup', { name: 'Propuestas de relieve' }).locator('.ihr-relief-card').first().click()
  await page.mouse.move(heading.x + heading.width / 2, heading.y + heading.height / 2)
  // Observe directly on the rendering frame, then deliver a real pointerdown
  // without another locator/actionability round trip. The capture above must
  // still prove that the input actually arrived while the book was tilted.
  await page.waitForFunction(() => Math.abs(Number(document.querySelector('.ihr-flyout__book canvas').dataset.angle)) > 3, undefined, { polling: 'raf', timeout: 8000 })
  await page.mouse.down()
  await page.mouse.up()
  // Default checks the sub-second return. A software-GL observation profile
  // can extend its deadline without changing the 240 ms animation contract.
  const interruptDeadline = Number(process.env.COVER_EDITOR_INTERRUPT_TIMEOUT_MS || 900)
  await page.waitForFunction(() => window.coverInterruption.returnedAt !== null, undefined, { polling: 'raf', timeout: interruptDeadline })
  await page.waitForTimeout(500)
  const interruption = await page.evaluate(() => window.finishCoverInterruption())
  await testInfo.attach('cover-interruption', { body: JSON.stringify(interruption, null, 2), contentType: 'application/json' })
  expect(interruption.gesture?.isTrusted).toBe(true)
  expect(Math.abs(interruption.gesture.angle)).toBeGreaterThan(3)
  // The real input must arrive during the first oscillation. A late click on
  // the last, naturally decreasing lobe would not prove an interruption.
  const lobes = [...interruption.samples.slice(0, interruption.gesture.sampleIndex).map(sample => sample.angle), interruption.gesture.angle]
    .filter(angle => Math.abs(angle) > 1).map(Math.sign)
    .filter((sign, index, signs) => index === 0 || sign !== signs[index - 1])
  expect(lobes[0]).toBe(1)
  expect(lobes.length).toBeLessThanOrEqual(2)
  expect(interruption.returnedAt).toBeGreaterThan(interruption.gesture.time)
  expect(interruption.returnedAt - interruption.gesture.time).toBeLessThanOrEqual(interruptDeadline)
  // A cancellation returns monotonically to rest; another oscillation or a
  // natural finish after the remaining cycles does not satisfy this contract.
  let previousAngle = Math.abs(interruption.gesture.angle)
  for (const sample of interruption.samples.slice(interruption.gesture.sampleIndex)) {
    expect(Math.abs(sample.angle)).toBeLessThanOrEqual(previousAngle + 1e-6)
    previousAngle = Math.abs(sample.angle)
  }
  expect(previousAngle).toBe(0)
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

for (const [name, viewport] of [['movil', { width: 390, height: 844 }], ['escritorio', { width: 1280, height: 800 }], ['movil-estrecho', { width:320, height:568 }], ['horizontal', { width:844, height:390 }]]) {
  for (const theme of (name === 'movil-estrecho' || name === 'horizontal' ? ['light'] : ['light', 'dark'])) {
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
