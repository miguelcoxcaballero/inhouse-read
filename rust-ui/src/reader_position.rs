//! What may be written down as the reader's position. A paginator can briefly report no anchor
//! during layout or replacement; such a notification must not erase the last location committed on
//! device, so only a finite fraction together with a usable locator is persisted. Properties are
//! read in the order, and as often, as the original did, so accessors on a record observe the same.
use wasm_bindgen::prelude::*;
use crate::host::{absent, finite, jmax, jmin, method, num, read, set, truthy};
use crate::pdf_reader::plain;

/// `Number.isInteger`.
fn integer(value: &JsValue) -> bool { value.as_f64().is_some_and(|number| number.is_finite() && number.fract() == 0.0) }
/// `locator?.kind === name`.
fn kind_is(locator: &JsValue, name: &str) -> Result<bool, JsValue> {
    if absent(locator) { return Ok(false); }
    Ok(read(locator, "kind")?.as_string().is_some_and(|kind| kind == name))
}
/// `value.trim()` as a condition: the text has something other than white space in it.
fn trims_to_something(value: &JsValue) -> Result<bool, JsValue> { Ok(truthy(&method(value, "trim", &[])?)) }
/// `Math.min(1, Math.max(0, fraction))`.
fn unit(fraction: &JsValue) -> JsValue { jmin(1.0, jmax(0.0, num(fraction))).into() }

fn position(location: &JsValue) -> Result<JsValue, JsValue> {
    if !truthy(location) || !finite(&read(location, "fraction")?) { return Ok(JsValue::NULL); }
    let locator = read(location, "locator")?;
    // `typeof locator.value === 'string' && locator.value.trim()`: two reads of the property.
    if kind_is(&locator, "cfi")? && read(&locator, "value")?.is_string() && trims_to_something(&read(&locator, "value")?)? {
        let fraction = unit(&read(location, "fraction")?);
        let place = plain(&[("kind", "cfi".into()), ("value", read(&locator, "value")?)])?;
        return plain(&[("fraction", fraction), ("locator", place)]);
    }
    if kind_is(&locator, "pdf-page")? && integer(&read(&locator, "value")?) && num(&read(&locator, "value")?) > 0.0 {
        let fraction = unit(&read(location, "fraction")?);
        let place = plain(&[("kind", "pdf-page".into()), ("value", read(&locator, "value")?)])?;
        if integer(&read(&locator, "textOffset")?) && num(&read(&locator, "textOffset")?) > 0.0 { set(&place, "textOffset", &read(&locator, "textOffset")?)?; }
        return plain(&[("fraction", fraction), ("locator", place)]);
    }
    Ok(JsValue::NULL)
}

/// The position a location may be saved as, or null.
#[wasm_bindgen]
pub fn persistable_position(location: &JsValue) -> Result<JsValue, JsValue> { position(location) }

/// The same for an engine's relocation notice `{ fraction, cfi, index, textOffset }`: an anchor
/// (CFI) wins, otherwise a PDF page `index + 1`, otherwise nothing.
#[wasm_bindgen]
pub fn persistable_relocation(notice: &JsValue, engine: &JsValue) -> Result<JsValue, JsValue> {
    let fraction = read(notice, "fraction")?;
    let cfi = read(notice, "cfi")?;
    let index = read(notice, "index")?;
    let offset = read(notice, "textOffset")?;
    let locator = if cfi.is_string() && trims_to_something(&cfi)? { plain(&[("kind", "cfi".into()), ("value", cfi)])? }
        else if engine.as_string().is_some_and(|name| name == "pdf") && integer(&index) && num(&index) >= 0.0 {
            plain(&[("kind", "pdf-page".into()), ("value", (num(&index) + 1.0).into()), ("textOffset", offset)])?
        } else { JsValue::NULL };
    position(&plain(&[("fraction", fraction), ("locator", locator)])?)
}
