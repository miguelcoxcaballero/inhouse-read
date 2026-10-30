//! "Compartir" in the lifted book's card: the book file itself goes to the system share sheet
//! (WhatsApp, mail, Drive, another reader…) in its ebook format (EPUB, PDF, MOBI, AZW/AZW3, FB2 or
//! CBZ) with the matching extension and type. In the Android app the bytes go to the native shell
//! in base64 pieces of one share session and the shell opens Android's chooser through its own
//! FileProvider; a browser uses the Web Share API with the file and, where files cannot be shared,
//! saves it instead. A book that is only in Google Drive is downloaded first, as "Descargar para usar
//! sin conexión" does. One share runs at a time.
use std::cell::Cell;
use wasm_bindgen::prelude::*;
use js_sys::{Array,Promise,Uint8Array};
use crate::cloud_host::{self,settle,start,object,string,error,error_with_code,get,set,call,nullish,or,construct,tick};
type R<T=()> = Result<T,JsValue>;

/// Raw bytes per piece handed to the Android shell: a multiple of 3, so each piece is valid base64 alone.
pub const CHUNK_BYTES:usize=3*128*1024;
/// What the Android shell accepts (BookShare.MAX_BYTES).
pub const NATIVE_LIMIT:f64=512.0*1024.0*1024.0;
/// UTF-8 bytes of the name before its extension (file systems allow 255 per name).
const STEM_BYTES:usize=180;
const HEAD_BYTES:f64=512.0;
/// Extension, type and the format labels and stored types that name it.
const KINDS:[(&str,&str,&[&str]);8]=[
 ("epub","application/epub+zip",&["epub","application/epub+zip"]),
 ("pdf","application/pdf",&["pdf","application/pdf","application/x-pdf"]),
 ("mobi","application/x-mobipocket-ebook",&["mobi","application/x-mobipocket-ebook"]),
 ("azw3","application/vnd.amazon.mobi8-ebook",&["azw3","application/x-azw3","application/vnd.amazon.mobi8-ebook"]),
 ("kf8","application/vnd.amazon.mobi8-ebook",&["kf8","application/x-kf8"]),
 ("azw","application/vnd.amazon.ebook",&["azw","application/vnd.amazon.ebook","application/x-azw"]),
 ("fb2","application/x-fictionbook+xml",&["fb2","application/x-fictionbook+xml","application/fb2"]),
 ("cbz","application/vnd.comicbook+zip",&["cbz","application/vnd.comicbook+zip","application/x-cbz"]),
];

thread_local!{static SHARING:Cell<bool>=const{Cell::new(false)};}
/// Clears the one-share-at-a-time flag however the share ends.
struct Running;
impl Drop for Running{fn drop(&mut self){SHARING.with(|flag|flag.set(false));}}

fn global()->JsValue{js_sys::global().into()}
fn attr(node:&JsValue,name:&str,value:&str)->R{call(node,"setAttribute",&[&name.into(),&value.into()])?;Ok(())}
fn kind(extension:&str)->Option<(&'static str,&'static str)>{KINDS.iter().find(|(ext,_,_)|*ext==extension).map(|(ext,mime,_)|(*ext,*mime))}

