import { UploadError } from './errors.ts';
import type { UploadPolicy, UploadValidationResult } from './types.ts';

const getExtension = (fileName: string) => {
  const index = fileName.lastIndexOf('.');
  return index >= 0 ? fileName.slice(index).toLowerCase() : '';
};

const matchesMimeType = (mimeType: string, allowedType: string) => {
  if (allowedType.endsWith('/*')) {
    return mimeType.startsWith(allowedType.slice(0, -1));
  }
  return mimeType === allowedType;
};

export function validateUploadFile(file: File, policy?: UploadPolicy): UploadValidationResult {
  if (!file || !file.name) {
    return { valid: false, message: '请选择有效文件' };
  }
  if (!policy) return { valid: true };

  if (policy.maxSizeBytes !== undefined) {
    const exceedsLimit = policy.sizeBoundary === 'exclusive' ? file.size >= policy.maxSizeBytes : file.size > policy.maxSizeBytes;
    if (exceedsLimit) {
      return { valid: false, message: '文件大小超过限制' };
    }
  }

  const hasMimeRules = Boolean(policy.allowedMimeTypes?.length);
  const hasExtensionRules = Boolean(policy.allowedExtensions?.length);
  if (hasMimeRules || hasExtensionRules) {
    const mimeAllowed = policy.allowedMimeTypes?.some(type => matchesMimeType(file.type.toLowerCase(), type.toLowerCase())) ?? false;
    const extension = getExtension(file.name);
    const extensionAllowed = policy.allowedExtensions?.some(item => item.toLowerCase() === extension) ?? false;
    if (!mimeAllowed && !extensionAllowed) {
      return { valid: false, message: '不支持的文件类型' };
    }
  }

  return { valid: true };
}

export function assertUploadFile(file: File, policy?: UploadPolicy): void {
  const validation = validateUploadFile(file, policy);
  if (!validation.valid) {
    throw new UploadError('INVALID_FILE', validation.message);
  }
}
