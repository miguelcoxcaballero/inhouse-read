//! The reading experience: the object the app drives while a book is open (panel, audiobook,
//! lists, places, sharing). Its JavaScript class keeps the state and the objects it owns; how it is
//! put together, how a place is named, what the mini player and the return button show, how the
//! lists are drawn and how a book is shared is decided here. Properties are read as the original
//! read them, and every method that was an `async function` runs up to its first wait at once.
use wasm_bindgen::{prelude::*, JsCast};
use js_sys::{Array, Function, JSON, JsString, Object, Promise, Reflect};
use crate::eager::{eager, settled};
use crate::host::{absent, global, jmax, js_round, method, method_opt, num, number_string, read, set_timeout, text, text_of, text_value, truthy};
use crate::pdf_reader::plain;
use crate::reader_actions::{call, get, one, set, two};

const STORAGE_KEY: &str = "inhouse-read-reading-preferences";

fn new_of(constructor: &JsValue, args: &[&JsValue]) -> Result<JsValue, JsValue> {
    let list = Array::new();
    for argument in args { list.push(argument); }
    Reflect::construct(constructor.dyn_ref::<Function>().ok_or_else(|| JsValue::from(js_sys::TypeError::new("Reader component is not a constructor")))?, &list)
}
/// `${a}${b}…`: every part converted the way a template literal converts it, joined in UTF-16.
fn cat(parts: &[JsValue]) -> JsString {
    let list = Array::new();
    for part in parts { list.push(&text_value(part)); }
    list.join("")
}
fn quick(text: &str) -> JsValue { JsValue::from_str(text) }
fn listener(target: &JsValue, kind: &str, handler: &Closure<dyn FnMut(JsValue)>) -> Result<(), JsValue> { method(target, "addEventListener", &[&quick(kind), handler.as_ref()])?; Ok(()) }
/// A handler that lives as long as the page, like an arrow function the original handed to the DOM.
fn forever(mut work: impl FnMut(JsValue) -> Result<(), JsValue> + 'static) -> Closure<dyn FnMut(JsValue)> {
    Closure::wrap(Box::new(move |event: JsValue| { if let Err(error) = work(event) { wasm_bindgen::throw_val(error) } }) as Box<dyn FnMut(JsValue)>)
}
fn message(host: &JsValue, text: &str) -> Result<(), JsValue> { one(host, "error", &quick(text))?; Ok(()) }
/// `value?.kind === 'pdf-page'`
fn is_pdf_page(locator: &JsValue) -> Result<bool, JsValue> { Ok(!absent(locator) && text(&read(locator, "kind")?, "pdf-page")) }
/// `Math.round(fraction * 100)` printed as the page prints a number.
fn percent(place: &JsValue) -> Result<JsValue, JsValue> { Ok(quick(&number_string(js_round(num(&read(place, "fraction")?) * 100.0)))) }

/// `if (selection?.text) host.selectedQuoteSelection = selection`
fn remember(host: &JsValue, selection: &JsValue) -> Result<(), JsValue> {
    if !absent(selection) && truthy(&read(selection, "text")?) { set(host, "selectedQuoteSelection", selection)?; }
    Ok(())
}

