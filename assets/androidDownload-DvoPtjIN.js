import"./updater-DFKvq24W.js";const o="miguelcoxcaballero/inhouse-read",l=`https://raw.githubusercontent.com/${o}/main/updates/A.json`,i=document.getElementById("release-card");function c(e){if(!Number.isFinite(e))return"";const a=["B","KB","MB","GB"];let t=e,n=0;for(;t>=1024&&n<a.length-1;)t/=1024,n+=1;return`${t.toFixed(n===0?0:1)} ${a[n]}`}function d(e){try{return new Date(e).toLocaleDateString("es-ES",{day:"numeric",month:"long",year:"numeric"})}catch{return""}}function u(e){const a=e.assets?.find(t=>t.name.endsWith(".apk"));if(!a){r("La última versión no tiene APK.");return}i.innerHTML=`
    <div class="dl-version">
      <span class="dl-version-tag">${s(e.tag_name)} · A</span>
      <span class="dl-version-date">${s(d(e.published_at))}</span>
    </div>
    <a class="dl-button" href="${p(a.browser_download_url)}">
      <svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M12 3v12m0 0l-4-4m4 4l4-4M4 19h16"/>
      </svg>
      Descargar APK · ${s(c(a.size))}
    </a>
    <p class="dl-filename">${s(a.name)}</p>
    <a class="dl-secondary-link" href="https://github.com/${o}/releases/tag/${encodeURIComponent(e.tag_name)}">
      Todas las versiones →
    </a>
  `}function r(e){i.innerHTML=`
    <p class="dl-status dl-status--error">${s(e)}</p>
    <a class="dl-secondary-link" href="https://github.com/${o}/releases">
      Ver releases en GitHub →
    </a>
  `}function s(e){return String(e??"").replace(/[&<>"']/g,a=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[a])}function p(e){return s(e)}async function m(){try{const e=await fetch(l+"?check="+Date.now(),{cache:"no-store"});if(!e.ok)throw new Error(e.status===403?"Límite de GitHub alcanzado. Reintenta en unos minutos.":`GitHub respondió ${e.status}`);const t=window.InhouseServicesUpdater.validateCatalog(await e.json(),"A",{repository:o}).latest;if(!t){r("Aún no hay versiones A.");return}const n=new URL(t.apkUrl).pathname.split("/");u({tag_name:decodeURIComponent(n.at(-2)),published_at:t.releasedAt,assets:[{name:decodeURIComponent(n.at(-1)),size:t.apkSizeBytes,browser_download_url:t.apkUrl}]})}catch(e){console.error("No se pudo consultar el último release:",e),r("No se pudo consultar la última versión.")}}m();
//# sourceMappingURL=androidDownload-DvoPtjIN.js.map
