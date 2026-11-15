import { switchShelfView } from './helpers/shelf-view-gesture.mjs'
import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { spinePointerPosition } from './helpers/shelf-pointer.mjs'
import { settledGeometryLength } from './helpers/settled-geometry-length.mjs'

// At 50 ms of camera time per rendered frame, CI reached .98 after 8.3 s
// but needed further real frames. Keep the exact endpoint and geometry checks.
const VIEW_TRANSITION_TIMEOUT = 30_000
// Books come to rest after a load, a view change or a move in tens of rendered frames; a software-WebGL frame of this
// shelf takes about half a second (60 frames: 39 s on this fixture's larger sibling, on 1.7.325 and 1.7.328 alike).
const REST_TIMEOUT = 60_000
// Six completed real camera turns took 85.9s in CI before final reload.
// Keep the local scenario and each exact endpoint unchanged; the software
// renderer profile supplies only this scenario's total budget.
const FULL_WIDTH_SCENARIO_TIMEOUT = process.env.SHELF_PLACEMENT_SCENARIO_TIMEOUT_MS === '180000' ? 180_000 : 120_000

const PLANTS_KEY = 'inhouse-read-shelf-plants'
async function seedShelf(page) {
  const bytes = [...await readFile('tests/e2e/fixtures/tiny.pdf')]
  await page.evaluate(async ({ bytes, geometry }) => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('inhouse-read')
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error)
    })
    const records = Array.from({ length:4 }, (_, index) => ({
      id:`placement:${index}`, title:`Libro ${index + 1}`, name:`placement-${index}.pdf`,
      format:'PDF', sourceType:'local', mimeType:'application/pdf', pageCount:100,
      ...geometry,
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
  }, { bytes, geometry:await settledGeometryLength(30_000, 'shelf-placement') })
  await page.reload()
  await expect(page.locator('.ihr-spine')).toHaveCount(4)
  await expect(page.locator('.ihr-bookshelf-scene')).toBeVisible()
  await expect(page.locator('.ihr-bookshelf-scene')).toHaveAttribute('data-animating', 'false', { timeout:REST_TIMEOUT })
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
  await expect(canvas).toHaveAttribute('data-animating', 'false', { timeout:REST_TIMEOUT })
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

// A physical shelf resolves a drop against the actual solids (rust-ui/src/book_gravity.rs drop_position): a tapered pot
// reserves no air under its rim and a released book may lean or lie down, so the nominal upright slots above no longer
// describe it. Saved room rows are [key, kind, base, size, bay, x, y, angle, solid] in metres. Books are exact boxes
// turned by their angle; of a pot only its core is known here (the inner half of its width, the lower two fifths of the
// plant: every catalogue pot contains it). No book may be inside another book or inside a pot's core, beyond the
// solver's contact slop.
async function assertSolidsApart(page) {
  const poses = await page.evaluate(() => JSON.parse(localStorage.getItem('inhouse-read-shelf-physics-v1') || 'null')?.[2])
  expect(Array.isArray(poses)).toBe(true)
  const box = pose => {
    const [width, height] = pose[3], book = pose[1] === 0, angle = book ? pose[7] : 0
    const halfWidth = book ? width / 2 : width / 4, halfHeight = book ? height / 2 : height / 5
    const centreY = book ? pose[6] : pose[6] - height / 2 + halfHeight
    return { key:pose[0], book, bay:pose[2][2], x:pose[5], y:centreY, halfWidth, halfHeight, cos:Math.cos(angle), sin:Math.sin(angle) }
  }
  const boxes = poses.filter(pose => pose[1] === 0 || pose[1] === 1).map(box)
  expect(boxes.filter(item => item.book)).toHaveLength(4)
  expect(boxes.filter(item => !item.book)).toHaveLength(3)
  // Separating axes of two turned rectangles: the largest gap along any of their four edge normals.
  const gap = (a, b) => Math.max(...[[a.cos,a.sin],[-a.sin,a.cos],[b.cos,b.sin],[-b.sin,b.cos]].map(([x, y]) => {
    const reach = item => item.halfWidth * Math.abs(x * item.cos + y * item.sin) + item.halfHeight * Math.abs(-x * item.sin + y * item.cos)
    return Math.abs((a.x - b.x) * x + (a.y - b.y) * y) - reach(a) - reach(b)
  }))
  const inside = boxes.flatMap((a, index) => boxes.slice(index + 1)
    .filter(b => a.bay === b.bay && (a.book || b.book) && gap(a, b) < -.001).map(b => [a.key, b.key]))
  expect(inside).toEqual([])
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
  test.setTimeout(FULL_WIDTH_SCENARIO_TIMEOUT)
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
    await expect(scene).toHaveAttribute('data-view-progress', '0', { timeout:VIEW_TRANSITION_TIMEOUT })
    await expect(scene).toHaveAttribute('data-animating', 'false', { timeout:REST_TIMEOUT })
    await assertFullCabinetWidth(page)
    await expect(bin).toBeHidden()
    await expect(bin).toHaveAttribute('aria-hidden', 'true')
    await expect(scene).toHaveAttribute('data-trash-visible', 'false')
    expect(await bin.evaluate(node => ({ pointerEvents:getComputedStyle(node).pointerEvents,
      inert:node.inert, tabIndex:node.tabIndex }))).toEqual({ pointerEvents:'none', inert:true, tabIndex:-1 })
    await expect(page.locator('.ihr-shelf-catalog')).toBeHidden()
    await switchShelfView(page, 'isometric')
    await expect(scene).toHaveAttribute('data-view-progress', '1', { timeout:VIEW_TRANSITION_TIMEOUT })
    await expect(scene).toHaveAttribute('data-animating', 'false', { timeout:REST_TIMEOUT })
    await assertFullCabinetWidth(page)
    await expect(page.getByRole('button', { name:'Abrir catálogo IKEA de plantas, estanterías e iluminación' })).toBeVisible()
    // The basket is on the cabinet's physical floor. On taller screens or
    // shelves it is reached by scrolling, rather than pinned to the viewport.
    await page.locator('.ihr-bookshelf__scroll').evaluate(node => { node.scrollTop = node.scrollHeight })
    await expect(scene).toHaveAttribute('data-animating', 'false', { timeout:REST_TIMEOUT })
    await expect(bin).toBeVisible()
    await expect(bin).toHaveAttribute('aria-hidden', 'false')
    await expect(scene).toHaveAttribute('data-trash-visible', 'true')
    expect(await bin.evaluate(node => node.inert)).toBe(false)
    const contact = await scene.evaluate(node => ({ foot:Number(node.dataset.trashFootY),
      floor:Number(node.dataset.cabinetFloorY),scale:Number(node.dataset.trashLocalScale) }))
    expect(Number.isFinite(contact.foot)).toBe(true)
    expect(contact.foot).toBeCloseTo(contact.floor,5)
    expect(contact.scale).toBe(1)
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
    await page.locator('.ihr-bookshelf__scroll').evaluate(node => { node.scrollTop = 0 })
    await expect(page.getByRole('button', { name:'Abrir catálogo IKEA de plantas, estanterías e iluminación' })).toBeVisible()
    await switchShelfView(page, 'spine')
    await expect(scene).toHaveAttribute('data-view-progress', '0', { timeout:VIEW_TRANSITION_TIMEOUT })
    await expect(scene).toHaveAttribute('data-animating', 'false', { timeout:REST_TIMEOUT })
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
  await expect(scene).toHaveAttribute('data-view-progress', '0', { timeout:VIEW_TRANSITION_TIMEOUT })
  await assertFullCabinetWidth(page)
  await expect(bin).toBeHidden()
  expect(await Promise.all(Array.from({ length:4 }, (_, index) => positionFor(page,`placement:${index}`)))).toEqual(positions)
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)), PLANTS_KEY)).toEqual(plants)
  expect(errors).toEqual([])
})

