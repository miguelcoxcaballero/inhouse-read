//! The members of the EPUB/MOBI/AZW3/FB2/CBZ reader (readers/foliate-reader.js `FoliateReader`) that were short
//! JavaScript methods around the exports of foliate_open.rs and foliate_reader.rs: opening a book, turning a page,
//! going to a fraction, a CFI or a target, the audiobook's doors (return, stop, the next and the current
//! spoken source, the visible text), the search and quote marks of the view, the reading preferences, the cover and
//! the cached length. `eager` runs each `async` one the way the method ran: at once up to its first wait and on in the
//! reaction job of what it waits for, so `open()`, a turn or a navigation settle at the microtask they did.
//! The reader's state stays the JavaScript object `this.s`; `kit` is the module's own table of doorways.
//! The frozen original is tests/unit/helpers/reference-foliate-reader.js; foliate-reader-wasm.test.js compares both.
use js_sys::{Array, Function, Object, Promise};
use wasm_bindgen::prelude::*;
use crate::eager::eager;
use crate::quick_wait::wait;
use crate::foliate_cursor::next_chapter;
use crate::foliate_open::{cursor_source, cursor_wrap, foliate_open, foliate_opened, foliate_ready, foliate_speech_source};
use crate::foliate_reader::{foliate_layout, foliate_reset_cursor, foliate_styles, foliate_turn, speech_prepare};
use crate::host::{absent, call, method, method_opt, num, read, set};

type R<T = JsValue> = Result<T, JsValue>;

thread_local! {
    /// `() => true`, the default `isActive` of a turn.
    static ALWAYS: Function = Closure::<dyn FnMut() -> bool>::new(|| true).into_js_value().unchecked_into();
    /// `() => view === s.view && book === view.book`: the book whose length is being counted is still the open one.
    static SAME_BOOK: Function = Closure::<dyn FnMut(JsValue, JsValue, JsValue) -> R<bool>>::new(|s: JsValue, view: JsValue, book: JsValue|
        Ok(view == read(&s, "view")? && book == read(&view, "book")?)).into_js_value().unchecked_into();
}
fn always() -> Function { ALWAYS.with(Function::clone) }
/// `{ name = fallback } = {}` of a parameter: the property of the options, `undefined` without options.
fn option(options: &JsValue, name: &str) -> R {
    if options.is_undefined() { return Ok(JsValue::UNDEFINED); }
    if options.is_null() { return Err(js_sys::TypeError::new(&format!("Cannot destructure property '{name}' of 'object null' as it is null.")).into()); }
    read(options, name)
}
/// `target?.name(...args)`.
fn on(target: &JsValue, name: &str, args: &[&JsValue]) -> R { if absent(target) { Ok(JsValue::UNDEFINED) } else { method(target, name, args) } }
/// `a?.b`.
fn opt(target: &JsValue, name: &str) -> R { if absent(target) { Ok(JsValue::UNDEFINED) } else { read(target, name) } }
/// How a `bool` parameter of a generated binding reads a value: ToInt32, then non-zero.
fn flag(value: &JsValue) -> bool {
    if let Some(flag) = value.as_bool() { return flag; }
    if absent(value) { return false; }
    let number = num(value);
    number.is_finite() && (number.trunc() % 4_294_967_296.0) != 0.0
}
/// `quote?.locator?.kind === 'cfi'`.
fn cfi_quote(quote: &JsValue) -> R<Option<JsValue>> {
    let locator = opt(quote, "locator")?;
    Ok(if opt(&locator, "kind")? == JsValue::from_str("cfi") { Some(locator) } else { None })
}

