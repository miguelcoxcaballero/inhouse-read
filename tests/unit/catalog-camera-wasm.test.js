import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { bookletRect, catalogCameraFrames } from '../../src/js/catalog-camera.js';
import { createCatalogPreviewFrame } from '../../src/js/catalog-preview-frame.js';
import { needRustShelf } from '../../src/js/rust-shelf.js';

// Frozen camera formula from 306, independent of the Rust implementation.
const rect = (left,top,width,height) => ({ left,top,width,height,right:left+width,bottom:top+height });
function oldFlight(booklet,page,stage) {
  if (![booklet.width,booklet.height,page.width,page.height,stage.width,stage.height].every(n => Number.isFinite(n) && n > 0)) return null;
  const px = n => `${Math.round(n * 100) / 100}px`;
  const scale = Math.max(page.width/booklet.width,page.height/booklet.height);
  const x = page.left+page.width/2-stage.left-scale*(booklet.left+booklet.width/2-stage.left);
  const y = page.top+page.height/2-stage.top-scale*(booklet.top+booklet.height/2-stage.top);
  return { stage:`translate(${px(x)}, ${px(y)}) scale(${Math.round(scale*10000)/10000}, ${Math.round(scale*10000)/10000})`,
    page:`translate(${px(booklet.left-page.left)}, ${px(booklet.top-page.top)}) scale(${Math.round(booklet.width/page.width*10000)/10000}, ${Math.round(booklet.height/page.height*10000)/10000})` };
}
function oldFraming(camera,rect,size,padding) {
  const width=Math.max(1,rect.width),height=Math.max(1,rect.height),aspect=width/height;
  const half=Math.max(size.y/2,size.x/(2*aspect))*padding;
  camera.left=-half*aspect; camera.right=half*aspect; camera.top=half; camera.bottom=-half;
  camera.updateProjectionMatrix();
  return [width,height,false];
}
const random = seed => () => ((seed = Math.imul(seed,1664525)+1013904223 >>> 0) / 4294967296);

