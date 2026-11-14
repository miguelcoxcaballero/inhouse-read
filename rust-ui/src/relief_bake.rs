//! A book model's asynchronous relief bake (formerly `setCoverRelief`, `bakeReliefMaterial` and their cache
//! keys in src/js/book-model.js): which choice is wanted, whether the installed maps can be reused, the build
//! or recomposition of the maps, the normal texture with the selection in its alpha, the material map for the
//! current laminate, and every revision, abort and disposal check between those awaits.
//!
//! Promise for promise as in the original (tests/unit/book-relief-bake-differential.test.js runs it against
//! the frozen model of tests/unit/helpers/reference-book-model.js): two bakes racing on one model settle in
//! the same order. The map builders are the host's (`buildRelief`, `updateRelief`, `materialMap`), so the
//! page's slice driver and its test doubles stay where they were.
use super::*;
use std::cmp::Ordering;
use crate::book_model_build::{book_model_adopt_relief,book_model_arm_relief,book_model_clear_relief,book_model_map_texture,book_model_relief_source,
 book_model_relief_uniforms};
use crate::cover_relief_portable::cover_relief_layers;

#[wasm_bindgen]
extern "C"{
 /// The model's state, its host, a relief choice, built maps: every member is one typed crossing.
 type Part;
 #[wasm_bindgen(constructor,js_class="AbortController",catch)]fn controller()->R<Part>;
 #[wasm_bindgen(method,catch)]fn abort(this:&Part)->R<()>;
 #[wasm_bindgen(method,catch)]fn has(this:&Part,value:&JsValue)->R<JsValue>;
 #[wasm_bindgen(method,catch)]fn dispose(this:&Part)->R<()>;
 #[wasm_bindgen(method,catch)]fn slice(this:&Part)->R<JsValue>;
 #[wasm_bindgen(method,catch,js_name=localeCompare)]fn locale_compare(this:&Part,other:&JsValue)->R<JsValue>;
 #[wasm_bindgen(method,catch,js_name=invalidate)]fn redraw(this:&Part)->R<()>;
 #[wasm_bindgen(method,getter,catch)]fn invalidate(this:&Part)->R<JsValue>;
 #[wasm_bindgen(method,catch,js_name=normalizeRelief)]fn normalize_relief(this:&Part,relief:&JsValue)->R<JsValue>;
 #[wasm_bindgen(method,catch,js_name=buildRelief)]fn build_relief(this:&Part,source:&JsValue,choice:&JsValue,options:&JsValue)->R<JsValue>;
 #[wasm_bindgen(method,catch,js_name=updateRelief)]fn update_relief(this:&Part,built:&JsValue,choice:&JsValue,options:&JsValue)->R<JsValue>;
 #[wasm_bindgen(method,catch,js_name=materialMap)]fn material_map(this:&Part,maps:&JsValue,finish:&JsValue)->R<JsValue>;
 #[wasm_bindgen(method,getter,catch)]fn disposed(this:&Part)->R<JsValue>;
 #[wasm_bindgen(method,getter,catch,js_name=reliefController)]fn relief_controller(this:&Part)->R<JsValue>;
 #[wasm_bindgen(method,getter,catch)]fn host(this:&Part)->R<JsValue>;
 #[wasm_bindgen(method,getter,catch)]fn three(this:&Part)->R<JsValue>;
 #[wasm_bindgen(method,getter,catch,js_name=reliefRevision)]fn relief_revision(this:&Part)->R<JsValue>;
 #[wasm_bindgen(method,getter,catch,js_name=materialRevision)]fn material_revision(this:&Part)->R<JsValue>;
 #[wasm_bindgen(method,getter,catch,js_name=coverSurfaceFinish)]fn surface_finish(this:&Part)->R<JsValue>;
 #[wasm_bindgen(method,getter,catch,js_name=reliefArmed)]fn relief_armed(this:&Part)->R<JsValue>;
 #[wasm_bindgen(method,getter,catch,js_name=reliefMaps)]fn relief_maps(this:&Part)->R<JsValue>;
 #[wasm_bindgen(method,getter,catch,js_name=reliefOwned)]fn relief_owned(this:&Part)->R<JsValue>;
 #[wasm_bindgen(method,getter,catch)]fn group(this:&Part)->R<JsValue>;
 #[wasm_bindgen(method,getter,catch,js_name=userData)]fn user_data(this:&Part)->R<JsValue>;
 #[wasm_bindgen(method,getter,catch)]fn ready(this:&Part)->R<JsValue>;
 #[wasm_bindgen(method,getter,catch)]fn overview(this:&Part)->R<JsValue>;
 #[wasm_bindgen(method,getter,catch)]fn shelf(this:&Part)->R<JsValue>;
 #[wasm_bindgen(method,getter,catch,js_name=inspectionResolution)]fn inspection(this:&Part)->R<JsValue>;
 #[wasm_bindgen(method,getter,catch)]fn key(this:&Part)->R<JsValue>;
 #[wasm_bindgen(method,getter,catch)]fn source(this:&Part)->R<JsValue>;
 #[wasm_bindgen(method,getter,catch,js_name=strengthKey)]fn strength_key(this:&Part)->R<JsValue>;
 #[wasm_bindgen(method,getter,catch)]fn layers(this:&Part)->R<JsValue>;
 #[wasm_bindgen(method,getter,catch)]fn id(this:&Part)->R<JsValue>;
 #[wasm_bindgen(method,getter,catch)]fn color(this:&Part)->R<JsValue>;
 #[wasm_bindgen(method,getter,catch)]fn tolerance(this:&Part)->R<JsValue>;
 #[wasm_bindgen(method,getter,catch)]fn strength(this:&Part)->R<JsValue>;
 #[wasm_bindgen(method,getter,catch)]fn size(this:&Part)->R<JsValue>;
 #[wasm_bindgen(method,getter,catch,js_name=normalTexture)]fn normal_texture(this:&Part)->R<JsValue>;
 #[wasm_bindgen(method,getter,catch)]fn mask(this:&Part)->R<JsValue>;
 #[wasm_bindgen(method,getter,catch,js_name=heightMap)]fn height_map(this:&Part)->R<JsValue>;
 #[wasm_bindgen(method,setter,catch,js_name=reliefController)]fn set_relief_controller(this:&Part,value:&JsValue)->R<()>;
 #[wasm_bindgen(method,setter,catch,js_name=reliefRevision)]fn set_relief_revision(this:&Part,value:f64)->R<()>;
 #[wasm_bindgen(method,setter,catch,js_name=materialRevision)]fn set_material_revision(this:&Part,value:f64)->R<()>;
 #[wasm_bindgen(method,setter,catch,js_name=wantedRelief)]fn set_wanted_relief(this:&Part,value:&JsValue)->R<()>;
 #[wasm_bindgen(method,setter,catch,js_name=reliefMaps)]fn set_relief_maps(this:&Part,value:&JsValue)->R<()>;
 #[wasm_bindgen(method,setter,catch,js_name=normalTexture)]fn set_normal_texture(this:&Part,value:&JsValue)->R<()>;
 #[wasm_bindgen(method,setter,catch,js_name=id)]fn set_id(this:&Part,value:&JsValue)->R<()>;
 #[wasm_bindgen(method,setter,catch,js_name=key)]fn set_key(this:&Part,value:&JsValue)->R<()>;
 #[wasm_bindgen(method,setter,catch,js_name=strengthKey)]fn set_strength_key(this:&Part,value:&JsValue)->R<()>;
 #[wasm_bindgen(method,setter,catch,js_name=source)]fn set_source(this:&Part,value:&JsValue)->R<()>;
 #[wasm_bindgen(method,setter,js_name=signal)]fn set_signal(this:&Part,value:&JsValue);
 #[wasm_bindgen(method,setter,js_name=maxSize)]fn set_max_size(this:&Part,value:f64);
 #[wasm_bindgen(method,setter,js_name=selectionAlpha)]fn set_selection_alpha(this:&Part,value:bool);
}
fn part(value:&JsValue)->&Part{value.unchecked_ref()}

