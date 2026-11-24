import { getConfig } from '../config/config'

const PREFIX = 'AWSCognitoIdentityProviderService.'

export class CognitoError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'CognitoError'
    this.code = code
  }
}

/** Mensajes en espanol para los errores tipicos de Cognito. Nunca se muestra el texto crudo del servicio. */
const MESSAGES: Record<string, string> = {
  NotAuthorizedException: 'Correo o contraseña incorrectos.',
  UserNotConfirmedException: 'Tu cuenta aún no está confirmada. Ingresa el código que te enviamos por correo.',
  UsernameExistsException: 'Ya existe una cuenta con ese correo. Inicia sesión.',
  InvalidPasswordException: 'La contraseña no cumple los requisitos: mínimo 8 caracteres, con mayúscula, minúscula y número.',
  CodeMismatchException: 'El código no es correcto. Revísalo e inténtalo de nuevo.',
  ExpiredCodeException: 'El código venció. Pide uno nuevo con «Reenviar código».',
  LimitExceededException: 'Demasiados intentos. Espera unos minutos e inténtalo de nuevo.',
  TooManyRequestsException: 'Demasiados intentos. Espera unos minutos e inténtalo de nuevo.',
  TooManyFailedAttemptsException: 'Demasiados intentos fallidos. Espera unos minutos e inténtalo de nuevo.',
  UserNotFoundException: 'Correo o contraseña incorrectos.',
  InvalidParameterException: 'Los datos ingresados no son válidos. Revísalos e inténtalo de nuevo.',
}

export function cognitoMessage(code: string): string {
  return MESSAGES[code] ?? 'No pudimos completar la operación. Inténtalo de nuevo.'
}

async function call<T>(target: string, body: Record<string, unknown>, fetchImpl: typeof fetch = fetch): Promise<T> {
  const cfg = getConfig()
  let res: Response
  try {
    res = await fetchImpl(`https://cognito-idp.${cfg.region}.amazonaws.com/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-amz-json-1.1', 'X-Amz-Target': PREFIX + target },
      body: JSON.stringify(body),
    })
  } catch {
    throw new CognitoError('NetworkError', 'No hay conexión con el servicio. Revisa tu internet e inténtalo de nuevo.')
  }
  let data: unknown
  try {
    data = await res.json()
  } catch {
    data = null
  }
  if (!res.ok) {
    const raw = (data as { __type?: string } | null)?.__type ?? 'Unknown'
    const code = raw.split('#').pop() ?? raw
    throw new CognitoError(code, cognitoMessage(code))
  }
  return data as T
}

export interface AuthResult {
  AccessToken: string
  IdToken?: string
  RefreshToken?: string
  ExpiresIn: number
}

export interface CognitoApi {
  signUp(email: string, password: string): Promise<void>
  confirmSignUp(email: string, code: string): Promise<void>
  resendCode(email: string): Promise<void>
  signIn(email: string, password: string): Promise<AuthResult>
  refresh(refreshToken: string): Promise<AuthResult>
}

export function createCognitoApi(fetchImpl: typeof fetch = fetch): CognitoApi {
  const clientId = () => getConfig().userPoolClientId
  return {
    async signUp(email, password) {
      await call(
        'SignUp',
        { ClientId: clientId(), Username: email, Password: password, UserAttributes: [{ Name: 'email', Value: email }] },
        fetchImpl,
      )
    },
    async confirmSignUp(email, code) {
      await call('ConfirmSignUp', { ClientId: clientId(), Username: email, ConfirmationCode: code }, fetchImpl)
    },
    async resendCode(email) {
      await call('ResendConfirmationCode', { ClientId: clientId(), Username: email }, fetchImpl)
    },
    async signIn(email, password) {
      const r = await call<{ AuthenticationResult?: AuthResult }>(
        'InitiateAuth',
        { AuthFlow: 'USER_PASSWORD_AUTH', ClientId: clientId(), AuthParameters: { USERNAME: email, PASSWORD: password } },
        fetchImpl,
      )
      if (!r.AuthenticationResult) throw new CognitoError('ChallengeUnsupported', cognitoMessage('Unknown'))
      return r.AuthenticationResult
    },
    async refresh(refreshToken) {
      const r = await call<{ AuthenticationResult?: AuthResult }>(
        'InitiateAuth',
        { AuthFlow: 'REFRESH_TOKEN_AUTH', ClientId: clientId(), AuthParameters: { REFRESH_TOKEN: refreshToken } },
        fetchImpl,
      )
      if (!r.AuthenticationResult) throw new CognitoError('Unknown', cognitoMessage('Unknown'))
      return r.AuthenticationResult
    },
  }
}
