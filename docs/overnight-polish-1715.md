# Pulido de Inhouse Read 1.7.15

## Estado de este documento

Describe los cambios implementados y las comprobaciones locales disponibles el 3 de octubre de 2026. No certifica todavía el CI completo de esta versión, su publicación ni el comportamiento en un teléfono físico. Los informes de versiones anteriores conservan sus propios resultados y no se trasladan a esta versión.

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

Los temas papel, sepia, noche, AMOLED y salvia modifican la superficie de lectura manteniendo los colores de fotos e ilustraciones. El PDF reutiliza su renderizado y su capa de texto al cambiar de tema. Las pruebas comprueban también imágenes monocromas e ilustraciones vectoriales de EPUB.

El catálogo crea sus vistas cuando se necesitan y conserva las de plantas, muebles e iluminación al cambiar de sección. Sólo dibuja la vista visible. El cierre del lector reutiliza el libro 3D utilizado en la apertura cuando siguen siendo compatibles sus dimensiones, portada y apariencia, y actualiza el marcapáginas. Se conservan la página real, las fases de cierre y la transición del papel al blanco.

La lectura en voz alta prepara la siguiente página del PDF y el comienzo de su audio durante la lectura actual. La página preparada se activa al empezar su audio. Cambiar de documento, navegar o detener la voz invalida el trabajo pendiente.

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

## Comprobaciones locales disponibles

Estas tandas son independientes y algunas se solapan. No constituyen por sí solas el resultado de una ejecución completa de CI.

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

En Chromium, con sólo el paquete final de 208 MB, los tres perfiles dieron RTF **0,773–0,803**. El muestreo externo observó un máximo de **1.218.117.632 bytes de RSS sumado** de los procesos de esa instancia de Chromium y **1.039.261.696 bytes de memoria privada comprometida**. La suma de RSS puede contar páginas compartidas varias veces; incluye navegador, renderer y worker, y no representa exclusivamente el modelo.

El proceso Node registró 711.667.712 bytes tras cargar el paquete y alrededor de 501 MB durante la síntesis. Su intervalo interno no capturaba toda la carga síncrona; el resumen usa también los snapshots explícitos. Estas cifras no son intercambiables con las de Chromium.

No se ha certificado aquí el consumo de batería, la temperatura, la RAM disponible o la velocidad en un teléfono físico. Tampoco se acredita todavía el arranque offline en frío ni la matriz completa de 66 combinaciones mediante este documento: sus pruebas integradas y el CI completo quedan pendientes de recoger y auditar. La publicación de 1.7.15 requiere su comprobación independiente.
