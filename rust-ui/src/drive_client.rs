//! Google Drive access: the web sign-in and the Android authorization-code/PKCE flow, the
//! per-request account guard, folder lookup and the per-device library manifests, reading state
//! and uploads. The stored session, localStorage, fetch and the app's book helpers are host
//! callbacks; crypto, Google Identity Services, the Android bridge, the user agent, navigation,
//! the browser events and the console are the browser's own (see `Core::platform`).
//! `host`: `{session:{token,restore,save,clear}, storage:{getItem,setItem,removeItem}, androidClientId,
//! fetch, remembered, spineCustomization, cleanQuotes, normalizeDriveBookLength}`.
use std::{cell::{Cell,RefCell},rc::Rc};
use wasm_bindgen::{prelude::*,JsCast};
use js_sys::{Array,Function,Object,Promise,RegExp,Uint8Array};
use crate::cloud_host::*;
#[path="drive_live.rs"]mod live;

#[wasm_bindgen]
extern "C"{
 #[wasm_bindgen(js_name=encodeURIComponent)]fn encode_uri_component(value:&JsValue)->String;
}

const DRIVE_SCOPE:&str="https://www.googleapis.com/auth/drive.file";
const DRIVE_FILES_URL:&str="https://www.googleapis.com/drive/v3/files";
const UPLOAD_URL:&str="https://www.googleapis.com/upload/drive/v3/files";
const ABOUT_URL:&str="https://www.googleapis.com/drive/v3/about";
const PROFILE_KEY:&str="ihr_drive_profile_v2";
const DEFAULT_CLIENT_ID:&str="435784295430-cmug30o42f1vu4ijgor9sjb0ro4oo37o.apps.googleusercontent.com";
const ANDROID_PKCE_REDIRECT_URI:&str="com.inhousesoftware.read:/oauth2redirect";
const REFRESH_TOKEN_KEY:&str="ihr_drive_refresh_token_v1";
const PKCE_VERIFIER_KEY:&str="ihr_drive_pkce_verifier_v1";
const PKCE_TRANSACTION_KEY:&str="ihr_drive_pkce_transaction_v1";
const AUTH_TIMEOUT_MS:f64=10.0*60_000.0;
const FOLDER_NAME:&str="inhouse read";
const STATE_FOLDER_NAME:&str=".inhouse-read-state";
const FOLDER_MIME:&str="application/vnd.google-apps.folder";
const FILE_FIELDS:&str="fields=id,name,mimeType,size,md5Checksum";

/// A web sign-in waiting for Google's popup.
struct WebRequest{resolve:Function,reject:Function}
/// An Android sign-in waiting for the custom-scheme callback.
struct NativeRequest{resolve:Function,reject:Function,generation:f64,timer:u32}
struct Core{
 host:JsValue,generation:Cell<f64>,timers:Rc<Timers>,
 auth:RefCell<Option<Promise>>,folder:RefCell<Option<Promise>>,state_folder:RefCell<Option<Promise>>,
 revision_task:RefCell<Option<(f64,Promise)>>,revision_sequence:Cell<u64>,
 native:RefCell<Option<Rc<NativeRequest>>>,exchange:RefCell<Option<Promise>>,web:RefCell<Vec<Rc<WebRequest>>>,
}

/// URL-safe base64 without padding, as `btoa(...).replace(+,-).replace(/,_).replace(=+$,'')`.
fn base64_url(bytes:&[u8])->String{
 const ALPHABET:&[u8;64]=b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
 let mut out=String::with_capacity(bytes.len()*4/3+4);
 for chunk in bytes.chunks(3){
  let word=(chunk[0] as u32)<<16|(*chunk.get(1).unwrap_or(&0) as u32)<<8|*chunk.get(2).unwrap_or(&0) as u32;
  out.push(ALPHABET[(word>>18&63) as usize] as char);out.push(ALPHABET[(word>>12&63) as usize] as char);
  if chunk.len()>1{out.push(ALPHABET[(word>>6&63) as usize] as char);}
  if chunk.len()>2{out.push(ALPHABET[(word&63) as usize] as char);}
 }
 out
}
fn escape_drive_query(value:&JsValue)->String{string(value).replace('\\',"\\\\").replace('\'',"\\'")}
fn params(entries:&[(&str,JsValue)])->Result<JsValue,JsValue>{construct("URLSearchParams",&[&object(entries)])}
fn text(value:&JsValue)->Result<String,JsValue>{Ok(string(&call(value,"toString",&[])?))}
fn is_function_property(target:&JsValue,key:&str)->bool{get(target,key).is_function()}
/// `scope.split(/\s+/).includes(DRIVE_SCOPE)`.
fn grants_drive(scope:&JsValue)->Result<bool,JsValue>{
 let parts=Array::from(&call(scope,"split",&[&RegExp::new(r"\s+","")])?);
 Ok(parts.iter().any(|part|part.as_string().as_deref()==Some(DRIVE_SCOPE)))
}
fn generation_changed()->JsValue{error("La conexión de Google ha cambiado.")}
fn parse_date(value:&JsValue)->f64{js_sys::Date::parse(&string(value))}

/// A Drive response whose body is only handed out while the sign-in it was asked under still holds.
struct Guarded{core:Rc<Core>,response:JsValue,generation:f64}
impl Guarded{
 async fn read(&self,reader:&str)->Result<JsValue,JsValue>{
  self.core.require(self.generation)?;
  let body=settle(call(&self.response,reader,&[])).await?;
  self.core.require(self.generation)?;Ok(body)
 }
 async fn json(&self)->Result<JsValue,JsValue>{self.read("json").await}
 async fn blob(&self)->Result<JsValue,JsValue>{self.read("blob").await}
}

