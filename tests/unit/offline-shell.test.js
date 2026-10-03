// @vitest-environment node
import {afterEach, describe, expect, it, vi} from 'vitest'
import {webcrypto, createHash} from 'node:crypto'
import {mkdtemp, mkdir, writeFile, readFile, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createOfflineShell} from '../../src/js/offline-shell-worker.js'
import {registerOfflineShell} from '../../src/js/offline-shell.js'
import {generateOfflineShell, isShellFile} from '../../scripts/generate-offline-shell.mjs'

const BASE='https://read.test/inhouse-read/'
const hash=body=>createHash('sha256').update(body).digest('hex')
const url=path=>new URL(path,BASE).href
const source={'index.html':'<script src="assets/main-new.js"></script>','assets/main-new.js':'export const ready=true','assets/reader-new.js':'export const reader=true','neural-voice/ort/ort.wasm.min.mjs':'export const ort=true'}
function harness(version='current',files=source) {
  const maps=new Map(), listeners={}
  const caches={
    keys:async()=>[...maps.keys()],delete:vi.fn(async name=>maps.delete(name)),
    open:vi.fn(async name=>{
      if(!maps.has(name))maps.set(name,new Map())
      const map=maps.get(name)
      return {match:async key=>map.get(typeof key==='string'?key:key.url)?.clone(),
        put:async(key,response)=>{map.set(typeof key==='string'?key:key.url,response.clone())}}
    })
  }
  const scope={caches,crypto:webcrypto,location:{href:url('sw.js')},clients:{claim:vi.fn()},skipWaiting:vi.fn(),
    addEventListener:(type,listener)=>{listeners[type]=listener},
    fetch:vi.fn(async request=>{const key=new URL(typeof request==='string'?request:request.url).pathname.slice('/inhouse-read/'.length)
      return key in files?new Response(files[key]):new Response('missing',{status:404})})}
  const manifest={base:'/inhouse-read/',version,entries:Object.entries(files).map(([path,body])=>({path,bytes:Buffer.byteLength(body),sha256:hash(body)}))}
  return {scope,maps,listeners,manifest,worker:createOfflineShell(scope,manifest)}
}
const request=(path,extra={})=>({url:url(path),method:'GET',mode:'cors',cache:'default',headers:new Headers(),...extra})
let temp
afterEach(async()=>{if(temp){await rm(temp,{recursive:true,force:true});temp=null}vi.restoreAllMocks()})

