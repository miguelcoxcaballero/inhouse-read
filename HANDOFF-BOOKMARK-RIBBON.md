> **Encargo activo.** A diferencia de HANDOFF-BOOKSHELF.md (ya completado), esto
> es trabajo pendiente de verdad: un marcapáginas/cinta que asome por arriba
> de cada lomo, mostrando visualmente el progreso de lectura. Pedido textual
> del usuario: *"a bookmark should popup out of them from the top so that I
> can see the progress I have in each one"*.

## Contexto — lee primero `src/js/bookshelf.js`

La cabecera de ese archivo (líneas 1-92) documenta el sistema completo:
paleta, madera, lomos deterministas, plantas, animación de giro, rendimiento,
táctil. Tu trabajo se integra en ese mismo sistema, no lo sustituye.

Lo que ya existe y **no hay que tocar**:
- `src/js/bookshelf-layout.js::spineStyleFor()` — grosor/color/altura/textura
  del lomo, determinista por `seedFor(book)`. **El grosor ya usa datos reales**
  (`book.pageCount` para PDF, `book.sizeBytes` como fallback para EPUB/MOBI) —
  eso se acaba de conectar en `app.js` (busca `pageCount:` en `openFile()`),
  ya no depende solo del hash. No hace falta ningún trabajo adicional de tu
  parte para esto, ya está resuelto.
- `progressOf(book)` en `bookshelf-layout.js` — progreso 0..1, ya usado por el
  indicador actual `.ihr-spine__progress` (una cinta fina de 2.5px al pie del
  lomo, ver `bookshelf.css`). **Decide tú** si el marcapáginas nuevo sustituye
  a ese indicador o convive con él — mi criterio sería sustituirlo (un
  marcapáginas real es más elegante y menos "barra de carga"), pero es tu
  llamada de diseño.
- La paleta (`SPINE_PALETTE` en `bookshelf-layout.js`) ya usa tonos tipo
  cuero/tela envejecida (burdeos, ocre, terracota, oliva, pizarra...) — no es
  la paleta plana que el pedido original sugería. Ya añadí además una capa de
  grano/ruido sutil al fondo del lomo (`background-blend-mode: multiply` en
  `.ihr-spine` dentro de `bookshelf.css`) para que no se vea como una
  pegatina de color plano. Si crees que hace falta más "vintage" (más
  variedad de tonos, un desgaste más marcado en los cantos, etc.), adelante,
  pero no es el foco de este encargo — el foco es el marcapáginas.
- La curva del lomo (gradiente en `.ihr-spine`) y la tipografía del título
  (`Playfair Display` + sombra tipo grabado en `.ihr-spine__title`) ya están
  hechas. No las toques salvo que el marcapáginas choque visualmente con
  ellas.

## La restricción técnica real que tienes que resolver

`.ihr-spine` (el `<button>` del lomo) tiene `overflow: hidden` — **imprescindible**
para que el gradiente de fondo (full-bleed) respete el `border-radius`
redondeado de las esquinas, si no se ven las esquinas del gradiente
sobresaliendo cuadradas por fuera del borde redondeado.

Un marcapáginas que "asome por arriba" del lomo, por definición, tiene que
pintarse **fuera** de esa caja — y `overflow:hidden` lo recortaría si es hijo
directo del botón. Necesitas envolver el lomo en un contenedor SIN
`overflow:hidden` que sí deje asomar el marcapáginas, manteniendo el
`overflow:hidden` solo en el `<button>` interior para su propio fondo.

**Esto toca la animación de apertura** (`openBook()` en `bookshelf.js`, la
que hace `spineEl.getBoundingClientRect()` para el efecto FLIP del giro 3D).
Ahora mismo `buildSpine()` devuelve directamente el `<button class="ihr-spine">`
y ese es el nodo que:
1. Recibe el listener de click (`node.addEventListener('click', () => openBook(node, item))`).
2. Se usa como `spineEl` en `openBook(spineEl, item)` para medir `rect = spineEl.getBoundingClientRect()`
   y calcular la geometría de la animación (posición de origen del vuelo del libro).
