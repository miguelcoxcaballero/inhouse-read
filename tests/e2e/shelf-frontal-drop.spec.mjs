import {test,expect} from '@playwright/test';
import {seedShelf,quietShelf,visibleMiddleBookPoint} from './helpers/reader-layout-fixture.mjs';

for(const shelfType of ['walnut','baggebo'])test(`front drop preserves unrelated objects on ${shelfType}`,async({page})=>{
 test.setTimeout(120000);
 await page.setViewportSize({width:390,height:844});
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 const scene=await seedShelf(page,{mode:'spine',shelfType});
 const resting=()=>page.evaluate(()=>[...document.querySelectorAll('.ihr-spine,.ihr-plant,.ihr-lamp')]
  .filter(n=>!['motion:book:2','motion:book:3'].includes(n.dataset.bookId))
  .map(n=>({id:n.dataset.objectId,lean:n.dataset.sceneLean,rect:[n.getBoundingClientRect().x,n.getBoundingClientRect().y,n.getBoundingClientRect().width,n.getBoundingClientRect().height]})));
 const before=await resting();
 const p=await visibleMiddleBookPoint(page);expect(p).toBeTruthy();
 await page.mouse.move(p.x,p.y);await page.mouse.down();await page.mouse.move(p.x+25,p.y,{steps:8});
 await expect(page.locator('.ihr-spine.is-dragging')).toHaveCount(1);
 await page.waitForTimeout(400);expect(await resting()).toEqual(before);
 await page.mouse.up();
 await expect(page.locator('.is-dragging')).toHaveCount(0);
 for(let i=0;i<5;i++){await page.waitForTimeout(250);expect(await resting()).toEqual(before);}
 await quietShelf(scene);
 expect(await resting()).toEqual(before);expect(errors).toEqual([]);
});

test('touch release of a lamp in front view leaves disconnected books resting',async({browser})=>{
 test.setTimeout(120000);
 const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
 try{
  const page=await context.newPage();const scene=await seedShelf(page,{mode:'spine',shelfType:'walnut'});
  const resting=()=>page.locator('.ihr-spine').evaluateAll(nodes=>nodes.map(n=>({id:n.dataset.bookId,lean:n.dataset.sceneLean,rect:[n.getBoundingClientRect().x,n.getBoundingClientRect().y]})));
  const before=await resting(),rect=await page.locator('.ihr-lamp').boundingBox();
  const x=rect.x+rect.width/2,y=rect.y+rect.height/2;
  const cdp=await context.newCDPSession(page);
  const touch=(type,x,y)=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints:type==='touchEnd'?[]:[{x,y,id:1}]});
  await touch('touchStart',x,y);await page.waitForTimeout(650);
  for(let i=1;i<=6;i++){await touch('touchMove',x+i*5,y);await page.waitForTimeout(60);}
  await expect(page.locator('.ihr-lamp.is-dragging')).toHaveCount(1);
  await touch('touchEnd',x+30,y);await quietShelf(scene);
  expect(await resting()).toEqual(before);
 }finally{await context.close();}
});
