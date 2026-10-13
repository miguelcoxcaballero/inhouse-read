/// Same left-to-right f64 prefixes and JS rounding/clamping; one pass serves
/// all boundaries instead of slicing/summing durations separately per mark.
/// # Safety: disjoint live f64 buffers (count, marks, 6, marks*2 elements).
#[no_mangle]
pub unsafe extern "C" fn duration_marks(durations:*const f64,count:usize,marks:*const f64,length:usize,config:*const f64,output:*mut f64)->i32{
 if durations.is_null()||marks.is_null()||config.is_null()||output.is_null()||count>32768||length>4096{return -1;}
 let durations=std::slice::from_raw_parts(durations,count);let marks=std::slice::from_raw_parts(marks,length);let cfg=std::slice::from_raw_parts(config,6);
 if !cfg.iter().all(|n|n.is_finite())||cfg[0].fract()!=0.0{return -1;}
 let (base,samples,trim,lead,pcm_length)=(cfg[0],cfg[2],cfg[3],cfg[4],cfg[5]);
 if cfg[1]!=count as f64{return -1;}
 let mut prefix=Vec::with_capacity(count+1);prefix.push(0.0);let mut sum=0.0;
 for &duration in durations{if !duration.is_finite()||duration<0.0{return -1;}sum+=duration;prefix.push(sum);}
 if !sum.is_finite(){return -1;}if sum<=0.0{return 0;}
 let out=std::slice::from_raw_parts_mut(output,length*2);let mut written=0;
 for (index,&phoneme) in marks.iter().enumerate(){
  if !phoneme.is_finite()||phoneme.fract()!=0.0{return -1;}
  if phoneme<base||phoneme>=base+count as f64{continue;}
  let value=prefix[(phoneme-base) as usize]*samples/sum;
  if !value.is_finite(){return -1;}
  let floor=value.floor();let rounded=if value-floor<0.5{floor}else{floor+1.0};
  let sample=((rounded-trim)+lead).min(pcm_length-1.0).max(0.0);
  out[written*2]=index as f64;out[written*2+1]=sample;written+=1;
 }
 written as i32
}
