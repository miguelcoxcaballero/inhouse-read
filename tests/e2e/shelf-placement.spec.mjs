import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { spinePointerPosition } from './helpers/shelf-pointer.mjs'

const PLANTS_KEY = 'inhouse-read-shelf-plants'
async function seedShelf(page) {
  const bytes = [...await readFile('tests/e2e/fixtures/tiny.pdf')]
  await page.evaluate(async bytes => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('inhouse-read')
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error)
    })
    const records = Array.from({ length:4 }, (_, index) => ({
      id:`placement:${index}`, title:`Libro ${index + 1}`, name:`placement-${index}.pdf`,
      format:'PDF', sourceType:'local', mimeType:'application/pdf', pageCount:100,
      content:new Blob([new Uint8Array(bytes)], { type:'application/pdf' }),
      shelfPosition:{ shelf:0, x:[.18,.34,.5,.66][index] }, shelfOrder:index,
      addedAt:Date.now(), lastOpenedAt:Date.now() - index, progressFraction:0
    }))
    const transaction = db.transaction('books', 'readwrite')
    for (const record of records) transaction.objectStore('books').put(record)
    await new Promise((resolve, reject) => { transaction.oncomplete = resolve; transaction.onerror = () => reject(transaction.error) })
    db.close()
    localStorage.setItem('inhouse-read-shelf-plants', JSON.stringify([
      { key:'plant:placement-a', seed:'placement-a', variant:'cactus', width:42, shelf:0, x:.85 },
      { key:'plant:placement-b', seed:'placement-b', variant:'suculenta', width:48, shelf:1, x:.18 },
      { key:'plant:placement-c', seed:'placement-c', variant:'pothos', width:48, shelf:2, x:.2 }
    ]))
    localStorage.setItem('inhouse-read-shelf-view', 'spine')
  }, bytes)
  await page.reload()
  await expect(page.locator('.ihr-spine')).toHaveCount(4)
  await expect(page.locator('.ihr-bookshelf-scene')).toBeVisible()
  await expect(page.locator('.ihr-bookshelf-scene')).toHaveAttribute('data-animating', 'false')
}
const object = (page, key) => page.locator(`[data-object-id="${key}"]`)
async function positionFor(page, id) {
  return page.evaluate(async id => {
    const db = await new Promise(resolve => { const request = indexedDB.open('inhouse-read'); request.onsuccess = () => resolve(request.result) })
    const record = await new Promise(resolve => { const request = db.transaction('books').objectStore('books').get(id); request.onsuccess = () => resolve(request.result) })
    db.close(); return record?.shelfPosition
  }, id)
}
async function dragTo(page, key, target, shelf) {
  const source = object(page, key), bounds = await source.boundingBox()
  const plant = key.startsWith('plant:')
  const grab = plant ? { x:bounds.width / 2,y:bounds.height * .88 } : await spinePointerPosition(source,bounds)
  await page.mouse.move(bounds.x + grab.x,bounds.y + grab.y)
  await page.mouse.down()
  await page.waitForTimeout(440)
  await expect(source).toHaveClass(/is-lifted/)
  await page.mouse.move(target.x, target.y, { steps:12 })
  const canvas = page.locator('.ihr-bookshelf-scene')
  await expect(canvas).toHaveAttribute('data-drop-shelf', String(shelf))
  const x = Number(await canvas.getAttribute('data-drop-x'))
  await page.mouse.up()
  await expect(page.locator('.ihr-bookshelf')).not.toHaveClass(/is-arranging/)
  await expect(page.locator('.ihr-flyout')).toHaveCount(0)
  await expect(canvas).toHaveAttribute('data-animating', 'false')
  return x
}
async function assertNoOverlap(page) {
  const overlaps = await page.evaluate(() => {
    const width = document.querySelector('.ihr-bookshelf-scene').getBoundingClientRect().width
    const objects = [...document.querySelectorAll('.ihr-spine, .ihr-plant')].map(node => {
      const objectWidth = parseFloat(node.style.getPropertyValue(node.classList.contains('ihr-plant') ? '--ihr-plant-w' : '--ihr-spine-w'))
      const center = 16 + Number(node.dataset.shelfX) * (width - 32)
      return { key:node.dataset.objectId, shelf:Number(node.dataset.shelfIndex), left:center - objectWidth / 2, right:center + objectWidth / 2 }
    })
    return objects.flatMap((a, i) => objects.slice(i + 1).filter(b => a.shelf === b.shelf && Math.min(a.right,b.right) - Math.max(a.left,b.left) > .1).map(b => [a.key,b.key]))
  })
  expect(overlaps).toEqual([])
}

