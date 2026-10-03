// @vitest-environment node
import {readFileSync} from 'node:fs'
import {describe, expect, it} from 'vitest'

const workflow=readFileSync(new URL('../../.github/workflows/deploy-pages.yml',import.meta.url),'utf8')
  .replace(/\r\n?/g,'\n')

describe('reader modules survive a Pages update',()=>{
  it('retains the existing branch and its hashed reader modules',()=>{
    const publish=workflow.split('- name: Publish to gh-pages')[1]
    expect(publish).toBeTruthy()
    expect(publish).toMatch(/publish_branch:\s*gh-pages/)
    expect(publish).toMatch(/keep_files:\s*true/)
    // actions-gh-pages returns before its KeepFiles handling when ForceOrphan
    // is enabled. Both options together delete the previous reader modules.
    expect(publish).toMatch(/force_orphan:\s*false/)
    expect(publish).not.toMatch(/force_orphan:\s*true/)
  })

  it('serializes branch deployments without cancelling an update in progress',()=>{
    expect(workflow).toMatch(/group:\s*pages-production/)
    expect(workflow).toMatch(/cancel-in-progress:\s*false/)
    expect(workflow).not.toMatch(/uses:\s*actions\/(?:deploy-pages|configure-pages|upload-pages-artifact)@/)
  })
})
