/** Current-turn, direct-user attachment authority for the media upload tool. */

import { z } from 'zod'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { AttachmentId, type FileAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { ProjectionDefinition, ProjectionHandle } from '@deepseek-ai/dsh-session-projection'

interface UploadSource {
  readonly seq: number
  readonly file: FileAttachmentRef | null
}

interface CurrentTurnUploads {
  readonly inheritedCount: number
  readonly open: boolean
  readonly turnSeq: number
  readonly sources: readonly UploadSource[]
}

const fileSchema = z.object({
  attachmentId: z.string().regex(/^sha256:[a-f0-9]{64}$/u).transform(AttachmentId),
  name: z.string(),
  bytes: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
})
const stateSchema: z.ZodType<CurrentTurnUploads> = z.object({
  inheritedCount: z.number().int().nonnegative(),
  open: z.boolean(),
  turnSeq: z.number().int().nonnegative(),
  sources: z.array(z.object({ seq: z.number().int().nonnegative(), file: fileSchema.nullable() })),
})

/** Host-only projection of direct-user file occurrences in the open turn. */
export const currentTurnUploadsProjection = {
  key: 'insightCurrentTurnUploads',
  stateVersion: 2,
  stateSchema,
  init: (_header, inheritedEventCount) => ({ inheritedCount: Number(inheritedEventCount), open: false, turnSeq: 0, sources: [] }),
  apply: (state, event: SessionEvent) => {
    if (Number(event.seq) < state.inheritedCount) return state
    if (event.type === 'turn/start') return { ...state, open: true, turnSeq: Number(event.seq), sources: [] }
    if (event.type === 'turn/end') return { ...state, open: false, sources: [] }
    if (!state.open) return state
    const op = event.surfaceOp
    const replaced = typeof op === 'object'
      ? state.sources.filter(source => source.seq < Number(op.startSeq) || source.seq > Number(op.endSeq))
      : state.sources
    if (event.type !== 'user/message' || event.data.source.kind !== 'user') {
      return replaced === state.sources ? state : { ...state, sources: replaced }
    }
    const additions: UploadSource[] = event.data.content.flatMap((part) => {
      if (part.type === 'file') return [{ seq: Number(event.seq), file: part.attachment }]
      if (part.type === 'image') return [{ seq: Number(event.seq), file: part.originalFile ?? null }]
      return []
    })
    return additions.length === 0 && replaced === state.sources ? state : { ...state, sources: [...replaced, ...additions] }
  },
} satisfies ProjectionDefinition<'insightCurrentTurnUploads', CurrentTurnUploads>

/** Return the open turn identifier used to bind successful OSS uploads to this turn.
 * @param agent - Root Agent in the current Session.
 * @param projection - Registered current-turn attachment projection.
 * @returns Start event sequence of the open turn, or undefined when closed.
 */
export function uploadTurnSeq(agent: Agent, projection: ProjectionHandle<CurrentTurnUploads>): number | undefined {
  const state = projection.stateOf(agent.session)
  return state.open ? state.turnSeq : undefined
}

/** Select exactly one committed current-turn attachment; a missing image original is refused.
 * @param agent - Root Agent whose exact Session supplies the committed user messages.
 * @param index - One-based occurrence, omitted only when the turn has one attachment.
 * @param projection - Ready private Host projection for the current Session.
 * @returns Verbatim file reference; never a normalized image or client-supplied path.
 */
export function selectUploadSource(agent: Agent, index: number | undefined,
  projection: ProjectionHandle<CurrentTurnUploads>): FileAttachmentRef {
  const state = projection.stateOf(agent.session)
  if (!state.open || state.sources.length === 0) throw new Error('No user attachment is available in the current turn.')
  if (index !== undefined && (!Number.isSafeInteger(index) || index < 1)) throw new Error('attachmentIndex must be a positive integer.')
  if (index === undefined && state.sources.length !== 1) throw new Error('Specify attachmentIndex for one of the current-turn attachments.')
  const selected = state.sources[(index ?? 1) - 1]
  if (selected === undefined) throw new Error('attachmentIndex is outside the current-turn attachment list.')
  if (selected.file === null) throw new Error('The original bytes of this image are unavailable; upload it again.')
  if (!Number.isSafeInteger(selected.file.bytes) || selected.file.bytes < 1) {
    throw new Error('File size is invalid for OSS upload.')
  }
  return selected.file
}
