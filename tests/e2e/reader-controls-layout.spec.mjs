import { test, expect } from '@playwright/test'
import { fakeEngineScript } from '../helpers/fake-neural-engine.js'
import fs from 'node:fs'

// Showing or hiding the reader controls (header with title/search/more/focus,
// bottom toolbar) must never move the text: the reader keeps the same margins in
// both states, so a book neither repaginates (same lines per page) nor refits.

test.use({viewport:{width:390,height:844},hasTouch:true,isMobile:true,deviceScaleFactor:2})

const fixture = format => `tests/e2e/fixtures/reading-journey.${format}`
const round = value => Math.round(value * 100) / 100
const box = rect => rect && ({x:round(rect.x),y:round(rect.y),width:round(rect.width),height:round(rect.height)})

async function open(page, format, preferences = {}) {
  await page.emulateMedia({reducedMotion:'reduce'})
  await page.addInitScript(fakeEngineScript({ installed:['piper:en_US-lessac-high'], hold:true }))
  await page.addInitScript(preferences => {
    if (!localStorage.getItem('inhouse-read-reading-preferences')) {
      localStorage.setItem('inhouse-read-reading-preferences', JSON.stringify(preferences))
    }
  }, preferences)
  await page.goto(process.env.IHR_TEST_URL || './')
  await page.locator('#file-picker').setInputFiles(fixture(format))
  const textPdf = format === 'pdf' && preferences.pdfMode === 'text'
  await expect(page.locator(format === 'epub' ? 'foliate-view' : textPdf ? '.pdf-reflow-page' : '.pdf-page-canvas')).toBeVisible()
  await expect(page.locator('#reader-top-title')).not.toContainText('Abriendo libro')
  if (format === 'epub') await expect.poll(() => page.evaluate(() => Boolean(document.querySelector('foliate-view').renderer?.getContents?.()[0]?.doc?.body?.textContent?.trim()))).toBe(true)
}

/** Everything that decides where the text sits, measured in page coordinates. */
async function measure(page) {
  const data = await page.evaluate(() => {
    const rect = element => {
      if (!element) return null
      const bounds = element.getBoundingClientRect()
      return {x:bounds.x,y:bounds.y,width:bounds.width,height:bounds.height}
    }
    // Distinct line tops of the text that is on the page right now, in page coordinates.
    const lines = (doc, inside, offset) => {
      const tops = []
      const walker = doc.createTreeWalker(doc.body,NodeFilter.SHOW_TEXT)
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (!node.textContent.trim()) continue
        const range = doc.createRange(); range.selectNodeContents(node)
        for (const r of range.getClientRects()) {
          if (!r.width || !r.height || !inside(r)) continue
          const top = r.top + offset.y, bottom = r.bottom + offset.y
          if (!tops.some(line => Math.abs(line.top - top) < 4)) tops.push({top,bottom})
        }
      }
      tops.sort((a,b) => a.top - b.top)
      return {count:tops.length,firstTop:tops[0]?.top ?? null,lastBottom:tops.at(-1)?.bottom ?? null}
    }
    const out = {
      viewport:rect(document.querySelector('#reader-viewport')),
      header:rect(document.querySelector('.app-header')),
      toolbar:rect(document.querySelector('#reader-toolbar'))
    }
    const view = document.querySelector('foliate-view')
    if (view?.renderer) {
      const renderer = view.renderer, content = renderer.getContents()[0]
      const frame = content.doc.defaultView.frameElement
      const frameBox = frame.getBoundingClientRect()
      const start = renderer.start, end = renderer.end, scrolled = renderer.scrolled
      out.epub = {size:renderer.size,viewSize:renderer.viewSize,pages:renderer.pages,scrolled,
        frame:{x:frameBox.x,y:frameBox.y,width:frameBox.width,height:frameBox.height},
        lines:lines(content.doc,r => scrolled ? r.bottom > start && r.top < end : r.left >= start - 1 && r.right <= end + 1,{x:0,y:frameBox.y})}
    }
    const wrap = document.querySelector('.pdf-page-wrap'), canvas = document.querySelector('.pdf-page-canvas')
    if (wrap && !wrap.hidden && wrap.getClientRects().length) out.pdf = {wrap:rect(wrap),canvas:rect(canvas),canvasStyle:`${canvas.style.width}x${canvas.style.height}`}
    const reflow = document.querySelector('.pdf-reflow-page')
    if (reflow && !reflow.hidden) {
      const bounds = reflow.getBoundingClientRect()
      out.reflow = {box:rect(reflow)}
      out.reflow.lines = (() => {
        const tops = [], walker = document.createTreeWalker(reflow,NodeFilter.SHOW_TEXT)
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          if (!node.textContent.trim()) continue
          const range = document.createRange(); range.selectNodeContents(node)
          for (const r of range.getClientRects()) {
            if (!r.width || !r.height || r.bottom <= bounds.top || r.top >= bounds.bottom) continue
            if (!tops.some(line => Math.abs(line.top - r.top) < 4)) tops.push({top:r.top,bottom:r.bottom})
          }
        }
        tops.sort((a,b) => a.top - b.top)
        return {count:tops.length,firstTop:tops[0]?.top ?? null,lastBottom:tops.at(-1)?.bottom ?? null}
      })()
    }
    return out
  })
  const clean = value => {
    if (Array.isArray(value)) return value.map(clean)
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key,item]) => [key,clean(item)]))
    return typeof value === 'number' ? round(value) : value
  }
  return clean(data)
}

