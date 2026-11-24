/** Una sesion de AgentCore dura unos 15 min sin actividad: pasados 14 min desde el ultimo evento se abre una nueva. */
export const SESSION_IDLE_MS = 14 * 60 * 1000

export function newSessionId(uuid: () => string = () => crypto.randomUUID()): string {
  return `tp-web-${uuid()}`
}

export interface SessionPrep {
  id: string
  /** true si habia una sesion anterior que se dejo por inactividad (se avisa a la persona). */
  rolled: boolean
}

export class SessionTracker {
  private id: string | null = null
  private lastEventAt = 0
  private hadActivity = false

  constructor(
    private readonly now: () => number = () => Date.now(),
    private readonly uuid: () => string = () => crypto.randomUUID(),
  ) {}

  /** Sesion a usar para el siguiente envio. */
  prepare(): SessionPrep {
    if (this.id === null) {
      this.id = newSessionId(this.uuid)
      this.lastEventAt = this.now()
      return { id: this.id, rolled: false }
    }
    if (this.hadActivity && this.now() - this.lastEventAt > SESSION_IDLE_MS) {
      this.id = newSessionId(this.uuid)
      this.lastEventAt = this.now()
      this.hadActivity = false
      return { id: this.id, rolled: true }
    }
    return { id: this.id, rolled: false }
  }

  /** Cada evento recibido renueva el reloj de inactividad. */
  touch(): void {
    this.lastEventAt = this.now()
    this.hadActivity = true
  }

  /** Fuerza una sesion nueva (Nueva conversacion, Reintentar). */
  renew(): string {
    this.id = newSessionId(this.uuid)
    this.lastEventAt = this.now()
    this.hadActivity = false
    return this.id
  }
}