impl Core{
 /// A platform capability: the host's function of that name when it has one (unit tests pass
 /// doubles), otherwise the browser's own, read from the global at each use as the page did.
 fn platform(&self,name:&str,args:&[&JsValue])->Result<JsValue,JsValue>{
  if get(&self.host,name).is_function(){return call(&self.host,name,args);}
  let crypto=||read(&global(),"crypto");let navigator=||read(&global(),"navigator");
  match name{
   "randomBytes"=>call(&crypto()?,"getRandomValues",&[&construct("Uint8Array",args)?]),
   "sha256"=>call(&read(&crypto()?,"subtle")?,"digest",&[&"SHA-256".into(),args[0]]),
   "randomUUID"=>call(&crypto()?,"randomUUID",&[]),
   "google"=>Ok(get(&get(&get(&global(),"google"),"accounts"),"oauth2")),
   "bridge"=>Ok(get(&global(),"InhouseNative")),
   "userAgent"=>read(&navigator()?,"userAgent"),
   "offline"=>Ok(JsValue::from_bool(read(&navigator()?,"onLine")?==JsValue::FALSE)),
   "assign"=>call(&read(&global(),"location")?,"assign",args),
   "emit"=>{let event=construct("CustomEvent",&[args[0],&object(&[("detail",args[1].clone())])])?;call(&global(),"dispatchEvent",&[&event])}
   "warn"=>call(&read(&global(),"console")?,"warn",args),
   _=>Err(error(&format!("Missing host function {name}"))),
  }
 }
 fn session(&self,name:&str,args:&[&JsValue])->Result<JsValue,JsValue>{call(&get(&self.host,"session"),name,args)}
 fn storage(&self,name:&str,args:&[&JsValue])->Result<JsValue,JsValue>{call(&get(&self.host,"storage"),name,args)}
 fn stored(&self,key:&str)->Result<JsValue,JsValue>{self.storage("getItem",&[&key.into()])}
 fn remove(&self,key:&str)->Result<(),JsValue>{self.storage("removeItem",&[&key.into()])?;Ok(())}
 fn require(&self,generation:f64)->Result<(),JsValue>{if generation!=self.generation.get(){Err(generation_changed())}else{Ok(())}}
 fn client_id(&self)->JsValue{get(&self.host,"androidClientId")}
 fn native_shell(&self)->Result<bool,JsValue>{
  let agent=or(self.platform("userAgent",&[])?,"".into());
  Ok(RegExp::new(r"\bInhouseReadApp\/\d","i").test(&string(&agent)))
 }
 fn native_bridge(&self)->Result<bool,JsValue>{Ok(is_function_property(&self.platform("bridge",&[])?,"openAuthUrl"))}

 /// Remember a token for as long as Google says it lives (at least a minute, an hour if unsaid).
 fn save_token(&self,token:&JsValue,lifetime_seconds:&JsValue)->Result<JsValue,JsValue>{
  if !token.is_truthy(){return Err(error("Google no devolvió un token de acceso."));}
  let lifetime=number_or_zero(lifetime_seconds);let seconds=js_sys::Math::max(60.0,if lifetime!=0.0{lifetime}else{3600.0});
  self.session("save",&[token,&(js_sys::Date::now()+seconds*1000.0).into()])?;Ok(token.clone())
 }

 // ---- web sign-in ----
 fn request_web(self:&Rc<Self>)->Result<Promise,JsValue>{
  let oauth=self.platform("google",&[])?;
  let init=get(&oauth,"initTokenClient");
  if !oauth.is_truthy()||!init.is_truthy(){
   return Err(error(if self.platform("offline",&[])?.is_truthy(){"Sin conexión a Internet."}else{"Google está cargando. Pulsa Conectar otra vez."}));
  }
  let core=self.clone();let generation=self.generation.get();
  let promise=Promise::new(&mut|resolve,reject|{
   let request=Rc::new(WebRequest{resolve,reject});
   core.web.borrow_mut().push(request.clone());
   let finish={let (core,request)=(core.clone(),request.clone());Rc::new(move|value:Result<JsValue,JsValue>|{
    core.web.borrow_mut().retain(|known|!Rc::ptr_eq(known,&request));
    let _=match value{Ok(value)=>request.resolve.call1(&JsValue::UNDEFINED,&value),Err(error)=>request.reject.call1(&JsValue::UNDEFINED,&error)};
   })};
   let attempt=||->Result<(),JsValue>{
    let callback={let (core,finish)=(core.clone(),finish.clone());Closure::wrap(Box::new(move|response:JsValue|{
     if generation!=core.generation.get(){return finish(Err(error("Sesión cerrada.")));}
     let failure=get(&response,"error");
     if failure.is_truthy(){return finish(Err(error(&string(&or(get(&response,"error_description"),failure)))));}
     let scope=get(&response,"scope");
     if scope.is_truthy()&&!grants_drive(&scope).unwrap_or(false){return finish(Err(error("No se concedió acceso a los libros de Drive.")));}
     finish(core.save_token(&get(&response,"access_token"),&get(&response,"expires_in")));
    })as Box<dyn FnMut(JsValue)>)};
    let failed={let finish=finish.clone();Closure::wrap(Box::new(move|failure:JsValue|{
     let kind=get(&failure,"type").as_string().unwrap_or_default();
     finish(Err(error(match kind.as_str(){
      "popup_closed"=>"Se cerró la ventana de Google. Pulsa Conectar.",
      "popup_failed_to_open"=>"Ventana de Google bloqueada. Permite las ventanas emergentes.",
      _=>"No se pudo abrir Google. Reintenta."
     })));
    })as Box<dyn FnMut(JsValue)>)};
    let client=call(&oauth,"initTokenClient",&[&object(&[("client_id",DEFAULT_CLIENT_ID.into()),("scope",DRIVE_SCOPE.into()),
     ("include_granted_scopes",JsValue::TRUE),("callback",callback.as_ref().clone()),("error_callback",failed.as_ref().clone())])])?;
    // Google keeps both callbacks for the life of the token client.
    callback.forget();failed.forget();
    // This runs in the original button click, before an await can lose the browser's user gesture
    // and cause the Google popup to be blocked.
    let prompt=if call(&self.host,"remembered",&[])?.is_truthy(){""}else{"consent"};
    call(&client,"requestAccessToken",&[&object(&[("prompt",prompt.into())])])?;Ok(())
   };
   if let Err(failure)=attempt(){finish(Err(failure));}
  });
  Ok(promise)
 }

