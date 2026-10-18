import {describe,it,expect} from 'vitest'
import {rustUI as ui} from './helpers/rust-ui-ready.js'
const pose=(x=0,q=[0,0,0,1])=>['book:drive:one',1,x,.1,.02,...q,1]
const frame=(extra={})=>({from:'peer-b',gesture:'gesture-one',sequence:1,phase:'frame',shelfType:'baggebo',poses:[pose()],...extra})
describe('Rust live room gesture previews',()=>{
 it('transports only bounded, account-scoped physical poses',()=>{
  const a=new ui.RustLiveRoom('account','peer-a'),b=new ui.RustLiveRoom('account','peer-b')
  const packet=a.publishMotion(frame());expect(b.receiveMotion(packet)).toMatchObject({from:'peer-a',poses:[pose()]})
  expect(a.receiveMotion(packet)).toBeNull();expect(new ui.RustLiveRoom('other','peer-c').receiveMotion(packet)).toBeNull()
  for(const value of [frame({poses:[pose(Infinity)]}),frame({poses:[pose(0,[0,0,0,0])]}),frame({poses:[pose(),pose()]}),frame({poses:Array(513).fill(pose())}),frame({sequence:-1}),frame({phase:'save'})])expect(a.publishMotion(value)).toBeNull()
  a.free();b.free()
 })
 it('interpolates positions in physical bays without persisting or simulating them',()=>{
  const room=new ui.RustRoomMotion(),out=new Float64Array(9)
  expect(room.receive(frame(),100)).toBe(true);expect(room.pose('book:drive:one',100,out)).toBe(true);expect([...out]).toEqual([1,0,.1,.02,0,0,0,1,1])
  expect(room.receive(frame({sequence:2,poses:[pose(.2)]}),200)).toBe(true)
  room.pose('book:drive:one',232.5,out);expect(out[1]).toBeCloseTo(.1);expect(room.moving(232.5)).toBe(true)
  room.pose('book:drive:one',265,out);expect(out[1]).toBe(.2);expect(room.moving(265)).toBe(false);room.free()
 })
 it('rejects out-of-order and post-final frames, expires abandoned gestures and releases peers',()=>{
  const room=new ui.RustRoomMotion(),out=new Float64Array(9)
  expect(room.receive(frame({sequence:3}),0)).toBe(true)
  expect(room.receive(frame({sequence:2}),10)).toBe(false)
  expect(room.receive(frame({sequence:4,phase:'end'}),20)).toBe(true)
  expect(room.receive(frame({sequence:5}),30)).toBe(false)
  expect(room.active(5021)).toBe(false);expect(room.pose('book:drive:one',5021,out)).toBe(false)
  expect(room.receive(frame({gesture:'new',sequence:6}),6000)).toBe(true);room.clear('peer-b');expect(room.active(6001)).toBe(false);room.free()
 })
 it('uses a shortest quaternion arc and handles cancelled gestures',()=>{
  const room=new ui.RustRoomMotion(),out=new Float64Array(9)
  room.receive(frame(),0);room.receive(frame({sequence:2,poses:[pose(.2,[0,0,0,-1])]}),100)
  room.pose('book:drive:one',132.5,out);expect(out[7]).toBeCloseTo(1);expect(out.every(Number.isFinite)).toBe(true)
  room.receive(frame({sequence:3,phase:'cancel',poses:[]}),150);expect(room.active(151)).toBe(false);room.free()
 })
 it('bounds active actors but reclaims expired identities',()=>{
  const room=new ui.RustRoomMotion()
  for(let i=0;i<8;i++)expect(room.receive(frame({from:'peer-'+i}),0)).toBe(true)
  expect(room.receive(frame({from:'peer-nine'}),0)).toBe(false)
  expect(room.receive(frame({from:'peer-nine'}),4000)).toBe(true);room.free()
 })
})

describe('closing a reader with a newer remote position',()=>{
 it('tracks local commits and restored anchors rather than the remotely merged database record',()=>{
  const guard=new ui.RustReaderPositionGuard(),position={fraction:.75,locator:{kind:'pdf-page',value:3,textOffset:10}}
  expect(guard.changed('book',position)).toBe(true);guard.remember('book',position);expect(guard.changed('book',position)).toBe(false)
  // Receiving page two changes storage, not the last position of this local reader.
  expect(guard.changed('book',{fraction:.5,locator:{kind:'pdf-page',value:2}})).toBe(true)
  expect(guard.changed('book',position)).toBe(false);guard.free()
 })
 it('does not allow old gestures through a different gesture id',()=>{
  const room=new ui.RustRoomMotion();room.receive(frame({sequence:9,gesture:'new'}),100)
  expect(room.receive(frame({sequence:8,gesture:'old'}),101)).toBe(false);room.free()
 })
})

