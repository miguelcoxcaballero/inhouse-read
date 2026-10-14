import {test,expect} from '@playwright/test'
import {openCompiledReaderApp} from './helpers/compiled-reader.mjs'
import {switchShelfView} from './helpers/shelf-view-gesture.mjs'
test.use({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:1})
for(const delayed of [false,true])test('Rust preserves the actual foliage pointer surface'+(delayed?' after a pending module':''),async({page},info)=>{
 test.setTimeout(90_000);const errors=[];page.on('pageerror',error=>errors.push(error.message));await page.emulateMedia({reducedMotion:'reduce'});
 await page.addInitScript(()=>{
  localStorage.setItem('inhouse-read-shelf-plants',JSON.stringify([{key:'native-monstera',seed:'native-monstera',catalogId:'monstera',potId:'gradvis',shelf:0,x:.25},{key:'native-cactus',seed:'native-cactus',catalogId:'cactus',potId:'akerbar',shelf:0,x:.7}]));window.foliageProof={available:false,calls:0};
  const observe=result=>{const instance=result.instance||result,actual=instance.exports;if(!actual.foliage_path)return result;window.foliageProof.available=true;const exports={...actual,foliage_path:(...args)=>{window.foliageProof.calls++;return actual.foliage_path(...args)}};const proxy=new Proxy(instance,{get(target,key){return key==='exports'?exports:Reflect.get(target,key,target)}});return result.instance?{...result,instance:proxy}:proxy};for(const name of ['instantiate','instantiateStreaming'])if(WebAssembly[name]){const original=WebAssembly[name];WebAssembly[name]=async function(...args){return observe(await Reflect.apply(original,WebAssembly,args))}};
 });
 let release;const gate=new Promise(resolve=>{release=resolve}),active=new Set(),pattern=/\/assets\/inhouse_read_ui_bg-[\w-]+\.wasm$/;const hold=route=>{const work=(async()=>{await gate;await route.continue()})();active.add(work);work.then(()=>active.delete(work),()=>active.delete(work));return work};if(delayed)await page.route(pattern,hold);
 try{
  if(delayed)await page.goto(process.env.IHR_TEST_URL||'./');else await openCompiledReaderApp(page);
  const scene=page.locator('.ihr-bookshelf-scene'),foliage=page.locator('.ihr-plant-foliage');await expect(scene).toBeVisible();await expect(foliage).toHaveCount(2);await expect(scene).toHaveAttribute('data-animating','false');await expect.poll(()=>foliage.evaluateAll(nodes=>nodes.every(node=>Number(node.dataset.triangles)>0))).toBe(true);
  const paths=await page.locator('.ihr-plant-foliage').evaluateAll(nodes=>nodes.map(node=>node.lastElementChild.getAttribute('d')));
  if(delayed){expect(await page.evaluate(()=>window.foliageProof.available)).toBe(false);release();await page.waitForFunction(()=>window.foliageProof.available)}
  await switchShelfView(page,'isometric');await expect(scene).toHaveAttribute('data-animating','false',{timeout:30_000});await switchShelfView(page,'spine');await expect(scene).toHaveAttribute('data-animating','false',{timeout:30_000});await page.waitForFunction(()=>window.foliageProof.calls>0);
  const after=await foliage.evaluateAll(nodes=>nodes.map(node=>node.lastElementChild.getAttribute('d')));expect(after).toEqual(paths);expect(after.every(path=>path?.startsWith('M'))).toBe(true);expect(errors).toEqual([]);await info.attach('compiled-foliage',{body:JSON.stringify(await page.evaluate(()=>window.foliageProof)),contentType:'application/json'});
 }finally{release();await Promise.allSettled([...active]);if(delayed&&!page.isClosed())await page.unroute(pattern,hold)}
});
