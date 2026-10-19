//! Live transport queue ownership and recovery. RTC, encryption and Drive I/O
//! are host capabilities; queue transitions, retries and stale-owner checks are
//! Rust policy. No Rust borrow is held while invoking a host callback.
use wasm_bindgen::{prelude::*, JsCast};
use js_sys::{Array, Object, Promise, Uint8Array, Map, Set, Reflect};
use crate::host::{read, method, set, truthy, num, absent};
use crate::cloud_host::{self, copy_data_entries, data_entry};
type R<T> = Result<T, JsValue>;
fn n(value: f64) -> JsValue { JsValue::from_f64(value) }
fn object(fields: &[(&str, JsValue)]) -> R<JsValue> {
    let entries=Array::new(); for (key,value) in fields { data_entry(&entries,&(*key).into(),value); }
    Ok(Object::from_entries(entries.as_ref())?.into())
}
fn valid(host: &JsValue, session: &JsValue) -> R<bool> { Ok(truthy(&method(host,"valid",&[session])?)) }
fn failures(session: &JsValue, key: &str) -> R<f64> { let value=read(session,key)?; Ok(if truthy(&value) {num(&value)} else {0.0}) }
fn increase(session: &JsValue, key: &str) -> R<()> { set(session,key,&n(failures(session,key)?+1.0)) }
fn retry(count: f64, cap: f64, exponent: f64) -> f64 { cap.min(1000.0*2f64.powf(count.min(exponent))) }
fn unmatched(session: &JsValue) -> R<bool> {
    let native=read(session,"native")?;
    Ok(num(&read(&native,"peerCount")?)>num(&read(&native,"connectedCount")?))
}
async fn awaited(host: &JsValue, name: &str, args: &[&JsValue]) -> R<JsValue> {
    cloud_host::settle(method(host,name,args)).await
}
fn clone_fields(value: &JsValue) -> R<JsValue> { let entries=Array::new();copy_data_entries(&entries,value)?;Ok(Object::from_entries(entries.as_ref())?.into()) }

#[wasm_bindgen]
pub fn live_transport_schedule_state(session: JsValue, host: JsValue, delay: f64) -> R<()> {
    if !valid(&host,&session)? || !truthy(&read(&session,"key")?) || truthy(&read(&session,"stateBusy")?)
        || truthy(&read(&session,"stateTimer")?) || !truthy(&read(&session,"statePending")?) || !unmatched(&session)? {return Ok(());}
    let timer=method(&host,"armState",&[&session,&n(delay)])?;set(&session,"stateTimer",&timer)
}
#[wasm_bindgen]
pub fn live_transport_schedule_relay(session: JsValue, host: JsValue) -> R<()> {
    if truthy(&read(&session,"relayBusy")?) || truthy(&read(&session,"relayTimer")?) || !truthy(&read(&session,"relayPending")?) {return Ok(());}
    let timer=method(&host,"armRelay",&[&session,&n(250.0)])?;set(&session,"relayTimer",&timer)
}

async fn write_loop(session: &JsValue, host: &JsValue) -> R<JsValue> {
    loop {
        set(session,"writeAgain",&JsValue::FALSE)?;
        if !valid(host,session)? {return Ok(JsValue::UNDEFINED);}
        let payload=object(&[("v",n(1.0)),("peer",read(session,"own")?),("at",method(host,"now",&[])?),
            ("signals",clone_fields(&read(session,"signals")?)?),("motion",read(session,"relayMotion")?),("state",read(session,"relayState")?)])?;
        let first=awaited(host,"writeMailbox",&[&read(session,"own")?,&payload,&read(session,"file")?]).await;
        let file=match first {
            Ok(file)=>file,
            Err(error)=>{
                if !valid(host,session)? || !truthy(&read(session,"file")?) || read(&error,"status")?!=n(404.0) {return Err(error);}
                set(session,"file",&JsValue::NULL)?;
                method(&read(host,"mailboxes")?,"delete",&[&read(session,"account")?])?;
                awaited(host,"writeMailbox",&[&read(session,"own")?,&payload,&JsValue::NULL]).await?
            }
        };
        if valid(host,session)? {
            set(session,"file",&read(&file,"id")?)?;
            method(&read(host,"mailboxes")?,"set",&[&read(session,"account")?,&read(&file,"id")?])?;
        }
        if !truthy(&read(session,"writeAgain")?) || !valid(host,session)? {return Ok(JsValue::UNDEFINED);}
    }
}
#[wasm_bindgen]
pub fn live_transport_write(session: JsValue, host: JsValue) -> R<JsValue> {
    set(&session,"writeAgain",&JsValue::TRUE)?;
    let writing=read(&session,"writing")?;
    if truthy(&writing) {return Ok(writing);}
    let owner=session.clone();
    let promise=cloud_host::start(async move {
        let result=write_loop(&owner,&host).await;
        set(&owner,"writing",&JsValue::NULL)?;
        result
    });
    set(&session,"writing",promise.as_ref())?;Ok(promise.into())
}

