import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { createBookshelfScene, projectPlantFoliage } from '../../src/js/bookshelf-scene.js';

// Unlike a draw-count-only double, this follows the real renderer's world
// matrix update. Extra walks before this update are measurable CPU work.
const gpu = vi.hoisted(() => ({ scene:null, renders:0 }));
vi.mock('../../src/js/book-model.js', async () => {
  const Three = await import('three');
  let ratio = 1;
  const size = new Three.Vector2();
  return { getBookRenderer:() => ({
    domElement:document.createElement('canvas'), shadowMap:{},
    capabilities:{ getMaxAnisotropy:() => 1 }, getPixelRatio:() => ratio,
    setPixelRatio:value => { ratio = value; }, getSize:target => target.copy(size),
    setSize:(width,height) => size.set(width,height),
    render(scene) { scene.updateMatrixWorld(); gpu.scene = scene; gpu.renders++; }
  }), lightBookScene() {},
  createBookModel(book,style,width,height,thickness) {
    const model = new Three.Group(); model.name = `book:${book.id}`;
    const binding = new Three.Mesh(new Three.BoxGeometry(thickness * .38,height,thickness),new Three.MeshStandardMaterial());
    binding.name = 'binding'; binding.position.x = -width / 2 - thickness * .19; model.add(binding);
    for (let index = 0; index < 4; index++) {
      const part = binding.clone(); part.name = `static-part-${index}`; part.position.z = index; model.add(part);
    }
    model.userData.dispose = () => {};
    return model;
  } };
});

let shelf, stage, scroller, entries, frames, clock;
const rect = (width,height) => ({ left:0,top:60,width,height,right:width,bottom:60 + height });
function nextFrame() {
  clock += 16; const callbacks = [...frames.values()]; frames.clear();
  for (const callback of callbacks) callback(clock);
}
function drain() { for (let index = 0; frames.size && index < 100; index++) nextFrame(); }
function makeShelf({ lamp = false } = {}) {
  const plantNode = document.createElement('button'); plantNode.className = 'ihr-plant'; stage.append(plantNode);
  entries = Array.from({ length:12 },(_,index) => {
    const node = document.createElement('button'); node.className = 'ihr-spine'; stage.append(node);
    return { node,book:{ id:String(index),title:`Book ${index}` },style:{ color:'#41694f',width:28 },
      x:40 + index % 4 * 75,y:130 + Math.floor(index / 4) * 220,width:100,height:180,thickness:28 };
  });
  entries.push({ kind:'plant',node:plantNode,key:'plant:matrices',seed:'matrices',catalogId:'monstera',variant:'monstera',
    potId:'muskot',x:240,y:130,width:86,height:110 });
  if (lamp) {
    const node = document.createElement('button'); node.className = 'ihr-lamp'; stage.append(node);
    entries.push({ kind:'lamp',node,key:'lamp:matrices',lampId:'mittled',mount:'undershelf',x:185,y:250,
      width:45,height:8,depth:45,isOn:true });
  }
  shelf = createBookshelfScene({ stage,scroller,entries,width:390,height:750,mode:'isometric',
    rows:[{ top:20,bottom:220 },{ top:260,bottom:460 },{ top:500,bottom:700 }] });
  shelf.canvas.getBoundingClientRect = () => rect(390,700); shelf.flush(); drain();
}
function staticBookPart() { return gpu.scene.getObjectByName('book:4').getObjectByName('static-part-0'); }
function expectCurrentWorldMatrices({ foliage = true } = {}) {
  const before = new Map();
  gpu.scene.traverse(object => before.set(object,object.matrixWorld.toArray()));
  gpu.scene.updateMatrixWorld(true);
  gpu.scene.traverse(object => expect(object.matrixWorld.toArray()).toEqual(before.get(object)));
  const plant = gpu.scene.children.flatMap(object => object.children).find(object => object.userData.shelfPlantKeys);
  if (foliage) expect(entries.find(entry => entry.kind === 'plant').node.querySelector('.ihr-plant-foliage > path').getAttribute('d') ===
    projectPlantFoliage(plant).path).toBe(true);
}
beforeEach(() => {
  gpu.scene = null; gpu.renders = 0; frames = new Map(); clock = 0; let serial = 0;
  vi.stubGlobal('requestAnimationFrame',callback => { const id = ++serial; frames.set(id,callback); return id; });
  vi.stubGlobal('cancelAnimationFrame',id => frames.delete(id));
  vi.spyOn(performance,'now').mockImplementation(() => clock);
  vi.spyOn(THREE.TextureLoader.prototype,'load').mockImplementation(() => new THREE.Texture());
  vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockImplementation(() => ({
    createImageData:(width,height) => ({ data:new Uint8ClampedArray(width * height * 4) }),putImageData() {},drawImage() {},clearRect() {}
  }));
  vi.stubGlobal('matchMedia',() => ({ matches:false }));
  scroller = document.createElement('div'); stage = document.createElement('div'); scroller.append(stage); document.body.append(scroller);
  Object.defineProperty(scroller,'clientHeight',{ value:700 });
  scroller.getBoundingClientRect = () => rect(390,700); stage.getBoundingClientRect = () => rect(390,750);
});
afterEach(() => { shelf?.dispose(); shelf = null; document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('world matrices of a retained shelf',() => {
  it('retains a painted room when only book metadata changes, then redraws a visible style change',() => {
    makeShelf();
    const entry = entries[4], before = gpu.renders;
    shelf.updateEntry(entry.node,{ ...entry.book,lastOpenedAt:123,geometryComplete:true },{ ...entry.style },undefined);
    nextFrame();
    expect(gpu.renders).toBe(before);
    expect(gpu.scene.getObjectByName('book:4').userData.entry.book.lastOpenedAt).toBe(123);
    shelf.updateEntry(entry.node,{ ...entry.book },{ ...entry.style,color:'#173d59' },undefined);
    nextFrame();
    expect(gpu.renders).toBe(before + 1);
    expectCurrentWorldMatrices();
  });

  it('updates book children for hit projection and rendering, without an earlier walk at the discarded pose',() => {
    makeShelf();
    const update = vi.spyOn(staticBookPart(),'updateMatrix');
    shelf.setMode('spine'); nextFrame();
    expect(update).toHaveBeenCalledTimes(2);
    expectCurrentWorldMatrices();
  });
  it('keeps the lamp touch cache without walking all book children again on a power change',() => {
    makeShelf({ lamp:true });
    const update = vi.spyOn(staticBookPart(),'updateMatrix');
    shelf.setLampPower(entries.at(-1).node,false,{ animate:false }); nextFrame();
    expect(update).toHaveBeenCalledTimes(2);
    expectCurrentWorldMatrices();
  });
  it('refreshes every raycast mesh after moving the room, and preserves exact foliage and GPU matrices',() => {
    makeShelf({ lamp:true });
    const path = () => entries.find(entry => entry.kind === 'plant').node.querySelector('.ihr-plant-foliage > path').getAttribute('d');
    const original = path();
    for (const zoom of [1.25,1.8,1]) {
      shelf.setInspectionView({ zoom,panX:10 * (zoom - 1),panY:6 * (zoom - 1) }); shelf.flush(); drain();
      expectCurrentWorldMatrices({ foliage:false });
    }
    expect(path() === original).toBe(true);
  });
});
