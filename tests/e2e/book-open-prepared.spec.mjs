import { test, expect } from '@playwright/test'

// The page a book opens on is prepared while the book sits lifted off the shelf
// (restore the saved place, lay the page out, rasterise it, upload it to the 3D
// book), so the tap on the cover only plays the animation. The app leaves
// user-timing marks for each step (performance mark names 'ihr:*', reset every
// time a book is picked), which these tests read instead of racing wall-clock
// time: a step that must not happen again after the tap simply has no new mark.

test.use({ viewport:{ width:390, height:844 }, hasTouch:true, isMobile:true, deviceScaleFactor:1 })
test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion:'no-preference' })
  await page.addInitScript(() => {
    window.__openingGpu = { links:0, draws:0, longTasks:[] }
    for (const type of [window.WebGLRenderingContext, window.WebGL2RenderingContext]) {
      if (!type) continue
      for (const [method, counter] of [['linkProgram','links'],['drawElements','draws'],['drawArrays','draws']]) {
        const original = type.prototype[method]
        type.prototype[method] = function (...args) {
          window.__openingGpu[counter]++
          return original.apply(this,args)
        }
      }
    }
    new PerformanceObserver(list => window.__openingGpu.longTasks.push(...list.getEntries()
      .map(entry => ({start:entry.startTime,duration:entry.duration}))))
      .observe({type:'longtask',buffered:true})
  })
})

const READY_TIMEOUT = 120_000

function colouredPdf() {
  const colours = ['.72 .08 .15', '.1 .52 .23', '.08 .22 .78', '.69 .42 .08']
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [4 0 R 6 0 R 8 0 R 10 0 R] /Count 4 >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
  ]
  for (let i = 0; i < 4; i++) {
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 600] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + i * 2} 0 R >>`)
    const stream = `${colours[i]} rg 0 0 400 600 re f\n1 1 1 rg BT /F1 23 Tf 32 540 Td (Printed page ${i + 1}.) Tj 0 -40 Td /F1 14 Tf (This is the actual page in the document.) Tj ET`
    objects.push(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`)
  }
  let output = '%PDF-1.4\n'
  const offsets = [0]
  objects.forEach((object, i) => {
    offsets.push(Buffer.byteLength(output))
    output += `${i + 1} 0 obj\n${object}\nendobj\n`
  })
  const xref = Buffer.byteLength(output)
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  output += offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')
  output += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(output)
}
const PDF = { name:'prepared-page.pdf', mimeType:'application/pdf', buffer:colouredPdf() }
const EPUB = 'tests/e2e/fixtures/reading-journey.epub'

const marks = page => page.evaluate(() => {
  const out = {}
  for (const entry of performance.getEntriesByType('mark')) if (entry.name.startsWith('ihr:')) (out[entry.name.slice(4)] ||= []).push(entry.startTime)
  return out
})
const count = (timeline, name) => timeline[name]?.length ?? 0

async function importAndRead(page, file) {
  await page.goto(process.env.IHR_TEST_URL || '/')
  await page.locator('#file-picker').setInputFiles(file)
  await expect(page.locator('#reader-toolbar')).toBeVisible({ timeout:READY_TIMEOUT })
  await expect(page.locator('#reader-top-title')).not.toContainText('Abriendo libro', { timeout:READY_TIMEOUT })
  if (typeof file === 'object') await expect(page.locator('#reader-location')).toHaveAttribute('aria-label', /Página 1 de 4/, { timeout:READY_TIMEOUT })
  else await expect(page.locator('foliate-view')).toBeVisible({ timeout:READY_TIMEOUT })
}

async function backToShelf(page) {
  await page.getByRole('button', { name:'Volver a la estantería' }).click()
  await expect(page.locator('.ihr-flyout--return')).toHaveCount(0, { timeout:READY_TIMEOUT })
  await expect(page.locator('body')).not.toHaveClass(/is-closing-reader|is-reading/, { timeout:READY_TIMEOUT })
}

async function pickBook(page) {
  await page.locator('.ihr-spine').first().click()
  await expect(page.locator('.ihr-flyout.is-ready')).toBeVisible({ timeout:READY_TIMEOUT })
}

const readyToRead = page => expect(page.locator('.ihr-flyout__readiness')).toHaveText('Listo para leer', { timeout:READY_TIMEOUT })

/** Move the saved place the way a late Drive progress sync would: straight in the library. */
function rewriteSavedPlace(page, name, place) {
  return page.evaluate(async ({ name, place }) => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('inhouse-read')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    await new Promise((resolve, reject) => {
      const store = db.transaction('books', 'readwrite').objectStore('books')
      const all = store.getAll()
      all.onsuccess = () => {
        const record = all.result.find(book => book.name === name)
        if (!record) return reject(new Error('book not found'))
        Object.assign(record, place)
        const put = store.put(record)
        put.onsuccess = () => resolve()
        put.onerror = () => reject(put.error)
      }
      all.onerror = () => reject(all.error)
    })
    db.close()
  }, { name, place })
}

