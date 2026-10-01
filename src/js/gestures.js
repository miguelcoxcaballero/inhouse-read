// Shared reader gestures. Native scrolling and text selection retain ownership
// of vertical drags; an optional page surface follows horizontal PDF swipes.
export const ZONE = { PREV: 'prev', NEXT: 'next', CENTER: 'center' }

const EDGE_ZONE_FRACTION = 0.28
const SWIPE_MIN_DISTANCE = 40
const SWIPE_MAX_DURATION = 600
const DOUBLE_TAP_MAX_DELAY = 300
const TAP_MAX_MOVEMENT = 10
const TAP_MAX_DURATION = 450

export function classifyTapZone(x, width) {
  if (width <= 0) return ZONE.CENTER
  const fraction = x / width
  if (fraction <= EDGE_ZONE_FRACTION) return ZONE.PREV
  if (fraction >= 1 - EDGE_ZONE_FRACTION) return ZONE.NEXT
  return ZONE.CENTER
}

export function classifySwipe({ dx, dy, durationMs, velocityX = 0 }) {
  if (Math.abs(dy) > Math.abs(dx)) return null
  // A deliberate short flick should respond without treating small tap jitter
  // as navigation. Velocity is filtered from actual pointer sample timestamps.
  const flick = Math.abs(dx) >= 22 && Math.abs(velocityX) >= .45 && Math.sign(dx) === Math.sign(velocityX)
  if (!flick && (durationMs > SWIPE_MAX_DURATION || Math.abs(dx) < SWIPE_MIN_DISTANCE)) return null
  return dx < 0 ? ZONE.NEXT : ZONE.PREV
}

