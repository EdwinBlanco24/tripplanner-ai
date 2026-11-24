import { describe, expect, it } from 'vitest'
import { loadConfig, parseConfig } from '../config/config'

const good = { apiUrl: 'https://a.example.com/', region: 'us-east-2', userPoolId: 'p', userPoolClientId: 'c', orchestratorRuntimeArn: 'arn' }

describe('config', () => {
  it('normaliza apiUrl sin barra final', () => expect(parseConfig(good).apiUrl).toBe('https://a.example.com'))
  it('rechaza campos faltantes y apiUrl no https', () => {
    expect(() => parseConfig({ ...good, region: '' })).toThrow()
    expect(() => parseConfig({ ...good, apiUrl: 'http://a.example.com' })).toThrow()
    expect(() => parseConfig(null)).toThrow()
  })
  it('loadConfig falla si el archivo no se puede leer', async () => {
    const f = (async () => new Response('', { status: 404 })) as unknown as typeof fetch
    await expect(loadConfig(f)).rejects.toThrow()
  })
})