 // ---- PKCE (ported from Notes: verifier, challenge, authorization URL, code exchange, refresh) ----
 fn random_token(&self)->Result<String,JsValue>{
  let bytes=Uint8Array::new(&self.platform("randomBytes",&[&32.into()])?);
  Ok(base64_url(&bytes.to_vec()))
 }
 async fn challenge(&self,verifier:&str)->Result<String,JsValue>{
  let digest=settle(self.platform("sha256",&[&Uint8Array::from(verifier.as_bytes())])).await?;
  Ok(base64_url(&Uint8Array::new(&digest).to_vec()))
 }
 async fn token_request(self:Rc<Self>,body:JsValue,generation:f64)->Result<JsValue,JsValue>{
  // Same deadline and sign-out guard as Notes' refresh-token request.
  let controller=construct("AbortController",&[])?;
  let abort=controller.clone();
  let seq=self.timers.start(20_000.0,move||{let _=call(&abort,"abort",&[]);});
  let fetched=async{
   let response=settle(call(&self.host,"fetch",&[&"https://oauth2.googleapis.com/token".into(),&object(&[
    ("method","POST".into()),("headers",object(&[("Content-Type","application/x-www-form-urlencoded".into())])),
    ("body",text(&body)?.into()),("signal",get(&controller,"signal"))])])).await?;
   let data=settle(call(&response,"json",&[])).await?;Ok::<(JsValue,JsValue),JsValue>((response,data))
  }.await;
  let outcome=match fetched{
   Ok(pair)=>Ok(pair),
   Err(failure)=>Err(if get(&get(&controller,"signal"),"aborted").is_truthy(){error("Google tardó demasiado. Reintenta.")}else{failure}),
  };
  self.timers.clear(seq);
  let (response,data)=outcome?;
  if generation!=self.generation.get(){return Err(error("Sesión cerrada."));}
  if !get(&response,"ok").is_truthy()||!get(&data,"access_token").is_truthy(){
   let failure=error(&string(&or(or(get(&data,"error_description"),get(&data,"error")),"Google no devolvió un token de acceso.".into())));
   set(&failure,"status",&get(&response,"status"));return Err(failure);
  }
  let scope=get(&data,"scope");
  if scope.is_truthy()&&!grants_drive(&scope)?{return Err(error("No se concedió acceso a los libros de Drive."));}
  let refresh=get(&data,"refresh_token");
  if refresh.is_truthy(){self.storage("setItem",&[&REFRESH_TOKEN_KEY.into(),&refresh])?;}
  self.save_token(&get(&data,"access_token"),&get(&data,"expires_in"))
 }
 async fn refresh(self:Rc<Self>)->Result<JsValue,JsValue>{
  let refresh=self.stored(REFRESH_TOKEN_KEY)?;
  if !refresh.is_truthy(){return Err(error("Sesión caducada. Pulsa Conectar."));}
  let body=params(&[("client_id",self.client_id()),("grant_type","refresh_token".into()),("refresh_token",refresh)])?;
  let generation=self.generation.get();
  match self.clone().token_request(body,generation).await{
   Ok(token)=>Ok(token),
   Err(failure)=>{
    let status=get(&failure,"status");
    if status==JsValue::from_f64(400.0)||status==JsValue::from_f64(401.0){self.remove(REFRESH_TOKEN_KEY)?;}
    Err(failure)
   }
  }
 }
 async fn start_pkce(self:Rc<Self>,generation:f64)->Result<(),JsValue>{
  let verifier=self.random_token()?;
  let challenge=self.challenge(&verifier).await?;
  if generation!=self.generation.get(){return Err(error("Conexión cancelada."));}
  let state=self.random_token()?;
  self.storage("setItem",&[&PKCE_VERIFIER_KEY.into(),&verifier.into()])?;
  self.storage("setItem",&[&PKCE_TRANSACTION_KEY.into(),&json(&object(&[("state",state.clone().into()),("createdAt",js_sys::Date::now().into())]))?.into()])?;
  let url=construct("URL",&[&"https://accounts.google.com/o/oauth2/v2/auth".into()])?;
  let query=get(&url,"searchParams");
  for (key,value) in [("client_id",self.client_id()),("redirect_uri",ANDROID_PKCE_REDIRECT_URI.into()),("response_type","code".into()),
   ("scope",DRIVE_SCOPE.into()),("access_type","offline".into()),("include_granted_scopes","true".into()),
   ("code_challenge",challenge.into()),("code_challenge_method","S256".into()),("state",state.into())]{call(&query,"set",&[&key.into(),&value])?;}
  if !self.stored(REFRESH_TOKEN_KEY)?.is_truthy(){call(&query,"set",&[&"prompt".into(),&"consent".into()])?;}
  let address=text(&url)?;
  // If the native bridge does not really answer the call (checked before, but that only looks that the
  // function exists), the tab itself is sent to Google's page instead of doing nothing.
  let bridge=self.platform("bridge",&[])?;
  if !is_function_property(&bridge,"openAuthUrl"){
   self.platform("warn",&[&"PKCE sign-in: puente Android no disponible, se usa el flujo web como respaldo.".into()])?;
   self.platform("assign",&[&address.into()])?;return Ok(());
  }
  call(&bridge,"openAuthUrl",&[&address.into()])?;Ok(())
 }
 async fn request_native(self:Rc<Self>,interactive:bool)->Result<JsValue,JsValue>{
  let generation=self.generation.get();
  if !self.client_id().is_truthy(){return Err(error("Falta configurar el cliente OAuth Android de Inhouse Read."));}
  if self.stored(REFRESH_TOKEN_KEY)?.is_truthy(){
   match self.clone().refresh().await{
    Ok(token)=>return Ok(token),
    Err(failure)=>{if !interactive||generation!=self.generation.get(){return Err(failure);}}
   }
  }
  if !interactive{return Err(error("Sesión caducada. Pulsa Conectar."));}
  let core=self.clone();
  let mut pending_slot=None;
  let promise=Promise::new(&mut|resolve,reject|{
   let owner=core.clone();
   let seq=core.timers.start(AUTH_TIMEOUT_MS,move||{
    if owner.native.borrow().as_ref().map(|pending|pending.generation)!=Some(generation){return;}
    owner.cancel("La conexión con Google caducó. Reintenta.");
   });
   let pending=Rc::new(NativeRequest{resolve,reject,generation,timer:seq});
   *core.native.borrow_mut()=Some(pending.clone());pending_slot=Some(pending);
  });
  let pending=pending_slot.expect("Promise executors run synchronously");
  let (owner,watched)=(self.clone(),pending.clone());
  let started=start(async move{owner.start_pkce(generation).await.map(|_|JsValue::UNDEFINED)});
  let (owner,watched_request)=(self.clone(),watched.clone());
  let report=Closure::once_into_js(move|failure:JsValue|{
   let current=owner.native.borrow().as_ref().is_some_and(|known|Rc::ptr_eq(known,&watched_request));
   if current{*owner.native.borrow_mut()=None;}
   owner.timers.clear(watched_request.timer);
   let _=watched_request.reject.call1(&JsValue::UNDEFINED,&failure);
  });
  call(&started,"catch",&[&report])?;
  settle(Ok(promise.into())).await
 }
 /// Settles a native request: its timer stops first, then the outcome goes to the waiting caller.
 fn finish_native(&self,pending:&NativeRequest,value:Result<JsValue,JsValue>){
  self.timers.clear(pending.timer);
  let _=match value{Ok(value)=>pending.resolve.call1(&JsValue::UNDEFINED,&value),Err(failure)=>pending.reject.call1(&JsValue::UNDEFINED,&failure)};
 }

