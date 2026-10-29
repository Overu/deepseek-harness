import { pedestalEvent } from '@/api/report';
import { v4 as uuidv4 } from 'uuid';
import FingerprintJS from '@fingerprintjs/fingerprintjs';

export const isMobile = (): boolean => {
  if (typeof window === 'undefined' || typeof window.navigator === 'undefined') {
    return false;
  }
  const mobileKeywords = /Mobile|Android|iPhone|iPad|iPod|BlackBerry|Windows Phone|SymbianOS/gi;
  return mobileKeywords.test(window.navigator.userAgent);
};

const getDeviceIdId = async () => {
  const fp = await FingerprintJS.load();
  const result = await fp.get();
  return result?.visitorId;
};

const getSafeDeviceId = async (): Promise<string> => {
  try {
    return (await getDeviceIdId()) || '';
  } catch (error) {
    console.error('获取 deviceId 失败：', error);
    return '';
  }
};

/**
 * 基础上报方法
 * @param data 上报数据
 */
export const reportData = async (data: Record<string, any>) => {
  try {
    // 合并公共字段和业务字段
    const finalReportData = { ...data };

    // 补充公共上报字段
    const mobileFlag = isMobile();
    const eventHeader = {
      headers: {
        deviceId: await getSafeDeviceId(),
        uuid: uuidv4(),
        extinfo: JSON.stringify({
          client_type: mobileFlag ? 'WEB_PC' : 'WEB_MOBILE',
        }),
      },
    };

    await pedestalEvent(finalReportData, eventHeader);
  } catch (error) {
    console.error('单个数据上报失败：', error, data);
  }
};

/**
 * 常用场景快捷上报方法（简化业务调用）
 */
// 页面加载上报
export const reportPageLoad = (extraData?: Record<string, any>) => {
  void reportData({
    eventType: 'view',
    ...(extraData || {}),
  });
};

// 用户点击事件上报
export const reportClick = (id: string | number | null, model: string, eventParam?: Record<string, any>) => {
  const modelParam = {
    module: '',
    objectType: '',
  };
  switch (model) {
    case 'workflow':
      modelParam.module = 'WORKFLOW';
      modelParam.objectType = 'workflow';
      break;
    case 'employee':
      modelParam.module = 'AI_EMPLOYEE';
      modelParam.objectType = 'ai_employee';
      break;
    case 'group':
      modelParam.module = 'AI_GROUP';
      modelParam.objectType = 'ai_group';
      break;
  }
  void reportData({
    eventType: 'click',
    objectId: id,
    ...modelParam,
    eventParam: { ...(eventParam || {}) },
  });
};

// 自定义事件上报
export const reportCustomEvent = (customData: Record<string, any>) => {
  void reportData({
    ...customData,
  });
};
