# Entrega 1.7.312 (shelf-tail, bloque 2): estudios del catálogo en Rust

El bucle de los tres estudios del catálogo (planta, armario, lámpara: cuándo se pide o cancela un fotograma, cuándo se construye la selección, cuándo se muestra tras enlazar programas, recoloreado sin reconstruir, transición de temperatura de color), sus luces y cámara, y el soporte de la lámpara se deciden en Rust (`catalog_studio.rs`); JS conserva three.js, el canvas y los observadores. Corrección posterior: la lectura de las entradas de las lámparas en Rust (`lamp_entries.rs`) se retiró antes de publicarse en `main`: una medida de `update` con 300 entradas (12 lámparas) dio 0,66 ms por fotograma frente a 0,05 ms del JavaScript, por los cruces Reflect por entrada, y ese camino corre en cada fotograma iluminado. `shelf-lamp-lighting.js` queda como en el bloque 1 y el módulo Rust se borra.  Pasan 161 pruebas específicas (diferenciales contra los originales congelados: 60 guiones aleatorios por estudio comparando cada paso, y 400 salas de luces); unidad en 4 bloques 7565/7569 con los mismos fallos que `main`. Visual: 24 estados idénticos a `main` (máx. 1/255). E2E: 10/11; el fallo restante (`lamp-switches` 136) falla igual en `main` 1.7.309. Inventario tras mezclar `main` 1.7.311 y retirar `lamp_entries.rs`: 42737 líneas Rust / 19835 JavaScript = 68,30 %, no funciones completadas. Detalles en [remaining-wip-verification.md](remaining-wip-verification.md).

---

# Entrega 1.7.312 (shelf-tail, bloque 1): papelera y catálogo de papel en Rust

Los modelos completos de la papelera (perfiles, colores por vértice, normales inclinadas, pedal biselado, bisagra, asa, tapa y su movimiento, boca) y del folleto IKEA colgado del armario (bloque, hojas, portada curvada, lomo, pinza con pliegue suavizado, alambres, grapas, clavo y el dibujo completo de la portada en el canvas) salen ahora de Rust (`shelf_trash.rs`, `shelf_catalog.rs`, `shelf_models.rs`); JavaScript solo crea los objetos de three.js y el canvas. Se añaden a Rust los generadores exactos de three r180 que faltaban (cápsula, plano, arco de toro, extrusión biselada y normales con pliegue). Pasan 35 pruebas específicas que comparan bit a bit con los originales congelados y con three.js; la batería unitaria en 4 bloques da 7556/7560, con 3 fallos que también tiene `main` 1.7.309 (voz neuronal) y uno intermitente de live-room. Comparación visual contra `main`: 24 estados capturados idénticos (máx. 1/255); 10 estados de transición expiraron en ambos builds. Los E2E de papelera y catálogo que fallan aquí fallan igual en `main`. Inventario 41836 líneas Rust / 20083 JavaScript = 67,57 %, no funciones completadas. Detalles en [remaining-wip-verification.md](remaining-wip-verification.md).
---

# Entrega 1.7.311: etiquetas del lector, URLs de voces y cierre EPUB en Rust

Etiquetas de lugares, tamaños, descripción del panel y archivo compartido, URLs de voces Piper (con el modelo serbio y Nakdimon) y el cierre del lector EPUB con su regla de cursor audible pasan a rust-ui; se retiran dos búsquedas de catálogo sin uso. Diferenciales contra copias congeladas con miles de casos; 7566 unitarias con los fallos explicados en el detalle; 68/68 E2E finales, incluidas dos pruebas PDF que fallaban en main por no cargar Rust UI en su página. Inventario 41742 líneas Rust / 20244 JavaScript = 67,34 %, no funciones completadas. Detalles en [remaining-wip-verification.md](remaining-wip-verification.md).

---

# Entrega 1.7.310: geometría PDF y alineación Piper en Rust

La geometría de los elementos de texto PDF (transformación, dirección dominante, rotaciones, cajas y RTL) pasa a rust-core con la Math del motor; el recorrido/reescritura ONNX de duraciones Piper, las marcas de página y las escalas de inferencia pasan al núcleo de voz, que lee el modelo por ventanas sin copiarlo. Se corrige el TypeError de la fachada de voz al liberar durante la precarga. Pasan diferenciales de 4000 páginas, 300 modelos sintéticos y 800 malformados, y los 13 modelos Piper reales de la máquina idénticos byte a byte; 7558 unitarias salvo tres fallos por carga que pasan a solas; E2E PDF 39/41 y voz 46 con los fallos ya presentes en main o por pesos ausentes documentados. Inventario 41559 líneas Rust / 20318 JavaScript = 67,16 %, no funciones completadas. Detalles en [remaining-wip-verification.md](remaining-wip-verification.md).

---

# Entrega 1.7.288: anclas y progreso en Rust

Las guardas de posiciones y la escritura del progreso del lector se ejecutan en Rust compartido UI/Shelf. Se conservan CFIs exactos y la última posición válida ante avisos incompletos. Pasan 447 pruebas específicas, incluidas 20 nuevas y 20 000 comparaciones, y nueve E2E finales en una sola ejecución sin fallos. Inventario 35281 líneas Rust / 20509 JavaScript = 63,24 %, no funciones completadas. Detalles en [remaining-wip-verification.md](remaining-wip-verification.md). Continúan la extracción de portadas y las políticas restantes de app.js; preservar todos los WIP/stashes y ramas ajenas.

---

# Entrega 1.7.287: ingestión de archivos en Rust

Metadatos, cancelación, configuración del reader, persistencia de bytes, recuento, posición y confirmación de importaciones pasan a Rust compartido UI/Shelf. El bootstrap JS permite esperar o informar de un módulo nativo que aún no existe, conservando la carga fría y los controles bloqueados por generación. Pasan 427 pruebas específicas, incluidas 47 nuevas diferenciales y comprobaciones reales de anclas; trece E2E finales pasan en una ejecución sin fallos. Inventario 35224 líneas Rust / 20523 JavaScript = 63,19 %, no funciones completadas. Detalles en [remaining-wip-verification.md](remaining-wip-verification.md). Continúan las políticas restantes de app.js y el resto de la migración; preservar todos los WIP/stashes y ramas ajenas.

---

# Entrega 1.7.286: apertura del lector en Rust

Selección, propiedad/cancelación de la apertura, reutilización de preparaciones, recuperación local/carpeta/Drive, selector manual y transición de la misma página se coordinan en Rust compartido UI/Shelf. Los callbacks y APIs del navegador quedan como transporte recogible por GC. Pasan 323 pruebas específicas, incluidas 59 nuevas diferenciales, animación y ciclos de recursos; catorce E2E distintos finales pasan en dos ejecuciones sin fallos. Inventario 35113 líneas Rust / 20611 JavaScript = 63,01 %, no funciones completadas. Detalles en [remaining-wip-verification.md](remaining-wip-verification.md). Continúa la ingestión de archivos y el resto de app.js; preservar todos los WIP/stashes y ramas ajenas.

---

# Entrega 1.7.285: cierre del lector en Rust

El coordinador completo de cierre, progreso y regreso a la misma página se ejecuta en Rust compartido UI/Shelf. Mantiene el canvas original, el soporte y pose de los libros, la primera portada pendiente y la sincronización Drive sin bloquear el vuelo. JavaScript conserva adaptadores de navegador y callbacks recogibles por GC. Pasan 264 pruebas específicas, incluidas 46 nuevas diferenciales y ciclos de recursos; nueve E2E distintos finales verificados, con alcance y repetición documentados. Inventario 34925 líneas Rust / 20749 JavaScript = 62,73 %, no funciones completadas. Detalles en [remaining-wip-verification.md](remaining-wip-verification.md). Continúa la migración de apertura y del resto de app.js; preservar todos los WIP/stashes y ramas ajenas.

---

# Entrega 1.7.284: colocación cuidadosa en Rust

La intención de caída del libro caduca al detener el dedo. Una colocación muy lenta o con pequeño temblor deja el libro recto, y un pequeño gesto lateral reciente inicia el vuelco hacia ese lado, incluida una inversión del movimiento. La intención usa los timestamps de entrada y se fija al soltar, independientemente del renderizado. La gravedad, el agarre animado, las colisiones y el frenado contra el patinaje siguen siendo físicos. Detalles y validación en [remaining-wip-verification.md](remaining-wip-verification.md). Se conserva el layout exacto y el audio de 48 kHz sin arrastres de 1.7.282/283. El resto de la migración de app.js sigue pendiente; preservar WIP, ramas y stashes de otros agentes.

---

# Entrega 1.7.283: audio nítido y sin arrastre

Se eliminan los roces durante el arrastre y se silencian sus códigos antiguos en Rust y Web Audio. Atlas regenerado a 48 kHz desde los originales CC0 con filtrado más ligero: 128 tomas conservadas y 18 de arrastre retiradas. También el respaldo Rust usa 48 kHz con frecuencia explícita en el contrato. Se mantienen cuatro voces máximas y suspensión en reposo. Se conservan las poses exactas y el soporte físico de 1.7.282. Validación y hashes en [remaining-wip-verification.md](remaining-wip-verification.md). El resto de la migración continúa pendiente; este ajuste no declara completada la aplicación en Rust. Preservar WIP, ramas y stashes de otros agentes.

---

# Entrega 1.7.282: layout estable y sonidos reales

La selección/lectura reserva el cuerpo y la matriz físicos del libro en Rust; regresar no reinicia su inclinación ni restaura una copia antigua de los vecinos. La retirada y el arrastre reales siguen liberando el apoyo. El atlas final de wip/sfx@adede344 incluye 146 clips de 16 kHz / 1861058 B con créditos CC0, alternativas grabadas y síntesis Rust de respaldo. Eventos y contactos por material se deciden en Rust; el transporte Web Audio se suspende en reposo. Se conservan las calidades visuales y los parámetros físicos.

Verificación final e inventario detallados en [remaining-wip-verification.md](remaining-wip-verification.md). Inventario de fuentes: 34771 líneas Rust y 20815 JavaScript, 62,55 %; no representa funciones completadas. La coordinación de apertura/cierre restante y otras partes de app.js siguen pendientes. No se toca Android, el actualizador, vendor ni workflows. Conservar WIP, stashes y ramas de otros agentes; no se sustituye ready/sfx.

---

# Migración a Rust: implementación y comprobaciones

Entrega 1.7.281: coordinación de preparación del lector en Rust: selección, cola compartida, cancelaciones por generación, posición guardada, claves y reutilización de página. Los adaptadores conservan las APIs de File, Promise, DOM e idle. Pasan 426 pruebas específicas en 23 archivos, incluidas 36 nuevas diferenciales y ciclos de recursos. Pasan once E2E con la compilación final, en una sola ejecución y sin reintentos: preparación y reutilización de PDF/EPUB, cambio de posición guardada de Drive, giro, cierre sin lectura, apertura rápida, regreso a la última página, cambios de tema/preferencias y carga normal/retrasada del módulo. Las dos pruebas compiladas verifican además que se ejecutan app_prepare_book, app_run_preparation y app_opening_page_snapshot reales del WASM. Las aperturas preparadas reutilizan una instantánea y no enlazan nuevos shaders. No se declara batería general completa ni medición en teléfono físico.. Inventario 34207 líneas Rust / 20760 JavaScript = 62,23 %, no funciones terminadas; apertura final, cierre y otra coordinación de app.js siguen pendientes. El audio se mantiene para el agente que lo está trabajando; no se cambian sus fuentes. Preservar WIP/stashes/ready.

Entrega 1.7.280: colocación física en Rust por las formas reales de macetas, patas, cristal y libros, con empujes suaves de libros inclinados y sin reservar el ancho vacío del follaje. Se conserva el centro alcanzado y las poses ajenas; el teclado puede crear una leja nueva. Se reparan solapamientos iniciales de libros nuevos y se leen los contactos agrupados reales de Rapier para apoyos y sonidos por material. Pasan 154 pruebas específicas en 15 archivos y nueve E2E del binario final, sin reintentos; no se declara batería general completa. Calidad visual y parámetros físicos conservados. Inventario 61,99 % de líneas, no funciones terminadas; migración completa pendiente. Detalle en remaining-wip-verification.md. Preservar WIP/stashes/ready.

Entrega 1.7.279: arrastres 3D locales en Rust, sin redistribuir otros objetos, y recuperación de sueltas solapadas mediante formas sólidas reales. Las previsualizaciones y animaciones de retorno ya no trasladan cuerpos de macetas/lámparas no seleccionadas. Se conservan las colisiones fijas de las lejas ajenas al traslado, los empujes físicos cuidadosos y el esquema de poses. 83 pruebas específicas y cuatro E2E del binario final aprobados; general anterior de 6571 casos cerrada mediante reverificación del único fallo y cinco casos nuevos (6576 distintos), sin declarar otra general completa. Se verifican ambas vistas, empujes, poses al recargar y traslado real de plantas/libros.. Detalle en remaining-wip-verification.md.

Entrega 1.7.278: preparación inicial en Rust con una apariencia completa por portada, fotos decodificadas compartidas con el modelo y solo las fuentes necesarias para estilos guardados/personalizados. Primer frame sin letras provisionales ni sustitución posterior de fotos. 140 comprobaciones específicas finales pasan; la general de 6561 casos queda cerrada mediante reverificación de sus 32 fallos y cuatro casos nuevos (6565 distintos). Once E2E distintos pasan con el binario final, incluyendo fuente/autor/foto reales desde el primer dibujo, importación, Drive, zoom, sonido, empuje, poses y colocación. El ensayo de retener Core tampoco pasa con los assets 277; la batería global no se declara aprobada. Comparativa local de 12 libros: frame completo 6231→5304 ms e inicio caliente 4985→2929 ms; portadas provisionales 12→0. Muestras pequeñas, sin extrapolar al teléfono. Inventario 61,85 % de líneas, no funciones terminadas. Detalle y alcance en remaining-wip-verification.md. Preservar WIP/stashes/ready.

Entrega 1.7.277: foley y detección de impactos por material en Rust, con transporte Web Audio opcional que se suspende en reposo y opción de silencio. Contacto real de canto/tapa y piezas de cristal/cerámica, sin sonido en la carga inicial ni análisis cuando está desactivado. Pasa la batería completa: 6558 comprobaciones en 517 archivos, incluidas 43 físicas. Pasan 17 E2E distintos, incluidos sonidos nativos, recarga de poses, zoom, colocación, corpus físico y lector móvil; 16 en la pasada general y uno en la repetición física corregida.. Inventario 61,88 % de líneas, no funciones terminadas; la migración completa sigue pendiente. Preservar WIP/stashes/ready.

Entrega 1.7.276: contactos sólidos compartidos con las mallas en Rust y gravedad vertical de macetas/lámparas, sin apoyo sobre hojas ni bloqueos al aterrizar sobre tapas. Snapshots de todos los cuerpos y pulsación breve sin mover apoyos. Verificados 400 casos en 21 archivos, incluidas 43 físicas, 24 sesiones completas y 200 000 colores. Detección de pruebas sin bindings corregida y referencias limitadas a los contratos nuevos de agarre/pausa, con aserciones conservadas. Tablas metálicas sin techo duplicado; guardados antiguos corrigen el apoyo manteniendo ángulos. Diez E2E finales pasan en una sola ejecución sin reintentos: zoom con portadas nítidas y sin nuevos dibujos GPU durante el gesto, luces, apoyo y dominó, agarre tranquilo, liberaciones sin patinar, pausa de escena oculta, empuje nativo antes de soltar, recarga conservando seis poses (<1 px / 0,00001 rad) y colocación/persistencia de libro y planta.. Inventario 61,90 %, no funciones terminadas. Sonidos siguen pendientes; conservar todos los WIP/stashes/ready y continuar migración.

Entrega 1.7.275: empuje isométrico en el plano físico real, persistencia validada de centros/ángulos en Rust y contactos laterales sin libros suspendidos. Se conserva rozamiento de la leja y apoyo sobre otros libros. Pasan 171 específicas con restauración exacta, UTF-16 y geometría pendiente. Diez E2E finales pasan en una ejecución sin reintentos: importación, zoom nítido, luz cálida, empuje antes de soltar, recarga con las mismas poses, dominó, barrido rápido, liberación a ambos lados, suspensión y colocación real de libro/planta. Inventario 61,83 %, no funciones terminadas. Colisionadores detallados y sonidos siguen pendientes; preservar todos los WIP/stashes/ready y continuar migración.

Entrega 1.7.274: despertar físico por leja en Rust, pausa de dibujo/shaders/texturas fuera de pantalla. Mismo solver y parámetros visuales. Comparativa de 72 libros / 61 pasos: mediana 32,388→9,913 ms, 69,4 % menos CPU del solver, sin afirmar ahorro de batería del teléfono; libros ajenos despiertos 69→0. Pasan 289 específicas. Nueve casos E2E finales pasan sin reintentos en una ejecución: importación fría/caliente, zoom con imagen conservada y portadas nítidas, luces cálidas, apoyo/dominó, barrido rápido, liberaciones reales en ambos sentidos, pausa real de la sala móvil durante física activa y reposo al reanudar, y colocación/persistencia de libro y planta. Inventario 61,76 %, no funciones completadas. Después: colisionadores sólidos y sonidos, continuar migración; preservar WIP/stashes y ramas ready.

Entrega 1.7.273: apoyo sin patinar en Rust. Se sustituye el bloqueo Z que anulaba el rozamiento por una articulación planar, se usan contactos por punto y se inicia la inclinación alrededor del pie. La prueba mide la esquina durante toda la caída: 108,44 mm antes frente a 1,203–1,205 mm ahora, en ambos sentidos/materiales. Pasan 186 específicas con todas las aserciones físicas anteriores. Ocho casos E2E finales pasan sin reintentos en dos ejecuciones (2 + 6), con importación fría/caliente, zoom sin dibujos GPU durante el gesto, seis portadas nítidas, lámpara cálida, dominó con soporte firme, barrido rápido, liberación real en ambos sentidos, colocación/persistencia de libro y planta, y reposo del renderer. Inventario 61,83 %, no funciones terminadas. Siguiente: coordinación de apertura/preparación del lector; preservar WIP/stashes y ramas ready.

