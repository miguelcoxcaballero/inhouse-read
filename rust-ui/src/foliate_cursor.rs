//! The audible cursor of a Foliate book: where the narration is, independent of
//! the page on screen. The cursor object, the book, its documents and ranges
//! keep their JavaScript identity; this module owns every decision about them.
use std::{cell::RefCell, rc::Rc};
use wasm_bindgen::{prelude::*, JsCast};
use wasm_bindgen_futures::{future_to_promise, JsFuture};
use js_sys::{Array, Function, Object, Promise, Reflect};
use crate::host::{absent, call_opt, get, get_at, global, jmax, method, method_opt, num, read, set, trimmed, truthy};

fn construct(name: &str, args: &[&JsValue]) -> Result<JsValue, JsValue> {
    let constructor: Function = get(&global(), name).dyn_into().map_err(|_| JsValue::from_str("Missing constructor"))?;
    let list = Array::new();
    for argument in args { list.push(argument); }
    Reflect::construct(&constructor, &list)
}
fn cancelled() -> JsValue {
    construct("DOMException", &[&"Speech preparation cancelled".into(), &"AbortError".into()]).unwrap_or_else(|error| error)
}
fn integer(value: &JsValue) -> bool { value.as_f64().is_some_and(|number| number.is_finite() && number.fract() == 0.0) }
fn finite(value: &JsValue) -> bool { value.as_f64().is_some_and(f64::is_finite) }
fn hidden(host: &JsValue) -> bool { truthy(&get(&get(host, "env"), "hidden")) }
fn contents(host: &JsValue) -> Result<Option<JsValue>, JsValue> { method_opt(&get(&get(host, "view"), "renderer"), "getContents", &[]) }
fn plain(entries: &[(&str, JsValue)]) -> Result<JsValue, JsValue> {
    let object = Object::new();
    for (name, value) in entries { set(&object, name, value)?; }
    Ok(object.into())
}
/// `view.lastLocation.index`, or the section the view reports when that is not a number.
fn section_index(view: &JsValue) -> JsValue {
    let location = get(view, "lastLocation");
    let index = get(&location, "index");
    if integer(&index) { index } else { get(&get(&location, "section"), "current") }
}
fn is_valid(host: &JsValue) -> bool { !truthy(&get(host, "closed")) && get(&get(host, "view"), "book") == get(host, "book") }

/// The book is still the one this cursor was made for.
#[wasm_bindgen]
pub fn cursor_valid(host: &JsValue) -> bool { is_valid(host) }

/// A preparation started at `epoch` for `previous` is still wanted.
#[wasm_bindgen]
pub fn cursor_check(host: &JsValue, epoch: &JsValue, previous: &JsValue, is_active: &Function) -> Result<bool, JsValue> {
    Ok(is_valid(host) && get(host, "epoch") == *epoch && get(host, "current") == *previous
        && is_active.call0(&JsValue::UNDEFINED)?.is_truthy())
}

/// The position record of a chapter already on screen, with a stable copy of its text map.
#[wasm_bindgen]
pub fn cursor_state(host: &JsValue, source: &JsValue, map: &JsValue, index: &JsValue, map_text: &Function) -> Result<JsValue, JsValue> {
    // The retained iframe replaces its DOM on chapter changes. Keep an inert
    // document for the audible cursor, so browsing cannot destroy its ranges.
    let owner = get(&get(&get_at(&get(map, "spans"), 0), "node"), "ownerDocument");
    let copy = if truthy(&owner) { method(&owner, "cloneNode", &[&JsValue::TRUE])? } else { JsValue::UNDEFINED };
    let body = get(&copy, "body");
    let stable = if truthy(&body) { map_text.call1(&JsValue::UNDEFINED, &body)? } else { map.clone() };
    let chosen = if get(&stable, "text") == get(map, "text") { stable } else { map.clone() };
    let start = get(source, "start");
    plain(&[("source", source.clone()), ("map", chosen), ("index", index.clone()), ("epoch", get(host, "epoch")),
        ("detached", JsValue::FALSE), ("offset", if truthy(&start) { start } else { 0.into() }),
        ("sentence", JsValue::NULL), ("cfi", JsValue::NULL)])
}

