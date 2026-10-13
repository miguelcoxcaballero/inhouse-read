// This case observes every compiled operation, including one-time session
// initialization. A separate delayed-WASM case covers the startup fallback.
// Hold only app bootstrap while initializing its exact published UI module;
// app startup then adopts that same module instead of racing a second instance.
export async function openCompiledReaderApp(page,url=process.env.IHR_TEST_URL||'./'){
  let release
  const gate=new Promise(resolve=>{release=resolve})
  const pattern=/\/assets\/main-[\w-]+\.js$/
  const hold=async route=>{await gate;await route.continue()}
  await page.route(pattern,hold)
  try{
    await page.goto(url,{waitUntil:'commit'})
    await page.evaluate(async()=>{
      const manifest=await(await fetch(new URL('offline-shell-manifest.json',location.href))).json()
      const entry=manifest.entries.find(entry=>/^assets\/inhouse_read_ui-[\w-]+\.js$/.test(entry.path))
      if(!entry)throw Error('Published Rust UI module missing')
      const ui=await import(new URL(entry.path,location.href).href);await ui.default()
    })
  }finally{release()}
  await page.waitForLoadState('domcontentloaded')
  await page.unroute(pattern,hold)
}
