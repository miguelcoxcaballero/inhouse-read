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
renders GPU durante el movimiento. Publicación y comprobaciones públicas
pendientes.

Evidencia: `.animation.local/performance-1769/`.
