import { useCallback, useMemo, memo } from 'react';
import InputParams from '../../../components/promptControl/InputParams';
import Selection from '../../../components/promptControl/Selection';
import SendButton from '../../../components/promptControl/SendButton';
import CustomTabs from '../../../components/common/CustomTabs';
import ProseMirrorEditor from '../../../components/common/ProseMirrorEditor';
import { useFlowStore } from '@/store/flowStore';
import hooks from '../../../hooks';
import type { MentionItem } from '@/lib/mentionPlugin';
import type { MediaInputItem } from '../../../utils/util';
import { getPanoramaModelTypeMismatchReason, PANORAMA_MODEL_TYPE_TABS, PANORAMA_RESOLUTION_OPTIONS } from './panoramaUtil';

const { useGetNodeInput, usePromptModelCommon } = hooks;

interface PanoramaPromptModelProps {
  isExcute: boolean;
  props: any;
  status: string;
  caculatePoint: number;
  pointLoading?: boolean;
  onChangePrompt: (value: string) => void;
  onSelectChange: (key: string, value: string) => void;
  onSend: () => void;
  onEnter?: () => void;
  onLeave?: () => void;
}

const PanoramaPromptModel = ({
  isExcute,
  props,
  status,
  caculatePoint,
  pointLoading = false,
  onChangePrompt,
  onSelectChange,
  onSend,
  onEnter = () => {},
  onLeave = () => {},
}: PanoramaPromptModelProps) => {
  const { data, id } = props;
  const edges = useFlowStore(state => state.edges);
  const nodes = useFlowStore(state => state.nodes);
  const { edgeOrderChange } = useFlowStore(state => state.actions);
  const { textMap, imageMap, mediaInputs } = useGetNodeInput(id, nodes, edges);
  const textValues = useMemo(() => textMap.map(t => t.value), [textMap]);

  const { prompt, setPrompt, allowSend, disabledReason, debouncedUpdateValue, flushPrompt } = usePromptModelCommon({
    nodePrompt: data.params.prompt || '',
    status,
    hasExtraInputs: Boolean(textMap.length || imageMap.length),
    inputTextsForLen: textValues,
    onChangePrompt,
  });

  const modelType = String(data.params.modelType || 'text_to_image');
  const isTextToImage = modelType === 'text_to_image';

  const modelTypeMismatchTip = useMemo(() => getPanoramaModelTypeMismatchReason(modelType, imageMap.length), [modelType, imageMap.length]);

  const canSendByMode = useMemo(() => {
    if (modelTypeMismatchTip) return false;
    if (modelType === 'image_editing') return imageMap.length > 0;
    return allowSend;
  }, [allowSend, imageMap.length, modelType, modelTypeMismatchTip]);

  const sendDisabledReason = modelTypeMismatchTip ?? disabledReason;
  const canSend = canSendByMode && !modelTypeMismatchTip;

  const mentions = useMemo<MentionItem[]>(() => {
    return imageMap.map((item, index) => ({
      id: item.edgeId + '-' + item.value,
      name: `图片${index + 1}`,
      avatar: item.value,
      mediaKind: 'image' as const,
    }));
  }, [imageMap]);

  const handleEdgeOrderChange = useCallback(
    (order: MediaInputItem[]) => {
      edgeOrderChange(order);
    },
    [edgeOrderChange]
  );

  const handleSend = () => {
    if (!isExcute && canSend) {
      flushPrompt();
      onSend();
    }
  };

  return (
    <div
      className='grid w-max min-w-[640px] grid-cols-[minmax(0,1fr)] rounded-2xl border border-white/10 bg-[#262626] p-4 z-10'
      style={{ userSelect: 'none' }}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
    >
      <div className='w-full min-w-0 [contain:inline-size]'>
        <CustomTabs tabs={PANORAMA_MODEL_TYPE_TABS.map(t => ({ key: t.key, label: t.label }))} activeKey={modelType} onChange={value => onSelectChange('modelType', value)} />
        <InputParams textMap={textMap} imageMap={[]} mediaMap={mediaInputs} onMediaOrderChange={handleEdgeOrderChange} />
        {isTextToImage ? (
          <div className='mb-2' onKeyDown={e => e.stopPropagation()}>
            <ProseMirrorEditor
              value={prompt}
              mentions={mentions}
              placeholder='输入画面描述，如主体、场景、风格、光影、构图等'
              onChange={value => {
                setPrompt(value);
                debouncedUpdateValue(value);
              }}
            />
          </div>
        ) : null}
      </div>

      <div className='flex items-center justify-between gap-2 nodrag'>
        <div className='flex flex-wrap items-center gap-1 min-w-0'>
          <span className='text-sm text-white/65 whitespace-nowrap'>输出分辨率</span>
          <Selection
            options={PANORAMA_RESOLUTION_OPTIONS}
            label='输出分辨率'
            value={data.params.resolution || '2K'}
            onChange={value => onSelectChange('resolution', String(value))}
            showDropdownIcon
          />
        </div>
        <SendButton isExcute={isExcute} allowSend={canSend} caculatePoint={caculatePoint} pointLoading={pointLoading} onClick={handleSend} disabledReason={sendDisabledReason} />
      </div>
    </div>
  );
};

export default memo(PanoramaPromptModel);
