import {loadRustUI} from './rust-ui.js'
import {whenRustShelf} from './rust-shelf.js'

// The account view is rust-ui/src/profile_view.rs, in the shelf module. What is asked of it before
// that module is in (the wiring at start-up, a tap on the account button) is done, in order, when
// it arrives.
export function createProfileView(document){
 let view=null,disposed=false,waiting=[]
 const button=document.getElementById('drive-profile-btn')
 const ask=name=>(...args)=>{if(disposed)return;if(view)view[name](...args);else waiting.push([name,args])}
 const press=ask('press')
 button.addEventListener('click',press)
 whenRustShelf(shelf=>{
  button.removeEventListener('click',press)
  if(disposed)return
  view=new shelf.RustProfileView(document)
  for(const [name,args] of waiting.splice(0))view[name](...args)
 })
 return{
  warm(){if(!disposed)void loadRustUI()},
  syncStatus:ask('syncStatus'),visibility:ask('visibility'),account:ask('account'),localAccount:ask('localAccount'),
  closeMenu:ask('closeMenu'),connect:ask('connect'),
  destroy(){if(disposed)return;disposed=true;button.removeEventListener('click',press);view?.free();view=null;waiting=[]}
 }
}
