declare module 'ali-oss' {
  export interface OSSOptions {
    bucket: string;
    region: string;
    accessKeyId: string;
    accessKeySecret: string;
    stsToken: string;
    secure?: boolean;
    refreshSTSToken?: () => Promise<{
      accessKeyId: string;
      accessKeySecret: string;
      stsToken: string;
    }>;
    refreshSTSTokenInterval?: number;
  }

  export interface OSSResponse {
    headers?: Record<string, string>;
    requestId?: string;
  }

  export interface PutResult {
    name: string;
    url: string;
    res?: OSSResponse;
  }

  export interface MultipartUploadResult {
    name: string;
    bucket?: string;
    etag?: string;
    res?: OSSResponse;
  }

  export interface MultipartUploadOptions {
    checkpoint?: unknown;
    partSize?: number;
    parallel?: number;
    headers?: Record<string, string>;
    progress?: (ratio: number, checkpoint?: unknown, response?: OSSResponse) => void | Promise<void>;
  }

  export default class OSS {
    constructor(options: OSSOptions);
    put(name: string, file: File | Blob, options?: Record<string, unknown>): Promise<PutResult>;
    multipartUpload(name: string, file: File | Blob, options?: MultipartUploadOptions): Promise<MultipartUploadResult>;
    cancel(checkpoint?: { name: string; uploadId: string; options?: Record<string, unknown> }): void;
  }
}
