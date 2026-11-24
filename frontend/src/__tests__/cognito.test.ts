import { beforeEach, describe, expect, it, vi } from 'vitest'
import { cognitoMessage, createCognitoApi, type CognitoError } from '../auth/cognito'
import { setConfig } from '../config/config'

beforeEach(() =>
  setConfig({ apiUrl: 'https://x', region: 'us-east-2', userPoolId: 'p', userPoolClientId: 'client-1', orchestratorRuntimeArn: 'arn' }),
)

describe('cliente Cognito', () => {
  it('SignUp usa X-Amz-Target y el endpoint de la region', async () => {
    const f = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }))
    await createCognitoApi(f as unknown as typeof fetch).signUp('a@b.co', 'Passw0rd')
    const [url, init] = f.mock.calls[0]
    expect(url).toBe('https://cognito-idp.us-east-2.amazonaws.com/')
    expect(init.headers['X-Amz-Target']).toBe('AWSCognitoIdentityProviderService.SignUp')
    expect(init.headers['Content-Type']).toBe('application/x-amz-json-1.1')
    expect(JSON.parse(init.body).ClientId).toBe('client-1')
  })
  it('InitiateAuth con USER_PASSWORD_AUTH y REFRESH_TOKEN_AUTH', async () => {
    const f = vi.fn().mockImplementation(
      async () => new Response(JSON.stringify({ AuthenticationResult: { AccessToken: 'a', ExpiresIn: 3600 } }), { status: 200 }),
    )
    const api = createCognitoApi(f as unknown as typeof fetch)
    await api.signIn('a@b.co', 'x')
    await api.refresh('r')
    expect(JSON.parse(f.mock.calls[0][1].body).AuthFlow).toBe('USER_PASSWORD_AUTH')
    expect(JSON.parse(f.mock.calls[1][1].body).AuthFlow).toBe('REFRESH_TOKEN_AUTH')
    expect(JSON.parse(f.mock.calls[1][1].body).AuthParameters.REFRESH_TOKEN).toBe('r')
  })
  it('traduce los errores tipicos a espanol y nunca muestra el texto crudo', async () => {
    for (const code of [
      'NotAuthorizedException',
      'UserNotConfirmedException',
      'UsernameExistsException',
      'InvalidPasswordException',
      'CodeMismatchException',
      'ExpiredCodeException',
      'LimitExceededException',
    ]) {
      const f = vi.fn().mockResolvedValue(new Response(JSON.stringify({ __type: code, message: 'RAW english detail' }), { status: 400 }))
      const err = (await createCognitoApi(f as unknown as typeof fetch).signIn('a@b.co', 'x').catch((e: CognitoError) => e)) as CognitoError
      expect(err.code).toBe(code)
      expect(err.message).not.toContain('RAW')
      expect(err.message).toBe(cognitoMessage(code))
    }
  })
})