/** Records what the 3D book shows and which phases the opening goes through. */
function observeOpening(page) {
  return page.evaluate(() => {
    const state = window.__preparedOpening = { phases:[], frames:[], themes:[], done:false }
    state.gpuBefore = {...window.__openingGpu}
    const record = () => {
      if (state.done) return
      const flyout = document.querySelector('.ihr-flyout')
      const phase = flyout?.dataset.openingPhase
      if (phase && !state.phases.includes(phase)) state.phases.push(phase)
      const canvas = flyout?.querySelector('.ihr-flyout__book canvas')
      if (canvas && phase && phase !== 'preparing') {
        const opened = Number(canvas.dataset.coverOpen)
        const theme = Number(canvas.dataset.pageTheme)
        if (opened > 0 && state.firstFrame == null) state.firstFrame = performance.now()
        if (opened > .6) state.frames.push({ phase, opened, source:canvas.dataset.pageSource, locator:canvas.dataset.pageLocator,
          text:canvas.dataset.pageText, width:Number(canvas.dataset.pageWidth) })
        if (state.themes.at(-1) !== theme) state.themes.push(theme)
      }
    }
    // The hand-off lasts a few frames: watch the attribute itself, not only each frame.
    new MutationObserver(record).observe(document.body, { subtree:true, attributes:true, attributeFilter:['data-opening-phase', 'data-cover-open', 'data-page-theme'] })
    const tick = () => { record(); if (!state.done) requestAnimationFrame(tick) }
    requestAnimationFrame(tick)
  })
}

async function finishOpening(page) {
  await expect(page.locator('.ihr-flyout')).toHaveCount(0, { timeout:READY_TIMEOUT })
  await expect(page.locator('#reader-toolbar')).toBeVisible({ timeout:READY_TIMEOUT })
  await expect(page.locator('#reader-screen')).not.toHaveClass(/is-preparing|is-opening-from-book/)
  return page.evaluate(() => {
    const state = window.__preparedOpening; state.done = true
    state.gpuAfter = {...window.__openingGpu}
    return state
  })
}

/** The opening ran as it always did: hinge, bookmark, zoom, hand-off, sepia fading to the reading theme. */
function expectOpeningAnimation(opening) {
  expect(opening.phases).toEqual(expect.arrayContaining(['opening', 'bookmark', 'zooming', 'handoff']))
  expect(opening.frames.length).toBeGreaterThan(0)
  expect(opening.themes.at(-1)).toBeGreaterThanOrEqual(.999)
}

const openWithTap = page => page.locator('.ihr-flyout__cover-target').click()

for (const [kind, file, savedText, steps] of [
  ['PDF', PDF, 'Printed page 3.', async page => {
    for (const number of [2, 3]) {
      await page.getByRole('button', { name:'Página siguiente', exact:true }).click()
      await expect(page.locator('#reader-location')).toHaveAttribute('aria-label', new RegExp(`Página ${number} de 4`))
    }
  }],
  ['EPUB', EPUB, 'Beyond the window', async page => {
    await page.locator('#reader-location').click()
    await page.getByRole('button', { name:'Beyond the window', exact:true }).click()
    await expect.poll(() => page.evaluate(() => document.querySelector('foliate-view')?.renderer?.getContents()?.[0]?.doc.querySelector('h1')?.textContent)).toBe('Beyond the window')
  }]
]) {
  test(`${kind}: la página guardada se prepara al sacar el libro y se reutiliza al abrirlo`, async ({ page }) => {
    test.setTimeout(280_000)
    const errors = []; page.on('pageerror', error => errors.push(error.message))
    await importAndRead(page, file)
    await steps(page)
    await backToShelf(page)

    await pickBook(page)
    await readyToRead(page)
    // Ready means ready: the page was restored and rasterised, and (with WebGL) is on the 3D book already.
    const before = await marks(page)
    expect(count(before, 'page-snapshot')).toBe(1)
    expect(count(before, 'page-reused')).toBe(0)
    expect(count(before, 'open-tap')).toBe(0)
    expect(before['page-snapshot'][0]).toBeGreaterThan(before['flyout-ready'][0]) // after the pull-out, not during it
    if (await page.locator('.ihr-flyout.has-webgl').count()) {
      expect(count(before, 'textures-uploaded')).toBe(1)
      expect(before['textures-uploaded'][0]).toBeGreaterThanOrEqual(before['page-snapshot'][0])
    }

    await observeOpening(page)
    await openWithTap(page)
    const opening = await finishOpening(page)
    const after = await marks(page)
    console.log('PREPARED_OPEN_TIMELINE', JSON.stringify({before,after,firstFrame:opening.firstFrame,
      openToFirstFrame:opening.firstFrame-after['open-tap'][0], newLinks:opening.gpuAfter.links-opening.gpuBefore.links,
      draws:opening.gpuAfter.draws-opening.gpuBefore.draws,
      extractionLongTasks:opening.gpuAfter.longTasks.filter(task => task.start >= before.select[0] && task.start < before['flyout-ready'][0])}))
    expect(opening.gpuAfter.links-opening.gpuBefore.links, 'opening must reuse its prepared shader programs').toBe(0)
    // Nothing was computed again: the tap used the prepared page.
    expect(count(after, 'page-snapshot')).toBe(1)
    expect(count(after, 'page-restored')).toBe(1)
    expect(count(after, 'page-reused')).toBe(1)
    expect(after['open-tap'][0]).toBeGreaterThan(after['page-snapshot'][0])
    // And it is the saved page, with the animation intact.
    expect(opening.frames.every(frame => frame.text.includes(savedText))).toBe(true)
    expectOpeningAnimation(opening)
    expect(opening.themes[0]).toBe(0) // opens in sepia, fades to the theme
    await expect(page.locator('#reader-location')).toHaveAttribute('aria-label', kind === 'PDF' ? /Página 3 de 4/ : /Progreso y capítulos, /)
    expect(errors).toEqual([])
  })
}

