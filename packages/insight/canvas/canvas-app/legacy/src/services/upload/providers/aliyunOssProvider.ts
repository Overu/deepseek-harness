import OSS, { type OSSResponse } from 'ali-oss';
import { MULTIPART_UPLOAD_THRESHOLD } from '../../../../../../src/shared/upload/constants.ts';
import { UploadError, toUploadError } from '../../../../../../src/shared/upload/errors.ts';
import { buildPublicObjectUrl, joinObjectKey } from '../../../../../../src/shared/upload/url.ts';
import type { UploadCredentials, UploadOptions, UploadProgress, UploadResult, UploadStrategy } from '../../../../../../src/shared/upload/types.ts';
import { getUploadCredentials } from '../credentialProvider';

const UPLOAD_CACHE_CONTROL = 'max-age=31536000, immutable';

const resolveStrategy = (file: File, strategy: UploadStrategy = 'simple'): Exclude<UploadStrategy, 'auto'> => {
  if (strategy === 'auto') {
    return file.size >= MULTIPART_UPLOAD_THRESHOLD ? 'multipart' : 'simple';
  }
  return strategy;
};

const getRequestId = (response?: OSSResponse) => response?.requestId || response?.headers?.['x-oss-request-id'];

const createProgress = (file: File, ratio: number): UploadProgress => {
  const normalizedRatio = Math.max(0, Math.min(1, ratio));
  return {
    ratio: normalizedRatio,
    percent: Math.round(normalizedRatio * 100),
    loaded: Math.round(file.size * normalizedRatio),
    total: file.size,
  };
};

export async function uploadToAliyunOss(file: File, credentials: UploadCredentials, storedFileName: string, options: UploadOptions): Promise<UploadResult> {
  const objectKey = joinObjectKey(credentials.dir, storedFileName);
  if (!objectKey) {
    throw new UploadError('INVALID_FILE', '无法生成有效的文件存储路径');
  }

  const client = new OSS({
    bucket: credentials.bucket,
    region: credentials.region,
    accessKeyId: credentials.accessKeyId,
    accessKeySecret: credentials.accessKeySecret,
    stsToken: credentials.securityToken,
    secure: true,
    refreshSTSToken: async () => {
      const refreshed = await getUploadCredentials(file.name);
      if (refreshed.userId !== credentials.userId) {
        throw new UploadError('INVALID_STS_RESPONSE', '上传期间用户已切换，请重新上传');
      }
      return {
        accessKeyId: refreshed.accessKeyId,
        accessKeySecret: refreshed.accessKeySecret,
        stsToken: refreshed.securityToken,
      };
    },
  });

  const handleAbort = () => client.cancel();
  if (options.signal?.aborted) {
    throw new UploadError('CANCELLED', '已取消上传');
  }
  options.signal?.addEventListener('abort', handleAbort, { once: true });

  try {
    const strategy = resolveStrategy(file, options.strategy);
    let url = '';
    let etag: string | undefined;
    let response: OSSResponse | undefined;

    if (strategy === 'multipart') {
      const result = await client.multipartUpload(objectKey, file, {
        headers: {
          'Cache-Control': UPLOAD_CACHE_CONTROL,
        },
        progress: ratio => {
          options.onProgress?.(createProgress(file, ratio));
        },
      });
      response = result.res;
      etag = result.etag;
      url = buildPublicObjectUrl(credentials.bucket, credentials.region, objectKey);
    } else {
      const result = await client.put(objectKey, file, {
        headers: {
          'Cache-Control': UPLOAD_CACHE_CONTROL,
        },
      });
      response = result.res;
      url = result.url;
    }

    if (options.signal?.aborted) {
      throw new UploadError('CANCELLED', '已取消上传');
    }

    const publicUrl = url || buildPublicObjectUrl(credentials.bucket, credentials.region, objectKey);
    if (!publicUrl) {
      throw new UploadError('PUBLIC_URL_MISSING', '上传成功但未获得文件访问地址');
    }

    options.onProgress?.(createProgress(file, 1));

    return {
      url: publicUrl,
      objectKey,
      originalFileName: file.name,
      storedFileName,
      bucket: credentials.bucket,
      region: credentials.region,
      size: file.size,
      contentType: file.type,
      etag,
      requestId: getRequestId(response),
    };
  } catch (error) {
    throw toUploadError(error);
  } finally {
    options.signal?.removeEventListener('abort', handleAbort);
  }
}
