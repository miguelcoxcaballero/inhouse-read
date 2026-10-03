import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { foliateBackgroundPatch, patchFoliateBackground } from '../../scripts/foliate-background-patch.mjs'
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
describe('Foliate page following while the native audiobook is hidden',()=>{
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
  it('targets only the actual Foliate paginator and rejects a missing/duplicated signature',()=>{
    const plugin=foliateBackgroundPatch()
    expect(plugin.transform(upstream,'C:\\repo\\node_modules\\foliate-js\\paginator.js?x').code).toBe(patchFoliateBackground(upstream))
    expect(plugin.transform('other','/src/paginator.js')).toBeNull()
    expect(()=>patchFoliateBackground('different')).toThrow(/Unexpected/)
    expect(()=>patchFoliateBackground(upstream+upstream)).toThrow(/Unexpected/)
  })
})
