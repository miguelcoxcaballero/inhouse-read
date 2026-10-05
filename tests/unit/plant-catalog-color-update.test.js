import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { createPlantCatalogPreview } from '../../src/js/plant-catalog-preview.js';

const driver=vi.hoisted(()=>({ models:[],renderers:[],accept:true }));
vi.mock('three',async importOriginal => {
  const three=await importOriginal();
  return {...three,WebGLRenderer:class {
    constructor(){this.domElement=document.createElement('canvas');this.render=vi.fn();this.setSize=vi.fn();this.setPixelRatio=vi.fn();this.dispose=vi.fn();this.forceContextLoss=vi.fn();driver.renderers.push(this);}
  },PMREMGenerator:class {fromScene(){return {texture:new three.Texture(),dispose(){}};}dispose(){}}};
});
vi.mock('three/addons/environments/RoomEnvironment.js',async()=>{
  const three=await import('three');return {RoomEnvironment:class extends three.Group {dispose(){}}};
});
vi.mock('../../src/js/shelf-plants.js',async()=>{
  const three=await import('three');return {createShelfPlant:vi.fn(selection=>{
    const model=new three.Group();model.add(new three.Mesh(new three.BoxGeometry(60,100,60),new three.MeshStandardMaterial()));
    model.userData.selection=selection;model.userData.dispose=vi.fn();
    model.userData.updatePotColor=vi.fn(colorId=>{if(!driver.accept)return false;model.userData.selection={...model.userData.selection,potColorId:colorId};return true;});
    driver.models.push(model);return model;
  })};
});
// A new plant is built in a task after the frame and shown once its shaders are
// linked; here linking is instant, so a draw settles the frame, the build and the next frame.
vi.mock('../../src/js/gpu-programs.js',()=>({retainPrograms:()=>{},whenProgramsReady:(renderer,scene,camera,object,done)=>{done();return()=>{};}}));
let preview,frames,host;
const selection={catalogId:'nephrolepis',potId:'akerbar',potColorId:'zinc'};
const frame=()=>{const callbacks=[...frames.values()];frames.clear();callbacks.forEach(callback=>callback(16));};
const draw=()=>{frame();vi.runOnlyPendingTimers();frame();};
beforeEach(()=>{
  vi.useFakeTimers({toFake:['setTimeout','clearTimeout']});
  driver.models=[];driver.renderers=[];driver.accept=true;frames=new Map();let serial=0;
  vi.stubGlobal('WebGLRenderingContext',function(){});
  vi.stubGlobal('requestAnimationFrame',callback=>{const id=++serial;frames.set(id,callback);return id;});
  vi.stubGlobal('cancelAnimationFrame',id=>frames.delete(id));vi.stubGlobal('ResizeObserver',class{observe(){}disconnect(){}});
  host=document.createElement('div');host.getBoundingClientRect=()=>({width:200,height:300});document.body.append(host);
  preview=createPlantCatalogPreview(host);preview.update(selection);draw();
});
afterEach(()=>{preview.dispose();document.body.replaceChildren();vi.useRealTimers();vi.restoreAllMocks();vi.unstubAllGlobals();});

describe('catalog color-only updates without re-creating a botanical model',()=>{
  it('keeps the same model, renderer, bounds and backing size for every color preview',()=>{
    const model=driver.models[0],bounds=vi.spyOn(THREE.Box3.prototype,'setFromObject');
    for(const potColorId of ['graphite','copper','bronze']){preview.update({...selection,potColorId});draw();}
    expect(driver.models).toEqual([model]);expect(driver.renderers).toHaveLength(1);
    expect(model.userData.updatePotColor).toHaveBeenCalledTimes(3);expect(model.userData.dispose).not.toHaveBeenCalled();
    expect(bounds).not.toHaveBeenCalled();expect(driver.renderers[0].setSize).toHaveBeenCalledTimes(1);
    expect(driver.renderers[0].render).toHaveBeenCalledTimes(4);expect(host.dataset.potColorId).toBe('bronze');
  });
  it('keeps the latest color while hidden and paints it on re-opening without reconstructing',()=>{
    const model=driver.models[0];preview.setActive(false);
    preview.update({...selection,potColorId:'copper'});preview.update({...selection,potColorId:'bronze'});
    expect(driver.models).toEqual([model]);expect(frames.size).toBe(0);expect(driver.renderers[0].render).toHaveBeenCalledTimes(1);
    preview.setActive(true);draw();expect(driver.renderers[0].render).toHaveBeenCalledTimes(2);
    expect(model.userData.selection.potColorId).toBe('bronze');
  });
  it('rebuilds for a different physical pot, species or any additional selection field',()=>{
    for(const change of [{potId:'muskot'},{catalogId:'monstera'},{seed:'new-growth'}]){
      const previous=driver.models.at(-1);preview.update({...selection,...change});draw();
      expect(driver.models.at(-1)).not.toBe(previous);expect(previous.userData.dispose).toHaveBeenCalledTimes(1);
    }
    expect(driver.models).toHaveLength(4);
  });
  it('preserves the original rebuild fallback when the color updater is unavailable or rejects',()=>{
    const first=driver.models[0];driver.accept=false;preview.update({...selection,potColorId:'graphite'});draw();
    expect(driver.models).toHaveLength(2);expect(first.userData.dispose).toHaveBeenCalledTimes(1);
    const second=driver.models[1];delete second.userData.updatePotColor;
    preview.update({...selection,potColorId:'bronze'});draw();
    expect(driver.models).toHaveLength(3);expect(second.userData.dispose).toHaveBeenCalledTimes(1);
  });
});
