// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const image = () => ({ gray:Uint8Array.from({length:64}, (_, i) => i),
  near:Float32Array.from({length:64}, (_, i) => i ? i / 3 : NaN), width:8, height:8, rows:6 })
const mask = index => ({ width:3 + index, height:2, area:2, mask:new Uint8Array([1,0,0,1]),
  perimeter:new Int32Array([0,1]), foreground:new Int32Array([0]), background:new Int32Array([1]) })
const flush = async () => { await Promise.resolve(); await Promise.resolve() }

function events() {
  const handlers = new Map()
  return {
    addEventListener:vi.fn((type, handler) => { if (!handlers.has(type)) handlers.set(type,new Set()); handlers.get(type).add(handler) }),
    removeEventListener:vi.fn((type, handler) => handlers.get(type)?.delete(handler)),
    fire(type) { for (const handler of [...(handlers.get(type) || [])]) handler() },
    count(type) { return handlers.get(type)?.size || 0 }
  }
}
class FakeWorker {
  constructor({begin='reply', score='reply', terminateThrows=false}={}) {
    this.begin=begin;this.score=score;this.terminateThrows=terminateThrows;this.sent=[];this.terminated=0
  }
  postMessage(message) {
    const data=structuredClone(message);this.sent.push(data)
    if(data.type==='begin' && this.begin==='reply') Promise.resolve().then(()=>this.emit({...data,accepted:true}))
    if(data.type==='score' && this.score==='reply') Promise.resolve().then(()=>this.emit({type:'score',job:data.job,request:data.request,score:data.mask.width/10}))
  }
  emit(data) { this.onmessage?.({data}) }
  terminate() { this.terminated++;if(this.terminateThrows)throw new Error('terminate rejected') }
}
let targets=[]
const setup = async options => {
  const worker=new FakeWorker(options), target=events(), factory=vi.fn(()=>worker)
  targets.push(target)
  const {openFontScoreJob}=await import('../../src/js/font-score-client.js')
  return {worker,target,factory,open:context=>openFontScoreJob(context,{factory,events:target})}
}
beforeEach(()=>{vi.resetModules();vi.useFakeTimers();targets=[]})
afterEach(()=>{for(const target of targets)target.fire('pagehide');vi.useRealTimers();vi.unstubAllGlobals();vi.restoreAllMocks()})