/// Everything the constructor did after it stored the reader: the lists of places, the preferences
/// read back from storage, the chrome and the components made from `kit`'s constructors, the
/// observers and the listeners that keep the panel and the quote selection current.
#[wasm_bindgen]
pub fn exp_build(host: JsValue, kit: JsValue) -> Result<(), JsValue> {
    let reader = get(&host, "reader")?;
    set(&host, "history", &Array::new())?;
    set(&host, "bookmarks", &Array::new())?;
    set(&host, "quotes", &Array::new())?;
    set(&host, "location", &plain(&[("fraction", 0.into()), ("locator", JsValue::NULL)])?)?;
    let normalize: Function = get(&kit, "normalize")?.dyn_into()?;
    let stored = (|| -> Result<JsValue, JsValue> {
        let item = method(&read(&global(), "localStorage")?, "getItem", &[&quick(STORAGE_KEY)])?;
        let text = if truthy(&item) { item } else { quick("{}") };
        normalize.call1(&JsValue::UNDEFINED, &JSON::parse(&text_of(&text))?)
    })();
    set(&host, "preferences", &match stored { Ok(preferences) => preferences, Err(_) => normalize.call0(&JsValue::UNDEFINED)? })?;
    call(&get(&host, "chrome")?, "create")?;
    let (screen, panel, mini, back) = (get(&host, "screen")?, get(&host, "panel")?, get(&host, "miniPlayer")?, get(&host, "returnButton")?);
    set(&host, "view", &new_of(&get(&kit, "ReaderView")?, &[&screen, &panel, &mini, &back])?)?;
    set(&host, "lists", &new_of(&get(&kit, "ReaderLists")?, &[&panel])?)?;
    if read(&global(), "ResizeObserver")?.is_function() {
        let observer = get(&global(), "ResizeObserver")?;
        for (field, target, handler) in [("miniPlayerResizeObserver", &mini, "syncMiniPlayerLayout"), ("returnResizeObserver", &back, "syncReturnLayout")] {
            let owner = host.clone();
            let callback = forever(move |_| { call(&owner, handler)?; Ok(()) });
            let made = new_of(&observer, &[callback.as_ref()])?;
            callback.forget();
            set(&host, field, &made)?;
            method(&made, "observe", &[target])?;
        }
    }
    let document = get(&global(), "document")?;
    method(&get(&document, "body")?, "append", &[&panel])?;
    set(&host, "selectedQuoteSelection", &JsValue::NULL)?;
    set(&host, "quoteColor", &quick("yellow"))?;
    let owner = host.clone();
    let on_selection = forever(move |_| {
        let screen = get(&owner, "screen")?;
        let document = get(&global(), "document")?;
        if !truthy(&method(&screen, "contains", &[&get(&document, "activeElement")?])?) {
            let selected = method(&global(), "getSelection", &[])?;
            let anchor = if absent(&selected) { JsValue::UNDEFINED } else { get(&selected, "anchorNode")? };
            let parent = if absent(&anchor) { JsValue::UNDEFINED } else { get(&anchor, "parentElement")? };
            if !truthy(&method(&screen, "contains", &[&parent])?) { return Ok(()); }
        }
        let selection = method(&get(&owner, "reader")?, "getSelection", &[])?;
        if selection.is_string() {
            let locator = read(&read(&get(&owner, "reader")?, "location")?, "locator")?;
            remember(&owner, &plain(&[("text", selection), ("locator", locator)])?)
        } else { remember(&owner, &selection) }
    });
    listener(&document, "selectionchange", &on_selection)?;
    on_selection.forget();
    let owner = host.clone();
    let on_detail = forever(move |event| remember(&owner, &read(&event, "detail")?));
    listener(&global(), "inhouse-reader-selection", &on_detail)?;
    on_detail.forget();
    let owner = host.clone();
    let on_voice = Closure::wrap(Box::new(move |state: JsValue, text: JsValue| {
        if let Err(error) = (|| -> Result<(), JsValue> { two(&get(&owner, "chrome")?, "voiceState", &state, &text)?; Ok(()) })() { wasm_bindgen::throw_val(error) }
    }) as Box<dyn FnMut(JsValue, JsValue)>);
    set(&host, "voice", &new_of(&get(&kit, "ReadingVoice")?, &[&reader, on_voice.as_ref()])?)?;
    on_voice.forget();
    set(&host, "controls", &new_of(&get(&kit, "ReaderControls")?, &[&host])?)?;
    // Idioma first, then the voices of that language: both are the app's own dropdowns.
    let owner = host.clone();
    let on_language = forever(move |value| { one(&owner, "chooseLanguage", &value)?; Ok(()) });
    set(&host, "languageMenu", &new_of(&get(&kit, "SelectMenu")?, &[&plain(&[("label", quick("Idioma")), ("onChange", on_language.as_ref().clone())])?])?)?;
    on_language.forget();
    let owner = host.clone();
    let on_voice_choice = forever(move |value| { two(&owner, "setPreference", &quick("voice"), &value)?; Ok(()) });
    let extra = method(&panel, "querySelector", &[&quick("[data-neural]")])?;
    set(&host, "voiceMenu", &new_of(&get(&kit, "SelectMenu")?, &[&plain(&[("label", quick("Voz")), ("extra", extra), ("onChange", on_voice_choice.as_ref().clone())])?])?)?;
    on_voice_choice.forget();
    method(&method(&panel, "querySelector", &[&quick("[data-voice-menus]")])?, "append", &[&read(&get(&host, "languageMenu")?, "root")?, &read(&get(&host, "voiceMenu")?, "root")?])?;
    set(&host, "neuralPicker", &new_of(&get(&kit, "NeuralVoicePicker")?, &[&host])?)?;
    call(&host, "populateVoices")?;
    let owner = host.clone();
    let resize = forever(move |_| { call(&get(&owner, "chrome")?, "resize")?; Ok(()) });
    let viewport = read(&global(), "visualViewport")?;
    if !absent(&viewport) {
        method(&viewport, "addEventListener", &[&quick("resize"), resize.as_ref()])?;
        method(&viewport, "addEventListener", &[&quick("scroll"), resize.as_ref()])?;
    }
    listener(&global(), "resize", &resize)?;
    set(&host, "resizePanel", resize.as_ref())?;
    resize.forget();
    Ok(())
}

