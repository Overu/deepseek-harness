import React from 'react';
import { createPortal } from 'react-dom';
import { DndContext, DragOverlay, closestCenter, pointerWithin, KeyboardSensor, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import type { CollisionDetection, DragEndEvent, DragStartEvent, DropAnimation } from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { restrictToVerticalAxis } from '@dnd-kit/modifiers';
import { useLayerStore } from '../../store/layerStore';
import { useEditorEngine } from '../../hooks/useEditorEngine';
import { LayerDragOverlay, LayerItem, type LayerDragData } from './LayerItem';

const dropAnimation: DropAnimation = {
  duration: 100,
  easing: 'ease-out',
};

const layerCollisionDetection: CollisionDetection = args => {
  const pointerCollisions = pointerWithin(args);
  return pointerCollisions.length > 0 ? pointerCollisions : closestCenter(args);
};

export function LayerPanel() {
  const allLayers = useLayerStore(state => state.layers);
  const engine = useEditorEngine();
  const [activeDragData, setActiveDragData] = React.useState<LayerDragData | null>(null);

  // 过滤掉工作区和手柄
  const layers = React.useMemo(() => {
    return allLayers.filter(layer => layer.id !== 'workspace' && !layer.id?.startsWith('workspace-handle-'));
  }, [allLayers]);
  const layerIds = React.useMemo(() => layers.map(layer => layer.id), [layers]);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 6,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragStart = (event: DragStartEvent) => {
    setActiveDragData((event.active.data.current as LayerDragData | undefined) ?? null);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveDragData(null);

    if (!over || active.id === over.id) return;

    const oldIndex = layers.findIndex(l => l.id === active.id);
    const newIndex = layers.findIndex(l => l.id === over.id);

    if (oldIndex !== -1 && newIndex !== -1) {
      engine.reorderLayer(active.id as string, newIndex);
    }
  };

  const handleDragCancel = () => {
    setActiveDragData(null);
  };

  // 无用户自定义图层时不展示
  if (layers.length === 0) {
    return null;
  }

  return (
    <div
      className={`fixed right-4 top-20 w-[88px] max-h-[70vh] border border-zinc-700 rounded-lg shadow-2xl overflow-hidden flex flex-col ${
        activeDragData ? 'bg-zinc-800' : 'bg-zinc-800/95 backdrop-blur-sm'
      }`}
    >
      <div className='flex-1 overflow-y-auto overflow-x-hidden'>
        <DndContext
          sensors={sensors}
          collisionDetection={layerCollisionDetection}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onDragCancel={handleDragCancel}
          modifiers={[restrictToVerticalAxis]}
        >
          <SortableContext items={layerIds} strategy={verticalListSortingStrategy}>
            <div className='p-1 space-y-1'>
              {layers.map(layer => (
                <LayerItem key={layer.id} layer={layer} />
              ))}
            </div>
          </SortableContext>
          {typeof document !== 'undefined' &&
            createPortal(
              <DragOverlay dropAnimation={dropAnimation} modifiers={[restrictToVerticalAxis]} style={{ willChange: 'transform' }} zIndex={100}>
                {activeDragData ? <LayerDragOverlay {...activeDragData} /> : null}
              </DragOverlay>,
              document.body
            )}
        </DndContext>
      </div>
    </div>
  );
}