describe('font score Worker transport',()=>{
  it('does not create a Worker when the platform has no Worker API',async()=>{
    vi.stubGlobal('Worker',undefined)
    const {openFontScoreJob}=await import('../../src/js/font-score-client.js')
    expect(await openFontScoreJob(image())).toBeNull()
  })
  it('returns null on constructor failure so the caller uses the existing scorer',async()=>{
    const {openFontScoreJob}=await import('../../src/js/font-score-client.js')
    const factory=vi.fn(()=>{throw new Error('module Worker unsupported')})
    expect(await openFontScoreJob(image(),{factory})).toBeNull();expect(factory).toHaveBeenCalledTimes(1)
  })
  it('clones gray and near once and keeps masks ordered and the caller buffers intact',async()=>{
    const t=await setup(), original=image(), job=await t.open(original)
    const first=mask(1),second=mask(2)
    expect(await job.score(first)).toBe(.4);expect(await job.score(second)).toBe(.5)
    const begin=t.worker.sent.filter(message=>message.type==='begin')
    expect(begin).toHaveLength(1);expect(begin[0].gray).toBeInstanceOf(Uint8Array);expect(begin[0].near).toBeInstanceOf(Float32Array)
    expect(begin[0].gray).not.toBe(original.gray);expect(begin[0].near).not.toBe(original.near)
    expect(begin[0].gray).toEqual(original.gray);expect(begin[0].near).toEqual(original.near);expect(Number.isNaN(begin[0].near[0])).toBe(true)
    expect(original.gray.byteLength).toBe(64);expect(original.near.byteLength).toBe(256)
    const scores=t.worker.sent.filter(message=>message.type==='score')
    expect(scores.map(message=>message.mask.width)).toEqual([4,5]);expect(scores.every(message=>!('gray'in message)&&!('near'in message))).toBe(true)
    expect(scores[0].mask.perimeter).toBeInstanceOf(Int32Array);expect(scores[0].mask.mask).toBeInstanceOf(Uint8Array)
    job.close()
  })
  it('bounds startup at 3000ms without changing the font loader timer',async()=>{
    const t=await setup({begin:'hold'});let settled=false
    const pending=t.open(image()).then(value=>{settled=true;return value})
    await vi.advanceTimersByTimeAsync(2999);expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(1);expect(await pending).toBeNull();expect(t.worker.terminated).toBe(1);expect(t.target.count('pagehide')).toBe(0)
  })
  it('bounds one score at 2000ms and settles before releasing its Worker',async()=>{
    const t=await setup({score:'hold'}),job=await t.open(image());let settled=false
    const pending=job.score(mask(1));const rejected=pending.catch(error=>{settled=true;return error})
    await vi.advanceTimersByTimeAsync(1999);expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(1);expect(await rejected).toBeInstanceOf(Error);expect(t.worker.terminated).toBe(1)
    job.close();expect(t.worker.terminated).toBe(1)
  })
  it('keeps the current serial job alive when another private caller arrives early',async()=>{
    const t=await setup(),job=await t.open(image())
    expect(await t.open(image())).toBeNull();expect(t.worker.terminated).toBe(0);expect(t.factory).toHaveBeenCalledTimes(1)
    expect(await job.score(mask(1))).toBe(.4);job.close()
    const next=await t.open(image());expect(t.factory).toHaveBeenCalledTimes(1)
    const starts=t.worker.sent.filter(message=>message.type==='begin');expect(starts).toHaveLength(2);expect(starts[0].job).not.toBe(starts[1].job)
    expect(await next.score(mask(2))).toBe(.5);next.close()
  })
  it('ignores stale job/request replies before accepting the exact current reply',async()=>{
    const t=await setup({score:'hold'}),job=await t.open(image());let settled=false
    const pending=job.score(mask(1)).then(value=>{settled=true;return value}),request=t.worker.sent.at(-1)
    t.worker.emit({type:'score',job:request.job-1,request:request.request,score:99})
    t.worker.emit({type:'score',job:request.job,request:request.request-1,score:98})
    await flush();expect(settled).toBe(false)
    t.worker.emit({type:'score',job:request.job,request:request.request,score:.75})
    expect(await pending).toBe(.75);job.close()
  })
  it('rejects a malformed matching reply so it cannot become a family score',async()=>{
    const t=await setup({score:'hold'}),job=await t.open(image()),pending=job.score(mask(1)),request=t.worker.sent.at(-1)
    t.worker.emit({type:'score',job:request.job,request:request.request,score:'0.5'})
    await expect(pending).rejects.toThrow('Invalid');expect(t.worker.terminated).toBe(1)
  })
  it('settles a score on Worker errors and prevents an uncaught browser error',async()=>{
    const t=await setup({score:'hold'}),job=await t.open(image()),pending=job.score(mask(1)),preventDefault=vi.fn()
    t.worker.onerror({preventDefault});await expect(pending).rejects.toThrow('failed')
    expect(preventDefault).toHaveBeenCalledTimes(1);expect(t.worker.terminated).toBe(1)
  })
  it('settles messageerror without leaving a pending score or pagehide listener',async()=>{
    const t=await setup({score:'hold'}),job=await t.open(image()),pending=job.score(mask(1))
    t.worker.onmessageerror();await expect(pending).rejects.toThrow('message failed');expect(t.target.count('pagehide')).toBe(0)
  })
  it('cancels a pending job exactly once and rejects later calls from that handle',async()=>{
    const t=await setup({score:'hold'}),job=await t.open(image()),pending=job.score(mask(1))
    job.close();job.close();await expect(pending).rejects.toThrow('cancelled');expect(t.worker.terminated).toBe(1)
    await expect(job.score(mask(2))).rejects.toThrow('Inactive');expect(t.worker.sent.filter(message=>message.type==='score')).toHaveLength(1)
  })
  it('clears job arrays normally and releases an idle Worker only after 30000ms',async()=>{
    const t=await setup(),job=await t.open(image());job.close();job.close()
    expect(t.worker.sent.at(-1).type).toBe('end');expect(t.worker.sent.filter(message=>message.type==='end')).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(29999);expect(t.worker.terminated).toBe(0)
    await vi.advanceTimersByTimeAsync(1);expect(t.worker.terminated).toBe(1);expect(t.target.count('pagehide')).toBe(0)
  })
  it('pagehide and a throwing terminate never prevent the pending promise from settling',async()=>{
    const t=await setup({score:'hold',terminateThrows:true}),job=await t.open(image()),pending=job.score(mask(1))
    expect(()=>t.target.fire('pagehide')).not.toThrow();await expect(pending).rejects.toThrow('closed')
    expect(t.worker.terminated).toBe(1);expect(t.target.count('pagehide')).toBe(0);job.close();expect(t.worker.terminated).toBe(1)
  })
})
