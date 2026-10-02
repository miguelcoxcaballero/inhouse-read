import { test, expect } from '@playwright/test'

const fixture = format => `tests/e2e/fixtures/reading-journey.${format}`
const ink = 'rgb(198, 198, 198)'
const black = 'rgb(0, 0, 0)'

function quotePdf(text) {
  // Keep every glyph inside the PDF media box; text mode then renders the long
  // URL at the user's normal reading size instead of its tiny print size.
  const stream = `BT /F1 2 Tf 24 550 Td (${text}) Tj ET`
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [4 0 R] /Count 1 >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 600] /Resources << /Font << /F1 3 0 R >> >> /Contents 5 0 R >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`
  ]
  let source = '%PDF-1.4\n', offsets = []
  for (let i = 0; i < objects.length; i++) {
    offsets.push(Buffer.byteLength(source))
    source += `${i+1} 0 obj\n${objects[i]}\nendobj\n`
  }
  const xref = Buffer.byteLength(source)
  source += `xref\n0 6\n0000000000 65535 f \n${offsets.map(offset => `${String(offset).padStart(10,'0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(source)
}

async function prepare(page, size, preferences = {}) {
  await page.setViewportSize(size)
  await page.emulateMedia({ reducedMotion:'reduce' })
  await page.addInitScript(preferences => {
    if (!localStorage.getItem('inhouse-read-reading-preferences')) {
      localStorage.setItem('inhouse-read-reading-preferences', JSON.stringify(preferences))
    }
    window.InhouseSpeech = { getVoices:() => '[]', stop:() => {}, speak:() => {} }
  }, preferences)
  await page.goto(process.env.IHR_TEST_URL || './')
}

async function open(page, format) {
  await page.locator('#file-picker').setInputFiles(fixture(format))
  await expect(page.locator(format === 'epub' ? 'foliate-view' : '.pdf-reflow-page')).toBeVisible()
  await expect(page.locator('#reader-top-title')).not.toContainText('Abriendo libro')
}

async function layout(page) {
  return page.evaluate(() => {
    const rect = element => {
      const bounds = element.getBoundingClientRect()
      return { x:bounds.x, y:bounds.y, width:bounds.width, height:bounds.height,
        right:bounds.right, bottom:bounds.bottom }
    }
    const header = document.querySelector('.app-header')
    const toolbar = document.querySelector('#reader-toolbar')
    const viewport = document.querySelector('#reader-viewport')
    const buttons = [...toolbar.querySelectorAll('button')].filter(button =>
      getComputedStyle(button).display !== 'none').map(rect)
    const view = document.querySelector('foliate-view')
    const container = view?.renderer?.shadowRoot?.querySelector('#container')
    const text = document.querySelector('.pdf-reflow-page')
    const textStyle = text && getComputedStyle(text)
    return { width:innerWidth, height:innerHeight, header:rect(header), toolbar:rect(toolbar),
      viewport:rect(viewport), buttons, toolbarOverflow:toolbar.scrollWidth > toolbar.clientWidth,
      documentOverflow:document.documentElement.scrollWidth > innerWidth,
      epubContainer:container && rect(container),
      textPadding:textStyle && {top:parseFloat(textStyle.paddingTop),bottom:parseFloat(textStyle.paddingBottom)} }
  })
}

async function expectUsefulPage(page) {
  await expect.poll(async () => {
    const current = await layout(page)
    return Math.abs(current.viewport.y - current.header.bottom)
  }).toBeLessThanOrEqual(1)
  const current = await layout(page)
  expect(current.header.height).toBeLessThanOrEqual(50)
  expect(current.toolbar.height).toBeLessThanOrEqual(50)
  expect(current.viewport.height).toBeGreaterThanOrEqual(current.height - 100)
  expect(Math.abs(current.viewport.bottom - current.toolbar.y)).toBeLessThanOrEqual(1)
  expect(current.toolbarOverflow).toBe(false)
  expect(current.documentOverflow).toBe(false)
  for (let i = 0; i < current.buttons.length; i++) {
    const button = current.buttons[i]
    expect(button.width).toBeGreaterThanOrEqual(40)
    expect(button.x).toBeGreaterThanOrEqual(0)
    expect(button.right).toBeLessThanOrEqual(current.width)
    if (i > 0) expect(button.x).toBeGreaterThanOrEqual(current.buttons[i-1].right - .1)
  }
  if (current.textPadding) {
    expect(current.textPadding.top).toBeLessThanOrEqual(20)
    expect(current.textPadding.bottom).toBeLessThanOrEqual(20)
  }
  if (current.epubContainer) {
    expect(current.epubContainer.y - current.viewport.y).toBeLessThanOrEqual(20)
    expect(current.viewport.bottom - current.epubContainer.bottom).toBeLessThanOrEqual(20)
    expect(current.epubContainer.height).toBeGreaterThanOrEqual(current.viewport.height - 40)
  }
}

for (const item of [
  {name:'PDF compacto',format:'pdf',size:{width:320,height:568}},
  {name:'EPUB móvil',format:'epub',size:{width:390,height:844}},
  {name:'PDF horizontal',format:'pdf',size:{width:844,height:390}},
  {name:'EPUB escritorio',format:'epub',size:{width:1280,height:800}}
]) test(`página proporcionada y controles sin solapamiento: ${item.name}`, async ({page}) => {
  test.setTimeout(90_000)
  const errors = []; page.on('pageerror',error => errors.push(error.message))
  await prepare(page,item.size,{pdfMode:'text'})
  await open(page,item.format)
  await expectUsefulPage(page)
  await page.screenshot({path:`test-results/reader-layout-${item.format}-${item.size.width}.png`})
  await page.getByRole('button',{name:'Aspecto de lectura'}).click()
  const panel = page.locator('.reading-panel')
  await expect(panel).toBeVisible()
  const bounds = await panel.boundingBox()
  expect(bounds.x).toBeGreaterThanOrEqual(0)
  expect(bounds.y).toBeGreaterThanOrEqual(0)
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(item.size.width)
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(item.size.height)
  expect(await panel.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
  await page.getByRole('button',{name:'Cerrar opciones de lectura'}).click()
  await page.getByRole('button',{name:'Escuchar el libro'}).click()
  await page.getByRole('button',{name:'Reproducir',exact:true}).click()
  await page.getByRole('button',{name:'Cerrar opciones de lectura'}).click()
  const mini = page.locator('.reading-mini-player')
  await expect(mini).toBeVisible()
  await expect.poll(async () => {
    const view = await page.locator('#reader-viewport').boundingBox()
    const audio = await mini.boundingBox()
    return Math.abs(view.y + view.height - audio.y)
  }).toBeLessThanOrEqual(1)
  const audio = await mini.boundingBox(), toolbar = await page.locator('#reader-toolbar').boundingBox()
  expect(audio.y + audio.height).toBeLessThanOrEqual(toolbar.y + 1)
  expect(await mini.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
  await page.screenshot({path:`test-results/reader-layout-audio-${item.format}-${item.size.width}.png`})
  await page.getByRole('button',{name:'Detener lectura',exact:true}).click()
  await expectUsefulPage(page)
  // Hiding the controls keeps their margins: the page box must not grow (reader-controls-layout.spec.mjs
  // measures the text itself). Only the buttons disappear; the bars stay as blank page margins.
  const pageBox = await page.locator('#reader-viewport').boundingBox()
  await page.locator('#reader-focus').click()
  await expect(page.locator('#reader-prev')).toBeHidden()
  await expect(page.locator('#reader-settings')).toBeHidden()
  await expect(page.locator('#reader-focus')).toBeHidden()
  expect(await page.locator('#reader-viewport').boundingBox()).toEqual(pageBox)
  await page.locator('#reader-viewport').click({position:{x:item.size.width/2,y:item.size.height/2}})
  await expect(page.locator('#reader-focus')).toBeVisible()
  await expectUsefulPage(page)
  await page.locator('#reader-focus').click()
  await expect(page.locator('#reader-prev')).toBeHidden()
  await page.keyboard.press('Escape')
  await expect(page.locator('#reader-focus')).toBeVisible()
  await expectUsefulPage(page)
  await page.setViewportSize({width:844,height:390})
  await expectUsefulPage(page)
  if (item.name === 'PDF compacto') {
    // A real document supplies this unbroken URL. Saving its actual selection
    // checks the quote row's flex wrapping, not just a handcrafted DOM label.
    const quote = 'https://inhouse.example/' + 'abcdefghijklmnopqrstuvwxyz0123456789'.repeat(8)
    await page.getByRole('button',{name:'Volver a la estantería'}).click()
    await page.setViewportSize(item.size)
    await page.locator('#file-picker').setInputFiles({name:'Cita larga.pdf',mimeType:'application/pdf',buffer:quotePdf(quote)})
    await expect(page.locator('.pdf-reflow-page')).toContainText(quote)
    await page.evaluate(() => {
      const text = document.querySelector('.pdf-reflow-page')
      const range = document.createRange(); range.selectNodeContents(text)
      const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range)
    })
    await page.locator('#reader-location').click()
    await page.getByRole('tab',{name:'Citas'}).click()
    await page.getByRole('button',{name:'Guardar cita'}).click()
    await expect(page.locator('[data-quotes]')).toContainText(quote)
    expect(await panel.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
    const citation = await page.locator('[data-quotes] .reading-place button').first().boundingBox()
    const sheet = await panel.boundingBox()
    expect(citation.x + citation.width).toBeLessThanOrEqual(sheet.x + sheet.width)
    await page.screenshot({path:'test-results/reader-long-quote-compact.png'})
  }
  expect(errors).toEqual([])
})

async function expectAmoled(page) {
  await expect(page.locator('#reader-screen')).toHaveAttribute('data-reading-theme','amoled')
  await expect(page.locator('#reader-viewport')).toHaveCSS('background-color',black)
  await expect(page.locator('.app-header')).toHaveCSS('background-color',black)
  await expect(page.locator('#reader-toolbar')).toHaveCSS('background-color',black)
  await expect(page.locator('#reader-screen')).toHaveCSS('color',ink)
}

async function expectReturnOutsidePage(page) {
  const back = page.locator('.reader-return')
  await expect(back).toBeVisible()
  await expect.poll(async () => {
    const viewport = await page.locator('#reader-viewport').boundingBox()
    const button = await back.boundingBox()
    return viewport.y + viewport.height - button.y
  }).toBeLessThanOrEqual(1)
  const button = await back.boundingBox()
  const lower = await page.locator('.reading-mini-player').isVisible()
    ? await page.locator('.reading-mini-player').boundingBox()
    : await page.locator('#reader-toolbar').boundingBox()
  expect(button.y + button.height).toBeLessThanOrEqual(lower.y + 1)
  const text = await back.evaluate(element => {
    const range = document.createRange(); range.selectNodeContents(element)
    const rect = range.getBoundingClientRect()
    return {top:rect.top,bottom:rect.bottom}
  })
  expect(text.top).toBeGreaterThanOrEqual(button.y)
  expect(text.bottom).toBeLessThanOrEqual(button.y + button.height)
  expect(text.bottom).toBeLessThanOrEqual(lower.y)
}

test('AMOLED real en PDF original y adaptable, guardado al reabrir', async ({page}) => {
  test.setTimeout(90_000)
  await prepare(page,{width:390,height:844})
  await page.locator('#file-picker').setInputFiles(fixture('pdf'))
  await expect(page.locator('.pdf-page-canvas')).toBeVisible()
  await page.getByRole('button',{name:'Aspecto de lectura'}).click()
  await page.getByRole('button',{name:'AMOLED',exact:true}).click()
  await expect(page.locator('.reading-panel')).toHaveCSS('background-color',black)
  await page.getByRole('button',{name:'Cerrar opciones de lectura'}).click()
  await expectAmoled(page)
  // Sample the composited screen, including the PDF's CSS filter. Reading the
  // source canvas alone would miss the actual white page shown to the user.
  const canvas = await page.locator('.pdf-page-canvas').boundingBox()
  const screenshot = await page.screenshot()
  const rendered = await page.evaluate(async ({image,x,y,region}) => {
    const source = new Image(); source.src = image; await source.decode()
    const output = document.createElement('canvas'); output.width = source.width; output.height = source.height
    const context = output.getContext('2d'); context.drawImage(source,0,0)
    const pixels = context.getImageData(region.x,region.y,region.width,region.height).data
    let brightest = 0
    for (let i = 0; i < pixels.length; i += 4) brightest = Math.max(brightest,pixels[i],pixels[i+1],pixels[i+2])
    return {paper:[...context.getImageData(x,y,1,1).data].slice(0,3),brightest}
  },{image:`data:image/png;base64,${screenshot.toString('base64')}`,x:Math.round(canvas.x+canvas.width/2),y:Math.round(canvas.y+canvas.height/2),
    region:{x:Math.ceil(canvas.x),y:Math.ceil(canvas.y),width:Math.floor(canvas.width),height:Math.floor(Math.min(canvas.height,400))}})
  expect(rendered.paper).toEqual([0,0,0])
  expect(rendered.brightest).toBeGreaterThanOrEqual(185)
  expect(rendered.brightest).toBeLessThanOrEqual(200)
  await page.getByRole('button',{name:'Aspecto de lectura'}).click()
  await page.getByRole('combobox',{name:'Vista del PDF'}).selectOption('text')
  await page.getByRole('button',{name:'Cerrar opciones de lectura'}).click()
  await expect(page.locator('.pdf-reflow-page')).toHaveCSS('background-color',black)
  await expect(page.locator('.pdf-reflow-page')).toHaveCSS('color',ink)
  await page.getByRole('button',{name:'Página siguiente',exact:true}).click()
  await expect(page.locator('#reader-location')).toHaveAttribute('aria-label',/Página 2 de 4/)
  await page.getByRole('button',{name:'Volver a la estantería'}).click()
  await page.reload()
  await page.locator('.ihr-spine').first().click()
  await page.locator('.ihr-flyout__cover-target').click()
  await expect(page.locator('.ihr-flyout')).toHaveCount(0)
  await expectAmoled(page)
  await expect(page.locator('.pdf-reflow-page')).toHaveCSS('color',ink)
  await expect(page.locator('#reader-location')).toHaveAttribute('aria-label',/Página 2 de 4/)
  await page.screenshot({path:'test-results/reader-amoled-pdf.png'})
})

test('AMOLED en texto EPUB, navegación y audio sin superficies claras', async ({page}) => {
  test.setTimeout(90_000)
  await prepare(page,{width:390,height:844})
  await open(page,'epub')
  await page.getByRole('button',{name:'Aspecto de lectura'}).click()
  await page.getByRole('button',{name:'AMOLED',exact:true}).click()
  await page.getByRole('button',{name:'Cerrar opciones de lectura'}).click()
  await expectAmoled(page)
  await expect.poll(() => page.evaluate(() => {
    const doc = document.querySelector('foliate-view')?.renderer?.getContents()?.[0]?.doc
    if (!doc) return null
    const style = element => doc.defaultView.getComputedStyle(element)
    return {body:style(doc.body).backgroundColor,text:style(doc.querySelector('p')).color}
  })).toEqual({body:black,text:ink})
  await page.locator('#reader-location').click()
  await page.getByRole('button',{name:'Beyond the window',exact:true}).click()
  await expect.poll(() => page.evaluate(() => document.querySelector('foliate-view')?.renderer?.getContents()?.[0]?.doc.querySelector('h1')?.textContent)).toBe('Beyond the window')
  await expectAmoled(page)
  await expectReturnOutsidePage(page)
  await page.getByRole('button',{name:'Escuchar el libro'}).click()
  await expect(page.locator('.reading-panel')).toHaveCSS('background-color',black)
  await page.getByRole('button',{name:'Reproducir',exact:true}).click()
  await page.getByRole('button',{name:'Cerrar opciones de lectura'}).click()
  await expect(page.locator('.reading-mini-player')).toHaveCSS('background-color',black)
  await expect(page.locator('.reading-mini-player')).toHaveCSS('color',ink)
  await expectReturnOutsidePage(page)
  await page.setViewportSize({width:844,height:390})
  await expectAmoled(page)
  await expectReturnOutsidePage(page)
  await page.screenshot({path:'test-results/reader-amoled-epub-landscape.png'})
})
