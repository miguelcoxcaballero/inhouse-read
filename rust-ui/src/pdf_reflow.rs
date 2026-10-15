//! The adaptable page of a PDF: its text cut at the places its illustrations stood, each
//! illustration cropped from the page's original pixels, prepared off to the side in small
//! tasks and committed only when every pixel and every text offset is ready. The same text
//! offsets map the reordered text layer to the spoken text.
use wasm_bindgen::{prelude::*, JsCast};
use js_sys::{Array, Error, Function, Promise};
use crate::eager::{eager, settled};
use crate::host::{absent, call, clock, get, get_at, method, num, number_string, read, set, truthy, jmax, jmin};
use crate::pdf_reader::plain;

/// A task's worth of cropping; more than this and input and paint must get a turn.
const SLICE_MS: f64 = 8.0;

pub(crate) fn clear(root: &JsValue) -> Result<(), JsValue> {
    for canvas in Array::from(&method(root, "querySelectorAll", &[&"canvas".into()])?).iter() {
        set(&canvas, "height", &0.into())?;
        set(&canvas, "width", &0.into())?;
    }
    method(root, "replaceChildren", &[])?;
    Ok(())
}

#[wasm_bindgen]
pub fn reflow_clear(root: &JsValue) -> Result<(), JsValue> { clear(root) }

fn commit(root: &JsValue, fragment: &JsValue, text: &JsValue) -> Result<(), JsValue> {
    if get(fragment, "textContent") != *text { return Err(Error::new("El texto adaptable no coincide con el texto completo del PDF.").into()); }
    clear(root)?;
    method(root, "append", &[fragment])?;
    Ok(())
}

enum Stage { Start, Figure(u32, bool), Tail, Done }

/// The nodes of the page in reading order, produced one at a time so that cropping can be sliced.
struct Nodes { doc: JsValue, layout: JsValue, source: JsValue, rects: JsValue, viewport: JsValue, place: JsValue, figures: Array, offset: f64, stage: Stage }

impl Nodes {
    fn new(doc: &JsValue, layout: &JsValue, source: &JsValue, rects: &JsValue, viewport: &JsValue, place: &JsValue) -> Nodes {
        Nodes { doc: doc.clone(), layout: layout.clone(), source: source.clone(), rects: rects.clone(), viewport: viewport.clone(), place: place.clone(), figures: Array::new(), offset: 0.0, stage: Stage::Start }
    }
    fn text_node(&self, from: f64, to: Option<f64>) -> Result<JsValue, JsValue> {
        let text = get(&self.layout, "text");
        let piece = match to { Some(end) => method(&text, "slice", &[&from.into(), &end.into()])?, None => method(&text, "slice", &[&from.into()])? };
        method(&self.doc, "createTextNode", &[&piece])
    }
    fn picture(&self, rect: &JsValue) -> Result<JsValue, JsValue> {
        let canvas = method(&self.doc, "createElement", &[&"canvas".into()])?;
        set(&canvas, "className", &"pdf-reflow-image".into())?;
        set(&canvas, "width", &(num(&get(rect, "x1")) - num(&get(rect, "x0"))).into())?;
        set(&canvas, "height", &(num(&get(rect, "y1")) - num(&get(rect, "y0"))).into())?;
        method(&canvas, "setAttribute", &[&"role".into(), &"img".into()])?;
        method(&canvas, "setAttribute", &[&"aria-label".into(), &"Ilustración de la página".into()])?;
        set(&get(&canvas, "style"), "width", &format!("{}%", number_string(jmin(100.0, num(&get(&canvas, "width")) / num(&get(&self.source, "width")) * 100.0))).into())?;
        let (width, height) = (get(&canvas, "width"), get(&canvas, "height"));
        let drawn = method(&canvas, "getContext", &[&"2d".into()]).and_then(|context| method(&context, "drawImage",
            &[&self.source, &get(rect, "x0"), &get(rect, "y0"), &width, &height, &0.into(), &0.into(), &width, &height]));
        if let Err(error) = drawn { set(&canvas, "height", &0.into())?; set(&canvas, "width", &0.into())?; return Err(error); }
        Ok(canvas)
    }
    fn next(&mut self) -> Result<Option<JsValue>, JsValue> {
        loop {
            match self.stage {
                Stage::Start => {
                    let placed = call(&self.place, "pdfPlaceFigures", &[&self.rects, &self.layout, &self.source, &self.viewport])?;
                    self.figures = Array::from(&placed);
                    self.stage = Stage::Figure(0, false);
                }
                Stage::Figure(index, emitted) => {
                    if index >= self.figures.length() { self.stage = Stage::Tail; continue; }
                    let figure = self.figures.get(index);
                    let at = num(&get(&figure, "offset"));
                    if !emitted && at > self.offset {
                        self.stage = Stage::Figure(index, true);
                        return Ok(Some(self.text_node(self.offset, Some(at))?));
                    }
                    let canvas = self.picture(&get(&figure, "rect"))?;
                    self.offset = at;
                    self.stage = Stage::Figure(index + 1, false);
                    return Ok(Some(canvas));
                }
                Stage::Tail => {
                    self.stage = Stage::Done;
                    if self.offset < num(&get(&get(&self.layout, "text"), "length")) || self.figures.length() == 0 { return Ok(Some(self.text_node(self.offset, None)?)); }
                }
                Stage::Done => return Ok(None),
            }
        }
    }
}

