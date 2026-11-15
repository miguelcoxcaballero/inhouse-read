//! One frame of an entry's flight into the bin, in one call: the scale the book reaches at the
//! bin's mouth (`Object3D#getWorldScale`), where the flight is (`sample_trash_drop`), its turn
//! from the pose it left to the bin's tumble (`getWorldQuaternion`, `Quaternion#multiply` and
//! `#slerp`), and the bend that keeps a broad book inside the canvas (the row's slot box under
//! the matrix three composes for the model, `scene_trash_overflow`). The host formerly asked
//! three and four natives for these one by one and updated the model's matrices twice
//! (bookshelf-scene.js `updateTrash`, 1.8.1). The model flies as a child of the scene, whose own
//! world matrix is the identity: the product below is the one three makes.
use wasm_bindgen::prelude::*;
use crate::jsmath::{Box3,Mat4};
use crate::scene_view::corners_of;
use super::{RustSceneEntryFrame,STATE};

// `Quaternion#multiplyQuaternions(a, b)`, as `[x, y, z, w]`.
fn multiply(a:[f64;4],b:[f64;4])->[f64;4]{
 let (qax,qay,qaz,qaw,qbx,qby,qbz,qbw)=(a[0],a[1],a[2],a[3],b[0],b[1],b[2],b[3]);
 [qax*qbw+qaw*qbx+qay*qbz-qaz*qby,qay*qbw+qaw*qby+qaz*qbx-qax*qbz,qaz*qbw+qaw*qbz+qax*qby-qay*qbx,qaw*qbw-qax*qbx-qay*qby-qaz*qbz]
}
// `Quaternion#slerp` (three r180), as `[x, y, z, w]`.
fn slerp(a:[f64;4],qb:[f64;4],t:f64)->[f64;4]{
 if t==0.0{return a;}
 if t==1.0{return qb;}
 let (x,y,z,w)=(a[0],a[1],a[2],a[3]);
 let mut cos=w*qb[3]+x*qb[0]+y*qb[1]+z*qb[2];
 let q=if cos<0.0{cos=-cos;[-qb[0],-qb[1],-qb[2],-qb[3]]}else{qb};
 if cos>=1.0{return a;}
 let square=1.0-cos*cos;
 if square<=f64::EPSILON{
  let s=1.0-t;
  let (qw,qx,qy,qz)=(s*w+t*q[3],s*x+t*q[0],s*y+t*q[1],s*z+t*q[2]);
  let length=(qx*qx+qy*qy+qz*qz+qw*qw).sqrt();
  if length==0.0{return [0.0,0.0,0.0,1.0];}
  let l=1.0/length;
  return [qx*l,qy*l,qz*l,qw*l];
 }
 let sin=square.sqrt();
 let half=js_sys::Math::atan2(sin,cos);
 let (ra,rb)=(js_sys::Math::sin((1.0-t)*half)/sin,js_sys::Math::sin(t*half)/sin);
 [x*ra+q[0]*rb,y*ra+q[1]*rb,z*ra+q[2]*rb,w*ra+q[3]*rb]
}

#[wasm_bindgen]
impl RustSceneEntryFrame{
 // `drop` is the flight's record (`scene_trash_drop_record`: where the model started, its scale
 // and turn there, the book's tumble), `trash` the bin's world matrix, then the bin's mouth in
 // the world, its radius, how far the flight is and the canvas' width.
 // `out = [x, y, z, scale, quaternion x, y, z, w]` of the model.
 #[wasm_bindgen(js_name=binFlight)]
 #[allow(clippy::too_many_arguments)]
 pub fn bin_flight(&self,row:usize,drop:&[f64],trash:&[f64],mouth_x:f64,mouth_y:f64,mouth_z:f64,radius:f64,t:f64,scene_width:f64,out:&mut [f64]){
  let Some(state)=self.state.chunks_exact(STATE).nth(row) else{return};
  if drop.len()<12||trash.len()<16||out.len()<8{return;}
  let mut world=[0.0;16];world.copy_from_slice(&trash[..16]);
  let (_,turned,scale)=Mat4(world).decompose();
  let (width,height)=(state[25],state[26]);
  let end_scale=crate::scene_frame::scene_trash_end_scale(scale[0],radius,width,height);
  let motion=crate::shelf_trash::sample_trash_drop(drop[0],drop[1],drop[2],mouth_x,mouth_y,mouth_z,&JsValue::from_f64(t),height,drop[3],end_scale);
  let end=multiply(turned,[drop[8],drop[9],drop[10],drop[11]]);
  let turn=slerp([drop[4],drop[5],drop[6],drop[7]],end,motion[4]);
  let placed=Mat4::multiply(&Mat4::identity(),&Mat4::compose([motion[0],motion[1],motion[2]],turn,[motion[3];3]));
  let bounds=corners_of(&Box3{min:[state[50],state[51],state[52]],max:[state[53],state[54],state[55]]},&placed);
  let mut bend=[0.0;2];
  crate::scene_frame::scene_trash_overflow(bounds[1],scene_width,t,&mut bend);
  out[..8].copy_from_slice(&[if bend[0]!=0.0{motion[0]-bend[1]}else{motion[0]},motion[1],motion[2],motion[3],turn[0],turn[1],turn[2],turn[3]]);
 }
}
