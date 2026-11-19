//! The page helpers a reader's kit carried as JavaScript modules whose every function only called back into this
//! one: readers/page-snapshot.js (the snapshot of a page), speech-map.js (the text of a root with the doors from an
//! offset to a range and back) and speech-hold.js (the hold gesture of the audiobook). The readers now ask here.
//! A kit that names a helper is still asked first: that is how a test hands a reader its own.
//! The text map goes through the module's own exports (`ui.speech_map`, and `speech_range` / `speech_offset` bound
//! to the document and the spans), as the JavaScript did, so the page still sees those three calls.
use wasm_bindgen::prelude::*;
use js_sys::Object;
use crate::host::{call, construct, get, global, method, read, set};
use crate::reader_experience_policy::bound;

type R<T = JsValue> = Result<T, JsValue>;

/// The Rust UI module of a kit (`kit.ui()`), whose exports are bound into what a map or a hold hands out.
pub(crate) fn module(kit: &JsValue) -> R { call(&get(kit, "ui"), "ui", &[]) }

/// `mapSpeechText` (mode 0), `mapTextLayer` (1), `mapTextNode` (2) and `mapTextNodes` (3) of readers/speech-map.js:
/// `{text, spans, rangeFor(start, end), offsetOf(container, offset)}` of a root.
#[wasm_bindgen]
pub fn speech_mapped(ui: &JsValue, mode: u32, root: &JsValue) -> R {
    // `void root.ownerDocument`: a missing root of a document or a text layer is the caller's error.
    if !root.is_truthy() && mode < 2 { read(root, "ownerDocument")?; }
    let map = method(ui, "speech_map", &[root, &mode.into()])?;
    let (text, spans, doc) = (read(&map, "text")?, read(&map, "spans")?, read(&map, "doc")?);
    let made: JsValue = Object::new().into();
    set(&made, "text", &text)?;
    set(&made, "spans", &spans)?;
    set(&made, "rangeFor", &bound(ui, "speech_range", &[&doc, &spans])?.into())?;
    set(&made, "offsetOf", &bound(ui, "speech_offset", &[&doc, &spans])?.into())?;
    Ok(made)
}

/// `mapPDFTextLayer(layer, layout)`: the reordered PDF.js spans mapped onto the joined text that reflow speaks, in the
/// shape of the other maps; null (what `pdf_layer_map` answers) when the layer does not hold the layout's items.
#[wasm_bindgen]
pub fn pdf_layer_mapped(ui: &JsValue, layer: &JsValue, layout: &JsValue) -> R {
    let map = method(ui, "pdf_layer_map", &[layer, layout])?;
    if !map.is_truthy() { return Ok(map); }
    let (text, spans) = (read(&map, "text")?, read(&map, "spans")?);
    let made: JsValue = Object::new().into();
    set(&made, "text", &text)?;
    set(&made, "spans", &spans)?;
    set(&made, "rangeFor", &bound(ui, "pdf_layer_range", &[&read(&map, "doc")?, &spans])?.into())?;
    set(&made, "offsetOf", &bound(ui, "pdf_layer_offset", &[&spans])?.into())?;
    Ok(made)
}

/// `speechHold(doc)` of readers/speech-hold.js: the same hold gesture in the EPUB iframe and the PDF text layer.
/// Short taps always retain their page/chrome action, including while narration plays.
#[wasm_bindgen]
pub fn speech_hold(ui: &JsValue, doc: &JsValue) -> R {
    let made: JsValue = Object::new().into();
    set(&made, "canLongPress", &bound(ui, "speech_hold_event", &[doc, &JsValue::TRUE])?.into())?;
    set(&made, "onLongPress", &bound(ui, "speech_hold_event", &[doc, &JsValue::FALSE])?.into())?;
    Ok(made)
}
/// One hold: the audiobook (ReadingVoice) answers the event of the window; `handled` is what it left in the detail.
#[wasm_bindgen]
pub fn speech_hold_event(doc: &JsValue, probe: &JsValue, event: &JsValue) -> R {
    let detail: JsValue = Object::new().into();
    set(&detail, "doc", doc)?;
    set(&detail, "x", &read(event, "clientX")?)?;
    set(&detail, "y", &read(event, "clientY")?)?;
    set(&detail, "probe", probe)?;
    set(&detail, "handled", &JsValue::FALSE)?;
    let init: JsValue = Object::new().into();
    set(&init, "detail", &detail)?;
    method(&read(&global(), "window")?, "dispatchEvent", &[&construct("CustomEvent", &[&"inhouse-speech-hold".into(), &init])?])?;
    read(&detail, "handled")
}

/// `kit[name](...args)`, answered here when the kit does not name it.
pub(crate) fn invoke(kit: &JsValue, name: &str, args: &[&JsValue]) -> R {
    let given = get(kit, name);
    if !given.is_undefined() { return call(&given, name, args); }
    let arg = |index: usize| args.get(index).map_or(JsValue::UNDEFINED, |value| (*value).clone());
    let map = |mode: u32| speech_mapped(&module(kit)?, mode, &arg(0));
    Ok(match name {
        "settlePageLayout" => crate::page_snapshot::snapshot_settle(arg(0), arg(1)).into(),
        // `(element, {themeFilter} = {})`
        "renderedPageFilter" => { let options = arg(1); crate::page_snapshot::snapshot_filter(&arg(0), &if options.is_undefined() { options } else { read(&options, "themeFilter")? })?.into() }
        "snapshotDOMPage" => crate::page_snapshot::snapshot_dom_page(arg(0), arg(1)).into(),
        "compositePageSnapshots" => crate::page_snapshot::snapshot_composite(&arg(0), &arg(1))?,
        // `(source, {filter = 'none', displayBounds, paper = false, paperSource = source} = {})`
        "snapshotCanvas" => {
            let (source, options) = (arg(0), arg(1));
            let option = |name: &str| if options.is_undefined() { Ok(JsValue::UNDEFINED) } else { read(&options, name) };
            let or = |value: JsValue, default: JsValue| if value.is_undefined() { default } else { value };
            let (filter, bounds, paper, paper_source) = (or(option("filter")?, "none".into()), option("displayBounds")?, option("paper")?, or(option("paperSource")?, source.clone()));
            crate::page_snapshot::snapshot_canvas(&source, &filter, &bounds, paper.is_truthy(), &paper_source)?
        }
        "mapText" => map(0)?,
        "mapTextLayer" => map(1)?,
        "mapTextNodes" => map(3)?,
        "mapPDFTextLayer" => pdf_layer_mapped(&module(kit)?, &arg(0), &arg(1))?,
        "hold" => speech_hold(&module(kit)?, &arg(0))?,
        _ => return call(&given, name, args),
    })
}
/// The kit's `mapText` as the function the chapter walkers are handed.
pub(crate) fn map_text(kit: &JsValue) -> R<js_sys::Function> {
    let given = read(kit, "mapText")?;
    if !given.is_undefined() { return Ok(wasm_bindgen::JsCast::unchecked_into(given)); }
    let ui = module(kit)?;
    bound(&ui, "speech_mapped", &[&ui, &0.into()])
}
