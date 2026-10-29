import { request } from './request';

interface PedestalEventPros {
  module?: string; // 模块：AI_EMPLOYEE, AI_GROUP, WORKFLOW
  eventType?: string; // 事件类型: click/view
  objectType?: string; // 目标对象类型：ai_employee、ai_group、workflow、canvas
  objectId?: number | null; // 目标对象ID
  eventParam?: any;
}

interface HeadConfigPros {
  headers: {
    deviceId: string;
    uuid: string;
    extinfo: string;
  };
}

/**
 * 数据上报
 * @param params 任务id
 */
export const pedestalEvent = (params: PedestalEventPros, headConfig: HeadConfigPros) => {
  return request('data-report-server/pedestalEvent', params, headConfig);
};

export interface AnnouncementMessage {
  userMessageId: number;
  messageId: number;
  categoryCode: string;
  messageType: string;
  title: string;
  summary: string;
  content: string;
  senderType: string;
  senderId: number | null;
  jumpType: string;
  jumpUrl: string | null;
  detailEnabled: number;
  priority: number;
  publishedAt: string;
  expiredAt: string | null;
  extraJson: string | null;
  readStatus: number;
  readAt: string | null;
  receivedAt: string;
}

/** 公告 */
export const getAnnouncement = () => {
  return request<AnnouncementMessage[]>('user-server/message/getAnnouncementMsg', null, {
    method: 'GET',
  });
};