test('la página preparada se descarta y se recalcula si la posición guardada cambia (Drive)', async ({ page }) => {
  test.setTimeout(280_000)
  const errors = []; page.on('pageerror', error => errors.push(error.message))
  await importAndRead(page, PDF)
  await backToShelf(page) // saved place: page 1
  await pickBook(page)
  await readyToRead(page)
  expect(count(await marks(page), 'page-snapshot')).toBe(1)

  // The progress of another device lands while the book waits: page 2.
  await rewriteSavedPlace(page, PDF.name, { locator:{ kind:'pdf-page', value:2 }, progressFraction:1 / 3 })
  await observeOpening(page)
  await openWithTap(page)
  const opening = await finishOpening(page)
  const after = await marks(page)
  expect(count(after, 'page-snapshot')).toBe(2) // the stale one was not shown: a new one was made at the tap
  expect(count(after, 'page-reused')).toBe(0)
  expect(opening.frames.length).toBeGreaterThan(0)
  expect(opening.frames.every(frame => frame.text.includes('Printed page 2.'))).toBe(true)
  expectOpeningAnimation(opening)
  await expect(page.locator('#reader-location')).toHaveAttribute('aria-label', /Página 2 de 4/)
  expect(errors).toEqual([])
})

test('un giro de pantalla descarta la página preparada: al volver a sacar el libro se rehace para el tamaño nuevo', async ({ page }) => {
  test.setTimeout(280_000)
  const errors = []; page.on('pageerror', error => errors.push(error.message))
  await importAndRead(page, PDF)
  await backToShelf(page)
  await pickBook(page)
  await readyToRead(page)
  const portrait = await page.evaluate(() => document.querySelector('.ihr-flyout .ihr-flyout__book canvas')?.dataset.pageWidth)

  // The shelf folds the lifted book away on a resize; the page prepared for the old size must not survive it.
  await page.setViewportSize({ width:844, height:390 })
  await expect(page.locator('.ihr-flyout')).toHaveCount(0, { timeout:READY_TIMEOUT })
  await pickBook(page)
  await readyToRead(page)
  const again = await marks(page)
  expect(count(again, 'page-snapshot')).toBe(1) // made again for this selection ...
  expect(count(again, 'engine-opened')).toBe(0) // ... on the engine that was still loaded
  const landscape = await page.evaluate(() => document.querySelector('.ihr-flyout .ihr-flyout__book canvas')?.dataset.pageWidth)
  if (landscape && portrait) expect(landscape).not.toBe(portrait)

  await observeOpening(page)
  await openWithTap(page)
  const opening = await finishOpening(page)
  const after = await marks(page)
  expect(count(after, 'page-snapshot')).toBe(1)
  expect(count(after, 'page-reused')).toBe(1)
  expect(opening.frames.every(frame => frame.text.includes('Printed page 1.'))).toBe(true)
  expectOpeningAnimation(opening)
  expect(errors).toEqual([])
})

