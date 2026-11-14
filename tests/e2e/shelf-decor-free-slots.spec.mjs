import { expect, test } from '@playwright/test'

// Twenty books that were never placed by hand, on a cabinet whose first board already holds a floor lamp and a plant
// (the "twenty" library of tools/visual-harness/visual.mjs). The automatic rows are packed before the reader's own
// decoration is known; until 1.7.329 a physical shelf kept those slots as they were, so books started inside the
// pot and the lamp and ended standing on the pot or wedged against the shade.
const PHYSICS = 'inhouse-read-shelf-physics-v1'
test.use({ viewport:{ width:390, height:844 }, hasTouch:true, isMobile:true, deviceScaleFactor:1 })

test('los libros sin colocar rodean la lámpara y la planta, y los que no caben pasan a la balda siguiente', async ({ page }) => {
  test.setTimeout(120_000)
  await page.emulateMedia({ reducedMotion:'reduce' })
  await page.goto(process.env.IHR_TEST_URL || './')
  await expect(page.locator('.ihr-bookshelf')).toBeVisible()
  await page.evaluate(async () => {
    localStorage.setItem('inhouse-read-shelf-type', 'walnut'); localStorage.setItem('inhouse-read-shelf-view', 'spine')
    localStorage.setItem('inhouse-read-shelf-plants', JSON.stringify([
      { key:'plant:t-monstera', seed:'t-monstera', catalogId:'monstera', variant:'monstera', potId:'gradvis', width:92, height:126, shelf:0, x:.83 },
      { key:'plant:t-cactus', seed:'t-cactus', catalogId:'cactus', variant:'cactus', potId:'akerbar', width:56, height:90, shelf:1, x:.9 }]))
    localStorage.setItem('inhouse-read-shelf-lamps', JSON.stringify([
      { key:'lamp:t-tripod', lampId:'tripod', shelf:0, x:.45, isOn:false }, { key:'lamp:t-tarnaby', lampId:'tarnaby', shelf:1, x:.62, isOn:false }]))
    const db = await new Promise((resolve, reject) => { const request = indexedDB.open('inhouse-read'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error) })
    const transaction = db.transaction('books', 'readwrite')
    for (let index = 0; index < 20; index++) transaction.objectStore('books').put({ id:`free-slot:${index}`, title:`Libro ${index + 1}`, author:'Autora',
      format:'PDF', sourceType:'local', addedAt:Date.now(), shelfOrder:index, wordCount:90000, wordCountVersion:2, wordCountComplete:true, pageCount:300, progressFraction:0 })
    await new Promise((resolve, reject) => { transaction.oncomplete = resolve; transaction.onerror = () => reject(transaction.error) }); db.close()
  })
  await page.reload()
  await expect(page.locator('.ihr-spine')).toHaveCount(20)
  const scene = page.locator('.ihr-bookshelf-scene')
  await expect(scene).toHaveAttribute('data-animating', 'false', { timeout:30_000 })
  await expect.poll(() => page.evaluate(key => JSON.parse(localStorage.getItem(key) || 'null')?.[2]?.length, PHYSICS), { timeout:30_000 }).toBe(24)
  const room = await page.evaluate(key => ({
    objects:[...document.querySelectorAll('[data-object-id]')].map(node => { const box = node.getBoundingClientRect()
      return { id:node.dataset.objectId, shelf:Number(node.dataset.shelfIndex), left:box.left, right:box.right } }),
    poses:JSON.parse(localStorage.getItem(key))[2]
  }), PHYSICS)
  const books = room.objects.filter(object => object.id.startsWith('book:')), decoration = room.objects.filter(object => !object.id.startsWith('book:'))
  expect(books).toHaveLength(20); expect(decoration).toHaveLength(4)
  // No book shares board space with a plant or a lamp, silhouette included.
  for (const book of books) for (const other of decoration.filter(other => other.shelf === book.shelf))
    expect(Math.min(book.right, other.right) - Math.max(book.left, other.left), `${book.id} / ${other.id}`).toBeLessThan(1)
  // The first board cannot hold twenty books beside its lamp and plant: the rest went to the next board with room.
  expect(books.filter(book => book.shelf === 0).length).toBeGreaterThan(5)
  expect(books.filter(book => book.shelf === 1).length).toBeGreaterThan(0)
  // Saved room rows: [key, kind, base, size, bay, x, y, angle, solid], in metres. Every book either stands on its board
  // or, with a free board beside it, lies flat on it: none is propped at an angle and none reaches a decoration.
  const solids = room.poses.filter(pose => pose[1] !== 0)
  for (const pose of room.poses.filter(pose => pose[1] === 0)) {
    const [thickness, height] = pose[3], angle = Math.abs(pose[7]), flat = Math.abs(angle - Math.PI / 2) < .02
    expect(angle < .02 || flat, `${pose[0]} at ${pose[7]}`).toBe(true)
    expect(Math.abs(pose[6] - pose[2][1] + (flat ? (height - thickness) / 2 : 0)), pose[0]).toBeLessThan(.003)
    const reach = (flat ? height : thickness) / 2
    for (const solid of solids.filter(solid => solid[2][2] === pose[2][2]))
      expect(Math.abs(pose[5] - solid[5]) - reach - solid[3][0] / 2, `${pose[0]} / ${solid[0]}`).toBeGreaterThan(-.001)
  }
})
