import {test,expect} from '@playwright/test';
import {seedShelf,quietShelf,visibleMiddleBookPoint} from './helpers/reader-layout-fixture.mjs';
import {driveServer} from './helpers/drive-server.mjs';

test('desktop drag starts with movement without a touch long press, then books still open',async({page})=>{
 test.setTimeout(90000);
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.setViewportSize({width:1240,height:900});
 const scene=await seedShelf(page,{single:true});
 const point=await visibleMiddleBookPoint(page);expect(point).toBeTruthy();
 const book=page.locator('.ihr-spine');
 await page.mouse.move(point.x,point.y);await page.mouse.down();
 await page.mouse.move(point.x+30,point.y,{steps:3});
 await expect(book).toHaveClass(/is-dragging/,{timeout:1500});
 await page.mouse.up();await quietShelf(scene);
 const next=await visibleMiddleBookPoint(page);expect(next).toBeTruthy();
 await page.mouse.click(next.x,next.y);
 await expect(page.locator('.ihr-flyout')).toBeVisible({timeout:10000});
 expect(errors).toEqual([]);
});

test('a synced desktop room accepts local drag, interrupted capture and opening',async({browser})=>{
 test.setTimeout(120000);
 const drive=driveServer(),contexts=[],errors=[];
 try{
  const aContext=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});contexts.push(aContext);
  const a=await aContext.newPage();await seedShelf(a,{single:true});await drive.connect(aContext);await a.reload();
  await expect.poll(()=>drive.manifests().some(m=>m.books.length===1),{timeout:30000}).toBe(true);
  const bContext=await browser.newContext({viewport:{width:1240,height:900}});contexts.push(bContext);await drive.connect(bContext);
  const b=await bContext.newPage();b.on('pageerror',e=>errors.push(e.message));
  await b.goto(process.env.IHR_TEST_URL||'/inhouse-read/');await expect(b.locator('.ihr-spine')).toHaveCount(1);
  await quietShelf(b.locator('.ihr-bookshelf-scene'));
  const p=await visibleMiddleBookPoint(b);expect(p).toBeTruthy();
  await b.mouse.move(p.x,p.y);await b.mouse.down();await b.mouse.move(p.x+25,p.y,{steps:3});
  await expect(b.locator('.ihr-spine')).toHaveClass(/is-dragging/,{timeout:1500});
  await b.evaluate(()=>window.dispatchEvent(new Event('blur')));await b.mouse.up();
  await expect(b.locator('.ihr-spine')).not.toHaveClass(/is-dragging|is-lifted/);
  await quietShelf(b.locator('.ihr-bookshelf-scene'));
  const next=await visibleMiddleBookPoint(b);expect(next).toBeTruthy();await b.mouse.click(next.x,next.y);
  await expect(b.locator('.ihr-flyout')).toBeVisible({timeout:10000});expect(errors).toEqual([]);
 }finally{for(const c of contexts)await c.close()}
});