/// `coverReliefLayers(choice).sort((a, b) => a.color.localeCompare(b.color))`.
fn sorted_layers(choice:&JsValue)->R<Vec<JsValue>>{
 let mut layers:Vec<JsValue>=cover_relief_layers(choice)?.iter().collect();
 let mut failure=None;
 layers.sort_by(|a,b|{
  let compared=(||->R<f64>{Ok(num(&part(&part(a).color()?).locale_compare(&part(b).color()?)?))})();
  match compared{
   Ok(order)=>if order<0.0{Ordering::Less}else if order>0.0{Ordering::Greater}else{Ordering::Equal},
   Err(thrown)=>{failure.get_or_insert(thrown);Ordering::Equal}
  }
 });
 match failure{Some(thrown)=>Err(thrown),None=>Ok(layers)}
}
fn json(list:&Array)->R<JsValue>{Ok(js_sys::JSON::stringify(list)?.into())}
/// What the installed maps were classified for: the colours and tolerances, whatever order they were ticked in.
fn relief_key(choice:&JsValue)->R<JsValue>{
 let list=Array::new();
 if truthy(&part(choice).layers()?){
  list.push(&JsValue::from_str(intern("layers")));
  for layer in sorted_layers(choice)?{list.push(&Array::of2(&part(&layer).color()?,&part(&layer).tolerance()?));}
 }else{
  let or_null=|value:JsValue|if absent(&value){JsValue::NULL}else{value};
  let choice=part(choice);
  list.push(&choice.id()?);list.push(&or_null(choice.color()?));list.push(&or_null(choice.tolerance()?));
 }
 json(&list)
}
/// The intensities those maps were composed with; `null` for a single colour.
fn strength_key(choice:&JsValue)->R<JsValue>{
 if !truthy(&part(choice).layers()?){return Ok(JsValue::NULL)}
 let list=Array::new();
 for layer in sorted_layers(choice)?{list.push(&part(&layer).strength()?);}
 json(&list)
}
/// `s.group.userData.invalidate?.()`.
fn invalidate(s:&JsValue)->R{
 let user=part(&part(s).group()?).user_data()?;
 if absent(&part(&user).invalidate()?){Ok(())}else{part(&user).redraw()}
}

