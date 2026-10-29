import { assertUploadFile } from '../../../../../src/shared/upload/policies.ts';
import { getUploadCredentials } from './credentialProvider';
import { uploadToAliyunOss } from './providers/aliyunOssProvider';
import { UploadError } from '../../../../../src/shared/upload/errors.ts';
import { getMediaDurationSeconds } from './mediaMetadata';
import type { UploadOptions, UploadResult } from '../../../../../src/shared/upload/types.ts';
import { createStoredFileName } from '../../../../../src/shared/upload/url.ts';

export async function uploadFile(file: File, options: UploadOptions = {}): Promise<UploadResult> {
  assertUploadFile(file, options.policy);
  if (options.signal?.aborted) {
    throw new UploadError('CANCELLED', '已取消上传');
  }
  const durationPromise = getMediaDurationSeconds(file);
  const credentials = await getUploadCredentials(file.name);
  if (options.signal?.aborted) {
    throw new UploadError('CANCELLED', '已取消上传');
  }
  const result = await uploadToAliyunOss(file, credentials, createStoredFileName(file.name), options);
  const duration = await durationPromise;
  return duration === undefined ? result : { ...result, duration };
}
