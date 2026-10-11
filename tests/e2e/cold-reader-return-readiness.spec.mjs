import { test, expect } from '@playwright/test';
import { readFile, writeFile, mkdir, mkdtemp } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { fork } from 'node:child_process';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

// A causal lifecycle regression, not a speed benchmark. A NORMAL Node child
// performs one actual production Vite build, with only the analysis-entry gate
// and exposure of the exact imported readiness function. The browser receives
// a static preview; Vite never runs inside Playwright's ESM transform loader.
// Existing case assertions and the 90s functional-case budget are unchanged.
let helper, helperExit, appUrl, fixtureRoot, fixtureMeta, buildProfile, instrumentedModules=0;
let stdoutLog, stderrLog;

async function connectBuildProfiler(url) {
  if (typeof WebSocket!=='function') throw new Error('The plain-Node build profiler requires Node with WebSocket support.');
  const socket=new WebSocket(url), requests=new Map();
  let sequence=0, active=false, stopped=false;
  const opened=new Promise((resolve,reject) => {
    socket.addEventListener('open',resolve,{ once:true });
    socket.addEventListener('error',() => reject(new Error('Could not attach to the fixture Node inspector.')),{ once:true });
  });
  socket.addEventListener('message',event => {
    const message=JSON.parse(String(event.data)), pending=requests.get(message.id);
    if (!pending) return;
    requests.delete(message.id); clearTimeout(pending.timer);
    if (message.error) pending.reject(new Error(message.error.message)); else pending.resolve(message.result);
  });
  const command=(method,params={}) => new Promise((resolve,reject) => {
    const id=++sequence;
    const timer=setTimeout(() => { requests.delete(id);reject(new Error(`Fixture inspector timed out: ${method}`)); },4000);
    requests.set(id,{ resolve,reject,timer }); socket.send(JSON.stringify({ id,method,params }));
  });
  await opened;
  await command('Profiler.enable'); await command('Profiler.start'); active=true;
  return { async stop(label) {
    if (stopped) return; stopped=true;
    try {
      if (active) {
        const { profile }=await command('Profiler.stop');
        await writeFile(join(fixtureRoot,`build-${label}.cpuprofile`),JSON.stringify(profile));
      }
    } catch (error) {
      await writeFile(join(fixtureRoot,`build-${label}-profile-error.txt`),error.stack || String(error));
    } finally { socket.close(); }
  } };
}

test.beforeAll(async () => {
  test.setTimeout(60_000); // this new fixture's build hook, not an existing browser assertion
  const evidenceRoot=resolve(process.env.IHR_BUILD_EVIDENCE_DIR || process.env.RUNNER_TEMP || tmpdir());
  await mkdir(evidenceRoot,{ recursive:true });
  fixtureRoot=await mkdtemp(join(evidenceRoot,'inhouse-read-cold-return-'));
  stdoutLog=createWriteStream(join(fixtureRoot,'helper-stdout.log'),{ flags:'wx' });
  stderrLog=createWriteStream(join(fixtureRoot,'helper-stderr.log'),{ flags:'wx' });
  const env={ ...process.env,IHR_COLD_FIXTURE_ROOT:fixtureRoot };
  // The fixture must run in plain Node even if the test runner used a loader
  // through execArgv or NODE_OPTIONS. These affect only the build subprocess.
  delete env.NODE_OPTIONS;
  helper=fork(fileURLToPath(new URL('./helpers/cold-return-build-fixture.mjs',import.meta.url)),[],{
    cwd:process.cwd(),env,execArgv:['--inspect=127.0.0.1:0'],stdio:['ignore','pipe','pipe','ipc']
  });
  helper.stdout.pipe(stdoutLog); helper.stderr.pipe(stderrLog);
  helperExit=new Promise(resolve => helper.once('exit',(code,signal) => resolve({ code,signal })));
  const readiness=new Promise((resolve,reject) => {
    helper.once('error',reject);
    helper.once('exit',(code,signal) => reject(new Error(`Fixture child exited before readiness (${code}/${signal}); see ${fixtureRoot}.`)));
    helper.on('message',async message => {
      try {
        if (message?.type==='building') {
          await writeFile(join(fixtureRoot,'helper-started.json'),JSON.stringify(message,null,2));
          buildProfile=await connectBuildProfiler(message.inspectorUrl);
          helper.send({ type:'build' });
        } else if (message?.type==='ready') {
          fixtureMeta=message;appUrl=message.appUrl;instrumentedModules=message.transforms.analysis;
          await buildProfile?.stop('complete'); resolve();
        } else if (message?.type==='failed') {
          await buildProfile?.stop('failed'); reject(new Error(message.error));
        }
      } catch(error) { reject(error); }
    });
  });
  let deadline;
  try {
    await Promise.race([readiness,new Promise((_,reject) => {
      deadline=setTimeout(async () => {
        // The external inspector can preserve the CPU profile even when a busy
        // child cannot process its own IPC shutdown callback.
        await buildProfile?.stop('timeout');
        reject(new Error(`Static fixture was not ready within 55s; evidence retained at ${fixtureRoot}.`));
      },55_000);
    })]);
  } finally { clearTimeout(deadline); }
});
test.afterAll(async () => {
  await buildProfile?.stop('interrupted');
  if (helper && helper.exitCode===null && helper.signalCode===null) {
    if (helper.connected) helper.send({ type:'shutdown' });
    let timeout;
    const exited=await Promise.race([helperExit.then(() => true),new Promise(resolve => { timeout=setTimeout(() => resolve(false),4000); })]);
    clearTimeout(timeout);
    if (!exited) { helper.kill('SIGKILL');await helperExit; }
  }
  stdoutLog?.end();stderrLog?.end();
  // Preserve this test-owned build, logs and CPU profile for causal review.
  // No recursive deletion, shared dist mutation or broad process termination.
});
test.use({ viewport:{ width:390,height:845 }, deviceScaleFactor:2,isMobile:true,hasTouch:true,serviceWorkers:'block' });

