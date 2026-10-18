import {describe,it,expect} from 'vitest'
import {Buffer} from 'node:buffer'
import {rustUI as ui} from './helpers/rust-ui-ready.js'
const encoder=new TextEncoder(),decoder=new TextDecoder(),LIMIT=2*1024*1024
const bytes=s=>encoder.encode(s)
const take=stream=>{const parts=[];for(let i=0;i<200;i++){const part=stream.next();if(part===undefined)return parts;parts.push(part)}throw Error('Unbounded packet')}
const join=parts=>{const buffer=new Uint8Array(JSON.parse(parts[0]).size);let offset=0;for(const part of parts.slice(1)){buffer.set(part,offset);offset+=part.length}expect(offset).toBe(buffer.length);return buffer}
describe('Rust room packet stream',()=>{
 it.each([1,15999,16000,16001,31999,32000,32001,LIMIT])('preserves every byte at the %i-byte boundary and returns zero-copy send views',length=>{
  const stream=new ui.RustRoomPacketStream(),buffer=new Uint8Array(length);for(let i=0;i<length;i++)buffer[i]=i%251
  expect(stream.queue(buffer)).toBe(true);const parts=take(stream)
  expect(JSON.parse(parts[0])).toEqual({v:1,size:length});expect(Buffer.from(join(parts)).equals(Buffer.from(buffer))).toBe(true)
  for(const part of parts.slice(1)){expect(part.buffer).toBe(buffer.buffer);expect(part.length).toBeGreaterThan(0);expect(part.length).toBeLessThanOrEqual(16000)}
  stream.free()
 })
 it('roundtrips UTF-8 split inside multibyte characters and accepts actual ArrayBuffer wire messages',()=>{
  const tx=new ui.RustRoomPacketStream(),rx=new ui.RustRoomPacketStream(),text=JSON.stringify({title:'Árbol 🌿 水 📖'.repeat(7000)})
  tx.queue(bytes(text));let result
  for(const part of take(tx)){const wire=typeof part==='string'?part:part.buffer.slice(part.byteOffset,part.byteOffset+part.length),next=rx.receive(typeof wire==='string'?wire:new Uint8Array(wire));if(next!==undefined){expect(result).toBeUndefined();result=next}}
  expect(decoder.decode(result)).toBe(text);tx.free();rx.free()
 })
 it('coalesces pending state without truncating the packet already on the channel',()=>{
  const stream=new ui.RustRoomPacketStream();stream.queue(bytes('old'));stream.queue(bytes('current'))
  const header=stream.next();stream.queue(bytes('discarded'));stream.queue(bytes('latest'))
  expect(JSON.parse(header).size).toBe(7);expect(decoder.decode(stream.next())).toBe('current')
  expect(decoder.decode(join(take(stream)))).toBe('latest');expect(stream.next()).toBeUndefined();stream.free()
 })
 it('shares a single encoded state buffer across independent peer queues',()=>{
  const a=new ui.RustRoomPacketStream(),b=new ui.RustRoomPacketStream(),buffer=bytes('shared state')
  a.queue(buffer);b.queue(buffer);a.next();b.next();expect(a.next().buffer).toBe(buffer.buffer);expect(b.next().buffer).toBe(buffer.buffer)
  a.free();b.free()
 })
 it('rejects invalid queues while retaining the last valid pending packet',()=>{
  const stream=new ui.RustRoomPacketStream();stream.queue(bytes('valid'))
  for(const bad of [null,{},[],new ArrayBuffer(4),new Uint16Array(4),new Uint8Array(0),new Uint8Array(LIMIT+1)])expect(stream.queue(bad)).toBe(false)
  expect(decoder.decode(join(take(stream)))).toBe('valid');stream.free()
 })
 it.each(['{bad','null','[]','{}','{"v":2,"size":1}','{"v":1,"size":0}','{"v":1,"size":-1}','{"v":1,"size":1.5}','{"v":1,"size":"1"}','{"v":1,"size":2097153}',' '.repeat(129)])('rejects malformed header %s and recovers cleanly',header=>{
  const stream=new ui.RustRoomPacketStream();expect(()=>stream.receive(header)).toThrow();expect(stream.receive('{"v":1,"size":1}')).toBeUndefined();expect([...stream.receive(new Uint8Array([7]))]).toEqual([7]);stream.free()
 })
 it('rejects missing, empty, oversized, overflowing and overlapping chunks; no stale assembly survives',()=>{
  const stream=new ui.RustRoomPacketStream();expect(()=>stream.receive(bytes('x'))).toThrow()
  for(const invalid of [new Uint8Array(0),new Uint8Array(16001),new Uint8Array(3),{},'{"v":1,"size":2}']){
   stream.receive('{"v":1,"size":2}');expect(()=>stream.receive(invalid)).toThrow();expect(()=>stream.receive(new Uint8Array([0]))).toThrow()
  }
  stream.receive('{"v":1,"size":2}');expect(stream.receive(new Uint8Array([1]))).toBeUndefined();expect([...stream.receive(new Uint8Array([2]))]).toEqual([1,2]);stream.free()
 })
 it('clear releases in-flight, pending and partial received state',()=>{
  const stream=new ui.RustRoomPacketStream();stream.queue(bytes('first'));stream.next();stream.queue(bytes('next'));stream.receive('{"v":1,"size":1024}');stream.clear()
  expect(stream.next()).toBeUndefined();expect(()=>stream.receive(bytes('orphan'))).toThrow();stream.queue(bytes('new'));expect(decoder.decode(join(take(stream)))).toBe('new');stream.free()
 })
})

it('keeps the exact byte window of a subarray and preserves signed byte bits',()=>{
 const stream=new ui.RustRoomPacketStream(),all=new Uint8Array(32100);for(let i=0;i<all.length;i++)all[i]=i%251
 const window=all.subarray(7,32007);stream.queue(window);const parts=take(stream)
 expect(parts[1].byteOffset).toBe(7);expect(parts[2].byteOffset).toBe(16007);expect(Buffer.from(join(parts)).equals(Buffer.from(window))).toBe(true)
 const signed=new Int8Array([-1,0,127,-128]);expect(stream.queue(signed)).toBe(true)
 expect([...join(take(stream))]).toEqual([255,0,127,128]);stream.free()
})
