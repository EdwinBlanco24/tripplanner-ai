import { getExchangeRates, type ExchangeRates } from '../config/config'
import type { Trip } from '../types'
import { formatDate } from '../utils/dates'
import { computeBudget, moneyLabel, STATE_LABEL, type BudgetReservation } from '../utils/budget'
import { TYPE_LABEL } from '../utils/trips'

const TYPE_ICON = { FLIGHT: 'pi-send', HOTEL: 'pi-building', ACTIVITY: 'pi-map' } as const

interface Props {
  trip: Pick<Trip, 'budget' | 'currency' | 'travelers'>
  reservations: BudgetReservation[]
  /** Version compacta: barra, porcentaje y disponible. */
  compact?: boolean
  /** Tasas a usar (por omision, las de la configuracion). */
  rates?: ExchangeRates | null
}

/** Comparador de presupuesto: lo comprometido en reservas frente al presupuesto del viaje. */
export function BudgetPanel({ trip, reservations, compact = false, rates }: Props) {
  const r = rates === undefined ? getExchangeRates() : rates
  const s = computeBudget(trip, reservations, r)
  const pct = s.percent === null ? (s.state === 'over' ? 100 : 0) : Math.min(100, Math.max(0, s.percent))
  const pctText = s.percent === null ? '—' : `${Math.round(s.percent)} %`
  const approx = s.approximate
  const needsRate = s.unconverted.length > 0

  return (
    <div className={`budget budget-${s.state}${compact ? ' budget-compact' : ''}`} data-state={s.state}>
      <div className="budget-bar-row">
        <div
          className="budget-bar"
          role="progressbar"
          aria-label="Presupuesto comprometido"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(pct)}
          aria-valuetext={`${pctText} del presupuesto: ${STATE_LABEL[s.state]}`}
        >
          <span className="budget-fill" style={{ width: `${pct}%` }} />
        </div>
        <strong className="budget-pct">{pctText}</strong>
      </div>
      <p className="budget-state">
        <i className={`pi ${s.state === 'ok' ? 'pi-check-circle' : 'pi-exclamation-triangle'}`} aria-hidden="true" /> {STATE_LABEL[s.state]}
      </p>

      {compact ? (
        <p className="budget-line">
          {s.state === 'over' ? (
            <>
              Superaste el presupuesto en <strong>{moneyLabel(s.overBy, s.currency, approx)}</strong>
            </>
          ) : (
            <>
              Disponible <strong>{moneyLabel(s.remaining, s.currency, approx)}</strong>
            </>
          )}
        </p>
      ) : (
        <>
          <dl className="budget-figures">
            <div>
              <dt>Presupuesto</dt>
              <dd>{moneyLabel(s.budget, s.currency)}</dd>
            </div>
            <div>
              <dt>Comprometido</dt>
              <dd>{moneyLabel(s.committed, s.currency, approx)}</dd>
            </div>
          </dl>
          {s.reservationCount > 0 && (
            <ul className="budget-types">
              {s.byType
                .filter((b) => b.count > 0)
                .map((b) => (
                  <li key={b.type}>
                    <i className={`pi ${TYPE_ICON[b.type]}`} aria-hidden="true" />
                    <span className="budget-type-name">
                      {TYPE_LABEL[b.type]}{' '}
                      <span className="muted">
                        ({b.count} {b.count === 1 ? 'reserva' : 'reservas'})
                      </span>
                    </span>
                    <span className="budget-type-orig muted">{b.originals.map((o) => moneyLabel(o.total, o.currency)).join(' + ')}</span>
                    <strong>{moneyLabel(b.converted, s.currency, b.originals.some((o) => o.currency !== s.currency))}</strong>
                  </li>
                ))}
            </ul>
          )}
          {s.state === 'over' ? (
            <p className="budget-over-msg" role="status">
              Superaste el presupuesto en <strong>{moneyLabel(s.overBy, s.currency, approx)}</strong>
            </p>
          ) : (
            <p className="budget-line">
              Disponible <strong>{moneyLabel(s.remaining, s.currency, approx)}</strong>
              {s.perPerson !== null && (
                <>
                  {' · '}
                  <strong>{moneyLabel(s.perPerson, s.currency, approx)}</strong> por persona
                </>
              )}
            </p>
          )}
          {needsRate && (
            <p className="budget-warn" role="status">
              Sin tasa de referencia para convertir: {s.unconverted.map((u) => moneyLabel(u.total, u.currency)).join(' + ')} no se incluye en el total.
            </p>
          )}
          {r ? (
            <p className="budget-rate muted">
              {r.label} · USD 1 = COP {new Intl.NumberFormat('es-CO').format(r.USD)} · al {formatDate(r.asOf)}
            </p>
          ) : (
            <p className="budget-rate muted">No hay tasa de referencia configurada: los montos en otra moneda se muestran sin convertir.</p>
          )}
        </>
      )}
    </div>
  )
}
