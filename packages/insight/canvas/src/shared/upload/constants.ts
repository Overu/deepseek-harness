export const UPLOAD_LIBRARY_ID = '1001' as const;
export const UPLOAD_TYPE = 1 as const;
export const UPLOAD_CREDENTIAL_EXPIRY_SKEW_MS = 5 * 60 * 1000;

/** 阿里云建议大于等于 100MB 的文件使用分片上传。启用前需确认后端权限。 */
export const MULTIPART_UPLOAD_THRESHOLD = 100 * 1024 * 1024;
