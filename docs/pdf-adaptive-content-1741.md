# PDF adaptable — 1.7.41 y 1.7.42

## Complemento 1.7.42

La revisión final reproduce un intervalo vacío mientras la página siguiente carga texto e ilustraciones. Una nueva regresión falla en `cadd938`: el texto de la página anterior pasa a estar vacío antes de resolver la carga. La corrección mantiene sus nodos y fotos durante la espera y sólo los libera al presentar la página nueva; al cambiar a vista original también se liberan después de preparar su contenido. Este complemento tiene batería y publicación propias, separadas de 1.7.41.

La batería local de 1.7.42 pasa **2.657 unitarias en 175 archivos**, incluida esa regresión. El build final pasa.

La vista adaptable muestra las fotografías con sus colores originales, incluidas las giradas, y conserva el texto antes y después para navegar, buscar, guardar posición y narrar. Los cambios de tamaño de letra con interlineado normal ya no crean párrafos nuevos. La página anterior permanece visible mientras se prepara la siguiente: la regresión reproduce un intervalo vacío en 1.7.41 y pasa con 1.7.42.

Fuente `7f5ebd9f78dddeb53d4419e75920014612487510`, Pages `6ad512f6e5353db3d980ffd20d0514bbee5785bb`. La [CI original 37196721440](https://github.com/miguelcoxcaballero/inhouse-read/actions/runs/37196721440) pasa **2.657 unitarias en 175 archivos y 522 E2E**, 3.179 en total, sin omisiones, reintentos, flaky ni errores. Sus doce jobs y once ZIP originales se contrastan con el censo de la fuente; certificado `4306c2be20aa339d50d9377ead9b292998cb952d60e22d3056831817aaa2afed`. Pasan también las 75 comprobaciones Python originales.

La web pública pasa **18 casos PDF** sin reintentos, con **310 cuerpos HTTP** contrastados y 15 capturas; se revisaron papel, AMOLED y escaneo. Los cinco temas mantienen los RGB originales de las fotos y los marcadores de texto son alcanzables antes de cambiar de página física. Los casos de narración usan un motor controlado explícito para comprobar posiciones; los motores naturales tienen sus pruebas separadas en la CI completa. Certificado público `185e2ecc16bf0791a9290f4a228cac4378f1c2f1c3645f6dde9496e897827680`.

Los 23 módulos y 44 recursos offline coinciden con Pages por HTTP. El entry real `main-BWBX5xkG.js` tiene 1.418.744 bytes y SHA `bba76d53106a4952890da4418fc79bd204b3bdbe6e8a3983c1858d3a84a104c7`; certificado del artefacto `2d69e94190d614bafa036271e2d5362100a6587f72dd7b5dce4c528a9877d427`. Certificado de entrega `29668ee90a24ebcc38acb036cce7d4621ed861abddd964e6ab5b7f509397100f`.

La APK descargada de nuevo sigue siendo **1.1.4, código 17**, 78.515.243 bytes y SHA `feafaaa762b35344ac8b19418f9f6eb6cb1f725fba22b1ef3d3f273bd32a6191`: idéntica al APK firmado anteriormente comprobado. El inventario público contiene únicamente su loader de 2.089 bytes y dos stubs vacíos; el loader coincide byte por byte con la fuente. No se atribuye una captura nativa nueva a esta corrección web ni se necesita reimportar los libros.

La implementación previa 1.7.41 tiene su comprobación independiente: fuente `cadd93869ce935ed229dc440df6d277b24563372`, [CI 37195770731](https://github.com/miguelcoxcaballero/inhouse-read/actions/runs/37195770731) con 2.656 unitarias y 522 E2E, 18 casos locales y otros 18 sobre esa publicación. Conserva los fallos de la fuente anterior y de las primeras fixtures/auditoría. La corrección de carga 1.7.42 tiene resultados propios y no reutiliza esos casos como prueba de la versión actual.

Las páginas sin texto se muestran como imágenes, sin OCR. Las composiciones que PDF.js no puede delimitar con seguridad conservan la página original junto al texto. El orden de cualquier PDF mal formado no queda garantizado. [Historial y pendientes](remaining-wip-verification.md). Los pendientes históricos de Google, teléfono físico y configuración gráfica adicional permanecen en sus secciones anteriores.



## Cambios

La vista de texto sólo extraía los caracteres de PDF.js. Ahora también consulta los operadores de imagen, renderiza la página original una vez y recorta sus ilustraciones compuestas. Conserva rotación, recorte, transparencia y colores originales: no aplica el tema de lectura a las fotografías. Las capas solapadas forman una sola ilustración; las fotografías separadas se conservan por separado.

Las figuras se colocan junto al texto de su columna. El texto antes y después mantiene exactamente los mismos caracteres y posiciones lógicas. Un mapa de todos sus nodos permite guardar la posición, navegar por pantallas, buscar, resaltar y narrar sin limitarse al primer fragmento de texto. La página siguiente y sus fotos se preparan separadas del documento visible y sólo se activan al comenzar su audio.

Los párrafos se delimitan por la separación entre líneas, las columnas y las listas. Un cambio de tamaño de letra dentro de líneas con interlineado normal no crea párrafos nuevos. Para texto sin geometría fiable, los finales físicos de línea se presentan como espacios y no se omiten frases repetidas al narrar la vista adaptable. La extracción incluye una comprobación de que todos los elementos fuente se conservan exactamente una vez.

La página temporal se limita a unos cuatro millones de píxeles y se libera al copiar las figuras. Los canvas de las ilustraciones también se liberan al navegar, cerrar o cancelar la preparación. Cambiar de tema reutiliza sus píxeles originales.

## Verificación local de 1.7.41

La batería unitaria final pasa **2.656 pruebas en 175 archivos**. El build final de 1.7.41 también pasa y genera los 44 recursos del shell offline.

Tres regresiones reproducen el problema en `4bfed7b`: los párrafos mixtos daban 3, 3 y 60 bloques donde correspondían 1, 2 y 1. La corrección conserva todas sus piezas de texto y obtiene los bloques esperados.

Pasan 18 E2E locales sin reintentos ni omisiones: ocho nuevos casos de fotografías/escaneos/texto completo y diez originales de orden, narración, navegación, tamaño de texto, orientación y reapertura. Se revisaron las capturas de papel, AMOLED y página escaneada. Cinco casos comparan los RGB originales de las fotos en papel, sepia, noche, AMOLED y salvia; se confirma que todos los marcadores de texto son alcanzables antes de pasar a la siguiente página física.

La primera ejecución E2E conserva sus fallos: dos fotos de la nueva fixture se solapaban y se fusionaban correctamente, mientras el test esperaba dos figuras separadas; el caso de salto usaba nombres de controles inexistentes. La fixture se corrigió para colocar dos fotos separadas y el salto usa los controles reales. Los tests originales y sus límites no cambian. También se conserva el fallo inicial de la nueva prueba numérica de límites: se corrigió el redondeo flotante de las coordenadas.

La CI original de 1.7.41 pasa 2.656 unitarias y 522 E2E, sin omisiones ni reintentos. Sus 18 casos públicos pasan con 310 cuerpos HTTP contrastados. El primer auditor de capturas usó nombres coincidentes para dos casos distintos; ese fallo se conserva. La auditoría final usa nombres únicos sin repetir ni cambiar los resultados originales del navegador. Las verificaciones de 1.7.42 se enumeran separadamente arriba.

## Alcance

Cuando PDF.js no puede delimitar con seguridad una composición de imágenes, se conserva la página original completa junto al texto extraído. Una página escaneada se muestra como imagen; esta corrección no inventa una transcripción OCR. El orden de lectura de documentos sin estructura sigue dependiendo de sus coordenadas y no se garantiza para cualquier PDF mal formado.