 /// MainActivity relays the custom-scheme callback exactly as Notes does.
 fn native_callback(self:&Rc<Self>,payload:&JsValue)->Result<bool,JsValue>{
  if self.exchange.borrow().is_some(){return Ok(true);} // Native delivery can be retried after a reload.
  let pending=self.native.borrow().clone();
  let generation=self.generation.get();
  let transaction=self.stored(PKCE_TRANSACTION_KEY).and_then(|raw|parse(&or(raw,"null".into()))).unwrap_or(JsValue::UNDEFINED);
  let text_payload=string(&or(payload.clone(),"".into()));
  let query=text_payload.strip_prefix(['#','?']).unwrap_or(&text_payload).to_owned();
  let query=construct("URLSearchParams",&[&query.into()])?;
  // Persisted transaction, as with Notes' verifier, survives Android destroying the WebView while the
  // account chooser is in front. No in-memory promise required.
  if !transaction.is_truthy()||get(&transaction,"state")!=call(&query,"get",&[&"state".into()])?{return Ok(true);}
  let fail=|failure:JsValue|{
   match &pending{
    Some(pending)=>self.finish_native(pending,Err(failure)),
    None=>if generation==self.generation.get(){let _=self.platform("emit",&[&"inhouse-drive-auth".into(),&object(&[("error",get(&failure,"message"))])]);}
   }
  };
  *self.native.borrow_mut()=None;
  self.remove(PKCE_TRANSACTION_KEY)?;
  let verifier=self.stored(PKCE_VERIFIER_KEY)?;
  self.remove(PKCE_VERIFIER_KEY)?;
  if js_sys::Date::now()-number(&get(&transaction,"createdAt"))>AUTH_TIMEOUT_MS{fail(error("La conexión con Google caducó. Reintenta."));return Ok(true);}
  let denied=call(&query,"get",&[&"error".into()])?;
  if denied.is_truthy(){
   fail(error(if denied.as_string().as_deref()==Some("access_denied"){"No se ha autorizado la conexión con Google."}else{"No se pudo conectar con Google. Reintenta."}));
   return Ok(true);
  }
  let code=call(&query,"get",&[&"code".into()])?;
  if !code.is_truthy()||!verifier.is_truthy(){fail(error("Google no devolvió un código de autorización válido."));return Ok(true);}
  let body=params(&[("client_id",self.client_id()),("code",code),("code_verifier",verifier),
   ("grant_type","authorization_code".into()),("redirect_uri",ANDROID_PKCE_REDIRECT_URI.into())])?;
  let core=self.clone();
  let exchange=start(async move{
   let outcome=core.clone().token_request(body,generation).await;
   match outcome{
    Ok(token)=>{
     match &pending{
      Some(pending)=>core.finish_native(pending,Ok(token.clone())),
      None=>{let _=core.platform("emit",&[&"inhouse-drive-auth".into(),&object(&[("connected",JsValue::TRUE)])]);}
     }
     Ok(token)
    },
    Err(failure)=>{
     match &pending{
      Some(pending)=>core.finish_native(pending,Err(failure)),
      None=>if generation==core.generation.get(){let _=core.platform("emit",&[&"inhouse-drive-auth".into(),&object(&[("error",get(&failure,"message"))])]);}
     }
     Ok(JsValue::UNDEFINED)
    }
   }
  });
  let owner=self.clone();let mine=exchange.clone();
  let release=Closure::once_into_js(move||{
   let current=owner.exchange.borrow().clone();
   if current.is_some_and(|current|JsValue::from(current)==JsValue::from(mine)){*owner.exchange.borrow_mut()=None;}
  });
  let _=call(&exchange,"finally",&[&release]);
  *self.exchange.borrow_mut()=Some(exchange);
  Ok(true)
 }

 fn cancel(&self,message:&str){
  self.generation.set(self.generation.get()+1.0);
  *self.folder.borrow_mut()=None;*self.state_folder.borrow_mut()=None;
  *self.revision_task.borrow_mut()=None;self.revision_sequence.set(self.revision_sequence.get().wrapping_add(1));
  let waiting:Vec<Rc<WebRequest>>=self.web.borrow().clone();
  for request in waiting{
   self.web.borrow_mut().retain(|known|!Rc::ptr_eq(known,&request));
   let _=request.reject.call1(&JsValue::UNDEFINED,&error(message));
  }
  let pending=self.native.borrow_mut().take();
  if let Some(pending)=pending{
   // Rejects through the request's own finisher: its timer stops with it.
   self.finish_native(&pending,Err(error(message)));
  }
  let _=self.remove(PKCE_TRANSACTION_KEY);let _=self.remove(PKCE_VERIFIER_KEY);
  *self.auth.borrow_mut()=None;*self.exchange.borrow_mut()=None;
 }
 fn sign_out(&self)->Result<(),JsValue>{
  self.cancel("Sesión cerrada.");
  self.session("clear",&[])?;
  for key in [REFRESH_TOKEN_KEY,PKCE_VERIFIER_KEY,PROFILE_KEY]{self.remove(key)?;}
  *self.folder.borrow_mut()=None;*self.state_folder.borrow_mut()=None;Ok(())
 }

 fn request_access(self:&Rc<Self>,options:&JsValue)->Promise{
  let restored=match self.session("restore",&[]){Ok(token)=>token,Err(failure)=>return Promise::reject(&failure)};
  if restored.is_truthy(){return Promise::resolve(&self.session("token",&[]).unwrap_or(JsValue::UNDEFINED));}
  if let Some(auth)=self.auth.borrow().clone(){return auth;}
  let interactive=get(options,"interactive");let interactive=if interactive.is_undefined(){true}else{interactive.is_truthy()};
  let outcome=(||->Result<Result<Promise,JsValue>,JsValue>{
   let bridge=self.native_bridge()?;
   if self.native_shell()?&&!bridge{
    return Ok(Err(error_with_code("Esta versión de Android no admite Drive.","ANDROID_SHELL_OUTDATED")));
   }
   if !interactive&&!bridge{return Ok(Err(error("Sesión caducada. Pulsa Conectar.")));}
   Ok(Ok(if bridge{let core=self.clone();start(async move{core.request_native(interactive).await})}else{self.request_web()?}))
  })();
  let request=match outcome{Ok(Ok(request))=>request,Ok(Err(failure))|Err(failure)=>return Promise::reject(&failure)};
  *self.auth.borrow_mut()=Some(request.clone());
  let owner=self.clone();let mine=request.clone();
  let release=Closure::once_into_js(move||{
   let current=owner.auth.borrow().clone();
   if current.is_some_and(|current|JsValue::from(current)==JsValue::from(mine)){*owner.auth.borrow_mut()=None;}
  });
  call(&request,"finally",&[&release]).expect("Promise.prototype.finally exists").into()
 }
 async fn access_token(self:Rc<Self>)->Result<JsValue,JsValue>{
  if self.session("restore",&[])?.is_truthy(){return self.session("token",&[]);}
  settle(Ok(self.request_access(&object(&[("interactive",JsValue::FALSE)])).into())).await
 }

