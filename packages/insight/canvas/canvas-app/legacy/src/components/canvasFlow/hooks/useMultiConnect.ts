import { useCallback, useEffect, useRef, useState } from 'react';
import type { Node } from '@xyflow/react';
import { toast } from 'sonner';
import { useFlowStore } from '@/store/flowStore';
import {
  MULTI_CONNECT_SNAP_RADIUS,
  clearSnapHandleHighlight,
  findClosestTargetHandle,
  findNodeAtPoint,
  getSourceHandleScreenAnchors,
  prepareMultiConnectEdges,
  setSnapHandleHighlight,
  type SnappedTarget,
  type SourceHandleAnchor,
} from '../utils/multiConnect';

export type MultiConnectMenuPayload = {
  x: number;
  y: number;
  sourceNodeIds: string[];
};

type DragState = {
  active: boolean;
  sourceNodeIds: string[];
  anchors: SourceHandleAnchor[];
  toX: number;
  toY: number;
  snapped: SnappedTarget | null;
};

const INITIAL_DRAG: DragState = {
  active: false,
  sourceNodeIds: [],
  anchors: [],
  toX: 0,
  toY: 0,
  snapped: null,
};

/**
 * 多选加号拖拽批量连线：预览线、句柄吸附、松手连入已有节点或打开全量菜单。
 * @param onOpenMenu 松手未命中节点时打开全量菜单
 * @param onAfterConnectToExisting 连入已有节点后回调（用于清本地框选 UI）
 */
export const useMultiConnect = (onOpenMenu: (payload: MultiConnectMenuPayload) => void, onAfterConnectToExisting?: () => void) => {
  const nodes = useFlowStore(state => state.nodes);
  const edges = useFlowStore(state => state.edges);
  const { connectMany } = useFlowStore(state => state.actions);

  const [drag, setDrag] = useState<DragState>(INITIAL_DRAG);
  const dragRef = useRef(drag);
  const snapElRef = useRef<Element | null>(null);
  const nodesRef = useRef(nodes);
  const edgesRef = useRef(edges);
  const onAfterConnectRef = useRef(onAfterConnectToExisting);

  useEffect(() => {
    dragRef.current = drag;
  }, [drag]);

  useEffect(() => {
    nodesRef.current = nodes;
    edgesRef.current = edges;
  }, [nodes, edges]);

  useEffect(() => {
    onAfterConnectRef.current = onAfterConnectToExisting;
  }, [onAfterConnectToExisting]);

  const finishDrag = useCallback(() => {
    clearSnapHandleHighlight(snapElRef.current);
    snapElRef.current = null;
    setDrag(INITIAL_DRAG);
  }, []);

  const applyConnectToTarget = useCallback(
    (sourceNodeIds: string[], targetId: string, preferredHandle?: string | null) => {
      const currentNodes = nodesRef.current;
      const currentEdges = edgesRef.current;
      const sourceNodes = sourceNodeIds.map(id => currentNodes.find(n => n.id === id)).filter((n): n is Node => !!n);
      if (!sourceNodes.length) return;

      const { edges: prepared, failed } = prepareMultiConnectEdges(sourceNodes, targetId, currentNodes, currentEdges, preferredHandle);
      // 含空数组：复用 connectMany 内清边选中态 / 取消框选
      connectMany(prepared);
      onAfterConnectRef.current?.();
      if (failed.length > 0) {
        toast.warning(prepared.length === 0 ? `${failed.length} 个节点无法连入该目标` : `${failed.length} 个节点无法连入该目标，其余已连入`);
      }
    },
    [connectMany]
  );

  const onPointerMove = useCallback((event: PointerEvent) => {
    const current = dragRef.current;
    if (!current.active) return;

    const exclude = new Set(current.sourceNodeIds);
    const snapped = findClosestTargetHandle(event.clientX, event.clientY, MULTI_CONNECT_SNAP_RADIUS, exclude);
    snapElRef.current = setSnapHandleHighlight(snapElRef.current, snapped?.element || null);

    setDrag(prev => ({
      ...prev,
      toX: snapped ? snapped.clientX : event.clientX,
      toY: snapped ? snapped.clientY : event.clientY,
      snapped,
    }));
  }, []);

  const onPointerUp = useCallback(
    (event: PointerEvent) => {
      const current = dragRef.current;
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);

      if (!current.active) {
        finishDrag();
        return;
      }

      const exclude = new Set(current.sourceNodeIds);
      const snapped = current.snapped || findClosestTargetHandle(event.clientX, event.clientY, MULTI_CONNECT_SNAP_RADIUS, exclude);

      if (snapped) {
        applyConnectToTarget(current.sourceNodeIds, snapped.nodeId, snapped.handleId);
        finishDrag();
        return;
      }

      const nodeId = findNodeAtPoint(event.clientX, event.clientY, exclude);
      if (nodeId) {
        applyConnectToTarget(current.sourceNodeIds, nodeId, null);
        finishDrag();
        return;
      }

      const sourceNodeIds = [...current.sourceNodeIds];
      finishDrag();
      onOpenMenu({ x: event.clientX, y: event.clientY, sourceNodeIds });
    },
    [applyConnectToTarget, finishDrag, onOpenMenu, onPointerMove]
  );

  const startMultiConnect = useCallback(
    (event: React.PointerEvent, selectedNodes: Node[] | undefined) => {
      if (!selectedNodes || selectedNodes.length < 2) return;
      const sourceNodeIds = selectedNodes.map(n => n.id);
      const anchors = getSourceHandleScreenAnchors(sourceNodeIds);
      setDrag({
        active: true,
        sourceNodeIds,
        anchors,
        toX: event.clientX,
        toY: event.clientY,
        snapped: null,
      });
      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', onPointerUp);
    },
    [onPointerMove, onPointerUp]
  );

  useEffect(() => {
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      clearSnapHandleHighlight(snapElRef.current);
    };
  }, [onPointerMove, onPointerUp]);

  return {
    multiConnectActive: drag.active,
    multiConnectAnchors: drag.anchors,
    multiConnectToX: drag.toX,
    multiConnectToY: drag.toY,
    startMultiConnect,
  };
};

export default useMultiConnect;
