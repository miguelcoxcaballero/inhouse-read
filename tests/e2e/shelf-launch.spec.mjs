import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { settledGeometryLength } from './helpers/settled-geometry-length.mjs';

const BOOK_PREFIX = 'motion:book:';
const LAMP_KEY = 'inhouse-read-shelf-lamps';
const PLANT_KEY = 'inhouse-read-shelf-plants';
const TARGET_URL = process.env.IHR_TEST_URL || './';
test.use({ viewport:{ width:390, height:844 }, hasTouch:true, isMobile:true, deviceScaleFactor:1, serviceWorkers:'block' });

async function seedShelf(page) {
  await page.addInitScript(({ lampKey, plantKey }) => {
    if (localStorage.getItem('inhouse-read-shelf-lamps')) return;
    localStorage.setItem('inhouse-read-shelf-view', 'isometric');
    localStorage.setItem('inhouse-read-shelf-type', 'baggebo');
    localStorage.setItem(plantKey, JSON.stringify([
      { key:'plant:motion', seed:'motion', catalogId:'sansevieria', variant:'sansevieria',
        potId:'muskot', width:42, height:124, shelf:0, x:.76 }
    ]));
    localStorage.setItem(lampKey, JSON.stringify([
      { key:'lamp:motion', lampId:'tarnaby', shelf:1, x:.56, isOn:true }
    ]));
  }, { lampKey:LAMP_KEY, plantKey:PLANT_KEY });
  await page.goto(TARGET_URL);
  await expect(page.locator('.ihr-bookshelf').first()).toBeVisible();
  const bytes = [...await readFile('tests/e2e/fixtures/tiny.pdf')];
  await page.evaluate(async ({ bytes, prefix, geometry }) => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('inhouse-read');
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    const covers = [];
    for (let index = 0; index < 6; index++) {
      const canvas = document.createElement('canvas'); canvas.width = 400; canvas.height = 600;
      const context = canvas.getContext('2d');
      context.fillStyle = ['#18364b', '#713b42', '#375a46'][Math.floor(index / 2)];
      context.fillRect(0, 0, 400, 600); context.fillStyle = '#e8e2cf';
      context.font = '32px serif'; context.fillText(`LIBRO ${index + 1}`, 56, 112);
      covers.push(await new Promise(resolve => canvas.toBlob(resolve, 'image/png')));
    }
    const transaction = db.transaction('books', 'readwrite'), books = transaction.objectStore('books');
    for (let index = 0; index < 6; index++) books.put({
      id:`${prefix}${index}`, title:`Libro ${index + 1}`, name:`motion-${index}.pdf`,
      format:'PDF', sourceType:'local', mimeType:'application/pdf', pageCount:260,
      ...geometry,
      content:new Blob([new Uint8Array(bytes)], { type:'application/pdf' }), cover:covers[index],
      coverFinish:index % 2 ? 'satin' : 'glossy', spineSurfaceFinish:index % 2 ? 'satin' : 'glossy',
      spineColorOverride:['#18364b', '#713b42', '#375a46'][Math.floor(index / 2)],
      shelfPosition:{ shelf:Math.floor(index / 2), x:index % 2 ? .38 : .19 }, shelfOrder:index,
      addedAt:Date.now(), lastOpenedAt:Date.now() - index, progressFraction:0
    });
    await new Promise((resolve, reject) => {
      transaction.oncomplete = resolve; transaction.onerror = () => reject(transaction.error);
    }); db.close();
  }, { bytes, prefix:BOOK_PREFIX, geometry:await settledGeometryLength(78_000, 'shelf-motion') });
}

