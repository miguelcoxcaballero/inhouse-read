//! Catalogue flight geometry and retained preview framing. DOM measurements,
//! Three cameras and drawing buffers stay with the browser; the native frame
//! cache avoids recalculating projection matrices for tint/texture-only draws.
use wasm_bindgen::prelude::*;
use js_sys::{Array, Float64Array};
use crate::host::{read, method, num, truthy, absent};
use crate::cloud_host::{object, string};
use crate::jsmath::jmax;
type R<T> = Result<T, JsValue>;
fn number(value:f64)->JsValue { JsValue::from_f64(value) }
fn value(rect:&JsValue,key:&str)->R<f64> { Ok(num(&read(rect,key)?)) }
// Preserve ECMAScript tie rounding and numeric CSS spelling, including -0.
fn rounded(value:f64, places:f64)->String { string(&number(js_sys::Math::round(value * places) / places)) }

#[wasm_bindgen]
pub fn catalog_booklet_rect(node:JsValue)->R<JsValue> {
    let bounds=method(&node,"getBoundingClientRect",&[])?;
    let dataset=read(&node,"dataset")?;
    let face=if absent(&dataset) { JsValue::UNDEFINED } else { read(&dataset,"bookletFace")? };
    let face=if truthy(&face) { face } else { "".into() };
    let parts=Array::from(&method(&face,"split",&[&" ".into()])?);
    if parts.length()==4 {
        let values:[f64;4]=std::array::from_fn(|i| num(&parts.get(i as u32)));
        if values.iter().all(|n| n.is_finite()) && values[2]>0.0 && values[3]>0.0 {
            let left=value(&bounds,"left")?+values[0]; let top=value(&bounds,"top")?+values[1];
            return Ok(object(&[("left",number(left)),("top",number(top)),("width",number(values[2])),
                ("height",number(values[3])),("right",number(left+values[2])),("bottom",number(top+values[3]))]));
        }
    }
    let fields=["left","top","width","height","right","bottom"].map(|key| Ok((key,read(&bounds,key)?)));
    Ok(object(&fields.into_iter().collect::<R<Vec<_>>>()?))
}

#[wasm_bindgen]
pub fn catalog_camera_frames(booklet:JsValue,page:JsValue,stage:JsValue)->R<JsValue> {
    // Number.isFinite intentionally rejects coercible strings/null.
    for rect in [&booklet,&page,&stage] { for key in ["width","height"] {
        if !read(rect,key)?.as_f64().is_some_and(|n| n.is_finite() && n>0.0) { return Ok(JsValue::NULL); }
    }}
    let bw=value(&booklet,"width")?; let bh=value(&booklet,"height")?;
    let pw=value(&page,"width")?; let ph=value(&page,"height")?;
    let bl=value(&booklet,"left")?; let bt=value(&booklet,"top")?;
    let pl=value(&page,"left")?; let pt=value(&page,"top")?;
    let sl=value(&stage,"left")?; let st=value(&stage,"top")?;
    let scale=jmax(pw/bw,ph/bh);
    let x=pl+pw/2.0-sl-scale*(bl+bw/2.0-sl);
    let y=pt+ph/2.0-st-scale*(bt+bh/2.0-st);
    let scale_text=rounded(scale,10000.0);
    Ok(object(&[("stage",format!("translate({}px, {}px) scale({}, {})",rounded(x,100.0),rounded(y,100.0),scale_text,scale_text).into()),
        ("page",format!("translate({}px, {}px) scale({}, {})",rounded(bl-pl,100.0),rounded(bt-pt,100.0),rounded(bw/pw,10000.0),rounded(bh/ph,10000.0)).into())]))
}

#[wasm_bindgen]
pub struct CatalogPreviewFrame { last:Option<[f64;5]>, output:Float64Array }
#[wasm_bindgen]
impl CatalogPreviewFrame {
    #[wasm_bindgen(constructor)]
    pub fn new()->Self { Self { last:None, output:Float64Array::new_with_length(7) } }
    /// Undefined means that the exact camera and drawing buffer already fit.
    /// A change returns a reused [width,height,left,right,top,bottom,resizeBuffer]
    /// packet. The host applies it immediately and never retains an old frame.
    pub fn update(&mut self,width:f64,height:f64,size_x:f64,size_y:f64,padding:f64)->JsValue {
        let width=jmax(1.0,width); let height=jmax(1.0,height);
        let current=[width,height,size_x,size_y,padding];
        if self.last.is_some_and(|last| last.iter().zip(current).all(|(a,b)| !a.is_nan() && a.to_bits()==b.to_bits())) {
            return JsValue::UNDEFINED;
        }
        let resize=self.last.is_none_or(|last| last[0]!=width || last[1]!=height);
        self.last=Some(current);
        let aspect=width/height;
        let half=jmax(size_y/2.0,size_x/(2.0*aspect))*padding;
        self.output.copy_from(&[width,height,-half*aspect,half*aspect,half,-half,if resize{1.0}else{0.0}]);
        self.output.clone().into()
    }
}
