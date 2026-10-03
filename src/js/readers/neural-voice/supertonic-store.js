import { SUPERTONIC_ASSETS, SUPERTONIC_LEGACY_ASSETS, supertonicBase, supertonicAssetUrl, SUPERTONIC_REVISION } from './supertonic-catalog.js';

export const SUPERTONIC_CACHE = 'inhouse-supertonic3-v1';
const failure = (code, message, cause) => Object.assign(new Error(message, {cause}), {code});
const aborted = () => failure('aborted', 'Descarga cancelada');
const hashHex = buffer => Array.from(new Uint8Array(buffer), n => n.toString(16).padStart(2,'0')).join('');
const manifestOf = (assets,base) => JSON.stringify(assets.map(({path,url,bytes,sha256})=>({path,url:url||base+path,bytes,sha256})));

/** One immutable pack for all languages/styles. Streams each file into Cache
 * Storage, verifies it, and writes the completion marker last. Interrupted
 * downloads can reuse complete verified files, but never appear installed. */
export class SupertonicStore {
  constructor({caches=globalThis.caches,fetch=globalThis.fetch?.bind(globalThis),storage=globalThis.navigator?.storage,
    crypto=globalThis.crypto,base=supertonicBase(),assets=SUPERTONIC_ASSETS,
    legacyAssets=assets===SUPERTONIC_ASSETS?SUPERTONIC_LEGACY_ASSETS:[],stallMs=20000}={}) {
    Object.assign(this,{caches,fetchFn:fetch,storage,crypto,base,assets,legacyAssets,stallMs});
    this.marker=base+'.inhouse-complete.json';this.manifest=manifestOf(assets,base);this.job=null;this.generation=0;this.controller=null;
  }
  async cache() { if(!this.caches)throw failure('storage','El dispositivo no permite guardar voces');return this.caches.open(SUPERTONIC_CACHE); }
  async committedAssets() {
    const cache=await this.cache(),marker=await cache.match(this.marker);
    if(!marker)return null;
    let assets;
    try {
      const record=await marker.json();if(record.revision!==SUPERTONIC_REVISION)return null;
      assets=record.manifest===this.manifest?this.assets:
        this.legacyAssets.length&&record.manifest===manifestOf(this.legacyAssets,this.base)?this.legacyAssets:null;
      if(!assets)return null;
    } catch{return null;}
    for(const asset of assets) {
      const r=await cache.match(this.base+asset.path);
      if(!r||r.headers.get('x-inhouse-sha256')!==asset.sha256||Number(r.headers.get('content-length'))!==asset.bytes)return null;
    }
    return assets;
  }
  async installed() { return await this.committedAssets()===this.assets; }
  async availableStyles() {
    return new Set((await this.committedAssets()||[]).filter(a=>a.path.startsWith('voice_styles/')).map(a=>a.path.split('/').at(-1).replace('.json','')));
  }
  install({signal,onProgress=()=>{}}={}) {
    if(this.job)return this.job;
    const controller=new AbortController(),generation=this.generation;
    this.controller=controller;
    const abort=()=>controller.abort();signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
    const check=()=>{if(controller.signal.aborted||generation!==this.generation)throw aborted();};
    const run=async()=>{
      check();const cache=await this.cache();
      // A failed optional expansion must leave the previous offline pack usable.
      // New/invalid installs still have no completion marker until all hashes pass.
      if(!await this.committedAssets())await cache.delete(this.marker);
      const total=this.assets.reduce((sum,a)=>sum+a.bytes,0);let received=0;
      for(const asset of this.assets) {
        check();const url=this.base+asset.path,old=await cache.match(url);
        if(old?.headers.get('x-inhouse-sha256')===asset.sha256&&Number(old.headers.get('content-length'))===asset.bytes){received+=asset.bytes;onProgress({received,total,fraction:received/total,path:asset.path});continue;}
        let timer,loaded=0;
        const touch=()=>{clearTimeout(timer);timer=setTimeout(()=>controller.abort('stall'),this.stallMs);};
        try {
          touch();const response=await this.fetchFn(supertonicAssetUrl(asset,this.base),{signal:controller.signal});check();
          if(!response.ok)throw failure('http',`HTTP ${response.status}: ${asset.path}`);
          const headers=new Headers({'content-type':asset.path.endsWith('.json')?'application/json':'application/octet-stream','content-length':String(asset.bytes)});
          const stream=response.body?.pipeThrough(new TransformStream({transform:(chunk,out)=>{check();touch();loaded+=chunk.byteLength;if(loaded>asset.bytes)throw failure('http','Tamaño de voz incorrecto');onProgress({received:received+loaded,total,fraction:(received+loaded)/total,path:asset.path});out.enqueue(chunk);}}));
          if(!stream)throw failure('http','Respuesta de voz vacía');
          await cache.put(url,new Response(stream,{headers}));clearTimeout(timer);check();
          const bytes=await (await cache.match(url)).arrayBuffer();
          if(bytes.byteLength!==asset.bytes||hashHex(await this.crypto.subtle.digest('SHA-256',bytes))!==asset.sha256)throw failure('http','La descarga no coincide con el modelo publicado');
          // Mark reusable only AFTER checksum validation. A tab closing during
          // hashing must not turn an unverified partial install into a valid file.
          check();const verified=await cache.match(url);headers.set('x-inhouse-sha256',asset.sha256);
          await cache.put(url,new Response(verified.body,{headers}));check();received+=asset.bytes;
        } catch(error) {
          await cache.delete(url).catch(()=>{});
          if(signal?.aborted||generation!==this.generation)throw aborted();
          if(controller.signal.reason==='stall')throw failure('offline','La descarga se interrumpió. Puedes reanudarla.',error);
          throw error?.code?error:failure(error?.name==='QuotaExceededError'?'storage':'offline',error?.name==='QuotaExceededError'?'No hay espacio para guardar las voces':'No se pudo descargar la voz',error);
        } finally {clearTimeout(timer);}
      }
      check();await this.storage?.persist?.().catch(()=>{});check();
      await cache.put(this.marker,new Response(JSON.stringify({revision:SUPERTONIC_REVISION,manifest:this.manifest,bytes:total}),{headers:{'content-type':'application/json'}}));check();
      onProgress({received:total,total,fraction:1});return{bytes:total};
    };
    const promise=run().finally(()=>{signal?.removeEventListener('abort',abort);if(this.job===promise){this.job=null;this.controller=null;}});this.job=promise;return promise;
  }
  async readAssets() {
    const assets=await this.committedAssets();
    if(!assets)throw failure('missing','Descarga primero el paquete de voces');
    const cache=await this.cache(),buffers={};
    for(const asset of assets.filter(a=>a.path.endsWith('.onnx'))) {
      const response=await cache.match(this.base+asset.path);if(!response)throw failure('missing','Falta un archivo de la voz');
      const bytes=await response.arrayBuffer();if(bytes.byteLength!==asset.bytes)throw failure('storage','El modelo guardado está incompleto');buffers[asset.path.split('/').at(-1).replace('.onnx','')]=bytes;
    }
    return buffers;
  }
  async readConfig() {
    const assets=await this.committedAssets();
    if(!assets)throw failure('missing','Descarga primero el paquete de voces');
    const cache=await this.cache();const json=async path=>{const r=await cache.match(this.base+path);if(!r)throw failure('missing','Falta la configuración de la voz');return r.json();};
    const config=await json('onnx/tts.json'),indexer=await json('onnx/unicode_indexer.json'),styles={};
    for(const asset of assets.filter(a=>a.path.startsWith('voice_styles/')))styles[asset.path.split('/').at(-1).replace('.json','')]=await json(asset.path);
    return {config,indexer,styles};
  }
  async remove() {
    ++this.generation;this.controller?.abort();await this.job?.catch(()=>{});const cache=await this.cache();
    await cache.delete(this.marker);for(const asset of this.assets)await cache.delete(this.base+asset.path);
  }
}
