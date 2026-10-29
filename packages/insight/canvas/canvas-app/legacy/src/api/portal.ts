import { request } from './request';

interface RecordProps {
  companyName?: string;
  email?: string;
  industry?: string;
  industryCustom?: string;
  phoneNo: string;
  position?: string;
  requirementDesc?: string;
  teamSize?: string;
  userName?: string;
  userType: 1 | 2 | 3; // 人员类型：1-品牌方入驻，2-创作者入驻，3-套餐定制
  wechatNo?: string;
}

export const InflowRecord = (params: RecordProps) => {
  return request<RecordProps>('user-server/in-flow/record', params);
};
