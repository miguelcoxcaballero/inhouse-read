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
- Frase española de 117 caracteres, modelo listo y SIN PCM preparado en
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

## Artefactos publicados

Fuente: `d626d6232184e8e42aa2c669d877b70d6715a78b`.
Pages: `b10c01f8df702055db9bb13ee2ad3655dcec7600`.
Deploy `38172275263` y Pages `38172319094`: completados correctamente.

El segundo contraste HTTP pasó **108/108** comprobaciones y los 99 recursos
coinciden en tamaño y SHA. El primer contraste se hizo antes de que Pages
terminara de propagar la versión; sus 15 fallos se conservan en
`published-1791750517845`. El resultado correcto está en
`published-1791750606241`.

Entrada: `assets/main-DdX0bp_H.js`, 653173 bytes, SHA-256
`faf90ca2fba42c15280e8c97b0eddf337b5e0edf7aadc8d5fbf9e5dcb7ad8dbd`.
APK descargada de nuevo: **1.1.12 / 25**, 78532469 bytes, firma V2 y paquete
verificados; `assets/public/index.html` sigue siendo el loader de 2107 bytes.
SHA APK: `405a3d2698949e1d6f7425b7e666b5ca1f0b42e9cb212852caca3711336dfefd`.
No hay copia antigua empaquetada de la web ni cambios en canales A/B.

La comprobación del APK es estática. Estas medidas no certifican latencia de
altavoz ni rendimiento en un teléfono físico. La batería general de CI
`38172275258` se lanzó íntegra y sus resultados se conservan separados de las
pruebas específicas de esta corrección.

### Comprobaciones finales del lector

- `reading.log`: **14/14**, 6,1 minutos, pesos reales y producción local.
  El primer Play registró únicamente «Preparando la voz natural…» antes
  del evento audible y «Leyendo» después. PDF, EPUB, Argentina 1×/1,25×,
  lectura offline, cambios de voz y cierre/recreación del worker a los 90 s
  conservaron sus comprobaciones completas.
- Medición del lector: worker frío **1531 ms**, PCM preparado **128 ms**,
  worker vivo con velocidad nueva **1133 ms**. Son casos distintos; 128 ms
  no acredita inicio frío ni el rendimiento de todos los modelos.
- `supertonic.log`: **3/3** con pesos reales, cambio de perfil neerlandés
  seguido inmediatamente de Play y dos casos preparados EN/NL, separados.
- `public-ui.log`: **1/1** contra la URL publicada con pin del SHA de main.
- CI general `38172275258`: unitarias y motor Piper completos aprobados;
  lector, demás voces y las seis particiones de UI seguían en curso al
  registrar este resultado. No se declara toda esa batería aprobada.
