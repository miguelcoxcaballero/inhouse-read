import {cloudModule} from './cloud-native.js'
import {getDriveLiveContext,readDriveLiveMailbox,writeDriveLiveMailbox,readDriveLibraryRevision,readDriveLiveState,writeDriveLiveState} from './drive-client.js'

// Browser-owned RTC and WebCrypto handles; identity, negotiation, deduplication
// and field registers live in Rust. Drive carries encrypted rendezvous and a
// bounded motion/state fallback when a direct network route is unavailable.
// One identity per JavaScript realm: duplicated tabs clone sessionStorage.
const realmPeer=crypto.randomUUID()
const bytes=new TextEncoder(), text=new TextDecoder()
const b64=b=>{let s='';for(let i=0;i<b.length;i+=16384)s+=String.fromCharCode(...b.subarray(i,i+16384));return btoa(s)}
const un64=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0))
export class LiveRoom {
  #mailboxes=new Map()
  #stateFiles=new Map()
  #motionClock=0
  #desired=null
  #session=null
  #epoch=0
  #receive
  #enabled
  #onPeers
  #motion
  #disconnected
  constructor({receive,receiveMotion=()=>{},disconnected=()=>{},enabled=()=>!document.hidden}) {
    this.#receive=receive;this.#motion=receiveMotion;this.#disconnected=disconnected;this.#enabled=enabled
    this.#onPeers=e=>{const s=this.#session;if(s?.native&&s.folder===e.detail?.folderId)this.#actions(s,s.native.observe(e.detail.peers,Date.now()))}
    globalThis.addEventListener('inhouse-drive-live-peers',this.#onPeers)
  }
  async publish(account,snapshot) {
    if(!account||!this.#enabled()||!crypto.subtle)return
    this.#desired={account,snapshot}
    let s=this.#session
    if(s?.account!==account){this.suspend();s={account,epoch:this.#epoch,peers:new Map(),signals:{},file:null,latest:snapshot,timers:new Set()};this.#session=s;s.ready=this.#start(s)}
    s.latest=snapshot
    await s.ready
    if(this.#valid(s)&&s.native)this.#publishNow(s)
  }
  #publishNow(s){
    const packet=s.native.publish(s.latest,crypto.randomUUID())
    if(!packet)return
    s.tabs?.postMessage({t:'snapshot',from:s.own,packet})
    const encoded=bytes.encode(packet);for(const peer of s.peers.values())this.#send(peer,encoded)
    s.statePending=packet;this.#scheduleState(s)
  }
  #scheduleState(s,delay=150){
    if(!this.#valid(s)||!s.key||s.stateBusy||s.stateTimer||!s.statePending||s.native.peerCount<=s.native.connectedCount)return
    s.stateTimer=this.#timer(s,()=>{s.stateTimer=null;this.#stateRelay(s)},delay)
  }
  async #stateRelay(s){
    if(!this.#valid(s))return
    const packet=s.statePending;if(!packet)return;s.stateBusy=true;s.statePending=null
    try{
      const iv=crypto.getRandomValues(new Uint8Array(12))
      const data=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:bytes.encode(s.account)},s.key,bytes.encode(packet))
      if(!this.#valid(s))return
      const payload={v:1,peer:s.own,iv:b64(iv),data:b64(new Uint8Array(data))}
      let file
      try{file=await writeDriveLiveState(s.own,payload,s.stateFile)}
      catch(error){if(!this.#valid(s)||!s.stateFile||error.status!==404)throw error;s.stateFile=null;file=await writeDriveLiveState(s.own,payload,null)}
      if(!this.#valid(s))return
      s.stateFile=file.id;this.#stateFiles.set(s.account,file.id);s.relayState={id:file.id,revision:crypto.randomUUID()};await this.#write(s)
      s.stateFailures=0
    }catch{if(this.#valid(s)){s.statePending ||= packet;s.stateFailures=(s.stateFailures||0)+1}}
    finally{s.stateBusy=false;if(this.#valid(s))this.#scheduleState(s,s.stateFailures?Math.min(10000,1000*2**Math.min(s.stateFailures,3)):150)}
  }
  async #accept(s,packet){
    if(!packet?.snapshot)return
    try{await this.#receive(s.account,packet.snapshot)}catch(error){if(this.#valid(s))s.native.forgetSnapshot(packet.id);throw error}
  }
  publishMotion(account,frame) {
    const s=this.#session;if(!s?.native||s.account!==account||!this.#valid(s))return
    frame.sequence=++this.#motionClock
    const packet=s.native.publishMotion(frame);if(!packet)return
    this.#motionClock=frame.sequence
    s.motionLatest=frame.phase==='frame'?{...frame}:null
    if(s.motionLatest&&!s.motionHeartbeat)s.motionHeartbeat=this.#timer(s,()=>{
      s.motionHeartbeat=null;if(s.motionLatest)this.publishMotion(s.account,{...s.motionLatest})
    },1000)
    s.tabs?.postMessage({t:'motion',from:s.own,packet})
    for(const p of s.peers.values())this.#sendMotion(p,packet)
    if(s.native.peerCount>s.native.connectedCount){s.relayPending=packet;this.#scheduleRelay(s)}
  }
  #scheduleRelay(s){if(s.relayBusy||s.relayTimer||!s.relayPending)return
    s.relayTimer=this.#timer(s,()=>{s.relayTimer=null;this.#relay(s)},250)
  }
  async #relay(s){
    const packet=s.relayPending;s.relayPending=null
    if(!packet||!this.#valid(s)||!s.key||s.native.peerCount<=s.native.connectedCount)return
    s.relayBusy=true
    try{
      const iv=crypto.getRandomValues(new Uint8Array(12))
      const data=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:bytes.encode(s.account)},s.key,bytes.encode(JSON.stringify({at:Date.now(),packet})))
      if(!this.#valid(s))return
      s.relayMotion={iv:b64(iv),data:b64(new Uint8Array(data))};await this.#write(s)
    }catch{}finally{s.relayBusy=false;if(this.#valid(s))this.#scheduleRelay(s)}
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
      if(!s.native){
      const ui=await cloudModule();if(!this.#valid(s))return
      s.ui=ui;s.own=realmPeer;s.file=this.#mailboxes.get(s.account)||null;s.stateFile=this.#stateFiles.get(s.account)||null;s.native=new ui.RustLiveRoom(s.account,s.own)
      if(globalThis.BroadcastChannel){
        const hash=await crypto.subtle.digest('SHA-256',bytes.encode(s.account));if(!this.#valid(s))return
        s.tabs=new BroadcastChannel('inhouse-read-room-v1:'+b64(new Uint8Array(hash)))
        s.tabs.onmessage=async({data})=>{
          if(!this.#valid(s)||data?.from===s.own)return
          if(data?.t==='state-request'){if(s.native.latest)s.tabs.postMessage({t:'snapshot',from:s.own,packet:s.native.latest});return}
          if(data?.t==='motion'){const packet=s.native.receiveMotion(data.packet);if(packet){this.#motion(s.account,packet);for(const p of s.peers.values())if(p.id!==packet.from)this.#sendMotion(p,data.packet)};return}
          if(data?.t==='snapshot'){try{const packet=s.native.receive(data.packet);await this.#accept(s,packet)}catch{if(this.#valid(s))this.#timer(s,()=>s.tabs?.postMessage({t:'state-request',from:s.own}),1000)}}
        }
        s.tabs.postMessage({t:'state-request',from:s.own})
      }
      }
      await this.#context(s);if(!this.#valid(s))return
      this.#publishNow(s)
      await this.#write(s);if(!this.#valid(s))return
      s.initFailures=0;this.#discover(s);this.#heartbeat(s)
    }catch(error){
      if(this.#valid(s)){
        s.initFailures=(s.initFailures||0)+1
        this.#timer(s,()=>{s.ready=this.#start(s)},Math.min(15000,1000*2**Math.min(s.initFailures,4)))
      }
    }
  }
  #heartbeat(s){this.#timer(s,()=>{this.#write(s).catch(()=>{});this.#heartbeat(s)},20000)}
  async #discover(s){
    // Discovery must not wait behind a cover upload or the durable backup
    // lock: the other device's first offer may arrive during that work.
    try{await readDriveLibraryRevision();s.discoveryFailures=0}
    catch{s.discoveryFailures=(s.discoveryFailures||0)+1}
    if(this.#valid(s))this.#timer(s,()=>this.#discover(s),s.discoveryFailures?
      Math.min(15000,1000*2**Math.min(s.discoveryFailures,4)):
      [...s.peers.values()].some(p=>p.open)?2500:700)
  }
  #write(s) {
    // At most one in-flight write and one latest-value follow-up. A slow
    // heartbeat cannot queue unbounded requests or overwrite a newer answer.
    s.writeAgain=true
    if(s.writing)return s.writing
    s.writing=(async()=>{
      do{
        s.writeAgain=false;if(!this.#valid(s))return
        const payload={v:1,peer:s.own,at:Date.now(),signals:{...s.signals},motion:s.relayMotion,state:s.relayState}
        let file
        try{file=await writeDriveLiveMailbox(s.own,payload,s.file)}
        catch(error){if(!this.#valid(s)||!s.file||error.status!==404)throw error;s.file=null;this.#mailboxes.delete(s.account);file=await writeDriveLiveMailbox(s.own,payload,null)}
        if(this.#valid(s)){s.file=file.id;this.#mailboxes.set(s.account,file.id)}
      }while(s.writeAgain&&this.#valid(s))
    })().finally(()=>{s.writing=null})
    return s.writing
  }
  async #signal(s,id,description,nonce) {
    if(!this.#valid(s))return
    const iv=crypto.getRandomValues(new Uint8Array(12)),payload=bytes.encode(JSON.stringify({account:s.account,from:s.own,to:id,nonce,at:Date.now(),type:description.type,sdp:description.sdp}))
    const cipher=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:bytes.encode(s.account)},s.key,payload)
    if(!this.#valid(s))return
    s.signals[id]={iv:b64(iv),data:b64(new Uint8Array(cipher))}
    await this.#write(s)
  }
  #actions(s,actions){for(const [action,id,file] of actions){if(!this.#valid(s))break;if(action==='close'){this.#close(s,id)}else if(action==='read'){this.#read(s,id,file).catch(()=>{if(this.#valid(s))s.native.readFailed(id)})}else if(action==='offer'){this.#offer(s,id).catch(()=>this.#failed(s,id))}}this.#pending(s);this.#scheduleState(s)}
  #pending(s){if(s.pending||!this.#valid(s))return;if(![...s.peers.values()].some(p=>!p.open))return;s.pending=this.#timer(s,()=>{s.pending=null;this.#actions(s,s.native.pending(Date.now()))},350)}
  async #read(s,id,file) {
    s.reading ||= new Set();if(s.reading.has(id))return;s.reading.add(id)
    try{
      const mailbox=await readDriveLiveMailbox(file);if(!this.#valid(s)||mailbox.peer!==id)return
      if(typeof mailbox.motion?.data==='string'&&mailbox.motion.data.length<=132000){
        try{
          const decoded=await this.#decrypt(s,mailbox.motion);if(!this.#valid(s))return
          const envelope=JSON.parse(text.decode(decoded)),packet=s.native.receiveRelay(id,envelope,Date.now())
          if(packet){this.#motion(s.account,packet);s.tabs?.postMessage({t:'motion',from:s.own,packet:envelope.packet});for(const p of s.peers.values())if(p.id!==id)this.#sendMotion(p,envelope.packet)}
        }catch{}
      }
      if(mailbox.state)this.#readState(s,id,mailbox.state).catch(()=>{if(this.#valid(s))s.native.readFailed(id)})
      const encrypted=mailbox.signals[s.own];if(!encrypted||typeof encrypted.data!=='string'||encrypted.data.length>65000)return
      let decoded
      try{decoded=await this.#decrypt(s,encrypted)}catch{await this.#context(s);if(!this.#valid(s))return;decoded=await this.#decrypt(s,encrypted)}
      if(!this.#valid(s))return
      const signal=s.native.signal(id,JSON.parse(text.decode(decoded)),Date.now());if(!signal)return
      if(signal.type==='offer'){
        let p=s.peers.get(id);if(p?.nonce!==signal.nonce){this.#close(s,id);p=this.#peer(s,id);p.nonce=signal.nonce;this.#pending(s)}
        if(p.pc.remoteDescription){await this.#candidates(p,signal.sdp);return}
        await p.pc.setRemoteDescription({type:'offer',sdp:signal.sdp});if(!this.#validPeer(s,p))return
        if(!p.pc.localDescription)await p.pc.setLocalDescription(await p.pc.createAnswer());await this.#ice(s,p)
        if(this.#validPeer(s,p)){await this.#signal(s,id,p.pc.localDescription,p.nonce)}
      }else{
        const p=s.peers.get(id);if(this.#validPeer(s,p)){if(p.pc.remoteDescription)await this.#candidates(p,signal.sdp);else await p.pc.setRemoteDescription({type:'answer',sdp:signal.sdp})}
      }
    }finally{s.reading.delete(id)}
  }
  async #readState(s,id,state){
    s.stateSeen ||= new Map();s.stateReading ||= new Set()
    if(typeof state?.id!=='string'||!/^[\w-]{1,128}$/.test(state.id)||typeof state.revision!=='string'||s.stateSeen.get(id)===state.revision||s.stateReading.has(id))return
    s.stateReading.add(id)
    try{
      const encrypted=await readDriveLiveState(state.id);if(!this.#valid(s)||encrypted.peer!==id)return
      let decoded
      try{decoded=await this.#decrypt(s,encrypted)}catch{await this.#context(s);if(!this.#valid(s))return;decoded=await this.#decrypt(s,encrypted)}
      if(!this.#valid(s))return
      await this.#accept(s,s.native.receiveStateRelay(id,{packet:text.decode(decoded)}))
      if(this.#valid(s))s.stateSeen.set(id,state.revision)
    }finally{s.stateReading.delete(id)}
  }
  async #candidates(p,sdp) {
    const known=new Set((p.pc.remoteDescription?.sdp||'').split(/\r?\n/).filter(l=>l.startsWith('a=candidate:')))
    p.candidates ||= new Set();let mid='0',index=-1
    for(const line of sdp.split(/\r?\n/)){
      if(line.startsWith('m='))index++
      if(line.startsWith('a=mid:'))mid=line.slice(6)
      if(line.startsWith('a=candidate:')&&!known.has(line)&&!p.candidates.has(line)){
        await p.pc.addIceCandidate({candidate:line.slice(2),sdpMid:mid,sdpMLineIndex:Math.max(0,index)});p.candidates.add(line)
      }
    }
  }
  #decrypt(s,e){return crypto.subtle.decrypt({name:'AES-GCM',iv:un64(e.iv),additionalData:bytes.encode(s.account)},s.key,un64(e.data))}
  #validPeer(s,p){return p&&this.#valid(s)&&s.peers.get(p.id)===p}
  #peer(s,id) {
    const pc=new RTCPeerConnection({iceServers:[{urls:['stun:stun.l.google.com:19302','stun:stun1.l.google.com:19302']}],iceCandidatePoolSize:0,bundlePolicy:'max-bundle',rtcpMuxPolicy:'require'}),p={id,pc,open:false,stream:new s.ui.RustRoomPacketStream(),lastReceived:performance.now(),healthAt:performance.now()};s.peers.set(id,p)
    pc.ondatachannel=e=>this.#channel(s,p,e.channel)
    pc.onconnectionstatechange=()=>{
      if(!this.#validPeer(s,p))return
      if(['failed','closed'].includes(pc.connectionState))this.#failed(s,id)
      else if(pc.connectionState==='disconnected')this.#timer(s,()=>{if(this.#validPeer(s,p)&&pc.connectionState==='disconnected')this.#failed(s,id)},5000)
    }
    // Keep the complete encrypted candidate list in the directed mailbox.
    // Unlike a 1.2-second one-shot offer, late STUN candidates are delivered too.
    pc.onicecandidate=()=>{
      if(!this.#validPeer(s,p)||!p.nonce||!pc.localDescription)return
      clearTimeout(p.iceTimer);p.iceTimer=setTimeout(()=>{if(this.#validPeer(s,p))this.#signal(s,id,pc.localDescription,p.nonce).catch(()=>{})},200)
    }
    return p
  }
  async #offer(s,id) {
    await this.#context(s);if(!this.#valid(s))return
    this.#close(s,id);const nonce=crypto.randomUUID();if(!s.native.beginOffer(id,nonce,Date.now()))return
    const p=this.#peer(s,id);p.nonce=nonce;this.#pending(s);this.#channel(s,p,p.pc.createDataChannel('inhouse-read-room-v1',{ordered:true}));this.#channel(s,p,p.pc.createDataChannel('inhouse-read-interactive-v1',{ordered:true}))
    await p.pc.setLocalDescription(await p.pc.createOffer());await this.#ice(s,p)
    if(this.#validPeer(s,p)){await this.#signal(s,id,p.pc.localDescription,nonce)}
  }
  #ice(s,p){if(p.pc.iceGatheringState==='complete')return Promise.resolve();return new Promise(resolve=>{const done=()=>{clearTimeout(timer);p.pc.removeEventListener('icegatheringstatechange',changed);resolve()};const changed=()=>{if(p.pc.iceGatheringState==='complete')done()};const timer=setTimeout(done,1200);p.pc.addEventListener('icegatheringstatechange',changed)})}
  #channel(s,p,channel) {
    if(channel.label==='inhouse-read-interactive-v1'){this.#interactive(s,p,channel);return}
    if(channel.label!=='inhouse-read-room-v1'){channel.close();return}
    p.channel=channel;channel.binaryType='arraybuffer';channel.bufferedAmountLowThreshold=65536
    channel.onopen=()=>{if(!this.#validPeer(s,p))return;p.open=true;p.lastReceived=performance.now();if(p.interactive?.readyState==='open')s.native.connected(p.id);this.#send(p,s.native.latest);this.#health(s,p)}
    channel.onclose=()=>{if(this.#validPeer(s,p))this.#failed(s,p.id)}
    channel.onbufferedamountlow=()=>this.#pump(p)
    channel.onmessage=async e=>{
      if(!this.#validPeer(s,p))return
      try{
        p.lastReceived=performance.now();
        const assembled=p.stream.receive(typeof e.data==='string'?e.data:new Uint8Array(e.data))
        if(assembled){const encoded=text.decode(assembled),packet=s.native.receive(encoded);if(packet?.snapshot){s.tabs?.postMessage({t:'snapshot',from:s.own,packet:encoded});await this.#accept(s,packet)}}
      }catch{if(this.#validPeer(s,p))this.#failed(s,p.id)}
    }
  }
  #interactive(s,p,c) {
    p.interactive=c;c.bufferedAmountLowThreshold=32768
    c.onopen=()=>{if(this.#validPeer(s,p)){if(p.open)s.native.connected(p.id);this.#flushMotion(p)}}
    c.onbufferedamountlow=()=>this.#flushMotion(p)
    c.onclose=()=>{if(p.interactive===c){p.interactive=null;if(this.#validPeer(s,p))this.#failed(s,p.id)}}
    c.onmessage=e=>{
      if(!this.#validPeer(s,p)||typeof e.data!=='string'||e.data.length>98304)return
      try{
        const wire=JSON.parse(e.data);p.lastReceived=performance.now()
        if(wire.t==='ping'){if(c.readyState==='open')c.send(JSON.stringify({t:'pong',at:wire.at}));return}
        if(wire.t==='pong')return
        const packet=s.native.receiveMotion(e.data);if(packet){this.#motion(s.account,packet);s.tabs?.postMessage({t:'motion',from:s.own,packet:e.data});for(const other of s.peers.values())if(other!==p&&other.id!==packet.from)this.#sendMotion(other,e.data)}
      }catch{}
    }
  }
  #health(s,p) {
    if(!this.#validPeer(s,p)||!p.open)return
    if(performance.now()-p.lastReceived>12000 || (p.interactive?.readyState!=='open' && performance.now()-p.healthAt>12000)){this.#failed(s,p.id);return}
    if(p.interactive?.readyState==='open')try{p.interactive.send(JSON.stringify({t:'ping',at:Date.now()}))}catch{}
    this.#timer(s,()=>this.#health(s,p),2000)
  }
  #sendMotion(p,packet){p.motion=packet;this.#flushMotion(p)}
  #flushMotion(p){const c=p.interactive;if(c?.readyState!=='open'||!p.motion||c.bufferedAmount>32768)return
    try{c.send(p.motion);p.motion=null}catch{}
  }
  #send(p,packet){if(!packet)return;const data=typeof packet==='string'?bytes.encode(packet):packet
    if(p.stream.queue(data))this.#pump(p)
  }
  #pump(p){const c=p.channel;if(c?.readyState!=='open')return
    try{while(c.bufferedAmount<131072){const part=p.stream.next();if(part===undefined)return;c.send(part)}}catch{c.close()}
  }
  #failed(s,id){if(!this.#valid(s))return;this.#close(s,id);s.native.failed(id,Date.now());this.#scheduleState(s)}
  #close(s,id){const p=s.peers.get(id);if(!p)return;s.peers.delete(id);delete s.signals[id];clearTimeout(p.iceTimer);p.interactive?.close();p.channel?.close();p.pc.close();p.stream.free();this.#disconnected(id)}
  resume(){const desired=this.#desired;if(desired&&!this.#session&&this.#enabled())return this.publish(desired.account,desired.snapshot).catch(()=>{})}
  suspend(){this.#stop()}
  pause(){this.#desired=null;this.#stop()}
  #stop(){const s=this.#session;this.#session=null;this.#epoch++;if(!s)return;s.tabs?.close();this.#disconnected('');for(const timer of s.timers)clearTimeout(timer);for(const id of s.peers.keys())this.#close(s,id);s.native?.free()}
  destroy(){this.pause();globalThis.removeEventListener('inhouse-drive-live-peers',this.#onPeers)}
}
