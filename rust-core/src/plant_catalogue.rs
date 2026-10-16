//! The plant, pot and lamp tables of the shelf: IKEA sizes, pot colours, the
//! catalogue entries, the dimensions of every plant in every pot, the catalogue
//! size labels and the lamp temperatures. The host receives one JSON document
//! (`plant_catalogue_json`) and keeps its own object shapes; every derived
//! figure is computed here with the same f64 operations the host tables used.
//! These tables live in the decor core so the bytes that decide the validity of
//! the saved plant and lamp bakes include them.
use crate::cabinet::{clearance, BAGGEBO, WALNUT};
use crate::jsnum;
use crate::json::{n, nums, obj, s, V};

// ---------------------------------------------------------------- IKEA sizes (cm)

struct PotRow {
    id: &'static str, nursery: f64, diameter: f64, height: f64, footprint: f64, confidence: &'static str,
    source: &'static str, note: Option<&'static str>,
}
struct PlantRow {
    id: &'static str, nursery: f64, height: f64, foliage_height: Option<f64>, width: f64, confidence: &'static str,
    source: &'static str, note: Option<&'static str>,
}

fn product(path: &str) -> String { format!("https://www.ikea.com/es/es/p/{}/", path) }

const POT_ROWS: [PotRow; 5] = [
    PotRow { id: "muskot9", nursery: 9.0, diameter: 12.0, height: 11.0, footprint: 12.0, confidence: "alta",
        source: "https://www.ikea.com.tr/en/product/muskot-white-9-cm-earthenware-plant-pot-30308201", note: None },
    PotRow { id: "muskot", nursery: 12.0, diameter: 15.0, height: 14.0, footprint: 15.0, confidence: "alta",
        source: "https://www.ikea.com.tr/en/product/muskot-white-12-cm-earthenware-plant-pot-50308196", note: None },
    PotRow { id: "muskotblomma", nursery: 12.0, diameter: 16.0, height: 13.0, footprint: 16.0, confidence: "alta",
        source: "muskotblomma-maceta-con-plato-interior-exterior-terracota-00454883", note: None },
    PotRow { id: "gradvis", nursery: 12.0, diameter: 13.0, height: 12.0, footprint: 13.0, confidence: "alta",
        source: "gradvis-macetero-rosa-60414078", note: None },
    PotRow { id: "akerbar", nursery: 12.0, diameter: 14.0, height: 12.0, footprint: 14.0, confidence: "baja",
        source: "akerbar-macetero-interior-exterior-galvanizado-50497696",
        note: Some("Referencia de 24 cm; variante de 12 cm y cotas exteriores pendientes de verificar.") },
];
const PLANT_ROWS: [PlantRow; 8] = [
    PlantRow { id: "sansevieria", nursery: 9.0, height: 25.0, foliage_height: None, width: 15.0, confidence: "baja",
        source: "sansevieria-planta-mezcla-especies-plantas-50597549",
        note: Some("La ficha es de 21 cm y no publica altura; variante compacta estimada.") },
    PlantRow { id: "monstera", nursery: 12.0, height: 35.0, foliage_height: None, width: 26.0, confidence: "alta",
        source: "monstera-deliciosa-planta-ceriman-50515493", note: None },
    PlantRow { id: "chamaedorea", nursery: 9.0, height: 20.0, foliage_height: None, width: 20.0, confidence: "alta",
        source: "chamaedorea-elegans-planta-palmera-salon-90392763", note: None },
    PlantRow { id: "nephrolepis", nursery: 9.0, height: 20.8, foliage_height: Some(10.0), width: 20.0, confidence: "media",
        source: "nephrolepis-planta-helecho-00630773",
        note: Some("Follaje publicado 10 cm; altura total estimada sumando la línea de tierra del recipiente elegido.") },
    PlantRow { id: "hedera", nursery: 9.0, height: 24.0, foliage_height: None, width: 18.0, confidence: "baja",
        source: "hedera-helix-planta-hiedra-66804047",
        note: Some("Ficha de 13 cm y 35 cm de altura; variante compacta estimada, no verificada.") },
    PlantRow { id: "zamioculcas", nursery: 9.0, height: 28.0, foliage_height: None, width: 17.0, confidence: "baja",
        source: "zamioculcas-planta-zamioculcas-50598681",
        note: Some("Ficha de 17 cm y 55 cm de altura; variante compacta estimada, no verificada.") },
    PlantRow { id: "succulent", nursery: 9.0, height: 20.7, foliage_height: Some(9.0), width: 14.0, confidence: "media",
        source: "succulent-planta-mezcla-especies-plantas-suculenta-10311006",
        note: Some("Follaje publicado 9 cm; altura total estimada sumando la línea de tierra del recipiente elegido.") },
    PlantRow { id: "cactus", nursery: 6.0, height: 18.0, foliage_height: None, width: 12.0, confidence: "media",
        source: "fejka-planta-artificial-interior-exterior-cactus-60587154",
        note: Some("Artículo publicado de 14 cm; envolvente con maceta decorativa estimada en 18 cm.") },
];
// The pot sources of the first two rows and the akerbar/gradvis/muskotblomma
// ones are products of the IKEA Spain site; the Turkish ones are full URLs.
fn source_url(path: &str) -> String { if path.starts_with("http") { path.to_string() } else { product(path) } }

