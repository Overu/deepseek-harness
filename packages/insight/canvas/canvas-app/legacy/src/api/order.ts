import { request } from './request';
import type { WorkFlowExcute, CanvasRequestOptions } from './workflow';

// 定义客户端类型枚举
export enum ClientType {
  PC = 'PC',
  MINI_APP = 'MINI_APP',
  H5 = 'H5',
}

// 定义商品类型（根据实际业务补充具体值）
type PayType = 'ALIPAY_PC' | 'WX_NATIVE';
export type PaymentMethod = PayType;
export type ProductType = 'POINT_PACKAGE' | 'SUBSCRIBE_MEMBERSHIP';

// 创建订单请求参数类型
interface CreateOrderParams {
  // payWay: PayType;
  paymentMethod: PayType;
  // productType: ProductType;
  resultIds: any[];
  // [key: string]: any; // 允许其他额外字段
}

// 创建订单请求参数类型
interface CreateOrderPros {
  paymentMethod: PayType;
  amount?: number;
  membershipPlanId?: number;
  productType?: ProductType;
  pointPackageId?: number;
}

export interface CreatePayOrderParams {
  productType: ProductType;
  paymentMethod?: PaymentMethod;
  pointPackageId?: number;
  membershipPlanId?: number;
  amount?: number;
}

// 查询订单状态请求参数类型
interface GetOrderStatusParams {
  orderNo: string;
  [key: string]: any; // 允许其他额外字段
}

// 查询支付方式请求参数类型
// interface MethodQueryParams {
//   clientType: ClientType;
//   // [key: string]: any; // 允许其他额外字段
// }
interface MethodQueryParams {
  clientType: string;
}

// 分页查询订单列表请求参数类型（示例，根据实际接口调整）
interface GetOrderListParams {
  pageNo?: number;
  pageSize?: number;
  timeOrder?: string;
  // [key: string]: any; // 允许其他筛选字段
}

interface PointPackageListRequest {
  // 示例属性，可根据实际需求修改/删除
  [key: string]: any;
}

export interface PointPackageItem {
  id: number;
  points: number;
  point1: number;
  point2: number;
  pricing_mode?: 'FIXED' | 'RATIO';
  ratio?: number;
  point_ratio?: number;
  description?: string;
  package_code?: string;
  package_name?: string;
  original_price?: number;
  sale_price?: number;
  expire_rule?: string;
  sort_order?: number;
  minimum_recharge_amount?: number;
}

export interface PointPackagesResponse {
  code: string;
  msg?: string;
  data?: {
    reason?: string;
    can_purchase?: boolean;
    items?: PointPackageItem[];
  };
}

// 刷新支付二维码请求参数类型（根据实际接口补充）
interface RefreshOrderParams {
  orderNo?: string;
  [key: string]: any; // 允许其他额外字段
}

export interface GiftPointVo {
  id: number;
  type: string;
  points: number;
  expiredTime: string;
  memberShipName: string;
}

export interface AccountBalanceData {
  rechargeBalance?: number | string | null;
  giftBalance?: number | string | null;
  giftPointVoList?: GiftPointVo[] | null;
}

export interface AccountBalanceResponse {
  code: string | number;
  data?: AccountBalanceData;
  msg?: string;
  message?: string;
}

export interface WorkflowCostData {
  original_points: number;
  discounted_points: number;
  discount_applied: boolean;
}

export interface GiftPointsExpirationItem {
  expiration_date: string;
  points: number;
}

export interface GiftPointsExpirationParams {
  page_no?: number;
  page_size?: number;
}

export interface GiftPointsExpirationResult {
  gift_balance: number;
  total: number;
  items: GiftPointsExpirationItem[];
}

export interface MembershipPurchaseRecord {
  plan_name: string;
  purchase_time: string;
  effective_time: string;
  expiration_time: string;
}

export interface MembershipPurchaseRecordsParams {
  page_no?: number;
  page_size?: number;
}

export interface MembershipPurchaseRecordsResult {
  total: number;
  items: MembershipPurchaseRecord[];
}

interface AccountBalanceParams {
  timestamp: string;
}

/**
 * @brief: 创建订单
 * @param data 请求体
 * @param paymentMethod 支付方式
 * @param productType 商品类型
 * @param resultList 待付款文件列表
 * @return {*}
 * @note: 注意点
 */
export const createOrder = (data: CreateOrderParams) => {
  return request(`aladdin-order/api/order/create`, data);
};

/**
 * @brief: 查询订单状态
 * @param data 请求体
 * @param orderNo 订单编号
 * @return {*}
 * @note: 注意点
 */
export const getOrderStatus = (data: GetOrderStatusParams) => {
  return request(`aladdin-order/api/order/status`, data);
};

/**
 * @brief: 查询支付方式
 * @param data 请求体
 * @param clientType 客户端类型PC("PC", "PC端"),MINI_APP("MINI_APP", "小程序"),H5("H5", "H5页面")
 * @return {*}
 * @note: 注意点
 */
export const methodQuery = (data: MethodQueryParams) => {
  return request(`aladdin-order/api/pay/method/query`, data);
};

