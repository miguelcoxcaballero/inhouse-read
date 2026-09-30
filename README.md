# inhouse read

Lector de PDF, EPUB y MOBI. Hermano de [inhouse notes](https://github.com/miguelcoxcaballero/inhousenotes): misma paleta, misma tipografía (Comfortaa + DM Sans), mismo patrón de despliegue a GitHub Pages.

La biblioteca es una estantería 3D con madera texturizada, libros y plantas con volumen. Al tocar un libro, sale de la balda y gira hasta enseñar la portada antes de abrirse.

### Actualización web · 1.6.12

- Al salir del lector, la página actual se aleja en el modelo 3D, recibe el marcapáginas, se cierra la portada y el libro vuelve a su hueco mediante la escena de la estantería. La página y la portada permanecen visibles durante el cambio entre lector y modelo.
- La apertura retira primero el marcapáginas de la página guardada y después acerca la página al lector. El cierre conserva la posición actual, incluida la primera página y la primera salida tras importar un libro.
- La secuencia admite PDF, EPUB, movimiento reducido y cancelación al girar el móvil, con una alternativa para dispositivos sin WebGL.

### Actualización web · 1.6.11

- El toque largo sobre macetas y hojas no activa la selección de texto ni el menú nativo del móvil. Los objetos de la estantería conservan su arrastre 3D.
- La protección se limita a la estantería: el texto del lector y los campos de edición siguen siendo seleccionables.

### Actualización web · 1.6.10

- Suelo físico invisible: la papelera sigue apoyada junto a la base del mueble sin mostrar una plataforma de madera.
- Papelera con mayor diámetro y altura, conservando su posición real durante el giro de cámara y la animación de retirada.
- Vista isométrica encuadrada por ancho y altura para mostrar toda la estantería sin scroll. La vista frontal conserva el desplazamiento por baldas.
- Los libros pequeños en el encuadre general usan menos geometría y texturas, conservando su volumen y lomo curvo; recuperan el detalle al sacarlos.
- Actualización web compatible con la APK actual; no requiere reinstalar Android.

### Actualización web · 1.6.9

- Las plantas antiguas se convierten al catálogo 3D conservando sus posiciones, tamaños y macetas elegidas.
- Eliminadas las fotos planas y el atlas fotográfico antiguo del renderizado de plantas. Las hojas usan geometría con volumen y texturas procedimentales opacas.
- La migración se guarda al abrir la biblioteca y respeta las plantas retiradas; no repone decoraciones eliminadas.

### Actualización web · 1.6.8

- Corregido el arrastre táctil de plantas cogidas por las hojas: el gesto permanece activo al mover el dedo y al bajar por las baldas hasta la papelera.
- La papelera comprueba su posición actual al soltar, incluso si el último cambio de scroll todavía no se ha dibujado.
- Pruebas con gestos táctiles reales desde el follaje hasta el suelo, además de la retirada y persistencia de plantas.

### Actualización web · 1.6.7

- Papelera apoyada en el suelo junto a la base de la estantería, con posición y tamaño fijos dentro de la escena 3D.
- La papelera entra y sale del encuadre con el giro de la vista; desaparece el efecto de aparición por aumento de escala.
- En bibliotecas largas, la papelera permanece en el suelo al pie del mueble y se alcanza bajando por las baldas.
- Corregido el scroll fuera del mueble al mantener un libro arrastrado en el borde inferior de la pantalla.

### Actualización web · 1.6.6

- Las baldas recuperan todo el ancho disponible, sin reservar una franja permanente para la papelera.
- La papelera aparece sólo en la vista isométrica, junto al mueble girado, y sigue accesible al desplazarse por una estantería larga.
- El cambio de vista conserva la colocación de libros y plantas, el catálogo lateral y las animaciones 3D de retirada.

### Actualización web · 1.6.5

- Ocho plantas modeladas a partir de referencias de IKEA: SANSEVIERIA, MONSTERA DELICIOSA, CHAMAEDOREA ELEGANS, NEPHROLEPIS, HEDERA HELIX, ZAMIOCULCAS, SUCCULENT y FEJKA. Hojas curvas, tallos, nervaduras y detalles propios de cada especie.
- Cuatro macetas intercambiables: MUSKOT, MUSKOTBLOMMA con plato, ÅKERBÄR galvanizada y GRADVIS. Cerámica, terracota y metal comparten la iluminación de la estantería.
- Un pequeño catálogo 3D está sujeto al lateral derecho del mueble y aparece en vista isométrica. Ábrelo para elegir una planta y una maceta en un manual ilustrado con estética IKEA.
- Mantén pulsada una planta y arrástrala hasta la papelera para retirarla con la misma animación 3D que los libros. Las plantas elegidas, las macetas y sus posiciones se guardan en ese dispositivo; una colección vacía permanece vacía al reiniciar.
- Modelos limitados en geometría y dibujados bajo demanda dentro de la escena compartida. Actualización web compatible con la APK actual; no requiere reinstalar Android.

### Actualización web · 1.6.4

- Lector con cabecera y barra inferior de 48 px, controles táctiles de 44 px y progreso compacto. El modo de pantalla completa oculta ambas barras y se desactiva tocando el centro de la página.
- EPUB aprovecha la altura disponible con márgenes verticales de 12 px. PDF se adapta al ancho real, incluso en móviles estrechos; sus modos de texto y original se reajustan al girar o mostrar controles.
- Tema AMOLED con fondo negro puro y texto gris claro (#c6c6c6), guardado entre sesiones y aplicado al documento y sus controles.
- Paneles ajustados al espacio visible en horizontal y sobre el teclado. El reproductor de voz y el acceso para volver a la posición anterior reservan su altura real sin tapar el texto.
- El visor de cómics y páginas fijas espera a que termine de cargar la nueva página antes de recalcular su tamaño, evitando errores durante los cambios de capítulo o de espacio disponible.
- Actualización web compatible con la APK actual; no requiere reinstalar Android.

### Actualización web · 1.6.3

- Papelera 3D a la derecha del mueble, accesible con scroll y en vista isométrica. Mantén pulsado un libro y arrástralo hasta ella: abre la tapa, recibe el libro y se cierra.
- Retirar un libro elimina el registro, el archivo guardado y la portada de la app. El original de Drive o del dispositivo se conserva; la sincronización automática respeta la retirada.
- Puedes volver a añadirlo desde el selector de archivos o la lista de Drive; al recuperarlo de Drive se carga su página guardada y la personalización antes de abrirlo. En teclado, Supr sobre un libro realiza la misma retirada.
- Actualización web compatible con la APK actual; no requiere reinstalar Android.

### Actualización web · 1.6.2

- Marcapáginas de tela con volumen, más ancho y alto, y las mismas proporciones en la balda y al sacar el libro. Se retira hacia arriba al acercar la página.
- Apertura con bisagra en el borde de la portada. La página que aparece en el modelo es la última página PDF o el texto visible del CFI guardado en EPUB, con los ajustes del lector aplicados.
- El zoom utiliza esa misma página 3D hasta alinearla con el lector; los controles aparecen después. Se reserva su espacio para evitar que EPUB cambie de página al mostrarlos.
- Actualización web compatible con la APK actual; no requiere reinstalar Android.

### Actualización web · 1.6.1

- Plantas con hojas curvas texturizadas, tallos, nervaduras y macetas torneadas; modelos distintos por especie. Atlas botánico propio de alta resolución, con transparencia conservada y optimizado en WebP.
- Estantería con cantos biselados, frentes perfilados, paneles y juntas reales, vetas a escala física y relieve fino de la madera. Sombras suaves de los objetos sobre las baldas mediante una luz compartida y limitada al área visible.
- Renderizado bajo demanda y un solo mapa de sombras de 1024 px; la escena deja de renderizar cuando termina el movimiento.

### Actualización web · 1.6.0

- Mantén pulsado cualquier libro o planta para sacarlo y colocarlo en otro punto o balda. Se conservan los huecos que dejes; los vecinos se apartan durante el arrastre y el objeto se inserta en 3D al soltar, también en vista isométrica.
- La posición de los libros se guarda con su estado y se sincroniza con Drive. La posición de las plantas se conserva en ese dispositivo. En teclado, Mayús y las flechas mueven el objeto horizontalmente o entre baldas.
- Las actualizaciones de biblioteca, portadas y fuentes esperan a que termine el arrastre. La devolución del libro utiliza la profundidad de la estantería para que los vecinos lo oculten correctamente durante la inserción.

### Actualización web · 1.1.3

- Acabados dorado y plata rehechos como foil satinado: bandas de reflejo amplias y suaves, gradación metálica controlada y menos brillo duro. El material y la luz siguen siendo los mismos en la balda, el editor y las animaciones.
- Ajustes del metal aplicados también a los remates curvos del lomo; la vista de prueba cubre letras y encuadernación en ambos acabados.
- Actualización web compatible con la APK 1.1.0; no requiere reinstalar Android.

### Actualización web · 1.1.2

- Interfaz del lector reorganizada en tres accesos directos: Texto, Contenido y Audio. Cada uno abre una hoja sencilla; las tarjetas y formularios anidados se sustituyen por filas, listas y controles sin fondos añadidos.
- Tipografía con botones A−/A+, temas en muestras circulares y espaciado avanzado desplegable. Cabecera con el título del libro y controles que siguen los colores del papel, también en Noche.
- Navegación por página/progreso, índice, marcadores y posiciones recientes. El marcador de la página actual se añade o quita con un toque.
- Reproductor de voz compacto al cerrar sus ajustes, con pausa, continuación y parada junto al libro. El campo de navegación se mantiene sobre el teclado móvil.
- Disponible también en la APK 1.1.0 al cargar la web actualizada; no requiere reinstalación.

### Actualización web · 1.1.1

- Letras del lomo a 2048 px, filtrado anisotrópico y vistas de alta densidad. Su proporción depende del grosor del libro; los títulos largos reducen su tamaño o terminan en puntos suspensivos, sin aplastar las letras.
- Editor en una sola hoja, con color independiente para el lomo y las letras, contraste automático y acabados dorado y plata. Materiales PBR con un entorno de reflexión compartido por estantería, edición y animaciones.
- Interruptor de texto grabado: geometría hundida y mapa de relieve fino sobre el lomo curvo. Las actualizaciones se agrupan mientras se escribe para evitar reconstrucciones por cada pulsación.
- Tres propuestas cromáticas distintas inspiradas en la portada; las portadas neutras incluyen una alternativa cálida y otra verde. Los colores, acabados, grabado y tipografía se sincronizan junto al estado del libro en Drive.
- Actualización web compatible con la APK 1.1.0; no requiere reinstalar Android.

### Actualización web y Android · 1.1.0

- Madera de nogal texturizada, profundidad y sombras de contacto; plantas fotográficas propias en cerámica y terracota. Recursos optimizados en `src/assets/library/`, con los prompts de creación en `docs/library-assets.json` y `docs/succulent-asset.txt`.
- Lector con temas Papel, Sepia, Noche y Salvia; fuentes, tamaño, interlineado, márgenes, alineación y desplazamiento continuo para EPUB. Los PDF añaden zoom y un modo de texto adaptable para personalizar su texto extraíble.
- Navegación por porcentaje, página PDF e índice de capítulos. Los marcadores, la última página y las posiciones anteriores a un salto se guardan en el dispositivo y se sincronizan con el progreso en Drive. El botón «Volver a…» recupera el punto anterior incluso después de cerrar el libro.
- Lectura en voz alta con pausa, continuación, selección de voz, velocidad y temporizador; avance automático entre páginas. En Android 1.1.0 se utiliza TextToSpeech del sistema y en navegadores compatibles, Web Speech. Los documentos escaneados sin texto necesitan OCR; la función no genera ni descarga archivos de audiolibro. La disponibilidad de voces offline depende de las voces instaladas.

### Actualización web · 1.0.27

- El editor del lomo permanece abierto al aparecer o desaparecer el teclado del móvil y desplaza el campo activo para que puedas ver lo que escribes.

### Actualización web · 1.0.26

- El modelo conserva el mismo brillo al salir de la estantería, también con el tema oscuro.
- El editor sitúa el lomo en el centro del espacio disponible y usa una hoja inferior más sobria, con los controles y colores integrados en el estilo de la app.

### Actualización web · 1.0.25

- Al editar un libro en el móvil, el editor gira y muestra el lomo curvo en 3D, y actualiza su textura ligera sin reconstruir el modelo entero al tocar cada control.
- El modelo completo y el lomo de la estantería solo se actualizan al terminar de editar; la portada queda fuera de la vista mientras se personaliza el lomo.

### Actualización web · 1.0.24

- El botón «Editar» de cada libro reúne el color, la familia y el tamaño de letra y el texto del lomo; los cambios se conservan al volver a abrir la app.
- «Organizar» activa el arrastre de libros o el reordenado con flechas. La estantería anima cada movimiento en 3D y guarda el orden para próximas visitas.

### Actualización web · 1.0.23

- Antes de leer un libro puedes elegir el color del lomo entre tres tonos de su portada o definir uno propio; la elección queda guardada para las siguientes visitas.

### Actualización web · 1.0.22

- Los títulos importados desde archivos y Drive sustituyen guiones bajos, recuperan mayúsculas legibles, eliminan extensiones y colas truncadas, y conservan el título principal cuando hay subtítulos largos.

### Actualización web · 1.0.21

- La estantería guarda en IndexedDB el análisis de color, tipografía y proporción de cada portada. En un inicio en frío, prepara los lomos antes de mostrarlos para evitar que cambien de aspecto después de abrir la app.

### Actualización web · 1.0.20

- La portada del modelo 3D adopta la proporción real de su imagen, también en la estantería, la animación de apertura y el regreso al hueco. La imagen y la tipografía de la cubierta conservan sus proporciones.

### Actualización web · 1.0.19

- Cada lomo toma el color dominante de la portada, ajusta automáticamente el contraste y reutiliza ese acabado en el modelo 3D y la animación de apertura.
- Si la portada es una imagen, compara los trazos del título con las familias tipográficas de la app y elige la más parecida; si no puede leerlo, ajusta la elección al aspecto general de la portada.

### Actualización web · 1.0.18

- La importación en Android espera a que Google Drive confirme la subida y muestra una pantalla de carga con el nombre del libro; si hace falta, abre el acceso a Google antes de subirlo.
- Al terminar la subida, el libro queda vinculado a Drive y aparece en la estantería al volver desde el lector.

### Actualización web · 1.0.17

- Al volver del lector, el modelo 3D empieza en el primer fotograma de la estantería. Las actualizaciones de biblioteca completadas mientras el home está oculto conservan el lomo como destino hasta que termina el regreso.

### Actualización web · 1.0.16

- Baldas de roble con veta fina, sombras de apoyo, macetas de cerámica y recuentos de libros.
- Modelo compartido entre balda y portada: lomo elíptico continuo, tapas biseladas, bisagras de tela y cantos de papel estratificados.
- Giro sin rebotes, zoom de portada y aparición del lector ya preparado debajo de la transición. La portada sigue esperando un segundo toque para abrir el documento.
- Botones, radios, iconos y colores de superficie acordes con Notes; modo oscuro, teclado, movimiento reducido y composición horizontal en móviles.
- Regreso animado desde el lector hasta el hueco original, incluso si la balda se redibuja durante el cierre. Las portadas PDF se generan a mayor resolución, las texturas 3D usan el doble de píxeles y las miniaturas antiguas se regeneran al volver a abrir el libro.
- Drive sincroniza libros y posiciones de lectura al iniciar sesión, al volver a abrir la app y al recuperar la conexión. Los avances se guardan en una carpeta de estado de Inhouse Read y se conservan si llega una subida anterior más tarde.
- Los libros antiguos que aún tengan copia en la carpeta local autorizada se recuperan automáticamente antes de subirlos a Drive.

Esta actualización se entrega desde la web al abrir la app Android. La APK sigue siendo la **1.0.14**, con su cargador remoto; no se modifica el manifiesto Android para anunciar una APK inexistente.

## Formatos soportados — con honestidad

| Formato | Motor | Estado |
|---|---|---|
| PDF | [PDF.js](https://github.com/mozilla/pdf.js) (`pdfjs-dist`) | Sólido. Render por página a canvas, texto seleccionable, zoom. |
| EPUB | [foliate-js](https://github.com/johnfactotum/foliate-js) | Sólido. Paginación vía columnas CSS nativas. |
| MOBI / AZW3 | foliate-js (parser interno) | **Funcional para archivos sin DRM, no "production-grade" al nivel de PDF/EPUB.** foliate-js es la única librería JS mantenida con soporte MOBI client-side puro en 2026; su propio autor advierte que la API es inestable y que el rendimiento en KF8 comprimido (HUFF/CDIC) puede ser pobre. Pruébalo con tus propios archivos antes de confiar en él para una biblioteca grande. |
| MOBI/AZW con DRM de Amazon | — | **No soportado, y no lo estará.** Es una limitación criptográfica de Amazon (claves ligadas al dispositivo/cuenta), no algo que un lector cliente pueda resolver sin infringir el DRM. Usa un archivo DRM-free (exportado por ti mismo o convertido con Calibre). |
| FB2, CBZ | foliate-js | Funcional, soporte de bonus vía el mismo motor que EPUB/MOBI. |

## Arquitectura

HTML/CSS/JS vanilla (ES modules) + [Vite](https://vitejs.dev) solo como bundler/dev-server — sin framework de UI, siguiendo el mismo criterio que inhouse notes. Sin backend propio: todo corre en el navegador.

```
src/
  css/            tokens.css (paleta/tipografía heredadas de Inhouse), base.css, app.css, bookshelf.css
  js/
    app.js                    orquestación: pantallas, biblioteca, Drive
    format-detect.js          detección de formato por firma de bytes + extensión
    library-store.js          recientes/progreso en IndexedDB
    drive-client.js           Google Drive (OAuth vía Google Identity Services + Drive API v3)
    gestures.js               swipe/tap/doble-tap compartido por los lectores
    bookshelf.js              home screen: estantería animada (ver HANDOFF-BOOKSHELF.md)
    bookshelf-layout.js        empaquetado determinista de lomos/plantas en baldas
    plants.js                 ilustraciones SVG de las plantas
    readers/
      pdf-reader.js            wrapper de PDF.js
      foliate-reader.js        wrapper de foliate-js (EPUB/MOBI/AZW3/FB2/CBZ)
      reader-controller.js     enruta al motor correcto según el formato
demo/bookshelf.html           banco de pruebas aislado del home screen (npm run dev)
tests/unit/                   Vitest — parsing de formatos, estado de biblioteca, layout
tests/e2e/                    Playwright — flujo real: abrir un PDF, navegar, volver
android/                      wrapper WebView (ver sección Android)
.github/workflows/            CI (tests) + deploy a GitHub Pages
```

## Desarrollo local

```bash
npm install
npm run dev          # http://localhost:5173
npm run build        # genera dist/
npm run preview      # sirve dist/ para probar el build de producción
```

## Tests

```bash
npm run test:unit    # Vitest — rápidos, sin navegador real
npm run test:e2e     # Playwright — build de producción + Chromium real
npm test             # ambos
```

## Carpeta local persistente

Los bytes de los libros importados se guardan en IndexedDB para reabrirlos sin tener que volver a elegir el archivo. Los libros importados antes de v1.0.5 necesitan una nueva importación para disponer de esa copia. En Chrome/Edge de escritorio también se puede guardar una copia en una carpeta elegida mediante File System Access API.

**Limitación real**: `showDirectoryPicker` solo está disponible en navegadores Chromium de escritorio. En móvil, Safari y el APK, la copia de IndexedDB permite reabrir el libro mientras el almacenamiento del navegador no se borre y haya cuota suficiente.

## Google Drive

La versión web utiliza Google Identity Services con el mismo cliente web de Inhouse Notes. A partir del APK v1.0.13, Android usa el mismo flujo de Notes: Custom Tab, código de autorización con PKCE, callback nativo y renovación de sesión. El cliente OAuth Android de Read debe estar registrado en el proyecto Google `inhouse-notes` para el paquete `com.inhousesoftware.read` y el SHA-1 del certificado de firma. Cada app conserva su propia sesión. Los libros se guardan en la carpeta `inhouse read` y la posición de lectura en archivos JSON de la subcarpeta `.inhouse-read-state`. La biblioteca descubre libros de otros dispositivos, sube los libros locales pendientes y permite descargar una copia para leer sin conexión. La foto de la cuenta aparece arriba a la derecha y su menú permite sincronizar, cambiar el tema y cerrar sesión.

## Despliegue (GitHub Pages)

La configuración Android incluye **Enable custom URI scheme** en las opciones avanzadas del cliente de Read. El 2026-09-28 se corrigió este ajuste, que provocaba `invalid_request` incluso con el paquete y certificado correctos. Ver [configuración y comprobaciones OAuth](android/README.md#google-drive-en-android). La versión 1.0.14 también recupera el callback tras recargar Android y corrige la foto oculta por la inicial en el menú de cuenta.

Igual que inhouse notes: build de Vite, publicado a la rama `gh-pages` vía `peaceiris/actions-gh-pages`, sirviendo la rama directamente desde Settings → Pages (no el deployment nativo de Actions, que en el repo hermano dio timeouts). Se dispara en cada push a `main` — ver `.github/workflows/deploy-pages.yml`.

## Android

App-shell WebView (Capacitor) que apunta a la URL en vivo de GitHub Pages, con el mismo pipeline de firma automatizado que Inhouse Notes (`.github/workflows/build-android.yml`, disparo manual desde la pestaña Actions). **Descarga**: https://miguelcoxcaballero.github.io/inhouse-read/download-android.html — página real del sitio que consulta en vivo el último release (no un link fijo que se desactualiza). Detalles en `android/README.md`.