/// The ebook kind as `(extension, type)`: first from the bytes (PDF, an EPUB's leading `mimetype`
/// entry, a MOBI/AZW PalmDB, FictionBook XML), then from the format label, stored type and name.
pub fn ebook_kind(head:&[u8],mime:&str,format:&str,name:&str)->Option<(&'static str,&'static str)>{
 let (mime,format,name)=(mime.to_ascii_lowercase(),format.to_ascii_lowercase(),name.to_ascii_lowercase());
 let labelled=|labels:&[&str]|labels.iter().any(|label|*label==format||*label==mime);
 let named=|extension:&str|name.ends_with(&format!(".{extension}"));
 if head.starts_with(b"%PDF-"){return kind("pdf");}
 if head.starts_with(b"PK\x03\x04")&&head.get(30..58)==Some(b"mimetypeapplication/epub+zip".as_slice()){return kind("epub");}
 if head.get(60..68)==Some(b"BOOKMOBI".as_slice()){
  // The same container: the label or name tells MOBI, AZW and AZW3 apart.
  for (ext,mime,labels) in KINDS.iter().filter(|(ext,_,_)|["azw3","kf8","azw"].contains(ext)){
   if labelled(labels)||named(ext){return Some((*ext,*mime));}
  }
  return kind("mobi");
 }
 let text=String::from_utf8_lossy(head);
 if text.trim_start_matches('\u{feff}').trim_start().starts_with('<')&&text.contains("<FictionBook"){return kind("fb2");}
 KINDS.iter().find(|(ext,_,labels)|labelled(labels)||named(ext)).map(|(ext,mime,_)|(*ext,*mime))
}
/// `Title.epub`: the stored name when it already carries the extension, otherwise the title (or the
/// name without its extension). Characters that file systems or apps refuse become `_`, and the name
/// stays well under the 255 bytes Android allows, whatever the script.
pub fn share_file_name(name:&str,title:&str,extension:&str)->String{
 let dotted=format!(".{extension}");
 let base=if name.to_ascii_lowercase().ends_with(&dotted){&name[..name.len()-dotted.len()]}
  else if !title.trim().is_empty(){title}
  else{name.rsplit_once('.').map(|(stem,_)|stem).filter(|stem|!stem.trim().is_empty()).unwrap_or(name)};
 let clean:String=base.chars().map(|c|if c.is_control()||"/\\:*?\"<>|".contains(c){'_'}else{c}).collect();
 let clean=clean.trim().trim_start_matches('.').trim();
 let mut stem=String::new();
 for c in clean.chars(){if stem.len()+c.len_utf8()>STEM_BYTES{break;}stem.push(c);}
 let stem=stem.trim_end();
 format!("{}{dotted}",if stem.is_empty(){"libro"}else{stem})
}
/// Standard base64 with padding (what `android.util.Base64.decode` reads).
pub fn base64(bytes:&[u8])->String{
 const ALPHABET:&[u8;64]=b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
 let mut out=String::with_capacity(bytes.len().div_ceil(3)*4);
 for chunk in bytes.chunks(3){
  let word=(chunk[0] as u32)<<16|(*chunk.get(1).unwrap_or(&0) as u32)<<8|*chunk.get(2).unwrap_or(&0) as u32;
  out.push(ALPHABET[(word>>18&63) as usize] as char);out.push(ALPHABET[(word>>12&63) as usize] as char);
  out.push(if chunk.len()>1{ALPHABET[(word>>6&63) as usize] as char}else{'='});
  out.push(if chunk.len()>2{ALPHABET[(word&63) as usize] as char}else{'='});
 }
 out
}

async fn bytes(blob:&JsValue,start:f64,end:f64)->R<Vec<u8>>{
 let piece=call(blob,"slice",&[&start.into(),&end.into()])?;
 let buffer=settle(call(&piece,"arrayBuffer",&[])).await?;
 Ok(Uint8Array::new(&buffer).to_vec())
}
fn title_of(book:&JsValue)->String{string(&or(or(get(book,"title"),get(book,"name")),"Libro".into())).trim().to_owned()}
/// A failure whose message is complete as it is (no "No se pudo compartir el libro." before it).
fn notice_error(message:&str)->JsValue{error_with_code(message,"SHARE_NOTICE")}
fn too_large()->JsValue{notice_error("Este libro pesa más de 512 MB y no se puede compartir desde la app.")}

/// The Android shell (`window.InhouseBookShare`): `begin(name, type, title)` returns a session id,
/// then `append(id, base64)` per piece and `finish(id)`, which opens Android's chooser.
async fn share_native(bridge:&JsValue,file:&JsValue,name:&str,mime:&str,title:&str)->R{
 let failed=||error("Android no pudo preparar el libro para compartirlo.");
 let session=call(bridge,"begin",&[&name.into(),&mime.into(),&title.into()])?;
 if !session.is_truthy(){return Err(failed());}
 let size=cloud_host::number(&get(file,"size"));
 let mut offset=0.0;
 while offset<size{
  let end=(offset+CHUNK_BYTES as f64).min(size);
  let piece=bytes(file,offset,end).await?;
  if !call(bridge,"append",&[&session,&base64(&piece).into()])?.is_truthy(){return Err(failed());}
  offset=end;
  // Let the page paint between pieces of a large book.
  tick().await?;
 }
 if !call(bridge,"finish",&[&session])?.is_truthy(){return Err(failed());}
 Ok(())
}
/// A browser: the Web Share API with the file, or a download where files cannot be shared.
async fn share_web(host:&JsValue,file:&JsValue,title:&str)->R{
 let navigator=get(&global(),"navigator");
 let data=object(&[("files",Array::of1(file).into()),("title",title.into())]);
 let can_share=get(&navigator,"canShare").is_function()&&call(&navigator,"canShare",&[&data])?.is_truthy();
 if can_share&&get(&navigator,"share").is_function(){
  return match settle(call(&navigator,"share",&[&data])).await{
   Ok(_)=>Ok(()),
   // Closing the sheet is not a failure.
   Err(failure) if string(&get(&failure,"name"))=="AbortError"=>Ok(()),
   // A sign-in or a long download used up the tap; the book is on this device now.
   Err(failure) if string(&get(&failure,"name"))=="NotAllowedError"=>Err(notice_error("El libro ya está listo: pulsa Compartir otra vez.")),
   Err(failure)=>Err(failure),
  };
 }
 let document=cloud_host::read(host,"document")?;
 let url=call(&get(&global(),"URL"),"createObjectURL",&[file])?;
 let link=call(&document,"createElement",&[&"a".into()])?;
 attr(&link,"href",&string(&url))?;attr(&link,"download",&string(&get(file,"name")))?;
 set(&get(&link,"style"),"display",&"none".into());
 call(&get(&document,"body"),"append",&[&link])?;call(&link,"click",&[])?;call(&link,"remove",&[])?;
 let revoke=Closure::once_into_js(move||{let _=call(&get(&global(),"URL"),"revokeObjectURL",&[&url]);});
 call(&global(),"setTimeout",&[&revoke,&60_000.into()])?;
 Ok(())
}

