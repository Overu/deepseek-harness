import { useCallback, useEffect, useRef, useState } from 'react';
import type { Node } from '@xyflow/react';
import { useFlowStore } from '@/store/flowStore';
import type { LayoutMode } from '../utils/autoLayout';

/**
 * 一键排列菜单：开合、点击外部关闭、触发 flowStore.layoutSelectedNodes。
 */
export const useAutoLayoutMenu = (nodes: Node[] | undefined) => {
  const { layoutSelectedNodes } = useFlowStore(state => state.actions);
  const [layoutMenuOpen, setLayoutMenuOpen] = useState(false);
  const layoutMenuRef = useRef<HTMLDivElement | null>(null);

  const toggleMenu = useCallback(() => {
    setLayoutMenuOpen(prev => !prev);
  }, []);

  const closeMenu = useCallback(() => {
    setLayoutMenuOpen(false);
  }, []);

  const applyLayout = useCallback(
    (mode: LayoutMode) => {
      if (!nodes || nodes.length < 2) return;
      layoutSelectedNodes(nodes, mode);
      setLayoutMenuOpen(false);
    },
    [nodes, layoutSelectedNodes]
  );

  useEffect(() => {
    if (!layoutMenuOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (!layoutMenuRef.current?.contains(event.target as globalThis.Node | null)) {
        setLayoutMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [layoutMenuOpen]);

  return {
    layoutMenuOpen,
    layoutMenuRef,
    toggleMenu,
    closeMenu,
    applyLayout,
  };
};