async function launchFrame(page) {
 return page.evaluate(async()=>{
  const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('inhouse-read-launch',1);r.onupgradeneeded=()=>r.result.createObjectStore('frame');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});
  try{return await new Promise(resolve=>{const r=db.transaction('frame').objectStore('frame').get('latest');r.onsuccess=()=>resolve(r.result?{key:r.result.key,size:r.result.image.size}:null);r.onerror=()=>resolve(null)})}finally{db.close()}
 });
}
async function liveFrame(page) {
 await expect.poll(()=>page.locator('.ihr-bookshelf-scene').getAttribute('data-render-count').then(Number).catch(()=>0)).toBeGreaterThan(0);
}
for (const host of ['web', 'Android shell']) test(`${host}: warm launch paints the exact saved room before WASM, then hands over to the interactive scene`,async({page},info)=>{
 if (host === 'Android shell') {
  const session = await page.context().newCDPSession(page);
  await session.send('Emulation.setUserAgentOverride', { userAgent:'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/130.0.0.0 Mobile Safari/537.36 InhouseReadApp/1.0' });
 }
 test.setTimeout(180000);
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await seedShelf(page);
 await page.reload();await liveFrame(page);
 await expect(page.locator('.ihr-spine')).toHaveCount(6);
 await expect.poll(()=>launchFrame(page)).not.toBeNull();
 // A first record could still belong to the empty room. Wait for the final
 // full-room frame and its trailing idle save, then retain its PNG bytes.
 await page.waitForTimeout(4000);
 const saved=await launchFrame(page);expect(saved.size).toBeGreaterThan(10000);
 // A delayed Drive acknowledgement changes bookkeeping, not the picture.
 await page.evaluate(async()=>{
  const db=await new Promise(resolve=>{const r=indexedDB.open('inhouse-read');r.onsuccess=()=>resolve(r.result)});
  await new Promise((resolve,reject)=>{const tx=db.transaction('books','readwrite'),store=tx.objectStore('books'),request=store.getAll();
   request.onsuccess=()=>{for(const book of request.result)store.put({...book,progressDirty:false,progressStateFileId:'acknowledged',progressUpdatedAt:123})};
   tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error)});db.close();
 });
 let release;const held=new Promise(resolve=>release=resolve);
 const hold=async route=>{await held;await route.continue()};
 await page.route('**/assets/inhouse_read_shelf_bg-*.wasm',hold);
 try {
  await page.reload({waitUntil:'domcontentloaded'});
  const preview=page.locator('.ihr-launch-preview');await expect(preview).toBeVisible();
  expect(await page.locator('.ihr-bookshelf-scene').count()).toBe(0);
  const shown=await preview.evaluate(async node=>({ms:performance.now(),bytes:(await(await fetch(node.src)).blob()).size,
    width:node.naturalWidth,height:node.naturalHeight,pointer:getComputedStyle(node).pointerEvents}));
  expect(shown.bytes).toBe(saved.size);expect(shown.pointer).toBe('none');
  await info.attach('launch-timing',{body:JSON.stringify(shown),contentType:'application/json'});
  console.log('LOCAL_LAUNCH',JSON.stringify(shown));
  await page.screenshot({path:info.outputPath('cached-launch.png')});
  await page.waitForTimeout(500);await expect(preview).toBeVisible();
  release();await liveFrame(page);await expect(preview).toHaveCount(0);
  await expect(page.locator('.ihr-spine')).toHaveCount(6);
  await page.screenshot({path:info.outputPath('live-launch.png')});
  await page.locator('.ihr-spine').first().focus();await page.keyboard.press('Enter');
  await expect(page.locator('.ihr-flyout__cover-target')).toBeVisible();
  expect(errors).toEqual([]);
 } finally {release();await page.unroute('**/assets/inhouse_read_shelf_bg-*.wasm',hold)}
});
test('a changed light state rejects the old cached room while the engine is pending',async({page})=>{
 test.setTimeout(180000);
 await seedShelf(page);await page.reload();await liveFrame(page);await page.waitForTimeout(4000);
 expect(await launchFrame(page)).not.toBeNull();
 await page.evaluate(()=>{const key='inhouse-read-shelf-lamps',lamps=JSON.parse(localStorage.getItem(key));lamps[0].isOn=false;localStorage.setItem(key,JSON.stringify(lamps))});
 let release;const held=new Promise(resolve=>release=resolve);const hold=async route=>{await held;await route.continue()};
 await page.route('**/assets/inhouse_read_shelf_bg-*.wasm',hold);
 try{await page.reload({waitUntil:'domcontentloaded'});await page.waitForTimeout(1000);await expect(page.locator('.ihr-launch-preview')).toHaveCount(0);release();await liveFrame(page);}
 finally{release();await page.unroute('**/assets/inhouse_read_shelf_bg-*.wasm',hold)}
});
