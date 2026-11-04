/** Return the arithmetic mean; empty input returns zero.
 * @param values Input values.
 * @returns Arithmetic mean, or zero for no values.
 */
export function mean(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0) / values.length
}
