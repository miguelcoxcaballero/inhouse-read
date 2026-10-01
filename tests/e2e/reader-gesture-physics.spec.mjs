import { test, expect } from '@playwright/test'

test.use({viewport:{width:390,height:844},hasTouch:true,isMobile:true,deviceScaleFactor:2})
const point = (x,y) => ({id:1,x,y})
async function drag(cdp,x,y,dx,dy = 0) {
  const stamp = Date.now() / 1000
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',timestamp:stamp,touchPoints:[point(x,y)]})
  for (let i = 1; i <= 4; i++) {
    await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',timestamp:stamp+i*.032,touchPoints:[point(x+dx*i/4,y+dy*i/4)]})
  }
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',timestamp:stamp+.16,touchPoints:[]})
}
async function open(page, format, reducedMotion = 'no-preference') {
  await page.emulateMedia({reducedMotion})
  await page.goto(process.env.IHR_TEST_URL || './')
  await page.locator('#file-picker').setInputFiles(`tests/e2e/fixtures/reading-journey.${format}`)
  await expect(page.locator(format === 'pdf' ? '.pdf-page-canvas' : 'foliate-view')).toBeVisible()
  await expect(page.locator('#reader-top-title')).not.toContainText('Abriendo libro')
}

test('PDF: double tap keeps its page, native zoom pan does not navigate, and swipes settle', async ({page}) => {
  test.setTimeout(90_000)
  const errors = [];page.on('pageerror',error => errors.push(error.message))
  await open(page,'pdf')
  const viewport = page.locator('#reader-viewport'), canvas = page.locator('.pdf-page-canvas')
  const initialWidth = await canvas.evaluate(node => parseFloat(node.style.width))
  const bounds = await viewport.boundingBox(), x = bounds.x+bounds.width*.78, y = bounds.y+bounds.height*.55
  await page.touchscreen.tap(x,y)
  await page.touchscreen.tap(x,y)
  await expect(viewport).toHaveAttribute('data-reader-zoomed','true')
  await expect.poll(() => canvas.evaluate(node => parseFloat(node.style.width))).toBeCloseTo(initialWidth*2.2,0)
  await expect(page.locator('#reader-location')).toHaveAttribute('aria-label',/Página 1 de 4/)
  expect(await viewport.evaluate(node => getComputedStyle(node).touchAction)).toBe('pan-x pan-y')
  const cdp = await page.context().newCDPSession(page)
  await viewport.evaluate(node => {node.scrollLeft = 80;node.scrollTop = 60})
  await drag(cdp,bounds.x+bounds.width*.65,y,-80)
  await expect.poll(() => viewport.evaluate(node => node.scrollLeft)).toBeGreaterThan(100)
  await expect(page.locator('#reader-location')).toHaveAttribute('aria-label',/Página 1 de 4/)
  // Both edges of the enlarged sheet remain reachable, with no negative flex overflow.
  await viewport.evaluate(node => {node.scrollLeft = 0})
  expect(await canvas.evaluate(node => node.getBoundingClientRect().left)).toBeGreaterThanOrEqual(bounds.x-1)
  await page.touchscreen.tap(x,y)
  await page.touchscreen.tap(x,y)
  await expect(viewport).toHaveAttribute('data-reader-zoomed','false')
  await expect.poll(() => canvas.evaluate(node => parseFloat(node.style.width))).toBeCloseTo(initialWidth,0)
  await drag(cdp,bounds.x+bounds.width*.8,y,-150)
  await expect(page.locator('#reader-location')).toHaveAttribute('aria-label',/Página 2 de 4/)
  await expect.poll(() => page.locator('.pdf-page-wrap').evaluate(node => node.style.transform)).toBe('')
  expect(errors).toEqual([])
})

test('EPUB: native touch drag advances once and enables smooth snapping', async ({page}) => {
  test.setTimeout(90_000)
  await page.addInitScript(() => {
    window.__readerVoiceStops = 0
    window.InhouseSpeech = {getVoices:() => '[]',speak:() => {},stop:() => {window.__readerVoiceStops++}}
  })
  await open(page,'epub')
  await expect.poll(() => page.evaluate(() => document.querySelector('foliate-view').renderer.hasAttribute('animated'))).toBe(true)
  const initial = await page.evaluate(() => {
    const view = document.querySelector('foliate-view'), renderer = view.renderer
    window.__readerNextCalls = 0
    const originalNext = view.next.bind(view)
    view.next = (...args) => {window.__readerNextCalls++;return originalNext(...args)}
    window.__readerVoiceStopsBeforeDrag = window.__readerVoiceStops
    return renderer.containerPosition
  })
  const bounds = await page.locator('#reader-viewport').boundingBox(), cdp = await page.context().newCDPSession(page)
  await drag(cdp,bounds.x+bounds.width*.8,bounds.y+bounds.height*.55,-180)
  await expect.poll(() => page.evaluate(() => document.querySelector('foliate-view').renderer.containerPosition)).toBeGreaterThan(initial+50)
  expect(await page.evaluate(() => window.__readerNextCalls)).toBe(0)
  expect(await page.evaluate(() => window.__readerVoiceStops-window.__readerVoiceStopsBeforeDrag)).toBe(1)
})

test('EPUB: reduced motion retains direct page navigation without animated snapping', async ({page}) => {
  await open(page,'epub','reduce')
  expect(await page.evaluate(() => document.querySelector('foliate-view').renderer.hasAttribute('animated'))).toBe(false)
  const initial = await page.evaluate(() => document.querySelector('foliate-view').renderer.containerPosition)
  await page.getByRole('button',{name:'Página siguiente',exact:true}).click()
  await expect.poll(() => page.evaluate(() => document.querySelector('foliate-view').renderer.containerPosition)).toBeGreaterThan(initial+50)
})

test('EPUB: tapping the side edges turns pages and the centre toggles the controls', async ({page}) => {
  test.setTimeout(90_000)
  await open(page,'epub','reduce')
  const position = () => page.evaluate(() => document.querySelector('foliate-view').renderer.containerPosition)
  const chromeHidden = () => page.evaluate(() => document.body.classList.contains('is-reader-focus'))
  // Hiding the controls resizes the page, so count navigations instead of comparing offsets.
  await page.evaluate(() => {
    const view = document.querySelector('foliate-view')
    window.__tapTurns = 0
    for (const name of ['next','prev']) {
      const original = view[name].bind(view)
      view[name] = (...args) => {window.__tapTurns++;return original(...args)}
    }
  })
  const turns = () => page.evaluate(() => window.__tapTurns)
  const bounds = await page.locator('#reader-viewport').boundingBox(), y = bounds.y + bounds.height * .55
  const tap = fraction => page.touchscreen.tap(bounds.x + bounds.width * fraction, y)
  const first = await position()
  await tap(.9)
  await expect.poll(position).toBeGreaterThan(first + 50)
  const second = await position()
  await tap(.9)
  await expect.poll(position).toBeGreaterThan(second + 50)
  const third = await position()
  // The left edge must go BACK, not forward as when zones were measured on the wide chapter document.
  await tap(.1)
  await expect.poll(position).toBeLessThan(third - 50)
  const before = await turns()
  expect(await chromeHidden()).toBe(false)
  await tap(.5)
  await expect.poll(chromeHidden).toBe(true)
  await tap(.5)
  await expect.poll(chromeHidden).toBe(false)
  expect(await turns()).toBe(before)
})
