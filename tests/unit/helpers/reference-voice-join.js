export class LegacyVoiceJoin{
  joinPageSentence() {
    const index = this.items.length - 1, tail = this.items[index], plan = this.aheadPage?.plan
    if (!this.needsPageJoin(tail,index) || tail.joinChecked || !plan?.items?.length || !this.pagePlanValid(plan)) return
    // Only the incomplete sentence crosses the physical sheet. The remainder
    // of the prepared page keeps its own ordinary utterances and raw offsets.
    const first = plan.items[0]
    const continuation = []
    let length = tail.text.length + 1
    for (const item of plan.items) {
      if (item.sentence.start !== first.sentence.start || continuation.length && length + item.text.length > 360) break
      continuation.push(item); length += item.text.length + 1
    }
    const suffix = continuation.map(item=>item.text).join(' ')
    const prefix = /[-‐]$/.test(tail.text) && /^\p{Ll}/u.test(suffix) ? tail.text.slice(0,-1) : tail.text + ' '
    const boundary = prefix.length
    const marks = [...(tail.marks || []),{offset:boundary,start:first.start,source:plan.source,sentence:first.sentence}]
    let offset = boundary
    for (const item of continuation) {
      for (const mark of item.marks || []) marks.push({...mark,offset:offset + mark.offset,source:plan.source,sentence:item.sentence})
      offset += item.text.length + 1
    }
    this.items[index] = {...tail,text:prefix+suffix,marks,joinChecked:true,unjoined:tail}
    this.chunks[index] = this.items[index].text
    plan.items = plan.items.slice(continuation.length)
  }
}
