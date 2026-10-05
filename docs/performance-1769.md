# Iluminación y rendimiento de Inhouse Read 1.7.69

Los dos renderizadores persistentes utilizan el mismo estudio de iluminación.
El primero conserva su generación original; una transferencia asíncrona del
atlas HDR permite que el segundo reutilice exactamente sus datos en vez de
reconstruir la sala y filtrar todos los niveles de rugosidad otra vez.

No se espera esa transferencia al seleccionar, abrir o devolver un libro.
Si aún no está lista, el navegador no la admite o sus datos no son válidos,
se conserva la generación original. Sólo se intenta una transferencia,
limitada a 8 MiB: el atlas real contiene 6.291.456 bytes. Añade esa caché CPU
y un buffer GPU temporal; no es una promesa de memoria neutra. Mantiene
resolución, materiales, luces, colores, geometría y relojes de animación.

## Comprobaciones

Pasan las 54 pruebas enfocadas (19 nuevas) y la batería local completa:
3.232 unitarias en 253 archivos, build y 75 Python, con bytes estables.
El listado de 524 E2E es un censo, no una ejecución.

En Chromium real, la función integrada del segundo renderer utiliza el
atlas transferido y evita una segunda generación PMREM. Los 786.432 texels
RGBA half-float (3.145.728 valores) son idénticos al estudio publicado en 1.7.68. Oro, plata y
color producen cero canales distintos desde los ángulos 0, 0,35 y −0,5.
En ese experimento, crear el renderer original tarda 45,9 ms, el primer
candidato 48,4 ms y el segundo con caché 5,5 ms. Son tiempos de creación de
un experimento aislado; no miden FPS ni la latencia total en un móvil.

Los siete recorridos de apertura/cierre/editor/movimiento pasan al primer
intento, sin retries ni omisiones, con 613 entradas fuente/build estables.
Los cierres nativos completos tardan 4.908,1 y 5.303,4 ms dentro de sus
plazos originales; las capturas conservan el framebuffer y sus píxeles.
El gesto isométrico conserva seis lomos a resolución 1.024 y no añade
renders GPU durante el movimiento.

Publicada desde `9603638`, Pages `ee412b1`: el HTML y el main descargados,
los 25 módulos y las 89 entradas offline coinciden con el artefacto real.
Los tres recorridos públicos nativo/editor y los 18 PDF pasan al primer
intento, sin retries ni omisiones; cada caso observa el main publicado.
También pasan las 93 caras online/offline: 34 cuerpos WOFF2 servidos por
el Service Worker sin red, con medidas y raster idénticos.

La descarga nueva del APK 1.1.4/code17 tiene 78.515.243 bytes y SHA256
`feafaaa762b35344ac8b19418f9f6eb6cb1f725fba22b1ef3d3f273bd32a6191`.
Su loader real tiene 2.089 bytes y sólo hay dos stubs Cordova vacíos;
no contiene una copia empaquetada de la app. El cambio es web y no requiere
recompilar el wrapper.

Android emulado `37293604213` pasa con el APK real descargado: el formulario
real de Google se abre sin error de solicitud y se acreditan estantería,
lector, segundo plano, el mismo PDF al regresar y estantería. Se reproducen
las aserciones del verificador original contra sus XML, Window e InsetsSource.
Lectura: KEEP_SCREEN_ON, barra solicitada y realmente oculta, WebView y=0.
Estantería: flag liberado, barra visible y WebView y=66 en este emulador.
El estado final de estantería se observa a los 34,206 s (seis capturas),
pero su PNG todavía muestra el libro en tránsito. Es evidencia de política
nativa y UI del home, no de la terminación visual ni de un cierre 3D de
esa duración. Las capturas originales se conservan. No se introducen
credenciales: la comprobación de Google es preflight, no login/Drive real.
La identidad del JavaScript se acredita por HTTP aparte; no se captura
el SHA del body dentro del emulador. CI69 `37292891253` termina FAILED: UI3 conserva dos timeouts globales de
30 s en arranque/apertura y UI1 se cancela por el límite del job de 45 minutos
(según la anotación original de GitHub). El agregado falla. El servidor
reporta diez artefactos y falta UI1, por lo que no hay censo completo de 524
casos acreditado en esta versión. La descarga inicial de su log devuelve
HTTP404/BlobNotFound y no se presenta como log validado. Los originales y
retries de UI3 quedan registrados como fallo; no prueban un cierre aislado
completo superior a 8 s.
No se afirma todavía aprobación completa ni rendimiento de un móvil físico.

Evidencia: `.animation.local/performance-1769/`.