Entrega 1.7.272: caída hacia el gesto reciente, agarre según la altura y frenado de la liberación en Rust; callbacks de colocación/orden también nativos. Pasan 196 específicas, incluidas todas las comprobaciones físicas anteriores, palanca superior/inferior y caída a ambos lados sin patinar. Ocho E2E finales pasan en una ejecución sin reintentos, con gesto real a ambos lados, altura del toque recibida por el solver, persistencia y GPU en reposo. Inventario 61,81 %, no funciones terminadas. Siguiente: coordinación de apertura/preparación del lector; preservar WIP/stashes y ramas ready.

Entrega 1.7.271: selección de acabados, posiciones y lista de personalización en Rust UI/Shelf. Pasan 152 específicas con los corpus completos de colores/lomos y 500 registros comparados, y seis E2E finales en una ejecución. Tablas y calidad visual intactas, lecturas/coerciones/UTF-16 preservadas. Inventario 61,77 %, no funciones terminadas. Siguiente: callbacks de colocación/orden y coordinación restante; preservar WIP/stashes y ramas ready.

Entrega 1.7.270: guardado, nombres/apariencia y retirada con limpieza diferida del lector en Rust UI/Shelf. Pasan 96 específicas en 12 archivos, incluidas diez sesiones de retirada y 30 ciclos de recursos, y ocho E2E finales en una ejecución. Se mantiene el contrato síncrono de errores previos y no se espera una descarga para completar la papelera. Inventario 61,69 %, no funciones terminadas. Siguiente: validación de apariencia/posición y coordinación restante; preservar WIP/stashes y ramas ready.

Entrega 1.7.269: coordinación de refresco posterior a la carga en Rust: normalización, guardado, cuenta, recuento y reutilización/actualización de escena. Pasan 71 específicas con 17 sesiones comparadas y 40 ciclos de recursos, y siete E2E finales en una ejecución. La espera paralela y fábrica de opciones se conservan. Inventario 61,59 %, no funciones terminadas. Siguiente: acciones de libros y resto de coordinación de la aplicación; preservar WIP/stashes y ramas ready.

Entrega 1.7.268: títulos, autores y selección del nombre del lomo en Rust compartido por UI/Shelf; se conserva Unicode/UTF-16 con primitivas del navegador. Pasan 197 específicas, una medición temporal y cuatro E2E finales en una ejecución. Mediana de 200 títulos/autores: 6,08 ms nativos frente a 1,57 ms JS, sin afirmar mejora de velocidad. Inventario 61,54 %, no funciones terminadas. Siguiente: coordinación de refresco de la aplicación; preservar WIP/stashes y ramas ready.

Entrega 1.7.267: comparación completa y orden de biblioteca en Rust, con lectura inicial cruda y orden tras la espera paralela existente. Pasan 73 específicas, una medición y cinco E2E finales en una ejecución. El comparador final tarda 5,24 ms/200 libros frente a 0,34 ms de la referencia JS; no se afirma mejora de velocidad. Inventario 61,34 %, no funciones terminadas. Siguiente: coordinación de la aplicación y normalización de títulos/autores; preservar todos los WIP/stashes y ramas ready.

Entrega 1.7.266: operaciones atómicas y marcas de retirada de la biblioteca en Rust, con carga fuera de las transacciones, y reposo de apoyos físicos estables sin cambiar la pose. Batería general previa al último ajuste físico: 6487/6488 verificadas; persiste el timeout de color preexistente. Tras ese ajuste pasan 142 específicas en siete archivos y ocho E2E finales en dos ejecuciones. Inventario 61,27 %, no funciones terminadas. La conexión/esquema/peticiones siguen como adaptadores IndexedDB y orden/comparación síncronos quedan para el siguiente bloque. Preservar WIP/stashes y ramas ready.

Entrega 1.7.265: políticas de bytes/revisiones, visibilidad por cuenta y nombres del libro seleccionado en Rust. 143 específicas y cuatro E2E finales pasan. Inventario 61,03 %, no funciones terminadas. Se preservan getters, símbolos, __proto__ como dato, errores con causa, receptores y liberación de handles. El adaptador compartido se llama ahora book-data-native.js. Siguiente: biblioteca y coordinación de la aplicación; preservar todos los WIP/stashes y ramas ready.

Entrega 1.7.264: recuento completo multilingüe, selección/limpieza de parsers, cola serial y metadatos compartidos UI/Shelf en Rust. 236 específicas finales y ocho E2E verificadas pasan; alcance de las dos ejecuciones y del escenario corregido en remaining-wip-verification.md. Inventario 60,93 %, no funciones terminadas. El contador agrupa respuestas Intl y conserva el contexto UTF-16; Drive no requiere cargar Shelf ni espera dentro de IDB. Siguiente: políticas de almacenamiento y coordinación de la aplicación. Conservar todos los WIP/stashes y ramas ready.

Entrega 1.7.263: física tranquila, agarre vertical animado, límites reales de madera/BAGGEBO y cinta un 40 % más ancha situada en una sola página; todo en Rust. 114 específicas y seis E2E finales pasan. Inventario 60,35 %, no funciones terminadas. Después: retomar el WIP book-length y corregir la dependencia UI/Shelf de metadatos Drive y el coste de segmentación antes de publicar el contador. Conservar todos los worktrees/stashes.

Entrega 1.7.262: estado, cambios de vista, actualizaciones diferidas y limpieza de la pantalla en Rust. 6465/6466 pruebas generales verificadas (queda el timeout de colores preexistente) y 12 E2E finales pasan. Inventario 60,29 %, no funciones completadas. Se conserva la destrucción repetida y se comprueban los escenarios estáticos por separado de las colisiones. Ver alcance de las pruebas en remaining-wip-verification.md.

Entrega 1.7.261: preparación y sustitución de calidad del zoom en Rust, repintados agrupados, portadas tumbadas nítidas y zonas táctiles de lámparas sin esquinas vacías. 80 pruebas específicas pasan. Inventario 59,92 %, no funciones completadas. Detalle en remaining-wip-verification.md. Se continúa con lifecycle y resto de migración.

Entrega 1.7.260: cuerpos rígidos y agarre elástico en Rust, contactos, pilas, pérdida de apoyo y asentamiento al cargar bibliotecas. 39 pruebas finales, 26 sesiones anteriores de herencia y tres E2E pasan. Alcance exacto en remaining-wip-verification.md. Inventario 59,77 %, no funciones completadas. Se retoma zoom y resto de migración.

Entrega 1.7.259: pausas entre párrafos reales, saltos PDF y espacios CSS; años contextuales en más idiomas. 348 pruebas y dos E2E pasan. Inventario 59,71 %, no funciones completadas. Siguiente: física de colisiones en Rust, zoom y migración.

Entrega 1.7.258: contacto y caída amortiguada de libros en Rust, separación predeterminada cero y plantas altas ajustadas dentro de sus lejas. 225 pruebas finales y cuatro E2E pasan; general de 6420 casos distintos cerrada con reverificación, salvo un timeout preexistente de color. Detalle y alcance del binario final en remaining-wip-verification.md. Inventario **59,70 %**, no funciones completadas. Se retoman pausas y zoom.

Entrega 1.7.257: fechas y cantidades diferenciadas en Rust; años ingleses con lectura por pares según contexto. 146 pruebas específicas y dos E2E pasan. Inventario **59,67 %**, no funciones terminadas.

Entrega 1.7.256: margen vertical de EPUB/PDF reducido y caché de alturas renovada. 25 pruebas específicas y seis comprobaciones de navegador pasan; página móvil ocupa los 704 px disponibles con 4 px interiores arriba y abajo. Se cierra la verificación del audio: 6397/6398 pruebas generales pasan, con un timeout ya conocido ajeno al audio, y dos E2E finales pasan. Inventario **59,64 %** Rust; no mide funciones terminadas.

Entrega 1.7.255: años y enteros escritos en el idioma de la voz antes de síntesis, y referencias de notas omitidas. Conserva texto, cachés, resaltado y marcas de página originales. 362 pruebas específicas pasan con el binario final; 18 E2E pasan antes de los tres ajustes finales, cubiertos por las específicas. Publicación adelantada por petición expresa mientras continúa la batería general; detalle y límites en remaining-wip-verification.md. Inventario 31465 Rust/21292 JS, **59,64 %**; no mide funciones terminadas.

Entrega 1.7.254: corrección del audiolibro en Rust para omitir marcas decorativas como § manteniendo el resaltado. 261 pruebas específicas y dos E2E pasan. Inventario 31305 Rust/21292 JS, **59,52 %**; no mide funciones terminadas. Se retoma el zoom isométrico.

Entrega 1.7.253: filas y estados de la pantalla, controles de libros/plantas/lámparas y gestión de sus entradas en Rust, con reenvío DOM mínimo y sin retener nodos desde Rust. Inventario 31299 Rust/21292 JS, **59,51 %**; no mide funciones terminadas. 678 pruebas específicas pasan; la batería completa tiene un fallo de tiempo reproducido también en main 1.7.252. Detalle y pendientes en remaining-wip-verification.md.

Entrega 1.7.252: render de la pantalla, medidas, refresco/adopción de metadatos, preparación de portadas y preferencias en Rust; se conservan los receptores de callbacks y la apertura capturada al construir. Inventario 30881 Rust/21744 JS, **58,68 %** (1.7.251: 57,95 %); no mide funciones terminadas. Los builders y controles DOM, app.js y otros módulos siguen pendientes. Detalle y límites en remaining-wip-verification.md.

Entrega 1.7.251: libro extraído, editor, retorno, portadas, objetos, arrastre y papelera de la pantalla de estantería en Rust. Inventario 30436 Rust/22088 JS, **57,95 %** (1.7.250: 50,96 %); no mide funciones terminadas. Los constructores/render/refresco y app.js siguen en JS. Pruebas, equivalencia y límites en remaining-wip-verification.md.

Entrega 1.7.250: cámara, encuadre, zoom y posiciones/cinemática de la escena en Rust; Three.js, WebGL y DOM siguen como host. Inventario 25736 Rust/24771 JS, **50,96 %** (1.7.249: 49,82 %); no mide funciones terminadas. Detalle, pruebas y límites en remaining-wip-verification.md.

Entrega 1.7.249: plantas completas, lámparas y la decisión y orientación de sus luces en Rust (sin gemelos JS de la geometría de
plantas y lámparas ni de los seis kernels decor correspondientes). Inventario 24758 Rust/24933 JS, **49,82 %** (main 1.7.248: 46,93 %); no mide
funciones terminadas. Detalle en remaining-wip-verification.md.

Entrega 1.7.248: modelo del libro (geometría de cinta, páginas, hojas y lomo, vista y fotogramas,
pose, movimiento con su reloj y texturas de papel y tapa) en Rust, sin copias JavaScript detrás.
Inventario 22958 Rust/25963 JS, **46,93 %** (main 1.7.247: 45,38 %); no mide funciones terminadas. Detalle en
remaining-wip-verification.md.

Entrega 1.7.247: carpintería del armario, BAGGEBO completo y primeras texturas de plantas en Rust (sin gemelos JS de
armario, BAGGEBO ni pintores de respaldo de plantas y lámparas). Inventario 21940 Rust/26412 JS, **45,38 %**; no mide
funciones terminadas. Detalle en remaining-wip-verification.md.

Entrega 1.7.246: portadas (lomo, rotulación, editor, reflejo y relieve) en Rust.
Inventario 20086 Rust/27342 JS, **42,35 %**; no mide funciones terminadas. Detalle
en remaining-wip-verification.md.

Entrega 1.7.245: lectores PDF y EPUB, instantáneas de página y controlador del lector
en Rust. Inventario 19071 Rust/28927 JS, **39,73 %**; no mide funciones terminadas.
Detalle en remaining-wip-verification.md.

Entrega 1.7.244 (voz sobre la 1.7.243): motor de voz
(limpieza del audio, tempo, hebreo y flujo por fragmento) en el núcleo `voice`, y
catálogo y texto de narración en `rust-ui`. Inventario 13668 Rust/32156 JS,
**29,83 %**; no mide funciones terminadas. Detalle en remaining-wip-verification.md.

Entrega 1.7.243: Drive, copia de la biblioteca, carpeta local e importación Android en
Rust (cliente de Drive con PKCE, conciliación y cola de progreso, registros por campo, buzón
de intents, firma del documento desplegado). Inventario 13159 Rust/32717 JS, **28,68 %**;
no mide funciones terminadas. Detalle en remaining-wip-verification.md.

Entrega 1.7.242: estantería (gestos, zoom, luz, ajuste de baldas, papelera,
retorno del libro y política del arrastre) en Rust, con un módulo `shelf` que carga
la cabecera de la página. Inventario 11293 Rust/33595 JS, **25,16 %**; no mide
funciones terminadas. Detalle en remaining-wip-verification.md.

Entrega 1.7.241: estantería, medidas y colores de lomo desde Rust (tablas del
catálogo, paleta, tipos de estantería, lámparas, plantas y macetas, disposición
en baldas, secciones, marcapáginas, colores y marco). Inventario 8949 Rust/34509
JS, **20,59 %** (20,45 % sin contar la reclasificación de `plants.js`); no mide
funciones terminadas. Detalle en remaining-wip-verification.md.

Entrega 1.7.240: controlador del catálogo y rutas del follaje en Rust. Inventario
7908 Rust/35190 JS, **18,35 %**.

Entrega 1.7.239: lector sin gemelos JavaScript (bloque 2). Inventario 7527
Rust/35343 JS, **17.56 %**.

Entrega 1.7.238: lector sin gemelos JavaScript (bloque 1). Inventario 7527
Rust/35498 JS, **17.49 %**.

Entrega 1.7.237: catálogo y página preparada solo en Rust. Inventario 7527
Rust/37521 JS, **16.71 %**.

Entrega publicada 1.7.234: clasificación y cobertura de colores en una pasada.
Inventario: 7478 Rust/38189 JS, **16.38 %**; no mide funciones terminadas.
6537 unitarias y una tanda de 72 E2E aprobadas sin reintentos.
Máscaras, colores y pausas iguales. Trabajo preparado CPU×4/10 colores:
50.70→40.40 ms; no mide velocidad global ni un teléfono físico.
Web 234 y APK real verificados: 109 recursos, 2 PDF, 18 escena/editor,
3 perfil y audio Android 2×. CI 234 falla en cierres de 8 s y una captura
del lector inestable; todos los pesos reales pasaron. CI 232 aprobada.
Los fallos originales y los prototipos más lentos se conservan.
Detalle de pruebas, límites y publicación: remaining-wip-verification.md.

Base descargada con `git fetch origin --prune`: `c83add7`, igual que el checkout
local limpio. La aplicación contiene 146 módulos JavaScript propios y unas
33.000 líneas no vacías. Esta integración migra cálculos concretos; **no es la
reescritura completa solicitada**. Pantallas, estado, persistencia, clientes de
Drive, la mayor parte de la geometría y la orquestación de los lectores todavía
necesitan su migración.

## Código ejecutado en Rust

- Reconocimiento de fuente de portada: puntuación completa de cada máscara.
  El worker conserva una imagen en la memoria WASM durante todo el trabajo;
  copia las máscaras por candidato y libera cada asignación temporal.
- PDF adaptable: elección de cortes entre columnas, detección de tablas y
  puntuación geométrica. Se devuelven las mismas referencias a las líneas,
  conservando texto, offsets UTF-16, párrafos y metadatos de PDF.js.
- Relieve: distancia interior, desenfoque, normales, mapa de materiales y
  recomposición independiente de las capas de color. Los buffers de salida son
  nuevos, se conservan los puntos de cancelación y se libera la memoria al salir.
- Marcapáginas: topología, posiciones, UV y normales. Se reutilizan los atributos
  de Three y unos 12 KB compartidos; las funciones trascendentes siguen en el
  host para conservar exactamente sus redondeos. Una pose combinada actualiza
  una sola vez la malla, con buffers de geometría idénticos en las comparaciones
  ejecutadas y sin cambiar los tiempos configurados de animación.

El núcleo no tiene dependencias Cargo, imports de funciones JavaScript, DOM,
acceso a cuentas, red ni archivos. Se compila con Rust 1.99.0, optimización 3 y
LTO. Los acumuladores mantienen el orden de cálculo en f64 y los mapas mantienen
los mismos redondeos f32 y Uint8Clamped que la implementación anterior.

## Integración y funcionamiento sin conexión

`npm run build:rust` genera `src/wasm/inhouse_read_core.wasm`; no se versiona un
binario suelto que pueda quedar obsoleto respecto a su fuente. Vite publica el
WASM con hash y el manifiesto offline incluye esos bytes y su SHA256. El APK
sigue cargando la web publicada desde su loader.

La carga no retrasa el primer fotograma ni los mensajes del worker. Mientras
se prepara o si el navegador no lo admite, sigue disponible el algoritmo
anterior. Las pruebas comparan directamente el WASM real, por lo que esa vía de
compatibilidad no puede ocultar un fallo del port.

## Evidencia inicial

Guardada en `D:/CodexEvidence/InhouseRead-20261011/rust-migration/`.

- Primera batería focal: 72 pruebas aprobadas en siete archivos.
- Segunda batería de relieve y worker: 32 aprobadas, incluidas comparaciones
  exactas de buffers de hasta 512 × 512, diez capas, cancelación y crecimiento
  de memoria entre fragmentos. El primer intento de relieve falló al resolver
  una URL de archivo en jsdom; se conserva ese fallo y el nuevo intento usa Node.
