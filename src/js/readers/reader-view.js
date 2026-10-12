import {getRustUI} from '../rust-ui.js'
import {LegacyReaderView} from './reader-view-legacy.js'

const compatible=()=>{
 const Candidate=getRustUI()?.RustReaderView
 return Candidate&&['setDocumentInfo','configureFormat','relocate'].every(name=>typeof Candidate.prototype[name]==='function')?Candidate:null
}
// DOM-only ownership can move to Rust when its download finishes after the
// reader's startup deadline. Construction does not rewrite the DOM, reflow the
// book, bind listeners, or replay any action already handled by the fallback.
export class ReaderView {
 constructor(screen,panel,mini,returnButton){
  const View=compatible()
  if(View)return new View(screen,panel,mini,returnButton)
  const fallback=new LegacyReaderView(screen,panel,mini,returnButton)
  let native=null,disposed=false
  for(const name of Object.getOwnPropertyNames(LegacyReaderView.prototype)){
   if(name==='constructor'||name==='endSearch')continue
   const original=LegacyReaderView.prototype[name]
   Object.defineProperty(fallback,name,{value:(...args)=>{
    if(disposed)throw new Error('Reader view was disposed')
    const Candidate=!native&&compatible()
    if(Candidate)native=new Candidate(screen,panel,mini,returnButton)
    return native?native[name](...args):original.apply(fallback,args)
   }})
  }
  Object.defineProperty(fallback,'free',{value:()=>{native?.free();native=null;disposed=true}})
  return fallback
 }
}