it('keeps remote gesture ownership through a motionless lease and releases it at the final pose',()=>{
 const room=new ui.RustRoomMotion();room.receive(frame(),0);expect(room.gesturing(1000)).toBe(true)
 room.receive(frame({sequence:2}),3000);expect(room.changed).toBe(false);expect(room.gesturing(4000)).toBe(true)
 room.receive(frame({sequence:3,phase:'end'}),4500);expect(room.gesturing(4501)).toBe(false);expect(room.active(4501)).toBe(true);room.free()
})

it('bridges a committed room in physical coordinates without mutating its target or leaking animation',()=>{
 const bridge=new ui.RustRoomTransition(),target=Float64Array.of(.4,.1,0,0,0,1,0,1),out=new Float64Array(8)
 bridge.begin([['book:drive:a',.2,.1,0,0,0,0,1,1]],100)
 expect(bridge.pose('book:drive:a',target,100,out)).toBe(true);expect(out[0]).toBeCloseTo(.2)
 expect(bridge.pose('book:drive:a',target,220,out)).toBe(true);expect(out[0]).toBeCloseTo(.3)
 expect(Math.hypot(...out.slice(3,7))).toBeCloseTo(1)
 expect(target[0]).toBe(.4);expect(bridge.pose('missing',target,220,out)).toBe(false)
 expect(bridge.pose('book:drive:a',target,340,out)).toBe(false);expect(bridge.moving(340)).toBe(false)
 bridge.begin([['book:drive:a',NaN,0,0,0,0,0,1,1]],400);expect(bridge.moving(400)).toBe(false);bridge.free()
})

it('keeps a v2 final pose until its physical commit is applied, even after a long backup delay',()=>{
 const room=new ui.RustRoomMotion(),out=new Float64Array(9)
 room.acknowledge('room-base')
 expect(room.receive(frame({base:'room-base'}),0)).toBe(true)
 expect(room.receive(frame({base:'room-base',commit:'room-final',sequence:2,phase:'end',poses:[pose(.23)]}),100)).toBe(true)
 expect(room.pose('book:drive:one',20000,out)).toBe(true);expect(out[1]).toBe(.23)
 expect(room.gesturing(20000)).toBe(false);expect(room.moving(20000)).toBe(false)
 room.acknowledge('room-final');expect(room.active(20001)).toBe(false)
 expect(room.receive(frame({base:'room-base',sequence:3}),20002)).toBe(false);room.free()
})
it('fences late frames when the durable commit arrives first and ignores unrelated state refreshes',()=>{
 const room=new ui.RustRoomMotion(),out=new Float64Array(9)
 room.acknowledge('room-base');room.receive(frame({base:'room-base'}),0)
 room.acknowledge('room-base');expect(room.pose('book:drive:one',20,out)).toBe(true)
 room.acknowledge('room-final');expect(room.active(30)).toBe(false)
 expect(room.receive(frame({base:'room-base',commit:'room-final',sequence:2,phase:'end'}),40)).toBe(false)
 expect(room.receive(frame({base:'room-final',gesture:'next',sequence:3}),50)).toBe(true);room.free()
})
it('retains sequence fences after expiry instead of resurrecting an abandoned gesture',()=>{
 const room=new ui.RustRoomMotion();room.receive(frame({sequence:9}),0)
 expect(room.receive(frame({sequence:8}),5000)).toBe(false)
 expect(room.receive(frame({gesture:'new',sequence:10}),5001)).toBe(true);room.free()
})

it('finishes a careful put-back at the unchanged physical revision without holding a ghost lift',()=>{
 const room=new ui.RustRoomMotion();room.acknowledge('room-base')
 room.receive(frame({base:'room-base'}),0)
 expect(room.receive(frame({base:'room-base',commit:'room-base',phase:'end',sequence:2}),200)).toBe(true)
 expect(room.active(201)).toBe(false);room.free()
})
it('retains a committed end preview during disconnect, while explicit local takeover can clear it',()=>{
 const room=new ui.RustRoomMotion();room.acknowledge('room-base')
 room.receive(frame({base:'room-base',commit:'room-final',phase:'end'}),0)
 room.clear('peer-b');expect(room.active(20000)).toBe(true)
 room.clear('');expect(room.active(20001)).toBe(false);room.free()
})
it('converges simultaneous previews to the installed physical revision and fences the losing branch',()=>{
 const room=new ui.RustRoomMotion();room.acknowledge('room-base')
 room.receive(frame({base:'room-base',from:'peer-a'}),0)
 room.receive(frame({base:'room-base',from:'peer-b',poses:[pose(.3)]}),1)
 room.acknowledge('room-winner');expect(room.active(100)).toBe(false)
 expect(room.receive(frame({base:'room-base',commit:'room-loser',sequence:2,phase:'end'}),101)).toBe(false)
 expect(room.receive(frame({base:'room-winner',sequence:3,gesture:'next'}),102)).toBe(true);room.free()
})

