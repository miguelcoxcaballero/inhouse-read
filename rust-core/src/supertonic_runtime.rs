//! Numeric planning around Supertonic inference; ONNX sessions/tensors and
//! audio buffers remain owned by the synthesis host. No model/step changes.
use crate::voice_math::{js_min,js_max,round_half_up};
#[no_mangle]
pub unsafe extern "C" fn supertonic_runtime_config(sample_rate:f64,base_chunk:f64,compression:f64,latent:f64,latent_compression:f64,steps:f64,out:*mut f64)->u32{
 let chunk=base_chunk*compression;let latent=latent*latent_compression;
 if !sample_rate.is_finite()||sample_rate.fract()!=0.0||sample_rate<8000.0||sample_rate>96000.0
  ||!chunk.is_finite()||chunk.fract()!=0.0||chunk<1.0||!latent.is_finite()||latent.fract()!=0.0||latent<1.0||latent>1024.0{return 1;}
 if !steps.is_finite()||steps.fract()!=0.0||steps<2.0||steps>16.0{return 2;}
 if out.is_null(){return 3;}
 std::slice::from_raw_parts_mut(out,4).copy_from_slice(&[sample_rate,chunk,latent,steps]);0
}
#[no_mangle]
pub extern "C" fn supertonic_seconds(predicted:f64,rate:f64)->f64{predicted/crate::synth_flow::voice_synthesis_rate(rate)}
#[no_mangle]
pub extern "C" fn supertonic_audio_frames(seconds:f64,rate:f64,chunk:f64)->f64{((seconds*rate).floor()/chunk).ceil()}
#[no_mangle]
pub extern "C" fn supertonic_duration_ok(seconds:f64)->u32{(seconds.is_finite()&&seconds>0.0&&seconds<=40.0)as u32}
#[no_mangle]
pub extern "C" fn supertonic_mark_sample(length:f64,before:f64,after:f64)->f64{
 js_min(length-1.0,round_half_up(length*before/(before+after)))
}
#[no_mangle]
pub unsafe extern "C" fn supertonic_local_marks(marks:*const f64,len:usize,start:f64,end:f64,out:*mut f64)->usize{
 if len>1_048_576 || (len>0&&(marks.is_null()||out.is_null())){return 0;}
 let source=if len==0{&[][..]}else{std::slice::from_raw_parts(marks,len)};let mut count=0;
 for &value in source{if value.is_finite()&&value.fract()==0.0&&value>start&&value<end{*out.add(count)=value-start;count+=1;}}
 count
}
/// Exact Unicode scalar iteration over UTF-16, preserving lone surrogates.
#[no_mangle]
pub unsafe extern "C" fn supertonic_text_points(text:*const u16,len:usize,out:*mut u32)->usize{
 if len>1_048_576 || (len>0&&(text.is_null()||out.is_null())){return 0;}
 let text=if len==0{&[][..]}else{std::slice::from_raw_parts(text,len)};let(mut at,mut count)=(0,0);
 while at<len{let first=text[at]as u32;
  if(0xd800..=0xdbff).contains(&first)&&at+1<len&&(0xdc00..=0xdfff).contains(&(text[at+1]as u32)){
   *out.add(count)=0x10000+((first-0xd800)<<10)+(text[at+1]as u32-0xdc00);at+=2;
  }else{*out.add(count)=first;at+=1;}count+=1;
 }count
}
/// A bounded block of uniforms becomes engine Math.log/Math.cos requests.
/// The host resolves those two functions in place to retain exact ECMAScript
/// transcendental results; IEEE sqrt/multiplication/f32 rounding stay native.
#[no_mangle]
pub unsafe extern "C" fn supertonic_noise_plan(pairs:*mut f64,len:usize)->u32{
 if pairs.is_null()||len>256{return 0;}
 for pair in std::slice::from_raw_parts_mut(pairs,len*2).chunks_exact_mut(2){pair[0]=js_max(0.0001,pair[0]);pair[1]=2.0*std::f64::consts::PI*pair[1];}1
}
#[no_mangle]
pub unsafe extern "C" fn supertonic_noise_finish(pairs:*const f64,len:usize,out:*mut f32)->u32{
 if pairs.is_null()||out.is_null()||len>256{return 0;}
 for(i,pair)in std::slice::from_raw_parts(pairs,len*2).chunks_exact(2).enumerate(){*out.add(i)=((-2.0*pair[0]).sqrt()*pair[1])as f32;}1
}
pub struct PcmJoin{length:usize,count:usize,gap:usize}
#[no_mangle]
pub extern "C" fn supertonic_join_new(rate:f64)->*mut PcmJoin{
 if !rate.is_finite()||rate<8000.0||rate>96000.0{return std::ptr::null_mut();}
 Box::into_raw(Box::new(PcmJoin{length:0,count:0,gap:(rate*0.15).floor()as usize}))
}
#[no_mangle]
pub unsafe extern "C" fn supertonic_join_append(handle:*mut PcmJoin,len:usize)->f64{
 let Some(state)=handle.as_mut()else{return -1.0;};if len==0{return -1.0;}
 let gap=if state.count>0{state.gap}else{0};let Some(start)=state.length.checked_add(gap)else{return -2.0;};
 let Some(end)=start.checked_add(len)else{return -2.0;};state.length=end;state.count+=1;start as f64
}
#[no_mangle]
pub unsafe extern "C" fn supertonic_join_length(handle:*const PcmJoin)->usize{handle.as_ref().map_or(0,|state|state.length)}
#[no_mangle]
pub unsafe extern "C" fn supertonic_join_free(handle:*mut PcmJoin){if !handle.is_null(){drop(Box::from_raw(handle));}}

