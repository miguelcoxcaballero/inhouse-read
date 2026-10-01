import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'
import { attachSwipeNavigation, classifyTapZone, classifySwipe, ZONE } from '../../src/js/gestures.js'

describe('classifyTapZone', () => {
  it('clasifica el 28% izquierdo como PREV', () => {
    expect(classifyTapZone(10, 400)).toBe(ZONE.PREV)
    expect(classifyTapZone(111, 400)).toBe(ZONE.PREV)
  })

  it('clasifica el 28% derecho como NEXT', () => {
    expect(classifyTapZone(390, 400)).toBe(ZONE.NEXT)
    expect(classifyTapZone(289, 400)).toBe(ZONE.NEXT)
  })

  it('clasifica el centro como CENTER', () => {
    expect(classifyTapZone(200, 400)).toBe(ZONE.CENTER)
  })

  it('con ancho 0 no revienta y devuelve CENTER', () => {
    expect(classifyTapZone(50, 0)).toBe(ZONE.CENTER)
  })
})

describe('classifySwipe', () => {
  it('un arrastre rápido hacia la izquierda es NEXT', () => {
    expect(classifySwipe({ dx: -80, dy: 2, durationMs: 150 })).toBe(ZONE.NEXT)
  })

  it('un arrastre rápido hacia la derecha es PREV', () => {
    expect(classifySwipe({ dx: 80, dy: -2, durationMs: 150 })).toBe(ZONE.PREV)
  })

  it('un arrastre demasiado corto no cuenta como swipe', () => {
    expect(classifySwipe({ dx: 10, dy: 0, durationMs: 100 })).toBeNull()
  })

  it('un arrastre demasiado lento no cuenta como swipe', () => {
    expect(classifySwipe({ dx: 100, dy: 0, durationMs: 900 })).toBeNull()
  })

  it('un arrastre más vertical que horizontal (scroll) no cuenta como swipe', () => {
    expect(classifySwipe({ dx: 50, dy: 120, durationMs: 150 })).toBeNull()
  })

  it('accepts a deliberate short flick, but rejects tap jitter and reversed velocity', () => {
    expect(classifySwipe({dx:-25,dy:2,durationMs:110,velocityX:-.8})).toBe(ZONE.NEXT)
    expect(classifySwipe({dx:-8,dy:0,durationMs:20,velocityX:-2})).toBeNull()
    expect(classifySwipe({dx:-25,dy:0,durationMs:110,velocityX:.8})).toBeNull()
  })
})

