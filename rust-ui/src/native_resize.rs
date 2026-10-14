//! Native framebuffer sizing. Three assigns both canvas dimensions on a size change, and
//! assigning an unchanged native dimension resets the framebuffer, so the unchanged
//! dimension is skipped while Three updates its own logical size, pixel ratio and viewport.
//! When both dimensions change, a zero-height staging write avoids the full intermediate
//! allocation. Everything is synchronous and undone before the operation returns.
use std::{cell::Cell,rc::Rc};
use wasm_bindgen::{prelude::*,JsCast};
use js_sys::{Function,Object,Reflect};
use crate::host::*;

fn integer(value:&JsValue)->bool{value.as_f64().is_some_and(|number|number.is_finite()&&number.floor()==number)}
fn number_of(value:&JsValue)->f64{value.as_f64().unwrap_or(f64::NAN)}
fn is_false(value:&JsValue)->bool{*value==JsValue::FALSE}

/// One axis of `HTMLCanvasElement.prototype`, as the platform defines it.
struct Axis{name:&'static str,get:Function,set:Function,enumerable:bool}
fn axis(prototype:&JsValue,name:&'static str)->Option<Axis>{
 let descriptor:JsValue=Object::get_own_property_descriptor(&Object::from(prototype.clone()),&JsValue::from_str(name));
 if absent(&descriptor){return None;}
 let getter=get(&descriptor,"get").dyn_into::<Function>().ok()?;
 let setter=get(&descriptor,"set").dyn_into::<Function>().ok()?;
 if !truthy(&get(&descriptor,"configurable")){return None;}
 Some(Axis{name,get:getter,set:setter,enumerable:truthy(&get(&descriptor,"enumerable"))})
}
fn current(axis:&Axis,canvas:&JsValue)->Result<JsValue,JsValue>{axis.get.call0(canvas)}

/// Runs `operation` with the unchanged dimension of the renderer's canvas left alone.
/// Anything outside the exact situation it was written for runs `operation` unchanged.
#[wasm_bindgen]
pub fn with_native_canvas_resize(renderer:JsValue,operation:JsValue,physical:JsValue,options:JsValue)->Result<JsValue,JsValue>{
 let avoid=if options.is_undefined(){JsValue::FALSE}else{
  if options.is_null(){return Err(js_sys::TypeError::new("Cannot destructure 'undefined' or 'null'").into());}
  let value=read(&options,"avoidIntermediateAllocation")?;if value.is_undefined(){JsValue::FALSE}else{value}
 };
 resize_scope(&renderer,&|| call(&operation,"operation",&[]),&physical,&avoid)
}
fn resize_scope(renderer:&JsValue,run:&dyn Fn()->Result<JsValue,JsValue>,physical:&JsValue,avoid:&JsValue)->Result<JsValue,JsValue>{
 let (renderer,physical,avoid)=(renderer.clone(),physical.clone(),avoid.clone());
 let canvas=get(&renderer,"domElement");
 let width=get(&physical,"width");let height=get(&physical,"height");
 let canvas_class=get(&global(),"HTMLCanvasElement");
 let unsupported=!truthy(&get(&renderer,"isWebGLRenderer"))||get(&renderer,"autoClear")!=JsValue::TRUE||get(&renderer,"autoClearColor")!=JsValue::TRUE
  ||get(&renderer,"autoClearDepth")!=JsValue::TRUE||get(&renderer,"autoClearStencil")!=JsValue::TRUE
  ||truthy(&get(&get(&renderer,"xr"),"isPresenting"))
  ||method_opt(&renderer,"getRenderTarget",&[])?.is_some_and(|target|truthy(&target))
  ||!method_opt(&renderer,"getScissorTest",&[])?.is_some_and(|test|is_false(&test))
  ||canvas_class.is_undefined()||!canvas.is_instance_of::<web_sys::HtmlCanvasElement>()
  ||!integer(&width)||number_of(&width)<=0.0||!integer(&height)||number_of(&height)<=0.0
  ||(width==get(&canvas,"width")&&height==get(&canvas,"height"))
  ||!Object::is_extensible(&Object::from(canvas.clone()))||Object::has_own(&Object::from(canvas.clone()),&JsValue::from_str("width"))
  ||Object::has_own(&Object::from(canvas.clone()),&JsValue::from_str("height"));
 if unsupported{return run();}
 let prototype=get(&canvas_class,"prototype");
 let (Some(width_axis),Some(height_axis))=(axis(&prototype,"width"),axis(&prototype,"height"))else{return run()};
 let original_height=number_of(&current(&height_axis,&canvas)?);
 let staged=Rc::new(Cell::new(false));
 let height_axis=Rc::new(height_axis);
 let mut closures:Vec<(Closure<dyn FnMut()->Result<JsValue,JsValue>>,Closure<dyn FnMut(JsValue)->Result<(),JsValue>>)>=Vec::new();
 let mut installed:Vec<&'static str>=Vec::new();
 let install=(||->Result<(),JsValue>{
  for axis_info in [width_axis,Axis{name:height_axis.name,get:height_axis.get.clone(),set:height_axis.set.clone(),enumerable:height_axis.enumerable}]{
   let (name,enumerable)=(axis_info.name,axis_info.enumerable);
   let getter={let (read,canvas)=(axis_info.get.clone(),canvas.clone());Closure::wrap(Box::new(move||read.call0(&canvas))as Box<dyn FnMut()->Result<JsValue,JsValue>>)};
   let setter={
    let (read,write,canvas,physical,avoid,staged,height_axis)=(axis_info.get.clone(),axis_info.set.clone(),canvas.clone(),physical.clone(),avoid.clone(),staged.clone(),height_axis.clone());
    Closure::wrap(Box::new(move|value:JsValue|->Result<(),JsValue>{
     // Only Three's already-normalised integer assignment can be omitted. Preserve WebIDL coercion for every other value.
     let now=read.call0(&canvas)?;
     if integer(&value)&&number_of(&value)>=0.0&&value==now{return Ok(());}
     // Three writes width, then height. When both change, the first write allocates new-width x OLD-height
     // even though nobody renders it. A zero-height staging buffer avoids that full intermediate allocation;
     // the normal height write creates the exact final frame. Shrinking both axes already keeps the
     // intermediate frame within the existing allocation, and bounded room growth also stays below its
     // required final allocation: neither takes the extra zero-size reset.
     if truthy(&avoid)&&name=="width"{
      let (physical_width,physical_height)=(get(&physical,"width"),get(&physical,"height"));
      let width_now=read.call0(&canvas)?;
      if value==physical_width&&value!=width_now&&physical_height!=JsValue::from_f64(original_height)&&original_height>0.0
       &&!(number_of(&physical_width)<number_of(&width_now)&&number_of(&physical_height)<original_height)
       &&!(text(&avoid,"bounded")&&number_of(&physical_width)>number_of(&width_now)&&number_of(&physical_height)>original_height)
       &&number_of(&current(&height_axis,&canvas)?)==original_height{
       // A driver rejecting staging keeps its original resize.
       let _=height_axis.set.call1(&canvas,&JsValue::from_f64(0.0));
       staged.set(number_of(&current(&height_axis,&canvas)?)==0.0);
      }
     }
     write.call1(&canvas,&value)?;
     if name=="height"{staged.set(false);}
     Ok(())
    })as Box<dyn FnMut(JsValue)->Result<(),JsValue>>)
   };
   let descriptor=Object::new();
   Reflect::set(&descriptor,&"configurable".into(),&JsValue::TRUE)?;
   Reflect::set(&descriptor,&"enumerable".into(),&JsValue::from_bool(enumerable))?;
   Reflect::set(&descriptor,&"get".into(),getter.as_ref())?;
   Reflect::set(&descriptor,&"set".into(),setter.as_ref())?;
   if !Reflect::define_property(&Object::from(canvas.clone()),&JsValue::from_str(name),&descriptor)?{return Err(js_sys::TypeError::new("Cannot redefine property").into());}
   closures.push((getter,setter));installed.push(name);
  }
  Ok(())
 })();
 if install.is_err(){
  for name in &installed{let _=Reflect::delete_property(&Object::from(canvas.clone()),&JsValue::from_str(name));}
  return run();
 }
 let result=run();
 for name in &installed{let _=Reflect::delete_property(&Object::from(canvas.clone()),&JsValue::from_str(name));}
 // Preserve the original partial-operation dimensions when an operation throws, or never reaches
 // Three's second assignment. No zero-sized presentation can survive this synchronous resize scope.
 if staged.get()&&number_of(&current(&height_axis,&canvas)?)==0.0{height_axis.set.call1(&canvas,&JsValue::from_f64(original_height))?;}
 drop(closures);
 result
}

/// Apply a native framebuffer size and DPR together when both change. Three's setPixelRatio
/// otherwise resizes the OLD logical size first. The installed atomic API retains the same floor,
/// viewport and CSS policy; legacy, XR, older renderers and one-field changes keep their ordering.
#[wasm_bindgen]
pub fn configure_native_renderer_size(renderer:JsValue,width:JsValue,height:JsValue,ratio:JsValue,scratch:JsValue,native:JsValue,preserve:JsValue,avoid:JsValue)->Result<(),JsValue>{
 let native=if native.is_undefined(){true}else{truthy(&native)};
 let preserve=truthy(&preserve);
 let resize=|operation:&dyn Fn()->Result<JsValue,JsValue>,w:&JsValue,h:&JsValue|->Result<(),JsValue>{
  if native&&preserve{
   let physical=Object::new();
   Reflect::set(&physical,&"width".into(),&JsValue::from_f64(js_sys::Math::floor(num(w)*num(&ratio))))?;
   Reflect::set(&physical,&"height".into(),&JsValue::from_f64(js_sys::Math::floor(num(h)*num(&ratio))))?;
   resize_scope(&renderer,operation,&physical.into(),&avoid).map(|_|())
  }else{operation().map(|_|())}
 };
 if native{
  let ratio_changed=method(&renderer,"getPixelRatio",&[])?!=ratio;
  method(&renderer,"getSize",&[&scratch])?;
  let (sx,sy)=(read(&scratch,"x")?,read(&scratch,"y")?);
  if ratio_changed&&(sx!=width||sy!=height)&&read(&renderer,"setDrawingBufferSize")?.is_function()&&!truthy(&get(&get(&renderer,"xr"),"isPresenting")){
   return resize(&|| method(&renderer,"setDrawingBufferSize",&[&width,&height,&ratio]),&width,&height);
  }
 }
 // Legacy, XR, older renderers, and one-field changes keep their original ordering. In particular
 // setSize's XR guard is not bypassed.
 if method(&renderer,"getPixelRatio",&[])?!=ratio{
  let (sx,sy)=(read(&scratch,"x")?,read(&scratch,"y")?);
  resize(&|| method(&renderer,"setPixelRatio",&[&ratio]),&sx,&sy)?;
 }
 method(&renderer,"getSize",&[&scratch])?;
 let (sx,sy)=(read(&scratch,"x")?,read(&scratch,"y")?);
 if sx!=width||sy!=height{
  resize(&|| method(&renderer,"setSize",&[&width,&height,&JsValue::FALSE]),&width,&height)?;
 }
 Ok(())
}
