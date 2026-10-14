import {test,expect} from '@playwright/test'
import {openCompiledReaderApp} from './helpers/compiled-reader.mjs'
import {switchShelfView} from './helpers/shelf-view-gesture.mjs'
import {waitForFinalBookGeometry} from './helpers/final-book-geometry.mjs'
test.use({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:1})
for(const delayed of [false,true])test('compiled IKEA catalogue preserves selection and uses Rust'+(delayed?' after a pending download':''),async({page},info)=>{
 test.setTimeout(90_000);const errors=[];page.on('pageerror',error=>errors.push(error.message));await page.emulateMedia({reducedMotion:'reduce'})
 await page.addInitScript(()=>{
  localStorage.setItem('inhouse-read-shelf-plants','[]');window.catalogueProof={available:false,calls:{}}
  const observe=result=>{const instance=result.instance||result,actual=instance.exports;if(!actual.rustcatalogcontroller_new)return result;window.catalogueProof.available=true;const exports={...actual};
   for(const name of ['catalog_build','catalog_colors','rustcatalogcontroller_new','rustcatalogcontroller_open','rustcatalogcontroller_close','rustcatalogcontroller_prepare','catalog_illustration','catalog_frond_fractions','catalog_frond_numbers','catalog_frond_illustration'])if(actual[name])exports[name]=(...args)=>{window.catalogueProof.calls[name]=(window.catalogueProof.calls[name]||0)+1;return actual[name](...args)}
   const proxy=new Proxy(instance,{get(target,key){return key==='exports'?exports:Reflect.get(target,key,target)}});return result.instance?{...result,instance:proxy}:proxy}
  for(const name of ['instantiate','instantiateStreaming'])if(WebAssembly[name]){const original=WebAssembly[name];WebAssembly[name]=async function(...args){return observe(await Reflect.apply(original,WebAssembly,args))}}
 })
 let release;const gate=new Promise(resolve=>{release=resolve}),pattern=/\/assets\/inhouse_read_ui_bg-[\w-]+\.wasm$/,active=new Set();const hold=route=>{const work=(async()=>{await gate;await route.continue()})();active.add(work);work.then(()=>active.delete(work),()=>active.delete(work));return work}
 if(delayed)await page.route(pattern,hold)
 try{
  if(delayed)await page.goto('./');else{
   await openCompiledReaderApp(page);await page.locator('#file-picker').setInputFiles('tests/e2e/fixtures/tiny.pdf');await expect(page.locator('.pdf-page-canvas')).toBeVisible();await waitForFinalBookGeometry(page,'tiny.pdf');await page.getByRole('button',{name:'Volver a la estantería'}).click();await expect(page.locator('.ihr-flyout')).toHaveCount(0)
  }
  await expect(page.locator('.ihr-bookshelf-scene')).toBeVisible();await switchShelfView(page,'isometric');await expect(page.locator('.ihr-bookshelf-scene')).toHaveAttribute('data-animating','false',{timeout:30_000})
  await page.getByRole('button',{name:'Abrir catálogo IKEA de plantas, estanterías e iluminación'}).click();const dialog=page.getByTestId('plant-catalog')
  // The catalogue has no JavaScript twin: a tap during a pending download waits for the module instead of opening a different dialog.
  if(delayed){await page.waitForTimeout(1500);expect(await page.evaluate(()=>window.catalogueProof.available)).toBe(false);await expect(dialog).toHaveCount(0);release();await page.waitForFunction(()=>window.catalogueProof.available)}
  await expect(dialog).toBeVisible()
  await page.evaluate(()=>{window.catalogueRoot=document.querySelector('[data-testid="plant-catalog"]')})
  await dialog.locator('[data-catalog-pot="gradvis"]').click();await expect(dialog.locator('[data-catalog-pot="gradvis"]')).toHaveAttribute('aria-pressed','true');await expect(dialog.locator('.ihr-plant-catalog__pot-name')).toHaveText('GRADVIS')
  await dialog.locator('[data-catalog-plant="cactus"]').click();await expect(dialog.locator('[data-catalog-plant="cactus"]')).toHaveAttribute('aria-pressed','true');await expect(dialog.locator('.ihr-plant-catalog__caption h3').first()).toHaveText('FEJKA')
  await dialog.locator('[data-catalog-color="slate"]').click();await expect(dialog.locator('[data-catalog-color="slate"]')).toHaveAttribute('aria-pressed','true')
  await dialog.locator('[data-catalog-pot="muskot"]').click();await dialog.locator('[data-catalog-pot="gradvis"]').click();await expect(dialog.locator('[data-catalog-color="slate"]')).toHaveAttribute('aria-pressed','true')
  await dialog.locator('[data-catalog-page="shelves"]').click();await expect(dialog.locator('h2')).toHaveText('ESTANTERÍAS');await dialog.locator('[data-catalog-shelf="baggebo"]').click();await expect(dialog.locator('[data-catalog-shelf="baggebo"]')).toHaveAttribute('aria-pressed','true')
  await dialog.locator('[data-catalog-page="lights"]').click();await expect(dialog.locator('h2')).toHaveText('ILUMINACIÓN');await dialog.locator('[data-catalog-kelvin="4000"]').click();await expect(dialog.locator('[data-catalog-kelvin="4000"]')).toHaveAttribute('aria-pressed','true')
  expect(await page.evaluate(()=>window.catalogueRoot===document.querySelector('[data-testid="plant-catalog"]'))).toBe(true)
  const proof=await page.evaluate(()=>window.catalogueProof);expect(proof.calls.rustcatalogcontroller_new).toBe(1);expect(proof.calls.rustcatalogcontroller_open).toBeGreaterThan(0)
  {expect(proof.calls.catalog_build).toBeGreaterThan(0);for(const name of ['catalog_illustration','catalog_frond_fractions','catalog_frond_numbers','catalog_frond_illustration'])expect(proof.calls[name]).toBeGreaterThan(0)}
  await info.attach('compiled-catalogue-kernels',{body:JSON.stringify(proof,null,2),contentType:'application/json'});await dialog.getByRole('button',{name:'Cerrar catálogo'}).click();await expect(dialog).not.toBeVisible();expect(errors).toEqual([])
 }finally{release();await Promise.allSettled([...active]);if(delayed&&!page.isClosed())await page.unroute(pattern,hold)}
})
