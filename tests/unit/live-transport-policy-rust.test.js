import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { webcrypto } from 'node:crypto';
import { setTimeout as waitForHost } from 'node:timers/promises';
import { rustUI } from './helpers/rust-ui-ready.js';
const io=vi.hoisted(()=>({context:vi.fn(),read:vi.fn(),write:vi.fn(),revision:vi.fn(),stateRead:vi.fn(),stateWrite:vi.fn()}));
vi.mock('../../src/js/cloud-native.js',()=>({cloudModule:async()=>rustUI}));
vi.mock('../../src/js/drive-client.js',()=>({getDriveLiveContext:io.context,readDriveLiveMailbox:io.read,
  writeDriveLiveMailbox:io.write,readDriveLibraryRevision:io.revision,readDriveLiveState:io.stateRead,writeDriveLiveState:io.stateWrite}));
import { LiveRoom } from '../../src/js/live-room.js';
import { LiveRoom as ReferenceRoom } from './helpers/reference-live-room-transport.js';

const rooms=[],pcs=[],key=Buffer.alloc(32,7).toString('base64url');
const snapshot=isOn=>({schemaVersion:1,books:[],settings:{'inhouse-read-shelf-lamps':{
  at:Date.now(),device:'device',value:JSON.stringify([{key:'lamp:one',isOn}])}}});
class Channel {
  readyState='connecting';bufferedAmount=0;
  constructor(label){this.label=label;}
  send(){}
  close(){this.readyState='closed';this.onclose?.();}
}
class Peer {
  channels=[];iceGatheringState='complete';connectionState='connecting';localDescription=null;
  constructor(){pcs.push(this);}
  createDataChannel(label){const channel=new Channel(label);this.channels.push(channel);return channel;}
  async createOffer(){return{type:'offer',sdp:'v=0\r\n'};}
  async setLocalDescription(value){this.localDescription=value;}
  close(){this.connectionState='closed';}
}
// WebCrypto runs on real host threads while app timers are deliberately fake.
// Yield real time rather than consuming a fixed number of empty event-loop turns.
async function flush(check=()=>true){for(let index=0;index<150;index++){await waitForHost(1);if(check())return;}throw Error('Host operation did not settle');}
async function decoded(payload){
  const imported=await webcrypto.subtle.importKey('raw',Buffer.alloc(32,7),'AES-GCM',false,['decrypt']);
  const plain=await webcrypto.subtle.decrypt({name:'AES-GCM',iv:Buffer.from(payload.iv,'base64'),
    additionalData:new TextEncoder().encode('account')},imported,Buffer.from(payload.data,'base64'));
  return JSON.parse(new TextDecoder().decode(plain));
}
async function remoteState(isOn=false){
  const imported=await webcrypto.subtle.importKey('raw',Buffer.alloc(32,7),'AES-GCM',false,['encrypt']);
  const packet=JSON.stringify({v:1,account:'account',from:'zzzzzzzz',id:'snapshot-1',snapshot:snapshot(isOn)});
  const iv=Buffer.alloc(12,3),data=await webcrypto.subtle.encrypt({name:'AES-GCM',iv,
    additionalData:new TextEncoder().encode('account')},imported,new TextEncoder().encode(packet));
  return{v:1,peer:'zzzzzzzz',iv:iv.toString('base64'),data:Buffer.from(data).toString('base64')};
}
beforeEach(()=>{
  vi.useFakeTimers({toFake:['setTimeout','clearTimeout','Date','performance']});
  vi.stubGlobal('crypto',webcrypto);vi.stubGlobal('BroadcastChannel',undefined);vi.stubGlobal('RTCPeerConnection',Peer);
  pcs.length=0;for(const fn of Object.values(io))fn.mockReset();
  io.context.mockResolvedValue({folderId:'folder',key});io.write.mockResolvedValue({id:'own-mailbox'});
  io.read.mockResolvedValue({v:1,peer:'zzzzzzzz',signals:{}});io.stateWrite.mockResolvedValue({id:'state-file'});
  io.revision.mockImplementation(async()=>{
    dispatchEvent(new CustomEvent('inhouse-drive-live-peers',{detail:{folderId:'folder',peers:[{
      id:'remote',name:'live-v1-zzzzzzzz.json',modifiedTime:new Date().toISOString()}]}}));return '[]';
  });
});
afterEach(()=>{for(const room of rooms.splice(0))room.destroy();vi.useRealTimers();vi.unstubAllGlobals();vi.restoreAllMocks();});

