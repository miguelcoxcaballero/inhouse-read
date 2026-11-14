//! The cover relief's browser wrapper (formerly the second half of src/js/cover-relief.js): the bounded image
//! decode (4 s, abortable), the working rasters, the preview thumbnails, and the three public flows
//! `analyzeCoverRelief`, `buildReliefMaps` and `updateReliefMapStrengths`.
//!
//! As in the cover analyser above this module, every `async` function of the original is one promise here and
//! every `await` one `Promise.resolve(value).then(...)`, in the same order, so a caller sees its answer on the
//! same microtask as before and two concurrent bakes interleave as they did
//! (tests/unit/cover-relief-flow-differential.test.js runs both against the frozen copy). The passes themselves
//! stay generators stepped by the page's slice driver: the host hands over `sliced` (runSliced), the generator
//! makers and `ready`.
use super::*;
use crate::cover_relief::{relief_analysis_report,relief_fit_dimensions,relief_map_mode,relief_map_resolution,relief_normal_unit,relief_proposal,
 relief_selected_layers,relief_thumbnail_size};
use crate::host::{get_at,method,read,set};

#[wasm_bindgen]
extern "C"{
 #[wasm_bindgen(js_namespace=Promise,js_name=all,catch)]fn all(list:&JsValue)->R<JsValue>;
 /// Whatever the flows read or write: every member is one typed crossing, with no property name to send.
 type Bag;
 #[wasm_bindgen(constructor,js_class="ImageData",catch)]fn image_data(data:&JsValue,width:&JsValue,height:&JsValue)->R<Bag>;
 #[wasm_bindgen(method,getter,catch)]fn width(this:&Bag)->R<JsValue>;
 #[wasm_bindgen(method,getter,catch)]fn height(this:&Bag)->R<JsValue>;
 #[wasm_bindgen(method,getter,catch,js_name=naturalWidth)]fn natural_width(this:&Bag)->R<JsValue>;
 #[wasm_bindgen(method,getter,catch,js_name=videoWidth)]fn video_width(this:&Bag)->R<JsValue>;
 #[wasm_bindgen(method,getter,catch,js_name=displayWidth)]fn display_width(this:&Bag)->R<JsValue>;
 #[wasm_bindgen(method,getter,catch,js_name=naturalHeight)]fn natural_height(this:&Bag)->R<JsValue>;
 #[wasm_bindgen(method,getter,catch,js_name=videoHeight)]fn video_height(this:&Bag)->R<JsValue>;
 #[wasm_bindgen(method,getter,catch,js_name=displayHeight)]fn display_height(this:&Bag)->R<JsValue>;
 #[wasm_bindgen(method,getter,catch)]fn aborted(this:&Bag)->R<JsValue>;
 #[wasm_bindgen(method,getter,catch)]fn signal(this:&Bag)->R<JsValue>;
 #[wasm_bindgen(method,getter,catch,js_name=maxSize)]fn max_size(this:&Bag)->R<JsValue>;
 #[wasm_bindgen(method,getter,catch,js_name=selectionAlpha)]fn selection_alpha(this:&Bag)->R<JsValue>;
 #[wasm_bindgen(method,getter,catch)]fn normal(this:&Bag)->R<JsValue>;
 #[wasm_bindgen(method,getter,catch)]fn foil(this:&Bag)->R<JsValue>;
 #[wasm_bindgen(method,getter,catch)]fn gloss(this:&Bag)->R<JsValue>;
 #[wasm_bindgen(method,getter,catch)]fn pixels(this:&Bag)->R<JsValue>;
 #[wasm_bindgen(method,getter,catch,js_name=foilColor)]fn foil_color(this:&Bag)->R<JsValue>;
 #[wasm_bindgen(method,getter,catch)]fn ms(this:&Bag)->R<JsValue>;
 #[wasm_bindgen(method,getter,catch,js_name=longestSliceMs)]fn longest(this:&Bag)->R<JsValue>;
 #[wasm_bindgen(method,getter,catch)]fn slices(this:&Bag)->R<JsValue>;
 #[wasm_bindgen(method,getter,catch,js_name=normalSelectionAlpha)]fn normal_selection_alpha(this:&Bag)->R<JsValue>;
 #[wasm_bindgen(method,setter,js_name=data)]fn set_data(this:&Bag,value:&JsValue);
 #[wasm_bindgen(method,setter,js_name=width)]fn set_width(this:&Bag,value:&JsValue);
 #[wasm_bindgen(method,setter,js_name=height)]fn set_height(this:&Bag,value:&JsValue);
 #[wasm_bindgen(method,setter,js_name=foil)]fn set_foil(this:&Bag,value:&JsValue);
 #[wasm_bindgen(method,setter,js_name=gloss)]fn set_gloss(this:&Bag,value:&JsValue);
 #[wasm_bindgen(method,setter,js_name=normal)]fn set_normal(this:&Bag,value:&JsValue);
 #[wasm_bindgen(method,setter,js_name=normalSelectionAlpha)]fn set_normal_selection_alpha(this:&Bag,value:bool);
 #[wasm_bindgen(method,setter,js_name=pixels)]fn set_pixels(this:&Bag,value:&JsValue);
 #[wasm_bindgen(method,setter,js_name=size)]fn set_size(this:&Bag,value:&JsValue);
 #[wasm_bindgen(method,setter,js_name=foilColor)]fn set_foil_color(this:&Bag,value:&JsValue);
 #[wasm_bindgen(method,setter,js_name=stats)]fn set_stats(this:&Bag,value:&JsValue);
 #[wasm_bindgen(method,setter,js_name=ms)]fn set_ms(this:&Bag,value:f64);
 #[wasm_bindgen(method,setter,js_name=longestSliceMs)]fn set_longest(this:&Bag,value:&JsValue);
 #[wasm_bindgen(method,setter,js_name=slices)]fn set_slices(this:&Bag,value:&JsValue);
 #[wasm_bindgen(method,setter,catch,js_name=imageSmoothingEnabled)]fn set_smoothing(this:&Bag,value:bool)->R<()>;
 #[wasm_bindgen(method,setter,catch,js_name=imageSmoothingQuality)]fn set_smoothing_quality(this:&Bag,value:&str)->R<()>;
 // The host of src/js/cover-relief.js.
 #[wasm_bindgen(method,catch)]fn normalize(this:&Bag,relief:&JsValue)->R<JsValue>;
 #[wasm_bindgen(method,catch,js_name=ready)]fn shelf_ready(this:&Bag)->R<JsValue>;
 #[wasm_bindgen(method,catch)]fn sliced(this:&Bag,task:&JsValue,signal:&JsValue,stats:&JsValue)->R<JsValue>;
 #[wasm_bindgen(method,catch)]fn maps(this:&Bag,work:&JsValue,hires:&JsValue,choice:&JsValue)->R<JsValue>;
 #[wasm_bindgen(method,catch)]fn render(this:&Bag,maps:&JsValue,unit:f64,alpha:&JsValue,fresh:bool,layers:&JsValue)->R<JsValue>;
}
fn bag(value:&JsValue)->&Bag{value.unchecked_ref()}
fn object()->JsValue{Object::new().into()}

