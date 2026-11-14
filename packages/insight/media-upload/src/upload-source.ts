/** Current-turn, direct-user attachment authority for the media upload tool. */

import { z } from 'zod'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { AttachmentId, type AttachmentStore, type FileAttachmentRef, type ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { ProjectionDefinition, ProjectionHandle } from '@deepseek-ai/dsh-session-projection'

/** A committed direct-user attachment selected without accepting a model-supplied path. */
export type UploadSourceRef =
  | { readonly kind: 'file'
    readonly ref: FileAttachmentRef }
  | { readonly kind: 'image'
    readonly ref: Pick<ImageAttachmentRef, 'attachmentId' | 'mediaType' | 'bytes' | 'width' | 'height'>
    readonly name: string | null }

interface UploadSource {
  readonly seq: number
  readonly attachment: UploadSourceRef
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
const imageSchema = z.object({
  attachmentId: z.string().regex(/^sha256:[a-f0-9]{64}$/u).transform(AttachmentId),
  mediaType: z.enum(['image/png', 'image/jpeg', 'image/webp', 'image/gif']),
  bytes: z.number().int().positive(), width: z.number().int().positive(), height: z.number().int().positive(),
})
const sourceSchema: z.ZodType<UploadSourceRef> = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('file'), ref: fileSchema }),
  z.object({ kind: z.literal('image'), ref: imageSchema, name: z.string().nullable() }),
])
const stateSchema: z.ZodType<CurrentTurnUploads> = z.object({
  inheritedCount: z.number().int().nonnegative(),
  open: z.boolean(),
  turnSeq: z.number().int().nonnegative(),
  sources: z.array(z.object({ seq: z.number().int().nonnegative(), attachment: sourceSchema })),
  recentTurns: z.array(z.object({ turnSeq: z.number().int().nonnegative(),
    sources: z.array(z.object({ seq: z.number().int().nonnegative(), attachment: sourceSchema })) })),
})

/** Host-only projection of direct-user file occurrences in the open turn. */
export const currentTurnUploadsProjection = {
  key: 'insightCurrentTurnUploads',
  stateVersion: 5,
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
    const additions = event.data.content.flatMap<UploadSource>((part) => {
      if (part.type === 'file') return [{ seq: Number(event.seq), attachment: { kind: 'file', ref: part.attachment } }]
      if (part.type === 'image') {
        const { attachmentId, mediaType, bytes, width, height } = part.attachment
        return [{ seq: Number(event.seq), attachment: { kind: 'image',
          ref: { attachmentId, mediaType, bytes, width, height }, name: part.attachment.name ?? null } }]
      }
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
  /** Kind-qualified content-addressed reference to select this stored image. */
  readonly sourceRef: string
  /** Upload display name for user selection. */
  readonly filename: string
  /** User turn containing the image. */
  readonly turnSeq: number
  /** Message event sequence containing the image. */
  readonly messageSeq: number
}

function layeringCandidates(agent: Agent, projection: ProjectionHandle<CurrentTurnUploads>) {
  const state = projection.stateOf(agent.session)
  if (!state.open) throw new Error('Use image layering in an open user conversation.')
  const candidates = new Map<string, { source: LayeringSource; attachment: UploadSourceRef }>()
  for (const turn of state.recentTurns) for (const occurrence of turn.sources) {
    const attachment = occurrence.attachment
    if (attachment.ref.bytes < 1 || (attachment.kind === 'file' ? !/\.(png|jpe?g|webp)$/iu.test(attachment.ref.name)
      : !['image/png', 'image/jpeg', 'image/webp'].includes(attachment.ref.mediaType))) continue
    const sourceRef = `${attachment.kind}:${String(attachment.ref.attachmentId)}`
    candidates.set(sourceRef, { source: { sourceRef, filename: attachment.kind === 'file' ? attachment.ref.name : attachment.name ?? 'image',
      turnSeq: turn.turnSeq, messageSeq: occurrence.seq }, attachment })
  }
  return [...candidates.values()]
}

/** List eligible stored images without reading their bytes.
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
 * @returns Selected stored file or normalized image reference.
 */
export function selectLayeringSource(agent: Agent, sourceRef: string | undefined,
  projection: ProjectionHandle<CurrentTurnUploads>): UploadSourceRef {
  const candidates = layeringCandidates(agent, projection)
  if (candidates.length === 0) throw new Error('No eligible image is available in the last three user turns; upload it again.')
  if (!sourceRef && candidates.length !== 1) throw new Error('Choose one image from prepare_image_layering_source first.')
  const candidate = sourceRef ? candidates.find(item => item.source.sourceRef === sourceRef
    || (item.attachment.kind === 'file' && String(item.attachment.ref.attachmentId) === sourceRef)) : candidates[0]
  if (!candidate) throw new Error('The selected image is outside the last three user turns; choose again.')
  return candidate.attachment
}

/** Select exactly one committed current-turn attachment.
 * @param agent - Root Agent whose exact Session supplies the committed user messages.
 * @param index - One-based occurrence, omitted only when the turn has one attachment.
 * @param projection - Ready private Host projection for the current Session.
 * @returns Stored file or normalized image reference; never a client-supplied path.
 */
export function selectUploadSource(agent: Agent, index: number | undefined,
  projection: ProjectionHandle<CurrentTurnUploads>): UploadSourceRef {
  const state = projection.stateOf(agent.session)
  if (!state.open || state.sources.length === 0) throw new Error('No user attachment is available in the current turn.')
  if (index !== undefined && (!Number.isSafeInteger(index) || index < 1)) throw new Error('attachmentIndex must be a positive integer.')
  if (index === undefined && state.sources.length !== 1) throw new Error('Specify attachmentIndex for one of the current-turn attachments.')
  const selected = state.sources[(index ?? 1) - 1]
  if (selected === undefined) throw new Error('attachmentIndex is outside the current-turn attachment list.')
  if (!Number.isSafeInteger(selected.attachment.ref.bytes) || selected.attachment.ref.bytes < 1) {
    throw new Error('File size is invalid for OSS upload.')
  }
  return selected.attachment
}

/** Preserve the verified normalized encoding while giving STS a matching filename.
 * @param attachments - Image reader and verbatim-file store.
 * @param source - Committed user attachment selected from this Session.
 * @param signal - Tool cancellation before the local file is committed.
 * @returns Existing file reference, or a file reference to the normalized image bytes.
 */
export async function uploadFileForSource(attachments: Pick<AttachmentStore, 'readImage' | 'saveFile'>,
  source: UploadSourceRef, signal: AbortSignal): Promise<FileAttachmentRef> {
  if (source.kind === 'file') return source.ref
  const { data } = await attachments.readImage(source.ref, signal)
  signal.throwIfAborted()
  const ext = ({ 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' } as const)[source.ref.mediaType]
  const name = `${(source.name ?? 'image').replace(/\.(png|jpe?g|webp|gif)$/iu, '')}.${ext}`
  return attachments.saveFile({ data, name })
}
