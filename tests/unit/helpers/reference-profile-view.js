export class LegacyProfileView{
 constructor(document){this.document=document;this.listeners=[];this.closeUpdates=()=>{};this.nodes=['drive-profile','drive-connect-btn','theme-toggle','drive-sync-btn','drive-signout-btn','drive-sync-status','drive-profile-name','drive-profile-email','drive-profile-btn','drive-profile-menu','drive-profile-initial','drive-profile-initial-menu','drive-profile-avatar','drive-profile-avatar-menu'].map(id=>document.getElementById(id))}
 syncStatus(message,syncing=false){this.nodes[5].textContent=message;this.nodes[5].classList.toggle('is-syncing',syncing)}
 visibility(connected){this.nodes[0].hidden=false;this.nodes[1].hidden=connected;this.nodes[2].hidden=true;for(const index of [3,4,5])this.nodes[index].hidden=!connected}
 profileText(name,email,label,title){this.nodes[6].textContent=name;this.nodes[7].textContent=email;this.nodes[8].setAttribute('aria-label',label);this.nodes[8].title=title}
 avatar(initial,photo){for(const index of [10,11])this.nodes[index].textContent=initial;for(const index of [12,13]){const image=this.nodes[index];if(photo){image.src=photo;image.hidden=false;image.previousElementSibling.hidden=true}else{image.removeAttribute('src');image.hidden=true;image.previousElementSibling.hidden=false}}}
 closeMenu(){this.closeUpdates();this.nodes[9].hidden=true;this.nodes[8].setAttribute('aria-expanded','false')}
 toggleMenu(){const open=this.nodes[9].hidden;this.nodes[9].hidden=!open;this.nodes[8].setAttribute('aria-expanded',String(open));return open}
 profile(name,email,label,title,initial,photo){this.profileText(name,email,label,title);this.avatar(initial,photo)}
 connect(closeUpdates,themeToggle){
  this.disconnect();this.closeUpdates=closeUpdates;
  const listen=(target,kind,handler)=>{target.addEventListener(kind,handler);this.listeners.push(()=>target.removeEventListener(kind,handler))};
  listen(this.nodes[8],'click',()=>{if(!this.nodes[9].hidden){this.closeMenu();return}this.toggleMenu();themeToggle.focus()});
  listen(this.document,'click',event=>{if(!event.composedPath().includes(this.nodes[0]))this.closeMenu()});
  listen(this.document,'keydown',event=>{if(event.key==='Escape'){const open=!this.nodes[9].hidden;this.closeMenu();if(open)this.nodes[8].focus()}});
  for(const index of [12,13]){const image=this.nodes[index];listen(image,'error',()=>{image.hidden=true;image.previousElementSibling.hidden=false})}
 }
 disconnect(){for(const remove of this.listeners.splice(0))remove()}
 free(){this.disconnect();this.nodes=[];this.closeUpdates=()=>{}}
}
// The account view as src/js/profile-view.js made it before the module's view was adopted (frozen with the class above).
export function createReferenceProfileView(document){
 let view=new LegacyProfileView(document),connection=null,disposed=false;
 return{
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
  destroy(){if(disposed)return;disposed=true;view.free();connection=null}
 };
}
