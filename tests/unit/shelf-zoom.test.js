import { afterEach, expect, it, vi } from 'vitest';
import { createShelfZoom } from '../../src/js/shelf-zoom.js';

afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); });
it('anchors wheel zoom, clamps its range, and leaves frontal scrolling available', () => {
  const root=document.createElement('div'), scroller=document.createElement('div'); root.append(scroller); document.body.append(root);
  let zoom=1, enabled=true;
  const scene={getInspectionZoom:()=>zoom,zoomTo:vi.fn((value)=>zoom=Math.max(1,Math.min(4,value))),panBy:vi.fn(),getObjectAtPoint:()=>null};
  const control=createShelfZoom({root,scroller,getScene:()=>scene,isEnabled:()=>enabled,onGestureStart:vi.fn()}); root.append(control.element);
  const wheel=new WheelEvent('wheel',{deltaY:-200,clientX:90,clientY:110,cancelable:true}); scroller.dispatchEvent(wheel);
  expect(wheel.defaultPrevented).toBe(true); expect(zoom).toBeGreaterThan(1);
  expect(scene.zoomTo).toHaveBeenLastCalledWith(expect.any(Number),90,110);
  for(let n=0;n<8;n++) control.element.querySelector('[aria-label="Acercar estantería"]').click();
  expect(zoom).toBe(4); expect(control.element.querySelector('[aria-label="Acercar estantería"]').disabled).toBe(true);
  control.element.querySelector('[aria-label="Ver estantería completa"]').click(); expect(zoom).toBe(1);
  enabled=false; control.sync(); expect(control.element.hidden).toBe(true);
  const frontal=new WheelEvent('wheel',{deltaY:-100,cancelable:true}); scroller.dispatchEvent(frontal); expect(frontal.defaultPrevented).toBe(false);
  control.destroy(); enabled=true; scroller.dispatchEvent(wheel); expect(zoom).toBe(1);
});

it('pinches around the midpoint and cancels pending book holds before navigating', () => {
  const root=document.createElement('div'), scroller=document.createElement('div'); root.append(scroller); document.body.append(root);
  let zoom=1; const cancel=vi.fn(),scene={getInspectionZoom:()=>zoom,zoomTo:vi.fn(value=>zoom=value),panBy:vi.fn(),getObjectAtPoint:()=>({})};
  const control=createShelfZoom({root,scroller,getScene:()=>scene,isEnabled:()=>true,onGestureStart:cancel});
  const pointer=(type,id,x,y)=>{ const event=new Event(type,{bubbles:true,cancelable:true}); Object.assign(event,{pointerId:id,clientX:x,clientY:y}); scroller.dispatchEvent(event); return event; };
  pointer('pointerdown',1,100,200); expect(cancel).not.toHaveBeenCalled();
  pointer('pointerdown',2,200,200); expect(cancel).toHaveBeenCalledOnce();
  expect(pointer('pointermove',2,300,200).defaultPrevented).toBe(true);
  expect(scene.zoomTo).toHaveBeenLastCalledWith(2,150,200); expect(scene.panBy).toHaveBeenLastCalledWith(50,0);
  pointer('pointerup',2,300,200); pointer('pointermove',1,110,210); expect(scene.panBy).toHaveBeenLastCalledWith(10,10);
  pointer('pointerup',1,110,210);
  scroller.append(control.element);
  control.element.querySelector('[aria-label="Ver estantería completa"]').click();
  expect(zoom).toBe(1); control.destroy();
});