async fn encrypted(host: &JsValue, session: &JsValue, plain: &JsValue) -> R<JsValue> {
    let encrypted=awaited(host,"encrypt",&[session,plain]).await?;
    if !valid(host,session)? {return Ok(JsValue::NULL);}
    let iv=method(host,"encode",&[&read(&encrypted,"iv")?])?;
    let bytes=Uint8Array::new(&read(&encrypted,"data")?);
    let data=method(host,"encode",&[bytes.as_ref()])?;
    object(&[("iv",iv),("data",data)])
}
async fn state_body(session: &JsValue, host: &JsValue, packet: &JsValue) -> R<()> {
    let cipher=encrypted(host,session,packet).await?;if cipher.is_null(){return Ok(());}
    let payload=object(&[("v",n(1.0)),("peer",read(session,"own")?),("iv",read(&cipher,"iv")?),("data",read(&cipher,"data")?)])?;
    let first=awaited(host,"writeState",&[&read(session,"own")?,&payload,&read(session,"stateFile")?]).await;
    let file=match first {
        Ok(file)=>file,
        Err(error)=>{
            if !valid(host,session)? || !truthy(&read(session,"stateFile")?) || read(&error,"status")?!=n(404.0) {return Err(error);}
            set(session,"stateFile",&JsValue::NULL)?;
            awaited(host,"writeState",&[&read(session,"own")?,&payload,&JsValue::NULL]).await?
        }
    };
    if !valid(host,session)? {return Ok(());}
    set(session,"stateFile",&read(&file,"id")?)?;
    method(&read(host,"stateFiles")?,"set",&[&read(session,"account")?,&read(&file,"id")?])?;
    set(session,"relayState",&object(&[("id",read(&file,"id")?),("revision",method(host,"randomId",&[])?)])?)?;
    awaited(host,"write",&[session]).await?;
    set(session,"stateFailures",&n(0.0))
}
#[wasm_bindgen]
pub fn live_transport_state_relay(session: JsValue, host: JsValue) -> Promise {
    // The timer callback and pending->in-flight transition remain synchronous.
    let begin=(||->R<Option<JsValue>>{
        set(&session,"stateTimer",&JsValue::NULL)?;
        if !valid(&host,&session)? {return Ok(None);}
        let packet=read(&session,"statePending")?;if !truthy(&packet){return Ok(None);}
        set(&session,"stateBusy",&JsValue::TRUE)?;set(&session,"statePending",&JsValue::NULL)?;Ok(Some(packet))
    })();
    let packet=match begin {Ok(Some(packet))=>packet,Ok(None)=>return Promise::resolve(&JsValue::UNDEFINED),Err(error)=>return Promise::reject(&error)};
    cloud_host::start(async move {
        if state_body(&session,&host,&packet).await.is_err() && valid(&host,&session)? {
            if !truthy(&read(&session,"statePending")?) {set(&session,"statePending",&packet)?;}
            increase(&session,"stateFailures")?;
        }
        set(&session,"stateBusy",&JsValue::FALSE)?;
        if valid(&host,&session)? {
            let count=failures(&session,"stateFailures")?;
            live_transport_schedule_state(session,host,if count!=0.0 {retry(count,10000.0,3.0)} else {150.0})?;
        }
        Ok(JsValue::UNDEFINED)
    })
}
#[wasm_bindgen]
pub fn live_transport_relay(session: JsValue, host: JsValue) -> Promise {
    let begin=(||->R<Option<JsValue>>{
        set(&session,"relayTimer",&JsValue::NULL)?;
        let packet=read(&session,"relayPending")?;set(&session,"relayPending",&JsValue::NULL)?;
        if !truthy(&packet)||!valid(&host,&session)?||!truthy(&read(&session,"key")?)||!unmatched(&session)? {return Ok(None);}
        set(&session,"relayBusy",&JsValue::TRUE)?;Ok(Some(packet))
    })();
    let packet=match begin {Ok(Some(packet))=>packet,Ok(None)=>return Promise::resolve(&JsValue::UNDEFINED),Err(error)=>return Promise::reject(&error)};
    cloud_host::start(async move {
        let body=async {
            let plain=cloud_host::stringify(&object(&[("at",method(&host,"now",&[])?),("packet",packet)])?)?
                .map(JsValue::from).unwrap_or(JsValue::UNDEFINED);
            let cipher=encrypted(&host,&session,&plain).await?;
            if !cipher.is_null() {set(&session,"relayMotion",&cipher)?;awaited(&host,"write",&[&session]).await?;}
            Ok::<(),JsValue>(())
        };
        let _=body.await;
        set(&session,"relayBusy",&JsValue::FALSE)?;
        if valid(&host,&session)? {live_transport_schedule_relay(session,host)?;}
        Ok(JsValue::UNDEFINED)
    })
}
#[wasm_bindgen]
pub fn live_transport_discover(session: JsValue, host: JsValue) -> Promise {
    let request=method(&host,"readRevision",&[]);
    cloud_host::start(async move {
        if cloud_host::settle(request).await.is_ok() {set(&session,"discoveryFailures",&n(0.0))?;}
        else {increase(&session,"discoveryFailures")?;}
        if valid(&host,&session)? {
            let count=failures(&session,"discoveryFailures")?;
            let delay=if count!=0.0 {retry(count,15000.0,4.0)} else {
                let peers=Array::from(&method(&read(&session,"peers")?,"values",&[])?);
                let mut open=false;for peer in peers.iter() {if truthy(&read(&peer,"open")?){open=true;break;}}
                if open {2500.0} else {700.0}
            };
            method(&host,"armDiscovery",&[&session,&n(delay)])?;
        }
        Ok(JsValue::UNDEFINED)
    })
}

