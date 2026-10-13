import {getRustUI,loadRustUI} from './rust-ui.js'
import {onRustUIReady} from './rust-ui-readiness.js'
import {LegacyProfileView} from './profile-view-legacy.js'

// Keep the existing DOM and account data during late WASM adoption. The
// replacement owns exactly one set of listeners; authentication stays in its
// existing client and the shared updater is invoked through its host callback.
export function createProfileView(document){
 let view=new LegacyProfileView(document),connection=null,unsubscribe=null,disposed=false;
 const adopt=ui=>{
  if(disposed||!ui?.RustProfileView||view instanceof ui.RustProfileView)return;
  const View=ui.RustProfileView;
  if(!['profile','visibility','syncStatus','closeMenu','toggleMenu','connect'].every(key=>typeof View.prototype[key]==='function'))return;
  let next;
  try{next=new View(document);if(connection)next.connect(...connection)}catch{next?.free();return}
  view.free();view=next;
 };
 const ui=getRustUI();if(ui)adopt(ui);else unsubscribe=onRustUIReady(adopt);
 return{
  warm(){if(!disposed)void loadRustUI()},
  syncStatus(message,syncing=false){if(disposed)return;view.syncStatus(message,!!syncing)},
  visibility(connected){if(disposed)return;view.visibility(!!connected)},
  account(profile){
   if(disposed)return;
   const initial=(profile.name||profile.email||'G').trim().charAt(0).toUpperCase()||'G';
   view.profile(profile.name,profile.email,profile.email?`Cuenta de Google: ${profile.email}`:'Cuenta de Google',profile.name,initial,profile.photo);
  },
  localAccount(){if(disposed)return;view.profile('Inhouse Read','Biblioteca en este dispositivo','Cuenta y ajustes','Cuenta y ajustes','I',undefined)},
  closeMenu(){if(disposed)return;view.closeMenu()},
  connect(...args){if(disposed)return;connection=args;view.connect(...args)},
  destroy(){if(disposed)return;disposed=true;unsubscribe?.();view.free();connection=null}
 };
}
