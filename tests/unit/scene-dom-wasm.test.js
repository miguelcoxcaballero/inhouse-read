import {expect,it,vi} from 'vitest';
import {rustShelf as rust} from './helpers/rust-shelf-ready.js';
import {bookmarkFor} from '../../src/js/bookshelf-layout.js';
import * as reference from './helpers/reference-scene-dom.js';

// The shelf scene's cold DOM and record recipes moved to rust-ui/src/scene_dom.rs. Each one is
// run against its frozen JavaScript original (helpers/reference-scene-dom.js) on equal inputs:
// the same DOM, the same returned values and the same calls, in the same order.
const html=node=>node.outerHTML;
function node(i){
 const element=document.createElement('button');
 if(i%3)element.setAttribute('style',i%2?'left: 3px; color: red;':'');
 if(i%4===1)element.setAttribute('tabindex',String(i%5-1));
 if(i%5===2)element.setAttribute('aria-hidden',i%2?'true':'false');
 if(i%6===3)element.setAttribute('inert','');
 if(i%7===4)element.inert=true;
 element.hidden=i%2===0;
 for(const key of ['trash3d','hover','trashRadius','catalog3d','catalogVisible','plantModelDepth','sceneLean','objectId','other'])if((i+key.length)%3)element.dataset[key]=`${key}${i}`;
 return element;
}
const state=element=>({html:html(element),hidden:element.hidden,inert:element.inert,tabIndex:element.tabIndex});
it('remembers and restores the bin and the booklet nodes exactly as before',()=>{
 for(let i=0;i<40;i++)for(const trash of [true,false]){
  const a=node(i),b=node(i);
  const saved=trash?reference.rememberTrash(a):reference.rememberCatalog(a),native=rust.scene_remember_node(b,trash);
  expect(native).toEqual(saved);expect(Object.keys(native)).toEqual(Object.keys(saved));
  // The scene restyles them in between.
  for(const element of [a,b]){element.style.left='9px';element.hidden=!element.hidden;element.inert=!element.inert;element.tabIndex=-1;element.setAttribute('aria-hidden','true');element.dataset.trash3d='true';element.dataset.catalogVisible='true';}
  if(trash)reference.restoreTrash(a,saved);else reference.restoreCatalog(a,saved);
  rust.scene_restore_node(b,native,trash);
  expect(state(b)).toEqual(state(a));
 }
});
it('restores the projected buttons with or without their cover targets',()=>{
 for(const withCovers of [true,false]){
  const make=()=>{
   const stage=document.createElement('div'),styles=new Map(),covers=new Map();
   for(let i=0;i<12;i++){const button=node(i);stage.append(button);styles.set(button,i%3?button.getAttribute('style'):null);
    button.style.top='4px';button.dataset.sceneProjected='true';button.dataset.sceneHitSurface='spine';button.dataset.plantLeafTexture='photo';
    if(i%4){const cover=document.createElement('span');cover.dataset.shelfCoverHit='true';button.append(cover);covers.set(button,cover);}}
   return {stage,styles,covers};
  };
  const a=make(),b=make();
  reference.restoreButtons(a.styles,withCovers?a.covers:undefined);rust.scene_restore_buttons(b.styles,withCovers?b.covers:undefined);
  expect(html(b.stage)).toEqual(html(a.stage));expect(b.covers.size).toBe(a.covers.size);
 }
 const element=node(5),copy=node(5);reference.clearPlantDiagnostics(element);rust.scene_clear_plant_diagnostics(copy);
 expect(html(copy)).toBe(html(element));expect(()=>rust.scene_clear_plant_diagnostics(undefined)).not.toThrow();
});
it('builds the same foliage target and canvases',()=>{
 for(let i=0;i<6;i++){
  const a=node(i),b=node(i),entry={key:`plant:${i}`};
  const [svg,path,exclusions]=reference.foliageTarget(a,entry),[nativeSvg,nativePath,nativeExclusions]=rust.scene_foliage_target(b,entry);
  const serial=text=>text.replace(/ihr-foliage-\d+/g,'ihr-foliage-N');
  expect(serial(html(b))).toBe(serial(html(a)));
  expect(nativeSvg.parentNode).toBe(b);expect(nativePath.parentNode).toBe(nativeSvg);expect(nativeExclusions.parentNode.parentNode.parentNode).toBe(nativeSvg);
  expect([svg.tagName,path.tagName,exclusions.tagName]).toEqual([nativeSvg.tagName,nativePath.tagName,nativeExclusions.tagName]);
  expect(nativePath.getAttribute('clip-path')).toBe(`url(#${nativeExclusions.parentNode.id})`);
 }
 const ids=[0,1].map(()=>rust.scene_foliage_target(document.createElement('button'),{key:'k'})[2].parentNode.id.split('-').at(-1));
 expect(Number(ids[1])).toBe(Number(ids[0])+1);
 const context=vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockImplementation(function(kind){return {kind,canvas:this};});
 try{
  for(const kind of [0,1,2]){
   const [canvas,ctx]=reference.canvas(kind),[nativeCanvas,nativeContext]=rust.scene_canvas(kind);
   expect(html(nativeCanvas)).toBe(html(canvas));expect(nativeContext).toEqual({kind:'2d',canvas:nativeCanvas});expect(ctx.kind).toBe('2d');
  }
  expect(context).toHaveBeenCalledTimes(6);
 }finally{context.mockRestore();}
});
function book(i){
 const value=[undefined,null,0,-0,1.5,'',`Té${i}`,'📖',true,false,NaN,{a:[1,{b:'c'}]}];
 const pick=k=>value[(i*7+k*3)%value.length];
 return {id:`b${i}`,title:pick(1),author:pick(2),spineTitleOverride:pick(3),spineFontSize:pick(4),spineAuthorFontSize:pick(5),spineFinish:pick(6),
  spineSurfaceFinish:pick(7),spineTextFinish:pick(8),spineTextColor:pick(9),spineEngraved:pick(10),format:pick(11),coverFinish:pick(12),
  coverRelief:i%5?pick(13):undefined,pageEdgeFinish:pick(14),progressFraction:i%4/4,...(i%6===1?{locator:'x'}:{})};
}
function entry(i){
 return {kind:i%9===0?'plant':i%11===0?'lamp':i%2?'book':undefined,book:book(i),style:{color:'#335577',coverRatio:i%3?1.5:undefined,fontFamily:i%2?'serif':undefined,width:20+i},
  coverUrl:i%3?`blob:${i}`:i%4?'':undefined,width:20+i%7,height:150+i,thickness:i%4?24:undefined,overview:i%3===0?1:0,inspectionResolution:i%5?1024:undefined,
  variant:'monstera',catalogId:i%2?'c':undefined,potId:'muskot',potColorId:i%3?'white':null,seed:`s${i}`,lampId:'tarnaby',depth:i%2?40:undefined,mount:i%3?'undershelf':undefined};
}
it('keeps every material and model key string',()=>{
 for(let i=0;i<120;i++){
  const e=entry(i);
  expect(rust.scene_material_keys(e,bookmarkFor)).toEqual(reference.materialKeys(e,bookmarkFor));
  for(const kind of [0,1,2])expect(rust.scene_model_key(e,kind)).toBe([reference.plantKeys,reference.plantShapeKeys,reference.lampKeys][kind](e));
  expect(rust.scene_replacement_target(e,bookmarkFor)).toEqual(reference.replacementTarget(e,bookmarkFor));
 }
 expect(()=>rust.scene_material_keys({book:undefined,style:{}},bookmarkFor)).toThrow(TypeError);
});
function model(log,i){
 const data={shelfKeys:i%3?undefined:{spine:'x'}};
 for(const name of ['updateSpineAppearance','updateCoverSource','updateCoverAppearance','updateEdgeAppearance','updateBookmark'])
  if((i>>name.length%5)&1||name==='updateSpineAppearance')data[name]=function(...args){log.push([name,this===data,...args.map(a=>a?.id??a)]);};
 return {userData:data};
}
it('updates shown materials and retains pending replacements with the same calls',()=>{
 let calls=0,kept=0,replaced=0;
 for(let i=0;i<120;i++){
  const logs=[[],[]],states=[];
  for(const [side,keys,update,retain] of [[0,reference.materialKeys,reference.updateMaterials,reference.retainReplacement],[1,null,null,null]]){
   const e=entry(i),log=logs[side];e.model=i%7?model(log,i):null;
   if(e.model&&i%2)e.model.userData.shelfKeys=(side?rust.scene_material_keys(e,bookmarkFor):keys(e,bookmarkFor));
   if(i%4===1)e.book={...e.book,progressFraction:.9};
   const replace=next=>log.push(['replace',next===e]);
   if(side)rust.scene_update_materials(e,bookmarkFor,replace);else update(e,bookmarkFor,replace);
   e.replacement=i%5?model(log,i+1):null;e.qualityReplacement=i%13===0;
   if(e.replacement)e.replacement.userData.shelfReplacementTarget=i%3?{geometry:side?rust.scene_replacement_target(e,bookmarkFor).geometry:reference.replacementTarget(e,bookmarkFor).geometry,
    materials:{...(side?rust.scene_material_keys(e,bookmarkFor):keys(e,bookmarkFor)),bookmark:i%2?'old':undefined}}:undefined;
   const target=side?rust.scene_replacement_target(e,bookmarkFor):reference.replacementTarget(e,bookmarkFor);
   const kept=side?rust.scene_retain_replacement(e,target):retain(e,target);
   states.push(JSON.stringify({kept,keys:e.model?.userData.shelfKeys,replacement:e.replacement?.userData.shelfKeys,target:e.replacement?.userData.shelfReplacementTarget===target}));
  }
  expect(logs[1]).toEqual(logs[0]);expect(states[1]).toBe(states[0]);
  calls+=logs[0].length;kept+=JSON.parse(states[0]).kept?1:0;replaced+=logs[0].filter(call=>call[0]==='replace').length;
 }
 expect(calls).toBeGreaterThan(100);expect(kept).toBeGreaterThan(5);expect(replaced).toBeGreaterThan(5);
});

