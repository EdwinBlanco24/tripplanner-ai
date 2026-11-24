import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'

/** Solo http y https (nunca javascript:, data:, etc.). */
export function isSafeHref(href: string | undefined): href is string {
  if (!href) return false
  try {
    const u = new URL(href)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

const components: Components = {
  a({ href, children }) {
    return isSafeHref(href) ? (
      <a href={href} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    ) : (
      <span>{children}</span>
    )
  },
  // Sin imagenes remotas (pixeles de seguimiento): se muestra el texto alternativo.
  img({ alt }) {
    return <span>{alt ?? ''}</span>
  },
  table({ children }) {
    return (
      <div className="md-table-wrap">
        <table className="md-table">{children}</table>
      </div>
    )
  },
}

/** Markdown del asistente: GFM, SIN HTML crudo (se descarta) y con enlaces seguros. */
export function SafeMarkdown({ text }: { text: string }) {
  return (
    <div className="markdown">
      <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml components={components} urlTransform={(url) => (isSafeHref(url) ? url : '')}>
        {text}
      </ReactMarkdown>
    </div>
  )
}
