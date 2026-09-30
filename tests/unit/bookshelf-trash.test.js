import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderBookshelf } from '../../src/js/bookshelf.js'

let container, shelf
const originalAnimate = Object.getOwnPropertyDescriptor(Element.prototype,'animate')
const records = () => [{ id:'trash:a', title:'Primero', sourceType:'local', format:'PDF' },
  { id:'trash:b', title:'Segundo', sourceType:'local', format:'PDF' }]
const spine = id => container.querySelector(`.ihr-spine[data-book-id="${id}"]`)
const removeKey = id => spine(id).dispatchEvent(new KeyboardEvent('keydown',{key:'Delete',bubbles:true,cancelable:true}))
function pointer(node,type,x=80,y=160) {
  const event = new MouseEvent(type,{clientX:x,clientY:y,button:0,bubbles:true,cancelable:true})
  Object.defineProperties(event,{pointerId:{value:1},pointerType:{value:'touch'}})
  node.dispatchEvent(event)
}
beforeEach(() => {
  vi.useFakeTimers()
  Object.defineProperty(Element.prototype,'animate',{configurable:true,value(_frames,timing) {
    let finish
    const finished = new Promise(resolve => { finish=resolve })
    const timer=setTimeout(() => finish(true),timing.duration)
    return {finished,cancel() {clearTimeout(timer);finish(false)}}
  }})
  container=document.createElement('div'); document.body.append(container)
})
afterEach(() => {
  shelf?.destroy(); shelf=null; container.remove()
  vi.restoreAllMocks(); vi.useRealTimers()
  if (originalAnimate) Object.defineProperty(Element.prototype,'animate',originalAnimate)
  else delete Element.prototype.animate
})

describe('bookshelf wastebasket',() => {
  it('only enables removal when the application supplies its storage callback',() => {
    shelf=renderBookshelf(container,records(),{shelfWidth:390})
    expect(container.querySelector('.ihr-shelf-trash')).toBeNull()
    removeKey('trash:a')
    expect(spine('trash:a')).not.toBeNull()
  })
  it('waits for the landing and storage result, then filters queued updates of the removed book',async () => {
    let finishStorage
    const removed=vi.fn(() => new Promise(resolve => { finishStorage=resolve }))
    shelf=renderBookshelf(container,records(),{shelfWidth:390,onBookRemove:removed})
    expect(container.querySelector('.ihr-shelf-trash')).not.toBeNull()
    removeKey('trash:a')
    shelf.update(records())
    await vi.advanceTimersByTimeAsync(800)
    expect(removed).not.toHaveBeenCalled()
    expect(spine('trash:a')).not.toBeNull()
    await vi.advanceTimersByTimeAsync(50)
    expect(removed).toHaveBeenCalledWith(expect.objectContaining({id:'trash:a'}))
    expect(spine('trash:a')).not.toBeNull()
    finishStorage()
    await vi.advanceTimersByTimeAsync(50)
    expect(spine('trash:a')).toBeNull()
    expect(spine('trash:b')).not.toBeNull()
    expect(container.querySelector('[role="status"]').textContent).toContain('Primero retirado')
    expect(document.querySelector('.ihr-trash-flight')).toBeNull()
  })
  it('restores the book when IndexedDB rejects removal',async () => {
    vi.spyOn(console,'warn').mockImplementation(() => {})
    const removed=vi.fn().mockRejectedValue(new Error('Storage unavailable'))
    shelf=renderBookshelf(container,records(),{shelfWidth:390,onBookRemove:removed})
    removeKey('trash:a')
    await vi.advanceTimersByTimeAsync(1000)
    expect(spine('trash:a')).not.toBeNull()
    expect(spine('trash:a').classList.contains('is-away')).toBe(false)
    expect(container.querySelector('[role="status"]').textContent).toContain('No se pudo retirar')
    expect(shelf.element.classList.contains('is-discarding')).toBe(false)
  })
  it('lets a slow motion finish while rendered frames continue to advance',async () => {
    const cancelled=vi.fn(), removed=vi.fn()
    vi.spyOn(performance,'now').mockImplementation(() => Date.now())
    Object.defineProperty(Element.prototype,'animate',{configurable:true,value() {
      let finish, lastFrameTime=performance.now()
      const finished=new Promise(resolve => { finish=resolve })
      const frames=setInterval(() => { lastFrameTime=performance.now() },250)
      const end=setTimeout(() => { clearInterval(frames); finish(true) },3500)
      return {finished,get lastFrameTime() {return lastFrameTime},cancel() {
        cancelled(); clearInterval(frames); clearTimeout(end); finish(false)
      }}
    }})
    shelf=renderBookshelf(container,records(),{shelfWidth:390,onBookRemove:removed})
    removeKey('trash:a')
    await vi.advanceTimersByTimeAsync(3000)
    expect(removed).not.toHaveBeenCalled()
    expect(cancelled).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(600)
    expect(removed).toHaveBeenCalledOnce()
    expect(spine('trash:a')).toBeNull()
    expect(cancelled).not.toHaveBeenCalled()
  })
  it('restores the book if rendering stops during its fall',async () => {
    const cancelled=vi.fn(), removed=vi.fn()
    vi.spyOn(performance,'now').mockImplementation(() => Date.now())
    Object.defineProperty(Element.prototype,'animate',{configurable:true,value() {
      let finish
      const finished=new Promise(resolve => { finish=resolve })
      return {finished,lastFrameTime:performance.now(),cancel() {cancelled();finish(false)}}
    }})
    shelf=renderBookshelf(container,records(),{shelfWidth:390,onBookRemove:removed})
    removeKey('trash:a')
    await vi.advanceTimersByTimeAsync(2400)
    expect(cancelled).toHaveBeenCalledOnce()
    expect(removed).not.toHaveBeenCalled()
    expect(spine('trash:a').classList.contains('is-away')).toBe(false)
    expect(shelf.element.classList.contains('is-discarding')).toBe(false)
  })
  it('a cancelled pointer over the basket never removes the book',async () => {
    const removed=vi.fn()
    shelf=renderBookshelf(container,records(),{shelfWidth:390,onBookRemove:removed})
    const bin=container.querySelector('.ihr-shelf-trash'), book=spine('trash:a')
    bin.getBoundingClientRect=() => ({left:300,right:370,top:600,bottom:720,width:70,height:120})
    pointer(book,'pointerdown')
    await vi.advanceTimersByTimeAsync(450)
    pointer(book,'pointermove',335,650)
    expect(bin.classList.contains('is-over')).toBe(true)
    pointer(book,'pointercancel',335,650)
    await vi.advanceTimersByTimeAsync(1000)
    expect(removed).not.toHaveBeenCalled()
    expect(spine('trash:a')).not.toBeNull()
    expect(bin.classList.contains('is-over')).toBe(false)
  })
  it('destroying an unfinished fall releases its clone without deleting storage',async () => {
    const removed=vi.fn()
    shelf=renderBookshelf(container,records(),{shelfWidth:390,onBookRemove:removed})
    removeKey('trash:a')
    await vi.advanceTimersByTimeAsync(100)
    expect(document.querySelector('.ihr-trash-flight')).not.toBeNull()
    shelf.destroy(); shelf=null
    await vi.advanceTimersByTimeAsync(1000)
    expect(removed).not.toHaveBeenCalled()
    expect(document.querySelector('.ihr-trash-flight')).toBeNull()
  })
})
