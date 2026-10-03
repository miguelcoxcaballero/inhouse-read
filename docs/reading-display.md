# Pantalla durante la lectura

La política de pantalla se aplica al terminar la apertura del libro y se conserva
hasta terminar su devolución a la estantería. La portada y el editor del lomo
mantienen la barra de estado normal. Así los cambios de área útil de Android no
interrumpen las animaciones del libro.

## Implementación

- `src/js/reading-display.js` observa las clases de estado del lector. En la web
  solicita `navigator.wakeLock.request('screen')` mientras se lee. Libera la
  solicitud al cerrar o pasar a segundo plano y vuelve a solicitarla al regresar.
  Las respuestas tardías se liberan si pertenecen a un estado anterior. Un rechazo
  del navegador no genera un bucle de reintentos.
- Las plantillas Java y Kotlin de `android/html_to_apk_builder.py` implementan
  `InhouseNative.setReadingMode(boolean)` exclusivamente para el origen de Read.
  Durante lectura y con la actividad en primer plano se activa
  `FLAG_KEEP_SCREEN_ON` y se oculta `statusBars()`. La navegación del sistema sigue
  disponible. Android permite revelar temporalmente sus barras con un gesto.
- El inset superior pasa a cero sólo en lectura. Al cerrar la lectura, pasar a
  segundo plano o abandonar la página confiable se restauran las barras y se
  libera `FLAG_KEEP_SCREEN_ON`.
  Los insets laterales, inferiores y del teclado mantienen su tratamiento previo.
