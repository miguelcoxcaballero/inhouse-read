import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { isDriveConfigured, requestDriveAccess, listDriveBooks, DriveNotConfiguredError } from '../../src/js/drive-client.js'

describe('drive-client — configuración', () => {
  afterEach(() => {
    delete globalThis.INHOUSE_READ_CONFIG
  })

  it('isDriveConfigured es false sin config.js', () => {
    expect(isDriveConfigured()).toBe(false)
  })

  it('isDriveConfigured es true con un googleClientId presente', () => {
    globalThis.INHOUSE_READ_CONFIG = { googleClientId: 'abc.apps.googleusercontent.com' }
    expect(isDriveConfigured()).toBe(true)
  })

  it('requestDriveAccess rechaza con DriveNotConfiguredError si falta el Client ID', async () => {
    await expect(requestDriveAccess()).rejects.toBeInstanceOf(DriveNotConfiguredError)
  })
})

describe('drive-client — llamadas sin sesión', () => {
  it('listDriveBooks falla con un mensaje claro si no hay token de acceso', async () => {
    await expect(listDriveBooks()).rejects.toThrow(/sesión de Drive/)
  })
})