const chromeHidden = page => page.evaluate(() => document.body.classList.contains('is-reader-focus'))

/** What is visible and what a finger could reach while the controls are shown or hidden. */
async function controlsState(page) {
  return page.evaluate(() => {
    const visible = element => {
      const style = getComputedStyle(element)
      return style.visibility !== 'hidden' && style.display !== 'none' && Number(style.opacity) > 0 && !element.closest('[inert]')
    }
    const reachable = element => {
      const bounds = element.getBoundingClientRect()
      const hit = document.elementFromPoint(bounds.x + bounds.width / 2,bounds.y + bounds.height / 2)
      return hit === element || element.contains(hit)
    }
    const buttons = ['#reader-back','#reader-search-shortcut','#reader-focus','#reader-more-shortcut','#reader-prev','#reader-location','#reader-next','#reader-save-bookmark','#reader-settings','#reader-audio']
    return Object.fromEntries(buttons.map(selector => {
      const element = document.querySelector(selector)
      return [selector,{visible:visible(element),reachable:reachable(element),
        focusable:visible(element) && !element.disabled && element.tabIndex >= 0}]
    }))
  })
}

async function expectControls(page, shown) {
  const state = await controlsState(page)
  for (const [selector,item] of Object.entries(state)) {
    expect(item.visible,`${selector} visible`).toBe(shown)
    expect(item.reachable,`${selector} reachable by a finger`).toBe(shown)
    expect(item.focusable,`${selector} focusable`).toBe(shown)
  }
  // The bars themselves stay as blank margins; what Playwright (and a screen reader) sees is their contents.
  await expect(page.locator('#reader-settings')).toBeVisible({visible:shown})
  await expect(page.locator('#reader-focus')).toBeVisible({visible:shown})
  await expect(page.locator('#reader-top-title')).toBeVisible({visible:shown})
}

/** Waits until the layout has been still for a while, after the controls changed. */
async function settled(page) {
  let last = '', stable = 0
  for (let i = 0; i < 80 && stable < 4; i++) {
    await page.waitForTimeout(120)
    const now = JSON.stringify(await measure(page))
    stable = now === last ? stable + 1 : 0
    last = now
  }
  return measure(page)
}

const centre = async page => {
  const bounds = await page.locator('#reader-viewport').boundingBox()
  return {x:bounds.x + bounds.width * .5,y:bounds.y + bounds.height * .55}
}
const methods = {
  async tapHide(page) { const {x,y} = await centre(page); await page.touchscreen.tap(x,y) },
  async tapShow(page) { const {x,y} = await centre(page); await page.touchscreen.tap(x,y) },
  async buttonHide(page) { await page.locator('#reader-focus').click() },
  async escapeShow(page) { await page.keyboard.press('Escape') }
}

