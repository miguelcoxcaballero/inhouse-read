//! Immutable studio-shell colors. Positions are the host's existing Float32
//! sphere vertices; interpolation retains Three's f64 operation order. Also the
//! shared renderer's set-up and the studio room it bakes (studio_renderer_create).
use std::cell::RefCell;
use wasm_bindgen::{prelude::*,JsCast};
use crate::host::{absent,method,method_opt,read,set,truthy};
fn smoothstep(mut x:f64,min:f64,max:f64)->f64{
 if x<=min{return 0.0;}if x>=max{return 1.0;}
 x=(x-min)/(max-min);x*x*(3.0-2.0*x)
}
#[wasm_bindgen]
pub fn studio_shell_colors(positions:&[f32])->Result<Vec<f32>,JsValue>{
 if positions.len()%3!=0{return Err(js_sys::TypeError::new("Studio positions must contain complete vertices").into());}
 let floor=[0.068,0.05,0.037];let wall=[0.34,0.315,0.288];let ceiling=[0.5,0.485,0.46];
 let mut colors=vec![0.0;positions.len()];
 for (vertex,color) in positions.chunks_exact(3).zip(colors.chunks_exact_mut(3)){
  let y=f64::from(vertex[1])/10.0;
  let low=smoothstep(y,-0.32,-0.02);let high=smoothstep(y,0.3,0.85);
  for channel in 0..3{
   let base=floor[channel]+(wall[channel]-floor[channel])*low;
   color[channel]=(base+(ceiling[channel]-base)*high)as f32;
  }
 }
 Ok(colors)
}

/// `new THREE[name](...args)`.
fn three_new(three:&JsValue,name:&str,args:&[&JsValue])->Result<JsValue,JsValue>{
 let constructor:js_sys::Function=read(three,name)?.dyn_into().map_err(|_|js_sys::TypeError::new(&format!("THREE.{name} is not a constructor")))?;
 let list=js_sys::Array::new();for argument in args{list.push(argument);}
 js_sys::Reflect::construct(&constructor,&list)
}
fn n(value:f64)->JsValue{JsValue::from_f64(value)}
fn options(entries:&[(&str,&JsValue)])->Result<JsValue,JsValue>{
 let object:JsValue=js_sys::Object::new().into();
 for (key,value) in entries{set(&object,key,value)?;}Ok(object)
}

/// The shared renderer's set-up, once per context (src/js/studio-renderer.js keeps the per-renderer table):
/// the renderer with its colour space, tone mapping and shadows, then the studio it reflects, from the
/// device's saved atlas when there is one and otherwise baked from its room. Any failure releases the
/// renderer and answers null, as the original's catch did. `hooks` holds the other modules' functions; the
/// host has already checked that the page has WebGL.
#[wasm_bindgen]
pub fn studio_renderer_create(three:JsValue,preserve_drawing_buffer:JsValue,hooks:JsValue)->Result<JsValue,JsValue>{
 let made=RefCell::new(JsValue::UNDEFINED);
 let built=(||->Result<(JsValue,JsValue),JsValue>{
  // Snapshot consumers copy immediately after rendering. The presentation canvas preserves its last
  // displayed frame for a later snapshot request. Every consumer (bookView, the shelf and its insertion
  // overlay) sets its own pixel ratio and size before drawing, so no oversized buffer is allocated up front.
  let renderer=three_new(&three,"WebGLRenderer",&[&options(&[("alpha",&JsValue::TRUE),("antialias",&JsValue::TRUE),
   ("preserveDrawingBuffer",&preserve_drawing_buffer)])?])?;
  *made.borrow_mut()=renderer.clone();
  method(&hooks,"configureShaderDiagnostics",&[&renderer])?;
  set(&renderer,"outputColorSpace",&read(&three,"SRGBColorSpace")?)?;
  // Preserve print colours and gently compress real specular highlights. Unmapped studio radiance used
  // to clip RGB channels on bright jackets.
  set(&renderer,"toneMapping",&read(&three,"NeutralToneMapping")?)?;
  set(&renderer,"toneMappingExposure",&n(1.0))?;
  // Its toe pulls the weakest channel of every dark tone to zero, which turns walnut and deep bookcloth
  // orange and crushes navy. A smoothstep toe keeps the black point, the join at 0.08 and the highlight
  // curve. Patched once before any program compiles; a later three skips it.
  let toe:JsValue="float offset = x < 0.08 ? x - 6.25 * x * x : 0.04;".into();
  let chunks=read(&three,"ShaderChunk")?;
  let tonemap=read(&chunks,"tonemapping_pars_fragment")?;
  if !absent(&tonemap)&&truthy(&method(&tonemap,"includes",&[&toe])?){
   set(&chunks,"tonemapping_pars_fragment",&method(&tonemap,"replace",&[&toe,
    &"float toe = min( x / 0.08, 1.0 ); float offset = 0.04 * toe * toe * ( 3.0 - 2.0 * toe );".into()])?)?;
  }
  let shadows=read(&renderer,"shadowMap")?;
  set(&shadows,"enabled",&JsValue::TRUE)?;
  // Variance shadows: one 1024 map with a wide, smooth interior penumbra. Its blur runs only when the
  // scene requests a shadow refresh.
  set(&shadows,"type",&read(&three,"VSMShadowMap")?)?;
  set(&shadows,"autoUpdate",&JsValue::FALSE)?;
  let mut environment=method(&hooks,"cachedStudioEnvironment",&[])?;
  if !truthy(&environment){environment=bake_room(&three,&renderer,&hooks)?;}
  method(&hooks,"keepProgramsAlive",&[&renderer])?;
  Ok((renderer,environment))
 })();
 match built{
  Ok((renderer,environment))=>options(&[("renderer",&renderer),("environment",&environment)]),
  Err(_)=>{
   let renderer=made.borrow().clone();
   if !absent(&renderer){method_opt(&renderer,"dispose",&[])?;}
   Ok(JsValue::NULL)
  }
 }
}