/// Fill the root at once, from the original pixels of the page.
#[wasm_bindgen]
pub fn reflow_populate(root: &JsValue, layout: &JsValue, source: &JsValue, rects: &JsValue, viewport: &JsValue, place: &JsValue) -> Result<(), JsValue> {
    let doc = read(root, "ownerDocument")?;
    let fragment = method(&doc, "createDocumentFragment", &[])?;
    let build = || -> Result<(), JsValue> {
        let mut nodes = Nodes::new(&doc, layout, source, rects, viewport, place);
        while let Some(node) = nodes.next()? { method(&fragment, "append", &[&node])?; }
        commit(root, &fragment, &get(layout, "text"))
    };
    if let Err(error) = build() { clear(&fragment)?; return Err(error); }
    Ok(())
}

/// Cropping many original illustrations must leave room for input and paint.
/// Prepare detached nodes in small tasks; the previous complete page remains
/// intact until every source pixel and text offset is ready to commit together.
fn next_task(doc: &JsValue) -> Result<JsValue, JsValue> {
    let channel = get(&get(doc, "defaultView"), "MessageChannel");
    let promise = Promise::new(&mut |resolve, _| {
        if absent(&channel) { let _ = crate::host::set_timeout(&resolve, 0.0); return; }
        // Posted tasks avoid the growing timer delay across a long sequence of
        // crops, and keep progressing when a background reader has no rAF ticks.
        let _ = (|| -> Result<(), JsValue> {
            let created = js_sys::Reflect::construct(channel.unchecked_ref::<Function>(), &Array::new())?;
            let (first, second) = (get(&created, "port1"), get(&created, "port2"));
            let (closing, finish) = (created.clone(), resolve.clone());
            set(&first, "onmessage", &Closure::once_into_js(move || {
                let _ = method(&get(&closing, "port1"), "close", &[]);
                let _ = method(&get(&closing, "port2"), "close", &[]);
                let _ = finish.call0(&JsValue::UNDEFINED);
            }))?;
            method(&second, "postMessage", &[&JsValue::NULL])?;
            Ok(())
        })();
    });
    Ok(promise.into())
}

#[wasm_bindgen]
pub fn reflow_prepare(root: JsValue, layout: JsValue, source: JsValue, rects: JsValue, viewport: JsValue, is_active: JsValue, place: JsValue) -> Promise {
    eager(async move {
        let doc = read(&root, "ownerDocument")?;
        let fragment = method(&doc, "createDocumentFragment", &[])?;
        let mut started = clock()?;
        let mut committed = false;
        let outcome: Result<bool, JsValue> = async {
            let mut nodes = Nodes::new(&doc, &layout, &source, &rects, &viewport, &place);
            while let Some(node) = nodes.next()? {
                method(&fragment, "append", &[&node])?;
                if clock()? - started < SLICE_MS { continue; }
                settled(next_task(&doc)?).await?;
                if !truthy(&call(&is_active, "isActive", &[])?) { return Ok(false); }
                started = clock()?;
            }
            if !truthy(&call(&is_active, "isActive", &[])?) { return Ok(false); }
            commit(&root, &fragment, &get(&layout, "text"))?;
            committed = true;
            Ok(true)
        }.await;
        if !committed { clear(&fragment)?; }
        Ok(outcome?.into())
    })
}

