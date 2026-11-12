/**
 * Number formatting. No DOM access.
 *
 * 'mk': decimal comma, non-breaking-space thousands separator (1 234,5)
 * 'en': decimal point, comma thousands separator          (1,234.5)
 */
export function fmt(n, digits = 1, locale = 'mk') {
  if (!Number.isFinite(n)) n = 0;
  let s = n.toFixed(digits);
  // avoid "-0,0"
  if (/^-0(\.0+)?$/.test(s)) s = s.slice(1);
  const neg = s.startsWith('-');
  if (neg) s = s.slice(1);
  const [rawInt, decPart] = s.split('.');
  const thousands = locale === 'mk' ? ' ' : ',';
  const decimal = locale === 'mk' ? ',' : '.';
  const intPart = rawInt.replace(/\B(?=(\d{3})+(?!\d))/g, thousands);
  const out = decPart !== undefined ? intPart + decimal + decPart : intPart;
  return (neg ? '-' : '') + out;
}
