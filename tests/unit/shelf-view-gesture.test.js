import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createShelfViewGesture } from '../../src/js/shelf-view-gesture.js'

const controllers = []
beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  for (const controller of controllers.splice(0)) controller.destroy()
  document.body.replaceChildren()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

function setup({ mode = 'spine', width = 390, rootWidth = 0 } = {}) {
  const root = document.createElement('div'), scroller = document.createElement('div')
  root.tabIndex = 0
  root.append(scroller)
  document.body.append(root)
  Object.defineProperty(scroller, 'clientWidth', { value:width })
  Object.defineProperty(root, 'clientWidth', { value:rootWidth })
  scroller.setPointerCapture = vi.fn()
  scroller.releasePointerCapture = vi.fn()
  let current = mode, enabled = true
  const setMode = vi.fn(next => { current = next }), cancelOwner = vi.fn()
  const controller = createShelfViewGesture({ root, scroller,
    getMode:() => current, setMode, isEnabled:() => enabled, onGestureStart:cancelOwner })
  controllers.push(controller)
  const pointer = (type, x, y = 100, { id = 1, node = scroller, pointerType = 'touch', button = 0, isPrimary = true } = {}) => {
    const event = new Event(type, { bubbles:true, cancelable:true })
    Object.defineProperties(event, {
      pointerId:{ value:id }, pointerType:{ value:pointerType }, button:{ value:button },
      isPrimary:{ value:isPrimary }, clientX:{ value:x }, clientY:{ value:y }
    })
    node.dispatchEvent(event)
    return event
  }
  const swipe = (dx, options = {}) => {
    pointer('pointerdown', 160, 100, options)
    const move = pointer('pointermove', 160 + dx, 100, options)
    const end = pointer('pointerup', 160 + dx, 100, options)
    return { move, end }
  }
  const click = (detail = 1, node = scroller) => {
    const event = new MouseEvent('click', { bubbles:true, cancelable:true, detail })
    node.dispatchEvent(event)
    return event
  }
  const key = (key, options = {}, node = root) => {
    const event = new KeyboardEvent('keydown', { key, bubbles:true, cancelable:true, ...options })
    node.dispatchEvent(event)
    return event
  }
  return { root, scroller, controller, pointer, swipe, click, key, setMode, cancelOwner,
    get mode() { return current }, setExternalMode(next) { current = next }, disable() { enabled = false } }
}

it.each([
  ['spine', 'touch', -80, 'isometric'], ['spine', 'pen', -80, 'isometric'],
  ['isometric', 'touch', 80, 'spine'], ['isometric', 'pen', 80, 'spine']
])('%s + %s swipe %s changes to %s only on release', (mode, pointerType, dx, expected) => {
  const h = setup({ mode })
  h.pointer('pointerdown', 160, 100, { pointerType })
  expect(h.cancelOwner).not.toHaveBeenCalled()
  const move = h.pointer('pointermove', 160 + dx, 100, { pointerType })
  expect(move.defaultPrevented).toBe(true)
  expect(h.setMode).not.toHaveBeenCalled()
  h.pointer('pointermove', 160 + dx - Math.sign(dx), 100, { pointerType })
  expect(h.cancelOwner).toHaveBeenCalledOnce()
  expect(h.scroller.setPointerCapture).toHaveBeenCalledWith(1)
  const end = h.pointer('pointerup', 160 + dx, 100, { pointerType })
  expect(end.defaultPrevented).toBe(true)
  expect(h.setMode).toHaveBeenCalledExactlyOnceWith(expected)
  expect(h.scroller.releasePointerCapture).toHaveBeenCalledWith(1)
})

it.each(['ihr-spine', 'ihr-plant', 'ihr-lamp'])('allows swiping over a %s without delivering the compatibility click', className => {
  const h = setup(), button = document.createElement('button'), inner = document.createElement('span')
  button.className = className
  button.append(inner)
  h.scroller.append(button)
  const open = vi.fn()
  button.addEventListener('click', open)
  h.swipe(-80, { node:inner })
  expect(h.setMode).toHaveBeenCalledWith('isometric')
  expect(h.click(1, inner).defaultPrevented).toBe(true)
  expect(open).not.toHaveBeenCalled()
})

it.each([
  ['input', ''], ['select', ''], ['textarea', ''], ['a', ''], ['button', ''],
  ['div', 'ihr-shelf-catalog'], ['div', 'ihr-shelf-trash'], ['div', 'ihr-plant-catalog']
])('keeps %s.%s gestures with their existing control', (tag, className) => {
  const h = setup(), node = document.createElement(tag), inner = document.createElement('span')
  node.className = className
  if (!['input', 'textarea'].includes(tag)) node.append(inner)
  h.scroller.append(node)
  const target = inner.parentNode ? inner : node
  const { move, end } = h.swipe(-80, { node:target })
  expect(move.defaultPrevented).toBe(false)
  expect(end.defaultPrevented).toBe(false)
  expect(h.cancelOwner).not.toHaveBeenCalled()
  expect(h.setMode).not.toHaveBeenCalled()
})