async function assertFullCabinetWidth(page) {
  await expect.poll(() => page.evaluate(() => {
    const scroller = document.querySelector('.ihr-bookshelf__scroll')
    const stage = document.querySelector('.ihr-shelf-stage')
    const canvas = document.querySelector('.ihr-bookshelf-scene')
    if (!scroller || !stage || !canvas) return Infinity
    const cabinet = parseFloat(stage.style.getPropertyValue('--ihr-cabinet-width'))
    return Math.max(Math.abs(cabinet - scroller.clientWidth),
      Math.abs(canvas.getBoundingClientRect().width - scroller.clientWidth),
      Math.abs(stage.getBoundingClientRect().width - scroller.clientWidth))
  })).toBeLessThan(1)
}

test('la estantería frontal ocupa todo el ancho y la papelera sólo se activa en isométrica sin cambiar posiciones', async ({ page }, testInfo) => {
  test.setTimeout(120_000)
  const errors = []; page.on('pageerror', error => errors.push(error.message))
  await page.setViewportSize({ width:390, height:844 })
  await page.emulateMedia({ reducedMotion:'no-preference' })
  await page.goto(process.env.IHR_TEST_URL || '/')
  await seedShelf(page)
  const scene = page.locator('.ihr-bookshelf-scene'), bin = page.locator('.ihr-shelf-trash')
  const plants = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), PLANTS_KEY)
  const positions = await Promise.all(Array.from({ length:4 }, (_, index) => positionFor(page,`placement:${index}`)))
  for (const width of [320,390,860]) {
    await page.setViewportSize({ width, height:844 })
    await expect(scene).toHaveAttribute('data-view-progress', '0')
    await expect(scene).toHaveAttribute('data-animating', 'false')
    await assertFullCabinetWidth(page)
    await expect(bin).toBeHidden()
    await expect(bin).toHaveAttribute('aria-hidden', 'true')
    await expect(scene).toHaveAttribute('data-trash-visible', 'false')
    expect(await bin.evaluate(node => ({ pointerEvents:getComputedStyle(node).pointerEvents,
      inert:node.inert, tabIndex:node.tabIndex }))).toEqual({ pointerEvents:'none', inert:true, tabIndex:-1 })
    await expect(page.locator('.ihr-shelf-catalog')).toBeHidden()
    await page.getByRole('button', { name:'Vista isométrica, libros de lado' }).click()
    await expect(scene).toHaveAttribute('data-view-progress', '1')
    await expect(scene).toHaveAttribute('data-animating', 'false')
    await assertFullCabinetWidth(page)
    await expect(bin).toBeVisible()
    await expect(bin).toHaveAttribute('aria-hidden', 'false')
    await expect(scene).toHaveAttribute('data-trash-visible', 'true')
    expect(await bin.evaluate(node => node.inert)).toBe(false)
    await expect(page.getByRole('button', { name:'Abrir catálogo IKEA de plantas y macetas' })).toBeVisible()
    const bounds = await bin.boundingBox()
    expect(bounds.width).toBeGreaterThan(25)
    expect(bounds.height).toBeGreaterThan(35)
    expect(bounds.x).toBeGreaterThan(width * .65)
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(width + 1)
    expect(bounds.y).toBeGreaterThan(50)
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(845)
    await testInfo.attach(`estanteria-isometrica-papelera-${width}px`, {
      body:await page.screenshot(), contentType:'image/png'
    })
    await page.getByRole('button', { name:'Vista de canto' }).click()
    await expect(scene).toHaveAttribute('data-view-progress', '0')
    await expect(scene).toHaveAttribute('data-animating', 'false')
    await assertFullCabinetWidth(page)
    await expect(bin).toBeHidden()
    await expect(scene).toHaveAttribute('data-trash-visible', 'false')
    expect(await Promise.all(Array.from({ length:4 }, (_, index) => positionFor(page,`placement:${index}`)))).toEqual(positions)
    expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)), PLANTS_KEY)).toEqual(plants)
    await expect(page.locator('.ihr-spine')).toHaveCount(4)
    await expect(page.locator('.ihr-plant')).toHaveCount(3)
    await assertNoOverlap(page)
  }
  await page.reload()
  await expect(scene).toHaveAttribute('data-view-progress', '0')
  await assertFullCabinetWidth(page)
  await expect(bin).toBeHidden()
  expect(await Promise.all(Array.from({ length:4 }, (_, index) => positionFor(page,`placement:${index}`)))).toEqual(positions)
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)), PLANTS_KEY)).toEqual(plants)
  expect(errors).toEqual([])
})

