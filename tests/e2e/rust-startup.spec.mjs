import {test,expect} from '@playwright/test';
test.use({viewport:{width:390,height:844},hasTouch:true,isMobile:true,deviceScaleFactor:1});
async function observe(page){
 await page.addInitScript(()=>{
  localStorage.setItem('inhouse-read-shelf-plants',JSON.stringify([{key:'plant:startup',seed:'startup',catalogId:'monstera',variant:'monstera',potId:'gradvis',width:260,height:350,shelf:0,x:.4}]));
  const stats=window.rustBoot={instances:0,calls:0};
  for(const name of ['instantiate','instantiateStreaming'])if(WebAssembly[name]){
   const original=WebAssembly[name].bind(WebAssembly);
   WebAssembly[name]=async(...args)=>{const result=await original(...args);if(!result.instance?.exports.core_abi_version)return result;
    stats.instances++;const exports={};for(const [key,value]of Object.entries(result.instance.exports))exports[key]=typeof value==='function'&&key.startsWith('plant_')?function(...input){stats.calls++;return value(...input);}:value;
    return{module:result.module,instance:{exports}};
   };
  }
 });
}
async function firstFrame(page){await expect.poll(()=>page.locator('canvas.ihr-bookshelf-scene').getAttribute('data-render-count').then(Number)).toBeGreaterThan(0);}
test('early core shares one actual request and instance with the live shelf',async({page})=>{
 await observe(page);const errors=[],requests=[];page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>{if(request.url().includes('inhouse_read_core')&&request.url().endsWith('.wasm'))requests.push(request.url());});
 await page.goto('/');await firstFrame(page);await expect.poll(()=>page.evaluate(()=>window.rustBoot.calls)).toBeGreaterThan(0);
 const state=await page.evaluate(()=>({instances:window.rustBoot.instances,adopted:!('__inhouseRustReady'in window),url:document.getElementById('ihr-rust-core').href}));
 expect(state.instances).toBe(1);expect(state.adopted).toBe(true);expect(requests).toEqual([state.url]);expect(errors).toEqual([]);
});
test('a pending Rust download never holds the first shelf frame',async({page})=>{
 await observe(page);let release;const gate=new Promise(r=>release=r);
 await page.route('**/assets/inhouse_read_core-*.wasm',async route=>{await gate;await route.continue();});
 try{await page.goto('/',{waitUntil:'domcontentloaded'});await firstFrame(page);expect(await page.evaluate(()=>window.rustBoot.instances)).toBe(0);}
 finally{release();}
 await expect.poll(()=>page.evaluate(()=>window.rustBoot.instances)).toBe(1);
});
test('offline core keeps the saved shelf usable without a second startup request',async({page})=>{
 await observe(page);let requests=0;const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/assets/inhouse_read_core-*.wasm',async route=>{requests++;await route.abort('internetdisconnected');});
 await page.goto('/');await firstFrame(page);expect(await page.evaluate(()=>window.rustBoot.instances)).toBe(0);
 expect(requests).toBe(1);expect(errors).toEqual([]);await expect(page.locator('.ihr-plant')).toHaveCount(1);
});
