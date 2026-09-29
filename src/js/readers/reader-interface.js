const paths = {
  close:'M6 6l12 12M18 6L6 18',
  play:'m9 5 11 7-11 7Z', pause:'M8 5v14M16 5v14', stop:'M7 7h10v10H7Z',
  bookmark:'M6 3h12v18l-6-4-6 4Z', minus:'M5 12h14', plus:'M5 12h14M12 5v14'
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
      <button type="button" data-theme="sage" aria-label="Salvia"><i aria-hidden="true">Aa</i><span>Salvia</span></button>
    </div>
    <label class="reading-row reading-range-row" data-pdf-zoom><span>Zoom</span><input type="range" data-pref="zoom" min="70" max="200" step="10" aria-label="Zoom del PDF"><output data-output="zoom"></output></label>
    <div data-typography>
      <label class="reading-row"><span>Fuente</span><select data-pref="font" aria-label="Tipografía de lectura"><option value="book">Georgia</option><option value="classic">Palatino</option><option value="sans">Sans serif</option><option value="mono">Monoespaciada</option></select></label>
      <div class="reading-size">
        <button type="button" data-size-step="-1" aria-label="Reducir tamaño de letra">A<span aria-hidden="true">−</span></button>
        <input type="range" data-pref="fontSize" min="14" max="36" step="1" aria-label="Tamaño de letra">
        <button type="button" data-size-step="1" aria-label="Aumentar tamaño de letra">A<span aria-hidden="true">+</span></button>
        <output data-output="fontSize" aria-live="polite"></output>
      </div>
      <details class="reading-details"><summary>Espaciado y alineación</summary>
        <label class="reading-row reading-range-row"><span>Interlineado</span><input type="range" data-pref="lineHeight" min="1.2" max="2.4" step="0.1" aria-label="Interlineado"><output data-output="lineHeight"></output></label>
        <label class="reading-row reading-range-row"><span>Márgenes</span><input type="range" data-pref="margin" min="8" max="64" step="4" aria-label="Márgenes"><output data-output="margin"></output></label>
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
      <button type="button" id="reading-tab-history" role="tab" data-place-tab="history" aria-controls="reading-list-history">Recientes</button>
    </nav>
    <div id="reading-list-toc" role="tabpanel" aria-labelledby="reading-tab-toc" data-places="toc"><div data-toc class="reading-list"></div></div>
    <div id="reading-list-bookmarks" role="tabpanel" aria-labelledby="reading-tab-bookmarks" data-places="bookmarks" hidden><div data-bookmarks class="reading-list"></div></div>
    <div id="reading-list-history" role="tabpanel" aria-labelledby="reading-tab-history" data-places="history" hidden><p class="reading-hint">Vuelve a donde estabas antes de saltar.</p><div data-history class="reading-list"></div></div>
  </section>
  <section id="reading-audio" aria-label="Lectura en voz alta" hidden>
    <p id="reading-book-title" class="reading-audio-title"></p>
    <p class="reading-audio-caption">Desde tu página actual</p>
    <div class="reading-audio-controls"><button type="button" class="reading-play" data-play aria-label="Reproducir">${readerIcon('play')}</button><button type="button" class="reading-icon-button" data-stop aria-label="Detener" title="Detener">${readerIcon('stop')}</button></div>
    <p class="reading-audio-status" role="status">Lista para escuchar</p>
    <label class="reading-row reading-range-row"><span>Velocidad</span><input type="range" data-pref="rate" min="0.5" max="2" step="0.1" aria-label="Velocidad de voz"><output data-output="rate"></output></label>
    <label class="reading-row"><span>Voz</span><select data-pref="voice" aria-label="Voz de lectura"><option value="">Automática</option></select></label>
    <label class="reading-row"><span>Apagar en</span><select data-sleep aria-label="Temporizador de voz"><option value="0">No apagar</option><option value="15">15 minutos</option><option value="30">30 minutos</option><option value="60">1 hora</option></select></label>
  </section>
  <p class="reading-error" role="status"></p>`
