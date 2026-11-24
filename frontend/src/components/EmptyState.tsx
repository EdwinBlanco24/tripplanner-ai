import type { ReactNode } from 'react'

export function EmptyState({ icon = 'pi-inbox', title, children }: { icon?: string; title: string; children?: ReactNode }) {
  return (
    <div className="empty-state">
      <i className={`pi ${icon}`} aria-hidden="true" />
      <p>{title}</p>
      {children}
    </div>
  )
}
