import {describe,it,expect,vi} from 'vitest';
import {rustUI as rust} from './helpers/rust-ui-ready.js';

const encode=value=>new TextEncoder().encode(value);
const decode=value=>new TextDecoder().decode(value);
function channel(label='inhouse-read-interactive-v1'){
  return{label,readyState:'open',bufferedAmount:0,send:vi.fn(),close:vi.fn()};
}
function fixture(){
  const s={account:'account',own:'self',peers:new Map(),signals:{},native:{
    connected:vi.fn(),failed:vi.fn(),latest:null,receiveMotion:vi.fn(),signal:vi.fn((id,wire)=>wire),peerCount:0,connectedCount:0},tabs:{postMessage:vi.fn()}};
  const p={id:'remote',pc:{remoteDescription:null,localDescription:null},open:true,lastReceived:0,healthAt:0,
    stream:{queue:vi.fn(()=>true),next:vi.fn(),receive:vi.fn(),free:vi.fn()}};
  s.peers.set(p.id,p);
  const host={valid:vi.fn(owner=>owner===s),now:()=>1000,clock:()=>0,utf8:encode,decode,
    failed:vi.fn(),armHealth:vi.fn(),motion:vi.fn(),cancelTimer:vi.fn(),disconnected:vi.fn(),
    closePeer:vi.fn((owner,id)=>{owner.peers.delete(id)}),pending:vi.fn(),ice:vi.fn().mockResolvedValue(),
    encrypt:vi.fn().mockResolvedValue({iv:new Uint8Array([1]),data:new Uint8Array([2]).buffer}),encode:()=>'',write:vi.fn().mockResolvedValue(),
    decrypt:vi.fn((owner,cipher)=>Promise.resolve(encode(cipher.data))),readStateDetached:vi.fn()};
  return{s,p,host};
}
// The established JS rules are preserved at exact thresholds. These test public
// WASM exports with browser capability doubles, not private implementation text.
describe('Rust RTC channel policy',()=>{
  it('binds known channel capabilities and closes unknown labels',()=>{
    const{p}=fixture(),interactive=channel(),room=channel('inhouse-read-room-v1'),unknown=channel('other');
    expect(rust.live_transport_bind_channel(p,interactive)).toBe('interactive');
    expect(interactive.bufferedAmountLowThreshold).toBe(32768);expect(p.interactive).toBe(interactive);
    expect(rust.live_transport_bind_channel(p,room)).toBe('room');
    expect(room.binaryType).toBe('arraybuffer');expect(room.bufferedAmountLowThreshold).toBe(65536);
    expect(rust.live_transport_bind_channel(p,unknown)).toBe('');expect(unknown.close).toHaveBeenCalledOnce();
  });
  it('coalesces motion under backpressure and preserves a failed send for retry',()=>{
    const{p}=fixture(),c=p.interactive=channel();c.bufferedAmount=32769;
    rust.live_transport_send_motion(p,'first');rust.live_transport_send_motion(p,'latest');expect(c.send).not.toHaveBeenCalled();
    c.bufferedAmount=32768;c.send.mockImplementationOnce(()=>{throw Error('busy')});
    rust.live_transport_flush_motion(p);expect(p.motion).toBe('latest');
    rust.live_transport_flush_motion(p);expect(c.send).toHaveBeenLastCalledWith('latest');expect(p.motion).toBeNull();
  });
  it('pumps bounded binary packets and closes a channel on a send error',()=>{
    const{p,host}=fixture(),c=p.channel=channel('inhouse-read-room-v1');
    p.stream.next.mockReturnValueOnce(new Uint8Array([1])).mockReturnValueOnce(new Uint8Array([2]));
    c.send.mockImplementation(()=>{c.bufferedAmount+=65536});
    rust.live_transport_send(p,'state',host);expect(p.stream.queue).toHaveBeenCalledWith(encode('state'));
    expect(c.send).toHaveBeenCalledTimes(2);expect(p.stream.next).toHaveBeenCalledTimes(2);
    c.bufferedAmount=0;p.stream.next.mockReturnValueOnce(new Uint8Array([3]));c.send.mockImplementationOnce(()=>{throw Error('closed')});
    rust.live_transport_pump(p);expect(c.close).toHaveBeenCalledOnce();
  });
  it('connects only once both channels are open and ignores stale peers',()=>{
    const{s,p,host}=fixture(),c=p.interactive=channel();p.open=false;
    rust.live_transport_channel_event(s,p,c,'interactive','open',host);expect(s.native.connected).not.toHaveBeenCalled();
    const room=p.channel=channel('inhouse-read-room-v1');
    rust.live_transport_channel_event(s,p,room,'room','open',host);
    expect(s.native.connected).toHaveBeenCalledWith('remote');expect(host.armHealth).toHaveBeenCalledWith(s,p,2000);
    s.peers.delete('remote');rust.live_transport_channel_event(s,p,room,'room','close',host);expect(host.failed).not.toHaveBeenCalled();
  });
  it('answers pings, ignores pongs and forwards motion except to its sender/origin',()=>{
    const{s,p,host}=fixture(),c=p.interactive=channel(),origin={id:'origin',interactive:channel()},other={id:'other',interactive:channel()};
    s.peers.set('origin',origin);s.peers.set('other',other);host.clock=()=>42;
    rust.live_transport_interactive_message(s,p,c,'{"t":"ping","at":7}',host);
    expect(c.send).toHaveBeenCalledWith('{"t":"pong","at":7}');expect(p.lastReceived).toBe(42);
    rust.live_transport_interactive_message(s,p,c,'{"t":"pong"}',host);expect(s.native.receiveMotion).not.toHaveBeenCalled();
    const packet={from:'origin',frame:{x:1}};s.native.receiveMotion.mockReturnValue(packet);
    rust.live_transport_interactive_message(s,p,c,'{"t":"motion"}',host);
    expect(host.motion).toHaveBeenCalledWith('account',packet);expect(origin.interactive.send).not.toHaveBeenCalled();
    expect(other.interactive.send).toHaveBeenCalledWith('{"t":"motion"}');expect(c.send).toHaveBeenCalledTimes(1);
    rust.live_transport_interactive_message(s,p,c,'x'.repeat(98305),host);expect(s.native.receiveMotion).toHaveBeenCalledOnce();
  });
  it('keeps a healthy connection at 12 seconds and fails stale or missing interactive channels after it',()=>{
    const{s,p,host}=fixture();p.interactive=channel();host.clock=()=>12000;
    rust.live_transport_health(s,p,host);expect(host.failed).not.toHaveBeenCalled();expect(p.interactive.send).toHaveBeenCalledWith('{"t":"ping","at":1000}');
    host.clock=()=>12001;rust.live_transport_health(s,p,host);expect(host.failed).toHaveBeenCalledWith(s,'remote');
    host.failed.mockClear();p.lastReceived=12001;p.interactive.readyState='connecting';rust.live_transport_health(s,p,host);
    expect(host.failed).toHaveBeenCalledWith(s,'remote');
  });
  it('does not roll back snapshot state or fail a disposed peer after late application rejection',async()=>{
    const{s,p,host}=fixture();let reject;
    p.stream.receive.mockReturnValue(encode('snapshot'));s.native.receive=()=>({id:'snapshot',snapshot:{books:[]}});
    s.native.forgetSnapshot=vi.fn();host.receive=()=>new Promise((_,fail)=>{reject=fail});
    const pending=rust.live_transport_room_message(s,p,encode('chunk').buffer,host);
    await Promise.resolve();await Promise.resolve();expect(reject).toBeTypeOf('function');
    host.valid.mockReturnValue(false);s.peers.clear();reject(Error('disposed'));await pending;
    expect(s.native.forgetSnapshot).not.toHaveBeenCalled();expect(host.failed).not.toHaveBeenCalled();
  });
  it('deletes peer ownership before closing channels that synchronously fire callbacks',()=>{
    const{s,p,host}=fixture();p.pc.close=vi.fn();p.interactive=channel();p.channel=channel('inhouse-read-room-v1');
    p.interactive.close.mockImplementation(()=>rust.live_transport_channel_event(s,p,p.interactive,'interactive','close',host));
    p.channel.close.mockImplementation(()=>rust.live_transport_channel_event(s,p,p.channel,'room','close',host));s.signals.remote={data:'cipher'};
    rust.live_transport_close(s,'remote',host);
    expect(host.failed).not.toHaveBeenCalled();expect(s.peers.has('remote')).toBe(false);expect(s.signals.remote).toBeUndefined();
    expect(p.stream.free).toHaveBeenCalledOnce();expect(host.disconnected).toHaveBeenCalledWith('remote');
  });
});

