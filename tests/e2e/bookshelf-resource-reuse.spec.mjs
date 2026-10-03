import { expect,test } from '@playwright/test';

test.use({ viewport:{ width:390,height:844 },hasTouch:true,isMobile:true,deviceScaleFactor:1 });
test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion:'no-preference' });
  await page.addInitScript(() => {
    localStorage.setItem('inhouse-read-shelf-view','isometric');
    localStorage.setItem('inhouse-read-shelf-plants','[]');
    localStorage.setItem('inhouse-read-shelf-lamps','[]');
    const seen = new WeakSet();
    window.__resourceReuse = { contexts:0,links:0,longTasks:[] };
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function(type,...args) {
      const context = getContext.call(this,type,...args);
      if (/^webgl/.test(type) && context && !seen.has(context)) {
        seen.add(context); window.__resourceReuse.contexts++;
      }
      return context;
    };
    for (const Type of [window.WebGLRenderingContext,window.WebGL2RenderingContext]) {
      if (!Type) continue;
      const link = Type.prototype.linkProgram;
      Type.prototype.linkProgram = function(...args) { window.__resourceReuse.links++; return link.apply(this,args); };
    }
    new PerformanceObserver(list => window.__resourceReuse.longTasks.push(...list.getEntries().map(entry => ({ start:entry.startTime,duration:entry.duration }))))
      .observe({ type:'longtask',buffered:true });
  });
  await page.goto('/');
  await expect(page.locator('.ihr-bookshelf-scene')).toHaveAttribute('data-view-progress','1',{ timeout:30_000 });
  await expect(page.locator('.ihr-bookshelf-scene')).toHaveAttribute('data-animating','false');
});

test('el catálogo conserva tres vistas perezosas, una única página visible y ningún dibujo oculto al reabrir',async ({ page },testInfo) => {
  test.setTimeout(90_000);
  const errors = []; page.on('pageerror',error => errors.push(error.message));
  const trigger = page.getByRole('button',{ name:/Abrir catálogo IKEA/ });
  const dialog = page.getByTestId('plant-catalog');
  await trigger.click();
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('canvas')).toHaveCount(1);
  const selectors = ['.ihr-plant-catalog__drawing:not(.ihr-plant-catalog__shelf-drawing):not(.ihr-plant-catalog__lamp-drawing)','.ihr-plant-catalog__shelf-drawing','.ihr-plant-catalog__lamp-drawing'];
  for (const [label,selector] of [['Plantas y macetas',selectors[0]],['Estanterías',selectors[1]],['Iluminación',selectors[2]]]) {
    await dialog.getByRole('button',{ name:label,exact:true }).click();
    const drawing = dialog.locator(selector);
    await expect(drawing).toHaveAttribute('data-renderer','three-mesh');
    await expect(drawing).toHaveAttribute('data-preview-active','true');
    await expect.poll(() => drawing.getAttribute('data-render-count')).not.toBeNull();
    await expect(dialog.locator('canvas:visible')).toHaveCount(1);
    expect(await drawing.locator('canvas').evaluate(canvas => {
      const pixels = canvas.getContext('webgl2') || canvas.getContext('webgl');
      return Boolean(pixels) && canvas.width > 1 && canvas.height > 1;
    })).toBe(true);
  }
  await expect(dialog.locator('canvas')).toHaveCount(3);
  await dialog.evaluate(node => {
    window.__catalogCanvases = [...node.querySelectorAll('canvas')];
    window.__catalogWarm = { ...window.__resourceReuse,longTasks:[...window.__resourceReuse.longTasks] };
  });
  await dialog.getByRole('button',{ name:'Cerrar catálogo' }).click();
  const suspended = await dialog.evaluate((node,selectors) => selectors.map(selector => node.querySelector(selector).dataset.renderCount),selectors);
  await page.evaluate(() => new Promise(resolve => setTimeout(resolve,250)));
  expect(await dialog.evaluate((node,selectors) => selectors.map(selector => node.querySelector(selector).dataset.renderCount),selectors)).toEqual(suspended);
  await expect(dialog.locator('[data-preview-active="true"]')).toHaveCount(0);
  await trigger.click();
  for (const label of ['Estanterías','Iluminación','Plantas y macetas']) {
    await dialog.getByRole('button',{ name:label,exact:true }).click();
    await expect(dialog.locator('canvas:visible')).toHaveCount(1);
  }
  const metrics = await dialog.evaluate(node => ({
    before:window.__catalogWarm,after:window.__resourceReuse,
    sameCanvases:[...node.querySelectorAll('canvas')].every((canvas,index) => canvas === window.__catalogCanvases[index])
  }));
  expect(metrics.sameCanvases).toBe(true);
  expect(metrics.after.contexts).toBe(metrics.before.contexts);
  expect(metrics.after.links).toBe(metrics.before.links);
  await testInfo.attach('catalog-reuse-metrics',{ body:JSON.stringify(metrics,null,2),contentType:'application/json' });
  expect(errors).toEqual([]);
});

