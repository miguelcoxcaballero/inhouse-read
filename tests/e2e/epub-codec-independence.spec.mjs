import {test,expect} from '@playwright/test'

test('EPUB import and all original chapter documents bypass the native decompression task queue',async({page},testInfo)=>{
  test.setTimeout(90_000)
  await page.addInitScript(()=>{
    window.__nativeCodecCalls=[]
    window.DecompressionStream=class {
      constructor(format){window.__nativeCodecCalls.push(format);throw new Error('Native decompression task unavailable')}
    }
  })
  await page.goto('./')
  await page.locator('#file-picker').setInputFiles('tests/e2e/fixtures/reading-journey.epub')
  await expect(page.locator('foliate-view')).toBeVisible()
  await expect.poll(()=>page.evaluate(()=>Boolean(document.querySelector('foliate-view')?.book?.sections?.length)),{timeout:30_000}).toBe(true)
  const result=await page.evaluate(async()=>{
    const book=document.querySelector('foliate-view').book,chapters=[]
    for(let index=0;index<book.sections.length;index++){
      const document=await book.sections[index].createDocument()
      chapters.push({index,text:document.body.textContent.trim()})
    }
    return {chapters,nativeCodecCalls:window.__nativeCodecCalls}
  })
  expect(result.chapters.length).toBe(2)
  expect(result.chapters[0].text).toContain('quiet room')
  expect(result.chapters[1].text).toContain('Beyond the window')
  expect(result.chapters.every(chapter=>chapter.text.length>0)).toBe(true)
  expect(result.nativeCodecCalls).toEqual([])
  await testInfo.attach('original-epub-codec-independence',{body:JSON.stringify(result),contentType:'application/json'})
})