test('cerrar la portada sin abrir descarta la página preparada; al volver a sacarlo se prepara de nuevo', async ({ page }) => {
  test.setTimeout(280_000)
  const errors = []; page.on('pageerror', error => errors.push(error.message))
  await importAndRead(page, PDF)
  await backToShelf(page)
  await pickBook(page)
  await readyToRead(page)
  expect(count(await marks(page), 'page-snapshot')).toBe(1)

  await page.locator('.ihr-flyout__close').click()
  await expect(page.locator('.ihr-flyout')).toHaveCount(0, { timeout:READY_TIMEOUT })
  await pickBook(page)
  await readyToRead(page)
  const again = await marks(page)
  expect(count(again, 'page-snapshot')).toBe(1) // not carried over from the closed selection
  expect(count(again, 'engine-opened')).toBe(0)

  await observeOpening(page)
  await openWithTap(page)
  const opening = await finishOpening(page)
  expect(count(await marks(page), 'page-reused')).toBe(1)
  expectOpeningAnimation(opening)
  expect(errors).toEqual([])
})

test('abrir antes de que la preparación termine sigue funcionando, sin duplicar el trabajo', async ({ page }) => {
  test.setTimeout(280_000)
  const errors = []; page.on('pageerror', error => errors.push(error.message))
  // Hold the idle slices back so the cover is tapped long before the page is prepared.
  await page.addInitScript(() => {
    window.requestIdleCallback = callback => setTimeout(() => callback({ didTimeout:true, timeRemaining:() => 0 }), 20_000)
  })
  await importAndRead(page, PDF)
  await backToShelf(page)
  await pickBook(page)
  expect(count(await marks(page), 'page-snapshot')).toBe(0)

  await observeOpening(page)
  await openWithTap(page)
  const opening = await finishOpening(page)
  const after = await marks(page)
  expect(count(after, 'page-snapshot')).toBe(1) // made once, for this tap
  expect(count(after, 'page-restored')).toBe(1)
  expect(opening.frames.every(frame => frame.text.includes('Printed page 1.'))).toBe(true)
  expectOpeningAnimation(opening)
  expect(errors).toEqual([])
})

test('cerrar y volver a abrir: la segunda apertura usa la posición donde se dejó el libro', async ({ page }) => {
  test.setTimeout(280_000)
  const errors = []; page.on('pageerror', error => errors.push(error.message))
  await importAndRead(page, PDF)
  await backToShelf(page)

  await pickBook(page)
  await readyToRead(page)
  await openWithTap(page)
  await expect(page.locator('.ihr-flyout')).toHaveCount(0, { timeout:READY_TIMEOUT })
  await expect(page.locator('#reader-toolbar')).toBeVisible()
  await page.getByRole('button', { name:'Página siguiente', exact:true }).click()
  await expect(page.locator('#reader-location')).toHaveAttribute('aria-label', /Página 2 de 4/)
  // The invisible picker must not create a root scroller after the full-height
  // app. That one-pixel scroll shifted the visible reader away from its
  // prepared viewport on the second opening, forcing another snapshot.
  expect(await page.evaluate(() => ({
    scrollY:window.scrollY,
    height:document.documentElement.scrollHeight,
    viewport:document.documentElement.clientHeight
  }))).toEqual({ scrollY:0, height:844, viewport:844 })
  await backToShelf(page)

  await pickBook(page)
  await readyToRead(page)
  const prepared = await marks(page)
  expect(count(prepared, 'page-snapshot')).toBe(1)
  expect(count(prepared, 'engine-opened')).toBe(1) // a new engine: the old one went with the closed reader
  await observeOpening(page)
  await openWithTap(page)
  const opening = await finishOpening(page)
  expect(count(await marks(page), 'page-reused')).toBe(1)
  expect(opening.frames.every(frame => frame.text.includes('Printed page 2.'))).toBe(true)
  expectOpeningAnimation(opening)
  await expect(page.locator('#reader-location')).toHaveAttribute('aria-label', /Página 2 de 4/)
  expect(errors).toEqual([])
})

for (const change of ['tema de la app','preferencias de lectura']) test(`la página preparada se descarta al cambiar ${change}`, async ({page}) => {
  test.setTimeout(280_000)
  await importAndRead(page, PDF)
  await backToShelf(page)
  await pickBook(page)
  await readyToRead(page)
  expect(count(await marks(page),'page-snapshot')).toBe(1)
  await page.evaluate(change => {
    if (change === 'tema de la app') document.documentElement.setAttribute('data-theme','dark')
    else document.querySelector('.reading-panel [data-theme="night"]').click()
  },change)
  await observeOpening(page)
  await openWithTap(page)
  const opening = await finishOpening(page), after = await marks(page)
  expect(count(after,'page-reused')).toBe(0)
  expect(count(after,'page-snapshot')).toBe(2)
  expect(opening.frames.every(frame => frame.text.includes('Printed page 1.'))).toBe(true)
  expectOpeningAnimation(opening)
})
