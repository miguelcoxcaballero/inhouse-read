# Punto 2 — Cambio entre voz natural y voz del sistema

Verificación: 2 de octubre de 2026. Web 1.7.4; APK vigente 1.1.2 (15).

## Diagnóstico

No se ha reproducido un fallo del lector al pasar de voz natural a sistema y volver. Sí se reprodujo un fallo de la prueba aislada: esperaba audio neural sin instalar antes la voz. La prueba también reutilizaba la posición guardada por casos anteriores, dejaba acabar los fragmentos del sistema cada 250 ms y contaba solicitudes neurales antes de abrir el menú. Esas condiciones hacían depender el resultado del orden y de la velocidad de ejecución.

## Cambios

- La regresión instala y selecciona Claude si hace falta, y vuelve al inicio con los controles reales del lector.
- El sistema completa un fragmento cuando la prueba lo indica; queda activo durante la comprobación de silencio neural. No se modifica el motor de la app.
- Se comprueba la misma frase antes y después de cada cambio, la velocidad elegida, el resaltado, nuevo audio real al volver y la cancelación definitiva al salir.
- Seis casos unitarios cubren web y puente Android: eventos tardíos, callbacks que llegan dentro de la cancelación, primer arranque pendiente y cambio durante el salto de página.
- Las pruebas de interfaz del lector aíslan el runtime neural y terminan sus tareas antes de destruir el DOM. Se elimina el ruido de 23 rechazos asíncronos de la tanda inicial.
- La tanda de audio abre el menú antes de descargar otra voz. Su caso independiente de primera descarga puede ejecutarse aunque falle el grupo anterior. La medición de memoria admite Windows.

## Resultados confirmados

| Comprobación | Resultado |
| --- | --- |
| Unitarias de voz, motor, catálogo y controles (`vitest run voice neural reader-experience`) | 518/518 |
| Tanda completa con motores y audio reales, incluida liberación de memoria, offline y segundo modelo | 10/10 |
| Cambio de voz desde un contexto limpio, tres repeticiones independientes | 3/3 |
| Cambio de voz en la web publicada, descarga real de Hugging Face | 1/1 |

La comprobación publicada usó el mismo caso con el origen de la web real y sin `INHOUSE_NEURAL_VOICE_BASE`: modelo, configuración, módulos JS y WebAssembly proceden de sus destinos de producción. La voz del sistema es una implementación controlada de `speechSynthesis`; el motor Piper y el audio Web Audio son reales. El puente Android se comprueba con un doble unitario, no con una voz de un teléfono físico.

Artefacto publicado comprobado: `/inhouse-read/assets/main-B4hyYZxY.js`, SHA-256 `a3dcece970cc285f54f26761a647a8165300741fe56f1cc7dd22294515792abc`. Captura y mediciones locales: `.animation.local/voice-switch-live-evidence/`. Las pruebas no requieren un APK nuevo ni cambio de versión de la app.

## Reproducción local

Colocar `es_MX-claude-high.onnx` y su `.onnx.json`, además de `es_ES-davefx-medium.onnx` y su configuración, en el directorio indicado por `NEURAL_VOICE_FIXTURES`. Son los modelos de `rhasspy/piper-voices`, sin modificaciones. Ejecutar después del build:

```powershell
$env:NEURAL_VOICE_FIXTURES = (Resolve-Path '.animation.local/neural-voice-fixtures').Path
$env:NEURAL_VOICE_IDLE = '1'
npx playwright test tests/e2e/neural-voice-reading.spec.mjs --workers=1
```

## Pendiente del punto 3

La suite unitaria general termina con 1462 casos correctos y cinco fallos en `android-refresh-rate.test.js`, sin los rechazos asíncronos anteriores. Esos cinco fallos se deben al checkout CRLF de Windows: el helper busca delimitadores y bloques con LF. Se verificó en lectura que normalizar `readFileSync(...).replace(/\r\n?/g, '\n')` recupera ambas plantillas y el bloque de versión. Esa corrección y la verificación general del lector, escenas y CI quedan para el punto 3.
