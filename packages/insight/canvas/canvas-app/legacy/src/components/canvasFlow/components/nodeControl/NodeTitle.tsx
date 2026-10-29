import { useState, useEffect, useCallback, memo, useRef, useMemo, cloneElement, isValidElement } from 'react';
import { toast } from 'sonner';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Italic, Underline } from 'lucide-react';
import { useFlowStore } from '@/store/flowStore';
import { NodeToolbar, Position } from '@xyflow/react';
import { getToolIconByType } from '../../settings/toolListConfig';

export interface titleStyleData {
  fontSize?: string;
  fontWeight?: string;
  fontStyle?: string;
  textDecoration?: string;
}

interface NodeTitleProps {
  name: string;
  nodeType: string;
  selected?: boolean;
  onEdit: (name: string) => boolean | void;
  onFocus?: () => void;
  onBlur?: () => void;
  // 新增样式对象和更新函数
  titleStyle?: titleStyleData;
  setTitleStyle?: (titleStyle: titleStyleData) => void;
}

const NodeTitle = memo(({ name, nodeType, selected, onEdit, onFocus = () => {}, onBlur = () => {}, titleStyle = {}, setTitleStyle = () => {} }: NodeTitleProps) => {
  const [editName, setEditName] = useState(name);
  // 新增样式状态
  const [localTextStyle, setLocalTextStyle] = useState({
    fontSize: titleStyle.fontSize || '16px',
    fontWeight: titleStyle.fontWeight || 'normal',
    fontStyle: titleStyle.fontStyle || 'normal',
    textDecoration: titleStyle.textDecoration || 'none',
  });
  // 使用一个状态来跟踪样式控制栏是否被激活
  const [isStyleControlsActive, setIsStyleControlsActive] = useState(false);
  const zoom = useFlowStore(state => state.zoom);
  // 标题在节点盒外，只读遮罩盖不住，需单独禁止改名/样式
  const readOnly = useFlowStore(state => state.readOnly);

  // 创建 refs 来引用组件的各个部分
  const operationRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setEditName(name);
  }, [name]);

  // 更新样式状态
  useEffect(() => {
    setLocalTextStyle({
      fontSize: titleStyle.fontSize || '16px',
      fontWeight: titleStyle.fontWeight || 'normal',
      fontStyle: titleStyle.fontStyle || 'normal',
      textDecoration: titleStyle.textDecoration || 'none',
    });
  }, []);

  const handleEdit = useCallback(() => {
    if (readOnly) return;
    onBlur();
    if (editName === name) return;
    if (!editName) {
      toast.error('命名不能为空');
      setEditName(name);
      return;
    }
    const result = onEdit(editName);
    if (result === false) {
      setEditName(name);
    }
  }, [editName, name, onBlur, onEdit, readOnly]);

  const prevSelectedRef = useRef(selected);
  useEffect(() => {
    if (readOnly) {
      prevSelectedRef.current = selected;
      return;
    }
    if (prevSelectedRef.current && !selected) {
      handleEdit();
    }
    prevSelectedRef.current = selected;
  }, [selected, handleEdit, readOnly]);

  // 处理全局点击事件，统一管理操作栏显隐
  useEffect(() => {
    if (readOnly) return;

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;

      // 检查点击是否在当前组件的任何部分内
      const isInsideComponent =
        operationRef.current?.contains(target) ||
        inputRef.current?.contains(target) ||
        // 检查是否点击在下拉框的各个部分中
        (target instanceof HTMLElement && target.closest('.node_title'));

      if (!isInsideComponent) {
        // 点击在组件外部，隐藏样式控制栏
        setIsStyleControlsActive(false);
        handleEdit();
      } else {
        setIsStyleControlsActive(true);
        onFocus();
      }
    };

    document.addEventListener('mousedown', handleClickOutside, true);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside, true);
    };
  }, [handleEdit, onFocus, readOnly]);

  const fontSize = useMemo(() => {
    const fontSizeNumber = parseFloat(localTextStyle.fontSize);
    const transformSize = fontSizeNumber / zoom;
    const maxSize = fontSizeNumber + 48;
    const minSize = fontSizeNumber;
    if (transformSize > maxSize) {
      return maxSize;
    } else if (transformSize < minSize) {
      return minSize;
    } else {
      return transformSize;
    }
  }, [localTextStyle.fontSize, zoom]);

  const offset = useMemo(() => {
    const fontSizeNumber = parseFloat(localTextStyle.fontSize);
    const transformSize = fontSizeNumber / zoom;
    const maxSize = fontSizeNumber + 48;
    const minSize = fontSizeNumber;
    if (transformSize > maxSize) {
      return maxSize * zoom * 1.4 + 20 * zoom;
    } else if (transformSize < minSize) {
      return minSize * zoom * 1.4 + 20 * zoom;
    } else {
      return transformSize * zoom * 1.4 + 20 * zoom;
    }
  }, [localTextStyle.fontSize, zoom]);

  const toolIcon = useMemo(() => {
    if (!nodeType?.includes('Tool')) return null;
    return getToolIconByType(nodeType);
  }, [nodeType]);

  const titleContentStyle = {
    fontSize,
    fontWeight: localTextStyle.fontWeight,
    fontStyle: localTextStyle.fontStyle,
    textDecoration: localTextStyle.textDecoration,
  };

  const renderTitleContent = (content: React.ReactNode) => (
    <div className='flex items-center gap-1.5 min-w-0'>
      {toolIcon && isValidElement(toolIcon) ? (
        <span className='inline-flex shrink-0 items-center justify-center' style={{ width: fontSize, height: fontSize }}>
          {cloneElement(toolIcon, { size: fontSize, style: { width: fontSize, height: fontSize } } as any)}
        </span>
      ) : null}
      <span className='min-w-0 truncate'>{content}</span>
    </div>
  );

  // 新增样式处理函数
  const handleTextStyleChange = (property: string, value: string) => {
    const newTextStyle = { ...localTextStyle, [property]: value };
    setLocalTextStyle(newTextStyle);
    setTitleStyle(newTextStyle);
  };

  // 字体大小选项数组
  const fontSizeOptions = [
    { value: '12px', label: '12' },
    { value: '14px', label: '14' },
    { value: '16px', label: '16' },
    { value: '18px', label: '18' },
    { value: '20px', label: '20' },
    { value: '24px', label: '24' },
    { value: '28px', label: '28' },
    { value: '32px', label: '32' },
  ];

  // 只读：始终纯文本展示，不渲染 input / 样式条
  // cursor-default：覆盖 .react-flow__node.draggable 的 grab（nodrag 只禁拖拽，不改光标）
  if (readOnly) {
    return (
      <div className='absolute -translate-y-full left-0 -top-0 pb-2 w-full rounded-lg text-sm whitespace-nowrap nodrag cursor-default pointer-events-none'>
        <div style={titleContentStyle} className='w-full truncate text-white text-opacity-70 leading-none pb-1 text-left'>
          {renderTitleContent(editName)}
        </div>
      </div>
    );
  }

  return (
    <div className='absolute -translate-y-full left-0 -top-0 pb-2 w-full rounded-lg text-sm whitespace-nowrap nodrag cursor-default'>
      {/* 顶部样式控制条 - 仅在样式控制栏激活时显示 */}
      <NodeToolbar isVisible={selected && isStyleControlsActive} position={Position.Top} align='start' offset={offset}>
        <div ref={operationRef} className='flex items-center gap-1 bg-[#262626] p-1 rounded-[10px]'>
          {/* 字体大小选择 */}
          <Select value={localTextStyle.fontSize} onValueChange={value => handleTextStyleChange('fontSize', value)}>
            <SelectTrigger className='w-[84px] h-8 text-xs' style={{ boxShadow: 'none' }}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {fontSizeOptions.map(option => (
                <SelectItem key={option.value} value={option.value} className='node_title'>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* 粗体按钮 */}
          <button
            onClick={() => handleTextStyleChange('fontWeight', localTextStyle.fontWeight === 'bold' ? 'normal' : 'bold')}
            className={`h-8 w-8 flex items-center justify-center rounded-lg ${localTextStyle.fontWeight === 'bold' ? 'bg-white/10' : 'bg-transparent'}`}
          >
            <span className='text-white text-base'>B</span>
          </button>

          {/* 斜体按钮 */}
          <button
            onClick={() => handleTextStyleChange('fontStyle', localTextStyle.fontStyle === 'italic' ? 'normal' : 'italic')}
            className={`h-8 w-8 flex items-center justify-center rounded-lg ${localTextStyle.fontStyle === 'italic' ? 'bg-white/10' : 'bg-transparent'}`}
          >
            <Italic color='white' size={16} />
          </button>

          {/* 下划线按钮 */}
          <button
            onClick={() => handleTextStyleChange('textDecoration', localTextStyle.textDecoration === 'underline' ? 'none' : 'underline')}
            className={`h-8 w-8 flex items-center justify-center rounded-lg ${localTextStyle.textDecoration === 'underline' ? 'bg-white/10' : 'bg-transparent'}`}
          >
            <Underline color='white' size={16} />
          </button>
        </div>
      </NodeToolbar>
      {selected ? (
        <div className='flex items-center gap-1.5 min-w-0'>
          {toolIcon && isValidElement(toolIcon) ? (
            <span className='inline-flex shrink-0 items-center justify-center' style={{ width: fontSize, height: fontSize }}>
              {cloneElement(toolIcon, { size: fontSize, style: { width: fontSize, height: fontSize } } as any)}
            </span>
          ) : null}
          <input
            ref={inputRef}
            type='text'
            value={editName}
            onChange={e => setEditName(e.target.value)}
            // onBlur={handleEdit}
            onKeyDown={e => {
              e.stopPropagation();
              if (e.key === 'Enter') {
                handleEdit();
              }
            }}
            style={titleContentStyle}
            className='flex-1 min-w-0 border-none outline-none truncate text-white bg-transparent leading-none cursor-text'
          />
        </div>
      ) : (
        <div style={titleContentStyle} className='w-full truncate text-white/70 leading-none pb-1 text-left'>
          {renderTitleContent(editName)}
        </div>
      )}
    </div>
  );
});

export default NodeTitle;
