import {test,expect} from '@playwright/test';

for (const lit of [false,true]) test(`compiled cabinet uses Rust contact shadows with unchanged image, lit=${lit}`,async({browser},testInfo)=>{
 test.setTimeout(180000);const results=[];
 for(const enabled of [false,true]){
  const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:1});
  try{
   const page=await context.newPage();await page.emulateMedia({reducedMotion:'reduce'});
   await page.addInitScript(({enabled,lit})=>{
    localStorage.setItem('inhouse-read-shelf-type','walnut');
    localStorage.setItem('inhouse-read-shelf-view','isometric');
    localStorage.setItem('inhouse-read-shelf-plants','[]');
    localStorage.setItem('inhouse-read-shelf-lamps',JSON.stringify(lit?[{key:'lamp:proof',lampId:'mittled',shelf:0,x:.58}]:[]));
    window.occlusionProof={available:false,calls:0};
    const observe=result=>{const instance=result.instance||result,actual=instance.exports;if(typeof actual?.shelf_occlusion!=='function')return result;
     window.occlusionProof.available=true;const exports={...actual,shelf_occlusion:enabled?(...args)=>{window.occlusionProof.calls++;return actual.shelf_occlusion(...args);}:undefined};
     const proxy=new Proxy(instance,{get(target,key){return key==='exports'?exports:Reflect.get(target,key,target);}});return result.instance?{...result,instance:proxy}:proxy;
    };
    for(const name of ['instantiate','instantiateStreaming'])if(typeof WebAssembly[name]==='function'){const original=WebAssembly[name];WebAssembly[name]=async function(...args){return observe(await Reflect.apply(original,WebAssembly,args));};}
   },{enabled,lit});
   const errors=[];page.on('pageerror',error=>errors.push(error.message));await page.goto(process.env.IHR_TEST_URL||'./');
   await page.waitForFunction(()=>window.occlusionProof.available);
   const scene=page.locator('.ihr-bookshelf-scene');
   await expect(scene).toHaveAttribute('data-animating','false',{timeout:60000});
   await expect(scene).toHaveAttribute('data-active-lamp-lights',lit?'1':'0',{timeout:60000});
   // Wait for the final still snapshot, not one of the low-detail moving frames.
   let previous='',stable=0;
   for(let i=0;i<40&&stable<4;i++){
    await page.waitForTimeout(150);const current=await scene.getAttribute('data-snapshot-render-count');
    stable=current===previous?stable+1:0;previous=current;
   }
   expect(stable).toBe(4);
   const result=await scene.evaluate(canvas=>{
    const data=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;let hash=2166136261;
    for(const byte of data)hash=Math.imul(hash^byte,16777619);
    return {width:canvas.width,height:canvas.height,bytes:data.length,hash:hash>>>0,proof:window.occlusionProof};
   });
   expect(errors).toEqual([]);expect(result.bytes).toBeGreaterThan(100000);
   if(enabled)expect(result.proof.calls).toBeGreaterThan(0);else expect(result.proof.calls).toBe(0);
   results.push(result);await testInfo.attach(`cabinet-${enabled?'rust':'reference'}`,{body:await scene.screenshot(),contentType:'image/png'});
  }finally{await context.close();}
 }
 expect({...results[0],proof:null}).toEqual({...results[1],proof:null});
 await testInfo.attach('compiled-shadow-proof',{body:JSON.stringify({lit,results}),contentType:'application/json'});
});
