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
que acredite mejora sostenida. Publicación y comprobaciones públicas
pendientes. Los errores de
método y los fallos funcionales/auditorías114 se conservan, sin reintentar
los originales ni cambiar sus plazos.