/// `bakeReliefMaterial(s, revision, maps = s.reliefMaps, signal)`: the packed material map of `maps` for the
/// cover's current laminate, installed with the normal map unless a newer choice, bake or finish overtook it.
fn bake(s:&JsValue,revision:JsValue,maps:JsValue,signal:JsValue)->Promise{
 let (flow,promise)=Flow::new();
 let s=s.clone();
 flow.clone().run(move||{
  let state=part(&s);
  let maps=if maps.is_undefined(){state.relief_maps()?}else{maps};
  if !truthy(&maps){flow.resolve(&JsValue::FALSE);return Ok(())}
  let ticket=num(&state.material_revision()?)+1.0;
  state.set_material_revision(ticket)?;
  let (finish,host)=(state.surface_finish()?,state.host()?);
  let composing=part(&host).material_map(&maps,&finish)?;
  flow.clone().then(&composing,move|rgba|{
   let state=part(&s);
   if revision!=state.relief_revision()?||num(&state.material_revision()?)!=ticket||aborted(&signal)?||truthy(&state.disposed()?){
    flow.resolve(&JsValue::FALSE);return Ok(())
   }
   // A finish can change while the first colour map is still being built; at that point there is no
   // installed map for updateCoverAppearance to rebake. Do not commit material pixels computed for the old laminate.
   if finish!=state.surface_finish()?{flow.resolve(&bake(&s,revision,maps,signal));return Ok(())}
   let size=part(&maps).size()?;
   let normal=part(&maps).normal_texture()?;
   let material=book_model_map_texture(&part(&host).three()?,&rgba,&bag(&size).width()?,&bag(&size).height()?)?;
   book_model_adopt_relief(&s,normal,material)?;
   state.set_relief_maps(&maps)?;
   book_model_relief_uniforms(&s)?;
   flow.resolve(&JsValue::TRUE);
   Ok(())
  });
  Ok(())
 });
 promise
}

