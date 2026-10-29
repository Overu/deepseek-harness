import { Handle, NodeToolbar, Position } from '@xyflow/react';
import AudioPromptModel from './AudioPromptModel';
import NodeOperation from '../../components/nodeControl/NodeOperation';
import UploadModal from '../../components/uploadControl/UploadModal';
import UploadContent from '../../components/nodeControl/UploadContent';
import StatusOverlay from '../../components/nodeControl/StatusOverlay';
import NodeTitle from '../../components/nodeControl/NodeTitle';
import AudioPlayer from '@/components/common/fileControl/AudioPlayer';
import { useState, useMemo, memo } from 'react';
import setting from '../../settings/setting';
import { useFlowStore } from '@/store/flowStore';
import util from '../../utils/util';
import hooks from '../../hooks';
import type { Handler } from '../../utils/type';
import { isNonGenerativeMedia } from '../../utils/type';
import { createPortal } from 'react-dom';
import styles from './index.module.less';
import CanvasAssetPreview from '../../components/CanvasAssetPreview';
import ReadOnlyPromptGuard from '../../components/promptControl/ReadOnlyPromptGuard';

const nodeType = 'audio';
const { creareDefaultParamsV2, buildMediaUploadNodeData } = util;
const { useNodeOperations, useHandleSend, useTopNodeToolbarVisible } = hooks;
const { handlersMap } = setting;
const handlers = handlersMap[nodeType];

const AudioNode = (props: any) => {
  const { data, id, selected, positionAbsoluteX, positionAbsoluteY } = props;
  const position = {
    x: positionAbsoluteX,
    y: positionAbsoluteY,
  };
  const { value, taskInfo, title, titleStyle, tempFile, type: contentType } = data;
  const { status, errorMsg } = taskInfo;
  const [modalVisible, setModalVisible] = useState(false);
  const [previewVisible, setPreviewVisible] = useState(false);
  const [focus, setFocus] = useState(false);
  const [allowLocal, setAllowLocal] = useState(true);
  const isSelection = useFlowStore(state => state.isSelection);
  const modelsMap = useFlowStore(state => state.modelsMap);
  const modelNodePermission = useFlowStore(state => state.modelNodePermission);
  const { updateNodeData } = useFlowStore(state => state.actions);

  const { handleCopy, handleDelete, handleEdit, handleChangePrompt, handleChangeTitleStyle, handleAddNextNode } = useNodeOperations(id, data);
  const topToolbarVisible = useTopNodeToolbarVisible(!focus && !isSelection && selected);
  const { isExcute, handleSend } = useHandleSend(id);

  const promptModalVisible = useMemo(() => {
    return !isSelection && selected && !isNonGenerativeMedia(contentType);
  }, [isSelection, selected, contentType]);

  const previewUrls = useMemo(() => (value ? [value] : []), [value]);

  const handleSelectChange = (key: string, value: string | number | boolean | object) => {
    const currentData = useFlowStore.getState().nodes.find(node => node.id === id)?.data;
    if (!currentData) return;
    let params: Record<string, any> = { ...(currentData.params as object) };
    if (key === 'modelType') {
      params = creareDefaultParamsV2(modelsMap, nodeType, String(value), undefined, modelNodePermission);
      params.prompt = data.params.prompt;
    } else if (key === 'model') {
      params = creareDefaultParamsV2(modelsMap, nodeType, params.modelType, String(value), modelNodePermission);
      params.prompt = data.params.prompt;
    } else if (value != null && typeof value == 'object') {
      params[key] = {
        ...params[key],
        ...value,
      };
    } else {
      params[key] = value;
    }
    updateNodeData(id, {
      ...currentData,
      params,
    });
  };

  const handleUploadSuccess = (url: string) => {
    updateNodeData(id, buildMediaUploadNodeData(data, url), tempFile ? false : true);
    setModalVisible(false);
  };

  const handleOpenModal = (type?: string) => {
    if (type === 'all') {
      setAllowLocal(true);
    } else {
      setAllowLocal(false);
    }
    setModalVisible(true);
  };

  return (
    <div className={`rounded-2xl w-[400px] relative hover:ring-2 ring-white/65 transition-all ${selected && 'ring-2'}`} style={{ height: value && !tempFile ? 250 : 400 }}>
      {handlers.map((item: Handler) => {
        return <Handle type={item.type} position={item.position} id={item.id} style={item.style} key={item.id} />;
      })}
      {value && !tempFile ? (
        <div className='relative bg-[#1f1f1f] border border-white/25 rounded-2xl h-full px-3'>
          <AudioPlayer url={value} height={250} onPreview={() => setPreviewVisible(true)}></AudioPlayer>
        </div>
      ) : (
        <div className={styles.audio}>
          <UploadContent type={nodeType} nodeId={id} selected={selected} tempFile={tempFile} onClick={() => handleOpenModal()} onOk={handleUploadSuccess}></UploadContent>
        </div>
      )}
      <NodeTitle
        name={title}
        nodeType={nodeType}
        selected={selected}
        titleStyle={titleStyle}
        setTitleStyle={handleChangeTitleStyle}
        onEdit={handleEdit}
        onFocus={() => setFocus(true)}
        onBlur={() => setFocus(false)}
      ></NodeTitle>
      <StatusOverlay status={status} errorMsg={errorMsg} type={nodeType} id={id} />
      <NodeToolbar isVisible={topToolbarVisible} position={Position.Top} align='center' offset={36}>
        <NodeOperation
          type={nodeType}
          nodeId={id}
          url={value}
          status={status}
          previewUrls={previewUrls}
          contentType={contentType}
          onAddNextTool={toolType => handleAddNextNode(nodeType, toolType, position)}
          onUpload={() => handleOpenModal('all')}
          onCopy={handleCopy}
          onDelete={handleDelete}
        ></NodeOperation>
      </NodeToolbar>
      {promptModalVisible && (
        <NodeToolbar isVisible={promptModalVisible} position={Position.Bottom} align='center'>
          <ReadOnlyPromptGuard>
            <AudioPromptModel
              isExcute={isExcute}
              props={props}
              status={status}
              onChangePrompt={handleChangePrompt}
              onSelectChange={handleSelectChange}
              onSend={handleSend}
            ></AudioPromptModel>
          </ReadOnlyPromptGuard>
        </NodeToolbar>
      )}
      {modalVisible &&
        createPortal(
          <UploadModal
            accept={nodeType}
            allowLocal={allowLocal}
            maxSize={20}
            nodeId={id}
            visible={modalVisible}
            onCancel={() => setModalVisible(false)}
            onOk={handleUploadSuccess}
          ></UploadModal>,
          document.body
        )}
      {previewVisible && createPortal(<CanvasAssetPreview visible={previewVisible} nodeId={id} urls={previewUrls} onClose={() => setPreviewVisible(false)} />, document.body)}
    </div>
  );
};

export default memo(AudioNode);
