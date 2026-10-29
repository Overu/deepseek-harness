import { Undo, Redo, Minus, Plus, Fullscreen, MapMinus } from 'lucide-react';
import { MiniMap, Panel, useViewport, type Node } from '@xyflow/react';
import { useFlowStore } from '@/store/flowStore';
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip';
import { Slider } from '@/components/ui/slider';
import { useState } from 'react';

/** 与画布 ReactFlow minZoom / 默认 maxZoom 保持一致 */
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 2;
const ZOOM_STEP = 0.01;

const formatZoomPercent = (zoom: number) => `${Math.round(zoom * 100)}%`;

const getMinimapNodeColor = (node: Node) => (node.type === 'group' ? '#595959' : '#8c8c8c');

interface CanvasOperationProps {
  instance: any; // 画布实例
}

type ToolItem = {
  key: string;
  label: string;
  icon: typeof Undo;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  solidOnHover?: boolean;
};

type DividerItem = { type: 'divider' };

type ToolbarItem = ToolItem | DividerItem;

const CanvasOperation = ({ instance }: CanvasOperationProps) => {
  const [miniMapVisible, setMiniMapVisible] = useState(false);
  const { undoStack, redoStack } = useFlowStore(state => state);
  const { undo, redo, setZoom } = useFlowStore(state => state.actions);
  const { zoom: viewportZoom } = useViewport();

  const clampedZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, viewportZoom));

  const handleZoomIn = () => {
    instance.current.zoomIn({ duration: 300 });
  };

  const handleZoomOut = () => {
    instance.current.zoomOut({ duration: 300 });
  };

  const handleZoomSliderChange = (values: number[]) => {
    const nextZoom = values[0];
    setZoom(nextZoom);
    instance.current?.zoomTo(nextZoom);
  };

  const handleFitView = () => {
    instance.current.fitView({ duration: 300, padding: 0.2 });
  };

  const historyTools: ToolbarItem[] = [
    {
      key: 'undo',
      label: '撤回',
      icon: Undo,
      onClick: undo,
      disabled: undoStack.length < 2,
    },
    {
      key: 'redo',
      label: '重做',
      icon: Redo,
      onClick: redo,
      disabled: redoStack.length === 0,
    },
    { type: 'divider' },
  ];

  const viewTools: ToolItem[] = [
    {
      key: 'reset',
      label: '重置视图',
      icon: Fullscreen,
      onClick: handleFitView,
    },
  ];

  const baseBtnClass = 'group p-1 text-white rounded-lg hover:bg-white/10 transition-colors duration-200';

  const renderToolButton = (item: ToolItem) => {
    const IconComponent = item.icon;
    const stateClass = item.disabled ? 'cursor-not-allowed text-white/25' : 'cursor-pointer';
    const activeClass = item.active ? 'bg-white/10' : '';
    const iconClass = item.active ? 'fill-current' : item.solidOnHover ? 'group-hover:fill-current' : '';

    return (
      <Tooltip key={item.key}>
        <TooltipTrigger asChild>
          <div className={`${baseBtnClass} ${stateClass} ${activeClass}`} onClick={item.disabled ? undefined : item.onClick}>
            <IconComponent size={20} className={iconClass} />
          </div>
        </TooltipTrigger>
        <TooltipContent>
          <p>{item.label}</p>
        </TooltipContent>
      </Tooltip>
    );
  };

  const renderDivider = (index: number) => (
    <div key={`divider-${index}`} className='text-[#d9d9d9] mx-1'>
      |
    </div>
  );

  return (
    <>
      {miniMapVisible && (
        <MiniMap
          position='bottom-left'
          className='!left-4 !bottom-[4.5rem] !m-0 rounded-lg border border-white/10 overflow-hidden pointer-events-auto'
          style={{ width: 148, height: 96 }}
          bgColor='#262626'
          nodeColor={getMinimapNodeColor}
          nodeStrokeColor='#404040'
          maskColor='rgba(0, 0, 0, 0.55)'
          maskStrokeColor='rgba(255, 255, 255, 0.35)'
          maskStrokeWidth={1}
          pannable
          zoomable
          ariaLabel='画布小地图'
        />
      )}
      <Panel position='bottom-left' className='!bottom-4 !left-4 mobile:!left-[2px] !m-0 pointer-events-auto'>
        <div className='bg-[#262626] flex gap-1 p-1 items-center rounded-lg h-10 border-white/10 border'>
          <TooltipProvider delayDuration={0}>
            <div className='flex items-center gap-1'>
              {renderToolButton({
                key: 'miniMap',
                label: miniMapVisible ? '关闭小地图' : '开启小地图',
                icon: MapMinus,
                onClick: () => setMiniMapVisible(visible => !visible),
                active: miniMapVisible,
                solidOnHover: true,
              })}
              {historyTools.map((item, index) => {
                if ('type' in item && item.type === 'divider') {
                  return renderDivider(index);
                }
                return renderToolButton(item as ToolItem);
              })}
              {renderToolButton({ key: 'zoomOut', label: '缩小', icon: Minus, onClick: handleZoomOut })}
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className='w-24 mx-1 flex items-center nodrag nopan nowheel' onPointerDown={e => e.stopPropagation()} onClick={e => e.stopPropagation()}>
                    <Slider value={[clampedZoom]} min={MIN_ZOOM} max={MAX_ZOOM} step={ZOOM_STEP} className='cursor-pointer' onValueChange={handleZoomSliderChange} />
                  </div>
                </TooltipTrigger>
                <TooltipContent side='top'>
                  <p>{formatZoomPercent(clampedZoom)}</p>
                </TooltipContent>
              </Tooltip>
              {renderToolButton({ key: 'zoomIn', label: '放大', icon: Plus, onClick: handleZoomIn })}
              {viewTools.map(renderToolButton)}
            </div>
          </TooltipProvider>
        </div>
      </Panel>
    </>
  );
};

export default CanvasOperation;
