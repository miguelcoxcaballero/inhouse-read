import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import * as THREE from 'three';
import {createBookshelfScene} from '../../src/js/bookshelf-scene.js';

const gpu=vi.hoisted(()=>({renderer:null,firstText:null,modelCalls:0,models:[],nextReady:null}));
vi.mock('../../src/js/book-model.js',async()=>{
  const Three=await import('three');let ratio=1;const size=new Three.Vector2();
  gpu.renderer={domElement:document.createElement('canvas'),shadowMap:{},capabilities:{getMaxAnisotropy:()=>1},
    getPixelRatio:()=>ratio,setPixelRatio:value=>{ratio=value;},getSize:target=>target.copy(size),
    setSize:(width,height)=>{size.set(width,height);},render:vi.fn()};
  return {getBookRenderer:()=>gpu.renderer,lightBookScene(){},createBookModel(book,_style,width,height,thickness){
    gpu.modelCalls++;gpu.firstText?.();
    const model=new Three.Group();model.name=`book:${book.id}`;
    const binding=new Three.Mesh(new Three.BoxGeometry(thickness*.38,height,thickness),new Three.MeshStandardMaterial());
    binding.name='binding';binding.position.x=-width/2-thickness*.19;model.add(binding);
    model.userData.dispose=vi.fn();model.userData.updateSpineAppearance=vi.fn();model.userData.updateCoverSource=vi.fn();
    model.userData.ready=gpu.nextReady;gpu.models.push(model);return model;
  }};
});
let shelf,stage,scroller,frames;
const prior=Object.getOwnPropertyDescriptor(document,'fonts');
const rect=(x,y,width,height)=>({left:x,top:y,width,height,right:x+width,bottom:y+height});
function setFonts(value){Object.defineProperty(document,'fonts',{configurable:true,value});}
function mount({coverUrl=null}={}){
  scroller=document.createElement('div');stage=document.createElement('div');scroller.append(stage);document.body.append(scroller);
  Object.defineProperty(scroller,'clientHeight',{value:700});scroller.getBoundingClientRect=()=>rect(20,60,390,700);
  stage.getBoundingClientRect=()=>rect(20,60,390,500);
  const node=document.createElement('button');node.className='ihr-spine';node.dataset.bookId='font:one';stage.append(node);
  shelf=createBookshelfScene({stage,scroller,width:390,height:500,rows:[{top:20,bottom:220},{top:260,bottom:460}],
    entries:[{node,coverUrl,book:{id:'font:one',title:'Canvas typography',author:'An author'},
      style:{color:'#41694f',width:28,fontFamily:'Lora',spineFontSize:31,spineAuthorFontSize:17},x:75,y:130,width:100,height:180,thickness:28}]});
}
beforeEach(()=>{
  gpu.firstText=null;gpu.modelCalls=0;gpu.models=[];gpu.nextReady=null;gpu.renderer.render.mockClear();frames=new Map();let serial=0;
  vi.stubGlobal('requestAnimationFrame',callback=>{const id=++serial;frames.set(id,callback);return id;});vi.stubGlobal('cancelAnimationFrame',id=>frames.delete(id));
  vi.spyOn(THREE.TextureLoader.prototype,'load').mockImplementation(()=>new THREE.Texture());
  vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockImplementation(()=>({createImageData:(w,h)=>({data:new Uint8ClampedArray(w*h*4)}),putImageData(){},drawImage(){},clearRect(){}}));
  vi.stubGlobal('matchMedia',()=>({matches:false}));
});
afterEach(()=>{
  shelf?.dispose();shelf=null;document.body.replaceChildren();vi.restoreAllMocks();vi.unstubAllGlobals();
  if(prior)Object.defineProperty(document,'fonts',prior);else delete document.fonts;
});
describe('initial real scene font subscription after model construction',()=>{
  it('does not dirty an already loaded room after its first text model has been created',async()=>{
    const readReady=vi.fn(()=>Promise.resolve());setFonts({status:'loaded',get ready(){return readReady();}});mount();
    const dirty=shelf.canvas.dataset.inspectionDirtyCount;expect(gpu.modelCalls).toBeGreaterThan(0);
    await Promise.resolve();expect(readReady).not.toHaveBeenCalled();expect(shelf.canvas.dataset.inspectionDirtyCount).toBe(dirty);
    expect(shelf.canvas.dataset.inspectionDirtySource).not.toBe('fonts-ready');
  });
  it('observes the loading set and NEW promise initiated by first model text construction',async()=>{
    let finish;const fonts={status:'loaded',ready:Promise.resolve()},next=new Promise(resolve=>{finish=resolve;});
    gpu.firstText=()=>{fonts.status='loading';fonts.ready=next;};setFonts(fonts);mount();
    const dirty=shelf.canvas.dataset.inspectionDirtyCount;await Promise.resolve();
    expect(gpu.modelCalls).toBeGreaterThan(0);expect(shelf.canvas.dataset.inspectionDirtyCount).toBe(dirty);
    finish();await Promise.resolve();expect(shelf.canvas.dataset.inspectionDirtySource).toBe('fonts-ready');
    expect(Number(shelf.canvas.dataset.inspectionDirtyCount)).toBe(Number(dirty || 0)+1);
  });
  it('retains the original completion invalidation while fonts are loading',async()=>{
    let finish;setFonts({status:'loading',ready:new Promise(resolve=>{finish=resolve;})});mount();
    const dirty=shelf.canvas.dataset.inspectionDirtyCount;await Promise.resolve();expect(shelf.canvas.dataset.inspectionDirtyCount).toBe(dirty);
    finish();await Promise.resolve();expect(shelf.canvas.dataset.inspectionDirtySource).toBe('fonts-ready');
  });
  it('refreshes retained spine and generated cover typography without layout or model replacement',async()=>{
    let finish;setFonts({status:'loading',ready:new Promise(resolve=>{finish=resolve;})});mount();
    const model=gpu.models[0],node=stage.querySelector('.ihr-spine'),style=node.getAttribute('style'),entry=model.userData.entry;
    const redraw=model.userData.invalidate;node.focus();
    finish();await Promise.resolve();
    expect(model.userData.updateSpineAppearance).toHaveBeenCalledExactlyOnceWith(entry.book,entry.style);
    expect(model.userData.updateCoverSource).toHaveBeenCalledExactlyOnceWith(null,entry.book,entry.style);
    expect(entry.style).toMatchObject({fontFamily:'Lora',spineFontSize:31,spineAuthorFontSize:17});
    expect(gpu.models).toEqual([model]);expect(model.userData.dispose).not.toHaveBeenCalled();
    expect(model.userData.invalidate).toBe(redraw);expect(stage.querySelector('.ihr-spine')).toBe(node);
    expect(node.getAttribute('style')).toBe(style);expect(document.activeElement).toBe(node);
    expect(shelf.canvas.dataset.layoutUpdates).toBeUndefined();
  });
  it('keeps actual cover images intact when their spine lettering is repainted',async()=>{
    let finish;setFonts({status:'loading',ready:new Promise(resolve=>{finish=resolve;})});mount({coverUrl:'blob:printed-cover'});
    const model=gpu.models[0];finish();await Promise.resolve();
    expect(model.userData.updateSpineAppearance).toHaveBeenCalledOnce();expect(model.userData.updateCoverSource).not.toHaveBeenCalled();
    expect(gpu.models).toEqual([model]);expect(shelf.canvas.dataset.layoutUpdates).toBeUndefined();
  });
  it('refreshes a pending replacement as well so its fallback lettering cannot arrive later',async()=>{
    let finish;setFonts({status:'loading',ready:new Promise(resolve=>{finish=resolve;})});mount({coverUrl:'blob:printed-cover'});
    const model=gpu.models[0],entry=model.userData.entry;
    gpu.nextReady=new Promise(()=>{});
    shelf.updateEntry(entry.node,entry.book,{...entry.style,width:42},'blob:printed-cover');
    expect(gpu.models).toHaveLength(2);const pending=gpu.models[1];
    finish();await Promise.resolve();
    expect(model.userData.updateSpineAppearance).toHaveBeenCalledOnce();
    expect(pending.userData.updateSpineAppearance).toHaveBeenCalledOnce();
    expect(pending.userData.updateCoverSource).not.toHaveBeenCalled();expect(gpu.models).toHaveLength(2);
    expect(stage.querySelector('.ihr-spine')).toBe(entry.node);expect(shelf.canvas.dataset.layoutUpdates).toBeUndefined();
  });
  it('retains the original completion invalidation when FontFaceSet status is unavailable',async()=>{
    setFonts({ready:Promise.resolve()});mount();await Promise.resolve();expect(shelf.canvas.dataset.inspectionDirtySource).toBe('fonts-ready');
  });
  it('does not schedule or paint a disposed scene when a real pending font promise finishes',async()=>{
    let finish;setFonts({status:'loading',ready:new Promise(resolve=>{finish=resolve;})});mount();
    shelf.dispose();shelf=null;frames.clear();const renders=gpu.renderer.render.mock.calls.length;
    finish();await Promise.resolve();expect(frames.size).toBe(0);expect(gpu.renderer.render).toHaveBeenCalledTimes(renders);
  });
});