describe('atomic offline app shell',()=>{
  it('hashes every file before publishing its completion marker and claims only on activation',async()=>{
    const h=harness();expect((await h.worker.status()).ready).toBe(false)
    await h.worker.install();expect(await h.worker.status()).toMatchObject({ready:true,entries:4})
    expect(h.scope.clients.claim).not.toHaveBeenCalled()
    expect([...h.maps.get(h.worker.cacheName).keys()].at(-1)).toBe(url('.offline-shell-complete'))
    expect(h.scope.fetch.mock.calls.every(([,options])=>options.cache==='no-store')).toBe(true)
    await h.worker.activate();expect(h.scope.clients.claim).toHaveBeenCalledOnce()
    expect(h.scope.skipWaiting).toHaveBeenCalledOnce()
  })
  it('ignores incomplete staging data during offline navigation',async()=>{
    const h=harness(),cache=await h.scope.caches.open(h.worker.cacheName)
    await cache.put(url('index.html'),new Response('partial'))
    h.scope.fetch.mockRejectedValue(new Error('offline'))
    await expect(h.worker.handle(request('?t=999',{mode:'navigate'}))).rejects.toThrow('offline')
    await expect(h.worker.activate()).rejects.toThrow('incomplete')
  })
  it('promotes a worker-only policy update when the existing resource manifest is unchanged',async()=>{
    const h=harness();await h.worker.install();h.scope.fetch.mockClear();h.scope.skipWaiting.mockClear()
    const updated=createOfflineShell(h.scope,h.manifest);await updated.install()
    expect(h.scope.fetch).not.toHaveBeenCalled();expect(h.scope.skipWaiting).toHaveBeenCalledOnce()
  })
  it.each(['http','checksum','size','quota'])('preserves the previous complete shell when a %s install fails',async failure=>{
    const h=harness('old');await h.worker.install()
    const next=createOfflineShell(h.scope,{...h.manifest,version:'new'})
    const original=h.scope.fetch.getMockImplementation()
    h.scope.fetch.mockImplementation(async req=>{
      if(String(req).endsWith('reader-new.js')) {
        if(failure==='http')return new Response('',{status:503})
        if(failure==='checksum')return new Response('x'.repeat(Buffer.byteLength(source['assets/reader-new.js'])))
        if(failure==='size')return new Response('short')
      }
      return original(req)
    })
    if(failure==='quota') {
      const open=h.scope.caches.open.getMockImplementation()
      h.scope.caches.open.mockImplementation(async name=>{
        const cache=await open(name)
        if(name===next.cacheName)cache.put=async()=>{throw new DOMException('full','QuotaExceededError')}
        return cache
      })
    }
    await expect(next.install()).rejects.toThrow()
    expect(h.maps.has(h.worker.cacheName)).toBe(true);expect(h.maps.has(next.cacheName)).toBe(false)
    h.scope.fetch.mockRejectedValue(new Error('offline'))
    expect(await(await next.handle(request('?t=20',{mode:'navigate'}))).text()).toBe(source['index.html'])
  })
  it('keeps current and one previous complete shell and leaves book/voice caches alone',async()=>{
    const h=harness('oldest');await h.worker.install()
    await new Promise(resolve=>setTimeout(resolve,2))
    const previous=createOfflineShell(h.scope,{...h.manifest,version:'previous'});await previous.install()
    const current=createOfflineShell(h.scope,{...h.manifest,version:'current'});await current.install()
    await h.scope.caches.open('inhouse-piper-models');await h.scope.caches.open('inhouse-supertonic3-v1')
    await current.activate()
    expect(await h.scope.caches.keys()).toEqual(expect.arrayContaining([previous.cacheName,current.cacheName,'inhouse-piper-models','inhouse-supertonic3-v1']))
    expect(h.maps.has(h.worker.cacheName)).toBe(false)
  })
  it('uses fresh online navigation despite a cached index, including cache-busting query strings',async()=>{
    const h=harness();await h.worker.install()
    h.scope.fetch.mockResolvedValue(new Response('new deployment'))
    expect(await(await h.worker.handle(request('?t=222',{mode:'navigate'}))).text()).toBe('new deployment')
    expect(h.scope.fetch).toHaveBeenLastCalledWith(expect.objectContaining({url:url('?t=222')}),{cache:'no-store'})
  })
  it('does not downgrade a new online app on a subsequent cold offline navigation, even under the older worker',async()=>{
    const h=harness('previous');await h.worker.install();await new Promise(resolve=>setTimeout(resolve,2))
    const files={'index.html':'latest shell','assets/main-next.js':'next'}
    const next=createOfflineShell(h.scope,{...h.manifest,version:'next',entries:Object.entries(files).map(([path,body])=>({path,bytes:body.length,sha256:hash(body)}))})
    h.scope.fetch.mockImplementation(async req=>new Response(files[new URL(typeof req==='string'?req:req.url).pathname.slice('/inhouse-read/'.length)||'index.html']))
    expect(await(await h.worker.handle(request('?t=33',{mode:'navigate'}))).text()).toBe('latest shell')
    await next.install()
    h.scope.fetch.mockRejectedValue(new Error('offline'))
    expect(await(await h.worker.handle(request('?t=44',{mode:'navigate'}))).text()).toBe('latest shell')
    expect(await(await h.worker.handle(request('assets/main-next.js'))).text()).toBe('next')
  })
  it('reopens offline root/index with arbitrary query and serves the download page only for its own navigation',async()=>{
    const h=harness('current',{...source,'download-android.html':'download'});await h.worker.install()
    h.scope.fetch.mockRejectedValue(new Error('offline'))
    for(const path of ['?t=DateNow','index.html?t=22'])expect(await(await h.worker.handle(request(path,{mode:'navigate'}))).text()).toBe(source['index.html'])
    expect(await(await h.worker.handle(request('download-android.html?from=app',{mode:'navigate'}))).text()).toBe('download')
    expect(await h.worker.handle(request('oauth/callback?code=secret',{mode:'navigate'}))).toBeNull()
  })
  it('does not satisfy freshness HTML fetches, update metadata, auth or model downloads from the shell',async()=>{
    const h=harness();await h.worker.install()
    for(const path of ['index.html?t=22','android-update.json','sw.js','auth/callback','neural-voice/phon/dict/ru_dict','models/voice.onnx'])
      expect(await h.worker.handle(request(path,{cache:'no-store'}))).toBeNull()
    for(const path of ['android-update.json','auth/callback','models/voice.onnx'])expect(await h.worker.handle(request(path))).toBeNull()
    for(const path of ['android-update.json','auth/callback','models/voice.onnx','index.html']) {
      const event={request:request(path),respondWith:vi.fn()};h.listeners.fetch(event)
      expect(event.respondWith).not.toHaveBeenCalled()
    }
    expect(await h.worker.handle(request('index.html',{method:'POST'}))).toBeNull()
    expect(await h.worker.handle({...request(''),url:'https://huggingface.co/voice.onnx'})).toBeNull()
    expect(await h.worker.handle(request('assets/main-new.js',{headers:new Headers({range:'bytes=1-2'})}))).toBeNull()
  })
  it('serves cold worker modules and revisioned static resources offline without querying the network',async()=>{
    const h=harness();await h.worker.install();h.scope.fetch.mockClear().mockRejectedValue(new Error('offline'))
    for(const path of ['assets/reader-new.js','neural-voice/ort/ort.wasm.min.mjs?v=revision'])
      expect(await(await h.worker.handle(request(path))).text()).toBe(source[path.split('?')[0]])
    expect(h.scope.fetch).not.toHaveBeenCalled()
  })
  it('allows an old hashed dynamic chunk from the previous complete shell',async()=>{
    const h=harness('previous');await h.worker.install()
    const nextFiles={'index.html':'new','assets/main-next.js':'next'}
    const next=createOfflineShell(h.scope,{...h.manifest,version:'next',entries:Object.entries(nextFiles).map(([path,body])=>({path,bytes:body.length,sha256:hash(body)}))})
    h.scope.fetch.mockImplementation(async req=>new Response(nextFiles[new URL(req).pathname.slice('/inhouse-read/'.length)]))
    await next.install();await next.activate();h.scope.fetch.mockRejectedValue(new Error('offline'))
    expect(await(await next.handle(request('assets/reader-new.js'))).text()).toBe(source['assets/reader-new.js'])
  })
  it('returns the real network error response when online but the shell has no complete fallback',async()=>{
    const h=harness();h.scope.fetch.mockResolvedValue(new Response('server error',{status:503}))
    expect((await h.worker.handle(request('',{mode:'navigate'}))).status).toBe(503)
  })
})

