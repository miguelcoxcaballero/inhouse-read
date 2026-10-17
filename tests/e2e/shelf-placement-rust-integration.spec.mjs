import { test,expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { spinePointerPosition } from './helpers/shelf-pointer.mjs';
import { settledGeometryLength } from './helpers/settled-geometry-length.mjs';

test('real book and plant drags use the compiled placement job and persist the chosen shelf',async({page},testInfo)=>{
  // Two real 12-step drags plus a reload of the 3D scene, on the same budget
  // scale as the existing four-drag 240-second placement journey.
  test.setTimeout(120_000);
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.setViewportSize({width:390,height:844});await page.emulateMedia({reducedMotion:'no-preference'});
  await page.addInitScript(()=>{
    window.placementProof={calls:0,pinned:0,ready:false};
    const observe=result=>{const instance=result.instance||result,actual=instance.exports;
      if(typeof actual?.shelf_place!=='function')return result;
      window.placementProof.ready=true;
      const exports={...actual,shelf_place(...args){
        const config=new Float64Array(actual.memory.buffer,args[2],7);
        window.placementProof.calls++;
        if(config[5]===2&&config[6]>=0)window.placementProof.pinned++;
        return actual.shelf_place(...args);
      }};
      const observed=new Proxy(instance,{get(target,key){return key==='exports'?exports:Reflect.get(target,key,target);}});
      return result.instance?{...result,instance:observed}:observed;};
    for(const name of ['instantiate','instantiateStreaming'])if(typeof WebAssembly[name]==='function'){
      const native=WebAssembly[name];WebAssembly[name]=async function(...args){return observe(await Reflect.apply(native,WebAssembly,args));};
    }
  });
  await page.goto(process.env.IHR_TEST_URL||'/');
  const bytes=[...await readFile('tests/e2e/fixtures/tiny.pdf')];
  await page.evaluate(async({bytes,geometry})=>{
    const db=await new Promise((resolve,reject)=>{const request=indexedDB.open('inhouse-read');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
    const tx=db.transaction('books','readwrite');
    for(let index=0;index<14;index++)tx.objectStore('books').put({
      id:`rust-placement:${index}`,title:`Libro ${index+1}`,name:`rust-placement-${index}.pdf`,format:'PDF',sourceType:'local',mimeType:'application/pdf',pageCount:100,
      ...geometry,content:new Blob([new Uint8Array(bytes)],{type:'application/pdf'}),shelfPosition:{shelf:Math.floor(index/4),x:[.18,.34,.5,.66][index%4]},shelfOrder:index,
      addedAt:Date.now(),lastOpenedAt:Date.now()-index,progressFraction:0,
    });
    await new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});db.close();
    localStorage.setItem('inhouse-read-shelf-plants',JSON.stringify([
      {key:'plant:rust-a',seed:'rust-a',variant:'cactus',width:42,shelf:0,x:.85},
      {key:'plant:rust-b',seed:'rust-b',variant:'suculenta',width:48,shelf:1,x:.18},
    ]));localStorage.setItem('inhouse-read-shelf-view','spine');
  },{bytes,geometry:await settledGeometryLength(30_000,'rust-placement')});
  await page.reload();await expect(page.locator('.ihr-spine')).toHaveCount(14);
  const scene=page.locator('.ihr-bookshelf-scene');await expect(scene).toHaveAttribute('data-animating','false');
  await page.waitForFunction(()=>window.placementProof?.ready);
  const object=key=>page.locator(`[data-object-id="${key}"]`);
  async function drag(key,target){
    const before=await page.evaluate(()=>window.placementProof.pinned),node=object(key),bounds=await node.boundingBox();
    expect(bounds).not.toBeNull();
    const grab=key.startsWith('plant:')?{x:bounds.width/2,y:bounds.height*.88}:await spinePointerPosition(node,bounds);
    await page.mouse.move(bounds.x+grab.x,bounds.y+grab.y);await page.mouse.down();await page.waitForTimeout(440);
    await expect(node).toHaveClass(/is-lifted/);
    // Four rendered previews exercise the two initial JS moves and actual
    // compiled moves afterwards; twelve pointer steps retain the real drag.
    const start={x:bounds.x+grab.x,y:bounds.y+grab.y};
    for(const fraction of [.25,.5,.75,1]){
      await page.mouse.move(start.x+(target.x-start.x)*fraction,start.y+(target.y-start.y)*fraction,{steps:3});
      await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    }
    await expect(scene).toHaveAttribute('data-drop-shelf','1');
    const chosen=Number(await scene.getAttribute('data-drop-x'));await page.mouse.up();
    await expect(page.locator('.ihr-bookshelf')).not.toHaveClass(/is-arranging/);
    await expect(scene).toHaveAttribute('data-animating','false');
    await expect(object(key)).toHaveAttribute('data-shelf-index','1');
    await expect.poll(()=>page.evaluate(()=>window.placementProof.pinned)).toBeGreaterThan(before);
    return chosen;
  }
  // Sixteen objects span two physical cabinets. Use a projected object in
  // shelf 1; a fraction of the whole canvas would target the other cabinet.
  const anchor=object('book:rust-placement:5');
  await expect(anchor).toHaveAttribute('data-shelf-index','1');
  const anchorBounds=await anchor.boundingBox(),secondPlant=await object('plant:rust-b').boundingBox();
  const chosen=await drag('book:rust-placement:0',{x:anchorBounds.x+anchorBounds.width/2,y:secondPlant.y+secondPlant.height-25});
  const bookBounds=await object('book:rust-placement:0').boundingBox();
  await drag('plant:rust-a',{x:bookBounds.x+bookBounds.width/2,y:bookBounds.y+bookBounds.height-25});
  const positions=await page.evaluate(async()=>{
    const db=await new Promise(resolve=>{const request=indexedDB.open('inhouse-read');request.onsuccess=()=>resolve(request.result);});
    const book=await new Promise(resolve=>{const request=db.transaction('books').objectStore('books').get('rust-placement:0');request.onsuccess=()=>resolve(request.result);});db.close();
    return {book:book.shelfPosition,plants:JSON.parse(localStorage.getItem('inhouse-read-shelf-plants')),proof:{...window.placementProof}};
  });
  expect(positions.book.shelf).toBe(1);expect(positions.plants.find(plant=>plant.key==='plant:rust-a').shelf).toBe(1);
  expect(positions.proof.pinned).toBeGreaterThan(1);
  await page.reload();await expect(object('book:rust-placement:0')).toHaveAttribute('data-shelf-index','1');
  await expect(object('plant:rust-a')).toHaveAttribute('data-shelf-index','1');
  expect(Number(await object('book:rust-placement:0').getAttribute('data-shelf-x'))).toBeCloseTo(positions.book.x,8);
  expect(errors).toEqual([]);
  await testInfo.attach('real-placement-proof',{body:JSON.stringify({chosen,positions},null,2),contentType:'application/json'});
});
