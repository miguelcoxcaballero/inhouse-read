import { createHash } from 'node:crypto'

/** Binary-preserving Drive HTTP fixture shared by independent browser contexts.
 * Only Google's endpoints are substituted; the built app, storage, readers and
 * sync implementation are real. No app modules or IndexedDB are shared. */
export function driveServer({ beforeUpload = async () => {} } = {}) {
  const files = new Map()
  let counter = 0
  const manifests = () => [...files.values()].filter(f => f.name.startsWith('library-v1-')).map(f => JSON.parse(f.bytes))
  async function connect(context) {
    await context.addInitScript(() => localStorage.setItem('ihr_drive_session_v2', JSON.stringify({ accessToken:'fixture-token', expiresAt:Date.now()+3600000 })))
    await context.route('https://www.googleapis.com/**', async route => {
      const req=route.request(), url=new URL(req.url()), method=req.method()
      const reply = data => route.fulfill({ status:200, contentType:'application/json', body:JSON.stringify(data) })
      if (url.pathname.endsWith('/about')) return reply({ user:{ permissionId:'cross-device', displayName:'Reader', emailAddress:'reader@example.com' } })
      const id=url.pathname.split('/').at(-1)
      if (url.searchParams.get('alt') === 'media') {
        const file=files.get(id)
        return file ? route.fulfill({ status:200, contentType:file.mimeType, body:file.bytes }) : route.fulfill({status:404,body:'Missing file'})
      }
      if (url.pathname.startsWith('/upload/')) {
        const boundary=req.headers()['content-type'].split('boundary=')[1]
        if (!boundary) throw new Error('Expected multipart upload for small fixtures')
        const body=req.postDataBuffer(), separator=Buffer.from(`\r\n--${boundary}`)
        const headerEnd=body.indexOf('\r\n\r\n')+4, metadataEnd=body.indexOf(separator,headerEnd)
        const metadata=JSON.parse(body.subarray(headerEnd,metadataEnd).toString())
        const fileHeaders=metadataEnd+separator.length+2, fileStart=body.indexOf('\r\n\r\n',fileHeaders)+4
        const mimeType=/Content-Type: ([^\r]+)/.exec(body.subarray(fileHeaders,fileStart).toString())?.[1]
        const bytes=body.subarray(fileStart,body.indexOf(separator,fileStart))
        await beforeUpload(metadata, bytes)
        const savedId=method==='PATCH' ? id : `drive-${++counter}`
        const previous=files.get(savedId)
        const file={ ...previous, ...metadata, id:savedId, mimeType, bytes, size:String(bytes.length),
          md5Checksum:createHash('md5').update(bytes).digest('hex'), modifiedTime:new Date().toISOString() }
        files.set(savedId,file)
        return reply({ ...file, bytes:undefined })
      }
      if (method==='POST') {
        const meta=JSON.parse(req.postData()), id=`folder-${++counter}`
        files.set(id,{ ...meta,id }); return reply({ ...meta,id })
      }
      const query=url.searchParams.get('q') || '', name=/name = '([^']+)'/.exec(query)?.[1], parent=/'([^']+)' in parents/.exec(query)?.[1]
      return reply({ files:[...files.values()].filter(f => (!name || f.name===name) && (!parent || f.parents?.includes(parent)))
        .map(({bytes,...metadata}) => metadata) })
    })
  }
  return { connect, files, manifests }
}
