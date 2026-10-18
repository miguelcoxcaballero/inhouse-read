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
  expect(room.receive(frame({gesture:'new',sequence:1}),6000)).toBe(true);room.clear('peer-b');expect(room.active(6001)).toBe(false);room.free()
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