- Benchmark de fuentes en Node/Windows, i5-10600K: 15 tandas alternadas tras
  cinco calentamientos, 72 candidatos por tanda. Medianas 81,0006 ms JS y
  62,2661 ms Rust, incluyendo carga de la imagen por trabajo y copias de máscaras.
  Inicialización medida aparte; salida exacta antes y después de cada tanda.
  Memoria viva tras liberar el trabajo: 0 bytes; capacidad WASM estable después
  del calentamiento. Es una medición del cálculo en escritorio, no de Android
  ni del tiempo completo de abrir/cerrar un libro.

## Mediciones del núcleo final

WASM: 47.615 bytes, SHA256
`aaf8bd79b66a14b6528a51f4f43bdda89e8f57b4f6d66b84c63fca7568c041e8`.
Se normalizan las rutas de diagnóstico del compilador para que Windows y Linux
generen el mismo contenido. Los avisos de la biblioteca estándar se distribuyen
en `public/licenses/rust-1.99.0-library.html`.
Las mediciones incluyen copias de entrada/salida y asignaciones; se conserva
igualdad exacta con las implementaciones anteriores antes de cronometrar.

| Cálculo | JS, mediana | Rust, mediana | Entorno |
| --- | ---: | ---: | --- |
| 72 máscaras de fuente | 80,76 ms | 61,04 ms | Node, i5-10600K |
| 177 marcapáginas nuevos | 5,49 ms | 1,97 ms | Node, i5-10600K |
| 177 actualizaciones de marcapáginas | 4,16 ms | 1,10 ms | Node, i5-10600K |
| Distancia del relieve | 22,8 ms | 19,4 ms | Chromium, CPU ×4 |
| Desenfoque del relieve | 11,7 ms | 9,4 ms | Chromium, CPU ×4 |
| Normales del relieve | 49,8 ms | 27,8 ms | Chromium, CPU ×4 |
| Material del relieve | 25,1 ms | 15,7 ms | Chromium, CPU ×4 |
| Capas del relieve | 33,4 ms | 18,1 ms | Chromium, CPU ×4 |

Los relieves usan 384 × 512 píxeles y viewport 390 × 844. CPU ×4 es una
simulación de escritorio, no una medida de teléfono. En PDF el primer ensayo
detectó regresiones por copias: se conservaron los resultados y se eliminó ese
coste en páginas sin cortes posibles, con arena reutilizable de hasta 64 KiB
para las demás. El ensayo posterior conserva las particiones exactas en las
15 disposiciones. Las mediciones pequeñas están limitadas por la resolución
del reloj; no se interpretan tiempos redondeados a cero como coste nulo.

Primera batería completa: 3.727 pruebas/304 archivos aprobados, anterior a la
integración final del marcapáginas. Batería final: **3.749 pruebas/306 archivos
aprobados**, más 64 pruebas directas de kernels e integración tras normalizar
las rutas de diagnóstico del WASM. Python/Android: 105 aprobadas con el Python
incluido en el entorno. Build de producción aprobado: 98 archivos en el shell
sin conexión. Los siete recorridos originales locales pasan al primer intento:
regreso frontal/isométrico, interrupción por viewport, editor móvil, reserva sin
WebGL, ambos contratos de framebuffer nativo y gesto isométrico. Mantienen sus
plazos originales y no se aplican retries. Publicación pendiente de registrar.
Los dos timeouts E2E de 1.7.115 y la falta de medición en un teléfono físico
siguen como antecedentes pendientes. Estos resultados no demuestran una mejora
equivalente de la aplicación completa, del trabajo GPU, de batería o temperatura.

## Trabajo necesario para completar la solicitud

1. Migrar la lógica propia de biblioteca, lector, editor, gestos y audio,
   manteniendo los contratos de almacenamiento, DOM y plugins de Android.
2. Migrar la generación de geometría, materiales y escena conservando las
   coordenadas, texturas, reflejos, resolución y tiempos visibles.
3. Sustituir las implementaciones JavaScript restantes con pruebas de igualdad
   frente a la base, conservando únicamente los adaptadores de plataforma y las
   dependencias externas que sean necesarias.
4. Medir recorridos completos y consumo en Android real. Un benchmark de
   cálculos no demuestra por sí solo la fluidez global solicitada.

La revisión de rendimiento también detecta un caso pendiente en
`bookshelf-scene.js`: `bookPresentationScheduled` no vuelve a liberarse cuando
se cancela o falla la preparación diferida de los programas. El arreglo debe
permitir reintentar en el siguiente repintado estable ya requerido, sin crear
bucles de repintado ni temporizadores. No se ha modificado en esta entrega ni
se ha demostrado que explique los timeouts anteriores de CI.

## Continuación 1.7.117: lomo curvo y recuperación de preparaciones

**La migración sigue siendo parcial.** Esta continuación añade la generación
de posiciones, normales, UV e índices del lomo curvo a Rust; no sustituye las
pantallas, Drive, persistencia, lector, audio ni el resto de la escena. Conserva
la resolución de las mallas, materiales, cámaras y tiempos configurados. La
igualdad comprobada corresponde a los buffers y contratos ensayados; no es una
garantía absoluta sobre todos los píxeles o dispositivos.

El host conserva la trigonometría y el muestreo del relieve en el mismo orden.
Rust calcula la malla y las normales del grabado. El adaptador devuelve arrays
propios, libera la memoria temporal y los entrega directamente a los atributos
de Three. Se comprueba también el salto a índices de 32 bits cuando el índice
65.535 requiere reservar el valor de reinicio de primitivas.

### Mediciones del lomo

WASM de esta continuación: **49.932 bytes**, SHA256
`53cec33c06a184b510e2706cc387ad212e5ffc5c0ed86b672715be7f941ec3ee`.
Los ocho adjuntos de navegador, el benchmark Node y el archivo compilado local
coinciden en tamaño y hash. Los 32 hashes de posiciones, normales, UV e índices
coinciden entre el original, el puente Rust directo y la ruta de producción;
también coinciden entre Node y Chromium en estos ocho casos.

Cada comparación usa cinco calentamientos y quince tandas con orden alternado.
Incluye asignación y liberación, funciones del host, muestreo del relieve,
copias de entrada/salida, instalación de atributos e índices y disposición de
la geometría. No impone un umbral de velocidad para aprobar. Los casos pequeños
agrupan 64 o 128 geometrías por tanda; el grabado de estantería agrupa cuatro.
La tabla divide la mediana de cada tanda por ese número y muestra **milisegundos
por geometría**.

| Caso | Node JS → Rust | Chromium CPU ×4, JS → Rust |
| --- | ---: | ---: |
| Lomo sin grabado, 96 segmentos | 0,0231 → 0,0131 | 0,1375 → 0,1047 |
| Estantería sin grabado, 32 segmentos | 0,0097 → 0,0063 | 0,0633 → 0,0508 |
| Vista general sin grabado, 16 segmentos | 0,0069 → 0,0050 | 0,0383 → 0,0320 |
| Compatibilidad sin grabado, 12 segmentos | 0,0057 → 0,0050 | 0,0336 → 0,0305 |
| Grabado de estantería, 32 × 96 | 0,9698 → 0,2644 | 3,5500 → 1,3000 |
| Grabado detallado, 96 × 384 | 12,1270 → 2,8104 | 34,6000 → 11,8000 |
| Relieve suave detallado, 96 × 384 | 14,3926 → 4,6688 | 39,8000 → 17,8000 |
| Límite de índices de 32 bits, 255 × 255 | 25,3979 → 5,2575 | 73,7000 → 21,5000 |

Node 24.13.0 ejecuta en Windows con i5-10600K. Chromium usa viewport
390 × 844, DPR 2, entrada táctil y ralentización CPU ×4 en escritorio. Los
patrones son una máscara binaria determinista y un relieve trigonométrico
cuantizado. No se mide dibujo GPU, una sesión completa de la aplicación,
temperatura, batería ni rendimiento en un teléfono físico.

El puente directo llama al export real una vez por caso: ocho llamadas,
ocho asignaciones y ocho liberaciones comprobadas; quedan **0 bytes temporales
asignados** después de cada llamada. El pico temporal del grabado detallado es
2.382.424 bytes y el caso adicional de índices de 32 bits alcanza 4.192.280.
Esto no significa consumo total cero: los arrays de salida pertenecen a Three
y la capacidad de la memoria WASM puede conservar su máximo. La ejecución
Node completa termina con capacidad de 8.060.928 bytes; los contextos Chromium
independientes llegan hasta 5.308.416 bytes. Inicialización Node medida aparte:
0,555 ms para compilar/instanciar y 0,891 ms para la primera geometría.

Fuentes: `binding-benchmark-attempt1.json` y los ocho adjuntos
`rust-binding-browser-observation.json` de `binding-browser-attempt1.json`,
en el directorio de evidencias indicado arriba. Se conservan todas las muestras,
medianas, percentiles 95 y totales, incluidos los casos con ahorro pequeño.

### Fuentes tardías y preparación cancelada

La llegada de una fuente renueva las texturas de texto de los modelos retenidos
sin sustituir los botones, su foco ni la geometría de la estantería. La ruta de
canvas anterior actualiza únicamente su imagen. La regresión con un WOFF2 real
falla contra la web 1.7.116 publicada porque desconecta el botón enfocado y
sustituye los nodos; el mismo caso pasa con el build local 1.7.117. Se conservan
ambas ejecuciones en `font-public116-regression.json` y
`font-browser-attempt1.json`.

También se corrige el caso de preparación diferida descrito al final del
apartado 1.7.116: una cancelación o error vuelve a permitir el intento en el
siguiente repintado estable ya necesario. Completar o cancelar esa preparación
no crea temporizadores ni repintados adicionales. No se atribuyen a este cambio
los timeouts de CI sin una observación que demuestre esa relación.

### Estado de verificación

1.7.116 sí se publicó posteriormente: fuente
`dbd6205ed7580c1b5717638533e3aff27ed5536b`, Pages
`0f586bb1c6234306e26ebc6db1f977093fdc083f`. Se comprobaron 100 respuestas HTTP,
98 recursos sin conexión y 866 condiciones. Sus recorridos públicos quedaron
en **21/22**, con el fallo anterior al toque que motivó la corrección de fuentes.
La CI completa de 1.7.116 conserva dos timeouts de regreso nativo distintos de
ese fallo; no se han relajado los plazos ni convertido esos resultados en PASS.

