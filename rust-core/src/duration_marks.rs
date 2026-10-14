//! Where each page boundary of a fragment falls in its audio, from the model's own
//! VITS frame durations (tests/unit/helpers/reference-piper-alignment.js is the frozen
//! JavaScript original). Same left-to-right f64 prefixes and JS rounding/clamping; one
//! pass serves all boundaries instead of slicing and summing durations per mark.
//!
//! Output records are `[mark index, sample]`. Durations that are not usable (not the
//! announced count, negative, not finite, or adding up to nothing) give no records at
//! all, as the original did; `-1` is only for a misuse of the buffers.

use crate::voice_math::{js_max,js_min,round_half_up};

/// The `(mark index, sample)` records of `phonemes` (the phoneme index of each page boundary).
/// `cfg` is `[base, expected count, samples, trim, lead, pcm length]`. `Err` is a misuse of the
/// arguments (a cfg that is not finite, a base or a phoneme that is not whole); durations that are
/// not usable simply give no records.
pub fn map_marks(durations:&[f64],phonemes:&[f64],cfg:[f64;6])->Result<Vec<(usize,f64)>,()>{
 if !cfg.iter().all(|n|n.is_finite())||cfg[0].fract()!=0.0{return Err(());}
 let (base,samples,trim,lead,pcm_length)=(cfg[0],cfg[2],cfg[3],cfg[4],cfg[5]);
 let count=durations.len();
 if cfg[1]!=count as f64{return Ok(Vec::new());}
 let mut prefix=Vec::with_capacity(count+1);prefix.push(0.0);let mut sum=0.0;
 for &duration in durations{if !duration.is_finite()||duration<0.0{return Ok(Vec::new());}sum+=duration;prefix.push(sum);}
 // A sum that overflowed to infinity is still a sum (its marks are NaN, as in JavaScript).
 if !(sum>0.0){return Ok(Vec::new());}
 let mut found=Vec::new();
 for (index,&phoneme) in phonemes.iter().enumerate(){
  if !phoneme.is_finite()||phoneme.fract()!=0.0{return Err(());}
  if phoneme<base||phoneme>=base+count as f64{continue;}
  let value=prefix[(phoneme-base) as usize]*samples/sum;
  found.push((index,js_max(0.0,js_min(pcm_length-1.0,(round_half_up(value)-trim)+lead))));
 }
 Ok(found)
}

/// # Safety
/// Disjoint live f64 buffers of `count`, `length`, 6 and `length * 2` elements.
/// `config` is `[base, expected count, samples, trim, lead, pcm length]`; `-1` is a misuse
/// of the buffers or the arguments.
#[no_mangle]
pub unsafe extern "C" fn duration_marks(durations:*const f64,count:usize,marks:*const f64,length:usize,config:*const f64,output:*mut f64)->i32{
 if (count>0&&durations.is_null())||(length>0&&marks.is_null())||config.is_null()||output.is_null()||count>1_048_576||length>262_144{return -1;}
 let durations=if count==0{&[][..]}else{std::slice::from_raw_parts(durations,count)};
 let marks=if length==0{&[][..]}else{std::slice::from_raw_parts(marks,length)};
 let mut cfg=[0f64;6];cfg.copy_from_slice(std::slice::from_raw_parts(config,6));
 let Ok(found)=map_marks(durations,marks,cfg)else{return -1;};
 let out=std::slice::from_raw_parts_mut(output,length*2);
 for (i,(index,sample)) in found.iter().enumerate(){out[i*2]=*index as f64;out[i*2+1]=*sample;}
 found.len() as i32
}