/// A quiet reading room instead of a grey photo studio: plaster walls, a walnut floor, a tall window high
/// on the left (the key's direction) and a warm lamp on the right. Satin wood and laminates reflect real
/// shapes. The objects are made in the original's order, so three numbers them identically.
fn bake_room(three:&JsValue,renderer:&JsValue,hooks:&JsValue)->Result<JsValue,JsValue>{
 let room=three_new(three,"Scene",&[])?;
 let shell=three_new(three,"SphereGeometry",&[&n(10.0),&n(48.0),&n(24.0)])?;
 // Near-neutral surfaces: the warmth belongs to the key and the lamp, so shadows stay natural instead of
 // turning every material orange.
 let positions:js_sys::Float32Array=read(&read(&read(&shell,"attributes")?,"position")?,"array")?.dyn_into()?;
 let colors=js_sys::Float32Array::from(studio_shell_colors(&positions.to_vec())?.as_slice());
 method(&shell,"setAttribute",&[&"color".into(),&three_new(three,"BufferAttribute",&[&colors,&n(3.0)])?])?;
 let walls=three_new(three,"MeshBasicMaterial",&[&options(&[("vertexColors",&JsValue::TRUE),("side",&read(three,"BackSide")?)])?])?;
 method(&room,"add",&[&three_new(three,"Mesh",&[&shell,&walls])?])?;
 let glow=|geometry:JsValue,rgb:[f64;3],strength:f64,position:[f64;3]|->Result<JsValue,JsValue>{
  let color=three_new(three,"Color",&[&n(rgb[0]),&n(rgb[1]),&n(rgb[2])])?;
  let color=method(&color,"multiplyScalar",&[&n(strength)])?;
  let material=three_new(three,"MeshBasicMaterial",&[&options(&[("color",&color),("side",&read(three,"DoubleSide")?)])?])?;
  let mesh=three_new(three,"Mesh",&[&geometry,&material])?;
  method(&read(&mesh,"position")?,"set",&[&n(position[0]),&n(position[1]),&n(position[2])])?;
  method(&mesh,"lookAt",&[&n(0.0),&n(0.0),&n(0.0)])?;method(&room,"add",&[&mesh])?;Ok(mesh)
 };
 let plane=|width:f64,height:f64|three_new(three,"PlaneGeometry",&[&n(width),&n(height)]);
 let pane=glow(plane(4.6,5.8)?,[1.0,0.98,0.95],6.5,[-3.6,3.9,7.8])?;
 // Mullions break the reflection into panes, as a real window would.
 for [width,height,x,y] in [[0.16,5.8,0.0,0.0],[4.6,0.14,0.0,0.5]]{
  let geometry=plane(width,height)?;
  let material=three_new(three,"MeshBasicMaterial",&[&options(&[("color",&n(f64::from(0x2a2119))),("side",&read(three,"DoubleSide")?)])?])?;
  let bar=three_new(three,"Mesh",&[&geometry,&material])?;
  method(&read(&bar,"position")?,"set",&[&n(x),&n(y),&n(0.02)])?;method(&pane,"add",&[&bar])?;
 }
 glow(three_new(three,"SphereGeometry",&[&n(0.55),&n(16.0),&n(8.0)])?,[1.0,0.7,0.4],16.0,[7.4,1.2,3.6])?;
 // Shelf covers face the room's rear-right side after the isometric turn. Give their laminate a broad
 // secondary window to reflect; the existing front-left key still lights the print. This is baked into the
 // shared environment once per context, adding no live reflection render pass.
 glow(plane(4.0,6.0)?,[1.0,0.98,0.95],2.2,[7.0,-1.0,-6.4])?;
 glow(plane(7.0,2.2)?,[1.0,0.96,0.92],0.9,[0.0,9.4,-1.0])?;
 let pmrem=three_new(three,"PMREMGenerator",&[renderer])?;
 let target=method(&pmrem,"fromScene",&[&room,&n(0.035)])?;
 let environment=read(&target,"texture")?;
 method(hooks,"prepareStudioEnvironmentCache",&[renderer,&target])?;
 let release=Closure::<dyn FnMut(JsValue)->Result<(),JsValue>>::new(|object:JsValue|{
  for part in ["geometry","material"]{method_opt(&read(&object,part)?,"dispose",&[])?;}Ok(())
 });
 method(&room,"traverse",&[release.as_ref()])?;
 method(&pmrem,"dispose",&[])?;
 Ok(environment)
}