3. Recibe la clase `is-away` mientras la portada está fuera (`spineEl.classList.add('is-away')`)
   y `visibility:hidden` vía esa clase.

Si envuelves el lomo en un `<span class="ihr-spine-slot">` (o el nombre que
prefieras) que contenga `<button class="ihr-spine">...</button>` +
`<span class="ihr-spine__bookmark">`, tienes dos opciones:
- (a) Seguir midiendo/clickando sobre el `<button>` interior (el rect de la
  animación no cambia, ya que el botón sigue teniendo el mismo tamaño
  visual) y el wrapper solo existe para no recortar el marcapáginas. Más
  simple, probablemente lo correcto.
- (b) Mover el listener/medición al wrapper. Solo si (a) no te cuadra por
  algún motivo de layout (p.ej. si el wrapper necesita un tamaño distinto al
  botón por el propio marcapáginas).

Cualquiera que elijas, **verifica que la animación de giro sigue arrancando
exactamente pegada al lomo de origen** (es una técnica FLIP: el libro nace
con el tamaño/posición exactos del lomo y crece hacia el centro) — es la
pieza más delicada de todo el componente y la que más fácil se rompe con un
cambio de estructura DOM que altere sutilmente el `getBoundingClientRect()`
del nodo medido.

También revisa el `costOf`/empaquetado en `bookshelf-layout.js::layoutShelves()`:
el ancho usado por cada lomo en la balda (`item.width`) no debería cambiar
por culpa del wrapper (el marcapáginas no debe ensanchar el hueco que ocupa
el libro en la balda — se pinta por ENCIMA del lomo de arriba, no a un lado).

## Semántica de progreso pedida

"Popup out... so that I can see the progress" — la lectura más legible: la
**longitura visible** del marcapáginas que asoma por encima del lomo es
proporcional al progreso (0% = apenas visible/nada, 100% = asoma bastante).
Es una convención de UI, no un intento de realismo físico (en la vida real
un marcapáginas no delata la página por cuánto asoma) — pero es lo que hace
que "ver el progreso de un vistazo" sea cierto. Alternativas razonables si
prefieres otra lectura: color que se satura con el progreso, o longitud fija
pero con un tono que cambia de "recién empezado" a "casi terminado". Tu
criterio, mientras el resultado comunique progreso de un vistazo sin abrir
el libro.

No muestres marcapáginas para `progressOf(book) === 0` (libro añadido pero
nunca abierto) — no hay nada que marcar todavía.

## Dónde probar sin tocar IndexedDB

`demo/bookshelf.html` es exactamente para esto — un banco de pruebas con
estados de biblioteca sintéticos (vacía / pocos / muchos libros), sin
depender de haber abierto libros reales. `npm run dev` → abrir
`/inhouse-read/demo/bookshelf.html`. Si ese demo no genera libros con
distintos `progressFraction`, amplíalo (es tuyo, lo construiste tú).

## Tests

Sigue el patrón ya establecido: lógica pura (si hay alguna, p.ej. cálculo de
longitud del marcapáginas a partir del progreso) en `bookshelf-layout.js` +
test en `tests/unit/bookshelf-layout.test.js`; DOM/wiring en
`tests/unit/bookshelf.test.js` (17 tests ahora mismo, con jsdom + polyfill de
`Element.animate` en el propio `bookshelf.js::animate()` — revisa cómo los
tests existentes verifican la animación antes de escribir los tuyos, para no
depender de timers reales).

`npm run test:unit` debe seguir en verde (121 tests en todo el repo ahora
mismo, sin contar los tuyos nuevos) y `npm run build` debe seguir generando
`dist/` sin errores antes de dar esto por terminado.

## Qué NO toca esto

Nada de lectores (PDF.js/foliate-js), nada de Drive, nada de la carpeta local
(`local-folder-store.js`, recién añadido), nada del pipeline de Android/CI.
Si tocas algo fuera de `bookshelf.js` / `bookshelf-layout.js` / `bookshelf.css`
/ `demo/bookshelf.html` / sus tests, dilo explícitamente en tu resumen final.
