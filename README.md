# inhouse read

Lector de PDF, EPUB y MOBI. Hermano de [inhouse notes](https://github.com/miguelcoxcaballero/inhousenotes): misma paleta, misma tipografía (Comfortaa + DM Sans), mismo patrón de despliegue a GitHub Pages.

La biblioteca permite elegir una estantería 3D de nogal o una BAGGEBO de metal blanco, con libros y plantas con volumen. Al tocar un libro, sale de la balda y gira hasta enseñar la portada antes de abrirse.

### Actualización web · 1.7.17

- El PDF abre directamente en la página guardada y reutiliza su renderizado completo cuando el documento, tamaño y preferencias siguen válidos.
- La estantería conserva los cambios pendientes mientras lees y evita repintados 3D innecesarios.
- Las plantas conservan sus geometrías al ampliar la vista; el marcapáginas reutiliza sus buffers al abrir y cerrar. Se mantienen resolución, modelos, iluminación y sombras.
- Una extracción antigua de portada ya no puede alterar otro libro o una sesión nueva.

**Verificado:** [2.141 unitarias y 331 E2E aprobados](https://github.com/miguelcoxcaballero/inhouse-read/actions/runs/37113842421), además de 20 casos en la web publicada y una descarga nueva de la APK pública. [Comparación de rendimiento y calidad visual](docs/performance-1717.md).

### Actualización web · 1.7.16

- Biblioteca local y arranque offline tras una primera carga completa. Los libros se suben a Google Drive cuando eliges **Subir a Google Drive**; los vinculados sincronizan su progreso.
- Libros con grosor según su longitud, portadas proporcionadas y macetas compactas. Se reutilizan los modelos 3D al cerrar el lector y cambiar de catálogo.
- La lectura PDF conserva la página actual hasta que empieza el audio siguiente y se adapta al abrir o cerrar los controles. Las imágenes mantienen sus colores; en PDF complejos se conserva la página completa cuando no se pueden aislar con seguridad.
- **105 opciones de idioma y voz:** 39 Piper y 66 combinaciones Supertonic, no 105 personas. Piper sigue siendo predeterminado. Supertonic se instala manualmente como paquete compartido de **209 MB**, gratuito bajo OpenRAIL-M. Hebreo, serbio y chino conservan una voz cada uno.

**Verificado:** [2.086 unitarias y 330 E2E aprobados](https://github.com/miguelcoxcaballero/inhouse-read/actions/runs/37110847248), además de 38 casos en la web publicada. [Resultados, cobertura de voces y límites](docs/overnight-polish-1716.md).

### Actualización web · 1.7.15

- Arranque sin conexión después de una primera carga completa con internet: la app guarda su interfaz y los motores del lector. Los libros y las voces descargadas se conservan en sus almacenes locales; no hace falta mantener una pestaña abierta.
- Cada libro importado conserva sus bytes originales y su progreso en este dispositivo. La importación no exige Google ni una subida: desde la portada puedes pulsar **Subir a Google Drive** y, una vez guardado, aparece **Guardado en Google Drive**. Los libros vinculados siguen sincronizando el progreso en segundo plano al cerrar.
- Los libros encontrados en Drive descargan su copia local en segundo plano. Un libro ya guardado abre desde esa copia sin esperar al progreso remoto.
- El grosor depende de las páginas reales o, para libros sin páginas fijas, de una estimación de su longitud textual. Se conserva la proporción de la portada. Las plantas compatibles pueden usar la nueva MUSKOT compacta de Ø12 × 11 cm exteriores; las macetas ya elegidas mantienen su talla.
- Los temas del lector conservan los colores originales de las fotos y las ilustraciones. Cambiar el tema de un PDF reutiliza el renderizado y su capa de texto.
- El catálogo pausa los modelos fuera de pantalla y conserva sus vistas al cambiar de sección. La devolución del libro reutiliza el modelo de apertura y actualiza el marcapáginas.
- El audiolibro prepara la página siguiente del PDF y sus primeros fragmentos durante la lectura actual; la página cambia al comienzo de su audio.
- Voces gratuitas de descarga manual: 39 opciones Piper de 35 modelos y tres perfiles Supertonic en 22 idiomas compatibles, que añaden 66 combinaciones. Son **105 opciones de idioma y voz**, no 105 personas diferentes. Piper sigue siendo la opción predeterminada. Supertonic comparte un paquete de 208.164.809 bytes (unos 209 MB en el selector), con licencia OpenRAIL-M, que permite sintetizar localmente tras descargarlo.

[Implementación, licencias, límites por idioma y comprobaciones locales de 1.7.15](docs/overnight-polish-1715.md).

### Actualización web · 1.7.14

- El audiolibro prepara la página siguiente del PDF con el mismo documento y motor de renderizado. Mantiene visible la página anterior mientras sintetiza y muestra la continuación al comenzar su audio, con el resaltado ya alineado; las preparaciones pendientes se descartan al navegar o cerrar.

### Actualización web · 1.7.13

- Retirar un libro aplica los cambios pendientes de la biblioteca en una sola actualización de la escena. Las peticiones de repintado ya realizadas se consumen sin repetir el trabajo 3D; se conservan los cambios posteriores y la recuperación si falla el guardado.

### Actualización web · 1.7.12

- La página preparada conserva su imagen y sus texturas al cambiar sólo de posición entre la portada y el lector. Los cambios de tamaño, progreso y preferencias siguen exigiendo una preparación nueva.
- Los controles invisibles se mantienen dentro del área de la app y evitan el desplazamiento de un píxel del documento al cambiar de página.

### Actualización web · 1.7.11

- El click de compatibilidad del mismo toque que saca un libro se consume aunque Android lo dirija al fondo o a los controles de la portada recién creada. El siguiente toque, el teclado y el arrastre siguen disponibles.
- Las lámparas responden al toque breve después de ampliar la vista y conservan el arrastre por pulsación larga.

### Actualización web · 1.7.10

- Los toques táctiles de la estantería se validan al apoyar el dedo y abren el libro al soltarlo, incluso cuando el navegador no genera el clic tras un desplazamiento. Se conservan los gestos de zoom, arrastre y pulsación prolongada, y cada toque abre una sola vez.

### Actualización web · 1.7.9

- El audiolibro utiliza sólo las voces naturales del catálogo y sus idiomas. Los dispositivos lentos esperan a que se prepare el fragmento completo sin cancelar la voz seleccionada ni pasar a otra del sistema. Las preferencias anteriores de voces del dispositivo se migran a selección automática.
- Una frase que cruza de página se divide según sus posiciones reales en el documento. La página avanza cuando empieza a sonar el fragmento que continúa en ella; el resaltado conserva la frase completa.
- El lector mantiene la pantalla encendida mientras está visible, libera la solicitud al salir o pasar a segundo plano y la recupera al volver.
- El indicador de colocación se prepara junto a la estantería y reutiliza sus gráficos al iniciar el primer arrastre. Retirar un libro conserva la escena y sus programas preparados.

### Actualización Android · APK 1.1.3

- En el lector se activa `KEEP_SCREEN_ON`, se oculta la barra de estado completa y se aprovecha su espacio superior. La estantería recupera sus barras e insets normales. Se conservan los ajustes de refresco y la importación desde «Abrir con». Requiere instalar la APK 1.1.3 (versionCode 16).

### Actualización web · 1.7.8

- La página blanca preparada en segundo plano se dibuja antes de comenzar a abrir el libro, incluso si se pulsa la portada antes de terminar la preparación. Los nueve casos de transición conservan las comprobaciones de color y estado desde el primer fotograma.
- Los cambios de página de EPUB conservan el orden de los toques rápidos, incluido volver atrás mientras acaba el avance anterior.
- El editor prepara el material del relieve antes de mostrar las propuestas, también al reabrir una portada con propuestas guardadas en caché. Elegir el primer acabado ya no compila un shader durante el balanceo.
- El giro de la estantería conserva las poses intermedias aunque un fotograma tarde más al preparar los gráficos.
- Las portadas mantienen su tinta al limitar los reflejos ambientales amplios; los reflejos de las lámparas y los acabados mate, satinado y brillante se conservan.
- El punto de toque de la lámpara MITTLED se centra en una parte visible del difusor, incluyendo las coordenadas de toque y clic del móvil. Se recalcula al mover la cámara y se reutiliza durante los cambios de luz.

### Actualización web · 1.7.7

- Catálogo de 36 voces naturales en 27 idiomas: incorpora portugués de Portugal, búlgaro, serbio, hindi y hebreo, y corrige la descarga de turco. La instalación guarda también los diccionarios y, para hebreo, el modelo de vocalización necesarios para sintetizar sin volver a descargarlos al recargar el lector.
- Velocidades de lectura de 0,75×, 1×, 1,25×, 1,5× y 2×, con controles accesibles y distribución adaptada a móviles pequeños. Las preferencias anteriores se conservan en el paso más próximo.
- Las preparaciones de voces se ordenan y se invalidan al liberar el motor; un calentamiento tardío conserva la voz que está leyendo.
- Las páginas físicas del libro 3D son blancas. Al abrir, pasan al tema del lector durante el acercamiento; al cerrar, vuelven al blanco antes de poner el marcapáginas y devolver el libro a la balda. Publicado primero en 1.7.6.
- El arranque de neerlandés y otros idiomas reutiliza los diccionarios que ya incluye el motor, evitando crear dos veces el mismo archivo y pasar a la voz del sistema. Publicado primero en 1.7.5.

### Actualización Android · APK 1.1.2

- La app Android vota por el modo de pantalla más rápido de la resolución actual (hasta 120 Hz) al abrirse, volver al primer plano, ganar el foco o girar, y en Android 15 o posterior pide además la categoría de frecuencia alta. Sin ese voto muchos móviles mantenían el WebView a 60 Hz. Requiere instalar la APK 1.1.2 (versionCode 15); la web no cambia.
- El filtro de brillo del lector sólo se aplica cuando el brillo no es 100 %, de modo que la página no se convierte en una superficie de filtro durante las animaciones.

### Actualización web · 1.6.25

- TÄRNABY ilumina desde cuatro superficies estrechas alineadas con sus filamentos LED, en lugar de una luz puntual en el centro de la bombilla. Los reflejos responden a la longitud y orientación de las fibras.
- El catálogo usa los mismos emisores. Encendido, apagado y atenuación sincronizan la luz de las fibras con su brillo visible; el zoom mantiene la radiancia y la caché del movimiento.

### Actualización web · 1.6.24

- El movimiento y la inercia de la vista isométrica reutilizan la imagen de la escena. Las portadas y apariencias pendientes se agrupan al terminar el gesto; entonces se actualizan los modelos, texturas, sombras y objetivos táctiles con su calidad de inspección.
- El arrastre de objetos evita renders síncronos repetidos por cada evento del dedo y actualizaciones innecesarias de las sombras.
- BAGGEBO conserva las proporciones publicadas de 60 × 25 × 116 cm, con cuatro montantes triangulares orientados hacia las esquinas achaflanadas de las baldas.

### Actualización web · 1.6.23

- La papelera queda delante de la pared, con espacio para el cuerpo, la bisagra y la tapa abierta. La separación se conserva al cambiar de estantería o de tamaño de pantalla.

### Actualización web · 1.6.22

- Portadas, lomos y tapas tienen pequeñas ondulaciones suaves que se descubren en los reflejos de las lámparas y de la habitación. Cada libro conserva su propio patrón al ampliar la estantería o abrirlo.
- La impresión, silueta y sombras del libro se mantienen: las imperfecciones sólo afectan al brillo de su superficie, especialmente visible en los acabados satinado y brillante.
- El efecto reutiliza las mallas y texturas existentes, comparte el programa entre libros y no añade llamadas de dibujo ni animación continua.

### Actualización web · 1.6.21

- Los acabados mate, satinado y brillante de los libros usan reflejos físicos distintos: luz difusa, brillo suave y reflejos definidos de las lámparas y la habitación.
- Cambiar solo el brillo del lomo actualiza también el libro cerrado en la estantería; sus extremos mantienen el mismo acabado.
- El laminado suaviza el relieve de la portada conservando su imagen y resolución. La mejora reutiliza las mismas mallas, texturas y luces, y la escena descansa al terminar cada cambio.

### Actualización web · 1.6.20

- Toca cada lámpara para encenderla o apagarla; su estado se guarda al recargar y al cambiar de estantería. Mantener pulsado sigue sirviendo para moverla.
- Los cuatro filamentos LED del farol retro tienen un centro luminoso cálido y borde ámbar, visibles a través del cristal. El brillo y la iluminación de libros y baldas cambian juntos con una transición breve.
- Las transiciones reutilizan geometría y sombras, y la escena vuelve a descansar al terminar. El movimiento reducido cambia la luz inmediatamente.

### Actualización web · 1.6.19

- Zoom y desplazamiento reutilizan las sombras mientras se mueven los dedos; al soltar, la luz principal ajusta una sola vez su mapa a la vista ampliada. Conserva las resoluciones, el suavizado y los efectos cálidos.
- La BAGGEBO conserva todos sus triángulos y huecos, usando un 33 % menos de memoria en sus buffers. La geometría completa se reutiliza al recrear unidades o abrir el catálogo.
- Los contornos interactivos de las hojas se escalan con la vista sin volver a proyectar cada triángulo. El renderer comparte los fotogramas con los canvas visibles sin retener otro buffer entre renders.

### Actualización web · 1.6.18

- BAGGEBO blanca con rejilla metálica geométrica, agujeros y espesor reales, bordes plegados, pintura fina y tornillos biselados. Mantiene las medidas de 60 × 25 × 116 cm y cuatro lotes de material por unidad.
- Lámparas con más potencia y alcance; el trípode ilumina por debajo de su soporte. Los haces cálidos se reflejan en baldas, cubiertas y en la pared de la habitación detrás del mueble abierto.
- Luz de estudio más suave en la preview de la BAGGEBO y ambiente ajustado para distinguir el metal blanco de la iluminación cálida. El zoom sigue usando los dedos y la escena deja de renderizar al descansar.

### Actualización web · 1.6.17

- Nueva pestaña **Iluminación** en el catálogo IKEA: foco circular bajo balda, farol TÄRNABY con bombilla LED de filamento visible y lámpara compacta de trípode con pantalla de lino.
- Modelos 3D con cristal, latón, metal, veta de madera y tejido; luz cálida de 2700 K que ilumina los libros y las plantas.
- Las lámparas se guardan, se pueden mover entre baldas y retirar con la papelera. Los focos ocupan el techo de la leja sin desplazar los libros; funcionan con madera y BAGGEBO.

### Actualización web · 1.6.16

- Escena 3D móvil a todo el ancho, sin marco lateral ni banda inferior al ampliar con los dedos. El espacio del título y los controles se conserva dentro de su propia fila.
- La superficie de zoom ocupa todo el espacio disponible hasta el borde inferior; el escritorio conserva su ancho máximo de 860 px.

### Actualización web · 1.6.15

- Segunda página del catálogo IKEA para elegir la estantería y guardar la selección sin perder libros ni plantas.
- BAGGEBO de 60 × 25 × 116 cm, con tres baldas interiores, tapa de rejilla, refuerzo trasero y pies regulables. Basada en el manual y la geometría oficiales; [fuentes y precisión del modelo](docs/baggebo-model.md). Las bibliotecas largas usan unidades adicionales con las mismas proporciones.
- Deslizamiento PDF con resistencia y retorno amortiguado; doble toque centrado en el punto pulsado y desplazamiento nativo del PDF ampliado. EPUB conserva su gesto nativo sin pasar página dos veces y respeta el movimiento reducido.


### Actualización web · 1.6.14

- Iluminación de sala de lectura: entorno procedural con ventana y lámpara, sombras suaves (VSM) sólo bajo demanda, oclusión en rincones y sombra de contacto del mueble y la papelera.
- Nogal sin costuras con poro y barniz satinado, cantos redondeados, veta por tablero y zócalo.
- Libros con tapas en tela, lomo con nervios y estampado, bloque de páginas con capas y cinta de marcapáginas saliendo entre las hojas.
- Macetas de cerámica, terracota y metal con tierra visible; papelera de pedal y catálogo con grosor de papel y pinza.
- Editor del lomo rediseñado por secciones, con muestras de tela, controles segmentados y hoja inferior en móvil. Pulido de ficha del libro, cabecera, lector (búsqueda EPUB sin «[object Object]» y resaltado ámbar) y página de descarga.

### Actualización web y Android · 1.6.13 / APK 1.1.1

- Android aparece en «Abrir con» y «Compartir» para PDF, EPUB, MOBI, AZW, AZW3, KF8, FB2 y CBZ. Los archivos se copian inmediatamente con el permiso temporal del proveedor y se importan por el mismo flujo que el selector local, incluyendo la sincronización con Drive.
- Funciona con la app cerrada o abierta. Transferencia por bloques para evitar duplicar libros grandes como una sola cadena base64. Requiere instalar la APK 1.1.1 (versionCode 14).
- PDF usa el [build de compatibilidad oficial de Mozilla](https://github.com/mozilla/pdf.js/wiki/Frequently-Asked-Questions) en el lector y su worker: evita quedarse en «Abriendo libro…» cuando el WebView Android no tiene APIs recientes como `Promise.try`.
- Registro de tipos MIME y extensiones según las [reglas de intents de Android](https://developer.android.com/training/basics/intents/filters).

### Actualización web · 1.6.12

- Al salir del lector, la página actual se aleja en el modelo 3D, recibe el marcapáginas, se cierra la portada y el libro vuelve a su hueco mediante la escena de la estantería. La página y la portada permanecen visibles durante el cambio entre lector y modelo.
- La apertura retira primero el marcapáginas de la página guardada y después acerca la página al lector. El cierre conserva la posición actual, incluida la primera página y la primera salida tras importar un libro.
- Las dos caras del libro abierto se encuadran dentro de la pantalla del móvil antes del zoom, con un desplazamiento y escala continuos durante la bisagra.
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
- Lectura en voz alta con pausa, continuación, selección de voz natural, velocidad y temporizador; avance automático sincronizado con los fragmentos de audio. Se descargan las voces naturales del catálogo una vez y se conservan sus recursos para usarlas sin conexión. Los documentos escaneados sin texto necesitan OCR; la función no genera archivos de audiolibro.

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

Los bytes originales de cada libro importado se guardan en IndexedDB antes de dar la importación por terminada. No hace falta elegir una carpeta ni conectar Google. Los libros antiguos con una copia en una carpeta local autorizada se recuperan desde allí; cuando no existe ninguna copia accesible, deben importarse de nuevo. Al conectar Drive, los libros descubiertos descargan su copia local en segundo plano. El progreso se guarda primero en este dispositivo.

**Limitación real**: `showDirectoryPicker` solo está disponible en navegadores Chromium de escritorio. En móvil, Safari y el APK, la copia de IndexedDB permite reabrir el libro mientras el almacenamiento del navegador no se borre y haya cuota suficiente.

## Google Drive

La versión web utiliza Google Identity Services con el mismo cliente web de Inhouse Notes. A partir del APK v1.0.13, Android usa el mismo flujo de Notes: Custom Tab, código de autorización con PKCE, callback nativo y renovación de sesión. El cliente OAuth Android de Read debe estar registrado en el proyecto Google `inhouse-notes` para el paquete `com.inhousesoftware.read` y el SHA-1 del certificado de firma. Cada app conserva su propia sesión. Con una cuenta conectada, **Subir a Google Drive** en la portada guarda el libro en la carpeta `inhouse read`; el estado y la posición de lectura se guardan en JSON de `.inhouse-read-state`. La biblioteca descubre libros de otros dispositivos y guarda su copia local, pero iniciar sesión o importar un archivo no sube automáticamente los libros locales nuevos. La foto de la cuenta aparece arriba a la derecha y su menú permite sincronizar, cambiar el tema y cerrar sesión.

## Despliegue (GitHub Pages)

La configuración Android incluye **Enable custom URI scheme** en las opciones avanzadas del cliente de Read. El 2026-09-28 se corrigió este ajuste, que provocaba `invalid_request` incluso con el paquete y certificado correctos. Ver [configuración y comprobaciones OAuth](android/README.md#google-drive-en-android). La versión 1.0.14 también recupera el callback tras recargar Android y corrige la foto oculta por la inicial en el menú de cuenta.

Igual que inhouse notes: build de Vite, publicado a la rama `gh-pages` vía `peaceiris/actions-gh-pages`, sirviendo la rama directamente desde Settings → Pages (no el deployment nativo de Actions, que en el repo hermano dio timeouts). Se dispara en cada push a `main` — ver `.github/workflows/deploy-pages.yml`.

## Android

App-shell WebView (Capacitor) que apunta a la URL en vivo de GitHub Pages, con el mismo pipeline de firma automatizado que Inhouse Notes (`.github/workflows/build-android.yml`, disparo manual desde la pestaña Actions). **Descarga**: https://miguelcoxcaballero.github.io/inhouse-read/download-android.html — página real del sitio que consulta en vivo el último release (no un link fijo que se desactualiza). Detalles en `android/README.md`.
