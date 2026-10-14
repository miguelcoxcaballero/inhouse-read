export const isBookmarkedLegacy=(bookmarks,location)=>bookmarks.some(x=>JSON.stringify(x.locator)===JSON.stringify(location.locator)&&Math.abs(x.fraction-location.fraction)<.0001)
export function toggleBookmarkLegacy(bookmarks,location,create){
 if(isBookmarkedLegacy(bookmarks,location))bookmarks=bookmarks.filter(x=>!(JSON.stringify(x.locator)===JSON.stringify(location.locator)&&Math.abs(x.fraction-location.fraction)<.0001))
 else bookmarks.unshift(create())
 return bookmarks.slice(0,100)
}
export const prependHistoryLegacy=(history,origin)=>[origin,...history].slice(0,20)
