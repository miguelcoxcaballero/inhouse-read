# Rendimiento de Inhouse Read 1.7.63

## Cambio

La puntuación numérica de las máscaras de fuentes de la portada se ejecuta
en un Worker de módulo. La carga de fuentes, el rasterizado de cada máscara,
el muestreo y análisis de color, el orden de candidatos y la selección final
siguen en el hilo principal. El cálculo puro conserva sus operaciones y
umbrales originales; no reduce resolución ni precisión. Si el Worker no
está disponible o falla, se calcula esa misma máscara por el camino anterior.
Se conserva el límite original de un segundo para cargar las fuentes.

Los datos de imagen se clonan una vez por trabajo y sólo hay una máscara
en vuelo. Los arrays originales siguen disponibles para el fallback. Los
identificadores evitan respuestas de trabajos antiguos; error, cierre,
pagehide e inactividad liberan los recursos del Worker. No cambian modelos,
materiales, iluminación, relieve ni animaciones.

## CPU aislada

La comparación final conserva las 52 identidades originales en ambos brazos.
El control pasa sus 52 originales; el candidato pasa 77 casos, incluidos los
25 nuevos de cliente, protocolo, referencia numérica e integración. Estos
25 sólo se seleccionan en el candidato porque los módulos nuevos no existen
en el control Git61. Fuentes, métodos y entradas root quedan estables.

Los dos primeros métodos mantienen FAILED. El primero no pudo resolver el
reporter por su ruta absoluta de Windows: ambos brazos salieron con error,
sin recoger tests ni producir JSON. El segundo conserva los 52 originales
correctos en ambos brazos y 73 de 77 casos del candidato. Cuatro fixtures
nuevos fallaban al comparar arrays de Node structuredClone con constructores
de jsdom; además, la caché de resultados generada por Vitest cambió el guard
de fuente. El método final utiliza Node sólo en esos tres archivos nuevos
y desactiva esa caché con la opción admitida. Conserva todas las assertions,
la configuración original, los plazos y los primeros informes fallidos.

CPU final SHA-256:
`51b3920376e11e5d9e4a6ba7dbdd33755b7f31dd5cbde311c41dfd75ae6d1836`.

## Analizador real y funcionamiento offline

El navegador real ejecuta el Worker construido por Vite con fuentes web
originales ya cargadas. Dos portadas controladas, una mixta serif vertical
y otra sans en mayúsculas horizontal, se analizan online y offline. Los
432 pares de puntuaciones son exactamente iguales; también coinciden todos
los bytes de muestras y máscaras y el registro final de apariencia. Se
observan callbacks RAF mientras una puntuación está pendiente en las cuatro
corridas. Esto no acredita FPS, temperatura ni un menor tiempo total de
identificación de fuentes en un teléfono.

El primer método de navegador sigue FAILED: su guard esperaba cero fallos
de red y detectó el intento offline de consultar la raíz. El método fresco
clasifica únicamente ese probe exacto de la raíz como esperado. Exige además
una navegación 200 servida por el Service Worker con el mismo cuerpo online
y offline, y el cuerpo real del Worker, también 200 desde el Service Worker,
con los mismos 2.083 bytes y SHA-256. No permite fallos inesperados ni sustituye
respuestas. Los arrays de pageErrors, consoleErrors y fallos de red inesperados
están vacíos. Navegador y preview quedan cerrados; las entradas no cambian.

Esta comprobación utiliza la shell offline real bajo `/inhouse-read/` en
un fixture de producción. Compara el analizador y sus datos; no es una
comparación de píxeles del modelo 3D ni una prueba del teléfono o APK.
Su control de producto es Git61 `de672fd`; la fuente candidata aislada es la
adoptada para 63. La publicación de la fuente final se comprueba aparte.

Informe real SHA-256:
`1b4e9ec6b35c975143f1a703330f8674cca63d3e9dd57efd183cf8669f84c2e1`.
Worker offline SHA-256:
`349532fe6fde651eb325560db3c783379e2f2b96f6976808c17f98291bcadf69`.

## Batería completa y recorridos

