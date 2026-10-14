//! Hebrew Piper phonemization: the IPA rules and the Nakdimon pre/post-processing.
//! Rule-for-rule translation of the JavaScript implementation it replaced
//! (tests/unit/helpers/reference-hebrew.js is the frozen original).
//! Piper rules: OHF-Voice/piper1-gpl efffbfb226bfb511ebbcf55d0cecd8b35a89743d,
//! GPL-3.0; see public/neural-voice/phon/COPYING and hebrew-NOTICE.txt.
//! Nakdimon tables and merge: MIT, Copyright 2022 Elazar Gershuni (hebrew-NOTICE.txt).
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
/// The three geresh digraphs (gimel, zayin, tsadi + U+05F3) become one glyph the rules ignore.
fn combine(glyphs:&[Glyph])->Vec<Glyph>{
 let mut combined=Vec::with_capacity(glyphs.len());let mut i=0;
 while i<glyphs.len(){
  if matches!(glyphs[i].base,0x5d2|0x5d6|0x5e6)&&glyphs.get(i+1).is_some_and(|n|n.base==0x5f3){combined.push(Glyph{base:0,marks:0});i+=2;}
  else{combined.push(glyphs[i]);i+=1;}
 }
 combined
}
fn word(glyphs:&[Glyph],output:&mut Vec<u32>){
 let glyphs=&combine(glyphs)[..];
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
/// A base is any UTF-16 code point, a lone surrogate included: the rules do not know it.
#[no_mangle]
pub unsafe extern "C" fn hebrew_ipa_words(input:*const u32,pairs:usize,output:*mut u32,capacity:usize)->i32{
 if input.is_null()||output.is_null()||pairs>1_048_576||capacity>8_388_608{return -1;}
 let source=std::slice::from_raw_parts(input,pairs*2);let mut glyphs=Vec::new();let mut result=Vec::new();
 for pair in source.chunks_exact(2){
  if pair[0]==BREAK{word(&glyphs,&mut result);glyphs.clear();result.push(32);}
  else if pair[0]<=0x10ffff&&pair[1]<=0x1ffff{glyphs.push(Glyph{base:pair[0],marks:pair[1]});}
  else{return -1;}
 }
 word(&glyphs,&mut result);if result.len()>capacity{return -1;}
 std::ptr::copy_nonoverlapping(result.as_ptr(),output,result.len());result.len() as i32
}

// ---------------------------------------------------------------- Nakdimon (niqqud restoration model)
const RAFE:u32=0x5bf;const DAGESH_MARK:u32=0x5bc;const PATAH:u32=0x5b7;
/// The marks the model restores (and that a text with niqqud already carries).
fn is_niqqud(cp:u32)->bool{matches!(cp,0x5b0..=0x5bc|0x5bf|0x5c1|0x5c2|0x5c7)}
/// Python `str.isdigit` also accepts these non-decimal digits (and every Unicode Nd, which the host tells us).
fn other_digit(cp:u32)->bool{matches!(cp,0xb2|0xb3|0xb9|0x1369..=0x1371|0x19da|0x2070|0x2074..=0x2079|0x2080..=0x2089|0x2460..=0x2468|0x2474..=0x247c|0x2488..=0x2490|0x24ea|0x24f5..=0x24fd|0x24ff|0x2776..=0x277e|0x2780..=0x2788|0x278a..=0x2792|0x10a40..=0x10a43|0x10e60..=0x10e68|0x11052..=0x1105a|0x1f100..=0x1f10a)}
/// Index in the trained alphabet: 0 mask, 1 'H', 2 'O' (other), 3 '5' (digit), 4.. the 39 valid characters.
fn nakdimon_id(cp:u32,decimal:bool)->u32{
 const VALID:[u32;12]=[32,33,34,39,40,41,44,45,46,58,59,63];
 if let Some(at)=VALID.iter().position(|&v|v==cp){return 4+at as u32;}
 if (0x5d0..=0x5ea).contains(&cp){return 16+(cp-0x5d0);}
 let mapped=match cp{
  10|9=>32,0x5be|0x2012..=0x2015|0x2212=>45,91=>40,93=>41,0xb4|0x2018|0x2019=>39,0x201c|0x201d|0x5f4=>34,
  0x2026=>44,0x5f0..=0x5f2=>return 1,_=>{if decimal||other_digit(cp){return 3}return 2}
 };
 4+VALID.iter().position(|&v|v==mapped).unwrap() as u32
}
/// Character ids of a text without its niqqud, one f32 per code point. `decimal[i]` says
/// the host found `\p{Decimal_Number}`. Returns the number of ids, or -1 for misuse.
/// # Safety: live disjoint buffers: `count` u32 and bytes in, `count` f32 out.
#[no_mangle]
pub unsafe extern "C" fn nakdimon_ids(letters:*const u32,decimal:*const u8,count:usize,output:*mut f32)->i32{
 if (count>0&&(letters.is_null()||decimal.is_null()||output.is_null()))||count>16_777_216{return -1;}
 let mut written=0;
 for i in 0..count{
  let cp=*letters.add(i);if is_niqqud(cp){continue;}
  *output.add(written)=nakdimon_id(cp,*decimal.add(i)!=0) as f32;written+=1;
 }
 written as i32
}
fn can_dagesh(cp:u32)->bool{"בגדהוזטיכלמנספצקשתךף".chars().any(|c|c as u32==cp)}
fn can_niqqud(cp:u32)->bool{"אבגדהוזחטיכלמנסעפצקרשתךן".chars().any(|c|c as u32==cp)}
/// numpy.argmax over `rows` rows of `classes` f32 scores (the first of equal scores wins),
/// one class byte per row. 0 when a score is NaN or infinite, 1 when done, 2 for misuse.
/// # Safety: live disjoint buffers of `rows*classes` f32 and `rows` bytes.
#[no_mangle]
pub unsafe extern "C" fn nakdimon_argmax(scores:*const f32,rows:usize,classes:usize,output:*mut u8)->u32{
 if (rows>0&&(scores.is_null()||output.is_null()))||rows>4_194_304||classes==0||classes>256{return 2;}
 for row in 0..rows{
  let (mut best,mut score)=(0usize,f64::NEG_INFINITY);
  for class in 0..classes{
   let value=*scores.add(row*classes+class) as f64;
   if !value.is_finite(){return 0;}
   if value>score{best=class;score=value;}
  }
  *output.add(row)=best as u8;
 }
 1
}
/// Puts the predicted classes (16 niqqud, 3 dagesh and 4 sin classes per letter) back on the
/// original letters in Nakdimon's dagesh/dot/vowel order and drops the rafe, as upstream does.
/// Returns the number of code points written (at most 4 per letter) or -1 for misuse.
/// # Safety: live disjoint buffers of the declared sizes (`count` u32 and 3 x `count` bytes in).
#[no_mangle]
pub unsafe extern "C" fn nakdimon_assemble(letters:*const u32,count:usize,niqqud:*const u8,dagesh:*const u8,sin:*const u8,output:*mut u32)->i32{
 if (count>0&&(letters.is_null()||niqqud.is_null()||dagesh.is_null()||sin.is_null()||output.is_null()))||count>4_194_304{return -1;}
 const NIQQUD:[u32;16]=[0,RAFE,0x5b0,0x5b1,0x5b2,0x5b3,0x5b4,0x5b5,0x5b6,0x5b7,0x5b8,0x5b9,0x5ba,0x5bb,0x5bc,PATAH];
 let mut result:Vec<u32>=Vec::with_capacity(count*2);
 for i in 0..count{
  let letter=*letters.add(i);
  if letter!=RAFE{result.push(letter);}
  // No mark, or the rafe (removed, like the rafe of a letter that arrived with one).
  let mut put=|cp:u32|{if cp!=0&&cp!=RAFE{result.push(cp);}};
  let (n,d,s)=(*niqqud.add(i) as usize,*dagesh.add(i) as usize,*sin.add(i) as usize);
  if n>=16||d>=3||s>=4{return -1;}
  if can_dagesh(letter){put([0,RAFE,DAGESH_MARK][d]);}
  if letter==0x5e9{put([0,RAFE,0x5c1,0x5c2][s]);}
  if can_niqqud(letter){put(NIQQUD[n]);}
 }
 std::ptr::copy_nonoverlapping(result.as_ptr(),output,result.len());
 result.len() as i32
}