it('accepts consecutive gestures before their durable checkpoints arrive and retains untouched final poses',()=>{
 const room=new ui.RustRoomMotion(),out=new Float64Array(9);room.acknowledge('base');
 room.receive(frame({base:'base',commit:'first',phase:'end',poses:[pose(.23)]}),0);
 const other=['book:drive:two',1,.4,.1,.02,0,0,0,1,1];
 expect(room.receive(frame({base:'first',gesture:'second',sequence:2,poses:[other]}),100)).toBe(true);
 expect(room.pose('book:drive:one',200,out)).toBe(true);expect(out[1]).toBe(.23);
 room.acknowledge('first');
 expect(room.pose('book:drive:two',200,out)).toBe(true);expect(out[1]).toBe(.4);
 expect(room.gesturing(200)).toBe(true);
 expect(room.receive(frame({base:'first',commit:'second',gesture:'second',sequence:3,phase:'end',poses:[other]}),300)).toBe(true);
 room.acknowledge('second');expect(room.active(301)).toBe(false);room.free();
});
it('retains the complete causal preview across several delayed physical commits',()=>{
 const room=new ui.RustRoomMotion(),out=new Float64Array(9);room.acknowledge('base');
 for(let i=1;i<=3;i++)expect(room.receive(frame({base:i===1?'base':`commit-${i-1}`,commit:`commit-${i}`,gesture:`g-${i}`,sequence:i,phase:'end',poses:[[ `book:drive:${i}`,1,i*.1,.1,.02,0,0,0,1,1]]}),i*100)).toBe(true);
 room.acknowledge('commit-1');room.acknowledge('commit-2');
 for(let i=1;i<=3;i++){expect(room.pose(`book:drive:${i}`,1000,out)).toBe(true);expect(out[1]).toBeCloseTo(i*.1)}
 room.acknowledge('commit-3');expect(room.active(1001)).toBe(false);
 expect(room.receive(frame({base:'base',sequence:10}),1002)).toBe(false);room.free();
});

it('recovers the complete causal room when transport coalescing skips an end frame',()=>{
 const sender=new ui.RustLiveRoom('account','peer-a'),receiver=new ui.RustLiveRoom('account','peer-b'),room=new ui.RustRoomMotion(),out=new Float64Array(9);
 room.acknowledge('base');
 sender.publishMotion(frame({base:'base',commit:'first',phase:'end',poses:[pose(.23)]})); // deliberately lost
 const second=sender.publishMotion(frame({base:'first',gesture:'second',sequence:2,poses:[['book:drive:two',1,.4,.1,.02,0,0,0,1,1]]}));
 const packet=receiver.receiveMotion(second);expect(packet.lineage).toEqual(['base','first']);expect(packet.poses).toHaveLength(2);
 expect(room.receive(packet,100)).toBe(true);expect(room.pose('book:drive:one',200,out)).toBe(true);expect(out[1]).toBe(.23);
 room.acknowledge('first');expect(room.pose('book:drive:two',200,out)).toBe(true);
 sender.publishMotion(frame({base:'unrelated',gesture:'third',sequence:3,poses:[]}));
 const reset=JSON.parse(sender.publishMotion(frame({base:'unrelated',gesture:'third',sequence:4,poses:[]})));
 expect(reset.lineage).toEqual(['unrelated']);expect(reset.poses).toEqual([]);expect(room.receive(reset,300)).toBe(false);
 sender.free();receiver.free();room.free();
});
it('rejects malformed or unbounded causal histories',()=>{
 const sender=new ui.RustLiveRoom('account','peer-a');
 for(const lineage of ['bad',Array(33).fill('base'),['x'.repeat(129),'base'],['wrong']])expect(sender.publishMotion(frame({base:'base',lineage}))).toBeNull();
 sender.free();
});