/// The visible chapter paints its sentence only while the screen shows it.
#[wasm_bindgen]
pub fn cursor_highlight(host: &JsValue, state: &JsValue, original: &JsValue, start: &JsValue, end: &JsValue) -> Result<JsValue, JsValue> {
    set(state, "sentence", &Array::of2(start, end))?;
    if !hidden(host) && !truthy(&get(host, "browsing")) { call_opt(original, "highlight", &[start, end])?; }
    Ok(JsValue::UNDEFINED)
}

/// Follow the narration: always remember where it is, turn the page only when it is visible.
#[wasm_bindgen]
pub fn cursor_follow(host: &JsValue, state: &JsValue, map: &JsValue, original: &JsValue, start: &JsValue, end: &JsValue) -> Result<JsValue, JsValue> {
    method(host, "remember", &[state, start, end])?;
    if hidden(host) || truthy(&get(host, "browsing")) { return Ok(JsValue::UNDEFINED); }
    let document = get(&get(&get_at(&get(map, "spans"), 0), "node"), "ownerDocument");
    let rendered = match contents(host)? {
        Some(items) => Array::from(&items).iter().any(|item| get(&item, "doc") == document),
        None => false,
    };
    if rendered { call_opt(original, "follow", &[start, end]) } else { method(host, "reveal", &[]) }
}

#[wasm_bindgen]
pub fn cursor_clear(state: &JsValue, original: &JsValue) -> Result<JsValue, JsValue> {
    set(state, "sentence", &JsValue::NULL)?;
    call_opt(original, "clear", &[])
}

/// Keep the CFI, text offset and reading fraction of the sentence being spoken.
#[wasm_bindgen]
pub fn cursor_remember(host: &JsValue, state: &JsValue, start: &JsValue, end: &JsValue) -> Result<(), JsValue> {
    let view = get(host, "view");
    if !is_valid(host) || get(state, "epoch") != get(host, "epoch") || !integer(&get(state, "index"))
        || !get(&view, "getCFI").is_function() { return Ok(()); }
    let map = get(state, "map");
    let range = method(&map, "rangeFor", &[start, end])?;
    if !truthy(&range) { return Ok(()); }
    let point = method(&range, "cloneRange", &[])?;
    method(&point, "collapse", &[&JsValue::TRUE])?;
    let cfi = method(&view, "getCFI", &[&get(state, "index"), &point])?;
    set(state, "cfi", &cfi)?;
    set(state, "offset", start)?;
    set(host, "current", state)?;
    let length = num(&get(&get(&map, "text"), "length"));
    let ratio = JsValue::from_f64(num(start) / jmax(1.0, length));
    let fraction = get(&method(&get(host, "progress"), "getProgress", &[&get(state, "index"), &ratio])?, "fraction");
    if !truthy(&get(host, "browsing")) {
        let mut entries = vec![("index", get(state, "index")), ("cfi", cfi)];
        if finite(&fraction) { entries.push(("fraction", fraction)); }
        entries.push(("section", "".into()));
        entries.push(("page", "".into()));
        method(host, "onRelocate", &[&plain(&entries)?])?;
    }
    Ok(())
}

async fn settled(value: JsValue) -> Result<JsValue, JsValue> { JsFuture::from(Promise::resolve(&value)).await }