it.each([{ pointerType:'mouse' }, { button:2 }, { isPrimary:false }])('does not claim unsupported pointer %j', options => {
  const h = setup(), { move, end } = h.swipe(-100, options)
  expect(move.defaultPrevented).toBe(false)
  expect(end.defaultPrevented).toBe(false)
  expect(h.cancelOwner).not.toHaveBeenCalled()
  expect(h.setMode).not.toHaveBeenCalled()
})

it('leaves a tap and long press without horizontal movement untouched', () => {
  const h = setup(), clicked = vi.fn()
  h.scroller.addEventListener('click', clicked)
  h.pointer('pointerdown', 100)
  vi.advanceTimersByTime(1800)
  expect(h.pointer('pointerup', 100).defaultPrevented).toBe(false)
  expect(h.click().defaultPrevented).toBe(false)
  expect(clicked).toHaveBeenCalledOnce()
  expect(h.cancelOwner).not.toHaveBeenCalled()
  expect(h.setMode).not.toHaveBeenCalled()
})

it('leaves an activated hold/drag owner alone after it disables view gestures', () => {
  const h = setup()
  h.pointer('pointerdown', 160)
  vi.advanceTimersByTime(600)
  h.disable()
  expect(h.pointer('pointermove', 60).defaultPrevented).toBe(false)
  h.pointer('pointerup', 60)
  expect(h.cancelOwner).not.toHaveBeenCalled()
  expect(h.setMode).not.toHaveBeenCalled()
})

it('claims at 14px only with horizontal dominance, before any held object receives that move', () => {
  const h = setup(), moveOwner = vi.fn()
  h.scroller.addEventListener('pointermove', moveOwner)
  h.pointer('pointerdown', 160)
  expect(h.pointer('pointermove', 147).defaultPrevented).toBe(false)
  expect(h.pointer('pointermove', 146, 110).defaultPrevented).toBe(false)
  expect(moveOwner).toHaveBeenCalledTimes(2)
  expect(h.pointer('pointermove', 145, 110).defaultPrevented).toBe(true)
  expect(moveOwner).toHaveBeenCalledTimes(2)
  expect(h.cancelOwner).toHaveBeenCalledOnce()
  h.pointer('pointerup', 145, 110)
  expect(h.setMode).not.toHaveBeenCalled()
})

it.each([[200, 48], [390, 62.4], [1000, 96], [0, 62.4]])('uses the bounded final threshold for width %s (%s px)', (width, threshold) => {
  const h = setup({ width })
  h.swipe(-threshold + .1)
  expect(h.setMode).not.toHaveBeenCalled()
  h.swipe(-threshold, { id:2 })
  expect(h.setMode).toHaveBeenCalledExactlyOnceWith('isometric')
})

it('falls back to the real root width before the default width', () => {
  const h = setup({ width:0, rootWidth:600 })
  h.swipe(-80)
  expect(h.setMode).not.toHaveBeenCalled()
  h.swipe(-96, { id:2 })
  expect(h.setMode).toHaveBeenCalledWith('isometric')
})

it('permanently rejects a vertical scroll even if the same finger later moves sideways', () => {
  const h = setup()
  h.pointer('pointerdown', 160)
  expect(h.pointer('pointermove', 156, 113).defaultPrevented).toBe(false)
  expect(h.pointer('pointermove', 60, 115).defaultPrevented).toBe(false)
  expect(h.pointer('pointerup', 60, 115).defaultPrevented).toBe(false)
  expect(h.cancelOwner).not.toHaveBeenCalled()
  expect(h.setMode).not.toHaveBeenCalled()
})

it.each([['spine', 80], ['isometric', -80]])('keeps a swipe in the wrong direction untouched from %s', (mode, dx) => {
  const h = setup({ mode }), { move, end } = h.swipe(dx)
  expect(move.defaultPrevented).toBe(false)
  expect(end.defaultPrevented).toBe(false)
  expect(h.cancelOwner).not.toHaveBeenCalled()
  expect(h.setMode).not.toHaveBeenCalled()
})

it('does not navigate after reversing or ending diagonally once claimed', () => {
  for (const [x, y] of [[180, 100], [80, 170]]) {
    const h = setup()
    h.pointer('pointerdown', 160)
    h.pointer('pointermove', 80)
    expect(h.pointer('pointerup', x, y).defaultPrevented).toBe(true)
    expect(h.setMode).not.toHaveBeenCalled()
  }
})

it('abandons a two-finger gesture so pinch keeps both moves and releases', () => {
  const h = setup()
  h.pointer('pointerdown', 160)
  h.pointer('pointerdown', 240, 100, { id:2, isPrimary:false })
  expect(h.pointer('pointermove', 60).defaultPrevented).toBe(false)
  expect(h.pointer('pointermove', 280, 100, { id:2 }).defaultPrevented).toBe(false)
  h.pointer('pointerup', 60)
  h.pointer('pointerup', 280, 100, { id:2 })
  expect(h.cancelOwner).not.toHaveBeenCalled()
  expect(h.setMode).not.toHaveBeenCalled()
  h.swipe(-80, { id:3 })
  expect(h.setMode).toHaveBeenCalledWith('isometric')
})

