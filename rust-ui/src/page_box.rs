//! The height of a paginated book's page box, kept across openings.
//!
//! The free height under a book changes by a few dozen pixels with things that are
//! not a resize: Android hiding its status bar once the book is open, the opening
//! flyout, the audio mini player, the "return" bar. Choosing the box from whatever
//! the height was at that moment paginated the same book differently each time it
//! was opened. A box is now remembered per page width and only ever shrinks, when it
//! no longer fits at all; it converges on the smallest of those states and every
//! later opening reuses it. A real resize (rotation, split screen, the keyboard) is a
//! different box, kept beside it.
use wasm_bindgen::prelude::*;
use js_sys::{Array, Object, JSON};
use crate::host::{get, jmax, jmin, method_opt, num, set, truthy};

const KEY: &str = "inhouse-read-page-boxes-v3";
// Legacy budget used by callers to express the same available page height.
const MINI_PLAYER_RESERVE: f64 = 52.0;
// A change of free height beyond this is a real resize, not chrome.
const PAGE_BOX_SLACK: f64 = 96.0;
const MAX_BOXES: u32 = 8;

fn finite(value: &JsValue) -> bool { value.as_f64().is_some_and(f64::is_finite) }

/// The boxes stored under the key; anything unreadable is no boxes at all.
fn load(storage: &JsValue) -> Array {
    let read = || -> Result<Array, JsValue> {
        let stored = method_opt(storage, "getItem", &[&KEY.into()])?.unwrap_or(JsValue::UNDEFINED);
        let text = if truthy(&stored) { stored } else { "[]".into() };
        let boxes = JSON::parse(&text.as_string().unwrap_or_default())?;
        if !Array::is_array(&boxes) { return Ok(Array::new()); }
        Ok(Array::from(&boxes).filter(&mut |item, _, _| ["width", "target", "height"].iter().all(|name| finite(&get(&item, name)))))
    };
    read().unwrap_or_else(|_| Array::new())
}

/// Private mode keeps the boxes for this session only.
fn save(storage: &JsValue, boxes: &Array) {
    let length = boxes.length();
    let kept = boxes.slice(length.saturating_sub(MAX_BOXES), length);
    if let Ok(text) = JSON::stringify(&kept) { let _ = method_opt(storage, "setItem", &[&KEY.into(), &text.into()]); }
}

/// `width`: the page width. `space`: the height the book could use with no overlays shown (the
/// mini player and the return bar added back). `free`: the height actually free now. Returns the
/// box height to apply. `storage` is where boxes persist (absent: nowhere) and `boxes` the ones to start from.
#[wasm_bindgen]
pub fn page_box_height(width: f64, space: f64, free: f64, storage: &JsValue, boxes: &JsValue) -> Result<f64, JsValue> {
    let width = crate::host::js_round(width);
    let boxes = if boxes.is_undefined() { load(storage) } else { Array::from(boxes) };
    let target = jmax(240.0, (space - MINI_PLAYER_RESERVE).floor());
    let found = boxes.iter().find(|item| (num(&get(item, "width")) - width).abs() <= 1.0 && (num(&get(item, "target")) - target).abs() <= PAGE_BOX_SLACK);
    let height = match found {
        None => {
            let item = Object::new();
            set(&item, "width", &width.into())?;
            set(&item, "target", &target.into())?;
            set(&item, "height", &target.into())?;
            boxes.push(&item);
            save(storage, &boxes);
            target
        }
        Some(item) => {
            if num(&get(&item, "height")) > target + 0.5 {
                set(&item, "height", &target.into())?;
                save(storage, &boxes);
            }
            num(&get(&item, "height"))
        }
    };
    // Audio and return controls occupy the existing header; their visibility
    // cannot resize the page. Only a smaller viewport can reduce this bound.
    Ok(jmax(1.0, jmin(height, free.floor())))
}