/// Prepare the text of the next chapter from the book file, without rendering it.
/// Resolves `undefined` where the visible reader must keep going, `null` at the end of
/// the book, or the new source with the facts its callbacks need.
#[wasm_bindgen]
pub async fn cursor_next(host: JsValue, is_active: Function, map_text: Function) -> Result<JsValue, JsValue> {
    let previous = get(&host, "current");
    if !hidden(&host) && !truthy(&get(&host, "browsing")) && !truthy(&get(&previous, "detached")) { return Ok(JsValue::UNDEFINED); }
    let epoch = get(&host, "epoch");
    let own = get(&previous, "index");
    let first = if absent(&own) { section_index(&get(&host, "view")) } else { own };
    // Image spreads and unsupported extractors retain the existing reader path.
    if !integer(&first) || get(&get(&get(&host, "book"), "rendition"), "layout") == "pre-paginated" { return Ok(JsValue::UNDEFINED); }
    let mut index = first.as_f64().unwrap_or(0.0) + 1.0;
    loop {
        let sections = read(&read(&host, "book")?, "sections")?;
        if !(index < num(&read(&sections, "length")?)) { break; }
        if !cursor_check(&host, &epoch, &previous, &is_active)? { return Err(cancelled()); }
        let section = get_at(&sections, index as u32);
        if get(&section, "linear") == "no" { index += 1.0; continue; }
        if !get(&section, "createDocument").is_function() { return Ok(JsValue::UNDEFINED); }
        let document = settled(method(&section, "createDocument", &[])?).await?;
        if !cursor_check(&host, &epoch, &previous, &is_active)? { return Err(cancelled()); }
        let mut root = get(&document, "body");
        if !truthy(&root) { root = method_opt(&document, "querySelector", &[&"body".into()])?.unwrap_or(JsValue::UNDEFINED); }
        if !truthy(&root) { return Err(js_sys::Error::new("El capítulo no contiene texto legible.").into()); }
        let map = map_text.call1(&JsValue::UNDEFINED, &root)?;
        let text = get(&map, "text");
        if trimmed(&text.as_string().unwrap_or_default()).is_empty() { index += 1.0; continue; }
        let source = plain(&[("text", text), ("start", 0.into())])?;
        let state = plain(&[("source", source.clone()), ("map", map), ("index", index.into()), ("epoch", epoch.clone()),
            ("detached", JsValue::TRUE), ("offset", 0.into()), ("sentence", JsValue::NULL), ("cfi", JsValue::NULL)])?;
        return plain(&[("source", source), ("state", state), ("epoch", epoch), ("previous", previous)]);
    }
    if !cursor_check(&host, &epoch, &previous, &is_active)? { return Err(cancelled()); }
    Ok(JsValue::NULL)
}

/// The pages of a chapter first read with the screen off, cut where the rendered copy of the same text breaks.
#[wasm_bindgen]
pub async fn cursor_measure(host: JsValue, state: JsValue, source: JsValue, activated: bool, map: JsValue, map_text: Function, page_breaks: Function) -> Result<JsValue, JsValue> {
    if !activated || !method(&source, "isValid", &[])?.is_truthy() || hidden(&host) { return Ok(JsValue::NULL); }
    let index = get(&state, "index");
    let found = match contents(&host)? {
        Some(items) => Array::from(&items).iter().find(|item| get(item, "index") == index),
        None => None,
    };
    let body = get(&get(&found.unwrap_or(JsValue::UNDEFINED), "doc"), "body");
    if !truthy(&body) { return Ok(JsValue::NULL); }
    let rendered = map_text.call1(&JsValue::UNDEFINED, &body)?;
    if get(&rendered, "text") != get(&map, "text") { return Ok(JsValue::NULL); }
    settled(page_breaks.call2(&JsValue::UNDEFINED, &rendered, &get(&get(&host, "view"), "renderer"))?).await
}

