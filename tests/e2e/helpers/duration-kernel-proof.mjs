// Test-only observation inside the actual compiled synthesis worker: the page-boundary placement of every Piper sentence runs inside voice_finish_piper (the Rust duration kernel).
// Since 1.7.329 the worker's runtime is Rust too (rust-ui voice_worker.rs): JavaScript hands each job to the voice module's voice_worker_enqueue and the job calls
// voice_host_finish_piper (rust-ui voice_kernels.rs) on Rust values, inside the module, so no JavaScript call of that export exists to count any more. What crosses the
// boundary now is the job going in and the finished sentence coming out, and both are observed here: `instances` counts the voice module (it links the same kernel the
// import-free voice core exports, `cores`), `jobs` the synthesis jobs JavaScript gave to the compiled runtime, `chunks` the sentences of real audio it posted, `marks` the
// page boundaries the kernel placed in them (only voice_finish_piper writes those records) and `calls` the JavaScript calls of the kernel's export, which must stay at
// zero: a JavaScript path that finished a sentence would have to go through it.
export async function observeDurationKernel(page){
 await page.route(/\/assets\/worker-[\w-]+\.js$/,async route=>{
  const response=await route.fetch()
  const prelude=`self.__durationRustProof={instances:0,cores:0,jobs:0,chunks:0,samples:0,marks:0,calls:0};{const proof=self.__durationRustProof,post=self.postMessage;self.postMessage=function(message,...rest){if(message?.type==='chunk'&&message.pcm instanceof Float32Array){proof.chunks++;proof.samples+=message.pcm.length;if(Array.isArray(message.marks))proof.marks+=message.marks.filter(mark=>Number.isFinite(mark?.offset)&&Number.isFinite(mark?.sample)).length}return Reflect.apply(post,self,[message,...rest])}}const observeDuration=result=>{const instance=result.instance||result,actual=instance.exports;if(!actual.voice_finish_piper)return result;if(!actual.voice_host_finish_piper||!actual.voice_worker_enqueue){self.__durationRustProof.cores++;return result}self.__durationRustProof.instances++;const exports={...actual,voice_worker_enqueue:(...args)=>{self.__durationRustProof.jobs++;return actual.voice_worker_enqueue(...args)},voice_host_finish_piper:(...args)=>{self.__durationRustProof.calls++;return actual.voice_host_finish_piper(...args)}};const proxy=new Proxy(instance,{get(target,key){return key==='exports'?exports:Reflect.get(target,key,target)}});return result.instance?{...result,instance:proxy}:proxy};for(const name of ['instantiate','instantiateStreaming'])if(WebAssembly[name]){const original=WebAssembly[name];WebAssembly[name]=async function(...args){return observeDuration(await Reflect.apply(original,WebAssembly,args))}};\n`
  await route.fulfill({response,body:prelude+await response.text()})
 })
}
export async function durationKernelProof(page){
 const proofs=await Promise.all(page.workers().map(worker=>worker.evaluate(()=>self.__durationRustProof)))
 return proofs.find(proof=>proof?.instances>0)
}
