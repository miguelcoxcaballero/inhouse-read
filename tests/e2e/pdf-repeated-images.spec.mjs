import {test,expect} from '@playwright/test';
import {manyImagesPDF} from './fixtures/pdf-many-images.mjs';
import {PDF_PAGE_FILTERS} from '../../src/js/readers/reading-palette.js';
test.use({viewport:{width:390,height:844},deviceScaleFactor:1,isMobile:true,hasTouch:true});
for(const mode of ['text','original'])test(`32 repeated PDF photos survive every theme in ${mode} view`,async({page},testInfo)=>{
 test.setTimeout(90_000);await page.emulateMedia({reducedMotion:'reduce'});
 await page.addInitScript(pdfMode=>localStorage.setItem('inhouse-read-reading-preferences',JSON.stringify({pdfMode,theme:'paper',fontSize:20,margin:16})),mode);
 await page.goto(process.env.IHR_TEST_URL||'./');
 await page.locator('#file-picker').setInputFiles({name:'Repeated photographs.pdf',mimeType:'application/pdf',buffer:Buffer.from(manyImagesPDF())});
 await expect(page.locator('.pdf-reader')).toHaveAttribute('aria-busy','false');
 if(mode==='text')await expect(page.locator('.pdf-reflow-image')).toHaveCount(32);
 const snapshot=()=>page.evaluate(mode=>{
  if(mode==='text')return [...document.querySelectorAll('.pdf-reflow-image')].map(canvas=>({width:canvas.width,height:canvas.height,bytes:[...canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data]}));
  const canvas=document.querySelector('.pdf-page-canvas'),ctx=canvas.getContext('2d');
  const photos=Array.from({length:32},(_,i)=>Array.from({length:4},(_,swatch)=>[...ctx.getImageData(Math.round((20+i%4*96+72*(swatch+.5)/4)*canvas.width/400),Math.round((90+Math.floor(i/4)*82)*canvas.height/800),1,1).data]));
  return {photos,paper:[...ctx.getImageData(Math.round(10*canvas.width/400),Math.round(10*canvas.height/800),1,1).data]};
 },mode);
 const original=await snapshot(),facts=[];
 for(const theme of ['sepia','night','amoled','sage']){
  await page.evaluate(theme=>document.querySelector('.reading-panel [data-theme="'+theme+'"]').click(),theme);
  await expect(page.locator('.pdf-reader')).toHaveAttribute('aria-busy','false');
  if(mode==='text'){
   await expect(page.locator('.pdf-reflow-image')).toHaveCount(32);
   const actual=await snapshot();expect(actual).toEqual(original);
   expect(await page.locator('.pdf-reflow-page').textContent()).toContain('All thirty-two illustrations retain their original colours.');
   facts.push({theme,images:actual.length,identical:true});
  }else{
   // Theme updates can commit without an aria-busy transition. Wait for the
   // visible paper to change, then verify all 128 photograph samples exactly.
   const expectedPaper=await page.evaluate(filter=>{
    const white=document.createElement('canvas');white.width=white.height=1;white.getContext('2d').fillStyle='#fff';white.getContext('2d').fillRect(0,0,1,1);
    const result=document.createElement('canvas');result.width=result.height=1;const ctx=result.getContext('2d');ctx.filter=filter;ctx.drawImage(white,0,0);return [...ctx.getImageData(0,0,1,1).data];
   },PDF_PAGE_FILTERS[theme]);
   await expect.poll(async()=>(await snapshot()).paper).toEqual(expectedPaper);
   const actual=await snapshot();expect(actual.photos).toEqual(original.photos);facts.push({theme,images:actual.photos.length,paper:actual.paper,identical:true});
  }
 }
 await testInfo.attach('repeated-photo-themes',{body:JSON.stringify(facts),contentType:'application/json'});
});
