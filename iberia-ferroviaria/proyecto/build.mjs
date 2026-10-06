import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.dirname(fileURLToPath(import.meta.url));
const files=['assets/geography.js','assets/rivers.js','assets/realdata.js','assets/railways.js','data.js','story.js','engine.js','operations.js','gtfs.js','map-v2.js','app.js'];
let code='';
for(const file of files){let text=fs.readFileSync(path.join(root,'dist',file),'utf8');if(['engine.js','operations.js','gtfs.js'].includes(file)){const exported=[...text.matchAll(/export\s+(?:(?:async\s+)?function\*?|const|class)\s+(\w+)/g)].map(x=>x[1]);text+='\nconst '+({'engine.js':'E','operations.js':'O','gtfs.js':'G'}[file])+'={'+exported.join(',')+'};';}code+='\n'+text.replace(/^import .*?;\s*$/gm,'').replace(/\bexport\s+(?=(?:async\s+)?function|const|class)/g,'');}
new Function(code);
let html=fs.readFileSync(path.join(root,'dist/index.html'),'utf8');
let css=(fs.readFileSync(path.join(root,'dist/style.css'),'utf8')+'\n'+fs.readFileSync(path.join(root,'dist/style-v2.css'),'utf8')).replace(/^@import[^\n]*\n/,'');
for(const asset of ['characters.png','rail-art.jpg']){const img=fs.readFileSync(path.join(root,'dist/assets',asset)).toString('base64');css=css.replaceAll("url('assets/"+asset+"')",`url('data:image/${asset.endsWith('jpg')?'jpeg':'png'};base64,${img}')`);}
html=html.replace('<link rel="stylesheet" href="style-v2.css">','').replace('<link rel="stylesheet" href="style.css">','<style>'+css+'</style>').replace('<script type="module" src="app.js"></script>','<script>\n(()=>{\n'+code.replaceAll('</script','<\\/script')+'\n})();\n</script>');
html=html.replace('</body>','<script type="text/plain" id="geodata-license">'+fs.readFileSync(path.join(root,'LICENSE-GEODATA.txt'),'utf8').replaceAll('</script','<\\/script')+'</script></body>');
fs.mkdirSync(path.join(root,'../outputs'),{recursive:true});
fs.writeFileSync(path.join(root,'../outputs/Iberia-Ferroviaria.html'),html);
console.log('HTML autónomo generado: '+Buffer.byteLength(html)+' bytes. Sin dependencias de red para jugar.');
