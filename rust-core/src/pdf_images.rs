//! Composite image bounds from the PDF renderer's transformed unit-square corners.
//! Cropping and colour-managed drawing remain in PDF.js/Canvas.
use std::cmp::Ordering;
#[derive(Clone,Copy)]
struct Rect { x0:f64, y0:f64, x1:f64, y1:f64 }
fn compare(a:&Rect,b:&Rect)->Ordering {
    a.y0.partial_cmp(&b.y0).unwrap().then_with(||a.x0.partial_cmp(&b.x0).unwrap())
}
/// # Safety
/// Input is count*6 f64 corner coordinates; output has space for count*4 f64.
/// Returns the number of composites, or usize::MAX for unsupported dimensions.
/// Pages assembled from tiles can carry many thousands of picture draws.
#[no_mangle]
pub unsafe extern "C" fn pdf_image_rects(input:*const f64,count:usize,width:f64,height:f64,output:*mut f64)->usize {
    if count>1_000_000 || !width.is_finite() || !height.is_finite() || width<=0.0 || height<=0.0 {return usize::MAX;}
    if count==0{return 0;}
    let source=std::slice::from_raw_parts(input,count*6);
    let mut rects=Vec::with_capacity(count);
    for c in source.chunks_exact(6) {
        if c.iter().any(|v|!v.is_finite()){continue;}
        let dx=c[2]+c[4]-c[0];let dy=c[3]+c[5]-c[1];
        let x0=0.0_f64.max((c[0].min(c[2]).min(c[4]).min(dx)*width+1e-7).floor());
        let y0=0.0_f64.max((c[1].min(c[3]).min(c[5]).min(dy)*height+1e-7).floor());
        let x1=width.min((c[0].max(c[2]).max(c[4]).max(dx)*width-1e-7).ceil());
        let y1=height.min((c[1].max(c[3]).max(c[5]).max(dy)*height-1e-7).ceil());
        if x1>x0 && y1>y0 {rects.push(Rect{x0,y0,x1,y1});}
    }
    rects.sort_by(compare);
    let mut a=0;
    while a<rects.len() {
        let mut merged=false;let mut b=a+1;
        while b<rects.len() {
            let left=rects[a];let right=rects[b];
            if right.y0>=left.y1 {break;}
            if left.x1.min(right.x1)>left.x0.max(right.x0) && left.y1.min(right.y1)>left.y0.max(right.y0) {
                rects[a]=Rect{x0:left.x0.min(right.x0),y0:left.y0.min(right.y0),x1:left.x1.max(right.x1),y1:left.y1.max(right.y1)};
                rects.remove(b);merged=true;break;
            }
            b+=1;
        }
        if merged{a=0;}else{a+=1;}
    }
    rects.sort_by(compare);
    let target=std::slice::from_raw_parts_mut(output,rects.len()*4);
    for (row,r) in target.chunks_exact_mut(4).zip(&rects){row.copy_from_slice(&[r.x0,r.y0,r.x1,r.y1]);}
    rects.len()
}


/// Ordered, equally wound parallelograms for restoring original image colours.
/// No bounding-box substitution: rotated images must not restore paper wedges.
/// # Safety
/// Input is count*6 f64, output has room for count*8 f64. The caller owns both.
#[no_mangle]
pub unsafe extern "C" fn pdf_image_paths(input: *const f64, count: usize,
    width: f64, height: f64, output: *mut f64) -> usize {
    if count > 32768 || !width.is_finite() || !height.is_finite()
        || width <= 0.0 || height <= 0.0 { return usize::MAX; }
    if count == 0 { return 0; }
    let source = std::slice::from_raw_parts(input, count * 6);
    let target = std::slice::from_raw_parts_mut(output, count * 8);
    let mut written = 0;
    for c in source.chunks_exact(6) {
        if c.iter().any(|v| !v.is_finite()) { continue; }
        let [ax, ay, bx, by, cx, cy] = [c[0], c[1], c[2], c[3], c[4], c[5]];
        let mirrored = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax) < 0.0;
        let (first_x, first_y, last_x, last_y) = if mirrored { (cx, cy, bx, by) }
            else { (bx, by, cx, cy) };
        target[written * 8..written * 8 + 8].copy_from_slice(&[
            ax * width, ay * height, first_x * width, first_y * height,
            (bx + cx - ax) * width, (by + cy - ay) * height,
            last_x * width, last_y * height,
        ]);
        written += 1;
    }
    written
}
