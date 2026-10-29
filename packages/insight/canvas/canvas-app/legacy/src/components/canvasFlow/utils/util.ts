import type { MediaNodeContentType, TaskInfo } from './type';
import type { Node, Edge, Handle } from '@xyflow/react';
import { v4 as uuidv4 } from 'uuid';
import setting from '../settings/setting';
import toolUtil from './toolUtil';
import {
  validateBasicNodesParamsForRun,
  applyCanvasPermissionMigration,
  isModelSelectable,
  getModelRow,
  getChoiceFlag,
  isModelPermissionEnforced,
  type NormalizedModelPermission,
} from './modelPermission';
import {
  transformByModel,
  transformByModelType,
  getTransformItems,
  creareDefaultParamsV2,
  resolveParamsOnModelChange,
  resolveParamsOnModelTypeChange,
  getVideoModelTypeMismatchReason,
  getImageModelTypeMismatchReason,
  getImageSvgUnsupportedReason,
  getAudioModelTypeMismatchReason,
  transformVideoType,
  resolveVideoModelTypeOnInputChange,
  transformImageType,
  validateMediaNodesForRun,
  type MediaModelsMap,
  type V2ModelsMap,
} from './mediaNodeModelUtil';
import { calculateAspectRatioNodeDimensions } from './mediaDimensions';

/** 画布加载时：协议兼容 + 订阅/权限下的模型与参数纠偏（不入撤销栈，由 init 单次 recordSnapshot） */
export interface ProcessNodesMigrationInput {
  modelNodePermission: NormalizedModelPermission | null;
  subscriptionFallbackMap: Record<string, string>;
}

export interface Position {
  x: number;
  y: number;
}

interface BasicNode {
  position: Position;
  type: string;
  value?: string;
  tempFile?: File;
  width?: number;
  height?: number;
  measured?: {
    width: number;
    height: number;
  };
}

