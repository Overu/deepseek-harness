import { getStsToken, type GetStsTokenResponse, type StsCredentialData } from '@/api/upload';
import { UPLOAD_LIBRARY_ID, UPLOAD_TYPE } from '../../../../../src/shared/upload/constants.ts';
import { UploadError } from '../../../../../src/shared/upload/errors.ts';
import type { UploadCredentials } from '../../../../../src/shared/upload/types.ts';

const REQUIRED_NON_EMPTY_CREDENTIAL_FIELDS: (keyof StsCredentialData)[] = ['accessKeyId', 'accessKeySecret', 'securityToken', 'expiration', 'region', 'bucket'];

const isValidCredentialData = (data: StsCredentialData | undefined): data is StsCredentialData => {
  if (!data) return false;
  return (
    typeof data.dir === 'string' &&
    ((typeof data.userId === 'number' && Number.isSafeInteger(data.userId) && data.userId > 0) ||
      (typeof data.userId === 'string' && /^[1-9][0-9]{0,18}$/.test(data.userId) && BigInt(data.userId) <= 9223372036854775807n)) &&
    REQUIRED_NON_EMPTY_CREDENTIAL_FIELDS.every(field => typeof data[field] === 'string' && String(data[field]).length > 0)
  );
};

const toUploadCredentials = (data: StsCredentialData): UploadCredentials => ({
  accessKeyId: data.accessKeyId,
  accessKeySecret: data.accessKeySecret,
  expiration: data.expiration,
  securityToken: data.securityToken,
  region: data.region,
  bucket: data.bucket,
  dir: data.dir,
  userId: String(data.userId),
});

// The Host resolves the desktop user for every request; iframe credentials must not survive an account change.
export async function getUploadCredentials(fileName: string): Promise<UploadCredentials> {
  let response: GetStsTokenResponse;
  try {
    response = await getStsToken({
      fileName,
      libraryId: UPLOAD_LIBRARY_ID,
      type: UPLOAD_TYPE,
    });
  } catch (error) {
    throw new UploadError('STS_REQUEST_FAILED', '获取上传凭证失败，请重试', { retryable: true, cause: error });
  }

  if (response.code !== 'SUCCESS' || !isValidCredentialData(response.data)) {
    throw new UploadError('INVALID_STS_RESPONSE', '上传凭证返回格式不正确');
  }

  const expiration = Date.parse(response.data.expiration);
  if (!Number.isFinite(expiration) || expiration <= Date.now()) {
    throw new UploadError('STS_EXPIRED', '上传凭证已过期，请重试', { retryable: true });
  }

  return toUploadCredentials(response.data);
}