/// `FoliateReader.prototype[name].apply(host, args)`.
#[wasm_bindgen]
pub fn foliate_reader_method(host: JsValue, name: &str, args: Array, kit: JsValue, ui: JsValue) -> R {
    let s = read(&host, "s")?;
    let (a0, a1, a2) = (args.get(0), args.get(1), args.get(2));
    let undefined = JsValue::UNDEFINED;
    Ok(match name {
        "open" => eager(async move {
            let (on_relocate, on_toggle_chrome) = (option(&a2, "onRelocate")?, option(&a2, "onToggleChrome")?);
            let (on_user_navigation, on_follow_link) = (option(&a2, "onUserNavigation")?, option(&a2, "onFollowLink")?);
            let view = foliate_open(&host, &s, &a0, &on_relocate, &on_toggle_chrome, &on_user_navigation, &on_follow_link, &kit, &ui)?;
            wait(&method(&view, "open", &[&a1])?).await?;
            foliate_opened(&s, &view, &kit, &ui)?;
            let options = Object::new();
            set(&options, "showTextStart", &JsValue::TRUE)?;
            wait(&method(&view, "init", &[&options])?).await?;
            foliate_ready(&s, &view, &a0, &kit, &ui)?;
            Ok(JsValue::UNDEFINED)
        }).into(),
        "next" | "prev" => {
            let direction = if name == "next" { "next" } else { "prev" };
            let forward = name == "next";
            eager(async move {
                let is_active = if forward { option(&a0, "isActive")? } else { JsValue::UNDEFINED };
                let is_active: Function = if is_active.is_undefined() { always() } else { is_active.unchecked_into() };
                wait(&foliate_turn(&s, direction, &is_active)?).await?;
                Ok(JsValue::UNDEFINED)
            }).into()
        }
        "goToFraction" | "goToCfi" | "goToTarget" => {
            let fraction = name == "goToFraction";
            let optional = name == "goToCfi";
            eager(async move {
                foliate_reset_cursor(&s)?;
                if optional && !a0.is_truthy() { return Ok(JsValue::UNDEFINED); }
                wait(&on(&read(&s, "view")?, if fraction { "goToFraction" } else { "goTo" }, &[&a0])?).await?;
                Ok(JsValue::UNDEFINED)
            }).into()
        }
        "returnToSpeech" => eager(async move {
            wait(&on(&read(&s, "speechCursor")?, "returnToSpeech", &[])?).await?;
            Ok(JsValue::UNDEFINED)
        }).into(),
        "stopSpeech" => { on(&read(&s, "speechCursor")?, "reset", &[])?; undefined }
        "getNextSpeechSource" => on(&read(&s, "speechCursor")?, "next", &[&a0])?,
        "getSpeechText" => eager(async move {
            let range = opt(&opt(&read(&s, "view")?, "lastLocation")?, "range")?;
            let text = on(&range, "toString", &[])?;
            Ok(if text.is_truthy() { text } else { JsValue::from_str("") })
        }).into(),
        // The source's handlers: foliate_speech_source (foliate_open.rs).
        "getSpeechSource" => eager(async move {
            let visible = option(&a0, "visible")?;
            let visible = if visible.is_undefined() { false } else { flag(&visible) };
            let map_text: Function = read(&kit, "mapText")?.unchecked_into();
            let page_breaks: Function = read(&kit, "pageBreaks")?.unchecked_into();
            let prepared = speech_prepare(s.clone(), visible, map_text, page_breaks).await?;
            if read(&prepared, "done")?.is_truthy() { return read(&prepared, "value"); }
            foliate_speech_source(&s, &prepared, &kit, &ui)
        }).into(),
        "clearSearch" => { method_opt(&read(&s, "view")?, "clearSearch", &[])?; undefined }
        "addQuoteAnnotation" | "removeQuoteAnnotation" => {
            if let Some(locator) = cfi_quote(&a0)? {
                // `view?.addAnnotation?.({...})`: the mark is only made for a view that takes it.
                let view = read(&s, "view")?;
                let member = if name == "addQuoteAnnotation" { "addAnnotation" } else { "deleteAnnotation" };
                if !absent(&view) && !absent(&read(&view, member)?) {
                    let mark = Object::new();
                    set(&mark, "value", &read(&locator, "value")?)?;
                    if name == "addQuoteAnnotation" { set(&mark, "color", &read(&a0, "color")?)?; }
                    method(&view, member, &[&mark])?;
                }
            }
            undefined
        }
        "applyPreferences" => eager(async move {
            set(&s, "preferences", &call(&read(&kit, "normalize")?, "normalizeReadingPreferences", &[&a0])?)?;
            foliate_layout(&s, read(&kit, "announce")?.unchecked_ref())?;
            foliate_styles(&s, read(&kit, "readingCSS")?.unchecked_ref())?;
            Ok(JsValue::UNDEFINED)
        }).into(),
        // Portada embebida del libro (EPUB/MOBI), si el archivo trae una; una portada rota no puede impedir leer el libro.
        "getCoverBlob" => eager(async move {
            let cover: R = async {
                let book = opt(&read(&s, "view")?, "book")?;
                let cover = method_opt(&book, "getCover", &[])?.unwrap_or(JsValue::UNDEFINED);
                wait(&cover).await
            }.await;
            Ok(match cover { Ok(cover) if !absent(&cover) => cover, _ => JsValue::NULL })
        }).into(),
        // Cached physical-length metadata, counted outside the visible paginator.
        "getLengthMetadata" => {
            let view = read(&s, "view")?;
            let book = opt(&view, "book")?;
            if !book.is_truthy() { return Ok(Promise::resolve(&JsValue::NULL).into()); }
            let cached = read(&s, "lengthMetadata")?;
            if !absent(&cached) { return Ok(cached); }
            let options = Object::new();
            set(&options, "isActive", &SAME_BOOK.with(|same| same.bind3(&JsValue::NULL, &s, &view, &book)))?;
            let measured = call(&read(&kit, "measure")?, "measureBookLength", &[&book, &options])?;
            set(&s, "lengthMetadata", &measured)?;
            measured
        }
        _ => return Err(js_sys::TypeError::new(&format!("The foliate reader has no member {name}")).into()),
    })
}