const cases = [
  {name:'EPUB paginado',format:'epub',preferences:{}},
  {name:'EPUB en desplazamiento',format:'epub',preferences:{flow:'scrolled'}},
  {name:'PDF ajustado',format:'pdf',preferences:{pdfMode:'original'}},
  {name:'PDF reflujo',format:'pdf',preferences:{pdfMode:'text'}},
  // A wide screen makes the PDF fit by height, which is what a taller viewport used to rescale.
  {name:'PDF ajustado horizontal',format:'pdf',preferences:{pdfMode:'original'},size:{width:844,height:390}},
  {name:'EPUB escritorio',format:'epub',preferences:{},size:{width:1280,height:800}}
]

for (const item of cases) test(`mostrar u ocultar los controles no mueve el texto: ${item.name}`, async ({page}) => {
  test.setTimeout(240_000)
  const errors = []; page.on('pageerror',error => errors.push(error.message))
  if (item.size) await page.setViewportSize(item.size)
  await open(page,item.format,item.preferences)
  await expectControls(page,true)
  const shown = await settled(page)
  console.log(`[controls] ${item.name} SHOWN`,JSON.stringify(shown))
  expect(shown.viewport.height).toBeGreaterThan(200)

  const hideShow = async (hide, show, label) => {
    await hide(page)
    await expect.poll(() => chromeHidden(page)).toBe(true)
    const hidden = await settled(page)
    console.log(`[controls] ${item.name} HIDDEN via ${label}`,JSON.stringify(hidden))
    expect(hidden,`${label}: the page must be identical with the controls hidden`).toEqual(shown)
    await expectControls(page,false)
    await show(page)
    await expect.poll(() => chromeHidden(page)).toBe(false)
    const again = await settled(page)
    expect(again,`${label}: and identical again once they are back`).toEqual(shown)
    await expectControls(page,true)
  }
  await hideShow(methods.tapHide,methods.tapShow,'the centre tap')
  await hideShow(methods.buttonHide,methods.escapeShow,'the Ocultar controles button and Escape')
  await hideShow(methods.buttonHide,methods.tapShow,'the button and a centre tap')
  expect(errors).toEqual([])
})

test('con los controles ocultos los márgenes siguen recibiendo toques: zonas y centro', async ({page}) => {
  test.setTimeout(240_000)
  await open(page,'epub',{})
  const position = () => page.evaluate(() => document.querySelector('foliate-view').renderer.containerPosition)
  const size = () => page.evaluate(() => document.querySelector('foliate-view').renderer.size)
  const reach = target => expect.poll(async () => Math.abs(await position() - target) <= 1,{timeout:60_000}).toBe(true)
  const viewport = await page.locator('#reader-viewport').boundingBox()
  const first = await position(), step = await size()
  const audio = page.locator('#reader-audio'), audioBox = await audio.boundingBox()
  const toolbar = await page.locator('#reader-toolbar').boundingBox()
  await page.touchscreen.tap(viewport.x + viewport.width * .5,viewport.y + viewport.height * .5)
  await expect.poll(() => chromeHidden(page)).toBe(true)
  // The strip where the hidden toolbar lives turns pages by zone, like the text area does...
  await page.touchscreen.tap(audioBox.x + audioBox.width / 2,audioBox.y + audioBox.height / 2)
  await reach(first + step)
  // ...without ever pressing the invisible button that sits there (it opens the audio panel).
  await expect(page.locator('.reading-panel')).not.toHaveAttribute('open','')
  expect(await page.evaluate(() => document.querySelector('.reading-panel').open)).toBe(false)
  await page.touchscreen.tap(toolbar.x + toolbar.width * .1,toolbar.y + toolbar.height / 2)
  await reach(first)
  // The strip under the header does the same, and its centre brings the controls back.
  const header = await page.locator('.app-header').boundingBox()
  await page.touchscreen.tap(header.x + header.width * .9,header.y + header.height / 2)
  await reach(first + step)
  await page.touchscreen.tap(header.x + header.width * .5,header.y + header.height / 2)
  await expect.poll(() => chromeHidden(page)).toBe(false)
  await expectControls(page,true)
  expect(await position()).toBe(first + step)
})

