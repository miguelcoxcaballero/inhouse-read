import { test, expect } from '@playwright/test'
import { imageThemePDF } from './fixtures/image-theme-pdf.mjs'
import { imageThemeEPUB } from './fixtures/image-theme-epub.mjs'
import { PDF_PAGE_FILTERS } from '../../src/js/readers/reading-preferences.js'

test.use({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:1})
for (const theme of Object.keys(PDF_PAGE_FILTERS)) {
  test(`${theme}: colour and monochrome PDF images retain original pixels`, async ({page},testInfo) => {
    test.setTimeout(120_000)
    await page.emulateMedia({reducedMotion:'reduce'})
    await page.addInitScript(theme => localStorage.setItem('inhouse-read-reading-preferences',JSON.stringify({theme})),theme)
    await page.goto(process.env.IHR_TEST_URL || './')
    await page.locator('#file-picker').setInputFiles({name:'Image colours.pdf',mimeType:'application/pdf',buffer:imageThemePDF()})
    await expect(page.locator('#reader-toolbar')).toBeVisible({timeout:60_000})
    await expect(page.locator('.pdf-reader')).toHaveAttribute('aria-busy','false',{timeout:60_000})
    const result = await page.locator('.pdf-page-canvas').evaluate((canvas,filter) => {
      const ctx = canvas.getContext('2d',{willReadFrequently:true})
      const pixel = (x,y) => [...ctx.getImageData(Math.round(x*canvas.width/400),Math.round(y*canvas.height/600),1,1).data].slice(0,3)
      // PDF coordinates grow upwards; canvas coordinates downwards.
      const normal = [65,115,165,215].map(x => pixel(x,200))
      const rotated = [.125,.375,.625,.875].map(u => pixel(240+100*u-25*.5,600-(190+50*u+50*.5)))
      const white = document.createElement('canvas'); white.width=white.height=1
      white.getContext('2d').fillStyle='#fff'; white.getContext('2d').fillRect(0,0,1,1)
      const themed = document.createElement('canvas'); themed.width=themed.height=1
      const paint=themed.getContext('2d'); paint.filter=filter; paint.drawImage(white,0,0)
      return {normal,rotated,paper:pixel(20,20),expectedPaper:[...paint.getImageData(0,0,1,1).data].slice(0,3),cssFilter:getComputedStyle(canvas).filter}
    },PDF_PAGE_FILTERS[theme])
    await testInfo.attach('image-colour-pixels',{body:JSON.stringify(result,null,2),contentType:'application/json'})
    const expected = [[230,35,50],[25,190,80],[35,70,225],[110,110,110]]
    for (const samples of [result.normal,result.rotated]) for (let i=0;i<samples.length;i++) {
      for (let channel=0;channel<3;channel++) expect(Math.abs(samples[i][channel]-expected[i][channel])).toBeLessThanOrEqual(2)
    }
    expect(result.cssFilter).toBe('none')
    for (let channel=0;channel<3;channel++) expect(Math.abs(result.paper[channel]-result.expectedPaper[channel])).toBeLessThanOrEqual(2)
  })
}

for (const theme of Object.keys(PDF_PAGE_FILTERS)) {
  test(`${theme}: EPUB photos and vector illustrations retain their rendered colours`,async ({page},testInfo)=>{
    test.setTimeout(120_000)
    await page.emulateMedia({reducedMotion:'reduce'})
    await page.addInitScript(theme=>localStorage.setItem('inhouse-read-reading-preferences',JSON.stringify({theme})),theme)
    await page.goto(process.env.IHR_TEST_URL || './')
    await page.locator('#file-picker').setInputFiles({name:'Image colours.epub',mimeType:'application/epub+zip',buffer:imageThemeEPUB()})
    await expect(page.locator('#reader-toolbar')).toBeVisible({timeout:60_000})
    const imageBounds=()=>page.evaluate(()=>{
      const contents=document.querySelector('foliate-view')?.renderer?.getContents?.() || []
      return contents.flatMap(({doc})=>{
        const frame=doc?.defaultView?.frameElement,frameRect=frame?.getBoundingClientRect()
        if(!frameRect)return []
        return ['original-colours','original-vector'].flatMap(id=>{
          const el=doc.getElementById(id),rect=el?.getBoundingClientRect()
          if(!rect || rect.width<100 || rect.height<10 || (id==='original-colours' && !el.complete))return []
          const bounds={id,x:frameRect.x+rect.x,y:frameRect.y+rect.y,width:rect.width,height:rect.height}
          return bounds.x>=0 && bounds.y>=0 && bounds.x+bounds.width<=innerWidth && bounds.y+bounds.height<=innerHeight?[bounds]:[]
        })
      })
    })
    await expect.poll(async()=> (await imageBounds()).length,{timeout:60_000}).toBe(2)
    const bounds=await imageBounds(),screenshot=await page.screenshot()
    // Sample the composed screenshot, so a CSS filter on any ancestor would
    // fail this test even though drawing an <img> into a canvas ignores CSS.
    const pixels=await page.evaluate(async({bytes,bounds})=>{
      const image=await createImageBitmap(new Blob([new Uint8Array(bytes)],{type:'image/png'}))
      const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height
      const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(image,0,0);image.close()
      return bounds.map(rect=>({id:rect.id,pixels:[.125,.375,.625,.875].map(u=>[...ctx.getImageData(Math.round(rect.x+u*rect.width),Math.round(rect.y+.5*rect.height),1,1).data].slice(0,3))}))
    },{bytes:[...screenshot],bounds})
    await testInfo.attach('rendered-epub-image-colours',{body:JSON.stringify({bounds,pixels},null,2),contentType:'application/json'})
    const expected=[[230,35,50],[25,190,80],[35,70,225],[110,110,110]]
    for(const {pixels:samples} of pixels)for(let i=0;i<4;i++)for(let c=0;c<3;c++)expect(Math.abs(samples[i][c]-expected[i][c])).toBeLessThanOrEqual(2)
  })
}