/// The appearance back to the defaults, keeping what is said aloud.
#[wasm_bindgen]
pub fn exp_reset_appearance(host: &JsValue, normalize: &Function) -> Result<(), JsValue> {
    let current = get(host, "preferences")?;
    let kept = plain(&[("rate", read(&current, "rate")?), ("voice", read(&current, "voice")?), ("voiceLang", read(&current, "voiceLang")?)])?;
    set(host, "preferences", &normalize.call1(&JsValue::UNDEFINED, &kept)?)?;
    call(host, "applyPreferences")?;
    Ok(())
}

/// Lock the screen to the other orientation.
#[wasm_bindgen]
pub fn exp_rotate(host: JsValue) -> Promise {
    eager(async move {
        let turn = async {
            let orientation = read(&read(&global(), "screen")?, "orientation")?;
            if !absent(&orientation) && truthy(&read(&orientation, "lock")?) {
                let portrait = truthy(&method(&read(&orientation, "type")?, "startsWith", &[&quick("portrait")])?);
                settled(method(&orientation, "lock", &[&quick(if portrait { "landscape" } else { "portrait" })])?).await?;
                message(&host, "")
            } else { message(&host, "No se puede girar.") }
        }.await;
        if turn.is_err() { message(&host, "Gira el dispositivo.")?; }
        Ok(JsValue::UNDEFINED)
    })
}

/// `Página 3 de 10`, `Capítulo · Página 2` or `42 % del libro`.
#[wasm_bindgen]
pub fn exp_label(host: &JsValue, place: &JsValue) -> Result<JsString, JsValue> {
    if is_pdf_page(&read(place, "locator")?)? {
        let value = read(&read(place, "locator")?, "value")?;
        let reader = get(host, "reader")?;
        let pages: JsValue = if truthy(&read(&reader, "pageCount")?) { cat(&[quick(" de "), read(&reader, "pageCount")?]).into() } else { quick("") };
        return Ok(cat(&[quick("Página "), value, pages]));
    }
    if truthy(&read(place, "section")?) {
        let page: JsValue = if truthy(&read(place, "page")?) { cat(&[quick(" · Página "), read(place, "page")?]).into() } else { quick("") };
        return Ok(cat(&[read(place, "section")?, page]));
    }
    Ok(cat(&[percent(place)?, quick(" % del libro")]))
}

/// Take the engine's location, name it, and hand the panel what it shows.
#[wasm_bindgen]
pub fn exp_relocate(host: &JsValue, clone_place: &Function) -> Result<(), JsValue> {
    let copy = clone_place.call1(&JsValue::UNDEFINED, &read(&get(host, "reader")?, "location")?)?;
    let location = Object::assign(&Object::new(), copy.unchecked_ref::<Object>());
    let section = read(&read(&get(host, "reader")?, "location")?, "section")?;
    set(&location, "section", &if truthy(&section) { section } else { quick("") })?;
    let page = read(&read(&get(host, "reader")?, "location")?, "page")?;
    set(&location, "page", &if truthy(&page) { page } else { quick("") })?;
    set(host, "location", &location)?;
    let label = one(host, "label", &get(host, "location")?)?;
    let place = get(host, "location")?;
    let compact: JsValue = if is_pdf_page(&read(&place, "locator")?)? {
        let reader = get(host, "reader")?;
        let pages: JsValue = if truthy(&read(&reader, "pageCount")?) { cat(&[quick(" / "), read(&reader, "pageCount")?]).into() } else { quick("") };
        cat(&[read(&read(&place, "locator")?, "value")?, pages]).into()
    } else { cat(&[percent(&place)?, quick(" %")]).into() };
    let progress = JsValue::from_f64(num(&read(&place, "fraction")?) * 100.0);
    let pdf = is_pdf_page(&read(&place, "locator")?)?;
    let last = read(&place, "locator")?;
    let value = if absent(&last) { JsValue::UNDEFINED } else { read(&last, "value")? };
    method(&get(host, "view")?, "relocate", &[&label, &compact, &progress, &pdf.into(), &value])?;
    call(host, "updateBookmarkButton")?;
    Ok(())
}

