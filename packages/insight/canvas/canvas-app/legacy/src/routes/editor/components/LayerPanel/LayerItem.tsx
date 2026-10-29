import React, { memo } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { LayerMeta } from '../../core/types';
import { useLayerStore } from '../../store/layerStore';
import { useEditorEngine } from '../../hooks/useEditorEngine';
import { Type, Square, Eye, EyeOff, Lock, Layers3 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { LayerContextMenu } from './LayerContextMenu';
import { getCroppedImageContentStyle, getCroppedImageFrameStyle, getLowResolutionImageThumbnailData, type ImageThumbnailData } from './thumbnailUtils';

interface LayerItemProps {
  layer: LayerMeta;
}

type ThumbnailData = string | ImageThumbnailData;

export interface LayerDragData {
  layer: LayerMeta;
  thumbnail: ThumbnailData | null;
  textContent: string;
}

const isImageThumbnailData = (thumbnail: ThumbnailData | null | undefined): thumbnail is ImageThumbnailData => {
  return typeof thumbnail === 'object' && thumbnail !== null && 'src' in thumbnail;
};

// 获取图层缩略图
const getLayerThumbnail = (layer: LayerMeta, thumbnail?: ThumbnailData | null, textContent?: string) => {
  const { type, name } = layer;

  if (type === 'group') {
    return (
      <div className='w-full h-full flex items-center justify-center bg-orange-500/20 border border-orange-500/40'>
        <Layers3 size={24} className='text-orange-400' />
      </div>
    );
  }

  switch (type) {
    case 'textbox':
    case 'text':
      return (
        <div className='w-full h-full flex flex-col items-center justify-center bg-blue-500/20 border border-blue-500/40 p-2'>
          <Type size={16} className='text-blue-400 mb-1 shrink-0' />
          <span className='text-xs text-blue-200 text-center w-full truncate' title={textContent || name}>
            {textContent || name || '文本图层'}
          </span>
        </div>
      );
    case 'image':
      if (isImageThumbnailData(thumbnail)) {
        return (
          <div className='w-full h-full flex items-center justify-center overflow-hidden'>
            <div style={getCroppedImageFrameStyle(thumbnail)}>
              <img src={thumbnail.src} alt={type} className='max-w-none max-h-none select-none' style={getCroppedImageContentStyle(thumbnail)} draggable={false} />
            </div>
          </div>
        );
      }

      return (
        <div className='w-full h-full flex items-center justify-center'>
          <Square size={24} className='text-zinc-400' />
        </div>
      );
    case 'rect':
      return (
        <div className='w-full h-full flex items-center justify-center'>
          <img src={typeof thumbnail === 'string' ? thumbnail : undefined} alt={type} className='w-full h-full object-cover' draggable={false} />
        </div>
      );
    case 'path':
      return (
        <div className='w-full h-full flex items-center justify-center'>
          <img src={typeof thumbnail === 'string' ? thumbnail : undefined} alt={type} className='w-full h-full object-contain p-1' draggable={false} />
        </div>
      );
    default:
      return (
        <div className='w-full h-full flex items-center justify-center bg-zinc-500/20 border border-zinc-500/40'>
          <Square size={24} className='text-zinc-400' />
        </div>
      );
  }
};

const LayerThumbnail = memo(({ layer, thumbnail, textContent }: LayerDragData) => (
  <div className='w-full h-full rounded overflow-hidden bg-pattern-fill'>{getLayerThumbnail(layer, thumbnail, textContent)}</div>
));

LayerThumbnail.displayName = 'LayerThumbnail';

export const LayerDragOverlay = memo(({ layer, thumbnail, textContent }: LayerDragData) => (
  <div className='w-[80px] h-[80px] rounded border-2 border-blue-400 bg-zinc-800 shadow-md overflow-hidden pointer-events-none'>
    <LayerThumbnail layer={layer} thumbnail={thumbnail} textContent={textContent} />
  </div>
));

LayerDragOverlay.displayName = 'LayerDragOverlay';

export const LayerItem = memo(({ layer }: LayerItemProps) => {
  const isActive = useLayerStore(state => state.activeIds.includes(layer.id));
  const engine = useEditorEngine();
  const [thumbnail, setThumbnail] = React.useState<ThumbnailData | null>(null);
  const [textContent, setTextContent] = React.useState<string>('');

  React.useEffect(() => {
    if (layer.type === 'group') return;

    const updateThumbnail = () => {
      const obj = engine.getObjectById(layer.id);
      if (obj) {
        if (layer.type === 'text' || layer.type === 'textbox') {
          // Extract plain text value from the Fabric textbox object
          setTextContent((obj as any).text || '');
        }

        try {
          if (layer.type === 'image' && typeof (obj as any).getSrc === 'function') {
            setThumbnail(getLowResolutionImageThumbnailData(obj));
          } else if (layer.type === 'path') {
            // 直接获取 SVG 节点字符串，拼接为标准的独立 svg 文档
            // 使用对象的物理边界作为 viewBox 以保证画面居中，且性能极高 (无 Canvas Raster)
            const bounds = obj.getBoundingRect();
            const padding = 5;
            const viewBox = `${bounds.left - padding} ${bounds.top - padding} ${bounds.width + padding * 2} ${bounds.height + padding * 2}`;
            const svgStr = obj.toSVG();
            // 组装成合法的 SVG Data URL，并且指定 xmlns
            const svgDoc = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" width="80" height="80">${svgStr}</svg>`;
            setThumbnail(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgDoc)}`);
          } else {
            // 仅对非Image且极须生成快照的图层生成 Base64（目前我们的基础图形依赖内置Icon占位即可，
            // 这里主要兜底其他需要画板快照的复杂图形）
            const url = obj.toDataURL({
              format: 'png',
              multiplier: 0.5,
            });
            setThumbnail(url);
          }
        } catch (error) {
          // 跨域图片可能导致 SecurityError，使用默认图标
          console.warn('[LayerItem] Failed to generate thumbnail:', error);
          setThumbnail(null);
        }
      }
    };

    // Initial generation
    updateThumbnail();

    // 图片只在对象修改完成后更新低分辨率缓存，不在变形过程中反复生成。
    const canvas = engine.getCanvas();
    const handleObjectModified = (e: any) => {
      if (e.target && e.target.id === layer.id) {
        if (layer.type === 'text' || layer.type === 'textbox') {
          updateThumbnail(); // text needs updateThumbnail to update display text state (and optionally snapshot)
          setTextContent((e.target as any).text || '');
        } else if (layer.type === 'image') {
          updateThumbnail();
        } else if (layer.type !== 'rect' && layer.type !== 'path') {
          // Need re-snapshot for groups, polygons, drawings etc.
          // Rects and paths don't change their fundamental shape/src on modify in a way that requires
          // updating our static/src-based thumbnails. Images do update because cropX/cropY changes the visible area.
          updateThumbnail();
        }
      }
    };

    canvas.on('object:modified', handleObjectModified);
    return () => {
      canvas.off('object:modified', handleObjectModified);
    };
  }, [layer.id, layer.type, engine]);

  const dragData = React.useMemo<LayerDragData>(() => ({ layer, thumbnail, textContent }), [layer, thumbnail, textContent]);

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: layer.id,
    data: dragData,
    transition: {
      duration: 100,
      easing: 'ease-out',
    },
  });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition: isDragging ? undefined : transition,
    opacity: isDragging ? 0 : undefined,
    willChange: transform ? 'transform' : undefined,
  };

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    const canvas = engine.getCanvas();
    const obj = engine.getObjectById(layer.id);
    if (obj) {
      canvas.setActiveObject(obj);
      canvas.requestRenderAll();
    }
  };

  const handleToggleVisibility = (e: React.MouseEvent) => {
    e.stopPropagation();
    engine.toggleLayerVisibility(layer.id);
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={`
        relative group w-full h-[80px] rounded border-2 cursor-grab active:cursor-grabbing
        ${!isDragging && isActive ? 'border-white ring-1' : !isDragging ? 'border-zinc-700 hover:border-zinc-600' : ''}
      `}
      onClick={handleClick}
    >
      {/* 缩略图 */}
      <div className='w-full h-full'>
        <LayerThumbnail layer={layer} thumbnail={thumbnail} textContent={textContent} />
      </div>

      {/* 锁定图标 - 左下角 */}
      {layer.locked && (
        <div className='absolute bottom-1 left-1 bg-red-500/90 rounded p-0.5'>
          <Lock size={10} className='text-white' />
        </div>
      )}

      {/* 右上角菜单按钮 - hover 显示 */}
      <div className='absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity'>
        <LayerContextMenu layerId={layer.id} />
      </div>

      {/* 右下角可见性按钮 - hover 显示 */}
      <div className='absolute bottom-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity'>
        <Button variant='ghost' size='icon' className='h-6 w-6 p-0 bg-zinc-900/90 hover:bg-zinc-800 rounded' onClick={handleToggleVisibility}>
          {layer.visible ? <Eye size={12} className='text-zinc-300' /> : <EyeOff size={12} className='text-zinc-600' />}
        </Button>
      </div>
    </div>
  );
});

LayerItem.displayName = 'LayerItem';
