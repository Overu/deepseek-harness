import React, { useState, useEffect, useCallback } from 'react';
import { useEditorEngine } from '../../hooks/useEditorEngine';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Separator } from '@/components/ui/separator';
import { MousePointer2, Hand, Type, Maximize, Palette, Link, Unlink } from 'lucide-react';
import { motion } from 'framer-motion';
import { toast } from 'sonner';

import { useWorkspaceSize } from '../../hooks/useWorkspaceSize';
import { HistoryButtons } from '../History/HistoryButtons';
import { WorkspaceColorPicker } from './WorkspaceColorPicker';
import { ShapePicker } from './ShapePicker';
import { useEditorStore } from '../../store/editorStore';

// 预设比例常量
const ASPECT_RATIOS = [
  { value: 'custom', label: '自定义尺寸', ratio: null },
  { value: '1:1', label: '1:1 正方形', ratio: 1 },
  { value: '2:3', label: '2:3 竖版', ratio: 2 / 3 },
  { value: '3:4', label: '3:4 竖版', ratio: 3 / 4 },
  { value: '9:16', label: '9:16 竖版', ratio: 9 / 16 },
  { value: '3:2', label: '3:2 横版', ratio: 3 / 2 },
  { value: '4:3', label: '4:3 横版', ratio: 4 / 3 },
  { value: '16:9', label: '16:9 横版', ratio: 16 / 9 },
] as const;

// 根据目标比例计算新尺寸（保持最大边不变）
const calculateSizeByRatio = (currentW: number, currentH: number, targetRatio: number): { width: number; height: number } => {
  // 1:1 取最大边
  if (targetRatio === 1) {
    const max = Math.max(currentW, currentH);
    return { width: max, height: max };
  }

  // 横版 (ratio > 1): 保持宽度，计算高度
  // 竖版 (ratio < 1): 保持高度，计算宽度
  if (targetRatio > 1) {
    const newHeight = Math.floor(currentW / targetRatio);
    return { width: currentW, height: newHeight };
  } else {
    const newWidth = Math.floor(currentH * targetRatio);
    return { width: newWidth, height: currentH };
  }
};

