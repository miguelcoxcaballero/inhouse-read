import {getRustUI} from '../rust-ui.js'

export function isBookmarked(bookmarks,location){
 const ui=getRustUI()
 return ui?.reading_marked?ui.reading_marked(bookmarks,location):isBookmarkedLegacy(bookmarks,location)
}
export function toggleBookmark(bookmarks,location,create){
 const ui=getRustUI()
 return ui?.reading_toggle?ui.reading_toggle(bookmarks,location,create):toggleBookmarkLegacy(bookmarks,location,create)
}
export function prependHistory(history,origin){
 const ui=getRustUI()
 return ui?.reading_history?ui.reading_history(history,origin):[origin,...history].slice(0,20)
}
export const isBookmarkedLegacy=(bookmarks,location)=>bookmarks.some(x=>JSON.stringify(x.locator)===JSON.stringify(location.locator)&&Math.abs(x.fraction-location.fraction)<.0001)
export function toggleBookmarkLegacy(bookmarks,location,create){
 if(isBookmarkedLegacy(bookmarks,location))bookmarks=bookmarks.filter(x=>!(JSON.stringify(x.locator)===JSON.stringify(location.locator)&&Math.abs(x.fraction-location.fraction)<.0001))
 else bookmarks.unshift(create())
 return bookmarks.slice(0,100)
}