/**
 * @brief: 分页查询订单列表
 * @param data 请求体
 * @return {*}
 * @note: 注意点
 */
export const getOrderList = (data: GetOrderListParams) => {
  return request(`aladdin-order/api/order/list`, data);
};

/**
 * @brief: 刷新支付二维码
 * @param data 请求体
 * @return {*}
 * @note: 注意点
 */
export const refreshOrder = (data: RefreshOrderParams) => {
  return request(`aladdin-order/api/order/refresh`, data);
};

export const pointPackageList = (params: PointPackageListRequest) => {
  return request(`aladdin-order/api/product/pointPackageList`, params);
};

export const queryPointPackages = () => {
  return request(`order-server/api/point-packages`, null, {
    method: 'get',
  });
};

/**
 * @brief: 查询充值明细、赠送明细、扣减明细
 * @param [String] flowType 流水类型
 * @param [pageQueryVO: {page,size}] pageQueryVO 分页信息
 * @return {*}
 * @note: 注意点
 */
export const accountFlow = (data: any) => {
  return request(`account-service/api/account/flow`, data);
};

/**
 * @brief: 查询消费记录
 * @param [String] type 流水类型
 * @param [pageQueryVO: {page,size}] pageQueryVO 分页信息
 * @return {*}
 * @note: 注意点
 */
export const purchaseFlow = (data: any) => {
  return request(`order-server/api/account/purchaseFlow`, data);
};

/**
 * @brief: 查询用户赛点余额
 * @param [String] timestamp 当前时间戳 没有实际意义,防止验签不通过
 * @return {*}
 * @note: 注意点
 */
export const accountBalance = (data: AccountBalanceParams, options?: import('./workflow').CanvasRequestOptions) => {
  return request<AccountBalanceData>(`account-service/api/account/balance`, data, options) as Promise<AccountBalanceResponse>;
};

/**
 * @brief: 查询赠送赛点过期明细
 */
export const queryGiftPointsExpiration = (params: GiftPointsExpirationParams = {}) => {
  return request<GiftPointsExpirationResult>('account-service/api/account/gift-points/expiration', params, {
    method: 'get',
  });
};

/**
 * @brief: 计算AI员工赛点消耗
 * @return {*}
 * @note: 注意点
 */
export const calculateAiEmployee = (data: any) => {
  return request(`order-server/api/cost/calculateAiEmployee`, data);
};

/**
 * @brief: 判断AI员工赛点是否足够
 * @return {*}
 * @note: 注意点
 */
export const isBalanceSufficient = (data: any) => {
  return request(`order-server/api/cost/isBalanceSufficient`, data);
};

/**
 * @brief: 创建赛点充值订单
 * @param data 请求体
 * @param paymentMethod 支付方式
 * @param amount 金额（人民币，单位：分）
 * @return {*}
 * @note: 注意点
 */
export const createAmountOrder = (data: CreateOrderPros | CreatePayOrderParams) => {
  return request(`order-server/api/order/create`, data);
};

/**
 * @brief: 查询订单状态
 * @param data 请求体
 * @param orderNo 订单编号
 * @return {*}
 * @note: 注意点
 */
export const getAmountOrderStatus = (data: GetOrderStatusParams) => {
  return request(`order-server/api/order/status`, data);
};

/**
 * @brief: 刷新支付二维码
 * @param data 请求体
 * @return {*}
 * @note: 注意点
 */
export const refreshAmountOrder = (data: RefreshOrderParams) => {
  return request(`order-server/api/order/refresh`, data);
};

/**
 * @brief: 获取会员套餐列表
 * @param billingMode 计费模式：ONE_YEAR、ONE_MONTH
 * @return {*}
 * @note: 注意点
 */
export const getMembershipPlans = (billingMode: string) => {
  return request(`order-server/api/membership/getPlan?billingMode=${billingMode}`);
};

export const queryMembershipPlans = () => {
  // return request(`membership-service/api/feign/membership/plans/query?page_no=1&page_size=20`, null, {
  //   method: 'post',
  // });
  return request(`membership-service/api/membership/plans?plan_type=PERIOD`, null, {
    method: 'get',
  });
};

/**
 * @brief: 获取当前生效的会员套餐
 * @return {*}
 * @note: 注意点
 */
export const getCurrentMembershipPlan = () => {
  return request(`membership-service/api/membership/currentMembershipPlan`, null, {
    method: 'get',
  });
};

/**
 * @brief: 查询当前用户非普通会员购买记录
 */
export const queryMembershipPurchaseRecords = (params: MembershipPurchaseRecordsParams = {}) => {
  return request<MembershipPurchaseRecordsResult>('membership-service/api/membership/purchase-records', params, {
    method: 'get',
  });
};

/**
 * @brief: 计算工作流点数消耗
 * @param data WorkFlowExcute 请求体
 * @param signal AbortSignal 取消请求的信号
 */
export const calculateWorkflowCost = (data: WorkFlowExcute, signal?: AbortSignal, options?: CanvasRequestOptions) => {
  return request<WorkflowCostData>(`order-server/api/cost/calculate`, data, {
    ...options, signal: signal ?? options?.signal,
  });
};