test('al cerrar conserva el tomo del handoff, la página PDF real y todas las fases sin reconstruir su canvas',async ({ page },testInfo) => {
  test.setTimeout(120_000);
  const errors = []; page.on('pageerror',error => errors.push(error.message));
  await page.locator('#file-picker').setInputFiles('tests/e2e/fixtures/tiny.pdf');
  await expect(page.locator('.pdf-page-canvas')).toBeVisible();
  await page.getByRole('button',{ name:'Volver a la estantería' }).click();
  await expect(page.locator('body')).not.toHaveClass(/is-closing-reader|is-reading/,{ timeout:30_000 });
  const canvas = page.locator('.ihr-bookshelf-scene');
  await expect(canvas).toHaveAttribute('data-animating','false');
  await page.locator('.ihr-spine').click();
  await expect(page.getByRole('button',{ name:/Toca para leer/ })).toBeVisible();
  await page.locator('.ihr-flyout__book canvas').evaluate(node => { window.__liftedBookCanvas = node; });
  await page.getByRole('button',{ name:/Toca para leer/ }).click();
  await expect(page.locator('.ihr-flyout')).toHaveCount(0,{ timeout:20_000 });
  await expect(page.locator('#reader-toolbar')).toBeVisible();
  expect(await page.evaluate(() => window.__liftedBookCanvas.isConnected)).toBe(false);
  await page.evaluate(() => {
    window.__closeReuse = { phases:[],sameCanvas:false,pageSource:null,pageLocator:null,started:performance.now() };
    const observer = new MutationObserver(() => {
      const flyout = document.querySelector('.ihr-flyout--return');
      if (!flyout) return;
      const phase = flyout.dataset.returnPhase, canvas = flyout.querySelector('canvas');
      if (!window.__closeReuse.phases.includes(phase)) window.__closeReuse.phases.push(phase);
      if (phase !== 'preparing') {
        window.__closeReuse.sameCanvas = canvas === window.__liftedBookCanvas;
        window.__closeReuse.reuse = flyout.dataset.returnView;
        window.__closeReuse.pageSource = canvas?.dataset.pageSource;
        window.__closeReuse.pageLocator = canvas?.dataset.pageLocator;
      }
    });
    observer.observe(document.body,{ childList:true,subtree:true,attributes:true,attributeFilter:['data-return-phase'] });
    window.__closeReuseObserver = observer;
  });
  await page.getByRole('button',{ name:'Volver a la estantería' }).click();
  await expect(page.locator('body')).not.toHaveClass(/is-closing-reader|is-reading/,{ timeout:30_000 });
  await expect(page.locator('.ihr-flyout,.ihr-reader-return-page')).toHaveCount(0);
  await expect(page.locator('.ihr-spine')).not.toHaveClass(/is-away/);
  const metrics = await page.evaluate(() => { window.__closeReuseObserver.disconnect(); return { ...window.__closeReuse,elapsed:performance.now()-window.__closeReuse.started }; });
  expect(metrics.sameCanvas).toBe(true);
  expect(metrics.reuse).toBe('reused');
  expect(metrics.pageSource).toBe('pdf-canvas');
  expect(metrics.pageLocator).toBe(JSON.stringify({ kind:'pdf-page',value:1 }));
  expect(metrics.phases).toEqual(expect.arrayContaining(['zooming','bookmark','closing','returning','inserting']));
  await testInfo.attach('book-return-reuse-metrics',{ body:JSON.stringify(metrics,null,2),contentType:'application/json' });
  expect(errors).toEqual([]);
});
