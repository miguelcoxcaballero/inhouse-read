import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'

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
  await page.mouse.move(bounds.x + (plant ? bounds.width / 2 : Math.min(8, bounds.width * .12)),
    bounds.y + bounds.height * (plant ? .88 : .65))
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

test('libros y plantas se colocan libremente, se apartan al colisionar y conservan los huecos tras recargar', async ({ page }) => {
  test.setTimeout(90_000)
  const errors = []; page.on('pageerror', error => errors.push(error.message))
  await page.setViewportSize({ width:390, height:844 })
  await page.emulateMedia({ reducedMotion:'no-preference' })
  await page.goto(process.env.IHR_TEST_URL || '/')
  await seedShelf(page)
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
  await page.reload()
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)), PLANTS_KEY)).toEqual(finalPlants)
  await expect(object(page, 'book:placement:1')).toHaveAttribute('data-shelf-index', '1')
  await assertNoOverlap(page)
  expect(errors).toEqual([])
  await page.screenshot({ path:'test-results/free-book-and-plant-placement.png' })
})