test('libros y plantas se colocan libremente, se apartan al colisionar y conservan los huecos tras recargar', async ({ page }) => {
  test.setTimeout(90_000)
  const errors = []; page.on('pageerror', error => errors.push(error.message))
  await page.setViewportSize({ width:390, height:844 })
  await page.emulateMedia({ reducedMotion:'no-preference' })
  await page.goto(process.env.IHR_TEST_URL || '/')
  await seedShelf(page)
  await assertFullCabinetWidth(page)
  await expect(page.locator('.ihr-shelf-trash')).toBeHidden()
  const sceneBounds = await page.locator('.ihr-bookshelf-scene').boundingBox()
  const secondRowPlant = await object(page, 'plant:placement-b').boundingBox()
  const gap = { x:sceneBounds.x + 16 + (sceneBounds.width - 32) * .68, y:secondRowPlant.y + secondRowPlant.height - 25 }
  const chosenX = await dragTo(page, 'book:placement:0', gap, 1)
  await expect.poll(() => positionFor(page, 'placement:0')).toMatchObject({ shelf:1 })
  const saved = await positionFor(page, 'placement:0')
  expect(saved.x).toBeCloseTo(chosenX, 3)
  expect(saved.x).toBeGreaterThan(.6)
  await assertNoOverlap(page)
  await page.reload()
  await expect(object(page, 'book:placement:0')).toHaveAttribute('data-shelf-index', '1')
  expect(Number(await object(page, 'book:placement:0').getAttribute('data-shelf-x'))).toBeCloseTo(saved.x, 3)

  const bookBounds = await object(page, 'book:placement:0').boundingBox()
  await dragTo(page, 'plant:placement-a', { x:bookBounds.x + bookBounds.width / 2, y:bookBounds.y + bookBounds.height - 25 }, 1)
  await expect.poll(async () => (await positionFor(page, 'placement:0')).x).not.toBeCloseTo(saved.x, 2)
  await assertNoOverlap(page)
  const plantBounds = await object(page, 'plant:placement-a').boundingBox()
  const plantX = Number(await object(page, 'plant:placement-a').getAttribute('data-shelf-x'))
  await dragTo(page, 'book:placement:0', { x:plantBounds.x + plantBounds.width / 2, y:plantBounds.y + plantBounds.height - 18 }, 1)
  expect(Number(await object(page, 'plant:placement-a').getAttribute('data-shelf-x'))).not.toBeCloseTo(plantX, 2)
  await assertNoOverlap(page)

  await page.getByRole('button', { name:'Vista isométrica, libros de lado' }).click()
  await expect(page.locator('.ihr-bookshelf-scene')).toHaveAttribute('data-view-progress', '1')
  await expect(page.locator('.ihr-bookshelf-scene')).toHaveAttribute('data-animating', 'false')
  const thirdRowPlant = await object(page, 'plant:placement-c').boundingBox()
  await dragTo(page, 'book:placement:1', { x:thirdRowPlant.x + thirdRowPlant.width / 2, y:thirdRowPlant.y + thirdRowPlant.height - 22 }, 2)
  await expect.poll(() => positionFor(page, 'placement:1')).toMatchObject({ shelf:2 })
  await assertNoOverlap(page)
  await object(page, 'book:placement:1').focus()
  await page.keyboard.press('Shift+ArrowUp')
  await expect.poll(() => positionFor(page, 'placement:1')).toMatchObject({ shelf:1 })
  await expect(page.locator('.ihr-bookshelf-scene')).toHaveAttribute('data-animating', 'false')
  await assertNoOverlap(page)
  const finalPlants = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), PLANTS_KEY)
  const finalPositions = await Promise.all(Array.from({ length:4 }, (_, index) => positionFor(page,`placement:${index}`)))
  await page.getByRole('button', { name:'Vista de canto' }).click()
  await expect(page.locator('.ihr-bookshelf-scene')).toHaveAttribute('data-view-progress', '0')
  await expect(page.locator('.ihr-bookshelf-scene')).toHaveAttribute('data-animating', 'false')
  await assertFullCabinetWidth(page)
  await expect(page.locator('.ihr-shelf-trash')).toBeHidden()
  expect(await Promise.all(Array.from({ length:4 }, (_, index) => positionFor(page,`placement:${index}`)))).toEqual(finalPositions)
  await page.reload()
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)), PLANTS_KEY)).toEqual(finalPlants)
  await expect(object(page, 'book:placement:1')).toHaveAttribute('data-shelf-index', '1')
  await expect(page.locator('.ihr-bookshelf-scene')).toHaveAttribute('data-view-progress', '0')
  await assertFullCabinetWidth(page)
  await expect(page.locator('.ihr-shelf-trash')).toBeHidden()
  expect(await Promise.all(Array.from({ length:4 }, (_, index) => positionFor(page,`placement:${index}`)))).toEqual(finalPositions)
  await assertNoOverlap(page)
  expect(errors).toEqual([])
  await page.screenshot({ path:'test-results/free-book-and-plant-placement.png' })
})
