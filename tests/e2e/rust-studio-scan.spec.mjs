import {installEmptyUpdateChannels} from './helpers/empty-update-channels.mjs'
installEmptyUpdateChannels()
import {test,expect} from '@playwright/test'
test.use({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:1})
test('Rust validates the real half-float studio and a reload reuses every stored word',async({page},info)=>{
 test.setTimeout(90_000);const errors=[];page.on('pageerror',e=>errors.push(e.message))
 await page.addInitScript(()=>{
  localStorage.setItem('inhouse-read-shelf-plants','[]');window.studioScanProof={instances:0,calls:0,count:0,hash:2166136261,invalid:0}
  const observe=result=>{const instance=result.instance||result,actual=instance.exports;if(!actual.studio_half_scan)return result;window.studioScanProof.instances++;const exports={...actual}
   exports.studio_half_scan=(pointer,count)=>{const proof=window.studioScanProof,values=new Uint16Array(actual.memory.buffer,pointer,count);proof.calls++;proof.count+=count;for(const value of values)proof.hash=Math.imul(proof.hash^value,16777619)>>>0;const result=actual.studio_half_scan(pointer,count);if(result===0)proof.invalid++;return result}
   const proxy=new Proxy(instance,{get(target,key){return key==='exports'?exports:Reflect.get(target,key,target)}});return result.instance?{...result,instance:proxy}:proxy}
  for(const name of ['instantiate','instantiateStreaming'])if(WebAssembly[name]){const original=WebAssembly[name];WebAssembly[name]=async function(...args){return observe(await Reflect.apply(original,WebAssembly,args))}}
 })
 const stored=()=>page.evaluate(async()=>{const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('inhouse-read-studio',1);r.onupgradeneeded=()=>r.result.createObjectStore('atlas');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});try{const record=await new Promise(resolve=>{const r=db.transaction('atlas').objectStore('atlas').get('studio');r.onsuccess=()=>resolve(r.result)});if(!record)return null;let hash=2166136261;for(const value of record.data)hash=Math.imul(hash^value,16777619)>>>0;return {key:record.key,width:record.width,height:record.height,count:record.data.length,hash,settings:record.settings}}finally{db.close()}})
 await page.goto(process.env.IHR_TEST_URL||'./');await page.waitForFunction(()=>window.studioScanProof.calls>0)
 await expect.poll(stored,{timeout:30_000}).not.toBeNull();const first=await stored(),proof=await page.evaluate(()=>window.studioScanProof)
 expect(proof.instances).toBe(1);expect(proof.invalid).toBe(0);expect(proof.count).toBe(first.width*first.height*4);expect(proof.count).toBe(first.count);expect(proof.hash).toBe(first.hash)
 console.log(JSON.stringify({studioScan:proof,width:first.width,height:first.height}))
 await page.reload();await page.waitForFunction(()=>Number(document.querySelector('canvas.ihr-bookshelf-scene')?.dataset.renderCount)>0)
 expect(await stored()).toEqual(first);expect(await page.evaluate(()=>window.studioScanProof.calls)).toBe(0);expect(errors).toEqual([])
 await info.attach('original-half-float-studio',{body:JSON.stringify({proof,first,after:await stored()},null,2),contentType:'application/json'})
})
