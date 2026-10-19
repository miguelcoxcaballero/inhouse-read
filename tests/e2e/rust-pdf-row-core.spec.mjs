import { expect, test } from '@playwright/test'
import { createServer } from 'vite'
import { createServer as createHttpServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { PDF_ROW_BENCH_CASES } from '../helpers/pdf-row-cases.mjs'

let server,httpServer,fixtureUrl,artifact
const html=`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><main id="result"></main><script type="module">
import { loadRustCore } from '/inhouse-read/src/js/rust-core.js';
import {requireRustUI} from '/inhouse-read/src/js/rust-ui.js';
import coreURL from '/inhouse-read/src/wasm/inhouse_read_core.wasm?url';
import { rustPDFRowLines,pdfRowLines } from '/inhouse-read/src/js/readers/pdf-row-layout-wasm.js';
import { legacyPDFRowLines } from '/inhouse-read/tests/unit/helpers/reference-pdf-pipeline.js';
import { extractPDFText } from '/inhouse-read/src/js/readers/pdf-text.js';
import { extractPDFText as referencePDFText } from '/inhouse-read/tests/unit/helpers/reference-pdf-text.js';
import { extractPDFText as beforeRowsPDFText } from '/inhouse-read/tests/unit/helpers/reference-before-pdf-rows.js';
import { PDF_ROW_BENCH_CASES,makePDFRowEntries,pdfContentFromEntries,PDF_ROW_VIEWPORT,assertExactPDFValue,
  assertPDFRowIdentities,assertPDFSourceIdentities } from '/inhouse-read/tests/helpers/pdf-row-cases.mjs';
import { fragmentedRowsPDF } from '/inhouse-read/tests/e2e/fixtures/pdf-fragmented-rows.mjs';
import { pdfImageRects,populatePDFReflow,clearPDFReflow } from '/inhouse-read/src/js/readers/pdf-reflow.js';
import { getDocument,GlobalWorkerOptions,OPS } from '/inhouse-read/node_modules/pdfjs-dist/legacy/build/pdf.mjs';
import workerURL from '/inhouse-read/node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
GlobalWorkerOptions.workerSrc=workerURL;
const bytes=await (await fetch(coreURL)).arrayBuffer();
const digest=await crypto.subtle.digest('SHA-256',bytes);
const artifact={bytes:bytes.byteLength,sha256:[...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,'0')).join('')};
const core=await loadRustCore({bytes});
if(!await requireRustUI())throw Error('Rust UI required for the PDF reflow');
if(typeof core?.pdf_row_lines!=='function')throw new Error('The actual PDF row kernel did not load');
const pause=()=>new Promise(resolve=>setTimeout(resolve,0));
const median=values=>[...values].sort((a,b)=>a-b)[Math.floor(values.length/2)];
window.pdfRowArtifact=artifact;
window.observePDFRowParity=async()=>{
  let items=0,lines=0,utf16=0;
  for(let sample=0;sample<100;sample++){
    const entries=makePDFRowEntries('mixed',1+(sample*37)%337,0x9913d51+sample*61),source=pdfContentFromEntries(entries),before=structuredClone(source);
    const actualRows=rustPDFRowLines(entries);if(actualRows===undefined)throw new Error('Direct kernel fell back');
    assertPDFRowIdentities(actualRows,legacyPDFRowLines(entries,false));
    const actual=extractPDFText(source,PDF_ROW_VIEWPORT),expected=referencePDFText(source,PDF_ROW_VIEWPORT);
    assertExactPDFValue(actual,expected);assertExactPDFValue(actual,beforeRowsPDFText(source,PDF_ROW_VIEWPORT));assertPDFSourceIdentities(actual,source);assertExactPDFValue(source,before);
    items+=source.items.length;lines+=actual.lines.length;utf16+=actual.text.length;
    if(sample%10===9)await pause();
  }
  return {artifact,cases:100,items,lines,utf16,exactParity:true,identitiesPreserved:true};
};
window.observePDFRowTiming=async(specification)=>{
  const report=[];
  for(const spec of [specification]){
    const entries=makePDFRowEntries(spec.kind,spec.count),source=pdfContentFromEntries(entries);
    const expectedRows=legacyPDFRowLines(entries,false),expected=referencePDFText(source,PDF_ROW_VIEWPORT);
    const direct=rustPDFRowLines(entries);if(direct===undefined)throw new Error('Direct kernel fell back');
    assertPDFRowIdentities(direct,expectedRows);assertExactPDFValue(extractPDFText(source,PDF_ROW_VIEWPORT),expected);assertExactPDFValue(beforeRowsPDFText(source,PDF_ROW_VIEWPORT),expected);
    const jobs={rowsJS:()=>legacyPDFRowLines(entries,false),rowsRust:()=>rustPDFRowLines(entries),
      extractionJS:()=>referencePDFText(source,PDF_ROW_VIEWPORT),extractionBeforeRows:()=>beforeRowsPDFText(source,PDF_ROW_VIEWPORT),extractionProduction:()=>extractPDFText(source,PDF_ROW_VIEWPORT)};
    const repetitions=spec.count<=32?16:spec.count<=128?4:1,samples=Object.fromEntries(Object.keys(jobs).map(key=>[key,[]]));
    for(let warm=0;warm<2;warm++){for(const run of Object.values(jobs))for(let n=0;n<repetitions;n++)run();await pause();}
    for(let round=0;round<9;round++){
      const order=round%2?Object.keys(jobs).reverse():Object.keys(jobs);
      for(const key of order){const start=performance.now();for(let n=0;n<repetitions;n++)jobs[key]();samples[key].push((performance.now()-start)/repetitions);await pause();}
    }
    assertPDFRowIdentities(rustPDFRowLines(entries),expectedRows);assertExactPDFValue(extractPDFText(source,PDF_ROW_VIEWPORT),expected);assertExactPDFValue(beforeRowsPDFText(source,PDF_ROW_VIEWPORT),expected);
    report.push({spec,repetitions,samples,medians:Object.fromEntries(Object.entries(samples).map(([key,values])=>[key,median(values)])),exactParity:true});
  }
  return {artifact,report,methodology:{warmups:2,rounds:9,alternating:true,timingAssertions:false},wasmCapacityBytes:core.memory.buffer.byteLength};
};
window.observeRealPDFRows=async()=>{
  const loading=getDocument({data:fragmentedRowsPDF(),useSystemFonts:true}),pdf=await loading.promise,pages=[];
  try{
    for(let number=1;number<=pdf.numPages;number++){
      const page=await pdf.getPage(number),content=await page.getTextContent(),view=page.getViewport({scale:1}),before=structuredClone(content);
      const actual=extractPDFText(content,view),expected=referencePDFText(content,view);
      assertExactPDFValue(actual,expected);assertExactPDFValue(actual,beforeRowsPDFText(content,view));assertPDFSourceIdentities(actual,content);assertExactPDFValue(content,before);
      const eligible=content.items.filter(item=>typeof item.str==='string'&&item.str).length;
      if(eligible<128||!actual.geometric)throw new Error('Real PDF fixture did not exercise the production Rust threshold');
      // Compare exact source transforms/font metadata/UTF-16 offsets above;
      // preserve each original composite illustration in the actual reflow too.
      const viewport=page.getViewport({scale:.5}),canvas=document.createElement('canvas');canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
      await page.render({canvasContext:canvas.getContext('2d'),viewport,recordImages:true}).promise;
      const rects=pdfImageRects(page.imageCoordinates||[],canvas.width,canvas.height),root=document.querySelector('#result');
      if(!rects.length)throw new Error('Real PDF fixture lost its composite image');
      populatePDFReflow(root,actual,canvas,rects,view);
      if(root.textContent!==expected.text)throw new Error('Reflow changed the complete source stream');
      const imageFacts=[];for(const cropped of root.querySelectorAll('canvas')){
        const data=cropped.getContext('2d').getImageData(0,0,cropped.width,cropped.height).data;
        let coloured=0;for(let offset=0;offset<data.length;offset+=4)if(data[offset]>data[offset+1]+25&&data[offset+1]>data[offset+2]+10)coloured++;
        if(!coloured)throw new Error('The original illustration colour disappeared');
        imageFacts.push({width:cropped.width,height:cropped.height,coloured});
      }
      pages.push({number,rotation:view.rotation,sourceItems:content.items.length,eligible,lines:actual.lines.length,
        paragraphs:actual.paragraphs.length,textUTF16Length:actual.text.length,text:actual.text,spans:actual.spans,
        sourceMetadata:actual.items.map(item=>({str:item.str,dir:item.dir,fontName:item.fontName,transform:item.transform,width:item.width,height:item.height,hasEOL:item.hasEOL})),imageFacts,exactParity:true});
      clearPDFReflow(root);canvas.width=canvas.height=0;page.cleanup();
    }
  }finally{await loading.destroy();}
  return {artifact,pages,exactParity:true};
};
window.pdfRowsReady=true;
</script></body></html>`

test.beforeAll(async()=>{
  const bytes=readFileSync(resolve('src/wasm/inhouse_read_core.wasm'))
  artifact={bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')}
  server=await createServer({configFile:false,root:process.cwd(),base:'/inhouse-read/',
    optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true,hmr:false,watch:null},
    plugins:[{name:'pdf-row-rust-fixture',configureServer(vite){vite.middlewares.use(async(req,res,next)=>{
      if(req.url?.split('?')[0]!=='/inhouse-read/__pdf-row-rust')return next()
      try{res.statusCode=200;res.setHeader('Content-Type','text/html');res.end(await vite.transformIndexHtml('/inhouse-read/__pdf-row-rust',html))}catch(error){next(error)}
    })}}]})
  httpServer=createHttpServer(server.middlewares);await new Promise(resolve=>httpServer.listen(0,'127.0.0.1',resolve))
  fixtureUrl='http://127.0.0.1:'+httpServer.address().port+'/inhouse-read/__pdf-row-rust'
})
test.afterAll(async()=>{httpServer?.closeAllConnections();if(httpServer)await new Promise((resolve,reject)=>httpServer.close(error=>error?reject(error):resolve()));await server?.close()})
const observations = [
  {label:'exact fuzz/UTF-16/source identities',method:'observePDFRowParity'},
  ...PDF_ROW_BENCH_CASES.map(input=>({
    label:'complete bridge and extraction observations '+input.kind+' '+input.count,
    method:'observePDFRowTiming',input
  })),
  {label:'real two-page PDF including rotated page and original images',method:'observeRealPDFRows'}
]
for(const {label,method,input} of observations) {
  test('Rust PDF rows: '+label,async({page,context},testInfo)=>{
    // A diagnostic measures five implementations across nine alternating
    // rounds at CPU x4. Its workload is separate from reader interaction
    // deadlines; the original functional contracts keep their own limits.
    if (method === 'observePDFRowTiming') test.setTimeout(120_000)
    await page.setViewportSize({width:390,height:844})
    const errors=[];page.on('pageerror',error=>errors.push(error.message))
    const cdp=await context.newCDPSession(page)
    await cdp.send('Emulation.setCPUThrottlingRate',{rate:4})
    await page.goto(fixtureUrl)
    await page.waitForFunction(()=>window.pdfRowsReady===true)
    const result=await page.evaluate(({method,input})=>window[method](input),{method,input})
    await testInfo.attach('pdf-row-'+method+'.json',{
      body:Buffer.from(JSON.stringify({device:'Desktop Chromium at390x844, CPU rate4; not a physical Android',...result},null,2)),
      contentType:'application/json'
    })
    expect(errors).toEqual([])
    expect(result.artifact).toEqual(artifact)
    if(result.report) {
      expect(result.report).toHaveLength(1)
      expect(result.report[0].spec).toEqual(input)
      for(const row of result.report) {
        expect(row.exactParity).toBe(true)
        for(const samples of Object.values(row.samples)) {
          expect(samples).toHaveLength(9)
          expect(samples.every(value=>Number.isFinite(value)&&value>=0)).toBe(true)
        }
      }
    } else {
      expect(result.exactParity).toBe(true)
    }
    if(result.pages) {
      expect(result.pages).toHaveLength(2)
      expect(result.pages.map(page=>page.rotation)).toEqual([0,90])
      expect(result.pages.every(page=>page.imageFacts.length>0)).toBe(true)
    }
  })
}
