import { test, expect } from '@playwright/test'
import { fakeEngineScript } from '../helpers/fake-neural-engine.js'
import { longReflowPDF, PDF_REFLOW_SENTENCES } from './fixtures/pdf-reflow-navigation.mjs'
const pageTwo = ['The second physical page starts here.', 'Its unique marker is next-page.']
const settings = { pdfMode:'text', flow:'paginated', fontSize:20, margin:16, lineHeight:1.6 }
async function open(page, preferences = {}, viewport = { width:390, height:844 }) {
  await page.setViewportSize(viewport)
  await page.emulateMedia({ reducedMotion:'reduce' })
  await page.addInitScript(p => { if (!localStorage.getItem('inhouse-read-reading-preferences')) localStorage.setItem('inhouse-read-reading-preferences', JSON.stringify(p)) }, { ...settings, ...preferences })
  await page.goto(process.env.IHR_TEST_URL || './')
  await page.locator('#file-picker').setInputFiles({ name:'Long adaptive PDF.pdf', mimeType:'application/pdf', buffer:longReflowPDF() })
  await expect(page.locator('.pdf-reflow-page')).toBeVisible()
  await expect(page.locator('#reader-location')).toHaveAttribute('aria-label', /Página 1 de 2/)
}
async function visibleWords(page) {
  return page.locator('.pdf-reflow-page').evaluate(el => {
    const node=el.firstChild, box=el.parentElement.getBoundingClientRect(), text=el.textContent
    const words=[...text.matchAll(/\S+/g)].map((m,index)=>{
      const range=document.createRange();range.setStart(node,m.index);range.setEnd(node,m.index+m[0].length)
      const rects=[...range.getClientRects()]
      return { index, offset:m.index, word:m[0], visible:rects.length>0 && rects.every(r=>r.top>=box.top-1 && r.bottom<=box.bottom+1 && r.left>=box.left-1 && r.right<=box.right+1) }
    })
    return { text, words, scrollTop:el.parentElement.scrollTop, height:el.parentElement.clientHeight, scrollHeight:el.parentElement.scrollHeight }
  })
}
async function savedOffset(page) {
  return page.evaluate(async()=>{
    const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('inhouse-read');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)})
    const records=await new Promise((resolve,reject)=>{const r=db.transaction('books','readonly').objectStore('books').getAll();r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)})
    db.close();return records[0]?.locator?.textOffset || 0
  })
}
for (const scenario of [
  { name:'mobile', width:390, height:844, fontSize:20, margin:16 },
  { name:'mobile large text', width:390, height:844, fontSize:36, margin:64 },
  { name:'landscape large text', width:844, height:390, fontSize:36, margin:64 },
  { name:'scrolled text', width:390, height:844, fontSize:28, margin:32, flow:'scrolled' }
]) test(`PDF adaptable ${scenario.name}: next and previous traverse every visible word before changing physical page`, async ({ page },testInfo)=>{
  test.setTimeout(90_000)
  const errors=[];page.on('pageerror',e=>errors.push(e.message))
  await open(page,scenario,{width:scenario.width,height:scenario.height})
  const article=page.locator('.pdf-reflow-page'), initial=await visibleWords(page)
  expect(initial.text.split(/\n{2,}/)).toEqual([PDF_REFLOW_SENTENCES.join(' ')])
  expect(initial.scrollHeight).toBeGreaterThan(initial.height)
  const coverage=new Set(), screens=[]
  for(let screen=0;screen<40;screen++) {
    const state=await visibleWords(page);screens.push(state)
    for(const word of state.words)if(word.visible)coverage.add(word.index)
    await page.getByRole('button',{name:'Página siguiente',exact:true}).click()
    const aria=await page.locator('#reader-location').getAttribute('aria-label')
    if(aria.includes('Página 2 de 2'))break
    await expect(page.locator('#reader-location')).toHaveAttribute('aria-label',/Página 1 de 2/)
    expect((await visibleWords(page)).scrollTop).toBeGreaterThan(state.scrollTop)
  }
  expect(screens.length).toBeGreaterThan(1)
  expect([...coverage].sort((a,b)=>a-b)).toEqual(initial.words.map(w=>w.index))
  await expect(article).toContainText('next-page.')
  await page.getByRole('button',{name:'Página anterior',exact:true}).click()
  await expect(page.locator('#reader-location')).toHaveAttribute('aria-label',/Página 1 de 2/)
  const returned=await visibleWords(page)
  expect(returned.scrollTop).toBeGreaterThan(0)
  expect(returned.words.at(-1).visible).toBe(true)
  await page.getByRole('button',{name:'Página anterior',exact:true}).click()
  await expect(page.locator('#reader-location')).toHaveAttribute('aria-label',/Página 1 de 2/)
  expect((await visibleWords(page)).scrollTop).toBeLessThan(returned.scrollTop)
  await testInfo.attach('complete-word-coverage',{body:JSON.stringify({scenario,screens,covered:[...coverage],returned,errors}),contentType:'application/json'})
  await testInfo.attach('previous-screen-after-return',{body:await page.screenshot(),contentType:'image/png'})
  expect(errors).toEqual([])
})
test('PDF adaptable: its saved text position survives font size, rotation and reopening',async({page},testInfo)=>{
  test.setTimeout(120_000)
  await open(page,{fontSize:20})
  await page.getByRole('button',{name:'Página siguiente',exact:true}).click()
  await expect.poll(()=>savedOffset(page)).toBeGreaterThan(0)
  const before=await visibleWords(page), anchor=before.words.find(w=>w.visible)
  await page.getByRole('button',{name:'Aspecto de lectura'}).click()
  await page.locator('[data-pref="fontSize"]').evaluate(input=>{input.value='36';input.dispatchEvent(new Event('change',{bubbles:true}))})
  await page.getByRole('button',{name:'Cerrar opciones de lectura'}).click()
  await expect(page.locator('.pdf-reflow-page')).toHaveCSS('font-size','36px')
  await expect.poll(async()=> (await visibleWords(page)).words.some(w=>w.index===anchor.index && w.offset===anchor.offset && w.visible)).toBe(true)
  await page.setViewportSize({width:844,height:390})
  await expect.poll(async()=> (await visibleWords(page)).words.some(w=>w.index===anchor.index && w.offset===anchor.offset && w.visible)).toBe(true)
  await expect.poll(()=>savedOffset(page)).toBeGreaterThan(0)
  const saved=await savedOffset(page)
  await page.reload()
  await page.locator('.ihr-spine').first().click()
  await page.locator('.ihr-flyout__cover-target').click()
  await expect(page.locator('.pdf-reflow-page')).toBeVisible()
  await expect(page.locator('#reader-location')).toHaveAttribute('aria-label',/Página 1 de 2/)
  await expect.poll(async()=> (await visibleWords(page)).scrollTop).toBeGreaterThan(0)
  const restored=await visibleWords(page)
  await expect(page.locator('.pdf-reflow-page')).toHaveCSS('font-size','36px')
  expect(restored.words.some(w=>w.index===anchor.index && w.offset===anchor.offset && w.visible)).toBe(true)
  const savedCharacter=await page.locator('.pdf-reflow-page').evaluate((el,offset)=>{
    const range=document.createRange();range.setStart(el.firstChild,offset);range.setEnd(el.firstChild,offset+1)
    const box=el.parentElement.getBoundingClientRect(), rect=range.getClientRects()[0]
    return {offset, top:rect.top,bottom:rect.bottom,left:rect.left,right:rect.right, box:{top:box.top,bottom:box.bottom,left:box.left,right:box.right}}
  },saved)
  expect(savedCharacter.top).toBeGreaterThanOrEqual(savedCharacter.box.top-1)
  expect(savedCharacter.bottom).toBeLessThanOrEqual(savedCharacter.box.bottom+1)
  expect(savedCharacter.left).toBeGreaterThanOrEqual(savedCharacter.box.left-1)
  expect(savedCharacter.right).toBeLessThanOrEqual(savedCharacter.box.right+1)
  expect(restored.words.find(w=>w.offset>=saved).visible).toBe(true)
  await testInfo.attach('restored-adaptable-text-position',{body:JSON.stringify({before,anchor,saved,savedCharacter,restoredLocator:await savedOffset(page),restored}),contentType:'application/json'})
  await testInfo.attach('restored-adaptable-page',{body:await page.screenshot(),contentType:'image/png'})
})
test('PDF adaptable: narration reads every sentence across long physical pages once',async({page},testInfo)=>{
  test.setTimeout(90_000)
  await page.addInitScript(fakeEngineScript({installed:['piper:en_US-lessac-high'],speakMs:140,startDelay:20})+`;
    window.__speechFrames=[];const ids=new WeakMap();let nextId=0;
    window.__speechHighlight=()=>{
      const h=CSS.highlights.get('inhouse-speech'), ranges=h?[...h]:[], text=ranges.map(r=>r.toString()).join('');
      if(ranges.length){
        const box=document.querySelector('.pdf-reflow-page').parentElement.getBoundingClientRect();
        window.__speechFrames.push({text, page:document.querySelector('#reader-location').getAttribute('aria-label'), nodes:ranges.map(r=>{if(!ids.has(r.startContainer))ids.set(r.startContainer,++nextId);return ids.get(r.startContainer)}), rects:ranges.flatMap(r=>[...r.getClientRects()].map(b=>({top:b.top,bottom:b.bottom,left:b.left,right:b.right}))), box:{top:box.top,bottom:box.bottom,left:box.left,right:box.right}})
      }
      return text
    };
  `)
  await open(page,{fontSize:36,margin:64})
  await page.getByRole('button',{name:'Escuchar el libro'}).click()
  await page.getByRole('button',{name:'Reproducir',exact:true}).click()
  await expect(page.locator('.reading-audio-status')).toHaveText('Final del libro.',{timeout:30_000})
  const {calls,frames}=await page.evaluate(()=>({calls:window.__inhouseNeuralTest.engine.calls,frames:window.__speechFrames}))
  expect(calls.map(c=>c.text)).toEqual([...PDF_REFLOW_SENTENCES,...pageTwo])
  for(const call of calls)expect(call.atStart.replace(/\s+/g,'')).toContain(call.text.replace(/\s+/g,''))
  const starts=frames.filter((frame,index)=>index===frames.length-1 || frames[index+1].text!==frame.text)
  expect(starts.map(frame=>frame.text.trim())).toEqual([...PDF_REFLOW_SENTENCES,...pageTwo])
  for(const frame of starts){
    expect(frame.rects.length).toBeGreaterThan(0)
    expect(frame.rects.every(r=>r.top>=frame.box.top-1 && r.bottom<=frame.box.bottom+1 && r.left>=frame.box.left-1 && r.right<=frame.box.right+1)).toBe(true)
  }
  expect(new Set(starts.slice(0,32).flatMap(frame=>frame.nodes)).size).toBe(1)
  expect(new Set(starts.slice(32).flatMap(frame=>frame.nodes)).size).toBe(1)
  expect(starts[31].nodes).not.toEqual(starts[32].nodes)
  await expect(page.locator('#reader-location')).toHaveAttribute('aria-label',/Página 2 de 2/)
  await testInfo.attach('spoken-fragment-visibility-and-stable-text-nodes',{body:JSON.stringify(starts),contentType:'application/json'})
  await testInfo.attach('all-long-page-sentences-once',{body:JSON.stringify(calls),contentType:'application/json'})
})
