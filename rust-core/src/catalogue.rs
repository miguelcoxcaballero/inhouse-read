//! The shelf's static tables that the app core owns: the spine palette and
//! finishes, the two cabinets and the defaults of the layout. The host
//! receives one JSON document (`catalogue_json`) and keeps its own object
//! shapes. The plant, pot and lamp tables live in the decor core
//! (plant_catalogue.rs), whose bytes decide the validity of saved bakes.
use crate::cabinet::{BAGGEBO, SHELF_HEIGHTS_FROM_FLOOR, USABLE_DEPTH, WALNUT};
use crate::json::{n, nums, obj, s, V};

const SPINE_PALETTE: [(&str, &str, &str, &str); 12] = [
    ("burdeos", "#7A2E38", "#5B1F28", "#F2E6D8"),
    ("verde-botella", "#2F5D4A", "#204237", "#EDE7D6"),
    ("azul-noche", "#2B3F63", "#1E2C48", "#E8E8EF"),
    ("ocre", "#B8862F", "#8E6520", "#2A1F0C"),
    ("terracota", "#A9542F", "#833C20", "#F6E7DC"),
    ("ciruela", "#5A3555", "#402440", "#EEE2EE"),
    ("oliva", "#6B7A45", "#4E5B31", "#F3F1E2"),
    ("arena", "#D6C3A0", "#B9A279", "#3B3022"),
    ("pizarra", "#46515A", "#323A41", "#E5EAEE"),
    ("oxido", "#8C4A2F", "#6A3520", "#F4E3D6"),
    ("crema", "#EDE4D3", "#D3C6AE", "#3A3328"),
    ("tinta", "#2A2A2E", "#19191C", "#E0DCD2"),
];
/// Finishes change only the decoration of a spine, never its geometry.
const SPINE_TEXTURES: [&str; 4] = ["plain", "bands", "panel", "ribbed"];
pub const PALETTE_COUNT: usize = SPINE_PALETTE.len();
pub const TEXTURE_COUNT: usize = SPINE_TEXTURES.len();

fn cabinet_dimensions() -> V { obj(vec![("width", n(BAGGEBO.width)), ("depth", n(BAGGEBO.depth)), ("height", n(BAGGEBO.height))]) }

fn baggebo_spec() -> V {
    obj(vec![
        ("articleNumber", s("504.811.72")),
        ("width", n(BAGGEBO.width)), ("depth", n(BAGGEBO.depth)), ("height", n(BAGGEBO.height)),
        ("dimensions", cabinet_dimensions()),
        ("material", s("Acero con revestimiento de resina epoxi/poliéster en polvo")),
        ("footMaterial", s("Polipropileno")),
        ("color", s("Blanco")),
        ("maxShelfLoadKg", n(12.0)),
        ("postSize", n(BAGGEBO.post_size)),
        ("postProfile", obj(vec![("shape", s("rounded-right-triangle")), ("outerCornerRadius", n(1.2)), ("tipRadius", n(0.8))])),
        ("footRadius", n(5.6)),
        ("innerWidth", n(564.0)),
        ("usableDepth", n(USABLE_DEPTH)),
        ("ceilingOffset", n(3.75)),
        ("shelfRimHeight", n(BAGGEBO.shelf_rim_height)),
        ("shelfBottoms", nums(&BAGGEBO.shelf_bottoms)),
        ("shelfHeightsFromFloor", nums(&SHELF_HEIGHTS_FROM_FLOOR)),
        ("topMesh", V::B(true)),
        ("meshSurfaceCount", n(4.0)),
        ("rearBrace", obj(vec![("width", n(216.0)), ("height", n(320.0)), ("top", n(376.51)), ("bottom", n(696.51))])),
        ("meshPitch", obj(vec![("width", n(13.2)), ("height", n(7.2))])),
        ("provenance", obj(vec![
            ("dimensions", s("Medidas publicadas por IKEA: 60 × 25 × 116 cm.")),
            ("structure", s("Manual AA-2235400-4, páginas 6–9: cuatro montantes, tres baldas interiores, superficie superior de malla, refuerzo trasero y tacos regulables.")),
            ("shelfPositions", s("Geometría oficial IKEA: superficies a 155, 477.49, 799.99 y 1159.99 mm desde el suelo; redondeadas a 155, 477.5, 800 y 1160 mm.")),
            ("rearBrace", s("Geometría oficial IKEA: 216 × 320 mm, entre 463.49 y 783.49 mm desde el suelo.")),
            ("postProfile", s("Cortes de la geometría oficial: cuatro perfiles triangulares rectángulos de unos 18 × 18 mm, con la hipotenusa orientada hacia las baldas; tacos de unos 11.4 mm de diámetro.")),
            ("shelfCorners", s("La geometría y el manual muestran esquinas de balda achaflanadas a 45° que se acoplan a la cara diagonal de los montantes.")),
            ("smallDetails", s("Perfiles de 18 mm y bordes de 16.5 mm medidos en el modelo oficial. Paso de malla, radios, pintura y detalles de tornillos aproximados a partir de las fotos y el manual. Las cotas de 600 × 250 × 1160 mm corresponden al cuerpo: los herrajes de fijación a la pared aumentan la caja del modelo de visualización.")),
        ])),
        ("sources", obj(vec![
            ("product", s("https://www.ikea.com/es/es/p/baggebo-estanteria-metal-blanco-50481172/")),
            ("assembly", s("https://www.ikea.com/es/es/assembly_instructions/baggebo-estanteria-metal-blanco__AA-2235400-4-2.pdf")),
            ("detailPhoto", s("https://www.ikea.com/es/es/images/products/baggebo-estanteria-metal-blanco__0981564_pe815397_s5.jpg")),
            ("geometry", s("https://web-api.ikea.com/dimma/assets/1.2/50481172/PS01_S01_NV01/iqp3/glb/9b8fe0cb424d4ed3b7812cbffd83695f-50481172_PS01_S01_NV01_IQP3_2.0.glb?cn=pip")),
        ])),
    ])
}