La fuente final pasa 3.134 unitarias en 239 archivos, compilación y 75
comprobaciones Python. Los cinco comandos terminan con exit0 y los 523
hechos de fuente permanecen estables. El censo conserva 524 identidades
únicas E2E, cero omisiones y cero intentos ejecutados; el listado no se
presenta como una ejecución. El recibo completo real tiene SHA-256
`79947b707bec27fce6f6c7c84b794e3ae5270cd49a3368f394dd437965e69612`.

Los siete recorridos locales originales pasan al primer intento, con siete
intentos, cero retries, flaky y omisiones. Sus cierres alineado y legado
miden 5.265,9 y 6.056 ms con los mismos presupuestos originales de ocho
segundos. Fuente y build permanecen estables. El recibo local tiene SHA-256
`f9d6f3b104be5f25063091227ebed8df4c31b6d3a2e2d1cb84966d8be1c59302`.
Los 21 recorridos públicos originales también pasan al primer intento, como
se detalla abajo. La auditoría CI63 sigue pendiente. El CI original de 61
conserva su colección completa sellada FAILED; estos pases no lo reclasifican.

## Publicación HTTP y APK

Fuente `f81d3a1`, Pages `774af05`: los 24 módulos y 45 archivos offline
servidos coinciden con los bytes de la publicación. El artefacto HTTP tiene
SHA-256 `80fe4905bb7c17a83bd50eeecb0e090eab1b1f9d3f7fe7e523cf1695ad5dd3fd`.
La APK recién descargada conserva exactamente los 78.515.243 bytes de la
firmada previamente 1.1.4/code17; el loader de 2.089 bytes coincide con
la fuente. No se ha realizado otra captura de dispositivo ni otra invocación
de comprobación criptográfica de firma.

Los tres recorridos públicos originales de editor y regreso nativo pasan
al primer intento, sin retries, flaky ni omisiones, con 53 cuerpos de
aplicación autenticados. Su certificado SHA-256 es
`1d90362487d94825e0850a19077c429bcf940e88260ecb7ead5ff2283a93fd1e`;
el informe bruto tiene SHA-256
`249860864682ff9c0ef0007e5a3c4278a65b91f9f3e7708032ed6dfc4354ebc3`.
Los 18 recorridos PDF públicos también pasan al primer intento, sin retries,
flaky ni omisiones, con 324 cuerpos autenticados. Conservan fotos en todos
los temas, texto completo, orden y navegación. Su certificado SHA-256 es
`a384e4a2941878e4b49246633adffdedbf0c8b7b08091953ff5479ec0a8508f1`.
Se conservan las assertions y los plazos originales. La auditoría CI63
permanece pendiente; estos pases no cambian los fallos originales de CI61.

## Evidencia

En `.animation.local/performance-1763/`:

- `cover-font-worker-proposal-attempt1/` a `attempt4/`: propuestas y revisiones
  anteriores conservadas; la última cambia sólo los fixtures nuevos de realm.
- `cover-font-worker-cpu-method-attempt1/`: reporter fallido conservado.
- `cover-font-worker-cpu-method-attempt2/`: cuatro fallos nuevos y caché conservados.
- `cover-font-worker-cpu-method-attempt3/cpu-attempt1/execution/summary.json`:
  comparación final original52/candidato77.
- `cover-font-worker-real-quality-attempt1/`: build y primer navegador FAILED.
- `cover-font-worker-real-quality-attempt2/browser-attempt1/report.json`:
  analizador, máscaras, muestras y Worker offline reales.
- `release-helper-preparation-attempt1/`: fallo del generador previo a ejecutar.
- `release-helper-preparation-attempt2/`: helpers metadata-only, conteos provisionales.
- `full-local-attempt1/summary.json`: batería completa real PASS y censo no ejecutado.
- `local-browser-attempt1/summary.json`: siete originales locales PASS, sin retries.
- `public-f81d3a1-attempt1/http-attempt1/`: artefacto y procedencia HTTP reales.
- `public-f81d3a1-attempt1/apk-attempt1/`: APK recién descargada y loader.
- `public-f81d3a1-attempt1/performance-browser-attempt1/performance-qualification.json`:
  los tres recorridos públicos originales PASS, informe bruto conservado.
- `public-f81d3a1-attempt1/browser-attempt1/certification.json`: los 18 PDF públicos PASS.
