import {it,expect,vi} from 'vitest'
import {readFileSync} from 'node:fs'
import {createRustLoader} from '../../src/js/rust-loader.js'
import {getStudioScanCore,registerStudioScanCore} from '../../src/js/studio-scan-state.js'
const bytes=readFileSync('src/wasm/inhouse_read_core.wasm')
it('notifies the optional owner with the same validated instance without replacing the in-flight promise',async()=>{
 let loader;const observer=vi.fn(core=>{expect(loader.get()).toBe(core);registerStudioScanCore(core)})
 loader=createRustLoader('unused','__studioReadinessTest',0,observer)
 const first=loader.load({bytes}),second=loader.load({bytes});expect(second).toBe(first)
 const core=await first;expect(core.studio_half_scan).toBeTypeOf('function');expect(getStudioScanCore()).toBe(core);expect(observer).toHaveBeenCalledExactlyOnceWith(core)
 expect(await loader.load({bytes})).toBe(core);expect(observer).toHaveBeenCalledOnce();registerStudioScanCore(null)
})
it('does not notify another owner for an invalid or incompatible module',async()=>{
 for(const [input,domain] of [[Uint8Array.of(0),0],[bytes,1]]){const observer=vi.fn(),loader=createRustLoader('unused','__studioInvalidTest',domain,observer);expect(await loader.load({bytes:input})).toBeNull();expect(loader.get()).toBeNull();expect(observer).not.toHaveBeenCalled()}
})
it('an optional observer failure does not discard an otherwise valid kernel',async()=>{
 const loader=createRustLoader('unused','__studioFailedObserverTest',0,()=>{throw Error('detached owner')})
 const core=await loader.load({bytes});expect(core).toBe(loader.get());expect(core.core_domain()).toBe(0)
})
