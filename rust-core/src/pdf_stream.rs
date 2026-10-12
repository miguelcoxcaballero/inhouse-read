//! Paragraph joins and source spans for the existing UTF-16 PDF reading stream.
//! Unicode boundary flags come from the browser's exact Unicode properties.
const LINE:usize=7;
const ENTRY:usize=6;
const START_SPACE:u32=1;
const END_SPACE:u32=2;
const START_LOWER:u32=4;
const START_CJK:u32=8;
const END_CJK:u32=16;
const END_HYPHEN:u32=32;
const END_SOFT:u32=64;
fn integer(v:f64,limit:usize)->bool{v.is_finite()&&v>=0.0&&v.fract()==0.0&&v<=limit as f64}
/// # Safety
/// Lines: [first entry,count,y,height,column id,rtl,list start]. Entries:
/// [x0,x1,height,UTF16 length,boundary flags,flags after trimming soft hyphen].
/// Outputs: entry [prefix 0/1/2,trim,start,end]; line [start,end,soft,paragraph].
/// Separate, aligned buffers sized count*stride are owned by the caller.
#[no_mangle]
pub unsafe extern "C" fn pdf_text_stream(lines:*const f64,count:usize,columns:usize,entries:*const f64,n:usize,entry_out:*mut f64,line_out:*mut f64)->i32{
 if count==0||count>32768||n<count||n>32768||columns==0||columns>count{return -1;}
 let lines=std::slice::from_raw_parts(lines,count*LINE);
 let entries=std::slice::from_raw_parts(entries,n*ENTRY);
 let mut expected=0;let mut total=0;
 for l in lines.chunks_exact(LINE){
  if !integer(l[0],n)||l[0] as usize!=expected||!integer(l[1],n)||l[1]<1.0||!l[2].is_finite()||!l[3].is_finite()||l[3]<=0.0
    ||!integer(l[4],columns-1)||!integer(l[5],1)||!integer(l[6],1){return -1;}
  expected+=l[1] as usize;if expected>n{return -1;}
 }
 if expected!=n{return -1;}
 for e in entries.chunks_exact(ENTRY){
  if !e[0].is_finite()||!e[1].is_finite()||e[0]>e[1]||!e[2].is_finite()||e[2]<=0.0||!integer(e[3],16_000_000)||e[3]<1.0
   ||!integer(e[4],127)||!integer(e[5],127){return -1;}
  total+=e[3] as usize;if total>16_000_000{return -1;}
 }
 let mut gaps=vec![Vec::<f64>::new();columns];
 for i in 1..count {
  let a=&lines[(i-1)*LINE..i*LINE];let b=&lines[i*LINE..(i+1)*LINE];let delta=b[2]-a[2];
  if a[4]==b[4]&&delta>0.0&&delta<=a[3].max(b[3])*2.6 {gaps[b[4] as usize].push(delta);}
 }
 let leading:Vec<Option<f64>>=gaps.iter_mut().map(|values|{
  if values.is_empty(){return None;}
  values.sort_by(|a,b|a.partial_cmp(b).unwrap());let half=(values.len()+1)/2;Some(values[half/2])
 }).collect();
 let out=std::slice::from_raw_parts_mut(entry_out,n*4);
 let line_out=std::slice::from_raw_parts_mut(line_out,count*4);
 let mut offset=0usize;let mut tail=0u32;let mut previous_soft=false;
 for (i,l) in lines.chunks_exact(LINE).enumerate(){
  let first=l[0] as usize;let pieces=l[1] as usize;let mut prefix=0;let mut paragraph=false;
  if i>0 {
   let p=&lines[(i-1)*LINE..i*LINE];let normal=leading[l[4] as usize].unwrap_or(p[3].max(l[3])*1.5);
   let delta=l[2]-p[2];let start=entries[first*ENTRY+4] as u32;
   paragraph=l[4]!=p[4]||delta<0.0||delta>normal+2.0f64.max(p[3].min(l[3])*0.3)||l[6]==1.0;
   if paragraph{prefix=2;}else if tail&END_SPACE==0&&start&START_SPACE==0 {
    let continued=tail&END_HYPHEN!=0&&start&START_LOWER!=0;
    if !continued&&!previous_soft&&!(tail&END_CJK!=0&&start&START_CJK!=0){prefix=1;}
   }
  }
  if prefix!=0{tail=END_SPACE;}
  offset+=prefix;let line_start=offset;let mut soft=false;
  for piece in 0..pieces {
   let index=first+piece;let e=&entries[index*ENTRY..(index+1)*ENTRY];let flags=e[4] as u32;
   let mut entry_prefix=if piece==0{prefix}else{0};
   if piece>0 {
    let previous=&entries[(index-1)*ENTRY..index*ENTRY];let previous_flags=previous[4] as u32;
    if previous_flags&END_SPACE==0&&flags&START_SPACE==0&&!(previous_flags&END_CJK!=0&&flags&START_CJK!=0){
     let gap=if l[5]==1.0{previous[0]-e[1]}else{e[0]-previous[1]};
     if gap>previous[2].min(e[2])*0.12{entry_prefix=1;offset+=1;tail=END_SPACE;}
    }
   }
   let trim=piece==pieces-1&&i+1<count&&lines[(i+1)*LINE+4]==l[4]
    &&entries[lines[(i+1)*LINE] as usize*ENTRY+4] as u32&START_LOWER!=0&&flags&END_SOFT!=0;
   soft|=trim;let length=e[3] as usize-usize::from(trim);let start=offset;offset+=length;
   if length>0{tail=if trim{e[5] as u32}else{flags};}
   out[index*4..index*4+4].copy_from_slice(&[entry_prefix as f64,trim as u8 as f64,start as f64,offset as f64]);
  }
  line_out[i*4..i*4+4].copy_from_slice(&[line_start as f64,offset as f64,soft as u8 as f64,paragraph as u8 as f64]);
  previous_soft=soft;
 }
 offset as i32
}
