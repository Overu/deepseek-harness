import type { ReactNode } from 'react';
import { WandSparkles, Layers, Film, Hd, PersonStanding, Box, ImageUpscale, ScanLine, Table, Type, Mic, Scissors, Bike, Globe, Grid2X2 } from 'lucide-react';

/** 工具适用的节点类型：仅图片节点 / 仅视频节点 / 文本节点 / 音频节点 / 二者均可 */
export type ToolApplicableNodeKind = 'image' | 'video' | 'text' | 'audio';

export interface ToolListItem {
  type: string;
  title: string;
  tip: string;
  gift: string;
  icon: ReactNode;
  /** 该工具可用于的节点类型，用于在 NodeOperation 中按节点类型展示可用工具 */
  applicableTo: ToolApplicableNodeKind[];
  abbreviation?: string;
  /** 工具是否禁用 */
  unsable?: (value?: unknown) => boolean;
  forceVisible?: boolean;
}

export type ToolGiftMediaType = 'image' | 'video';

export function getToolGiftMediaType(gift?: string): ToolGiftMediaType {
  const normalizedGift = gift?.toLowerCase() ?? '';
  return normalizedGift.includes('.mp4') ? 'video' : 'image';
}

export const TOOL_LIST: ToolListItem[] = [
  {
    type: 'poseTool',
    title: '姿势生成器',
    tip: '生成人物姿势用于动画制作',
    gift: 'https://web-gpt-assets-cdn.idealead.com/base-platform/test/images/tool/pose.gif',
    icon: <PersonStanding size={20} />,
    applicableTo: [],
  },
  {
    type: 'highDefinitionTool',
    title: '高清图片',
    tip: '图片清晰度升级处理',
    gift: 'https://web-gpt-assets-cdn.idealead.com/base-platform/test/images/tool/hdImage.gif',
    icon: <Hd size={20} />,
    applicableTo: ['image'],
    abbreviation: '高清',
  },
  {
    type: 'highDefinitionVideoTool',
    title: '高清视频',
    tip: '视频清晰度升级处理',
    gift: 'https://web-gpt-assets-cdn.idealead.com/base-platform/test/images/tool/hdVideo.gif',
    icon: <Film size={20} />,
    applicableTo: ['video'],
    abbreviation: '高清',
  },
  {
    type: 'imageLayoutTool',
    title: '图像分层',
    tip: '一键拆分图层',
    gift: 'https://web-gpt-assets-cdn.idealead.com/assets/img/imageLayout.gif',
    icon: <Layers size={20} />,
    applicableTo: ['image'],
    abbreviation: '分层',
  },
  {
    type: 'textRedrawTool',
    title: '文本重绘',
    tip: '识别并修改图片中的文字',
    gift: 'https://web-gpt-assets-cdn.idealead.com/base-platform/test/images/tool/textRedrawTool.gif',
    icon: <Type size={20} />,
    applicableTo: ['image'],
    abbreviation: '文本重绘',
  },
  {
    type: 'imageEditorTool',
    title: '图像编辑器',
    tip: '高效修图编辑',
    gift: 'https://web-gpt-assets-cdn.idealead.com/base-platform/test/images/tool/imageEdit.gif',
    icon: <WandSparkles size={20} />,
    applicableTo: ['image'],
    abbreviation: '编辑',
  },
  {
    type: 'gridCrop',
    title: '宫格裁切',
    tip: '将图片按宫格裁切为多个图片节点',
    gift: '',
    icon: <Grid2X2 size={20} />,
    applicableTo: ['image'],
    abbreviation: '宫格',
    unsable: value => (typeof value === 'string' ? value.length === 0 : true),
    forceVisible: true,
  },
  {
    type: 'multiViewTool',
    title: '万物多视角',
    tip: '单图生成多视角',
    gift: 'https://web-gpt-assets-cdn.idealead.com/base-platform/test/images/tool/multiView.gif',
    icon: <Box size={20} />,
    applicableTo: ['image'],
    abbreviation: '多视角',
  },
  {
    type: 'imageLipSyncTool',
    title: '数字人对口型',
    tip: '图片与音频生成对口型视频',
    gift: 'https://web-gpt-assets-cdn.idealead.com/base-platform/test/images/tool/imageLipSyncTool.gif',
    icon: <Mic size={20} />,
    applicableTo: ['image'],
    abbreviation: '对口型',
  },
  {
    type: 'poseTransVideoTool',
    title: '姿势迁移',
    tip: '图片与视频生成姿势迁移视频',
    gift: 'https://web-gpt-assets-cdn.idealead.com/static-assets-tool/mp4/posetransvideo-6f90f92776d4ac7d.mp4',
    icon: <Bike size={20} />,
    applicableTo: ['image'],
    abbreviation: '姿势迁移',
  },
  {
    type: 'audioClipTool',
    title: '音频裁切',
    tip: '裁切音频片段并输出新音频',
    gift: 'https://web-gpt-assets-cdn.idealead.com/static-assets-tool/mp4/audioclip-cb2d60a9cb14c534.mp4',
    icon: <Scissors size={20} />,
    applicableTo: ['audio'],
    abbreviation: '裁切',
  },
  {
    type: 'videoClipTool',
    title: '视频裁切',
    tip: '裁切视频片段并输出新视频',
    gift: 'https://web-gpt-assets-cdn.idealead.com/static-assets-tool/mp4/videoclip-ab07a1f9aa003ef3.mp4',
    icon: <Scissors size={20} />,
    applicableTo: ['video'],
    abbreviation: '裁切',
  },
  {
    type: 'sizeAdaptTool',
    title: '扩图生成',
    tip: '一键轻松扩展画面',
    gift: 'https://web-gpt-assets-cdn.idealead.com/base-platform/test/images/tool/sizeAdapt.gif',
    icon: <ImageUpscale size={20} />,
    applicableTo: ['image'],
    abbreviation: '扩图',
  },
  {
    type: 'imageInpaintTool',
    title: '局部重绘',
    tip: '框选或涂抹区域进行局部重绘',
    gift: 'https://web-gpt-assets-cdn.idealead.com/static-assets-tool/gif/0679cd3e12837e17.gif?x-oss-process=image/format,webp',
    icon: <ScanLine size={20} />,
    applicableTo: ['image'],
    abbreviation: '重绘',
  },
  {
    type: 'storyboardTool',
    title: '智能分镜脚本',
    tip: '智能生成分镜脚本表格',
    gift: 'https://web-gpt-assets-cdn.idealead.com/base-platform/test/images/tool/storyboardTool.gif',
    icon: <Table size={20} />,
    applicableTo: ['video'],
    abbreviation: '分镜',
  },
  {
    type: 'panoramaTool',
    title: '全景图',
    tip: '全景图生成，支持360度查看与截图',
    gift: 'https://web-gpt-assets-cdn.idealead.com/static-assets-tool/mp4/panorama-896e22ebdb01a2b3.mp4',
    icon: <Globe size={20} />,
    applicableTo: ['image'],
    abbreviation: '全景',
  },
];

export const TOOL_META_BY_TYPE = TOOL_LIST.reduce<Record<string, ToolListItem>>((acc, item) => {
  acc[item.type] = item;
  return acc;
}, {});

/** 按节点类型（image/video/text/audio）获取可用的工具类型列表 */
export function getToolListItemsByNodeKind(nodeKind: string): ToolListItem[] {
  if (nodeKind !== 'image' && nodeKind !== 'video' && nodeKind !== 'text' && nodeKind !== 'audio') return [];
  return TOOL_LIST.filter(t => t.applicableTo.includes(nodeKind));
}

/** 按工具节点 type 获取侧栏图标，供 NodeTitle 等复用 */
export function getToolIconByType(type: string): ReactNode | null {
  return TOOL_META_BY_TYPE[type]?.icon ?? null;
}