describe('real Rust catalogue camera', () => {
  it('preserves both exact CSS flight strings through random viewport/cover geometry and rounding boundaries', () => {
    const next = random(507), rectangles = () => rect(next()*4000-2000,next()*4000-2000,next()*1800+.000001,next()*1800+.000001);
    for (let i=0;i<2500;i++) {
      const args=[rectangles(),rectangles(),rectangles()];
      expect(catalogCameraFrames(...args)).toEqual(oldFlight(...args));
    }
    for (const offset of [-1.005,-.005,-Number.MIN_VALUE,-0,0,.005,1.005,1e21]) {
      const args=[rect(offset,offset,40,60),rect(0,0,374,800),rect(0,0,390,844)];
      expect(catalogCameraFrames(...args)).toEqual(oldFlight(...args));
    }
    for (const dimension of [0,-0,-2,NaN,Infinity,-Infinity,'40',null,undefined]) {
      for (let target=0;target<3;target++) for (const key of ['width','height']) {
        const args=[rect(0,0,40,60),rect(0,0,374,800),rect(0,0,390,844)];
        args[target][key]=dimension;
        expect(catalogCameraFrames(...args)).toBeNull();
      }
    }
  });

  it('retains DOM face parsing, space and Number coercion semantics and fallback edges', () => {
    const bounds=rect(-2.125,6.625,51,73);
    for (const face of ['4 6 30.5 40','0x10 1e1 4e1 3e1','  4 5','1 2 3 4 ','1 2  4','1 2 -3 4','1 2 Infinity 4','1 2 NaN 4','bad','']) {
      const values=face.split(' ').map(Number);
      const expected=values.length===4 && values.every(Number.isFinite) && values[2]>0 && values[3]>0
        ? rect(bounds.left+values[0],bounds.top+values[1],values[2],values[3]) : bounds;
      expect(bookletRect({ dataset:{ bookletFace:face },getBoundingClientRect:() => bounds })).toEqual(expected);
    }
    expect(bookletRect({ getBoundingClientRect:() => bounds })).toEqual(bounds);
  });

  it('keeps projection and inverse matrix bytes identical for all three preview paddings', () => {
    const next=random(305), renderer={ setSize:vi.fn() };
    const native=new THREE.OrthographicCamera(-80,80,90,-90,1,5000), reference=native.clone();
    const framing=createCatalogPreviewFrame();
    try {
      for (let i=0;i<1600;i++) {
        const bounds={ width:next()*1300-50,height:next()*1600-50 };
        const size={ x:next()*2000,y:next()*2500 };
        const padding=i%3===0 ? 1.13 : 1.14;
        const expectedSize=oldFraming(reference,bounds,size,padding);
        framing.apply(native,renderer,bounds,size,padding);
        expect(native.projectionMatrix.elements).toEqual(reference.projectionMatrix.elements);
        expect(native.projectionMatrixInverse.elements).toEqual(reference.projectionMatrixInverse.elements);
        expect(renderer.setSize).toHaveBeenLastCalledWith(...expectedSize);
      }
    } finally { framing.dispose(); }
  });

  it('keeps buffer and projection unchanged during tint/texture draws but reframes new geometry and resize', () => {
    const camera=new THREE.OrthographicCamera(-80,80,90,-90,1,1000), renderer={ setSize:vi.fn() };
    const matrix=vi.spyOn(camera,'updateProjectionMatrix'), frame=createCatalogPreviewFrame();
    try {
      for(let i=0;i<1000;i++) frame.apply(camera,renderer,{width:200,height:300},{x:60,y:100},1.14);
      expect(matrix).toHaveBeenCalledOnce(); expect(renderer.setSize).toHaveBeenCalledOnce();
      frame.apply(camera,renderer,{width:200,height:300},{x:150,y:200},1.14);
      expect(matrix).toHaveBeenCalledTimes(2); expect(renderer.setSize).toHaveBeenCalledOnce();
      frame.apply(camera,renderer,{width:240,height:300},{x:150,y:200},1.14);
      expect(matrix).toHaveBeenCalledTimes(3); expect(renderer.setSize).toHaveBeenCalledTimes(2);
      frame.apply(camera,renderer,{width:240,height:300},{x:150,y:200},1.13);
      expect(matrix).toHaveBeenCalledTimes(4); expect(renderer.setSize).toHaveBeenCalledTimes(2);
    } finally { frame.dispose(); }
  });

  it('keeps exact non-finite and signed-zero framing semantics instead of caching a different projection', () => {
    const camera=new THREE.OrthographicCamera(-80,80,90,-90,1,1000), reference=camera.clone();
    const renderer={setSize:vi.fn()}, frame=createCatalogPreviewFrame();
    try {
      for (const [x,y,width,height] of [[0,0,200,300],[-0,-0,200,300],[0,0,200,300],
        [Infinity,100,200,300],[60,NaN,200,300],[60,NaN,200,300],[60,100,NaN,300],
        [60,100,NaN,300],[60,100,200,Infinity],[60,100,200,300]]) {
        const rect={width,height},size={x,y};
        oldFraming(reference,rect,size,1.14); frame.apply(camera,renderer,rect,size,1.14);
        for(const key of ['left','right','top','bottom'])expect(camera[key]).toBe(reference[key]);
        expect(camera.projectionMatrix.elements).toEqual(reference.projectionMatrix.elements);
        expect(camera.projectionMatrixInverse.elements).toEqual(reference.projectionMatrixInverse.elements);
      }
    } finally { frame.dispose(); }
  });

  it('reuses its frame packet during resizes and releases every native handle when the studio closes', () => {
    const rust=needRustShelf(), baseline=rust.shelf_live_handles();
    for(let i=0;i<200;i++) {
      const frame=new rust.CatalogPreviewFrame();
      const packet=frame.update(200,300,60,100,1.14);
      expect(frame.update(200,300,60,100,1.14)).toBeUndefined();
      expect(frame.update(240,300,60,100,1.14)).toBe(packet);
      expect(packet[0]).toBe(240);
      frame.free();
    }
    expect(rust.shelf_live_handles()).toBe(baseline);
  });
});
