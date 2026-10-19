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

// RTC handles remain browser objects. Their negotiation, dispatch, liveness and
// backpressure decisions are made here, without borrowing a Rust owner across I/O.
fn valid_peer(host:&JsValue,s:&JsValue,p:&JsValue)->R<bool>{
    Ok(truthy(p)&&valid(host,s)?&&method(&read(s,"peers")?,"get",&[&read(p,"id")?])?==*p)
}
fn open(channel:&JsValue)->R<bool>{Ok(!absent(channel)&&read(channel,"readyState")?==JsValue::from_str("open"))}
fn broadcast(s:&JsValue,kind:&str,packet:&JsValue)->R<()>{
    let tabs=read(s,"tabs")?;if !absent(&tabs){method(&tabs,"postMessage",&[&object(&[("t",kind.into()),("from",read(s,"own")?),("packet",packet.clone())])?])?;}Ok(())
}
fn forward_motion(s:&JsValue,packet:&JsValue,except:&JsValue)->R<()>{
    let iterator=method(&read(s,"peers")?,"values",&[])?;
    for p in js_sys::try_iter(&iterator)?.ok_or_else(||js_sys::TypeError::new("Peer map is not iterable"))? {
        let p=p?;if read(&p,"id")?!=*except{live_transport_send_motion(p,packet.clone())?;}
    }Ok(())
}
#[wasm_bindgen]
pub fn live_transport_send_motion(peer:JsValue,packet:JsValue)->R<()>{set(&peer,"motion",&packet)?;live_transport_flush_motion(peer)}
#[wasm_bindgen]
pub fn live_transport_flush_motion(peer:JsValue)->R<()>{
    let c=read(&peer,"interactive")?;
    if !open(&c)?||!truthy(&read(&peer,"motion")?)||num(&read(&c,"bufferedAmount")?)>32768.0{return Ok(());}
    if method(&c,"send",&[&read(&peer,"motion")?]).is_ok(){set(&peer,"motion",&JsValue::NULL)?;}Ok(())
}
#[wasm_bindgen]
pub fn live_transport_send(peer:JsValue,packet:JsValue,host:JsValue)->R<()>{
    if !truthy(&packet){return Ok(());}
    let data=if packet.is_string(){method(&host,"utf8",&[&packet])?}else{packet};
    if truthy(&method(&read(&peer,"stream")?,"queue",&[&data])?){live_transport_pump(peer)?;}Ok(())
}
#[wasm_bindgen]
pub fn live_transport_pump(peer:JsValue)->R<()>{
    let c=read(&peer,"channel")?;if !open(&c)?{return Ok(());}
    let result=(||->R<()>{while num(&read(&c,"bufferedAmount")?)<131072.0{
        let part=method(&read(&peer,"stream")?,"next",&[])?;if part.is_undefined(){return Ok(());}method(&c,"send",&[&part])?;
    }Ok(())})();
    if result.is_err(){method(&c,"close",&[])?;}Ok(())
}
#[wasm_bindgen]
pub fn live_transport_health(s:JsValue,p:JsValue,host:JsValue)->R<()>{
    if !valid_peer(&host,&s,&p)?||!truthy(&read(&p,"open")?){return Ok(());}
    let interactive=read(&p,"interactive")?;
    if num(&method(&host,"clock",&[])?) - num(&read(&p,"lastReceived")?)>12000.0 || (!open(&interactive)?&&num(&method(&host,"clock",&[])?) - num(&read(&p,"healthAt")?)>12000.0){method(&host,"failed",&[&s,&read(&p,"id")?])?;return Ok(());}
    if open(&interactive)?{let ping=cloud_host::stringify(&object(&[("t","ping".into()),("at",method(&host,"now",&[])?)])?)?.unwrap_or_default();let _=method(&interactive,"send",&[&ping.into()]);}
    method(&host,"armHealth",&[&s,&p,&n(2000.0)])?;Ok(())
}
#[wasm_bindgen]
pub fn live_transport_bind_channel(p:JsValue,c:JsValue)->R<String>{
    let label=read(&c,"label")?;
    if label==JsValue::from_str("inhouse-read-interactive-v1"){
        set(&p,"interactive",&c)?;set(&c,"bufferedAmountLowThreshold",&n(32768.0))?;return Ok("interactive".into());
    }
    if label!=JsValue::from_str("inhouse-read-room-v1"){method(&c,"close",&[])?;return Ok(String::new());}
    set(&p,"channel",&c)?;set(&c,"binaryType",&"arraybuffer".into())?;set(&c,"bufferedAmountLowThreshold",&n(65536.0))?;Ok("room".into())
}
#[wasm_bindgen]
pub fn live_transport_channel_event(s:JsValue,p:JsValue,c:JsValue,kind:&str,event:&str,host:JsValue)->R<()>{
    if kind=="interactive"{
        match event{
            "open"=>if valid_peer(&host,&s,&p)?{if truthy(&read(&p,"open")?){method(&read(&s,"native")?,"connected",&[&read(&p,"id")?])?;}live_transport_flush_motion(p)?;},
            "low"=>live_transport_flush_motion(p)?,
            "close"=>if read(&p,"interactive")?==c{set(&p,"interactive",&JsValue::NULL)?;if valid_peer(&host,&s,&p)?{method(&host,"failed",&[&s,&read(&p,"id")?])?;}},
            _=>{}
        }
    }else{match event{
        "open"=>if valid_peer(&host,&s,&p)?{set(&p,"open",&JsValue::TRUE)?;set(&p,"lastReceived",&method(&host,"clock",&[])?)?;
            if open(&read(&p,"interactive")?)?{method(&read(&s,"native")?,"connected",&[&read(&p,"id")?])?;}
            live_transport_send(p.clone(),read(&read(&s,"native")?,"latest")?,host.clone())?;live_transport_health(s,p,host)?;},
        "close"=>if valid_peer(&host,&s,&p)?{method(&host,"failed",&[&s,&read(&p,"id")?])?;},
        "low"=>live_transport_pump(p)?,_=>{}
    }}Ok(())
}
#[wasm_bindgen]
pub fn live_transport_interactive_message(s:JsValue,p:JsValue,c:JsValue,data:JsValue,host:JsValue)->R<()>{
    if !valid_peer(&host,&s,&p)?||!data.is_string()||num(&read(&data,"length")?)>98304.0{return Ok(());}
    let _=(||->R<()>{
        let wire=js_sys::JSON::parse(&data.as_string().unwrap_or_default())?;set(&p,"lastReceived",&method(&host,"clock",&[])?)?;
        if read(&wire,"t")?==JsValue::from_str("ping"){
            if open(&c)?{let pong=cloud_host::stringify(&object(&[("t","pong".into()),("at",read(&wire,"at")?)])?)?.unwrap_or_default();method(&c,"send",&[&pong.into()])?;}return Ok(());
        }
        if read(&wire,"t")?==JsValue::from_str("pong"){return Ok(());}
        let packet=method(&read(&s,"native")?,"receiveMotion",&[&data])?;
        if truthy(&packet){method(&host,"motion",&[&read(&s,"account")?,&packet])?;broadcast(&s,"motion",&data)?;
            let iterator=method(&read(&s,"peers")?,"values",&[])?;
            for other in js_sys::try_iter(&iterator)?.ok_or_else(||js_sys::TypeError::new("Peer map is not iterable"))?{let other=other?;if other!=p&&read(&other,"id")?!=read(&packet,"from")?{live_transport_send_motion(other,data.clone())?;}}
        }Ok(())
    })();Ok(())
}
#[wasm_bindgen]
pub fn live_transport_room_message(s:JsValue,p:JsValue,data:JsValue,host:JsValue)->Promise{
    let begin=(||->R<Option<JsValue>>{
        if !valid_peer(&host,&s,&p)?{return Ok(None);}set(&p,"lastReceived",&method(&host,"clock",&[])?)?;
        let input=if data.is_string(){data}else{Uint8Array::new(&data).into()};
        let assembled=method(&read(&p,"stream")?,"receive",&[&input])?;
        if truthy(&assembled){let encoded=method(&host,"decode",&[&assembled])?;let packet=method(&read(&s,"native")?,"receive",&[&encoded])?;
            if !absent(&packet)&&truthy(&read(&packet,"snapshot")?){broadcast(&s,"snapshot",&encoded)?;return Ok(Some(packet));}}
        Ok(None)
    })();
    cloud_host::start(async move {
        let result=match begin{Ok(Some(packet))=>accept_snapshot(&s,&packet,&host).await,Ok(None)=>Ok(JsValue::UNDEFINED),Err(e)=>Err(e)};
        if result.is_err()&&valid_peer(&host,&s,&p)?{method(&host,"failed",&[&s,&read(&p,"id")?])?;}Ok(JsValue::UNDEFINED)
    })
}
#[wasm_bindgen]
pub fn live_transport_candidates(p:JsValue,sdp:JsValue)->Promise{
    // Mark a candidate only after the browser accepts it. Concurrent responses
    // consult the shared set again after each await, preserving failed retries.
    cloud_host::start(async move {
        let description=read(&read(&p,"pc")?,"remoteDescription")?;
        let current=if absent(&description){JsValue::UNDEFINED}else{read(&description,"sdp")?};
        let current=if truthy(&current){current}else{"".into()};let separator=js_sys::RegExp::new("\\r?\\n","");
        let known=Set::new(&JsValue::UNDEFINED);
        for line in Array::from(&method(&current,"split",&[separator.as_ref()])?).iter(){if truthy(&method(&line,"startsWith",&[&"a=candidate:".into()])?){known.add(&line);}}
        if !truthy(&read(&p,"candidates")?){set(&p,"candidates",Set::new(&JsValue::UNDEFINED).as_ref())?;}
        let mut mid:JsValue="0".into();let mut index=-1.0;
        for line in Array::from(&method(&sdp,"split",&[separator.as_ref()])?).iter(){
            if truthy(&method(&line,"startsWith",&[&"m=".into()])?){index+=1.0;}
            if truthy(&method(&line,"startsWith",&[&"a=mid:".into()])?){mid=method(&line,"slice",&[&n(6.0)])?;}
            if truthy(&method(&line,"startsWith",&[&"a=candidate:".into()])?)&&!known.has(&line)&&!truthy(&method(&read(&p,"candidates")?,"has",&[&line])?){
                let candidate=object(&[("candidate",method(&line,"slice",&[&n(2.0)])?),("sdpMid",mid.clone()),("sdpMLineIndex",n(f64::max(0.0,index)))])?;
                awaited(&read(&p,"pc")?,"addIceCandidate",&[&candidate]).await?;method(&read(&p,"candidates")?,"add",&[&line])?;
            }
        }Ok(JsValue::UNDEFINED)
    })
}
#[wasm_bindgen]
pub fn live_transport_offer(s:JsValue,id:JsValue,host:JsValue)->Promise{
    cloud_host::start(async move {
        cloud_host::settle(Ok(live_transport_context(s.clone(),host.clone()).into())).await?;if !valid(&host,&s)?{return Ok(JsValue::UNDEFINED);}
        method(&host,"closePeer",&[&s,&id])?;let nonce=method(&host,"randomId",&[])?;
        if !truthy(&method(&read(&s,"native")?,"beginOffer",&[&id,&nonce,&method(&host,"now",&[]) ?])?){return Ok(JsValue::UNDEFINED);}
        let p=method(&host,"peer",&[&s,&id])?;set(&p,"nonce",&nonce)?;method(&host,"pending",&[&s])?;
        let pc=read(&p,"pc")?;
        for label in ["inhouse-read-room-v1","inhouse-read-interactive-v1"]{let c=method(&pc,"createDataChannel",&[&label.into(),&object(&[("ordered",JsValue::TRUE)])?])?;method(&host,"bindChannel",&[&s,&p,&c])?;}
        let offer=awaited(&pc,"createOffer",&[]).await?;awaited(&pc,"setLocalDescription",&[&offer]).await?;awaited(&host,"ice",&[&p,&n(1200.0)]).await?;
        if valid_peer(&host,&s,&p)?{cloud_host::settle(Ok(live_transport_signal(s,id,read(&pc,"localDescription")?,nonce,host).into())).await?;}Ok(JsValue::UNDEFINED)
    })
}
async fn read_mailbox_body(s:&JsValue,id:&JsValue,file:&JsValue,host:&JsValue)->R<JsValue>{
    let mailbox=awaited(host,"readMailbox",&[file]).await?;if !valid(host,s)?||read(&mailbox,"peer")?!=*id{return Ok(JsValue::UNDEFINED);}
    let motion=read(&mailbox,"motion")?;let motion_data=if absent(&motion){JsValue::UNDEFINED}else{read(&motion,"data")?};
    if motion_data.is_string()&&num(&read(&motion_data,"length")?)<=132000.0{
        let _=async {
            let decoded=awaited(host,"decrypt",&[s,&motion]).await?;if !valid(host,s)?{return Ok::<(),JsValue>(());}
            let envelope=js_sys::JSON::parse(&method(host,"decode",&[&decoded])?.as_string().unwrap_or_default())?;
            let packet=method(&read(s,"native")?,"receiveRelay",&[id,&envelope,&method(host,"now",&[]) ?])?;
            if truthy(&packet){method(host,"motion",&[&read(s,"account")?,&packet])?;let wire=read(&envelope,"packet")?;broadcast(s,"motion",&wire)?;forward_motion(s,&wire,id)?;}Ok(())
        }.await;
        if !valid(host,s)?{return Ok(JsValue::UNDEFINED);}
    }
    let state=read(&mailbox,"state")?;
    if truthy(&state){detached_read(s.clone(),id.clone(),state,host.clone(),true);}
    let cipher=Reflect::get(&read(&mailbox,"signals")?,&read(s,"own")?)?;
    if !truthy(&cipher){return Ok(JsValue::UNDEFINED);}let data=read(&cipher,"data")?;
    if !data.is_string()||num(&read(&data,"length")?)>65000.0{return Ok(JsValue::UNDEFINED);}
    let decoded=match awaited(host,"decrypt",&[s,&cipher]).await{Ok(value)=>value,Err(_)=>{
        cloud_host::settle(Ok(live_transport_context(s.clone(),host.clone()).into())).await?;if !valid(host,s)?{return Ok(JsValue::UNDEFINED);}awaited(host,"decrypt",&[s,&cipher]).await?
    }};
    if !valid(host,s)?{return Ok(JsValue::UNDEFINED);}
    let wire=js_sys::JSON::parse(&method(host,"decode",&[&decoded])?.as_string().unwrap_or_default())?;
    let signal=method(&read(s,"native")?,"signal",&[id,&wire,&method(host,"now",&[]) ?])?;if !truthy(&signal){return Ok(JsValue::UNDEFINED);}
    let mut p=method(&read(s,"peers")?,"get",&[id])?;
    if read(&signal,"type")?==JsValue::from_str("offer"){
        if absent(&p)||read(&p,"nonce")?!=read(&signal,"nonce")?{method(host,"closePeer",&[s,id])?;p=method(host,"peer",&[s,id])?;set(&p,"nonce",&read(&signal,"nonce")?)?;method(host,"pending",&[s])?;}
        let pc=read(&p,"pc")?;
        if truthy(&read(&pc,"remoteDescription")?){return cloud_host::settle(Ok(live_transport_candidates(p,read(&signal,"sdp")?).into())).await;}
        awaited(&pc,"setRemoteDescription",&[&object(&[("type","offer".into()),("sdp",read(&signal,"sdp")?)])?]).await?;if !valid_peer(host,s,&p)?{return Ok(JsValue::UNDEFINED);}
        if !truthy(&read(&pc,"localDescription")?){let answer=awaited(&pc,"createAnswer",&[]).await?;awaited(&pc,"setLocalDescription",&[&answer]).await?;}
        awaited(host,"ice",&[&p,&n(1200.0)]).await?;
        if valid_peer(host,s,&p)?{cloud_host::settle(Ok(live_transport_signal(s.clone(),id.clone(),read(&pc,"localDescription")?,read(&p,"nonce")?,host.clone()).into())).await?;}
    }else if valid_peer(host,s,&p)?{
        let pc=read(&p,"pc")?;
        if truthy(&read(&pc,"remoteDescription")?){cloud_host::settle(Ok(live_transport_candidates(p,read(&signal,"sdp")?).into())).await?;}
        else{awaited(&pc,"setRemoteDescription",&[&object(&[("type","answer".into()),("sdp",read(&signal,"sdp")?)])?]).await?;}
    }Ok(JsValue::UNDEFINED)
}
#[wasm_bindgen]
pub fn live_transport_read(s:JsValue,id:JsValue,file:JsValue,host:JsValue)->Promise{
    let begin=(||->R<bool>{if !truthy(&read(&s,"reading")?){set(&s,"reading",Set::new(&JsValue::UNDEFINED).as_ref())?;}
        let reading=read(&s,"reading")?;if truthy(&method(&reading,"has",&[&id])?){return Ok(false);}method(&reading,"add",&[&id])?;Ok(true)})();
    match begin{Ok(true)=>{},Ok(false)=>return Promise::resolve(&JsValue::UNDEFINED),Err(error)=>return Promise::reject(&error)}
    cloud_host::start(async move{let result=read_mailbox_body(&s,&id,&file,&host).await;method(&read(&s,"reading")?,"delete",&[&id])?;result})
}
#[wasm_bindgen]
pub fn live_transport_close(s:JsValue,id:JsValue,host:JsValue)->R<()>{
    let p=method(&read(&s,"peers")?,"get",&[&id])?;if !truthy(&p){return Ok(());}
    method(&read(&s,"peers")?,"delete",&[&id])?;Reflect::delete_property(&read(&s,"signals")?.unchecked_into::<Object>(),&id)?;
    method(&host,"cancelTimer",&[&read(&p,"iceTimer")?])?;
    for name in ["interactive","channel"]{let channel=read(&p,name)?;if !absent(&channel){method(&channel,"close",&[])?;}}
    method(&read(&p,"pc")?,"close",&[])?;method(&read(&p,"stream")?,"free",&[])?;method(&host,"disconnected",&[&id])?;Ok(())
}
#[wasm_bindgen]
pub fn live_transport_failed(s:JsValue,id:JsValue,host:JsValue)->R<()>{
    if !valid(&host,&s)?{return Ok(());}live_transport_close(s.clone(),id.clone(),host.clone())?;
    method(&read(&s,"native")?,"failed",&[&id,&method(&host,"now",&[]) ?])?;live_transport_schedule_state(s,host,150.0)
}
#[wasm_bindgen]
pub fn live_transport_pending(s:JsValue,host:JsValue,fire:bool)->R<()>{
    if fire{set(&s,"pending",&JsValue::NULL)?;let actions=method(&read(&s,"native")?,"pending",&[&method(&host,"now",&[]) ?])?;return live_transport_actions(s,actions,host);}
    if truthy(&read(&s,"pending")?)||!valid(&host,&s)?{return Ok(());}
    let peers=Array::from(&method(&read(&s,"peers")?,"values",&[])?);let mut unopened=false;
    for p in peers.iter(){if !truthy(&read(&p,"open")?){unopened=true;break;}}
    if unopened{let timer=method(&host,"armPending",&[&s,&n(350.0)])?;set(&s,"pending",&timer)?;}Ok(())
}
#[wasm_bindgen]
pub fn live_transport_actions(s:JsValue,actions:JsValue,host:JsValue)->R<()>{
    for action in js_sys::try_iter(&actions)?.ok_or_else(||js_sys::TypeError::new("Actions are not iterable"))?{
        let action=Array::from(&action?);if !valid(&host,&s)?{break;}
        match action.get(0).as_string().as_deref(){
            Some("close")=>live_transport_close(s.clone(),action.get(1),host.clone())?,
            Some("read")=>detached_read(s.clone(),action.get(1),action.get(2),host.clone(),false),
            Some("offer")=>{let owner=s.clone();let id=action.get(1);let host=host.clone();let request=live_transport_offer(owner.clone(),id.clone(),host.clone());
                let _=cloud_host::start(async move{if cloud_host::settle(Ok(request.into())).await.is_err(){live_transport_failed(owner,id,host)?;}Ok(JsValue::UNDEFINED)});},_=>{}
        }
    }live_transport_pending(s.clone(),host.clone(),false)?;live_transport_schedule_state(s,host,150.0)
}
#[wasm_bindgen]
pub fn live_transport_peer_event(s:JsValue,p:JsValue,event:&str,host:JsValue)->R<()>{
    if !valid_peer(&host,&s,&p)?{return Ok(());}let pc=read(&p,"pc")?;
    if event=="ice"{
        if !truthy(&read(&p,"nonce")?)||!truthy(&read(&pc,"localDescription")?){return Ok(());}
        method(&host,"cancelTimer",&[&read(&p,"iceTimer")?])?;
        let timer=method(&host,"armIceSignal",&[&s,&p,&n(200.0)])?;set(&p,"iceTimer",&timer)?;
    }else if event=="signal"{let request=live_transport_signal(s,read(&p,"id")?,read(&pc,"localDescription")?,read(&p,"nonce")?,host);
        let _=cloud_host::start(async move{let _=cloud_host::settle(Ok(request.into())).await;Ok(JsValue::UNDEFINED)});
    }else{let state=read(&pc,"connectionState")?;
        if event=="disconnected"{if state==JsValue::from_str("disconnected"){live_transport_failed(s,read(&p,"id")?,host)?;}}
        else if state==JsValue::from_str("failed")||state==JsValue::from_str("closed"){live_transport_failed(s,read(&p,"id")?,host)?;}
        else if state==JsValue::from_str("disconnected"){method(&host,"armDisconnected",&[&s,&p,&n(5000.0)])?;}
    }Ok(())
}

