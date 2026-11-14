import {test,expect} from '@playwright/test';
if (process.env.IHR_TEST_URL) test.use({baseURL:process.env.IHR_TEST_URL});
test.use({viewport:{width:390,height:844},hasTouch:true,isMobile:true,deviceScaleFactor:1});
async function observe(page){
 await page.addInitScript(()=>{
  localStorage.setItem('inhouse-read-shelf-plants',JSON.stringify([{key:'plant:startup',seed:'startup',catalogId:'monstera',variant:'monstera',potId:'gradvis',width:260,height:350,shelf:0,x:.4}]));
  const stats=window.rustBoot={instances:[0,0],calls:0};
  for(const name of ['instantiate','instantiateStreaming'])if(WebAssembly[name]){
   const original=WebAssembly[name].bind(WebAssembly);
   WebAssembly[name]=async(...args)=>{const result=await original(...args);if(!result.instance?.exports.core_abi_version)return result;
    stats.instances[result.instance.exports.core_domain()]++;const exports={};for(const [key,value]of Object.entries(result.instance.exports))exports[key]=typeof value==='function'&&key.startsWith('plant_')?function(...input){stats.calls++;return value(...input);}:value;
    return{module:result.module,instance:{exports}};
   };
  }
 });
}
async function firstFrame(page){await expect.poll(()=>page.locator('canvas.ihr-bookshelf-scene').getAttribute('data-render-count').then(Number)).toBeGreaterThan(0);}
test('early core shares one actual request and instance with the live shelf',async({page})=>{
 await observe(page);const errors=[],requests=[];page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>{if(/inhouse_read_(core|decor)/.test(request.url())&&request.url().endsWith('.wasm'))requests.push(request.url());});
 await page.goto('./');await firstFrame(page);await expect.poll(()=>page.evaluate(()=>window.rustBoot.calls)).toBeGreaterThan(0);
 const state=await page.evaluate(()=>({instances:window.rustBoot.instances,adopted:!('__inhouseRustReady'in window)&&!('__inhouseDecorReady'in window),urls:['ihr-rust-core','ihr-rust-decor'].map(id=>document.getElementById(id).href)}));
 expect(state.instances).toEqual([1,1]);expect(state.adopted).toBe(true);expect(requests.sort()).toEqual(state.urls.sort());expect(errors).toEqual([]);
});
// The shelf's tables and kernels exist only in the two cores (src/js/core-tables.js): there is no JavaScript copy to
// draw a first frame from. A slow core therefore delays the shelf without failing it, and one that cannot be reached
// is reported to the person after a single automatic reload (src/js/chunk-recovery.js). A launch after the first is
// answered by the offline shell, which holds both cores (tests/e2e/offline-shell.spec.mjs).
const unavailable=page=>page.locator('#bookshelf-root [role="alert"]');
for(const [kind,domain] of [['core',0],['decor',1]]) test('a pending '+kind+' download delays the shelf without an error and the first frame follows it',async({page})=>{
 await observe(page);let release,requests=0;const gate=new Promise(r=>release=r),errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.route(`**/assets/inhouse_read_${kind}-*.wasm`,async route=>{requests++;await gate;await route.continue();});
 try{
  await page.goto('./',{waitUntil:'domcontentloaded'});
  // The other core has arrived and a further second has passed: the shelf is waiting for this download only.
  await expect.poll(()=>page.evaluate(domain=>window.rustBoot.instances[1-domain],domain)).toBe(1);await page.waitForTimeout(1000);
  expect(await page.evaluate(domain=>window.rustBoot.instances[domain],domain)).toBe(0);
  await expect(unavailable(page)).toHaveCount(0);expect(requests).toBe(1);
 }finally{release();}
 await firstFrame(page);expect(await page.evaluate(domain=>window.rustBoot.instances[domain],domain)).toBe(1);
 await expect(page.locator('.ihr-plant')).toHaveCount(1);await expect(unavailable(page)).toHaveCount(0);expect(requests).toBe(1);expect(errors).toEqual([]);
});
for(const [kind,domain] of [['core',0],['decor',1]]) test('a first visit that cannot reach the '+kind+' reloads once and then says so instead of showing an empty shelf',async({page})=>{
 await observe(page);let requests=0;
 await page.route(`**/assets/inhouse_read_${kind}-*.wasm`,async route=>{requests++;await route.abort('internetdisconnected');});
 await page.goto('./');
 await expect(unavailable(page)).toHaveText('No se pudo cargar la estantería. Comprueba la conexión e inténtalo de nuevo.',{timeout:30_000});
 // One request per page load: the first visit's and the single automatic reload's. Nothing asks again afterwards.
 await expect.poll(()=>requests).toBe(2);await page.waitForTimeout(2000);expect(requests).toBe(2);
 await expect(unavailable(page)).toHaveCount(1);await expect(page.locator('canvas.ihr-bookshelf-scene')).toHaveCount(0);
 expect(await page.evaluate(domain=>window.rustBoot.instances[domain],domain)).toBe(0);
});
