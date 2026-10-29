// 节点相关配置项

import { Position, type HandleType } from '@xyflow/react';

const unionStyle = {
  width: 20,
  height: 20,
  border: '3px solid #ffffff',
  zIndex: 5,
};

const imageStyle = {
  background: 'linear-gradient(0deg, rgba(0, 0, 0, 0.45), rgba(0, 0, 0, 0.45)), #52C41A',
  borderColor: '#52C41A',
};

const textStyle = {
  background: 'linear-gradient(0deg, rgba(0, 0, 0, 0.45), rgba(0, 0, 0, 0.45)), #4155F0',
  borderColor: '#4155F0',
};

const videoStyle = {
  background: 'linear-gradient(0deg, rgba(0, 0, 0, 0.45), rgba(0, 0, 0, 0.45)), #B37FEB',
  borderColor: '#B37FEB',
};

const audioStyle = {
  background: 'linear-gradient(0deg, rgba(0, 0, 0, 0.45), rgba(0, 0, 0, 0.45)), #FA8C16',
  borderColor: '#FA8C16',
};

const marginTop = 24;
const nodeMargin = unionStyle.width + 12;

const handlersMap = {
  image: [
    {
      type: 'target' as HandleType,
      position: Position.Left,
      id: 'text_target',
      style: {
        ...unionStyle,
        ...textStyle,
        top: marginTop,
      },
    },
    {
      type: 'target' as HandleType,
      position: Position.Left,
      id: 'image_target',
      style: {
        ...unionStyle,
        ...imageStyle,
        top: marginTop + nodeMargin * 1,
      },
    },
    {
      type: 'source' as HandleType,
      position: Position.Right,
      id: 'image_source',
      style: {
        ...unionStyle,
        ...imageStyle,
      },
    },
  ],
  audio: [
    {
      type: 'target' as HandleType,
      position: Position.Left,
      id: 'text_target',
      style: {
        ...unionStyle,
        ...textStyle,
        top: marginTop,
      },
    },
    {
      type: 'target' as HandleType,
      position: Position.Left,
      id: 'audio_target',
      style: {
        ...unionStyle,
        ...audioStyle,
        top: marginTop + nodeMargin * 1,
      },
    },
    {
      type: 'source' as HandleType,
      position: Position.Right,
      id: 'audio_source',
      style: {
        ...unionStyle,
        ...audioStyle,
      },
    },
  ],
  text: [
    {
      type: 'target' as HandleType,
      position: Position.Left,
      id: 'text_target',
      style: {
        ...unionStyle,
        ...textStyle,
        top: marginTop,
      },
    },
    {
      type: 'target' as HandleType,
      position: Position.Left,
      id: 'image_target',
      style: {
        ...unionStyle,
        ...imageStyle,
        top: marginTop + nodeMargin * 1,
      },
    },
    {
      type: 'target' as HandleType,
      position: Position.Left,
      id: 'video_target',
      style: {
        ...unionStyle,
        ...videoStyle,
        top: marginTop + nodeMargin * 2,
      },
    },
    {
      type: 'source' as HandleType,
      position: Position.Right,
      id: 'text_source',
      style: {
        ...unionStyle,
        ...textStyle,
      },
    },
  ],
  video: [
    {
      type: 'target' as HandleType,
      position: Position.Left,
      id: 'text_target',
      style: {
        ...unionStyle,
        ...textStyle,
        top: marginTop,
      },
    },
    {
      type: 'target' as HandleType,
      position: Position.Left,
      id: 'image_target',
      style: {
        ...unionStyle,
        ...imageStyle,
        top: marginTop + nodeMargin * 1,
      },
    },
    {
      type: 'target' as HandleType,
      position: Position.Left,
      id: 'video_target',
      style: {
        ...unionStyle,
        ...videoStyle,
        top: marginTop + nodeMargin * 2,
      },
    },
    {
      type: 'target' as HandleType,
      position: Position.Left,
      id: 'audio_target',
      style: {
        ...unionStyle,
        ...audioStyle,
        top: marginTop + nodeMargin * 3,
      },
    },
    {
      type: 'source' as HandleType,
      position: Position.Right,
      id: 'video_source',
      style: {
        ...unionStyle,
        ...videoStyle,
      },
    },
  ],
  poseTool: [
    {
      type: 'target' as HandleType,
      position: Position.Left,
      id: 'image_target',
      limit: 1,
      style: {
        ...unionStyle,
        ...imageStyle,
        top: marginTop,
      },
    },
    {
      type: 'source' as HandleType,
      position: Position.Right,
      id: 'image_source',
      style: {
        ...unionStyle,
        ...imageStyle,
      },
    },
  ],
  highDefinitionTool: [
    {
      type: 'target' as HandleType,
      position: Position.Left,
      id: 'image_target',
      limit: 1,
      style: {
        ...unionStyle,
        ...imageStyle,
        top: marginTop,
        animation: 'im-pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      },
    },
    {
      type: 'source' as HandleType,
      position: Position.Right,
      id: 'image_source',
      style: {
        ...unionStyle,
        ...imageStyle,
      },
    },
  ],
  imageLayoutTool: [
    {
      type: 'target' as HandleType,
      position: Position.Left,
      id: 'image_target',
      limit: 1,
      style: {
        ...unionStyle,
        ...imageStyle,
        top: marginTop,
      },
    },
    {
      type: 'source' as HandleType,
      position: Position.Right,
      id: 'image_source',
      style: {
        ...unionStyle,
        ...imageStyle,
      },
    },
  ],
  textRedrawTool: [
    {
      type: 'target' as HandleType,
      position: Position.Left,
      id: 'image_target',
      limit: 1,
      style: {
        ...unionStyle,
        ...imageStyle,
        top: marginTop,
      },
    },
    {
      type: 'source' as HandleType,
      position: Position.Right,
      id: 'image_source',
      style: {
        ...unionStyle,
        ...imageStyle,
      },
    },
  ],
  imageEditorTool: [
    {
      type: 'target' as HandleType,
      position: Position.Left,
      id: 'image_target',
      limit: 1,
      style: {
        ...unionStyle,
        ...imageStyle,
        top: marginTop,
      },
    },
    {
      type: 'source' as HandleType,
      position: Position.Right,
      id: 'image_source',
      style: {
        ...unionStyle,
        ...imageStyle,
      },
    },
  ],
  highDefinitionVideoTool: [
    {
      type: 'target' as HandleType,
      position: Position.Left,
      id: 'video_target',
      limit: 1,
      style: {
        ...unionStyle,
        ...videoStyle,
        top: marginTop,
        animation: 'im-pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      },
    },
    {
      type: 'source' as HandleType,
      position: Position.Right,
      id: 'video_source',
      style: {
        ...unionStyle,
        ...videoStyle,
      },
    },
  ],
  multiViewTool: [
    {
      type: 'target' as HandleType,
      position: Position.Left,
      id: 'image_target',
      limit: 1,
      style: {
        ...unionStyle,
        ...imageStyle,
        top: marginTop,
        animation: 'im-pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      },
    },
    {
      type: 'source' as HandleType,
      position: Position.Right,
      id: 'image_source',
      style: {
        ...unionStyle,
        ...imageStyle,
      },
    },
  ],
  audioClipTool: [
    {
      type: 'target' as HandleType,
      position: Position.Left,
      id: 'audio_target',
      limit: 1,
      style: {
        ...unionStyle,
        ...audioStyle,
        top: marginTop,
        animation: 'im-pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      },
    },
    {
      type: 'source' as HandleType,
      position: Position.Right,
      id: 'audio_source',
      style: {
        ...unionStyle,
        ...audioStyle,
      },
    },
  ],
  videoClipTool: [
    {
      type: 'target' as HandleType,
      position: Position.Left,
      id: 'video_target',
      limit: 1,
      style: {
        ...unionStyle,
        ...videoStyle,
        top: marginTop,
        animation: 'im-pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      },
    },
    {
      type: 'source' as HandleType,
      position: Position.Right,
      id: 'video_source',
      style: {
        ...unionStyle,
        ...videoStyle,
      },
    },
  ],
  imageLipSyncTool: [
    {
      type: 'target' as HandleType,
      position: Position.Left,
      id: 'image_target',
      limit: 1,
      style: {
        ...unionStyle,
        ...imageStyle,
        top: marginTop,
        animation: 'im-pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      },
    },
    {
      type: 'target' as HandleType,
      position: Position.Left,
      id: 'audio_target',
      limit: 1,
      style: {
        ...unionStyle,
        ...audioStyle,
        top: marginTop + nodeMargin,
        animation: 'im-pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      },
    },
    {
      type: 'source' as HandleType,
      position: Position.Right,
      id: 'video_source',
      style: {
        ...unionStyle,
        ...videoStyle,
      },
    },
  ],
  poseTransVideoTool: [
    {
      type: 'target' as HandleType,
      position: Position.Left,
      id: 'image_target',
      limit: 1,
      style: {
        ...unionStyle,
        ...imageStyle,
        top: marginTop,
        animation: 'im-pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      },
    },
    {
      type: 'target' as HandleType,
      position: Position.Left,
      id: 'video_target',
      limit: 1,
      style: {
        ...unionStyle,
        ...videoStyle,
        top: marginTop + nodeMargin,
        animation: 'im-pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      },
    },
    {
      type: 'source' as HandleType,
      position: Position.Right,
      id: 'video_source',
      style: {
        ...unionStyle,
        ...videoStyle,
      },
    },
  ],
  sizeAdaptTool: [
    {
      type: 'target' as HandleType,
      position: Position.Left,
      id: 'image_target',
      limit: 1,
      style: {
        ...unionStyle,
        ...imageStyle,
        top: marginTop,
      },
    },
    {
      type: 'source' as HandleType,
      position: Position.Right,
      id: 'image_source',
      style: {
        ...unionStyle,
        ...imageStyle,
      },
    },
  ],
  imageInpaintTool: [
    {
      type: 'target' as HandleType,
      position: Position.Left,
      id: 'image_target',
      limit: 1,
      style: {
        ...unionStyle,
        ...imageStyle,
        top: marginTop,
      },
    },
    {
      type: 'source' as HandleType,
      position: Position.Right,
      id: 'image_source',
      style: {
        ...unionStyle,
        ...imageStyle,
      },
    },
  ],
  panoramaTool: [
    {
      type: 'target' as HandleType,
      position: Position.Left,
      id: 'text_target',
      limit: 99,
      style: {
        ...unionStyle,
        ...textStyle,
        top: marginTop,
      },
    },
    {
      type: 'target' as HandleType,
      position: Position.Left,
      id: 'image_target',
      limit: 1,
      style: {
        ...unionStyle,
        ...imageStyle,
        top: marginTop + nodeMargin * 1,
      },
    },
    {
      type: 'source' as HandleType,
      position: Position.Right,
      id: 'image_source',
      style: {
        ...unionStyle,
        ...imageStyle,
      },
    },
  ],
  storyboardTool: [
    {
      type: 'target' as HandleType,
      position: Position.Left,
      id: 'text_target',
      limit: 99,
      style: {
        ...unionStyle,
        ...textStyle,
        top: marginTop,
      },
    },
    {
      type: 'target' as HandleType,
      position: Position.Left,
      id: 'image_target',
      limit: 1,
      style: {
        ...unionStyle,
        ...imageStyle,
        top: marginTop + nodeMargin * 1,
      },
    },
    {
      type: 'target' as HandleType,
      position: Position.Left,
      id: 'video_target',
      limit: 1,
      style: {
        ...unionStyle,
        ...videoStyle,
        top: marginTop + nodeMargin * 2,
      },
    },
    {
      type: 'source' as HandleType,
      position: Position.Right,
      id: 'image_source',
      style: {
        ...unionStyle,
        ...imageStyle,
      },
    },
  ],
};

// 句柄颜色
const handlerColorMap = {
  image_source: '#52C41A',
  text_source: '#4155F0',
  video_source: '#B37FEB',
  audio_source: '#FA8C16',
  image_target: '#52C41A',
  text_target: '#4155F0',
  video_target: '#B37FEB',
  audio_target: '#FA8C16',
};

// 句柄悬浮颜色
const handerHoverColorMap = {
  image_source: '#52C41ACC',
  text_source: '#4155F0CC',
  video_source: '#B37FEBCC',
  audio_source: '#FA8C16CC',
  image_target: '#52C41ACC',
  text_target: '#4155F0CC',
  video_target: '#B37FEBCC',
  audio_target: '#FA8C16CC',
};

// 目标节点输入口支持
const targetTypeMap = {
  text: ['text', 'image', 'video'],
  image: ['text', 'image'],
  video: ['text', 'image', 'video', 'audio'],
  audio: ['text', 'audio'],
  poseTool: ['image'],
  highDefinitionTool: ['image'],
  imageLayoutTool: ['image'],
  textRedrawTool: ['image'],
  imageEditorTool: ['image'],
  highDefinitionVideoTool: ['video'],
  multiViewTool: ['image'],
  audioClipTool: ['audio'],
  videoClipTool: ['video'],
  imageLipSyncTool: ['image', 'audio'],
  poseTransVideoTool: ['image', 'video'],
  sizeAdaptTool: ['image'],
  imageInpaintTool: ['image'],
  storyboardTool: ['text', 'image', 'video'],
  panoramaTool: ['text', 'image'],
};

// 源节点输出口支持
const sourceTypeMap = {
  text: ['text', 'image', 'video', 'audio'],
  image: ['text', 'image', 'video'],
  video: ['text', 'video'],
  audio: ['audio'],
  poseTool: ['image'],
  highDefinitionTool: ['image'],
  imageLayoutTool: ['image'],
  textRedrawTool: ['image'],
  imageEditorTool: ['image'],
  highDefinitionVideoTool: ['video'],
  multiViewTool: ['image'],
  audioClipTool: ['audio'],
  videoClipTool: ['video'],
  imageLipSyncTool: ['video'],
  poseTransVideoTool: ['video'],
  sizeAdaptTool: ['image'],
  imageInpaintTool: ['image'],
  storyboardTool: ['image'],
  panoramaTool: ['image'],
};

// 节点名称
const nodeTitleMap = {
  text: '文本',
  image: '图片',
  video: '视频',
  audio: '音频',
  group: '组',
  poseTool: '姿势生成',
  imageLayoutTool: '图像分层',
  textRedrawTool: '文本重绘',
  imageEditorTool: '图像编辑器',
  highDefinitionTool: '高清图片',
  highDefinitionVideoTool: '高清视频',
  multiViewTool: '万物多视角',
  audioClipTool: '音频裁切',
  videoClipTool: '视频裁切',
  imageLipSyncTool: '数字人对口型',
  poseTransVideoTool: '姿势迁移',
  sizeAdaptTool: '扩图生成',
  imageInpaintTool: '局部重绘',
  storyboardTool: '智能分镜脚本',
  panoramaTool: '全景图',
};

// 工具节点默认参数
const toolParamsMap = {
  poseTool: {
    model: 'pose-predict',
    createMode: 'userDefined',
  },
  highDefinitionTool: {
    model: 'seedvr-upscale-image',
  },
  imageLayoutTool: {},
  textRedrawTool: {
    model: 'TEXT_REDRAWING_IMAGE_GENERATION',
    resolution: '1K',
  },
  imageEditorTool: {},
  highDefinitionVideoTool: {
    model: 'seedvr-upscale-video',
  },
  multiViewTool: {
    model: 'qwen-image-edit-2511-multiple-angles',
    zoom: 5,
    horizontalAngle: 0,
    verticalAngle: 0,
  },
  audioClipTool: {
    audioStartSecond: 0,
    audioEndSecond: 0,
  },
  videoClipTool: {
    videoStartSecond: 0,
    videoEndSecond: 0,
  },
  imageLipSyncTool: {
    mode: 'single',
    modelId: 'omni_v15',
    prompt: '',
    resolution: '720p',
    audioStartSecond: 0,
    audioEndSecond: 0,
    selectedCharacterIndexes: [],
  },
  poseTransVideoTool: {
    modelId: 'pose_trans_video/seedance-2.0',
    resolution: '720p',
    aspect_ratio: '16:9',
    prompt: '',
    personReplacement: false,
  },
  sizeAdaptTool: {},
  imageInpaintTool: {},
  storyboardTool: {
    model: 'AI_STORYBOARD_GENERATION',
    mode: 'custom', // custom | gen_script | video_understand
    prompt: '',
    aspectRatio: 'custom', // custom | 9:16 | 16:9 | 1:1 | 3:4 | 4:3 | 21:9
  },
  panoramaTool: {
    model: 'PANORAMA',
    modelType: 'text_to_image',
    prompt: '',
    resolution: '2K',
  },
};

// 智能分镜脚本节点默认表格协议
const defaultStoryboardTable = {
  columns: [
    { field: 'c_1', title: '自定义', width: 200 },
    { field: 'c_2', title: '自定义', width: 200 },
    { field: 'c_3', title: '自定义', width: 200 },
    { field: 'c_4', title: '自定义', width: 200 },
    { field: 'c_5', title: '自定义', width: 200 },
    { field: 'c_6', title: '自定义', width: 200 },
  ],
  rowsHeight: [200, 200, 200],
  data: [
    {
      c_1: { type: 'empty', value: '' },
      c_2: { type: 'empty', value: '' },
      c_3: { type: 'empty', value: '' },
      c_4: { type: 'empty', value: '' },
      c_5: { type: 'empty', value: '' },
      c_6: { type: 'empty', value: '' },
    },
    {
      c_1: { type: 'empty', value: '' },
      c_2: { type: 'empty', value: '' },
      c_3: { type: 'empty', value: '' },
      c_4: { type: 'empty', value: '' },
      c_5: { type: 'empty', value: '' },
      c_6: { type: 'empty', value: '' },
    },
    {
      c_1: { type: 'empty', value: '' },
      c_2: { type: 'empty', value: '' },
      c_3: { type: 'empty', value: '' },
      c_4: { type: 'empty', value: '' },
      c_5: { type: 'empty', value: '' },
      c_6: { type: 'empty', value: '' },
    },
  ],
};

// 需要获取图片的节点类型（工具节点不再作为输入物，输出由后方 upload 子节点承接）
const getImageNodeType = ['image'];
const getVideoNodeType = ['video'];
const getAudioNodeType = ['audio'];

/** 工具节点一键前接来源：工具 type → 需创建的基础节点类型列表 */
const toolQuickConnectMap: Record<string, Array<'image' | 'video' | 'audio'>> = {
  highDefinitionTool: ['image'],
  imageLayoutTool: ['image'],
  textRedrawTool: ['image'],
  multiViewTool: ['image'],
  sizeAdaptTool: ['image'],
  imageInpaintTool: ['image'],
  highDefinitionVideoTool: ['video'],
  audioClipTool: ['audio'],
  videoClipTool: ['video'],
  imageLipSyncTool: ['image', 'audio'],
  poseTransVideoTool: ['image', 'video'],
  panoramaTool: ['image'],
};

const TOOL_BOTTOM_HINT = '或你可直接在左侧接入来源';

const buildTryConnectLabel = (type: string) => `点击试试${nodeTitleMap[type as keyof typeof nodeTitleMap] || ''}`;

export default {
  targetTypeMap, // 目标节点输入口支持
  sourceTypeMap, // 源节点输出口支持
  handlerColorMap, // 句柄颜色
  handerHoverColorMap, // 句柄悬浮颜色
  handlersMap, // 连接句柄
  nodeTitleMap, // 节点名称
  toolQuickConnectMap, // 工具节点一键前接来源配置
  TOOL_BOTTOM_HINT, // 工具节点底部接入提示
  buildTryConnectLabel, // 工具节点「点击试试」文案
  toolParamsMap, // 工具节点默认参数
  getImageNodeType, // 需要获取图片的节点类型
  getVideoNodeType, // 需要获取视频的节点类型
  getAudioNodeType, // 需要获取音频的节点类型
  defaultStoryboardTable, // 智能分镜脚本默认表格协议
  sideOperationsPosition: 'right' as 'left' | 'right', // 侧边操作栏显示位置：默认右侧
};
