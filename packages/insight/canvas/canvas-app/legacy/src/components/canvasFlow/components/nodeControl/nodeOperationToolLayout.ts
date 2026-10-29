import type { ToolListItem } from '../../settings/toolListConfig';

interface NodeOperationToolGroupItem {
  toolType: string;
  label?: string;
}

interface NodeOperationToolGroup {
  kind: 'group';
  key: string;
  label: string;
  items: NodeOperationToolGroupItem[];
}

interface NodeOperationToolItem {
  kind: 'tool';
  toolType: string;
  separatorBefore?: boolean;
}

export type NodeOperationToolEntry = NodeOperationToolGroup | NodeOperationToolItem;

export const NODE_OPERATION_TOOL_LAYOUT_BY_NODE_TYPE: Record<string, NodeOperationToolEntry[]> = {
  image: [
    {
      kind: 'group',
      key: 'image-processing',
      label: '图像处理',
      items: [{ toolType: 'highDefinitionTool' }, { toolType: 'imageLayoutTool' }, { toolType: 'sizeAdaptTool' }],
    },
    {
      kind: 'group',
      key: 'image-editing',
      label: '图像编辑',
      items: [{ toolType: 'imageInpaintTool' }, { toolType: 'textRedrawTool' }, { toolType: 'imageEditorTool' }],
    },
    {
      kind: 'group',
      key: 'digital-human',
      label: '数字人',
      items: [{ toolType: 'imageLipSyncTool' }, { toolType: 'poseTransVideoTool' }],
    },
    { kind: 'tool', toolType: 'gridCrop', separatorBefore: true },
    { kind: 'tool', toolType: 'panoramaTool', separatorBefore: false },
    { kind: 'tool', toolType: 'multiViewTool', separatorBefore: false },
  ],
};

interface ResolvedToolGroupItem {
  tool: ToolListItem;
  label?: string;
}

interface ResolvedToolGroup {
  kind: 'group';
  key: string;
  label: string;
  items: ResolvedToolGroupItem[];
}

interface ResolvedToolItem {
  kind: 'tool';
  tool: ToolListItem;
  separatorBefore?: boolean;
}

export type ResolvedNodeOperationToolEntry = ResolvedToolGroup | ResolvedToolItem;

export function resolveNodeOperationToolEntries(nodeType: string, tools: ToolListItem[]): ResolvedNodeOperationToolEntry[] {
  const layout = NODE_OPERATION_TOOL_LAYOUT_BY_NODE_TYPE[nodeType];
  if (!layout) return tools.map(tool => ({ kind: 'tool', tool }));

  const toolsByType = new Map(tools.map(tool => [tool.type, tool]));
  const configuredTypes = new Set<string>();
  const entries: ResolvedNodeOperationToolEntry[] = [];

  layout.forEach(entry => {
    if (entry.kind === 'tool') {
      configuredTypes.add(entry.toolType);
      const tool = toolsByType.get(entry.toolType);
      if (tool) entries.push({ kind: 'tool', tool, separatorBefore: entry.separatorBefore });
      return;
    }

    const items = entry.items.flatMap(item => {
      configuredTypes.add(item.toolType);
      const tool = toolsByType.get(item.toolType);
      return tool ? [{ tool, label: item.label }] : [];
    });
    if (items.length > 0) entries.push({ kind: 'group', key: entry.key, label: entry.label, items });
  });

  tools.forEach(tool => {
    if (!configuredTypes.has(tool.type)) entries.push({ kind: 'tool', tool, separatorBefore: true });
  });

  return entries;
}
