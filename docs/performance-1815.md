# Continuación: fotogramas del libro y página física

## Cambios preparados para 1.7.114

La animación del libro presenta un solo fotograma pendiente en la GPU.
Una fence se consulta con espera cero; mientras no termina, se conserva
la pose visible. El último fotograma también termina antes de entregar
la fase siguiente. Se mantienen sampler, pasos de48/100 ms, resolución,
modelos, materiales y todos los plazos originales de prueba. Los contextos
sin soporte conservan la ruta anterior; cancelación y pérdida del contexto
liberan la fence.

Las dos copias de una página PDF sin filtros conservan identidades y bytes
propios, pero comparten medición del papel y textura GPU cuando el lector
prueba igual fuente/filtro/resampling. Los demás temas, brillo y navegación
siguen invalidando o separando esas revisiones. Las fotografías no cambian.

## Investigación conservada

Evidencia nueva en `D:/CodexEvidence/InhouseRead-20261010/`; contiene un
junction node_modules a las dependencias del repositorio y no debe moverse
ni borrarse recursivamente siguiendo ese enlace. Los métodos pequeños están
en `.animation.local/performance-1815/` y `release-114-methods/` en D.

Se descartaron iniciar antes el worker, cambiar su rasterizador y preparar
la página antes de acabar la salida: no acreditaban mejor rendimiento total,
y la última opción alargaba la salida en SwiftShader. Sus originales siguen
en los directorios retired y sus diagnósticos; no se publican esos cambios.
La restauración de app/prepared-page y los dos primeros módulos conservó
los hashes de bytes de trabajo anteriores, incluidos sus finales de línea.

El control de cola GPU pasa dos diagnósticos instrumentados con los límites
originales30 s/8 s:21,7 y20,8 s completos. Desde restaurar hasta snapshot,
95,7 y28,7 ms. No es prueba de FPS, calor o batería de un teléfono real.
Las comparaciones anteriores, sin fences, conservan sus dos FAIL independientes
de cierre. Compartir la medición por sí solo no acredita una aceleración global.

35 nuevas unitarias cubren fences, medición compartida, prueba del lector y
texturas. Los originales se mantienen. Batería definitiva:3.680 unitarias
en300 archivos, build y105 Python PASS;533 casos E2E censados.

Comparación GPU independiente: cinco poses, RGBA exacto, dimensiones y
viewport iguales, cero errores GL y una textura frente a dos. La página
sintética contiene zonas RGB; no constituye una medición del teléfono.
El primer diagnóstico queda FAIL: leyó con PIXEL_PACK_BUFFER enlazado y
obtuvo INVALID_OPERATION/píxeles cero. La segunda versión del método
desenlaza y restaura ese buffer sólo durante la lectura. Ambos se conservan.

Siete recorridos originales locales:seis PASS y un FAIL en el regreso
nativo a393px: cierre3,894 s, pero ninguna muestra de inserción nativa.
No se relajan sus aserciones ni30 s/8 s. Un diagnóstico posterior con
observación de las puertas de entrega pasa18,8 s; no reproduce ni explica
el fallo y no sustituye el resultado original. El build diagnóstico no
genera sw.js y conserva el error de registro offline propio del método.
El fallo nativo y el rendimiento general siguen pendientes.

## Publicación114

Fuente `140a6a3bc59251899db3cce4d0144753c8714a2e`; Pages
`bed38881fc6fe7f48a78a1dd1b1b48eb9f4e0466`. Main público
`assets/main-DS4oPXGQ.js`,615.677 B, SHA256
`46de45ef905be48c7b224960b2aff6ca2c1e211a592bab9e97652fe83236580d`.
Grafo HTTP32 y shell96 exactos. Dos intentos de pin previos capturaron
todavía el index113 durante la publicación de Pages; se conservan FAIL.
El tercero comprueba index/main114 exactos.

