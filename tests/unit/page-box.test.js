import { describe, expect, it } from 'vitest'
import { rustUI } from './helpers/rust-ui-ready.js'
// The page box is a rust-ui function (page_box); these are the constants and the call its reader makes.
const MINI_PLAYER_RESERVE = 52, PAGE_BOX_SLACK = 96
const stablePageHeight = ({ width, space, free, storage = globalThis.localStorage, boxes }) => rustUI.page_box_height(width, space, free, storage, boxes)
const memory = () => { const data = new Map(); return { getItem:key => data.get(key) ?? null, setItem:(key, value) => data.set(key, String(value)) } }
const height=(storage,space,width=390)=>stablePageHeight({width,space,free:space-MINI_PLAYER_RESERVE,storage})
describe('stable page box with a permanent shared accessory row',()=>{
 it('does not expand when Android hides its status bar',()=>{
  const storage=memory(),first=height(storage,748)
  expect(first).toBe(696);expect(height(storage,778)).toBe(first)
 })
 it('clamps an older taller box before playback, not when the audio controls appear',()=>{
  const storage=memory();expect(height(storage,778)).toBe(726)
  expect(height(storage,748)).toBe(696);expect(height(storage,778)).toBe(696)
 })
 it('preserves all page breaks across no accessories, audio, Return and both',()=>{
  const storage=memory(),first=height(storage,748)
  // The outer viewport reserves the same row in all four UI states.
  for(const visible of [0,49,44,49,0]){
   expect(visible).toBeLessThanOrEqual(MINI_PLAYER_RESERVE)
   expect(height(storage,748)).toBe(first)
  }
 })
 it('keeps real resizes separate and restores the original orientation',()=>{
  const storage=memory(),first=height(storage,748)
  expect(height(storage,748-PAGE_BOX_SLACK-200)).toBe(400)
  expect(height(storage,748)).toBe(first)
  expect(height(storage,342,844)).toBe(290);expect(height(storage,748)).toBe(first)
 })
 it('ignores the old cache that reserved only 48px',()=>{
  const storage=memory();storage.setItem('inhouse-read-page-boxes',JSON.stringify([{width:390,target:700,height:730}]))
  expect(height(storage,748)).toBe(696)
 })
 it('works without persistent storage and never overflows a tiny viewport',()=>{
  expect(height(null,748)).toBe(696)
  const denied={getItem(){throw Error('denied')},setItem(){throw Error('denied')}}
  expect(height(denied,748)).toBe(696)
  expect(height(null,180)).toBe(128)
 })
})
