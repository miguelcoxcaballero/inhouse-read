//! The shelf screen: its flyout editor today, the rest of the screen as it moves here. Everything that
//! decides, sequences or draws is Rust; the host keeps what only the browser can do (three.js, storage,
//! the book model, the scene) and calls these parts through plain objects. src/js/bookshelf.js keeps the
//! public `renderBookshelf` handle; its design notes moved here with the code they describe:
//!
//! bookshelf.js — home screen de Inhouse Read: una estantería con plantas.
//! =============================================================================
//!
//! QUÉ ES
//! -----------------------------------------------------------------------------
//! El home no es una cuadrícula de tarjetas: es una estantería ilustrada donde
//! la biblioteca se ve *de canto*, como libros de verdad. Al tocar un lomo, el
//! libro sale de la balda y gira sobre su eje vertical para enseñar la portada,
//! y sólo entonces se avisa a la app para que abra el lector.
//!
//! DECISIONES DE DISEÑO
//! -----------------------------------------------------------------------------
//! 1. Color de acento. NO se inventa uno: se usa el que ya fija
//!    `src/css/tokens.css` para este producto, `--accent-read: #2f6b4f` (verde
//!    bosque) con `--wood: #8b5e3c`. Encaja con la metáfora (madera + plantas),
//!    se distingue del naranja de Notes (#E07A3C) y del resto de hermanas, y
//!    sobre crema da contraste AA (~5.2:1). En modo oscuro ese verde pleno se
//!    queda corto sobre #151515, así que `bookshelf.css` define además
//!    `--ihr-accent-legible`, que en oscuro sube a un verde claro (#8FBF9E) y
//!    se usa SÓLO para texto e iconos, nunca para superficies.
//!
//! 2. Madera y baldas. Mueble completo en una escena 3D, con textura de nogal
//!    de src/assets/library. Una transformación común gira y aleja el conjunto.
//!
//! 3. Los lomos conservan geometría y acabado deterministas. El color y la
//!    familia tipográfica se ajustan a la portada rasterizada: se muestrea su
//!    tono dominante y se compara el título visible con varias familias
//!    tipográficas disponibles en la app. Sin portada legible,
//!    se conserva el aspecto de reserva. Con `pageCount`/`sizeBytes` el grosor
//!    es real, no inventado.
//!
//! 4. Plantas. Macetas y hojas con volumen dentro de la misma escena.
//!    Las plantas de instalaciones antiguas se migran al catálogo actual.
//!
//! 5. Modelo propio en book-model.js: malla elíptica continua, tapas y hojas.
//!    Three.js dibuja la misma geometría en la balda y durante el giro.
//!    La textura del título sigue los UV del lomo. La apertura añade 10° de
//!    inclinación para mostrar su sección superior y el volumen de la encuadernación.
//!
//! 6. Un contexto WebGL compartido dibuja la estantería y la inserción del libro.
//!    El libro extraído utiliza su renderizador dedicado durante el giro y la apertura.
//!    Sólo se redibuja al cambiar algo o durante una animación. Los libros
//!    alejados del área visible liberan sus modelos; los botones DOM mantienen
//!    foco y accesibilidad en las posiciones proyectadas de los libros.
//!
//! 7. Táctil. Activación por `click` (funciona con teclado y lector de
//!    pantalla), feedback de presión en `pointerdown` para ver qué lomo se va
//!    a abrir antes de soltar, y cancelación si el dedo se desplaza más de
//!    12px: en una estantería los lomos son estrechos y están pegados, y sin
//!    esto cada scroll abriría un libro. Ancho mínimo de lomo 28px (26px en
//!    pantallas < 360px) con zona de acierto extra a cada lado.
//!
//! 8. El giro inicial termina en una portada interactiva. Un toque en ella
//!    abre la portada y acerca la página guardada hasta el lector. Este se
//!    prepara detrás de la cubierta; los controles aparecen tras el traspaso.
//!
//! 9. Marcapáginas. Cada libro empezado lleva una cinta de raso que asoma por
//!    arriba del lomo. La cinta 3D ocupa entre el 9 y el 17 % de la altura del
//!    libro y comparte proporciones en la balda y al sacarlo. El respaldo DOM
//!    vive dentro del botón sin recortar su parte superior. La balda reserva
//!    `--ihr-bookmark-room` para dejar espacio al tejido y su curvatura.
//!
//! La geometría vive en `book-model.js`; la distribución, en `bookshelf-layout.js`. No sabe
//! nada de PDF.js, foliate, Drive ni IndexedDB: recibe libros y avisa cuando
//! hay que abrir uno.
mod util;
mod ctx;
mod style;
mod editor;
mod editor_edit;
mod editor_relief;
mod editor_pick;
mod pieces;
mod flyout;
mod flyout_motion;
mod returning;
mod covers;
mod objects;
mod drag;
mod trash;
mod screen_plan;
mod screen_render;
mod screen_nodes;
mod screen_lifecycle;
mod text_length;
mod text_length_queue;
mod screen_prefs;
mod frame;
mod mount;
pub use ctx::RustShelfCtx;
