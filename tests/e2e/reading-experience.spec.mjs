import { test, expect } from '@playwright/test'

const PDF = 'tests/e2e/fixtures/reading-journey.pdf'
const EPUB = 'tests/e2e/fixtures/reading-journey.epub'
test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width:390, height:844 })
  await page.emulateMedia({ reducedMotion:'reduce' })
})
async function openPdf(page) {
  await page.goto('/')
  await page.locator('#file-picker').setInputFiles(PDF)
  await expect(page.locator('#reader-location')).toHaveAttribute('aria-label', /Página 1 de 4/)
}
async function reopen(page) {
  await page.locator('.ihr-spine').first().click()
  await page.locator('.ihr-flyout__cover-target').click()
  await expect(page.locator('.ihr-flyout')).toHaveCount(0)
}

test('PDF: saltos, regreso, marcadores y última página sobreviven al cierre', async ({ page }) => {
  await openPdf(page)
  await page.getByRole('button', { name:'Página siguiente', exact:true }).click()
  await expect(page.locator('#reader-location')).toHaveAttribute('aria-label', /Página 2 de 4/)
  await page.locator('#reader-location').click()
  await page.getByRole('button', { name:'Marcar esta página' }).click()
  await expect(page.locator('[data-bookmarks]')).toContainText('Página 2 de 4')
  await page.getByRole('spinbutton', { name:'Ir a la página' }).fill('4')
  await page.getByRole('button', { name:'Ir', exact:true }).click()
  await expect(page.locator('#reader-location')).toHaveAttribute('aria-label', /Página 4 de 4/)
  await expect(page.locator('.reader-return')).toContainText('Página 2 de 4')
  await page.getByRole('button', { name:'Volver a la estantería' }).click()
  await page.reload()
  await reopen(page)
  await expect(page.locator('#reader-location')).toHaveAttribute('aria-label', /Página 4 de 4/)
  await page.locator('.reader-return').click()
  await expect(page.locator('#reader-location')).toHaveAttribute('aria-label', /Página 2 de 4/)
  await page.locator('#reader-location').click()
  await expect(page.locator('[data-bookmarks]')).toContainText('Página 2 de 4')
  await page.getByRole('slider', { name:'Progreso del libro', exact:true }).fill('0')
  await expect(page.locator('#reader-location')).toHaveAttribute('aria-label', /Página 1 de 4/)
})

test('PDF: temas y texto adaptable aplican tipografía, tamaño e interlineado persistentes', async ({ page }) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message))
  await openPdf(page)
  await page.getByRole('button', { name:'Aspecto de lectura' }).click()
  await page.getByRole('button', { name:'Sepia', exact:true }).click()
  await page.getByRole('combobox', { name:'Vista del PDF' }).selectOption('text')
  await page.getByRole('combobox', { name:'Tipografía de lectura' }).selectOption('sans')
  await page.getByRole('slider', { name:'Tamaño de letra', exact:true }).fill('26')
  await page.locator('#reading-appearance .reading-details summary').click()
  await page.getByRole('slider', { name:'Interlineado', exact:true }).fill('2')
  await page.screenshot({ path:'test-results/reading-appearance-mobile.png' })
  await page.getByRole('button', { name:'Cerrar opciones de lectura' }).click()
  const text = page.locator('.pdf-reflow-page')
  await expect(text).toBeVisible()
  await expect(text).toContainText('Reading journey. Page 1.')
  await expect(text).toHaveCSS('font-size','26px')
  await expect(text).toHaveCSS('line-height','52px')
  await expect(page.locator('#reader-screen')).toHaveAttribute('data-reading-theme','sepia')
  await page.reload(); await reopen(page)
  await expect(text).toBeVisible()
  await expect(text).toHaveCSS('font-size','26px')
  await expect(page.locator('#reader-screen')).toHaveAttribute('data-reading-theme','sepia')
  expect(errors).toEqual([])
})

