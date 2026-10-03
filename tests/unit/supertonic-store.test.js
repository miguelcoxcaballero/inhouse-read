import {describe,it,expect,vi} from 'vitest';
import {webcrypto} from 'node:crypto';
import {SupertonicStore} from '../../src/js/readers/neural-voice/supertonic-store.js';
import {SUPERTONIC_BASE,supertonicAssetUrl} from '../../src/js/readers/neural-voice/supertonic-catalog.js';

async function fixture() {
  const map=new Map(),cache={match:vi.fn(async key=>map.get(key)?.clone()),put:vi.fn(async(key,response)=>{const bytes=await response.arrayBuffer();map.set(key,new Response(bytes,{headers:response.headers}));}),delete:vi.fn(async key=>map.delete(key))};
  const content={'onnx/duration_predictor.onnx':'test-model','onnx/tts.json':'{"test":true}','onnx/unicode_indexer.json':'[0,1]','voice_styles/F1.json':'{"voice":1}','LICENSE':'license'};
  const assets=await Promise.all(Object.entries(content).map(async([path,text])=>{const bytes=new TextEncoder().encode(text),hash=await webcrypto.subtle.digest('SHA-256',bytes);return{path,bytes:bytes.byteLength,sha256:Buffer.from(hash).toString('hex')};}));
  const fetch=vi.fn(async url=>new Response(content[url.replace('https://fixture/','')]));
  const deps={caches:{open:async()=>cache},fetch,crypto:webcrypto,storage:{persist:vi.fn(async()=>true)},base:'https://fixture/',assets};
  return{store:new SupertonicStore(deps),deps,content,assets,map,cache,fetch};
}

describe('Supertonic shared pack storage',()=>{
  it('pins each source URL in the completion manifest while preserving local fixture paths',async()=>{
    const f=await fixture();await f.store.install();
    const assets=f.assets.map((asset,i)=>i?asset:{...asset,url:'https://huggingface.co/author/model/resolve/pinned-revision/quantized.onnx'});
    const changed=new SupertonicStore({...f.deps,assets});
    expect(await changed.installed()).toBe(false);
    expect(JSON.parse(changed.manifest)[0].url).toBe(assets[0].url);
    expect(supertonicAssetUrl(assets[0],SUPERTONIC_BASE)).toBe(assets[0].url);
    expect(supertonicAssetUrl(assets[0],'http://127.0.0.1:4195/fixture/')).toBe('http://127.0.0.1:4195/fixture/'+assets[0].path);
    await changed.install();expect(await changed.installed()).toBe(true);
  });
  it('commits only a complete verified pack and reads all configuration offline',async()=>{
    const f=await fixture(),progress=[];expect(await f.store.installed()).toBe(false);
    const done=await f.store.install({onProgress:p=>progress.push(p)});expect(await f.store.installed()).toBe(true);
    expect(done.bytes).toBe(f.assets.reduce((n,a)=>n+a.bytes,0));expect(progress.at(-1).fraction).toBe(1);
    f.fetch.mockRejectedValue(Error('offline'));
    expect((await f.store.readAssets()).duration_predictor.byteLength).toBe(10);
    expect(await f.store.readConfig()).toEqual({config:{test:true},indexer:[0,1],styles:{F1:{voice:1}}});
    expect(f.fetch).toHaveBeenCalledTimes(5);
  });
  it('does not expose a marker or verified header before the checksum completes',async()=>{
    const f=await fixture();let resolve,entered;const gate=new Promise(r=>resolve=r),ready=new Promise(r=>entered=r);
    f.deps.crypto={subtle:{digest:async(...args)=>{entered();await gate;return webcrypto.subtle.digest(...args);}}};const store=new SupertonicStore(f.deps);
    const job=store.install();await ready;const response=await f.cache.match('https://fixture/'+f.assets[0].path);
    expect(response.headers.get('x-inhouse-sha256')).toBeNull();expect(await store.installed()).toBe(false);resolve();await job;
  });
  it('refetches an unverified file left by a crash and reuses complete verified ones',async()=>{
    const f=await fixture();await f.store.install();await f.cache.delete(f.store.marker);
    const first=f.assets[0];await f.cache.put('https://fixture/'+first.path,new Response('test-model',{headers:{'content-length':'10'}}));
    f.fetch.mockClear();await new SupertonicStore(f.deps).install();expect(f.fetch).toHaveBeenCalledTimes(1);expect(f.fetch.mock.calls[0][0]).toContain(first.path);expect(await f.store.installed()).toBe(true);
  });
  it('rejects corrupt bytes of the correct length and cannot report installed',async()=>{
    const f=await fixture();f.fetch.mockResolvedValueOnce(new Response('wrong-data'));
    await expect(f.store.install()).rejects.toMatchObject({code:'http'});expect(await f.store.installed()).toBe(false);expect(f.map.has('https://fixture/'+f.assets[0].path)).toBe(false);
  });
  it('a missing asset or changed manifest invalidates the installed marker',async()=>{
    const f=await fixture();await f.store.install();const changed=new SupertonicStore({...f.deps,assets:[...f.assets,{path:'new',bytes:1,sha256:'x'}]});
    expect(await changed.installed()).toBe(false);await f.cache.delete('https://fixture/LICENSE');expect(await f.store.installed()).toBe(false);await expect(f.store.readAssets()).rejects.toMatchObject({code:'missing'});
  });
  it('aborts before fetch and removes all shared files without affecting another cache key',async()=>{
    const f=await fixture(),controller=new AbortController();controller.abort();await expect(f.store.install({signal:controller.signal})).rejects.toMatchObject({code:'aborted'});expect(f.fetch).not.toHaveBeenCalled();
    await f.store.install();await f.cache.put('unrelated',new Response('keep'));await f.store.remove();expect(await f.store.installed()).toBe(false);expect(f.map.size).toBe(1);expect(f.map.has('unrelated')).toBe(true);
  });
  it('deduplicates concurrent installs and preserves partial files after a later network error',async()=>{
    const f=await fixture();f.fetch.mockImplementationOnce(async()=>new Response('test-model')).mockRejectedValueOnce(Error('network'));
    const first=f.store.install();expect(f.store.install()).toBe(first);await expect(first).rejects.toMatchObject({code:'offline'});
    expect(await f.store.installed()).toBe(false);expect((await f.cache.match('https://fixture/'+f.assets[0].path)).headers.get('x-inhouse-sha256')).toBe(f.assets[0].sha256);
    f.fetch.mockClear();await f.store.install();expect(f.fetch).toHaveBeenCalledTimes(4);expect(await f.store.installed()).toBe(true);
  });
});
