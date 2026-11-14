//! The spine of a book as two rasters (colour, and packed height / roughness / metalness): how its
//! binding is set out, the lettering fitted to it and every canvas operation that paints them, in the
//! order of the original, over the book's own pseudo-random stream (`Stream`, native from the seed to
//! the last rubbed fibre). Canvas contexts, the scratch pool, the replay of a cloth's plan and the finish
//! tables stay host-side and are called through `host`; three's textures are made here from the two
//! canvases with the host's namespace.
//!
//! A shelf paints dozens of spines in its first frame, so each canvas operation is one direct call
//! (typed bindings, no property lookup by name or argument array per call): numbers cross as numbers,
//! and every literal the spine sends again and again (property names, colours, composite modes) is
//! interned, so the page's one string for it crosses without a handle being made and dropped. Text built
//! for one spine is sent as it is. A shelf spine is about 600 calls across the boundary (it was 1,645).
use wasm_bindgen::prelude::*;
use js_sys::{Array,JsString,Number,Object,Reflect};
use crate::host::*;

type R<T>=Result<T,JsValue>;

#[wasm_bindgen]
extern "C"{
 #[wasm_bindgen(js_name=String)]fn string_of(value:&JsValue)->JsString;
 /// A 2D context, or whatever stands in for one: only what a spine paints with. A throwing host call
 /// comes back as the error it threw.
 type Ctx;
 #[wasm_bindgen(method,catch,js_name=fillRect)]fn fill_rect(this:&Ctx,x:f64,y:f64,w:f64,h:f64)->R<()>;
 #[wasm_bindgen(method,catch,js_name=strokeRect)]fn stroke_rect(this:&Ctx,x:f64,y:f64,w:f64,h:f64)->R<()>;
 #[wasm_bindgen(method,catch,js_name=clearRect)]fn clear_rect(this:&Ctx,x:f64,y:f64,w:f64,h:f64)->R<()>;
 #[wasm_bindgen(method,catch)]fn save(this:&Ctx)->R<()>;
 #[wasm_bindgen(method,catch)]fn restore(this:&Ctx)->R<()>;
 #[wasm_bindgen(method,catch)]fn translate(this:&Ctx,x:f64,y:f64)->R<()>;
 #[wasm_bindgen(method,catch)]fn rotate(this:&Ctx,angle:f64)->R<()>;
 #[wasm_bindgen(method,catch,js_name=beginPath)]fn begin_path(this:&Ctx)->R<()>;
 #[wasm_bindgen(method,catch)]fn arc(this:&Ctx,x:f64,y:f64,r:f64,from:f64,to:f64)->R<()>;
 #[wasm_bindgen(method,catch,js_name=arc)]fn arc_counter(this:&Ctx,x:f64,y:f64,r:f64,from:f64,to:f64,counter:&JsValue)->R<()>;
 #[wasm_bindgen(method,catch)]fn fill(this:&Ctx)->R<()>;
 #[wasm_bindgen(method,catch,js_name=measureText)]fn measure_text(this:&Ctx,text:&JsValue)->R<JsValue>;
 #[wasm_bindgen(method,catch,js_name=fillText)]fn fill_text(this:&Ctx,text:&JsValue,x:f64,y:f64)->R<()>;
 #[wasm_bindgen(method,catch,js_name=drawImage)]fn draw_image(this:&Ctx,image:&JsValue,x:f64,y:f64)->R<()>;
 #[wasm_bindgen(method,catch,js_name=createLinearGradient)]fn create_linear_gradient(this:&Ctx,x0:f64,y0:f64,x1:f64,y1:f64)->R<JsValue>;
 #[wasm_bindgen(method,catch,js_name=getImageData)]fn get_image_data(this:&Ctx,x:f64,y:f64,w:f64,h:f64)->R<JsValue>;
 #[wasm_bindgen(method,catch,js_name=putImageData)]fn put_image_data(this:&Ctx,image:&JsValue,x:f64,y:f64)->R<()>;
 #[wasm_bindgen(method,catch,setter,js_name=fillStyle)]fn set_fill_style(this:&Ctx,value:&JsValue)->R<()>;
 #[wasm_bindgen(method,catch,setter,js_name=globalCompositeOperation)]fn set_composite(this:&Ctx,value:&JsValue)->R<()>;
 // The same members with their values typed: a number crosses as a number and a text as a text (one the
 // module interned is the page's own string), where a handle costs a call to make and another to drop.
 #[wasm_bindgen(method,catch,js_name=drawImage)]fn draw_image_scaled(this:&Ctx,image:&JsValue,x:f64,y:f64,w:f64,h:f64)->R<()>;
 #[wasm_bindgen(method,catch,js_name=setTransform)]fn set_transform(this:&Ctx,a:f64,b:f64,c:f64,d:f64,e:f64,f:f64)->R<()>;
 #[wasm_bindgen(method,catch,js_name=scale)]fn scale(this:&Ctx,x:f64,y:f64)->R<()>;
 #[wasm_bindgen(method,catch,setter,js_name=fillStyle)]fn set_fill_text(this:&Ctx,value:&str)->R<()>;
 #[wasm_bindgen(method,catch,setter,js_name=strokeStyle)]fn set_stroke_text(this:&Ctx,value:&str)->R<()>;
 #[wasm_bindgen(method,catch,setter,js_name=lineWidth)]fn set_line(this:&Ctx,value:f64)->R<()>;
 #[wasm_bindgen(method,catch,setter,js_name=textAlign)]fn set_align_text(this:&Ctx,value:&str)->R<()>;
 #[wasm_bindgen(method,catch,setter,js_name=textBaseline)]fn set_baseline_text(this:&Ctx,value:&str)->R<()>;
 #[wasm_bindgen(method,catch,setter,js_name=font)]fn set_font_text(this:&Ctx,value:&str)->R<()>;
 #[wasm_bindgen(method,catch,setter,js_name=globalCompositeOperation)]fn set_composite_text(this:&Ctx,value:&str)->R<()>;
 #[wasm_bindgen(method,catch,setter,js_name=filter)]fn set_filter_text(this:&Ctx,value:&str)->R<()>;
 #[wasm_bindgen(method,catch,setter,js_name=imageSmoothingEnabled)]fn set_smoothing_on(this:&Ctx,value:bool)->R<()>;
 #[wasm_bindgen(method,catch,setter,js_name=imageSmoothingQuality)]fn set_quality_text(this:&Ctx,value:&str)->R<()>;
 /// A gradient with its stops, and the measure of a text.
 type Gradient;
 #[wasm_bindgen(method,catch,js_name=addColorStop)]fn add_color_stop(this:&Gradient,at:f64,color:&str)->R<()>;
 type Metrics;
 #[wasm_bindgen(method,catch,getter)]fn width(this:&Metrics)->R<f64>;
 /// The spine's host (spine-surface.js): its pool of scratch rasters.
 type SpineHost;
 #[wasm_bindgen(method,catch)]fn scratch(this:&SpineHost,kind:&str,width:f64,height:f64,attributes:&JsValue)->R<JsValue>;
 /// A canvas, or whatever stands in for one.
 type Raster;
 #[wasm_bindgen(method,catch,js_name=getContext)]fn get_context(this:&Raster,kind:&str)->R<JsValue>;
 #[wasm_bindgen(method,catch,setter,js_name=width)]fn set_width(this:&Raster,value:f64)->R<()>;
 #[wasm_bindgen(method,catch,setter,js_name=height)]fn set_height(this:&Raster,value:f64)->R<()>;
 /// `document.createElement(tag)`, with `document` looked up when it is called, as the bare name was.
 #[wasm_bindgen(catch,js_namespace=document,js_name=createElement)]fn create_element(tag:&str)->R<JsValue>;
}

