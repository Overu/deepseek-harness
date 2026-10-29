import { useCallback, useEffect, useRef, useState } from 'react';
import type { Node, NodeChange, NodePositionChange } from '@xyflow/react';
import { getHelperLines, helperLinesEqual, type HelperLinesState } from '../utils/helperLines';

/**
 * 画布单节点拖拽对齐吸附 + 辅助线状态。
 * 算法见 utils/helperLines；本 hook 只负责 state / 脉冲反馈 / 写回 change.position。
 */
export const useHelperLines = () => {
  const [helperLines, setHelperLines] = useState<HelperLinesState>({});
  const [helperLinesHighlighted, setHelperLinesHighlighted] = useState(false);
  const [snapPulse, setSnapPulse] = useState(false);
  const helperLinesRef = useRef<HelperLinesState>({});
  const lastSnapKeyRef = useRef('');
  const snapHighlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const snapPulseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (snapHighlightTimerRef.current) clearTimeout(snapHighlightTimerRef.current);
      if (snapPulseTimerRef.current) clearTimeout(snapPulseTimerRef.current);
    };
  }, []);

  /** 单节点拖拽时吸附并更新辅助线；多选拖动或非拖拽 position 时清空辅助线 */
  const applyHelperLineSnap = useCallback((changes: NodeChange[], nodes: Node[]) => {
    const draggingPositionChanges = changes.filter((change): change is NodePositionChange => change.type === 'position' && Boolean(change.dragging) && Boolean(change.position));

    if (draggingPositionChanges.length === 1) {
      const result = getHelperLines(draggingPositionChanges[0], nodes);
      if (result.snapPosition.x !== undefined && draggingPositionChanges[0].position) {
        draggingPositionChanges[0].position.x = result.snapPosition.x;
      }
      if (result.snapPosition.y !== undefined && draggingPositionChanges[0].position) {
        draggingPositionChanges[0].position.y = result.snapPosition.y;
      }
      const nextLines: HelperLinesState = {
        horizontal: result.horizontal,
        vertical: result.vertical,
      };
      if (!helperLinesEqual(helperLinesRef.current, nextLines)) {
        helperLinesRef.current = nextLines;
        setHelperLines(nextLines);
      }
      const snapKey = `${result.horizontal ?? ''}|${result.vertical ?? ''}`;
      if ((result.horizontal !== undefined || result.vertical !== undefined) && snapKey !== lastSnapKeyRef.current) {
        lastSnapKeyRef.current = snapKey;
        setHelperLinesHighlighted(true);
        setSnapPulse(true);
        if (snapHighlightTimerRef.current) clearTimeout(snapHighlightTimerRef.current);
        if (snapPulseTimerRef.current) clearTimeout(snapPulseTimerRef.current);
        snapHighlightTimerRef.current = setTimeout(() => setHelperLinesHighlighted(false), 150);
        snapPulseTimerRef.current = setTimeout(() => setSnapPulse(false), 150);
      }
      if (result.horizontal === undefined && result.vertical === undefined) {
        lastSnapKeyRef.current = '';
      }
    } else if (helperLinesRef.current.horizontal !== undefined || helperLinesRef.current.vertical !== undefined) {
      helperLinesRef.current = {};
      lastSnapKeyRef.current = '';
      setHelperLines({});
      setHelperLinesHighlighted(false);
    }
  }, []);

  return {
    helperLines,
    helperLinesHighlighted,
    snapPulse,
    applyHelperLineSnap,
  };
};
