// Los PDF usan la Helvetica estandar de jsPDF (WinAnsi): solo Latin-1. Tildes, ñ, ¿ y ¡ pasan; lo demas se
// reemplaza por equivalentes o se quita (emojis, flechas, simbolos).
const cp = (...codes: number[]) => codes.map((n) => String.fromCodePoint(n)).join('')
// Espacios raros (NBSP de Intl, espacios tipograficos) -> espacio; invisibles (ancho cero, joiner, selector de variacion) -> nada.
const SPACE_CHARS = new RegExp(`[${cp(0xa0)}${cp(0x2000)}-${cp(0x200a)}${cp(0x202f)}${cp(0x205f)}${cp(0x3000)}]`, 'g')
const INVISIBLE = new RegExp(`[${cp(0x200b, 0xfeff, 0x200d, 0xfe0f)}]`, 'g')
const REPLACEMENTS: [RegExp, string][] = [
  [/→|➜|➔|⟶/g, '->'],
  [/←/g, '<-'],
  [/↔/g, '<->'],
  [/≈|≃|≅/g, 'aprox.'],
  [/≤/g, '<='],
  [/≥/g, '>='],
  [/≠/g, '!='],
  [/[‐‑‒–—―−]/g, '-'],
  [/…/g, '...'],
  [/[‘’‚′]/g, "'"],
  [/[“”„″]/g, '"'],
  [/[•‣◦▪·]/g, '-'],
  [/✓|✔/g, 'OK'],
  [/✗|✘/g, 'X'],
  [/€/g, 'EUR'],
  [SPACE_CHARS, ' '],
  [INVISIBLE, ''],
]

/** Texto apto para la Helvetica estandar: Latin-1 imprimible, sin emojis ni simbolos fuera de rango. */
export function pdfText(value: unknown): string {
  if (value === null || value === undefined) return ''
  let s = String(value).normalize('NFC')
  for (const [re, rep] of REPLACEMENTS) s = s.replace(re, rep)
  // Latin-1 imprimible (0x20-0x7E y 0xA0-0xFF), saltos de linea y tabulador como espacio/linea.
  s = s.replace(/\t/g, ' ').replace(/\r\n?/g, '\n')
  s = Array.from(s)
    .filter((ch) => {
      const c = ch.codePointAt(0) ?? 0
      return ch === '\n' || (c >= 0x20 && c <= 0x7e) || (c >= 0xa1 && c <= 0xff)
    })
    .join('')
  return s.replace(/[ ]{2,}/g, ' ').trim()
}

/** Nombre de archivo seguro: letras, numeros, guion y guion bajo. */
export function safeFileName(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || 'documento'
}