/// One turn of "show the sentence being spoken": the loop of `reveal`, cut where it waits.
struct Reveal { host: JsValue, epoch: JsValue, displayed: JsValue, highlight: JsValue }
impl Reveal {
    /// Does another navigation have to be made? Starts it, with the facts to check afterwards.
    fn begin(&self) -> Result<Option<(JsValue, JsValue, JsValue)>, JsValue> {
        let host = &self.host;
        let current = get(host, "current");
        if !(is_valid(host) && get(host, "epoch") == self.epoch && !hidden(host) && !truthy(&get(host, "browsing"))
            && truthy(&get(&current, "cfi")) && get(&current, "cfi") != self.displayed) { return Ok(None); }
        let cfi = get(&current, "cfi");
        let moving = method(&get(host, "view"), "goTo", &[&cfi])?;
        Ok(Some((current, cfi, moving)))
    }
    /// After the navigation: false ends the loop, true asks `begin` again.
    fn finish(&mut self, state: &JsValue, cfi: &JsValue) -> Result<bool, JsValue> {
        let host = &self.host;
        if !is_valid(host) || get(host, "epoch") != self.epoch || hidden(host) || truthy(&get(host, "browsing")) { return Ok(false); }
        self.displayed = cfi.clone();
        if get(host, "current") != *state || get(state, "cfi") != *cfi { return Ok(true); }
        let found = match contents(host)? {
            Some(items) => Array::from(&items).iter().find(|item| get(item, "index") == get(state, "index")),
            None => None,
        };
        let Some(content) = found else { return Ok(true) };
        let document = get(&content, "doc");
        let sentence = get(state, "sentence");
        if !truthy(&document) || !sentence.is_truthy() { return Ok(true); }
        let sentence = Array::from(&sentence);
        let range = method(&get(state, "map"), "rangeFor", &[&sentence.get(0), &sentence.get(1)])?;
        if !truthy(&range) { return Ok(true); }
        let view = get(host, "view");
        let located = method(&view, "getCFI", &[&get(state, "index"), &range])?;
        let resolved = method(&view, "resolveCFI", &[&located])?;
        let anchor = method_opt(&resolved, "anchor", &[&document])?.unwrap_or(JsValue::UNDEFINED);
        if !truthy(&anchor) { return Ok(true); }
        let theme = || -> Result<String, JsValue> { Ok(method(host, "theme", &[])?.as_string().unwrap_or_default()) };
        crate::speech_highlight::speech_style(document.clone(), &theme()?)?;
        crate::speech_highlight::speech_clear(document.clone())?;
        if !crate::speech_highlight::speech_paint(anchor.clone())? {
            let color = plain(&[("color", crate::speech_highlight::speech_overlay(&theme()?).into())])?;
            method_opt(&get(&content, "overlayer"), "add", &[&"inhouse-speech".into(), &anchor, &self.highlight, &color])?;
        }
        Ok(true)
    }
}

/// Bring the screen to the latest audible CFI, once at a time; a canceled catch-up leaves no trace.
#[wasm_bindgen]
pub fn cursor_reveal(host: JsValue, highlight: JsValue) -> Result<JsValue, JsValue> {
    let current = get(&host, "current");
    if !is_valid(&host) || hidden(&host) || truthy(&get(&host, "browsing")) || !truthy(&get(&current, "cfi")) {
        return Ok(Promise::resolve(&JsValue::UNDEFINED).into());
    }
    let pending = get(&host, "revealing");
    if truthy(&pending) { return Ok(pending); }
    let mut run = Reveal { host: host.clone(), epoch: get(&host, "epoch"), displayed: JsValue::UNDEFINED, highlight };
    // The first navigation starts before this call returns, as the screen must change at once.
    let work = match run.begin() {
        Err(error) => Promise::reject(&error),
        Ok(first) => future_to_promise(async move {
            let mut next = first;
            while let Some((state, cfi, moving)) = next {
                settled(moving).await?;
                if !run.finish(&state, &cfi)? { break; }
                next = run.begin()?;
            }
            Ok(JsValue::UNDEFINED)
        }),
    };
    let shown = current;
    let cell = Rc::new(RefCell::new(JsValue::UNDEFINED));
    let inner = cell.clone();
    let owner = host.clone();
    let done = Closure::once_into_js(move || -> Result<(), JsValue> {
        let promise = inner.borrow().clone();
        if get(&owner, "revealing") == promise { set(&owner, "revealing", &JsValue::NULL)?; }
        // A chapter first read with the screen off is now laid out: let the
        // audiobook cut its remaining fragments at the real page breaks.
        if truthy(&get(&shown, "detached")) && !truthy(&get(&shown, "measured")) && get(&owner, "current") == shown && !hidden(&owner) {
            set(&shown, "measured", &JsValue::TRUE)?;
            let event = construct("CustomEvent", &[&"inhouse-speech-layout".into()])?;
            method(&get(&global(), "window"), "dispatchEvent", &[&event])?;
        }
        Ok(())
    });
    let promise = method(&work, "finally", &[&done])?;
    *cell.borrow_mut() = promise.clone();
    set(&host, "revealing", &promise)?;
    Ok(promise)
}