function scene3d(log,seed){
 const mat=i=>{const m={name:`m${i}`,dispose(){log.push(['dispose',this.name]);}};for(const key of ['map','normalMap','bumpMap','roughnessMap','alphaMap'])if((seed+i+key.length)%3)m[key]={anisotropy:1,name:`${key}${i}`};return m;};
 const shared=mat(99);
 const make=(depth,i)=>{
  const object={name:`o${depth}-${i}`,isMesh:(i+depth)%3!==0,children:[],traverse(callback){callback(this);for(const child of this.children)child.traverse(callback);}};
  if((i+seed)%4===1)object.material=[mat(i),shared,mat(i+1)];else if((i+seed)%4===2)object.material=shared;else if((i+seed)%4===3)object.material=mat(i);
  if((i+depth)%2)object.geometry={dispose(){log.push(['geometry',object.name]);}};
  if(depth<3)for(let k=0;k<(seed+i)%3+1;k++)object.children.push(make(depth+1,i*3+k));
  return object;
 };
 const root=make(0,seed);root.userData={};return root;
}
const shape=object=>JSON.stringify(object,(key,value)=>typeof value==='function'?undefined:key==='entry'?value.kind??'book':value);
it('prepares and releases models with the same walks',()=>{
 for(let seed=0;seed<12;seed++)for(const kind of ['lamp','plant',undefined]){
  const logs=[[],[]],[a,b]=[scene3d(logs[0],seed),scene3d(logs[1],seed)],entry={kind};
  let calls=0;const renderer={capabilities:{getMaxAnisotropy(){calls++;return seed%2?8:32;}}};
  reference.prepareModel(a,entry,renderer);const before=calls;rust.scene_prepare_model(b,entry,renderer.capabilities);
  expect(shape(b)).toBe(shape(a));expect(b.userData.entry).toBe(entry);expect(calls-before).toBe(before);
  reference.releaseObject(a);rust.scene_release_object(b);
  expect(logs[1]).toEqual(logs[0]);
 }
});
it('repaints fonts and reorders entries as before',()=>{
 const logs=[[],[]];
 const entries=side=>Array.from({length:14},(_,i)=>{
  const model=k=>({userData:{invalidate:`redraw${k}`,...(k%3?{updateSpineAppearance(...args){logs[side].push(['spine',k,this.invalidate,...args.map(a=>a?.id??a)]);}}:{}),
   ...(k%2?{updateCoverSource(...args){logs[side].push(['cover',k,this.invalidate,...args.map(a=>a?.id??a)]);}}:{})}});
  const shown=i%5?model(i):null;
  return {kind:i%7===3?'plant':i%6===4?'lamp':'book',book:{id:`b${i}`},style:{id:`s${i}`},coverUrl:i%4?'':'blob:x',model:shown,replacement:i%3?model(i+20):i%2?shown:null};
 });
 const [a,b]=[entries(0),entries(1)];reference.refreshFonts(a);rust.scene_refresh_fonts(b);
 expect(logs[1]).toEqual(logs[0]);expect(logs[0].length).toBeGreaterThan(8);
 expect(b.map(e=>[e.model?.userData.invalidate,e.replacement?.userData.invalidate])).toEqual(a.map(e=>[e.model?.userData.invalidate,e.replacement?.userData.invalidate]));
 const rect=(left,top)=>({left,top,right:left+10,bottom:top+10,width:10,height:10});
 for(let seed=0;seed<20;seed++){
  const list=Array.from({length:16},(_,i)=>{
   const node=i%5?document.createElement('button'):null;
   if(node&&(i+seed)%3)node.dataset.objectId=`o${i}`;if(node&&(i+seed)%4===1)node.dataset.bookId=`b${i}`;
   return {key:`k${i}`,node,book:i%2?{id:`b${i}`}:undefined,tapRect:(i+seed)%3?rect(i*7,seed):undefined,hitRect:(i+seed)%5?rect(i*7+.25,seed):undefined,rect:rect(i,i)};
  });
  const old=new Map();
  for(let i=0;i<16;i++)if((i*seed)%7!==3)old.set([`o${i}`,`b${i}`,`k${i}`][(i+seed)%3],rect(i*7+(i%4)*.4+seed%3,seed+(i%3)*.5));
  const stage={left:seed%4*.5,top:-seed};
  for(const dragged of [undefined,null,`o${seed%16}`,`k${seed%16}`,seed%16]){
   const [items,entry]=reference.reorderItems(list,old,stage,dragged),[nativeItems,nativeEntry]=rust.scene_reorder_items(list,old,stage.left,stage.top,dragged);
   expect(nativeItems.map(item=>[item.entry,item.x,item.y])).toEqual(items.map(item=>[item.entry,item.x,item.y]));
   expect(nativeEntry??null).toBe(entry??null);
  }
 }
});
