# Web 1.7.104: evitar reinicios intermedios al devolver el libro

La medicion original393 de103 conserva cierre5316ms: al crecer el canvas
para insertar el libro se hacen tres resets (altura0, ancho786, altura1688).
El reset vacio tarda186ms en ese diagnostico. Al volver a la sala, ambas
dimensiones se reducen a589x1174. No se atribuye el falloCI a una unica causa.

La nueva politica bounded evita el reset vacio cuando ambos ejes crecen:
el buffer intermedio no supera la asignacion final que ya es necesaria.
Los cambios cruzados conservan staging, y la API y controles originales
siguen intactos. El cache nativo tambien omite dimensiones fisicas que
no cambian. Tamano final, viewport/floor, DPR, modelos, luces y materiales
no cambian. No se altera la duracion ni se salta ninguna fase de animacion.

68/68 focales PASS, nueve nuevos. La fuente103 conserva12/20 en el control
con esos nuevos casos: ocho reproducen los resets, uno ya pasa.
El primer ensayo focal conserva64/66: dos nuevos assertions de viewport
estaban definidos con dos coordenadas en lugar de cuatro; se corrige el
harness, no el runtime ni los originales.18 pares de pixels WebGL2 exactos
PASS entre cache103 y104: alpha, tres capas, crecimiento/reduccion, DPR2/1.5
y sala393 fraccional. Observer nativo reenvia receiver/args/return sin
readbacks dentro de compose. Los readbacks de calidad ocurren despues.
No hay medicion de FPS/temperatura/bateria en telefono fisico.

Regresos originales SwiftShader y bateria completa en curso; publicacion,
web real, APK publico y CI104 pendientes.

Originales SwiftShader2/2 PASS, cero retries: cierres7376,2/7194,8ms.
Esta tanda no demuestra una mejora de duracion frente al diagnostico103.
El diagnostico mas detallado104 sigue pendiente; los tiempos varian.

Bateria local final PASS:3576 unitarias/291 archivos, build y92 Python.
Los hashes de fuentes antes/despues coinciden. Censo526 E2E listado
(no ejecutado por ese comando); la ejecucion completa corresponde a CI104.

Publicado e2c05bb11500be6a761b6364090ecee58b0f30d2; Pages
9a73343c125aa3c242d6c38066f0279bf9dcddb6. HTTP32/shell96 PASS.
Main610099B/SHA256c962c29dfbcb3f7620b618e7a440b5403f18835a0eccbb3d3625785eab51b686.
Primer pin conserva FAIL por HTML CDN anterior; segundo pin104 exactoPASS.
APK descargado otra vez:1.1.7/codigo20, firma y loader2107B PASS.
El diagnostico despues conserva7252,9ms, frente5316ms antes: no se
afirma aceleracion total. El reset altura0 desaparece, cuatro setters
frente cinco; ambos ejes y los pixeles finales siguen iguales.
Los cinco originales publicos de edicion/gestos y regreso PASS sin retries.
Publicos restantes, offline4, locales7 y CI104 aun en ejecucion.

Tanda restante: catalogo5, Android Abrir con4, offline4 y locales7 PASS,
sin retries. El APK1.1.7 descargado conserva firma, SHA y loader2107B.
La auditoria estricta PDF conserva17/18: las18 pruebas funcionales pasan,
pero una captura de respuesta de walnut-surface devuelve0B en teardown.
Se conserva ese fallo; seis experimentos independientes reciben los bytes
exactos en Response.blob y pasan, sin sustituir el intento original.
CI104 conserva ambos cierres nativos FAIL tanto primero como en retry.
Otros shards completados PASS; UI6 y Supertonic siguen pendientes.

CI104 completa37560738081 FAIL:526 casos/528 intentos, dos retries,
cuatro intentos fallidos (390 y393, primero y retry).11 ZIP/12 jobs;
todos los otros shards y cuatro familias de voces reales PASS.
Snapshot002 preserva metadata original, reportes y digests autenticados.