#[wasm_bindgen]
pub fn live_transport_context(session: JsValue, host: JsValue) -> Promise {
    let request=method(&host,"getContext",&[]);
    cloud_host::start(async move {
        let mut context=cloud_host::settle(request).await?;
        if !valid(&host,&session)? {return Ok(JsValue::UNDEFINED);}
        // A concurrently created rendezvous key is confirmed before use.
        if truthy(&read(&context,"confirm")?) {context=awaited(&host,"getContext",&[]).await?;}
        if !valid(&host,&session)? {return Ok(JsValue::UNDEFINED);}
        let key=awaited(&host,"importKey",&[&context]).await?;
        if valid(&host,&session)? {set(&session,"key",&key)?;set(&session,"folder",&read(&context,"folderId")?)?;}
        Ok(JsValue::UNDEFINED)
    })
}

async fn accept_snapshot(session: &JsValue, packet: &JsValue, host: &JsValue) -> R<JsValue> {
    if absent(packet) || !truthy(&read(packet,"snapshot")?) {return Ok(JsValue::UNDEFINED);}
    if let Err(error)=awaited(host,"receive",&[&read(session,"account")?,&read(packet,"snapshot")?]).await {
        if valid(host,session)? {method(&read(session,"native")?,"forgetSnapshot",&[&read(packet,"id")?])?;}
        return Err(error);
    }
    Ok(JsValue::UNDEFINED)
}
#[wasm_bindgen]
pub fn live_transport_accept(session: JsValue, packet: JsValue, host: JsValue) -> Promise {
    cloud_host::start(async move {accept_snapshot(&session,&packet,&host).await})
}

