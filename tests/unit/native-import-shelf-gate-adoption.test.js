import {beforeAll,beforeEach,afterEach,it,expect,vi} from 'vitest'
import {readFileSync} from 'node:fs'
import * as ui from '../../src/wasm/ui/inhouse_read_ui.js'
import {createNativeImportShelfGate} from '../../src/js/native-import-shelf-gate.js'
import {createLegacyNativeImportShelfGate} from '../../src/js/native-import-shelf-gate-legacy.js'
const runtime=vi.hoisted(()=>({ui:null,native:0}))
vi.mock('../../src/js/rust-ui.js',()=>({getRustUI:()=>runtime.ui}))
const native={...ui,RustImportShelfGate:class extends ui.RustImportShelfGate{constructor(...args){super(...args);runtime.native++}}}
const gates=[]
const create=options=>{const gate=createNativeImportShelfGate(options);gates.push(gate);return gate}
beforeAll(()=>ui.initSync({module:readFileSync('src/wasm/ui/inhouse_read_ui_bg.wasm')}))
beforeEach(()=>{runtime.ui=null;runtime.native=0})
afterEach(()=>{for(const gate of gates.splice(0))gate.destroy();expect(ui.ui_live_handles()).toBe(0)})
it('transfers an active inbox without invoking callbacks during adoption',()=>{
 const reader=vi.fn(()=>false),refresh=vi.fn(),gate=create({isReaderVisible:reader,refresh})
 gate.setActive(true);runtime.ui=native;expect(gate.deferRefresh()).toBe(true)
 expect(runtime.native).toBe(1);expect(reader).not.toHaveBeenCalled();expect(refresh).not.toHaveBeenCalled()
 gate.setActive(false);expect(reader).toHaveBeenCalledOnce();expect(refresh).toHaveBeenCalledOnce()
})
it('transfers pending reader work and releases it only on returning home',()=>{
 let reader=true;const refresh=vi.fn(),gate=create({isReaderVisible:()=>reader,refresh})
 gate.setActive(true);gate.setActive(false);runtime.ui=native
 expect(gate.deferRefresh()).toBe(true);expect(refresh).not.toHaveBeenCalled()
 reader=false;expect(gate.deferRefresh()).toBe(false);gate.setActive(false);expect(refresh).not.toHaveBeenCalled()
})
it.each([undefined,null,false,0,NaN,'',true,1,'yes',{},[]])('keeps truthiness and callback order for %s',value=>{
 const traces=[]
 for(const rust of [false,true]){runtime.ui=rust?native:null;const trace=[],gate=create({isReaderVisible:()=>{trace.push('reader');return false},refresh:()=>trace.push('refresh')})
 gate.setActive(true);gate.setActive(value);trace.push(gate.deferRefresh());gate.setActive(false);trace.push(gate.deferRefresh());traces.push(trace);gate.destroy()}
 expect(traces[1]).toEqual(traces[0])
})
it.each(['reader','refresh'])('preserves a thrown %s value and state mutation order',source=>{
 const results=[],failure={source}
 for(const rust of [false,true]){runtime.ui=rust?native:null;let fail=true;const trace=[],gate=create({isReaderVisible:()=>{trace.push('reader');if(fail&&source==='reader')throw failure;return false},refresh:()=>{trace.push('refresh');if(fail&&source==='refresh')throw failure}})
 gate.setActive(true);try{gate.setActive(false);throw Error('Missing rejection')}catch(error){expect(error).toBe(failure)}
 fail=false;gate.setActive(false);trace.push(gate.deferRefresh());results.push(trace);gate.destroy()}
 expect(results[1]).toEqual(results[0])
})
it('supports synchronous calls back into the gate',()=>{
 const traces=[]
 for(const rust of [false,true]){runtime.ui=rust?native:null;const trace=[];let gate,once=true
 gate=create({isReaderVisible:()=>{trace.push('reader');if(once){once=false;gate.setActive(true)}return false},refresh:()=>{trace.push('refresh');gate.setActive(true)}})
 gate.setActive(true);gate.setActive(false);trace.push(gate.deferRefresh());traces.push(trace);gate.destroy()}
 expect(traces[1]).toEqual(traces[0])
})
it('keeps the current transfer when a partial or failed module arrives',()=>{
 for(const candidate of [{RustImportShelfGate:class{setActive(){}}},{RustImportShelfGate:class{constructor(){throw Error('Unavailable')}setActive(){}deferRefresh(){}}}]){
  runtime.ui=null;const refresh=vi.fn(),gate=create({isReaderVisible:()=>false,refresh});gate.setActive(true);runtime.ui=candidate
  expect(gate.deferRefresh()).toBe(true);gate.setActive(false);expect(refresh).toHaveBeenCalledOnce();gate.destroy()
 }
 expect(runtime.native).toBe(0)
})
it('releases callback references over repeated imports and never adopts after destruction',()=>{
 runtime.ui=native
 for(let i=0;i<200;i++){const refresh=vi.fn(),gate=create({isReaderVisible:()=>false,refresh});gate.setActive(true);expect(gate.deferRefresh()).toBe(true);gate.setActive(false);expect(refresh).toHaveBeenCalledOnce();gate.destroy();gate.destroy();expect(ui.ui_live_handles()).toBe(0);expect(gate.deferRefresh()).toBe(false)}
 expect(runtime.native).toBe(200)
})
it('transfers the exact legacy flags without calling the reader',()=>{
 const reader=vi.fn(()=>true),gate=createLegacyNativeImportShelfGate({isReaderVisible:reader,refresh:vi.fn()})
 gate.setActive(true);gate.setActive(false);reader.mockClear();expect(gate.transferState()).toEqual([false,true]);expect(reader).not.toHaveBeenCalled();gate.releaseOwnedState();expect(gate.transferState()).toEqual([false,false])
})
