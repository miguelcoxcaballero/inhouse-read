# Pantalla durante la lectura

La política de pantalla se aplica al terminar la apertura del libro y se conserva
hasta terminar su devolución a la estantería. La portada y el editor del lomo
mantienen la barra de estado normal. Así los cambios de área útil de Android no
interrumpen las animaciones del libro.

## Barra de estado sobre la página (APK siguiente a 1.1.7)

Hasta la APK 1.1.7 el WebView empezaba bajo la barra de estado en la estantería
y subía hasta y=0 al leer: al ocultarse la barra (fin de la apertura) toda la
página saltaba hacia arriba, y al volver (fin del cierre) hacia abajo.

Ahora ocultar o mostrar la barra no mueve ni redimensiona nada:

- El WebView se extiende siempre detrás de la barra, que es transparente
  (padding superior nativo 0 en todos los estados; laterales, inferior y
  teclado sin cambios). Las muescas se maquetan igual con la barra visible u
  oculta (`LAYOUT_IN_DISPLAY_CUTOUT_MODE_ALWAYS`/`SHORT_EDGES`).
- El listener de insets de `MainActivity` es el único que los aplica:
  `capacitor.config.json` desactiva el de Capacitor 8
  (`plugins.SystemBars.insetsHandling: "disable"`). Ese plugin rellenaba toda
  la ventana con la barra visible en WebView < 140 (el emulador de CI usa 124)
  y hasta que cargaba la primera página en cualquier WebView: la página seguía
  saltando al ocultarse la barra y saltaba también al arrancar. El teclado
  conserva el hueco que le daba el plugin (su altura, más la barra de
  navegación con WebView 144+).
- `InhouseNative.getSafeTopInset()` da en px CSS una altura estable:
  `max(statusBars ignorando visibilidad, lo que la shell rellenaba arriba: barra visible, muesca, barra de título de ventana)`. Un script en línea
  de `index.html` la fija en `--ihr-safe-top` antes del primer pintado y la
  shell llama a `window.inhouseSetSafeTop()` si cambia (giro, muesca,
  multiventana). Todo el CSS usa `var(--ihr-safe-top)` en vez de
  `env(safe-area-inset-top)`, que sigue siendo el valor por defecto
  (`tokens.css`) en navegadores y APK anteriores. El encabezado del lector mide
  `48px + --ihr-safe-top` con la barra visible u oculta: sin reflujo, sin
  repaginar el ePub ni redibujar el PDF.
- `InhouseNative.setStatusBarAppearance(fondoClaro)` (sólo la página de Read,
  en el hilo de UI) elige iconos oscuros o claros: tema de la app en la
  estantería, papel del lector mientras el libro es dueño de la pantalla,
  oscuro con el aviso de actualización y con el catálogo de plantas sin vuelo
  (fondo atenuado), claro con el catálogo volado desde el folleto (papel). La
  barra de navegación no cambia. Los diálogos centrados (catálogo) se colocan
  bajo la franja `--ihr-safe-top`.
- Como ya no hay redimensionado, `reading-display.js` oculta la barra cuando la
  página empieza su zoom de apertura (`body.is-reader-page-arriving`, puesto
  por `app.js`) y la muestra cuando el libro 3D recoge la página al cerrar
  (`body.is-reader-page-leaving`). El Wake Lock web conserva su momento. Las
  shells sin `getSafeTopInset` mantienen el comportamiento anterior.
- APK 1.1.7 y anteriores no cambian: la web no puede compensar el salto sin
  parpadeo (el WebView reposiciona su último fotograma antes de que la página
  responda) y sólo podría deducir la barra de un `resize`, ambiguo con teclado
  o multiventana. El aviso de actualización lleva a la APK nueva.
- `verify_android_app.py` detecta el contrato por el DEX: con la APK nueva exige
  WebView en y=0 con los mismos límites en cada estado en primer plano
  (estantería, lector, regreso desde segundo plano) y los controles del
  encabezado bajo la franja de la barra, también con la barra oculta. La APK publicada 1.1.7 se sigue verificando con el
  contrato anterior. Pruebas: `reading-display-stable-inset.test.js`,
  `android-reading-display.test.js`, `test_android_shell.py`,
  `test_verify_android_app.py` y los tres casos «inset estable» de
  `tests/e2e/reading-display.spec.mjs` (claro, oscuro con papel nocturno y
  horizontal), que comprueban al píxel que nada se mueve al ocultar o mostrar la
  barra.

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
- (APK 1.1.7 y anteriores) El inset superior pasa a cero sólo en lectura. Al cerrar la lectura, pasar a
  segundo plano o abandonar la página confiable se restauran las barras y se
  libera `FLAG_KEEP_SCREEN_ON`.
  Los insets laterales, inferiores y del teclado mantienen su tratamiento previo.
- Un APK anterior sin el método nuevo sigue funcionando con la política web
  cuando su WebView admite Wake Lock. Ocultar la barra nativa requiere instalar
  [APK 1.1.3 / código 16](https://miguelcoxcaballero.github.io/inhouse-read/download-android.html).

## Propiedad del lector en las APK nuevas

`setReaderOwnership` recibe el estado del libro, independientemente de los cambios de visibilidad del WebView. La Activity combina ese estado con su lifecycle y el origen confiable. Al bloquearse libera KEEP_SCREEN_ON y restaura las barras; al regresar aplica la política de lectura una vez. Un evento web de visibilidad tardío ya no introduce otro cambio que pueda cerrar las notificaciones del sistema. Al cerrar el libro, abandonar la página o disponer el controlador se libera la propiedad.

El Wake Lock del navegador conserva su política de primer plano. Las APK sin el puente nuevo siguen usando setReadingMode con el comportamiento anterior. Los siete casos nuevos pasan junto con los diez originales; la APK real 1.1.4 / código 17 pasa los nueve estados originales de pantalla y las acciones de la notificación después de despertar. [Resultados completos](remaining-wip-verification.md).

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

## Android 1.1.4 publicado

El build original `37167745832`, sobre el producto `8602135708e520c35ae52483fbfd5e19a2c54203`, pasa nueve estados de pantalla y el ensayo completo de audio bloqueado, controles de notificación, cleanup y dos páginas PDF bloqueadas. El método setReaderOwnership está presente en el DEX público; la APK descargada coincide con su build autenticado y conserva firma V2 y el certificado anterior.

La captura fría del lector muestra el PDF sin hora ni iconos Android. La captura PNG intermedia de Detener PDF está vacía: el resultado del control se acredita por su XML original, acción, callbacks y volcados posteriores. No se utiliza esa imagen como prueba visual de la notificación. Instala [APK 1.1.4 / código 17](https://miguelcoxcaballero.github.io/inhouse-read/download-android.html) para disponer del nuevo puente nativo; la comprobación de emulador no acredita un teléfono físico.
