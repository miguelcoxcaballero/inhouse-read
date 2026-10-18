import {it,expect,vi,beforeEach,afterEach} from 'vitest'
import {webcrypto} from 'node:crypto'
import {setImmediate as nextTurn} from 'node:timers/promises'
import {rustUI} from './helpers/rust-ui-ready.js'
const io=vi.hoisted(()=>({context:vi.fn(),read:vi.fn(),write:vi.fn(),revision:vi.fn(),stateRead:vi.fn(),stateWrite:vi.fn()}))
vi.mock('../../src/js/cloud-native.js',()=>({cloudModule:async()=>rustUI}))
vi.mock('../../src/js/drive-client.js',()=>({getDriveLiveContext:io.context,readDriveLiveMailbox:io.read,writeDriveLiveMailbox:io.write,readDriveLibraryRevision:io.revision,readDriveLiveState:io.stateRead,writeDriveLiveState:io.stateWrite}))
import {LiveRoom} from '../../src/js/live-room.js'
const rooms=[],pcs=[]
const key=Buffer.alloc(32,7).toString('base64url')
const snapshot=(isOn=true)=>({schemaVersion:1,books:[],settings:{'inhouse-read-shelf-lamps':{at:Date.now(),device:'device',value:JSON.stringify([{key:'lamp:one',isOn}])}}})
class Channel{
 readyState='connecting';bufferedAmount=0;sent=[]
 constructor(label){this.label=label}
 send(data){this.sent.push(data)}
 open(){this.readyState='open';this.onopen?.()}
 close(){this.readyState='closed';this.onclose?.()}
}
class Peer{
 channels=[];iceGatheringState='complete';connectionState='connecting';localDescription=null
 constructor(){pcs.push(this)}
 createDataChannel(label){const c=new Channel(label);this.channels.push(c);return c}
 async createOffer(){return{type:'offer',sdp:'v=0\r\n'}}
 async setLocalDescription(value){this.localDescription=value}
 close(){this.connectionState='closed'}
}
async function flush(check=()=>true){for(let i=0;i<100;i++){await nextTurn();if(check())return}throw Error('Host operation did not settle')}
function make(options={}){const room=new LiveRoom({enabled:()=>true,receive:async()=>{},...options});rooms.push(room);return room}
beforeEach(()=>{
 vi.useFakeTimers({toFake:['setTimeout','clearTimeout','Date','performance']});vi.stubGlobal('crypto',webcrypto);vi.stubGlobal('BroadcastChannel',undefined);vi.stubGlobal('RTCPeerConnection',Peer)
 pcs.length=0
 for(const fn of Object.values(io))fn.mockReset()
 io.context.mockResolvedValue({folderId:'folder',key})
 io.write.mockResolvedValue({id:'own-mailbox'});io.read.mockResolvedValue({v:1,peer:'zzzzzzzz',signals:{}})
 io.stateWrite.mockResolvedValue({id:'state-file'})
 io.revision.mockImplementation(async()=>{dispatchEvent(new CustomEvent('inhouse-drive-live-peers',{detail:{folderId:'folder',peers:[{id:'remote',name:'live-v1-zzzzzzzz.json',modifiedTime:new Date().toISOString()}]}}));return '[]'})
})
afterEach(()=>{for(const room of rooms.splice(0))room.destroy();vi.useRealTimers();vi.unstubAllGlobals()})
it('restarts failed initialization without another edit or backup publication',async()=>{
 io.context.mockRejectedValueOnce(Error('temporary offline'))
 const room=make();await room.publish('account',snapshot());expect(io.write).not.toHaveBeenCalled()
 await vi.advanceTimersByTimeAsync(2000);await flush(()=>io.revision.mock.calls.length>0)
 expect(io.write).toHaveBeenCalled();expect(io.context.mock.calls.length).toBeGreaterThan(1)
})
it('suspends without network timers and resumes the retained room; logout clears it',async()=>{
 const room=make();await room.publish('account',snapshot());await flush(()=>pcs.length>0)
 room.suspend();const count=io.revision.mock.calls.length
 await vi.advanceTimersByTimeAsync(60000);expect(io.revision.mock.calls.length).toBe(count)
 await room.resume();expect(io.revision.mock.calls.length).toBeGreaterThan(count)
 room.pause();const writes=io.write.mock.calls.length;await room.resume();await vi.advanceTimersByTimeAsync(60000)
 expect(io.write.mock.calls.length).toBe(writes)
})
it('detects a missing interactive channel and reconnects instead of staying falsely connected',async()=>{
 const room=make();await room.publish('account',snapshot());await flush(()=>pcs[0]?.channels.length===2)
 pcs[0].channels[0].open()
 await vi.advanceTimersByTimeAsync(14000);await flush()
 expect(pcs[0].connectionState).toBe('closed')
 await vi.advanceTimersByTimeAsync(2500);await flush(()=>pcs.length>1)
 expect(pcs.length).toBeGreaterThan(1)
})
it('relays lamp state encrypted, keeps heartbeat mailboxes small and coalesces newer changes',async()=>{
 const room=make();await room.publish('account',snapshot());await flush(()=>pcs.length>0)
 await room.publish('account',snapshot(false));await vi.advanceTimersByTimeAsync(200);await flush(()=>io.stateWrite.mock.calls.length>0)
 const payload=io.stateWrite.mock.calls.at(-1)[1]
 expect(JSON.stringify(payload)).not.toContain('isOn')
 const imported=await webcrypto.subtle.importKey('raw',Buffer.alloc(32,7),'AES-GCM',false,['decrypt'])
 const plain=await webcrypto.subtle.decrypt({name:'AES-GCM',iv:Buffer.from(payload.iv,'base64'),additionalData:new TextEncoder().encode('account')},imported,Buffer.from(payload.data,'base64'))
 expect(JSON.parse(new TextDecoder().decode(plain)).snapshot.settings['inhouse-read-shelf-lamps'].value).toContain('"isOn":false')
 await flush(()=>io.write.mock.calls.some(([,p])=>p.state))
 const mailbox=io.write.mock.calls.at(-1)[1];expect(mailbox.state.id).toBe('state-file');expect(JSON.stringify(mailbox).length).toBeLessThan(65000)
})
it('retries a failed mailbox even if its Drive revision has not changed',async()=>{
 const modified=new Date().toISOString()
 io.revision.mockImplementation(async()=>{dispatchEvent(new CustomEvent('inhouse-drive-live-peers',{detail:{folderId:'folder',peers:[{id:'remote',name:'live-v1-zzzzzzzz.json',modifiedTime:modified}]}}));return '[]'})
 io.read.mockRejectedValueOnce(Error('temporary read failure'))
 const room=make();await room.publish('account',snapshot());await flush(()=>io.read.mock.calls.length===1)
 await vi.advanceTimersByTimeAsync(800);await flush(()=>io.read.mock.calls.length>1)
 expect(io.read.mock.calls.length).toBeGreaterThan(1)
})
it('keeps healthy idle channels alive and replaces silent ones without a close event',async()=>{
 const room=make();await room.publish('account',snapshot());await flush(()=>pcs[0]?.channels.length===2)
 const pc=pcs[0],interactive=pc.channels[1]
 let responding=true
 interactive.send=data=>{if(responding&&JSON.parse(data).t==='ping')interactive.onmessage({data:JSON.stringify({t:'pong'})})}
 for(const c of pc.channels)c.open()
 await vi.advanceTimersByTimeAsync(30000)
 expect(pc.connectionState).not.toBe('closed')
 responding=false;await vi.advanceTimersByTimeAsync(14000)
 expect(pc.connectionState).toBe('closed')
})
it('retries encrypted state after local application fails without losing the packet to deduplication',async()=>{
 const imported=await webcrypto.subtle.importKey('raw',Buffer.alloc(32,7),'AES-GCM',false,['encrypt'])
 const packet=JSON.stringify({v:1,account:'account',from:'zzzzzzzz',id:'snapshot-1',snapshot:snapshot(false)}),iv=Buffer.alloc(12,3)
 const cipher=await webcrypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:new TextEncoder().encode('account')},imported,new TextEncoder().encode(packet))
 io.stateRead.mockResolvedValue({v:1,peer:'zzzzzzzz',iv:iv.toString('base64'),data:Buffer.from(cipher).toString('base64')})
 io.read.mockResolvedValue({v:1,peer:'zzzzzzzz',signals:{},state:{id:'remote-state',revision:'first'}})
 const receive=vi.fn().mockRejectedValueOnce(Error('IDB temporarily busy')).mockResolvedValue(undefined)
 const room=make({receive});await room.publish('account',snapshot());await flush(()=>receive.mock.calls.length===1)
 await vi.advanceTimersByTimeAsync(1000);await flush(()=>receive.mock.calls.length===2)
 expect(receive.mock.calls.at(-1)[1].settings['inhouse-read-shelf-lamps'].value).toContain('false')
})
it('does not create duplicate mailboxes on temporary write errors',async()=>{
 const room=make();await room.publish('account',snapshot());await flush(()=>pcs.length>0)
 const start=io.write.mock.calls.length
 io.write.mockRejectedValueOnce(Object.assign(Error('temporary upstream failure'),{status:503}))
 await vi.advanceTimersByTimeAsync(20000);await flush()
 const later=io.write.mock.calls.slice(start)
 expect(later.length).toBeGreaterThan(0)
 expect(later.every(([, ,id])=>id==='own-mailbox')).toBe(true)
})
it('coalesces heartbeats during a slow write instead of building an unbounded queue',async()=>{
 io.revision.mockResolvedValue('[]')
 const room=make();await room.publish('account',snapshot())
 let finish;io.write.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve}))
 const count=io.write.mock.calls.length
 await vi.advanceTimersByTimeAsync(120000)
 expect(io.write.mock.calls.length-count).toBe(1)
 finish({id:'own-mailbox'});await flush(()=>io.write.mock.calls.length-count===2)
 expect(io.write.mock.calls.length-count).toBe(2)
})