#[wasm_bindgen]
pub fn live_transport_publish_now(s:JsValue,host:JsValue)->R<()>{
    let packet=method(&read(&s,"native")?,"publish",&[&read(&s,"latest")?,&method(&host,"randomId",&[]) ?])?;
    if !truthy(&packet){return Ok(());}broadcast(&s,"snapshot",&packet)?;let encoded=method(&host,"utf8",&[&packet])?;
    let peers=method(&read(&s,"peers")?,"values",&[])?;
    for p in js_sys::try_iter(&peers)?.ok_or_else(||js_sys::TypeError::new("Peer map is not iterable"))?{live_transport_send(p?,encoded.clone(),host.clone())?;}
    set(&s,"statePending",&packet)?;live_transport_schedule_state(s,host,150.0)
}
#[wasm_bindgen]
pub fn live_transport_publish(account:JsValue,snapshot:JsValue,host:JsValue)->Promise{
    let begin=(||->R<Option<JsValue>>{
        if !truthy(&account)||!truthy(&method(&host,"enabled",&[])?)||!truthy(&method(&host,"cryptoAvailable",&[])?){return Ok(None);}
        method(&host,"setDesired",&[&object(&[("account",account.clone()),("snapshot",snapshot.clone())])?])?;
        let mut s=method(&host,"session",&[])?;
        if absent(&s)||read(&s,"account")?!=account{
            method(&host,"stop",&[])?;
            s=object(&[("account",account),("epoch",method(&host,"epoch",&[])?),("peers",Map::new().into()),("signals",Object::new().into()),
                ("file",JsValue::NULL),("latest",snapshot.clone()),("timers",Set::new(&JsValue::UNDEFINED).into())])?;
            method(&host,"setSession",&[&s])?;let ready=method(&host,"start",&[&s])?;set(&s,"ready",&ready)?;
        }
        set(&s,"latest",&snapshot)?;Ok(Some(s))
    })();
    let s=match begin{Ok(Some(s))=>s,Ok(None)=>return Promise::resolve(&JsValue::UNDEFINED),Err(error)=>return Promise::reject(&error)};
    cloud_host::start(async move{cloud_host::settle(Ok(read(&s,"ready")?)).await?;
        if valid(&host,&s)?&&truthy(&read(&s,"native")?){live_transport_publish_now(s,host)?;}Ok(JsValue::UNDEFINED)
    })
}
#[wasm_bindgen]
pub fn live_transport_publish_motion(account:JsValue,frame:JsValue,host:JsValue)->R<()>{
    let s=method(&host,"session",&[])?;
    if absent(&s)||!truthy(&read(&s,"native")?)||read(&s,"account")?!=account||!valid(&host,&s)?{return Ok(());}
    let sequence=num(&method(&host,"motionClock",&[]) ?)+1.0;method(&host,"setMotionClock",&[&n(sequence)])?;set(&frame,"sequence",&n(sequence))?;
    let packet=method(&read(&s,"native")?,"publishMotion",&[&frame])?;if !truthy(&packet){return Ok(());}
    method(&host,"setMotionClock",&[&read(&frame,"sequence")?])?;
    let latest=if read(&frame,"phase")?==JsValue::from_str("frame"){clone_fields(&frame)?}else{JsValue::NULL};set(&s,"motionLatest",&latest)?;
    if truthy(&latest)&&!truthy(&read(&s,"motionHeartbeat")?){let timer=method(&host,"armMotion",&[&s,&n(1000.0)])?;set(&s,"motionHeartbeat",&timer)?;}
    broadcast(&s,"motion",&packet)?;
    let peers=method(&read(&s,"peers")?,"values",&[])?;
    for p in js_sys::try_iter(&peers)?.ok_or_else(||js_sys::TypeError::new("Peer map is not iterable"))?{live_transport_send_motion(p?,packet.clone())?;}
    if unmatched(&s)?{set(&s,"relayPending",&packet)?;live_transport_schedule_relay(s,host)?;}Ok(())
}
#[wasm_bindgen]
pub fn live_transport_motion_heartbeat(s:JsValue,host:JsValue)->R<()>{
    set(&s,"motionHeartbeat",&JsValue::NULL)?;let latest=read(&s,"motionLatest")?;
    if truthy(&latest){live_transport_publish_motion(read(&s,"account")?,clone_fields(&latest)?,host)?;}Ok(())
}
#[wasm_bindgen]
pub fn live_transport_observe(s:JsValue,detail:JsValue,host:JsValue)->R<()>{
    let folder=if absent(&detail){JsValue::UNDEFINED}else{read(&detail,"folderId")?};
    if truthy(&read(&s,"native")?)&&read(&s,"folder")?==folder{
        let actions=method(&read(&s,"native")?,"observe",&[&read(&detail,"peers")?,&method(&host,"now",&[]) ?])?;live_transport_actions(s,actions,host)?;
    }Ok(())
}
#[wasm_bindgen]
pub fn live_transport_tabs_message(s:JsValue,data:JsValue,host:JsValue)->Promise{
    cloud_host::start(async move{
        if !valid(&host,&s)?||(!absent(&data)&&read(&data,"from")?==read(&s,"own")?){return Ok(JsValue::UNDEFINED);}
        let kind=if absent(&data){JsValue::UNDEFINED}else{read(&data,"t")?};
        if kind==JsValue::from_str("state-request"){
            let latest=read(&read(&s,"native")?,"latest")?;if truthy(&latest){broadcast(&s,"snapshot",&latest)?;}
        }else if kind==JsValue::from_str("motion"){
            let packet=method(&read(&s,"native")?,"receiveMotion",&[&read(&data,"packet")?])?;
            if truthy(&packet){method(&host,"motion",&[&read(&s,"account")?,&packet])?;forward_motion(&s,&read(&data,"packet")?,&read(&packet,"from")?)?;}
        }else if kind==JsValue::from_str("snapshot"){
            let result=async{let packet=method(&read(&s,"native")?,"receive",&[&read(&data,"packet")?])?;accept_snapshot(&s,&packet,&host).await};
            if result.await.is_err()&&valid(&host,&s)?{method(&host,"armTabRequest",&[&s,&n(1000.0)])?;}
        }Ok(JsValue::UNDEFINED)
    })
}
#[wasm_bindgen]
pub fn live_transport_request_tabs(s:JsValue)->R<()>{
    let tabs=read(&s,"tabs")?;if !absent(&tabs){method(&tabs,"postMessage",&[&object(&[("t","state-request".into()),("from",read(&s,"own")?)])?])?;}Ok(())
}
#[wasm_bindgen]
pub fn live_transport_heartbeat(s:JsValue,host:JsValue,fire:bool)->R<()>{
    if fire{let request=live_transport_write(s.clone(),host.clone());let _=cloud_host::start(async move{let _=cloud_host::settle(request).await;Ok(JsValue::UNDEFINED)});}
    method(&host,"armHeartbeat",&[&s,&n(20000.0)])?;Ok(())
}
#[wasm_bindgen]
pub fn live_transport_start(s:JsValue,own:JsValue,host:JsValue)->Promise{
    cloud_host::start(async move{
        let result=async{
            if !truthy(&read(&s,"native")?){
                set(&s,"own",&own)?;let account=read(&s,"account")?;
                for (field,cache) in [("file","mailboxes"),("stateFile","stateFiles")]{let cached=method(&read(&host,cache)?,"get",&[&account])?;set(&s,field,&if truthy(&cached){cached}else{JsValue::NULL})?;}
                set(&s,"native",&method(&host,"newRoom",&[&account,&own])?)?;
                if truthy(&method(&host,"tabsAvailable",&[]) ?){
                    let name=awaited(&host,"hashAccount",&[&account]).await?;if !valid(&host,&s)?{return Ok::<(),JsValue>(());}
                    let name=format!("inhouse-read-room-v1:{}",live_transport_base64(&Uint8Array::new(&name).to_vec()));
                    method(&host,"openTabs",&[&s,&name.into()])?;live_transport_request_tabs(s.clone())?;
                }
            }
            cloud_host::settle(Ok(live_transport_context(s.clone(),host.clone()).into())).await?;if !valid(&host,&s)?{return Ok(());}
            live_transport_publish_now(s.clone(),host.clone())?;
            cloud_host::settle(live_transport_write(s.clone(),host.clone())).await?;if !valid(&host,&s)?{return Ok(());}
            set(&s,"initFailures",&n(0.0))?;let _=live_transport_discover(s.clone(),host.clone());live_transport_heartbeat(s.clone(),host.clone(),false)?;Ok(())
        }.await;
        if result.is_err()&&valid(&host,&s)?{increase(&s,"initFailures")?;method(&host,"armStart",&[&s,&n(retry(failures(&s,"initFailures")?,15000.0,4.0))])?;}
        Ok(JsValue::UNDEFINED)
    })
}
#[wasm_bindgen]
pub fn live_transport_stop(host:JsValue)->R<()>{
    let s=method(&host,"session",&[])?;method(&host,"setSession",&[&JsValue::NULL])?;
    method(&host,"setEpoch",&[&n(num(&method(&host,"epoch",&[]) ?)+1.0)])?;if !truthy(&s){return Ok(());}
    let tabs=read(&s,"tabs")?;if !absent(&tabs){method(&tabs,"close",&[])?;}method(&host,"disconnected",&[&"".into()])?;
    for timer in js_sys::try_iter(&read(&s,"timers")?)?.ok_or_else(||js_sys::TypeError::new("Timers are not iterable"))?{method(&host,"cancelTimer",&[&timer?])?;}
    let ids=method(&read(&s,"peers")?,"keys",&[])?;
    for id in js_sys::try_iter(&ids)?.ok_or_else(||js_sys::TypeError::new("Peers are not iterable"))?{live_transport_close(s.clone(),id?,host.clone())?;}
    let native=read(&s,"native")?;if !absent(&native){method(&native,"free",&[])?;}Ok(())
}
#[wasm_bindgen]
pub fn live_transport_is_valid(s:JsValue,host:JsValue)->R<bool>{
    Ok(method(&host,"session",&[])?==s&&read(&s,"epoch")?==method(&host,"epoch",&[])?&&truthy(&method(&host,"enabled",&[]) ?))
}
#[wasm_bindgen]
pub fn live_transport_resume(host:JsValue)->R<JsValue>{
    let desired=method(&host,"desired",&[])?;
    if !truthy(&desired)||truthy(&method(&host,"session",&[])?)||!truthy(&method(&host,"enabled",&[]) ?){return Ok(JsValue::UNDEFINED);}
    let request=method(&host,"publish",&[&read(&desired,"account")?,&read(&desired,"snapshot")?]);
    Ok(cloud_host::start(async move{let _=cloud_host::settle(request).await;Ok(JsValue::UNDEFINED)}).into())
}
#[wasm_bindgen]
pub fn live_transport_pause(host:JsValue)->R<()>{method(&host,"setDesired",&[&JsValue::NULL])?;live_transport_stop(host)}
#[wasm_bindgen]
pub fn live_transport_timer_fired(s:JsValue,timer:JsValue,callback:JsValue,host:JsValue)->R<()>{
    method(&read(&s,"timers")?,"delete",&[&timer])?;
    if valid(&host,&s)?{crate::host::call(&callback,"timer callback",&[])?;}Ok(())
}
#[wasm_bindgen]
pub fn live_transport_new_peer(s:JsValue,id:JsValue,pc:JsValue,stream:JsValue,host:JsValue)->R<JsValue>{
    let p=object(&[("id",id.clone()),("pc",pc),("ui",read(&s,"ui")?),("open",JsValue::FALSE),("stream",stream),
        ("lastReceived",method(&host,"clock",&[]) ?),("healthAt",method(&host,"clock",&[]) ?)])?;
    method(&read(&s,"peers")?,"set",&[&id,&p])?;Ok(p)
}