export function CanvasToolbar() {
  const engine = useEditorEngine();
  const { width, height, setSize } = useWorkspaceSize();
  const { activeTool, setActiveTool } = useEditorStore();

  const [sizeMode, setSizeMode] = useState<string>('custom');
  // 宽高是否联动（非custom始终联动，custom模式下可手动切换）
  const [isLinked, setIsLinked] = useState(false);

  // Local state for input values
  const [localSize, setLocalSize] = useState({ width: 0, height: 0 });

  // Sync local state when hook state changes (external updates)
  useEffect(() => {
    setLocalSize({ width, height });
  }, [width, height]);

  // Sync engine tool mode with activeTool store state on mount/change
  useEffect(() => {
    if (activeTool === 'hand') {
      engine.setToolMode('hand');
    } else if (activeTool === 'draw') {
      engine.setToolMode('draw');
    } else {
      engine.setToolMode('select');
    }
  }, [activeTool, engine]);

  // 处理工具切换
  const handleToolChange = (tool: 'select' | 'hand' | 'text' | 'draw') => {
    if (tool === 'text') {
      engine.addText();
      setActiveTool('select');
      engine.setToolMode('select');
      return;
    }

    setActiveTool(tool);

    if (tool === 'hand') {
      engine.setToolMode('hand');
    } else if (tool === 'draw') {
      engine.setToolMode('draw');
    } else {
      engine.setToolMode('select');
    }
  };

  // 处理尺寸模式切换
  const handleSizeModeChange = useCallback(
    (newMode: string) => {
      const prevMode = sizeMode;
      setSizeMode(newMode);

      if (newMode === 'custom') {
        // 从预设切换到自定义：保持当前联动状态不变，仅提示
        if (prevMode !== 'custom') {
          setIsLinked(false);
          toast.success('已填充当前比例对应尺寸', { duration: 2000 });
        }
        return;
      }

      // 切换到预设比例 → 自动关联
      setIsLinked(true);

      const targetRatioConfig = ASPECT_RATIOS.find(r => r.value === newMode);
      if (!targetRatioConfig?.ratio) return;

      const { width: newW, height: newH } = calculateSizeByRatio(width, height, targetRatioConfig.ratio);

      setSize(newW, newH);
      toast.success(`已按${newMode}适配原尺寸，当前尺寸：${newW}px×${newH}px`, {
        duration: 2000,
      });
    },
    [sizeMode, width, height, setSize]
  );

  // 宽高联动切换（仅在非custom模式下可用）
  const handleToggleLink = useCallback(() => {
    if (sizeMode === 'custom') return;

    if (isLinked) {
      // 解绑 → 切换为 custom
      setSizeMode('custom');
      setIsLinked(false);
      toast.success('已解除宽高关联，切换为自定义尺寸', { duration: 2000 });
    }
  }, [sizeMode, isLinked]);

  // 自定义尺寸输入（支持联动）
  const onCustomSizeChange = (key: 'width' | 'height', value: string) => {
    const val = parseInt(value, 10);
    if (isNaN(val) || val <= 0) return;

    if (isLinked && sizeMode !== 'custom') {
      // 有预设比例 → 按比例联动计算另一维度
      const ratioConfig = ASPECT_RATIOS.find(r => r.value === sizeMode);
      if (ratioConfig?.ratio) {
        if (key === 'width') {
          const newH = Math.floor(val / ratioConfig.ratio);
          setLocalSize({ width: val, height: newH });
        } else {
          const newW = Math.floor(val * ratioConfig.ratio);
          setLocalSize({ width: newW, height: val });
        }
        return;
      }
    }

    // 非关联或 custom → 仅修改单个维度
    setLocalSize(prev => ({ ...prev, [key]: val }));
    if (sizeMode !== 'custom') {
      setSizeMode('custom');
      setIsLinked(false);
    }
  };

  // 失去焦点时提交
  const onCustomSizeBlur = () => {
    let w = localSize.width;
    let h = localSize.height;
    if (w < 100) w = 100;
    if (h < 100) h = 100;

    setSize(w, h);
  };

  return (
    <motion.div
      initial={{ y: 100, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
      className='fixed bottom-8 left-1/2 !-translate-x-1/2 z-999'
    >
      <div className='flex items-center gap-2 px-3 py-2 bg-background/95 backdrop-blur-lg border border-border/60 rounded-2xl shadow-2xl shadow-black/20'>
        <TooltipProvider delayDuration={300}>
          {/* 工具组 */}
          <div className='flex items-center gap-1'>
            {/* 颜色选择器 */}
            <WorkspaceColorPicker />
            {/* 尺寸组 - 保留下拉框 */}
            <div className='flex items-center gap-2 px-1'>
              <Select value={sizeMode} onValueChange={handleSizeModeChange}>
                <SelectTrigger className='h-8 w-[110px] text-xs border-none bg-background/50'>
                  <SelectValue placeholder='尺寸' />
                </SelectTrigger>
                <SelectContent className='bg-background/95 backdrop-blur-lg'>
                  {ASPECT_RATIOS.map(item => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {/* 宽高输入框 - 始终显示 */}
              <div className='flex items-center gap-1.5 bg-muted/60 rounded-lg px-2.5 py-1.5 border border-border/40'>
                <span className='text-[10px] text-muted-foreground font-medium'>W</span>
                <input
                  type='number'
                  min='100'
                  className='w-12 bg-transparent text-xs text-center border-none outline-none p-0 h-auto text-foreground font-mono'
                  value={localSize.width}
                  onChange={e => onCustomSizeChange('width', e.target.value)}
                  onBlur={onCustomSizeBlur}
                />
              </div>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type='button'
                    disabled={sizeMode === 'custom'}
                    onClick={handleToggleLink}
                    className={`flex items-center justify-center w-7 h-7 rounded-md transition-all ${sizeMode === 'custom' ? 'opacity-40 cursor-not-allowed' : 'hover:bg-muted/80 active:scale-95'}`}
                  >
                    {isLinked ? <Link className='h-3.5 w-3.5 text-primary' /> : <Unlink className='h-3.5 w-3.5 text-muted-foreground' />}
                  </button>
                </TooltipTrigger>
                <TooltipContent side='top'>{isLinked ? '取消关联' : '点击关联'}</TooltipContent>
              </Tooltip>
              <div className='flex items-center gap-1.5 bg-muted/60 rounded-lg px-2.5 py-1.5 border border-border/40'>
                <span className='text-[10px] text-muted-foreground font-medium'>H</span>
                <input
                  type='number'
                  min='100'
                  className='w-12 bg-transparent text-xs text-center border-none outline-none p-0 h-auto text-foreground font-mono'
                  value={localSize.height}
                  onChange={e => onCustomSizeChange('height', e.target.value)}
                  onBlur={onCustomSizeBlur}
                />
              </div>
            </div>

            <Separator orientation='vertical' className='h-6 mx-1 bg-border/50' />

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant={activeTool === 'select' ? 'secondary' : 'ghost'}
                  size='icon'
                  className='h-9 w-9 transition-all hover:scale-105'
                  onClick={() => handleToolChange('select')}
                >
                  <MousePointer2 className='h-4 w-4' />
                </Button>
              </TooltipTrigger>
              <TooltipContent side='top'>选择</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant={activeTool === 'hand' ? 'secondary' : 'ghost'}
                  size='icon'
                  className='h-9 w-9 transition-all hover:scale-105'
                  onClick={() => handleToolChange('hand')}
                >
                  <Hand className='h-4 w-4' />
                </Button>
              </TooltipTrigger>
              <TooltipContent side='top'>抓手 - 操作画布</TooltipContent>
            </Tooltip>
          </div>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={activeTool === 'draw' ? 'secondary' : 'ghost'}
                size='icon'
                className='h-9 w-9 transition-all hover:scale-105'
                onClick={() => handleToolChange('draw')}
              >
                <Palette className='h-4 w-4' />
              </Button>
            </TooltipTrigger>
            <TooltipContent side='top'>绘画</TooltipContent>
          </Tooltip>

          <ShapePicker />

          {/* 创建组 */}
          <div className='flex items-center gap-1'>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant={activeTool === 'text' ? 'secondary' : 'ghost'}
                  size='icon'
                  className='h-9 w-9 transition-all hover:scale-105'
                  onClick={() => handleToolChange('text')}
                >
                  <Type className='h-4 w-4' />
                </Button>
              </TooltipTrigger>
              <TooltipContent side='top'>添加文本</TooltipContent>
            </Tooltip>
          </div>

          <Separator orientation='vertical' className='h-6 mx-1 bg-border/50' />

          {/* 历史记录组 - 使用新的 HistoryButtons 组件 */}
          <HistoryButtons />

          {/* 视图组 */}
          <div className='flex items-center gap-1'>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant='ghost' size='icon' className='h-9 w-9 transition-all hover:scale-105' onClick={() => engine.zoomToFit()}>
                  <Maximize className='h-4 w-4' />
                </Button>
              </TooltipTrigger>
              <TooltipContent side='top'>重置画布</TooltipContent>
            </Tooltip>
          </div>
        </TooltipProvider>
      </div>
    </motion.div>
  );
}