/// The finish changed under installed maps: bake them again and redraw if they were installed.
#[wasm_bindgen]
pub fn book_model_rebake_relief(s:JsValue,revision:JsValue){
 let baking=bake(&s,revision,undefined(),undefined());
 wait(&baking,move|outcome|{
  // A failure here was an unhandled rejection, and still is.
  if let Err(failure)=outcome.and_then(|done|if truthy(&done){invalidate(&s)}else{Ok(())}){let _=Promise::reject(&failure);}
 });
}

/// One `setCoverRelief` from its `try` on.
struct Bake{flow:Flow,s:JsValue,next:JsValue,revision:JsValue,signal:JsValue,cached:bool,built:RefCell<JsValue>}
impl Bake{
 /// The body's `try { ... } catch { ...; return false }`: a map nobody installed is released.
 fn attempt(self:&Rc<Self>,step:impl FnOnce(&Rc<Self>)->R){
  if step(self).is_ok(){return}
  let built=self.built.borrow().clone();
  let released=(||->R{
   if absent(&built){return Ok(())}
   let texture=part(&built).normal_texture()?;
   if truthy(&texture)&&!truthy(&part(&part(&self.s).relief_owned()?).has(&texture)?){part(&texture).dispose()?;}
   Ok(())
  })();
  match released{Ok(())=>self.flow.resolve(&JsValue::FALSE),Err(failure)=>self.flow.0.reject(&failure)}
 }
 fn then(self:&Rc<Self>,value:&JsValue,step:impl FnOnce(&Rc<Self>,JsValue)->R+'static){
  let bake=self.clone();
  wait(value,move|outcome|bake.attempt(|bake|step(bake,outcome?)));
 }
 /// A newer choice, a disposal or an abort overtook this one.
 fn overtaken(&self)->R<bool>{
  let state=part(&self.s);
  Ok(self.revision!=state.relief_revision()?||truthy(&state.disposed()?)||truthy(&bag(&self.signal).aborted()?))
 }
 fn stop(&self)->R{self.flow.resolve(&JsValue::FALSE);Ok(())}
 fn build(self:&Rc<Self>)->R{
  if self.overtaken()?{return self.stop()}
  // The map uses the same fitted raster/UVs as the printed cover, including any aspect-ratio margins.
  // Analysing the unfitted source shifts masks.
  let state=part(&self.s);
  let source=book_model_relief_source(&self.s)?;
  if !truthy(&source){return self.stop()}
  let host=state.host()?;
  let options=object();
  let building=if self.cached{
   part(&options).set_signal(&self.signal);
   part(&host).update_relief(&state.relief_maps()?,&self.next,&options)?
  }else{
   let size=if truthy(&state.overview()?){128.0}else if truthy(&state.shelf()?)&&!truthy(&state.inspection()?){256.0}else{512.0};
   part(&options).set_max_size(size);part(&options).set_selection_alpha(true);part(&options).set_signal(&self.signal);
   part(&host).build_relief(&source,&self.next,&options)?
  };
  self.then(&building,move|bake,built|bake.install(built,source));
  Ok(())
 }
 fn install(self:&Rc<Self>,built:JsValue,source:JsValue)->R{
  *self.built.borrow_mut()=built.clone();
  if !truthy(&built)||self.overtaken()?{return self.stop()}
  let maps=part(&built);
  let size=maps.size()?;
  let (width,height)=(bag(&size).width()?,bag(&size).height()?);
  let packed=truthy(&bag(&built).normal_selection_alpha()?);
  let normals=if packed{bag(&built).normal()?}else{part(&bag(&built).normal()?).slice()?};
  if !packed{
   // Alpha is not used by a normal map. Keep the selection there so the shader restores exact base-finish
   // floats outside it (no byte-rounding drift), without another texture, mesh, draw or shader variant.
   let count=num(&width)*num(&height);
   let mut index=0u32;
   while f64::from(index)<count{
    let pixels=bag(&built).pixels()?;
    let mask=part(&pixels).mask()?;
    let mut value=if absent(&mask){undefined()}else{get_at(&mask,index)};
    if absent(&value){
     let at=|plane:JsValue|->R<JsValue>{js_sys::Reflect::get_u32(&plane,index)};
     let (gloss,foil)=(at(bag(&pixels).gloss()?)?,at(bag(&pixels).foil()?)?);
     let height_map=part(&pixels).height_map()?;
     let raised=if absent(&height_map){undefined()}else{get_at(&height_map,index)};
     let raised=if absent(&raised){0.0}else{num(&raised)};
     value=number(jmax(jmax(num(&gloss),num(&foil)),raised));
    }
    js_sys::Reflect::set_u32(&normals,index*4+3,&value)?;
    index+=1;
   }
  }
  let state=part(&self.s);
  maps.set_normal_texture(&book_model_map_texture(&part(&state.host()?).three()?,&normals,&width,&height)?)?;
  maps.set_id(&part(&self.next).id()?)?;
  maps.set_key(&relief_key(&self.next)?)?;
  maps.set_strength_key(&strength_key(&self.next)?)?;
  maps.set_source(&source)?;
  let baking=bake(&self.s,self.revision.clone(),built.clone(),self.signal.clone());
  self.then(&baking,move|bake,done|{
   if !truthy(&done){part(&part(&built).normal_texture()?).dispose()?;return bake.stop()}
   invalidate(&bake.s)?;
   bake.flow.resolve(&JsValue::TRUE);
   Ok(())
  });
  Ok(())
 }
}

