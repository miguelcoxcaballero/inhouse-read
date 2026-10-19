import {cloudModule} from './cloud-native.js'
import {getDriveLiveContext,readDriveLiveMailbox,writeDriveLiveMailbox,readDriveLibraryRevision,readDriveLiveState,writeDriveLiveState} from './drive-client.js'

// Browser-owned RTC and WebCrypto handles; identity, negotiation, deduplication
// and field registers live in Rust. Drive carries encrypted rendezvous and a
// bounded motion/state fallback when a direct network route is unavailable.
// One identity per JavaScript realm: duplicated tabs clone sessionStorage.
const realmPeer=crypto.randomUUID()
const bytes=new TextEncoder(), text=new TextDecoder()
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
  #transport
  #ui=null
  constructor({receive,receiveMotion=()=>{},disconnected=()=>{},enabled=()=>!document.hidden}) {
    this.#receive=receive;this.#motion=receiveMotion;this.#disconnected=disconnected;this.#enabled=enabled
    // Rust owns pending/in-flight queues, retry cadence and stale-owner checks.
    // These functions only expose browser crypto, timers and Drive I/O.
    this.#transport={
      enabled:()=>this.#enabled(),cryptoAvailable:()=>Boolean(crypto.subtle),session:()=>this.#session,setSession:s=>{this.#session=s},
      desired:()=>this.#desired,publish:(account,snapshot)=>this.publish(account,snapshot),setDesired:desired=>{this.#desired=desired},epoch:()=>this.#epoch,setEpoch:epoch=>{this.#epoch=epoch},stop:()=>this.#stop(),start:s=>this.#start(s),
      motionClock:()=>this.#motionClock,setMotionClock:value=>{this.#motionClock=value},newRoom:(account,own)=>new this.#ui.RustLiveRoom(account,own),
      tabsAvailable:()=>Boolean(globalThis.BroadcastChannel),hashAccount:account=>crypto.subtle.digest('SHA-256',bytes.encode(account)),
      openTabs:(s,name)=>{s.tabs=new BroadcastChannel(name);s.tabs.onmessage=({data})=>s.ui.live_transport_tabs_message(s,data,this.#transport)},
      armMotion:(s,delay)=>this.#timer(s,()=>s.ui.live_transport_motion_heartbeat(s,this.#transport),delay),
      armTabRequest:(s,delay)=>this.#timer(s,()=>s.ui.live_transport_request_tabs(s),delay),
      armHeartbeat:(s,delay)=>this.#timer(s,()=>s.ui.live_transport_heartbeat(s,this.#transport,true),delay),
      armStart:(s,delay)=>this.#timer(s,()=>{s.ready=this.#start(s)},delay),
      valid:s=>this.#valid(s),now:()=>Date.now(),clock:()=>performance.now(),utf8:data=>bytes.encode(data),randomId:()=>crypto.randomUUID(),encode:data=>this.#ui.live_transport_base64(data),
      mailboxes:this.#mailboxes,stateFiles:this.#stateFiles,
      writeMailbox:writeDriveLiveMailbox,writeState:writeDriveLiveState,readRevision:readDriveLibraryRevision,
      getContext:getDriveLiveContext,readState:readDriveLiveState,readMailbox:readDriveLiveMailbox,
      motion:(account,packet)=>this.#motion(account,packet),disconnected:id=>this.#disconnected(id),cancelTimer:id=>clearTimeout(id),
      armPending:(s,delay)=>this.#timer(s,()=>s.ui.live_transport_pending(s,this.#transport,true),delay),
      armDisconnected:(s,p,delay)=>this.#timer(s,()=>s.ui.live_transport_peer_event(s,p,'disconnected',this.#transport),delay),
      armIceSignal:(s,p,delay)=>setTimeout(()=>s.ui.live_transport_peer_event(s,p,'signal',this.#transport),delay),
      failed:(s,id)=>this.#failed(s,id),closePeer:(s,id)=>this.#close(s,id),peer:(s,id)=>this.#peer(s,id),pending:s=>this.#pending(s),
      bindChannel:(s,p,c)=>this.#channel(s,p,c),ice:(p,delay)=>this.#ice(p,delay),
      armHealth:(s,p,delay)=>this.#timer(s,()=>this.#health(s,p),delay),
      receive:(account,snapshot)=>this.#receive(account,snapshot),decode:data=>text.decode(data),
      decrypt:(s,encrypted)=>this.#decrypt(s,encrypted),
      importKey:context=>crypto.subtle.importKey('raw',un64(context.key.replaceAll('-','+').replaceAll('_','/')),'AES-GCM',false,['encrypt','decrypt']),
      write:s=>this.#write(s),
      armState:(s,delay)=>this.#timer(s,()=>this.#stateRelay(s),delay),
      armRelay:(s,delay)=>this.#timer(s,()=>this.#relay(s),delay),
      armDiscovery:(s,delay)=>this.#timer(s,()=>this.#discover(s),delay),
      encrypt:async(s,plain)=>{const iv=crypto.getRandomValues(new Uint8Array(12));
        const data=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:bytes.encode(s.account)},s.key,bytes.encode(plain));return{iv,data}}
    }
    this.#onPeers=e=>{const s=this.#session;s?.ui?.live_transport_observe(s,e.detail,this.#transport)}
    globalThis.addEventListener('inhouse-drive-live-peers',this.#onPeers)
  }
  async publish(account,snapshot) {
    if(this.#ui)return this.#ui.live_transport_publish(account,snapshot,this.#transport)
    // Bootstrap-only fallback: Rust cannot govern its own module loading.
    if(!account||!this.#enabled()||!crypto.subtle)return
    this.#desired={account,snapshot}
    let s=this.#session
    if(s?.account!==account){this.suspend();s={account,epoch:this.#epoch,peers:new Map(),signals:{},file:null,latest:snapshot,timers:new Set()};this.#session=s;s.ready=this.#start(s)}
    s.latest=snapshot
    await s.ready
    if(this.#valid(s)&&s.native)this.#publishNow(s)
  }
  #publishNow(s){return s.ui.live_transport_publish_now(s,this.#transport)}
  #stateRelay(s){return s.ui.live_transport_state_relay(s,this.#transport)}
  publishMotion(account,frame){return this.#ui?.live_transport_publish_motion(account,frame,this.#transport)}
  #relay(s){return s.ui.live_transport_relay(s,this.#transport)}
  #valid(s){return this.#ui?this.#ui.live_transport_is_valid(s,this.#transport):this.#session===s&&s.epoch===this.#epoch&&this.#enabled()}
  #timer(s,fn,ms){const t=setTimeout(()=>{if(s.ui)s.ui.live_transport_timer_fired(s,t,fn,this.#transport);else{s.timers.delete(t);if(this.#valid(s))fn()}},ms);s.timers.add(t);return t}
  async #start(s) {
    try{
      const ui=s.ui||await cloudModule();if(!this.#valid(s))return
      this.#ui=ui;s.ui=ui;return ui.live_transport_start(s,realmPeer,this.#transport)
    }catch{
      // Only a failed WASM import reaches this path; once loaded, Rust owns
      // context/channel/bootstrap retries and their cancellation decisions.
      if(this.#valid(s)){s.initFailures=(s.initFailures||0)+1;this.#timer(s,()=>{s.ready=this.#start(s)},Math.min(15000,1000*2**Math.min(s.initFailures,4)))}
    }
  }
  #discover(s){return s.ui.live_transport_discover(s,this.#transport)}
  #write(s){return s.ui.live_transport_write(s,this.#transport)}
  #pending(s){return s.ui.live_transport_pending(s,this.#transport,false)}
  #decrypt(s,e){return crypto.subtle.decrypt({name:'AES-GCM',iv:un64(e.iv),additionalData:bytes.encode(s.account)},s.key,un64(e.data))}
  #peer(s,id) {
    const pc=new RTCPeerConnection({iceServers:[{urls:['stun:stun.l.google.com:19302','stun:stun1.l.google.com:19302']}],iceCandidatePoolSize:0,bundlePolicy:'max-bundle',rtcpMuxPolicy:'require'}),p=s.ui.live_transport_new_peer(s,id,pc,new s.ui.RustRoomPacketStream(),this.#transport)
    pc.ondatachannel=e=>this.#channel(s,p,e.channel)
    pc.onconnectionstatechange=()=>s.ui.live_transport_peer_event(s,p,'connection',this.#transport)
    pc.onicecandidate=()=>s.ui.live_transport_peer_event(s,p,'ice',this.#transport)
    return p
  }
  #ice(p,delay){if(p.pc.iceGatheringState==='complete')return Promise.resolve();return new Promise(resolve=>{const done=()=>{clearTimeout(timer);p.pc.removeEventListener('icegatheringstatechange',changed);resolve()};const changed=()=>{if(p.pc.iceGatheringState==='complete')done()};const timer=setTimeout(done,delay);p.pc.addEventListener('icegatheringstatechange',changed)})}
  #channel(s,p,c) {
    const kind=s.ui.live_transport_bind_channel(p,c);if(!kind)return
    c.onopen=()=>s.ui.live_transport_channel_event(s,p,c,kind,'open',this.#transport)
    c.onclose=()=>s.ui.live_transport_channel_event(s,p,c,kind,'close',this.#transport)
    c.onbufferedamountlow=()=>s.ui.live_transport_channel_event(s,p,c,kind,'low',this.#transport)
    c.onmessage=e=>kind==='interactive'
      ?s.ui.live_transport_interactive_message(s,p,c,e.data,this.#transport)
      :s.ui.live_transport_room_message(s,p,e.data,this.#transport)
  }
  #health(s,p){return s.ui.live_transport_health(s,p,this.#transport)}
  #failed(s,id){return s.ui.live_transport_failed(s,id,this.#transport)}
  #close(s,id){return s.ui.live_transport_close(s,id,this.#transport)}
  resume(){if(this.#ui)return this.#ui.live_transport_resume(this.#transport);const desired=this.#desired;if(desired&&!this.#session&&this.#enabled())return this.publish(desired.account,desired.snapshot).catch(()=>{})}
  suspend(){this.#stop()}
  pause(){if(this.#ui)return this.#ui.live_transport_pause(this.#transport);this.#desired=null;this.#stop()}
  #stop(){if(this.#ui)return this.#ui.live_transport_stop(this.#transport);const s=this.#session;this.#session=null;this.#epoch++;if(!s)return;s.tabs?.close();this.#disconnected('');for(const timer of s.timers)clearTimeout(timer);for(const id of s.peers.keys())this.#close(s,id);s.native?.free()}
  destroy(){this.pause();globalThis.removeEventListener('inhouse-drive-live-peers',this.#onPeers)}
}
