import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { settledGeometryLength } from './helpers/settled-geometry-length.mjs';
import { spinePointerPosition } from './helpers/shelf-pointer.mjs';

// The JavaScript palette that this spec used to hide the compiled export from was removed together
// with its twin (the frozen original lives in tests/unit/helpers/reference-relief-palette.js and the
// differential unit tests compare it with the core). The relief passes are jobs of the shelf module now
// (rust-ui/src/relief_job.rs), observed at that module's own exports. A module whose analysis job fails is
// the failure case: the editor must report the analysis error instead of silently taking a second path.
// What happens inside a job (its seed, its colours, the rows of its normals) no longer crosses a boundary
// this page can watch; relief-job-differential.test.js compares those bytes with the frozen bridge.
for (const enabled of [false,true]) test(`real relief editor cold and cached: ${enabled?'Rust':'module whose analysis job fails'}`,async({page},testInfo)=>{
  // New diagnostic includes a cold room and two real flyouts/materials. It
  // does not alter the original reader/native-return timing contracts.
  test.setTimeout(120000);
  await page.setViewportSize({width:390,height:844});
  await page.emulateMedia({reducedMotion:'no-preference'});
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(enabled=>{
    window.paletteProof={jobs:0,live:0,available:false,normalCalls:0,steps:0,refused:0};
    const observe=result=>{
      const instance=result.instance||result,actual=instance.exports;
      if(typeof actual?.reliefjob_analysis!=='function')return result;
      const proof=window.paletteProof;proof.available=true;
      // Fail only the analysis job for the failure case. Every other compiled pass, actual renderer, image and
      // shader remains identical. A job constructor answers (pointer, error, is-error) at its return pointer;
      // the analysis is observed where the page makes it, steps it and frees it, the render job (composition,
      // normals with the selection in their alpha, grey planes) where the page makes it.
      const analysis=new Set(),made=retptr=>{const view=new DataView(actual.memory.buffer);return view.getInt32(retptr+8,true)?0:view.getInt32(retptr,true)>>>0;};
      const exports={...actual,reliefjob_analysis(retptr,...args){
        if(!enabled){proof.refused++;throw new Error('analysis job hidden by the test');}
        actual.reliefjob_analysis(retptr,...args);const p=made(retptr);if(p){analysis.add(p);proof.jobs++;proof.live++;}
      },reliefjob_step(p){const code=actual.reliefjob_step(p);if(analysis.has(p>>>0))proof.steps++;return code;
      },reliefjob_render(retptr,...args){actual.reliefjob_render(retptr,...args);if(made(retptr))proof.normalCalls++;
      },__wbg_reliefjob_free(p,...rest){actual.__wbg_reliefjob_free(p,...rest);if(analysis.delete(p>>>0))proof.live--;}};
      const proxy=new Proxy(instance,{get(target,key){return key==='exports'?exports:Reflect.get(target,key,target);}});
      return result.instance?{...result,instance:proxy}:proxy;
    };
    for(const name of ['instantiate','instantiateStreaming'])if(typeof WebAssembly[name]==='function'){
      const original=WebAssembly[name];WebAssembly[name]=async function(...args){return observe(await Reflect.apply(original,WebAssembly,args));};
    }
  },enabled);
  await page.goto(process.env.IHR_TEST_URL||'/');
  const bytes=[...await readFile('tests/e2e/fixtures/tiny.pdf')];
  const colors=['#2350b5','#d4a93c','#fffaf0'];
  await page.evaluate(async({bytes,geometry,colors})=>{
    const canvas=document.createElement('canvas');canvas.width=600;canvas.height=400;
    const context=canvas.getContext('2d');colors.forEach((color,i)=>{context.fillStyle=color;context.fillRect(i*200,0,200,400);});
    const cover=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
    const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('inhouse-read');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
    const tx=db.transaction('books','readwrite');
    const id='palette-editor',title='Inhouse Read test PDF';
    tx.objectStore('books').put({id,title,name:'tiny.pdf',format:'PDF',sourceType:'local',mimeType:'application/pdf',
      ...geometry,content:new Blob([new Uint8Array(bytes)],{type:'application/pdf'}),cover,pageCount:1,
      shelfOrder:0,addedAt:Date.now(),progressFraction:0,
      coverAppearance:{color:'#2350b5',shade:'#152f6c',ink:'#fffaf0',aspectRatio:1.5,fontFamily:'Lora',fontCanvasFamily:'Lora',source:'cover'},
      coverAppearanceKey:`${id}|${title}|${cover.type}|${cover.size}|`,spineColorOverride:'#2350b5'});
    await new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});db.close();
  },{bytes,geometry:await settledGeometryLength(4,'palette-editor'),colors});
  await page.reload();await page.waitForFunction(()=>window.paletteProof?.available);
  const spine=page.locator('.ihr-spine').first();
  const cards=page.getByRole('group',{name:'Propuestas de relieve'}).getByRole('checkbox');
  const observations=[];
  if(!enabled){
    await expect(spine).not.toHaveClass(/is-away/);
    const bounds=await spine.boundingBox();expect(bounds).not.toBeNull();
    await spine.click({position:await spinePointerPosition(spine,bounds)});
    await page.getByRole('button',{name:'Editar',exact:true}).click();
    await page.getByRole('tab',{name:'Portada',exact:true}).click();
    await expect(page.getByText('No se pudo analizar la portada')).toBeVisible({timeout:60000});
    await expect(page.getByRole('button',{name:'Reintentar',exact:true})).toBeVisible();
    await expect(cards).toHaveCount(0);
    const proof=await page.evaluate(()=>({...window.paletteProof}));
    expect(proof.jobs).toBe(0);expect(proof.live).toBe(0);expect(proof.refused).toBeGreaterThan(0);
    await page.getByRole('button',{name:'Listo',exact:true}).click();
    await page.getByRole('button',{name:'Cerrar',exact:true}).click();
    await expect(page.locator('.ihr-flyout')).toHaveCount(0,{timeout:30000});
    expect(errors).toEqual([]);
    await testInfo.attach('actual-editor-palette',{body:JSON.stringify({enabled,error:'analysis'}),contentType:'application/json'});
    return;
  }
  for(const stage of ['cold','cached']){
    await expect(spine).not.toHaveClass(/is-away/);
    const bounds=await spine.boundingBox();expect(bounds).not.toBeNull();
    await spine.click({position:await spinePointerPosition(spine,bounds)});
    await page.getByRole('button',{name:'Editar',exact:true}).click();
    const before=await page.evaluate(()=>({...window.paletteProof,at:performance.now()}));
    await page.getByRole('tab',{name:'Portada',exact:true}).click();
    await expect(cards).toHaveCount(3,{timeout:60000});
    await expect(page.locator('.ihr-flyout__book canvas')).toHaveAttribute('data-angle','0');
    const after=await page.evaluate(()=>({...window.paletteProof,at:performance.now()}));
    const selected=await cards.evaluateAll(nodes=>nodes.map(node=>node.closest('.ihr-relief-card').dataset.reliefColor));
    expect([...selected].sort()).toEqual([...colors].sort());
    expect(after.live).toBe(0);expect(after.jobs-before.jobs).toBe(enabled&&stage==='cold'?1:0);
    // The 288x192 analysis raster is stepped with pauses on the cold visit and not analysed again on the cached one.
    if(stage==='cold')expect(after.steps-before.steps).toBeGreaterThan(Math.floor(288*192/1024));else expect(after.steps-before.steps).toBe(0);
    expect(await page.locator('.ihr-flyout__book canvas').evaluate(canvas=>canvas instanceof HTMLCanvasElement&&canvas.width>0&&canvas.height>0)).toBe(true);
    observations.push({stage,ms:after.at-before.at,jobs:after.jobs-before.jobs,steps:after.steps-before.steps,colors:selected});
    await page.locator('.ihr-relief-card').nth(stage==='cold'?0:1).click();
    await expect.poll(()=>page.evaluate(()=>window.paletteProof.normalCalls),{timeout:30000}).toBeGreaterThan(before.normalCalls);

    await page.getByRole('button',{name:'Listo',exact:true}).click();
    await page.getByRole('button',{name:'Cerrar',exact:true}).click();
    await expect(page.locator('.ihr-flyout')).toHaveCount(0,{timeout:30000});
  }
  expect(errors).toEqual([]);
  await testInfo.attach('actual-editor-palette',{body:JSON.stringify({enabled,observations}),contentType:'application/json'});
});
