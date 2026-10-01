import { expect, test } from '@playwright/test';

test.use({viewport:{width:390,height:844},hasTouch:true,isMobile:true,deviceScaleFactor:2});
const point=(id,x,y)=>({id,x,y});
async function pinch(cdp,x,y,start,end) {
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[point(1,x-start/2,y),point(2,x+start/2,y)]});
  for(let i=1;i<=3;i++) {
    const distance=start+(end-start)*i/3;
    await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[point(1,x-distance/2,y),point(2,x+distance/2,y)]});
  }
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
}

test('finger-only zoom preserves book interaction, promotes textures, pans and resets with a pinch',async ({page})=>{
  test.setTimeout(120_000);
  await page.emulateMedia({reducedMotion:'reduce'});
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(()=>localStorage.setItem('inhouse-read-shelf-plants',JSON.stringify([
    {key:'plant:zoom-test',seed:'zoom-test',catalogId:'sansevieria',variant:'sansevieria',potId:'muskot',width:42,height:124,shelf:0,x:.6}
  ])));
  await page.goto('/');
  await page.locator('#file-picker').setInputFiles('tests/e2e/fixtures/tiny.pdf');
  await expect(page.locator('.pdf-page-canvas')).toBeVisible();
  await page.getByRole('button',{name:'Volver a la estantería'}).click();
  await expect(page.locator('.ihr-flyout')).toHaveCount(0);
  await page.getByRole('button',{name:'Vista isométrica, libros de lado'}).click();
  const canvas=page.locator('.ihr-bookshelf-scene'),scroller=page.locator('.ihr-bookshelf__scroll');
  await expect(canvas).toHaveAttribute('data-view-progress','1');
  await expect(canvas).toHaveAttribute('data-animating','false');
  await expect(page.getByRole('group',{name:'Zoom de la estantería',exact:true})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Acercar estantería',exact:true})).toHaveCount(0);
  const initialHeight=await scroller.evaluate(node=>node.scrollHeight),frame=await canvas.boundingBox();
  const cdp=await page.context().newCDPSession(page),x=frame.x+frame.width/2,y=frame.y+190;
  await pinch(cdp,x,y,140,190);
  await expect.poll(async()=>Number(await canvas.getAttribute('data-inspection-zoom'))).toBeGreaterThan(1.2);
  await expect(canvas).toHaveAttribute('data-inspection-moving','false');
  await expect(canvas).toHaveAttribute('data-high-resolution-books','1');
  await expect(canvas).toHaveAttribute('data-high-resolution-plants','1',{timeout:30_000});
  expect(await scroller.evaluate(node=>node.scrollHeight)).toBe(initialHeight);
  const px=frame.x+frame.width*.72,py=frame.y+frame.height*.4;
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[point(1,px,py)]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[point(1,px+70,py)]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await expect.poll(async()=>JSON.parse(await canvas.getAttribute('data-inspection-pan'))[0]).toBeGreaterThan(40);
  await expect(canvas).toHaveAttribute('data-inspection-moving','false');
  await page.locator('.ihr-spine').first().tap();
  await expect(page.getByRole('button',{name:/Toca para leer/})).toBeVisible();
  await page.getByRole('button',{name:'Cerrar',exact:true}).click();
  await expect(page.locator('.ihr-flyout')).toHaveCount(0);
  await pinch(cdp,x,y,180,60);
  await expect(canvas).toHaveAttribute('data-inspection-zoom','1.0000');
  await expect(canvas).toHaveAttribute('data-full-cabinet-in-frame','true');
  await page.mouse.move(x,y);await page.mouse.wheel(0,-150);
  await expect(canvas).toHaveAttribute('data-inspection-zoom','1.0000');
  await expect(page.locator('.ihr-spine.is-dragging')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('a finger flick coasts and a fresh touch stops it without losing the fitted viewport',async ({page})=>{
  test.setTimeout(90_000);
  await page.emulateMedia({reducedMotion:'no-preference'});
  await page.addInitScript(()=>localStorage.setItem('inhouse-read-shelf-plants','[]'));
  await page.goto('/');await page.getByRole('button',{name:'Vista isométrica, libros de lado'}).click();
  const canvas=page.locator('.ihr-bookshelf-scene');await expect(canvas).toHaveAttribute('data-view-progress','1');
  const frame=await canvas.boundingBox(),cdp=await page.context().newCDPSession(page),x=frame.x+frame.width/2,y=frame.y+90;
  await pinch(cdp,x,y,100,200);
  await expect.poll(async()=>Number(await canvas.getAttribute('data-inspection-zoom'))).toBeGreaterThan(1.8);
  await expect(canvas).toHaveAttribute('data-inspection-moving','false');
  const px=frame.x+120,py=frame.y+150;
  const startPan=JSON.parse(await canvas.getAttribute('data-inspection-pan'))[0],stamp=Date.now()/1000;
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',timestamp:stamp,touchPoints:[point(1,px,py)]});
  for(let i=1;i<=3;i++) {
    await page.waitForTimeout(16); // input samples from a deliberate short flick
    await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',timestamp:stamp+i*.016,touchPoints:[point(1,px+20*i,py)]});
  }
  // Hardware timestamps keep the flick's duration independent of GPU/test-driver delays.
  const release=startPan+60;
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',timestamp:stamp+.064,touchPoints:[]});
  await expect.poll(async()=>JSON.parse(await canvas.getAttribute('data-inspection-pan'))[0],{timeout:3000}).toBeGreaterThan(release+1);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[point(1,px,py)]});
  const stopped=JSON.parse(await canvas.getAttribute('data-inspection-pan'))[0];
  await page.waitForTimeout(100);expect(JSON.parse(await canvas.getAttribute('data-inspection-pan'))[0]).toBe(stopped);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await expect(canvas).toHaveAttribute('data-inspection-moving','false');
  await page.getByRole('button',{name:'Vista de canto',exact:true}).click();
  await expect(canvas).toHaveAttribute('data-inspection-zoom','1.0000');
});
