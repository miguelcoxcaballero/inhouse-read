import {it,expect,vi,afterEach} from 'vitest'
import {driveFetch} from '../../src/js/drive-fetch.js'
afterEach(()=>vi.restoreAllMocks())
it('bounds metadata and uploads while preserving OAuth cancellation',async()=>{
 const deadline=vi.spyOn(AbortSignal,'timeout'),fetcher=vi.spyOn(globalThis,'fetch').mockResolvedValue({ok:true})
 await driveFetch('https://www.googleapis.com/drive/v3/files')
 expect(deadline).toHaveBeenLastCalledWith(20000)
 await driveFetch('https://www.googleapis.com/upload/drive/v3/files',{method:'POST'})
 expect(deadline).toHaveBeenLastCalledWith(300000)
 await driveFetch('https://www.googleapis.com/drive/v3/files/book?alt=media',{transfer:true})
 expect(deadline).toHaveBeenLastCalledWith(300000)
 expect(fetcher.mock.calls.at(-1)[1]).not.toHaveProperty('transfer')
 const controller=new AbortController();await driveFetch('https://oauth2.googleapis.com/token',{signal:controller.signal})
 expect(fetcher.mock.calls.at(-1)[1].signal).toBe(controller.signal)
 expect(deadline).toHaveBeenCalledTimes(3)
})
