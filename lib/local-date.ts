/**
 * `YYYY-MM-DD` of an instant in the machine's own time zone. Notes and review
 * file names carry the calendar day the people using the app are in; the UTC day
 * (`toISOString().slice(0, 10)`) is the previous day for eight or nine hours
 * every morning in East Asia.
 */
export function localDate(d: Date = new Date()): string {
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}
