import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest'

// The reader has no JavaScript twin of its Rust components: the lazy stand-in
// builds the experience only once the core is in, and reports a missing core
// through the same failure path as a missing reader chunk.
const state=vi.hoisted(()=>({core:null,built:0,gate:null}))
vi.mock('../../src/js/rust-ui.js',()=>({requireRustUI:()=>state.gate?state.gate.then(()=>state.core):Promise.resolve(state.core),loadRustUI:()=>Promise.resolve(state.core),getRustUI:()=>state.core}))
vi.mock('../../src/js/readers/reader-experience.js',()=>({ReaderExperience:class{constructor(){state.built++;this.panel={open:false,close(){}};this.open=vi.fn(async record=>record.id)}}}))
import {createLazyReaderExperience} from '../../src/js/readers/reader-experience-lazy.js'

let reload
beforeEach(()=>{
 sessionStorage.clear();state.core={};state.built=0;state.gate=null;reload=vi.fn()
 vi.stubGlobal('location',{...window.location,reload})
})
afterEach(()=>vi.unstubAllGlobals())
describe('lazy reader and the Rust core',()=>{
 it('does not build any component until the core has arrived, then builds once',async()=>{
  let release;state.gate=new Promise(resolve=>{release=resolve})
  const lazy=createLazyReaderExperience({},{}),pending=lazy.ready()
  await new Promise(resolve=>setTimeout(resolve,10));expect(state.built).toBe(0);expect(lazy.loaded).toBe(false)
  release();await pending;expect(state.built).toBe(1);expect(lazy.loaded).toBe(true)
  await lazy.ready();await lazy.prefetch();expect(state.built).toBe(1)
 })
 it('opens a book through the experience built after the core',async()=>{
  const lazy=createLazyReaderExperience({},{});expect(await lazy.open({id:'book'})).toBe('book');expect(state.built).toBe(1)
 })
 it('reports a missing core like a failed chunk: the app sees the error and the page reloads once',async()=>{
  state.core=null;const lazy=createLazyReaderExperience({},{})
  await expect(lazy.ready()).rejects.toThrow('Rust UI is unavailable')
  expect(state.built).toBe(0);expect(lazy.loaded).toBe(false);expect(reload).toHaveBeenCalledOnce()
  await expect(lazy.ready()).rejects.toThrow();expect(reload).toHaveBeenCalledOnce() // one reload per minute
 })
 it('can be retried once the core becomes available',async()=>{
  state.core=null;const lazy=createLazyReaderExperience({},{});await expect(lazy.ready()).rejects.toThrow()
  state.core={};await lazy.ready();expect(state.built).toBe(1)
 })
 it('the idle prefetch never reloads the page for a slow or missing core',async()=>{
  state.core=null;const lazy=createLazyReaderExperience({},{})
  expect(await lazy.prefetch()).toBeNull();expect(reload).not.toHaveBeenCalled();expect(state.built).toBe(0)
 })
})
