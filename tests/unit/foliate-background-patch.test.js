import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { foliateBackgroundPatch, patchFoliateBackground } from '../../scripts/foliate-background-patch.mjs'
import { patchFoliateTurnDiagnostics } from '../../scripts/foliate-turn-diagnostic-patch.mjs'
import { patchFoliateFrameLoading } from '../../scripts/foliate-frame-loading-patch.mjs'
import { patchFoliateRetainedFrame } from '../../scripts/foliate-retained-frame-patch.mjs'
const upstream=readFileSync('node_modules/foliate-js/paginator.js','utf8')
function harness(source,hidden=false) {
  const document=new EventTarget(); document.hidden=hidden
  const frames=new Map(); let serial=0
  const request=vi.fn(fn=>{frames.set(++serial,fn);return serial}), cancel=vi.fn(id=>frames.delete(id))
  const add=vi.spyOn(document,'addEventListener'), remove=vi.spyOn(document,'removeEventListener')
  const part=source.slice(source.indexOf('const lerp ='),source.indexOf('// collapsed range'))
  const animate=new Function('document','requestAnimationFrame','cancelAnimationFrame',`${part}\nreturn animate`)(document,request,cancel)
  return {document,frames,request,cancel,add,remove,animate, tick(at){const pending=[...frames.values()];frames.clear();for(const fn of pending)fn(at)} }
}
// Execute Foliate's actual chapter-turn method, including its private lock,
// with a loaded section and a timer queue that the hidden WebView never fires.
function chapterHarness(source,hidden=false,failChapter=false) {
  const document=new EventTarget(); document.hidden=hidden
  const timers=new Map(); let serial=0
  const setTimer=vi.fn((fn,ms)=>{timers.set(++serial,{fn,ms});return serial})
  const clearTimer=vi.fn(id=>timers.delete(id))
  const add=vi.spyOn(document,'addEventListener'), remove=vi.spyOn(document,'removeEventListener')
  const prefix=source.slice(0,source.indexOf('// collapsed range'))
  const method=source.match(/    async #turnPage\(dir, distance\) \{[\s\S]*?\n    \}\n(?=    async prev\(distance\))/)?.[0]
  if(!method) throw new Error('Missing actual Foliate chapter-turn method')
  const Probe=new Function('document','setTimeout','clearTimeout','requestAnimationFrame','cancelAnimationFrame','loadChapter',`${prefix}
    return class {
      #locked=false; #index=0
      get locked(){return this.#locked}
      get index(){return this.#index}
      hasAttribute(name){return name==='animated'}
      async #scrollNext(){return true}
      async #scrollPrev(){return true}
      #adjacentIndex(dir){return this.#index+dir}
      async #goTo({index}){await loadChapter();this.#index=index}
      ${method}
      next(){return this.#turnPage(1)}
    }`)(document,setTimer,clearTimer,()=>{throw new Error('Unexpected visual frame')},()=>{},async()=>{if(failChapter)throw new TypeError('chapter failed')})
  return {document,timers,setTimer,clearTimer,add,remove,paginator:new Probe(),
    fire(){const pending=[...timers.values()];timers.clear();for(const {fn} of pending)fn()} }
}
async function flushMicrotasks(){for(let i=0;i<12;i++) await Promise.resolve()}
describe('Foliate page following while the native audiobook is hidden',()=>{
  it('reproduces the old page-turn lock remaining stuck when a chapter fails',async()=>{
    const h=chapterHarness(patchFoliateBackground(upstream),true,true)
    await expect(h.paginator.next()).rejects.toThrow('chapter failed')
    expect(h.paginator.locked).toBe(true)
  })
  it('releases the retained-frame page turn after a load error without reporting success',async()=>{
    const source=patchFoliateTurnDiagnostics(patchFoliateRetainedFrame(patchFoliateFrameLoading(patchFoliateBackground(upstream))))
    const h=chapterHarness(source,true,true)
    await expect(h.paginator.next()).rejects.toThrow('chapter failed')
    expect(h.paginator.locked).toBe(false);expect(h.paginator.index).toBe(0)
    expect(h.setTimer).not.toHaveBeenCalled()
  })
  it('reproduces upstream: a hidden page leaves chapter following pending without visual rAF',async()=>{
    const h=harness(upstream,true), render=vi.fn(), done=vi.fn()
    h.animate(0,100,400,x=>x,render).then(done); await Promise.resolve()
    expect(done).not.toHaveBeenCalled(); expect(render).not.toHaveBeenCalled(); expect(h.frames.size).toBe(1)
  })
  it('commits the exact endpoint immediately when a chapter is already hidden',async()=>{
    const h=harness(patchFoliateBackground(upstream),true), render=vi.fn()
    await h.animate(0,100,400,x=>x*x,render)
    expect(render).toHaveBeenCalledExactlyOnceWith(100); expect(h.request).not.toHaveBeenCalled(); expect(h.remove).toHaveBeenCalledOnce()
  })
  it('hiding during a follow turn cancels rAF, commits once, and permits the awaited chapter step',async()=>{
    const h=harness(patchFoliateBackground(upstream)), render=vi.fn(); let chapter=0
    const follow=h.animate(0,100,400,x=>x,render)
    const advance=(async()=>{await follow;chapter++;await h.animate(100,200,400,x=>x,render);chapter++})()
    h.tick(0);h.tick(100);expect(render.mock.calls.map(c=>c[0])).toEqual([0,25])
    h.document.hidden=true;h.document.dispatchEvent(new Event('visibilitychange'));await advance
    expect(chapter).toBe(2);expect(render.mock.calls.map(c=>c[0])).toEqual([0,25,100,200]);expect(h.frames.size).toBe(0)
    h.document.dispatchEvent(new Event('visibilitychange'));expect(render).toHaveBeenCalledTimes(4)
    expect(h.add).toHaveBeenCalledTimes(2);expect(h.remove).toHaveBeenCalledTimes(2)
  })
  it('preserves the original visible easing and final timing',async()=>{
    const h=harness(patchFoliateBackground(upstream)), render=vi.fn()
    const done=h.animate(10,90,400,x=>1-(1-x)*(1-x),render)
    h.tick(12);h.tick(212);h.tick(412);await done
    expect(render.mock.calls.map(c=>c[0])).toEqual([10,70,90]);expect(h.frames.size).toBe(0);expect(h.remove).toHaveBeenCalledOnce()
  })
  it('reproduces the upstream hidden chapter lock when its visual 100ms timer never fires',async()=>{
    const h=chapterHarness(upstream,true), done=vi.fn()
    h.paginator.next().then(done); await flushMicrotasks()
    expect(h.paginator.index).toBe(1);expect(h.paginator.locked).toBe(true)
    expect(done).not.toHaveBeenCalled();expect([...h.timers.values()].map(t=>t.ms)).toEqual([100])
  })
  it('releases a hidden chapter turn without waiting for a suspended visual timer',async()=>{
    const h=chapterHarness(patchFoliateBackground(upstream),true), done=vi.fn()
    h.paginator.next().then(done); await flushMicrotasks()
    expect(h.paginator.index).toBe(1);expect(done).toHaveBeenCalledOnce();expect(h.paginator.locked).toBe(false)
    expect(h.setTimer).not.toHaveBeenCalled();expect(h.timers.size).toBe(0)
    expect(h.add).toHaveBeenCalledOnce();expect(h.remove).toHaveBeenCalledOnce()
  })
  it('retains the full visible 100ms chapter cooldown and lock',async()=>{
    const h=chapterHarness(patchFoliateBackground(upstream)), done=vi.fn()
    h.paginator.next().then(done); await flushMicrotasks()
    expect(h.paginator.index).toBe(1);expect(h.paginator.locked).toBe(true);expect(done).not.toHaveBeenCalled()
    expect([...h.timers.values()].map(t=>t.ms)).toEqual([100])
    h.fire();await flushMicrotasks()
    expect(done).toHaveBeenCalledOnce();expect(h.paginator.locked).toBe(false);expect(h.timers.size).toBe(0)
    expect(h.remove).toHaveBeenCalledOnce()
  })
  it('hiding during the chapter cooldown finishes once and cleans its timer and listener',async()=>{
    const h=chapterHarness(patchFoliateBackground(upstream)), done=vi.fn()
    h.paginator.next().then(done); await flushMicrotasks()
    expect(h.paginator.locked).toBe(true);expect(h.timers.size).toBe(1)
    const stale=[...h.timers.values()][0].fn
    h.document.hidden=true;h.document.dispatchEvent(new Event('visibilitychange'));await flushMicrotasks()
    expect(done).toHaveBeenCalledOnce();expect(h.paginator.locked).toBe(false);expect(h.timers.size).toBe(0)
    expect(h.clearTimer).toHaveBeenCalledOnce();expect(h.remove).toHaveBeenCalledOnce()
    stale();h.document.dispatchEvent(new Event('visibilitychange'));await flushMicrotasks()
    expect(done).toHaveBeenCalledOnce();expect(h.clearTimer).toHaveBeenCalledOnce();expect(h.remove).toHaveBeenCalledOnce()
  })
  it('rejects a changed or duplicate upstream chapter cooldown signature',()=>{
    const call="if (shouldGo || !this.hasAttribute('animated')) await wait(100)"
    expect(()=>patchFoliateBackground(upstream.replace(call,call.replace('100','101')))).toThrow(/Unexpected/)
    expect(()=>patchFoliateBackground(upstream.replace(call,`${call}\n        ${call}`))).toThrow(/Unexpected/)
  })
  it('targets only the actual Foliate paginator and rejects a missing/duplicated signature',()=>{
    const plugin=foliateBackgroundPatch()
    expect(plugin.transform(upstream,'C:\\repo\\node_modules\\foliate-js\\paginator.js?x').code).toBe(patchFoliateTurnDiagnostics(patchFoliateRetainedFrame(patchFoliateFrameLoading(patchFoliateBackground(upstream)))))
    expect(plugin.transform('other','/src/paginator.js')).toBeNull()
    expect(()=>patchFoliateBackground('different')).toThrow(/Unexpected/)
    expect(()=>patchFoliateBackground(upstream+upstream)).toThrow(/Unexpected/)
  })
})
