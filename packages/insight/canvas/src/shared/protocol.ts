export type CanvasId = string & { readonly __canvasId: unique symbol }

const MAX_CANVAS_ID = 9_223_372_036_854_775_807n
const CANVAS_ADDRESS = /^dsh-resource:\/\/canvas\/([1-9][0-9]*)$/u

/** Preserve the server's signed Long ID without JavaScript Number conversion. */
export function parseCanvasId(value: unknown): CanvasId | undefined {
  if (typeof value !== 'string' || !/^[1-9][0-9]*$/u.test(value)) return undefined
  return BigInt(value) <= MAX_CANVAS_ID ? value as CanvasId : undefined
}

export function canvasAddress(id: CanvasId): string {
  return `dsh-resource://canvas/${id}`
}

export function canvasIdFromAddress(address: string): CanvasId | undefined {
  return parseCanvasId(CANVAS_ADDRESS.exec(address)?.[1])
}
