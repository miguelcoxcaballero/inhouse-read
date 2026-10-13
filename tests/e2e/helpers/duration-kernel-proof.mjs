// Test-only observation inside the actual compiled synthesis worker.
export async function observeDurationKernel(page){
 await page.route(/\/assets\/worker-[\w-]+\.js$/,async route=>{
  const response=await route.fetch()
  const prelude=`self.__durationRustProof={instances:0,calls:0};const observeDuration=result=>{const instance=result.instance||result,actual=instance.exports;if(!actual.duration_marks)return result;self.__durationRustProof.instances++;const exports={...actual,duration_marks:(...args)=>{self.__durationRustProof.calls++;return actual.duration_marks(...args)}};const proxy=new Proxy(instance,{get(target,key){return key==='exports'?exports:Reflect.get(target,key,target)}});return result.instance?{...result,instance:proxy}:proxy};for(const name of ['instantiate','instantiateStreaming'])if(WebAssembly[name]){const original=WebAssembly[name];WebAssembly[name]=async function(...args){return observeDuration(await Reflect.apply(original,WebAssembly,args))}};\n`
  await route.fulfill({response,body:prelude+await response.text()})
 })
}
export async function durationKernelProof(page){
 const proofs=await Promise.all(page.workers().map(worker=>worker.evaluate(()=>self.__durationRustProof)))
 return proofs.find(proof=>proof?.instances>0)
}
