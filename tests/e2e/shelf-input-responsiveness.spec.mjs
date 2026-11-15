import {test,expect} from '@playwright/test';
import {seedShelf,quietShelf,visibleMiddleBookPoint} from './helpers/reader-layout-fixture.mjs';
import {driveServer,SYNCED_FIRST_SHELF} from './helpers/drive-server.mjs';

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
  // The second client opens in the view the room is kept in, as the first one does (seedShelf). Left on the default front
  // view it first turns its camera to the synced diagonal one and shows the synced book only when that turn ends; the
  // turn advances at most 50 ms per rendered frame, so it is fourteen or more frames whatever they cost: 0.7 s on a GPU,
  // 18 s of this 1240x900 canvas in software WebGL (first spine at 27-31 s, against 10-13 s without the turn; 1.7.328
  // and 1.7.339 alike). This case is about pointer input in the synced room, not about that turn.
  await bContext.addInitScript(()=>{if(/^https?:$/.test(location.protocol))localStorage.setItem('inhouse-read-shelf-view','isometric')});
  const b=await bContext.newPage();b.on('pageerror',e=>errors.push(e.message));
  await b.goto(process.env.IHR_TEST_URL||'/inhouse-read/');await expect(b.locator('.ihr-spine')).toHaveCount(1,{timeout:SYNCED_FIRST_SHELF});
  await quietShelf(b.locator('.ihr-bookshelf-scene'));
  const p=await visibleMiddleBookPoint(b);expect(p).toBeTruthy();
  await b.mouse.move(p.x,p.y);await b.mouse.down();await b.mouse.move(p.x+25,p.y,{steps:3});
  await expect(b.locator('.ihr-spine')).toHaveClass(/is-dragging/,{timeout:1500});
  // The window loses focus with the button still held: the drag ends there and the book goes back to its place.
  await b.evaluate(()=>window.dispatchEvent(new Event('blur')));
  await expect(b.locator('.ihr-spine')).not.toHaveClass(/is-dragging|is-lifted/);
  await quietShelf(b.locator('.ihr-bookshelf-scene'));
  // The hand lets go later, over the book: that release makes a click on the book. It belongs to the drag that was
  // interrupted and must not open the book. Until 1.8.2 it did whenever the release came once the book was back under
  // the pointer, which is what the slow CI runners produced (the flyout was already open when the next tap was sought,
  // so there was no book to tap: 1.8.1 on both attempts, 1.8.2 on the first); released at once it missed the book.
  const held=await visibleMiddleBookPoint(b);expect(held).toBeTruthy();
  await b.evaluate(()=>{window.__releaseClick=null;addEventListener('click',event=>{window.__releaseClick=Boolean(event.target.closest?.('.ihr-spine'))},{capture:true,once:true})});
  await b.mouse.move(held.x,held.y);await b.mouse.up();
  await expect.poll(()=>b.evaluate(()=>window.__releaseClick)).toBe(true);
  await quietShelf(b.locator('.ihr-bookshelf-scene'));await expect(b.locator('.ihr-flyout')).toHaveCount(0);
  const next=await visibleMiddleBookPoint(b);expect(next).toBeTruthy();await b.mouse.click(next.x,next.y);
  await expect(b.locator('.ihr-flyout')).toBeVisible({timeout:10000});expect(errors).toEqual([]);
 }finally{for(const c of contexts)await c.close()}
});
