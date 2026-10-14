//! Front-facing foliage used by the native pointer surface. Coordinates keep
//! Three's f64 operation order and the SVG path text matches `Number#toFixed(2)`.
use wasm_bindgen::prelude::*;
use js_sys::Array;
const MAX_VERTICES:usize=100_000;
const MAX_INDICES:usize=450_000;
fn foliage_plan(points:&[f32],indices:&[u32],matrix:&[f64],indexed:bool)->Option<Vec<f64>>{
 if matrix.len()!=16||points.len()%3!=0||points.len()/3>MAX_VERTICES||indices.len()>MAX_INDICES{return None;}
 if points.iter().any(|value|!value.is_finite())||matrix.iter().any(|value|!value.is_finite()){return None;}
 let vertices=points.len()/3;let count=if indexed{indices.len()}else{vertices};
 if count%3!=0||indexed&&indices.iter().any(|value|*value as usize>=vertices){return None;}
 let mut plan=Vec::with_capacity(2+vertices*2+count);plan.extend_from_slice(&[vertices as f64,0.0]);
 for point in points.chunks_exact(3){
  let (x,y,z)=(point[0]as f64,point[1]as f64,point[2]as f64);
  let w=1.0/(matrix[3]*x+matrix[7]*y+matrix[11]*z+matrix[15]);
  let px=(matrix[0]*x+matrix[4]*y+matrix[8]*z+matrix[12])*w;
  let py=(matrix[1]*x+matrix[5]*y+matrix[9]*z+matrix[13])*w;
  if !px.is_finite()||!py.is_finite(){return None;}
  plan.extend_from_slice(&[px,py]);
 }
 let mut triangles=0;
 for index in (0..count).step_by(3){
  let a=if indexed{indices[index]as usize}else{index};let b=if indexed{indices[index+1]as usize}else{index+1};let c=if indexed{indices[index+2]as usize}else{index+2};
  let (ax,ay,bx,by,cx,cy)=(plan[2+a*2],plan[3+a*2],plan[2+b*2],plan[3+b*2],plan[2+c*2],plan[3+c*2]);
  let facing=(bx-ax)*(cy-ay)-(by-ay)*(cx-ax);if facing<=0.0001{continue;}
  if !facing.is_finite(){return None;}
  plan.extend_from_slice(&[a as f64,b as f64,c as f64]);triangles+=1;
 }
 plan[1]=triangles as f64;Some(plan)
}

/// `Number#toFixed(2)` for finite values below 1e21: n is the integer that makes n/100 closest to the
/// exact binary value, the larger one on a tie; the sign is kept for any negative value (so -0.004 is "-0.00").
/// Larger magnitudes print in exponent form in JavaScript, which this does not reproduce.
fn push_fixed(out:&mut String,value:f64)->bool{
 if !value.is_finite()||value.abs()>=1e21{return false;}
 let bits=value.abs().to_bits();let exponent=((bits>>52)&0x7ff)as i32;let fraction=bits&((1u64<<52)-1);
 let (mantissa,shift)=if exponent==0{(fraction,-1074)}else{(fraction|(1u64<<52),exponent-1075)};
 let scaled=(mantissa as u128)*100;
 let rounded:u128=if shift>=0{scaled<<shift as u32}else{let down=(-shift)as u32;if down>=127{0}else{(scaled+(1u128<<(down-1)))>>down}};
 if value<0.0{out.push('-');}
 let mut digits=[0u8;40];let mut length=0;let mut rest=rounded;
 while rest>0{digits[length]=(rest%10)as u8;rest/=10;length+=1;}
 while length<3{digits[length]=0;length+=1;}
 for place in (0..length).rev(){out.push((b'0'+digits[place])as char);if place==2{out.push('.');}}
 true
}
/// The SVG path of every front-facing triangle, `M x,y L x,y L x,y Z` with the y axis flipped, and its
/// triangle count; `None` when the mesh is out of range so the caller keeps its own projection.
#[wasm_bindgen]
pub fn foliage_path(points:&[f32],indices:&[u32],matrix:&[f64],indexed:bool)->Option<Array>{
 let plan=foliage_plan(points,indices,matrix,indexed)?;
 let vertices=plan[0]as usize;let count=plan[1]as usize;let from=2+vertices*2;
 let mut labels:Vec<Option<String>>=vec![None;vertices];let mut path=String::with_capacity(count*48);
 for triangle in 0..count{
  for corner in 0..3{
   let index=plan[from+triangle*3+corner]as usize;
   if labels[index].is_none(){
    let mut label=String::with_capacity(24);
    if !push_fixed(&mut label,plan[2+index*2]){return None;}
    label.push(',');
    if !push_fixed(&mut label,-plan[3+index*2]){return None;}
    labels[index]=Some(label);
   }
   path.push(if corner==0{'M'}else{'L'});path.push_str(labels[index].as_deref()?);
  }
  path.push('Z');
 }
 Some(Array::of2(&JsValue::from_str(&path),&JsValue::from_f64(count as f64)))
}
/// The formatter on its own, for the differential tests.
#[wasm_bindgen]
pub fn foliage_fixed(value:f64)->Option<String>{let mut out=String::new();if push_fixed(&mut out,value){Some(out)}else{None}}
