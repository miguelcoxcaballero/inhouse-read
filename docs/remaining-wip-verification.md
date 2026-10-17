# 1.7.266 — operaciones atómicas de biblioteca en Rust

Changelog: «Biblioteca en Rust y reposo más estable».
Rust asume la creación del ID de origen, consulta por ID, detección de retiradas, mezcla de campos al abrir/importar, progreso, metadatos condicionados, portadas, retirada y asociación de subidas tardías de Drive. Se conserva el criterio para reconocer alias del mismo libro y la marca mínima de retirada, sin bytes, portada, texto ni estado de lectura. Una reimportación explícita restaura sus alias; una subida tardía no vuelve a ocultar un libro ya restaurado.

Las lecturas, decisiones y escrituras permanecen en la misma transacción y esperan su confirmación como el original. Se carga el módulo antes de abrir una transacción de escritura; no se espera una descarga dentro de ella. La conexión inicial de IndexedDB, esquema 2, peticiones, promesas de confirmación, lecturas de listas, orden inicial y comparación de registros mantienen su adaptador actual. Estas dos últimas decisiones síncronas quedan para el siguiente bloque, para conservar el paralelismo del primer dibujo y las lecturas de mallas. No se presenta toda la biblioteca como ya migrada.

La prueba real de arrastre detectó además un libro apoyado entre poste y maceta que conservaba ruido mínimo del solver y no dejaba dormir al renderizador. Rust reconoce ahora un apoyo cuya pose permanece dentro de 0,25 mm y 0,002 rad durante 0,75 s de simulación, y lo pone en reposo sin cambiar su pose. Desplazarse, empujar, levantar o retirar un apoyo reinicia esa ventana. No se congela una caída libre ni se modifica geometría, textura o resolución.

Los helpers mantienen la evaluación perezosa de campos, null frente a undefined, plantillas de ID con UTF-16 y conversiones que pueden fallar. Se usa el módulo compartido ya cargado de UI o Shelf. No se crean callbacks Rust persistentes que retengan conexiones o bibliotecas.

Build completo correcto. Las 50 pruebas específicas iniciales pasan en cinco archivos, incluidas sesiones con IndexedDB real de prueba comparadas con la clase congelada, bytes, guardas atómicas, retirada, alias/cuentas, reimportación, subidas tardías, conversiones/getters de ID y 30 ciclos de transacciones aceptadas/rechazadas sin handles retenidos.

La batería general completa se ejecutó antes del ajuste final aislado de reposo físico, en cuatro bloques seriales: **6488 casos distintos**. Tras reverificar los siete archivos específicos (141 casos pasan sobre el mismo binario), quedan **6487/6488** verificados correctamente. Solo persiste el timeout de 5000 ms preexistente del corpus de 200 000 perfiles de color (6,31 s en esta ejecución), sin cambiar corpus, aserciones o límite. La otra discrepancia era una aserción de anchura anterior a la petición de 263: esperaba 11 en vez de 15,4. Se comprueba ahora el ancho un 40 % mayor con la misma precisión y todas las poses; no se cambia la geometría ni se relaja la comprobación de continuidad. Los hashes/corpus de compatibilidad siguen intactos. No hay fallos nuevos de biblioteca. Tras el ajuste final de física, 142 casos específicos pasan en siete archivos sobre el binario final: incluyen 18 casos físicos y el nuevo apoyo poste/maceta seguido de retirada y caída. No se repite la batería general para ese ajuste aislado; la biblioteca no cambia después de ella.

Ocho E2E distintos pasan sobre el binario final en dos ejecuciones sin reintentos: colocación real de libro y planta con posiciones conservadas al recargar (39,4 s), seguida de siete casos en una ejecución (3,8 min). Cubren importación/reapertura PDF y EPUB, regreso nativo con framebuffer intacto, zoom sin repintados WebGL ni cambios de buffer durante el gesto y seis portadas a 1024 px, reposo tras soltar, empujón lento que mueve cuatro vecinos, enderezado y barrido rápido tranquilo, y papelera sin shaders nuevos ni reconstrucción de escena. Se revisa la captura del agarre vertical. La prueba de colocación había detectado la vibración de contacto corregida; conserva sus aserciones y límite original. No se cambian calidad o materiales.

Inventario: 32832 líneas Rust / 20758 JavaScript, **61,27 %**; incluye comentarios y compatibilidad, no funciones terminadas. Se continúa con comparación/orden de registros, arranque y coordinación de la aplicación.

# 1.7.265 — almacenamiento y nombres seleccionados en Rust

Changelog: «Almacenamiento y nombres del lector en Rust».
Las decisiones de visibilidad por cuenta, descarga pendiente, bytes originales, conservación o invalidación de revisiones y errores de almacenamiento pasan a Rust. El traspaso al lector copia únicamente los nombres editables del libro seleccionado, conservando valores vacíos explícitos y evitando campos heredados. UI y Shelf compilan el mismo módulo; el adaptador usa el que ya esté cargado. El propietario de IndexedDB y sus transacciones sigue siendo la biblioteca existente.

Se conservan los bytes Blob sin conversión a texto, la identidad del error de origen, el código LOCAL_BOOK_STORAGE_FAILED y el receptor de los callbacks. La copia de campos reproduce las propiedades propias enumerables, símbolos y __proto__ como dato, sin invocar setters del prototipo. Se mantiene el orden de los getters y las dos pasadas de filtro/copia de los nombres, además del cortocircuito de llamadas opcionales. No hay nuevos callbacks nativos persistentes.

Build completo correcto; **143 pruebas en 14 archivos pasan** sobre el binario final. Cubren bytes exactos tras reapertura, cuotas y errores, revisión de Drive, progresos, comparaciones con las funciones JavaScript congeladas, símbolos/prototipo/getters, nombres editados antes de mostrar la página, 50 ciclos de éxito/fallo sin handles/callbacks retenidos, biblioteca, cola de recuento, Drive y apertura/cierre. No se cambian corpus existentes, aserciones ni tiempos límite.

**Cuatro E2E finales pasan en una ejecución sin reintentos (1,8 min)**: PDF/EPUB reales y recuento conservado tras recarga, página PDF guardada visible en el modelo 3D antes del zoom con píxeles preservados, capítulo EPUB del CFI guardado durante la bisagra y regreso a 390×845 conservando framebuffer/canvas. No se modifica el renderizado ni las texturas.

Inventario: 32694 líneas Rust / 20877 JavaScript, **61,03 %**; incluye comentarios y compatibilidad, no funciones terminadas. No se repite la batería general completa; queda documentado su timeout de color preexistente. Se continúa con la biblioteca y la coordinación de la aplicación.

# 1.7.264 — recuento completo y cola de libros en Rust

Changelog: «Recuento de libros y cola en Rust».
Rust asume el recuento completo por idioma, las ventanas acotadas y su contexto final, los límites de cancelación, el recorrido de capítulos EPUB incluidos los suplementos, el recorrido de todas las páginas PDF y la detección de cómics sin texto. También elige el parser según el archivo, mantiene sus importaciones perezosas y libera siempre los parsers creados. La cola nativa conserva un trabajo a la vez, deduplicación, reintentos, errores y comprobaciones de la revisión antes de guardar. La navegación no cancela la medición; sustituir o eliminar el contenido sí la invalida.

Los metadatos compartidos de volumen, completitud, revisiones y Drive se compilan tanto en UI como en Shelf. Un consumidor usa su módulo ya cargado y no introduce un await en una transacción IndexedDB. La primera versión del WIP exigía Shelf desde Drive; se corrigió esa dependencia antes de publicar. La construcción de la cola no inicia descargas ni retiene cierres Rust que posean la biblioteca. El host conserva importaciones, APIs de DOM/Intl/PDF.js, temporizadores y continuaciones de JavaScript que se pueden recoger con GC.

La segmentación del navegador se entrega en lotes tipados, con índices UTF-16 y sin una llamada de frontera por palabra. La búsqueda de separadores usa una cola corta y, si hace falta, la ventana completa; el final absoluto conserva CRLF y separadores Unicode. El prototipo con llamadas individuales tenía una regresión grande y no se publicó. Medición final Node, tres repeticiones y 300 000 caracteres: medianas nativas de 13,59 ms en inglés, 9,42 ms en español y 49,23 ms en chino; referencia JavaScript 11,14 / 7,41 / 49,07 ms. Los totales coinciden. No se presenta como una mejora de velocidad en todos los idiomas ni como una medición de móviles físicos.

Build completo correcto y **236 pruebas específicas en 21 archivos pasan sobre el binario final**. Incluyen recuentos frente a la referencia congelada, fragmentación y cancelaciones en distintos idiomas, texto artificial largo, CRLF, sustitutos UTF-16 aislados, getters y errores, lectores reales PDF/EPUB/CBZ, cola completa frente a su instantánea anterior, revisiones de bytes, limpieza de handles/callbacks y memoria estable, almacenamiento local, Drive y apertura/cierre. Se conservan los corpus, aserciones y límites de tiempo. El ayudante Node de escenarios E2E carga ahora el módulo real para crear sus metadatos, como ya hace la página.

Ocho E2E quedan verificadas sobre el binario final en dos ejecuciones, sin reintentos automáticos: importaciones reales de PDF de 9000 palabras y EPUB de 23, revisiones/bytes intactos, llamadas WASM reales y reapertura sin analizar otra vez; catálogo perezoso, conservación del tomo/canvas/página al volver y ausencia de dibujos ocultos; zoom con seis portadas a 1024 px, luces, reposo, empujón de cuatro vecinos y barrido rápido tranquilo. La primera ejecución cerró siete casos y encontró un supuesto incorrecto del escenario de empujón: el cuarto vecino ya estaba tumbado contra el poste y no debía desplazarse. Se conserva la exigencia de mover cuatro vecinos, pero se empuja desde el extremo izquierdo hacia espacio libre, con muestras más lentas; ese caso pasa en una ejecución aislada de 51,6 s. No se cambia la simulación ni se rebaja la aserción.

Inventario: 32614 líneas Rust / 20910 JavaScript, **60,93 %**; incluye comentarios y compatibilidad, no funciones terminadas. No se repite en este bloque la batería general completa; su timeout de color preexistente sigue documentado. Se continúa con políticas de almacenamiento y coordinación de la aplicación, y el resto de la migración.

# 1.7.263 — física tranquila y cinta en una sola página

Changelog: «Física más suave y marcapáginas corregidos».
El agarre de Rust endereza el libro mediante un muelle y una transición de 280 ms, compensando la altura de un ejemplar tumbado. Un toque breve conserva el reposo. Los movimientos rápidos separan temporalmente el libro sostenido de los contactos; al moverlo despacio vuelve a empujar con fuerza limitada cuando está vertical y sin interpenetraciones. Se amortiguan velocidades y giros, se elimina el rebote y se limita el impulso al soltar. Permanecen las colisiones reales, pilas, dominó lento y caída al retirar apoyos.

Los límites físicos usan el grosor de los laterales y baldas dibujados: madera 12/0,65 y 15/0,65 mm; metal BAGGEBO 18 y 16,5 mm. Se añaden los techos de cada hueco y un límite de las esquinas rotadas para libros muy finos. La superficie de contacto conserva 0,6 mm de separación del límite corrector para no provocar vibración ni despertar indefinidamente cuerpos asentados. No cambia el modelo, las texturas, la iluminación ni su resolución.

La geometría Rust del marcapáginas es un 40 % más ancha y conserva su espesor. La parte insertada queda en el plano de una sola página; el giro empieza fuera del canto superior. Se reutilizan las mismas mallas, atributos y materiales al abrir, cerrar y actualizar el progreso. Los exports anteriores conservan sus bytes originales; los corpus congelados completos siguen comprobándolos mediante una opción explícita de compatibilidad. La aplicación usa la geometría nueva.

Build completo correcto y **114 pruebas específicas en 12 archivos pasan sobre el binario final**. Incluyen 17 casos físicos: empujón lento frente a barrido rápido, colocación sobre otro libro, enderezado animado, libros de menos de un milímetro junto a postes de madera y metal, toque que deja dormir, apoyo retirado, separación de cuerpos, reposo, IDs UTF-16 y recuperación tras fotogramas lentos. Se conservan todas las aserciones físicas originales. El escenario sintético de huecos inferiores incorpora ahora el grosor real de la balda en su techo; la comprobación de metadatos aísla dibujo/picking con settleBooks:false, conservando todas sus aserciones y su presupuesto. La física permanece activada en producción y sus escenarios propios.

Seis E2E finales pasan en una ejecución de Chromium sin reintentos (2,1 min): cinta en libro abierto/cerrado con WebGL real, proyección con todos los píxeles idénticos a su referencia, pellizco iniciado sobre libro, seis portadas a 1024 px y luz con efecto medido, reposo tras soltar, cuatro vecinos movidos por un arrastre y enderezado seguido de barrido rápido sin mover los vecinos en reposo. Durante el zoom no hay repintados WebGL ni reasignaciones del buffer. Se revisaron las capturas de la cinta y del agarre. Se usa un servidor nuevo del worktree, sin reutilizar otro build.

Inventario: 32191 líneas Rust / 21146 JavaScript, **60,35 %**. Cuenta fuentes propias, comentarios y compatibilidad; no mide funciones terminadas. No se repite en este bloque la batería general de 6466 casos; permanece documentado su timeout de color preexistente. Siguiente: completar y optimizar el contador de texto y su cola en Rust, y continuar el resto de la migración.

# 1.7.262 — ciclo de vida de la estantería en Rust

Changelog: «Ciclo de vida de la estantería en Rust».
La inicialización del estado, cambios de vista, preparación diferida del catálogo, gestos, redimensionado, fuentes, actualizaciones aplazadas, acciones públicas y limpieza pasan a Rust. Los módulos nativos se llaman entre sí sin volver a los antiguos wrappers de JavaScript. El host conserva el registro de eventos DOM y los adaptadores de las APIs del navegador. La destrucción repetida conserva las llamadas de limpieza originales y libera el contexto nativo una sola vez; no se retiene otro contexto para llamadas posteriores. La revocación de URL recorre el Set vivo, como el original.

Build completo correcto. Las 681 pruebas específicas se han comprobado en varias ejecuciones sobre el mismo binario, tras actualizar los escenarios de renderizado descritos a continuación. Incluyen sesiones enteras frente a la referencia congelada, destrucción repetida, regreso del lector y ciclos de apertura/cierre sin acumular handles ni callbacks.

La batería ampliada detectó escenarios de renderizado que presuponían posiciones inmóviles. Se reprodujeron los mismos 41 fallos en ocho archivos de main 261. Estos escenarios conservan sus entradas y aserciones, pero usan settleBooks:false para aislar dibujo y picking; la simulación sigue activada de forma predeterminada y se verifica por separado. Las pruebas de sombras esperan ahora que terminen las promesas de calidad tras soltar el gesto, manteniendo el límite de un repintado. Otros escenarios estáticos de picking/papelera y la prueba puntual de solapamiento entre libro y foco recibieron el mismo aislamiento; las demás pruebas de lámparas conservan la física activada. El corpus completo del plan de voz usa el adaptador de párrafos intencional de 259 sobre sus referencias congeladas; se conservan todos los textos, índices y comprobaciones de memoria.

La batería general completa se ejecutó en cuatro bloques seriales: 6466 pruebas distintas. Tras reverificar los cinco archivos ajustados (145 pruebas pasan en una ejecución), quedan **6465/6466** comprobadas correctamente sobre el mismo binario. Solo falla el timeout de 5000 ms ya documentado del perfil de 200 000 colores en cover-relief-job-wasm.test.js. No se amplía ese límite ni se reduce el corpus. Los casos de marcadores de página comprueban ahora los dos fragmentos separados por la línea vacía y el offset relativo correcto del segundo párrafo; se añade la comprobación de ausencia de marcador en el primero.

Las 12 E2E finales pasan en una ejecución de Chromium sin reintentos (3,9 min): catálogo perezoso, apertura y retorno PDF conservando canvas/framebuffer, ausencia de repintados ocultos, bordes móviles de madera y BAGGEBO, límite de escritorio, pellizco iniciado sobre libro y calidad recuperada, luz encendida/apagada, reposo tras soltar, biblioteca antigua con cuatro vecinos movidos y cambio de estantería conservado al recargar. El servidor se crea desde este worktree; se desactiva su reutilización para evitar comprobar otro build.

Inventario: 32102 líneas Rust / 21146 JS, **60,29 %**; incluye comentarios y compatibilidad, no mide funciones completadas. Siguiente: recuento completo de texto, cola de metadatos y resto de migración.

# 1.7.261 — zoom y sustitución de calidad en Rust

Changelog: «Zoom más fluido y portadas nítidas».
Rust decide la preparación, validez, cancelación y sustitución de modelos y mapas de inspección. Las decodificaciones escalonadas se agrupan durante un máximo de 48 ms desde la primera llegada. Al soltar el zoom se conserva la última imagen correcta mientras termina el lote, con una espera acotada de 240 ms; el gesto no espera. La imagen se oculta después de preparar los programas y la madera, evitando un fotograma vacío. Los libros tumbados usan su mayor dimensión proyectada para elegir textura, conservando 1024/2048 según tamaño. No se rebaja geometría, materiales, sombras o resolución del renderizador.

La zona táctil de las lámparas de pie se recorta a su silueta convexa, calculada en Rust, para que sus esquinas vacías no bloqueen libros. Los focos pequeños del techo conservan la zona táctil ampliada. No cambia la imagen de las lámparas.

Build completo y 80 pruebas en siete archivos pasan sobre el binario final: incluyen 26 sesiones completas contra la referencia congelada, preparación/cancelación/rechazo de mapas, presupuesto de espera, geometría de toque, libros caídos, física y reposo. La comparación heredada conserva settleBooks:false y batchQuality:false para mantener la cadencia original; los valores de producción están activados y se prueban por separado. No se modifican referencias congeladas, corpus, aserciones ni tiempos límite.

Tres E2E de Chromium móvil pasan en una ejecución final sin reintentos: pellizco iniciado sobre un libro, portadas nítidas, lámpara encendida/apagada y apertura/cierre del libro; libro soltado que se asienta y deja dormir la GPU; biblioteca antigua y arrastre que mueve cuatro vecinos. Durante los 20 pasos del gesto no hubo repintados WebGL ni reasignaciones del buffer. Las seis portadas recuperaron 1024 px y la luz mantuvo un efecto medible. Una ejecución anterior reutilizó por error el servidor del build 260; se cerró y se repitió el archivo completo contra el build 261. No se presentan aquellos resultados como verificación del candidato.

Medición repetida final: Chromium SwiftShader, 390×844, DPR 1, tres contextos nuevos y cuatro gestos en cada uno. Frente a 260, los repintados de los doce gestos pasan de 27 a 13 (cero durante el movimiento en ambos). La mediana de asentamiento del primer zoom pasa de 1,79 a 1,05 s, aproximadamente un 42 % menos. Las seis portadas alcanzan 1024 px, frente a una en 260. Modelos, sombras de 1024 y DPR 1 se mantienen. Son medidas de esta escena y GPU por software, no FPS garantizados en teléfonos físicos. Se revisaron las capturas del mismo encuadre.

Inventario: 31869 líneas Rust / 21313 JS, **59,92 %**; cuenta fuentes propias incluidas compatibilidad y comentarios, no funciones completadas. No se repite la batería general en este bloque; sigue pendiente el timeout de color preexistente. Siguiente: ciclo de vida de la pantalla y resto de migración.

# 1.7.260 — colisiones y caídas de libros en Rust

Changelog: «Colisiones y caídas de libros en Rust».
Se sustituye la inclinación objetivo de 258 por cuerpos rígidos Rapier 3D en Rust: volumen, masa, fricción, contactos, apoyos entre libros y pilas. El movimiento está restringido al plano lateral de la leja. El agarre aplica una fuerza elástica limitada; puede empujar vecinos y provocar caídas en cadena. Retirar un libro, incluido abrirlo en el lector, despierta los apoyados. Los libros sostenidos viajan delante de las baldas y recuperan el contacto con ellas al soltarlos, conservando la posición real dentro de la leja elegida.

Las bibliotecas guardadas calculan sus apoyos al abrirse sin tocar los libros. El asentamiento inicial se prepara antes del primer dibujo con un presupuesto de CPU de 80 ms; el trabajo restante se anima. El paso físico sigue siendo 120 Hz, con recuperación limitada y adaptada al número de cuerpos activos cuando el renderizado tarda. Un evento después del reposo no simula el tiempo inactivo como una caída nueva. Los cuerpos duermen al asentarse y también puede dormir un libro sostenido si el dedo no se mueve.

La escena entrega en un lote a Rust el movimiento de todos los libros. No se modifica geometría, materiales, texturas o luz. Se selecciona la calidad del modelo inicial y se difieren las sustituciones durante la caída. El módulo de estantería mide 3 132 KB aproximadamente (sin comprimir; consultar el build para bytes exactos), frente a 1 290 KB antes de incorporar el motor. El motor se incluye únicamente en el módulo de estantería; el módulo del lector conserva 2 879 965 bytes. No es una medición de rendimiento en un móvil físico.

Verificación: 39 pruebas específicas pasan en cuatro archivos con el binario final, incluidos 11 casos físicos, proyección, 100 000 llamadas sin retener handles JS, planificación, calidad inicial y reposo de la malla real. Antes del ajuste final del reloj pasaron las 26 sesiones originales de comparación; conservan la API explícita settleBooks:false y no se modifican sus referencias ni su corpus. Son 65 casos distintos comprobados en este bloque. Tres E2E de Chromium móvil pasan sobre el binario final: soltar y dejar la GPU en reposo; cargar una biblioteca antigua y mover cuatro vecinos; arrastrar realmente libro/planta entre lejas y recargar sus posiciones. Las tres se cerraron en dos ejecuciones sin reintentos automáticos. Se revisó la captura de contactos final.

No se ha repetido la batería general en este bloque; permanece documentado el timeout preexistente de color. Inventario: 31695 líneas Rust / 21332 JS, **59,77 %**. No cuenta dependencias, código generado ni tests y no mide funciones completadas. Siguiente: zoom y selección de calidad de portadas tumbadas, después resto de migración.

# 1.7.259 — pausas entre párrafos y lectura contextual de años

Changelog: «Pausas naturales y años según idioma».
Los bloques DOM distintos introducen una pausa aunque no haya puntuación. Un salto visual dentro del mismo párrafo no corta la frase. Los espacios del código HTML se colapsan según CSS; pre/pre-wrap/pre-line/break-spaces conservan sus líneas. En texto PDF una línea vacía separa párrafos, sin confundir CRLF con dos saltos. Se conservan los índices UTF-16 y el resaltado. La síntesis mantiene su descanso de 240 ms entre fragmentos.

Se amplían los años contextuales a alemán, neerlandés y lenguas escandinavas, y se distingue el año chino de cantidades/duraciones. Las unidades cercanas prevalecen sobre el contexto temporal; una coma seguida de otra cantidad ya no convierte un año inglés en cardinal. 348 pruebas específicas en 11 archivos y dos E2E de Chromium móvil pasan con los binarios finales. Las referencias congeladas no se modifican: un adaptador únicamente de pruebas aplica el nuevo contrato después de la máscara original de cabeceras. Build completo correcto. No se ha repetido la batería general en este bloque; permanece documentado el timeout de color ajeno al audio.

Inventario: 31593 líneas Rust / 21315 JS, **59,71 %**; mide líneas propias, no funciones terminadas. Siguiente prioridad: sustituir la inclinación de 258 por colisiones reales, cadenas de caída y pérdida de apoyo en Rust. Después zoom y resto de migración.

# 1.7.258 — libros que se apoyan y plantas dentro de su leja

Changelog: «Libros con apoyo animado y plantas ajustadas».
La gravedad y el contacto se calculan en Rust: un libro movido se inclina hacia el libro alcanzable
más próximo de la misma leja, con aceleración y amortiguación, manteniendo la esquina inferior sobre
la balda. Los libros en contacto permanecen rectos. Macetas y lámparas de pie bloquean el paso;
los focos del techo no. La animación termina, respeta movimiento reducido y reutiliza modelos y
texturas. Identificadores UTF-16 distintos conservan estados independientes. No es un simulador de
cuerpos rígidos: un vecino ya inclinado no se utiliza como apoyo y no se provoca una caída en cadena.

Se elimina la separación predeterminada de 3 px, incluida la regla CSS, y la celda artificial más
ancha que los lomos finos. Las posiciones guardadas a mano conservan sus huecos deliberados y las
zonas táctiles siguen ampliadas. Las plantas altas se escalan uniformemente dentro de su leja,
conservando proporciones, semilla, maceta, color y posición guardada; ya no saltan al techo del mueble.
El catálogo indica que se ajustan a la leja. No se reduce geometría, resolución de texturas o materiales.

Build completo final y 225 pruebas finales pasan en 14 archivos. Incluyen seis casos de física,
la transformación real de la malla y su reposo, 6000 muebles degenerados, dimensiones de todas las
combinaciones de planta/maceta, edición, retorno y movimientos. Se mantienen las referencias JS
congeladas. Las comparaciones reciben la nueva política de espacio (gap 0, sin celda adicional) y
la etiqueta de ajuste esperada; no se reducen escenarios ni aserciones. Los 26 escenarios completos
de escena verifican la API opcional settleBooks:false frente a la referencia anterior; la gravedad
está activada de forma predeterminada en producción y se comprueba por separado.

Batería general previa en cuatro grupos: 6418 casos, 6362 pasan; 55 fallos por las expectativas de
separación/diagnóstico antiguas se cierran en la reverificación final, y se añaden dos regresiones
UTF-16/foco de techo. En conjunto quedan validados 6419 de 6420 casos distintos; el único fallo
restante es el timeout preexistente de cover-relief-job-wasm para 200000 colores: 6234 ms frente a
5000 ms, también reproducido en main antes de estos cambios. No se amplía ese límite. La general
precede las dos correcciones aisladas de identificadores/focos, el ajuste de etiqueta y la opción de
compatibilidad; esas rutas y comparaciones se verifican con el binario final mediante las 225 específicas.

Cuatro E2E finales pasan en 1,3 minutos, sin reintentos: acceso al libro fino junto a una planta,
catálogo usable a 320 px, MONSTERA dentro de su leja en ambas estanterías y caída del libro con GPU
en reposo al terminar. Captura de contacto inspeccionada. Chromium usa SwiftShader; no se afirma
un rendimiento medido en un móvil físico. Se conserva el dist final como base 258 para medir el zoom.
Inventario 31572 líneas Rust / 21315 JS: 59,70 %, fuente, no porcentaje de funciones terminadas.
Revisión propia, sin delegación. Siguen pendientes pausas entre párrafos, optimización de zoom y
resto de la migración a Rust; se conservan sus worktrees.

# 1.7.257 — años según el contexto

Changelog: «Lectura contextual de años en inglés».
Rust distingue fechas con preposición temporal, año explícito, mes, era o rango fechado de cantidades
con unidades y monedas. En inglés, «in 1969» se sintetiza «nineteen sixty-nine»; «1969 books» conserva
la forma cardinal. Los números aislados ambiguos conservan la forma cardinal. La detección es heurística,
no un analizador semántico completo. Los demás idiomas conservan su conversión cardinal localizada.
No cambia el texto del lector ni los offsets originales del resaltado; se transforma sólo la petición de voz.

Build completo y rebuild web de versión; 146 pruebas en cinco archivos pasan, incluidos 14 casos nuevos
y conservación de marcas UTF-16. Dos E2E pasan (mapa del lector móvil y normalización/síntesis numérica
con fecha y cantidad en la misma frase). No se repite la batería general para esta corrección localizada.
Inventario 31502 líneas Rust / 21292 JS: 59,67 %, inventario de fuentes, no funciones completadas.
Revisión propia, sin delegación. Quedan pendientes gravedad/contacto animado, separación de libros,
plantas altas dentro de las lejas, pausas entre párrafos, optimización de zoom y resto de migración.

# 1.7.256 — lector con menos margen vertical

Changelog: «Más espacio para el texto del lector».
Parche rápido solicitado: margen interno vertical del EPUB 12 → 4 px y separación vertical exterior del PDF
14/20 → 4 px. Se renueva exclusivamente la caché de cajas de página (v3 → v4), para que una altura
antigua menor no siga dejando una franja vacía. No se elimina la caché anterior ni los libros, posiciones o
preferencias. Tipografía, márgenes laterales, áreas seguras y tamaños táctiles se conservan; audio/retorno
siguen compartiendo una fila fija para no cambiar las líneas al mostrar u ocultar controles.

Build completo; 25 pruebas específicas pasan en tres archivos, incluidos 200 escenarios del lector congelado,
6000 pasos de caché y una regresión de altura antigua. Las referencias JS congeladas no cambian; la expectativa
se adapta únicamente al margen intencional de 4 px y al nombre de la caché. Seis comprobaciones E2E pasan:
PDF compacto, EPUB móvil/escritorio, normalización del audiolibro, mapa/resaltado y la regresión de caché vieja.
Las cinco primeras pasan juntas; la última pasa aislada tras corregir el acceso del test al iframe del
paginador, cuyo shadow root es cerrado, sin relajar ninguna aserción. En 390×844 se midieron 704 px de página
sobre 704 px disponibles, y exactamente 4 px de margen superior e inferior. Captura móvil inspeccionada.
La corrección es localizada y urgente: no se repite toda la batería para estas dos constantes y el CSS.

Se cierra además la verificación pendiente de 1.7.255: batería general en cuatro shards, 6397/6398 pruebas
pasan en 498 archivos. El único fallo es el timeout conocido de cover-relief-job-wasm de 200000 colores,
6571 ms frente al límite original de 5000 ms, reproducido también en la base y ajeno al audio. La nueva
prueba de años históricos y límites de siglo (13 casos del archivo) pasa. Los dos E2E de normalización y
mapa de voz pasan con el código final de audio, incluido en este binario. No se reducen corpus ni límites.

Inventario 31465 Rust / 21292 JS, 59,64 %; recuento de líneas de producción, no funciones terminadas.
Pendiente prioritario: optimizar zoom y repintado isométrico y continuar la migración completa.

# 1.7.255 — años pronunciables y referencias de notas

Changelog: «Años claros y referencias de notas omitidas».
Los enteros aislados, incluidos los años, llegan a síntesis escritos en palabras del idioma de la voz.
La conversión es Rust y usa num2words2-core 0.1.3 (MIT/Apache-2.0), con inicialización perezosa por idioma y
despacho estático; cubre todos los idiomas actualmente ofrecidos por Piper y Supertonic. Se reconocen cifras
ASCII, árabes, devanagari y de ancho completo, y años pegados a texto chino/japonés. Las cadenas con ceros
iniciales se leen dígito a dígito. Identificadores alfanuméricos, decimales, cifras con separadores y enteros
mayores de 18 dígitos conservan su tratamiento anterior; no se interpreta su significado por adivinación.

El cambio se aplica a la petición de síntesis, también a la preparación anticipada. Las entradas de cola,
claves de caché, texto del libro y offsets del lector siguen siendo los originales. Se traducen los offsets
al texto pronunciado y se restauran antes de entregar las marcas al reproductor. Si un número ocupa menos
caracteres al convertirse, se conservan todas las marcas originales incluso si coinciden en el mismo instante.

El mapa de narración omite referencias EPUB identificadas como noteref/doc-noteref y backlinks, y enlaces
numéricos en superíndices o cuerpos de notas, incluidos destinos en otros archivos del EPUB. Se conserva
el texto de las notas, los años y enlaces numéricos ordinarios y los superíndices matemáticos. Con notas
deshabilitadas, se omiten también referencias acotadas *N; x*2 sigue intacto. No se borra el contenido de
apartados o anexos por contener números.

Build Rust/web completo y 362 pruebas específicas en 10 archivos pasan, con casos explícitos de todos los
idiomas del catálogo, coordenadas UTF-16, referencias a notas, superíndices, síntesis anticipada, marcas
originales en el reloj audible y números chinos que se contraen. JavaScript congelado sin cambios.
18 E2E del audiolibro pasan (PDF/EPUB, seguimiento de página y capítulo, pausa/cancelación y cuatro temas),
con un worker y cero reintentos, sobre la compilación anterior a los ajustes finales de texto CJK,
marcas coincidentes y enlaces relativos de anexos. Esos tres ajustes pasan las 362 pruebas específicas
con el binario final; la repetición de dos E2E sobre él sigue pendiente al publicar por petición de rapidez.

UI Rust 2810349 bytes (la primera implementación con despacho dinámico ocupaba 4232116 y no se publica).
El incremento de UI frente a 1.7.254 es aproximadamente 783 KB; este módulo sigue siendo perezoso y no se
ha añadido al módulo temprano de la estantería. Shelf conserva 1289562 bytes; core/decor/voice no cambian
frente a 1.7.254. La prueba de síntesis usa un cliente simulado para comprobar el texto y el reloj: no se
ha descargado cada modelo de voz ni se ha evaluado auditivamente cada idioma.

Publicación adelantada a petición expresa de la persona. La batería general continúa: primer shard
1800/1800 pasa; el segundo ha reproducido el timeout de cover-relief-job-wasm (200000 colores,
6571 ms frente a 5000 ms), ya reproducido en main 1.7.252 y documentado en 1.7.253. Esa función del
módulo shelf no cambia en esta entrega. No se han relajado plazos, muestras, aserciones ni reintentos.
Inventario 31465 Rust / 21292 JS, **59,64 %**; recuento de producción, no funciones terminadas.
Se continúa con la verificación pendiente y el zoom isométrico. No se ha realizado una revisión
independiente nueva ni prueba auditiva de todas las voces.

# 1.7.254 — omitir marcas decorativas en el audiolibro

Changelog: «Narración sin marcas decorativas».
Corrección rápida solicitada antes del zoom: el normalizador compartido en Rust trata §, ¶, viñetas,
ornamentos florales y el glifo de sustitución como espacios al narrar. No cambia el texto del libro;
conserva los índices UTF-16, las separaciones de párrafos, los límites de página y el resaltado.
No elimina monedas, porcentajes, operadores matemáticos, letras de otros idiomas ni emojis.

Build Rust/web completo; 261 pruebas específicas pasan en 6 archivos, incluidos los 65536 códigos UTF-16,
los planes completos y sus índices. La expectativa diferencial se adapta exclusivamente a las diez marcas
cuyo comportamiento cambia intencionalmente; el JavaScript congelado no se modifica.
Dos E2E pasan con Chromium, un worker y sin reintentos: normalización real (incluye § y viñetas) y lector
móvil con resaltado de nodos originales. Se han conservado límites y corpus. No se ha repetido toda la
batería de 6379 pruebas para esta corrección localizada; el fallo de tiempo previo consta en 1.7.253.
Inventario: 31305 líneas Rust / 21292 JS, 59,52 %; recuento de producción, no funciones terminadas.
Pendientes: optimización del zoom y repintado isométrico, y continuación de la migración.

# 1.7.253 — filas y controles de entrada de la estantería en Rust

Changelog: «Filas y controles de estantería en Rust».
Los constructores de filas, libros, plantas y lámparas, sus estados de pulsación/tacto, validación del contacto,
clic de compatibilidad, teclado, arrastre, apertura y borrado viven en screen_nodes.rs. También los estados
vacío/de preparación, mensajes de geometría y acciones iniciales. El render y las sustituciones de portada
llaman directamente a los constructores nativos. Los identificadores, textos accesibles y callbacks conservan
sus cadenas UTF-16 y receptores; el estado de geometría se consulta en Rust con el mismo fallback.

La prueba de ciclos detectó un problema real del primer port: al borrar una planta se repintaba la fila y se
retiraban antes de tiempo los listeners del objetivo de lámpara ya capturado. La lámpara no se borraba y el
número de lámparas reales crecía. Se conserva el comportamiento de esos objetivos: el DOM/GC posee un pequeño
adaptador que solo entrega eventos a un dispatcher nativo débil compartido; todas las decisiones y cambios de
estado siguen en Rust. No se retienen nodos por separado desde Rust y al destruir la pantalla se retiran sus
callbacks. El diagnóstico temporal no forma parte del código publicado.

Cinco nuevas pruebas cubren repintado/destrucción repetida con contadores nativos y capacidad WASM, alias de
acciones y Drive deshabilitado, ambos vacíos, mensajes de geometría y receptores de retry/apertura, textos
accesibles con receptor y UTF-16, y el borrado de una lámpara capturada después de borrar la planta vecina.
Las 678 pruebas específicas en 69 archivos pasan, incluidas las comparaciones con el JavaScript congelado y
las pruebas de recursos. No se han relajado muestras, aserciones, plazos ni reintentos.

Build final de Rust y web completos. Inventario 31299 Rust / 21292 JS, 59,51 % (1.7.252: 58,68 %); recuento de
líneas de producción con comentarios, no funciones terminadas. Inicialización, ciclo de vida, catálogo raíz y
parte de la API pública de la pantalla, app.js y la cola larga siguen pendientes.

Batería completa congelada en cuatro shards: 1800 + 1374 + 1422 + 1782 = 6378 pruebas pasan; una de 6379 falla
por tiempo, en 497 archivos. Es cover-relief-job-wasm «gives the original profile for 200 000 colours…»:
6573 ms frente a su límite original de 5000 ms. La función de perfiles no cambia en este port. La misma prueba
se ha ejecutado por separado con candidato y build/código de main 1.7.252, un worker, y falla por el mismo
límite en ambos (candidato 6240 ms y main 6381 ms); el resto de sus 38 casos pasa en ambos. Ejecutar solo ese caso también
excede el límite. Se registra como fallo de tiempo reproducido en la base, sin aumentar el límite ni reducir
su corpus. La batería de 1.7.252 había pasado antes en este mismo entorno; no se oculta esta variación.

Binarios frente a 1.7.252: shelf 1239810 → 1289562 bytes (+49752); UI general mantiene 2027162 bytes,
con SHA variable entre construcciones. Core/decor/voice conservan sus bytes, y la firma del bake de modelos
sigue siendo 47972dc16ce28e84aca9. Revisión propia de equivalencia y propiedad de recursos; no hay una nueva
revisión independiente de tres revisores ni comprobación en móvil físico/GPU real.

Navegador: 35 E2E pasan (28 escena/pantalla + 7 editor/catálogos), un worker y cero reintentos.
Seis estados visuales pasan frente a 1.7.252: cinco idénticos y uno (13) con diferencia máxima de 1/255;
la repetición del mismo estado con la base 1.7.252 reproduce ese máximo de 1/255. Se inspeccionaron las
capturas de BAGGEBO isométrica y de las lámparas. Arranque, tres pares alternados con Chromium/SwiftShader:
primera escena mediana 3644,7 → 3907,1 ms (rangos 3452,8–3654,4 / 3539,3–3966); primer lomo
5754,7 → 5186 ms (5036–8085 / 5047,6–5764,3); DCL 192,7 → 146,2 ms. La primera escena aún no tiene
libros y el primer lomo no implica calidad asentada. No se declara una aceleración a partir de estas muestras.

# 1.7.252 — render, refresco y preferencias de la pantalla en Rust

Changelog: «Render y refresco de la estantería en Rust».
El módulo bookshelf toma ahora el render de la pantalla: guardas de visibilidad/animación, planificación,
colocación inicial, medidas DOM para la escena, conservación del mueble ya pintado y restauración del foco.
También refresco, adopción de metadatos sin repintar, programación/cancelación de RAF, preparación inicial de
portadas, argumentos y preferencias guardadas. Los subárboles DOM y los controles de entrada aún se construyen
en JavaScript; sus llamadas al navegador siguen pasando por los mismos adaptadores. No se ha terminado
app.js ni la cola larga de módulos de la aplicación.

Revisión de equivalencia: dos nuevas pruebas diferenciales fallaban antes de la corrección porque los callbacks
de opciones perdían su receptor (`this`): portada, persistencia, colocación y retirada vuelven a invocarse como
métodos del objeto de opciones. El callback de apertura conserva la selección hecha en el constructor y se llama
sin receptor, incluso cuando un hook de preparación reemplaza la opción después. Otra prueba diferencial
comprueba ese caso. El await de un callback opcional de portada ausente conserva su turno. Se mantienen las
referencias JavaScript congeladas; no se cambiaron umbrales, aserciones, plazos ni reintentos.

Inventario 30881 Rust / 21744 JS, 58,68 % (1.7.251: 57,95 %); cuenta líneas de producción con comentarios, no
funciones terminadas. Compilación Rust/UI y build web completos. Pruebas específicas: 673 en 69 archivos;
batería completa final congelada: 1800 + 1375 + 1421 + 1778 = 6374 tests en 497 archivos, todos verdes.

El binario shelf pasa de 1179926 a 1239810 bytes (+59884). UI general mantiene 2027162 bytes; su SHA no es
determinista en esta construcción. Core (540704), decor (117167) y voice (57372) son idénticos byte a byte;
la firma del bake de modelos sigue siendo 47972dc16ce28e84aca9. Revisión propia de equivalencia y ciclo de vida;
no se ha realizado una nueva revisión independiente de tres revisores. Sin prueba en móvil físico ni GPU real.

Navegador final: 28/28 generales en 10,0 min y 7/7 de editor/catálogos en 4,0 min. Se verifican viewport móvil,
zoom sin repintar durante el gesto, calidad al soltar, colocación, arrastre y retorno, 80 libros en pantalla,
editor/teclado/relieve y cierre durante análisis, añadir las tres lámparas, sus interruptores y los gestos de
la bombilla, y preview 3D de plantas con acabado persistente. Mismos tests, aserciones, plazos y reintentos.

Comparación visual contra el build de 1.7.251: 6/6 estados 01/02/08/10a/13/15 PASS con los umbrales originales;
cuatro idénticos y 10a/13 con máximo 1/255, ningún píxel difiere más de 2. Repetir el mismo build 1.7.251 en
10a y 13 da también máximo 1/255 (solo esos dos estados). Inspección de las capturas de BAGGEBO isométrica y
las cuatro lámparas frontales. No se han cambiado las geometrías ni los materiales para conseguir el resultado.

Arranque, tres pares alternados 1.7.251 → 1.7.252, seis libros guardados + BAGGEBO/planta/lámpara, contextos
nuevos de Chromium/SwiftShader: primera escena mediana 3428,3 → 3574,9 ms (rangos 3188–3619,8 y
3444,2–3920,4); primer lomo DOM 5591,1 → 5578,3 ms (4568,3–6783,2 y 4711,1–5607,2);
DOMContentLoaded 171,2 → 179,5 ms. Rangos solapados; no se afirma una aceleración. La primera escena aún
contiene cero libros y el primer lomo no certifica que todas sus texturas/modelos estén asentados.

# 1.7.251 — editor, portadas y movimientos de la estantería en Rust

Changelog: «Editor y movimientos de la estantería en Rust».
Se integra wip/shelf-ui, mezclada con main 1.7.250. El módulo bookshelf de Rust controla el libro extraído,
su editor (tipografía, color, materiales, brillo y relieve), apertura/cierre, entrega al lector y retorno,
resolución y análisis de portadas, plantas y lámparas, arrastre, colocación, interruptores y papelera. Los
constructores de la pantalla, render/refresco, ResizeObserver, Three.js y app.js siguen en JavaScript:
esto no termina la migración de la pantalla ni de toda la aplicación.

El original queda congelado en tests/unit/helpers/reference-bookshelf.js. Las pruebas diferenciales comparan
el documento completo, llamadas y orden de callbacks, errores y temporizadores. Los 56 tests iniciales pasan.
Al ampliar cobertura se reprodujo una divergencia real de claves: Rust String convertía un sustituto UTF-16
suelto en U+FFFD y mezclaba las portadas de dos identidades distintas. Las claves e identidades ahora permanecen
como cadenas JS (JsValue), con concatenación y comparación controladas desde Rust. Una prueba diferencial que
fallaba antes y cinco casos nuevos de identidad/título y recorrido por retorno, teclado y papelera verifican
su corrección; las claves de arrastre, colocación y retorno se conservan también como cadenas JS. El conjunto
específico suma 61 tests; con los contratos de presión, contacto, caché y viewport son 140 tests en 14 archivos, todos verdes.
Se eliminan las funciones de movimiento JS ya huérfanas (animate, waitForMotion y wait) y sus constantes sin uso.
El diagnóstico de diferencias ya usa un directorio temporal portable, conservando referencias y aserciones.

Las cinco pruebas de ciclo de vida pasan; además de asas JS y callbacks, ahora comprueban que la memoria lineal
WASM no crece tras calentar durante los ciclos de editor, entrega/retorno, arrastre y objetos. Se prueba también
destruir la pantalla durante un arrastre, borrado y análisis. Inventario: 30436 Rust / 22088 JS, 57,95 %
(frente a 50,96 %); recuento de líneas de producción con comentarios, no porcentaje de funciones terminadas.

El arnés restaura las preferencias y posiciones iniciales entre referencia y candidato, evitando que un guion
que mueve objetos condicione la segunda ejecución. Los informes diferenciales guardan JSON con los sustitutos
UTF-16 escapados; un archivo de texto UTF-8 perdía justo la distinción que se estaba comprobando.
La revisión es propia (equivalencia, orden y ciclo de vida); no se ha realizado una nueva revisión independiente
de tres revisores. Se conserva toda la cobertura, aserciones y umbrales de la referencia.

Compilación final de Rust 1.99.0 y wasm-bindgen 0.2.105 y build web completos. Batería final congelada:
1799 + 1374 + 1421 + 1777 = 6371 tests en 497 archivos, todos pasan. El módulo shelf crece de 594313 a
1179926 bytes (+585613); UI general mantiene 2027162 bytes, y core/decor/voice conservan sus bytes. No hay
prueba en móvil físico ni una promesa de mejora de velocidad; se midió el arranque y se contrastó la vista
antes de publicar. La firma del bake de modelos no cambia por el port de los controles.

E2E finales: 28/28 generales en 10,1 min (bookshelf-polish, mobile-shelf-viewport, shelf-motion-performance,
shelf-placement y smoke) y 7/7 específicos en 3,9 min: pestañas y teclado del editor, relieve/persistencia,
cierre durante análisis, añadir los tres diseños de lámpara, interruptores y gestos de la bombilla y preview
3D de la planta con persistencia del acabado. No se cambiaron aserciones, tiempos ni reintentos.
Comparación visual contra el build de 1.7.250: 6/6 estados 01/02/08/10a/13/15, cinco idénticos píxel a píxel y
13 con máximo 1/255, ningún píxel difiere más de 2; PASS. Repetición del mismo build 1.7.250 en 13: también
máximo 1/255. Se inspeccionaron las vistas de BAGGEBO isométrica y las cuatro lámparas frontales.

Arranque Chromium/SwiftShader, móvil 390x844, seis libros sembrados y BAGGEBO/planta/lámpara, tres pares alternos:
primera escena mediana 3546,6 -> 3575,1 ms, rangos 3314,1–3740,2 y 3433,8–3594,8 (solapados); primer lomo DOM
6061,9 -> 4835,0 ms, rangos 5133,9–6999,7 y 4785,7–4959,7; DOMContentLoaded 161,1 -> 157,2 ms. La primera
escena aún no contiene los seis libros; estos son hitos de arranque, no la carga completa de los modelos. Tres
muestras en software GL no permiten prometer esa mejora del primer lomo en un móvil real. El arranque de la
primera escena se mantiene dentro del ruido. Core/decor/voice comprobados idénticos byte a byte; UI general
conserva tamaño pero cambia su hash (artefactos de wasm-bindgen no deterministas); firma del bake conservada:
47972dc16ce28e84aca9. No se han probado dispositivos físicos.

# 1.7.250 — cámara, encuadre y posiciones de la escena en Rust

Changelog: «Cámara y posiciones de la estantería en Rust».
La unidad scene se integra desde wip/scene después de mezclar main 1.7.249. Los cálculos de cámara,
transición frontal/isométrica, zoom y desplazamiento de inspección, proyección de cajas y puntos de colocación,
cinemática y calidad de los libros/plantas/lámparas, tapa y caída a la papelera, catálogo y retorno y planes del
mueble viven ahora en scene_view.rs, scene_entries.rs, scene_frame.rs y scene_plan.rs. Three.js, WebGL,
DOM, canvas y la aplicación de estos resultados siguen en bookshelf-scene.js; no se ha migrado toda la escena.
La referencia JavaScript anterior queda solo en tests/unit/helpers. Se conserva el orden de operaciones f64,
Math del motor y redondeos. Dos divergencias encontradas antes de publicar quedaron corregidas con pruebas que
fallaban antes: validación de superficie antes de leer el rayo/filas y el último módulo en cantidades fraccionarias
de muebles. El bucle Rust queda además limitado al buffer de salida para cantidades enormes.

Inventario: 25736 líneas Rust / 24771 JS, 50,96 % (1.7.249: 49,82 %); cuenta líneas de producción, incluidos
comentarios, no funciones terminadas. Compilación Rust 1.99.0/wasm-bindgen 0.2.105 y build web completos.
Cuatro bloques de tests unitarios: 1780 + 1349 + 1408 + 1768 = 6305 tests en 491 archivos, todos pasan.
E2E: 28/28 en 10,2 minutos, un solo Chromium/SwiftShader: bookshelf-polish (9), mobile-shelf-viewport (3), shelf-motion-performance (1), shelf-placement (2) y smoke (13). En esta ejecución también pasan los contratos de cierre/retorno de este conjunto, aunque el traspaso documenta fallos históricos por tiempo; no se cambió ninguna aserción ni duración.
Los tests diferenciales de escena incluyen 24 sesiones completas, una sesión fraccionaria, 20.000 proyecciones,
20.000 uniones de rectángulos y 20.000 impactos; las pruebas de entradas incluyen 100.000 objetivos y llamadas
repetidas, parámetros inválidos y asas JS. Se mantienen las referencias originales y los umbrales.

Comparación visual Chromium/SwiftShader, móvil 390x844, estados 01/02/08/10a/13/15 contra 1.7.249:
cinco imágenes idénticas; 13 difiere como máximo 1/255, ningún píxel difiere más de 2. Repetición de referencia
contra sí misma para 08/13: idéntica y máximo 1/255 respectivamente. También se inspeccionaron las capturas.
La prueba E2E de movimiento isométrico conserva la caché: 20 fotogramas del compositor, cero fotogramas GPU y cero escrituras de buffers durante el gesto; al soltar recupera seis libros nítidos con texturas de 1024 px. Es un contrato de trabajo evitado, no una medición de fluidez en móvil real.
La firma del bake guardado sigue siendo 47972dc16ce28e84aca9, evitando invalidar modelos por esta migración.
El módulo shelf pasa de 519711 a 594313 bytes (+74602); core/decor/voice son idénticos byte a byte. El módulo UI
general conserva su tamaño (2027162 bytes), pero no su hash: los artefactos de wasm-bindgen no son deterministas.

Arranque, tres pares alternos, Chromium nuevo por contexto, seis libros sembrados, BAGGEBO/una planta/una lámpara,
SwiftShader sin ralentización artificial: mediana primera escena 3754,7 -> 3614,4 ms; rangos 3167,6–3990,8 y
3607,4–3706,8. Primer lomo DOM 5299,9 -> 5216,5 ms; rangos 4707,3–7112,8 y 4630,6–5448,1. DOMContentLoaded
163,1 -> 165,3 ms. La primera escena todavía no contiene los seis libros: son hitos de arranque, no carga completa
ni una promesa de velocidad. Sin prueba en móvil físico. Revisión propia de equivalencia numérica, orden y ciclo
de vida; no se ha realizado una nueva revisión independiente de tres revisores.

# 1.7.249 — geometría 3D: plantas, lámparas y la decisión de sus luces en Rust

Changelog: «Plantas, lámparas y su luz en Rust; sin gemelos JS».
Unidad geometry-3d. La planta completa (maceta, follaje, tierra, fusión por material, ajuste al hueco y registro
«bake» de la escena) la dibuja ahora el módulo `shelf` de `rust-ui` (`plant_parts.rs`, `plant_model.rs`) sobre las
primitivas three.js ya escritas operación por operación (`three_geo.rs`, `three_shape.rs`) más las nuevas
(`three_curve.rs`: `CatmullRomCurve3`, `TubeGeometry` y marcos de Frenet; `three_math.rs`: vectores, cuaterniones,
Euler y color; torus, esfera, icosaedro y lathe en `three_geo.rs`). `shelf-plants.js` solo conserva los materiales,
las texturas (clones, calidad, color de maceta) y la construcción de objetos a partir del registro, tanto de una planta
nueva como de una guardada. La geometría de las tres lámparas (disco MITTLED, trípode, farol; `lamp_model.rs`) y su
emisor de luz también llegan como paquete (`geo-packet.js` lo abre). Se eliminan del núcleo decor los seis kernels de
geometría de planta (`plant_leaf`, `plant_cactus`, `plant_ivy`, `plant_monstera`, `plant_pot`, `plant_subdivide`), sus seis
puentes JS (`plant-*-wasm.js`), `benchmark-plant-geometry.mjs` y `tests/helpers/candidate-shelf-plants.js`; el núcleo
decor pasa de 150.068 a 117.167 bytes. La versión del «bake» guardado (`scripts/shelf-bake-version.mjs`) ahora incluye los
fuentes Rust del generador (no los bytes del wasm, que wasm-bindgen no produce de forma determinista).
La decisión de las luces de las lámparas (`lamp_light.rs`, `shelf-lamp-lighting.js`): cuántas luces recibe cada tipo de
lámpara, qué lámparas están encendidas (la que se arrastra, luego las que ya lo estaban, luego las más cercanas al centro de
la vista, con el orden de claves del idioma como desempate), qué hueco de luz toma cada una, y todos los números con
que se orienta cada luz (posición, color con su tinte, intensidad, alcance, cono y cámara de sombra, tiras de los filamentos,
uniformidad de la transformación de la sala). La escena three.js, los sellos de cambio y el orden de las llamadas siguen
en JS. El original JS congelado queda en `tests/unit/helpers/reference-shelf-*.js`. Tests unitarios nuevos:
three-curve-wasm, lamp-geometry-wasm, plant-parts-wasm, plant-model-wasm y lamp-lighting-wasm (9: 400 salas con más de
17.000 fotogramas y 4,6 millones de datos comparados bit a bit, más cupo, transformación de sala, buffers inválidos y
fugas); el fixture de rust-plant-preview carga ahora el módulo shelf (la geometría de las plantas es suya); E2E nuevos: rust-plant-model, rust-lamp-geometry, rust-lamp-lighting (Chromium real). Se eliminan los tests
unitarios y E2E de los seis kernels (el tema pasa a pruebas diferenciales contra el original congelado).
Verificado aquí (Linux, Chromium/SwiftShader): build:rust y build; 4 bloques de tests unitarios (1760+1345+1371+1741 = 6217
tests, 122+122+122+120 archivos), todos verdes; E2E que pasan: rust-plant-model, rust-lamp-geometry, rust-lamp-lighting,
lamp-switches (2), shelf-light-effect, lamp-catalog (3), book-finish-lighting, shelf-types (2), rust-baggebo,
rust-timber, rust-shelf-occlusion, rust-shelf-occlusion-production (2), rust-lamp-surface, rust-plant-preview, y
plant-catalog (8; una vez falló «un gesto táctil desde las hojas…» mientras yo compilaba en la misma máquina y pasa sola
en 46 s). Comparación visual contra un build de main 1.7.246 (estados 01, 02, 08, 10a, 13, 15): 4 idénticos bit a bit y 2
con diferencia máxima de 1/255 en el texto de los lomos (08, 13); PASS; los cuatro estados con lámpara encendida son
idénticos.
Mediciones (CPU 4x más lenta, medianas alternando; no son promesas de velocidad): planta completa
(monstera / sansevieria / chamaedorea / nephrolepis / hedera / zamioculcas / succulent / cactus), JS frente a Rust: 40,5 / 17,6 /
40,7 / 85,5 / 68,1 / 29,0 / 20,3 / 36,7 ms frente a 19,2 / 11,1 / 21,5 / 45,4 / 33,7 / 18,2 / 12,6 / 15,8 ms, primera planta
247 ms frente a 130 ms; lámparas (disco / farol / trípode): 3,4 / 22,0 / 23,9 ms frente a 2,0 / 9,5 / 9,1 ms; la
decisión y orientación de las luces de una sala con 14 lámparas NO es más rápida: 0,110 ms por fotograma en JS frente a
0,132 ms en Rust (el paso de datos cuesta más que las cuentas). Tamaño: módulo shelf 342.953 -> 505.073 bytes; decor
150.068 -> 117.167; núcleo app 509.768 sin cambio (todo 1.7.246 -> ahora: shelf 180.836 -> 505.073, decor 149.481 ->
117.167, núcleo 500.440 -> 509.768). Arranque (banco de arranque, 6 libros, 3 ejecuciones alternas cada uno, máquina
compartida): primera escena 4743 ms (main 1.7.246) frente a 4487 ms (esta versión), rangos 4140–4765 y 4208–4706, dentro del
ruido; DOMContentLoaded 426 ms frente a 496 ms (rangos 425–437 y 464–539, no se solapan: unos 40–100 ms más tarde),
primer lomo en el DOM 11.872 ms frente a 11.185 ms (rangos solapados). Límites: fallan igual en main
(comprobado en un build de origen/main 1.7.246) rust-plant-glaze, rust-plant-pottery, rust-plant-soil, rust-plant-foliage
(cuentan como fuga el arenero fijo de 128 bytes de decor-catalogue.js) y bookshelf-resource-reuse «el lector no repinta
la estantería oculta al cambiar su viewport» (la página PDF no llega a ajustar su ancho al nuevo viewport antes de que venza el tiempo). Los dos
fallos conocidos del cierre en GL por software no se tocaron ni se ejecutaron. Las claves de las lámparas se comparan
con `localeCompare` en JS (depende del idioma del dispositivo) y solo se recalculan cuando cambia el conjunto de lámparas;
claves NaN y coordenadas infinitas en los rectángulos (el comparador original deja de ser un orden total) no están
cubiertas: ninguna aparece en la app; dos entradas con el mismo objeto y las lámparas aún sin modelo sí lo están. `emitter.color` debe ser un número, como lo produce el
módulo. Tras un error en un fotograma (claves repetidas), el original y el nuevo lanzan el mismo TypeError; con claves
únicas ninguno falla.
Comprobación independiente antes de publicar (rama final, ya mezclada con la 1.7.248): tres revisores de
solo lectura (plantas, lámparas y su luz, ciclo de vida y cobertura) no hallaron ninguna divergencia de
comportamiento en la geometría de las plantas (conteo y orden de las extracciones del generador aleatorio por
variante, orden de los almacenamientos f32, funciones trascendentes siempre por `js_sys::Math`, y los
internos de three 0.180 contrastados uno a uno) ni en la geometría y la luz de las lámparas; la corrección
de 1.7.247 del pintado fino fallido sigue intacta. Observaciones corregidas aquí: cuatro fixtures E2E
(rust-plant-foliage, glaze, pottery y soil) construían plantas sin cargar el módulo shelf y fallaban antes de sus
comprobaciones (ahora lo cargan y cuentan el arenero fijo de 128 B del catálogo decor); las pruebas de «sin
fugas» de plantas y lámparas solo miraban asas de JS y ahora comprueban también que la memoria lineal de WASM
no crece tras calentar; se borró el ayudante huérfano tests/helpers/plant-geometry-benchmark.mjs y las
exportaciones muertas de plant-leaf-cases.mjs; plant-catalog-models comprueba que el torno de la maceta
acanalada tiene 96 segmentos. Tras mezclar con la 1.7.248: build:rust y build; 4 bloques de tests unitarios
(1766+1347+1377+1765 = 6255, todos verdes) y los tests tocados de nuevo (159, verdes). E2E en la rama mezclada:
de 52 pruebas, 41 pasan en la primera ejecución con la caja a carga ~14 por otros procesos y 11 fallan; repetidas
a solas con prioridad alta pasan las cuatro rust-plant-* corregidas, los dos libros móviles de book-opening y
cinco de las seis de plant-catalog (la sexta, «una planta cae como modelo 3D en la papelera…», pasó a solas en 39 s
después de fallar dos veces con la caja cargada, igual que en la 1.7.247). No se repitió la comparación visual
sobre el árbol mezclado: la del agente (contra main 1.7.246, antes de mezclar: 4 de 6 escenas idénticas y 2 a
±1/255, solo texto de lomos) y la de la 1.7.248 (26 escenas, 17 idénticas y el resto a ±1/255) no cubren el
árbol final de plantas y lámparas; queda pendiente para quien continúe (tools/visual-harness).
Inventario 24758 Rust/24933 JS = 49,82 % (la rama sola, antes de mezclar la 1.7.248: 23740/25382 = 48,33 %; main 1.7.248: 22958/25963 = 46,93 %); no es porcentaje funcional.

# 1.7.248 — modelo del libro: geometría, texturas y vista en Rust

Changelog: «Libro 3D: geometría, texturas y vista en Rust».
Unidad book-model (`src/js/book-model.js` y sus puentes). Pasa a Rust, con las mismas cifras y las
mismas llamadas que antes:
- Núcleo (`rust-core`): `book_view.rs` (tamaños del lienzo y de las ventanas compactas, ventana del
  fotograma de vuelta con la reserva que fija un vuelo, rectángulo copiado a la instantánea,
  colocación y rotación del modelo con su tema de página, límites proyectados de página y tapas,
  pose del zoom a la página, pose de lectura con el libro abierto, ajuste de imagen); `book_motion.rs`
  (muestreador monótono total y el reloj en tiempo real: paso máximo entre 48 y 100 ms según la duración, 48 ms el primero, sin
  tocar ningún tiempo); `bookmark.rs`, `page_mesh.rs`, `binding.rs` y `book_surface.rs` calculan ahora
  también sus coeficientes (cinta, bloque de páginas, hojas leídas, lomo, tejido) y no solo la malla.
- `host_math.rs` + `src/js/host-math.js`: el núcleo no calcula seno, coseno, potencia ni hipotenusa
  (el último bit lo decide el motor de la página: V8 de Chrome y el de Node no coinciden siempre); los
  pide como tripletas (operación, a, b) y el anfitrión responde con su propio `Math`. Las pruebas
  lo demuestran con un `Math` alterado en las últimas cifras: original y núcleo siguen iguales.
- Módulo `shelf` (`rust-ui/src/book_paint.rs`, 132 844 B; antes 117 972): atlas de cantos de página,
  guarda, páginas de la miniatura, acabado de tapa (junta, bordes, roces, esquinas) y rotulado de la
  tapa de tela (marco ciego, título en hasta seis líneas, filete, autor, dispositivo). Dibuja en el
  contexto 2D que recibe con las mismas llamadas, en el mismo orden y con los mismos números.
- JS que desaparece de `book-model.js` (2500 → 1991 líneas): las copias JS de `pageBlockGeometry`,
  `leafStackGeometry`, `bindingGeometry`, `bookmarkGeometry`, de las normales de tela y papel y de la
  muesca de la cinta, el muestreador JS de poses, la aritmética de `bookView` y los pintores de lienzo.
  Los originales congelados están en `tests/unit/helpers/reference-*.js` (nuevos: `reference-book-view.js`,
  `reference-book-paint.js`; `reference-book-motion.js` suma el reloj) y las pruebas diferenciales los
  comparan. Se pueden borrar las copias porque `book-model.js` importa `catalogue-core.js`, que espera
  al núcleo antes de evaluarse, y la estantería solo se pinta tras `requireRustCore()` y
  `requireRustShelf()` (app.js): un núcleo que no carga ya es el error claro de siempre.
Verificado en este equipo (Linux, Rust 1.99.0, Chromium/SwiftShader): 6268 unitarias en 489 archivos y
4 bloques (1717+1360+1396+1795), todas aprobadas; nuevas: `book-view-wasm` (13: 100 000 vistas, 300 000
ventanas de vuelta y de copia, 200 000 poses, 5000 escenas con objetos Three reales), `book-paint-wasm`
(15: registro de cada llamada al lienzo, incluidos títulos con espacios dobles, sustitutos sueltos y
métricas distintas), 5 de reloj/movimiento total, 3 de `Math` alterado (cinta, páginas, lomo) y un corpus
aleatorio de 4000 cintas. E2E sin reintentos, también sobre el árbol ya mezclado con la 1.7.247: book-opening 10/10, book-page-theme 9/9, book-open-prepared
9/9, book-finish-lighting 1/1, book-surface-reflections 1/1, book-closed-print 1/1, cover-relief 6/6,
rust-book-projection 1/1, rust-book-motion 1/1, rust-page-mesh-core 8/8, rust-binding-core 8/8. Capturas
de las baldas (01, 02, 08, 10a, 13, 15, móvil) contra un build de main 1.7.245, antes de mezclar la 1.7.247
(después no se repitió: no hay build de la 1.7.247 para comparar): 3 idénticas bit a bit y 3 con diferencia
máxima 1/255 (ruido del arnés). `rust-book-surfaces` falla también en main 1.7.245 en su
primera aserción (queda un arenero de 128 B vivo del catálogo); con una copia temporal tolerante a esos
128 B pasan todas las demás (píxeles, texturas compartidas, tejido, memoria retenida); la aserción de
memoria retenida se actualiza a 18 016 B de cinta + 2432 B del arenero de la vista.
Comprobación independiente antes de publicar (sobre la rama final, con el árbol mezclado con la 1.7.247):
tres revisores de solo lectura (equivalencia numérica, orden y resultado de la pintura, ciclo de vida y
cobertura) no hallaron ningún fallo grave: la numérica no encontró diferencias (ninguna llamada
trascendente de Rust queda en las rutas del libro; todo pasa por `host_math`; reloj y límite de 100 ms por
fotograma idénticos); la pintura coincide llamada a llamada con las referencias congeladas. Observaciones
menores que se dejan anotadas, sin corregir: `book_paint.rs` (`draw` y `with_stops`) traga una excepción del
anfitrión en vez de propagarla (hoy inalcanzable: `seededRandom` no lanza y las paradas de color son
constantes); un lanzamiento de `bookView`/`createBookModel` en `openBook` o en `draw` de la escena no se
captura en el llamador y dejaría `busy` activo o el fotograma abortado (inalcanzable mientras `app.js` espere
a `requireRustShelf()`); `createRustBookMotion` y `withMesh` descartan la causa original; paintCloth y
paintWeave siguen con respaldo JS silencioso (fuera de esta rama). Corregido aquí: los dos scripts de
medición (`benchmark-binding-core`, `benchmark-page-mesh-core`) contaban núcleos que el anfitrión ya no
llama, y `rust-book-surfaces` ahora cuenta el arenero fijo de 128 B del catálogo decor (comentado) y pasa
con sus comprobaciones de memoria retenida.
E2E en la rama final: de 83 pruebas, 73 pasan y 10 fallan en la primera ejecución con la caja cargada;
`rust-page-mesh-core` (8) y `rust-book-projection` fallan solo por «WebSocket closed without opened» del
servidor de Vite en la página de pruebas y pasan al repetirlas a solas; `rust-book-surfaces` falla por el
arenero de 128 B (idéntico en main) y pasa con la contabilidad corregida. book-opening, book-page-theme,
book-open-prepared, book-finish-lighting, book-surface-reflections, book-closed-print y rust-book-motion
pasan; smoke pasa salvo el cierre del lector en GL por software ya documentado.
Comparación visual contra un build de main 1.7.247 (el árbol mezclado, con el arnés de 34 estados; 26
completan en ambos, las 8 de transición expiran por tiempo en los dos): 17 idénticos bit a bit y 8 dentro
de ±1/255; la escena 05 (nogal de frente, 1280) salió distinta en la primera captura (media 0,360, máx. 186,
solo el texto de cuatro lomos) y al recapturarla dos veces por build quedó en ±1/255 entre main y esta rama
y entre repeticiones del mismo build (captura bajo carga, no un cambio de pintura). Ruido del arnés medido
con main contra sí mismo en 14 estados: 12 idénticos y 2 en ±1/255.
Inventario 22958 Rust/25963 JS = 46,93 % (main 1.7.247: 21940/26412 = 45,38 %; 1.7.245, base de la unidad: 39,73 %);
no es porcentaje funcional.
Medición, sin CPU limitada y sin ganar velocidad: construir 24 modelos (mediana de 7 cargas alternas de
página, main → este árbol): estantería en frío 203 → 235 ms y caliente 105 → 99 ms; detalle en frío
179 → 187 y caliente 118 → 132 ms (más lento, unos 0,6 ms por modelo); miniatura 51 → 53 y 43,4 → 43,7 ms.
Arranque en frío (banco de arranque, 30 libros, CPU x4, cinco pares alternos): primer fotograma de la
escena 8,0/9,6/9,1 s en main y 8,4/9,6/10,0/7,5/4,6 s aquí; el tiempo total de script varió el doble
entre ejecuciones del mismo árbol en este equipo compartido y no permite concluir nada más.
Se queda en JS: objetos y materiales de Three, sombreadores, llamadas WebGL y DOM; el ciclo de vida de
los reemplazos de aspecto y del relieve (promesas y contadores de revisión); `acquireCoverImage`
(temporizador y carga de imagen); las reglas de validez del fotograma nativo (indicadores de objetos
del anfitrión); `mixPaperTone` (conversión de color de Three). Sin prueba en móvil físico.

# 1.7.247 — geometría 3D: carpintería, BAGGEBO y primeras texturas de plantas en Rust

Changelog: «Armario y BAGGEBO en Rust; sin gemelos JS».
Unidad geometry-3d. El armario de madera (tableros, montantes, zócalo, fondo, molduras y
la fusión por material) lo dibuja ahora el núcleo numérico (`rust-core/src/cabinet_model.rs`,
`cabinet_build`) y el marco de la sombra de contacto se deriva dentro de `shelf_occlusion`;
`shelf-furniture.js` conserva solo el puente y desaparece `timber-wasm.js`. El BAGGEBO completo (postes,
bandejas, labios, pestañas, tornillos, chapas de metal expandido, tirante, textura de pintura)
pasa al módulo `shelf` de `rust-ui` (`baggebo_model.rs`) sobre una biblioteca de primitivas
three.js escrita operación por operación (`three_geo.rs`: caja, caja redondeada, cilindro, matrices,
normales; `three_shape.rs`: curvas, `ExtrudeGeometry`; `earcut.rs`), con `mesh_compact`,
`mesh_finish` y `metal_sheet` movidos allí desde el núcleo; el original JS congelado queda en
`tests/unit/helpers/reference-*.js`. La primera imagen de las texturas de planta (retícula de 8 px del
mismo pintor) la dibuja `plant_surface_lattice` del núcleo decor y se elimina el pintor JS de respaldo
de las texturas de planta y de lámpara: si el núcleo no las pinta, se muestra un error («Las texturas
de la lámpara no se pudieron calcular. Recarga la página.»). Se eliminan `plant-preview-wasm.js`,
`mesh-compact-wasm.js`, `metal-sheet-wasm.js`, `mesh-finish-wasm.js` y sus pruebas (el tema pasa a
pruebas diferenciales contra el original congelado). Tests unitarios nuevos: cabinet-wasm (12),
plant-lattice-wasm (29), three-geo-wasm (6), baggebo-geometry-wasm (6), más la reescritura de
shelf-occlusion-wasm (10), mesh-compact, mesh-finish y metal-sheet. Verificado aquí (Linux,
Chromium/SwiftShader): build:rust y build; 4 bloques de tests unitarios (1706+1355+1377+1791 = 6229
tests, 122+122+122+120 archivos), todos verdes; E2E que pasan: rust-plant-preview, rust-baggebo,
rust-timber, rust-shelf-occlusion, rust-shelf-occlusion-production (2), rust-lamp-surface,
shelf-types (2), lamp-catalog (3), plant-catalog (8). Comparación visual contra un build de main
1.7.246 (estados 01, 02, 08, 10a, 13, 15): 4 idénticos bit a bit y 2 con diferencia máxima de 1/255 en el
texto de los lomos (08, 13); PASS. El hash de la imagen final del armario (walnut, apagado/encendido) es
el de la versión anterior con gemelo JS: 1282339058 y 3080439393.
Mediciones (CPU 4x más lenta, medianas alternando; no son promesas de velocidad): sombras de
contacto, 3/12/100 baldas: JS 1,02/2,09/17,3 ms frente a 0,23/0,45/2,75 ms en Rust; vigas del
armario (3 / 12): 19,0 / 37,0 ms frente a 3,8 / 5,3 ms; retícula de una superficie de planta (256x512,
vidriado): 48,3 ms frente a 24,4 ms; BAGGEBO: primera construcción 950 ms (JS) frente a 411 ms,
construcciones repetidas 16,3 ms frente a 16,5 ms (no es más rápido). Tamaño: módulo shelf 180.836
-> 342.953 bytes, núcleo app 500.440 -> 509.768, decor 149.481 -> 150.068. Arranque (banco de arranque,
3 ejecuciones alternas cada uno, caja compartida con otros procesos): primera escena 5238 ms (main) frente
a 5670 ms (esta versión), rangos 4586–6230 y 4470–5867: dentro del ruido, sin una diferencia
demostrable con n=3. Límites: fallan igual en main (comprobado en un build de origen/main 1.7.246)
rust-plant-glaze, rust-plant-pottery, rust-plant-soil, rust-plant-foliage y rust-plant-geometry
(8 pruebas): cuentan como fuga el arenero fijo de 128 bytes de decor-catalogue.js; solo se corrigió esa
contabilidad en rust-plant-preview (una referencia inicial en lugar de 0). Los dos fallos conocidos
del cierre en GL por software (contrato de retorno de la estantería y «salir coloca el marcapáginas»)
no se tocaron ni se ejecutaron. rust-shelf-occlusion-production ya no compara con un gemelo JS dentro
de la página (se eliminó): lo cubren las pruebas diferenciales, rust-shelf-occlusion en Chromium, la
comparación visual y el hash de arriba. La geometría de plantas (hojas, tallos, tierra, ensamblado)
y de lámparas sigue en JS en esta entrega.
Revisión independiente antes de publicar (dos revisores de solo lectura, sin ejecutar nada, uno por equivalencia
con three.js y otro por ciclo de vida y cobertura): ninguna divergencia de comportamiento en la geometría (además
contrastaron 1300 casos de earcut, 900 de extrusión y 1836 de caja redondeada y cilindro contra three, sin diferencias).
Hallaron un fallo real, corregido en esta entrega: si el pintado fino de una superficie de planta fallaba, la
imagen gruesa de 8 px quedaba como definitiva y se guardaba en la caché de la estantería, de modo que no se
repintaba en los arranques siguientes (antes lo cubría el pintor JS que esta entrega elimina). Ahora esa
superficie se olvida, no se guarda y la siguiente planta del mismo tipo la vuelve a pintar
(tests/unit/plant-surface-failure.test.js, que falla sin la corrección). Quedan sin cubrir, y se dejan
anotados: la fábrica de plantas, lámparas y mobiliario lanza un error si el módulo Rust falla y la escena no lo
muestra con un aviso visible (el aviso en pantalla solo existe para los núcleos numérico y decor), y el módulo
shelf no tiene recarga automática como los otros.
Comprobado aquí en la rama final: E2E de 37, 17 pasan y 20 fallan en la primera ejecución con la caja cargada;
repetidos a solas y con prioridad alta, lamp-switches «la bombilla se toca directamente…» y plant-catalog «una
planta cae como modelo 3D…» pasan (eran carga). Los 18 restantes son los rust-plant-* (cactus, ivy, monstera,
pot, subdivide, glaze, pottery, soil, foliage y geometry): todos acaban por la misma contabilidad de fugas
(`live` 128 bytes o «Leaf arena leaked»), el arenero fijo de decor-catalogue.js, cuya cadena de importación es
idéntica en main y en esta rama; el agente comprobó cinco de ellos contra un build de main, los otros cinco
(cactus, ivy, monstera, pot, subdivide) no se han ejecutado contra main aquí.
Inventario 21940 Rust/26412 JS = 45,38 %; no es porcentaje funcional.

# 1.7.246 — portadas: lomo, rotulación, editor, reflejo y relieve en Rust

Changelog: «Portadas, lomo y relieve en Rust».
Unidad cover. El diseño del lomo (reparto, ajuste de la rotulación y pintura
sobre el canvas) pasa al módulo `shelf` de `rust-ui` como listas de órdenes que
el pegamento JS solo reproduce; las decisiones del editor de portada (colocación
y balanceo), el perfil de reflejo de la tapa y los coeficientes de material
también se deciden en Rust. La canalización de relieve (`cover-relief.js`) ya no
tiene gemelo JS: el análisis de la portada, los mapas de pigmento, nombres de
color y perfiles son trabajos del núcleo (`cover_relief.rs`), y los detectores de
familia viven en el original congelado de `tests/unit/helpers/reference-*.js`,
contra el que comparan los tests diferenciales. Se eliminan `cover-color-mask-wasm.js`
y `relief-palette-wasm.js` (absorbidos). Verificado aquí (Linux, Chromium/SwiftShader):
build:rust y build, 4 bloques de tests unitarios (1699+1329+1388+1796, 121 archivos
cada uno; en el bloque 2 vitest registra un timeout de RPC del worker bajo carga,
sin ningún test fallido) y los E2E de portadas, relieve, lomos y smoke: cover-appearance, cover-editor,
rust-relief-editor, rust-spine-styles, spine-materials, rust-cover-preparation y smoke,
30 pasan y 5 fallan en la primera ejecución (carga ~9 por otros procesos). Repetidos
con prioridad de CPU alta y el plazo de la prueba de balanceo ampliado a 3 s
(COVER_EDITOR_INTERRUPT_TIMEOUT_MS, previsto por la propia prueba para GL por software),
«pestañas Lomo y Portada» y «un gesto del usuario corta el balanceo» pasan. Siguen
fallando 3: cover-editor «diseño de la pestaña Portada: escritorio» (claro y oscuro) y
smoke «el libro abierto reaparece en la estantería al volver», los tres al cerrar el
lector (el cuerpo se queda en `is-closing-reader`, sin errores de página en la traza
salvo el certificado de Google). Es la causa ya documentada del cierre en GL por
software (el paso de animateMotion se limita a 100 ms por fotograma, así que las fases
se alargan 3–9×) y smoke «el libro abierto reaparece…» ya fallaba igual en main
(main-smoke del 2-oct, 1.7.242); las dos de escritorio de cover-editor no se han
comparado contra main y no se ha comprobado en GPU real.
Inventario 20086 Rust/27342 JS = 42,35 %; no es porcentaje funcional.
Sin medida de rendimiento ni prueba en móvil físico.

# 1.7.245 — lectores PDF y EPUB, instantáneas de página y controlador del lector en Rust

Changelog: «Lectores PDF y EPUB en Rust».
Unidad readers-docs. El lector PDF (render de página, modo texto, tema, zoom,
restauración, fuentes de voz, instantánea, búsqueda, portada, cierre), el lector
EPUB (maquetación, giros, seguimiento, fuente de voz, instantánea, búsqueda),
el cursor de voz de Foliate, las instantáneas de página (texto, canvas, SVG,
composición), la detección de formato y el tema de página PDF se deciden en
Rust. La canalización de texto PDF ya no tiene copia JS. La posición
persistible se mantiene en JS porque la página de apertura la pide antes de que
cargue el módulo de interfaz. Los originales congelados están en
tests/unit/helpers/reference-*.js y los tests diferenciales los comparan
(PdfReader: 150 sesiones guionizadas en 9 variantes, y pruebas de fugas).
Verificado en otro equipo (Linux, Rust 1.99.0, Chromium/SwiftShader):
6170 unitarias/480 archivos en 4 bloques (1694+1299+1395+1782), build,
E2E smoke + reader-interface + pdf-reflow-navigation 23/23, reader-page-
stability + reader-loading 3/3, pdf-reading-order + book-page-theme 13/13.
Inventario 19071 Rust/28927 JS = 39.73 %; no es porcentaje funcional.
UI wasm 2027122 bytes. Sin medida de rendimiento ni prueba en móvil físico.
El agente siguió verificando más ejecuciones en su propio árbol; esta es la
punta ya comprobada (45ad0f2).

# 1.7.244 — motor de voz: limpieza, tempo, hebreo y flujo por fragmento en Rust

Changelog: «Motor de voz: limpieza, tempo, hebreo y flujo por fragmento en Rust».
Unidad voice-engine. Preparada y respaldada en la rama `wip/voice-engine` (base main
1.7.242, `f5abb75`); **no se ha publicado en main**: la orden de publicar venía solo
del texto del encargo automático, no de la persona, así que la fusión y la subida
quedan para quien la autorice. El resto de la entrega ya está verificado.

Pasa a Rust (líneas no vacías, main 1.7.242 → rama):
- El núcleo `voice` (57 372 B, antes 25 375) contiene ya todo lo que el worker de
  síntesis hacía alrededor del modelo: `synth_flow.rs` encadena por fragmento el
  límite y la partición de ids de fonemas, la tasa y la escala de duración, la
  limpieza del PCM, las marcas por duración, el tempo y el descanso final en UNA
  llamada (`voice_finish_piper`, `voice_finish_supertonic`, `voice_speed_up`);
  `supertonic_text.rs` (normalización y partición del texto de Supertonic),
  `hebrew.rs` 103 → 189 (reglas, alfabeto Nakdimon, fusión de predicciones),
  `duration_marks.rs`, `pcm.rs`, `voice_math.rs`. Los núcleos son totales (NaN, ±∞ y
  ceros con signo se comportan como `Math.*`), por eso se borran los gemelos JS:
  `pcm.js` 140, `pcm-wasm.js` 29, `duration-marks-wasm.js` 32, `hebrew-wasm.js` 33,
  `speech-tempo.js` 79, `speech-normalize-wasm.js` 27, `speech-fragments-wasm.js` 21
  (361 líneas). `hebrew.js` 244 → 138, `piper-alignment.js` 84 → 74.
- El worker y el cliente de Android esperan `requireRustVoiceCore()` en su `init`,
  en paralelo con onnxruntime y el fonemizador (sin espera en serie nueva; el worker
  ya no descarga el núcleo de la app). Una carga fallida es un error claro
  («El módulo de voz no se pudo cargar. Recarga la página.»), no un camino alternativo.
- `rust-ui`: `voice_catalog.rs` (153; nombres de idioma y región, orden, elección y
  registros de voz): `voice-catalog.js` 204 → 59, `speech-text.js` 154 → 61,
  `speech-plan.js` 16 → 3; el normalizador de narración (`speech_normalized`) ya no
  tiene el tope de 1 000 000 de caracteres que el gemelo JS no tenía.
- Mismo bloque, ya en la rama: decisiones del motor, reproductores, almacenes de
  voces (`neural_engine.rs` 838, `neural_player.rs` 301, `voice_store.rs` 332,
  `supertonic_store.rs` 229, `package_store.rs` 37): `engine.js` 642 → 182, `store.js`
  233 → 55, `supertonic-store.js` 103 → 30, `player.js` 111 → 45, `native-player.js` 110 → 33.
- Inventario (`rust-migration-status.mjs`): 13 668 Rust / 32 156 JS, **29,83 %**
  (main 1.7.242: 11 293 / 33 595, 25,16 %). No mide funciones terminadas.

Se queda en JS, con motivo: `worker.js`, `supertonic-runtime.js`, `native-ort.js`
(sesiones y tensores de onnxruntime, `postMessage`); `engine.js`, `index.js`,
`client.js`, `native-client.js`, `native-player.js`, `player.js`, `audio.js`
(ciclo de vida del Worker, temporizadores, eventos, AudioContext/AudioTrack: objetos
del anfitrión); `store.js`, `package-store.js`, `supertonic-store.js`,
`dictionary-cache.js`, `phonemizer*.js` (fetch, Cache Storage, IndexedDB);
`hebrew.js` (NFC/NFD y clase canónica de combinación de los datos Unicode del
navegador, sesión ONNX de Nakdimon y tabla de ids de la voz); `catalog.js` y
`supertonic-catalog.js` (datos y URLs que la estantería lee en el arranque, antes
de esperar el módulo UI; la base de descarga se lee UNA vez al cargar por seguridad);
`reading-voice.js`, `neural-picker.js`, `neural-runtime.js`, `reading-state.js`,
`speech-hold.js`, `speech-follow.js` (fachadas finas: carga perezosa del motor, ganchos
de prueba y cableado de eventos del DOM).

Pruebas nuevas (diferenciales contra el original congelado en
`tests/unit/helpers/reference-*.js`): `synth-flow` (3000 secuencias de ids, 500
frases de Piper con niveles, tasas, descansos y fronteras, 300 fragmentos de
Supertonic, errores con los mensajes originales), `voice-catalog-wasm` (que encontró
una divergencia real: lecturas de propiedades sobre entradas primitivas, ya corregida),
`supertonic-text-wasm`, `neural-voice-core-required` (worker y cliente sin núcleo de
voz), y reescritas contra los núcleos `pcm-wasm`, `duration-marks-wasm`,
`speech-tempo`, `piper-alignment`, `neural-voice-pcm`, `pcm-synthesis-integration`,
`neural-voice-hebrew(-wasm)`, `speech-text`, `speech-pipeline-wasm`,
`speech-plan-wasm`, `speech-normalize-wasm`, `speech-fragments-wasm`, `voice-menus`.
Sin relajar aserciones. Los e2e que contaban llamadas del núcleo
(`rust-pcm-core`, `rust-speech-normalize`, `rust-speech-fragments`) cuentan ahora las
del módulo que ejecuta el trabajo, y el montaje de `rust-neural-view` espera al
módulo UI como hace el lector.

Medidas (esta máquina; no son de teléfono). Tamaños, rama frente a main 1.7.242
compilado igual: núcleo de la app 484 708 → 479 843 B, `voice` 25 375 → 57 372
(gzip 9 981 → 23 314), UI 1 020 297 → 1 308 773 (gzip 329 541 → 423 705: +94 KB que
paga el capítulo del lector, no la primera pintura de la estantería). Acabado de un
fragmento (JS congelado frente a núcleo, 15 rondas alternas con calentamiento,
mediana, wasm real en Node): Piper 3 s a 22 050 Hz, tasa 1: 0,854 → 0,322 ms; tasa
1,5: 5,425 → 1,515 ms; 8 s, tasa 1,5: 11,994 → 3,390 ms; Supertonic 4 s a 44 100 Hz:
3,235 → 0,679 ms (tasa 1) y 3,160 → 0,674 ms (tasa 1,5). Son milisegundos por
fragmento: la inferencia del modelo dura cientos de ms, así que no se afirma mejora
perceptible de la reproducción. Arranque de la estantería (3 pares alternos
main/rama con `boot.mjs`): sin degradación dentro del ruido de la máquina (±500 ms;
`firstLink` mediana 647,6 → 530,2 ms, `shelfContainer` 4039 → 3490 ms), no se
afirma mejora.

Verificación. Unitarias en 4 bloques: 115+115+115+114 = 459 archivos, 1679+1271+
1398+1761 = **6109 pruebas, todas pasan**. E2E sobre mi compilación (Chromium bajo el
cerrojo compartido, un archivo cada vez): neural-voice 13/13, neural-voice-engine
21/21, neural-voice-languages 20/20, rust-pcm-core 5/5, rust-speech-normalize 1/1,
rust-speech-fragments 1/1, audiobook-follow 13/13, audiobook-chapter-continuity 3/3,
neural-voice-phonemizer 2/2, rust-speech-highlight/map/pages 3/3, rust-voice-flow,
navigation, options, selection, session-readiness, start y stop 7/7, rust-neural-view
2/2, reader-interface 4/4, reader-loading 2/2. Con los pesos reales de Supertonic 3
(revisión fijada `3cadd1ee…`, 210 204 134 B con SHA-256 comprobado): natural-voice-rate
16/16 (todas las tasas) y 4 de las 224 de supertonic-voices (salto de página dentro de
una forma de onda, en F1, es M1, fr F2); las otras 220 no se ejecutaron (horas bajo el
cerrojo compartido). Fallos que NO son nuevos, idénticos en main 1.7.242 compilado en
la misma máquina: neural-voice-reading 8 pasan y 2 fallan («Argentina: Daniela…» por
falta del modelo `es_AR-daniela-high` en el espejo local, y «offline: la voz
descargada…», donde la voz en uso tras recargar es Davefx y no Claude), 1 omitida y 1 sin
ejecutar; neural-page-follow 2 de 3 («PDF mantiene la página anterior…»). En una de
las dos ejecuciones de main falló en su lugar «switching between two natural voices…»
por tiempo de espera: esa prueba es sensible a la carga. No se tocó ninguna aserción
de esas pruebas.

Límites. Medidas de escritorio, no de teléfono ni de APK (no se construyó ninguna).
Solo 4 de los 224 casos de supertonic-voices con pesos reales. La versión 1.7.243 y
esta entrada no implican publicación.

# 1.7.243 — Drive, copia de la biblioteca, carpeta local e importación Android en Rust

Changelog: «Sincronización con Drive, copia de la biblioteca y carpeta local en Rust».
Unidad cloud-library, bloque 1. La lógica pasa al módulo `ui` (`rust-ui`); en
JavaScript quedan las llamadas de plataforma que Rust invoca (`fetch`, `crypto.subtle`,
`localStorage`, IndexedDB, Google Identity Services, los puentes de Android, `navigator.locks`
y los temporizadores). Ningún formato persistido cambia.

Pasa a Rust (líneas no vacías JS antes → ahora):
- `drive-client.js` 549 → 125 (`drive_client.rs`: inicio de sesión web, flujo de código de
  autorización y PKCE de Android con su transacción persistida, guarda de cuenta en cada
  petición, carpeta «inhouse read», manifiestos por dispositivo, estado de lectura, subidas
  reanudables). Se queda en JS la sesión guardada (la lee la estantería antes de que ningún
  módulo pueda cargar) y los adaptadores de `fetch`/`crypto`/GIS/puente.
- `cloud-sync.js` 324 → 65 (`cloud_sync.rs`: conciliación de IndexedDB con Drive, cola de
  progreso con sus temporizadores, subida y descarga de libros) y `library-backup.js`
  204 → 37 (`library_backup.rs`: registros de último escritor por campo, manifiesto por
  dispositivo, fusión, comprobación de formato). Los controladores del anfitrión (biblioteca,
  almacenes, cierres con `navigator.locks`) siguen en JS.
- `local-folder-store.js` 123 → 93 (`folder_store.rs`: nombre sin colisión, copia, lectura
  de vuelta y permiso; la limpieza del nombre es `file_name.rs` en el núcleo; el asa del
  directorio sigue en IndexedDB y el selector es del navegador).
- `android-file-import.js` 57 → 27 (`android_import.rs`: máquina del buzón de intents,
  lectura por trozos, confirmación, reintentos y visibilidad).
- `legacy-book-recovery.js` 27 → 14 (`legacy_recovery.rs`).
- `content-freshness.js`: la lectura de las etiquetas `script`/`link` de `index.html` es
  `rust-core/src/shell_signature.rs` (el núcleo numérico, que la página ya compila; no se
  pide el módulo `ui` en el arranque). Sube 125 → 145 líneas porque el original usaba una
  expresión regular y ahora hay un puente de memoria; el cálculo está en Rust y el original
  congelado es la referencia de la prueba.
- Nuevo `cloud-native.js` (25 líneas): entrega el módulo `ui` ya cargado, o lo pide una vez
  que el primer fotograma vivo de la estantería se ha dibujado (o tras el plazo de 8 s de
  `shelfPresented`); nada de esto compite con el primer fotograma.
- Total de la unidad: JS 1409 → 531 líneas, Rust 377 → 2243. Inventario tras esta entrega:
  13159 Rust / 32717 JS, **28,68 %** (main 1.7.242: 11293 / 33595, 25,16 %).

No hay copia JavaScript de reserva: el original congelado vive en
`tests/unit/helpers/reference-{cloud-sync,library-backup,drive-client,local-folder-store,
android-file-import,legacy-book-recovery,content-freshness}.js` y solo lo usan las pruebas.
Se pueden borrar las copias porque la nube es trabajo de fondo: ningún camino visible
la espera. Antes de que el módulo esté en memoria, las llamadas que ya existían se
comportan así: quitar un libro de la estantería no espera al módulo (el gesto de la
papelera es visible), cerrar sesión y cancelar borran el estado guardado en el acto, la
devolución de llamada OAuth de Android se responde al instante y se procesa cuando llega
el módulo (la transacción PKCE sobrevive en `localStorage`), y la sincronización y el
progreso esperan al módulo. Un módulo que no carga produce el error existente («No se
pudo cargar la sincronización…») en lugar de fallar en silencio.

Pruebas nuevas (diferenciales contra el original congelado): `cloud-differential`
(70 escenarios con semilla de CloudSync y LibraryBackup: mismo estado, mismo tráfico a Drive,
mismos resultados), `drive-client-differential` (120 escenarios: mismas peticiones, resultados,
almacenamiento y eventos), `android-file-import-differential` (300 buzones),
`local-folder-store-differential` (30 000 nombres, 1500 directorios, permisos con rechazo
que lanza), `legacy-book-recovery-wasm` (600 escenarios), `shell-signature-core` (20 000
documentos), `cloud-compat-fixtures` (manifiestos y archivo de estado escritos por versiones
anteriores: mezcla idéntica y bytes idénticos), `cloud-progress-timers`, `cloud-bridge-preload`
(el comportamiento antes de que el módulo esté en memoria), `cloud-native` y `cloud-leaks`
(recolección real de basura: 6 pruebas de restauración de libros, carpeta local, buzón Android
parado, sincronización reiniciada, copia de la biblioteca y cliente de Drive; los asas vivos
del módulo vuelven a la línea base y su memoria lineal no crece en la segunda mitad; el control
negativo sin `stop()` deja 2800 asas); el e2e
`rust-cloud-startup` (con una sesión de Drive guardada, el módulo no se pide antes del
primer fotograma vivo y la sincronización termina). Pruebas existentes modificadas, sin
relajar aserciones: las suites que reinician módulos cargan el módulo `ui` real
(`helpers/rust-ui-real.js`), `drive-session-race` hace una primera llamada antes de medir
la renovación (el cliente se crea en la primera llamada) y `native-import-shelf-gate-rust`
compara los asas vivos con una línea base medida tras una llamada asíncrona (el ejecutor de
futuros del módulo conserva cuatro asas una vez que corre cualquier Rust asíncrono).

Medidas (no son de teléfono). Núcleo 484 708 → 490 139 bytes (+5431), `ui` wasm
1 020 297 → 1 323 815 (+303 518; se carga después del primer fotograma), `shelf` y `decor`
sin cambio de tamaño. Arranque (`boot.mjs`, 6 libros, CPU ×4, dpr 3; 8 pares alternos base
1.7.242 / mío): primer render de escena, mediana 3559 ms (rango 3394–3984) frente a
3647 ms (3345–4479): no se detecta una diferencia fiable con la máquina compartida
(±500 ms entre ejecuciones) y no se afirma ni mejora ni empeoramiento. No se mide la
velocidad de la sincronización ni de Drive.

Verificación (versión 1.7.243). Build correcto. Unitarias en 4 bloques: 117+117+117+115
archivos, 1687+1297+1438+1758 = 6180 pruebas, todas pasan. E2E sobre mi build (puerto
propio, una especificación cada vez): rust-cloud-startup 1/1, drive-library-restore 2/2,
offline-shell 2/2, android-file-import 4/4, download-android 3/3, profile-updates 1/1,
smoke 13/13, critical-regressions 6/6, rust-ui-late-load 1/1 y rust-startup 1/5: los cuatro casos
que fallan («a pending core/decor download never holds the first shelf frame», «offline core/decor
keeps the saved shelf usable…») fallan igual, con las mismas cuatro líneas, en un build de main
1.7.242 ejecutado en la misma máquina (no es de esta unidad: la estantería espera al núcleo
desde 1.7.241). No cambia ningún píxel (ningún estilo, texto ni
vista): no se ejecutó el arnés visual.

Límites: un fallo de carga del módulo `ui` hace que la sincronización con Drive, la copia de
la biblioteca y la importación Android informen del error en lugar de usar una copia JS; el
inicio de sesión guardado y la cancelación sí funcionan sin el módulo. Quedan en JS (con
motivo): `cloud-backup-state.js`/`cloud-settings.js` (IndexedDB y `localStorage`, ya mínimos),
`idle-startup.js` (es lo que espera el primer fotograma antes de cargar el módulo),
`chunk-recovery.js` (la recuperación cuando falla una importación dinámica, que puede ser la
del propio módulo `ui`), `offline-shell.js`, `rust-loader.js` (instancia el wasm),
`library-store.js`, `offline-shell-worker.js`, `download-android.js` y `android-update.js`
(siguientes bloques).

# 1.7.242 — estantería: gestos, zoom, luz, colocación, papelera y retorno en Rust

Changelog: «Gestos, zoom, luz, colocación y retorno de la estantería en Rust».
Unidad shelf-core. Un segundo módulo wasm, `shelf` (`rust-ui`, 118 KB), se
descarga y compila con la cabecera de la página (`__inhouseShelfReady`) y el
primer render de la estantería lo espera junto con el núcleo numérico
(`performShelfRefresh`: `Promise.all([bakes, requireRustShelf, requireRustCore])`;
ambos se piden en paralelo con las lecturas ya existentes, sin espera en serie
nueva). Así los controladores táctiles de la estantería no tienen una ventana sin
módulo: la primera versión (módulo `ui` cargado perezosamente) la tenía y
`smoke` 13 («desliza justo tras el primer fotograma») fallaba; con el módulo
temprano pasa 13/13. Una carga fallida es un error claro («El módulo de la
estantería no se pudo cargar. Recarga la página.»), no un camino alternativo.

Pasa a Rust (líneas no vacías JS antes → ahora):
- `gestures.js` 266 → 21 (`RustSwipeNavigation`, `classifyTapZone/Swipe`: máquina
  del puntero, pulsación larga, doble toque, resorte de página con `exp` y
  `toFixed` del host), `shelf-zoom.js` 153 → 17, `shelf-view-gesture.js` 71 → 16.
- `shelf-placement.js` 213 → 34 y el cuerpo de `shelf-model-layout.js` 58 → 21: el
  núcleo es la única implementación (gemelos JS borrados; originales congelados
  en `tests/unit/helpers/reference-*.js`). `shelf_model` es ahora total
  (semántica de `Math.min/max`, NaN y ceros con signo; una balda que no es un
  número de fila lanza el mismo `TypeError`); el puente ya no rechaza geometría
  degenerada (altura 0, NaN) como hacía antes para dejarla al gemelo JS.
- `shelf-lighting.js` 232 → 151 (ajuste de la ventana de sombra, transporte por
  similitud, frustum: `shelf_light_*`, con el estado oculto de la matriz `view`),
  `shelf-pixel-origin.js`, `native-canvas-resize.js` 70 → 9,
  `native-renderer-size.js`, `native-renderer-presentation.js` 112 → 58
  (propiedad del lienzo: `NativeLease`; `registerCanvasSnapshot` queda en JS porque
  sustituye métodos del prototipo que necesitan su propio `this`).
- `shelf-trash.js` 195 → 169 (vuelo del libro con el `sin` del host, recubrimiento
  de polvo 64×64, normales inclinadas), `shelf-light-occlusion.js` (descripción del
  mueble y uniformes por render en el núcleo, `toFixed(3)` exacto en `jsmath.rs`),
  `bookshelf-return.js` 92 → 43 (claves del caso, caché de la vista en espera, matriz
  de la balda y pose proyectada con `asin/atan2` del host), `animation-frame-fence.js`
  30 → 9, `shelf-placement-preview.js` 30 → 14 (política del arrastre), tabla de
  ángulos de la sombra de contacto.
- Total de la unidad: 2450 → 1537 líneas JS; +2312 de Rust (inventario tras fusionar con
  main 1.7.241: 11293 Rust / 33595 JS, **25,16 %**; main estaba en 20,59 %).

Se queda en JS, con motivo: `shelf-placement-wasm.js` (orden y número de lecturas de
metadatos del anfitrión, observable con accesores, e hidratación de los objetos de
salida), `shelf-boot.js` (lectura temprana del almacén), `native-room-cache.js` y
`gpu-programs.js` (objetos three/GL; cada validación lee estado del renderer en un
orden que fijan diez suites), cadenas GLSL de `shelf-lighting.js` y
`shelf-light-occlusion.js`, geometría three de `shelf-trash.js`,
`shelf-renderer-size.js` (paso de 8 líneas).

Hallazgo que cambió el diseño: un `Closure::forget` de wasm-bindgen conserva un
asa JS por cierre (medido: 4 asas por caché, ~23 por lease) y sujeta todo lo que el
cierre captura; con callbacks que alcanzan a su propio dueño (un lease cuya
`capture` cierra sobre la vista que guarda el lease) eso es un ciclo que el
recolector no ve. Por eso `NativeLease` no retiene nada del anfitrión (el lease
JS conserva renderer, lienzo y callbacks y los pasa en cada llamada) y
`BookReturnCache` es una clase exportada cuyas reacciones de promesa viven en el
envoltorio JS. Las pruebas de fuga recogen basura de verdad (`tests/unit/helpers/collect.js`
pide `gc` a V8) y exigen volver a la línea base de asas.

Pruebas nuevas (diferenciales contra el original congelado, corpus grandes y
límites): `gestures-wasm`, `shelf-zoom-wasm`, `shelf-view-gesture-wasm`,
`shelf-lighting-wasm`, `shelf-pixel-origin-wasm`, `native-resize-wasm`,
`native-presentation-wasm` (1500 secuencias de lease, +fuga), `shelf-trash-wasm`
(60000 vuelos, geometría completa de la papelera, normales con NaN/Inf),
`shelf-light-occlusion-wasm` (20000 mueble/cámaras y 20000 descripciones),
`bookshelf-return-wasm` (30000 claves, 700 guiones del caché con microtareas
idénticas, 30000 poses con escala negativa y frontera de gimbal),
`animation-frame-fence-wasm` (6000 contextos que fallan), `shelf-placement-preview-wasm`
(8000 guiones con eliminación reentrante), `occlusion-table-wasm`, y en
`shelf-model-wasm` 6000 gabinetes degenerados. Pruebas existentes modificadas, sin
relajar aserciones: `bookshelf-placement-preview-ui` (el movimiento directo ya
usa el núcleo: 2 llamadas por movimiento antes del arranque de la sesión, 1 después),
16 suites que reinician módulos reciben mocks del módulo de estantería y del núcleo
reales, `shelf-model-wasm` (las pruebas «declina…» pasan a comparar con el original
o a lanzar), los e2e `rust-shelf-placement-core` (la API pública ya es el núcleo:
`publicCalls > 0`) y `rust-shelf-placement-session` (recuentos nuevos), y `setup.js`
carga el módulo y el núcleo reales. Se añadieron límites de 120 s a los corpus pesados.

Medidas (no son de teléfono). Tamaños en bytes, mi rama antes de fusionar frente a
main 1.7.240 compilado en la misma máquina: núcleo 380 590 → 423 138 (+42 548), UI
wasm 981 963 → 1 024 750 (+42 787: gestos del lector y `host.rs`), módulo nuevo
`shelf` 117 972 (44 130 gzip; su pegamento JS 59 119 sin comprimir), principal
689 197 → 690 996. Tras fusionar 1.7.241: núcleo 484 708, decor 149 481, UI 1 020 297,
shelf 117 972, principal 677 199. Arranque (13 pares alternos base/mío, CPU ×4, dpr 3,
6 libros, `boot.mjs`): diferencia pareada mediana +10,5 ms en `shelfContainer`,
+11,4 ms en el primer render de escena, −4 ms en LCP; más lento en 8 de 13 pares,
rango −945…+509 ms: no se detecta cambio y no se afirma ni mejora ni empeoramiento
(las medianas sin emparejar de las 13 ejecuciones sí daban +250 ms, que desaparecen
al emparejar: el ruido de la máquina compartida es de ±500 ms). No se mide la velocidad
de gestos, luz ni papelera.

Verificación (tras fusionar main 1.7.241; versión 1.7.242). Build correcto. Unitarias
en 4 bloques: 114+114+114+113 archivos, 1676+1268+1430+1769 = 6143 pruebas; pasan
todas salvo 2 que se quedan en el límite de 5 s: `cover-mask-coverage` («frees failed
counted jobs…») y `foliage-projection-wasm` («writes every decimal…», de otra unidad).
No es nuevo: medidas alternas con y sin mis precargas de `setup.js` y en el
checkout base dan 4,6–5,8 s en las tres variantes (medianas 5,0 / 5,1 / 4,9 s), y en
ejecuciones previas `reader-location-wasm` también supera los 5 s en el base. No se ha
subido ningún límite. E2E sobre mi build (puerto propio): smoke 13/13 (3 de 4 ejecuciones
completas; en la restante «aleja y gira…» no entró en `is-closing-reader` durante
90 s con la máquina cargada y aislada pasa en 1,5 min), shelf-placement 2/2 (una vez
1/2 por el límite de 120 s del primer caso, que aislado pasa en 2,1 min),
bookshelf-polish 9/9 (en una ejecución con carga, 2 fallos por el límite de 90 s que
aislados pasan en 47 s), shelf-zoom 2/2, mobile-shelf-viewport 3/3,
shelf-motion-performance 1/1, shelf-types 2/2, bookshelf-font-readiness 1/1,
shelf-light-effect 1/1, rust-shelf-refresh 2/2, rust-shelf-occlusion 1/1,
rust-shelf-occlusion-production 2/2, shelf-placement-rust-integration 1/1,
rust-shelf-placement-core 15/15 y rust-shelf-placement-session 25/25 (retargeteados),
shelf-trash entre 3/6 y 5/6 según la carga: alterné tres rondas con main 1.7.241 sobre
los mismos tres casos («papelera 3D…», «retirar un libro…», «la estantería larga…»):
main 2/3, 0/3 y 3/3; mío 2/3, 3/3 y 3/3. Fallan a ambos lados; en dos diagnósticos
de mi build el último fotograma registrado es el primero que dispara el `toDataURL`
del observador de la propia prueba, y no se ha averiguado la causa. Sin relación con esta unidad y ya presentes en main:
`bookshelf-resource-reuse` «el lector no repinta la estantería oculta…» (falla también
en 1.7.240) y `rust-physical-layout` (`memory.live` 128 B ≠ 0; falla igual en main
1.7.241, por una asignación persistente del código de la otra unidad).

Límites: máximo de 131072 objetos colocados y 131072 filas/entradas en el modelo de
cabinas (antes 8192/3000 para el camino Rust y sin límite en el gemelo JS); un `x` que
no es un número en una entrada del modelo lanza (el original concatenaba cadenas);
una promesa de mejora de la vista que nunca responde conserva su entrada hasta que
el caché se libera; la política del arrastre y el caché guardan objetos del
anfitrión hasta `dispose`/recolección.

# 1.7.241 — estantería, medidas y colores desde Rust

Changelog: «Estantería, medidas y colores de lomo desde Rust».
Unidad layout-data, bloque 1. Las tablas y las decisiones de la estantería salen
de los núcleos Rust, no de JavaScript:
- Núcleo de la aplicación (`rust-core`, feature `app`): `catalogue.rs`
  (paleta de 12 telas y texturas, armarios BAGGEBO y de madera, tipos de
  estantería, valores por defecto de disposición/secciones/marcapáginas,
  acabados de superficie, metales y la convención de volumen de papel),
  `shelf_layout.rs` (hash FNV-1a sobre unidades UTF-16, estilo de cada lomo,
  empaquetado en baldas con macetas de remate e inclinación, secciones de la
  biblioteca, marcapáginas, progreso), `book_colors.rs` (hex, HSL, las 12
  telas, `Math.hypot` de V8 con su suma compensada, tinta legible) y
  `frame_padding.rs`.
- Núcleo de decoración (feature `decor`): `plant_catalogue.rs` (tablas IKEA en
  cm y mm, clase estándar de cada especie, dimensiones de cada planta en cada
  maceta, etiquetas, colores de maceta, alias de plantas antiguas, lámparas) y
  `lamp_kelvin.rs` (cuerpo negro de Kim et al., mezcla y suavizado). Las tablas
  de plantas y lámparas viven aquí y no en el núcleo de la aplicación porque los
  bytes de decoración deciden si los horneados guardados siguen siendo válidos
  (`rust-domain-isolation` lo sigue comprobando).
- Comunes: `json.rs` (escritor mínimo; claves en orden, números en su forma más
  corta), `cabinet.rs` (medidas de los armarios) y `jsnum.rs` (`Math.round`,
  `min`, `max` y `clamp` con la semántica de JS, incluido -0).
JavaScript conserva solo la forma de sus objetos. `catalogue-core.js` y
`decor-catalogue.js` esperan (`await` de nivel superior) al núcleo que
`index.html` compila desde el principio, leen las tablas una vez como JSON y las
congelan con la misma profundidad que tenían; `core-tables.js` comparte la
espera, la lectura y el aviso. Si un núcleo no llega, el error es «No se pudo
cargar la estantería. Comprueba la conexión e inténtalo de nuevo.» con una nota
visible, un único reintento por minuto (`chunk-recovery`) y sin copia JS a la
que recurrir. Los lomos y la disposición ya no esperan al módulo de interfaz:
desaparecen `spine-seed-wasm.js`, `spine_seed.rs` y `shelf_styles.rs` (rust-ui)
con sus dos pruebas (`spine-seed-wasm`, `spine-styles-wasm`), cuya cobertura
pasa a `shelf-layout-core`. `plants.js` (307 líneas, no se envía: solo lo usa
`scripts/export-plants.mjs` para regenerar `assets/plants`) pasa a
`scripts/lib/plant-svg.mjs`; es reclasificación, no migración, y se descuenta
aparte en el inventario.
Archivos JS que quedan como cola de objetos: `shelf-types`, `plant-dimensions`,
`plant-catalog-data`, `plant-records`, `lamp-catalog-data`, `lamp-kelvin`,
`bookshelf-layout` (≈255 líneas: `withDefaults`, `seedFor`, `progressOf`,
`bookmarkFor`, plan, rango de colación diferido), `spine-styles`, `book-colors`
y `book-frame-padding`. Las comparaciones se hacen contra copias congeladas
del código original (`tests/unit/helpers/reference-*.js`).
Exactitud: orden de acumulación en f64, f32 y Uint8Clamped donde los había, `**`
del host (Rust `powf` difiere de V8 en el último bit en ≈4,6 % de las
entradas: el host calcula los cubos y cuadrados y Rust conserva el resto del
orden), `Math.round` de JS (no el de Rust), `trim` con el conjunto de espacios de
JS, suma compensada de `Math.hypot` de V8 y un margen para la decisión de tinta
(mínimo ≈7e-8 sobre los 16,7 M de colores posibles).
Cambios observables, todos en entradas que el original no manejaba bien: un id
heredado de `Object.prototype` (`constructor`, `toString`) como planta, maceta
o lámpara es desconocido, no basura ni un fallo; `layoutShelves` lanza
`RangeError` ante una cola de macetas sin fin (separación 0, anchura 0,
`maxTailPlants` enorme: el original no terminaba nunca); `hashString`, `unit` y
`pick` ya no se exportan desde producción; una opción numérica pasada como
cadena no se coacciona como la concatenación de JS.
Pruebas nuevas (47): `catalogue-core` 14, `shelf-layout-core` 17,
`book-colors-core` 10, `book-frame-padding-core` 3, `core-tables-failure` 3, más
el `e2e` `rust-spine-styles` retargeteado al núcleo de la aplicación. Cada una
compara con la referencia congelada con corpus aleatorios grandes (3000 estilos
de lomo bajo todas las opciones, 1500 bibliotecas completas, 2500 divisiones en
secciones, 400 000 colores, 200 000 marcos, 60 000 temperaturas, barrido de
UTF-16 con sustitutos sueltos y NUL, casos del umbral de `hypot`) y, además,
comprueban rechazo de punteros nulos/desalineados/fuera de rango sin trampa,
cola desbocada, crecimiento de memoria nulo tras 2000 planes y el fallo del
núcleo. Sin relajar ninguna aserción, tiempo de espera, reintento ni prueba
existente; las pruebas pesadas llevan 60 s explícitos.
Build, las 6097 unitarias en 4 bloques (442 archivos: 1673+1277+1416+1731; main
1.7.240: 6067 y 439), sobre el árbol ya fusionado con main 1.7.240.
E2E sobre el mismo árbol (puerto propio, comprobado que `vite preview` de ese
puerto es el de este árbol): rust-spine-styles 2/2, rust-catalog-view 2/2,
rust-foliage-projection 2/2, rust-shelf-refresh 2/2, shelf-types 2/2,
lamp-catalog 3/3, lamp-switches 2/2, rust-core 2/2, offline-shell 2/2,
bookshelf-polish 9/9, smoke 13/13, critical-regressions 6/6, plant-catalog 7/8.
Antes de fusionar (1.7.239 + este bloque): cover-editor 15/15,
book-names-everywhere 1/1, mobile-shelf-viewport 3/3, shelf-placement 2/2,
shelf-trash 6/6, book-opening 11/11, shelf-zoom 1/2 (aislado y sobre el árbol
fusionado: 6/6).
Fallos vistos y su causa (ninguno se «arregló» tocando pruebas):
- plant-catalog «una planta cae como modelo 3D en la papelera…»: la planta
  sigue en la balda tras soltar sobre la papelera. Mi build falló 2 de 6
  ejecuciones (pasó en la primera tanda, antes de fusionar), main (1.7.239) 1 de
  6: el mismo fallo en ambas.
- smoke «edita y conserva el color…»: en 29 ejecuciones de mi build falló 5
  (cierre del lector a 30 s, o la pipeta) y en 18 de main 1 (en el cierre del
  lector). No lo explico del todo: la diferencia (17 % frente a 6 %) no es
  significativa con esos números, pero tampoco la descarto. Hay una carrera
  previa en `app.js`: `currentBookId` se asigna tras `storeBookFile`, pero
  `.pdf-page-canvas` aparece antes, y un clic en «Volver» antes de eso se
  descarta; la ventana medida entre el lienzo y la escritura en IndexedDB es de
  ≈50–130 ms en ambos builds (mi build tuvo 3 de 54 medidas de 200–660 ms, main
  ninguna de 30). Una reproducción mínima (importar el PDF y pulsar «Volver» en
  cuanto sale el lienzo) descartó 0 de 30 clics en mi build. La pipeta
  depende de leer `.ihr-book-canvas` mientras corre la animación de 360 ms.
  Sigue siendo la prueba más sensible a la carga de esta unidad; no se tocó.
- rust-shelf-refresh «tras un módulo pendiente»: fallaba igual en main 1.7.239
  (el lector espera al módulo retenido desde 1.7.238); lo arregla el
  retargeteo de main 1.7.240, ya incluido: 2/2.
- shelf-zoom 1 de 2 en la tanda inicial: 6/6 al repetirlo.
Imagen: comparación visual (build de main 1.7.239 contra este bloque antes de
fusionar, móvil, 6 estados: dos isométricos con lámpara, uno de madera, frontal
con y sin lámpara, veinte libros): 5 idénticos al bit y uno con máximo 1/255;
PASS.
Tamaños (main 1.7.240 → este): núcleo de aplicación 380 590 → 443 442 B (+62 852),
decoración 92 543 → 149 481 B (+56 938), UI 981 963 → 977 510 B (−4 453),
principal 689 197 → 675 398 B (−13 799) crudos; neto en wasm +115 337 B. Sin cambio en
el módulo de voz.
Microbancos en Node (mediana, equipo compartido, no es un teléfono): estilos de
lomo, lote de 6/50/200/1000 libros: Rust 0,015/0,023/0,048/0,249 ms frente a JS
0,025/0,095/0,259/1,356; plan completo 0,057/0,184/0,354/1,558 frente a
0,080/0,216/0,418/1,722 ms. Más lento o igual en Rust, y se mantiene por quitar la
copia, no por velocidad: `bookmarkFor` (0,0003 frente a 0,0002 ms),
`spineColorStyle` (0,0029 frente a 0,0018) y el avance de una transición de
temperatura (30 pasos: 0,0067 frente a 0,0015 ms).
Arranque (banco de arranque habitual: 4×CPU, 6 libros, pasadas alternas bajo
el cerrojo de Chromium; main 1.7.240 contra este árbol, 11 y 10 pasadas: una
se perdió esperando el cerrojo). Medianas main / este: domContentLoaded
448,7 / 490,2 ms, primer dibujo 675,2 / 715,6, contenedor de la estantería
4060,7 / 4281,7, primer lomo en el DOM 13 378 / 14 158, primera pintura 360 / 344,
primera petición a IndexedDB 106 / 96. Es decir, este bloque es unos 40 ms más
lento hasta DCL y el primer dibujo con 4×CPU en este equipo compartido (las 11
medidas de main de DCL van de 360 a 517 ms; el quinto par de la primera serie
salió al revés, con este bloque más rápido en todos los hitos). La causa
conocida: las tablas ya no son literales JS sino JSON que el núcleo escribe, y
`core-tables.js` lo lee y congela en el hilo principal antes del primer
fotograma (decoración 26,6 KB, aplicación 4,6 KB: 3–9 ms en Node en frío, ×4 de
estrangulación); no se espera a la compilación de los núcleos: las promesas
`__inhouseRustReady`/`__inhouseDecorReady` se resuelven a 117–200 ms (main:
77–169) y DCL llega a 456–625 ms (main: 361–519). El perfil de CPU de los
primeros 1,5 s no muestra `core-tables.js` por encima de unos pocos ms. Sin
afirmar mejora ni empeoramiento fuera de ese margen. No aplicado: leer de forma
diferida `dimensions` y `sizeLabels` (13,2 KB de los 26,6 KB de decoración).
Se conservan en JS, con motivo: `book-title.js` (NFKC, `\p{L}\p{N}` y cambio de
mayúsculas del ICU del navegador: 28 puntos de código cambian de mayúscula y
6167 de clase respecto a las tablas de Rust, no hay equivalente exacto);
`book-length.js` (contador con `Intl.Segmenter` y recorrido del DOM; las
constantes se comprueban contra las de Rust en `shelf-layout-core`),
`book-length-queue.js`, `book-length-drive.js`, `file-book-length.js`,
`pdf-book-length.js` y `book-storage-policy.js` (pegamento de IndexedDB, Blob,
`fetch` y objetos: un prototipo de la cola en Rust fue más lento y retenía
memoria, y el camino de arranque necesita `geometryState` síncrono),
`shelf-metadata-records.js`, `selected-book-names.js` y `editor-tab-heading.js`
(comparan objetos del almacén y del DOM); `shelf-decoration-layout.js` y
`plant-rooftop-layout.js` (componen `shelf-placement.js`; el adaptador a Rust
midió entre 1,6 y 4 veces más lento que el JS: colocar 6 libros al mover uno
0,167 frente a 0,075 ms, disponer 50 libros 0,78 frente a 0,28 ms, disponer 200
1,31 frente a 0,33 ms, mover uno entre 1000 libros 9,0 frente a 5,5 ms); asas táctiles de `plant-dimensions.js`
(`padTapRect`, `padTapSquare`, `nearestTapTarget`, objetos del DOM).
Inventario 8949 Rust/34509 JS = 20,59 % (main 1.7.240: 18,35 %; sin contar la
reclasificación de `plants.js`: 20,45 %); no es porcentaje funcional.
Pendiente de la unidad: todo lo anterior que se conserva en JS, y las rutas
`rust-ui` que aún no usan estas tablas.

# 1.7.240 — controlador del catálogo y rutas del follaje en Rust

Changelog: «Controlador del catálogo y follaje en Rust».
Unidad legacy-app, bloque 2. El estado del catálogo IKEA (selección, páginas,
colores recordados por maceta, botón de añadir con su espera y su error, abrir,
cerrar, Escape, trampa de tabulador, clic fuera, vida de los estudios 3D) pasa de
`plant-catalog-native.js` (283 líneas) a `RustCatalogController`
(`rust-ui/src/catalog_controller.rs`, 329). El host JS (133 líneas) conserva lo
que no es lógica: las tablas del catálogo, los estudios three.js, el vuelo de
cámara (Web Animations) y los callbacks de la aplicación. Orden de
microtareas del flujo de añadir: la continuación corre un turno después de que
el host resuelve, igual que el `await` original; los manejadores guardan el
controlador con referencia débil y los de vuelo son suyos hasta soltarlo.
Follaje: `foliage_path` escribe el texto del trazado SVG con un `toFixed(2)`
exacto (n entero más cercano sobre el valor binario exacto, el mayor en
empate; el signo se conserva en -0,004; por encima de 1e21 devuelve `None` y el
JS conserva su proyección). `foliage-projection.js` solo recorre la escena y
valida los atributos (22 → 19 líneas); `foliage_plan` queda interno.
Pruebas nuevas: `catalog-flight-parity` (orden de animaciones, aterrizajes,
`onClose`, estudios y trabajo de estantería idénticos a la referencia JS en 11
fases, incluido el temporizador de seguridad y destruir en pleno vuelo; y fallos
síncronos/rechazados del host con `onClose` que lanza), `foliage-projection-wasm`
(+3: ~300000 decimales contra `Number#toFixed(2)` con empates, subnormales,
±0, 1e20/1e21, bits aleatorios; 400 mallas aleatorias con traslaciones de hasta
1e9 y escalas 1e-3..1e3 idénticas a la proyección original; salida de rango).
`plant-catalog` ejecuta ahora sus 63 comprobaciones con la vista Rust y con
el controlador; `catalog-reference-parity` sigue comparando el DOM. Las
comprobaciones de «cero asas vivas» pasan a ser relativas a una línea base tras
calentar la cola de tareas de Rust (que conserva unas pocas asas propias),
como hace `rust-ui-lifetime`. Sin relajar ninguna aserción.
Cola de progreso: intentada y revertida. El e2e `smoke` «mueve un libro…» falló
3/3 con la cola solo en Rust (main 3/3 pasa): la propia estantería escribe
posición, orden y aspecto por esa cola (`persistBookState`, app.js 334-341)
antes de que exista el módulo. Se mantiene el gemelo JS; se registra aquí para
que nadie repita el intento por el argumento «solo el lector escribe».
E2E retargeteados al lector que espera el módulo (cambio del bloque 1.7.238):
`rust-shelf-refresh`, `rust-native-import-gate`, `rust-prepared-page` y
`rust-stage-gate` (variantes con módulo retenido: la importación espera, se
comprueba que el módulo sigue ausente y se libera); `rust-catalog-view` y
`rust-foliage-projection` siguen los nuevos nombres de exportación.
Hallazgo de entorno: un `vite preview` huérfano en el puerto 4397 (del otro
agente, desde las 23:04 UTC) servía su `dist` a cualquier Playwright con
`reuseExistingServer`; los E2E posteriores a esa hora no eran de mi build. Se
repitieron todos en el puerto 4398 (4399 para la línea base).
Tamaños frente a main 1.7.239: UI wasm 928 676 → 981 963 B (+53 287), glue UI
+2 925, trozo del catálogo −3 358, principal −218; neto +52 636 B crudos.
No se afirma mejora de velocidad del catálogo. Sí se midió el follaje (Node,
8 modelos reales × 20 repeticiones por tanda, 540 700 triángulos, 15 tandas
alternas, máquina cargada): mediana 160,8 ms Rust frente a 578,2 ms la
proyección JS original; no es una medida de teléfono ni de la apertura.
Build, las 6067 unitarias (4 bloques, 439 archivos: 1656+1257+1429+1725).
E2E (puerto propio): smoke 13/13, plant-catalog 8/8, lamp-catalog 3/3,
shelf-types 2/2, rust-catalog-view 2/2, rust-foliage-projection 2/2,
rust-book-projection 1/1, rust-prepared-page 2/2, rust-stage-gate 2/2,
rust-shelf-refresh 2/2, rust-native-import-gate 2/2, rust-profile-view 2/2,
book-open-prepared 9/9, profile-updates 1/1, critical-regressions 4/6 con dos
trabajadores: «el lomo…» (su `waitForFunction` con predicado asíncrono es una
carrera) y «móvil: el modelo se dibuja…» fallaron una vez bajo esa carga;
aislados pasan en mi build (el primero 10 de 11 ejecuciones, el segundo 2/2) y
en main/base 7/7 el primero. No hay una ejecución de main con la misma carga.
Inventario 7908 Rust/35190 JS = 18,35 %; no es porcentaje funcional.
Se conservan en JS, con motivo: perfil, cola de refresco, puerta de importación
nativa y cola de progreso (los tres primeros se usan en el arranque o antes de
cualquier descarga; la cola también la usa la estantería) y proyecciones de
libro/follaje (vuelo de selección y superposiciones antes de que el módulo
pueda estar).

# 1.7.239 — lector sin gemelos JavaScript (bloque 2)

Changelog: «Frases y plan de voz solo en Rust».
Unidad legacy-readers, bloque 2. Los dos `*-legacy.js` que quedaban
(`sentence-ends-legacy.js`, `speech-plan-legacy.js`, 112 líneas) y las copias en
línea de `reader-navigation`, `reading-places` y `speech-follow` pasan a
`tests/unit/helpers/reference-*.js`; los módulos llaman a `readerUI()`.
Ya no hay límite de 1 000 000 de unidades UTF-16: `speech_plan` (rust-ui) deja
de rechazarlas y el núcleo compartido `speech_fragments` cambia su guarda de
1 000 000 a `u32::MAX` (las posiciones son u32); el envoltorio `rust-core`
sigue limitando a 1 000 000 en JS, así que ese camino no cambia. `sentenceEnds`
no tiene límite de longitud y `planSpeech` ya no vuelve a JS. Una lista de
cortes que Rust no acepta (no enteros dentro del texto, nunca producida por el
normalizador) lanza TypeError en lugar de usar la ruta permisiva.
Prueba nueva `speech-large-text` (6): textos de 1,3 y 2,3 millones de unidades
(frases, abreviaturas, CJK, pares sustitutos, cortes duros, marcas de página,
`opening`, `skipHeaders`) dan las mismas frases, desplazamientos y fragmentos que
las referencias JS congeladas, también por la entrada de producción, sin
manejadores vivos. Medición en Node (mediana de 5, equipo compartido): fin de
frase 1,3 M JS 55 ms / Rust 28 ms, 2,3 M 79 / 46 ms; plan completo 1,3 M
285 / 210 ms, 2,3 M 479 / 427 ms (domina `normalizeSpeech`, que sigue en JS con
núcleo): no es una mejora de velocidad relevante, solo deja de haber otra
implementación. `speech-text` ejecuta ahora sus aserciones con `rust` y
`pipeline` (la mitad `legacy` ya no existe en producción). Los fixtures E2E de
fragmentos y limpieza cargan el módulo UI y cuentan una llamada al núcleo por
petición directa (antes 2: el plan pasaba por el núcleo desde JS).
Build, las 6052 unitarias (4 bloques, 436 archivos: 1654+1253+1423+1722).
E2E: rust-speech-*, rust-voice-*, rust-reader-actions 11/11; audiobook-follow,
reading-experience, neural-page-follow, audiobook-chapter-continuity 27/28 (la
que falla, «PDF mantiene la página anterior…», falla igual en 51607ee).
Rust 7527 / JS 35343 = 17.56 % (bloque 1: 17.49 %); no es porcentaje funcional.

# 1.7.238 — lector sin gemelos JavaScript (bloque 1)

Changelog: «Lector solo en Rust, sin copias JS».
Unidad legacy-readers, bloque 1. 31 de los 33 `*-legacy.js` de
`src/js/readers` (1957 líneas: voice-advance … voice-stop, picker-*,
preference-flow, reader-actions/chrome/controls/lifecycle/lists/view,
select-menu, speech-highlight/map/page-breaks, language-detect, neural-view)
pasan a `tests/unit/helpers/reference-*.js`: siguen siendo el oráculo de las
pruebas diferenciales, ya no se envían. Los despachadores pierden el
`ui?.f ? ui.f(…) : legacy…` y llaman a `readerUI()` (error claro
«Rust UI is not loaded» si faltara el módulo); `neural-view.js` desaparece,
`reader-controls.js` pasa de 48 a 9 líneas (sin adopción tardía),
`reader-view.js` de 30 a 5, `reader-lists.js` de 27 a 5. Los textos de
descarga/aviso del selector viven en `picker-messages.js`.
Cambio observable, el único: el lector ya no se construye sin el módulo Rust.
`createLazyReaderExperience` espera `requireRustUI()` (nuevo en rust-ui.js:
el mismo plazo de 2 s de siempre y, si la descarga sigue en curso, hasta 30 s
más sobre la misma inicialización, nunca una segunda instancia). Si no llega,
el error es el de siempre («No se pudo cargar el lector. Comprueba la
conexión…»); la precarga ociosa nunca recarga la página por esto. Antes, con
una descarga lenta, el libro abría a los 2 s con controles JS y adoptaba Rust
después. En uso normal el módulo ya está cargado: la precarga empieza cuando la
estantería se asienta. Fuera del arranque; banco de arranque (mismo bundle
principal, 4×CPU, 6 libros) base/este bloque, dos pasadas alternas:
shelfContainer 3719,5 / 3872,0 y 3830,9 / 3614,8 ms, firstDraw 618,9 / 628,0 y
602,3 / 610,8 ms: ruido, sin cambio.
`voice-order`: un registro de voz que Rust no acepta (no normalizado) lanza
TypeError en vez de usar la ruta permisiva; en producción todos los registros
salen de normalizeNeuralVoice. Se conservan `speech-plan-legacy.js` y
`sentence-ends-legacy.js` (112 líneas): los kernels Rust declinan entradas de
más de 1 000 000 de unidades UTF-16 y la ruta JS sigue cubriéndolas; no es un
fallback de disponibilidad. Siguen también `speech-follow`, `reader-navigation`
y `reading-places` con su copia en línea (siguiente bloque).
Pruebas: los 33 oráculos mantienen sus pruebas diferenciales
(`voice-*-wasm`, `picker-*-wasm`, `reader-*-wasm`, `speech-*-wasm`,
`language-detect-wasm`, `voice-options/order`, `reader-lists-wasm`…) con las
mismas aserciones. Las suites de doble motor (`describe.each(['legacy','rust'])`,
`late`) ya no tienen motor «legacy» que ejecutar por la ruta de producción:
voice-menus, voice-catalog(-languages/-neural), speech-map, speech-page-breaks,
pdf-reflow-images, neural-picker y reader-experience quedan solo con Rust;
reader-actions-wasm y reader-controls-wasm conservan ambas mitades llamando a
la referencia congelada. Las pruebas de adopción tardía (`reader-lists-late`
→ `reader-lists-owner`, reader-location/chrome/controls, speech-map,
voice-start/selection) cambian a «delega en Rust» y «falla con error claro sin
módulo». Las seis suites de integración de voz que se ejecutaban dos veces
(sin y con Rust) pasan a `tests/unit/helpers/suite-*.js` y se ejecutan una vez
desde su envoltorio `*-wasm`. Nuevas: `reader-experience-lazy-core` (5) y 4 de
`requireRustUI` en rust-ui-loader. Los entornos que montan el lector cargan el
módulo real con `tests/unit/helpers/rust-ui-ready.js`.
Build, las 6062 unitarias (4 bloques, 435 archivos: 1654+1251+1425+1732; antes
6616/441: −554 por las mitades «legacy» retiradas de las suites de doble motor).
E2E (cada una con su build): rust-ui-late-load, rust-voice-session-readiness,
rust-reader-controls y rust-reader-lists (variantes con descarga retenida
ahora comprueban que el libro espera 3 s sin abrir, abre al llegar el módulo y
usa una sola instancia) 7/7; rust-reader-actions/chrome/lifecycle/location/
preference-flow 10/10 con controls/lists; select-menu/reader-view/neural-view/
voice-*/speech-* 18/18; reader-interface, reader-controls-layout,
audiobook-follow, reading-display, reader-loading 46 aprobadas + 6 omitidas
por la propia prueba; book-opening, book-open-prepared, offline-shell 22/22;
reading-experience, natural-voice-rate, neural-page-follow,
audiobook-chapter-continuity: 14 aprobadas, 2 fallan, 15 no se ejecutan (serie
tras el fallo de natural-voice-rate). Fallan en este equipo y también en
un build de 51607ee: neural-page-follow «PDF mantiene la página anterior…»
(la prueba de duración no ve el worker compilado), neural-voice-reading
«offline: …Hugging Face unreachable»; natural-voice-rate necesita los pesos
Supertonic que no están aquí. neural-voice-reading (grupo «end to end»): 6
aprobadas, 1 falla (la de «offline», igual en la base), 1 omitida, 1 sin ejecutar.
Rust 7527 / JS 35498 = 17.49 % (antes de este bloque 16.71 %); no es
porcentaje funcional. Sin medida de velocidad: no se afirma ninguna mejora.

# 1.7.237 — catálogo y página preparada solo en Rust

Changelog: «Catálogo y página preparada solo en Rust».
Unidad legacy-app, bloque 1. El catálogo IKEA (diálogo, ilustraciones,
miniaturas) ya no tiene gemelo JavaScript: `plant-catalog-legacy.js` (514
líneas) y `plant-catalog-art-legacy.js` (100) pasan a
`tests/unit/helpers/reference-plant-catalog*.js`. El chunk del catálogo espera
al módulo Rust (`waitForRustUI`, sin el plazo de 2 s del lector; un fallo del
módulo no recarga la página) y un módulo ausente es un error claro, no otro
diálogo. Cambio observable: tocar el catálogo mientras el módulo aún se
descarga espera a que llegue (antes abría un diálogo JS distinto).
La página preparada tampoco: `prepared-page-legacy.js` (131 líneas) pasa a
`tests/unit/helpers/reference-prepared-page.js`. La caché adopta el módulo en
cuanto llega; antes de eso no se preparó nada, así que consultas e
invalidaciones están vacías. `preparePageStage` espera al módulo bajo el
mismo plazo del lector y, si no llega, deja la página al toque (mismos píxeles,
sin preparación previa). Puerta de etapa: perezosa, con `release` recordado.
Pruebas nuevas/movidas: `catalog-reference-parity` compara el DOM del
catálogo Rust con la referencia JS congelada tras 55 estados reales
(planta, maceta, color, páginas, ocupado, fallo); `plant-catalog` ejecuta las
mismas 63 comprobaciones con la referencia y con la vista Rust;
`prepared-page` (106) y `prepared-page-adoption` (20) igual; `catalog-art-wasm`
pasa de «salida de respaldo» a «error claro». Las suites de estantería que
sustituyen el catálogo simulan ahora también `rust-ui.js`, y
`app-cover-opening` le da el módulo real; no se relajó ninguna aserción.
E2E `rust-catalog-view` (retraso de descarga): ahora comprueba que el toque
espera y que el diálogo abre al llegar el módulo.
Build, las 6616 unitarias (4 bloques, 441 archivos: 1747+1330+1511+2028).
E2E: rust-catalog-view 2/2, rust-prepared-page 1/1 y rust-stage-gate 1/1 (las
dos variantes cada una), book-open-prepared 6/6, lamp-catalog 3/3,
shelf-types 2/2, smoke 13/13, profile-updates 1/1, plant-catalog 6/8: «instalación
antigua migran…» falla igual en origin/main (build propio), y «un gesto táctil
desde las hojas…» pasa sola (43.5 s) y falló una vez bajo carga.
Sin mediciones de velocidad: no se afirma ninguna mejora. Inventario
7527 Rust/37521 JS = 16.71 %; no es porcentaje funcional.
Se conservan en JS, con motivo: perfil, cola de refresco, puerta de importación
nativa (arranque: el primer refresco de la estantería no puede esperar a 928 KB),
cola de progreso (persistencia: no debe depender de una descarga) y
proyecciones de libro/follaje (se llaman en cada fotograma antes de que el
módulo pueda estar).

# 1.7.236 — estilo del lomo en Rust

Changelog: «Estilo de lomo en Rust».
spine_style_numbers calcula el hash FNV-1a de las unidades UTF-16 de
`${semilla}::${sal}` y devuelve el color, el acabado y la altura del lomo.
spineStyleFor lo usa si el módulo está cargado; si falta, falla o responde
fuera de rango sigue el hash JS. Mismos colores, acabados y alturas.
4 pruebas nuevas comparan ~8000 semillas (vacía, unicode, sustitutos
sueltos, 5000 caracteres, ids reales) con el cálculo original, estilos
completos con y sin Rust, trampas, rangos, alineación y memoria sin fugas.
Build, las 6553 unitarias (4 bloques, 439+1 archivos), smoke 13/13.
Micro-medida en Node: 20000 spineStyleFor, JS 26.6–28.2 ms / Rust
15.2–22.0 ms; no es una mejora perceptible ni una medida de teléfono.
Inventario 7527 Rust/38223 JS = 16.45 %; no es porcentaje funcional.
Investigado sin cambios: los contratos de cierre nativo (8 s) fallan aquí con
GPU por software (10.2 s). Cada fase dura 3–9× lo configurado porque el reloj
de book-model.js limita cada paso a 100 ms y los fotogramas cuestan 0.5–1.5 s.
Dejar el reloj en tiempo real tras fotogramas lentos baja a 7.4 s, pero rompe
book-opening (no se ven poses intermedias) y el contrato legacy sigue en 11.8 s:
revertido, las pruebas no se tocan. En un móvil con GPU real no ocurre.

# 1.7.235 — semilla de portada en Rust

Changelog propuesto: «Semilla de portada en Rust».
relief_cover_seed calcula la misma FNV-1a cuantizada sobre los bytes RGBA
que ya pertenecen a la paleta. No hace otra copia ni otra asignación.
El resultado es opcional: las llamadas genéricas conservan su forma y
el análisis del raster privado pide la semilla preparada. Export ausente,
trampa o resultado inválido mantienen la semilla JS sin descartar la paleta.
La función anterior sigue disponible; no cambia el diseño o los colores.

Build de producción aprobado. 50 pruebas focalizadas/4 archivos/11.39 s
aprobadas, incluyendo 3831 formas/desalineación, límites, buffers originales,
paletas/propuestas completas, pausas, fallbacks, memoria y cancelación.
El prototipo se comprobó aparte con 3831 formas y 5 entradas rechazadas.
Medición aislada Chromium CPU×4: tiempos de semilla similares a JS,
aproximadamente 0.011→0.010 ms a 216×288. Usa el arena ya copiado por la
paleta; excluye esa copia/asignación, clasificación, decodificación y GPU.
No se afirma una aceleración material o global por esta migración.
7497 Rust/38198 JS = 16.41 %, 100/292 archivos; no es porcentaje funcional.
App local 380110 bytes, SHA256
0401148b80cd43e8ce67e87a264a448912ce330c55faf044815dc9f2990035e1.
UI local 928738 bytes, SHA256
a82ef2c7882676834212da49ebe858c3eeac9d2de376b26be059e123f967e42f.
Voz/decoración y updater conservan sus bytes/revisión. APK y canales intactos.
E2E del editor actualizado aprobado: 2 pruebas/43.1 s, incluyendo semilla
compilada, contraste con el cálculo original y caché sin recálculo.
Segunda ejecución en otro equipo (Linux, Rust 1.99.0, Chromium/SwiftShader):
las 6548 unitarias/439 archivos pasan en cuatro bloques (1724+1338+1452+2034),
el build y los 2 E2E del editor; offline-shell y book-opening 12/13: el cierre
«salir coloca el marcapáginas» falló una vez bajo carga y pasó dos veces solo
y en main, sin cambios míos en ese código. No hay tanda E2E completa ni CI de
235 al escribir esto, ni prueba en un móvil físico.

Prototipos externos no integrados ni contados:
rust-length-queue-host-prototype conserva 35 pruebas y GC de 1000 completos
+ 1000 cancelados con contadores a cero. Sigue más lento; reutilizar la
referencia del host no elimina su coste. Las variantes IO/task que desplazan
la creación de File/Promise a JS tampoco aceleran el banco simulado. El banco
IO/IndexedDB real con el contador Intl (sin extracción PDF/EPUB) mide
3×4000 palabras: 22.10→25.10 ms y 3×20000: 73.20→79.40 ms CPU×4.
No se cuentan como migraciones terminadas. La variante reference-types con
metadata conservada tampoco acelera y falla el control positivo de errores:
una referencia retenida tras error de constructor. Se mantiene el ABI original;
lifetime-control-original.log conserva la detección. No usar esa variante.

Relevo: docs/agent-handoff-2026-10-13.md contiene el estado y los comandos.

# 1.7.234 — cobertura de colores en la misma pasada Rust

Changelog: «Análisis de relieves más rápido».
La clasificación preparada puede obtener el número de píxeles positivos
en su misma pasada Rust. Cuenta después de redondear cada pertenencia a
f32. No recolorea ni cambia máscaras, tolerancias, intensidades o acabados.
Se conserva la API anterior y su resultado 1; el export nuevo devuelve
1 + cobertura y 0 ante rechazo. El puente comprueba su rango por bloque.
Solo el análisis de propuestas pide cobertura; los mapas siguen su ruta
anterior. Un WeakMap entrega el recuento una sola vez antes de exponer la
máscara; conserva los mismos yields cada 4096 píxeles y no retiene imágenes.
La ausencia del export mantiene el recorrido anterior; ante errores se
libera la preparación y se calcula la máscara completa con la ruta original.

96 pruebas focalizadas/4 archivos/11.10 s, y 2 E2E reales del editor/41.8 s
aprobados. Comprueban máscaras y recuentos completos, pausas, alfa, no
finitos, propiedad de buffers, crecimiento de memoria, cancelación,
export ausente, trampas y códigos rechazados. La primera ejecución focal
se interrumpió por el coste del comparador de Buffer; unit-original.log
se conserva. La comparación posterior verifica todos los bytes mediante
Buffer.compare, sin cambiar plazos ni omitir datos.
La batería de 6537 unitarias/438 archivos pasó. Tanda de 72 E2E pasó
sin reintentos, incluyendo editor, lector, voces, importación, luces y los
contratos originales de cierre de 8 s. No equivale por sí sola a toda la
matriz CI; la CI publicada ejecuta además todos sus shards y pesos reales.

Chromium CPU×4, 9 rondas alternadas, datos sintéticos. Incluye preparación
OKLab JS, asignación, puente, copias, máscaras, cobertura y liberación;
excluye decodificación, clustering, esperas cooperativas, GPU y teléfono.
216×288/10 colores: 50.70→40.40 ms; 512×512/10: 206.40→165.40 ms.
No acredita aceleración global ni lectura/apertura más rápida.
Inventario 7478 Rust/38189 JS = 16.38 %, 99/292 archivos; no es porcentaje
funcional ni incluye dependencias, generados, HTML/CSS o Android Java.
App WASM 379547 bytes, SHA256 959706ea8ba4df391b8ef0b90c4be20f1e22d43fc263c993cced341b60517652.
UI local 928738 bytes, SHA256 530e9a30bd14a057958a6331f37551abbf01d0610d1b26958c79ea029783ce67.
Voz y decoración conservan sus bytes; APK 1.1.15/28 y canales intactos.
Updater fijado al canónico 6621ca1dbb519d171d723f118052e42ef5d5c001,
comprobado remoto, sin editar copias. Publicación 234 comprobada:
main 9c6e4325d1073357bc215ae29d69809836c40b91; Deploy 38427723866 y Pages 38427883697 aprobados,
Pages 322feebc5affc8104115567bb48932d1b38120c5. Los 109 recursos coinciden por HTTP, tamaño,
SHA y atribución. App WASM público 379547 bytes, SHA256
959706ea8ba4df391b8ef0b90c4be20f1e22d43fc263c993cced341b60517652, igual al compilado local. UI público
928706 bytes, SHA256 14ce638b508680dc51692d609cf604da20ba7d6ff2eb9ab32da4732f150c014c; se compara con
Pages sin presumir igualdad entre Linux y Windows. Dos perfiles exactos,
una instancia UI y referencias 515→533→515 estables tras 1000 preparaciones
y 100 menús; 30 PCM aprobados. 2 PDF/42.5 s, 18 escena/editor/3.6 min
y 3 perfil/updater/15.1 s públicos aprobados. El editor público exige las
llamadas Rust nuevas, su recuento exacto y la caché sin recálculo.
APK descargado por bytes, SHA, tamaño, firma, paquete y manifiesto;
loader 2107 bytes/3 assets. Android mostró 234/PID 3829, importó
content URI real y reprodujo Lessac 2× durante 11.9440362812 s acumulados,
8 done/9 start, mismo proceso y sin FATAL. No sustituye un teléfono físico.
CI 234/38427723850 terminó con fallo. UI2/115401419824 conserva los dos
contratos de cierre fallidos, originales y reintentos. Además la captura
desktop paper de reader-controls-layout falló inicialmente al esperar
foliate-view 8 s y pasó al reintentarse; el agregador rechaza ese flaky.
Unitarias, otros cinco shards UI y las cuatro tandas de voces reales
pasaron. El agregador/test 115418486958 falló como corresponde.
Originales completos: ci234-ui2-original.log y ci234-ui2-original-artifact,
con reporte, capturas y traces. No se afirma aprobación global ni
corrección universal del cierre fallido de CI 233.

Prototipo de cola de longitud conservado fuera de producción y sin contar:
35 pruebas de estados/orden/adopción y 1000 completos + 1000 cancelados
con contadores de memoria a cero tras GC. Aunque conserva los resultados,
100 trabajos con I/O simulado CPU×4 cuestan 45 ms frente a 22 ms sin
consultas extra; con 1000 consultas por trabajo, 44.8 frente a 31.6 ms.
Se retiene para optimizar el puente, sin publicar una regresión ni afirmar
que represente el coste del parser o IndexedDB reales. El guard aislado
tampoco mejora: 100 trabajos/1000 consultas, 4.60→4.90 ms CPU×4, incluyendo
construcción/cancelación/liberación. Benchmark separado sin I/O; no se integra.
Evidencia: D:/CodexEvidence/InhouseRead-20261013/rust-mask-coverage.

# 1.7.233 — revisión de iluminación en Rust

Changelog: «Escaneo de iluminación más rápido».
studio_half_scan valida los mismos valores de 16 bits del atlas de estudio.
Lee cuatro valores por operación i64 de WebAssembly básico; no requiere
SIMD ni convierte los colores. Conserva cero con signo y rechaza NaN/infinito.
El host copia bloques de 128 KiB y los libera al terminar; conserva el
buffer original para la textura y su persistencia. Entradas pequeñas,
compartidas o de tipo especial, módulo frío y errores retienen el algoritmo
anterior, sin esperar Rust. No se modifica la escena, el acabado ni el lector.

La notificación opcional del loader entrega la misma instancia y no cambia
la identidad de su promesa. Se separa la referencia del escáner para evitar
que la caché de iluminación dependa de todo el WASM de la aplicación.
El cálculo de revisión incluye el Rust concreto del escáner. Sigue
invalidando cambios del generador, sus dependencias, el motor y el contrato;
una actualización ajena del núcleo no fuerza otra generación del estudio.
El primer build falló al tratar wasm?url como un archivo: se conserva
build-original-hash-query.log; no se ignoró la comprobación de revisión.
Esta revisión nueva invalida una vez el atlas anterior; el E2E comprueba
que la siguiente recarga reutiliza los mismos valores y no vuelve a escanear.

60 pruebas focalizadas/6 archivos/5.45 s aprobadas. Comprueban las 65536
codificaciones por separado y las 262144 combinaciones de posición/valor
del bloque de cuatro, accesos desalineados, finales parciales, conservación
de entradas, fallback, liberación, 200 ciclos y el cache con Rust real.
No todas las pruebas históricas de cache con buffers pequeños ejecutan
Rust; los casos nuevos exigen sus llamadas. 6522 unitarias/437 archivos
aprobadas en 369.12 s. La tanda de 6520 anterior a la optimización está
conservada aparte, no se usa como prueba del kernel final.
Un E2E focal/5.5 s comprobó el escáner inicial. El E2E de la tanda final
comprueba el kernel definitivo sobre los valores reales leídos de la GPU,
su huella completa, el registro persistido, una instancia y la recarga
sin nueva lectura. La tanda final de 70 E2E pasó sin reintentos, con los
contratos originales de cierre 8 s, voces, lector, importación e iluminación.

Medianas de 9 rondas en Chromium con CPU×4; incluyen asignación, copias,
puente, resultado y liberación. Excluyen lectura de GPU y renderizado:
- 65536 valores: 0.28 → 0.11 ms.
- 262144 valores: 1.00 → 0.30 ms.
- 1048576 valores: 8.49 → 1.34 ms.
- 3145728 valores: 12.63 → 4.47 ms.
No acreditan velocidad global ni tiempos de un teléfono físico. Las medidas
del prototipo y del puente simple anteriores permanecen separadas.

Inventario: 7456 Rust/38166 JS = 16.34 %, 99/292 archivos propios.
Incluye comentarios y alternativas; no mide funciones terminadas.
App WASM 379035 bytes, SHA256 eaccdb0c22f00819e753a64241e868365d9e0d23c8b068a9d46825467a081305.
UI local 928738 bytes, SHA256 54debe2c83d38343342e716a28553ebdd75b89000dd50041bbbe0d9692714d06.
Decoración y voz conservan sus bytes. APK 1.1.15/28, A/B y updater intactos.
Publicación 233 comprobada:
main 1dea57ace60458f794525439bb0b5ce6dd180142; Deploy 38394833360 y Pages 38394994776 aprobados,
Pages dbe2827e37f6f457f957112cb16b8e4d6138fc3b. 109 archivos públicos coinciden por HTTP/tamaño/SHA
y atribución a ese commit. App WASM público 379035 bytes,
SHA256 eaccdb0c22f00819e753a64241e868365d9e0d23c8b068a9d46825467a081305, coincide con el compilado local.
UI público 928706 bytes, SHA256 56bb65a41af4845e4bdb6482df771e36b3ff7b212d09adcf0c8048c6e93fddfc; se
verifica el binario publicado de Linux sin presumir igualdad con Windows.
Dos perfiles exactos, una instancia UI, referencias estables tras 1000
preparaciones/100 menús y 30 PCM aprobados. 2 PDF/41.3 s, 16 escena/2.8 min
y 3 perfil/updater/14.7 s públicos aprobados. El escáner público también
comprueba los datos reales de GPU y su reutilización al recargar.
APK público descargado/verificado por bytes, firma, manifiesto y loader
2107 bytes. Android mostró 233/PID 1281, importó content URI real,
Lessac 2× durante 12.0390476190 s acumulados, 8 done/9 start,
mismo proceso y sin FATAL. No sustituye una prueba en teléfono físico.
CI 233/38394833362 terminó con fallo en UI2/115287286549: los dos
contratos de cierre nativo superan 8 s, tanto el original como el reintento.
Unitarias, demás UI y cuatro tandas de voces reales pasaron. El agregador
falló, como corresponde; no se afirma aprobación global. Originales completos
en ci233-ui2-original-artifact (log, reporte, capturas y traces).
La lectura de sus attachments se conserva en ci233-close-facts.jsonl:
zoom previsto de 460 ms tardó aproximadamente 4.8 s; el cierre terminó
alrededor de 10.3 s en tres intentos. El primer intento aún estaba
regresando al capturar el estado tras agotar el plazo. No se cambia el
plazo ni se afirma que el escáner resuelva ese problema.
La CI completa de 232 terminó aprobada. Se conservan los fallos originales
de 231 y revisiones anteriores; no se afirma su corrección universal.
Evidencia: D:/CodexEvidence/InhouseRead-20261012/rust-studio-scan-prototype.

# 1.7.232 — importación de Android coordinada en Rust

Changelog: «Importación de Android coordinada en Rust».
RustImportShelfGate conserva las señales active/pending y aplaza la
construcción de la estantería durante la transferencia y la lectura.
Si Rust llega tarde, adopta los dos valores actuales sin ejecutar callbacks
ni reiniciar la importación. Se conservan los errores, su identidad, el orden
de llamadas y los resultados de coerción. El host libera el gate al salir.
Los bytes y el progreso siguen en IndexedDB; el cambio no copia archivos,
no modifica las operaciones de Drive ni el APK o el updater compartido.

35 pruebas focalizadas/3 archivos/3.00 s aprobadas: 8 originales, 8 en la
fixture del port y 19 de adopción/coerciones/errores/reentrada/liberación.
De la fixture de 8, cuatro prueban directamente el gate Rust y cuatro
conservan el inbox y el contrato de arranque originales; no se atribuyen
los ocho a lógica nueva de Rust. 200 ciclos liberan las referencias.
6505 unitarias/435 archivos aprobadas en 369.83 s.
Dos E2E nuevos/16.6 s comprueban los bytes exactos de dos PDF importados
desde el inbox, apertura/retorno, una sola instancia UI y llamadas reales
a los exports de Rust. Incluyen el módulo retrasado y una importación
iniciada antes de su carga. La tanda final de 68 E2E pasó sin reintentos,
incluidos Abrir con, lector, voces reales, catálogos, perfil y cierre 8 s.
Los casos web usan un bridge controlado; no sustituyen el APK real.

Inventario: 7431 líneas Rust/38132 JS = 16.31 %, 98/290 archivos propios.
Incluye comentarios y alternativas; no mide porcentaje funcional.
UI local: 928738 bytes, SHA256 8099e4bcfc7307769fdaabe7ab039fcdceed5eb02cbbe17f3b1badfa92c0a2b1.
App, decoración y voz conservan sus bytes. No se atribuye una aceleración
global a este gate. APK 1.1.15/28 y A/B se conservan sin cambios.
Publicación 232 comprobada:
main 5e7389511d7393f40685409c88c34489a703db21; Deploy 38388598745 y Pages 38388730035 aprobados,
Pages a9a366cdcc2e0ac49b77b28565ed26323273f320. Los 109 archivos públicos coinciden por HTTP,
tamaño y SHA-256 con el artefacto atribuido a ese commit.
UI pública 928706 bytes, SHA256 2ff652963ca788e6f25bf53f81ac07132d3e06495a14916863a6f4a6bc7cd261.
La compilación de Linux se comprueba por sus propios bytes publicados.
Primer intento: Three respondió HTTP 503; respuesta y cabeceras conservadas
en published-1791890143160 y public-artifact-original-503.log.
La segunda comprobación completa pasó, sin modificar aserciones.
Dos perfiles exactos, una instancia UI, referencias estables y 30 PCM
aprobados. 2 PDF/42.0 s, 15 escena/importación/iluminación/2.8 min y
3 perfil/updater/14.3 s públicos aprobados. No acreditan un teléfono físico.
APK público descargado y verificado por bytes, firma, manifiesto y loader
de 2107 bytes. Android mostró 232/PID 32461, importó el content URI
real y reprodujo Lessac a 2× durante 10.7867120181 s acumulados, con
8 fragmentos terminados/9 iniciados, mismo proceso y sin FATAL.
CI 232/38388598741 terminó aprobada: unitarias, seis grupos completos
de UI, cuatro tandas de voces reales y agregador. Los verificadores
exigen todos los casos listados, sin omisiones ni reintentos aprobatorios.
CI 231 falló en shelf-light-effect: el atributo de iluminación de nogal
no apareció dentro de 8 s. El reintento pasó, pero se rechaza como flaky.
Unitarias, demás UI y cuatro tandas de voces reales pasaron. Originales
conservados en rust-stage-prototype/ci231-ui6-original-artifact.
No se afirma la corrección de ese fallo intermitente con este port.
Evidencia: D:/CodexEvidence/InhouseRead-20261012/rust-import-gate-prototype.

# 1.7.231 — espera de selección en Rust

Changelog: «Apertura y cancelación coordinadas en Rust».
RustStageGate conserva settlement→idle y la carrera con abrir/cancelar.
Si el módulo no está listo, la selección actual mantiene su gate anterior;
una selección nueva usa Rust cuando está disponible. No se reinicia ni
se retrasa la selección. Rust no retiene píxeles ni objetos del libro.
Se conserva el orden exacto de microturnos, los motivos estrictos de release,
errores de idle y la posibilidad original de idle tras una cancelación.
Los handlers pertenecen a las promesas JS; sus finalizadores liberan las
capturas de Rust al recogerlas, incluidas señales que nunca se resuelven.
6 casos originales de gate y24 nuevos de turnos/carreras aprobados.
La prueba focal del prototipo seleccionó esos6; los otros47 de caché del
archivo quedaron sin ejecutar y no se cuentan como aprobación nativa.
169 focalizadas/7 archivos/6.70s y6478 completas/433 archivos/364.57s
aprobadas.2 E2E finales nuevos/26.3s verifican abrir y cancelar una selección
real, una instancia UI y los exports de gate; también con módulo pendiente.
2000 ciclos terminados y2000 adicionales (1000 terminados/1000 cancelados)
en Chromium vuelven a0 referencias después de dos recogidas forzadas por lote.
No se afirma liberación inmediata antes de GC ni ausencia de cualquier fuga.
Se corrige un desajuste de la caché al rebajar el destino de una imagen
readonly: Reflect.set(false) no reproducía el TypeError original. Dos tests
reprodujeron ese error y su log cache-readonly-original.log se conserva.
El host ejecuta la misma asignación estricta/spread original; Rust decide
cuándo y las coordenadas. Los dos casos readonly y todos los anteriores pasan.
7407 Rust/38112 JS =16.27%,97/289 archivos propios no vacíos, incluyendo
comentarios/fallback; no es porcentaje de funciones terminadas.
UI local927386 bytes, SHAc5ad1ba048acd05872b4422cae45361df4dbae2e932924b79a46b136df40d563.
App/decor/voice y los modelos/renderizadores mantienen sus bytes de230.
No se atribuye una mejora global de velocidad a la coordinación del gate.
62 E2E finales/10.9m aprobados sin reintentos, incluidos los contratos de
cierre8s. Publicación231 comprobada:
main68e8d7532677ab380cdaa0e0d893e25c4131e009,
Deploy38384051846/Pages38384207527 aprobados,
Pages1732325a1adc8eb3b5deef856e830ed2b536c8d2.
109 archivos públicos coinciden HTTP/tamaño/SHA/atribución.
UI pública927354 bytes, SHA3c84f634aa14a6deb36eccbda38243f0ae9cd0fbdbb15074a065f31a252c9306;
local Windows927386. Se comprueban bytes/exports públicos sin presumir
igualdad con el binario local. Dos perfiles exactos,una instancia UI,
referencias estables tras1000 preparaciones/100 menús y30 PCM aprobados.
2 PDF/42.0s,12 escena/importación/apertura/cancelación/1.9m y3 perfil/updater
/14.1s públicos aprobados. APK real descargado: bytes/firma/loader2107
aprobados. Android muestra231/PID31728: content URI real,
Lessac2×10.1210430839s,8done/9start,mismo proceso y sin FATAL.
APK1.1.15/28 y B intactos. CI231/38384051939 terminó con fallo en UI6/115251299058:
shelf-light-effect esperaba data-active-lamp-lights="3" después de recargar
nogal y observó el atributo ausente durante el plazo original de 8 s.
Su reintento pasó, pero se rechaza como flaky. Unitarias, demás UI y las
cuatro tandas de voces reales aprobadas. No se afirma aprobación global.
Log, captura, trace y reporte originales conservados en
rust-stage-prototype/ci231-ui6-original-artifact; también el agregador fallido.
APK1.1.15/28, A/B y revisión compartida del updater intactos.
CI230 falla sólo en UI2/115234622203; los fallos y logs originales de229/230
se conservan. No se afirma su corrección.
Evidencia: D:/CodexEvidence/InhouseRead-20261012/rust-stage-prototype.

# 1.7.230 — página preparada en Rust

Changelog: «Página preparada gestionada en Rust».
RustPreparedPageCache conserva generación, ticket, clave y bitmap originales,
sin copiar píxeles/texturas ni iniciar otra preparación. La incorporación
tardía transfiere estos mismos objetos y su estado, luego libera las
referencias de la cola anterior. No espera la descarga de WASM.
Rust valida la prioridad original de libro/motor/posición/viewport/tema,
JSON y coerciones, invalida trabajo antiguo y consume la página una sola vez.
Un desplazamiento rígido rebasa sólo su destino. La expansión del objeto
de bounds conserva propiedades adicionales y símbolos en el host.
invalidateBook sigue delegando mediante this.invalidate, incluso si se
observa/sustituye ese método. La espera de animación (StageGate) sigue JS.
7373 Rust/38104 JS =16.21%,96/289 archivos propios no vacíos; incluye
comentarios/fallback, no es porcentaje de funciones terminadas.
47 pruebas de caché/clave por cada implementación +6 StageGate JS por lado:
106 del prototipo aprobadas.137 focalizadas/5 archivos/5.30s aprobadas;
6446 unitarias completas/431 archivos/362.38s aprobadas.
200 vidas nativas completas liberan todas sus referencias.
2 E2E nuevos/18.5s consumen una página real con fuente y dimensiones
positivas usando la caché nativa, tanto preparada como con módulo pendiente.
El espía queda sólo en los tests; una instancia UI y una caché por caso.
La primera ejecución focal tenía una llave ausente en el test nuevo:
unit-focused-syntax-original.log se conserva; corregida sin cambiar asserts.
El primer E2E esperaba dataset.phase, inexistente. Se conservan new-e2e.log
y trazas; se usa la clase real is-ready, manteniendo el plazo90s.
Store nativo se exige en el caso preparado; el tardío puede transferir
un store anterior JS. Ambos exigen Take nativo y bitmap real no nulo.
UI local925030 bytes, SHA11eddc086d675944971d52760f34d9c644cd1f998cad5197f196aa5a8475356a;
app/decor/voice mantienen exactamente los hashes de229.
Esta migración conserva la coordinación; no se atribuye velocidad global.
60 E2E finales/10.4m aprobados sin reintentos, incluidos los contratos
de cierre8s. Publicación230 comprobada:
main4f98dc2fa88860c6a84bc7de4795b84fe961176a,
Deploy38379054377/Pages38379223722 aprobados,
Pages9ac0dbcf66a7a0a0250d11492352f837b85aeadc.
109 archivos reales coinciden HTTP/tamaño/SHA/atribución.
UI pública925006 bytes, SHAf37d19b8b38cd49858cf7eb6b595ad36f8d71d686b24534a53695ee3e48e2b44;
local Windows925030. Se comprueban los exports y bytes públicos; no se
presupone igualdad con el binario local. Dos perfiles exactos,una instancia
UI,referencias estables tras1000 preparaciones/100 menús;30 PCM aprobados.
2 PDF/42.2s,10 escena/importación/apertura/1.5m y3 perfil/updater/14.5s
aprobados. Ambos casos públicos consumen el bitmap real mediante Rust.
APK real descargado: bytes/firma/loader2107 aprobados. Android muestra230,
PID31026,content URI real,Lessac2×10.8341043084s,8done/9start,mismo proceso
y sin FATAL. APK1.1.15/28 y B intactos.
CI230/38379054732 fallida sólo en UI2/115234622203: ambos contratos de
cierre8s fallan también en reintentos; todos los otros trabajos aprobaron.
ci230-ui2-original.log y su artefacto se conservan íntegros.
APK1.1.15/28, A/B y revisión compartida del updater sin cambios.
La CI229 fallida se conserva; no se afirma corrección a sus cierres.
Evidencia: D:/CodexEvidence/InhouseRead-20261012/rust-prepared-prototype.

# 1.7.229 — cola de biblioteca en Rust

Changelog: «Biblioteca coordinada en Rust».
RustShelfRefreshQueue gestiona la agrupación, espera80ms, barreras inmediatas,
lecturas en curso y lotes posteriores. La lectura de IndexedDB conserva el
cliente original y sus objetos/bytes. Los Promise.then conservan el orden
de los dos microturnos originales; errores falsy conservan su identidad.
Cancelar resuelve el lote pendiente y mantiene el resultado del ya iniciado.
La cola anterior se mantiene durante lecturas o plazos en curso; Rust se
incorpora a la siguiente petición inactiva, sin esperar el módulo. Timers
inyectados, módulos incompletos o constructores fallidos conservan la cola JS.
Al cerrar el host se liberan callbacks/temporizador; los callbacks del lote
activo sobreviven sólo hasta que termina.100 colas completas dejan0 referencias.
Inventario:7303 Rust/38068 JS =16.10%,95/288 archivos propios no vacíos,
incluyendo comentarios y fallback; no es porcentaje de funciones terminadas.
39 focalizadas/3 archivos aprobadas;6383 unitarias completas/429 archivos,
370.97s aprobadas.2 nuevos E2E/19.3s comprueban bytes reales de dos PDF,
una instancia UI y una cola nativa, también con descarga pendiente.
UI911842 bytes, SHA7378659c87f5ed3573343df76bcedcf55d9538203700e3cea46c22763dcf0f6c.
App/decor/voice mantienen exactamente los hashes de228. No se cambia el
tiempo del lector, los motores, la paginación ni la síntesis. Este bloque
migra coordinación; no se atribuye una mejora global de velocidad.
58 E2E finales/10.4m aprobados sin reintentos, incluidos ambos contratos
de cierre8s. Publicación229 comprobada:
main8444200c69b92a53be7a861bf48cf49cb86e7979,
Deploy38372897094/Pages38373057742 aprobados,
Pagesc18dee41a99cf3326b5da11b42c7908809a2d7e9.
109 archivos públicos coinciden HTTP/tamaño/SHA/atribución.
UI pública911810 bytes, SHAe843030d0382589a8c23c42230759fb6e9bbfbb4fd6a58a65182c474ad92f04a;
la compilación local Windows mide911842. Se comprueban los bytes reales
publicados y sus exports; no se presupone identidad con el binario local.
Dos perfiles exactos,una instancia UI,referencias estables tras1000
preparaciones/100 menús;30 controles PCM aprobados.100 colas públicas,
200 peticiones/lecturas,referencias501→501,una instancia.
2 PDF/42.3s,8 escena/importación/1.1m y3 perfil/updater/13.7s aprobados.
APK real descargado: bytes/firma/loader2107 aprobados. Android muestra229,
PID30218,content URI real,Lessac2×11.0667120181s,7done/8start,mismo proceso
y sin FATAL. No se reemplaza el APK1.1.15/28 ni se modifica B.
CI229/38372897088 fallida sólo en UI2/115214011214: los contratos alineado
y legado de cierre8s fallan, también en sus reintentos. Todos los otros
trabajos de producción aprobaron. Logs/artefactos ci229-ui2-original
conservados íntegros; no se afirma corrección a esos cierres.
Los prototipos de gesto y UV de cubierta no se incluyen ni se cuentan:
94 pruebas de gesto aprobadas, pero el puente añade coste (.095→.170ms
por gesto de un movimiento, .91→1.165ms por60, escritorioCPU×4).
108 cubiertas UV exactas; copiar buffers pequeños también añade coste.
Sus fuentes, mediciones y fallos originales quedan fuera del repo en
rust-gesture-prototype y rust-board-prototype. El fixture inicial de UV
borraba también las caras que la función no modifica; se conserva el fallo
y se compara el buffer completo contra la misma entrada del original.
La CI228 fallida y sus artefactos se conservan; no se afirma su corrección.
APK1.1.15/28, canales A/B y revisión compartida del updater sin cambios.
Evidencia: D:/CodexEvidence/InhouseRead-20261012/rust-refresh-prototype.

# 1.7.228 — sincronización de audio en Rust

Changelog: «Sincronización de páginas más rápida».
El módulo voice calcula una sola vez las sumas de duraciones VITS y las
reutiliza para todos los límites de texto. Mantiene el orden f64, redondeo
y clamp originales, offsets e identidades. No cambia la síntesis, velocidad,
audio ni el momento configurado para cambiar de página. Su carga opcional
empieza al preparar cualquier voz; nunca bloquea Play.
Paquetes incompatibles, pequeños, inválidos o módulo pendiente usan el
algoritmo anterior. Arena retenida limitada a64KiB; las grandes se liberan.
Voice25375 bytes, SHAb35db296b006124581cf5f71b8a58f061d508749486a5c9f261c9920f7d24067.
App/decor conservan exactamente sus hashes. Inventario:7233 Rust/38040 JS,
15.98%,94/287 archivos propios no vacíos; no mide funciones terminadas.
10000 comparaciones exactas de paquetes,200 ciclos, capacidad196608 estable.
81 focalizadas/4 archivos,6356 unitarias/427 archivos/362.35s y56 E2E/9.9m
aprobados, sin reintentos; se mantienen los contratos de cierre8s.
Benchmark del puente completo, Chromium escritorio390x844/CPU×4:
128 duraciones/1 límite .020→.00667ms;128/8 .070→.00667ms;
480/4 .12667→.01333ms;1000/16 .690→.02667ms.
No mide el teléfono, GPU, ORT o la latencia completa del botón Play.
El primer import externo Node falló por la URL Vite; se conserva el log y
la comparación usa la fuente anterior congelada. La primera prueba E2E
multilingüe no vio el espía porque el worker llegó desde la caché SW.
Su traza original se conserva; el contrato multilingüe mantiene sus asserts
originales y la prueba de ejecución nativa se observa en el caso de red.
2 E2E corregidos/36.4s y los56 finales aprobados, sin cambiar plazos.
Publicación228 verificada: main16561930c5bba01fea3dd0e35598f468dcb5cd98,
Deploy38361488122/Pages38361591520 aprobados,
Pages7d72bac1d0e90bb77defab53d6cdb0346ed662b3.
109 archivos reales coinciden HTTP/tamaño/SHA/atribución;10000 paquetes de
duraciones nativos exactos sobre el WASM público,200 ciclos196608 estable.
Dos perfiles de navegador exactos,una instancia UI,referencias estables
tras1000 preparaciones/100 menús;30 controles PCM aprobados.
2 PDF/41.4s,6 escena/53.5s y3 perfil/updater/14.3s públicos aprobados.
El primer intento de artefactos usó el fetch fuera del repo: la referencia
Pages era antigua; se conserva public-artifact.log y se repite con el fetch
correcto. El primer intento PDF señaló una carpeta de pesos inexistente;
se conservan log/trazas y se repite con los mismos pesos reales de Davefx.
APK real descargado: bytes/firma/loader2107 aprobados. Android muestra228,
PID29279,content URI real,Lessac2×10.1786848073s,8done/9start,mismo proceso
y sin FATAL. APK1.1.15/28 inmutable, B sin cambios.
CI228/38361488174 fallida. UI2/115176487868 conserva los dos contratos de
cierre8s; el cierre legado del reintento midió9272.7ms. UI6/115176487867
falló al encontrar la posición para arrastrar un libro con Drive (línea574,
null) y pasó en el reintento, rechazado como inestable. El resto de trabajos
de producción aprobó. Logs y artefactos ci228-ui2-original y
ci228-ui6-original se conservan íntegros; no se afirma solución a esos fallos.
La CI227 fallida sigue conservada; estas pruebas no demuestran su solución.
APK1.1.15/28 y canales A/B intactos; updater fijado6621ca1 sin cambios.
Evidencia: D:/CodexEvidence/InhouseRead-20261012/rust-duration-prototype.

# 1.7.227 — fonemas de hebreo en Rust

Changelog: «Preparación de fonemas más rápida».
Módulo voice independiente (dominio2), sin dependencias ni imports del host.
Reglas de Piper efffbfb226bfb511ebbcf55d0cecd8b35a89743d/GPL3;
NFC y clases combinantes siguen en el navegador para conservar su Unicode.
Un paquete por fragmento contiene glifos/marcas/separadores de palabras.
Rust agrupa consonantes/vocales/sheva y acento, conserva vacíos y glotales.
Los textos pequeños (<96 UTF16), módulos pendientes/incompletos, paquetes
grandes o UTF16 no emparejado conservan las mismas reglas anteriores.
Carga opcional al preparar una voz hebrea, junto a Nakdimon, en el worker
y en NativeSynthClient. Play nunca espera la descarga de este módulo.
Arena retenida como máximo64KiB; los paquetes grandes liberan su arena.
Stack64KiB sólo para voice; app/decor conservan hashes/tamaños originales.
Voice23993 bytes; 10029 comparaciones directas, 200 ciclos, memoria196608
estable. 10000 entradas adicionales comparadas en el adaptador, con8052
llamadas nativas exactas según el umbral medido; los demás casos son cortos.
156 pruebas focalizadas/4 archivos aprobadas con los bytes finales.
La primera prueba esperaba >9000 llamadas sin calcular los casos elegibles:
se conserva unit-focused-threshold-original.log; el assert ahora exige8052,
el número exacto de textos >=96, y mantiene todas las comparaciones de salida.

Benchmark final, Chromium escritorio 390x844/CPU×4, paquete/copias/formato:
124 UTF16: 0.260→0.160ms; 372: 0.600→0.440ms;
1240: 1.900→1.300ms; 6200: 9.180→6.040ms.
No mide teléfonos ni latencia total de Play, inferencia ORT o descarga.
La voz Saspeech63,221,984 bytes y Nakdimon21,312,753 bytes se verificaron
contra el catálogo/MD5 y SHA fijado de Nakdimon; pesos/config/URLs/hashes
en weights.json. El primer import Node usó una ruta C:/ sin file://;
weights-path-original.log conserva ese fallo, corregido antes de descargar.
3 E2E reales finales/32.6s: IPA nativo1 llamada, instancia única,
PCM11.7207256236s/22050Hz finito, peak0.9/rms0.136, sin red de modelos
durante la lectura larga; WAV/JSON en real-voice-final. No se añaden voces.
La instrumentación está sólo en el spec y observa el worker compilado.
Se mantienen los asserts previos del catálogo y se añade un caso largo.

Prototipos retenidos y excluidos de producción/inventario:
- biblioteca IndexedDB: 600 comparaciones, 78 focalizadas; el controlador
  añadía1–1.5ms por cuatro operaciones en Chromium/CPU×4, aun con métodos
  y propiedades directos. Los bytes fuente y fallos originales quedan en
  library-store-prototype. Los fixtures jsdom Blob no clonables se corrigieron
  a Blob nativo, manteniendo los asserts; la prueba inicial tras reload
  esperaba listAll, pero el arranque lee mediante shelf-boot. Sus trazas
  originales se conservan. No se publica este controlador más lento.
- argmax y merge de Nakdimon: los cruces/copias eran más lentos que JS;
  browser-benchmark-root/merge/merge-fast y fuentes *held conservan resultados.
  Ni estos exports ni sus puentes se incluyen en voice publicado.

Inventario local: 7206 Rust/38004 JS =15.94% (93/286 archivos propios),
líneas no vacías, incluyendo comentarios y fallback; no funcional.
6344 unitarias completas/426 archivos aprobadas, 361.03s.
56 E2E/9.9m aprobados sin reintentos: los 54 de lectura/audio/UI y los
dos contratos nativos de regreso conservan su assert de cierre8s.
Esto no prueba una solución a los fallos intermitentes originales de CI226.
Publicación 1.7.227 comprobada: main6902132831630e1f9c7e4b86733311fb5eed0201;
Deploy38355983588/Pages38356108256 aprobados;
Pagesb0f7bc18b5160eb710ed4926460ffd62b6092870.
109 archivos públicos coinciden en tamaño/SHA/HTTP y atribución.
Voice23993 bytes, SHA49bbdb7acea80a8f7e6fc50b6614afade60bc8a041ec25cb1efcfc22105925bc;
58 controles IPA sobre esos bytes publicados, 200 ciclos, memoria327680 estable.
Dos perfiles de navegador exactos; 1000 preparaciones/100 menús por perfil,
una instancia UI y referencias estables; 30 controles PCM aprobados.
2 PDF/41.6s, 6 escena/52.6s y 3 perfil/updater/14.4s públicos aprobados.
APK A real descargado: bytes, firma y loader2107 aprobados; B sin cambios.
Android muestra227/PID28597: content URI real, Lessac2×10.0373242630s,
8done/9start, mismo proceso y sin FATAL. No se reemplaza APK1.1.15/28.
CI227/38355983616 fallida: UI2 conserva los dos cierres de8s; UI6
registra cuatro enlaces de shaders al retirar un libro (esperaba0).
Su reintento pasó, pero CI rechaza el caso inestable. Logs y artefactos
ci227-ui2-original y ci227-ui6-original conservados sin modificar.
La CI226 fallida y sus trazas originales siguen conservadas.
APK1.1.15/28, catálogos A/B, firma y updater sin cambios.
Evidencia: D:/CodexEvidence/InhouseRead-20261012/rust-hebrew-prototype.

# 1.7.226 — proyección de las hojas en Rust

Changelog: «Zona táctil de plantas más rápida».
Rust transforma los vértices Float32 de cada malla con el mismo orden f64
 de Three y selecciona sus triángulos frontales. Se conservan modelos,
matrices, umbral y orden del camino. El navegador conserva toFixed(2),
incluidos redondeos y signo; reutiliza el rótulo de cada vértice compartido.
Los atributos personalizados, normalizados/intercalados, módulos fríos y
paquetes no compatibles mantienen la proyección anterior. Un índice vacío
sigue distinto de una malla sin índices. Se limita a 100000 vértices/450000
índices por malla; no se guardan objetos de escena en Rust.

74 controles geométricos exactos y 200 ciclos, memoria
524288 bytes estable, 0 referencias retenidas.
Ocho modelos reales en seis poses: 48 comparaciones exactas adicionales.
78 focalizadas, 6256 unitarias completas/425 archivos y
54 E2E aprobados sin reintentos. Los dos nuevos casos comparan el camino SVG
real antes/después de girar la cámara y observan el export Rust, también
tras una descarga pendiente. Se comprueban huecos, controles personalizados,
fallback, tipos, índices vacíos, paquetes inválidos y memoria.

Chromium 390×844, escritorio CPU×4, mallas cerradas sintéticas, camino entero:
160 triángulos 0.545→0.360 ms;
1056 triángulos 3.470→1.555 ms;
4416 triángulos 13.385→5.280 ms.
Incluye transformación, copias, selección, formato y concatenación. Excluye
DOM, parseo nativo del hit-test y GPU; no mide plantas reales en un teléfono.
Las cadenas de los tres casos coinciden exactamente con el código original.
El benchmark y controles se repitieron con el módulo/puente compilados finales.

Los errores iniciales del harness externo (ruta cruzada entre discos y URL
virtual de Vitest) quedan en real-models*.log; ocho casos reales pasaron tras
corregir la ruta. unit-focused-original.log conserva un control de memoria
con la etiqueta «leaf», que el regex original no selecciona. Se corrigió a
«leaf-0», manteniendo el assert de 201 llamadas Rust y los demás controles.
También se corrigieron dos controles de índices y memoria del prototipo.
La normalización de finales de línea de la escena se reconstruyó desde bytes
originales; no se reescribe todo el archivo. El runtime sólo cambia la import
 de la proyección y su función.

La primera tanda E2E conserva 53 aprobados/1 fallido y su traza original.
La prueba de listas inicializaba WASM manualmente durante el arranque de la
app: la traza acredita varias peticiones simultáneas del mismo módulo y
cinco traps desde callbacks del documento. El spec usa ahora el helper de
arranque compilado compartido, manteniendo acciones/asserts/plazos y el caso
 de descarga retrasada, y añade un assert de una sola instancia. Tres casos
focales y la tanda completa de 54 pasan. El runtime de inicialización no cambia.

CI225/38341619187 terminó correctamente en todos los jobs. Los fallos
originales de otras revisiones siguen registrados, sin atribuírseles solución.
Inventario: 7101 líneas Rust/
37954 JS = 15.76%, no funcional.
UI local 904778 bytes, SHA256 556cfeadc45acdc82c9100ab528a41fbe67ef3f3c21f54954865860abc534939.
Publicación 1.7.226 comprobada: main 39f78f8182ce4d81b309a342d87da11cfea5dd88;
Deploy38349194617 y Pages38349310725 aprobados;
Pages16724cd18600c3a63e68370d0a808c12f9a341fb.
Los 108 recursos públicos coinciden en tamaño/SHA/HTTP y atribución.
UI904746 bytes, SHA a9f279d7ae36dd6507303bf4da8e5b6b6e8693737e183bdb68f4e4d263587283.
Dos perfiles de navegador exactos; 1000 preparaciones/100 menús por perfil:
515→533→515 referencias, una instancia; 30 controles PCM públicos aprobados.
2 PDF/42.0s, 6 escena/53.7s, 3 perfil/updater/14.6s públicos aprobados.
APK A real descargado, firma/bytes y loader2107 comprobados; B sin cambios.
Android: versión visible226, PID27894, importación content URI real,
Lessac2×12.0291609977s, 8done/9start, mismo proceso y sin FATAL.
CI226/38349194909 falló: UI2/115137468952 conserva 104 aprobados y
2 contratos de regreso fallidos, tanto el primer intento como el reintento:
native-aligned-shelf-return y native-legacy-shelf-return, cierre8s.
Logs y artefacto11791371080 se conservan en ci226-ui2-original*.
Los demás jobs de producción pasaron; el job agregador informa fallo.
No se atribuye una solución a estos fallos ni se cambia el plazo.
public-artifact.log conserva una atribución fallida contra origin/gh-pages
local obsoleto: git fetch se lanzó fuera del repo. Tras fetch en el repo,
public-artifact-current.log verifica la revisión correcta sin omitir controles.
APK1.1.15/28 y updater sin modificaciones.
Evidencia: D:/CodexEvidence/InhouseRead-20261012/rust-foliage-prototype.

# 1.7.225 — estilos físicos de los lomos en Rust

Changelog: «Preparación de lomos más rápida».
Una llamada por sección calcula hashes UTF-16, paleta, textura, altura y grosor
físico según palabras, con el mismo orden f64 y redondeo. El host conserva la
normalización del libro, identidad de paletas y objetos de la escena. El layout
recibe los estilos preparados; sus posiciones, plantas, orden, espaciado y
callbacks conservan la implementación existente. La llamada habitual sin
preparación mantiene su orden original de evaluación.
Los módulos fríos, antiguos o fallidos conservan el cálculo anterior, igual
que valores no compatibles, NUL y surrogates sin pareja. Los paquetes se
limitan a 4096 libros/1 MiB y los resultados se validan antes de usarlos.

3503 comparaciones exactas con el módulo compilado real;
3500 adicionales en Chromium. 200 ciclos, 0
referencias retenidas y 655360 bytes estables.
97 focalizadas, 6227 unitarias completas/424 archivos y
52 E2E aprobados sin reintentos. Los dos nuevos casos observan el kernel real
sobre bytes importados y palabra total calculada por la app, tanto listo como
tras una descarga pendiente. Incluyen fallback, memoria, referencias, planos
completos y rechazo de paquetes/vectores inválidos.

Chromium 390×844, CPU de escritorio ×4, preparación/copias/objetos incluidas:
20 libros 0.097→0.065 ms;
100 libros 0.410→0.232 ms;
700 libros 2.820→1.093 ms.
Se excluyen DOM, layout y GPU. No demuestra ese ahorro en el renderizado entero
ni rendimiento/temperatura de un teléfono físico. El benchmark y comparaciones
se repitieron con el WASM y puente definitivos, incluidos sus validadores.
El primer script externo de integración conserva un error de comillas;
se corrigió antes de ejecutarse, sin cambios parciales en el runtime.

CI224/38337212120 queda rechazada: UI2/115099896750 conserva ambos cierres
fuera de 8 s; lectura/115099896830 conserva el primer cambio de voces que no
encontró PCM activo con margen >3 s en 90 s. El reintento aprobado no se toma
como aprobación. Logs y artefactos originales en rust-profile-view-prototype.
Esta entrega no se atribuye la solución de esos fallos.

Inventario: 7070 líneas Rust/
37929 JS = 15.71%, no funcional.
UI local 902039 bytes, SHA256 445cdc46beff136df8b71cce1275f54ab5ac642434e91f8de549697a279ae6d8.
Publicación verificada: 91efdb19d46dba2eb16c5c90d4fb820c927bdeda.
Deploy 38341619134/Pages 38341727067; Pages 59cc0aec610d6597554eca44699a99f1dfb398d7.
UI pública 902007 bytes, SHA256 d64a2da484fd24550c6845e049f989d6be34755e8d5fbe9a13805ce93a5f3b62.
published-1791862195493: HTTP/tamaño/SHA, dos perfiles,
515→533→515 referencias, 1000 preparaciones/100 menús y una sola instancia,
30 casos PCM/tempo y APK real/loader 2107 bytes correctos.
Dos PDF públicos, cuatro del catálogo/lomos y tres del perfil aprobados.
APK 1.1.15/28 muestra web 225: Lessac 2×, 10.27s,
8 finales/9 inicios, PID 26908 estable, sin FATAL.
CI 38341619187 se registra aparte: no se presupone aprobado.
Updater sin modificaciones.
Evidencia: D:/CodexEvidence/InhouseRead-20261012/rust-shelf-styles-prototype.

# 1.7.224 — menú de cuenta en Rust

Changelog: «Menú de cuenta en Rust».
Rust posee las referencias, foto, iniciales, etiquetas, visibilidad y estado
 del perfil, y gestiona sus eventos y foco. Los setters reciben JsValue:
conservan UTF-16, coerciones DOM y URLs. Se reutilizan valores primitivos;
los objetos se convierten cada vez y las imágenes fallidas se reintentan.
El updater se cierra mediante su callback anterior. La ruta compuesta protege
los botones reemplazados durante una pulsación.
La carga espera el primer frame. La adopción conserva el DOM y el menú abierto,
con un solo conjunto de listeners, liberado al descartar la página. Bfcache se
conserva. OAuth, Drive y sincronización siguen en sus clientes existentes.

6464 comparaciones DOM y 101 ciclos; control
0→21→0, 1310720 bytes estables.
59 focalizadas, 6213 unitarias completas/423 archivos y 50 E2E aprobados.
Los nuevos casos observan construcción/conexión Rust, descarga pendiente,
foco, Escape, actualización inline, foto fallida y 1000 actualizaciones.
Chromium 390×844, escritorio CPU×4, ciclo DOM/puente con datos repetidos:
0.0130 ms JS/0.0115 ms Rust. No acredita aceleración
significativa global; se excluyen red, imágenes, OAuth y GPU. Los prototipos
más lentos Reflect/setters separados se mantienen fuera del runtime.

Se conserva unit-focused-original.log (sintaxis de la prueba nueva corregida).
new-e2e.log y su artefacto conservan el caso sin query Android que esperaba
una entrada Android en modo web. El helper ahora permite una URL de arranque;
ambos casos usan inhouse_app=1, sin alterar asserts ni plazos.
El primer generador del informe falló al leer JSON UTF-8 como cp1252. El código
verificado se publicó como 00282c71fc0b9243b5257178db3ab68b62200a93; este informe
se corrige después, sin cambiar ese runtime. CI223 mantiene los cierres
originales fuera de 8 s; no se atribuye su corrección a esta entrega.

Inventario: 7027 líneas Rust/37908 JS = 15.64%, no funcional.
UI local 897586 bytes, SHA256 ff5325aa0cbb34b026f7f300ca99763f96f11edb6cdbf54571495e6b2ddf7f88.
Publicación verificada: 00282c71fc0b9243b5257178db3ab68b62200a93.
Deploy 38337211985/Pages 38337320827; Pages b141471db95553d66d39dc9f50239d0831e39b32.
UI pública 897554 bytes, SHA256 dac62117fb8b61164438b6fc96d80dfab3974da4aa0ca5166fd40435017a5534.
published-1791858891560: HTTP/tamaño/SHA, dos perfiles exactos,
1000 preparaciones/100 menús, 515→533→515 referencias y una sola instancia,
30 pruebas PCM y APK real con loader 2107 bytes correctos.
Dos PDF públicos, tres del perfil/updater y dos del catálogo aprobados.
Los PDF iniciales con query Android conservaron un aviso real del updater
interceptando las pulsaciones. El segundo intento con URL habitual conserva
un error de archivo de traza eliminado por otro proceso Playwright que
compartía outputDir. La comprobación final usa carpeta exclusiva y conserva
los asserts: dos PDF aprobados (39.3 s). Los originales quedan separados.
APK 1.1.15/28 muestra web 224: Lessac 2×, 10.23s,
8 finales/9 inicios, PID 26299 estable, sin FATAL.
CI224/38337212120 conserva UI de voces reales/115099896830: el primer cambio
entre voces no encontró PCM activo con más de 3 s de margen en 90 s.
El reintento completo aprobado no convierte el job original en aprobado.
Log y artefacto original en rust-profile-view-prototype/ci224-reading.
El estado de los restantes jobs se registra aparte; updater sin modificaciones.
Evidencia: D:/CodexEvidence/InhouseRead-20261012/rust-profile-view-prototype.

# 1.7.223 — ilustraciones del catálogo en Rust

Changelog: «Ilustraciones del catálogo en Rust».
Rust compone los trazos originales de ocho plantas y cuatro estructuras de
maceta, en sus modos normal, compacto y sólo maceta. Los SVG fijos mantienen
sus cadenas originales. Para palmeras y helechos, Rust conserva las fracciones,
coeficientes, caminos y plantillas; el navegador calcula seno/potencia y
formatea los números como antes. Se intercambian como máximo 10 tamaños y
90 coordenadas por especie. Una pasada sustituye todos los caminos repetidos;
el módulo frío o incompleto conserva la implementación original.

1560 escenarios exactos, 4680 ciclos; 0
referencias retenidas y 1376256 bytes estables en el prototipo.
Control positivo 0→4→0.
216 comparaciones exactas adicionales en Chromium.
104 focalizadas, 6185 unitarias completas y 47 E2E aprobados.
La app compilada observa los cuatro nuevos exports realmente ejecutados.
Se comprueban defaults, getters, límites, inputs no finitos y fallback.

Chromium 390×844 con CPU de escritorio ×4:
216 SVG completos, copias incluidas, 7.77→5.40 ms;
12 iconos con creación/inserción DOM, 5.00→4.90 ms.
La medida DOM no acredita una aceleración significativa; se excluyen estudios
3D y GPU. No se afirma rendimiento en un teléfono físico.
browser-diagnostic.log conserva la diferencia decimal entre Node y Chromium
en un helecho; se corrige conservando Math y String del navegador.
browser-benchmark-before-scan.json conserva el ensamblador de múltiples
sustituciones más lento; la pasada única conserva toda la cadena SVG.

CI222/38326294878 queda rechazada: UI2/115065642651 conserva el cierre alineado
fuera de 8 s; UI5/115065642880 no observó la construcción del navegador Rust;
UI6/115065642815 tomó una página adaptable vacía como referencia antes del
render y la comparó con el texto completo tras narrar. Logs completos y
artefactos originales en rust-catalog-view-prototype/ci222-ui2/ui5/ui6.
El harness de navegación ahora usa el arranque compilado compartido; el de
resaltado espera el último marcador de la página antes de tomar su baseline.
Se conservan las acciones, los asserts finales, las esperas y los plazos.
Los specs anteriores se conservan fuera del repo. Los cierres y shaders de
otras revisiones siguen pendientes; esta entrega no se atribuye su corrección.
CI221/38321026325 conserva cuatro enlaces de shaders en UI6/115048891217 y
un reintento correcto rechazado, con originales en rust-book-projection-prototype.

Inventario: 6919 líneas Rust/37915 JavaScript = 15.43%, no funcional.
UI local 885881 bytes, SHA256 24af3a29a63e0ca3307c90216c04ca84373fa8e9525cbeebc9137496a47c733e.
Publicación verificada: 57e0cc1ff0c84940a1108980d81c432a0b2e9602.
Deploy 38330363754/Pages 38330469444 completos; Pages 216991e51af0373665f015e8462669ccdd1d030f.
UI pública 885849 bytes, SHA256 fc13cbbedd0475791fde2f73aba902e240be3b29f5b51c0f3baf8d51b6b28b48.
published-1791853726061: recursos HTTP/tamaño/SHA, dos perfiles,
1000 preparaciones/100 menús con control positivo y sin fugas,
30 casos PCM/tempo y APK real loader 2107 bytes correctos.
Dos E2E públicos PDF y dos del catálogo aprobados sin reintentos.
APK 1.1.15/28 muestra web 223: Lessac 2×, 10.90s,
8 finales/9 inicios, PID 25587 estable y sin FATAL.
CI223/38330363770 conserva ambos cierres nativos fuera de 8 s en
UI2/115078497117, con fallos originales y artefactos separados en
rust-catalog-art-prototype/ci223-ui2-original.log y ci223-ui2-artifact.
Los restantes jobs de UI, unitarias y voces reales terminaron correctamente.
El resultado global queda rechazado; no se usan reintentos como aprobación.
Updater sin modificaciones.
Evidencia: D:/CodexEvidence/InhouseRead-20261012/rust-catalog-art-prototype.

# 1.7.222 — vista y controles del catálogo IKEA en Rust

Changelog: «Controles del catálogo IKEA en Rust».
Rust construye el árbol del catálogo y sus filas, normaliza los estilos de
las muestras con el mismo CSSOM del navegador, conserva sus nodos y actualiza
sólo los textos y estados que cambian. Una única escucha delegada resuelve
los botones desde sus SVG, textos o activación por teclado y llama al
controlador existente. Se conservan nombres, IDs, orden, foco, palettes,
tamaños, cámara, estudios 3D y callbacks de almacenamiento. Las ilustraciones,
la selección y el vuelo siguen con sus implementaciones originales.

El constructor recibe el documento del host: evita crear referencias globales
adicionales. Los paquetes de opciones son acotados y se construyen agrupados;
el texto se escapa como en textContent/setAttribute. Los catálogos creados
antes de que llegue WASM conservan todos sus controles y adoptan sólo la
actualización Rust en su siguiente operación, sin reconstruir el diálogo ni
duplicar escuchas. Destroy libera tanto la vista como su escucha.

681 comparaciones exactas del DOM, 40 ciclos y
1000 actualizaciones; control positivo 0→53→0.
El prototipo conserva 720896 bytes y cero referencias retenidas.
103 focalizadas, 6154 unitarias completas y 45 E2E aprobados.
Los 21 casos originales del catálogo se ejecutan en legado, Rust y adopción
tardía. Las pruebas nuevas observan los seis exports reales en la app
compilada y retienen la descarga de WASM para comprobar la recuperación;
también prueban límites, escape, escucha única y destrucción desde la escucha.

Chromium 390×844, CPU de escritorio ×4, sin estudios 3D/GPU:
actualización 0.1110→0.0450 ms;
constructor completo y liberación, con opciones ya preparadas,
8.47→8.25 ms.
La dispersión del constructor no permite atribuir una aceleración significativa.
La primera generación de opciones permanece fuera de esa última medida;
se conserva el paquete estático después de crear el primer catálogo.
browser-benchmark-builder-css.log conserva el constructor inicial más lento
(8.24/13.20 ms); los ensayos de HTML, paquete y caché permanecen separados.
No se afirma una mejora de GPU ni de rendimiento en un teléfono físico.

Los intentos originales se conservan: build.log documenta una redirección de
log sobre sí misma; build-cargo.log, una declaración incorrecta; check-builder-
retention.log, dos referencias retenidas evitadas al recibir el documento;
browser-benchmark-html.log, el orden de atributos CSSOM corregido. El primer
E2E esperaba CACTUS en vez del nombre real FEJKA y un color inexistente,
y liberaba un route antes de su continuación. Su spec, log y artefactos
quedan en new-e2e-original-artifact/e2e-before-fixture-fix.mjs; la corrección
usa las opciones reales y espera las rutas activas, sin ampliar los plazos.

CI220/38318276574 queda rechazada: UI2/115040032458 conserva ambos cierres
fuera de 8 s; UI6/115040032412 conserva cuatro enlaces de shaders y un
reintento correcto, que no se cuenta como aprobación. Logs y artefactos
originales en rust-speech-pipeline-prototype/ci220-ui2 y ci220-ui6.
CI221 conserva el fallo de UI6 y se registra aparte; este catálogo no se
presenta como la corrección de los cierres o shaders de otras revisiones.

Inventario: 6856 líneas Rust/37897 JavaScript = 15.32%, no funcional.
UI local 799148 bytes, SHA256 ea55481c1810f964c25896c1b3a8bf95e49279afc070245be827fc70a0a71859.
Publicación verificada: 298478278c021bd3dfc30b0d510e53b01ec1682a.
Deploy 38326294872/Pages 38326410806 completos; Pages 93a999de65b62d34703a160427d6f0ffc34842cc.
UI pública 799116 bytes, SHA256 952ec200383c9632c30023dd9e0c3e5699072f850f5d14d04c48172fdbe819ad.
published-1791850803759: recursos HTTP/tamaño/SHA, dos perfiles,
1000 preparaciones/100 menús con control positivo y sin fugas,
30 casos PCM/tempo y APK real loader 2107 bytes correctos.
Dos E2E públicos PDF/Davefx y dos del catálogo aprobados sin reintentos.
APK 1.1.15/28 muestra web 222: Lessac 2×, 10.10s,
8 finales/9 inicios, PID 24906 estable y sin FATAL.
CI 38326294878 se registra aparte; no se presupone aprobado.
Updater sin modificaciones.
Evidencia: D:/CodexEvidence/InhouseRead-20261012/rust-catalog-view-prototype.

# 1.7.221 — encuadre de los libros 3D en Rust

Changelog: «Encuadre de libros 3D en Rust».
book_projection_bounds transforma las ocho esquinas de cada caja visible,
con el mismo orden de operaciones de Three.Vector3. Se mantienen NaN,
infinitos y ceros con signo. El host conserva visibilidad, actualización de
cajas, cámara, redondeo, DPR, reservas y dibujo. El paquete por libro reutiliza
su capacidad y limita la entrada a 1024 mallas; el módulo frío o una entrada
no compatible conservan el proyector original congelado.

806 escenarios y 1612 ciclos exactos; control positivo
0→4→0, 0 referencias retenidas,
1310720 bytes estables y paquete máximo 90112 bytes.
91 pruebas focalizadas, 6107 unitarias completas y 34 E2E aprobados
en dos tandas independientes. Las pruebas originales de frame adaptativo y
reserva se ejecutan tanto con JavaScript como con el WASM realmente compilado.
La nueva comparación WebGL exige igualdad de todos los píxeles, SHA,
dimensiones y límites en seis poses, con página guardada, oro y plata.

Chromium 390×844, CPU de escritorio ×4, copias y preparación incluidas,
dibujo/GPU excluidos: 8 mallas 0.0135→0.0110 ms; 24 mallas 0.0385→0.0275 ms; 160 mallas 0.2435→0.1770 ms.
Es una mejora pequeña del cálculo; no acredita rendimiento en un teléfono.

CI218 UI1 conserva el fallo original de color no observado. El harness
esperaba dos helpers, mientras la adopción real espera tres. La espera del
harness ahora incluye font-glyph; un caso adicional retiene ese helper y exige
los colores originales antes de liberarlo y la llamada Rust después. Las
assertions, los plazos y el runtime de color no se han debilitado ni cambiado.
CI219/38315888837 terminó aprobada; ese resultado no elimina los fallos de
cierre y shaders de otras revisiones. CI220 se registra aparte.

Inventario: 6731 líneas Rust/37581 JavaScript = 15.19%, no funcional.
UI local 763449 bytes, SHA256 d284a590b016692a47561287201410b82f5d083482371aea022e95c5a10cd6c7.
Publicación verificada: f09e1996c0c0100b629bad0cd76e773cdcd5f0b9.
Deploy 38321026322/Pages 38321113591 completos; Pages 9a94fb32d50111445f44deb4516eed7aad5c148e.
UI pública 763417 bytes, SHA256 d3d2712c67a16ae9267773ee30b2a96eead0be8080d5160207d304e55c43e01b.
published-1791847009585: recursos HTTP/tamaño/SHA, dos perfiles,
1000 preparaciones/100 menús con control positivo y sin fugas,
30 casos PCM/tempo y APK real loader 2107 bytes correctos.
Dos E2E públicos PDF/Davefx aprobados, sin reintentos.
APK 1.1.15/28 muestra web 221: Lessac 2×, 10.10s,
7 finales/8 inicios, PID 24205 estable y sin FATAL.
CI 38321026325 se registra aparte; no se presupone aprobado.
Updater sin modificaciones.
Evidencia: D:/CodexEvidence/InhouseRead-20261012/rust-book-projection-prototype.

# 1.7.220 — preparación completa de voz en Rust

Changelog: «Menos copias al preparar la voz».
El mismo heap mantiene los caracteres originales, la máscara de notas,
cabeceras y guiones, el mapa de limpieza, las frases, los fragmentos y sus
marcas de página. El navegador recibe una sola vez el texto normalizado y
los registros finales. Las reglas de minúsculas y Unicode permanecen en el
navegador; los metadatos de cabeceras cruzan como números sin coerciones.
El texto UTF-16 incompleto usado como clave de cabecera conserva la ruta
anterior, igual que entradas de más de un millón de unidades.

La normalización independiente conserva su ruta publicada. Esta integración
se mide como cadena completa: evita las copias intermedias que hacían más
lento el prototipo aislado documentado en 219. No se impone ese prototipo
a los consumidores que sólo piden texto normalizado.

6394 escenarios y otros 6394 ciclos comparados;
80 llamadas en total conservan la ruta de cabeceras con UTF-16
incompleto. Los mismos escenarios pasan en es-ES, tr-TR y lt-LT.
Control positivo 0→4→0;
0 referencias vivas y 2424832 bytes estables.
337 focalizadas, 6076 unitarias completas y 30 E2E aprobados.
Los tests de texto se ejecutan en tres modos: legado, plan combinado y
cadena completa. El PDF observa speech_pipeline realmente compilado;
las frases, PCM, marcas y plazos mantienen las assertions originales.

Chromium 390×844 con CPU de escritorio ×4, 13 rondas alternadas de tres tandas:
capítulo 3.33→2.50 ms,
100 entradas mixtas 6.03→4.87 ms,
texto con notas y guiones 8.20→6.23 ms.
La comparación incluye callbacks, copias y construcción de objetos frente
al plan 219 completo. No mide un teléfono ni el arranque completo de voz.
browser-benchmark-first.json conserva el primer ensayo, antes de reducir
las vistas temporales del decodificador de registros. build.log conserva
la conversión incorrecta de una vista Uint16Array a JsValue; se corrige
mediante una variable tipada en build-view-conversion.log, sin cambiar ABI.

Los cierres lentos registrados en CI siguen investigándose por separado;
esta entrega de audiolibro no se presenta como una corrección de ese problema.
CI218/38313579661 queda rechazada: UI1/115024807053 registra una llamada
de color Rust no observada, UI6/115024806965 registra cuatro enlaces de
shaders al retirar un libro, y UI2/115024806983 conserva los dos cierres
fuera de 8 s. Los reintentos correctos de UI1/UI6 no se cuentan como aprobación.
Los logs originales y los tres artefactos están en rust-sentence-ends-prototype.
El perfil local return-profile conserva ambos cierres aprobados y una prueba
de capas CSS. Son diagnósticos independientes; esa variante de CSS no se ha
integrado y los resultados locales no acreditan que la CI esté corregida.
Inventario: 6699 líneas Rust/37550 JavaScript = 15.14%, no funcional.
UI local 760825 bytes, SHA256 199524825655bebb59dd3c697d1b65061690c9fd617ec8ea07a5ee41710ef6b7.
Publicación verificada: 7e8d96559e473f66dd8e7bbd78919a36adedbb7d.
Deploy 38318276693/Pages 38318380917 completos; Pages 422a81e122b91ff25c73228661074e5fdd6b1a5d.
UI pública 760793 bytes, SHA256 7d4c9f33a9ff34c6ab9980c3e3eb18214c06bb1f7ab7a7c7a4625614ed8d1993.
published-1791845203108: recursos HTTP/tamaño/SHA, dos perfiles,
1000 preparaciones/100 menús con control positivo y sin fugas,
30 casos PCM/tempo y APK real loader 2107 bytes correctos.
Dos E2E públicos PDF/Davefx aprobados, sin reintentos.
APK 1.1.15/28 muestra web 220: Lessac 2×, 10.12s,
8 finales/9 inicios, PID 23587 estable y sin FATAL.
CI 38318276574 se registra aparte; no se presupone aprobado.
Updater sin modificaciones.
Evidencia: D:/CodexEvidence/InhouseRead-20261012/rust-speech-pipeline-prototype.

# 1.7.219 — planificación conjunta del audiolibro en Rust

Changelog: «Planificación de voz con menos copias».
Rust mantiene el texto normalizado en un único buffer durante la separación
de frases, la división por cláusulas y el cálculo de marcas de página.
Reutiliza exactamente speech_fragments y speech_normalize del núcleo,
compilados desde sus fuentes originales, sin modificar el núcleo publicado.
Los callbacks Unicode/minúsculas siguen usando el navegador. Los registros
de salida conservan texto, offsets, marcas e identidad compartida de frase.
Los metadatos incompatibles mantienen el camino anterior.

2593 escenarios y otros 2593 ciclos comparados, incluyendo reanudación,
decimales, Unicode incompleto, inicio por cláusula y cruces de varias páginas.
Paridad completa adicional con es-ES, tr-TR y lt-LT. Control positivo 0→4→0;
0 referencias y 1376256 bytes de capacidad estable tras los ciclos.
191 focalizadas, 5930 unitarias completas y 30 E2E aprobados.
La observación PDF exige speech_plan; sentence_ends se ejecuta internamente,
y su export conserva las 74 regresiones directas. Se mantienen todos los
textos, PCM, marcas y plazos de las pruebas de lectura.

Chromium 390×844 con CPU de escritorio ×4, 13 rondas alternadas de tres tandas:
plan de capítulo JS/orquestación anterior 6.43, Rust 3.50 ms;
100 entradas mixtas 7.13/7.27 ms, sin mejora significativa.
Incluye normalización nativa publicada, callbacks, copias y objetos finales.
No mide un teléfono físico ni el arranque completo de voz. El primer ensayo
se conserva en browser-benchmark-first.json.

El prototipo separado rust-speech-mask-prototype permanece sin integrar:
sus rutas generales eran más lentas. Se conservan los ensayos first,
line-locale, cached-lower, filled-input, scratch y flat-ranges. La variante
de minúsculas agrupadas cambió resultados con lt-LT; locale-diagnostic.log
conserva el fallo. La corrección por línea pasó 3801 casos en tres locales,
pero no resuelve el coste general. No se presenta ese prototipo como publicado.

CI217/38311271291 vuelve a fallar al cerrar libros, en UI2/115017313968,
tanto en la ruta alineada como en la compatible. Los fallos iniciales y
reintentos se conservan en rust-voice-order-prototype/ci217-ui2-original.log
y ci217-ui2-artifact. Continúa pendiente; no se amplían sus límites de 8 s.
Esta entrega no acredita la CI completa ni una corrección de esos cierres.

Inventario: 6610 líneas Rust/37525 JavaScript = 14.98%, no funcional.
UI local 744862 bytes, SHA256 e5cb627b2ee90230c254c74e67e60f2fbbb3d0c2a43ccd0b6df6f7557aaec988.
Publicación verificada: dfa31fba0fea22efe01f231d271c55de62ab1a01.
Deploy 38315888854/Pages 38316014183 completos; Pages 6f0222d579f671ebd42b13f530e3fd51fcd490cd.
UI pública 744838 bytes, SHA256 b29c5d3ed3408d9a9d8010ac27ad8f6c832d5a708c4c0a4083a58a8103c1db1f.
published-1791843737581: recursos HTTP/tamaño/SHA, dos perfiles,
1000 preparaciones/100 menús con control positivo y sin fugas,
30 casos PCM/tempo y APK real loader 2107 bytes correctos.
Dos E2E públicos PDF/Davefx aprobados, sin reintentos.
APK 1.1.15/28 muestra web 219: Lessac 2×, 11.79s,
8 finales/9 inicios, PID 23012 estable y sin FATAL.
CI 38315888837 completa y aprobada, incluidos todos los jobs de voz y UI. Los fallos originales de otras revisiones se conservan.
Updater sin modificaciones.
Evidencia: D:/CodexEvidence/InhouseRead-20261012/rust-speech-plan-prototype.

# 1.7.218 — límites de frase en Rust

Changelog: «Separación de frases en Rust».
Rust recorre los signos de puntuación, comillas, abreviaturas, números de
lista y saltos obligatorios con offsets UTF-16 originales. La clasificación
Unicode y las minúsculas locales siguen usando las reglas del navegador.
Las condiciones de idiomas y el texto hablado conservan sus resultados.

3546 escenarios comparados y otros 3546 ciclos, incluidos pares y sustitutos
Unicode incompletos. El navegador repite todos los casos con es-ES y tr-TR.
Control positivo de referencias 0→4→0; después de los ciclos 0 referencias
y 1310720 bytes de capacidad estable. 137 focalizadas,
5876 unitarias completas y 30 E2E aprobados. Los tests originales de texto
se ejecutan en ambos modos. El PDF observa speech_sentence_ends realmente
compilado y mantiene las assertions de contenido, PCM y avance de página.

Chromium 390×844 con CPU de escritorio ×4, 13 rondas alternadas y tres
tandas: un capítulo de 33200 caracteres, JS 19.23/Rust 9.63 ms;
200 fragmentos mixtos, JS 10.03/Rust 9.70 ms.
Incluye las copias UTF-16 y las llamadas Unicode/minúsculas. No mide un
teléfono físico ni el arranque completo del audiolibro. La primera medición
se conserva en browser-benchmark-first.json.

El aviso de dependencias se actualiza a las versiones ya fijadas:
wasm-bindgen 0.2.105, js-sys/web-sys 0.3.82 y wasm-bindgen-futures 0.4.55.
No cambia el compilador ni la ABI. El prototipo de normalización completa
todavía no se integra: su primer ensayo fue más lento y se conserva en
rust-speech-mask-prototype/browser-benchmark-first.json.

Inventario: 6565 líneas Rust/37497 JavaScript = 14.9%, no funcional.
UI local 735654 bytes, SHA256 33b1e16d2bb1e3c01043d6cbec70034abdb6c830ee9eb2b873a6f6bfa1298227.
Publicación verificada: e99d28c1a5fde203d60f28505de41ccdf12b9324.
Deploy 38313579618/Pages 38313687200 completos; Pages ddf9dc2d837a169242f656baf5587b40e2f5efdd.
UI pública 735622 bytes, SHA256 7af96401736b97f49cc7aba0cfe4a48257dc07f840e9c0a4d6e6051831cd64e4.
published-1791842396151: recursos HTTP/tamaño/SHA, dos perfiles,
contador positivo 480→498→480 con 1000 preparaciones/100 menús,
30 casos PCM/tempo y APK real loader 2107 bytes correctos.
Dos E2E públicos PDF/Davefx aprobados, sin reintentos.
APK 1.1.15/28 muestra web 218: Lessac 2×, 12.05s,
8 finales/9 inicios, PID 22438 estable y sin FATAL.
CI 38313579661 se registra aparte; no se presupone aprobado.
Updater sin modificaciones.
Evidencia: D:/CodexEvidence/InhouseRead-20261012/rust-sentence-ends-prototype.

# 1.7.217 — ordenación del catálogo en Rust

Changelog: «Catálogo y recomendaciones más ágiles».
Rust prepara una vez las claves de ordenación por idioma y región, conserva
los nombres visibles calculados por el navegador y mantiene las referencias
originales a las voces. Recomendar una voz selecciona el mejor candidato sin
ordenar todo el catálogo. La comparación de nombres mantiene localeCompare
del navegador, incluida la diferencia entre nombres en español e identificadores.
Registros ajenos al catálogo normalizado conservan su ruta de compatibilidad.

1718 escenarios comparados y otros 1718 ciclos, incluidos el catálogo completo
publicado y su orden inverso en cada idioma/región. 7 referencias vivas y
1179648 bytes de capacidad estable. 701 pruebas focalizadas,
5786 unitarias completas y 30 E2E aprobados. Las pruebas originales del
catálogo se ejecutan en ambos modos, y el PDF de prueba observa
ambas funciones compiladas junto a las assertions de PCM y cambio de página.

CI216/115012122231 detectó una instrumentación antigua de rust-neural-view:
las filas y el foco eran correctos, pero esperaba llamadas exportadas que
ahora son internas al renderizador Rust. ci216-ui4-original.log y
ci216-ui4-artifact conservan ambos fallos. La prueba observa configurePicker
y renderPicker; mantiene sus assertions de filas, descarga, foco y errores,
además de la paridad DOM de 79 estados. La preparación del módulo compilado
se comparte con el PDF; la prueba de descarga WASM tardía sigue separada.
No se aumenta ningún plazo ni se cuenta un reintento como aprobado.
CI215/115005329671 vuelve a registrar el límite de 8 s al devolver libros
a la estantería, en las rutas alineada y compatible. Continúa pendiente;
ci215-ui2-original.log y ci215-ui2-artifact conservan las ejecuciones originales
en rust-language-detect-prototype. Esta entrega no se presenta como una
corrección de ese problema ni como una CI completa aprobada.

65 catálogos por tanda, 13 rondas alternadas de tres tandas en Chromium
390×844 con CPU de escritorio ×4: ordenación JS 99,23/Rust 38,63 ms;
recomendación JS 100,47/Rust 15,73 ms. Incluye conversión de registros y
comparación de nombres. No mide la app completa ni un móvil físico.
Se conservan también las mediciones anteriores a ampliar las comprobaciones
de registros y metadatos: browser-benchmark-before-guard.json y
browser-benchmark-before-metadata.json.

Inventario: 6488 líneas Rust/37483 JavaScript = 14.76%, no funcional.
UI local 718131 bytes, SHA256 961180de290fde29406b72cb4b79ba0102f3b001672a4864f1253b688db507fa.
Publicación verificada: bd90a769585842db70645cf9f0832f3f21422796.
Deploy 38311271194/Pages 38311406623 completos; Pages c2c5db870577a5dbdc615be81dc748b268c0a7af.
UI pública 718099 bytes, SHA256 f60034ad8e8595b78caaabebc9f53ef40f9d98787a8183886b9fc8452036a6bc.
published-1791841128976: recursos HTTP/tamaño/SHA, dos perfiles,
contador positivo con 1000 preparaciones/100 menús, 30 casos PCM/tempo
y APK real loader 2107 bytes correctos. Dos E2E públicos PDF/Davefx aprobados.
public-artifact.log conserva una discrepancia inicial únicamente en
licenses/wasm-bindgen-NOTICE.txt. La consulta puntual posterior devolvió 200,
318 bytes y el SHA esperado (license-check.json); no se conserva el estado
HTTP del fallo inicial y no se le atribuye una causa no comprobada.
public-artifact-second.log repite el barrido completo sin modificar la versión
publicada y comprueba todos los recursos, incluidos esos avisos.
APK 1.1.15/28 muestra web 217: Lessac 2×, 10.02s,
7 finales/8 inicios, PID 21627 estable y sin FATAL.
CI 38311271291 se registra aparte; no se presupone aprobado.
Updater sin modificaciones.
Evidencia: D:/CodexEvidence/InhouseRead-20261012/rust-voice-order-prototype.

# 1.7.216 — menú de voces con estado Rust

Changelog: «Renderizado del menú de voces en Rust».
La vista Rust conserva sus servicios y coordina filas, foco, advertencias y
progreso. Las llamadas entre filas y vista se resuelven dentro de Rust;
la disponibilidad se representa con estados tipados y el progreso localiza
las voces con un índice por identificador. La adopción tardía reutiliza el
DOM y conserva los controles existentes. No modifica el reloj del audio.

240 escenarios DOM y otros 240 ciclos, 44 referencias vivas y capacidad
estable de 1179648 bytes. 104 pruebas focalizadas, 5585 unitarias completas
y 28 E2E aprobados. El menú mantiene sus assertions originales en tres modos:
compatibilidad, Rust desde el arranque y adopción tardía. El E2E observa la
entrada compilada renderPicker; disponibilidad/oferta ahora se llaman dentro
del módulo y no necesitan cruzar la frontera JS. Su paridad específica sigue
cubriendo 2400 casos y 2400 ciclos.

En Chromium 390×844 con CPU de escritorio ×4, 11 rondas alternadas,
20 operaciones/tanda: progreso de 8 voces JS 0,415/Rust 0,280 ms;
32 voces 1,510/0,825 ms. Render completo 8 voces 2,375/2,340 ms;
32 voces 8,480/7,935 ms. Ambas rutas usan la misma vista Rust y la misma
política; se compara su coordinación con DOM real y catálogo preparado.
No mide un móvil físico ni toda la app. Se conserva el primer prototipo
más lento (browser-benchmark-first.json), el primer fallo de compilación
(build.log) y su corrección de conversión Element→JsValue.

Inventario: 6420 líneas Rust/37467 JavaScript = 14.63%, no funcional.
UI local 699888 bytes, SHA256 826ecb0c630268eb3c56724fe83aac2e6daca57b46b7c19bc86f58c1a0c4225b.
Publicación verificada: 457f3cb09b82bab61dfe56c1f5faf94e7a090b99.
Deploy 38309694339/Pages 38309810069 completos; Pages c823ea67b7b0b1eb5268ea67d40837d05f7b70e0.
UI pública 699856 bytes, SHA256 84f1923a98e91573ce869ed9ebba9f6b855331872b467dfd90cedb7fcdb29c67.
published-1791840030319: recursos HTTP/tamaño/SHA, dos perfiles,
contador positivo 480→498→480, 1000 preparaciones/100 menús, 30 casos PCM/tempo
y APK real loader 2107 bytes correctos. Dos E2E públicos PDF/Davefx aprobados.
El primer verificador de navegador arrancó antes de recibir la ruta del
artefacto y falló con undefined/summary.json; public-browser-premature.log
conserva ese error de invocación. public-browser-ready.log comprueba el
artefacto terminado. No fue un fallo de descarga de la aplicación.
APK 1.1.15/28 muestra web 216: Lessac 2×, 11.83s,
8 finales/9 inicios, PID 21046 estable y sin FATAL.
CI 38309694357 se registra aparte; no se presupone aprobado.
Updater sin modificaciones.
Evidencia: D:/CodexEvidence/InhouseRead-20261012/rust-picker-owned-render-prototype.

# 1.7.215 — detección de idiomas en Rust

Changelog: «Detección de idiomas en Rust».
Rust conserva sus diccionarios, puntúa las palabras y los indicios del idioma,
resuelve alfabetos y mantiene las regiones. Las reglas Unicode y de minúsculas
del navegador siguen siendo las mismas. Los 27 recorridos de indicios se
sustituyen por un solo recorrido nativo, manteniendo las parejas finlandesas
sin solapamientos. La clasificación de alfabetos se omite para texto ASCII.

6366 casos comparados con el original, otros 6366 ciclos, 17 referencias vivas
y capacidad estable tras el calentamiento. Incluye cadenas Unicode dañadas,
texto mixto, distintos dialectos y metadatos malformados. 419 focalizadas,
5546 unitarias completas y 28 E2E aprobados. El PDF repite su comprobación
de continuidad con modo multilingüe y observa el detector Rust realmente
compilado; las comprobaciones anteriores de PCM y cambio de página se conservan.

CI214/114996626725 registró una inicialización de sesión fuera de Rust cuando
su descarga superó el plazo de arranque. El reintento pasó y el control estricto
lo rechazó: ci214-reading-original.log y ci214-reading-artifact conservan el fallo.
La prueba de operaciones compiladas ahora inicializa el módulo publicado antes
de liberar el bootstrap, manteniendo todas sus assertions. Una prueba nueva
retiene deliberadamente la descarga WASM: la sesión ya creada conserva la
página elegida y adopta Play en Rust sin volver a inicializarla ni reiniciarse.
No se cambia el plazo de la aplicación ni se interpreta el reintento como limpio.

200 fragmentos por tanda, 13 rondas alternadas y copias/interoperabilidad incluidas:
Node Windows JS 8.14 ms/Rust 6.74 ms;
Chromium 390×844 con CPU de escritorio ×4: JS 39.34 ms,
Rust 35.12 ms. Es una medida del detector, no de un teléfono
físico ni de la velocidad completa de la app. Se conservan también las medidas
del primer prototipo (benchmark.log), anterior al recorrido único de indicios.

Inventario: 6300 líneas Rust/37435 JavaScript = 14.4%, no funcional.
UI local 680732 bytes, SHA256 d0d68fa2d99fc296f9151e43558bebf76d1ba1ff4cdbbe3c88f220724fb2cef0.
Publicación verificada: 6c24a319d91895f01ec0686dfe38cf7a3d0d59c4.
Deploy 38307604398/Pages 38307735784 completos; Pages 97618fca0685c52809761f86242033bc82179ac5.
UI pública 680700 bytes, SHA256 c5f69d202ae99314c10c22afad1447d5f9a03dddf0ae3b5256d02170221077b8.
published-1791839097080: recursos HTTP/tamaño/SHA, dos perfiles,
contador positivo con 1000 preparaciones/100 menús, 30 casos PCM/tempo
y APK real loader 2107 bytes correctos. Dos E2E públicos PDF/Davefx aprobados.
APK 1.1.15/28 muestra web 215: Lessac 2×, 11.62s,
8 finales/9 inicios, PID 20499 estable y sin FATAL.
CI 38307604279 se registra aparte; no se presupone aprobado.
Updater sin modificaciones.
Evidencia: D:/CodexEvidence/InhouseRead-20261012/rust-language-detect-prototype.

# 1.7.214 — disponibilidad y recomendaciones de voces en Rust

Changelog: «Recomendaciones de voces en Rust».
Rust decide la disponibilidad de cada voz, las recomendaciones por idioma
y el aplazamiento de la oferta durante 30 días. Conserva almacenamiento
dañado, errores de almacenamiento, prioridad de las descargas y claves
como __proto__ como propiedades propias, sin cambiar prototipos.

2400 escenarios comparados con el original y 2400 ciclos sin crecimiento
de memoria ni referencias. 65 focalizadas y 5396 unitarias completas
aprobadas. Las 62 pruebas originales del menú mantienen sus assertions y
observan también las seis funciones Rust nuevas. 26 E2E aprobados; el PDF
con Davefx real observa disponibilidad y recomendaciones compiladas.

El prototipo separado del renderizado del menú se retiene: su ensayo con
DOM simulado mide más coste de interop (render 0,0389 vs 0,0077 ms).
No se ha integrado ni se presenta como una mejora de velocidad. Evidencia:
rust-picker-render-prototype/benchmark.log. Requiere estado propio y menos
cruces de fronteras antes de volver a evaluarlo con DOM real.

Inventario: 6157 líneas Rust/37425 JavaScript = 14.13%, no funcional.
UI local 633337 bytes, SHA256 96a819991b12ec677e54192504858ec98cecfb6371b121244c439268f336f26e.
Publicación verificada: fe82e10590d8bd16b01419b9077beb8495d07f59.
Deploy 38304956050/Pages 38305093736 completos; Pages 8639437f78d81b0043ab5923f8f60d16d4d2aefb.
UI pública 633305 bytes, SHA256 a683028f484f6fceb982fa79de37539689c9b226b3b58aa309e25bb2414fa0b5.
published-1791837400883: recursos HTTP/tamaño/SHA, dos perfiles,
contador positivo con 1000 preparaciones/100 menús, 30 casos PCM/tempo
y APK real loader 2107 bytes correctos. E2E público PDF/Davefx aprobado.
La consulta anterior a la finalización de Pages vio la versión previa y
chunks nuevos aún inexistentes: public-artifact.log conserva ese fallo.
public-artifact-pages-ready.log comprueba el despliegue ya terminado.
APK 1.1.15/28 muestra web 214: Lessac 2×, 10.12s,
7 finales/8 inicios, PID 19875 estable y sin FATAL.
CI 38304956053 se registra aparte; no se presupone aprobado.
Updater sin modificaciones.
Evidencia: D:/CodexEvidence/InhouseRead-20261012/rust-picker-policy-prototype.

# 1.7.213 — acciones de las voces naturales en Rust

Changelog: «Selección y descarga de voces en Rust».
Rust resuelve los botones de descargar, cancelar, usar y quitar; mantiene
las descargas explícitas, los errores, la elección por idioma y la retirada
conjunta de perfiles de un paquete compartido. Las promesas del motor
siguen siendo propiedad del host y conservan el mismo orden de efectos.

1500 escenarios comparados con el original, incluidos errores síncronos,
cancelación y paquetes compartidos.1500 ciclos posteriores mantienen
memoria y referencias.69 focalizadas y5395 unitarias completas aprobadas.
Las62 pruebas existentes del menú conservan sus assertions y observan
las nueve funciones Rust de acciones.26 E2E aprobados; PDF/Davefx observa
el clic y el inicio/fin de la instalación por la UI en el binario real.
El build inicial del prototipo falló por dos conversiones Object/JsValue;
build.log queda conservado y build-fixed.log/check.log prueban la corrección.

Inventario:6097 líneas Rust/37410JavaScript=14.01%, no funcional.
UI local625003bytes,SHA256895a4fc28476f608e979715d0e818bbb97bc3afb6ea9305dc8457a0f2cad0cf6.
Publicación verificada: 6bd2967a51bc339d076f6c679874d827e42e89ee.
Deploy 38303313918/Pages 38303424607 completos; Pages 7e7f86c09b691036bf4fdc0703c1fad63edf5515.
UI pública 624971 bytes, SHA256 7ea34989a69b1e6e750a6a6ab14a4a674b70c5157539117b134f64aeb3398669.
published-1791836474674: recursos HTTP/tamaño/SHA, dos perfiles,
contador positivo con 1000 preparaciones/100 menús, 30 casos PCM/tempo
y APK real loader 2107 bytes correctos. E2E público PDF/Davefx aprobado.
La primera consulta se adelantó al despliegue Pages y obtuvo el manifiesto
anterior y 404 de chunks nuevos: public-artifact.log conserva ese fallo.
public-artifact-pages-ready.log confirma todos los recursos tras terminar Pages.
APK 1.1.15/28 muestra web 213: Lessac 2×, 10.03s,
7 finales/8 inicios, PID 19339 estable y sin FATAL.
CI 38303313905 se registra aparte; no se presupone aprobado.
Updater sin modificaciones.
Evidencia:D:/CodexEvidence/InhouseRead-20261012/rust-picker-actions-prototype.

# 1.7.212 — preparación y actualización de voces en Rust

Changelog: «Preparación de voces en Rust».
Rust controla el contexto de calentamiento de voces, la cancelación por libro
y generación, la conexión con el motor y la actualización agrupada del menú.
Los temporizadores, promesas y listeners siguen perteneciendo al host.
Conserva los800ms/requestIdleCallback, el precalentamiento para usuarios que
ya escucharon y la selección instalada; no carga modelos en el arranque vacío.

1600 escenarios comparados con el original y1000 ciclos sin crecimiento de
memoria ni referencias.73 focalizadas y5394 unitarias completas aprobadas.
26 E2E aprobados, con PDF/Davefx observando contexto, conexión y warmUp Rust.
El primer build local falló por un reemplazo AST que aceptaba el constructor
heredado de Object. Se restauró exactamente el constructor deHEAD y el script
ahora exige Object.hasOwn. build-production.log conserva el fallo original;
build-constructor-fixed.log y los tests comprueban el resultado corregido.
CI210 conserva fallos previos de cierre alineado y legado (8123/8068/8098ms,
límite8000ms) y cuatro enlaces de shaders al retirar un libro; el reintento
de shaders pasó, pero el control estricto rechaza el resultado inestable.
Logs originales:rust-controls-adoption/ci210-ui2-original.log y
rust-controls-adoption/ci210-ui6-original.log. Siguen pendientes de corrección.

Inventario:6017 líneas Rust/37380JavaScript=13.87%, no funcional.
UI local609516bytes,SHA25604145c90c0f133cdef313fb45dbd164c68f34817d3831fb049f11d9a791baea7.
Publicación verificada:71ef2c4464bfbfb8e4b052a9c8ffc5f2d9d0b16e.
Deploy38301690794/Pages38301821991 completos; Pages21d4b6a3fcb4fc3c62d296599e7c4e901f9a466e.
UI pública609484bytes,SHA256358e7cdca495bc501068df0b58e019569c59ee6ba6437d53186fb2c004f4787d.
published-1791835582370: recursos HTTP/tamaño/SHA, dos perfiles,
contador positivo con1000 preparaciones/100 menús,30 casos PCM/tempo
y APK real loader2107bytes correctos. E2E público PDF/Davefx aprobado.
APK1.1.15/28 muestra web212:Lessac2×,10.13s,
8finales/9inicios,PID18812estable y sinFATAL.
CI38301690790 se registra aparte; no se presupone aprobado.
Updater sin modificaciones.
Evidencia:D:/CodexEvidence/InhouseRead-20261012/rust-picker-warm-prototype.

# 1.7.211 — sesión y eventos del audiolibro en Rust

Changelog: «Sesión de audiolibro en Rust».
Rust inicializa el estado, discrimina eventos de reproducción y mantiene las
generaciones de página, sesión nativa y pulsación larga. La preparación del
texto conserva Unicode/UTF16 y las opciones de notas y cabeceras repetidas.
Los diagnósticos nativos conservan sus campos limitados y el orden de acceso.
Los callbacks de ventana siguen perteneciendo al host.

1800 escenarios de eventos,1200 diagnósticos y1000 textos comparados con el
original.2000 ciclos mantienen referencias y memoria; contador positivo validado.
46 focalizadas y5388 unitarias completas aprobadas.26 E2E aprobados.
PDF/Davefx observa inicialización y eventos compilados, además
del avance ligado al PCM audible. No cambia los parámetros de texto, geometría o velocidad.
Los fallos previos del prototipo siguen guardados: el fixture comparaba
prototipos distintos; se igualó el host y se mantuvo deepStrictEqual.
No se reutiliza como evidencia el contador cero anterior a208.
El primer E2E211 falló en una aserción nueva que exigía el limpiador de texto
plano dentro de PDF; PDF utiliza items estructurados que conservan offsets.
Se conserva e2e.log/e2e-first-failure. Sus comprobaciones de audio y página no
cambian; el limpiador se comprueba en1000 casos de paridad y las suites de voz.
CI209/114968613243 conserva un fallo del cierre alineado (8008,7ms frente
al límite8000ms y segundo intento aún cerrando) y un fallo inicial de carga
EPUB de escritorio. El reintento EPUB pasó, pero no se cuenta como limpio.
Original:rust-voice-dispatch-prototype/ci209-ui2-original.log.
Estos casos siguen pendientes; las pruebas focalizadas no los sustituyen.

Inventario:5930 líneas Rust/37352JavaScript=13.7%, no funcional.
UI local596084bytes,SHA256bdc9d4c7bc6ab976f4c40c836cd070a79376ccab90465113e0c975e3d72a0da9.
Publicación verificada:cc7c792483455e6961bbde761afbeacf40b671a0.
Deploy38300095917/Pages38300235953 completos; Pages264c6c02d0bd04a2a00634846f0952815e8636a8.
UI pública596052bytes,SHA2562a8d7492aa48423727962633342e0a2cb521c1bd8114e97beb2f337798958815.
published-1791834776638: recursos HTTP/tamaño/SHA, dos perfiles,30 PCM/tempo
y APK real con loader2107bytes correctos. La primera comprobación de referencias
falló al leer una respuesta tras cerrarse la página: public-lifetime.log queda
conservado. El verificador ahora espera la instancia que inicializa la app
antes de acceder a default(), evitando iniciar otra él mismo; las promesas
de respuesta capturan sus errores para conservar el diagnóstico principal.
Mismas comprobaciones positivas y ciclos:458→476→458,1000 preparaciones,
100 menús y una instancia por perfil; public-lifetime-app-ready.log aprobado.
E2E público PDF/Davefx aprobado en22s sin reintentos.
APK1.1.15/28 muestra web211:Lessac2×,10.16s,
8finales/9inicios,PID18269estable y sinFATAL.
CI38300095896 se registra aparte; no se presupone aprobado.
Updater sin modificaciones.
Evidencia:D:/CodexEvidence/InhouseRead-20261012/rust-voice-session-prototype.

# 1.7.210 — adopción de Rust tras una descarga tardía

Changelog: «Controles Rust tras descarga tardía».
El lector mantiene su plazo de arranque. Cuando WASM termina después,
los controles pasan a Rust sin sustituir los nodos: se retiran solamente
los handlers que pertenecían al fallback. Un lector desmontado no adopta
los atajos de otro libro; free cancela el registro y libera ambos caminos.
Un error parcial restaura los handlers anteriores sin duplicarlos.

Las listas adoptan Rust en su siguiente actualización solicitada. Las demás
filas conservan identidad, foco, scroll y callbacks hasta ser reemplazadas.
Cada lista libera sus antiguos onclick cuando se reemplaza, y free libera
tanto los listeners nativos como los del fallback que aún estaban visibles.
No se reproduce ninguna acción pasada ni se repagina el texto del libro.

Se conservan los fallos originales206/114941278918 y208/114963724116.
El test de listas anterior asumía Rust para acciones que podían ocurrir antes
de terminar la descarga. Ahora su caso compilado inicializa el mismo módulo
real antes de importar el libro y conserva todos los asserts de sus cuatro
renders. Un segundo caso retiene la descarga hasta abrir el EPUB y comprueba
la adopción posterior en marcadores y búsqueda. No amplía los plazos. El test
de controles conserva sus acciones/aserciones y también añade descarga tardía.

32 focalizadas y 5376 unitarias completas aprobadas.26 E2E aprobados,
incluidos ambos escenarios tardíos y voces reales PDF/EPUB. Los ciclos
de adopción/free conservan referencias con el contador validado en208.
Inventario:5849 líneas Rust/37334JavaScript=13,54%, no funcional. El cambio
añade adaptadores de disponibilidad; no añade lógica Rust nueva al binario.
Publicación verificada:83100bef4ba2e69538ef8c1f44c674b7ca2ce63f.
Deploy38298136308/Pages38298267979; Pages8c03506fdeb3fee0bab4ac983124f4250b02f09b.
UI pública572482bytes,SHA25631fcc8d7593a5c3922216f9731cc4e0ff30748acb0d291e0d6903a0eead849b1.
published-1791833662229: recursos HTTP/tamaño/SHA, dos perfiles,
contador positivo y1000 preparaciones/100 menús,30 casos PCM y APK loader válidos.
El primer verificador conservaba la referencia gh-pages209; falló correctamente
la atribución de fuente, la versión y la igualdad del HTML. Su evidencia published-1791833621996 queda
conservada. Tras fetch de gh-pages, la comprobación completa pasó.
E2E público PDF/Davefx aprobado en19,5s sin reintentos.
APK1.1.15/28 muestra web210:Lessac2×,10.14s,
8finales/9inicios,PID17686estable y sinFATAL.
CI38298136319 se registra aparte; no se presupone aprobado.
Updater sin modificaciones; migración completa pendiente.
Evidencia:D:/CodexEvidence/InhouseRead-20261012/rust-controls-adoption.

# 1.7.209 — envío de audio y avance automático en Rust

Changelog: «Avance de audiolibro en Rust».
Rust coordina el envío al motor, la espera de una frase entre páginas,
los reintentos del motor y el temporizador. Mantiene el cambio de página
ligado al PCM audible, sin alterar los fragmentos ni la velocidad del audio.
El avance conserva las fuentes preparadas, las generaciones de cancelación,
los reintentos de una página en transición y el final del libro.
Callbacks de temporizadores y promesas siguen siendo propiedad del host.

1500 escenarios de envío y1200 de avance comparados con el original,
incluidos errores síncronos y navegación manual.2000 ciclos de envío y1000
avances conservan memoria y referencias con el contador validado en208.
125 focalizadas y 5364 unitarias completas aprobadas. Los originales de
las comparaciones fallidas del prototipo permanecen en sus carpetas;
el orden de los errores síncronos se corrigió sin cambiar las comparaciones.
24 E2E aprobados, incluidos PDF/EPUB con Davefx real, FB2, controles y listas.
El PDF comprueba envío, síntesis y avance compilados, una sola onda y su marca
audible al cambiar de página. Publicación pendiente; compilar no la verifica.

Inventario:5849 líneas Rust/37261JavaScript=13,57%, no funcional.
UI local572514bytes,SHA256
d2119432d9c0e6128a2dd5064c82bf0d503e09233584c48595af2ef18ea80caa.
Publicación verificada:9791b0cc8ad72961cfe04cad7a4824f096d59b63.
Deploy38296463443/Pages38296602456 completos; Pages
1d34654aef0d6f319cea6300f05ffa2f7eaf6d40. UI pública572482bytes,SHA256
f70ae672173609e6efdc2e67652cb37ceefcd5d51ded7c53251e8b5e17077a37.
published-1791832755454: recursos HTTP/tamaño/SHA, dos perfiles,30 casos
PCM/tempo y APK real con loader2107bytes correctos. La prueba de referencias
incluye retención/liberación positiva y1000 preparaciones/100 menús por perfil.
E2E público PDF/Davefx aprobado sin reintentos.
APK1.1.15/28 muestra web1.7.209:Lessac2×,10.15s,
8finales/9inicios,PID17162estable y sinFATAL.
CI38296463589 se registra por separado; no se presupone aprobado.
La migración completa sigue pendiente. Se conservan los fallos de CI previos.
Evidencia:D:/CodexEvidence/InhouseRead-20261012/rust-voice-dispatch-prototype
y rust-voice-advance-prototype.

# 1.7.208 — preparación del texto y primer audio en Rust

Changelog: «Preparación de voz en Rust».
Rust crea el plan de lectura, comparte el análisis inicial entre seleccionar
voz y pulsar Play, prepara el primer audio, reintenta páginas separadas y
actualiza sus marcas después de un cambio real del diseño. Conserva fuentes,
UTF-16, texto, cancelaciones y el estado visible mientras prepara el siguiente.
Los callbacks retenidos por el formato se crean en el adaptador JavaScript.

1200 escenarios comparados con el original, incluidos errores y orden
síncrono antes del primer await;1000 ciclos con memoria WASM y referencias
estables. El primer prototipo difería al reintentar un AbortError síncrono;
se conserva check.log y se corrige el orden, sin modificar la comparación.
La primera batería focal pasó151 pruebas, pero el contador añadido a la
suite básica esperaba dos operaciones que esta no ejercitaba. Se conserva
unit-focused.log. Se ejecutan también las suites originales de motor,
preparación separada y cambios de diseño sobre WASM, con contadores propios:
231 focalizadas y5353 unitarias completas aprobadas antes del arreglo FB2.
El paginador exterior continuaba a scrollToAnchor aunque View.render
hubiera rechazado el cuerpo provisional. También se protege afterScroll
frente a eventos tardíos: conserva el rango/ancla anterior y reanuda tras
el load real. Se conservan el fallo reproducido con los métodos exactos
(frame-navigation-original.log) y su ejecución corregida sin cambiar las
comprobaciones.77 focalizadas de preparación/navegación y 5356 unitarias
completas finales aprobadas. No se modifican los archivos de node_modules:
la transformación revisada rechaza versiones inesperadas de Foliate.
24 E2E aprobados, incluidos controles, listas, FB2 y PDF/EPUB con Davefx real. El PDF comprueba
plan inicial y preparación compilados, una onda y la marca audible de página.

Corrección de la evidencia de memoria206/207: ui_live_handles devolvía cero
porque strip=symbols eliminaba target_features, mientras rustc habilitaba
reference-types y el puente generado usaba el heap JS. El control positivo
crea un menú retenido y exige crecimiento, seguido de liberación exacta:
counter-positive-original.log reproduce el fallo. No se consideran válidas
las comparaciones anteriores basadas solamente en ese cero. Las mediciones
independientes del heap JS con el observador de206/207 siguen separadas.
Preservar metadata activaba también multivalue; unit-reference-abi.log
detecta65 entradas no liberadas en1000 preparaciones con errores. Se mantiene
el ABI anterior fijando -reference-types,-multivalue al compilar Rust,
antes de eliminar metadata. No se editan bindings generados ni el allocator.
123 focalizadas pasan con contador válido;1000 preparaciones mantienen68
referencias. Se repite la batería completa y la prueba pública con controles
positivos. Evidencia adicional:rust-ui-closure-lifetime/rust-ui-legacy-abi.

Inventario:5667 líneas Rust/37245 JavaScript=13,21%, no funcional.
UI local533502bytes,SHA256
27e3bf710c628a2cfcfdf43562031b0ed64dfd9d1bf370a43501b6c864249a40.
Publicación verificada:556d7ef61aa70426229d98490a57a2b897d5233c.
Deploy38294964455/Pages38295105920 completos; Pages
47613e7d8f6b3b85170893483ff0d95ee79d553f. UI pública533470bytes,SHA256
3720b5689f4bf03d99f541fb56281a895f0f7fe1c0a09946cb41925480864d68.
published-1791831998995: recursos HTTP/tamaño/SHA, dos perfiles,30 casos
PCM/tempo y APK descargado con loader2107bytes correctos. Controles positivos
de referencias en390px/1280px:25→43 al retener un menú→25 al liberarlo;
1000 preparaciones y100 menús mantienen25, una sola instancia del módulo.
E2E público PDF/Davefx y FB2 aprobados sin reintentos.
APK1.1.15/28 muestra web1.7.208:Lessac2×,10.08s,
8finales/9inicios,PID16496estable y sinFATAL.
CI38294964433:unitarias114963723877 y UI3/114963724033 aprobadas.
UI5/114963724116 rechaza una primera ejecución de ReaderLists que quedó
en el fallback tras la descarga tardía de UI. Original en
rust-voice-preparation-prototype/ci208-ui5-original.log; no se usa su
reintento como aprobación. La adopción tardía de listas queda pendiente.
La migración completa sigue pendiente; no se declara totalmente verde el CI.
Evidencia:D:/CodexEvidence/InhouseRead-20261012/rust-voice-preparation-prototype.

# 1.7.207 — resaltado audible en Rust

Changelog: «Resaltado y seguimiento de voz en Rust».
Rust procesa inicio/fin audible, resalta la frase completa, sigue las
marcas internas y limpia el resaltado. Solo activa la página separada
al llegar el PCM correspondiente; mantiene fuentes y offsets originales.
Los callbacks nativos obsoletos se descartan y los errores visuales
no interrumpen el audio, igual que en la implementación anterior.

1000 escenarios comparados con el original,2000 ciclos sin crecimiento
de WASM ni referencias JS retenidas.123 focalizadas y 5315 unitarias
completas aprobadas.14 E2E aprobados, incluidos PDF/EPUB con Davefx real,
navegación manual y pulsación larga. El PDF comprueba llamadas compiladas
a inicio/presentación, una única onda y cambio de página en la marca audible.

Inventario:5498 líneas Rust/37227 JavaScript=12,87%, no funcional.
UI local488146bytes,SHA256
543723fdd9750d3815dd08568b2939c487c8086e211dc63af3458f8d7a95c624.
Publicación verificada:d1f038352dee35a05d3314cbfc9e768031b70ad6.
Deploy38289901932/Pages38290021855 completos; Pages
3481762085f1d85dadfdbb24687396146c37a27f. UI pública488106bytes,SHA256
fdae72ec4de12adbee1a53065cd556225d46e248424f655ed6e6e9fd61050e5a.
published-1791829294556: todos los recursos HTTP/tamaño/SHA, dos perfiles,
30 casos PCM/tempo y APK real con loader2107bytes correctos.
Una instancia tanto en390px como1280px. La prueba de referencias públicas
se invalida: el contador de206/207 leía un slab sin uso y siempre daba cero.
La prueba HTTP y el E2E público PDF/Davefx1/1(21,9s) siguen siendo válidos.
APK1.1.15/28 muestra web1.7.207:Lessac2×,10.09s,
8finales/9inicios,PID15860estable y sinFATAL.
CI38289901961:unitarias114947201063, voces reales y UI5 aprobadas.
UI3/114947201629 falla al abrir FB2, también en su reintento. Se conservan
ci207-ui3-original.log y ci207-ui3-artifact: createTreeWalker recibe un
cuerpo ausente desde Paginator.render/afterScroll. Corregido en1.7.208;
UI2/114947201773 también falla en las dos devoluciones nativas, en ambos
intentos; original en ci207-ui2-original.log. Los restantes jobs pasan;
el resultado global del run es failure.
La migración completa sigue pendiente; no se declara totalmente verde el CI.
Evidencia:D:/CodexEvidence/InhouseRead-20261012/rust-voice-presentation-prototype.

# 1.7.206 — preparación anticipada de páginas en Rust

Changelog: «Páginas en Rust y memoria liberada».
Rust prepara y valida una página física anticipada, descarta las canceladas
y conserva la página actual hasta la marca audible. Migra adopción, limpieza
y revalidación del plan manteniendo las referencias y arrays dispersos.
La creación de callbacks queda en el adaptador JavaScript para evitar ciclos
de referencias entre el lector y closures retenidas dentro de WASM.

700 escenarios de preparación/cancelación y100 de validación/adopción
comparados con el original.2000 ciclos mantienen estable la memoria WASM.
Antes de la corrección de memoria pasaron185 focalizadas,5308 unitarias y
12 E2E. Una comprobación adicional de referencias, conservada como fallo,
descubrió acumulación de callbacks cerrados con wasm-bindgen0.2.104:
4091→6629 referencias entre dos tandas de1000 preparaciones.
Se actualiza al arreglo oficial0.2.105(#4709), con CLI y crates fijados,
archivos Windows/Linux verificados por tamaño/SHA256. No se parchean los
bindings generados. La misma prueba mantiene43 referencias y191 ranuras
estables con0.2.105. El contador ui_live_handles protege esta regresión.
Después del arreglo pasan124 focalizadas, incluidas1000 preparaciones y100
ciclos de menú sin retener callbacks, y 5310 unitarias completas.
14 E2E aprobados, incluidos PDF/EPUB con Davefx real: los contadores
comprueban preparación y adopción nativas, un único PCM y cambio de página
en la marca audible. También conserva navegación manual y pulsación larga.

Inventario:5420 líneas Rust/37210 JavaScript=12,71%, no funcional.
UI local475803bytes,SHA256
2e651b4f06695152c33abe9b16d1c550768d66df13ada48991d1dc862ebc5de3.
Publicación verificada:488088ec4b6b7c83ad5a4ee9d5e9c186825ef641.
Deploy38288121682/Pages38288258360 completos; Pages
b28bbc9f28634071b57c9cf19b2548d522d60b86. UI pública475763bytes,SHA256
9ab2a3c6fc9596d093798da2afdebb55e5867f9b2a616215672027b7dda13857.
published-1791828493738: todos los recursos HTTP/tamaño/SHA, dos perfiles,
30 casos PCM/tempo y APK real con loader2107bytes correctos.
La comprobación pública de memoria mantiene cero referencias tras1000
preparaciones y100 ciclos de menú, una instancia, en390 y1280px.
Se conservan dos fallos del montaje de esa comprobación: el primero
contaba respuestas HTTP(2), no instancias; el segundo utilizaba un sondeo
asíncrono sin inicializar el módulo. El montaje final inicializa una vez
y cuenta instancias reales(1), comprueba cada descarga por SHA y conserva
las igualdades exactas de memoria. No prueba un segundo motor paralelo.
E2E público PDF con Davefx1/1(22,4s). APK1.1.15/28 muestra web1.7.206:
Lessac2×,11.06s,8finales/9inicios,PID15290estable y sinFATAL.
CI38288121665:unitarias114941278868 y voces reales aprobadas. UI5
114941278918 conserva el fallo original en ci206-ui5-original.log:
ReaderControls se queda en JS si WASM llega después del plazo inicial;
su reintento pasa y el guard estricto lo rechaza como flaky. Pendiente
adoptar el módulo tardío sin duplicar listeners. Otros jobs sin concluir.
La migración completa sigue pendiente; no se declara totalmente verde el CI.
Evidencia:D:/CodexEvidence/InhouseRead-20261012/rust-voice-ahead-prototype.
Arreglo y pruebas finales:rust-ui-closure-lifetime.
Fuente:https://github.com/wasm-bindgen/wasm-bindgen/pull/4709.

# 1.7.205 — navegación del audiolibro en Rust

Changelog: «Navegación del audiolibro en Rust».
Rust gestiona explorar páginas, volver a la escucha y buscar una frase.
El cursor audible se conserva al navegar; solo una pulsación larga cambia
la frase. Las respuestas tardías se descartan si cambia la generación o
la sesión de navegación. Se conservan fuente, lector y registros originales.

1000 escenarios comparados con la implementación anterior, incluidos errores
y cancelaciones; memoria WASM estable en2000 ciclos.82 pruebas focalizadas y
5301 unitarias completas aprobadas.11 E2E originales aprobados, incluidos
PDF/EPUB con voz real, y nueva prueba compilada de navegación1/1(7,2s).
El primer ensayo nuevo pulsaba el centro de toda la línea, no la frase
«Page2». Se conserva su fallo y traza. La prueba ahora obtiene el rectángulo
del texto exacto, manteniendo el resultado esperado y el plazo originales.

Inventario:5335 líneas Rust/37191 JavaScript=12,55%, no funcional.
UI local461247bytes,SHA256
0cb2a06d1ceafe66306da472207b8922fc75d175dba33ec23613d324fdb0af3d.
Publicación verificada:e2f19a2586fde9aa0e532804dd0b2face26e3eed.
Deploy38285300873/Pages38285469995 completos, Pages
2db46d7ea2e536a56284379a9a9007eb2c5bd2f9. UI pública461207bytes,SHA256
2624d80f8694d3c7eef03c33ade921d33a3bd3ca88d0a58a7823dcbd12271025.
La primera lectura señaló oswald-OFL.txt; su registro no permite atribuir
la causa. Se conserva published-1791826829201 y el fallo del verificador de
navegador que lo rechazó. La lectura directa posterior dio HTTP200 y SHA
0687c51a3126ae6963389181135a2eaea02f2e88f31230d27409952f28e84da5,
idéntico a Pages. La nueva revisión completa published-1791826935758 pasa
HTTP/tamaño/SHA de todos los recursos, dos perfiles,30 casos PCM/tempo y
APK real con loader2107bytes. No se ha debilitado ninguna comprobación.
E2E público de gestos1/1(10s). APK1.1.15/28 muestra web1.7.205:
Lessac2×,10,21s,8finales/9inicios,PID14659 estable y sinFATAL.
CI38285300743:unitarias114932108052 aprobadas; otros jobs no concluidos.
La migración completa sigue pendiente; no se declara totalmente verde el CI.
Evidencia:D:/CodexEvidence/InhouseRead-20261012/rust-voice-navigation-prototype.

# 1.7.204 — continuidad de frases entre páginas en Rust

Changelog: «Frases continuas entre páginas en Rust».
Rust une la frase que cruza dos páginas físicas. Conserva los offsets UTF-16,
las marcas de cambio de página, la identidad de cada fuente y el fragmento
original que se restaura al pausar. Mantiene guiones, categoría Unicode Ll,
propiedades propias, símbolos y errores de getters sin alterar prototipos.

500 escenarios de unión, combinaciones de guion/Unicode, errores y memoria
estable en 2000 ciclos. 175 pruebas focalizadas aprobadas y 5296 unitarias
completas aprobadas. 5 E2E aprobados (44s), incluidos PDF/EPUB con Davefx real:
un único PCM cruza las dos páginas del PDF; el cambio ocurre en la marca
audible y se comprueba que ejecuta voice_join_sentence compilado en Rust.

Inventario:5255 líneas Rust/37175 JavaScript=12,39%, no funcional.
UI local445144bytes,SHA256
5452a19af88a10ad54b26ca4db4232c59b9b2584ab6f254a3145d54aeeab7bf3.
Publicación verificada:20adeb6a734aa0939fe77a4bc667c8f90b382333.
Deploy38283915506/Pages38284054996 completos; Pages
8b142154a9ab0c48090ec3b2d82c1cc4f7a6402f. Todos los recursos HTTP/tamaño/SHA,
dos perfiles nuevos,30 casos PCM/tempo y APK real con loader2107bytes pasan.
UI pública445112bytes,SHA256
74eed0810d1de969e827af5b6ae492e6945b6f7ebe38a527b2e87e2c7750cae3.
E2E público con Davefx real pasó tras adaptar el transporte de modelos del
test: Chromium bloqueaba loopback desde HTTPS. Se conservan fallo, traza y
mensaje CORS originales; mismos ONNX, aserciones y plazos, app/WASM públicos.
APK1.1.15/28 ejecuta web1.7.204:Lessac2×,10,59s,8finales/9inicios,PID14123
estable y sinFATAL. Evidencia:published-1791826076444 y native-ui204.json.
CI38283915476:unitarias114927579260 aprobadas; otros jobs no concluidos.
No se declara completada la migración ni totalmente verde el CI histórico.
Evidencia:D:/CodexEvidence/InhouseRead-20261012/rust-voice-join-prototype.

# 1.7.203 — elección de voz y preparación anticipada en Rust

Changelog: «Preparación de voz en Rust».
Rust aplica voz instalada/ausente, idioma explícito/declarado, selección
multilingüe, límites de anticipación y paquetes con marcas de página. Conserva
identidad de registros, idiomas regionales, orden y consulta diferida del
idioma del dispositivo. Los helpers existentes de normalización/detección y
ranking conservan su adaptador; no se declara migrado todo el catálogo.
La comprobación de final de frase usa el conjunto de espacios de ECMAScript
y puntuación original, sin crear una expresión regular por consulta.

500escenarios de selección/anticipación y1210combinaciones de puntuación,
incluidos BOM, NEL, comillas y Unicode. Marcas dispersas, texto UTF-16 exacto,
errores de getters y adopción tardía cubiertos.2000ciclos con WASM estable.
431focales aprobados:149del catálogo,112del lector y las pruebas originales
de voz(34) y voces naturales(48) ejecutadas tanto con JavaScript como Rust.
Los contadores confirman los caminos compilados.15E2E aprobados en1,8min,
incluidas voces reales Davefx PDF/EPUB, idiomas, voces, pausa y velocidad.
Batería completa5287/5287,394archivos,330,41s, dos workers.

Inventario5196Rust/37167JS=12,27% de líneas propias, no funcional.
UI local434113bytes,SHA256
192af7ac0797a5573c800d41dbf136bbaef549148891e50c7d783cbc7180ed07.
App/decor, APK y updater sin cambios. Publicación comprobada:
commit b162a1fbbac9fc40e383b084faec1da98f688027, Deploy38282554351 y
Pages38282669376 completos. Pages9600312a4e795a88db1d178b6125ae5b6eeeaaa6.
HTTP/tamaño/SHA de todos los recursos reales, dos perfiles nuevos, 30 casos
PCM/tempo y APK descargado con loader de2107bytes comprobados.
UI publicada434081bytes,SHA256
5b6e7051cbed582c322665e4b0ace7d1c76edf94f8170f79a3e33614ce38cc51.
E2E público de selección1/1(7,7s). APK1.1.15/28 ejecutando web1.7.203:
Lessac2×,11,93s,8finales/9inicios,PID13578 estable y sinFATAL.
Evidencia pública:published-1791825372900 y native-ui203.json.
CI38282554354: unitarias114923077351 aprobadas; otros jobs aún pendientes.
Evidencia:D:/CodexEvidence/InhouseRead-20261012/rust-voice-selection-prototype.

# 1.7.202 — pausa y detención del audiolibro en Rust

Changelog: «Pausa del audiolibro en Rust».
Rust coordina pausa, detención, cancelación del fragmento, reinicio por cambio
de velocidad, reintento y notificación del fallo. Conserva orden de timers,
transporte nativo, generaciones, limpieza y mensajes. Al pausar restaura la
frase original antes de descartar la preparación cancelada de la página siguiente.
Temporizador de sueño, PCM, modelos y disposición de controles sin cambios.

500secuencias comparan efectos, valores y errores con el original;2000ciclos
con memoria WASM estable.192focales aprobados, incluidas las34pruebas de voz
originales repetidas con Rust y contadores que confirman los seis caminos.
Se conserva la identidad del fragmento original y se comprueban la página
pendiente, ubicación cíclica y adopción tardía sin recrear la voz.
13E2E aprobados en1,7min, incluidas voces reales Davefx PDF/EPUB, reanudación
en la página visible y cambio de velocidad sin saltarse la frase actual.
Batería completa5233/5233,392archivos,323,70s, dos workers.

Inventario5120Rust/37148JS=12,11% de líneas propias, no funcional.
UI local419920bytes,SHA256
8cf34c9311107b58f08a3aa97bd589cbbb4b734daee14cfd4552c2fad87733b3.
App/decor, APK y updater sin cambios. Publicado d9eaa8b,deploy38281226845
y Pages38281374199 aprobados,Pages e1735b54. UI público419888bytes,SHA256
b6ed895695a0517c143c2c802884fe572e1aa15c8d0c9b84a27032415ff594cf.
Recursos reales HTTP/bytes/SHA, dos perfiles, treinta casosPCM/marcas y
APK/loader aprobados. E2E público1/1,9,7s. AndroidAPI36 confirma web202 y
APK1.1.15/28; Lessac2×11,06s, ocho fragmentos terminados/nueve iniciados,
proceso13049 estable y sinFATAL. Evidencia published-1791824599619 y
native-ui202.json. CI202 unitarias(job114918728843) aprobado; no acredita
los jobs restantes.
Evidencia:D:/CodexEvidence/InhouseRead-20261012/rust-voice-stop-prototype.

# 1.7.201 — arranque del audiolibro en Rust

Changelog: «Arranque del audiolibro en Rust».
Rust coordina Play, reanudación, preparación inicial y cambio de página tras
pausa. Conserva el cierre de la sesión retirada antes del desbloqueo nativo,
los efectos síncronos del toque, la voz elegida, los mensajes y la invalidación
por generación. Una preparación antigua no reactiva el audio tras detenerlo.
No cambia motor, pesos, audio PCM, velocidad ni paginación. No se atribuye
a este cambio una mejora de latencia de síntesis.

500escenarios comparan fases síncronas/finales, errores y cancelación con el
original;36decisiones de reinicio y2000ciclos con memoria WASM estable.
186focales aprobados:112del lector,34de voz originales repetidos sin cambios
también con Rust, y seis del nuevo módulo (incluidas cancelación durante la
actualización del motor, ubicación cíclica y adopción tardía del módulo).
Once E2E originales aprobados, incluidas dos voces reales Davefx PDF/EPUB.
El nuevo caso esperaba «Page1» en la primera frase, que es «Reading journey.»;
se comprueba ahora la primera frase exacta y la siguiente preparación de
«Page1»/«Page3», sin restos de la primera página tras el salto en pausa.
Mismo plazo,1/1aprobado en7,1s; e2e.log original preservado.
Batería completa5227/5227,391archivos,325,20s, dos workers.

Inventario5062Rust/37126JS=12,00% de líneas propias, no funcional.
UI local408393bytes,SHA256
4f8c2e7f07e3cef9d1c79dc7bca3fe0fcacc8d6dcae30fac49f0785bd22a6e6b.
App/decor, APK y updater sin cambios. Publicado21f0f5e,deploy38279755161 y
Pages38279901551 aprobados, Pages57c4d281. UI público408361bytes,SHA256
95eff093c0264d12752307c32e2eeb97a5a654d52320e4e8c20204ccb82b6446.
Recursos reales HTTP/bytes/SHA, dos perfiles, treinta casosPCM/marcas y
APK/loader aprobados. E2E público1/1,7,3s. AndroidAPI36 confirma web201 y
APK1.1.15/28; Lessac2×10,21s, ocho fragmentos terminados/nueve iniciados,
proceso12488 estable y sinFATAL. Evidencia published-1791823890016 y
native-ui201.json. CI201 unitarias(job114913877128) aprobado; no acredita
todos los jobs de CI.
Evidencia:D:/CodexEvidence/InhouseRead-20261012/rust-voice-start-prototype.

# 1.7.200 — controles y teclado del lector en Rust

Changelog: «Controles del lector en Rust».
Rust crea los mismos nodos del lector, refleja el estado del audiolibro y
calcula los límites del panel y el desplazamiento del campo enfocado ante
el teclado. Iconos, textos, orden de efectos y controles inferiores idénticos.
No cambia paginación, síntesis, selección de voces ni temas. Las funciones
adoptan un módulo tardío sin recrear el lector ni perder el campo enfocado.

Diez comparaciones de DOM completo,200secuencias de estados y200escenarios
de viewport/teclado contra el original;4000actualizaciones mantienen WASM
estable.119focales aprobados. Primer prototipo de entorno no encontraba el
documento en Vitest; se pasa explícitamente el documento desde el adaptador.
Los registros anteriores se conservan, no se declaran aprobados.

Once E2E originales aprobados, incluidas voces reales Davefx PDF/EPUB.
El nuevo caso falló por solicitar una voz medium ausente en su catálogo
simulado high. Se le proporcionó el registro y la instalación explícitos;
mismo plazo/aserciones,1/1aprobado en7,3s. Originales e2e.log conservados.
Batería completa5187/5187,389archivos,320,87s, dos workers.

Inventario4995Rust/37111JS=11,86% de líneas propias, no funcional.
UI local395831bytes,SHA256
a1f6ded7dd3e060c52784ed112e9280f008f261f5b26a771753f26822d667228.
App/decor, APK y updater sin cambios. Publicado37d3544,deploy38278317497 y
Pages38278469093 aprobados, Pagescf206fb9. UI público395791bytes,SHA256
c2313a4f4f6751a700adc2b2eb4da6511244c631fd85585981c2685af6fe5db5.
Recursos HTTP/bytes/SHA, dos perfiles, treinta casosPCM/marcas y APK/loader
aprobados. E2E público1/1,14s. AndroidAPI36 confirma web200/APK1.1.15/28,
Lessac2×11,94s, ocho fragmentos terminados/nueve iniciados, proceso11940
estable, sinFATAL. CI200 unitarias(job114909127944) aprobado; no acredita
los jobs restantes. Evidencia published-1791823079998 y native-ui200.json.
La primera consulta pública se adelantó al Pages aún en cola y conserva su
fallo. La segunda terminó correctamente; tres verificadores lanzados antes
de que escribiera su informe no recibieron ruta. Logs originales preservados,
verificaciones con ruta confirmada separadas como public-*-final.log.
Evidencia:D:/CodexEvidence/InhouseRead-20261012/rust-reader-chrome-prototype.

# 1.7.199 — apertura y cierre del lector en Rust

Changelog: «Apertura del lector en Rust».
Rust coordina preparación, actualización de título/autor, apertura del panel,
cierre explícito de la voz y reinicio del lector. Conserva registros y bytes
por referencia y el orden síncrono anterior al primer await. Las anotaciones
se aplican después de preferencias; la liberación del motor sólo sucede al
cerrar explícitamente la voz. El helper conserva llamadas con un host parcial.

200secuencias comparan efectos síncronos/finales, errores y DOM con el original.
Identificadores UTF-16, asignación parcial fallida y liberación están cubiertos.
119focales y5180/5180unitarias completas,388archivos,326,65s,dos workers.
12E2E aprobados en1,7min: página guardada, marcadores, punto de regreso,
título editado y voces reales Davefx PDF/EPUB. Memoria WASM estable tras200ciclos.
Inventario4925Rust/37087JS=11,72% de líneas propias, no porcentaje funcional.
UI local384556bytes,SHA256
69aa60fe4253d5a26f5d8ff24dec86d939aabd8aae0a6c12742f6a05d7677448.
App/decor, APK y updater sin cambios. Publicado7ea48ce,deploy38276929328 y
Pages38277079605 aprobados,Pagesef007b5. Recursos reales HTTP/bytes/SHA,
dos perfiles, treinta casosPCM/marcas y APK/loader aprobados. E2E público1/1,
13,6s. UI público384516bytes,SHA256
82a00bc414949aa9dd379ab6995a28b7fa5f47c34fd6ea3507ab0d0fffcc899b.
AndroidAPI36 confirma web199/APK1.1.15/28; Lessac2×10,18s, ocho fragmentos
terminados/nueve iniciados, proceso11349 estable y sinFATAL.
Evidencia published-1791822346739 y native-ui199.json.

CI198 volvió a superar5s en la comparación de ubicaciones:5174/5175,
original ci198-unit-original.log conservado en rust-voice-flow-prototype.
La configuración de Vitest limita ahora también en CI la concurrencia a dos
workers, igual que la batería completa local. No se cambian casos, aserciones
ni plazos; se evita ejecutar simultáneamente más fixtures DOM/WASM pesados.
CI199(job114904568275) completó las unitarias con éxito. Esto no acredita
el resto de jobs ni borra las incidencias E2E históricas.
Evidencia:D:/CodexEvidence/InhouseRead-20261012/rust-reader-lifecycle-prototype.

# 1.7.198 — idiomas y selección de voces en Rust

Changelog: «Idiomas y voces en Rust».
Rust coordina el idioma del libro, la selección de idioma/voz, etiquetas
automáticas, actualización del catálogo instalado y menús de voces. Conserva
los registros originales por referencia, las variantes regionales, la voz
compatible y el reinicio al cambiar a un idioma incompatible. ICU, detección
de idioma declarada y el catálogo existente mantienen sus adaptadores.
No añade voces, modifica modelos ni cambia la síntesis.

500escenarios comparan efectos y valores con el original;2000ciclos mantienen
WASM estable. Se comprueba además la consulta diferida del idioma del equipo,
la ausencia de libro, selección conservada y limpieza de la voz incompatible.
116focales y12E2E aprobados(1,6min): idiomas, instalación/selección de otra voz,
reproducción, PDF/EPUB, preferencias, persistencia y dos voces reales Davefx.

Primera batería completa5173/5173,387archivos. Se conserva como unit-full.
Tras preparar las plantillas de las pruebas una sola vez,18focales y batería
completa final5175/5175,387archivos, dos workers. Misma matriz de200casos,
mismas creaciones/liberaciones y límite de5s; dos pruebas adicionales comprueban
que la clonación conserva HTML y valores iniciales. No se cambian aserciones
anteriores ni se eleva el límite. Comparación local parse/clone en el mismo
ensayo:6,88/4,81ms por panel, incluido serializado. Esto acelera la preparación
de pruebas, no acredita aceleración del producto. CI196/197 originales guardados.

Inventario4851Rust/37058JS,11,58% de líneas propias, no funcional.
WASM UI local374033bytes,SHA256
084d433b8ea8434366deb51bf827e977bfc044494af5f08acec0953b52b7ead8.
App/decor, APK y updater sin cambios. Publicado2fe18ed,deploy38275195952 y
Pages38275336332 aprobados, Pages5d963c1. Recursos HTTP/bytes/SHA, dos perfiles,
treinta casosPCM/marcas y APK/loader reales aprobados. UI público373993bytes,
SHA256 1c1ee314941ff77d31358c7a0db07ff68b6e6c9f533b7179e011aca2ae76d18d.
E2E público1/1 aprobado en8,1s. Android API36 confirma web198/APK1.1.15/28,
Lessac2×11,06s, ocho fragmentos terminados y nueve iniciados, proceso10823
estable, sin FATAL. Evidencia published-1791821487616 y native-ui198.json.
CI completo aún
tiene las incidencias documentadas más abajo; no se declara totalmente verde.
Evidencia:D:/CodexEvidence/InhouseRead-20261012/rust-voice-flow-prototype.

# 1.7.197 — preferencias y adopción tardía en Rust

Changelog: «Preferencias del lector en Rust».
Rust coordina ajustes, guardado local, notificación de nube, opciones de audio,
reintento/calentamiento de voces y aplicación al motor. La normalización y
los límites existentes conservan su adaptador. Los cambios de audio no vuelven
a paginar el libro. Los efectos anteriores al primer await siguen siendo
síncronos, incluida la notificación de un error inmediato del motor.

El primer prototipo notificaba ese error demasiado tarde; check.log preserva
la diferencia. Se corrigió antes de integrar;200secuencias comparan el orden
síncrono y final, éxito, cuota de almacenamiento, error síncrono/asíncrono,
voces ausentes y restart:false. También normalización fallida, lector sustituido
por un callback, picker incompleto y2000ciclos con memoria WASM estable.

Una vista creada mientras descarga WASM adopta el módulo válido en su siguiente
operación. No recrea el lector, cambia su paginación, repite acciones ni mueve
el campo enfocado. Una vista liberada no resucita. El E2E de descarga detenida
conserva todas sus comprobaciones previas y ahora demuestra la adopción en el
mismo EPUB abierto, con un único módulo. La prueba del componente compilado
espera explícitamente a que esté disponible; el caso frío se cubre por separado.
No se aumentan los plazos de las pruebas ni el límite de arranque del lector.

125focales;5169/5169unitarias completas,386archivos, dos workers.14E2E
aprobados:12de preferencias, PDF/EPUB y voces reales Davefx (1,6min), más
dos de vista compilada/adopción tardía(12,8s). Sin omisiones ni reintentos.
No se atribuye a este cambio una aceleración del motor de voz.

Inventario4782Rust/37035JS,11,44% de líneas propias, no funcional.
WASM UI local365227bytes,SHA256
772411316303e4ad147faf4c392c6e72c6396e19bdd080b525353598d9dc8002.
App/decor, APK y updater sin cambios. Publicado14115ce; deploy38272774777
y Pages38272913155 aprobados (Pagesdef0e32). 228checksHTTP/bytes/SHA, dos
perfiles, treinta casosPCM/marcas y APK/loader reales aprobados. Tres E2E
públicos aprobados en17,9s, incluida descarga detenida y adopción en el mismo
documento. UI público365187bytes,SHA256
4d5aa3467372c184f932c37a2a97f503d113f372744eaba91d7947286033eea7.
Android API36 confirma web197 y APK1.1.15/28; Lessac2×11,17s, ocho fragmentos
terminados/nueve iniciados, proceso10248 estable, sin FATAL. Evidencia:
published-1791820284221,public-*.log,native-ui197.json. Incidencias CI
históricas preservadas en las secciones siguientes; no se declara todo verde.

CI196 unitarias(job114885340715) agotó5s en la comparación de ubicaciones.
CI197(job114890840614) agotó5s en esa comparación y en creación/liberación
de controles. Originales ci196-unit-original.log y ci197-unit-original.log
preservados en sus carpetas de evidencia. No se aumentan los plazos.
Evidencia:D:/CodexEvidence/InhouseRead-20261012/rust-preference-flow-prototype.

# 1.7.196 — posición y datos del lector en Rust

Changelog: «Posición del lector en Rust».
Rust actualiza título, autor, ficha del documento, controles PDF/EPUB, progreso
y etiquetas accesibles. Los valores Unicode conservan sus referencias JS y
los campos de progreso/página que tienen el foco mantienen la edición actual.
Referencias DOM reutilizadas, sin cambiar paginación ni ubicación del audio.
Una sustitución del botón de ubicación vuelve a enlazar el nodo conectado.

118focales aprobadas, incluidos200estados completos equivalentes, Unicode,
campos enfocados, reemplazo del botón, título opcional y módulo antiguo.
Dos mil ciclos no crecen WASM. Benchmark CPU×4 de nueve rondas alternadas:
actualización sin forzar layout0,0423ms JS/Rust; con layout0,277/0,281ms.
No acredita aceleración. Primera medida sin caché de nodos preservada.

Batería completa final5162/5162unitarias,385archivos, dos workers. Primer
intento conservado:5160aprobadas y dos límites de5s excedidos (controles y
comparación de ubicaciones), simultáneo a E2E y emulador. Repetición completa
sin esa carga, mismas aserciones y límites. Logs unit-full y unit-full-isolated.
E2E35aprobados y seis omitidos por condiciones originales de la suite, más
la corrección de instrumentación de lugares1/1. Incluye dos pruebas de voces
reales Davefx PDF/EPUB, paginación, foco del teclado y controles inferiores.

Inventario4729Rust/36996JS,11,33% de líneas propias, no funcional.
UI local356926bytes,SHA256
b4884f727159d3daccce9ea5229cd1e6ddbc478f84deefd4549ea72e76d0e604.
App/decor, APK y updater sin cambios. Publicadob39839f; deploy38271123127
y Pages38271260450 aprobados (Pagesb51784b). 226checksHTTP/bytes/SHA,
dos perfiles, treinta casosPCM/marcas y APK/loader reales aprobados. E2E
público1/1,7,2s. UI público356894bytes,SHA256
c59559b7700bc5ca4ca6f2dbfa4de74ba35e00d237008600aecaba852c97a308.
Android API36 confirma web196 y APK1.1.15/28, Lessac2×11,09s, ocho fragmentos
terminados/nueve iniciados, mismo proceso9507, sin FATAL. Evidencia:
published-1791819424818,public-*.log,native-ui196.json.
Las seis capturas omitidas se ejecutaron después habilitando su directorio:
6/6aprobadas en33s, e2e-screens.log y control-screens. Total42E2E aprobados.
Evidencia:D:/CodexEvidence/InhouseRead-20261012/rust-reader-location-prototype.
Incidencias CI anteriores preservadas en las secciones siguientes.

# 1.7.195 — controles del lector en Rust

Changelog: «Controles del lector en Rust».
Rust administra las pulsaciones, teclado de pestañas, campos de apariencia,
velocidad, progreso, temporizador, citas, búsqueda y cierre del panel. Conserva
onclick/onkeydown/onsubmit donde existían y listeners donde se usaban antes.
Los handlers consultan un WeakRef del controlador, sin un ciclo de propiedad
JS/WASM; al liberar eliminan sólo sus propios handlers. Si alguien sustituyó
un onclick, no lo borran. Hosts sin WeakRef conservan la implementación previa.
Normalización de preferencias y API de orientación conservan sus adaptadores.

Primeras focales detectaron que el binding de Contenido había cambiado de
onclick a addEventListener; logs unit-focused.log y unit-controls.log preservados.
Se corrigió el binding, sin cambiar la aserción original. Resultado final:
120focales;5156/5156unitarias,384archivos,355,16s(dos workers);12E2E,2min,
incluidas voces reales PDF/EPUB. Comparación de39efectos, etiquetas, foco y
valores; prueba de llamada directa onclick, sustitución posterior, constructor
incompleto y host liberado. Doscientas creaciones/liberaciones sin crecer WASM.
El campo Binding::Event conserva Listener por su destructor RAII; la advertencia
de campo no leído no significa que se pueda eliminar ese recurso.

Inventario4680Rust/36989JavaScript,11,23% de líneas propias, no funcional.
WASM UI local351025bytes,SHA256
65ba7e3a009999d70d715dc017b54be9e8402efc3c6d768acbc6e571191a96a0.
App/decor, APK y updater sin cambios. Publicado5e6aa8a; deploy38268308810
y Pages38268437853 aprobados (Pages96ec661). HTTP/bytes/SHA y dos perfiles
confirman el artefacto real, treinta casos PCM/marcas y APK/loader aprobados.
E2E público1/1,9,1s. UI público350993bytes,SHA256
fc14152d550416cf85726220d32da0d1f68cdb6e25cc1d30b6697d2e63e88402.
Android API36 confirma web195 y APK1.1.15/28, Lessac2×10,44s, ocho fragmentos
terminados/nueve iniciados, proceso8908 estable, sin FATAL.
Evidencia:published-1791818034583,public-*.log,native-ui195.json.
Evidencia:D:/CodexEvidence/InhouseRead-20261012/rust-reader-controls-prototype.

CI192 UI2 pasó, incluidos los dos contratos de devolución antes fallidos; esto
no borra los originales de CI190. UI6 de CI192 se rechaza: la retirada de un
libro enlazó cuatro programas frente a cero esperados en su primer intento,
aunque pasó al reintentar. Original ci192-ui6-original.log, job114858250808,
run38263065874, prueba shelf-trash:433. Requiere investigar la compilación
concurrente; no se atribuye aún una causa ni se acepta ese reintento como verde.

CI195 UI5 también falla (job114876017917,run38268308776). reading-places
espera cruces de exports que ahora son llamadas internas desde reader_actions;
1.7.196 observa reader_bookmark/reader_jump, sus fronteras compiladas actuales,
sin retirar ninguna comprobación de UI; prueba corregida1/1,9,2s.
reader-view tuvo además un intento sin constructor nativo observado (reintento
aprobado); requiere comprobar la adopción tardía del módulo. Original completo
ci195-ui5-original.log preservado. CI completo no se considera aprobado.

CI193 completo terminó fallido. UI2 (job114864342412) conserva devolución
alineada8032,3ms frente a8000 y otro fallo de clase de cierre; legado tuvo
un reintento. UI5(job114864342403) conserva el constructor Rust no observado
en el primer intento de reader-view. Originales ci193-ui2-original.log y
ci193-ui5-original.log en rust-progress-queue-prototype. No se elevan límites.

# 1.7.194 — acciones del lector en Rust

Changelog: «Acciones y búsqueda del lector en Rust».
Rust orquesta saltar, volver al punto previo, guardar lugares, alternar
marcadores, añadir citas y buscar/retirar resultados. Cada salto conserva
el validador de la cola y comprueba su vigencia después de las operaciones
asíncronas. Lectores, persistencia, normalización de registros y creación
de fechas/identificadores conservan sus fronteras JS. No mueve los controles.

5148/5148unitarias,383archivos,352,27s (dos workers);136focales. Doscientas
secuencias comparan efectos, errores, historial y referencias con el original.
Cancelación durante el guardado, regreso fallido, selección recordada, cita
original para anotación/copia limpia para persistencia y resultados a fracción
cero cubiertos. Dos mil ciclos liberan los handles sin crecer la memoria WASM.
12E2E aprobados,2min: comandos Rust compilados, PDF/EPUB, persistencia, búsqueda,
citas, temas, UI móvil y dos pruebas de continuidad de página con pesos reales
Davefx. No se cambia el motor de voz ni se atribuye aceleración no medida.

Inventario4570Rust/36958JavaScript,11,00% de líneas propias, no funcional.
WASM UI local329606bytes,SHA256
66376ca55cba01f811a555ee790268343cf139b51ac3a8139eddbad0d54cca86.
App/decor, APK y updater sin cambios. Publicadoe43e529, deploy38266471769
y Pages38266610954 aprobados (Pagesaf958bf). 222checksHTTP/bytes/SHA, dos
perfiles, treinta casosPCM/marcas y APK/loader reales aprobados. E2E público
de acciones1/1,10,1s. UI público329574bytes,SHA256
7dcb86f894c2a90cb5b10f115e77116c132573edfb1a3daa70a5e249b6c4ab34.
Android API36 confirma web194 y APK1.1.15/28: Lessac2×,11,10s acumulados,
ocho fragmentos terminados, nueve iniciados, mismo proceso8325, sin FATAL.
Evidencia:published-1791817287050,public-*.log,native-ui194.json.
Evidencia:D:/CodexEvidence/InhouseRead-20261012/rust-reader-actions-prototype.

# 1.7.193 — cola de progreso en Rust

Changelog: «Guardado ordenado del progreso en Rust».
Rust administra colas independientes por libro, fusiona posiciones pendientes,
conserva barreras de ajustes y espera la notificación posterior al commit.
El host mantiene IndexedDB, clonación superficial de ajustes y fecha de guardado.
Las promesas fusionadas conservan identidad y los errores llegan al solicitante.
Cargar WASM tarde sólo cambia de motor cuando cada cola anterior queda vacía;
un libro bloqueado no impide guardar otros. Liberar el handle no pierde tareas.

31 focales y10E2E aprobados. Primera batería completa:5123aprobadas/1fallida,
timeout original de5s en relief-palette-wasm max work square, conservado en
unit-full.log/json. Sin cambiar fuente, plazos ni aserciones, batería acotada
a dos workers:5124/5124,382archivos,317,23s. No se borra el resultado anterior.
El prototipo compara1808condiciones e identidades; tests cubren errores de
almacenamiento/notificación, reentrada, claves Map y __proto__ propio. Cuatro
mil libros distintos reutilizan slots sin crecimiento de memoria WASM.

Microbenchmark Chromium CPU×4, nueve rondas, puente/Promise incluidos y DB
sustituida por un callback inmediato: una escritura JS0,002ms/Rust0,045ms;
cien posiciones fusionadas JS0,018ms/Rust0,137ms. Esto es sobrecoste de puente,
no una mejora de velocidad ni tiempo de IndexedDB. Se limita la consulta de
propietario a una por cola y se evita serializar bytes/libros a WASM. No hay
trabajo nuevo por fotograma. El coste debe vigilarse al migrar persistencia.

Inventario4480Rust/36928JavaScript,10,82% de líneas propias; no funcional.
WASM UI local301522bytes,SHA256
44b3d34d9b7ebcda71b6e227654b41b42fc32df959b0cdc8705dd41f38e1d511.
App/decor, APK y updater sin cambios. Publicado24946b4, deploy38264858284
y Pages38264998209 aprobados (Pagesd64d7c2). 215comprobacionesHTTP/bytes/SHA,
dos perfiles, treinta casosPCM/marcas y APK/loader reales aprobados. E2E
público de persistencia Rust1/1,7,4s. UI público301482bytes,SHA256
81e731f580b711a64dc6f81eaf63c62c52ff6e2990432eb79427bcd5dfafcc6e.
Android API36 confirma web193 con APK1.1.15/28: Lessac2×,11,90s acumulados,
ocho fragmentos terminados y nueve iniciados, proceso7744 estable sin FATAL.
Se esperan cuatro segundos sin tocar la pantalla al arrancar para permitir
la comprobación inicial de publicación antes de abrir el menú de versión.
Evidencia:published-1791816485244,public-*.log,native-ui193.json.
Evidencia:D:/CodexEvidence/InhouseRead-20261012/rust-progress-queue-prototype.

# 1.7.192 — navegación serializada en Rust

Changelog: «Navegación del lector en Rust».
Rust posee la cola de acciones, generación y estado de navegación. Cancelar
un libro libera inmediatamente la cola del siguiente; la finalización de
una acción anterior no borra el indicador de la nueva. Conserva resultados,
errores, validadores retenidos, recuperación tras fallos y reentrada. El host
conserva las acciones de navegación/guardado y su validación de libro actual.
wasm-bindgen-futures0.4.54 comparte versiones fijadas y avisos MIT/Apache.
No se mantiene un préstamo Rust durante callbacks o esperas de JavaScript.

5100/5100 unitarias,381 archivos,326,94 s;137 focales aprobadas. Diez E2E
aprobados en1,3min: lectura, voces, apariencia, marcadores/saltos/regreso y
exports Rust reales. Dos mil colas creadas/liberadas sin crecimiento WASM.
No cambia el motor de audio ni se atribuye una aceleración no medida.
Inventario:4412 Rust/36897 JavaScript,10,68 % de líneas propias.
WASM UI local293130bytes,SHA256
4313b11b5cd2d246f0f3e4418d01367ee1a91c0e4422fa873ac1d944e181cd03.
App/decor, APK1.1.15/28 y pin del updater sin cambios. Publicado7d24819,
deploy38263065855 y Pages38263212976 aprobados (Pages c5415c4). 211checks
HTTP/bytes/SHA aprobados, dos perfiles, treinta casos PCM/marcas, APK/loader
reales y E2E público de navegación1/1 (55,3s). UI público293090bytes,SHA256
72c34d19986a89f2cd84992e7528ffad063a97fdd2abf8fe43a8d2b81d5b9e47.
Primeras dos observaciones nativas conservadas como fallidas: todavía web191.
Una consulta posterior desde ese WebView sí obtuvo el bundle192; otro regreso
al primer plano registró la recarga automática hacia él, sin borrar caché ni
datos. No se atribuye causa cierta a la demora anterior. Luego el APK ejecutó
web192, voz real Lessac2×,11,18s acumulados,8fragmentos terminados y9iniciados,
proceso7153 estable, sin FATAL EXCEPTION. Emulador API36, no teléfono físico.
Evidencia:published-1791815541331,public-*.log,native-freshness.json,
native-resume-observed.json,native-ui192-current.json; fallos previos retenidos.
Evidencia:D:/CodexEvidence/InhouseRead-20261012/rust-reader-navigation-prototype.

# 1.7.191 — marcadores e historial en Rust

Changelog: «Marcadores e historial en Rust».
Rust comprueba y alterna marcadores, retira todos los duplicados y limita el
historial a veinte entradas. Conserva referencias de registros, mutación de
la lista al insertar, límites de cien marcadores, tolerancia y semántica JSON
de los localizadores. La creación de etiquetas/fechas y la normalización de
registros guardados permanecen en el host. No se integra el prototipo lento
de normalización anterior. Alternativa JS disponible si falta el módulo.

5085/5085 unitarias, 380 archivos, 349,05 s. 2000 operaciones comparan las
tres funciones, referencias, llamadas al constructor y mutaciones. Errores
de creación/JSON no dejan estado retenido; 1000 ciclos sin crecimiento WASM.
13 E2E aprobados en 2 min: saltos, regreso, citas, marcadores, reapertura,
temas, página estable, controles de voz, listas y exports reales compilados.
Benchmark Chromium CPU×4 sobre cien marcadores: mediana JS/Rust 0,146/0,141 ms
con localizadores cortos; 0,492/0,331 ms con localizadores largos. Nueve rondas;
la diferencia corta está en el ruido. No son tiempos de navegación completa.

Inventario: 4377 Rust / 36884 JavaScript, 10,61 % de líneas propias.
WASM UI local 281945 bytes, SHA256
246d2e37803d55e823be124d11e3e023b746f11d9831a8ed07bf72cc5f9cab8a.
App/decor y APK/updater sin cambios. Publicado d6a8842, deploy38261656216
 y Pages38261804170 aprobados (Pages d18a2bf). Comprobaciones HTTP/bytes/SHA
 completas sin errores, dos perfiles, treinta casos PCM/marcas y APK/loader
 reales. E2E público de marcadores/historial aprobado (6,8 s).
 UI público281929bytes, SHA256
 01af7e3bd559757bed9484a20f91f0fd6ddf2434ca1312d7b95fbc22f3fd6392.
 Evidencia published-1791815158175 y public-*.log.
Evidencia: D:/CodexEvidence/InhouseRead-20261012/rust-reading-places-prototype.

# 1.7.190 — resaltado, seguimiento y carga tardía de Rust

Changelog: «Resaltado Rust y recuperación de carga».
Rust conserva estilos exactos y el registro CSS Highlight del documento del
rango. Cinco cadenas CSS compartidas, nodos intactos, sin cambiar selección
ni layout. El cálculo de seguimiento usa todas las líneas del rango: antes
una primera línea visible podía ocultar las siguientes. Si el rango es más
alto que la pantalla, conserva su principio cerca del borde superior.
Alternativas JS conservadas. No cambia el motor ni la velocidad del audio.

107 focales aprobadas; 3000 decisiones geométricas exactas, rangos grandes,
API ausente, excepción del constructor, un estilo por documento y 1000 ciclos
sin crecimiento WASM. Batería completa anterior al ajuste del loader:
5079/5079, 313,85 s; batería definitiva: 5081/5081 en 379 archivos, 315,10 s.
Siete E2E de PDF adaptable e invocación Rust, 40,8 s; otros cinco, 44,4 s,
incluyen voces reales EPUB/PDF, mapa/resaltado compilados y descarga retenida.

La prueba pública189 detectó que un módulo terminado después del plazo de
2 s quedaba descartado hasta otra apertura. La traza registra 2,117 s entre
la petición del JS y la del WASM (el WASM tardó sólo 60 ms). Se publica el
resultado válido aunque llegue tarde y se comparte la inicialización pendiente
al reintentar, evitando dos memorias que invaliden handles. La apertura sigue
liberándose a los 2 s. Prueba E2E retiene el WASM hasta ver el lector disponible,
lo libera y comprueba un único módulo usando Rust en el siguiente documento.
Se mantienen verificación ABI y cooldown tras un error real.

Inventario: 4336 Rust / 36867 JavaScript, 10,52 % de líneas propias.
WASM UI local 278816 bytes, SHA256
221cd1b9d1c15f0457d3449aeb7bcee828118d1f20bd1cc7d5de44ac2f6dfcb4.
App/decor y APK/updater sin cambios. Publicado fdd2398; deploy 38260168821
y Pages 38260313827 aprobados, Pages 669f46c. 205 comprobaciones públicas,
dos perfiles con bytes exactos, 30 casos PCM/marcas, APK y loader reales.
UI público 278800 bytes, SHA256
bc2431cfd622befa4b95a4cc16561c4a6761254ecb3935f0a6de7388390ae1d9.
Pruebas públicas de mapa, resaltado y carga retenida: 3/3, 18 s. Android API36
ejecuta web1.7.190 con APK1.1.15/28: Lessac a 2×, 10,29 s, siete unidades
terminadas, proceso5957 estable, sin FATAL EXCEPTION. No es un móvil físico.
Evidencia publicada: published-1791814028573, public-*.log y native-ui190.json.
CI190 UI2 ya completó: el caso PDF antes fallido pasa, pero fallan los dos
contratos nativos de devolución en ocho segundos. No se presenta CI190 como
aprobada. Se conservan ci190-ui2-original.log y ci190-ui2-artifact (45archivos),
con fases y trazas para investigar; no se alteran aserciones ni plazos.
Evidencia: D:/CodexEvidence/InhouseRead-20261012/rust-speech-highlight-prototype.

Siguiente prototipo, todavía fuera de producción: normalización de marcadores
y citas en Rust. 10000 comparaciones y memoria estable, pero la frontera de
objetos da 8,094 ms frente a 0,080 ms para 200 citas con CPU×4. No se integra
ese diseño. Se conserva en rust-reading-state-prototype para revisar propiedad
y persistencia del estado, sin presentarlo como parte migrada del producto.

# 1.7.189 — mapas de texto y rangos en Rust

Changelog: «Mapa de texto del audiolibro en Rust».
Rust recorre los nodos, conserva las separaciones originales y busca rangos
y offsets. Los resultados son objetos JS normales con los nodos originales;
no mantienen handles Rust que requieran finalizador. Fallback JS conservado.
El recorrido hereda identificadores de bloques y evita consultar padres de
cada texto; getters tipados, claves API internadas y longitud local evitan
copias de cadenas y llamadas DOM repetidas. No se internan textos de libros.

5071/5071 unitarias, 378 archivos, 319,37 s. 103 focales en el primer port;
la batería completa repite los casos con el port optimizado, incluidos XML,
imágenes PDF, nodos originales, rangos, posición, textos ocultos y ambos motores.
Prototipo: 72544 comparaciones; 1000 mapas sin crecimiento de memoria WASM.
E2E: 4/4, 40,4 s, con exports reales y pesos Davefx en EPUB/PDF; además el
caso de narración completa del PDF adaptable pasa localmente (12,1 s).

Benchmark Chromium móvil CPU×4, 60 párrafos/240 spans, rangos y offsets
incluidos, mediana de nueve rondas: JS 2,453 ms / Rust 1,927 ms. El primer
port daba 2,443/6,847 ms; se conserva y no se publicó. Las mediciones son de
ese trabajo concreto, no de la velocidad total de la app ni de un móvil físico.
Fallos iniciales de tipos Rust y URL ESM del harness conservados por separado.

Inventario: 4280 Rust / 36840 JavaScript, 10,41 % de líneas propias.
WASM UI local 271430 bytes, SHA256
39608269653d706f95056ee65afa4ca4b0a39602626f63486d6bab24eaf98cbd.
App/decor y APK/updater sin cambios. Publicado 96dd40e; deploy 38258284416
y Pages 38258422998 aprobados, Pages d2c76db. Recursos por tamaño/SHA, dos
perfiles con bytes exactos, 30 casos PCM/marcas, APK y loader reales aprobados.
UI público 271414 bytes, SHA256
b0fdc5c0370f5aa52d166227b4ba5fed3f69944d743b7d0a1b68a1dab560ee5f.
El test de invocación pública Rust falló: inicialización tardía, sin llamadas
a sus exports aunque había terminado el módulo. Original public-ui.log y
traza retenidos; corrección incluida en190. No se presenta como test aprobado.
Evidencia publicada: published-1791813118298 y public-*.log.
CI187 conserva fallo de visibilidad de resaltado en PDF adaptable; original
ci187-ui2-original.log en rust-voice-options-prototype. Que el caso pase en
Windows no acredita solucionado el fallo de Linux. No se reducen aserciones.
Evidencia: D:/CodexEvidence/InhouseRead-20261012/rust-speech-map-prototype.

# 1.7.188 — cortes de página del audiolibro en Rust

Changelog: «Cortes de página del audio en Rust».
RustSpeechPages mide los rangos de glifos, busca fronteras y devuelve offsets
UTF-16 únicos. Lotes de 64 spans con cancelación y cesión entre lotes; no copia
el texto completo del capítulo. No cambia las frases ni el motor de audio.
La alternativa JS se conserva ante fallo de carga; finally libera cada scanner.

5032/5032 unitarias, 377 archivos, 308,77 s. 31 focales; 510 comparaciones
de cortes y consultas exactas, RTL, vertical, espacios, pares sustitutos,
cancelación, excepciones y 1000 scanners sin crecimiento de memoria. El
primer harness conservaba una referencia al array de consultas al vaciarlo;
se corrigió sólo el helper y se conserva unit-focused.log fallido.
E2E: 3/3 en 35,8 s: export Rust instrumentado en app compilada y continuidad
EPUB/PDF con los pesos reales de Davefx. La página cambia al inicio audible
de su continuación. No equivale a una prueba en teléfono físico.

Inventario: 4193 Rust / 36823 JavaScript, 10,22 % de líneas propias.
WASM UI local 263733 bytes, SHA256
829a80dd6daee7b554bb39e43200fcf1f81d33aa74251db6a92e3cd4d7e4e197.
App/decor y APK/updater sin cambios. Publicado de3e7af; deploy 38256432549
y Pages 38256537117 aprobados; Pages 8c6fe77. Los recursos públicos coinciden
por tamaño/SHA, dos perfiles cargan los bytes exactos; 30 casos PCM/marcas,
APK y loader reales aprobados. UI público 263717 bytes, SHA256
2caf48b7c3fa240eaa73507f5aeda874c3be92f4e711a28c5c1ccb9793e137d4.
Export del scanner ejercitado en web pública: 1/1, 5,3 s. Android API36 con
web 1.7.188 y APK 1.1.15/28: Lessac a 2×, 10,27 s, ocho unidades terminadas,
proceso 5266 estable, sin FATAL EXCEPTION. No mide un teléfono físico.
Evidencia: published-1791812204929 y rust-speech-pages-prototype/public-*.log,
native-ui188.json, en D:/CodexEvidence/InhouseRead-20261012.

# 1.7.187 — selección de idiomas y voces en Rust

Changelog: «Idiomas y selección de voces en Rust».
Rust agrupa idiomas, cuenta voces instaladas y pendientes, ordena por libro,
dispositivo y prioridades, aplica puntuaciones/regiones a voces naturales y
numera nombres repetidos. Conserva referencias originales y desempates estables.
Los nombres localizados y la normalización BCP-47 usan los mismos helpers/ICU;
no se afirma que esos helpers o el motor de síntesis estén migrados aquí.
La alternativa JavaScript permanece disponible ante fallo de carga del módulo.

5015/5015 unitarias en 376 archivos, 314,84 s. 191 focales. 3000 comparaciones
sembradas de menús, UTF-8, regiones, empate, instalación y referencias; acepta
los mismos iterables en la agrupación. 1000 llamadas adicionales sin crecer la
memoria WASM. E2E: 16/16, incluidas descargas/cancelación/reintento, teclado,
PDF/EPUB, FB2 y exports reales de selección en la app compilada. Fallo inicial
de compilación del prototipo (Object/JsValue) conservado y corregido antes de
integrar. No cambia el conjunto ni la calidad de voces disponibles.

Inventario: 4132 Rust / 36809 JavaScript, 10,09 % de líneas propias.
WASM UI local 245556 bytes, SHA256
b51acb2710711a57e91dfb2c28471822bf9ad43c14179e1be5b2f0786eecc0f0.
App/decor y APK/updater sin cambios. Publicado 47b4fb6; deploy 38254861281
y Pages 38255005861 aprobados, Pages 6262a56. Manifiesto y recursos públicos
verificados por tamaño/SHA, dos perfiles con bytes exactos, 30 casos PCM/marcas,
APK y loader reales. UI público 245540 bytes, SHA256
5c392ad3147c9ee20423d49e4bfb28d37b8078c2ba8f6740bb0f36fb98ceaf54.
La selección Rust se ejercita en la web pública: 1/1 aprobado, 9,3 s.
Evidencia: published-1791811606469 y rust-voice-options-prototype/public-*.log,
en D:/CodexEvidence/InhouseRead-20261012. CI completa sigue pendiente.

# 1.7.186 — catálogo de voces en Rust y carga FB2

Changelog: «Voces en Rust; apertura FB2».
RustNeuralView crea las filas, botones, progreso y oferta de descarga de voces;
conserva el foco al repintar y actualiza el progreso sobre los mismos nodos.
El motor sigue siendo dueño de síntesis, cancelación y descargas. Referencia
JavaScript conservada como alternativa; no hay cambios en modelos ni voces.
79 estados DOM/foco exactos y 1000 renovaciones sin crecimiento de memoria.
62 pruebas existentes del catálogo ejecutadas con los dos motores de UI;
188/188 focales. E2E: 24/24 (voces, temas, teclado, cancelación, reintento,
eliminación, PDF/EPUB e invocación del Rust real de la app compilada), más el
formato FB2 y su comparación de detección. Fallos del prototipo preservados:
ruta Vite, conversión Number::from (era cast, no Number de JS); corregidos
antes de integrar y cubiertos con valores undefined/NaN/límites del progreso.

CI184 UI4 mostró setStylesImportant sobre null durante navegación FB2. La
protección del iframe retenido exige raíz y cuerpo antes de render/expand;
no cambia el documento terminado y reanuda el layout desde el load normal.
Prueba ejecuta métodos reales sobre cinco documentos incompletos y luego
sobre el completo; FB2 compilado vuelve a pasar, con errores JS vigilados.
Original CI184 preservado; no se oculta ese fallo ni los de cierre/resaltado.

Inventario: 4085 Rust / 36788 JavaScript, 9,99 % de líneas propias.
WASM UI local 186156 bytes, SHA256
b4bd1cfcf7ffcacec195a9e3eeac6f957ba9a0828d29e63856be1e44611e1f81.
Batería completa: 5005/5005 unitarias, 375 archivos, 351,20 s, dos workers.
App/decor y APK/updater sin cambios. Publicado dca2386; deploy 38253607607 y
Pages 38253734544 aprobados; Pages 323a15b. El entorno Pages mantuvo la tarea
en espera unos cinco minutos y continuó sin modificar políticas ni permisos.
Verificación pública: 189 checks, dos perfiles con bytes exactos, 30 casos
PCM/marcas, APK y loader reales. UI público 186140 bytes,
SHA256 1762b6f18edfd54332d9301a420848dec434edf6e07e8784721051d1559b3d0b.
Android API36 ejecuta 1.7.186 y Lessac a 2×, 10,23 s, ocho unidades terminadas,
proceso estable y sin FATAL EXCEPTION. Evidencia published-1791811003222,
public-*.log y native-ui186.json. FB2 y catálogo Rust en web pública: 2/2
aprobados, 11,6 s. CI186 completa sigue en curso.
Evidencia: D:/CodexEvidence/InhouseRead-20261012/rust-neural-view-prototype.

# 1.7.185 — índice y listas del lector en Rust

Changelog: «Índice y marcadores en Rust».
RustReaderLists construye índice, historial, marcadores, citas y resultados de
búsqueda. Conserva referencias originales en las pulsaciones y elimina cada
listener al renovar/liberar su lista, incluso cuando un clic la reemplaza.
Navegación, anotaciones y persistencia mantienen su orden en ReaderExperience.
Alternativa JS conservada cuando el módulo UI no está disponible.

4973/4973 unitarias en 375 archivos, 392,60 s, dos workers. Focales 121/121;
17 comparaciones exactas DOM/eventos, profundidad del índice, búsqueda con
caracteres especiales y valores nulos, referencias y liberación de eventos.
1000 renovaciones de las listas sin crecer la memoria WASM. E2E: siete focales
aprobadas (cinco del panel, dos de listas), 30 regresiones y seis omisiones
originales. El primer recorrido focal conserva un fallo del selector nuevo:
una tilde se escribió en Windows-1252; corregido a UTF-8, dos casos pasan en
7,3 s. No cambió la app para resolver ese fallo de la prueba.

Inventario: 3999 Rust / 36765 JavaScript, 9,81 % del código propio contado.
WASM UI local: 162854 bytes, SHA256
c5234273df52b6ea56d7d7164f5cef0c5bc5499a84aec9ca8525673bd4053abd.
App/decor, APK y updater sin cambios. Publicado 0c64e4b; deploy 38252080876 y
Pages 38252244066 aprobados, rama Pages 19ef761. Verificación pública: 183
comprobaciones correctas, dos perfiles con bytes exactos, índice/marcadores/
búsqueda Rust reales en móvil 1/1 (7,4 s), PCM/marcas 30/30, APK y loader reales.
UI público 162838 bytes, SHA256
f7c6785731e8353d1dc248ef53d8f3a817896f1acc91a774e743b542526df895.
Evidencia pública: published-1791809937203 y public-*.log. CI185 sigue en curso.
Evidencia: D:/CodexEvidence/InhouseRead-20261012/rust-reader-lists-prototype.
CI184: unitarias y primeras pruebas de voces aprobadas. UI4 ha registrado un
error al importar FB2: Foliate setStyles recibe un elemento null. El original
se conserva en rust-reader-panel-prototype/ci184-ui4-original.log; pendiente
investigar junto con los tres fallos originales de cierre/resaltado CI183.

# 1.7.184 — paneles del lector en Rust

Changelog: «Paneles del lector en Rust».
RustReaderView actualiza pestañas, temas, controles de preferencias, marcador,
retorno y minirreproductor sobre el DOM existente. No modifica paginación ni
cursores de audio. Reutiliza nodos y grupos estáticos; evita escrituras de
preferencias que no han cambiado, restaurando el tema de la cabecera compartida
al reabrir. Sólo interna cadenas finitas de API/plantilla, nunca texto del libro.
Los setters del host propagan errores sin dejar prestada la instancia Rust.
Bindings generados excluidos del inventario; alternativa JS ante fallo de carga.

138/138 focales. 200 estados DOM exactos; cuatro regresiones de preferencias,
formato, liberación y excepción del navegador. Prueba de 230 diálogos completos
sin crecimiento de memoria: el primer recorrido completo agotó sus 5 s bajo
carga concurrente (4967/4968 aprobadas); se conserva ese fallo y los 230 ciclos,
con límite de 15 s sólo para ese estrés de liberación, no de latencia de UI.
E2E: cinco nuevos aprobados, más 30 regresiones y seis omisiones originales.
CPU limitada 4×, 100 cambios: incremental JS 26,5 / Rust 18,5 ms; cambiando
cada ajuste JS 30,0 / Rust 34,6 ms. Mejora el caso incremental; no se afirma
aceleración universal. Memoria WASM estable en 393216 bytes. Intentos previos
y fallos de desarrollo conservados en rust-reader-panel-prototype.

Inventario: 3914 Rust / 36776 JavaScript, 9,62 % de líneas propias, no funciones.
WASM UI local 140174 bytes, SHA256
a4fc5160911c6cbf2dda0d51b8ea88416594cbb05fb997629e8b7c6cda888d9c.
Batería final: 4968/4968, 374 archivos, 318,85 s (dos workers).
App/decor y APK/updater sin cambios. Publicado ab55259, deploy 38251050544 y
Pages 38251187148 aprobados; rama Pages 7e916a1. Verificación real: 178 checks,
dos perfiles nuevos con bytes exactos, UI móvil compilada 1/1 y 30 casos de
PCM/marcas correctos. WASM UI público: 140158 bytes,
SHA256 a11bf5ed188838bfc13ea10553f7ffd08e562d9f70c0c2b71985374b99882a31.
APK 1.1.15/28 descargado y loader de 2107 bytes comprobado; Android API36 abre
la web 1.7.184, reproduce Lessac a 2× (10,23 s, siete unidades terminadas),
mantiene el proceso y no registra FATAL EXCEPTION. Primer intento de captura
UI encontró la raíz todavía vacía; reintento nativo previsto completó la prueba.
Evidencia pública published-1791809341382 y public-*.log / native-ui184.json.
CI184 completa sigue en curso; los tres fallos originales CI183 no se dan por resueltos.
Evidencia: D:/CodexEvidence/InhouseRead-20261012/rust-reader-panel-prototype.

# 1.7.183 — menús del lector en Rust

Changelog: «Menús del lector en Rust».
SelectMenu ejecuta creación DOM, estado, selección, teclado, foco, ARIA y
eventos dentro de rust-ui con wasm-bindgen/web-sys. Una sola implementación
por sesión evita registros de menús e identificadores mezclados. El host
carga el módulo con el lector; ante error/espera mayor de 2 s conserva los
controles anteriores. Los listeners se eliminan al liberar cada componente.
Bindings generados fuera del inventario, dependencias y CLI fijados; descarga
de la CLI comprobada por tamaño/SHA. Licencias incluidas en la web offline.

4908/4908 unitarias, 373 archivos, 292,81 s, dos workers. Primer recorrido:
4906/4908; conserva ambos fallos. Uno mostró que la fixture de persistencia
esperaba la instancia del test anterior: ahora reinicia esa referencia antes
de esperar al nuevo lector. Otro agotó 5 s bajo carga concurrente en el caso
grande del relieve: se conserva el límite; 44/44 focales y batería completa
posterior pasan. No se atribuye ese timeout a una causa única sin perfilado.
E2E compilados: 30 aprobadas y seis omisiones originales (4,3 min), con
igualdad exacta DOM/foco/ARIA/eventos, cambio reentrante y 1000 ciclos sin
crecimiento de memoria. La app móvil compilada acredita dos menús reales
creados y actualizados mediante exports Rust.

CI182: sus seis grupos UI fallaron antes de ejecutarse porque los imports de
la paleta llegaban al WASM aún no compilado durante --list. Originales en
rust-reader-preferences/ci-job-*-original.log. Paleta estática separada sin
cambiar valores ni exports públicos; una copia limpia sin WASM descubre las
486 pruebas. No se omiten casos ni se rebajan aserciones. Los tres fallos de
cierre/resaltado de CI180 permanecen pendientes.

WASM UI local: 39693 bytes; SHA256
cacac2f04c9dc324c751adfddd43f2f9b4fa6cead4d35db12a5d9b166b36951b.
Los paths de panic de las dependencias pueden cambiar entre plataformas;
la comprobación pública validará contra los bytes construidos en Pages.
Núcleos app/decor sin cambios. Inventario: 3778 líneas Rust / 36731 JS,
9,33 % del código propio contado; no porcentaje funcional. Evidencia:
D:/CodexEvidence/InhouseRead-20261012/rust-ui-prototype.
Publicado en main a5ec582; deploy 38247444840 y Pages 38247549716 aprobados.
Pages cc060d1. Verificación pública: 171 comprobaciones correctas, dos perfiles
nuevos con bytes exactos, menú Rust real en la web móvil (1/1, 7,6 s), 30/30
casos PCM/marcas y APK 1.1.15/28 real con loader de 2107 bytes. Módulo UI de
Linux: 39681 bytes, SHA aee789f1cd8d3205ea5b0fa91a24b15250aec2d2b0773007d4913d4b620f05b1.
Evidencia: published-1791807254326 y rust-ui-prototype/public-*.log. El intento
anterior antes de terminar Pages conserva sus 404 en published-1791807170443.
APK/updater sin cambios. CI183 terminó con fallo: cinco de seis grupos UI,
unitarias y los cuatro grupos de voces aprobados; grupo UI2 conserva los tres
fallos originales de cierre/resaltado descritos arriba. Log original preservado.

Siguiente bloque en rust-reader-panel-prototype: pestañas, minirreproductor,
temas, marcadores y retorno del lector. Compila y pasa 100 comparaciones
exactas DOM/estado frente al original; todavía fuera de producción.

# 1.7.182 — preferencias y CSS de lectura en Rust

Changelog: «Preferencias del lector en Rust».
Normalización de valores numéricos, velocidades y generación del estilo en
reader_preferences/reader_nearest_rate/reader_css. Se mantienen DOM, selección
de voces y persistencia en el host. Estilos decodificados reutilizados, límite
de 64 por instancia del núcleo, sin conservar documentos ni nodos del libro.
1000 combinaciones de CSS comparadas carácter a carácter con el original;
límites, coerciones, valores inválidos, empates de velocidad y arena estable.
69 pruebas focales (68 iniciales más una de expulsión de caché).
Batería anterior a la caché: 4890/4890. Final: 4891/4891, 371 archivos,
349,46 s; logs y JSON de ambas conservados. E2E finales: 30 aprobadas,
seis omisiones propias de las condiciones de los casos, cero fallos (3,6 min).
Incluyen temas, texto adaptable, audio, pausas, navegación independiente,
controles inferiores, persistencia y comparación de párrafos/estilos del
EPUB compilado en perfiles móvil originales frente a Rust.
La primera medida detectó sobrecoste (JS 0,3275 ms / Rust 0,3850 ms, CPU×4).
Tras reutilizar estilos: 0,3925/0,3775 ms. La dispersión no permite afirmar
aceleración significativa; sí se eliminan formatos/copias repetidos (1001
solicitudes, 24 CSS generados en la prueba de reutilización).
WASM app 378694 bytes, SHA256
7b1433e2787d7449efa460af8fd1a89e362350e57f97fc22b91332d333d03436.
Evidencia: D:/CodexEvidence/InhouseRead-20261012/rust-reader-preferences.
Publicado en main 4a091ef, deploy 38245340679 aprobado y Pages eb3ffa0.
Verificación pública: 160 comprobaciones correctas de archivos, SHA, exports,
catálogos y APK; dos perfiles nuevos (móvil y escritorio) cargan los bytes
exactos sin errores; EPUB público con párrafos y controles idénticos (1/1,
11,6 s). WASM público: 30/30 comparaciones PCM/marcas. APK real 1.1.15/28
descargado, SHA validado y loader de 2107 bytes confirmado. Evidencia pública:
published-1791806090401 y rust-reader-preferences/public-*.log.
APK, firma, updater y voces no cambian. Los tres fallos de CI180 de
cierre/resaltado siguen pendientes; esta verificación no los da por resueltos.

Siguiente bloque ya prototipado fuera del repo: rust-ui-prototype contiene
SelectMenu completo en Rust con wasm-bindgen/web-sys, misma estructura DOM,
teclado, foco, eventos, cambio reentrante y 1000 creaciones/liberaciones con
memoria estable. No está integrado ni publicado aún. CLI wasm-bindgen
0.2.104 y dependencias fijadas en Cargo.lock; Windows requiere host GNU
(instalado en D:/InhouseRead-Rust), porque no hay linker MSVC. Hay logs
originales del fallo MSVC y de dos errores de tipos corregidos del prototipo.

# 1.7.181 — cabeceras de libros en Rust

Changelog: «Reconocimiento de archivos en Rust».
Se integra sniff_book_format para PalmDOC/MOBI, FB2 y cabeceras desconocidas,
con lectura/copia máxima de 200 bytes. Se conservan extensión, prioridad,
motor y fallback original. Los prefijos PDF/ZIP mantienen su camino directo,
más barato que cruzar a WASM. Sin asignaciones internas en el kernel.
18/18 focales; 4000 cabeceras generadas comparadas con el original congelado,
firmas parciales, vistas desplazadas, memoria estable y lectura limitada Blob.
2/2 E2E: benchmark completo CPU×4 y FB2 importado en la app compilada móvil,
con ambos párrafos visibles y uso del kernel comprobado. Nueve rondas:
MOBI 1,58→0,56 µs, FB2 4,92→0,70 µs, desconocido 29,78→1,40 µs.
PDF/ZIP ~0,08 µs; memoria estable. No implica acelerar por esos factores
la apertura del libro: solo la clasificación de la cabecera.
WASM 351121 bytes, SHA256
0a5165f43b2d3ac27eca3e544e9183630856e80d24c2dd5c60f1b696ccbe0eb9.
Evidencia: D:/CodexEvidence/InhouseRead-20261012/rust-book-format.
Batería completa: 4885/4885, 370 archivos, 291,43 s. Build aprobado.
Publicado en main 7c4deeb; deploy 38240695323 y Pages 38240783675 aprobados,
rama Pages 163328a. Verificación pública: 157 comprobaciones correctas de
HTTP/tamaño/SHA/exportaciones/catálogos/APK, dos perfiles nuevos móvil y
escritorio cargando el JS y ambos WASM exactos sin errores, FB2 importado
y leído en la web pública (1/1 E2E, 8,7 s). El WASM público conserva 30/30
comparaciones exactas de PCM y marcas. APK real descargada y loader de
2107 bytes comprobado otra vez. Evidencia published-1791803451805.
La primera consulta durante el despliegue recibió archivos antiguos/404;
se conserva en published-1791803373381 y public-before-pages-completed.log.
La consulta final se hizo después de completarse Pages, sin reemplazarla.
CI181 38240695019 sigue en curso. CI180 UI2 terminó con tres fallos:
native-aligned-shelf-return-contract y native-legacy-shelf-return-contract
siguen is-closing-reader al vencer 8 s; pdf-reflow-navigation encuentra
rectángulos de resaltado fuera de la caja visible. Se conserva el log entero
en audio-rate/ci-180-ui2-original.log, incluidos ambos intentos originales.
Estos fallos de cierre/resaltado quedan pendientes; ni el tempo ni este port
se presentan como una corrección de ellos. Las suites reales engine,
reading y languages de CI180 sí aprobaron; el resto no se da por verde.
Audio, decoración, APK, firma, updater y catálogos sin modificaciones.

# 1.7.180 — frases completas a velocidades altas

Changelog: «Evita palabras omitidas al acelerar voces».
Reproducción con pesos reales: Supertonic F1/M1, español y neerlandés,
a 1/1,25/1,5/2×. Los 16 casos anteriores consumían todo su PCM antes de
emitir done, pero a 2× las grabaciones omitían palabras. Ejemplo F1 español:
«debajo de la mesa» y «con su hermano pequeño» desaparecían. No era un
reloj de reproducción que avanzase antes: la generación comprimida ya
producía una frase incompleta. Se conservan las WAV originales.

Supertonic conserva ahora todos los frames de la predicción normal. Piper
conserva el length_scale normal por encima de 1×. Después se acelera el PCM
completo mediante speech_tempo, adaptación Rust de Sonic/PICOLA (Apache-2.0),
sin resampling ni cambio de tono. Los límites de página se transforman con
las operaciones reales de audio. La cola continúa usando muestras reproducidas;
no hay temporizadores basados en texto ni una segunda división por velocidad.
A 1× y velocidades lentas se conserva la ruta anterior. El fallback JS aplica
el mismo algoritmo cuando el núcleo está frío o es antiguo. Scratch acotado,
un arena liberada por fragmento y sin asignaciones dentro del kernel.

71/71 pruebas focales; comparación exacta Rust/JS de todos los samples y
marcas, pitch con cruces por cero, ruido, silencio, consonante final, crecimiento
de memoria y argumentos inválidos. 16/16 pruebas reales Supertonic (4,8 min),
6/6 Piper español/inglés con dos frases consecutivas (1,5 min), 16/16 recorridos
de seguimiento PDF/EPUB y continuidad entre capítulos (1,9 min).
La transcripción independiente local con Whisper small de las cuatro voces a
2× pasa de errores 45/5/40/30% a 0/0/0/0% respecto al texto esperado. Es una
comprobación automática de estas frases, no una certificación de cada voz/texto.
Audio y JSON íntegros: D:/CodexEvidence/InhouseRead-20261012/audio-rate.

Medida CPU de esta máquina, siete rondas alternadas, copias incluidas: 5 s de
PCM a 2×, 11,80→4,64 ms; 30 s, 79,95→32,66 ms. No es latencia de generación
ni una medida del teléfono. La generación a velocidad normal puede necesitar
más cálculo que la anterior generación comprimida, que perdía palabras.
App WASM 350219 bytes, SHA256
6527f60788f7dd00baec576b7d7fe7ec5121d08bd31a5716895699930ab9f001.
Decoración, paquete Android, firma, updater y modelos sin cambios.

Primera batería: 4879 aprobadas, un fallo en el arnés VM hebreo: eliminaba
los imports y no inyectaba las nuevas funciones de tempo. Se añaden las
funciones reales al arnés; se conserva unit-full.log/json sin reemplazarlo.
Batería final: 4880/4880, 369 archivos, 313,95 s. Publicación 36b814c;
Pages 21ac2a5, deploy 38238360348 y Pages 38238444241 completados.
156 comprobaciones de HTTP/tamaño/SHA correctas sobre el despliegue real,
dos perfiles nuevos móvil/escritorio sin errores y 30 comparaciones de PCM
y marcas contra el WASM público. Evidencia: published-1791802112806.
APK descargada 1.1.15/28, SHA256
02960e3322bdad2e26041d2ef57b0fd5a02f3528c4b60b876e7955ae941cafb5:
loader de 2107 bytes, paquete/firma y catálogos sin cambios.
La APK real mostró v1.7.180 y reprodujo Lessac en Android API36 a
1,25/1,5/2×: 11,88/11,17/10,35 segundos acumulados observados, 5/5/7
frases completas, mismo proceso 4685, sin FATAL EXCEPTION; capturas
confirman la velocidad seleccionada. native-rate.json/log y logcat íntegro.
Se conservan intentos fallidos: dos cierres del proceso QEMU con SwiftShader
(0xc0000005), arranque UI/decodificación del arnés y una condición del arnés
que exigía 10 segundos en un solo epoch aunque al cambiar página se reinicia
ese contador. La prueba final suma máximos por epoch de la misma sesión.
El emulador con GPU host/Vulkan desactivado completó las tres velocidades.
CI 38238360303 todavía en curso: unitarias, neural engine/reading/languages
y UI4/5 aprobadas a la consulta; no se declara toda la CI verde. Los fallos
anteriores de CI178 (UI2/UI3) siguen conservados.

# 1.7.179 — sombras de contacto en Rust

Changelog: «Acelera sombras de la estantería».
La geometría de las sombras del mueble y la papelera, y del halo de luz del
suelo, se genera en shelf_occlusion. Conserva exactamente posiciones, RGBA,
triángulos y límites; la escena, materiales y resolución no cambian.
El host conserva los80valores trigonométricos originales y entrega arrays
propios a Three. Una asignación limitada, sin arrays temporales por triángulo;
ante fallo o núcleo anterior se conserva el generador JavaScript.
El nuevo WASM de app ocupa347129bytes, SHA384ee25be7d7273e353f5bb6b27117e137f5fdb0e404c1f1c7438e0ff2ea00c5.
Decoración mantiene sus bytes y caché. Updater y APK sin modificaciones.

34/34 pruebas focales, incluyendo200combinaciones exactas de geometría,
escalas, dimensiones fraccionarias y entradas inválidas. Pruebas de crecimiento
de memoria, salidas independientes y recuperación incluidas. Benchmark real
en Chromium CPU×4, nueve rondas alternadas con copias y límites Three incluidos:
tres baldas iluminadas1,235→0,485ms; cien baldas iluminadas7,790→3,535ms.
Capacidad WASM estable después del calentamiento en los seis escenarios.
No son medidas del render GPU ni una mejora global del teléfono.
3/3 escenarios del build aprobados en48,1s: imagen completa idéntica con/sin
el kernel, con/sin lámpara, y luz cálida visible en nogal y BAGGEBO.
Primera batería completa:4844 aprobadas y un timeout en la comparación de
150casos de la prueba nueva. Se conserva unit.log/json. La aserción hacía una
comparación profunda de cada propiedad de Buffer; ahora Buffer.equals compara
los mismos bytes completos, sin ampliar plazos ni retirar casos. Batería
completa final: 4845/4845 aprobadas, 368 archivos, 291,76 s. Publicación 179 verificada: 153 comprobaciones HTTP/tamaño/SHA, dos perfiles nuevos de navegador, 2/2 pruebas visuales contra el WASM publicado y APK real descargada con loader de 2107 bytes.
Commit 0ba2385; Deploy 38236168477 y Pages 38236244623 completados.
Evidencia pública: D:/CodexEvidence/InhouseRead-20261012/published-1791800893734.
Evidencia: D:/CodexEvidence/InhouseRead-20261012/rust-shelf-occlusion.
El CI177 conserva seis fallos del grupo UI3, reproducidos localmente sin
cambiar código: las pruebas aún exigían audio/retorno arriba y ocultaban Stop
en móvil compacto. Se actualiza ese contrato a la petición del usuario:
fila inferior de44px, controles táctiles completos y sin solaparse con texto.
Se conserva before.log/json en reader-bottom-contract. Tras corregir el contrato, 10/10 aprobadas en 1,2 min (after.log/json). No cambia la UI.

# 1.7.178 — recortes de imágenes PDF en Rust

Changelog: «Acelera recortes de imágenes PDF».
Se restaura la migración aplazada para atender el cierre de Android177.
pdf_image_paths calcula los cuatro vértices y el sentido de cada imagen;
el navegador conserva sus operaciones Canvas y sus píxeles originales.
La ruta Rust se usa desde ocho imágenes; páginas pequeñas y núcleos antiguos
mantienen el algoritmo anterior. No cambia el color, la composición ni el audio.
No se modifica el updater ni la APK que carga la web de producción.

Comparación CPU×4, nueve rondas alternadas, transferencia y llamadas Canvas
incluidas (sin medir pintura GPU): 512 imágenes 1,104→0,152ms; 2048 imágenes
4,428→0,553ms. No son tiempos de apertura ni del lector completo.
Se comparan coordenadas f64 exactas y 12800000 bytes RGBA sin diferencias,
incluyendo imágenes reflejadas, giradas, superpuestas y entradas inválidas.
14/14 recorridos UI del build178 aprobados en55,6s, incluyendo cuatro temas
con el export Rust real frente a la alternativa anterior, en perfiles limpios.
4836/4836 unitarias en367archivos aprobadas en291,18s, incluyendo las cinco
regresiones del cierre del audiolibro. Publicación verificada:
fuente d8bebbaa66373ef72ec8cb6da33e2cb53f9fb895, Pages
94c2aa72fbadea6bc246b02508c1a69f5ec9aca3. Deploy38234294188 y
Pages38234389800 aprobados. 152 comprobaciones públicas correctas; núcleo
descargado comparado en64casos/19197632bytes sin diferencias. Dos perfiles
limpios reciben main y ambos WASM exactos. 4/4 escenarios PDF de la web pública
aprobados en34,6s. APK pública descargada, SHA02960e3322bdad2e26041d2ef57b0fd5a02f3528c4b60b876e7955ae941cafb5,
loader exclusivo de2107bytes hacia producción; conserva code28 y no requiere
reinstalar para recibir esta parte web. Evidencia: published-1791799809378.
CI completo38234294626 en curso: no se declara resuelta toda la batería UI.
Evidencia: D:/CodexEvidence/InhouseRead-20261012/rust-pdf-paths.
Se conserva íntegro el arreglo177 y los fallos previos de CI siguen registrados.

# 1.7.177 — cierre de Android al pulsar Play

Changelog: «Corrige cierre al reanudar audiolibro».
Reproducido en la APK pública 1.1.15/code28, Android 16, web176:
reproducir Lessac, detener, cambiar de capítulo, volver a pulsar Play.
Android mata el proceso con ForegroundServiceDidNotStartInTimeException.
El log señala NativePcmBridge.begin: ReadingVoice desbloqueaba una sesión
nativa antes de llamar a Stop para reiniciar desde la página visible.
Ahora se retira primero la posición anterior y se abre después la sesión,
todavía dentro de la pulsación y antes del primer await. No cambia la voz,
la frase inicial ni los controles. Play repetido durante carga no abre servicios.

Las cinco regresiones nuevas fallan contra176 y pasan con el arreglo.
52/52 pruebas focales aprobadas y build de producción correcto.
4824/4824 unitarias en 366 archivos (327,75 s) y 13/13 recorridos UI (1,1 min).
Publicación verificada: fuente 5ff954b929b4993077fb579199e66cbb65fdde99,
Pages 11224d6e974e27937a293543c2c1f99358c2342e. Deploy38232699037 y
Pages38232784123 aprobados. 151 comprobaciones HTTP/tamaño/SHA correctas,
dos perfiles limpios con main y ambos WASM exactos. APK del catálogo descargada:
SHA02960e3322bdad2e26041d2ef57b0fd5a02f3528c4b60b876e7955ae941cafb5;
loader de2107bytes, code28. Evidencia: published-1791798905819.

APK real sin modificar, Android16/API36, WebView133: el menú muestra1.7.177.
Lessac descargada desde la UI, síntesis nativa real y AudioTrack: inicio,
Stop→otra página→Play, Pause→otra página→Play y repetición Stop→otra página→Play.
Las cuatro sesiones reproducen más de8s; el proceso6343 permanece vivo.
Ningún FATAL ni ForegroundServiceDidNotStartInTimeException en la captura final.
Se conserva el crash original del proceso2530 en crash-original-full.log.
Hubo una captura inicial de accesibilidad sin raíz; el helper la repitió y
continuó, sin reiniciar ni modificar la aplicación. native-regression.json
registra los cuatro casos. El CI completo38232698933 sigue en curso;
no se declara resuelto el resto de los fallos de CI anteriores.
Evidencia original y pruebas: D:/CodexEvidence/InhouseRead-20261012/audio-play-crash.
La migración PDF pendiente se conserva en rust-pdf-paths/unpublished-migration.patch
más rust-pdf-paths/pending. Se restaura localmente tras verificar177;
no forma parte de este arreglo urgente.
No se modifica el updater ni la parte nativa. La APK actual carga este arreglo web.
Los fallos previos de CI indicados abajo siguen pendientes de revisión.

# Verificación pública 1.7.176 completada

Fuente:67c46715a02b6a0297ec97aa97a5d319b9b2c077.
Pages:56213352d885906995703146b952e7c74e81547c.
Deploy38227760138 y Pages38227884822 aprobados. 151comprobaciones públicas
correctas:101recursos con sus hashes, HTML, main, ambos WASM y precargas.
Núcleo descargado:112casos/22591616bytes iguales a la referencia JS congelada.
Dos perfiles limpios reciben main y ambos WASM exactos, sin errores de página.
2/2 escenarios de editor público en43,7s, sin reintentos ni omisiones, usando
el kernel seleccionado real y comparando sus bytes con el empaquetado anterior.
APK del catálogo descargada:78532517bytes, code28, SHA
02960e3322bdad2e26041d2ef57b0fd5a02f3528c4b60b876e7955ae941cafb5.
Loader exclusivo de2107bytes hacia producción; no se crea otra APK sin cambios
nativos. Se conservan identidad, firma, canal y revisión compartida del updater.
Evidencia:D:/CodexEvidence/InhouseRead-20261012/published-1791796168559
y rust-normal-selection/public-ui.log/json/results.
El CI completo de esta fuente38227760199 sigue en curso. Los fallos de175 se
conservan y detallan abajo; no se declara CI verde ni la migración total terminada.
La actualización documental no modifica el código de producción verificado.

# Versión 1.7.176 — normales del relieve con selección en Rust

4819/4819 unitarias en366archivos,305,63s. Núcleo compilado:112casos,
22591616bytes iguales a la referencia independiente. El editor compilado pasa
2/2 escenarios en41,2s; compara cada bloque real y abre con selección fría/cacheada.
8/8 pruebas visuales finales (1,6min), sin reintentos ni omisiones: relieves
independientes, estantería, dieciocho portadas, color y tres acabados, coste GPU
y editor real. Publicación y comprobación pública completadas abajo.

Changelog: «Relieves en Rust con menos copias».
La selección alfa se integra en el cálculo de normales. El modelo consume la
salida directamente, conservando colores, reflejos, resolución y cesión por filas.
App WASM 326337 bytes, SHA 33480e1224dd709007491dd2c48a046570e4e434c9bda9d8bea3a470839eb7c3.
Decoración conserva SHA 3859b666df84bf9c8c7962ba4fbbbc3723ca35e5e3484b358a4cd18407d1b5f9.
Sin cambios de Android ni del updater; APK vigente 1.1.15/code28.
Evidencia: D:/CodexEvidence/InhouseRead-20261012/rust-normal-selection.
Medición CPU×4: 512² con máscara 45,32→35,66ms, sin máscara 70,80→46,56ms.
Una copia RGBA menos (1MiB a 512²); no se extrapola al rendimiento global.

El CI completo175 ya terminó con fallos (38218315825). Se conservan
ci175-jobs.json y ci175-failed.log sin cancelar ni sobrescribir los originales.
Unitarias, cuatro suites de voces reales y UI1/4/5 aprobaron. UI3: seis fallos
entre reader-interface compacto, cuatro reader-layout y AMOLED. UI2: regresos
nativos alineado/legacy y continuidad PDF; además lamp-switches fue inestable.
UI6: la retirada de libro detectó enlaces de shader. No se declara CI verde ni
se atribuyen todos estos fallos a la infraestructura. Requieren revisión aparte.
El primer intento de la nueva prueba de editor pulsa el input cubierto por su
preview y agota120s. Se conserva ui.log/json/results; se corrige para pulsar
la tarjeta visible y añadir un segundo color en la reapertura.
La prueba visual amplia también quedó bloqueada durante la navegación con el
servidor Vite explorando/optimizando dependencias (node del worker con CPU y
memoria crecientes). Se conserva ui-final.log y su timeout de180s con traza;
se terminó la ejecución repetida para corregir la fixture. Ahora desactiva la
exploración automática y la observación del disco, como las fixtures de Rust.
La prueba aislada de brillo en estantería pasa en6,2s sin cambiar sus aserciones.
La suite visual completa se repite en visual-final.log/json/results.


# Verificación pública 1.7.175 completada

Fuente:f814b5b47013494bebb546d77a74087ec4cf76df.
Pages:cd42333d6a450dea0d30b81845461eb8305d1f81.
Deploy38218315784 y Pages38218393338 aprobados.150comprobaciones de artefacto:
101recursos,HTML,main,ambos WASM y precargas coinciden con los bytes publicados.
42casos/6850692bytes del núcleo descargado iguales a la referencia.
6/6 UI públicas,33,7s,sin reintentos ni omisiones:el análisis de portada invoca
los kernels reales y guarda la misma apariencia;retorno inferior a320/390px;
Play tras Pausa/Stop y cambio de página en PDF/EPUB lee una frase completa visible.
Main+ambos WASM exactos en dos perfiles limpios. APK1.1.15/code28 descargado,
hash de catálogo confirmado y loader2107bytes exclusivo hacia producción.
Sin cambios nativos ni nuevos artefactos de Android; canales/identidad intactos.
Evidencia:D:/CodexEvidence/InhouseRead-20261012/published-1791790506117 y rust-cover-startup.
4807/4807 suite unitaria existente más1/1 nueva de disponibilidad. El CI completo
38218315825 sigue ejecutándose; no se afirma que hayan desaparecido los fallos
anteriores del cierre nativo ni que toda la app esté migrada a Rust.
Esta actualización documental no cambia los archivos de producción ya verificados.

# Versión 1.7.175 — disponibilidad de Rust al analizar la portada

Changelog: «Aprovecha Rust tras cargar las fuentes».
La preparación numérica espera ahora en el punto de carga de fuentes que ya
existía, antes de elegir Rust o su alternativa. No se añade una espera ni se
bloquea el arranque de la estantería. Mantiene la alternativa si no hay núcleo.
La comprobación pública174 descubrió que la primera portada aún podía elegir
JS mientras llegaba la dependencia; la comprobación de invocación falló y se
conserva en reader-bottom-controls/public-ui.log/json/results. Los cinco casos
del audiolibro sí pasaron en producción:retorno inferior y Pausa/Stop en PDF/EPUB.
Los bytes del nuevo núcleo ya eran los correctos,42casos/6850692bytes exactos.

174 desplegada:fuente2b333da52ad2c53fa19aa0b13c8484e5deb70214,
Pages435412bcfb9c13414a11c1b3ab64629e1e855c30. Deploy38217249421 y
Pages38217321745 aprobados.101recursos/HTML/ambas precargas exactos,
150comprobaciones del artefacto. Main+ambos WASM en dos perfiles limpios.
APK1.1.15/code28 descargado y comprobado,loader2107bytes. No cambio nativo.
Evidencia:published-1791789818202. La consulta inicial mientras Pages seguía
desplegando recibió manifiesto anterior/404 y se conserva en
published-1791789791393; se repitió después de completar Pages, sin esos fallos.

175 no cambia los binarios WASM ni la caché de decoración.6/6 UI locales,32,5s,
sin reintentos ni omisiones. Prueba nueva1/1:el núcleo llega durante la espera
de fuentes y se elige después de ella, sin añadir temporizadores. 4807/4807 pruebas de la suite existente,364archivos,289,81s,
más1/1 nueva focalizada (creada después de iniciar la suite). Publicación pendiente; evidencia:rust-cover-startup. La migración completa sigue pendiente.

# Versión 1.7.174 — controles abajo y preparación de portadas en Rust

Changelog: «Controles abajo; análisis de portada optimizado».
El minirreproductor y el retorno al audio o capítulo comparten una fila inferior,
encima de la navegación. El título permanece visible arriba. Pausa y detener
conservan objetivos de 44px incluso a 320px. La fila tiene una altura estable de
44px también sin audio: iniciar/detener o mostrar retorno no repagina el libro.
El modo de lectura sin controles oculta también esta fila.

Pausa/Stop y cambio de página: Play reconstruye el inicio desde la página
visible, omitiendo la frase empezada en la anterior. Sin cambio de página,
Pausa conserva la frase. La navegación con el audio activo mantiene su cursor
independiente. PDF consulta el texto anterior sólo en esa apertura para reconocer
una continuación; EPUB conserva los offsets del capítulo. Una página sin ningún
inicio de frase se explica sin atribuirlo a un fallo de OCR.
102/102 pruebas focalizadas de voz/texto/páginas diferidas aprobadas; siete
nuevas más una comprobación del contexto entre páginas PDF. 16/16 UI de
controles/estabilidad aprobadas en2,3min; las seis capturas optativas no activadas
constan como omitidas.4/4 UI adicionales,21,5s:reanudar PDF/EPUB,pantalla320/390
y análisis completo de portada invocando ambos kernels Rust. Captura320 revisada.


Rust prepara la escala de grises, tolerancia de bordes y clasificación visual
sin cambiar los colores de portada ni la fuente elegida. La imagen original
permanece intacta; los dos planos devueltos son independientes de memoria WASM.
Se mantienen las alternativas anteriores ante fallos del núcleo y para imágenes
menores de 4096 píxeles, donde la transferencia cuesta más que el cálculo.
96/96 pruebas focalizadas aprobadas, incluidas 15 nuevas de preparación y una
de ubicación del reproductor. Se compararon los 16777216 colores RGB posibles,
NaN de los bordes, clasificación, memoria, errores y liberación.

Benchmark CPU×4, nueve rondas alternadas, transferencias incluidas, 1/1 aprobado:
80×66 JS 0,693 → Rust 0,440ms; 128×192 3,027 → 1,907ms;
192×288 6,937 → 4,287ms. Sin bordes 192×288: 2,723 → 2,717ms.
512² (fuera del tamaño de producción): 31,907 → 20,100ms.
Los casos 1×1 y 12×12 empeoraban, por eso el host conserva su ruta anterior.
No se presentan estas cifras como tiempos completos de apertura o FPS.
App325789bytes,SHA c81386001ac06a2c567234fd4af3c19cf80f87467d68da98748f4e8bbfdd92cd.
Decor92543bytes,idéntico a172/173. Evidencia:rust-cover-preparation y reader-bottom-controls.
Build y pin del updater aprobados.4807/4807 unitarias,364archivos,290,44s. 11/11 UI finales,41,2s,sin omisiones ni reintentos:reanudar después de Pausa y Stop en PDF/EPUB,retorno inferior,análisis de portada real yarranque/fallo de ambos núcleos. Publicación174 pendiente.

Verificación pública173 completada: fuente071466961bad85b00883a47d35432a70a84027c9,
Pagesb14ea58618d94e7aa013680adc490fc55a9e42b1; deploy38215284711 y Pages38215360915 aprobados.
101recursos,HTML y ambas precargas exactos. Núcleo real:42casos/7394144bytes.
1/1 análisis de portada en la web publicada,9s,misma apariencia que el original.
Dos perfiles limpios descargaron los bytes exactos de main y ambos WASM.
APK1.1.15/code28 descargado,hash y loader2107bytes verificados.
Evidencia:published-1791788873423. Siguen sin declararse resueltos los fallos
previos de cierre nativo de CI; no se cambian sus plazos ni aserciones.

# Migración 1.7.173 — recorte de letras de portada en Rust

Changelog: «Máscaras de tipografía en Rust». Rust recorta el alfa del título,
cuenta el área y conserva exactamente los puntos de perímetro, relleno y fondo.
Dos recorridos permiten reservar sólo los puntos finales (máximo1280), sin
los tres buffers completos de candidatos. El host conserva Canvas, carga de
fuentes y objetos de salida independientes. Vacío válido se distingue de fallo;
la importación autocontenida por data: conserva su alternativa anterior.

59/59 focalizadas,3,85s;14nuevas. Tamaños degenerados,umbrales99/100,muestreo,
1024²,stride65535,crecimiento de memoria,liberación y ruta real del analizador.
El primer E2E falló esperando la fixture:su enlace CSS duplicaba /inhouse-read/
y recibió HTML en vez de las fuentes. Browser.log/json/traza originales
conservados. Se corrigió sólo la ruta; no se relajaron aserciones.
1/1 benchmark corregido,11,6s;18rasters de las seis fuentes reales,3tamaños,
CPU×4,nueve rondas alternadas de20operaciones,transferencias incluidas.
Rangos de medianas JS→Rust por máscara:
-80×66:0,165–0,200→0,100–0,145ms.
-192×176:0,740–0,940→0,685–0,850ms.
-384×352:2,530–3,215→2,205–2,910ms.
Todos los bytes, puntos, área y dimensiones idénticos; memoria estable tras
calentar. No se atribuyen estos tiempos al arranque entero ni a FPS móviles.
1/1 análisis completo de PNG,4,4s: invoca el núcleo real y conserva el color
y la familia tipográfica elegida por la implementación anterior.
Build/updater aprobados; manifiesto101recursos.4783/4783 unitarias,362archivos,288,71s.11/11 UI,52,2s,sin reintentos ni omisiones:estantería compilada que ejecuta y guarda el análisis real,fuentes tardías,colores,materiales yarranque de ambos núcleos. Publicación173 pendiente.
App323613bytes,SHA
`a58bf61a954f4b5ea86e5a57e11c9ad423573a41b561432e7fe864b29d45f1dd`.
La decoración sigue byte por byte idéntica a172 y conserva bake8733eaf4d8f2a2ba63c0.
Evidencia:D:/CodexEvidence/InhouseRead-20261012/rust-glyph-mask.

Publicación172:fuente957839b84631fa7193ca1191fc05a12983bddb11,
Pagese5d4b8c44770c20fbb0c79b087742dc412fc458c;deploy38213936141 y
Pages38214004809 aprobados.100recursos,HTML y ambas precargas exactos.
Núcleo público de decoración:21casos/2804808bytes idénticos; núcleo app:
36casos/350784bytes/comandos de trama idénticos. Main y ambos WASM exactos
en dos perfiles limpios. APK1.1.15/code28,hash yloader2107bytes verificados.
Evidencia:published-1791787673721.2/2 UI públicas de luces aprobadas.
Las5pruebas públicas iniciales de arranque abrieron por error la raíz del
usuario de GitHub en vez de /inhouse-read/ (trazas conservadas). El test ahora
navega con ./; repetidas5/5,15s,sin cambiar el plazo:un ejemplar por núcleo,
carga retenida o abortada de cada dominio y primer fotograma sin bloqueo.
Originales rust-decor-cache/public-ui.*,corregidas public-startup-fixed.*.

# Migración 1.7.172 — núcleo independiente de decoración

Changelog: «Conserva la caché de decoración». Plantas y texturas de lámparas
se compilan por separado del lector/libros/audio. El hash de la caché sigue
recorriendo todos los imports y bytes reales: ya no depende de módulos ajenos.
No se omitió ningún generador del hash. Memorias, propietarios, carga temprana
y reintentos independientes; validación de dominio además del ABI.

410/410 focalizadas,17,56s. 4769/4769 unitarias,361archivos,287,25s.
El laboratorio compiló una modificación real del libro y añadió un módulo:
cambió el núcleo de app, sin cambiar un byte de decoración. Otra compilación
modificó una lámpara: cambió decoración y conservó app. El test recorre el
grafo real, conserva el hash al modificar el núcleo ajeno y lo cambia al
modificar un byte del WASM de decoración. Resultados y fuentes del laboratorio
preservados en rust-decor-cache/lab e isolation-*.json.

Coste explícito:397024→414084bytes entre los dos WASM (+17060bytes).
Memoria lineal inicial:1114112bytes por instancia; ahora se cargan dos.
No se afirma reducir la memoria inicial ni los FPS. El beneficio es conservar
los bakes existentes en futuras migraciones ajenas a plantas/lámparas.
La primera versión con esta separación debe regenerar su caché una vez.
App321541bytes,SHA
`5bd44bc160111010f0c5bdb8278d22bdaebcf6d522b39af1ad15e02d8e6af4ad`.
Decor92543bytes,SHA
`3859b666df84bf9c8c7962ba4fbbbc3723ca35e5e3484b358a4cd18407d1b5f9`.
Build/updater aprobados; manifiesto100recursos.13/13 UI,3,1min,sin reintentos ni omisiones:arranque de cada núcleo,fallo/descarga lenta,PDF yEPUB offline,luces,catálogo yregreso nativo. 19/19 comparaciones de modelos y superficies,6,5min,CPU×4,atributos y mapas idénticos,0 asignaciones vivas al terminar. Publicación172 pendiente.
Evidencia:D:/CodexEvidence/InhouseRead-20261012/rust-decor-cache.

Publicación171:fuente487def7f765d22b3260fb555e38b3627cbdc745a,
Pages5df66ab8ed94551914794dca6b346d4afeb1703b; deploy38212373353 y
Pages38212437698 aprobados.99recursos/HTML/precarga exactos.36casos y350784
bytes/comandos de trama idénticos en el núcleo descargado.1/1 UI pública de
materiales,26,4s; main/WASM exactos en dos perfiles limpios.
APK1.1.15/code28,hash yloader2107bytes verificados.
Evidencia:published-1791786449546 y rust-book-cloth/public-*.
CI169 UI2:66correctas,2fallos previos de cierre,0flaky/omitidas; originales en
rust-relief-planes/ci169-ui2. No se han alterado plazos ni aserciones visuales.

# Migración 1.7.171 — trama de los libros en Rust

Changelog: «Trama de los libros en Rust». Rust prepara el campo de tinte y
los comandos de trama conservando el estado exacto del generador aleatorio.
Canvas ejecuta las mismas operaciones. Miniaturas y callbacks ajenos conservan
su ruta anterior. Salidas propias, memoria liberada y fallback sin consumir
el PRNG ante rechazo, falta de memoria o trap.

53/53 focalizadas; 17 nuevas. 4752/4752 unitarias en358 archivos,295,61s.
3/3 E2E de materiales y regreso nativo,59s,sin reintentos ni omisiones.
Canvas CPU×4: cuatro imágenes de4194304bytes idénticas y los siguientes
valores del PRNG idénticos. Capacidad estable1179648bytes tras calentar.
Plan aislado:0,144→0,132/0,143→0,132/0,057→0,056/0,165→0,140ms.
El dibujo completo tarda67–70ms y NO demuestra mejora perceptible.
El primer ensayo de carga real a WebGL se conserva, incluido el caso
83,90→85,74ms. Repetición independiente3/3,1,7min; nueve rondas alternadas
por caso, con texImage2D y finish, CPU×4:
-80px:79,54→80,06 /79,22→78,74 /81,12→80,10ms.
-257px:80,48→81,18 /79,96→79,24 /80,10→80,08ms.
-257px metal:78,00→79,06 /78,06→79,52 /77,44→77,00ms.
-512px:79,82→79,60 /79,84→79,06 /79,24→79,46ms.
Diferencias pequeñas y variables; no se presenta una mejora global de FPS
ni se ha medido un teléfono físico. Rasterización/subida dominan el coste.
Build aprobado; WASM397024bytes,SHA
`d7c1ec44ce9378406f92fc37cc0ad9891774c5d9d1f62e5ef87a39c857a30b35`.
Publicación171 pendiente. Evidencia:rust-book-cloth en D:/CodexEvidence/InhouseRead-20261012.

Publicación170:fuente36c6c9e7bd7df5c6d05da0453c693588ee2c7f48,
Pagesdbe4fda8b35cae97b385f822db3915fceaf0e6b2; deploy38210959741 y
Pages38211020035 aprobados.99recursos/HTML/precarga exactos; núcleo público
14casos/2965707bytes idénticos.3/3 E2E públicas del editor,1,4min.
Main/WASM exactos en dos perfiles limpios. APK1.1.15/code28,hash yloader2107
verificados. Evidencia:published-1791785408840 y rust-relief-pigment/public-*.
Los fallos anteriores de duración en CI se conservan; no se afirma CI verde.

# Migración 1.7.170 — pigmentos y biseles en Rust

Changelog: «Relieves por pigmento en Rust». Se trasladan la clasificación
binaria y la altura física de cada color. Membresía, distancia y bisel
comparten una reserva, evitando transferir los mapas intermedios. Se mantienen
los puntos de cancelación, el orden canónico, la propiedad exclusiva del
píxel y las alturas independientes en f32. Sólo se reemplazan los mapas
completos; un fallo parcial usa la clasificación anterior intacta.

Primer intento:82/83 focalizadas; la nueva prueba multicolor omitía los IDs
obligatorios y fue rechazada por el validador. Registro original focused.*
conservado. Corregida la fixture:83/83,3,82s. Con la prueba adicional de fallo
parcial:21/21 específicas,750ms. Incluye tamaño impar,ceros,bordes,redondeos,
10pigmentos superpuestos,cancelación entre etapas,crecimiento de memoria,
liberación y generadores reales monocromo/multicolor.
1/1 E2E con núcleo real,13,9s,bytes y f32 exactos. CPU×4,nueve rondas
alternadas,transferencias incluidas. El baseline ya calculaba la distancia
en Rust; la prueba multicolor reutiliza sus mapas como hacía producción:
-128×192,un pigmento:3,6→2,9ms.
-288×384,un pigmento:16,3→12,8ms.
-512²,un pigmento:38,7→29,8ms.
-288×384,tres pigmentos:45,4→31,5ms.
-512²,diez pigmentos:355,6→243,2ms.
Capacidad estable tras calentar,máximo5636096bytes en el ensayo. Estos tiempos
son del cálculo, no de FPS ni de abrir el editor en un teléfono físico.
Build aprobado. WASM395164bytes,SHA
`383c299b991d3bbd4bfa34303aad256d17ce5295c4185d64f60375a33a113c2d`.
4735/4735 unitarias,357 archivos,294,43s,sin omisiones.
3/3 E2E del editor real,1,3min,sin reintentos ni omisiones.
Publicación pendiente. Evidencia:
`D:/CodexEvidence/InhouseRead-20261012/rust-relief-pigment`.

Publicación169:fuente `80d630dcda54017cbe68dc6be943bdd6ddc28acb`, Pages
`03e190694209856073052e13205bc099f09304d7`,deploy38209956114 yPages38210020678
aprobados.99recursos/HTML/precarga exactos; núcleo público7casos,
17258868bytes idénticos. APK1.1.15/code28,hash yloader2107 verificados.
Evidencia:published-1791784655794.3/3 E2E públicas del editor real,1,4min,
sin reintentos ni omisiones. Main/WASM exactos en dos perfiles limpios.
CI167 UI2 conserva los dos fallos anteriores de duración al cerrar;
originales rust-mesh-finish/ci167-ui2. No se cambiaron sus límites.

El borrador rust-relief-rank permanece únicamente en D:; NO se integró al
comprobar que aquella morfología antigua sólo se usaba en pruebas. Se ha
priorizado la ruta activa de pigmentos; no se cuenta ese borrador como migrado.

# Migración 1.7.169 — planos de relieve en Rust

Changelog: «Mapas de relieve en Rust». Una única llamada convierte altura,
metal y brillo a RGBA. Cada salida conserva un buffer propio; alfa255 y
pigmentos exactos, sin conversión de espacio de color. Sólo se activa desde
4096píxeles (mínimo64×64 del generador); las entradas pequeñas y la carga
inicial conservan su alternativa. La reserva se libera también al fallar.

49/49 focalizadas (11nuevas),3,84s. Bordes/tamaños impares,1024²,generador
real,mutación de entradas,memoria creciente,trap y rechazo de datos.
La comparación profunda de un millón de bytes de entrada se sustituyó por
un bucle que compara cada byte, sin cambiar el resultado ni los límites.
1/1 E2E con núcleo real,15,2s,todos los bytes exactos. CPU×4,nueve rondas
alternadas de10 operaciones,asignación/transferencias/liberación incluidas:
-128²:JS0,87/Rust0,62ms.
-288×384:5,02/2,88ms.
-512²:11,53/6,99ms.
El caso1024² (fuera del máximo512 de producción) también coincide y pasa de
47,45 a31,51ms. Capacidad estable tras calentar; no es una medida de FPS.
Build aprobado. WASM393978bytes,SHA
`4d01755bbf5f754719433329156100f014bf9c5fbe906800c6ff5c90e1e3f970`.
4714/4714 unitarias,356 archivos,288,84s,sin omisiones.
3/3 E2E del editor real,1,3min,sin reintentos ni omisiones.
Publicación pendiente. Evidencia:
`D:/CodexEvidence/InhouseRead-20261012/rust-relief-planes`.

La167 también cargó main/WASM exactos en dos perfiles limpios (móvil y escritorio).

Publicación168: fuente `76a78ea2eae6e1303943f83c7957752d07da3889`, Pages
`851805e578a790aa87a69d312779255b1728f2c2`, deploy38209185494 yPages38209240741
aprobados.99recursos/HTML/precarga exactos; núcleo público30casos,
8956704bytes idénticos. APK1.1.15/code28,hash yloader2107 verificados.
Evidencia:published-1791784147145.3/3 E2E públicas del editor real,1,4min,
sin reintentos ni omisiones. Main/WASM exactos en dos perfiles limpios.
CI166 UI2:66aprobadas,2fallos previos de cierre por duración,0flaky/omitidas.
Originales rust-metal-sheet/ci166-ui2, sin modificar sus límites.

# Migración 1.7.168 — previsualización de relieves en Rust

Changelog: «Previsualización de relieves en Rust». Se trasladan el remuestreo,
normales y sombreado de las propuestas, conservando color original, alfa,
brillo por pigmento y todos los puntos de cancelación de ocho filas. Cada
trabajo copia sus entradas una vez, tolera crecimiento de memoria entre
fragmentos y libera su reserva incluso al cancelar o fallar.

58/58 focalizadas (20 nuevas),3,11s: bordes, mapas de distinta resolución,
tinta transparente, cinco pendientes,100 casos aleatorios, cancelación,
intercalado de tareas y fallback.1/1 E2E con núcleo real,11,3s; todos los
canales RGBA exactos. CPU×4,nueve rondas alternadas con transferencias:
-128×192:JS14,8/Rust14,0ms.
-288×384,relieve tradicional:78,1/66,1ms.
-288×384,pigmento conservado:66,6/48,3ms.
-512×512,pigmento conservado:149,0/108,1ms.
Capacidad estable tras calentar; no representa FPS ni tiempo total en un
móvil físico. Build aprobado. WASM393537bytes, SHA
`a1f5da3f4d2512f86ae7d3eb5cc439b6b1a23657e71c6c48457acc1e328a08c2`.
4703/4703 unitarias,355 archivos,289,55s,sin omisiones.
3/3 E2E del editor real: selección/persistencia, cancelación y varios colores
independientes,1,3min,sin reintentos ni omisiones. Publicación pendiente. Evidencia:
`D:/CodexEvidence/InhouseRead-20261012/rust-relief-preview`.

CI164 UI2 conserva los dos fallos previos de cierre por duración:60aprobadas,
2fallidas,0flaky,0omitidas. Resultados originales y reintentos descargados en
rust-lamp-surface/ci164-ui2; no se han cambiado los límites de8s.

Publicación167:fuente `6335b9a51d1a9894e1178244817da3991bee1e6a`, Pages
`53bf3f7520cf85af9378c98a7c81a88c0653502b`,deploy38208370618 yPages38208421550
aprobados.99recursos/HTML/precarga exactos; núcleo público120mallas,
3373056bytes idénticos. APK1.1.15/code28,hash yloader2107 verificados.
Evidencia:published-1791783488647.2/2 E2E públicas de catálogo/cambio,
41,4s,sin reintentos ni omisiones.
Publicación166:2/2 E2E públicas de catálogo/cambio y main/WASM exactos en
dos perfiles limpios. CI165 UI2 mantiene los mismos dos fallos de cierre;
originales rust-mesh-compact/ci165-ui2, sin modificar límites.

# Migración 1.7.167 — acabado de las piezas BAGGEBO en Rust

Changelog: «Acabado de mallas en Rust». Se calculan las coordenadas físicas de
pintura y las normales suaves de los postes, dejando las tapas separadas.
Se mantienen los atributos de Three y sus versiones; el núcleo entrega los
mismos bits y libera su reserva. Un fallo no modifica parcialmente el mueble.

El primer ensayo mostró una regresión al copiar cada raíl de324vértices:
JS0,015/Rust0,025ms. Se conserva browser.*. La producción agrupa TODAS las
piezas de pintura en una única transferencia antes de combinar las mallas,
cuando sus límites/posiciones/normales ya están fijados. Resultado final
CPU×4,nueve tandas alternadas de20 ejecuciones, copias incluidas:
-20 piezas,6480vértices:JS0,250/Rust0,225ms.
-Normales de un poste,456vértices:0,290/0,105ms.
Capacidad estable. La mejora del lote de pintura es pequeña; no se presenta
como mejora de FPS o del arranque completo. Se conserva la prueba individual
más lenta, pero esa ruta ya no se utiliza pieza a pieza en la aplicación.

36/36 focalizadas (13 nuevas),4,08s. Mueble completo con una llamada de pintura
y cuatro de normales,100 variaciones, negativo/cero, tapas, atributo conservado,
errores, memoria creciente y lote atómico.2/2 E2E con núcleo real (5,6s),
todos los atributos exactos. Build aprobado. WASM388126bytes, SHA
`5efb52a06a7d5b23122a90a7d722fd0200c1be8197a4913deb15aea1636b9461`.
4683/4683 unitarias,354 archivos,286,00s,sin omisiones.4/4 E2E de
regreso nativo, catálogo y cambio de mueble (1,3min), sin reintentos.
Publicación pendiente. Evidencia:
`D:/CodexEvidence/InhouseRead-20261012/rust-mesh-finish`.

Publicación166: fuente `cf704cadaa5441bc5cd0aa9c4a029d23c3c6cceb`, Pages
`01b0b63103ad1d7dbdbb3e210110f54fc9ba3bba`, deploy38207528611 yPages38207577035
aprobados.99 recursos/HTML/precarga exactos, núcleo público100rejillas,
174042vértices/5569344bytes exactos. APK1.1.15/code28 yloader2107 verificados.
Evidencia:published-1791782690691. UI pendiente. Publicación165:2/2 E2E
públicas de catálogo/cambio, sin reintentos; main/WASM idénticos en dos perfiles
limpios. CI163 UI2 mantiene los dos fallos de duración de cierre anteriores;
originales rust-timber/ci163-ui2, sin cambiar sus límites de8s.

# Migración 1.7.166 — rejilla metálica real en Rust

Changelog: «Rejillas metálicas generadas en Rust». Se trasladan la generación
de los hexágonos, unión de bordes compartidos, recorte contra los límites,
caras inclinadas, UV físicos y normales. Se mantiene el orden de inserción
y sustitución de segmentos. Las normales respetan el redondeo intermedio f32
de Three antes de normalizar; sus valores y los agujeros reales no cambian.
Modelo preparado con propiedad explícita y liberación de todos sus buffers.

35/35 focalizadas (14 nuevas),3,98s: ambos planos, paneles de tamaño real,
recortes mínimos/fraccionales,100 casos aleatorios, crecimiento de memoria,
límites, errores y mueble completo. 1/1 E2E con núcleo real (5,4s), todos
los atributos idénticos, incluidas normales y cero negativo. CPU×4,nueve
rondas alternadas, generación/transferencia/objetos Three/liberación incluidos:
- Panel horizontal567,5×220,40614vértices:JS37,7/Rust9,7ms.
- Panel vertical1116×200,70512vértices:60,7/18,7ms.
Capacidad estable tras calentar (máximo5439488bytes en el ensayo). No es un
resultado de FPS ni tiempo total de abrir el catálogo en un teléfono físico.
Build aprobado; WASM383977bytes, SHA
`be0aed3e4ffd231617ebd61c8f1fc5e290d789f06add8680cab008f26e151c4c`.
4670/4670 unitarias,353 archivos,286,87s,sin omisiones.
4/4 E2E locales de regreso nativo, catálogo y cambios de estantería (1,3min),
sin reintentos ni omisiones. Publicación pendiente. Evidencia:
`D:/CodexEvidence/InhouseRead-20261012/rust-metal-sheet`.

Publicación165 subida: fuente `e44db1a6fa464e5efbff424a3cf8fc7e20c8aa70`;
Pages `1cbc6c9014fed2097208bbaff646a618b8b3c010`, deploy38206881822 y
Pages38206933028 aprobados.99 recursos/HTML/precarga exactos; núcleo público:
7 casos/3399468bytes idénticos. APK1.1.15/code28 yloader2107 verificados.
Evidencia:published-1791782068932. UI pendiente. Publicación164:2/2 E2E públicas de luces y
gestos, sin reintentos; main yWASM coinciden en dos perfiles nuevos.
CI163 UI3:79correctas,0fallos,0reintentos,0omitidas. El aislamiento del
updater ya pasa también en CI; evidencia rust-timber/ci163-ui3. La batería
completa sigue pendiente. CI162 conserva los dos fallos de cierre yel
reintento del updater anteriores: rust-pdf-stream/ci162-ui2 yci162-ui3.

# Migración 1.7.165 — índices de mallas BAGGEBO en Rust

Changelog: «Compactación de mallas en Rust». El núcleo compara todos los
atributos dentro de cada par de triángulos y conserva el orden de índices,
las uniones separadas y el formato de normales/colores existente. Se reutiliza
la reserva de entrada para la salida, después de copiar las palabras a comparar;
no se modifica la geometría original. Los atributos de Three poseen sus copias.

21/21 focalizadas (12 nuevas),3,96s: hasta120000 esquinas, índices16/32bits,
redondeos negativos, cero negativo, costuras, colores, tamaños incompletos,
100 variaciones, memoria creciente, errores y mueble completo en tres escalas.
1/1 E2E del núcleo real (5,3s): rejillas originales de234/14706/40746 vértices,
4732/322428/802836 bytes finales idénticos. CPU×4,nueve rondas alternadas,
incluyendo transferencias, atributos, límites y liberación:
- Rejilla200×220:JS34,5/Rust5,3ms.
- Rejilla567,5×220:54,3/10,7ms.
La capacidad se estabiliza (hasta4259840bytes en este ensayo). No se reduce
ningún triángulo ni detalle respecto al algoritmo anterior. Cifras de la
compactación, no del tiempo total de crear la estantería ni de un móvil físico.
Build aprobado. WASM373470bytes, SHA
`3492980a6dbbf31af62901429f305eea2d4a76804eae0bcdfa93b255f1dfa642`.
4656/4656 unitarias en352 archivos (285,86s), sin omisiones.
4/4 E2E locales: vueltas nativas, catálogo en tres tamaños y cambio de
estantería conservando objetos. Sin reintentos ni omisiones. Publicación
pendiente. Evidencia:
`D:/CodexEvidence/InhouseRead-20261012/rust-mesh-compact`.

Publicación164 subida: fuente `8f915849ae47644edebfe679c672c94f44b03662`.
Pages `61f05f2cc54c35a73b0264539aa37c7db288e3c6`, deploy38206248072 y
Pages38206306565 aprobados.99 recursos/HTML/precarga exactos. Núcleo público:
21 mapas/8170752bytes idénticos. APK1.1.15/code28 yloader2107 comprobados;
sin modificaciones nativas. Evidencia:published-1791781527446. UI pendiente.
Publicación163:4/4 E2E públicas, sin omisiones
ni reintentos; main yWASM exactos en dos perfiles limpios. CI161 repite los
mismos dos cierres fuera del límite8s y el reintento del fixture del updater;
originales preservados en rust-pdf-figures/ci161-ui2 yci161-ui3. No se han
modificado sus aserciones ni sus límites.

# Migración 1.7.164 — texturas de lámparas en Rust

Changelog: «Texturas de lámparas más rápidas». Pigmento, relieve y rugosidad
de madera, lino y metal negro se calculan por lotes de hasta16 filas. Se
conservan resoluciones, mipmaps, filtrado, anisotropía, espacio de color, cachés
y propiedad de texturas. Los buffers se copian y liberan, incluso si crece la
memoria entre filas. La vía anterior sigue disponible si falla el núcleo.

39/39 focalizadas (12 nuevas),1,89s. Comparación exacta de las seis texturas
reales, tamaños impares y los tres modelos completos en ambas calidades,
incluidos atributos y parámetros de material. Primeras dos ejecuciones:
38/39 por el coste del comparador de identidad de Vitest con arrays grandes.
Ahora se compara la identidad como booleano y cada vértice como bits; no se
cambia el límite de5s ni se elimina ninguna comparación. Originales
focused.* yfocused-final.* conservados; final:focused-exact.*.

1/1 E2E con WASM real, CPU×4,nueve rondas alternadas, creación completa y
copias incluidas. Todos los píxeles idénticos, capacidad estable:
- Madera128×512:JS56,0/Rust30,2ms;256×1024:230,8/119,6ms.
- Lino256²:54,6/16,0ms;512²:215,4/68,0ms.
- Metal256²:23,7/11,6ms;512²:93,5/46,8ms.
Estas cifras corresponden a texturas sin caché; no son FPS ni tiempos de
apertura en un móvil físico. Build aprobado. WASM371650bytes, SHA
`340c940a16d0af172a83c75c8783382b9ffe603bf946ad4d24d97662234ee7e3`.
4644/4644 unitarias en351 archivos (285,80s), sin omisiones.
4/4 E2E de interruptores/gestos, cambio de mueble y ambas vueltas nativas
aprobadas (1,8min), sin reintentos ni omisiones. Publicación pendiente. Evidencia:
`D:/CodexEvidence/InhouseRead-20261012/rust-lamp-surface`.

Publicación163: fuente `38b1ce56e89684e80941d8a2877d02a93cff566d`, Pages
`696c14f10b7d75bb31476a1faff7b8c97f5a91e6`, deploy38205492117 yPages38205548662
aprobados.99 recursos/HTML/precarga exactos, núcleo público200 tableros/5lejas
(1190640bytes) exactos. APK actual1.1.15/code28 yloader2107bytes comprobados.
El primer sondeo fue durante el despliegue y falló; se conserva su informe en
published-1791780820591. Verificación final:published-1791780886578.
Publicación162:14/14 E2E públicas, sin omisiones ni reintentos; main yWASM
comprobados por respuestas reales en dos perfiles limpios.
CI160:60correctas/2fallos de cierre en UI2;78correctas/1repetición del updater
en UI3. Originales conservados en rust-pdf-images/ci160-ui2 yci160-ui3.

# Migración 1.7.163 — madera de la estantería en Rust

Changelog: «Geometría de madera en Rust». Se trasladan al núcleo las caras,
biseles, esquinas, normales, UV, veta y color por vértice de los tableros, y el
perfil redondeado de las lejas. Three conserva los mismos atributos, límites,
materiales y combinaciones de mallas. Cada geometría posee sus buffers; ninguna
vista apunta a memoria liberada. La triangulación del contorno se conserva.

13 pruebas nuevas comparan cada bit, incluido cero negativo: 200 tableros,
cinco anchuras de leja y armarios completos de 3/8/100 alturas en tres escalas.
También crecimiento de memoria, liberación, errores y vía anterior. 26/26
focalizadas (incluidas dos de aislamiento del updater). Build aprobado.
WASM 369143 bytes, SHA
`5bbe07d73fad9cb06b1101091b1971b8875d1c0b22873a47a634d6c85b4a48aa`.
10/10 E2E sin reintentos: perfil, ocho de aspecto/lectura y comparación de
armarios completos con núcleo real. CPU ×4, nueve rondas alternadas, incluyendo
objetos Three, copia, límites, combinación y liberación: 3 lejas JS6,78/Rust4,48ms;
12:14,41/9,50ms; 100:84,05/57,05ms. Todos los atributos idénticos (121968,
278784 y1812096 bytes), capacidad estable. Es coste CPU de creación, no FPS
ni una medición en un teléfono físico. 4632/4632 unitarias,350 archivos,284,15s.
4/4 E2E adicionales de vuelta nativa, plantas y cambio de estantería, sin
reintentos ni omisiones. Publicación pendiente.

Aislamiento del updater en pruebas: su helper registraba beforeEach al importar.
El módulo se reutiliza entre archivos del mismo worker, pero el hook sólo queda
en el primero. Un segundo archivo consultaba el catálogo real y mostraba una
actualización, oscureciendo el lector. Reproducción original: 1/2; corrección:
2/2. Cada archivo instala explícitamente su hook. Sólo cambia el entorno de
pruebas, sin cambios en vendor, aplicación, aserciones ni límites. Los originales
se conservan en updater-test-isolation. No resuelve los fallos independientes
de duración al cerrar en CI; sus informes originales siguen conservados.
Evidencia: `D:/CodexEvidence/InhouseRead-20261012/rust-timber`.

Publicación162: fuente `85cf78561a10b0c852710808ecf04f4994879e65`, Pages
`1398aa48e2cd578a5d9a099183e9a75ff6c6860e`, deploy38204660560 y Pages38204712318
aprobados.99 recursos, HTML y precarga comprobados. Núcleo descargado:200
páginas,31966 fragmentos y343081 caracteres idénticos. APK actual1.1.15/code28
conservado; no hay cambios nativos. Evidencia: published-1791780177543.
Publicación161:10/10 E2E públicas sin reintentos y main/WASM exactos en dos
navegadores limpios. CI159 falla en dos cierres y presenta una repetición por
el updater ya reproducido arriba; originales ci159-ui2 yci159-ui3 preservados.

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
4577/4577 unitarias en346 archivos (282,17s), sin omisiones.16/16 E2E
(55,5s) de imágenes, orden y núcleo real; sin fallos ni reintentos.
Publicación160 en curso. Evidencia:
`D:/CodexEvidence/InhouseRead-20261012/rust-pdf-images`.

Publicación159: fuente `b938b4c885b62bc6e69cc246298837ebfb9f70ba`,
Pages `6606d58c9a138f3fd8a0387030531d634e17e137`, deploy38201985214 y
Pages38202043944 aprobados.99 recursos públicos/HTML/precarga exactos.
200 movimientos/22375 muestras exactas del WASM descargado. APK1.1.15/code28,
SHA/tamaño/loader2107 verificados. Evidencia: published-1791777807853.
UI pública159:4/4 (77s), incluidos ambos regresos nativos y catálogo;
sin fallos ni reintentos. CI157 falla sólo en los contratos nativos deUI2;
originales conservados en rust-startup/ci157-ui2. No se considera corregido.

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
Recuento orientativo:2602 líneas no vacías Rust/35886 JS propias (6,76%).
Incluye comentarios; excluye pruebas, dependencias, HTML/CSS y Java nativo.
No equivale a porcentaje funcional completado ni a trabajo restante.
Publicación159 pendiente. Evidencia: `D:/CodexEvidence/InhouseRead-20261012/rust-motion`.

Publicación158: fuente `e7e306fac19493cefe97499b1ad823b965ffc34b`,
Pages `0c5cd8e20e5ea10116e38ca634b06c4b01a3b329`, deploy38201058812 y
Pages38201107309 aprobados.99 recursos públicos exactos, HTML/precarga
verificados.200 páginas/20544 líneas idénticas en el WASM descargado.
APK1.1.15/code28: tamaño/SHA/loader2107 verificados, sin cambios nativos.
Evidencia: published-1791776902608. UI pública158:12/12 lectura (53,4s),
2/2 estantería (36,6s), sin omisiones ni reintentos. Navegadores nuevos
móvil/escritorio cargan los main/WASM exactos, sin errores de página.

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

Publicación157: fuente `c29ece2ba1fd533a08b207085274579e8152f924`,
Pages `3cfbfeb08eee55ab046214791d7b14f88623091a`, deploy38200194219 y
Pages38200242891 aprobados.99 recursos, HTML y precarga WASM exactos.
APK1.1.15/code28 descargado: SHA/tamaño/loader2107 correctos.
Evidencia: published-1791776113394. UI pública157:2/2 en37s;
perfiles nuevos móvil/escritorio cargan los main/WASM exactos publicados
sin errores de página. CI156 falló sólo enUI2; originales conservados en
rust-plant-monstera/ci156-ui2.
CI155 falló en los mismos dos contratos de regreso nativo: cierre10–11s.
Originales: rust-plant-subdivide/ci155-ui2. CI154: rust-plant-ivy/ci154-ui2.
Las trazas muestran zoom~4,8s frente a460ms configurados; no se ha corregido
ni modificado el límite original de8s. Los errores originales se conservan.

# Migración 1.7.157 — núcleo listo durante el arranque

Changelog: «Rust preparado desde el arranque». El HTML precarga y compila el
WASM con su URL Vite con hash mientras llegan los módulos de la app. El primer
módulo de biblioteca adopta esa promesa sin esperarla para mostrar libros.
Una única petición/instancia; validación ABI y recuperación acotada originales.
Los servidores con MIME genérico o parámetros usan arrayBuffer: el primer
ensayo conservado detectó que el runtime rechaza parámetros en streaming.
El pintado final de plantas espera al primer frame de la estantería, con
presupuesto máximo de1s para superficies que no llegan a dibujar. Las texturas
preliminares exactas siguen disponibles y la calidad final no se reduce.
42/42 focalizadas (13 nuevas) y3/3 recorridos iniciales de navegador aprobados.
4509/4509 unitarias en341 archivos (280,93s), sin omisiones ni reintentos.
14/14 E2E (3,7min), sin omisiones ni reintentos; incluyen descarga bloqueada
y fallo de red con el planificador final. Publicación157 pendiente.
Build aprobado, mismo WASM de156:257936 bytes, SHA
`bcc9b82d26ab80a9b48df6e2d0754266530091d1a97f74f0cd45a0d141be650c`.

Ensayo emparejado: Chromium390×844 CPU×4, cinco pares alternados por red,
gzip y caché HTTP real. GSI bloqueado sólo en este ensayo para aislar red
externa. Antes de la fase caliente se comprueba en IndexedDB que superficies
y modelos completos se han guardado; su lectura se registra al reabrir.
Primera imagen, medianas baseline156/candidato157 en milisegundos:
- Red local fría:1745,0/1778,3; caliente:967,8/974,0.
- Red10Mbps latencia80ms fría:2733,9/2689,8; caliente:1045,8/1102,5.
No acredita una mejora general de arranque; se conserva la variabilidad y
no se extrapola a un teléfono físico. Sí prueba llamadas Rust antes de la
primera imagen en los20 arranques del candidato. Con caché se restauran los
modelos, sin volver a invocar sus núcleos. Los ensayos exploratorios previos
no esperaban correctamente a IndexedDB (waitForFunction recibía una promesa);
se conservan y NO son la evidencia de arranque con modelos guardados.
La preparación del siguiente bloque PDF está fuera del repositorio.
Evidencia: `D:/CodexEvidence/InhouseRead-20261012/rust-startup`.

Publicación156: fuente `e884fdf2afcbfcd9a9cb7c99c005457cb241475b`,
Pages `14235f63f0921419eefb145941b3366dcd3028bb`, deploy38198662734 aprobado.
99 recursos exactos;100 casos del WASM público y5215200 bytes idénticos.
APK1.1.15/code28, SHA/tamaño y loader2107 verificados.
Evidencia: published-1791774769450. UI pública156:2/2 en35,9s;
perfiles nuevos móvil/escritorio consumen los main/WASM exactos publicados
y no registran errores de página. CI154 también falló sólo enUI2; sus
originales están en rust-plant-ivy/ci154-ui2.
CI153 falló en ambos contratos de regreso nativo (69 aprobadas enUI2);
sus originales están en rust-plant-pot/ci153-ui2. No se considera corregido.

# Migración 1.7.156 — hojas perforadas de monstera

Changelog: «Monstera más rápida en Rust». Se migran ambas caras, las paredes
que delimitan sus agujeros, colores, UV, índices y normales. Las curvas y la
triangulación inicial de Three siguen en el host. No cambia la secuencia PRNG
ni se modifica la geometría fuente al rechazar o fallar el núcleo.
61/61 focalizadas aprobadas,22 nuevas. Chromium390×844 CPU×4 compara toda
la monstera con5 llamadas reales y todos sus atributos exactos. Nueve rondas
alternadas de5 plantas completas: JS25,280ms / Rust18,500ms, incluyendo el
resto de núcleos ya migrados en ambas rutas, creación, copias y liberación.
No equivale a la velocidad de toda la app ni de un teléfono físico.
Reservas temporales vivas0; capacidad WASM2228224 bytes antes y después.
Build aprobado; WASM257936 bytes, SHA
`bcc9b82d26ab80a9b48df6e2d0754266530091d1a97f74f0cd45a0d141be650c`.
4496/4496 unitarias en339 archivos (279,53s), sin omisiones ni reintentos.
11/11 E2E (3,6min), sin omisiones ni reintentos. Publicación pendiente.
Evidencia: `D:/CodexEvidence/InhouseRead-20261012/rust-plant-monstera`.

Publicación155: fuente `b6c1922a70dea246ae3bb23eb18d0dfd20a77b96`,
Pages `5ef582308aadecda00fe64cdb52af2b18782ba7e`.
Deploy38197758875 y Pages38197806806 aprobados. Manifiesto y99 recursos
públicos verificados;91 casos del WASM descargado y1273976 bytes exactos.
APK1.1.15/code28, SHA/tamaño y loader2107 comprobados.
Evidencia: published-1791774089783. UI pública155:2/2 en36,4s sin
omisiones ni reintentos. Dos perfiles nuevos de Chromium consumen main y
WASM reales con bytes/SHA exactos y sin errores de página.
CI15338196289014 termina fallido enUI2; demás trabajos aprobados.
Originales preservados en rust-plant-pot/ci153-ui2. CI154/155 sigue en curso.
Los fallos de regresos nativos y shader de CI anteriores siguen abiertos;
no se han debilitado plazos ni ocultado resultados originales.

Siguiente: arranque del núcleo en paralelo al código de la aplicación, sin
espera obligatoria. Baseline156 copiada fuera del repositorio para medir
con CPU×4, arranque frío/caché y red móvil. No hay código integrado todavía;
no atribuir a la primera apertura los ensayos de modelos precargados.

# Migración 1.7.155 — subdivisión de hojas

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

Fuente154 `49c42623ca7530fd1ededd464541759c1e6ab1a5` subida.
Deploy38197033340 y Pages38197087999 aprobados; Pages
`0819dba5741e946e6fa9224c1f97d7af41789a8c`. Recursos públicos exactos,
100 casos del WASM descargado y152800 bytes de atributos idénticos.
APK1.1.15/code28 y loader2107 verificados. UI pública154:2/2 aprobados
en38,2s, sin reintentos. Dos perfiles nuevos de Chromium (móvil/escritorio)
cargan realmente el main y WASM publicados con sus bytes y SHA exactos,
sin errores de página: browser-artifact.json en la evidencia publicada.
Evidencia: published-1791773277000. CI38197033308 sigue pendiente.
CI152 repite los dos regresos nativos fallidos enUI2 (71 aprobadas);
originales en rust-plant-cactus/ci152-ui2. No se consideran corregidos.
Publicación153 verificada: fuente715266b, Pagesc5fd729d,20 casos del
núcleo descargado, APK1.1.15/code28 y2 recorridos públicos aprobados.
El siguiente bloque está preparado fuera del repositorio, sin integrar ni
verificar todavía: ambas caras y paredes de las hojas perforadas de monstera.
Conserva los cuatro agujeros y el orden de sus bordes; sus curvas base de
Three siguen en el host. No se ha integrado caché de superficies base.
Después conviene medir el arranque del núcleo: app.js1432 lo solicita sólo
tras el primer fotograma de estantería. Aún no se ha adelantado esa carga.
Evaluar descarga en paralelo sin await y/o preload del WASM, conservando
la primera pantalla, errores tolerados y comparando arranque frío y caché.
No afirmar que las pruebas de modelos precargados aceleran el primer arranque.

# Migración 1.7.154 — geometría de hiedra

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

Fuente153 `715266b59c21e837948e1e90499d443359a157f5` subida a main.
Deploy38196289026 y Pages38196337453 aprobados; Pages
`c5fd729d0ad8091558b36e1cf8afce13686d12d4`. El manifiesto y los recursos
públicos coinciden con el build; el WASM descargado tiene el SHA esperado.
20 casos del núcleo descargado y1096048 bytes de atributos exactos.
APK1.1.15/code28 con tamaño, SHA y loader2107 comprobados; UI pública153
aprobada2/2 en36,6s, sin omisiones ni reintentos (rust-plant-pot/public-ui).
Evidencia: published-1791772591324. CI38196289014 pendiente.
Código propio publicado153:2342 líneas Rust/25 archivos y35662 líneas JS/178
archivos,6,16% Rust sobre líneas no vacías Rust+JS, incluidos comentarios.
Excluye pruebas, dependencias, HTML/CSS y Java. No mide funcionalidades
migradas ni esfuerzo restante. Medición: rust-plant-pot/code-share.json.
 El caso adicional de retirada sin compilar shaders
pasa localmente1/1 (39,7s), con su plazo original; el fallo deCI150 sigue
pendiente de causa. Evidencia: rust-plant-pot/shader-removal. No se toma ese
pase como prueba de corrección. CI151 también conserva los dos regresos
nativos fallidos enUI2 (71 aprobadas); originales en rust-plant-foliage/ci151-ui2. El siguiente bloque se prepara fuera del
repositorio: subdivisión de hojas grandes, preservando el orden de vértices.

# Migración 1.7.153 — superficies de macetas

Changelog: «Geometría de macetas en Rust». Rust calcula las coordenadas
por longitud de arco, el sombreado interior, las acanaladuras GRADVIS,
las normales y su unión en la costura. Se conservan LatheGeometry y los
coeficientes trigonométricos del navegador; no se afirma migrado ese constructor.
78/78 pruebas focalizadas,30 nuevas. El primer ensayo de navegador conserva atributos en cuatro entradas; la
entrada «terracotta» usaba la maceta por defecto. El recorrido final usa
el ID real «muskotblomma» para comprobar las cuatro variantes distintas.
El ensayo del cálculo directo sí usaba el perfil de terracota.
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

La fuente152 `c261bc8fb26846483ca7c235d9ebe3fc92284426` está subida.
Deploy38195567312 y Pages38195610343 aprobados; Pages
`48ef202924edd546c29e53c3388b0b1a9b3ec7c4`. Recursos públicos exactos,
80 casos del WASM descargado y2760000 bytes de atributos idénticos.
APK1.1.15/code28 con tamaño, SHA y loader2107 comprobados.
Evidencia: published-1791771910383. UI pública152:2/2 aprobados
sin omisiones ni reintentos (37,8s), en rust-plant-cactus/public-ui.
CI38195567348 sigue pendiente; no se afirma aprobación global.
La publicación151 ya tiene verificación del WASM público, recursos, APK
y2 recorridos reales.
CI150 conserva los dos regresos nativos fallidos enUI2 (71 aprobadas)
y un fallo enUI6 (57 aprobadas): retirar un libro enlaza4 shaders cuando
el contrato exige0, tanto en el primer intento como en el reintento.
Originales: rust-plant-soil/ci150-failed. Debe investigarse; no se atribuye
a la migración ni se declara anterior sin una comparación de referencia.

El siguiente bloque se prepara fuera del repositorio: la hoja de hiedra,
preservando los tres valores originales del PRNG.

# Migración 1.7.152 — geometría de cactus

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

La publicación151 corresponde a `06d513b5bae83428cea9e10731183d3c08bab4f7`,
Pages `6d4e5ac409a651a71c87ff5df9ac2658ee1812bb`.
Deploy38194827863 y Pages38194871134 aprobados. Recursos públicos exactos,
40 casos de follaje del WASM descargado y15733568 bytes idénticos.
APK1.1.15/code28, SHA y loader2107 comprobados; 2/2 recorridos
públicos aprobados sin omisiones ni reintentos (rust-plant-foliage/public-ui).
Evidencia: published-1791771244849. CI151 aún pendiente.
CI14938193105243 conserva los dos fallos del regreso nativo enUI2
(71 aprobadas) y una prueba inestable enUI6: el libro retirado deDrive
no estaba visible al iniciar el arrastre; pasó al reintentar. Los originales
se conservan en rust-plant-pottery/ci149-failed. No se debilitan los plazos.


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
Publicación150 verificada: fuente `4346c84d4e4896c0bed987feb9f722fa099be6ab`,
Pages `1acc883e93ef73bdfbc7be09b97b3a58a781a482`, deploy38193906856 aprobado.
Recursos públicos exactos,6 casos del WASM descargado y1311952 bytes idénticos.
Dos recorridos públicos aprobados sin omisiones/reintentos. APK1.1.15/code28
con SHA y loader2107 comprobados. Evidencia: published-1791770398584 y
rust-plant-soil/public-ui. CI150 está pendiente; no se afirma aprobación global.

La batería151 pasa4383/4383 unitarias en334 archivos (341,15s) y11/11 E2E
(4,4min), sin omisiones ni reintentos. El pase incluye44 casos nuevos de follaje, también a128² y256².
CI14738191581737 terminó con un fallo del regreso nativo393px enUI2
(72 aprobadas) y una prueba inestable «screenshots desktop paper» enUI3
(69 aprobadas y1 que pasó al reintentar: foliate-view ausente tras8s).
CI14838192199045 falló en los dos regresos nativos deUI2 (71 aprobadas).
Resto de grupos aprobados. Originales preservados en
rust-plant-preview/ci147-failed y rust-plant-glaze/ci148-ui2. No se ocultan
con los pases locales ni se considera corregido el regreso intermitente.

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
Publicación149 verificada: fuente `ea6fd2f149b20a199d45cd5dd0eaef0bd3af491a`,
Pages `02cea4ad06093b395e622d7d49c7b8a76e826519`. Deploy38193105161 y
Pages38193157275 aprobados. Recursos públicos exactos y12 casos del WASM
real,5245344 bytes idénticos. Dos recorridos públicos aprobados sin omisiones
ni reintentos. APK1.1.15/code28 y loader2107 verificados. Evidencia:
published-1791769655939 y rust-plant-pottery/public-ui.

Recuento publicado149 (`ea6fd2f`):2078 líneas no vacías Rust en21 archivos y
35511 JS propias en174 archivos;5,53% del conjunto. Incluye comentarios y
excluye pruebas, dependencias, HTML, CSS y Java. No mide funciones migradas,
velocidad ni trabajo restante. Evidencia rust-plant-pottery/code-share.json.

CI14638191111252 ha terminado con todos los grupos aprobados: unitarias,
seis grupos de interfaz y todas las voces reales Piper/Supertonic.
Esto no demuestra corregido el retorno nativo intermitente de CI143/145;
sus fallos y artefactos originales se conservan.

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
El primer pase completo conserva 4327 aprobadas y dos timeouts a5000ms
(shelf-placement8192 y cover-color-mask/large-cover10), con navegadores
simultáneos. No hubo diferencia de coordenadas ni de píxeles en esos errores.
Se repite toda la batería con dos workers y sin Playwright simultáneo;
originales unit.log/unit.json intactos. No se modifican los límites ni aserciones.
Resultado de la repetición: 4329/4329,332 archivos aprobados. unit-isolated.json/log.

Publicación148 comprobada: fuente `c05349a0d789f7a4b30d32872025f1b2bdb81c27`,
Pages `0558b143509744e6dc6c573d683bb4fe6fb7e81b`, deploy38192199081 y
Pages38192236290 aprobados. Recursos públicos exactos y12 comparaciones del
WASM descargado,5245344 bytes idénticos. Dos recorridos públicos aprobados,
sin omisiones/reintentos,1,2min. APK1.1.15/code28 descargada y loader2107
verificado. Evidencia published-1791768973018 y rust-plant-glaze/public-ui.
CI14538190559390 terminó con todos los grupos aprobados salvoUI2:
72 aprobadas y2 fallos del regreso nativo8s ya documentado. Originales
descargados en rust-speech-normalize/ci145-ui2. No se declara resuelto.

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
Publicación147 verificada: fuente `016af9f24491ab22e4e30c897242ab18089cc130`,
Pages `9167b53949a5954ae882e80e345a33f91a50a376`. Recursos públicos exactos,
WASM descargado con píxeles idénticos y dos recorridos públicos de plantas y
mueble aprobados (38,7 s). APK1.1.15/code28 conserva su loader2107 y SHA.
Evidencia: published-1791768540713 y rust-plant-preview/public-ui.
Publicación146 verificada: fuente `7bb1e4db653b49362cdab3408d742db760a3b2ae`,
Pages `675a15bb359d499c07d99c84d23a6be59adb8b4a`. Deploy38191111248 y
Pages38191222564 aprobados. 118 controles HTTP/99 recursos exactos. El WASM
público pasa27 casos de fragmentación y todos los65536 code units de limpieza;
APK/code28 idéntica y loader2107 verificado. Seis recorridos públicos de
voz/navegación/paginación aprobados sin omisiones ni reintentos,1,2 min.
Evidencia published-1791767970560 y rust-speech-fragments/public-reader.
La matriz global146 está pendiente; estos resultados no acreditan todo el CI.
# Migración 1.7.147 — texturas iniciales de plantas

Comprobación local: 4297/4297 unitarias y 11/11 E2E, sin omisiones ni reintentos; build aprobado. Publicación pendiente. Changelog: «Texturas de plantas en Rust».
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
Publicación 145 verificada: fuente `1afd3b89728afefd8a7320b95f1a46a15deaad25`,
Pages `bddc7672e7a7c1f0b7e1718f2ee7f825d057d473`. Deploy38190559366 y
Pages38190605711 aprobados. 117 controles HTTP; 99 recursos exactos; todos
los code units UTF-16 conservados al ejecutar el WASM descargado; APK/code28
con los mismos bytes y loader2107. Seis recorridos públicos de voz/paginación
sin omisiones ni reintentos, 59,7 s. Evidencia published-1791767566845 y
rust-speech-normalize/public-reader. La matriz global continúa; no se afirma
aprobación global ni verificación física nueva de Android.
# Migración 1.7.146 — fragmentos de voz en Rust

Verificación local: 4281/4281 unitarias y 7/7 E2E, sin omisiones ni reintentos;
build aprobado. Changelog: «Fragmentación de voz en Rust». Lista para publicar
tras verificar los artefactos reales y seis recorridos públicos de 145.
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
# Migración 1.7.145 — limpieza del texto del audiolibro

Verificación final: 4214/4214 unitarias; 18 E2E del lector y 9 de controles/capturas aprobados. Las seis capturas omitidas en la primera tanda se ejecutaron en la segunda. Build aprobado. Publicación pendiente. Rust recoge el texto normalizado, colapsa espacios y
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
aprobación. La matriz CI144 continúa; no se afirma éxito global. Dos recorridos sobre la web pública (plantas y cambio de mueble conservando libros) aprobados sin reintentos.
# Migración 1.7.144 — dimensiones físicas de la estantería (12 octubre)

Verificación local: 4167/4167 unitarias y 11/11 E2E, sin omisiones ni reintentos; build aprobado. Publicación pendiente. Changelog: «Geometría de estantería en Rust».
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
# Revisión 1.7.143 — controles sin hueco inferior (12 octubre)

Publicada y comprobada: **web 1.7.143**, fuente
`ad5113f7c9b372f8404b3083d3ae3e0507c801b9`, Pages
`a8d803b38ff8ae9d4656b0e13b2faa2155c3a0a8`. Deploy `38189046012` y
Pages `38189090448` aprobados. CI global `38189046053` en curso, unitarias
aprobadas; no se afirma aprobación global. Changelog:
«Navegación libre durante la narración». Conserva los gestos y el cursor
independiente de 142. Audio y retorno ocupan la cabecera existente: desaparece
la reserva inferior de 52 px sin variar la caja de lectura al reproducir.
Caché de altura v3 para descartar las páginas más cortas de 142. En teléfonos
de 320 px el retorno se lee en dos líneas y Detener permanece en el panel de
audio, con Pausa de 44 px en la cabecera.

CI 142 `38186967268`: UI3 rechazado, siete casos originales conservados en
`D:/CodexEvidence/InhouseRead-20261012/reader-continuity/ci142/playwright-ui-3`.
Cuatro detectaron la reserva inferior, uno un resaltado PDF fuera del área,
otro esperaba que deslizar detuviera la voz (contrario a la petición actual)
y otro esperaba un retorno separado encima del mini reproductor. Se corrige
el espacio y se actualizan las comprobaciones espaciales a la cabecera y el
gesto a reproducción ininterrumpida, conservando límites de área útil,
ausencia de solapamiento y objetivos táctiles.

El ensayo `unit143` conservó 4090 aprobados y un timeout a 5403 ms en la
comparación de 640 KB de PCM. El mismo caso aislado pasó (2102 ms). Ahora
`Buffer.equals` compara TODOS los bytes sin recorrer cientos de miles de
propiedades con el comparador genérico; no se cambia el audio ni el plazo.
El original y su repetición aislada `cached-order143` permanecen guardados.
La batería completa se repite sobre los bytes finales.

`layout143` original: 27 aprobados, cuatro expectativas antiguas de mini
reproductor inferior rechazadas y seis capturas omitidas por faltar la ruta.
`layout143-final` ejecuta también esas seis capturas y el nuevo caso 320/390 px.

Resultado final local: `layout143-final` **38/38**, sin omisiones ni reintentos,
5,4 minutos, con capturas revisadas en 320/390 px. `unit143-bounded` **4091/4091**
en 326 archivos, 228 s, cuatro workers y los mismos plazos y aserciones. El
ensayo completo previo `unit143-final` tuvo un timeout de 5 s en la comparación
de mapas de portada large-cover/10 bajo carga concurrente; se conserva íntegro.
No se cambia ese test ni su plazo: se limita la concurrencia del ejecutor local.

CI 142 terminó rechazado. Conserva dos fallos de retorno nativo dentro de
8 s en UI2, iguales a los registrados en 141, y los siete casos UI3 descritos
arriba. UI1/4/5/6, las 4091 unitarias, Piper engine 15/15, idiomas 40/40,
lectura 14/14 y Supertonic 224/224 aprobaron. Los diez artefactos E2E completos
están en `reader-continuity/ci142`. No se afirma aprobación global ni resolución
del rendimiento de retorno a la estantería.

Verificación de la publicación 143:
- `reader-continuity/public143-ui`: **7/7**, sin omisiones ni reintentos, 1,1 min,
  ejecutados contra la URL pública. PDF/EPUB con Davefx real, un audio y marca
  interna entre páginas; hold de 650 ms, navegación independiente, glifos sin
  movimiento y retorno legible a 320/390 px. El contexto de prueba concede
  local-network-access exclusivamente para servir los pesos fixture reales.
- `published-1791765864942`: **115/115**, 99 archivos públicos iguales por
  tamaño/SHA. Main `assets/main-DORlWQLE.js`, 655517 bytes, SHA
  `b45688a622a701415d1e1400280def54111387d72e90feba5af7a924fc53c4c8`.
  El WASM conserva el SHA de 142 y las cinco comprobaciones de píxeles exactos.
- APK pública descargada de nuevo: 1.1.15/code28, SHA
  `02960e3322bdad2e26041d2ef57b0fd5a02f3528c4b60b876e7955ae941cafb5`.
  Loader 2107 bytes, tres assets/public, URL de producción y ningún bundle
  antiguo dentro del APK. Mismos bytes que el APK firmado ya verificado.
  No se ha publicado APK nuevo ni cambiado updater/canales/firma. No se afirma
  una prueba física nueva de audio en Android.

## Publicación anterior — estabilidad del texto y audio continuo

Publicado y comprobado: web **1.7.142**, fuente
`ccf94d555a29c668e9d07eb1d5de56d5a88f8392`, Pages
`2c3119bb85be4b9d5b5c875f40613558741321f1`. Incluye Rust `d448533`.
Deploy `38186967248` y Pages `38187014344` aprobados. CI global
`38186967268` sigue en curso: no se afirma aún aprobación completa.

Implementado:
- La geometría del texto reserva una franja constante para audio/retorno;
  fuentes listas antes de mostrar capítulos, CSS idempotente y caché de altura v2.
- Toque corto conserva navegación/interfaz; mantener 500 ms sobre una frase
  cambia el punto de escucha. Arrastrar o cancelar el contacto anula el hold.
- Navegar páginas/capítulos y desplazar PDF conserva el cursor de escucha.
  «Volver al audio» recupera la posición sin cancelar la síntesis.
- Los bordes de página son marcas internas de una síntesis, no nuevos audios.
  PDF une el final incompleto y el comienzo siguiente, sin volver a leerlos.
- Piper expone las duraciones de fonemas existentes en ONNX sin alterar pesos
  ni operadores. Supertonic conserva un PCM y estima las marcas con su predictor
  de duración; NO se afirma alineación exacta por palabra en Supertonic.
- Web Audio usa su reloj audible. Android entrega subarrays contiguos del mismo
  PCM y recibe marcas del AudioTrack existente: ninguna pausa/fade intermedia,
  ni dependencia del temporizador JS para saber cuándo suena la marca.

Evidencia local `D:/CodexEvidence/InhouseRead-20261012/reader-continuity`:
- `unit-frozen`: 4091/4091, 326 archivos, con el código estabilizado.
  `unit-final` anterior falló una aserción añadida durante esa ejecución contra
  módulos ya cargados; la tanda nueva completa verifica los mismos bytes finales.
  Los originales unit-first/unit2/unit-final se conservan sin alteraciones.
- `browse-ui`: 4/4, gestos y huellas completas de glifos PDF/EPUB.
- `real-piper`: 1/1, una frase, un buffer y marca entre inicio y final audibles.
- `real-pages2`: 2/2 con Davefx real sobre PDF/EPUB. Original EPUB fallido en
  `real-pages`: corte sobre espacio antes de palabra; corregido a primer carácter.
- `reader-ui`: 49/49 sin omisiones ni retries; incluye seis capturas.
  `latest-focused`: 84/84, pausa de PDF unido, pan y puente PCM nativo.
  `real-supertonic`: 1/1 offline con pesos reales, un buffer de 4,452 s,
  marca interna y ninguna solicitud externa; la temporización es estimada.
- `engine-final`: 15/15 casos reales Piper sin omisiones ni retries.
- `public-ui2`: 6/6 en la URL pública, voz real continua PDF/EPUB, glifos estables,
  navegación independiente y hold de 650 ms. `public-ui` original conserva dos
  fallos al instalar modelos: Chrome denegó el servidor fixture loopback desde
  HTTPS. La repetición sólo concede local-network-access al contexto de prueba;
  no cambia la app ni desactiva seguridad general. Los otros cuatro ya pasaban.
- Artefacto real `published-1791763958575`: 115/115 controles HTTP, 99 recursos
  iguales por tamaño y SHA. Main `assets/main-BP4-P9sK.js` (655517 bytes), SHA
  `019f1f573dec0cc9d2d561d83004e57bee6584f070ae48f48e8043135ea66602`.
  WASM 183009 bytes, SHA `20f097846a04facfbf9a0e061d90fb0229a9a7f6add962abfceded6bb3f38fdd`;
  las cinco salidas de texturas públicas conservan sus bytes exactos.
- APK real descargada: 1.1.15/code28, SHA
  `02960e3322bdad2e26041d2ef57b0fd5a02f3528c4b60b876e7955ae941cafb5`,
  cargador 2107 bytes, sólo tres assets/public y URL de producción correcta.
  No hay cambios nativos ni nueva APK: el wrapper recibe esta web.
- Contrato Android comprobado con doble del puente y PCM exacto, no se presenta
  como ensayo de sonido en un móvil físico. APK pública sigue 1.1.15/code28.

CI anterior 141 (`38183041199`) terminó rechazado: UI2 falló ambos regresos
nativos dentro de 8 s; UI3 tuvo importación flaky; UI6 tuvo luces y retirada flaky.
Unidad, los tres grupos Piper, Supertonic y UI1/4/5 aprobaron. No se presenta
como batería global aprobada. Originales UI2/6 en `reader-continuity/ci141-original`,
UI3 en `rust-spine-weave/ci141-ui3`.

## Estado publicado anterior

# Estado actual — web 1.7.141 / APK 1.1.15

Publicación comprobada: fuente `7ca8e6d32dc3d328682c3aa707cb32edf2e0b269`,
Pages `8c73771d5446e36be7901cdf961f1cddb43f65ca`. Deploy 38183041174 y
Pages 38183092785 aprobados. 113/113 controles HTTP y 99 recursos iguales
por tamaño/SHA. Main `assets/main-TAlAp3Pe.js`, SHA
`aadb8b0c2d64217d321b5034a5769cf1d4c599ed107eb1523d4475c80a9385db`.
El WASM público ejecuta las tres nuevas rutas y conserva todos los bytes de
las texturas de referencia. Evidencia `published-1791760461407` y su
`published-surface-kernels.json`; el sondeo anterior se conserva fallido porque
Pages seguía en cola y devolvió HTML 404 para el recurso WASM nuevo.

Los tres recorridos contra la web pública pasan sin retries (45,8 s): ambos
retornos nativos y menú de perfil. El SHA del main ejecutado queda comprobado.
Evidencia `rust-book-surfaces/public-ui.json` y trazas del mismo directorio.
CI completa 38183041199 en curso: unidades, Piper reading y UI4 aprobados;
resto pendiente. No se afirma éxito global ni que la migración esté terminada.

Migradas a Rust las microtexturas de tela y papel y la máscara del marcapáginas.
Píxeles exactos, mismos materiales y caché compartida. Los recorridos por píxel
se ejecutan en Rust; JS conserva ocho coeficientes seno y el adaptador Three.
Changelog: «Microtexturas de libros más rápidas con Rust».

- 4058/4058 unitarias en 325 archivos; build y verificador del updater aprobados.
- 24/24 E2E locales sin retries: apertura/cierre, PDF/EPUB/CBZ, temas, metales,
  grabado, cancelación, ambos contratos nativos y uso real del nuevo núcleo.
- 101/101 focales; 27 regresiones nuevas de bytes y propiedad de memoria.
- Chromium CPU ×4: tela 5,307 → 2,120 ms; papel 7,210 → 2,837 ms;
  cinta 0,183 → 0,030 ms. Son costes de generación compartida, no de toda la app.
- Arena temporal máxima 131136 bytes, resultados independientes, sin pérdida
  de memoria. Se preserva la arena anterior del marcapáginas de 7896 bytes.
- WASM 182113 bytes, SHA
  `001796a2f378996224ce7b1a70e9b42bd54709eae0d825acb921f1345a67e657`.

Base incorporada por fast-forward `21e133a`: updater 1.2.3,
revisión `6621ca1dbb519d171d723f118052e42ef5d5c001`. Incluye los parches
ajenos definitivos y la recuperación por navegador. A y B apuntan a 1.1.15/28;
la promoción de B ya venía autorizada y publicada desde la otra tarea.
No se cambian copias del updater ni se publica otra APK desde esta revisión.

APK pública 1.1.15 descargada y verificada: 78532517 bytes, SHA
`02960e3322bdad2e26041d2ef57b0fd5a02f3528c4b60b876e7955ae941cafb5`.
Paquete, firma v2 y loader de 2107 bytes conservados. Certificado original
38180160799: mismo SHA, 369,77 s de audio EPUB y 51,39 s de PDF bloqueados,
pausa/reanudar/parar correctos en Android 15 emulado, no teléfono físico.

Evidencia: `D:/CodexEvidence/InhouseRead-20261012/rust-book-surfaces` y `apk115`.
El primer browser fixture falló al asumir que la arena compartida de geometría
se liberaba al destruir cada libro. Se corrige sólo la limpieza de esa prueba;
se conserva el fallo original y el resultado posterior independiente.

CI 137 `38180085214` terminó FAIL: ambos cierres Linux superan el límite de
8 s. UI2 original y log descargados; 73 aprobadas y 2 fallidas en ese shard.
No se afirman resueltos esos cierres por esta migración. Quedan la migración
completa de lógica de biblioteca/lector/gestos/persistencia y el arranque frío
de voz. La comprobación pública de 141 consta arriba; su CI completa aún sigue en curso.

## Histórico — web 1.7.137 / APK A 1.1.14, B 1.1.13

Optimización del libro 3D cerrado: las dos capas de impresión de la página
quedan fuera del recorrido de dibujo mientras la portada las oculta. Las
texturas permanecen cargadas; al comenzar a abrir se muestra la página exacta.
No se cambian geometría, resolución, luces, temas ni tiempos de animación.
Changelog: «Menos trabajo gráfico al cerrar libros».

- 4031/4031 unitarias, 324 archivos; build y verificador del updater aprobados.
- 23/23 E2E locales sin retries: apertura PDF/EPUB/CBZ, temas, movimiento
  reducido, cancelación y ambos contratos de retorno Android (límite 8 s).
- Comparación GPU: 24 imágenes idénticas byte a byte, ocho ángulos y tres
  mezclas del tema. Dos llamadas de dibujo menos por fotograma cerrado.
- Cuatro regresiones nuevas fallaban antes del cambio; 133/133 focales pasan.
  Primer fixture de píxeles abortado por descubrimiento de dependencias de
  Vite; se conserva. El fixture acota dependencias y desactiva HMR/watcher.
- Evidencia: `D:/CodexEvidence/InhouseRead-20261012/closed-print`.

APK pública 1.1.14/27 descargada: 78532469 bytes, SHA
`cdff45853eace1d3316bb6424a30b46e50b8fcc3b938350f40bbbe9ea8d43fb8`.
Firma v2 y paquete conservados; loader de 2107 bytes, sólo tres assets public.
Certificado original del build 38178203663 coincide con ese SHA: 368,70 s de
PCM EPUB bloqueado, 22 capítulos; PDF 51,30 s y dos páginas; pausa/reanudar/
parar correctos. Es emulador Android 15, no teléfono físico. Evidencia `apk114`.

Updater compartido aún en revisión `faf925d1d576b98baa8a53b1f8d39e842d18d0a9`.
La rama ajena `codex/android-install-result` prepara 1.1.15/28; no ha llegado a
main. Sus dos builds 38178846487 y 38179498822 fallaron; logs conservados.
No se mezclan parches a medio validar ni se reemplazan sus artefactos.
Se preserva B=1.1.13, publicado antes por la tarea autorizada para ello.

La CI anterior 38177346962 terminó FAIL: unidades y 291 voces reales pasan;
UI2 excede 8 s en cierre Linux/software y UI6 tiene cuatro enlaces de shaders
intermitentes. Los originales se conservan; no se consideran resueltos por
las pruebas locales. La CI de diagnóstico 38178998894 seguía en curso.
Faltan completar la migración Rust, reducir el arranque frío de voz y cerrar
estos fallos de rendimiento. La batería completa y verificación pública de
1.7.137 se registrarán al terminar; no se afirma CI verde.

## Publicación comprobada de 1.7.137

Runtime `c0958f39b5915a59e91172f7cf6dd0a0098d259a`; Pages
`950b829514acb195aafc8292a78e8b7c93c4edb6`. Deploy 38180085213 y
Pages 38180142167 aprobados. Segundo sondeo: 109/109 controles HTTP,
99 recursos idénticos por bytes/SHA, WASM compilado intacto y APK14 correcta.
Main `assets/main-CQxeDyaN.js`, SHA
`929653b903b1db43114abf9ee1dc27729a17802338fb58cc3a6dd7ec9274bc38`.
Evidencia `published-1791757443263`; el sondeo anterior se conserva porque
Pages todavía estaba en cola y devolvía parte de los recursos anteriores.

Dos cierres locales SwiftShader pasan sin retries: 7340,9 y 5155,3 ms.
Los locales normales midieron 4570,1 y 3968,9 ms. No son una comparación
estadística ni acreditan corregida la intermitencia de Linux. UI2 de la CI
anterior 38178998894 pasó esta vez 74/74; cierres 6334 y 6334,5 ms.

El primer recorrido público falló en dos clics de libro interceptados por el
aviso opcional del updater; el perfil pasó. Se conservan log y trazas en
`public-ui`. Los fixtures públicos pulsan ahora Later mediante locator handler,
con los mismos límites y aserciones. Nueva tanda `public-ui-defer`: 3/3 pasan,
43,9 s, sin retries; contrato de cierre y menú de perfil comprobados. El perfil
verifica el SHA del main ejecutado. No cambian catálogos ni runtime.

La CI completa del runtime 1.7.137 es 38180085214 y sigue en curso. Unidades,
Piper engine y UI5 ya terminaron aprobados; no se afirma éxito global.
El tercer build ajeno del updater, 38180160799, usa `02f6bda` y continúa
verificando Android 15. No hay aún integración de ese parche en main.

## Estado histórico — web 1.7.136 / APK 1.1.13

Integrado por fast-forward `227c3f2`: updater canónico 1.2.1,
revisión `faf925d1d576b98baa8a53b1f8d39e842d18d0a9`. Verificador de copias
aprobado. Conserva la optimización 1.7.135; sólo añade el cambio de colores
del updater y prepara Android 1.1.14 desde su tarea independiente. No se
publica otra APK ni se modifican los catálogos desde esta revisión.

Web publicada `13f84b7`, fuente `227c3f2`: 109/109 controles HTTP;
99 recursos iguales por bytes/SHA. Main `assets/main-v7whTgjx.js`, SHA
`8bc08dede1669bb88db086f0345dc2844f2e1673ae6bac03340974807a5a0641`.
APK descargada de nuevo: 1.1.13/26, mismo SHA y bytes que el ensayo firmado
registrado abajo. El remoto `d662f83` ya incluía esa misma APK en B;
se conserva esa publicación previa, sin promover nada desde aquí.
Evidencia `published-1791756231858` en el directorio de revisión nocturna.

La nueva CI `38177346962` aún no ha acabado: UI 2 vuelve a fallar en cierre;
UI 6 conserva una retirada intermitente con cuatro links de shaders.
Originales descargados en `ci-follow-ui6`; los stacks señalan compilación
anticipada del renderer de presentación. Falta precisar su relación temporal
con el gesto; no se descuenta del contador ni se declara arreglado.

Los dos tests de cierre con el diagnóstico adicional pasaron 2/2 localmente
sin retries (`native-diagnostic`), sobre los bytes construidos de 1.7.135.
Eso no reemplaza los fallos de Linux. Los ensayos externos de composición
CSS dieron 7603,9 y 7161,9 ms; no muestran una mejora y no se incorporan.

# 1.7.135 — Interacción con la estantería publicada

Runtime `8869750a36d33543ac8a3c27f577f0b9e475a850`, sobre updater
`4c053f2` / revisión canónica `53c7b0a6d01bbbc7cee1663c5a5bbac145f896d8`.
La preparación gráfica opcional cede ante pulsación, arrastre e inspección,
incluso antes del siguiente frame. Geometría, texturas, DPR y animaciones
conservados. Tres regresiones fallaron antes; 28 controles focales pasan.

- 4027/4027 unitarias en 324 archivos, repetidas tras integrar el updater.
- Build aprobado, verificador de copias compartidas aprobado.
- 15/15 E2E finales sin retries; importación, cierre, lector y updater.
- 3/3 contra la web pública: ambos regresos nativos y menú de cuenta;
  hash del main ejecutado comprobado. Cierres dentro del mismo límite de 8 s.
- Deploy `38175754041` y Pages `38175803443` aprobados; Pages inicial `677b5d0`.
- Web real: 108/108 controles, 99 recursos idénticos por bytes/SHA.
  Main `assets/main-Cm92xAGW.js`, SHA
  `b20ee0de3d1172f13e4385effefdac4ae419f645318f1e8e5b1055f68a19a082`.
- APK pública 1.1.13/26 (A): descarga, firma, paquete y loader de 2107 bytes
  comprobados. SHA APK
  `3b01272323158dd4d5c51a20374a9928b4e17a2b9a35b30b68d00056115ba2c5`.
  Recibe esta web; el APK pertenece a la integración compartida del updater.

Evidencia: `D:/CodexEvidence/InhouseRead-20261011/night-review`.
`published-1791755211663` verifica web y APK 1.1.13; Pages `a66057f`, fuente
de catálogo `4faffba`. `published-1791753781987` conserva el contraste previo
con APK 1.1.12. El intento `published-1791753630981` conserva fallos mientras
Pages aún estaba en cola.

CI 133 `38172275258` conserva FAIL: 5 fallos y 2 flaky entre 707 E2E;
4024 unitarias y los 291 casos de voces reales pasaron. Once artefactos y
logs originales descargados. Tres pruebas de lector no emitían inicio de
voz; dos cierres agotaban el presupuesto global durante la apertura previa.
Se corrigen esas observaciones sin ampliar el límite medido de cierre.
Importación y eliminación intermitentes originales siguen conservados;
la eliminación registra stacks y fuentes de cualquier nuevo shader.

CI 135 `38175754110` terminó FAIL: 4027 unitarias y 291 pruebas de voces
reales aprobadas; UI: 413 aprobadas, dos fallos y una intermitente. Los dos
regresos nativos exceden el límite de cierre de 8 s en Linux/SwiftShader,
incluso con los 60 s disponibles para el escenario completo. El screenshot
posterior muestra el libro ya insertado, pero eso no satisface el plazo.
No se aumenta el límite ni se considera corregido este rendimiento.
Once artefactos completos y log original conservados en `ci135-all` y
`ci135-failed.log`.

La intermitencia EPUB de UI 1 observaba un request antes de su inicio audible.
Un retraso sintético de 450 ms reprodujo el fallo. La prueba corregida exige
un ID nuevo, inicio audible, el mismo texto y resaltado visible; pasa 3/3 sin
retries. Fuente de esa corrección: `0bd3419`; no cambia el runtime 1.7.135.
Originales `ci135-ui1-original.log`, `follow-before` y `follow-after`.
Su batería completa `38177346962` sigue en curso; no se declara CI verde.

Diagnóstico local de cierre con SwiftShader: 7715,6 ms sin perfilador;
7108,8 ms con perfil CPU (fases completas conservadas). La muestra CPU
registra 6204 ms idle y 848 ms en setters de canvas. No demuestra por sí
sola el coste total de GPU. Quitar el blur sólo en un ensayo externo dio
5721,4 ms: cambia la imagen y NO se incorpora a la app. Los tests conservan
ahora la fase y el contrato aun si el plazo falla, mediante finally. Sin
cambios de calidad, reloj, resolución ni límite de cierre.

APK 1.1.13/26, run `38175283676`: intento 1 falló con salida 255 de adb
logcat durante el PDF; se conservan `apk113-failed` y el log. No se atribuye
una causa no demostrada a ese fallo. El intento 2 de la tarea del updater
terminó correctamente y publicó en A; no se sobrescribió ningún artefacto.
Certificado `apk113-passed/android-background-certification.json`:
370,7624 s de PCM EPUB, 23 capítulos y 52,37 s de PCM PDF en dos páginas
con pantalla apagada, sin errores de voz. Pausa, reanudación y parada
aprobadas. SHA del APK ensayado igual al descargado públicamente; firma
criptográfica válida y certificado anterior conservado. Evidencia de
Android 15 emulado, no una medición en un teléfono físico.

Pendientes: cerrar los fallos de rendimiento de devolución, primer uso frío
de voz instantáneo, migración completa a Rust, variantes regionales
adicionales cuando existan modelos adecuados, y rendimiento en teléfono
físico. Los diez perfiles Supertonic por idioma compatible ya existen; no
se cuentan como nuevos acentos ni personas.

# 1.7.133 — Primer audio y estado del lector

Publicado desde `d626d6232184e8e42aa2c669d877b70d6715a78b`. «Leyendo» se
anuncia al empezar el audio; preparación Piper en paralelo en Android y
codec de bytes directo cuando está disponible. Una primera frase larga
puede empezar por una cláusula natural sin perder texto ni offsets.

4024/4024 unitarias; 14/14 pruebas reales de lectura; 3/3 específicas Piper;
3/3 Supertonic; 1/1 UI pública. Web comprobada con 108/108 controles,
99 recursos idénticos por tamaño/SHA. APK 1.1.12/25 descargada de nuevo,
firma y loader de 2107 bytes verificados; recibe la web 1.7.133.

[Detalles, tiempos y límites de las mediciones](audio-first-play-133.md).
La CI completa `38172275258` terminó con fallos en los shards de UI 1/2/3/6.
Las unitarias y los cuatro grupos de voces reales pasaron. Se conservan los
logs y trazas originales; véase la revisión nocturna 1.7.135 al principio. No se cambia ni se
cancela la CI anterior `38170466639`. No se acredita velocidad universal
instantánea ni rendimiento en teléfono físico.

# 1.7.132 — Plazo de liberación tras reseleccionar voz

Seguimiento de la corrección 1.7.131: warmUp de una preview ya lista borraba
el idle timer y no lo reponía porque había run. Ahora rearma el mismo plazo
para previews, preservando un único modelo y sin interrumpir audio activo.
Añadida regresión con la misma voz elegida dos veces, cero reproducción y
liberación al plazo normal. Sin cambio de voz/calidad/velocidad/modelos.
Unidad final `unit-132`: 4014/4014, 324 archivos. `build-132` aprobado.
Publicado en main `f70903343130895e4fe3a6ddb47c233bf5a48ddd`.
Deploy 38170466700 y Pages 38170520646 aprobados, rama Pages
`c9ede0dd00deb328261e795cfaac101348691d8a`.

- `piper-132`: selección seguida de Play en la misma tarea: 2729,6 ms;
  carga 1838,5 ms, primer PCM 2613,6 ms. Original 4786,4 ms.
- `supertonic-132`: 3/3. Nuevo perfil neerlandés sin precarga: 3008,2 ms,
  mismo worker, cero recargas. Los dos casos con PCM preparado se registran
  por separado y NO se usan para afirmar inicio frío instantáneo.
- `public-132`: 108/108, 99 recursos públicos iguales al artefacto por bytes/SHA;
  main-D3UTx5C8.js, SHA 2d88ae95f458895b4ff89369b1e424e894cb53bc7de757c10cb3ffad3d5289d4.
  Evidencia `published-1791749024460`.
- APK real descargada: 1.1.12/25, SHA
  405a3d2698949e1d6f7425b7e666b5ca1f0b42e9cb212852caca3711336dfefd;
  firma/paquete válidos, loader de 2107 bytes al sitio publicado. Sin cambio
  nativo ni publicación B. No es una prueba física de velocidad Android.
- `public-ui`: 1/1 contra la URL real, hash del main ejecutado comprobado.
- CI completa 38170466639 iniciada para este commit y aún en curso. No se
  declara toda la CI verde. Las 14 pruebas reales de lectura y las 29 de UI
  locales preceden al guard final del temporizador; éste tiene su regresión
  unitaria y se repitieron las pruebas de arranque con pesos reales finales.

Pendiente explícito: el primer uso frío aún necesita ~3 s en estos casos.
Se han quitado espera por otra voz y análisis duplicado, pero falta reducir
el coste de carga/inferencia para acercarse al objetivo instantáneo del usuario.

# 1.7.131 — Selección de voz seguida de Play inmediato

Corrección de alcance de 1.7.130: sus mediciones inferiores a 250 ms esperaban
explícitamente al PCM preparado. No demostraban el caso indicado por el usuario.

Reproducción con pesos Piper reales: voz anterior sintetizando en silencio,
selección Lessac y Play en la misma tarea, sin esperar al modelo nuevo.
Original: 4786 ms, warmUp rechazado. Corregido: 3162 ms; repetición instrumentada
2834 ms (1916 ms modelo, 805 ms primera síntesis). Es Chromium local, no un móvil.
No se afirma arranque frío instantáneo: sigue pendiente reducir ese coste real.

- warmUp sustituye únicamente previews; nunca corta reproducción audible.
- Otro modelo elimina el worker obsoleto antes de preparar el nuevo, evitando
  la cola de inferencia cancelada. Otro perfil del mismo pack conserva sesión.
- La fachada inicia warmUp sin microtarea intermedia cuando el núcleo existe;
  Play también descarta una preview de voz distinta si no hubo warmUp.
- El análisis de página se comparte entre selección y Play incluso pendiente.
  Cambio de página, opciones de texto, relayout y Stop invalidan la caché.
- Modelos, calidad, velocidad, muestras, pausas y seguimiento sin cambios.

Evidencia: `D:/CodexEvidence/InhouseRead-20261011/voice-selection`.
`before` conserva el fallo original; `after` conserva el primer intento fallido
por la carrera de microtarea de la fachada; `after-2` y `stages` la corrección.
- Supertonic real: cambio F1→F2 neerlandés seguido de Play sin espera: 2988 ms,
  mismo worker y cero cargas adicionales. Preparación previa completa sigue
  dando 107–135 ms, pero esa cifra NO describe el cambio inmediato.
- Unidad inicial: 4012/4012. Segundo pase: 4012/4013; el nuevo guard de relayout
  reiniciaba también una preparación silenciosa invalidada por cambio de página.
  Corregido para recalcular durante Play; los logs originales se conservan.
- CI anterior 1.7.130, job 114554105446, conservado en prior-ci130-reading-job.log:
  el test frío destruía un cliente privado dejando su preview en estado ready.
  Ahora usa release(), que libera worker, preview y PCM: arranque realmente frío.
  El test que exigía estado idle antes de Play se adapta a la preparación nueva:
  exige cero ID de reproducción, cero eventos de inicio y cero buffers sonoros.
  No se cambian plazos, fragmentos, modelos ni criterios de continuidad/latencia.
Unidad final: `unit-3`, 4013/4013, 324 archivos; build final aprobado.
- UI del lector: 29/29, continuidad, pausa, resaltado, descarga y retirada.
- Runtime en main: `7da605169eb445e68d427795676ead44132bf240`.
  Deploy `38169653138` y Pages `38169713169` aprobados.
  Pages `76ca71c4959858fbbeb5b750f5ac13097a38f654`.
- Primera comprobación pública conservada: Pages aún propagaba el sitio y
  faltaban módulos nuevos. Segunda: 108/108, 99 archivos iguales en tamaño/SHA.
  Evidencia `published-1791748347474`; main `main--F5cpi7a.js`, SHA
  f909e5d3acad36ece032e81367e82110b461e1a7c535e30c6d1a366d39ae146b.
- APK descargada de A: 1.1.12/25, firma y paquete conservados, loader de
  2107 bytes, sin app web embebida. No hay cambios nativos ni APK nueva.
- La primera tanda real local `reading` pasó 6 y se detuvo en otra aserción
  heredada idle después de Pause: ahora hay preview silenciosa. Se conserva
  el fallo y se exige ID audible nulo además de cero audio/eventos durante pausa.
  La liberación privada restante en el test de cambio frío usa release().
- Segunda tanda real `reading-2`: 14/14, incluyendo pausa, cambio de voces,
  arranque frío de Daniela, 90 s de reposo, reinicio y lectura sin conexión. CI completa `38169653151` también;
  la tanda remota de lectura contiene la aserción de pausa antigua. No se
  afirma CI global verde ni velocidad física Android ni inicio frío instantáneo.

# 1.7.130 — Reducir la espera al comenzar el audiolibro

Causa encontrada: warmUp sólo cargaba el modelo; la primera inferencia se
solicitaba al pulsar Play. Además, el gate podía retener una frase completa
hasta cinco segundos por la inferencia pendiente de la siguiente.

Se preparan como máximo dos fragmentos, sin AudioContext, reproducción,
highlight ni avance. Play adopta esa misma ejecución, incluso en curso.
El gate de una frase completa abre inmediatamente; conserva la protección
contra cortes dentro de fragmentos incompletos. No se cambian modelos,
velocidad, muestras PCM ni se oculta el estado de preparación real.

La preparación se conecta a los puntos existentes de calentamiento del lector
(apertura para usuarios de audio, panel, voz), también cambios de ajustes y
pausa. Voz/rate/texto deben coincidir; generación y ubicación invalidan una
preparación del lector. Cerrar libera el worker y el audio; 90 s de inactividad
liberan también una preparación silenciosa. Los callbacks obsoletos no
pueden relanzar síntesis de otra lectura.

Evidencia local: `D:/CodexEvidence/InhouseRead-20261011/voice-start`.
- `focused-1`: motor, integración y cierre pasan.
- `unit-1`: 4003/4003. `unit-2` y `unit-3`: 4004/4004, 324 archivos;
  la última tanda corresponde a todo el runtime final.
- `ui-1`: 29/29 recorridos PDF/EPUB, continuidad entre capítulos, pausa,
  resaltado, descarga/retirada de voces y errores visibles sin voz del sistema.
  `build-2` aprobado tras el último guard de pausa.
- `real-1`: dos casos con pesos Supertonic reales, completamente offline tras
  instalación/calentar: ReadingVoice, catálogo, planner, worker y Web Audio.
  Primer evento audible a 135,7 ms (inglés) / 118,6 ms (neerlandés) desde click.
  Cero síntesis nueva en Play, cero reproducción/eventos antes de pulsarlo.
  Preparación previa de 2971 / 3291 ms. No son mediciones de un teléfono real;
  el primer uso frío o pulsar antes de terminar la preparación aún puede esperar.
- `piper-1`: 2/2, modelos reales Claude high (es-MX) y Lessac medium
  (en-US); preparación con worker frío sin eventos ni audio, reproducción
  offline y primer audio por debajo de 250 ms. WAV y medidas en `piper-audio`.
- `build-1` aprobado; updater canónico 483f516e5324d87d9aa49cc0628609d1984f208c
  incorporado desde origin/main antes de editar. Sin cambios nativos ni canal B.

La CI de 1.7.129 terminó con dos fallos de los plazos de devolución nativa
(aligned/legacy), también en sus reintentos. Voces reales y unitarias pasaron.
Se conservan `previous-ci129.json` y `previous-ci129-ui2.log`; no se modifican
sus plazos ni se considera aquella matriz totalmente aprobada.

Publicado en main `2f626e3a7e876b27272cbf8106646cd5f9797224`, web 1.7.130.
Pages `02e7327db3ec4d994d71f521aad6d476cc27b121`; despliegues 38167872684 y
38167926895 aprobados. `public-1.log` / `published-1791746779828/summary.json`:
108 comprobaciones correctas, cero errores; los 99 recursos públicos coinciden
con el manifiesto de Pages. Main `assets/main-BdR3eRyd.js` (653173 bytes), SHA
`2e33802d9e557569edc11cbfbb37448d5f7bade1a7d48aa5a1d6dfa2ece4459b`.

La prueba de UI pública pasa y comprueba el SHA del main ejecutado realmente
(`public-ui-1`). La APK de A descargada de nuevo conserva 1.1.12/25, paquete,
firma v2, SHA y loader de 2107 bytes, sin app empaquetada obsoleta. Carga esta
web; no necesita otro wrapper para el cambio. Canal B sin publicar.

Piper preparado inicia a 115,8 ms (es-MX Claude high) y 117 ms (en-US Lessac
medium); son medidas locales de Web Audio con modelos reales, no de teléfono.
El intento adicional de un arnés de voz sobre la URL pública fue rechazado por
la revisión automática sin motivo específico; no se cuenta como prueba pasada.
Se verificaron los bytes públicos y el recorrido de interfaz existente como
alternativa, conservando por separado los cuatro ensayos de audio locales.

La batería completa de CI `38167872701` sigue en curso al registrar la entrega.
Se lanzan todos los grupos sin exclusiones ni plazos relajados. No se presenta
la matriz pendiente como un aprobado global.

---

# 1.7.129 — Continuación de Rust: preparación del audiolibro

Se traslada normalización, RMS de NVCC, recorte de silencios y fade a Rust,
con exactamente los mismos bytes de audio que el código anterior. Está integrado
en Piper/Supertonic, worker web y cliente Android. Una arena acotada se libera
por fragmento; no se modifica la UI, los modelos ni las pausas. Revisión canónica
del updater conservada: `356d1e3fbd4f8c429d2d46d2f6de9ca4e910e573`.

Evidencia: `D:/CodexEvidence/InhouseRead-20261011/rust-pcm`.
- 3988/3988 unitarias en 324 archivos (`unit-full-2.json`), build aprobado y
  105 comprobaciones Python. El primer intento falló por el simulador del
  worker hebreo sin la nueva dependencia; se conserva `unit-full-1.json`.
- 5 mediciones Chromium, CPU ×4, comparan cada byte y verifican ejecución y
  liberación real del WASM. Reducción de ~8–23 % en la preparación de los
  fragmentos ensayados; no es una medición de toda la app ni de teléfono real.
- 4 integraciones con WASM real e inferencia simulada mantienen cada chunk,
  pausas, sample rate y protocolo. Detalles e intentos previos en rust-migration.md.
- 23 recorridos locales de interfaz pasan (`ui-1.json`, 3,4 min): seguimiento
  del audiolibro, capítulos, Drive en dos dispositivos, regreso nativo con los
  plazos originales, apertura offline PDF/EPUB y menú de perfil.
- 20 voces reales Supertonic pasan sin conexión después de instalar y calentar
  el worker: diez perfiles en inglés y diez en neerlandés (`voices-1.json`,
  2,5 min). Los pesos reales y las grabaciones quedan en la evidencia.
- Publicado en main: `495d91670125e4363322fca8362abed8f7bfd356`; Pages
  `7a354fcb4962c0bfa0df6300bd5f98ae46869252`. Despliegues 38165531753 y
  38165583259 aprobados. `published-1791744779970/summary.json`: 108 checks,
  cero errores, los 99 recursos públicos con sus hashes correctos. Se conserva
  `published-1791744722796`, que aún recibió la web anterior durante el despliegue.
- WASM público 179860 bytes, SHA256
  `dab359bdfbf395c7435a7efeabdcf09a5cd4c5a56b8ba5046977f9180b320dd6`;
  el binario descargado pasa 15 comparaciones completas de PCM. La prueba móvil
  sobre la URL real pasa y fija el cuerpo del main ejecutado a
  `ceaa4493bcacca1c85b96fbbe4632b3fd78142757d0cb33aa8dfcfe644eaf75f`.
- APK real de A 1.1.12/25 descargada de nuevo: hash, paquete, firma v2 y loader
  de 2107 bytes correctos. No se publica otro wrapper ni se promueve B.
  No se ha ejercitado un teléfono físico ni autenticado una cuenta real.
- CI completa nueva: `38165531750`, en curso al cerrar este registro. Se lanzó
  toda la matriz (seis grupos de UI, Piper y Supertonic), sin excluir pruebas
  ni ampliar plazos. No se presenta como aprobada antes de su conclusión.

La CI128 anterior aún no ha terminado: se conserva el log original de su
shard6. Smoke no abría el menú que ahora contiene Cambiar tema; se actualiza
ese paso, sin modificar su aserción. Papelera/Drive tuvo un boundingBox nulo
y pasó al reintentar: sigue siendo inestable, no un aprobado estricto.
La migración de toda la app sigue incompleta; no se atribuye un porcentaje
funcional a la proporción de líneas Rust/JS.

---

# 1.7.128 — Actualizaciones dentro del menú de perfil

Solicitud: quitar el icono adicional de actualizaciones de la cabecera y abrir
los ajustes en un menú discreto desde la foto, sin modal. El menú queda anclado
a la cuenta, con filas verticales, límite de altura móvil y cierre al tocar
fuera o pulsar Escape. Sin Google también está disponible, con la inicial I;
iniciar sesión y cambiar tema se hacen en ese menú. Los ajustes Android se
despliegan dentro de él, sin overlay, aria-modal ni bloqueo de foco.

La API integrada se implementa primero en el actualizador canónico, revisión
`356d1e3fbd4f8c429d2d46d2f6de9ca4e910e573`: `settings('', {container})`.
También corrige la respuesta vacía de una comprobación manual que se une a la
automática del arranque, y descarta resultados de comprobaciones cerradas.
CI canónica `38162887797` aprobada; 13 pruebas Node y 4 Python locales.
Canales, consentimiento explícito para A, recordatorio, hashes y firma se
conservan. No hay promoción a B ni cambio de APK nativa en esta entrega web.

Se usa `tools/sync.py` y se verifica la misma revisión en las cinco apps.
Read incorpora el lock y las copias en main; las otras cuatro conservan la
sincronización en `codex/updater-inline-settings`, sin publicar otras APK.
Clones de trabajo: `D:/InhouseRead-ProfileMenu/{updater,youtube,instagram,notes,photos}`.
Se fijan los bytes LF de los blobs canónicos, no conversiones CRLF del checkout.

Evidencia en `D:/InhouseRead-ProfileMenu/evidence`:
- `unit-release.json`: 3963/3963 unitarias, 322 archivos, ejecución secuencial
  antes del navegador; 105 Python aprobadas en `python.log`.
- Build aprobado (`build-release.log`). Diez recorridos de cuenta, canales,
  menú móvil y restauración PDF/EPUB pasan en `ui-release-results.json`;
  cuatro de Abrir con/OAuth pendiente/WebView antiguo en `android-entry-results.json`.
- Se conservan los intentos previos: mocks sin el nuevo export en `unit.log`,
  tres timeouts al ejecutar unitarias y navegador simultáneamente en
  `unit-final.log`, y recorridos fallidos en `ui.log`/`ui-fixed.log`.
- Se corrige el cierre erróneo al reemplazar el botón de canal usando la ruta
  original del evento. Al iniciar login se cierra el menú para dejar visible
  Reintentar. Los tests abren el perfil para acceder a controles trasladados.
- El test Drive ahora respeta PLAYWRIGHT_PORT en sus contextos independientes.
  No se amplían deadlines ni se omiten comprobaciones.

Publicación comprobada: runtime `58fb1cd5b5f34097e3a2e02989fa6b930a44a53a`,
Pages `fa1aab0222f4138fba311d5debda26447d304ce4`, despliegues `38163247398`
y `38163301725` aprobados. Los 99 recursos públicos coinciden en tamaño/hash
con Pages; 106 comprobaciones HTTP aprobadas. El recorrido móvil contra la
web pública pasa y su cuerpo main tiene SHA-256
`93a900cd22b48a6df58c26d6e8d9c8d357974ad9e2319fe818cfd1124fcfba5a`.
Evidencia: `public-ui-results.json`, `public-ui-audit.json` y
`published-1791742848110/summary.json`. Los catálogos de ese recorrido son
controlados; la web/DOM/almacenamiento y bytes del main son los publicados.
APK A 1.1.12/25 descargada de nuevo, hash, paquete, firma permanente y loader
de 2107 bytes aprobados (`apk-summary.json`); no hay teléfono físico en esta ronda.
CI general de 128: `38163247383` en curso; unitarias aprobadas. No afirmar que
la batería general completa esté verde antes de auditar sus resultados.

La CI anterior 1.7.127 (`38160512287`) ya terminó: falla en dos contratos de
regreso nativo de la estantería (`native-aligned-shelf-return-contract` y
`native-legacy-shelf-return-contract`) por timeout de 30 s. Se conservan sus
logs originales en `evidence/ci127-failures.log`. Este cambio del menú no
resuelve esos fallos previos ni acredita toda la batería general.

---

# 1.7.127 — Restauración completa de la biblioteca en Drive

Solicitud posterior del usuario (11 de octubre): guardar todos los datos de la
biblioteca en Drive al conectar la cuenta. **Sustituye la antigua política de
subida exclusivamente manual** que aún aparece en notas y recordatorios previos.
La copia local se conserva. No revertir esta decisión al retomar el WIP anterior.

Runtime publicado: `148ec9ed06d4b4779bb8b7b00bb9fbc2d01d9e6e`; Pages:
`37b27fb4ac1cf2477db5e094d1c8697cd8370ef8`. El updater compartido, su revisión,
los canales, paquete y firma no cambian. No hay nueva APK nativa: la 1.1.12/25,
ya publicada en A, carga la web 1.7.127. B sigue vacío.

Implementación:
- `LibraryBackup` coordina los originales con `CloudSync` y restaura archivos,
  portadas binarias, metadatos, aspecto, progreso/historial/marcadores/citas,
  orden/posiciones y preferencias de estantería, plantas, lámparas y lector.
- Manifiestos por dispositivo en `.inhouse-read-state`, con registros por campo,
  aislamiento de cuenta y marcas de retirada. Una instalación vacía no borra la
  biblioteca remota ni sustituye la decoración por la predeterminada.
- Los checkpoints van a IndexedDB, las imágenes a ficheros binarios separados;
  no se serializan Blobs como `{}` ni URLs `blob:` de otro dispositivo. Web Locks
  serializa sincronizaciones del mismo origen/cuenta en varias pestañas.
- Ediciones, portadas, importación y decoración disparan sincronización en segundo
  plano. Se reintenta al reconectar/volver y cada tres minutos si está visible.
  Una edición durante una transferencia y una portada más reciente se conservan.
- Los registros antiguos de origen local que tienen ID de Drive pero no bytes
  recuperan el original remoto al abrir, sin pedir otro archivo local.
- Para subir libros antiguos nunca copiados, se debe abrir esta versión primero
  en el dispositivo que conserva sus bytes. Los registros sin original se
  notifican como pendientes; no se inventa una copia recuperable.

Evidencia local en `D:/CodexEvidence/InhouseRead-20261011/drive-library`:
- 3963/3963 unitarias (`unit-release-final.json`) y 105 Python con Python 3.12.
  Se conserva el primer fallo del ejecutor Python 3.9 (no admite `Path | None`).
- Recorridos locales de restauración PDF/EPUB, subida automática, indicador de
  portada, retirada/reimportación y updater aprobados, sin ampliar deadlines.
- Tres recorridos en la web pública pasan (55 s). Dos contextos independientes
  por formato recuperan bytes originales y portadas exactas, orden y plantas.
  El recorrido público PDF añade ir a la página 2 y exige reabrir en esa página.
- Se auditan once cuerpos `Response.body()` de main de esos recorridos contra
  SHA-256 `43212f0c241414a4dea4033265cceaf02a03552c7bc7bae3b08c8ade26d92c1f`.
  `public-browser/audit.json` contiene la aprobación y las atribuciones.
- HTTP público: los 99 recursos coinciden en tamaño/hash con el manifiesto de
  Pages. El primer auditor intentó catálogos bajo Pages y recibió HTML/404;
  el segundo usa los catálogos reales de `raw.githubusercontent.com` del updater.
- APK descargada de nuevo, 78 532 469 bytes, SHA-256
  `405a3d2698949e1d6f7425b7e666b5ca1f0b42e9cb212852caca3711336dfefd`, firma
  permanente y loader de 2107 bytes verificados, sin bundle antiguo completo.

Límite de la evidencia: app publicada, lectores y almacenamiento del navegador
reales, pero endpoints HTTP de Drive controlados por el servidor de pruebas.
No se ha usado una cuenta Google personal ni un teléfono físico en esta ronda.
No afirmar que se hayan subido ya los libros privados del usuario.

CI general de esta versión: `38160512287`, cerrada con fallo. La auditoría
`ci-38160512287/snapshot-002/summary.json` conserva los once artefactos originales
autenticados y sus hashes, sin incidencias de atribución. Censo: 3963 unitarias
y 693 casos E2E únicos; 695 intentos, dos reintentos de CI y cuatro intentos
fallidos, correspondientes a los dos contratos de regreso nativo de la
estantería del grupo 2/6. Los otros grupos y las voces pasan. Los originales
y las pruebas fallidas no se han borrado, omitido ni transformado en éxito.

---

# Seguimiento recibido: integración 1.7.126 del updater

Durante la auditoría de 124 llegan nuevos commits externos hasta `24dd03a`
(web 1.7.126). Se descargan por fast-forward sin tocar los cambios Rust ya
publicados ni los artefactos firmados. El runtime publicado procede de
`bb2bb10a2cca8f9ee27758da84b9d5c5cf149172`, Pages
`f02fc879d796a49c168508b09bd4bc06d8ed14cc`; el commit 24dd03a sólo precisa
el selector del slider en un test. El primer intento de fijar Pages a 24dd03a
es rechazado correctamente por no ser su fuente atribuida; después se fija
bb2bb10, conservando el intento fallido. No se fuerza una atribución falsa.

Nuevo updater canónico `ac5cef8994ea476af46161bd4189d85adfc5016a`: B por
defecto, aviso en inglés, aceptación y deslizador para A. Se leen sus normas
y se contrastan las 20 copias con los blobs Git canónicos, además del lock.
La copia de referencia anterior conserva cambios de finales de línea que
impiden cambiar su checkout; se leen los blobs de la nueva revisión sin
sobrescribirla. No se ha modificado código compartido de forma independiente.
B permanece sin publicaciones; elegirlo por defecto no autoriza promocionar.

Build 126, 3952/3952 unitarias, 105 Python y cinco recorridos locales del
updater/descarga aprobados. HTTP126 aprueba 101 respuestas/891 comprobaciones,
con el WASM idéntico de 178034 bytes. Los **27 recorridos públicos nuevos
pasan** en 3,8 minutos, con auditoría aprobada de todas sus respuestas main:
`public126-browser-attempt1/audits/2026-10-11T17-10-35-771395Z-654cd80d`.
El resultado completo de CI124 que sigue abajo no acredita la nueva CI126.

La otra tarea publica APK **1.1.12/25** en `38157135543`. Se descarga su
release real de A: 78532469 bytes, SHA256
`405a3d2698949e1d6f7425b7e666b5ca1f0b42e9cb212852caca3711336dfefd`.
Firma, paquete y loader de 2107 bytes aprobados. El APK público es idéntico
byte a byte al del ZIP original de build autenticado. Se autentica también
el ZIP de capturas y se revisan los JSON/PNG: cold/warm/share conservan la
política de pantalla; hay 367576 ms bloqueado con 368,78 s de audio real,
capítulos 0–22 y PDF páginas 0–1. La captura cold final sí muestra el libro
insertado. No acredita un plazo de ocho segundos ni un teléfono físico;
tampoco se capturan los cuerpos HTTP del WebView. Son pruebas del build
previas a publicar, contrastadas contra los bytes públicos descargados.
Evidencias: `android1112-integrated/summary.json` y
`android1112-build-originals/audit.json`. No se reconstruye ni sustituye el
APK ajeno. Se integra su catálogo por fast-forward en `b49cba3`.

CI126 de `24dd03a`: `38157553852`, aún en curso. Revisar sus originales al
terminar; no reutilizar como aprobado el resultado de CI124 ni repetirla
sin cambios para ocultar fallos. La migración completa a Rust sigue pendiente.

# 1.7.124 publicada con Inhouse Services Updater; dos fallos nativos pendientes

Los 11 grupos de pruebas de CI `38155579422` han terminado: **3952/3952
unitarias en 321 archivos y 689/691 E2E**. Hay 693 intentos (dos reintentos
automáticos), cuatro intentos fallidos, cero casos omitidos o inestables.
Todos los grupos de voces aprueban. Se autentican los 11 ZIP originales sin
inconsistencias ni artefactos ausentes: `ci-38155579422/snapshot-008/summary.json`.
La CI termina **FAILURE**, con sus 12 jobs registrados. La captura anterior
snapshot-007 conservaba el job agregado esperando runner; no se reemplaza.
No declarar CI aprobada: los dos contratos nativos fallan.

Web publicada desde `67d46f02095aabc09670caa2e23037704b48d03f`, Pages
`b9751b406c1f9225e471bbcc70b7d6ae161aaa69`. Se mantiene APK 1.1.11/24 de A,
sin reemplazar sus bytes ni publicar la 1.1.10 cancelada. B permanece vacío.

La comprobación HTTP final valida 101 respuestas, 99 recursos y 891
comprobaciones de identidad. El primer intento recibió todavía la web
anterior mientras Pages desplegaba: se conserva íntegro. Los 27 recorridos
públicos originales pasan en 3,9 minutos, incluidos cierres nativos con
sus plazos originales, texto/imágenes PDF y reapertura PDF/EPUB offline.
Su auditoría verifica los cuerpos del main realmente ejecutados por todos
los contextos. Además pasan los dos recorridos públicos del editor:
igualdad de colores, un trabajo Rust inicial y ninguno al reutilizar caché.
El primer intento de preparar esa copia de pruebas omitió book-length.js;
se conserva ese fallo de preparación y se corrige sólo la copia externa.
No se deduce una mejora del tiempo completo del editor de esos dos ensayos.

APK real: workflow `38155780417` aprobado, ZIP original autenticado y
capturas revisadas. SHA256 y tamaño coinciden con A; la verificación local
también conserva firma, paquete y loader. Android 35 acredita barra oculta
y KEEP_SCREEN_ON al leer, restauración al salir y al ir al fondo, estabilidad
del WebView y formulario Google sin redirect_uri_mismatch. No se introducen
credenciales ni se acredita aquí la sincronización de una cuenta real.
La última captura de retorno todavía muestra el libro en vuelo: no demuestra
la inserción final ni una mejora de latencia. El workflow tampoco captura los
bytes HTTP del WebView; esa comprobación de web124 tiene evidencia separada.

Evidencia nueva bajo `D:/CodexEvidence/InhouseRead-20261011/rust-migration/`:
`public-124-2026-10-11T16-30-13-713Z-f7cda760`,
`public124-browser-attempt1/audits/2026-10-11T16-35-15-509553Z-b7db3f02`,
`public124-editor-attempt2/audit.json` y `android1111-web124/audit.json`.
El censo original completo de CI está en `ci-38155579422`.
Los recorridos públicos aprobados no convierten la batería completa en verde.

Diagnóstico adicional `close124-diagnostic`: se mantiene la prueba nativa
alineada original a 30/8 s, añadiendo muestreo CPU y observación de fases,
con SwiftShader explícito. Pasa (27 s totales, cierre 5814,5 ms). Preparación
hasta zoom: 76,9 ms; marcapáginas 909,2 ms, cierre 1726,2 ms, vuelo
3456,9 ms, inserción 4769,2 ms desde el clic. La instrumentación y el driver
explícito hacen que sea un diagnóstico separado, no un reemplazo de CI ni
una medición de teléfono. No hay cambio de producto derivado de ese ensayo.

`close124-resize-diagnostic` separa los setters width/height posteriores al
clic, además del perfil: pasa con cierre 4917,7 ms. Cuatro escrituras del
canvas nativo durante inserción consumen 278,3 + 136,0 + 298,1 + 0,8 ms;
las demás escrituras observadas pertenecen a preparación y redondean a cero.
Son dos perfiles instrumentados diferentes, no una comparación antes/después
ni una corrección publicada. No se cambian tamaños, DPR ni contratos nativos.

CI124 conserva de nuevo los dos fallos nativos originales: aligned agota
30 s en el primer intento y la expectativa de cierre de 8 s en el reintento;
legacy mide 8266,5 y 8189,2 ms, además de agotar el plazo global. Evidencia
original autenticada en `ci-38155579422/originals/playwright-ui-2`, con
resumen `ui2-failed-cases.json`. No hay aumento de límites ni reejecución
manual sin cambios. La migración de hojas/paletas no arregla esos fallos.

## Integración y preparación previas

El 11 de octubre a las 18:15 se descarga `origin/main` en `d879237`, con
web 1.7.123 y APK 1.1.11/24 del canal A. Se preservan los 26 cambios locales
en el stash `Rust leaf and relief candidate preserved before shared updater
integration 2026-10-11`, se avanza por fast-forward y se aplican sin conflictos.
El stash se conserva como respaldo; no volver a aplicarlo sobre este árbol.

Se cumple la condición de integrar el updater antes de publicar. Su revisión
`ff20596f137119b98844a03a75836099ac7e146b` permanece intacta. Windows había
convertido sus archivos a CRLF: se restauran usando el `tools/sync.py` canónico
de la misma revisión, con sus fuentes extraídas byte a byte del commit y
Python UTF-8. Se conserva la nota específica de B en UPDATER.md. El lock
final y las 20 copias son idénticos a main; sólo se añade `.gitattributes`
para mantener LF en futuras descargas. El prebuild web ejecuta el verificador
canónico, igual que ya hace el build Android.

Se prepara web 1.7.124: build aprobado, núcleo de 178034 bytes, 3952/3952
unitarias en 321 archivos y 105 comprobaciones Python aprobadas. El número
menor de unitarias procede de los tests reemplazados por la integración del
updater, no de omisiones en esta batería. Se conservan las 3973 anteriores.
Los recorridos conjuntos del editor, animación, descarga y updater están en
`local124-integration-attempt1`: 15/15 aprobados en 3,4 minutos, incluidos ambos regresos nativos con sus límites originales.

La APK 1.1.11 real descargada de GitHub coincide con A: 78532469 bytes,
SHA256 `4f19d71a49186f09c64af9d64e2a81e719fa571ca5aea37dc98decf4f723c23e`,
firma permanente, paquete correcto y loader de 2107 bytes. Evidencia:
`android1111-integrated/summary.json`. Falta verificar esta APK con la nueva
web publicada. No hace falta recompilar ni sobrescribir el APK para estos
cambios web; el loader sigue apuntando a la producción. B sigue vacío.

El build 124 está congelado en `public124-browser-attempt1/frozen-local-build`.
Los 27 recorridos públicos y sus scripts de auditoría ya están preparados;
falta fijar source/Pages con `write-public124-pins.mjs` después del despliegue,
ejecutar `verify-public-124.mjs`, los recorridos y su auditoría de respuestas.
La migración completa a Rust sigue pendiente. CI121 conserva dos fallos de
regreso nativo; no se amplían sus plazos ni se afirma que están resueltos.

## Retención anterior (resuelta al integrar main)

El 11 de octubre el usuario pide esperar el commit de unificación del
instalador, previsto aproximadamente media hora después de su mensaje.
**No publicar web, APK ni catálogos antes de descargar e integrar ese commit.**
La ejecución propia `38151667641` (APK 1.1.10/23) se canceló durante el build,
antes de publicar el APK o modificar manifiestos. La rama externa
`feat/inhouse-services-updater` y su prerelease 1.1.9/22 se conservan intactas.

Continuar los cambios y las pruebas localmente. Cuando llegue la integración,
preservar las migraciones Rust posteriores a su punto de partida, leer sus
`AGENTS.md`/`UPDATER.md` y las directrices del repositorio canónico. Publicar
sólo al canal A, con changelog breve, firma existente y versionCode global
creciente; B requiere petición expresa. Verificar el lock y las copias
compartidas, sin modificarlas de forma independiente. No lanzar el workflow
antiguo de publicación estable. Comprobar primero qué versión/código ha
publicado finalmente el otro trabajo antes de preparar otro APK.

Se ha programado una continuación en esta conversación para las 18:15
(Europe/Madrid) del 11 de octubre: `integrar-el-updater-de-inhouse-read`.
En la última consulta `origin/main` seguía en `9b0f88a`; la rama del updater
ya incorpora esa base, prepara web 1.7.122 y APK 1.1.11/24. Consultar de
nuevo: no asumir que ese trabajo ni su publicación hayan terminado.

Hay cambios locales de geometría de hojas y paleta de relieve en Rust,
todavía sin publicar. Pasan 50 pruebas focales de integración con WASM real,
8 recorridos Chromium de geometría, 16 de paleta/API, 15 del editor real y
dos comprobaciones de editor en frío/con caché. La batería completa detectó
un fallo de hash de los modelos ante un import WASM con `?url`; corregido,
pasan las 14 pruebas focales y el build. La batería posterior termina con
3973/3973 pruebas en 321 archivos; los ocho recorridos originales locales
también pasan, incluidos ambos cierres nativos, sin cambiar sus plazos.
Los resultados están en `unit122-full-attempt2.json` y
`local122-browser-attempt1/results.json` dentro de la carpeta de evidencias.
El build anterior al updater está congelado en
`local-candidate-before-updater-build`; no es una versión publicada y aún
lleva la etiqueta web 1.7.121. Elegir la versión siguiente después de integrar.
CI121 terminó con 663/665 E2E, cero omitidos/inestables: sus dos fallos de
regreso nativo aún deben investigarse sin ampliar los límites originales de
30 s globales y 8 s de cierre. Legacy midió 8188,5/8110,3 ms de cierre.

# Continuación: 1.7.121 publicada; migración parcial a Rust

121 migra la agrupación de filas PDF y las previsualizaciones de arrastres
prolongados a Rust. Mantiene las rutas anteriores para páginas pequeñas,
estanterías pequeñas y gestos cortos. No modifica el aspecto ni los tiempos
de las animaciones. Las comparaciones incluyen las copias entre JS y WASM:
en Chromium CPU ×4, 512 fragmentos PDF mixtos pasan de 44,1 a 11,6 ms;
40 objetos en 120 posiciones pasan de 32 a 13,7 ms por gesto. Los gestos
de ocho posiciones con 40 objetos tienen sobrecoste (2,85 a 3,55 ms).

Pasan 3.919 unitarias en 317 archivos, 105 comprobaciones Python/Android,
el build y los ocho recorridos originales con sus límites originales.
También pasan la importación/cierre en frío, los dos recorridos originales
de colocación y el nuevo arrastre de libro/planta con persistencia. Los
fallos de los primeros ensayos y sus correcciones se detallan en el informe.
Publicada en fuente `d007399d192d5443dfbd24e3834f3835424a7a2d`, Pages
`017676413bf66218c43ba86ca3ea58dbab8ca3e8`: la primera auditoría HTTP conserva
101 respuestas y pasa 891 condiciones de los 99 recursos offline. Pasan los
27 recorridos públicos al primer intento y la auditoría de sus respuestas,
incluidos PDF/EPUB offline. El recorrido público adicional de arrastre de libro
y planta también pasa al primer intento, con respuestas auditadas. El APK
1.1.8 real con esta web pasa los cinco estados nativos en `38150936761`;
su última captura sigue dentro del retorno, no acredita la inserción final.
La CI completa sigue en curso.

Por petición del usuario se prepara un instalador firmado nuevo 1.1.10,
versionCode 23. La compilación propia 38151541175 se canceló estando en cola
al detectar que otra rama prepara una prerelease 1.1.9/22 (38151206425);
esa compilación y su rama no se modifican ni se sobrescriben. No se cambia
el manifiesto de actualización hasta disponer
del APK real publicado y sus bytes/hash. Pasan 35 pruebas JS focales y las
105 comprobaciones Python/Android antes de lanzar su compilación.

**La reescritura completa sigue pendiente.** Interfaz, persistencia, Drive,
lector/audio y parte de la escena siguen en JavaScript. También falta medir
fluidez y consumo en un teléfono físico.
[Alcance, mediciones y trabajo pendiente](rust-migration.md).

## Historial anterior

# Continuación: 1.7.120 publicada; migración parcial a Rust

120 migra la clasificación de varios colores del relieve a Rust, manteniendo
los mapas exactos. La ruta se activa para tres o más colores y al menos 16.384
píxeles. Pasan 28 unitarias con el WASM real y 28 casos Chromium con CPU ×4.
Para diez colores a 341×512, la construcción de mapas pasa de 916,7 a 284,8 ms;
no representa FPS ni una medición de un teléfono físico.

También corrige el regreso de una importación en frío: conserva los píxeles
del lector hasta que el análisis inicial y el render de la estantería entregan
un hueco válido. La prueba funcional reproduce la desaparición en el control
anterior y pasa con el cambio, recorriendo todas las fases de inserción. Los
29 casos focales del cierre pasan. El build, las 3.863 unitarias (312 archivos),
105 comprobaciones Python/Android y los ocho recorridos originales locales
pasan al primer intento. Fuente `0e728e6400504a01d0d28e621e3af3bb553c40ee`,
Pages `b31e57eb1bd337aa0728fb01eac76875fe01de4a`: 101 respuestas HTTP,
99 recursos del shell y 889 condiciones correctas. Los 27 recorridos públicos
y sus respuestas auditadas pasan al primer intento, incluidos PDF/EPUB offline.
APK120 verificado: cinco estados nativos correctos y loader intacto; la captura final muestra el libro aún regresando, por lo que no acredita la inserción terminada. CI120: 596/598 E2E estrictos, dos fallos de cierre nativo y cero inestables; 11 artefactos autenticados sin omisiones.

119 está publicada en main `110d70ed8aba44d6ce8e3a0119578c4caef5a2bb`, Pages
`afba86d6aea4ac4fe2f1f30c65b90cedd9a594cb`: 27 recorridos públicos aprobados,
101 respuestas HTTP y 889 condiciones correctas. El APK38145829318 conserva
su cargador y pasa los cinco estados nativos; la captura final muestra el
libro colocado. Se observó a 34,939 s, sin acreditar una mejora global de
velocidad. CI119 terminó en **567/569 estrictos**, dos fallos originales de
regreso nativo y cero inestables; los 571 intentos y dos reintentos se conservan.
Once ZIP autenticados, doce jobs y cero incidencias de integridad. CI118 terminó
en 550/553 estrictos, dos fallos
y uno inestable. No se han ampliado los plazos originales de regreso nativo.

**La reescritura completa sigue pendiente.** Interfaz, persistencia, Drive,
lector/audio y parte de la escena siguen en JavaScript. También falta medir
fluidez y consumo en un teléfono físico.
[Alcance, mediciones y trabajo pendiente](rust-migration.md).

## Historial anterior

# Continuación: 1.7.119 preparada; migración parcial a Rust

119 añade el agrupamiento del color de portada al núcleo Rust, con RGB exactos
y sin bloquear la decodificación inicial. Los nueve casos con muestra válida
mejoran en Chromium CPU ×4; la muestra vacía conserva la salida directa del
host. El cierre reutiliza los píxeles independientes del lector y evita una
copia completa; el modo sin WebGL mantiene dos propietarios DOM separados.

Build de producción y **3.825 unitarias en 310 archivos** aprobados. Pasan doce
casos reales del color y cuatro cierres con comprobación de píxeles (PDF,
adaptable ilustrado en sepia, EPUB y sin WebGL). También pasan las 105
comprobaciones Python/Android y los ocho recorridos originales locales al
primer intento con sus plazos originales. Publicación y auditoría pública119
pendientes.

118 está publicada en main `b57b5ee8aea3890a6dddc4b0d3124c0419809cae`, Pages
`8beed00129527ef4aeca9a357353dbd3b4f5aa04`: 23 recorridos públicos aprobados,
100 respuestas guardadas correctas. El primer verificador comparó por error
el WASM119 local con el publicado118; la auditoría correctiva usa los mismos
originales y el build118 congelado, sin repetir descargas ni navegador.
El APK comprobado en38144600262 conserva su cargador y los cinco estados
nativos. Su captura de regreso a39,555 s está a mitad de animación y no prueba
la inserción final. CI118 pendiente; shard3 fallido. La CI117 completa termina
en542/545 estrictos, dos fallos y uno inestable. Todos se mantienen visibles.

**La reescritura completa sigue pendiente.** Interfaz, persistencia, Drive,
lector/audio y parte de la escena siguen en JavaScript. También falta medir
fluidez y consumo en un teléfono físico.
[Alcance, mediciones y trabajo pendiente](rust-migration.md).

## Historial anterior

# Continuación: 1.7.118 preparada; migración parcial a Rust

118 migra a Rust el bloque de páginas y las hojas visibles al abrir el libro,
manteniendo exactamente geometría, colores, índices y grupos de materiales.
101 pruebas focales y ocho casos reales de geometría en Chromium aprobados.
En Chromium CPU ×4, el bloque detallado tarda 0,0953 ms frente a 0,2453 ms;
son costes pequeños, no una medida de FPS de la aplicación completa.
También se conserva el filtrado de las texturas al regenerar el texto del lomo.
Build de producción, **3.793 unitarias en 308 archivos** y 105 comprobaciones
Python/Android aprobados. Los ocho recorridos locales pasan al primer intento
con sus plazos originales. Publicación118 pendiente.

117 está publicada: fuente `e137376068b82bc7051e85754c755b8334b3916d`, Pages
`bd5e3531b702e265d0169ff48f14a8eccbc88b26`. 3.774 unitarias/307 archivos,
105 comprobaciones Python, 100 respuestas HTTP/871 condiciones y **23 recorridos
sobre la web pública** aprobados. Su APK pasó los cinco estados nativos del
run38143049356. El regreso se confirmó a41,44 s en el emulador: la política
correcta no demuestra fluidez. CI117 todavía en ejecución; ya conserva dos
timeouts de regreso y un caso de importación que sólo pasó al reintentarse.
No se considera una batería completa aprobada.

**La reescritura completa sigue pendiente.** Interfaz, persistencia, Drive,
lector/audio y parte de la escena siguen en JavaScript.
[Alcance, mediciones y trabajo pendiente](rust-migration.md).

## Historial anterior

# Continuación: 1.7.117 preparada; migración parcial a Rust

117 añade la malla completa del lomo curvo y sus normales de grabado al núcleo
Rust/WASM. Las posiciones, UV, normales, índices y versiones de atributos
coinciden exactamente con el original. En Chromium con CPU ×4, el caso detallado
grabado pasa de 34,6 a 11,8 ms, incluyendo muestreo, copias y creación de geometría;
no es una medida de fluidez global ni de un teléfono físico.

La llegada de las fuentes conserva ahora botones, foco y geometría de la
estantería mientras renueva sus texturas. La regresión con el WOFF2 real falla
contra la web116 por sustitución de esos nodos y pasa en el build117.
La preparación de programas cancelada o fallida se puede reintentar en un
repintado ya necesario, sin temporizadores ni repintados de fondo adicionales.
Ocho casos reales de geometría en Chromium y 105 comprobaciones Python/Android
aprobados. Batería completa y publicación117 en curso.

116 sí se publicó: fuente `dbd6205ed7580c1b5717638533e3aff27ed5536b`, Pages
`0f586bb1c6234306e26ebc6db1f977093fdc083f`; 100 respuestas HTTP, 98 recursos del
shell y 866 comprobaciones correctas. Web publicada21/22: el fallo previo al
toque motivó la corrección de fuentes117. APK pública1.1.8 y sus cinco estados
nuevos en emulador aprobados en38141440469. CI116 conserva dos timeouts de
regreso nativo, distintos del fallo de fuentes; el cierre empieza muy cerca
del plazo total de30 s y no se han ampliado sus límites.

**La reescritura completa solicitada sigue sin terminar.** La interfaz, la
persistencia, Drive, lector/audio y buena parte de la escena siguen en JS.
[Alcance, mediciones y trabajo pendiente](rust-migration.md).

## Historial anterior

# Continuación: 1.7.116 preparada; migración parcial a Rust

Se ha descargado y revisado `origin/main` (`c83add7`) antes de los cambios.
Rust/WASM ejecuta la puntuación de fuentes, detección de columnas PDF, cinco
cálculos de relieve y la geometría del marcapáginas. Los datos guardados, las
pantallas y los motores de lectura conservan sus contratos actuales.
**La reescritura completa solicitada no está terminada.** UI, estado, Drive,
lector/audio y la mayor parte de la escena siguen en JavaScript.

Las comparaciones ejecutadas conservan buffers exactos. El ensayo de relieve
en Chromium con CPU ×4 registra entre 15 % y 46 % menos tiempo; el marcapáginas
reutilizado pasa de 4,16 a 1,10 ms por tanda en Node. Estas cifras no son medidas
de fluidez global ni de un teléfono físico. El APK público 1.1.8/code21 se ha
descargado otra vez: firma/hash y loader de 2.107 bytes correctos.
Batería final: 3.749 unitarias/306 archivos, 64 comprobaciones del núcleo final,
105 comprobaciones Python/Android y build aprobados. Despliegue y recorridos
públicos en curso.
[Alcance, mediciones y trabajo pendiente](rust-migration.md).

## Historial anterior

# Continuación: 1.7.115 publicada; rendimiento general pendiente

115 retira las esperas por fotograma introducidas en114: la observación
de GPU registra pausas de1,41–2,9 s en la salida y1,52 s en el zoom.
Se conservan medición/textura compartidas únicamente para páginas PDF
probadas idénticas, con píxeles exactos y calidad original.
3.680 unitarias/300 archivos, build y105 Python PASS; siete recorridos
originales locales PASS con los mismos plazos y sin retries.
Fuente `7eb558a827169fa17b459d934c9c7c503cb3b4c2`; Pages
`fbde21ba9947c61ef734042956c5d2e815498ee5`. HTTP32/shell96 exactos.
Web31/32 estrictos: el editor conserva un FAIL de captura vacía de textura
tras sus aserciones funcionales. Ambos regresos nativos públicos PASS.
Offline4 PASS; APK firma/hash/loader y cinco estados nuevos en emulador PASS.
CI completa38090753280 autenticada:531/533 PASS, dos regresos nativos
timedOut también en retry; once ZIP, doce jobs y535 intentos, sin
incidencias de colección. Las cuatro familias de voces con pesos reales
PASS. Variantes regionales adicionales y medición en teléfono físico
siguen pendientes. [Informe115](performance-1816.md).

CI114 completa autenticada:531/533 PASS, dos regresos nativos FAIL también
en retry; once ZIP, doce jobs y535 intentos, sin incidencias de colección.
Las cuatro familias de voces con pesos reales PASS. Web real30/32 estrictos:
dos capturas vacías conservan FAIL. Los blobs reales observados en un
diagnóstico nuevo son íntegros, pero eso no explica ni sustituye los fallos.
Offline4 PASS con el contrato de papel compartido; APK público y cinco
estados nuevos del emulador PASS. El rendimiento general sigue pendiente.

## Historial anterior

# Continuación: 1.7.114 publicada; auditoría completa en curso

Fuente `140a6a3bc59251899db3cce4d0144753c8714a2e`, Pages
`bed38881fc6fe7f48a78a1dd1b1b48eb9f4e0466`. Se limita la cola GPU de la
animación y se comparten medición y textura de páginas PDF idénticas.
Cinco poses con RGBA exacto; no cambian resolución, sampler ni materiales.
3.680 unitarias/300 archivos, build y105 Python PASS.
Originales locales:seis PASS, un regreso393px FAIL sin muestras nativas.
Web real HTTP32/shell96 PASS; APK1.1.8/code21 descargado, firma/hash/
loader2.107 B PASS. Recorridos publicados, CI completa38088707648 y
comprobación nueva del APK en emulador38088872659 en curso. Los fallos
anteriores permanecen conservados; no se declara todo terminado.
[Informe114](performance-1815.md).

## Historial anterior

# Continuación: 1.7.113 publicada; rendimiento general pendiente

Fuente `c52169680895e89fe7970570dc2a4d546332e91c`, Pages
`b2e0a5fcee4ca249073b8e4bf5a4c885deda384a`. Se reutilizan las portadas
detalladas con8 MiB de caché global y se evitan reinicios vacíos del lienzo
cuando ambos ejes crecen. No se rebaja resolución ni calidad de materiales.

3.645 unitarias/296 archivos, build,105 Python y siete originales locales
PASS. Web32 casos:30 auditorías estrictas PASS, dos capturas HTTP200/0 B
FAIL aunque las aserciones funcionales terminaron. Cuatro recorridos offline
PASS. Grafo HTTP32/shell96 exactos. APK1.1.8/code21: firma, hash y loader
de2.107 B PASS; cinco estados nuevos del APK público en emulador PASS.

CI113 completa y autenticada:531/533 PASS y dos FAIL nativos, también
fallidos en retry. Once ZIP, doce jobs y535 intentos conservados, sin
incidencias de colección. Las cuatro familias de voces con pesos reales
pasan. Las trazas llegan a Back a los24–27 s del recorrido; quedan3–6 s
del límite global30 s. No acreditan el plazo completo de8 s del cierre
ni permiten atribuir toda la lentitud a esa fase.
CI112 autenticada:530 PASS al primer intento, un flaky
Abrir con y dos FAIL nativos. Esos fallos siguen pendientes, junto con la
causa de las capturas HTTP vacías. El diagnóstico de nueve cargas reales
de nogal conserva todos sus blobs completos y no reproduce el fallo.

Voces:39 Piper y diez personas Supertonic/220 perfiles. Sin incorporaciones
en111–113. Dos nuevas candidatas chinas requieren frontend pinyin/g2pW;
no se anuncian como compatibles ni se han comprobado con sus pesos.
Sin medición de teléfono físico ni prueba de cuenta Google humana.
[Informe actual y límites](performance-1814.md).

## Historial anterior

# Continuación: 1.7.113 preparada / 1.7.112 publicada

112 limita los píxeles retenidos de portadas ampliadas a 8 MiB globales.
3.642 unitarias/295 archivos, build y105 Python PASS. Web32/32 estrictos,
offline4, HTTP32/shell96 y APK firma/loader PASS. Cinco estados del APK
público en emulador PASS. El primer lote local conserva un FAIL ENOSPC;
tras recuperar el entorno, su único caso afectado pasa por separado.
CI112 completa pendiente. [Informe112](performance-1813.md).

113 evita dos reinicios vacíos del lienzo en cinco poses reales del libro,
con RGBA, dimensiones y viewport exactos. 83 focales y dos originales
SwiftShader PASS; batería y publicación pendientes. [Informe113](performance-1814.md).
CI111 autenticada: 531/533 PASS, dos regresos nativos timedOut también en
retry. Los tres fallos originales de captura111 permanecen FAIL.
El rendimiento global sigue pendiente; no hay medición de teléfono físico.

## Historial anterior

# Continuación: 1.7.112 preparada / 1.7.111 publicada

111 reutiliza la impresión detallada de la portada. Batería local 3.639/295,
build y 105 Python PASS; siete originales locales, HTTP32/shell96, offline4
y APK 1.1.8 firma/loader PASS. Web real: 29/32 auditorías estrictas PASS;
tres capturas parciales/vacías de walnut conservan FAIL aunque sus aserciones
de producto completaron. Emulador nuevo: cinco estados nativos PASS.
CI111 completa sigue pendiente. [Informe111](performance-1812.md).

112 limita globalmente a 8 MiB RGBA los píxeles retenidos de portadas ampliadas.
112 focales PASS; la expulsión real conserva textura y tres fotogramas GPU
exactos. Batería, publicación y comprobación112 pendientes. El rendimiento
global no se considera resuelto. [Informe112](performance-1813.md).

## Estado publicado anterior

# Web 1.7.110 publicada; rendimiento pendiente

Se preparan en reposo los materiales reales del libro ampliado y se libera
su modelo temporal. Después de completar esa preparación, la selección
instrumentada enlaza un shader frente a cinco del control. Las muestras de
tiempo no prueban una mejora sostenida. Las capturas de sala difieren en el
área del lomo; no se certifican píxeles iguales ni se atribuye su causa.

Batería definitiva: 3.629 unitarias/293 archivos, build y 105 Python PASS;
siete recorridos originales locales PASS, sin retries ni cambios de plazos.
Fuente pública `c349ed715258032739dc4cf68c65decb2eedf61c`: grafo (32) y shell (96)
coinciden con Pages. CI110 completa y autenticada: 531/533 casos PASS,
dos timeouts nativos en primer intento y retry. Web real: 31/32 auditorías
estrictas PASS; una captura parcial de textura conserva FAIL. Cuatro offline
PASS para bytes/progreso y fotos. Drive mantiene la subida manual opcional.

APK 1.1.8/code21 descargado y verificado: firma y loader de 2.107 B correctos.
Ensayo nuevo del APK público: cinco estados nativos PASS. Preflight Google
sin error de solicitud; no acredita una cuenta humana conectada. Las cuatro
familias de voces con pesos reales PASS: siguen 39 Piper y diez personas
Supertonic (220 perfiles), sin voces nuevas. No hay medición de FPS, calor,
batería o audio prolongado en teléfono físico. Quedan por resolver los dos
recorridos lentos de CI y explicar la captura parcial de textura.
[Resultados y límites de esta continuación](performance-1810.md).

## Estado publicado anterior

# Web 1.7.109 publicada; rendimiento pendiente

Se prepara el renderer del libro seleccionado durante el reposo de la sala.
45 focales y los dos recorridos nativos originales pasan. La selección
instrumentada enlaza cinco programas frente a doce del control; la sala
conserva su imagen exacta. Las muestras de tiempo no prueban una mejora
sostenida. Batería: 3.620 unitarias/293 archivos, build y 105 Python PASS.
Siete originales locales y dos SwiftShader PASS, con límites originales.

Fuente pública `3f2591521aa975b6f432a1990f5f10f235c2296b`; grafo HTTP y
shell offline coinciden con Pages. CI109 completa: 531/533 casos PASS;
dos regresos nativos agotan el plazo tanto en el primer intento como en el
retry. Los once ZIP originales y su censo completo quedan autenticados.
Web real: 30/32 auditorías estrictas PASS; dos capturas de walnut con
HTTP 200/0 B conservan FAIL aunque sus aserciones funcionales pasan.
Cuatro recorridos offline PASS: bytes/progreso y fotografías con su RGB
original en todos los temas probados. Drive conserva la subida opcional.

APK público actual 1.1.8/code21: descarga, hash, firma y loader de 2.107 B
verificados de nuevo. Verificación nueva en emulador del APK publicado:
cinco estados PASS para barra de estado, insets y bloqueo de pantalla.
El preflight de Google no muestra redirect_uri_mismatch; no acredita una
sesión humana autenticada. Voces con pesos reales: cuatro familias PASS,
incluidos 220 perfiles Supertonic; siguen diez personas y 39 voces Piper.

El candidato posterior que esperaba uniforms antes del primer dibujo
añadió 2–3 s en la comparación y se descartó. Runtime restaurado idéntico
a 109. El rendimiento global y las dos capturas de textura siguen pendientes;
no hay medición nueva de FPS, calor o batería de un teléfono físico.
[Detalle de esta continuación](performance-1809.md).

## Historial anterior

# Estado actual: web 1.7.106 publicada, rendimiento pendiente

La fuente publicada es `666519c0413a75bf6839e9f9fdc6b15dd5afb433`.
La mejora envia al driver el lote inicial de compilacion del libro,
sin cambiar modelos, shaders, luces, DPR ni duraciones.

- Bateria local: 3591 unitarias en 291 archivos, build y 92 Python PASS.
- Siete recorridos originales locales y dos SwiftShader PASS, sin retries.
- Web real: 32 casos funcionales PASS; 31/32 auditorias estrictas PASS.
  La captura original de una textura walnut devuelve 0 B y conserva FAIL.
- Cuatro recorridos offline PASS: bytes/progreso, fotos en cinco temas,
  portada JPEG y cierre inmediato. Drive conserva su subida opcional.
- APK publico 1.1.7/code20: descarga, SHA, firma y loader de 2107 B PASS.
  No se publico un APK distinto por este cambio exclusivo de la web.
- CI106 conserva ambos recorridos nativos FAIL en primer intento y retry.
  Las trazas llegan a Back a los 26-27 s, casi todo su presupuesto total
  de 30 s. CI completa: 524/526 casos PASS; ambos fallan también al reintentar.
  Los otros cinco bloques de interfaz y las cuatro familias de voces PASS.
- Experimento separado: seis ejecuciones reciben los Blobs de texturas
  completos. No reproduce ni sustituye el fallo original de captura.

El rendimiento completo NO se considera resuelto. No hay medicion de
FPS, calor ni bateria de un telefono fisico. El catalogo sigue con 39
voces Piper y diez personas Supertonic (220 perfiles de idioma), sin
nuevas voces en esta version. [Evidencia y limites](performance-1806.md).

## Historial de verificacion

# Continuacion: web1.7.105 publicada y verificada / CI completa pendiente

105: bateria3587/291, build y92 Python PASS; siete locales y dos
SwiftShader originales PASS sin retries/deadlines intactos.32/32
publicos estrictos, offline4 y APK1.1.7 SHA/firma/loader PASS.
Preparacion del marcapaginas real y de materiales ocultos en idle.
CI105 completa37563781668 pendiente; no se declara todo terminado
ni rendimiento medido en telefono fisico. [Detalle105](performance-1805.md).

# Continuacion: web1.7.105 candidata /104 publicada

105 prepara el marcapaginas desde la pagina real y completa shaders
ocultos en idle tras una apertura inmediata.44 focales PASS; full en curso.
Los originales y sus deadlines se conservan. No se afirma una mejora
sostenida por las muestras aisladas. [Detalle105](performance-1805.md).

104 publicada, bateria3576/291 y92 Python PASS, offline4/locales7 PASS,
APK1.1.7 firma/loader PASS. CI104 conserva dos cierres nativos FAIL en
primer intento y retry. PDF18 funcionales PASS,17/18 auditoria estricta
por una captura HTTP0B; el fallo se conserva. [Detalle104](performance-1804.md).

# Continuacion: web 1.7.104 preparada / 1.7.103 publicada

1.7.104 reduce resets intermedios del framebuffer de la estanteria.
68/68 focales, 18 pares RGBA exactos y ambos regresos originales SwiftShader
PASS. Se conservan plazos originales30s/8s. La bateria completa esta en curso;
publicacion y comprobacion del artefacto104 pendientes. [Detalle](performance-1804.md).

103 publicada:32/32 publicos estrictos, cuatro offline, siete locales,
smoke original y APK real1.1.7/firma/loader PASS. Primera portada retenida
al cerrar rapidamente. Bateria3.567/291, build y92 Python PASS. CI103
conserva un primer fallo8s en393px; retry no lo borra. CI102 completa
526/526 sin retries/fallos, incluidas voces reales. [Detalle103](performance-1803.md).

# Continuacion: web1.7.103 preparada /102 publicada y verificada

Primera portada: la captura puede terminar mientras se cierra el lector;
las mejoras opcionales de resolucion se cancelan. Se libera el documento
retenido al terminar y se conservan los controles de sesion/revision.
41 focales y bateria3.567/291, build y92 Python PASS. Dos regresiones de
sesion del primer full quedan registradas, corregidas sin alterar sus tests.
Original smoke/publicacion/web real/CI103 pendientes.102:32/32 publicos,
offline3, siete locales y APK/firma/loader PASS.267 originales CI102 sin
retries ni fallos; ambos cierres dentro de8s. [Detalle103](performance-1803.md).

# Continuacion: web1.7.102 publicada y verificada / Android1.1.7 verificado

HTTP32/shell96,32/32 publicos estrictos, offline3 y siete originales locales
PASS, cero retries. Bateria3.555/291, build y92 Python PASS. Canvas activo
sin reajustes de altura; geometria/DPR/materiales preservados en90 pares
RGBA integrados exactos. CI102 pendiente de auditoria completa. CI101
completaFAIL:526/529, UI3 y una pipeta sin portada en UI6; voces reales PASS.
Se prepara una correccion para que cerrar rapido no descarte la primera
portada aun pendiente. [Detalle102](performance-1802.md).

# Continuacion: web1.7.102 preparada / Android1.1.7 verificado

Se evita el reajuste de altura del canvas activo mediante una reserva
pequena ya existente, conservando DPR, viewport y posicion.180 pares RGBA
exactos entre prototipo y fuente integrada PASS;35 pruebas enfocadas y
bateria3.555/291, build y92 Python PASS. Dos regresos originales SwiftShader
PASS con tiempos30s/8s intactos. Cierre medido5.970,2ms: no acredita mejora
total frente al diagnostico100. Publicacion/web real/CI102 pendientes.
CI100 completaFAIL en ambos regresos nativos; todos sus otros grupos PASS.
[Detalle](performance-1802.md).

# Continuacion: web1.7.101 publicada / Android1.1.7 verificado

Abrir con da prioridad al lector y aplaza la sala3D hasta volver a home.
Se descarta la lectura inicial antigua para recuperar el libro recien
guardado. Bateria final3.536 unitarias/290 archivos, build y92 Python PASS.
Ocho regresiones nuevas; las esperas de los E2E originales siguen intactas.
Los cuatro Android originales con SwiftShader PASS y los cuatro publicos
con identidad del main PASS. HTTP32/shell96, offline3 PASS; publico31/32
estricto: un cuerpo walnut0B/HTTP200 en PDF noche conserva FAIL. Los siete
locales integrados PASS, cero retries. CI101 sigue en curso. CI100 conserva
ambos regresos nativos30s/8s FAIL, incluido un cierre de8915,6ms; falta
la auditoria completa de los ZIP originales (ya terminada:526/528,11 ZIP). Todos sus otros grupos y
cuatro familias de voces reales concluyen PASS. No se afirma resuelta toda la lentitud ni se
acreditan FPS/bateria en telefono fisico. [Detalle](performance-1801.md).

# Continuacion: web1.7.100 publicada / Android1.1.7 verificado

1.7.100 evita resetear el framebuffer por una reduccion pequena de ancho;
conserva proyeccion, DPR y escala CSS.60 pares RGBA exactos contra1.7.99
PASS;41 pruebas enfocadas y bateria3.528/289, build y92 Python PASS.
Web real28/28 estrictos, tres recorridos offline y nueve originales locales
PASS, sin retries. HTTP32/shell96 y descarga nueva del APK/firma/loader PASS.
CI100 original completa sigue pendiente. No hay medicion del movil fisico.
Web99 publicada:HTTP32/shell96, titulo/autor, ambos regresos nativos,
18 PDF, cinco catalogo/plantas/luces y tres offline PASS.27/28 publicos
estrictos; auditoria walnut0B permaneceFAIL. CI98 completaFAIL en dos
regresos nativos30s/8s; otros cinco shards y cuatro familias de vocesPASS.
CI99 conserva tambien una primera importacion Android8s fallida; no se
ha alterado la espera ni contado el retry como aprobacion. Verificacion
original completa99 FAIL:526 casos/529 intentos, tres retries y cinco
intentos fallidos; UI1 yUI3. APK20/firma/loader y mas de6min de audio
bloqueado/23 capitulos en emulador PASS. No se declara resuelta toda
la lentitud ni se acredita rendimiento/bateria del movil fisico.
[1.7.99](performance-1799.md), [1.7.100](performance-1800.md).

# Continuacion: web1.7.99 preparada / Android1.1.7 publicado

Web1.7.98:27/27 publicos estrictos,10 locales originales y tres recorridos
offline PASS. Se conservan todos los fallos anteriores; CI original98
sigue pendiente. APK1.1.7/codigo20 real, firma y loader2107B verificados;
audio bloqueado mas de6min y23 capitulos PASS en emuladorAndroid15.
1.7.99 conserva titulo y autor editados al revelar el lector precargado.
Reproduccion3PASS/1FAIL antes y4PASS despues; bateria3.512/288, build y
92 Python PASS. Original E2E/publicacion/verificacion99 pendientes.
No se declara resuelta toda la lentitud: CI97 conserva tiempos globales
30s y cierre8s fallidos. Hay que revisar sus trazas originales.
[1.7.98](performance-1798.md), [1.7.99](performance-1799.md).

# Continuación: web1.7.98 preparada / Android1.1.7 publicado

Web1.7.97 publicada y contrastada con HTTP32/shell96, nueve recorridos
locales originales, offline con fotos/bytes/posición115 y portada800x1600.
Tanda pública24/26 estrictos: dos fallos de auditoría de textura vacía
quedan conservados. APK1.1.7 descargado, firma/loader2107B y manifiesto20
verificados; audio bloqueado más de6min/23 capítulos en Android15 PASS.
CI completa de1.7.97 pendiente. La traza del gesto del editor revela una
pestaña distinta bajo un encabezado invisible;1.7.98 enlaza el encabezado
con la pestaña activa visible.49 comprobaciones enfocadas PASS; batería
completa3.508/287, build y92 Python PASS; gesto original con SwiftShader
PASS sin retries ni cambios del límite2.200ms. Publicación en curso.
[1.7.97](performance-1797.md), [1.7.98](performance-1798.md).

# Continuación — web 1.7.97 / Android 1.1.7 en construcción

Se agilizan las fases de apertura y cierre: apertura programada de 1.820 a
1.380ms y regreso al hueco de 1.929,6 a 1.529,6ms. Batería local:
3.505 unitarias/286 archivos, build y92 Python PASS. Censo526 sin skips,
todavía no ejecución completa. Geometría, texturas y límite de pasos
permanecen idénticos. Android1.1.6 real está verificado;1.1.7/código20
corrige el final del audio tras una pausa de planificación larga.
Recorridos originales, web/offline, CI completa y APK20: pendientes.
[Detalle y alcance](performance-1797.md).

# Continuación — web 1.7.96 / Android 1.1.6 preparado

Se integran los cambios EPUB/audiolibro de d2e9295 y 5f43d04. Se corrige
el retraso de audio Android que podía impedir completar el último fragmento
y que sobrevivía a un reset/flush. Batería local: 3.499 unitarias/285 archivos,
build y 91 Python PASS. Censo526 sin skips, todavía no ejecución completa.
APK1.1.5 real y firma/loader verificados;1.1.6/código19 requiere su build.
Web/API públicas y CI de la nueva fuente están en comprobación.
No se declara resuelta toda la lentitud: dos aperturas nativas8s fallan en
la CI anterior; también se conserva un cierre SwiftShader fallido.
[Detalle y alcance](performance-1796.md).

# Verificación en curso — web1.7.94 y Android1.1.5 preparado

Se integra la web1.7.93 de GitHub antes del cambio de caché del estudio.
Pasan 3.493 unitarias/284 archivos, build, 84 comprobaciones Python,
18 pares RGBA exactos, atlas de producción idéntico al recargar y nueve
recorridos locales principales/regresiones sin retries. La auditoría
independiente conserva el error original de censo525 y acredita526 casos
listados: todavía no se ha ejecutado toda la nueva CI. Android1.1.5/código18
está preparado; el manifiesto conserva1.1.4 hasta que pase y se publique.
PDF/catálogo, CI completa y web/APK públicas: pendientes.
[Detalle y límites](performance-1794.md).

# Verificación del WIP — web1.7.91 publicada y Android1.1.4

## Reserva por fases 1.7.91 publicada

Libera la reserva grande después del zoom de cierre; las siguientes fases
conservan su DPR y reservas por movimiento. Pasan 3.474 unitarias/280
archivos, build, 75 Python, 18 pares RGBA, 34 recorridos locales y 26
recorridos públicos con sus auditorías, sin retries en esas tandas.
HTTP 32/shell 96, APK/loader descargados, temas y portada offline, bytes
locales y posición 115 al recargar/reabrir: PASS. Se desbloqueó Pages con
un único reenvío del árbol idéntico; se conserva la identidad fallida inicial.

CI original completa FAILED: 524 casos/526 intentos; dos casos de apertura
nativa fallan también en sus retries (cuatro intentos fallidos). El PDF no
se hace visible para la espera original de ocho segundos. Cinco UI y las
cuatro tandas de voces reales PASS. La lentitud global sigue pendiente;
no se afirma FPS móvil ni login real de Google. [Detalle](performance-1791.md).

## Reducción del framebuffer1.7.90 publicada

53 focales,3468/279 unitarias, build/75 Python,18 pares RGBA exactos y11
recorridos locales originales PASS sin retries. HTTP32/offline96, descarga
APK/loader, PDF/papel/portada en cinco temas e importación/reapertura local
con bytes y locator115 exactos PASS. Público22/26 estrictos: cuatro fallos
de cuerpo de textura observado como0; no se sustituyen por sus cuerpos
funcionales correctos ni por seis diagnósticos separados sin reproducción.
CI37439363327 completa FAILED:524 casos/527 intentos,3 retries,5 fallos
en UI3/6. Ambos cierres nativos fallan tambien al repetir; isometrica
falla primero al arrancar y pasa su retry, aun flaky rechazado. Cuatro
tandas de voces reales y otras cuatro UI PASS. [Detalle](performance-1790.md).

## Preparación de página1.7.89 publicada

La página oculta entrega su lote de shaders antes de consultar si está
preparado. Siete regresiones nuevas,35 enfocadas,3462/278 unitarias,
build y75 Python PASS. Dieciséis recorridos gráficos locales originales y
26 de la web publicada con auditorías PASS, sin retries. HTTP32/offline96,
PDF e imágenes en cinco temas, portada offline, importación y reapertura
con bytes/locator115 exactos y descarga APK/loader reales PASS.

CI37433923469 completa FAILED:524 casos/527 intentos,3 retries,5 intentos
fallidos sólo UI3. Regreso alineado supera30s; fraccionario falla al abrir
PDF8s; luces falla primero y pasa su retry, todavía rechazado como flaky.
Otras cinco UI y cuatro tandas de voces reales PASS. No se considera toda
la lentitud resuelta. [Detalle y límites](performance-1789.md).

## Guardado de progreso1.7.88

Se agrupan sólo posiciones pendientes contiguas de cada libro. La escritura
activa y los ajustes/historial respetan su orden. Cierre y apertura esperan
la posición final; los bytes siguen locales y Drive se programa tras guardar.
Siete nuevas y43 relacionadas PASS;3455 unitarias/277 archivos, build y75
Python PASS. IndexedDB real1/16MB conserva bytes/portada/progreso/ajustes:
dos commits para una escritura activa y1000 avisos pendientes. Catorce
recorridos normales, dos SwiftShader originales y reanudación EPUB PASS,
cero retries y plazos intactos. No mide FPS ni velocidad de teléfono.
Deploy, pin de los bytes HTTP32/offline96 y nueva descargaAPK/loader PASS.
Papel en cinco temas y portada offline PASS; catálogo5 PASS. Dos auditorías
públicas de texturas observadas como0 fallan: principales2/3 yPDF17/18
aprobados, aunque los cuerpos funcionales pasan. Originales conservados,
24/26 públicos aprobados,0 retries. CI nueva todavía en marcha.
[Detalle](performance-1788.md).


Un marcador existente conserva malla, material, alphaMap y buffers al guardar
progreso. Geometría, acabado y pose conservados; la primera cinta se crea como
antes. Seis nuevas y100 relacionadas PASS;3448 unitarias/276 archivos, build
más75 Python PASS. Dieciocho paresRGBA y14 recorridos normales PASS, cero
retries. SwiftShader adicional: alineado PASS, fraccionario FAIL por cierre8s.
Deploy, HTTP32/offline96, nueva descargaAPK/loader y26 recorridos públicos
con sus auditorías PASS. Papel en cinco temas y portada offline PASS.
CI completa37425792376 FAILED:524 casos/528 intentos,4 retries/6 fallos en
UI1/3/6; cuatro tandas reales de voces y las otras tres UI PASS. Fallos
originales retenidos; no resolución completa de la lentitud.
[Detalle](performance-1787.md).

## Composición de sala 1.7.86 publicada

El shader del replay de sala prepara uniforms en intervalos libres después
de la primera pintura, evitando su preparación inicial dentro del regreso.
Sin captura, dibujo ni cambios de shaders o resolución; cancelación por
propietario/contexto/generación/dispose. Seis nuevas y31 enfocadas PASS;
3442 unitarias/275 archivos, build y75 Python PASS. Tres composiciones
WebGL2 conservan cada píxel. Los14 recorridos normales, dos cierres originales
adicionales con SwiftShader y el caso de planta vecina PASS, cero retries.
Deploy y pin de los bytes públicos PASS; HTTP32/offline96 y nueva descarga
APK/loader PASS. Los26 recorridos públicos y auditorías PASS, cero retries.
Papel/portada offline PASS; CI completa524 FAILED sóloUI3:527 intentos,
3 retries y5 fallos. Las cuatro tandas de voces y otras cincoUI PASS;
no prueba de rendimiento móvil.
[Detalle](performance-1786.md).

## Preparación de la inserción 1.7.85 publicada

Los mismos programas de profundidad y del indicador preparan también sus
uniforms, uno por intervalo libre después del primer frame. Sin dibujo,
cambios de materiales/resolución/relojes ni nuevas variantes. Cancelación
por dispose y errores mantienen el dibujo normal. Seis nuevas y 30 pruebas
enfocadas PASS. Pasan 3.436 unitarias/274 archivos, build, 75 Python y
14 recorridos normales. Los dos cierres adicionales de SwiftShader pasan
en su primer intento, con plazos originales. HTTP32/offline96, nueva APK/loader y papel/portada
offline PASS. Los26 recorridos públicos y auditorías PASS, cero retries.
CI completa524 FAILED en UI3, UI4 y UI6:528 intentos/4 retries/7 intentos
fallidos, sin omisiones. Las cuatro tandas reales de voces PASS. El retry
aprobado de luz3 sigue siendo flaky rechazado por el gate original.
Aún no se da por terminado.
[Detalle](performance-1785.md).

## Diagnósticos de shaders 1.7.84 publicada

Producción evita consultas de logs sincrónicos; desarrollo y callbacks
personalizados conservan los diagnósticos. 34 pruebas enfocadas, 3.430
unitarias/273 archivos, build y 75 Python PASS. Dieciocho pares de imágenes
WebGL2 exactos; consultas de logs 30 a cero sin cambiar materiales o resolución.
Catorce recorridos normales locales PASS; dos cierres adicionales con
SwiftShader FAIL a 8 s. HTTP32/offline96, descarga nueva APK/loader y papel
más portada offline PASS. Casos públicos: recorridos 2/3, PDF 17/18 y
catálogo 5/5; dos fallos de auditoría de una textura observada vacía al
terminar casos cuyas aserciones funcionales pasaron. Los originales
fallidos permanecen registrados. CI completa524 FAILED: dos cierres en
UI3 y recarga del nogal con tres luces en UI6, también en retries. Las
cuatro tandas reales de voces PASS.
No se considera resuelta toda la lentitud. [Detalle](performance-1784.md).

## Reserva compacta de animación 1.7.83

Apertura y cierre nativos mantienen el mayor recorte necesario durante la
secuencia, creciendo sólo cuando hace falta. Once unitarias enfocadas PASS
y 18 comparaciones WebGL2 exactas. La propuesta anterior de viewport completo
se conserva descartada por dos cierres fallidos en software. Ningún plazo
original se amplía. Batería revisada: 3.424 unitarias/272 archivos, build,
75 Python y 14 recorridos gráficos PASS sin retries. Software adicional:
alineado PASS, fraccionario FAIL a 8 s. HTTP32/offline96 y nueva descarga APK/loader PASS. PDF18 y catálogo5 públicos
PASS, papel/portada offline PASS. Tres recorridos públicos: 2 PASS/1 FAIL
de auditoría por dos texturas con cuerpo0 observado; recorrido funcional
correcto y HTTP independiente aprobado no sustituyen la auditoría fallida.
CI completa FAILED: sólo UI3 falla dos aperturas nativas, también en retry.
Las cuatro tandas reales de voces pasan; no se considera terminado.
[Detalle](performance-1783.md).

## Entrega de shaders de 1.7.82 publicada

El lote completo se entrega al driver antes de consultar su preparación;
no se espera ni se modifica el renderizado. Cuatro de seis regresiones nuevas
reproducen la ausencia de entrega anterior. Pasan 24 enfocadas, 3.417
unitarias/271 archivos, build y 75 Python. Pasan siete recorridos gráficos,
cinco de catálogo/plantas/luces y dos regresiones adicionales, sin retries
ni cambios de límites o fuente durante las tandas. HTTP32/offline96, nueva
descarga APK/loader, tres recorridos públicos, 18 PDF y papel/portada offline
PASS. Cinco casos públicos de catálogo PASS: 26 recorridos públicos
aprobados sin retries. CI original FAILED en UI3/6: 524 identidades,
528 intentos, cuatro retries/ocho fallos. Dos aperturas nativas y primer
frame de lámparas tras recarga no cumplen los plazos originales;
unitarias, cuatro trabajos de voces y restantes UI PASS. Originales completos.
[Detalle](performance-1782.md).

## Origen de la estantería de 1.7.81 publicada

Cada estructura HTML conserva su propio ajuste de posición. Sustituirla
restaura la anterior y alinea la primera pintura de la nueva, conservando
el canvas y renderer. Tres regresiones reproducen el fallo anterior;
pasan 28 pruebas enfocadas, 3.411 unitarias/270 archivos, build y 75 Python.
Pasan siete recorridos gráficos, cinco de catálogo/luces y dos regresiones
adicionales, sin retries. HTTP32/offline96, nueva descarga APK/loader y
conservación exacta del atlas real al actualizar 80→81 PASS. Los 26
recorridos públicos y papel/portada offline PASS, sin retries. CI original
FAILED en UI3/6: 524 identidades/527 intentos, tres retries/seis fallos;
unitarias, todas las voces y restantes UI PASS. Censo y originales completos.
[Detalle](performance-1781.md).

## Caché de iluminación de 1.7.80 publicada

La huella automática del código 3D y de Three permite conservar el mismo
atlas entre actualizaciones del lector o app que no cambien esas entradas.
Pasan 45 pruebas enfocadas, 3.407 unitarias/269 archivos, build y 75 Python.
Pasan siete recorridos gráficos, cinco de catálogo y dos regresiones
adicionales sin retries. HTTP32/offline96 y APK/loader descargados PASS;
cinco casos públicos de catálogo, papel/portada offline y atlas real al
recargar PASS. PDF conserva 17 PASS/1 FAIL de auditoría HTTP. La tanda
gráfica pública conserva 2 PASS/1 FAIL de origen fraccionario y textura vacía.
CI original FAILED sólo en UI6: primer frame de tres luces tras recarga a
8 s, dos intentos fallidos; 524 identidades/525 intentos, voces y UI1–5 PASS.
Se mantienen píxeles, iluminación y resolución.
[Detalle](performance-1780.md).

## Captura de PDF de 1.7.79 publicada

La app reutiliza el diseño sólo para una página física completada e intacta;
un tamaño nuevo se renderiza primero. Conserva copias, píxeles y el contrato
DOM, sin cambiar relojes. Pasan 84 pruebas enfocadas, 3.393 unitarias en
267 archivos, build y 75 Python. Los siete recorridos de animación, cinco de
catálogo y dos regresiones adicionales pasan sin retries. HTTP32/offline96,
APK/loader, 18 PDF y cinco de catálogo publicados PASS. Papel default y
optimizado offline coinciden píxel a píxel en cinco temas; portada PASS.
La tanda pública de tres conserva un FAIL de auditoría de textura vacía,
aunque sus aserciones funcionales pasan. CI original FAILED en UI3/6,
524 identidades/528 intentos, cuatro retries/seis intentos fallidos;
unitarias, todas las voces y restantes UI PASS. [Detalle](performance-1779.md).

## Reserva de la sala de 1.7.78

El renderer compartido agrupa DPR y tamaño también al capturar la sala e
insertar el libro. Cinco regresiones nuevas conservan su estado final y
eliminan tres reservas intermedias. Pasan 3.389 unitarias/266 archivos, build,
75 Python, ocho comparaciones de píxeles y siete recorridos gráficos originales.
Catálogo conserva cuatro PASS y un FAIL de primer frame de luces tras recarga
a 8 s. HTTP32/offline96 y APK/loader PASS; 18 PDF, cinco de catálogo y dos
regresos nativos públicos PASS. Editor conserva un FAIL de auditoría de
textura vacía. Papel y portada offline PASS. CI original FAILED en UI3/6:
cierre nativo a 8 s y dos casos flaky tras recarga. Todas las voces reales
y restantes UI PASS; no se afirma aprobación global.
[Detalle](performance-1778.md).

## Catálogo oculto de 1.7.77

La descarga se prepara en idle sin construir su estudio GPU oculto. Pasan
47 pruebas enfocadas, 3.384 unitarias/265 archivos, build y 75 Python.
Pasan los siete recorridos de animación y cinco de catálogo/plantas/luces
sin retries. Publicación HTTP32/offline96, APK/loader y 26 recorridos
públicos PASS; papel y portada offline PASS. CI original FAILED en UI3/6:
apertura nativa y primer frame de luces; todas las voces reales PASS.
[Detalle](performance-1777.md).

## Reserva nativa del libro de 1.7.76

La vista 3D evita el framebuffer intermedio de un resize que cambia ambos
ejes. Mantiene dimensiones finales, DPR, píxeles, modelos, iluminación y
relojes. Pasan 55 pruebas enfocadas y ocho comparaciones de píxeles reales.
Pasan 3.382 unitarias/264 archivos, build, 75 Python y siete recorridos
gráficos originales sin retries. Publicación HTTP y APK/loader PASS;
21 recorridos públicos originales PASS sin retries; papel offline en cinco
temas PASS. CI original FAILED en UI2/3; voces y restantes UI PASS.
[Detalle](performance-1776.md).

## Apertura y contador de programas de 1.7.75

Preparación de uniformes de los mismos shaders mientras espera la portada,
en turnos idle, y corrección del contador publicado tras la preparación de
la estantería. Pasan 98 pruebas enfocadas en cinco archivos. Publicada e
integrada con las correcciones de lámparas y catálogo hasta `1864695`:
3.373 unitarias/263 archivos, build, 75 Python, siete recorridos locales y
21 públicos PASS, HTTP32/offline96 y APK/loader reales PASS. Papel y portada
PDF publicados funcionan offline. CI original mantiene sus fallos nativos;
no se afirma aprobación global. [Detalle](performance-1775.md).

## Texturas PDF de 1.7.74

Subida la reutilización de las texturas exactas de un mismo render PDF: no
se vuelven a generar ni a subir a GPU al cerrar si los píxeles y dimensiones
siguen siendo los mismos. Cambiar página, tema, brillo, tamaño o documento
invalida la identidad. Pasan 3.353 unitarias/262 archivos, build, 75 Python,
siete recorridos locales y 21 públicos sin retries. HTTP32/offline96,
papel offline en cinco temas, portada offline y APK/loader descargados PASS.
CI conserva los fallos originales de UI3 y UI4; no se afirma aprobación
global. [Detalle](performance-1774.md).

## Publicación combinada de 1.7.73

La fuente `2094a19` incorpora los cambios posteriores de arranque y caché de
plantas, superficies y estudio que ya habían llegado a GitHub. Pasan 3.348
unitarias/261 archivos, build y 75 Python. HTTP32/offline96 y los tres
recorridos públicos originales de editor/retorno nativo pasan. El PDF real
y su worker de papel funcionan offline en cinco temas; portada JPEG
800×1600 con encoder publicado, sin fallback, también PASS.

La tanda pública PDF conserva 17 PASS y un FAIL de auditoría HTTP: la textura
walnut cancelada durante navegación devuelve cuerpo vacío. No se cuenta como
18/18 aprobado aunque las aserciones de texto e imágenes de ese caso hayan
pasado. CI `37379044119` conserva fallos del retorno nativo y un caso flaky
de importación EPUB; no se afirma aprobación global. Las comprobaciones
offline fallidas de la fuente anterior pedían un chunk de `ba0f85f` después
de que el despliegue fuese sustituido por `2094a19`. Se conservan y se repite
la comprobación con los bytes y el índice realmente publicados, no con una
sustitución de respuestas.

Evidencia: `.animation.local/performance-1773-origin/`, subcarpetas separadas
`public-ba0f85f-attempt1` y `public-2094a19-attempt1`. No se afirma una nueva
comprobación en teléfono físico ni autenticación real de Google.

## Muestreo de papel de 1.7.73 en preparación

El worker mide el mismo margen de 12×12 píxeles con el mismo algoritmo,
sin bloquear la interfaz con getImageData. Ocho raster reales de Chromium
conservan exactamente el RGB o la decisión null del muestreo original;
no hay readbacks en el hilo principal. Navegación, brillo y cierre durante
el muestreo invalidan o cancelan el resultado. Se conservan resolución,
materiales, iluminación, modelos y relojes. Pasan 3.292 unitarias/255
archivos, build y 75 Python. Pasan siete recorridos gráficos originales
sin retries u omisiones; cierres completos de 5.179,6/5.217,9 ms.
Se integran cambios nuevos de GitHub (`06f0f5e`) sobre arranque y menús;
corregido el ciclo de vida del arranque, la fuente combinada pasa 3.303
unitarias/257 archivos, build y 75 Python sin errores sin capturar. Sus
siete recorridos conservan 6 PASS y un fallo de alineación al quitar
el encabezado. Corregido el origen del escenario, pasan ambos contratos
nativos originales. La batería final y las comprobaciones públicas
siguen pendientes. Detalle en [Muestreo de papel de 1.7.73](performance-1773.md).

## Tono de página de 1.7.72

El modelo reutiliza sólo la medición del margen para copias del mismo
raster PDF completado, con dimensiones y filtro idénticos. Se invalida
al navegar, renderizar, cambiar tema, zoom, brillo, tamaño o cerrar.
La copia de los píxeles y su calidad permanecen iguales; no se conserva
otro bitmap. Pasan 3.265 unitarias/254 archivos, build, 75 Python y siete
recorridos gráficos originales sin retries u omisiones. Cierres completos:
5.721,2/4.738,0 ms, dentro de 8 s. Publicada desde `1c7242e`: HTTP26/offline90,
APK/loader reales, tres recorridos públicos de editor/nativo y 18 PDF PASS.
El lector/encoder publicados funcionan offline sin fallback. CI72
`37302341505` termina FAILED: 12 jobs y 11 ZIP originales, 524 identidades
y 526 intentos; sólo UI3 y el agregado fallan. Las trazas conservan
los dos timeouts de apertura y el cierre truncado del segundo intento
fraccional. No se afirma PASS global ni FPS de un teléfono. Detalle en [Tono de página de 1.7.72](performance-1772.md).

## Portadas PDF de 1.7.71

La lectura y codificación JPEG de la portada se trasladan a un worker
cuando el navegador lo admite. Se conserva la calidad .9, el raster y
las dimensiones; hay cancelación y fallback al encoder original. Cuatro
portadas reales producen exactamente los mismos bytes JPEG en Chromium.
Pasan 3.252 unitarias/254 archivos, build, 75 Python y los siete recorridos
gráficos originales sin retries ni omisiones. Cierres: 4.830,6/5.482,3 ms.
Publicada: HTTP26/offline90, APK/loader reales, tres recorridos públicos
nativo/editor y 18 PDF PASS. El lector PDF genera su portada con el worker
publicado sin Internet y sin fallback. El diagnóstico SwiftShader/CDP
mantiene un fallo fraccional de cierre; CI71 queda sellado FAILED con
12 jobs, 11 ZIP y 524 identidades/526 intentos, sólo UI3 y agregado fallidos.
Detalle en [Portadas PDF y rendimiento de 1.7.71](performance-1771.md).

## Reserva del encuadre de 1.7.70

Las animaciones reservan su encuadre compacto antes de empezar, evitando
redimensionar el framebuffer al cruzar cada bucket. Se conservan calidad,
DPR, modelos, materiales, geometría, sampler y relojes; la reserva puede
crecer y se libera al cancelar o terminar. Pasan 79 pruebas enfocadas,
3.235 unitarias/253 archivos, build, 75 Python y los siete recorridos
originales al primer intento. Cierres completos: 5.555,7/5.339,2 ms dentro
de sus 8 s. No se afirma una mejora medida de FPS en un teléfono.
Publicada: HTTP25/offline89, APK/loader reales, tres recorridos públicos
nativo/editor y 18 PDF PASS. CI70 completo queda sellado FAILED: 12 jobs,
11 ZIP y 524 identidades/526 intentos; sólo UI3 y el agregado fallan.
No se afirma aprobación completa. Detalle en
[Animaciones y rendimiento de 1.7.70](performance-1770.md).

## Reutilización HDR de 1.7.69

El segundo renderer reutiliza el atlas completo del estudio mediante una
transferencia asíncrona opcional. Mantiene reflejos, resolución y relojes,
con fallback a la generación original. Pasan 3.232 unitarias/253 archivos,
build y 75 Python; la prueba gráfica integrada conserva exactamente el HDR
y todos los píxeles en tres ángulos. Pasan los siete recorridos originales:
cierres nativos completos de 4.908,1 y 5.303,4 ms, sin retries ni omisiones.
Publicada: HTTP25/offline89 y APK/loader comprobados, tres recorridos
públicos nativo/editor y 18 PDF PASS, más fuentes offline exactas. Android
emulado `37293604213` acredita preflight de Google y cinco estados de
política nativa; su última captura conserva el libro en tránsito y no mide
el fin visual del cierre. CI69 `37292891253` acaba FAILED: UI3 falla y UI1 supera el límite del job
de 45 minutos, sin artefacto. No hay censo completo de 524 casos acreditado.
Detalle en [Iluminación y rendimiento de 1.7.69](performance-1769.md).

## Fuentes locales de 1.7.68

Se conservan los 34 archivos originales, siete familias y 93 caras CSS.
La tipografía se sirve desde la app y entra en el shell offline junto con
sus licencias; Playfair se precarga desde el mismo asset CSS.
Pasan 3.213 unitarias/252 archivos, build, 75 Python y los siete
recorridos gráficos originales. Fuentes online/offline con raster y cuerpos
exactos comprobados. Publicada: HTTP25/offline89 y APK/loader reales
comprobados, más 18 PDF públicos y fuentes offline. El público fraccional
conserva su fallo global30. CI68 completo queda sellado FAILED: 12 jobs,
11 ZIP y 524 identidades; UI2/UI3 y el agregado fallan, el resto pasa.
No se afirma aprobación completa. Detalle en
[Fuentes y rendimiento de 1.7.68](performance-1768.md).

## Cambios de rendimiento de 1.7.67

La sala de dimensiones fraccionarias permanece en WebGL y evita copiar
sus píxeles a Canvas2D en cada repintado. Conserva modelos, materiales,
DPR y animaciones; mantiene exports bajo demanda y fallback real. El
contrato gráfico de 393 px migra explícitamente; sus fixtures y plazos
30/8 no cambian. Pasan 116 unitarias enfocadas, build y los siete
recorridos gráficos al primer intento, sin retries u omisiones. Los dos
cierres completos quedan en 5.699,9/5.226,4 ms; fuente/build estables.
Batería local completa PASS: 3.208 unitarias/251 archivos, build y 75 Python.
Web publicada: 21 recorridos PASS; HTTP25/offline46 y APK/loader comprobados.
CI67 completo queda sellado FAILED: las 524 identidades están ejecutadas;
UI3 y el agregado fallan, los demás grupos pasan. Sin reintentar ni
reclasificar el original. Detalle en
[Rendimiento de 1.7.67](performance-1767.md).

## Cambios de rendimiento de 1.7.66

El toque breve evita el microlift 3D previo y su repintado completo; el
levantamiento y el arrastre tras mantener pulsado conservan sus 440 ms.
Las texturas de madera existentes empiezan a descargarse desde el HTML,
con el mismo CORS y archivos que utiliza Three.js. Modelos, materiales,
resolución y relojes de animación permanecen iguales.

Los 119 casos enfocados del runtime pasan, pero su primer comando falla al
coleccionar una nueva prueba de precarga. Corregida sólo esa lectura, las
dos primeras baterías completas conservan timeouts originales de 5 s.
El diagnóstico separado de ambos archivos afectados pasa 30/30; el matcher
de PCM pesa casi cinco segundos y se prepara una batería con menor
concurrencia. La batería posterior con un worker pasa 3.193 unitarias,
build y 75 Python. Publicación HTTP25/offline46 y APK/loader comprobadas;
18 PDF públicos PASS. Los siete locales conservan cinco PASS/dos timeouts
global30; los tres públicos conservan editor PASS y ambos nativos FAILED
por el plazo global. No miden cierres aislados completos de ocho segundos.
CI66 completa queda FAILED en UI3 y el agregado; los demás jobs pasan.
La colección de 12 jobs/11 ZIP/524 identidades queda sellada FAILED;
no se reintenta la ejecución.
Detalle en [Rendimiento de 1.7.66](performance-1766.md).

## Cambios de rendimiento de 1.7.65

La transferencia nativa de modelos cede mediante el executor existente;
la captura física PDF evita esperar fuentes ajenas ya rasterizadas; el
analizador autocontenido conserva el scorer y carga el cliente Worker al
comenzar. La fuente final pasa 3.175 unitarias/246 archivos, build y 75 Python,
con 530 hechos estables; 524 identidades E2E son sólo censo, sin ejecución.
Recibo completo `88975ced…`. Los siete locales y el RAW original pasan al
primer intento, sin retries, flaky u omisiones, fuente/build estables;
recibos `c2e0233a…` y `7e570ba6…`. Cierres de 5.357,7 y 6.299,9 ms en software
con los ocho segundos originales, sin comparación de velocidad física.

El Worker real conserva cuatro comparaciones online/offline, 432 scores y
bytes de muestras/máscaras/apariencias exactos. Cliente y Worker offline
llegan 200 del Service Worker con cuerpos exactos; sin errores inesperados,
entradas estables y procesos cerrados; informe `c946b0d6…`. Se conserva el
primer resumen nativo FAILED y su auditoría separada sin nuevas pruebas,
así como el helper RAW2 rechazado sin ejecución por recodificación UTF-8.
La publicación HTTP/APK/loader está comprobada; los 18 PDF públicos y el
RAW original pasan. En los tres públicos, el editor pasa y los dos de
devolución fallan por global30, sin acreditar un cierre completo superior
a ocho segundos. El diagnóstico pasivo posterior conserva ese fallo:
editor y legado pasan; alineado termina por global30. Las copias lentas
del legado pertenecen al fallback de la estantería, no a la captura PDF.
Antes de leer hubo cuatro repintados iniciales y dos de selección; también
hubo dos al cerrar. No se acredita todavía la fluidez del teléfono.
La primera prueba Android falló en el verificador antes de iniciar audio;
una nueva ejecución corrige sólo sus rutas. El APK publicado pasa ambos
recorridos en emulador: Lessac y Cori, más de seis minutos bloqueados,
continuidad de capítulos, PDF oculto y controles del sistema. Fuente,
Pages, APK y loader exactos antes y después; resumen `3d0bfc48…`.
No mide fluidez ni temperatura de un teléfono físico.
CI65 completa queda FAILED: 522 de524 identidades pasan, dos unexpected,
526 intentos y cuatro timedOut, sin omisiones ni flaky. Los cuatro fallos
nativos ocurren antes de Volver, esperando el canvas PDF visible; no
demuestran un cierre completo superior a ocho segundos. Unitarias y todos
los grupos de voces reales pasan. Certificado `9850fb22…`.
No reclasifica los estados originales anteriores. Detalle en
[Rendimiento de 1.7.65](performance-1765.md).

## Cambios de rendimiento de 1.7.64

El cierre cancela el calentamiento pendiente de voces antes de esperar la
captura de página. Invalida el cliente, su caché PCM y temporizador; Android
encola la limpieza nativa sin bloquear JavaScript. Una continuación antigua
no puede iniciar modelos después del cierre ni sustituir una reapertura.
Pausar, detener y escuchar con la pantalla apagada conservan sus contratos.
CPU aislada: candidato155 PASS (142 originales y 13 nuevos), control142 PASS,
mismas identidades originales y cero errores no capturados; recibo `4ceb2156…`.

La adopción original rechazó mixedEOL antes de escribir y la primera batería
rechazó la versión antes de ejecutar comandos o QA; ambos errores quedan
conservados. Adopción revisada correcta, diez archivos y QA original intacta.
Batería completa real en `full-local-attempt2`: 3.147 unitarias/242 archivos,
build y 75 Python PASS; cinco comandos exit0, 526 hechos estables. Recibo
`5f4f9d99…`; 524 identidades E2E sólo censo, sin omisiones ni ejecución.
Los siete locales originales pasan al primer intento, siete intentos y
cero retries, flaky u omisiones; fuente/build526 estables, recibo `9fc0ef86…`.
Cierres de 5.349,8 y 6.144,4 ms con los ocho segundos originales. Publicada
desde `72a785c`, Pages `2423322`: HTTP24/45 PASS, artefacto `6e286ff4…`; APK
recién descargada idéntica a la firmada 1.1.4/code17 y loader2.089 bytes PASS.
Los tres públicos originales y los 18 PDF pasan al primer intento, sin
retries, flaky u omisiones, con 53 y 326 cuerpos autenticados. Certificados
`39693f80…` y `a13208dd…`. CI64 completa queda FAILED: 524 identidades,
528 intentos, siete intentos fallidos y cuatro retries. Conserva los fallos
del import RAW, los recorridos de devolución y la preparación isométrica
intermitente; no usa sus retries como aprobación. Certificado `a753ada9…`.
No acredita FPS o memoria física ni reclasifica fallos originales previos. Detalle en
[Rendimiento de 1.7.64](performance-1764.md).

## Cambios de rendimiento de 1.7.63

La puntuación numérica de máscaras de fuentes pasa a un Worker de módulo;
fuentes, rasterizado, muestreo, color y selección siguen en el hilo principal,
con el cálculo y fallback originales. CPU aislada final: candidato77 PASS
(52 originales y 25 nuevos), control52 PASS, identidades originales iguales.
Los fallos anteriores del reporter y los cuatro fixtures nuevos de realm,
además del guard de caché, quedan FAILED y conservados.

El Worker construido realmente compara dos portadas online y offline:
432 puntuaciones exactas, mismos bytes de muestras/máscaras y apariencia
final. La navegación y el Worker offline llegan 200 desde el Service Worker
con cuerpos auténticos. El primer método offline conserva FAILED; el método
fresco sólo clasifica el probe exacto de red de la raíz y exige esas pruebas
de cuerpos. Cero pageErrors, consoleErrors y fallos de red inesperados;
navegador/preview cerrados. CPU `51b39203…`, informe real `1b4e9ec6…`.

La fuente final pasa 3.134 unitarias en 239 archivos, compilación y 75
Python, con los cinco comandos exit0 y 523 hechos estables. Recibo completo
`79947b70…`. El censo conserva 524 identidades únicas E2E sin omisiones ni
intentos ejecutados; un listado no cuenta como ejecución. Los siete
recorridos locales originales pasan al primer intento, sin retries, flaky ni
omisiones; fuente/build estables. Cierres de 5.265,9 y 6.056 ms con los ocho
segundos originales; recibo `f9d6f3b1…`. Publicada desde `f81d3a1`, Pages
`774af05`: HTTP de 24 módulos/45 offline PASS, artefacto `80fe4905…`; APK
recién descargada idéntica a la firmada 1.1.4/code17 y loader de 2.089 bytes
PASS. Los tres públicos originales y los 18 PDF pasan al primer intento,
sin retries, flaky ni omisiones, con 53 y 324 cuerpos autenticados.
Certificados `1d903624…` y `a384e4a2…`. La CI original `37256218542`
termina FAILED y conserva doce logs y once ZIP completos: 524 identidades,
527 intentos, tres retries y seis fallidos; 521 expected, tres unexpected,
sin flaky ni omisiones. UI2 falla dos veces por la importación relativa
`./font-score-core.js` desde `data:`; UI3 conserva cuatro fallos durante el
cierre. El primer alineado queda truncado por el global30; no todos los
intentos acreditan una espera backend completa de ocho segundos.
Certificado `5967c0e9…`. La lectura de render `afd65c7a…` conserva los dos
legados en `returning`/`reused` en snapshots posteriores al fallo, sin medir
el fin del cierre. Las últimas respuestas de fuentes terminan más de 18
segundos antes de Back; no hay causa GPU o de `fonts.ready` demostrada.
El perfil pasivo sigue HOLD, sin ejecución. No acredita FPS, temperatura,
menor tiempo total del matcher ni píxeles del modelo 3D. Detalle en
[Rendimiento de 1.7.63](performance-1763.md).

## Cambios de rendimiento de 1.7.61

La terminación del análisis de portada utiliza el modelo ya cargado en vez
de sustituirlo completo. Los 48 pares gráficos en DPR2 y DPR1,5 conservan
RGBA completo y PNG nativo/exportado exactamente iguales; en ese punto se
observa una sustitución del control y ninguna del candidato. CPU aislada:
20 PASS (11 originales, 9 nuevos); el primer fallo de fixtures y los dos
fallos esperados del control quedan conservados. Fuente final: 3.109
unitarias en 235 archivos, build y 75 Python PASS, 515 hechos estables.
El censo de 524 E2E no se presenta como ejecución. Los siete recorridos
locales originales pasan al primer intento, sin retries/flaky/skips, con
cierres de 5.058,1 y 6.003,5 ms. Publicada desde `de672fd`, Pages `8daed16`:
HTTP real de 23 módulos/44 offline y APK recién descargada/loader PASS. Los
tres recorridos públicos originales y los 18 PDF pasan al primer intento,
sin retries, flaky ni omisiones, con 50 y 310 cuerpos autenticados. La
CI original `37254356739` termina FAILED y conserva su colección completa
sellada: doce logs, once ZIP autenticados, 524 identidades y 526 intentos,
con dos retries y cuatro fallos originales de UI3; los otros diez grupos
pasan. El primer alineado agota el plazo interno de ocho segundos esperando
`is-closing-reader`; su retry y los dos legados agotan el global de treinta
segundos sin completar la comprobación. Certificado `334e52bf…`. No se
atribuye la causa al cambio de 61 ni se reclasifican estos fallos o los de
1.7.60. No acredita FPS en un teléfono físico. Detalle en
[Rendimiento de 1.7.61](performance-1761.md).

## Cambios de rendimiento de 1.7.60

El editor agrupa la actualización de portada y canto antes de presentar el
modelo. En 64 operaciones reales pasa de dos repintados síncronos a uno, con
RGBA completo y PNG nativo/exportado idénticos. No reduce calidad ni altera
los plazos del editor. CPU aislada: 194 PASS, incluidos 176 originales y 18
nuevos. El primer fallo de datos de tres fixtures nuevos queda conservado.
Batería completa: 3.100 unitarias en 233 archivos, build y 75 Python PASS,
con 513 hechos estables y 524 identidades E2E intactas. El listado no es
una ejecución. Los siete recorridos locales originales terminan 5 PASS/2 FAIL,
sin retries, flaky ni omisiones: la carga y apertura consumieron gran parte
del límite global de treinta segundos. Aunque llegaron al lector y se emitió
Back, no quedó un presupuesto completo para medir sus cierres de ocho segundos.
No se atribuye la causa a un callback de portada
sin medirlo ni se acredita fluidez de un teléfono físico. Publicada desde
`e86279a`, Pages `937a49a`: HTTP real de 23 módulos/44 offline y APK recién
descargada/loader PASS. Primer HTML previo de CDN FAILED conservado. Tres
recorridos públicos originales: 2 PASS/1 FAIL (alineado global30), sin retries,
flaky ni omisiones; auditor estricto FAILED. Los 18 PDF públicos pasan al primer intento, sin retries ni omisiones,
con 310 cuerpos autenticados; CI original `37252194562` termina FAILED (UI3/agregador; otros diez jobs PASS).
UI3 temprano conserva 40 identidades/42 intentos, 38 pases y los dos contratos
nativos timedOut en sus cuatro intentos. Colección completa sellada FAILED:
doce logs, once ZIP autenticados, 524 identidades únicas y 526 intentos,
incluidos los dos retries y cuatro fallos originales; certificado `adf8e70c…`.
Detalle en [Rendimiento de 1.7.60](performance-1760.md).

## Cambios de rendimiento de 1.7.59

El canvas nativo del libro evita reiniciar una dimensión que ya coincide
cuando la otra realmente cambia. Three conserva tamaño, densidad y viewport;
los casos sin las condiciones del camino nativo mantienen su operación
original. No se reducen modelos, texturas, sombras ni antialiasing.

La fuente final pasa 3.082 unitarias en 231 archivos, build y 75 Python,
con 511 hechos estables. La CPU aislada final pasa 82 casos: 59 originales
y 23 nuevos. Su primer fallo de datos de una expectativa nueva se conserva.
Los siete recorridos originales locales pasan al primer intento, sin retries,
flaky ni omisiones. Cierres: 5.176,8 y 5.639,3 ms con los plazos originales.
Veinte composiciones de cámara no repintan la sala y conservan seis lomos
de 1.024 px. El censo de 524 E2E no cuenta como ejecución.

La comparación gráfica pasa al primer intento: 64 pares exactos RGBA y
PNG nativo/exportado. En 32 cambios de una sola dimensión, las dos
asignaciones originales pasan a una. El navegador y servidor quedan cerrados.
Publicada desde `ebffb33`, Pages `68f8edf`: HTTP real, APK recién descargada
y loader de 2.089 bytes PASS. Los 21 recorridos públicos originales pasan
al primer intento, sin retries, flaky ni omisiones. El primer pin HTTP de
propagación conserva su fallo y cuerpo de 1.7.58. La CI original `37249480029`
termina FAILED con dos casos de apertura en UI3 y sus reintentos; conserva
doce logs, once ZIPs, 524 identidades y 526 intentos originales. Los pases locales
y públicos no sustituyen ese resultado ni acreditan FPS de un teléfono. Detalle en
[Rendimiento de 1.7.59](performance-1759.md).

## Cambios de rendimiento de 1.7.58

La estantería pausa sus repintados después de pintar realmente el hueco
vacío del libro seleccionado. Conserva los cambios pendientes y reanuda
antes de devolverlo. Fuentes ya cargadas después del primer dibujo no
provocan otra reconstrucción. Las pulsaciones aceptan la biblioteca actual
antes de abrir el libro y conservan los gestos originales.
CPU combinado final: 246 PASS, incluidos 191 originales y 55 nuevos;
el control pasa los 191 originales y conserva 32 fallos nuevos. Los seis
casos del helper nuevo sólo se ejecutan en el candidato. La primera CPU
FAILED por dos expectativas nuevas de timing táctil queda conservada.
Fuente final: 3.059 unitarias en 230 archivos, build, 75 Python y 509
hechos estables. Censo original de 524 E2E; listado no ejecutado.
Los siete recorridos locales originales pasan al primer intento, cero
retries, flaky u omisiones. Cierres: 5.371,7 y 5.917,5 ms con sus ocho
segundos originales intactos. Veinte composiciones isométricas sin
repintar sala, dos escrituras de buffer y seis lomos de 1.024 px.
Publicada desde `0edc6b1`, Pages `ed614d2`: HTTP real, APK recién descargada
y loader PASS. Los 21 recorridos públicos originales pasan al primer
intento, sin retries ni flaky. CI original `37246413733` termina FAILED:
524 identidades, 526 intentos, dos unexpected en UI3 y cuatro intentos
fallidos antes de Back esperando PDF visible. Dos retries, cero flaky ni
omisiones; 12 logs y 11 ZIP completos. No se acredita fluidez en teléfono
ni resolver esos timeouts sólo con los pases locales y públicos.
Detalle en [Rendimiento de 1.7.58](performance-1758.md).

## Cambios de rendimiento de 1.7.57

Publicada y verificada localmente y contra la web real; CI original FAILED.
Las confirmaciones de metadatos conservan el árbol de la estantería cuando
todos los datos visibles son idénticos. La cola real pasa de una pintura
de sala/base/snapshot a cero, con referencias actuales y los mismos modelos.
Pasan 75 casos aislados, 32 pares PNG nativos y 100 pares RGBA/exportPNG
exactos en cuatro perfiles, sin cambiar calidad ni plazos. La fuente final
pasa 3.004 unitarias en 223 archivos, build y 75 comprobaciones Python;
conserva 501 hechos de fuente y las 524 identidades E2E originales.
Los siete recorridos locales originales pasan al primer intento, sin
retries, flaky ni omisiones. Cierres: 7.034,4 ms alineado y 6.140,6 ms legado,
con ocho segundos originales y global de treinta segundos intactos.
El primer full root conserva FAILED antes de ejecutar comandos por el JSON
de versión del auxiliar; su reparación sólo restaura la comilla faltante.
La batería completa PASS corresponde al intento 2. Los fallos aislados
anteriores conservan sus propios recibos. No hay medición de FPS en teléfono
ni causa demostrada del timeout de apertura o del clic perdido de CI56.
HTTP real, APK recién descargada y loader PASS; los 21 recorridos públicos
originales pasan al primer intento, sin retries ni flaky. Fuente `4899d86`,
Pages `f0ca599b`. CI original `37244969983` FAILED: 524 identidades,
526 intentos, dos retries y cuatro intentos fallidos sólo en UI3;
12 logs y 11 ZIP completos. Alineado inicial y los dos legados fallan la
espera PDF de ocho segundos. Alineado retry llega al cierre y agota el
global de treinta; no se atribuyen los cuatro fallos al cierre.
Detalle en [Rendimiento de 1.7.57](performance-1757.md).

## Cambios de rendimiento de 1.7.56

Publicada, con CI original completa FAILED: la devolución del
libro sobre la estantería legada evita una segunda copia de pantalla por
fotograma compatible. Pasan los 59 casos aislados del candidato y 26 pares
gráficos exactos en ambas densidades; las seis poses compatibles de cada
densidad pasan de doce copias a seis. No cambia la calidad visual ni los
plazos. La fuente final pasa 2.989 unitarias en 220 archivos, build y 75
comprobaciones Python; conserva las 524 identidades del censo original y
497 hechos de fuente. El listado no cuenta como ejecución de navegador.
Los siete recorridos locales originales pasan al primer intento, cero
retries, flaky u omisiones. Cierres alineado y legacy: 4.286,3 y 6.134,5 ms
con los plazos originales intactos; veinte composiciones del gesto sin
nuevos renders de sala y seis lomos de 1.024 px.
La web publicada pasa HTTP y los 21 recorridos originales de editor,
regreso y PDF al primer intento, cero retries, flaky u omisiones. APK recién
descargada y loader PASS. El primer pin HTTP de propagación permanece FAILED.
La CI original de fuente `b07aa6c`, run `37239526267`, termina FAILED:
524 identidades, 521 expected, dos unexpected y un flaky; 527 intentos,
cinco timedOut y tres retries, cero omisiones. Se conservan doce logs y
once ZIP completos. Los cuatro intentos de UI3 fallan durante apertura PDF
antes de Back, con último snapshot en zooming; no acreditan un fallo del
plazo de cierre. UI6 conserva el primer timeout global de 90.626 ms
esperando Editar y su retry PASS de 32.679 ms como flaky, sin causa del clic
perdido demostrada. Los pases locales y públicos no sustituyen esos fallos.
Se conservan separados los fallos del wrapper CPU y del primer
método gráfico. No es una medición de fluidez en teléfono ni una solución
acreditada para los timeouts de apertura de CI55.
Detalle en [Rendimiento de 1.7.56](performance-1756.md).

## Cambios de rendimiento de 1.7.55

La devolución evita dibujar y copiar la página antigua en un host desconectado
antes de actualizar el marcapáginas. Pasan 130 casos funcionales aislados y
16 pares RGBA/PNG exactos en ambas densidades. La fuente final pasa 2.980
unitarias en 219 archivos, build y 75 comprobaciones Python. El censo original
mantiene 524 E2E; el listado no se cuenta como ejecución. Los siete recorridos
locales originales pasan al primer intento; cierres 4.369,5 y 6.109,5 ms dentro
de los plazos originales. La web publicada pasa los 21 recorridos públicos
originales al primer intento, HTTP, APK recién descargada y loader. El primer
pin de propagación del HTML conserva FAILED en un namespace separado.
La CI original de la fuente `636aecb`, run `37236962479`, termina FAILED:
522 expected y dos unexpected entre 524 identidades, 526 intentos, cuatro
fallidos y dos retries, cero flaky u omisiones. Se conservan sus doce logs
y once ZIP. Los contratos nativos fallan durante apertura antes de Back;
tres fallos de selección consumen su espera completa de ocho segundos.
El reintento alineado pasa selección y falla durante apertura del PDF,
con último snapshot en zooming. No se mide ningún plazo de cierre en esas
trazas, ni se sustituye el fallo por los pases locales o públicos.
Los fallos de métodos y versiones anteriores conservan su propio estado.
Detalle en [Rendimiento de 1.7.55](performance-1755.md).

## Cambios de rendimiento de 1.7.54

El cambio de color de maceta conserva el modelo, geometrías, materiales y
encuadre tanto en estantería como catálogo. Pasan 107 casos funcionales y 160
pares gráficos exactos en ambas densidades. La fuente está incorporada y su
batería final pasa 2.972 unitarias en 217 archivos, build y 75 comprobaciones
Python y siete recorridos locales originales al primer intento. Sus cierres
nativos registran 4.925,6 y 6.133,1 ms con los plazos originales intactos.
Publicada: 1.7.54, con HTTP, APK/loader y 18 recorridos PDF públicos PASS.
Los tres recorridos públicos de editor/regreso conservan FAILED: editor pasa,
alineado termina el cierre dentro de ocho segundos pero agota el global de
treinta segundos después, y legacy incumple el plazo completo de cierre.
La CI original conserva FAILED: 522 expected y dos unexpected entre 524
identidades, 526 intentos, cuatro fallidos y dos retries, sin flaky u
omisiones. UI3 conserva cuatro fallos durante apertura antes de Back;
los doce logs y once ZIP originales se conservan. Estos ámbitos
permanecen separados de los siete recorridos locales PASS.
Ámbitos y controles en [Rendimiento de 1.7.54](performance-1754.md).

## Cambios de rendimiento de 1.7.53

La apertura reutiliza la página ya pintada sólo con pose, snapshot, revisión,
owner y contexto vigentes. Los estados que necesitan actualizarse mantienen
el render original. Pasan 189 casos funcionales aislados y 30 pares gráficos
exactos en ambas densidades, con 30 → 20 draws en el oráculo. La fuente ya está
incorporada y pasa 2.910 unitarias en 214 archivos, build y 75 comprobaciones
Python y siete recorridos locales originales al primer intento. Sus cierres
nativos registran 4.638,7 y 6.147,8 ms con los plazos originales intactos.
La web publicada pasa HTTP, APK recién descargada, loader y los 21 recorridos
originales al primer intento. La CI original conserva FAILED en UI3: cuatro
fallos del cierre8 completo; pasan selección y apertura, sin truncado global30.
La CI completa conserva FAILED: 521 expected, dos unexpected y un flaky entre
524 identidades, 527 intentos, cinco fallidos y tres retries. UI1 falla en su
primer intento de importación Android y pasa en su retry; el snapshot acredita
una aparición transitoria del cierre, pero no mide su final. Se conservan los
doce logs y once ZIP originales.
Los errores de método y las CI fallidas anteriores conservan su estado propio.
Detalle en [Rendimiento de 1.7.53](performance-1753.md).

## Cambios de rendimiento de 1.7.52

El libro activo conserva su fotograma nativo si sólo cambia una cinta que
realmente no existe, con guards de pose exacta, revisiones, owner y contexto.
Se conserva el resultado en 86 pares RGBA/PNG exactos: 44 → 30 dibujos por
perfil de calidad. La fuente final pasa 2.889 unitarias en 212 archivos,
build y 75 comprobaciones Python. Los siete recorridos locales originales
pasan al primer intento, incluidos los cierres nativos de 5.309,4 y 5.362 ms.
La web publicada pasa los tres recorridos de editor/regreso y los 18 PDF
originales al primer intento, además de HTTP, APK descargado y loader. La CI
original conserva FAILED en UI3: dos contratos nativos, cuatro fallos y dos
retries durante apertura. Ninguno llega a Back. El run completo termina
FAILED con 522/524 E2E expected y los otros diez jobs de prueba SUCCESS.
Se conserva el primer método GPU FAILED y
los fallos de CI anteriores, sin relajar assertions o plazos.
Ámbitos y límites en [Rendimiento de 1.7.52](performance-1752.md).

## Cambios de rendimiento de 1.7.51

El inicio del gesto comparte una captura nueva entre las vistas fine y overview
sólo si el frame, contexto, revisiones y dimensiones coinciden. Los exports
externos conservan su independencia. Pasan ocho pares RGBA/PNG exactos y la
batería local de 2.865 unitarias en 211 archivos, build y 75 pruebas Python.
Pasan los siete recorridos originales locales al primer intento: el gesto
mantiene veinte composiciones y cero nuevos renders de escena. Pasan también
los 21 recorridos de la web publicada, HTTP, APK descargado y loader. La CI
original completa conserva FAILED: 524 E2E, 522 expected y dos unexpected,
cero flaky u omisiones; cuatro timeouts y dos retries. Los dos contratos
nativos se interrumpen durante el cierre por el límite global de treinta
segundos, antes de consumir los ocho segundos de su espera de cierre.
Sus ámbitos se documentan
en [Rendimiento de 1.7.51](performance-1751.md).

## Cambios de rendimiento de 1.7.50

La devolución agrupa la pintura final y el layout pendiente antes de liberar
el libro. El tamaño y DPR del framebuffer nativo se asignan juntos cuando
cambian ambos; se conservan dimensiones finales, CSS y las rutas de respaldo.
La fuente final pasa 2.857 unitarias en 210 archivos, build y 75 comprobaciones
Python. La web publicada pasa 18 recorridos PDF y tres de editor/regreso nativo,
todos al primer intento; pasan HTTP, APK descargado y loader. La CI original
completa conserva FAILED: de 524 E2E, 522 expected y dos unexpected,
cero flaky u omisiones; cuatro timeouts y dos retries en la apertura nativa.
Sus doce logs y once ZIP se conservan como un ámbito distinto.
Controles, resultados y límites están en
[Rendimiento de 1.7.50](performance-1750.md). Los fallos originales anteriores
conservan su estado propio.

## Cambios de rendimiento de 1.7.49

La devolución reutiliza el modelo del lector al actualizar su portada HD y
su apariencia automática. La comparación admite sólo ruido numérico en la
clave de dimensiones; conserva los vértices reales, los acabados y el viewport.
El progreso actualiza el marcapáginas y las hojas antes del primer dibujo.
Back cancela la portada opcional pendiente e impide guardados o refrescos tardíos.
La fuente final, sus controles y la comprobación de publicación se registran
en [Rendimiento de 1.7.49](performance-1749.md). Sus resultados no sustituyen
los fallos originales de las versiones anteriores.

La CI original 1.7.49 (37224970834, fuente 1d47968) conserva **FAILED**:
2.843 unitarias en 208 archivos pasan; 524 casos E2E contienen 522 expected
y dos unexpected, cero flaky u omitidos. Sus 526 intentos incluyen cuatro
fallos y dos retries: los dos contratos nativos vuelven a incumplir el gate
original de ocho segundos. Se conservan doce logs y once ZIP autenticados;
los snapshots posteriores no prueban el instante real de fin de cierre.

La comparación de apariencia pasa 30 pares RGBA/PNG exactos contra el
modelo fresco. La web publicada pasa 18 recorridos PDF y tres de editor y
regreso nativo, además de HTTP, APK y loader. Son ámbitos distintos del CI
y no sustituyen su fallo ni acreditan fluidez en un teléfono físico.

## Cambios de rendimiento de 1.7.48

La página preparada deja de esperar a regenerar la portada PDF en HD. La
estantería de respaldo conserva el objetivo de un click mientras aplica los
refrescos pendientes. Se mantienen los cambios de memoria, modelos y gestos
de 1.7.47, con las mismas texturas y animaciones. La comprobación de la fuente
final y sus límites están en [Rendimiento de 1.7.48](performance-1748.md).

La CI original de 1.7.48 conserva **FAILED**: pasan 2.802 unitarias en 202
archivos; de 524 casos E2E, 522 son expected y dos unexpected, sin flaky.
Los dos contratos nativos incumplen el gate original de ocho segundos en sus
dos intentos. Se guardan 526 intentos, cuatro fallidos y dos reintentos, además
de los doce logs y once ZIP originales. La apertura sin WebGL pasa al primer
intento. La web pública pasa 21 casos sin reintentos y pasan HTTP, APK y loader;
estos controles no acreditan fluidez ni temperatura en un teléfono físico.

La CI original de 1.7.47 conserva FAILED: sus dos casos nuevos de devolución
alcanzan el límite global de treinta segundos y un caso original de selección
en el respaldo es flaky. Su reintento no transforma el resultado en aprobado.
Los logs y artefactos originales quedan preservados; la batería de la nueva
fuente tiene sus propios resultados.

## Cambios de rendimiento de 1.7.47

Guardar una edición reutiliza el modelo ya preparado del libro. Los avisos
consecutivos de cambios se agrupan y las lecturas de la biblioteca no se
solapan. Las texturas de habitación sin consumidores se liberan; los gestos
no restauran un buffer que van a ocultar inmediatamente. El canvas nativo
de inserción pertenece al host del libro hasta su entrega a la estantería.
Se mantienen texturas, DPR, geometría, materiales y relojes de animación.

Los resultados de esta fuente se incorporan a
[Rendimiento de 1.7.47](performance-1747.md) tras ejecutarse. La verificación
del teléfono físico y la sesión real de Google continúan pendientes; las
pruebas de escritorio no acreditan su fluidez ni temperatura. La APK 1.1.4
continúa cargando la publicación web con su loader.

## Cambios de rendimiento de 1.7.46

La selección y devolución mantienen el canvas WebGL y conservan las imágenes
resueltas en la GPU. La estantería y la inserción comparten su renderer; los
consumidores 2D materializan una captura sólo cuando la solicitan. Los modelos
pendientes idénticos se conservan y reciben el progreso reciente sin recrearse.
El DPR, las texturas, los materiales, la iluminación y los relojes permanecen.

La comprobación de imágenes, los contratos de devolución, los fallos originales
y el costo adicional de memoria tienen su alcance en
[Rendimiento de 1.7.46](performance-1746.md). El reloj pesado de SwiftShader sigue
superando ocho segundos: este cambio no acredita fluidez, batería ni temperatura
en un teléfono físico. La web publicada supera los 18 casos PDF, mientras
que la CI original conserva cinco fallos de navegador de 524 casos. Las
verificaciones completas anteriores conservan sus resultados propios.
La APK 1.1.4 continúa cargando la web publicada mediante su loader.

## Publicación verificada de 1.7.42: PDF adaptable

La vista adaptable muestra las fotografías con sus colores originales, incluidas las giradas, y conserva el texto antes y después para navegar, buscar, guardar posición y narrar. Los cambios de tamaño de letra con interlineado normal ya no crean párrafos nuevos. La página anterior permanece visible mientras se prepara la siguiente: la regresión reproduce un intervalo vacío en 1.7.41 y pasa con 1.7.42.

Fuente `7f5ebd9f78dddeb53d4419e75920014612487510`, Pages `6ad512f6e5353db3d980ffd20d0514bbee5785bb`. La [CI original 37196721440](https://github.com/miguelcoxcaballero/inhouse-read/actions/runs/37196721440) pasa **2.657 unitarias en 175 archivos y 522 E2E**, 3.179 en total, sin omisiones, reintentos, flaky ni errores. Sus doce jobs y once ZIP originales se contrastan con el censo de la fuente; certificado `4306c2be20aa339d50d9377ead9b292998cb952d60e22d3056831817aaa2afed`. Pasan también las 75 comprobaciones Python originales.

La web pública pasa **18 casos PDF** sin reintentos, con **310 cuerpos HTTP** contrastados y 15 capturas; se revisaron papel, AMOLED y escaneo. Los cinco temas mantienen los RGB originales de las fotos y los marcadores de texto son alcanzables antes de cambiar de página física. Los casos de narración usan un motor controlado explícito para comprobar posiciones; los motores naturales tienen sus pruebas separadas en la CI completa. Certificado público `185e2ecc16bf0791a9290f4a228cac4378f1c2f1c3645f6dde9496e897827680`.

Los 23 módulos y 44 recursos offline coinciden con Pages por HTTP. El entry real `main-BWBX5xkG.js` tiene 1.418.744 bytes y SHA `bba76d53106a4952890da4418fc79bd204b3bdbe6e8a3983c1858d3a84a104c7`; certificado del artefacto `2d69e94190d614bafa036271e2d5362100a6587f72dd7b5dce4c528a9877d427`. Certificado de entrega `29668ee90a24ebcc38acb036cce7d4621ed861abddd964e6ab5b7f509397100f`.

La APK descargada de nuevo sigue siendo **1.1.4, código 17**, 78.515.243 bytes y SHA `feafaaa762b35344ac8b19418f9f6eb6cb1f725fba22b1ef3d3f273bd32a6191`: idéntica al APK firmado anteriormente comprobado. El inventario público contiene únicamente su loader de 2.089 bytes y dos stubs vacíos; el loader coincide byte por byte con la fuente. No se atribuye una captura nativa nueva a esta corrección web ni se necesita reimportar los libros.

La implementación previa 1.7.41 tiene su comprobación independiente: fuente `cadd93869ce935ed229dc440df6d277b24563372`, [CI 37195770731](https://github.com/miguelcoxcaballero/inhouse-read/actions/runs/37195770731) con 2.656 unitarias y 522 E2E, 18 casos locales y otros 18 sobre esa publicación. Conserva los fallos de la fuente anterior y de las primeras fixtures/auditoría. La corrección de carga 1.7.42 tiene resultados propios y no reutiliza esos casos como prueba de la versión actual.

Las páginas sin texto se muestran como imágenes, sin OCR. Las composiciones que PDF.js no puede delimitar con seguridad conservan la página original junto al texto. El orden de cualquier PDF mal formado no queda garantizado. [Implementación y regresiones](pdf-adaptive-content-1741.md). Los pendientes históricos de Google, teléfono físico y configuración gráfica adicional permanecen en sus secciones anteriores.

## Publicación verificada de 1.7.40: cierre y profundidad

El retorno marca el hueco antes de reconstruir los nodos del mueble, prepara su proyección bajo la página opaca y entrega un único repintado antes del zoom. Los tres materiales originales de profundidad se enlazan con el primer batch de la estantería, sobre la geometría ya existente del indicador. No añaden objetos visibles ni render passes. Durante la inserción, el libro oculto no invalida la imagen ni las sombras de una habitación que no cambia; los cambios reales pendientes siguen respetándose. Su watchdog observa el reloj original de la inserción.

El framebuffer del libro y el depth pass de inserción usan ventanas de cámara alineadas a píxeles. El canvas final, DPR, materiales, iluminación, geometrías, sombras y relojes de animación permanecen. El primer zoom, un DPR fraccionario y cualquier modelo que no cabe usan el buffer completo. La profundidad continúa recortando el libro detrás de sus vecinos y madera.

El candidato aislado final completa **7.062,9 ms** en el reloj DOM original del móvil 390 × 844 a DPR 2, sin reintentos y con el mismo límite de ocho segundos. Pasan **20 casos originales** de apertura y temas, incluidos giro/cancelación, CBZ, PDF, EPUB, fallback y movimiento reducido. Cinco poses GPU, desde la página ampliada hasta el lomo girado, comparan 5.266.560 componentes RGBA por pose: **cero diferencias**, con portada brillante, lomo dorado, página, texto y marcapáginas. No es una medición de un teléfono físico. Los ensayos anteriores fallidos se conservan: no se publica el candidato que contenía texto mal codificado, aunque su reloj pasaba. La equivalencia de runtime con la fuente final está contrastada: sólo cambian el footer de versión y comentarios. Su CI y publicación tienen pruebas propias indicadas a continuación.

Fuente `4bfed7bca97e094c189c54c66de424ea09fa3dcd`, Pages `6ebd58117eb3c2ff88fdac0772c1fbe50a0dc8ce`. La [CI original 37170288785](https://github.com/miguelcoxcaballero/inhouse-read/actions/runs/37170288785) supera **2.639 unitarias en 173 archivos y 514 E2E**, 3.153 en total, sin omisiones, reintentos, flaky ni errores. Se contrastan sus doce jobs y once ZIP originales; certificado `5a16b70dabb6d3ab61f3ec670020a75afc11e791cf367486e6d6a9f446ba1df2`. Las 75 comprobaciones Python también pasan en esta fuente.

La comprobación HTTP coincide con los 23 módulos y 44 recursos offline. El entry real `main-r6wn8ozD.js` tiene 1.418.752 bytes y SHA `4f165f565dd55b3e099d407126fc18238eabde5ebb068400c1040fe88f0f1d43`; certificado HTTP `4000cc464259183180470ad49d379ae9c839ea31b093e31725849b4beffeaa62`. Los seis casos funcionales publicados pasan con 133 cuerpos HTTP y cuatro PNG revisadas: capítulos reales, ampliación offline de perfiles, carga del lector, catálogo móvil y estantería isométrica. Certificado `49a5eaf4cd63aec6f549ad861e0dc8ee399bc366954fd13cdbfed7e372814e84`.

Un séptimo caso público conserva el test original del cierre a DPR 2 y su presupuesto de ocho segundos. Con el launch por defecto de la prueba local original, registra **6.914,7 ms**, entrega real del libro y limpieza del overlay, sin reintentos. Los cuerpos de la app se contrastan con Pages. El contexto observado pertenece a **ANGLE / SwiftShader Vulkan 1.3.0**, un renderer de software; no acredita un teléfono físico. Certificado `f58e5c6dbc8eab835df49d4a35472dfd8fbb27deafcc8e9aebb7befa3f45e7a8`.

Se conserva separado el primer caso adicional que fuerza `--use-gl=angle`, `--use-angle=swiftshader` y `--enable-unsafe-swiftshader`: **9.274,7 ms, FAILED** con el mismo límite. No se transforma en aprobado ni se explica su causa por una diferencia de driver que no se haya observado. Los candidatos posteriores 55–67 no se publican: no acreditan la mejora buscada en esa configuración. El candidato 67 pasa el perfil original en 7.084,8 ms, sin una mejora demostrada frente al candidato publicado; también conserva el fallo de la configuración forzada. Sus mediciones y fuentes permanecen separadas.

El certificado de entrega `ee3a2249d3a4ece630feb46ccacc2a5898cd5ae1cc29180a1b805b699386dc7c` conserva tanto las aprobaciones del perfil original como ese fallo adicional y las verificaciones externas pendientes. La APK sigue siendo 1.1.4: los archivos del wrapper/loader y módulos seleccionados de audio, lectura y Drive son idénticos a la fuente nativa probada en 1.7.39. Esto es equivalencia de fuente, no una captura nueva de Android sobre 1.7.40.

## Publicación verificada de 1.7.39 y Android 1.1.4

Fuente de producto `8602135708e520c35ae52483fbfd5e19a2c54203`. La [CI original 37167629565](https://github.com/miguelcoxcaballero/inhouse-read/actions/runs/37167629565) pasa **2.628 unitarias en 171 archivos y 514 E2E**, sin omisiones, reintentos ni flaky. Sus doce jobs y once ZIP originales tienen un censo independiente; certificado `61d7cbda81e9b321e4c11e14aee4ab1aad9c8c57037b40651d4103daf7ed5f5a`. Los 20 casos locales originales de apertura/temas y las 75 verificaciones Python también pasan.

La primera publicación web pasa seis casos sobre sus archivos reales, con 132 cuerpos HTTP y cuatro capturas revisadas; certificado `2d73a806b7059923e5951033b39ea0b9fb8cf8ce3e0d0cc716f944f9d9ab53ad`. Tras publicar la APK, sólo cambia el manifiesto Android en `43f1c103f0f3c4f6db4541d2598145e2136064fe`, Pages `e60b10bb907ea3c17cfbfd0ed79994fa8c453238`. Una comprobación HTTP nueva contrasta los 23 módulos, 44 recursos offline y módulos antiguos conservados. El entry continúa idéntico: `main-ChTFJ3tE.js`, SHA `0674c21c0b3d9b95d2d666641298d66f50f7d940622990d0d8bf011072e2db92`; certificado `62b9c4f289a0f5822fd68a0dcb8f0a24a3de1df9dc35172229a1bd01f9ec9c82`.

El [build Android original 37167745832](https://github.com/miguelcoxcaballero/inhouse-read/actions/runs/37167745832) supera los nueve estados de pantalla y todos los gates originales de audio: **367.887 ms bloqueado**, capítulos 0–22, 136 starts/135 dones hasta el corte bloqueado, **30,822 segundos de PCM real en los últimos 30 segundos**, pausa/reanudación/Detener de la notificación y limpieza al cerrar pausado. El PDF avanza por sus páginas físicas 0 y 1, reproduce 50,565 segundos de PCM real bloqueado y Detener funciona después de despertar. Al parar se liberan servicio, audio pendiente y Wake Lock. No se usa recuperación al despertar, audio artificial ni voces del dispositivo. Certificado final de revisión `5039dbda12cec7f47ba6daf517ac9282d57eb3f6fbb09145a9a93bd70c756ffe`.

La captura fría muestra el PDF sin hora ni iconos del sistema. La PNG de Detener PDF es una captura intermedia beige y no se usa como prueba visual del botón: el XML original contiene «Detener», y la acción original, callbacks y volcados finales acreditan el Stop y cleanup. El primer auditor pasivo confundía los dos starts posteriores al corte bloqueado con su resumen; se conserva fallido y la revisión final contrasta callbacks y eventos hasta el mismo corte original, también para PDF. No se cambian tests, plazos ni resultados nativos.

La [APK pública 1.1.4, código 17](https://github.com/miguelcoxcaballero/inhouse-read/releases/tag/android-v1.1.4) se descargó de nuevo: **78.515.243 bytes**, SHA `feafaaa762b35344ac8b19418f9f6eb6cb1f725fba22b1ef3d3f273bd32a6191`, idéntica al build autenticado y al manifiesto servido. Firma V2 comprobada criptográficamente con el mismo certificado de 1.1.3. Mantiene el loader exacto de **2.089 bytes**, junto a dos stubs Capacitor vacíos; no incorpora una copia de la web, modelos ONNX ni WASM. Incluye las bibliotecas nativas ONNX de las cuatro arquitecturas. Certificado público `73b9a5b6cceece924748b443f9937e0421bced40d20a4223bb69800002b9d69a`.

Se conservan los verificadores públicos fallidos anteriores: uno imponía el antiguo límite arbitrario de 64 MB y otro contaba los dos stubs de cero bytes como una app empaquetada. La revisión final exige el tamaño exacto autenticado y el inventario exacto de tres archivos públicos. El nuevo tamaño corresponde al motor ONNX nativo; las voces siguen siendo descargas opcionales. La página real de descarga muestra 1.1.4 y 74,9 MiB.

Estos ensayos de emulador y navegador no acreditan calidad acústica, temperatura, batería, FPS ni reproducción indefinida en un teléfono físico. En esa fuente quedó pendiente el plazo del cierre; 1.7.40 tiene su comprobación separada arriba. La autenticación/subida real de Google continúa sin una sesión disponible.

## Cambios de 1.7.39

El bookView prepara modelo, snapshot y pose sin pintar hasta el encuadre final, incluyendo vistas reutilizadas. El setter conserva su contrato de un argumento y realiza una sola copia cuando corresponde. Pasan 2.621 unitarias de la candidata aislada y 20 casos originales de apertura/temas en el primer candidato. El ensayo DPR 2 de ese primer candidato conserva FAILED: 9.123 ms frente al límite original de ocho segundos. No se reducen resolución, materiales ni presupuestos de animación. La fuente final pasa 2.628 unitarias en 171 archivos, 20 casos originales de apertura y temas sin reintentos, build y 75 verificaciones Python.

El puente nuevo setReaderOwnership conserva la propiedad del libro al cambiar la visibilidad del WebView; el lifecycle de la Activity decide la política de pantalla. Las APK anteriores siguen usando setReadingMode. Se añaden cinco casos de bloqueo, cierre, disposal, BFCache y animaciones y dos contratos Java/Kotlin. Pasan 29 focales, incluidos los originales. La nueva captura Android 37167745832 está aprobada según la sección actual; los fallos históricos se conservan.

## Verificación de 1.7.38

Fuente `937f9e2dd665b9d6e65b56adaa83fc20d32585b8`, Pages `cbeff03c92c690d0fd948389792aa9663f00b5d1`. Coinciden 23 módulos y 44 recursos offline por HTTP; certificado `af4656e9eb6ade70e80a6e2b3472a0c5c337be212b59197c4330700211953c3a`. Seis casos públicos pasan sin omisiones ni reintentos, con 131 cuerpos HTTP y cuatro capturas revisadas; certificado `881e722cb06ecbf42f04509618b92f7f6bb01192359b212fbf95254437fe444c`. Pasan 2.617 unitarias en 169 archivos, dos E2E finales y las 75 comprobaciones Python originales. CI original `37165866474` pasa estrictamente: 2.617 unitarias en 169 archivos y 514 E2E sin omisiones ni reintentos; certificado `9b257196c4726a9d03b7313ec1017420051184b6c15598e7787f2e8fbf25c1c6`.

Android original `37166006039` conserva FAILED. Supera 367.387 ms bloqueado, capítulos 0–22, 138 starts/137 dones y 30,838 segundos PCM en los últimos 30 segundos. Pasan pausa, reanudación, Detener y cierre mientras está pausado mediante los controles reales. El PDF avanza bloqueado por las páginas físicas 0 y 1 con PCM real, pero falla el control Detener de la notificación después de despertar. La captura muestra el lector con la página 2, sin la notificación; no demuestra por sí sola la causa. El ZIP original autenticado contiene 12.408.960 bytes y 151 miembros; certificado de captura `ab851805acde12af8ddcc2d29e43e02078f85829338b06a009c7cac64ee3f924`. No se publicó APK ni se actualizó el manifiesto.

La CI original de 1.7.37 `37164356602` pasa estrictamente: 2.612 unitarias en 168 archivos y 514 E2E, sin omisiones ni reintentos. Certificado `6e3946f23764301ade4adc381ba625afc647b68c90d53f7dbc1b90590d6a4f9d`.

## Candidata 1.7.38: controles multimedia Android

La sesión recibe metadata del libro y estado antes de startForeground, identifica la ruta local y permite abrir la Activity real. La acción Detener también se publica como custom action de PlaybackState, porque los controles modernos se derivan de la sesión. Java y Kotlin sólo cambian la visibilidad de las barras cuando cambia el modo de lectura/lifecycle; los callbacks de foco mantienen su política sin repetir hide sobre el panel del sistema. Estas correcciones requieren una captura nativa nueva con los mismos gates y plazos.

## Verificación de 1.7.37

Fuente `b45a891d8acd6b69afebe7e8b6b00fc80e3edb3b`, Pages `25b2c651445eb1054b315c446e9d9dd3093489c8`. Coinciden por HTTP 23 módulos y 44 recursos offline; certificado `925954ddb5666674ec71d318b6cc99b0a6209be472dddefce594faa09ffa1475`. Seis casos públicos pasan sin omisiones ni reintentos, con 131 cuerpos HTTP y cuatro capturas revisadas; certificado `c69621c7eba4acde91ae7817f13ec9c9748242eb52d58496fa9ad1f1f0fe0baa`. Pasan 2.612 unitarias en 168 archivos, 21 E2E locales finales y las 75 comprobaciones Python originales. La auditoría completa de CI `37164356602` permanece separada.

Android original `37164475709` conserva FAILED, ahora por el control Pausar de la notificación tras despertar. Sí supera el gate original de continuidad: 367.915 ms bloqueado, capítulos 0–22, 135 starts/134 dones y 30,726 segundos de PCM en los últimos 30 segundos. No usa recuperación después de despertar. El ZIP original autenticado contiene 8.528.126 bytes y 109 miembros, SHA `91395bcb548f68a6688bd4aac23de6947323f85b343a6758dba06269bfb4b2dd`; certificado de captura `9543a3e8b0e55eb4143c19788ab2a1c7c19e0a4ade86fa53d234346ba19826db`. No hay release ni manifiesto nuevos. Los gates posteriores de detener, cleanup y PDF no se alcanzan.

El perfil local del cierre a DPR 2 termina en 10.023 ms y falla el plazo original de ocho segundos. La creación del modelo ocupa unos 18 ms; predominan las esperas al copiar el framebuffer GPU. La candidata aislada de framebuffer recortado también falla ese plazo y no se publica como corrección. Las primeras copias aisladas omitían plugins Vite de producción: su error CBZ no se atribuye al lector publicado. Los ensayos posteriores conservan el build fiel y sus fallos.

Google permanece sin sesión autenticada disponible: el preflight público no demuestra permisos, token, subida ni sincronización real.

## Candidata 1.7.37: inferencia nativa de voces

La nueva APK usa ONNX Runtime Android 1.22.0, un único executor y un hilo CPU por sesión. Conserva los archivos descargados, feeds, estilos, velocidad, fonemización y procesamiento PCM. Piper, Nakdimon y Supertonic comparten este puente. Los argumentos del modelo se transfieren por partes limitadas y los resultados corresponden a inferencias reales; no hay heartbeat, audio falso, recuperación por despertar ni voces del dispositivo. Los libros y sus posiciones continúan pasando por el lector original. La web y las APK anteriores conservan el worker.

Pasan 25 focales y una batería de 2.612 unitarias en 168 archivos. La revisión encontró una carrera nueva al volver a la voz anterior mientras se preparaba otra: el caso original reproduce el retorno prematuro, y se serializa detrás de la preparación pendiente. Se conserva su fallo, además del primer fallo de contrato por una palabra en el comentario Java. Los casos reales de escritorio generan PCM con las tres voces Piper a 1×/1,25× y 22 idiomas Supertonic × F1/F2/M1. La UI/origen de Android son stand-ins en este ensayo; no acredita audio con pantalla bloqueada ni velocidad en un móvil. El Java instalado tenía una DLL MSVC incompatible; los errores quedan conservados. Se utiliza un JRE Temurin aislado, cuyo ZIP coincide con el checksum oficial, sin modificar Java del equipo. La fuente final, CI, HTTP y captura nativa siguen separados.

## Verificación de 1.7.36

Fuente `3a6c508517c9e4359c091af5bd33edd8d97f6b9c`, Pages `7bbf8f5722cc2db6feb0de06ed79582416977425`. Sus 22 módulos y 43 recursos offline coinciden por HTTP; artefacto `01f92d0cef89e007dbb6c23f3c73cf7ddce374b1024b78f6861e0e82047ca09a`. Seis casos públicos pasan sin omisiones ni reintentos, con 125 cuerpos HTTP y cuatro capturas revisadas; certificado `a3d7e659cff08e9d263a47f419343d3e0e1c8a60da2e3f72f6a1b1cf3f43d1cb`. Pasan 2.596 unitarias locales, 21 E2E y 75 comprobaciones Python.

La CI original `37162089451` conserva FAILED: 2.596 unitarias y las 514 identidades E2E, pero el primer intento de la prueba de planta junto a libro fino no termina el cierre dentro de sus ocho segundos. El reintento pasa; no se utiliza para aprobar. La captura original conserva la fase closing, apertura de portada 0,2267 y un view nuevo; no determina por sí sola el coste interno. Once ZIP y doce jobs se conservan autenticados, certificado `b72559a97e5990f5e1306c7bac7db83c08bda74905ad84a21eece3cb17744cd0`. El cierre queda por corregir sin ampliar el plazo original.

Android `37162208867` conserva FAILED: 120 starts/dones, 240 callbacks emparejados y ningún PCM nuevo durante los 30 segundos finales. El ZIP tiene 8.831.654 bytes, SHA `484572b6067021f1a8967a85e10625e3ac461b55d6da0306e024188b15678898`; captura `69f4824e0a8dfd0dc3ed1e092d89e842a1a34c84dc922ad8ffdc2f19fe7f3cab`, fallo preservado `6ee5fe912f925bedc86a7a804f84de47f8fa7c50e6e409d4c381e27b0362805f`. Los 21 finales que vacían la cola tienen sus 42 observaciones posteriores. La última muestra el fragmento 121 en synth y cuatro entradas listas; no llega un nuevo recibo del worker antes de despertar. El lector está idle, sin navegación pendiente. Esto localiza la petición no procesada, sin demostrar la causa concreta del scheduler. No se publica APK; la recuperación después de despertar sigue siendo sólo diagnóstico.

## Cambios preparados de 1.7.36

La extracción EPUB conserva el Inflate original de zip.js, bytes locales, documentos, encodings y CRC; se desactiva sólo su dependencia de DecompressionStream nativo. La regresión nueva reproduce cinco entradas al codec nativo en la fuente anterior y pasa con cero sobre el candidato. Pasan 10 focales, incluidos los siete originales de bytes/ZIP. El primer E2E nuevo tenía un censo incorrecto de tres capítulos para un fixture de dos; se conserva fallido. Con el censo exacto de dos capítulos, el build anterior conserva otro fallo: seis llamadas al codec nativo. No demuestra todavía la causa de la interrupción Android. Cada done real que deja la cola vacía conserva un snapshot en su evaluación original; se elimina el filtro diagnóstico que sólo observaba el primero del epoch. No hay polling, timers ni evaluaciones añadidas al puente.

Sobre el build final pasan **2.596 unitarias en 165 archivos**, **21 E2E sin omisiones ni reintentos** y las **75 verificaciones Python originales**. La tanda E2E incluye 14 casos con modelos naturales reales, tres de continuidad/pausa/detener entre capítulos, dos de lector/catálogo, espeak offline y la regresión de descompresión. La publicación, CI y captura Android nuevas siguen separadas.

## Verificación de 1.7.35

Fuente `9a15ab839d19597e13a2bb88f8fe138f91482a8a`, Pages `73ba3a8071e17863b8515f555057a514d9ce9fb2`. Pasan 2.594 unitarias en 164 archivos, certificado `2ccb45506f6594ebf92515b8bb3d2a14fb6128f8318f53d7c23047d6794ae44d`. Coinciden por HTTP 22 módulos y 43 recursos offline, artefacto `8ad481fc8b06bb3accd7ad603e3995c8a4009eacb1174f6b3a634bd0d253e429`. Cinco casos públicos pasan sin reintentos, con 110 cuerpos HTTP y cuatro capturas revisadas; certificado `67b4767e0a57a6377c8cc3877c47818579262d6e446d20e5be956d105314f84f`. Pasan 17 E2E locales finales y, por separado, tres casos originales de continuidad/pausa/detener entre capítulos. CI original `37160432704` aprobada: 2.594 unitarias en 164 archivos y 513 E2E sin omisiones ni reintentos; certificado `e7f93a074b8c96255728c6bd04deae5c1efd55189ed679c0c916b12f83653384`.

Android `37160573040` conserva FAILED: 366.366 ms bloqueado, 120 starts/dones, 240 callbacks emparejados y cero PCM nuevo en los 30 segundos finales. Captura `77b45ca1e5b9c83c5aebdc470fa9a77e9dfb5c8590eb9e4852e5b663b1169ef6`; ZIP 9.349.798 bytes y 104 miembros. Los 175 recibos originales de síntesis muestran que la petición 27 completa su fase 7; no hay una petición posterior antes de despertar. Revisión de fases `092dd1964324730b97be987717050343ec384366254074462ee84c8cb7b4dbc7`; fallo preservado `306e576a63d3c598ae89c3b5c7c16a87512aa3176122c391068b8904707480f9`. No se publicó APK. La extracción del siguiente capítulo sigue siendo una hipótesis por comprobar; la recuperación al despertar no aprueba el gate.

## Cambios de 1.7.35 en preparación

El fonemizador carga una vez su código WASM y el paquete de datos, compila una vez y crea una instancia y un sistema de archivos nuevos cada 40 llamadas. Los datos maestros se conservan inmutables; cada filesystem recibe su propia copia. Pasan 51 focales en siete archivos y un caso con espeak WASM real: 161 llamadas, cinco heaps y tres idiomas con IDs constantes. Tras las primeras 40 llamadas se desconecta la red y no hay refetch de WASM ni datos. El primer ensayo focal conserva 28 aprobados y un fallo del nuevo doble de respuesta vacía: reutilizaba un mismo Response en dos lecturas; se corrige ese doble para entregar cuerpos distintos.

Los recibos nativos sólo registran fases numéricas en los awaits originales del worker, cuando el puente diagnóstico está presente. No incorporan texto, timers, polling, evaluaciones adicionales ni cambios de reproducción. La descarga repetida es una dependencia eliminada; el registro anterior no prueba que sea la causa del fallo Android. Pasan **2.594 unitarias en 164 archivos**, build final y **75 verificaciones Python**. El caso real del fonemizador y las 51 focales conservan resultados propios; las pruebas finales con modelos reales, CI, publicación y captura Android siguen separadas.

## Verificación de 1.7.34

Fuente `3850274e7bfbe639dd1718bd1a8ecffecd742427`, Pages `5430b1f64794b502da8c424883bfd91a3a4311a5`. Pasan 2.584 unitarias en 162 archivos, certificado `dfc1d9de0805f58af78fe6f14827d4c516f4c8c6db3ce1c7e9c73492a98f06f1`. Coinciden por HTTP sus 22 módulos y 43 recursos offline; artefacto `069cc291f4787efc0e591556fab06e51af657968b86c8bd25c8e1d65b0fc6895`. Cinco casos públicos pasan sin omisiones ni reintentos, con 109 cuerpos HTTP y cuatro capturas revisadas; certificado `8d461555b44ae3dcb30f0c16d8171000a985907740cd9523dbf718df61160c39`. El primer pin rechazó HTML anterior durante la propagación y conserva sus bytes. CI original `37158691462` aprobada: 2.584 unitarias en 162 archivos y 512 E2E, sin omisiones ni reintentos; certificado `7dd6e83519e7b2e2072cd765f15caafca15449afa245615cddf30143cde6c8e2`.

Android `37158815932` conserva FAILED: 368.473 ms bloqueado, 120 starts/dones y 240 callbacks emparejados, capítulos 0–19, cero PCM nuevo en el tramo final de 30 segundos. El ZIP original autenticado tiene 8.512.616 bytes y 112 miembros; certificado de captura `3fd731a1a5175e2d6af7e44991a20ff19c413654340e578cb4284a36c1bbf288`. No se publicó APK. Los 120 fragmentos reproducidos no son un recuento de llamadas al fonemizador, porque el audio puede reutilizarse del caché. La recuperación al despertar permanece sólo diagnóstico.

## Cambios de 1.7.34 en preparación

Con la pantalla apagada, Foliate obtiene el texto del capítulo siguiente mediante su extractor original de documentos, sin navegar el iframe ni esperar su renderizado. Sólo el inicio audible activa ese capítulo; la posición se guarda con el CFI real del fragmento. Al volver a la app se muestra la posición más reciente y se conserva el paginador normal en primer plano. No se añade audio silencioso, heartbeat, recuperación por despertar ni sustitución de voces.

Pasan 91 focales en siete archivos, incluidos 12 de documentos/CFI y tres de ReadingVoice con capítulos completos. El primer candidato conserva 51 aprobados y tres fallos: dos regresiones de orden de navegación corregidas dentro de la cola original y un helper de CFI de test corregido para utilizar el contrato real. Los ensayos iniciales permanecen separados. Las dos primeras baterías completas conservan cada una 2.583 aprobados y un fallo de snapshot: la espera vacía de catch-up retrasaba su inicio. Se corrige esperando sólo cuando existe un cursor audible; pasan 35 focales de snapshot, cursor y navegación. Los tests originales no cambian. Build final y cinco E2E finales aprobados sin reintentos: continuidad entre capítulos, pausa/detener durante el cambio, carga del lector y catálogo móvil. El candidato anterior pasó 17 E2E, incluidos 14 con modelos reales; el primer lanzamiento con una variable de fixtures incorrecta conserva tres aprobados, cuatro fallos de preflight y diez omitidos. No se suman ni se convierte ese intento en aprobado. La batería completa final, publicación y captura Android nuevas están pendientes.

## Verificación de 1.7.33

Fuente `a02d85ec0ada05daabc8293ae2cdcf2887fa826f`, Pages `257868c27be0f07a52b4732ee0fd24b0468e0e25`. Sus 22 módulos y 43 recursos offline coinciden por HTTP; certificado SHA-256 `937942ec1c8366e5a8714d1556cfa06c8edd16861f7cd32117b20751d93938fa`. Cinco casos públicos pasan sin omisiones ni reintentos, con 110 cuerpos HTTP y cuatro capturas revisadas; certificado `f1373b793360de039bb8d362b9b4a0b3327807ed664753b344637d9913d08d13`. CI original aprobada, run `37156691213`: **2.569 unitarias en 160 archivos y 512 E2E**, sin omisiones, reintentos ni flaky. Certificado SHA-256 `41ae3ea781910ec55b51cf8267830a5b502b6f6fe42984c8842a5a4d40afabfd`.

Android `37156804640` conserva FAILED: 108 starts/dones y 216 callbacks emparejados; cero PCM nuevo en el tramo final de 30 segundos. El último cambio llega a `viewLoadPending:true` y no termina antes del gate. El ZIP original autenticado tiene 9.412.228 bytes; certificado de captura SHA-256 `ccc1a3b3e0d17317d6fdd63987603d8e1ca20e69c75d369df73a9a44ded194c8`. La recuperación al despertar sigue siendo sólo diagnóstico; no se publicó APK. La primera recogida HTTP falló por timeout mientras el run seguía activo; se conserva separada de la segunda recogida del mismo run, sin repetir pruebas.

El botón Google real de la web publicada abre la página oficial para introducir la cuenta. La petición pública Android, con su cliente y redirect de producción, también obtiene la página de acceso sin `redirect_uri_mismatch`. Son preflight sin cuenta, permisos, token ni subida real: no acreditan una conexión Drive completada.

## Cambios de 1.7.33

La preparación cuenta sólo el prefijo de audio anterior a la frase que falta. Una frase posterior guardada, incluso de una página diferida, no retrasa la frase actual. Los recibos reales start/done también liberan PCM que esperaba espacio en AudioTrack; la apertura de la cola ignora las frases terminadas cuyos buffers ya se liberaron. No cambia la voz, muestras, velocidad ni límites de preparación.

La fuente 1.7.32 reproduce cinco fallos y un aprobado en seis casos sin avanzar temporizadores. La corrección pasa los seis, los 37 existentes de motor y los 16 de salida nativa: **59/59**. Batería completa: **2.569/2.569 en 160 archivos**, build aprobado. Pasan **14/14 E2E con modelos reales**, sin reintentos ni omisiones, incluidos Argentina, EPUB/PDF, continuidad entre páginas, cambio de voz, reinicio tras 90 segundos y modo sin conexión. Android necesita captura nueva. Un primer intento E2E no recibió la ruta de modelos del equipo: dos preflight fallidos y diez omitidos, conservados en `release-1733/reading-e2e.log` y sus trazas. El ensayo con los modelos locales tiene resultados propios y no convierte ese intento en aprobado.

## Verificación de 1.7.32

Fuente `80cef03d0848ad9ac864634f2d6bd3cfa544a3a5`, Pages `f5470f8dfdd6386fff5950688533aa38884cf7ae`. Sus 22 módulos y 43 recursos offline coinciden por HTTP; artefacto SHA-256 `4207654df4b9575f1039909244916e735a4b641bf1e1a9c007f134e5cf5a08db`. Cinco casos públicos pasan sin reintentos, con 110 cuerpos HTTP y cuatro capturas revisadas; certificado `ca0924e7161f84de3604c4afe737134396181f4b886acac008293ca64e4d4145`. Certificado de 2.563 unitarias locales: `f149d259662100c3764ebb3ca0efdb4ac4921086bf9f35293b196b472bc1b385`. CI original de esta fuente aprobada, run `37156109766`: 2.563 unitarias en 159 archivos y 512 E2E, sin omisiones, reintentos ni flaky. Certificado SHA-256 `1bcbec9db3667ebab3e16561a78196093f8dc7eac37d4ae8abd3fb0364c68d03`. La autenticación Google real mantiene su verificación separada.

## Cambios de 1.7.32

Las lecturas JSON y Blob de Drive comprueban la generación antes y después de consumir su cuerpo, sin una copia adicional del archivo. Los pasos de carpeta, listado, descarga, subida multipart/reanudable y progreso conservan la generación de su operación. Las carpetas sólo se invalidan si la petición que falla sigue siendo la que está guardada; cancelar la sesión descarta esos caches.

La fuente anterior reproduce **cinco fallos y tres aprobados** en ocho regresiones. El candidato preparado pasa **31/31**: las ocho nuevas, seis carreras de sesión y 17 contratos de OAuth/cliente existentes. Originales separados en `release-1732/drive-body-expanded-baseline.*` y `drive-body-expanded-candidate.*`. Son respuestas controladas, sin una cuenta Google real. Sobre la fuente final pasan **61/61 focales**, **2.563/2.563 unitarias en 159 archivos**, build y **cinco E2E sin reintentos**. Publicación HTTP y CI se verifican por separado.

## Verificación CI de 1.7.31

Run `37154550395`: **2.555 unitarias en 158 archivos y 512 E2E**, 3.067 en total, sin omisiones, flaky ni reintentos. Doce jobs y once ZIP originales autenticados, certificado SHA-256 `d91a51eaa82f5da3cabe274c97910d44beb5160a68994fa4ee16af528b3064b0`. Se conservan los mismos controles y censos; sólo se cambia el transporte HTTP de consulta a PowerShell ante el bloqueo de las peticiones CLI. La preparación inicial fuera del directorio del método falló antes de acceder a GitHub y se conserva separada.

## Verificación de 1.7.31

Fuente `0036d69eddd6549aa7750580e766fe1184405fc9`, Pages `9536329e84014f07f3cc30fba32acfdb6f9d04e0`. Pasan 2.555 unitarias en 158 archivos y seis E2E focales sin reintentos. Certificado local SHA-256 `fe58e9abbc6129abbaae99cfe105f0d1ac879e6407e27034de463bd8558e173e`. Los 22 módulos y 43 recursos offline coinciden por HTTP, artefacto SHA-256 `dbc90a5d0f6abc419a04c94520f15a1dff1210cc701114524db2c393e807a3d3`. Pasan cinco casos públicos con 110 cuerpos HTTP y cuatro capturas revisadas, certificado `900f8ad89bbe5f3e546f7deaa13335dd7058e727620c4adeacde42b0e4329d78`. La primera consulta de pin conservó HTML anterior durante propagación; sus bytes y el rechazo permanecen separados del segundo pin correcto.

## Cambios de 1.7.31

Batería local completa: **2.555/2.555 unitarias en 158 archivos**, un worker, sin omisiones; originales `release-1731/full-unit.json` y `full-unit.log`. Las comprobaciones CI, HTTP y Android de esta fuente siguen separadas.

Se conserva el View y su iframe entre capítulos, manteniendo la navegación real, el parser, el sandbox y la maquetación originales. Se eliminan los overlays y la observación del documento anterior. Los eventos `about:blank` o tardíos no completan la carga del capítulo nuevo; las fuentes anteriores tampoco expanden el documento actual. Los errores rechazan la promesa y cancelan sus listeners. El bloqueo del paginador se libera también cuando la carga falla o se cancela.

Pasan **29/29 focales en cuatro archivos**, build, **seis E2E sin reintentos** y **75 verificaciones Python**. Los E2E conservan los plazos originales: seguimiento y cambio de capítulo, cancelación al pausar/detener, cierre EPUB al girar, reapertura CBZ y conservación de ancla. La batería unitaria completa ha pasado. No demuestra aún continuidad bloqueada. El diagnóstico Android conserva un logcat completo antes de despertar o recuperar tras un fallo; los umbrales de audio y controles originales siguen intactos.

## Verificación de 1.7.30

Batería CI completa aprobada, run `37153385656`: **2.546 unitarias en 157 archivos y 512 E2E**, 3.058 en total, sin omisiones, reintentos ni flaky. Once ZIP y doce jobs originales contrastados; certificado SHA-256 `e137add78e5e68d3086268484b4e324cc805890bf53bb61418e33d835c105c8e`.

Fuente `be2cc4d7cfb11cd94959b7bae8902e4dea5d321d`, Pages `d9b530ba1adbce5b11d44cefa1b048e9ec33e0b3`. Sus 22 módulos y 43 recursos offline coinciden por HTTP; certificado de artefacto SHA-256 `90ff91df4cdbb52944bb2f45a4ce9d293a8f280c834c68eb947bc807d4d54bfc`. Pasan **cinco casos públicos sin reintentos**, con 110 cuerpos HTTP y cuatro capturas revisadas, certificado SHA-256 `37be533b1fcdbabae904ed8ebaf8d49ea25821ebdcdeb32f57248851cfb1bf23`. La batería CI de esta fuente sigue separada.

## Cambios de 1.7.30

Las peticiones de Drive conservan la generación de sesión y el token concreto con que empezaron. Se rechaza una respuesta de una cuenta que ya se cerró antes de continuar con otra operación; un 401 tardío de un token anterior no borra un token renovado. No cambia los clientes, permisos ni el flujo OAuth de Notes. La fuente anterior reproduce cuatro fallos en seis regresiones. Pasan las seis sobre la fuente corregida, las 17 pruebas existentes de cliente y las 30 de CloudSync: **53/53**. Build y cinco E2E aprobados sin reintentos: importar local/subir desde portada, conexión con foto, reintento, perfil y caducidad. Usan respuestas controladas. La comprobación con una cuenta real sigue pendiente por la falta de conexión del navegador autenticado.

## Verificación de 1.7.29

Batería CI completa aprobada, run `37151860869`: **2.540 unitarias en 156 archivos y 512 E2E**, 3.052 en total, sin reintentos, flaky ni omisiones. Once ZIP y doce jobs originales contrastados con su fuente; certificado SHA-256 `7060cf9d7a2004d6fefc94ffc78e12473095de10416061818f614fce61758703`.

Fuente `b4da77674116bd6e3598e3fc699143c9d53b5d6d`, Pages `f4f873374d55a40ea97c08d3e45733e83d927fe1`: **2.540/2.540 unitarias, 156 archivos**, seis E2E focales y cinco casos públicos sin reintentos. Certificado local SHA-256 `d854132c12c50218650915a1ecd96662b4f6ca2887ab1f939a0850305867d51c`; público `d46d10c2cc62c124f7153e60f693895ba3ccdc21cbeebb666d22380c7b52501a`, con 109 cuerpos HTTP y cuatro capturas revisadas. Los 22 módulos y 43 recursos offline coinciden por HTTP; artefacto SHA-256 `542132d212a89a7c30cad6b7d1a462ff0219a61f528278793176010650ddf623`. La preparación original alcanzó su buffer de 100 MB por los módulos históricos retenidos; el segundo método lee cada blob Git por separado y conserva todos los hashes. No altera pruebas ni límites del producto.

Android `37152067644` conserva **FAILED**: 114 starts/dones y 228 callbacks emparejados, pero ningún PCM nuevo en el último tramo de 30 segundos. Reutilizar eventos por mensajes y mantener el iframe en layout no basta para resolver la interrupción. La APK no se publicó. El ZIP original autenticado tiene 7.048.365 bytes y 111 miembros; certificado de captura SHA-256 `466a8f634b40b7777b90c20331c25a261e0613f6b2e0e3457b4ac811cc8e64a1`.

## Cambios de 1.7.29

El iframe del capítulo permanece en la maquetación con opacidad cero hasta recibir el evento original de carga y completar su renderizado. Se conserva la navegación, sandbox, cálculo vertical/RTL, fondo, estilos y observación de tamaño; no se añade un camino alternativo de preparación ni timers. Pasan 20 focales en tres archivos, el build y seis E2E sin reintentos: seguimiento al capítulo siguiente, pausa/detener durante el cambio, vuelta móvil EPUB, reapertura CBZ con resize y conservación de ancla. La continuidad bloqueada necesita un ensayo nuevo; esta hipótesis no convierte el fallo anterior en aprobado.

## Verificación de 1.7.28

Batería CI completa aprobada, run `37151378889`: **2.536 unitarias en 155 archivos y 512 E2E**, 3.048 en total, sin reintentos, flaky ni omisiones. Certificado original agregado SHA-256 `4922151ecf6e13d140c0e7aec93a63b562ca0355d029fe008c2796fb86d76cd2`.

Fuente `8a72d43cd021efe361a510e87f5a8cc8a98b04ef`, Pages `3a6c2e8a1489b49c002b2572ec097070bc74b503`. Pasan **2.536/2.536 unitarias en 155 archivos**, sin omisiones. Certificado local SHA-256 `3483647c880ff05e269a5884037e1a41f2c5e5790a6856c92368cc66faa19780`. Sus 22 módulos y 43 recursos offline coinciden por HTTP, certificado `artifact-1728-8a72d43.json`, SHA-256 `38d37f4ca385f7977e299a885c5fea00b47b13430ea286cca0703df18c5200fb`. Pasan **cinco casos públicos**, sin reintentos, y se revisan sus cuatro capturas originales. La batería CI completa de esta fuente ha pasado con certificado propio indicado arriba.

## Cambios de 1.7.28

Se rechazan las posiciones incompletas al guardar progreso: un evento de maquetación sin CFI/página válida no sobrescribe el marcador; tampoco una captura de cierre sin ancla. La regresión nueva usa Foliate e IndexedDB reales con un CBZ: en el build anterior, un evento sin CFI borra `epubcfi(/6/6)` y deja `null`. Se conserva ese fallo en `release-1728/position-public27-baseline.*`. Pasan 45 focales en tres archivos, incluidas diez sobre posiciones y su integración. Build y tres E2E posteriores aprobados sin reintentos: CBZ con resize, conservación del ancla y cámara isométrica. Batería completa y publicación nuevas pendientes. La prueba isométrica conserva el gate de ocho segundos y compara órdenes poblados después de importar, sin cambiar los requisitos de cámara, filas ni organización.

El ensayo Android `37150241529` conserva **FAILED**: 114 starts/dones, 228 callbacks emparejados y capítulos 0–18; no hubo PCM nuevo en los últimos 30 segundos. El penúltimo cambio de capítulo termina completo; el último llega hasta `displayStage:3`, `sectionLoadPending:false`, `viewLoadPending:true`, sin recibir la terminación de la carga del iframe antes del gate. Las fases anteriores y la recuperación al despertar quedan separadas. El cambio de tareas del worker no basta; no se publicó APK. ZIP original 10.004.779 bytes, 115 miembros; certificado de captura SHA-256 `31969171dbdbb028d9e06a9de247224fdcc5899b01f3c28516855842404ca267`.

## Verificación nueva de 1.7.27

Fuente `ecc6d526cd7b91471aef5bb72a6c0abc9efc5422`, Pages `70b9cd7baddb53f730e72021314c82ecac448a9b`: sus 22 módulos y 43 recursos offline coinciden por HTTP. La primera consulta conservó HTML de 1.7.26 durante propagación; la segunda obtuvo los bytes nuevos, con certificado `artifact-1727-ecc6d52.json`, SHA-256 `efdc662b02184fb437b193988660f00008415c6becd72c02011b28d7b807723d`.

La batería local original conserva 2.525 aprobados y un fallo: el VM de la prueba de hebreo quitaba imports y no inyectaba el nuevo helper. Con sólo esa inyección corregida pasan **2.526/2.526 en 154 archivos**; el certificado conserva el diff exacto y su alcance, SHA-256 `68f79dbb395b4bd30ebdc10c70a4e288afb801623e39f281117bd36e9947f310`. No se declara aprobada la fuente de tests sin modificar.

La primera tanda pública conserva **4/5 aprobados**: voz EPUB real, ampliación offline de perfiles, carga del lector y catálogo móvil. El caso isométrico comparó el orden vacío durante la preparación de geometría con el orden ya poblado; queda fallido, sin reintentos. El ensayo Android `37150241529` usa la web 1.7.27 y conserva el fallo de continuidad. Su certificado independiente de fallo tiene SHA-256 `858c3c3c05523ae6fe70a31952d32d09d824107e3ab6bb2647cc51a737aa2c5f`.

La batería CI de 1.7.26, run `37148530807`, conserva **FAILED**: 2.520 unitarias aprobadas, 511 identidades E2E, un caso PDF fallido y otro CBZ flaky. Once ZIP y doce logs originales autenticados; certificado SHA-256 `28a65465d80d9162f88422bb017cec9aca75bb882c17ca100a3cdbe56a39934f`. Los dos casos originales pasan en una tanda local sin modificaciones ni reintentos sobre el build 1.7.27; esto no convierte el run anterior en aprobado. Sus capturas originales se revisaron: muestran la página correcta en el modelo 3D mientras la transición sigue en curso.

## Cambios de 1.7.27

El worker neural, los pasos de inferencia Supertonic y el análisis de cortes de página ceden mediante una tarea MessageChannel finita, sin timers ni heartbeat. La cola de síntesis expone una promesa de terminación: liberar o cambiar de voz espera esa promesa en vez de consultar cada cinco milisegundos. Se mantienen modelos, pasos de inferencia, audio y cancelación. Pasan 39 focales en cinco archivos. Dos casos ejecutan el protocolo del worker real con timers suspendidos; el worker de la fuente anterior reproduce el atasco en el caso FIFO. El fallo original y sus fuentes quedan en `release-1727/timer-baseline-protocol.*`; no se presenta como una tanda aprobada. Build aprobado y cuatro E2E locales aprobados sin reintentos: navegación EPUB, cancelación al pausar/detener y gesto de portada. Batería completa, publicación HTTP y ensayo Android nuevos están pendientes.

## Cambios de 1.7.26 y estado actual

La fuente `918fae7cba9e0e2ad7fc846bb6f8b3a649966d93` está publicada en Pages `eebba5d390f39919f82ea6ab92e6402c31c299d9`. HTTP confirma sus 22 módulos actuales y 43 recursos offline. Pasan **2.520/2.520 unitarias en 153 archivos** y **5/5 casos sobre la web publicada**, sin omisiones ni reintentos, con 110 cuerpos HTTP autenticados. Certificados locales `release-1726/local-unit-certification.json`, SHA-256 `8b20a3c7a5e8f996f8bb325098a3d3f980c5d318df2007e3d3754706799037cb`, y `release-1726/public-918fae7/certification.json`, SHA-256 `6bee430a1e8a5c493440e93aaffed3fb6ed4585c74fa9c44daa0e0085d3736a9`. Las cuatro capturas públicas se revisaron. El primer intento de sellado faltaba el extractor de trazas; se conserva separado del segundo sellado completo, sin repetir las pruebas ni cambiar sus resultados.

El ensayo Android `37148623226` usa esa fuente y conserva **FAILED**: 108 starts/dones y 216 callbacks emparejados, pero ningún PCM nuevo en los últimos 30 segundos. El registro directo demuestra que el último cambio de capítulo termina en 23 ms (fases de sección, página y paginador completas). Después se reinicia la época de audio a 21 sin recibir PCM hasta despertar. Esto descarta que ese cambio de capítulo siga esperando una sección; no demuestra todavía qué espera del worker queda suspendida. La recuperación al despertar es sólo diagnóstico. No se publicó una APK fallida.

La batería CI de 1.7.25, run `37146772366`, conserva **FAILED**: sus 2.511 unitarias pasan y aparecen las 511 identidades E2E, pero el gesto de portada tiene un intento fallido y otro aprobado, por lo que se rechaza como flaky. Sus once ZIP y doce logs originales se contrastaron; certificado `release-1725/ci-failed-original-37146772366/certification.json`, SHA-256 `7a5c8366ce9c300e0f8858f3c59222e100418bc808282bd2525e9043bea2f92e`. El input llegó con sólo 0,586° de inclinación, frente al mínimo exigido de 3°.

Se prepara una observación del gesto después de pintar la pose, con input CDP real y el mismo gate sobre el ángulo efectivamente recibido. Tres repeticiones aisladas pasan con **ocho segundos de preparación y 900 ms de retorno**, sin reintentos: inclinación 5,52°, retorno 595/599/615 ms, primera oscilación y retorno monótono. Certificado `release-1726/cover-frame-bounded/certification.json`, SHA-256 `6b9a88a7cb4b5680a0309562fd60438bfffd7554fb9ad847cb8c26f3439db3db`. Se conservan el intento CDP directo fallido y el diagnóstico preliminar sin límite explícito de preparación. Este ajuste afecta al observador, no al reloj, calidad ni animación del producto; necesita su nueva batería CI.

El archivo EPUB se lee una vez al abrirlo y zip.js conserva la descompresión y validación originales. Los capítulos se decodifican desde bytes en memoria y los recursos mantienen su MIME. Siete pruebas con el ZIP real contrastan todas las entradas con el lector anterior, bloquean las operaciones posteriores de Blob/Response y comprueban codificación, buffers y archivos incompletos. Los dos intentos iniciales con errores del harness permanecen separados del aprobado. Con las fases del paginador y el puente nativo pasan 22 focales en tres archivos.

El [ensayo Android 37146839908](https://github.com/miguelcoxcaballero/inhouse-read/actions/runs/37146839908), fuente `ccd3e67`, conserva **FAILED**: 114 starts/dones, 228 callbacks recibidos y capítulos 0–18, pero ningún PCM nuevo en los últimos 30 segundos. La última observación espera una sección EPUB; los capítulos anteriores muestran brevemente ese mismo estado. No demuestra por sí sola qué operación interna queda pendiente. El nuevo registro directo de fases añade sólo valores numéricos y booleanos en los puntos originales, sin nuevos timers, evaluaciones JavaScript ni comandos de reproducción. El gate de continuidad sigue intacto. No se publicó una APK fallida.

La web 1.7.25 está publicada: fuente `ccd3e673805b63c6f173d7ec5905888a1583a324`, Pages `51e39703e23e664cbc31074dd1399270581d3c6a`. La batería local final pasó **2.511/2.511 unitarias en 152 archivos**. La segunda tanda pública pasó **5/5**, sin omisiones ni reintentos, con 110 cuerpos HTTP autenticados. Certificado `public-ccd3e67-attempt2/certification.json`, SHA-256 `e09a7bb388476de990819ad7bef24727bef750ec5c5e103c4b3a412b27197a29`. La primera conserva **4 aprobados y un fallo HTTP 503**. El caso EPUB usa un sink PCM controlado; no acredita AudioTrack bloqueado.

La batería CI original de `40490ea` pasó **2.500 unitarias y 509 E2E**; la de `a94f895`, **2.507 unitarias y 509 E2E**. Sus once archivos originales, doce jobs y censos se contrastaron por separado, sin reintentos, omisiones ni flaky. Los 220 WAV originales de la primera matriz coinciden con sus mediciones: PCM real, diez hashes distintos por idioma, un worker y cero solicitudes externas después de instalar las voces. Esa prueba no acredita acentos regionales ni resuelve la continuidad Android.

La cuenta Google real sigue sin verificarse: el navegador con sesión perdió la conexión y el navegador integrado no expuso la ventana de autenticación. Se canceló ese intento; no se declara ningún login ni subida real completados. La APK pública conserva la versión 1.1.3, código 16; 1.1.4 necesita superar continuidad, controles y PDF con pantalla bloqueada.

## Cambios de 1.7.25

La apertura del lector mantenía visibles los controles antes de completar la carga real del motor y de la posición guardada. Un observador sobre la fuente pública `40490ea` confirmó que durante ese intervalo todavía no existía un rango EPUB legible. La corrección mantiene los controles ocultos y las acciones superiores inertes hasta terminar; muestra un estado discreto de carga, limpia los fallos y conserva las transiciones de portada existentes.

El [ensayo Android 37145835659](https://github.com/miguelcoxcaballero/inhouse-read/actions/runs/37145835659), fuente `a94f895`, falló antes de iniciar el audio: después de descargar la voz, la fila «Voz» para cerrar el catálogo había quedado fuera del área visible. No hubo lectura con pantalla bloqueada ni datos para localizar el await pendiente. Se conservan el ZIP original de 105 miembros, SHA-256 `d2373d13db7c91b2a93dcdd36fd0492eba68a213e6c73a65aab7d00a5e8eb1a5`, y el certificado de captura, SHA-256 `3e5b56722285664f93daa3f3c7b70a16a9a5c341ff07e560964b9c23714998a7`. La corrección limita la altura del catálogo ampliado y desplaza su raíz, conservando el botón visible y alcanzable.

Verificación local: **80/80 focales en tres archivos** y **2/2 E2E móviles**, sin reintentos. El caso de carga retiene el módulo real y comprueba que, al liberarlo, existe texto EPUB legible; el de catálogo comprueba el hit test del botón después de desplazar hasta M5 y cierra el menú. Su captura se revisó visualmente. Originales `.animation.local/release-1724/catalog-ready-unit.*`, `reader-ready-catalog-e2e.*` y `reader-ready-catalog-build.log`. La batería completa anterior al último ajuste del catálogo pasó **2.510 unitarias en 152 archivos**; no sustituye la batería de la fuente final, cuyo censo esperado es 2.511 unitarias y 511 E2E.

La tercera tanda pública anterior pasó **3/3**, sin reintentos ni omisiones, sobre `a94f895`, Pages `782752125dee716296686e348da1cf1cede944e4`: continuidad EPUB con modelo real y sink controlado, ampliación de las voces anteriores con PCM real también sin conexión y gesto isométrico. Conserva 78 cuerpos HTTP autenticados y las capturas revisadas. Certificado `.animation.local/release-1724/public-ready-a94f895/certification.json`, SHA-256 `ef913a157334948ed38de86bf3634c313f854d9f7cb29ba9e5fb116cc7f86767`. Esa tanda esperó un rango EPUB legible antes de evaluar las voces; no acredita por sí sola la nueva corrección de carga ni AudioTrack Android. Los dos fallos públicos anteriores siguen separados.

## Cambios de 1.7.24

La fuente `40490ea6651497f8a65e4212900262e24cf969c4` está publicada en Pages `ed3e097ed6a131c7e49ba4f6b70067cce600fb2b`. HTTP confirma los 22 módulos actuales, 43 recursos offline y los chunks antiguos recuperados. Certificado `artifact-1724-40490ea.json`, SHA-256 `4c975e441981e6a965e676de5ad7954e39ba3f3d9e5382981538ce3b386e88ce`. La comprobación aislada de los diez perfiles Hindi pasó 10/10, sin reintentos, con WAV reales y salidas propias.

Las dos primeras tandas públicas conservan cada una dos casos aprobados (EPUB y estantería) y un fallo en la ampliación de voces. La primera se cerró durante la preparación del caché; la segunda descargó y verificó el paquete original, pero al iniciar la lectura encontró «sin texto legible» y no produjo audio. No se presenta ninguna de esas tandas como aprobada ni se atribuye ese fallo al modelo sin localizarlo. Originales `public-three/` y `public-three-real-download/` en `.animation.local/release-1724/`.

El observador de navegación añade estados numéricos para localizar los awaits originales del paginador: carga de sección, carga del iframe y anclaje. No añade tareas, timers, microtasks, eventos ni una navegación alternativa. Pasaron 32 focales y 74 verificaciones Python; los dos intentos iniciales con errores del harness se conservan. Este cambio es diagnóstico: requiere otro ensayo Android y no acredita haber corregido la pausa.

Supertonic pasa de tres a diez perfiles reales, F1–F5 y M1–M5, en los 22 idiomas compatibles de la app: 220 combinaciones, junto con 39 opciones Piper existentes. Son 259 opciones de idioma y voz; los perfiles compartidos no equivalen a 259 personas ni acreditan acentos regionales nuevos. Las voces usan los [perfiles originales de Supertone](https://huggingface.co/Supertone/supertonic-3/tree/3cadd1ee6394adea1bd021217a0e650ede09a323/voice_styles), fijados por revisión, tamaño y SHA-256.

El paquete completo tiene 17 archivos y 210.204.134 bytes. Los siete perfiles nuevos suman 2.039.325 bytes. Se admite sólo el manifiesto anterior completo y exacto; sus voces siguen disponibles sin conexión y una ampliación fallida conserva ese manifiesto. La interfaz muestra «Ampliar voces» y 2 MB adicionales cuando ya existe el paquete anterior. El worker anterior se sustituye al elegir un perfil nuevo, conservando una sola sesión; descargar la ampliación no interrumpe la reproducción actual.

Las pruebas focales de almacenamiento, motor e inferencia pasaron 82/82, y las de catálogo y menú 153/153 en sus tandas propias. La primera batería completa conservó 2.499 aprobados y un fallo: el contrato del catálogo todavía aceptaba sólo F1/M1/F2. Actualizada esa expectativa a los diez perfiles conocidos, la batería pasó **2.500/2.500 unitarias en 151 archivos**, con un worker y los plazos originales. Los dos resultados están separados en `.animation.local/voice-expansion-1724/full-unit-one-worker.*` y `full-unit-final.*`.

La matriz local conserva **FAILED**: 219 casos aprobados y Hindi M5 fallido al cerrar el contexto por un archivo de traza ausente en la salida compartida. Los 220 audios originales sí se generaron y sus WAV, hashes, muestras, duración y niveles coinciden con las mediciones; diez hashes distintos por idioma, un worker y ningún refetch de modelos ni solicitud externa después de la instalación. Esa revisión de audio no convierte el último caso ni la tanda en aprobados. Originales `.animation.local/voice-expansion-1724/real-220.*` y `audio/`; revisión `real-220-failure-review.json`, SHA-256 `6e40764e83826a591d3c4b289b41952f379a58e998fbb7523b8052dd42702bc0`. La comprobación aislada de Hindi, la batería CI de esta fuente y la publicación conservan sus resultados nuevos por separado.

El [ensayo Android 37143366912](https://github.com/miguelcoxcaballero/inhouse-read/actions/runs/37143366912), fuente `4a5fb86`, conserva **FAILED**: 368,370 segundos bloqueado, 114 starts/dones y capítulos 0–18, pero los últimos 54,949 segundos sin PCM nuevo. Los 228 callbacks y 38 snapshots POST llegaron completos. POST8/32 acredita `ttsDones:114`, `advanceStage:next-turn`, `followPending:0` y `pageTurnPending:1`: la continuación espera navegación EPUB; todavía no localiza su await interno. Pausa/Detener/PDF no se alcanzaron, no se publicó APK y despertar no cuenta como aprobado. Certificado `.release.local/android-1.1.4-build-37143366912/failure-review-native8.json`, SHA-256 `2d858a58939d046602cd3bd3486a3a13bb151d98859e4dd28a62d211d8060cb5`.

La prueba con una cuenta real de Google sigue sin acreditarse: el navegador con esa sesión perdió su conexión antes de verificar el login. Los casos de Drive con respuestas controladas conservan su alcance anterior; no sustituyen autenticación ni sincronización con una cuenta real.

## Cambios de 1.7.23

La tanda local posterior pasó **2.490/2.490 unitarias en 151 archivos**, con dos workers, los mismos plazos y sin build simultáneo. Conserva separado el primer intento con tres timeouts. Dos casos públicos propios de esta fuente pasaron sin reintentos y 58 recursos HTTP coincidieron con Pages; el caso EPUB usa modelo real y sink PCM controlado, no AudioTrack Android. Certificados `.animation.local/release-1723/local-unit-certification.json`, `.animation.local/release-1723/public-two/certification.json` y `.animation.local/final-live-evidence/artifact-1723-dcf4e91.json`.

La prueba de papel/cierre ahora espera que el parser real termine el recuento de la revisión importada, con el plazo de metadatos existente de 30 segundos. Antes cerraba mientras el libro todavía estaba en «Preparando…», donde la app deliberadamente no inventa geometría ni una animación 3D. Se conservan las fases, colores, comprobaciones de píxeles, cierre de 120 segundos y plazo global de 240 segundos. Pasaron los nueve casos sin reintentos sobre el build local 1.7.23. Sus originales permanecen en `.animation.local/close-metadata-1723/`; no sustituyen la batería CI.

El ensayo nativo `37141831816` sobre `dcf4e91` también falló: 114 fragmentos, 19 capítulos y 228 callbacks emparejados; los últimos 57,323 segundos quedaron sin PCM. La corrección del cooldown no basta. No se publica una APK fallida. El observador añade dos snapshots numéricos acotados después del microtask del mismo evento de reproducción, sin timers, polling, nuevas evaluaciones ni cambios de progreso; un nuevo ensayo debe localizar el punto pendiente.

El ensayo diagnóstico `37143201007` se canceló porque su filtro de logcat omitía el nuevo tag POST y no podía conservar la observación buscada. El build terminó y la captura figura cancelada tras un segundo, sin checkpoints ni artefactos de audio. Se añade el tag al filtro, con una regresión que exige conservar sus bytes en el log original. No se presenta ese ensayo cancelado como resultado de audio ni se relajan sus gates.

La batería CI original de `dcf4e91`, run `37141659571`, conserva su resultado **FAILED**: 2.490 unitarias aprobadas y las 355 identidades E2E presentes, con 352 resultados esperados, dos fallidos y uno flaky. Los once ZIP autenticados y doce logs originales se conservan en `.animation.local/release-1723/ci-failed-exact-37141659571/`; certificado SHA-256 `ea556d1518cfa8b0d4dcd7c225e3560d5779a134f94d4b14484679c4bad263d9`. No se presenta el total de casos como una aprobación completa.

El caso de planta junto a un libro fino también recargaba antes de completar el recuento real del PDF importado. Ahora espera la misma revisión completa antes de cerrar y recargar, conservando el plazo total de 90 segundos y sus comprobaciones de visibilidad y zonas táctiles de ocho segundos. El caso original pasó localmente sin reintentos en 31,7 segundos; sus resultados permanecen en `.animation.local/plant-metadata-1723/`. La nueva batería completa debe comprobar esta preparación junto con las demás pruebas.

El paso de capítulo EPUB no espera el retardo visual de 100 ms si la app está oculta, ni si se oculta mientras espera. Conserva carga, disposición de página y bloqueo hasta el mismo endpoint; los 100 ms visibles y su limpieza siguen comprobados. El paginador real extraído reproduce el bloqueo anterior con el timer suspendido. Diez focales pasan; el baseline anterior conserva cuatro fallos. Certificado: `.animation.local/release-1722/hidden-cooldown/certification.json`, SHA-256 `61e4dc70c63a92b8722cff31af683995c20ae47a8f88489b1aae54451b01206c`. Esto acredita esa dependencia, no identifica por sí solo la causa exacta de la pausa nativa.

El despliegue cambia `force_orphan` a `false` junto con `keep_files: true`: la implementación de Actions omitía la conservación al crear una rama huérfana. Se recuperaron ocho módulos inmutables de Pages `c0cc524` en `c01f1c21a54f18e301c98a390efa6ea97dd72907`; doce recursos HTTP coinciden con Git y los 91 archivos existentes de 1.7.22 permanecen idénticos. Los módulos PDF y EPUB que devolvían 404 vuelven a estar disponibles. Se conserva la prueba fallida anterior del contrato de despliegue y los dos focales corregidos. Esta versión necesita su propia batería completa y comprobación pública.

La primera tanda local de 1.7.23, ejecutada mientras se compilaba, conserva **2.487 aprobados y tres timeouts de 5.000 ms**, en dos archivos de modelos 3D: no se presenta como batería aprobada. Sus JSON y log originales permanecen en `.animation.local/pages-reader-retention-1722/full-unit-1723.*`. El build pasó; las pruebas nuevas del cooldown y del contrato de despliegue pasaron. La comprobación completa posterior debe conservar su propia fuente, perfil y resultados.

El [ensayo Android 37140077910](https://github.com/miguelcoxcaballero/inhouse-read/actions/runs/37140077910), fuente `ea76f782`, permanece **FAILED**: 108 fragmentos y 18 capítulos, con 216 de 216 callbacks recibidos; no hubo PCM nuevo en los últimos 30 segundos y la cola estuvo vacía 65,53 segundos. Despertar recuperó la lectura en unos 0,5 segundos, en una captura diagnóstica posterior al fallo. El snapshot precede el microtask de avance y no localiza el await exacto. No se publicó una APK ni se considera aprobada por esa recuperación. Revisión original `.release.local/android-1.1.4-build-37140077910/failure-review22.json`, SHA-256 `df9d753927c1a42fde5b4337f3aa806326cbf6d04be25aceccbf77cd4f6e45e9`.

La web real de 1.7.22 pasó dos casos propios sin reintentos: EPUB con motor/modelo reales y sink PCM controlado, y el gesto isométrico completo. Se autenticaron 54 cuerpos HTTP. Certificado `.animation.local/release-1722/public-ea76f78/certification.json`, SHA-256 `dc784283b4c7a6af3db33af828fbb86baf0f6a4059f953f3a308f3f172aeebbd`. Estos casos no certifican audio nativo bloqueado. Su batería completa sigue separada de 1.7.23 y del aprobado de 1.7.21.

## Cambios de 1.7.22

Se corrige el índice EPUB usando la forma real de `SectionProgress.section.current`, con compatibilidad para un índice explícito válido. Las diez regresiones fallan en cinco casos con el código anterior y pasan con la corrección. Junto con los diagnósticos numéricos de audio, pasan 498 pruebas focales distintas en 37 archivos; la batería completa y el despliegue de esta fuente se verifican por separado. El observador Android pasa 73 pruebas Python y ahora rechaza la cola vacía del último intervalo de 30 segundos del fixture Lessac. Estos resultados no acreditan que la pausa al bloquear Android esté resuelta.

Estado: 3 de octubre de 2026. La implementación web verificada corresponde a `b98265e409bd4b67533c9e44c9361245cf0687cc`. El cierre `a61703640c3a23a6708baf081099992758ef0a15` modifica sólo observadores, preparación de pruebas y harness de Android; conserva el producto web. Las correcciones posteriores de 1.7.22 no heredan este aprobado.

## Web 1.7.21 entregada

- **Vistas por gesto:** izquierda para isométrica y derecha para frente, sin selector separado. Se conservan scroll vertical, pinza, pulsación larga, arrastre y teclado; soltar el gesto no abre el libro tocado.
- **Relieve de varios colores:** hasta diez colores realmente encontrados en la portada, seleccionables simultáneamente, con intensidad independiente. Ajustar uno conserva los mapas y materiales de los otros, incluida su frontera; la tinta original no cambia. La elección persiste al reabrir y admite los perfiles antiguos de un solo color.
- **Grosor por palabras:** recuento completo del texto extraíble de las páginas PDF y secciones EPUB, con una equivalencia de 300 palabras por página impresa. Los bytes se guardan antes del análisis; una cola por revisiones descarta recuentos antiguos y mantiene el libro accesible durante la preparación. Los cómics reconocidos sin texto completan con cero palabras.
- **PDF adaptable:** avanzar y retroceder recorre el contenido de una página larga antes de cambiar de página PDF. El ancla visible se conserva al cambiar fuente, tamaño, orientación o reabrir; se corrige la carrera entre scroll y resize. El seguimiento de voz revela el texto correcto y el renderizado pendiente continúa al ocultar la pestaña, con cancelación y limpieza de sus observadores.

## Batería completa y publicación

[CI 37137687058](https://github.com/miguelcoxcaballero/inhouse-read/actions/runs/37137687058), fuente exacta `a61703640c3a23a6708baf081099992758ef0a15`: **2.465/2.465 unitarias en 148 archivos y 355/355 E2E**. Se contrastaron los doce jobs, once ZIP originales, sus digests y doce logs con el censo de esa fuente. Cada E2E tiene un único intento aprobado: cero omisiones, duplicados, skips, flaky, reintentos o errores.

| Suite E2E | Aprobados |
|---|---:|
| UI 1 / 2 / 3 / 4 / 5 / 6 | 44 / 38 / 37 / 41 / 36 / 30 |
| Voces: motor / lectura / idiomas | 9 / 14 / 40 |
| Supertonic | 66 |

Certificado: `.animation.local/release-1721/ci-next-37137687058/certification.json`, SHA-256 `eff84eda5b03fd4b62700665003bbc148106aa9526faabbed31676e2bc1d851c`. Revisión de todos los intentos: `suite-results-review.json`, SHA-256 `2eef222c3cbd24599320fe91fb4f45ba4c1f9a08b9270d79797cb7de1c13a786`.

Además pasaron **20 casos públicos distintos**, complementarios a CI: ocho PDF, dos de recuento, un smoke isométrico, uno de zoom, siete del editor y uno de retirada/reimportación desde Drive. Mantienen sus fuentes y fechas originales: `b98265e409bd4b67533c9e44c9361245cf0687cc`, Pages `e9425392607d2f3ea5fc1978c8c726b55236e30e`. Se autenticaron los cuerpos de los módulos recibidos sin reemplazar código de la app. El primer intento Drive con sellado de cuerpos incompleto se conserva y no se suma a esos veinte.

El despliegue de `a617036` ([37137687016](https://github.com/miguelcoxcaballero/inhouse-read/actions/runs/37137687016)) produjo Pages `c0cc5240c7584e615426ae8e3ec9971c0ba1b282`: **91 archivos idénticos** al Pages ejercitado, árbol `dae19b817c41fd997a73a393d00afec1bfbb8979`. Se contrastaron de nuevo 50 recursos HTTPS únicos. Entrada: `assets/main-jQpZcnwh.js`, 1.409.642 bytes, SHA-256 `af4fddc0736d38d29607c83e394a1cf001483f8a27020285085cf8d969b1f0bf`. Equivalencia: `.animation.local/release-1721-testclosure/public-equivalence-a617036.json`, SHA-256 `648e77efd8e7c0bbcba233f6867f77ad441dc7cbc80635ba94efaf5ce5372a57`. Esto acredita bytes iguales; no reetiqueta las pruebas públicas como ejecuciones sobre `a617036`.

El observador software de interrupción usa **2.200 ms en CI**; el límite local sigue en **900 ms**. Se conservan el fallo local de 904,2 ms y los originales de CI de 1.802,2/1.812,5 ms frente a 1.500 ms. La calibración conserva reloj, poses, resolución y calidad: no acredita una mejora del rendimiento ni un límite garantizado de fotogramas. El run rechazado `37134706176` y sus intentos originales permanecen separados.

## Pendientes y límites

- **Configuración gráfica forzada adicional:** el perfil original local y publicado pasa dentro de ocho segundos. El caso público con los tres flags ANGLE/SwiftShader conserva FAILED en 9.274,7 ms; los experimentos posteriores no se publican. Resolución, materiales y relojes originales permanecen. La causa específica de esa diferencia sigue sin acreditarse.
- **Cuenta Google real:** falta una sesión autenticada disponible para comprobar login y subida reales. Las pruebas de Drive con respuestas controladas y el preflight público no sustituyen esa comprobación.
- **Prueba en teléfono físico:** Android 1.1.4 sí pasa continuidad y controles en el emulador original. Sigue sin acreditarse su calidad acústica, FPS, temperatura, batería ni reproducción indefinida en un teléfono físico.
- No se añade OCR ni se garantiza el orden perfecto de cualquier PDF. La evidencia histórica mantiene sus propios resultados y alcance.

El [informe de 1.7.19](pdf-reading-continuity-1719.md) y los históricos siguientes conservan sus resultados; sus cifras no se suman a la batería actual.

## Histórico certificado — web 1.7.18 y APK 1.1.3

Estado: 3 de octubre de 2026. El relieve por colores está publicado desde `7be235b78ac769426b44c03abe65dbcf119ad6ca`. La verificación final usa `8936abedd970ac50b65925c2d51e699aabcb80a4`, que sólo corrige la espera de devolución antes de una importación en un test E2E. Pages actual: `d85b2321d18408dc887abdda08a6be8baf5e314f`; entrada `main-Bttpz-IX.js`.

**Batería completa aprobada:** 2.191 unitarias en 128 archivos y 335 E2E, 206 UI y 129 de motores reales. [Run 37118962162](https://github.com/miguelcoxcaballero/inhouse-read/actions/runs/37118962162): 12 jobs y 11 ZIP originales contrastados, 21 JSON y 89 PNG de interfaz, sin omisiones, reintentos, flaky ni errores. Certificado agregado SHA-256 `f58abd154ad0c094837d821b8bd6e137d998eba28d77b5750896828a47f4790a`.

El editor ofrece hasta tres zonas de colores reales distintos, con relieve y barniz localizados. Conserva el color elegido y la intensidad al reabrir. El análisis se prepara en tareas cancelables y reutiliza los mapas al cambiar la intensidad. Las portadas monocromas o bicolores ofrecen sólo sus opciones reales.

Pasaron **18 casos locales** de portada y **20 casos sobre la web publicada**. Se compararon por HTTP 20 módulos y estilos y 40 archivos del shell offline; la publicación posterior conserva sus 85 archivos de Pages idénticos. Las ejecuciones originales mantienen sus fuentes y fechas. La revisión de voces final verifica 106 WAV nuevos.

La APK pública 1.1.3, código 16, volvió a descargarse y mantiene su firma V2 y loader de 2.089 bytes, sin una copia empaquetada de la app. Las mejoras llegan mediante la web. [Implementación, certificados y alcance de 1.7.18](cover-color-relief-1718.md).

## Histórico certificado — web 1.7.17 y APK 1.1.3

El bloque siguiente conserva la fuente, fechas, censos y alcance originales de 1.7.17.

Estado: 3 de octubre de 2026. La optimización de rendimiento está publicada desde `64a91da1ff688d9bd0d3fe9d8e511fbf2d8548ca`, Pages `ae809d710a76a00eda4aa69a5f65276dd93e6915` y entrada `main-BL7jM-hN.js`.

**Batería completa aprobada:** 2.141 unitarias en 127 archivos y 331 E2E, sin omisiones, reintentos, flaky ni errores; [run 37113842421](https://github.com/miguelcoxcaballero/inhouse-read/actions/runs/37113842421), 12 jobs y 11 ZIP originales contrastados. Son 202 casos UI y 129 de motores de voz reales. También pasaron **20 casos sobre esta publicación**, con fuente y artefacto fijados.

Se comprobó por HTTP el contenido de 20 módulos/estilos y los 40 archivos del shell offline. La APK pública 1.1.3, código 16, volvió a descargarse: conserva un loader de 2.089 bytes sin una copia vieja de la app. Las mejoras de JavaScript llegan mediante la web; no se generó otra APK para esta entrega.

El PDF reutiliza las páginas válidas, la escena evita el trabajo oculto, las plantas conservan su geometría al ampliar y el marcapáginas reutiliza sus buffers. La comparación mantiene texturas, iluminación y sombras; la estantería estática y las vistas de inspección comparadas conservan los mismos píxeles. [Mediciones, fuentes, certificados y límites de 1.7.17](performance-1717.md).

## Histórico certificado — web 1.7.16 y APK 1.1.3

El bloque siguiente conserva la fuente, las fechas, los censos y el alcance originales de 1.7.16.


Estado: 3 de octubre de 2026. **Batería completa aprobada: 2.086 unitarias en 123 archivos y 330 E2E**, sin omisiones, saltos, reintentos, flaky ni errores. El [run 37110847248](https://github.com/miguelcoxcaballero/inhouse-read/actions/runs/37110847248) corresponde a `6822ae282c02573a98c88bd98087efdc855c8d69`; sus 12 jobs y 11 ZIP originales se contrastaron con el censo de esa fuente. Son 201 casos UI y 129 de voces reales: motor 9, lectura 14, Piper 40 y Supertonic 66.

El certificado `.animation.local/ci-37110847248/aggregate.json` tiene SHA-256 `363888d41846ad0d9336f41c91734da59994ec863c3720847de0a9b53db3b75e`. La revisión semántica de voz, incluidos 106 WAV, tiene SHA-256 `3930134329b1024ef223850c88471e5bf2c2c92005e01f8aea51c2097e279d1a`.

## Publicación y alcance de 1.7.16

- **38 casos públicos aprobados**: 36 de aplicación y dos de Supertonic, con la fuente original `c29ac806174859347a632cd22cc4d1f8818f1bc1`, Pages `a2c676cf628d2c3b48dba7c67248016bcfb9a854` y entrada `main-CpRyO9Jy.js`. Sus originales no se renombraron ni se repitieron para la publicación posterior.
- El commit 6822 sólo cambia cinco archivos de verificación. Pages actual `5fe4f3a16e62717297feb2ff593c60f9db71b89c` conserva **los 85 archivos idénticos**, árbol `ee2ab98c1bd58a78d37390358c8f508a10048166`; HTTP confirma entrada, 20 módulos y 40 recursos del shell. Certificado: `.animation.local/1716-contract2-public-equivalence.json`, SHA-256 `94e4d105dbf5e5ac5e3f2e07d1cb2e2bcd9a08c0f8291c0206700b578a628050`.
- Los tres focales de catálogo/importación y los dos de interceptación del worker pasaron por separado. Se conservan los certificados fallidos iniciales de los observadores y sus suplementos de sólo lectura, sin alterar resultados ni repetir pruebas.
- El APK público **1.1.3, código 16**, volvió a descargarse y conserva su loader de **2.089 bytes**, sin una copia completa antigua de la web. SHA-256 del APK: `67a52bdebff36c889c81061c488d002f4ac881404e9d1a5f6ad49e909ce267f7`. Su prueba nativa conserva la certificación independiente del histórico; esto no acredita un teléfono físico nuevo.

[Implementación, licencias y evidencia de 1.7.16](overnight-polish-1716.md). Se mantienen biblioteca local/offline, subida manual a Drive, libros y plantas proporcionados, páginas PDF sincronizadas con el inicio audible y conservación de imágenes. El catálogo suma **105 opciones de idioma y voz**, no 105 personas; Supertonic es una descarga manual compartida de unos **209 MB** y Piper sigue siendo predeterminado. Hebreo, serbio y chino tienen una voz cada uno. El PDF complejo conserva la página impresa original cuando no se pueden aislar sus imágenes.

Las medidas LIVE Supertonic (RTF 1,74–1,88 en los primeros fragmentos), las de CI y las del benchmark histórico se documentan por separado. No se promete lectura universal sin pausas ni se certifican RAM, batería o temperaturas de un teléfono físico.

## Histórico certificado — web 1.7.14 y APK 1.1.3

El texto siguiente conserva su fecha, fuente y alcance originales. No describe el catálogo actual de 1.7.16 ni se suma a los censos actuales. El [informe de 1.7.15](overnight-polish-1715.md) también se conserva como histórico.

Estado: 3 de octubre de 2026. Batería integrada y publicación confirmadas para el commit `506f7ef08c3e7dddaddc4e5ce6a63313756710e5`.

## Cambios entregados

- El lector ofrece sólo las 36 voces naturales del catálogo y sus 27 idiomas base. Las preferencias antiguas de voz del dispositivo se convierten en selección automática natural.
- Daniela (Argentina) conserva la lectura cuando sintetizar tarda más que reproducir: espera el fragmento completo en lugar de descartar la voz o recurrir al dispositivo. Pim (neerlandés) reutiliza el diccionario incluido en el paquete.
- PDF prepara una única página siguiente sin mostrarla durante la síntesis, y la activa con su resaltado cuando empieza su continuación audible. Pausa, navegación, cambios de vista y fuentes tardías descartan la preparación.
- EPUB divide las frases por los cortes reales de página y avanza al empezar a sonar la continuación. Conserva el texto y el resaltado; la preparación y los eventos de una lectura cancelada no giran la página.
- El lector mantiene la pantalla encendida. Android oculta la barra de estado completa, incluida hora e iconos. Al cerrar o pasar a segundo plano se liberan los recursos y se restaura la barra; al regresar se aplica de nuevo la política.
- El papel de los libros 3D es blanco; pasa al color del lector durante el acercamiento y vuelve al blanco al cerrar.
- Los toques de libros y luces se resuelven al soltar un contacto válido. Su click de compatibilidad se consume antes de que pueda activar la nueva portada o cerrarla mediante su fondo. Se conservan teclado, ratón, contactos nuevos, arrastre, cancelación y pinch.
- El audio ofrece los cinco pasos accesibles de velocidad: 0,75×, 1×, 1,25×, 1,5× y 2×, con teclado, foco, persistencia y disposición a 320 px.
- El catálogo incorpora portugués de Portugal, búlgaro, serbio, hindi y hebreo, con 33 modelos para 36 voces. Hebreo instala también Nakdimon. Pesos, configuración y diccionarios se conservan para sintetizar desde caché.

## Batería completa

[Production checks 37100354260](https://github.com/miguelcoxcaballero/inhouse-read/actions/runs/37100354260) terminó correctamente: **1873/1873 unitarias en 109/109 archivos y 246/246 E2E** (187 de interfaz y 59 con motores reales), sin omisiones, reintentos, resultados flaky ni errores globales. Los once jobs, incluido el resumen, terminaron con éxito. Los informes originales y el censo independiente pertenecen al mismo commit.

El censo de interfaz es 187 (41 + 32 + 33 + 27 + 26 + 28 en seis shards). Los motores reales suman 59 (9 engine, 13 reading y 37 languages). Cada job guarda su manifiesto `--list` y compara las identidades de proyecto, archivo y título con los resultados. El guard rechaza omisiones, duplicados, skips, flaky, retries y fotogramas no observados; el resumen exige el éxito de todos los jobs.

La tanda local 1.7.14 pasó 1873/1873 unitarias en 109/109 archivos. Los 47 focales PDF y los 88 de ReadingVoice/Controller también pasaron. El nuevo E2E de PCM real reproduce el fallo anterior: la página se adelantaba aproximadamente 1492 ms en 1.7.13; los originales se conservan en .animation.local/pdf-audible-page-1714/. Las ocho regresiones del scheduler y las once existentes de papelera de 1.7.13 pasaron 19/19. La prueba original de retirada pasó sin reintentos; el focal de caché 53/53 de 1.7.12 se conserva como histórico. Las comprobaciones locales de luces y gestos de 1.7.11 se conservan como histórico: Cuatro casos originales de luces y gestos pasaron 4/4 con manifiesto y shard 1/1. El caso original de acabados pasó 1/1 sin shard, con un censo independiente; este último resultado no se presenta como aprobación del guard que exige shard. Ninguno necesitó reintentos. Los cambios de voz comprueban la interrupción de PCM que aún está sonando y la cancelación durante síntesis sin nodos de audio activos.

El focal de acabados conserva su certificado en `.animation.local/lamp-diagnostic/final-finish-census.json` y sus mediciones en `final-finish-metrics.json`, junto con el manifiesto, el resultado original y la traza.

Evidencia final: `.animation.local/ci-37100354260/`, con manifiestos, JSON, trazas, capturas y logs. Las tandas históricas canceladas o fallidas se conservan separadas. El run 37083409316 confirmó 1793 unitarias, engine 9, languages 37 y los shards UI3/4/5 (86 casos), pero la prueba de inactividad esperaba Claude después de que la de cancelación dejara Davefx seleccionado. Sus dos intentos fallidos se conservaron y no acreditan una aprobación completa. Se añadió una selección explícita de Claude a la preparación de esa prueba; no modifica el runtime. Los shards restantes de ese run se cancelaron automáticamente al iniciar el nuevo workflow.

El run 37084412928 completó las 1793 unitarias y todas las identidades E2E, pero los dos casos de balanceo de portada fallaron en ambos intentos. Sus cuatro trazas muestran el movimiento real de ±8,48°; la espera por RPC no observó la condición transitoria y terminó con ángulo 0. La comprobación corregida observa las poses pintadas en el navegador, conserva amplitudes, persistencia y Sin relieve, y exige que un gesto confiable llegue con el libro inclinado y lo devuelva a cero dentro del plazo original. Los dos focales pasaron sin reintentos; el gesto llegó a 5,34° y el retorno tardó 314,1 ms. El commit a0304d2 cambió sólo esas dos observaciones de prueba; el runtime y la APK conservaron sus bytes. Los informes fallidos siguen en `.animation.local/ci-37084412928/`.

El run 37086267027 también completó las 245 identidades, pero se rechazó por un cierre Android intermitente y por el plazo de interrupción más estricto, ahora medido desde el evento real. En sus dos intentos, el gesto llegó durante el primer vaivén y el retorno tuvo cuatro poses monótonas; el renderizado por software tardó 1027,5 y 1042,6 ms. La animación conserva su reloj de 240 ms. CI usa el perfil explícito de 1500 ms, y la prueba exige primer ciclo, gesto confiable, inclinación, retorno monótono y reposo. El límite local sigue siendo 900 ms.

En el cierre frío de ese run, la traza muestra el vuelo todavía avanzando a los 30 s y el libro insertado visualmente a los 33,3 s, antes de cerrar el contexto. No se capturó el estado final del body de aquel intento; su reintento tampoco se usa como aprobación. Los casos de importación usan 60 s de observación y 120 s totales sólo en CI, manteniendo 30/60 s locales y las comprobaciones de bytes exactos, comienzo de cierre, estado final y libro visible. Los dos focales actualizados pasaron juntos sin reintentos con los límites locales: cierre en 15,424 s y gesto en el primer lóbulo con retorno de 468,5 ms. Las pruebas conservan el renderer y cada fotograma. Evidencia histórica y focal: `.animation.local/ci-37086267027/`.

El run 37088539879 completó todas las identidades: 1793 unitarias en 106 archivos y 245 E2E, de las que 244 pasaron sin reintentos. Se rechazó por un caso intermitente de la vista móvil walnut. La comprobación leyó el endpoint isométrico 12 ms después del toque, antes del siguiente render: el stage ya medía 626 px y el canvas conservaba los 783 px frontales. La traza muestra la vista isométrica completa y estable 374 ms después del toque. La prueba espera ahora el endpoint y la geometría final dentro de sus 8 s originales; conserva todas las exigencias de alineación de 1 px, ausencia de scroll y controles. Los dos casos móviles focales pasaron 2/2, en 32,576 s, sin reintentos y con guard normal. No cambia el runtime ni se usa el reintento del run anterior como aprobación. Evidencia: `.animation.local/ci-37088539879/`.

El run 37090203031 también completó las 245 identidades, pero la reutilización de la página falló en ambos intentos de la reapertura: 244 casos aprobados y uno fallido, con 1793 unitarias y 58 voces reales correctas. El probe natural reprodujo una clave preparada en top=48 y consumida en top=47, con tamaño, contenido, preferencias y generación idénticos, sin invalidación intermedia. Un experimento separado con el DOM y CSS reales identificó el control invisible después del shell: creaba un documento de 845 px para un viewport de 844 px. Desplazar el documento un píxel reprodujo exactamente top=47; anclar sólo ese control en top=0 devolvió scrollHeight=844 y top=48. Se conservan el fallo natural y el experimento causal por separado en `.animation.local/cache-reopen-diagnostic/`.

La corrección web 1.7.12 ancla los controles invisibles dentro de la app. Al consumir una página ya terminada, acepta una traslación rígida y rebasa sus coordenadas de destino conservando la identidad de snapshot, pixels y texturas. Mientras se prepara la página, la comparación sigue siendo estricta; tamaño, DPR, progreso, motor, preferencias, tema, filtro y generaciones se siguen comprobando. Las 25 regresiones unitarias nuevas comprueban ambas políticas, consumo único, ausencia de mutación tras un rechazo y coordenadas inválidas. El caso original de reapertura exige además scrollY=0 y ausencia de desbordamiento del documento.


El run 37092411622 completó 1818 unitarias en 106 archivos y las 245 identidades E2E, pero se rechazó por una retirada de libro intermitente: su primer intento actualizó el layout dos veces y su reintento pasó. La traza confirma que ambos layouts ocurrieron después de aterrizar, con el mismo canvas y dos libros; no había un cambio tardío antes del baseline. Un probe natural aparte pasó sin reproducir las colas, y se conserva como tal. Las regresiones deterministas reprodujeron cuatro fallos de solicitudes pendientes y registros en cola en la fuente anterior.

La corrección 1.7.13 aplica la lista más reciente antes del único layout de la retirada y consume las peticiones anteriores sólo cuando la estantería puede renderizar. Las ocho regresiones nuevas conservan ancho cero, cambios posteriores, apariencia terminada durante el vuelo y recuperación ante fallo de almacenamiento. Los 19 focales unitarios pasaron. El caso original de arrastre pasó sin reintentos, sin cambiar sus asserts del canvas, shaders, libros restantes ni número de actualizaciones. Evidencia anterior y nueva: .animation.local/ci-37092411622/, .animation.local/shelf-render-scheduling/ y .animation.local/trash-render-diagnostic/.


La batería 1.7.13 del commit e52101ab3a640dd18aa66c54bdf60027fcddb371 (run 37094685596) completó 1826 unitarias en 107 archivos y 245 E2E sin omisiones ni reintentos. Sus 23 casos publicados también pasaron. El caso de continuidad audible era EPUB; ese resultado no cubría el adelanto de página durante la síntesis PDF. La regresión nueva reproduce ese fallo en 1.7.13 y acredita la corrección específica de 1.7.14, por separado de aquella batería.

El run 37096358976 del producto b48a9928b9f2520e3ff3a3b299010b9bc7c0fd2f completó 1873 unitarias en 109 archivos y las 246 identidades E2E, pero se rechazó por dos casos de UI1 que fallaron también en sus reintentos. En selección sucesiva de libros, las dos trazas muestran el PDF y «Listo para leer» después de 9,28 y 9,16 segundos desde una espera de ocho segundos iniciada antes de revelar la portada. La portada se muestra al terminar su propia animación, independientemente del PDF; ahora se espera esa presentación con ocho segundos propios antes de los mismos ocho segundos de preparación. Se conservan el plazo global de 120 segundos, los documentos, las portadas y las aserciones originales.

En el otro caso, la prueba PDF trataba una solicitud pendiente de síntesis (atStart:null) como si ya hubiera empezado. El segundo intento comparaba la última solicitud con una reanudación después de que el fragmento anterior ya hubiera terminado y se hubiera preparado la página siguiente. La observación corregida registra request y start por separado, deja terminar automáticamente las cuatro frases de la primera página y sostiene el primer fragmento audible de la segunda para comprobar Pause/Resume. Conserva los textos completos, el orden, resaltados, ubicación visible, navegación manual y ausencia de cancelaciones durante el avance automático; añade la comprobación del resaltado anterior durante la preparación. Estas dos correcciones afectan sólo a tests, sin cambiar la app ni aceptar los reintentos como aprobación. Los nueve ZIP y dieciocho JSON originales del run fallido se conservan en .animation.local/ci-37096358976/.

El run 37098516046 del commit 063d8dcdf3226a6e9481d51b182a1e66a2ce6242 completó las 1873 unitarias y las 246 identidades E2E, pero se rechazó por una reapertura EPUB que falló en ambos intentos. Las dos observaciones reparadas del run anterior pasaron. El nuevo caso esperaba los controles durante toda la apertura con ocho segundos: sus últimos polls aún los observaban ocultos a 7,574 y 7,567 segundos, y los snapshots finales acreditaron la entrega correcta a 8,021 y 8,016 segundos, con flyout eliminado, body en lectura y capítulo Beyond the window. Los fotogramas muestran cubierta, apertura, marcapáginas y zoom continuos; el giro posterior todavía no se había ejecutado. Ahora esos dos caminos equivalentes de reapertura PDF y EPUB esperan primero el endpoint de la animación con los veinte segundos ya establecidos en assertOpening, y después mantienen la misma comprobación de controles de ocho segundos. El plazo global de noventa segundos, la página actual, la malla, la secuencia de cierre y la cancelación por giro se conservan. No cambia el runtime. El run rechazado, sus nueve ZIP y dieciocho JSON originales y la línea temporal siguen separados en .animation.local/ci-37098516046/.

El archivo original completo de apertura y cierre pasó 10/10 en 223,635 segundos, sin omisiones ni reintentos y con guard chromium, shard 1/1. Los bytes del test probado coinciden con el blob de 506f7ef08c3e7dddaddc4e5ce6a63313756710e5; la ejecución usa el mismo producto local 1.7.14. Se conservan páginas impresas, CFI, bisagra, marcapáginas, cancelaciones y giro. Evidencia: .animation.local/book-opening-handoff-1714/certificate.json y guard.json.

## Web publicada

La publicación 1.7.14 corresponde a `gh-pages` `ca6eaf0bdcb13974be5de9f97a4a95ef0c570971`, generada desde `506f7ef08c3e7dddaddc4e5ce6a63313756710e5`. La preparación diferida de PDF se entregó en `b48a9928b9f2520e3ff3a3b299010b9bc7c0fd2f`. El commit actual modifica únicamente las observaciones en tres archivos E2E; todos los demás archivos de Git, los veinte recursos JavaScript/CSS, las páginas HTML y el manifiesto Android son idénticos a la publicación ejercitada por los 24 casos reales siguientes. Su certificado mantiene la fuente, el despliegue y las fechas originales; no se presenta como una nueva ejecución sobre otro commit.

- Entrada real: `assets/main-CTOgfCNl.js`, 1.373.944 bytes, SHA-256 `d26c1a71687a4a42c0d1aba2738cef94f31a8194be3521bf451c099b2cf37d0f`.
- Los 20 recursos JavaScript/CSS publicados, 2.255.285 bytes, coinciden con `gh-pages`. También se comprobaron diccionarios búlgaro/hindi/serbio, avisos hebreos, fonemizador, módulo PDF compatible antiguo y manifiesto Android.
- Las **24 regresiones reales pasaron sin omisiones ni reintentos**: ocho de pantalla, continuidad audible, luces y gestos; dos de Argentina/neerlandés con pesos reales; dos de encuadre móvil; dos de preparación y reapertura; nueve de papel blanco y temas; una de retirada con layout único, shaders reutilizados y escena conservada. Cada grupo conserva manifiesto, resultados originales, traza, pin de la entrada y guard `chromium` / shard `1/1` válido.
- Argentina se comprobó a 1× y 1,25× con tres fragmentos por velocidad. Neerlandés se comprobó en selección automática y tras recargar con Hugging Face bloqueado. EPUB y PDF siguieron el inicio audible de la continuación, conservando la frase completa y sin voces del dispositivo. En PDF la huella del canvas muestreada a 32×48, sus dimensiones, el texto mapeado y el progreso de la página anterior permanecieron intactos durante la preparación y síntesis; el canvas y el resaltado siguientes aparecieron con el inicio real de Web Audio.
- PDF y EPUB conservaron la página guardada y la reutilización del snapshot. La reapertura exige scrollY=0 y ausencia de desbordamiento del documento.
- Los nueve casos de papel comprueban PDF/EPUB en papel, sepia, noche y AMOLED, más movimiento reducido: página blanca física, transición al tema al abrir y vuelta al blanco al cerrar.
- La página real de descarga mostró `android-v1.1.3` y el enlace exacto al APK; los cuatro recursos de esa página coincidieron con `gh-pages`.

Piper, pesos de Hugging Face, fonemizador, worker ONNX y Web Audio son reales. Wake Lock, el puente Android web y las API de voz del dispositivo se observan con dobles controlados. Los casos web no sustituyen la comprobación nativa del APK ni acreditan audio o rendimiento en un teléfono físico.

Evidencia: `.animation.local/final-live-evidence/artifact-1714-506f7ef-android113.json`, `chunks-1714.json`, `runtime-equivalence-1714-506f7ef.json`, `live1714/{critical,voices,mobile,prepared,white,trash}/`, `live1714/certification.json` y `download1714/`. Las tandas anteriores, incluidos fallos del entorno de prueba, permanecen separadas; no se usan sus reintentos como aprobación final.

## APK publicada

APK 1.1.3, versionCode 16, paquete `com.inhousesoftware.read`, 3.174.689 bytes y SHA-256 `67a52bdebff36c889c81061c488d002f4ac881404e9d1a5f6ad49e909ce267f7`. La firma V2 se verificó criptográficamente y conserva el certificado anterior. El loader real tiene 2.089 bytes, coincide con el repositorio y no contiene una copia empaquetada de la app ni pesos de voces. La descarga pública adicional comprobada tras publicar 1.7.14 conservó exactamente el mismo SHA, manifest, certificado y loader; el manifiesto de actualización en la web también coincidió.

El build 37080634822 pasó nueve estados nativos: estantería inicial, lector frío, segundo plano, regreso al mismo PDF, estantería, lector caliente, estantería, importación por Compartir y estantería final. En lectura, `KEEP_SCREEN_ON` está activo, `statusBars` solicitado oculto y el `InsetsSource` real invisible; el WebView empieza en y=0. En la estantería se libera el flag, vuelve la barra y el WebView empieza en y=66, valor medido en este emulador. En segundo plano se libera también el flag y vuelve la barra.

La comprobación independiente 37082246394 descargó la APK pública, confirmó su tamaño/SHA y pasó los cinco estados exigidos: estantería, lector, segundo plano, regreso al mismo PDF y estantería. Cada estado comprueba foco, flags, petición y visibilidad real de las barras; los estados en primer plano comprueban además la posición del WebView. La primera etapa abrió `accounts.google.com` con el formulario visible y sin errores de solicitud; no autentica una cuenta con credenciales. Las 42 unitarias del helper también pasaron.

La captura PNG del regreso al lector se tomó antes de estabilizarse y aún muestra la barra; se conserva como captura intermedia. Después de ella, el `InsetsSource` del volcado final acredita la barra oculta, el volcado de ventana acredita `KEEP_SCREEN_ON` y el XML acredita el mismo PDF y la posición y=0. El PNG conserva el estado intermedio previo a esas comprobaciones.

El verificador acreditó el primer regreso a la estantería a los 72,7 s en el emulador del build y a los 41,1 s en la comprobación independiente; los estados de estantería siguientes del build se acreditaron en unos 16 s. Estos tiempos incluyen espera y capturas, sin medir la duración exacta de la animación. Describen ese emulador de software, sin acreditar rendimiento ni audio en un teléfono físico. La política conserva los flags hasta terminar la devolución para evitar que el cambio de insets cancele la animación.

Evidencia: `.release.local/android-1.1.3-{apk-verification,apk-recheck-a89d,native-evidence,published-verification}.json`, `android-1.1.3-signature-verification.log`, `android-1.1.3-passing-emulator/`, `android-1.1.3-published-emulator-37082246394/` y `android-verifier-42-units.log`. El primer intento independiente 37081315869 conserva su informe fallido porque Chrome seguía pasando a primer plano; no se usa como aprobación.


La comprobación independiente adicional [37097625702](https://github.com/miguelcoxcaballero/inhouse-read/actions/runs/37097625702) instaló de nuevo el APK público después de publicar 1.7.14 y pasó los cinco estados nativos, con el mismo SHA, controles de foco, flags, `InsetsSource` y XML. El producto observado pertenece a `b48a9928b9f2520e3ff3a3b299010b9bc7c0fd2f`; el workflow y su helper diagnóstico pertenecen a `38f04260bb1c6a6d53035202e0cd01c5749b1bb6`. Git confirma que los únicos tres archivos distintos son el helper de verificación, sus tests y la activación de observadores en el workflow: no hay cambios en el runtime, el código Android ni el loader. Sus 48 unitarias incluyen las 42 anteriores y seis del observador.

El ensayo anterior [37096554823](https://github.com/miguelcoxcaballero/inhouse-read/actions/runs/37096554823) se detuvo al importar el PDF: sólo acreditó el estado inicial de la estantería, sin ejecutar los cuatro estados posteriores. Su captura final muestra la biblioteca vacía; no demuestra un fallo de la política de pantalla ni determina por sí sola la causa de la importación. Los originales se conservan separados. El diagnóstico mantiene las acciones, aserciones y 24 intentos, y añade capturas y consultas de sólo lectura antes de navegar. Estas observaciones añaden tiempo; un resultado posterior correcto no acredita que el fallo anterior fuera exclusivamente de entorno.

Evidencia: `.release.local/android-1.1.3-published-verification-1714.json`, `.release.local/android-1.1.3-apk-recheck-1714.json`, `.release.local/android-1.1.3-published-verification-37096554823.json` y `.release.local/native-import-diagnostic-38f0426-provenance.json`.

El observador añadió 1,143524 segundos: 0,343294 antes del intent y 0,800230 después de la primera captura. Esa primera captura ya mostró el PDF; Chrome pasó después a primer plano y se canceló con la recuperación que el helper ya tenía. El PNG de entrada muestra el lector sin hora ni iconos; el PNG de regreso conserva un encuadre transitorio. Los XML y volcados posteriores acreditan el estado final. La URL concreta del bundle no se observó dentro del emulador; la fuente y los bytes de la web se acreditan por la comprobación HTTP independiente.

La política nativa nueva requiere instalar [APK 1.1.3](https://miguelcoxcaballero.github.io/inhouse-read/download-android.html). La web y las voces se actualizan desde la publicación que carga el wrapper.

## Referencias

- [Arranque y buffer de voces naturales](natural-voice-startup-fix.md)
- [Pantalla durante la lectura](reading-display.md)
- [Frases entre páginas](speech-page-boundaries.md)
- [Verificación histórica de cambios de voz](voice-switch-verification.md)

CI15938201985254 conserva los dos fallos de cierre nativo deUI2 yel
reintento de la barra de estado deUI3. Originales en rust-motion/ci159-ui2
yci159-ui3. La captura deUI3 muestra un aviso real del updater; la causa
de su entrada en esa prueba se investiga sin modificar los plazos.
