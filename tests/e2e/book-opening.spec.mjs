import { test, expect } from '@playwright/test'
import { collapse as collapseCfi } from 'foliate-js/epubcfi.js'
import { deflateSync } from 'node:zlib'

test.use({ viewport:{ width:390, height:844 }, hasTouch:true, isMobile:true, deviceScaleFactor:1 })
test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion:'no-preference' })
  await page.goto(process.env.IHR_TEST_URL || '/')
})

// Each page has its own printed colour. A correct location label on a beige
// placeholder is insufficient: the lifted book must actually show blue page 3.
function colouredPdf() {
  const colours = ['.72 .08 .15', '.1 .52 .23', '.08 .22 .78', '.69 .42 .08']
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [4 0 R 6 0 R 8 0 R 10 0 R] /Count 4 >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
  ]
  for (let i=0; i<4; i++) {
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 600] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5+i*2} 0 R >>`)
    const heading = i === 2 ? 'Saved blue page. Page 3.' : `Printed page ${i+1}.`
    const stream = `${colours[i]} rg 0 0 400 600 re f\n1 1 1 rg BT /F1 23 Tf 32 540 Td (${heading}) Tj 0 -40 Td /F1 14 Tf (This is the actual page in the document.) Tj 0 -26 Td (The bookmark belongs to this saved place.) Tj ET`
    objects.push(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`)
  }
  let output = '%PDF-1.4\n'
  const offsets = [0]
  objects.forEach((object, i) => {
    offsets.push(Buffer.byteLength(output))
    output += `${i+1} 0 obj\n${object}\nendobj\n`
  })
  const xref = Buffer.byteLength(output)
  output += `xref\n0 ${objects.length+1}\n0000000000 65535 f \n`
  output += offsets.slice(1).map(offset => `${String(offset).padStart(10,'0')} 00000 n \n`).join('')
  output += `trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(output)
}

function crc32(bytes) {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit=0;bit<8;bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function colouredPng(colour) {
  const width = 400, height = 600
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width,0); header.writeUInt32BE(height,4)
  header[8] = 8; header[9] = 2 // 8-bit RGB, no palette/interlacing
  const row = Buffer.alloc(1+width*3)
  for (let x=0;x<width;x++) row.set(colour,1+x*3)
  const rows = Buffer.concat(Array.from({ length:height }, () => row))
  const chunk = (name,data) => {
    const type = Buffer.from(name), length = Buffer.alloc(4), crc = Buffer.alloc(4)
    length.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(Buffer.concat([type,data])))
    return Buffer.concat([length,type,data,crc])
  }
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),
    chunk('IHDR',header),chunk('IDAT',deflateSync(rows)),chunk('IEND',Buffer.alloc(0))])
}

function colouredComic() {
  // Foliate's bundled fflate contains only its inflater. This small uncompressed
  // ZIP fixture avoids adding a production/test dependency for three PNG pages.
  const local = [], central = []
  let offset = 0
  const colours = [[184,20,40],[25,132,59],[20,56,199]]
  for (let index=0;index<3;index++) {
    const name = Buffer.from(`0${index+1}.png`)
    const bytes = colouredPng(colours[index]), crc = crc32(bytes)
    const header = Buffer.alloc(30)
    header.writeUInt32LE(0x04034b50,0); header.writeUInt16LE(20,4)
    header.writeUInt32LE(crc,14); header.writeUInt32LE(bytes.length,18); header.writeUInt32LE(bytes.length,22)
    header.writeUInt16LE(name.length,26)
    local.push(header,name,bytes)
    const entry = Buffer.alloc(46)
    entry.writeUInt32LE(0x02014b50,0); entry.writeUInt16LE(20,4); entry.writeUInt16LE(20,6)
    entry.writeUInt32LE(crc,16); entry.writeUInt32LE(bytes.length,20); entry.writeUInt32LE(bytes.length,24)
    entry.writeUInt16LE(name.length,28); entry.writeUInt32LE(offset,42)
    central.push(entry,name)
    offset += header.length + name.length + bytes.length
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50,0); end.writeUInt16LE(3,8); end.writeUInt16LE(3,10)
  end.writeUInt32LE(directory.length,12); end.writeUInt32LE(offset,16)
  return Buffer.concat([...local,directory,end])
}

async function savedBook(page, name) {
  return page.evaluate(async name => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('inhouse-read')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const books = await new Promise((resolve, reject) => {
      const request = db.transaction('books','readonly').objectStore('books').getAll()
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    db.close()
    const book = books.find(item => item.name === name)
    return book ? { id:book.id, locator:book.locator, fraction:book.progressFraction } : null
  }, name)
}

async function observeOpening(page, expected) {
  await page.evaluate(expected => {
    const sample = document.createElement('canvas')
    sample.width = 160; sample.height = 346
    const context = sample.getContext('2d', { willReadFrequently:true })
    const state = window.__bookOpening = {
      frames:0, hinges:0, phases:[], failures:[], pageSamples:[], image:null, done:false,
      expectedLocator:expected.locator, observedLocators:[]
    }
    let started = false, lastSample = -Infinity
    const record = () => {
      const flyout = document.querySelector('.ihr-flyout')
      const phase = flyout?.dataset.openingPhase
      if (phase && !state.phases.includes(phase)) state.phases.push(phase)
      if (phase === 'preparing' || phase === 'opening') started = true
      if (!started) return
      if (!flyout) { state.done = true; return }
      const canvas = flyout.querySelector('.ihr-flyout__book canvas')
      const opened = Number(canvas?.dataset.coverOpen || 0)
      if (phase === 'bookmark' && canvas) {
        const bounds=JSON.parse(canvas.dataset.boardBounds);
        if (bounds.left < -1 || bounds.top < -1 || bounds.left+bounds.width > innerWidth+1 || bounds.top+bounds.height > innerHeight+1)
          state.failures.push({type:'open-spread-cropped',bounds});
      }
      const toolbar = document.querySelector('#reader-toolbar')
      if (toolbar && !toolbar.hidden && getComputedStyle(toolbar).visibility !== 'hidden') {
        state.failures.push({ type:'controls-before-handoff', phase })
      }
      if (opened > 0) {
        state.hinges++
        const locator = canvas?.dataset.pageLocator
        const text = canvas?.dataset.pageText || ''
        if (!state.observedLocators.includes(locator)) state.observedLocators.push(locator)
        let parsedLocator
        try { parsedLocator = JSON.parse(locator) } catch { /* recorded as a wrong page below */ }
        const matchingLocator = expected.locator?.kind === 'cfi'
          ? parsedLocator?.kind === 'cfi' && typeof parsedLocator.value === 'string' && parsedLocator.value.startsWith('epubcfi(')
          : locator === JSON.stringify(expected.locator)
        if (canvas?.dataset.pageSource !== expected.source || !matchingLocator || !text.includes(expected.text)) {
          state.failures.push({ type:'wrong-page-on-mesh', phase, opened,
            source:canvas?.dataset.pageSource, locator, text:text.slice(0,160) })
        }
      }
      if (!canvas || performance.now() - lastSample < 40) return
      lastSample = performance.now()
      state.frames++
      context.clearRect(0,0,sample.width,sample.height)
      context.drawImage(canvas,0,0,sample.width,sample.height)
      const pixels = context.getImageData(0,0,sample.width,sample.height).data
      let opaque = 0, blue = 0, contrast = 0
      for (let i=0;i<pixels.length;i+=4) {
        const [r,g,b,a] = pixels.subarray(i,i+4)
        if (a < 200) continue
        opaque++
        if (b > r*1.65 && b > g*1.25 && b > 65) blue++
        if (Math.max(r,g,b)-Math.min(r,g,b) > 25 || Math.max(r,g,b)<90) contrast++
      }
      if (!opaque) state.failures.push({ type:'empty-model-frame', phase, opened })
      if (opened > .68 && phase !== 'handoff') {
        state.pageSamples.push({ opened, phase, opaque, blue, contrast })
        if (expected.blue && blue < 80) state.failures.push({ type:'saved-blue-page-missing', phase, opened, blue })
        if (!state.image && (expected.blue ? blue>80 : contrast>50)) state.image = canvas.toDataURL('image/png')
      }
    }
    const tick = () => { record(); if (!state.done) requestAnimationFrame(tick) }
    const observer = new MutationObserver(record)
    observer.observe(document.body, { childList:true, subtree:true, attributes:true,
      attributeFilter:['data-opening-phase','data-cover-open','data-page-source','class','hidden'] })
    state.stop = () => { observer.disconnect(); state.done = true }
    requestAnimationFrame(tick)
  }, expected)
}

async function assertOpening(page, testInfo) {
  await expect(page.locator('.ihr-flyout')).toHaveCount(0, { timeout:20_000 })
  const result = await page.evaluate(() => {
    const result = window.__bookOpening
    result.stop()
    return { frames:result.frames, hinges:result.hinges, phases:result.phases,
      failures:result.failures, pageSamples:result.pageSamples, image:result.image,
      expectedLocator:result.expectedLocator, observedLocators:result.observedLocators }
  })
  await testInfo.attach('opening-frames', { body:JSON.stringify({ ...result,image:undefined },null,2), contentType:'application/json' })
  if (result.image) await testInfo.attach('actual-saved-page-on-opening-model', {
    body:Buffer.from(result.image.split(',')[1],'base64'), contentType:'image/png'
  })
  expect(result.failures).toEqual([])
  if (result.expectedLocator?.kind === 'cfi') {
    // A paginated CFI range ends at the last visible glyph. Fonts/viewport
    // settling may change that end, while its saved starting anchor must stay
    // exact. Use Foliate's real CFI parser to compare every rendered start.
    for (const locator of result.observedLocators) {
      expect(collapseCfi(JSON.parse(locator).value)).toBe(collapseCfi(result.expectedLocator.value))
    }
  }
  expect(result.frames).toBeGreaterThan(1)
  expect(result.hinges).toBeGreaterThan(0)
  expect(result.phases).toEqual(expect.arrayContaining(['opening','zooming','handoff']))
  expect(result.pageSamples.length).toBeGreaterThan(0)
  await expect(page.locator('#reader-toolbar')).toBeVisible()
  await expect(page.locator('.ihr-reader-page-ribbon')).toHaveCount(0)
  await expect(page.locator('#reader-screen')).not.toHaveClass(/is-preparing|is-opening-from-book/)
}

async function observeClosing(page, expected) {
  await page.evaluate(expected => {
    const state = window.__bookClosing = { phases:[],frames:[],failures:[],image:null,done:false };
    const canvas = document.createElement('canvas'); canvas.width=100; canvas.height=216;
    const context = canvas.getContext('2d',{willReadFrequently:true});
    const tick = () => {
      if (state.done) return;
      const flyout=document.querySelector('.ihr-flyout--return'), phase=flyout?.dataset.returnPhase;
      if (phase && !state.phases.includes(phase)) state.phases.push(phase);
      const book=flyout?.querySelector('.ihr-book-canvas');
      if (book && phase !== 'preparing' && phase !== 'inserting') {
        const opened=Number(book.dataset.coverOpen),withdraw=Number(book.dataset.bookmarkWithdraw);
        state.frames.push({phase,opened,withdraw,locator:book.dataset.pageLocator});
        if (book.dataset.pageSource !== expected.source || !book.dataset.pageText.includes(expected.text))
          state.failures.push({type:'wrong-page',phase,source:book.dataset.pageSource,text:book.dataset.pageText});
        if (expected.locator && book.dataset.pageLocator !== JSON.stringify(expected.locator))
          state.failures.push({type:'wrong-location',phase,locator:book.dataset.pageLocator});
        if (phase === 'bookmark' && opened < .999) state.failures.push({type:'cover-closed-before-bookmark',opened});
        if (phase === 'bookmark') {
          const bounds=JSON.parse(book.dataset.boardBounds);
          if (bounds.left < -1 || bounds.top < -1 || bounds.left+bounds.width > innerWidth+1 || bounds.top+bounds.height > innerHeight+1)
            state.failures.push({type:'open-book-cropped',bounds});
        }
        if ((phase === 'closing' || phase === 'returning') && withdraw > .001)
          state.failures.push({type:'bookmark-not-inserted',phase,withdraw});
        if (phase === 'returning' && opened > .001) state.failures.push({type:'returned-open',opened});
        context.clearRect(0,0,100,216); context.drawImage(book,0,0,100,216);
        const pixels=context.getImageData(0,0,100,216).data;
        let opaque=0,blue=0;
        for (let i=0;i<pixels.length;i+=4) {
          if (pixels[i+3] < 180) continue; opaque++;
          if (pixels[i+2] > pixels[i]*1.65 && pixels[i+2] > pixels[i+1]*1.25 && pixels[i+2]>65) blue++;
        }
        if (!opaque) state.failures.push({type:'empty-frame',phase});
        if (expected.blue && phase === 'bookmark' && blue < 40) state.failures.push({type:'current-blue-page-missing',blue});
        if (!state.image && phase === 'bookmark' && withdraw < .5) state.image=book.toDataURL('image/png');
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  },expected);
}
async function assertClosing(page,testInfo) {
  await expect(page.locator('.ihr-flyout--return')).toHaveCount(0,{timeout:30000});
  await expect(page.locator('body')).not.toHaveClass(/is-closing-reader|is-reading/,{timeout:30000});
  const result=await page.evaluate(() => { const state=window.__bookClosing; state.done=true;return state; });
  await testInfo.attach('reverse-book-animation',{body:JSON.stringify({...result,image:undefined}),contentType:'application/json'});
  if (result.image) await testInfo.attach('current-page-with-3d-bookmark',{
    body:Buffer.from(result.image.split(',')[1],'base64'),contentType:'image/png'});
  expect(result.failures).toEqual([]);
  expect(result.phases.filter(phase=>phase !== 'preparing')).toEqual(['zooming','bookmark','closing','returning','inserting']);
  const marking=result.frames.filter(frame=>frame.phase === 'bookmark');
  expect(marking.some(frame=>frame.withdraw > .8)).toBe(true);
  expect(marking.some(frame=>frame.withdraw < .2)).toBe(true);
  const closing=result.frames.filter(frame=>frame.phase === 'closing');
  expect(closing.some(frame=>frame.opened > .8)).toBe(true);
  expect(closing.some(frame=>frame.opened < .2)).toBe(true);
  await expect(page.locator('.ihr-reader-return-page')).toHaveCount(0);
  await expect(page.locator('.ihr-spine')).not.toHaveClass(/is-away/);
}

test('móvil: salir coloca el marcapáginas, cierra la página actual y vuelve a la balda en 3D incluso tras importar',async ({page},testInfo) => {
  test.setTimeout(90000);
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.locator('#file-picker').setInputFiles({name:'reverse-current-page.pdf',mimeType:'application/pdf',buffer:colouredPdf()});
  await expect(page.locator('#reader-location')).toHaveAttribute('aria-label',/Página 1 de 4/);
  await observeClosing(page,{source:'pdf-canvas',locator:{kind:'pdf-page',value:1},text:'Printed page 1.',blue:false});
  await page.getByRole('button',{name:'Volver a la estantería'}).click();
  await assertClosing(page,testInfo);
  await expect.poll(async()=> (await savedBook(page,'reverse-current-page.pdf'))?.locator).toEqual({kind:'pdf-page',value:1});
  await page.locator('.ihr-spine').click();
  await page.getByRole('button',{name:/Toca para leer/}).click();
  // Reopening completes the same 3D handoff as assertOpening before exposing controls.
  await expect(page.locator('.ihr-flyout')).toHaveCount(0,{timeout:20_000});
  await expect(page.locator('#reader-toolbar')).toBeVisible();
  await page.getByRole('button',{name:'Página siguiente',exact:true}).click();
  await page.getByRole('button',{name:'Página siguiente',exact:true}).click();
  await expect(page.locator('.pdf-text-layer')).toContainText('Saved blue page. Page 3.');
  await observeClosing(page,{source:'pdf-canvas',locator:{kind:'pdf-page',value:3},text:'Saved blue page. Page 3.',blue:true});
  await page.getByRole('button',{name:'Volver a la estantería'}).click();
  await assertClosing(page,testInfo);
  expect(errors).toEqual([]);
});

test('móvil EPUB: la vuelta usa el capítulo actual y cancela limpiamente al girar durante el marcapáginas',async ({page},testInfo) => {
  test.setTimeout(90000);
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.locator('#file-picker').setInputFiles('tests/e2e/fixtures/reading-journey.epub');
  await expect(page.locator('foliate-view')).toBeVisible();
  await page.locator('#reader-location').click();
  await page.getByRole('button',{name:'Beyond the window',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>document.querySelector('foliate-view')?.renderer?.getContents()?.[0]?.doc.querySelector('h1')?.textContent)).toBe('Beyond the window');
  await observeClosing(page,{source:'epub-page',text:'Beyond the window',blue:false});
  await page.getByRole('button',{name:'Volver a la estantería'}).click();
  await assertClosing(page,testInfo);
  await page.locator('.ihr-spine').click();
  await page.getByRole('button',{name:/Toca para leer/}).click();
  // Reopening completes the same 3D handoff as assertOpening before exposing controls.
  await expect(page.locator('.ihr-flyout')).toHaveCount(0,{timeout:20_000});
  await expect(page.locator('#reader-toolbar')).toBeVisible();
  await page.evaluate(() => {
    window.__cancelAtBookmark=false;
    const observer=new MutationObserver(() => {
      if (document.querySelector('.ihr-flyout--return')?.dataset.returnPhase !== 'bookmark') return;
      observer.disconnect(); window.__cancelAtBookmark=true;
      window.dispatchEvent(new Event('resize'));
    });
    observer.observe(document.body,{subtree:true,attributes:true,attributeFilter:['data-return-phase']});
  });
  await page.getByRole('button',{name:'Volver a la estantería'}).click();
  await expect.poll(()=>page.evaluate(()=>window.__cancelAtBookmark),{timeout:30_000}).toBe(true);
  await page.setViewportSize({width:844,height:390});
  await expect(page.locator('.ihr-flyout')).toHaveCount(0);
  await expect(page.locator('body')).not.toHaveClass(/is-closing-reader/);
  await expect(page.locator('.ihr-reader-return-page')).toHaveCount(0);
  await expect(page.locator('.ihr-spine')).not.toHaveClass(/is-away/);
  await page.locator('.ihr-spine').click();
  await expect(page.getByRole('button',{name:/Toca para leer/})).toBeVisible();
  expect(errors).toEqual([]);
});

test('móvil sin WebGL: la salida conserva la página real durante el cierre y libera la portada',async ({page}) => {
  await page.addInitScript(() => {
    window.WebGLRenderingContext=undefined; window.WebGL2RenderingContext=undefined;
  });
  await page.reload();
  await page.locator('#file-picker').setInputFiles({name:'reverse-fallback.pdf',mimeType:'application/pdf',buffer:colouredPdf()});
  await expect(page.locator('#reader-location')).toHaveAttribute('aria-label',/Página 1 de 4/);
  await page.getByRole('button',{name:'Página siguiente',exact:true}).click();
  await page.getByRole('button',{name:'Página siguiente',exact:true}).click();
  await expect(page.locator('.pdf-text-layer')).toContainText('Saved blue page. Page 3.');
  await page.getByRole('button',{name:'Volver a la estantería'}).click();
  await expect(page.locator('.ihr-flyout--return')).toHaveAttribute('data-return-phase','bookmark');
  const saved=page.locator('.ihr-flyout__saved-page');
  await expect(saved).toHaveAttribute('data-page-locator',JSON.stringify({kind:'pdf-page',value:3}));
  expect(await saved.evaluate(canvas=>canvas.getContext('2d').getImageData(canvas.width/2,canvas.height/2,1,1).data[2])).toBeGreaterThan(100);
  await expect(page.locator('.ihr-flyout')).toHaveCount(0);
  await expect(page.locator('body')).not.toHaveClass(/is-closing-reader/);
  await expect(page.locator('.ihr-reader-return-page')).toHaveCount(0);
});

test('movimiento reducido: salir conserva la última página y no deja bloqueos ni capas de transición',async ({page}) => {
  // Reduced motion still captures and prepares the real 3D return view; CI
  // needed longer than eight seconds before that work released the reader.
  test.setTimeout(60_000);
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.locator('#file-picker').setInputFiles({name:'reverse-reduced.pdf',mimeType:'application/pdf',buffer:colouredPdf()});
  await expect(page.locator('#reader-location')).toHaveAttribute('aria-label',/Página 1 de 4/);
  await page.getByRole('button',{name:'Página siguiente',exact:true}).click();
  await expect(page.locator('#reader-location')).toHaveAttribute('aria-label',/Página 2 de 4/);
  await page.getByRole('button',{name:'Volver a la estantería'}).click();
  await expect(page.locator('body')).toHaveClass(/is-closing-reader/);
  await expect(page.locator('body')).not.toHaveClass(/is-closing-reader|is-reading/,{timeout:30_000});
  await expect(page.locator('.ihr-flyout,.ihr-reader-return-page')).toHaveCount(0);
  await expect.poll(async()=> (await savedBook(page,'reverse-reduced.pdf'))?.locator).toEqual({kind:'pdf-page',value:2});
  await page.locator('.ihr-spine').click();
  await expect(page.getByRole('button',{name:/Toca para leer/})).toBeVisible();
});

test('móvil: abre la página PDF guardada en el modelo 3D antes del zoom y conserva sus píxeles', async ({ page }, testInfo) => {
  test.setTimeout(90_000)
  const errors = []; page.on('pageerror', error => errors.push(error.message))
  await page.locator('#file-picker').setInputFiles({ name:'opening-colours.pdf', mimeType:'application/pdf', buffer:colouredPdf() })
  await expect(page.locator('#reader-location')).toHaveAttribute('aria-label', /Página 1 de 4/)
  await page.getByRole('button', { name:'Página siguiente', exact:true }).click()
  await page.getByRole('button', { name:'Página siguiente', exact:true }).click()
  await expect(page.locator('#reader-location')).toHaveAttribute('aria-label', /Página 3 de 4/)
  await expect(page.locator('.pdf-text-layer')).toContainText('Saved blue page. Page 3.')
  await page.getByRole('button', { name:'Volver a la estantería' }).click()
  await expect(page.locator('body')).not.toHaveClass(/is-reading|is-closing-reader/,{timeout:30_000})
  await expect(page.locator('.ihr-flyout--return')).toHaveCount(0,{timeout:30_000})
  await expect.poll(async () => (await savedBook(page,'opening-colours.pdf'))?.locator).toEqual({ kind:'pdf-page',value:3 })
  await page.reload()
  const spine = page.locator('.ihr-spine').first()
  await expect(spine).toBeVisible()
  await spine.click()
  const cover = page.getByRole('button', { name:/Toca para leer/ })
  await expect(cover).toBeVisible()
  await expect(page.locator('#reader-screen')).toHaveClass(/is-preparing/)
  await expect(page.locator('.pdf-text-layer')).toContainText('Saved blue page. Page 3.')
  await expect(page.locator('#reader-toolbar')).toBeHidden()
  const bookCanvas = page.locator('.ihr-flyout__book canvas')
  await expect(bookCanvas).toHaveAttribute('data-bookmark3d','true')
  await observeOpening(page, { source:'pdf-canvas',locator:{ kind:'pdf-page',value:3 },text:'Saved blue page. Page 3.',blue:true })
  await cover.click()
  await assertOpening(page,testInfo)
  await expect(page.locator('#reader-location')).toHaveAttribute('aria-label', /Página 3 de 4/)
  await expect(page.locator('.pdf-text-layer')).toContainText('Saved blue page. Page 3.')
  const centrePixel = await page.locator('.pdf-page-canvas').evaluate(canvas => [...canvas.getContext('2d').getImageData(canvas.width/2,canvas.height/2,1,1).data])
  expect(centrePixel[2]).toBeGreaterThan(centrePixel[0]*2)
  expect(errors).toEqual([])
})

test('móvil: abre el capítulo EPUB del CFI guardado con su texto real durante la bisagra', async ({ page }, testInfo) => {
  test.setTimeout(90_000)
  const errors = []; page.on('pageerror', error => errors.push(error.message))
  await page.locator('#file-picker').setInputFiles('tests/e2e/fixtures/reading-journey.epub')
  await expect(page.locator('foliate-view')).toBeVisible()
  await page.locator('#reader-location').click()
  await page.getByRole('button', { name:'Beyond the window',exact:true }).click()
  const chapter = () => page.evaluate(() => document.querySelector('foliate-view')?.renderer?.getContents()?.[0]?.doc.querySelector('h1')?.textContent)
  await expect.poll(chapter).toBe('Beyond the window')
  await page.getByRole('button', { name:'Volver a la estantería' }).click()
  await expect(page.locator('body')).not.toHaveClass(/is-reading|is-closing-reader/,{timeout:30_000})
  await expect(page.locator('.ihr-flyout--return')).toHaveCount(0,{timeout:30_000})
  await expect.poll(async () => (await savedBook(page,'reading-journey.epub'))?.locator?.kind).toBe('cfi')
  const record = await savedBook(page,'reading-journey.epub')
  await page.reload()
  await page.locator('.ihr-spine').first().click()
  const cover = page.getByRole('button', { name:/Toca para leer/ })
  await expect(cover).toBeVisible()
  await expect(page.locator('#reader-screen')).toHaveClass(/is-preparing/)
  await expect.poll(chapter).toBe('Beyond the window')
  await observeOpening(page, { source:'epub-page',locator:record.locator,text:'Beyond the window',blue:false })
  await cover.click()
  await assertOpening(page,testInfo)
  await expect.poll(chapter).toBe('Beyond the window')
  expect(errors).toEqual([])
})

test('móvil: cancelar la apertura al redimensionar libera la estantería y permite reabrir la página guardada', async ({ page }, testInfo) => {
  test.setTimeout(90_000)
  const errors = []; page.on('pageerror', error => errors.push(error.message))
  await page.locator('#file-picker').setInputFiles({ name:'opening-resize.pdf', mimeType:'application/pdf', buffer:colouredPdf() })
  await expect(page.locator('#reader-location')).toHaveAttribute('aria-label', /Página 1 de 4/)
  await page.getByRole('button', { name:'Página siguiente', exact:true }).click()
  await page.getByRole('button', { name:'Página siguiente', exact:true }).click()
  await expect(page.locator('#reader-location')).toHaveAttribute('aria-label', /Página 3 de 4/)
  await page.getByRole('button', { name:'Volver a la estantería' }).click()
  await expect(page.locator('body')).not.toHaveClass(/is-reading|is-closing-reader/,{timeout:30_000})
  await expect(page.locator('.ihr-flyout--return')).toHaveCount(0,{timeout:30_000})
  await expect.poll(async () => (await savedBook(page,'opening-resize.pdf'))?.locator).toEqual({ kind:'pdf-page',value:3 })
  await page.reload()
  await page.locator('.ihr-spine').first().click()
  const cover = page.getByRole('button', { name:/Toca para leer/ })
  await expect(cover).toBeVisible()
  await cover.click()
  await page.waitForFunction(() => ['opening','zooming'].includes(document.querySelector('.ihr-flyout')?.dataset.openingPhase))
  await page.setViewportSize({ width:420,height:844 })
  await expect(page.locator('.ihr-flyout')).toHaveCount(0)
  await expect(page.locator('#home-screen')).toBeVisible()
  await expect(page.locator('#reader-screen')).toBeHidden()
  await expect(page.locator('body')).not.toHaveClass(/is-opening-reader|is-reading/)
  await expect(page.locator('#reader-screen')).not.toHaveClass(/is-opening-from-book|is-reader-page-ready/)
  await expect(page.locator('#reader-screen')).not.toHaveAttribute('data-opening-book',/.+/)
  await expect(page.locator('.app-header')).toBeVisible()
  await expect(page.locator('.ihr-spine').first()).not.toHaveClass(/is-away/)
  await expect(page.locator('body')).not.toHaveClass(/is-reading|is-closing-reader/,{timeout:30_000})
  await expect(page.locator('.ihr-flyout--return')).toHaveCount(0,{timeout:30_000})
  await expect.poll(async () => (await savedBook(page,'opening-resize.pdf'))?.locator).toEqual({ kind:'pdf-page',value:3 })

  // A stale busy/session flag used to make the next tap do nothing. Reuse the
  // same shelf and reader without reload, then inspect its real saved page.
  await page.locator('.ihr-spine').first().click()
  await expect(cover).toBeVisible()
  await expect(page.locator('.pdf-text-layer')).toContainText('Saved blue page. Page 3.')
  await observeOpening(page, { source:'pdf-canvas',locator:{ kind:'pdf-page',value:3 },text:'Saved blue page. Page 3.',blue:true })
  await cover.click()
  await assertOpening(page,testInfo)
  await expect(page.locator('#reader-location')).toHaveAttribute('aria-label', /Página 3 de 4/)
  expect(errors).toEqual([])
})

test('móvil sin WebGL: la hoja de apertura también contiene los píxeles de la página PDF guardada', async ({ page }, testInfo) => {
  test.setTimeout(90_000)
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.getContext = function (type,...args) {
      return /webgl/i.test(type) ? null : original.call(this,type,...args)
    }
  })
  await page.reload()
  const errors = []; page.on('pageerror', error => errors.push(error.message))
  await page.locator('#file-picker').setInputFiles({ name:'opening-fallback.pdf', mimeType:'application/pdf', buffer:colouredPdf() })
  await expect(page.locator('#reader-location')).toHaveAttribute('aria-label', /Página 1 de 4/)
  await page.getByRole('button', { name:'Página siguiente', exact:true }).click()
  await page.getByRole('button', { name:'Página siguiente', exact:true }).click()
  await expect(page.locator('#reader-location')).toHaveAttribute('aria-label', /Página 3 de 4/)
  await page.getByRole('button', { name:'Volver a la estantería' }).click()
  await expect.poll(async () => (await savedBook(page,'opening-fallback.pdf'))?.locator).toEqual({ kind:'pdf-page',value:3 })
  await page.reload()
  await page.locator('.ihr-spine').first().click()
  await expect(page.locator('.ihr-flyout__book--fallback')).toBeVisible()
  await page.getByRole('button', { name:/Toca para leer/ }).click()
  const savedPage = page.locator('.ihr-flyout__saved-page')
  await expect(savedPage).toHaveAttribute('data-page-source','pdf-canvas')
  await expect(savedPage).toHaveAttribute('data-page-locator',JSON.stringify({ kind:'pdf-page',value:3 }))
  await expect(savedPage).toHaveAttribute('data-page-text',/Saved blue page\. Page 3\./)
  const source = await savedPage.evaluate(canvas => ({
    pixel:[...canvas.getContext('2d').getImageData(canvas.width/2,canvas.height/2,1,1).data],
    image:canvas.toDataURL('image/png')
  }))
  expect(source.pixel[2]).toBeGreaterThan(source.pixel[0]*2)
  await testInfo.attach('saved-page-in-css-fallback', { body:Buffer.from(source.image.split(',')[1],'base64'),contentType:'image/png' })
  await expect(page.locator('.ihr-flyout')).toHaveCount(0)
  await expect(page.locator('#reader-location')).toHaveAttribute('aria-label', /Página 3 de 4/)
  await expect(page.locator('#reader-toolbar')).toBeVisible()
  expect(errors).toEqual([])
})

test('móvil CBZ: abre la imagen azul guardada y descarta el iframe oculto de la portada roja', async ({ page }, testInfo) => {
  test.setTimeout(90_000)
  const errors = []; page.on('pageerror', error => errors.push(error.message))
  // Fixed-layout pages load asynchronously. Force the same resize notification
  // that a returning-page row can deliver while the old spread has been cleared
  // and the new iframe is still loading, instead of relying on network timing.
  await page.evaluate(() => {
    const native = window.ResizeObserver
    const race = window.__fixedLayoutResizeRace = {native,callbacks:new Map(),forced:0,mutations:null}
    window.ResizeObserver = class extends native {
      constructor(callback) { super(callback); this.fixtureCallback = callback }
      observe(target,options) {
        super.observe(target,options)
        if (target.localName === 'foliate-fxl') {
          race.callbacks.set(target,() => this.fixtureCallback([{target,contentRect:target.getBoundingClientRect()}],this))
        }
      }
    }
  })
  await page.locator('#file-picker').setInputFiles({ name:'opening-comic.cbz', mimeType:'application/vnd.comicbook+zip',buffer:colouredComic() })
  await expect(page.locator('foliate-view')).toBeVisible()
  const visiblePage = () => page.evaluate(() => {
    const view = document.querySelector('foliate-view')
    const viewport = view?.getBoundingClientRect()
    for (const {doc} of view?.renderer?.getContents?.() || []) {
      const frame = doc?.defaultView?.frameElement
      const rect = frame?.getBoundingClientRect()
      const image = doc?.querySelector('img')
      if (!rect?.width || !rect.height || !image?.complete || !image.naturalWidth ||
          rect.right <= viewport.left || rect.left >= viewport.right) continue
      const sample = doc.createElement('canvas'); sample.width = sample.height = 1
      const context = sample.getContext('2d')
      context.drawImage(image,0,0,1,1)
      const colour = [...context.getImageData(0,0,1,1).data].slice(0,3)
      return { width:image.naturalWidth,height:image.naturalHeight,
        colour }
    }
    return null
  })
  await expect.poll(visiblePage).toEqual({ width:400,height:600,colour:[184,20,40] })
  await page.evaluate(() => {
    const frame = document.querySelector('foliate-view').renderer.getContents()[0].doc.defaultView.frameElement
    const root = frame.getRootNode(), race = window.__fixedLayoutResizeRace
    const resize = race.callbacks.get(root.host)
    if (!resize) throw new Error('Fixed-layout ResizeObserver was not captured')
    race.mutations = new MutationObserver(records => {
      if (!records.some(record => record.type === 'childList')) return
      race.forced++
      resize()
    })
    race.mutations.observe(root,{childList:true})
  })
  await page.locator('#reader-location').click()
  await page.getByRole('button', { name:'03.png',exact:true }).click()
  await expect.poll(visiblePage).toEqual({ width:400,height:600,colour:[20,56,199] })
  const forcedResizes = await page.evaluate(() => {
    const race = window.__fixedLayoutResizeRace
    race.mutations.disconnect()
    window.ResizeObserver = race.native
    return race.forced
  })
  expect(forcedResizes).toBeGreaterThan(0)
  await page.getByRole('button', { name:'Volver a la estantería' }).click()
  await expect.poll(async () => (await savedBook(page,'opening-comic.cbz'))?.locator?.kind).toBe('cfi')
  const record = await savedBook(page,'opening-comic.cbz')
  await page.reload()
  await page.locator('.ihr-spine').first().click()
  const cover = page.getByRole('button', { name:/Toca para leer/ })
  await expect(cover).toBeVisible()
  await expect(page.locator('#reader-screen')).toHaveClass(/is-preparing/)
  await expect.poll(visiblePage).toEqual({ width:400,height:600,colour:[20,56,199] })
  // These printed pages are images; there is no selectable DOM text. Their
  // decisive identity is the blue print on the real saved image, not a label.
  await observeOpening(page, { source:'epub-page',locator:record.locator,text:'',blue:true })
  await cover.click()
  await assertOpening(page,testInfo)
  await expect.poll(visiblePage).toEqual({ width:400,height:600,colour:[20,56,199] })
  expect(errors).toEqual([])
})

test('móvil: cancelar durante la preparación y reabrir el mismo libro no deja que la sesión anterior oculte el lector nuevo', async ({ page }, testInfo) => {
  test.setTimeout(90_000)
  const errors = []; page.on('pageerror', error => errors.push(error.message))
  await page.evaluate(async ({ bytes,coverBytes }) => {
    const db = await new Promise((resolve,reject) => {
      const request = indexedDB.open('inhouse-read')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const transaction = db.transaction('books','readwrite')
    transaction.objectStore('books').put({
      id:'opening-preparation-race',title:'Saved race',name:'opening-preparation-race.pdf',
      sourceType:'local',format:'PDF',mimeType:'application/pdf',pageCount:4,
      content:new Blob([new Uint8Array(bytes)],{type:'application/pdf'}),
      cover:new Blob([new Uint8Array(coverBytes)],{type:'image/png'}),
      locator:{kind:'pdf-page',value:3},progressFraction:2/3,
      addedAt:Date.now(),lastOpenedAt:Date.now()
    })
    await new Promise((resolve,reject) => {
      transaction.oncomplete = resolve; transaction.onerror = () => reject(transaction.error)
    })
    db.close()
  }, { bytes:[...colouredPdf()],coverBytes:[...colouredPng([184,20,40])] })

  let workerBlocked = false, releaseWorker
  const workerGate = new Promise(resolve => { releaseWorker = resolve })
  await page.route(/\/pdf\.worker[^/]*\.(?:mjs|js)(?:\?|$)/,async route => {
    if (!workerBlocked) {
      workerBlocked = true
      // A gate guarantees cancellation happens during a real pending reader
      // load even on slow software GPU machines; a fixed delay can race it.
      await workerGate
    }
    await route.continue().catch(() => {})
  })
  try {
    await page.reload()
    await page.locator('.ihr-spine').first().click()
    const cover = page.getByRole('button', { name:/Toca para leer/ })
    await expect(cover).toBeVisible()
    await expect.poll(() => workerBlocked).toBe(true)
    await cover.click()
    await expect(page.locator('.ihr-flyout')).toHaveAttribute('data-opening-phase','preparing')
    await page.setViewportSize({ width:420,height:844 })
    await expect(page.locator('.ihr-flyout')).toHaveCount(0)
    await expect(page.locator('.ihr-spine').first()).not.toHaveClass(/is-away/)
    // Reselect while the ORIGINAL preparation promise remains unresolved.
    // Both opens await it, but only the second session may reveal/finish.
    await page.locator('.ihr-spine').first().click()
    await expect(cover).toBeVisible()
    await observeOpening(page, { source:'pdf-canvas',locator:{kind:'pdf-page',value:3},text:'Saved blue page. Page 3.',blue:true })
    await cover.click()
    await expect(page.locator('.ihr-flyout')).toHaveAttribute('data-opening-phase','preparing')
    releaseWorker()
    await assertOpening(page,testInfo)
    await expect(page.locator('#reader-location')).toHaveAttribute('aria-label', /Página 3 de 4/)
    await expect(page.locator('.pdf-text-layer')).toContainText('Saved blue page. Page 3.')
    await expect(page.locator('#reader-screen')).toBeVisible()
    await expect(page.locator('#home-screen')).toBeHidden()
    await expect(page.locator('body')).toHaveClass(/is-reading/)
    await expect(page.locator('body')).not.toHaveClass(/is-opening-reader/)
    await expect(page.locator('#reader-screen')).not.toHaveAttribute('data-opening-book',/.+/)
    expect(errors).toEqual([])
  } finally { releaseWorker() }
})
