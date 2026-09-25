# Handoff: home screen — estantería animada con plantas

Este documento es el contrato para implementar la pieza visual pendiente de
**Inhouse Read**: el home screen debe ser una estantería ilustrada con
plantas (no un grid/lista moderna), donde los libros se ven de canto, y al
tocar uno debe animarse saliendo de la estantería y girando para mostrar la
portada antes de abrirse. Es la pieza diferencial de la app — tómate el
tiempo necesario.

El resto de la app (parsing de PDF/EPUB/MOBI, recientes, Drive, tests, CI,
deploy a GitHub Pages) ya está terminado y funcionando. Esta pieza es la
única que falta y se integra sin tocar el resto del código.

## Dónde vive hoy (placeholder a sustituir)

- `src/js/bookshelf.js` — implementación placeholder actual: un grid simple
  de "lomos" de libro. Cumple ya el contrato de abajo, así que la app
  funciona de extremo a extremo mientras curras en la versión definitiva.
- `src/css/bookshelf.css` — estilos del placeholder.
- `src/js/app.js` — quien llama a `renderBookshelf(...)` (import desde
  `./bookshelf.js`) y quien consume su valor de retorno. **No deberías
  necesitar tocar `app.js`** si respetas el contrato tal cual.

## Contrato que debe cumplir la nueva implementación

```js
// src/js/bookshelf.js
export function renderBookshelf(container, {
  books,            // BookRecord[] — ver src/js/library-store.js, ya ordenados por lastOpenedAt desc
  onOpenBook,       // (book: BookRecord) => void — llamar cuando el usuario elige un libro
  onPickLocalFile,  // () => void — llamar cuando el usuario pulsa "elegir de mi dispositivo"
  onOpenDrive,      // () => void — llamar cuando el usuario pulsa "abrir de Drive"
  driveAvailable    // boolean — si Drive está configurado (ver README, sección Google Drive)
}) {
  // ...
  return {
    refresh(books) {},  // app.js lo llama cuando cambia la lista de recientes (nuevo libro abierto, progreso actualizado)
    destroy() {}         // app.js lo llama al desmontar el home (p.ej. al entrar al lector)
  }
}
```

`BookRecord` (forma real, ver JSDoc en `library-store.js`):
```ts
{
  id: string
  title: string
  author?: string
  format: 'PDF' | 'EPUB' | 'MOBI' | 'AZW3' | 'FB2' | 'CBZ'
  sourceType: 'local' | 'drive'
  cover?: Blob            // portada ya extraída si se pudo (puede faltar)
  addedAt: number         // epoch ms
  lastOpenedAt: number    // epoch ms
  progressFraction: number // 0..1
}
```