Web32 casos:30 auditorías estrictas PASS; editor móvil y navegación PDF
apaisada terminan sus aserciones funcionales, pero sus auditorías quedan
FAIL por capturas HTTP200/0 B de nogal. Las trazas registran Content-Length
correcto y transferencias completas; eso no prueba los bytes del blob.
Los dos regresos nativos públicos pasan:4,777 y4,271 s desde Back, cinco
muestras cada uno, sin relajar30 s/8 s. No sustituyen el FAIL local.

Un diagnóstico adicional observa el blob recibido por la app y su bitmap
sin sustituir respuestas. Los dos recorridos pasan, con209.252/151.604 B,
SHA256 exactos y1024×1024 al decodificar. No reproduce ni explica las
capturas vacías originales. Método1 conserva un error de importación;
método2 conserva un timeout90 s del editor por dirigirse a la raíz del
dominio; método3 corrige la URL a /inhouse-read/ y conserva los límites.

Offline: bytes/progreso, portada y cierre durante primera portada PASS.
Los primeros cuatro métodos fallaron antes de arrancar por ESM C:/.
Copias nuevas cambian sólo a file:/// y destino de evidencia. La comprobación
de papel anterior conserva un FAIL porque esperaba dos mediciones en blanco.
Un diagnóstico nuevo exige una para blanco, dos para los otros cuatro temas
y hashes de píxeles idénticos; PASS. No se modifica el original ni sus
aserciones restantes. Estas comprobaciones usan el service worker real.

APK1.1.8/code21 descargado otra vez:78.531.695 B, firma/certificado/hash
exactos, assets/public contiene sólo loader2.107 B y cordova. No se
reconstruye un binario sin cambios nativos. Run nuevo38088872659: cinco
estados de barras/insets/lectura/retorno del APK público PASS; ZIP original
autenticado9.354.536 B y auditoría independiente PASS. Google acepta la
petición; no se acredita una cuenta humana autenticada.
CI114 completa38088707648:531/533 PASS y dos regresos nativos FAIL,
también fallidos en retry. Once ZIP autenticados, doce jobs,535 intentos
y cero incidencias de colección. Las cuatro familias de voces con pesos
reales pasan; Supertonic ejecuta sus220 perfiles, sin omisiones ni retries.
Se conservan los cuatro intentos nativos fallidos y todos sus plazos.

## Retirada del control de cola en115

La observación posterior de fences registra esperas de1,41–2,9 s durante
la salida y1,52 s en un zoom de cierre. Los dos diagnósticos pasan, pero
la espera desplaza trabajo y no acredita una mejora del recorrido completo.
Los originales CI llegan a Back a28,22/26,96/26,83 s; el retry alineado
falla antes de mostrar la portada. No se atribuye todo el tiempo al cierre.
Por ello115 retira la integración del control de cola y conserva únicamente
el recurso compartido de página que mantiene los píxeles exactos.
[Continuación115](performance-1816.md).

## Catálogo de voces

Se conservan39 Piper y diez personas Supertonic en220 perfiles de los
22 idiomas actualmente ofrecidos. No se cuentan perfiles lingüísticos,
calidades o cambios de tono como personas nuevas. La búsqueda primaria
confirma otras voces Piper polacas CC0:
[Darkman](https://huggingface.co/rhasspy/piper-voices/blob/main/pl/pl_PL/darkman/medium/MODEL_CARD),
[MC Speech](https://huggingface.co/rhasspy/piper-voices/blob/d5de91c972ba5a13cea0e77a63fda1623faac2c1/pl/pl_PL/mc_speech/medium/MODEL_CARD)
y la neerlandesa CC0
[Ronnie](https://huggingface.co/rhasspy/piper-voices/blob/main/nl/nl_NL/ronnie/medium/MODEL_CARD).
Esos idiomas ya tienen diez perfiles de personas distintas del pack
Supertonic. Sus pesos adicionales no se han descargado ni sintetizado en
esta continuación, y no se incorporan ni anuncian como verificados.
Rohan hindi usa espeak, pero su ficha remite a una licencia propia de
IndicTTS; no se infiere permiso de los metadatos generales del repositorio.
Siguen pendientes variantes regionales sin dos o tres personas compatibles
comprobadas, y las candidatas pinyin descritas en el informe113.