async fn share(host:&JsValue,book:&JsValue)->R{
 // An Android shell from before 1.1.25 cannot receive files: say so before any sign-in or download.
 let android=call(host,"isAndroidShell",&[])?.is_truthy();
 let bridge=get(&global(),"InhouseBookShare");
 if android&&(nullish(&bridge)||!get(&bridge,"begin").is_function()){
  return Err(notice_error("Para compartir libros, actualiza la app de Android a la versión 1.1.25 o posterior."));
 }
 let known=cloud_host::number(&or(get(book,"sizeBytes"),get(book,"size")));
 if android&&known>NATIVE_LIMIT{return Err(too_large());}
 if !get(book,"content").is_truthy(){
  if !get(book,"driveFileId").is_truthy(){return Err(error("Este libro no está en el dispositivo ni en Google Drive."));}
  if !call(host,"hasDriveSession",&[])?.is_truthy(){settle(call(host,"requestDriveAccess",&[])).await?;}
 }
 let source=settle(call(&cloud_host::read(host,"cloudSync")?,"downloadForOffline",&[book])).await?;
 if nullish(&source){return Err(error("No se pudo preparar el libro."));}
 let size=cloud_host::number(&get(&source,"size"));
 if android&&size>NATIVE_LIMIT{return Err(too_large());}
 let head=bytes(&source,0.0,size.min(HEAD_BYTES)).await?;
 let stored=or(get(book,"name"),get(&source,"name"));
 let (extension,mime)=ebook_kind(&head,&string(&or(get(&source,"type"),or(get(book,"mimeType"),"".into()))),
  &string(&or(get(book,"format"),"".into())),&string(&or(stored.clone(),"".into())))
  .ok_or_else(||error("Este archivo no es un libro."))?;
 let title=title_of(book);
 let name=share_file_name(&string(&or(stored,"".into())),&title,extension);
 let file=construct("File",&[&Array::of1(&source).into(),&name.clone().into(),&object(&[("type",mime.into())])])?;
 if android{share_native(&bridge,&file,&name,mime,&title).await}else{share_web(host,&file,&title).await}
}

#[wasm_bindgen]
pub fn app_book_share(host:JsValue,book:JsValue,button:JsValue)->Promise{start(async move{
 if SHARING.with(|flag|flag.replace(true)){
  call(&host,"showAuthNotice",&[&"Ya se está preparando un libro para compartir.".into(),&object(&[])])?;
  return Ok(JsValue::UNDEFINED);
 }
 let _running=Running;
 set(&button,"disabled",&JsValue::TRUE);attr(&button,"aria-busy","true")?;
 let result=share(&host,&book).await;
 set(&button,"disabled",&JsValue::FALSE);call(&button,"removeAttribute",&[&"aria-busy".into()])?;
 if let Err(failure)=result{
  let message=cloud_host::message(&failure);
  if message!="Conexión cancelada."{
   let _=call(&get(&host,"console"),"warn",&[&"No se pudo compartir el libro:".into(),&failure]);
   let text=if get(&failure,"code")==JsValue::from_str("SHARE_NOTICE"){message}else{format!("No se pudo compartir el libro. {message}").trim_end().to_owned()};
   call(&host,"showAuthNotice",&[&text.into(),&object(&[])])?;
  }
 }
 Ok(JsValue::UNDEFINED)
})}
