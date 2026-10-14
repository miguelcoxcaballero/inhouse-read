//! The reading panel's markup and its icons. The structure of the panel is data this module owns
//! (reader_panel.html, with the icons and the speed choices marked); the controls found in it by
//! reader_view, reader_controls and the rest are wired by Rust as well.
use wasm_bindgen::prelude::*;
use js_sys::Array;
use crate::host::{num, number_string, text_of};

const PANEL: &str = include_str!("reader_panel.html");
const PATHS: [(&str, &str); 11] = [
    ("close", "M6 6l12 12M18 6L6 18"), ("play", "m9 5 11 7-11 7Z"), ("pause", "M8 5v14M16 5v14"), ("stop", "M7 7h10v10H7Z"),
    ("bookmark", "M6 3h12v18l-6-4-6 4Z"), ("minus", "M5 12h14"), ("plus", "M5 12h14M12 5v14"),
    ("search", "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14ZM16 16l5 5"), ("quote", "M4 5h7v7H5v3h4v4H4v-7Zm10 0h7v7h-6v3h4v4h-5v-7Z"),
    ("prev", "m15 18-6-6 6-6"), ("next", "m9 18 6-6-6-6"),
];
const MARKED: [&str; 6] = ["close", "bookmark", "prev", "play", "next", "stop"];

pub(crate) fn icon(name: &str) -> String {
    let path = PATHS.iter().find(|(key, _)| *key == name).map_or(PATHS[1].1, |(_, path)| path);
    format!("<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.7\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><path d=\"{path}\"/></svg>")
}

/// A line icon by name; an unknown name draws the play triangle.
#[wasm_bindgen]
pub fn reader_icon(name: &JsValue) -> String { icon(&text_of(name)) }

/// The whole panel, with one speed choice for each of `steps`.
#[wasm_bindgen]
pub fn reader_panel_markup(steps: &Array) -> String {
    let rates: String = steps.iter().map(|step| {
        let value = number_string(num(&step));
        format!("<label class=\"reading-speed__step\"><input type=\"radio\" name=\"reading-rate\" value=\"{value}\" data-rate><span>{}×</span></label>", value.replacen('.', ",", 1))
    }).collect();
    let mut markup = PANEL.replace("{{rates}}", &rates);
    for name in MARKED { markup = markup.replace(&format!("{{{{icon:{name}}}}}"), &icon(name)); }
    markup
}