const WORK_SIZE:f64=288.0;
const MAP_SIZE:f64=512.0;

fn abort_error()->JsValue{let error=js_sys::Error::new("Análisis cancelado");error.set_name("AbortError");error.into()}
/// `signal?.aborted`.
fn aborted(signal:&JsValue)->R<bool>{if absent(signal){Ok(false)}else{Ok(truthy(&bag(signal).aborted()?))}}
/// A destructuring default: `{ key = fallback }`.
fn or(value:JsValue,fallback:JsValue)->JsValue{if value.is_undefined(){fallback}else{value}}
fn record(entries:&[(&str,&JsValue)])->R<JsValue>{
 let value:JsValue=Object::new().into();
 for (key,entry) in entries{set(&value,key,entry)?;}
 Ok(value)
}
fn text(value:&str)->JsValue{JsValue::from_str(value)}

/// One `async` function between its awaits: a failure anywhere rejects its promise.
#[derive(Clone)]
struct Flow(Rc<Deferred>);
impl Flow{
 fn new()->(Flow,Promise){let done=Deferred::new();let promise=done.promise.clone();(Flow(done),promise)}
 fn run(&self,step:impl FnOnce()->R){if let Err(failure)=step(){self.0.reject(&failure);}}
 /// `await value`, then `step`.
 fn then(&self,value:&JsValue,step:impl FnOnce(JsValue)->R+'static){
  let flow=self.clone();
  wait(value,move|outcome|flow.run(||step(outcome?)));
 }
 fn resolve(&self,value:&JsValue){self.0.resolve(value)}
}

