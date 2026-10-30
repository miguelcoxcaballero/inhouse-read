//! The methods and getters of the reader controller (reader-controller.js `ReaderController`),
//! answered here: each name hands the controller's state `s` (`host.s`) to reader_controller.rs.
//! `open` (it wraps the caller's relocate callback) and the plain fields stay with the class.
use js_sys::Array;
use wasm_bindgen::prelude::*;
use crate::host::read;
use crate::reader_controller::*;

/// `ReaderController.prototype[name].apply(host, args)`, or the getter `name` of `host`.
#[wasm_bindgen]
pub fn controller_method(host: JsValue, name: &str, args: Array, _kit: JsValue, _ui: JsValue) -> Result<JsValue, JsValue> {
    let s = read(&host, "s")?;
    let a = |index: u32| args.get(index);
    let done = |result: Result<(), JsValue>| result.map(|_| JsValue::UNDEFINED);
    match name {
        // Getters: the book's metadata ({} in PDF), native media progress (numbers only), the
        // diagnostic of the callback receipt, its language and table of contents, the engine's
        // next speech source (undefined keeps format navigation; null is the actual book end) and
        // the real page count (PDF only; reflowable formats have none and answer null).
        "metadata" => Ok(controller_metadata(&s)),
        "speechPosition" => Ok(controller_speech_position(&s)),
        "speechDiagnosticState" => controller_diagnostic(&s),
        "language" => Ok(controller_language(&s)),
        "toc" => Ok(controller_toc(&s)),
        "getNextSpeechSource" => controller_next_source(&s),
        "pageCount" => Ok(controller_page_count(&s)),
        "goToTarget" => Ok(controller_go_to_target(&s, a(0)).into()),
        "applyPreferences" => Ok(controller_apply_preferences(&s, a(0)).into()),
        "getSpeechText" => Ok(controller_speech_text(&s).into()),
        // Text plus the mapping the audiobook needs to highlight and follow each sentence; null when the engine has none.
        "getSpeechSource" => Ok(controller_speech_source(&s, a(0)).into()),
        "browseSpeech" => done(controller_browse_speech(&s)),
        "returnToSpeech" => controller_return_to_speech(&s),
        "stopSpeech" => done(controller_stop_speech(&s)),
        "getPageSnapshot" => Ok(controller_page_snapshot(s, a(0)).into()),
        "search" => Ok(controller_search(&s, a(0)).into()),
        "clearSearch" => done(controller_clear_search(&s)),
        "getSelection" => controller_selection(&s),
        "addQuoteAnnotation" => done(controller_quote(&s, true, &a(0))),
        "removeQuoteAnnotation" => done(controller_quote(&s, false, &a(0))),
        // The cover as a Blob: page 1's thumbnail in PDF, the embedded one in EPUB/MOBI.
        "getCoverBlob" => Ok(controller_cover(s, a(0)).into()),
        // A stale background count cannot be attributed to a book opened after it.
        "getLengthMetadata" => Ok(controller_length(s).into()),
        "next" => Ok(controller_next(&s, a(0)).into()),
        "prev" => Ok(controller_prev(&s).into()),
        "goToFraction" => Ok(controller_go_to_fraction(s, a(0)).into()),
        "goToLocator" => Ok(controller_go_to_locator(s, a(0), a(1)).into()),
        "close" => done(controller_close(&s)),
        _ => Err(js_sys::TypeError::new(&format!("ReaderController has no member {name}")).into()),
    }
}

/// `PdfReader.prototype[name].apply(host, args)`: which page is drawn, fitted, adapted, re-themed,
/// restored, spoken, searched and captured (pdf_reader.rs, pdf_speech.rs) over `host.s`.
#[wasm_bindgen]
pub fn pdf_method(host: JsValue, name: &str, args: Array, _kit: JsValue, _ui: JsValue) -> Result<JsValue, JsValue> {
    use crate::pdf_reader::*;
    use crate::pdf_speech::*;
    let s = read(&host, "s")?;
    let a = |index: u32| args.get(index);
    let done = |result: Result<(), JsValue>| result.map(|_| JsValue::UNDEFINED);
    Ok(match name {
        "goToPage" => pdf_go_to_page(s, a(0), a(1)).into(),
        "next" => pdf_next(s, a(0)).into(),
        "prev" => pdf_prev(s).into(),
        "getLengthMetadata" => pdf_length(s).into(),
        "toggleZoom" => pdf_toggle_zoom(s, a(0), a(1)).into(),
        "getSpeechText" => pdf_speech_text(s).into(),
        "getSpeechSource" => pdf_speech_source(s, a(0)).into(),
        "browseSpeech" => done(pdf_speech_browse(&s))?,
        "stopSpeech" => done(pdf_speech_stop(&s))?,
        "returnToSpeech" => pdf_speech_return(s).into(),
        "getNextSpeechSource" => pdf_next_speech(s, a(0)).into(),
        "getPageSnapshot" => pdf_snapshot(s, a(0)).into(),
        "search" => pdf_search(s, a(0)).into(),
        "getSelection" => pdf_selection()?,
        "applyPreferences" => pdf_apply_preferences(s, a(0)).into(),
        // Page 1's thumbnail as a Blob, for the shelf's cover.
        "getCoverBlob" => pdf_cover(s, a(0)).into(),
        "close" => done(pdf_close(&s))?,
        _ => return Err(js_sys::TypeError::new(&format!("PdfReader has no method {name}")).into()),
    })
}

/// `FoliateReader.prototype[name].apply(host, args)` over `host.s`, and the members of its speech
/// cursor (foliate_cursor.rs) over the cursor itself; `kit` holds the snapshot pipeline and
/// foliate's Overlayer, read when the member runs.
#[wasm_bindgen]
pub fn foliate_method(host: JsValue, name: &str, args: Array, kit: JsValue, _ui: JsValue) -> Result<JsValue, JsValue> {
    use crate::foliate_reader::*;
    use crate::foliate_cursor::*;
    let a = |index: u32| args.get(index);
    let done = |result: Result<(), JsValue>| result.map(|_| JsValue::UNDEFINED);
    match name {
        // Snapshot the current paginated column/scroll viewport after a CFI restore.
        "getPageSnapshot" => Ok(foliate_snapshot(read(&host, "s")?, read(&kit, "snapshot")?).into()),
        "search" => Ok(foliate_search(read(&host, "s")?, a(0)).into()),
        "getSelection" => foliate_selection(&read(&host, "s")?),
        "close" => done(foliate_close(&read(&host, "s")?)),
        "valid" => Ok(cursor_valid(&host).into()),
        "remember" => done(cursor_remember(&host, &a(0), &a(1), &a(2))),
        // Only the most recent audible CFI is shown; no timer, animation or rendering promise is a
        // prerequisite for synthesis or playback.
        "reveal" => cursor_reveal(host, read(&read(&kit, "Overlayer")?, "highlight")?),
        _ => Err(js_sys::TypeError::new(&format!("The foliate reader has no method {name}")).into()),
    }
}