async function storedFixture(page) {
  return page.evaluate(async () => {
    const isBookLengthReady=globalThis.__coldReturnIsBookLengthReady;
    if (typeof isBookLengthReady!=='function') throw new Error('The exact production readiness predicate was not exposed by the fixture.');
    const db=await new Promise((resolve,reject) => {
      const request=indexedDB.open('inhouse-read',2);
      request.onsuccess=() => resolve(request.result); request.onerror=() => reject(request.error);
    });
    try {
      const books=await new Promise((resolve,reject) => {
        const request=db.transaction('books').objectStore('books').getAll();
        request.onsuccess=() => resolve(request.result); request.onerror=() => reject(request.error);
      });
      const book=books.find(book => book.name==='Cold_Return_Readiness.pdf');
      if (!book) return null;
      return { id:book.id, name:book.name, geometryReady:isBookLengthReady(book), words:book.wordCount,
        coverBytes:book.cover?.size || 0, hasSavedAppearance:Boolean(book.coverAppearance),
        bytes:[...new Uint8Array(await book.content.arrayBuffer())] };
    } finally { db.close(); }
  });
}

async function observeBeforeBack(page, bookId) {
  await page.evaluate(id => {
    const state={ armed:true, analysisCalls:0, released:false, clickedAt:null, closingSeen:false,
      overlay:null, originalPixels:null, sameReaderPixels:false, capturedBounds:null, phases:[], progress:[],
      prematureRemoval:false, handoffBeforeRelease:false, uploadHeld:false, endedAt:null };
    let releaseAnalysis, stopped=false, frame=0;
    const deferred=new Promise(resolve => { releaseAnalysis=resolve; });
    const read=canvas => new Uint8Array(canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data);
    const equal=(a,b) => Boolean(a && b && a.length===b.length && a.every((value,index) => value===b[index]));
    const addPhase=value => { if (value && !state.phases.includes(value)) state.phases.push(value); };
    const addProgress=value => { if (value != null && value !== '' && Number.isFinite(Number(value))) state.progress.push(Number(value)); };
    const originalAppend=Element.prototype.append;
    Element.prototype.append=function (...nodes) {
      const result=originalAppend.apply(this,nodes);
      if (this.classList.contains('ihr-reader-return-page') && !state.overlay) {
        const canvas=this.querySelector('canvas'), live=document.querySelector('.pdf-page-canvas');
        if (canvas) {
          state.overlay=canvas; state.originalPixels=read(canvas);
          state.capturedBounds={ width:canvas.width,height:canvas.height,style:canvas.style.cssText };
          state.sameReaderPixels=Boolean(live && live.width===canvas.width && live.height===canvas.height
            && equal(state.originalPixels,read(live)));
        }
      }
      return result;
    };
    const restores=[];
    for (const prototype of new Set([globalThis.WebGLRenderingContext?.prototype,globalThis.WebGL2RenderingContext?.prototype].filter(Boolean))) {
      for (const method of ['texImage2D','texSubImage2D']) {
        const original=prototype[method];
        const wrapped=function (...args) {
          if (state.overlay && args.includes(state.overlay)) state.uploadHeld ||= state.released
            && state.overlay.isConnected && !document.body.classList.contains('is-reader-page-leaving');
          return original.apply(this,args);
        };
        prototype[method]=wrapped; restores.push(() => { if(prototype[method]===wrapped) prototype[method]=original; });
      }
    }
    const painted=node => {
      if (!node?.isConnected) return false;
      for (let current=node;current instanceof Element;current=current.parentElement) {
        const style=getComputedStyle(current);
        if(style.display==='none'||style.visibility==='hidden'||Number(style.opacity)===0)return false;
      }
      return true;
    };
    const sample=records => {
      for (const record of records || []) {
        if(record.attributeName==='data-return-phase') { addPhase(record.oldValue); addPhase(record.target.dataset.returnPhase); }
        if(record.attributeName==='data-return-progress') { addProgress(record.oldValue); addProgress(record.target.dataset.returnProgress); }
        for (const node of record.addedNodes || []) if(node instanceof Element && node.matches('.ihr-flyout--return')) addPhase(node.dataset.returnPhase);
      }
      const closing=document.body.classList.contains('is-closing-reader');
      if(closing) state.closingSeen=true;
      else if(state.closingSeen && state.endedAt===null)state.endedAt=performance.now();
      if(state.analysisCalls && !state.released) {
        if(state.overlay && !state.overlay.isConnected)state.prematureRemoval=true;
        if(document.body.classList.contains('is-reader-page-leaving'))state.handoffBeforeRelease=true;
      }
      addPhase(document.querySelector('.ihr-flyout--return')?.dataset.returnPhase);
      addProgress(document.querySelector('.ihr-bookshelf-scene')?.dataset.returnProgress);
    };
    const observer=new MutationObserver(sample);
    observer.observe(document.body,{childList:true,subtree:true,attributes:true,attributeOldValue:true,
      attributeFilter:['class','data-return-phase','data-return-progress']});
    const tick=() => { sample(); if(!stopped)frame=requestAnimationFrame(tick); };
    frame=requestAnimationFrame(tick);
    const click=event => { if(event.target.closest?.('#reader-back') && state.clickedAt===null)state.clickedAt=performance.now(); };
    document.addEventListener('click',click,true);
    const heldFacts=() => {
      sample();
      return { analysisCalls:state.analysisCalls,released:state.released,closingSeen:state.closingSeen,
        closing:document.body.classList.contains('is-closing-reader'),pageLeaving:document.body.classList.contains('is-reader-page-leaving'),
        overlayAttached:Boolean(state.overlay?.isConnected),overlayPainted:painted(state.overlay),
        retainedPixels:Boolean(state.overlay && equal(state.originalPixels,read(state.overlay))),
        sameReaderPixels:state.sameReaderPixels,prematureRemoval:state.prematureRemoval,handoffBeforeRelease:state.handoffBeforeRelease,
        semanticSlots:document.querySelectorAll('.ihr-spine').length,rooms:document.querySelectorAll('.ihr-bookshelf-scene').length,
        loader:document.querySelector('.ihr-library-loading')!==null,flyouts:document.querySelectorAll('.ihr-flyout--return').length };
    };
    window.__coldReturnProbe={
      get armed() { return state.armed; },
      get analysisCalls() { return state.analysisCalls; },
      holdAnalysis:async () => { state.analysisCalls++; await deferred; },
      heldFacts,
      release() { state.armed=false;state.released=true;releaseAnalysis(); },
      finish() {
        sample(observer.takeRecords()); stopped=true;cancelAnimationFrame(frame);observer.disconnect();
        Element.prototype.append=originalAppend; for(const restore of restores)restore();document.removeEventListener('click',click,true);
        const spine=[...document.querySelectorAll('.ihr-spine')].find(node=>node.dataset.bookId===id);
        const room=document.querySelector('.ihr-bookshelf-scene');
        return { analysisCalls:state.analysisCalls,clickedAt:state.clickedAt,endedAt:state.endedAt,closingSeen:state.closingSeen,
          retainedPixels:Boolean(state.overlay && equal(state.originalPixels,read(state.overlay))),
          sameReaderPixels:state.sameReaderPixels,snapshot:state.capturedBounds,
          prematureRemoval:state.prematureRemoval,handoffBeforeRelease:state.handoffBeforeRelease,uploadHeld:state.uploadHeld,
          phases:state.phases,progress:state.progress,final:{
            closing:document.body.classList.contains('is-closing-reader'),spinePresent:Boolean(spine),spineVisible:painted(spine),
            spineAway:Boolean(spine?.classList.contains('is-away')),sceneProjected:spine?.dataset.sceneProjected,
            activeBooks:Number(room?.dataset.activeBooks),animating:room?.dataset.animating,
            returningBooks:room?.dataset.returningBooks,renderCount:Number(room?.dataset.renderCount),
            flyouts:document.querySelectorAll('.ihr-flyout').length,overlays:document.querySelectorAll('.ihr-reader-return-page').length,
            insertionCanvases:document.querySelectorAll('.ihr-shelf-insertion-live-canvas,.ihr-shelf-return-overlay').length,
            roomCount:document.querySelectorAll('.ihr-bookshelf-scene').length }
        };
      }
    };
  },bookId);
}