// ---- the reordered text layer -----------------------------------------------------------------

/// Maps the reordered PDF.js spans to the same joined text that reflow speaks. Null unless the
/// layer holds exactly the text items of the layout, in order.
#[wasm_bindgen]
pub fn pdf_layer_map(layer: &JsValue, layout: &JsValue) -> Result<JsValue, JsValue> {
    if !truthy(&get(layout, "geometric")) { return Ok(JsValue::NULL); }
    let doc = read(layer, "ownerDocument")?;
    let walker = method(&doc, "createTreeWalker", &[layer, &4.into()])?;
    let nodes = Array::new();
    let mut node = method(&walker, "nextNode", &[])?;
    while truthy(&node) {
        if truthy(&get(&node, "nodeValue")) { nodes.push(&node); }
        node = method(&walker, "nextNode", &[])?;
    }
    let items: Vec<JsValue> = Array::from(&get(layout, "items")).iter().filter(|item| truthy(&get(item, "str"))).collect();
    if nodes.length() as usize != items.len() || (0..nodes.length()).any(|index| get(&nodes.get(index), "nodeValue") != get(&items[index as usize], "str")) { return Ok(JsValue::NULL); }
    let spans = Array::new();
    for span in Array::from(&get(layout, "spans")).iter() {
        let copy = js_sys::Object::assign(&js_sys::Object::new(), span.unchecked_ref::<js_sys::Object>());
        set(&copy, "node", &get_at(&nodes, num(&get(&span, "itemIndex")) as u32))?;
        spans.push(&copy);
    }
    plain(&[("text", get(layout, "text")), ("spans", spans.into()), ("doc", doc)])
}

fn span_at(spans: &Array, offset: &JsValue) -> i32 {
    let (mut low, mut high, mut found) = (0i32, spans.length() as i32 - 1, -1i32);
    while low <= high {
        let middle = (low + high) >> 1;
        if num(&get(&spans.get(middle as u32), "start")) <= num(offset) { found = middle; low = middle + 1; } else { high = middle - 1; }
    }
    found
}

#[wasm_bindgen]
pub fn pdf_layer_range(doc: &JsValue, spans: Array, start: &JsValue, end: &JsValue) -> Result<JsValue, JsValue> {
    if !(num(end) > num(start)) || spans.length() == 0 { return Ok(JsValue::NULL); }
    let mut first_index = span_at(&spans, start);
    let last_index = span_at(&spans, &(num(end) - 1.0).into());
    if first_index < 0 { first_index = 0; } else if num(start) >= num(&get(&spans.get(first_index as u32), "end")) { first_index += 1; }
    if last_index < first_index || last_index < 0 || first_index >= spans.length() as i32 { return Ok(JsValue::NULL); }
    let (first, last) = (spans.get(first_index as u32), spans.get(last_index as u32));
    let range = method(doc, "createRange", &[])?;
    method(&range, "setStart", &[&get(&first, "node"), &(num(&get(&first, "sourceStart")) + jmax(0.0, num(start) - num(&get(&first, "start")))).into()])?;
    let length = num(&get(&last, "end")) - num(&get(&last, "start"));
    method(&range, "setEnd", &[&get(&last, "node"), &(num(&get(&last, "sourceStart")) + jmin(length, num(end) - num(&get(&last, "start")))).into()])?;
    Ok(range)
}

#[wasm_bindgen]
pub fn pdf_layer_offset(spans: Array, node: &JsValue, offset: &JsValue) -> f64 {
    let matching: Vec<JsValue> = spans.iter().filter(|span| get(span, "node") == *node).collect();
    let found = matching.iter().find(|span| num(offset) <= num(&get(span, "sourceEnd"))).or(matching.last());
    match found {
        Some(span) => num(&get(span, "start")) + jmax(0.0, jmin(num(&get(span, "end")) - num(&get(span, "start")), num(offset) - num(&get(span, "sourceStart")))),
        None => 0.0,
    }
}
