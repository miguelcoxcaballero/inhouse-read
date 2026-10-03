# Verificación del WIP — web 1.7.24 en preparación; Android 1.1.4 pendiente

## Cambios de 1.7.24

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

- **Android 1.1.4 sigue PENDIENTE.** El [run 37137718223](https://github.com/miguelcoxcaballero/inhouse-read/actions/runs/37137718223), fuente `a617036`, falló con la pantalla bloqueada: las marcas de capítulo quedaron vacías; el PCM avanzó durante aproximadamente 305 segundos y la cola quedó vacía durante los 63 segundos finales. El defecto del índice de sección explica las marcas ausentes; la causa de la interrupción posterior sigue sin confirmar. Los artefactos fallidos se conservan y no certifican continuidad ni una APK terminada.
- **1.7.22 en verificación:** las correcciones del índice de sección y getters numéricos necesitan su batería completa y comprobación pública propias. No están cubiertas por el aprobado completo de `a617036`.
- No se añade OCR ni se garantiza el orden perfecto de cualquier PDF. Los ocho casos públicos PDF usan texto y audio controlados para verificar navegación, visibilidad y cancelación; no sustituyen una comprobación de audio natural en un teléfono bloqueado. Drive usa respuestas de prueba y no autentica una cuenta real.
- La batería web no certifica una APK nueva, audio en un teléfono físico, FPS, temperatura o batería. La evidencia histórica de Android 1.1.3 y la sesión de voz anterior mantienen su alcance original.

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
