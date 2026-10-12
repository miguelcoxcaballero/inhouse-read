import {getRustUI} from '../rust-ui.js'

// Keep all lines of a spoken sentence visible when it fits. A longer sentence
// starts near the top; it must not force its first line above the viewport.
export function speechFollowOffset(rects,box){
 const ui=getRustUI()
 return ui?.speech_follow?ui.speech_follow(rects,box):speechFollowOffsetLegacy(rects,box)
}
export function speechFollowOffsetLegacy(rects,box){
 const visible=Array.from(rects||[]).filter(r=>[r.top,r.bottom,r.left,r.right].every(Number.isFinite)&&r.bottom>=r.top&&r.right>=r.left)
 if(!visible.length||!box||![box.top,box.bottom,box.left,box.right,box.width,box.height].every(Number.isFinite)||box.width<=0||box.height<=0)return null
 const top=Math.min(...visible.map(r=>r.top)),bottom=Math.max(...visible.map(r=>r.bottom))
 const left=Math.min(...visible.map(r=>r.left)),right=Math.max(...visible.map(r=>r.right))
 const lower=bottom>box.bottom-24||top<box.top+8,side=right>box.right||left<box.left
 if(!lower&&!side)return null
 return {
  top:lower?top-box.top-Math.min(box.height*.3,Math.max(8,box.height-(bottom-top)-24)):0,
  left:side?left-box.left-Math.min(box.width*.15,Math.max(0,box.width-(right-left))):0
 }
}