/// `new Promise((resolve, reject) => { image.onload = resolve; image.onerror = () => reject(new Error(...)); })`.
fn readable(image:&JsValue)->Promise{
 Promise::new(&mut|resolve,reject|{
  let rejecter=reject.clone();
  let unreadable=js_owned(Closure::<dyn Fn()>::new(move||{let _=rejecter.call1(&JsValue::UNDEFINED,&error("No se pudo leer la portada"));}));
  if let Err(failure)=duck(image).set_onload(&resolve).and_then(|_|duck(image).set_onerror(&unreadable)){let _=reject.call1(&JsValue::UNDEFINED,&failure);}
 })
}

/// `decode(source, signal)`: a URL becomes a decoded image within four seconds unless the signal aborts first;
/// anything else is already drawable.
fn decode(source:&JsValue,signal:&JsValue)->JsValue{
 let done=Deferred::new();
 let promise:JsValue=done.promise.clone().into();
 let begun=(||->R<Option<(JsValue,Option<Promise>)>>{
  if aborted(signal)?{return Err(abort_error())}
  if !source.is_string(){return Ok(None)}
  if duck(&page()).image_class().is_undefined(){return Err(error("Sin imágenes en este entorno"))}
  let image:JsValue=Duck::image()?.into();
  duck(&image).set_decoding(intern("async"))?;
  let by_events=if duck(&image).decoder()?.is_function(){None}else{Some(readable(&image))};
  duck(&image).set_src(source)?;
  Ok(Some((image,by_events)))
 })();
 let (image,by_events)=match begun{
  Ok(Some(pair))=>pair,
  Ok(None)=>{done.resolve(source);return promise}
  Err(failure)=>{done.reject(&failure);return promise}
 };
 let timer:Rc<RefCell<Option<Timeout>>>=Rc::new(RefCell::new(None));
 let on_abort=Rc::new(RefCell::new(undefined()));
 let raced=(||->R<JsValue>{
  let first:JsValue=match by_events{Some(loaded)=>loaded.into(),None=>duck(&image).decode()?};
  let started=timer.clone();
  let slow=Promise::new(&mut|resolve,reject|match Timeout::start(&resolve,&reject,4000.0){
   Ok(timeout)=>*started.borrow_mut()=Some(timeout),
   Err(failure)=>{let _=reject.call1(&JsValue::UNDEFINED,&failure);}
  });
  let cancelled=Promise::new(&mut|_,reject|{
   if absent(signal){return}
   let rejecter=reject.clone();
   // JavaScript owns the listener: it goes with the signal or with its removal below.
   let listener=js_owned(Closure::<dyn Fn()>::new(move||{let _=rejecter.call1(&JsValue::UNDEFINED,&abort_error());}));
   *on_abort.borrow_mut()=listener.clone();
   let listening=(||->R{
    method(signal,"addEventListener",&[&text("abort"),&listener,&record(&[("once",&JsValue::TRUE)])?])?;
    if truthy(&bag(signal).aborted()?){let _=reject.call1(&JsValue::UNDEFINED,&abort_error());}
    Ok(())
   })();
   if let Err(failure)=listening{let _=reject.call1(&JsValue::UNDEFINED,&failure);}
  });
  race(&Array::of3(&first,&slow,&cancelled))
 })();
 // `finally { clearTimeout(timer); signal?.removeEventListener('abort', onAbort); image.onload = image.onerror = null; }`
 let cleanup={
  let (image,signal)=(image.clone(),signal.clone());
  move||->R{
   match timer.borrow_mut().take(){Some(timeout)=>timeout.clear()?,None=>clear_timeout(&JsValue::UNDEFINED)?}
   if !absent(&signal){method(&signal,"removeEventListener",&[&text("abort"),&on_abort.borrow()])?;}
   duck(&image).set_onerror(&JsValue::NULL)?;
   duck(&image).set_onload(&JsValue::NULL)
  }
 };
 match raced{
  Ok(race)=>{
   let signal=signal.clone();
   wait(&race,move|outcome|{
    let result=outcome.and_then(|_|if aborted(&signal)?{Err(abort_error())}else{Ok(image)});
    match cleanup(){Ok(())=>done.settle(result),Err(failure)=>done.reject(&failure)}
   });
  }
  Err(failure)=>match cleanup(){Ok(())=>done.reject(&failure),Err(later)=>done.reject(&later)},
 }
 promise
}

