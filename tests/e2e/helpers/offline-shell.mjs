import {expect} from '@playwright/test'

export async function offlineShellStatus(page) {
  return page.evaluate(async()=>{
    const registration=await navigator.serviceWorker?.getRegistration()
    const worker=navigator.serviceWorker?.controller || registration?.active
    if(!worker)return null
    return new Promise(resolve=>{
      const channel=new MessageChannel(),timer=setTimeout(()=>{channel.port1.close();resolve(null)},2000)
      channel.port1.onmessage=event=>{clearTimeout(timer);channel.port1.close();resolve(event.data)}
      worker.postMessage({type:'offline-shell-status'},[channel.port2])
    })
  })
}
export async function waitForOfflineShell(page) {
  await expect.poll(()=>offlineShellStatus(page),{timeout:90_000}).toMatchObject({ready:true})
  await expect.poll(()=>page.evaluate(()=>Boolean(navigator.serviceWorker.controller)),{timeout:15_000}).toBe(true)
  return offlineShellStatus(page)
}
export async function localBookBytes(page,name) {
  return page.evaluate(async name=>{
    const db=await new Promise((resolve,reject)=>{const request=indexedDB.open('inhouse-read');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)})
    const books=await new Promise((resolve,reject)=>{const request=db.transaction('books','readonly').objectStore('books').getAll();request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)})
    db.close();const book=books.find(book=>book.name===name)
    if(!book?.content)return null
    const bytes=await book.content.arrayBuffer(),sha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),value=>value.toString(16).padStart(2,'0')).join('')
    return {id:book.id,name:book.name,bytes:bytes.byteLength,sha256,hasDriveCopy:Boolean(book.driveFileId)}
  },name)
}
export async function reopenOfflineBook(page,id,format) {
  await expect(page.locator(`.ihr-spine[data-book-id="${id}"]`)).toBeVisible({timeout:30_000})
  // Keyboard activation uses the same selected-cover/open flow and avoids
  // making shell/IndexedDB coverage depend on a particular 3D raycast pose.
  await page.locator(`.ihr-spine[data-book-id="${id}"]`).focus()
  await page.keyboard.press('Enter')
  await expect(page.locator('.ihr-flyout__readiness')).toHaveText('Listo para leer',{timeout:60_000})
  await expect(page.locator('.ihr-flyout__cover-target')).toBeVisible({timeout:30_000})
  await page.locator('.ihr-flyout__cover-target').focus();await page.keyboard.press('Enter')
  await expect(page.locator('body')).toHaveClass(/is-reading/,{timeout:60_000})
  await expect(page.locator(format==='pdf'?'.pdf-text-layer span':'foliate-view').first()).toBeVisible({timeout:60_000})
}
export function observeColdPage(page) {
  const evidence={responses:[],errors:[]}
  page.on('pageerror',error=>evidence.errors.push(error.message))
  page.on('response',response=>{
    if(response.url().startsWith('http') && response.status()===200)evidence.responses.push({url:response.url(),serviceWorker:response.fromServiceWorker()})
  })
  return evidence
}
export async function coldOfflinePage(context,previous,url) {
  const session=await context.newCDPSession(previous)
  await session.send('Network.clearBrowserCache') // preserves Cache Storage/IndexedDB
  await session.detach()
  await previous.close() // destroys that document and all its dedicated workers
  await context.setOffline(true)
  const page=await context.newPage(),evidence=observeColdPage(page)
  const response=await page.goto(url)
  expect(response.status()).toBe(200);expect(response.fromServiceWorker()).toBe(true)
  await expect(page.locator('#home-screen')).toBeVisible({timeout:30_000})
  expect((await waitForOfflineShell(page)).ready).toBe(true)
  evidence.httpCacheCleared=true
  return {page,evidence}
}