 // ---- requests ----
 async fn fetch(self:&Rc<Self>,url:&JsValue,options:&JsValue,generation:f64)->Result<Guarded,JsValue>{
  self.require(generation)?;
  let token=self.clone().access_token().await?;
  self.require(generation)?;
  let init=object(&[]);assign(&init,options)?;
  let headers=object(&[("Authorization",format!("Bearer {}",string(&token)).into())]);
  assign(&headers,&get(options,"headers"))?;
  set(&init,"headers",&headers);
  let response=settle(call(&self.host,"fetch",&[url,&init])).await?;
  self.require(generation)?;
  if !get(&response,"ok").is_truthy(){
   let status=get(&response,"status");
   if status==JsValue::from_f64(401.0)&&self.session("token",&[])?==token{self.session("clear",&[])?;}
   let mut failure=format!("Google Drive: error {}",string(&status));
   if let Ok(body)=settle(call(&response,"json",&[])).await{
    let reported=get(&get(&body,"error"),"message");if reported.is_truthy(){failure=string(&reported);}
   }
   let failure=error(&failure);set(&failure,"status",&status);return Err(failure);
  }
  Ok(Guarded{core:self.clone(),response,generation})
 }
 async fn json(self:&Rc<Self>,url:&str,options:&JsValue,generation:f64)->Result<JsValue,JsValue>{
  self.fetch(&url.into(),options,generation).await?.json().await
 }

 async fn find_folder(self:&Rc<Self>,name:&str,parent:Option<&JsValue>,generation:f64)->Result<JsValue,JsValue>{
  let mut clauses=vec![format!("name = '{}'",escape_drive_query(&name.into())),format!("mimeType = '{FOLDER_MIME}'"),"trashed = false".to_owned()];
  if let Some(parent)=parent{if parent.is_truthy(){clauses.push(format!("'{}' in parents",string(parent)));}}
  let query=params(&[("q",clauses.join(" and ").into()),("spaces","drive".into()),("fields","files(id,name)".into()),("pageSize","100".into())])?;
  let found=self.json(&format!("{DRIVE_FILES_URL}?{}",text(&query)?),&object(&[]),generation).await?;
  let first=get(&get(&found,"files"),"0");
  Ok(or(get(&first,"id"),JsValue::NULL))
 }
 async fn find_or_create_folder(self:&Rc<Self>,name:&str,parent:Option<&JsValue>,generation:f64)->Result<JsValue,JsValue>{
  let found=self.find_folder(name,parent,generation).await?;
  self.require(generation)?;
  if found.is_truthy(){return Ok(found);}
  let metadata=object(&[("name",name.into()),("mimeType",FOLDER_MIME.into())]);
  if let Some(parent)=parent{if parent.is_truthy(){set(&metadata,"parents",&Array::of1(parent).into());}}
  let created=self.json(DRIVE_FILES_URL,&object(&[("method","POST".into()),("headers",object(&[("Content-Type","application/json".into())])),
   ("body",json(&metadata)?.into())]),generation).await?;
  Ok(get(&created,"id"))
 }
 /// The cached lookup of one folder: a failure is dropped again so a later call retries,
 /// but only while the failed lookup is still the cached one.
 fn cached_folder(self:&Rc<Self>,slot:fn(&Core)->&RefCell<Option<Promise>>,lookup:impl std::future::Future<Output=Result<JsValue,JsValue>>+'static)->Promise{
  let found=start(lookup);
  let cell:Rc<RefCell<Option<Promise>>>=Rc::new(RefCell::new(None));
  let (core,mine)=(self.clone(),cell.clone());
  let drop_failed=Closure::once_into_js(move|failure:JsValue|->Result<JsValue,JsValue>{
   let current=slot(&core).borrow().clone();
   if let (Some(current),Some(own))=(current,mine.borrow().clone()){if JsValue::from(current)==JsValue::from(own){*slot(&core).borrow_mut()=None;}}
   Err(failure)
  });
  let task:Promise=call(&found,"catch",&[&drop_failed]).expect("Promise.prototype.catch exists").into();
  *cell.borrow_mut()=Some(task.clone());task
 }
 async fn read_folder(self:Rc<Self>)->Result<JsValue,JsValue>{
  let generation=self.generation.get();
  if self.folder.borrow().is_none(){
   let core=self.clone();
   let task=self.cached_folder(|core|&core.folder,async move{core.find_or_create_folder(FOLDER_NAME,None,generation).await});
   *self.folder.borrow_mut()=Some(task);
  }
  let task=self.folder.borrow().clone().expect("Folder lookup was just started");
  let result=settle(Ok(task.into())).await?;
  self.require(generation)?;Ok(result)
 }
 async fn state_folder_id(self:Rc<Self>)->Result<JsValue,JsValue>{
  let generation=self.generation.get();
  if self.state_folder.borrow().is_none(){
   let core=self.clone();
   let task=self.cached_folder(|core|&core.state_folder,async move{
    let parent=settle(Ok(core.clone().read_folder_promise().into())).await?;
    core.find_or_create_folder(STATE_FOLDER_NAME,Some(&parent),generation).await
   });
   *self.state_folder.borrow_mut()=Some(task);
  }
  let task=self.state_folder.borrow().clone().expect("State folder lookup was just started");
  let result=settle(Ok(task.into())).await?;
  self.require(generation)?;Ok(result)
 }
 fn read_folder_promise(self:Rc<Self>)->Promise{start(async move{self.read_folder().await})}

 async fn list_folder(self:&Rc<Self>,folder:&JsValue,options:&JsValue,generation:f64)->Result<JsValue,JsValue>{
  let fields=get(options,"fields");let fields=if fields.is_undefined(){"id,name,mimeType,size,modifiedTime,md5Checksum".into()}else{string(&fields)};
  let size=get(options,"pageSize");let size=if size.is_undefined(){"100".to_owned()}else{string(&size)};
  let query=params(&[("q",format!("'{}' in parents and trashed = false",string(folder)).into()),
   ("fields",format!("nextPageToken,files({fields})").into()),("pageSize",size.into()),("spaces","drive".into())])?;
  let token=get(options,"pageToken");
  if token.is_truthy(){call(&query,"set",&[&"pageToken".into(),&token])?;}
  self.json(&format!("{DRIVE_FILES_URL}?{}",text(&query)?),&object(&[]),generation).await
 }
 async fn state_folder_lookup(self:&Rc<Self>,generation:f64)->Result<Option<JsValue>,JsValue>{
  let root=self.find_folder(FOLDER_NAME,None,generation).await?;
  if !root.is_truthy(){return Ok(None);}
  let folder=self.find_folder(STATE_FOLDER_NAME,Some(&root),generation).await?;
  Ok(if folder.is_truthy(){Some(folder)}else{None})
 }

