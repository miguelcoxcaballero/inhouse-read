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

describe('shelf presentation and synchronous projection scheduling',() => {
  it('reuses a clean painted scene for repeated flush and docking-pose requests',() => {
    const original = model(), count = shelf.canvas.dataset.renderCount;
    const first = shelf.getReturnPose(node);
    expect(shelf.flush()).toBe(false);
    expect(shelf.getReturnPose(node)).toEqual(first);
    expect(shelf.flush()).toBe(false);
    expect(renders()).toBe(0);
    expect(gpu.renderer.setSize).not.toHaveBeenCalled();
    expect(shelf.canvas.dataset.renderCount).toBe(count);
    expect(model()).toBe(original);
  });

  it('consumes one queued paint once without leaving a second RAF after a synchronous flush',() => {
    shelf.invalidate(); shelf.invalidate(); shelf.invalidate();
    expect(frames.size).toBe(1);
    expect(shelf.flush()).toBe(true);
    expect(frames.size).toBe(0);
    expect(shelf.flush()).toBe(false);
    expect(renders()).toBe(1);
  });

  it('observes is-away immediately before MutationObserver runs and retains the painted book model',() => {
    const original = model();
    node.classList.add('is-away');
    expect(shelf.flush()).toBe(true);
    expect(original.visible).toBe(false);
    expect(shelf.flush()).toBe(false);
    node.classList.remove('is-away');
    expect(shelf.flush()).toBe(true);
    expect(model()).toBe(original);
    expect(original.visible).toBe(true);
    expect(renders()).toBe(2);
  });

  it('updates a resized native viewport synchronously even before a resize event',() => {
    height = 620;
    expect(shelf.flush()).toBe(true);
    expect(shelf.canvas.style.height).toBe('620px');
    expect(shelf.canvas.height).toBe(620);
    expect(shelf.flush()).toBe(false);
    expect(renders()).toBe(1);
  });

  it('updates native hit-control changes immediately rather than treating their scene as clean',() => {
    shelf.setMode('isometric',{ animate:false }); shelf.flush(); drain();
    const cover = node.querySelector('[data-shelf-cover-hit]');
    node.disabled = true;
    expect(shelf.flush()).toBe(true);
    expect(cover.style.pointerEvents).toBe('none');
    node.disabled = false;
    expect(shelf.flush()).toBe(true);
    expect(cover.style.pointerEvents).toBe('inherit');
    node.style.pointerEvents = 'none';
    expect(shelf.flush()).toBe(true);
    expect(cover.style.pointerEvents).toBe('inherit');
    expect(shelf.flush()).toBe(false);
  });

  it('retains hidden dirty state and coalesces it into one full paint on presentation',() => {
    const original = model();
    shelf.setPresentationActive(false);
    shelf.invalidate(); shelf.invalidate();
    node.classList.add('is-away');
    expect(shelf.flush()).toBe(false);
    expect(frames.size).toBe(0);
    expect(renders()).toBe(0);
    shelf.setPresentationActive(true);
    expect(frames.size).toBe(1);
    expect(shelf.flush()).toBe(true);
    expect(frames.size).toBe(0);
    expect(original.visible).toBe(false);
    node.classList.remove('is-away'); shelf.flush();
    expect(model()).toBe(original);
    expect(original.visible).toBe(true);
  });

  it('suspends stationary background frames and commits the latest theme on visibility',() => {
    shelf.invalidate(); expect(frames.size).toBe(1);
    visibility = 'hidden'; document.dispatchEvent(new Event('visibilitychange'));
    expect(frames.size).toBe(0);
    document.documentElement.dataset.theme = 'dark';
    shelf.invalidate(true,false,'theme');
    expect(shelf.flush()).toBe(false);
    expect(renders()).toBe(0);
    visibility = 'visible'; document.dispatchEvent(new Event('visibilitychange'));
    expect(frames.size).toBe(1); drain();
    expect(renders()).toBe(1);
    expect(shelf.flush()).toBe(false);
    delete document.documentElement.dataset.theme;
  });

  it('rechecks an otherwise clean native viewport when presentation returns',() => {
    shelf.setPresentationActive(false);
    height = 610;
    shelf.setPresentationActive(true);
    expect(frames.size).toBe(1);
    shelf.flush();
    expect(shelf.canvas.style.height).toBe('610px');
    expect(renders()).toBe(1);
    expect(shelf.flush()).toBe(false);
  });

  it('preserves every camera frame and its endpoint when presentation changes during a real turn',() => {
    shelf.setMode('isometric'); shelf.setPresentationActive(false);
    const poses = [];
    for (let count = 0; frames.size && count < 100; count++) {
      clock += 16;
      const current = [...frames.values()]; frames.clear();
      for (const callback of current) callback(clock);
      poses.push(Number(shelf.canvas.dataset.viewProgress));
    }
    expect(poses.filter(value => value > 0 && value < 1).length).toBeGreaterThan(3);
    expect(shelf.canvas.dataset.viewProgress).toBe('1');
    expect(shelf.canvas.dataset.animating).toBe('false');
    expect(frames.size).toBe(0);
  });

  it('supports an explicit full paint while hidden without changing the model or quality',() => {
    const original = model(); shelf.setPresentationActive(false);
    node.classList.add('is-away');
    expect(shelf.flush({ force:true })).toBe(true);
    expect(original.visible).toBe(false);
    expect(renders()).toBe(1);
    expect(model()).toBe(original);
    expect(shelf.canvas.dataset.pixelRatio).toBe('1');
  });

  it('revalidates projected positions after a hidden scroll before the handoff',() => {
    const previous = shelf.getBookPose(node);
    shelf.setPresentationActive(false);
    scroller.scrollTop = 40; scroller.dispatchEvent(new Event('scroll'));
    expect(frames.size).toBe(0);
    shelf.setPresentationActive(true); shelf.flush();
    expect(shelf.getBookPose(node).centerY).toBeCloseTo(previous.centerY - 40,5);
    expect(renders()).toBe(1);
    expect(shelf.flush()).toBe(false);
  });

  it('removes presentation listeners and queued work on dispose',() => {
    const remove = vi.spyOn(document,'removeEventListener');
    shelf.invalidate(); shelf.dispose();
    expect(frames.size).toBe(0);
    expect(remove).toHaveBeenCalledWith('visibilitychange',expect.any(Function));
    visibility = 'visible'; document.dispatchEvent(new Event('visibilitychange'));
    expect(frames.size).toBe(0);
  });
});
