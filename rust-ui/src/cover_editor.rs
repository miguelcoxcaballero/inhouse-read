//! The cover editor's pure decisions: which tab a key moves to, where the front cover sits above the
//! sheet and the swaying frames that let the light travel over it. Same arithmetic and operation order
//! as the original; `Math.sin` / `Math.cos` come from the host.
use wasm_bindgen::prelude::*;
use js_sys::{Array,Math,Object,Reflect};
use crate::host::*;

const TABS:[&str;2]=["spine","cover"];
fn tab(value:&JsValue)->Option<usize>{value.as_string().and_then(|text|TABS.iter().position(|known|*known==text))}
fn id(index:usize)->JsValue{JsValue::from_str(TABS[index])}

/// The tab id itself when it is one of ours, otherwise the first tab.
#[wasm_bindgen]
pub fn editor_tab_id(value:&JsValue)->JsValue{if tab(value).is_some(){value.clone()}else{id(0)}}

/// Keyboard movement over the tab list: the target tab, or null for a key that does not move.
#[wasm_bindgen]
pub fn next_editor_tab(current:&JsValue,key:&JsValue)->JsValue{
 let index=tab(current).unwrap_or(0);let last=TABS.len()-1;
 match key.as_string().as_deref(){
  Some("ArrowRight")|Some("ArrowDown")=>id(if index==last{0}else{index+1}),
  Some("ArrowLeft")|Some("ArrowUp")=>id(if index==0{last}else{index-1}),
  Some("Home")=>id(0),Some("End")=>id(last),
  _=>JsValue::NULL,
 }
}

fn put(target:&Object,key:&str,value:f64)->Result<(),JsValue>{Reflect::set(target,&JsValue::from_str(key),&JsValue::from_f64(value))?;Ok(())}
fn option(options:&JsValue,key:&str,fallback:f64)->Result<f64,JsValue>{let value=read(options,key)?;Ok(if value.is_undefined(){fallback}else{num(&value)})}

/// Pose of the front cover for the editor sheet: it fits the free band above the sheet (phone and wide
/// tray) or, with the sheet at the side (low landscape), stays where the book flies. Same convention as
/// `view.animate`: positive y lowers the model, x/y are relative to the flight centre.
#[wasm_bindgen]
pub fn cover_editor_pose(options:&JsValue)->Result<JsValue,JsValue>{
 let viewport_width=read(options,"viewportWidth")?;let viewport_height=read(options,"viewportHeight")?;
 let landscape=read(options,"landscape")?;let cover_w=read(options,"coverW")?;let cover_h=read(options,"coverH")?;
 let center_y=read(options,"centerY")?;let thickness=option(options,"thickness",0.0)?;let sheet_top=read(options,"sheetTop")?;
 let pose=Object::new();
 let (x,y,scale)=if truthy(&landscape){(0.0,0.0,1.0)}else{
  let wide=num(&viewport_width)>=760.0;
  let top=if wide{36.0}else{56.0};let gap=if wide{22.0}else{18.0};
  let measured=sheet_top.as_f64().is_some_and(|value|value.is_finite()&&value>top+120.0);
  let bottom=(if measured{num(&sheet_top)}else{num(&viewport_height)*0.56})-gap;
  let band=jmax(80.0,bottom-top);
  let fit_width=(num(&viewport_width)-32.0)/jmax(1.0,num(&cover_w)+thickness);
  // The band and the width limit the scale, even for very tall covers.
  let scale=jmin(if wide{1.2}else{1.0},jmax(0.01,jmin(band/jmax(1.0,num(&cover_h)),fit_width)));
  (0.0,top+band/2.0-num(&center_y),scale)
 };
 put(&pose,"x",x)?;put(&pose,"y",y)?;put(&pose,"scale",scale)?;put(&pose,"angle",0.0)?;put(&pose,"pitch",0.0)?;
 Ok(pose.into())
}

/// Sway around the cover pose: yaw and pitch in quadrature (the light travels over the surface in an
/// ellipse, not along a line) under an envelope that eases in and out. It starts and ends exactly on the
/// base pose.
#[wasm_bindgen]
pub fn cover_tilt_frames(base:&JsValue,options:&JsValue)->Result<JsValue,JsValue>{
 let given=!options.is_undefined();
 let pick=|key:&str,fallback:f64|->Result<f64,JsValue>{if given{option(options,key,fallback)}else{Ok(fallback)}};
 let cycles=pick("cycles",3.0)?;let yaw=pick("yaw",12.0)?;let pitch=pick("pitch",7.0)?;
 let duration=if given{read(options,"duration")?}else{JsValue::UNDEFINED};let duration=if duration.is_undefined(){JsValue::from_f64(2400.0)}else{duration};
 let steps_per_cycle=pick("stepsPerCycle",8.0)?;
 let r=cycles*steps_per_cycle;let rounded=if r.is_finite(){let f=r.floor();if r-f>=0.5{f+1.0}else{f}}else{r};
 let steps=jmax(2.0,rounded);
 let frames=Array::new();
 let mut index=0.0;
 while index<=steps{
  let t=index/steps;
  let edge=index==0.0||index==steps;
  let envelope=if edge{0.0}else{jmin(1.0,Math::sin(std::f64::consts::PI*t)*1.7)};
  let phase=2.0*std::f64::consts::PI*cycles*t;
  let transform=Object::new();
  Object::assign(&transform,&Object::from(boxed(base)));
  let angle=num(&read(base,"angle")?)+if edge{0.0}else{yaw*envelope*Math::sin(phase)};
  let current=read(base,"pitch")?;let pitch_base=if absent(&current){0.0}else{num(&current)};
  put(&transform,"angle",angle)?;put(&transform,"pitch",pitch_base+if edge{0.0}else{pitch*envelope*Math::cos(phase)})?;
  let frame=Object::new();Reflect::set(&frame,&JsValue::from_str("transform"),&transform)?;frames.push(&frame);
  index+=1.0;
 }
 let out=Object::new();Reflect::set(&out,&JsValue::from_str("frames"),&frames)?;Reflect::set(&out,&JsValue::from_str("duration"),&duration)?;
 Ok(out.into())
}
