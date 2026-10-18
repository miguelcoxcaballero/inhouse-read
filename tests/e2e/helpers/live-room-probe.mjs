const relay=process.env.IHR_TEST_TURN_URL?{urls:process.env.IHR_TEST_TURN_URL,username:'room-test',credential:'local-fixture-only'}:null;
export async function roomProbe(page){
 await page.addInitScript(relay=>{
  if(!/^https?:$/.test(location.protocol))return;
  globalThis.__roomSavedTrace=[];
  const put=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){
   if(key==='inhouse-read-shelf-physics-v1')try{const v=JSON.parse(value);__roomSavedTrace.push({at:Date.now(),portable:v[1]?.[0]===20261018,rows:v[2]});if(__roomSavedTrace.length>24)__roomSavedTrace.shift()}catch{}
   return put.call(this,key,value);
  };
  const Native=RTCPeerConnection;globalThis.__roomChannels=[];globalThis.__roomPeers=[];globalThis.__roomMotionPackets=[];globalThis.__roomSentMotions=[];
  const watch=c=>{
   const record=(target,data)=>{if(typeof data!=='string')return;try{const value=JSON.parse(data);if(value.t==='room-motion'){target.push({at:Date.now(),value});if(target.length>256)target.shift()}}catch{}};
   c.addEventListener('message',e=>record(globalThis.__roomMotionPackets,e.data));const send=c.send.bind(c);c.send=data=>{record(globalThis.__roomSentMotions,data);return send(data)};return c;
  };
  globalThis.RTCPeerConnection=class extends Native{
   constructor(...args){super(...(relay?[{...args[0],iceServers:[relay],iceTransportPolicy:'relay'}]:args));globalThis.__roomPeers.push(this);this.addEventListener('datachannel',e=>globalThis.__roomChannels.push(watch(e.channel)))}
   createDataChannel(...args){const c=super.createDataChannel(...args);globalThis.__roomChannels.push(watch(c));return c}
  }
 },relay)
}
