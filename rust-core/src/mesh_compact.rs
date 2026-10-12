//! Index only fully matching corners within each original pair of triangles.
//! Preserve the existing normalized integer encoding, vertex order and facets.
fn rounded(value:f64)->i64{let base=value.floor();(base+if value-base>=0.5{1.0}else{0.0}) as i64}
/// # Safety
/// Descriptors contain [offset,size,kind] u32, kind 0 raw f32, 1 normal, 2 color.
/// Source/output have `length` f32; original/indices have `count` u32 each.
/// Output may reuse source storage: all source words are copied before writing.
#[no_mangle]
pub unsafe extern "C" fn mesh_compact(source:*const f32,length:usize,descriptors:*const u32,attributes:usize,count:usize,original:*mut u32,indices:*mut u32,output:*mut f32)->u32{
 if count==0||count>1_000_000||attributes==0||attributes>16||length>32*count{return 0;}
 let description=std::slice::from_raw_parts(descriptors,attributes*3);let mut cursor=0;
 for a in description.chunks_exact(3){let size=a[1] as usize;if a[0] as usize!=cursor||size==0||size>16||a[2]>2{return 0;}cursor+=size*count;}
 if cursor!=length{return 0;}
 let source=std::slice::from_raw_parts(source,length);if source.iter().any(|v|!v.is_finite()){return 0;}
 let mut words=vec![0u32;length];
 for a in description.chunks_exact(3){let offset=a[0] as usize;let n=a[1] as usize*count;let factor=if a[2]==1{32767.0}else{255.0};
  for i in offset..offset+n{if a[2]!=0&&source[i].abs()>65536.0{return 0;}words[i]=if a[2]==0{source[i].to_bits()}else{rounded(source[i] as f64*factor) as u32};}
 }
 let original=std::slice::from_raw_parts_mut(original,count);let indices=std::slice::from_raw_parts_mut(indices,count);let output=std::slice::from_raw_parts_mut(output,length);
 let mut unique=0;let mut first=0;
 for vertex in 0..count{
  if vertex%6==0{first=unique;}
  let mut matched=first;
  while matched<unique{
   let mut equal=true;
   for a in description.chunks_exact(3){let offset=a[0] as usize;let size=a[1] as usize;
    for component in 0..size{if words[offset+vertex*size+component]!=words[offset+original[matched] as usize*size+component]{equal=false;break;}}
    if !equal{break;}
   }
   if equal{break;}matched+=1;
  }
  if matched==unique{original[unique]=vertex as u32;unique+=1;}indices[vertex]=matched as u32;
 }
 for a in description.chunks_exact(3){let offset=a[0] as usize;let size=a[1] as usize;
  for vertex in 0..unique{for component in 0..size{let input=offset+original[vertex] as usize*size+component;
   output[offset+vertex*size+component]=match a[2]{1=>(words[input] as i16) as f32,2=>(words[input] as u8) as f32,_=>f32::from_bits(words[input])};
  }}
 }
 unique as u32
}