 // Each installation owns one manifest. Devices never PATCH another device's snapshot, so
 // simultaneous saves cannot erase an entire library.
 fn library_revision_promise(self:&Rc<Self>)->Promise{
  let generation=self.generation.get();
  if let Some((owner,task))=self.revision_task.borrow().as_ref(){if *owner==generation{return task.clone();}}
  let sequence=self.revision_sequence.get().wrapping_add(1);self.revision_sequence.set(sequence);
  // Install the shared promise before starting synchronous host callbacks, so
  // a reentrant observer joins this request too. No settled result is cached.
  let mut resolver=None;
  let shared=Promise::new(&mut|resolve,_reject|{resolver=Some(resolve);});
  *self.revision_task.borrow_mut()=Some((generation,shared.clone()));
  let core=self.clone();
  let task=start(async move{
   let result=core.clone().library_revision().await;
   if core.revision_sequence.get()==sequence{*core.revision_task.borrow_mut()=None;}
   result
  });
  let _=resolver.expect("Promise executor is synchronous").call1(&JsValue::UNDEFINED,&task);
  shared
 }
 async fn library_revision(self:Rc<Self>)->Result<JsValue,JsValue>{
  let generation=self.generation.get();
  let cached=self.state_folder.borrow().clone();
  let folder=if let Some(cached)=cached{settle(Ok(cached.into())).await?}else{
   let root=self.find_folder(FOLDER_NAME,None,generation).await?;
   if !root.is_truthy(){return Ok("[]".into());}
   let folder=self.find_folder(STATE_FOLDER_NAME,Some(&root),generation).await?;
   if !folder.is_truthy(){return Ok("[]".into());}
   *self.state_folder.borrow_mut()=Some(Promise::resolve(&folder));folder
  };
  self.require(generation)?;
  let pattern=RegExp::new(r"^library-v1-[\w-]+\.json$","");let live_pattern=RegExp::new(r"^live-v1-[A-Za-z0-9_-]{8,128}\.json$","");let rows=Array::new();let peers=Array::new();let mut token=JsValue::UNDEFINED;
  loop{
   let page=self.list_folder(&folder,&object(&[("fields","id,name,modifiedTime,appProperties".into()),("pageToken",token)]),generation).await?;
   for file in Array::from(&or(get(&page,"files"),Array::new().into())).iter(){
    if pattern.test(&string(&get(&file,"name"))){rows.push(&Array::of2(&get(&file,"id"),&get(&file,"modifiedTime")));}
    // appProperties are private to an OAuth application. Android and web
    // discover the same account's directed mailboxes by their public names;
    // the authenticated encrypted payload still validates both identities.
    if live_pattern.test(&string(&get(&file,"name"))){peers.push(&file);}
   }
   token=get(&page,"nextPageToken");if !token.is_truthy(){break;}
  }
  self.platform("emit",&[&"inhouse-drive-live-peers".into(),&object(&[("folderId",folder),("peers",peers.into())])])?;
  call(&rows,"sort",&[])?;Ok(json_text(&rows.into())?.into())
 }
 async fn read_snapshots(self:Rc<Self>)->Result<JsValue,JsValue>{
  let generation=self.generation.get();
  let snapshots=Array::new();
  let root=self.find_folder(FOLDER_NAME,None,generation).await?;
  if !root.is_truthy(){return Ok(snapshots.into());}
  let folder=self.find_folder(STATE_FOLDER_NAME,Some(&root),generation).await?;
  if !folder.is_truthy(){return Ok(snapshots.into());}
  let pattern=RegExp::new(r"^library-v1-[\w-]+\.json$","");
  let mut token=JsValue::UNDEFINED;
  loop{
   let page=self.list_folder(&folder,&object(&[("pageToken",token.clone())]),generation).await?;
   for file in Array::from(&or(get(&page,"files"),Array::new().into())).iter(){
    if !pattern.test(&string(&get(&file,"name"))){continue;}
    let data=self.json(&format!("{DRIVE_FILES_URL}/{}?alt=media",encode_uri_component(&get(&file,"id"))),&object(&[]),generation).await?;
    if get(&data,"schemaVersion")!=JsValue::from_f64(1.0)||!get(&data,"deviceId").is_truthy()||!Array::is_array(&get(&data,"books")){
     return Err(error("La copia de la biblioteca en Drive no es válida. No se ha sobrescrito."));
    }
    let entry=object(&[]);assign(&entry,&data)?;set(&entry,"stateFileId",&get(&file,"id"));snapshots.push(&entry);
   }
   token=get(&page,"nextPageToken");
   if !token.is_truthy(){break;}
  }
  Ok(snapshots.into())
 }
 async fn write_snapshot(self:Rc<Self>,snapshot:JsValue,state_file_id:JsValue)->Result<JsValue,JsValue>{
  let generation=self.generation.get();
  let parent=if state_file_id.is_truthy(){JsValue::UNDEFINED}else{self.clone().state_folder_id().await?};
  let file=construct("File",&[&Array::of1(&json_text(&snapshot)?.into()).into(),&format!("library-v1-{}.json",string(&get(&snapshot,"deviceId"))).into(),&object(&[("type","application/json".into())])])?;
  self.upload(file,object(&[("driveFileId",state_file_id),("parentId",parent)]),generation).await
 }
 async fn upload_cover(self:Rc<Self>,cover:JsValue,name:JsValue)->Result<JsValue,JsValue>{
  let generation=self.generation.get();
  let parent=self.clone().state_folder_id().await?;
  let kind=or(get(&cover,"type"),"image/jpeg".into());
  let file=construct("File",&[&Array::of1(&cover).into(),&name,&object(&[("type",kind)])])?;
  self.upload(file,object(&[("parentId",parent)]),generation).await
 }

