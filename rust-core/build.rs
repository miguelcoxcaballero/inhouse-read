// Writes the voice catalogue of the app core (src/voice_catalogue.rs over src/supertonic_catalog.rs) as the JSON document
// the page reads at start-up, once, at build time: the core then serves fixed bytes instead of formatting ~30 KB of
// records on the phone while the app starts. The same source files are compiled into the core, which embeds the result.
#[allow(dead_code)]
#[path = "src/json.rs"]
mod json;
#[allow(dead_code)]
#[path = "src/supertonic_catalog.rs"]
mod supertonic_catalog;
#[allow(dead_code)]
#[path = "src/voice_catalogue.rs"]
mod voice_catalogue;

fn main() {
    for source in ["build.rs", "src/json.rs", "src/supertonic_catalog.rs", "src/voice_catalogue.rs"] { println!("cargo:rerun-if-changed={source}"); }
    let mut text = String::new();
    voice_catalogue::catalogue().write(&mut text);
    let out = std::path::Path::new(&std::env::var("OUT_DIR").expect("OUT_DIR")).join("voice_catalogue.json");
    std::fs::write(out, text).expect("voice catalogue");
}
