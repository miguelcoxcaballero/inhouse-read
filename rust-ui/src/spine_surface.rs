//! The spine of a book as two rasters (colour, and packed height / roughness / metalness): how its
//! binding is set out, the lettering fitted to it and every canvas operation that paints them, in the
//! order of the original. Canvas contexts, the scratch pool, the cloth and weave painters, the
//! pseudo-random stream and the finish tables stay host-side and are called through `host`; the
//! three.js textures built from the two canvases stay in JavaScript.
use wasm_bindgen::prelude::*;
use js_sys::{Array,JsString,Number,Object,Reflect};
use crate::host::*;

type R<T>=Result<T,JsValue>;

#[wasm_bindgen]
extern "C"{#[wasm_bindgen(js_name=String)]fn string_of(value:&JsValue)->JsString;}

const BAND_HALF:f64=7.5;const SURFACE:f64=200.0;const RIDGE:f64=255.0;const BLIND:f64=150.0;
const PI:f64=std::f64::consts::PI;
const GOLD:[(f64,&str);7]=[(0.0,"#9c772c"),(0.16,"#cfab58"),(0.32,"#f0d994"),(0.45,"#c29944"),(0.6,"#e4c880"),(0.8,"#ad8437"),(1.0,"#8f6c29")];
const SILVER:[(f64,&str);7]=[(0.0,"#858d96"),(0.16,"#c1c7cd"),(0.32,"#edf0f3"),(0.45,"#a4abb3"),(0.6,"#d8dce1"),(0.8,"#959ca5"),(1.0,"#7e858e")];

#[inline(never)]
fn cat(parts:&[&str])->String{parts.concat()}
#[inline(never)]
fn rgb(r:&str,g:&str,b:&str)->String{cat(&["rgb(",r,",",g,",",b,")"])}
fn val(x:f64)->JsValue{JsValue::from_f64(x)}
fn txt(x:&str)->JsValue{JsValue::from_str(x)}
/// `Math.round`: halves go up.
fn jround(x:f64)->f64{if !x.is_finite(){return x;}let f=x.floor();if x-f>=0.5{f+1.0}else{f}}
/// A number the way a template literal prints it.
#[inline(never)]
fn show(x:f64)->String{Number::from(x).to_string(10).ok().and_then(|text|text.as_string()).unwrap_or_default()}
#[inline(never)]
fn object(entries:&[(&str,JsValue)])->R<JsValue>{let o=Object::new();for (key,value) in entries{Reflect::set(&o,&txt(key),value)?;}Ok(o.into())}
#[inline(never)]
fn pair(a:f64,b:f64)->JsValue{let list=Array::new();list.push(&val(a));list.push(&val(b));list.into()}
#[inline(never)]
fn list(items:&[f64])->JsValue{let out=Array::new();for item in items{out.push(&val(*item));}out.into()}
#[inline(never)]
fn num_args(c:&JsValue,name:&str,args:&[f64])->R<JsValue>{let values:Vec<JsValue>=args.iter().map(|x|val(*x)).collect();let refs:Vec<&JsValue>=values.iter().collect();method(c,name,&refs)}
fn undefined_or(value:&JsValue,fallback:f64)->f64{if value.is_undefined(){fallback}else{num(value)}}
fn document()->JsValue{get(&global(),"document")}
/// `Object.assign(document.createElement('canvas'), { width, height })`.
#[inline(never)]
fn canvas(width:f64,height:f64)->R<JsValue>{
 let node=method(&document(),"createElement",&[&txt("canvas")])?;
 set(&node,"width",&val(width))?;set(&node,"height",&val(height))?;Ok(node)
}
/// Attach colour stops; tolerant of partial canvas implementations.
#[inline(never)]
fn with_stops<S:AsRef<str>>(gradient:JsValue,stops:&[(f64,S)])->R<JsValue>{
 for (at,value) in stops{method_opt(&gradient,"addColorStop",&[&val(*at),&txt(value.as_ref())])?;}
 Ok(gradient)
}
#[inline(never)]
fn linear(c:&JsValue,x0:f64,y0:f64,x1:f64,y1:f64)->R<JsValue>{num_args(c,"createLinearGradient",&[x0,y0,x1,y1])}
#[inline(never)]
fn fill_rect(c:&JsValue,x:f64,y:f64,w:f64,h:f64)->R<()>{num_args(c,"fillRect",&[x,y,w,h])?;Ok(())}
#[inline(never)]
fn text_seed(text:&JsString)->u32{
 let mut h=2166136261u32;
 for i in 0..text.length(){h=(h^(text.char_code_at(i) as i64 as u32)).wrapping_mul(16777619);}
 h
}
#[inline(never)]
fn joined(parts:&[&JsValue])->JsString{let mut out=JsString::from("");for part in parts{out=out.concat(&string_of(part).into());}out}
/// The small deterministic stream of `seededRandom`.
struct Stream(u32);
impl Stream{
 fn new(seed:u32)->Stream{Stream(if seed==0{1}else{seed})}
 fn next(&mut self)->f64{
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
 let id=if absent(book){JsValue::UNDEFINED}else{let visual=read(book,"shelfVisualId")?;if absent(&visual){read(book,"id")?}else{visual}};
 let title=if absent(book){JsValue::UNDEFINED}else{read(book,"title")?};
 let blank=txt("");
 let seed=text_seed(&joined(&[&txt("layout|"),if absent(&id){&blank}else{&id},&txt("|"),if absent(&title){&blank}else{&title}]));
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

/// The layout as the plain object the callers read, keys in the original order.
#[wasm_bindgen]
pub fn spine_layout(book:&JsValue)->R<JsValue>{
 let layout=layout_of(book)?;
 let rules=Array::new();for (y,weight) in &layout.rules{rules.push(&pair(*y,*weight));}
 let mut entries:Vec<(&str,JsValue)>=vec![("kind",txt(layout.kind)),("bands",list(&layout.bands))];
 if layout.foot_author{entries.push(("footAuthor",JsValue::TRUE));}
 if let Some((a,b))=layout.panel{entries.push(("panel",pair(a,b)));}
 if let Some(device)=layout.device{entries.push(("device",val(device)));entries.push(("deviceAt",val(layout.device_at)));}
 entries.push(("rules",rules.into()));entries.push(("span",pair(layout.span.0,layout.span.1)));
 object(&entries)
}

/// A small printer's device, centred on (0, 0) in design units.
#[wasm_bindgen]
pub fn draw_device(c:&JsValue,kind:&JsValue,size:&JsValue)->R<()>{
 let size=num(size);
 if kind.as_f64()==Some(0.0){
  // Lozenge between two short rules.
  method(c,"save",&[])?;num_args(c,"rotate",&[PI/4.0])?;fill_rect(c,-size*0.32,-size*0.32,size*0.64,size*0.64)?;method(c,"restore",&[])?;
  fill_rect(c,-size*1.35,-size*0.06,size*0.75,size*0.12)?;fill_rect(c,size*0.6,-size*0.06,size*0.75,size*0.12)?;
 }else if kind.as_f64()==Some(1.0){
  // Ring with a dot: a colophon.
  method(c,"beginPath",&[])?;num_args(c,"arc",&[0.0,0.0,size*0.62,0.0,PI*2.0])?;
  method(c,"arc",&[&val(0.0),&val(0.0),&val(size*0.47),&val(0.0),&val(PI*2.0),&JsValue::TRUE])?;method(c,"fill",&[])?;
  method(c,"beginPath",&[])?;num_args(c,"arc",&[0.0,0.0,size*0.16,0.0,PI*2.0])?;method(c,"fill",&[])?;
 }else{
  // Three dots, as a printer's mark.
  for (x,y) in [(0.0,-size*0.34),(-size*0.36,size*0.26),(size*0.36,size*0.26)]{
   method(c,"beginPath",&[])?;num_args(c,"arc",&[x,y,size*0.15,0.0,PI*2.0])?;method(c,"fill",&[])?;
  }
 }
 Ok(())
}

/// Low-frequency variation from a tiny random raster, upscaled in one pass. soft-light around mid-grey
/// mottles colour; 'lighter' with a single channel adds to one PBR channel.
#[wasm_bindgen]
pub fn paint_field(c:&JsValue,width:&JsValue,height:&JsValue,random:&JsValue,options:&JsValue)->R<()>{
 paint_field_with(c,width,height,options,||Ok(num(&call(random,"random",&[])?)))
}
#[wasm_bindgen]
pub fn paint_field_seeded(c:&JsValue,width:&JsValue,height:&JsValue,seed:u32,options:&JsValue)->Array{
 let mut stream=Stream(seed);
 let result=paint_field_with(c,width,height,options,||Ok(stream.next()));
 let output=Array::new();output.push(&val(stream.0 as f64));output.push(&JsValue::from_bool(result.is_ok()));
 output.push(&result.err().unwrap_or(JsValue::UNDEFINED));output
}
fn paint_field_with<F:FnMut()->R<f64>>(c:&JsValue,width:&JsValue,height:&JsValue,options:&JsValue,mut next:F)->R<()>{
 let pick=|key:&str|->R<JsValue>{if options.is_undefined(){Ok(JsValue::UNDEFINED)}else{read(options,key)}};
 let operation=pick("operation")?;let operation=if operation.is_undefined(){txt("soft-light")}else{operation};
 let spread=pick("spread")?;let spread=undefined_or(&spread,40.0);
 let channel=pick("channel")?;let channel=if channel.is_undefined(){JsValue::NULL}else{channel};
 let cells=pick("cells")?;let (cw,ch)=if cells.is_undefined(){(9.0,30.0)}else{(num(&get_at(&cells,0)),num(&get_at(&cells,1)))};
 let field=canvas(cw,ch)?;
 // One pixel write for the whole field; per-cell fillRect parsed hundreds of colour strings for every book.
 let f=method(&field,"getContext",&[&txt("2d")])?;
 let image=method_opt(&f,"createImageData",&[&val(cw),&val(ch)])?.unwrap_or(JsValue::UNDEFINED);
 let data=if absent(&image){JsValue::UNDEFINED}else{read(&image,"data")?};
 // Real ImageData uses one bulk copy instead of four JS property writes per pixel.
 let typed=data.dyn_ref::<js_sys::Uint8ClampedArray>();
 let mut pixels=typed.map(|array|array.to_vec());
 let mut i=0.0;
 while i<cw*ch{
  let r=next()?;
  let v=if truthy(&channel){jround(r*spread)}else{
   let r=r-0.5;jround(128.0+r*2.0*spread)};
  if truthy(&data){
   let z=if truthy(&channel){0.0}else{v};
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
 if truthy(&data){method(&f,"putImageData",&[&image,&val(0.0),&val(0.0)])?;}
 method(c,"save",&[])?;set(c,"globalCompositeOperation",&operation)?;set(c,"imageSmoothingEnabled",&JsValue::TRUE)?;
 set(c,"imageSmoothingQuality",&txt("high"))?;method(c,"drawImage",&[&field,&val(0.0),&val(0.0),width,height])?;method(c,"restore",&[])?;
 Ok(())
}

fn foil_gradient(context:&JsValue,width:f64,finish:&str)->R<JsValue>{
 with_stops(linear(context,0.0,0.0,width,0.0)?,if finish=="silver"{&SILVER}else{&GOLD})
}

/// Baked shading only for features fixed to the book: band ridges, a blind panel, the joint creases
/// beside both boards and the rubbed head and tail.
fn paint_relief(c:&JsValue,design_width:f64,random:&JsValue,layout:&Layout,wear:bool)->R<()>{
 for y in &layout.bands{
  let y=*y;
  set(c,"fillStyle",&with_stops(linear(c,0.0,y-BAND_HALF-2.0,0.0,y+BAND_HALF+3.0)?,&[(0.0,"rgba(0,0,0,0)"),(0.1,"rgba(255,250,240,.2)"),(0.42,"rgba(255,250,240,.08)"),
   (0.62,"rgba(0,0,0,.1)"),(0.9,"rgba(0,0,0,.3)"),(1.0,"rgba(0,0,0,0)")])?)?;
  fill_rect(c,0.0,y-BAND_HALF-2.0,design_width,BAND_HALF*2.0+5.0)?;
 }
 if let Some((top,bottom))=layout.panel{
  // Blind tooling: the pressed line's far wall is lit, its floor in shade.
  let x=design_width*0.17;let w=design_width*0.66;
  set(c,"lineWidth",&val(2.2))?;set(c,"strokeStyle",&txt("rgba(0,0,0,.24)"))?;num_args(c,"strokeRect",&[x,top,w,bottom-top])?;
  set(c,"lineWidth",&val(1.0))?;set(c,"strokeStyle",&txt("rgba(255,250,240,.12)"))?;num_args(c,"strokeRect",&[x+1.6,top+1.6,w,bottom-top])?;
 }
 let joint=design_width*0.085;
 for (from,to) in [(0.0,joint),(design_width,design_width-joint)]{
  set(c,"fillStyle",&with_stops(linear(c,from,0.0,to,0.0)?,&[(0.0,"rgba(0,0,0,.26)"),(0.4,"rgba(0,0,0,.08)"),(1.0,"rgba(0,0,0,0)")])?)?;
  fill_rect(c,jmin(from,to),0.0,joint,1024.0)?;
 }
 for (from,to) in [(0.0,16.0),(1024.0,1008.0)]{
  set(c,"fillStyle",&with_stops(linear(c,0.0,from,0.0,to)?,&[(0.0,"rgba(0,0,0,.34)"),(0.35,"rgba(0,0,0,.12)"),(1.0,"rgba(0,0,0,0)")])?)?;
  fill_rect(c,0.0,jmin(from,to),design_width,16.0)?;
  // Rubbed cloth at the very edge shows paler fibres in short patches.
  if wear{
   let mut x=0.0;
   while x<design_width{
    let length=4.0+num(&call(random,"random",&[])?)*22.0;
    set(c,"fillStyle",&txt(&cat(&["rgba(255,246,228,",&show(num(&call(random,"random",&[])?)*0.16),")"])))?;
    fill_rect(c,x,if from!=0.0{1021.2}else{0.0},length,2.8)?;x+=length;
   }
  }
 }
 Ok(())
}

#[inline(never)]
fn flag(options:&JsValue,key:&str,fallback:&JsValue)->R<JsValue>{
 let value=if options.is_undefined(){JsValue::UNDEFINED}else{read(options,key)?};
 Ok(if value.is_undefined(){fallback.clone()}else{value})
}

/// Colour and packed rasters of one spine, plus the numbers its material needs. `host` supplies the
/// scratch pool (`scratch`), `author`, `spineFinish`, `surface` (the finish row of a surface name),
/// `random` (the book's stream), `paintCloth` and `paintWeave`.
#[wasm_bindgen]
pub fn spine_surface(book:&JsValue,style:&JsValue,physical_height:&JsValue,thickness:&JsValue,options:&JsValue,host:&JsValue)->R<JsValue>{
 let physical_height=undefined_or(physical_height,200.0);let thickness=undefined_or(thickness,32.0);
 let tw=flag(options,"textureWidth",&val(512.0))?;let th=flag(options,"textureHeight",&val(2048.0))?;
 let engraving=flag(options,"engraving",&JsValue::TRUE)?;let level=flag(options,"level",&txt("detail"))?;
 let pick=|v:f64,fallback:f64|->f64{if v==0.0||v.is_nan(){fallback}else{v}};
 let width=jmax(1.0,jround(pick(num(&tw),512.0)));let height=jmax(1.0,jround(pick(num(&th),2048.0)));
 let design_width=jmax(80.0,thickness/physical_height*1024.0*PI/2.0);
 let to_design=|context:&JsValue|->R<()>{method_opt(context,"setTransform",&[&val(width/design_width),&val(0.0),&val(0.0),&val(height/1024.0),&val(0.0),&val(0.0)])?;Ok(())};
 let engraved=truthy(&engraving)&&read(book,"spineEngraved")?.as_bool()==Some(true);
 // Relief is sampled on the CPU: keep that raster off the GPU so reading it back does not stall on a
 // full GPU flush (seconds on software renderers).
 let attributes=if engraved{object(&[("willReadFrequently",JsValue::TRUE)])?}else{JsValue::UNDEFINED};
 let scratch=call(&read(host,"scratch")?,"scratch",&[&txt(if engraved{"relief-mask"}else{"mask"}),&val(width),&val(height),&attributes])?;
 let (mask,c)=(read(&scratch,"canvas")?,read(&scratch,"context")?);
 to_design(&c)?;set(&c,"fillStyle",&txt("#fff"))?;set(&c,"textAlign",&txt("center"))?;set(&c,"textBaseline",&txt("middle"))?;
 let layout=layout_of(book)?;let (top,bottom)=layout.span;
 let family_name=read(style,"fontCanvasFamily")?;let family_name=if truthy(&family_name){family_name}else{let v=read(style,"fontFamily")?;if truthy(&v){v}else{txt("Playfair Display")}};
 let fallback=read(style,"fontFallback")?;let fallback=if truthy(&fallback){fallback}else{txt("Georgia, serif")};
 let family=cat(&["\"",&txt_of(&family_name),"\", ",&txt_of(&fallback)]);
 let font_size=num(&read(style,"spineFontSize")?);
 let mut size=jmin(design_width*0.9,64.0*pick(font_size,10.0)/10.0);
 let override_title=read(book,"spineTitleOverride")?;
 let mut title=if truthy(&override_title){string_of(&override_title)}else{let t=read(book,"title")?;if truthy(&t){string_of(&t)}else{JsString::from("Sin título")}};
 let author:Option<JsString>=if num(&read(style,"width")?)>=32.0{
  let name=call(&read(host,"author")?,"author",&[&read(book,"author")?])?;
  if truthy(&name){Some(string_of(&name))}else{None}
 }else{None};
 let author_size=if author.is_some(){jmin(design_width*0.82,28.0*pick(num(&read(style,"spineAuthorFontSize")?),12.0)/12.0)}else{0.0};
 let set_font=|size:f64|->R<()>{
  let weight=read(style,"fontWeight")?;let weight=if truthy(&weight){weight}else{val(700.0)};
  set(&c,"font",&txt(&cat(&[&txt_of(&weight)," ",&show(size),"px ",&family])))
 };
 let set_author_font=||->R<()>{set(&c,"font",&txt(&cat(&["500 ",&show(author_size),"px \"DM Sans\", sans-serif"])))};
 let width_of=|text:&JsString|->R<f64>{Ok(num(&read(&method(&c,"measureText",&[text.as_ref()])?,"width")?))};
 // Fit by font size, never by non-uniform fillText(maxWidth) compression.
 let fit=|title:&JsString,size:&mut f64,limit:f64|->R<bool>{
  set_font(*size)?;
  while width_of(title)?>limit&&*size>44.0{*size-=1.0;set_font(*size)?;}
  Ok(width_of(title)?<=limit)
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
  while title.length()>1&&width_of(&title.concat(&txt("…")))?>length{title=title.slice(0,title.length()-1);}
  title=title.trim_end().concat(&txt("…"));
 }
 // Text runs head to tail: x along the spine, y across it.
 method(&c,"save",&[])?;num_args(&c,"translate",&[design_width/2.0,0.0])?;num_args(&c,"rotate",&[PI/2.0])?;
 if foot!=0.0&&!foot.is_nan(){
  method(&c,"fillText",&[title.as_ref(),&val(top+length/2.0),&val(0.0)])?;
  set_author_font()?;method(&c,"fillText",&[author.as_ref().unwrap().as_ref(),&val(bottom-foot/2.0),&val(0.0)])?;
 }else{
  // Title and author are parallel on the curved spine. Position them as one compact group, centered
  // across its width, instead of pinning them to opposite edges.
  let center=(top+bottom)/2.0;
  let label_gap=if author.is_some(){jmax(1.5,jmin(3.0,size*0.045))}else{0.0};
  method(&c,"fillText",&[title.as_ref(),&val(center),&val(if author.is_some(){-(author_size+label_gap)/2.0}else{0.0})])?;
  if let Some(author)=&author{
   set_author_font()?;
   let mut name=author.clone();
   while name.length()>1&&width_of(&name)?>length-60.0{name=name.slice(0,name.length()-1);}
   method(&c,"fillText",&[name.as_ref(),&val(center),&val((size+label_gap)/2.0)])?;
  }
 }
 method(&c,"restore",&[])?;
 // Stamped rules stop short of the joints, like a real brass tool.
 for (y,weight) in &layout.rules{fill_rect(&c,design_width*0.13,y-weight/2.0,design_width*0.74,*weight)?;}
 if let Some(device)=layout.device{
  method(&c,"save",&[])?;num_args(&c,"translate",&[design_width/2.0,layout.device_at])?;
  draw_device(&c,&val(device),&val(jmin(design_width*0.24,26.0)))?;method(&c,"restore",&[])?;
 }

 let spine_finish=read(host,"spineFinish")?;
 let binding_finish=txt_of(&call(&spine_finish,"spineFinish",&[&read(book,"spineFinish")?])?);
 let text_finish=txt_of(&call(&spine_finish,"spineFinish",&[&read(book,"spineTextFinish")?])?);
 let metal_binding=binding_finish!="matte";let metal_text=text_finish!="matte";
 let blank=txt("");
 let visual=read(book,"shelfVisualId")?;
 let (id,book_title)=(if absent(&visual){read(book,"id")?}else{visual},read(book,"title")?);
 let cloth_seed=text_seed(&joined(&[if absent(&id){&blank}else{&id},&txt("|"),if absent(&book_title){&blank}else{&book_title},&txt("|"),&read(style,"color")?]));
 let random=call(&read(host,"random")?,"random",&[&val(f64::from(cloth_seed))])?;
 let color=canvas(width,height)?;let ctx=method(&color,"getContext",&[&txt("2d")])?;
 let fill=if metal_binding{foil_gradient(&ctx,width,&binding_finish)?}else{read(style,"color")?};
 set(&ctx,"fillStyle",&fill)?;
 fill_rect(&ctx,0.0,0.0,width,height)?;
 to_design(&ctx)?;
 let thumb=level.as_string().as_deref()==Some("overview");let woven=level.as_string().as_deref()==Some("detail")&&!metal_binding;
 let opts=object(&[("threads",JsValue::from_bool(!thumb)),("metal",JsValue::from_bool(metal_binding))])?;
 call(&read(host,"paintCloth")?,"paintCloth",&[&ctx,&val(design_width),&random,&opts])?;
 // Close up the spine is the same woven cloth as the cover beside it.
 if woven{call(&read(host,"paintWeave")?,"paintWeave",&[&ctx,&val(design_width)])?;}
 paint_relief(&ctx,design_width,&random,&layout,!thumb)?;
 method_opt(&ctx,"setTransform",&[&val(1.0),&val(0.0),&val(0.0),&val(1.0),&val(0.0),&val(0.0)])?;
 let scratch=call(&read(host,"scratch")?,"scratch",&[&txt("ink"),&val(width),&val(height)])?;
 let (ink,ic)=(read(&scratch,"canvas")?,read(&scratch,"context")?);
 // Tint the glyph mask (optionally only the strip a shifted copy leaves uncovered, i.e. one wall of
 // each stroke) and lay it on the cloth.
 let stamp=|fill:&JsValue,offset:f64|->R<()>{
  set(&ic,"globalCompositeOperation",&txt("source-over"))?;num_args(&ic,"clearRect",&[0.0,0.0,width,height])?;method(&ic,"drawImage",&[&mask,&val(0.0),&val(0.0)])?;
  if offset!=0.0&&!offset.is_nan(){set(&ic,"globalCompositeOperation",&txt("destination-out"))?;method(&ic,"drawImage",&[&mask,&val(0.0),&val(offset)])?;}
  set(&ic,"globalCompositeOperation",&txt("source-in"))?;set(&ic,"fillStyle",fill)?;fill_rect(&ic,0.0,0.0,width,height)?;
  method(&ctx,"drawImage",&[&ink,&val(0.0),&val(0.0)])?;Ok(())
 };
 let first=if metal_text{foil_gradient(&ic,width,&text_finish)?}else{read(style,"ink")?};
 stamp(&first,0.0)?;
 if engraved{
  // Debossed walls: the upper wall of each stroke falls into shadow, the lower one catches the shelf
  // light. Visible even at shelf mip levels.
  let step=jmax(1.0,height/1024.0*1.8);
  stamp(&txt("rgba(0,0,0,.5)"),step)?;stamp(&txt("rgba(255,250,236,.24)"),-step)?;
 }

 // R = surface height, G = roughness, B = metalness. Linear, never sRGB.
 let packed=canvas(width,height)?;let pc=method(&packed,"getContext",&[&txt("2d")])?;
 let surface=call(&read(host,"surface")?,"surface",&[&read(book,"spineSurfaceFinish")?])?;
 let binding_roughness=jround(num(&read(&surface,"roughness")?)*255.0);let metal=if metal_binding{255.0}else{0.0};
 set(&pc,"fillStyle",&txt(&rgb(&show(SURFACE),&show(jmax(0.0,binding_roughness-12.0)),&show(metal))))?;fill_rect(&pc,0.0,0.0,width,height)?;
 to_design(&pc)?;
 // Dye and handling leave the cloth unevenly burnished: roughness mottling. Foil is near-mirror: any
 // mottle there reads as hammered metal.
 if !metal_binding&&!thumb{
  let field=object(&[("operation",txt("lighter")),("spread",val(24.0)),("channel",txt("g")),("cells",pair(7.0,24.0))])?;
  call(&read(host,"paintField")?,"paintField",&[&pc,&val(design_width),&val(1024.0),&random,&field])?;
 }
 let ridge=|h:f64|->String{rgb(&show(h),&show(binding_roughness),&show(metal))};
 for y in &layout.bands{
  let y=*y;
  set(&pc,"fillStyle",&with_stops(linear(&pc,0.0,y-BAND_HALF,0.0,y+BAND_HALF)?,&[(0.0,&ridge(SURFACE)),(0.4,&ridge(RIDGE)),(0.6,&ridge(RIDGE)),(1.0,&ridge(SURFACE))])?)?;
  fill_rect(&pc,0.0,y-BAND_HALF,design_width,BAND_HALF*2.0)?;
 }
 if let Some((top,bottom))=layout.panel{
  set(&pc,"lineWidth",&val(2.2))?;set(&pc,"strokeStyle",&txt(&ridge(BLIND)))?;
  num_args(&pc,"strokeRect",&[design_width*0.17,top,design_width*0.66,bottom-top])?;
 }
 method_opt(&pc,"setTransform",&[&val(1.0),&val(0.0),&val(0.0),&val(1.0),&val(0.0),&val(0.0)])?;
 set(&ic,"globalCompositeOperation",&txt("source-over"))?;num_args(&ic,"clearRect",&[0.0,0.0,width,height])?;
 method(&ic,"drawImage",&[&mask,&val(0.0),&val(0.0)])?;set(&ic,"globalCompositeOperation",&txt("source-in"))?;
 // Foil is always pressed slightly into the cloth; "grabado" goes deep.
 let letter_height=if engraved{110.0}else if metal_text{184.0}else{SURFACE};
 set(&ic,"fillStyle",&txt(&rgb(&show(letter_height),if metal_text{"66"}else{"230"},if metal_text{"255"}else{"0"})))?;
 fill_rect(&ic,0.0,0.0,width,height)?;method(&pc,"drawImage",&[&ink,&val(0.0),&val(0.0)])?;
 // The threads show mostly as relief and burnish, not as a printed grid.
 if woven{
  to_design(&pc)?;
  call(&read(host,"paintWeave")?,"paintWeave",&[&pc,&val(design_width),&object(&[("channels",JsValue::TRUE)])?])?;
 }
 // three's bump is screen-space: a close-up band spans many pixels and needs a large scale; shelf copies
 // keep the tiny legacy value for engraving only.
 let bump=if level.as_string().as_deref()==Some("detail"){2.6}else if engraved{0.035}else{0.0};
 let mut relief=JsValue::NULL;
 if engraved{
  let scratch=call(&read(host,"scratch")?,"scratch",&[&txt("relief-sample"),&val(256.0),&val(1024.0),&object(&[("willReadFrequently",JsValue::TRUE)])?])?;
  let sc=read(&scratch,"context")?;
  set(&sc,"filter",&txt("blur(1.2px)"))?;method(&sc,"drawImage",&[&mask,&val(0.0),&val(0.0),&val(256.0),&val(1024.0)])?;
  relief=read(&method(&sc,"getImageData",&[&val(0.0),&val(0.0),&val(256.0),&val(1024.0)])?,"data")?;
 }
 let metallic=metal_binding||metal_text;
 // Cloth scatters a soft rim of light at grazing angles; foil does not. A shelf spine is a few dozen
 // pixels wide: the sheen lobe is invisible there but costs its BRDF and image-based term on every
 // pixel of every repaint.
 let sheen=if metal_binding||level.as_string().as_deref()!=Some("detail"){0.0}else{0.55};
 object(&[("color",color),("packed",packed),("relief",relief),("bump",val(bump)),("sheen",val(sheen)),
  ("envMapIntensity",val(num(&read(&surface,"envMapIntensity")?)*if metallic{1.2}else{0.9})),
  ("anisotropy",val(if metallic{0.35}else{0.0})),("clearcoat",read(&surface,"clearcoat")?),("clearcoatRoughness",read(&surface,"clearcoatRoughness")?)])
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

/// Arbitrary callbacks and unusual widths retain the original draw order in
/// Rust too. Normal owned streams use the batched numeric core plan.
#[wasm_bindgen]
pub fn paint_cloth_callback(c:&JsValue,width:f64,random:&JsValue,metal:bool)->R<()>{
 let cells=pair(js_sys::Math::max(4.0,js_sys::Math::round(width/34.0)),30.0);
 let options=object(&[("operation",txt("soft-light")),("spread",val(if metal{5.0}else{9.0})),("cells",cells)])?;
 paint_field(c,&val(width),&val(1024.0),random,&options)?;
 let next=||->R<f64>{Ok(num(&call(random,"random",&[])?))};
 for _ in 0..if metal{40}else{110}{
  let y=next()?*1024.0;let x=next()?*width*0.7;let length=width*(0.2+next()?*0.6);
  let light=next()?>0.45;
  let alpha=if light{0.012+next()?*0.03}else{0.015+next()?*0.035};
  let color=cat(&[if light{"rgba(255,248,235,"}else{"rgba(0,0,0,"},&show(alpha),")"]);
  set(c,"fillStyle",&txt(&color))?;let height=0.5+next()?*0.8;fill_rect(c,x,y,length,height)?;
 }
 if !metal{for _ in 0..26{
  let x=next()?*width;let y=next()?*900.0;let length=60.0+next()?*380.0;
  let light=next()?>0.5;let alpha=if light{0.012+next()?*0.025}else{0.015+next()?*0.03};
  let color=cat(&[if light{"rgba(255,248,235,"}else{"rgba(0,0,0,"},&show(alpha),")"]);
  set(c,"fillStyle",&txt(&color))?;let thickness=0.5+next()?*0.7;fill_rect(c,x,y,thickness,length)?;
 }}
 Ok(())
}