/** Returns a detach function, including pending taps and animation frames. */
export function attachSwipeNavigation(el, {
  onNext, onPrev, onToggleZoom, onToggleChrome,
  canSwipe = () => true, nativeTouchSwipes = false, onNativeSwipe, getMotionSurface, tapZone
} = {}) {
  const doc = el.ownerDocument
  const view = doc?.defaultView || window
  const points = new Set()
  let gesture = null, blocked = false, detached = false
  let nativeTouch = null
  let tapTimer = 0, lastTap = null, frame = 0, motion = null
  const interactive = target => target?.closest?.('a,button,input,select,textarea,[contenteditable=true]')
  const selected = () => !!doc?.getSelection?.()?.toString()
  const reducedMotion = () => view.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  const now = event => Number.isFinite(event?.timeStamp) ? event.timeStamp : performance.now()
  const clearTap = () => { clearTimeout(tapTimer); tapTimer = 0; lastTap = null }

  function restoreSurface() {
    if (!motion) return
    motion.surface.style.transform = motion.transform
    motion.surface.style.willChange = motion.willChange
    motion = null
  }
  function stopMotion() {
    if (frame) cancelAnimationFrame(frame)
    frame = 0
    restoreSurface()
  }
  function drawMotion(stamp) {
    frame = 0
    if (!motion || detached) return
    if (motion.settling) {
      // Exact critically damped spring: independent of 60/90/120 Hz displays.
      const seconds = Math.max(0, (stamp - motion.started) / 1000)
      const decay = Math.exp(-18 * seconds)
      const b = motion.velocity + 18 * motion.start
      motion.offset = (motion.start + b * seconds) * decay
      const velocity = (motion.velocity - 18 * b * seconds) * decay
      if (Math.abs(motion.offset) < .15 && Math.abs(velocity) < 3) return restoreSurface()
    }
    motion.surface.style.transform = `translate3d(${motion.offset.toFixed(2)}px,0,0) ${motion.transform}`.trim()
    if (motion.settling) frame = requestAnimationFrame(drawMotion)
  }
  function scheduleMotion() { if (!frame) frame = requestAnimationFrame(drawMotion) }
  function dragSurface(dx) {
    const surface = getMotionSurface?.()
    if (!surface || reducedMotion()) return
    if (!motion || motion.surface !== surface) {
      stopMotion()
      motion = { surface, transform:surface.style.transform, willChange:surface.style.willChange, offset:0 }
      surface.style.willChange = 'transform'
    }
    const limit = Math.max(36, el.getBoundingClientRect().width * .22)
    motion.offset = Math.sign(dx) * limit * (1 - Math.exp(-Math.abs(dx) / limit))
    scheduleMotion()
  }
  function settleSurface(velocity = 0) {
    if (!motion) return
    if (reducedMotion()) return stopMotion()
    motion.start = motion.offset
    motion.velocity = Math.max(-900, Math.min(900, velocity * 1000))
    motion.started = performance.now()
    motion.settling = true
    scheduleMotion()
  }
  function releaseCapture(id) {
    try { if (el.hasPointerCapture?.(id)) el.releasePointerCapture(id) } catch {}
  }
  function abandon() {
    if (gesture) releaseCapture(gesture.id)
    gesture = null
    clearTap()
    settleSurface()
  }
  function navigate(zone) {
    if (zone === ZONE.PREV) return onPrev?.()
    if (zone === ZONE.NEXT) return onNext?.()
    return onToggleChrome?.()
  }

  const onPointerDown = event => {
    if (event.button != null && event.button !== 0 || interactive(event.target)) return
    const id = event.pointerId ?? 0
    points.add(id)
    if (points.size > 1) { blocked = true; abandon(); return }
    if (blocked || selected()) return
    stopMotion()
    gesture = { id, x:event.clientX, y:event.clientY, t:now(event), lastX:event.clientX,
      lastT:now(event), velocity:0, moved:0, axis:null, pointerType:event.pointerType,
      selecting:event.pointerType === 'mouse' && (el === doc?.documentElement
        || !!event.target?.closest?.('.pdf-text-layer,.pdf-reflow-page')),
      scrollLeft:el.scrollLeft, scrollTop:el.scrollTop }
  }
  const onPointerMove = event => {
    if (!gesture || gesture.id !== (event.pointerId ?? 0) || blocked) return
    const dx = event.clientX - gesture.x, dy = event.clientY - gesture.y
    gesture.moved = Math.max(gesture.moved, Math.hypot(dx,dy))
    if (gesture.moved > TAP_MAX_MOVEMENT) clearTap()
    const stamp = now(event), dt = stamp - gesture.lastT
    if (dt > 0) {
      const sample = Math.max(-3, Math.min(3, (event.clientX - gesture.lastX) / dt))
      gesture.velocity += (sample - gesture.velocity) * (1 - Math.exp(-dt / 45))
    }
    gesture.lastX = event.clientX
    gesture.lastT = stamp
    if (selected() || gesture.selecting || !canSwipe() || nativeTouchSwipes && gesture.pointerType === 'touch') return
    if (!gesture.axis && gesture.moved > TAP_MAX_MOVEMENT) gesture.axis = Math.abs(dx) > Math.abs(dy) * 1.2 ? 'swipe' : 'scroll'
    if (gesture.axis !== 'swipe') return
    dragSurface(dx)
    // Capture only a committed horizontal drag; long presses remain selectable.
    try { el.setPointerCapture?.(gesture.id) } catch {}
    if (event.cancelable) event.preventDefault()
  }
  const onPointerUp = event => {
    const id = event.pointerId ?? 0
    points.delete(id)
    if (blocked) { if (!points.size) blocked = false; return }
    if (!gesture || gesture.id !== id) return
    const ended = gesture
    gesture = null
    releaseCapture(id)
    const dx = event.clientX - ended.x, dy = event.clientY - ended.y
    const durationMs = now(event) - ended.t
    const moved = Math.max(ended.moved, Math.hypot(dx,dy))
    const velocity = ended.velocity * Math.exp(-Math.max(0, now(event) - ended.lastT) / 65)
    settleSurface(velocity)
    if (interactive(event.target) || selected()) return clearTap()
    // The browser owns scrolling; Foliate also already owns touch page swipes.
    const scrolled = Math.abs(el.scrollLeft - ended.scrollLeft) > 2 || Math.abs(el.scrollTop - ended.scrollTop) > 2
    if (!scrolled && !ended.selecting && canSwipe() && !(nativeTouchSwipes && ended.pointerType === 'touch') && ended.axis !== 'scroll') {
      const swipe = classifySwipe({ dx,dy,durationMs,velocityX:velocity })
      if (swipe) { clearTap(); return navigate(swipe) }
    }
    if (moved > TAP_MAX_MOVEMENT || durationMs > TAP_MAX_DURATION || scrolled) return clearTap()
    const rect = el.getBoundingClientRect(), stamp = now(event)
    // tapZone lets a caller judge the tap against what the reader actually shows
    // when this element is much larger than the screen (a paginated EPUB section).
    const zone = tapZone?.(event) ?? classifyTapZone(event.clientX - rect.left, rect.width)
    // A page turn on the side edges acts at once. Only the centre waits for a
    // possible second tap (zoom), because that tap would otherwise hide the controls.
    if (!onToggleZoom || zone !== ZONE.CENTER) { clearTap(); return navigate(zone) }
    const doubleTap = lastTap && stamp - lastTap.time < DOUBLE_TAP_MAX_DELAY
      && Math.hypot(event.clientX - lastTap.x,event.clientY - lastTap.y) < 30
    if (doubleTap) { clearTap(); return onToggleZoom(event.clientX,event.clientY) }
    clearTap()
    lastTap = {time:stamp,x:event.clientX,y:event.clientY}
    // Wait only when double-tap zoom is supported: its first tap must not
    // hide the toolbar before the second finger tap.
    tapTimer = setTimeout(() => { tapTimer = 0; lastTap = null; if (!detached && !selected()) navigate(zone) }, DOUBLE_TAP_MAX_DELAY)
  }
  const onCancel = event => {
    // Touch browsers release implicit capture from the tapped child after
    // every pointerup. Only an interrupted capture owned by this drag cancels
    // the gesture; ordinary releases must preserve a pending double tap.
    if (event.type === 'lostpointercapture'
      && (!gesture || gesture.id !== (event.pointerId ?? 0) || event.target !== el)) return
    points.delete(event.pointerId ?? 0)
    abandon()
    if (!points.size) blocked = false
  }
  const onBlur = () => { points.clear(); blocked = false; abandon(); stopMotion() }
  const onVisibility = () => { if (doc.hidden) onBlur() }
  // A browser may cancel PointerEvents while Foliate's native TouchEvents
  // continue. Observe the committed native drag once to stop narration; leave
  // scrolling, velocity and page navigation entirely with the paginator.
  const onNativeTouchStart = event => {
    const touch = event.touches?.[0]
    nativeTouch = event.touches?.length === 1 && !interactive(event.target) && !selected()
      ? {x:touch.clientX,y:touch.clientY,notified:false} : null
  }
  const onNativeTouchMove = event => {
    if (event.touches?.length !== 1) { nativeTouch = null; return }
    if (!nativeTouch || nativeTouch.notified || !canSwipe() || selected()) return
    const touch = event.touches[0], dx = touch.clientX - nativeTouch.x, dy = touch.clientY - nativeTouch.y
    if (Math.hypot(dx,dy) < 22) return
    nativeTouch.notified = true
    onNativeSwipe?.()
  }
  const onNativeTouchEnd = event => { if (!event.touches?.length) nativeTouch = null }
  el.addEventListener('pointerdown', onPointerDown)
  el.addEventListener('pointermove', onPointerMove, {passive:false})
  el.addEventListener('pointerup', onPointerUp)
  el.addEventListener('pointercancel', onCancel)
  el.addEventListener('lostpointercapture', onCancel)
  view.addEventListener('blur', onBlur)
  doc?.addEventListener('visibilitychange', onVisibility)
  if (nativeTouchSwipes && onNativeSwipe) {
    el.addEventListener('touchstart',onNativeTouchStart,{passive:true})
    el.addEventListener('touchmove',onNativeTouchMove,{passive:true})
    el.addEventListener('touchend',onNativeTouchEnd)
    el.addEventListener('touchcancel',onNativeTouchEnd)
  }

  return () => {
    detached = true
    onBlur()
    el.removeEventListener('pointerdown', onPointerDown)
    el.removeEventListener('pointermove', onPointerMove)
    el.removeEventListener('pointerup', onPointerUp)
    el.removeEventListener('pointercancel', onCancel)
    el.removeEventListener('lostpointercapture', onCancel)
    view.removeEventListener('blur', onBlur)
    doc?.removeEventListener('visibilitychange', onVisibility)
    el.removeEventListener('touchstart',onNativeTouchStart)
    el.removeEventListener('touchmove',onNativeTouchMove)
    el.removeEventListener('touchend',onNativeTouchEnd)
    el.removeEventListener('touchcancel',onNativeTouchEnd)
  }
}