test('a cold native import retains its real page while the first cover analysis delays the return slot', async ({page},testInfo) => {
  test.setTimeout(90_000); // new functional case: boot/import + deliberate gate + full real close
  await testInfo.attach('cold-return-compiled-fixture.json',{body:JSON.stringify(fixtureMeta),contentType:'application/json'});
  const errors=[];page.on('pageerror',error => errors.push(error.message));
  const bytes=[...await readFile('tests/e2e/fixtures/tiny.pdf')];
  await page.emulateMedia({reducedMotion:'no-preference'});
  await page.addInitScript(bytes => {
    localStorage.setItem('inhouse-read-reading-preferences',JSON.stringify({theme:'paper',pdfMode:'original',brightness:100}));
    const inbox=[{id:'22222222-2222-2222-2222-222222222222',name:'Cold_Return_Readiness.pdf',mimeType:'application/pdf',size:bytes.length}];
    window.__coldImportAcks=[];
    window.InhouseBookImports={pending:() => JSON.stringify(inbox),
      readChunk:(_id,offset) => btoa(String.fromCharCode(...bytes.slice(offset,offset+64))),
      acknowledge:id => {window.__coldImportAcks.push(id);inbox.splice(0,1);} };
  },bytes);
  await page.goto(appUrl);
  await expect(page.locator('.pdf-page-canvas')).toBeVisible();
  await page.waitForFunction(() => window.__coldImportAcks.length===1);
  await expect.poll(async () => {
    const book=await storedFixture(page);return Boolean(book?.geometryReady && book.coverBytes>0);
  },{timeout:20_000}).toBe(true);
  const before=await storedFixture(page);
  expect(before.bytes).toEqual(bytes);expect(before.words).toBe(4);expect(before.hasSavedAppearance).toBe(false);
  await expect(page.locator('.ihr-bookshelf')).toHaveCount(0); // the actual cold native shelf gate
  expect(instrumentedModules).toBeGreaterThan(0);
  await observeBeforeBack(page,before.id);
  await page.locator('#reader-back').click();
  try {
    await page.waitForFunction(() => window.__coldReturnProbe.analysisCalls===1);
    // Both frames occur with the analysis entry deliberately held. They expose
    // the old return-false/finally-removes-overlay race without a timed sleep.
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const held=await page.evaluate(() => window.__coldReturnProbe.heldFacts());
    await testInfo.attach('cold-return-delayed-analysis.json',{body:JSON.stringify({before,held}),contentType:'application/json'});
    expect(held).toMatchObject({analysisCalls:1,released:false,closingSeen:true,closing:true,pageLeaving:false,
      overlayAttached:true,overlayPainted:true,retainedPixels:true,sameReaderPixels:true,
      prematureRemoval:false,handoffBeforeRelease:false,semanticSlots:0,rooms:0,loader:true,flyouts:0});
  } finally { await page.evaluate(() => window.__coldReturnProbe.release()); }
  await expect(page.locator('body')).not.toHaveClass(/is-closing-reader/,{timeout:30_000});
  const room=page.locator('.ihr-bookshelf-scene');
  await expect(room).toHaveAttribute('data-animating','false');
  await expect(room).toHaveAttribute('data-returning-books','');
  const facts=await page.evaluate(() => window.__coldReturnProbe.finish());
  await testInfo.attach('cold-return-final-insertion.json',{body:JSON.stringify(facts),contentType:'application/json'});
  await testInfo.attach('cold-return-final-insertion.png',{body:await page.screenshot(),contentType:'image/png'});
  expect(errors).toEqual([]);expect(facts.analysisCalls).toBe(1);
  expect(facts.closingSeen && facts.retainedPixels && facts.sameReaderPixels && facts.uploadHeld).toBe(true);
  expect(facts.prematureRemoval || facts.handoffBeforeRelease).toBe(false);
  for(const phase of ['zooming','bookmark','closing','returning','inserting'])expect(facts.phases).toContain(phase);
  expect(facts.progress.some(value=>value===1)).toBe(true);
  expect(facts.final).toMatchObject({closing:false,spinePresent:true,spineVisible:true,spineAway:false,
    sceneProjected:'true',activeBooks:1,animating:'false',returningBooks:'',flyouts:0,overlays:0,insertionCanvases:0,roomCount:1});
  expect(facts.final.renderCount).toBeGreaterThan(0);
  expect((await storedFixture(page)).bytes).toEqual(bytes);
});