// Run identical public transport scenarios against frozen prior JS and Rust.
describe.each([['Rust',LiveRoom],['previous JS',ReferenceRoom]])('%s asynchronous live transport',(_,Room)=>{
  const create=(options={})=>{const room=new Room({enabled:()=>true,receive:async()=>{},...options});rooms.push(room);return room;};
  it('keeps a newer pending lamp state when an older in-flight state write fails',async()=>{
    let rejectFirst;
    io.stateWrite.mockImplementationOnce(()=>new Promise((_,reject)=>{rejectFirst=reject;}));
    const room=create();await room.publish('account',snapshot(true));await flush(()=>pcs.length>0);
    await vi.advanceTimersByTimeAsync(160);await flush(()=>Boolean(rejectFirst));
    await room.publish('account',snapshot(false));
    rejectFirst(Object.assign(Error('temporary upstream error'),{status:503}));
    await flush();await vi.advanceTimersByTimeAsync(2000);await flush(()=>io.stateWrite.mock.calls.length>=2);
    const packet=await decoded(io.stateWrite.mock.calls.at(-1)[1]);
    expect(packet.snapshot.settings['inhouse-read-shelf-lamps'].value).toContain('"isOn":false');
  });
  it('ignores an old state upload result after an account change',async()=>{
    let finish;
    io.stateWrite.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
    const room=create();await room.publish('account',snapshot(true));await flush(()=>pcs.length>0);
    await vi.advanceTimersByTimeAsync(160);await flush(()=>Boolean(finish));
    await room.publish('another-account',snapshot(false));await flush(()=>pcs.length>1);
    finish({id:'stale-upload'});await flush();await flush();
    expect(io.write.mock.calls.every(([,payload])=>payload.state?.id!=='stale-upload')).toBe(true);
  });
  it('does not flush a queued mailbox follow-up after suspension',async()=>{
    io.revision.mockResolvedValue('[]');
    const room=create();await room.publish('account',snapshot(true));
    let finish;io.write.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
    const count=io.write.mock.calls.length;
    await vi.advanceTimersByTimeAsync(60000);await flush(()=>Boolean(finish));
    expect(io.write.mock.calls.length-count).toBe(1);
    room.suspend();finish({id:'own-mailbox'});await flush();
    await vi.advanceTimersByTimeAsync(60000);
    expect(io.write.mock.calls.length-count).toBe(1);
  });
  it('recreates a missing state file only after a 404, preserving the same encrypted packet',async()=>{
    const room=create();await room.publish('account',snapshot(true));await flush(()=>pcs.length>0);
    await vi.advanceTimersByTimeAsync(160);await flush(()=>io.write.mock.calls.some(([,payload])=>payload.state));
    io.stateWrite.mockRejectedValueOnce(Object.assign(Error('missing file'),{status:404}));
    await room.publish('account',snapshot(false));await vi.advanceTimersByTimeAsync(160);
    await flush(()=>io.stateWrite.mock.calls.length>=3);
    const [first,retry]=io.stateWrite.mock.calls.slice(-2);
    expect(first[2]).toBe('state-file');expect(retry[2]).toBeNull();
    expect(retry[1]).toEqual(first[1]);
  });
  it('refreshes the shared key and retries a failed incoming state decryption',async()=>{
    io.stateRead.mockResolvedValue(await remoteState());
    io.read.mockResolvedValue({v:1,peer:'zzzzzzzz',signals:{},state:{id:'remote-state',revision:'first'}});
    const decrypt=vi.spyOn(webcrypto.subtle,'decrypt').mockRejectedValueOnce(Error('key changed'));
    const receive=vi.fn().mockResolvedValue(undefined),room=create({receive});
    await room.publish('account',snapshot(true));await flush(()=>receive.mock.calls.length===1);
    expect(decrypt.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(receive.mock.calls[0][0]).toBe('account');
    expect(receive.mock.calls[0][1].settings['inhouse-read-shelf-lamps'].value).toContain('"isOn":false');
  });
  it('releases the incoming read guard and deduplication entry when local application fails',async()=>{
    io.stateRead.mockResolvedValue(await remoteState());
    io.read.mockResolvedValue({v:1,peer:'zzzzzzzz',signals:{},state:{id:'remote-state',revision:'first'}});
    const receive=vi.fn().mockRejectedValueOnce(Error('storage busy')).mockResolvedValue(undefined);
    const room=create({receive});await room.publish('account',snapshot(true));await flush(()=>receive.mock.calls.length===1);
    await vi.advanceTimersByTimeAsync(1000);await flush(()=>receive.mock.calls.length===2);
    await vi.advanceTimersByTimeAsync(1000);await flush();
    expect(receive).toHaveBeenCalledTimes(2);
  });
  it('does not touch a disposed native room when a pending local application rejects',async()=>{
    io.stateRead.mockResolvedValue(await remoteState());
    io.read.mockResolvedValue({v:1,peer:'zzzzzzzz',signals:{},state:{id:'remote-state',revision:'first'}});
    let fail;
    const receive=vi.fn().mockImplementationOnce(()=>new Promise((_,reject)=>{fail=reject;})).mockResolvedValue(undefined);
    const room=create({receive});await room.publish('account',snapshot(true));await flush(()=>Boolean(fail));
    room.suspend();fail(Error('late storage failure'));await flush();
    await room.resume();await flush(()=>receive.mock.calls.length===2);
    expect(receive).toHaveBeenCalledTimes(2);
  });
});

it('releases Rust transport handles after repeated account lifecycles',async()=>{
  io.revision.mockResolvedValue('[]');
  const baseline=rustUI.ui_live_handles();
  for(let index=0;index<30;index++){
    const room=new LiveRoom({enabled:()=>true,receive:async()=>{}});
    rooms.push(room);await room.publish('account',snapshot(true));room.destroy();await flush();
  }
  expect(rustUI.ui_live_handles()).toBe(baseline);
});
