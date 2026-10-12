import {beforeEach,afterEach,it,expect,vi} from 'vitest'
const mock=vi.hoisted(()=>({init:vi.fn(),abi:vi.fn(),Menu:class{}}))
vi.mock('../../src/wasm/ui/inhouse_read_ui.js',()=>({default:mock.init,ui_abi_version:mock.abi,RustSelectMenu:mock.Menu}))
beforeEach(()=>{vi.resetModules();vi.useFakeTimers();mock.init.mockReset().mockResolvedValue({});mock.abi.mockReset().mockReturnValue(1)})
afterEach(()=>vi.useRealTimers())
it('shares one module initialization across concurrent readers',async()=>{
 const {loadRustUI,getRustUI}=await import('../../src/js/rust-ui.js');expect(getRustUI()).toBe(null)
 const a=loadRustUI(),b=loadRustUI();expect(a).toBe(b)
 const ui=await a;expect(ui.RustSelectMenu).toBe(mock.Menu);expect(getRustUI()).toBe(ui);expect(await loadRustUI()).toBe(ui);expect(mock.init).toHaveBeenCalledTimes(1)
})
it('retains controls after a download error and retries only after cooldown',async()=>{
 mock.init.mockRejectedValueOnce(new Error('offline'))
 const {loadRustUI,getRustUI}=await import('../../src/js/rust-ui.js')
 expect(await loadRustUI()).toBe(null);expect(getRustUI()).toBe(null);expect(await loadRustUI()).toBe(null);expect(mock.init).toHaveBeenCalledTimes(1)
 vi.advanceTimersByTime(30001);expect((await loadRustUI()).RustSelectMenu).toBe(mock.Menu);expect(mock.init).toHaveBeenCalledTimes(2)
})
it('rejects an incompatible module before exposing any component',async()=>{
 mock.abi.mockReturnValue(2);const {loadRustUI,getRustUI}=await import('../../src/js/rust-ui.js')
 expect(await loadRustUI()).toBe(null);expect(getRustUI()).toBe(null)
})
it('does not block opening a book indefinitely when a module request stalls',async()=>{
 let finish;mock.init.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve}))
 const {loadRustUI,getRustUI}=await import('../../src/js/rust-ui.js'),loading=loadRustUI()
 await vi.advanceTimersByTimeAsync(2000);expect(await loading).toBe(null);expect(getRustUI()).toBe(null)
 finish({});await Promise.resolve();expect(getRustUI()).toBe(null)
 vi.advanceTimersByTime(30001);expect((await loadRustUI()).RustSelectMenu).toBe(mock.Menu)
})
