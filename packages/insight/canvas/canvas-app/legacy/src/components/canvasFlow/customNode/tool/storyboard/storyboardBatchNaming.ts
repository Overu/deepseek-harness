import type { Node } from '@xyflow/react';
import setting from '../../../settings/setting';

const DEFAULT_SCRIPT_TITLE = setting.nodeTitleMap.storyboardTool || '智能分镜脚本';

/** 解析智能分镜脚本节点展示名（缺省用 nodeTitleMap） */
export const resolveStoryboardScriptTitle = (title: unknown): string => {
  const trimmed = typeof title === 'string' ? title.trim() : '';
  return trimmed || DEFAULT_SCRIPT_TITLE;
};

/** 生成节点：{脚本title}-分镜{行号} */
export const createStoryboardGenTitle = (scriptTitle: string, shotNumber: number): string => `${scriptTitle}-分镜${shotNumber}`;

/** 参考图：{脚本title}-分镜{行号}-参考图{M} */
export const createStoryboardRefTitle = (scriptTitle: string, shotNumber: number, refIndex: number): string => `${scriptTitle}-分镜${shotNumber}-参考图${refIndex}`;

/** 分镜组：{脚本title}-分镜组{K} */
export const createStoryboardGroupTitle = (scriptTitle: string, groupIndex: number): string => `${scriptTitle}-分镜组${groupIndex}`;

/**
 * 下一分镜组序号：仅统计同脚本前缀的 `…-分镜组N`，避免与宫格裁切/手动「组」抢序号。
 */
export const getNextStoryboardGroupIndex = (nodes: Node[], scriptTitle: string): number => {
  const escaped = scriptTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`^${escaped}-分镜组(\\d+)$`);
  let max = 0;
  nodes.forEach(node => {
    if (node.type !== 'group') return;
    const title = typeof node.data?.title === 'string' ? node.data.title.trim() : '';
    const match = title.match(re);
    if (match) {
      const n = Number(match[1]);
      if (Number.isFinite(n) && n > max) max = n;
    }
  });
  return max + 1;
};