it('relinquishes an already claimed swipe when another finger begins a pinch', () => {
  const h = setup()
  h.pointer('pointerdown', 160)
  h.pointer('pointermove', 140)
  expect(h.cancelOwner).toHaveBeenCalledOnce()
  h.pointer('pointerdown', 240, 100, { id:2, isPrimary:false })
  expect(h.pointer('pointermove', 60).defaultPrevented).toBe(false)
  h.pointer('pointerup', 60)
  h.pointer('pointerup', 280, 100, { id:2 })
  expect(h.setMode).not.toHaveBeenCalled()
})

it('ignores events for another pointer and never changes view on cancellation', () => {
  const h = setup()
  h.pointer('pointerdown', 160)
  expect(h.pointer('pointermove', 60, 100, { id:9 }).defaultPrevented).toBe(false)
  h.pointer('pointermove', 60)
  expect(h.pointer('pointerup', 60, 100, { id:9 }).defaultPrevented).toBe(false)
  expect(h.pointer('pointercancel', 60).defaultPrevented).toBe(true)
  expect(h.setMode).not.toHaveBeenCalled()
  expect(h.scroller.releasePointerCapture).toHaveBeenCalledWith(1)
})

it.each(['disabled', 'mode changed'])('does not finish a swipe after %s', change => {
  const h = setup()
  h.pointer('pointerdown', 160)
  h.pointer('pointermove', 60)
  if (change === 'disabled') h.disable()
  else h.setExternalMode('isometric')
  h.pointer('pointerup', 60)
  expect(h.setMode).not.toHaveBeenCalled()
})

it('does not start gestures while another owner has disabled them', () => {
  const h = setup()
  h.disable()
  const { move, end } = h.swipe(-100)
  expect(move.defaultPrevented).toBe(false)
  expect(end.defaultPrevented).toBe(false)
  expect(h.cancelOwner).not.toHaveBeenCalled()
  expect(h.key('ArrowLeft').defaultPrevented).toBe(false)
  expect(h.setMode).not.toHaveBeenCalled()
})

it('suppresses compatibility clicks for 400ms but preserves keyboard activation', () => {
  const h = setup(), clicked = vi.fn()
  h.scroller.addEventListener('click', clicked)
  h.swipe(-80)
  expect(h.click(1).defaultPrevented).toBe(true)
  expect(h.click(0).defaultPrevented).toBe(false)
  expect(clicked).toHaveBeenCalledOnce()
  vi.advanceTimersByTime(399)
  expect(h.click(1).defaultPrevented).toBe(true)
  vi.advanceTimersByTime(1)
  expect(h.click(1).defaultPrevented).toBe(false)
  expect(clicked).toHaveBeenCalledTimes(2)
})

it('a fresh eligible touch restores tapping before the compatibility-click timer expires', () => {
  const h = setup()
  h.swipe(-80)
  h.pointer('pointerdown', 120, 100, { id:2 })
  h.pointer('pointerup', 120, 100, { id:2 })
  expect(h.click(1).defaultPrevented).toBe(false)
  expect(h.setMode).toHaveBeenCalledOnce()
})

it.each([['ArrowLeft', 'isometric'], ['ArrowRight', 'spine']])('root keyboard %s chooses %s', (key, expected) => {
  const h = setup({ mode:expected === 'spine' ? 'isometric' : 'spine' })
  h.root.focus()
  expect(h.key(key).defaultPrevented).toBe(true)
  expect(h.setMode).toHaveBeenCalledExactlyOnceWith(expected)
})

it.each([{ ctrlKey:true }, { altKey:true }, { metaKey:true }, { shiftKey:true }, { repeat:true }])('preserves modified/repeated keyboard input %j', options => {
  const h = setup()
  expect(h.key('ArrowLeft', options).defaultPrevented).toBe(false)
  expect(h.setMode).not.toHaveBeenCalled()
})

it('leaves control keyboard input and unrelated keys untouched', () => {
  const h = setup(), input = document.createElement('input')
  h.root.append(input)
  input.focus()
  expect(h.key('ArrowLeft', {}, input).defaultPrevented).toBe(false)
  for (const key of ['ArrowUp', 'ArrowDown', 'Enter', ' ', 'Escape']) expect(h.key(key).defaultPrevented).toBe(false)
  expect(h.setMode).not.toHaveBeenCalled()
})

it('destroy removes every listener and click timer without starting a render loop', () => {
  const h = setup(), frame = vi.spyOn(window, 'requestAnimationFrame')
  h.swipe(-80)
  h.controller.destroy()
  h.setMode.mockClear()
  h.cancelOwner.mockClear()
  expect(vi.getTimerCount()).toBe(0)
  expect(h.click(1).defaultPrevented).toBe(false)
  const { move, end } = h.swipe(-100, { id:2 })
  expect(move.defaultPrevented).toBe(false)
  expect(end.defaultPrevented).toBe(false)
  expect(h.key('ArrowLeft').defaultPrevented).toBe(false)
  expect(h.setMode).not.toHaveBeenCalled()
  expect(h.cancelOwner).not.toHaveBeenCalled()
  expect(frame).not.toHaveBeenCalled()
})
