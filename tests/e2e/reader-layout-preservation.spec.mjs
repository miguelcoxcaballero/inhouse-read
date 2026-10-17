import {test,expect} from '@playwright/test';
import {seedShelf,quietShelf,visibleMiddleBookPoint} from './helpers/reader-layout-fixture.mjs';
test.use({viewport:{width:390,height:844},hasTouch:true,isMobile:true,deviceScaleFactor:1});
async function layout(page){return page.evaluate(()=>({
 poses:JSON.parse(localStorage.getItem('inhouse-read-shelf-physics-v1')),
 plants:JSON.parse(localStorage.getItem('inhouse-read-shelf-plants')),
 lamps:JSON.parse(localStorage.getItem('inhouse-read-shelf-lamps'))
}));}
function sameLayout(actual,expected,reload=false){
 expect(actual.plants).toEqual(expected.plants);expect(actual.lamps).toEqual(expected.lamps);
 expect(actual.poses[1]).toEqual(expected.poses[1]);expect(actual.poses[2]).toHaveLength(expected.poses[2].length);
 for(const old of expected.poses[2]){
  const now=actual.poses[2].find(row=>row[0]===old[0]);expect(now,'same object '+old[0]).toBeDefined();
  expect(now.slice(0,2)).toEqual(old.slice(0,2));
  // Metadata round-trips can change an f64 dimension by < 1e-15; physical
  // coordinates remain bit exact and must never inherit that recalculation.
  for(const field of [2,3])for(let i=0;i<old[field].length;i++)expect(now[field][i]).toBeCloseTo(old[field][i],12);
  expect(now[4]).toEqual(old[4]);expect(now[5]).toBe(old[5]);expect(now[6]).toBe(old[6]);
  if(reload)expect(now[7]).toBeCloseTo(old[7],6);else expect(now[7]).toBe(old[7]);
  expect(now.slice(8)).toEqual(old.slice(8));
 }
}
for(const mode of ['spine','isometric'])test(`reading and dismissing a selected book preserve the exact shelf layout (${mode})`,async({page},info)=>{
 test.setTimeout(240_000);await page.emulateMedia({reducedMotion:'reduce'});
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 const scene=await seedShelf(page,{mode});const before=await layout(page);
 expect(before.poses[2].some(row=>row[1]===0&&Math.abs(row[7])>.3)).toBe(true);
 const point=await visibleMiddleBookPoint(page,[.5,.7,.3],0);expect(point).not.toBeNull();
 const selected=page.locator(`[data-book-id="${point.id}"]`).first();
 await page.touchscreen.tap(point.x,point.y);await expect(page.locator('.ihr-flyout.is-ready')).toBeVisible();
 await page.keyboard.press('Escape');await expect(page.locator('.ihr-flyout')).toHaveCount(0);
 await quietShelf(scene);sameLayout(await layout(page),before);
 for(let cycle=0;cycle<2;cycle++){
  // Keyboard targets the same real book after any changed camera projection.
  await selected.focus();await selected.press('Enter');
  const cover=page.locator('.ihr-flyout__cover-target');await expect(cover).toBeVisible();await cover.click();
  await expect(page.locator('#reader-toolbar')).toBeVisible();await expect(page.locator('.pdf-page-canvas')).toBeVisible();
  await page.getByRole('button',{name:'Volver a la estantería'}).click();
  await expect(page.locator('.ihr-flyout')).toHaveCount(0);await expect(page.locator('body')).not.toHaveClass(/is-reading|is-closing-reader/);
  await quietShelf(page.locator('.ihr-bookshelf-scene'));sameLayout(await layout(page),before);
 }
 await page.reload();await quietShelf(page.locator('.ihr-bookshelf-scene'));sameLayout(await layout(page),before,true);
 expect(errors).toEqual([]);await info.attach('exact-reading-layout',{body:JSON.stringify({before,after:await layout(page)}),contentType:'application/json'});
});
