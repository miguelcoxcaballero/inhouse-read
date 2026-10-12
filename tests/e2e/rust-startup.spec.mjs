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
 await page.goto('/');await firstFrame(page);await expect.poll(()=>page.evaluate(()=>window.rustBoot.calls)).toBeGreaterThan(0);
 const state=await page.evaluate(()=>({instances:window.rustBoot.instances,adopted:!('__inhouseRustReady'in window)&&!('__inhouseDecorReady'in window),urls:['ihr-rust-core','ihr-rust-decor'].map(id=>document.getElementById(id).href)}));
 expect(state.instances).toEqual([1,1]);expect(state.adopted).toBe(true);expect(requests.sort()).toEqual(state.urls.sort());expect(errors).toEqual([]);
});
for(const [kind,domain] of [['core',0],['decor',1]]) test('a pending '+kind+' download never holds the first shelf frame',async({page})=>{
 await observe(page);let release;const gate=new Promise(r=>release=r);
 await page.route(`**/assets/inhouse_read_${kind}-*.wasm`,async route=>{await gate;await route.continue();});
 try{await page.goto('/',{waitUntil:'domcontentloaded'});await firstFrame(page);expect(await page.evaluate(domain=>window.rustBoot.instances[domain],domain)).toBe(0);}
 finally{release();}
 await expect.poll(()=>page.evaluate(domain=>window.rustBoot.instances[domain],domain)).toBe(1);
});
for(const [kind,domain] of [['core',0],['decor',1]]) test('offline '+kind+' keeps the saved shelf usable without a second startup request',async({page})=>{
 await observe(page);let requests=0;const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.route(`**/assets/inhouse_read_${kind}-*.wasm`,async route=>{requests++;await route.abort('internetdisconnected');});
 await page.goto('/');await firstFrame(page);expect(await page.evaluate(domain=>window.rustBoot.instances[domain],domain)).toBe(0);
 await expect.poll(()=>page.evaluate(domain=>window.rustBoot.instances[1-domain],domain)).toBe(1);expect(requests).toBe(1);expect(errors).toEqual([]);await expect(page.locator('.ihr-plant')).toHaveCount(1);
});