describe('reader gesture ownership and motion', () => {
  let element, surface, next, prev, chrome, zoom, detach, frames, sequence
  const pointer = (type,x,y,time = 0, id = 1, target = element, pointerType = 'touch') => {
    const event = new MouseEvent(type,{bubbles:true,cancelable:true,clientX:x,clientY:y})
    Object.defineProperties(event,{pointerId:{value:id},pointerType:{value:pointerType},timeStamp:{value:time}})
    target.dispatchEvent(event)
    return event
  }
  const renderFrame = time => {
    const pending = [...frames.values()]
    frames.clear()
    for (const callback of pending) callback(time)
  }
  const nativeTouch = (type,x,y) => {
    const event = new Event(type,{bubbles:true})
    Object.defineProperty(event,'touches',{value:type === 'touchend' ? [] : [{clientX:x,clientY:y}]})
    element.dispatchEvent(event)
  }
  const connect = options => {
    detach = attachSwipeNavigation(element,{onNext:next,onPrev:prev,onToggleChrome:chrome,...options})
  }
  beforeEach(() => {
    vi.useFakeTimers()
    vi.spyOn(performance,'now').mockReturnValue(0)
    document.body.innerHTML = '<main><article>Printed page</article><button>Action</button></main>'
    element = document.querySelector('main')
    surface = element.querySelector('article')
    element.getBoundingClientRect = () => ({left:0,top:0,width:400,height:700})
    next = vi.fn(); prev = vi.fn(); chrome = vi.fn(); zoom = vi.fn()
    frames = new Map(); sequence = 0
    vi.stubGlobal('requestAnimationFrame',callback => {frames.set(++sequence,callback);return sequence})
    vi.stubGlobal('cancelAnimationFrame',id => frames.delete(id))
    window.matchMedia = vi.fn(() => ({matches:false}))
    document.getSelection().removeAllRanges()
  })
  afterEach(() => {detach?.();vi.restoreAllMocks();vi.unstubAllGlobals();vi.useRealTimers();document.body.innerHTML=''})

  it('batches horizontal page updates and restores the original styles after a damped spring', () => {
    surface.style.transform = 'scale(1)'
    surface.style.willChange = 'opacity'
    connect({getMotionSurface:() => surface})
    pointer('pointerdown',300,200,0)
    pointer('pointermove',260,200,16)
    pointer('pointermove',220,200,32)
    expect(frames.size).toBe(1)
    expect(surface.style.transform).toBe('scale(1)')
    renderFrame(32)
    const offset = parseFloat(surface.style.transform.match(/translate3d\(([-\d.]+)/)[1])
    expect(offset).toBeLessThan(-30)
    expect(offset).toBeGreaterThan(-80)
    pointer('pointerup',220,200,40)
    expect(next).toHaveBeenCalledOnce()
    renderFrame(100)
    expect(surface.style.transform).toContain('translate3d')
    renderFrame(1000)
    expect(surface.style.transform).toBe('scale(1)')
    expect(surface.style.willChange).toBe('opacity')
    expect(frames.size).toBe(0)
  })

  it('ignores a cancelled pointer and never reuses its start position for a later pointerup', () => {
    connect({getMotionSurface:() => surface})
    pointer('pointerdown',300,200)
    pointer('pointermove',200,200,30)
    pointer('pointercancel',200,200,40)
    pointer('pointerup',100,200,50)
    expect(next).not.toHaveBeenCalled()
    detach();detach = null
    expect(frames.size).toBe(0)
    expect(surface.style.transform).toBe('')
  })

  it('settles to the same position at the same time on 60 Hz and 120 Hz displays', () => {
    const settle = interval => {
      connect({getMotionSurface:() => surface})
      pointer('pointerdown',300,200)
      pointer('pointermove',220,200,32)
      renderFrame(32)
      pointer('pointerup',220,200,40)
      for (let time = interval; time <= 128; time += interval) renderFrame(time)
      const transform = surface.style.transform
      detach();detach = null
      return transform
    }
    expect(settle(16)).toBe(settle(8))
  })

  it('a pinch cannot be mistaken for two page swipes or taps', () => {
    connect()
    pointer('pointerdown',100,200,0,1)
    pointer('pointerdown',250,200,5,2)
    pointer('pointermove',40,200,30,1)
    pointer('pointerup',40,200,40,1)
    pointer('pointerup',300,200,50,2)
    expect(next).not.toHaveBeenCalled()
    expect(prev).not.toHaveBeenCalled()
    expect(chrome).not.toHaveBeenCalled()
    pointer('pointerdown',200,200,80)
    pointer('pointerup',200,200,100)
    expect(chrome).toHaveBeenCalledOnce()
  })

  it('leaves native EPUB touch swipes alone while retaining edge taps and mouse navigation', () => {
    const nativeSwipe = vi.fn()
    connect({nativeTouchSwipes:true,onNativeSwipe:nativeSwipe})
    nativeTouch('touchstart',300,200)
    pointer('pointerdown',300,200)
    pointer('pointermove',200,200,40)
    nativeTouch('touchmove',200,200)
    nativeTouch('touchmove',180,200)
    pointer('pointerup',200,200,80)
    nativeTouch('touchend',200,200)
    expect(next).not.toHaveBeenCalled()
    expect(nativeSwipe).toHaveBeenCalledOnce()
    pointer('pointerdown',380,200,100)
    pointer('pointerup',380,200,130)
    expect(next).toHaveBeenCalledOnce()
    expect(nativeSwipe).toHaveBeenCalledOnce()
    pointer('pointerdown',300,200,200,1,element,'mouse')
    pointer('pointerup',200,200,280,1,element,'mouse')
    expect(next).toHaveBeenCalledTimes(2)
  })

  it('does not navigate while zoom-panning, scrolling, selecting text or long pressing', () => {
    connect({canSwipe:() => false})
    pointer('pointerdown',300,200)
    pointer('pointerup',200,200,100)
    pointer('pointerdown',200,200,200)
    element.scrollTop = 40
    pointer('pointerup',200,200,250)
    pointer('pointerdown',380,200,300)
    pointer('pointerup',380,200,900)
    const range = document.createRange();range.selectNodeContents(surface)
    document.getSelection().addRange(range)
    pointer('pointerdown',380,200,1000)
    pointer('pointerup',380,200,1050)
    expect(next).not.toHaveBeenCalled()
    expect(chrome).not.toHaveBeenCalled()
  })

  it('double-taps zoom without the first tap turning the PDF page or hiding chrome', () => {
    connect({onToggleZoom:zoom})
    pointer('pointerdown',380,200)
    pointer('pointerup',380,200,50)
    pointer('lostpointercapture',380,200,51,1,surface)
    expect(next).not.toHaveBeenCalled()
    pointer('pointerdown',380,200,130)
    pointer('pointerup',380,200,180)
    pointer('lostpointercapture',380,200,181,1,surface)
    vi.advanceTimersByTime(400)
    expect(zoom).toHaveBeenCalledExactlyOnceWith(380,200)
    expect(next).not.toHaveBeenCalled()
    expect(chrome).not.toHaveBeenCalled()
  })

  it('delivers one delayed single tap and cancels pending taps when closing the reader', () => {
    connect({onToggleZoom:zoom})
    pointer('pointerdown',380,200)
    pointer('pointerup',380,200,50)
    vi.advanceTimersByTime(300)
    expect(next).toHaveBeenCalledOnce()
    pointer('pointerdown',200,200,500)
    pointer('pointerup',200,200,550)
    detach();detach = null
    vi.advanceTimersByTime(300)
    expect(chrome).not.toHaveBeenCalled()
  })

  it('reduced motion removes page displacement and inertia but preserves swipes', () => {
    window.matchMedia = vi.fn(() => ({matches:true}))
    connect({getMotionSurface:() => surface})
    pointer('pointerdown',300,200)
    pointer('pointermove',200,200,30)
    pointer('pointerup',200,200,40)
    expect(next).toHaveBeenCalledOnce()
    expect(surface.style.transform).toBe('')
    expect(frames.size).toBe(0)
  })
})
