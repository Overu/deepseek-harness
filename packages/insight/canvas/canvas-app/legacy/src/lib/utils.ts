import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const MENTION_AVATAR_WIDTH = 64;
const isAliyunOssUrl = (src: string) => /aliyuncs\.com/i.test(src);

const appendOssProcess = (src: string, process: string) => {
  if (!src || !isAliyunOssUrl(src) || src.includes('x-oss-process=')) return src;
  const separator = src.includes('?') ? '&' : '?';
  return `${src}${separator}x-oss-process=${process}`;
};

const getVideoPoster = (src: string, width = 64) => {
  return appendOssProcess(src, `video/snapshot,t_0,f_jpg,w_${width},m_fast`);
};

const getImageThumbnail = (src: string, width = 64) => {
  return appendOssProcess(src, `image/resize,w_${width}`);
};

export const getMentionAvatarSrc = (avatar: string, mediaKind?: string) => {
  if (!avatar) return '';
  if (mediaKind === 'video') return getVideoPoster(avatar, MENTION_AVATAR_WIDTH);
  if ((mediaKind || 'image') === 'image') return getImageThumbnail(avatar, MENTION_AVATAR_WIDTH);
  return avatar;
};

/**
 * 格式化 AI 聊天的 promptVariables 为标签数组
 * @param messageVars 历史消息数据 (如果存在代表是历史记录)
 * @param currentVars 用户本次操作的数据 (如果 messageVars 为 null，则使用此数据)
 * @param session 当前的会话实例 (包含 config.taskModes 配置用于映射 label)
 */
export function formatChatTags(messageVars: any, currentVars: any, session: any): string[] {
  const vars = messageVars || currentVars;
  if (!vars) return [];

  const taskModes = session?.config?.taskModes;

  // 提炼所有 taskModes 内的字典，构造成平铺的映射表，提高查询效率
  // 数据结构如: { "text2video": "文生视频", "1280x720": "720P", "4": "4s" ... }
  const valueMap: Record<string, string> = {};

  if (taskModes) {
    Object.values(taskModes).forEach((modeConfig: any) => {
      // 存储 taskMode 自身的 value 到 label 的映射
      if (modeConfig.skill?.value && modeConfig.skill?.value !== 'default_template' && modeConfig.label) {
        valueMap[String(modeConfig.skill.value)] = modeConfig.label;
      }

      // 遍历 parameters 里所有的 options
      if (modeConfig.parameters) {
        Object.values(modeConfig.parameters).forEach((paramConfig: any) => {
          if (Array.isArray(paramConfig.options)) {
            paramConfig.options.forEach((opt: any) => {
              if (opt.value !== undefined && opt.label !== undefined) {
                valueMap[String(opt.value)] = opt.label;
              }
            });
          }
        });
      }
    });
  }

  return Object.entries(vars)
    .filter(([, val]) => val !== undefined && val !== null && val !== '')
    .sort(([keyA], [keyB]) => {
      // 确保 taskMode 和 eventMode 排在最前面
      if (keyA === 'taskMode') return -1;
      if (keyB === 'taskMode') return 1;
      if (keyA === 'eventMode') return -1;
      if (keyB === 'eventMode') return 1;
      return 0;
    })
    .map(([key, val]) => {
      const stringVal = String(val);

      // 第一优先级：尝试在打平的字典中快速建立映射
      if (valueMap[stringVal]) {
        return valueMap[stringVal];
      }

      // 降级处理容错：针对特殊字段拼单位
      if (key === 'duration' && typeof val === 'number') return `${val}s`;
      if (key === 'nums') return `${val}张`;

      // 兜底处理对象
      return typeof val === 'object' ? JSON.stringify(val) : stringVal;
    })
    .filter(n => n !== 'default_template');
}