/// `1,25×`
fn rate_label(rate: &JsValue) -> JsString {
    let printed = text_of(rate).replacen('.', ",", 1);
    cat(&[quick(&printed), quick("×")])
}

/// What the mini player shows for the audiobook's state.
#[wasm_bindgen]
pub fn exp_mini(host: &JsValue, state: &JsValue, message: &JsValue, title: &Function) -> Result<(), JsValue> {
    let shown = if truthy(state) { state.clone() } else { quick("") };
    let name = title.call1(&JsValue::UNDEFINED, &get(host, "book")?)?;
    let rate = rate_label(&read(&get(host, "preferences")?, "rate")?);
    let has_book = truthy(&get(host, "book")?);
    let icon = crate::reader_markup::icon(if text(state, "playing") { "pause" } else { "play" });
    method(&get(host, "view")?, "updateMiniPlayer", &[&shown, message, &name, &rate, &has_book.into(), &quick(&icon)])?;
    Ok(())
}

/// The bookmark button is lit when the current place is one of the bookmarks.
#[wasm_bindgen]
pub fn exp_bookmark_button(host: &JsValue) -> Result<(), JsValue> {
    let marked = crate::reading_places::reading_marked(get(host, "bookmarks")?.unchecked_into::<Array>(), get(host, "location")?)?;
    method(&get(host, "view")?, "updateBookmarkButton", &[&marked.into()])?;
    Ok(())
}

/// The "return" button names the place the person left.
#[wasm_bindgen]
pub fn exp_return_button(host: &JsValue) -> Result<(), JsValue> {
    let voice = get(host, "voice")?;
    let audio = if absent(&voice) { JsValue::UNDEFINED } else { read(&voice, "browsing")? };
    let any = truthy(&read(&get(host, "history")?, "length")?);
    let label = if truthy(&read(&get(host, "history")?, "length")?) {
        let named = read(&read(&get(host, "history")?, "0")?, "label")?;
        if truthy(&named) { named } else { one(host, "label", &read(&get(host, "history")?, "0")?)? }
    } else { quick("") };
    method(&get(host, "view")?, "updateReturnButton", &[&truthy(&audio).into(), &any.into(), &label])?;
    Ok(())
}

/// `3.2 MB` or `812 KB`.
#[wasm_bindgen]
pub fn exp_format_size(bytes: &JsValue) -> Result<JsString, JsValue> {
    let size = num(bytes);
    if size >= 1048576.0 { return Ok(cat(&[js_sys::Number::from(size / 1048576.0).to_fixed(1)?.into(), quick(" MB")])); }
    Ok(cat(&[quick(&number_string(jmax(1.0, js_round(size / 1024.0)))), quick(" KB")]))
}

/// The three lists of places. `open(name, index, place)` and `remove(name, places, index)` are the
/// page's own handlers; each list gets them bound to its name.
#[wasm_bindgen]
pub fn exp_render_places(host: &JsValue, open: &Function, remove: &Function) -> Result<(), JsValue> {
    call(host, "updateBookmarkButton")?;
    call(host, "updateReturnButton")?;
    let icon = quick(&crate::reader_markup::icon("close"));
    for name in ["history", "bookmarks", "quotes"] {
        let places = get(host, name)?.unchecked_into::<Array>();
        let labels = Array::new();
        for place in places.iter() {
            let label = read(&place, "label")?;
            labels.push(&if truthy(&label) { label } else { one(host, "label", &place)? });
        }
        let select = method(open, "bind", &[host, &quick(name)])?;
        let drop = method(remove, "bind", &[host, &quick(name), &places])?;
        method(&get(host, "lists")?, "renderPlaces", &[&quick(name), &places, &labels, &select, &drop, &icon])?;
    }
    Ok(())
}

/// Remove the place at `index` (and its highlight, for a quote), save, and draw the lists again.
#[wasm_bindgen]
pub fn exp_remove_place(host: JsValue, name: JsValue, places: JsValue, index: JsValue) -> Promise {
    eager(async move {
        let removed = read(&two(&places, "splice", &index, &1.into())?, "0")?;
        if text(&name, "quotes") { one(&get(&host, "reader")?, "removeQuoteAnnotation", &removed)?; }
        settled(call(&host, "savePlaces")?).await?;
        call(&host, "renderPlaces")?;
        Ok(JsValue::UNDEFINED)
    })
}

