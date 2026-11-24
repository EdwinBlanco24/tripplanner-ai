import { DESTINATIONS, useTypewriter } from './motion'

const BENEFITS = [
  { icon: 'pi-send', text: 'Vuelos reales con agentes de IA' },
  { icon: 'pi-sun', text: 'Clima del destino día a día' },
  { icon: 'pi-calendar', text: 'Itinerario y reservas en un solo lugar' },
]

const ROUTE = 'M 40 130 C 110 10, 270 10, 360 90'

function RouteArt({ reduced }: { reduced: boolean }) {
  return (
    <svg className="route-art" viewBox="0 0 400 160" role="img" aria-label="Ruta de Bogotá a Cartagena">
      <path id="route-path" d={ROUTE} fill="none" stroke="rgba(255,255,255,0.75)" strokeWidth="2.5" strokeDasharray="3 8" strokeLinecap="round" />
      <circle cx="40" cy="130" r="6" fill="#fff" />
      <circle cx="360" cy="90" r="6" fill="#fff" />
      <text x="40" y="153" textAnchor="middle" fill="#fff" fontSize="14" fontWeight="700">BOG</text>
      <text x="360" y="113" textAnchor="middle" fill="#fff" fontSize="14" fontWeight="700">CTG</text>
      <g className={reduced ? 'plane' : 'plane plane-fly'} transform={reduced ? 'translate(200 38)' : undefined}>
        <path d="M-12,-2 L8,0 L-12,2 L-9,0 Z M-5,-8 L0,0 L-5,8 L-8,8 L-5,0 L-8,-8 Z" fill="#fff" />
      </g>
    </svg>
  )
}

/** Panel izquierdo (vitrina): degradado, titulo, frase con maquina de escribir, ruta animada y beneficios. */
export function Showcase({ reduced }: { reduced: boolean }) {
  const destination = useTypewriter(DESTINATIONS, reduced)
  return (
    <aside className="showcase" aria-label="TripPlanner AI">
      <div className="showcase-inner">
        <h1 className="showcase-title">
          <i className="pi pi-send" aria-hidden="true" /> TripPlanner AI
        </h1>
        <p className="showcase-phrase" aria-label="Planea tu viaje a tu próximo destino">
          Planea tu viaje a <span className="typed">{destination}</span>
          <span className="caret" aria-hidden="true" />
        </p>
        <RouteArt reduced={reduced} />
        <ul className="benefits">
          {BENEFITS.map((b, i) => (
            <li key={b.text} style={{ animationDelay: `${0.4 + i * 0.25}s` }}>
              <i className={`pi ${b.icon}`} aria-hidden="true" /> {b.text}
            </li>
          ))}
        </ul>
      </div>
    </aside>
  )
}
