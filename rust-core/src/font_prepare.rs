//! The exact grayscale, edge tolerance and fallback classification used by
//! the title matcher. Alpha is deliberately ignored as in the host raster.
/// # Safety
/// Input is width*height*4 u8, output gray is width*height u8 and near is
/// width*height f32. Buffers do not overlap. Return 1 quiet, 2 busy, 0 invalid.
#[no_mangle]
pub unsafe extern "C" fn font_prepare_pixels(raw:*const u8,width:usize,height:usize,with_edges:u32,gray:*mut u8,near:*mut f32)->u32{
 if with_edges>1||width==0||height==0||width>2048||height>2048||width*height>1048576{return 0;}
 let n=width*height;let raw=std::slice::from_raw_parts(raw,n*4);let gray=std::slice::from_raw_parts_mut(gray,n);
 for i in 0..n{let at=i*4;let v=raw[at] as f64*0.299+raw[at+1] as f64*0.587+raw[at+2] as f64*0.114;let floor=v.floor();gray[i]=(floor+if v-floor>=0.5{1.0}else{0.0}) as u8;}
 if with_edges==1{
 let near=std::slice::from_raw_parts_mut(near,n);let mut edges=vec![0u8;n];
 for y in 1..height.saturating_sub(1){for x in 1..width.saturating_sub(1){let at=y*width+x;let v=(i32::from(gray[at+1])-i32::from(gray[at-1])).abs()+(i32::from(gray[at+width])-i32::from(gray[at-width])).abs();edges[at]=v.min(255) as u8;}}
 near.fill(f32::NAN);
 if height>2{for at in width..n-width{near[at]=edges[at].max(edges[at-1]).max(edges[at+1]).max(edges[at-width]).max(edges[at+width]) as f32;}}
 }
 let(mut edge,mut sum,mut squared,mut count)=(0.0f64,0.0f64,0.0f64,0.0f64);
 for y in (1..height.saturating_sub(1)).step_by(2){for x in (1..width.saturating_sub(1)).step_by(2){let at=y*width+x;edge+=(gray[at+1] as f64-gray[at-1] as f64).abs()+(gray[at+width] as f64-gray[at-width] as f64).abs();let value=gray[at] as f64;sum+=value;squared+=value*value;count+=1.0;}}
 let variance=if count>0.0{squared/count-(sum/count).powi(2)}else{0.0};
 if edge/count.max(1.0)>44.0||variance>5200.0{2}else{1}
}
