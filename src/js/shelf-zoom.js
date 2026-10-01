/** Shelf navigation owns gestures only in isometric view. Book holds remain native. */
export function createShelfZoom({ root, scroller, getScene, isEnabled, onGestureStart }) {
  const element = document.createElement('div'); element.className = 'ihr-shelf-zoom';
  element.setAttribute('role','group'); element.setAttribute('aria-label','Zoom de la estantería');
  const buttons = [];
  const action = (label,text,run) => {
    const button = document.createElement('button'); button.type = 'button'; button.textContent = text;
    button.setAttribute('aria-label',label); button.title = label; button.addEventListener('click',run);
    element.append(button); buttons.push(button); return button;
  };
  action('Alejar estantería','−',()=>change(getScene().getInspectionZoom()/1.3));
  const value = document.createElement('output'); value.dataset.shelfZoomValue = ''; value.setAttribute('aria-label','Ampliación'); element.append(value);
  action('Acercar estantería','+',()=>change(getScene().getInspectionZoom()*1.3));
  action('Ver estantería completa','↺',()=>change(1));
  element.title = 'Pellizca o usa la rueda para acercar. Desplaza con dos dedos o arrastra el fondo.';
  let points = new Map(), gesture = null, suppressClick = false, clickTimer = 0;
  function sync() {
    const scene = getScene(), enabled = isEnabled();
    element.hidden = !enabled;
    if (!enabled) {
      for (const id of points.keys()) { try { scroller.releasePointerCapture(id); } catch {} }
      points.clear(); gesture = null; suppressClick = false; clearTimeout(clickTimer);
    }
    const zoom = scene?.getInspectionZoom?.() || 1;
    value.textContent = `${Math.round(zoom*100)}%`;
    buttons[0].disabled = !enabled || zoom <= 1.001;
    buttons[1].disabled = !enabled || zoom >= 3.999;
    buttons[2].disabled = !enabled || zoom <= 1.001;
    root.classList.toggle('is-shelf-zoomed',enabled && zoom > 1.001);
  }
  function change(zoom,x,y) { if (!isEnabled()) return; getScene().zoomTo(zoom,x,y); sync(); }
  const consume = event => { event.preventDefault(); event.stopPropagation(); };
  const center = () => {
    const [a,b] = [...points.values()];
    return {x:(a.x+b.x)/2,y:(a.y+b.y)/2,distance:Math.max(1,Math.hypot(a.x-b.x,a.y-b.y))};
  };
  const start = event => {
    if (!isEnabled() || event.target.closest('.ihr-shelf-catalog,.ihr-shelf-trash,.ihr-view-switch,.ihr-shelf-zoom')) return;
    points.set(event.pointerId,{x:event.clientX,y:event.clientY});
    if (points.size === 2) {
      onGestureStart(); gesture = {type:'pinch',...center()}; suppressClick = true;
      for (const id of points.keys()) { try { scroller.setPointerCapture(id); } catch {} }
      consume(event);
    } else if (points.size === 1 && getScene().getInspectionZoom() > 1.001 &&
      (event.button === 1 || event.shiftKey || !getScene().getObjectAtPoint(event.clientX,event.clientY))) {
      onGestureStart(); gesture = {type:'pan',x:event.clientX,y:event.clientY};
      try { scroller.setPointerCapture(event.pointerId); } catch {}
      consume(event);
    }
  };
  const move = event => {
    if (!points.has(event.pointerId)) return;
    points.set(event.pointerId,{x:event.clientX,y:event.clientY});
    if (!gesture || !isEnabled()) return;
    if (gesture.type === 'pinch' && points.size >= 2) {
      const next = center();
      getScene().zoomTo(getScene().getInspectionZoom()*next.distance/gesture.distance,gesture.x,gesture.y);
      getScene().panBy(next.x-gesture.x,next.y-gesture.y); gesture = {type:'pinch',...next};
    } else if (gesture.type === 'pan') {
      const dx = event.clientX-gesture.x, dy = event.clientY-gesture.y;
      if (Math.abs(dx)+Math.abs(dy)>1) suppressClick = true;
      getScene().panBy(dx,dy); gesture.x=event.clientX; gesture.y=event.clientY;
    }
    sync(); consume(event);
  };
  const end = event => {
    if (!points.has(event.pointerId)) return;
    const owned = Boolean(gesture);
    points.delete(event.pointerId);
    try { if (scroller.hasPointerCapture(event.pointerId)) scroller.releasePointerCapture(event.pointerId); } catch {}
    if (owned) {
      consume(event);
      if (points.size === 1) { const p=[...points.values()][0]; gesture={type:'pan',...p}; }
      else gesture=null;
    }
    if (!points.size) { clearTimeout(clickTimer); clickTimer=setTimeout(()=>{suppressClick=false;},250); }
  };
  const click = event => { if (suppressClick && !event.target.closest('.ihr-view-switch,.ihr-shelf-zoom')) consume(event); };
  const wheel = event => {
    if (!isEnabled()) return;
    const delta = event.deltaY*(event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? scroller.clientHeight : 1);
    if (!delta) return;
    onGestureStart(); change(getScene().getInspectionZoom()*Math.exp(-Math.max(-200,Math.min(200,delta))*.0025),event.clientX,event.clientY);
    event.preventDefault();
  };
  const key = event => {
    if (!isEnabled() || event.target.closest('input,textarea,select,[contenteditable]') || event.target.closest('.ihr-spine,.ihr-plant')) return;
    const scene=getScene(), zoom=scene.getInspectionZoom();
    if (event.key==='+' || event.key==='=') change(zoom*1.3);
    else if (event.key==='-') change(zoom/1.3);
    else if (event.key==='0') change(1);
    else if (zoom>1 && ['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)) {
      scene.panBy(event.key==='ArrowLeft' ? 50 : event.key==='ArrowRight' ? -50 : 0,event.key==='ArrowUp' ? 50 : event.key==='ArrowDown' ? -50 : 0);
    } else return;
    event.preventDefault(); sync();
  };
  scroller.addEventListener('pointerdown',start,true);
  scroller.addEventListener('pointermove',move,true);
  scroller.addEventListener('pointerup',end,true);
  scroller.addEventListener('pointercancel',end,true);
  scroller.addEventListener('click',click,true);
  scroller.addEventListener('wheel',wheel,{passive:false});
  root.addEventListener('keydown',key);
  sync();
  return {element,sync,destroy() {
    clearTimeout(clickTimer); points.clear(); gesture=null;
    scroller.removeEventListener('pointerdown',start,true); scroller.removeEventListener('pointermove',move,true);
    scroller.removeEventListener('pointerup',end,true); scroller.removeEventListener('pointercancel',end,true);
    scroller.removeEventListener('click',click,true); scroller.removeEventListener('wheel',wheel);
    root.removeEventListener('keydown',key); element.remove();
  }};
}
