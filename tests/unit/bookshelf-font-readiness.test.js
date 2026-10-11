import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {renderBookshelf} from '../../src/js/bookshelf.js';

const state=vi.hoisted(()=>({firstText:null,scene:true,snapshot:false,create:vi.fn(),update:vi.fn(),dispose:vi.fn(),views:vi.fn(),viewDispose:vi.fn()}));
vi.mock('../../src/js/book-model.js',()=>({getBookRenderer:()=>state.scene?{}:null,
  bookView(body,book,style,dimensions){
    state.views(book,style,dimensions);
    if(!state.snapshot)return null;
    body.append(document.createElement('canvas'));
    return {dispose:state.viewDispose};
  },fitCoverImage:vi.fn(),planReadingBookPose:vi.fn()}));
vi.mock('../../src/js/bookshelf-scene.js',()=>({createBookshelfScene(layout){
  state.create(layout);state.firstText?.();
  return {updateLayout:state.update,dispose:state.dispose,getInspectionZoom:()=>1};
}}));
let shelf,container,frames;
const prior=Object.getOwnPropertyDescriptor(document,'fonts');
function setFonts(value){Object.defineProperty(document,'fonts',{configurable:true,value});}
function mount(){shelf=renderBookshelf(container,[{id:'font:one',title:'Canvas typography',author:'An author',sourceType:'local',format:'PDF',
  spineFontFamily:'Lora',spineFontSize:31,spineAuthorFontSize:17}],{shelfWidth:390,sections:false,sort:'none',viewMode:'spine'});}
beforeEach(()=>{
  vi.clearAllMocks();localStorage.clear();localStorage.setItem('inhouse-read-shelf-plants','[]');state.firstText=null;state.scene=true;state.snapshot=false;
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
  it('retains the visible spine, focus and whole semantic stage after pending fonts settle',async()=>{
    let finish;setFonts({status:'loading',ready:new Promise(resolve=>{finish=resolve;})});mount();await Promise.resolve();
    const node=container.querySelector('.ihr-spine'),stage=container.querySelector('.ihr-shelf-stage');node.focus();
    const style=node.getAttribute('style');
    expect(frames.size).toBe(0);finish();await Promise.resolve();
    expect(container.querySelector('.ihr-spine')).toBe(node);expect(node.isConnected).toBe(true);
    expect(container.querySelector('.ihr-shelf-stage')).toBe(stage);expect(document.activeElement).toBe(node);
    expect(node.getAttribute('style')).toBe(style);expect(frames.size).toBe(0);expect(state.update).not.toHaveBeenCalled();
  });
  it('subscribes to the ready promise created during the first text construction',async()=>{
    let finish;const fonts={status:'loaded',ready:Promise.resolve()},next=new Promise(resolve=>{finish=resolve;});
    state.firstText=()=>{fonts.status='loading';fonts.ready=next;};setFonts(fonts);mount();await Promise.resolve();
    expect(state.firstText).toBeTypeOf('function');expect(frames.size).toBe(0);
    finish();await Promise.resolve();expect(frames.size).toBe(0);expect(state.update).not.toHaveBeenCalled();
  });
  it('preserves the original callback when status is unknown',async()=>{
    setFonts({ready:Promise.resolve()});mount();await Promise.resolve();expect(frames.size).toBe(0);expect(state.update).not.toHaveBeenCalled();
  });
  it('keeps the original destruction guard for a pending font completion',async()=>{
    let finish;setFonts({status:'loading',ready:new Promise(resolve=>{finish=resolve;})});mount();shelf.destroy();
    finish();await Promise.resolve();expect(frames.size).toBe(0);expect(state.update).not.toHaveBeenCalled();
    expect(state.dispose).toHaveBeenCalledOnce();shelf=null;
  });
  it('repaints only a legacy canvas snapshot with identical geometry and explicit typography',async()=>{
    state.scene=false;state.snapshot=true;
    let finish;setFonts({status:'loading',ready:new Promise(resolve=>{finish=resolve;})});mount();
    const node=container.querySelector('.ihr-spine'),canvas=node.querySelector('canvas'),stage=node.closest('.ihr-shelf-stage');
    const style=node.getAttribute('style'),args=state.views.mock.calls[0];node.focus();
    finish();await Promise.resolve();
    expect(container.querySelector('.ihr-spine')).toBe(node);expect(node.isConnected).toBe(true);
    expect(node.closest('.ihr-shelf-stage')).toBe(stage);expect(document.activeElement).toBe(node);
    expect(node.querySelector('canvas')).not.toBe(canvas);expect(state.views).toHaveBeenCalledTimes(2);
    expect(state.views.mock.calls[1]).toEqual(args);expect(args[1]).toMatchObject({fontFamily:'Lora',spineFontSize:31,spineAuthorFontSize:17});
    expect(node.getAttribute('style')).toBe(style);expect(state.viewDispose.mock.calls).toEqual([[false],[false]]);
    expect(frames.size).toBe(0);
  });
  it('retains DOM-only lettering and font sizing for the browser font reflow',async()=>{
    state.scene=false;
    let finish;setFonts({status:'loading',ready:new Promise(resolve=>{finish=resolve;})});mount();
    const node=container.querySelector('.ihr-spine'),label=node.querySelector('.ihr-spine__label');
    const html=node.innerHTML,style=node.getAttribute('style');
    finish();await Promise.resolve();
    expect(container.querySelector('.ihr-spine')).toBe(node);expect(node.querySelector('.ihr-spine__label')).toBe(label);
    expect(node.innerHTML).toBe(html);expect(node.getAttribute('style')).toBe(style);
    expect(node.style.getPropertyValue('--ihr-spine-font')).toContain('Lora');
    expect(node.style.getPropertyValue('--ihr-spine-font-size')).toBe('31px');
    expect(node.style.getPropertyValue('--ihr-spine-author-font-size')).toBe('17px');
    expect(state.views).toHaveBeenCalledOnce();expect(frames.size).toBe(0);
  });
});
