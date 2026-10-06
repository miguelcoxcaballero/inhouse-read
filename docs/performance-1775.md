# Preparación de shaders de apertura — 1.7.75

## Cambios

La precompilación de Three enlazaba programas, pero sus uniformes seguían
consultándose de forma síncrona al dibujar una cara por primera vez.
La página cubierta prepara los uniformes de los mismos programas en turnos
idle antes de mostrar «Listo para leer». Espera el enlace sin consultas
prematuras y cancela al cambiar de página, selección o cerrar. Un driver
incompatible conserva el dibujo original. No añade renders, texturas,
geometría ni modifica iluminación, resolución, DPR o relojes.

La estantería publica el contador real de programas al terminar la preparación
idle del indicador y la profundidad. Antes conservaba el recuento anterior
hasta el siguiente dibujo: un resize parecía crear programas aunque el
contador de linkProgram no cambiase. La regresión reproduce 7→11 programas
con la misma cantidad de renders.

## Verificación enfocada antes de publicar

98 pruebas enfocadas en cinco archivos PASS. Las seis pruebas nuevas de
uniformes cubren preparación una vez por programa, enlace pendiente,
cancelación, límite de espera, fallo de reflexión y renderers incompatibles.
La nueva prueba del contador reproduce el fallo anterior y pasa con la
corrección. No se declara todavía aprobación de la batería completa, web
publicada o APK para esta versión. Tampoco un porcentaje de mejora o FPS
de un teléfono físico. Evidencia: `.animation.local/performance-1775/`.

## Batería local antes de publicar

Pasan 3.360 unitarias/262 archivos, build y 75 Python. El listado completo
conserva 524 identidades E2E; el listado no se cuenta como ejecución.
Pasan los siete recorridos gráficos originales al primer intento, sin
retries: cierre alineado 4.771,8 ms y fraccional 5.349,1 ms. La resolución
de los seis libros observados permanece en 1024 y el gesto de cámara
conserva 20 frames de compositor sin renders GPU adicionales.

Pasa el caso original Monstera en walnut y baggebo: 20→20 y 19→19 programas,
sin enlaces nuevos y con los draw calls originales. Persisten tareas de
resize de 389/256/372 ms; no se afirma ausencia total de bloqueos ni un
porcentaje global de mejora. La publicación y CI completos se verificarán
independientemente. Los límites originales no se ampliaron.

## Publicación original y batería completa

La fuente `7ebfec5` se publicó en Pages `b18aafc`. La descarga HTTP real
verificó 32 módulos y 96 entradas offline. Pasaron los tres recorridos
públicos de editor y contratos nativos, el lector PDF offline en cinco
temas y su encoder de portada sin fallback. El APK público 1.1.4/code17
conservó su SHA256 y un loader de 2.089 bytes, igual al archivo de Git.

La tanda pública PDF mantiene 16 PASS y dos FAIL de la auditoría HTTP:
Playwright exportó vacía una textura walnut tras recargar, aunque su
traza registra la transferencia completa y la descarga HTTP independiente
coincide con Git. Las aserciones de lectura retornaron sin error, pero esos
dos casos no se cuentan como aprobados. No se alteraron sus pruebas.

La batería original [37385382097](https://github.com/miguelcoxcaballero/inhouse-read/actions/runs/37385382097)
terminó FAILED. Se conservan los 11 ZIP con digest autenticado y los logs
de 12 jobs: 524 identidades, 526 intentos, dos retries y cuatro intentos
fallidos. Sólo UI3 falla: los dos contratos nativos exceden 8 s al abrir;
el PDF ya está preparado y la última captura los sitúa en `zooming`.
Los cuatro jobs de voces reales, las unitarias y los otros cinco grupos UI
pasan. El contador Monstera corregido pasa también en el CI original.
No se afirma aprobación global.

Evidencia de esta fuente: `.animation.local/performance-1775/`, incluida
`ci-original-37385382097-attempt1/snapshot-001/summary.json`.

## Integraciones posteriores: lámparas y catálogo IKEA

Se conservan las correcciones entrantes hasta `1864695`, sin sobrescribir
su trabajo. La fuente integrada pasa 3.373 unitarias/263 archivos, build
y 75 Python, con los límites originales. Su censo E2E contiene 524 casos;
el censo no es ejecución. Pages `be4417b` y el main `main-CsJlJK33.js`
coinciden por HTTP con Git: SHA256
`93f341dbd131c934d2afe2fc4e0326f21de4db3966becef7376092420d4006fb`.
Se verifican 32 módulos, 96 entradas offline y el APK/loader descargados.

La comprobación HTTP de la fuente intermedia `66ec238` mantiene su FAIL:
otra publicación cambió el alias PDF mientras se descargaban sus archivos.
La fuente nueva tiene un namespace separado y se verificó contra el índice
que realmente sirve la web. La rama Pages ya conserva los chunks antiguos;
no se añadió un mecanismo duplicado ni se declaró corrupción de caché.

La batería integrada aún requiere su cierre. Sus logs originales disponibles
conservan timeouts de cierre nativo y un caso flaky de resaltado EPUB al
reanudar. No se contabilizan como PASS por haber pasado en un retry.
Evidencia: `.animation.local/performance-1775-catalog/`.
