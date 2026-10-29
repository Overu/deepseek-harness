import { useState, useEffect, useCallback } from 'react';
import { type IColor } from 'react-color-palette';
import { useEditorEngine } from '../../hooks/useEditorEngine';
import { ColorPickerButton } from '../shared/ColorPickerButton';
import type { WorkspacePlugin } from '../../core/plugins/WorkspacePlugin';

export function WorkspaceColorPicker() {
  const engine = useEditorEngine();
  const [currentHex, setCurrentHex] = useState('#ffffff');

  useEffect(() => {
    const workspacePlugin = engine.pluginManager.get('WorkspacePlugin') as WorkspacePlugin | undefined;

    // 初始化颜色
    if (workspacePlugin) {
      const initialColor = workspacePlugin.getBackgroundColor?.() || '#ffffff';
      setCurrentHex(initialColor);
    }

    // 监听外部颜色变化 (如 Undo/Redo)
    const onColorChange = (newColorHex: string) => {
      setCurrentHex(newColorHex);
    };

    engine.eventBus.on('workspace:color:change', onColorChange);
    return () => {
      engine.eventBus.off('workspace:color:change', onColorChange);
    };
  }, [engine]);

  const handleColorChange = useCallback(
    (newColor: IColor) => {
      setCurrentHex(newColor.hex);

      // 同步到工作区
      const workspacePlugin = engine.pluginManager.get('WorkspacePlugin') as WorkspacePlugin | undefined;
      if (workspacePlugin) {
        workspacePlugin.setBackgroundColor(newColor.hex);
      }
    },
    [engine]
  );

  return (
    <div className='flex items-center gap-2 px-1'>
      <span className='text-xs text-muted-foreground whitespace-nowrap'>画板颜色</span>
      <ColorPickerButton
        color={currentHex}
        onChange={handleColorChange}
        showAlpha={false}
        showEyeDropper={true}
        height={200}
        side='top'
        align='start'
        className='h-8 gap-0 w-auto p-0 rounded-sm border-border/40 overflow-hidden'
      />
    </div>
  );
}
