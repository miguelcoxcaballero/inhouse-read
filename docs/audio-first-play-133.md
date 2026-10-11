# Primer audio: web 1.7.133

## Causas y cambios

- `ReadingVoice.play()` anunciaba `playing` sin mensaje antes de tener PCM.
  El temporizador de 900 ms reemplazaba entonces «Leyendo» por preparación.
  Play, reanudación y cambio de voz mantienen preparación hasta el `start`
  del reloj de audio. El temporizador sólo señala esperas posteriores; no
  hace parpadear cada fragmento ya preparado. También se limpia el estado
  de reinicio cuando una recuperación empieza a sonar antes de 900 ms.
- Android convertía todos los bytes de modelos y tensores mediante arrays
  de caracteres, strings UTF-16 y base64. Se utilizan `toBase64` y
  `fromBase64` cuando existen; el protocolo, las porciones de 128 KiB, las
  barreras del executor y la ruta para WebView antiguos se conservan.
- El fonemizador Piper y la lectura/carga de su modelo ahora se preparan
  en paralelo. Se drenan ambos trabajos y se libera la sesión si fallan;
  generaciones canceladas no pueden instalar recursos tardíos. Hebreo
  conserva cargas seriales porque sus dos grafos comparten un upload nativo.
- Una primera frase larga con una cláusula natural de 24–90 caracteres
  puede entregar esa cláusula antes del resto. No se inventan cortes de
  palabra ni puntuación; quedan todos los textos, offsets, límites de página
  y el mismo rango de resaltado. Preparación silenciosa y Play comparten plan.

## Evidencia local

Directorio: `D:/CodexEvidence/InhouseRead-20261011/voice-first-audio`.

- `unit-final.json/log`: **4024/4024**, 324 archivos, 102 s.
- `build-final.log`: build de producción correcto y 99 recursos offline.
- `engine.log` y `engine/numbers.json`: **3/3**, pesos Piper reales.
- Frase española de 114 caracteres, modelo listo y SIN PCM preparado en
  ambos casos: primer audio **2327,7 → 951,6 ms**. Los dos fragmentos nuevos
  terminaron; se programaron consecutivamente en el reloj de audio, sin hueco.
- Conversión de 64 MiB en porciones de 128 KiB, tres tandas: original
  **1769,7 / 1707,1 / 1665,5 ms**; directa **16,1 / 15,8 / 17,6 ms**.
  Los bytes de ida y vuelta coinciden. Es el coste de conversión en Chromium,
  no el tiempo total de carga del modelo ni una medición de un teléfono.
- Selección de otro modelo y Play inmediato: **2753,3 ms** (1830 ms de carga
  aproximadamente). Este arranque web frío sigue requiriendo carga e
  inferencia; no se presenta como instantáneo.

El primer ensayo `unit.json/log` conserva dos expectativas antiguas que
exigían borrar preparación antes de oír la nueva voz. Las pruebas ahora
exigen mantenerla hasta el inicio audible, sin cambiar plazos ni saltarse
aserciones de cancelación, texto o seguimiento. Los fallos previos de CI
permanecen independientes de esta revisión.

Esta modificación se entrega por la web que carga la APK. No cambia Java,
paquete, firma, versión Android ni los canales compartidos del updater.
