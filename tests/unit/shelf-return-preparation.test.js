import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';
import * as THREE from 'three';
import { createBookshelfScene } from '../../src/js/bookshelf-scene.js';

const gpu = vi.hoisted(() => ({ renderer:null,scene:null }));
vi.mock('../../src/js/book-model.js',async () => {
  const Three = await import('three');
  let ratio = 1;
  const size = new Three.Vector2();
  gpu.renderer = { domElement:document.createElement('canvas'),shadowMap:{},
    capabilities:{ getMaxAnisotropy:() => 1 },getPixelRatio:() => ratio,
    setPixelRatio:vi.fn(value => { ratio = value; }),getSize:target => target.copy(size),
    setSize:vi.fn((width,height) => { size.set(width,height); }),
    render:vi.fn(scene => { gpu.scene = scene; }) };
  return { getBookRenderer:() => gpu.renderer,lightBookScene() {},
    createBookModel(book,style,width,height,thickness,_cover,options = {}) {
      const model = new Three.Group(); model.name = `book:${book.id}`;
      const binding = new Three.Mesh(new Three.BoxGeometry(thickness * .38,height,thickness),new Three.MeshStandardMaterial());
      binding.name = 'binding'; binding.position.x = -width / 2 - thickness * .19; model.add(binding);
      model.userData.overview = Boolean(options.overview);
      model.userData.inspectionResolution = options.inspectionResolution || 0;
      model.userData.dispose = vi.fn();
      return model;
    } };
});

let shelf,stage,scroller,node,frames,clock,scroll,height,visibility;
const rect = (left,top,width,height) => ({ left,top,width,height,right:left + width,bottom:top + height });
function drain(limit = 120) {
  let count = 0;
  while (frames.size && count++ < limit) {
    clock += 16;
    const current = [...frames.values()]; frames.clear();
    for (const callback of current) callback(clock);
  }
  expect(count).toBeLessThan(limit);
}
const renders = () => gpu.renderer.render.mock.calls.length;
const model = () => gpu.scene.getObjectByName('book:one');

beforeEach(async () => {
  clock = scroll = 0; height = 700; visibility = 'visible'; frames = new Map();
  let serial = 0;
  vi.stubGlobal('requestAnimationFrame',callback => { const id = ++serial; frames.set(id,callback); return id; });
  vi.stubGlobal('cancelAnimationFrame',id => frames.delete(id));
  vi.spyOn(performance,'now').mockImplementation(() => clock);
  vi.spyOn(document,'visibilityState','get').mockImplementation(() => visibility);
  vi.spyOn(THREE.TextureLoader.prototype,'load').mockImplementation(() => new THREE.Texture());
  vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockImplementation(() => ({
    createImageData:(width,height) => ({ data:new Uint8ClampedArray(width * height * 4) }),
    putImageData() {},drawImage() {},clearRect() {}
  }));
  vi.stubGlobal('matchMedia',() => ({ matches:false }));
  scroller = document.createElement('div'); stage = document.createElement('div');
  scroller.append(stage); document.body.append(scroller);
  Object.defineProperty(scroller,'clientHeight',{ get:() => height });
  Object.defineProperty(scroller,'scrollTop',{ get:() => scroll,set:value => { scroll = Math.max(0,Number(value) || 0); } });
  scroller.getBoundingClientRect = () => rect(20,60,390,height);
  stage.getBoundingClientRect = () => rect(20,60 - scroll,390,parseFloat(stage.style.height) || 500);
  node = document.createElement('button'); node.className = 'ihr-spine'; node.dataset.bookId = 'one'; stage.append(node);
  shelf = createBookshelfScene({ stage,scroller,width:390,height:500,
    rows:[{ top:20,bottom:220 },{ top:260,bottom:460 }],
    entries:[{ node,book:{ id:'one',title:'Same book' },style:{ color:'#41694f',width:28 },x:75,y:130,width:100,height:180,thickness:28 }] });
  shelf.canvas.getBoundingClientRect = () => rect(20,60,390,height);
  await Promise.resolve();
  shelf.flush({ force:true }); drain();
  gpu.renderer.render.mockClear(); gpu.renderer.setSize.mockClear(); gpu.renderer.setPixelRatio.mockClear();
});

afterEach(() => {
  shelf?.dispose(); document.body.replaceChildren();
  vi.restoreAllMocks(); vi.unstubAllGlobals();
});

describe('prepare the returning shelf beneath its opaque page',()=>{
 it('keeps dirty projections without painting or scheduling background frames',()=>{
  shelf.invalidate(); expect(frames.size).toBe(1); shelf.setPaintHeld(true);
  expect(frames.size).toBe(0); node.classList.add('is-away'); shelf.flush();
  expect(renders()).toBe(0); expect(model().visible).toBe(false); expect(frames.size).toBe(0);
  shelf.setPaintHeld(false); expect(frames.size).toBe(1); shelf.flush();
  expect(renders()).toBe(1); expect(model().visible).toBe(false); expect(shelf.flush()).toBe(false);
 });
 it('provides the correct docking projection after a held scroll',()=>{
  const before=shelf.getBookPose(node); shelf.setPaintHeld(true);
  scroller.scrollTop=40; scroller.dispatchEvent(new Event('scroll')); shelf.flush();
  expect(shelf.getBookPose(node).centerY).toBeCloseTo(before.centerY-40,5);
  expect(shelf.getReturnPose(node)).toBeTruthy(); expect(renders()).toBe(0);
  shelf.setPaintHeld(false); shelf.flush(); expect(renders()).toBe(1);
 });
 it('retains theme changes for its first real paint',()=>{
  shelf.setPaintHeld(true); document.documentElement.dataset.theme='dark'; shelf.flush();
  expect(renders()).toBe(0); expect(frames.size).toBe(0);
  shelf.setPaintHeld(false); shelf.flush(); expect(renders()).toBe(1);
  delete document.documentElement.dataset.theme;
 });
 it('cancels the pending GPU work if the prepared owner is disposed',()=>{
  shelf.setPaintHeld(true); shelf.invalidate(); shelf.flush(); shelf.dispose();
  shelf.setPaintHeld(false); expect(frames.size).toBe(0); expect(renders()).toBe(0);
 });
 it('coalesces several held record changes into one real room frame',()=>{
  shelf.setPaintHeld(true);
  shelf.updateEntry(node,{id:'one',title:'First title'},{color:'#41694f',width:28},null); shelf.flush();
  shelf.updateEntry(node,{id:'one',title:'Final title'},{color:'#41694f',width:28},null); shelf.flush();
  expect(renders()).toBe(0); shelf.setPaintHeld(false); shelf.flush(); expect(renders()).toBe(1);
 });
});