describe('Rust RTC negotiation policy',()=>{
  it('preserves media index/mid and skips existing and already accepted ICE candidates',async()=>{
    const p={pc:{remoteDescription:{sdp:'v=0\r\na=candidate:known\r\n'},addIceCandidate:vi.fn().mockResolvedValue()}};
    const sdp='a=candidate:early\nm=audio 9\na=mid:audio\na=candidate:known\na=candidate:first\nm=application 9\na=mid:data\na=candidate:second\na=candidate:first';
    await rust.live_transport_candidates(p,sdp);await rust.live_transport_candidates(p,sdp);
    expect(p.pc.addIceCandidate.mock.calls.map(([candidate])=>candidate)).toEqual([
      {candidate:'candidate:early',sdpMid:'0',sdpMLineIndex:0},
      {candidate:'candidate:first',sdpMid:'audio',sdpMLineIndex:0},
      {candidate:'candidate:second',sdpMid:'data',sdpMLineIndex:1}]);
  });
  it('retries a rejected ICE candidate and commits only successful candidates',async()=>{
    const p={pc:{remoteDescription:null,addIceCandidate:vi.fn().mockRejectedValueOnce(Error('not ready')).mockResolvedValue()}};
    await expect(rust.live_transport_candidates(p,'a=candidate:one')).rejects.toThrow('not ready');
    expect(p.candidates.has('a=candidate:one')).toBe(false);await rust.live_transport_candidates(p,'a=candidate:one');
    expect(p.pc.addIceCandidate).toHaveBeenCalledTimes(2);expect(p.candidates.has('a=candidate:one')).toBe(true);
  });
  it('answers an incoming offer, then accepts later ICE candidates without replacing the peer',async()=>{
    const{s,p,host}=fixture();p.nonce='offer-nonce';p.pc={remoteDescription:null,localDescription:null,
      setRemoteDescription:vi.fn(async function(d){this.remoteDescription=d}),createAnswer:vi.fn().mockResolvedValue({type:'answer',sdp:'answer'}),
      setLocalDescription:vi.fn(async function(d){this.localDescription=d}),addIceCandidate:vi.fn().mockResolvedValue()};
    let signal={type:'offer',nonce:'offer-nonce',sdp:'v=0\r\n'};
    host.readMailbox=vi.fn(async()=>({peer:'remote',signals:{self:{data:JSON.stringify(signal)}}}));
    await rust.live_transport_read(s,'remote','file',host);
    expect(p.pc.setRemoteDescription).toHaveBeenCalledOnce();expect(p.pc.createAnswer).toHaveBeenCalledOnce();
    expect(host.ice).toHaveBeenCalledWith(p,1200);expect(host.write).toHaveBeenCalledWith(s);expect(s.reading.size).toBe(0);
    signal={...signal,sdp:'v=0\r\na=candidate:late'};await rust.live_transport_read(s,'remote','file',host);
    expect(p.pc.setRemoteDescription).toHaveBeenCalledOnce();expect(p.pc.addIceCandidate).toHaveBeenCalledWith({candidate:'candidate:late',sdpMid:'0',sdpMLineIndex:0});
  });
  it('abandons an incoming offer after the peer is replaced while remote description is pending',async()=>{
    const{s,p,host}=fixture();p.nonce='nonce';let finish;
    p.pc.setRemoteDescription=vi.fn(()=>new Promise(resolve=>{finish=resolve}));p.pc.createAnswer=vi.fn();
    host.readMailbox=async()=>({peer:'remote',signals:{self:{data:JSON.stringify({type:'offer',nonce:'nonce',sdp:'v=0'})}}});
    const pending=rust.live_transport_read(s,'remote','file',host);
    for(let i=0;i<15&&!finish;i++)await Promise.resolve();expect(finish).toBeTypeOf('function');
    s.peers.set('remote',{id:'remote'});finish();await pending;expect(p.pc.createAnswer).not.toHaveBeenCalled();expect(s.reading.size).toBe(0);
  });
  it('does not read the same mailbox concurrently and releases the guard after failure',async()=>{
    const{s,host}=fixture();let reject;
    host.readMailbox=vi.fn(()=>new Promise((_,fail)=>{reject=fail}));
    const first=rust.live_transport_read(s,'remote','file',host);await rust.live_transport_read(s,'remote','file',host);
    expect(host.readMailbox).toHaveBeenCalledOnce();reject(Error('retry'));await expect(first).rejects.toThrow('retry');expect(s.reading.size).toBe(0);
  });
});

it('encodes binary transport data identically to host base64 across padding and chunk boundaries',()=>{
  for(const length of [0,1,2,3,16383,16384,16385,65536]){
    const bytes=Uint8Array.from({length},(_,i)=>(i*97+31)%256);
    expect(rust.live_transport_base64(bytes)).toBe(Buffer.from(bytes).toString('base64'));
  }
});
