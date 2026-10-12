export function properties(code){
 const ch=String.fromCodePoint(code)
 return (/^[\p{L}\p{N}]$/u.test(ch)?1:0)|(/^\p{N}$/u.test(ch)?2:0)|(ch!==ch.toUpperCase()&&ch===ch.toLowerCase()?4:0)|(ch!==ch.toLowerCase()?8:0)
}
export function invoke(ui,text,breaks=[]){
 const units=new Uint16Array(text.length);for(let i=0;i<text.length;i++)units[i]=text.charCodeAt(i)
 return ui.speech_sentence_ends(units,breaks,properties,(a,b)=>text.slice(a,b).toLocaleLowerCase())
}
export function makeCases(){
 const passages=[
  'Sr. Gómez habló con la Dra. Núñez. «¡Imposible!», dijo ella. Volvieron.',
  'J. R. R. Tolkien escribió un libro. Fig. 3: aparecen 3.5 casos. Son aprox. siete.',
  '« Bonjour ! » dit-il. Mme. Marie se levantó. —¿Vienes? —preguntó Luis.',
  'No. 3 is a number. Jan. 3rd is a date. Go to example.com. Mr. Smith replied.',
  '1. Primera frase. IV. Otra sección. [vi] Más cosas. a. una línea. (B.) otra.',
  'Dağların üstünde. İpek geldi. Привет! Как дела? Українська мова є тут.',
  '中文句子。另一个！日本の本です。「どうですか？」良いです。',
  'यह एक पुस्तक है। क्या यह सही है॥ مرحبا بالعالم؟ نعم. שלום עולם. עוד משפט.',
  'Un nombre 𐐀. 𐐁 aparece. Un número 𐒠. 𐒡 después. Pág. ٣ y núm. ９.',
  '\ud800. \udc00! Algo\0. Otro\u2028etc. y más\ufefftexto. \u200bFin.',
  '« Salut... »\nmais il reste. "Voy." Otra. « A. » siguiente. B. Nuevo.',
  '  \t\r\n\u00a0\u1680\u2000\u202f\u205f\u3000\ufeff. end. ',
  '', '.', '..', '...', '!?', '1.', '[i.]', 'sí. no. Sí. ¡Sí! más.', 'TÍTULO\u2029Texto sin punto'
 ]
 const cases=[]
 for(const text of passages)for(const breaks of [[],[0],[text.length],[0,text.length],Array.from({length:text.length},(_,i)=>i)])cases.push([text,breaks])
 const abbrevs='sr sra sres sras srta srs dr dra drs lic ing arq prof profa pág págs pag pags núm num vol vols ed eds av avda pza gral cnel sto sta ud uds vd vds ee mr mrs ms mx messrs mt jr vs cf fig figs pp approx m mm mme mmes mlle mlles st ste env chap bd hr nr str bzw ggf sig sigg dott avv jan feb mar apr jun jul aug sep sept oct nov dec ene abr ago dic no nº n.º p etc'.split(' ')
 for(const word of abbrevs)for(const next of ['Gómez','gómez','3','３','𐒠','—Sí','«hola',''])cases.push([word+'. '+next+'. Otra frase.',[]],[word.toUpperCase()+'. '+next+'. Otra frase.',[]])
 let seed=218;const random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296)
 const bank=[...passages,...abbrevs],joins=[' ','\n','\t','!','...','。','\u2029','»','\ud800','\0','\u2028']
 for(let trial=0;trial<2000;trial++){
  let text='';for(let k=0,n=1+Math.floor(random()*18);k<n;k++)text+=bank[Math.floor(random()*bank.length)]+joins[Math.floor(random()*joins.length)]
  const breaks=[];for(let k=0;k<trial%8;k++)breaks.push(Math.floor(random()*(text.length+1)));cases.push([text,breaks])
 }
 cases.push([passages.slice(0,10).join(' ').repeat(50),[]])
 return cases
}
