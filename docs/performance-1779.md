# Captura de PDF ya renderizado — 1.7.79

La apertura y el cierre pueden reutilizar el diseño de una página física
completada. Se comprueban documento, página, preferencias, tamaño, canvas,
texto y nodos con el mismo contrato de renderizado que ya usa el lector.
Si cambió el tamaño o se dañó ese estado, se completa su render antes de
copiar. Los snapshots siguen siendo copias nuevas con sus píxeles originales.

La opción se solicita sólo desde la preparación y el cierre de la app.
El contrato anterior por defecto conserva ambos fotogramas. El PDF adaptable
y Foliate mantienen sus esperas de fuentes y diseño; no cambian relojes de
animación, resolución, filtros, imágenes ni materiales.

Pasan 84 comprobaciones enfocadas, incluidas las originales de fonts,
captura, reutilización, persistencia local y controlador. Las cuatro nuevas
comprueban página intacta sin RAF, resize explícito, render pendiente y la
espera de dos frames del texto DOM. Con la fuente publicada anterior fallan
las tres primeras y pasa el control DOM. El primer helper conservó dos
fallos por mocks DOM incompletos; se corrigieron sólo esos nuevos mocks y
la comparación de fuente anterior se conserva separada y autenticada por Git.

La batería CPU pasa: 3.393 unitarias en 267 archivos, build y 75 pruebas
Python. El censo mantiene 524 casos E2E, todavía sin ejecutarlos en esa tanda.
Los 643 archivos de código, tests y configuración permanecen idénticos antes
y después. La publicación sigue pendiente. Evidencia:
`.animation.local/performance-1779/`; los primeros informes de mocks están
en `.animation.local/performance-1778/snapshot-settled-*`.

El primer lanzamiento gráfico se detuvo en Windows PowerShell 5 por una
advertencia de stderr antes de ejecutar casos. Se conserva su directorio,
log vacío y recibo del launcher. La ejecución separada utiliza PowerShell 7,
sin cambiar tests, fixtures, límites, renderer ni añadir retries.

Los siete recorridos locales pasan en ese primer lanzamiento efectivo,
sin retries ni omisiones. Los cierres nativos completos tardan 4.839,2 y
5.329,1 ms dentro de su límite original de 8 s. Código, build y métodos
permanecen idénticos. Pasan además los cinco casos originales de catálogo,
plantas y luces, sin retries. Pasan las dos regresiones originales adicionales
de continuidad de canvas y efecto de lámparas. Publicación y CI original
completo siguen pendientes. Estos tiempos no son un benchmark de
teléfono ni prueban una mejora frente a otra ejecución en distinta carga.
