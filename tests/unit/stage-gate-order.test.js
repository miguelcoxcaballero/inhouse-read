import {beforeAll,afterEach,it,expect} from 'vitest'
import {readFileSync} from 'node:fs'
import * as ui from '../../src/wasm/ui/inhouse_read_ui.js'
import {createStageGate as original} from '../../src/js/prepared-page-legacy.js'
const gates=[];beforeAll(()=>ui.initSync({module:readFileSync('src/wasm/ui/inhouse_read_ui_bg.wasm')}));afterEach(()=>{for(const gate of gates.splice(0))gate.free()});
const native=(settled,options)=>{const gate=new ui.RustStageGate(settled,options.idle);gates.push(gate);return gate};
async function trace(factory,{settled=true,idleValue=undefined,releaseTurn=-1,reason='open'}={}){
 const events=[];const gate=factory(settled,{idle:()=>{events.push('idle');return idleValue}});const result=gate.wait();result.then(value=>events.push('done:'+value),error=>events.push('error:'+error));
 for(let turn=0;turn<15;turn++){if(turn===releaseTurn){gate.release(reason);events.push('release')}await Promise.resolve();events.push('turn:'+turn)}return events;
}
it.each([true,false,0,'',1,'yes',null,undefined])('preserves all microtask turns for settled=%s',async settled=>{expect(await trace(native,{settled})).toEqual(await trace(original,{settled}))});
it.each([0,1,2,3,4,5,6])('preserves the open race at microtask %s',async releaseTurn=>{expect(await trace(native,{releaseTurn})).toEqual(await trace(original,{releaseTurn}))});
it.each(['open','cancelled',undefined,null,0,{},new String('open')])('uses strict release identity for %s',async reason=>{const never=new Promise(()=>{}),a=native(never,{idle:()=>never}),b=original(never,{idle:()=>never});a.release(reason);b.release(reason);expect(await a.wait()).toBe(await b.wait())});
it('preserves thrown and rejected idle errors by identity',async()=>{
 for(const factory of [native,original])for(const async of [false,true]){const error=new Error('Idle failed'),gate=factory(true,{idle:()=>async?Promise.reject(error):(()=>{throw error})()});await expect(gate.wait()).rejects.toBe(error)}
});
it('allows later settlement to invoke idle after explicit cancellation just as before',async()=>{
 const events=[];for(const factory of [native,original]){let resolve;const settled=new Promise(yes=>{resolve=yes});const idle=[];const gate=factory(settled,{idle:()=>{idle.push('idle')}});gate.release('cancelled');await expect(gate.wait()).resolves.toBe(false);resolve(true);for(let i=0;i<15;i++)await Promise.resolve();events.push(idle)}expect(events[0]).toEqual(events[1]);expect(events[0]).toEqual(['idle'])
});
