import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest'
import * as shelf from '../../src/wasm/shelf/inhouse_read_shelf.js'
import {shelfWasm as wasm} from './helpers/rust-shelf-ready.js'
import {createProfileView} from '../../src/js/profile-view.js'
import {LegacyProfileView,createReferenceProfileView} from './helpers/reference-profile-view.js'
// 'frozen' is the JavaScript view the app had (tests/unit/helpers/reference-profile-view.js); 'rust' is the
// app's, rust-ui/src/profile_view.rs in the shelf module; 'late' is the app's made before that module is in.
const runtime=vi.hoisted(()=>({module:null,waiting:[],native:0}));
vi.mock('../../src/js/rust-shelf.js',()=>({whenRustShelf:use=>{if(runtime.module)use(runtime.module);else runtime.waiting.push(use)}}));
vi.mock('../../src/js/rust-ui.js',()=>({loadRustUI:vi.fn(()=>Promise.resolve(null))}));
const markup=`<div id="drive-profile"><button id="drive-profile-btn"><span id="drive-profile-initial">I</span><img id="drive-profile-avatar"></button><div id="drive-profile-menu" hidden><span id="drive-profile-initial-menu">I</span><img id="drive-profile-avatar-menu"><button id="drive-connect-btn"></button><button id="drive-sync-btn"></button><button id="drive-signout-btn"></button><div id="drive-sync-status"></div><span id="drive-profile-name"></span><span id="drive-profile-email"></span><input id="drive-theme-toggle"></div></div><button id="theme-toggle"></button><button id="outside">Outside</button>`;
let handles=0;const instances=[];
const nativeShelf={...shelf,RustProfileView:class extends shelf.RustProfileView{constructor(...args){super(...args);runtime.native++}}};
const node=id=>document.getElementById(id),snapshot=()=>document.body.innerHTML;
const create=(make=createProfileView)=>{const view=make(document);instances.push(view);return view};
const ready=()=>{runtime.module=nativeShelf;for(const use of runtime.waiting.splice(0))use(nativeShelf)};
beforeEach(()=>{document.body.innerHTML=markup;runtime.module=null;runtime.native=0;runtime.waiting.length=0;handles=shelf.shelf_live_handles()});
afterEach(()=>{for(const view of instances.splice(0))view.destroy();expect(shelf.shelf_live_handles()).toBe(handles);runtime.waiting.length=0;vi.restoreAllMocks();document.body.replaceChildren()});
describe.each(['frozen','rust','late'])('account view (%s)',mode=>{
 beforeEach(()=>{if(mode==='rust')runtime.module=nativeShelf});
 function start(){const view=create(mode==='frozen'?createReferenceProfileView:createProfileView);if(mode==='late')ready();return view}
 it('preserves local and Google account labels, Unicode initials, photo URLs and missing photos',()=>{
  const view=start();view.visibility(false);view.localAccount();expect(node('drive-profile-name').textContent).toBe('Inhouse Read');expect(node('drive-profile-email').textContent).toBe('Biblioteca en este dispositivo');expect(node('drive-profile-btn').getAttribute('aria-label')).toBe('Cuenta y ajustes');expect(node('drive-profile-avatar').hidden).toBe(true);
  for(const profile of [{name:' Miguel ',email:'m@example.test',photo:'/photo.jpg'},{name:'ßeta',email:'s@example.test'},{name:'😀 Author',email:''},{name:'',email:'email@example.test'},{name:'   ',email:'a@example.test'}]){
   view.visibility(true);view.account(profile);expect(node('drive-profile-name').textContent).toBe(profile.name);expect(node('drive-profile-email').textContent).toBe(profile.email);expect(node('drive-profile-btn').title).toBe(profile.name);expect(node('drive-profile-initial').textContent).toBe((profile.name||profile.email||'G').trim().charAt(0).toUpperCase()||'G');expect(node('drive-profile-avatar').hidden).toBe(!profile.photo);expect(node('drive-profile-initial-menu').textContent).toBe(node('drive-profile-initial').textContent);
  }
  expect(runtime.native).toBe(mode==='frozen'?0:1);
 });
 it('preserves syncing text coercion and Boolean class toggles',()=>{
  const view=start();for(const message of ['Sincronizando…',null,undefined,22])for(const syncing of [false,true,0,1]){view.syncStatus(message,syncing);expect(node('drive-sync-status').textContent).toBe(message==null?'':String(message));expect(node('drive-sync-status').classList.contains('is-syncing')).toBe(!!syncing)}
 });
 it('opens once, focuses the theme switch and closes updates before the account',()=>{
  const view=start(),close=vi.fn(()=>{expect(node('drive-profile-menu').hidden).toBe(false)});view.connect(close,node('drive-theme-toggle'));node('drive-profile-btn').click();expect(close).not.toHaveBeenCalled();expect(node('drive-profile-menu').hidden).toBe(false);expect(node('drive-profile-btn').getAttribute('aria-expanded')).toBe('true');expect(document.activeElement).toBe(node('drive-theme-toggle'));node('drive-profile-btn').click();expect(close).toHaveBeenCalledTimes(1);expect(node('drive-profile-menu').hidden).toBe(true);expect(node('drive-profile-btn').getAttribute('aria-expanded')).toBe('false');
 });
 it('keeps the menu open when an updater button replaces itself during a click',()=>{
  const view=start(),close=vi.fn();view.connect(close,node('drive-theme-toggle'));node('drive-profile-btn').click();const button=document.createElement('button');node('drive-profile-menu').append(button);button.addEventListener('click',()=>button.replaceWith(document.createElement('button')));button.click();expect(node('drive-profile-menu').hidden).toBe(false);expect(close).not.toHaveBeenCalled();node('outside').click();expect(close).toHaveBeenCalledTimes(1);expect(node('drive-profile-menu').hidden).toBe(true);
 });
 it('restores focus with Escape and preserves the updater first Escape',()=>{
  const view=start(),close=vi.fn();view.connect(close,node('drive-theme-toggle'));node('drive-profile-btn').click();document.addEventListener('keydown',event=>{if(event.key==='Escape')event.stopImmediatePropagation()},{capture:true,once:true});node('drive-theme-toggle').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));expect(node('drive-profile-menu').hidden).toBe(false);expect(close).not.toHaveBeenCalled();node('drive-theme-toggle').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));expect(close).toHaveBeenCalledTimes(1);expect(node('drive-profile-menu').hidden).toBe(true);expect(document.activeElement).toBe(node('drive-profile-btn'));
 });
 it('falls back to initials after a broken photo and retries the same photo on a later profile update',()=>{
  const view=start();view.connect(()=>{},node('drive-theme-toggle'));const profile={name:'Miguel',email:'m@example.test',photo:'/broken.jpg'};view.account(profile);for(const id of ['drive-profile-avatar','drive-profile-avatar-menu']){node(id).dispatchEvent(new Event('error'));expect(node(id).hidden).toBe(true);expect(node(id).previousElementSibling.hidden).toBe(false)}view.account(profile);for(const id of ['drive-profile-avatar','drive-profile-avatar-menu']){expect(node(id).hidden).toBe(false);expect(node(id).previousElementSibling.hidden).toBe(true)}
 });
 it('reconnects without duplicate handlers and releases callbacks on destruction',()=>{
  const view=start(),old=vi.fn(),close=vi.fn();view.connect(old,node('drive-theme-toggle'));view.connect(close,node('drive-theme-toggle'));node('drive-profile-btn').click();node('outside').click();expect(old).not.toHaveBeenCalled();expect(close).toHaveBeenCalledTimes(1);view.destroy();const before=snapshot();node('drive-profile-btn').click();node('outside').click();view.syncStatus('Disposed');view.visibility(true);view.account({});view.localAccount();view.closeMenu();view.connect(()=>{},node('drive-theme-toggle'));expect(snapshot()).toBe(before);expect(close).toHaveBeenCalledTimes(1);
 });
 it('retains stable memory over 1000 repeated account/status updates and 100 menu cycles',()=>{
  const view=start();view.connect(()=>{},node('drive-theme-toggle'));const profile={name:'Miguel',email:'m@example.test'};view.visibility(true);view.account(profile);view.syncStatus('Guardado',false);const before=shelf.shelf_live_handles(),capacity=wasm.memory.buffer.byteLength;for(let i=0;i<1000;i++){view.visibility(true);view.account(profile);view.syncStatus('Guardado',false)}for(let i=0;i<100;i++){node('drive-profile-btn').click();node('outside').click()}expect(shelf.shelf_live_handles()).toBe(before);expect(wasm.memory.buffer.byteLength).toBe(capacity);
 });
});
it('does what was asked before the module was in, in order, when it arrives',()=>{
 const view=create(),close=vi.fn(),before=snapshot();view.connect(close,node('drive-theme-toggle'));view.visibility(true);view.account({name:'Miguel',email:'m@example.test'});view.syncStatus('Guardado',1);view.localAccount();view.visibility(0);
 expect(snapshot()).toBe(before);expect(runtime.native).toBe(0);ready();expect(runtime.native).toBe(1);
 const late=snapshot();document.body.innerHTML=markup;const reference=createReferenceProfileView(document);reference.connect(close,node('drive-theme-toggle'));reference.visibility(true);reference.account({name:'Miguel',email:'m@example.test'});reference.syncStatus('Guardado',1);reference.localAccount();reference.visibility(0);
 expect(late).toBe(snapshot());reference.destroy();
});
it('keeps a tap on the account button made before the module was in',()=>{
 const view=create(),close=vi.fn();view.connect(close,node('drive-theme-toggle'));node('drive-profile-btn').click();expect(node('drive-profile-menu').hidden).toBe(true);
 ready();expect(node('drive-profile-menu').hidden).toBe(false);expect(node('drive-profile-btn').getAttribute('aria-expanded')).toBe('true');expect(document.activeElement).toBe(node('drive-theme-toggle'));expect(close).not.toHaveBeenCalled();
 // From here on the view's own listener answers, once per tap.
 node('drive-profile-btn').click();expect(close).toHaveBeenCalledTimes(1);expect(node('drive-profile-menu').hidden).toBe(true);node('drive-profile-btn').click();expect(node('drive-profile-menu').hidden).toBe(false);
});
it('two early taps open and close; a tap before the wiring does nothing, as before',()=>{
 const view=create(),close=vi.fn();view.connect(close,node('drive-theme-toggle'));node('drive-profile-btn').click();node('drive-profile-btn').click();ready();expect(node('drive-profile-menu').hidden).toBe(true);expect(close).toHaveBeenCalledTimes(1);
 document.body.innerHTML=markup;runtime.module=null;const bare=create();node('drive-profile-btn').click();ready();expect(node('drive-profile-menu').hidden).toBe(true);
});
it('never makes the view after destruction, and forgets the early tap listener',()=>{const view=create();view.connect(()=>{},node('drive-theme-toggle'));view.destroy();node('drive-profile-btn').click();ready();expect(runtime.native).toBe(0);expect(node('drive-profile-menu').hidden).toBe(true)});
// Whole sessions against the frozen view: the same calls and events, the same page after each.
it('leaves the page as the frozen view does after every step of 200 scripted sessions',()=>{
 let seed=7;const next=()=>{seed=seed+0x6D2B79F5|0;let t=Math.imul(seed^seed>>>15,1|seed);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296},pick=list=>list[Math.floor(next()*list.length)];
 const names=['Miguel',7,' ana ','ßeta','\u{1F600} Author','','   ','\ud83d','éa',undefined,null],emails=['m@example.test',9,'',undefined,' z@example.test',null],photos=['/photo.jpg',undefined,'',null,'/other.png'],messages=['Sincronizando…','Guardado',null,undefined,22,''],flags=[true,false,0,1,'',undefined,'yes',null];
 const plans=[];for(let session=0;session<200;session++){const steps=[];for(let i=0;i<30;i++){const kind=pick(['account','account','local','status','status','visible','tap','tap','outside','inside','escape','key','broken','close','connect']);
  steps.push(kind==='account'?[kind,{name:pick(names),email:pick(emails),photo:pick(photos)}]:kind==='status'?[kind,pick(messages),pick(flags),next()<.2]:kind==='visible'?[kind,pick(flags)]:kind==='broken'?[kind,pick(['drive-profile-avatar','drive-profile-avatar-menu'])]:[kind])}plans.push([next()<.5,steps])}
 const totals={frozen:{steps:0,closes:0,throws:0,opened:0},rust:{steps:0,closes:0,throws:0,opened:0}};
 const run=(mode,[late,steps])=>{
  document.body.innerHTML=markup;runtime.module=mode==='rust'&&!late?nativeShelf:null;const total=totals[mode],close=()=>{total.closes++};
  const view=mode==='rust'?createProfileView(document):createReferenceProfileView(document);view.connect(close,node('drive-theme-toggle'));if(mode==='rust'&&late)ready();
  const pages=[];
  for(const [kind,...args] of steps){
   total.steps++;
   try{
    if(kind==='account')view.account(args[0]);else if(kind==='local')view.localAccount();else if(kind==='status')args[2]?view.syncStatus(args[0]):view.syncStatus(args[0],args[1]);else if(kind==='visible')view.visibility(args[0]);
    else if(kind==='tap')node('drive-profile-btn').click();else if(kind==='outside')node('outside').click();else if(kind==='inside')node('drive-sync-btn').click();
    else if(kind==='escape')node('drive-theme-toggle').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));else if(kind==='key')document.dispatchEvent(new KeyboardEvent('keydown',{key:'a',bubbles:true}));
    else if(kind==='broken')node(args[0]).dispatchEvent(new Event('error'));else if(kind==='close')view.closeMenu();else view.connect(close,node('drive-theme-toggle'));
   }catch(error){total.throws++;pages.push(error instanceof TypeError)}
   if(!node('drive-profile-menu').hidden)total.opened++;
   pages.push(snapshot(),document.activeElement?.id);
  }
  view.destroy();return pages;
 };
 for(const plan of plans)expect(run('rust',plan)).toEqual(run('frozen',plan));
 expect(totals.rust).toEqual(totals.frozen);expect(totals.frozen.steps).toBe(6000);expect(totals.frozen.closes).toBeGreaterThan(500);expect(totals.frozen.opened).toBeGreaterThan(300);expect(totals.frozen.throws).toBeGreaterThan(50);
});
it('compares raw DOM input coercion and UTF-16 exactly against the frozen presentation',()=>{
 const host=document.createElement('div');host.innerHTML=markup;const clone=document.implementation.createHTMLDocument();clone.body.innerHTML=markup;const old=new LegacyProfileView(document),view=new shelf.RustProfileView(clone);
 try{for(const value of [null,undefined,22,'\ud83d',{toString:()=>'/custom.jpg'}]){old.profileText(value,'email','Label',value);view.profileText(value,'email','Label',value);old.avatar(value,value);view.avatar(value,value);expect(clone.body.innerHTML).toBe(document.body.innerHTML)}}finally{view.free();old.free()}
});
