//! Place composite illustrations in the exact existing UTF-16 reading stream.
const LINE:usize=6;
/// # Safety
/// Lines: count*6 f64 [x0,x1,y,height,UTF16 start,column id]. Rectangles:
/// images*4 f64 [x0,y0,x1,y1]. Parameters: [cos,sin,scaleX,scaleY,text length].
/// Output: images*2 f64 [rectangle index, UTF16 offset], sorted for reading. Disjoint aligned buffers are required.
#[no_mangle]
pub unsafe extern "C" fn pdf_place_figures(lines:*const f64,count:usize,columns:usize,rects:*const f64,images:usize,params:*const f64,output:*mut f64)->u32 {
    if count==0||count>32768||columns==0||columns>count||images>32768{return 0;}
    let lines=std::slice::from_raw_parts(lines,count*LINE);
    let rects=std::slice::from_raw_parts(rects,images*4);
    let params=std::slice::from_raw_parts(params,5);
    if lines.iter().chain(rects).chain(params).any(|v|!v.is_finite())||params[2]<=0.0||params[3]<=0.0{return 0;}
    let end=params[4];
    if end<0.0||end.fract()!=0.0||end>9007199254740991.0{return 0;}
    let mut bounds=vec![(f64::INFINITY,f64::NEG_INFINITY);columns];
    for line in lines.chunks_exact(LINE){
        if line[0]>line[1]||line[3]<=0.0||line[4]<0.0||line[4]>end||line[4].fract()!=0.0
            ||line[5]<0.0||line[5]>=columns as f64||line[5].fract()!=0.0{return 0;}
        let column=&mut bounds[line[5] as usize];
        column.0=column.0.min(line[0]);column.1=column.1.max(line[1]);
    }
    if rects.chunks_exact(4).any(|r|r[0]>r[2]||r[1]>r[3]){return 0;}
    let (cos,sin,sx,sy)=(params[0],params[1],params[2],params[3]);
    let mut matches=vec![false;columns];
    let mut result=Vec::with_capacity(images);
    for (index,rect) in rects.chunks_exact(4).enumerate(){
        let mut x0=f64::INFINITY;let mut x1=f64::NEG_INFINITY;let mut y1=f64::NEG_INFINITY;
        for (x,y) in [(rect[0],rect[1]),(rect[2],rect[1]),(rect[0],rect[3]),(rect[2],rect[3])]{
            let x=x*sx;let y=y*sy;
            let px=x*cos+y*sin;let py=-x*sin+y*cos;
            if !px.is_finite()||!py.is_finite(){return 0;}
            x0=x0.min(px);x1=x1.max(px);y1=y1.max(py);
        }
        let mut any=false;
        for (index,&(left,right)) in bounds.iter().enumerate(){matches[index]=right.min(x1)>left.max(x0);any|=matches[index];}
        let mut at=end;
        for line in lines.chunks_exact(LINE){
            if line[2]>=y1-line[3]*0.3&&(!any||matches[line[5] as usize]){at=line[4];break;}
        }
        result.push((index,at));
    }
    result.sort_by(|&(a,at),&(b,bt)|at.partial_cmp(&bt).unwrap()
        .then_with(||rects[a*4+1].partial_cmp(&rects[b*4+1]).unwrap()));
    let output=std::slice::from_raw_parts_mut(output,images*2);
    for (row,(index,at)) in output.chunks_exact_mut(2).zip(result){row.copy_from_slice(&[index as f64,at]);}
    1
}
