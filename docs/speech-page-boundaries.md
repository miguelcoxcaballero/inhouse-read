# Audio y frases entre páginas

La fuente EPUB conserva el texto de la sección y sus rangos DOM. Antes de
preparar el audio, `speech-page-breaks.js` obtiene los cortes de página de los
glifos ya maquetados, usando el mismo eje, sentido y tamaño de página que el
renderizador. Cada nodo requiere una lectura de sus rectángulos; sólo los nodos
que cruzan páginas necesitan búsquedas de caracteres. La preparación cede el
hilo periódicamente y descarta el trabajo si se cierra el documento.

`planSpeech` transforma esos offsets a los índices del texto normalizado y corta
los fragmentos sin perder caracteres. La eliminación de notas, los espacios
colapsados y los caracteres invisibles conservan la correspondencia con el
documento. Los fragmentos de una misma frase conservan su rango de resaltado.

`ReadingVoice.present` sigue el rango del fragmento cuando el motor anuncia su
inicio audible, no al pedir su síntesis. Al empezar la continuación situada en
la página siguiente, Foliate avanza a ella. El flujo con scroll mantiene su
seguimiento habitual. En PDF la siguiente página legible se prepara sin cambiar
la visible; activate() intercambia canvas, texto y progreso al inicio audible
del fragmento de continuación. Usa el mismo documento PDF.js y conserva un
único canvas adicional. Las preparaciones se invalidan al pausar, navegar,
cerrar, cambiar preferencias o cambiar la geometría del lector.

Comprobaciones: doce casos de geometría y normalización, más una integración
que retiene los eventos del motor y comprueba que no se gira la página durante
la preparación ni después de pausar. `neural-page-follow.spec.mjs` añade una
frase corta que cruza columnas reales y registra PCM, los inicios audibles y
las reubicaciones del lector con el modelo real Davefx. La verificación de este
caso sobre la publicación pasó también en `main-Ds1rBulm.js`, con Davefx
descargado desde el origen HTTPS de Hugging Face: la reubicación ocurrió 2 ms
después del inicio audible de la continuación, sin girar antes, perder texto
ni llamar a voces del dispositivo. El PCM de ambos fragmentos fue finito y
audible. Evidencia: `.animation.local/final-live-evidence/page-https179/`.

Las nueve comprobaciones publicadas de papel y temas también pasaron, sin
fotogramas omitidos ni reintentos. El primer intento del caso de audio no tenía
la ruta de fixtures configurada; el siguiente usaba un espejo HTTP local que
el navegador bloqueó desde la página HTTPS. El caso final conserva las mismas
aserciones y usa la descarga normal de producción. Esos intentos se conservan
como fallos del entorno de prueba, separados del resultado final.

## Publicación 1.7.11

La tanda real publicada pasó 7/7 casos sin reintentos ni omisiones, con proyecto
`chromium`, shard `1/1` y validación mediante `scripts/check-ui-results.mjs`.
Incluye el caso de página con Davefx descargado desde el origen HTTPS de
Hugging Face: la reubicación al offset 64 ocurrió **1,7 ms después del inicio
audible** de la continuación. La frase completa de 143 caracteres se conservó,
el PCM fue finito y audible y hubo cero llamadas a las voces del dispositivo.
La entrada real era `assets/main-CYpsBWpi.js`, con los mismos bytes de `gh-pages`.

Evidencia: `.animation.local/final-live-evidence/critical1711-final/`, incluidos
`manifest.json`, `results.json`, `audio-page-evidence.json`, `audit.json` y las
trazas. La primera tanda, conservada en `critical1711/`, tuvo seis casos correctos
y se detuvo antes de abrir la aplicación en el caso de audio porque su ruta de
fixtures era incorrecta. Se corrigió sólo esa variable de entorno y se repitieron
los siete casos con las mismas acciones y aserciones. Sus JSON originales se
conservan sin editar.

## Publicación 1.7.12

El caso se ejecutó de nuevo sobre `assets/main-B_kpIj72.js` junto a las siete
regresiones principales, que pasaron 7/7 sin reintentos ni omisiones. Davefx,
Piper, ONNX y Web Audio fueron reales y los pesos se descargaron desde Hugging
Face. La página avanzó al offset 64 **1,9 ms después del inicio audible** de
la continuación; se conservó la frase completa de 143 caracteres y hubo cero
llamadas a las voces del dispositivo. El PCM siguió siendo finito y audible.

Evidencia nueva: `.animation.local/final-live-evidence/live1712/critical/`,
con manifiesto, resultados y trazas originales, pin del commit
`67dd9bf269b81839f17f6a09beba11ce8c5cabea` y guard normal `chromium` / `1/1`.
El resultado acredita el evento de reproducción del navegador, sin medición
de sonido mediante un micrófono físico.

## Confirmación publicada 1.7.14

La continuidad audible pasó de nuevo contra la web real 1.7.14, commit b48a9928b9f2520e3ff3a3b299010b9bc7c0fd2f, dentro de las 24 regresiones publicadas. Conserva el texto completo y gira al empezar el fragmento audible que continúa en otra página, con pesos reales, Piper, ONNX y Web Audio, sin utilizar voces del dispositivo. La preparación anticipada y las lecturas canceladas conservan sus comprobaciones en la batería completa 37100354260.

Las mediciones anteriores de 1.7.12 permanecen como histórico. Evidencia nueva: .animation.local/final-live-evidence/live1714/critical/ y ci-37100354260/. El PDF prepara una única página siguiente usando el mismo documento y worker PDF.js, con canvas y TextLayer adicionales separados, y la activa de forma síncrona en engineStarted. No mueve el progreso ni los píxeles durante la síntesis. Treinta y tres regresiones PDF y catorce de ReadingVoice comprueban pausa/reanudación, cambio de voz y velocidad, navegación, cierre, zoom, reflow, fuentes tardías y cancelación sin borrar el resaltado nuevo; los 47 focales PDF y 88 de ReadingVoice/Controller pasaron.

La batería completa corresponde a 506f7ef08c3e7dddaddc4e5ce6a63313756710e5; ese commit modifica únicamente las observaciones en tres archivos E2E. La continuidad audible y las 24 regresiones reales conservan el certificado del producto b48a9928b9f2520e3ff3a3b299010b9bc7c0fd2f; la equivalencia de todos los bytes publicados se acredita por separado, sin atribuir una ejecución nueva al certificado anterior.

En la web publicada, la reubicación EPUB ocurrió 2.3 ms después del inicio audible; PDF cambió canvas, texto y resaltado 4.2 ms después. Sus 90 fotogramas observados durante la espera conservaron la página anterior. La comprobación visual usa una huella del canvas muestreada a 32×48 y sus dimensiones, junto al texto mapeado; no hashea todos los píxeles de resolución nativa. Son medidas de eventos Web Audio en Chromium, sin micrófono físico ni garantía de latencia en todos los teléfonos.
