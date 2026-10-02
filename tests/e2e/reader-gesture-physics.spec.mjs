import { test, expect } from '@playwright/test'
import { fakeEngineScript } from '../helpers/fake-neural-engine.js'

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
  // Side edges turn pages at once, so the double tap that zooms happens in the centre.
  const bounds = await viewport.boundingBox(), x = bounds.x+bounds.width*.5, y = bounds.y+bounds.height*.55
  await page.touchscreen.tap(x,y)
  await page.touchscreen.tap(x,y)
  await expect(viewport).toHaveAttribute('data-reader-zoomed','true')
  await expect.poll(() => canvas.evaluate(node => parseFloat(node.style.width))).toBeCloseTo(initialWidth*2.2,0)
  await expect(page.locator('#reader-location')).toHaveAttribute('aria-label',/Página 1 de 4/)
  expect(await viewport.evaluate(node => getComputedStyle(node).touchAction)).toBe('pan-x pan-y')
  const cdp = await page.context().newCDPSession(page)
  await viewport.evaluate(node => {node.scrollLeft = 80;node.scrollTop = 60})
  await viewport.evaluate(node => new Promise(resolve => {
    // Flush the initial instant scroll before observing the touch pan's end.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      window.__pdfPanEnded = false
      const onEnd = () => {window.__pdfPanEnded = true}
      node.addEventListener('scrollend', onEnd, {once:true})
      window.__stopPdfPanObservation = () => node.removeEventListener('scrollend', onEnd)
      resolve()
    }))
  }))
  await drag(cdp,bounds.x+bounds.width*.65,y,-80)
  await expect.poll(() => viewport.evaluate(node => node.scrollLeft)).toBeGreaterThan(100)
  await expect(page.locator('#reader-location')).toHaveAttribute('aria-label',/Página 1 de 4/)
  // A native touch fling continues after touchend. Resetting during it samples
  // a moving sheet: CI saw 0 -> 5/14px of scroll, not negative flex overflow.
  const panSettlement = await viewport.evaluate(node => new Promise((resolve,reject) => {
    const started = performance.now()
    let left = node.scrollLeft, top = node.scrollTop, stable = 0
    const check = () => {
      const nextLeft = node.scrollLeft, nextTop = node.scrollTop
      stable = nextLeft === left && nextTop === top ? stable + 1 : 0
      left = nextLeft;top = nextTop
      // CDP touch flings on some Chromium builds omit scrollend. In that case
      // require twelve unchanged frames instead of treating touchend as rest.
      if (stable >= (window.__pdfPanEnded ? 3 : 12)) {
        window.__stopPdfPanObservation()
        return resolve({scrollend:window.__pdfPanEnded,stableFrames:stable,left,top,elapsed:performance.now()-started})
      }
      if (performance.now() - started >= 8_000) {
        window.__stopPdfPanObservation()
        return reject(new Error('PDF pan did not settle'))
      }
      requestAnimationFrame(check)
    }
    requestAnimationFrame(check)
  }))
  // Both sheet edges must reach the viewport's inner edges within one pixel.
  const edges = await viewport.evaluate(node => {
    const rect = node.getBoundingClientRect()
    return {left:rect.left + node.clientLeft,right:rect.left + node.clientLeft + node.clientWidth}
  })
  await viewport.evaluate(node => {node.scrollLeft = 0})
  await expect.poll(async () => Math.abs(await canvas.evaluate(node => node.getBoundingClientRect().left) - edges.left)).toBeLessThanOrEqual(1)
  const left = await canvas.evaluate(node => node.getBoundingClientRect().left)
  await viewport.evaluate(node => {node.scrollLeft = node.scrollWidth})
  await expect.poll(async () => Math.abs(await canvas.evaluate(node => node.getBoundingClientRect().right) - edges.right)).toBeLessThanOrEqual(1)
  const right = await canvas.evaluate(node => node.getBoundingClientRect().right)
  await test.info().attach('pdf-pan-bounds', {body:Buffer.from(JSON.stringify({panSettlement,edges,left,right})),contentType:'application/json'})
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
  await page.addInitScript(fakeEngineScript({ installed:['piper:en_US-lessac-high'], hold:true }))
  await open(page,'epub')
  await page.getByRole('button',{name:'Escuchar el libro'}).click()
  await page.getByRole('button',{name:'Reproducir',exact:true}).click()
  await expect.poll(() => page.evaluate(() => window.__inhouseNeuralTest.engine.calls.length)).toBe(1)
  await page.getByRole('button',{name:'Cerrar opciones de lectura'}).click()
  await expect.poll(() => page.evaluate(() => document.querySelector('foliate-view').renderer.hasAttribute('animated'))).toBe(true)
  const initial = await page.evaluate(() => {
    const view = document.querySelector('foliate-view'), renderer = view.renderer
    window.__readerNextCalls = 0
    const originalNext = view.next.bind(view)
    view.next = (...args) => {window.__readerNextCalls++;return originalNext(...args)}
    window.__readerVoiceStopsBeforeDrag = window.__inhouseNeuralTest.engine.stops
    return renderer.containerPosition
  })
  const bounds = await page.locator('#reader-viewport').boundingBox(), cdp = await page.context().newCDPSession(page)
  await drag(cdp,bounds.x+bounds.width*.8,bounds.y+bounds.height*.55,-180)
  await expect.poll(() => page.evaluate(() => document.querySelector('foliate-view').renderer.containerPosition)).toBeGreaterThan(initial+50)
  expect(await page.evaluate(() => window.__readerNextCalls)).toBe(0)
  expect(await page.evaluate(() => window.__inhouseNeuralTest.engine.stops-window.__readerVoiceStopsBeforeDrag)).toBe(1)
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
  const pageSize = () => page.evaluate(() => document.querySelector('foliate-view').renderer.size)
  // Exact page offsets, not "moved a bit": a loaded machine can sample a turn half way.
  const reach = target => expect.poll(async () => Math.abs(await position() - target) <= 1, {timeout:60_000}).toBe(true)
  const chromeHidden = () => page.evaluate(() => document.body.classList.contains('is-reader-focus'))
  // Count navigations (a tap in the centre must not turn the page) rather than comparing offsets.
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
  const first = await position(), step = await pageSize()
  await tap(.9)
  await reach(first + step)
  await tap(.9)
  await reach(first + 2 * step)
  // The left edge must go BACK, not forward as when zones were measured on the wide chapter document.
  await tap(.1)
  await reach(first + step)
  const before = await turns()
  expect(await chromeHidden()).toBe(false)
  await tap(.5)
  await expect.poll(chromeHidden).toBe(true)
  await tap(.5)
  await expect.poll(chromeHidden).toBe(false)
  expect(await turns()).toBe(before)
})

