/** Minusculas, sin tildes ni signos diacriticos y sin espacios en los extremos (para comparar y buscar). */
export function normalizeText(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim().replace(/\s+/g, ' ')
}
