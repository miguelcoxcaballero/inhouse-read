// A '.' after one of these is part of the word, never the end of a sentence ("Sr. Gómez", "pág. 12", "Fig. 3").
const ABBREVIATIONS = new Set(('sr sra sres sras srta srs dr dra drs lic ing arq prof profa pág págs pag pags núm num vol vols ed eds av avda pza gral cnel sto sta ud uds vd vds '
  + 'ee mr mrs ms mx messrs mt jr vs cf fig figs pp approx '
  + 'm mm mme mmes mlle mlles st ste env chap bd '
  + 'hr nr str bzw ggf '
  + 'sig sigg dott avv').split(' '))
// ...but these only when a number follows ("Jan. 3rd", "n.º 4").
const BEFORE_NUMBER = new Set('jan feb mar apr jun jul aug sep sept oct nov dec ene abr ago dic no nº n.º p'.split(' '))
const OPENERS = /[—–\-"'“‘«‹(\[]/
const CLOSING_QUOTES = '"\'”’»›)]}」』'
const RUN = /[.!?。！？…؟।॥]+/g
const isLower = ch => ch !== undefined && ch !== ch.toUpperCase() && ch === ch.toLowerCase()
const isUpper = ch => ch !== undefined && ch !== ch.toLowerCase()

/** Does the terminator run [runStart, runEnd) (closing quotes up to `end`) really end a sentence? The text before it starts at `from`. */
function endsSentence(text, from, runStart, runEnd, end) {
  if (end >= text.length) return true
  const run = text.slice(runStart, runEnd)
  const last = run.at(-1)
  let n = end
  while (n < text.length && /\s/.test(text[n])) n++
  if (n >= text.length) return true
  if (n === end) {
    // No space after it: "3.5", "U.S.A", "c.-à-d.", "example.com" stay whole; full-width and ?/! runs end the sentence.
    return /[。！？]/.test(last) || /[!?]/.test(run) || !/[\p{L}\p{N}-]/u.test(text[n])
  }
  let lead = n
  while (lead < text.length && OPENERS.test(text[lead])) lead++
  const next = text[lead]
  const word = /([\p{L}\p{N}]+)$/u.exec(text.slice(from, runStart))?.[1] || ''
  const lower = word.toLocaleLowerCase()
  if (isLower(next)) {
    // « Bonjour ! » dit-il, "—¿Vienes? —preguntó Luis", "nadie lo creyó... pero", "etc. y", "p. ej. sobre": the sentence goes on.
    if (end > runEnd || /[—–-]/.test(text[n]) || /\.{2,}|…/.test(run)) return false
    if (run === '.' && (word.length <= 2 || ABBREVIATIONS.has(lower) || lower === 'etc')) return false
  }
  if (run !== '.') return true
  if (ABBREVIATIONS.has(lower) && (word.length > 1 || lower === 'm')) return false
  if (BEFORE_NUMBER.has(lower) && /\p{N}/u.test(next || '')) return false
  // Initials ("J. R. R. Tolkien") and list numbers ("1." "a)") on their own.
  if (word.length === 1 && isUpper(word) && isUpper(next)) return false
  if (/^[(\[]?(?:\d{1,3}|[a-z]|[ivxlcdm]{1,6})[.)\]]*$/i.test(text.slice(from, end).trim())) return false
  return true
}

/** Raw end offsets of the sentences of `text`: terminators that really end one, plus the hard breaks (`breaks`: indexes of the space after a heading, cell or item). */
function sentenceEnds(text, breaks = []) {
  const candidates = [...breaks.map(at => ({ end:at, hard:true }))]
  for (const run of text.matchAll(RUN)) {
    const runEnd = run.index + run[0].length
    let end = runEnd
    for (;;) {
      if (CLOSING_QUOTES.includes(text[end] ?? '\0')) end++
      else if (text[end] === ' ' && /[»›]/.test(text[end + 1] || '')) end += 2 // French « … ! »
      else break
    }
    candidates.push({ end, runStart:run.index, runEnd })
  }
  candidates.sort((a, b) => a.end - b.end)
  const ends = []
  let from = 0
  for (const candidate of candidates) {
    if (candidate.end <= from) continue
    if (candidate.hard || endsSentence(text, from, candidate.runStart, candidate.runEnd, candidate.end)) { ends.push(candidate.end); from = candidate.end }
  }
  if (from < text.length) ends.push(text.length)
  return ends
}


export {sentenceEnds}
