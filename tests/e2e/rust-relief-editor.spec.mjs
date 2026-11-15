import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { settledGeometryLength } from './helpers/settled-geometry-length.mjs';
import { spinePointerPosition } from './helpers/shelf-pointer.mjs';

// The relief passes are jobs of the shelf module (rust-ui/src/relief_job.rs), and since the flows make and
// step them inside that module (rust-ui/src/relief_flow.rs) no pass crosses a wasm export the page could be
// watched at: `reliefjob_analysis`, `reliefjob_step`, `reliefjob_render` and the job's free are only called by
// the unit tests' own generators now. What this spec reads instead are the module's own counters, as raw
// exports of the instantiated module: `relief_analyses_made` and `relief_analysis_steps` (colour analyses made
// and the steps they took), `relief_jobs_made` and `relief_jobs_live` (every pass, made and not yet freed).
// The failure case hands the analysis a raster without pixels at the platform boundary the flow reads it from
// (the 288 px unsmoothed working raster's getImageData): the job refuses it in Rust and the editor must report
// the analysis error instead of proposing colours. What happens inside a job (its seed, its colours, the rows
// of its normals) is compared with the frozen bridge by relief-job-differential.test.js.
for (const enabled of [false,true]) test(`real relief editor cold and cached: ${enabled?'Rust':'module whose analysis job fails'}`,async({page},testInfo)=>{
  // New diagnostic includes a cold room and two real flyouts/materials. It
  // does not alter the original reader/native-return timing contracts.
  test.setTimeout(120000);
  await page.setViewportSize({width:390,height:844});
  await page.emulateMedia({reducedMotion:'no-preference'});
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(enabled=>{
    const proof=window.paletteProof={available:false,refused:0,read:null};
    const observe=result=>{
      const actual=(result.instance||result).exports;
      if(typeof actual?.relief_analyses_made!=='function')return result;
      proof.read=()=>({jobs:actual.relief_analyses_made()>>>0,steps:actual.relief_analysis_steps()>>>0,
        made:actual.relief_jobs_made()>>>0,live:actual.relief_jobs_live()>>>0,refused:proof.refused});
      proof.available=true;return result;
    };
    for(const name of ['instantiate','instantiateStreaming'])if(typeof WebAssembly[name]==='function'){
      const original=WebAssembly[name];WebAssembly[name]=async function(...args){return observe(await Reflect.apply(original,WebAssembly,args));};
    }
    // Fail only the analysis for the failure case: its working raster (288 px on the long side, read without
    // smoothing) comes back without pixels. Every other raster, pass, renderer, image and shader is untouched.
    if(!enabled)for(const type of [globalThis.CanvasRenderingContext2D,globalThis.OffscreenCanvasRenderingContext2D])if(type){
      const original=type.prototype.getImageData;
      type.prototype.getImageData=function(x,y,width,height,...rest){
        if(this.imageSmoothingEnabled===false&&Math.max(width,height)===288){proof.refused++;return {data:new Uint8ClampedArray(0),width,height};}
        return Reflect.apply(original,this,[x,y,width,height,...rest]);
      };
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
    const proof=await page.evaluate(()=>window.paletteProof.read());
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
    const before=await page.evaluate(()=>({...window.paletteProof.read(),at:performance.now()}));
    await page.getByRole('tab',{name:'Portada',exact:true}).click();
    await expect(cards).toHaveCount(3,{timeout:60000});
    await expect(page.locator('.ihr-flyout__book canvas')).toHaveAttribute('data-angle','0');
    const after=await page.evaluate(()=>({...window.paletteProof.read(),at:performance.now()}));
    const selected=await cards.evaluateAll(nodes=>nodes.map(node=>node.closest('.ihr-relief-card').dataset.reliefColor));
    expect([...selected].sort()).toEqual([...colors].sort());
    expect(after.live).toBe(0);expect(after.jobs-before.jobs).toBe(enabled&&stage==='cold'?1:0);
    // The 288x192 analysis raster is stepped with pauses on the cold visit and not analysed again on the cached one.
    if(stage==='cold')expect(after.steps-before.steps).toBeGreaterThan(Math.floor(288*192/1024));else expect(after.steps-before.steps).toBe(0);
    expect(await page.locator('.ihr-flyout__book canvas').evaluate(canvas=>canvas instanceof HTMLCanvasElement&&canvas.width>0&&canvas.height>0)).toBe(true);
    observations.push({stage,ms:after.at-before.at,jobs:after.jobs-before.jobs,steps:after.steps-before.steps,colors:selected});
    // Choosing a colour builds and renders its maps: passes are made after the click, and none outlives it.
    const chosen=await page.evaluate(()=>window.paletteProof.read());
    await page.locator('.ihr-relief-card').nth(stage==='cold'?0:1).click();
    await expect.poll(()=>page.evaluate(()=>window.paletteProof.read().made),{timeout:30000}).toBeGreaterThan(chosen.made);
    await expect.poll(()=>page.evaluate(()=>window.paletteProof.read().live),{timeout:30000}).toBe(0);
    expect((await page.evaluate(()=>window.paletteProof.read())).jobs).toBe(after.jobs);

    await page.getByRole('button',{name:'Listo',exact:true}).click();
    await page.getByRole('button',{name:'Cerrar',exact:true}).click();
    await expect(page.locator('.ihr-flyout')).toHaveCount(0,{timeout:30000});
  }
  expect(errors).toEqual([]);
  await testInfo.attach('actual-editor-palette',{body:JSON.stringify({enabled,observations}),contentType:'application/json'});
});
