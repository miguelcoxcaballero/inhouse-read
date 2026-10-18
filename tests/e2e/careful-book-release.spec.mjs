import {test,expect} from '@playwright/test';
import {seedShelf,quietShelf,visibleMiddleBookPoint} from './helpers/reader-layout-fixture.mjs';
test.use({viewport:{width:390,height:844},hasTouch:true,isMobile:true,deviceScaleFactor:1});
test('a careful touch placement stands upright and a small final touch stroke falls to either side',async({page},info)=>{
 test.setTimeout(240_000);await page.emulateMedia({reducedMotion:'reduce'});
 const scene=await seedShelf(page,{single:true,mode:'isometric'}),touch=await page.context().newCDPSession(page),proof=[];
 let stamp;
 const finger=async(type,x,y)=>touch.send('Input.dispatchTouchEvent',{type,timestamp:stamp,touchPoints:type==='touchEnd'?[]:[{x,y,id:1}]});
 const start=async()=>{
  const point=await visibleMiddleBookPoint(page,[.5,.7,.3]);expect(point).not.toBeNull();
  const book=page.locator(`[data-book-id="${point.id}"]`).first();await finger('touchStart',point.x,point.y);
  await expect(book).toHaveClass(/is-lifted/);await expect.poll(async()=>Math.abs(Number(await book.getAttribute('data-scene-lean')))).toBeLessThan(.01);
  return{point,book};
 };
 let {point,book}=await start();
 for(let frame=1;frame<=12;frame++){await finger('touchMove',point.x+frame,point.y);await page.waitForTimeout(16);}
 await page.waitForTimeout(500);await finger('touchEnd');await quietShelf(scene);
 expect(Math.abs(Number(await book.getAttribute('data-scene-lean')))).toBeLessThan(.015);
 proof.push({gesture:'careful',angle:Number(await book.getAttribute('data-scene-lean'))});
 await page.reload();await quietShelf(page.locator('.ihr-bookshelf-scene'));
 expect(Math.abs(Number(await page.locator('.ihr-spine').getAttribute('data-scene-lean')))).toBeLessThan(.015);
 for(const direction of [-1,1]){
  ({point,book}=await start());
  const origin=await page.evaluate(()=>Date.now()/1000);
  for(let frame=1;frame<=4;frame++){stamp=origin+frame*.016;await finger('touchMove',point.x+direction*frame,point.y);}
  stamp=origin+.080;await finger('touchEnd');stamp=undefined;await expect.poll(async()=>Number(await book.getAttribute('data-scene-lean'))*direction).toBeLessThan(-.7);
  await quietShelf(page.locator('.ihr-bookshelf-scene'));proof.push({gesture:'sideways',direction,angle:Number(await book.getAttribute('data-scene-lean'))});
 }
 expect(proof[0].angle).toBeCloseTo(0,2);
 const renders=await page.locator('.ihr-bookshelf-scene').getAttribute('data-render-count');await page.waitForTimeout(500);
 expect(await page.locator('.ihr-bookshelf-scene').getAttribute('data-render-count')).toBe(renders);
 await info.attach('touch-release-intent',{body:JSON.stringify(proof),contentType:'application/json'});
 await touch.detach();
});
