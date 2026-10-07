# Web 1.7.102: reserva pequena durante el cierre del libro

Las trazas de1.7.100 conservan reajustes de altura entre el zoom, el
marcapaginas y el cierre de la portada. Ademas del margen horizontal16px,
se conserva como maximo128 filas vacias, solo si la reserva anterior no
supera384 filas logicas y sus dimensiones fisicas/DPR siguen intactos.
No se retiene un framebuffer del tamano de la pagina ampliada. El maximo
asignado no aumenta: se prolonga brevemente una reserva que ya existia.

El viewport GL conserva su tamano original. Sus pixeles estan en la parte
inferior del buffer; el canvas nativo sube el margen equivalente. Las
exportaciones completas y parciales compensan ese margen y conservan la
posicion y escala originales. Geometria, luces, materiales, texturas,
resolucion y tiempos/pasos de la animacion mantienen sus valores anteriores.

Prototipo:90 pares RGBA exactos PASS,30 acabados/poses,30 pagina con texto
e imagen y30 copia parcial desconectada. Se exige usar una reserva mayor
real, no solo comparar un fallback. El primer ensayo de copia parcial
fallo porque buscaba el canvas nativo dentro del host; este se presenta
en su padre. Ese fallo de harness se conserva, sin comparaciones validas.

35 pruebas enfocadas PASS:19 nuevas y16 anteriores. Solo se actualiza la
inyeccion de la dependencia en el harness de configureFrame; ninguna
assertion original cambia. El contrato numerico anterior del helper de
ancho sigue disponible y mantiene todos sus casos originales.
Bateria completa PASS:3.555 unitarias en291 archivos, build y92 Python.
Censo526 E2E listado; el listado no acredita ejecucion completa.
Otros90 pares RGBA con la fuente integrada PASS, con hashes de procedencia.
Los dos E2E nativos originales con SwiftShader PASS en su primer intento,
sin retries y con esperas30s/8s intactas. Diagnostico original independiente:
cierre5.970,2ms. No se observa ningun reajuste del canvas activo del libro;
los cinco reajustes restantes pertenecen a otros canvases. Ese tiempo no
mejora los5.710,2ms del diagnostico100; no se acredita mejora total ni
rendimiento en un telefono fisico. Publicada desde56c4beeb35b7aabcd13563aec62c254d0e593206.
Pages9ef993fc70a8480dc9a96a6926ae0bffa95188cc, main609.735B/SHA256
fa293695fd4efc1e51de754e483e05a43d606906faec56966459769f314b21c5.
HTTP32/shell96,32/32 publicos estrictos, tres recorridos offline y los
siete originales locales PASS, sin retries. Los32 publicos incluyen18 PDF,
cinco edicion/animacion, cinco catalogo/plantas/luces y cuatro Abrir con.
Se vuelve a descargar el APK1.1.7:78.531.659B, firma y loader2.107B PASS.
CI102 original sigue en curso; su grupo de cierres concluye success,
aun falta auditar sus informes originales para descartar reintentos.
APK1.1.7/codigo20 permanece vigente y verificado; este cambio es web.

## Primer informe original de CI102

267 casos/267 intentos disponibles, cero retries y cero intentos fallidos.
Los dos regresos originales pasan: cierre6.468,2ms (390px) y6.324,7ms
(393px); duracion total25.006/24.875ms. Sigue faltando UI6 y Supertonic
en este snapshot parcial, no se acredita la bateria completa aun.