test('libros y plantas se colocan libremente, se posan junto al objeto sobre el que se sueltan y conservan los huecos tras recargar', async ({ page }) => {
  // Four real 12-step drags, collision checks and three reloads. CI spent
  // 17 and 29 seconds drawing the first two drags and exhausted 90 seconds
  // during the third, with every completed placement assertion passing.
  test.setTimeout(240_000)
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

  // Since 1.7.280 a drop is resolved against the solid objects of the board and no neighbour is moved
  // (rust-ui/src/book_gravity.rs drop_position; rust-ui/src/bookshelf/objects.rs local_drag_destination): an object
  // dropped on another one lands at the nearest free place beside it, and the other keeps its place.
  const usable = sceneBounds.width - 32
  const nominal = (page, key, name) => object(page, key).evaluate((node, name) => parseFloat(node.style.getPropertyValue(name)), name)
  const touching = (await nominal(page, 'plant:placement-a', '--ihr-plant-w') + await nominal(page, 'book:placement:0', '--ihr-spine-w')) / 2
  const bookBounds = await object(page, 'book:placement:0').boundingBox()
  const plantDropX = await dragTo(page, 'plant:placement-a', { x:bookBounds.x + bookBounds.width / 2, y:bookBounds.y + bookBounds.height - 25 }, 1)
  await expect(object(page, 'plant:placement-a')).toHaveAttribute('data-shelf-index', '1')
  const plantX = Number(await object(page, 'plant:placement-a').getAttribute('data-shelf-x'))
  expect(plantX).toBeCloseTo(plantDropX, 3)
  // Beside the book, not on it and not anywhere else on the board: within four pixels of touching it.
  expect(Math.abs(plantX - saved.x) * usable).toBeGreaterThan(touching - .1)
  expect(Math.abs(plantX - saved.x) * usable).toBeLessThan(touching + 4)
  expect(await positionFor(page, 'placement:0')).toEqual(saved)
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)).find(plant => plant.key === 'plant:placement-a'), PLANTS_KEY))
    .toMatchObject({ shelf:1, x:plantX })
  await assertNoOverlap(page)
  await assertSolidsApart(page)
  const plantBounds = await object(page, 'plant:placement-a').boundingBox()
  const bookDropX = await dragTo(page, 'book:placement:0', { x:plantBounds.x + plantBounds.width / 2, y:plantBounds.y + plantBounds.height - 18 }, 1)
  // The book is put down beside the pot, which stays where it is. Its place is found at the height of its foot, where
  // this pot is narrower than its rim, so only the solids are compared from here on, not the nominal slots.
  expect(Number(await object(page, 'plant:placement-a').getAttribute('data-shelf-x'))).toBe(plantX)
  await expect.poll(async () => (await positionFor(page, 'placement:0')).x).toBeCloseTo(bookDropX, 3)
  expect(Math.abs(bookDropX - saved.x)).toBeGreaterThan(.005)
  expect(Math.abs(bookDropX - plantX) * usable).toBeLessThan(touching + 4)
  await assertSolidsApart(page)

  await switchShelfView(page, 'isometric')
  await expect(page.locator('.ihr-bookshelf-scene')).toHaveAttribute('data-view-progress', '1', { timeout:VIEW_TRANSITION_TIMEOUT })
  await expect(page.locator('.ihr-bookshelf-scene')).toHaveAttribute('data-animating', 'false', { timeout:REST_TIMEOUT })
  const thirdRowPlant = await object(page, 'plant:placement-c').boundingBox()
  await dragTo(page, 'book:placement:1', { x:thirdRowPlant.x + thirdRowPlant.width / 2, y:thirdRowPlant.y + thirdRowPlant.height - 22 }, 2)
  await expect.poll(() => positionFor(page, 'placement:1')).toMatchObject({ shelf:2 })
  await assertSolidsApart(page)
  // A keyboard step to another board is resolved like a drop: it needs a free place for the solid as it is. The middle
  // board now holds two pots and a leaning book, and the book that has just been leant on the lowest pot may or may not
  // find a place there (it did in two of four runs), so the step is taken by the succulent, which has the left of the
  // first board free above it.
  const succulentX = Number(await object(page, 'plant:placement-b').getAttribute('data-shelf-x'))
  await object(page, 'plant:placement-b').focus()
  await page.keyboard.press('Shift+ArrowUp')
  await expect(object(page, 'plant:placement-b')).toHaveAttribute('data-shelf-index', '0')
  expect(Number(await object(page, 'plant:placement-b').getAttribute('data-shelf-x'))).toBeCloseTo(succulentX, 4)
  await expect.poll(() => page.evaluate(key => JSON.parse(localStorage.getItem(key)).find(plant => plant.key === 'plant:placement-b').shelf, PLANTS_KEY)).toBe(0)
  expect(await positionFor(page, 'placement:1')).toMatchObject({ shelf:2 })
  await expect(page.locator('.ihr-bookshelf-scene')).toHaveAttribute('data-animating', 'false', { timeout:REST_TIMEOUT })
  await assertSolidsApart(page)
  const finalPlants = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), PLANTS_KEY)
  const finalPositions = await Promise.all(Array.from({ length:4 }, (_, index) => positionFor(page,`placement:${index}`)))
  await switchShelfView(page, 'spine')
  await expect(page.locator('.ihr-bookshelf-scene')).toHaveAttribute('data-view-progress', '0', { timeout:VIEW_TRANSITION_TIMEOUT })
  await expect(page.locator('.ihr-bookshelf-scene')).toHaveAttribute('data-animating', 'false', { timeout:REST_TIMEOUT })
  await assertFullCabinetWidth(page)
  await expect(page.locator('.ihr-shelf-trash')).toBeHidden()
  expect(await Promise.all(Array.from({ length:4 }, (_, index) => positionFor(page,`placement:${index}`)))).toEqual(finalPositions)
  await page.reload()
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)), PLANTS_KEY)).toEqual(finalPlants)
  await expect(object(page, 'book:placement:1')).toHaveAttribute('data-shelf-index', '2')
  await expect(object(page, 'plant:placement-b')).toHaveAttribute('data-shelf-index', '0')
  await expect(page.locator('.ihr-bookshelf-scene')).toHaveAttribute('data-view-progress', '0', { timeout:VIEW_TRANSITION_TIMEOUT })
  await assertFullCabinetWidth(page)
  await expect(page.locator('.ihr-shelf-trash')).toBeHidden()
  expect(await Promise.all(Array.from({ length:4 }, (_, index) => positionFor(page,`placement:${index}`)))).toEqual(finalPositions)
  await assertSolidsApart(page)
  expect(errors).toEqual([])
  await page.screenshot({ path:'test-results/free-book-and-plant-placement.png' })
})
