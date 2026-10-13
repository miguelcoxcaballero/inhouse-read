import {beforeAll,beforeEach,afterEach,describe,it,expect,vi} from 'vitest'
import {readFileSync} from 'node:fs'
import * as ui from '../../src/wasm/ui/inhouse_read_ui.js'
import {createProfileView} from '../../src/js/profile-view.js'
import {LegacyProfileView} from '../../src/js/profile-view-legacy.js'
const runtime=vi.hoisted(()=>({ui:null,listeners:new Set(),native:0}));
vi.mock('../../src/js/rust-ui.js',()=>({getRustUI:()=>runtime.ui,loadRustUI:vi.fn(()=>Promise.resolve(runtime.ui))}));
vi.mock('../../src/js/rust-ui-readiness.js',()=>({onRustUIReady:listener=>{runtime.listeners.add(listener);return()=>runtime.listeners.delete(listener)}}));
const markup=`<div id="drive-profile"><button id="drive-profile-btn"><span id="drive-profile-initial">I</span><img id="drive-profile-avatar"></button><div id="drive-profile-menu" hidden><span id="drive-profile-initial-menu">I</span><img id="drive-profile-avatar-menu"><button id="drive-connect-btn"></button><button id="drive-sync-btn"></button><button id="drive-signout-btn"></button><div id="drive-sync-status"></div><span id="drive-profile-name"></span><span id="drive-profile-email"></span><input id="drive-theme-toggle"></div></div><button id="theme-toggle"></button><button id="outside">Outside</button>`;
let wasm;const instances=[];
const nativeUI={...ui,RustProfileView:class extends ui.RustProfileView{constructor(...args){super(...args);runtime.native++}}};
const node=id=>document.getElementById(id),snapshot=()=>document.body.innerHTML;
const create=()=>{const view=createProfileView(document);instances.push(view);return view};
const ready=()=>{runtime.ui=nativeUI;for(const listener of [...runtime.listeners])listener(nativeUI);runtime.listeners.clear()};
beforeAll(()=>{wasm=ui.initSync({module:readFileSync('src/wasm/ui/inhouse_read_ui_bg.wasm')})});
beforeEach(()=>{document.body.innerHTML=markup;runtime.ui=null;runtime.native=0;runtime.listeners.clear()});
afterEach(()=>{for(const view of instances.splice(0))view.destroy();expect(ui.ui_live_handles()).toBe(0);runtime.listeners.clear();vi.restoreAllMocks();document.body.replaceChildren()});
describe.each(['legacy','rust','late'])('account view (%s)',mode=>{
 beforeEach(()=>{if(mode==='rust')runtime.ui=nativeUI});
 function start(){const view=create();if(mode==='late')ready();return view}
 it('preserves local and Google account labels, Unicode initials, photo URLs and missing photos',()=>{
  const view=start();view.visibility(false);view.localAccount();expect(node('drive-profile-name').textContent).toBe('Inhouse Read');expect(node('drive-profile-email').textContent).toBe('Biblioteca en este dispositivo');expect(node('drive-profile-btn').getAttribute('aria-label')).toBe('Cuenta y ajustes');expect(node('drive-profile-avatar').hidden).toBe(true);
  for(const profile of [{name:' Miguel ',email:'m@example.test',photo:'/photo.jpg'},{name:'ßeta',email:'s@example.test'},{name:'😀 Author',email:''},{name:'',email:'email@example.test'},{name:'   ',email:'a@example.test'}]){
   view.visibility(true);view.account(profile);expect(node('drive-profile-name').textContent).toBe(profile.name);expect(node('drive-profile-email').textContent).toBe(profile.email);expect(node('drive-profile-btn').title).toBe(profile.name);expect(node('drive-profile-initial').textContent).toBe((profile.name||profile.email||'G').trim().charAt(0).toUpperCase()||'G');expect(node('drive-profile-avatar').hidden).toBe(!profile.photo);expect(node('drive-profile-initial-menu').textContent).toBe(node('drive-profile-initial').textContent);
  }
  if(mode!=='legacy')expect(runtime.native).toBe(1);
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
  const view=start();view.connect(()=>{},node('drive-theme-toggle'));const profile={name:'Miguel',email:'m@example.test'};view.visibility(true);view.account(profile);view.syncStatus('Guardado',false);const before=ui.ui_live_handles(),capacity=wasm.memory.buffer.byteLength;for(let i=0;i<1000;i++){view.visibility(true);view.account(profile);view.syncStatus('Guardado',false)}for(let i=0;i<100;i++){node('drive-profile-btn').click();node('outside').click()}expect(ui.ui_live_handles()).toBe(before);expect(wasm.memory.buffer.byteLength).toBe(capacity);
 });
});
it('adopts a pending module without replacing DOM or duplicating an open menu listener',()=>{
 const view=create(),close=vi.fn();view.connect(close,node('drive-theme-toggle'));view.localAccount();node('drive-profile-btn').click();const root=node('drive-profile'),before=snapshot();ready();expect(snapshot()).toBe(before);expect(node('drive-profile')).toBe(root);expect(node('drive-profile-menu').hidden).toBe(false);node('drive-profile-btn').click();expect(close).toHaveBeenCalledTimes(1);expect(node('drive-profile-menu').hidden).toBe(true);view.account({name:'Miguel',email:'m@example.test'});expect(runtime.native).toBe(1);
});
it('retains fallback when the module is incomplete or construction fails',()=>{
 for(const ui of [{RustProfileView:class{}},{RustProfileView:class{constructor(){throw Error('Unavailable')}profile(){}visibility(){}syncStatus(){}closeMenu(){}toggleMenu(){}connect(){}}}]){runtime.ui=ui;const view=create();view.localAccount();expect(node('drive-profile-name').textContent).toBe('Inhouse Read');view.destroy()}
});
it('never adopts a late module after destruction',()=>{const view=create();view.destroy();ready();expect(runtime.native).toBe(0);expect(ui.ui_live_handles()).toBe(0)});
it('compares raw DOM input coercion and UTF-16 exactly against the frozen presentation',()=>{
 const host=document.createElement('div');host.innerHTML=markup;const clone=document.implementation.createHTMLDocument();clone.body.innerHTML=markup;const old=new LegacyProfileView(document),view=new ui.RustProfileView(clone);
 try{for(const value of [null,undefined,22,'\ud83d',{toString:()=>'/custom.jpg'}]){old.profileText(value,'email','Label',value);view.profileText(value,'email','Label',value);old.avatar(value,value);view.avatar(value,value);expect(clone.body.innerHTML).toBe(document.body.innerHTML)}}finally{view.free();old.free()}
});