pub struct RuntimeState{disposed:bool,running:u32,next:u32}
#[no_mangle]
pub extern "C" fn supertonic_state_new()->*mut RuntimeState{Box::into_raw(Box::new(RuntimeState{disposed:false,running:0,next:0}))}
#[no_mangle]
pub unsafe extern "C" fn supertonic_state_begin(handle:*mut RuntimeState,valid:u32,rate:f64)->f64{
 let Some(state)=handle.as_mut()else{return -1.0;};
 if state.disposed{return -1.0;}if state.running!=0{return -2.0;}
 if valid==0||!rate.is_finite()||rate<0.5||rate>2.0{return -3.0;}
 state.next=state.next.wrapping_add(1).max(1);state.running=state.next;state.running as f64
}
#[no_mangle]
pub unsafe extern "C" fn supertonic_state_finish(handle:*mut RuntimeState,token:u32){if let Some(state)=handle.as_mut(){if state.running==token{state.running=0;}}}
#[no_mangle]
pub unsafe extern "C" fn supertonic_state_active(handle:*const RuntimeState)->u32{handle.as_ref().is_some_and(|state|!state.disposed)as u32}
#[no_mangle]
pub unsafe extern "C" fn supertonic_state_close(handle:*mut RuntimeState)->u32{
 let Some(state)=handle.as_mut()else{return 0;};if state.disposed{return 0;}state.disposed=true;1
}
#[no_mangle]
pub unsafe extern "C" fn supertonic_state_free(handle:*mut RuntimeState){if !handle.is_null(){drop(Box::from_raw(handle));}}
#[no_mangle]
pub unsafe extern "C" fn supertonic_style_valid(dims:*const f64,dim_len:usize,data:*const f64,data_len:usize)->u32{
 if dim_len!=3||dims.is_null()||(data_len>0&&data.is_null()){return 0;}
 let dims=std::slice::from_raw_parts(dims,3);if dims[0]!=1.0||dims.iter().any(|n|!n.is_finite()||n.fract()!=0.0||*n<1.0){return 0;}
 if dims.iter().product::<f64>()!=data_len as f64{return 0;}
 std::slice::from_raw_parts(data,data_len).iter().all(|n|n.is_finite())as u32
}
