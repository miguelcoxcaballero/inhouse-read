//! Crop the title raster and retain precisely the original ordered samples.
/// # Safety
/// Host provides width*rows*4 input bytes, width*rows mask bytes, 1280 i32
/// samples and six u32 metadata cells. Each array belongs to this module.
#[no_mangle]
pub unsafe extern "C" fn font_glyph_mask(raw:*const u8,width:usize,rows:usize,stride:usize,mask:*mut u8,points:*mut i32,meta:*mut u32)->u32{
 if width==0||rows==0||width>2048||rows>2048||width*rows>1048576||stride==0||stride>65535{return 0;}
 let raw=std::slice::from_raw_parts(raw,width*rows*4);
 let(mut x0,mut y0,mut x1,mut y1)=(width,rows,0,0);let mut any=false;
 for y in 0..rows{for x in 0..width{if raw[(y*width+x)*4+3]<100{continue;}any=true;x0=x0.min(x);y0=y0.min(y);x1=x1.max(x);y1=y1.max(y);}}
 if !any{return 1;}
 let(w,h)=(x1-x0+1,y1-y0+1);let mask=std::slice::from_raw_parts_mut(mask,w*h);let mut area=0;
 for y in 0..h{for x in 0..w{let bit=u8::from(raw[((y0+y)*width+x0+x)*4+3]>=100);mask[y*w+x]=bit;area+=u32::from(bit);}}
 let mut counts=[0usize;3];
 for y in 1..h.saturating_sub(1){for x in 1..w.saturating_sub(1){let at=y*w+x;if mask[at]==0{counts[2]+=1;}else{counts[1]+=1;if mask[at-1]==0||mask[at+1]==0||mask[at-w]==0||mask[at+w]==0{counts[0]+=1;}}}}
 if counts[0]<8{return 1;}
 let limits=[280,500,500];let every=std::array::from_fn::<_,3,_>(|i|counts[i].div_ceil(limits[i]).max(1));
 let kept=std::array::from_fn::<_,3,_>(|i|counts[i].div_ceil(every[i]));let offsets=[0,kept[0],kept[0]+kept[1]];
 let out=std::slice::from_raw_parts_mut(points,kept.iter().sum());let mut indices=[0usize;3];
 for y in 1..h.saturating_sub(1){for x in 1..w.saturating_sub(1){let at=y*w+x;let flags=[mask[at]!=0&&(mask[at-1]==0||mask[at+1]==0||mask[at-w]==0||mask[at+w]==0),mask[at]!=0,mask[at]==0];for i in 0..3{if flags[i]{if indices[i]%every[i]==0{out[offsets[i]+indices[i]/every[i]]=(y*stride+x) as i32;}indices[i]+=1;}}}}
 std::slice::from_raw_parts_mut(meta,6).copy_from_slice(&[w as u32,h as u32,area,kept[0] as u32,kept[1] as u32,kept[2] as u32]);2
}
