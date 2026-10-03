import { test, expect } from '@playwright/test'
import { fakeEngineScript } from '../helpers/fake-neural-engine.js'
import { longReflowPDF, PDF_REFLOW_SENTENCES } from './fixtures/pdf-reflow-navigation.mjs'

const pageTwo = ['The second physical page starts here.', 'Its unique marker is next-page.']
// Simulate only the display PDF render frame being suspended. The browser,
// app timers and real PDF.js worker continue; this is not an Android device test.
const hiddenPDFFrames = `
  const originalRequest = window.requestAnimationFrame.bind(window);
  const originalCancel = window.cancelAnimationFrame.bind(window);
  const frames = new Map();let serial = -1;
  const state = window.__pdfRAF = { hidden:false, block:false, requested:0, cancelled:0 };
  Object.defineProperty(document,'hidden',{configurable:true,get:()=>state.hidden});
  window.requestAnimationFrame = callback => {
    const pdf = (new Error().stack || '').split('\\n').some(line =>
      /\\._scheduleNext\\b/.test(line) && /pdfjs-dist|\\/assets\\/pdf-|\\/pdf\\.mjs/.test(line));
    if (pdf && state.block) { const id=serial--;frames.set(id,callback);state.requested++;return id; }
    return originalRequest(callback);
  };
  window.cancelAnimationFrame = id => {
    if (frames.delete(id)) {state.cancelled++;return;}originalCancel(id);
  };
  state.hide = () => {state.hidden=true;state.block=true;document.dispatchEvent(new Event('visibilitychange'));};
  state.pending = () => frames.size;
  window.__speechHighlight=()=>{const h=CSS.highlights.get('inhouse-speech');return h?[...h].map(r=>r.toString()).join(''):'';};
`

test.afterEach(async({page},testInfo)=>{
  if(testInfo.status===testInfo.expectedStatus)return
  const result=await page.evaluate(()=>({calls:window.__inhouseNeuralTest?.engine.calls,raf:window.__pdfRAF?{hidden:window.__pdfRAF.hidden,requested:window.__pdfRAF.requested,cancelled:window.__pdfRAF.cancelled,pending:window.__pdfRAF.pending()}:null,status:document.querySelector('.reading-audio-status')?.textContent})).catch(error=>({diagnosticError:error.message}))
  await testInfo.attach('failed-PDF-engine-and-frame-state',{body:JSON.stringify(result),contentType:'application/json'})
})

for (const duringFrame of [false,true]) test(`PDF original audiobook: ${duringFrame ? 'hiding with a visual render pending' : 'already hidden next-page preparation'} does not stop page advancement`,async({page},testInfo)=>{
  test.setTimeout(90_000)
  const errors=[];page.on('pageerror',error=>errors.push(error.message))
  await page.setViewportSize({width:390,height:844})
  await page.emulateMedia({reducedMotion:'reduce'})
  await page.addInitScript(fakeEngineScript({installed:['piper:en_US-lessac-high'],speakMs:140,startDelay:20})+';'+hiddenPDFFrames)
  await page.addInitScript(()=>localStorage.setItem('inhouse-read-reading-preferences',JSON.stringify({pdfMode:'original'})))
  await page.goto(process.env.IHR_TEST_URL || './')
  await page.locator('#file-picker').setInputFiles({name:'Hidden original PDF.pdf',mimeType:'application/pdf',buffer:longReflowPDF()})
  await expect(page.locator('.pdf-page-canvas')).toBeVisible()
  await expect(page.locator('#reader-location')).toHaveAttribute('aria-label',/Página 1 de 2/)
  await page.getByRole('button',{name:'Escuchar el libro'}).click()
  await page.evaluate(pending=>{if(pending)window.__pdfRAF.block=true;else window.__pdfRAF.hide()},duringFrame)
  await page.getByRole('button',{name:'Reproducir',exact:true}).click()
  if (duringFrame) {
    await expect.poll(()=>page.evaluate(()=>window.__pdfRAF.pending())).toBeGreaterThan(0)
    await page.evaluate(()=>window.__pdfRAF.hide())
  }
  await expect(page.locator('.reading-audio-status')).toHaveText('Final del libro.',{timeout:30_000})
  const result=await page.evaluate(()=>({calls:window.__inhouseNeuralTest.engine.calls,raf:{hidden:window.__pdfRAF.hidden,requested:window.__pdfRAF.requested,cancelled:window.__pdfRAF.cancelled,pending:window.__pdfRAF.pending()}}))
  expect(result.calls.map(call=>call.text)).toEqual([...PDF_REFLOW_SENTENCES,...pageTwo])
  for(const call of result.calls)expect(call.atStart.replace(/\s+/g,'')).toContain(call.text.replace(/\s+/g,''))
  expect(result.raf.hidden).toBe(true)
  expect(result.raf.pending).toBe(0)
  if(duringFrame){expect(result.raf.requested).toBeGreaterThan(0);expect(result.raf.cancelled).toBe(result.raf.requested)}
  else expect(result.raf.requested).toBe(0)
  await expect(page.locator('#reader-location')).toHaveAttribute('aria-label',/Página 2 de 2/)
  await testInfo.attach('hidden-display-PDF-render-continuity',{body:JSON.stringify({...result,errors}),contentType:'application/json'})
  await testInfo.attach('actual-next-physical-PDF-page',{body:await page.screenshot(),contentType:'image/png'})
  expect(errors).toEqual([])
})