const BAND_HALF:f64=7.5;const SURFACE:f64=200.0;const RIDGE:f64=255.0;const BLIND:f64=150.0;
const PI:f64=std::f64::consts::PI;
const GOLD:[(f64,&str);7]=[(0.0,"#9c772c"),(0.16,"#cfab58"),(0.32,"#f0d994"),(0.45,"#c29944"),(0.6,"#e4c880"),(0.8,"#ad8437"),(1.0,"#8f6c29")];
const SILVER:[(f64,&str);7]=[(0.0,"#858d96"),(0.16,"#c1c7cd"),(0.32,"#edf0f3"),(0.45,"#a4abb3"),(0.6,"#d8dce1"),(0.8,"#959ca5"),(1.0,"#7e858e")];

#[inline(never)]
fn cat(parts:&[&str])->String{parts.concat()}
#[inline(never)]
fn rgb(r:&str,g:&str,b:&str)->String{cat(&["rgb(",r,",",g,",",b,")"])}
fn val(x:f64)->JsValue{JsValue::from_f64(x)}
/// A literal sent on every spine: interned.
fn lit(x:&'static str)->JsValue{JsValue::from_str(wasm_bindgen::intern(x))}
/// The same for a typed text member: the page's one string for it is what crosses, with no handle of its own.
fn s(x:&'static str)->&'static str{wasm_bindgen::intern(x)}
/// `value[key]` of what is known to be an object (the host, what it returns): one crossing.
fn member(value:&JsValue,key:&'static str)->R<JsValue>{crate::book_model_build::with_key(key,|name|Reflect::get(value,name))}
fn ctx(value:&JsValue)->&Ctx{value.unchecked_ref()}
/// `value[key]` and `target?.name?.(...args)` with an interned key.
/// An object is read directly with a remembered key (one crossing); anything else as the host reads it.
fn rd(value:&JsValue,key:&'static str)->R<JsValue>{
 match member(value,key){
  // What an object's own getter threw is the answer; anything that is not an object is read as the host reads it.
  Err(error)=>if value.is_object(){Err(error)}else{read(value,wasm_bindgen::intern(key))},
  found=>found,
 }
}
fn optional(target:&JsValue,name:&'static str,args:&[&JsValue])->R<Option<JsValue>>{method_opt(target,wasm_bindgen::intern(name),args)}
/// `host[name](...args)` for arguments that read nothing (the host's member is read first).
fn host_call(host:&JsValue,name:&'static str,args:&[&JsValue])->R<JsValue>{call(&rd(host,name)?,name,args)}
/// `Math.round`: halves go up.
fn jround(x:f64)->f64{if !x.is_finite(){return x;}let f=x.floor();if x-f>=0.5{f+1.0}else{f}}
/// A number the way a template literal prints it. A spine prints dozens (font sizes, channel bytes, the alpha
/// of every rubbed fibre): whole numbers and plain decimals are printed here, where the shortest digits that
/// read back as the same double are the engine's too. What the engine writes with an exponent (below 1e-6,
/// from 1e21) or as a word (NaN, Infinity) is asked of it, and so is the one case where two shortest texts are
/// equally near: a double is a whole number of 2^-k, so its exact decimal text has k decimals and ends in 5;
/// printed with k-1 decimals it lies exactly between two candidates, and each printer breaks that tie its way.
#[inline(never)]
fn show(x:f64)->String{
 let size=x.abs();
 if size<9007199254740992.0&&x==x.trunc(){return (x as i64).to_string();}
 if (1e-6..1e21).contains(&size){
  let text=x.to_string();
  let bits=x.to_bits();let exponent=((bits>>52)&0x7ff) as i32;
  let mantissa=(bits&((1u64<<52)-1))|if exponent==0{0}else{1u64<<52};
  // x = mantissa * 2^(e - 1075): its binary places, and the decimals this text has.
  let places=1075-exponent.max(1)-mantissa.trailing_zeros() as i32;
  let decimals=text.find('.').map_or(0,|dot|text.len()-dot-1) as i32;
  if places!=decimals+1{return text;}
 }
 Number::from(x).to_string(10).ok().and_then(|text|text.as_string()).unwrap_or_default()
}
/// `String(value)` of a number as this module prints it.
#[wasm_bindgen]
pub fn spine_number_text(value:f64)->String{show(value)}
#[inline(never)]
fn object(entries:&[(&'static str,JsValue)])->R<JsValue>{
 let o=Object::new();
 for (key,value) in entries{crate::book_model_build::with_key(key,|name|Reflect::set(&o,name,value))?;}
 Ok(o.into())
}
#[inline(never)]
fn pair(a:f64,b:f64)->JsValue{let list=Array::new();list.push(&val(a));list.push(&val(b));list.into()}
#[inline(never)]
fn list(items:&[f64])->JsValue{let out=Array::new();for item in items{out.push(&val(*item));}out.into()}
fn undefined_or(value:&JsValue,fallback:f64)->f64{if value.is_undefined(){fallback}else{num(value)}}
/// `Object.assign(document.createElement('canvas'), { width, height })`.
#[inline(never)]
fn canvas(width:f64,height:f64)->R<JsValue>{
 let node=create_element(s("canvas"))?;
 let raster:&Raster=node.unchecked_ref();raster.set_width(width)?;raster.set_height(height)?;Ok(node)
}
/// `canvas.getContext('2d')`.
fn context_2d(canvas:&JsValue)->R<JsValue>{canvas.unchecked_ref::<Raster>().get_context(s("2d"))}
/// Attach colour stops; tolerant of partial canvas implementations.
#[inline(never)]
fn with_stops(gradient:JsValue,stops:&[(f64,&'static str)])->R<JsValue>{
 if takes_stops(&gradient)?{for (at,value) in stops{gradient.unchecked_ref::<Gradient>().add_color_stop(*at,s(value))?;}}
 Ok(gradient)
}
/// `gradient?.addColorStop?.(…)`: whether there is a gradient that takes stops, asked once for all of them.
fn takes_stops(gradient:&JsValue)->R<bool>{has(gradient,"addColorStop")}
/// Whether `target?.name?.(…)` would call anything: an object with a function there is the ordinary case.
fn has(target:&JsValue,name:&'static str)->R<bool>{
 let found=if target.is_object(){member(target,name)?}else if absent(target){return Ok(false);}else{rd(target,name)?};
 Ok(found.is_function()||!absent(&found))
}
/// The same, for colours built for this spine.
#[inline(never)]
fn with_built_stops<S:AsRef<str>>(gradient:JsValue,stops:&[(f64,S)])->R<JsValue>{
 if takes_stops(&gradient)?{for (at,value) in stops{gradient.unchecked_ref::<Gradient>().add_color_stop(*at,value.as_ref())?;}}
 Ok(gradient)
}
#[inline(never)]
fn linear(c:&JsValue,x0:f64,y0:f64,x1:f64,y1:f64)->R<JsValue>{ctx(c).create_linear_gradient(x0,y0,x1,y1)}
/// `context.setTransform?.(a, b, c, d, e, f)`.
fn transform(context:&JsValue,a:f64,d:f64)->R<()>{
 if !has(context,"setTransform")?{return Ok(());}
 ctx(context).set_transform(a,0.0,0.0,d,0.0,0.0)
}
/// FNV-1a over the string's UTF-16 units: one crossing for the whole text (book_reflection.rs, utf16_fnv).
#[inline(never)]
fn text_seed(text:&JsString)->u32{crate::book_reflection::utf16_fnv(text,2166136261u32)}
/// The same hash continued over literal text, and over `${value ?? ''}` (each value crosses once).
fn seed_text(mut state:u32,text:&str)->u32{for unit in text.encode_utf16(){state=(state^u32::from(unit)).wrapping_mul(16777619);}state}
fn seed_value(state:u32,value:&JsValue)->u32{crate::book_reflection::utf16_fnv(value,state)}
/// The small deterministic stream of the original's `seededRandom`: a book's cloth, wear and burnish draw
/// from one of these, natively, from the first value to the last.
pub(crate) struct Stream(pub(crate) u32);
impl Stream{
 pub(crate) fn new(seed:u32)->Stream{Stream(if seed==0{1}else{seed})}
 pub(crate) fn next(&mut self)->f64{
  self.0=self.0.wrapping_add(0x6D2B79F5);
  let s=self.0;
  let mut t=((s^(s>>15)) as i32).wrapping_mul((1|s) as i32);
  t=t.wrapping_add(((t as u32^((t as u32)>>7)) as i32).wrapping_mul((61|t as u32) as i32))^t;
  f64::from((t as u32)^((t as u32)>>14))/4294967296.0
 }
}

struct Layout{kind:&'static str,bands:Vec<f64>,rules:Vec<(f64,f64)>,span:(f64,f64),foot_author:bool,panel:Option<(f64,f64)>,device:Option<f64>,device_at:f64}

/// Every publisher sets its spines a little differently: raised bands between heavy and fine rules,
/// fine double rules, a blind-stamped panel, or a plain spine with a device at the tail. The case
/// follows the book (id and title), never its colour, so recolouring keeps the same binding.
fn layout_of(book:&JsValue)->R<Layout>{
 let id=if absent(book){JsValue::UNDEFINED}else{let visual=rd(book,"shelfVisualId")?;if absent(&visual){rd(book,"id")?}else{visual}};
 let title=if absent(book){JsValue::UNDEFINED}else{rd(book,"title")?};
 // `layout|${id ?? ''}|${title ?? ''}`
 let seed=seed_value(seed_text(seed_value(seed_text(2166136261,"layout|"),&id),"|"),&title);
 let mut pick=Stream::new(seed);
 let kind=["banded","ruled","panel","plain"][(pick.next()*4.0).floor() as usize];
 let s=(pick.next()*4.0).floor()*6.0;
 Ok(match kind{
  "banded"=>Layout{kind,bands:vec![64.0+s,960.0-s],rules:vec![(48.0+s,2.3),(79.5+s,1.1),(944.5-s,1.1),(976.0-s,2.3)],span:(102.0+s,922.0-s),foot_author:false,panel:None,device:None,device_at:0.0},
  "ruled"=>Layout{kind,bands:vec![],rules:vec![(40.0+s,1.3),(47.0+s,1.3),(977.0-s,1.3),(984.0-s,1.3)],span:(78.0+s,946.0-s),foot_author:true,panel:None,device:None,device_at:0.0},
  "panel"=>Layout{kind,bands:vec![],rules:vec![(38.0,2.6),(986.0,2.6)],span:(124.0+s/2.0,900.0-s/2.0),foot_author:false,panel:Some((92.0+s/2.0,932.0-s/2.0)),device:None,device_at:0.0},
  _=>Layout{kind,bands:vec![],rules:vec![(52.0+s/2.0,1.1),(972.0-s/2.0,1.1)],span:(86.0+s/2.0,852.0-s/2.0),foot_author:false,panel:None,device:Some((pick.next()*3.0).floor()),device_at:904.0-s/2.0},
 })
}

/// `spineLayout(book).device`: the mark at the tail of a plain spine, without building the layout's object.
pub(crate) fn spine_device(book:&JsValue)->R<Option<f64>>{Ok(layout_of(book)?.device)}
/// The layout as the plain object the callers read, keys in the original order.
#[wasm_bindgen]
pub fn spine_layout(book:&JsValue)->R<JsValue>{
 let layout=layout_of(book)?;
 let rules=Array::new();for (y,weight) in &layout.rules{rules.push(&pair(*y,*weight));}
 let mut entries:Vec<(&'static str,JsValue)>=vec![("kind",lit(layout.kind)),("bands",list(&layout.bands))];
 if layout.foot_author{entries.push(("footAuthor",JsValue::TRUE));}
 if let Some((a,b))=layout.panel{entries.push(("panel",pair(a,b)));}
 if let Some(device)=layout.device{entries.push(("device",val(device)));entries.push(("deviceAt",val(layout.device_at)));}
 entries.push(("rules",rules.into()));entries.push(("span",pair(layout.span.0,layout.span.1)));
 object(&entries)
}

/// A small printer's device, centred on (0, 0) in design units.
#[wasm_bindgen]
pub fn draw_device(c:&JsValue,kind:&JsValue,size:&JsValue)->R<()>{
 let size=num(size);let c=ctx(c);
 if kind.as_f64()==Some(0.0){
  // Lozenge between two short rules.
  c.save()?;c.rotate(PI/4.0)?;c.fill_rect(-size*0.32,-size*0.32,size*0.64,size*0.64)?;c.restore()?;
  c.fill_rect(-size*1.35,-size*0.06,size*0.75,size*0.12)?;c.fill_rect(size*0.6,-size*0.06,size*0.75,size*0.12)?;
 }else if kind.as_f64()==Some(1.0){
  // Ring with a dot: a colophon.
  c.begin_path()?;c.arc(0.0,0.0,size*0.62,0.0,PI*2.0)?;
  c.arc_counter(0.0,0.0,size*0.47,0.0,PI*2.0,&JsValue::TRUE)?;c.fill()?;
  c.begin_path()?;c.arc(0.0,0.0,size*0.16,0.0,PI*2.0)?;c.fill()?;
 }else{
  // Three dots, as a printer's mark.
  for (x,y) in [(0.0,-size*0.34),(-size*0.36,size*0.26),(size*0.36,size*0.26)]{
   c.begin_path()?;c.arc(x,y,size*0.15,0.0,PI*2.0)?;c.fill()?;
  }
 }
 Ok(())
}

/// Low-frequency variation from a tiny random raster, upscaled in one pass. soft-light around mid-grey
/// mottles colour; 'lighter' with a single channel adds to one PBR channel.
/// The field over a raw stream state and the original's options object: `[state after, painted, error]`.
/// A spine paints its own field natively (`field`); this is the same painter for a caller with options.
#[wasm_bindgen]
pub fn paint_field_seeded(c:&JsValue,width:&JsValue,height:&JsValue,seed:u32,options:&JsValue)->Array{
 let mut stream=Stream(seed);
 let result=paint_field_with(c,width,height,options,&mut stream);
 let output=Array::new();output.push(&val(stream.0 as f64));output.push(&JsValue::from_bool(result.is_ok()));
 output.push(&result.err().unwrap_or(JsValue::UNDEFINED));output
}
fn paint_field_with(c:&JsValue,width:&JsValue,height:&JsValue,options:&JsValue,stream:&mut Stream)->R<()>{
 let (width,height)=(num(width),num(height));
 let pick=|key:&'static str|->R<JsValue>{if options.is_undefined(){Ok(JsValue::UNDEFINED)}else{rd(options,key)}};
 let operation=pick("operation")?;let operation=if operation.is_undefined(){lit("soft-light")}else{operation};
 let spread=pick("spread")?;let spread=undefined_or(&spread,40.0);
 let channel=pick("channel")?;let channel=if channel.is_undefined(){JsValue::NULL}else{channel};
 let cells=pick("cells")?;let (cw,ch)=if cells.is_undefined(){(9.0,30.0)}else{(num(&get_at(&cells,0)),num(&get_at(&cells,1)))};
 field(c,width,height,&operation,spread,truthy(&channel),cw,ch,stream)
}
/// `cw` x `ch` cells of the stream, upscaled over `width` x `height` with `operation`; `channel_on` writes
/// the value to green alone.
#[allow(clippy::too_many_arguments)]
fn field(c:&JsValue,width:f64,height:f64,operation:&JsValue,spread:f64,channel_on:bool,cw:f64,ch:f64,stream:&mut Stream)->R<()>{
 let field=canvas(cw,ch)?;
 // One pixel write for the whole field; per-cell fillRect parsed hundreds of colour strings for every book.
 let f=context_2d(&field)?;
 let image=optional(&f,"createImageData",&[&val(cw),&val(ch)])?.unwrap_or(JsValue::UNDEFINED);
 let data=if absent(&image){JsValue::UNDEFINED}else{rd(&image,"data")?};
 // Real ImageData uses one bulk copy instead of four JS property writes per pixel.
 let typed=data.dyn_ref::<js_sys::Uint8ClampedArray>();
 let mut pixels=typed.map(|array|array.to_vec());
 // The pixel buffer stays what it is for the whole field: tested once, not per pixel.
 let has_data=truthy(&data);
 let mut i=0.0;
 while i<cw*ch{
  let r=stream.next();
  let v=if channel_on{jround(r*spread)}else{
   let r=r-0.5;jround(128.0+r*2.0*spread)};
  if has_data{
   let z=if channel_on{0.0}else{v};
   if let Some(bytes)=pixels.as_mut(){
    let at=i as usize*4;
    if at+3<bytes.len(){bytes[at..at+4].copy_from_slice(&[z as u8,v as u8,z as u8,255]);}
   }else{
    let put=|index:f64,value:f64|->R<()>{Reflect::set(&data,&val(index),&val(value))?;Ok(())};
    put(i*4.0+2.0,z)?;put(i*4.0,z)?;put(i*4.0+1.0,v)?;put(i*4.0+3.0,255.0)?;
   }
  }
  i+=1.0;
 }
 if let (Some(array),Some(bytes))=(typed,pixels){array.copy_from(&bytes);}
 if truthy(&data){ctx(&f).put_image_data(&image,0.0,0.0)?;}
 let c=ctx(c);
 c.save()?;c.set_composite(operation)?;c.set_smoothing_on(true)?;
 c.set_quality_text(s("high"))?;c.draw_image_scaled(&field,0.0,0.0,width,height)?;c.restore()?;
 Ok(())
}

fn foil_gradient(context:&JsValue,width:f64,finish:&str)->R<JsValue>{
 with_stops(linear(context,0.0,0.0,width,0.0)?,if finish=="silver"{&SILVER}else{&GOLD})
}

/// Baked shading only for features fixed to the book: band ridges, a blind panel, the joint creases
/// beside both boards and the rubbed head and tail.
fn paint_relief(c:&JsValue,design_width:f64,stream:&mut Stream,layout:&Layout,wear:bool)->R<()>{
 let context=ctx(c);
 for y in &layout.bands{
  let y=*y;
  context.set_fill_style(&with_stops(linear(c,0.0,y-BAND_HALF-2.0,0.0,y+BAND_HALF+3.0)?,&[(0.0,"rgba(0,0,0,0)"),(0.1,"rgba(255,250,240,.2)"),(0.42,"rgba(255,250,240,.08)"),
   (0.62,"rgba(0,0,0,.1)"),(0.9,"rgba(0,0,0,.3)"),(1.0,"rgba(0,0,0,0)")])?)?;
  context.fill_rect(0.0,y-BAND_HALF-2.0,design_width,BAND_HALF*2.0+5.0)?;
 }
 if let Some((top,bottom))=layout.panel{
  // Blind tooling: the pressed line's far wall is lit, its floor in shade.
  let x=design_width*0.17;let w=design_width*0.66;
  context.set_line(2.2)?;context.set_stroke_text(s("rgba(0,0,0,.24)"))?;context.stroke_rect(x,top,w,bottom-top)?;
  context.set_line(1.0)?;context.set_stroke_text(s("rgba(255,250,240,.12)"))?;context.stroke_rect(x+1.6,top+1.6,w,bottom-top)?;
 }
 let joint=design_width*0.085;
 for (from,to) in [(0.0,joint),(design_width,design_width-joint)]{
  context.set_fill_style(&with_stops(linear(c,from,0.0,to,0.0)?,&[(0.0,"rgba(0,0,0,.26)"),(0.4,"rgba(0,0,0,.08)"),(1.0,"rgba(0,0,0,0)")])?)?;
  context.fill_rect(jmin(from,to),0.0,joint,1024.0)?;
 }
 for (from,to) in [(0.0,16.0),(1024.0,1008.0)]{
  context.set_fill_style(&with_stops(linear(c,0.0,from,0.0,to)?,&[(0.0,"rgba(0,0,0,.34)"),(0.35,"rgba(0,0,0,.12)"),(1.0,"rgba(0,0,0,0)")])?)?;
  context.fill_rect(0.0,jmin(from,to),design_width,16.0)?;
  // Rubbed cloth at the very edge shows paler fibres in short patches.
  if wear{
   let mut x=0.0;
   while x<design_width{
    let length=4.0+stream.next()*22.0;
    context.set_fill_text(&cat(&["rgba(255,246,228,",&show(stream.next()*0.16),")"]))?;
    context.fill_rect(x,if from!=0.0{1021.2}else{0.0},length,2.8)?;x+=length;
   }
  }
 }
 Ok(())
}

#[inline(never)]
fn flag(options:&JsValue,key:&'static str,fallback:&JsValue)->R<JsValue>{
 let value=if options.is_undefined(){JsValue::UNDEFINED}else{rd(options,key)?};
 Ok(if value.is_undefined(){fallback.clone()}else{value})
}

/// Colour and packed rasters of one spine, plus the numbers its material needs. `host` supplies the
/// scratch pool (`scratch`), `author`, `spineFinish`, `surface` (the finish row of a surface name),
/// `cloth` (the replay of a cloth plan on a canvas) and the weave's tiles. The book's stream is native.
/// The answer is the spine's textures and material description (`material`): one call per spine.
#[wasm_bindgen]
pub fn spine_surface(book:&JsValue,style:&JsValue,physical_height:&JsValue,thickness:&JsValue,options:&JsValue,host:&JsValue)->R<JsValue>{
 material(host,&rasters(book,style,physical_height,thickness,options,host)?,style)
}
/// What a painted spine hands its material: the two canvases, the engraving's samples and the numbers.
struct Painted{color:JsValue,packed:JsValue,relief:JsValue,bump:f64,sheen:f64,env_map_intensity:f64,anisotropy:f64,clearcoat:JsValue,clearcoat_roughness:JsValue}
fn rasters(book:&JsValue,style:&JsValue,physical_height:&JsValue,thickness:&JsValue,options:&JsValue,host:&JsValue)->R<Painted>{
 let physical_height=undefined_or(physical_height,200.0);let thickness=undefined_or(thickness,32.0);
 let tw=flag(options,"textureWidth",&val(512.0))?;let th=flag(options,"textureHeight",&val(2048.0))?;
 let engraving=flag(options,"engraving",&JsValue::TRUE)?;let level=flag(options,"level",&lit("detail"))?;
 let pick=|v:f64,fallback:f64|->f64{if v==0.0||v.is_nan(){fallback}else{v}};
 let width=jmax(1.0,jround(pick(num(&tw),512.0)));let height=jmax(1.0,jround(pick(num(&th),2048.0)));
 let design_width=jmax(80.0,thickness/physical_height*1024.0*PI/2.0);
 let to_design=|context:&JsValue|->R<()>{transform(context,width/design_width,height/1024.0)};
 let engraved=truthy(&engraving)&&rd(book,"spineEngraved")?.as_bool()==Some(true);
 // Relief is sampled on the CPU: keep that raster off the GPU so reading it back does not stall on a
 // full GPU flush (seconds on software renderers).
 let attributes=if engraved{object(&[("willReadFrequently",JsValue::TRUE)])?}else{JsValue::UNDEFINED};
 let pool:&SpineHost=host.unchecked_ref();
 let scratch=pool.scratch(s(if engraved{"relief-mask"}else{"mask"}),width,height,&attributes)?;
 let (mask,c)=(member(&scratch,"canvas")?,member(&scratch,"context")?);
 let mc=ctx(&c);
 to_design(&c)?;mc.set_fill_text(s("#fff"))?;mc.set_align_text(s("center"))?;mc.set_baseline_text(s("middle"))?;
 let layout=layout_of(book)?;let (top,bottom)=layout.span;
 let family_name=rd(style,"fontCanvasFamily")?;let family_name=if truthy(&family_name){family_name}else{let v=rd(style,"fontFamily")?;if truthy(&v){v}else{lit("Playfair Display")}};
 let fallback=rd(style,"fontFallback")?;let fallback=if truthy(&fallback){fallback}else{lit("Georgia, serif")};
 let family=cat(&["\"",&txt_of(&family_name),"\", ",&txt_of(&fallback)]);
 let font_size=num(&rd(style,"spineFontSize")?);
 let mut size=jmin(design_width*0.9,64.0*pick(font_size,10.0)/10.0);
 let override_title=rd(book,"spineTitleOverride")?;
 let mut title=if truthy(&override_title){string_of(&override_title)}else{let t=rd(book,"title")?;if truthy(&t){string_of(&t)}else{lit("Sin título").unchecked_into::<JsString>()}};
 let author:Option<JsString>=if num(&rd(style,"width")?)>=32.0{
  let name=call(&rd(host,"author")?,"author",&[&rd(book,"author")?])?;
  if truthy(&name){Some(string_of(&name))}else{None}
 }else{None};
 let author_size=if author.is_some(){jmin(design_width*0.82,28.0*pick(num(&rd(style,"spineAuthorFontSize")?),12.0)/12.0)}else{0.0};
 // The title font as set, so a width already measured for it is not measured again.
 let title_font=std::cell::RefCell::new(String::new());
 // The weight is read when the first font is set, as the original first read it, and kept for the fit.
 let weight_text:std::cell::RefCell<Option<String>>=std::cell::RefCell::new(None);
 let set_font=|size:f64|->R<()>{
  if weight_text.borrow().is_none(){
   let weight=rd(style,"fontWeight")?;let weight=if truthy(&weight){weight}else{val(700.0)};
   *weight_text.borrow_mut()=Some(txt_of(&weight));
  }
  let font=cat(&[weight_text.borrow().as_deref().unwrap_or_default()," ",&show(size),"px ",&family]);
  mc.set_font_text(&font)?;*title_font.borrow_mut()=font;Ok(())
 };
 let set_author_font=||->R<()>{mc.set_font_text(&cat(&["500 ",&show(author_size),"px \"DM Sans\", sans-serif"]))};
 let width_of=|text:&JsString|->R<f64>{mc.measure_text(text.as_ref())?.unchecked_ref::<Metrics>().width()};
 // measureText changes nothing on the canvas and the same text in the same font has the same width: the
 // untruncated title's width in each font is measured once (the original measured the last size of every
 // fit twice, and a failed author-at-the-foot fit measured the same sizes again). `fit` only ever measures
 // that title, before it is shortened; fonts are still set exactly as before.
 let title_widths:std::cell::RefCell<Vec<(String,f64)>>=std::cell::RefCell::new(Vec::new());
 let title_width=|title:&JsString|->R<f64>{
  let font=title_font.borrow().clone();
  if let Some((_,width))=title_widths.borrow().iter().find(|(known,_)|*known==font){return Ok(*width);}
  let width=width_of(title)?;title_widths.borrow_mut().push((font,width));Ok(width)
 };
 // Fit by font size, never by non-uniform fillText(maxWidth) compression.
 let fit=|title:&JsString,size:&mut f64,limit:f64|->R<bool>{
  set_font(*size)?;
  while title_width(title)?>limit&&*size>44.0{*size-=1.0;set_font(*size)?;}
  Ok(title_width(title)?<=limit)
 };
 // Ruled cases set a short author at the foot, in line with the title, whenever both fit without
 // shrinking the title below its minimum.
 let mut foot=0.0;
 if let (Some(name),true)=(&author,layout.foot_author){
  let initial=size;set_author_font()?;
  let name_width=width_of(name)?;
  if name_width<=jmin(300.0,(bottom-top)*0.36)&&fit(&title,&mut size,bottom-top-name_width-48.0)?{foot=name_width;}else{size=initial;}
 }
 let length=if foot!=0.0&&!foot.is_nan(){bottom-top-foot-48.0}else{bottom-top};
 if !fit(&title,&mut size,length)?{
  let ellipsis=lit("…");
  while title.length()>1&&width_of(&title.concat(&ellipsis))?>length{title=title.slice(0,title.length()-1);}
  title=title.trim_end().concat(&ellipsis);
 }
 // Text runs head to tail: x along the spine, y across it.
 mc.save()?;mc.translate(design_width/2.0,0.0)?;mc.rotate(PI/2.0)?;
 if foot!=0.0&&!foot.is_nan(){
  mc.fill_text(title.as_ref(),top+length/2.0,0.0)?;
  set_author_font()?;mc.fill_text(author.as_ref().unwrap().as_ref(),bottom-foot/2.0,0.0)?;
 }else{
  // Title and author are parallel on the curved spine. Position them as one compact group, centered
  // across its width, instead of pinning them to opposite edges.
  let center=(top+bottom)/2.0;
  let label_gap=if author.is_some(){jmax(1.5,jmin(3.0,size*0.045))}else{0.0};
  mc.fill_text(title.as_ref(),center,if author.is_some(){-(author_size+label_gap)/2.0}else{0.0})?;
  if let Some(author)=&author{
   set_author_font()?;
   let mut name=author.clone();
   while name.length()>1&&width_of(&name)?>length-60.0{name=name.slice(0,name.length()-1);}
   mc.fill_text(name.as_ref(),center,(size+label_gap)/2.0)?;
  }
 }
 mc.restore()?;
 // Stamped rules stop short of the joints, like a real brass tool.
 for (y,weight) in &layout.rules{mc.fill_rect(design_width*0.13,y-weight/2.0,design_width*0.74,*weight)?;}
 if let Some(device)=layout.device{
  mc.save()?;mc.translate(design_width/2.0,layout.device_at)?;
  draw_device(&c,&val(device),&val(jmin(design_width*0.24,26.0)))?;mc.restore()?;
 }

 let spine_finish=rd(host,"spineFinish")?;
 let binding_finish=txt_of(&call(&spine_finish,"spineFinish",&[&rd(book,"spineFinish")?])?);
 let text_finish=txt_of(&call(&spine_finish,"spineFinish",&[&rd(book,"spineTextFinish")?])?);
 let metal_binding=binding_finish!="matte";let metal_text=text_finish!="matte";
 let visual=rd(book,"shelfVisualId")?;
 let (id,book_title)=(if absent(&visual){rd(book,"id")?}else{visual},rd(book,"title")?);
 // `${id ?? ''}|${title ?? ''}|${style.color}`: the colour as a template prints it, "undefined" and "null" included.
 let color=rd(style,"color")?;
 let cloth_seed=seed_text(seed_value(seed_text(seed_value(2166136261,&id),"|"),&book_title),"|");
 let cloth_seed=if color.is_undefined(){seed_text(cloth_seed,"undefined")}else if color.is_null(){seed_text(cloth_seed,"null")}else{seed_value(cloth_seed,&color)};
 let mut stream=Stream::new(cloth_seed);
 let color=canvas(width,height)?;let color_context=context_2d(&color)?;let cc=ctx(&color_context);
 let fill=if metal_binding{foil_gradient(&color_context,width,&binding_finish)?}else{rd(style,"color")?};
 cc.set_fill_style(&fill)?;
 cc.fill_rect(0.0,0.0,width,height)?;
 to_design(&color_context)?;
 let level=level.as_string();let detailed=level.as_deref()==Some("detail");
 let thumb=level.as_deref()==Some("overview");let woven=detailed&&!metal_binding;
 // A thumbnail shows neither dye nor threads: it keeps its flat colour.
 if !thumb{paint_cloth(&rd(host,"cloth")?,&color_context,design_width,&mut stream,metal_binding)?;}
 // Close up the spine is the same woven cloth as the cover beside it.
 if woven{weave(host,&color_context,design_width,false)?;}
 paint_relief(&color_context,design_width,&mut stream,&layout,!thumb)?;
 transform(&color_context,1.0,1.0)?;
 let scratch=pool.scratch(s("ink"),width,height,&JsValue::UNDEFINED)?;
 let (ink,ink_context)=(member(&scratch,"canvas")?,member(&scratch,"context")?);let ic=ctx(&ink_context);
 // Tint the glyph mask (optionally only the strip a shifted copy leaves uncovered, i.e. one wall of
 // each stroke) and lay it on the cloth.
 let stamp=|fill:&JsValue,offset:f64|->R<()>{
  ic.set_composite_text(s("source-over"))?;ic.clear_rect(0.0,0.0,width,height)?;ic.draw_image(&mask,0.0,0.0)?;
  if offset!=0.0&&!offset.is_nan(){ic.set_composite_text(s("destination-out"))?;ic.draw_image(&mask,0.0,offset)?;}
  ic.set_composite_text(s("source-in"))?;ic.set_fill_style(fill)?;ic.fill_rect(0.0,0.0,width,height)?;
  cc.draw_image(&ink,0.0,0.0)?;Ok(())
 };
 let first=if metal_text{foil_gradient(&ink_context,width,&text_finish)?}else{rd(style,"ink")?};
 stamp(&first,0.0)?;
 if engraved{
  // Debossed walls: the upper wall of each stroke falls into shadow, the lower one catches the shelf
  // light. Visible even at shelf mip levels.
  let step=jmax(1.0,height/1024.0*1.8);
  stamp(&lit("rgba(0,0,0,.5)"),step)?;stamp(&lit("rgba(255,250,236,.24)"),-step)?;
 }

 // R = surface height, G = roughness, B = metalness. Linear, never sRGB.
 let packed=canvas(width,height)?;let packed_context=context_2d(&packed)?;let pc=ctx(&packed_context);
 let surface=call(&rd(host,"surface")?,"surface",&[&rd(book,"spineSurfaceFinish")?])?;
 let binding_roughness=jround(num(&rd(&surface,"roughness")?)*255.0);let metal=if metal_binding{255.0}else{0.0};
 pc.set_fill_text(&rgb(&show(SURFACE),&show(jmax(0.0,binding_roughness-12.0)),&show(metal)))?;pc.fill_rect(0.0,0.0,width,height)?;
 to_design(&packed_context)?;
 // Dye and handling leave the cloth unevenly burnished: roughness mottling. Foil is near-mirror: any
 // mottle there reads as hammered metal.
 if !metal_binding&&!thumb{
  field(&packed_context,design_width,1024.0,&lit("lighter"),24.0,true,7.0,24.0,&mut stream)?;
 }
 let ridge=|h:f64|->String{rgb(&show(h),&show(binding_roughness),&show(metal))};
 for y in &layout.bands{
  let y=*y;
  pc.set_fill_style(&with_built_stops(linear(&packed_context,0.0,y-BAND_HALF,0.0,y+BAND_HALF)?,&[(0.0,&ridge(SURFACE)),(0.4,&ridge(RIDGE)),(0.6,&ridge(RIDGE)),(1.0,&ridge(SURFACE))])?)?;
  pc.fill_rect(0.0,y-BAND_HALF,design_width,BAND_HALF*2.0)?;
 }
 if let Some((top,bottom))=layout.panel{
  pc.set_line(2.2)?;pc.set_stroke_text(&ridge(BLIND))?;
  pc.stroke_rect(design_width*0.17,top,design_width*0.66,bottom-top)?;
 }
 transform(&packed_context,1.0,1.0)?;
 ic.set_composite_text(s("source-over"))?;ic.clear_rect(0.0,0.0,width,height)?;
 ic.draw_image(&mask,0.0,0.0)?;ic.set_composite_text(s("source-in"))?;
 // Foil is always pressed slightly into the cloth; "grabado" goes deep.
 let letter_height=if engraved{110.0}else if metal_text{184.0}else{SURFACE};
 ic.set_fill_text(&rgb(&show(letter_height),if metal_text{"66"}else{"230"},if metal_text{"255"}else{"0"}))?;
 ic.fill_rect(0.0,0.0,width,height)?;pc.draw_image(&ink,0.0,0.0)?;
 // The threads show mostly as relief and burnish, not as a printed grid.
 if woven{
  to_design(&packed_context)?;
  weave(host,&packed_context,design_width,true)?;
 }
 // three's bump is screen-space: a close-up band spans many pixels and needs a large scale; shelf copies
 // keep the tiny legacy value for engraving only.
 let bump=if detailed{2.6}else if engraved{0.035}else{0.0};
 let mut relief=JsValue::NULL;
 if engraved{
  let scratch=pool.scratch(s("relief-sample"),256.0,1024.0,&object(&[("willReadFrequently",JsValue::TRUE)])?)?;
  let sample_context=member(&scratch,"context")?;let sc=ctx(&sample_context);
  sc.set_filter_text(s("blur(1.2px)"))?;sc.draw_image_scaled(&mask,0.0,0.0,256.0,1024.0)?;
  relief=rd(&sc.get_image_data(0.0,0.0,256.0,1024.0)?,"data")?;
 }
 let metallic=metal_binding||metal_text;
 // Cloth scatters a soft rim of light at grazing angles; foil does not. A shelf spine is a few dozen
 // pixels wide: the sheen lobe is invisible there but costs its BRDF and image-based term on every
 // pixel of every repaint.
 let sheen=if metal_binding||!detailed{0.0}else{0.55};
 Ok(Painted{color,packed,relief,bump,sheen,env_map_intensity:num(&rd(&surface,"envMapIntensity")?)*if metallic{1.2}else{0.9},
  anisotropy:if metallic{0.35}else{0.0},clearcoat:rd(&surface,"clearcoat")?,clearcoat_roughness:rd(&surface,"clearcoatRoughness")?})
}
#[inline(never)]
fn txt_of(value:&JsValue)->String{string_of(value).as_string().unwrap_or_default()}

// The host retains only an owned batch cursor for each random callback.
// No closure, handle or allocation remains in WASM between calls.
#[wasm_bindgen]
pub fn spine_random_batch(seed:u32)->Vec<f64>{
 let mut stream=Stream(seed);let mut output=Vec::with_capacity(128);
 for _ in 0..64{let value=stream.next();output.push(stream.0 as f64);output.push(value);}
 output
}
fn to_uint32(value:f64)->u32{
 if !value.is_finite()||value==0.0{return 0;}
 let v=value.trunc()%4294967296.0;
 (if v<0.0{v+4294967296.0}else{v}) as u32
}
#[wasm_bindgen]
pub fn spine_random_seed(value:f64)->u32{let seed=to_uint32(value);if seed==0{1}else{seed}}
#[wasm_bindgen]
pub fn spine_text_seed(text:JsString)->u32{text_seed(&text)}
#[wasm_bindgen]
pub fn spine_lattice(i:f64,j:f64,salt:f64)->f64{
 let mut h=to_uint32(i*374761393.0+j*668265263.0+salt*1442695041.0).wrapping_mul(1274126177);
 h=(h^(h>>13)).wrapping_mul(1103515245);
 (h^(h>>16)) as f64/4294967296.0
}

/// Book cloth: slow dye mottling plus irregular warp and weft slubs, all from the book's stream. The plan
/// (the dye field's bytes and one rectangle per slub) is the numeric core's kernel, compiled into this module
/// (rust-core/src/book_cloth.rs); `replay(c, width, fieldWidth, pixels, commands)` lays it on the canvas
/// host-side, where each slub's colour string is cheapest to set. The two arrays are views of this module's
/// memory, valid for the call. A width the plan does not take keeps the original's draw order here.
pub(crate) fn paint_cloth(replay:&JsValue,c:&JsValue,width:f64,stream:&mut Stream,metal:bool)->R<()>{
 if !width.is_finite()||!(0.0..=8192.0).contains(&width){return cloth_unplanned(c,width,stream,metal);}
 let field_width=jmax(4.0,jround(width/34.0));
 let mut pixels=vec![0u8;field_width as usize*30*4];
 let mut commands=vec![0f64;if metal{40}else{136}*6+1];
 // SAFETY: both buffers have the lengths the kernel documents for this field width and finish.
 if unsafe{crate::book_cloth::book_cloth_plan(stream.0,width,u32::from(metal),field_width as u32,pixels.as_mut_ptr(),commands.as_mut_ptr())}!=1{
  return cloth_unplanned(c,width,stream,metal);
 }
 let count=commands.len()-1;
 stream.0=commands[count] as u32;
 let replay:&js_sys::Function=replay.dyn_ref().ok_or_else(||JsValue::from(js_sys::TypeError::new("host.cloth is not a function")))?;
 // SAFETY: the replay only draws on canvases; nothing allocates in this module while the views are alive.
 let (bytes,numbers)=unsafe{(js_sys::Uint8Array::view(&pixels),js_sys::Float64Array::view(&commands[..count]))};
 replay.apply(&JsValue::UNDEFINED,&Array::of5(c,&val(width),&val(field_width),&bytes,&numbers))?;
 Ok(())
}
/// The cloth drawn straight from the stream, in the original's order.
fn cloth_unplanned(c:&JsValue,width:f64,stream:&mut Stream,metal:bool)->R<()>{
 field(c,width,1024.0,&lit("soft-light"),if metal{5.0}else{9.0},false,js_sys::Math::max(4.0,js_sys::Math::round(width/34.0)),30.0,stream)?;
 let context=ctx(c);
 for _ in 0..if metal{40}else{110}{
  let y=stream.next()*1024.0;let x=stream.next()*width*0.7;let length=width*(0.2+stream.next()*0.6);
  let light=stream.next()>0.45;
  let alpha=if light{0.012+stream.next()*0.03}else{0.015+stream.next()*0.035};
  let color=cat(&[if light{"rgba(255,248,235,"}else{"rgba(0,0,0,"},&show(alpha),")"]);
  context.set_fill_text(&color)?;let height=0.5+stream.next()*0.8;context.fill_rect(x,y,length,height)?;
 }
 if !metal{for _ in 0..26{
  let x=stream.next()*width;let y=stream.next()*900.0;let length=60.0+stream.next()*380.0;
  let light=stream.next()>0.5;let alpha=if light{0.012+stream.next()*0.025}else{0.015+stream.next()*0.03};
  let color=cat(&[if light{"rgba(255,248,235,"}else{"rgba(0,0,0,"},&show(alpha),")"]);
  context.set_fill_text(&color)?;let thickness=0.5+stream.next()*0.7;context.fill_rect(x,y,thickness,length)?;
 }}
 Ok(())
}
/// The cloth over a raw stream state, as a spine and a cloth case paint it: the state after it.
#[wasm_bindgen]
pub fn spine_cloth_seeded(replay:&JsValue,c:&JsValue,width:f64,seed:u32,metal:bool)->R<u32>{
 let mut stream=Stream(seed);paint_cloth(replay,c,width,&mut stream,metal)?;Ok(stream.0)
}

/// Plain weave, 16 × 16 threads per 128 px tile with uneven yarn, at 4.4 design units a thread (1024 = board
/// height), so cover and lifted spine are one cloth: laid over a canvas drawn in design units, in colour or
/// multiplied into the packed height/roughness/metal raster. Both tiles are made on first use from the core's
/// pixels (`host.weavePixels()`) and kept by the host (`host.tiles`).
#[wasm_bindgen]
pub fn spine_paint_weave(host:&JsValue,c:&JsValue,design_width:f64,options:&JsValue)->R<()>{
 weave(host,c,design_width,!options.is_undefined()&&truthy(&rd(options,"channels")?))
}
fn weave(host:&JsValue,c:&JsValue,design_width:f64,channels:bool)->R<()>{
 // `c.createPattern?.(weaveTile(…), 'repeat')`: without the method no tile is made.
 let create=rd(c,"createPattern")?;
 if absent(&create){return Ok(());}
 let tile=weave_tile(host,if channels{"channels"}else{"color"})?;
 let create=create.dyn_into::<js_sys::Function>().map_err(|_|JsValue::from(js_sys::TypeError::new("c.createPattern is not a function")))?;
 let pattern=create.call2(c,&tile,&lit("repeat"))?;
 if !truthy(&pattern){return Ok(());}
 let context=ctx(c);
 context.save()?;
 if channels{context.set_composite_text(s("multiply"))?;}
 let weave=4.4/8.0;
 context.scale(weave,weave)?;
 context.set_fill_style(&pattern)?;context.fill_rect(0.0,0.0,design_width/weave,1024.0/weave)?;context.restore()
}
/// The textures and the material description of a painted spine. Colour and PBR channels share exactly the
/// same glyph raster: text follows the continuous curved binding UVs.
fn material(host:&JsValue,painted:&Painted,style:&JsValue)->R<JsValue>{
 let three=rd(host,"three")?;
 let make=|class:&'static str,args:&[&JsValue]|->R<JsValue>{
  let list=Array::new();for a in args{list.push(a);}
  Reflect::construct(rd(&three,class)?.unchecked_ref(),&list)
 };
 let map=make("CanvasTexture",&[&painted.color])?;Reflect::set(&map,&lit("colorSpace"),&rd(&three,"SRGBColorSpace")?)?;
 let channels=make("CanvasTexture",&[&painted.packed])?;
 let relief=if truthy(&painted.relief){host_call(host,"bindingRelief",&[&painted.relief])?}else{JsValue::NULL};
 let bump_map=if painted.bump!=0.0{channels.clone()}else{JsValue::NULL};
 let (bump_scale,sheen)=(val(painted.bump),val(painted.sheen));
 let sheen_color=method(&make("Color",&[&rd(style,"color")?])?,"lerp",&[&make("Color",&[&lit("#fff4e6")])?,&val(0.45)])?;
 let material=object(&[("map",map.clone()),("roughness",val(1.0)),("metalness",val(1.0)),("roughnessMap",channels.clone()),
  ("metalnessMap",channels.clone()),("bumpMap",bump_map),("bumpScale",bump_scale),("sheen",sheen),("sheenRoughness",val(0.62)),
  ("sheenColor",sheen_color),("envMapIntensity",val(painted.env_map_intensity)),("anisotropy",val(painted.anisotropy)),
  ("clearcoat",painted.clearcoat.clone()),("clearcoatRoughness",painted.clearcoat_roughness.clone())])?;
 object(&[("map",map),("channels",channels),("relief",relief),("material",material)])
}
fn weave_tile(host:&JsValue,kind:&'static str)->R<JsValue>{
 let known=rd(host,"tiles")?;
 if !absent(&known){return rd(&known,kind);}
 let pixels=host_call(host,"weavePixels",&[])?;
 if absent(&pixels){return Err(js_sys::Error::new("No se pudo generar el tejido del libro en Rust.").into());}
 let tiles=object(&[])?;
 for name in["color","channels"]{
  let tile=canvas(128.0,128.0)?;
  let t=context_2d(&tile)?;
  let image=optional(&t,"createImageData",&[&val(128.0),&val(128.0)])?.unwrap_or(JsValue::UNDEFINED);
  let data=get(&image,"data");
  if truthy(&data){method(&data,"set",&[&rd(&pixels,name)?])?;ctx(&t).put_image_data(&image,0.0,0.0)?;}
  Reflect::set(&tiles,&lit(name),&tile)?;
 }
 Reflect::set(host,&lit("tiles"),&tiles)?;
 rd(&tiles,kind)
}
