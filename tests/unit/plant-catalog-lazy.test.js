import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest'

// The catalogue has no JavaScript twin: its chunk counts as loaded only when the Rust UI module is too.
const state=vi.hoisted(()=>({wait:null,create:null,recover:null}))
vi.mock('../../src/js/rust-ui.js',()=>({waitForRustUI:()=>state.wait()}))
vi.mock('../../src/js/chunk-recovery.js',()=>({reloadOnceAfterChunkFailure:(...args)=>state.recover(...args)}))
vi.mock('../../src/js/plant-catalog.js',()=>({createPlantCatalog:(...args)=>state.create(...args)}))
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no});return{promise,resolve,reject}}
const tick=async()=>{for(let i=0;i<10;i++)await Promise.resolve()}
let lazy
beforeEach(async()=>{
 vi.resetModules();state.recover=vi.fn();state.create=vi.fn(()=>({open:vi.fn(),close:vi.fn(),destroy:vi.fn(),setShelfType:vi.fn(),prepare:vi.fn()}))
 lazy=await import('../../src/js/plant-catalog-lazy.js')
})
afterEach(()=>vi.restoreAllMocks())

describe('lazy IKEA catalogue',()=>{
 it('does not count the chunk as loaded, nor create a catalogue, until the Rust UI module is ready',async()=>{
  const ui=deferred();state.wait=()=>ui.promise;let done=false
  const loading=lazy.loadPlantCatalogModule().then(()=>{done=true});await tick();expect(done).toBe(false);expect(state.create).not.toHaveBeenCalled()
  ui.resolve({});await loading;expect(done).toBe(true)
  const catalog=lazy.createLazyPlantCatalog({shelfType:'walnut'});expect(state.create).toHaveBeenCalledOnce();catalog.destroy()
 })
 it('shares one load between callers and keeps the module once loaded',async()=>{
  const wait=vi.fn(()=>Promise.resolve({}));state.wait=wait
  const [a,b]=await Promise.all([lazy.loadPlantCatalogModule(),lazy.loadPlantCatalogModule()]);expect(a).toBe(b);await lazy.loadPlantCatalogModule();expect(wait).toHaveBeenCalledOnce()
 })
 it('lets a later tap retry after the Rust UI module failed, without reloading the page',async()=>{
  state.wait=vi.fn().mockRejectedValueOnce(new Error('Rust UI unavailable')).mockResolvedValue({})
  await expect(lazy.loadPlantCatalogModule()).rejects.toThrow('Rust UI unavailable');expect(state.recover).not.toHaveBeenCalled()
  await expect(lazy.loadPlantCatalogModule()).resolves.toBeTruthy()
 })
 it('warns and stays closed when the module never becomes usable, then opens on a later tap',async()=>{
  const warn=vi.spyOn(console,'warn').mockImplementation(()=>{});state.wait=vi.fn().mockRejectedValueOnce(new Error('Rust UI unavailable')).mockResolvedValue({})
  const catalog=lazy.createLazyPlantCatalog({shelfType:'walnut'});await catalog.open();expect(warn).toHaveBeenCalledWith('No se pudo abrir el catálogo:',expect.any(Error));expect(state.create).not.toHaveBeenCalled()
  await catalog.open();expect(state.create).toHaveBeenCalledOnce();catalog.destroy()
 })
 it('keeps the shelf alive when the first catalogue cannot be created from a loaded chunk',async()=>{
  const warn=vi.spyOn(console,'warn').mockImplementation(()=>{});state.wait=()=>Promise.resolve({});await lazy.loadPlantCatalogModule()
  state.create=vi.fn(()=>{throw new Error('El catálogo necesita el módulo Rust de interfaz')})
  const catalog=lazy.createLazyPlantCatalog({shelfType:'walnut'});expect(warn).toHaveBeenCalledWith('No se pudo preparar el catálogo:',expect.any(Error))
  await catalog.open();expect(warn).toHaveBeenCalledWith('No se pudo abrir el catálogo:',expect.any(Error));catalog.destroy()
 })
})
