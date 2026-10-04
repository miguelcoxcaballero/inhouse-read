import {test,expect} from '@playwright/test'
import {fakeEngineScript} from '../helpers/fake-neural-engine.js'
import {adaptiveContentPDF,ADAPTIVE_PARAGRAPHS,ADAPTIVE_SECOND} from './fixtures/pdf-adaptive-content.mjs'

async function open(page,theme='paper') {
  await page.setViewportSize({width:390,height:844});await page.emulateMedia({reducedMotion:'reduce'})
  await page.addInitScript(p=>localStorage.setItem('inhouse-read-reading-preferences',JSON.stringify(p)),
    {pdfMode:'text',fontSize:20,lineHeight:1.6,margin:16,theme,skipHeaders:true})
  await page.goto(process.env.IHR_TEST_URL || './')
  await page.locator('#file-picker').setInputFiles({name:'Complete illustrated PDF.pdf',mimeType:'application/pdf',buffer:adaptiveContentPDF()})
  await expect(page.locator('.pdf-reflow-page')).toBeVisible()
  await expect(page.locator('.pdf-reflow-image')).toHaveCount(2)
}

for (const theme of ['paper','sepia','night','amoled','sage']) test(`adaptable PDF keeps original photo colours and all body text in ${theme}`,async({page},testInfo)=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message))
  await open(page,theme)
  const data=await page.locator('.pdf-reflow-page').evaluate(root=>({
    text:root.textContent,children:[...root.childNodes].map(n=>n.nodeType===3?n.nodeValue:n.className),
    images:[...root.querySelectorAll('canvas')].map(canvas=>({
      width:canvas.width,height:canvas.height,
      colors:[.125,.375,.625,.875].map(x=>[...canvas.getContext('2d').getImageData(Math.floor(canvas.width*x),Math.floor(canvas.height*.5),1,1).data]),
      bounds:{width:canvas.getBoundingClientRect().width,right:canvas.getBoundingClientRect().right}
    }))
  }))
  expect(data.text.split(/\n{2,}/)).toEqual(ADAPTIVE_PARAGRAPHS)
  expect(data.children[0]).toBe(ADAPTIVE_PARAGRAPHS[0]+'\n\n')
  const swatches=[[230,35,50],[25,190,80],[35,70,225],[110,110,110]]
  for (let i=0;i<4;i++) for (let channel=0;channel<3;channel++) expect(Math.abs(data.images[1].colors[i][channel]-swatches[i][channel])).toBeLessThanOrEqual(2)
  for (const image of data.images) {expect(image.bounds.width).toBeLessThanOrEqual(358);expect(image.bounds.right).toBeLessThanOrEqual(390)}
  await testInfo.attach(`illustrated-${theme}`,{body:await page.screenshot(),contentType:'image/png'})
  await testInfo.attach(`content-${theme}`,{body:JSON.stringify(data),contentType:'application/json'})
  expect(errors).toEqual([])
})

test('adaptable narration reads every phrase after pictures and across pages at the audible start',async({page},testInfo)=>{
  test.setTimeout(90000)
  await page.addInitScript(fakeEngineScript({installed:['piper:en_US-lessac-high'],speakMs:60,startDelay:20})+`;
    window.__speechHighlight=()=>{const h=CSS.highlights.get('inhouse-speech');return h?[...h].map(r=>r.toString()).join(''):'';};`)
  await open(page)
  await page.getByRole('button',{name:'Escuchar el libro'}).click()
  await page.getByRole('button',{name:'Reproducir',exact:true}).click()
  await expect(page.locator('.reading-audio-status')).toHaveText('Final del libro.',{timeout:30000})
  const calls=await page.evaluate(()=>window.__inhouseNeuralTest.engine.calls)
  const expected=[...ADAPTIVE_PARAGRAPHS,ADAPTIVE_SECOND].flatMap(p=>p.match(/[^.!?]+[.!?]/g).map(s=>s.trim()))
  expect(calls.map(c=>c.text)).toEqual(expected)
  for (const call of calls) expect(call.atStart.replace(/\s+/g,'')).toContain(call.text.replace(/\s+/g,''))
  await expect(page.locator('.pdf-reflow-image')).toHaveCount(1)
  await expect(page.locator('.pdf-reflow-page')).toHaveText(ADAPTIVE_SECOND)
  await testInfo.attach('all-phrases-narrated',{body:JSON.stringify(calls),contentType:'application/json'})
})

test('adaptable view displays an image-only scanned page without dropping back to a blank message',async({page},testInfo)=>{
  await open(page)
  await page.locator('#reader-location').click()
  await page.getByRole('spinbutton',{name:'Ir a la página'}).fill('3')
  await page.getByRole('button',{name:'Ir',exact:true}).click()
  await expect(page.locator('#reader-location')).toHaveAttribute('aria-label',/Página 3 de 3/)
  await expect(page.locator('.pdf-reflow-image')).toHaveCount(1)
  await expect(page.locator('.pdf-reflow-page')).toHaveText('')
  await expect(page.locator('.pdf-reflow-image')).toBeVisible()
  await testInfo.attach('scan-visible-adaptable',{body:await page.screenshot(),contentType:'image/png'})
})

test('all adaptable text after illustrations is reachable before the next physical page',async({page},testInfo)=>{
  await open(page)
  const seen=new Set(),frames=[]
  for (let step=0;step<20;step++) {
    const frame=await page.locator('.pdf-reflow-page').evaluate(root=>{
      const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT),box=root.parentElement.getBoundingClientRect(),visible=[]
      for (let node=walker.nextNode();node;node=walker.nextNode()) for (const match of node.nodeValue.matchAll(/Complete marker \d{2} stays readable\./g)) {
        const range=document.createRange();range.setStart(node,match.index);range.setEnd(node,match.index+match[0].length)
        const rects=[...range.getClientRects()]
        if (rects.length && rects.every(r=>r.top>=box.top-1 && r.bottom<=box.bottom+1)) visible.push(match[0])
      }
      return {visible,text:root.textContent,top:root.parentElement.scrollTop,height:root.parentElement.clientHeight,scrollHeight:root.parentElement.scrollHeight}
    })
    frames.push(frame);frame.visible.forEach(text=>seen.add(text))
    if (frame.top>=frame.scrollHeight-frame.height-1) break
    await page.getByRole('button',{name:'Página siguiente',exact:true}).click()
    await expect(page.locator('#reader-location')).toHaveAttribute('aria-label',/Página 1 de 3/)
  }
  expect([...seen].sort()).toEqual(Array.from({length:18},(_,i)=>`Complete marker ${String(i).padStart(2,'0')} stays readable.`))
  await page.getByRole('button',{name:'Página siguiente',exact:true}).click()
  await expect(page.locator('#reader-location')).toHaveAttribute('aria-label',/Página 2 de 3/)
  await expect(page.locator('.pdf-reflow-page')).toHaveText(ADAPTIVE_SECOND)
  await expect(page.locator('.pdf-reflow-image')).toHaveCount(1)
  await testInfo.attach('illustrated-page-screens',{body:JSON.stringify(frames),contentType:'application/json'})
})
