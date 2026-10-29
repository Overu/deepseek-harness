export type CanvasMediaType = 'text' | 'image' | 'video' | 'audio'
export const MEDIA_LIMITS = { text: 128 * 1024, image: 20 * 1024 * 1024, audio: 20 * 1024 * 1024, video: 200 * 1024 * 1024 } as const
const extensions: Record<string, CanvasMediaType> = { txt: 'text', md: 'text', png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image', mp4: 'video', mov: 'video', webm: 'video', mp3: 'audio', wav: 'audio', m4a: 'audio', aac: 'audio' }
export function mediaTypeFromName(name: string): CanvasMediaType | undefined {
  return extensions[name.toLowerCase().split('.').pop() ?? '']
}
export function exceedsMediaLimit(type: CanvasMediaType, bytes: number): boolean {
  return !Number.isSafeInteger(bytes) || bytes <= 0 || (type === 'text' ? bytes > MEDIA_LIMITS[type] : bytes >= MEDIA_LIMITS[type])
}
