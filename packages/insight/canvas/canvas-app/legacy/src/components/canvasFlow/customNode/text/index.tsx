import { Handle, NodeToolbar, Position, NodeResizer, useUpdateNodeInternals } from '@xyflow/react';
import type { Editor } from '@tiptap/react';
import PromptModel from './TextPromptModel';
import TextNodeToolbar from './TextNodeToolbar';
import RichTextEditor from '../../components/richText/RichTextEditor';
import RichTextViewer from '../../components/richText/RichTextViewer';
import { openTextEditModal } from './openTextEditModal';
import NodeOperation from '../../components/nodeControl/NodeOperation';
import StatusOverlay from '../../components/nodeControl/StatusOverlay';
import NodeTitle from '../../components/nodeControl/NodeTitle';
import UploadContent from '../../components/nodeControl/UploadContent';
import { useEffect, useState, useMemo, useRef, memo, useCallback } from 'react';
import setting from '../../settings/setting';
import { useFlowStore } from '@/store/flowStore';
import util from '../../utils/util';
import hooks from '../../hooks';
import toolUtil from '../../utils/toolUtil';
import type { Handler } from '../../utils/type';
import styles from './index.module.less';
import { createAgentEditorDebounce } from '../../../../../../src/agent-editor-debounce';
import ReadOnlyPromptGuard from '../../components/promptControl/ReadOnlyPromptGuard';

const nodeType = 'text';
const { createDefaultParams } = util;
const { useNodeResizeObserver, useNodeOperations, useHandleSend, useTopNodeToolbarVisible } = hooks;
const { handlersMap } = setting;
const { defaultWidth, defaultHeight } = toolUtil;
const handlers = handlersMap[nodeType];