/// The reference assembly of each species: changing the container moves its
/// soil line, it never rescales the leaves.
const REFERENCE_POTS: [(&str, &str); 8] = [("sansevieria", "muskot"), ("monstera", "gradvis"), ("chamaedorea", "muskot"),
    ("nephrolepis", "akerbar"), ("hedera", "muskotblomma"), ("zamioculcas", "gradvis"), ("succulent", "muskotblomma"),
    ("cactus", "akerbar")];
pub const POT_SOIL_FRACTION: f64 = 0.9;
/// Plants above this interior limit are fitted uniformly to their saved bay.
pub const PLANT_MAX_HEIGHT_MM: f64 = 300.0;

fn reference_pot(plant: &str) -> &'static str { REFERENCE_POTS.iter().find(|(id, _)| *id == plant).map(|(_, pot)| *pot).unwrap_or("muskot") }
fn default_pot(plant: &PlantRow) -> &'static str { if plant.nursery <= 9.0 { "muskot9" } else { reference_pot(plant.id) } }

#[derive(Clone, Copy)]
struct Pot { nursery: f64, diameter: f64, height: f64, footprint: f64, confidence: &'static str }
fn pot_mm(id: &str) -> Option<Pot> {
    POT_ROWS.iter().find(|row| row.id == id).map(|row| Pot { nursery: row.nursery, diameter: row.diameter * 10.0,
        height: row.height * 10.0, footprint: row.footprint * 10.0, confidence: row.confidence })
}

/// The standard class of a species: its largest IKEA class that fits under
/// the plant limit (the smallest one, flagged `fits: false`, if none does).
/// Each species has exactly one class today, its nursery size.
struct Standard { pot_class: f64, height: f64, width: f64, fits: bool }
fn standard_class(plant: &PlantRow) -> Standard {
    let (height, width) = (plant.height * 10.0, plant.width * 10.0);
    Standard { pot_class: plant.nursery, height, width, fits: height <= PLANT_MAX_HEIGHT_MM }
}

struct Dimensions { height: f64, foliage_height: f64, reference_height: f64, soil_height: f64, canopy: f64, width: f64,
    depth: f64, pot_diameter: f64, pot_height: f64, pot_footprint: f64, pot_class: f64, container_class: f64 }
/// Real dimensions (mm) of one plant standing in one pot; `None` pot = the
/// MUSKOT, the stand-in the host used for an unknown container.
fn dimensions_of(plant: &PlantRow, pot_id: Option<&str>) -> Dimensions {
    let standard = standard_class(plant);
    let pot = pot_id.and_then(pot_mm).unwrap_or_else(|| pot_mm("muskot").unwrap());
    let width = jsnum::max(standard.width, pot.footprint);
    let reference = pot_mm(reference_pot(plant.id)).unwrap();
    let reference_soil = reference.height * POT_SOIL_FRACTION;
    let foliage = match plant.foliage_height { Some(value) if value * 10.0 != 0.0 => value * 10.0, _ => standard.height - reference_soil };
    let soil = pot.height * POT_SOIL_FRACTION;
    Dimensions { height: soil + foliage, foliage_height: foliage, reference_height: standard.height, soil_height: soil,
        canopy: standard.width, width, depth: jsnum::max(width * 0.7, pot.footprint), pot_diameter: pot.diameter,
        pot_height: pot.height, pot_footprint: pot.footprint, pot_class: standard.pot_class, container_class: pot.nursery }
}
fn dimensions_json(d: &Dimensions) -> V {
    obj(vec![("height", n(d.height)), ("foliageHeight", n(d.foliage_height)), ("referenceHeight", n(d.reference_height)),
        ("soilHeight", n(d.soil_height)), ("canopy", n(d.canopy)), ("width", n(d.width)), ("depth", n(d.depth)),
        ("potDiameter", n(d.pot_diameter)), ("potHeight", n(d.pot_height)), ("potFootprint", n(d.pot_footprint)),
        ("potClass", n(d.pot_class)), ("containerClass", n(d.container_class))])
}

/// Catalogue label of a plant in a pot (`None` = an unknown container).
fn size_label(plant: &PlantRow, pot_id: Option<&str>) -> String {
    let size = dimensions_of(plant, pot_id);
    let cm = |value: f64| format!("{}", jsnum::round(value) / 10.0).replace('.', ",");
    let pot_confidence = pot_id.and_then(pot_mm).map(|pot| pot.confidence);
    let estimated = plant.confidence != "alta" || pot_confidence != Some("alta") || pot_id != Some(reference_pot(plant.id));
    let unverified = plant.confidence == "baja" || pot_confidence == Some("baja");
    let placement = if size.height > PLANT_MAX_HEIGHT_MM { " · se ajusta a la leja" } else { "" };
    format!("Maceta Ø{} × {} cm · planta {} cm{}{}{}", cm(size.pot_diameter), cm(size.pot_height), cm(size.height),
        if estimated { " aprox." } else { "" }, if unverified { " (sin verificar)" } else { "" }, placement)
}

/// A pot's published row; `scale` 10 turns the centimetre table into millimetres.
fn pot_fields(row: &PotRow, scale: f64) -> V {
    let mut fields = vec![("nursery", n(row.nursery)), ("diameter", n(row.diameter * scale)), ("height", n(row.height * scale)),
        ("footprint", n(row.footprint * scale)), ("confidence", s(row.confidence)), ("source", V::S(source_url(row.source)))];
    if let Some(note) = row.note { fields.push(("note", s(note))); }
    obj(fields)
}
fn plant_fields(row: &PlantRow) -> Vec<(&'static str, V)> {
    let mut fields = vec![("nursery", n(row.nursery)), ("height", n(row.height))];
    if let Some(foliage) = row.foliage_height { fields.push(("foliageHeight", n(foliage))); }
    fields.extend([("width", n(row.width)), ("widthConfidence", s("baja")), ("confidence", s(row.confidence)),
        ("source", V::S(source_url(row.source)))]);
    if let Some(note) = row.note { fields.push(("note", s(note))); }
    fields
}

fn ikea_json() -> V {
    obj(vec![("pots", obj(POT_ROWS.iter().map(|row| (row.id, pot_fields(row, 1.0))).collect())),
        ("plants", obj(PLANT_ROWS.iter().map(|row| (row.id, obj(plant_fields(row)))).collect()))])
}

// ---------------------------------------------------------------- catalogue entries

struct Reference { id: &'static str, name: &'static str, subtitle: &'static str, url: &'static str }
const PLANT_REFERENCES: [Reference; 8] = [
    Reference { id: "sansevieria", name: "SANSEVIERIA", subtitle: "Lengua de suegra", url: "sansevieria-planta-mezcla-especies-plantas-50597549" },
    Reference { id: "monstera", name: "MONSTERA DELICIOSA", subtitle: "Cerimán", url: "monstera-deliciosa-planta-ceriman-50515493" },
    Reference { id: "chamaedorea", name: "CHAMAEDOREA ELEGANS", subtitle: "Palmera de salón", url: "chamaedorea-elegans-planta-palmera-salon-90392763" },
    Reference { id: "nephrolepis", name: "NEPHROLEPIS", subtitle: "Helecho", url: "nephrolepis-planta-helecho-00630773" },
    Reference { id: "hedera", name: "HEDERA HELIX", subtitle: "Hiedra", url: "hedera-helix-planta-hiedra-66804047" },
    Reference { id: "zamioculcas", name: "ZAMIOCULCAS", subtitle: "Planta ZZ", url: "zamioculcas-planta-zamioculcas-50598681" },
    Reference { id: "succulent", name: "SUCCULENT", subtitle: "Suculenta", url: "succulent-planta-mezcla-especies-plantas-suculenta-10311006" },
    Reference { id: "cactus", name: "FEJKA", subtitle: "Cactus", url: "fejka-planta-artificial-interior-exterior-cactus-60587154" },
];
fn plant_row(id: &str) -> &'static PlantRow { PLANT_ROWS.iter().find(|row| row.id == id).unwrap() }

fn plant_catalog_json() -> V {
    V::A(PLANT_REFERENCES.iter().map(|reference| {
        let row = plant_row(reference.id);
        let pot = default_pot(row);
        let size = dimensions_of(row, Some(pot));
        obj(vec![("id", s(reference.id)), ("name", s(reference.name)), ("subtitle", s(reference.subtitle)),
            ("variant", s(reference.id)), ("defaultPotId", s(pot)), ("referenceUrl", V::S(product(reference.url))),
            ("width", n(size.width)), ("height", n(size.height)), ("canopy", n(size.canopy)),
            ("potClass", n(size.pot_class)), ("confidence", s(row.confidence))])
    }).collect())
}

struct PotReference { id: &'static str, model: Option<&'static str>, name: &'static str, subtitle: &'static str, url: &'static str }
const POT_REFERENCES: [PotReference; 5] = [
    PotReference { id: "muskot", model: None, name: "MUSKOT", subtitle: "Cerámica blanca",
        url: "https://www.ikea.com.tr/en/product/muskot-white-12-cm-earthenware-plant-pot-50308196" },
    PotReference { id: "muskotblomma", model: None, name: "MUSKOTBLOMMA", subtitle: "Terracota con plato",
        url: "https://www.ikea.com/es/es/p/muskotblomma-maceta-con-plato-interior-exterior-terracota-00454883/" },
    PotReference { id: "akerbar", model: None, name: "ÅKERBÄR", subtitle: "Acero galvanizado",
        url: "https://www.ikea.com/es/es/p/akerbar-macetero-interior-exterior-galvanizado-50497696/" },
    PotReference { id: "gradvis", model: None, name: "GRADVIS", subtitle: "Gres rosa",
        url: "https://www.ikea.com/es/es/p/gradvis-macetero-rosa-60414078/" },
    PotReference { id: "muskot9", model: Some("muskot"), name: "MUSKOT · compacta", subtitle: "Cerámica · interior 9 cm · exterior 12 cm",
        url: "https://www.ikea.com.tr/en/product/muskot-white-9-cm-earthenware-plant-pot-30308201" },
];
fn pot_catalog_json() -> V {
    V::A(POT_REFERENCES.iter().map(|reference| {
        let pot = pot_mm(reference.id).unwrap();
        let mut fields = vec![("id", s(reference.id))];
        if let Some(model) = reference.model { fields.push(("modelId", s(model))); }
        fields.extend([("name", s(reference.name)), ("subtitle", s(reference.subtitle)), ("referenceUrl", s(reference.url)),
            ("nurseryClass", n(pot.nursery)), ("diameter", n(pot.diameter)), ("height", n(pot.height)), ("footprint", n(pot.footprint))]);
        obj(fields)
    }).collect())
}

const POT_COLORS: [(&str, [(&str, &str, &str); 4]); 4] = [
    ("muskot", [("ivory", "Marfil", "#efece4"), ("sage", "Salvia", "#9ead98"), ("blue", "Azul porcelana", "#829dac"), ("charcoal", "Carbón", "#484a48")]),
    ("muskotblomma", [("terracotta", "Terracota", "#b36a48"), ("sand", "Arcilla arena", "#c6a17a"), ("red-clay", "Arcilla roja", "#944e37"), ("dark-clay", "Arcilla oscura", "#715448")]),
    ("akerbar", [("zinc", "Zinc", "#cfd3d5"), ("graphite", "Grafito", "#646b70"), ("copper", "Cobre", "#be896c"), ("bronze", "Bronce", "#a49466")]),
    ("gradvis", [("rose", "Rosa", "#dcb7b3"), ("cream", "Crema", "#d9ceb9"), ("seafoam", "Verde agua", "#97b1aa"), ("slate", "Azul pizarra", "#81949e")]),
];

/// Saved plants written by earlier versions name their species differently.
const LEGACY_PLANTS: [(&str, &str); 16] = [("upright", "sansevieria"), ("sansevieria", "sansevieria"), ("monstera", "monstera"),
    ("leafy", "hedera"), ("pothos", "hedera"), ("ivy", "hedera"), ("hedera", "hedera"), ("suculenta", "succulent"),
    ("succulent", "succulent"), ("cactus", "cactus"), ("palm", "chamaedorea"), ("chamaedorea", "chamaedorea"),
    ("fern", "nephrolepis"), ("nephrolepis", "nephrolepis"), ("zz", "zamioculcas"), ("zamioculcas", "zamioculcas")];

// ---------------------------------------------------------------- lamps

pub const LAMP_KELVINS: [f64; 4] = [1800.0, 2200.0, 2700.0, 4000.0];
pub const DEFAULT_LAMP_KELVIN: f64 = 2700.0;

fn lamp_catalog_json() -> V {
    let lamp = |id: &str, name: &str, title: &str, subtitle: &str, mount: &str, size: [f64; 3], light: &str, url: &str| obj(vec![
        ("id", s(id)), ("name", s(name)), ("title", s(title)), ("subtitle", s(subtitle)), ("mount", s(mount)),
        ("dimensions", obj(vec![("width", n(size[0])), ("height", n(size[1])), ("depth", n(size[2]))])),
        ("warmKelvin", n(2700.0)), ("light", s(light)), ("referenceUrl", s(url))]);
    V::A(vec![
        lamp("mittled", "MITTLED", "Foco bajo balda", "Aluminio", "undershelf", [68.0, 11.0, 68.0], "cone",
            "https://www.ikea.com/es/es/search/?q=MITTLED"),
        lamp("tarnaby", "TÄRNABY", "Farol retro", "Cristal y latón", "standing", [150.0, 250.0, 150.0], "filaments:4",
            "https://www.ikea.com/es/es/search/?q=T%C3%84RNABY"),
        lamp("tripod", "TRÍPODE", "Madera y lino", "Madera y lino", "standing", [180.0, 280.0, 180.0], "cone",
            "https://www.ikea.com/es/es/search/?q=LAUTERS"),
    ])
}

// ---------------------------------------------------------------- scale

/// A real book's spine thickness in mm: slim paperback, thick hardback, binding, per leaf.
const BOOK_THICKNESS_MM: [f64; 4] = [10.0, 84.0, 4.0, 0.07];
/// Without a measured width a 600 mm unit is assumed this many pixels wide.
const DEFAULT_SHELF_WIDTH: f64 = 390.0;

/// Scene pixels per millimetre for a shelf `width` px wide.
#[no_mangle]
pub extern "C" fn shelf_scale(width: f64) -> f64 {
    (if width > 0.0 { width } else { DEFAULT_SHELF_WIDTH }) / BAGGEBO.width
}

/// `spineStyleFor` options that draw real thicknesses at `scale` px/mm:
/// minimum and maximum width, binding thickness and page thickness.
/// # Safety
/// `out` points to four writable, 8-byte aligned f64 values.
#[no_mangle]
pub unsafe extern "C" fn book_spine_options(scale: f64, out: *mut f64) -> u32 {
    if out.is_null() || (out as usize) % 8 != 0 { return 0; }
    let out = std::slice::from_raw_parts_mut(out, 4);
    out[0] = BOOK_THICKNESS_MM[0] * scale; out[1] = BOOK_THICKNESS_MM[1] * scale;
    out[2] = BOOK_THICKNESS_MM[2] * scale; out[3] = BOOK_THICKNESS_MM[3] * scale;
    1
}

// ---------------------------------------------------------------- the document

fn plant_ids() -> Vec<&'static str> { PLANT_ROWS.iter().map(|row| row.id).collect() }

fn plant_catalogue() -> V {
    let pots_mm = POT_ROWS.iter().map(|row| (row.id, pot_fields(row, 10.0))).collect::<Vec<_>>();
    let plants_mm = PLANT_ROWS.iter().map(|row| {
        let mut fields = plant_fields(row);
        let standard = standard_class(row);
        fields.push(("classes", obj(vec![(&format!("{}", standard.pot_class),
            obj(vec![("height", n(standard.height)), ("width", n(standard.width))]))])));
        (row.id, obj(fields))
    }).collect::<Vec<_>>();
    let plant_dimensions = plant_ids().into_iter().map(|plant| {
        let row = plant_row(plant);
        let mut by_pot: Vec<(&str, V)> = POT_ROWS.iter().map(|pot| (pot.id, dimensions_json(&dimensions_of(row, Some(pot.id))))).collect();
        by_pot.push(("", dimensions_json(&dimensions_of(row, None))));
        (plant, obj(by_pot))
    }).collect::<Vec<_>>();
    let labels = plant_ids().into_iter().map(|plant| {
        let row = plant_row(plant);
        let mut by_pot: Vec<(&str, V)> = POT_ROWS.iter().map(|pot| (pot.id, V::S(size_label(row, Some(pot.id))))).collect();
        by_pot.push(("", V::S(size_label(row, None))));
        (plant, obj(by_pot))
    }).collect::<Vec<_>>();
    let standards = plant_ids().into_iter().map(|plant| {
        let standard = standard_class(plant_row(plant));
        (plant, obj(vec![("potClass", n(standard.pot_class)), ("height", n(standard.height)), ("width", n(standard.width)), ("fits", V::B(standard.fits))]))
    }).collect::<Vec<_>>();
    obj(vec![
        ("shelfClearance", obj(vec![("baggebo", n(clearance(&BAGGEBO))), ("walnut", n(clearance(&WALNUT)))])),
        ("ikea", ikea_json()),
        ("potSizes", obj(pots_mm)),
        ("plantSizes", obj(plants_mm)),
        ("referencePots", obj(REFERENCE_POTS.iter().map(|(plant, pot)| (*plant, s(pot))).collect())),
        ("defaultPots", obj(PLANT_ROWS.iter().map(|row| (row.id, s(default_pot(row)))).collect())),
        ("standardClasses", obj(standards)),
        ("dimensions", obj(plant_dimensions)),
        ("sizeLabels", obj(labels)),
        ("plantCatalog", plant_catalog_json()),
        ("potCatalog", pot_catalog_json()),
        ("potColors", obj(POT_COLORS.iter().map(|(pot, colors)| (*pot, V::A(colors.iter().map(|(id, name, hex)|
            obj(vec![("id", s(id)), ("name", s(name)), ("hex", s(hex))])).collect()))).collect())),
        ("legacyPlants", obj(LEGACY_PLANTS.iter().map(|(alias, plant)| (*alias, s(plant))).collect())),
        ("lampCatalog", lamp_catalog_json()),
        ("lampKelvins", nums(&LAMP_KELVINS)),
        ("constants", obj(vec![
            ("potDiameterMm", n(120.0)), ("potSoilFraction", n(POT_SOIL_FRACTION)), ("plantMaxHeightMm", n(PLANT_MAX_HEIGHT_MM)),
            ("bookReferenceMm", n(240.0)),
            ("bookThicknessMm", obj(vec![("min", n(BOOK_THICKNESS_MM[0])), ("max", n(BOOK_THICKNESS_MM[1])),
                ("binding", n(BOOK_THICKNESS_MM[2])), ("perPage", n(BOOK_THICKNESS_MM[3]))])),
            ("bookDepthMm", obj(vec![("min", n(130.0)), ("max", n(160.0))])),
            ("minimumLampTapSize", n(44.0)), ("defaultLampKelvin", n(DEFAULT_LAMP_KELVIN)), ("lampKelvinMs", n(300.0)),
            ("defaultShelfWidth", n(DEFAULT_SHELF_WIDTH)),
        ])),
    ])
}

/// Writes the plant tables as UTF-8 into `out` when `capacity` allows and
/// returns their length in bytes.
/// # Safety
/// `out` is null or points to `capacity` writable bytes.
#[no_mangle]
pub unsafe extern "C" fn plant_catalogue_json(out: *mut u8, capacity: usize) -> usize {
    crate::json::export(&plant_catalogue(), out, capacity)
}
