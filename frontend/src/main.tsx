import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { PrimeReactProvider } from 'primereact/api'
import '@fontsource-variable/inter'
import '@fontsource-variable/space-grotesk'
import 'primereact/resources/themes/lara-light-teal/theme.css'
import 'primereact/resources/primereact.min.css'
import 'primeicons/primeicons.css'
import './styles/tokens.css'
import './styles/app.css'
import './styles/print.css'
import { App } from './App'
import { AppProvider, buildServices } from './app/AppContext'
import { loadConfig } from './config/config'

const root = createRoot(document.getElementById('root')!)

function ConfigError() {
  return (
    <div className="login-wrap">
      <div className="card login-card" role="alert">
        <h1 className="brand-title">TripPlanner AI</h1>
        <p>No pudimos cargar la configuración de la aplicación.</p>
        <p className="muted">Recarga la página. Si el problema continúa, contacta al administrador.</p>
        <button className="p-button" onClick={() => location.reload()}>
          Recargar
        </button>
      </div>
    </div>
  )
}

loadConfig()
  .then(() => {
    const services = buildServices()
    root.render(
      <StrictMode>
        <PrimeReactProvider>
          <BrowserRouter>
            <AppProvider services={services}>
              <App />
            </AppProvider>
          </BrowserRouter>
        </PrimeReactProvider>
      </StrictMode>,
    )
  })
  .catch(() => root.render(<ConfigError />))