const TextNode = (props: any) => {
  const updateNodeInternals = useUpdateNodeInternals();
  const { data, id, selected, width, height, positionAbsoluteX, positionAbsoluteY } = props;
  const position = {
    x: positionAbsoluteX,
    y: positionAbsoluteY,
  };
  const { value, taskInfo, title, titleStyle } = data;
  const { status, errorMsg } = taskInfo;
  const [editor, setEditor] = useState<Editor | null>(null);
  const [inputContent, setInputContent] = useState(value || '');
  const [isEditing, setIsEditing] = useState(false);
  const [focus, setFocus] = useState(false);
  const nodeRef = useRef<any>(null);
  const isSelection = useFlowStore(state => state.isSelection);
  const modelsMap = useFlowStore(state => state.modelsMap);
  const { updateNodeData } = useFlowStore(state => state.actions);

  useNodeResizeObserver(nodeRef, id, updateNodeInternals);
  const { handleCopy, handleDelete, handleEdit, handleChangePrompt, handleChangeTitleStyle, handleCascadeChange, handleAddNextNode } = useNodeOperations(id, data);
  const { isExcute, handleSend } = useHandleSend(id);

  const promptModalVisible = useMemo(() => {
    return !isSelection && selected;
  }, [isSelection, selected]);

  // NodeResizer / TextNodeToolbar 共用显隐：单选且未在编辑标题时显示；只读预览不展示操作栏与缩放
  const nodeControlVisible = useTopNodeToolbarVisible(!focus && !isSelection && selected);
  const debouncedUpdateValue = useMemo(() => {
    return createAgentEditorDebounce(`${id}:text`, (content: string) => {
      const current = useFlowStore.getState().nodes.find(node => node.id === id);
      if (!current || content === current.data.value) return;
      updateNodeData(
        id,
        {
          ...current.data,
          value: content,
        },
        false
      );
    }, 500);
  }, [value, updateNodeData, id, data]);

  useEffect(() => {
    // 非编辑中时响应外部数据更新
    if (!isEditing) {
      setInputContent(value || '');
    }
  }, [value, isEditing]);

  const handleSelectChange = (key: string, paramValue: string | number | boolean) => {
    let params = { ...data.params };
    if (key === 'model') {
      params = createDefaultParams(modelsMap, nodeType, String(paramValue));
      params.prompt = data.params.prompt;
    } else {
      params[key] = paramValue;
    }
    updateNodeData(id, {
      ...data,
      params,
    });
  };

  const handleContentChange = useCallback(
    (content: string) => {
      setInputContent(content);
      debouncedUpdateValue(content);
    },
    [debouncedUpdateValue]
  );

  const enterEditing = useCallback(() => {
    setIsEditing(true);
  }, []);

  const handleBlur = useCallback(() => {
    setIsEditing(false);
  }, []);

  const handleOpenModal = useCallback(async () => {
    const finalValue = await openTextEditModal({
      title: title || '文本',
      initialValue: inputContent,
      onUpdateValue: (newVal: string) => {
        setInputContent(newVal);
        debouncedUpdateValue(newVal);
      },
    });
    if (finalValue !== inputContent) {
      setInputContent(finalValue);
      debouncedUpdateValue(finalValue);
    }
  }, [title, inputContent, value, debouncedUpdateValue]);

  return (
    <div
      ref={nodeRef}
      className={`rounded-2xl relative hover:ring-2 ring-white/65 transition-all ${selected && 'ring-2'}`}
      style={{
        width: width ? width : defaultWidth,
        height: height ? height : defaultHeight,
      }}
    >
      <NodeResizer minWidth={defaultWidth} minHeight={defaultHeight} isVisible={nodeControlVisible} />
      {handlers.map((item: Handler) => {
        return <Handle type={item.type} position={item.position} id={item.id} style={item.style} key={item.id} />;
      })}

      {/* 主体富文本区域 */}
      <div className='relative w-full h-full border border-white/25 rounded-2xl overflow-hidden bg-[#1f1f1f]'>
        {isEditing ? (
          <RichTextEditor
            value={inputContent}
            onChange={handleContentChange}
            onBlur={handleBlur}
            onEditorReady={setEditor}
            autoFocus
            className='bg-[#121212]'
            placeholder='请输入内容...'
          />
        ) : inputContent ? (
          <RichTextViewer value={inputContent} onDoubleClick={enterEditing} className='cursor-pointer select-none no-scrollbar' />
        ) : (
          <div className={styles.bgImage}>
            <UploadContent type={nodeType} selected={selected} onClick={enterEditing} />
          </div>
        )}
      </div>

      <NodeTitle
        name={title}
        nodeType={nodeType}
        selected={selected}
        titleStyle={titleStyle}
        setTitleStyle={handleChangeTitleStyle}
        onEdit={handleEdit}
        onFocus={() => setFocus(true)}
        onBlur={() => setFocus(false)}
      />
      <StatusOverlay status={status} errorMsg={errorMsg} type={nodeType} id={id} />

      {/* 顶部工具栏 */}
      <NodeToolbar isVisible={nodeControlVisible} position={Position.Top} align='center' offset={36}>
        <div className='flex items-center gap-1'>
          <TextNodeToolbar editor={editor} mode='node' onOpenModal={handleOpenModal} />
          <NodeOperation
            type={nodeType}
            url={value}
            status={status}
            onAddNextTool={toolType => handleAddNextNode(nodeType, toolType, position)}
            onCopy={handleCopy}
            onDelete={handleDelete}
          />
        </div>
      </NodeToolbar>

      {/* 底部 Prompt 模型面板 */}
      {promptModalVisible && (
        <NodeToolbar isVisible={promptModalVisible} position={Position.Bottom} align='center'>
          <ReadOnlyPromptGuard>
            <PromptModel
              isExcute={isExcute}
              props={props}
              status={status}
              onChangePrompt={handleChangePrompt}
              onSelectChange={handleSelectChange}
              onCascadeChange={handleCascadeChange}
              onSend={handleSend}
            />
          </ReadOnlyPromptGuard>
        </NodeToolbar>
      )}
    </div>
  );
};

export default memo(TextNode);
