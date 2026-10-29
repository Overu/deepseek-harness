export type FilePreviewType = 'image' | 'video' | 'audio' | 'text' | 'unknown';

export interface FilePreviewItem {
  id: string;
  type: FilePreviewType;
  url: string;
  thumbnailUrl?: string;
  name?: string;
  text?: string;
}
