import {test,expect} from '@playwright/test'
import {readFileSync} from 'node:fs'
import {createHash} from 'node:crypto'
import {waitForOfflineShell,localBookBytes,reopenOfflineBook,coldOfflinePage} from './helpers/offline-shell.mjs'

for(const format of ['pdf','epub'])test(`cold offline ${format.toUpperCase()}: the shell reopens the exact locally imported book`,async({browser,baseURL},testInfo)=>{
  test.setTimeout(180_000)
  const file=`tests/e2e/fixtures/lectura-es.${format}`,name=`lectura-es.${format}`,original=readFileSync(file)
  const context=await browser.newContext({viewport:{width:390,height:844},reducedMotion:'reduce'})
  let page=await context.newPage()
  try {
    await page.goto(baseURL);const shell=await waitForOfflineShell(page)
    await page.locator('#file-picker').setInputFiles(file)
    await expect(page.locator(format==='pdf'?'.pdf-text-layer span':'foliate-view').first()).toBeVisible({timeout:60_000})
    // The EPUB element exists while its asynchronous open/import is still
    // running. Wait for the actual local transaction before closing the page.
    await expect.poll(()=>localBookBytes(page,name),{timeout:60_000}).toMatchObject({bytes:original.length,sha256:createHash('sha256').update(original).digest('hex'),hasDriveCopy:false})
    const before=await localBookBytes(page,name)
    expect(before).toMatchObject({bytes:original.length,sha256:createHash('sha256').update(original).digest('hex'),hasDriveCopy:false})
    const cold=await coldOfflinePage(context,page,new URL(`?t=${Date.now()}`,baseURL).href);page=cold.page
    // The Rust core must survive a cold start without network just like the
    // reader modules. Compile the actual cached bytes, not a test replacement.
    const rustCores=await page.evaluate(async()=>{
      const names=[]
      // The manifest itself is deliberately outside the immutable shell;
      // discover the module through the complete shell's verified cache.
      for (const name of await caches.keys()) {
        if (!name.startsWith('inhouse-read-shell-v1-')) continue
        const cache=await caches.open(name)
        for (const request of await cache.keys()) if (/\/assets\/inhouse_read_(?:core|decor)-[\w-]+\.wasm$/.test(request.url)) names.push(request.url)
      }
      return Promise.all(['core','decor'].map(async(kind,domain)=>{
        const path=names.find(path=>path.includes('inhouse_read_'+kind+'-'))
        if (!path) throw Error('Rust '+kind+' missing from the offline shell')
        const response=await fetch(path),bytes=await response.arrayBuffer()
        const result=await WebAssembly.instantiate(bytes)
        return {kind,status:response.status,bytes:bytes.byteLength,abi:result.instance.exports.core_abi_version(),domain:result.instance.exports.core_domain()}
      }))
    })
    for(const [domain,core] of rustCores.entries()) {
      expect(core.status).toBe(200)
      expect(core.bytes).toBeGreaterThan(0)
      expect(core.abi).toBe(1)
      expect(core.domain).toBe(domain)
    }
    await reopenOfflineBook(page,before.id,format)
    const after=await localBookBytes(page,name)
    expect(after).toEqual(before)
    const text=await page.evaluate(format=>format==='pdf'
      ? document.querySelector('.pdf-text-layer')?.textContent
      : document.querySelector('foliate-view')?.renderer?.getContents?.()[0]?.doc?.body?.textContent,format)
    expect(text?.trim().length).toBeGreaterThan(20)
    const shellResponses=cold.evidence.responses.filter(response=>new URL(response.url).origin===new URL(baseURL).origin)
    expect(shellResponses.some(response=>/\/assets\/main-[\w-]+\.js/.test(response.url))).toBe(true)
    expect(shellResponses.some(response=>format==='pdf'?/\/assets\/pdf-reader-/.test(response.url):/\/assets\/foliate-reader-/.test(response.url))).toBe(true)
    expect(shellResponses.every(response=>response.serviceWorker)).toBe(true)
    expect(cold.evidence.errors).toEqual([])
    await testInfo.attach('cold-offline-book.json',{body:JSON.stringify({format,shell,before,after,rustCores,text:text.trim(),...cold.evidence},null,2),contentType:'application/json'})
  } finally {await context.close()}
})