/// `raster(drawable, long, { sampleColors })`: the drawable at `long` pixels on its long side, read back.
fn raster(drawable:&JsValue,long:f64,sample_colors:bool)->R<JsValue>{
 let source=bag(drawable);
 let or_else=|value:JsValue,next:fn(&Bag)->R<JsValue>|->R<JsValue>{if truthy(&value){Ok(value)}else{next(source)}};
 let width=or_else(or_else(or_else(source.natural_width()?,Bag::video_width)?,Bag::display_width)?,Bag::width)?;
 let height=or_else(or_else(or_else(source.natural_height()?,Bag::video_height)?,Bag::display_height)?,Bag::height)?;
 let size=relief_fit_dimensions(&width,&height,&number(long))?;
 let (width,height)=(bag(&size).width()?,bag(&size).height()?);
 let canvas=new_canvas()?;
 bag(&canvas).set_width(&width);bag(&canvas).set_height(&height);
 let context=cpu_context(&canvas)?;
 // Analysis samples actual pixels, without manufacturing blend colors along two-color edges.
 // Map/preview resizing retains the existing high quality.
 bag(&context).set_smoothing(!sample_colors)?;bag(&context).set_smoothing_quality(intern("high"))?;
 duck(&context).draw_image(drawable,0.0,0.0,num(&width),num(&height))?;
 let data=duck(&duck(&context).get_image_data(0.0,0.0,num(&width),num(&height))?).data()?;
 // Preserve alpha: transparent cutouts/board padding are excluded from colors.
 let raster=object();
 bag(&raster).set_data(&data);bag(&raster).set_width(&width);bag(&raster).set_height(&height);
 Ok(raster)
}
/// A property write that fails on `null` as the engine's own does.
fn write(target:&JsValue,key:&str,value:&JsValue)->R{
 if absent(target){return Err(js_sys::TypeError::new(&format!("Cannot set properties of {} (setting '{key}')",if target.is_null(){"null"}else{"undefined"})).into())}
 set(target,key,value)
}
/// `toCanvas(rgba, width, height)`.
fn to_canvas(rgba:&JsValue,width:&JsValue,height:&JsValue)->R<JsValue>{
 let canvas=new_canvas()?;
 set(&canvas,"width",width)?;set(&canvas,"height",height)?;
 let context=method(&canvas,"getContext",&[&text("2d")])?;
 // The method is looked up before its argument is made, as the engine does.
 let put=read(&context,"putImageData")?;
 let pixels=image_data(rgba,width,height)?;
 put.dyn_ref::<Function>().ok_or_else(||JsValue::from(js_sys::TypeError::new("putImageData is not a function")))?.call3(&context,&pixels,&number(0.0),&number(0.0))?;
 Ok(canvas)
}
fn image_data(rgba:&JsValue,width:&JsValue,height:&JsValue)->R<JsValue>{Ok(Bag::image_data(rgba,width,height)?.into())}

/// What the three flows share: the host's generator makers and the slice driver.
#[derive(Clone)]
struct Passes{host:JsValue,signal:JsValue,stats:JsValue}
impl Passes{
 fn make(&self,name:&str,args:&[&JsValue])->R<JsValue>{method(&self.host,name,args)}
 /// `runSliced(task, { signal, stats })`.
 fn sliced(&self,task:&JsValue)->R<JsValue>{bag(&self.host).sliced(task,&self.signal,&self.stats)}
 /// `Promise.all([decode(coverUrl, signal), ready()])`.
 fn decoded(&self,cover_url:&JsValue)->R<JsValue>{
  let decoding=decode(cover_url,&self.signal);
  all(&Array::of2(&decoding,&bag(&self.host).shelf_ready()?))
 }
}
fn stats(durations:bool)->R<JsValue>{
 let (stats,zero)=(object(),number(0.0));
 bag(&stats).set_slices(&zero);bag(&stats).set_longest(&zero);bag(&stats).set_ms(0.0);
 if durations{set(&stats,"durations",&Array::new())?;}
 Ok(stats)
}
/// `options = {}`.
fn given(options:JsValue)->JsValue{if options.is_undefined(){object()}else{options}}