La [verificación del APK público](https://github.com/miguelcoxcaballero/inhouse-read/actions/runs/38141440469)
aprobó los cinco estados nativos. Se auditaron el ZIP original y las capturas,
la política de barras/pantalla encendida y el APK 1.1.8 de 78.531.695 bytes con
SHA256 `5d10e6555c5c05e59925d18d5e0c959a08d8e41761a5aad37832c9d40d8e7eb1`.
Google muestra el formulario real de acceso; no se autenticó una cuenta humana.
La política de regreso se confirmó en la tercera muestra a 22,256 s, lo que no
acredita un cierre fluido ni el contrato separado de ocho segundos del navegador.

Para 1.7.117 pasan las 82 pruebas focales de geometría e integración, las
19 de recuperación de preparación, los ocho casos de geometría en Chromium,
la regresión real de fuentes, los siete recorridos originales locales y las
105 comprobaciones Python/Android. La batería unitaria completa de 1.7.117
aprobó **3.774 pruebas en 307 archivos**. Se publicó la fuente
`e137376068b82bc7051e85754c755b8334b3916d`, Pages
`bd5e3531b702e265d0169ff48f14a8eccbc88b26`: 100 respuestas HTTP,
98 recursos y 871 condiciones correctas. Sus **23 recorridos públicos** pasan
sin omisiones ni reintentos, incluidas fuentes tardías, ambos regresos nativos,
contenido PDF adaptable y funcionamiento sin conexión. El auditor inicial
rechazó adjuntos JSON con cuerpos base64 por esperar rutas de archivo; la
segunda versión audita esos mismos originales, sin repetir el navegador ni
sustituir los bytes. Ambos informes se conservan.

El [APK sobre la web 1.7.117](https://github.com/miguelcoxcaballero/inhouse-read/actions/runs/38143049356)
también aprobó sus cinco estados nativos. ZIP original de 8.942.303 bytes,
SHA256 `e6b3842782f367dd65473802e51ffded09e25eb83108169c3c8032ea3e2a60c3`.
Mantiene el mismo APK público 1.1.8; la captura final muestra el libro en su
estante. La política final se confirmó a **41,44 segundos** en ese emulador:
no acredita fluidez, el contrato de ocho segundos del navegador ni velocidad
en un teléfono físico. La CI completa 1.7.117 terminó con **542/545 casos
estrictos aprobados, dos fallos y uno inestable**: 548 intentos, tres reintentos,
sin casos omitidos, duplicados ni errores de colección. Se autenticaron los
once ZIP y las fuentes de doce jobs. Conserva los dos timeouts de regreso
nativo y un caso de importación Android que sólo pasa al reintentarse. En este
último, el observador de la aserción llegó después del estado transitorio de
cierre; el original sigue siendo un fallo estricto. No se han ampliado plazos.

## Continuación 1.7.118: páginas tridimensionales

Rust construye ahora el bloque de páginas cerrado y las hojas que se ven
durante la apertura. Conserva posiciones, normales, UV, colores por vértice,
índices, grupos de materiales y versiones de los atributos. Las resoluciones
originales no se reducen. El host conserva `Math.pow` y `Math.hypot` para
mantener sus redondeos; Rust escribe el resto de los atributos e índices.
La memoria temporal se libera en `finally`; las salidas tienen buffers propios.

WASM: **57.210 bytes**, SHA256
`98cbdc0ffce776f0ee8b02340b1ca6913e50a94f1908c2bc84d749d99d709ffe`.
Las 101 comprobaciones focales pasan: 15 de páginas, 12 de lomo curvo y
74 de integración de modelos. Incluyen dimensiones deterministas aleatorias,
grupos, ceros con signo, crecimiento de memoria, operaciones anidadas y fallo
de asignación. Ocho casos en Chromium ejercitan el export WASM real, el puente
y la ruta de producción, con igualdad exacta frente al código previo congelado.

| Malla | Node JS → Rust (ms) | Chromium CPU ×4, JS → Rust (ms) |
| --- | ---: | ---: |
| Bloque de estantería | 0,0285 → 0,0089 | 0,1188 → 0,0516 |
| Bloque detallado | 0,0427 → 0,0125 | 0,2453 → 0,0953 |
| Bloque fino | 0,0454 → 0,0123 | 0,2625 → 0,0969 |
| Bloque ancho | 0,0477 → 0,0123 | 0,2844 → 0,1016 |
| Hojas en la primera página | 0,0248 → 0,0076 | 0,1297 → 0,0516 |
| Hojas a mitad del libro | 0,0270 → 0,0075 | 0,1188 → 0,0484 |
| Hojas finas | 0,0198 → 0,0063 | 0,1031 → 0,0391 |
| Hojas anchas | 0,0329 → 0,0102 | 0,2094 → 0,1000 |

Medianas por geometría, incluyendo coeficientes, asignaciones, copias y creación
y liberación de la geometría de Three. Node usa cinco calentamientos y quince
tandas alternadas de 128 geometrías; Chromium, tres calentamientos y diez tandas
de 64. El máximo temporal es de 15.304 bytes, una asignación y liberación por
caso, sin asignaciones temporales vivas al terminar. La capacidad WASM permanece
en 1.179.648 bytes y los arrays de salida siguen vivos mientras los usa Three.
Son cálculos pequeños: **no demuestran una mejora equivalente en FPS ni una
reescritura completa de la aplicación**. Evidencia: `page-mesh-benchmark-attempt1.json`
y `page-mesh-browser-attempt1.json`.

También se conserva el filtrado anisotrópico de las texturas al regenerar el
texto del lomo. Antes la sustitución restablecía el valor a uno, perdiendo nitidez
en ángulo. Cuatro regresiones con modelos reales comprueban valores independientes
del color y del mapa de materiales, propiedad de los buffers y disposición única.

Build de producción y batería completa 1.7.118 aprobados: **3.793 pruebas en
308 archivos**, más 105 comprobaciones Python/Android. Pasan ocho recorridos
locales al primer intento, sin cambiar plazos ni aserciones: devolución en ambas
vistas, cancelación por viewport, fuente real tardía, editor móvil, compatibilidad
sin WebGL, ambos contratos nativos y gesto isométrico. Se publicó después la
fuente `b57b5ee8aea3890a6dddc4b0d3124c0419809cae`, Pages
`8beed00129527ef4aeca9a357353dbd3b4f5aa04`. Los **23 recorridos públicos**
pasaron y sus respuestas reales de entrada fueron auditadas contra el artefacto
fijado. Las 100 respuestas HTTP guardadas coinciden con Pages y el build118.
El primer verificador conservó dos fallos porque comparó esos bytes118 con el
núcleo local119, ya compilado: la auditoría posterior usa los mismos originales
y el dist118 preservado, con 742 comprobaciones correctas y ninguna nueva
petición. Ambos informes se conservan; no se reescribe el resultado fallido.
La comprobación nativa38144600262 aprobó el APK, su cargador de 2.107 bytes,
los cinco estados de pantalla y el formulario real de Google. La política de
regreso se observó a 39,555 s, todavía con el libro en plena animación: no prueba
su inserción final ni fluidez. Se conservan cuatro errores previos de captura.
La CI118 completa conserva **550/553 aprobados estrictos, dos fallos y uno
inestable**: 556 intentos y tres reintentos. Once ZIP autenticados, doce jobs,
sin omisiones, duplicados ni errores de colección. Son los dos regresos nativos
y la importación Android ya descritos; las cuatro suites de voces pasan.

## Continuación 1.7.119: color de portada y página de cierre

El agrupamiento del color dominante pasa a Rust. Se conservan el muestreo por
filas, el umbral alfa, la elección del primer centro en los empates, las siete
iteraciones y el redondeo final de JavaScript. Sólo cruza el puente la muestra
RGBA, con arena limitada a 32.768 candidatos, sin retener la imagen completa.
El analizador carga el adaptador sin detener la decodificación de la portada;
la ruta previa permanece disponible mientras el núcleo se prepara.

El cierre usa directamente el canvas independiente que entrega el lector para
su capa de página inmóvil y para la textura de WebGL. Evita una copia completa
de píxeles. La alternativa sin WebGL conserva una copia separada porque necesita
dos propietarios DOM. Se mantienen las dimensiones, la página, las imágenes,
el tema, el orden de persistencia y los tiempos configurados de las animaciones.

Núcleo preparado: 58.598 bytes, SHA256
`04438e836e131ca5ca91ea4c2efaa999928c9ff228ced411dce9ec8f98f50ec6`.
Primera comprobación focal: 48 pruebas en cuatro archivos aprobadas. La batería
unitaria final aprueba **3.825 pruebas en 310 archivos**, más 105 comprobaciones
Python/Android. Los ocho recorridos originales locales pasan al primer intento
con sus plazos y aserciones originales. Las mediciones y recorridos focales se
detallan abajo junto a la publicación119. No certifica una reescritura
completa ni una mejora global de rendimiento.

### Mediciones y propiedad de la página

Las diez comparaciones del segundo ensayo conservan exactamente los RGB.
Las nueve muestras con píxeles incluidos usan el export Rust real, una llamada,
una asignación y una liberación por imagen. La muestra cuyos puntos son todos
transparentes utiliza expresamente la salida previa del host; no se atribuye
su resultado a Rust. Se añadió además otra muestra con alfa mixto dentro de
los puntos muestreados.

| Caso | Node JS → nueva ruta (ms) | Chromium CPU ×4, JS → nueva ruta (ms) |
| --- | ---: | ---: |
| Color uniforme | 0,6857 → 0,1114 | 2,8375 → 0,5375 |
| Dos tintas | 0,7056 → 0,1168 | 2,8625 → 0,5313 |
| Colores fotográficos sintéticos | 0,8274 → 0,1589 | 3,5250 → 0,8188 |
| Degradado | 0,7227 → 0,1209 | 2,8938 → 0,5625 |
| Muestra vacía, sin Rust | 0,0041 → 0,0052 | 0,0313 → 0,0562 |
| Transparencia mixta | 0,4605 → 0,0934 | 2,0063 → 0,4500 |
| Miniatura | 0,2684 → 0,0441 | 1,2563 → 0,2125 |
| Límite de muestreo cada píxel | 2,6748 → 0,5476 | 12,5563 → 2,4625 |
| Muestreo cada dos píxeles | 0,6518 → 0,1229 | 2,7562 → 0,5813 |
| Portada horizontal | 0,7222 → 0,1199 | 2,9063 → 0,5875 |

Son medianas por portada, incluyendo validación, muestreo, copias y memoria.
Node usa cuatro calentamientos y quince tandas alternadas de 32 portadas;
Chromium, tres calentamientos y diez tandas de 16. Se conserva visible el pequeño
sobrecoste de validación del caso vacío, así como el primer ensayo, donde ese
caso se enviaba innecesariamente a Rust. El pico temporal medido es de 28.712
bytes; la imagen habitual de 192×288 utiliza 9.072. No quedan arenas temporales
vivas, aunque WASM conserva su capacidad de 1.179.648 bytes. Estos ensayos no
miden decodificación, GPU, autonomía ni fluidez global en un teléfono.

Pasan doce casos Chromium: los diez anteriores y dos que cargan módulos HTTP,
decodifican PNG reales y exigen llamadas al núcleo durante el análisis de
producción. El segundo retiene la descarga real del WASM: la portada sigue
analizándose mientras espera y utiliza Rust al estar disponible. También pasan
cuatro cierres reales con PDF físico, PDF adaptable ilustrado en sepia, EPUB y
compatibilidad sin WebGL: comprueban identidad de la fuente, píxeles completos,
propiedad DOM durante la entrega y retirada de las capas al terminar. Sus
lecturas de píxeles verifican funcionalidad; no se usan como medida de velocidad.

Evidencia: `cover-color-benchmark-attempt2.json`, `cover-color-browser-attempt2.json`
y `reader-return-canvas-attempt1.json`. El intento unitario2 se conserva fallido:
su observador esperaba una copia WASM aun en una muestra vacía. Ahora comprueba
la ausencia de copia en esa rama y añade un único píxel incluido para comprobar
el orden completo de entrada al núcleo. El intento3 aprueba las 31 pruebas.

119 se subió a main `110d70ed8aba44d6ce8e3a0119578c4caef5a2bb`, Pages
`afba86d6aea4ac4fe2f1f30c65b90cedd9a594cb`. El verificador de las respuestas
reales aprueba **101 descargas, 99 recursos del shell y 889 condiciones**.
Esta vez el build local119 se congeló antes de compilar el siguiente núcleo;
su identidad no depende del estado posterior del checkout. CI119 todavía está
en curso. Los **27 recorridos públicos** pasan al primer intento,
con 27 respuestas de entrada reales auditadas contra el artefacto publicado.
El APK38145829318 mantiene firma, tamaño y cargador; sus cinco estados nativos
pasan y la captura final muestra el libro en su hueco. La política final se
confirmó a 34,939 s en la sexta muestra, conservando cinco errores anteriores:
no prueba una mejora de velocidad ni comportamiento en un teléfono físico.

## Preparación 1.7.120: clasificación de varios colores

La clasificación de las zonas del relieve prepara una vez los valores OKLab
de la imagen y usa Rust para calcular las pertenencias a cada color. Conserva
los umbrales alfa, los radios, los empates y el orden de los cálculos. El host
mantiene `Math.cbrt` para conservar sus redondeos exactos. Una arena por trabajo,
limitada a 512×512 píxeles, se libera antes de componer los mapas; otra tarea
concurrente usa inmediatamente la ruta previa. No se guarda una imagen extra
por libro. El WASM puede conservar la capacidad de memoria tras liberarla.

El candidato sólo prepara esa arena para tres o más colores y al menos 16.384
píxeles. Las imágenes pequeñas, uno o dos colores y el cambio de intensidad de
un relieve ya clasificado mantienen su ruta previa. El máximo temporal es de
6.557.696 bytes; una portada de 341×512 usa 4.368.896. Hay cancelación entre bloques
de 1.024 píxeles. Las vistas se recuperan tras crecer la memoria, también cuando
lo provoca el conversor del host; se rechazan entradas que compartan esa memoria.

Las primeras **28 pruebas unitarias** pasan con el WASM real y comparan máscaras,
propietarios, alturas físicas, brillo, metal, normales y materiales completos.
El ensayo Node conserva las salidas de catorce casos y registra, incluyendo
preparación, copias y liberación, 76,87→12,93 ms para diez colores en 341×512.
Un solo color pasa de 7,61 a 8,05 ms al forzar el candidato: por eso no se activa
en esa rama.

Los **28 casos Chromium CPU ×4** pasan con igualdad completa de mapas y uso
real del export. El proceso completo de mapas (tres tandas alternadas después
del calentamiento, incluyendo preparación y copias) registra estas medianas:

| Portada / capas | Ruta anterior (ms) | Nueva ruta (ms) |
| --- | ---: | ---: |
| Estantería / 3 | 70,9 | 42,5 |
| 341×512 / 3 | 280,8 | 154,0 |
| 341×512 / 10 | 916,7 | 284,8 |
| Fotográfica sintética 512×512 / 10 | 1.522,1 | 400,4 |
| Alfa disperso 341×512 / 10 | 658,8 | 233,8 |

Las ramas excluidas no llaman al clasificador Rust en producción: un color
89,6→90,5 ms, dos colores 182,5→190,1 ms y miniatura 35,7→38,1 ms en esta
muestra corta. No se presentan esas variaciones como mejoras. El mayor buffer
WASM retenido observado alcanza 9.109.504 bytes; cero arenas temporales vivas
al finalizar. Las comparaciones completas incluyen normales y materiales; los
tiempos de la tabla miden la construcción de mapas, sin decodificar imágenes,
pintar WebGL ni medir un teléfono. Batería final y publicación pendientes.

### Cierre en frío: reproducción y corrección

El primer regreso de un libro importado podía recibir un controlador de
estantería antes de que el análisis inicial creara su hueco. `returnToShelf`
resolvía false y el finally quitaba la página, sin recorrer la animación.
Ahora espera al análisis y al render semántico posterior. La espera se cancela
al cerrar o destruir el controlador, cambiar el viewport o marcador, borrar
el libro o perder su geometría; no añade sondeos ni espera el ajuste de fuentes.
Si el destino deja de estar disponible, se usa el fundido existente una sola
vez en lugar de retirar la página abruptamente.

La prueba usa una importación Android real del fixture PDF y una pausa explícita
en el análisis inicial. Un build de control sin la corrección falla: la página
ya no está conectada y el cierre terminó antes de liberar el análisis. El build
corregido pasa: los mismos píxeles permanecen visibles, se recorren zoom,
marcapáginas, cierre, regreso e inserción, y no quedan capas ni canvas sobrantes.
Se mantienen los bytes originales. No se cambiaron los plazos de los tests
nativos originales. El caso funcional nuevo no acredita velocidad ni FPS.

Evidencia: `cold-return-negative-browser-attempt3.json` y
`cold-return-fixed-browser-attempt1.json`. Dos intentos previos del servidor
de desarrollo quedaron interrumpidos antes de cargar app.js; se conservan,
pero no son evidencia del fallo de regreso. El fixture final compila con Vite
en un proceso Node separado y sirve ese build; conserva logs y perfil CPU.
La primera comprobación unitaria corregida encontró tres expectativas/mocks
inexactos: el contrato anterior llama onPageReady dos veces (el host es
idempotente) y returnToShelf devuelve booleano. Corregidos esos mocks, pasan
29 casos, incluyendo una sola retirada por cancelación y un solo reader.close.

La batería completa120 aprueba **3.863 pruebas en 312 archivos** al primer
intento; el build de producción termina correctamente. Núcleo de 59.215 bytes,
SHA256 `eb5d2ff07993ef68bad27d7d94796d4eaf044582d3bd9d6b425905a6f3487776`.

También pasan las 105 comprobaciones Python/Android y los ocho recorridos
originales locales al primer intento, conservando sus plazos y aserciones.
Publicación y CI120 pendientes.

120 publicada: fuente `0e728e6400504a01d0d28e621e3af3bb553c40ee`, Pages
`b31e57eb1bd337aa0728fb01eac76875fe01de4a`. Las respuestas HTTP reales
aprueban 101 descargas, 99 recursos y 889 condiciones; núcleo idéntico al
build120 congelado antes de preparar el siguiente candidato. Navegador
público, APK y CI completa todavía en curso.

La CI119 completa termina en **567/569 aprobados estrictos**, dos fallos y
ninguno inestable: 571 intentos, dos reintentos y cuatro timeouts. Los once
ZIP y doce jobs están autenticados, sin omisiones ni errores de integridad.
Los dos contratos nativos agotan el plazo global original30s; la traza
sitúa el clic Atrás entre23,72 y26,50s desde goto. Esto no demuestra que se
agotaran ocho segundos dentro del cierre. El resto de UI y las cuatro suites
de voces pasan. Evidencia: `ci-38145574809/snapshot-003/summary.json`.

## Candidato siguiente: colocación de objetos

Se implementó y comprobó el motor completo de posiciones/colisiones en Rust:
50 unitarias y 15 casos Chromium CPU ×4 conservan el resultado, metadatos y
orden exactos. **La integración universal no se publica** porque la inspección
y preparación de objetos cuesta más que el cálculo original en bibliotecas
pequeñas. En40 objetos, Chromium mide0,206→0,906ms al disponer y0,413→1,031ms
al mover; en1000,21,5→18,95ms y18,75→19,75ms respectivamente. Se conservan los
resultados en `placement-benchmark-attempt1.json` y
`placement-browser-attempt1-extracted.json`. Se prepara un contexto propio por
arrastre para amortizar la preparación, sin confiar en objetos externos mutables.
Todavía no tiene beneficio medido ni se considera una función terminada.

Los27 recorridos de la web120 pasan al primer intento (3,8min), con sus
27 respuestas reales auditadas contra la versión fijada. Incluyen los cuatro
cierres con comparación de píxeles y PDF/EPUB reabiertos sin conexión.
Auditoría sin nuevas peticiones: `public120-browser-attempt1/audits/2026-10-11T14-39-15-040158Z-18b7bcde/summary.json`.

### Verificación del APK existente con la web 120

El APK publicado 1.1.8 se verificó contra la web 120, fuente `0e728e6400504a01d0d28e621e3af3bb553c40ee` y Pages `b31e57eb1bd337aa0728fb01eac76875fe01de4a`, en la [ejecución 38147748555](https://github.com/miguelcoxcaballero/inhouse-read/actions/runs/38147748555). El APK descargado mantiene 78.531.695 bytes y SHA256 `5d10e6555c5c05e59925d18d5e0c959a08d8e41761a5aad37832c9d40d8e7eb1`; su entrada HTML sigue siendo sólo el cargador de 2107 bytes. No se ha publicado un APK nativo distinto para estos cambios web.

Los cinco estados de Android pasan la política de barra de estado y pantalla encendida. Se conservaron los cuatro muestreos de retorno previos que aún no cumplían esa política. La última captura del retorno muestra el libro todavía delante de la estantería, durante la animación: esta comprobación no certifica la inserción final, su duración ni su fluidez. La captura de Google alcanza la página auténtica de acceso; no incluye autenticación humana. Evidencia: `native-38147748555/policy-audit.json` y `visual-review.json`; ZIP original de 9.708.971 bytes, SHA256 `826cc53c2f0ff0792f33c4a16bf4ad51ae85a80f508c2a6c01bc03586f3bc014`.

La migración sigue siendo parcial. Estos resultados verifican la versión publicada y sus rutas observadas; no equivalen a haber reescrito toda la aplicación en Rust ni a una medición de velocidad en un móvil físico.

## Candidato 121: filas PDF y colocación durante el arrastre

Se traslada a Rust la agrupación completa de fragmentos PDF: líneas, medianas
ponderadas y separación horizontal. Las cadenas, pesos UTF-16 y transformaciones
siguen en el host; los resultados conservan todas las referencias, párrafos,
offsets y metadatos originales. La ruta se activa a partir de 128 fragmentos,
retiene como máximo 256 KiB de arena y libera las páginas mayores inmediatamente.

Pasan 12 unitarias específicas, 150 casos aleatorios en Node y 100 en Chromium.
El PDF real de dos páginas conserva sus 192 fragmentos por página, rotación de
90 grados e ilustraciones con colores originales. Las mediciones comparan también
la extracción exacta de 120, que ya tenía columnas Rust: en Chromium con CPU ×4,
128 fragmentos mixtos pasan de 8,075 a 2,075 ms, 512 de 44,1 a 11,6 ms y 4096
de 685,6 a 140,2 ms. En 128 párrafos sencillos ambos miden 1,925 ms.

El primer intento de navegador encontró un error de sintaxis en el test.
Corregido, pasan 26 casos. Al añadir la referencia exacta de 120, pasan 25/26:
el diagnóstico mayor completa y adjunta sus nueve rondas, pero agota el límite
global de 30 s. Se conserva ese fallo; los nuevos diagnósticos de cinco rutas
por nueve rondas usan 120 s. Esto calibra el trabajo de medición y no es una
mejora del producto ni un cambio de los contratos originales de lectura/cierre.
Evidencia: `pdf-rows-browser-attempt3{,-extracted}.json` y
`pdf-rows-benchmark-attempt2.json`.

La colocación Rust sólo se usa en las previsualizaciones del arrastre con al
menos 16 objetos, después de dos movimientos JavaScript. Copia un contexto propio
y lo descarta al terminar, cancelar, cambiar viewport/metadatos o destruir la
vista. Las API generales, disposición inicial y guardado final conservan su ruta
anterior. Pasan 25 escenarios Node y 25 Chromium, incluidos los casos que omiten
Rust y las liberaciones. En CPU ×4, 40 objetos/120 posiciones pasan de 32 a
13,7 ms y 200/120 de 180,9 a 59,9 ms por gesto. Para 40/8 hay sobrecoste:
2,85 a 3,55 ms. No se afirma una mejora en todos los tamaños ni en FPS.

La primera batería completa aprueba 3918/3919 casos: la comprobación nueva de
8192 objetos agota 5 s porque su aserción de identidad recorrió el input entero
por cada salida. Se indexan las mismas referencias una vez, conservando todos
los candidatos de claves repetidas y el plazo original. Su primer ajuste olvidó
el input no iterable del caso de compatibilidad; corregido, pasan sus 22 casos.
Los dos intentos fallidos se conservan. La batería completa final, build y
verificación publicada de 121 siguen pendientes.

Después de corregir únicamente esa aserción, pasan las **3919 pruebas en 317
archivos** con sus límites originales (98,96 s). El build de producción termina
en 5,58 s y se congela antes de continuar: núcleo de 135252 bytes, SHA256
`8d4f64f06e93a661293e4ba9cd97b95d9cc7946b72bbd354498828d1588569ff`,
99 recursos offline y manifiesto `d7e239b1adf5`.

La CI120 termina en **596/598 E2E estrictos**, dos fallidos, cero inestables;
600 intentos, dos reintentos y cuatro timeouts. Se autentican los once ZIP y
doce jobs sin omisiones ni errores de integridad. Los dos fallos corresponden
a los regresos nativos aligned/legacy; sus cuatro trazas muestran continuidad
y avance, pero el clic Atrás llega a los 24–27 s del plazo global de 30 s.
Esto no demuestra que el cierre aislado exceda ocho segundos. Evidencia:
`ci-38147505693/snapshot-003/summary.json`.

Los ocho recorridos locales originales de 121 pasan, incluidos los dos regresos
nativos con su límite global de 30 s y cierre de ocho segundos. La regresión de
importación en frío también pasa y adjunta sus diagnósticos de compilación.
El primer ensayo nuevo de arrastre apuntó a la segunda estantería física al
usar una fracción del canvas completo; esperaba la balda 1, pero apuntaba a la
4. La captura conserva ese fallo. El fixture usa ahora el centro proyectado
de un libro que está en la balda 1, manteniendo esa misma comprobación y los
movimientos reales del puntero. No se cambia el cálculo de destino del producto.

Con esa corrección de coordenadas, el recorrido real de arrastre pasa (36,2 s):
mueve libro y planta, comprueba la balda elegida y conserva las posiciones al
recargar. También pasan los dos recorridos originales de colocación. Las 105
comprobaciones Python/Android pasan. Evidencias locales:
`local121-browser-attempt1`, `local121-integration-attempt1` y
`local121-drag-attempt2`; se conserva el primer fallo del fixture.

121 se publica en `main` con fuente `d007399d192d5443dfbd24e3834f3835424a7a2d`
y Pages `017676413bf66218c43ba86ca3ea58dbab8ca3e8`. La primera comprobación
HTTP conserva 101 respuestas reales, valida los 99 recursos offline y pasa
891 condiciones, incluido el WASM idéntico al build congelado. Evidencia:
`public-121-2026-10-11T15-21-12-142Z-1ab89192/summary.json`.
Los 27 recorridos públicos pasan al primer intento (3,7 min), incluidos los
dos regresos nativos con sus plazos originales y PDF/EPUB reabiertos offline.
Las respuestas reales guardadas por cada recorrido coinciden con la versión
fijada: auditoría de 27 casos, cero incidencias, sin volver a pedir los recursos.
Evidencia: `public121-browser-attempt1/audits/2026-10-11T15-25-33-209393Z-7c7dc113/summary.json`.
El recorrido público adicional mueve libro y planta, conserva la balda elegida
y las posiciones tras recargar: pasa al primer intento (37,4 s). Su auditoría
separada confirma los archivos recibidos y cero incidencias; no se suma como
si fuera parte de los 27 recorridos anteriores. Evidencia:
`public121-drag-attempt1/audits/2026-10-11T15-26-33-867751Z-4c7f7329/summary.json`.
El APK existente 1.1.8 se verificó con esta web en `38150936761`: archivo
publicado y loader de 2107 bytes correctos, cinco estados Android comprobados
de nuevo y formulario auténtico de Google. La captura final muestra aún el
libro regresando a la estantería, por lo que no acredita la inserción terminada
ni su fluidez. Evidencia: `native-38150936761/policy-audit.json` y
`visual-review.json`. La CI completa de 121 sigue en curso.

Recuento reproducible en ese commit: 1.231 líneas no vacías de Rust y 34.406
de JavaScript propio (`rust-core/src` y `src/js`), un 3,45 % de ambos lenguajes.
Excluye dependencias, pruebas, HTML, CSS y Java nativo. No mide el porcentaje
de funciones migradas ni el trabajo restante; las rutas JS de compatibilidad
permanecen. La reescritura completa sigue pendiente.

## Siguiente candidato local: hojas y paleta (publicación retenida)

Por instrucción del usuario del 11 de octubre se espera la integración del
instalador de Inhouse Services Updater antes de publicar. Se canceló el build
propio `38151667641` antes del paso de publicación. No se modifica la rama
externa del updater ni sus APK. Tras la integración se aplican los canales y
las directrices canónicas, con nuevas versiones en A y B sólo por petición.

El candidato mueve a Rust la geometría completa de hojas y la selección de
colores de relieve. La primera mantiene posiciones, normales, UV, colores e
índices idénticos; conserva los dos pasos aleatorios originales y los cálculos
trascendentes de JS para no cambiar su redondeo. Cinco especies usan el kernel;
las otras tres conservan sus generadores. Las restauraciones de modelos
horneados no regeneran hojas ni invocan el kernel.

Pasan 26 unitarias y ocho comparaciones completas de modelos en Chromium con
CPU ×4. Medianas del modelo completo caliente JS → Rust: sansevieria
10,45 → 7,05 ms; suculenta 18,05 → 12,10; palmera 30,65 → 24,15;
helecho 67,90 → 55,95; zamioculca 26,50 → 14,70. No son FPS, mediciones
en teléfono físico ni mejoras atribuibles a las tres especies sin cambios.
Evidencia: `plant-geometry-browser-attempt1-extracted.json` y el informe Node
`plant-geometry-benchmark-attempt1.json`, con todas las observaciones.

La paleta conserva el histograma, colores representativos, agrupación OKLab,
selección de diez colores y descartes de bordes suavizados; los puntos de
cesión siguen iguales. Cada análisis libera su trabajo y memoria al acabar,
fallar o cancelarse. Se mantiene el algoritmo JS para menos de 4096 píxeles
y núcleos no disponibles/incompatibles. Pasan 14 pruebas del kernel, diez
de integración completa y 16 recorridos Chromium de paleta/API. La API real
incluye decodificación, rasterización, máscaras y miniaturas opcionales; todos
los resultados comparados conservan valores y bytes. CPU ×4, ejemplo de
foto de la batería de píxeles: 265,4 → 137,7 ms. En la API con foto CC0,
sin miniaturas: 105,7 → 91,6 ms. La portada pequeña no mejora: 22,8 →
22,9 ms sin miniaturas y 62,4 → 63,8 con ellas; no se afirma ganancia
universal. Evidencia: `palette-browser-attempt1-extracted.json` y
`palette-benchmark-attempt1.json`.

El WASM conjunto mide 178034 bytes, SHA256
`e8a6f88f95ee543cb507095004b101ae6b86245e587fec96ce2d1db951f1cd34`.
La primera batería completa pasa 3968/3969: el hash de modelos horneados
interpretaba `?url` como parte del nombre del WASM, que ahora es dependencia
transitiva de las plantas. El build reproduce el mismo error. Se corrige el
recorrido de dependencias: resuelve consultas de Vite, incluye bytes binarios
exactos y sólo interpreta imports en módulos JS. Pasan las 14 pruebas de
caché/hash y el segundo build. La nueva versión del hash invalida una vez
los modelos anteriores. Se conservan ambos fallos originales; la batería
completa posterior y la integración del editor aún deben terminar.

Después pasan los 15 recorridos originales del editor real (4,7 min) y dos
nuevos recorridos de primera apertura/reapertura (33,8 s). Comparan el
algoritmo JS anterior y el kernel Rust con el renderizador y shaders reales:
idénticos tres colores, un trabajo Rust en frío y ninguno al volver a abrir
desde la caché. Los tiempos completos quedan adjuntos, pero una observación
por variante no demuestra una mejora de latencia del editor. Evidencias:
`editor122-attempt1` y `editor122-palette-attempt1`.

La batería completa posterior al arreglo del hash pasa **3973/3973 pruebas
en 321 archivos**, y pasan los ocho recorridos originales locales (2,6 min),
incluidos los dos regresos nativos con sus plazos de siempre. Esto no borra
los fallos de CI121. Se congela el build local aún sin versión nueva en
`local-candidate-before-updater-build` y su inventario/hash en el JSON vecino.
No se ha subido: falta integrar el updater y comprobar la versión resultante.

La CI completa de 121 ha terminado: 3919/3919 unitarias y 663/665 E2E
estrictos; 667 intentos con dos reintentos, cero omitidos o inestables. Se
autentican 11 ZIP y 12 jobs sin inconsistencias. Todos los grupos de voces
pasan. Los dos contratos nativos fallan: aligned agota la expectativa de
ocho segundos; legacy mide 8188,5 y 8110,3 ms de cierre, además del timeout
global. Esto sí demuestra superar los ocho segundos, a diferencia de la
evidencia anterior de 120. No se amplían plazos ni se descartan intentos.
Evidencia: `ci-38150701915/snapshot-003/summary.json` y
`ci-38150701915/ui2-original-failure-summary.json`.

## Integración del updater y candidato 1.7.124

Se descarga main `d879237` (web 1.7.123 y APK 1.1.11/24 de A), preservando
y recuperando el trabajo local mediante stash. No hay conflictos. Las 20
copias y el lock del updater siguen exactamente en `ff20596f137119b98844a03a75836099ac7e146b`.
Se añade una regla de checkout LF porque Windows convirtió las copias a CRLF;
se recuperan con el sincronizador canónico y sus fuentes exactas del commit.
El primer intento de resincronización también heredó CRLF del clon canónico;
se detecta al comparar su lock, se restaura el clon desde `git archive` y se
repite con UTF-8. El lock final vuelve a ser idéntico al original y el
verificador aprueba. No se ha modificado la implementación compartida.

El build web ahora ejecuta ese verificador antes de compilar. El build 124,
3952 pruebas unitarias en 321 archivos y 105 verificaciones Python pasan.
La reducción respecto a 3973 proviene de las pruebas reemplazadas en la
integración del updater. El APK 1.1.11 publicado se descarga y valida:
SHA256, tamaño, versión/code, paquete, firma v2 y loader original de 2107
bytes correctos. La nueva web no necesita reemplazar el instalador firmado;
su comprobación con la producción nueva queda pendiente del despliegue.

### Publicación y comprobación de 124

Fuente `67d46f02095aabc09670caa2e23037704b48d03f`, Pages
`b9751b406c1f9225e471bbcc70b7d6ae161aaa69`. HTTP verifica los 99 recursos
y 101 respuestas, incluido el WASM idéntico al build congelado. El primer
intento aún recibió la versión anterior durante el despliegue y se conserva.
Los 27 recorridos públicos originales pasan; la auditoría contrasta los
cuerpos HTTP ejecutados en todos sus contextos. Dos casos públicos adicionales
del editor comprueban el kernel real, los mismos colores, liberación y caché.
La primera copia de ese test omitió una dependencia del fixture: se conserva
su fallo y se añade esa dependencia a una segunda copia externa.

La APK 1.1.11/24 publicada pasa la comprobación nueva `38155780417` y la
auditoría del ZIP original. Acredita las políticas de pantalla/estado y abre
el formulario de Google, sin autenticar una cuenta. Su última captura queda
en plena devolución; no acredita inserción final o duración del cierre.
CI de 124: `38155579422`, 3952/3952 unitarias y **689/691 E2E** con
693 intentos, dos reintentos automáticos y cero casos omitidos/inestables.
Los 11 ZIP originales están autenticados en `snapshot-007` sin inconsistencias.
Todos los grupos de voces pasan; los dos contratos de regreso nativo fallan:
aligned agota el plazo global y la expectativa de cierre; legacy mide
8266,5/8189,2 ms, por encima de ocho segundos, además del plazo global.
No se amplían límites ni se reejecuta sin cambios. El job agregado aún esperaba
runner en snapshot-007; snapshot-008 conserva los 12 jobs y la conclusión
final FAILURE, con los mismos 691 resultados completos.
Todos los fallos originales de CI121 permanecen conservados. Los diagnósticos
locales con SwiftShader de 5814,5/4917,7 ms no sustituyen el fallo de CI.

Recuento reproducible de 124: 1.568 líneas Rust no vacías en 13 archivos y
34.329 líneas JavaScript propias en 161 archivos: **4,37 %** del conjunto
Rust+JS. Incluye comentarios y excluye pruebas, dependencias, HTML, CSS y
código nativo. No es un porcentaje de funcionalidad migrada ni de mejora
de velocidad. El control de pantallas, persistencia, Drive, voces y lectores
sigue mayoritariamente en JavaScript; la migración completa no está terminada.
El updater permanece en su implementación canónica fijada, sin fork local.

### Seguimiento externo 126 y APK 1.1.12

Se incorporan por fast-forward los commits del updater hasta `24dd03a` y el
catálogo publicado `b49cba3`, conservando intactos los núcleos y puentes Rust.
La revisión canónica pasa a `ac5cef8994ea476af46161bd4189d85adfc5016a`;
las 20 copias coinciden con sus blobs Git exactos. B es el canal inicial;
A exige aceptación y deslizador, sin que ello autorice una publicación B.

Build126, 3952 unitarias, 105 Python, cinco casos updater/descarga y los
27 recorridos públicos de 126 aprueban. Se auditan sus respuestas contra
Pages `f02fc879d796a49c168508b09bd4bc06d8ed14cc`, fuente `bb2bb10`;
24dd03a sólo modifica un selector de prueba y no generó un runtime diferente.
La comprobación HTTP126 conserva el WASM de 178034 bytes, byte a byte.

Se descarga APK1.1.12/25 de A, se verifica firma/paquete/loader y se compara
con el APK del build38157135543: idénticos bytes. Sus originales autenticados
acreditan cold/warm/share, políticas de pantalla y audio real durante 367576ms
bloqueado, más PDF0–1. Se revisan las capturas; la final cold muestra el libro
insertado, sin medir su latencia. No hay medición de teléfono ni pin HTTP del
WebView. CI126 `38157553852` aún está en curso; sus resultados no se atribuyen
a la CI124, que conserva sus dos fallos nativos. Detalles en el WIP.


## 1.7.129 — Preparación PCM de las voces en Rust

Se mueve al núcleo la normalización de pico (incluido el límite especial NVCC
con RMS), recorte relativo de silencio y fade de extremos. Los cuatro caminos
Piper/Supertonic × worker/nativo usan la misma función. No se cambia el modelo,
la inferencia ONNX, las pausas, la planificación del audio ni la navegación.
El núcleo se carga en paralelo a la voz; si no está disponible, un fragmento
pequeño o una entrada fuera de límites usa las funciones JS originales.

Una arena de 4 bytes por muestra + alineación + 32 bytes, hasta 16 MiB, se libera
antes de entregar el fragmento. No hay memoria retenida por trabajo, views de
WASM transferidas al reproductor ni copias normalizadas intermedias. La nueva
API combinada deja intacta su entrada; los cuatro consumidores descartaban el
raw tras normalizarlo. Los helpers públicos anteriores conservan sus contratos.

La primera implementación conservaba además la mutación del raw mediante otra
copia y una segunda región completa. El caso largo empeoró 31,26 → 36,12 ms:
se descarta esa implementación. La versión final calcula en una sola región.
En Chromium, viewport 390×844, CPU ×4, 3 calentamientos y 9 rondas alternadas
de 12 fragmentos, incluidas copias, validación, asignación/liberación:

| Caso | JS anterior | Rust final |
| --- | ---: | ---: |
| 4096 muestras | 0,150 ms | 0,125 ms |
| NVCC, 66150 muestras | 1,575 ms | 1,217 ms |
| Piper, 110250 muestras | 2,283 ms | 1,958 ms |
| Supertonic, 288000 muestras | 5,858 ms | 4,700 ms |
| Fragmento largo, 1440000 muestras | 31,483 ms | 29,075 ms |

Es una reducción de ~8–23 % en este bloque, no en la inferencia, el arranque del
audiolibro o toda la app; no acredita rendimiento térmico en un teléfono real.
El WASM mide 179860 bytes, SHA256
`dab359bdfbf395c7435a7efeabdcf09a5cd4c5a56b8ba5046977f9180b320dd6`.

Evidencia: `D:/CodexEvidence/InhouseRead-20261011/rust-pcm`.
- `focused-1`: un timeout al comparar Buffers de millones de bytes con deep
  equality. Se conserva el caso completo y plazo; `Buffer.compare` comprueba
  todos los bytes sin recorrer sus propiedades mediante el runner.
- `focused-2`: 58/58 antes del cambio de memoria. `browser-1`: cinco casos
  aprobados, incluido el empeoramiento largo que motivó el cambio.
- `focused-3`: fallos por una edición interrumpida por la codificación Windows;
  se completan las modificaciones en UTF-8. `focused-4`: 58/58 aprobadas.
- `integration-1`: cuatro rutas de síntesis usan el WASM real y conservan cada
  byte del chunk completo, pausas, sample rate y protocolo. Inferencia simulada.
- `browser-2`: cinco comparaciones completas por SHA, ejecución real y
  liberación verificadas, medidas finales de la tabla con todas las muestras.

Batería completa, despliegue y comprobación pública de 129 aún pendientes al
escribir este apartado. La migración completa de la aplicación sigue pendiente.


La batería completa inicial detecta tres fallos en el simulador antiguo del
worker hebreo: eliminaba los imports sin inyectar el nuevo `loadRustCore`.
Se añade esa dependencia simulada, conservando las aserciones. Segunda batería:
**3988/3988 unitarias, 324 archivos**, 100,73 s, y build aprobado (5,82 s,
99 recursos offline). Las 105 Python pasan. Se conservan ambos resultados.

Se consulta también la CI128 (anterior a esta migración). Su shard6 presenta un
fallo en smoke: el test buscaba Cambiar tema sin abrir el nuevo menú de perfil.
Se actualiza ese único paso de acceso, manteniendo la comprobación del tema.
El caso de papelera/Drive tiene un fallo de boundingBox y pasa al reintentar;
se conserva como inestable, no como aprobado estricto. Log original completo:
`ci128-ui6-original.log`. Los otros jobs aún en curso no se dan por aprobados.


Los 23 recorridos locales pasan al primer intento (`ui-1.json`, 3,4 min):
seguimiento del audiolibro y continuidad de capítulos, PDF/EPUB recuperados de
Drive en otro contexto, cierres nativos aligned/legacy con sus límites originales,
reapertura offline y menú de perfil. No sustituye los resultados de CI128.


La selección local de voces reales también pasa: veinte casos Supertonic,
diez perfiles en inglés y diez en neerlandés, sin red después de instalar el
paquete y calentar el worker. `voices-1.json` (2,5 min) y `real-voices` conservan
métricas, WAV y revisión de pesos. No se presenta esta selección como la matriz
completa de voces, que ejecuta el workflow completo al publicar.

La corrección de smoke necesitó además usar el checkbox «Modo oscuro» dentro
del perfil (el antiguo botón permanece oculto por compatibilidad). Se conserva
el timeout de `smoke-1`; `smoke-2` pasa con la misma aserción y plazo.


### Publicación y comprobación de 129

Fuente `495d91670125e4363322fca8362abed8f7bfd356`, Pages
`7a354fcb4962c0bfa0df6300bd5f98ae46869252`; ambos workflows de despliegue
38165531753/38165583259 terminan correctamente. El primer sondeo recibe todavía
la web anterior y se conserva. El segundo valida los 99 recursos y 108 checks,
cero errores (`published-1791744779970/summary.json`). El WASM real descargado
conserva el SHA local y pasa 15 comparaciones completas adicionales de audio.
La prueba del perfil en la URL pública pasa: la respuesta ejecutada del main
coincide con el hash del manifiesto, no sólo con un número de versión.

APK1.1.12/25 de A descargada otra vez: hash, firma v2, paquete y loader de 2107
bytes correctos (`apk-summary.json`). Este cambio web no reemplaza la APK ni
crea una versión B. No se afirma una sesión nueva en teléfono físico.
La matriz completa de CI129, `38165531750`, sigue en curso; se conserva ese
estado pendiente. El WIP contiene las rutas y hashes para continuar la auditoría.


## Continuación 1.7.141 — Microtexturas de encuadernación

Base integrada: `21e133a`, web 1.7.140 y APK 1.1.15/28. Incluye updater
canónico 1.2.3, revisión `6621ca1dbb519d171d723f118052e42ef5d5c001`, con
resultado de instalación y recuperación desde la publicación de GitHub.
No se modifican las copias compartidas ni se publica/promueve otra APK.
La promoción anterior a B se conserva tal como llegó de main.

Migrados a `book_surface.rs`: hash de ruido, interpolación de octavas,
altura de la trama, cálculo de normales periódicas de tela/papel y máscara
de corte de la cinta. JavaScript suministra sólo ocho senos del navegador
para conservar sus coeficientes. Rust hace los recorridos completos por píxel.
Three conserva dimensiones, filtros, mipmaps, Source compartido, escala de
normales, luces y materiales. La vía anterior sigue disponible si no hay WASM.

Los 65536 bytes de cada normal map y los 4096 bytes del recorte coinciden con
el algoritmo congelado anterior a esta migración. La comparación del navegador
comprueba además que el modelo consume las tres imágenes reales y que el
segundo libro las reutiliza sin regenerarlas. No se retoca la imagen.

La arena temporal máxima de estos kernels es 131136 bytes y se libera antes
de devolver arrays independientes. Las pruebas incluyen crecimiento de memoria,
fallo de reserva/kernel, tamaños inválidos y cortes en límites de píxel.
El marcapáginas conserva su arena anterior de 7896 bytes por core: el fixture
la libera explícitamente al acabar. La primera prueba asumía erróneamente que
todas las arenas del modelo eran temporales; su fallo se conserva en `browser`.
El resultado corregido `browser2` no cambia ese comportamiento de producción.

Medición Chromium, viewport 390×844, DPR2, CPU ×4; tres calentamientos,
nueve rondas alternadas y treinta generaciones por ronda. Incluye adaptador,
copia del resultado, asignación/liberación y ocho coeficientes, sin caché:

| Textura | JavaScript anterior | Rust | Reducción del bloque |
| --- | ---: | ---: | ---: |
| Tela | 5,307 ms | 2,120 ms | 60 % |
| Papel | 7,210 ms | 2,837 ms | 61 % |
| Recorte de cinta | 0,183 ms | 0,030 ms | 84 % |

Son cálculos compartidos que se generan una vez. Estos porcentajes no describen
la velocidad global, la GPU ni la batería del teléfono. El WASM pasa de
179860 a 182113 bytes; SHA256
`001796a2f378996224ce7b1a70e9b42bd54709eae0d825acb921f1345a67e657`.

Evidencia: `D:/CodexEvidence/InhouseRead-20261012/rust-book-surfaces`.
101/101 focales; 4058/4058 unitarias, 325 archivos; build y verificador del
updater aprobados. El recorrido integrado con CPU ×4 pasa sin retry.
La batería de interfaz y la publicación se registran en el WIP al finalizar.
La migración de la lógica de biblioteca, lector, gestos y persistencia sigue
pendiente; esta entrega no equivale a una reescritura completa de la app.


### Publicación comprobada de 141

Fuente `7ca8e6d32dc3d328682c3aa707cb32edf2e0b269`, Pages `8c73771`.
24/24 E2E locales y 3/3 públicos pasan sin retries. El artefacto descargado
conserva exactamente los 135168 bytes de las tres texturas, además del SHA
del WASM compilado localmente. 113 controles HTTP y 99 recursos exactos.
La APK 1.1.15 conserva su firma/loader y recibe esta web. No se recompila
el wrapper. La matriz completa 38183041199 continúa; el WIP conserva el
fallo previo de cierre Linux de 137, sin presentarlo como resuelto.


## Continuación 1.7.142 — Trama visible del lomo

Rust genera las dos teselas de tejido: color RGBA y canales físicos de
altura/rugosidad/metal. Se comparten el campo f32, los materiales, la caché
y el filtrado anteriores; JS aporta cuatro coeficientes seno del navegador.
Los 131072 bytes coinciden exactamente con la referencia congelada de 141.
El ensayo integrado compara también ambos resultados tras la conversión
premultiplicada de Canvas. El primer fixture comparaba esa lectura con RGB
sin premultiplicar y falló; se conserva como `browser` y se corrige en `browser2`.

Chromium 390×844 DPR2 CPU×4, nueve rondas alternadas de treinta generaciones:
mediana JS 7,340 ms, Rust 1,973 ms (incluidos reserva/copia/liberación y la
concatenación de medida). Es coste de generación compartida, no de toda la app.
Arena temporal máxima 147488 bytes, liberada al devolver ambos arrays.
WASM 183009 bytes, SHA256
`20f097846a04facfbf9a0e061d90fb0229a9a7f6add962abfceded6bb3f38fdd`.

4067/4067 unitarias; build aprobado. E2E local: 34 aprobadas, sin retry,
y seis capturas opcionales omitidas porque no se activó su variable de salida.
Evidencia: `D:/CodexEvidence/InhouseRead-20261012/rust-spine-weave`.
Publicado junto a la corrección prioritaria del lector en `ccf94d5`.
El WASM público conserva los mismos bytes y ejecuta las cinco texturas exactas;
115 controles HTTP correctos, APK loader verificado y seis recorridos públicos
aprobados. Ver el WIP para CI global y los límites de las pruebas de audio.
CI141 UI3 conserva un fallo de primera importación EPUB (lector ausente
tras 8 s), aprobado sólo al reintentar; originales en `ci141-ui3`.
# Migración 1.7.144 — dimensiones físicas de la estantería (12 octubre)

En verificación local; aún no publicada. Changelog: «Geometría de estantería en Rust».
Rust calcula las dimensiones de las lejas y ajusta libros, plantas y luces en
una operación. La colocación de plantas sobre el techo usa también el núcleo
Rust existente. El navegador conserva los mismos objetos, materiales y nodos.
La vía de medición interna evita inspecciones repetidas de propiedades; la
vía pública conserva validación y fallback. Arena liberada al terminar.

Comparación exacta de coordenadas y metadatos con la referencia de 143,
ambos muebles y múltiples tamaños; comparación integrada de techo y lejas.
Chromium móvil 390×844, CPU×4, nueve rondas alternadas de 50 operaciones:
12 objetos JS/Rust 0,032/0,042 ms; 50: 0,110/0,118 ms; 300: 0,590/0,536 ms.
Son tiempos de este cálculo, no de la aplicación completa. Se conservan los
ensayos iniciales más lentos del adaptador en browser/browser2 y el final
browser3. No se atribuye una aceleración universal a esta migración.

WASM 186407 bytes, SHA256
`41bbd4fcde3df834d31ba0b9c5370a7141b349edae8b427401c8e59086196b50`.
Evidencia: `D:/CodexEvidence/InhouseRead-20261012/rust-physical-layout`.
APK, firma, canales y revisión del updater permanecen iguales. No hay cambio
nativo que requiera una nueva APK. Siguiente bloque: preparación de texto y
mapas de posiciones del audiolibro. La migración total todavía no ha terminado.
# Migración 1.7.145 — limpieza del texto del audiolibro

En verificación local. Rust recoge el texto normalizado, colapsa espacios y
conserva los índices UTF-16 y las fronteras de bloques. La identificación de
cabeceras, notas y guiones de línea sigue usando las mismas reglas Unicode
del navegador. El plan de frases y sus marcas de página es idéntico al anterior.
No cambia voces, audio, paginación ni la interacción del lector.

63/63 pruebas focalizadas iniciales (47 nuevas): todos los 65536 code units,
surrogates aislados, notas/cabeceras, eliminaciones aleatorias, crecimiento de
memoria y liberación de arenas. Chromium 390×844 CPU×4, nueve rondas alternadas:
1000 caracteres JS/Rust 0,313/0,125 ms; 16000: 3,813/1,188; 128000: 29,112/8,862.
Incluye copia de entrada y salida. El primer adaptador sin mejora queda en
browser; el definitivo evita iteradores por carácter y está en browser2.
No significa que el arranque completo del audiolibro se reduzca en esa proporción.
WASM 188086 bytes, SHA `64d113c5e8980d34df3d8833acb1c7605f0ea487a4c9398b7b5bc78e0aacf159`.
Evidencia: `D:/CodexEvidence/InhouseRead-20261012/rust-speech-normalize`.

CI143 UI3: 67 aprobados y un fallo original conservado en reader-continuity/ci143.
reader-interface compact intentaba pulsar el botón Detener oculto a 320 px.
Se corrige su recorrido: comprueba que está oculto, abre el panel y pulsa
Detener allí, verificando el estado y cierre posteriores. No cambia el producto,
no se elimina la aserción de parada y no se aumenta el timeout.

Publicación 144 confirmada: fuente `5c2a5708523cb026d3c0a9ae9e69b2d4fed4deb4`,
Pages `30038706ef61ef7e342cf52f03ac600c1891a70d`. Deploy38190101753 y
Pages38190146341 aprobados. 116 controles HTTP y 99 recursos exactos;
60 casos de coordenadas con el WASM descargado aprobado. APK 1.1.15/code28
idéntica, loader2107 bytes, tres assets. Evidencia published-1791766892079.
La primera consulta durante despliegue devolvió aún la versión anterior y 404
para recursos nuevos; se conserva en published-1791766820055. No se usa como
aprobación. La matriz CI144 continúa; no se afirma éxito global.

# Migración 1.7.146 — fragmentos de voz en Rust

Verificación local: 4281/4281 unitarias y 7/7 E2E, sin omisiones ni reintentos;
build aprobado. Changelog: «Fragmentación de voz en Rust». Pendiente de subir
hasta comprobar la publicación real de 145, actualmente en cola de GitHub Pages.
Rust recorta márgenes y decide TODOS los cortes de las frases largas de un
capítulo en una llamada. El navegador conserva la clasificación lingüística
de finales de frase y la creación de objetos de texto. Se conserva el límite
180, las preferencias por cláusulas, los empates, los offsets UTF-16 y cada
marca interna de página. No se altera el PCM ni el gesto del lector.

130/130 casos focalizados con el módulo de normalización; 67 nuevos: tamaños
límite, CJK, árabe, surrogates, signos, espacios, planes completos y liberación.
Chromium390×844 CPU×4, nueve rondas alternadas, incluye entrada/salida:
frases largas de 1000/16000/128000 caracteres: JS0,150/2,350/19,112 ms frente a
Rust0,063/1,013/7,888. Con frases cortas domina la clasificación lingüística:
0,650/9,175/72,625 frente a0,638/9,237/74,125. No se afirma mejora en ese caso.
Los siete E2E incluyen PDF/EPUB con voz real, hold, navegación independiente,
paginación estable y comparación integral de frases/mapas con la referencia.
WASM190162 bytes, SHA `b6086c92be65ffa186b939df161da90019a08441cf73140e1c8b027e649b8042`.
Evidencia: `D:/CodexEvidence/InhouseRead-20261012/rust-speech-fragments`.
Siguiente bloque: expansión de las texturas de las plantas, conservando cada
byte de pigmento, relieve y rugosidad y la preparación progresiva actual.

# Migración 1.7.147 — texturas iniciales de plantas

En comprobación completa; sin publicar todavía. Changelog: «Texturas de plantas en Rust».
Rust expande la cuadrícula f32 del pintor original a las texturas de pigmento,
relieve y rugosidad. Conserva interpolación, redondeo, color, resolución,
mipmaps, caché, repintado progresivo y propiedad de los materiales.
Una operación por textura; sin motor continuo ni buffers retenidos.

16/16 unitarias focalizadas; 8 superficies reales de MONSTERA, SANSEVIERIA y
cactus coinciden byte por byte con la referencia. La comparación intercepta
las llamadas reales y cuenta 8 verificaciones, cero diferencias y cero bytes
retenidos. Máximo temporal1091480 bytes con la textura256×512.
Chromium390×844 CPU×4, nueve rondas alternadas de diez expansiones:
128×128 JS/Rust4,42/2,39 ms; 128×2568,39/4,44; 256×51232,68/17,97.
Incluye entrada y copia a los arrays finales. El primer ensayo browser conserva
el redondeo inicial más lento; browser2 usa conversión acotada y comparación
de fracción, sin cambiar el redondeo de ningún píxel. No mide la generación
completa ni el rendimiento de la app en un teléfono físico.
WASM191983 bytes, SHA `e26538efc7fd971fd81995c152e3f13a2e83350ad141b88932fc3296ff670819`.
Evidencia: `D:/CodexEvidence/InhouseRead-20261012/rust-plant-preview`.
Próximo bloque preparado: pintado final de la cerámica en lotes de cuatro filas.

CI143 terminó: 4091 unitarias; 713 E2E aprobados y tres fallidos, sin flaky/skips.
Piper15/40/14 y Supertonic224 aprobados. UI2 conserva dos retornos nativos
que sobrepasan8 s, igual que141/142. UI3 conserva el recorrido antiguo del
botónDetener corregido en145. Originales íntegros en reader-continuity/ci143-final.
No se considera resuelto el retorno nativo ni se afirma aprobación global.

# Migración 1.7.148 — acabado final de cerámica

Comprobación local completa: 4313/4313 unitarias y 11/11 E2E, sin omisiones ni reintentos; build aprobado. Publicación pendiente. Changelog: «Cerámica de macetas en Rust».
El pintor de MUSKOT/GRADVIS calcula pigmento, altura y rugosidad en Rust,
conservando el campo de ruido, moteado, craquelado, borde del esmalte y labio.
La cola mantiene lotes de cuatro filas, el presupuesto ocioso, el redibujado
al completar y la propiedad/caché de las texturas. Sin buffers retenidos.

32/32 unitarias focalizadas (16 nuevas): colores, acabados extremos, límites,
filas parciales, guardas frente a desbordamiento, crecimiento de memoria y
propiedad. El ensayo de navegador observa y compara CADA lote real de las dos
macetas; ningún fallback oculta una diferencia. Conserva todas las muestras
originales byte por byte, incluido el azul físico cero y alfa255.
Chromium390×844 CPU×4, nueve rondas alternadas de tres pinturas completas:
MUSKOT128×256 JS/Rust61,80/22,80 ms;256×512243,03/85,07.
GRADVIS128×25625,87/15,93;256×512102,97/63,47.
Incluye reserva, copia y liberación de cada lote. Son costes de pintura, no
una medición del catálogo completo en un móvil físico.
WASM198093 bytes, SHA `1e58ccf5998e0992f4f2298eb37204f1769c5631c855d00fce39693d5ae1ff2b`.
Evidencia: `D:/CodexEvidence/InhouseRead-20261012/rust-plant-glaze`.
Siguiente bloque preparado pero aún sin integrar: terracota y zinc.

# Migración 1.7.149 — terracota y zinc

Verificación local: 4329/4329 unitarias (repetición aislada) y 11/11 E2E; build aprobado. Publicación pendiente. Changelog: «Terracota y zinc en Rust».
Migra las superficies finales de MUSKOTBLOMMA y AKERBAR: pigmento, poros,
sales, estrías del torno, cristales del zinc, altura y rugosidad. Conserva
la caché, cuatro filas por lote, repintado final y resolución del material.
32/32 unitarias focalizadas (16 nuevas). El navegador compara todos los lotes
reales de dos modelos: igualdad byte por byte, sin buffers retenidos ni
fallback que oculte diferencias. El primer ensayo Chromium390×844 CPU×4
mide JS/Rust113,27/59,27 ms en terracota128×256 y490,77/240,27 en256×512;
zinc59,03/33,40 y211,20/116,67. Nueve rondas alternadas, tres pinturas por
ronda, incluida la reserva/copia/liberación. Había otras verificaciones
locales en curso; estas cifras no representan un móvil físico ni toda la UI.
WASM211294 bytes, SHA `42ea9ded02bc053159fd046393b8e76afabc1a5a9bdd7d4af0fe7eb3daf61f86`.
Evidencia: `D:/CodexEvidence/InhouseRead-20261012/rust-plant-pottery`.
Siguiente bloque preparado: texturas de sustrato y grava; todavía sin integrar.

# Migración 1.7.150 — tierra y grava

Verificación local: 4339/4339 unitarias y 11/11 E2E sin omisiones ni reintentos. Build aprobado. Publicación pendiente. Changelog: «Sustratos de plantas en Rust».
Rust calcula tierra, corteza, perlita, humedad y grava, con los mismos pigmentos,
altura y rugosidad. El ruido compartido admite campos sin repetición, conservando
los campos periódicos de las macetas. Se mantiene el lote de cuatro filas.
42/42 pruebas focalizadas (10 nuevas) y ensayo de modelos reales aprobado:
compara todos los lotes, verifica ambos sustratos y conserva cada byte sin
memoria temporal retenida. Chromium390×844 CPU×4, nueve rondas alternadas de
tres pinturas completas (incluye reserva/copia/liberación): tierra128² JS/Rust
41,50/22,73ms;256²165,60/86,73. Grava128²16,63/11,33;256²74,67/49,70.
Son costes de este cálculo; no equivalen a fluidez total ni a móvil físico.
WASM221677 bytes, SHA `f60f749a7488df886ff11f33415c0fae277c859d85ce159668295242fa71c401`.
Batería completa aprobada, ejecutada sin navegador simultáneo (290,39s).
Evidencia: `D:/CodexEvidence/InhouseRead-20261012/rust-plant-soil`.
Próximo bloque preparado, todavía sin integrar: pigmento y nervaduras de hojas.

CI14638191111252 ha terminado con todos los grupos aprobados: unitarias,
seis grupos de interfaz y todas las voces reales Piper/Supertonic.
Esto no demuestra corregido el retorno nativo intermitente de CI143/145;
sus fallos y artefactos originales se conservan.

# Migración 1.7.151 — follaje

Verificación local: 4383/4383 unitarias y 11/11 E2E sin omisiones ni reintentos; build aprobado. Publicación pendiente. Changelog: «Texturas de hojas en Rust».
Migra pigmento, bandas de sansevieria, nervaduras, altura y rugosidad de las
hojas. Conserva geometrías, UV, sombreado, caché y lotes de cuatro filas.
La nervadura central y el seno lateral se reutilizan por columna del lote.
70/70 pruebas focalizadas iniciales; se amplió el archivo nuevo a44 casos
para cubrir también las resoluciones cuadradas reales en la batería completa.
El navegador verifica todos los lotes de monstera, hiedra, suculenta y
sansevieria, los cuatro tipos de cálculo, cada byte y ninguna reserva retenida.
Chromium390×844 CPU×4, nueve rondas alternadas de tres pinturas completas:
monstera128² JS/Rust20,10/11,27ms;256²80,63/41,10.
Sansevieria128×25651,00/29,80;256×512199,23/115,40.
Incluye reserva/copia/liberación; no mide toda la aplicación ni un móvil físico.
Build aprobado. WASM230300 bytes,
SHA `4e5e8beecc5aff28890b1f07dae1551db6b62cc9ff454a463095d39de08e2d85`.
Evidencia: `D:/CodexEvidence/InhouseRead-20261012/rust-plant-foliage`.
Próximo bloque preparado fuera del repositorio: geometría completa de cactus,
con muestras del PRNG preservadas incluso cuando falle la aceleración.

## 1.7.152: malla de cactus

Changelog: «Cactus más rápidos en Rust». Se migran la malla completa,
las crestas, el estrechamiento de la punta, los pigmentos, UV y normales.
Se conservan el PRNG y sus muestras incluso si falla la aceleración.
Los coeficientes trigonométricos del navegador mantienen sus redondeos.
48/48 pruebas focalizadas. El navegador compara los tres cactus reales,
cada atributo e índice, sin diferencias ni reservas temporales retenidas.
Chromium390×844 CPU×4, nueve rondas alternadas de40 mallas completas:
JS1,155ms / Rust0,393ms de mediana, incluyendo PRNG, atributos y liberación.
No equivale a una medición de toda la app ni de un móvil físico.
WASM232362 bytes, SHA
`7c7ee4685d6b28ebecb9acaaf57057bbfe71d1cf0884ce6eb818bb09adcf6f41`.
Build aprobado; 4405/4405 unitarias en335 archivos (277,30s) y11/11 E2E
(3,5min), sin omisiones ni reintentos. Publicación pendiente.
Evidencia: `D:/CodexEvidence/InhouseRead-20261012/rust-plant-cactus`.

## 1.7.153: superficies de macetas

Changelog: «Geometría de macetas en Rust». Rust calcula las coordenadas
por longitud de arco, el sombreado interior, las acanaladuras GRADVIS,
las normales y su unión en la costura. Se conservan LatheGeometry y los
coeficientes trigonométricos del navegador; no se afirma migrado ese constructor.
78/78 pruebas focalizadas,30 nuevas. El primer ensayo de navegador incluyó una entrada «terracotta» que usa
la maceta por defecto; el recorrido final usa el ID real «muskotblomma».
La comparación directa del perfil de terracota sí corresponde al original.
Reserva viva al terminar: cero. Chromium390×844 CPU×4, nueve rondas
alternadas de30 macetas (incluye el constructor, copias y liberación):
MUSKOT JS/Rust1,037/0,780ms; GRADVIS2,213/1,187;
AKERBAR0,493/0,367; terracota0,523/0,380.
El ensayo final del recorrido UI usa MUSKOTBLOMMA y compara los cuatro
modelos reales completos, sin diferencias. Medianas JS/Rust de ese pase:
MUSKOT1,090/0,637; GRADVIS2,277/1,260; ÅKERBÄR0,503/0,360;
MUSKOTBLOMMA0,477/0,357ms. El primer ensayo se conserva íntegro.
Son cálculos aislados, no una medición de toda la app ni de móvil físico.
Build aprobado. WASM237663 bytes,
SHA `1a777b9348a26959d8d191743f3da4e2ac4e074235f6c7a9654fa1d1e2f2cbe2`.
4435/4435 unitarias en336 archivos (278,92s), sin omisiones.
11/11 recorridos visuales aprobados en3,8min sin omisiones ni reintentos.
Publicación pendiente.
Evidencia: `D:/CodexEvidence/InhouseRead-20261012/rust-plant-pot`.

## 1.7.154: malla de hiedra

Changelog: «Hiedra más rápida en Rust». Malla de cinco lóbulos, curvatura,
colores, UV, índices y normales en Rust. Se conservan las tres muestras del
PRNG, también al rechazar o fallar el núcleo, y los senos originales del host.
78/78 focalizadas aprobadas,22 nuevas. El navegador compara toda la planta
HEDERA con108 llamadas reales al núcleo: atributos e índices exactos, sin
reservas temporales retenidas. Chromium390×844 CPU×4, nueve rondas alternadas
de500 hojas, incluyendo PRNG, reserva, copia, atributos y liberación:
JS0,0544ms / Rust0,0256ms. No equivale a la velocidad total de la app.
Build aprobado. WASM239898 bytes,
SHA `9a38fe01fd5c44a8678f349a02ca9ed72d897de8a254127ed991af00bf2e87df`.
4457/4457 unitarias en337 archivos (281,55s) y11/11 E2E (3,6min),
sin omisiones ni reintentos. Publicación pendiente.
Evidencia: `D:/CodexEvidence/InhouseRead-20261012/rust-plant-ivy`.

## 1.7.155: subdivisión de hojas

Changelog: «Subdivisión de hojas en Rust». Los vértices interiores compartidos
y su topología pasan a Rust, conservando el orden de inserción y cada redondeo.
Se valida la entrada antes de modificar la geometría y se conserva la salida
original si el núcleo no está disponible, rechaza datos o falla.
69/69 focalizadas,17 nuevas. El navegador compara toda la monstera con5
llamadas reales al núcleo, conservando atributos e índices exactos.
Chromium390×844 CPU×4, nueve rondas alternadas de30 subdivisiones de una
rejilla24×24: JS3,307ms / Rust1,240ms, con clones, copias y liberación.
No equivale a una medida de toda la aplicación ni de un teléfono físico.
Reservas temporales vivas:0; memoria WASM estable en2228224 bytes después
del calentamiento y del ensayo. Build aprobado. WASM245416 bytes,
SHA `75ce8cd4230f0ef28013b2e42af8efc40abb1996113a427c0045159b5975e2e5`.
4474/4474 unitarias en338 archivos (279,48s) y11/11 E2E (3,5min),
sin omisiones ni reintentos. Publicación pendiente.
Evidencia: `D:/CodexEvidence/InhouseRead-20261012/rust-plant-subdivide`.

## 1.7.156 — extrusión de Monstera

`plant_monstera_mesh` produce ambas caras, sus paredes de contorno, índices,
colores, UV y normales a partir de la triangulación curva original. Conserva
la inserción y eliminación ordenadas de aristas del Map anterior y todos los
redondeos f32. El adaptador devuelve geometrías con buffers propios y libera
su arena incluso al fallar; el host retiene el fallback original.
Comparación exacta de la planta completa en Chromium,5 llamadas al núcleo.
CPU×4:25,280ms JS frente a18,500ms Rust para la creación completa por planta
(medianas de9 rondas de5), manteniendo los núcleos anteriores en ambos casos.
La API de Three y la triangulación base no se han migrado. Evidencia y estado
de regresiones/publicación en `docs/remaining-wip-verification.md`.

## 1.7.157 — disponibilidad del núcleo al abrir

Compilación paralela desde el HTML y adopción sin espera en shelf-boot.
No añade porcentajes de lógica migrada: habilita los núcleos existentes antes
del primer frame. La petición y la instancia se comparten; conserva fallbacks,
ABI y reintento acotado. La pintura final de plantas cede al primer frame con
un límite de1s. Ensayos reales de descarga bloqueada y fallida mantienen la
estantería disponible. El ensayo emparejado no demuestra una aceleración
sistemática del arranque completo; las cifras y límites están en el WIP.

# Migración 1.7.158 — ordenación completa de líneas PDF

Changelog: «Ordenación PDF completa en Rust». Se migran la recursión por
columnas y bandas, tablas, títulos transversales, contadores y orden RTL.
El host conserva texto, metadatos, referencias PDF.js y clasificación regex;
el núcleo devuelve una permutación y rutas de columna. Validación antes de
publicar resultados, liberación por llamada y recuperación del algoritmo
anterior si el núcleo no está disponible. Páginas menores de32 líneas
conservan la ruta anterior por el coste del cruce de memoria.
65/65 pruebas focalizadas aprobadas,22 nuevas, y navegador comparativo1/1.
Cien páginas aleatorias, geometría fraccional, memoria creciente, identidad
de fuente, fallos nativos y extracción completa conservan los resultados.
Ensayo Chromium390×844 CPU×4, nueve tandas alternadas de20 llamadas:
- 128 líneas de una columna: JS0,825ms / Rust0,295ms.
- 257 líneas de dos columnas: JS1,570ms / Rust0,805ms.
- 385 líneas de tres columnas: JS2,765ms / Rust1,580ms.
Incluye copias/objetos/liberación; ambas rutas usan los núcleos anteriores.
No representa el tiempo de abrir el libro ni una medición en móvil físico.
Capacidad WASM estable tras calentamiento. Build aprobado,319798 bytes,
SHA `337ea3baa4e5603f6e6804b93955239863cf6cf259f2c7aaf6e1740c6805968b`.
4531/4531 unitarias en342 archivos (280,59s) aprobadas.17/17 E2E
(13 lectura PDF,2 PDF real/Unicode,2 con pesos reales Davefx), sin omisiones
ni reintentos. Publicación158 pendiente.
Evidencia: `D:/CodexEvidence/InhouseRead-20261012/rust-pdf-order`.

# Migración 1.7.159 — poses de animación preparadas en Rust

Changelog: «Poses de animación en Rust». La curva Hermite monótona prepara
sus tangentes una sola vez por animación. Cada fotograma y cada sonda de
encuadre usan el núcleo compilado; planificador, duraciones y calidad GPU
permanecen iguales. La implementación anterior sirve de recuperación.
Cada movimiento libera su propia reserva al finalizar, cancelar, reemplazar
o destruir la vista. Ninguna vista WASM sobrevive entre llamadas; los objetos
pose entregados al renderizador son independientes de su memoria.
120/120 focalizadas iniciales, incluidos cinco recorridos del bookView real
con núcleo compilado y sólo el driver GPU sustituido. Dos casos adicionales
cubren offsets implícitos/-0 e inmutabilidad.4555/4555 unitarias en344 archivos
(281,77s), sin omisiones ni reintentos.23/23 E2E (310,04s), sin omisiones
ni reintentos: PDF/EPUB/CBZ, cancelación, WebGL/fallback y ambos contratos
nativos de retorno. Cierre local4111,5/4565,3ms, bajo el límite original8s;
no demuestra resuelto el fallo previo del runner CI.
Build aprobado; WASM321536 bytes, SHA
`2888b7f941a069285e0df55f65cdadfb7d509517191d7527c393fb96989a4413`.
Primer ensayo Chromium CPU×4:2 poses0,00305/0,00135ms y4 poses
0,00715/0,00130ms por muestra JS/Rust. Excluye preparación de tangentes;
El ensayo final incluye crear/liberar y47 muestras por movimiento:
2 poses:0,108/0,062ms;4 poses:0,327/0,070ms;8 poses:0,403/0,075ms.
Nueve tandas alternadas de100 movimientos; misma capacidad tras calentamiento.
Son costes del cálculo, no tiempo GPU ni una mejora de FPS acreditada.
Publicación159 pendiente. Evidencia: `D:/CodexEvidence/InhouseRead-20261012/rust-motion`.

# Migración 1.7.160 — imágenes PDF compuestas en Rust

Changelog: «Imágenes PDF completas y más rápidas». Límites de recorte,
orden geométrico y unión de capas solapadas migrados al núcleo. Mismos
objetos de salida y píxeles de PDF.js; páginas con menos de8 imágenes
conservan la ruta anterior. Incluye rotación, bordes de página, entradas
inválidas, recomposición transitiva y200 páginas aleatorias de comparación.
16 pruebas nuevas del núcleo y6 del registro de grupos.51/51 focalizadas
tras el parche;41/41 adicionales de temas/tracker y2/2 pruebas del núcleo
en navegador.10/10 UI: texto, imágenes y32 fotografías repetidas en ambas
vistas y todos los temas, sin omisiones ni reintentos.

El ensayo real detectó un fallo anterior: PDF.js6.3.289 registraba sólo una
colocación al dibujar32 usos de una imagen. El lector entonces recurría a
una captura completa de la página para esos operadores. Se añade un parche
Vite acotado/versionado que registra cada colocación con su transformación
y recorte reales. No cambia ningún dibujo; un cambio de la dependencia
incompatible detiene el build. Se retira sólo el fallback de grupos/repetidas;
las máscaras de plantilla no registradas conservan su protección original.
Ahora32 imágenes/32 recortes/32 canvases y377136 bytes originales idénticos.
La primera comprobación de paleta ideal falló por interpolación del renderer
y redondeo de sus coordenadas Float16; se conserva. La comprobación final
compara TODOS los píxeles originales compuestos, además de sus posiciones.
No se modifica la interpolación del PDF ni se aumenta una tolerancia.
Originales: browser.*, diagnostic.*, browser-fixed.*, color-diagnostic.*.

Ensayo Chromium CPU×4, nueve rondas alternadas de20 llamadas con copias:
32 imágenes JS0,045ms/Rust0,015ms;512 imágenes0,245/0,090ms;
2000 imágenes1,145/0,355ms. Capacidad estable tras calentamiento.
Build aprobado; WASM331507 bytes, SHA
`c57b918b7443796a6e73a0561f1e3a588303e6101addd73d5fd4a934b8c72cc8`.
Batería completa y publicación160 en curso. Evidencia:
`D:/CodexEvidence/InhouseRead-20261012/rust-pdf-images`.

Validación160 final local:4577/4577 unitarias (346 archivos),16/16 E2E
adicionales de imágenes, orden y núcleo, además de10/10 anteriores de
temas y32 imágenes repetidas. Publicación y artefactos en comprobación.

# Migración 1.7.161 — colocación de ilustraciones en Rust

Changelog: «Ilustraciones entre párrafos en Rust». El núcleo proyecta las
cuatro esquinas de cada imagen, construye los límites de columnas y ordena
las ilustraciones por su posición en el texto. Conserva offsets UTF-16,
referencias originales, orden estable, rotación y escalas no uniformes.
La orientación trigonométrica se calcula en el navegador para mantener sus
redondeos. Menos de ocho imágenes siguen la ruta anterior.
17 pruebas nuevas; 56/56 focalizadas de preparación, navegación y lector.
200 páginas aleatorias, 2000 imágenes, Unicode, memoria creciente y errores
nativos. 4/4 E2E (22,9s): núcleo real y PDF con 32 usos de una fotografía,
en texto/original y cinco temas. 377136 bytes de imagen originales exactos.
Ensayo Chromium CPU×4, nueve tandas alternadas de20 llamadas, con copias:
8 imágenes JS0,070ms/Rust0,050ms;32 imágenes0,260/0,100ms;
128 imágenes0,905/0,310ms;512 imágenes2,490/0,845ms;
2000 imágenes11,290/3,460ms. Memoria estable tras calentamiento.
Estos tiempos son del cálculo, no de abrir un libro en un móvil físico.
Build aprobado; WASM346703 bytes, SHA
`34a884dff58b8780b4044a2999ce9b87cc212c9f7f4dcd2eecd65dffda6f3a5e`.
4594/4594 unitarias (347 archivos,283,61s), sin omisiones.
26/26 E2E locales:4 del núcleo/imágenes,8 de lectura/voz Davefx real y
14 de adaptación/navegación; todos sin omisiones ni reintentos.
Publicación161 pendiente. Evidencia:
`D:/CodexEvidence/InhouseRead-20261012/rust-pdf-figures`.

Publicación160: fuente `3737d6540f0ace149a5f35dab4e4ab4a6420a327`,
Pages `f8199486ba5b98fecaba9b64d92f9d91d30ca217`, deploy38202984265 y
Pages38203042445 aprobados.99 recursos/HTML/precarga exactos; núcleo
público200 páginas/15000 imágenes,1432 recortes idénticos. APK1.1.15/code28,
SHA/tamaño/loader2107 verificados. Evidencia: published-1791778620973.
UI pública160:6/6 (37,8s), orden y32 imágenes repetidas, sin reintentos.
La comprobación del navegador limpio y la UI adaptable adicional siguen pendientes.
Publicación159: respuesta real de main/WASM idéntica en dos perfiles frescos.
CI15838201058813: fallan ambos contratos de cierre nativo; luces y barra de
estado pasan sólo al reintentar. Se conservan los originales completos en
rust-pdf-order/ci158-ui2 yci158-ui3. No se consideran resueltos.

# Migración 1.7.162 — párrafos y posiciones PDF en Rust

Changelog: «Párrafos PDF más rápidos en Rust». El núcleo calcula el espaciado
habitual de cada columna, cortes de párrafo, unión de fragmentos, guiones
opcionales y todos los offsets UTF-16. El navegador conserva su clasificación
Unicode exacta y entrega los objetos de PDF.js con sus metadatos originales.
Menos de128 fragmentos usan la implementación anterior. Cachés de clasificación
limitadas a512 caracteres de inicio/final; reservas nativas liberadas por llamada.

El primer port era más lento en páginas pequeñas: se conserva browser.json.
La copia sucesiva de toda la cadena al cortar cada línea también hacía crecer
el coste de las páginas largas. Se construye la cadena una sola vez y se
obtienen después todos sus fragmentos. Se eliminan objetos temporales de la
transferencia. La mejora medida combina Rust y esta preparación del navegador;
no se atribuye exclusivamente al lenguaje ni representa el tiempo de apertura.
Ensayo final Chromium CPU×4, nueve tandas alternadas de20 llamadas:
-32 líneas/128 fragmentos/4128 caracteres: JS0,220ms/Rust0,145ms.
-128 líneas/512 fragmentos/16512 caracteres:1,380/0,415ms.
-256 líneas/1024 fragmentos/33024 caracteres:4,840/0,885ms.
-512 líneas/2048 fragmentos/66048 caracteres:38,310/1,950ms.
Memoria estable tras calentamiento. Originales: browser.*, browser-joined.*,
browser-bounded.*. No se cambia ninguna regla de orden ni de párrafos.
23 pruebas nuevas;60/60 focalizadas. Incluyen200 páginas aleatorias, Unicode
astral, pares sustitutos, clasificación al vaciar cachés, errores y memoria
creciente. Tres extracciones completas acreditan llamadas al WASM real.
2/2 E2E adicionales:100 páginas Unicode yPDF real fragmentado/rotado con
ilustraciones y todas sus fuentes/posiciones exactas. Build aprobado;
WASM357831 bytes, SHA
`4a3fc12579fbb9debe78fd0b09b1ab83a76f10723cc8fd05afd0beecf446f599`.
4617/4617 unitarias en348 archivos (284,97s), sin omisiones.
22/22 E2E del lector/adaptación/imágenes/navegación yvoz Davefx real (2min),
sin omisiones ni reintentos, además de2/2 dePDF real/Unicode ynúcleo medido.
Publicación162 pendiente. Evidencia:
`D:/CodexEvidence/InhouseRead-20261012/rust-pdf-stream`.

Publicación161: fuente `d181fcfbf55123bbf5e737330d924f92209ce174`,
Pages `2bc3665bde5d0153906578a5505cf6fec0b221b0`, deploy38203788834 y
Pages38203840899 aprobados.99 recursos/HTML/precarga exactos, núcleo público
200 páginas/6140 ilustraciones idénticas. APK1.1.15/code28 yloader2107
verificados. Evidencia: published-1791779350668. UI pública161 pendiente.
Publicación160 completada:14/14 E2E públicas (6+8), sin reintentos, yrespuestas
reales de main/WASM idénticas en dos perfiles de navegador limpios.

CI15938201985254 conserva los dos fallos de cierre nativo deUI2 yel
reintento de la barra de estado deUI3. Originales en rust-motion/ci159-ui2
yci159-ui3. La captura deUI3 muestra un aviso real del updater; la causa
de su entrada en esa prueba se investiga sin modificar los plazos.

## 1.7.163: mallas de madera

El núcleo crea tableros biselados y perfiles redondeados con los mismos
132 vértices y atributos exactos. Se preserva la triangulación de Three,
la escala física de las vetas, las normales y el sombreado de la madera.
Pruebas y mediciones completas en `remaining-wip-verification.md`.
La migración sigue siendo parcial: UI, estado, persistencia y otros módulos
aún dependen del navegador y de JavaScript.

## 1.7.164: superficies de las lámparas

Pigmento, relieve y rugosidad de madera, lino y metal se generan en Rust
por lotes acotados, conservando cada píxel y los materiales de Three.
Mediciones completas y fallos originales en remaining-wip-verification.md.

Recuento 1.7.164: 2898 líneas no vacías en35 fuentes Rust frente a36111
en194 módulos JS propios:7,43% del total Rust+JS. Incluye comentarios,
excluye pruebas, dependencias, CSS/HTML y código Android; no mide porcentaje
funcional migrado. La conservación temporal de fallbacks añade código JS.

## 1.7.165: compactación de mallas BAGGEBO

Rust compara atributos completos, conserva costuras y genera los índices
y atributos compactos exactamente como antes. Reserva de entrada reutilizada
para salida; geometrías independientes y límites calculados por Three.
Pruebas y mediciones en remaining-wip-verification.md.

## 1.7.166: metal expandido de BAGGEBO

Rust genera los bordes compartidos, recortes, facetas, UV y normales exactas
de la rejilla. Se mantiene la geometría física de sus aperturas y la misma
compactación; no se sustituye por una textura. Cada modelo preparado se libera
tras copiar sus atributos. Ver evidencia en remaining-wip-verification.md.

## 1.7.167: pintura y postes BAGGEBO

Los UV de todas las piezas de pintura se transfieren juntos al núcleo,
evitando una llamada por raíl. Rust también suaviza las paredes redondeadas
sin alterar las tapas. Los atributos siguen siendo los mismos objetos de Three.
El primer ensayo individual fue más lento y está conservado; ver resultados
y limitaciones en remaining-wip-verification.md.

## 1.7.168: previsualización de relieves

Rust remuestrea los mapas y calcula las normales y reflejos de cada píxel.
Se conservan los ocho renglones por fragmento, la cancelación y todos los
canales RGBA del cálculo anterior. Véanse comparaciones exactas, tiempos y
límites en remaining-wip-verification.md.

## 1.7.169: conversión de mapas de relieve

Una llamada Rust convierte los tres planos de material a RGBA. Los resultados
son independientes y el generador mantiene sus ImageData y materiales. El
umbral evita llamadas pequeñas; datos y errores tienen una ruta compatible.
Véanse pruebas y mediciones en remaining-wip-verification.md.

## 1.7.170: clasificación y bisel de pigmentos

La membresía, distancia y altura física de cada pigmento comparten una
reserva Rust. Conserva propiedad exclusiva, precisión de altura, puntos de
cancelación y recuperación de fallos parciales. La distancia ya estaba en
Rust; el ensayo compara contra esa versión previa, con sus mapas reutilizados.
Ver remaining-wip-verification.md para resultados y limitaciones.

Recuento1.7.170:3128 líneas no vacías en38 fuentes Rust y36303 en197 módulos
JavaScript propios:7,93% del total Rust+JS. Incluye comentarios y excluye
pruebas,dependencias,CSS/HTML y Java Android. No mide porcentaje funcional;
las rutas de compatibilidad siguen siendo código JS. La migración completa
continúa pendiente.

## 1.7.171: plan de trama de los libros

Rust genera tinte y comandos de trama con el mismo PRNG, incluido su estado
posterior. La comparación conserva cada byte de Canvas y cada operación.
La preparación aislada mejora ligeramente; el dibujo/subida a GPU domina
el tiempo total y las repeticiones no demuestran una mejora visible.
4752/4752 unitarias y3/3 UI reales. Detalles y ensayos originales en WIP.

Recuento171:3183 líneas Rust en39 fuentes y36344 JS en197 módulos: 8.05% de Rust/(Rust+JS). Incluye comentarios y alternativas JS; no mide funciones completadas.

## 1.7.172: decoración compilada por separado

La geometría de plantas y sus superficies, junto con las texturas de lámparas,
residen en inhouse_read_decor.wasm. El resto utiliza inhouse_read_core.wasm.
Ambos comparten fuente del ABI/cargador, pero cada instancia tiene su memoria,
promesa de arranque y recuperación. El dominio evita aceptar el binario ajeno.
El build sigue generando y verificando ambos artefactos sin imports del host.

La caché mantiene sus dependencias exactas y conserva los modelos al cambiar
únicamente Rust del lector o de los libros. Dos recompilaciones reales en un
laboratorio prueban la independencia en ambas direcciones. Añade17060bytes de
binario y1114112bytes de memoria inicial; no se oculta ese coste ni se reduce
la calidad. 4769/4769 unitarias. WIP conserva las pruebas y sus límites.

## 1.7.173: máscara de las letras de portada

El recorte del título, su área y sus tres series de puntos se producen en Rust.
Se conservan orden, umbral de alfa100 y muestreo exactos. La memoria temporal
sólo reserva los1280 puntos finales; mantiene salidas propias y recuperación.
En Chromium con CPU×4 mejora el cálculo para las18combinaciones medidas, con
rasters y resultados idénticos. La elección completa de fuente también coincide.
El nuevo módulo de app conserva exactamente la caché/WASM de decoración172.
El primer fallo de la fixture CSS y su corrección están documentados en WIP.

173:4783/4783 unitarias y11/11 UI, incluida la apariencia guardada desde la estantería compilada.

## 1.7.174 — preparación de imagen del título

Escala de grises, plano de tolerancia de bordes y clasificación de textura en
font_prepare_pixels. Una asignación de entrada/salida; salida propia; conserva
la ruta JS para menos de 4096 píxeles y ante indisponibilidad de WASM. 15 pruebas
comparan todos los RGB y planos exactos. CPU×4:192×288 con bordes 6,937→4,287ms,
transferencias incluidas. Sin bordes no se aprecia mejora. Decoración conserva
sus bytes y caché. Estado de publicación y controles inferiores en WIP.

## 1.7.175 — preparar después de la espera de fuentes

La primera comprobación pública de174 ejecutó la alternativa JavaScript en
escala de grises antes de que llegara el puente dinámico. Se conserva ese fallo.
La espera de fuentes existente se mueve antes de elegir la ruta; no se amplía
el tiempo límite ni se bloquea el primer fotograma. Un test con fuentes retenidas
comprueba el orden y la elección del núcleo que llega durante esa espera.
Los binarios WASM y sus cachés no cambian. Verificación pública en WIP.


## 1.7.176 — selección del relieve integrada en sus normales

`relief_normal_selected_rows` calcula los mismos RGB de iluminación y empaqueta
la selección en alfa durante el mismo recorrido en Rust. El modelo 3D consume
esa salida directamente: desaparecen su copia RGBA y su recorrido JS por píxel.
Se mantiene la alternativa JS, el contrato de normales opacas por defecto, los
puntos de cesión cada 16 filas y salidas propias para trabajos cancelables.
La recomposición de intensidades conserva el formato seleccionado.

Comparación en Chromium, CPU×4, nueve rondas alternadas y transferencias incluidas:
128² con máscara 3,20→2,32ms; 256² 11,78→9,18ms; 512² 45,32→35,66ms.
Sin máscara 512² 70,80→46,56ms. Es la mejora del cálculo medido, no del lector entero.
Ahorra una asignación RGBA de 1048576 bytes a 512². Los ocho escenarios mantienen
estable la capacidad de memoria tras calentamiento. App WASM 326337 bytes;
decoración permanece exactamente igual, sin invalidar sus modelos guardados.
Las pruebas comparan todos los canales contra algoritmos previos y ejercitan
cancelación, memoria creciente, entradas inválidas y recuperación sin WASM.
El editor real compara cada bloque generado con el núcleo de normales anterior
más el empaquetado JS, comprobando además la invocación del nuevo export.
Estado final y evidencia de publicación en remaining-wip-verification.md.

## 1.7.178 — recortes de imágenes PDF

`pdf_image_paths` produce los vértices ordenados de cada imagen PDF, conservando
su sentido incluso con reflexiones y solapamientos. El adaptador hace una sola
asignación limitada a32768 imágenes y devuelve una copia propia; el navegador
ejecuta el mismo clip y vuelve a pintar los colores originales. A partir de
ocho imágenes se elige Rust; las páginas menores mantienen JavaScript.
Núcleos anteriores, memoria insuficiente o export ausente conservan la ruta JS.

El núcleo de app pasa a326873bytes; decoración no cambia ni pierde su caché.
Las pruebas usan la implementación previa congelada, resultados f64 exactos,
comparación RGBA, memoria creciente y la app compilada en cuatro temas.
CPU×4:512 imágenes 1,104→0,152ms, incluyendo copias y despacho Canvas, sin GPU.
Esta fase mantiene el arreglo del inicio nativo del audiolibro publicado177.
Estado de pruebas y publicación en remaining-wip-verification.md.

## 1.7.179 — sombras de contacto de la estantería

`shelf_occlusion` genera las sombras de esquinas, baldas, base y papelera y el
halo opcional de luz del suelo. El navegador conserva sus80muestras de seno y
coseno y la normalización de dimensiones; Rust produce directamente posiciones
f32 y colores RGBA en una asignación limitada, sin listas por triángulo.
Se conservan orden, valores, límites y la ruta de recuperación JavaScript.

200combinaciones se comparan exactamente con el código original congelado.
La app compilada compara además la imagen completa, con y sin iluminación,
frente a un perfil que usa el generador anterior. La mejora medida CPU×4 de
1,235→0,485ms para tres baldas iluminadas incluye copias, atributos y cálculo
de límites, no renderizado GPU. App WASM347129bytes; decoración sin cambios.
Estado de pruebas y publicación en remaining-wip-verification.md.

## 1.7.180 — tempo de voz en Rust

`speech_tempo` adapta AMDF/PICOLA de Sonic (Apache-2.0) a mono Float32,
velocidades 1–3× y marcas de página. Generación normal antes de acelerar:
las pruebas reales reprodujeron omisiones de palabras con latentes comprimidos.
Arena acotada, scratch fijo, sin asignación dentro del kernel; se conserva el
final de la onda y se mapean las marcas con cada tramo. El host copia los arrays
transferibles y libera el arena. Fallback JS equivalente para núcleo frío/antiguo.
35 pruebas nuevas comparan bytes, tono, marcas, límites y memoria.
WASM app 350219 bytes; decoración idéntica. Ver evidencia y límites de las
mediciones en remaining-wip-verification.md. UI y motores ONNX no se han
migrado por este cambio; no se afirma que toda la aplicación sea Rust.

## 1.7.181 — reconocimiento de cabeceras

`sniff_book_format` clasifica PalmDOC/MOBI y FB2 sin construir strings binarios.
El host lee y copia como máximo 200 bytes. PDF y ZIP conservan sus comprobaciones
directas en JS: cruzar la frontera WASM para esos prefijos era más lento.
Se conservan las prioridades de extensión, firma y motor; fallback original
cuando el núcleo está frío o es antiguo. No hay heap dentro del kernel.
18 pruebas focales comparan 4000 entradas generadas, firmas truncadas, vistas
con offset, límites, lecturas Blob y memoria. La app compilada importa un FB2
real y muestra sus párrafos utilizando el kernel instrumentado.
Medianas de nueve rondas, navegador con CPU×4, copia/puente/objeto incluidos:
MOBI 1,58→0,56 µs, FB2 4,92→0,70 µs, desconocido 29,78→1,40 µs.
PDF/ZIP mantienen el mismo camino y quedan en el suelo de medición (~0,08 µs).
Son tiempos de clasificación de cabecera, no tiempos de apertura de libros.
WASM app 351121 bytes; decoración y audio sin modificaciones.

## 1.7.182 — preferencias y estilo del lector

`reader_preferences` normaliza tamaños, interlineado, márgenes, zoom, brillo,
peso y velocidad. `reader_nearest_rate` mantiene las cinco velocidades y sus
empates. `reader_css` construye el estilo de papel, sepia, noche, AMOLED y
salvia, con las cuatro familias tipográficas y ambas alineaciones. El host
conserva coerciones de valores de JavaScript, objetos de voces instaladas,
DOM y persistencia. No se migró todo ReaderExperience por este cambio.
Los estilos decodificados se reutilizan en el puente con un límite de 64,
identidad de módulo y todos los campos que afectan al CSS en su clave.
Las alternativas anteriores siguen disponibles si el núcleo no está listo.

Se comparan exactamente 1000 combinaciones CSS, coerciones, límites y tasas.
La primera medida completa de estilo y layout CPU×4 detectó sobrecoste
(0,3275 ms JS frente a 0,3850 ms Rust). Se conserva como benchmark-idle.log.
Tras reutilizar estilos: 0,3925/0,3775 ms; la dispersión impide atribuir una
aceleración significativa. La caché sí elimina formatos/copias repetidos:
1001 solicitudes del caso unitario generan 24 estilos, con memoria estable.
WASM app 378694 bytes; la diferencia incluye formato decimal de Rust.

Inventario reproducible: `node scripts/rust-migration-status.mjs`. Antes de
esta entrega, 3528 líneas Rust y 36636 JS = 8,78 %. Se cuentan líneas no
vacías, incluidos comentarios y alternativas; se excluyen dependencias,
pruebas, HTML/CSS y Android nativo. No es porcentaje funcional ni cobertura.
