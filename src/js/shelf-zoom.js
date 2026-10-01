/** Touch navigation is sampled once per display frame; book holds remain native. */
export function createShelfZoom({ root, scroller, getScene, isEnabled, onGestureStart }) {
  const points = new Map(), reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)') || {matches:false};
  const clamp = (value,min,max) => Math.max(min,Math.min(max,value));
  const excluded = target => target.closest('.ihr-view-switch');
  let gesture = null, target = null, frame = 0, coast = null, lastFrame = 0;
  let suppressClick = false, clickTimer = 0, destroyed = false;
  const consume = event => { event.preventDefault(); event.stopPropagation(); };
  const midpoint = () => {
    const [a,b] = [...points.values()];
    return {x:(a.x+b.x)/2,y:(a.y+b.y)/2,distance:Math.max(1,Math.hypot(a.x-b.x,a.y-b.y))};
  };
  const limits = view => ({x:(view.zoom-1)*view.width/2,y:(view.zoom-1)*view.height/2});
  const resist = (value,limit) => {
    const over = Math.max(0,Math.abs(value)-limit);
    return over ? Math.sign(value)*(limit+48*(1-Math.exp(-over/48))) : value;
  };
  const publish = moving => {
    if (!target || !getScene()) return;
    target = getScene().setInspectionView(target,{moving,renderNow:true});
    root.classList.toggle('is-shelf-zoomed',target.zoom>1.001 && isEnabled());
  };
  const axis = (position,velocity,limit,dt) => {
    const bound = clamp(position,-limit,limit), offset = position-bound;
    if (offset || (position>=limit && velocity>0) || (position<=-limit && velocity<0)) {
      // Exact critically damped spring: no frame-rate-dependent edge bounce.
      const omega=.018, decay=Math.exp(-omega*dt), impulse=velocity+omega*offset;
      return [bound+(offset+impulse*dt)*decay,(velocity-omega*impulse*dt)*decay];
    }
    const decay=Math.exp(-dt/180);
    const next=position+velocity*180*(1-decay);
    if (Math.abs(next)>limit && velocity) {
      const edge=Math.sign(velocity)*limit;
      const hit=-180*Math.log(1-(edge-position)/(velocity*180));
      return axis(edge,velocity*Math.exp(-hit/180),limit,Math.max(0,dt-hit));
    }
    return [next,velocity*decay];
  };
  function sampleVelocity() {
    if (!gesture?.sampleDirty) return;
    // Sample the final midpoint once per frame, after both fingers' events.
    // Individual pointer events otherwise create false velocity in a pinch.
    const elapsed=Math.max(1,gesture.lastTime-gesture.sampleTime), blend=1-Math.exp(-elapsed/40);
    gesture.vx+=(clamp((gesture.currentX-gesture.sampleX)/elapsed,-2.4,2.4)-gesture.vx)*blend;
    gesture.vy+=(clamp((gesture.currentY-gesture.sampleY)/elapsed,-2.4,2.4)-gesture.vy)*blend;
    gesture.sampleX=gesture.currentX; gesture.sampleY=gesture.currentY;
    gesture.sampleTime=gesture.lastTime; gesture.sampleDirty=false;
  }
  function tick(now) {
    frame=0;
    if (destroyed || !isEnabled()) { stop(); return; }
    sampleVelocity();
    if (coast) {
      const dt=Math.max(0,now-lastFrame), limit=limits(target);
      [target.panX,coast.x]=axis(target.panX,coast.x,limit.x,dt);
      [target.panY,coast.y]=axis(target.panY,coast.y,limit.y,dt);
      lastFrame=now;
      if (Math.hypot(coast.x,coast.y)<.015 &&
        Math.abs(target.panX-clamp(target.panX,-limit.x,limit.x))<.35 &&
        Math.abs(target.panY-clamp(target.panY,-limit.y,limit.y))<.35) {
        target.panX=clamp(target.panX,-limit.x,limit.x); target.panY=clamp(target.panY,-limit.y,limit.y);
        coast=null; publish(false); return;
      }
    }
    publish(Boolean(gesture || coast));
    if (coast) schedule();
  }
  function schedule() { if (!frame && !destroyed) frame=requestAnimationFrame(tick); }
  function stop() {
    const moving=Boolean(frame || coast || gesture);
    cancelAnimationFrame(frame); frame=0; coast=null; gesture=null;
    if (target && moving) publish(false);
    target=null;
  }
  function sync() {
    if (!isEnabled()) {
      stop();
      for (const id of points.keys()) { try { scroller.releasePointerCapture(id); } catch {} }
      points.clear(); suppressClick=false; clearTimeout(clickTimer);
    }
    root.classList.toggle('is-shelf-zoomed',isEnabled() && (getScene()?.getInspectionZoom?.() || 1)>1.001);
  }
  const begin = (type,point,time) => {
    coast=null; onGestureStart();
    target ||= getScene().getInspectionView();
    gesture={type,...point,origin:{...target},lastTime:time,sampleTime:time,
      currentX:point.x,currentY:point.y,sampleX:point.x,sampleY:point.y,sampleDirty:false,vx:0,vy:0};
    for (const id of points.keys()) { try { scroller.setPointerCapture(id); } catch {} }
  };
  const start = event => {
    if (event.pointerType!=='touch' || !isEnabled() || excluded(event.target)) return;
    if (!points.size) { stop(); suppressClick=false; clearTimeout(clickTimer); }
    points.set(event.pointerId,{x:event.clientX,y:event.clientY});
    if (points.size===2) {
      begin('pinch',midpoint(),event.timeStamp); suppressClick=true; consume(event);
    } else if (points.size===1 && getScene().getInspectionZoom()>1.001 && !event.target.closest('.ihr-shelf-catalog') &&
      !getScene().getObjectAtPoint(event.clientX,event.clientY)) {
      begin('pan',points.get(event.pointerId),event.timeStamp); consume(event);
    }
  };
  const move = event => {
    if (!points.has(event.pointerId)) return;
    points.set(event.pointerId,{x:event.clientX,y:event.clientY});
    if (!gesture || !isEnabled()) return;
    const next=gesture.type==='pinch' && points.size>=2 ? midpoint() : points.get(event.pointerId);
    const zoom=gesture.type==='pinch' ? clamp(gesture.origin.zoom*next.distance/gesture.distance,1,4) : gesture.origin.zoom;
    const ratio=zoom/gesture.origin.zoom;
    const limit=limits({...target,zoom});
    target={...target,zoom,
      panX:resist(gesture.origin.panX*ratio+(1-ratio)*(gesture.x-target.centerX)+next.x-gesture.x,limit.x),
      panY:resist(gesture.origin.panY*ratio+(1-ratio)*(gesture.y-target.centerY)+next.y-gesture.y,limit.y)};
    gesture.currentX=next.x; gesture.currentY=next.y; gesture.lastTime=event.timeStamp; gesture.sampleDirty=true;
    if (Math.hypot(next.x-gesture.x,next.y-gesture.y)>3) suppressClick=true;
    schedule(); consume(event);
  };
  const end = event => {
    if (!points.has(event.pointerId)) return;
    points.delete(event.pointerId);
    try { if (scroller.hasPointerCapture(event.pointerId)) scroller.releasePointerCapture(event.pointerId); } catch {}
    if (gesture) {
      sampleVelocity(); consume(event);
      if (points.size>=2) begin('pinch',midpoint(),event.timeStamp);
      else if (points.size===1 && event.type!=='pointercancel') {
        const point=[...points.values()][0];
        gesture={type:'pan',...point,origin:{...target},lastTime:event.timeStamp,sampleTime:event.timeStamp,
          currentX:point.x,currentY:point.y,sampleX:point.x,sampleY:point.y,sampleDirty:false,vx:gesture.vx,vy:gesture.vy};
      } else {
        const fresh=event.timeStamp-gesture.lastTime<80 && event.type!=='pointercancel' && !reducedMotion.matches;
        coast={x:fresh ? gesture.vx : 0,y:fresh ? gesture.vy : 0}; gesture=null;
        if (reducedMotion.matches || event.type==='pointercancel') { coast=null; publish(false); }
        else { lastFrame=performance.now(); schedule(); }
      }
    }
    if (!points.size) {
      clearTimeout(clickTimer); clickTimer=setTimeout(()=>{suppressClick=false;},250);
    }
  };
  const click = event => { if (suppressClick && !excluded(event.target)) consume(event); };
  scroller.addEventListener('pointerdown',start,true);
  scroller.addEventListener('pointermove',move,true);
  scroller.addEventListener('pointerup',end,true);
  scroller.addEventListener('pointercancel',end,true);
  scroller.addEventListener('click',click,true);
  sync();
  return {sync,destroy() {
    stop(); destroyed=true; clearTimeout(clickTimer);
    for (const id of points.keys()) { try { scroller.releasePointerCapture(id); } catch {} }
    points.clear(); root.classList.remove('is-shelf-zoomed');
    scroller.removeEventListener('pointerdown',start,true); scroller.removeEventListener('pointermove',move,true);
    scroller.removeEventListener('pointerup',end,true); scroller.removeEventListener('pointercancel',end,true);
    scroller.removeEventListener('click',click,true);
  }};
}
