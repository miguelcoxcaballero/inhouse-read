# Web1.7.106 candidata: enviar el compile inicial del libro al driver

La apertura ya tenia recorte nativo adaptativo; no se modifica. El costo
CI105 incluye el arranque y la extraccion: el primer390 pulsa Back27,52s
despues de comenzar, dejando unos2,5s del presupuesto total30s. En393
quedan4,6s. El timeout de prueba se inicia antes de finalizar la espera8s:
no es una medicion completa e independiente de un cierre de8s. Se conservan
ambos fallos y sus reintentos; no se amplia ningun limite ni se elimina fase.

El constructor del libro compilaba la escena sin flush. Ahora usa el mismo
compilePagePrograms que ya envia la pagina preparada: compile exacto y un
flush si devuelve materiales. No espera con finish, no agrega draws, ni
modifica material, geometria, DPR, camara o clock. La estanteria estatica y
los renderers con compile vacio conservan su ruta; errores conservan el
fallback de compilacion en el primer draw.

Focales37/37 PASS: cuatro nuevos. Primer intento34/37 conserva tres errores
del nuevo harness (make devuelve {view}, no view), corregidos sin tocar
originales. Control contra10534/37 reproduce tres ausencias del flush.
El prefijo original de los tests conserva su hash. Diagnostico393 completo
con deadlines originales PASS:10525,1s; candidato24,2s. No se considera
prueba de aceleracion sostenida. Los programas/reflejos conservan170
uniforms previos y40 en insercion; no se atribuye toda la lentitud a esto.

Bateria completa, originales locales, publicacion, web/APK/CI106 pendientes.

Bateria completa local3591/291, build y92 Python PASS, fuentes
antes/despues exactas. Censo526 listado no se cuenta como ejecucionE2E.

Siete originales locales PASS sin retries. Dos originales SwiftShader
PASS sin retries/deadlines30s/8s intactos:5537,8/7270,9ms de cierre.
La variacion no demuestra mejora sostenida; no se promete rendimiento
medido en telefono fisico. APK1.1.7 descargado otra vez: SHA/firma y
loader2107B PASS. CI106 y artefactos publicos pendientes.
