import { canvasIdFromAddress } from './protocol.ts'
/** Recognize only the agreed ID-only answer. Other Markdown stays owned by its native renderer. */
export function canvasIdAnswer(text: string): { id: string
  address: string } | undefined {
  const match = /^\s*当前画布\s*ID\s*[:：]\s*\[([1-9][0-9]*)\]\((dsh-resource:\/\/canvas\/[1-9][0-9]*)\)[。.]?\s*$/u.exec(text)
  if (!match || canvasIdFromAddress(match[2]) !== match[1]) return
  return { id: match[1], address: match[2] }
}
