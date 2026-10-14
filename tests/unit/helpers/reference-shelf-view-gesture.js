/** A short horizontal swipe turns the cabinet; holds, scrolling and pinches
 * retain their existing owners. No render loop is needed to recognise it. */
export function createShelfViewGesture({ root, scroller, getMode, setMode, isEnabled, onGestureStart }) {
  const contacts = new Set();
  let candidate = null, suppressClick = false, clickTimer = 0;
  const consume = event => { event.preventDefault(); event.stopPropagation(); };
  const excluded = target => target.closest('input,select,textarea,a,.ihr-shelf-catalog,.ihr-shelf-trash,.ihr-plant-catalog,button:not(.ihr-spine):not(.ihr-plant):not(.ihr-lamp)');
  const threshold = () => Math.max(48, Math.min(96, (scroller.clientWidth || root.clientWidth || 390) * .16));
  const direction = (mode, dx) => mode === 'spine' ? dx < 0 : dx > 0;
  const start = event => {
    if (!['touch','pen'].includes(event.pointerType) || (event.button !== undefined && event.button !== 0)) return;
    contacts.add(event.pointerId);
    if (contacts.size !== 1 || event.isPrimary === false) { candidate = null; return; }
    if (!isEnabled() || excluded(event.target)) return;
    clearTimeout(clickTimer); suppressClick = false;
    candidate = { id:event.pointerId, x:event.clientX, y:event.clientY, mode:getMode(), claimed:false, rejected:false };
  };
  const move = event => {
    const swipe = candidate;
    if (!swipe || swipe.id !== event.pointerId) return;
    if (!isEnabled() || contacts.size !== 1 || getMode() !== swipe.mode) { candidate = null; return; }
    const dx = event.clientX - swipe.x, dy = event.clientY - swipe.y;
    if (!swipe.claimed) {
      if (Math.abs(dy) > 12 && Math.abs(dy) > Math.abs(dx)) swipe.rejected = true;
      if (swipe.rejected || Math.abs(dx) < 14 || Math.abs(dx) < Math.abs(dy) * 1.5 || !direction(swipe.mode, dx)) return;
      // Claim before the semantic book receives this move. Its hold is
      // cancelled once; releasing the swipe must never open that book.
      swipe.claimed = true; suppressClick = true;
      onGestureStart(event);
      try { scroller.setPointerCapture?.(event.pointerId); } catch {}
    }
    consume(event);
  };
  const end = event => {
    contacts.delete(event.pointerId);
    const swipe = candidate;
    if (!swipe || swipe.id !== event.pointerId) return;
    candidate = null;
    if (!swipe.claimed) return;
    consume(event);
    try { scroller.releasePointerCapture?.(event.pointerId); } catch {}
    const dx = event.clientX - swipe.x, dy = event.clientY - swipe.y;
    if (event.type !== 'pointercancel' && isEnabled() && getMode() === swipe.mode &&
      Math.abs(dx) >= threshold() && Math.abs(dx) > Math.abs(dy) * 1.5 && direction(swipe.mode, dx)) {
      setMode(swipe.mode === 'spine' ? 'isometric' : 'spine');
    }
    clearTimeout(clickTimer); clickTimer = setTimeout(() => { suppressClick = false; }, 400);
  };
  const click = event => { if (suppressClick && event.detail) consume(event); };
  const key = event => {
    if (event.target !== root || !isEnabled() || event.ctrlKey || event.altKey || event.metaKey || event.shiftKey || event.repeat) return;
    const mode = event.key === 'ArrowLeft' ? 'isometric' : event.key === 'ArrowRight' ? 'spine' : null;
    if (!mode) return;
    consume(event); setMode(mode);
  };
  scroller.addEventListener('pointerdown', start, true);
  scroller.addEventListener('pointermove', move, true);
  scroller.addEventListener('pointerup', end, true);
  scroller.addEventListener('pointercancel', end, true);
  scroller.addEventListener('click', click, true);
  root.addEventListener('keydown', key);
  return { destroy() {
    candidate = null; contacts.clear(); clearTimeout(clickTimer);
    scroller.removeEventListener('pointerdown', start, true);
    scroller.removeEventListener('pointermove', move, true);
    scroller.removeEventListener('pointerup', end, true);
    scroller.removeEventListener('pointercancel', end, true);
    scroller.removeEventListener('click', click, true);
    root.removeEventListener('keydown', key);
  } };
}