**Importante sobre `onOpenBook`**: para libros con `sourceType: 'local'`, el
`File` original ya no existe en memoria entre sesiones (los navegadores no
permiten persistir un File real). El home screen NO tiene el contenido del
archivo — solo sus metadatos. Cuando el usuario toca un libro `local` que no
es el que acaba de abrir en esta misma sesión, `app.js` debe volver a pedirle
el archivo (con un `<input type=file>` pre-armado y un mensaje tipo "vuelve
a seleccionar {title} para continuar"). Esto ya está resuelto en
`app.js::openBookRecord()` — no es responsabilidad de la estantería, solo
ten en cuenta que `onOpenBook(book)` puede tardar en resolver o no llegar a
abrir nada si el usuario cancela el picker.

## Especificación visual (animación)

1. **Estado estantería**: los libros se muestran de canto (spine), como en
   una estantería real, distribuidos en 1-3 baldas según cuántos haya,
   intercalados con macetas/plantas decorativas (SVG ilustrado, no fotos).
   Usa el ancho del lomo para insinuar el grosor/formato del libro si
   quieres (opcional, no crítico).
2. **Tap en un libro** → secuencia animada (recomendado: CSS 3D transforms
   con `transform-style: preserve-3d` + `perspective` en el contenedor):
   a. El libro "sale" de la balda (translateY/scale hacia el centro/frente).
   b. Gira sobre su eje Y (`rotateY`) hasta mostrar la portada completa
      (si no hay `cover` en el BookRecord, usa un placeholder de portada
      generado con los tokens de marca — ver abajo).
   c. Al terminar el giro, dispara `onOpenBook(book)` (el lector se monta
      encima o la estantería se desmonta — decide tú la coreografía exacta,
      pero no bloquees el tap con la animación: debe sentirse instantáneo
      al tacto y la animación de salida puede seguir corriendo mientras el
      lector ya está cargando de fondo).
3. Gestos: tap es suficiente. No hace falta drag/swipe en el home.
4. Debe funcionar bien en móvil real (mobile-first): pensado para viewport
   ~360-430px de ancho, con zonas táctiles ≥44px, sin depender de hover.

## Tokens de diseño (heredados de Inhouse Notes — reutilízalos literalmente)

Ya están cargados en `src/css/tokens.css`, disponibles como custom
properties de `:root`. Los más relevantes para esta pieza:

```css
--bg-primary: #f5f5f0;      /* crema — fondo de la estantería */
--bg-secondary: #ffffff;
--text-primary: #1a1a1a;
--text-secondary: #555555;
--accent-read: #2f6b4f;     /* verde bosque — acento de producto de Read */
--accent-read-soft: rgba(47, 107, 79, 0.08);
--wood: #8b5e3c;            /* marrón madera — para las baldas */
--wood-dark: #6b4728;
--shadow-soft: 0 2px 20px rgba(0, 0, 0, 0.08);
--shadow-medium: 0 4px 30px rgba(0, 0, 0, 0.12);
--radius-sm: 8px; --radius-md: 12px; --radius-lg: 16px;
--ease: cubic-bezier(0.4, 0, 0.2, 1);
--f-logo: 'Comfortaa', cursive;  /* logo/títulos destacados */
--f-body: 'DM Sans', sans-serif; /* todo lo demás */
```
Soporta dark mode vía `[data-theme="dark"]` en `<html>` (ya wireado en
`app.js`) — todos estos tokens cambian de valor automáticamente, así que
usa siempre `var(--token)`, nunca colores hardcodeados, para que la
estantería se vea bien en ambos temas.

Iconografía del resto de la app: SVG inline dibujado a mano (sin librería de
iconos), mismo criterio que Inhouse Notes. Para las plantas/macetas, ilustra
tú en SVG inline con esta misma paleta (verdes derivados de `--accent-read`,
marrones derivados de `--wood`) para que no desentone.

## Dónde se monta

En `index.html` existe:
```html
<section id="home-screen" class="screen" data-screen="home">
  <div id="bookshelf-root"></div>
</section>
```
`app.js` llama `renderBookshelf(document.getElementById('bookshelf-root'), {...})`
al arrancar y cada vez que cambian los recientes. El contenedor ya ocupa
todo el `#home-screen` (ver `src/css/app.css`, clase `.screen`) — puedes
asumir que tienes el viewport completo disponible bajo el header.

## Qué NO es tu responsabilidad aquí

- Parsing de PDF/EPUB/MOBI (`src/js/readers/*`) — ya funciona.
- Persistencia de recientes (`src/js/library-store.js`) — ya funciona.
- Drive / file picker nativo — ya funciona, tú solo disparas los callbacks.
- El propio lector (pantalla que se abre tras el giro) — pantalla aparte,
  ya implementada.

## Cómo probar en local mientras desarrollas

```bash
npm install
npm run dev
```
Abre `http://localhost:5173`. Usa el botón "📂 Elegir archivo" del
placeholder actual para meter un par de libros de prueba y ver `books`
poblado de verdad (con progreso, formato, etc.) mientras desarrollas la
estantería.

## Tests a mantener/añadir

No hay tests unitarios del placeholder actual (es solo DOM/visual, de bajo
valor testear su HTML a mano). Si la nueva versión tiene lógica no-trivial
separable del DOM (p.ej. cálculo de distribución de libros en baldas, o el
cálculo de qué frame de la animación toca), vale la pena extraerla a una
función pura testeable en `src/js/bookshelf-layout.js` + su test en
`tests/unit/`, siguiendo el mismo patrón que `src/js/gestures.js` /
`tests/unit/gestures.test.js` (lógica pura separada del wiring a DOM).

Si tocas algo fuera de `bookshelf.js`/`bookshelf.css`/`bookshelf-*.js`,
avisa explícitamente — el resto del árbol se considera estable e integrado
con CI (`.github/workflows/production-checks.yml` corre `npm test` en cada
push/PR).
