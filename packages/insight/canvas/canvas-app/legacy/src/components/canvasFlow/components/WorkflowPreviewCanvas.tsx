import { useMemo } from 'react';
import { Background, BackgroundVariant, Handle, Position, ReactFlow, ReactFlowProvider, type Edge, type Node } from '@xyflow/react';
import { Music2, Workflow } from 'lucide-react';
import { buildVideoPosterUrl } from '@/components/Asset/util';

export interface WorkflowPreviewData {
  nodes: Node[];
  edges: Edge[];
}

interface WorkflowPreviewCanvasProps {
  data: WorkflowPreviewData;
}

const PreviewNode = ({ data }: any) => {
  const type = data.previewType as string;
  const value = typeof data.value === 'string' ? data.value : '';
  return (
    <div className='relative flex h-full w-full flex-col overflow-hidden rounded-lg border border-white/20 bg-[#252525] text-white shadow-lg'>
      <Handle type='target' position={Position.Left} className='!h-3 !w-3 !border-2 !border-[#101010] !bg-[#5865f2]' />
      <div className='h-8 shrink-0 border-b border-white/10 px-3 text-xs font-medium leading-8'>{data.title || '未命名节点'}</div>
      <div className='flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-black/25'>
        {type === 'image' && value ? <img src={value} alt='' className='h-full w-full object-cover' /> : null}
        {type === 'video' && value && /aliyuncs\.com/i.test(value) ? <img src={buildVideoPosterUrl(value, 480)} alt='' className='h-full w-full object-cover' /> : null}
        {type === 'video' && value && !/aliyuncs\.com/i.test(value) ? <video src={value} muted playsInline preload='metadata' className='h-full w-full object-cover' /> : null}
        {type === 'text' ? <div className='line-clamp-5 w-full px-4 text-sm text-white/80'>{value || '空文本节点'}</div> : null}
        {type === 'audio' ? <Music2 className='h-10 w-10 text-white/50' /> : null}
        {!['image', 'video', 'text', 'audio'].includes(type) ? <Workflow className='h-10 w-10 text-white/50' /> : null}
      </div>
      <Handle type='source' position={Position.Right} className='!h-3 !w-3 !border-2 !border-[#101010] !bg-emerald-500' />
    </div>
  );
};

const PreviewGroup = ({ data }: any) => (
  <div className='h-full w-full rounded-lg border-2 border-white/35 bg-white/5'>
    <div className='px-3 pt-2 text-sm font-medium text-white/80'>{data.title || '组合'}</div>
  </div>
);

const nodeTypes = {
  workflowPreview: PreviewNode,
  workflowPreviewGroup: PreviewGroup,
};

const getStyleSize = (value: unknown) => {
  const size = typeof value === 'number' ? value : Number.parseFloat(String(value || ''));
  return Number.isFinite(size) ? size : undefined;
};

const normalizePreviewData = (data?: WorkflowPreviewData | null): WorkflowPreviewData => {
  const rawNodes = Array.isArray(data?.nodes) ? data.nodes : [];
  const rawEdges = Array.isArray(data?.edges) ? data.edges : [];

  return {
    nodes: rawNodes.map(node => {
      const isGroup = node.type === 'group';
      const width = node.measured?.width || node.width || getStyleSize(node.style?.width) || (isGroup ? 600 : 280);
      const height = node.measured?.height || node.height || getStyleSize(node.style?.height) || (isGroup ? 360 : 220);
      return {
        ...node,
        type: isGroup ? 'workflowPreviewGroup' : 'workflowPreview',
        selected: false,
        draggable: false,
        selectable: false,
        width,
        height,
        style: { ...node.style, width, height },
        data: {
          ...(node.data || {}),
          previewType: node.type,
        },
      };
    }),
    edges: rawEdges.map(edge => ({
      ...edge,
      sourceHandle: undefined,
      targetHandle: undefined,
      selected: false,
      animated: false,
      style: { ...edge.style, stroke: '#8b8b93', strokeWidth: 2 },
    })),
  };
};

export default function WorkflowPreviewCanvas({ data }: WorkflowPreviewCanvasProps) {
  const previewData = useMemo(() => normalizePreviewData(data), [data]);
  return (
    <ReactFlowProvider>
      <ReactFlow
        nodes={previewData.nodes}
        edges={previewData.edges}
        nodeTypes={nodeTypes}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        panOnDrag
        zoomOnScroll
        fitView
        fitViewOptions={{ padding: 0.25 }}
        minZoom={0.1}
      >
        <Background color='#777' variant={BackgroundVariant.Dots} />
      </ReactFlow>
    </ReactFlowProvider>
  );
}
