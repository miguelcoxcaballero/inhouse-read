import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {renderBookshelf} from '../../src/js/bookshelf.js';

const state=vi.hoisted(()=>({firstText:null,create:vi.fn(),update:vi.fn(),dispose:vi.fn()}));
vi.mock('../../src/js/book-model.js',()=>({getBookRenderer:()=>({}),bookView:()=>null,fitCoverImage:vi.fn(),planReadingBookPose:vi.fn()}));
vi.mock('../../src/js/bookshelf-scene.js',()=>({createBookshelfScene(layout){
  state.create(layout);state.firstText?.();
  return {updateLayout:state.update,dispose:state.dispose,getInspectionZoom:()=>1};
}}));
let shelf,container,frames;
const prior=Object.getOwnPropertyDescriptor(document,'fonts');
function setFonts(value){Object.defineProperty(document,'fonts',{configurable:true,value});}
function mount(){shelf=renderBookshelf(container,[{id:'font:one',title:'Canvas typography',sourceType:'local',format:'PDF'}],{shelfWidth:390,sections:false,sort:'none',viewMode:'spine'});}
beforeEach(()=>{
  vi.clearAllMocks();localStorage.clear();localStorage.setItem('inhouse-read-shelf-plants','[]');state.firstText=null;
  frames=new Map();let serial=0;vi.stubGlobal('requestAnimationFrame',callback=>{const id=++serial;frames.set(id,callback);return id;});
  vi.stubGlobal('cancelAnimationFrame',id=>frames.delete(id));vi.stubGlobal('WebGLRenderingContext',function(){});
  container=document.createElement('div');document.body.append(container);
});
afterEach(()=>{
  shelf?.destroy();shelf=null;document.body.replaceChildren();vi.restoreAllMocks();vi.unstubAllGlobals();
  if(prior)Object.defineProperty(document,'fonts',prior);else delete document.fonts;
});
describe('initial bookshelf font refresh',()=>{
  it('does not queue a second initial layout when fonts remained loaded after text construction',async()=>{
    setFonts({status:'loaded',ready:Promise.resolve()});mount();await Promise.resolve();
    expect(state.create).toHaveBeenCalledOnce();expect(frames.size).toBe(0);expect(state.update).not.toHaveBeenCalled();
  });
  it('keeps the actual loading callback and waits for its resolution',async()=>{
    let finish;setFonts({status:'loading',ready:new Promise(resolve=>{finish=resolve;})});mount();await Promise.resolve();
    expect(frames.size).toBe(0);finish();await Promise.resolve();expect(frames.size).toBe(1);
  });
  it('subscribes to the ready promise created during the first text construction',async()=>{
    let finish;const fonts={status:'loaded',ready:Promise.resolve()},next=new Promise(resolve=>{finish=resolve;});
    state.firstText=()=>{fonts.status='loading';fonts.ready=next;};setFonts(fonts);mount();await Promise.resolve();
    expect(state.firstText).toBeTypeOf('function');expect(frames.size).toBe(0);
    finish();await Promise.resolve();expect(frames.size).toBe(1);
  });
  it('preserves the original callback when status is unknown',async()=>{
    setFonts({ready:Promise.resolve()});mount();await Promise.resolve();expect(frames.size).toBe(1);
  });
  it('keeps the original destruction guard for a pending font completion',async()=>{
    let finish;setFonts({status:'loading',ready:new Promise(resolve=>{finish=resolve;})});mount();shelf.destroy();
    finish();await Promise.resolve();expect(frames.size).toBe(0);expect(state.update).not.toHaveBeenCalled();
    expect(state.dispose).toHaveBeenCalledOnce();shelf=null;
  });
});