 async fn list_books(self:Rc<Self>,options:JsValue,generation:Option<f64>)->Result<JsValue,JsValue>{
  let generation=generation.unwrap_or(self.generation.get());
  // Reading an empty account must not create folders or upload any files.
  let folder=self.find_folder(FOLDER_NAME,None,generation).await?;
  self.require(generation)?;
  if folder.is_truthy(){self.list_folder(&folder,&options,generation).await}else{Ok(object(&[("files",Array::new().into())]))}
 }
 async fn list_all_books(self:Rc<Self>)->Result<JsValue,JsValue>{
  let generation=self.generation.get();
  let files=Array::new();
  let books=RegExp::new(r"\.(pdf|epub|mobi|azw|azw3|fb2|cbz)$","i");
  let mut token=JsValue::UNDEFINED;
  loop{
   let page=self.clone().list_books(object(&[("pageToken",token.clone())]),Some(generation)).await?;
   self.require(generation)?;
   for file in Array::from(&or(get(&page,"files"),Array::new().into())).iter(){
    if books.test(&string(&or(get(&file,"name"),"".into()))){files.push(&file);}
   }
   token=get(&page,"nextPageToken");
   if !token.is_truthy(){break;}
  }
  Ok(files.into())
 }
 async fn profile(self:Rc<Self>)->Result<JsValue,JsValue>{
  let generation=self.generation.get();
  let query=params(&[("fields","user(displayName,emailAddress,photoLink,permissionId)".into())])?;
  let user=get(&self.json(&format!("{ABOUT_URL}?{}",text(&query)?),&object(&[]),generation).await?,"user");
  if generation!=self.generation.get(){return Err(generation_changed());}
  if !user.is_truthy(){return Err(error("Google no devolvió los datos de la cuenta."));}
  let profile=object(&[("id",or(or(get(&user,"permissionId"),get(&user,"emailAddress")),"".into())),
   ("name",or(get(&user,"displayName"),"Cuenta de Google".into())),("email",or(get(&user,"emailAddress"),"".into())),("photo",or(get(&user,"photoLink"),"".into()))]);
  self.storage("setItem",&[&PROFILE_KEY.into(),&json(&profile)?.into()])?;Ok(profile)
 }
 async fn download(self:Rc<Self>,file_id:JsValue,options:JsValue)->Result<JsValue,JsValue>{
  let generation=self.generation.get();
  let url=format!("{DRIVE_FILES_URL}/{}?alt=media",encode_uri_component(&file_id));
  let blob=self.fetch(&url.into(),&object(&[("transfer",JsValue::TRUE)]),generation).await?.blob().await?;
  self.require(generation)?;
  let name=get(&options,"name");let name=if nullish(&name){file_id}else{name};
  let kind=or(or(get(&options,"mimeType"),get(&blob,"type")),"application/octet-stream".into());
  construct("File",&[&Array::of1(&blob).into(),&name,&object(&[("type",kind)])])
 }
 async fn upload(self:Rc<Self>,file:JsValue,options:JsValue,generation:f64)->Result<JsValue,JsValue>{
  self.require(generation)?;
  let drive_file_id=get(&options,"driveFileId");
  let folder=if drive_file_id.is_truthy(){JsValue::NULL}else{
   let parent=get(&options,"parentId");
   if parent.is_truthy(){parent}else{self.clone().read_folder().await?}
  };
  self.require(generation)?;
  let name=get(&options,"name");
  let metadata=object(&[("name",if name.is_undefined(){get(&file,"name")}else{name})]);
  if folder.is_truthy(){set(&metadata,"parents",&Array::of1(&folder).into());}
  let app_properties=get(&options,"appProperties");if app_properties.is_object(){set(&metadata,"appProperties",&app_properties);}
  let mime=or(get(&file,"type"),"application/octet-stream".into());
  let endpoint=format!("{UPLOAD_URL}{}",if drive_file_id.is_truthy(){format!("/{}",encode_uri_component(&drive_file_id))}else{String::new()});
  let method=if drive_file_id.is_truthy(){"PATCH"}else{"POST"};
  if number(&get(&file,"size"))<=5.0*1024.0*1024.0{
   let boundary=format!("ihr_{}",string(&self.platform("randomUUID",&[])?));
   let parts=Array::of4(&format!("--{boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n{}\r\n",json_text(&metadata)?).into(),
    &format!("--{boundary}\r\nContent-Type: {}\r\n\r\n",string(&mime)).into(),&file,&format!("\r\n--{boundary}--").into());
   let body=construct("Blob",&[&parts.into(),&object(&[("type",format!("multipart/related; boundary={boundary}").into())])])?;
   return self.json(&format!("{endpoint}?uploadType=multipart&{FILE_FIELDS}"),&object(&[("method",method.into()),
    ("headers",object(&[("Content-Type",format!("multipart/related; boundary={boundary}").into())])),("body",body)]),generation).await;
  }
  let start=self.fetch(&format!("{endpoint}?uploadType=resumable&{FILE_FIELDS}").into(),&object(&[("method",method.into()),
   ("headers",object(&[("Content-Type","application/json; charset=UTF-8".into()),("X-Upload-Content-Type",mime.clone()),
    ("X-Upload-Content-Length",string(&get(&file,"size")).into())])),("body",json_text(&metadata)?.into())]),generation).await?;
  let location=call(&get(&start.response,"headers"),"get",&[&"Location".into()])?;
  if !location.is_truthy(){return Err(error("Drive no devolvió la dirección para subir el libro."));}
  self.json(&string(&location),&object(&[("method","PUT".into()),("headers",object(&[("Content-Type",mime)])),("body",file)]),generation).await
 }