test('PDF: búsqueda completa el libro y los resultados llevan a la página correcta', async ({ page }) => {
  await openPdf(page)
  await page.getByRole('button',{name:'Buscar en el libro'}).click()
  await page.getByRole('searchbox',{name:'Buscar en el libro'}).fill('Page 3')
  await page.getByRole('button',{name:'Buscar',exact:true}).click()
  await expect(page.locator('[data-search-status]')).toContainText('resultados')
  await page.locator('[data-search-results] button').first().click()
  await expect(page.locator('#reader-location')).toHaveAttribute('aria-label', /Página 3 de 4/)
})

test('PDF: guarda una cita seleccionada y la conserva al reabrir el libro', async ({ page }) => {
  await openPdf(page)
  const quote = await page.evaluate(() => {
    const span = [...document.querySelectorAll('.pdf-text-layer span')].find(item => item.textContent?.trim())
    if (!span) return ''
    const range = document.createRange(); range.selectNodeContents(span)
    const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range)
    return selection.toString()
  })
  expect(quote).toBeTruthy()
  await page.locator('#reader-location').click()
  await page.getByRole('tab',{name:'Citas'}).click()
  await page.getByRole('button',{name:'Guardar cita'}).click()
  await expect(page.locator('[data-quotes]')).toContainText(quote.trim())
  await page.getByRole('button',{name:'Cerrar opciones de lectura'}).click()
  await page.getByRole('button',{name:'Volver a la estantería'}).click()
  await page.reload(); await reopen(page)
  await page.locator('#reader-location').click()
  await page.getByRole('tab',{name:'Citas'}).click()
  await expect(page.locator('[data-quotes]')).toContainText(quote.trim())
})

test('EPUB: tipografía real, capítulos, enlaces internos y voz desde el texto visible', async ({ page }) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message))
  await page.addInitScript(() => {
    window.__epubSpeech = []
    window.InhouseSpeech = {getVoices:() => '[]',stop:() => {},speak:text => window.__epubSpeech.push(text)}
  })
  await page.goto(process.env.IHR_TEST_URL || '/')
  await page.locator('#file-picker').setInputFiles(EPUB)
  await expect(page.locator('foliate-view')).toBeVisible()
  await page.getByRole('button', { name:'Aspecto de lectura' }).click()
  await page.getByRole('button', { name:'Noche', exact:true }).click()
  await page.getByRole('slider', { name:'Tamaño de letra', exact:true }).fill('24')
  await page.getByRole('combobox', { name:'Tipografía de lectura' }).selectOption('sans')
  await expect.poll(() => page.evaluate(() => {
    const doc = document.querySelector('foliate-view')?.renderer?.getContents()?.[0]?.doc
    return doc ? { size:doc.defaultView.getComputedStyle(doc.body).fontSize, color:doc.defaultView.getComputedStyle(doc.body).color } : null
  })).toEqual({ size:'24px',color:'rgb(212, 216, 204)' })
  await page.getByRole('button', { name:'Cerrar opciones de lectura' }).click()
  await page.locator('#reader-location').click()
  await page.getByRole('button', { name:'Beyond the window', exact:true }).click()
  await expect(page.locator('.reader-return')).toBeVisible()
  await expect.poll(() => page.evaluate(() => document.querySelector('foliate-view').renderer.getContents()[0]?.doc.querySelector('h1')?.textContent)).toBe('Beyond the window')
  await page.locator('.reader-return').click()
  await expect.poll(() => page.evaluate(() => document.querySelector('foliate-view').renderer.getContents()[0]?.doc.querySelector('h1')?.textContent)).toBe('The quiet room')
  await page.evaluate(() => document.querySelector('foliate-view').renderer.getContents()[0].doc.querySelector('a').click())
  await expect.poll(() => page.evaluate(() => document.querySelector('foliate-view').renderer.getContents()[0]?.doc.querySelector('h1')?.textContent)).toBe('Beyond the window')
  await expect(page.locator('.reader-return')).toBeVisible()
  await page.getByRole('button', { name:'Escuchar el libro' }).click()
  await page.getByRole('button', { name:'Reproducir',exact:true }).click()
  await expect.poll(() => page.evaluate(() => window.__epubSpeech.join(' '))).toMatch(/Beyond|Paragraph/)
  await page.getByRole('button', { name:'Detener',exact:true }).click()
  expect(errors).toEqual([])
})

