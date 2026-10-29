import { useEditorStore } from '../../store/editorStore';
import { useLayerStore } from '../../store/layerStore';
import { BrushToolbar } from './BrushToolbar';
import { PropertyPanel } from '../PropertyPanel';
import { cn } from '@/lib/utils';

interface ToolbarProps {
  onStartCrop?: (objectId: string) => void;
  onStartMatting?: (objectId: string) => void;
}

export function Toolbar({ onStartCrop, onStartMatting }: ToolbarProps) {
  const { activeTool } = useEditorStore();
  const { activeIds, layers } = useLayerStore();

  const getActiveType = () => {
    if (activeIds.length === 0) return 'canvas';
    if (activeIds.length > 1) return 'group';
    const activeId = activeIds[0];
    const layer = layers.find(l => l.id === activeId);
    return layer?.type || 'unknown';
  };

  const activeType = getActiveType();

  const renderContent = () => {
    // 1. Tool Modes taking precedence
    if (activeTool === 'draw') {
      return <BrushToolbar />;
    }

    // 2. Selection Modes
    const hasProps = ['group', 'textbox', 'i-text', 'text', 'image', 'rect', 'path', 'circle', 'triangle', 'polygon'].includes(activeType);
    if (hasProps) {
      return <PropertyPanel onStartCrop={onStartCrop} onStartMatting={onStartMatting} />;
    }

    return null;
  };

  const content = renderContent();

  if (!content) return null;

  return <div className={cn('absolute top-[60px] left-1/2 -translate-x-1/2 z-10')}>{content}</div>;
}
