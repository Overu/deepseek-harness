import { useReactFlow } from '@xyflow/react';
import { useCallback } from 'react';

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 4;

/** 滚动区域保留 nowheel 以支持表格原生滚动；Ctrl/Cmd + 滚轮时手动缩放画布 */
export function useStoryboardCanvasWheel() {
  const { getZoom, zoomTo } = useReactFlow();

  const handleWheel = useCallback(
    (event: React.WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;

      event.preventDefault();
      event.stopPropagation();

      const zoom = getZoom();
      const nextZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom * Math.exp(-event.deltaY * 0.002)));
      zoomTo(nextZoom);
    },
    [getZoom, zoomTo]
  );

  return { handleWheel, noWheelClassName: 'nowheel' };
}
