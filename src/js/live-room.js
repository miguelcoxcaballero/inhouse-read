import {cloudModule} from './cloud-native.js'
import {getDriveLiveContext,readDriveLiveMailbox,writeDriveLiveMailbox,readDriveLibraryRevision} from './drive-client.js'

// Browser-owned RTC and WebCrypto handles; identity, negotiation, deduplication
// and field registers live in Rust. Drive carries only encrypted rendezvous.
const LIMIT=2*1024*1024, CHUNK=16000
const bytes=new TextEncoder(), text=new TextDecoder()
const b64=b=>btoa(String.fromCharCode(...b))
const un64=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0))
export class LiveRoom {
  #session=null
  #epoch=0
  #receive
  #enabled
  #onPeers
  constructor({receive,enabled=()=>!document.hidden}) {
    this.#receive=receive;this.#enabled=enabled
    this.#onPeers=e=>{const s=this.#session;if(s?.native&&s.folder===e.detail?.folderId)this.#actions(s,s.native.observe(e.detail.peers,Date.now()))}
    globalThis.addEventListener('inhouse-drive-live-peers',this.#onPeers)
  }
  async publish(account,snapshot) {
    if(!account||!this.#enabled()||!globalThis.RTCPeerConnection||!crypto.subtle)return
    let s=this.#session
    if(s?.account!==account){this.pause();s={account,epoch:this.#epoch,peers:new Map(),signals:{},file:null,latest:snapshot,timers:new Set()};this.#session=s;s.ready=this.#start(s)}
    s.latest=snapshot
    await s.ready
    if(!this.#valid(s))return
    const packet=s.native.publish(s.latest,crypto.randomUUID())
    if(packet)for(const peer of s.peers.values())this.#send(peer,packet)
  }
  #valid(s){return this.#session===s&&s.epoch===this.#epoch&&this.#enabled()}
  #timer(s,fn,ms){const t=setTimeout(()=>{s.timers.delete(t);if(this.#valid(s))fn()},ms);s.timers.add(t);return t}
  async #context(s) {
    let context=await getDriveLiveContext();if(!this.#valid(s))return
    // A concurrently created key must be read back before our first signal.
    if(context.confirm)context=await getDriveLiveContext()
    if(!this.#valid(s))return
    const key=await crypto.subtle.importKey('raw',un64(context.key.replaceAll('-','+').replaceAll('_','/')),'AES-GCM',false,['encrypt','decrypt'])
    if(this.#valid(s)){s.key=key;s.folder=context.folderId}
  }
  async #start(s) {
    try{
      const ui=await cloudModule();if(!this.#valid(s))return
      let own=sessionStorage.getItem('inhouse-read-live-peer');if(!own){own=crypto.randomUUID();sessionStorage.setItem('inhouse-read-live-peer',own)}
      s.own=own;s.file=sessionStorage.getItem(`inhouse-read-live-file:${s.account}`);s.native=new ui.RustLiveRoom(s.account,own)
      await this.#context(s);if(!this.#valid(s))return
      await this.#write(s);if(!this.#valid(s))return
      await readDriveLibraryRevision()
      this.#heartbeat(s)
    }catch(error){console.debug('Direct room initialization:',error.message);if(this.#session===s){this.pause()}}
  }
  #heartbeat(s){this.#timer(s,()=>{this.#write(s).catch(()=>{});this.#heartbeat(s)},20000)}
  #write(s) {
    // Serialize writes so a slow heartbeat cannot overwrite a newer answer.
    s.writing=(s.writing||Promise.resolve()).catch(()=>{}).then(async()=>{
      if(!this.#valid(s))return
      const payload={v:1,peer:s.own,at:Date.now(),signals:{...s.signals}}
      let file
      try{file=await writeDriveLiveMailbox(s.own,payload,s.file)}
      catch(error){if(!this.#valid(s)||!s.file)throw error;s.file=null;sessionStorage.removeItem(`inhouse-read-live-file:${s.account}`);file=await writeDriveLiveMailbox(s.own,payload,null)}
      if(this.#valid(s)){s.file=file.id;sessionStorage.setItem(`inhouse-read-live-file:${s.account}`,file.id)}
    });return s.writing
  }
  async #signal(s,id,description,nonce) {
    if(!this.#valid(s))return
    const iv=crypto.getRandomValues(new Uint8Array(12)),payload=bytes.encode(JSON.stringify({account:s.account,from:s.own,to:id,nonce,at:Date.now(),type:description.type,sdp:description.sdp}))
    const cipher=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:bytes.encode(s.account)},s.key,payload)
    if(!this.#valid(s))return
    s.signals[id]={iv:b64(iv),data:b64(new Uint8Array(cipher))}
    await this.#write(s)
  }
  #actions(s,actions){for(const [action,id,file] of actions){if(!this.#valid(s))break;if(action==='close'){this.#close(s,id)}else if(action==='read'){this.#read(s,id,file).catch(()=>{})}else if(action==='offer'){this.#offer(s,id).catch(()=>this.#failed(s,id))}}this.#pending(s)}
  #pending(s){if(s.pending||!this.#valid(s))return;if(![...s.peers.values()].some(p=>!p.open))return;s.pending=this.#timer(s,()=>{s.pending=null;this.#actions(s,s.native.pending(Date.now()))},350)}
  async #read(s,id,file) {
    s.reading ||= new Set();if(s.reading.has(id))return;s.reading.add(id)
    try{
      const mailbox=await readDriveLiveMailbox(file);if(!this.#valid(s)||mailbox.peer!==id)return
      const encrypted=mailbox.signals[s.own];if(!encrypted||typeof encrypted.data!=='string'||encrypted.data.length>65000)return
      let decoded
      try{decoded=await this.#decrypt(s,encrypted)}catch{await this.#context(s);if(!this.#valid(s))return;decoded=await this.#decrypt(s,encrypted)}
      if(!this.#valid(s))return
      const signal=s.native.signal(id,JSON.parse(text.decode(decoded)),Date.now());if(!signal)return
      if(signal.type==='offer'){
        this.#close(s,id);const p=this.#peer(s,id);p.nonce=signal.nonce
        await p.pc.setRemoteDescription({type:'offer',sdp:signal.sdp});if(!this.#validPeer(s,p))return
        await p.pc.setLocalDescription(await p.pc.createAnswer());await this.#ice(s,p)
        if(this.#validPeer(s,p)){if(!p.pc.localDescription.sdp.includes('a=candidate:')){this.#failed(s,id);return}await this.#signal(s,id,p.pc.localDescription,p.nonce)}
      }else{
        const p=s.peers.get(id);if(this.#validPeer(s,p))await p.pc.setRemoteDescription({type:'answer',sdp:signal.sdp})
      }
    }finally{s.reading.delete(id)}
  }
  #decrypt(s,e){return crypto.subtle.decrypt({name:'AES-GCM',iv:un64(e.iv),additionalData:bytes.encode(s.account)},s.key,un64(e.data))}
  #validPeer(s,p){return p&&this.#valid(s)&&s.peers.get(p.id)===p}
  #peer(s,id) {
    const pc=new RTCPeerConnection({iceServers:[{urls:['stun:stun.l.google.com:19302','stun:stun1.l.google.com:19302']}]}),p={id,pc,open:false,queue:null,sending:false,assembly:null};s.peers.set(id,p)
    pc.ondatachannel=e=>this.#channel(s,p,e.channel)
    pc.onconnectionstatechange=()=>{if(this.#validPeer(s,p)&&['failed','closed','disconnected'].includes(pc.connectionState))this.#failed(s,id)}
    return p
  }
  async #offer(s,id) {
    await this.#context(s);if(!this.#valid(s))return
    this.#close(s,id);const nonce=crypto.randomUUID();if(!s.native.beginOffer(id,nonce,Date.now()))return
    const p=this.#peer(s,id);p.nonce=nonce;this.#pending(s);this.#channel(s,p,p.pc.createDataChannel('inhouse-read-room-v1',{ordered:true}))
    await p.pc.setLocalDescription(await p.pc.createOffer());await this.#ice(s,p)
    if(this.#validPeer(s,p)){if(!p.pc.localDescription.sdp.includes('a=candidate:')){this.#failed(s,id);return}await this.#signal(s,id,p.pc.localDescription,nonce)}
  }
  #ice(s,p){if(p.pc.iceGatheringState==='complete')return Promise.resolve();return new Promise(resolve=>{const done=()=>{clearTimeout(timer);p.pc.removeEventListener('icegatheringstatechange',changed);resolve()};const changed=()=>{if(p.pc.iceGatheringState==='complete')done()};const timer=setTimeout(done,1200);p.pc.addEventListener('icegatheringstatechange',changed)})}
  #channel(s,p,channel) {
    if(channel.label!=='inhouse-read-room-v1'){channel.close();return}
    p.channel=channel;channel.binaryType='arraybuffer';channel.bufferedAmountLowThreshold=65536
    channel.onopen=()=>{if(!this.#validPeer(s,p))return;p.open=true;s.native.connected(p.id);this.#send(p,s.native.latest)}
    channel.onclose=()=>{if(this.#validPeer(s,p))this.#failed(s,p.id)}
    channel.onbufferedamountlow=()=>this.#pump(p)
    channel.onmessage=async e=>{
      if(!this.#validPeer(s,p))return
      try{
        if(typeof e.data==='string'){
          if(e.data.length>128)throw Error('Invalid header')
          const header=JSON.parse(e.data)
          if(header.v!==1||!Number.isInteger(header.size)||header.size<1||header.size>LIMIT)throw Error('Invalid packet')
          p.assembly={buffer:new Uint8Array(header.size),offset:0};return
        }
        const assembly=p.assembly,part=new Uint8Array(e.data)
        if(!assembly||part.length>CHUNK||assembly.offset+part.length>assembly.buffer.length)throw Error('Invalid chunk')
        assembly.buffer.set(part,assembly.offset);assembly.offset+=part.length
        if(assembly.offset===assembly.buffer.length){p.assembly=null;const packet=s.native.receive(text.decode(assembly.buffer));if(packet?.snapshot)await this.#receive(s.account,packet.snapshot)}
      }catch{if(this.#validPeer(s,p))this.#failed(s,p.id)}
    }
  }
  #send(p,packet){if(!packet)return;const data=bytes.encode(packet);if(data.length>LIMIT)return;p.queue=data;this.#pump(p)}
  #pump(p){const c=p.channel;if(c?.readyState!=='open')return
    try{while(c.bufferedAmount<131072){if(!p.sending){if(!p.queue)return;p.sending=p.queue;p.queue=null;p.offset=0;c.send(JSON.stringify({v:1,size:p.sending.length}))}
      const end=Math.min(p.offset+CHUNK,p.sending.length);c.send(p.sending.subarray(p.offset,end));p.offset=end;if(end===p.sending.length)p.sending=null
    }}catch{c.close()}
  }
  #failed(s,id){if(!this.#valid(s))return;this.#close(s,id);s.native.failed(id,Date.now())}
  #close(s,id){const p=s.peers.get(id);if(!p)return;s.peers.delete(id);delete s.signals[id];p.channel?.close();p.pc.close();p.queue=null;p.assembly=null}
  pause(){const s=this.#session;this.#session=null;this.#epoch++;if(!s)return;for(const timer of s.timers)clearTimeout(timer);for(const id of s.peers.keys())this.#close(s,id);s.native?.free()}
  destroy(){this.pause();globalThis.removeEventListener('inhouse-drive-live-peers',this.#onPeers)}
}
