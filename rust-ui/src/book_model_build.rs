//! One book model: the meshes, materials and textures `createBookModel` used to assemble, its page
//! snapshot, appearance updates, cover source, relief slots and disposal, in the same order with the
//! same numbers as the JavaScript it replaces (tests/unit/helpers/reference-book-model.js). Three
//! creates every object (its namespace arrives in the host); the model's state lives in one plain JS
//! object, so nothing here holds a handle once a call returns and an abandoned model is collected
//! like any other. The per-frame pose setters and the asynchronous relief bake stay in the host and
//! read the same state.
use std::cell::RefCell;
use std::collections::HashMap;
use std::f64::consts::PI;
use wasm_bindgen::{prelude::*,JsCast};
use js_sys::{Array,Float32Array,Function,JsString,Object,Promise,Reflect,Set,Uint8Array};
use crate::host::{absent,jmax,jmin,num,truthy};
use crate::book_paint::Canvas2d;

type R<T>=Result<T,JsValue>;
thread_local!{
 /// The property names as JS strings, made once: every access borrows one instead of cloning a handle.
 static KEYS:RefCell<HashMap<&'static str,JsValue>>=RefCell::new(HashMap::new());
 /// Three's constructors, looked up once per namespace (tests load fresh copies of three).
 static CLASSES:RefCell<Option<(JsValue,HashMap<&'static str,Function>)>>=const{RefCell::new(None)};
}
/// A getter or setter that calls back into this module only nests shared borrows; a key first met
/// inside one is used without being remembered.
fn with_key<T>(name:&'static str,f:impl FnOnce(&JsValue)->T)->T{
 KEYS.with(|keys|{
  if let Ok(known)=keys.try_borrow(){if let Some(key)=known.get(name){return f(key);}}
  let key=JsValue::from_str(name);
  if let Ok(mut known)=keys.try_borrow_mut(){known.insert(name,key.clone());}
  f(&key)
 })
}
fn k(name:&'static str)->&'static str{wasm_bindgen::intern(name)}
// Three objects and the model's state are objects: read and written directly.
fn get(v:&JsValue,name:&'static str)->JsValue{if absent(v){return JsValue::UNDEFINED;}with_key(name,|key|Reflect::get(v,key)).unwrap_or(JsValue::UNDEFINED)}
fn read(v:&JsValue,name:&'static str)->R<JsValue>{
 if absent(v){return crate::host::read(v,name);}
 with_key(name,|key|Reflect::get(v,key))
}
fn put(v:&JsValue,name:&'static str,x:&JsValue)->R<()>{with_key(name,|key|Reflect::set(v,key,x))?;Ok(())}
// Numbers go straight to the engine, without a boxed JS number for each.
fn putn(v:&JsValue,name:&'static str,x:f64)->R<()>{with_key(name,|key|set_number(v,key,x))?;Ok(())}
#[wasm_bindgen]
extern "C"{
 #[wasm_bindgen(js_namespace=Reflect,js_name=set,catch)] fn set_number(target:&JsValue,key:&JsValue,value:f64)->Result<bool,JsValue>;
 /// A Vector3 or Euler (anything with `set(x, y, z)`).
 type Triple;
 #[wasm_bindgen(method,structural,catch,js_name=set)] fn set_triple(this:&Triple,x:f64,y:f64,z:f64)->Result<JsValue,JsValue>;
}
fn apply(function:&JsValue,name:&'static str,this:&JsValue,args:&[&JsValue])->R<JsValue>{
 let function=function.dyn_ref::<Function>().ok_or_else(||JsValue::from(js_sys::TypeError::new(&format!("{name} is not a function"))))?;
 match args{[]=>function.call0(this),[a]=>function.call1(this,a),[a,b]=>function.call2(this,a,b),[a,b,c]=>function.call3(this,a,b,c),
  _=>{let list=Array::new();for a in args{list.push(a);}function.apply(this,&list)}}
}
fn call(v:&JsValue,name:&'static str,args:&[&JsValue])->R<JsValue>{let function=read(v,name)?;apply(&function,name,v,args)}
/// `v?.name?.(...)`.
fn call_opt(v:&JsValue,name:&'static str,args:&[&JsValue])->R<()>{
 if absent(v){return Ok(());}
 let function=read(v,name)?;if absent(&function){return Ok(());}
 apply(&function,name,v,args)?;Ok(())
}
// The book, its style and the caller's options may be anything: read them as the engine would.
fn bread(v:&JsValue,name:&'static str)->R<JsValue>{crate::host::read(v,k(name))}
fn bget(v:&JsValue,name:&'static str)->JsValue{crate::host::get(v,k(name))}
fn word(t:&'static str)->JsValue{JsValue::from_str(k(t))}
fn n(x:f64)->JsValue{JsValue::from_f64(x)}
fn b(x:bool)->JsValue{JsValue::from_bool(x)}
fn range(message:&str)->JsValue{js_sys::RangeError::new(message).into()}
/// `String(value)`.
fn string(v:&JsValue)->String{crate::host::text_of(v)}
/// `a ?? b`.
fn or(a:JsValue,b:impl FnOnce()->JsValue)->JsValue{if absent(&a){b()}else{a}}
/// `value?.name` of the book or style.
fn opt(v:&JsValue,name:&'static str)->JsValue{if absent(v){JsValue::UNDEFINED}else{bget(v,name)}}

/// `new THREE[class](...args)`.
fn make(three:&JsValue,class:&'static str,args:&[&JsValue])->R<JsValue>{
 let cached=CLASSES.with(|classes|{
  let classes=classes.borrow();
  classes.as_ref().filter(|(namespace,_)|namespace==three).and_then(|(_,found)|found.get(class).cloned())
 });
 let constructor=match cached{Some(found)=>found,None=>{
  let found:Function=read(three,class)?.dyn_into().map_err(|_|JsValue::from(js_sys::TypeError::new(&format!("THREE.{class} is not a constructor"))))?;
  CLASSES.with(|classes|{
   let mut classes=classes.borrow_mut();
   if !classes.as_ref().is_some_and(|(namespace,_)|namespace==three){*classes=Some((three.clone(),HashMap::new()));}
   if let Some((_,known))=classes.as_mut(){known.insert(class,found.clone());}
  });
  found
 }};
 let list=match args{[]=>Array::new(),[a]=>Array::of1(a),[a,b]=>Array::of2(a,b),[a,b,c]=>Array::of3(a,b,c),
  _=>{let list=Array::new();for a in args{list.push(a);}list}};
 Reflect::construct(&constructor,&list)
}
fn object(fields:&[(&'static str,JsValue)])->R<JsValue>{let o:JsValue=Object::new().into();for(key,value)in fields{put(&o,key,value)?;}Ok(o)}
fn set3(target:&JsValue,name:&'static str,x:f64,y:f64,z:f64)->R<()>{read(target,name)?.unchecked_into::<Triple>().set_triple(x,y,z)?;Ok(())}
fn pixel_ratio()->JsValue{let ratio=crate::host::get(&crate::host::global(),"devicePixelRatio");if ratio.as_f64().is_some(){ratio}else{n(1.0)}}
fn text_seed(text:&str)->f64{f64::from(crate::spine_surface::spine_text_seed(JsString::from(text)))}
/// The surface finish table entry the host keeps for `value` (fallback as `surfaceFinish` takes it).
fn finish(host:&JsValue,value:&JsValue,fallback:&JsValue)->R<JsValue>{call(host,"finish",&[value,fallback])}
fn apply_finish(material:&JsValue,finish:JsValue,kind:&str,metallic:bool)->R<()>{crate::book_model_policy::book_apply_material_finish(material.clone(),finish,kind,metallic)}

// ---- leaves: the textures and geometries every model installs ----------------------------------------

/// A 1×1 RGBA DataTexture.
fn neutral(three:&JsValue,rgba:[u8;4])->R<JsValue>{
 let texture=make(three,"DataTexture",&[&Uint8Array::from(&rgba[..]).into(),&n(1.0),&n(1.0)])?;
 put(&texture,"needsUpdate",&JsValue::TRUE)?;Ok(texture)
}
/// The page's white placeholder: both map and blending variants exist before the first flyout frame.
fn blank_page_map(three:&JsValue)->R<JsValue>{
 let map=make(three,"DataTexture",&[&Uint8Array::from(&[255u8,255,255,255][..]).into(),&n(1.0),&n(1.0)])?;
 put(&map,"colorSpace",&read(three,"SRGBColorSpace")?)?;put(&map,"minFilter",&read(three,"LinearFilter")?)?;
 put(&map,"generateMipmaps",&JsValue::FALSE)?;put(&map,"needsUpdate",&JsValue::TRUE)?;Ok(map)
}

// Procedural micro-detail shared by every book: generated once, uploaded once (book_shared_texture). Models
// receive clones (same Source, own repeat); three.js keeps the GPU texture until the last clone is disposed.
// The woven-cloth and printed-paper tooth and the swallowtail cut are produced by the numeric core (the host
// hands their pixels over), the page edges and the endpaper are painted by book_paint.rs.
fn shared_built(host:&JsValue,key:&'static str,build:impl FnOnce(&JsValue)->R<JsValue>)->R<JsValue>{
 crate::book_model_policy::book_shared_texture_with(word(key),||build(host))
}
/// Plain-weave book cloth (16 × 16 threads per tile, with uneven slubs) or printed paper over board.
#[wasm_bindgen]
pub fn book_model_tile_normals(host:&JsValue,kind:&str)->R<JsValue>{
 let three=read(host,"three")?;
 let data=call(host,"surfacePixels",&[&JsValue::from_str(kind)])?;
 if !truthy(&data){return Err(js_sys::Error::new("El módulo numérico no pudo generar la textura del libro.").into());}
 let texture=make(&three,"DataTexture",&[&data,&n(128.0),&n(128.0)])?;
 let repeat=read(&three,"RepeatWrapping")?;put(&texture,"wrapT",&repeat)?;put(&texture,"wrapS",&repeat)?;
 put(&texture,"magFilter",&read(&three,"LinearFilter")?)?;put(&texture,"minFilter",&read(&three,"LinearMipmapLinearFilter")?)?;
 put(&texture,"generateMipmaps",&JsValue::TRUE)?;put(&texture,"needsUpdate",&JsValue::TRUE)?;
 Ok(texture)
}
/// The swallowtail cut, measured in ribbon widths from the tip (v = 0 at the tip): a shallow V, a fifth of
/// the width deep, as scissors leave it.
#[wasm_bindgen]
pub fn book_model_ribbon_notch(host:&JsValue)->R<JsValue>{
 let three=read(host,"three")?;
 let data=call(host,"notchPixels",&[&n(16.0),&n(64.0)])?;
 if !truthy(&data){return Err(js_sys::Error::new("El módulo numérico no pudo generar la muesca de la cinta.").into());}
 let texture=make(&three,"DataTexture",&[&data,&n(16.0),&n(64.0)])?;
 let linear=read(&three,"LinearFilter")?;put(&texture,"minFilter",&linear)?;put(&texture,"magFilter",&linear)?;
 put(&texture,"needsUpdate",&JsValue::TRUE)?;
 Ok(texture)
}
fn square_canvas(size:f64)->R<(JsValue,JsValue)>{
 let canvas=crate::host::method(&read(&crate::host::global(),"document")?,"createElement",&[&word("canvas")])?;
 putn(&canvas,"width",size)?;putn(&canvas,"height",size)?;
 let context=call(&canvas,"getContext",&[&word("2d")])?;
 Ok((canvas,context))
}
/// Page edges: individual leaves, darker signature folds, a slight cockle and a silk headband. u runs across
/// the leaves (tiled by physical thickness); v .02–.46 is the fore-edge, .54–.98 head and tail.
#[wasm_bindgen]
pub fn book_model_page_edges(host:&JsValue,size:f64)->R<JsValue>{
 let three=read(host,"three")?;
 let (canvas,context)=square_canvas(size)?;
 crate::book_paint::book_page_edges(context.unchecked_ref::<Canvas2d>(),size);
 let texture=make(&three,"CanvasTexture",&[&canvas])?;
 put(&texture,"colorSpace",&read(&three,"SRGBColorSpace")?)?;put(&texture,"wrapS",&read(&three,"RepeatWrapping")?)?;
 Ok(texture)
}
/// Endpaper: a white wove stock with a faint speckle and a few long fibres. White-based so the material
/// colour tints it; every stroke wraps the tile.
#[wasm_bindgen]
pub fn book_model_endpaper(host:&JsValue)->R<JsValue>{
 let three=read(host,"three")?;
 let (canvas,context)=square_canvas(256.0)?;
 crate::book_paint::book_endpaper(context.unchecked_ref::<Canvas2d>());
 let texture=make(&three,"CanvasTexture",&[&canvas])?;
 put(&texture,"colorSpace",&read(&three,"SRGBColorSpace")?)?;
 let repeat=read(&three,"RepeatWrapping")?;put(&texture,"wrapT",&repeat)?;put(&texture,"wrapS",&repeat)?;
 Ok(texture)
}

/// A numeric Rust mesh (page block, leaves, endpaper, page paper): its own arrays, installed without a copy.
#[wasm_bindgen]
pub fn book_paper_mesh(three:&JsValue,buffers:&JsValue)->R<JsValue>{
 if !truthy(buffers){return Ok(JsValue::NULL);}
 let geometry=make(three,"BufferGeometry",&[])?;
 for(name,key,size)in[("position","positions",3.0),("normal","normals",3.0),("uv","uvs",2.0),("color","colors",3.0)]{
  let attribute=make(three,"BufferAttribute",&[&read(buffers,key)?,&n(size)])?;
  call(&geometry,"setAttribute",&[&word(name),&attribute])?;
 }
 call(&geometry,"setIndex",&[&make(three,"BufferAttribute",&[&read(buffers,"indices")?,&n(1.0)])?])?;
 for group in js_sys::try_iter(&read(buffers,"groups")?)?.ok_or_else(||JsValue::from(js_sys::TypeError::new("groups is not iterable")))?{
  let group=group?;
  call(&geometry,"addGroup",&[&read(&group,"start")?,&read(&group,"count")?,&read(&group,"materialIndex")?])?;
 }
 Ok(geometry)
}

/// Both boards and both binding ends, as bookCase cut book_case_geometry's buffer.
struct Case{data:Vec<f32>,groups:[f32;6],front:(usize,usize),board:[(usize,usize);3],cap:Option<[(usize,usize);4]>}
fn finite_positive(v:&JsValue)->bool{v.as_f64().is_some_and(|x|x.is_finite()&&x>0.0)}
#[allow(clippy::too_many_arguments)]
fn case_parts(width:&JsValue,height:&JsValue,depth:f64,shelf:bool,overview:bool,thickness:&JsValue,segments:f64,rim:f64)->R<Case>{
 if !(finite_positive(width)&&finite_positive(height)&&depth.is_finite()&&depth>0.0)
  ||(segments!=0.0&&!segments.is_nan()&&!finite_positive(thickness)){return Err(range("Medidas de tapas no válidas."));}
 // `segments` reaches the core as the engine's ToUint32 would pass it to a u32 parameter.
 let data=crate::book_case::book_case_geometry(num(width),num(height),depth,shelf,overview,num(thickness),segments as u32,rim);
 let head=|i:usize|data[i] as usize;
 let (vertices,fronts,cap_vertices,cap_indices)=(head(0),head(5),head(6),head(7));
 let groups=[data[1],data[2],0.0,data[3],data[4],1.0];
 let mut at=8usize;let mut take=|length:usize|{let span=(at,at+length);at+=length;span};
 let front=take(fronts*3);
 let board=[take(vertices*3),take(vertices*2),take(vertices*3)];
 let cap=if cap_vertices!=0{Some([take(cap_vertices*3),take(cap_vertices*3),take(cap_vertices*2),take(cap_indices)])}else{None};
 Ok(Case{data,groups,front,board,cap})
}
impl Case{
 fn slice(&self,(from,to):(usize,usize))->JsValue{Float32Array::from(&self.data[from..to]).into()}
 /// An ExtrudeGeometry's own attributes and groups (its order: position, uv, normal).
 fn board(&self,three:&JsValue,front:bool)->R<JsValue>{
  let geometry=make(three,"BufferGeometry",&[])?;
  put(&geometry,"type",&word("ExtrudeGeometry"))?;
  for(name,span,size)in[("position",self.board[0],3.0),("uv",self.board[1],2.0),("normal",self.board[2],3.0)]{
   call(&geometry,"setAttribute",&[&word(name),&make(three,"Float32BufferAttribute",&[&self.slice(span),&n(size)])?])?;
  }
  let groups:Vec<f32>=if front{self.data[self.front.0..self.front.1].to_vec()}else{self.groups.to_vec()};
  for group in groups.chunks(3){call(&geometry,"addGroup",&[&n(f64::from(group[0])),&n(f64::from(group[1])),&n(f64::from(group[2]))])?;}
  Ok(geometry)
 }
 /// A ShapeGeometry's: the index as setIndex(array) makes it, then position, normal, uv.
 fn cap(&self,three:&JsValue)->R<JsValue>{
  let cap=self.cap.ok_or_else(||JsValue::from(js_sys::TypeError::new("Cannot destructure the cap of a case without one")))?;
  let geometry=make(three,"BufferGeometry",&[])?;
  put(&geometry,"type",&word("ShapeGeometry"))?;
  let wide=self.data[cap[3].0..cap[3].1].iter().any(|&value|value>=65535.0);
  let index=make(three,if wide{"Uint32BufferAttribute"}else{"Uint16BufferAttribute"},&[&self.slice(cap[3]),&n(1.0)])?;
  call(&geometry,"setIndex",&[&index])?;
  for(name,span,size)in[("position",cap[0],3.0),("normal",cap[1],3.0),("uv",cap[2],2.0)]{
   call(&geometry,"setAttribute",&[&word(name),&make(three,"Float32BufferAttribute",&[&self.slice(span),&n(size)])?])?;
  }
  Ok(geometry)
 }
}

/// A board on its own (boardGeometry): rounded edges, cover UVs on the faces.
#[wasm_bindgen]
pub fn book_board_geometry(three:&JsValue,width:&JsValue,height:&JsValue,depth:&JsValue,shelf:&JsValue,overview:&JsValue)->R<JsValue>{
 if !finite_positive(depth){return Err(range("Medidas de tapas no válidas."));}
 case_parts(width,height,num(depth),truthy(shelf),truthy(overview),&n(0.0),0.0,0.0)?.board(three,false)
}
/// The case of a model on its own (bookCaseGeometries): front board with its outside/inside groups,
/// back board, and the tail and head ends of the binding.
#[wasm_bindgen]
#[allow(clippy::too_many_arguments)]
pub fn book_case_geometries(three:&JsValue,width:&JsValue,height:&JsValue,board:&JsValue,thickness:&JsValue,shelf:&JsValue,overview:&JsValue,segments:&JsValue,rim:&JsValue)->R<JsValue>{
 if !finite_positive(board){return Err(range("Medidas de tapas no válidas."));}
 let segments_value=if segments.is_undefined(){0.0}else{num(segments)};
 let parts=case_parts(width,height,num(board),truthy(shelf),truthy(overview),thickness,segments_value,num(rim))?;
 let (front,back)=(parts.board(three,true)?,parts.board(three,false)?);
 let caps=Array::new();caps.push(&parts.cap(three)?);caps.push(&parts.cap(three)?);
 object(&[("front",front),("back",back),("caps",caps.into())])
}

/// The generated cloth case of a book with no jacket (or while its jacket downloads).
fn cover_texture(host:&JsValue,three:&JsValue,book:&JsValue,style:&JsValue,texture_height:f64,max_dimension:f64,level:&JsValue)->R<JsValue>{
 let canvas=crate::host::method(&read(&crate::host::global(),"document")?,"createElement",&[&word("canvas")])?;
 let ratio=num(&bread(style,"coverRatio")?);
 let design_width=crate::host::js_round(1024.0*if ratio==0.0||ratio.is_nan(){0.66}else{ratio});
 let dimensions=crate::book_model_policy::book_cover_raster_size(n(design_width/1024.0),texture_height,max_dimension)?;
 put(&canvas,"width",&read(&dimensions,"width")?)?;put(&canvas,"height",&read(&dimensions,"height")?)?;
 let c=call(&canvas,"getContext",&[&word("2d")])?;
 call(&c,"scale",&[&n(num(&get(&canvas,"width"))/design_width),&n(num(&get(&canvas,"height"))/1024.0)])?;
 let random=cover_seed(host,book,style,"case")?;
 let thumb=level.as_string().is_some_and(|level|level=="overview");
 put(&c,"fillStyle",&bread(style,"color")?)?;call(&c,"fillRect",&[&n(0.0),&n(0.0),&n(design_width),&n(1024.0)])?;
 // A cloth case: dyed mottling, then the weave itself. A 256 px thumbnail shows neither.
 if !thumb{call(host,"paintCloth",&[&c,&n(design_width),&random])?;call(host,"paintWeave",&[&c,&n(design_width)])?;}
 let pick=|key:&'static str|->R<JsValue>{bread(style,key)};
 let face=pick("fontCanvasFamily")?;let face=if truthy(&face){face}else{let f=pick("fontFamily")?;if truthy(&f){f}else{word("Playfair Display")}};
 let fallback=pick("fontFallback")?;let fallback=if truthy(&fallback){fallback}else{word("Georgia, serif")};
 let family=JsString::from(format!("\"{}\", {}",string(&face),string(&fallback)));
 let device=if thumb{-1.0}else{
  let mark=get(&crate::spine_surface::spine_layout(book)?,"device");
  if absent(&mark){
   let id=or(opt(book,"shelfVisualId"),||or(opt(book,"id"),||word("")));
   text_seed(&format!("device|{}|{}",string(&id),string(&or(opt(book,"title"),||word("")))))%3.0
  }else{num(&mark)}
 };
 let title=call(host,"title",&[book])?;let title=if truthy(&title){title}else{word("Sin título")};
 let author=call(host,"author",&[&bread(book,"author")?])?;let author=if truthy(&author){author}else{word("")};
 crate::book_paint::book_cover_case(c.unchecked_ref::<Canvas2d>(),design_width,&JsString::from(string(&title)),&JsString::from(string(&author)),
  &bread(style,"ink")?,&bread(style,"fontWeight")?,&family,thumb,device,read(host,"drawDevice")?.unchecked_ref(),random.unchecked_ref())?;
 let map=make(three,"CanvasTexture",&[&canvas])?;put(&map,"colorSpace",&read(three,"SRGBColorSpace")?)?;
 Ok(map)
}
/// The stream a board's wear draws from, per book, colour and salt.
fn cover_seed(host:&JsValue,book:&JsValue,style:&JsValue,salt:&str)->R<JsValue>{
 let id=or(opt(book,"shelfVisualId"),||or(opt(book,"id"),||word("")));
 let title=or(opt(book,"title"),||word(""));
 let seed=text_seed(&format!("{}|{}|{}|{salt}",string(&id),string(&title),string(&opt(style,"color"))));
 call(host,"random",&[&n(seed)])
}

/// The warm reading-room rig for shelf, editor and opening/closing books.
#[wasm_bindgen]
pub fn book_light_scene(three:&JsValue,scene:&JsValue,environment:&JsValue)->R<JsValue>{
 put(scene,"environment",environment)?;putn(scene,"environmentIntensity",0.55)?;
 // Pale ceiling above, a muted bounce from the wooden floor below.
 call(scene,"add",&[&make(three,"HemisphereLight",&[&n(f64::from(0xf6f3eeu32)),&n(f64::from(0x5e5047u32)),&n(0.5)])?])?;
 let reader=make(three,"DirectionalLight",&[&n(f64::from(0xfff4e8u32)),&n(1.9)])?;
 set3(&reader,"position",-0.46,0.42,1.0)?;call(scene,"add",&[&reader])?;
 put(&read(scene,"userData")?,"readerLight",&reader)?;
 // Cooler, dim fill from the other side keeps shaded spines legible.
 let fill=make(three,"DirectionalLight",&[&n(f64::from(0xe6edffu32)),&n(0.26)])?;
 set3(&fill,"position",3.0,0.8,2.6)?;call(scene,"add",&[&fill])?;
 // A modest off-axis strip still travels over metallic foil and clearcoat.
 let strip=make(three,"DirectionalLight",&[&n(f64::from(0xfff8f0u32)),&n(0.34)])?;
 set3(&strip,"position",3.0,1.0,2.0)?;call(scene,"add",&[&strip])?;
 Ok(scene.clone())
}

// ---- the model's state and its methods ---------------------------------------------------------------

/// `f.bind(null, ...args)`: the model's methods are the host's or this module's functions bound to its state.
fn bind(function:&JsValue,args:&[&JsValue])->R<JsValue>{
 let list=Array::new();list.push(&JsValue::NULL);for a in args{list.push(a);}
 Reflect::apply(read(function,"bind")?.unchecked_ref(),function,&list)
}
fn own(s:&JsValue,name:&'static str,args:&[&JsValue])->R<JsValue>{
 let mut all=vec![s];all.extend_from_slice(args);bind(&read(&read(&state(s,"host"),"rust")?,name)?,&all)
}
fn hosted(s:&JsValue,name:&'static str)->R<JsValue>{bind(&read(&state(s,"host"),name)?,&[s])}
fn state(s:&JsValue,name:&'static str)->JsValue{get(s,name)}
fn invalidate(s:&JsValue)->R<()>{call_opt(&get(&state(s,"group"),"userData"),"invalidate",&[])}
fn bump(s:&JsValue,name:&'static str)->R<f64>{let next=num(&state(s,name))+1.0;putn(s,name,next)?;Ok(next)}

/// A cover laminate (clearcoat above the printed image) and, once relief is armed, the thinnest clearcoat
/// that keeps its program from the start: raising varnish later only changes uniforms and textures.
fn laminate(s:&JsValue,value:&JsValue)->R<()>{
 let cover=state(s,"cover");
 apply_finish(&cover,finish(&state(s,"host"),value,&word("satin"))?,"cover",false)?;
 if truthy(&state(s,"reliefArmed"))&&!truthy(&get(&cover,"clearcoat")){putn(&cover,"clearcoat",0.001)?;}
 Ok(())
}
/// Neutral 1x1 maps: clearcoat x1, roughness x1, metalness 0, flat normal.
#[wasm_bindgen]
pub fn book_model_arm_relief(s:&JsValue)->R<()>{
 if truthy(&state(s,"reliefArmed")){return Ok(());}
 put(s,"reliefArmed",&JsValue::TRUE)?;
 laminate(s,&state(s,"coverFinishValue"))?;
 let (cover,three)=(state(s,"cover"),state(s,"three"));
 put(&cover,"clearcoatNormalMap",&neutral(&three,[128,128,255,0])?)?;
 let flat=neutral(&three,[255,255,0,255])?;
 for key in["metalnessMap","roughnessMap","clearcoatRoughnessMap","clearcoatMap"]{put(&cover,key,&flat)?;}
 put(&cover,"needsUpdate",&JsValue::TRUE)
}
fn relief_base_finish(s:&JsValue)->R<()>{
 let finish=finish(&state(s,"host"),&state(s,"coverFinishValue"),&JsValue::UNDEFINED)?;
 call(&read(&read(&state(s,"reliefUniforms"),"bookReliefBaseFinish")?,"value")?,"set",
  &[&read(&finish,"clearcoat")?,&read(&finish,"roughness")?,&read(&finish,"clearcoatRoughness")?])?;Ok(())
}
/// The relief's uniforms and the cover's clearcoat for the wanted relief and the installed maps.
#[wasm_bindgen]
pub fn book_model_relief_uniforms(s:&JsValue)->R<()>{
 relief_base_finish(s)?;
 let (wanted,maps,cover)=(state(s,"wantedRelief"),state(s,"reliefMaps"),state(s,"cover"));
 let active=truthy(&wanted)&&truthy(&maps);
 let strength=||->R<JsValue>{if truthy(&read(&wanted,"layers")?){Ok(n(1.0))}else{read(&wanted,"strength")}};
 put(&read(&state(s,"reliefUniforms"),"bookReliefStrength")?,"value",&if active{strength()?}else{n(0.0)})?;
 if !active{
  putn(&cover,"metalness",0.0)?;call(&read(&cover,"clearcoatNormalScale")?,"set",&[&n(1.0),&n(1.0)])?;
  if truthy(&state(s,"reliefArmed")){laminate(s,&state(s,"coverFinishValue"))?;}
  return Ok(());
 }
 // Varnish is a dielectric layer over unchanged printed ink: colour selection never implies a metal.
 // Multicolour intensities are already in the pixels: a global scalar must not attenuate them.
 putn(&cover,"clearcoat",1.0)?;putn(&cover,"metalness",0.0)?;
 call(&read(&cover,"clearcoatNormalScale")?,"setScalar",&[&n(3.5*num(&strength()?))])?;Ok(())
}
/// Commit both relief maps; the previously owned ones are released once.
#[wasm_bindgen]
pub fn book_model_adopt_relief(s:&JsValue,normal:JsValue,material:JsValue)->R<()>{
 let owned=state(s,"reliefOwned");
 let fresh=crate::book_model_policy::book_adopt_relief_textures(state(s,"cover"),owned.unchecked_ref::<Set>(),normal,material)?;
 put(s,"reliefOwned",&fresh)
}
#[wasm_bindgen]
pub fn book_model_clear_relief(s:&JsValue)->R<()>{
 put(s,"reliefMaps",&JsValue::NULL)?;
 bump(s,"materialRevision")?;
 let three=state(s,"three");
 let normal=neutral(&three,[128,128,255,0])?;
 book_model_adopt_relief(s,normal,neutral(&three,[255,255,0,255])?)?;
 book_model_relief_uniforms(s)?;
 invalidate(s)
}
/// Only the cover editor needs the relief's shader slots before its first choice.
#[wasm_bindgen]
pub fn book_model_prepare_relief(s:&JsValue)->R<bool>{
 if truthy(&state(s,"disposed")){return Ok(false);}
 book_model_arm_relief(s)?;Ok(true)
}
/// The printed raster the relief analyses: the image alone, its transparent margins cleared, so they
/// cannot become a colour proposal or receive relief merely because their ink matches.
#[wasm_bindgen]
pub fn book_model_relief_source(s:&JsValue)->R<JsValue>{
 let printed=opt(&get(&state(s,"cover"),"map"),"image");
 let bounds=state(s,"coverImageBounds");
 if !truthy(&printed)||!truthy(&bounds){return Ok(printed);}
 let mask=state(s,"coverMaskSource");
 if truthy(&mask){return Ok(mask);}
 let (x,y,width,height)=(read(&bounds,"x")?,read(&bounds,"y")?,read(&bounds,"width")?,read(&bounds,"height")?);
 if x==n(0.0)&&y==n(0.0)&&width==get(&printed,"width")&&height==get(&printed,"height"){return Ok(printed);}
 let (x,y,width,height)=(num(&x),num(&y),num(&width),num(&height));
 let canvas=crate::host::method(&read(&crate::host::global(),"document")?,"createElement",&[&word("canvas")])?;
 put(&canvas,"width",&get(&printed,"width"))?;put(&canvas,"height",&get(&printed,"height"))?;
 let context=call(&canvas,"getContext",&[&word("2d")])?;call(&context,"drawImage",&[&printed,&n(0.0),&n(0.0)])?;
 let (cw,ch)=(num(&get(&canvas,"width")),num(&get(&canvas,"height")));
 for [a,b,c,d] in[[0.0,0.0,cw,y],[0.0,y+height,cw,ch-y-height],[0.0,y,x,height],[x+width,y,cw-x-width,height]]{
  call(&context,"clearRect",&[&n(a),&n(b),&n(c),&n(d)])?;
 }
 put(s,"coverMaskSource",&canvas)?;Ok(canvas)
}
/// A relief map as raw pixels: a canvas premultiplies transparent pixels and would lose the neutral
/// normals (128/128/255) its alpha marks outside the selection.
#[wasm_bindgen]
pub fn book_model_map_texture(three:&JsValue,rgba:&JsValue,width:&JsValue,height:&JsValue)->R<JsValue>{
 let bytes=Uint8Array::new_with_byte_offset_and_length(&read(rgba,"buffer")?,num(&read(rgba,"byteOffset")?) as u32,num(&read(rgba,"byteLength")?) as u32);
 let texture=make(three,"DataTexture",&[&bytes,width,height])?;
 put(&texture,"flipY",&JsValue::TRUE)?;
 put(&texture,"magFilter",&read(three,"LinearFilter")?)?;put(&texture,"minFilter",&read(three,"LinearMipmapLinearFilter")?)?;
 put(&texture,"generateMipmaps",&JsValue::TRUE)?;putn(&texture,"anisotropy",4.0)?;put(&texture,"needsUpdate",&JsValue::TRUE)?;
 Ok(texture)
}

fn page_tone_copy(s:&JsValue,tone:&JsValue)->R<()>{
 call(&read(&read(&state(s,"pagePaper"),"material")?,"color")?,"copy",&[tone])?;
 let leaf=state(s,"leafPaper");
 if !absent(&leaf){let color=call(&read(&leaf,"color")?,"copy",&[tone])?;call(&color,"multiply",&[&get(&state(s,"host"),"leafLight")])?;}
 Ok(())
}
fn theme_of(value:&JsValue)->f64{let v=num(value);jmax(0.0,jmin(1.0,if v==0.0||v.is_nan(){0.0}else{v}))}
fn page_texture(three:&JsValue,source:&JsValue)->R<JsValue>{
 let map=make(three,"CanvasTexture",&[source])?;
 put(&map,"colorSpace",&read(three,"SRGBColorSpace")?)?;
 put(&map,"minFilter",&read(three,"LinearFilter")?)?;put(&map,"generateMipmaps",&JsValue::FALSE)?;Ok(map)
}
/// `Number(of[key] || of.source[key] || of.source[fallback])` (no fallback: the source's own value).
fn dimension(of:&JsValue,key:&'static str,fallback:&'static str)->R<f64>{
 let first=read(of,key)?;if truthy(&first){return Ok(num(&first));}
 let source=read(of,"source")?;let second=read(&source,key)?;
 if truthy(&second)||fallback.is_empty(){return Ok(num(&second));}
 Ok(num(&read(&source,fallback)?))
}
/// The reader's page on the open book: fitted, on its own paper, with its white-stock variant beneath.
/// `redraw:false` builds the page without rendering it (the caller draws later).
#[wasm_bindgen]
pub fn book_model_page_snapshot(s:&JsValue,snapshot:&JsValue,options:&JsValue)->R<bool>{
 let (initial,redraw)=if options.is_undefined(){(JsValue::UNDEFINED,true)}else{
  let theme=bread(options,"pageTheme")?;let redraw=bread(options,"redraw")?;(theme,redraw.is_undefined()||truthy(&redraw))};
 if truthy(&state(s,"disposed"))||!truthy(&opt(snapshot,"source")){return Ok(false);}
 let (host,three)=(state(s,"host"),state(s,"three"));
 let image_width=dimension(snapshot,"width","naturalWidth")?;
 let image_height=dimension(snapshot,"height","naturalHeight")?;
 if !(image_width>0.0&&image_height>0.0){return Ok(false);}
 let variant=if truthy(&opt(&bread(snapshot,"paper")?,"source")){bread(snapshot,"paper")?}else{JsValue::NULL};
 let same=truthy(&variant)&&dimension(&variant,"width","")?==image_width&&dimension(&variant,"height","")?==image_height;
 let theme_raster=call(&host,"pageRaster",&[&bread(snapshot,"source")?])?;
 let stock_raster=if same{call(&host,"pageRaster",&[&bread(&variant,"source")?])?}else{JsValue::FALSE};
 // Fresh copies of one settled render contain identical pixels: keep the uploaded textures and
 // geometry; bounds and locator metadata still come from this snapshot. Unknown copies rebuild.
 let installed=state(s,"installedRaster");
 let user=read(&state(s,"group"),"userData")?;
 if truthy(&theme_raster)&&truthy(&stock_raster)&&!absent(&installed)&&get(&installed,"theme")==theme_raster
  &&get(&installed,"stock")==stock_raster&&get(&installed,"width")==n(image_width)&&get(&installed,"height")==n(image_height){
  if !absent(&initial){putn(s,"pageTheme",theme_of(&initial))?;}
  call(&host,"applyPageTheme",&[s])?;
  put(&user,"pageSnapshot",snapshot)?;
  if redraw{invalidate(s)?;}
  return Ok(true);
 }
 let (page_image,page_material)=(state(s,"pageImage"),state(s,"pageMaterial"));
 let (stock_image,stock_material)=(state(s,"stockImage"),state(s,"stockMaterial"));
 let fit=call(&host,"fit",&[&n(image_width),&n(image_height),&state(s,"pageWidth"),&state(s,"pageHeight")])?;
 call(&read(&page_image,"geometry")?,"dispose",&[])?;
 put(&page_image,"geometry",&make(&three,"PlaneGeometry",&[&read(&fit,"width")?,&read(&fit,"height")?])?)?;
 let map=page_texture(&three,&bread(snapshot,"source")?)?;
 call_opt(&get(&page_material,"map"),"dispose",&[])?;put(&page_material,"map",&map)?;put(&page_material,"needsUpdate",&JsValue::TRUE)?;
 put(&page_image,"visible",&JsValue::TRUE)?;
 // The stock variant must be the same page: same canvas size.
 call_opt(&get(&stock_material,"map"),"dispose",&[])?;
 if same{
  call(&read(&stock_image,"geometry")?,"dispose",&[])?;put(&stock_image,"geometry",&call(&read(&page_image,"geometry")?,"clone",&[])?)?;
  let stock=if truthy(&theme_raster)&&theme_raster==stock_raster{map.clone()}else{page_texture(&three,&bread(&variant,"source")?)?};
  put(&stock_material,"map",&stock)?;put(&stock_material,"needsUpdate",&JsValue::TRUE)?;
  put(&stock_image,"visible",&JsValue::TRUE)?;
 }else{
  put(&stock_material,"map",&blank_page_map(&three)?)?;
  put(&stock_image,"visible",&JsValue::FALSE)?;putn(&page_material,"opacity",1.0)?;
 }
 if !absent(&initial){putn(s,"pageTheme",theme_of(&initial))?;}
 // Match the reader's snapshot; ordinary unthemed book paper stays white.
 let theme_tone=call(&host,"paperTone",&[&bread(snapshot,"source")?,&bread(snapshot,"toneKey")?])?;put(s,"themeTone",&theme_tone)?;
 let stock_tone=if same{call(&host,"paperTone",&[&bread(&variant,"source")?,&bread(&variant,"toneKey")?])?}else{JsValue::NULL};
 put(s,"stockTone",&stock_tone)?;
 if truthy(&get(&stock_image,"visible")){call(&host,"applyPageTheme",&[s])?;}
 else if truthy(&theme_tone){page_tone_copy(s,&theme_tone)?;}
 put(&user,"pageSnapshot",snapshot)?;
 put(s,"installedRaster",&if truthy(&theme_raster)&&truthy(&stock_raster){object(&[("theme",theme_raster),("stock",stock_raster),
  ("width",n(image_width)),("height",n(image_height))])?}else{JsValue::NULL})?;
 if redraw{invalidate(s)?;}
 Ok(true)
}
#[wasm_bindgen]
pub fn book_model_page_textures(s:&JsValue)->R<JsValue>{
 let page=get(&state(s,"pageMaterial"),"map");
 let list=Array::new();list.push(&page);
 if truthy(&get(&state(s,"stockImage"),"visible")){let stock=get(&state(s,"stockMaterial"),"map");if stock!=page{list.push(&stock);}}
 Ok(list.into())
}

// ---- cover source -----------------------------------------------------------------------------------

/// Install a cover map: the renderer's sampling quality, the previous map released.
fn replace_map(s:&JsValue,map:&JsValue,bounds:&JsValue)->R<()>{
 put(s,"coverImageBounds",&if bounds.is_undefined(){JsValue::NULL}else{bounds.clone()})?;put(s,"coverMaskSource",&JsValue::NULL)?;
 putn(map,"anisotropy",jmin(16.0,num(&call(&state(s,"host"),"anisotropy",&[])?)))?;
 let cover=state(s,"cover");
 call_opt(&get(&cover,"map"),"dispose",&[])?;put(&cover,"map",map)?;put(&cover,"needsUpdate",&JsValue::TRUE)
}
fn grain_strength(s:&JsValue)->R<()>{
 let cover=state(s,"cover");
 if !truthy(&get(&cover,"normalMap")){return Ok(());}
 // A laminate fills the paper/cloth tooth rather than polishing its dye: same raster, other strength.
 let strength=crate::book_surface_policy::book_grain_strength(&string(&state(s,"coverGrain")),num(&state(s,"weaveStrength")),&string(&state(s,"coverSurfaceFinish")));
 call(&read(&cover,"normalScale")?,"setScalar",&[&n(strength)])?;Ok(())
}
/// Close-up copies carry woven or paper tooth in the normal channel; shelf copies skip it.
fn cover_grain(s:&JsValue,kind:&'static str)->R<()>{
 if (!truthy(&state(s,"detail"))&&!truthy(&state(s,"inspectionResolution")))||state(s,"coverGrain").as_string().is_some_and(|grain|grain==kind){return Ok(());}
 put(s,"coverGrain",&word(kind))?;
 let (cover,host)=(state(s,"cover"),state(s,"host"));
 call_opt(&get(&cover,"normalMap"),"dispose",&[])?;
 let cloth=kind=="cloth";
 put(&cover,"normalMap",&shared_built(&host,kind,|host|book_model_tile_normals(host,kind))?)?;
 let tiles=if cloth{14.0}else{5.0};
 call(&read(&read(&cover,"normalMap")?,"repeat")?,"set",&[&n(tiles*num(&state(s,"ratio"))),&n(tiles)])?;
 grain_strength(s)?;put(&cover,"needsUpdate",&JsValue::TRUE)
}
#[wasm_bindgen]
pub fn book_model_cover_settle(s:&JsValue,revision:f64,loaded:bool)->R<()>{
 if revision!=num(&state(s,"coverRevision"))||truthy(&state(s,"disposed")){return Ok(());}
 let user=read(&state(s,"group"),"userData")?;
 put(&user,"coverLoaded",&b(loaded))?;
 crate::host::call(&state(s,"resolveCoverReady"),"resolveCoverReady",&[&b(loaded)])?;
 let wanted=state(s,"wantedRelief");
 if loaded&&truthy(&wanted){call(&user,"setCoverRelief",&[&wanted])?;}
 invalidate(s)
}
/// The jacket as the case prints it: fitted on the cloth colour, then the board's joint, edges and corners.
/// The idle detailed model and its flyout share one bounded raster with the decoded image.
#[wasm_bindgen]
pub fn book_model_cover_raster(s:&JsValue,image:&JsValue,dimensions:&JsValue,book:&JsValue,style:&JsValue)->R<JsValue>{
 let (host,three)=(state(s,"host"),state(s,"three"));
 let canvas=crate::host::method(&read(&crate::host::global(),"document")?,"createElement",&[&word("canvas")])?;
 put(&canvas,"height",&read(dimensions,"height")?)?;put(&canvas,"width",&read(dimensions,"width")?)?;
 let c=call(&canvas,"getContext",&[&word("2d")])?;
 put(&c,"fillStyle",&bread(style,"color")?)?;call(&c,"fillRect",&[&n(0.0),&n(0.0),&get(&canvas,"width"),&get(&canvas,"height")])?;
 let fit=call(&host,"fit",&[&bread(image,"width")?,&bread(image,"height")?,&get(&canvas,"width"),&get(&canvas,"height")])?;
 put(&c,"imageSmoothingEnabled",&JsValue::TRUE)?;put(&c,"imageSmoothingQuality",&word("high"))?;
 call(&c,"drawImage",&[image,&read(&fit,"x")?,&read(&fit,"y")?,&read(&fit,"width")?,&read(&fit,"height")?])?;
 // A printed jacket is still paper over board: joint, edges, corners.
 let unit=num(&get(&canvas,"height"))/1024.0;
 crate::host::method_opt(&c,k("setTransform"),&[&n(unit),&n(0.0),&n(0.0),&n(unit),&n(0.0),&n(0.0)])?;
 let design_width=num(&get(&canvas,"width"))/unit;
 let random=cover_seed(&host,book,style,"print")?;
 let wear=!state(s,"level").as_string().is_some_and(|level|level=="overview");
 crate::book_paint::book_finish_board(c.unchecked_ref::<Canvas2d>(),design_width,random.unchecked_ref(),wear);
 let map=make(&three,"CanvasTexture",&[&canvas])?;put(&map,"colorSpace",&read(&three,"SRGBColorSpace")?)?;
 object(&[("map",map),("bounds",fit)])
}
/// A decoded jacket arrived: the previous cover stays on the mesh until every new pixel is ready.
#[wasm_bindgen]
pub fn book_model_cover_image(s:&JsValue,revision:f64,book:&JsValue,style:&JsValue,image:&JsValue,entry:&JsValue)->R<()>{
 if revision!=num(&state(s,"coverRevision"))||truthy(&state(s,"disposed")){return Ok(());}
 let attempt=||->R<()>{
  let host=state(s,"host");let level=state(s,"level");
  let is=|name:&str|level.as_string().is_some_and(|level|level==name);
  let dimensions=crate::book_model_policy::book_cover_raster_size(bread(style,"coverRatio")?,num(&state(s,"textureHeight")),num(&state(s,"maxTextureDimension")))?;
  let key=Array::new();
  for value in[read(&dimensions,"width")?,read(&dimensions,"height")?,bread(book,"id")?,bread(book,"title")?,bread(style,"color")?,b(is("overview"))]{key.push(&value);}
  let key=js_sys::JSON::stringify(&key)?;
  let build=own(s,"book_model_cover_raster",&[image,&dimensions,book,style])?;
  let raster=call(&host,"reuse",&[&if is("detail"){entry.clone()}else{JsValue::NULL},&key,&build])?;
  let (map,bounds)=(read(&raster,"map")?,read(&raster,"bounds")?);
  replace_map(s,&map,&bounds)?;cover_grain(s,"paper")?;book_model_cover_settle(s,revision,true)
 };
 if attempt().is_err(){book_model_cover_settle(s,revision,false)?;}
 Ok(())
}
/// Point the cover at `url` (or the generated case for none). Resolves true once its pixels are on.
#[wasm_bindgen]
pub fn book_model_cover_source(s:&JsValue,url:&JsValue,book:&JsValue,style:&JsValue,options:&JsValue)->R<JsValue>{
 let book=if book.is_undefined(){state(s,"book")}else{book.clone()};
 let style=if style.is_undefined(){state(s,"style")}else{style.clone()};
 let force=if options.is_undefined(){false}else{truthy(&bread(options,"force")?)};
 let user=read(&state(s,"group"),"userData")?;
 if truthy(&state(s,"disposed")){return Ok(Promise::resolve(&JsValue::FALSE).into());}
 if !force&&truthy(url)&&*url==state(s,"currentCoverUrl"){return read(&user,"ready");}
 crate::host::method_opt(&state(s,"reliefController"),k("abort"),&[])?;bump(s,"reliefRevision")?;
 if truthy(&state(s,"reliefArmed"))&&truthy(&state(s,"reliefMaps")){book_model_clear_relief(s)?;}
 crate::host::call(&state(s,"resolveCoverReady"),"resolveCoverReady",&[&JsValue::FALSE])?;
 let revision=bump(s,"coverRevision")?;let release_previous=state(s,"releaseImage");
 put(s,"currentCoverUrl",url)?;
 let mut resolver=JsValue::UNDEFINED;
 let ready=Promise::new(&mut |resolve,_|{resolver=resolve.into();});
 put(s,"resolveCoverReady",&resolver)?;
 put(&user,"ready",&ready)?;
 let host=state(s,"host");
 if !truthy(url){
  put(s,"releaseImage",&read(&host,"noop")?)?;
  let map=cover_texture(&host,&state(s,"three"),&book,&style,num(&state(s,"textureHeight")),num(&state(s,"maxTextureDimension")),&state(s,"level"))?;
  replace_map(s,&map,&JsValue::NULL)?;
  cover_grain(s,"cloth")?;book_model_cover_settle(s,revision,true)?;
 }else{
  let loaded=own(s,"book_model_cover_image",&[&n(revision),&book,&style])?;
  let failed=own(s,"book_model_cover_settle",&[&n(revision),&JsValue::FALSE])?;
  put(s,"releaseImage",&call(&host,"acquire",&[url,&loaded,&failed])?)?;
 }
 crate::host::call(&release_previous,"releaseImage",&[])?;
 read(&user,"ready")
}

// ---- appearance, bookmark and disposal ---------------------------------------------------------------

/// The ribbon's silk follows the cloth it has to stand out from.
fn silk(s:&JsValue)->R<JsValue>{
 let finished=read(&state(s,"bookmark"),"finished")?;
 Ok(crate::book_surface_policy::book_ribbon_silk(state(s,"ribbonSeed"),state(s,"clothColor"),truthy(&finished),get(&state(s,"host"),"silkHost"))?.into())
}
/// Satin's sheen is a brighter shade of its own dye, not a white veil.
fn tint(s:&JsValue,material:&JsValue,silk:JsValue,shelf:bool)->R<()>{
 crate::book_surface_policy::book_ribbon_tint(material.clone(),silk,shelf,make(&state(s,"three"),"Color",&[&word("#fff6ea")])?)
}
/// Woven satin: a soft sheen along the ribbon; the swallowtail tip is cut by an alpha mask.
fn satin(s:&JsValue,finished:&JsValue,silk:JsValue,shelf:bool)->R<JsValue>{
 let three=state(s,"three");
 let options:JsValue=Object::assign(&Object::new(),crate::book_surface_policy::book_ribbon_material(truthy(finished),shelf)?.unchecked_ref()).into();
 put(&options,"alphaMap",&shared_built(&state(s,"host"),"ribbon-notch",book_model_ribbon_notch)?)?;
 put(&options,"side",&read(&three,"DoubleSide")?)?;
 let material=make(&three,"MeshPhysicalMaterial",&[&options])?;
 tint(s,&material,silk,shelf)?;Ok(material)
}
fn ribbon_mesh(s:&JsValue)->R<()>{
 let bookmark=state(s,"bookmark");
 let material=satin(s,&read(&bookmark,"finished")?,silk(s)?,!truthy(&state(s,"detail")))?;
 put(s,"ribbonMaterial",&material)?;
 let options=object(&[("segments",state(s,"ribbonSegments")),("seed",state(s,"ribbonSeed"))])?;
 let geometry=call(&state(s,"host"),"bookmark",&[&state(s,"width"),&state(s,"height"),&state(s,"thickness"),
  &read(&bookmark,"progress")?,&read(&bookmark,"peek")?,&options])?;
 let mesh=make(&state(s,"three"),"Mesh",&[&geometry,&material])?;
 putn(&mesh,"renderOrder",4.0)?;put(&mesh,"name",&word("reading-bookmark"))?;
 put(s,"ribbonMesh",&mesh)?;
 call(&state(s,"group"),"add",&[&mesh])?;Ok(())
}
/// The leaves already read: a gathering as deep as the reading progress (clamped).
fn leaf_depth(s:&JsValue)->R<f64>{
 let progress=or(opt(&state(s,"bookmark"),"progress"),||n(0.0));
 Ok((num(&state(s,"thickness"))-num(&state(s,"board"))*2.4)*jmax(0.025,jmin(0.5,num(&progress))))
}
fn leaf_options(s:&JsValue)->R<JsValue>{object(&[("board",state(s,"board")),("inset",state(s,"inset"))])}
fn cap_finish(s:&JsValue,material:&JsValue,book:&JsValue)->R<()>{
 let finish=finish(&state(s,"host"),&bread(book,"spineSurfaceFinish")?,&word("matte"))?;
 let metal=bread(book,"spineFinish")?.as_string().is_some_and(|f|f=="gold")||bread(book,"spineFinish")?.as_string().is_some_and(|f|f=="silver");
 apply_finish(material,finish,"cap",metal)
}
#[wasm_bindgen]
pub fn book_model_dispose(s:&JsValue)->R<()>{
 if truthy(&state(s,"disposed")){return Ok(());}
 crate::host::call(&state(s,"releaseImage"),"releaseImage",&[])?;
 crate::host::call(&state(s,"resolveCoverReady"),"resolveCoverReady",&[&JsValue::FALSE])?;
 crate::host::method_opt(&state(s,"reliefController"),k("abort"),&[])?;
 put(s,"disposed",&JsValue::TRUE)?;bump(s,"reliefRevision")?;bump(s,"materialRevision")?;
 put(s,"reliefMaps",&JsValue::NULL)?;put(s,"coverMaskSource",&JsValue::NULL)?;
 crate::book_model_policy::book_dispose_resources(state(s,"group"),state(s,"insideCover"),state(s,"surface"))
}
#[wasm_bindgen]
pub fn book_model_spine_appearance(s:&JsValue,book:&JsValue,style:&JsValue)->R<()>{
 let host=state(s,"host");
 let previous=state(s,"surface");
 let surface=call(&host,"spine",&[book,style,&state(s,"height"),&state(s,"thickness"),&state(s,"shelf"),&state(s,"overview"),&state(s,"inspectionResolution")])?;
 put(s,"surface",&surface)?;
 // Font arrival/editor changes replace pixels, not the renderer's sampling quality.
 put(&read(&surface,"map")?,"anisotropy",&read(&read(&previous,"map")?,"anisotropy")?)?;
 put(&read(&surface,"channels")?,"anisotropy",&read(&read(&previous,"channels")?,"anisotropy")?)?;
 let binding=state(s,"binding");
 Object::assign(binding.unchecked_ref(),read(&surface,"material")?.unchecked_ref());
 let fade=state(s,"updateSpineFade");
 if !absent(&fade){crate::host::call(&fade,"updateSpineFade",&[book,style])?;}
 put(&binding,"needsUpdate",&JsValue::TRUE)?;
 call(&host,"releaseSurface",&[&previous])?;
 let mesh=state(s,"bindingMesh");
 call(&read(&mesh,"geometry")?,"dispose",&[])?;
 let geometry=call(&host,"binding",&[&state(s,"width"),&state(s,"height"),&state(s,"thickness"),&state(s,"bindingSegments"),&read(&surface,"relief")?,&state(s,"reliefRows")])?;
 put(&mesh,"geometry",&geometry)?;
 let color=bread(style,"color")?;
 call(&read(&state(s,"cloth"),"color")?,"set",&[&color])?;
 call(&read(&state(s,"insideCover"),"color")?,"set",&[&bread(style,"color")?])?;
 put(s,"clothColor",&bread(style,"color")?)?;
 let ribbon=state(s,"ribbonMaterial");
 if truthy(&ribbon){tint(s,&ribbon,silk(s)?,!truthy(&state(s,"detail")))?;}
 for material in Array::from(&state(s,"capMaterials")).iter(){
  call(&read(&material,"color")?,"set",&[&bread(style,"color")?])?;
  cap_finish(s,&material,book)?;
 }
 Ok(())
}
#[wasm_bindgen]
pub fn book_model_cover_appearance(s:&JsValue,book:&JsValue)->R<()>{
 let host=state(s,"host");
 let finish_of=|book:&JsValue|->R<JsValue>{call(&host,"surfaceFinish",&[&bread(book,"coverFinish")?])};
 let changed=finish_of(book)?!=state(s,"coverSurfaceFinish");
 put(s,"coverSurfaceFinish",&finish_of(book)?)?;
 put(s,"coverFinishValue",&bread(book,"coverFinish")?)?;
 laminate(s,&bread(book,"coverFinish")?)?;
 book_model_relief_uniforms(s)?;
 grain_strength(s)?;
 let current=state(s,"wantedRelief");
 let wanted=if Reflect::has(book,&JsValue::from_str(k("coverRelief")))?{call(&host,"normalizeRelief",&[&bread(book,"coverRelief")?])?}else{current.clone()};
 let selection_changed=JsValue::from(js_sys::JSON::stringify(&wanted)?)!=JsValue::from(js_sys::JSON::stringify(&current)?);
 if selection_changed{call(&read(&state(s,"group"),"userData")?,"setCoverRelief",&[&wanted])?;}
 else if changed&&truthy(&state(s,"reliefMaps")){call(&host,"rebake",&[s,&state(s,"reliefRevision")])?;}
 Ok(())
}
#[wasm_bindgen]
pub fn book_model_update_bookmark(s:&JsValue,book:&JsValue)->R<()>{
 if truthy(&state(s,"disposed")){return Ok(());}
 let host=state(s,"host");
 let bookmark=call(&host,"bookmarkFor",&[book])?;put(s,"bookmark",&bookmark)?;
 let mesh=state(s,"ribbonMesh");
 if !truthy(&bookmark)&&truthy(&mesh){
  let material=state(s,"ribbonMaterial");
  call(&state(s,"group"),"remove",&[&mesh])?;call(&read(&mesh,"geometry")?,"dispose",&[])?;
  call_opt(&read(&material,"alphaMap")?,"dispose",&[])?;call(&material,"dispose",&[])?;
  put(s,"ribbonMesh",&JsValue::NULL)?;put(s,"ribbonMaterial",&JsValue::NULL)?;
 }
 if truthy(&bookmark){
  if !truthy(&state(s,"ribbonMesh")){ribbon_mesh(s)?;}
  else{
   // Progress changes the same silk and bends its existing strip: GPU material, alpha and buffers stay.
   let material=state(s,"ribbonMaterial");
   putn(&material,"metalness",if truthy(&read(&bookmark,"finished")?){0.16}else{0.0})?;
   tint(s,&material,silk(s)?,!truthy(&state(s,"detail")))?;
  }
  call(&host,"ribbonGeometry",&[s])?;
 }
 let leaves=state(s,"readLeaves");
 if truthy(&leaves){
  call(&read(&leaves,"geometry")?,"dispose",&[])?;
  let geometry=call(&host,"leafStack",&[&state(s,"width"),&state(s,"height"),&n(leaf_depth(s)?),&leaf_options(s)?])?;
  put(&leaves,"geometry",&geometry)?;
 }
 let user=read(&state(s,"group"),"userData")?;
 put(&user,"hasBookmark",&b(truthy(&bookmark)))?;
 invalidate(s)
}
#[wasm_bindgen]
pub fn book_model_edge_appearance(s:&JsValue,book:&JsValue)->R<()>{
 apply_finish(&state(s,"edges"),finish(&state(s,"host"),&bread(book,"pageEdgeFinish")?,&word("satin"))?,"paper",false)
}

// ---- construction ------------------------------------------------------------------------------------

fn mesh(three:&JsValue,geometry:&JsValue,material:&JsValue)->R<JsValue>{make(three,"Mesh",&[geometry,material])}
fn named(target:&JsValue,name:&'static str)->R<()>{put(target,"name",&word(name))}
fn add(parent:&JsValue,child:&JsValue)->R<()>{call(parent,"add",&[child])?;Ok(())}
fn list(items:&[&JsValue])->JsValue{let a=Array::new();for item in items{a.push(item);}a.into()}
fn reflect(host:&JsValue,material:&JsValue,fields:&[(&'static str,JsValue)])->R<()>{call(host,"reflect",&[material,&object(fields)?])?;Ok(())}

/// Build one book. `shelf`, `overview`, `inspectionResolution` and `eagerRelief` are the options as the host
/// destructured them; width, height and thickness are passed on to the host exactly as given.
#[wasm_bindgen]
#[allow(clippy::too_many_arguments)]
pub fn book_model_create(host:&JsValue,book:&JsValue,style:&JsValue,width:&JsValue,height:&JsValue,thickness:&JsValue,
 cover_url:&JsValue,shelf:&JsValue,overview:&JsValue,inspection:&JsValue,eager:&JsValue)->R<JsValue>{
 let three=read(host,"three")?;
 let (w,h,t)=(num(width),num(height),num(thickness));
 let s:JsValue=Object::new().into();
 let group=make(&three,"Group",&[])?;
 let quality=crate::book_model_policy::book_model_plan(h,truthy(shelf),truthy(overview),num(inspection),pixel_ratio())?;
 let inspection=read(&quality,"inspectionResolution")?;
 let user=read(&group,"userData")?;
 put(&user,"inspectionResolution",&inspection)?;
 put(&user,"isOverview",&b(truthy(overview)))?;put(&user,"overview",&b(truthy(overview)))?;
 put(&user,"detailLevel",&read(&quality,"detailLevel")?)?;
 let texture_height=read(&quality,"textureHeight")?;let max_texture=read(&quality,"maxTextureDimension")?;
 let binding_segments=read(&quality,"bindingSegments")?;let relief_rows=read(&quality,"reliefRows")?;
 let ribbon_segments=read(&quality,"ribbonSegments")?;let detail=truthy(&read(&quality,"detail")?);
 let id=||or(opt(book,"shelfVisualId"),||or(opt(book,"id"),||word("")));
 let seed=text_seed(&format!("ribbon|{}|{}",string(&id()),string(&or(opt(book,"title"),||word("")))));
 let ribbon_seed=if seed==0.0||seed.is_nan(){1.0}else{seed};
 let level=read(&user,"detailLevel")?;let ratio=w/h;
 let surface_seed=string(&or(opt(book,"shelfVisualId"),||or(opt(book,"id"),||or(opt(book,"path"),||or(opt(book,"title"),||word("book"))))));
 for(key,value)in[("host",host.clone()),("three",three.clone()),("group",group.clone()),("book",book.clone()),("style",style.clone()),
  ("width",width.clone()),("height",height.clone()),("thickness",thickness.clone()),("coverUrl",cover_url.clone()),
  ("shelf",shelf.clone()),("overview",overview.clone()),("inspectionResolution",inspection.clone()),("detail",b(detail)),
  ("level",level.clone()),("ratio",n(ratio)),("textureHeight",texture_height),("maxTextureDimension",max_texture),
  ("bindingSegments",binding_segments.clone()),("reliefRows",relief_rows.clone()),("ribbonSegments",ribbon_segments),
  ("ribbonSeed",n(ribbon_seed)),("disposed",JsValue::FALSE)]{put(&s,key,&value)?;}
 let cloth=make(&three,"MeshStandardMaterial",&[&object(&[("color",bread(style,"color")?),("roughness",n(0.86))])?])?;
 put(&s,"cloth",&cloth)?;
 reflect(host,&cloth,&[("seed",JsValue::from(format!("{surface_seed}|back"))),("strength",n(0.018))])?;
 let surface=call(host,"spine",&[book,style,height,thickness,shelf,overview,&inspection])?;
 put(&s,"surface",&surface)?;
 let options:JsValue=Object::assign(&Object::new(),&Object::from(read(&surface,"material")?)).into();
 put(&options,"side",&read(&three,"DoubleSide")?)?;
 let binding=make(&three,"MeshPhysicalMaterial",&[&options])?;
 put(&s,"binding",&binding)?;
 let fade=if !truthy(shelf)&&!truthy(overview){call(host,"spineFade",&[&binding])?}else{JsValue::NULL};
 put(&s,"updateSpineFade",&fade)?;
 if !absent(&fade){crate::host::call(&fade,"updateSpineFade",&[book,style])?;}
 reflect(host,&binding,&[("seed",JsValue::from(format!("{surface_seed}|binding"))),("strength",n(0.014))])?;
 // Painted once, by the cover source below (or as the placeholder while a download is pending).
 let cover=make(&three,"MeshPhysicalMaterial",&[&object(&[("map",JsValue::NULL)])?])?;
 put(&s,"cover",&cover)?;
 // The clearcoat + relief program is costly to shade: views that only fly a book skip it unless the cover
 // already has a relief; shelf books keep cheap materials until a relief is selected.
 let armed=((detail||truthy(&inspection))&&truthy(eager))||truthy(&bread(book,"coverRelief")?);
 put(&s,"reliefArmed",&b(armed))?;
 put(&s,"coverFinishValue",&bread(book,"coverFinish")?)?;
 laminate(&s,&bread(book,"coverFinish")?)?;
 // Keep the broad studio reflection from washing out printed ink at an oblique angle.
 reflect(host,&cover,&[("seed",JsValue::from(format!("{surface_seed}|cover"))),("strength",n(0.018)),("environmentReflection",n(0.75))])?;
 put(&s,"reliefUniforms",&call(host,"installRelief",&[&cover])?)?;
 relief_base_finish(&s)?;
 if armed{put(&s,"reliefArmed",&JsValue::FALSE)?;book_model_arm_relief(&s)?;}
 // 224 threads per board height: below ~3 device pixels a thread the weave fades to a quiet tooth.
 let weave=crate::book_surface_policy::book_weave_strength(h,pixel_ratio());
 putn(&s,"weaveStrength",weave)?;
 if detail||truthy(&inspection){
  put(&cloth,"normalMap",&shared_built(host,"cloth",|host|book_model_tile_normals(host,"cloth"))?)?;
  call(&read(&read(&cloth,"normalMap")?,"repeat")?,"set",&[&n(14.0*ratio),&n(14.0)])?;
  call(&read(&cloth,"normalScale")?,"setScalar",&[&n(0.5*weave)])?;
 }
 put(&s,"coverGrain",&JsValue::NULL)?;
 put(&s,"coverSurfaceFinish",&call(host,"surfaceFinish",&[&bread(book,"coverFinish")?])?)?;
 let board=h*0.007;putn(&s,"board",board)?;
 let front_cover=make(&three,"Group",&[])?;
 named(&front_cover,"front-cover-hinge")?;
 // Rotate around the board's binding edge, not the page block's centre.
 set3(&front_cover,"position",-w/2.0,0.0,t/2.0-board/2.0)?;
 add(&group,&front_cover)?;put(&s,"frontCover",&front_cover)?;
 // Both boards and both ends of the binding, each array built once.
 let parts=case_parts(width,height,board,truthy(shelf),truthy(overview),thickness,num(&binding_segments),if truthy(overview){0.0}else{board*1.1})?;
 // Inside of the board: the cloth turns in over its edges, the endpaper is pasted down over the rest.
 let inside=make(&three,"MeshStandardMaterial",&[&object(&[("color",bread(style,"color")?),("roughness",n(0.9))])?])?;
 put(&inside,"visible",&JsValue::FALSE)?;put(&s,"insideCover",&inside)?;
 let front_geometry=parts.board(&three,true)?;
 let front_materials=list(&[&cover,&cloth,&inside]);put(&s,"frontMaterials",&front_materials)?;
 let front_board=mesh(&three,&front_geometry,if truthy(overview){&cover}else{&front_materials})?;
 named(&front_board,"front-cover")?;set3(&front_board,"position",w/2.0,0.0,0.0)?;
 add(&front_cover,&front_board)?;put(&s,"frontBoard",&front_board)?;
 // Pastedown: wove endpaper inside the cloth turn-ins, darker where it bends into the joint.
 let (turn_in,joint)=(h*0.028,h*0.004);
 let (paste_width,paste_height)=(w-turn_in-joint,h-turn_in*2.0);
 let paper_buffers=call(host,"paperBuffers",&[&n(paste_width),&n(paste_height),&n(w-h*0.009*2.0),&n(h-h*0.009*2.0),&n(h*0.009),overview])?;
 if !truthy(&paper_buffers){return Err(range("Medidas de guardas no válidas."));}
 let paste_geometry=book_paper_mesh(&three,&read(&paper_buffers,"pastedown")?)?;
 let endpaper_map=if truthy(overview){JsValue::NULL}else{shared_built(host,"endpaper",book_model_endpaper)?};
 let endpaper=make(&three,"MeshStandardMaterial",&[&object(&[("color",word("#ffffff")),("roughness",n(1.0)),("vertexColors",JsValue::TRUE),("map",endpaper_map)])?])?;
 let endpaper_map=get(&endpaper,"map");
 if !absent(&endpaper_map){call(&read(&endpaper_map,"repeat")?,"set",&[&n(3.0*paste_width/paste_height),&n(3.0)])?;}
 let pastedown=mesh(&three,&paste_geometry,&endpaper)?;
 named(&pastedown,"endpaper")?;putn(&read(&pastedown,"rotation")?,"y",PI)?;put(&pastedown,"visible",&JsValue::FALSE)?;
 set3(&pastedown,"position",-w/2.0+joint+paste_width/2.0,0.0,-board*0.54)?;
 add(&front_board,&pastedown)?;put(&s,"pastedown",&pastedown)?;
 // One material for face and edges: a single draw call per back board.
 let back_board=mesh(&three,&parts.board(&three,false)?,&cloth)?;
 named(&back_board,"back-cover")?;putn(&read(&back_board,"position")?,"z",-t/2.0+board/2.0)?;
 add(&group,&back_board)?;
 let inset=h*0.009;putn(&s,"inset",inset)?;
 let (edges,page_block)=if truthy(overview){
  // A thumbnail keeps a plain block and one tiny owned raster.
  let canvas=crate::host::method(&read(&crate::host::global(),"document")?,"createElement",&[&word("canvas")])?;
  putn(&canvas,"height",32.0)?;putn(&canvas,"width",32.0)?;
  crate::book_paint::book_thumbnail_pages(call(&canvas,"getContext",&[&word("2d")])?.unchecked_ref::<Canvas2d>());
  let map=make(&three,"CanvasTexture",&[&canvas])?;put(&map,"colorSpace",&read(&three,"SRGBColorSpace")?)?;
  let edges=make(&three,"MeshPhysicalMaterial",&[&object(&[("map",map),("roughness",n(1.0))])?])?;
  let block=mesh(&three,&make(&three,"BoxGeometry",&[&n(w-inset*2.0),&n(h-inset*2.0),&n(t-board*2.4)])?,&edges)?;
  set3(&block,"position",inset*0.3,0.0,0.0)?;add(&group,&block)?;
  (edges,block)
 }else{
  // One crescent-shaped block and one shared atlas: a single draw call.
  let size=if detail{512.0}else{256.0};
  let map=crate::book_model_policy::book_shared_texture_with(JsValue::from(format!("pages-{size}")),||book_model_page_edges(host,size))?;
  let edges=make(&three,"MeshPhysicalMaterial",&[&object(&[("map",map),("roughness",n(1.0)),("vertexColors",JsValue::TRUE)])?])?;
  let geometry=call(host,"pageBlock",&[width,height,thickness,&object(&[("board",n(board)),("inset",n(inset)),("detail",b(detail))])?])?;
  let block=mesh(&three,&geometry,&list(&[&edges]))?;
  add(&group,&block)?;
  (edges,block)
 };
 put(&s,"edges",&edges)?;
 apply_finish(&edges,finish(host,&bread(book,"pageEdgeFinish")?,&word("satin"))?,"paper",false)?;
 named(&page_block,"page-block")?;
 let (page_width,page_height)=(w-inset*2.0,h-inset*2.0);
 putn(&s,"pageWidth",page_width)?;putn(&s,"pageHeight",page_height)?;
 let page_front=t/2.0-board*1.2+board*0.03;
 // The paper runs on into the joint, where the leaf bends down into shade.
 let paper_geometry=book_paper_mesh(&three,&read(&paper_buffers,"paper")?)?;
 let page_paper=mesh(&three,&paper_geometry,&make(&three,"MeshBasicMaterial",&[&object(&[("color",word("#ffffff")),("toneMapped",JsValue::FALSE),("vertexColors",JsValue::TRUE)])?])?)?;
 set3(&page_paper,"position",inset*0.3-inset/2.0,0.0,page_front)?;
 // Fill depth with the opaque paper before shading the case beneath it.
 putn(&page_paper,"renderOrder",-2.0)?;put(&page_paper,"visible",&JsValue::FALSE)?;
 named(&page_paper,"reading-page-paper")?;add(&group,&page_paper)?;put(&s,"pagePaper",&page_paper)?;
 // The saved rasters stay resident for reopening, hidden behind the closed board by their common parent.
 let page_print=make(&three,"Group",&[])?;
 named(&page_print,"reading-page-print")?;put(&page_print,"visible",&JsValue::FALSE)?;add(&group,&page_print)?;
 put(&s,"pagePrint",&page_print)?;
 let page_material=make(&three,"MeshBasicMaterial",&[&object(&[("color",n(f64::from(0xffffffu32))),("toneMapped",JsValue::FALSE),("map",blank_page_map(&three)?),("transparent",JsValue::TRUE)])?])?;
 let page_image=mesh(&three,&make(&three,"PlaneGeometry",&[&n(page_width),&n(page_height)])?,&page_material)?;
 named(&page_image,"reading-page")?;
 set3(&page_image,"position",inset*0.3,0.0,page_front+board*0.02)?;
 put(&page_image,"visible",&JsValue::FALSE)?;add(&page_print,&page_image)?;
 put(&user,"pageSurface",&page_image)?;
 put(&s,"pageMaterial",&page_material)?;put(&s,"pageImage",&page_image)?;
 // The same page on white stock just behind the reader's own: the book opens and closes on white paper
 // and the reading theme fades over it (pageTheme 0 = white stock, 1 = the reader's theme).
 let stock_material=make(&three,"MeshBasicMaterial",&[&object(&[("color",n(f64::from(0xffffffu32))),("toneMapped",JsValue::FALSE),("map",blank_page_map(&three)?)])?])?;
 let stock_image=mesh(&three,&make(&three,"PlaneGeometry",&[&n(page_width),&n(page_height)])?,&stock_material)?;
 named(&stock_image,"reading-page-stock")?;
 set3(&stock_image,"position",inset*0.3,0.0,page_front+board*0.01)?;
 putn(&stock_image,"renderOrder",-1.0)?;put(&stock_image,"visible",&JsValue::FALSE)?;add(&page_print,&stock_image)?;
 put(&s,"stockMaterial",&stock_material)?;put(&s,"stockImage",&stock_image)?;
 for(key,value)in[("pageTheme",n(1.0)),("themeTone",JsValue::NULL),("stockTone",JsValue::NULL),("installedRaster",JsValue::NULL),
  ("paperScratch",make(&three,"Color",&[])?)]{put(&s,key,&value)?;}
 put(&user,"setPageTheme",&hosted(&s,"pageTheme")?)?;
 put(&user,"getPageTheme",&hosted(&s,"getPageTheme")?)?;
 put(&user,"getPageTextures",&own(&s,"book_model_page_textures",&[])?)?;
 put(&user,"setPageSnapshot",&own(&s,"book_model_page_snapshot",&[])?)?;
 let bookmark=call(host,"bookmarkFor",&[book])?;
 for(key,value)in[("bookmark",bookmark.clone()),("ribbonMaterial",JsValue::NULL),("ribbonMesh",JsValue::NULL),("coverOpening",n(0.0)),
  ("bookmarkWithdraw",n(0.0)),("clothColor",bread(style,"color")?)]{put(&s,key,&value)?;}
 if truthy(&bookmark){ribbon_mesh(&s)?;}
 // Lifted copies only: the leaves already read turn over with the board. Text paper is cooler and
 // smoother than the endpaper and, like the saved page beside it, skips tone mapping.
 let leaf_paper=if detail{
  let color=call(&make(&three,"Color",&[&n(f64::from(0xffffffu32))])?,"multiply",&[&read(host,"leafLight")?])?;
  let fields=[("color",color),("roughness",n(0.93)),("vertexColors",JsValue::TRUE),("map",shared_built(host,"endpaper",book_model_endpaper)?),("toneMapped",JsValue::FALSE)];
  make(&three,"MeshStandardMaterial",&[&object(&fields)?])?
 }else{JsValue::NULL};
 put(&s,"leafPaper",&leaf_paper)?;
 // Finer than the endpaper: the fibres shrink into the grain of a book paper.
 if !absent(&leaf_paper){call(&read(&read(&leaf_paper,"map")?,"repeat")?,"set",&[&n(6.0*w/h),&n(6.0)])?;}
 let read_leaves=if detail{
  let geometry=call(host,"leafStack",&[width,height,&n(leaf_depth(&s)?),&leaf_options(&s)?])?;
  mesh(&three,&geometry,&list(&[&leaf_paper,&edges]))?
 }else{JsValue::NULL};
 put(&s,"readLeaves",&read_leaves)?;
 if truthy(&read_leaves){named(&read_leaves,"read-leaves")?;put(&read_leaves,"visible",&JsValue::FALSE)?;add(&front_cover,&read_leaves)?;}
 // The joint grooves are pressed into the board artwork: no raised strips on the covers.
 let binding_geometry=call(host,"binding",&[width,height,thickness,&binding_segments,&read(&surface,"relief")?,&relief_rows])?;
 let binding_mesh=mesh(&three,&binding_geometry,&binding)?;
 named(&binding_mesh,"binding")?;add(&group,&binding_mesh)?;put(&s,"bindingMesh",&binding_mesh)?;
 let cap_materials=Array::new();put(&s,"capMaterials",&cap_materials)?;
 for y in[-h/2.0,h/2.0]{
  let material=make(&three,"MeshPhysicalMaterial",&[&object(&[("color",bread(style,"color")?),("side",read(&three,"DoubleSide")?)])?])?;
  cap_finish(&s,&material,book)?;
  let end=if y<0.0{"tail"}else{"head"};
  reflect(host,&material,&[("seed",JsValue::from(format!("{surface_seed}|{end}"))),("strength",n(0.01)),("uvScale",list(&[&n(1.0/w),&n(1.0/t)]))])?;
  let cap=mesh(&three,&parts.cap(&three)?,&material)?;
  named(&cap,if y<0.0{"binding-tail-cap"}else{"binding-head-cap"})?;
  cap_materials.push(&read(&cap,"material")?);
  putn(&read(&cap,"rotation")?,"x",PI/2.0)?;putn(&read(&cap,"position")?,"y",y)?;add(&group,&cap)?;
 }
 let noop=read(host,"noop")?;
 for(key,value)in[("coverRevision",n(0.0)),("currentCoverUrl",JsValue::UNDEFINED),("releaseImage",noop.clone()),("resolveCoverReady",noop),
  ("coverImageBounds",JsValue::NULL),("coverMaskSource",JsValue::NULL),("wantedRelief",JsValue::NULL),("reliefRevision",n(0.0)),
  ("reliefMaps",JsValue::NULL),("reliefOwned",Set::new(&JsValue::UNDEFINED).into()),("reliefController",JsValue::NULL),
  ("materialRevision",n(0.0))]{put(&s,key,&value)?;}
 // ---- cover relief: only the portable colour/tolerance/strength choice is saved; maps swap into slots
 // the cover material already compiled with, so selecting a relief links no program.
 put(&user,"coverRelief",&hosted(&s,"coverRelief")?)?;
 put(&user,"supportsCoverRelief",&JsValue::TRUE)?;
 put(&user,"prepareCoverRelief",&own(&s,"book_model_prepare_relief",&[])?)?;
 put(&user,"setCoverRelief",&hosted(&s,"setCoverRelief")?)?;
 put(&user,"updateCoverSource",&own(&s,"book_model_cover_source",&[])?)?;
 book_model_cover_source(&s,cover_url,&JsValue::UNDEFINED,&JsValue::UNDEFINED,&JsValue::UNDEFINED)?;
 if truthy(&bread(book,"coverRelief")?){call(&user,"setCoverRelief",&[&bread(book,"coverRelief")?])?;}
 // Only a download still in flight (or one that already failed) needs the generated case meanwhile.
 if !truthy(&get(&cover,"map")){
  put(&cover,"map",&cover_texture(host,&three,book,style,num(&state(&s,"textureHeight")),num(&state(&s,"maxTextureDimension")),&level)?)?;
  put(&cover,"needsUpdate",&JsValue::TRUE)?;
 }
 put(&user,"dispose",&own(&s,"book_model_dispose",&[])?)?;
 put(&user,"updateSpineAppearance",&own(&s,"book_model_spine_appearance",&[])?)?;
 put(&user,"updateCoverAppearance",&own(&s,"book_model_cover_appearance",&[])?)?;
 putn(&s,"ribbonBatch",0.0)?;put(&s,"ribbonDirty",&JsValue::FALSE)?;
 put(&user,"setCoverOpen",&hosted(&s,"coverOpen")?)?;
 put(&user,"setBookmarkWithdraw",&hosted(&s,"bookmarkWithdraw")?)?;
 put(&user,"setMotionPose",&hosted(&s,"motionPose")?)?;
 put(&user,"hasBookmark",&b(truthy(&bookmark)))?;
 put(&user,"updateBookmark",&own(&s,"book_model_update_bookmark",&[])?)?;
 put(&user,"updateEdgeAppearance",&own(&s,"book_model_edge_appearance",&[])?)?;
 if truthy(shelf)&&!truthy(overview){
  put(&user,"preparePresentation",&hosted(&s,"preparePresentation")?)?;
  put(&user,"prepareDetailPresentation",&hosted(&s,"prepareDetailPresentation")?)?;
 }
 Ok(group)
}
