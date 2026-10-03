import { switchShelfView } from './helpers/shelf-view-gesture.mjs'
import { expect, test } from '@playwright/test';

test.use({ viewport:{ width:390,height:844 },hasTouch:true,isMobile:true,deviceScaleFactor:1 });

async function pinch(page,canvas,start,end) {
  const bounds = await canvas.boundingBox();
  const x = bounds.x + bounds.width / 2,y = bounds.y + Math.min(90,bounds.height / 2);
  const cdp = await page.context().newCDPSession(page);
  const points = distance => [
    { id:1,x:x-distance/2,y },{ id:2,x:x+distance/2,y }
  ];
  await cdp.send('Input.dispatchTouchEvent',{ type:'touchStart',touchPoints:points(start) });
  for (let sample=1;sample<=4;sample++) {
    await cdp.send('Input.dispatchTouchEvent',{
      type:'touchMove',touchPoints:points(start + (end-start)*sample/4)
    });
  }
  await cdp.send('Input.dispatchTouchEvent',{ type:'touchEnd',touchPoints:[] });
  await cdp.detach();
}

async function assertViewportFills(page,width) {
  const dimensions = await page.evaluate(() => {
    const scroller = document.querySelector('.ihr-bookshelf__scroll');
    const stage = document.querySelector('.ihr-shelf-stage');
    const canvas = document.querySelector('.ihr-bookshelf-scene');
    const rect = node => node.getBoundingClientRect().toJSON();
    return {
      scroller:rect(scroller),stage:rect(stage),canvas:rect(canvas),
      scrollHeight:scroller.scrollHeight,clientHeight:scroller.clientHeight,
      scrollWidth:scroller.scrollWidth,clientWidth:scroller.clientWidth,
      documentWidth:document.documentElement.scrollWidth,
      clip:getComputedStyle(stage).overflow
    };
  });
  for (const [name,bounds] of Object.entries({ scroller:dimensions.scroller,stage:dimensions.stage,canvas:dimensions.canvas })) {
    expect(Math.abs(bounds.left),`${name} reaches the left screen edge`).toBeLessThanOrEqual(1);
    expect(Math.abs(bounds.right-width),`${name} reaches the right screen edge`).toBeLessThanOrEqual(1);
  }
  expect(Math.abs(dimensions.stage.bottom-dimensions.scroller.bottom),'stage reaches the bottom of the screen').toBeLessThanOrEqual(1);
  expect(Math.abs(dimensions.canvas.bottom-dimensions.stage.bottom),'canvas covers the complete stage').toBeLessThanOrEqual(1);
  expect(dimensions.scrollHeight).toBeLessThanOrEqual(dimensions.clientHeight + 1);
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth + 1);
  expect(dimensions.documentWidth).toBeLessThanOrEqual(width);
  expect(dimensions.clip).toBe('clip');
}

for (const shelfType of ['walnut','baggebo']) {
  test(`${shelfType}: mobile scene reaches the screen edges while pinching and controls remain usable`,async ({ page },testInfo) => {
    test.setTimeout(120_000);
    const errors = []; page.on('pageerror',error => errors.push(error.message));
    await page.emulateMedia({ reducedMotion:'reduce' });
    await page.addInitScript(type => {
      localStorage.setItem('inhouse-read-shelf-type',type);
      localStorage.setItem('inhouse-read-shelf-view','isometric');
      localStorage.setItem('inhouse-read-shelf-plants','[]');
    },shelfType);
    const viewports = [{ width:320,height:568 },{ width:390,height:844 }];
    if (shelfType === 'baggebo') viewports.push({ width:844,height:390 });
    for (const viewport of viewports) {
      await page.setViewportSize(viewport);
      await page.goto('/');
      const canvas = page.locator('.ihr-bookshelf-scene');
      await expect(canvas).toHaveAttribute('data-animating','false');
      await expect(canvas).toHaveAttribute('data-shelf-type',shelfType);
      await expect(canvas).toHaveAttribute('data-full-cabinet-in-frame','true');
      await assertViewportFills(page,viewport.width);
      await pinch(page,canvas,80,144);
      await expect.poll(async () => Number(await canvas.getAttribute('data-inspection-zoom'))).toBeGreaterThan(1.5);
      await expect(canvas).toHaveAttribute('data-inspection-moving','false');
      await assertViewportFills(page,viewport.width);
      await testInfo.attach(`${shelfType}-zoom-${viewport.width}x${viewport.height}`,{
        body:await page.screenshot(),contentType:'image/png'
      });
      await pinch(page,canvas,160,60);
      await expect(canvas).toHaveAttribute('data-inspection-zoom','1.0000');
      await expect(canvas).toHaveAttribute('data-full-cabinet-in-frame','true');
      await page.getByRole('button',{ name:/Abrir catálogo IKEA/ }).tap();
      await expect(page.getByTestId('plant-catalog')).toBeVisible();
      await page.getByRole('button',{ name:'Cerrar catálogo' }).tap();
      await expect(page.getByTestId('plant-catalog')).toBeHidden();
      await switchShelfView(page, 'spine');
      await expect(canvas).toHaveAttribute('data-view-progress','0');
      await switchShelfView(page, 'isometric');
      await expect(canvas).toHaveAttribute('data-view-progress','1');
      // Reduced motion publishes its endpoint before the queued frame resizes
      // the canvas. Observe that rendered geometry before measuring the view.
      await page.waitForFunction(() => {
        const canvas = document.querySelector('.ihr-bookshelf-scene');
        const stage = document.querySelector('.ihr-shelf-stage');
        if (!canvas || !stage || canvas.dataset.viewProgress !== '1' || canvas.dataset.animating !== 'false') return false;
        const drawing = canvas.getBoundingClientRect(), bounds = stage.getBoundingClientRect();
        return Math.abs(drawing.left-bounds.left) <= 1 && Math.abs(drawing.right-bounds.right) <= 1 &&
          Math.abs(drawing.bottom-bounds.bottom) <= 1;
      },null,{ timeout:8_000 });
      await assertViewportFills(page,viewport.width);
    }
    expect(errors).toEqual([]);
  });
}

test('desktop keeps the centered shelf width limit',async ({ browser,baseURL }) => {
  const context = await browser.newContext({ baseURL,viewport:{ width:1440,height:900 },hasTouch:false,isMobile:false });
  try {
    const page = await context.newPage();
    await page.emulateMedia({ reducedMotion:'reduce' });
    await page.addInitScript(() => {
      localStorage.setItem('inhouse-read-shelf-view','isometric');
      localStorage.setItem('inhouse-read-shelf-plants','[]');
    });
    await page.goto('/');
    await expect(page.locator('.ihr-bookshelf-scene')).toHaveAttribute('data-animating','false');
    const bounds = await page.locator('.ihr-bookshelf__scroll').boundingBox();
    expect(bounds.width).toBe(860);
    expect(bounds.x).toBe((1440-860)/2);
  } finally {
    await context.close();
  }
});