describe('shell generation and registration',()=>{
  it('includes reader/worker/ORT/phon resources and excludes models, maps, dictionaries and update metadata',()=>{
    for(const path of ['index.html','download-android.html','assets/worker-hash.js','assets/pdf.worker-hash.mjs','assets/image-hash.webp','neural-voice/ort/ort-wasm-simd-threaded.wasm','neural-voice/phon/piper_phonemize.data','licenses/piper.txt'])expect(isShellFile(path)).toBe(true)
    for(const path of ['android-update.json','assets/main-hash.js.map','assets/voice.onnx','models/file.onnx','neural-voice/phon/dict/bg_dict','neural-voice/phon/README.md'])expect(isShellFile(path)).toBe(false)
  })
  it('generates a deterministic standalone worker and changes the version when any runtime bytes change',async()=>{
    temp=await mkdtemp(join(tmpdir(),'ihr-offline-'));await mkdir(join(temp,'assets'))
    await writeFile(join(temp,'index.html'),'index');await writeFile(join(temp,'assets/main-hash.js'),'main')
    await writeFile(join(temp,'assets/main-hash.js.map'),'exclude');await writeFile(join(temp,'android-update.json'),'network')
    const first=await generateOfflineShell({directory:temp})
    expect(first.entries.map(entry=>entry.path)).toEqual(['assets/main-hash.js','index.html'])
    expect(await generateOfflineShell({directory:temp})).toEqual(first)
    const script=await readFile(join(temp,'sw.js'),'utf8');expect(()=>new Function(script)).not.toThrow()
    expect(script).toContain(first.version);expect(script).not.toContain('import(')
    await writeFile(join(temp,'assets/main-hash.js'),'changed')
    expect((await generateOfflineShell({directory:temp})).version).not.toBe(first.version)
  })
  it('refuses an incomplete build rather than generating a false offline shell',async()=>{
    temp=await mkdtemp(join(tmpdir(),'ihr-offline-'));await writeFile(join(temp,'index.html'),'index')
    await expect(generateOfflineShell({directory:temp})).rejects.toThrow('entry module')
  })
  it('registers at the deployed base with browser HTTP cache disabled for worker updates',async()=>{
    const register=vi.fn(async()=>({active:{}}))
    expect(await registerOfflineShell({navigator:{serviceWorker:{register}},location:new URL(url('?t=222')),base:'/inhouse-read/',production:true})).toEqual({active:{}})
    expect(register).toHaveBeenCalledWith(url('sw.js'),{scope:'/inhouse-read/',updateViaCache:'none'})
  })
  it('leaves development and unsupported/file origins alone and reports registration failures',async()=>{
    const navigator={serviceWorker:{register:vi.fn().mockRejectedValue(new Error('quota'))}}
    expect(await registerOfflineShell({navigator,location:new URL(BASE),production:false})).toBeNull()
    expect(await registerOfflineShell({navigator:{},location:new URL(BASE),production:true})).toBeNull()
    expect(await registerOfflineShell({navigator,location:new URL('file:///android_asset/index.html'),production:true})).toBeNull()
    expect(navigator.serviceWorker.register).not.toHaveBeenCalled()
    await expect(registerOfflineShell({navigator,location:new URL(BASE),base:'/inhouse-read/',production:true})).rejects.toThrow('quota')
  })
})