test('el audio activo y el aviso de retorno no se mueven al ocultar los controles', async ({page}) => {
  test.setTimeout(240_000)
  await open(page,'epub',{})
  await page.evaluate(() => {
    // The mini player and the return banner are laid out from the same variables.
    for (const selector of ['.reading-mini-player','.reader-return']) {
      const element = document.querySelector(selector)
      element.hidden = false
      element.style.minHeight = '44px'
    }
    const screen = document.querySelector('#reader-screen')
    screen.style.setProperty('--reader-audio-height','48px')
    screen.style.setProperty('--reader-return-height','44px')
  })
  const read = () => page.evaluate(() => Object.fromEntries(['#reader-viewport','.reading-mini-player','.reader-return'].map(selector => {
    const bounds = document.querySelector(selector).getBoundingClientRect()
    return [selector,[bounds.x,bounds.y,bounds.width,bounds.height].map(value => Math.round(value * 100) / 100)]
  })))
  await page.waitForTimeout(600)
  const before = await read()
  await page.locator('#reader-focus').click()
  await expect.poll(() => chromeHidden(page)).toBe(true)
  await page.waitForTimeout(400)
  expect(await read()).toEqual(before)
  await page.keyboard.press('Escape')
  await expect.poll(() => chromeHidden(page)).toBe(false)
  expect(await read()).toEqual(before)
})

test('modo infantil: tampoco cambia la página al ocultar la cabecera', async ({page}) => {
  test.setTimeout(240_000)
  await open(page,'epub',{})
  await page.evaluate(() => document.querySelector('#reader-screen').classList.add('reader-kids-mode'))
  const shown = await settled(page)
  await page.locator('#reader-viewport').click({position:{x:195,y:400}})
  await expect.poll(() => chromeHidden(page)).toBe(true)
  expect(await settled(page)).toEqual(shown)
  await page.keyboard.press('Escape')
  await expect.poll(() => chromeHidden(page)).toBe(false)
  expect(await settled(page)).toEqual(shown)
})

const evidenceDir = process.env.IHR_CONTROLS_EVIDENCE_DIR
test('safe-area y panel abierto conservan la caja; ocultar retira los controles inmediatamente', async ({page, context}) => {
  test.setTimeout(120_000)
  const client = await context.newCDPSession(page)
  await client.send('Emulation.setSafeAreaInsetsOverride', {insets:{top:24,bottom:20,left:0,right:0}})
  await open(page,'epub',{})
  await page.emulateMedia({reducedMotion:'no-preference'})
  const shown = await settled(page)
  expect(shown.header.height).toBe(72)
  expect(shown.toolbar.height).toBe(68)
  await page.getByRole('button',{name:'Aspecto de lectura'}).click()
  await expect(page.locator('.reading-panel')).toBeVisible()
  expect(await measure(page)).toEqual(shown)
  // Programmatic activation keeps the dialog open so its layout is also covered.
  await page.locator('#reader-focus').evaluate(button => button.click())
  await expect(page.getByRole('button',{name:'Aspecto de lectura'})).toHaveCount(0)
  expect(await measure(page)).toEqual(shown)
  await page.getByRole('button',{name:'Cerrar opciones de lectura'}).click()
  await page.keyboard.press('Escape')
  expect(await settled(page)).toEqual(shown)
  await expectControls(page,true)
})

test.describe('evidence screenshots', () => {
  test.skip(!evidenceDir,'set IHR_CONTROLS_EVIDENCE_DIR to write the before/after screenshots')
  for (const size of [{width:390,height:844,tag:'mobile'},{width:1280,height:800,tag:'desktop'}])
    for (const theme of ['paper','night','sepia']) test(`screenshots ${size.tag} ${theme}`, async ({page}) => {
      test.setTimeout(240_000)
      fs.mkdirSync(evidenceDir,{recursive:true})
      await page.setViewportSize({width:size.width,height:size.height})
      await open(page,'epub',{theme})
      await settled(page)
      await page.screenshot({path:`${evidenceDir}/${size.tag}-${theme}-shown.png`})
      const {x,y} = await centre(page)
      await page.touchscreen.tap(x,y)
      await expect.poll(() => chromeHidden(page)).toBe(true)
      await settled(page)
      await page.screenshot({path:`${evidenceDir}/${size.tag}-${theme}-hidden.png`})
    })
})
