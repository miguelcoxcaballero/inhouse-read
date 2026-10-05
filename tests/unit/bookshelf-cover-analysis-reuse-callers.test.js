import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {renderBookshelf} from '../../src/js/bookshelf.js';
import {analyzeCoverAppearance} from '../../src/js/cover-appearance.js';
const observed=vi.hoisted(()=>({views:[]}));
vi.mock('../../src/js/book-model.js',()=>({
 getBookRenderer:()=>null,planReadingBookPose:()=>({x:0,y:0,scale:1,angle:0,pitch:0}),
 bookView(host,book,style,dimensions){
  const canvas=document.createElement('canvas');canvas.dataset.renderer='three-mesh';host.append(canvas);
  const view={canvas,ready:Promise.resolve(true),draw(){},updateAppearance:vi.fn(),animate(){return {finished:Promise.resolve(),cancel(){}}},dispose(){}};
  observed.views.push({view,book,style,dimensions});return view;
 }
}));
vi.mock('../../src/js/cover-appearance.js',async original=>({...await original(),
 analyzeCoverAppearance:vi.fn(),readCoverAspectRatio:vi.fn(async()=>.66)
}));
let shelf,container,finishAnalysis;
const appearance={color:'#713b42',shade:'#51242c',ink:'#fffaf0',aspectRatio:.66,
 fontFamily:'Georgia',fontCanvasFamily:'Georgia',fontFallback:'Georgia, serif',fontWeight:600,source:'cover'};
beforeEach(()=>{observed.views.length=0;finishAnalysis=null;vi.mocked(analyzeCoverAppearance).mockReset();
 vi.mocked(analyzeCoverAppearance).mockImplementation(()=>new Promise(resolve=>{finishAnalysis=resolve;}));
 container=document.createElement('div');document.body.append(container);
});
afterEach(async()=>{shelf?.destroy();shelf=null;finishAnalysis?.(null);container?.remove();await Promise.resolve();await Promise.resolve();document.body.replaceChildren();vi.restoreAllMocks();});
async function select(options={}){
 const book={id:'appearance-callback',title:'Captured Book',author:'Captured Author',format:'PDF',
  progressFraction:.42,cover:new Blob(['cover'],{type:'image/png'})};
 shelf=renderBookshelf(container,[book],{shelfWidth:390,sections:false,revealDuration:0,holdMs:0,
  coverSrcFor:()=> 'blob:appearance-callback',...options});
 await vi.waitFor(()=>expect(finishAnalysis).toBeTypeOf('function'));
 container.querySelector('.ihr-spine').click();
 await vi.waitFor(()=>expect(observed.views.some(e=>!e.dimensions.shelf)).toBe(true));
 await vi.waitFor(()=>expect(document.querySelector('.ihr-flyout')).not.toBeNull());
 return {book,selected:observed.views.find(e=>!e.dimensions.shelf)};
}
describe('late cover-analysis uses the existing guarded reuse opt-in',()=>{
 it('passes only the analysed style and exact reuse option to the active selected book',async()=>{
  const {selected}=await select();finishAnalysis(appearance);
  await vi.waitFor(()=>expect(selected.view.updateAppearance).toHaveBeenCalledOnce());
  expect(selected.view.updateAppearance).toHaveBeenCalledWith(expect.objectContaining({color:'#713b42',fontCanvasFamily:'Georgia'}),{reuseModel:true});
  expect(document.querySelector('.ihr-flyout__book').style.getPropertyValue('--ihr-spine-base')).toBe('#713b42');
 });
 it('preserves the original captured-book semantics and ignores the record returned by persistence',async()=>{
  const returned={id:'appearance-callback',title:'Different returned title',coverUrl:'blob:new-url',coverRelief:{id:'new-relief'},progressFraction:.9};
  const persist=vi.fn(async()=>returned),{book,selected}=await select({onCoverAppearance:persist});finishAnalysis(appearance);
  await vi.waitFor(()=>expect(selected.view.updateAppearance).toHaveBeenCalledOnce());
  expect(persist).toHaveBeenCalledWith(book,appearance,expect.any(String));
  expect(selected.book).toBe(book);expect(selected.book.title).toBe('Captured Book');expect(selected.book.progressFraction).toBe(.42);
  expect(selected.view.updateAppearance.mock.calls[0]).toHaveLength(2);
  expect(selected.view.updateAppearance.mock.calls[0][1]).toEqual({reuseModel:true});
  expect(selected.book.coverRelief).toBeUndefined();expect(selected.book.coverUrl).toBeUndefined();
 });
 it('keeps the original destroyed-session guard when analysis completes after teardown',async()=>{
  const {selected}=await select();shelf.destroy();shelf=null;finishAnalysis(appearance);
  for(let i=0;i<6;i++)await Promise.resolve();
  expect(selected.view.updateAppearance).not.toHaveBeenCalled();expect(document.querySelector('.ihr-flyout')).toBeNull();
 });
});