fn walnut_spec() -> V {
    obj(vec![
        ("width", n(WALNUT.width)), ("depth", n(WALNUT.depth)), ("height", n(WALNUT.height)),
        ("dimensions", cabinet_dimensions()),
        ("shelfBottoms", nums(&WALNUT.shelf_bottoms)),
        ("shelfHeightsFromFloor", nums(&SHELF_HEIGHTS_FROM_FLOOR)),
        ("postSize", n(WALNUT.post_size)),
        ("shelfRimHeight", n(WALNUT.shelf_rim_height)),
        ("usableDepth", n(USABLE_DEPTH)),
        // Solid timber boards: the underside of a shelf is 23 mm below its top.
        ("ceilingOffset", n(23.0)),
    ])
}

fn catalogue() -> V {
    obj(vec![
        ("spinePalette", V::A(SPINE_PALETTE.iter().map(|(name, base, shade, ink)|
            obj(vec![("name", s(name)), ("base", s(base)), ("shade", s(shade)), ("ink", s(ink))])).collect())),
        ("spineTextures", V::A(SPINE_TEXTURES.iter().map(|texture| s(texture)).collect())),
        ("baggebo", baggebo_spec()),
        ("walnut", walnut_spec()),
        ("shelfTypes", V::A(vec![
            obj(vec![("id", s("walnut")), ("name", s("Madera")), ("subtitle", s("Nogal")), ("dimensions", cabinet_dimensions())]),
            obj(vec![("id", s("baggebo")), ("name", s("BAGGEBO")), ("subtitle", s("Metal blanco")), ("dimensions", cabinet_dimensions())]),
        ])),
        ("defaults", obj(vec![
            ("spine", obj(vec![("minWidth", n(28.0)), ("maxWidth", n(54.0)), ("minHeightRatio", n(0.80)), ("maxHeightRatio", n(1.0)), ("jitter", n(2.5))])),
            // A pot every five books: with 6-7 spines on a phone shelf that leaves nearly one per shelf.
            ("layout", obj(vec![("shelfWidth", n(360.0)), ("padding", n(16.0)), ("gap", n(3.0)), ("plantEvery", n(5.0)),
                ("plantWidth", n(58.0)), ("maxTailPlants", n(2.0)),
                ("plantVariants", V::A(["monstera", "sansevieria", "pothos", "cactus", "suculenta"].iter().map(|name| s(name)).collect())),
                ("tiltThreshold", n(16.0)), ("maxTilt", n(8.0))])),
            ("sections", obj(vec![("recentLimit", n(6.0)), ("recentTitle", s("Seguir leyendo")), ("libraryTitle", s("Biblioteca")), ("sort", s("author"))])),
            ("bookmark", obj(vec![("minPeek", n(5.0)), ("maxPeek", n(20.0))])),
        ])),
    ])
}

/// Writes the tables as UTF-8 into `out` when `capacity` allows and returns
/// their length in bytes.
/// # Safety
/// `out` is null or points to `capacity` writable bytes.
#[no_mangle]
pub unsafe extern "C" fn catalogue_json(out: *mut u8, capacity: usize) -> usize {
    crate::json::export(&catalogue(), out, capacity)
}