/// `thumbnailOf(work, maps, run)`: the shaded preview at 132 px wide at most, as a JPEG data URL.
fn thumbnail(passes:&Passes,work:&JsValue,maps:&JsValue)->JsValue{
 let (flow,promise)=Flow::new();
 let work=work.clone();
 flow.clone().run(||{
  let slope=if truthy(&read(maps,"soft")?){2.2}else{7.0};
  let shading=passes.sliced(&passes.make("preview",&[&work,maps,&number(slope)])?)?;
  flow.clone().then(&shading,move|shaded|{
   let canvas=to_canvas(&shaded,&read(&work,"width")?,&read(&work,"height")?)?;
   let size=relief_thumbnail_size(&read(&work,"width")?,&read(&work,"height")?)?;
   let small=new_canvas()?;
   set(&small,"width",&read(&size,"width")?)?;set(&small,"height",&read(&size,"height")?)?;
   let context=method(&small,"getContext",&[&text("2d")])?;
   write(&context,"imageSmoothingQuality",&text("high"))?;
   method(&context,"drawImage",&[&canvas,&number(0.0),&number(0.0),&read(&small,"width")?,&read(&small,"height")?])?;
   flow.resolve(&method(&small,"toDataURL",&[&text("image/jpeg"),&number(0.82)])?);
   Ok(())
  });
  Ok(())
 });
 promise.into()
}

/// One analysis between its proposals.
struct Proposals{flow:Flow,passes:Passes,found:JsValue,work:JsValue,preview:JsValue,chosen:Array,list:Array}
impl Proposals{
 /// The `for (const choice of found.chosen)` loop from `index` on.
 fn from(self:Rc<Self>,mut index:u32)->R{
  while index<self.chosen.length(){
   let choice=self.chosen.get(index);
   if truthy(&self.preview){
    let building=self.passes.sliced(&self.passes.make("maps",&[&self.work,&self.preview,&choice])?)?;
    let flow=self.flow.clone();
    flow.clone().then(&building,move|maps|{
     let drawn=thumbnail(&self.passes,&self.preview,&maps);
     flow.then(&drawn,move|thumbnail|{
      self.list.push(&relief_proposal(&choice,&thumbnail)?);
      self.from(index+1)
     });
     Ok(())
    });
    return Ok(())
   }
   self.list.push(&relief_proposal(&choice,&text(""))?);
   index+=1;
  }
  let analysis=relief_analysis_report(&self.found,&self.work,&self.passes.stats)?;
  self.flow.resolve(&record(&[("proposals",&self.list),("analysis",&analysis)])?);
  Ok(())
 }
}

/// `analyzeCoverRelief(coverUrl, { title, author, signal, previews })`: up to ten actual colour proposals with
/// their previews. The picture decides: names never add a claim the pixels do not support.
#[wasm_bindgen]
pub fn relief_analyze_cover(host:JsValue,cover_url:JsValue,options:JsValue)->Promise{
 let (flow,promise)=Flow::new();
 flow.clone().run(move||{
  let options=given(options);
  read(&options,"title")?;read(&options,"author")?;
  let signal=read(&options,"signal")?;
  let previews=or(read(&options,"previews")?,JsValue::TRUE);
  let passes=Passes{host,signal,stats:stats(true)?};
  let decoded=passes.decoded(&cover_url)?;
  flow.clone().then(&decoded,move|both|{
   let drawable=get_at(&both,0);
   let work=raster(&drawable,WORK_SIZE,true)?;
   let finding=passes.sliced(&passes.make("analysis",&[&work])?)?;
   flow.clone().then(&finding,move|found|{
    // Ten choices must not multiply full-size map construction. The small thumbnails only illustrate the
    // selected ink; the model independently rebuilds its physical mask at the appropriate rendering resolution.
    let preview=if truthy(&previews){raster(&drawable,96.0,true)?}else{JsValue::NULL};
    let chosen=read(&found,"chosen")?;
    if !Array::is_array(&chosen){return Err(js_sys::TypeError::new("found.chosen is not iterable").into())}
    Rc::new(Proposals{flow,passes,found,work,preview,chosen:chosen.unchecked_into(),list:Array::new()}).from(0)
   });
   Ok(())
  });
  Ok(())
 });
 promise
}

