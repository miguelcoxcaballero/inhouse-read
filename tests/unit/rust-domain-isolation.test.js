// @vitest-environment node
import {readFileSync,mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {dirname,extname,join,resolve,relative,sep} from 'node:path';
import {tmpdir} from 'node:os';
import {expect,it,vi} from 'vitest';
import {createRustLoader} from '../../src/js/rust-loader.js';
import {shelfBakeHash,SHELF_BAKE_GENERATORS,SHELF_BAKE_RUST_SOURCES} from '../../scripts/shelf-bake-version.mjs';
const bytes=name=>readFileSync(`src/wasm/inhouse_read_${name}.wasm`);
it('separates production exports, memories and retry state without loading the app into decoration',async()=>{
 const app=createRustLoader('app','__testApp',0),decor=createRustLoader('decor','__testDecor',1);
 const a=await app.load({bytes:bytes('core')}),d=await decor.load({bytes:bytes('decor')});
 expect(a.core_domain()).toBe(0);expect(d.core_domain()).toBe(1);expect(a.memory).not.toBe(d.memory);
 expect(a.plant_surface_lattice).toBeUndefined();expect(d.pdf_text_stream).toBeUndefined();
 expect(typeof a.book_cloth_plan).toBe('function');expect(typeof d.plant_surface_lattice).toBe('function');expect(typeof d.lamp_surface_rows).toBe('function');
 const pa=a.alloc_f64(20),pd=d.alloc_f64(20);try{new Float64Array(a.memory.buffer,pa,20).fill(17);new Float64Array(d.memory.buffer,pd,20).fill(23);a.memory.grow(1);expect([...new Float64Array(d.memory.buffer,pd,20)]).toEqual(Array(20).fill(23));expect([...new Float64Array(a.memory.buffer,pa,20)]).toEqual(Array(20).fill(17));}finally{a.free_f64(pa,20);d.free_f64(pd,20);}
 const broken=createRustLoader('bad','__testBad',1);expect(await broken.load({bytes:bytes('core')})).toBeNull();expect(await decor.load()).toBe(d);
});
it('rejects a different domain through both bytes and the early promise',async()=>{
 for(const [name,domain] of [['core',1],['decor',0]]){
  expect(await createRustLoader('none','__testForeign',domain).load({bytes:bytes(name)})).toBeNull();
  globalThis.__testForeign=WebAssembly.instantiate(bytes(name));const fetcher=vi.spyOn(globalThis,'fetch');
  try{expect(await createRustLoader('none','__testForeign',domain).load()).toBeNull();expect(fetcher).not.toHaveBeenCalled();expect(globalThis.__testForeign).toBeUndefined();}finally{delete globalThis.__testForeign;fetcher.mockRestore();}
 }
});
it('actual generator graph hashes only decoration bytes, keeping app-only releases out of the bake version',()=>{
 const repo=process.cwd(),root=mkdtempSync(join(tmpdir(),'inhouse-decor-isolation-')),seen=new Set();
 const put=(file,data)=>{const target=join(root,file);mkdirSync(dirname(target),{recursive:true});writeFileSync(target,data);};
 const copy=file=>{if(seen.has(file))return;seen.add(file);const data=readFileSync(file);put(relative(repo,file),data);if(!['.js','.mjs','.cjs'].includes(extname(file)))return;for(const [,ref] of data.toString('utf8').matchAll(/\b(?:from|import)\s*\(?\s*['"](\.{1,2}\/[^'"]+)['"]/g))copy(resolve(dirname(file),ref.split(/[?#]/,1)[0]));};
 try{
  for(const source of [...SHELF_BAKE_GENERATORS,...SHELF_BAKE_RUST_SOURCES])copy(resolve(repo,source));put('node_modules/three/package.json',readFileSync('node_modules/three/package.json'));
  expect(seen.has(resolve(repo,'src/wasm/inhouse_read_decor.wasm'))).toBe(true);expect(seen.has(resolve(repo,'src/wasm/inhouse_read_core.wasm'))).toBe(false);
  const original=shelfBakeHash(root);expect(original).toBe(shelfBakeHash(repo));put('src/wasm/inhouse_read_core.wasm',bytes('core'));expect(shelfBakeHash(root)).toBe(original);
  put('src/wasm/inhouse_read_core.wasm',Buffer.from('a future compiled app'));put('src/js/rust-core.js','a future app loader');expect(shelfBakeHash(root)).toBe(original);
  const decor=bytes('decor');decor[decor.length-1]^=1;put('src/wasm/inhouse_read_decor.wasm',decor);expect(shelfBakeHash(root)).not.toBe(original);
 }finally{const absolute=resolve(root),prefix=resolve(tmpdir())+sep; if(!absolute.startsWith(prefix)||!absolute.includes('inhouse-decor-isolation-'))throw Error('Unsafe temporary path');rmSync(absolute,{recursive:true,force:true});}
});
