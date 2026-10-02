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
- El inset superior pasa a cero sólo en lectura. Al cerrar, pausar o abandonar la
  página confiable se restauran las barras y se libera `FLAG_KEEP_SCREEN_ON`.
  Los insets laterales, inferiores y del teclado mantienen su tratamiento previo.
- Un APK anterior sin el método nuevo sigue funcionando con la política web
  cuando su WebView admite Wake Lock. Ocultar la barra nativa requiere el APK nuevo.

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
- La comprobación de las barras físicas y `KEEP_SCREEN_ON` corresponde al
  verificador del APK publicado en un emulador Android. El puente simulado de la
  prueba web no sustituye esa comprobación nativa.
