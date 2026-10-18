import {describe,it,expect} from 'vitest'
import {rustUI as ui} from './helpers/rust-ui-ready.js'
const stamp=(value,at=10)=>({value,at,device:'device-a'})
const snapshot=(value='Title')=>({schemaVersion:1,books:[{driveFileId:'drive-1',fields:{title:stamp(value)}}],settings:{}})
const packet=(s,extra={})=>JSON.stringify({v:1,account:'account',from:'peer-b',id:'packet-0000000001',snapshot:s,...extra})
describe('native direct-room protocol',()=>{
 it('guards accounts, schema, identities and malformed packets',()=>{
  const room=new ui.RustLiveRoom('account','peer-a')
  for(const p of ['{',packet(snapshot(),{account:'other'}),packet(snapshot(),{from:'peer-a'}),packet(snapshot(),{id:'../x'}),packet({...snapshot(),schemaVersion:2}),packet({schemaVersion:1,books:{},settings:{}}),packet({schemaVersion:1,books:[{driveFileId:'__proto__',fields:{}}]})])expect(room.receive(p)).toBeNull()
  expect(room.receive(packet(snapshot()))?.snapshot).toEqual(snapshot());expect(room.receive(packet(snapshot()))).toMatchObject({duplicate:true});room.free()
 })
 it('deduplicates canonical books/fields while retaining the latest reconnect packet',()=>{
  const room=new ui.RustLiveRoom('account','peer-a'),s=snapshot('Árbol 🌳')
  expect(typeof room.publish(s,'one')).toBe('string');expect(room.publish(structuredClone(s),'two')).toBeNull();expect(JSON.parse(room.latest).id).toBe('two')
  expect(room.publish(snapshot('Next'),'three')).toBeTruthy();room.free()
 })
 it('bounds packets and duplicate memory',()=>{
  const room=new ui.RustLiveRoom('account','peer-a')
  expect(room.publish(snapshot('x'.repeat(2*1024*1024)),'large')).toBeNull()
  for(let i=0;i<130;i++)expect(room.receive(packet(snapshot(),{id:`packet-${i}`}))?.snapshot).toBeTruthy()
  expect(room.receive(packet(snapshot(),{id:'packet-129'}))).toMatchObject({duplicate:true});expect(room.receive(packet(snapshot(),{id:'packet-0'}))?.snapshot).toBeTruthy();room.free()
 })
 it('deterministically elects the offerer, rejects stale SDP and times out negotiation',()=>{
  const a=new ui.RustLiveRoom('account','peer-a'),b=new ui.RustLiveRoom('account','peer-b'),now=Date.now(),file=peer=>({id:'file',name:`live-v1-${peer}.json`,modifiedTime:new Date(now).toISOString()})
  expect(a.observe([file('peer-b')],now).map(v=>v[0])).toEqual(['read','offer']);expect(b.observe([file('peer-a')],now).map(v=>v[0])).toEqual(['read'])
  expect(a.beginOffer('peer-b','nonce-0000000000001',now)).toBe(true);expect(b.beginOffer('peer-a','nonce-0000000000001',now)).toBe(false)
  const signal={account:'account',from:'peer-a',to:'peer-b',nonce:'nonce-0000000000001',at:now,type:'offer',sdp:'v=0\r\n'}
  expect(b.signal('peer-a',{...signal,at:now-120001},now)).toBeNull();expect(b.signal('peer-a',signal,now)).toEqual(signal);expect(b.signal('peer-a',signal,now)).toBeNull()
  expect(a.signal('peer-b',{...signal,from:'peer-b',to:'peer-a',type:'answer',nonce:'different-000000000'},now)).toBeNull()
  expect(a.pending(now+12001)[0][0]).toBe('close');a.free();b.free()
 })
 it('merges checkpoints monotonically and rejects prototype names',()=>{
  const a={books:{file:{title:stamp('old',1),author:stamp('A')}},settings:{theme:stamp('light',1)}}
  const b={books:{file:{title:stamp('new',2)}},settings:{theme:stamp('dark',2)}}
  const merged=ui.library_merge_checkpoint(a,b);expect(merged.books.file).toEqual({title:stamp('new',2),author:stamp('A')});expect(merged.settings.theme.value).toBe('dark');expect(ui.library_merge_checkpoint(b,a)).toEqual(merged)
 })
})
it('discovers recent sessions beyond old mailboxes and prioritizes the newest bounded peers',()=>{
 const room=new ui.RustLiveRoom('account','peer-a'),now=Date.now();
 const files=Array.from({length:90},(_,i)=>({id:'old-'+i,name:`live-v1-old-peer-${i}.json`,modifiedTime:new Date(now-1000000).toISOString()}));
 files.push({id:'active',name:'live-v1-peer-b.json',modifiedTime:new Date(now).toISOString()});
 expect(room.observe(files,now)).toEqual([['read','peer-b','active'],['offer','peer-b','active']]);room.free();
})
it('validates encrypted relay envelopes with the same account, source, expiry and sequence guards as RTC',()=>{
 const a=new ui.RustLiveRoom('account','peer-a'),b=new ui.RustLiveRoom('account','peer-b'),now=Date.now();
 b.observe([{id:'file',name:'live-v1-peer-a.json',modifiedTime:new Date(now).toISOString()}],now);
 const packet=a.publishMotion({gesture:'held',sequence:1,phase:'frame',shelfType:'walnut',poses:[['book:drive:a',0,.1,.1,0,0,0,0,1,1]]});
 expect(b.peerCount).toBe(1);expect(b.connectedCount).toBe(0);
 for(const [id,envelope,time] of [['peer-z',{at:now,packet},now],['peer-a',{at:now-6001,packet},now],['peer-a',{at:now,packet},NaN],['peer-a',{at:now,packet:packet.replace('peer-a','peer-z')},now]])expect(b.receiveRelay(id,envelope,time)).toBeNull();
 expect(b.receiveRelay('peer-a',{at:now,packet},now)).toMatchObject({gesture:'held',from:'peer-a'});
 expect(b.receiveMotion(packet)).toBeNull();expect(b.receiveRelay('peer-a',{at:now,packet},now)).toBeNull();a.free();b.free();
})
it('retries an unchanged mailbox after a transient read failure',()=>{
 const room=new ui.RustLiveRoom('account','peer-z'),now=Date.now(),files=[{id:'file',name:'live-v1-peer-a.json',modifiedTime:new Date(now).toISOString()}]
 expect(room.observe(files,now)).toHaveLength(1);expect(room.observe(files,now+1)).toEqual([])
 room.readFailed('peer-a');expect(room.observe(files,now+2)).toEqual([['read','peer-a','file']]);room.free()
})
it('recovers failed negotiations promptly with bounded retry delay',()=>{
 const room=new ui.RustLiveRoom('account','peer-a'),now=Date.now(),files=[{id:'file',name:'live-v1-peer-z.json',modifiedTime:new Date(now).toISOString()}]
 room.observe(files,now);room.failed('peer-z',now)
 expect(room.observe(files,now+1999)).toEqual([])
 expect(room.observe(files,now+2000).map(a=>a[0])).toContain('offer')
 for(let i=0;i<12;i++)room.failed('peer-z',now)
 expect(room.observe(files,now+15000).map(a=>a[0])).toContain('offer');room.free()
})
it('accepts authenticated state fallback for lamps and progress and allows retry after application failure',()=>{
 const room=new ui.RustLiveRoom('account','peer-z'),now=Date.now()
 room.observe([{id:'file',name:'live-v1-peer-b.json',modifiedTime:new Date(now).toISOString()}],now)
 const value=snapshot();value.settings['inhouse-read-shelf-lamps']=stamp('[{"key":"lamp:one","isOn":false}]')
 const envelope={packet:packet(value)}
 expect(room.receiveStateRelay('unknown',envelope)).toBeNull()
 expect(room.receiveStateRelay('peer-b',{packet:packet(value,{from:'other'})})).toBeNull()
 expect(room.receiveStateRelay('peer-b',envelope)?.snapshot).toEqual(value)
 expect(room.receiveStateRelay('peer-b',envelope)).toMatchObject({duplicate:true})
 room.forgetSnapshot('packet-0000000001')
 expect(room.receiveStateRelay('peer-b',envelope)?.snapshot).toEqual(value);room.free()
})
it('uses only the newest mailbox for a peer after older clients created duplicates',()=>{
 const room=new ui.RustLiveRoom('account','peer-z'),now=Date.now()
 const file=(id,delta)=>({id,name:'live-v1-peer-a.json',modifiedTime:new Date(now-delta).toISOString()})
 expect(room.observe([file('old',500),file('new',0),file('older',1000)],now)).toEqual([['read','peer-a','new']])
 expect(room.observe([file('old',500),file('new',0),file('older',1000)],now+1)).toEqual([]);room.free()
})
it('still expires an offline peer after a mailbox read fails',()=>{
 const room=new ui.RustLiveRoom('account','peer-z'),now=Date.now()
 room.observe([{id:'file',name:'live-v1-peer-a.json',modifiedTime:new Date(now).toISOString()}],now)
 room.readFailed('peer-a')
 expect(room.observe([],now+90001)).toEqual([['close','peer-a',null]])
 expect(room.peerCount).toBe(0);room.free()
})