/// `FoliateSpeechCursor.prototype[name].apply(cursor, args)` for the members that were short JavaScript methods
/// (foliate-speech-cursor.js): returning to the audible place, closing, wrapping the visible chapter's source, finding
/// the next chapter and the source being spoken. `kit` holds foliate's SectionProgress and the text and page-break
/// doorways. reset() and browse() stay JavaScript: a wheel tick during audio reaches them.
#[wasm_bindgen]
pub fn cursor_member(host: JsValue, name: &str, args: Array, kit: JsValue, ui: JsValue) -> R {
    let (a0, a1, a2) = (args.get(0), args.get(1), args.get(2));
    Ok(match name {
        "returnToSpeech" => eager(async move {
            set(&host, "browsing", &JsValue::FALSE)?;
            wait(&method(&host, "reveal", &[])?).await?;
            Ok(JsValue::UNDEFINED)
        }).into(),
        "close" => {
            method(&host, "reset", &[])?;
            set(&host, "closed", &JsValue::TRUE)?;
            method(&read(&host, "env")?, "removeEventListener", &[&JsValue::from_str("visibilitychange"), &read(&host, "onVisibility")?])?;
            JsValue::UNDEFINED
        }
        "wrap" => cursor_wrap(&host, &a0, &a1, &a2, &kit, &ui)?,
        "next" => eager(async move {
            let is_active = option(&a0, "isActive")?;
            let is_active: JsValue = if is_active.is_undefined() { always().into() } else { is_active };
            let found = next_chapter(host.clone(), is_active.clone().unchecked_into(), read(&kit, "mapText")?.unchecked_into()).await?;
            if opt(&found, "state")?.is_truthy() { cursor_source(&host, &found, &is_active, &kit, &ui) } else { Ok(found) }
        }).into(),
        "currentSource" => {
            let state = read(&host, "current")?;
            if !state.is_truthy() { return Ok(JsValue::NULL); }
            let source = Object::assign(&Object::new(), &crate::host::boxed(&read(&state, "source")?).unchecked_into());
            set(&source, "start", &read(&state, "offset")?)?;
            source.into()
        }
        _ => return Err(js_sys::TypeError::new(&format!("The speech cursor has no member {name}")).into()),
    })
}