test('voz Android: reproduce texto, pausa, continúa y pasa a la siguiente página', async ({ page }) => {
  await page.addInitScript(() => {
    window.__spoken = []; window.__stopped = 0
    window.InhouseSpeech = {
      getVoices:() => JSON.stringify([{name:'English device',voiceURI:'en-device',lang:'en-US'}]),
      speak:(text,language,rate,voice,id) => window.__spoken.push({text,language,rate,voice,id}),
      stop:() => { window.__stopped++ }
    }
  })
  await openPdf(page)
  await page.getByRole('button', { name:'Escuchar el libro' }).click()
  await page.getByRole('slider', { name:'Velocidad de voz' }).fill('1.3')
  await page.getByRole('combobox', { name:'Voz de lectura' }).selectOption('en-device')
  await page.getByRole('button', { name:'Reproducir', exact:true }).click()
  await expect.poll(() => page.evaluate(() => window.__spoken.length)).toBeGreaterThan(0)
  expect(await page.evaluate(() => window.__spoken[0])).toMatchObject({rate:1.3,voice:'en-device'})
  await page.getByRole('button', { name:'Pausar', exact:true }).click()
  await expect(page.getByRole('button', { name:'Continuar',exact:true })).toBeVisible()
  await page.getByRole('button', { name:'Continuar',exact:true }).click()
  for (let i=0;i<4;i++) {
    const count = await page.evaluate(() => window.__spoken.length)
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('inhouse-tts',{detail:{type:'done',id:window.__spoken.at(-1).id}})))
    await expect.poll(() => page.evaluate(() => window.__spoken.length)).toBeGreaterThan(count)
  }
  await expect(page.locator('#reader-location')).toHaveAttribute('aria-label', /Página 2 de 4/)
  await page.getByRole('button', { name:'Detener',exact:true }).click()
  await expect(page.getByRole('button', { name:'Reproducir',exact:true })).toBeVisible()
})

test('voz Android: lista agrupada de voces naturales, voz automática y descarga de mejores voces', async ({ page }) => {
  await page.addInitScript(() => {
    window.__spoken = []; window.__voiceSettings = 0
    const voice = (voiceURI, lang, quality, extra = {}) => ({ voiceURI, name:`${lang} ${voiceURI}`, lang, quality, latency:200, network:false, installed:true, features:[], ...extra })
    window.InhouseSpeech = {
      getVoices:() => JSON.stringify([voice('en-robot', 'en-US', 200, { name:'eSpeak' }), voice('en-normal', 'en-US', 300), voice('es-high', 'es-ES', 400)]),
      speak:(text, language, rate, voiceName, id) => window.__spoken.push({ text, language, rate, voiceName, id }),
      stop:() => {}, openVoiceSettings:() => { window.__voiceSettings++ }, refreshVoices:() => {}
    }
  })
  await openPdf(page)
  await page.getByRole('button', { name:'Escuchar el libro' }).click()
  const select = page.getByRole('combobox', { name:'Voz de lectura' })
  await expect(select.locator('optgroup')).toHaveCount(2)
  await expect(select.locator('optgroup[label="Recomendadas"] option')).toHaveCount(2)
  await expect(select.locator('optgroup[label="Todas las voces"] option')).toHaveCount(3)
  await expect(select.locator('option').first()).toHaveText('Automática')
  // The book (and the test browser) is English: its best on-device voice is only "normal", so Android offers better ones.
  await expect(page.locator('[data-voice-auto]')).toHaveText('Inglés (EE. UU.) · Calidad normal · sin conexión')
  await page.getByRole('button', { name:'Instalar voces' }).click()
  expect(await page.evaluate(() => window.__voiceSettings)).toBe(1)
  await page.getByRole('button', { name:'Reproducir', exact:true }).click()
  await expect.poll(() => page.evaluate(() => window.__spoken.length)).toBeGreaterThan(0)
  expect(await page.evaluate(() => window.__spoken[0])).toMatchObject({ voiceName:'en-normal', language:'en-US' })
})

