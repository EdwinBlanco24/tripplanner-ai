import { Link } from 'react-router-dom'
import { Button } from 'primereact/button'
import { EmptyState } from '../components/EmptyState'

export function Placeholder({ title }: { title: string }) {
  return (
    <section>
      <h1>{title}</h1>
      <div className="card">
        <EmptyState icon="pi-clock" title="Disponible en el S5">
          <p className="muted">Esta sección se conectará con el asistente en el siguiente sprint.</p>
          <Link to="/asistente">
            <Button label="Ir al Asistente" icon="pi pi-comments" />
          </Link>
        </EmptyState>
      </div>
    </section>
  )
}
