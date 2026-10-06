# Web 1.7.100: conservar margenes vacios pequenos durante el vuelo

El diagnostico del cierre en1.7.99 observa un reset de ancho de402,6ms
cuando el recorte cambia de390 a384px. La nueva reserva conserva como maximo
16 columnas logicas vacias si solo se reduce el ancho, la altura y el DPR
son identicos y el framebuffer real coincide con el tamano anterior.
Cambios grandes, dimensiones fraccionales, legado, camara completa y DPR
nuevo siguen la asignacion anterior. La proyeccion conserva el viewport
original; las columnas adicionales quedan transparentes. Se restaura el
viewport al volver a ampliarlo, aunque no haga falta redimensionar.
La escala CSS usa el ancho reservado para no estirar los pixeles.

41 pruebas enfocadas PASS (16 nuevas).60 pares RGBA exactos PASS contra
el modulo1.7.99:30 poses/acabados y30 con pagina/texto/imagen originales.
Se comprueba una reserva mayor real y la escala CSS correspondiente.
El experimento previo con marcapaginas registra30 iguales peroFAIL por
no activar la reserva; se conserva. Los dos primeros ensayos
comparaban una reserva retenida contra una liberada y registran FAIL por
un canal con delta2. Ambos fallos quedan conservados. Los dos siguientes
fallan por asumir una escala CSS1 en una pagina sin CSS. La comparacion
final utiliza el mismo estado de reserva en ambos modulos y comprueba la
escala CSS real; no convierte ninguno de los fallos anteriores en PASS. Ninguno se publico ni altero
las pruebas originales. No cambian materiales, geometria, luces, resolucion,
sombras, DPR ni formula original maxStep.

Bateria completa:3.528/3.528 unitarias en289 archivos, build y92 Python PASS.
Censo526 sin skips es listado, no ejecucion E2E. Fuentes/config/pruebas
protegidas antes/despues. Regresos originales de la fuente integrada,
publicacion/web real/offline y CI completa de1.7.100:pendientes. Todavia no se afirma
resuelto el limite8s de CI ni una mejora medida en el movil fisico.
APK1.1.7/codigo20 independiente sigue verificado y no requiere rebuild por
este cambio web. Pruebas APK/emulador y alcance en performance-1799.md.
