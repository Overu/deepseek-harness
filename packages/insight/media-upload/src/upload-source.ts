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
  readonly recentTurns: readonly { readonly turnSeq: number; readonly sources: readonly UploadSource[] }[]
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
  recentTurns: z.array(z.object({ turnSeq: z.number().int().nonnegative(),
    sources: z.array(z.object({ seq: z.number().int().nonnegative(), file: fileSchema.nullable() })) })),
})

/** Host-only projection of direct-user file occurrences in the open turn. */
export const currentTurnUploadsProjection = {
  key: 'insightCurrentTurnUploads',
  stateVersion: 3,
  stateSchema,
  init: (_header, inheritedEventCount) => ({ inheritedCount: Number(inheritedEventCount), open: false,
    turnSeq: 0, sources: [], recentTurns: [] }),
  apply: (state, event: SessionEvent) => {
    if (Number(event.seq) < state.inheritedCount) return state
    if (event.type === 'turn/start') return { ...state, open: true, turnSeq: Number(event.seq), sources: [] }
    if (event.type === 'turn/end') return { ...state, open: false, sources: [] }
    const op = event.surfaceOp
    const replaced = typeof op === 'object'
      ? state.sources.filter(source => source.seq < Number(op.startSeq) || source.seq > Number(op.endSeq))
      : state.sources
    const recentTurns = typeof op === 'object'
      ? state.recentTurns.map(turn => ({ ...turn,
        sources: turn.sources.filter(source => source.seq < Number(op.startSeq) || source.seq > Number(op.endSeq)) }))
      : state.recentTurns
    if (!state.open) return recentTurns === state.recentTurns ? state : { ...state, recentTurns }
    if (event.type !== 'user/message' || event.data.source.kind !== 'user') {
      return replaced === state.sources && recentTurns === state.recentTurns
        ? state : { ...state, sources: replaced, recentTurns }
    }
    const additions: UploadSource[] = event.data.content.flatMap((part) => {
      if (part.type === 'file') return [{ seq: Number(event.seq), file: part.attachment }]
      if (part.type === 'image') return [{ seq: Number(event.seq), file: part.originalFile ?? null }]
      return []
    })
    const last = recentTurns.at(-1)
    const turns = last?.turnSeq === state.turnSeq
      ? [...recentTurns.slice(0, -1), { turnSeq: state.turnSeq, sources: [...last.sources, ...additions] }]
      : [...recentTurns, { turnSeq: state.turnSeq, sources: additions }].slice(-3)
    return { ...state, sources: [...replaced, ...additions], recentTurns: turns }
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

/** A directly uploaded image in one of the last three user-message turns. */
export interface LayeringSource {
  /** Content-addressed reference to select this exact original. */
  readonly sourceRef: string
  /** Original attachment filename for user selection. */
  readonly filename: string
  /** User turn containing the image. */
  readonly turnSeq: number
  /** Message event sequence containing the image. */
  readonly messageSeq: number
}

function layeringCandidates(agent: Agent, projection: ProjectionHandle<CurrentTurnUploads>) {
  const state = projection.stateOf(agent.session)
  if (!state.open) throw new Error('Use image layering in an open user conversation.')
  const candidates = new Map<string, { source: LayeringSource; file: FileAttachmentRef }>()
  for (const turn of state.recentTurns) for (const occurrence of turn.sources) {
    const file = occurrence.file
    if (!file || file.bytes < 1 || !/\.(png|jpe?g|webp)$/iu.test(file.name)) continue
    const sourceRef = String(file.attachmentId)
    candidates.set(sourceRef, { source: { sourceRef, filename: file.name,
      turnSeq: turn.turnSeq, messageSeq: occurrence.seq }, file })
  }
  return [...candidates.values()]
}

/** List eligible original images without reading their bytes.
 * @param agent - Root Agent in the current Session.
 * @param projection - Session attachment projection.
 * @returns At most three user turns of distinct image references.
 */
export function listLayeringSources(agent: Agent, projection: ProjectionHandle<CurrentTurnUploads>): LayeringSource[] {
  return layeringCandidates(agent, projection).map(candidate => candidate.source)
}

/** Resolve a selected image against the current Session's recent user uploads.
 * @param agent - Root Agent in the current Session.
 * @param sourceRef - Content-addressed reference returned by listLayeringSources.
 * @param projection - Session attachment projection.
 * @returns Original stored file reference.
 */
export function selectLayeringSource(agent: Agent, sourceRef: string | undefined,
  projection: ProjectionHandle<CurrentTurnUploads>): FileAttachmentRef {
  const candidates = layeringCandidates(agent, projection)
  if (candidates.length === 0) throw new Error('No original image is available in the last three user turns; upload it again.')
  if (!sourceRef && candidates.length !== 1) throw new Error('Choose one image from prepare_image_layering_source first.')
  const candidate = sourceRef ? candidates.find(item => item.source.sourceRef === sourceRef) : candidates[0]
  if (!candidate) throw new Error('The selected image is outside the last three user turns; choose again.')
  return candidate.file
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
