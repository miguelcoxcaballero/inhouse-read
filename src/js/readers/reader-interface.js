const paths = {
  close:'M6 6l12 12M18 6L6 18',
  play:'m9 5 11 7-11 7Z', pause:'M8 5v14M16 5v14', stop:'M7 7h10v10H7Z',
  bookmark:'M6 3h12v18l-6-4-6 4Z', minus:'M5 12h14', plus:'M5 12h14M12 5v14'
  , search:'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14ZM16 16l5 5', quote:'M4 5h7v7H5v3h4v4H4v-7Zm10 0h7v7h-6v3h4v4h-5v-7Z', prev:'m15 18-6-6 6-6', next:'m9 18 6-6-6-6'
}
export const readerIcon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[name] || paths.play}"/></svg>`

export const readerPanelMarkup = `
  <header class="reading-panel__header"><h2 id="reading-panel-title">Texto</h2><button type="button" class="reading-icon-button" data-close aria-label="Cerrar opciones de lectura">${readerIcon('close')}</button></header>
  <section id="reading-appearance" aria-label="Aspecto de lectura">
    <label class="reading-row" data-pdf><span>Vista del PDF</span><select data-pref="pdfMode" aria-label="Vista del PDF"><option value="original">Página original</option><option value="text">Texto adaptable</option></select></label>
    <p class="reading-hint" data-pdf-hint>Cambia a Texto adaptable para ajustar la letra.</p>
    <div class="reading-themes" role="group" aria-label="Color de lectura">
      <button type="button" data-theme="paper" aria-label="Papel"><i aria-hidden="true">Aa</i><span>Papel</span></button>
      <button type="button" data-theme="sepia" aria-label="Sepia"><i aria-hidden="true">Aa</i><span>Sepia</span></button>
      <button type="button" data-theme="night" aria-label="Noche"><i aria-hidden="true">Aa</i><span>Noche</span></button>
      <button type="button" data-theme="amoled" aria-label="AMOLED"><i aria-hidden="true">Aa</i><span>AMOLED</span></button>
      <button type="button" data-theme="sage" aria-label="Salvia"><i aria-hidden="true">Aa</i><span>Salvia</span></button>
    </div>
    <label class="reading-row reading-range-row" data-pdf-zoom><span>Zoom</span><input type="range" data-pref="zoom" min="70" max="200" step="10" aria-label="Zoom del PDF"><output data-output="zoom"></output></label>
    <label class="reading-row reading-range-row"><span>Brillo</span><input type="range" data-pref="brightness" min="50" max="120" step="1" aria-label="Brillo de lectura"><output data-output="brightness"></output></label>
    <div data-typography>
      <label class="reading-row"><span>Fuente</span><select data-pref="font" aria-label="Tipografía de lectura"><option value="book">Georgia</option><option value="classic">Palatino</option><option value="sans">Sans serif</option><option value="mono">Monoespaciada</option></select></label>
      <div class="reading-size">
        <button type="button" data-size-step="-1" aria-label="Reducir tamaño de letra">A<span aria-hidden="true">−</span></button>
        <input type="range" data-pref="fontSize" min="14" max="36" step="1" aria-label="Tamaño de letra">
        <button type="button" data-size-step="1" aria-label="Aumentar tamaño de letra">A<span aria-hidden="true">+</span></button>
        <output data-output="fontSize" aria-live="polite"></output>
      </div>
      <details class="reading-details"><summary>Espaciado y alineación</summary>
        <label class="reading-row"><span>Peso de la fuente</span><select data-pref="fontWeight" aria-label="Grosor de la fuente"><option value="400">Normal</option><option value="500">Medio</option><option value="600">Grueso</option></select></label>
        <label class="reading-row reading-range-row"><span>Interlineado</span><input type="range" data-pref="lineHeight" min="1.2" max="2.4" step="0.1" aria-label="Interlineado"><output data-output="lineHeight"></output></label>
        <label class="reading-row reading-range-row"><span>Márgenes</span><input type="range" data-pref="margin" min="0" max="64" step="4" aria-label="Márgenes"><output data-output="margin"></output></label>
        <label class="reading-row"><span>Alineación</span><select data-pref="align" aria-label="Alineación"><option value="start">A la izquierda</option><option value="justify">Justificada</option></select></label>
      </details>
    </div>
    <label class="reading-row" data-epub><span>Pasar el texto</span><select data-pref="flow" aria-label="Modo de desplazamiento"><option value="paginated">Por páginas</option><option value="scrolled">Deslizar</option></select></label>
    <button type="button" class="reading-text-button reading-reset" data-reset>Restablecer</button>
  </section>
  <section id="reading-navigation" aria-label="Contenido del libro" hidden>
    <div class="reading-position-row"><p class="reading-position" aria-live="polite"></p><button type="button" class="reading-icon-button" data-bookmark aria-label="Marcar esta página" title="Marcar esta página">${readerIcon('bookmark')}</button></div>
    <input class="reading-scrubber" type="range" min="0" max="100" step="0.1" data-progress aria-label="Progreso del libro">
    <div class="reading-progress-ends" aria-hidden="true"><span>Inicio</span><span>Final</span></div>
    <form class="reading-page-form" data-pdf><label>Ir a la página<input type="number" min="1" step="1" inputmode="numeric" aria-label="Ir a la página" required></label><button type="submit" class="reading-text-button">Ir</button></form>
    <nav class="reading-tabs" role="tablist" aria-label="Contenido">
      <button type="button" id="reading-tab-toc" role="tab" data-place-tab="toc" aria-controls="reading-list-toc">Índice</button>
      <button type="button" id="reading-tab-bookmarks" role="tab" data-place-tab="bookmarks" aria-controls="reading-list-bookmarks">Marcadores</button>
      <button type="button" id="reading-tab-quotes" role="tab" data-place-tab="quotes" aria-controls="reading-list-quotes">Citas</button>
      <button type="button" id="reading-tab-history" role="tab" data-place-tab="history" aria-controls="reading-list-history">Recientes</button>
    </nav>
    <div id="reading-list-toc" role="tabpanel" aria-labelledby="reading-tab-toc" data-places="toc"><div data-toc class="reading-list"></div></div>
    <div id="reading-list-bookmarks" role="tabpanel" aria-labelledby="reading-tab-bookmarks" data-places="bookmarks" hidden><div data-bookmarks class="reading-list"></div></div>
    <div id="reading-list-quotes" role="tabpanel" aria-labelledby="reading-tab-quotes" data-places="quotes" hidden><p class="reading-hint">Selecciona un fragmento y guárdalo con un color.</p><div class="reading-quote-colors" role="group" aria-label="Color del resaltado"><button type="button" data-quote-color="yellow" aria-label="Amarillo" aria-pressed="true"></button><button type="button" data-quote-color="green" aria-label="Verde" aria-pressed="false"></button><button type="button" data-quote-color="blue" aria-label="Azul" aria-pressed="false"></button><button type="button" data-quote-color="pink" aria-label="Rosa" aria-pressed="false"></button></div><button type="button" class="reading-text-button" data-save-quote>Guardar selección como cita</button><div data-quotes class="reading-list"></div></div>
    <div id="reading-list-history" role="tabpanel" aria-labelledby="reading-tab-history" data-places="history" hidden><p class="reading-hint">Vuelve a donde estabas antes de saltar.</p><div data-history class="reading-list"></div></div>
  </section>
  <section id="reading-search" aria-label="Buscar en el libro" hidden>
    <form class="reading-search-form" data-search-form><label>Buscar en el libro<input type="search" data-search-query placeholder="Palabra o frase" enterkeyhint="search" required></label><button type="submit" class="reading-text-button">Buscar</button></form>
    <p class="reading-hint" data-search-status></p><div class="reading-list" data-search-results></div>
  </section>
  <section id="reading-more" aria-label="Más opciones" hidden>
    <button type="button" class="reading-menu-row" id="reader-toc-shortcut" aria-label="Índice, marcadores y citas">Índice, marcadores y citas</button>
    <button type="button" class="reading-menu-row" id="reader-rotate">Girar pantalla</button>
    <button type="button" class="reading-menu-row" data-about>Acerca del documento</button>
    <button type="button" class="reading-menu-row" data-share>Compartir archivo</button>
    <button type="button" class="reading-menu-row" data-kids aria-pressed="false">Modo infantil <span>Oculta controles y enlaces del libro</span></button>
  </section>
  <section id="reading-about" aria-label="Acerca del documento" hidden><p class="reading-document-about" id="reading-document-about"></p></section>
  <section id="reading-audio" aria-label="Lectura en voz alta" hidden>
    <p id="reading-book-title" class="reading-audio-title"></p>
    <p class="reading-audio-caption">Desde tu página actual</p>
    <div class="reading-audio-controls"><button type="button" class="reading-icon-button" data-audio-prev aria-label="Anterior">${readerIcon('prev')}</button><button type="button" class="reading-play" data-play aria-label="Reproducir">${readerIcon('play')}</button><button type="button" class="reading-icon-button" data-audio-next aria-label="Siguiente">${readerIcon('next')}</button><button type="button" class="reading-icon-button" data-stop aria-label="Detener" title="Detener">${readerIcon('stop')}</button></div>
    <p class="reading-audio-status" role="status">Lista para escuchar</p>
    <div class="reading-neural-offer" data-neural-offer hidden></div>
    <label class="reading-row reading-range-row"><span>Velocidad</span><input type="range" data-pref="rate" min="0.5" max="2" step="0.1" aria-label="Velocidad de voz"><output data-output="rate"></output></label>
    <label class="reading-row"><span>Voz</span><select data-pref="voice" aria-label="Voz de lectura"><option value="">Automática · mejor voz natural</option></select></label>
    <div class="reading-voice-info" data-voice-info hidden><p class="reading-hint"><span data-voice-auto></span> <span data-voice-better hidden>Hay voces gratuitas de mayor calidad que puedes instalar en el dispositivo.</span></p><button type="button" class="reading-text-button" data-voice-settings hidden>Descargar voces de mayor calidad</button></div>
    <section class="reading-neural" data-neural aria-labelledby="reading-neural-title" hidden>
      <h3 id="reading-neural-title" class="reading-neural__title">Voces naturales · sin conexión</h3>
      <p class="reading-hint" data-neural-note>Se descarga una vez (63 MB) y funciona sin internet.</p>
      <p class="reading-hint reading-neural__warning" data-neural-warning hidden><span data-neural-warning-text></span> <button type="button" class="reading-text-button" data-neural-retry>Volver a probar</button></p>
      <ul class="reading-neural__list" role="list" data-neural-list></ul>
      <p class="visually-hidden" role="status" aria-live="polite" data-neural-status></p>
    </section>
    <label class="reading-row"><span>Apagar en</span><select data-sleep aria-label="Temporizador de voz"><option value="0">No apagar</option><option value="15">15 minutos</option><option value="30">30 minutos</option><option value="60">1 hora</option></select></label>
    <label class="reading-row"><span>Leer notas al pie</span><input type="checkbox" data-voice-option="footnotes" aria-label="Leer notas al pie"></label>
    <label class="reading-row"><span>Voz multilingüe</span><input type="checkbox" data-voice-option="multilingual" aria-label="Voz multilingüe"></label>
    <label class="reading-row"><span>Omitir encabezados repetidos</span><input type="checkbox" data-voice-option="skipHeaders" aria-label="Omitir encabezados repetidos"></label>
  </section>
  <p class="reading-error" role="status"></p>`
