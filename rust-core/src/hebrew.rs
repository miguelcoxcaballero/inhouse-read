//! Rule-for-rule translation of the existing Hebrew IPA implementation.
//! Piper rules: OHF-Voice/piper1-gpl efffbfb226bfb511ebbcf55d0cecd8b35a89743d,
//! GPL-3.0; see public/neural-voice/phon/COPYING and hebrew-NOTICE.txt.
//! Unicode NFC/combining classes remain in the browser. Inputs name glyphs,
//! marks and word boundaries; output is bounded Unicode scalar values.
const BREAK:u32=0xffff_fffe;
const SHEVA:u32=1;
const HIRIQ:u32=1<<4;
const HOLAM:u32=1<<9;
const DAGESH:u32=1<<12;
const SHIN:u32=1<<14;
const SIN:u32=1<<15;
const VOWELS:u32=0x3ff|(1<<11)|(1<<16);
#[derive(Clone,Copy)]struct Glyph{base:u32,marks:u32}
struct Segment{onset:Vec<u32>,nucleus:u32,coda:Vec<u32>,dagesh:bool}
fn segment(onset:Vec<u32>,nucleus:u32,dagesh:bool)->Segment{Segment{onset,nucleus,coda:Vec::new(),dagesh}}
fn consonant(g:Glyph,final_glyph:bool)->&'static [u32]{
 let base=match g.base{0x5da=>0x5db,0x5dd=>0x5de,0x5df=>0x5e0,0x5e3=>0x5e4,0x5e5=>0x5e6,x=>x};
 match base {
  0x5d0|0x5e2=>&[0x294],
  0x5d4=>if final_glyph&&g.marks&DAGESH==0{&[]}else{&[104]},
  0x5d9=>&[106],0x5d5=>&[118],
  0x5e9=>if g.marks&SHIN!=0{&[0x283]}else if g.marks&SIN!=0{&[115]}else{&[0x283]},
  0x5d1=>if g.marks&DAGESH!=0{&[98]}else{&[118]},
  0x5db=>if g.marks&DAGESH!=0{&[107]}else{&[0x3c7]},
  0x5e4=>if g.marks&DAGESH!=0{&[112]}else{&[102]},
  0x5d2=>&[103],0x5d3=>&[100],0x5d7=>&[0x3c7],0x5d8|0x5ea=>&[116],
  0x5dc=>&[108],0x5de=>&[109],0x5e0=>&[110],0x5e1=>&[115],
  0x5e6=>&[116,115],0x5e7=>&[107],0x5e8=>&[0x281],0x5d6=>&[122],_=>&[]
 }
}
fn vowel(g:Glyph)->(u32,bool){
 for (bit,value) in [(16,111),(11,117),(4,105),(5,101),(6,101),(7,97),(8,97),(2,97),(1,101),(3,111)]{
  if g.marks&(1<<bit)!=0{return (value,true);}
 }
 if g.marks&SHEVA!=0{(0x259,false)}else{(0,false)}
}
fn word(glyphs:&[Glyph],output:&mut Vec<u32>){
 let mut segments:Vec<Segment>=Vec::new();let mut onset=Vec::new();let mut i=0;
 while i<glyphs.len(){
  let g=glyphs[i];let next=glyphs.get(i+1);
  if g.base==0x5d5&&g.marks&DAGESH!=0&&g.marks&VOWELS==0{
   segments.push(segment(std::mem::take(&mut onset),117,false));i+=1;continue;
  }
  if g.marks&HIRIQ!=0&&next.is_some_and(|n|n.base==0x5d9&&n.marks&VOWELS==0){
   let c=consonant(g,false);if c!=[0x294]{onset.extend_from_slice(c);}
   segments.push(segment(std::mem::take(&mut onset),105,false));i+=2;continue;
  }
  if g.base==0x5d5&&g.marks&HOLAM!=0&&g.marks&DAGESH==0{
   segments.push(segment(std::mem::take(&mut onset),111,false));i+=1;continue;
  }
  let c=consonant(g,i==glyphs.len()-1);let (v,vocalic)=vowel(g);
  if vocalic{
   if c!=[0x294]{onset.extend_from_slice(c);}
   segments.push(segment(std::mem::take(&mut onset),v,false));
  }else if g.marks&SHEVA!=0{
   if c!=[0x294]{onset.extend_from_slice(c);}
   segments.push(segment(std::mem::take(&mut onset),0x259,g.marks&DAGESH!=0));
  }else{onset.extend_from_slice(c);}
  i+=1;
 }
 if let Some(last)=segments.last_mut(){last.coda.extend(onset);}
 let mut silent=false;
 for i in 0..segments.len(){
  if segments[i].nucleus!=0x259{silent=false;continue;}
  if i==0||segments[i].dagesh||silent{segments[i].nucleus=101;silent=false;}
  else{let moved=std::mem::take(&mut segments[i].onset);segments[i-1].coda.extend(moved);segments[i].nucleus=0;silent=true;}
 }
 let mut merged:Vec<Segment>=Vec::new();
 for current in segments{
  if current.nucleus==0{
   if let Some(last)=merged.last_mut(){last.coda.extend(current.onset);}else{merged.push(current);}
  }else{merged.push(current);}
 }
 let stressed=if merged.len()==2&&!merged[1].coda.is_empty(){0}else{merged.len().saturating_sub(1)};
 let start=output.len();
 for (i,s) in merged.into_iter().enumerate(){
  output.extend(s.onset);if i==stressed{output.push(0x2c8);}if s.nucleus!=0{output.push(s.nucleus);}output.extend(s.coda);
 }
 // Retain a glottal stop only before a vowel/stress marker. The original
 // removes the tie bar afterward; consonant vectors already omit that bar.
 let mut write=start;
 for read in start..output.len(){
  let value=output[read];
  if value==0x294&&!output.get(read+1).is_some_and(|n|matches!(*n,97|101|105|111|117|0x259|0x2c8)){continue;}
  output[write]=value;write+=1;
 }
 output.truncate(write);
}
/// # Safety: separate live caller-owned u32 buffers with the declared lengths.
/// Empty words are meaningful: punctuation-only words still join with spaces.
#[no_mangle]
pub unsafe extern "C" fn hebrew_ipa_words(input:*const u32,pairs:usize,output:*mut u32,capacity:usize)->i32{
 if input.is_null()||output.is_null()||pairs>32768||capacity>262144{return -1;}
 let source=std::slice::from_raw_parts(input,pairs*2);let mut glyphs=Vec::new();let mut result=Vec::new();
 for pair in source.chunks_exact(2){
  if pair[0]==BREAK{word(&glyphs,&mut result);glyphs.clear();result.push(32);}
  else if pair[0]<=0x10ffff&&!(0xd800..=0xdfff).contains(&pair[0])&&pair[1]<=0x1ffff{glyphs.push(Glyph{base:pair[0],marks:pair[1]});}
  else{return -1;}
 }
 word(&glyphs,&mut result);if result.len()>capacity{return -1;}
 std::ptr::copy_nonoverlapping(result.as_ptr(),output,result.len());result.len() as i32
}
