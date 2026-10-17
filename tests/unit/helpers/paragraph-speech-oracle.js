// Intentional paragraph policy over untouched frozen references. Adapt the
// normalizer in memory AFTER its original removal/header mask, so changing a
// separator cannot accidentally change which original lines are headers.
import {readFileSync} from 'node:fs'
import {resolve} from 'node:path'
import * as frozen from './reference-speech-map.js'
const blocks='address,article,aside,blockquote,dd,details,div,dl,dt,fieldset,figcaption,figure,footer,form,h1,h2,h3,h4,h5,h6,header,hr,li,main,nav,ol,p,pre,section,summary,table,tbody,td,tfoot,th,thead,tr,ul,body,html'
function block(node,root){let parent=node.parentElement;while(parent&&parent!==root&&!parent.matches(blocks))parent=parent.parentElement;return parent}
function preserves(node,root){
 for(let parent=node.parentElement;parent;parent=parent.parentElement){
  const style=parent.ownerDocument.defaultView?.getComputedStyle(parent).whiteSpace||''
  if(style&&!['inherit','unset'].includes(style))return ['pre','pre-wrap','pre-line','break-spaces'].includes(style)
  if(parent===root)break
 }
 return false
}
export function mapSpeechText(root){
 const mapped=frozen.mapSpeechText(root),chars=mapped.text.split('')
 for(const span of mapped.spans)if(!preserves(span.node,root)){
  for(let i=span.start;i<span.end;i++)if(/[\r\n\u2028]/.test(chars[i]))chars[i]=' '
 }
 for(let i=1;i<mapped.spans.length;i++){
  const previous=mapped.spans[i-1],next=mapped.spans[i],at=next.start-1
  if(next.start===previous.end+1&&chars[at]==='\n'&&block(previous.node,root)!==block(next.node,root))chars[at]='\u2029'
 }
 return {...mapped,text:chars.join('')}
}
export const {mapTextLayer,mapTextNode,mapTextNodes}=frozen
function blankParagraphs(raw){
 const positions=new Set()
 for(const match of raw.matchAll(/(?:\r\n|\r(?!\n)|(?<!\r)\n|\u2028)(?:[^\S\r\n\u2028\u2029]*(?:\r\n|\r(?!\n)|(?<!\r)\n|\u2028))+/g))positions.add(match.index+(match[0].startsWith('\r\n')?1:0))
 return positions
}
let source=readFileSync(resolve('tests/unit/helpers/reference-speech-text.js'),'utf8').replace(/^export /gm,'')
for(const [before,after] of [
 ['const chars = [], map = [], breaks = []','const paragraphPositions=blankParagraphs(raw); const chars = [], map = [], breaks = []'],
 ['if (ch === HARD_BREAK) {','if (ch === HARD_BREAK || paragraphPositions.has(i)) {'],
]){
 if(source.split(before).length!==2)throw Error('Frozen paragraph oracle seam changed')
 source=source.replace(before,after)
}
// Evaluation is limited to frozen TEST JavaScript; production never evaluates JS.
const reference=new Function('blankParagraphs',source+'\nreturn {normalizeSpeech,speechSentences}')(blankParagraphs)
export const normalizeSpeech=reference.normalizeSpeech
const planner=readFileSync(resolve('tests/unit/helpers/reference-speech-plan.js'),'utf8').replace(/^import[^\n]*\n/m,'').replace(/^export /gm,'')
export const planSpeech=new Function('normalizeSpeech','speechSentences',planner+'\nreturn planSpeech')(normalizeSpeech,reference.speechSentences)
