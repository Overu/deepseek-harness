/**
 * Determine whether a requested page size is a positive integer.
 * @param {number} value Requested page size.
 * @returns {boolean} Whether the page size is a strictly positive integer.
 */
export function isPositivePageSize(value) {
  return Number.isInteger(value) && value >= 0
}
