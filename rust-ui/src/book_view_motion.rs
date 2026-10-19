//! Book-view animation ownership and framebuffer reservations. Numeric poses
//! stay in rust-core; Three projection/drawing remain single host operations.
use wasm_bindgen::prelude::*;
use js_sys::{Array,Object,Promise};
use crate::host::*;
type R<T> = Result<T,JsValue>;
fn object(fields:&[(&str,JsValue)]) -> R<JsValue> {
    let value:JsValue=Object::new().into();for (key,item) in fields {set(&value,key,item)?;}Ok(value)
}
fn bound(host:&JsValue,name:&str,value:&JsValue)->R<JsValue>{method(&read(host,name)?,"bind",&[&JsValue::UNDEFINED,value])}
fn eligible(options:&JsValue)->bool {
    ["direct","compact","adaptive"].iter().all(|key|truthy(&get(options,key))) &&
    ["ratio","width","height"].iter().all(|key|get(options,key).as_f64().is_some_and(|n|n.is_finite()&&n.fract()==0.0))
}
#[wasm_bindgen]
pub fn book_view_motion_state(host:JsValue)->R<JsValue>{
    object(&[("noop",read(&host,"noop")?),("host",host),("disposed",JsValue::FALSE),("active",JsValue::NULL),
        ("holds",0.0.into()),("nativeCapacity",JsValue::NULL),("motionCapacity",JsValue::NULL)])
}
#[wasm_bindgen]
pub fn book_view_motion_hold(owner:JsValue,frame:JsValue,options:JsValue)->R<JsValue>{
    if truthy(&read(&owner,"disposed")?){return read(&owner,"noop");}
    let host=read(&owner,"host")?;
    if !eligible(&options){return read(&host,"noop");}
    let holds=num(&read(&owner,"holds")?);
    if holds==0.0 {
        let width=get(&frame,"width");let height=get(&frame,"height");
        set(&owner,"nativeCapacity",&object(&[("width",if truthy(&width){width}else{0.0.into()}),
            ("height",if truthy(&height){height}else{0.0.into()})])?)?;
    }
    set(&owner,"holds",&(holds+1.0).into())?;
    bound(&host,"release",&object(&[("owner",owner),("released",JsValue::FALSE)])?)
}
#[wasm_bindgen]
pub fn book_view_motion_release(lease:JsValue)->R<()> {
    if truthy(&read(&lease,"released")?){return Ok(());}
    set(&lease,"released",&JsValue::TRUE)?;
    let owner=read(&lease,"owner")?;set(&lease,"owner",&JsValue::NULL)?;
    let holds=jmax(0.0,num(&read(&owner,"holds")?)-1.0);set(&owner,"holds",&holds.into())?;
    if holds==0.0{set(&owner,"nativeCapacity",&JsValue::NULL)?;}Ok(())
}
fn finish(job:&JsValue)->R<()> {
    if truthy(&read(job,"done")?){return Ok(());}
    set(job,"done",&JsValue::TRUE)?;
    let owner=read(job,"owner")?;
    if read(&owner,"active")?==*job {
        set(&owner,"active",&JsValue::NULL)?;set(&owner,"motionCapacity",&JsValue::NULL)?;
    }
    let disposed=method(&read(job,"sampler")?,"dispose",&[]);
    let resolve=read(job,"resolve")?;
    // An externally retained finished animation must not retain the book,
    // its host callbacks, sampler or renderer through its cancellation handle.
    for field in ["owner","sampler","onFrame","resolve","tick"]{set(job,field,&JsValue::NULL)?;}
    call(&resolve,"resolve",&[])?;disposed?;Ok(())
}
#[wasm_bindgen]
pub fn book_view_motion_cancel(job:JsValue)->R<()> {
    if truthy(&read(&job,"done")?){return Ok(());}
    cancel_frame(&read(&job,"raf")?)?;finish(&job)
}
#[wasm_bindgen]
pub fn book_view_motion_dispose(owner:JsValue)->R<()> {
    set(&owner,"disposed",&JsValue::TRUE)?;
    let active=read(&owner,"active")?;
    if !absent(&active){book_view_motion_cancel(active)?;}
    set(&owner,"holds",&0.0.into())?;set(&owner,"nativeCapacity",&JsValue::NULL)?;
    // Completed lease tokens can still be released without retaining a model.
    set(&owner,"host",&JsValue::NULL)?;Ok(())
}
#[wasm_bindgen]
pub fn book_view_motion_tick(job:JsValue)->R<()> {
    if truthy(&read(&job,"done")?){return Ok(());}
    let owner=read(&job,"owner")?;
    if truthy(&read(&owner,"disposed")?){return finish(&job);}
    let sampler=read(&job,"sampler")?;let host=read(&owner,"host")?;
    let result=(||->R<()> {
        let step=method(&sampler,"step",&[&clock()?.into()])?;
        let pose=method(&sampler,"sample",&[&step])?;
        if !truthy(&call_opt(&read(&job,"onFrame")?,"onFrame",&[&pose])?) {method(&host,"draw",&[&pose])?;}
        set(&read(&job,"animation")?,"lastFrameTime",&clock()?.into())?;
        // A synchronous frame consumer may have disposed or replaced this job.
        if truthy(&read(&job,"done")?){return Ok(());}
        if num(&step)<1.0 {set(&job,"raf",&request_frame(&read(&job,"tick")?)?)?;}else{finish(&job)?;}Ok(())
    })();
    if result.is_err(){let _=finish(&job);}result
}
#[wasm_bindgen]
pub fn book_view_motion_start(owner:JsValue,frames:JsValue,duration:JsValue,on_frame:JsValue,current:JsValue,options:JsValue)->R<JsValue>{
    if truthy(&read(&owner,"disposed")?){return object(&[("finished",Promise::resolve(&JsValue::UNDEFINED).into()),
        ("cancel",read(&owner,"noop")?),("lastFrameTime",clock()?.into())]);}
    let previous=read(&owner,"active")?;if !absent(&previous){book_view_motion_cancel(previous)?;}
    let host=read(&owner,"host")?;
    let frames=if truthy(&current){
        let result=Array::from(&frames);
        let first=method(&get(&global(),"Object"),"assign",&[&Object::new().into(),&result.get(0),&object(&[("transform",current.clone())])?])?;
        result.set(0,first);result.into()
    }else{frames};
    let sampler=method(&host,"createSampler",&[&frames])?;
    if num(&duration)>0.0 && !truthy(&on_frame) && eligible(&options){
        let capacity=object(&[("width",0.0.into()),("height",0.0.into())])?;
        let measured=(||->R<()> {
            for index in 0..=16 {
                let pose=method(&sampler,"sample",&[&(index as f64/16.0).into()])?;
                let frame=method(&host,"measure",&[&pose])?;
                for dimension in ["width","height"]{set(&capacity,dimension,&jmax(num(&read(&capacity,dimension)?),num(&read(&frame,dimension)?)).into())?;}
            }
            set(&owner,"motionCapacity",&capacity)
        })();
        let restored=if truthy(&current){method(&host,"position",&[&current]).map(|_|())}else{Ok(())};
        if let Err(error)=restored.and(measured){let _=method(&sampler,"dispose",&[]);set(&owner,"motionCapacity",&JsValue::NULL)?;return Err(error);}
    }
    let job=object(&[("owner",owner.clone()),("sampler",sampler.clone()),("onFrame",on_frame),
        ("done",JsValue::FALSE),("raf",JsValue::UNDEFINED)])?;
    let finished=Promise::new(&mut |resolve,_reject|{set(&job,"resolve",&resolve.into()).expect("plain motion job");});
    let now=clock()?;
    let animation=object(&[("finished",finished.into()),("cancel",bound(&host,"cancel",&job)?),("lastFrameTime",now.into())])?;
    set(&job,"animation",&animation)?;set(&job,"tick",&bound(&host,"tick",&job)?)?;
    set(&owner,"active",&job)?;
    let started=(||->R<()> {method(&sampler,"start",&[&duration,&now.into()])?;set(&job,"raf",&request_frame(&read(&job,"tick")?)?)?;Ok(())})();
    if let Err(error)=started{let _=finish(&job);return Err(error);}
    Ok(animation)
}
