# Continuación: compartir páginas PDF sin esperar cada fotograma

## 1.7.115 preparada

Se retira la integración de fences de la 1.7.114 en la animación. La observación
de dos recorridos SwiftShader registra esperas de 1,41–2,9 s durante la salida
y 1,52 s durante un zoom de cierre. Las llamadas sólo se observan, sin emitir
trabajo GL adicional. Ambos diagnósticos pasan; no sustituyen los fallos
originales ni acreditan rendimiento global.

Las trazas originales CI114 llegan a Back a 28,22/26,96/26,83 s; el retry
alineado falla antes de mostrar la portada. La cola no acredita mejora del
recorrido completo. Se conserva el helper experimental y sus trece unitarias
aisladas, pero la app no lo importa ni lo empaqueta. La animación vuelve al
reloj original de 48/100 ms, sin modificar sampler, resolución ni materiales.

Se conserva la optimización comprobada: una medición y una textura cuando
el lector prueba que los dos rasters PDF son idénticos. Los temas y las
fotografías mantienen sus píxeles. Cinco poses GPU exactas, tres nuevos
grupos de unitarias y diagnóstico offline de cinco temas documentados en
[el informe114](performance-1815.md). No se reduce calidad.

Evidencia de115 en `D:/CodexEvidence/InhouseRead-20261010/release-115-methods/`.
Batería local: 3.680 unitarias/300 archivos, build y 105 Python PASS.
El censo lista 533 E2E; no constituye su ejecución. Los siete recorridos
originales locales pasan sin retries, incluidos ambos regresos nativos,
con los límites originales de 30 s/8 s. Los recorridos nativos completos
tardan 18,9 y 18,0 s; no es una medición del teléfono ni una comparación
que acredite mejora sostenida. Los errores de método y los fallos
funcionales/auditorías114 se conservan, sin reintentar los originales
ni cambiar sus plazos.

## Publicación y artefactos reales

Fuente `7eb558a827169fa17b459d934c9c7c503cb3b4c2`; Pages
`fbde21ba9947c61ef734042956c5d2e815498ee5`. Deploy38090753265 y
Pages38090782148 SUCCESS. El primer pin conserva FAIL: Pages aún
servía el index114. El segundo comprueba index/main115 exactos.
Main público `assets/main-BCzyjcI0.js`,614.918 B, SHA256
`971dd715e57e18ba23d24800e2c8672041d04a61631387ec3bc1acea47206e2d`.
Grafo HTTP32/shell96 exactos.

Web real:31/32 auditorías estrictas PASS. Los18 PDF, cinco de catálogo
y cuatro de importación Android pasan. El editor móvil conserva un FAIL
de captura HTTP200/0 B de nogal tras terminar sus aserciones funcionales;
no se reejecuta para sustituirlo. Ambos regresos nativos públicos PASS,
con cinco muestras cada uno y cierres de4,287/4,001 s. No se modifican
los plazos30 s/8 s ni se declara resuelto el rendimiento general.

Cuatro recorridos offline PASS: bytes/progreso local, papel en cinco temas,
portada y cierre durante la primera portada. El contrato de papel compartido
comprueba una medición sólo cuando los dos rasters son idénticos; el resto
mantiene dos y todos los hashes de imagen originales.

APK1.1.8/code21 descargado nuevamente:78.531.695 B, hash y firma exactos,
loader2.107 B y assets/public sin copia completa de la app. No hay cambios
nativos que requieran otro APK. Run38090897979 SUCCESS, ZIP original
autenticado8.418.660 B: cinco estados de barras/insets/pantalla activa PASS.
Google acepta la petición; no acredita una cuenta humana autenticada.

CI completa11538090753280 terminada con FAIL:531/533 casos PASS.
Once ZIP autenticados y doce jobs,535 intentos, dos retries y cuatro
intentos fallidos, sin incidencias de colección. Snapshot002 ya conserva
el censo completo pero su metadata de run seguía in_progress; snapshot003
confirma completed/failure y conserva los mismos originales. Las cuatro
familias de voces con pesos reales PASS, incluidos220 perfiles Supertonic
sin omisiones ni retries. El shard3 conserva dos regresos
nativos timedOut también en retry. Sus trazas llegan a Back a27,11/27,74 s
en390px y26,13/23,14 s en393px. Se mantiene30 s globales/8 s de cierre;
estas trazas no permiten atribuir todo el tiempo al cierre. Los originales
se recogen por separado, sin reemplazar los fallos por los PASS locales.

## Diagnósticos adicionales, sin cambios de producto

El editor con observación de origen de respuestas, blobs y bitmaps pasa:
la app recibe209.252/151.604 B, hashes exactos y bitmaps1024×1024. Las
peticiones observadas son precargas de tipo Other, sin worker ni caché de
disco. No reproduce la captura vacía original ni demuestra su causa.
No sustituye31/32 por32/32. Evidencia en response-origin-observation-attempt1.

Se observa la generación del estudio fuera de la app: una escena de tres
esferas con materiales físicos conserva409.600 B RGBA exactos entre la
textura original y la cacheada, sin errores GL. El atlas original tiene
768×1024,6.291.456 B y741 KB comprimidos. La observación por fases registra
71,4 ms de constructor frío,967,6 ms hasta completar el atlas,6,1 ms de
constructor cacheado y153,7/146,5 ms de dibujo. No es un recorrido de app,
una comparación sostenida ni un teléfono. No justifica añadir una descarga
al arranque sin medir su coste completo; no se cambia el producto.

El método1 falla por importar fuentes en preview; el2 conserva un timeout
de90 s con la petición de módulo sin completar. Los métodos3/4 usan un
servidor de fuentes sin descubrimiento de dependencias y pasan. Fuentes,
geometría, materiales y plazo diagnóstico90 s permanecen iguales; sólo4
añade relojes de fase. Se conservan los cuatro métodos y sus resultados en
studio-cold-observation-* y studio-cold-phase-attempt4 de la raíz de D.

Sin voces nuevas:39 opciones Piper/35 modelos y diez personas Supertonic
en220 perfiles. Las variantes regionales sin modelos compatibles/licencias
completas verificadas siguen pendientes. Priyamvada remite a BY-NC-SA4.0;
la licencia completa de IndicTTS no pudo recuperarse (timeout), por lo que
los derechos parciales indexados no acreditan la incorporación de Rohan.
No se descargan ni cuentan como comprobados sus pesos.
