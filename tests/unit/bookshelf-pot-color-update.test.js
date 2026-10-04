import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { createBookshelfScene } from '../../src/js/bookshelf-scene.js';

const gpu=vi.hoisted(()=>({scene:null,models:[]}));
vi.mock('../../src/js/book-model.js',async()=>{
  const Three=await import('three');let ratio=1;const size=new Three.Vector2();
  const renderer={domElement:document.createElement('canvas'),shadowMap:{},capabilities:{getMaxAnisotropy:()=>1},
    getPixelRatio:()=>ratio,setPixelRatio:value=>{ratio=value;},getSize:target=>target.copy(size),
    setSize:(width,height)=>size.set(width,height),render:scene=>{gpu.scene=scene;}};
  return {getBookRenderer:()=>renderer,lightBookScene(){},createBookModel(){throw new Error('The pot fixture contains no books');}};
});
vi.mock('../../src/js/shelf-plants.js',async importOriginal=>{
  const original=await importOriginal();return {...original,createShelfPlant:vi.fn(entry=>{
    const model=original.createShelfPlant(entry);gpu.models.push(model);return model;
  })};
});

let shelf,stage,scroller,node,entry,layout,frames,jobs;
const rect=(width,height)=>({left:0,top:60,width,height,right:width,bottom:60+height});
const changed=data=>shelf.updateLayout({...layout,entries:[{...entry,...data}]});
const finish=async()=>{while(jobs.length)jobs.shift()({timeRemaining:()=>100});await Promise.resolve();await Promise.resolve();};
beforeEach(()=>{
  gpu.scene=null;gpu.models=[];frames=new Map();jobs=[];let serial=0;
  vi.stubGlobal('requestAnimationFrame',callback=>{const id=++serial;frames.set(id,callback);return id;});
  vi.stubGlobal('cancelAnimationFrame',id=>frames.delete(id));
  vi.stubGlobal('requestIdleCallback',callback=>{jobs.push(callback);return jobs.length;});
  vi.spyOn(performance,'now').mockReturnValue(0);vi.stubGlobal('matchMedia',()=>({matches:false}));
  vi.spyOn(THREE.TextureLoader.prototype,'load').mockImplementation(()=>new THREE.Texture());
  vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockImplementation(()=>({
    createImageData:(width,height)=>({data:new Uint8ClampedArray(width*height*4)}),putImageData(){},drawImage(){},clearRect(){}
  }));
  scroller=document.createElement('div');stage=document.createElement('div');scroller.append(stage);document.body.append(scroller);
  Object.defineProperty(scroller,'clientHeight',{value:700});
  scroller.getBoundingClientRect=()=>rect(390,700);stage.getBoundingClientRect=()=>rect(390,750);
  node=document.createElement('button');node.className='ihr-plant';node.dataset.objectId='plant:fixture';stage.append(node);
  entry={kind:'plant',node,key:'plant:fixture',seed:'fern-shelf-fixture',variant:'fern',catalogId:'nephrolepis',potId:'akerbar',potColorId:'zinc',x:90,y:165,width:86,height:110};
  layout={stage,scroller,width:390,sceneWidth:390,height:750,rows:[{top:20,bottom:220}],entries:[entry]};
  shelf=createBookshelfScene(layout);shelf.canvas.getBoundingClientRect=()=>rect(390,700);shelf.flush();
});
afterEach(async()=>{shelf?.dispose();shelf=null;await finish();document.body.replaceChildren();vi.restoreAllMocks();vi.unstubAllGlobals();});

