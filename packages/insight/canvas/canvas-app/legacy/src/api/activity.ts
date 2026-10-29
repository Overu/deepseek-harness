/**
 * 活动兑换码（用户端）
 * 接口文档: src/components/auth/兑换码用户端.md
 */
import { request } from './request';

/**
 * 通用响应壳（项目统一风格）
 * - success 判定: code === 200 || String(code) === '0' || code === 'SUCCESS'
 *   （由 request.ts responseInterceptor 内部处理；这里仅做类型声明）
 */
export interface ApiResponse<T> {
  code?: string | number;
  msg?: string;
  message?: string;
  data?: T;
  body?: T;
  success?: boolean;
}

/* =========================================================================
 * POST 兑换权益
 *   POST /api/activity/redeem
 *   Body: { code: string }   —— 客户端只提交兑换码
 *   成功: { code: 0, message: "恭喜您兑换成功！已发放【XX】+【XX】...", data: { redeemId } }
 *   失败 (409): { code: 409, message: "校验码无效..." }
 * ========================================================================= */

/** 兑换成功返回 */
export interface RedeemResult {
  /** 核销记录 ID */
  redeemId: string | null;
}

/**
 * 发起兑换
 *   用 silentError=true 关闭 request 层的自动 toast，
 *   失败时组件内将 msg 映射为输入框下方的 inline 红色文案；
 *   成功时组件内再显式 toast.success(response.message)。
 */
export const redeemCode = (code: string) => {
  return request<RedeemResult>('activity-service/api/activity/redeem', { code }, { method: 'POST', silentError: true });
};

/* =========================================================================
 * GET 查询本人兑换记录
 *   GET /api/activity/redeem/records?page=1&size=20
 *   仅查询当前登录用户，不接受 userId 参数
 * ========================================================================= */

export interface RedeemRecord {
  id: number;
  /** 兑换码（脱敏展示或完整） */
  code: string;
  userId: number;
  /** 历史兑换活动名称 */
  activityName: string;
  /** 赛点奖励数量（可能为 null） */
  pointsAmount: number | null;
  membershipPlanId: number | null;
  /** 会员类型名称（如 "专业版月付会员"） */
  membershipPlanName: string | null;
  /** 会员权益到期时间（ISO 字符串，可能为 null） */
  membershipExpireTime: string | null;
  /** 会员权益生效时间（ISO 字符串，可能为 null） */
  membershipEffectiveTime: string | null;
  status: number;
  /** 核销时间（ISO 字符串） */
  redeemTime: string;
}

export interface RedeemRecordsPage {
  list: RedeemRecord[];
  total: number;
  page: number;
  size: number;
}

/** 查询兑换记录分页 */
export const getRedeemRecords = (page: number, size: number, sortOrder: string) => {
  return request<RedeemRecordsPage>('activity-service/api/activity/redeem/records', { page, size, sortOrder }, { method: 'GET', silentError: true });
};