/// `buildReliefMaps(coverUrl, relief, { maxSize, signal, selectionAlpha })`: the height, foil and gloss planes
/// of one relief choice at the cover's aspect, with the tangent-space normals ready for a texture.
#[wasm_bindgen]
pub fn relief_build_maps(host:JsValue,cover_url:JsValue,relief:JsValue,options:JsValue)->Promise{
 let (flow,promise)=Flow::new();
 flow.clone().run(move||{
  let options=given(options);
  let max_size=or(bag(&options).max_size()?,number(MAP_SIZE));
  let signal=bag(&options).signal()?;
  let selection_alpha=or(bag(&options).selection_alpha()?,JsValue::FALSE);
  let choice=bag(&host).normalize(&relief)?;
  if !truthy(&choice){flow.resolve(&JsValue::NULL);return Ok(())}
  let passes=Passes{host,signal,stats:stats(false)?};
  let decoded=passes.decoded(&cover_url)?;
  flow.clone().then(&decoded,move|both|{
   let drawable=get_at(&both,0);
   let hires=raster(&drawable,relief_map_resolution(&max_size)?,false)?;
   let work=if relief_map_mode(&choice)?!=0{hires.clone()}else{raster(&drawable,WORK_SIZE,true)?};
   let building=passes.sliced(&bag(&passes.host).maps(&work,&hires,&choice)?)?;
   flow.clone().then(&building,move|maps|{
    let unit=relief_normal_unit(&bag(&maps).width()?,&bag(&maps).height()?,&number(1.0))?;
    let rendering=passes.sliced(&bag(&passes.host).render(&maps,unit,&selection_alpha,true,&JsValue::NULL)?)?;
    flow.clone().then(&rendering,move|planes|{
     let planes=bag(&planes);
     let normal=planes.normal()?;
     let (width,height)=(bag(&maps).width()?,bag(&maps).height()?);
     let (built,size,report)=(object(),object(),object());
     let (out,stats)=(bag(&built),bag(&passes.stats));
     out.set_height(&image_data(&planes.height()?,&width,&height)?);
     out.set_foil(&image_data(&planes.foil()?,&width,&height)?);
     out.set_gloss(&image_data(&planes.gloss()?,&width,&height)?);
     out.set_normal(&normal);
     if truthy(&selection_alpha){out.set_normal_selection_alpha(true);}
     out.set_pixels(&maps);
     bag(&size).set_width(&width);bag(&size).set_height(&height);
     out.set_size(&size);
     out.set_foil_color(&bag(&maps).foil_color()?);
     bag(&report).set_ms(js_round(num(&stats.ms()?)));bag(&report).set_longest(&stats.longest()?);bag(&report).set_slices(&stats.slices()?);
     out.set_stats(&report);
     flow.resolve(&built);
     Ok(())
    });
    Ok(())
   });
   Ok(())
  });
  Ok(())
 });
 promise
}

/// `updateReliefMapStrengths(built, selection, { signal })`: installed multicolour maps recomposed from the
/// same stored classification. The returned normal/pixels are separate, so a cancelled bake cannot mutate the
/// cover that remains on screen.
#[wasm_bindgen]
pub fn relief_update_strengths(host:JsValue,built:JsValue,selection:JsValue,options:JsValue)->Promise{
 let (flow,promise)=Flow::new();
 flow.clone().run(move||{
  let signal=bag(&given(options)).signal()?;
  let ready=bag(&host).shelf_ready()?;
  let passes=Passes{host,signal,stats:undefined()};
  flow.clone().then(&ready,move|_|{
   let maps=bag(&built).pixels()?;
   let layers=relief_selected_layers(&maps,&selection)?;
   let unit=relief_normal_unit(&bag(&maps).width()?,&bag(&maps).height()?,&number(1.0))?;
   let alpha=JsValue::from_bool(bag(&built).normal_selection_alpha()?.as_bool()==Some(true));
   let rendering=passes.sliced(&bag(&passes.host).render(&maps,unit,&alpha,false,&layers)?)?;
   flow.clone().then(&rendering,move|planes|{
    let (pixels,normal)=(bag(&planes).pixels()?,bag(&planes).normal()?);
    let next=object();
    assign(&next,&built)?;
    bag(&next).set_pixels(&pixels);bag(&next).set_normal(&normal);
    flow.resolve(&next);
    Ok(())
   });
   Ok(())
  });
  Ok(())
 });
 promise
}
