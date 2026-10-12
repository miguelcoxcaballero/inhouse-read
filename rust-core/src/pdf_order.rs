//! Recursive PDF reading order. Only finite geometry and counter flags cross
//! the ABI; text and original PDF.js object identities remain with the host.
use std::cmp::Ordering;
const STRIDE:usize=7;
fn compare(a:f64,b:f64)->Ordering {a.partial_cmp(&b).unwrap()}
fn value(source:&[f64],id:usize,field:usize)->f64 {source[id*STRIDE+field]}
fn sort_reading(ids:&mut [usize],source:&[f64],rtl:bool){
 ids.sort_by(|&a,&b|compare(value(source,a,4),value(source,b,4)).then_with(||
  if rtl{compare(value(source,b,0),value(source,a,0))}else{compare(value(source,a,0),value(source,b,0))}));
}
fn cut(source:&[f64],ids:&[usize])->(u8,f64){
 if ids.len()<4{return(0,0.0);}
 let mut left=f64::NEG_INFINITY;let mut right=f64::INFINITY;
 for &id in ids {left=left.max(value(source,id,0));right=right.min(value(source,id,1));}
 if left<right{return(0,0.0);}
 let mut geometry=Vec::with_capacity(ids.len()*6);
 for &id in ids{geometry.extend_from_slice(&source[id*STRIDE..id*STRIDE+6]);}
 let mut result=[0.0;3];
 unsafe{crate::pdf_layout::pdf_column_cut(geometry.as_ptr(),ids.len(),result.as_mut_ptr());}
 (result[0] as u8,result[1])
}
fn child(path:&str,suffix:&str)->String{
 let mut next=String::with_capacity(path.len()+suffix.len());next.push_str(path);next.push_str(suffix);next
}
fn span(path:&str,mut number:usize)->String{
 let mut next=child(path,"/span-");let mut digits=[0u8;20];let mut at=digits.len();
 loop{at-=1;digits[at]=b'0'+(number%10) as u8;number/=10;if number==0{break;}}
 for &digit in &digits[at..]{next.push(digit as char);}next
}
fn append(ids:Vec<usize>,path:&str,out:&mut Vec<(usize,String)>){
 out.extend(ids.into_iter().map(|id|(id,path.to_owned())));
}
fn order(source:&[f64],mut ids:Vec<usize>,rtl:bool,path:&str,depth:usize,out:&mut Vec<(usize,String)>){
 if ids.len()<2{append(ids,path,out);return;}
 if depth>32{sort_reading(&mut ids,source,rtl);append(ids,path,out);return;}
 let (kind,at)=cut(source,&ids);
 if kind==2{sort_reading(&mut ids,source,rtl);append(ids,path,out);return;}
 if kind==1{
  let start=out.len();let mut left=Vec::new();let mut right=Vec::new();let mut crossing=Vec::new();
  for id in ids{if value(source,id,1)<=at{left.push(id);}else if value(source,id,0)>=at{right.push(id);}else{crossing.push(id);}}
  let bounds=|ids:&[usize]|ids.iter().fold((f64::INFINITY,f64::NEG_INFINITY),|(min,max),&id|(min.min(value(source,id,4)),max.max(value(source,id,4))));
  let (lt,lb)=bounds(&left);let(rt,rb)=bounds(&right);let top=lt.max(rt);let bottom=lb.min(rb);
  let mut remaining=left;remaining.extend(right);let mut counters=Vec::new();
  remaining.retain(|&id|{let counter=value(source,id,6)!=0.0&&(value(source,id,4)<top-value(source,id,5)*1.5||value(source,id,4)>bottom+value(source,id,5)*1.5);if counter{counters.push(id);}!counter});
  let mut headers:Vec<_>=counters.iter().copied().filter(|&id|value(source,id,4)<top).collect();
  headers.sort_by(|&a,&b|compare(value(source,a,4),value(source,b,4)));append(headers,&child(path,"/header"),out);
  let columns=|group:Vec<usize>,out:&mut Vec<(usize,String)>|{
   let left:Vec<_>=group.iter().copied().filter(|&id|value(source,id,1)<=at).collect();
   let right:Vec<_>=group.into_iter().filter(|&id|value(source,id,0)>=at).collect();
   if rtl{order(source,right,rtl,&child(path,"/r"),depth+1,out);order(source,left,rtl,&child(path,"/l"),depth+1,out);}
   else{order(source,left,rtl,&child(path,"/l"),depth+1,out);order(source,right,rtl,&child(path,"/r"),depth+1,out);}
  };
  crossing.sort_by(|&a,&b|compare(value(source,a,4),value(source,b,4)).then_with(||compare(value(source,a,0),value(source,b,0))));
  for full in crossing{
   let mut preceding=Vec::new();let threshold=value(source,full,4)-value(source,full,5)*0.3;
   remaining.retain(|&id|{if value(source,id,4)<threshold{preceding.push(id);false}else{true}});
   columns(preceding,out);let number=out.len()-start;out.push((full,span(path,number)));
  }
  columns(remaining,out);
  let mut footers:Vec<_>=counters.into_iter().filter(|&id|value(source,id,4)>bottom).collect();
  footers.sort_by(|&a,&b|compare(value(source,a,4),value(source,b,4)));append(footers,&child(path,"/footer"),out);return;
 }
 ids.sort_by(|&a,&b|compare(value(source,a,2),value(source,b,2)).then_with(||compare(value(source,a,0),value(source,b,0))));
 let mut heights:Vec<_>=ids.iter().map(|&id|value(source,id,5)).collect();heights.sort_by(|a,b|compare(*a,*b));let height=heights[ids.len()/2];
 let mut bottom=value(source,ids[0],3);let mut split=0;let mut widest=0.0;
 for (index,&id) in ids.iter().enumerate().skip(1){let gap=value(source,id,2)-bottom;if gap>widest&&gap>height*0.45{widest=gap;split=index;}bottom=bottom.max(value(source,id,3));}
 if split>0{let right=ids.split_off(split);order(source,ids,rtl,path,depth+1,out);order(source,right,rtl,path,depth+1,out);}
 else{sort_reading(&mut ids,source,rtl);append(ids,path,out);}
}
/// # Safety
/// Input: count*7 f64 [x0,x1,top,bottom,y,height,counter]. Outputs: count*3
/// u32 [source index,path byte offset,path byte length], path_capacity bytes.
/// Buffers must be disjoint and aligned; no output is committed on rejection.
#[no_mangle]
pub unsafe extern "C" fn pdf_order_lines(input:*const f64,count:usize,rtl:u32,records:*mut u32,paths:*mut u8,path_capacity:usize)->usize{
 if count==0||count>32768||rtl>1{return 0;}
 let source=std::slice::from_raw_parts(input,count*STRIDE);
 if source.iter().any(|v|!v.is_finite())||source.chunks_exact(STRIDE).any(|v|v[0]>v[1]||v[2]>v[3]||v[5]<=0.0||(v[6]!=0.0&&v[6]!=1.0)){return 0;}
 let mut result=Vec::with_capacity(count);order(source,(0..count).collect(),rtl!=0,"",0,&mut result);
 if result.len()!=count{return 0;}
 let mut seen=vec![false;count];let mut total=0;
 for (id,path) in &result{if *id>=count||seen[*id]{return 0;}seen[*id]=true;total+=path.len();}
 if total>path_capacity{return 0;}
 let records=std::slice::from_raw_parts_mut(records,count*3);let paths=std::slice::from_raw_parts_mut(paths,path_capacity);let mut at=0;
 for (index,(id,path)) in result.into_iter().enumerate(){records[index*3]=id as u32;records[index*3+1]=at as u32;records[index*3+2]=path.len() as u32;paths[at..at+path.len()].copy_from_slice(path.as_bytes());at+=path.len();}
 count
}
