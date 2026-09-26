import"./base-DRMcTq8m.js";const r="miguelcoxcaballero/inhouse-read",l=`https://api.github.com/repos/${r}/releases/latest`,o=document.getElementById("release-card");function c(e){if(!Number.isFinite(e))return"";const t=["B","KB","MB","GB"];let a=e,s=0;for(;a>=1024&&s<t.length-1;)a/=1024,s+=1;return`${a.toFixed(s===0?0:1)} ${t[s]}`}function u(e){try{return new Date(e).toLocaleDateString("es-ES",{day:"numeric",month:"long",year:"numeric"})}catch{return""}}function d(e){const t=e.assets?.find(a=>a.name.endsWith(".apk"));if(!t){i("El último release no tiene ningún APK adjunto todavía.");return}o.innerHTML=`
    <div class="dl-version">
      <span class="dl-version-tag">${n(e.tag_name)}</span>
      <span class="dl-version-date">${n(u(e.published_at))}</span>
    </div>
    <a class="dl-button" href="${m(t.browser_download_url)}">
      <svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M12 3v12m0 0l-4-4m4 4l4-4M4 19h16"/>
      </svg>
      Descargar APK (${n(c(t.size))})
    </a>
    <p class="dl-filename">${n(t.name)}</p>
    <a class="dl-secondary-link" href="https://github.com/${r}/releases/tag/${encodeURIComponent(e.tag_name)}">
      Ver todos los releases en GitHub →
    </a>
  `}function i(e){o.innerHTML=`
    <p class="dl-status dl-status--error">${n(e)}</p>
    <a class="dl-secondary-link" href="https://github.com/${r}/releases">
      Ver los releases directamente en GitHub →
    </a>
  `}function n(e){return String(e??"").replace(/[&<>"']/g,t=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[t])}function m(e){return n(e)}async function p(){try{const e=await fetch(l,{headers:{Accept:"application/vnd.github+json"}});if(!e.ok)throw new Error(e.status===403?"Límite de peticiones a la API de GitHub alcanzado; reintenta en unos minutos.":`GitHub respondió ${e.status}`);const t=await e.json();d(t)}catch(e){console.error("No se pudo consultar el último release:",e),i("No se pudo consultar automáticamente la última versión.")}}p();
//# sourceMappingURL=androidDownload-C7DrLXqp.js.map
