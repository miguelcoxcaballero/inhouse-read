import {test,expect} from '@playwright/test'
import {readFileSync} from 'node:fs'
import {resolve} from 'node:path'

test('real espeak renews its heap beyond 120 calls offline without fetching its code or pack again',async({page,context},testInfo)=>{
  test.setTimeout(90000)
  const requests=[],failures=[]
  page.on('request',request=>{if(request.url().includes('/neural-voice/phon/'))requests.push(request.url())})
  page.on('requestfailed',request=>{if(request.url().includes('/neural-voice/phon/'))failures.push({url:request.url(),error:request.failure()})})
  await page.route('**/phonemizer-harness/**',async route=>{
    const name=new URL(route.request().url()).pathname.split('/').at(-1)
    if(name==='index.html')return route.fulfill({contentType:'text/html',body:'<!doctype html><title>Real phonemizer rebuild</title>'})
    if(!['phonemizer.js','phonemizer-assets.js','dictionary-cache.js'].includes(name))throw new Error('Unknown phonemizer harness module')
    return route.fulfill({contentType:'text/javascript',body:readFileSync(resolve('src/js/readers/neural-voice',name),'utf8')})
  })
  await page.goto('phonemizer-harness/index.html')
  await page.evaluate(()=>{
    window.phonResults=[];window.phonError=null
    const code=`import {createPhonemizer} from '${location.origin}/phonemizer-harness/phonemizer.js';
      const jobs=[['en-us','The quiet reader listens to the natural voice.'],['nl','De lezer luistert naar de stem.'],['es-419','El lector escucha la voz natural.']];
      let phon;
      self.onmessage=async({data})=>{try{
        if(data==='start')phon=await createPhonemizer({base:'${new URL('../neural-voice/phon/',location.href).href}'});
        const count=data==='start'?40:121;
        for(let i=0;i<count;i++){
          const index=(data==='start'?0:40)+i,[voice,text]=jobs[index%3];
          const ids=await phon.phonemize(text,voice);
          self.postMessage({index,voice,ids});
        }
        self.postMessage({phase:data==='start'?'ready':'complete'});
      }catch(error){self.postMessage({error:String(error.stack||error)})}};`
    const url=URL.createObjectURL(new Blob([code],{type:'text/javascript'}))
    window.phonWorker=new Worker(url,{type:'module'})
    window.phonWorker.onmessage=({data})=>{
      if(data.error)window.phonError=data.error
      else if(data.phase)window.phonPhase=data.phase
      else window.phonResults.push(data)
    }
    window.phonWorker.postMessage('start')
  })
  await expect.poll(()=>page.evaluate(()=>({phase:window.phonPhase,error:window.phonError})),{timeout:30000}).toEqual({phase:'ready',error:null})
  const originalRequests=requests.slice()
  await context.setOffline(true)
  await page.evaluate(()=>window.phonWorker.postMessage('continue'))
  await expect.poll(()=>page.evaluate(()=>({phase:window.phonPhase,error:window.phonError})),{timeout:30000}).toEqual({phase:'complete',error:null})
  const result=await page.evaluate(()=>window.phonResults)
  expect(result).toHaveLength(161);expect(result.map(item=>item.index)).toEqual(Array.from({length:161},(_,i)=>i))
  for(const voice of ['en-us','nl','es-419']){
    const rows=result.filter(item=>item.voice===voice),first=rows[0].ids
    expect(first.length).toBeGreaterThan(10);expect(first.every(Number.isInteger)).toBe(true)
    expect(rows.every(item=>JSON.stringify(item.ids)===JSON.stringify(first))).toBe(true)
  }
  expect(requests).toEqual(originalRequests);expect(failures).toEqual([])
  expect(originalRequests.filter(url=>url.includes('piper_phonemize.wasm'))).toHaveLength(1)
  expect(originalRequests.filter(url=>url.includes('piper_phonemize.data'))).toHaveLength(1)
  await testInfo.attach('real-espeak-offline-rebuild',{body:JSON.stringify({requests,failures,result,scope:'Real espeak WASM, unchanged phoneme IDs and five fresh heaps; offline network, no Android or PCM playback claim.'}),contentType:'application/json'})
  await page.evaluate(()=>window.phonWorker.terminate())
})