/// `userData.setCoverRelief(relief)`: apply (or clear, with null) a relief choice. Resolves true once drawn.
#[wasm_bindgen]
pub fn book_model_set_relief(s:JsValue,relief:JsValue)->Promise{
 let (flow,promise)=Flow::new();
 flow.clone().run(move||{
  let state=part(&s);
  if truthy(&state.disposed()?){flow.resolve(&JsValue::FALSE);return Ok(())}
  let previous=state.relief_controller()?;
  if !absent(&previous){part(&previous).abort()?;}
  let controller:JsValue=Part::controller()?.into();
  state.set_relief_controller(&controller)?;
  let next=part(&state.host()?).normalize_relief(&relief)?;
  let revision=num(&state.relief_revision()?)+1.0;
  state.set_relief_revision(revision)?;
  state.set_wanted_relief(&next)?;
  if !truthy(&next){
   if truthy(&state.relief_armed()?){book_model_clear_relief(&s)?;}
   flow.resolve(&JsValue::TRUE);return Ok(())
  }
  book_model_arm_relief(&s)?;
  // Only installed maps may be reused. A pending bake owns no cached state.
  let installed=state.relief_maps()?;
  let cached=truthy(&installed)&&part(&installed).key()?==relief_key(&next)?&&part(&installed).source()?==book_model_relief_source(&s)?;
  if cached&&(!truthy(&part(&next).layers()?)||part(&state.relief_maps()?).strength_key()?==strength_key(&next)?){
   book_model_relief_uniforms(&s)?;invalidate(&s)?;
   flow.resolve(&JsValue::TRUE);return Ok(())
  }
  let signal=bag(&controller).signal()?;
  let bake=Rc::new(Bake{flow,s:s.clone(),next,revision:number(revision),signal,cached,built:RefCell::new(undefined())});
  bake.attempt(|bake|{
   let ready=part(&part(&part(&bake.s).group()?).user_data()?).ready()?;
   bake.then(&ready,|bake,_|bake.build());
   Ok(())
  });
  Ok(())
 });
 promise
}