test('EPUB: a tap still turns the page when touchend reaches the page after pointerup', async ({page}) => {
  test.setTimeout(90_000)
  // Animations on, as on a phone. Foliate answers every touchend with snap(); a late
  // touchend used to snap the page straight back to the one the tap had just left.
  await open(page,'epub','no-preference')
  await page.evaluate(() => {
    const doc = document.querySelector('foliate-view').renderer.getContents()[0].doc
    doc.addEventListener('touchend', event => {
      if (event.__late) return
      event.stopImmediatePropagation()
      setTimeout(() => { const late = new Event('touchend'); late.__late = true; doc.dispatchEvent(late) }, 40)
    }, true)
  })
  const position = () => page.evaluate(() => document.querySelector('foliate-view').renderer.containerPosition)
  const pageSize = () => page.evaluate(() => document.querySelector('foliate-view').renderer.size)
  const reach = target => expect.poll(async () => Math.abs(await position() - target) <= 1, {timeout:60_000}).toBe(true)
  const bounds = await page.locator('#reader-viewport').boundingBox(), cdp = await page.context().newCDPSession(page)
  const tap = async fraction => {
    const touch = {id:1,x:bounds.x + bounds.width * fraction,y:bounds.y + bounds.height * .55}, stamp = Date.now() / 1000
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',timestamp:stamp,touchPoints:[touch]})
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',timestamp:stamp + .05,touchPoints:[]})
  }
  const first = await position(), step = await pageSize()
  await tap(.9)
  await reach(first + step)
  await tap(.9)
  await reach(first + 2 * step)
  await tap(.1)
  await reach(first + step)
})