 async fn read_progress(self:Rc<Self>,drive_file_id:JsValue)->Result<JsValue,JsValue>{
  let generation=self.generation.get();
  let Some(folder)=self.state_folder_lookup(generation).await?else{self.require(generation)?;return Ok(JsValue::NULL);};
  self.require(generation)?;
  let query=params(&[("q",format!("'{}' in parents and name = '{}' and trashed = false",string(&folder),
    escape_drive_query(&format!("progress-{}.json",string(&drive_file_id)).into())).into()),
   ("fields","files(id,name,modifiedTime)".into()),("spaces","drive".into()),("pageSize","100".into())])?;
  let found=self.json(&format!("{DRIVE_FILES_URL}?{}",text(&query)?),&object(&[]),generation).await?;
  let files=Array::from(&or(get(&found,"files"),Array::new().into()));
  self.require(generation)?;
  if files.length()==0{return Ok(JsValue::NULL);}
  // `files.sort((a, b) => Date.parse(b.modifiedTime) - Date.parse(a.modifiedTime))`, NaN included.
  let newest_first=Closure::wrap(Box::new(|a:JsValue,b:JsValue|->f64{parse_date(&get(&b,"modifiedTime"))-parse_date(&get(&a,"modifiedTime"))})as Box<dyn FnMut(JsValue,JsValue)->f64>);
  call(&files,"sort",&[newest_first.as_ref()])?;
  let latest=files.get(0);
  let data=self.json(&format!("{DRIVE_FILES_URL}/{}?alt=media",encode_uri_component(&get(&latest,"id"))),&object(&[]),generation).await?;
  self.require(generation)?;
  if get(&data,"schemaVersion")!=JsValue::from_f64(1.0)||get(&data,"driveFileId")!=drive_file_id{return Ok(JsValue::NULL);}
  let state=object(&[]);assign(&state,&data)?;
  set(&state,"stateFileId",&get(&latest,"id"));
  let modified=parse_date(&get(&latest,"modifiedTime"));set(&state,"cloudModifiedAt",&(if modified.is_nan()||modified==0.0{0.0}else{modified}).into());
  Ok(state)
 }
 async fn write_progress(self:Rc<Self>,drive_file_id:JsValue,progress:JsValue,state_file_id:JsValue)->Result<JsValue,JsValue>{
  let generation=self.generation.get();
  let parent=if state_file_id.is_truthy(){JsValue::UNDEFINED}else{self.clone().state_folder_id().await?};
  self.require(generation)?;
  let capped=|key:&str,limit:u32|{let list=get(&progress,key);if Array::is_array(&list){Array::from(&list).slice(0,limit).into()}else{Array::new().into()}};
  let fraction=js_sys::Math::min(1.0,js_sys::Math::max(0.0,number_or_zero(&get(&progress,"fraction"))));
  let locator=get(&progress,"locator");
  let updated=number_or_zero(&get(&progress,"updatedAt"));
  let body=json(&object(&[("schemaVersion",1.into()),("driveFileId",drive_file_id.clone()),("fraction",fraction.into()),
   ("locator",if nullish(&locator){JsValue::NULL}else{locator}),
   ("appearance",call(&self.host,"spineCustomization",&[&get(&progress,"appearance")])?),
   ("bookLength",call(&self.host,"normalizeDriveBookLength",&[&get(&progress,"bookLength")])?),
   ("readingHistory",capped("readingHistory",20)),("bookmarks",capped("bookmarks",100)),
   ("quotes",call(&self.host,"cleanQuotes",&[&get(&progress,"quotes")])?),
   ("updatedAt",(if updated!=0.0{updated}else{js_sys::Date::now()}).into())]))?;
  let file=construct("File",&[&Array::of1(&body.into()).into(),&format!("progress-{}.json",string(&drive_file_id)).into(),&object(&[("type","application/json".into())])])?;
  self.upload(file,object(&[("driveFileId",state_file_id),("parentId",parent)]),generation).await
 }
}

/// `JSON.stringify(value)` as text, for values that always serialize.
fn json_text(value:&JsValue)->Result<String,JsValue>{Ok(stringify(value)?.unwrap_or_default())}

#[wasm_bindgen]
pub struct RustDriveClient{core:Rc<Core>}
#[wasm_bindgen]
impl RustDriveClient{
 #[wasm_bindgen(constructor)]
 pub fn new(host:JsValue)->RustDriveClient{
  RustDriveClient{core:Rc::new(Core{host,generation:Cell::new(0.0),timers:Rc::new(Timers::default()),auth:RefCell::new(None),folder:RefCell::new(None),
   state_folder:RefCell::new(None),revision_task:RefCell::new(None),revision_sequence:Cell::new(0),native:RefCell::new(None),exchange:RefCell::new(None),web:RefCell::new(Vec::new())})}
 }
 #[wasm_bindgen(js_name=requestDriveAccess)]
 pub fn request_drive_access(&self,options:JsValue)->Promise{self.core.request_access(&options)}
 #[wasm_bindgen(js_name=cancelDriveConnection)]
 pub fn cancel_drive_connection(&self,message:JsValue){self.core.cancel(&if message.is_undefined(){"Conexión cancelada.".to_owned()}else{string(&message)});}
 #[wasm_bindgen(js_name=signOutDrive)]
 pub fn sign_out_drive(&self)->Result<(),JsValue>{self.core.sign_out()}
 #[wasm_bindgen(js_name=handleNativeOAuth)]
 pub fn handle_native_oauth(&self,payload:JsValue)->Result<bool,JsValue>{self.core.native_callback(&payload)}
 #[wasm_bindgen(js_name=getOrCreateReadFolder)]
 pub fn get_or_create_read_folder(&self)->Promise{self.core.clone().read_folder_promise()}
 #[wasm_bindgen(js_name=readDriveLibrarySnapshots)]
 pub fn read_drive_library_snapshots(&self)->Promise{let core=self.core.clone();start(async move{core.read_snapshots().await})}
 #[wasm_bindgen(js_name=readDriveLibraryRevision)]
 pub fn read_drive_library_revision(&self)->Promise{self.core.library_revision_promise()}
 #[wasm_bindgen(js_name=writeDriveLibrarySnapshot)]
 pub fn write_drive_library_snapshot(&self,snapshot:JsValue,state_file_id:JsValue)->Promise{let core=self.core.clone();start(async move{core.write_snapshot(snapshot,state_file_id).await})}
 #[wasm_bindgen(js_name=uploadDriveCover)]
 pub fn upload_drive_cover(&self,cover:JsValue,name:JsValue)->Promise{let core=self.core.clone();start(async move{core.upload_cover(cover,name).await})}
 #[wasm_bindgen(js_name=listDriveBooks)]
 pub fn list_drive_books(&self,options:JsValue)->Promise{let core=self.core.clone();start(async move{core.list_books(if options.is_undefined(){object(&[])}else{options},None).await})}
 #[wasm_bindgen(js_name=listAllDriveBooks)]
 pub fn list_all_drive_books(&self)->Promise{let core=self.core.clone();start(async move{core.list_all_books().await})}
 #[wasm_bindgen(js_name=getDriveProfile)]
 pub fn get_drive_profile(&self)->Promise{let core=self.core.clone();start(async move{core.profile().await})}
 #[wasm_bindgen(js_name=downloadDriveFile)]
 pub fn download_drive_file(&self,file_id:JsValue,options:JsValue)->Promise{let core=self.core.clone();start(async move{core.download(file_id,options).await})}
 #[wasm_bindgen(js_name=uploadDriveFile)]
 pub fn upload_drive_file(&self,file:JsValue,options:JsValue)->Promise{
  let core=self.core.clone();let generation=core.generation.get();
  start(async move{core.upload(file,if options.is_undefined(){object(&[])}else{options},generation).await})
 }
 #[wasm_bindgen(js_name=readDriveProgress)]
 pub fn read_drive_progress(&self,drive_file_id:JsValue)->Promise{let core=self.core.clone();start(async move{core.read_progress(drive_file_id).await})}
 #[wasm_bindgen(js_name=writeDriveProgress)]
 pub fn write_drive_progress(&self,drive_file_id:JsValue,progress:JsValue,state_file_id:JsValue)->Promise{
  let core=self.core.clone();start(async move{core.write_progress(drive_file_id,progress,state_file_id).await})
 }
}
