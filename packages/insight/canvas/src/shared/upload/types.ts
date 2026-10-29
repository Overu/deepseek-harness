export type UploadStrategy = 'simple' | 'multipart' | 'auto';

export interface UploadProgress {
  ratio: number;
  percent: number;
  loaded: number;
  total: number;
}

export interface UploadPolicy {
  allowedMimeTypes?: string[];
  allowedExtensions?: string[];
  maxSizeBytes?: number;
  sizeBoundary?: 'inclusive' | 'exclusive';
}

export interface UploadOptions {
  policy?: UploadPolicy;
  strategy?: UploadStrategy;
  signal?: AbortSignal;
  onProgress?: (progress: UploadProgress) => void;
}

export interface UploadCredentials {
  accessKeyId: string;
  accessKeySecret: string;
  expiration: string;
  securityToken: string;
  region: string;
  bucket: string;
  dir: string;
  userId: string;
}

export interface UploadResult {
  url: string;
  objectKey: string;
  originalFileName: string;
  storedFileName: string;
  bucket: string;
  region: string;
  size: number;
  contentType: string;
  /** 音视频时长（整数秒，向上取整） */
  duration?: number;
  etag?: string;
  requestId?: string;
}

export type UploadValidationResult = { valid: true } | { valid: false; message: string };
