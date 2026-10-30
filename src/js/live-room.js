import {cloudModule} from './cloud-native.js'
import {getDriveLiveContext,readDriveLiveMailbox,writeDriveLiveMailbox,readDriveLibraryRevision,readDriveLiveState,writeDriveLiveState} from './drive-client.js'

// Browser-owned RTC and WebCrypto handles; identity, negotiation, deduplication
// and field registers live in Rust. Drive carries encrypted rendezvous and a
// bounded motion/state fallback when a direct network route is unavailable.
// One identity per JavaScript realm: duplicated tabs clone sessionStorage.
const realmPeer=crypto.randomUUID()
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
    // Rust owns pending/in-flight queues, retry cadence, stale-owner checks, crypto,
    // text codecs and clocks. These functions expose session state, timers, RTC events and Drive I/O.
    this.#transport={
      enabled:()=>this.#enabled(),session:()=>this.#session,setSession:s=>{this.#session=s},
      desired:()=>this.#desired,publish:(account,snapshot)=>this.publish(account,snapshot),setDesired:desired=>{this.#desired=desired},epoch:()=>this.#epoch,setEpoch:epoch=>{this.#epoch=epoch},stop:()=>this.#stop(),start:s=>this.#start(s),
      motionClock:()=>this.#motionClock,setMotionClock:value=>{this.#motionClock=value},
      openTabs:(s,name)=>{s.tabs=new BroadcastChannel(name);s.tabs.onmessage=({data})=>s.ui.live_transport_tabs_message(s,data,this.#transport)},
      // One registered session timer per call; Rust picks the work by kind when it fires.
      arm:(s,delay,kind,p)=>this.#timer(s,()=>s.ui.live_transport_fire(s,kind,p,this.#transport),delay),
      armIceSignal:(s,p,delay)=>setTimeout(()=>s.ui.live_transport_peer_event(s,p,'signal',this.#transport),delay),
      valid:s=>this.#valid(s),mailboxes:this.#mailboxes,stateFiles:this.#stateFiles,
      writeMailbox:writeDriveLiveMailbox,writeState:writeDriveLiveState,readRevision:readDriveLibraryRevision,
      getContext:getDriveLiveContext,readState:readDriveLiveState,readMailbox:readDriveLiveMailbox,
      motion:(account,packet)=>this.#motion(account,packet),disconnected:id=>this.#disconnected(id),
      peer:(s,id)=>this.#peer(s,id),bindChannel:(s,p,c)=>this.#channel(s,p,c),ice:(p,delay)=>this.#ice(p,delay),
      receive:(account,snapshot)=>this.#receive(account,snapshot)
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
  publishMotion(account,frame){return this.#ui?.live_transport_publish_motion(account,frame,this.#transport)}
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
  #peer(s,id) {
    const p=s.ui.live_transport_open_peer(s,id,this.#transport),pc=p.pc
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
  resume(){if(this.#ui)return this.#ui.live_transport_resume(this.#transport);const desired=this.#desired;if(desired&&!this.#session&&this.#enabled())return this.publish(desired.account,desired.snapshot).catch(()=>{})}
  suspend(){this.#stop()}
  pause(){if(this.#ui)return this.#ui.live_transport_pause(this.#transport);this.#desired=null;this.#stop()}
  #stop(){if(this.#ui)return this.#ui.live_transport_stop(this.#transport);const s=this.#session;this.#session=null;this.#epoch++;if(!s)return;s.tabs?.close();this.#disconnected('');for(const timer of s.timers)clearTimeout(timer);for(const id of s.peers.keys())s.ui.live_transport_close(s,id,this.#transport);s.native?.free()}
  destroy(){this.pause();globalThis.removeEventListener('inhouse-drive-live-peers',this.#onPeers)}
}
