import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest'

// waitForRustUI is for surfaces with no JavaScript twin: it waits for the one real
// initialisation (past the reader's 2 s deadline) and never starts a second instance.
const glue=vi.hoisted(()=>({init:null,abi:1,starts:0}))
vi.mock('../../src/wasm/ui/inhouse_read_ui.js',()=>({default:()=>{glue.starts++;return glue.init()},ui_abi_version:()=>glue.abi}))
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no});return{promise,resolve,reject}}
let rustUi
beforeEach(async()=>{vi.useFakeTimers();vi.resetModules();glue.starts=0;glue.abi=1;rustUi=await import('../../src/js/rust-ui.js')})
afterEach(()=>vi.useRealTimers())

describe('waitForRustUI',()=>{
 it('resolves at once when the module is already loaded',async()=>{
  glue.init=()=>Promise.resolve();const loaded=await rustUi.loadRustUI();expect(await rustUi.waitForRustUI()===loaded).toBe(true);expect(glue.starts).toBe(1)
 })
 it('keeps waiting for a download that outlasts the reader deadline and returns its result',async()=>{
  const download=deferred();glue.init=()=>download.promise
  const waiting=rustUi.waitForRustUI();let settled=false;waiting.then(()=>{settled=true},()=>{settled=true})
  await vi.advanceTimersByTimeAsync(2500);expect(settled).toBe(false);expect(rustUi.getRustUI()).toBeNull()
  download.resolve();const ui=await waiting;expect(ui===rustUi.getRustUI()).toBe(true);expect(glue.starts).toBe(1)
 })
 it('shares the pending download with the reader instead of starting another',async()=>{
  const download=deferred();glue.init=()=>download.promise
  const reader=rustUi.loadRustUI(),catalogue=rustUi.waitForRustUI();await vi.advanceTimersByTimeAsync(2500);await expect(reader).resolves.toBeNull()
  download.resolve();expect(await catalogue===rustUi.getRustUI()).toBe(true);expect(glue.starts).toBe(1)
 })
 it('rejects when the module fails and again, immediately, inside the retry window',async()=>{
  glue.init=()=>Promise.reject(new Error('offline'))
  await expect(rustUi.waitForRustUI()).rejects.toThrow('Rust UI unavailable');expect(glue.starts).toBe(1)
  await expect(rustUi.waitForRustUI()).rejects.toThrow('Rust UI unavailable');expect(glue.starts).toBe(1)
  await vi.advanceTimersByTimeAsync(30_001);glue.init=()=>Promise.resolve();expect(await rustUi.waitForRustUI()===rustUi.getRustUI()).toBe(true);expect(glue.starts).toBe(2)
 })
 it('rejects an incompatible module',async()=>{
  glue.init=()=>Promise.resolve();glue.abi=2
  await expect(rustUi.waitForRustUI()).rejects.toThrow('Rust UI unavailable');expect(rustUi.getRustUI()).toBeNull()
 })
})
