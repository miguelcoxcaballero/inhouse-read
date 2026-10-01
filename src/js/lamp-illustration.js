const SVG_NS = 'http://www.w3.org/2000/svg';

export function lampCatalogIllustration(id) {
  const shell = (drawing) => `<svg xmlns="${SVG_NS}" viewBox="0 0 100 100" aria-hidden="true" focusable="false" fill="none" stroke-linecap="round" stroke-linejoin="round">${drawing}</svg>`;
  if (id === 'mittled') return shell('<path fill="#e8e2d8" d="M8 20h84v8H8z"/><path fill="#b9bec1" stroke="#68727a" d="M28 28h44v7c0 9-44 9-44 0z"/><ellipse cx="50" cy="35" rx="22" ry="7" fill="#fff2cb" stroke="#68727a"/><path d="m35 49-10 27m25-24v27m15-30 10 27" stroke="#dcad51" stroke-width="2"/><ellipse cx="50" cy="81" rx="32" ry="7" fill="#fff0cf"/>');
  if (id === 'tarnaby') return shell('<path fill="#fff3ce" fill-opacity=".35" stroke="#909da0" d="M40 9h20v8c0 6 13 12 13 24v22c0 8-7 11-23 11s-23-3-23-11V41c0-12 13-18 13-24z"/><ellipse cx="50" cy="9" rx="10" ry="2" stroke="#909da0"/><path fill="#edbd71" fill-opacity=".5" stroke="#bd8f49" d="M44 65V51c0-10 6-18 6-18s6 8 6 18v14z"/><path d="M47 61V46m6 15V46" stroke="#efb83e" stroke-width="2"/><path fill="#bc9b5d" d="M35 71h30v5H35z"/><path fill="#262a2c" stroke="#111" d="M35 76h30l15 12v7H20v-7z"/><circle cx="64" cy="82" r="4" fill="#d7b66b" stroke="#9a7b45"/>');
  return shell('<path fill="#c8965c" stroke="#b58348" d="m41 48 7 3-20 44-8-1zM53 49l7-2 22 48-8 1zM47 49h7v38h-7z"/><path fill="#fff0cf" stroke="#b8aa8c" d="M23 14h54v40H23z"/><ellipse cx="50" cy="14" rx="27" ry="5" fill="#ede3ce" stroke="#b8aa8c"/><path d="M29 17v34m6-33v33m6-32v32m6-32v32m6-32v32m6-32v32m6-33v33m6-34v34" stroke="#ddcda9" stroke-width=".7"/>');
}

