import './helpers/empty-update-channels.mjs'
import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { imageThemeEPUB } from './fixtures/image-theme-epub.mjs'
import { driveServer } from './helpers/drive-server.mjs'
import { localBookBytes, reopenOfflineBook } from './helpers/offline-shell.mjs'

async function savedBook(page) {
  return page.evaluate(async () => {
    const db=await new Promise(resolve => { const r=indexedDB.open('inhouse-read');r.onsuccess=()=>resolve(r.result) })
    const books=await new Promise(resolve => {const r=db.transaction('books').objectStore('books').getAll();r.onsuccess=()=>resolve(r.result)})
    db.close()
    const book=books[0]
    if (!book) return null
    const cover=book.cover ? Array.from(new Uint8Array(await book.cover.arrayBuffer())) : null
    return { id:book.id,title:book.title,cover,shelfOrder:book.shelfOrder,shelfPosition:book.shelfPosition,spineColorOverride:book.spineColorOverride }
  })
}

for (const [name,format] of [['reading-journey.pdf','pdf'],['cloud-cover.epub','epub']]) {
  test(`Drive restores ${format} with original bytes, cover, customization and room on a fresh mobile device`, async ({ browser }) => {
    test.setTimeout(120_000)
    const drive=driveServer(), contexts=[]
    const makeDevice=async () => {
      const context=await browser.newContext({ viewport:{ width:390,height:844 }, hasTouch:true, isMobile:true })
      contexts.push(context); await drive.connect(context)
      return { context,page:await context.newPage() }
    }
    try {
      const a=await makeDevice()
      await a.page.goto(process.env.IHR_TEST_URL || `http://127.0.0.1:${process.env.PLAYWRIGHT_PORT || 4283}/inhouse-read/`)
      const original = format === 'epub' ? imageThemeEPUB({ cover:true }) : readFileSync(`tests/e2e/fixtures/${name}`)
      await a.page.locator('#file-picker').setInputFiles({ name, mimeType:format === 'epub' ? 'application/epub+zip' : 'application/pdf', buffer:original })
      await expect.poll(() => savedBook(a.page)).toMatchObject({ cover:expect.any(Array) })
      const source=await savedBook(a.page)
      await a.page.evaluate(async () => {
        const db=await new Promise(resolve => {const r=indexedDB.open('inhouse-read');r.onsuccess=()=>resolve(r.result)})
        const tx=db.transaction('books','readwrite'), store=tx.objectStore('books')
        const request=store.getAll()
        request.onsuccess=()=>store.put({ ...request.result[0], title:'Restored Library', shelfOrder:9,
          shelfPosition:{ shelf:1,x:.4 },spineColorOverride:'#215d48' })
        await new Promise(resolve => {tx.oncomplete=resolve}); db.close()
        const plants=JSON.parse(localStorage.getItem('inhouse-read-shelf-plants') || '[]').slice(0,1)
        localStorage.setItem('inhouse-read-shelf-plants',JSON.stringify(plants))
        localStorage.setItem('inhouse-read-shelf-lamps','[]')
        localStorage.setItem('inhouse-read-backup-settings-changes',JSON.stringify({
          'inhouse-read-shelf-plants':Date.now(),'inhouse-read-shelf-lamps':Date.now()
        }))
        dispatchEvent(new Event('inhouse-library-changed'))
      })
      await expect.poll(() => drive.manifests().some(s => s.books.some(b => b.fields.title?.value==='Restored Library' && b.fields.cover?.value?.fileId)),{timeout:30000}).toBe(true)
      const room=await a.page.evaluate(()=>localStorage.getItem('inhouse-read-shelf-plants'))
      // Destroy the originating document and its entire browser storage.
      await a.context.close()
      const b=await makeDevice()
      const errors=[];b.page.on('pageerror',e=>errors.push(e.message))
      await b.page.goto(process.env.IHR_TEST_URL || `http://127.0.0.1:${process.env.PLAYWRIGHT_PORT || 4283}/inhouse-read/`)
      await expect.poll(()=>localBookBytes(b.page,name),{timeout:30000}).toMatchObject({ bytes:original.length,
        sha256:createHash('sha256').update(original).digest('hex'),hasDriveCopy:true })
      await expect.poll(()=>savedBook(b.page)).toMatchObject({title:'Restored Library',cover:source.cover,shelfOrder:9,
        shelfPosition:{shelf:1,x:.4},spineColorOverride:'#215d48'})
      expect(await b.page.evaluate(()=>localStorage.getItem('inhouse-read-shelf-plants'))).toBe(room)
      await expect(b.page.locator('.ihr-plant[data-object-id]')).toHaveCount(JSON.parse(room).length)
      const book=await savedBook(b.page)
      await reopenOfflineBook(b.page,book.id,format)
      expect(errors).toEqual([])
      // No second upload or placeholder bytes were substituted for the file.
      expect([...drive.files.values()].filter(f=>f.name===name)).toHaveLength(1)
    } finally { for (const context of contexts) await context.close() }
  })
}
