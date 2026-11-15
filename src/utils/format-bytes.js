import { t } from '../i18n/index.js'

/** Octets -> "3,4 Mo" / "3.4 MB" (une décimale sous 10, sinon entier). */
export function formatMegabytes(bytes) {
  const megabytes = bytes / 1e6
  const value = megabytes < 10 ? megabytes.toFixed(1) : String(Math.round(megabytes))
  return `${value} ${t('unit.mb')}`
}
