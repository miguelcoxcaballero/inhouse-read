# Pulido de Inhouse Read 1.7.16

## Estado de este documento

**Verificación completa: 2.086 unitarias, 330 E2E y 38 comprobaciones públicas aprobadas.** La implementación de 1.7.16 se verificó en la fuente publicada `c29ac806174859347a632cd22cc4d1f8818f1bc1`. Sus 36 casos de aplicación y dos de Supertonic aprobaron con un solo intento por caso, sin saltos ni resultados inestables. Los certificados complementarios descritos al final corrigen errores de lectura de los auditores; conservan intactos los resultados y los certificados fallidos originales.

La fuente de verificación publicada es `6822ae282c02573a98c88bd98087efdc855c8d69`. Respecto a c29 sólo cambia cinco archivos de pruebas y workflow; no modifica el producto, sus modelos, el paquete de voces ni la versión web. La batería unitaria fresca y la unidad de CI pasaron **2.086/2.086 en 123 archivos**; los dos focales que interceptan el worker PDF pasaron **2/2**. El [CI completo 37110847248](https://github.com/miguelcoxcaballero/inhouse-read/actions/runs/37110847248) certifica **330/330 E2E**, incluidos **129/129 casos neurales**, al primer intento y sin omisiones, reintentos, flaky ni errores. Junto a las unitarias son **2.416 pruebas automatizadas**; los 38 casos públicos se acreditan aparte. Los 38 casos públicos mantienen su fuente c29 original, no se presentan como una nueva ejecución de 6822 ni se suman a ese censo.

El documento conserva las mediciones y los fallos anteriores con sus fuentes. No certifica consumo, temperatura, batería ni funcionamiento en un teléfono físico. La prueba nativa del APK mantiene su evidencia independiente.

## Biblioteca local, arranque offline y Google Drive

La importación guarda el archivo original y el progreso en IndexedDB antes de abrirlo. También se conserva la copia procedente de Android «Abrir con». Se puede importar y leer sin iniciar sesión en Google. La subida del archivo se inicia expresamente desde **Subir a Google Drive**; el estado cambia a **Guardado en Google Drive** cuando existe la copia remota.

Drive utiliza la carpeta `inhouse read`. Los libros vinculados sincronizan su progreso; los archivos encontrados en Drive se descargan en segundo plano para conservar una copia local. Si esa copia ya existe, abrir el libro no espera a una consulta remota. Un fallo de red no convierte una importación local completada en una importación fallida.

El nuevo service worker guarda la interfaz, los módulos del lector y los componentes locales del motor de voz. Instala cada versión comprobando tamaño y SHA-256 y la habilita sólo cuando está completa. Conserva la versión completa anterior para los módulos que todavía use un lector abierto. La actualización no recarga el documento en mitad de la lectura.

El arranque offline requiere haber completado una primera carga con conexión. Los bytes de los libros y las voces descargadas se almacenan aparte; la caché de la interfaz no descarga automáticamente libros de Drive ni paquetes de voces. Borrar los datos del sitio elimina sus copias locales. El registro del service worker se realiza en segundo plano y no retrasa la importación ni la apertura.

## Proporciones de libros, plantas y macetas

El grosor usa el número real de páginas cuando el formato lo proporciona. En libros de texto sin páginas fijas se calcula una estimación de páginas impresas a partir de las palabras, con una referencia de 300 palabras por página. La medición es cancelable, tiene límites de trabajo y guarda sus metadatos; no depende de la paginación variable de la pantalla ni del tamaño comprimido del archivo.

La representación aplica una convención física de 4 mm de encuadernación y 0,07 mm por página, limitada a 10–84 mm. Por ejemplo, 100, 300, 600 y 900 páginas producen 11, 25, 46 y 67 mm. Es una escala visual consistente, no una medición del ejemplar impreso. La proporción entre ancho y alto de la portada permanece intacta.

La opción **MUSKOT compacta** corresponde a un recipiente exterior de Ø12 × 11 cm para una maceta de cultivo de clase 9 cm. Es el nuevo tamaño inicial de las plantas compatibles; las selecciones guardadas mantienen su recipiente anterior. La clase de la maceta interior no se presenta como diámetro exterior. Las dimensiones se contrastaron con la [ficha de MUSKOT de IKEA](https://www.ikea.com.tr/en/product/muskot-white-9-cm-earthenware-plant-pot-30308201).

El follaje conserva la escala propia de cada especie al cambiar de recipiente. Se corrigieron las proporciones del helecho y la suculenta y el ajuste de tierra, borde y altura de los modelos. La maceta compacta reutiliza el perfil y el material cerámico de MUSKOT; no aplasta toda la planta para hacerla caber.

## Lector y recursos 3D

Los temas papel, sepia, noche, AMOLED y salvia modifican la superficie de lectura. En PDF se aplica el tema al papel y al texto, y se restauran los píxeles originales dentro de las zonas de imagen que PDF.js puede identificar. El lector reutiliza el renderizado y la capa de texto al cambiar de tema. Las comprobaciones históricas incluyen imágenes monocromas e ilustraciones vectoriales de EPUB.

**Límite conservador de PDF:** determinadas máscaras, repeticiones y composiciones no ofrecen una zona de imagen que pueda aislarse con seguridad. En esos casos se conserva **la página impresa completa en sus colores originales**; los controles y el fondo del lector sí adoptan el tema elegido. Esto puede dejar una página blanca dentro de un lector nocturno. Se evita así invertir, teñir o recortar una imagen usando límites supuestos. No se promete recolorear sólo el papel de cualquier PDF.

El catálogo crea sus vistas cuando se necesitan y conserva las de plantas, muebles e iluminación al cambiar de sección. Sólo dibuja la vista visible. El cierre del lector reutiliza el libro 3D utilizado en la apertura cuando siguen siendo compatibles sus dimensiones, portada y apariencia, y actualiza el marcapáginas. Se conservan la página real, las fases de cierre y la transición del papel al blanco.

La lectura en voz alta prepara la siguiente página del PDF y el comienzo de su audio durante la lectura actual. La página visible permanece en su sitio hasta que comienza la continuación audible; entonces se activa la nueva página con su texto y resaltado alineados.

### Corrección de la preparación PDF al cambiar los controles de audio

Al aparecer o cerrarse el mini reproductor cambia el alto disponible del lector. Una página preparada antes de ese cambio puede tener una geometría que ya no corresponde a la vista actual. Se detectó que ese plan obsoleto llegaba a la activación y detenía la lectura.

Ahora la preparación expone su validez y se comprueba antes de adoptar la siguiente página. Si cambió la geometría, se descartan sus elementos visuales y se prepara de nuevo para el espacio actual. Se conserva el audio sintetizado que sigue siendo válido para el mismo texto, voz y velocidad; no se vacía la caché de audio por un cambio de tamaño. Los intentos de preparación son limitados, para evitar un bucle mientras la vista siga cambiando.

Pausar, detener, navegar, cambiar de documento o sustituir una sesión conserva sus reglas de cancelación: un resultado tardío no puede girar la página de otra lectura. La activación continúa ligada al comienzo audible. Si una preparación deja de ser válida después de la última comprobación y no puede activarse, el lector pausa y ofrece reintentar; no muestra píxeles obsoletos ni presenta el fin del libro como resultado de una cancelación.

### Nivel de las voces noruegas NVCC

Los hablantes KON y MON del modelo `no_NO-nvcc-medium` producían una señal baja que seguía siendo demasiado tenue con el límite general de ganancia. La calibración permite hasta 12× únicamente para ese modelo y para una señal con pico y energía suficientes: pico ≥0,02 y RMS ≥0,002. El resto mantiene el límite general de 6×. El techo de pico sigue siendo 0,9 y un límite explícito del llamante tiene prioridad.

El ajuste no cambia el tono, el hablante ni la velocidad. El límite especial no se aplica a señales que no cumplen ambos umbrales de pico y RMS; esos umbrales no son un detector de habla ni un clasificador de respiraciones o ruido. Es una normalización del PCM; no equivale a certificar el volumen acústico de los altavoces de cada dispositivo.

## Catálogo de voces y límites

El inventario del código tiene **39 opciones Piper procedentes de 35 modelos**, más **tres perfiles Supertonic —F1, M1 y F2— disponibles en 22 idiomas**. Esto añade 66 combinaciones y da **105 opciones seleccionables de idioma y voz**. Los tres perfiles multilingües se reutilizan entre idiomas; el total no representa 105 personas distintas ni nuevos acentos regionales.

Piper sigue siendo la selección predeterminada. La instalación de una voz o paquete se solicita manualmente. La síntesis se ejecuta localmente después de descargar los recursos necesarios, sin un servicio de pago por lectura. Las licencias de los modelos siguen siendo aplicables; «gratuito» no significa dominio público.

Los 22 idiomas de Supertonic expuestos por esta app son árabe, búlgaro, checo, danés, alemán, griego, inglés, español, finés, francés, hindi, húngaro, italiano, neerlandés, polaco, portugués, rumano, ruso, sueco, turco, ucraniano y vietnamita. Sus etiquetas son genéricas: no se les atribuyen variantes argentinas, mexicanas, europeas u otros dialectos no acreditados. El [modelo oficial Supertonic 3](https://huggingface.co/Supertone/supertonic-3) declara su propia lista de idiomas y licencia.

| Idioma sin ampliación Supertonic | Opciones que conserva la app | Límite |
| --- | --- | --- |
| Catalán | Ona y Pau | Dos voces; no se anuncia una tercera. |
| Noruego bokmål | Talesyntese, NVCC KON y NVCC MON | KON y MON son los hablantes 3 y 6 de un modelo compartido. |
| Hebreo | Saspeech, con Nakdimon para la vocalización | Una voz; no se crean variantes cambiando el tono. |
| Serbio | Marko | Una voz. Los modelos etiquetados `serbski_institut` son sorabios y no se presentan como serbio. |
| Chino | Huayan | Una voz. No se añade un modelo con fonemización incompatible sólo para aumentar la cifra. |

Pau utiliza el corpus UPC FestCat con [CC BY-SA 3.0 ES, según su ficha Piper](https://huggingface.co/rhasspy/piper-voices/blob/main/ca/ca_ES/upc_pau/x_low/MODEL_CARD). NVCC declara [CC0 en su ficha Piper](https://huggingface.co/rhasspy/piper-voices/blob/main/no/no_NO/nvcc/medium/MODEL_CARD); los hablantes KON y MON se contrastaron con la tabla 2 de la [documentación de la Biblioteca Nacional de Noruega](https://www.nb.no/sbfil/nvcc/NVCC_about_the_corpus.pdf). Las atribuciones quedan en [piper-extra-voices.txt](../public/licenses/piper-extra-voices.txt).

## Paquete Supertonic elegido

Los 66 selectores comparten **208.164.809 bytes**, redondeados a unos **209 MB** en la interfaz. El paquete contiene cuatro grafos ONNX, configuración, índice de caracteres, tres perfiles y la licencia. Cada archivo tiene una URL fijada a una revisión, un tamaño y un SHA-256.

- Duración, codificador de texto y vocoder: originales FP32 de Supertone, revisión `3cadd1ee6394adea1bd021217a0e650ede09a323`.
- Estimador vectorial: cuantización dinámica QUInt8 de la [variante comunitaria de askurios8](https://huggingface.co/askurios8/supertonic-3-int8/blob/95618f5d61cef4923c3b802a332fd603723718f7/README.md), revisión `95618f5d61cef4923c3b802a332fd603723718f7`. No se cuantiza el vocoder.
- Síntesis: seis pasos de reducción de ruido. La cancelación se comprueba entre inferencias y libera los recursos del trabajo descartado.

El modelo conserva [OpenRAIL-M](../public/licenses/supertonic3-OpenRAIL-M.txt), incluida la variante cuantizada. La receta de inferencia adaptada del [SDK oficial de Supertone](https://github.com/supertone-oss-archive/supertonic/blob/main/web/helper.js) tiene una licencia [MIT separada](../public/licenses/supertonic-sdk-MIT.txt). El [aviso de modificaciones](../public/licenses/supertonic3-quantization-NOTICE.txt) identifica el único grafo sustituido y su procedencia comunitaria.

La descarga se guarda por archivos y comprueba su hash antes de marcarlos como reutilizables. Una interrupción durante la comprobación no puede dejar un archivo etiquetado como verificado. El marcador del paquete completo incluye ruta, URL, tamaño y hash; cambiar de revisión no reutiliza silenciosamente el paquete anterior. Eliminar el paquete compartido afecta a sus perfiles, no a las voces Piper descargadas.

## Evidencia local histórica que fundamenta estas decisiones

Las siguientes tandas pertenecen al desarrollo previo de 1.7.15. Se conservan como evidencia de escala, recursos, colores y elección del modelo; no se presentan como nuevas ejecuciones de la fuente 1.7.16. Son independientes, algunas se solapan y no constituyen por sí solas el resultado de una batería completa de CI.

| Área | Resultado local | Evidencia conservada |
| --- | --- | --- |
| Colores PDF y EPUB, cinco temas cada uno | 10/10, sin reintentos ni saltos; 43,10 s | `.animation.local/reader-image-colours-results.json` |
| Catálogo, reutilización del libro y transición del papel | 5/5, sin reintentos ni saltos; 97,35 s | `.animation.local/bookshelf-resource-reuse/final/results.json` |
| Proporciones y geometría | 120/120 unidades de la tanda focal | `.animation.local/physical-scale-overnight/compact-unit-results.json` |
| Motor y almacenamiento Supertonic | 18/18 unidades | `tests/unit/supertonic-runtime.test.js` y `supertonic-store.test.js` |
| Comparación de voz | 45 audios, cinco variantes × tres idiomas × tres perfiles | `.animation.local/supertonic3-ab/summary.json`, WAV y transcripciones |
| Chromium, paquete final único y seis pasos | 3/3 perfiles con síntesis y reproducción real | `.animation.local/supertonic-browser-production-q8/results.json` |

La captura de escala en `.animation.local/physical-scale-overnight/scene.png` muestra libros de 100/300/600/900 páginas y macetas compactas junto a una maceta anterior, sobre una balda de 600 mm.

### Velocidad, reconocimiento y memoria

Las comparaciones utilizaron WASM de un hilo, las mismas frases y la misma semilla de ruido. El audio recibió el mismo ajuste de nivel, recorte de silencio y fundido que usa el motor. El reconocimiento empleó Whisper base multilingüe int8 mediante faster-whisper, con idioma explícito. Es un indicador limitado de inteligibilidad: incluye errores propios del reconocedor, como separar compuestos neerlandeses o confundir palabras homófonas.

| Variante | RTF medio en Node | Distancia de palabras del ASR, sobre 174 |
| --- | ---: | ---: |
| FP32, 4 pasos | 0,788 | 16 |
| Vector q8, 4 pasos | 0,541 | 18 |
| **Vector q8, 6 pasos** | **0,724** | **8** |
| FP32, 8 pasos | 1,378 | 11 |
| Vector q8, 8 pasos | 0,913 | 11 |

RTF es tiempo de síntesis dividido entre duración del audio. Se eligieron seis pasos porque cuatro empeoraban especialmente el perfil F2 en la muestra neerlandesa. Esta muestra pequeña no demuestra una superioridad general de calidad sobre ocho pasos.

En el benchmark histórico aislado de Chromium, con sólo el paquete final de 208 MB, los tres perfiles dieron RTF **0,773–0,803**. No es la medición de la aplicación publicada actual. El muestreo externo observó un máximo de **1.218.117.632 bytes de RSS sumado** de los procesos de esa instancia de Chromium y **1.039.261.696 bytes de memoria privada comprometida**. La suma de RSS puede contar páginas compartidas varias veces; incluye navegador, renderer y worker, y no representa exclusivamente el modelo.

El proceso Node registró 711.667.712 bytes tras cargar el paquete y alrededor de 501 MB durante la síntesis. Su intervalo interno no capturaba toda la carga síncrona; el resumen usa también los snapshots explícitos. Estas cifras no son intercambiables con las de Chromium.

No se ha certificado aquí el consumo de batería, la temperatura, la RAM disponible o la velocidad en un teléfono físico. Piper sigue siendo la opción predeterminada; la disponibilidad del paquete Supertonic no implica que su coste de memoria sea adecuado para todos los móviles.

## Verificación pública y batería completa de 1.7.16

### Artefacto realmente servido

Las tandas públicas usaron GitHub Pages y sus descargas reales. Se cotejaron con el Git de Pages los tamaños y SHA-256 de los **20 módulos —2.288.307 bytes— y 40 recursos del shell —21.440.374 bytes—**.

| Referencia | Valor verificado |
| --- | --- |
| Fuente del producto | `c29ac806174859347a632cd22cc4d1f8818f1bc1` |
| Commit de Pages | `a2c676cf628d2c3b48dba7c67248016bcfb9a854` |
| Entrada pública | `/inhouse-read/assets/main-CpRyO9Jy.js` |
| Entrada: tamaño / SHA-256 | 1.387.982 bytes / `41f8bc11fe186b7bdcbcb8a7a370c8130f9dbe25f975016f224c0318d4ed461e` |
| Versión del shell | `24e33e70de1de8e7d0ed0bff51000c787a8bd0cd90a60d9b9a1cb4ab503cded8` |

El archivo que recoge el cotejo es `.animation.local/final-live-evidence/artifact-1716-c29ac80-android113.json`. El primer sondeo HTTP, que aún devolvía la entrada anterior durante la propagación de Pages, se conserva separado. Sólo el segundo cotejo completo corresponde a los pines de esta tabla.

Después se publicó la corrección de pruebas 6822 mediante Deploy `37110847222` y Pages `37110874408`, ambos completados correctamente. El nuevo commit de Pages es `5fe4f3a16e62717297feb2ff593c60f9db71b89c`. El cotejo HTTP del 3 de octubre a las 08:48 UTC conserva **la misma entrada, SHA-256, 20 módulos y 40 recursos del shell byte por byte**; queda en `.animation.local/final-live-evidence/artifact-1716-6822ae2-android113.json`. Esta comprobación de publicación posterior se distingue de las 38 ejecuciones anteriores: no cambia los pines inscritos en sus manifiestos o trazas.

El certificado independiente `.animation.local/1716-contract2-public-equivalence.json`, SHA-256 `94e4d105dbf5e5ac5e3f2e07d1cb2e2bcd9a08c0f8291c0206700b578a628050`, acredita **los 85 archivos de Pages idénticos**, con las mismas rutas, modos, objetos y bytes. Ambos commits tienen el árbol Git `ee2ab98c1bd58a78d37390358c8f508a10048166`. Contrasta también con Git las tablas HTTP de 13 recursos seleccionados, 20 módulos, 40 recursos del shell y dos metadatos. Esas tablas se solapan y no se suman como archivos distintos.

El diff de fuente acredita 422 archivos tracked idénticos y sólo cinco de verificación modificados. Así, los 38 originales c29 siguen describiendo los mismos bytes públicos tras 6822; se conserva su pin de ejecución. La equivalencia no es una repetición de los tests ni sustituye el resultado del nuevo CI.


### Los 38 casos públicos

| Grupo | Casos aprobados | Alcance |
| --- | ---: | --- |
| Apertura, interacción y pantalla del lector | 8 | Gestos de lámparas/libros, zoom, política de pantalla y seguimiento audible de página. La observación de puente Android no sustituye la prueba nativa del APK. |
| Voces Piper publicadas | 2 | Lectura natural real y reapertura con el modelo instalado. |
| Estantería móvil | 2 | Vista y ajuste del mueble al viewport. |
| Página preparada | 2 | Reapertura PDF/EPUB con página y textura correctas. |
| Papel del libro 3D | 9 | Blanco → tema del lector → blanco, incluidas apertura y devolución. |
| Retirada de un libro | 1 | Identidad de escena/canvas y un único ajuste del layout, conservando el contrato estricto. |
| Imágenes y temas | 10 | PDF/EPUB en cinco temas, colores del contenido conservados. |
| Arranque offline PDF/EPUB | 2 | Documento nuevo sin red y caché HTTP vacía; mismo archivo local, contenido y shell. |
| Supertonic publicado | 2 | Descarga manual HTTPS, 66 opciones instaladas, F1/M1/F2 españoles y M1 en documento/worker fríos sin red. |
| **Total público** | **38** | Todos al primer intento, sin omisiones, reintentos, flaky ni errores de ejecución. |

Los 36 originales de aplicación conservan sus manifiestos, resultados, guards `1/1`, adjuntos y ZIP en `.animation.local/final-live-evidence/live1716/`. El certificado complementario es `.animation.local/final-live-evidence/live1716-observer-correction/certification-36-corrected.json` (SHA-256 `6f2973016a518e1b250e62dccdf2e03b6901f942b652a4cd4e79295a6e484581`). La revisión no ejecutó de nuevo los casos.

Los dos originales Supertonic están en `.animation.local/live1716-supertonic/`. Su guard normal confirma 2/2 en **75,211 s**. `evidence-summary.json` tiene SHA-256 `34cd0cfd96d817756f82c9ee3c1f4d6a88e495b3d89b5303e14f08cf13f8b113`. El click real descargó diez recursos fijados por HTTPS desde Hugging Face; sus cuerpos en caché coinciden en tamaño y hash con los **208.164.809 bytes** previstos. Las 66 filas aparecen instaladas. Los tres perfiles producen PCM distinto de 44.100 Hz y el inicio audible coincide con el resaltado; no se invocan voces del dispositivo.

El segundo caso cierra el documento y sus workers, vacía la caché HTTP y desconecta toda la red. Un documento y un worker nuevos reabren el PDF local y leen con M1 usando los recursos guardados. No se usan espejos, motores simulados ni configuración alternativa. Su alcance audible es **tres perfiles en español y una lectura M1 fría**, no una evaluación de calidad de las 66 combinaciones. La matriz de idiomas del CI es evidencia distinta.

Una revisión independiente volvió a calcular 115 referencias de evidencia y los cuerpos retenidos de la entrada: **38 ZIP públicos y 45 cuerpos públicos coincidentes**, además de los tres ZIP/cuerpos del focal local. El informe `.animation.local/independent-review1716-complements.json` tiene SHA-256 `6eceba1469c6ff4b1202fd750459406590b1a7ec3c9d7422276c150411625ba2`. Conserva expresamente el certificado inicial fallido y el log del extractor auxiliar fallido; no convierte aquellos auditores en ejecuciones correctas retrospectivamente.

### Rendimiento observado en esta publicación

| Lectura real en la web publicada | RTF informado | Primer audio informado |
| --- | ---: | ---: |
| Supertonic F1, español | 1,880 | 1.787,5 ms |
| Supertonic M1, español | 1,794 | 1.603,2 ms |
| Supertonic F2, español | 1,768 | 1.595,0 ms |
| Supertonic M1, documento/worker fríos y sin red | 1,737 | 2.044,1 ms |

Son medidas reales del fragmento inicial «La llegada.», no una media de lectura prolongada. En esta observación la síntesis tarda más que la duración de ese audio. Los valores **no sostienen una promesa de lectura continua sin esperas**, ni sustituyen el benchmark histórico con frases distintas. Piper sigue siendo predeterminado. Los contadores de underrun en cero de estos primeros fragmentos tampoco certifican una sesión larga sin huecos.

Este LIVE no midió RSS. La memoria de 1.218 MB de RSS sumado y 1.039 MB de memoria privada corresponde únicamente al benchmark de escritorio histórico descrito arriba; no se atribuye a estas 38 pruebas, al modelo aislado ni a un móvil físico.

### Correcciones de los observadores, conservando los fallos

El auditor inicial de los 36 casos declaró 34 válidos y rechazó dos comprobaciones offline al comparar el PDF importado por Windows con el blob Git. Los propios casos originales ya habían aprobado bytes, hash y conservación antes/después. El archivo usado realmente tenía **1.863 bytes**, SHA-256 `67a022285e7b9ceb61be5c87f148cf6985bfc5d01052b6a75fc655be30fdc4b1`; el blob Git tiene **1.798 bytes**, SHA-256 `32ee679efc7d1cf8688d150ce71e9995be11de60e3e58178ec800d3cd4f6747b`. Se demostró una relación exacta de **65 expansiones LF → CRLF, sin otro cambio de byte**. El EPUB de 2.126 bytes es idéntico entre checkout y Git.

El suplemento valida los dos originales con su entrada Windows real; no etiqueta sus 1.863 bytes como blob Git. El LIVE Supertonic, por separado, usa el blob PDF de 1.798 bytes. También se revisaron las respuestas de la entrada en cada ZIP, incluida la referencia `_file` usada por Playwright: todo cuerpo retenido coincide en tamaño/hash; las observaciones de SW sin cuerpo conservan sólo URL/estado. Hay un cuerpo real verificable de la entrada por cada traza. No se inventa un hash de cuerpo para una respuesta cuyo cuerpo no está almacenado.

El auditor inicial, su sello y el certificado fallido de 34 quedan intactos. El nuevo archivo `offline-correction.json` (SHA-256 `184e1bd0d320b1e23ce9ac3757f449b27e0f5d61b349c39c2eb627b661a417c5`) y el certificado 36 separado corrigen la interpretación de la evidencia. No se modificó el fixture, la aplicación, una aserción ni un resultado, y no hubo repetición del navegador.

### Focal local de tres regresiones de prueba

La fuente de pruebas `4f642a336c508dd5af2e03abde275d28fb7cc42f`, con el producto c29 intacto, pasó **3/3** originales: importación Android con OAuth explícitamente pendiente, previews de catálogo retenidos/suspendidos y mueble ancho tras seis cambios de vista. Se utilizó SwiftShader, un worker, cero retries, shard `1/1` y el guard normal. El reporte dura **98,069 s**; la ejecución completa del runner, **98,634 s**.

El perfil explícito de CI permite 60 s para la devolución Android y 180 s para el escenario completo del mueble; conserva los límites locales y las aserciones de geometría, progreso, identidad y estado. Los presets locales generales no se amplían. La entrada local de Windows fue `main-DTq5bnZ7.js`, 1.387.984 bytes, SHA-256 `a18757b87b6c3fa30243b9a4efa57cdb67bd85260e854f4ec72844b65d88938c`, comprobada por HTTP y en las tres trazas. No se presenta como el artefacto público de Linux.

El runner original terminó sus tres tests y el guard correctamente; su extractor auxiliar falló al admitir sólo `_sha1` e ignorar `_file`. El fallo y sus archivos sellados se conservan. Un auditor complementario de sólo lectura comprobó ambos formatos, las identidades, todos los cuerpos retenidos, los hashes y el perfil, sin repetir los tests. Certificado: `.animation.local/three-regressions-1716-observer-correction/certification.json`, SHA-256 `3b2f5c474dbe0b212e94853d8bf540869d4ba826f5e57c2c57b1e8bce8fffd50`.

### Historial de correcciones de las pruebas

El CI `37108607837` de c29 se conserva **fallido** y no se reemplaza por los resultados públicos. Su censo original completo tiene **330 E2E**. Los cuatro grupos neurales pasaron 129/129 al primer intento —motor 9, lectura 14, Piper 40 y Supertonic 66—, pero eso no convierte el conjunto UI en aprobado. Sus medidas y 106 WAV revisados están en `.animation.local/ci-37108607837/neural-measurements-for-report.md` y su certificado semántico.

La fuente de pruebas nueva `6822ae282c02573a98c88bd98087efdc855c8d69` cambia únicamente Android import, book-opening, shelf-placement, shelf-types y el workflow. Además de las correcciones locales anteriores, aísla con `serviceWorkers:'block'` **sólo los dos casos que deben interceptar el worker PDF**. En la simulación de APIs antiguas exige una marca del prefijo observada en el worker real, para impedir un aprobado sin haber eliminado esas APIs. Las pruebas offline reales conservan su service worker; no se desactiva globalmente.

### Nuevas verificaciones de 6822

| Comprobación independiente | Resultado | Evidencia |
| --- | --- | --- |
| Unitarias frescas | **2.086/2.086, 123 archivos, 40,19 s** | `.animation.local/overnight-unit-1716-contract2.json`, SHA-256 `10ec405668433937daad9bd6d8c2f3eca6dddb7b16a6d0e0576803c14fa46fa6`; asociación a HEAD en `overnight-unit-1716-contract2-source.json`. |
| Worker PDF: cancelación y APIs antiguas | **2/2, 29,183 s**, un intento, guard normal `1/1` | `.animation.local/shell-route-scoped/certificate.json`, SHA-256 `145bf68322672521dcb41a694498306457c233ad81376b8197cb7b5f4566a288`. |
| Publicación posterior | **HTTP/Git de los recursos servidos coincidentes**, entrada y shell sin cambio | `artifact-1716-6822ae2-android113.json`; Pages `5fe4f3…`. |
| Descarga real del APK público | **Mismo APK 1.1.3, código 16, loader de 2.089 bytes** | `.release.local/apk-loader-verification-1716-6822ae2.json`, descargado a las 08:47:50 UTC. |
| CI completo | **2.086 unitarias / 123 archivos y 330/330 E2E**, al primer intento | [Run 37110847248](https://github.com/miguelcoxcaballero/inhouse-read/actions/runs/37110847248), fuente 6822; 12 jobs y 11 ZIP autenticados. |

El primer focal comprueba que la interceptación se ejecutó exactamente una vez y que, en el worker real cargado, la marca previa al código/polyfills registró `Promise.try` y `Math.sumPrecise` como `undefined`. Después conserva PDF, título, canvas visible y un único acuse de importación. No exige que las APIs sigan ausentes si PDF.js las repone correctamente.

El segundo focal retiene la petición real del worker, cancela la apertura mientras sigue en preparación, reabre el mismo libro y libera la petición original. Conserva la página 3, su texto/píxeles, las fases de la animación y el estado final del lector nuevo. Los demás tests, incluidos los offline, siguen usando el service worker real.

**Alcance de la entrada local en estos dos focales:** el build `main-DTq5bnZ7.js` se selló antes y después de la ejecución con SHA-256 `a18757b87b6c3fa30243b9a4efa57cdb67bd85260e854f4ec72844b65d88938c`. Las trazas conservan la URL solicitada, HTTP 200 y ETag; **no conservaron el cuerpo JavaScript**. Se acredita el build local congelado y esa asociación de red, no un hash recalculado de un cuerpo ausente en las trazas. No hubo reejecuciones para conseguir el resultado.

El APK descargado tiene 3.174.689 bytes y SHA-256 `67a52bdebff36c889c81061c488d002f4ac881404e9d1a5f6ad49e909ce267f7`. Dentro, `assets/public/index.html` es únicamente el loader de 2.089 bytes hacia producción, SHA-256 `8e03c3a6c8f840d9e9cf66637babe2d63742d2948d852534b865db0086aa9f34`, sin assets de una copia antigua completa. Esta descarga y extracción acreditan el paquete; no son una nueva prueba de pantalla/puentes en un teléfono físico. La evidencia nativa previa conserva su certificación independiente.

### Voces del CI actual: 129 originales aprobados

La fuente **6822**, run **37110847248**, tiene certificados **motor 9, lectura 14, Piper 40 y Supertonic 66: 129/129 al primer intento**, sin omisiones, saltos, reintentos, flaky ni errores globales. Se autentican cuatro ZIP y sus 193 miembros, y se decodifican **106 WAV** comparando sus muestras y métricas con los JSON originales. Certificado: `.animation.local/ci-37110847248/neural-semantic-review.json`, SHA-256 `3930134329b1024ef223850c88471e5bf2c2c92005e01f8aea51c2097e279d1a`. Son ejecuciones nuevas; no se trasladan cifras del CI c29 anterior.

| Observación del CI 6822 | Resultado y alcance |
| --- | --- |
| Continuación PDF independiente | Siguiente PCM terminado **919,8 ms antes** del done anterior; **143 muestras** conservan la página actual hasta el inicio audible. Activación a **+2,3 ms** y primer RAF a **+16,4 ms**, texto íntegro y cero voces del dispositivo. |
| Lectura serial EPUB → PDF 1,25× | PDF: cero underruns, un acierto de prefetch y hueco de audio de **108 ms**. EPUB: un underrun y huecos de **567/439 ms**. No se promete ausencia universal de pausas. |
| Piper | **39 IDs de hablante / 35 modelos**, más un caso de diccionario. Primer audio **2.994–12.205 ms**, RTF **0,22–2,71**. No todas las voces sintetizan más rápido que su audio. |
| NVCC | KON: pico/RMS **0,616/0,101**, primer audio 3.214 ms; MON: **0,409/0,051**, 3.400 ms. Conservan los umbrales originales pico >0,3 y RMS >0,01. |
| Supertonic | **66 combinaciones**, paquete compartido **208.164.809 bytes**, q8-VE y seis pasos; RTF **0,9235–1,2021**. Diez solicitudes de instalación, cero refetch posteriores o solicitudes externas; tres hashes de audio distintos por idioma. |

Los **9.216 ms** de instalación Supertonic en CI incluyen espejo local, recarga y calentamiento; no son el tiempo de la descarga HTTPS pública. La matriz usa un worker calentado, mientras el LIVE acredita por separado el documento/worker frío y sus RTF **1,74–1,88**. Ambas evidencias comprueban PCM real, pero no son una evaluación universal de pronunciación ni de calidad lingüística.

El arranque Piper frío de este CI conserva el PDF local, vacía la caché HTTP, crea documento/workers nuevos sin red y sirve nueve recursos del motor mediante SW. La prueba de inactividad destruye el worker y después lo recrea desde caché. El RSS agregado de Chromium baja de **1.501 a 1.153 MB**, con 348,01 MB liberados. La ventana base de estantería registra dos longtasks, una de **1.817 ms**, frente a cero entradas entregadas durante la ventana de síntesis. Al ser observación buffered, no atribuye por sí sola cada tarea al render o a la voz. No son medidas de un teléfono ni del heap aislado del modelo.

Las unidades de CI pasan **2.086/2.086 en 123 archivos** en el artefacto autenticado `11268993718`. Los seis grupos UI pasan **201/201** y los cuatro grupos neurales **129/129**, completando las **330 identidades E2E**. El informe de medidas de voz es `neural-measurements-for-report.md`, SHA-256 `5c80bdcd6521d975df4df91afc7cadf4ec5b0254c583a20fb00ca13f275c460a`.

### Cierre certificado

El [run 37110847248](https://github.com/miguelcoxcaballero/inhouse-read/actions/runs/37110847248) completó sus **12 jobs**. La auditoría cotejó los **11 ZIP originales** autenticados, los manifiestos y resultados con el censo exacto de la fuente 6822: **330 observados y 330 únicos**, sin faltantes, extras, duplicados, saltos, reintentos, flaky, intentos fallidos ni errores globales.

| Grupo E2E | Casos aprobados |
| --- | ---: |
| UI 1 / 2 / 3 / 4 / 5 / 6 | 41 / 34 / 33 / 29 / 36 / 28 |
| Motor / lectura / Piper / Supertonic | 9 / 14 / 40 / 66 |
| **Total E2E** | **330** |
| Unitarias, 123 archivos | **2.086** |
| **Total automatizado del CI** | **2.416** |

Certificado agregado: `.animation.local/ci-37110847248/aggregate.json`, SHA-256 **`363888d41846ad0d9336f41c91734da59994ec863c3720847de0a9b53db3b75e`**. Los 38 casos públicos, los focales locales y la verificación estática/nativa del APK conservan sus certificados separados; no se suman para inflar el censo del CI.

El CI c29 fallido conserva su identidad y no se presenta como corregido retrospectivamente. Los censos históricos, incluidos 1.7.14 y 1.7.15, mantienen sus fechas y resultados y no se suman a 330 ni a 38.

