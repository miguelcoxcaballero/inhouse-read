//! Shared interior vertices for curved leaf blades, in original insertion order.
use std::collections::BTreeMap;

/// # Safety
/// Source positions: vertices*3 f32; source indices: count u16. Output capacity
/// (vertices+count)*3 f32 and count*4 u16. Distinct spans owned by the host.
#[no_mangle]
pub unsafe extern "C" fn plant_subdivide(vertices:usize,count:usize,source:*const f32,indices:*const u16,
    positions:*mut f32,output:*mut u16)->usize {
    if vertices<3 || count<3 || vertices>65535 || count>65535 || count%3!=0 || vertices+count>65535 {return 0;}
    let source=std::slice::from_raw_parts(source,vertices*3);
    let indices=std::slice::from_raw_parts(indices,count);
    if source.iter().any(|v|!v.is_finite()) || indices.iter().any(|v|*v as usize>=vertices) {return 0;}
    let positions=std::slice::from_raw_parts_mut(positions,(vertices+count)*3);
    let output=std::slice::from_raw_parts_mut(output,count*4);
    positions[..vertices*3].copy_from_slice(source);
    let mut edges=BTreeMap::<u32,u16>::new();let mut next=vertices;
    for (triangle,src) in indices.chunks_exact(3).enumerate() {
        let a=src[0];let b=src[1];let c=src[2];let mut mid=[0u16;3];
        for (slot,(x,y)) in [(a,b),(b,c),(c,a)].into_iter().enumerate() {
            let key=((x.min(y) as u32)<<16)|x.max(y) as u32;
            mid[slot]=*edges.entry(key).or_insert_with(||{
                let id=next;next+=1;
                for axis in 0..3 {positions[id*3+axis]=((f64::from(source[x as usize*3+axis])+f64::from(source[y as usize*3+axis]))/2.0) as f32;}
                id as u16
            });
        }
        let [ab,bc,ca]=mid;let at=triangle*12;
        output[at..at+12].copy_from_slice(&[a,ab,ca,ab,b,bc,ca,bc,c,ab,bc,ca]);
    }
    next
}
