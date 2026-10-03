import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { patchPDFBackground, pdfBackgroundPatch } from '../../scripts/pdf-background-patch.mjs'

const upstream = readFileSync('node_modules/pdfjs-dist/legacy/build/pdf.mjs','utf8')
const taskSource = source => source.slice(source.indexOf('class InternalRenderTask {'),source.indexOf('const version = "6.3.289";'))
const flush = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() }
function harness(source, { hidden=false, useRAF=true, realNext=false }={}) {
  const document = new EventTarget(); document.hidden = hidden
  const frames = new Map(); let serial = 0
  const window = { requestAnimationFrame:vi.fn(fn=>{frames.set(++serial,fn);return serial}), cancelAnimationFrame:vi.fn(id=>frames.delete(id)) }
  const add = vi.spyOn(document,'addEventListener'), remove = vi.spyOn(document,'removeEventListener')
  class RenderTask { constructor(task) { this.task=task } }
  class RenderingCancelledException extends Error {}
  const Task = new Function('window','document','RenderTask','RenderingCancelledException',`${taskSource(source)}\nreturn InternalRenderTask`)(window,document,RenderTask,RenderingCancelledException)
  const callback = vi.fn()
  const task = new Task({callback,params:{canvas:null},operatorList:{argsArray:[],lastChunk:true},useRequestAnimationFrame:useRAF})
  task.gfx = {endDrawing:vi.fn(),executeOperatorList:vi.fn(()=>0)}
  if (!realNext) task._nextBound = vi.fn(async()=>{})
  return {task,callback,window,frames,document,add,remove,tick(){const pending=[...frames.values()];frames.clear();for(const fn of pending)fn()}}
}
describe('PDF.js display canvas rendering while the audiobook is hidden',()=>{
  it('reproduces upstream: an already hidden page waits indefinitely for a visual frame',async()=>{
    const h=harness(upstream,{hidden:true});h.task._scheduleNext();await flush()
    expect(h.task._nextBound).not.toHaveBeenCalled();expect(h.frames.size).toBe(1)
  })
  it('uses a microtask for an already hidden display render without changing its intent',async()=>{
    const h=harness(patchPDFBackground(upstream),{hidden:true});h.task._scheduleNext();await flush()
    expect(h.task._nextBound).toHaveBeenCalledOnce();expect(h.window.requestAnimationFrame).not.toHaveBeenCalled();expect(h.add).not.toHaveBeenCalled()
  })
  it('wakes a pending visual frame when hidden, with one continuation and no listener leak',async()=>{
    const h=harness(patchPDFBackground(upstream));h.task._scheduleNext();const lateFrame=[...h.frames.values()][0]
    await flush();expect(h.task._nextBound).not.toHaveBeenCalled()
    h.document.hidden=true;h.document.dispatchEvent(new Event('visibilitychange'));h.document.dispatchEvent(new Event('visibilitychange'));await flush()
    expect(h.task._nextBound).toHaveBeenCalledOnce();expect(h.window.cancelAnimationFrame).toHaveBeenCalledExactlyOnceWith(1);expect(h.frames.size).toBe(0)
    expect(h.add).toHaveBeenCalledOnce();expect(h.remove).toHaveBeenCalledOnce()
    lateFrame();h.document.dispatchEvent(new Event('visibilitychange'));await flush();expect(h.task._nextBound).toHaveBeenCalledOnce()
  })
  it('preserves the same visible visual-frame timing',async()=>{
    const h=harness(patchPDFBackground(upstream));h.task._scheduleNext();await flush();expect(h.task._nextBound).not.toHaveBeenCalled()
    h.tick();await flush();expect(h.task._nextBound).toHaveBeenCalledOnce();expect(h.window.requestAnimationFrame).toHaveBeenCalledOnce()
    expect(h.window.cancelAnimationFrame).not.toHaveBeenCalled();expect(h.remove).toHaveBeenCalledOnce()
  })
  it('does not let an obsolete frame clobber a newer scheduled render',async()=>{
    const h=harness(patchPDFBackground(upstream));h.task._scheduleNext();const lateFrame=[...h.frames.values()][0]
    h.task._scheduleNext();lateFrame();h.task.cancel();await flush()
    expect(h.window.cancelAnimationFrame.mock.calls.map(call=>call[0])).toEqual([1,2])
    expect(h.task._nextBound).not.toHaveBeenCalled();expect(h.frames.size).toBe(0);expect(h.add).toHaveBeenCalledTimes(2);expect(h.remove).toHaveBeenCalledTimes(2)
  })
  it('leaves print/nonvisual scheduling on its existing microtask path',async()=>{
    const h=harness(patchPDFBackground(upstream),{useRAF:false});h.task._scheduleNext();await flush()
    expect(h.task._nextBound).toHaveBeenCalledOnce();expect(h.window.requestAnimationFrame).not.toHaveBeenCalled();expect(h.add).not.toHaveBeenCalled()
  })
  it('cancels a visible frame and its listener without executing late frame callbacks',async()=>{
    const h=harness(patchPDFBackground(upstream));h.task._scheduleNext();const lateFrame=[...h.frames.values()][0]
    h.task.cancel();h.document.hidden=true;h.document.dispatchEvent(new Event('visibilitychange'));lateFrame();await flush()
    expect(h.task._nextBound).not.toHaveBeenCalled();expect(h.frames.size).toBe(0);expect(h.remove).toHaveBeenCalledOnce();expect(h.callback).toHaveBeenCalledOnce()
    expect(h.callback.mock.calls[0][0]).toBeInstanceOf(Error)
  })
  it('cancels after hiding but before the fallback microtask without continuing the render',async()=>{
    const h=harness(patchPDFBackground(upstream));h.task._scheduleNext();h.document.hidden=true;h.document.dispatchEvent(new Event('visibilitychange'));h.task.cancel();await flush()
    expect(h.task._nextBound).not.toHaveBeenCalled();expect(h.remove).toHaveBeenCalledOnce();expect(h.callback).toHaveBeenCalledOnce()
  })
  it('cleans the listener before real operator-list completion invokes its callback',async()=>{
    const h=harness(patchPDFBackground(upstream),{realNext:true});h.callback.mockImplementation(()=>expect(h.remove).toHaveBeenCalledOnce())
    h.task._scheduleNext();h.tick();await flush();expect(h.callback).toHaveBeenCalledExactlyOnceWith();expect(h.task.gfx.endDrawing).toHaveBeenCalledOnce()
  })
  it('cleans a failed continuation through the original cancellation path',async()=>{
    const h=harness(patchPDFBackground(upstream));h.task._nextBound.mockRejectedValue(new Error('graphics failure'));h.task._scheduleNext();h.tick();await flush()
    expect(h.callback).toHaveBeenCalledOnce();expect(h.task.cancelled).toBe(true);expect(h.remove).toHaveBeenCalledOnce();expect(h.frames.size).toBe(0)
  })
  it('targets only the compatibility PDF module and fails closed for an unsupported lifecycle/version',()=>{
    const plugin=pdfBackgroundPatch()
    expect(plugin.transform(upstream,'C:\\repo\\node_modules\\pdfjs-dist\\legacy\\build\\pdf.mjs?x').code).toBe(patchPDFBackground(upstream))
    expect(plugin.transform(upstream,'/node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs')).toBeNull()
    expect(plugin.transform(upstream,'/src/pdf.mjs')).toBeNull()
    for(const changed of ['different',upstream+upstream,upstream.replace('const version = "6.3.289";','const version = "6.4.0";'),upstream.replace('  _scheduleNext() {','  _scheduleOther() {')]) expect(()=>patchPDFBackground(changed)).toThrow(/Unexpected/)
  })
})
