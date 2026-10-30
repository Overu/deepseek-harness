import { request } from './request'

export interface GetStsTokenParams {
  fileName: string
  libraryId: '1001'
  type: 1
}

export interface StsCredentialData {
  accessKeyId: string
  accessKeySecret: string
  expiration: string
  securityToken: string
  url: string | null
  region: string
  bucket: string
  durationSeconds: number
  dir: string
  fileName: string
  endPoint: string
  userId: string | number
}

export interface GetStsTokenResponse {
  code: 'SUCCESS'
  msg: string
  data: StsCredentialData
}

export const getStsToken = (params: GetStsTokenParams) => {
  return request('game-ai-editor-center/upload/sts/token', params) as Promise<GetStsTokenResponse>
}

export interface UploadAssetParams {
  assetType: number
  fileUrl: string
  canvasId: number
  nodeId: string
  /** 0=上传，1=生成 */
  source: number
  /** 由 source 推导：0→upload，1→workflow */
  sourceType: 'upload' | 'workflow'
  /** source=1 时传递，JSON 字符串，含 toolNodeName / toolNodeKey */
  sourceParam?: string
  /** 音视频时长（整数秒） */
  duration?: number
}

export const uploadAssetToLibrary = (params: UploadAssetParams) => {
  return request('game-ai-editor-center/upload/asset', params, { silentError: true })
}