fn detached_read(s:JsValue,id:JsValue,file:JsValue,host:JsValue,state:bool){
    let request=if state{live_transport_read_state(s.clone(),id.clone(),file,host.clone())}else{live_transport_read(s.clone(),id.clone(),file,host.clone())};
    let _=cloud_host::start(async move{if cloud_host::settle(Ok(request.into())).await.is_err()&&valid(&host,&s)?{method(&read(&s,"native")?,"readFailed",&[&id])?;}Ok(JsValue::UNDEFINED)});
}

/// Binary-to-text transport encoding, kept here rather than a host chunk loop.
#[wasm_bindgen]
pub fn live_transport_base64(bytes:&[u8])->String{
    const ALPHABET:&[u8;64]=b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out=String::with_capacity(bytes.len().div_ceil(3)*4);
    for chunk in bytes.chunks(3){
        let word=(chunk[0]as u32)<<16|(*chunk.get(1).unwrap_or(&0)as u32)<<8|*chunk.get(2).unwrap_or(&0)as u32;
        out.push(ALPHABET[(word>>18&63)as usize]as char);out.push(ALPHABET[(word>>12&63)as usize]as char);
        out.push(if chunk.len()>1{ALPHABET[(word>>6&63)as usize]as char}else{'='});
        out.push(if chunk.len()>2{ALPHABET[(word&63)as usize]as char}else{'='});
    }out
}
