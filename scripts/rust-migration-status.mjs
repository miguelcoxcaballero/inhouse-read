// Reproducible source-language inventory. This is not feature completion or
// runtime coverage: comments and compatibility implementations are included.
import {execFileSync} from 'node:child_process'
import {readFileSync} from 'node:fs'
import {fileURLToPath} from 'node:url'
const cwd=fileURLToPath(new URL('..',import.meta.url))
const tracked=execFileSync('git',['ls-files','-z'],{cwd,windowsHide:true}).toString().split('\0')
const languages={Rust:{files:0,nonblankLines:0},JavaScript:{files:0,nonblankLines:0}}
for(const file of tracked){
 const language=/^rust-(core|ui)\/src\/.*\.rs$/.test(file)?'Rust':/^src\/js\/.*\.(js|mjs)$/.test(file)?'JavaScript':null
 if(!language)continue
 const source=readFileSync(new URL('../'+file,import.meta.url),'utf8')
 languages[language].files++;languages[language].nonblankLines+=source.split(/\r?\n/).filter(line=>line.trim()).length
}
const total=languages.Rust.nonblankLines+languages.JavaScript.nonblankLines
console.log(JSON.stringify({commit:execFileSync('git',['rev-parse','HEAD'],{cwd,windowsHide:true}).toString().trim(),languages,
 rustPercent:Number((languages.Rust.nonblankLines/total*100).toFixed(2)),
 scope:'Tracked production Rust and JavaScript sources; reads working-tree contents. Includes comments and compatibility code. Excludes tests, dependencies, generated bindings, HTML/CSS and Android native code. Not functional completion.'},null,2))
