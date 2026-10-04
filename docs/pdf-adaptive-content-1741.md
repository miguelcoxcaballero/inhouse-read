# PDF adaptable — 1.7.41

## Complemento 1.7.42

La revisión final reproduce un intervalo vacío mientras la página siguiente carga texto e ilustraciones. Una nueva regresión falla en `cadd938`: el texto de la página anterior pasa a estar vacío antes de resolver la carga. La corrección mantiene sus nodos y fotos durante la espera y sólo los libera al presentar la página nueva; al cambiar a vista original también se liberan después de preparar su contenido. Este complemento tiene batería y publicación propias, separadas de 1.7.41.

La batería local de 1.7.42 pasa **2.657 unitarias en 175 archivos**, incluida esa regresión. El build final pasa. La CI completa y la comprobación pública de este complemento tienen sus propios resultados.

## Cambios

La vista de texto sólo extraía los caracteres de PDF.js. Ahora también consulta los operadores de imagen, renderiza la página original una vez y recorta sus ilustraciones compuestas. Conserva rotación, recorte, transparencia y colores originales: no aplica el tema de lectura a las fotografías. Las capas solapadas forman una sola ilustración; las fotografías separadas se conservan por separado.

Las figuras se colocan junto al texto de su columna. El texto antes y después mantiene exactamente los mismos caracteres y posiciones lógicas. Un mapa de todos sus nodos permite guardar la posición, navegar por pantallas, buscar, resaltar y narrar sin limitarse al primer fragmento de texto. La página siguiente y sus fotos se preparan separadas del documento visible y sólo se activan al comenzar su audio.

Los párrafos se delimitan por la separación entre líneas, las columnas y las listas. Un cambio de tamaño de letra dentro de líneas con interlineado normal no crea párrafos nuevos. Para texto sin geometría fiable, los finales físicos de línea se presentan como espacios y no se omiten frases repetidas al narrar la vista adaptable. La extracción incluye una comprobación de que todos los elementos fuente se conservan exactamente una vez.

La página temporal se limita a unos cuatro millones de píxeles y se libera al copiar las figuras. Los canvas de las ilustraciones también se liberan al navegar, cerrar o cancelar la preparación. Cambiar de tema reutiliza sus píxeles originales.

## Verificación local

La batería unitaria final pasa **2.656 pruebas en 175 archivos**. El build final de 1.7.41 también pasa y genera los 44 recursos del shell offline.

Tres regresiones reproducen el problema en `4bfed7b`: los párrafos mixtos daban 3, 3 y 60 bloques donde correspondían 1, 2 y 1. La corrección conserva todas sus piezas de texto y obtiene los bloques esperados.

Pasan 18 E2E locales sin reintentos ni omisiones: ocho nuevos casos de fotografías/escaneos/texto completo y diez originales de orden, narración, navegación, tamaño de texto, orientación y reapertura. Se revisaron las capturas de papel, AMOLED y página escaneada. Cinco casos comparan los RGB originales de las fotos en papel, sepia, noche, AMOLED y salvia; se confirma que todos los marcadores de texto son alcanzables antes de pasar a la siguiente página física.

La primera ejecución E2E conserva sus fallos: dos fotos de la nueva fixture se solapaban y se fusionaban correctamente, mientras el test esperaba dos figuras separadas; el caso de salto usaba nombres de controles inexistentes. La fixture se corrigió para colocar dos fotos separadas y el salto usa los controles reales. Los tests originales y sus límites no cambian. También se conserva el fallo inicial de la nueva prueba numérica de límites: se corrigió el redondeo flotante de las coordenadas.

La batería completa final y la comprobación de la publicación tienen resultados propios pendientes de añadir aquí.

## Alcance

Cuando PDF.js no puede delimitar con seguridad una composición de imágenes, se conserva la página original completa junto al texto extraído. Una página escaneada se muestra como imagen; esta corrección no inventa una transcripción OCR. El orden de lectura de documentos sin estructura sigue dependiendo de sus coordenadas y no se garantiza para cualquier PDF mal formado.