export interface PositionRange {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface SelectParam {
  type?: string;
  key: string;
  label: string;
  option: Array<Choice>;
  cascade?: Cascade;
  setItems?: Array<SelectParam>;
}

interface Choice {
  value: string;
  label: string;
  description?: string;
  bgUrl?: string;
  isDefault?: string;
}

interface Cascade {
  [key: string]: {
    [subKey: string]: Array<{
      value: any;
      label: string;
      isDefult?: boolean;
    }>;
  };
}

interface ParamItem {
  field: string;
  label: string;
  choices?: Array<Choice>;
  default: string;
  value?: string;
  params?: Array<ParamItem>;
  seniorParams?: Array<ParamItem>;
  cascade?: Cascade;
  setItems?: Array<ParamItem>;
}

const pickChoiceValue = (choices: any[], predicate?: (choice: any) => boolean) => {
  if (!Array.isArray(choices) || choices.length === 0) return undefined;
  if (!predicate) return choices[0]?.value;
  for (const c of choices) {
    if (predicate(c)) return c?.value;
  }
  return undefined;
};

const pickDefaultChoiceValue = (choices: any[]) => pickChoiceValue(choices, c => Boolean(c && (c.isDefult || c.isDefault))) ?? pickChoiceValue(choices);

const pickFirstVisibleChoiceValue = (args: {
  choices: any[];
  permActive: boolean;
  permRow: any;
  perm: NormalizedModelPermission | null;
  type: string;
  modelKey: string;
  field: string;
}) => {
  const { choices, permActive, permRow, perm, type, modelKey, field } = args;
  if (!permActive) return undefined;
  if (!permRow?.custom_parameters?.[field]) return undefined; // 字段未配置：默认全部开放
  return pickChoiceValue(choices, c => {
    const fl = getChoiceFlag(perm, type, modelKey, field, c?.value);
    return Boolean(fl?.visible);
  });
};

// 统一处理“默认值回退 + 权限下不可见选项迁移”为最终默认值
const resolveDefaultValueWithPermission = (args: {
  param: any;
  defaultValue: any;
  permActive: boolean;
  permRow: any;
  perm: NormalizedModelPermission | null;
  type: string;
  modelKey: string;
  pickFirstVisibleChoice: (choices: any[], field: string) => any;
}) => {
  const { param, permActive, permRow, perm, type, modelKey, pickFirstVisibleChoice } = args;
  let defaultValue = args.defaultValue;

  if (defaultValue === undefined && param?.choices?.length) {
    const fallbackDefaultValue = pickDefaultChoiceValue(param.choices);
    if (fallbackDefaultValue !== undefined) defaultValue = fallbackDefaultValue;
  }
  if (param?.choices?.length && permActive && permRow?.custom_parameters?.[param.field]) {
    const flag = getChoiceFlag(perm, type, modelKey, param.field, defaultValue);
    if (!flag.visible) {
      const firstVisibleValue = pickFirstVisibleChoice(param.choices, param.field);
      if (firstVisibleValue !== undefined) defaultValue = firstVisibleValue;
    }
  }
  return defaultValue;
};

interface FieldChoiceItem {
  value: any;
  label: string;
}

type FieldChoicesMap = Record<string, FieldChoiceItem[]>;

/** 字段 key → 中文 label（协议中的 label 字段） */
export type FieldLabelsMap = Record<string, string>;

export interface ModelItem {
  value: string;
  label: string;
  params: Array<ParamItem>;
  sort?: number;
  /** 模型输入 prompt 的最大字符串长度限制（按 JS string.length 计算） */
  maxPrompt?: number;
}

interface ModelsMap {
  video?: Array<ModelItem>;
  image?: Array<ModelItem>;
  audio?: Array<ModelItem>;
  text?: Array<ModelItem>;
}

export type ModelMaxPromptMap = Record<string, number>;

interface SoureMapItem {
  edgeId: string;
  nodeId: string;
}

interface ImageMapItem {
  edgeId: string;
  value: string;
  title: string;
}
interface VideoMapItem {
  edgeId: string;
  value: string;
  title: string;
}

/** 连入的文本输入（含源节点 title，用于 InputParams tooltip） */
export interface TextInputItem {
  edgeId: string;
  value: string;
  title: string;
}

/** 按入边顺序排列的图像/视频/音频输入（用于视频节点提示条与 @ 引用） */
export interface MediaInputItem {
  kind: 'image' | 'video' | 'audio';
  edgeId: string;
  value: string;
  title: string;
}

const { targetTypeMap, nodeTitleMap, toolParamsMap, getImageNodeType, getVideoNodeType, getAudioNodeType, defaultStoryboardTable } = setting;

const { defaultWidth, defaultHeight, getParentPositionMap, caculateNodesCenter, isAllowCapacity, createOffsetPosition, uniqueByField, getInputEdgesByNodes } = toolUtil;

const analysisModels = (typeObj: any) => {
  const typeMap = [];
  // TODO: 工具节点的结构有些特殊，需要特殊处理
  if ('models' in typeObj) {
    typeObj = typeObj.models;
  }
  for (const modelField in typeObj) {
    const modelData = typeObj[modelField];
    const modelObj: any = {
      value: modelField,
      label: modelData.model_name,
      description: modelData.description,
      point: modelData.point,
      sort: modelData.sort,
      maxPrompt: modelData.maxPrompt,
      // [media-node-model-unification] 同系列模型跨模式对齐
      canonicalModelId: modelData.canonical_model_id || undefined,
      params: [],
      seniorParams: [],
    };
    for (const paramField in modelData.senoir_parameters) {
      const paramData = modelData.senoir_parameters[paramField];
      const paramObj = {
        ...paramData,
        field: paramField,
      };
      modelObj.seniorParams.push(paramObj);
    }
    for (const paramField in modelData.parameters) {
      const paramData = modelData.parameters[paramField];
      const type = paramData.type;
      let paramObj: any;
      if (type == 'set') {
        // 处理集合类型参数
        const setItems = [];
        for (const setItemField in paramData.setItems) {
          const setItemData = paramData.setItems[setItemField];
          const setItem = {
            field: setItemField,
            label: setItemData.label,
            choices: setItemData.choices,
            default: setItemData.default,
          };
          setItems.push(setItem);
        }
        paramObj = {
          field: paramField,
          label: paramData.label,
          setItems,
          type,
        };
      } else {
        paramObj = {
          field: paramField,
          label: paramData.label,
          choices: paramData.choices,
          default: paramData.default,
          cascade: paramData.cascade,
          min: paramData.min,
          max: paramData.max,
          step: paramData.step,
          maxLength: paramData.maxLength,
          type, // TODO: 不再假设 type 为 choices。这里后续需要从服务端获取配置，根据 type 类型动态渲染。
        };
      }
      modelObj.params.push(paramObj);
    }
    typeMap.push(modelObj);
  }
  return typeMap.sort((a: ModelItem, b: ModelItem) => (a.sort ?? Infinity) - (b.sort ?? Infinity));
};

// 将接口存储参数数据转化为前端参数配置
const transformModelMap = (data: any) => {
  const specialNode = ['audio', 'video', 'image'];
  const modelsMap: any = {};
  for (const type in data) {
    const typeObj: any = data[type];
    if (specialNode.includes(type)) {
      const modalMap = [];
      for (const key in typeObj) {
        const fieldValue = typeObj[key];
        const obj: any = {
          value: key,
          label: fieldValue.name,
          params: analysisModels(fieldValue.models),
        };
        modalMap.push(obj);
      }
      modelsMap[type] = modalMap;
    } else {
      modelsMap[type] = analysisModels(typeObj);
    }
  }
  return modelsMap;
};

/** 从原始模型协议中抽取 modelValue -> maxPrompt 的映射 */
const buildModelMaxPromptMap = (data: any): ModelMaxPromptMap => {
  const map: ModelMaxPromptMap = {};
  if (!data || typeof data !== 'object') return map;

  for (const type in data) {
    const typeObj: any = data[type];
    if (!typeObj || typeof typeObj !== 'object') continue;

    // audio/video/image: typeObj[modelType].models[modelValue].maxPrompt
    if (type === 'audio' || type === 'video' || type === 'image') {
      for (const modelType in typeObj) {
        const modelTypeObj = typeObj[modelType];
        const models = modelTypeObj?.models;
        if (!models || typeof models !== 'object') continue;
        for (const modelValue in models) {
          const maxPrompt = Number(models[modelValue]?.maxPrompt);
          if (Number.isFinite(maxPrompt) && maxPrompt > 0) {
            map[modelValue] = maxPrompt;
          }
        }
      }
      continue;
    }

    // image/text: typeObj[modelValue].maxPrompt
    for (const modelValue in typeObj) {
      const maxPrompt = Number(typeObj[modelValue]?.maxPrompt);
      if (Number.isFinite(maxPrompt) && maxPrompt > 0) {
        map[modelValue] = maxPrompt;
      }
    }
  }

  return map;
};

/** 同时转换 modelsMap + 提取 maxPrompt map（不破坏现有 modelsMap 结构） */
const transformModelMapWithPromptLimit = (
  data: any
): {
  modelsMap: ModelsMap;
  modelMaxPromptMap: ModelMaxPromptMap;
} => {
  return {
    modelsMap: transformModelMap(data),
    modelMaxPromptMap: buildModelMaxPromptMap(data),
  };
};

// 创建默认的参数内容（image/text 等扁平模型列表）。未传 modelValue 时按 models 顺序遍历，默认选中第一个有权限的模型；无权限表时即为第一个。
const createDefaultParams = (modelsMap: ModelsMap, type: string, modelValue?: string, modelNodePermission?: NormalizedModelPermission | null) => {
  const models = modelsMap[type as keyof typeof modelsMap];
  if (!models || !models.length) {
    return {
      model: '',
      gen_count: 1,
      prompt: '',
    };
  }
  let model: ModelItem;
  if (modelValue) {
    model = models[0];
    for (const item of models) {
      if (item.value === modelValue) {
        model = item;
        break;
      }
    }
  } else {
    const perm = modelNodePermission;
    const permActive = Boolean(perm && perm.byCategoryAndKey.size > 0);
    let picked: ModelItem | undefined;
    for (const item of models) {
      if (item?.value === undefined || item?.value === null) continue;
      if (!permActive) {
        picked = item;
        break;
      }
      if (isModelSelectable(perm ?? null, type, String(item.value))) {
        picked = item;
        break;
      }
    }
    if (!picked) {
      return {
        model: '',
        gen_count: 1,
        prompt: '',
      };
    }
    model = picked;
  }
  const params: any = model.params;
  const perm = modelNodePermission ?? null;
  const permActive = isModelPermissionEnforced(perm);
  const modelKey = String(model.value);
  const permRow = permActive ? getModelRow(perm, type, modelKey) : undefined;

  const pickFirstVisibleChoice = (choices: any[], field: string): any => pickFirstVisibleChoiceValue({ choices, permActive, permRow, perm, type, modelKey, field });

  const defaultParams: any = {
    model: model.value,
    gen_count: 1,
    prompt: '',
  };
  params.forEach((param: any) => {
    // 处理参数集合
    if (param.setItems) {
      defaultParams[param.field] = {};
      param.setItems.forEach((setItem: any) => {
        // setItems 不参与权限控制，保持原协议 default
        defaultParams[param.field][setItem.field] = setItem.default;
      });
    } else {
      const defaultValue = resolveDefaultValueWithPermission({
        param,
        defaultValue: param.default,
        permActive,
        permRow,
        perm,
        type,
        modelKey,
        pickFirstVisibleChoice,
      });
      defaultParams[param.field] = defaultValue;
    }
  });
  return defaultParams;
};

const copy = (originalNode: Node, parentPositionMap: Record<string, Position>, randomOffset: Position, selected?: boolean) => {
  const newId = uuidv4();
  const position = {
    x: originalNode.position.x,
    y: originalNode.position.y,
  };
  if (parentPositionMap && parentPositionMap[originalNode.id]) {
    position.x = position.x + parentPositionMap[originalNode.id].x;
    position.y = position.y + parentPositionMap[originalNode.id].y;
  }
  return {
    ...originalNode,
    // 独立拷贝 measured，避免副本与源节点共享引用；否则放大副本会污染源节点 measured，框选时出现尺寸抖动
    measured: originalNode.measured ? { width: originalNode.measured.width, height: originalNode.measured.height } : originalNode.measured,
    width: originalNode.width,
    height: originalNode.height,
    parentId: '',
    extent: undefined,
    id: newId,
    selected: selected ? true : false,
    position: {
      x: position.x + randomOffset.x,
      y: position.y + randomOffset.y,
    },
    data: {
      ...originalNode.data,
      time: Date.now(),
      taskInfo: {
        status: 'success',
      },
      // 分镜批量任务态同步重置，避免复制后仍显示执行中
      ...(originalNode.data?.storyboardInfo
        ? {
            storyboardInfo: {
              status: 'success',
            },
          }
        : {}),
    },
  };
};

// 复制节点
const copyNode = (originalNode: Node, allNodes: Node[], edges: Edge[]) => {
  const randomOffset = createOffsetPosition();

  // 存储当前节点的父节点的位置用于后续计算
  const parentPositionMap: Record<string, Position> = getParentPositionMap([originalNode], allNodes);
  const newNode = copy(originalNode, parentPositionMap, randomOffset, true);
  const originId = originalNode.id;
  // 复制时同时附带连线关系
  let relativeEdges = getInputEdgesByNodes([originalNode], edges);
  if (relativeEdges.length) {
    relativeEdges = cloneEdges(relativeEdges);
    relativeEdges.forEach((item: Edge) => {
      if (item.target == originId) {
        item.target = newNode.id;
      }
      if (item.source == originId) {
        item.source = newNode.id;
      }
      item.type = 'default';
    });
  }
  return {
    newNode,
    newEdges: relativeEdges,
  };
};

// 粘贴节点
const pasteNode = (allNodes: Node[], allEdges: Edge[], originNodes: Node[], mousePosition?: Position) => {
  let offset = { x: 0, y: 0 };
  const newNodes: Node[] = [];

  // 存储当前节点的父节点的位置用于后续计算
  const parentPositionMap: Record<string, Position> = getParentPositionMap(originNodes, allNodes);

  // 根据鼠标位置设置节点偏移量
  if (mousePosition) {
    const nodesCenter = caculateNodesCenter(parentPositionMap, originNodes);
    offset.x = mousePosition.x - nodesCenter.x;
    offset.y = mousePosition.y - nodesCenter.y;
  } else {
    const randomOffset = createOffsetPosition();
    offset = randomOffset;
  }

  // 建立节点映射用于连线节点id更新
  const nodeIdMap: Record<string, string> = {};
  originNodes.forEach((item: Node) => {
    const newNode = copy(item, parentPositionMap, offset, true);
    nodeIdMap[item.id] = newNode.id;
    newNodes.push(newNode);
  });

  // 获取关联的连线
  let relativeEdges = getInputEdgesByNodes(originNodes, allEdges);
  if (relativeEdges.length) {
    relativeEdges = uniqueByField(relativeEdges, 'id');
    relativeEdges = cloneEdges(relativeEdges);
    relativeEdges.forEach((item: Edge) => {
      item.target = nodeIdMap[item.target] || item.target;
      item.source = nodeIdMap[item.source] || item.source;
      item.type = 'default';
    });
  }

  return {
    newNodes,
    newEdges: relativeEdges,
  };
};

// 根据基础配置生成节点
const createNode = (modelsMap: ModelsMap, basic: BasicNode, modelNodePermission?: NormalizedModelPermission | null) => {
  let params: Record<string, any> = {};
  const V2NodeTypes = ['video', 'audio', 'image'];
  const perm = modelNodePermission ?? null;
  if (basic.type.includes('Tool')) {
    params = toolParamsMap[basic.type as keyof typeof toolParamsMap] || {};
  } else if (V2NodeTypes.includes(basic.type)) {
    params = creareDefaultParamsV2(modelsMap as V2ModelsMap, basic.type, undefined, undefined, perm);
  } else {
    params = createDefaultParams(modelsMap, basic.type, undefined, perm);
  }
  const data: any = {
    time: Date.now(),
    title: nodeTitleMap[basic.type as keyof typeof nodeTitleMap] || '未命名',
    params,
    taskInfo: {
      status: 'success',
    },
    product: [],
    value: basic.value ? basic.value : '',
    tempFile: basic.tempFile ? basic.tempFile : null,
  };
  // 智能分镜脚本节点初始化默认表格协议
  if (basic.type === 'storyboardTool') {
    data.table = JSON.parse(JSON.stringify(defaultStoryboardTable));
  }
  if (basic.type === 'textRedrawTool') {
    data.ocrInfo = {
      status: 'success',
      taskId: '',
      errorMsg: '',
    };
  }
  const node: any = {
    id: uuidv4(),
    type: basic.type,
    position: basic.position,
    data,
  };
  const measured = basic.measured || (basic.width && basic.height ? { width: basic.width, height: basic.height } : null);
  if (measured) {
    node.width = measured.width;
    node.height = measured.height;
    node.measured = measured;
  }
  return node;
};

/** 用户主动新建空媒体节点时，若未填数据则基于模型 aspect_ratio 预设节点展示尺寸 */
export const applyEmptyMediaNodeDimensions = <T extends Node>(node: T): T => {
  if (!node || !['image', 'video'].includes(node.type || '') || node.data?.value || node.data?.tempFile) {
    return node;
  }
  const params = (node.data?.params as Record<string, any>) || {};
  const dimensions = calculateAspectRatioNodeDimensions(String(params.aspect_ratio || ''), defaultWidth, defaultHeight);
  if (dimensions) {
    node.width = dimensions.width;
    node.height = dimensions.height;
    node.measured = dimensions.measured;
  }
  return node;
};

// 根据传入的目标id以及源id创建连线
const createDragEdge = (fromHandle: Handle, nodeId: string) => {
  const type = fromHandle.id?.split('_')[0];
  let sourceHandle = '';
  let targetHandle = '';
  let target = '';
  let source = '';
  if (fromHandle.type == 'target') {
    targetHandle = fromHandle.id || '';
    sourceHandle = type + '_' + 'source';
    target = fromHandle.nodeId;
    source = nodeId;
  } else {
    sourceHandle = fromHandle.id || '';
    targetHandle = type + '_' + 'target';
    source = fromHandle.nodeId;
    target = nodeId;
  }
  return {
    id: uuidv4(),
    target,
    source,
    sourceHandle,
    targetHandle,
  };
};

/**
 * 组相关连线 zIndex（仅渲染层，不写 store）。
 * React Flow 12.8+ 会把一端在组内的连线默认抬到普通节点之上；组内连线压在父组与子节点之间，跨组/组内外连线压回普通节点之下。
 */
const syncIntraGroupEdgeZIndex = (edges: Edge[], nodes: Node[]): Edge[] => {
  const nodeById = new Map(nodes.map(n => [n.id, n]));
  return edges.map(edge => {
    const sourceParentId = nodeById.get(edge.source)?.parentId;
    const targetParentId = nodeById.get(edge.target)?.parentId;

    if (sourceParentId && sourceParentId === targetParentId) {
      const parentZ = nodeById.get(sourceParentId)?.zIndex ?? 0;
      let minChildZ = Infinity;
      for (const node of nodes) {
        if (node.parentId === sourceParentId) minChildZ = Math.min(minChildZ, node.zIndex ?? parentZ + 1);
      }
      const zIndex = Number.isFinite(minChildZ) ? Math.max(parentZ, minChildZ - 1) : parentZ;
      return { ...edge, zIndex };
    }

    if (sourceParentId || targetParentId) {
      return { ...edge, zIndex: 0 };
    }

    return edge;
  });
};

// 处理连线颜色等动画属性
const dealEdge = (edge: Edge) => {
  edge.className = edge.sourceHandle || 'custom';
  return edge;
};

/** 去掉连线临时选中态 / 高亮 stroke，避免框选后落库把白色选中态持久化 */
const stripEdgeTransientUiState = (edge: Edge): Edge => {
  const next: Edge = { ...edge, selected: false };
  if (next.style && (next.style as { stroke?: string }).stroke === '#fff') {
    const restStyle = { ...next.style };
    delete (restStyle as { stroke?: string }).stroke;
    next.style = Object.keys(restStyle).length ? restStyle : undefined;
  }
  return next;
};

const processEdges = (edges: any[]) => {
  return edges.map((edge: any) => {
    const cleaned = stripEdgeTransientUiState(edge);
    return {
      ...cleaned,
      className: cleaned.sourceHandle || cleaned.className || 'custom',
    };
  });
};

const getStoryboardAllowConnectTypes = (mode: string) => {
  // storyboardTool: mode 取值见 setting.ts(toolParamsMap.storyboardTool.mode) 与节点组件实现
  if (mode === 'gen_script') return ['text'];
  if (mode === 'video_understand') return ['video'];
  return ['text', 'image', 'video'];
};

// 校准连线句柄
const calibrateEdge = (targetNode: Node, edge: Edge) => {
  const targetType = String(targetNode?.type || '');
  const sourceType = edge.sourceHandle?.split('_')[0];

  if (!sourceType) return false;

  const allowConnects =
    targetType === 'storyboardTool'
      ? getStoryboardAllowConnectTypes(String((targetNode as any)?.data?.params?.mode || 'custom'))
      : targetTypeMap[targetType as keyof typeof targetTypeMap];

  if (Array.isArray(allowConnects) && allowConnects.includes(sourceType)) {
    edge.targetHandle = sourceType + '_' + edge.targetHandle?.split('_')[1];
    return true;
  }
  return false;
};

// 根据给定范围创建组节点
const creatGroupNode = (range: PositionRange) => {
  const { minX, minY, maxX, maxY } = range;
  const groupWidth = maxX - minX + 100;
  const groupHeight = maxY - minY + 100;
  const groupNode: Node = {
    id: uuidv4(),
    type: 'group',
    position: { x: minX - 50, y: minY - 50 },
    style: {
      width: groupWidth,
      height: groupHeight,
    },
    data: {
      time: Date.now(),
      title: nodeTitleMap.group || '组',
      taskInfo: {
        status: 'success',
      },
    },
  };
  return groupNode;
};

// 获取当前连线内容以及对应的连线id
const getSourceMap = (nodes: Node[], edges: Edge[], nodeId: string) => {
  const sourceMap: SoureMapItem[] = [];
  const images: ImageMapItem[] = [];
  const videos: VideoMapItem[] = [];
  const audios: ImageMapItem[] = [];
  const mediaInputs: MediaInputItem[] = [];
  const texts: TextInputItem[] = [];
  const valueArray: Array<any> = [];
  // 获取输入的节点id与连线id
  edges.forEach((item: Edge) => {
    if (item.target === nodeId) {
      const obj = {
        nodeId: item.source,
        edgeId: item.id,
      };
      sourceMap.push(obj);
    }
  });
  // 获取输入节点的value与title
  const sourceNoodeIds = sourceMap.map(item => item.nodeId);
  nodes.forEach((item: Node) => {
    const index = sourceNoodeIds.indexOf(item.id);
    if (index > -1) {
      const rawTitle = typeof item.data?.title === 'string' ? item.data.title.trim() : '';
      const title = rawTitle || nodeTitleMap[item.type as keyof typeof nodeTitleMap] || '未命名';
      const obj = {
        type: item.type,
        value: item.data.value,
        edgeId: sourceMap[index].edgeId,
        title,
        index,
      };
      valueArray.push(obj);
    }
  });
  valueArray.sort((a, b) => a.index - b.index);
  // 根据value拆分为image和text类型
  valueArray.forEach(item => {
    if (item.value) {
      if (getImageNodeType.includes(item.type)) {
        // 需要edgeId作为后续的拖拽调整连线顺序
        const obj = {
          edgeId: item.edgeId,
          value: item.value,
          title: item.title,
        };
        images.push(obj);
        mediaInputs.push({ kind: 'image', ...obj });
      }
      if (getVideoNodeType.includes(item.type)) {
        // 需要edgeId作为后续的拖拽调整连线顺序
        const obj = {
          edgeId: item.edgeId,
          value: item.value,
          title: item.title,
        };
        videos.push(obj);
        mediaInputs.push({ kind: 'video', ...obj });
      }
      if (getAudioNodeType.includes(item.type)) {
        const obj = {
          edgeId: item.edgeId,
          value: item.value,
          title: item.title,
        };
        audios.push(obj);
        mediaInputs.push({ kind: 'audio', ...obj });
      }
      if (item.type == 'text' && item.value.trim()) {
        texts.push({
          edgeId: item.edgeId,
          value: item.value,
          title: item.title,
        });
      }
    }
  });
  return {
    images,
    texts,
    videos,
    audios,
    mediaInputs,
  };
};

// 获取传入节点的值
const getValueByNodeIds = (nodes: Node[], nodeIds: string[], isSort?: boolean) => {
  const valueArray: Array<any> = [];
  nodes.forEach((item: Node) => {
    const index = nodeIds.indexOf(item.id);
    if (index > -1) {
      const obj = {
        type: item.type,
        value: item.data.value,
        index,
      };
      valueArray.push(obj);
    }
  });
  if (isSort) {
    valueArray.sort((a, b) => a.index - b.index);
  }
  return valueArray;
};

// 根据组节点更新子节点
const updateGroupChild = (nodes: Node[], selectedNodes: Node[], groupNode: Node) => {
  const selectedNodesIds = selectedNodes.map((node: Node) => node.id);
  const needUpdateNodes: any[] = [];
  const updatedNodes = nodes.map(node => {
    if (selectedNodesIds.includes(node.id)) {
      const updateContent = {
        id: node.id,
        parentId: groupNode.id,
        extent: 'parent' as const,
        position: {
          x: node.position.x - groupNode.position.x,
          y: node.position.y - groupNode.position.y,
        },
      };
      needUpdateNodes.push(updateContent);
      return {
        ...node,
        ...updateContent,
        selected: false,
      };
    }
    return node;
  });
  return {
    updatedNodes,
    needUpdateNodes,
  };
};

// 检验组内是否存在子节点
const validateGroup = (nodes: Node[], groupNode: Node) => {
  const groupId = groupNode.id;

  // 找到所有属于该组的子节点
  const childNodes = nodes.filter(node => node.parentId === groupId && node.id !== groupId);

  if (childNodes.length === 0) return false;
  return true;
};

// 解组
const upgroupChild = (nodes: Node[], groupNodes: Node[], selectedNodes?: Node[]) => {
  const updateNodes: any[] = [];
  const groupIds = groupNodes.map(item => item.id);
  const selectedNodeIds = selectedNodes ? selectedNodes.map(item => item.id) : [];
  const newNodes = nodes
    .filter(node => !groupIds.includes(node.id)) // 移除组节点
    .map(node => {
      const index = groupNodes.findIndex(item => item.id == node.parentId);
      if (index > -1) {
        const groupNode = groupNodes[index];
        // 解除子节点的父子关系
        const updateContent = {
          id: node.id,
          parentId: '',
          extent: undefined,
          position: {
            x: node.position.x + (groupNode.position?.x || 0),
            y: node.position.y + (groupNode.position?.y || 0),
          },
        };
        updateNodes.push(updateContent);
        // 解组的同时更新选中节点的位置数据
        if (selectedNodes) {
          const index = selectedNodeIds.indexOf(node.id);
          if (index > -1) {
            selectedNodes[index] = {
              ...selectedNodes[index],
              ...updateContent,
            };
          }
        }
        return {
          ...node,
          ...updateContent,
        };
      }
      return node;
    });
  return {
    newNodes,
    updateNodes,
  };
};

// 处理节点变化
const processNodeChanges = (changes: any) => {
  const updateNodes: any[] = [];
  const deleteNodeIds: string[] = [];
  const positionNodes: any[] = [];
  const manualResizeNodeIds: string[] = [];
  changes.forEach((change: any) => {
    // 尺寸变化
    if (change.type == 'dimensions' && change.resizing === false) {
      const changeItem = {
        id: change.id,
        measured: change.dimensions,
        width: change.dimensions.width,
        height: change.dimensions.height,
      };
      updateNodes.push(changeItem);
      manualResizeNodeIds.push(change.id);
    }
    // 位置变化
    if (change.type == 'position' && change.dragging === false) {
      const changeItem = {
        id: change.id,
        position: change.position,
      };
      updateNodes.push(changeItem);
      positionNodes.push(changeItem);
    }
    // 节点删除
    if (change.type == 'remove') {
      deleteNodeIds.push(change.id);
    }
  });
  return {
    updateNodes,
    deleteNodeIds,
    positionNodes,
    manualResizeNodeIds,
  };
};

// 克隆连线
const cloneEdges = (edges: Edge[]) => {
  const newEdges = edges.map((item: Edge) => {
    const newEdge = JSON.parse(JSON.stringify(item));
    newEdge.id = uuidv4();
    return newEdge;
  });
  return newEdges;
};

// 根据节点映射更新节点数据
const updateNodesByMap = (nodes: Node[], nodesMap: Node[]) => {
  let isChangeFailure = false; // 是否存在生成失败
  const newNodes = nodes.map((node, index) => {
    const nodeItem = nodesMap[index];
    let targetNodeItem; // 目标匹配节点
    if (nodeItem && node.id === nodeItem.id) {
      targetNodeItem = nodeItem;
    } else {
      // 若未按顺序则需要遍历获取目标匹配节点
      nodesMap.forEach((item: Node) => {
        if (node.id === item.id) {
          targetNodeItem = item;
        }
      });
    }
    if (targetNodeItem) {
      const newData = targetNodeItem.data;
      const originData = node.data;
      const newTaskInfo = newData.taskInfo as TaskInfo;
      const originTaskInfo = originData.taskInfo as TaskInfo;
      if (
        (originTaskInfo.status != 'failure' && newTaskInfo.status == 'failure') ||
        (originTaskInfo.status == 'failure' && newTaskInfo.status == 'failure' && originTaskInfo.taskId !== newTaskInfo.taskId)
      ) {
        isChangeFailure = true;
      }
      return {
        ...node,
        data: {
          ...originData,
          value: newData.value,
          product: newData.product,
          taskInfo: newData.taskInfo,
        },
      };
    } else {
      return node;
    }
  });
  return {
    newNodes,
    isChangeFailure,
  };
};

/**
 * 判断由节点列表和边列表定义的图是否为有向无环图（DAG）
 *
 * @param {Array} nodeIds - 节点列表（元素为节点标识，如number、string）
 * @param {Array} edges - 边列表（每个元素为对象，含source和target键，代表有向边）
 * @returns {boolean} - true表示是DAG，false表示存在环
 */
const isDag = (nodeIds: string[], edges: Edge[]): boolean => {
  // 1. 构建邻接表（记录每个节点的出边指向的节点）和入度字典
  const adjacency = new Map(); // 邻接表
  const inDegree = new Map(); // 入度表
  const nodeSet = new Set(nodeIds); // 用于快速检查节点是否存在

  // 初始化邻接表和入度表
  for (const node of nodeIds) {
    adjacency.set(node, []);
    inDegree.set(node, 0);
  }

  // 2. 填充邻接表和入度表
  for (const edge of edges) {
    const source = edge.source;
    const target = edge.target;

    // 校验边的节点是否在节点列表中（避免无效边）
    if (!nodeSet.has(source) || !nodeSet.has(target)) {
      throw new Error(`边 ${JSON.stringify(edge)} 包含无效节点（不在nodes列表中）`);
    }

    adjacency.get(source).push(target); // source指向target，添加到邻接表
    inDegree.set(target, inDegree.get(target) + 1); // target的入度+1
  }

  // 3. 初始化队列：入度为0的节点（无前置依赖）
  const queue = nodeIds.filter(nodeId => inDegree.get(nodeId) === 0);

  let processedCount = 0; // 记录已处理的节点数

  // 4. 拓扑排序核心逻辑
  while (queue.length > 0) {
    const currentNode = queue.shift();
    processedCount++;

    // 遍历当前节点的所有出边，减少邻接节点的入度
    for (const neighbor of adjacency.get(currentNode)) {
      inDegree.set(neighbor, inDegree.get(neighbor) - 1);
      // 若邻接节点入度变为0，加入队列
      if (inDegree.get(neighbor) === 0) {
        queue.push(neighbor);
      }
    }
  }

  // 5. 若处理的节点数等于总节点数，说明无环（是DAG）
  return processedCount === nodeIds.length;
};
// 过滤画布节点
const filterCanvas = (nodes: Node[]) => {
  const groupNodes = nodes.filter((item: Node) => item.type === 'group');
  const groupIds = groupNodes.map((group: Node) => group.id);

  // 过滤出有效的节点：要么没有parentId，要么parentId存在于groupIds中
  const validNodes = nodes.filter((item: Node) => {
    if (!item.parentId) {
      return true; // 没有父ID的节点总是有效的
    }
    return groupIds.includes(item.parentId); // parentId存在于groupIds中的节点是有效的
  });
  return validNodes;
};

// 兼容旧协议
const compatibilityCanvas = (nodes: Node[], edges: Edge[]) => {
  // 模型名称切换映射
  const modelTransformMap: Record<string, string> = {
    'gemini-3-pro-preview': 'gemini-3.1-pro-preview',
  };
  const transformParams: Record<string, string> = {
    times: 'gen_count',
    image_size: 'resolution',
    size: 'resolution',
    duration_seconds: 'duration',
    ratio: 'aspect_ratio',
    seconds: 'duration',
  };
  const resolutionMap: Record<string, string> = {
    '2048x2048': '2K',
    '2304x1728': '2K',
    '1728x2304': '2K',
    '2560x1440': '2K',
    '1440x2560': '2K',
    '2496x1664': '2K',
    '1664x2496': '2K',
    '3024x1296': '4K',
  };
  const modelMap = ['doubao-seedream-4-5-251128', 'doubao-seedream-4-0-250828'];
  nodes.forEach(item => {
    const params: any = item.data.params;
    const seniorParams: any = params?.seniorParams;
    if (!params) return;
    const type = item.type;
    for (const key in params) {
      if (key == 'prompt') continue;
      const value = params[key];
      const newParamName = transformParams[key];
      // 对变更参数名修正
      if (newParamName) {
        delete params[key];
        params[newParamName] = value;
      }
      // 对级联值拆分
      if (typeof value === 'string' && (value.includes('p ') || value.includes('P '))) {
        const valueArray = value.split(' ');
        params.resolution = valueArray[0];
        params.duration = Number(valueArray[1]);
      }
    }
    // 针对部分模型做参数兼容
    if (modelMap.includes(params.model)) {
      params.resolution = resolutionMap[params.resolution] ? resolutionMap[params.resolution] : params.resolution;
      params.aspect_ratio = params.aspect_ratio ? params.aspect_ratio : '1:1';
    }
    // 对不存在模型类型字段的视频/图片节点，按连入图片数量补充模式
    if ((type == 'video' || type == 'image') && !params.modelType) {
      const relativeEdges = getInputEdgesByNodes([item], edges);
      const imageLength = relativeEdges.filter(edge => edge.sourceHandle == 'image_source').length;
      if (type == 'video') {
        const hasVideoOrAudioInput = relativeEdges.some(edge => edge.sourceHandle == 'video_source' || edge.sourceHandle == 'audio_source');
        params.modelType = transformVideoType(imageLength, hasVideoOrAudioInput);
      }
      if (type == 'image') {
        params.modelType = transformImageType(imageLength);
      }
    }
    // 对模型名称进行修正
    if (modelTransformMap[params.model]) {
      params.model = modelTransformMap[params.model];
    }
    // voice_id字段变更位置
    if (type == 'audio' && seniorParams.voice_id && !params.voiceId) {
      params.voiceId = seniorParams.voice_id;
    }
  });
  return nodes;
};

/**
 * 历史兼容：旧画布中工具子节点也标为 upload，按 Tool 入边纠正为 tool
 */
const migrateUploadToolChildContentType = (nodes: Node[], edges: Edge[]) => {
  const nodeById = new Map(nodes.map(n => [n.id, n]));
  return nodes.map(node => {
    const contentType = (node.data as any)?.type;
    if (contentType !== 'upload') return node;
    const hasToolParent = edges.some(edge => {
      if (edge.target !== node.id) return false;
      const source = nodeById.get(edge.source);
      return Boolean(source?.type?.includes('Tool'));
    });
    if (!hasToolParent) return node;
    return {
      ...node,
      data: {
        ...node.data,
        type: 'tool' as MediaNodeContentType,
      },
    };
  });
};

/** 与 processNodes 相同链路，额外返回是否发生过订阅模型替换（用于 toast） */
const processNodesWithMigration = (nodes: Node[], edges: Edge[], migration?: ProcessNodesMigrationInput | null) => {
  const validNodes = filterCanvas(nodes);
  let next = compatibilityCanvas(validNodes, edges);
  next = migrateUploadToolChildContentType(next, edges);
  let replacedSubscriptionModel = false;
  if (migration) {
    const r = applyCanvasPermissionMigration(next, migration.modelNodePermission ?? null, migration.subscriptionFallbackMap ?? {});
    next = r.nodes;
    replacedSubscriptionModel = r.replacedSubscriptionModel;
  }
  return { nodes: next, replacedSubscriptionModel };
};

// 初始化处理画布节点（兼容旧协议；可选迁移上下文）
const processNodes = (nodes: Node[], edges: Edge[], migration?: ProcessNodesMigrationInput | null) => {
  return processNodesWithMigration(nodes, edges, migration).nodes;
};

// 判断连线是否合法
const isAllowConnect = (edge: Edge, nodes: Node[] = []) => {
  if (edge.target == edge.source) return false;

  const targetNode = nodes.find(n => n.id === edge.target);
  if (targetNode?.type !== 'storyboardTool') return true;

  const sourceType = edge.sourceHandle?.split('_')[0];
  if (!sourceType) return false;

  const mode = String((targetNode as any)?.data?.params?.mode || 'custom');
  const allowConnects = getStoryboardAllowConnectTypes(mode);
  return allowConnects.includes(sourceType);
};

const isToolNodeType = (type?: string) => type?.includes('Tool') ?? false;

/** 统一连线校验：禁止工具节点输出句柄手动连出，并合并 isAllowConnect / isAllowHandler / calibrateEdge 判断 */
const validateConnection = (
  connection: { source?: string | null; target?: string | null; sourceHandle?: string | null | undefined; targetHandle?: string | null | undefined },
  nodes: Node[] = []
): boolean => {
  if (!connection.source || !connection.target) return false;
  if (connection.source === connection.target) return false;

  const sourceNode = nodes.find(n => n.id === connection.source);
  const targetNode = nodes.find(n => n.id === connection.target);
  if (!sourceNode || !targetNode) return false;

  // 禁止用户手动将工具节点输出句柄连向任意节点
  if (isToolNodeType(sourceNode.type) && connection.sourceHandle?.endsWith('_source')) {
    return false;
  }

  const edge: Edge = {
    id: `${connection.source}-${connection.target}`,
    source: connection.source,
    target: connection.target,
    sourceHandle: connection.sourceHandle ?? undefined,
    targetHandle: connection.targetHandle ?? undefined,
  };

  if (!isAllowConnect(edge, nodes)) return false;
  if (isAllowHandler(edge)) return true;

  const edgeCopy = { ...edge };
  return calibrateEdge(targetNode, edgeCopy);
};

// 判断连线句柄是否对应
const isAllowHandler = (edge: Edge) => {
  const sourceType = edge.sourceHandle?.split('_')[0];
  const targetType = edge.targetHandle?.split('_')[0];
  if (sourceType !== targetType) return false;
  else return true;
};

// 判断节点组是否可执行
const isAllowRun = async (
  nodes: Node[],
  edges: Edge[],
  modelMaxPromptMap: ModelMaxPromptMap = {},
  allNodes: Node[] = nodes,
  allEdges: Edge[] = edges,
  executeStrategy: 'total' | 'single' = 'total',
  modelPermission: NormalizedModelPermission | null = null,
  runningNodeId = '',
  modelsMap: MediaModelsMap = {},
  capacityCheck: () => Promise<boolean> = isAllowCapacity
) => {
  let isAllow = true;
  let message = {
    type: 'warning',
    content: '当前工作流无法执行',
  };
  const nodeIds = nodes.map(item => item.id);
  // 先做前端独立简易判断
  if (executeStrategy !== 'single') {
    nodes.forEach((item: Node) => {
      const taskInfo: any = item.data.taskInfo;
      if (taskInfo.status === 'running') {
        isAllow = false;
        message.content = '当前存在正在执行工作流节点，请稍等';
      }
      if (item.type?.includes('Tool')) {
        isAllow = false;
        message.content = '工具节点暂不支持一键执行';
      }
    });
  }

  // maxPrompt 字符长度限制（基础节点 image/video/audio/text）
  const nodesForBasicValidation = executeStrategy === 'single' && runningNodeId ? nodes.filter(n => n.id === runningNodeId) : nodes;
  if (isAllow) {
    const basicTypes = new Set(['image', 'video', 'audio', 'text']);
    for (const node of nodesForBasicValidation) {
      if (!basicTypes.has(String(node.type || ''))) continue;
      const modelValue = String((node as any)?.data?.params?.model || '');
      const maxPrompt = modelMaxPromptMap?.[modelValue];
      if (!maxPrompt || maxPrompt <= 0) continue;

      const prompt = String((node as any)?.data?.params?.prompt || '');
      const { texts } = getSourceMap(allNodes, allEdges, node.id);
      const inputTextLen = (texts || []).reduce((sum: number, t) => sum + (t?.value?.length ?? 0), 0);
      const currentLen = prompt.length + inputTextLen;
      if (currentLen > maxPrompt) {
        isAllow = false;
        const nodeName = String((node as any)?.data?.title || node.type || node.id);
        message.content = `节点「${nodeName}」当前输入字数 ${currentLen} 超过模型限制 ${maxPrompt}，请调整后再执行`;
        break;
      }
    }
  }
  // 进一步前端处理环形结构
  if (isAllow) {
    const dagTag = isDag(nodeIds, edges);
    if (!dagTag) {
      isAllow = false;
      message.content = '当前存在环形结构不允许执行，请删去成环连线';
    }
  }

  // 模型 / 参数权限（后端下发且非空时才校验）
  if (isAllow && modelPermission && modelPermission.byCategoryAndKey.size > 0) {
    if (!validateBasicNodesParamsForRun(nodesForBasicValidation, modelPermission)) {
      isAllow = false;
      message.content = '执行内容中存在您不可用的模型或者参数，请检查执行内容并替换成可用的模型或参数';
    }
  }

  // [media-node-model-unification] image/video 模型模式与参数可选项校验
  if (isAllow && modelsMap && (modelsMap.image?.length || modelsMap.video?.length)) {
    const mediaBlockTip = validateMediaNodesForRun(nodesForBasicValidation, modelsMap);
    if (mediaBlockTip) {
      isAllow = false;
      message.content = mediaBlockTip;
    }
  }

  if (!isAllow) {
    return {
      isAllow,
      message,
    };
  } else {
    // 在做需调用接口的判断
    const allowCapacity = await capacityCheck();
    if (!allowCapacity) {
      isAllow = false;
      message = {
        type: 'capacity_limit',
        content: '',
      };
    }
    return {
      isAllow,
      message,
    };
  }
};

// 添加模板节点和连线
const addTemplateNodesAndEdges = (
  templateNodes: Node[], // 模板节点
  templateEdges: Edge[], // 模板联系那
  originMaxX: number, // 当前节点最大x坐标
  originMinY: number, // 当前节点最小y坐标
  templateMinX: number, // 模板节点最小x坐标
  templateMinY: number // 模板节点最小y坐标
) => {
  // 存储原节点ID到新节点ID的映射
  const nodeIdMap: Record<string, string> = Object.fromEntries(templateNodes.map(node => [node.id, uuidv4()]));

  // 复制节点并调整坐标
  const newNodes = templateNodes.map(node => {
    const newId = nodeIdMap[node.id];

    // 创建新节点对象，保留原有parentId，调整坐标
    const newNode = {
      ...node,
      id: newId,
      selected: false,
      data: {
        ...node.data,
        time: node.data.time + '_' + Date.now(), // 模板节点创建时间+创建时间整合
        taskInfo: {
          ...(node.data.taskInfo || {}),
          status: 'success',
        },
        ...(node.data?.storyboardInfo
          ? {
              storyboardInfo: {
                ...(node.data.storyboardInfo || {}),
                status: 'success',
              },
            }
          : {}),
      },
    };

    // 如果节点没有parentId，则更新坐标
    if (!node.parentId) {
      newNode.position = {
        x: originMaxX + (node.position.x - templateMinX),
        y: originMinY + (node.position.y - templateMinY),
      };
    }

    // 如果节点有parentId，需要更新parentId为复制后的新组节点ID
    if (node.parentId && nodeIdMap[node.parentId]) {
      newNode.parentId = nodeIdMap[node.parentId];
    }

    return newNode;
  });

  // 复制连线并更新source和target为新节点ID，过滤掉缺失端点的孤立连线
  const newEdges = templateEdges
    .filter(edge => nodeIdMap[edge.source] && nodeIdMap[edge.target])
    .map(edge => ({
      ...edge,
      id: uuidv4(), // 使用uuidv4生成新ID
      source: nodeIdMap[edge.source],
      target: nodeIdMap[edge.target],
    }));

  return { newNodes, newEdges };
};

// ========== 字段选项整合与标签查找 ==========

// 将 choices 合并到 map 中，按 value 去重
const mergeFieldChoices = (map: FieldChoicesMap, field: string, choices: FieldChoiceItem[]) => {
  if (!map[field]) map[field] = [];
  const existingValues = new Set(map[field].map(c => String(c.value)));
  choices.forEach(choice => {
    if (!existingValues.has(String(choice.value))) {
      map[field].push({ value: choice.value, label: choice.label });
      existingValues.add(String(choice.value));
    }
  });
};

// 从 params/seniorParams 数组中提取 field → 中文 label 映射（协议中的 label 字段）
const extractParamLabels = (params: any[], labelsMap: FieldLabelsMap) => {
  if (!params) return;
  params.forEach((param: any) => {
    if (!param.field) return;
    if (typeof param.label === 'string') labelsMap[param.field] = param.label;
    if (param.setItems && Array.isArray(param.setItems)) {
      param.setItems.forEach((setItem: any) => {
        if (setItem.field && typeof setItem.label === 'string') {
          labelsMap[`${param.field}.${setItem.field}`] = setItem.label;
        }
      });
    }
  });
};

// 从 params/seniorParams 数组中提取 field → choices 映射，同时处理 cascade、setItems（如 cameraControl）
const extractParamChoices = (params: any[], map: FieldChoicesMap) => {
  if (!params) return;
  params.forEach((param: any) => {
    if (!param.field) return;
    // 兼容 set 类型参数（如 cameraControl）：按 param.field + setItem.field 注册子字段选项
    if (param.setItems && Array.isArray(param.setItems)) {
      param.setItems.forEach((setItem: any) => {
        if (setItem.field && setItem.choices && Array.isArray(setItem.choices)) {
          const compositeField = `${param.field}.${setItem.field}`;
          mergeFieldChoices(map, compositeField, setItem.choices);
        }
      });
      return;
    }
    if (!param.choices || !Array.isArray(param.choices)) return;
    mergeFieldChoices(map, param.field, param.choices);
    if (param.cascade) {
      for (const cascadeKey in param.cascade) {
        const cascadeGroup = param.cascade[cascadeKey];
        for (const subField in cascadeGroup) {
          if (Array.isArray(cascadeGroup[subField])) {
            mergeFieldChoices(map, subField, cascadeGroup[subField]);
          }
        }
      }
    }
  });
};

// 解析 image 类型结构：扁平模型数组，每个模型直接含 params[] 和 seniorParams[]
const buildImageFieldChoices = (models: any[]): FieldChoicesMap => {
  const map: FieldChoicesMap = {};
  const modelChoices = models.map(m => ({ value: m.value, label: m.label }));
  mergeFieldChoices(map, 'model', modelChoices);
  models.forEach((model: any) => {
    extractParamChoices(model.params, map);
    extractParamChoices(model.seniorParams, map);
  });
  return map;
};

// 解析 audio 类型结构：外层分类包裹（如 tts），内层 params 才是模型数组
const buildAudioFieldChoices = (categories: any[]): FieldChoicesMap => {
  const map: FieldChoicesMap = {};
  const typeChoices = categories.map(c => ({ value: c.value, label: c.label }));
  mergeFieldChoices(map, 'modelType', typeChoices);
  categories.forEach((category: any) => {
    if (!category.params || !Array.isArray(category.params)) return;
    const subModelChoices = category.params.map((m: any) => ({ value: m.value, label: m.label }));
    mergeFieldChoices(map, 'model', subModelChoices);
    category.params.forEach((model: any) => {
      extractParamChoices(model.params, map);
      extractParamChoices(model.seniorParams, map);
    });
  });
  return map;
};

// 从整合后的 modelsMap（含 image/audio/video/text 等 key）构建全量 field → choices
const buildFieldChoicesFromMap = (modelsMap: ModelsMap): FieldChoicesMap => {
  const nestedTypes = ['audio', 'video', 'image'];
  const map: FieldChoicesMap = {};
  for (const type in modelsMap) {
    const models = modelsMap[type as keyof ModelsMap];
    if (!models) continue;
    const typeChoices = nestedTypes.includes(type) ? buildAudioFieldChoices(models) : buildImageFieldChoices(models);
    for (const field in typeChoices) mergeFieldChoices(map, field, typeChoices[field]);
  }
  return map;
};

// 从 params/seniorParams 构建 field → 中文 label（用于 image 型 models）
const buildImageFieldLabels = (models: any[]): FieldLabelsMap => {
  const labelsMap: FieldLabelsMap = {};
  models.forEach((model: any) => {
    extractParamLabels(model.params, labelsMap);
    extractParamLabels(model.seniorParams, labelsMap);
  });
  return labelsMap;
};

// 从 categories 构建 field → 中文 label（用于 audio/video 型）
const buildAudioFieldLabels = (categories: any[]): FieldLabelsMap => {
  const labelsMap: FieldLabelsMap = {};
  categories.forEach((category: any) => {
    if (!category.params || !Array.isArray(category.params)) return;
    category.params.forEach((model: any) => {
      extractParamLabels(model.params, labelsMap);
      extractParamLabels(model.seniorParams, labelsMap);
    });
  });
  return labelsMap;
};

// 从整合后的 modelsMap 构建全量 field → 中文 label
export const buildFieldLabelsFromMap = (modelsMap: ModelsMap): FieldLabelsMap => {
  const nestedTypes = ['audio', 'video', 'image'];
  const labelsMap: FieldLabelsMap = {};
  for (const type in modelsMap) {
    const models = modelsMap[type as keyof ModelsMap];
    if (!models) continue;
    const typeLabels = nestedTypes.includes(type) ? buildAudioFieldLabels(models) : buildImageFieldLabels(models);
    Object.assign(labelsMap, typeLabels);
  }
  return labelsMap;
};

/** 用户上传节点创建时写入 upload 类型（尚无结果 URL） */
export const buildInitialUploadNodeData = (data: Record<string, unknown>) => ({
  ...data,
  type: 'upload' as MediaNodeContentType,
  product: [],
  tempFile: null,
  params: {
    ...(data.params as object),
    prompt: '',
  },
});

/** 媒体节点本地上传/资产库上传成功后写入 data */
export const buildMediaUploadNodeData = (data: Record<string, unknown>, url: string) => ({
  ...buildInitialUploadNodeData(data),
  value: url,
});

/** 工具输出子节点创建时写入 tool 类型（尚无结果 URL） */
export const buildInitialToolOutputNodeData = (data: Record<string, unknown>) => ({
  ...data,
  type: 'tool' as MediaNodeContentType,
  product: [],
  tempFile: null,
  params: {
    ...(data.params as object),
    prompt: '',
  },
});

/** 工具输出子节点回写结果 URL */
export const buildMediaToolOutputNodeData = (data: Record<string, unknown>, url: string) => ({
  ...buildInitialToolOutputNodeData(data),
  value: url,
});

/** 根据 field 和 value 在 choicesMap 中查找对应 label，找不到则返回 String(value) */
export const getLabelByFieldValue = (choicesMap: FieldChoicesMap, field: string, value: any): string => {
  const choices = choicesMap[field];
  if (!choices) return String(value);
  const match = choices.find(c => String(c.value) === String(value));
  return match ? match.label : String(value);
};

export default {
  copyNode, // 复制节点
  pasteNode, // 粘贴节点
  createNode, // 创建节点
  createDragEdge, // 创建拖拽连线
  dealEdge, // 处理连线颜色等动画属性
  processEdges, // 补全连线颜色等动画属性；并清除选中态/临时高亮
  stripEdgeTransientUiState, // 去掉连线临时选中态与 #fff 高亮
  syncIntraGroupEdgeZIndex,
  calibrateEdge, // 校准连线句柄
  creatGroupNode, // 根据给定范围创建组节点
  addTemplateNodesAndEdges, // 添加模板节点和连线

  // 模型参数处理相关
  transformModelMap, // 参数转换
  transformModelMapWithPromptLimit, // 参数转换 + maxPrompt map
  createDefaultParams, // 创建默认参数
  creareDefaultParamsV2, // 创建默认的参数内容针对音频特殊处理
  resolveParamsOnModelChange, // 切换 model 时兼容保留旧参数
  resolveParamsOnModelTypeChange, // 切换 modelType 时智能保留模型与参数
  transformByModel, // 根据模型参数转化参数选项
  transformByModelType, // 根据模型类型参数转化参数选项
  getTransformItems, // 根据模型/生成数量以外的参数转化参数选项
  getVideoModelTypeMismatchReason, // 视频模型类型与连线不匹配时的生成按钮提示
  getImageModelTypeMismatchReason, // 图片模型类型与连线不匹配时的生成按钮提示
  getImageSvgUnsupportedReason, // 非白名单模型连入 SVG 时的生成按钮提示
  getAudioModelTypeMismatchReason,
  transformVideoType, // 根据连入图片/视频/音频数量推导视频 modelType（旧协议兼容）
  resolveVideoModelTypeOnInputChange, // 连线变化时推导视频 modelType（文生/参考生）
  transformImageType, // 根据连入图片数量推导图片 modelType

  // 获取节点、连线以及节点内容相关
  getValueByNodeIds, // 获取传入节点的值
  getSourceMap, // 获取输入map

  // 更新画布节点信息
  updateGroupChild, // 根据组节点更新子节点
  validateGroup, // 检验组内是否存在子节点
  upgroupChild, // 解组
  processNodeChanges, // 处理节点变化
  cloneEdges, // 克隆连线
  updateNodesByMap, // 根据节点映射更新节点数据
  processNodes, // 初始化处理画布节点
  processNodesWithMigration, // 初始化处理画布节点（含迁移元信息）

  isAllowConnect, // 判断连线是否合法
  isAllowHandler, // 判断连线句柄是否对应
  validateConnection, // 统一连线校验（含工具节点输出限制）
  isAllowRun, // 判断节点组是否可执行

  // 字段选项整合与标签查找
  buildFieldChoicesFromMap, // 从完整 modelsMap 构建 field → choices
  buildFieldLabelsFromMap, // 从完整 modelsMap 构建 field → 中文 label
  buildInitialUploadNodeData, // 用户上传节点创建时写入 upload 类型
  buildMediaUploadNodeData, // 媒体节点上传完成后写入 data
  buildInitialToolOutputNodeData, // 工具输出子节点创建时写入 tool 类型
  buildMediaToolOutputNodeData, // 工具输出子节点回写结果 URL
  applyEmptyMediaNodeDimensions, // 空媒体节点按模型比例初始化尺寸
};