describe('shelf color-only plant reconciliation',()=>{
  it('keeps the exact botanical model, 666 leaves, buffers and materials while painting a new color',()=>{
    const model=gpu.models[0],pot=model.getObjectByName('ceramic-pot'),material=pot.material,map=material.map;
    const dispose=vi.spyOn(model.userData,'dispose');
    expect(model.userData.parts.filter(name=>/^leaf-\d+$/.test(name))).toHaveLength(666);
    const before=Number(shelf.canvas.dataset.modelCreations);
    changed({potColorId:'copper'});
    expect(gpu.models.length).toBe(1);expect(gpu.models[0]).toBe(model);
    expect(gpu.models).toEqual([model]);expect(Number(shelf.canvas.dataset.modelCreations)).toBe(before);
    expect(dispose).not.toHaveBeenCalled();expect(pot.material).toBe(material);expect(pot.material.map).not.toBe(map);
    expect(model.userData.potColorId).toBe('copper');expect(model.userData.entry.potColorId).toBe('copper');
    expect(model.userData.shelfPlantKeys).toContain('copper');
    const current=pot.material.map;changed({potColorId:'copper'});expect(pot.material.map).toBe(current);
    expect(gpu.models).toHaveLength(1);
  });
  it('rebinds the retained foliage hit target to the current node even when color changed in the same layout',()=>{
    shelf.setMode('isometric',{animate:false});shelf.flush();
    const model=gpu.models[0];
    const old=node.querySelector('.ihr-plant-foliage'),path=old.querySelector('path[fill="transparent"]').getAttribute('d');
    const replacement=node.cloneNode(false);stage.append(replacement);
    changed({node:replacement,potColorId:'bronze'});
    const current=replacement.querySelector('.ihr-plant-foliage');
    expect(gpu.models.length).toBe(1);expect(gpu.models[0]).toBe(model);
    expect(current).not.toBe(old);expect(old.isConnected).toBe(false);expect(node.querySelector('.ihr-plant-foliage')).toBeNull();
    expect(current.querySelector('path[fill="transparent"]').getAttribute('d')).toBe(path);
    expect(current.dataset.triangles).not.toBe('0');expect(gpu.models).toHaveLength(1);
    shelf.dispose();shelf=null;expect(current.isConnected).toBe(false);
  });
  it.each([
    ['width',96],['height',130],['variant','nephrolepis'],['catalogId','chamaedorea'],['potId','muskot'],['seed','different-growth']
  ])('preserves the original model replacement when %s changes together with color', (key,value)=>{
    const previous=gpu.models[0],dispose=vi.spyOn(previous.userData,'dispose'),before=Number(shelf.canvas.dataset.modelCreations);
    changed({[key]:value,potColorId:'copper'});
    expect(gpu.models).toHaveLength(2);expect(gpu.models[1]).not.toBe(previous);
    expect(dispose).toHaveBeenCalledTimes(1);expect(Number(shelf.canvas.dataset.modelCreations)).toBe(before+1);
    expect(gpu.models[1].userData.entry[key]).toBe(value);
  });
  it('updates placement in the same retained model while applying the color',()=>{
    const model=gpu.models[0],pose=model.position.toArray(),matrix=model.matrixWorld.toArray();
    changed({x:140,y:190,potColorId:'graphite'});
    expect(gpu.models.length).toBe(1);expect(gpu.models[0]).toBe(model);
    expect(gpu.models).toEqual([model]);expect(model.position.toArray()).not.toEqual(pose);
    expect(model.matrixWorld.toArray()).not.toEqual(matrix);expect(model.userData.entry.x).toBe(140);
    expect(model.userData.potColorId).toBe('graphite');
  });
  it('re-prepares the current inspection detail after cancelling a ready old-color plan held by dragging',async()=>{
    shelf.setMode('isometric',{animate:false});shelf.flush();node.classList.add('is-dragging');
    shelf.setInspectionView({zoom:1.3,panX:0,panY:0},{moving:false,renderNow:true});
    const model=gpu.models[0],live=model.userData.entry,old=live.plantQuality;
    expect(old).toBeTruthy();await finish();expect(old.ready).toBe(true);
    expect(model.userData.inspectionResolution).toBe(0);
    node.classList.remove('is-dragging');changed({potColorId:'copper'});
    expect(gpu.models.length).toBe(1);expect(gpu.models[0]).toBe(model);
    expect(gpu.models).toEqual([model]);expect(live.plantQuality).not.toBe(old);
    expect(live.plantQuality.resolution).toBe(256);
    await finish();shelf.flush();
    expect(model.userData.inspectionResolution).toBe(256);expect(model.userData.potColorId).toBe('copper');
    expect(model.getObjectByName('ceramic-pot').material.map.image.width).toBe(256);expect(old.plan.apply()).toBe(false);
  });
  it('uses the original replacement fallback for an unavailable or rejected in-place updater',()=>{
    const first=gpu.models[0],firstDispose=vi.spyOn(first.userData,'dispose');delete first.userData.updatePotColor;
    changed({potColorId:'graphite'});expect(gpu.models).toHaveLength(2);expect(firstDispose).toHaveBeenCalledTimes(1);
    const second=gpu.models[1],secondDispose=vi.spyOn(second.userData,'dispose');second.userData.updatePotColor=()=>false;
    changed({potColorId:'bronze'});expect(gpu.models).toHaveLength(3);expect(secondDispose).toHaveBeenCalledTimes(1);
  });
});