- Un APK anterior sin el método nuevo sigue funcionando con la política web
  cuando su WebView admite Wake Lock. Ocultar la barra nativa requiere instalar
  [APK 1.1.3 / código 16](https://miguelcoxcaballero.github.io/inhouse-read/download-android.html).

## Comprobaciones

- 26 pruebas unitarias: política web, carreras al adquirir/liberar Wake Lock,
  segundo plano, transiciones del libro, plantillas Java/Kotlin y conservación de
  los ajustes de frecuencia de pantalla.
- `tests/e2e/reading-display.spec.mjs` abre un PDF, pasa a segundo plano, vuelve,
  cierra y vuelve a abrir mediante la portada. Comprueba tres adquisiciones y tres
  liberaciones. El caso Android simula los cambios de tamaño de la barra para
  comprobar que no cancelan el libro.
  Ambos casos pasaron sin reintentos ni saltos en 36,6 s con Chromium/SwiftShader,
  comprobando que `main-9OwHIfaI.js` servido coincidía byte a byte con el build.
- La comprobación de las barras nativas y `KEEP_SCREEN_ON` corresponde al
  verificador del APK publicado en un emulador Android. El puente simulado de la
  prueba web no sustituye esa comprobación nativa.

Los dos casos de pantalla pasaron también en la web publicada 1.7.11 dentro de
la tanda de siete regresiones, sin omisiones ni reintentos y con manifiesto
`chromium` / shard `1/1` validado por `scripts/check-ui-results.mjs`. La entrada
real `assets/main-CYpsBWpi.js` coincide con los bytes de `gh-pages`. Evidencia:
`.animation.local/final-live-evidence/critical1711-final/`. Wake Lock y el puente
nativo de esos dos casos son observadores controlados; la prueba nativa de la APK
se describe a continuación.

## APK publicada 1.1.3

El build `37080634822` pasó nueve estados nativos, incluidos lectura fría,
segundo plano, regreso al mismo PDF, lectura caliente, importación por Compartir
y devolución a la estantería. El run independiente `37082246394` descargó la APK
pública y pasó cinco estados: estantería, lector, segundo plano, regreso al mismo
PDF y estantería. El tamaño fue 3.174.689 bytes y el SHA-256
`67a52bdebff36c889c81061c488d002f4ac881404e9d1a5f6ad49e909ce267f7`,
iguales a la APK verificada del build.

En lectura se comprobaron el foco de la actividad, `KEEP_SCREEN_ON`, la petición
de ocultar `statusBars`, su `InsetsSource` real invisible y el WebView en y=0.
En la estantería se comprobó la barra visible, el flag liberado y el WebView en
y=66, valor medido en este emulador. En segundo plano se comprobaron el foco
ausente, la barra visible y el flag liberado. Las 42 unitarias del helper de
verificación también pasaron.

La captura PNG del regreso al lector se tomó antes de estabilizarse y aún muestra
la barra. Se conserva como captura intermedia. El `InsetsSource` del volcado final
acredita la barra oculta, el volcado de ventana acredita `KEEP_SCREEN_ON` y el XML
posterior acredita el mismo PDF y la posición y=0. El PNG conserva el estado
intermedio previo a esas comprobaciones.

El verificador acreditó el primer regreso a la estantería a los 72,7 s en el
emulador del build y a los 41,1 s en la comprobación independiente; los estados
de estantería siguientes del build se acreditaron en unos 16 s. Estos tiempos
incluyen espera y capturas. Son medidas de un emulador por software, sin acreditar
rendimiento en un teléfono físico. Las evidencias están en
`.release.local/android-1.1.3-native-evidence.json`,
`.release.local/android-1.1.3-published-verification.json` y sus artefactos de
emulador, con XML, capturas, volcados de ventana y muestras intermedias.

## Web publicada 1.7.12

Los dos casos de pantalla pasaron de nuevo dentro de las siete regresiones
principales sobre `assets/main-B_kpIj72.js`, sin omisiones ni reintentos y con
guard normal `chromium` / `1/1`. Se comprobaron tres adquisiciones y tres
liberaciones de Wake Lock, el regreso al mismo documento y el cambio de tamaño
simulado de las barras durante las transiciones.

Los 20 recursos publicados coinciden con `gh-pages`, generado desde el commit
`67dd9bf269b81839f17f6a09beba11ce8c5cabea`. Evidencia nueva:
`.animation.local/final-live-evidence/live1712/critical/`. Wake Lock y el puente
de estos casos web son observadores controlados; las comprobaciones del APK
instalado se conservan por separado.

La comprobación independiente [37092563599](https://github.com/miguelcoxcaballero/inhouse-read/actions/runs/37092563599)
descargó e instaló la APK pública 1.1.3 después de publicar 1.7.12. Los cinco
estados nativos pasaron: estantería, lectura, HOME, regreso al mismo PDF y
estantería. El blob conservó tamaño, SHA, firma y loader; `Window`,
`InsetsSource` y XML comprobaron foco, `KEEP_SCREEN_ON`, visibilidad real de
la barra y WebView en y=0 al leer/y=66 en esta estantería de emulador. No se
exige un bounding box del WebView durante HOME.

Las capturas de entrada y regreso al lector muestran la barra oculta. La PNG
de segundo plano es intermedia: aún muestra el lector con la barra restaurada;
el XML posterior corresponde al launcher y el volcado final acredita foco
ausente y `KEEP_SCREEN_ON` liberado. El verificador acreditó el estado final de
la estantería a los 51,2 s, incluyendo espera y capturas, sin medir la duración
exacta de la animación ni acreditar latencia en un móvil físico. Evidencia separada:
`.release.local/android-1.1.3-published-verification-1712.json`, artefactos
originales de `37092563599` y `android-1.1.3-apk-recheck-1712.json`.

## Confirmación web 1.7.14 y APK pública

Los dos casos de pantalla pasaron de nuevo dentro de las 24 regresiones sobre la publicación 1.7.14 del commit b48a9928b9f2520e3ff3a3b299010b9bc7c0fd2f, incluyendo liberación al cerrar y pasar a segundo plano, regreso al mismo libro y cambios de tamaño durante las transiciones. El puente web y Wake Lock siguen siendo observadores controlados en estos casos.

La verificación independiente 37097625702 descargó e instaló de nuevo el mismo APK público 1.1.3 y pasó los cinco estados nativos. Los volcados de Window/InsetsSource y el XML acreditan el flag KEEP_SCREEN_ON activo y la barra de estado oculta al leer, su restauración al salir o pasar a segundo plano y la reaplicación al volver. Los tiempos de acreditación incluyen espera y capturas; no son una medida exacta de la animación. Evidencia actual separada: .release.local/android-1.1.3-published-verification-1714.json y android-1.1.3-apk-recheck-1714.json. Requiere instalar APK 1.1.3 para disponer del puente nativo.

El producto observado es b48a9928b9f2520e3ff3a3b299010b9bc7c0fd2f; el helper de observación del workflow es 38f04260bb1c6a6d53035202e0cd01c5749b1bb6, con runtime y APK idénticos. El ensayo anterior 37096554823 se detuvo en la importación antes del lector y se conserva por separado. Los observadores adicionales son de sólo lectura y añadieron 1,143524 segundos: 0,343294 antes del intent y 0,800230 después de la primera captura, antes de la recuperación; el resultado posterior no identifica por sí solo la causa del primer fallo. El PNG de entrada muestra el lector sin iconos; el PNG de regreso mantiene un encuadre transitorio, y el XML y los volcados posteriores acreditan el estado final. No se observó dentro del emulador la URL exacta del bundle; sus bytes se comprueban por HTTP independientemente.

La batería completa corresponde a 506f7ef08c3e7dddaddc4e5ce6a63313756710e5. Sólo tres archivos E2E cambian respecto al producto observado; Git y la comparación del despliegue acreditan runtime idéntico.
