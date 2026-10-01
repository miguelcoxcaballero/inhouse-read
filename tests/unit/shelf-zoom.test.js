import { afterEach, expect, it, vi } from 'vitest';
import { createShelfZoom } from '../../src/js/shelf-zoom.js';

const controllers=[];
afterEach(() => { for(const control of controllers.splice(0)) control.destroy(); document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function setup({zoom=1,width=800,height=800,reduced=false}={}) {
  const root=document.createElement('div'),scroller=document.createElement('div'); root.append(scroller); document.body.append(root);
  let clock=0,serial=0,enabled=true,view={zoom,panX:0,panY:0,width,height,centerX:200,centerY:300}; const frames=new Map();
  vi.spyOn(performance,'now').mockImplementation(()=>clock);
  vi.stubGlobal('requestAnimationFrame',run=>{const id=++serial;frames.set(id,run);return id;});
  vi.stubGlobal('cancelAnimationFrame',id=>frames.delete(id));
  vi.stubGlobal('matchMedia',()=>({matches:reduced}));
  const scene={getInspectionZoom:()=>view.zoom,getInspectionView:()=>({...view}),getObjectAtPoint:vi.fn(()=>null),
    setInspectionView:vi.fn((next,{moving})=>{
      view={...next}; if(!moving) {
        const x=(view.zoom-1)*width/2,y=(view.zoom-1)*height/2;
        view.panX=Math.max(-x,Math.min(x,view.panX));view.panY=Math.max(-y,Math.min(y,view.panY));
      } return {...view};
    })};
  const cancel=vi.fn(),control=createShelfZoom({root,scroller,getScene:()=>scene,isEnabled:()=>enabled,onGestureStart:cancel}); controllers.push(control);
  const pointer=(type,id,x,y,time=clock,pointerType='touch',node=scroller)=>{
    clock=time;const event=new Event(type,{bubbles:true,cancelable:true});
    Object.defineProperties(event,{timeStamp:{value:time},pointerType:{value:pointerType},pointerId:{value:id},clientX:{value:x},clientY:{value:y}});
    node.dispatchEvent(event);return event;
  };
  const step=(dt=16)=>{clock+=dt;const tasks=[...frames.values()];frames.clear();for(const run of tasks)run(clock);};
  return {root,scroller,scene,cancel,control,pointer,step,get view(){return view;},get pending(){return frames.size;},disable(){enabled=false;control.sync();}};
}
it('has no zoom controls and only finger gestures change the view',()=>{
  const h=setup();expect(h.root.querySelector('button,output')).toBeNull();expect(h.control.element).toBeUndefined();
  const wheel=new WheelEvent('wheel',{deltaY:-200,cancelable:true});h.scroller.dispatchEvent(wheel);expect(wheel.defaultPrevented).toBe(false);
  h.pointer('pointerdown',1,100,200,0,'mouse');h.pointer('pointermove',1,200,300,16,'mouse');h.step();
  expect(h.scene.setInspectionView).not.toHaveBeenCalled();
  h.pointer('pointerdown',1,100,200);h.pointer('pointerup',1,100,200);
  expect(h.cancel).not.toHaveBeenCalled();expect(h.pending).toBe(0);
});
it('batches a pinch into one render and keeps its focal point under the fingers',()=>{
  const h=setup();h.pointer('pointerdown',1,100,200,0);h.pointer('pointerdown',2,200,200,0);
  expect(h.cancel).toHaveBeenCalledOnce();
  h.pointer('pointermove',2,240,200,5);h.pointer('pointermove',2,280,200,10);
  expect(h.pointer('pointermove',2,300,200,15).defaultPrevented).toBe(true);
  expect(h.scene.setInspectionView).not.toHaveBeenCalled();expect(h.pending).toBe(1);h.step();
  expect(h.scene.setInspectionView).toHaveBeenCalledOnce();expect(h.view.zoom).toBe(2);
  expect(h.view.panX).toBe(100);expect(h.view.panY).toBe(100);
  expect(h.scene.setInspectionView.mock.calls[0][1]).toEqual({moving:true,renderNow:true});
});
it('keeps pinch zoom bounded and lets fingers switch naturally into panning',()=>{
  const h=setup({reduced:true});h.pointer('pointerdown',1,100,300,0);h.pointer('pointerdown',2,200,300,0);
  h.pointer('pointermove',2,1200,300,16);h.step();expect(h.view.zoom).toBe(4);
  h.pointer('pointerup',2,1200,300,35);const before=h.view.panY;
  h.pointer('pointermove',1,100,325,51);h.step();expect(h.view.panY).toBe(before+25);
  h.pointer('pointerup',1,100,325,70);expect(h.scene.setInspectionView.mock.lastCall[1].moving).toBe(false);
});
it('coasts after a flick, gradually slows, and stops immediately when touched again',()=>{
  const h=setup({zoom:2});h.pointer('pointerdown',1,100,200,0);h.pointer('pointermove',1,130,200,16);
  h.pointer('pointermove',1,170,200,32);h.step();h.pointer('pointerup',1,170,200,50);
  const release=h.view.panX;h.step();expect(h.view.panX).toBeGreaterThan(release);
  const first=h.view.panX;h.step();const early=h.view.panX-first;
  for(let i=0;i<10;i++)h.step();const later=h.view.panX;h.step();expect(h.view.panX-later).toBeLessThan(early);
  h.pointer('pointerdown',2,250,200,300);const stopped=h.view.panX;
  for(let i=0;i<20;i++)h.step();expect(h.view.panX).toBe(stopped);
});
it('resists the edge and settles back without bouncing past it',()=>{
  const h=setup({zoom:2,width:200});h.pointer('pointerdown',1,0,200,0);h.pointer('pointermove',1,500,200,200);h.step();
  expect(h.view.panX).toBeGreaterThan(100);expect(h.view.panX).toBeLessThan(148);
  h.pointer('pointerup',1,500,200,320);let previous=h.view.panX;
  for(let i=0;i<80;i++){h.step();expect(h.view.panX).toBeLessThanOrEqual(previous);expect(h.view.panX).toBeGreaterThanOrEqual(100);previous=h.view.panX;}
  expect(h.view.panX).toBe(100);expect(h.pending).toBe(0);
});
it('does not coast after a pause, cancellation, reduced motion or a mode change',()=>{
  for(const options of [{reduced:true},{}]) {
    const h=setup({zoom:2,...options});h.pointer('pointerdown',1,100,200,0);h.pointer('pointermove',1,160,200,16);h.step();
    h.pointer('pointerup',1,160,200,200);for(let i=0;i<80;i++)h.step();expect(h.view.panX).toBe(60);
    h.pointer('pointerdown',2,100,200,2000);h.pointer('pointermove',2,160,200,2016);h.step();
    h.pointer('pointercancel',2,160,200,2035);const cancelled=h.view.panX;for(let i=0;i<20;i++)h.step();expect(h.view.panX).toBe(cancelled);
    h.disable();expect(h.pending).toBe(0);expect(h.root.classList.contains('is-shelf-zoomed')).toBe(false);
    h.control.destroy();
  }
});
it('travels the same distance at 60 and 120 Hz',()=>{
  const travel=dt=>{
    const h=setup({zoom:2,width:3000});h.pointer('pointerdown',1,100,200,0);h.pointer('pointermove',1,120,200,16);
    h.pointer('pointermove',1,140,200,32);h.pointer('pointerup',1,140,200,40);
    for(let t=0;t<1800;t+=dt)h.step(dt);const x=h.view.panX;h.control.destroy();return x;
  };
  expect(Math.abs(travel(16)-travel(8))).toBeLessThan(1);
});

it('allows a pinch over the catalogue without opening it accidentally',()=>{
  const h=setup({reduced:true}),catalog=document.createElement('button');catalog.className='ihr-shelf-catalog';h.scroller.append(catalog);
  const open=vi.fn();catalog.addEventListener('click',open);
  h.pointer('pointerdown',1,100,300,0);h.pointer('pointerdown',2,200,300,0,'touch',catalog);
  h.pointer('pointermove',2,250,300,16);h.step();expect(h.view.zoom).toBe(1.5);
  h.pointer('pointerup',1,100,300,35);h.pointer('pointerup',2,250,300,35);catalog.click();expect(open).not.toHaveBeenCalled();
  h.pointer('pointerdown',3,200,300,100,'touch',catalog);h.pointer('pointerup',3,200,300,120,'touch',catalog);
  catalog.click();expect(open).toHaveBeenCalledOnce();
});

it('does not invent momentum from symmetric finger events arriving separately',()=>{
  const h=setup();h.pointer('pointerdown',1,100,300,0);h.pointer('pointerdown',2,200,300,0);
  h.pointer('pointermove',1,50,300,16);h.pointer('pointermove',2,250,300,16);h.step();
  h.pointer('pointerup',1,50,300,35);h.pointer('pointerup',2,250,300,35);
  const x=h.view.panX;for(let i=0;i<90;i++)h.step();expect(h.view.panX).toBe(x);
});
