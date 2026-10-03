import { test, expect } from '@playwright/test';
import { wordVolumeEPUB, wordVolumePDF } from '../unit/fixtures/book-length-fixtures.mjs';

test.use({ serviceWorkers:'block' });
async function records(page) {
  return page.evaluate(()=>new Promise((resolve,reject)=>{
    const request=indexedDB.open('inhouse-read');
    request.onerror=()=>reject(request.error);
    request.onsuccess=()=>{const db=request.result,read=db.transaction('books','readonly').objectStore('books').getAll();
      read.onerror=()=>{db.close();reject(read.error);};
      read.onsuccess=()=>{const result=read.result.map(({id,name,wordCount,wordCountComplete,wordCountVersion,contentRevision,wordCountContentRevision,pageCount,content})=>
        ({id,name,wordCount,wordCountComplete,wordCountVersion,contentRevision,wordCountContentRevision,pageCount,bytes:content?.size||0}));db.close();resolve(result);};};
  }));
}
async function observeSpines(page) {
  await page.addInitScript(()=>{
    window.__wordGeometrySamples=[];
    new MutationObserver(()=>{
      for(const node of document.querySelectorAll('.ihr-spine')) {
        const id=node.dataset.bookId,width=node.style.getPropertyValue('--ihr-spine-w');
        if(!window.__wordGeometrySamples.some(sample=>sample.id===id&&sample.width===width))
          window.__wordGeometrySamples.push({id,width});
      }
    }).observe(document,{subtree:true,childList:true,attributes:true,attributeFilter:['style']});
  });
}

test('a legacy PDF gets no provisional 3D spine while its full detached count is pending',async({page,context},testInfo)=>{
  test.setTimeout(90_000);
  await page.setViewportSize({width:390,height:844});await page.emulateMedia({reducedMotion:'reduce'});
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(process.env.IHR_TEST_URL||'./');
  const bytes=wordVolumePDF({words:30000,pages:3}),id='legacy:word-volume';
  await page.evaluate(async({encoded,id})=>{
    const bytes=Uint8Array.from(atob(encoded),character=>character.charCodeAt(0));
    await new Promise((resolve,reject)=>{const request=indexedDB.open('inhouse-read');request.onerror=()=>reject(request.error);
      request.onsuccess=()=>{const db=request.result,transaction=db.transaction('books','readwrite');
        transaction.objectStore('books').put({id,sourceType:'local',name:'Legacy Words.pdf',title:'Legacy Words',format:'PDF',
          size:bytes.length,content:new Blob([bytes],{type:'application/pdf'}),pageCount:777,progressFraction:0,addedAt:1,lastOpenedAt:1});
        transaction.oncomplete=()=>{db.close();resolve();};transaction.onerror=()=>{db.close();reject(transaction.error);};};});
  },{encoded:bytes.toString('base64'),id});
  let releaseWorker,workerRequests=0;
  const gate=new Promise(resolve=>{releaseWorker=resolve;});
  await context.route(/pdf\.worker[^/]*\.mjs(?:\?.*)?$/,async route=>{workerRequests++;await gate;await route.continue();});
  await observeSpines(page);
  try {
    await page.reload();await expect.poll(()=>workerRequests).toBeGreaterThan(0);
    await expect(page.locator('.ihr-library-loading--books')).toContainText('Preparando Legacy Words');
    await expect(page.locator('.ihr-library-loading--books button')).toHaveText('Abrir');
    await expect(page.locator('.ihr-spine')).toHaveCount(0);
    await expect(page.getByText('Tu estantería está vacía')).toHaveCount(0);
    const pending=await records(page);expect(pending[0].wordCountComplete).not.toBe(true);
    releaseWorker();
    await expect.poll(async()=>((await records(page))[0]||{}).wordCount,{timeout:30_000}).toBe(30000);
    await expect(page.locator('.ihr-spine')).toHaveCount(1,{timeout:15_000});
    await expect(page.locator('.ihr-library-loading--books')).toHaveCount(0);
    const saved=(await records(page))[0];expect(saved).toMatchObject({wordCount:30000,wordCountComplete:true,wordCountVersion:2,pageCount:777,bytes:bytes.length});
    expect(saved.wordCountContentRevision).toBe(saved.contentRevision);
    const samples=await page.evaluate(()=>window.__wordGeometrySamples);
    expect(samples.filter(sample=>sample.id===id)).toHaveLength(1);
    await testInfo.attach('legacy-word-geometry',{body:JSON.stringify({saved,samples,workerRequests,errors}),contentType:'application/json'});
    await testInfo.attach('legacy-final-spine',{body:await page.screenshot(),contentType:'image/png'});
    expect(errors).toEqual([]);
  } finally {releaseWorker();}
});

test('an imported EPUB saves all chapters and its final geometry survives a cold home reload',async({page},testInfo)=>{
  test.setTimeout(90_000);
  await page.setViewportSize({width:390,height:844});await page.emulateMedia({reducedMotion:'reduce'});
  const errors=[];page.on('pageerror',error=>errors.push(error.message));await observeSpines(page);
  await page.goto(process.env.IHR_TEST_URL||'./');
  const bytes=wordVolumeEPUB();
  await page.locator('#file-picker').setInputFiles({name:'All Chapters.epub',mimeType:'application/epub+zip',buffer:bytes});
  await expect(page.locator('#reader-screen')).toBeVisible();
  await expect.poll(async()=>((await records(page))[0]||{}).wordCount,{timeout:30_000}).toBe(23);
  const before=(await records(page))[0];expect(before.bytes).toBe(bytes.length);
  expect(before.wordCountContentRevision).toBe(before.contentRevision);
  await page.locator('#reader-back').click();
  await expect(page.locator('body')).not.toHaveClass(/is-closing-reader/,{timeout:30_000});
  await expect(page.locator('.ihr-spine')).toHaveCount(1);
  const firstWidth=await page.locator('.ihr-spine').evaluate(node=>node.style.getPropertyValue('--ihr-spine-w'));
  await page.reload();await expect(page.locator('.ihr-spine')).toHaveCount(1);
  await expect(page.locator('.ihr-library-loading--books')).toHaveCount(0);
  const after=(await records(page))[0],samples=await page.evaluate(()=>window.__wordGeometrySamples);
  expect(after).toMatchObject({wordCount:23,wordCountComplete:true,wordCountVersion:2,contentRevision:before.contentRevision,
    wordCountContentRevision:before.contentRevision,bytes:bytes.length});
  expect(samples.filter(sample=>sample.id===after.id)).toEqual([{id:after.id,width:firstWidth}]);
  await testInfo.attach('complete-epub-cold-geometry',{body:JSON.stringify({before,after,firstWidth,samples,errors}),contentType:'application/json'});
  await testInfo.attach('epub-final-spine',{body:await page.screenshot(),contentType:'image/png'});
  expect(errors).toEqual([]);
});
