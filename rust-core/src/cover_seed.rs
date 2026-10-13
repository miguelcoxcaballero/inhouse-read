//! FNV-1a on the original 24-column/36-row quantised RGB sample.
//! The palette owner already holds these RGBA bytes in its bounded arena.
/// # Safety
/// rgba contains width*height*4 live bytes. No source pointer is retained.
#[no_mangle]
pub unsafe extern "C" fn relief_cover_seed(rgba:*const u8,width:usize,height:usize)->f64 {
    let Some(count)=width.checked_mul(height) else{return -1.0};
    if rgba.is_null()||width==0||height==0||count>262144{return -1.0}
    let data=std::slice::from_raw_parts(rgba,count*4);
    let step_x=(width/24).max(1);let step_y=(height/36).max(1);
    let mut state=2166136261u32;
    for y in (0..height).step_by(step_y){for x in (0..width).step_by(step_x){
        let at=(y*width+x)*4;
        for channel in 0..3{state=(state^(data[at+channel]>>4) as u32).wrapping_mul(16777619)}
    }}
    state as f64
}