async fn state_read_body(session: &JsValue, id: &JsValue, state: &JsValue, host: &JsValue) -> R<JsValue> {
    let encrypted=awaited(host,"readState",&[&read(state,"id")?]).await?;
    if !valid(host,session)? || read(&encrypted,"peer")?!=*id {return Ok(JsValue::UNDEFINED);}
    let first=awaited(host,"decrypt",&[session,&encrypted]).await;
    let decoded=match first {
        Ok(decoded)=>decoded,
        Err(_)=>{
            cloud_host::settle(Ok(live_transport_context(session.clone(),host.clone()).into())).await?;
            if !valid(host,session)? {return Ok(JsValue::UNDEFINED);}
            awaited(host,"decrypt",&[session,&encrypted]).await?
        }
    };
    if !valid(host,session)? {return Ok(JsValue::UNDEFINED);}
    let envelope=object(&[("packet",method(host,"decode",&[&decoded])?)])?;
    let packet=method(&read(session,"native")?,"receiveStateRelay",&[id,&envelope])?;
    accept_snapshot(session,&packet,host).await?;
    if valid(host,session)? {method(&read(session,"stateSeen")?,"set",&[id,&read(state,"revision")?])?;}
    Ok(JsValue::UNDEFINED)
}
#[wasm_bindgen]
pub fn live_transport_read_state(session: JsValue, id: JsValue, state: JsValue, host: JsValue) -> Promise {
    let begin=(||->R<bool>{
        if !truthy(&read(&session,"stateSeen")?) {set(&session,"stateSeen",Map::new().as_ref())?;}
        if !truthy(&read(&session,"stateReading")?) {set(&session,"stateReading",Set::new(&JsValue::UNDEFINED).as_ref())?;}
        let file=if absent(&state) {JsValue::UNDEFINED} else {read(&state,"id")?};
        let Some(file)=file.as_string() else{return Ok(false);};
        if file.is_empty() || file.len()>128 || !file.bytes().all(|byte|byte.is_ascii_alphanumeric()||byte==b'_'||byte==b'-')
            || !read(&state,"revision")?.is_string()
            || method(&read(&session,"stateSeen")?,"get",&[&id])?==read(&state,"revision")?
            || truthy(&method(&read(&session,"stateReading")?,"has",&[&id])?) {return Ok(false);}
        method(&read(&session,"stateReading")?,"add",&[&id])?;Ok(true)
    })();
    match begin {Ok(true)=>{},Ok(false)=>return Promise::resolve(&JsValue::UNDEFINED),Err(error)=>return Promise::reject(&error)}
    cloud_host::start(async move {
        let result=state_read_body(&session,&id,&state,&host).await;
        method(&read(&session,"stateReading")?,"delete",&[&id])?;
        result
    })
}
#[wasm_bindgen]
pub fn live_transport_signal(session: JsValue, id: JsValue, description: JsValue, nonce: JsValue, host: JsValue) -> Promise {
    cloud_host::start(async move {
        if !valid(&host,&session)? {return Ok(JsValue::UNDEFINED);}
        let packet=object(&[("account",read(&session,"account")?),("from",read(&session,"own")?),("to",id.clone()),
            ("nonce",nonce),("at",method(&host,"now",&[])?),("type",read(&description,"type")?),("sdp",read(&description,"sdp")?)])?;
        let plain=cloud_host::stringify(&packet)?.map(JsValue::from).unwrap_or(JsValue::UNDEFINED);
        let cipher=encrypted(&host,&session,&plain).await?;
        if !cipher.is_null() {Reflect::set(&read(&session,"signals")?,&id,&cipher)?;awaited(&host,"write",&[&session]).await?;}
        Ok(JsValue::UNDEFINED)
    })
}
