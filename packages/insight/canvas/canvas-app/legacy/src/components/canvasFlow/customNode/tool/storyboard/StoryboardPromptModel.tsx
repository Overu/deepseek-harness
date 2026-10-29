import { Textarea } from '@/components/ui/textarea';
import { memo, useCallback, useMemo } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useFlowStore } from '@/store/flowStore';
import { ChevronDown } from 'lucide-react';
import hooks from '../../../hooks';
import InputParams from '../../../components/promptControl/InputParams';
import SendButton from '../../../components/promptControl/SendButton';
import styles from '../../../components/index.module.less';
import type { MediaInputItem, TextInputItem } from '../../../utils/util';
import type { StoryboardMode } from './types';
import { useAutoResizeHeight } from '@/hooks/useAutoResizeHeight';

const { usePromptModelCommon, useToolPermissionDisabled } = hooks;

interface ImageMapItem {
  edgeId: string;
  value: string;
}

interface InputConnections {
  hasText: boolean;
  hasImage: boolean;
  hasVideo: boolean;
}

interface PromptModelProps {
  isExcute: boolean;
  status: string;
  mode: StoryboardMode;
  data: { params?: { prompt?: string } };
  inputConnections: InputConnections;
  textMap: TextInputItem[];
  imageMap: ImageMapItem[];
  videoMap: ImageMapItem[];
  mediaInputs: MediaInputItem[];
  caculatePoint: number;
  pointLoading?: boolean;
  onChangePrompt: (value: string) => void;
  onSelectChange: (key: string, value: string) => void;
  onSend: () => void;
}

interface ModeOption {
  value: StoryboardMode;
  label: string;
  desc?: string;
  tip?: string;
}

const STORYBOARD_TOOL_TYPE = 'storyboardTool';

const StoryboardPromptModel = ({
  isExcute,
  status,
  mode,
  data,
  inputConnections,
  textMap,
  imageMap,
  videoMap,
  mediaInputs,
  caculatePoint,
  pointLoading = false,
  onChangePrompt,
  onSelectChange,
  onSend,
}: PromptModelProps) => {
  const toolPermissionDisabled = useToolPermissionDisabled(STORYBOARD_TOOL_TYPE);
  const { edgeOrderChange } = useFlowStore(state => state.actions);

  const totalInputs = textMap.length + imageMap.length + videoMap.length;
  const textValues = useMemo(() => textMap.map(t => t.value), [textMap]);

  const { prompt, setPrompt, debouncedUpdateValue, flushPrompt } = usePromptModelCommon({
    nodePrompt: data.params?.prompt || '',
    status,
    hasExtraInputs: totalInputs > 0,
    inputTextsForLen: textValues,
    onChangePrompt,
  });
  const editorRef = useAutoResizeHeight(prompt);

  const modeOptions: ModeOption[] = useMemo(() => {
    return [
      { value: 'custom', label: '自定义模式', desc: '输入提示词即可输出创意表格' },
      {
        value: 'gen_script',
        label: '剧本生成',
        desc: '只需故事大纲或原文，一键自动生成分镜脚本',
        tip: inputConnections.hasImage || inputConnections.hasVideo ? '只支持接入文本输入' : undefined,
      },
      {
        value: 'video_understand',
        label: '视频反推',
        desc: '上传任意视频，智能解析拆解专业分镜脚本',
        tip: inputConnections.hasText || inputConnections.hasImage ? '只支持接入视频输入' : undefined,
      },
    ];
  }, [inputConnections]);

  const selectedModeLabel = useMemo(() => {
    return modeOptions.find(o => o.value === mode)?.label || '';
  }, [mode, modeOptions]);

  const textareaPlaceholder = useMemo(() => {
    if (mode === 'gen_script') {
      return '请连入剧本内容，并输入"根据我的剧本生成【分镜数量】的故事脚本"试试吧';
    }
    return '请输入内容...';
  }, [mode]);

  const allowSend = useMemo<boolean>(() => {
    if (status === 'running') return false;
    if (mode === 'custom' || mode === 'gen_script') {
      return textMap.length > 0 || Boolean(prompt && prompt.trim().length > 0);
    }
    if (mode === 'video_understand') {
      return videoMap.length > 0;
    }
    return false;
  }, [mode, textMap.length, videoMap.length, prompt, status]);

  const allowSendEffective = allowSend && !toolPermissionDisabled;

  const handleEdgeOrderChange = useCallback(
    (nextImageMap: ImageMapItem[]) => {
      edgeOrderChange(nextImageMap);
    },
    [edgeOrderChange]
  );

  const handleSend = () => {
    if (!isExcute && allowSendEffective) {
      flushPrompt();
      onSend();
    }
  };

  return (
    <div className='grid w-max min-w-[672px] grid-cols-[minmax(0,1fr)] p-4' style={{ userSelect: 'none' }}>
      <InputParams textMap={textMap} imageMap={imageMap} mediaMap={mediaInputs} onMediaOrderChange={handleEdgeOrderChange as any} />

      {mode !== 'video_understand' && (
        <div className='mb-2 min-w-0 [contain:inline-size]'>
          <Textarea
            ref={editorRef}
            value={prompt}
            onKeyDown={e => e.stopPropagation()}
            onChange={e => {
              setPrompt(e.target.value);
              debouncedUpdateValue(e.target.value);
            }}
            rows={4}
            placeholder={textareaPlaceholder}
            className='nowheel [&::-webkit-scrollbar]:hidden px-0 resize-none border-none bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0'
          />
        </div>
      )}

      <div className='flex items-center justify-between gap-2 nodrag'>
        <div className='flex flex-1 min-w-0 items-center gap-2'>
          <Select value={mode} onValueChange={value => onSelectChange('mode', value)}>
            <SelectTrigger className={`${styles.customSelect} ${styles.hideSelectIcon} shrink-0`}>
              <span className='truncate'>{selectedModeLabel}</span>
              <span className='flex items-center text-white/60' aria-hidden>
                <ChevronDown className='h-4 w-4 shrink-0' />
              </span>
            </SelectTrigger>
            <SelectContent>
              <TooltipProvider delayDuration={100}>
                {modeOptions.map(option => {
                  const disabled = !!option.tip;
                  const content = (
                    <div className='flex flex-col gap-1'>
                      <div className='leading-5'>{option.label}</div>
                      {option.desc ? <div className='text-xs text-white/45 leading-4'>{option.desc}</div> : null}
                    </div>
                  );
                  if (!disabled) {
                    return (
                      <SelectItem key={option.value} value={option.value}>
                        {content}
                      </SelectItem>
                    );
                  }
                  return (
                    <Tooltip key={option.value}>
                      <TooltipTrigger asChild>
                        <div>
                          <SelectItem value={option.value} disabled className='opacity-50'>
                            {content}
                          </SelectItem>
                        </div>
                      </TooltipTrigger>
                      <TooltipContent side='right'>{option.tip}</TooltipContent>
                    </Tooltip>
                  );
                })}
              </TooltipProvider>
            </SelectContent>
          </Select>
          {mode === 'video_understand' && (
            <>
              <div className='h-3.5 w-px shrink-0 bg-white/25' aria-hidden />
              <span className='min-w-0 text-sm text-white/45 leading-5'>请连入5分钟以内的mp4/mov格式视频</span>
            </>
          )}
        </div>

        <div className='flex gap-2 shrink-0'>
          <SendButton isExcute={isExcute} allowSend={allowSendEffective} caculatePoint={caculatePoint} pointLoading={pointLoading} onClick={handleSend} />
        </div>
      </div>
    </div>
  );
};

export default memo(StoryboardPromptModel);