/// The table of contents, or the bookmarks when the book has none. `jump` follows a link of it.
#[wasm_bindgen]
pub fn exp_render_toc(host: &JsValue, jump: &Function) -> Result<(), JsValue> {
    let available = method(&get(host, "lists")?, "renderToc", &[&read(&get(host, "reader")?, "toc")?, jump])?;
    one(host, "showPlaceTab", &quick(if truthy(&available) { "toc" } else { "bookmarks" }))?;
    Ok(())
}

/// A search result list is only for the search tab.
#[wasm_bindgen]
pub fn exp_show_tab(host: &JsValue, name: &JsValue) -> Result<(), JsValue> {
    if !text(name, "search") { call(host, "endSearch")?; }
    one(&get(host, "view")?, "showTab", name)?;
    Ok(())
}

#[wasm_bindgen]
pub fn exp_show_place_tab(host: &JsValue, name: &JsValue) -> Result<(), JsValue> {
    set(host, "placeTab", name)?;
    one(&get(host, "view")?, "showPlaceTab", name)?;
    Ok(())
}

/// The line of the panel that explains what went wrong.
#[wasm_bindgen]
pub fn exp_error(host: &JsValue, text: &JsValue) -> Result<(), JsValue> {
    let line = method(&get(host, "panel")?, "querySelector", &[&quick(".reading-error")])?;
    if absent(&line) { return Err(js_sys::TypeError::new("Cannot set properties of null (setting 'textContent')").into()); }
    set(&line, "textContent", text)
}

/// Hand the original file to the system's share sheet, or download it.
#[wasm_bindgen]
pub fn exp_share(host: JsValue, title: Function) -> Promise {
    eager(async move {
        let book = get(&host, "book")?;
        let content = if absent(&book) { JsValue::UNDEFINED } else { read(&book, "content")? };
        if !truthy(&content) { message(&host, "Archivo original no disponible.")?; return Ok(JsValue::UNDEFINED); }
        let book = get(&host, "book")?;
        let named = read(&book, "fileName")?;
        let name: JsValue = if truthy(&named) { named } else {
            let stem = text_value(&read(&book, "title")?);
            let format = read(&book, "format")?;
            let lowered = method(&text_value(&if truthy(&format) { format } else { quick("pdf") }), "toLowerCase", &[])?;
            cat(&[stem, quick("."), lowered]).into()
        };
        let mime = read(&get(&host, "book")?, "mimeType")?;
        let kind = if truthy(&mime) { mime } else { let own = read(&content, "type")?; if truthy(&own) { own } else { quick("application/octet-stream") } };
        let file = new_of(&get(&global(), "File")?, &[&Array::of1(&content), &name, &plain(&[("type", kind)])?])?;
        let shared = async {
            let navigator = get(&global(), "navigator")?;
            let wanted = plain(&[("files", Array::of1(&file).into())])?;
            let can = method_opt(&navigator, "canShare", &[&wanted])?.unwrap_or(JsValue::UNDEFINED);
            if truthy(&can) && truthy(&read(&navigator, "share")?) {
                let details = plain(&[("title", title.call1(&JsValue::UNDEFINED, &get(&host, "book")?)?), ("files", Array::of1(&file).into())])?;
                settled(method(&navigator, "share", &[&details])?).await?;
            } else {
                let url = method(&get(&global(), "URL")?, "createObjectURL", &[&file])?;
                let link = method(&get(&global(), "document")?, "createElement", &[&quick("a")])?;
                set(&link, "href", &url)?;
                set(&link, "download", &read(&file, "name")?)?;
                method(&link, "click", &[])?;
                let revoke = Closure::once_into_js(move || { let _ = get(&global(), "URL").and_then(|class| method(&class, "revokeObjectURL", &[&url])); });
                set_timeout(&revoke, 30000.0)?;
            }
            call(&get(&host, "panel")?, "close")?;
            Ok::<(), JsValue>(())
        }.await;
        if let Err(error) = shared {
            if !text(&read(&error, "name")?, "AbortError") { message(&host, "No se pudo compartir.")?; }
        }
        Ok(JsValue::UNDEFINED)
    })
}