test('la estantería dibuja madera y plantas 3D sin recursos rotos', async ({ page }) => {
  const brokenAssets = []
  page.on('response', response => { if (response.url().includes('/assets/') && response.status() >= 400) brokenAssets.push(response.url()) })
  page.on('requestfailed', request => { if (request.url().includes('/assets/')) brokenAssets.push(request.url()) })
  await page.goto(process.env.IHR_TEST_URL || '/')
  await expect(page.locator('.ihr-plant[data-object-id]')).toHaveCount(3)
  await expect(page.locator('.ihr-plant img, .ihr-plant--photo')).toHaveCount(0)
  for (const plant of await page.locator('.ihr-plant').all()) {
    await expect(plant).toHaveAttribute('data-plant-leaf-texture', 'procedural')
    await expect(plant).toHaveAttribute('data-plant-leaf-opacity', 'opaque')
    expect(Number(await plant.getAttribute('data-plant-model-depth'))).toBeGreaterThan(0)
  }
  const canvas = page.locator('.ihr-bookshelf-scene')
  await expect(canvas).toBeVisible()
  await expect(canvas).toHaveAttribute('data-active-plants', '3')
  await expect(canvas).toHaveAttribute('data-shadow-map-size', '1024')
  await expect(canvas).toHaveAttribute('data-furniture-meshes', '3')
  await expect.poll(() => canvas.evaluate(node => {
    const pixels = node.getContext('2d').getImageData(0,0,node.width,node.height).data
    return pixels.filter((value,index) => index % 4 === 3 && value > 200).length
  })).toBeGreaterThan(1000)
  await expect(page.locator('.ihr-shelf__board')).toHaveCount(3)
  expect(await page.locator('.ihr-shelf__board, .ihr-shelf__back').evaluateAll(nodes =>
    nodes.every(node => getComputedStyle(node).display === 'none')
  )).toBe(true)
  expect(await page.locator('.ihr-shelf__board').evaluateAll(boards =>
    boards.every(board => getComputedStyle(board).backgroundImage.includes('walnut-'))
  )).toBe(true)
  await page.screenshot({ path:'test-results/library-photo-mobile.png' })
  await page.evaluate(async () => {
    const db = await new Promise(resolve => {const request=indexedDB.open('inhouse-read');request.onsuccess=()=>resolve(request.result)})
    const tx=db.transaction('books','readwrite')
    const titles=['El jardín secreto','Una habitación propia','El principito','La vida de las plantas','Viaje al centro de la Tierra','El arte de la calma','Jane Eyre','Walden']
    const colors=['#456452','#b88a5b','#2d526b','#79815a','#7b4534','#c4a974','#49464e','#887861']
    titles.forEach((title,i)=>tx.objectStore('books').put({id:`visual-${i}`,title,format:'EPUB',sourceType:'local',spineColorOverride:colors[i],spineFontFamily:'Georgia',pageCount:150+i*44,sizeBytes:100000+i*20000,lastOpenedAt:Date.now()-i*10000,addedAt:Date.now(),progressFraction:i===0?.3:0}))
    await new Promise(resolve=>tx.oncomplete=resolve);db.close()
  })
  await page.reload(); await expect(page.locator('.ihr-spine').first()).toBeVisible()
  await page.screenshot({ path:'test-results/library-populated-mobile.png' })
  await page.setViewportSize({width:1280,height:900})
  await page.locator('#theme-toggle').click()
  await expect(page.locator('.ihr-spine').first()).toBeVisible()
  await page.screenshot({ path:'test-results/library-populated-desktop-dark.png' })
  expect(brokenAssets).toEqual([])
})
