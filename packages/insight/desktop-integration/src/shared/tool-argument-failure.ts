/** Diagnose rejected tool arguments from the same attempt stream used by Session replay. */
import { assembleAssistantStream, lastAssistantStreamChunk, type AssistantStreamRecord } from '@deepseek-ai/dsh-llm/assistant-stream'

/**
 * @param stream - The settled model attempt's compact stream.
 * @returns The tool name and parser diagnostic without echoed argument content.
 */
export function toolArgumentFailure(stream: readonly AssistantStreamRecord[]): { name: string; detail: string } | undefined {
  const reason = lastAssistantStreamChunk(stream, 'finish')?.reason
  if (reason?.kind !== 'error' || reason.failure.code !== 'MALFORMED_RESPONSE') return undefined
  for (const block of assembleAssistantStream(stream).blocks()) {
    if (block.type !== 'tool-call' || block.name === '' || block.arguments.trim() === '') continue
    try {
      const value: unknown = JSON.parse(block.arguments)
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return { name: block.name, detail: 'Tool arguments must be a JSON object' }
      }
    } catch (error: unknown) {
      if (!(error instanceof SyntaxError)) throw error
      // V8 can quote the argument text in a SyntaxError. Keep only its diagnosis.
      const detail = error.message.startsWith('"') ? 'Invalid JSON' : error.message.split(', "', 1)[0] ?? 'Invalid JSON'
      return { name: block.name, detail }
    }
  }
  return undefined
}
